import cron from "node-cron";
import { db } from "./db";
import { eq, and, gte, lte, lt, sum, count, desc } from "drizzle-orm";
import { ordersTable, menuItemsTable, orderItemsTable, restaurantsTable, usersTable, tenantsTable, notificationsTable } from "../lib/db";
import { sendEmail, dailySummaryEmail } from "./notifications";
import { logger } from "./logger";

export function startScheduler(): void {
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
