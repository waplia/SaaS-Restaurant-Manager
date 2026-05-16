import { pgTable, text, serial, timestamp, integer, boolean, decimal, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantsTable, subscriptionPlansTable } from "./tenants";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

export const aiCreditWalletsTable = pgTable("ai_credit_wallets", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  monthlyIncludedCredits: integer("monthly_included_credits").notNull().default(0),
  purchasedCredits: integer("purchased_credits").notNull().default(0),
  bonusCredits: integer("bonus_credits").notNull().default(0),
  reservedCredits: integer("reserved_credits").notNull().default(0),
  usedCredits: integer("used_credits").notNull().default(0),
  purchasedExpiresAt: timestamp("purchased_expires_at"),
  monthlyResetAt: timestamp("monthly_reset_at"),
  isBlocked: boolean("is_blocked").notNull().default(false),
  blockedReason: text("blocked_reason"),
  betaFeatures: jsonb("beta_features").$type<string[]>().notNull().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  tenantIdx: uniqueIndex("ai_credit_wallets_tenant_idx").on(t.tenantId),
}));

export const aiCreditTransactionsTable = pgTable("ai_credit_transactions", {
  id: serial("id").primaryKey(),
  walletId: integer("wallet_id").notNull().references(() => aiCreditWalletsTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  // debit | refund | monthly_allocation | recharge | manual_credit | manual_debit | bonus | expiry
  featureSlug: text("feature_slug"),
  credits: integer("credits").notNull(),
  bucket: text("bucket"), // monthly | purchased | bonus
  balanceAfter: integer("balance_after").notNull().default(0),
  referenceType: text("reference_type"),
  referenceId: integer("reference_id"),
  requestLogId: integer("request_log_id"),
  paymentId: integer("payment_id"),
  rechargePackageId: integer("recharge_package_id"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  walletIdx: index("ai_credit_transactions_wallet_idx").on(t.walletId, t.createdAt),
  tenantIdx: index("ai_credit_transactions_tenant_idx").on(t.tenantId, t.createdAt),
  featureIdx: index("ai_credit_transactions_feature_idx").on(t.featureSlug, t.createdAt),
}));

export const aiFeatureCreditRulesTable = pgTable("ai_feature_credit_rules", {
  id: serial("id").primaryKey(),
  featureSlug: text("feature_slug").notNull(),
  featureLabel: text("feature_label").notNull().default(""),
  description: text("description"),
  scopeType: text("scope_type").notNull().default("global"), // global | plan | restaurant
  scopeId: integer("scope_id"),
  pricingMode: text("pricing_mode").notNull().default("fixed"),
  // fixed | per_item | per_page | per_image | per_token | per_word
  unitType: text("unit_type").notNull().default("request"),
  // request | token | image | minute
  creditsPerUnit: decimal("credits_per_unit", { precision: 12, scale: 4 }).notNull().default("1"),
  minCharge: integer("min_charge").notNull().default(1),
  maxPerRequest: integer("max_per_request"),
  freeMonthlyQuota: integer("free_monthly_quota").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  scopeIdx: uniqueIndex("ai_feature_credit_rules_scope_idx").on(t.featureSlug, t.scopeType, t.scopeId),
}));

export const aiRechargePackagesTable = pgTable("ai_recharge_packages", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  credits: integer("credits").notNull(),
  bonusCredits: integer("bonus_credits").notNull().default(0),
  price: decimal("price", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  validityDays: integer("validity_days"),
  isActive: boolean("is_active").notNull().default(true),
  isFeatured: boolean("is_featured").notNull().default(false),
  showToRestaurants: boolean("show_to_restaurants").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  slugIdx: uniqueIndex("ai_recharge_packages_slug_idx").on(t.slug),
}));

export const aiMonthlyAllocationsTable = pgTable("ai_monthly_allocations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  planId: integer("plan_id").references(() => subscriptionPlansTable.id, { onDelete: "set null" }),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  creditsAllocated: integer("credits_allocated").notNull(),
  transactionId: integer("transaction_id"),
  allocatedAt: timestamp("allocated_at").notNull().defaultNow(),
}, t => ({
  tenantPeriodIdx: uniqueIndex("ai_monthly_allocations_tenant_period_idx").on(t.tenantId, t.periodStart),
}));

export const aiCreditRechargesTable = pgTable("ai_credit_recharges", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  packageId: integer("package_id").notNull().references(() => aiRechargePackagesTable.id, { onDelete: "restrict" }),
  provider: text("provider").notNull(), // razorpay | cashfree | manual | mock
  externalRef: text("external_ref"),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  creditsGranted: integer("credits_granted").notNull().default(0),
  bonusGranted: integer("bonus_granted").notNull().default(0),
  status: text("status").notNull().default("pending"), // pending | succeeded | failed | cancelled
  failureReason: text("failure_reason"),
  notes: text("notes"),
  transactionId: integer("transaction_id"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  tenantIdx: index("ai_credit_recharges_tenant_idx").on(t.tenantId, t.createdAt),
  externalRefIdx: uniqueIndex("ai_credit_recharges_external_ref_idx").on(t.provider, t.externalRef),
}));

void restaurantsTable; void sql; // imports kept for future cross-references

export type AiCreditWallet = typeof aiCreditWalletsTable.$inferSelect;
export type AiCreditTransaction = typeof aiCreditTransactionsTable.$inferSelect;
export type AiFeatureCreditRule = typeof aiFeatureCreditRulesTable.$inferSelect;
export type AiRechargePackage = typeof aiRechargePackagesTable.$inferSelect;
export type AiMonthlyAllocation = typeof aiMonthlyAllocationsTable.$inferSelect;
export type AiCreditRecharge = typeof aiCreditRechargesTable.$inferSelect;
