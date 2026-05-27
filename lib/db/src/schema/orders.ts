import { pgTable, text, serial, timestamp, integer, boolean, decimal, index, jsonb, uniqueIndex, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { floorTablesTable, tableSessionsTable } from "./tables";
import { menuItemsTable } from "./menu";
import { usersTable } from "./users";
import { kitchensTable } from "./kitchens";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  // Which physical outlet/branch this order belongs to. Nullable so legacy
  // orders predating multi-branch support stay readable; new orders should
  // always carry the active branch so dashboard/reports can scope by outlet.
  branchId: integer("branch_id"),
  tableId: integer("table_id").references(() => floorTablesTable.id),
  waiterId: integer("waiter_id").references(() => usersTable.id),
  orderNumber: text("order_number").notNull(),
  // Task #647 — Dual order numbering. `orderDisplayNumber` is the short
  // per-day, per-outlet, per-type ticket number guests/staff see and call
  // out (e.g. "DN-023", "TK-024"). `orderInternalNumber` is the permanent
  // globally-unique id used in payments/audit/exports — never resets.
  // `dailySequence`/`orderTypePrefix`/`outletCode`/`businessDate` are
  // stored so we can rebuild the display number deterministically and
  // unique-index sequences by (restaurant, branch, businessDate, prefix).
  orderDisplayNumber: text("order_display_number"),
  orderInternalNumber: text("order_internal_number"),
  dailySequence: integer("daily_sequence"),
  orderTypePrefix: text("order_type_prefix"),
  outletCode: text("outlet_code"),
  businessDate: date("business_date"),
  orderType: text("order_type").notNull().default("dine_in"),
  status: text("status").notNull().default("pending"),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  paymentMethod: text("payment_method"),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0.00"),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  serviceCharge: decimal("service_charge", { precision: 10, scale: 2 }).notNull().default("0.00"),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  // Tip captured at payment time. Recorded on the order so reports/receipts
  // can show subtotal+tax+service+tip-totals and so post-payment adjustments
  // have a single source of truth.
  tipAmount: decimal("tip_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  notes: text("notes"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  customerId: integer("customer_id"),
  isPriority: boolean("is_priority").notNull().default(false),
  stripePaymentId: text("stripe_payment_id"),
  // Task #587 — When the customer chose "Pay Online", these stash the
  // resolved online sub-method (platform_gateway / own_gateway / manual_upi
  // and the gateway code) so the downstream `/pay` confirmation can write
  // the payments ledger row with the correct payment_source/gateway_code
  // without re-resolving against admin settings.
  paymentSource: text("payment_source"),
  paymentGatewayCode: text("payment_gateway_code"),
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
  // Curbside pickup (Task #423): vehicle/parking details captured at checkout
  // and arrival/handover timestamps tracked through the dedicated queue.
  vehicleColor: text("vehicle_color"),
  vehicleModel: text("vehicle_model"),
  vehicleNumber: text("vehicle_number"),
  parkingSpot: text("parking_spot"),
  curbsideAcceptedAt: timestamp("curbside_accepted_at"),
  curbsideArrivedAt: timestamp("curbside_arrived_at"),
  curbsideHandedOverAt: timestamp("curbside_handed_over_at"),
  // Direct online ordering (Task #432): scheduled pickup/delivery time, delivery
  // address, and delivery fee charged. Null for dine-in and immediate orders.
  scheduledFor: timestamp("scheduled_for"),
  deliveryAddress: text("delivery_address"),
  // Geocoded coordinates for the delivery address. Used by the rider mobile
  // map tab to plot pins and connect them with a route line. Nullable until
  // an order has been geocoded (older orders, address-only entries).
  deliveryLat: decimal("delivery_lat", { precision: 10, scale: 7 }),
  deliveryLng: decimal("delivery_lng", { precision: 10, scale: 7 }),
  deliveryFee: decimal("delivery_fee", { precision: 10, scale: 2 }).notNull().default("0.00"),
  // Task #601 — Running order / single bill per dine-in table. When this
  // order rolls up multiple KOT rounds against one table session, the
  // session id is set here and `isRunningOrder` is true until the final
  // bill is paid. `billGeneratedAt`/`paidAt`/`closedAt` capture the
  // running-order lifecycle timestamps so reports can distinguish "items
  // still being added" from "bill printed, awaiting payment".
  tableSessionId: integer("table_session_id"),
  isRunningOrder: boolean("is_running_order").notNull().default(false),
  billGeneratedAt: timestamp("bill_generated_at"),
  paidAt: timestamp("paid_at"),
  closedAt: timestamp("closed_at"),
  // Task #674 — Frozen snapshot of the bill at generate-bill / payment time.
  // Used as the single source of truth for reprints, WhatsApp / email shares,
  // and the public QR receipt link. When set, every renderer must read from
  // here instead of recomputing — that's what makes reprints byte-identical
  // even after menu prices or restaurant settings change later.
  billSnapshot: jsonb("bill_snapshot").$type<Record<string, unknown>>(),
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
  status: text("status").notNull().default("pending"), // pending | preparing | ready | served | cancelled
  startedAt: timestamp("started_at"),
  readyAt: timestamp("ready_at"),
  // Task #601 — Round number within the parent running order (1-based) and
  // the KOT batch id this item was fired in. Items added later for the same
  // order get a fresh batch each time so the kitchen prints/screens know
  // which items are new vs. already-being-prepared.
  kotBatchId: integer("kot_batch_id"),
  addedRoundNumber: integer("added_round_number").notNull().default(1),
  addedAt: timestamp("added_at").notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at"),
  cancelledByUserId: integer("cancelled_by_user_id"),
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
  // Task #651 — links each ticket back to the KOT round that produced it,
  // so status mirroring onto order_items can be scoped to that round only
  // (preventing later-round items at the same kitchen from being promoted
  // prematurely when an earlier ticket is marked ready/served).
  kotBatchId: integer("kot_batch_id"),
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

// Task #601 — One row per KOT round fired against a running order.
// `roundNumber` increments per order (1 = initial), `createdFor` records
// whether the round added new items, modified existing items, or cancelled
// items. Linked tickets remain in `kitchen_tickets` (1 batch -> many
// tickets, one per kitchen). Items reference the batch via `kot_batch_id`.
export const kotBatchesTable = pgTable("kot_batches", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  tableSessionId: integer("table_session_id").references(() => tableSessionsTable.id),
  roundNumber: integer("round_number").notNull().default(1),
  createdFor: text("created_for").notNull().default("new"), // new | modified | cancelled
  status: text("status").notNull().default("fired"),         // fired | acknowledged | cancelled
  firedByUserId: integer("fired_by_user_id").references(() => usersTable.id),
  source: text("source").notNull().default("pos"),            // pos | qr | manager | system
  notes: text("notes"),
  itemSnapshot: jsonb("item_snapshot").$type<Array<{
    orderItemId: number;
    menuItemId: number;
    menuItemName: string;
    quantity: number;
    notes?: string | null;
    action?: "new" | "modified" | "cancelled";
    previousQuantity?: number | null;
  }>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => [
  index("kot_batches_order_idx").on(t.orderId, t.roundNumber),
  index("kot_batches_restaurant_idx").on(t.restaurantId, t.createdAt),
]);

export type KotBatch = typeof kotBatchesTable.$inferSelect;
export type InsertKotBatch = typeof kotBatchesTable.$inferInsert;

// Task #647 — Per-outlet daily counters used to mint the short
// `orderDisplayNumber` (e.g. DN-023). One row per
// (restaurantId, branchId, businessDate, orderTypePrefix). The atomic
// `UPDATE … SET lastSequence = lastSequence + 1 RETURNING lastSequence`
// pattern (or INSERT … ON CONFLICT … DO UPDATE) guarantees no duplicate
// numbers even under concurrent inserts on the same outlet+day+type.
// `branchId` defaults to 0 (sentinel for "no branch" / legacy) so the
// unique index treats unbranched outlets as a single bucket.
export const orderSequencesTable = pgTable("order_sequences", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  branchId: integer("branch_id").notNull().default(0),
  businessDate: date("business_date").notNull(),
  orderTypePrefix: text("order_type_prefix").notNull(),
  lastSequence: integer("last_sequence").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => [
  uniqueIndex("order_sequences_outlet_day_type_unique").on(
    t.restaurantId, t.branchId, t.businessDate, t.orderTypePrefix,
  ),
]);

export type OrderSequence = typeof orderSequencesTable.$inferSelect;
export type InsertOrderSequence = typeof orderSequencesTable.$inferInsert;
