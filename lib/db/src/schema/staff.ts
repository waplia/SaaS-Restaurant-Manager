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
}, (t) => [unique().on(t.userId, t.year, t.leaveType)]);

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
