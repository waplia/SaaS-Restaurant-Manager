/**
 * Delivery aggregator payout reconciliation (Task #148).
 *
 * Restaurants upload weekly/biweekly payout sheets from Swiggy, Zomato,
 * Uber Eats, etc. and the system matches each row against the orders we
 * have on record, flags mismatches, and tracks claims and adjustments.
 *
 * All money columns are integer paise (bigint) — same convention as the
 * rest of the fintech layer. All tables are scoped by tenantId AND
 * restaurantId so a single tenant with multiple branches cannot see
 * another branch's payouts.
 */
import {
  pgTable, text, serial, timestamp, integer, boolean, bigint, jsonb,
  uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { restaurantsTable } from "./restaurants";
import { ordersTable } from "./orders";
import { usersTable } from "./users";

export const AGGREGATORS = ["swiggy", "zomato", "ubereats", "other"] as const;
export type AggregatorName = typeof AGGREGATORS[number];

// ─── Per-restaurant agreement (commission + GST) ────────────────────────────

export const aggregatorAgreementsTable = pgTable("aggregator_agreements", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  aggregator: text("aggregator").notNull(), // swiggy | zomato | ubereats | other
  // commissionBps = 2500 means 25%
  commissionBps: integer("commission_bps").notNull().default(0),
  gstBps: integer("gst_bps").notNull().default(500), // 5% default
  // tolerance in paise for amount/tax mismatch detection (don't flag <100 paise drift)
  tolerancePaise: bigint("tolerance_paise", { mode: "number" }).notNull().default(100),
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo: timestamp("effective_to"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  uqRestaurantAggregator: uniqueIndex("agg_agreement_uq").on(t.restaurantId, t.aggregator),
  tenantIdx: index("agg_agreement_tenant_idx").on(t.tenantId),
}));

// ─── Uploaded payout sheets ─────────────────────────────────────────────────

export const aggregatorPayoutSheetsTable = pgTable("aggregator_payout_sheets", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  aggregator: text("aggregator").notNull(),
  fileName: text("file_name"),
  fileBytes: integer("file_bytes").notNull().default(0),
  periodFrom: timestamp("period_from").notNull(),
  periodTo: timestamp("period_to").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  // Totals from sheet (sum of net payouts in paise)
  totalGrossPaise: bigint("total_gross_paise", { mode: "number" }).notNull().default(0),
  totalCommissionPaise: bigint("total_commission_paise", { mode: "number" }).notNull().default(0),
  totalTaxPaise: bigint("total_tax_paise", { mode: "number" }).notNull().default(0),
  totalPromoPaise: bigint("total_promo_paise", { mode: "number" }).notNull().default(0),
  totalRefundPaise: bigint("total_refund_paise", { mode: "number" }).notNull().default(0),
  totalNetPaise: bigint("total_net_paise", { mode: "number" }).notNull().default(0),
  // Recon summary cache (so the dashboard doesn't recompute every load)
  matchedCount: integer("matched_count").notNull().default(0),
  unmatchedCount: integer("unmatched_count").notNull().default(0),
  disputedCount: integer("disputed_count").notNull().default(0),
  status: text("status").notNull().default("uploaded"), // uploaded | matched | reconciled | failed
  uploadedBy: integer("uploaded_by").references(() => usersTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  restaurantIdx: index("agg_sheet_restaurant_idx").on(t.restaurantId, t.createdAt),
  tenantIdx: index("agg_sheet_tenant_idx").on(t.tenantId, t.createdAt),
  aggregatorIdx: index("agg_sheet_aggregator_idx").on(t.aggregator, t.periodFrom),
}));

// ─── Per-line payout rows ───────────────────────────────────────────────────

export const aggregatorPayoutRowsTable = pgTable("aggregator_payout_rows", {
  id: serial("id").primaryKey(),
  sheetId: integer("sheet_id").notNull().references(() => aggregatorPayoutSheetsTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  aggregator: text("aggregator").notNull(),
  externalOrderId: text("external_order_id"),
  orderDate: timestamp("order_date"),
  customerName: text("customer_name"),
  status: text("status"), // delivered | cancelled | refunded — as reported by aggregator
  grossPaise: bigint("gross_paise", { mode: "number" }).notNull().default(0),
  commissionPaise: bigint("commission_paise", { mode: "number" }).notNull().default(0),
  taxPaise: bigint("tax_paise", { mode: "number" }).notNull().default(0),
  promoPaise: bigint("promo_paise", { mode: "number" }).notNull().default(0),
  refundPaise: bigint("refund_paise", { mode: "number" }).notNull().default(0),
  netPaise: bigint("net_paise", { mode: "number" }).notNull().default(0),
  rawPayload: jsonb("raw_payload").$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  sheetIdx: index("agg_row_sheet_idx").on(t.sheetId),
  restaurantIdx: index("agg_row_restaurant_idx").on(t.restaurantId),
  externalIdx: index("agg_row_external_idx").on(t.aggregator, t.externalOrderId),
}));

// ─── Reconciliation results ─────────────────────────────────────────────────
// One row per payout-row OR per "missing payout" order detected for the
// sheet's period. issueType=null means matched cleanly.

export const AGGREGATOR_ISSUE_TYPES = [
  "matched",
  "missing_payout",       // order exists locally, no row in sheet
  "missing_order",        // sheet row, no matching order locally
  "excess_commission",
  "cancellation_mismatch",
  "refund_mismatch",
  "tax_mismatch",
  "amount_mismatch",
] as const;
export type AggregatorIssueType = typeof AGGREGATOR_ISSUE_TYPES[number];

export const aggregatorReconResultsTable = pgTable("aggregator_recon_results", {
  id: serial("id").primaryKey(),
  sheetId: integer("sheet_id").notNull().references(() => aggregatorPayoutSheetsTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  rowId: integer("row_id").references(() => aggregatorPayoutRowsTable.id, { onDelete: "cascade" }),
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  issueType: text("issue_type").notNull(),
  // Signed paise impact: positive = aggregator owes us; negative = aggregator overpaid us.
  impactPaise: bigint("impact_paise", { mode: "number" }).notNull().default(0),
  expectedPaise: bigint("expected_paise", { mode: "number" }),
  actualPaise: bigint("actual_paise", { mode: "number" }),
  matchMethod: text("match_method"), // external_id | date_amount | none
  reason: text("reason"),
  status: text("status").notNull().default("open"), // open | claimed | resolved | ignored
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  sheetIdx: index("agg_result_sheet_idx").on(t.sheetId, t.issueType),
  restaurantIdx: index("agg_result_restaurant_idx").on(t.restaurantId, t.createdAt),
  issueIdx: index("agg_result_issue_idx").on(t.issueType, t.status),
}));

// ─── Claims & manual adjustments ────────────────────────────────────────────

export const AGGREGATOR_CLAIM_STATUSES = ["open", "submitted", "recovered", "written_off"] as const;
export type AggregatorClaimStatus = typeof AGGREGATOR_CLAIM_STATUSES[number];

export const aggregatorClaimsTable = pgTable("aggregator_claims", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  sheetId: integer("sheet_id").references(() => aggregatorPayoutSheetsTable.id, { onDelete: "set null" }),
  resultId: integer("result_id").references(() => aggregatorReconResultsTable.id, { onDelete: "set null" }),
  aggregator: text("aggregator").notNull(),
  issueType: text("issue_type").notNull(),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("open"),
  externalRef: text("external_ref"), // ticket id from aggregator portal
  notes: text("notes"),
  submittedAt: timestamp("submitted_at"),
  recoveredAt: timestamp("recovered_at"),
  recoveredPaise: bigint("recovered_paise", { mode: "number" }).notNull().default(0),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  restaurantIdx: index("agg_claim_restaurant_idx").on(t.restaurantId, t.createdAt),
  statusIdx: index("agg_claim_status_idx").on(t.status),
}));

export const aggregatorAdjustmentsTable = pgTable("aggregator_adjustments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  sheetId: integer("sheet_id").references(() => aggregatorPayoutSheetsTable.id, { onDelete: "set null" }),
  rowId: integer("row_id").references(() => aggregatorPayoutRowsTable.id, { onDelete: "set null" }),
  claimId: integer("claim_id").references(() => aggregatorClaimsTable.id, { onDelete: "set null" }),
  aggregator: text("aggregator").notNull(),
  // Signed paise: positive = aggregator credited us; negative = clawback / write-off
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  reason: text("reason").notNull(),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  restaurantIdx: index("agg_adj_restaurant_idx").on(t.restaurantId, t.createdAt),
  sheetIdx: index("agg_adj_sheet_idx").on(t.sheetId),
}));

export type AggregatorAgreement = typeof aggregatorAgreementsTable.$inferSelect;
export type AggregatorPayoutSheet = typeof aggregatorPayoutSheetsTable.$inferSelect;
export type AggregatorPayoutRow = typeof aggregatorPayoutRowsTable.$inferSelect;
export type AggregatorReconResult = typeof aggregatorReconResultsTable.$inferSelect;
export type AggregatorClaim = typeof aggregatorClaimsTable.$inferSelect;
export type AggregatorAdjustment = typeof aggregatorAdjustmentsTable.$inferSelect;
