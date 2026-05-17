/**
 * Implementation / Go-Live tracking (Task #435).
 *
 * Larger customers (typically Enterprise plan) get a structured, post-signup
 * implementation workflow run by a dedicated onboarding manager: per-step
 * checklist with owners + due dates, go-live date, week 1/2/4 post-launch
 * follow-ups, and SLA timers visible from the Super Admin "Implementation"
 * board.
 *
 * Builds on top of the AI Setup Wizard (#7) and the legacy step-by-step
 * onboarding (`onboarding.ts`) — this table tracks the long-tail of
 * implementation work that comes *after* a tenant clicks "Go live".
 */
import { pgTable, text, serial, integer, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

export type ImplementationStatus = "not_started" | "in_progress" | "blocked" | "launched" | "post_launch" | "complete";
export type ImplementationStepStatus = "not_started" | "in_progress" | "blocked" | "complete" | "skipped";
export type ImplementationStepOwner = "restaurant" | "manager";

export const implementationsTable = pgTable("implementations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  // Assigned onboarding manager (super-admin user). NULL until super-admin picks one.
  managerId: integer("manager_id").references(() => usersTable.id, { onDelete: "set null" }),
  status: text("status").$type<ImplementationStatus>().notNull().default("not_started"),
  // Target go-live date set by the manager + the restaurant.
  goLiveDate: timestamp("go_live_date"),
  // SLA budget in hours: how long the assigned manager has to push this
  // implementation from `not_started` to `launched`. Stalled-step alerts use it.
  slaHours: integer("sla_hours").notNull().default(168), // 7 days default
  startedAt: timestamp("started_at"),
  launchedAt: timestamp("launched_at"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  // When was the most recent stalled-step alert raised — used to throttle repeat notifications.
  lastStallAlertAt: timestamp("last_stall_alert_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byTenant: uniqueIndex("implementations_tenant_id_unique").on(t.tenantId),
}));

/**
 * Per-implementation checklist row. Seeded with a standard template when
 * an implementation is created — restaurant + manager update progress/status
 * as they work through it.
 */
export const implementationStepsTable = pgTable("implementation_steps", {
  id: serial("id").primaryKey(),
  implementationId: integer("implementation_id").notNull().references(() => implementationsTable.id, { onDelete: "cascade" }),
  // Stable string key (e.g. `menu`, `staff`, `payment`, `printer`, `qr`, `training`, `migration`).
  // Useful so we can compute progress against a canonical template.
  stepKey: text("step_key").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  // Who is on the hook for this step.
  ownerType: text("owner_type").$type<ImplementationStepOwner>().notNull().default("restaurant"),
  ownerUserId: integer("owner_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  status: text("status").$type<ImplementationStepStatus>().notNull().default("not_started"),
  // 0..100 — finer-grained progress for sub-steps (e.g. menu items imported).
  progressPct: integer("progress_pct").notNull().default(0),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  // Most recent activity timestamp — used by the stalled-step detector.
  lastActivityAt: timestamp("last_activity_at").notNull().defaultNow(),
  // Free-form structured payload for sub-statuses (e.g. {"menuItems": 23, "translated": false}).
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Auto-generated week 1 / 2 / 4 follow-up tasks scheduled at go-live so the
 * onboarding manager doesn't drop the customer the moment they launch.
 */
export const implementationPostLaunchTasksTable = pgTable("implementation_post_launch_tasks", {
  id: serial("id").primaryKey(),
  implementationId: integer("implementation_id").notNull().references(() => implementationsTable.id, { onDelete: "cascade" }),
  // 1, 2, or 4 — weeks-after-launch bucket.
  weekOffset: integer("week_offset").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date").notNull(),
  completedAt: timestamp("completed_at"),
  completedByUserId: integer("completed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Implementation = typeof implementationsTable.$inferSelect;
export type ImplementationStep = typeof implementationStepsTable.$inferSelect;
export type ImplementationPostLaunchTask = typeof implementationPostLaunchTasksTable.$inferSelect;

/** Canonical template applied when a new implementation is created. */
export const IMPLEMENTATION_STEP_TEMPLATE: Array<{
  key: string; title: string; description: string; ownerType: ImplementationStepOwner;
}> = [
  { key: "menu",      title: "Menu loaded",            description: "All categories, items, modifiers and prices imported and reviewed.", ownerType: "restaurant" },
  { key: "staff",     title: "Staff invited & trained",description: "Owners, managers, waiters and kitchen staff invited with roles assigned.", ownerType: "restaurant" },
  { key: "payment",   title: "Payments configured",    description: "Payment gateway connected, tax / service charge rates set.", ownerType: "manager" },
  { key: "printer",   title: "Printers paired",        description: "KOT and bill printers paired and test prints confirmed.", ownerType: "manager" },
  { key: "qr",        title: "QR codes generated",     description: "Table QR codes printed and placed; test scan confirmed.", ownerType: "restaurant" },
  { key: "training",  title: "Team training session",  description: "Live training session delivered for owners + floor staff.", ownerType: "manager" },
  { key: "migration", title: "Data migration",         description: "Historical orders, customers and inventory imported (if applicable).", ownerType: "manager" },
];
