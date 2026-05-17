import { pgTable, text, serial, timestamp, integer, boolean, decimal, index, jsonb } from "drizzle-orm/pg-core";
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
  // Delivery aggregator tagging (Task #148): which aggregator the order
  // came through and the external id we'll match payout-sheet rows on.
  aggregatorName: text("aggregator_name"),
  aggregatorOrderId: text("aggregator_order_id"),
  // Hotel mode linkage — set when order is taken by room or fired from a
  // banquet hall. Both nullable so non-hotel outlets are unaffected.
  hotelStayId: integer("hotel_stay_id"),
  banquetEventId: integer("banquet_event_id"),
  // Cloud Kitchen (Task #150): brand/channel/SLA/packaging metadata
  brandId: integer("brand_id"),
  channelKey: text("channel_key"),
  channelExternalOrderId: text("channel_external_order_id"),
  channelCommissionPct: decimal("channel_commission_pct", { precision: 5, scale: 2 }),
  packagingSnapshot: jsonb("packaging_snapshot").$type<Array<{ packagingItemId: number; name: string; quantity: number; costPerUnit: string }>>(),
  slaTargetAt: timestamp("sla_target_at"),
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
  modifierId: integer("modifier_id"),
  modifierGroupId: integer("modifier_group_id"),
  modifierName: text("modifier_name").notNull(),
  groupName: text("group_name"),
  quantity: integer("quantity").notNull().default(1),
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
  brandId: integer("brand_id"),
  channelKey: text("channel_key"),
  packagingNotes: text("packaging_notes"),
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

// Audit trail for every discount that required (or bypassed) manager approval.
// `method` records HOW it was approved: 'auto' = under threshold/cap (no
// approval needed), 'pin' = manager PIN, 'otp' = manager OTP delivered via SMS.
// `requestedByRole` snapshots the cashier/waiter's role at request time so
// reports can show approval rates per role even if the user is later edited.
export const discountApprovalsTable = pgTable("discount_approvals", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  discountId: integer("discount_id").references(() => orderDiscountsTable.id),
  type: text("type").notNull(), // mirrors order_discounts.type
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  method: text("method").notNull(), // 'auto' | 'pin' | 'otp'
  requestedByUserId: integer("requested_by_user_id").references(() => usersTable.id),
  requestedByRole: text("requested_by_role"),
  approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id),
  otpId: integer("otp_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("discount_approvals_restaurant_created_idx").on(t.restaurantId, t.createdAt),
  index("discount_approvals_order_idx").on(t.orderId),
]);

export type DiscountApproval = typeof discountApprovalsTable.$inferSelect;

// Short-lived numeric OTPs for manager approval of high-value discounts.
// `code` is stored hashed; expiry defaults to 5 minutes from issue.
// `consumedAt` is set when the OTP successfully approves a discount, so the
// same code can never be replayed.
export const managerOtpsTable = pgTable("manager_otps", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  purpose: text("purpose").notNull().default("discount_approval"),
  codeHash: text("code_hash").notNull(),
  recipientPhone: text("recipient_phone"),
  recipientUserId: integer("recipient_user_id").references(() => usersTable.id),
  requestedByUserId: integer("requested_by_user_id").references(() => usersTable.id),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  consumedByUserId: integer("consumed_by_user_id").references(() => usersTable.id),
  attemptCount: integer("attempt_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("manager_otps_restaurant_idx").on(t.restaurantId, t.createdAt),
]);

export type ManagerOtp = typeof managerOtpsTable.$inferSelect;
