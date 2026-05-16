import { pgTable, text, serial, timestamp, integer, boolean, jsonb, decimal, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

export const SOP_CATEGORIES = ["recipe", "cleaning", "opening", "closing", "hygiene", "fire_safety", "other"] as const;
export type SopCategory = (typeof SOP_CATEGORIES)[number];
export const SOP_CHECKLIST_CATEGORIES: SopCategory[] = ["cleaning", "opening", "closing", "hygiene", "fire_safety"];

export const STAFF_ROLES_FOR_TRAINING = ["owner", "manager", "cashier", "waiter", "kitchen", "delivery_executive"] as const;
export type StaffRoleForTraining = (typeof STAFF_ROLES_FOR_TRAINING)[number];

export const sopsTable = pgTable("sops", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  category: text("category").$type<SopCategory>().notNull().default("other"),
  content: text("content").notNull().default(""),
  attachments: jsonb("attachments").$type<Array<{ name: string; url: string; contentType?: string; size?: number }>>().notNull().default([]),
  visibleRoles: text("visible_roles").array().$type<StaffRoleForTraining[]>().notNull().default([]),
  version: integer("version").notNull().default(1),
  isPublished: boolean("is_published").notNull().default(false),
  publishedAt: timestamp("published_at"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  tenantIdx: index("sops_tenant_idx").on(t.tenantId),
}));

export const sopChecklistItemsTable = pgTable("sop_checklist_items", {
  id: serial("id").primaryKey(),
  sopId: integer("sop_id").notNull().references(() => sopsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isRequired: boolean("is_required").notNull().default(true),
});

export const sopChecklistRunsTable = pgTable("sop_checklist_runs", {
  id: serial("id").primaryKey(),
  sopId: integer("sop_id").notNull().references(() => sopsTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  performedBy: integer("performed_by").references(() => usersTable.id),
  performedByName: text("performed_by_name"),
  // Map of checklistItemId -> { checked: boolean, note?: string }
  results: jsonb("results").$type<Record<string, { checked: boolean; note?: string }>>().notNull().default({}),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  sopIdx: index("sop_checklist_runs_sop_idx").on(t.sopId),
}));

export const trainingCoursesTable = pgTable("training_courses", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  requiredRoles: text("required_roles").array().$type<StaffRoleForTraining[]>().notNull().default([]),
  isPublished: boolean("is_published").notNull().default(false),
  isOnboarding: boolean("is_onboarding").notNull().default(false),
  expiryMonths: integer("expiry_months"),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  passMarkPercent: integer("pass_mark_percent").notNull().default(70),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const trainingModulesTable = pgTable("training_modules", {
  id: serial("id").primaryKey(),
  courseId: integer("course_id").notNull().references(() => trainingCoursesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  videoUrl: text("video_url"),
  videoObjectPath: text("video_object_path"),
  documents: jsonb("documents").$type<Array<{ name: string; url: string }>>().notNull().default([]),
  linkedSopId: integer("linked_sop_id").references(() => sopsTable.id, { onDelete: "set null" }),
  body: text("body").default(""),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const trainingQuizQuestionsTable = pgTable("training_quiz_questions", {
  id: serial("id").primaryKey(),
  courseId: integer("course_id").notNull().references(() => trainingCoursesTable.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  options: jsonb("options").$type<string[]>().notNull().default([]),
  correctIndex: integer("correct_index").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const trainingAssignmentsTable = pgTable("training_assignments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  courseId: integer("course_id").notNull().references(() => trainingCoursesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // not_started | in_progress | awaiting_approval | completed | expired | rejected
  status: text("status").notNull().default("not_started"),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  expiresAt: timestamp("expires_at"),
  lastScore: integer("last_score"),
  attempts: integer("attempts").notNull().default(0),
}, t => ({
  uniq: uniqueIndex("training_assignments_user_course_idx").on(t.userId, t.courseId),
  tenantIdx: index("training_assignments_tenant_idx").on(t.tenantId),
}));

export const trainingAttemptsTable = pgTable("training_attempts", {
  id: serial("id").primaryKey(),
  assignmentId: integer("assignment_id").notNull().references(() => trainingAssignmentsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // Map of questionId -> chosenIndex
  answers: jsonb("answers").$type<Record<string, number>>().notNull().default({}),
  score: integer("score").notNull().default(0),
  totalQuestions: integer("total_questions").notNull().default(0),
  passed: boolean("passed").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const trainingApprovalsTable = pgTable("training_approvals", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  assignmentId: integer("assignment_id").notNull().references(() => trainingAssignmentsTable.id, { onDelete: "cascade" }),
  attemptId: integer("attempt_id").references(() => trainingAttemptsTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  reviewedBy: integer("reviewed_by").references(() => usersTable.id),
  reviewedAt: timestamp("reviewed_at"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const trainingCertificatesTable = pgTable("training_certificates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  assignmentId: integer("assignment_id").notNull().references(() => trainingAssignmentsTable.id, { onDelete: "cascade" }),
  courseId: integer("course_id").notNull().references(() => trainingCoursesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  certificateNumber: text("certificate_number").notNull().unique(),
  score: integer("score").notNull().default(0),
  issuedAt: timestamp("issued_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  pdfObjectPath: text("pdf_object_path"),
});

export type Sop = typeof sopsTable.$inferSelect;
export type SopChecklistItem = typeof sopChecklistItemsTable.$inferSelect;
export type SopChecklistRun = typeof sopChecklistRunsTable.$inferSelect;
export type TrainingCourse = typeof trainingCoursesTable.$inferSelect;
export type TrainingModule = typeof trainingModulesTable.$inferSelect;
export type TrainingQuizQuestion = typeof trainingQuizQuestionsTable.$inferSelect;
export type TrainingAssignment = typeof trainingAssignmentsTable.$inferSelect;
export type TrainingAttempt = typeof trainingAttemptsTable.$inferSelect;
export type TrainingApproval = typeof trainingApprovalsTable.$inferSelect;
export type TrainingCertificate = typeof trainingCertificatesTable.$inferSelect;
