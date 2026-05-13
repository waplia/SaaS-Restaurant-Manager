import { pgTable, text, serial, timestamp, integer, boolean, decimal, date, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

export const expenseCategoriesTable = pgTable("expense_categories", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  color: text("color").notNull().default("#f97316"),
  icon: text("icon").notNull().default("Receipt"),
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
  categoryId: integer("category_id").notNull().references(() => expenseCategoriesTable.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  expenseDate: date("expense_date").notNull(),
  payee: text("payee"),
  paymentMethod: text("payment_method").default("cash"),
  notes: text("notes"),
  receiptUrl: text("receipt_url"),
  recurringTemplateId: integer("recurring_template_id").references(() => recurringExpensesTable.id),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqRecurringDate: uniqueIndex("expenses_recurring_template_date_uniq")
    .on(t.recurringTemplateId, t.expenseDate)
    .where(sql`${t.recurringTemplateId} IS NOT NULL`),
}));

export type ExpenseCategory = typeof expenseCategoriesTable.$inferSelect;
export type Expense = typeof expensesTable.$inferSelect;
export type RecurringExpense = typeof recurringExpensesTable.$inferSelect;
