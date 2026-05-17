import { pgTable, text, serial, timestamp, integer, boolean, decimal, jsonb, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { restaurantsTable, branchesTable } from "./restaurants";
import { usersTable } from "./users";
import { staffTable } from "./staff";

/**
 * Per-employee compliance/HR documents (separate from the
 * business-license `complianceDocumentsTable`). Tracks file, expiry, and
 * reminder cadence per employee.
 */
export const staffComplianceDocsTable = pgTable(
  "staff_compliance_docs",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "cascade" }),
    docType: text("doc_type").notNull(),
    label: text("label").notNull(),
    documentNumber: text("document_number"),
    fileUrl: text("file_url"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    issueDate: timestamp("issue_date"),
    expiryDate: timestamp("expiry_date"),
    reminderDays: integer("reminder_days").notNull().default(30),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    uploadedByUserId: integer("uploaded_by_user_id").references(() => usersTable.id),
    reminderDismissedUntil: timestamp("reminder_dismissed_until"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("staff_compliance_docs_rest_expiry_idx").on(t.restaurantId, t.expiryDate),
    index("staff_compliance_docs_staff_idx").on(t.staffId),
  ],
);

/**
 * Per-employee benefits enrolment (health, dental, retirement, etc).
 * Used as a registry only — actual broker integrations are out of scope.
 */
export const employeeBenefitsTable = pgTable(
  "employee_benefits",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "cascade" }),
    benefitType: text("benefit_type").notNull(),
    planName: text("plan_name"),
    provider: text("provider"),
    policyNumber: text("policy_number"),
    monthlyCost: decimal("monthly_cost", { precision: 12, scale: 2 }).notNull().default("0"),
    employerContribution: decimal("employer_contribution", { precision: 12, scale: 2 }).notNull().default("0"),
    employeeContribution: decimal("employee_contribution", { precision: 12, scale: 2 }).notNull().default("0"),
    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("employee_benefits_staff_idx").on(t.staffId),
  ],
);

/**
 * HR policy configuration. One row per (restaurantId, branchId) — when
 * branchId is null the policy applies to the whole restaurant. Stores
 * overtime/break/leave rules used to surface breaches on schedules/payroll.
 */
export const hrPoliciesTable = pgTable(
  "hr_policies",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull().references(() => restaurantsTable.id),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "cascade" }),
    country: text("country").notNull().default("IN"),
    region: text("region"),
    /** Hours after which overtime kicks in for a single workday. */
    dailyOvertimeHours: decimal("daily_overtime_hours", { precision: 4, scale: 2 }).notNull().default("8"),
    /** Hours after which overtime kicks in for a workweek. */
    weeklyOvertimeHours: decimal("weekly_overtime_hours", { precision: 5, scale: 2 }).notNull().default("48"),
    /** Maximum continuous shift in hours — anything above is flagged. */
    maxShiftHours: decimal("max_shift_hours", { precision: 4, scale: 2 }).notNull().default("12"),
    /** Required unpaid break minutes per shift over `breakAfterHours`. */
    breakMinutes: integer("break_minutes").notNull().default(30),
    breakAfterHours: decimal("break_after_hours", { precision: 4, scale: 2 }).notNull().default("5"),
    /** Minimum hourly wage (in restaurant currency). 0 = no floor. */
    minHourlyWage: decimal("min_hourly_wage", { precision: 10, scale: 2 }).notNull().default("0"),
    /** Min rest hours between consecutive shifts. */
    minRestBetweenShiftsHours: decimal("min_rest_between_shifts_hours", { precision: 4, scale: 2 }).notNull().default("10"),
    /** Annual leave entitlement target (days). */
    annualLeaveDays: integer("annual_leave_days").notNull().default(12),
    /** Extra arbitrary policy fields (e.g. holiday list). */
    extra: jsonb("extra").$type<Record<string, unknown>>().notNull().default({}),
    updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("hr_policies_rest_branch_uq").on(t.restaurantId, t.branchId),
  ],
);

export const insertStaffComplianceDocSchema = createInsertSchema(staffComplianceDocsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStaffComplianceDoc = z.infer<typeof insertStaffComplianceDocSchema>;
export type StaffComplianceDoc = typeof staffComplianceDocsTable.$inferSelect;

export const insertEmployeeBenefitSchema = createInsertSchema(employeeBenefitsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmployeeBenefit = z.infer<typeof insertEmployeeBenefitSchema>;
export type EmployeeBenefit = typeof employeeBenefitsTable.$inferSelect;

export const insertHrPolicySchema = createInsertSchema(hrPoliciesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHrPolicy = z.infer<typeof insertHrPolicySchema>;
export type HrPolicy = typeof hrPoliciesTable.$inferSelect;

/** Canonical staff/HR document categories. */
export const HR_DOC_TYPES = [
  "id_proof",
  "address_proof",
  "work_permit",
  "visa",
  "food_handler_cert",
  "alcohol_service_cert",
  "drivers_license",
  "police_verification",
  "medical_fitness",
  "contract",
  "nda",
  "tax_form",
  "other",
] as const;
export type HrDocType = (typeof HR_DOC_TYPES)[number];

/** Canonical employee benefit categories. */
export const HR_BENEFIT_TYPES = [
  "health_insurance",
  "dental_insurance",
  "vision_insurance",
  "retirement_401k",
  "provident_fund",
  "esi",
  "life_insurance",
  "meal_allowance",
  "transport_allowance",
  "education_allowance",
  "other",
] as const;
export type HrBenefitType = (typeof HR_BENEFIT_TYPES)[number];

/**
 * Minimum hourly wage rules baked in. Values are in the local currency for
 * the country/region. Used as defaults when a restaurant hasn't overridden
 * `minHourlyWage` in their hr_policy.
 */
export const HR_MIN_WAGE_RULES: Array<{ country: string; region: string | null; currency: string; minHourly: number; label: string }> = [
  { country: "IN", region: null, currency: "INR", minHourly: 178, label: "India — federal floor" },
  { country: "IN", region: "MH", currency: "INR", minHourly: 423, label: "Maharashtra (skilled)" },
  { country: "IN", region: "KA", currency: "INR", minHourly: 410, label: "Karnataka (Bengaluru zone)" },
  { country: "IN", region: "DL", currency: "INR", minHourly: 520, label: "Delhi (skilled)" },
  { country: "US", region: null, currency: "USD", minHourly: 7.25, label: "US — federal" },
  { country: "US", region: "CA", currency: "USD", minHourly: 16.0, label: "California" },
  { country: "US", region: "NY", currency: "USD", minHourly: 16.0, label: "New York" },
  { country: "US", region: "TX", currency: "USD", minHourly: 7.25, label: "Texas" },
  { country: "US", region: "WA", currency: "USD", minHourly: 16.28, label: "Washington" },
  { country: "GB", region: null, currency: "GBP", minHourly: 11.44, label: "UK — National Living Wage (21+)" },
  { country: "AE", region: null, currency: "AED", minHourly: 0, label: "UAE — no statutory minimum" },
  { country: "EU", region: "DE", currency: "EUR", minHourly: 12.41, label: "Germany" },
  { country: "EU", region: "FR", currency: "EUR", minHourly: 11.65, label: "France" },
];
