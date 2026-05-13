import cron from "node-cron";
import { db } from "./db";
import { eq, and, gte, lte, sum, count, desc } from "drizzle-orm";
import { ordersTable, menuItemsTable, orderItemsTable, restaurantsTable, usersTable } from "../lib/db";
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

  logger.info("Scheduler started — daily summary at 23:00 IST");
}
