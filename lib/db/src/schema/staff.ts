import { pgTable, text, serial, timestamp, integer, boolean, decimal, unique, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable } from "./restaurants";
import { usersTable } from "./users";

export const staffTable = pgTable("staff", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  employeeCode: text("employee_code"),
  jobTitle: text("job_title"),
  department: text("department"),
  salary: decimal("salary", { precision: 10, scale: 2 }),
  salaryType: text("salary_type").notNull().default("fixed_monthly"),
  hiredAt: timestamp("hired_at"),
  dateOfBirth: timestamp("date_of_birth"),
  gender: text("gender"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  pincode: text("pincode"),
  emergencyContact: text("emergency_contact"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactRelation: text("emergency_contact_relation"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const staffDocumentsTable = pgTable("staff_documents", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  label: text("label").notNull(),
  fileUrl: text("file_url").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const staffBankAccountsTable = pgTable("staff_bank_accounts", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  accountName: text("account_name"),
  accountNumber: text("account_number"),
  ifsc: text("ifsc"),
  bankName: text("bank_name"),
  upiId: text("upi_id"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [unique().on(t.staffId)]);

export const shiftsTable = pgTable("shifts", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  days: text("days").array().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const staffShiftsTable = pgTable("staff_shifts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  shiftId: integer("shift_id").notNull().references(() => shiftsTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  date: timestamp("date").notNull(),
  endDate: timestamp("end_date"),
  recurringDays: text("recurring_days").array().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const attendanceTable = pgTable("attendance", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  date: timestamp("date"),
  status: text("status").notNull().default("present"),
  clockIn: timestamp("clock_in").notNull(),
  clockOut: timestamp("clock_out"),
  totalHours: decimal("total_hours", { precision: 5, scale: 2 }),
  scheduledShiftId: integer("scheduled_shift_id").references(() => shiftsTable.id),
  scheduledMinutes: integer("scheduled_minutes").default(0),
  workedMinutes: integer("worked_minutes").default(0),
  lateMinutes: integer("late_minutes").default(0),
  overtimeMinutes: integer("overtime_minutes").default(0),
  source: text("source").notNull().default("manual"),
  markedByUserId: integer("marked_by_user_id").references(() => usersTable.id),
  notes: text("notes"),
  leaveRequestId: integer("leave_request_id"),
  leavePaid: boolean("leave_paid"),
  leavePortion: decimal("leave_portion", { precision: 3, scale: 2 }),
  prevStatus: text("prev_status"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurantsTable.id),
  targetRestaurantId: integer("target_restaurant_id").references(() => restaurantsTable.id),
  userId: integer("user_id").references(() => usersTable.id),
  userDisplay: text("user_display"),
  role: text("role"),
  module: text("module"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: integer("entity_id"),
  details: text("details"),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  moduleActionCreatedAtIdx: index("audit_logs_module_action_created_idx").on(t.module, t.action, t.createdAt),
}));

export const insertStaffSchema = createInsertSchema(staffTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type Staff = typeof staffTable.$inferSelect;

export const insertStaffDocumentSchema = createInsertSchema(staffDocumentsTable).omit({ id: true, createdAt: true });
export type InsertStaffDocument = z.infer<typeof insertStaffDocumentSchema>;
export type StaffDocument = typeof staffDocumentsTable.$inferSelect;

export const insertStaffBankAccountSchema = createInsertSchema(staffBankAccountsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStaffBankAccount = z.infer<typeof insertStaffBankAccountSchema>;
export type StaffBankAccount = typeof staffBankAccountsTable.$inferSelect;

export const insertShiftSchema = createInsertSchema(shiftsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertShift = z.infer<typeof insertShiftSchema>;
export type Shift = typeof shiftsTable.$inferSelect;

export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendanceTable.$inferSelect;

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;

export const leavePoliciesTable = pgTable("leave_policies", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  leaveType: text("leave_type").notNull(),
  label: text("label").notNull(),
  isPaid: boolean("is_paid").notNull().default(false),
  entitlementDays: integer("entitlement_days").notNull().default(0),
  carryForwardMax: integer("carry_forward_max").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique().on(t.restaurantId, t.leaveType)]);

export const leaveBalancesTable = pgTable("leave_balances", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  year: integer("year").notNull(),
  leaveType: text("leave_type").notNull(),
  opening: decimal("opening", { precision: 6, scale: 2 }).notNull().default("0"),
  used: decimal("used", { precision: 6, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique().on(t.restaurantId, t.userId, t.year, t.leaveType)]);

export const leaveRequestsTable = pgTable("leave_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  leaveType: text("leave_type").notNull(),
  fromDate: timestamp("from_date").notNull(),
  toDate: timestamp("to_date").notNull(),
  halfDay: boolean("half_day").notNull().default(false),
  totalDays: decimal("total_days", { precision: 6, scale: 2 }).notNull().default("0"),
  reason: text("reason"),
  status: text("status").notNull().default("pending"),
  decidedByUserId: integer("decided_by_user_id").references(() => usersTable.id),
  decidedAt: timestamp("decided_at"),
  decisionNote: text("decision_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertLeavePolicySchema = createInsertSchema(leavePoliciesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLeavePolicy = z.infer<typeof insertLeavePolicySchema>;
export type LeavePolicy = typeof leavePoliciesTable.$inferSelect;

export const insertLeaveBalanceSchema = createInsertSchema(leaveBalancesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLeaveBalance = z.infer<typeof insertLeaveBalanceSchema>;
export type LeaveBalance = typeof leaveBalancesTable.$inferSelect;

export const insertLeaveRequestSchema = createInsertSchema(leaveRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLeaveRequest = z.infer<typeof insertLeaveRequestSchema>;
export type LeaveRequest = typeof leaveRequestsTable.$inferSelect;

export const salaryStructuresTable = pgTable("salary_structures", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  type: text("type").notNull().default("fixed_monthly"),
  baseAmount: decimal("base_amount", { precision: 12, scale: 2 }),
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }),
  dailyRate: decimal("daily_rate", { precision: 10, scale: 2 }),
  commissionRate: decimal("commission_rate", { precision: 6, scale: 3 }),
  commissionBase: text("commission_base"),
  currency: text("currency").notNull().default("INR"),
  effectiveFrom: timestamp("effective_from"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique().on(t.restaurantId, t.userId)]);

export const salaryComponentsTable = pgTable("salary_components", {
  id: serial("id").primaryKey(),
  structureId: integer("structure_id").notNull().references(() => salaryStructuresTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  name: text("name").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  isRecurring: boolean("is_recurring").notNull().default(true),
  isTaxable: boolean("is_taxable").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const staffAdvancesTable = pgTable("staff_advances", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  paidOn: timestamp("paid_on").notNull(),
  notes: text("notes"),
  recordedByUserId: integer("recorded_by_user_id").references(() => usersTable.id),
  settledAmount: decimal("settled_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const staffAdjustmentsTable = pgTable("staff_adjustments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  kind: text("kind").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  label: text("label").notNull(),
  appliesToMonth: text("applies_to_month"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recordedByUserId: integer("recorded_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const performanceNotesTable = pgTable("performance_notes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  authorUserId: integer("author_user_id").references(() => usersTable.id),
  rating: integer("rating"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSalaryStructureSchema = createInsertSchema(salaryStructuresTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSalaryStructure = z.infer<typeof insertSalaryStructureSchema>;
export type SalaryStructure = typeof salaryStructuresTable.$inferSelect;

export const insertSalaryComponentSchema = createInsertSchema(salaryComponentsTable).omit({ id: true, createdAt: true });
export type InsertSalaryComponent = z.infer<typeof insertSalaryComponentSchema>;
export type SalaryComponent = typeof salaryComponentsTable.$inferSelect;

export const insertStaffAdvanceSchema = createInsertSchema(staffAdvancesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStaffAdvance = z.infer<typeof insertStaffAdvanceSchema>;
export type StaffAdvance = typeof staffAdvancesTable.$inferSelect;

export const insertStaffAdjustmentSchema = createInsertSchema(staffAdjustmentsTable).omit({ id: true, createdAt: true });
export type InsertStaffAdjustment = z.infer<typeof insertStaffAdjustmentSchema>;
export type StaffAdjustment = typeof staffAdjustmentsTable.$inferSelect;

export const insertPerformanceNoteSchema = createInsertSchema(performanceNotesTable).omit({ id: true, createdAt: true });
export type InsertPerformanceNote = z.infer<typeof insertPerformanceNoteSchema>;
export type PerformanceNote = typeof performanceNotesTable.$inferSelect;

/**
 * A payroll run is a single owner-initiated computation of pay for a given
 * outlet for one calendar month. It is created in `draft` status (numbers
 * may be tweaked), then `finalized` (locks numbers, allocates advance
 * settlements, mints slips).
 */
export const payrollRunsTable = pgTable("payroll_runs", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  periodYear: integer("period_year").notNull(),
  periodMonth: integer("period_month").notNull(), // 1-12
  status: text("status").notNull().default("draft"), // draft | finalized
  totalGross: decimal("total_gross", { precision: 14, scale: 2 }).notNull().default("0"),
  totalDeductions: decimal("total_deductions", { precision: 14, scale: 2 }).notNull().default("0"),
  totalNet: decimal("total_net", { precision: 14, scale: 2 }).notNull().default("0"),
  totalAdvancesSettled: decimal("total_advances_settled", { precision: 14, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
  finalizedByUserId: integer("finalized_by_user_id").references(() => usersTable.id),
  finalizedAt: timestamp("finalized_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique().on(t.restaurantId, t.periodYear, t.periodMonth)]);

/**
 * A payroll item is one staff member's computed pay slip within a run. The
 * salary structure is snapshotted into `structureSnapshot` JSON so that
 * future edits to the structure don't change historical slips.
 */
export const payrollItemsTable = pgTable("payroll_items", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => payrollRunsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  structureSnapshot: text("structure_snapshot"), // JSON of salary structure + components used
  earningsBreakdown: text("earnings_breakdown"), // JSON: [{label, amount}]
  deductionsBreakdown: text("deductions_breakdown"), // JSON: [{label, amount}]
  baseAmount: decimal("base_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  overtimeMinutes: integer("overtime_minutes").notNull().default(0),
  overtimeAmount: decimal("overtime_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  attendanceDeduction: decimal("attendance_deduction", { precision: 12, scale: 2 }).notNull().default("0"),
  lateDeduction: decimal("late_deduction", { precision: 12, scale: 2 }).notNull().default("0"),
  leaveDeduction: decimal("leave_deduction", { precision: 12, scale: 2 }).notNull().default("0"),
  bonus: decimal("bonus", { precision: 12, scale: 2 }).notNull().default("0"),
  otherDeductions: decimal("other_deductions", { precision: 12, scale: 2 }).notNull().default("0"),
  grossPay: decimal("gross_pay", { precision: 12, scale: 2 }).notNull().default("0"),
  advanceSettled: decimal("advance_settled", { precision: 12, scale: 2 }).notNull().default("0"),
  netPay: decimal("net_pay", { precision: 12, scale: 2 }).notNull().default("0"),
  paymentStatus: text("payment_status").notNull().default("pending"), // pending | partially_paid | paid
  paidAmount: decimal("paid_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  overridden: boolean("overridden").notNull().default(false),
  daysWorked: decimal("days_worked", { precision: 5, scale: 2 }).notNull().default("0"),
  daysAbsent: decimal("days_absent", { precision: 5, scale: 2 }).notNull().default("0"),
  daysPaidLeave: decimal("days_paid_leave", { precision: 5, scale: 2 }).notNull().default("0"),
  daysUnpaidLeave: decimal("days_unpaid_leave", { precision: 5, scale: 2 }).notNull().default("0"),
  workedMinutes: integer("worked_minutes").notNull().default(0),
  lateMinutes: integer("late_minutes").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique().on(t.runId, t.userId)]);

/**
 * Each payment recorded against a payroll item. A single item may be paid in
 * multiple installments (cash partial + UPI later, etc.).
 */
export const payrollPaymentsTable = pgTable("payroll_payments", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => payrollItemsTable.id, { onDelete: "cascade" }),
  runId: integer("run_id").notNull().references(() => payrollRunsTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  paidOn: timestamp("paid_on").notNull(),
  mode: text("mode").notNull().default("cash"), // cash | upi | bank_transfer | other
  reference: text("reference"),
  notes: text("notes"),
  recordedByUserId: integer("recorded_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPayrollRunSchema = createInsertSchema(payrollRunsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayrollRun = z.infer<typeof insertPayrollRunSchema>;
export type PayrollRun = typeof payrollRunsTable.$inferSelect;

export const insertPayrollItemSchema = createInsertSchema(payrollItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayrollItem = z.infer<typeof insertPayrollItemSchema>;
export type PayrollItem = typeof payrollItemsTable.$inferSelect;

export const insertPayrollPaymentSchema = createInsertSchema(payrollPaymentsTable).omit({ id: true, createdAt: true });
export type InsertPayrollPayment = z.infer<typeof insertPayrollPaymentSchema>;
export type PayrollPayment = typeof payrollPaymentsTable.$inferSelect;

// ===================== Staff Incentives (Task #199) =====================
// Owner-configured incentive rules per restaurant. Six rule types (one row
// each per restaurant): upsell_commission, review_bonus, attendance_bonus,
// sales_target, table_turnover, low_complaint_bonus. `params` is rule-shape
// specific (e.g. {ratePct:1.5, minOrderAmount:200} for upsell_commission).
export const staffIncentiveRulesTable = pgTable("staff_incentive_rules", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  ruleType: text("rule_type").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
  monthlyCap: decimal("monthly_cap", { precision: 12, scale: 2 }),
  updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique("staff_incentive_rules_rest_type_uq").on(t.restaurantId, t.ruleType)]);

// One computed incentive per (staff, period, rule_type). Status drives the
// approval workflow; only `approved` rows feed payroll runs.
export const staffIncentivesTable = pgTable("staff_incentives", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  periodYear: integer("period_year").notNull(),
  periodMonth: integer("period_month").notNull(),
  ruleType: text("rule_type").notNull(),
  computedAmount: decimal("computed_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  approvedAmount: decimal("approved_amount", { precision: 12, scale: 2 }),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  breakdown: jsonb("breakdown").$type<Record<string, unknown>>().notNull().default({}),
  approverUserId: integer("approver_user_id").references(() => usersTable.id),
  decidedAt: timestamp("decided_at"),
  notes: text("notes"),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("staff_incentives_uq").on(t.restaurantId, t.userId, t.periodYear, t.periodMonth, t.ruleType),
  index("staff_incentives_period_idx").on(t.restaurantId, t.periodYear, t.periodMonth, t.status),
]);

export const insertStaffIncentiveRuleSchema = createInsertSchema(staffIncentiveRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStaffIncentiveRule = z.infer<typeof insertStaffIncentiveRuleSchema>;
export type StaffIncentiveRule = typeof staffIncentiveRulesTable.$inferSelect;

export const insertStaffIncentiveSchema = createInsertSchema(staffIncentivesTable).omit({ id: true, computedAt: true, updatedAt: true });
export type InsertStaffIncentive = z.infer<typeof insertStaffIncentiveSchema>;
export type StaffIncentive = typeof staffIncentivesTable.$inferSelect;

export const STAFF_INCENTIVE_RULE_TYPES = [
  "upsell_commission",
  "review_bonus",
  "attendance_bonus",
  "sales_target",
  "table_turnover",
  "low_complaint_bonus",
] as const;
export type StaffIncentiveRuleType = (typeof STAFF_INCENTIVE_RULE_TYPES)[number];

// ─────────────────────────────────────────────────────────────────────────
// Task #424 — Advanced staff scheduling & labor forecasting
// ─────────────────────────────────────────────────────────────────────────

// Per-staff weekly availability submission. `dayOfWeek` is 0=Sun..6=Sat,
// `startTime`/`endTime` are HH:MM strings, `isAvailable` lets staff mark
// hard-unavailable slots (e.g. classes). One row per (user, day, slot).
export const staffAvailabilityTable = pgTable("staff_availability", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  isAvailable: boolean("is_available").notNull().default(true),
  note: text("note"),
  effectiveFrom: timestamp("effective_from"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("staff_avail_rest_user_idx").on(t.restaurantId, t.userId),
]);

// Shift-trade request: staff A asks to trade/giveaway a specific staffShift
// to staff B. Status flow: pending → accepted_peer → approved | rejected | cancelled.
export const shiftTradeRequestsTable = pgTable("shift_trade_requests", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  fromUserId: integer("from_user_id").notNull().references(() => usersTable.id),
  toUserId: integer("to_user_id").references(() => usersTable.id),
  staffShiftId: integer("staff_shift_id").notNull().references(() => staffShiftsTable.id, { onDelete: "cascade" }),
  tradeType: text("trade_type").notNull().default("giveaway"), // giveaway | swap
  swapStaffShiftId: integer("swap_staff_shift_id").references(() => staffShiftsTable.id),
  reason: text("reason"),
  status: text("status").notNull().default("pending"), // pending | accepted_peer | approved | rejected | cancelled
  peerRespondedAt: timestamp("peer_responded_at"),
  decidedByUserId: integer("decided_by_user_id").references(() => usersTable.id),
  decidedAt: timestamp("decided_at"),
  decisionNote: text("decision_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("shift_trade_rest_status_idx").on(t.restaurantId, t.status),
]);

// Records when a week (or arbitrary date-range) was published. Stores
// snapshot of assignment count & notification channels used.
export const schedulePublicationsTable = pgTable("schedule_publications", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  weekStart: timestamp("week_start").notNull(),
  weekEnd: timestamp("week_end").notNull(),
  publishedByUserId: integer("published_by_user_id").references(() => usersTable.id),
  assignmentCount: integer("assignment_count").notNull().default(0),
  channels: jsonb("channels").$type<{ push: boolean; sms: boolean; whatsapp: boolean }>().notNull().default({ push: true, sms: false, whatsapp: false }),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("sched_pub_rest_week_idx").on(t.restaurantId, t.weekStart),
]);

// Per-restaurant labor settings: target labor%, default hourly cost when
// a staff record has no salary, and break/overtime rule configuration.
export const laborSettingsTable = pgTable("labor_settings", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  targetLaborPct: decimal("target_labor_pct", { precision: 5, scale: 2 }).notNull().default("25.00"),
  defaultHourlyCost: decimal("default_hourly_cost", { precision: 10, scale: 2 }).notNull().default("0"),
  // Forecast: average revenue (in local currency) handled per labor-hour.
  // Used to convert forecast sales → suggested headcount per hour.
  salesPerLaborHour: decimal("sales_per_labor_hour", { precision: 12, scale: 2 }).notNull().default("1000"),
  breakMinutesPerShift: integer("break_minutes_per_shift").notNull().default(30),
  breakAfterMinutes: integer("break_after_minutes").notNull().default(300),
  overtimeAfterMinutesPerDay: integer("overtime_after_minutes_per_day").notNull().default(540),
  overtimeAfterMinutesPerWeek: integer("overtime_after_minutes_per_week").notNull().default(2700),
  // List of {role, minHeadcount} per hour-of-day, optional override.
  minHeadcountByRole: jsonb("min_headcount_by_role").$type<Record<string, number>>().notNull().default({}),
  updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [unique("labor_settings_rest_uq").on(t.restaurantId)]);

export const insertStaffAvailabilitySchema = createInsertSchema(staffAvailabilityTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStaffAvailability = z.infer<typeof insertStaffAvailabilitySchema>;
export type StaffAvailability = typeof staffAvailabilityTable.$inferSelect;

export const insertShiftTradeRequestSchema = createInsertSchema(shiftTradeRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertShiftTradeRequest = z.infer<typeof insertShiftTradeRequestSchema>;
export type ShiftTradeRequest = typeof shiftTradeRequestsTable.$inferSelect;

export const insertSchedulePublicationSchema = createInsertSchema(schedulePublicationsTable).omit({ id: true, createdAt: true });
export type InsertSchedulePublication = z.infer<typeof insertSchedulePublicationSchema>;
export type SchedulePublication = typeof schedulePublicationsTable.$inferSelect;

export const insertLaborSettingsSchema = createInsertSchema(laborSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLaborSettings = z.infer<typeof insertLaborSettingsSchema>;
export type LaborSettings = typeof laborSettingsTable.$inferSelect;
