import { pgTable, serial, varchar, text, timestamp, integer, boolean, jsonb, decimal, index, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { restaurantsTable } from "./restaurants";
import { customersTable } from "./customers";

export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  restaurantName: varchar("restaurant_name", { length: 200 }),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 200 }).notNull(),
  city: varchar("city", { length: 120 }),
  outletCount: integer("outlet_count"),
  businessType: varchar("business_type", { length: 80 }),
  currentSoftware: varchar("current_software", { length: 200 }),
  preferredDateTime: varchar("preferred_date_time", { length: 120 }),
  features: text("features"),
  message: text("message"),
  sourcePage: varchar("source_page", { length: 120 }).notNull().default("contact"),
  status: varchar("status", { length: 30 }).notNull().default("new"),
  notes: text("notes"),
  assignedTo: integer("assigned_to").references(() => usersTable.id, { onDelete: "set null" }),
  followUpAt: timestamp("follow_up_at", { withTimezone: true }),
  followUpNote: text("follow_up_note"),
  convertedRestaurantId: integer("converted_restaurant_id").references(() => restaurantsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const leadNotesTable = pgTable("lead_notes", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  authorId: integer("author_id").references(() => usersTable.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const leadActivityTable = pgTable("lead_activity", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  type: varchar("type", { length: 50 }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const blogPostsTable = pgTable("blog_posts", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 200 }).notNull().unique(),
  title: varchar("title", { length: 300 }).notNull(),
  excerpt: text("excerpt"),
  content: text("content").notNull(),
  coverImage: varchar("cover_image", { length: 500 }),
  category: varchar("category", { length: 80 }).notNull().default("guides"),
  tags: text("tags"),
  author: varchar("author", { length: 120 }).notNull().default("KhanaLagao Team"),
  readMinutes: integer("read_minutes").notNull().default(5),
  published: boolean("published").notNull().default(true),
  publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Lead = typeof leadsTable.$inferSelect;
export type NewLead = typeof leadsTable.$inferInsert;
export type LeadNote = typeof leadNotesTable.$inferSelect;
export type LeadActivity = typeof leadActivityTable.$inferSelect;
export type BlogPost = typeof blogPostsTable.$inferSelect;
export type NewBlogPost = typeof blogPostsTable.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// Growth Engine — campaigns (Task #516 marketing platform rebuild)
// ────────────────────────────────────────────────────────────────────
// `type` and `goal` are open text so we can add templates over time
// without migrations. The wizard UI is the source of truth for valid
// values; the backend just validates against an allow-list.
export const campaignsTable = pgTable("growth_campaigns", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  type: varchar("type", { length: 60 }).notNull(),
  channel: varchar("channel", { length: 30 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  audience: jsonb("audience").$type<Record<string, unknown>>().notNull().default({}),
  content: jsonb("content").$type<Record<string, unknown>>().notNull().default({}),
  stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  // Task #516 — marketing-platform rebuild.
  goal: varchar("goal", { length: 40 }).notNull().default("retention"),
  isOmnichannel: boolean("is_omnichannel").notNull().default(false),
  channels: jsonb("channels").$type<Array<{ channel: string; templateKey?: string; templateId?: number; order: number }>>().notNull().default([]),
  scheduleKind: varchar("schedule_kind", { length: 20 }).notNull().default("now"), // now | scheduled | recurring
  recurrence: jsonb("recurrence").$type<{ frequency?: "daily"|"weekly"|"monthly"; dayOfWeek?: number; dayOfMonth?: number; hour?: number; minute?: number; until?: string } | null>(),
  timezone: varchar("timezone", { length: 80 }).notNull().default("Asia/Kolkata"),
  attributionWindowHours: integer("attribution_window_hours").notNull().default(72),
  isTest: boolean("is_test").notNull().default(false),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  lastDispatchedAt: timestamp("last_dispatched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byRestStatus: index("growth_campaigns_rest_status_idx").on(t.restaurantId, t.status),
  byNextRun: index("growth_campaigns_schedule_idx").on(t.status, t.scheduledAt),
}));

// Omnichannel step plan: ordered sequence of (channel, template, delay).
export const campaignStepsTable = pgTable("growth_campaign_steps", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  order: integer("order").notNull().default(0),
  channel: varchar("channel", { length: 30 }).notNull(),
  templateKey: varchar("template_key", { length: 120 }),
  templateId: integer("template_id"),
  content: jsonb("content").$type<{ subject?: string; body?: string; html?: string; ctaUrl?: string; ctaText?: string; title?: string }>().notNull().default({}),
  delayMinutes: integer("delay_minutes").notNull().default(0),
  waitForEvent: varchar("wait_for_event", { length: 40 }), // e.g. "no_open" | "no_click" | "no_conversion"
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byCampaign: index("growth_campaign_steps_campaign_idx").on(t.campaignId, t.order),
}));

// Per-customer enrollment in a campaign — tracks where each recipient is
// in the omnichannel funnel. The dispatcher pulls due rows on each tick.
export const campaignEnrollmentsTable = pgTable("growth_campaign_enrollments", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  currentStepOrder: integer("current_step_order").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default("active"), // active | completed | converted | exited
  nextSendAt: timestamp("next_send_at", { withTimezone: true }),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  lastChannel: varchar("last_channel", { length: 30 }),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  conversionOrderId: integer("conversion_order_id"),
  conversionRevenue: decimal("conversion_revenue", { precision: 10, scale: 2 }),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uniq: uniqueIndex("growth_enrollments_uniq_idx").on(t.campaignId, t.customerId),
  byDue: index("growth_enrollments_due_idx").on(t.status, t.nextSendAt),
}));

// Per-send log row — one row per (recipient, step) dispatch.
export const campaignLogsTable = pgTable("growth_campaign_logs", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  event: varchar("event", { length: 40 }).notNull(), // created | updated | dispatched | sent | failed | skipped | converted | opened | clicked
  actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  // Task #516 — richer per-recipient send tracking.
  stepId: integer("step_id"),
  channel: varchar("channel", { length: 30 }),
  customerId: integer("customer_id"),
  cost: decimal("cost", { precision: 10, scale: 4 }),
  providerMessageId: text("provider_message_id"),
  errorReason: text("error_reason"),
  contentSnapshot: jsonb("content_snapshot").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byCampaign: index("growth_campaign_logs_campaign_idx").on(t.campaignId, t.createdAt),
  byCustomer: index("growth_campaign_logs_customer_idx").on(t.customerId),
}));

// ────────────────────────────────────────────────────────────────────
// Per-channel marketing templates (parallel to emailMarketingTemplates).
// ────────────────────────────────────────────────────────────────────
const marketingTemplateCols = {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }),
  key: varchar("key", { length: 120 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  category: varchar("category", { length: 60 }).notNull().default("general"),
  body: text("body").notNull(),
  isGlobal: boolean("is_global").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const smsMarketingTemplatesTable = pgTable("sms_marketing_templates", {
  ...marketingTemplateCols,
});

export const whatsappMarketingTemplatesTable = pgTable("whatsapp_marketing_templates", {
  ...marketingTemplateCols,
  metaTemplateName: varchar("meta_template_name", { length: 200 }),
  language: varchar("language", { length: 20 }).notNull().default("en"),
});

export const webPushMarketingTemplatesTable = pgTable("web_push_marketing_templates", {
  ...marketingTemplateCols,
  title: varchar("title", { length: 200 }).notNull().default(""),
  iconUrl: text("icon_url"),
  imageUrl: text("image_url"),
  clickUrl: text("click_url"),
});

// Per-channel suppression lists.
const suppressionCols = {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  identifier: varchar("identifier", { length: 200 }).notNull(), // phone / endpoint / email
  reason: varchar("reason", { length: 60 }).notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
};

export const smsSuppressionListTable = pgTable("sms_suppression_list", {
  ...suppressionCols,
}, (t) => ({
  uniq: uniqueIndex("sms_suppression_uniq_idx").on(t.restaurantId, t.identifier),
}));

export const whatsappSuppressionListTable = pgTable("whatsapp_suppression_list", {
  ...suppressionCols,
}, (t) => ({
  uniq: uniqueIndex("whatsapp_suppression_uniq_idx").on(t.restaurantId, t.identifier),
}));

export const webPushSuppressionListTable = pgTable("web_push_suppression_list", {
  ...suppressionCols,
}, (t) => ({
  uniq: uniqueIndex("web_push_suppression_uniq_idx").on(t.restaurantId, t.identifier),
}));

export type Campaign = typeof campaignsTable.$inferSelect;
export type NewCampaign = typeof campaignsTable.$inferInsert;
export type CampaignLog = typeof campaignLogsTable.$inferSelect;
export type CampaignStep = typeof campaignStepsTable.$inferSelect;
export type NewCampaignStep = typeof campaignStepsTable.$inferInsert;
export type CampaignEnrollment = typeof campaignEnrollmentsTable.$inferSelect;
export type SmsMarketingTemplate = typeof smsMarketingTemplatesTable.$inferSelect;
export type WhatsappMarketingTemplate = typeof whatsappMarketingTemplatesTable.$inferSelect;
export type WebPushMarketingTemplate = typeof webPushMarketingTemplatesTable.$inferSelect;
