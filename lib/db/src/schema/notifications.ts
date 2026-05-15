import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export type BroadcastChannel = "in_app" | "email" | "sms" | "whatsapp" | "push";
export type BroadcastStatus = "draft" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";
export type DeliveryStatus = "pending" | "sent" | "failed" | "skipped";

export type AudienceFilter = {
  type: "all" | "tenants" | "plan_status" | "plan" | "role" | "country" | "city";
  ids?: number[];
  values?: string[];
};

export const notificationTemplatesTable = pgTable("notification_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  channel: text("channel").$type<BroadcastChannel>().notNull().default("in_app"),
  subject: text("subject"),
  body: text("body").notNull(),
  variables: jsonb("variables").$type<string[]>().notNull().default([]),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const notificationBroadcastsTable = pgTable("notification_broadcasts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  subject: text("subject"),
  channels: text("channels").array().$type<BroadcastChannel[]>().notNull().default([]),
  audience: jsonb("audience").$type<AudienceFilter>().notNull().default({ type: "all" }),
  templateId: integer("template_id").references(() => notificationTemplatesTable.id),
  status: text("status").$type<BroadcastStatus>().notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  totalRecipients: integer("total_recipients").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const notificationDeliveriesTable = pgTable("notification_deliveries", {
  id: serial("id").primaryKey(),
  broadcastId: integer("broadcast_id").notNull().references(() => notificationBroadcastsTable.id, { onDelete: "cascade" }),
  channel: text("channel").$type<BroadcastChannel>().notNull(),
  tenantId: integer("tenant_id"),
  userId: integer("user_id"),
  recipient: text("recipient"),
  status: text("status").$type<DeliveryStatus>().notNull().default("pending"),
  error: text("error"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertNotificationTemplateSchema = createInsertSchema(notificationTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNotificationTemplate = z.infer<typeof insertNotificationTemplateSchema>;
export type NotificationTemplate = typeof notificationTemplatesTable.$inferSelect;

export const insertNotificationBroadcastSchema = createInsertSchema(notificationBroadcastsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNotificationBroadcast = z.infer<typeof insertNotificationBroadcastSchema>;
export type NotificationBroadcast = typeof notificationBroadcastsTable.$inferSelect;

export type NotificationDelivery = typeof notificationDeliveriesTable.$inferSelect;
