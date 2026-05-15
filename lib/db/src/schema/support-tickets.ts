import { pgTable, text, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStatus =
  | "open"
  | "pending"
  | "in_progress"
  | "waiting_customer"
  | "resolved"
  | "closed";

export const supportTicketCategoriesTable = pgTable("support_ticket_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  defaultPriority: text("default_priority").$type<TicketPriority>().notNull().default("normal"),
  // Per-category SLA overrides (in hours). Null means use the priority default.
  firstResponseHours: integer("first_response_hours"),
  resolutionHours: integer("resolution_hours"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const supportTicketsTable = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  ticketNumber: text("ticket_number").notNull().unique(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  requesterId: integer("requester_id").references(() => usersTable.id),
  categoryId: integer("category_id").references(() => supportTicketCategoriesTable.id),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  status: text("status").$type<TicketStatus>().notNull().default("open"),
  priority: text("priority").$type<TicketPriority>().notNull().default("normal"),
  assigneeId: integer("assignee_id").references(() => usersTable.id),
  // Per-ticket SLA overrides (hours). Null means inherit from category/priority.
  slaFirstResponseHours: integer("sla_first_response_hours"),
  slaResolutionHours: integer("sla_resolution_hours"),
  // Computed at create / on changes for fast filtering.
  firstResponseDueAt: timestamp("first_response_due_at"),
  resolutionDueAt: timestamp("resolution_due_at"),
  firstResponseAt: timestamp("first_response_at"),
  resolvedAt: timestamp("resolved_at"),
  closedAt: timestamp("closed_at"),
  // Total time the ticket has spent in "Waiting for Customer" (ms).
  pausedMs: integer("paused_ms").notNull().default(0),
  pausedAt: timestamp("paused_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const supportTicketRepliesTable = pgTable("support_ticket_replies", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => supportTicketsTable.id, { onDelete: "cascade" }),
  authorId: integer("author_id").references(() => usersTable.id),
  authorName: text("author_name"),
  authorIsAdmin: boolean("author_is_admin").notNull().default(false),
  isInternal: boolean("is_internal").notNull().default(false),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const supportTicketAttachmentsTable = pgTable("support_ticket_attachments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => supportTicketsTable.id, { onDelete: "cascade" }),
  replyId: integer("reply_id").references(() => supportTicketRepliesTable.id, { onDelete: "cascade" }),
  uploadedById: integer("uploaded_by_id").references(() => usersTable.id),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  objectPath: text("object_path").notNull(),
  isInternal: boolean("is_internal").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type TicketEventType =
  | "created"
  | "status_changed"
  | "priority_changed"
  | "category_changed"
  | "assignee_changed"
  | "reply_posted"
  | "internal_note_added"
  | "attachment_added"
  | "reopened";

export const supportTicketEventsTable = pgTable("support_ticket_events", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => supportTicketsTable.id, { onDelete: "cascade" }),
  actorId: integer("actor_id").references(() => usersTable.id),
  actorName: text("actor_name"),
  actorIsAdmin: boolean("actor_is_admin").notNull().default(false),
  type: text("type").$type<TicketEventType>().notNull(),
  fromValue: text("from_value"),
  toValue: text("to_value"),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Singleton "row-id=1" record holding default SLA hours per priority.
export const supportSlaSettingsTable = pgTable("support_sla_settings", {
  id: serial("id").primaryKey(),
  // First response SLA (hours).
  lowFirstResponseHours: integer("low_first_response_hours").notNull().default(48),
  normalFirstResponseHours: integer("normal_first_response_hours").notNull().default(24),
  highFirstResponseHours: integer("high_first_response_hours").notNull().default(8),
  urgentFirstResponseHours: integer("urgent_first_response_hours").notNull().default(2),
  // Resolution SLA (hours).
  lowResolutionHours: integer("low_resolution_hours").notNull().default(168),
  normalResolutionHours: integer("normal_resolution_hours").notNull().default(72),
  highResolutionHours: integer("high_resolution_hours").notNull().default(24),
  urgentResolutionHours: integer("urgent_resolution_hours").notNull().default(8),
  maxAttachmentMb: integer("max_attachment_mb").notNull().default(10),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTicketCategorySchema = createInsertSchema(supportTicketCategoriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTicketCategory = z.infer<typeof insertTicketCategorySchema>;
export type TicketCategory = typeof supportTicketCategoriesTable.$inferSelect;

export const insertSupportTicketSchema = createInsertSchema(supportTicketsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTicketsTable.$inferSelect;

export type SupportTicketReply = typeof supportTicketRepliesTable.$inferSelect;
export type SupportTicketAttachment = typeof supportTicketAttachmentsTable.$inferSelect;
export type SupportTicketEvent = typeof supportTicketEventsTable.$inferSelect;
export type SupportSlaSettings = typeof supportSlaSettingsTable.$inferSelect;
