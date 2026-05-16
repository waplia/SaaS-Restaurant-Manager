import { pgTable, text, serial, timestamp, integer, boolean, jsonb, decimal, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

export const MYSTERY_AUDIT_SUBMISSION_STATUS = ["draft", "submitted", "locked"] as const;
export type MysteryAuditSubmissionStatus = (typeof MYSTERY_AUDIT_SUBMISSION_STATUS)[number];

export const MYSTERY_AUDIT_ASSIGNMENT_STATUS = ["pending", "in_progress", "submitted", "locked", "cancelled"] as const;
export type MysteryAuditAssignmentStatus = (typeof MYSTERY_AUDIT_ASSIGNMENT_STATUS)[number];

export const MYSTERY_AUDIT_ACTION_STATUS = ["open", "in_progress", "resolved"] as const;
export type MysteryAuditActionStatus = (typeof MYSTERY_AUDIT_ACTION_STATUS)[number];

export const MYSTERY_AUDIT_ACTION_PRIORITY = ["low", "medium", "high"] as const;
export type MysteryAuditActionPriority = (typeof MYSTERY_AUDIT_ACTION_PRIORITY)[number];

export const mysteryAuditTemplatesTable = pgTable("mystery_audit_templates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("mystery_audit_templates_tenant_idx").on(t.tenantId)]);

export const mysteryAuditCategoriesTable = pgTable("mystery_audit_categories", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => mysteryAuditTemplatesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  weight: decimal("weight", { precision: 6, scale: 2 }).notNull().default("1.00"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [index("mystery_audit_categories_template_idx").on(t.templateId)]);

export const mysteryAuditItemsTable = pgTable("mystery_audit_items", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull().references(() => mysteryAuditCategoriesTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  description: text("description"),
  maxScore: integer("max_score").notNull().default(5),
  requirePhoto: boolean("require_photo").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [index("mystery_audit_items_category_idx").on(t.categoryId)]);

export const mysteryAuditAssignmentsTable = pgTable("mystery_audit_assignments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  templateId: integer("template_id").notNull().references(() => mysteryAuditTemplatesTable.id, { onDelete: "restrict" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  auditorUserId: integer("auditor_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  status: text("status").$type<MysteryAuditAssignmentStatus>().notNull().default("pending"),
  dueDate: timestamp("due_date"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("mystery_audit_assign_tenant_idx").on(t.tenantId),
  index("mystery_audit_assign_restaurant_idx").on(t.restaurantId),
  index("mystery_audit_assign_auditor_idx").on(t.auditorUserId),
]);

export const mysteryAuditSubmissionsTable = pgTable("mystery_audit_submissions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  assignmentId: integer("assignment_id").notNull().references(() => mysteryAuditAssignmentsTable.id, { onDelete: "cascade" }),
  templateId: integer("template_id").notNull().references(() => mysteryAuditTemplatesTable.id, { onDelete: "restrict" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  auditorUserId: integer("auditor_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  status: text("status").$type<MysteryAuditSubmissionStatus>().notNull().default("draft"),
  visitDate: timestamp("visit_date"),
  generalNotes: text("general_notes"),
  // Per-category aggregates: [{ categoryId, name, weight, score, maxScore, percent }]
  categoryScores: jsonb("category_scores").$type<Array<{ categoryId: number; name: string; weight: number; score: number; maxScore: number; percent: number }>>().notNull().default([]),
  totalScore: decimal("total_score", { precision: 10, scale: 2 }).notNull().default("0"),
  totalMaxScore: decimal("total_max_score", { precision: 10, scale: 2 }).notNull().default("0"),
  weightedPercent: decimal("weighted_percent", { precision: 6, scale: 2 }).notNull().default("0"),
  submittedAt: timestamp("submitted_at"),
  lockedAt: timestamp("locked_at"),
  pdfObjectPath: text("pdf_object_path"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("mystery_audit_subs_tenant_idx").on(t.tenantId),
  index("mystery_audit_subs_restaurant_idx").on(t.restaurantId),
  index("mystery_audit_subs_assignment_idx").on(t.assignmentId),
  index("mystery_audit_subs_visit_idx").on(t.restaurantId, t.visitDate),
]);

export const mysteryAuditResponsesTable = pgTable("mystery_audit_responses", {
  id: serial("id").primaryKey(),
  submissionId: integer("submission_id").notNull().references(() => mysteryAuditSubmissionsTable.id, { onDelete: "cascade" }),
  itemId: integer("item_id").notNull().references(() => mysteryAuditItemsTable.id, { onDelete: "restrict" }),
  categoryId: integer("category_id").notNull().references(() => mysteryAuditCategoriesTable.id, { onDelete: "restrict" }),
  score: integer("score").notNull().default(0),
  maxScore: integer("max_score").notNull().default(5),
  notes: text("notes"),
  // Array of object-storage paths for uploaded photos.
  photos: jsonb("photos").$type<string[]>().notNull().default([]),
}, (t) => [
  index("mystery_audit_resp_submission_idx").on(t.submissionId),
]);

export const mysteryAuditCorrectiveActionsTable = pgTable("mystery_audit_corrective_actions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  submissionId: integer("submission_id").notNull().references(() => mysteryAuditSubmissionsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  responseId: integer("response_id").references(() => mysteryAuditResponsesTable.id, { onDelete: "set null" }),
  itemLabel: text("item_label"),
  categoryName: text("category_name"),
  description: text("description").notNull(),
  priority: text("priority").$type<MysteryAuditActionPriority>().notNull().default("medium"),
  status: text("status").$type<MysteryAuditActionStatus>().notNull().default("open"),
  assignedTo: integer("assigned_to").references(() => usersTable.id, { onDelete: "set null" }),
  dueDate: timestamp("due_date"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: integer("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
  resolutionNote: text("resolution_note"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("mystery_audit_actions_tenant_idx").on(t.tenantId),
  index("mystery_audit_actions_restaurant_idx").on(t.restaurantId),
  index("mystery_audit_actions_status_idx").on(t.status),
]);

export type MysteryAuditTemplate = typeof mysteryAuditTemplatesTable.$inferSelect;
export type MysteryAuditCategory = typeof mysteryAuditCategoriesTable.$inferSelect;
export type MysteryAuditItem = typeof mysteryAuditItemsTable.$inferSelect;
export type MysteryAuditAssignment = typeof mysteryAuditAssignmentsTable.$inferSelect;
export type MysteryAuditSubmission = typeof mysteryAuditSubmissionsTable.$inferSelect;
export type MysteryAuditResponse = typeof mysteryAuditResponsesTable.$inferSelect;
export type MysteryAuditCorrectiveAction = typeof mysteryAuditCorrectiveActionsTable.$inferSelect;
