import { pgTable, serial, varchar, text, timestamp, integer, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { restaurantsTable, branchesTable } from "./restaurants";
import { usersTable } from "./users";

// Built-in categories. Extra categories can still be stored as text — these
// are the canonical set the UI exposes.
export const DOCUMENT_CATEGORIES = [
  "fssai", "gst", "rent", "staff", "vendor", "franchise", "fire",
  "bank", "insurance", "payroll", "tax", "invoice", "compliance", "other",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_STATUSES = ["active", "archived", "deleted"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  category: varchar("category", { length: 40 }).notNull().default("other"),
  title: varchar("title", { length: 250 }).notNull(),
  description: text("description"),
  fileName: varchar("file_name", { length: 256 }).notNull(),
  mimeType: varchar("mime_type", { length: 128 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  objectPath: varchar("object_path", { length: 600 }).notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  // Issue / expiry
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  reminderDays: integer("reminder_days").notNull().default(30),
  lastReminderSentAt: timestamp("last_reminder_sent_at", { withTimezone: true }),
  // Compliance / structured fields
  referenceNumber: varchar("reference_number", { length: 120 }),
  issuer: varchar("issuer", { length: 200 }),
  isRequired: boolean("is_required").notNull().default(false),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  // Versioning (latest version metadata also stored on this row)
  version: integer("version").notNull().default(1),
  // Audit trail
  uploadedBy: integer("uploaded_by").references(() => usersTable.id, { onDelete: "set null" }),
  lastModifiedBy: integer("last_modified_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  restaurantCategoryIdx: index("documents_rest_cat_idx").on(t.restaurantId, t.category, t.status),
  expiresIdx: index("documents_expires_idx").on(t.expiresAt),
}));

export const documentVersionsTable = pgTable("document_versions", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull().references(() => documentsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  objectPath: varchar("object_path", { length: 600 }).notNull(),
  fileName: varchar("file_name", { length: 256 }).notNull(),
  mimeType: varchar("mime_type", { length: 128 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  note: text("note"),
  uploadedBy: integer("uploaded_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  docVersionUq: uniqueIndex("doc_versions_doc_version_uq").on(t.documentId, t.version),
}));

// Per-document explicit ACL grant. principalType=role uses role name in
// principalRef ("manager","accountant","owner","staff","super_admin"); for
// principalType=user, principalRef is the numeric user id as string.
export const DOCUMENT_PERMISSIONS = ["view", "download", "edit", "delete"] as const;
export type DocumentPermission = (typeof DOCUMENT_PERMISSIONS)[number];

export const documentPermissionsTable = pgTable("document_permissions", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  documentId: integer("document_id").notNull().references(() => documentsTable.id, { onDelete: "cascade" }),
  principalType: varchar("principal_type", { length: 10 }).notNull(), // role | user
  principalRef: varchar("principal_ref", { length: 60 }).notNull(),
  permission: varchar("permission", { length: 12 }).notNull(),
  grantedBy: integer("granted_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  docPrincipalIdx: index("doc_perm_doc_principal_idx").on(t.documentId, t.principalType, t.principalRef),
  docGrantUq: uniqueIndex("doc_perm_unique_grant_uq").on(t.documentId, t.principalType, t.principalRef, t.permission),
}));

// Default permissions per (restaurant, category, role). Evaluated when no
// per-doc grant exists.
export const documentCategoryDefaultsTable = pgTable("document_category_defaults", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  category: varchar("category", { length: 40 }).notNull(),
  role: varchar("role", { length: 40 }).notNull(),
  permissions: jsonb("permissions").$type<DocumentPermission[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  catDefaultUq: uniqueIndex("doc_cat_default_uq").on(t.restaurantId, t.category, t.role),
}));

export const documentAuditLogTable = pgTable("document_audit_log", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  documentId: integer("document_id").references(() => documentsTable.id, { onDelete: "set null" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userDisplay: varchar("user_display", { length: 200 }),
  action: varchar("action", { length: 40 }).notNull(),
  details: jsonb("details").$type<Record<string, unknown>>(),
  ipAddress: varchar("ip_address", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  docAuditDocIdx: index("doc_audit_doc_idx").on(t.documentId, t.createdAt),
  docAuditRestIdx: index("doc_audit_rest_idx").on(t.restaurantId, t.createdAt),
}));

export type Document = typeof documentsTable.$inferSelect;
export type NewDocument = typeof documentsTable.$inferInsert;
export type DocumentVersion = typeof documentVersionsTable.$inferSelect;
export type DocumentPermissionRow = typeof documentPermissionsTable.$inferSelect;
export type DocumentCategoryDefault = typeof documentCategoryDefaultsTable.$inferSelect;
export type DocumentAuditLog = typeof documentAuditLogTable.$inferSelect;
