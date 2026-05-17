import {
  pgTable, text, serial, timestamp, integer, boolean, decimal, date, index, uniqueIndex, jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { customersTable } from "./customers";
import { usersTable } from "./users";
import { ordersTable } from "./orders";
import { floorTablesTable } from "./tables";

export const customerGeoPointsTable = pgTable("customer_geo_points", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "cascade" }),
  label: text("label"),
  lat: decimal("lat", { precision: 9, scale: 6 }).notNull(),
  lng: decimal("lng", { precision: 9, scale: 6 }).notNull(),
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("customer_geo_points_rest_idx").on(t.restaurantId),
}));

export const festivalEventsTable = pgTable("festival_events", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  eventDate: date("event_date").notNull(),
  region: text("region"),
  category: text("category"),
  suggestedCampaign: text("suggested_campaign"),
  isDismissed: boolean("is_dismissed").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byDate: index("festival_events_date_idx").on(t.eventDate),
  byRest: index("festival_events_rest_idx").on(t.restaurantId),
}));

export const offerConflictChecksTable = pgTable("offer_conflict_checks", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  runBy: integer("run_by").references(() => usersTable.id),
  conflicts: jsonb("conflicts").notNull().default([]),
  conflictCount: integer("conflict_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("offer_conflict_checks_rest_idx").on(t.restaurantId, t.createdAt),
}));

export const marginFloorsTable = pgTable("margin_floors", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  scope: text("scope").notNull().default("global"),
  scopeId: integer("scope_id"),
  minMarginPct: decimal("min_margin_pct", { precision: 5, scale: 2 }).notNull(),
  action: text("action").notNull().default("warn"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("margin_floors_rest_idx").on(t.restaurantId),
}));

export const upsellScriptEventsTable = pgTable("upsell_script_events", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  waiterUserId: integer("waiter_user_id").references(() => usersTable.id),
  orderId: integer("order_id").references(() => ordersTable.id),
  scriptKey: text("script_key").notNull(),
  suggestedItem: text("suggested_item"),
  outcome: text("outcome").notNull(),
  amountRupees: decimal("amount_rupees", { precision: 10, scale: 2 }).default("0.00"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("upsell_script_events_rest_idx").on(t.restaurantId, t.createdAt),
  byWaiter: index("upsell_script_events_waiter_idx").on(t.waiterUserId),
}));

export const takeawayQueueTicketsTable = pgTable("takeaway_queue_tickets", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  customerName: text("customer_name").notNull(),
  phone: text("phone"),
  partySize: integer("party_size").notNull().default(1),
  ticketNumber: integer("ticket_number").notNull(),
  status: text("status").notNull().default("waiting"),
  estimatedMinutes: integer("estimated_minutes").notNull().default(15),
  notes: text("notes"),
  notifiedAt: timestamp("notified_at"),
  fulfilledAt: timestamp("fulfilled_at"),
  cancelledAt: timestamp("cancelled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("takeaway_queue_rest_idx").on(t.restaurantId, t.status),
}));

export const preorderSlotsTable = pgTable("preorder_slots", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  slotDate: date("slot_date").notNull(),
  startMinutes: integer("start_minutes").notNull(),
  endMinutes: integer("end_minutes").notNull(),
  capacity: integer("capacity").notNull().default(10),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byRestDate: index("preorder_slots_rest_date_idx").on(t.restaurantId, t.slotDate),
}));

export const preorderBookingsTable = pgTable("preorder_bookings", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  slotId: integer("slot_id").notNull().references(() => preorderSlotsTable.id, { onDelete: "cascade" }),
  customerName: text("customer_name").notNull(),
  phone: text("phone"),
  orderId: integer("order_id").references(() => ordersTable.id),
  status: text("status").notNull().default("confirmed"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("preorder_bookings_rest_idx").on(t.restaurantId),
  bySlot: index("preorder_bookings_slot_idx").on(t.slotId),
}));

export const deliveryZonesTable = pgTable("delivery_zones", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  pincodes: text("pincodes"),
  baseFeeRupees: decimal("base_fee_rupees", { precision: 10, scale: 2 }).notNull().default("0.00"),
  minOrderRupees: decimal("min_order_rupees", { precision: 10, scale: 2 }).notNull().default("0.00"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("delivery_zones_rest_idx").on(t.restaurantId),
}));

export const deliveryZoneMetricsTable = pgTable("delivery_zone_metrics", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  zoneId: integer("zone_id").notNull().references(() => deliveryZonesTable.id, { onDelete: "cascade" }),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  orderCount: integer("order_count").notNull().default(0),
  revenueRupees: decimal("revenue_rupees", { precision: 12, scale: 2 }).notNull().default("0.00"),
  costRupees: decimal("cost_rupees", { precision: 12, scale: 2 }).notNull().default("0.00"),
  profitRupees: decimal("profit_rupees", { precision: 12, scale: 2 }).notNull().default("0.00"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byZone: index("delivery_zone_metrics_zone_idx").on(t.zoneId, t.periodStart),
}));

export const tableMetricsSnapshotsTable = pgTable("table_metrics_snapshots", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  tableId: integer("table_id").notNull().references(() => floorTablesTable.id, { onDelete: "cascade" }),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  revenueRupees: decimal("revenue_rupees", { precision: 12, scale: 2 }).notNull().default("0.00"),
  coverCount: integer("cover_count").notNull().default(0),
  avgTurnMinutes: integer("avg_turn_minutes").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("table_metrics_snapshots_rest_idx").on(t.restaurantId, t.periodStart),
}));

export const tipSplitRulesTable = pgTable("tip_split_rules", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  sharePct: decimal("share_pct", { precision: 5, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byRest: uniqueIndex("tip_split_rules_rest_role_uq").on(t.restaurantId, t.role),
}));

export const tipPoolsTable = pgTable("tip_pools", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  totalRupees: decimal("total_rupees", { precision: 12, scale: 2 }).notNull().default("0.00"),
  status: text("status").notNull().default("open"),
  // Pooling rule for this pool: 'equal' splits totalRupees evenly across
  // contributing staff; 'role_weighted' applies tip_split_rules percentages
  // by role. Resolved from restaurants.tip_policy at distribute time when
  // null.
  splitMethod: text("split_method").notNull().default("role_weighted"),
  distributedAt: timestamp("distributed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("tip_pools_rest_idx").on(t.restaurantId, t.periodStart),
}));

export const tipPoolEntriesTable = pgTable("tip_pool_entries", {
  id: serial("id").primaryKey(),
  poolId: integer("pool_id").notNull().references(() => tipPoolsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sharePct: decimal("share_pct", { precision: 5, scale: 2 }).notNull(),
  amountRupees: decimal("amount_rupees", { precision: 10, scale: 2 }).notNull().default("0.00"),
  payrollItemId: integer("payroll_item_id"),
  // Source attribution for pool entries: 'order' tip captured at payment,
  // 'cash_declaration' tip declared by server at shift end, 'distribution'
  // amount allocated by a distribute sweep, 'adjustment' manual adjustment.
  sourceType: text("source_type").notNull().default("distribution"),
  sourceOrderId: integer("source_order_id"),
  sourceShiftId: integer("source_shift_id"),
  tableId: integer("table_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byPool: index("tip_pool_entries_pool_idx").on(t.poolId),
  byUser: index("tip_pool_entries_user_idx").on(t.restaurantId, t.userId, t.createdAt),
}));

// Audit trail for post-payment tip adjustments. Captures who changed the
// amount, why, and the before/after values so payroll/finance can defend
// any pool entry that doesn't match the original capture.
export const tipAdjustmentsTable = pgTable("tip_adjustments", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  entryId: integer("entry_id").references(() => tipPoolEntriesTable.id, { onDelete: "cascade" }),
  orderId: integer("order_id"),
  poolId: integer("pool_id"),
  userId: integer("user_id").references(() => usersTable.id),
  previousAmount: decimal("previous_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  newAmount: decimal("new_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  delta: decimal("delta", { precision: 10, scale: 2 }).notNull().default("0.00"),
  reason: text("reason").notNull(),
  adjustedByUserId: integer("adjusted_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("tip_adjustments_rest_idx").on(t.restaurantId, t.createdAt),
  byEntry: index("tip_adjustments_entry_idx").on(t.entryId),
}));

// End-of-shift cash tip declarations from servers. Each declaration creates
// a tip_pool_entry into the day's open pool with sourceType='cash_declaration'.
export const cashTipDeclarationsTable = pgTable("cash_tip_declarations", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  shiftId: integer("shift_id"),
  shiftDate: date("shift_date").notNull(),
  amountRupees: decimal("amount_rupees", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"),
  poolEntryId: integer("pool_entry_id"),
  declaredAt: timestamp("declared_at").notNull().defaultNow(),
}, (t) => ({
  byRestDate: index("cash_tip_declarations_rest_date_idx").on(t.restaurantId, t.shiftDate),
  byUser: index("cash_tip_declarations_user_idx").on(t.userId, t.shiftDate),
}));

export const leaderboardSnapshotsTable = pgTable("leaderboard_snapshots", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  periodKey: text("period_key").notNull(),
  payload: jsonb("payload").notNull(),
  capturedAt: timestamp("captured_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("leaderboard_snapshots_rest_idx").on(t.restaurantId, t.capturedAt),
}));

export const insertCustomerGeoPointSchema = createInsertSchema(customerGeoPointsTable).omit({ id: true, createdAt: true });
export type InsertCustomerGeoPoint = z.infer<typeof insertCustomerGeoPointSchema>;
export type CustomerGeoPoint = typeof customerGeoPointsTable.$inferSelect;

export const insertFestivalEventSchema = createInsertSchema(festivalEventsTable).omit({ id: true, createdAt: true });
export type FestivalEvent = typeof festivalEventsTable.$inferSelect;

export const insertMarginFloorSchema = createInsertSchema(marginFloorsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type MarginFloor = typeof marginFloorsTable.$inferSelect;

export const insertUpsellScriptEventSchema = createInsertSchema(upsellScriptEventsTable).omit({ id: true, createdAt: true });
export type UpsellScriptEvent = typeof upsellScriptEventsTable.$inferSelect;

export const insertTakeawayQueueTicketSchema = createInsertSchema(takeawayQueueTicketsTable).omit({ id: true, ticketNumber: true, createdAt: true, updatedAt: true });
export type TakeawayQueueTicket = typeof takeawayQueueTicketsTable.$inferSelect;

export const insertPreorderSlotSchema = createInsertSchema(preorderSlotsTable).omit({ id: true, createdAt: true });
export type PreorderSlot = typeof preorderSlotsTable.$inferSelect;
export const insertPreorderBookingSchema = createInsertSchema(preorderBookingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type PreorderBooking = typeof preorderBookingsTable.$inferSelect;

export const insertDeliveryZoneSchema = createInsertSchema(deliveryZonesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type DeliveryZone = typeof deliveryZonesTable.$inferSelect;
export type DeliveryZoneMetric = typeof deliveryZoneMetricsTable.$inferSelect;

export type TableMetricsSnapshot = typeof tableMetricsSnapshotsTable.$inferSelect;

export const insertTipSplitRuleSchema = createInsertSchema(tipSplitRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type TipSplitRule = typeof tipSplitRulesTable.$inferSelect;
export type TipPool = typeof tipPoolsTable.$inferSelect;
export type TipPoolEntry = typeof tipPoolEntriesTable.$inferSelect;
export type TipAdjustment = typeof tipAdjustmentsTable.$inferSelect;
export type CashTipDeclaration = typeof cashTipDeclarationsTable.$inferSelect;
export type LeaderboardSnapshot = typeof leaderboardSnapshotsTable.$inferSelect;
