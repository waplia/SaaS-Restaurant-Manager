import { pgTable, text, serial, timestamp, integer, boolean, decimal, unique, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

/**
 * Staff Portal new tables. The portal is a self-service area for employees
 * (waiter/kitchen/cashier/delivery_executive) embedded in the restaurant
 * platform at /portal.
 *
 * Most portal features reuse existing modules (attendance, shifts, leaves,
 * payroll, sop-training, documents, support-tickets). The tables below cover
 * the gaps:
 *   - announcements & read receipts
 *   - employee tasks (with simple recurrence)
 *   - shift swap / unavailable requests
 *   - geo-stamped attendance selfies
 *   - payroll slip queries (raise question on slip)
 *   - incentive programs + monthly payouts
 *
 * Performance scorecard is computed on-the-fly from existing data
 * (attendance, leaves, training certs, performance notes, tasks).
 */

export const announcementsTable = pgTable("announcements", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  // audience.roles: empty/missing = everyone
  audience: jsonb("audience").$type<{ roles?: string[] }>().notNull().default({}),
  priority: text("priority").notNull().default("normal"), // normal | high | urgent
  publishedAt: timestamp("published_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  restPubIdx: index("announcements_rest_pub_idx").on(t.restaurantId, t.publishedAt),
}));

export const announcementReadsTable = pgTable("announcement_reads", {
  id: serial("id").primaryKey(),
  announcementId: integer("announcement_id").notNull().references(() => announcementsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  readAt: timestamp("read_at").notNull().defaultNow(),
}, (t) => [unique().on(t.announcementId, t.userId)]);

export const staffTasksTable = pgTable("staff_tasks", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  assigneeUserId: integer("assignee_user_id").notNull().references(() => usersTable.id),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority").notNull().default("normal"), // low | normal | high
  status: text("status").notNull().default("open"), // open | in_progress | done | cancelled
  dueAt: timestamp("due_at"),
  // simple recurrence: none | daily | weekly | monthly. When set, completing
  // the task creates the next occurrence with dueAt advanced.
  recurrence: text("recurrence").notNull().default("none"),
  parentTaskId: integer("parent_task_id"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  assigneeIdx: index("staff_tasks_assignee_idx").on(t.assigneeUserId, t.status),
  restIdx: index("staff_tasks_rest_idx").on(t.restaurantId, t.status),
}));

export const shiftSwapRequestsTable = pgTable("shift_swap_requests", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  requesterUserId: integer("requester_user_id").notNull().references(() => usersTable.id),
  // Type: swap (asks another staff to take the shift) | unavailable (just
  // marks the day as unavailable, manager reschedules).
  kind: text("kind").notNull().default("unavailable"),
  shiftDate: timestamp("shift_date").notNull(),
  shiftId: integer("shift_id"),
  targetUserId: integer("target_user_id").references(() => usersTable.id),
  reason: text("reason"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected | cancelled
  decidedByUserId: integer("decided_by_user_id").references(() => usersTable.id),
  decidedAt: timestamp("decided_at"),
  decisionNote: text("decision_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const attendanceSelfiesTable = pgTable("attendance_selfies", {
  id: serial("id").primaryKey(),
  attendanceId: integer("attendance_id").notNull(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  kind: text("kind").notNull(), // clock_in | clock_out
  fileUrl: text("file_url"),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  accuracyMeters: decimal("accuracy_meters", { precision: 10, scale: 2 }),
  withinGeofence: boolean("within_geofence"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  attIdx: index("attendance_selfies_att_idx").on(t.attendanceId),
}));

export const payrollSlipQueriesTable = pgTable("payroll_slip_queries", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  payrollItemId: integer("payroll_item_id").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("open"), // open | answered | closed
  response: text("response"),
  respondedAt: timestamp("responded_at"),
  respondedByUserId: integer("responded_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const incentiveProgramsTable = pgTable("incentive_programs", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  // Free-form formula text (e.g. "5% of upsell sales above ₹50k").
  formula: text("formula"),
  rolesScope: text("roles_scope").array().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const incentivePayoutsTable = pgTable("incentive_payouts", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  programId: integer("program_id").references(() => incentiveProgramsTable.id),
  // YYYY-MM
  period: text("period").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("pending"), // pending | paid
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  userPeriodIdx: index("incentive_payouts_user_period_idx").on(t.userId, t.period),
}));

export const insertAnnouncementSchema = createInsertSchema(announcementsTable).omit({ id: true, createdAt: true });
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;
export type Announcement = typeof announcementsTable.$inferSelect;

export type AnnouncementRead = typeof announcementReadsTable.$inferSelect;

export const insertStaffTaskSchema = createInsertSchema(staffTasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStaffTask = z.infer<typeof insertStaffTaskSchema>;
export type StaffTask = typeof staffTasksTable.$inferSelect;

export const insertShiftSwapRequestSchema = createInsertSchema(shiftSwapRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertShiftSwapRequest = z.infer<typeof insertShiftSwapRequestSchema>;
export type ShiftSwapRequest = typeof shiftSwapRequestsTable.$inferSelect;

export type AttendanceSelfie = typeof attendanceSelfiesTable.$inferSelect;
export type PayrollSlipQuery = typeof payrollSlipQueriesTable.$inferSelect;

export const insertIncentiveProgramSchema = createInsertSchema(incentiveProgramsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIncentiveProgram = z.infer<typeof insertIncentiveProgramSchema>;
export type IncentiveProgram = typeof incentiveProgramsTable.$inferSelect;

export const insertIncentivePayoutSchema = createInsertSchema(incentivePayoutsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIncentivePayout = z.infer<typeof insertIncentivePayoutSchema>;
export type IncentivePayout = typeof incentivePayoutsTable.$inferSelect;
