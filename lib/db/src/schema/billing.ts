import { pgTable, text, serial, timestamp, integer, boolean, decimal, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  externalRefIdx: uniqueIndex("subscription_payments_external_ref_idx").on(t.externalRef),
}));

export type PaymentMethodSetting = typeof paymentMethodSettingsTable.$inferSelect;
export type ManualPaymentRequest = typeof manualPaymentRequestsTable.$inferSelect;
export type SubscriptionPayment = typeof subscriptionPaymentsTable.$inferSelect;
