import { pgTable, serial, integer, text, boolean, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

export const staffTaskAreasTable = pgTable("staff_task_areas", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  qrToken: text("qr_token").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  restIdx: index("staff_task_areas_restaurant_idx").on(t.restaurantId),
}));

export type StaffTaskChecklistItem = { key: string; label: string; requirePhoto?: boolean };
export type StaffTaskScheduleType = "interval" | "times_per_day" | "none";

export const staffTaskChecklistsTable = pgTable("staff_task_checklists", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  areaId: integer("area_id").notNull().references(() => staffTaskAreasTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  items: jsonb("items").$type<StaffTaskChecklistItem[]>().notNull().default([]),
  photoRequired: boolean("photo_required").notNull().default(false),
  scheduleType: text("schedule_type").$type<StaffTaskScheduleType>().notNull().default("none"),
  // For interval: every N minutes (window starts at midnight). For times_per_day: N evenly-spaced windows.
  intervalMinutes: integer("interval_minutes").notNull().default(120),
  timesPerDay: integer("times_per_day").notNull().default(3),
  // Grace window in minutes within which a submission counts as on-time.
  windowMinutes: integer("window_minutes").notNull().default(60),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  restIdx: index("staff_task_checklists_restaurant_idx").on(t.restaurantId),
  areaIdx: index("staff_task_checklists_area_idx").on(t.areaId),
}));

export type StaffTaskSubmissionStatus = "pending" | "approved" | "rejected";

export const staffTaskSubmissionsTable = pgTable("staff_task_submissions", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  areaId: integer("area_id").notNull().references(() => staffTaskAreasTable.id, { onDelete: "cascade" }),
  checklistId: integer("checklist_id").notNull().references(() => staffTaskChecklistsTable.id, { onDelete: "cascade" }),
  staffUserId: integer("staff_user_id").notNull().references(() => usersTable.id),
  startedAt: timestamp("started_at"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  // The scheduled window this submission covers (for missed-task / on-time accounting).
  windowStart: timestamp("window_start"),
  windowEnd: timestamp("window_end"),
  notes: text("notes"),
  photoUrls: jsonb("photo_urls").$type<string[]>().notNull().default([]),
  status: text("status").$type<StaffTaskSubmissionStatus>().notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  restIdx: index("staff_task_submissions_restaurant_idx").on(t.restaurantId, t.submittedAt),
  statusIdx: index("staff_task_submissions_status_idx").on(t.restaurantId, t.status),
  staffIdx: index("staff_task_submissions_staff_idx").on(t.staffUserId, t.submittedAt),
  windowIdx: index("staff_task_submissions_window_idx").on(t.checklistId, t.windowStart),
}));

export const staffTaskSubmissionItemsTable = pgTable("staff_task_submission_items", {
  id: serial("id").primaryKey(),
  submissionId: integer("submission_id").notNull().references(() => staffTaskSubmissionsTable.id, { onDelete: "cascade" }),
  itemKey: text("item_key").notNull(),
  itemLabel: text("item_label").notNull(),
  checked: boolean("checked").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  subIdx: index("staff_task_submission_items_submission_idx").on(t.submissionId),
}));

export type StaffTaskVerificationAction = "approved" | "rejected";

export const staffTaskVerificationsTable = pgTable("staff_task_verifications", {
  id: serial("id").primaryKey(),
  submissionId: integer("submission_id").notNull().references(() => staffTaskSubmissionsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  managerUserId: integer("manager_user_id").notNull().references(() => usersTable.id),
  action: text("action").$type<StaffTaskVerificationAction>().notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  subIdx: index("staff_task_verifications_submission_idx").on(t.submissionId),
  restIdx: index("staff_task_verifications_restaurant_idx").on(t.restaurantId, t.createdAt),
}));

// Tracks scheduled windows that elapsed without an on-time submission. Dedupes
// notifications and feeds the per-staff accountability score.
export const staffTaskMissedWindowsTable = pgTable("staff_task_missed_windows", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  areaId: integer("area_id").notNull().references(() => staffTaskAreasTable.id, { onDelete: "cascade" }),
  checklistId: integer("checklist_id").notNull().references(() => staffTaskChecklistsTable.id, { onDelete: "cascade" }),
  windowStart: timestamp("window_start").notNull(),
  windowEnd: timestamp("window_end").notNull(),
  notifiedAt: timestamp("notified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("staff_task_missed_windows_uniq_idx").on(t.checklistId, t.windowStart),
  restIdx: index("staff_task_missed_windows_restaurant_idx").on(t.restaurantId, t.windowStart),
}));

export const insertStaffTaskAreaSchema = createInsertSchema(staffTaskAreasTable).omit({ id: true, createdAt: true, updatedAt: true });
export type StaffTaskArea = typeof staffTaskAreasTable.$inferSelect;
export type InsertStaffTaskArea = z.infer<typeof insertStaffTaskAreaSchema>;

export const insertStaffTaskChecklistSchema = createInsertSchema(staffTaskChecklistsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type StaffTaskChecklist = typeof staffTaskChecklistsTable.$inferSelect;
export type InsertStaffTaskChecklist = z.infer<typeof insertStaffTaskChecklistSchema>;

export const insertStaffTaskSubmissionSchema = createInsertSchema(staffTaskSubmissionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type StaffTaskSubmission = typeof staffTaskSubmissionsTable.$inferSelect;
export type InsertStaffTaskSubmission = z.infer<typeof insertStaffTaskSubmissionSchema>;

export const insertStaffTaskSubmissionItemSchema = createInsertSchema(staffTaskSubmissionItemsTable).omit({ id: true, createdAt: true });
export type StaffTaskSubmissionItem = typeof staffTaskSubmissionItemsTable.$inferSelect;
export type InsertStaffTaskSubmissionItem = z.infer<typeof insertStaffTaskSubmissionItemSchema>;

export const insertStaffTaskVerificationSchema = createInsertSchema(staffTaskVerificationsTable).omit({ id: true, createdAt: true });
export type StaffTaskVerification = typeof staffTaskVerificationsTable.$inferSelect;
export type InsertStaffTaskVerification = z.infer<typeof insertStaffTaskVerificationSchema>;

export const insertStaffTaskMissedWindowSchema = createInsertSchema(staffTaskMissedWindowsTable).omit({ id: true, createdAt: true });
export type StaffTaskMissedWindow = typeof staffTaskMissedWindowsTable.$inferSelect;
export type InsertStaffTaskMissedWindow = z.infer<typeof insertStaffTaskMissedWindowSchema>;
