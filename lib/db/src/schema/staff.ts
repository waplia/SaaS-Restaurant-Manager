import { pgTable, text, serial, timestamp, integer, boolean, decimal, unique } from "drizzle-orm/pg-core";
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
  userId: integer("user_id").references(() => usersTable.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: integer("entity_id"),
  details: text("details"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
