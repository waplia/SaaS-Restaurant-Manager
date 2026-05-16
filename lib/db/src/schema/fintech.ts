/**
 * Restaurant fintech layer — wallets, unified ledger, payment records,
 * payouts, settlements, reconciliation, commissions, plus future-ready
 * stubs for capital & insurance products.
 *
 * All money values are stored as integer minor units (e.g. paise) in
 * `bigint` columns so we never deal with float drift. Display formatting
 * lives at the UI/API edge.
 */
import {
  pgTable, text, serial, timestamp, integer, boolean, bigint, jsonb,
  uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { restaurantsTable } from "./restaurants";
import { customersTable } from "./customers";
import { usersTable } from "./users";
import { suppliersTable } from "./inventory";

// ─── Wallets ────────────────────────────────────────────────────────────────
// kind:
//   restaurant      — operating wallet for a single branch (restaurantId set)
//   customer        — per-customer prepaid balance (customerId set)
//   cashback        — per-customer cashback / promo balance (customerId set)
//   gift_card       — per gift-card balance (giftCardId set)
//   subscription    — tenant-level prepaid wallet for subscription dues

export const walletsTable = pgTable("fintech_wallets", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "cascade" }),
  giftCardId: integer("gift_card_id"),
  kind: text("kind").notNull(), // restaurant | customer | cashback | gift_card | subscription
  currency: text("currency").notNull().default("INR"),
  balance: bigint("balance", { mode: "number" }).notNull().default(0),
  reserved: bigint("reserved", { mode: "number" }).notNull().default(0),
  lifetimeIn: bigint("lifetime_in", { mode: "number" }).notNull().default(0),
  lifetimeOut: bigint("lifetime_out", { mode: "number" }).notNull().default(0),
  isFrozen: boolean("is_frozen").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  tenantIdx: index("fintech_wallets_tenant_idx").on(t.tenantId, t.kind),
  restaurantIdx: index("fintech_wallets_restaurant_idx").on(t.restaurantId, t.kind),
  customerIdx: index("fintech_wallets_customer_idx").on(t.customerId, t.kind),
  giftCardIdx: uniqueIndex("fintech_wallets_giftcard_idx").on(t.giftCardId),
  // Unique singletons per scope/kind
  uqRestaurant: uniqueIndex("fintech_wallets_uq_restaurant").on(t.restaurantId, t.kind),
  uqCustomer: uniqueIndex("fintech_wallets_uq_customer").on(t.customerId, t.kind),
  uqSubscription: uniqueIndex("fintech_wallets_uq_subscription").on(t.tenantId, t.kind),
}));

// ─── Unified ledger ─────────────────────────────────────────────────────────
// One row per wallet movement. Transfers create paired debit+credit rows
// sharing the same `transferGroupId`.
export const walletTransactionsTable = pgTable("fintech_wallet_transactions", {
  id: serial("id").primaryKey(),
  walletId: integer("wallet_id").notNull().references(() => walletsTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "set null" }),
  direction: text("direction").notNull(), // credit | debit | reserve | release
  amount: bigint("amount", { mode: "number" }).notNull(), // always positive minor units
  currency: text("currency").notNull().default("INR"),
  type: text("type").notNull(),
  // top_up | order_payment | refund | payout | settlement | adjustment
  // | cashback_earn | cashback_redeem | gift_card_load | gift_card_redeem
  // | subscription_debit | fee | commission | transfer_in | transfer_out
  channel: text("channel"),
  // cash | card | upi | gateway | bank | wallet_transfer | manual
  referenceType: text("reference_type"),
  // order | invoice | payout | settlement | gateway_payment | upi_payment | refund | gift_card | manual
  referenceId: integer("reference_id"),
  externalRef: text("external_ref"),
  transferGroupId: text("transfer_group_id"),
  openingBalance: bigint("opening_balance", { mode: "number" }).notNull(),
  closingBalance: bigint("closing_balance", { mode: "number" }).notNull(),
  idempotencyKey: text("idempotency_key"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  walletIdx: index("fintech_wtx_wallet_idx").on(t.walletId, t.createdAt),
  tenantIdx: index("fintech_wtx_tenant_idx").on(t.tenantId, t.createdAt),
  restaurantIdx: index("fintech_wtx_restaurant_idx").on(t.restaurantId, t.createdAt),
  typeIdx: index("fintech_wtx_type_idx").on(t.type, t.createdAt),
  transferIdx: index("fintech_wtx_transfer_idx").on(t.transferGroupId),
  idempotencyIdx: uniqueIndex("fintech_wtx_idempotency_idx").on(t.walletId, t.idempotencyKey),
}));

// ─── Payment records (real-money, restaurant-side) ──────────────────────────

export const gatewayPaymentRecordsTable = pgTable("fintech_gateway_payments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "set null" }),
  gateway: text("gateway").notNull(), // razorpay | cashfree | stripe
  gatewayOrderId: text("gateway_order_id"),
  gatewayPaymentId: text("gateway_payment_id"),
  method: text("method"), // card | upi | netbanking | wallet | etc
  amount: bigint("amount", { mode: "number" }).notNull(),
  feeAmount: bigint("fee_amount", { mode: "number" }).notNull().default(0),
  taxAmount: bigint("tax_amount", { mode: "number" }).notNull().default(0),
  netAmount: bigint("net_amount", { mode: "number" }).notNull().default(0),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull().default("captured"), // captured | failed | refunded | partial_refund
  capturedAt: timestamp("captured_at"),
  settlementBatchId: text("settlement_batch_id"),
  settledAt: timestamp("settled_at"),
  referenceType: text("reference_type"), // order | subscription | ai_recharge | manual
  referenceId: integer("reference_id"),
  walletTransactionId: integer("wallet_transaction_id").references(() => walletTransactionsTable.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  tenantIdx: index("fintech_gw_tenant_idx").on(t.tenantId, t.createdAt),
  gatewayIdx: index("fintech_gw_gateway_idx").on(t.gateway, t.createdAt),
  restaurantIdx: index("fintech_gw_restaurant_idx").on(t.restaurantId, t.createdAt),
  uqGatewayPayment: uniqueIndex("fintech_gw_uq_payment").on(t.gateway, t.gatewayPaymentId),
}));

export const upiPaymentRecordsTable = pgTable("fintech_upi_payments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  source: text("source").notNull(), // gateway | dynamic_qr | manual
  payerVpa: text("payer_vpa"),
  upiTxnId: text("upi_txn_id"),
  amount: bigint("amount", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull().default("captured"),
  referenceType: text("reference_type"),
  referenceId: integer("reference_id"),
  gatewayPaymentRecordId: integer("gateway_payment_record_id").references(() => gatewayPaymentRecordsTable.id, { onDelete: "set null" }),
  walletTransactionId: integer("wallet_transaction_id").references(() => walletTransactionsTable.id, { onDelete: "set null" }),
  recordedBy: integer("recorded_by").references(() => usersTable.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  tenantIdx: index("fintech_upi_tenant_idx").on(t.tenantId, t.createdAt),
  restaurantIdx: index("fintech_upi_restaurant_idx").on(t.restaurantId, t.createdAt),
  uqUpiTxn: uniqueIndex("fintech_upi_uq_txn").on(t.upiTxnId),
}));

export const refundsTable = pgTable("fintech_refunds", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "set null" }),
  originalGatewayPaymentId: integer("original_gateway_payment_id").references(() => gatewayPaymentRecordsTable.id, { onDelete: "set null" }),
  originalUpiPaymentId: integer("original_upi_payment_id").references(() => upiPaymentRecordsTable.id, { onDelete: "set null" }),
  referenceType: text("reference_type"), // order | subscription | manual
  referenceId: integer("reference_id"),
  amount: bigint("amount", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("INR"),
  refundType: text("refund_type").notNull().default("full"), // full | partial
  destination: text("destination").notNull().default("source"), // source | wallet
  reason: text("reason"),
  status: text("status").notNull().default("pending"), // pending | processing | succeeded | failed
  approvedBy: integer("approved_by").references(() => usersTable.id, { onDelete: "set null" }),
  walletTransactionId: integer("wallet_transaction_id").references(() => walletTransactionsTable.id, { onDelete: "set null" }),
  externalRefundId: text("external_refund_id"),
  statusTimeline: jsonb("status_timeline").$type<Array<{ status: string; at: string; by?: number | null; note?: string }>>().notNull().default([]),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  tenantIdx: index("fintech_refund_tenant_idx").on(t.tenantId, t.createdAt),
  restaurantIdx: index("fintech_refund_restaurant_idx").on(t.restaurantId, t.createdAt),
}));

// ─── Gift cards ─────────────────────────────────────────────────────────────

export const giftCardsTable = pgTable("fintech_gift_cards", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "set null" }),
  code: text("code").notNull(),
  recipientCustomerId: integer("recipient_customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  recipientName: text("recipient_name"),
  recipientEmail: text("recipient_email"),
  initialAmount: bigint("initial_amount", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("INR"),
  expiresAt: timestamp("expires_at"),
  status: text("status").notNull().default("active"), // active | redeemed | void | expired
  walletId: integer("wallet_id").references(() => walletsTable.id, { onDelete: "set null" }),
  issuedBy: integer("issued_by").references(() => usersTable.id, { onDelete: "set null" }),
  voidedBy: integer("voided_by").references(() => usersTable.id, { onDelete: "set null" }),
  voidReason: text("void_reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  tenantIdx: index("fintech_gc_tenant_idx").on(t.tenantId, t.createdAt),
  uqCode: uniqueIndex("fintech_gc_uq_code").on(t.tenantId, t.code),
}));

// ─── Cashback rules ─────────────────────────────────────────────────────────

export const cashbackRulesTable = pgTable("fintech_cashback_rules", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  percentBps: integer("percent_bps").notNull().default(0), // 500 = 5%
  capAmount: bigint("cap_amount", { mode: "number" }).notNull().default(0),
  minOrderAmount: bigint("min_order_amount", { mode: "number" }).notNull().default(0),
  expiryDays: integer("expiry_days").notNull().default(90),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  restaurantIdx: index("fintech_cashback_rules_restaurant_idx").on(t.restaurantId),
}));

// ─── Staff payouts ──────────────────────────────────────────────────────────

export const staffPayoutsTable = pgTable("fintech_staff_payouts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  staffUserId: integer("staff_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  grossAmount: bigint("gross_amount", { mode: "number" }).notNull(),
  deductionsAmount: bigint("deductions_amount", { mode: "number" }).notNull().default(0),
  advancesAmount: bigint("advances_amount", { mode: "number" }).notNull().default(0),
  netAmount: bigint("net_amount", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("INR"),
  mode: text("mode"), // cash | bank | upi | wallet
  status: text("status").notNull().default("draft"), // draft | approved | paid | failed | cancelled
  reference: text("reference"),
  paidAt: timestamp("paid_at"),
  paidBy: integer("paid_by").references(() => usersTable.id, { onDelete: "set null" }),
  approvedBy: integer("approved_by").references(() => usersTable.id, { onDelete: "set null" }),
  walletTransactionId: integer("wallet_transaction_id").references(() => walletTransactionsTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  tenantIdx: index("fintech_staffpayout_tenant_idx").on(t.tenantId, t.createdAt),
  restaurantIdx: index("fintech_staffpayout_restaurant_idx").on(t.restaurantId, t.createdAt),
  staffIdx: index("fintech_staffpayout_staff_idx").on(t.staffUserId, t.periodStart),
}));

// ─── Vendor payments ────────────────────────────────────────────────────────

export const vendorPaymentsTable = pgTable("fintech_vendor_payments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  billRef: text("bill_ref"),
  purchaseOrderId: integer("purchase_order_id"),
  amount: bigint("amount", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("INR"),
  mode: text("mode").notNull().default("bank"),
  status: text("status").notNull().default("paid"), // draft | paid | failed
  paidAt: timestamp("paid_at"),
  paidBy: integer("paid_by").references(() => usersTable.id, { onDelete: "set null" }),
  reference: text("reference"),
  walletTransactionId: integer("wallet_transaction_id").references(() => walletTransactionsTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  tenantIdx: index("fintech_vendorpay_tenant_idx").on(t.tenantId, t.createdAt),
  restaurantIdx: index("fintech_vendorpay_restaurant_idx").on(t.restaurantId, t.createdAt),
  supplierIdx: index("fintech_vendorpay_supplier_idx").on(t.supplierId),
}));

// ─── Daily settlement ───────────────────────────────────────────────────────

export const dailySettlementsTable = pgTable("fintech_daily_settlements", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  settlementDate: timestamp("settlement_date").notNull(),
  openingBalance: bigint("opening_balance", { mode: "number" }).notNull().default(0),
  closingBalance: bigint("closing_balance", { mode: "number" }).notNull().default(0),
  totalCollected: bigint("total_collected", { mode: "number" }).notNull().default(0),
  collectedCash: bigint("collected_cash", { mode: "number" }).notNull().default(0),
  collectedCard: bigint("collected_card", { mode: "number" }).notNull().default(0),
  collectedUpi: bigint("collected_upi", { mode: "number" }).notNull().default(0),
  collectedGateway: bigint("collected_gateway", { mode: "number" }).notNull().default(0),
  collectedWallet: bigint("collected_wallet", { mode: "number" }).notNull().default(0),
  totalRefunded: bigint("total_refunded", { mode: "number" }).notNull().default(0),
  totalStaffPayouts: bigint("total_staff_payouts", { mode: "number" }).notNull().default(0),
  totalVendorPayments: bigint("total_vendor_payments", { mode: "number" }).notNull().default(0),
  totalGatewayFees: bigint("total_gateway_fees", { mode: "number" }).notNull().default(0),
  totalPlatformCommission: bigint("total_platform_commission", { mode: "number" }).notNull().default(0),
  netSettlement: bigint("net_settlement", { mode: "number" }).notNull().default(0),
  orderCount: integer("order_count").notNull().default(0),
  refundCount: integer("refund_count").notNull().default(0),
  payoutCount: integer("payout_count").notNull().default(0),
  status: text("status").notNull().default("draft"), // draft | finalised | emailed
  emailedAt: timestamp("emailed_at"),
  generatedBy: integer("generated_by").references(() => usersTable.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  uqRestaurantDay: uniqueIndex("fintech_daily_uq_restaurant_day").on(t.restaurantId, t.settlementDate),
  tenantIdx: index("fintech_daily_tenant_idx").on(t.tenantId, t.settlementDate),
}));

// ─── Reconciliation ─────────────────────────────────────────────────────────

export const reconciliationRunsTable = pgTable("fintech_reconciliation_runs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "set null" }),
  source: text("source").notNull(), // razorpay | cashfree | stripe | cash_shift | csv
  fromDate: timestamp("from_date").notNull(),
  toDate: timestamp("to_date").notNull(),
  totalRecordsExternal: integer("total_records_external").notNull().default(0),
  totalRecordsInternal: integer("total_records_internal").notNull().default(0),
  matchedCount: integer("matched_count").notNull().default(0),
  missingOnGatewayCount: integer("missing_on_gateway_count").notNull().default(0),
  missingOnPlatformCount: integer("missing_on_platform_count").notNull().default(0),
  amountMismatchCount: integer("amount_mismatch_count").notNull().default(0),
  status: text("status").notNull().default("completed"), // running | completed | failed
  triggeredBy: integer("triggered_by").references(() => usersTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  tenantIdx: index("fintech_recon_tenant_idx").on(t.tenantId, t.createdAt),
  sourceIdx: index("fintech_recon_source_idx").on(t.source, t.createdAt),
}));

export const reconciliationVariancesTable = pgTable("fintech_reconciliation_variances", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => reconciliationRunsTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "set null" }),
  varianceType: text("variance_type").notNull(),
  // missing_on_gateway | missing_on_platform | amount_mismatch | cash_short | cash_over
  externalRef: text("external_ref"),
  internalRecordId: integer("internal_record_id"),
  expectedAmount: bigint("expected_amount", { mode: "number" }),
  actualAmount: bigint("actual_amount", { mode: "number" }),
  status: text("status").notNull().default("open"), // open | acknowledged | resolved
  resolvedBy: integer("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at"),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  runIdx: index("fintech_var_run_idx").on(t.runId),
  tenantIdx: index("fintech_var_tenant_idx").on(t.tenantId, t.createdAt),
  statusIdx: index("fintech_var_status_idx").on(t.status),
}));

export const cashShiftReconciliationsTable = pgTable("fintech_cash_shift_recon", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  shiftDate: timestamp("shift_date").notNull(),
  shiftLabel: text("shift_label"),
  expectedCash: bigint("expected_cash", { mode: "number" }).notNull().default(0),
  countedCash: bigint("counted_cash", { mode: "number" }).notNull().default(0),
  variance: bigint("variance", { mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("reconciled"), // reconciled | flagged
  reconciledBy: integer("reconciled_by").references(() => usersTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  restaurantIdx: index("fintech_shift_restaurant_idx").on(t.restaurantId, t.shiftDate),
}));

// ─── Platform commissions ───────────────────────────────────────────────────

export const platformCommissionsTable = pgTable("fintech_platform_commissions", {
  id: serial("id").primaryKey(),
  gateway: text("gateway").notNull(), // razorpay | cashfree | stripe | cash | upi | manual
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  percentBps: integer("percent_bps").notNull().default(0),
  fixedFee: bigint("fixed_fee", { mode: "number" }).notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  uqGatewayTenant: uniqueIndex("fintech_commission_uq").on(t.gateway, t.tenantId),
}));

// ─── Future-ready placeholders ──────────────────────────────────────────────

export const restaurantCreditScoresTable = pgTable("fintech_restaurant_credit_scores", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  score: integer("score").notNull().default(0), // 0..100
  band: text("band").notNull().default("unknown"), // poor | fair | good | excellent | unknown
  signals: jsonb("signals").$type<Record<string, number | string>>().notNull().default({}),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
  status: text("status").notNull().default("placeholder"),
}, t => ({
  uqRestaurant: uniqueIndex("fintech_credit_uq_restaurant").on(t.restaurantId),
}));

export const loanEligibilitySignalsTable = pgTable("fintech_loan_eligibility_signals", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  estimatedLimit: bigint("estimated_limit", { mode: "number" }).notNull().default(0),
  currency: text("currency").notNull().default("INR"),
  signals: jsonb("signals").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("placeholder"),
  notifyMeAt: timestamp("notify_me_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const salesAdvanceRequestsTable = pgTable("fintech_sales_advance_requests", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  requestedAmount: bigint("requested_amount", { mode: "number" }).notNull().default(0),
  eligibleAmount: bigint("eligible_amount", { mode: "number" }).notNull().default(0),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull().default("placeholder"), // placeholder | callback_requested
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insuranceOffersTable = pgTable("fintech_insurance_offers", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  shortDescription: text("short_description"),
  category: text("category").notNull().default("general"),
  monthlyPremiumEstimate: bigint("monthly_premium_estimate", { mode: "number" }).notNull().default(0),
  currency: text("currency").notNull().default("INR"),
  isActive: boolean("is_active").notNull().default(true),
  status: text("status").notNull().default("placeholder"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  uqSlug: uniqueIndex("fintech_insurance_uq_slug").on(t.slug),
}));

export const insuranceInterestsTable = pgTable("fintech_insurance_interests", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }),
  offerId: integer("offer_id").references(() => insuranceOffersTable.id, { onDelete: "set null" }),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  notes: text("notes"),
  status: text("status").notNull().default("placeholder"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const vendorCreditLinesTable = pgTable("fintech_vendor_credit_lines", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  estimatedLimit: bigint("estimated_limit", { mode: "number" }).notNull().default(0),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull().default("placeholder"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  supplierIdx: index("fintech_vendor_credit_supplier_idx").on(t.supplierId),
}));

// ─── Types ──────────────────────────────────────────────────────────────────

export type Wallet = typeof walletsTable.$inferSelect;
export type WalletTransaction = typeof walletTransactionsTable.$inferSelect;
export type GatewayPaymentRecord = typeof gatewayPaymentRecordsTable.$inferSelect;
export type UpiPaymentRecord = typeof upiPaymentRecordsTable.$inferSelect;
export type Refund = typeof refundsTable.$inferSelect;
export type GiftCard = typeof giftCardsTable.$inferSelect;
export type CashbackRule = typeof cashbackRulesTable.$inferSelect;
export type StaffPayout = typeof staffPayoutsTable.$inferSelect;
export type VendorPayment = typeof vendorPaymentsTable.$inferSelect;
export type DailySettlement = typeof dailySettlementsTable.$inferSelect;
export type ReconciliationRun = typeof reconciliationRunsTable.$inferSelect;
export type ReconciliationVariance = typeof reconciliationVariancesTable.$inferSelect;
export type CashShiftReconciliation = typeof cashShiftReconciliationsTable.$inferSelect;
export type PlatformCommission = typeof platformCommissionsTable.$inferSelect;
export type RestaurantCreditScore = typeof restaurantCreditScoresTable.$inferSelect;
export type InsuranceOffer = typeof insuranceOffersTable.$inferSelect;
export type InsuranceInterest = typeof insuranceInterestsTable.$inferSelect;
export type VendorCreditLine = typeof vendorCreditLinesTable.$inferSelect;
export type SalesAdvanceRequest = typeof salesAdvanceRequestsTable.$inferSelect;
export type LoanEligibilitySignal = typeof loanEligibilitySignalsTable.$inferSelect;
