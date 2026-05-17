import { pgTable, text, serial, timestamp, integer, jsonb, boolean, uniqueIndex, index, date } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";
import { restaurantsTable } from "./restaurants";

export type EmailDriver = "smtp" | "sendgrid" | "mailgun" | "ses" | "resend" | "postmark" | "custom";
export type EmailLogStatus = "queued" | "sent" | "delivered" | "bounced" | "failed";
export type EmailTemplateCategory = "transactional" | "lifecycle" | "marketing";

export const emailProvidersTable = pgTable("email_providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  driver: text("driver").$type<EmailDriver>().notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  fromName: text("from_name").notNull().default(""),
  fromEmail: text("from_email").notNull().default(""),
  replyTo: text("reply_to"),
  bounceEmail: text("bounce_email"),
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
  category: text("category").$type<EmailTemplateCategory>().notNull().default("transactional"),
  subject: text("subject").notNull().default(""),
  preheader: text("preheader").notNull().default(""),
  body: text("body").notNull().default(""),
  plainText: text("plain_text").notNull().default(""),
  headerLogo: text("header_logo"),
  footerText: text("footer_text").notNull().default(""),
  brandColor: text("brand_color").notNull().default("#f97316"),
  ctaLabel: text("cta_label"),
  ctaUrl: text("cta_url"),
  variables: jsonb("variables").$type<string[]>().notNull().default([]),
  businessTypes: jsonb("business_types").$type<string[]>().notNull().default([]),
  planRestrictions: jsonb("plan_restrictions").$type<number[]>().notNull().default([]),
  isEnabled: boolean("is_enabled").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  isGlobal: boolean("is_global").notNull().default(true),
  isHidden: boolean("is_hidden").notNull().default(false),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  keyIdx: uniqueIndex("email_templates_key_idx").on(t.key),
  categoryIdx: index("email_templates_category_idx").on(t.category),
}));

export const emailTemplateVersionsTable = pgTable("email_template_versions", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => emailTemplatesTable.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  subject: text("subject").notNull().default(""),
  preheader: text("preheader").notNull().default(""),
  body: text("body").notNull().default(""),
  plainText: text("plain_text").notNull().default(""),
  ctaLabel: text("cta_label"),
  ctaUrl: text("cta_url"),
  changedBy: integer("changed_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byTemplate: index("email_template_versions_template_idx").on(t.templateId, t.versionNumber),
}));

export const emailLogsTable = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id),
  restaurantId: integer("restaurant_id"),
  recipient: text("recipient").notNull(),
  recipientType: text("recipient_type").notNull().default("user"),
  templateKey: text("template_key"),
  templateId: integer("template_id").references(() => emailTemplatesTable.id),
  providerId: integer("provider_id").references(() => emailProvidersTable.id),
  providerDriver: text("provider_driver").$type<EmailDriver>(),
  subject: text("subject"),
  htmlSnapshot: text("html_snapshot"),
  status: text("status").$type<EmailLogStatus>().notNull().default("queued"),
  providerMessageId: text("provider_message_id"),
  trackingToken: text("tracking_token"),
  error: text("error"),
  retryOf: integer("retry_of"),
  campaignId: integer("campaign_id"),
  automationId: integer("automation_id"),
  sequenceId: integer("sequence_id"),
  sequenceStepId: integer("sequence_step_id"),
  enrollmentId: integer("enrollment_id"),
  openedAt: timestamp("opened_at"),
  openCount: integer("open_count").notNull().default(0),
  clickedAt: timestamp("clicked_at"),
  clickCount: integer("click_count").notNull().default(0),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  statusIdx: index("email_logs_status_idx").on(t.status),
  createdAtIdx: index("email_logs_created_at_idx").on(t.createdAt),
  trackingIdx: index("email_logs_tracking_idx").on(t.trackingToken),
  campaignIdx: index("email_logs_campaign_idx").on(t.campaignId),
  sequenceIdx: index("email_logs_sequence_idx").on(t.sequenceId),
  automationIdx: index("email_logs_automation_idx").on(t.automationId),
}));

// Per-event tracking. Each open/click/unsubscribe writes a row here, in
// addition to the denormalized counters on email_logs.
export const emailTrackingEventsTable = pgTable("email_tracking_events", {
  id: serial("id").primaryKey(),
  logId: integer("log_id").references(() => emailLogsTable.id, { onDelete: "cascade" }),
  trackingToken: text("tracking_token"),
  eventType: text("event_type").notNull(), // open | click | unsubscribe | bounce | complaint
  url: text("url"),
  userAgent: text("user_agent"),
  ip: text("ip"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byLog: index("email_tracking_events_log_idx").on(t.logId),
  byType: index("email_tracking_events_type_idx").on(t.eventType),
}));

// Suppression list — hard bounces, spam complaints, manual blocks. The
// emailUnsubscribesTable below stores marketing opt-outs separately so a
// transactional bounce does not also block transactional retries.
export const emailSuppressionListTable = pgTable("email_suppression_list", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  scope: text("scope").notNull().default("all"), // all | marketing | transactional
  reason: text("reason").notNull().default("manual"), // bounce | complaint | manual | unsubscribe
  source: text("source"),
  tenantId: integer("tenant_id").references(() => tenantsTable.id),
  restaurantId: integer("restaurant_id"),
  notes: text("notes"),
  addedBy: integer("added_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  emailIdx: index("email_suppression_email_idx").on(t.email),
  uniq: uniqueIndex("email_suppression_email_scope_idx").on(t.email, t.scope),
}));

// Per-recipient unsubscribe records for marketing emails — links from one
// recipient (customer email) to either one restaurant or all marketing.
export const emailUnsubscribesTable = pgTable("email_unsubscribes", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  restaurantId: integer("restaurant_id"),
  scope: text("scope").notNull().default("all"), // restaurant | all
  reason: text("reason"),
  source: text("source").notNull().default("user"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  emailIdx: index("email_unsub_email_idx").on(t.email),
  uniq: uniqueIndex("email_unsub_email_rest_idx").on(t.email, t.restaurantId),
}));

// Read-only registry of supported template variables, grouped by domain.
export const emailTemplateVariablesTable = pgTable("email_template_variables", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull(), // global | restaurant | plan | lead | support | ai | customer
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  example: text("example").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("email_template_variables_uniq_idx").on(t.domain, t.name),
}));

// ─── Follow-up Sequences ─────────────────────────────────────────
export const emailSequencesTable = pgTable("email_sequences", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  trigger: text("trigger").notNull(), // signup | demo_lead_created | trial_started | payment_failed | inactive_restaurant | manual
  isEnabled: boolean("is_enabled").notNull().default(true),
  stopRules: jsonb("stop_rules").$type<Array<{ type: string; value?: unknown }>>().notNull().default([]),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  keyIdx: uniqueIndex("email_sequences_key_idx").on(t.key),
}));

export const emailSequenceStepsTable = pgTable("email_sequence_steps", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").notNull().references(() => emailSequencesTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  delayHours: integer("delay_hours").notNull().default(0),
  templateKey: text("template_key").notNull(),
  conditionJson: jsonb("condition_json").$type<Record<string, unknown> | null>(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  label: text("label").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  bySequence: index("email_sequence_steps_seq_idx").on(t.sequenceId, t.position),
}));

export const emailSequenceEnrollmentsTable = pgTable("email_sequence_enrollments", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").notNull().references(() => emailSequencesTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "set null" }),
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name"),
  context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
  currentStep: integer("current_step").notNull().default(0),
  status: text("status").notNull().default("active"), // active | completed | stopped | failed
  stopReason: text("stop_reason"),
  nextRunAt: timestamp("next_run_at").notNull().defaultNow(),
  lastRunAt: timestamp("last_run_at"),
  enrolledAt: timestamp("enrolled_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (t) => ({
  bySequence: index("email_sequence_enrollments_seq_idx").on(t.sequenceId, t.status),
  byNext: index("email_sequence_enrollments_next_idx").on(t.nextRunAt, t.status),
}));

// ─── Automation Flows ────────────────────────────────────────────
export const emailAutomationsTable = pgTable("email_automations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  trigger: text("trigger").notNull(),
  conditionJson: jsonb("condition_json").$type<Record<string, unknown>>().notNull().default({}),
  actions: jsonb("actions").$type<Array<{ type: string; params?: Record<string, unknown> }>>().notNull().default([]),
  isEnabled: boolean("is_enabled").notNull().default(true),
  runCount: integer("run_count").notNull().default(0),
  lastRunAt: timestamp("last_run_at"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  triggerIdx: index("email_automations_trigger_idx").on(t.trigger, t.isEnabled),
}));

export const emailAutomationRunsTable = pgTable("email_automation_runs", {
  id: serial("id").primaryKey(),
  automationId: integer("automation_id").notNull().references(() => emailAutomationsTable.id, { onDelete: "cascade" }),
  trigger: text("trigger").notNull(),
  context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
  matched: boolean("matched").notNull().default(false),
  actionsRun: integer("actions_run").notNull().default(0),
  status: text("status").notNull().default("ok"), // ok | failed | skipped
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byAutomation: index("email_automation_runs_aut_idx").on(t.automationId, t.createdAt),
}));

// ─── Marketing Templates (global library for restaurants) ───────
export const emailMarketingTemplatesTable = pgTable("email_marketing_templates", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull().default("general"), // birthday | anniversary | weekend | festival | new_item | win_back | loyalty | feedback | review | membership | tiffin | catering | general
  subject: text("subject").notNull().default(""),
  preheader: text("preheader").notNull().default(""),
  body: text("body").notNull().default(""),
  ctaLabel: text("cta_label"),
  ctaUrl: text("cta_url"),
  brandColor: text("brand_color").notNull().default("#f97316"),
  businessTypes: jsonb("business_types").$type<string[]>().notNull().default([]),
  planRestrictions: jsonb("plan_restrictions").$type<number[]>().notNull().default([]),
  isGlobal: boolean("is_global").notNull().default(true),
  isHidden: boolean("is_hidden").notNull().default(false),
  isAiGenerated: boolean("is_ai_generated").notNull().default(false),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  keyIdx: uniqueIndex("email_marketing_templates_key_idx").on(t.key),
  categoryIdx: index("email_marketing_templates_category_idx").on(t.category),
}));

// ─── Email Campaigns (restaurant-scoped marketing sends) ────────
export const emailCampaignsTable = pgTable("email_campaigns", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").references(() => tenantsTable.id),
  name: text("name").notNull(),
  marketingTemplateId: integer("marketing_template_id"),
  segment: text("segment").notNull().default("all_opted_in"),
  audienceFilter: jsonb("audience_filter").$type<Record<string, unknown>>().notNull().default({}),
  subject: text("subject").notNull().default(""),
  preheader: text("preheader").notNull().default(""),
  body: text("body").notNull().default(""),
  ctaLabel: text("cta_label"),
  ctaUrl: text("cta_url"),
  brandColor: text("brand_color").notNull().default("#f97316"),
  status: text("status").notNull().default("draft"), // draft | scheduled | sending | sent | cancelled | failed
  scheduledAt: timestamp("scheduled_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  recipientCount: integer("recipient_count").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  deliveredCount: integer("delivered_count").notNull().default(0),
  openedCount: integer("opened_count").notNull().default(0),
  clickedCount: integer("clicked_count").notNull().default(0),
  unsubscribedCount: integer("unsubscribed_count").notNull().default(0),
  bouncedCount: integer("bounced_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  blockedReason: text("blocked_reason"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byRestaurant: index("email_campaigns_restaurant_idx").on(t.restaurantId, t.status),
  byStatus: index("email_campaigns_status_idx").on(t.status),
  bySchedule: index("email_campaigns_scheduled_idx").on(t.scheduledAt),
}));

// Per-recipient row for each campaign send so analytics + replays work.
export const emailCampaignRecipientsTable = pgTable("email_campaign_recipients", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => emailCampaignsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id"),
  email: text("email").notNull(),
  name: text("name"),
  status: text("status").notNull().default("queued"), // queued | sent | delivered | opened | clicked | bounced | failed | skipped
  reason: text("reason"),
  logId: integer("log_id"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byCampaign: index("email_campaign_recipients_camp_idx").on(t.campaignId, t.status),
}));

// Per-tenant monthly email volume so plan limits can be enforced.
export const emailMonthlyUsageTable = pgTable("email_monthly_usage", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  periodKey: text("period_key").notNull(), // YYYY-MM
  marketingCount: integer("marketing_count").notNull().default(0),
  transactionalCount: integer("transactional_count").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("email_monthly_usage_tenant_period_idx").on(t.tenantId, t.periodKey),
}));

// Restaurant-level marketing-email settings (per-tenant communication panel).
export const emailRestaurantSettingsTable = pgTable("email_restaurant_settings", {
  restaurantId: integer("restaurant_id").primaryKey().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  marketingEnabled: boolean("marketing_enabled").notNull().default(false),
  followUpEnabled: boolean("follow_up_enabled").notNull().default(false),
  fromName: text("from_name").notNull().default(""),
  replyTo: text("reply_to"),
  footerText: text("footer_text").notNull().default(""),
  businessAddress: text("business_address").notNull().default(""),
  consentRequired: boolean("consent_required").notNull().default(true),
  birthdayEnabled: boolean("birthday_enabled").notNull().default(true),
  feedbackEnabled: boolean("feedback_enabled").notNull().default(true),
  reviewEnabled: boolean("review_enabled").notNull().default(true),
  inactiveEnabled: boolean("inactive_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type EmailProvider = typeof emailProvidersTable.$inferSelect;
export type EmailTemplate = typeof emailTemplatesTable.$inferSelect;
export type EmailTemplateVersion = typeof emailTemplateVersionsTable.$inferSelect;
export type EmailLog = typeof emailLogsTable.$inferSelect;
export type EmailTrackingEvent = typeof emailTrackingEventsTable.$inferSelect;
export type EmailSuppression = typeof emailSuppressionListTable.$inferSelect;
export type EmailUnsubscribe = typeof emailUnsubscribesTable.$inferSelect;
export type EmailSequence = typeof emailSequencesTable.$inferSelect;
export type EmailSequenceStep = typeof emailSequenceStepsTable.$inferSelect;
export type EmailSequenceEnrollment = typeof emailSequenceEnrollmentsTable.$inferSelect;
export type EmailAutomation = typeof emailAutomationsTable.$inferSelect;
export type EmailAutomationRun = typeof emailAutomationRunsTable.$inferSelect;
export type EmailMarketingTemplate = typeof emailMarketingTemplatesTable.$inferSelect;
export type EmailCampaign = typeof emailCampaignsTable.$inferSelect;
export type EmailCampaignRecipient = typeof emailCampaignRecipientsTable.$inferSelect;
export type EmailMonthlyUsage = typeof emailMonthlyUsageTable.$inferSelect;
export type EmailRestaurantSettings = typeof emailRestaurantSettingsTable.$inferSelect;
export type EmailTemplateVariable = typeof emailTemplateVariablesTable.$inferSelect;

// Avoid unused-import warning while still anchoring date type for future.
const _date = date;
void _date;
