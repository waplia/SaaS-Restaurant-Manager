import { pgTable, text, serial, timestamp, integer, boolean, jsonb, primaryKey, uniqueIndex, index } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

/**
 * WhatsApp provider settings. Stored at two scopes:
 *   - scope='platform' (restaurantId IS NULL) — single global row used as fallback.
 *   - scope='restaurant' — per-restaurant credentials (one row per restaurant).
 *
 * `providerType` selects the active sending pipeline for restaurant rows:
 *   - "cloud_api" — Meta WhatsApp Cloud API (original path).
 *   - "web_qr"    — WhatsApp Web QR (Baileys), see whatsapp_sessions.
 *   - "disabled"  — no provider; sends are blocked at the dispatcher.
 *
 * The legacy `provider` column ("meta_cloud", "twilio", etc.) is preserved
 * for the Cloud API sub-provider; new code should branch on `providerType`.
 */
export const whatsappSettingsTable = pgTable(
  "whatsapp_settings",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("meta_cloud"),
    /** New: top-level provider pipeline. Defaults to cloud_api to preserve existing behaviour. */
    providerType: text("provider_type").notNull().default("cloud_api"),
    isEnabled: boolean("is_enabled").notNull().default(false),
    /** Restaurant-only: true → use platform credentials; false → use own credentials. Ignored for platform rows. */
    usePlatformAccount: boolean("use_platform_account").notNull().default(true),
    accessToken: text("access_token"),
    phoneNumberId: text("phone_number_id"),
    wabaId: text("waba_id"),
    businessId: text("business_id"),
    webhookVerifyToken: text("webhook_verify_token"),

    // ─── Safe-send & opt-in policy (applied at dispatcher, both providers) ───
    /** Soft per-day cap for marketing-classified messages. 0 = unlimited. */
    safeSendDailyCap: integer("safe_send_daily_cap").notNull().default(0),
    /** Soft per-hour cap. 0 = unlimited. */
    safeSendHourlyCap: integer("safe_send_hourly_cap").notNull().default(0),
    /** Minimum seconds between consecutive sends to throttle automation. */
    safeSendMinDelaySec: integer("safe_send_min_delay_sec").notNull().default(0),
    /** Quiet hours in 24h "HH:MM" format (local restaurant tz). Marketing only. */
    safeSendQuietStart: text("safe_send_quiet_start"),
    safeSendQuietEnd: text("safe_send_quiet_end"),
    /** Block identical body to identical recipient inside this window (sec). */
    safeSendDuplicateWindowSec: integer("safe_send_duplicate_window_sec").notNull().default(0),
    /** When true, marketing-classified messages require customer opt-in (customers.whatsappOptIn). */
    marketingOptInRequired: boolean("marketing_opt_in_required").notNull().default(true),
    /** When false, marketing messages are blocked outright. */
    marketingAllowed: boolean("marketing_allowed").notNull().default(true),

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
  /** Which provider pipeline handled the send: "cloud_api" | "web_qr". */
  provider: text("provider").notNull().default("cloud_api"),
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
  /** Reason: 'quota'|'safe_send_daily'|'safe_send_hourly'|'safe_send_min_delay'|'safe_send_quiet_hours'|'safe_send_duplicate'|'opt_in_required'|'marketing_disabled'|'disabled'|'no_session' for blocked, error message for failed. */
  reason: text("reason"),
  /** Free-form context: { event, broadcastId, orderId, category: 'marketing'|'transactional', ... } */
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  sentBy: integer("sent_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  byRecipient: index("whatsapp_logs_recipient_idx").on(t.recipient, t.createdAt),
}));

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

/**
 * WhatsApp Web QR sessions. One row per restaurant that has ever attempted to
 * link a Web QR provider. The in-process session manager owns the live socket
 * to WhatsApp; this row reflects last-known state for UI + super-admin views.
 *
 * `sessionState` stores the Baileys auth credentials (signed pre-keys, noise
 * key, registration). It is NOT a Meta access token but should still be
 * treated as sensitive and never returned through the API.
 */
export const whatsappSessionsTable = pgTable(
  "whatsapp_sessions",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
    /** disconnected | qr_pending | connecting | connected | failed | library_unavailable | force_disconnected */
    status: text("status").notNull().default("disconnected"),
    /** Connected WhatsApp phone (E.164 without leading +) when status=connected. */
    phone: text("phone"),
    profileName: text("profile_name"),
    /** Identifier of the underlying device (Baileys creds.me.id), used to detect re-pair. */
    deviceId: text("device_id"),
    /** Most recent QR payload (rotates every ~20s). Cleared on connect. */
    qrPayload: text("qr_payload"),
    qrExpiresAt: timestamp("qr_expires_at"),
    lastConnectedAt: timestamp("last_connected_at"),
    lastDisconnectedAt: timestamp("last_disconnected_at"),
    lastHeartbeatAt: timestamp("last_heartbeat_at"),
    lastError: text("last_error"),
    /** Encrypted credential blob — never exposed by the API. */
    sessionState: jsonb("session_state").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  t => ({
    restaurantIdx: uniqueIndex("whatsapp_sessions_restaurant_idx").on(t.restaurantId),
  }),
);

/** Append-only audit of significant Web QR session events (qr_generated, connected, disconnected, force_disconnected, send_failed_no_session, ...). */
export const whatsappSessionLogsTable = pgTable("whatsapp_session_logs", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  sessionId: integer("session_id").references(() => whatsappSessionsTable.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  detail: text("detail"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  actorUserId: integer("actor_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type WhatsAppSetting = typeof whatsappSettingsTable.$inferSelect;
export type WhatsAppTemplate = typeof whatsappTemplatesTable.$inferSelect;
export type WhatsAppLog = typeof whatsappLogsTable.$inferSelect;
export type WhatsAppUsage = typeof whatsappUsageTable.$inferSelect;
export type WhatsAppSession = typeof whatsappSessionsTable.$inferSelect;
export type WhatsAppSessionLog = typeof whatsappSessionLogsTable.$inferSelect;
