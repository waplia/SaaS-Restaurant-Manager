import { pgTable, integer, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

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
  | "signupEnabled" | "demoModeEnabled" | "landingPageEnabled"
>;

export const SOCIAL_KEYS = ["facebook", "instagram", "twitter", "linkedin", "youtube", "tiktok"] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];
