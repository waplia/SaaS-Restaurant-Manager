import { pgTable, text, serial, timestamp, integer, boolean, jsonb, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

/**
 * WhatsApp provider settings. Stored at two scopes:
 *   - scope='platform' (restaurantId IS NULL) — single global row used as fallback.
 *   - scope='restaurant' — per-restaurant credentials (one row per restaurant).
 *
 * Provider currently only supports "meta_cloud" (Meta WhatsApp Cloud API). Schema
 * includes `provider` so future providers (twilio, gupshup, 360dialog, etc.)
 * can be slotted in without migrations.
 */
export const whatsappSettingsTable = pgTable(
  "whatsapp_settings",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("meta_cloud"),
    isEnabled: boolean("is_enabled").notNull().default(false),
    /** Restaurant-only: true → use platform credentials; false → use own credentials. Ignored for platform rows. */
    usePlatformAccount: boolean("use_platform_account").notNull().default(true),
    accessToken: text("access_token"),
    phoneNumberId: text("phone_number_id"),
    wabaId: text("waba_id"),
    businessId: text("business_id"),
    webhookVerifyToken: text("webhook_verify_token"),
    /** Cached most recent test message info for showing UI feedback. */
    lastTestAt: timestamp("last_test_at"),
    lastTestStatus: text("last_test_status"),
    lastTestError: text("last_test_error"),
    updatedBy: integer("updated_by").references(() => usersTable.id),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  t => ({
    scopeRestaurantIdx: uniqueIndex("whatsapp_settings_scope_restaurant_idx").on(t.scope, t.restaurantId),
  }),
);

/**
 * WhatsApp templates. Synced from Meta. `scope` mirrors settings: platform-level
 * templates (synced from the platform WABA) or restaurant-level (synced from
 * the restaurant's own WABA). When a restaurant uses the platform account,
 * platform templates are exposed read-only.
 */
export const whatsappTemplatesTable = pgTable(
  "whatsapp_templates",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }),
    /** Meta template name (unique within a WABA + language). */
    name: text("name").notNull(),
    language: text("language").notNull().default("en"),
    category: text("category"),
    status: text("status").notNull().default("pending"),
    bodyPreview: text("body_preview"),
    /** Raw template payload from Meta — components, examples, etc. */
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    /**
     * Optional default-event mapping: when set, the system will use this
     * template for the named event (e.g. 'subscription_reminder',
     * 'announcement', 'order_confirmed').
     */
    defaultForEvent: text("default_for_event"),
    syncedAt: timestamp("synced_at").notNull().defaultNow(),
  },
  t => ({
    scopeNameLangIdx: uniqueIndex("whatsapp_templates_scope_name_lang_idx").on(t.scope, t.restaurantId, t.name, t.language),
  }),
);

/**
 * Outbound WhatsApp message log. One row per send attempt. Restaurant-scoped;
 * platform-only sends (admin test, super-admin announcement to owners) carry
 * `restaurantId = null` and `tenantId` for the recipient tenant when known.
 */
export const whatsappLogsTable = pgTable("whatsapp_logs", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "set null" }),
  tenantId: integer("tenant_id"),
  recipient: text("recipient").notNull(),
  templateName: text("template_name"),
  templateLanguage: text("template_language"),
  body: text("body"),
  /** queued | sent | delivered | read | failed | blocked */
  status: text("status").notNull().default("queued"),
  providerMessageId: text("provider_message_id"),
  /** Cost from Meta webhook pricing field (string to avoid float drift). */
  cost: text("cost"),
  costCurrency: text("cost_currency"),
  /** Reason: 'quota' for blocked, error message for failed. */
  reason: text("reason"),
  /** Free-form context: { event, broadcastId, orderId, ... } */
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  sentBy: integer("sent_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Per-restaurant monthly counters keyed by (restaurantId, year, month).
 * Maintained transactionally by the WhatsApp service so quota enforcement
 * is O(1) without scanning the logs table.
 */
export const whatsappUsageTable = pgTable(
  "whatsapp_usage",
  {
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    sent: integer("sent").notNull().default(0),
    success: integer("success").notNull().default(0),
    failure: integer("failure").notNull().default(0),
    blocked: integer("blocked").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  t => ({
    pk: primaryKey({ columns: [t.restaurantId, t.year, t.month] }),
  }),
);

export type WhatsAppSetting = typeof whatsappSettingsTable.$inferSelect;
export type WhatsAppTemplate = typeof whatsappTemplatesTable.$inferSelect;
export type WhatsAppLog = typeof whatsappLogsTable.$inferSelect;
export type WhatsAppUsage = typeof whatsappUsageTable.$inferSelect;
