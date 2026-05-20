import { pgTable, integer, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Singleton table holding platform-wide app settings.
 * There is exactly one row, with id = 1, ensured at runtime by getAppSettings().
 */
export const appSettingsTable = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  // Branding
  appName: text("app_name").notNull().default("KhanaLagao"),
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),
  primaryColor: text("primary_color").notNull().default("#f97316"),
  secondaryColor: text("secondary_color").notNull().default("#fb923c"),
  // Support & Contact
  supportEmail: text("support_email").notNull().default("support@khanalagao.com"),
  supportPhone: text("support_phone"),
  supportWhatsapp: text("support_whatsapp"),
  companyAddress: text("company_address"),
  // Localization
  defaultCurrency: text("default_currency").notNull().default("INR"),
  defaultTimezone: text("default_timezone").notNull().default("Asia/Kolkata"),
  dateFormat: text("date_format").notNull().default("DD/MM/YYYY"),
  timeFormat: text("time_format").notNull().default("12h"),
  // Operational
  trialDays: integer("trial_days").notNull().default(14),
  maintenanceMode: boolean("maintenance_mode").notNull().default(false),
  maintenanceMessage: text("maintenance_message"),
  signupEnabled: boolean("signup_enabled").notNull().default(true),
  demoModeEnabled: boolean("demo_mode_enabled").notNull().default(false),
  landingPageEnabled: boolean("landing_page_enabled").notNull().default(true),
  // Web Push (VAPID) — auto-generated on first use, persisted so existing
  // subscriptions remain valid across api-server restarts.
  webPushPublicKey: text("web_push_public_key"),
  webPushPrivateKey: text("web_push_private_key"),
  webPushSubject: text("web_push_subject"),
  // Task #506 — WhatsApp Web QR global feature flag (platform kill-switch).
  // When false, no restaurant can use Web QR regardless of plan.
  whatsappWebQrGlobalEnabled: boolean("whatsapp_web_qr_global_enabled").notNull().default(false),
  /** Optional set of plan slugs that may use Web QR. Empty array = plan flag is the only gate. */
  whatsappWebQrAllowedPlans: text("whatsapp_web_qr_allowed_plans").array().notNull().default(sql`ARRAY[]::text[]`),
  // Web Push provider center (super-admin owned). All secret-bearing fields
  // are stored as encrypted JSON envelopes ({cipher,iv,tag}) and masked in
  // the API. Restaurant admins never see or write any of these.
  webPushProvider: text("web_push_provider").notNull().default("vapid"),
  webPushFallbackProvider: text("web_push_fallback_provider"),
  webPushFcmConfig: jsonb("web_push_fcm_config").$type<Record<string, unknown>>().notNull().default({}),
  webPushOnesignalConfig: jsonb("web_push_onesignal_config").$type<Record<string, unknown>>().notNull().default({}),
  webPushCustomConfig: jsonb("web_push_custom_config").$type<Record<string, unknown>>().notNull().default({}),
  webPushDefaultIcon: text("web_push_default_icon"),
  webPushDefaultBadge: text("web_push_default_badge"),
  webPushFallbackImage: text("web_push_fallback_image"),
  webPushDefaultClickUrl: text("web_push_default_click_url"),
  // Global feature flag (master kill-switch). Per-plan + per-tenant overrides
  // live in webPushPlanLimits / webPushTenantOverrides.
  webPushGlobalEnabled: boolean("web_push_global_enabled").notNull().default(true),
  // Per-plan limits matrix, keyed by plan id (string). Each value carries:
  //   { enabled, monthlyCap, dailyCap, maxSubscribers, scheduling, richImages, segmentation, analytics }
  webPushPlanLimits: jsonb("web_push_plan_limits").$type<Record<string, Record<string, unknown>>>().notNull().default({}),
  // Per-tenant overrides keyed by tenantId (string). Each value carries:
  //   { forceDisable: bool, monthlyCap: number, reason: string, setAt: ISOString }
  webPushTenantOverrides: jsonb("web_push_tenant_overrides").$type<Record<string, Record<string, unknown>>>().notNull().default({}),
  // Auth (Task #531) — platform-wide controls for OTP login, 2FA, and
  // self-serve registration. Each *Enabled flag is a global kill switch;
  // restaurants and individual users can still opt themselves out below
  // (e.g. via per-user twoFactorEnabled), but not in.
  authMobileOtpLoginEnabled: boolean("auth_mobile_otp_login_enabled").notNull().default(true),
  authEmailOtpLoginEnabled: boolean("auth_email_otp_login_enabled").notNull().default(true),
  authPasswordLoginEnabled: boolean("auth_password_login_enabled").notNull().default(true),
  authTwoFactorEnabled: boolean("auth_two_factor_enabled").notNull().default(true),
  authSelfRegistrationRequireMobileOtp: boolean("auth_self_reg_require_mobile_otp").notNull().default(true),
  authOtpDefaultChannel: text("auth_otp_default_channel").notNull().default("sms"),
  authOtpFallbackChannel: text("auth_otp_fallback_channel"),
  // Task #538 — Google sign-in (super-admin configured). The client secret
  // is stored as an encrypted JSON envelope ({cipher,iv,tag}) and never
  // returned to any client; admin reads see a boolean `hasGoogleClientSecret`
  // instead of the ciphertext. Restaurant admins never see any of these.
  googleSignInEnabled: boolean("google_signin_enabled").notNull().default(false),
  googleClientId: text("google_client_id"),
  googleClientSecretEnc: jsonb("google_client_secret_enc").$type<{ cipher: string; iv: string; tag: string } | null>(),
  googleRequirePhoneAfterSignup: boolean("google_require_phone_after_signup").notNull().default(true),
  // Footer & Social
  footerText: text("footer_text"),
  socialLinks: jsonb("social_links").$type<Record<string, string>>().notNull().default({}),
  // Audit
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AppSettings = typeof appSettingsTable.$inferSelect;
export type InsertAppSettings = typeof appSettingsTable.$inferInsert;

/**
 * Subset of fields safe to expose to unauthenticated frontends (marketing site,
 * login screens). Excludes operational fields that affect server behaviour
 * decisions which we still want to read (maintenance, signup, demo, landing)
 * since the frontend also needs them to render correctly.
 */
export type PublicAppSettings = Pick<
  AppSettings,
  | "appName" | "logoUrl" | "faviconUrl" | "primaryColor" | "secondaryColor"
  | "supportEmail" | "supportPhone" | "supportWhatsapp" | "companyAddress"
  | "defaultCurrency" | "defaultTimezone" | "dateFormat" | "timeFormat"
  | "footerText" | "socialLinks"
  | "maintenanceMode" | "maintenanceMessage"
  | "signupEnabled" | "landingPageEnabled"
  | "authPasswordLoginEnabled" | "authMobileOtpLoginEnabled" | "authEmailOtpLoginEnabled"
  | "authTwoFactorEnabled" | "authSelfRegistrationRequireMobileOtp" | "authOtpDefaultChannel"
  | "googleSignInEnabled"
>;

export const SOCIAL_KEYS = ["facebook", "instagram", "twitter", "linkedin", "youtube", "tiktok"] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];
