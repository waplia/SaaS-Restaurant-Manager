import { pgTable, text, serial, timestamp, integer, boolean, decimal, date, uniqueIndex, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { restaurantsTable, branchesTable } from "./restaurants";
import { usersTable } from "./users";

/**
 * Classification of expense categories used by the Smart P&L Dashboard
 * (Task #146). `cogs` = food/raw materials cost; `fixed` = rent etc.;
 * `variable` = utilities/maintenance; `marketing` = ads/promos;
 * `other` = unclassified. Defaults to "other" so existing rows keep working.
 */
export const EXPENSE_CATEGORY_KINDS = ["fixed", "variable", "cogs", "marketing", "other"] as const;
export type ExpenseCategoryKind = typeof EXPENSE_CATEGORY_KINDS[number];

/**
 * Status of an individual expense submission. Below the configured threshold
 * (or when submitted by an owner / super_admin) expenses are auto-approved.
 * Above the threshold they enter the manager's queue.
 */
export const EXPENSE_STATUSES = ["pending", "approved", "rejected"] as const;
export type ExpenseStatus = typeof EXPENSE_STATUSES[number];

export const expenseCategoriesTable = pgTable("expense_categories", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  color: text("color").notNull().default("#f97316"),
  icon: text("icon").notNull().default("Receipt"),
  // P&L classification — see EXPENSE_CATEGORY_KINDS.
  categoryKind: text("category_kind").notNull().default("other"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const recurringExpensesTable = pgTable("recurring_expenses", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  categoryId: integer("category_id").notNull().references(() => expenseCategoriesTable.id),
  name: text("name").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  frequency: text("frequency").notNull().default("monthly"),
  dayOfMonth: integer("day_of_month").notNull().default(1),
  payee: text("payee"),
  paymentMethod: text("payment_method").default("cash"),
  notes: text("notes"),
  nextRunDate: date("next_run_date").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  categoryId: integer("category_id").notNull().references(() => expenseCategoriesTable.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  expenseDate: date("expense_date").notNull(),
  payee: text("payee"),
  paymentMethod: text("payment_method").default("cash"),
  notes: text("notes"),
  receiptUrl: text("receipt_url"),
  recurringTemplateId: integer("recurring_template_id").references(() => recurringExpensesTable.id),
  // Smart P&L (Task #146): expense approval workflow + classification.
  // `expenseType` mirrors the categoryKind at write time so historical
  // P&L numbers don't shift if the category is later reclassified.
  status: text("status").notNull().default("approved"),
  expenseType: text("expense_type").notNull().default("other"),
  approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqRecurringDate: uniqueIndex("expenses_recurring_template_date_uniq")
    .on(t.recurringTemplateId, t.expenseDate)
    .where(sql`${t.recurringTemplateId} IS NOT NULL`),
}));

/**
 * Per-restaurant Smart P&L configuration. One row per restaurant.
 *   - approvalThreshold : amount above which expenses require approval.
 *   - fixedCostBaseline : owner-entered baseline used for break-even when no
 *     fixed/variable expenses are recorded yet (e.g. brand-new outlets).
 *   - leakThresholdPct  : % jump in a category's share of sales that flags
 *     it as a "profit leak" vs the prior equal-length period.
 */
export const pnlSettingsTable = pgTable("pnl_settings", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  approvalThreshold: decimal("approval_threshold", { precision: 12, scale: 2 }).notNull().default("5000.00"),
  fixedCostBaseline: decimal("fixed_cost_baseline", { precision: 12, scale: 2 }).notNull().default("0.00"),
  leakThresholdPct: decimal("leak_threshold_pct", { precision: 5, scale: 2 }).notNull().default("25.00"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique().on(t.restaurantId)]);

export type ExpenseCategory = typeof expenseCategoriesTable.$inferSelect;
export type Expense = typeof expensesTable.$inferSelect;
export type RecurringExpense = typeof recurringExpensesTable.$inferSelect;
export type PnlSettings = typeof pnlSettingsTable.$inferSelect;
