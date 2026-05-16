import { pgTable, text, serial, timestamp, integer, boolean, decimal, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { restaurantsTable } from "./restaurants";
import { customersTable } from "./customers";
import { ordersTable } from "./orders";

export const mealPlanTemplatesTable = pgTable("meal_plan_templates", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull().default("custom"), // monthly_pass | coffee | tiffin | office | student | gym | family | credits | custom
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  billingCycle: text("billing_cycle").notNull().default("monthly"), // daily | weekly | monthly | quarterly | custom
  cycleDays: integer("cycle_days"), // for custom cycle
  durationCycles: integer("duration_cycles"), // null = open-ended
  autoRenew: boolean("auto_renew").notNull().default(true),
  // Entitlements
  mealsPerCycle: integer("meals_per_cycle"),
  creditsPerCycle: integer("credits_per_cycle"),
  bonusCredits: integer("bonus_credits").notNull().default(0),
  creditExpiryDays: integer("credit_expiry_days"),
  perItemCreditCost: decimal("per_item_credit_cost", { precision: 10, scale: 2 }),
  allowedItemIds: integer("allowed_item_ids").array().notNull().default(sql`ARRAY[]::integer[]`),
  allowedCategoryIds: integer("allowed_category_ids").array().notNull().default(sql`ARRAY[]::integer[]`),
  maxMealsPerDay: integer("max_meals_per_day"),
  validDaysOfWeek: integer("valid_days_of_week").array().notNull().default(sql`ARRAY[]::integer[]`), // 0=Sun..6=Sat
  validTimeStart: text("valid_time_start"), // HH:MM
  validTimeEnd: text("valid_time_end"),
  eligibleOrderTypes: text("eligible_order_types").array().notNull().default(sql`ARRAY['dine_in','takeaway','delivery']::text[]`),
  // Family / refund / pause
  maxFamilyMembers: integer("max_family_members").notNull().default(1),
  refundPolicy: text("refund_policy").notNull().default("none"), // none | prorated | full_within_days
  refundWithinDays: integer("refund_within_days"),
  maxPauseDays: integer("max_pause_days"),
  renewalReminderDays: integer("renewal_reminder_days").notNull().default(3),
  lowBalanceThreshold: integer("low_balance_threshold").notNull().default(2),
  // Visibility
  isActive: boolean("is_active").notNull().default(true),
  showOnCustomerApp: boolean("show_on_customer_app").notNull().default(true),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  restaurantIdx: index("meal_plan_templates_restaurant_idx").on(t.restaurantId),
}));

export const customerSubscriptionsTable = pgTable("customer_subscriptions", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  templateId: integer("template_id").notNull().references(() => mealPlanTemplatesTable.id),
  templateSnapshot: jsonb("template_snapshot").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("pending"), // pending | active | paused | expired | cancelled
  startDate: timestamp("start_date").notNull().defaultNow(),
  currentCycleStart: timestamp("current_cycle_start"),
  currentCycleEnd: timestamp("current_cycle_end"),
  nextBillingDate: timestamp("next_billing_date"),
  endsAt: timestamp("ends_at"), // when cancellation/expiry takes effect
  cancelAtCycleEnd: boolean("cancel_at_cycle_end").notNull().default(false),
  pausedAt: timestamp("paused_at"),
  pauseReason: text("pause_reason"),
  pauseDaysUsed: integer("pause_days_used").notNull().default(0),
  cyclesCompleted: integer("cycles_completed").notNull().default(0),
  // Per-cycle running counters (reset each cycle)
  mealsRemaining: integer("meals_remaining").notNull().default(0),
  mealsUsed: integer("meals_used").notNull().default(0),
  creditsRemaining: integer("credits_remaining").notNull().default(0),
  creditsUsed: integer("credits_used").notNull().default(0),
  // Lifetime counters
  totalMealsUsed: integer("total_meals_used").notNull().default(0),
  totalCreditsUsed: integer("total_credits_used").notNull().default(0),
  // Payment + dunning
  paymentMethod: text("payment_method"), // cashfree | razorpay | stripe | cash | upi | bank | wallet
  gatewayCustomerToken: text("gateway_customer_token"),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lastChargeAt: timestamp("last_charge_at"),
  lastFailureReason: text("last_failure_reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  restaurantIdx: index("customer_subscriptions_restaurant_idx").on(t.restaurantId),
  customerIdx: index("customer_subscriptions_customer_idx").on(t.customerId),
  billingIdx: index("customer_subscriptions_billing_idx").on(t.nextBillingDate),
}));

export const subscriptionCyclesTable = pgTable("subscription_cycles", {
  id: serial("id").primaryKey(),
  subscriptionId: integer("subscription_id").notNull().references(() => customerSubscriptionsTable.id),
  cycleNumber: integer("cycle_number").notNull(),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  mealsAllotted: integer("meals_allotted").notNull().default(0),
  mealsRemaining: integer("meals_remaining").notNull().default(0),
  creditsAllotted: integer("credits_allotted").notNull().default(0),
  creditsRemaining: integer("credits_remaining").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  subIdx: index("subscription_cycles_sub_idx").on(t.subscriptionId),
}));

export const subscriptionUsageTable = pgTable("subscription_usage", {
  id: serial("id").primaryKey(),
  subscriptionId: integer("subscription_id").notNull().references(() => customerSubscriptionsTable.id),
  cycleId: integer("cycle_id").references(() => subscriptionCyclesTable.id),
  orderId: integer("order_id").references(() => ordersTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  itemsCovered: jsonb("items_covered").$type<Array<{ itemId: number; name: string; quantity: number; value: string }>>().notNull().default([]),
  mealsConsumed: integer("meals_consumed").notNull().default(0),
  creditsConsumed: integer("credits_consumed").notNull().default(0),
  valueCovered: decimal("value_covered", { precision: 10, scale: 2 }).notNull().default("0.00"),
  isReversal: boolean("is_reversal").notNull().default(false),
  note: text("note"),
  recordedBy: integer("recorded_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  subIdx: index("subscription_usage_sub_idx").on(t.subscriptionId),
  orderIdx: index("subscription_usage_order_idx").on(t.orderId),
}));

export const subscriptionInvoicesTable = pgTable("subscription_invoices", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  subscriptionId: integer("subscription_id").notNull().references(() => customerSubscriptionsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  invoiceNumber: text("invoice_number").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  taxRate: decimal("tax_rate", { precision: 5, scale: 2 }).notNull().default("0.00"),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  paymentMethod: text("payment_method"),
  gatewayTxnId: text("gateway_txn_id"),
  status: text("status").notNull().default("paid"), // paid | due | refunded
  pdfUrl: text("pdf_url"),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  restaurantIdx: index("subscription_invoices_restaurant_idx").on(t.restaurantId),
  invNumIdx: uniqueIndex("subscription_invoices_number_idx").on(t.restaurantId, t.invoiceNumber),
  subIdx: index("subscription_invoices_sub_idx").on(t.subscriptionId),
}));

export const subscriptionPaymentsCustomerTable = pgTable("subscription_payments_customer", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  subscriptionId: integer("subscription_id").notNull().references(() => customerSubscriptionsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  invoiceId: integer("invoice_id").references(() => subscriptionInvoicesTable.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  provider: text("provider").notNull(),
  externalRef: text("external_ref"),
  status: text("status").notNull().default("succeeded"), // succeeded | failed | pending | refunded
  failureReason: text("failure_reason"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  subIdx: index("subscription_payments_customer_sub_idx").on(t.subscriptionId),
}));

export const subscriptionFamilyMembersTable = pgTable("subscription_family_members", {
  id: serial("id").primaryKey(),
  subscriptionId: integer("subscription_id").notNull().references(() => customerSubscriptionsTable.id),
  customerId: integer("customer_id").references(() => customersTable.id),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  isActive: boolean("is_active").notNull().default(true),
  addedAt: timestamp("added_at").notNull().defaultNow(),
  removedAt: timestamp("removed_at"),
}, (t) => ({
  subIdx: index("subscription_family_members_sub_idx").on(t.subscriptionId),
}));

export const subscriptionEventsTable = pgTable("subscription_events", {
  id: serial("id").primaryKey(),
  subscriptionId: integer("subscription_id").notNull().references(() => customerSubscriptionsTable.id),
  type: text("type").notNull(), // activated | renewed | charge_failed | dunning_retry | suspended | paused | resumed | cancelled | expired | low_balance | family_added | family_removed | reassigned | manual_redeem | refunded
  message: text("message"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  actorUserId: integer("actor_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  subIdx: index("subscription_events_sub_idx").on(t.subscriptionId),
}));

export type MealPlanTemplate = typeof mealPlanTemplatesTable.$inferSelect;
export type CustomerSubscription = typeof customerSubscriptionsTable.$inferSelect;
export type SubscriptionCycle = typeof subscriptionCyclesTable.$inferSelect;
export type SubscriptionUsage = typeof subscriptionUsageTable.$inferSelect;
export type SubscriptionInvoice = typeof subscriptionInvoicesTable.$inferSelect;
export type SubscriptionPaymentCustomer = typeof subscriptionPaymentsCustomerTable.$inferSelect;
export type SubscriptionFamilyMember = typeof subscriptionFamilyMembersTable.$inferSelect;
export type SubscriptionEvent = typeof subscriptionEventsTable.$inferSelect;
