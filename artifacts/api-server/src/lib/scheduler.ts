import cron from "node-cron";
import { db } from "./db";
import { eq, and, gte, lte, lt, sum, count, desc, sql, notInArray, inArray } from "drizzle-orm";
import { ordersTable, menuItemsTable, orderItemsTable, restaurantsTable, usersTable, tenantsTable, notificationsTable, paymentsTable, reservationsTable, customersTable, restaurantSettingsTable, documentsTable, eventBookingsTable, eventPaymentScheduleTable, subscriptionPlansTable as _plansTable, isFeatureEnabled } from "../lib/db";
import { sendWhatsApp, reservationEmail, sendEmail, dailySummaryEmail } from "./notifications";
import { pushToStaff } from "./pushNotify";
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
import { processSubscriptionRenewalsAndReminders } from "../routes/meal-plans";
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
  registerCron("loyalty2-birthday", "0 6 * * *", "Loyalty 2.0: grants birthday rewards at 06:00 IST");
  registerCron("loyalty2-milestones", "10 * * * *", "Loyalty 2.0: hourly milestone sweep (catches config-change crossings)");
  registerCron("loyalty2-streak-expiry", "0 1 * * *", "Loyalty 2.0: resets streaks that exceeded their grace period at 01:00 IST");
  registerCron("loyalty2-double-points", "5 * * * *", "Loyalty 2.0: hourly double-points day announcer");
  registerCron("meal_plan_billing", "0 2 * * *", "Daily 02:00 IST: charges due meal-plan subscriptions, runs dunning ladder, sends renewal reminders, expires ended subscriptions");
  registerCron("auto-reorder", "* * * * *", "Per-restaurant auto-reorder evaluator (IST)");
  registerCron("ai-monthly-allocation", "0 1 * * *", "Credits each tenant's Khana AI monthly allowance on their renewal-cycle anniversary day at 01:00 IST (idempotent per cycle)");
  registerCron("fraud-detect-fast", "5 * * * *", "Hourly fast fraud detectors (discounts, voids, KOT cancels, refunds, free items)");
  registerCron("fraud-detect-slow", "30 2 * * *", "Nightly slow fraud detectors at 02:30 IST (cash, attendance, inventory)");
  registerCron("nightly-demand-forecast", "0 * * * *", "Per-restaurant nightly tomorrow forecast: ticks hourly and runs whenever a restaurant's local time is 02:00 in its configured timezone (gated on plan, feature toggle, history, and credits)");
  registerCron("addon-lifecycle-sweep", "*/15 * * * *", "Expires add-on trials and ended billing periods every 15 min");
  registerCron("health-score-nightly", "0 3 * * *", "Computes nightly Restaurant Health Score (0–100) for all active restaurants at 03:00 IST");
  registerCron("compliance-reminders", "15 8 * * *", "Daily Compliance Manager reminders at 08:15 IST (60/30/15/7/1d before expiry, on day, weekly when overdue)");
  registerCron("gift-card-expiry", "0 1 * * *", "Daily 01:00 IST: marks gift cards whose expiresAt has passed as expired");
  registerCron("orphan-upload-sweep", "0 4 * * *", "Daily 04:00 IST: deletes private-bucket uploads older than 24h with no ACL policy (abandoned presigned uploads)");
  registerCron("complaint-escalation", "*/5 * * * *", "Customer-Quality: SLA-based complaint escalation sweep (every 5 min)");
  registerCron("support-sla-breach", "*/5 * * * *", "Support: SLA breach + escalation matrix sweep (every 5 min) — emails breach alerts to tenant/admins and fires per-priority escalation steps");
  registerCron("repeat-complaint-clusters", "30 3 * * *", "Customer-Quality: nightly rebuild of repeat complaint clusters (03:30 IST)");
  registerCron("abandoned-cart-detect", "*/10 * * * *", "Customer-Quality: detect & flag abandoned carts (every 10 min)");
  registerCron("ops-morning-briefings", "0 8 * * *", "Generates and sends per-restaurant owner morning briefings (Operations Intelligence) at 08:00 IST");
  registerCron("ops-end-of-day", "30 23 * * *", "Computes and persists per-restaurant end-of-day summary into timeline_events (Operations Intelligence) at 23:30 IST");
  registerCron("web-push-scheduled-campaigns", "* * * * *", "Every minute: dispatches Web Push marketing campaigns whose scheduledAt has elapsed");
  registerCron("growth-campaign-dispatch", "* * * * *", "Every minute: launches due Growth Engine campaigns across all channels and advances omnichannel enrollments");

  // Task #516 — Growth Engine campaign dispatcher. Picks up scheduled and
  // recurring campaigns whose run-time has elapsed and launches them on
  // all configured channels, then advances any in-flight omnichannel
  // enrollments through their step plan.
  trackCron("growth_campaign_dispatch", "* * * * *", async () => {
    try {
      const { runDueCampaignsTick, advanceOmnichannelEnrollments } = await import("./campaigns");
      const due = await runDueCampaignsTick();
      const adv = await advanceOmnichannelEnrollments();
      if (due.launched > 0 || adv.sent > 0) {
        logger.info({ launched: due.launched, omnichannelSent: adv.sent }, "[growth] campaign dispatch tick");
      }
    } catch (err) {
      logger.error({ err }, "[growth] campaign dispatch tick failed");
    }
  });

  // Web Push scheduled campaign dispatcher. Runs every minute and sends any
  // campaign whose status is "scheduled" and whose scheduledAt is in the past.
  trackCron("web_push_scheduled_campaigns", "* * * * *", async () => {
    try {
      const { webPushCampaignsTable, webPushSubscriptionsTable, webPushCampaignRecipientsTable } = await import("./db");
      const { sendWebPush } = await import("./webPush");
      const now = new Date();
      const due = await db.select().from(webPushCampaignsTable).where(and(
        eq(webPushCampaignsTable.status, "scheduled"),
        lte(webPushCampaignsTable.scheduledAt, now),
      ));
      for (const c of due) {
        try {
          await db.update(webPushCampaignsTable).set({ status: "sending", updatedAt: new Date() }).where(eq(webPushCampaignsTable.id, c.id));
          const segment = (c.segment ?? {}) as { audience?: "marketing" | "order_updates" | "all" };
          const audience = segment.audience ?? "marketing";
          const conds = [
            eq(webPushSubscriptionsTable.restaurantId, c.restaurantId),
            eq(webPushSubscriptionsTable.status, "active"),
          ];
          if (audience === "marketing") conds.push(eq(webPushSubscriptionsTable.marketingOptIn, true));
          else if (audience === "order_updates") conds.push(eq(webPushSubscriptionsTable.orderUpdatesOptIn, true));
          const subs = await db.select({
            id: webPushSubscriptionsTable.id,
            endpoint: webPushSubscriptionsTable.endpoint,
            p256dh: webPushSubscriptionsTable.p256dh,
            auth: webPushSubscriptionsTable.auth,
            customerId: webPushSubscriptionsTable.customerId,
            marketingOptIn: webPushSubscriptionsTable.marketingOptIn,
            orderUpdatesOptIn: webPushSubscriptionsTable.orderUpdatesOptIn,
            restaurantId: webPushSubscriptionsTable.restaurantId,
            tenantId: webPushSubscriptionsTable.tenantId,
          }).from(webPushSubscriptionsTable).where(and(...conds));
          const out = await sendWebPush({
            restaurantId: c.restaurantId, eventKey: "system.announcement", category: "marketing", campaignId: c.id,
            payload: { title: c.title, body: c.body, url: c.clickUrl ?? undefined, icon: c.iconUrl ?? undefined, image: c.imageUrl ?? undefined },
            subscriptions: subs,
          });
          await db.update(webPushCampaignsTable).set({
            status: out.sent > 0 ? "sent" : "failed",
            sentAt: new Date(), targetedCount: out.total, sentCount: out.sent, failedCount: out.failed, updatedAt: new Date(),
          }).where(eq(webPushCampaignsTable.id, c.id));
          if (subs.length > 0) {
            await db.insert(webPushCampaignRecipientsTable).values(subs.map(s => ({
              campaignId: c.id, subscriptionId: s.id, status: "sent" as const,
            }))).onConflictDoNothing?.();
          }
        } catch (err) {
          logger.error({ err, campaignId: c.id }, "scheduled campaign send failed");
          await db.update(webPushCampaignsTable).set({ status: "failed", updatedAt: new Date() }).where(eq(webPushCampaignsTable.id, c.id));
        }
      }
    } catch (err) {
      logger.error({ err }, "web-push-scheduled-campaigns tick failed");
    }
  });

  // Persisted nightly EOD artifact: at 23:30 IST we compute the day's
  // orders/incidents/panic alerts/closing-checklist summary for every
  // restaurant and write it as a timeline_events row (eventType=
  // end_of_day_report). The on-demand /ops/end-of-day endpoint still
  // works for ad-hoc lookups; this cron guarantees a stored artifact.
  trackCron("ops_end_of_day", "30 23 * * *", async () => {
    try {
      const { db, restaurantsTable, ordersTable, incidentsTable, panicAlertsTable, closingChecklistRunsTable, timelineEventsTable } = await import("./db");
      const { eq, and, sql, gte, lte } = await import("drizzle-orm");
      const today = new Date().toISOString().slice(0, 10);
      const start = new Date(`${today}T00:00:00.000Z`);
      const end = new Date(start.getTime() + 24 * 3600 * 1000);
      const restaurants = await db.select({ id: restaurantsTable.id }).from(restaurantsTable);
      for (const r of restaurants) {
        try {
          const [orders] = await db.select({
            count: sql<number>`count(*)::int`,
            revenue: sql<number>`coalesce(sum(${ordersTable.totalAmount})::float,0)`,
            cancelled: sql<number>`count(*) filter (where ${ordersTable.status} = 'cancelled')::int`,
          }).from(ordersTable).where(and(eq(ordersTable.restaurantId, r.id), gte(ordersTable.createdAt, start), lte(ordersTable.createdAt, end)));
          const [inc] = await db.select({ count: sql<number>`count(*)::int` }).from(incidentsTable)
            .where(and(eq(incidentsTable.restaurantId, r.id), gte(incidentsTable.reportedAt, start), lte(incidentsTable.reportedAt, end)));
          const [panic] = await db.select({ count: sql<number>`count(*)::int` }).from(panicAlertsTable)
            .where(and(eq(panicAlertsTable.restaurantId, r.id), gte(panicAlertsTable.raisedAt, start), lte(panicAlertsTable.raisedAt, end)));
          const [closing] = await db.select({ count: sql<number>`count(*)::int` }).from(closingChecklistRunsTable)
            .where(and(eq(closingChecklistRunsTable.restaurantId, r.id), gte(closingChecklistRunsTable.submittedAt, start), lte(closingChecklistRunsTable.submittedAt, end)));
          const summary = {
            forDate: today,
            orders: orders ?? { count: 0, revenue: 0, cancelled: 0 },
            incidents: inc?.count ?? 0,
            panicAlerts: panic?.count ?? 0,
            closingRuns: closing?.count ?? 0,
          };
          await db.insert(timelineEventsTable).values({
            restaurantId: r.id,
            eventType: "end_of_day_report",
            entity: "end_of_day",
            summary: `EOD ${today}: ${summary.orders.count} orders, ₹${Number(summary.orders.revenue).toFixed(2)}, ${summary.incidents} incidents, ${summary.panicAlerts} panic, ${summary.closingRuns} checklist runs`,
            metadata: summary,
          });
        } catch (err) {
          logger.error({ err, restaurantId: r.id }, "[ops] end-of-day persistence failed");
        }
      }
    } catch (err) {
      logger.error({ err }, "[ops] end-of-day sweep failed");
    }
  });

  trackCron("complaint_escalation", "*/5 * * * *", async () => {
    try {
      const { runComplaintEscalationSweep } = await import("../routes/customer-quality");
      const n = await runComplaintEscalationSweep();
      if (n > 0) logger.info({ fired: n }, "[customer-quality] complaint escalation fired");
    } catch (err) { logger.error({ err }, "[customer-quality] complaint escalation failed"); }
  });

  // Task #436 — Support SLA breach & escalation matrix sweep (every 5 min).
  trackCron("support_sla_breach", "*/5 * * * *", async () => {
    try {
      const { runSupportSlaBreachSweep } = await import("../routes/support-tickets");
      const r = await runSupportSlaBreachSweep();
      if (r.breaches > 0 || r.escalations > 0) {
        logger.info({ ...r }, "[support] SLA breach sweep fired");
      }
    } catch (err) { logger.error({ err }, "[support] SLA breach sweep failed"); }
  });

  trackCron("repeat_complaint_clusters", "30 3 * * *", async () => {
    try {
      const { rebuildClusters } = await import("../routes/customer-quality");
      const n = await rebuildClusters();
      logger.info({ clusters: n }, "[customer-quality] repeat clusters rebuilt");
    } catch (err) { logger.error({ err }, "[customer-quality] repeat clusters failed"); }
  });

  trackCron("abandoned_cart_detect", "*/10 * * * *", async () => {
    try {
      const { detectAbandonedCarts } = await import("../routes/customer-quality");
      const n = await detectAbandonedCarts();
      if (n > 0) logger.info({ carts: n }, "[customer-quality] carts abandoned");
    } catch (err) { logger.error({ err }, "[customer-quality] cart detect failed"); }
  });

  trackCron("ops_morning_briefings", "0 8 * * *", async () => {
    try {
      const { db, restaurantsTable, morningBriefingsTable, ordersTable, incidentsTable, panicAlertsTable, usersTable, attendanceTable, cashRegisterSessionsTable, inventoryItemsTable, opsApprovalsTable, customerFeedbackTable } = await import("./db");
      const { eq, and, sql, gte, lte, inArray } = await import("drizzle-orm");
      const { sendEmail, sendSms } = await import("./notifications");
      const { sendWhatsAppMessage } = await import("./whatsapp");
      const today = new Date().toISOString().slice(0, 10);
      const start = new Date(`${today}T00:00:00.000Z`);
      const prevStart = new Date(start.getTime() - 24 * 3600 * 1000);
      const prevEnd = start;
      const restaurants = await db.select({ id: restaurantsTable.id, name: restaurantsTable.name, email: restaurantsTable.email }).from(restaurantsTable);
      for (const r of restaurants) {
        try {
          const [orders] = await db.select({
            count: sql<number>`count(*)::int`,
            total: sql<number>`coalesce(sum(${ordersTable.totalAmount})::float,0)`,
          }).from(ordersTable).where(and(eq(ordersTable.restaurantId, r.id), gte(ordersTable.createdAt, prevStart), lte(ordersTable.createdAt, prevEnd)));
          const [inc] = await db.select({ count: sql<number>`count(*)::int` }).from(incidentsTable)
            .where(and(eq(incidentsTable.restaurantId, r.id), sql`${incidentsTable.status} IN ('open','investigating')`));
          const [panic] = await db.select({ count: sql<number>`count(*)::int` }).from(panicAlertsTable)
            .where(and(eq(panicAlertsTable.restaurantId, r.id), gte(panicAlertsTable.raisedAt, prevStart)));
          // Cash on hand yesterday (sum of closed session expected totals).
          const [cash] = await db.select({ closed: sql<number>`coalesce(sum(coalesce(${cashRegisterSessionsTable.expectedCash}, 0)::float),0)` })
            .from(cashRegisterSessionsTable)
            .where(and(eq(cashRegisterSessionsTable.restaurantId, r.id), gte(cashRegisterSessionsTable.closedAt, prevStart), lte(cashRegisterSessionsTable.closedAt, prevEnd)))
            .catch(() => [{ closed: 0 }] as Array<{ closed: number }>);
          // Low-stock items (current stock at or below min level).
          const lowStock = await db.select({ id: inventoryItemsTable.id, name: inventoryItemsTable.name, qty: inventoryItemsTable.currentStock, threshold: inventoryItemsTable.minStockLevel })
            .from(inventoryItemsTable)
            .where(and(eq(inventoryItemsTable.restaurantId, r.id), eq(inventoryItemsTable.isActive, true), sql`${inventoryItemsTable.currentStock} <= ${inventoryItemsTable.minStockLevel}`))
            .limit(20)
            .catch(() => [] as Array<{ id: number; name: string; qty: string | null; threshold: string | null }>);
          // Attendance yesterday (count of unique users with clock-in).
          const [att] = await db.select({ present: sql<number>`count(distinct ${attendanceTable.userId})::int` })
            .from(attendanceTable)
            .where(and(eq(attendanceTable.restaurantId, r.id), gte(attendanceTable.clockIn, prevStart), lte(attendanceTable.clockIn, prevEnd)))
            .catch(() => [{ present: 0 }] as Array<{ present: number }>);
          // Pending approvals snapshot.
          const [pend] = await db.select({ count: sql<number>`count(*)::int` })
            .from(opsApprovalsTable)
            .where(and(eq(opsApprovalsTable.restaurantId, r.id), eq(opsApprovalsTable.status, "pending")))
            .catch(() => [{ count: 0 }] as Array<{ count: number }>);
          // Yesterday's negative-rated feedback as a complaint proxy.
          const [comp] = await db.select({ count: sql<number>`count(*)::int` })
            .from(customerFeedbackTable)
            .where(and(eq(customerFeedbackTable.restaurantId, r.id), gte(customerFeedbackTable.createdAt, prevStart), lte(customerFeedbackTable.createdAt, prevEnd), sql`${customerFeedbackTable.rating} IS NOT NULL AND ${customerFeedbackTable.rating} <= 2`))
            .catch(() => [{ count: 0 }] as Array<{ count: number }>);
          // Forecast = today's expected revenue from prior 7-day average.
          const sevenAgo = new Date(start.getTime() - 7 * 24 * 3600 * 1000);
          const [fc] = await db.select({ avg: sql<number>`coalesce(avg(${ordersTable.totalAmount})::float,0)`, count: sql<number>`count(*)::int` })
            .from(ordersTable).where(and(eq(ordersTable.restaurantId, r.id), gte(ordersTable.createdAt, sevenAgo), lte(ordersTable.createdAt, start)))
            .catch(() => [{ avg: 0, count: 0 }] as Array<{ avg: number; count: number }>);
          const forecastRevenue = (fc?.avg ?? 0) * ((fc?.count ?? 0) / 7);
          const summary = {
            yesterdayOrders: orders?.count ?? 0,
            yesterdayRevenue: orders?.total ?? 0,
            openIncidents: inc?.count ?? 0,
            panicAlerts24h: panic?.count ?? 0,
            cashClosed: cash?.closed ?? 0,
            lowStock: lowStock.map(l => ({ id: l.id, name: l.name, qty: l.qty, threshold: l.threshold })),
            attendancePresent: att?.present ?? 0,
            complaints: comp?.count ?? 0,
            pendingApprovals: pend?.count ?? 0,
            forecastRevenueToday: Number(forecastRevenue.toFixed(2)),
          };
          await db.insert(morningBriefingsTable).values({ restaurantId: r.id, forDate: today, summary, sentAt: new Date() });

          // Dispatch to owners via email + WhatsApp + SMS (each best-effort).
          const owners = await db.select({ email: usersTable.email, phone: usersTable.phone })
            .from(usersTable).where(and(eq(usersTable.restaurantId, r.id), eq(usersTable.isActive, true), inArray(usersTable.role, ["owner"])));
          const lowStockList = summary.lowStock.length > 0
            ? `<ul>${summary.lowStock.map(l => `<li>${l.name} — ${l.qty ?? "0"} / ${l.threshold ?? "?"}</li>`).join("")}</ul>`
            : "<i>none</i>";
          const summaryHtml = `<ul>
  <li><b>Yesterday orders:</b> ${summary.yesterdayOrders}</li>
  <li><b>Yesterday revenue:</b> ₹${summary.yesterdayRevenue.toFixed(2)}</li>
  <li><b>Cash closed yesterday:</b> ₹${summary.cashClosed.toFixed(2)}</li>
  <li><b>Attendance yesterday:</b> ${summary.attendancePresent} staff</li>
  <li><b>Complaints yesterday:</b> ${summary.complaints}</li>
  <li><b>Pending approvals:</b> ${summary.pendingApprovals}</li>
  <li><b>Open incidents:</b> ${summary.openIncidents}</li>
  <li><b>Panic alerts (24h):</b> ${summary.panicAlerts24h}</li>
  <li><b>Today forecast revenue:</b> ₹${summary.forecastRevenueToday.toFixed(2)}</li>
  <li><b>Low-stock items:</b> ${lowStockList}</li>
</ul>`;
          const text = `Morning briefing ${today}: ${summary.yesterdayOrders} orders, ₹${summary.yesterdayRevenue.toFixed(2)} rev, cash ₹${summary.cashClosed.toFixed(2)}, ${summary.attendancePresent} present, ${summary.complaints} complaints, ${summary.pendingApprovals} approvals pending, ${summary.openIncidents} incidents, ${summary.panicAlerts24h} panic, forecast ₹${summary.forecastRevenueToday.toFixed(2)}, low-stock ${summary.lowStock.length}.`;
          const emails = [...new Set([r.email, ...owners.map(o => o.email)].filter((e): e is string => !!e))];
          for (const to of emails) {
            sendByTemplateKey("daily_summary_owner", to, {
              name: "team", restaurant: r.name, forDate: today, summaryHtml,
            }, { restaurantId: r.id, recipientType: "user" })
              .catch(err => logger.warn({ err, to }, "[ops] briefing email failed"));
          }
          void text;
          const phones = [...new Set(owners.map(o => o.phone).filter((p): p is string => !!p))];
          for (const to of phones) {
            sendWhatsAppMessage({ restaurantId: r.id, to, body: text }).catch(err => logger.warn({ err, to }, "[ops] briefing whatsapp failed"));
            sendSms({ to, body: text }).catch(err => logger.warn({ err, to }, "[ops] briefing sms failed"));
          }
        } catch (err) {
          logger.error({ err, restaurantId: r.id }, "[ops] morning briefing failed");
        }
      }
    } catch (err) {
      logger.error({ err }, "[ops] morning briefings sweep failed");
    }
  });

  trackCron("orphan_upload_sweep", "0 4 * * *", async () => {
    await runTrackedCron("orphan-upload-sweep", async () => {
      const { sweepOrphanUploads } = await import("./objectStorage");
      const r = await sweepOrphanUploads();
      logger.info({ ...r }, "[uploads] orphan sweep complete");
    }).catch(err => logger.error({ err }, "[uploads] orphan sweep failed"));
  });

  trackCron("gift_card_expiry", "0 1 * * *", async () => {
    await runTrackedCron("gift-card-expiry", async () => {
      const { expireDue } = await import("./giftCards");
      const n = await expireDue(new Date());
      if (n > 0) logger.info({ expired: n }, "[gift-cards] expiry sweep complete");
    }).catch(err => logger.error({ err }, "[gift-cards] expiry sweep failed"));
  });
  registerCron("bakery-shelf-life", "*/30 * * * *", "Per-restaurant bakery shelf-life sweep: marks expired finished-goods batches and emits expiring-soon + cake-booking-due notifications (every 30 min)");

  trackCron("bakery_shelf_life", "*/30 * * * *", async () => {
    try {
      const { runBakeryShelfLifeSweep } = await import("../routes/bakery");
      const r = await runBakeryShelfLifeSweep(new Date());
      if (r.batchAlerts || r.bookingAlerts || r.expired) logger.info({ ...r }, "[bakery] shelf-life sweep complete");
    } catch (err) {
      logger.error({ err }, "[bakery] shelf-life sweep failed");
    }
  });

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

  trackCron("compliance_reminders", "15 8 * * *", async () => {
    try {
      const { runComplianceReminderTick } = await import("../routes/compliance");
      const r = await runComplianceReminderTick(new Date());
      logger.info({ ...r }, "[compliance] reminder sweep complete");
    } catch (err) {
      logger.error({ err }, "[compliance] reminder sweep failed");
    }
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

  // Email Center (Task #414) — every minute: advance sequence steps and
  // dispatch any scheduled marketing campaigns whose time has arrived.
  registerCron("email-center-tick", "* * * * *", "Every minute: advance email sequences and dispatch due scheduled marketing campaigns.");
  trackCron("email_center_tick", "* * * * *", async () => {
    try {
      const { runSequenceTick } = await import("./emailSequences");
      const { runScheduledCampaignTick } = await import("./emailCampaigns");
      await runSequenceTick();
      await runScheduledCampaignTick();
    } catch (err) {
      logger.error({ err }, "[email-center] tick failed");
    }
  });

  registerCron("portion-drift-nightly", "30 3 * * *", "Nightly portion-drift sweep at 03:30 IST: compares expected vs actual ingredient consumption and creates alerts for >10% drift per restaurant.");
  trackCron("portion_drift_nightly", "30 3 * * *", async () => {
    try {
      const { runPortionDriftSweep } = await import("../routes/inventory-control");
      const restaurants = await db.select({ id: restaurantsTable.id }).from(restaurantsTable).where(eq(restaurantsTable.isActive, true));
      let totalCreated = 0;
      for (const r of restaurants) {
        try {
          const s = await runPortionDriftSweep(r.id, 1);
          totalCreated += s.created;
        } catch (err) {
          logger.error({ err, restaurantId: r.id }, "[portion-drift] sweep failed");
        }
      }
      logger.info({ totalCreated, restaurants: restaurants.length }, "[portion-drift] nightly sweep complete");
    } catch (err) {
      logger.error({ err }, "[portion-drift] nightly sweep crashed");
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
        // Route the morning briefing through the Super Admin–editable
        // `daily_summary_owner` template so it renders in the premium layout,
        // honours the configured provider, and shows up in email_logs.
        const topItemsStr = topItemRows.map(r => r.name ?? "Unknown").join(", ") || "—";
        const summaryHtml =
          `<strong>${Number(orderSummary?.cnt ?? 0)}</strong> orders · ` +
          `revenue <strong>₹${Number(orderSummary?.total ?? 0).toFixed(2)}</strong><br/>` +
          `Top items: ${topItemsStr}`;
        for (const owner of owners) {
          if (!owner.email) continue;
          await sendByTemplateKey("daily_summary_owner", owner.email, {
            name: owner.name ?? "there",
            restaurant: restaurant.name,
            forDate: dateStr,
            summaryHtml,
            appName: "Khana Lagao",
          }, { tenantId: restaurant.tenantId ?? null, restaurantId: restaurant.id });
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

  // Loyalty 2.0 — birthday rewards: every day at 06:00 IST, scan opted-in customers
  // whose birthday is within the configured window, grant once per year.
  trackCron("loyalty2_birthday", "0 6 * * *", async () => {
    try {
      const { runBirthdayJob } = await import("./loyalty/jobs");
      await runBirthdayJob();
    } catch (err) { logger.error({ err }, "Loyalty 2.0 birthday job failed"); }
  });

  // Loyalty 2.0 — milestone sweep: hourly, picks up milestones for any customer
  // who crossed a threshold but didn't pass through the order pipeline (e.g. config change).
  trackCron("loyalty2_milestones", "10 * * * *", async () => {
    try {
      const { runMilestoneSweep } = await import("./loyalty/jobs");
      await runMilestoneSweep();
    } catch (err) { logger.error({ err }, "Loyalty 2.0 milestone sweep failed"); }
  });

  // Loyalty 2.0 — streak grace expiry: daily at 01:00 IST, resets streaks that
  // missed their window beyond the grace period.
  trackCron("loyalty2_streak_expiry", "0 1 * * *", async () => {
    try {
      const { runStreakGraceJob } = await import("./loyalty/jobs");
      await runStreakGraceJob();
    } catch (err) { logger.error({ err }, "Loyalty 2.0 streak grace job failed"); }
  });

  // Loyalty 2.0 — double-points day announcer: hourly check posts a notification
  // when a configured rule starts.
  trackCron("loyalty2_double_points", "5 * * * *", async () => {
    try {
      const { runDoublePointsAnnouncer } = await import("./loyalty/jobs");
      await runDoublePointsAnnouncer();
    } catch (err) { logger.error({ err }, "Loyalty 2.0 double-points announcer failed"); }
  });

  trackCron("meal_plan_billing", "0 2 * * *", async () => {
    logger.info("Running meal-plan auto-billing & reminders");
    try {
      const result = await processSubscriptionRenewalsAndReminders();
      logger.info(result, "Meal-plan billing job complete");
    } catch (err) {
      logger.error({ err }, "Meal-plan billing job failed");
    }
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

  // Advanced Growth nightly rollup — recomputes per-restaurant delivery-zone
  // profitability and per-table revenue snapshots at 02:00 IST so the
  // "Zone Profitability" and "Table Optimization" dashboards reflect the
  // previous day's activity without manual recompute.
  registerCron("advanced_growth_rollup", "0 2 * * *", "Recomputes delivery-zone profit & table revenue snapshots per restaurant (daily 02:00 IST)");
  trackCron("advanced_growth_rollup", "0 2 * * *", async () => {
    try {
      const { runAdvancedGrowthNightlyRollup } = await import("../routes/advanced-growth");
      const r = await runAdvancedGrowthNightlyRollup();
      logger.info(r, "Advanced growth nightly rollup completed");
    } catch (err) {
      logger.error({ err }, "[advanced-growth-rollup] failed");
    }
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

  registerCron("staff_task_missed_sweep", "*/5 * * * *", "Detects staff-task scheduled windows that closed without an on-time submission (every 5 min)");
  trackCron("staff_task_missed_sweep", "*/5 * * * *", async () => {
    try {
      const { runStaffTaskMissedSweep } = await import("../routes/staff-tasks");
      const r = await runStaffTaskMissedSweep(new Date());
      if (r.missed > 0) logger.info({ missed: r.missed, checked: r.checked }, "Staff task missed-window sweep");
    } catch (err) {
      logger.error({ err }, "Staff task missed sweep failed");
    }
  });

  registerCron("sop_training_expiry", "0 2 * * *", "Daily SOP & Training certificate expiry sweep at 02:00 IST");
  trackCron("sop_training_expiry", "0 2 * * *", async () => {
    try {
      const { runSopTrainingExpiryTick } = await import("../routes/sop-training");
      await runSopTrainingExpiryTick();
    } catch (err) {
      logger.error({ err }, "SOP & Training expiry tick failed");
    }
  });

  registerCron("event-payment-reminders", "0 9 * * *", "Daily 09:00 IST sweep: marks overdue event milestones, emails/WhatsApps customers about due/overdue payments and tomorrow's events");
  trackCron("event_payment_reminders", "0 9 * * *", async () => {
    try {
      const r = await runEventPaymentReminders();
      logger.info({ ...r }, "[events] payment reminder sweep complete");
    } catch (err) {
      logger.error({ err }, "[events] payment reminder sweep failed");
    }
  });

  registerCron("tiffin_billing_reminders", "30 9 * * *", "Daily 09:30 IST: tiffin invoice reminders T-3, T-0, T+2");
  trackCron("tiffin_billing_reminders", "30 9 * * *", async () => {
    try {
      const { runTiffinBillingRemindersTick } = await import("../routes/tiffin-cron");
      const r = await runTiffinBillingRemindersTick();
      logger.info({ ...r }, "[tiffin] billing reminders tick complete");
    } catch (err) { logger.error({ err }, "[tiffin] billing reminders failed"); }
  });

  registerCron("staff_incentives_recompute", "0 4 * * *", "Daily 04:00 IST: recompute staff incentives for current and previous month for all restaurants");
  trackCron("staff_incentives_recompute", "0 4 * * *", async () => {
    try {
      const { computeIncentivesForPeriod } = await import("./incentives");
      const { staffIncentivesTable, staffIncentiveRulesTable } = await import("./db");
      const restaurants = await db
        .select({ id: restaurantsTable.id })
        .from(restaurantsTable);
      const now = new Date();
      const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
      const periods: Array<{ y: number; m: number }> = [];
      const cy = ist.getUTCFullYear();
      const cm = ist.getUTCMonth() + 1;
      periods.push({ y: cy, m: cm });
      const prev = new Date(Date.UTC(cy, cm - 2, 1));
      periods.push({ y: prev.getUTCFullYear(), m: prev.getUTCMonth() + 1 });
      let totalUpserts = 0;
      for (const r of restaurants) {
        const enabled = await db
          .select({ id: staffIncentiveRulesTable.id })
          .from(staffIncentiveRulesTable)
          .where(and(eq(staffIncentiveRulesTable.restaurantId, r.id), eq(staffIncentiveRulesTable.enabled, true)))
          .limit(1);
        if (enabled.length === 0) continue;
        for (const p of periods) {
          try {
            const computed = await computeIncentivesForPeriod(r.id, p.y, p.m);
            const existing = await db
              .select()
              .from(staffIncentivesTable)
              .where(and(
                eq(staffIncentivesTable.restaurantId, r.id),
                eq(staffIncentivesTable.periodYear, p.y),
                eq(staffIncentivesTable.periodMonth, p.m),
              ));
            const existingByKey = new Map(existing.map((e) => [`${e.userId}:${e.ruleType}`, e]));
            for (const c of computed) {
              const key = `${c.userId}:${c.ruleType}`;
              const ex = existingByKey.get(key);
              const amount = c.amount.toFixed(2);
              if (!ex) {
                await db.insert(staffIncentivesTable).values({
                  restaurantId: r.id,
                  userId: c.userId,
                  periodYear: p.y,
                  periodMonth: p.m,
                  ruleType: c.ruleType,
                  computedAmount: amount,
                  status: "pending",
                  breakdown: c.breakdown,
                });
                totalUpserts++;
              } else if (ex.status === "pending") {
                await db
                  .update(staffIncentivesTable)
                  .set({ computedAmount: amount, breakdown: c.breakdown, updatedAt: new Date() })
                  .where(eq(staffIncentivesTable.id, ex.id));
                totalUpserts++;
              }
            }
          } catch (err) {
            logger.warn({ err, restaurantId: r.id, period: p }, "[incentives] recompute failed");
          }
        }
      }
      logger.info({ totalUpserts }, "[incentives] nightly recompute complete");
    } catch (err) { logger.error({ err }, "[incentives] nightly job failed"); }
  });

  registerCron("tiffin_monthly_invoices", "0 1 1 * *", "Monthly 01:00 IST on the 1st: generate prior-month tiffin invoices");
  trackCron("tiffin_monthly_invoices", "0 1 1 * *", async () => {
    try {
      const { runTiffinMonthlyInvoicesTick } = await import("../routes/tiffin-cron");
      const r = await runTiffinMonthlyInvoicesTick();
      logger.info({ ...r }, "[tiffin] monthly invoice generation complete");
    } catch (err) { logger.error({ err }, "[tiffin] monthly invoices failed"); }
  });

  // Smart P&L (Task #146): warm yesterday's P&L for every active restaurant
  // with the smart_pnl plan flag. We do not persist a snapshot — the
  // computation is fast enough that this just primes any downstream caches
  // and surfaces compute errors in nightly logs rather than at user request.
  registerCron("pnl_nightly_snapshot", "30 3 * * *", "Smart P&L nightly warm-up at 03:30 IST");
  trackCron("pnl_nightly_snapshot", "30 3 * * *", async () => {
    try {
      const { computePnl } = await import("./pnl");
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      const from = new Date(yesterday); from.setHours(0, 0, 0, 0);
      const to = new Date(yesterday); to.setHours(23, 59, 59, 999);
      const restaurants = await db.select({ id: restaurantsTable.id })
        .from(restaurantsTable).where(eq(restaurantsTable.isActive, true));
      let ok = 0, failed = 0;
      for (const r of restaurants) {
        try { await computePnl(r.id, { from, to }); ok++; }
        catch (err) { failed++; logger.warn({ err, restaurantId: r.id }, "[pnl] nightly compute failed"); }
      }
      logger.info({ ok, failed, total: restaurants.length }, "[pnl] nightly warm-up complete");
    } catch (err) { logger.error({ err }, "[pnl] nightly warm-up failed"); }
  });

  // Task #533 — periodic WhatsApp template Meta sync. Every 30 minutes
  // we pull the latest status of all platform-scope templates from Meta
  // (pending → approved/rejected transitions, rate limiting changes,
  // etc). Errors are swallowed and logged; we don't want a Meta outage
  // to take the scheduler down.
  registerCron("whatsapp-template-meta-sync", "*/30 * * * *", "Pulls latest Meta status for all platform WhatsApp templates every 30 min (Task #533).");
  trackCron("whatsapp_template_meta_sync", "*/30 * * * *", async () => {
    try {
      const { syncTemplates } = await import("./whatsapp");
      const out = await syncTemplates("platform", null);
      if (out.synced > 0) {
        logger.info({ synced: out.synced }, "[whatsapp-template-center] periodic meta sync");
      }
    } catch (err) {
      logger.warn({ err }, "[whatsapp-template-center] periodic meta sync failed");
    }
  });

  logger.info("Scheduler started — daily summary at 23:00 IST, trial-expiry at 00:00 IST, loyalty-expiry at 00:30 IST, auto-reorder evaluated every minute (per-restaurant cron, IST), webhook retries every minute, scheduled backups every minute, event payment reminders at 09:00 IST");
}

async function runEventPaymentReminders(): Promise<{ overdueMarked: number; remindersSent: number; eventReminders: number }> {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const dayAfter = new Date(tomorrowStart); dayAfter.setDate(dayAfter.getDate() + 1);
  const sevenDaysOut = new Date(todayStart); sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);

  // 1. Mark pending milestones whose dueDate is in the past as overdue.
  const overdueRows = await db
    .update(eventPaymentScheduleTable)
    .set({ status: "overdue" })
    .where(and(eq(eventPaymentScheduleTable.status, "pending"), lt(eventPaymentScheduleTable.dueDate, todayStart)))
    .returning({ id: eventPaymentScheduleTable.id });

  // 2. Send reminders for milestones due today, tomorrow, or already overdue
  //    that haven't had a reminder sent in the last 24h.
  const dueSoon = await db
    .select()
    .from(eventPaymentScheduleTable)
    .where(
      and(
        sql`${eventPaymentScheduleTable.status} IN ('pending', 'overdue')`,
        lt(eventPaymentScheduleTable.dueDate, sevenDaysOut),
      ),
    );

  let remindersSent = 0;
  for (const m of dueSoon) {
    const recently = m.remindersSentAt && (now.getTime() - new Date(m.remindersSentAt).getTime() < 22 * 60 * 60 * 1000);
    if (recently) continue;
    const due = new Date(m.dueDate);
    const isOverdue = m.status === "overdue" || due < todayStart;
    const isDueToday = due >= todayStart && due < tomorrowStart;
    const isDueTomorrow = due >= tomorrowStart && due < dayAfter;
    if (!isOverdue && !isDueToday && !isDueTomorrow) continue;

    const [booking] = await db.select().from(eventBookingsTable).where(eq(eventBookingsTable.id, m.bookingId));
    if (!booking || booking.status === "cancelled") continue;

    const dueLabel = isOverdue ? "is overdue" : isDueToday ? "is due today" : "is due tomorrow";
    const body = `Hi ${booking.customerName}, the ${m.label} payment of ₹${Number(m.amount).toFixed(2)} for "${booking.title}" on ${new Date(booking.eventDate).toLocaleDateString("en-IN")} ${dueLabel}. Please reach out if you have any questions.`;

    try {
      if (booking.customerEmail) {
        await sendByTemplateKey("payment_reminder", booking.customerEmail, {
          name: booking.customerName,
          currency: "INR",
          amount: Number(m.amount).toFixed(2),
          plan: `${booking.title} — ${m.label}`,
          dueDate: new Date(m.dueDate).toLocaleDateString("en-IN"),
          payUrl: `${process.env.APP_URL ?? ""}/wallet/events/${booking.bookingNumber}`,
        }, { restaurantId: booking.restaurantId, recipientType: "customer" });
      }
      if (booking.customerPhone) {
        await sendWhatsApp({ to: booking.customerPhone, body });
        const [tRow] = await db.select({ tenantId: restaurantsTable.tenantId }).from(restaurantsTable).where(eq(restaurantsTable.id, booking.restaurantId));
        if (tRow?.tenantId) {
          void sendLifecycleSms({
            tenantId: tRow.tenantId, restaurantId: booking.restaurantId, to: booking.customerPhone,
            eventKey: "event_payment_reminder",
            variables: {
              name: booking.customerName, eventName: booking.title, milestone: m.label,
              amount: Number(m.amount).toFixed(2), currency: "INR", dueLabel,
              payUrl: `${process.env.APP_URL ?? ""}/wallet/events/${booking.bookingNumber}`,
            },
          });
        }
      }
      await db.update(eventPaymentScheduleTable).set({ remindersSentAt: now }).where(eq(eventPaymentScheduleTable.id, m.id));
      remindersSent++;
    } catch (err) {
      logger.warn({ err, milestoneId: m.id }, "[events] reminder send failed");
    }
  }

  // 3. "Event tomorrow" notice for confirmed/in-progress bookings whose event is in the next 24h.
  const upcoming = await db
    .select()
    .from(eventBookingsTable)
    .where(
      and(
        gte(eventBookingsTable.eventDate, tomorrowStart),
        lt(eventBookingsTable.eventDate, dayAfter),
        sql`${eventBookingsTable.status} IN ('confirmed', 'in_progress')`,
      ),
    );

  let eventReminders = 0;
  for (const b of upcoming) {
    const body = `Hi ${b.customerName}, this is a friendly reminder that your ${b.type} "${b.title}" is scheduled for ${new Date(b.eventDate).toLocaleString("en-IN")} at ${b.venue ?? "our venue"}. We look forward to hosting you!`;
    try {
      if (b.customerEmail) {
        await sendByTemplateKey("event_booking_confirmed", b.customerEmail, {
          name: b.customerName,
          eventName: b.title,
          eventDate: new Date(b.eventDate).toLocaleString("en-IN"),
          restaurant: b.venue ?? "our venue",
        }, { restaurantId: b.restaurantId, recipientType: "customer" });
      }
      if (b.customerPhone) {
        await sendWhatsApp({ to: b.customerPhone, body });
        const [tRow] = await db.select({ tenantId: restaurantsTable.tenantId }).from(restaurantsTable).where(eq(restaurantsTable.id, b.restaurantId));
        if (tRow?.tenantId) {
          void sendLifecycleSms({
            tenantId: tRow.tenantId, restaurantId: b.restaurantId, to: b.customerPhone,
            eventKey: "event_booking_confirmed",
            variables: {
              name: b.customerName, eventName: b.title,
              eventDate: new Date(b.eventDate).toLocaleString("en-IN"),
              restaurant: b.venue ?? "our venue",
            },
          });
        }
      }
      eventReminders++;
    } catch (err) {
      logger.warn({ err, bookingId: b.id }, "[events] event reminder send failed");
    }
  }

  return { overdueMarked: overdueRows.length, remindersSent, eventReminders };
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
      const date = r.scheduledAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      const time = r.scheduledAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      const reminderText = `Hi ${r.guestName}, this is a friendly reminder of your reservation at ${restaurant?.name ?? "our restaurant"} for ${r.partySize} on ${date} at ${time}. See you soon!`;
      if (r.guestEmail) {
        await sendByTemplateKey("reservation_reminder", r.guestEmail, {
          name: r.guestName,
          restaurant: restaurant?.name ?? "our restaurant",
          date, time, guests: r.partySize,
        }, { restaurantId: r.restaurantId, recipientType: "customer" }).catch(() => {});
      }
      if (r.guestPhone) {
        await sendWhatsApp({ to: r.guestPhone, body: reminderText }).catch(() => {});
        const [tRow] = await db.select({ tenantId: restaurantsTable.tenantId }).from(restaurantsTable).where(eq(restaurantsTable.id, r.restaurantId));
        if (tRow?.tenantId) {
          void sendLifecycleSms({
            tenantId: tRow.tenantId, restaurantId: r.restaurantId, to: r.guestPhone,
            eventKey: "reservation_reminder",
            variables: { name: r.guestName, restaurant: restaurant?.name ?? "our restaurant", date, time, guests: r.partySize },
          });
        }
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
