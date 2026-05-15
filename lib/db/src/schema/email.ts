import { pgTable, text, serial, timestamp, integer, jsonb, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

export type EmailDriver = "smtp" | "sendgrid" | "mailgun" | "ses" | "custom";
export type EmailLogStatus = "queued" | "sent" | "delivered" | "bounced" | "failed";

export const emailProvidersTable = pgTable("email_providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  driver: text("driver").$type<EmailDriver>().notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  fromName: text("from_name").notNull().default(""),
  fromEmail: text("from_email").notNull().default(""),
  replyTo: text("reply_to"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const emailTemplatesTable = pgTable("email_templates", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  event: text("event"),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull().default(""),
  variables: jsonb("variables").$type<string[]>().notNull().default([]),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  keyIdx: uniqueIndex("email_templates_key_idx").on(t.key),
}));

export const emailLogsTable = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id),
  recipient: text("recipient").notNull(),
  templateKey: text("template_key"),
  templateId: integer("template_id").references(() => emailTemplatesTable.id),
  providerId: integer("provider_id").references(() => emailProvidersTable.id),
  providerDriver: text("provider_driver").$type<EmailDriver>(),
  subject: text("subject"),
  status: text("status").$type<EmailLogStatus>().notNull().default("queued"),
  providerMessageId: text("provider_message_id"),
  error: text("error"),
  retryOf: integer("retry_of"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  statusIdx: index("email_logs_status_idx").on(t.status),
  createdAtIdx: index("email_logs_created_at_idx").on(t.createdAt),
}));

export type EmailProvider = typeof emailProvidersTable.$inferSelect;
export type EmailTemplate = typeof emailTemplatesTable.$inferSelect;
export type EmailLog = typeof emailLogsTable.$inferSelect;
