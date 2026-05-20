/**
 * PhonePe Offline Payments — Task #522.
 *
 * Tables:
 *  - phonepe_provider_configs: single-row super-admin owned credentials & flags.
 *  - phonepe_terminals:        per-restaurant store/terminal mapping.
 *  - phonepe_transactions:     one row per payment attempt (EDC, DQR, Collect, Paylink, Static).
 *  - phonepe_callbacks:        raw S2S callbacks (idempotency + audit).
 *  - phonepe_reconciliation_records: one row per PhonePe MIS line during recon.
 *  - phonepe_refunds:          refund attempts linked to a transaction.
 *
 * All secrets are stored encrypted (AES-256-GCM via aiEncryption helpers).
 * Amounts are stored in paise (integer) for accuracy.
 */
import { pgTable, serial, integer, text, boolean, timestamp, jsonb, index, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { restaurantsTable, branchesTable } from "./restaurants";
import { usersTable } from "./users";
import { ordersTable } from "./orders";
import { paymentsTable } from "./payments";

/** UAT / Production environment selector. */
export type PhonePeEnv = "uat" | "prod";

/** Solutions the merchant has enabled via PhonePe Business onboarding. */
export type PhonePeSolution = "EDC" | "DYNAMIC_QR" | "COLLECT" | "PAYLINK" | "STATIC_QR";

/** Terminal binding type per PhonePe spec. */
export type PhonePeTerminalBinding = "ONE_TO_ONE" | "OPEN";

/** Lifecycle status of a PhonePe transaction. */
export type PhonePeTxnStatus =
  | "initiated"
  | "pending"
  | "success"
  | "failed"
  | "expired"
  | "cancelled"
  | "refunded"
  | "partially_refunded";

/** Super-admin-owned configuration. Single logical row (we still allow many for audit history). */
export const phonepeProviderConfigsTable = pgTable("phonepe_provider_configs", {
  id: serial("id").primaryKey(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  env: varchar("env", { length: 10 }).$type<PhonePeEnv>().notNull().default("uat"),
  merchantId: text("merchant_id"),
  saltIndex: integer("salt_index").notNull().default(1),
  // Encrypted salt key (AES-256-GCM).
  saltKeyCipher: text("salt_key_cipher"),
  saltKeyIv: text("salt_key_iv"),
  saltKeyTag: text("salt_key_tag"),
  callbackUsername: text("callback_username"),
  // Encrypted basic-auth password for S2S callbacks.
  callbackPasswordCipher: text("callback_password_cipher"),
  callbackPasswordIv: text("callback_password_iv"),
  callbackPasswordTag: text("callback_password_tag"),
  defaultTimeoutSec: integer("default_timeout_sec").notNull().default(120),
  // Map<PhonePeSolution, boolean>
  enabledSolutions: jsonb("enabled_solutions").$type<Record<string, boolean>>().notNull().default({}),
  // Override default base URLs if PhonePe gave a tenant-specific endpoint.
  uatBaseUrl: text("uat_base_url"),
  prodBaseUrl: text("prod_base_url"),
  refundApiEnabled: boolean("refund_api_enabled").notNull().default(true),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-restaurant terminal mapping (also visible to super admin). */
export const phonepeTerminalsTable = pgTable("phonepe_terminals", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  label: text("label").notNull(),
  storeId: text("store_id").notNull(),
  terminalId: text("terminal_id"),
  binding: varchar("binding", { length: 16 }).$type<PhonePeTerminalBinding>().notNull().default("ONE_TO_ONE"),
  // supported modes for EDC: ["CARD"], ["DQR"], or ["CARD","DQR"].
  supportedModes: jsonb("supported_modes").$type<Array<"CARD" | "DQR">>().notNull().default(["CARD", "DQR"]),
  defaultForCounter: boolean("default_for_counter").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("phonepe_terminals_restaurant_idx").on(t.restaurantId),
  uniqueIndex("phonepe_terminals_store_terminal_uq").on(t.storeId, t.terminalId),
]);

/** One row per PhonePe payment attempt. */
export const phonepeTransactionsTable = pgTable("phonepe_transactions", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  paymentId: integer("payment_id").references(() => paymentsTable.id, { onDelete: "set null" }),
  // PhonePe-side identifiers.
  merchantTransactionId: varchar("merchant_transaction_id", { length: 40 }).notNull(),
  phonepeTransactionId: text("phonepe_transaction_id"),
  shortOrderId: varchar("short_order_id", { length: 16 }),
  // Which solution / mode this attempt is.
  solution: varchar("solution", { length: 16 }).$type<PhonePeSolution>().notNull(),
  requestedModes: jsonb("requested_modes").$type<string[]>().notNull().default([]),
  finalMode: text("final_mode"),
  // Terminal mapping snapshot.
  terminalRowId: integer("terminal_row_id").references(() => phonepeTerminalsTable.id, { onDelete: "set null" }),
  storeId: text("store_id"),
  terminalId: text("terminal_id"),
  binding: varchar("binding", { length: 16 }).$type<PhonePeTerminalBinding>(),
  amountPaise: integer("amount_paise").notNull(),
  status: varchar("status", { length: 32 }).$type<PhonePeTxnStatus>().notNull().default("initiated"),
  responseCode: text("response_code"),
  referenceNumber: text("reference_number"),
  customerPhone: text("customer_phone"),
  customerVpa: text("customer_vpa"),
  paylinkUrl: text("paylink_url"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  initiatedBy: integer("initiated_by").references(() => usersTable.id, { onDelete: "set null" }),
  rawRequest: jsonb("raw_request"),
  rawResponse: jsonb("raw_response"),
  lastStatusCheckAt: timestamp("last_status_check_at", { withTimezone: true }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  webhookAt: timestamp("webhook_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("phonepe_txn_merchant_txn_uq").on(t.merchantTransactionId),
  index("phonepe_txn_restaurant_idx").on(t.restaurantId),
  index("phonepe_txn_order_idx").on(t.orderId),
  index("phonepe_txn_status_idx").on(t.status),
  index("phonepe_txn_solution_idx").on(t.solution),
]);

/** Raw S2S callbacks for idempotency + audit. */
export const phonepeCallbacksTable = pgTable("phonepe_callbacks", {
  id: serial("id").primaryKey(),
  txnRowId: integer("txn_row_id").references(() => phonepeTransactionsTable.id, { onDelete: "set null" }),
  solution: varchar("solution", { length: 16 }).$type<PhonePeSolution | "UNKNOWN">().notNull().default("UNKNOWN"),
  merchantTransactionId: text("merchant_transaction_id"),
  phonepeTransactionId: text("phonepe_transaction_id"),
  receivedXVerify: text("received_x_verify"),
  signatureValid: boolean("signature_valid"),
  rawHeaders: jsonb("raw_headers"),
  rawBody: jsonb("raw_body"),
  processed: boolean("processed").notNull().default(false),
  processingError: text("processing_error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("phonepe_cb_txn_idx").on(t.merchantTransactionId),
  index("phonepe_cb_received_idx").on(t.receivedAt),
]);

/** Reconciliation runs / individual MIS rows. */
export const phonepeReconciliationRecordsTable = pgTable("phonepe_reconciliation_records", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull(),
  source: varchar("source", { length: 16 }).$type<"api" | "csv">().notNull(),
  // Identifiers from the PhonePe MIS row.
  phonepeTransactionId: text("phonepe_transaction_id"),
  merchantTransactionId: text("merchant_transaction_id"),
  referenceNumber: text("reference_number"),
  amountPaise: integer("amount_paise"),
  settlementAmountPaise: integer("settlement_amount_paise"),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  txnRowId: integer("txn_row_id").references(() => phonepeTransactionsTable.id, { onDelete: "set null" }),
  matchStatus: varchar("match_status", { length: 32 }).notNull().default("pending"),
  diffNotes: text("diff_notes"),
  rawRow: jsonb("raw_row"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("phonepe_recon_run_idx").on(t.runId),
  index("phonepe_recon_status_idx").on(t.matchStatus),
]);

/** Refunds initiated against a paid PhonePe transaction. */
export const phonepeRefundsTable = pgTable("phonepe_refunds", {
  id: serial("id").primaryKey(),
  txnRowId: integer("txn_row_id").notNull().references(() => phonepeTransactionsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  refundTransactionId: varchar("refund_transaction_id", { length: 40 }).notNull(),
  amountPaise: integer("amount_paise").notNull(),
  reason: text("reason"),
  status: varchar("status", { length: 32 }).notNull().default("initiated"),
  responseCode: text("response_code"),
  rawRequest: jsonb("raw_request"),
  rawResponse: jsonb("raw_response"),
  initiatedBy: integer("initiated_by").references(() => usersTable.id, { onDelete: "set null" }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("phonepe_refund_txnid_uq").on(t.refundTransactionId),
  index("phonepe_refund_txnrow_idx").on(t.txnRowId),
]);

export type PhonePeProviderConfigRow = typeof phonepeProviderConfigsTable.$inferSelect;
export type PhonePeTerminalRow = typeof phonepeTerminalsTable.$inferSelect;
export type PhonePeTransactionRow = typeof phonepeTransactionsTable.$inferSelect;
export type PhonePeCallbackRow = typeof phonepeCallbacksTable.$inferSelect;
export type PhonePeReconciliationRecordRow = typeof phonepeReconciliationRecordsTable.$inferSelect;
export type PhonePeRefundRow = typeof phonepeRefundsTable.$inferSelect;
