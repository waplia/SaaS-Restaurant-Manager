import { pgTable, text, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

/**
 * Support SLA tier slug — drives per-plan SLA hour multipliers and the
 * availability of POS emergency tickets, live phone callbacks, and the
 * dedicated success contact.
 */
export type SupportTier = "standard" | "priority" | "enterprise";

/**
 * Per-priority escalation step. After `afterMinutes` past the relevant SLA
 * due time, the SLA breach sweep emails each address in `notifyEmails`
 * (in addition to the standard tenant/admin notifications) and bumps the
 * ticket's `escalationLevel`.
 */
export interface SlaEscalationStep {
  afterMinutes: number;
  notifyEmails: string[];
  label?: string;
}
export type SlaEscalationMatrix = Partial<Record<"low" | "normal" | "high" | "urgent", SlaEscalationStep[]>>;

/** Multipliers applied to baseline priority hours per SLA tier. */
export interface SlaTierConfig {
  firstResponseMultiplier: number;
  resolutionMultiplier: number;
  emergencyEnabled: boolean;
  callbackEnabled: boolean;
}
export type SlaTierMap = Partial<Record<SupportTier, SlaTierConfig>>;

export const DEFAULT_TIER_CONFIG: Record<SupportTier, SlaTierConfig> = {
  standard:   { firstResponseMultiplier: 1,    resolutionMultiplier: 1,    emergencyEnabled: false, callbackEnabled: false },
  priority:   { firstResponseMultiplier: 0.5,  resolutionMultiplier: 0.5,  emergencyEnabled: true,  callbackEnabled: true  },
  enterprise: { firstResponseMultiplier: 0.25, resolutionMultiplier: 0.25, emergencyEnabled: true,  callbackEnabled: true  },
};

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
  // Task #436 — Support SLA & Emergency Support.
  // True when the requester filed a POS emergency. Forces priority=urgent
  // and is gated on the plan's SLA tier (`emergencyEnabled`).
  isEmergency: boolean("is_emergency").notNull().default(false),
  // Highest escalation level fired so far. The breach sweep walks the
  // escalation matrix and uses this to skip steps that have already fired.
  escalationLevel: integer("escalation_level").notNull().default(0),
  lastEscalatedAt: timestamp("last_escalated_at"),
  firstResponseBreachNotifiedAt: timestamp("first_response_breach_notified_at"),
  resolutionBreachNotifiedAt: timestamp("resolution_breach_notified_at"),
  // CSAT (1-5) collected after the ticket is resolved/closed.
  satisfactionRating: integer("satisfaction_rating"),
  satisfactionComment: text("satisfaction_comment"),
  satisfactionAt: timestamp("satisfaction_at"),
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
  | "reopened"
  | "sla_breached";

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
  // Task #436. Per-priority escalation steps. Each step fires once when
  // (now - sla_due_at) >= afterMinutes and the ticket is still open.
  escalationMatrix: jsonb("escalation_matrix").$type<SlaEscalationMatrix>().notNull().default({}),
  // Per-tier multipliers + capability toggles. Falls back to DEFAULT_TIER_CONFIG.
  tierConfig: jsonb("tier_config").$type<SlaTierMap>().notNull().default({}),
  // Optional live-chat / WhatsApp URL shown to tenants whose tier enables it.
  liveChatUrl: text("live_chat_url"),
  // Public status page toggles + branding.
  statusPageEnabled: boolean("status_page_enabled").notNull().default(true),
  statusPageTitle: text("status_page_title").notNull().default("System Status"),
  statusPageDescription: text("status_page_description").notNull().default("Current status of all TableTrack services."),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * POS emergency / phone-callback request raised by a tenant. Distinct from
 * a regular ticket so the on-call rota can triage them in a dedicated queue
 * without polluting the standard ticket SLA timers.
 */
export const supportCallbackRequestsTable = pgTable("support_callback_requests", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  requesterId: integer("requester_id").references(() => usersTable.id),
  requesterName: text("requester_name"),
  phone: text("phone").notNull(),
  preferredTime: text("preferred_time"),
  topic: text("topic"),
  notes: text("notes"),
  // pending | acknowledged | scheduled | completed | cancelled
  status: text("status").notNull().default("pending"),
  handlerId: integer("handler_id").references(() => usersTable.id),
  handlerNote: text("handler_note"),
  acknowledgedAt: timestamp("acknowledged_at"),
  completedAt: timestamp("completed_at"),
  ticketId: integer("ticket_id").references(() => supportTicketsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SupportIncidentStatus = "investigating" | "identified" | "monitoring" | "resolved";
export type SupportIncidentSeverity = "minor" | "major" | "critical";

/**
 * Public status-page incident. Authored by super-admins; visible at
 * `/status` without auth. Each `supportIncidentUpdatesTable` row appends a
 * timestamped status update.
 */
export const supportIncidentsTable = pgTable("support_incidents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  status: text("status").$type<SupportIncidentStatus>().notNull().default("investigating"),
  severity: text("severity").$type<SupportIncidentSeverity>().notNull().default("minor"),
  affectedComponents: text("affected_components").array().notNull().default([]),
  isPublished: boolean("is_published").notNull().default(true),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const supportIncidentUpdatesTable = pgTable("support_incident_updates", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull().references(() => supportIncidentsTable.id, { onDelete: "cascade" }),
  status: text("status").$type<SupportIncidentStatus>().notNull(),
  body: text("body").notNull(),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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

export type SupportCallbackRequest = typeof supportCallbackRequestsTable.$inferSelect;
export const insertSupportCallbackRequestSchema = createInsertSchema(supportCallbackRequestsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupportCallbackRequest = z.infer<typeof insertSupportCallbackRequestSchema>;

export type SupportIncident = typeof supportIncidentsTable.$inferSelect;
export type SupportIncidentUpdate = typeof supportIncidentUpdatesTable.$inferSelect;
export const insertSupportIncidentSchema = createInsertSchema(supportIncidentsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupportIncident = z.infer<typeof insertSupportIncidentSchema>;
