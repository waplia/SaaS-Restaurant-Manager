import { pgTable, serial, integer, text, boolean, jsonb, timestamp, decimal, index } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

// ── Panic alerts ─────────────────────────────────────────────────────────
export const panicAlertsTable = pgTable("panic_alerts", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // angry_customer | emergency | kitchen | payment | equipment
  message: text("message"),
  status: text("status").notNull().default("open"), // open | acknowledged | resolved
  raisedByUserId: integer("raised_by_user_id").references(() => usersTable.id),
  raisedAt: timestamp("raised_at").notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedByUserId: integer("acknowledged_by_user_id").references(() => usersTable.id),
  resolvedAt: timestamp("resolved_at"),
  resolvedByUserId: integer("resolved_by_user_id").references(() => usersTable.id),
  notes: text("notes"),
}, t => ({
  restIdx: index("panic_alerts_restaurant_idx").on(t.restaurantId, t.raisedAt),
  statusIdx: index("panic_alerts_status_idx").on(t.restaurantId, t.status),
}));
export type PanicAlert = typeof panicAlertsTable.$inferSelect;

// ── Shift handover ───────────────────────────────────────────────────────
export const managerHandoversTable = pgTable("manager_handovers", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  shiftId: integer("shift_id"),
  fromUserId: integer("from_user_id").references(() => usersTable.id),
  toUserId: integer("to_user_id").references(() => usersTable.id),
  cashIssue: text("cash_issue"),
  stockIssue: text("stock_issue"),
  staffIssue: text("staff_issue"),
  pendingOrders: text("pending_orders"),
  complaints: text("complaints"),
  tomorrowTasks: text("tomorrow_tasks"),
  notes: text("notes"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
}, t => ({ restIdx: index("manager_handovers_restaurant_idx").on(t.restaurantId, t.submittedAt) }));
export type ManagerHandover = typeof managerHandoversTable.$inferSelect;

// ── Morning briefings ────────────────────────────────────────────────────
export const morningBriefingsTable = pgTable("morning_briefings", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  forDate: text("for_date").notNull(), // YYYY-MM-DD
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({ restIdx: index("morning_briefings_restaurant_idx").on(t.restaurantId, t.forDate) }));
export type MorningBriefing = typeof morningBriefingsTable.$inferSelect;

// ── Closing checklists ───────────────────────────────────────────────────
export type ClosingChecklistItem = { key: string; label: string; required: boolean };

export const closingChecklistTemplatesTable = pgTable("closing_checklist_templates", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  items: jsonb("items").$type<ClosingChecklistItem[]>().notNull().default([]),
  enforceOnClose: boolean("enforce_on_close").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type ClosingChecklistTemplate = typeof closingChecklistTemplatesTable.$inferSelect;

export const closingChecklistRunsTable = pgTable("closing_checklist_runs", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  templateId: integer("template_id").references(() => closingChecklistTemplatesTable.id),
  sessionId: integer("session_id"),
  completedItems: jsonb("completed_items").$type<string[]>().notNull().default([]),
  blockers: jsonb("blockers").$type<string[]>().notNull().default([]),
  notes: text("notes"),
  submittedByUserId: integer("submitted_by_user_id").references(() => usersTable.id),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
}, t => ({ restIdx: index("closing_checklist_runs_restaurant_idx").on(t.restaurantId, t.submittedAt) }));
export type ClosingChecklistRun = typeof closingChecklistRunsTable.$inferSelect;

// ── Timeline events ──────────────────────────────────────────────────────
export const timelineEventsTable = pgTable("timeline_events", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  entity: text("entity"),
  entityId: integer("entity_id"),
  summary: text("summary").notNull(),
  actorUserId: integer("actor_user_id").references(() => usersTable.id),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
}, t => ({
  restIdx: index("timeline_events_restaurant_idx").on(t.restaurantId, t.occurredAt),
  entIdx: index("timeline_events_entity_idx").on(t.restaurantId, t.entity, t.entityId),
}));
export type TimelineEvent = typeof timelineEventsTable.$inferSelect;

// ── Generic ops approvals ────────────────────────────────────────────────
export const opsApprovalsTable = pgTable("ops_approvals", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // discount | refund | stock_adjustment | leave | purchase_order | price_change | campaign | expense | other
  title: text("title").notNull(),
  description: text("description"),
  amount: decimal("amount", { precision: 12, scale: 2 }),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  requestedByUserId: integer("requested_by_user_id").references(() => usersTable.id),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  decidedByUserId: integer("decided_by_user_id").references(() => usersTable.id),
  decidedAt: timestamp("decided_at"),
  decisionComment: text("decision_comment"),
}, t => ({
  restIdx: index("ops_approvals_restaurant_idx").on(t.restaurantId, t.status, t.requestedAt),
}));
export type OpsApproval = typeof opsApprovalsTable.$inferSelect;

// ── Incidents ────────────────────────────────────────────────────────────
export const incidentsTable = pgTable("incidents", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // complaint | staff_conflict | equipment | food | accident | safety | other
  severity: text("severity").notNull().default("medium"), // low | medium | high | critical
  status: text("status").notNull().default("open"), // open | investigating | resolved | closed
  title: text("title").notNull(),
  description: text("description"),
  assigneeUserId: integer("assignee_user_id").references(() => usersTable.id),
  reportedByUserId: integer("reported_by_user_id").references(() => usersTable.id),
  resolutionNotes: text("resolution_notes"),
  reportedAt: timestamp("reported_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, t => ({
  restIdx: index("incidents_restaurant_idx").on(t.restaurantId, t.status, t.reportedAt),
}));
export type Incident = typeof incidentsTable.$inferSelect;

// ── Cleaning proofs ──────────────────────────────────────────────────────
export const cleaningProofsTable = pgTable("cleaning_proofs", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  area: text("area").notNull(), // kitchen | tables | washroom | storage | other
  beforeUrl: text("before_url"),
  afterUrl: text("after_url"),
  notes: text("notes"),
  submittedByUserId: integer("submitted_by_user_id").references(() => usersTable.id),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => usersTable.id),
  reviewedAt: timestamp("reviewed_at"),
  status: text("status").notNull().default("submitted"), // submitted | approved | rejected
  reviewComment: text("review_comment"),
}, t => ({ restIdx: index("cleaning_proofs_restaurant_idx").on(t.restaurantId, t.submittedAt) }));
export type CleaningProof = typeof cleaningProofsTable.$inferSelect;

// ── Temperature logs ─────────────────────────────────────────────────────
export const temperatureLogsTable = pgTable("temperature_logs", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  deviceLabel: text("device_label").notNull(),
  location: text("location"), // fridge | freezer | kitchen | hot_hold | other
  tempCelsius: decimal("temp_celsius", { precision: 6, scale: 2 }).notNull(),
  minThreshold: decimal("min_threshold", { precision: 6, scale: 2 }),
  maxThreshold: decimal("max_threshold", { precision: 6, scale: 2 }),
  source: text("source").notNull().default("manual"), // manual | iot
  readingAt: timestamp("reading_at").notNull().defaultNow(),
  recordedByUserId: integer("recorded_by_user_id").references(() => usersTable.id),
  alertSent: boolean("alert_sent").notNull().default(false),
  notes: text("notes"),
}, t => ({ restIdx: index("temperature_logs_restaurant_idx").on(t.restaurantId, t.readingAt) }));
export type TemperatureLog = typeof temperatureLogsTable.$inferSelect;

// ── Equipment register & maintenance ─────────────────────────────────────
export const equipmentRegisterTable = pgTable("equipment_register", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type"), // oven | fridge | fryer | printer | ac | generator | pos | other
  location: text("location"),
  serialNumber: text("serial_number"),
  vendor: text("vendor"),
  purchaseDate: text("purchase_date"),
  amcExpiresAt: text("amc_expires_at"),
  nextServiceAt: text("next_service_at"),
  status: text("status").notNull().default("operational"), // operational | needs_service | out_of_service | retired
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({ restIdx: index("equipment_register_restaurant_idx").on(t.restaurantId) }));
export type EquipmentRegister = typeof equipmentRegisterTable.$inferSelect;

export const equipmentMaintenanceRecordsTable = pgTable("equipment_maintenance_records", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  equipmentId: integer("equipment_id").notNull().references(() => equipmentRegisterTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // repair | service | breakdown | inspection
  cost: decimal("cost", { precision: 12, scale: 2 }).default("0"),
  vendor: text("vendor"),
  performedAt: timestamp("performed_at").notNull().defaultNow(),
  notes: text("notes"),
  recordedByUserId: integer("recorded_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({ equipIdx: index("equipment_maint_equipment_idx").on(t.equipmentId, t.performedAt) }));
export type EquipmentMaintenanceRecord = typeof equipmentMaintenanceRecordsTable.$inferSelect;

// ── Service timer events ─────────────────────────────────────────────────
export const serviceTimerEventsTable = pgTable("service_timer_events", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  orderId: integer("order_id").notNull(),
  stage: text("stage").notNull(), // placed | accepted | kot_fired | preparing | ready | served | billed
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  durationMs: integer("duration_ms"),
}, t => ({
  orderIdx: index("service_timer_events_order_idx").on(t.orderId, t.occurredAt),
  restIdx: index("service_timer_events_restaurant_idx").on(t.restaurantId, t.occurredAt),
}));
export type ServiceTimerEvent = typeof serviceTimerEventsTable.$inferSelect;
