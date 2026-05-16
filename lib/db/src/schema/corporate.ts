import { pgTable, text, serial, timestamp, integer, boolean, decimal, date, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { customersTable } from "./customers";
import { ordersTable } from "./orders";

export const corporateCompaniesTable = pgTable("corporate_companies", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  gstin: text("gstin"),
  billingAddress: text("billing_address"),
  shippingAddress: text("shipping_address"),
  primaryContactName: text("primary_contact_name"),
  primaryContactEmail: text("primary_contact_email"),
  primaryContactPhone: text("primary_contact_phone"),
  billingEmail: text("billing_email"),
  paymentTerms: text("payment_terms").notNull().default("net_15"),
  creditLimit: decimal("credit_limit", { precision: 12, scale: 2 }).notNull().default("0.00"),
  approvalThreshold: decimal("approval_threshold", { precision: 12, scale: 2 }).notNull().default("0.00"),
  monthlyBudget: decimal("monthly_budget", { precision: 12, scale: 2 }),
  billingCycleDay: integer("billing_cycle_day").notNull().default(1),
  autoSuspendOnOverdue: boolean("auto_suspend_on_overdue").notNull().default(true),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byRestaurant: index("corp_companies_restaurant_idx").on(t.restaurantId),
}));

export const corporateDepartmentsTable = pgTable("corporate_departments", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  companyId: integer("company_id").notNull().references(() => corporateCompaniesTable.id),
  name: text("name").notNull(),
  costCenter: text("cost_center"),
  monthlyLimit: decimal("monthly_limit", { precision: 12, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const corporateEmployeesTable = pgTable("corporate_employees", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  companyId: integer("company_id").notNull().references(() => corporateCompaniesTable.id),
  departmentId: integer("department_id").references(() => corporateDepartmentsTable.id),
  customerId: integer("customer_id").references(() => customersTable.id),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  employeeCode: text("employee_code"),
  role: text("role").notNull().default("employee"), // employee | approver | admin
  perMealLimit: decimal("per_meal_limit", { precision: 10, scale: 2 }),
  monthlyLimit: decimal("monthly_limit", { precision: 12, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byCompany: index("corp_emp_company_idx").on(t.companyId),
  uniqEmail: uniqueIndex("corp_emp_company_email_uniq").on(t.companyId, t.email),
}));

// Per-company menu/price overrides — when an item appears here, it replaces
// the standard price. If a company has any override row, only items listed
// for that company are visible (whitelist mode).
export const corporateMenuOverridesTable = pgTable("corporate_menu_overrides", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  companyId: integer("company_id").notNull().references(() => corporateCompaniesTable.id),
  menuItemId: integer("menu_item_id").notNull(),
  priceOverride: decimal("price_override", { precision: 10, scale: 2 }),
  isAvailable: boolean("is_available").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("corp_menu_override_uniq").on(t.companyId, t.menuItemId),
}));

// Tag an order with corporate metadata. Kept as a side-table so the existing
// orders schema is unaffected.
export const corporateOrderLinksTable = pgTable("corporate_order_links", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  companyId: integer("company_id").notNull().references(() => corporateCompaniesTable.id),
  departmentId: integer("department_id").references(() => corporateDepartmentsTable.id),
  employeeId: integer("employee_id").references(() => corporateEmployeesTable.id),
  approvalStatus: text("approval_status").notNull().default("not_required"), // not_required | pending | approved | rejected
  invoiceId: integer("invoice_id"),
  source: text("source").notNull().default("individual"), // individual | bulk | catering | scheduled
  scheduledOrderId: integer("scheduled_order_id"),
  bulkOrderId: integer("bulk_order_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byOrder: uniqueIndex("corp_order_link_order_uniq").on(t.orderId),
  byCompany: index("corp_order_link_company_idx").on(t.companyId),
}));

export const corporateApprovalsTable = pgTable("corporate_approvals", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  companyId: integer("company_id").notNull().references(() => corporateCompaniesTable.id),
  orderId: integer("order_id").references(() => ordersTable.id),
  bulkOrderId: integer("bulk_order_id"),
  requestedByEmployeeId: integer("requested_by_employee_id").references(() => corporateEmployeesTable.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  decidedByEmployeeId: integer("decided_by_employee_id").references(() => corporateEmployeesTable.id),
  decidedAt: timestamp("decided_at"),
  comment: text("comment"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byCompany: index("corp_appr_company_idx").on(t.companyId, t.status),
}));

export const corporateBulkOrdersTable = pgTable("corporate_bulk_orders", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  companyId: integer("company_id").notNull().references(() => corporateCompaniesTable.id),
  departmentId: integer("department_id").references(() => corporateDepartmentsTable.id),
  type: text("type").notNull().default("bulk_lunch"), // bulk_lunch | catering
  title: text("title").notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  deliveryAddress: text("delivery_address"),
  headcount: integer("headcount"),
  setupNotes: text("setup_notes"),
  status: text("status").notNull().default("draft"), // draft | quoted | confirmed | preparing | delivered | cancelled
  quotedAmount: decimal("quoted_amount", { precision: 12, scale: 2 }),
  confirmedAmount: decimal("confirmed_amount", { precision: 12, scale: 2 }),
  cutoffAt: timestamp("cutoff_at"),
  shareToken: text("share_token"), // for shareable per-employee selection links
  orderId: integer("order_id").references(() => ordersTable.id),
  createdByEmployeeId: integer("created_by_employee_id").references(() => corporateEmployeesTable.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byCompany: index("corp_bulk_company_idx").on(t.companyId, t.status),
}));

export const corporateBulkOrderItemsTable = pgTable("corporate_bulk_order_items", {
  id: serial("id").primaryKey(),
  bulkOrderId: integer("bulk_order_id").notNull().references(() => corporateBulkOrdersTable.id),
  menuItemId: integer("menu_item_id").notNull(),
  menuItemName: text("menu_item_name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"),
  // For shareable per-employee selection
  selectedByEmployeeId: integer("selected_by_employee_id").references(() => corporateEmployeesTable.id),
  selectedByName: text("selected_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const corporateScheduledOrdersTable = pgTable("corporate_scheduled_orders", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  companyId: integer("company_id").notNull().references(() => corporateCompaniesTable.id),
  departmentId: integer("department_id").references(() => corporateDepartmentsTable.id),
  employeeId: integer("employee_id").references(() => corporateEmployeesTable.id),
  title: text("title").notNull(),
  // Snapshot of items so the order can be materialised later without
  // refetching live menu state.
  items: jsonb("items").$type<Array<{ menuItemId: number; name: string; quantity: number; unitPrice: string; notes?: string }>>().notNull(),
  deliveryAddress: text("delivery_address"),
  // Recurrence: one_off | daily_weekdays | daily | weekly
  recurrence: text("recurrence").notNull().default("one_off"),
  weekday: integer("weekday"), // 0=Sun .. 6=Sat (for weekly)
  scheduledTime: text("scheduled_time").notNull(), // "HH:MM" 24h
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  nextRunAt: timestamp("next_run_at"),
  lastRunAt: timestamp("last_run_at"),
  reminderSentForRunAt: timestamp("reminder_sent_for_run_at"),
  status: text("status").notNull().default("active"), // active | paused | ended
  source: text("source").notNull().default("individual"), // individual | bulk
  bulkOrderId: integer("bulk_order_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byCompany: index("corp_sched_company_idx").on(t.companyId, t.status),
  byNextRun: index("corp_sched_next_run_idx").on(t.nextRunAt),
}));

export const corporateScheduledSkipsTable = pgTable("corporate_scheduled_skips", {
  id: serial("id").primaryKey(),
  scheduledOrderId: integer("scheduled_order_id").notNull().references(() => corporateScheduledOrdersTable.id),
  skipDate: date("skip_date").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("corp_sched_skip_uniq").on(t.scheduledOrderId, t.skipDate),
}));

export const corporateInvoicesTable = pgTable("corporate_invoices", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  companyId: integer("company_id").notNull().references(() => corporateCompaniesTable.id),
  invoiceNumber: text("invoice_number").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull().default("0.00"),
  taxAmount: decimal("tax_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  discountAmount: decimal("discount_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  amountPaid: decimal("amount_paid", { precision: 12, scale: 2 }).notNull().default("0.00"),
  status: text("status").notNull().default("draft"), // draft | sent | partially_paid | paid | overdue | void
  issuedAt: timestamp("issued_at"),
  dueDate: date("due_date").notNull(),
  paidAt: timestamp("paid_at"),
  paymentTerms: text("payment_terms").notNull().default("net_15"),
  departmentBreakdown: jsonb("department_breakdown").$type<Array<{ departmentId: number | null; departmentName: string; orderCount: number; subtotal: string }>>(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byCompany: index("corp_inv_company_idx").on(t.companyId, t.status),
  uniq: uniqueIndex("corp_inv_number_uniq").on(t.restaurantId, t.invoiceNumber),
}));

export const corporateInvoiceLinesTable = pgTable("corporate_invoice_lines", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => corporateInvoicesTable.id),
  orderId: integer("order_id").references(() => ordersTable.id),
  bulkOrderId: integer("bulk_order_id"),
  departmentId: integer("department_id").references(() => corporateDepartmentsTable.id),
  description: text("description").notNull(),
  orderedAt: timestamp("ordered_at"),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byInvoice: index("corp_inv_lines_invoice_idx").on(t.invoiceId),
}));

export const corporateInvoicePaymentsTable = pgTable("corporate_invoice_payments", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  invoiceId: integer("invoice_id").notNull().references(() => corporateInvoicesTable.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  method: text("method").notNull().default("bank"),
  reference: text("reference"),
  notes: text("notes"),
  paidAt: timestamp("paid_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCorporateCompanySchema = createInsertSchema(corporateCompaniesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCorporateCompany = z.infer<typeof insertCorporateCompanySchema>;
export type CorporateCompany = typeof corporateCompaniesTable.$inferSelect;

export const insertCorporateDepartmentSchema = createInsertSchema(corporateDepartmentsTable).omit({ id: true, createdAt: true });
export type InsertCorporateDepartment = z.infer<typeof insertCorporateDepartmentSchema>;
export type CorporateDepartment = typeof corporateDepartmentsTable.$inferSelect;

export const insertCorporateEmployeeSchema = createInsertSchema(corporateEmployeesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCorporateEmployee = z.infer<typeof insertCorporateEmployeeSchema>;
export type CorporateEmployee = typeof corporateEmployeesTable.$inferSelect;

export const insertCorporateMenuOverrideSchema = createInsertSchema(corporateMenuOverridesTable).omit({ id: true, createdAt: true });
export type InsertCorporateMenuOverride = z.infer<typeof insertCorporateMenuOverrideSchema>;
export type CorporateMenuOverride = typeof corporateMenuOverridesTable.$inferSelect;

export const insertCorporateBulkOrderSchema = createInsertSchema(corporateBulkOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCorporateBulkOrder = z.infer<typeof insertCorporateBulkOrderSchema>;
export type CorporateBulkOrder = typeof corporateBulkOrdersTable.$inferSelect;

export const insertCorporateScheduledOrderSchema = createInsertSchema(corporateScheduledOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCorporateScheduledOrder = z.infer<typeof insertCorporateScheduledOrderSchema>;
export type CorporateScheduledOrder = typeof corporateScheduledOrdersTable.$inferSelect;

export type CorporateInvoice = typeof corporateInvoicesTable.$inferSelect;
export type CorporateInvoiceLine = typeof corporateInvoiceLinesTable.$inferSelect;
export type CorporateInvoicePayment = typeof corporateInvoicePaymentsTable.$inferSelect;
export type CorporateApproval = typeof corporateApprovalsTable.$inferSelect;
export type CorporateBulkOrderItem = typeof corporateBulkOrderItemsTable.$inferSelect;
