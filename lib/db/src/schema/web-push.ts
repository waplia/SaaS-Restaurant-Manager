import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";
import { restaurantsTable } from "./restaurants";

/**
 * Browser Web Push subscriptions for QR-menu diners. Keyed by endpoint
 * (globally unique per browser+origin). Optionally linked to an order so we
 * can fan out per-order status updates and clean up on completion.
 */
export const webPushSubscriptionsTable = pgTable(
  "web_push_subscriptions",
  {
    id: serial("id").primaryKey(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }),
    tableId: integer("table_id"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastSentAt: timestamp("last_sent_at"),
  },
  (t) => [
    uniqueIndex("web_push_subscriptions_endpoint_idx").on(t.endpoint),
    index("web_push_subscriptions_order_idx").on(t.orderId),
    index("web_push_subscriptions_restaurant_idx").on(t.restaurantId),
  ],
);

export type WebPushSubscription = typeof webPushSubscriptionsTable.$inferSelect;
export type InsertWebPushSubscription = typeof webPushSubscriptionsTable.$inferInsert;
