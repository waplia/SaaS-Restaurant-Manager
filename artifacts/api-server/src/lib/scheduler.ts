import cron from "node-cron";
import { db } from "./db";
import { eq, and, gte, lte, lt, sum, count, desc, sql, notInArray } from "drizzle-orm";
import { ordersTable, menuItemsTable, orderItemsTable, restaurantsTable, usersTable, tenantsTable, notificationsTable, paymentsTable } from "../lib/db";
import { sendEmail, dailySummaryEmail } from "./notifications";
import { logger } from "./logger";

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

  cron.schedule("0 23 * * *", async () => {
    logger.info("Running daily sales summary job");
    try {
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
    } catch (err) {
      logger.error({ err }, "Daily summary job failed");
    }
  }, { timezone: "Asia/Kolkata" });

  cron.schedule("0 0 * * *", async () => {
    logger.info("Running trial-expiry enforcement job");
    try {
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
            message: "Your free trial has ended. Upgrade to a paid plan to continue using TableTrack.",
          }).catch(() => {});

          const owners = await db.select({ email: usersTable.email, name: usersTable.name })
            .from(usersTable)
            .where(and(eq(usersTable.restaurantId, restaurant.id), eq(usersTable.role, "owner"), eq(usersTable.isActive, true)));

          for (const owner of owners) {
            if (owner.email) {
              await sendEmail({
                to: owner.email,
                subject: `Your TableTrack trial for ${restaurant.name} has expired`,
                html: `<p>Hi ${owner.name ?? "there"},</p><p>Your 14-day free trial for <strong>${restaurant.name}</strong> on TableTrack has expired.</p><p>Upgrade now to continue managing your restaurant without interruption.</p><p><a href="${process.env.VITE_APP_URL ?? "https://tabletrack.app"}/settings/subscription" style="background:#f97316;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:8px">Upgrade Now</a></p>`,
                text: `Your TableTrack trial for ${restaurant.name} has expired. Visit your subscription settings to upgrade.`,
              }).catch(console.error);
            }
          }
        }
      }

      logger.info({ count: expiredTenants.length }, "Trial-expiry job complete");
    } catch (err) {
      logger.error({ err }, "Trial-expiry job failed");
    }
  }, { timezone: "Asia/Kolkata" });

  logger.info("Scheduler started — daily summary at 23:00 IST, trial-expiry check at 00:00 IST");
}
