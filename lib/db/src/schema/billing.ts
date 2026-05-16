import { pgTable, text, serial, timestamp, integer, boolean, decimal, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantsTable, subscriptionPlansTable } from "./tenants";

export const paymentMethodSettingsTable = pgTable("payment_method_settings", {
  provider: text("provider").primaryKey(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const manualPaymentRequestsTable = pgTable("manual_payment_requests", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  planId: integer("plan_id").notNull().references(() => subscriptionPlansTable.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  method: text("method").notNull(),
  reference: text("reference"),
  proofUrl: text("proof_url"),
  note: text("note"),
  status: text("status").notNull().default("pending"),
  reviewerNote: text("reviewer_note"),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  submittedBy: integer("submitted_by"),
  couponCode: text("coupon_code"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const subscriptionPaymentsTable = pgTable("subscription_payments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  planId: integer("plan_id").notNull().references(() => subscriptionPlansTable.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  provider: text("provider").notNull(),       // cashfree | razorpay | stripe | bank | upi | mock
  externalRef: text("external_ref").notNull(), // order id / manual_<method>_<id> / etc.
  manualRequestId: integer("manual_request_id"),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  status: text("status").notNull().default("succeeded"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  couponId: integer("coupon_id"),
  discountApplied: decimal("discount_applied", { precision: 12, scale: 2 }),
  couponSnapshot: jsonb("coupon_snapshot").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  externalRefIdx: uniqueIndex("subscription_payments_external_ref_idx").on(t.externalRef),
}));

// ─── Coupons ─────────────────────────────────────────────────────
// Super-admin issued promo codes for subscription plans. Five discount
// types are supported (see DISCOUNT_TYPES in lib/coupons.ts). Lifetime
// discounts are also persisted on the tenant row so future renewals
// reapply automatically without re-entering the code.
export const subscriptionCouponsTable = pgTable("subscription_coupons", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  discountType: text("discount_type").notNull(), // flat | percent | trial_extension | first_month | lifetime
  discountValue: decimal("discount_value", { precision: 12, scale: 2 }).notNull(),
  maxUsage: integer("max_usage"),
  usedCount: integer("used_count").notNull().default(0),
  validFrom: timestamp("valid_from"),
  validUntil: timestamp("valid_until"),
  applicablePlanIds: integer("applicable_plan_ids").array().notNull().default(sql`ARRAY[]::integer[]`),
  applicableTenantIds: integer("applicable_tenant_ids").array().notNull().default(sql`ARRAY[]::integer[]`),
  status: text("status").notNull().default("active"), // active | inactive
  notes: text("notes"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
}, t => ({
  codeIdx: uniqueIndex("subscription_coupons_code_idx").on(t.code),
}));

export const subscriptionCouponRedemptionsTable = pgTable("subscription_coupon_redemptions", {
  id: serial("id").primaryKey(),
  couponId: integer("coupon_id").notNull().references(() => subscriptionCouponsTable.id),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  planId: integer("plan_id").references(() => subscriptionPlansTable.id),
  paymentId: integer("payment_id"),
  manualRequestId: integer("manual_request_id"),
  discountApplied: decimal("discount_applied", { precision: 12, scale: 2 }).notNull().default("0"),
  trialDaysAdded: integer("trial_days_added"),
  context: text("context").notNull().default("payment"), // payment | trial_extension | manual_admin
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  redeemedBy: integer("redeemed_by"),
  redeemedAt: timestamp("redeemed_at").notNull().defaultNow(),
}, t => ({
  tenantCouponIdx: index("subscription_coupon_redemptions_tenant_coupon_idx").on(t.tenantId, t.couponId),
  couponIdx: index("subscription_coupon_redemptions_coupon_idx").on(t.couponId),
}));

export type PaymentMethodSetting = typeof paymentMethodSettingsTable.$inferSelect;
export type ManualPaymentRequest = typeof manualPaymentRequestsTable.$inferSelect;
export type SubscriptionPayment = typeof subscriptionPaymentsTable.$inferSelect;
export type SubscriptionCoupon = typeof subscriptionCouponsTable.$inferSelect;
export type SubscriptionCouponRedemption = typeof subscriptionCouponRedemptionsTable.$inferSelect;
