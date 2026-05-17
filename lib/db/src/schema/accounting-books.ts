import { pgTable, text, serial, timestamp, integer, jsonb, uniqueIndex, index, decimal, date, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const NORMAL_BALANCES = ["debit", "credit"] as const;
export type NormalBalance = (typeof NORMAL_BALANCES)[number];

export const JOURNAL_SOURCES = [
  "manual",
  "pos_sales",
  "payroll",
  "inventory_purchase",
  "inventory_adjustment",
  "refund",
  "expense",
  "vendor_bill",
  "vendor_bill_payment",
  "ar_invoice",
  "ar_receipt",
  "bank_rec",
  "opening_balance",
] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

export const JOURNAL_STATUSES = ["draft", "posted", "void"] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export const VENDOR_BILL_STATUSES = ["draft", "pending_approval", "approved", "scheduled", "paid", "void"] as const;
export type VendorBillStatus = (typeof VENDOR_BILL_STATUSES)[number];

export const AR_INVOICE_STATUSES = ["draft", "open", "partial", "paid", "void"] as const;
export type ArInvoiceStatus = (typeof AR_INVOICE_STATUSES)[number];

export const PERIOD_STATUSES = ["open", "soft_close", "closed"] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export const COA_TEMPLATES = ["restaurant_in", "restaurant_us", "minimal"] as const;
export type CoaTemplate = (typeof COA_TEMPLATES)[number];

// ─── Chart of Accounts ────────────────────────────────────────────────
export const chartOfAccountsTable = pgTable(
  "chart_of_accounts",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    code: text("code").notNull(), // e.g. "1000", "4000"
    name: text("name").notNull(),
    type: text("type").$type<AccountType>().notNull(),
    normalBalance: text("normal_balance").$type<NormalBalance>().notNull(),
    parentId: integer("parent_id"),
    isActive: boolean("is_active").notNull().default(true),
    isSystem: boolean("is_system").notNull().default(false),
    description: text("description"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("coa_restaurant_code_uniq").on(t.restaurantId, t.code),
    byType: index("coa_restaurant_type_idx").on(t.restaurantId, t.type),
  }),
);

// ─── Accounting Periods (period close lock) ──────────────────────────
export const accountingPeriodsTable = pgTable(
  "accounting_periods",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: text("status").$type<PeriodStatus>().notNull().default("open"),
    closedAt: timestamp("closed_at"),
    closedBy: integer("closed_by").references(() => usersTable.id),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("accounting_periods_restaurant_start_uniq").on(t.restaurantId, t.periodStart),
    byRestaurant: index("accounting_periods_restaurant_idx").on(t.restaurantId, t.periodEnd),
  }),
);

// ─── Journal Entries ──────────────────────────────────────────────────
export const journalEntriesTable = pgTable(
  "journal_entries",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    journalNo: text("journal_no").notNull(),
    entryDate: date("entry_date").notNull(),
    source: text("source").$type<JournalSource>().notNull().default("manual"),
    sourceRef: text("source_ref"),
    memo: text("memo"),
    status: text("status").$type<JournalStatus>().notNull().default("draft"),
    totalDebit: decimal("total_debit", { precision: 14, scale: 2 }).notNull().default("0.00"),
    totalCredit: decimal("total_credit", { precision: 14, scale: 2 }).notNull().default("0.00"),
    postedAt: timestamp("posted_at"),
    postedBy: integer("posted_by").references(() => usersTable.id),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqNo: uniqueIndex("journal_entries_restaurant_no_uniq").on(t.restaurantId, t.journalNo),
    byDate: index("journal_entries_restaurant_date_idx").on(t.restaurantId, t.entryDate),
    bySource: index("journal_entries_source_ref_idx").on(t.restaurantId, t.source, t.sourceRef),
  }),
);

export const journalEntryLinesTable = pgTable(
  "journal_entry_lines",
  {
    id: serial("id").primaryKey(),
    journalEntryId: integer("journal_entry_id").notNull().references(() => journalEntriesTable.id, { onDelete: "cascade" }),
    accountId: integer("account_id").notNull().references(() => chartOfAccountsTable.id),
    debit: decimal("debit", { precision: 14, scale: 2 }).notNull().default("0.00"),
    credit: decimal("credit", { precision: 14, scale: 2 }).notNull().default("0.00"),
    memo: text("memo"),
    lineOrder: integer("line_order").notNull().default(0),
  },
  (t) => ({
    byEntry: index("journal_entry_lines_entry_idx").on(t.journalEntryId),
    byAccount: index("journal_entry_lines_account_idx").on(t.accountId),
  }),
);

// ─── Vendor Bills (AP) ────────────────────────────────────────────────
export const vendorBillsTable = pgTable(
  "vendor_bills",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    billNo: text("bill_no").notNull(),
    vendorName: text("vendor_name").notNull(),
    vendorEmail: text("vendor_email"),
    vendorGstin: text("vendor_gstin"),
    billDate: date("bill_date").notNull(),
    dueDate: date("due_date").notNull(),
    scheduledPayDate: date("scheduled_pay_date"),
    subtotal: decimal("subtotal", { precision: 14, scale: 2 }).notNull().default("0.00"),
    taxAmount: decimal("tax_amount", { precision: 14, scale: 2 }).notNull().default("0.00"),
    totalAmount: decimal("total_amount", { precision: 14, scale: 2 }).notNull().default("0.00"),
    amountPaid: decimal("amount_paid", { precision: 14, scale: 2 }).notNull().default("0.00"),
    status: text("status").$type<VendorBillStatus>().notNull().default("draft"),
    apAccountId: integer("ap_account_id").references(() => chartOfAccountsTable.id),
    expenseAccountId: integer("expense_account_id").references(() => chartOfAccountsTable.id),
    notes: text("notes"),
    approvedBy: integer("approved_by").references(() => usersTable.id),
    approvedAt: timestamp("approved_at"),
    journalEntryId: integer("journal_entry_id").references(() => journalEntriesTable.id),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqNo: uniqueIndex("vendor_bills_restaurant_no_uniq").on(t.restaurantId, t.billNo),
    byStatus: index("vendor_bills_restaurant_status_idx").on(t.restaurantId, t.status),
  }),
);

export const vendorBillLinesTable = pgTable(
  "vendor_bill_lines",
  {
    id: serial("id").primaryKey(),
    vendorBillId: integer("vendor_bill_id").notNull().references(() => vendorBillsTable.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: decimal("quantity", { precision: 14, scale: 3 }).notNull().default("1.000"),
    unitPrice: decimal("unit_price", { precision: 14, scale: 2 }).notNull().default("0.00"),
    taxRate: decimal("tax_rate", { precision: 5, scale: 2 }).notNull().default("0.00"),
    lineTotal: decimal("line_total", { precision: 14, scale: 2 }).notNull().default("0.00"),
    accountId: integer("account_id").references(() => chartOfAccountsTable.id),
    lineOrder: integer("line_order").notNull().default(0),
  },
  (t) => ({
    byBill: index("vendor_bill_lines_bill_idx").on(t.vendorBillId),
  }),
);

export const vendorBillPaymentsTable = pgTable(
  "vendor_bill_payments",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    vendorBillId: integer("vendor_bill_id").notNull().references(() => vendorBillsTable.id, { onDelete: "cascade" }),
    paymentDate: date("payment_date").notNull(),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    paymentMethod: text("payment_method").notNull().default("bank_transfer"),
    reference: text("reference"),
    bankAccountId: integer("bank_account_id").references(() => chartOfAccountsTable.id),
    journalEntryId: integer("journal_entry_id").references(() => journalEntriesTable.id),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    byBill: index("vendor_bill_payments_bill_idx").on(t.vendorBillId),
    byRestaurant: index("vendor_bill_payments_restaurant_idx").on(t.restaurantId, t.paymentDate),
  }),
);

// ─── AR Invoices ──────────────────────────────────────────────────────
export const arInvoicesTable = pgTable(
  "ar_invoices",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    invoiceNo: text("invoice_no").notNull(),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email"),
    customerGstin: text("customer_gstin"),
    invoiceDate: date("invoice_date").notNull(),
    dueDate: date("due_date").notNull(),
    subtotal: decimal("subtotal", { precision: 14, scale: 2 }).notNull().default("0.00"),
    taxAmount: decimal("tax_amount", { precision: 14, scale: 2 }).notNull().default("0.00"),
    totalAmount: decimal("total_amount", { precision: 14, scale: 2 }).notNull().default("0.00"),
    amountReceived: decimal("amount_received", { precision: 14, scale: 2 }).notNull().default("0.00"),
    status: text("status").$type<ArInvoiceStatus>().notNull().default("draft"),
    arAccountId: integer("ar_account_id").references(() => chartOfAccountsTable.id),
    incomeAccountId: integer("income_account_id").references(() => chartOfAccountsTable.id),
    notes: text("notes"),
    journalEntryId: integer("journal_entry_id").references(() => journalEntriesTable.id),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqNo: uniqueIndex("ar_invoices_restaurant_no_uniq").on(t.restaurantId, t.invoiceNo),
    byStatus: index("ar_invoices_restaurant_status_idx").on(t.restaurantId, t.status),
  }),
);

// ─── Ledger Mapping Rules (drives auto-postings) ─────────────────────
export const RULE_SOURCES = [
  "pos_sales",
  "payroll",
  "inventory_purchase",
  "inventory_adjustment",
  "refund",
  "expense",
] as const;
export type RuleSource = (typeof RULE_SOURCES)[number];

export const bookLedgerRulesTable = pgTable(
  "book_ledger_rules",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    source: text("source").$type<RuleSource>().notNull(),
    matchKey: text("match_key").notNull().default("*"), // e.g. payment_method=cash, category=salaries
    debitAccountId: integer("debit_account_id").references(() => chartOfAccountsTable.id),
    creditAccountId: integer("credit_account_id").references(() => chartOfAccountsTable.id),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("book_ledger_rules_uniq").on(t.restaurantId, t.source, t.matchKey),
  }),
);

// ─── Zod schemas / types ─────────────────────────────────────────────
export const insertChartOfAccountSchema = createInsertSchema(chartOfAccountsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertJournalEntrySchema = createInsertSchema(journalEntriesTable).omit({ id: true, createdAt: true, updatedAt: true, totalDebit: true, totalCredit: true });
export const insertVendorBillSchema = createInsertSchema(vendorBillsTable).omit({ id: true, createdAt: true, updatedAt: true, amountPaid: true });
export const insertArInvoiceSchema = createInsertSchema(arInvoicesTable).omit({ id: true, createdAt: true, updatedAt: true, amountReceived: true });

export type ChartOfAccount = typeof chartOfAccountsTable.$inferSelect;
export type AccountingPeriod = typeof accountingPeriodsTable.$inferSelect;
export type JournalEntry = typeof journalEntriesTable.$inferSelect;
export type JournalEntryLine = typeof journalEntryLinesTable.$inferSelect;
export type VendorBill = typeof vendorBillsTable.$inferSelect;
export type VendorBillLine = typeof vendorBillLinesTable.$inferSelect;
export type VendorBillPayment = typeof vendorBillPaymentsTable.$inferSelect;
export type ArInvoice = typeof arInvoicesTable.$inferSelect;
export type BookLedgerRule = typeof bookLedgerRulesTable.$inferSelect;

export type InsertChartOfAccount = z.infer<typeof insertChartOfAccountSchema>;
export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;
export type InsertVendorBill = z.infer<typeof insertVendorBillSchema>;
export type InsertArInvoice = z.infer<typeof insertArInvoiceSchema>;

// ─── CoA Templates ────────────────────────────────────────────────────
export interface CoaTemplateAccount {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  isSystem?: boolean;
}

export const COA_TEMPLATE_DEFS: Record<CoaTemplate, { label: string; accounts: CoaTemplateAccount[] }> = {
  restaurant_in: {
    label: "Restaurant — India (GST-ready)",
    accounts: [
      { code: "1000", name: "Cash on Hand",            type: "asset",     normalBalance: "debit",  isSystem: true },
      { code: "1010", name: "Bank Account",            type: "asset",     normalBalance: "debit",  isSystem: true },
      { code: "1020", name: "UPI / Digital Wallets",   type: "asset",     normalBalance: "debit" },
      { code: "1030", name: "Card Settlements",        type: "asset",     normalBalance: "debit" },
      { code: "1100", name: "Accounts Receivable",     type: "asset",     normalBalance: "debit",  isSystem: true },
      { code: "1200", name: "Inventory",               type: "asset",     normalBalance: "debit",  isSystem: true },
      { code: "1500", name: "Equipment & Fixtures",    type: "asset",     normalBalance: "debit" },
      { code: "2000", name: "Accounts Payable",        type: "liability", normalBalance: "credit", isSystem: true },
      { code: "2100", name: "GST Output Payable",      type: "liability", normalBalance: "credit", isSystem: true },
      { code: "2110", name: "GST Input Credit",        type: "asset",     normalBalance: "debit" },
      { code: "2200", name: "Salaries Payable",        type: "liability", normalBalance: "credit" },
      { code: "2300", name: "TDS Payable",             type: "liability", normalBalance: "credit" },
      { code: "3000", name: "Owner's Capital",         type: "equity",    normalBalance: "credit", isSystem: true },
      { code: "3100", name: "Retained Earnings",       type: "equity",    normalBalance: "credit", isSystem: true },
      { code: "4000", name: "Sales — Food",            type: "income",    normalBalance: "credit", isSystem: true },
      { code: "4010", name: "Sales — Beverages",       type: "income",    normalBalance: "credit" },
      { code: "4020", name: "Sales — Delivery",        type: "income",    normalBalance: "credit" },
      { code: "4900", name: "Sales Refunds",           type: "income",    normalBalance: "debit" },
      { code: "5000", name: "Cost of Goods Sold",      type: "expense",   normalBalance: "debit",  isSystem: true },
      { code: "5100", name: "Salaries & Wages",        type: "expense",   normalBalance: "debit" },
      { code: "5200", name: "Rent",                    type: "expense",   normalBalance: "debit" },
      { code: "5300", name: "Utilities",               type: "expense",   normalBalance: "debit" },
      { code: "5400", name: "Marketing",               type: "expense",   normalBalance: "debit" },
      { code: "5500", name: "Maintenance & Repairs",   type: "expense",   normalBalance: "debit" },
      { code: "5900", name: "Miscellaneous Expense",   type: "expense",   normalBalance: "debit" },
    ],
  },
  restaurant_us: {
    label: "Restaurant — US",
    accounts: [
      { code: "1000", name: "Cash on Hand",            type: "asset",     normalBalance: "debit",  isSystem: true },
      { code: "1010", name: "Checking Account",        type: "asset",     normalBalance: "debit",  isSystem: true },
      { code: "1100", name: "Accounts Receivable",     type: "asset",     normalBalance: "debit",  isSystem: true },
      { code: "1200", name: "Food Inventory",          type: "asset",     normalBalance: "debit",  isSystem: true },
      { code: "1210", name: "Beverage Inventory",      type: "asset",     normalBalance: "debit" },
      { code: "2000", name: "Accounts Payable",        type: "liability", normalBalance: "credit", isSystem: true },
      { code: "2100", name: "Sales Tax Payable",       type: "liability", normalBalance: "credit", isSystem: true },
      { code: "2200", name: "Tips Payable",            type: "liability", normalBalance: "credit" },
      { code: "3000", name: "Owner Equity",            type: "equity",    normalBalance: "credit", isSystem: true },
      { code: "3100", name: "Retained Earnings",       type: "equity",    normalBalance: "credit", isSystem: true },
      { code: "4000", name: "Food Sales",              type: "income",    normalBalance: "credit", isSystem: true },
      { code: "4010", name: "Beverage Sales",          type: "income",    normalBalance: "credit" },
      { code: "4900", name: "Refunds & Comps",         type: "income",    normalBalance: "debit" },
      { code: "5000", name: "Cost of Food Sold",       type: "expense",   normalBalance: "debit",  isSystem: true },
      { code: "5010", name: "Cost of Beverage Sold",   type: "expense",   normalBalance: "debit" },
      { code: "5100", name: "Labor — Wages",           type: "expense",   normalBalance: "debit" },
      { code: "5200", name: "Rent",                    type: "expense",   normalBalance: "debit" },
      { code: "5300", name: "Utilities",               type: "expense",   normalBalance: "debit" },
      { code: "5400", name: "Marketing",               type: "expense",   normalBalance: "debit" },
      { code: "5900", name: "Other Operating Expense", type: "expense",   normalBalance: "debit" },
    ],
  },
  minimal: {
    label: "Minimal (5 accounts)",
    accounts: [
      { code: "1000", name: "Cash",                type: "asset",     normalBalance: "debit",  isSystem: true },
      { code: "2000", name: "Accounts Payable",    type: "liability", normalBalance: "credit", isSystem: true },
      { code: "3000", name: "Owner Equity",        type: "equity",    normalBalance: "credit", isSystem: true },
      { code: "4000", name: "Sales",               type: "income",    normalBalance: "credit", isSystem: true },
      { code: "5000", name: "Operating Expenses",  type: "expense",   normalBalance: "debit",  isSystem: true },
    ],
  },
};
