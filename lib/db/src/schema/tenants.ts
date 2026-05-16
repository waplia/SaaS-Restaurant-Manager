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
  maxRestaurants: integer("max_restaurants").notNull().default(1),
  maxBranches: integer("max_branches").notNull().default(1),
  maxStaff: integer("max_staff").notNull().default(10),
  maxTables: integer("max_tables").notNull().default(20),
  maxMenuItems: integer("max_menu_items").notNull().default(100),
  trialDays: integer("trial_days").notNull().default(14),
  smsMonthlyLimit: integer("sms_monthly_limit").notNull().default(0),
  whatsappMonthlyLimit: integer("whatsapp_monthly_limit").notNull().default(0),
  currency: text("currency").notNull().default("INR"),
  features: text("features").array().default([]),
  featureFlags: jsonb("feature_flags").$type<Record<string, boolean>>().notNull().default({}),
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSubscriptionPlanSchema = createInsertSchema(subscriptionPlansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubscriptionPlan = z.infer<typeof insertSubscriptionPlanSchema>;
export type SubscriptionPlan = typeof subscriptionPlansTable.$inferSelect;

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;
