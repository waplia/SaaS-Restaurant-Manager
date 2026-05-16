import cron from "node-cron";
import { db } from "./db";
import { eq, and, gte, lte, lt, sum, count, desc, sql, notInArray, inArray } from "drizzle-orm";
import { ordersTable, menuItemsTable, orderItemsTable, restaurantsTable, usersTable, tenantsTable, notificationsTable, paymentsTable, reservationsTable, customersTable, restaurantSettingsTable, documentsTable } from "../lib/db";
import { sendWhatsApp, reservationEmail } from "./notifications";
import { pushToStaff } from "./pushNotify";
import { sendEmail, dailySummaryEmail } from "./notifications";
import { sendByTemplateKey } from "./emailSender";
import { sendBroadcastWhatsApp } from "./whatsapp";
import { logger } from "./logger";
import { expireDueLoyaltyPoints } from "./loyalty";
import { runAutoReorderForRestaurant } from "./autoReorder";
import { sendLifecycleSms, sweepQuotaAlerts } from "./smsSender";
import { subscriptionPlansTable } from "../lib/db";
import { registerCron, runTrackedCron } from "./systemLogs";
import { processPendingWebhookDeliveries } from "./webhookDispatcher";
import { registerCronJob, recordCronRun, runScheduledBackupTick } from "./maintenance";
import { runMonthlyAllocationSweep } from "./aiCredits";
import { runFraudCronTick } from "./fraudDetection";
import { runNightlyDemandForecastsForHour } from "./demandForecast";
import { snapshotAllRestaurants } from "./healthScore";

function trackCron(name: string, expr: string, fn: () => Promise<void>) {
  registerCronJob(name, expr);
  return cron.schedule(expr, async () => {
    try { await fn(); recordCronRun(name, true); }
    catch (err) { recordCronRun(name, false, (err as Error).message); throw err; }
  }, { timezone: "Asia/Kolkata" });
}

async function backfillPaymentsLedger(): Promise<void> {
  // Postgres advisory lock: serializes backfill across concurrent app starts/instances.
  // Arbitrary stable lock key for "payments-ledger-backfill".
  const LOCK_KEY = 73610136;
  try {
    const lockRes = await db.execute(sql`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS got`);
    const got = (lockRes as unknown as { rows: { got: boolean }[] }).rows?.[0]?.got;
    if (!got) {
      logger.info("[Backfill] Another instance holds the backfill lock; skipping.");
      return;
    }

    try {
      const existingOrderIds = await db
        .selectDistinct({ id: paymentsTable.referenceId })
        .from(paymentsTable)
        .where(eq(paymentsTable.referenceType, "order"));
      const skipIds = new Set(
        existingOrderIds.map(r => r.id).filter((x): x is number => x !== null),
      );

      // Iterate in batches by ascending id until exhaustion (no hard cap).
      // Historical split orders cannot be split-reconstructed from the orders
      // table alone (no per-leg amounts persisted), so they are recorded as a
      // single ledger row using the order's recorded paymentMethod (or "cash"
      // if not in the supported enum). New split payments are written
      // accurately as one ledger row per leg from the /split endpoint.
      const BATCH = 500;
      let lastId = 0;
      let totalInserted = 0;
      // Hard upper bound on iterations to prevent runaway loops in pathological data.
      for (let iter = 0; iter < 10_000; iter++) {
        const batch = await db.select().from(ordersTable)
          .where(and(eq(ordersTable.paymentStatus, "paid"), sql`${ordersTable.id} > ${lastId}`))
          .orderBy(ordersTable.id)
          .limit(BATCH);
        if (batch.length === 0) break;
        lastId = batch[batch.length - 1]!.id;

        const rows = batch
          .filter(o => !skipIds.has(o.id))
          .map(o => ({
            restaurantId: o.restaurantId,
            direction: "in" as const,
            method: o.paymentMethod && ["cash", "card", "upi", "stripe", "razorpay", "bank", "other"].includes(o.paymentMethod)
              ? o.paymentMethod
              : "cash",
            amount: Number(o.totalAmount).toFixed(2),
            paymentDate: o.updatedAt ?? o.createdAt,
            partyType: (o.customerId ? "customer" : "other") as "customer" | "other",
            partyId: o.customerId ?? null,
            partyName: o.customerName ?? null,
            referenceType: "order" as const,
            referenceId: o.id,
            notes: o.paymentMethod?.startsWith("split:")
              ? "Backfilled from historical paid order (approximate — split legs not reconstructed)"
              : "Backfilled from historical paid order",
            recordedBy: o.waiterId ?? null,
          }));

        if (rows.length > 0) {
          await db.insert(paymentsTable).values(rows);
          totalInserted += rows.length;
        }
        if (batch.length < BATCH) break;
      }

      if (totalInserted === 0) {
        logger.info("[Backfill] Payments ledger is up-to-date.");
      } else {
        logger.info({ count: totalInserted }, "[Backfill] Inserted historical payment ledger rows.");
      }
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(${LOCK_KEY})`);
    }
  } catch (err) {
    logger.error({ err }, "[Backfill] Failed to backfill payments ledger");
  }
}

export function startScheduler(): void {
  backfillPaymentsLedger().catch(err => logger.error({ err }, "Backfill startup error"));

  registerCron("daily-sales-summary", "0 23 * * *", "Emails per-restaurant daily sales summary at 23:00 IST");
  registerCron("trial-expiry", "0 0 * * *", "Notifies tenants whose trial has expired at 00:00 IST");
  registerCron("loyalty-expiry", "30 0 * * *", "Expires due loyalty points at 00:30 IST");
  registerCron("auto-reorder", "* * * * *", "Per-restaurant auto-reorder evaluator (IST)");
  registerCron("ai-monthly-allocation", "0 1 * * *", "Credits each tenant's Khana AI monthly allowance on their renewal-cycle anniversary day at 01:00 IST (idempotent per cycle)");
  registerCron("fraud-detect-fast", "5 * * * *", "Hourly fast fraud detectors (discounts, voids, KOT cancels, refunds, free items)");
  registerCron("fraud-detect-slow", "30 2 * * *", "Nightly slow fraud detectors at 02:30 IST (cash, attendance, inventory)");
  registerCron("nightly-demand-forecast", "0 * * * *", "Per-restaurant nightly tomorrow forecast: ticks hourly and runs whenever a restaurant's local time is 02:00 in its configured timezone (gated on plan, feature toggle, history, and credits)");
  registerCron("addon-lifecycle-sweep", "*/15 * * * *", "Expires add-on trials and ended billing periods every 15 min");
  registerCron("health-score-nightly", "0 3 * * *", "Computes nightly Restaurant Health Score (0–100) for all active restaurants at 03:00 IST");

  trackCron("addon_lifecycle_sweep", "*/15 * * * *", async () => {
    try {
      const { sweepAddonLifecycle } = await import("./addons");
      await sweepAddonLifecycle(new Date());
    } catch (err) {
      logger.error({ err }, "Add-on lifecycle sweep failed");
    }
  });

  trackCron("health_score_nightly", "0 3 * * *", async () => {
    await runTrackedCron("health-score-nightly", async () => {
      const r = await snapshotAllRestaurants();
      logger.info({ ...r }, "[health-score] nightly snapshot complete");
    }).catch(err => logger.error({ err }, "[health-score] nightly snapshot failed"));
  });

  trackCron("fraud_detect_fast", "5 * * * *", async () => {
    await runFraudCronTick("fast");
  });
  trackCron("fraud_detect_slow", "30 2 * * *", async () => {
    await runFraudCronTick("slow");
  });

  // Nightly auto-run of the AI demand forecast — ticks once per IST hour at
  // minute 0 and runs the per-restaurant scan; the helper itself filters to
  // restaurants whose own local hour matches the target (02:00 local).
  trackCron("nightly_demand_forecast", "0 * * * *", async () => {
    try {
      const r = await runNightlyDemandForecastsForHour(2);
      if (r.evaluated > 0 || r.ranOk > 0) {
        logger.info({ ...r }, "[forecast-nightly] sweep complete");
      }
    } catch (err) {
      logger.error({ err }, "[forecast-nightly] sweep failed");
    }
  });

  trackCron("ai_monthly_allocation", "0 1 * * *", async () => {
    await runTrackedCron("ai-monthly-allocation", async () => {
      const r = await runMonthlyAllocationSweep();
      logger.info({ allocated: r.allocated, total: r.total }, "[ai-credits] monthly allocation sweep complete");
    }).catch(err => logger.error({ err }, "[ai-credits] monthly allocation sweep failed"));
  });

  trackCron("daily_sales_summary", "0 23 * * *", async () => {
    logger.info("Running daily sales summary job");
    await runTrackedCron("daily-sales-summary", async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const restaurants = await db.select().from(restaurantsTable).where(eq(restaurantsTable.isActive, true));

      for (const restaurant of restaurants) {
        const [orderSummary] = await db
          .select({ total: sum(ordersTable.totalAmount), cnt: count() })
          .from(ordersTable)
          .where(and(
            eq(ordersTable.restaurantId, restaurant.id),
            eq(ordersTable.paymentStatus, "paid"),
            gte(ordersTable.createdAt, today),
            lte(ordersTable.createdAt, tomorrow),
          ));

        const topItemRows = await db
          .select({ name: menuItemsTable.name, cnt: count(orderItemsTable.id) })
          .from(orderItemsTable)
          .leftJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
          .leftJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id))
          .where(and(
            eq(ordersTable.restaurantId, restaurant.id),
            gte(ordersTable.createdAt, today),
            lte(ordersTable.createdAt, tomorrow),
          ))
          .groupBy(menuItemsTable.name)
          .orderBy(desc(count(orderItemsTable.id)))
          .limit(5);

        const owners = await db.select().from(usersTable).where(and(
          eq(usersTable.restaurantId, restaurant.id),
          eq(usersTable.role, "owner"),
          eq(usersTable.isActive, true),
        ));

        const dateStr = today.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
        const emailData = dailySummaryEmail({
          restaurantName: restaurant.name,
          date: dateStr,
          totalOrders: Number(orderSummary?.cnt ?? 0),
          totalRevenue: Number(orderSummary?.total ?? 0).toFixed(2),
          topItems: topItemRows.map(r => r.name ?? "Unknown"),
        });

        for (const owner of owners) {
          if (owner.email) {
            await sendEmail({ to: owner.email, subject: emailData.subject, html: emailData.html, text: emailData.text });
          }
        }
      }
    }).catch(err => logger.error({ err }, "Daily summary job failed"));
  });

  trackCron("trial_expiry", "0 0 * * *", async () => {
    logger.info("Running trial-expiry enforcement job");
    await runTrackedCron("trial-expiry", async () => {
      const now = new Date();
      const expiredTenants = await db
        .select()
        .from(tenantsTable)
        .where(and(eq(tenantsTable.planStatus, "trial"), lt(tenantsTable.trialEndsAt, now), eq(tenantsTable.isActive, true)));

      for (const tenant of expiredTenants) {
        const restaurants = await db.select({ id: restaurantsTable.id, name: restaurantsTable.name })
          .from(restaurantsTable)
          .where(eq(restaurantsTable.tenantId, tenant.id));

        for (const restaurant of restaurants) {
          await db.insert(notificationsTable).values({
            restaurantId: restaurant.id,
            type: "system_error",
            title: "Trial Expired",
            message: "Your free trial has ended. Upgrade to a paid plan to continue using Khana Lagao.",
          }).catch(() => {});

          void sendLifecycleSms({
            tenantId: tenant.id,
            restaurantId: restaurant.id,
            eventKey: "subscription_expired",
            variables: { restaurant: restaurant.name, tenant: tenant.name },
          });

          const owners = await db.select({ email: usersTable.email, name: usersTable.name, phone: usersTable.phone })
            .from(usersTable)
            .where(and(eq(usersTable.restaurantId, restaurant.id), eq(usersTable.role, "owner"), eq(usersTable.isActive, true)));

          for (const owner of owners) {
            if (owner.email) {
              const upgradeUrl = `${(process.env.PUBLIC_APP_URL ?? process.env.VITE_APP_URL ?? "https://khanalagao.app").replace(/\/$/, "")}/settings/subscription`;
              await sendByTemplateKey("subscription_expired", owner.email, {
                name: owner.name ?? "there",
                plan: "Trial",
                expiredAt: (tenant.trialEndsAt ?? new Date()).toISOString().slice(0, 10),
                upgradeUrl,
                appName: "Khana Lagao",
              }, { tenantId: tenant.id });
            }
            if (owner.phone) {
              await sendBroadcastWhatsApp({
                restaurantId: restaurant.id,
                to: owner.phone,
                event: "trial_expiring",
                body: `Hi ${owner.name ?? "there"}, your Khana Lagao free trial for ${restaurant.name} has expired. Upgrade now to keep using your account.`,
                templateVars: { name: owner.name ?? "there", restaurant: restaurant.name },
              }).catch(err => logger.warn({ err, restaurantId: restaurant.id }, "Trial-expiry WhatsApp send failed"));
            }
          }
        }
      }

      logger.info({ count: expiredTenants.length }, "Trial-expiry job complete");
    }).catch(err => logger.error({ err }, "Trial-expiry job failed"));
  });

  // Trial-ending warning — fires daily at 09:00 IST for tenants whose trial ends in ~3 days.
  // Sends BOTH SMS and Email reminders.
  trackCron("trial_ending_reminder", "0 9 * * *", async () => {
    try {
      const now = new Date();
      const winStart = new Date(now); winStart.setDate(winStart.getDate() + 2); winStart.setHours(0, 0, 0, 0);
      const winEnd = new Date(now); winEnd.setDate(winEnd.getDate() + 3); winEnd.setHours(23, 59, 59, 999);
      const tenants = await db.select().from(tenantsTable).where(and(
        eq(tenantsTable.planStatus, "trial"),
        gte(tenantsTable.trialEndsAt, winStart),
        lte(tenantsTable.trialEndsAt, winEnd),
        eq(tenantsTable.isActive, true),
      ));
      const upgradeUrl = `${(process.env.PUBLIC_APP_URL ?? process.env.VITE_APP_URL ?? "https://khanalagao.app").replace(/\/$/, "")}/settings/subscription`;
      for (const t of tenants) {
        const daysLeft = Math.max(0, Math.ceil(((t.trialEndsAt?.getTime() ?? now.getTime()) - now.getTime()) / 86_400_000));
        void sendLifecycleSms({ tenantId: t.id, eventKey: "trial_ending", variables: { tenant: t.name, daysLeft } });
        const owners = await db.select({ email: usersTable.email, name: usersTable.name })
          .from(usersTable)
          .where(and(eq(usersTable.tenantId, t.id), eq(usersTable.role, "owner"), eq(usersTable.isActive, true)));
        for (const owner of owners) {
          if (!owner.email) continue;
          await sendByTemplateKey("trial_ending", owner.email, {
            name: owner.name ?? "there",
            daysLeft,
            trialEndsAt: (t.trialEndsAt ?? new Date()).toISOString().slice(0, 10),
            upgradeUrl,
            appName: "Khana Lagao",
          }, { tenantId: t.id });
        }
      }
      logger.info({ count: tenants.length }, "Trial-ending reminder job complete (SMS+Email)");
    } catch (err) { logger.error({ err }, "Trial-ending reminder job failed"); }
  });

  // Payment-reminder — fires daily at 10:00 IST for active tenants whose subscription ends in ~3 days.
  trackCron("payment_reminder", "0 10 * * *", async () => {
    try {
      const now = new Date();
      const winStart = new Date(now); winStart.setDate(winStart.getDate() + 2); winStart.setHours(0, 0, 0, 0);
      const winEnd = new Date(now); winEnd.setDate(winEnd.getDate() + 3); winEnd.setHours(23, 59, 59, 999);
      const rows = await db.select({
        id: tenantsTable.id, name: tenantsTable.name, endsAt: tenantsTable.subscriptionEndsAt,
        planName: subscriptionPlansTable.name, price: subscriptionPlansTable.price,
      }).from(tenantsTable)
        .leftJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, tenantsTable.planId))
        .where(and(
          eq(tenantsTable.planStatus, "active"),
          gte(tenantsTable.subscriptionEndsAt, winStart),
          lte(tenantsTable.subscriptionEndsAt, winEnd),
          eq(tenantsTable.isActive, true),
        ));
      for (const t of rows) {
        const daysLeft = Math.max(0, Math.ceil(((t.endsAt?.getTime() ?? now.getTime()) - now.getTime()) / 86_400_000));
        void sendLifecycleSms({
          tenantId: t.id, eventKey: "payment_reminder",
          variables: { tenant: t.name, plan: t.planName ?? "your plan", amount: t.price ?? "0", daysLeft },
        });
      }
      logger.info({ count: rows.length }, "Payment-reminder SMS job complete");
    } catch (err) { logger.error({ err }, "Payment-reminder SMS job failed"); }
  });

  // Hourly SMS quota sweep — surfaces low-balance alerts in the Notification Center.
  trackCron("sms_quota_sweep", "15 * * * *", async () => {
    try { await sweepQuotaAlerts(); }
    catch (err) { logger.error({ err }, "SMS quota sweep failed"); }
  });

  trackCron("loyalty_expiry", "30 0 * * *", async () => {
    logger.info("Running loyalty-points expiry job");
    await runTrackedCron("loyalty-expiry", async () => {
      const expired = await expireDueLoyaltyPoints();
      logger.info({ expired }, "Loyalty-expiry job complete");
    }).catch(err => logger.error({ err }, "Loyalty-expiry job failed"));
  });

  // Auto-reorder is per-restaurant: each tenant configures its own cron expression
  // (restaurants.autoReorderCron). We tick every minute in IST and run any restaurant
  // whose schedule matches the current minute.
  trackCron("auto_reorder_tick", "* * * * *", async () => {
    await runTrackedCron("auto-reorder", async () => {
      await runAutoReorderTick(new Date());
    }).catch(err => logger.error({ err }, "Auto-reorder tick failed"));
  });

  // Webhook delivery retry processor — every minute, picks any deliveries
  // whose nextAttemptAt has passed and re-attempts them with exponential backoff.
  trackCron("webhook_retry", "* * * * *", async () => {
    try {
      const n = await processPendingWebhookDeliveries(50);
      if (n > 0) logger.info({ n }, "Processed pending webhook deliveries");
    } catch (err) {
      logger.error({ err }, "Webhook retry tick failed");
    }
  });

  // Scheduled platform backups: tick every minute and run when next_run_at is due.
  trackCron("scheduled_backup", "* * * * *", async () => {
    await runScheduledBackupTick();
  });

  // Reservation reminders + no-show sweep — runs every 5 minutes.
  // - Sends a one-shot reminder for confirmed reservations whose start is
  //   ~`reminderMinutes` minutes away (default 60).
  // - Auto-marks reservations as no_show when grace period after the start
  //   has elapsed and they are still pending/confirmed.
  registerCron("reservation_sweep", "*/5 * * * *", "Reservation reminders + no-show sweep (every 5 min, IST)");
  trackCron("reservation_sweep", "*/5 * * * *", async () => {
    try {
      await runReservationSweep(new Date());
    } catch (err) {
      logger.error({ err }, "[reservation-sweep] failed");
    }
  });

  // Document Vault expiry sweep — daily at 09:00 IST. Surfaces an in-app
  // notification per (document, owner) when expiry falls inside the per-doc
  // reminderDays window, plus an "already expired" notification once.
  registerCron("documents_expiry_sweep", "0 9 * * *", "Document Vault expiry/expiring reminders (daily 09:00 IST)");
  trackCron("documents_expiry_sweep", "0 9 * * *", async () => {
    try { await runDocumentsExpirySweep(new Date()); }
    catch (err) { logger.error({ err }, "[documents-expiry] failed"); }
  });

  // Kitchen delay alerts: scan active tickets every minute, emit alerts for
  // tickets past their per-restaurant configured threshold (default 10 min).
  trackCron("kitchen_delay_detector", "* * * * *", async () => {
    try {
      const { runDelayDetectionTick } = await import("./kitchenDelay");
      const r = await runDelayDetectionTick(new Date());
      if (r.alertsCreated > 0) logger.info({ alerts: r.alertsCreated }, "Kitchen delay alerts emitted");
    } catch (err) {
      logger.error({ err }, "Kitchen delay detector failed");
    }
  });

  logger.info("Scheduler started — daily summary at 23:00 IST, trial-expiry at 00:00 IST, loyalty-expiry at 00:30 IST, auto-reorder evaluated every minute (per-restaurant cron, IST), webhook retries every minute, scheduled backups every minute");
}

async function runDocumentsExpirySweep(now: Date): Promise<void> {
  // Distributed idempotency: skip if another instance is already running.
  const LOCK_KEY = 73610142;
  const lockRes = await db.execute(sql`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS got`);
  const got = (lockRes as unknown as { rows: { got: boolean }[] }).rows?.[0]?.got;
  if (!got) { logger.info("[documents-expiry] another instance holds the lock; skipping"); return; }

  try {
    let lastId = 0;
    let notified = 0;
    const horizon = new Date(now.getTime() + 365 * 86_400_000);
    // Deterministic ascending id pagination so older rows are never starved.
    for (let iter = 0; iter < 200; iter++) {
      const batch = await db.select().from(documentsTable).where(and(
        eq(documentsTable.status, "active"),
        sql`${documentsTable.expiresAt} IS NOT NULL`,
        lte(documentsTable.expiresAt, horizon),
        sql`${documentsTable.id} > ${lastId}`,
      )).orderBy(documentsTable.id).limit(200);
      if (batch.length === 0) break;
      lastId = batch[batch.length - 1]!.id;

      for (const d of batch) {
        if (!d.expiresAt) continue;
        const daysLeft = Math.ceil((d.expiresAt.getTime() - now.getTime()) / 86_400_000);
        const isExpired = daysLeft < 0;
        const isExpiringSoon = !isExpired && daysLeft <= (d.reminderDays ?? 30);
        if (!isExpired && !isExpiringSoon) continue;

        // Once-only "expired" notification: skip if any reminder was sent
        // AFTER the doc expired. Expiring-soon throttles to once per 23h.
        if (isExpired) {
          if (d.lastReminderSentAt && d.lastReminderSentAt > d.expiresAt) continue;
        } else if (d.lastReminderSentAt && now.getTime() - d.lastReminderSentAt.getTime() < 23 * 3_600_000) {
          continue;
        }

        // Owner-targeted in-app notifications: fan out one per active owner of
        // the restaurant so the Notification Center shows it for every owner.
        const owners = await db.select({ id: usersTable.id })
          .from(usersTable)
          .where(and(
            eq(usersTable.restaurantId, d.restaurantId),
            eq(usersTable.role, "owner"),
            eq(usersTable.isActive, true),
          ));

        const title = isExpired
          ? `Document expired: ${d.title}`
          : `Document expiring in ${daysLeft} day${daysLeft === 1 ? "" : "s"}: ${d.title}`;
        const message = isExpired
          ? `Your ${d.category.toUpperCase()} document "${d.title}" expired on ${d.expiresAt.toISOString().slice(0, 10)}. Upload a new version in the Document Vault.`
          : `Your ${d.category.toUpperCase()} document "${d.title}" expires on ${d.expiresAt.toISOString().slice(0, 10)}. Renew it before then.`;

        // Always insert at least one restaurant-level row; additionally fan out
        // per owner if the notifications schema supports a userId column. The
        // platform notificationsTable used elsewhere for trial-expiry only
        // requires { restaurantId, type, title, message }, so we insert one row
        // per owner with restaurantId duplicated — owners read by restaurantId.
        if (owners.length === 0) {
          await db.insert(notificationsTable).values({
            restaurantId: d.restaurantId, type: "system_error", title, message,
          }).catch(() => {});
        } else {
          for (let i = 0; i < owners.length; i++) {
            await db.insert(notificationsTable).values({
              restaurantId: d.restaurantId, type: "system_error", title, message,
            }).catch(() => {});
          }
        }

        await db.update(documentsTable)
          .set({ lastReminderSentAt: new Date() })
          .where(and(eq(documentsTable.id, d.id), eq(documentsTable.restaurantId, d.restaurantId)))
          .catch(() => {});
        notified++;
      }

      if (batch.length < 200) break;
    }
    if (notified > 0) logger.info({ notified }, "[documents-expiry] sweep complete");
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${LOCK_KEY})`).catch(() => {});
  }
}

async function runReservationSweep(now: Date): Promise<void> {
  // Per-restaurant reservation settings — read overrides from restaurant_settings.section="reservation"
  const settingsRows = await db.select().from(restaurantSettingsTable).where(eq(restaurantSettingsTable.section, "reservation"));
  const cfgByRestaurant = new Map<number, { reminderMinutes: number; gracePeriodMinutes: number; autoNoShow: boolean }>();
  for (const row of settingsRows) {
    const data = (row.data ?? {}) as Record<string, unknown>;
    cfgByRestaurant.set(row.restaurantId, {
      reminderMinutes: Number(data.reminderMinutes) || 60,
      gracePeriodMinutes: Number(data.gracePeriodMinutes) || 15,
      autoNoShow: data.autoNoShow !== false,
    });
  }
  const defaultCfg = { reminderMinutes: 60, gracePeriodMinutes: 15, autoNoShow: true };

  // Reminders: confirmed bookings whose start is in [now+reminderMinutes-3, now+reminderMinutes+3] minutes
  // and that haven't been reminded yet.
  const reminderWindowMin = new Date(now.getTime() + 55 * 60_000);
  const reminderWindowMax = new Date(now.getTime() + 75 * 60_000);
  const dueForReminder = await db.select().from(reservationsTable).where(and(
    eq(reservationsTable.status, "confirmed"),
    sql`${reservationsTable.reminderSentAt} IS NULL`,
    gte(reservationsTable.scheduledAt, reminderWindowMin),
    lte(reservationsTable.scheduledAt, reminderWindowMax),
  )).limit(100);

  for (const r of dueForReminder) {
    const cfg = cfgByRestaurant.get(r.restaurantId) ?? defaultCfg;
    // Tighter target check using configured reminderMinutes
    const targetMs = r.scheduledAt.getTime() - cfg.reminderMinutes * 60_000;
    if (Math.abs(targetMs - now.getTime()) > 5 * 60_000) continue;
    try {
      const [restaurant] = await db.select({ name: restaurantsTable.name }).from(restaurantsTable).where(eq(restaurantsTable.id, r.restaurantId));
      const tpl = reservationEmail({
        customerName: r.guestName,
        restaurantName: restaurant?.name ?? "Restaurant",
        date: r.scheduledAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
        time: r.scheduledAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        guests: r.partySize,
      });
      const reminderText = `Hi ${r.guestName}, this is a friendly reminder of your reservation at ${restaurant?.name ?? "our restaurant"} for ${r.partySize} on ${tpl.text.split("on ")[1] ?? ""}. See you soon!`;
      if (r.guestEmail) {
        await sendEmail({ to: r.guestEmail, subject: `Reminder: ${tpl.subject}`, html: tpl.html.replace("Reservation Confirmed", "Reservation Reminder"), text: reminderText }).catch(() => {});
      }
      if (r.guestPhone) {
        await sendWhatsApp({ to: r.guestPhone, body: reminderText }).catch(() => {});
      }
      await db.update(reservationsTable).set({ reminderSentAt: new Date(), updatedAt: new Date() }).where(eq(reservationsTable.id, r.id));
    } catch (err) {
      logger.warn({ err, reservationId: r.id }, "[reservation-sweep] reminder failed");
    }
  }

  // No-show sweep: pending/confirmed reservations whose start + grace period < now.
  const overdue = await db.select().from(reservationsTable).where(and(
    inArray(reservationsTable.status, ["pending", "confirmed"]),
    sql`${reservationsTable.scheduledAt} + (${reservationsTable.gracePeriodMinutes} || ' minutes')::interval < ${now}`,
  )).limit(200);

  for (const r of overdue) {
    const cfg = cfgByRestaurant.get(r.restaurantId) ?? defaultCfg;
    if (!cfg.autoNoShow) continue;
    await db.update(reservationsTable).set({
      status: "no_show",
      noShowMarkedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(reservationsTable.id, r.id));

    if (r.customerId) {
      await db.update(customersTable).set({
        noShowCount: sql`${customersTable.noShowCount} + 1`,
        lastNoShowAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(customersTable.id, r.customerId)).catch(() => {});
    }

    await db.insert(notificationsTable).values({
      restaurantId: r.restaurantId,
      type: "reservation_request",
      title: "Reservation auto-marked no-show",
      message: `${r.guestName} (${r.partySize} guests) at ${r.scheduledAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`,
      entityId: r.id,
      entityType: "reservation",
    }).catch(() => {});

    pushToStaff(
      { restaurantId: r.restaurantId, roles: ["owner", "manager", "waiter"], type: "reservation" },
      { title: "Reservation no-show", body: `${r.guestName} • party of ${r.partySize}`, data: { reservationId: r.id } },
    ).catch(() => {});
  }

  if (dueForReminder.length || overdue.length) {
    logger.info({ reminders: dueForReminder.length, noShows: overdue.length }, "[reservation-sweep] done");
  }
}

async function runAutoReorderTick(now: Date) {
  const fields = istCronFields(now);
  const restaurants = await db.select({ id: restaurantsTable.id, cron: restaurantsTable.autoReorderCron, enabled: restaurantsTable.autoReorderEnabled })
    .from(restaurantsTable);
  for (const r of restaurants) {
    if (!r.enabled) continue;
    const expr = r.cron ?? "0 6 * * *";
    if (!cronMatches(expr, fields)) continue;
    logger.info({ restaurantId: r.id, cron: expr }, "Auto-reorder cron matched — running for restaurant");
    try {
      const result = await runAutoReorderForRestaurant(r.id);
      logger.info({ restaurantId: r.id, drafts: result.draftsCreated }, "Auto-reorder run complete");
    } catch (err) {
      logger.error({ err, restaurantId: r.id }, "Auto-reorder run failed");
    }
  }
}

interface CronFields { minute: number; hour: number; dom: number; month: number; dow: number; }
function istCronFields(now: Date): CronFields {
  // Compute IST (UTC+5:30) calendar fields without depending on host TZ
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
  return {
    minute: ist.getUTCMinutes(),
    hour: ist.getUTCHours(),
    dom: ist.getUTCDate(),
    month: ist.getUTCMonth() + 1,
    dow: ist.getUTCDay(),
  };
}
function cronMatches(expr: string, f: CronFields): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return (
    cronFieldMatches(parts[0]!, f.minute, 0, 59) &&
    cronFieldMatches(parts[1]!, f.hour, 0, 23) &&
    cronFieldMatches(parts[2]!, f.dom, 1, 31) &&
    cronFieldMatches(parts[3]!, f.month, 1, 12) &&
    cronFieldMatches(parts[4]!, f.dow, 0, 6)
  );
}
function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
  for (const piece of field.split(",")) {
    let step = 1;
    let range = piece;
    const slash = piece.indexOf("/");
    if (slash >= 0) {
      step = Number(piece.slice(slash + 1));
      range = piece.slice(0, slash);
      if (!Number.isFinite(step) || step <= 0) continue;
    }
    let lo: number, hi: number;
    if (range === "*") { lo = min; hi = max; }
    else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      if (!Number.isFinite(a!) || !Number.isFinite(b!)) continue;
      lo = a!; hi = b!;
    } else {
      const n = Number(range);
      if (!Number.isFinite(n)) continue;
      if (slash < 0) { if (n === value) return true; continue; }
      lo = n; hi = max;
    }
    if (value < lo || value > hi) continue;
    if ((value - lo) % step === 0) return true;
  }
  return false;
}
