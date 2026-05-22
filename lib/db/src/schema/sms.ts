import { pgTable, text, serial, timestamp, integer, boolean, jsonb, decimal, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

export type SmsProviderType = "twilio" | "msg91" | "textlocal" | "fast2sms" | "gupshup" | "2factor" | "custom";
export type SmsLogStatus = "queued" | "sent" | "delivered" | "failed" | "blocked";
export type SmsMessageType = "otp" | "transactional" | "promotional" | "voice_otp" | "test";
export type SmsPurpose =
  | "login" | "register" | "two_factor" | "password_reset"
  | "staff_invite" | "new_device" | "verify_mobile" | "verify_email"
  | "marketing" | "lifecycle" | "custom";

export const SMS_TEMPLATE_EVENT_KEYS = [
  "welcome",
  "otp",
  "trial_ending",
  "subscription_activated",
  "subscription_expired",
  "payment_reminder",
  "payment_received",
  "restaurant_suspended",
  "demo_booked",
  // Mobile-number-driven notifications wired from /staff and
  // /auth/forgot-password so the recipient gets the message even when
  // email isn't usable. Mirrors the WhatsApp templates of the same names.
  "staff_invite",
  "password_reset_otp",
] as const;
export type SmsTemplateEventKey = (typeof SMS_TEMPLATE_EVENT_KEYS)[number];

export const smsProvidersTable = pgTable("sms_providers", {
  id: serial("id").primaryKey(),
  type: text("type").$type<SmsProviderType>().notNull(),
  name: text("name").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  // Provider-specific credential payload. Field set varies per type:
  //  - apiKey, authToken, senderId, route, countryCode, entityId, supportsTemplateId
  //  - custom: baseUrl, method, headers (object), bodyTemplate (string with {{to}}, {{message}})
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  // Cached account-balance snapshot (provider-reported, where available).
  balance: decimal("balance", { precision: 12, scale: 2 }),
  balanceCurrency: text("balance_currency"),
  balanceCheckedAt: timestamp("balance_checked_at"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const smsTemplatesTable = pgTable("sms_templates", {
  id: serial("id").primaryKey(),
  // Stable event key (welcome, otp, …). Bound to the lifecycle hook.
  eventKey: text("event_key").$type<SmsTemplateEventKey>().notNull(),
  name: text("name").notNull(),
  body: text("body").notNull(),
  variables: jsonb("variables").$type<string[]>().notNull().default([]),
  // DLT (TRAI) compliance template id — required by Indian providers like MSG91.
  dltTemplateId: text("dlt_template_id"),
  category: text("category").notNull().default("transactional"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  eventKeyIdx: uniqueIndex("sms_templates_event_key_idx").on(t.eventKey),
}));

export const smsLogsTable = pgTable("sms_logs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "set null" }),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "set null" }),
  recipient: text("recipient").notNull(),
  templateId: integer("template_id").references(() => smsTemplatesTable.id, { onDelete: "set null" }),
  eventKey: text("event_key").$type<SmsTemplateEventKey | "test" | "custom">(),
  providerId: integer("provider_id").references(() => smsProvidersTable.id, { onDelete: "set null" }),
  providerType: text("provider_type"),
  body: text("body").notNull(),
  status: text("status").$type<SmsLogStatus>().notNull().default("queued"),
  providerMessageId: text("provider_message_id"),
  // Provider-issued session id for verify-by-session OTP flows (e.g. 2Factor).
  providerSessionId: text("provider_session_id"),
  // Why the message was sent: login, register, marketing, lifecycle, etc.
  // Used by Reports breakdown alongside `provider`.
  purpose: text("purpose").$type<SmsPurpose>(),
  // High-level category routed at the provider (otp / transactional /
  // promotional / voice_otp / test).
  messageType: text("message_type").$type<SmsMessageType>(),
  // Provider-reported cost estimate (separate from the legacy `cost` field
  // so existing code paths are untouched).
  costEstimate: decimal("cost_estimate", { precision: 10, scale: 4 }),
  cost: decimal("cost", { precision: 10, scale: 4 }),
  costCurrency: text("cost_currency"),
  // Normalized provider error code (e.g. "INVALID_API_KEY", "LOW_BALANCE")
  // so the UI can render friendly messages without parsing free text.
  errorCode: text("error_code"),
  // Raw provider response JSON for debugging / audit. Kept separate from
  // `metadata` so app-level metadata isn't polluted by provider payloads.
  providerResponse: jsonb("provider_response").$type<Record<string, unknown>>(),
  error: text("error"),
  retryOf: integer("retry_of"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  tenantIdx: index("sms_logs_tenant_idx").on(t.tenantId),
  statusIdx: index("sms_logs_status_idx").on(t.status),
  createdIdx: index("sms_logs_created_idx").on(t.createdAt),
}));

export type SmsProvider = typeof smsProvidersTable.$inferSelect;
export type SmsTemplate = typeof smsTemplatesTable.$inferSelect;
export type SmsLog = typeof smsLogsTable.$inferSelect;
