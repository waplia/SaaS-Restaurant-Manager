import { pgTable, text, serial, timestamp, integer, boolean, decimal, check, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const subscriptionPlansTable = pgTable("subscription_plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  billingPeriod: text("billing_period").notNull().default("monthly"),
  // Optional admin-configured yearly price for this plan. When set, the
  // marketing site's monthly/yearly toggle uses this value directly instead
  // of deriving a 16% discount from the monthly price. When null, callers
  // should fall back to the derived value.
  yearlyPrice: decimal("yearly_price", { precision: 10, scale: 2 }),
  // Optional payment-provider price/plan IDs so checkout can attach the
  // right recurring price for each billing period.
  stripeMonthlyPriceId: text("stripe_monthly_price_id"),
  stripeYearlyPriceId: text("stripe_yearly_price_id"),
  cashfreeMonthlyPlanId: text("cashfree_monthly_plan_id"),
  cashfreeYearlyPlanId: text("cashfree_yearly_plan_id"),
  maxRestaurants: integer("max_restaurants").notNull().default(1),
  maxBranches: integer("max_branches").notNull().default(1),
  maxStaff: integer("max_staff").notNull().default(10),
  maxTables: integer("max_tables").notNull().default(20),
  maxMenuItems: integer("max_menu_items").notNull().default(100),
  trialDays: integer("trial_days").notNull().default(14),
  smsMonthlyLimit: integer("sms_monthly_limit").notNull().default(0),
  whatsappMonthlyLimit: integer("whatsapp_monthly_limit").notNull().default(0),
  // Task #506 — WhatsApp Web QR provider plan limits.
  whatsappWebQrEnabled: boolean("whatsapp_web_qr_enabled").notNull().default(false),
  whatsappWebQrDailyCap: integer("whatsapp_web_qr_daily_cap").notNull().default(0),
  whatsappWebQrMonthlyCap: integer("whatsapp_web_qr_monthly_cap").notNull().default(0),
  whatsappWebQrMaxSessions: integer("whatsapp_web_qr_max_sessions").notNull().default(1),
  // Task #414 — Email Center plan limits.
  emailMonthlyLimit: integer("email_monthly_limit").notNull().default(1000),
  emailMarketingMonthlyLimit: integer("email_marketing_monthly_limit").notNull().default(0),
  emailActiveSequencesLimit: integer("email_active_sequences_limit").notNull().default(0),
  emailCustomTemplatesLimit: integer("email_custom_templates_limit").notNull().default(0),
  // Task #516 — Growth Engine marketing-platform plan limits.
  campaignsMonthlyLimit: integer("campaigns_monthly_limit").notNull().default(0),
  campaignsAudienceSizeLimit: integer("campaigns_audience_size_limit").notNull().default(0),
  campaignsActiveRecurringLimit: integer("campaigns_active_recurring_limit").notNull().default(0),
  currency: text("currency").notNull().default("INR"),
  features: text("features").array().default([]),
  featureFlags: jsonb("feature_flags").$type<Record<string, boolean>>().notNull().default({}),
  // Khana AI add-on (Task #62) — opt-in per plan, with credit allowance and caps.
  aiEnabled: boolean("ai_enabled").notNull().default(false),
  aiMonthlyIncludedCredits: integer("ai_monthly_included_credits").notNull().default(0),
  aiDailyRequestCap: integer("ai_daily_request_cap").notNull().default(0),
  aiPerFeatureMonthlyCaps: jsonb("ai_per_feature_monthly_caps").$type<Record<string, number>>().notNull().default({}),
  aiFeatureToggles: jsonb("ai_feature_toggles").$type<Record<string, boolean>>().notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  currencyCheck: check("subscription_plans_currency_check", sql`${t.currency} IN ('INR','USD')`),
}));

export const tenantsTable = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  planId: integer("plan_id").references(() => subscriptionPlansTable.id),
  planStatus: text("plan_status").notNull().default("trial"),
  trialEndsAt: timestamp("trial_ends_at"),
  subscriptionStartedAt: timestamp("subscription_started_at"),
  subscriptionEndsAt: timestamp("subscription_ends_at"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  cashfreeCustomerId: text("cashfree_customer_id"),
  cashfreeSubscriptionId: text("cashfree_subscription_id"),
  onboardingCompletedAt: timestamp("onboarding_completed_at"),
  onboardingSkippedSteps: text("onboarding_skipped_steps").array().notNull().default(sql`ARRAY[]::text[]`),
  smsMonthlyLimit: integer("sms_monthly_limit"),
  isActive: boolean("is_active").notNull().default(true),
  isSuspended: boolean("is_suspended").notNull().default(false),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color").default("#f97316"),
  lifetimeCouponId: integer("lifetime_coupon_id"),
  lifetimeCouponSnapshot: jsonb("lifetime_coupon_snapshot").$type<Record<string, unknown> | null>(),
  // Fintech (Task #115): per-tenant feature toggles for wallets, gift cards,
  // cashback, subscription wallet, and capital placeholders.
  fintechWalletsEnabled: boolean("fintech_wallets_enabled").notNull().default(true),
  fintechGiftCardsEnabled: boolean("fintech_gift_cards_enabled").notNull().default(true),
  fintechCashbackEnabled: boolean("fintech_cashback_enabled").notNull().default(true),
  fintechSubscriptionWalletEnabled: boolean("fintech_subscription_wallet_enabled").notNull().default(true),
  fintechCapitalEnabled: boolean("fintech_capital_enabled").notNull().default(false),
  fintechRequirePayoutApproval: boolean("fintech_require_payout_approval").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSubscriptionPlanSchema = createInsertSchema(subscriptionPlansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubscriptionPlan = z.infer<typeof insertSubscriptionPlanSchema>;
export type SubscriptionPlan = typeof subscriptionPlansTable.$inferSelect;

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;
