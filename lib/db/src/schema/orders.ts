import { pgTable, text, serial, timestamp, integer, boolean, decimal, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { floorTablesTable } from "./tables";
import { menuItemsTable } from "./menu";
import { usersTable } from "./users";
import { kitchensTable } from "./kitchens";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  tableId: integer("table_id").references(() => floorTablesTable.id),
  waiterId: integer("waiter_id").references(() => usersTable.id),
  orderNumber: text("order_number").notNull(),
  orderType: text("order_type").notNull().default("dine_in"),
  status: text("status").notNull().default("pending"),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  paymentMethod: text("payment_method"),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0.00"),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  serviceCharge: decimal("service_charge", { precision: 10, scale: 2 }).notNull().default("0.00"),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  notes: text("notes"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  customerId: integer("customer_id"),
  isPriority: boolean("is_priority").notNull().default(false),
  stripePaymentId: text("stripe_payment_id"),
  couponCode: text("coupon_code"),
  loyaltyPointsRedeemed: integer("loyalty_points_redeemed").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const orderItemsTable = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id),
  menuItemName: text("menu_item_name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("pending"),
  startedAt: timestamp("started_at"),
  readyAt: timestamp("ready_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const orderItemModifiersTable = pgTable("order_item_modifiers", {
  id: serial("id").primaryKey(),
  orderItemId: integer("order_item_id").notNull().references(() => orderItemsTable.id),
  modifierName: text("modifier_name").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull().default("0.00"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const kitchenTicketsTable = pgTable("kitchen_tickets", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  kitchenId: integer("kitchen_id").references(() => kitchensTable.id),
  status: text("status").notNull().default("new"),
  isPriority: boolean("is_priority").notNull().default(false),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  expectedPrepMinutes: integer("expected_prep_minutes"),
  expectedReadyAt: timestamp("expected_ready_at"),
  delayAlertCount: integer("delay_alert_count").notNull().default(0),
  lastDelayAlertAt: timestamp("last_delay_alert_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const ticketDelayAlertsTable = pgTable("ticket_delay_alerts", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => kitchenTicketsTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  kitchenId: integer("kitchen_id").references(() => kitchensTable.id),
  thresholdMinutes: integer("threshold_minutes").notNull(),
  delayedByMinutes: integer("delayed_by_minutes").notNull(),
  expectedReadyAt: timestamp("expected_ready_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byRestaurant: index("ticket_delay_alerts_restaurant_idx").on(t.restaurantId, t.createdAt),
  byTicket: index("ticket_delay_alerts_ticket_idx").on(t.ticketId),
}));

export type TicketDelayAlert = typeof ticketDelayAlertsTable.$inferSelect;

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;

export const insertOrderItemSchema = createInsertSchema(orderItemsTable).omit({ id: true, createdAt: true });
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type OrderItem = typeof orderItemsTable.$inferSelect;

export const insertKitchenTicketSchema = createInsertSchema(kitchenTicketsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertKitchenTicket = z.infer<typeof insertKitchenTicketSchema>;
export type KitchenTicket = typeof kitchenTicketsTable.$inferSelect;

// Per-discount ledger for an order. Source of truth for the order's total discount.
// `type` distinguishes manual (percentage / flat / item) from system-applied (coupon / loyalty).
// `scope` = 'order' applies against subtotal; 'item' applies to a single orderItemId.
// `value` is the input the cashier entered (% or rupees); `amount` is the resolved rupee discount.
// `recordedByUserId` is the cashier; `approvedByUserId` is set when manager-PIN approval was required.
export const orderDiscountsTable = pgTable("order_discounts", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  type: text("type").notNull(), // 'percentage' | 'flat' | 'item' | 'coupon' | 'loyalty'
  scope: text("scope").notNull().default("order"), // 'order' | 'item'
  orderItemId: integer("order_item_id").references(() => orderItemsTable.id),
  value: decimal("value", { precision: 10, scale: 2 }).notNull().default("0.00"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  reason: text("reason").notNull(),
  couponCode: text("coupon_code"),
  recordedByUserId: integer("recorded_by_user_id").references(() => usersTable.id),
  approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("order_discounts_order_idx").on(t.orderId),
  index("order_discounts_restaurant_created_idx").on(t.restaurantId, t.createdAt),
]);

export const insertOrderDiscountSchema = createInsertSchema(orderDiscountsTable).omit({ id: true, createdAt: true });
export type InsertOrderDiscount = z.infer<typeof insertOrderDiscountSchema>;
export type OrderDiscount = typeof orderDiscountsTable.$inferSelect;
