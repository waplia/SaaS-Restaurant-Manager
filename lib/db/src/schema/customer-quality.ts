import { pgTable, serial, integer, text, boolean, timestamp, jsonb, decimal, index, uniqueIndex, date } from "drizzle-orm/pg-core";
import { restaurantsTable, branchesTable } from "./restaurants";
import { customersTable, customerComplaintsTable } from "./customers";
import { ordersTable } from "./orders";
import { usersTable } from "./users";
import { supportTicketsTable } from "./support-tickets";

// VIP Alerts log — append-only feed of fired VIP detections (in-store or online).
export const vipAlertsTable = pgTable("vip_alerts", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  trigger: text("trigger").notNull(), // tag | top_spender | repeat_threshold | manual
  reason: text("reason"),
  channelsNotified: jsonb("channels_notified").$type<string[]>().notNull().default([]),
  acknowledged: boolean("acknowledged").notNull().default(false),
  acknowledgedBy: integer("acknowledged_by").references(() => usersTable.id, { onDelete: "set null" }),
  acknowledgedAt: timestamp("acknowledged_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("vip_alerts_restaurant_idx").on(t.restaurantId, t.createdAt),
  byCustomer: index("vip_alerts_customer_idx").on(t.customerId, t.createdAt),
}));

// Customer risk flags — extends is_blacklisted with structured reasons + score.
export const customerRiskFlagsTable = pgTable("customer_risk_flags", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(), // abusive | fake_order | unpaid | refund_abuse | troublemaker | other
  notes: text("notes"),
  riskScore: integer("risk_score").notNull().default(50), // 0–100
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: integer("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
}, (t) => ({
  byCustomer: index("customer_risk_flags_customer_idx").on(t.customerId, t.isActive),
  byRest: index("customer_risk_flags_restaurant_idx").on(t.restaurantId, t.createdAt),
}));

// Mood responses — emoji at checkout / QR / post-order.
export const moodResponsesTable = pgTable("mood_responses", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  staffUserId: integer("staff_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  source: text("source").notNull().default("checkout"), // checkout | qr | post_order | display_token
  mood: text("mood").notNull(), // delighted | happy | neutral | unhappy | angry
  moodScore: integer("mood_score").notNull().default(0), // -2..+2
  comment: text("comment"),
  orderType: text("order_type"),
  itemSnapshot: jsonb("item_snapshot").$type<Array<{ menuItemId: number; name: string }>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("mood_responses_restaurant_idx").on(t.restaurantId, t.createdAt),
  byMood: index("mood_responses_mood_idx").on(t.restaurantId, t.mood),
}));

// Complaint escalation rules — per restaurant config of SLA ladders.
export const complaintEscalationRulesTable = pgTable("complaint_escalation_rules", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  level1Minutes: integer("level1_minutes").notNull().default(30), // alert manager
  level2Minutes: integer("level2_minutes").notNull().default(120), // alert owner
  level3Minutes: integer("level3_minutes").notNull().default(360), // critical / SMS
  notifyManagers: boolean("notify_managers").notNull().default(true),
  notifyOwners: boolean("notify_owners").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byRest: uniqueIndex("complaint_escalation_rules_restaurant_idx").on(t.restaurantId),
}));

// Escalation events — one row per (complaint, level) fired.
export const complaintEscalationEventsTable = pgTable("complaint_escalation_events", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  complaintId: integer("complaint_id").references(() => customerComplaintsTable.id, { onDelete: "cascade" }),
  supportTicketId: integer("support_ticket_id").references(() => supportTicketsTable.id, { onDelete: "cascade" }),
  level: integer("level").notNull(), // 1 | 2 | 3
  notifiedUserIds: jsonb("notified_user_ids").$type<number[]>().notNull().default([]),
  channel: text("channel").notNull().default("notification"), // notification | sms | whatsapp | email
  message: text("message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byComplaint: index("complaint_escalation_events_complaint_idx").on(t.complaintId, t.createdAt),
  byRest: index("complaint_escalation_events_restaurant_idx").on(t.restaurantId, t.createdAt),
}));

// Repeat complaint clusters — nightly aggregation surfaces problems.
export const repeatComplaintClustersTable = pgTable("repeat_complaint_clusters", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  clusterType: text("cluster_type").notNull(), // item | staff | outlet | delivery_zone | shift
  clusterKey: text("cluster_key").notNull(), // e.g. menu item id, staff user id
  clusterLabel: text("cluster_label").notNull(),
  complaintCount: integer("complaint_count").notNull().default(0),
  windowStart: timestamp("window_start").notNull(),
  windowEnd: timestamp("window_end").notNull(),
  sampleComplaintIds: jsonb("sample_complaint_ids").$type<number[]>().notNull().default([]),
  isDismissed: boolean("is_dismissed").notNull().default(false),
  dismissedBy: integer("dismissed_by").references(() => usersTable.id, { onDelete: "set null" }),
  dismissedAt: timestamp("dismissed_at"),
  dismissReason: text("dismiss_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("repeat_complaint_clusters_restaurant_idx").on(t.restaurantId, t.isDismissed, t.createdAt),
  uniqWindow: uniqueIndex("repeat_complaint_clusters_uniq_idx").on(t.restaurantId, t.clusterType, t.clusterKey, t.windowStart),
}));

// Order accuracy events — per-staff/branch errors that lower accuracy score.
export const orderAccuracyEventsTable = pgTable("order_accuracy_events", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  staffUserId: integer("staff_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(), // wrong_item | missing_item | kot_cancel | correction | complaint
  itemsAffected: integer("items_affected").notNull().default(1),
  weight: integer("weight").notNull().default(1), // how heavily it impacts score
  notes: text("notes"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("order_accuracy_events_restaurant_idx").on(t.restaurantId, t.createdAt),
  byStaff: index("order_accuracy_events_staff_idx").on(t.staffUserId, t.createdAt),
  byBranch: index("order_accuracy_events_branch_idx").on(t.branchId, t.createdAt),
}));

// Lost sales events — out-of-stock attempts, walk-outs, etc.
export const lostSalesEventsTable = pgTable("lost_sales_events", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(), // out_of_stock | cancelled_order | abandoned_cart | unavailable_zone | walk_out | failed_payment
  channel: text("channel"), // dine_in | qr | online | phone | delivery
  reason: text("reason"),
  estimatedValue: decimal("estimated_value", { precision: 10, scale: 2 }).notNull().default("0.00"),
  itemSnapshot: jsonb("item_snapshot").$type<Array<{ menuItemId?: number; name: string; quantity?: number; price?: string }>>(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("lost_sales_events_restaurant_idx").on(t.restaurantId, t.createdAt),
  byType: index("lost_sales_events_type_idx").on(t.restaurantId, t.eventType),
}));

// Cart sessions — tracks active QR / online carts for abandonment detection.
export const cartSessionsTable = pgTable("cart_sessions", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  sessionToken: text("session_token").notNull(),
  channel: text("channel").notNull().default("qr"), // qr | online | app
  tableId: integer("table_id"),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  customerPhone: text("customer_phone"),
  customerName: text("customer_name"),
  items: jsonb("items").$type<Array<{ menuItemId: number; name: string; quantity: number; price: string }>>().notNull().default([]),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0.00"),
  status: text("status").notNull().default("active"), // active | converted | abandoned
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  recoveryOptIn: boolean("recovery_opt_in").notNull().default(false),
  lastActivityAt: timestamp("last_activity_at").notNull().defaultNow(),
  abandonedAt: timestamp("abandoned_at"),
  convertedAt: timestamp("converted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("cart_sessions_restaurant_idx").on(t.restaurantId, t.status, t.lastActivityAt),
  uniqToken: uniqueIndex("cart_sessions_token_idx").on(t.restaurantId, t.sessionToken),
}));

// Cart abandonment events — one row per recovery attempt fired.
export const cartAbandonmentEventsTable = pgTable("cart_abandonment_events", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  cartSessionId: integer("cart_session_id").notNull().references(() => cartSessionsTable.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(), // whatsapp | sms | email
  recipient: text("recipient").notNull(),
  status: text("status").notNull().default("queued"), // queued | sent | failed | recovered
  message: text("message"),
  recoveredOrderId: integer("recovered_order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  recoveredAt: timestamp("recovered_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byRest: index("cart_abandonment_events_restaurant_idx").on(t.restaurantId, t.createdAt),
  bySession: index("cart_abandonment_events_session_idx").on(t.cartSessionId),
}));

export type VipAlert = typeof vipAlertsTable.$inferSelect;
export type CustomerRiskFlag = typeof customerRiskFlagsTable.$inferSelect;
export type MoodResponse = typeof moodResponsesTable.$inferSelect;
export type ComplaintEscalationRule = typeof complaintEscalationRulesTable.$inferSelect;
export type ComplaintEscalationEvent = typeof complaintEscalationEventsTable.$inferSelect;
export type RepeatComplaintCluster = typeof repeatComplaintClustersTable.$inferSelect;
export type OrderAccuracyEvent = typeof orderAccuracyEventsTable.$inferSelect;
export type LostSalesEvent = typeof lostSalesEventsTable.$inferSelect;
export type CartSession = typeof cartSessionsTable.$inferSelect;
export type CartAbandonmentEvent = typeof cartAbandonmentEventsTable.$inferSelect;
