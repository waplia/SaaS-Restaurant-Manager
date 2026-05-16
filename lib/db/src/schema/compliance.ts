import { pgTable, text, serial, timestamp, integer, decimal, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";
import { suppliersTable } from "./inventory";

/**
 * Documents/licenses tracked by the Compliance Manager. The `type` field is a
 * loose string (rather than a pg enum) so new categories can be added without a
 * migration; the UI/API enforce a canonical list.
 */
export const complianceDocumentsTable = pgTable(
  "compliance_documents",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    type: text("type").notNull(),
    title: text("title"),
    documentNumber: text("document_number"),
    issuingAuthority: text("issuing_authority"),
    issueDate: timestamp("issue_date"),
    expiryDate: timestamp("expiry_date"),
    fileUrl: text("file_url"),
    renewalCost: decimal("renewal_cost", { precision: 12, scale: 2 }),
    linkedVendorId: integer("linked_vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
    linkedStaffId: integer("linked_staff_id").references(() => usersTable.id, { onDelete: "set null" }),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    reminderDismissedUntil: timestamp("reminder_dismissed_until"),
    lastReminderStage: text("last_reminder_stage"),
    lastReminderAt: timestamp("last_reminder_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("compliance_docs_rest_expiry_idx").on(t.restaurantId, t.expiryDate),
    index("compliance_docs_rest_type_idx").on(t.restaurantId, t.type),
  ],
);

export const complianceContactsTable = pgTable(
  "compliance_contacts",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("compliance_contacts_unique").on(t.restaurantId, t.userId),
  ],
);

export const insertComplianceDocumentSchema = createInsertSchema(complianceDocumentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertComplianceDocument = z.infer<typeof insertComplianceDocumentSchema>;
export type ComplianceDocument = typeof complianceDocumentsTable.$inferSelect;

export type ComplianceContact = typeof complianceContactsTable.$inferSelect;

/** Canonical compliance document categories. India-specific types + "other". */
export const COMPLIANCE_DOC_TYPES = [
  "fssai",
  "gst",
  "fire_noc",
  "shop_act",
  "labour",
  "hygiene_audit",
  "staff_document",
  "vendor_gst",
  "other",
] as const;
export type ComplianceDocType = typeof COMPLIANCE_DOC_TYPES[number];

/** India required document types, used to compute "missing required" cards. */
export const COMPLIANCE_REQUIRED_BY_COUNTRY: Record<string, ComplianceDocType[]> = {
  IN: ["fssai", "gst", "fire_noc", "shop_act"],
};

/** Reminder cadence (days BEFORE expiry). 0 = on the day. */
export const COMPLIANCE_REMINDER_STAGES = [60, 30, 15, 7, 1, 0] as const;
