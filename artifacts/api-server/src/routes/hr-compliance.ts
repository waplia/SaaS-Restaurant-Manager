import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, gte, lte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  staffComplianceDocsTable,
  employeeBenefitsTable,
  hrPoliciesTable,
  staffTable,
  usersTable,
  branchesTable,
  restaurantsTable,
  payrollItemsTable,
  payrollRunsTable,
  attendanceTable,
  leaveRequestsTable,
  auditLogsTable,
  HR_DOC_TYPES,
  HR_BENEFIT_TYPES,
  HR_MIN_WAGE_RULES,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { requirePlanFeature } from "../middleware/planFeature";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { recordAuditLog } from "../lib/audit";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getObjectAclPolicy } from "../lib/objectAcl";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

// Gate all HR-compliance routes: HR Officer + Owner/Manager + super admin,
// scope to restaurant, and require the plan feature.
router.use(
  "/restaurants/:restaurantId/hr-compliance",
  requireRole("owner", "manager", "hr_officer", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("hr_compliance"),
);

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function assertFileUrlOwnership(restaurantId: number, fileUrl: unknown): Promise<void> {
  if (fileUrl == null || fileUrl === "") return;
  if (typeof fileUrl !== "string" || !fileUrl.startsWith("/objects/")) {
    throw new Error("invalid_file_url");
  }
  try {
    const file = await objectStorage.getObjectEntityFile(fileUrl);
    const acl = await getObjectAclPolicy(file);
    if (!acl || acl.restaurantId !== String(restaurantId)) throw new Error("invalid_file_url");
  } catch (err) {
    if (err instanceof ObjectNotFoundError) throw new Error("invalid_file_url");
    throw err;
  }
}

// ─────────────────────────── Documents ───────────────────────────

const docBody = z.object({
  staffId: z.number().int().positive(),
  docType: z.enum(HR_DOC_TYPES),
  label: z.string().min(1).max(200),
  documentNumber: z.string().max(120).optional().nullable(),
  fileUrl: z.string().optional().nullable(),
  mimeType: z.string().max(128).optional().nullable(),
  sizeBytes: z.number().int().nonnegative().optional().nullable(),
  issueDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  reminderDays: z.number().int().min(0).max(365).optional(),
  status: z.string().max(32).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

router.get("/restaurants/:restaurantId/hr-compliance/documents", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const staffId = req.query.staffId ? Number(req.query.staffId) : null;
  const conds = [eq(staffComplianceDocsTable.restaurantId, restaurantId)];
  if (staffId && Number.isFinite(staffId)) conds.push(eq(staffComplianceDocsTable.staffId, staffId));
  const rows = await db.select().from(staffComplianceDocsTable)
    .where(and(...conds))
    .orderBy(asc(staffComplianceDocsTable.expiryDate));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/hr-compliance/documents", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = docBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
  const [staff] = await db.select({ id: staffTable.id }).from(staffTable)
    .where(and(eq(staffTable.id, parsed.data.staffId), eq(staffTable.restaurantId, restaurantId)));
  if (!staff) return void res.status(400).json({ error: "Unknown staff" });
  try { await assertFileUrlOwnership(restaurantId, parsed.data.fileUrl); }
  catch { return void res.status(400).json({ error: "invalid_file_url" }); }

  const [row] = await db.insert(staffComplianceDocsTable).values({
    restaurantId,
    staffId: parsed.data.staffId,
    docType: parsed.data.docType,
    label: parsed.data.label,
    documentNumber: parsed.data.documentNumber ?? null,
    fileUrl: parsed.data.fileUrl ?? null,
    mimeType: parsed.data.mimeType ?? null,
    sizeBytes: parsed.data.sizeBytes ?? null,
    issueDate: toDate(parsed.data.issueDate ?? null),
    expiryDate: toDate(parsed.data.expiryDate ?? null),
    reminderDays: parsed.data.reminderDays ?? 30,
    status: parsed.data.status ?? "active",
    notes: parsed.data.notes ?? null,
    uploadedByUserId: req.user?.sub ?? null,
  }).returning();
  await recordAuditLog({
    req, module: "hr_compliance", action: "document.create", entity: "staff_compliance_doc",
    entityId: row?.id, restaurantId, newValue: row,
  });
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/hr-compliance/documents/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const parsed = docBody.partial().safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
  const [existing] = await db.select().from(staffComplianceDocsTable)
    .where(and(eq(staffComplianceDocsTable.id, id), eq(staffComplianceDocsTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  if (parsed.data.fileUrl !== undefined) {
    try { await assertFileUrlOwnership(restaurantId, parsed.data.fileUrl); }
    catch { return void res.status(400).json({ error: "invalid_file_url" }); }
  }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.docType !== undefined) updates.docType = parsed.data.docType;
  if (parsed.data.label !== undefined) updates.label = parsed.data.label;
  if (parsed.data.documentNumber !== undefined) updates.documentNumber = parsed.data.documentNumber;
  if (parsed.data.fileUrl !== undefined) updates.fileUrl = parsed.data.fileUrl;
  if (parsed.data.mimeType !== undefined) updates.mimeType = parsed.data.mimeType;
  if (parsed.data.sizeBytes !== undefined) updates.sizeBytes = parsed.data.sizeBytes;
  if (parsed.data.issueDate !== undefined) updates.issueDate = toDate(parsed.data.issueDate);
  if (parsed.data.expiryDate !== undefined) {
    updates.expiryDate = toDate(parsed.data.expiryDate);
    updates.reminderDismissedUntil = null;
  }
  if (parsed.data.reminderDays !== undefined) updates.reminderDays = parsed.data.reminderDays;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
  const [updated] = await db.update(staffComplianceDocsTable).set(updates)
    .where(and(eq(staffComplianceDocsTable.id, id), eq(staffComplianceDocsTable.restaurantId, restaurantId)))
    .returning();
  await recordAuditLog({
    req, module: "hr_compliance", action: "document.update", entity: "staff_compliance_doc",
    entityId: id, restaurantId, oldValue: existing, newValue: updated,
  });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/hr-compliance/documents/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [existing] = await db.select().from(staffComplianceDocsTable)
    .where(and(eq(staffComplianceDocsTable.id, id), eq(staffComplianceDocsTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  await db.delete(staffComplianceDocsTable)
    .where(and(eq(staffComplianceDocsTable.id, id), eq(staffComplianceDocsTable.restaurantId, restaurantId)));
  await recordAuditLog({
    req, module: "hr_compliance", action: "document.delete", entity: "staff_compliance_doc",
    entityId: id, restaurantId, oldValue: existing,
  });
  res.status(204).send();
});

router.post("/restaurants/:restaurantId/hr-compliance/documents/:id/dismiss", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const days = Math.max(1, Math.min(365, Number(req.body?.days) || 7));
  const until = new Date(Date.now() + days * 86_400_000);
  await db.update(staffComplianceDocsTable)
    .set({ reminderDismissedUntil: until, updatedAt: new Date() })
    .where(and(eq(staffComplianceDocsTable.id, id), eq(staffComplianceDocsTable.restaurantId, restaurantId)));
  await recordAuditLog({
    req, module: "hr_compliance", action: "document.dismiss_reminder",
    entity: "staff_compliance_doc", entityId: id, restaurantId, newValue: { until: until.toISOString() },
  });
  res.json({ ok: true, reminderDismissedUntil: until.toISOString() });
});

// ─────────────────────────── Benefits ───────────────────────────

const benefitBody = z.object({
  staffId: z.number().int().positive(),
  benefitType: z.enum(HR_BENEFIT_TYPES),
  planName: z.string().max(200).optional().nullable(),
  provider: z.string().max(200).optional().nullable(),
  policyNumber: z.string().max(120).optional().nullable(),
  monthlyCost: z.union([z.string(), z.number()]).optional(),
  employerContribution: z.union([z.string(), z.number()]).optional(),
  employeeContribution: z.union([z.string(), z.number()]).optional(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  status: z.string().max(32).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

router.get("/restaurants/:restaurantId/hr-compliance/benefits", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const staffId = req.query.staffId ? Number(req.query.staffId) : null;
  const conds = [eq(employeeBenefitsTable.restaurantId, restaurantId)];
  if (staffId && Number.isFinite(staffId)) conds.push(eq(employeeBenefitsTable.staffId, staffId));
  const rows = await db.select().from(employeeBenefitsTable)
    .where(and(...conds))
    .orderBy(desc(employeeBenefitsTable.updatedAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/hr-compliance/benefits", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = benefitBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
  const [staff] = await db.select({ id: staffTable.id }).from(staffTable)
    .where(and(eq(staffTable.id, parsed.data.staffId), eq(staffTable.restaurantId, restaurantId)));
  if (!staff) return void res.status(400).json({ error: "Unknown staff" });
  const [row] = await db.insert(employeeBenefitsTable).values({
    restaurantId,
    staffId: parsed.data.staffId,
    benefitType: parsed.data.benefitType,
    planName: parsed.data.planName ?? null,
    provider: parsed.data.provider ?? null,
    policyNumber: parsed.data.policyNumber ?? null,
    monthlyCost: parsed.data.monthlyCost != null ? String(parsed.data.monthlyCost) : "0",
    employerContribution: parsed.data.employerContribution != null ? String(parsed.data.employerContribution) : "0",
    employeeContribution: parsed.data.employeeContribution != null ? String(parsed.data.employeeContribution) : "0",
    startDate: toDate(parsed.data.startDate ?? null),
    endDate: toDate(parsed.data.endDate ?? null),
    status: parsed.data.status ?? "active",
    notes: parsed.data.notes ?? null,
  }).returning();
  await recordAuditLog({
    req, module: "hr_compliance", action: "benefit.create", entity: "employee_benefit",
    entityId: row?.id, restaurantId, newValue: row,
  });
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/hr-compliance/benefits/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const parsed = benefitBody.partial().safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
  const [existing] = await db.select().from(employeeBenefitsTable)
    .where(and(eq(employeeBenefitsTable.id, id), eq(employeeBenefitsTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.benefitType !== undefined) updates.benefitType = parsed.data.benefitType;
  if (parsed.data.planName !== undefined) updates.planName = parsed.data.planName;
  if (parsed.data.provider !== undefined) updates.provider = parsed.data.provider;
  if (parsed.data.policyNumber !== undefined) updates.policyNumber = parsed.data.policyNumber;
  if (parsed.data.monthlyCost !== undefined) updates.monthlyCost = String(parsed.data.monthlyCost);
  if (parsed.data.employerContribution !== undefined) updates.employerContribution = String(parsed.data.employerContribution);
  if (parsed.data.employeeContribution !== undefined) updates.employeeContribution = String(parsed.data.employeeContribution);
  if (parsed.data.startDate !== undefined) updates.startDate = toDate(parsed.data.startDate);
  if (parsed.data.endDate !== undefined) updates.endDate = toDate(parsed.data.endDate);
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
  const [updated] = await db.update(employeeBenefitsTable).set(updates)
    .where(and(eq(employeeBenefitsTable.id, id), eq(employeeBenefitsTable.restaurantId, restaurantId)))
    .returning();
  await recordAuditLog({
    req, module: "hr_compliance", action: "benefit.update", entity: "employee_benefit",
    entityId: id, restaurantId, oldValue: existing, newValue: updated,
  });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/hr-compliance/benefits/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [existing] = await db.select().from(employeeBenefitsTable)
    .where(and(eq(employeeBenefitsTable.id, id), eq(employeeBenefitsTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  await db.delete(employeeBenefitsTable)
    .where(and(eq(employeeBenefitsTable.id, id), eq(employeeBenefitsTable.restaurantId, restaurantId)));
  await recordAuditLog({
    req, module: "hr_compliance", action: "benefit.delete", entity: "employee_benefit",
    entityId: id, restaurantId, oldValue: existing,
  });
  res.status(204).send();
});

// ─────────────────────────── Policies ───────────────────────────

const policyBody = z.object({
  branchId: z.number().int().positive().nullable().optional(),
  country: z.string().min(2).max(8).optional(),
  region: z.string().max(8).nullable().optional(),
  dailyOvertimeHours: z.union([z.string(), z.number()]).optional(),
  weeklyOvertimeHours: z.union([z.string(), z.number()]).optional(),
  maxShiftHours: z.union([z.string(), z.number()]).optional(),
  breakMinutes: z.number().int().min(0).max(240).optional(),
  breakAfterHours: z.union([z.string(), z.number()]).optional(),
  minHourlyWage: z.union([z.string(), z.number()]).optional(),
  minRestBetweenShiftsHours: z.union([z.string(), z.number()]).optional(),
  annualLeaveDays: z.number().int().min(0).max(365).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

router.get("/restaurants/:restaurantId/hr-compliance/policies", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(hrPoliciesTable)
    .where(eq(hrPoliciesTable.restaurantId, restaurantId))
    .orderBy(asc(hrPoliciesTable.branchId));
  res.json(rows);
});

router.put("/restaurants/:restaurantId/hr-compliance/policies", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = policyBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
  const branchId = parsed.data.branchId ?? null;
  if (branchId != null) {
    const [b] = await db.select({ id: branchesTable.id }).from(branchesTable)
      .where(and(eq(branchesTable.id, branchId), eq(branchesTable.restaurantId, restaurantId)));
    if (!b) return void res.status(400).json({ error: "Invalid branchId" });
  }

  const values: Record<string, unknown> = {
    restaurantId,
    branchId,
    updatedByUserId: req.user?.sub ?? null,
    updatedAt: new Date(),
  };
  if (parsed.data.country !== undefined) values.country = parsed.data.country;
  if (parsed.data.region !== undefined) values.region = parsed.data.region;
  if (parsed.data.dailyOvertimeHours !== undefined) values.dailyOvertimeHours = String(parsed.data.dailyOvertimeHours);
  if (parsed.data.weeklyOvertimeHours !== undefined) values.weeklyOvertimeHours = String(parsed.data.weeklyOvertimeHours);
  if (parsed.data.maxShiftHours !== undefined) values.maxShiftHours = String(parsed.data.maxShiftHours);
  if (parsed.data.breakMinutes !== undefined) values.breakMinutes = parsed.data.breakMinutes;
  if (parsed.data.breakAfterHours !== undefined) values.breakAfterHours = String(parsed.data.breakAfterHours);
  if (parsed.data.minHourlyWage !== undefined) values.minHourlyWage = String(parsed.data.minHourlyWage);
  if (parsed.data.minRestBetweenShiftsHours !== undefined) values.minRestBetweenShiftsHours = String(parsed.data.minRestBetweenShiftsHours);
  if (parsed.data.annualLeaveDays !== undefined) values.annualLeaveDays = parsed.data.annualLeaveDays;
  if (parsed.data.extra !== undefined) values.extra = parsed.data.extra;

  // Branch-null uniqueness in Postgres treats nulls as distinct, so we
  // upsert manually using a guarded select.
  const branchCondition = branchId == null
    ? sql`${hrPoliciesTable.branchId} is null`
    : eq(hrPoliciesTable.branchId, branchId);
  const [existing] = await db.select().from(hrPoliciesTable)
    .where(and(eq(hrPoliciesTable.restaurantId, restaurantId), branchCondition));

  let row;
  if (existing) {
    [row] = await db.update(hrPoliciesTable).set(values)
      .where(eq(hrPoliciesTable.id, existing.id))
      .returning();
  } else {
    [row] = await db.insert(hrPoliciesTable).values(values as typeof hrPoliciesTable.$inferInsert).returning();
  }
  await recordAuditLog({
    req, module: "hr_compliance", action: existing ? "policy.update" : "policy.create",
    entity: "hr_policy", entityId: row?.id, restaurantId, oldValue: existing, newValue: row,
  });
  res.json(row);
});

// ─────────────────────────── Min-wage rules (static) ───────────────────────────

router.get("/restaurants/:restaurantId/hr-compliance/wage-rules", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [r] = await db.select({ country: restaurantsTable.country, currency: restaurantsTable.currency })
    .from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  const country = (req.query.country as string | undefined) ?? r?.country ?? "IN";
  const rules = HR_MIN_WAGE_RULES.filter(w => w.country === country || country === "*");
  res.json({ country, currency: r?.currency ?? "INR", rules });
});

// ────────────────────── Schedule / payroll breaches ──────────────────────

router.get("/restaurants/:restaurantId/hr-compliance/breaches", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const days = Math.max(1, Math.min(90, Number(req.query.days) || 30));
  const from = new Date(Date.now() - days * 86_400_000);
  const branchIdQ = req.query.branchId ? Number(req.query.branchId) : null;

  // Load all policies for this restaurant — both restaurant-default
  // (branchId null) and per-branch overrides. The branch policy, when
  // present and explicitly requested, overrides the restaurant default
  // for every rule it defines.
  const policies = await db.select().from(hrPoliciesTable)
    .where(eq(hrPoliciesTable.restaurantId, restaurantId));
  const globalPolicy = policies.find(p => p.branchId === null) ?? null;
  const branchPolicies = new Map<number, typeof policies[number]>();
  for (const p of policies) if (p.branchId !== null) branchPolicies.set(p.branchId, p);

  // When a specific outlet is requested, that outlet's policy (if any)
  // is the source of truth for all evaluations in this scan. Otherwise
  // fall back to the restaurant-default policy. Attendance/payroll/leave
  // tables do not yet carry a branch_id, so we cannot attribute records
  // to outlets in a single mixed-outlet scan — clients should call this
  // route once per branchId to compute per-outlet breaches accurately.
  const activePolicy = branchIdQ !== null && branchPolicies.has(branchIdQ)
    ? branchPolicies.get(branchIdQ)!
    : globalPolicy;
  const resolvePolicy = (_branchId: number | null) => activePolicy;

  const att = await db.select({
    id: attendanceTable.id,
    userId: attendanceTable.userId,
    date: attendanceTable.date,
    clockIn: attendanceTable.clockIn,
    clockOut: attendanceTable.clockOut,
    workedMinutes: attendanceTable.workedMinutes,
    overtimeMinutes: attendanceTable.overtimeMinutes,
    userName: usersTable.name,
  }).from(attendanceTable)
    .leftJoin(usersTable, eq(usersTable.id, attendanceTable.userId))
    .where(and(
      eq(attendanceTable.restaurantId, restaurantId),
      gte(attendanceTable.clockIn, from),
    ))
    .orderBy(asc(attendanceTable.userId), asc(attendanceTable.clockIn))
    .limit(5000);

  const breaches: Array<{
    kind: string;
    severity: "warning" | "violation";
    userId: number;
    userName: string | null;
    date: string | null;
    branchId: number | null;
    detail: string;
    attendanceId?: number;
  }> = [];

  // Attendance lacks a branch_id, so per-attendance resolution falls back to
  // the restaurant default policy. When a branch is selected via query, that
  // branch's policy is applied to every record in the scan.
  const recordBranchId = branchIdQ;

  // ── Per-shift checks: max shift, daily OT, break reminder ──
  for (const a of att) {
    const pol = resolvePolicy(recordBranchId);
    if (!pol) continue;
    const dailyOtMin = Number(pol.dailyOvertimeHours ?? 8) * 60;
    const maxShiftMin = Number(pol.maxShiftHours ?? 12) * 60;
    const breakAfterMin = Number(pol.breakAfterHours ?? 5) * 60;
    const requiredBreakMin = Number(pol.breakMinutes ?? 30);
    const worked = a.workedMinutes ?? 0;
    if (worked > maxShiftMin) {
      breaches.push({
        kind: "max_shift_exceeded", severity: "violation",
        userId: a.userId, userName: a.userName, branchId: pol.branchId ?? null,
        date: a.date?.toISOString() ?? null,
        detail: `Worked ${(worked / 60).toFixed(1)}h, max ${(maxShiftMin / 60).toFixed(1)}h`,
        attendanceId: a.id,
      });
    } else if (worked > dailyOtMin && (a.overtimeMinutes ?? 0) === 0) {
      breaches.push({
        kind: "unrecorded_overtime", severity: "warning",
        userId: a.userId, userName: a.userName, branchId: pol.branchId ?? null,
        date: a.date?.toISOString() ?? null,
        detail: `Worked ${(worked / 60).toFixed(1)}h with no overtime recorded`,
        attendanceId: a.id,
      });
    }
    if (worked >= breakAfterMin && requiredBreakMin > 0) {
      breaches.push({
        kind: "break_required", severity: "warning",
        userId: a.userId, userName: a.userName, branchId: pol.branchId ?? null,
        date: a.date?.toISOString() ?? null,
        detail: `Shift ≥ ${(breakAfterMin / 60).toFixed(1)}h: confirm ${requiredBreakMin}m break was taken`,
        attendanceId: a.id,
      });
    }
  }

  // ── Rest-between-shifts: consecutive attendance per user ──
  const byUser = new Map<number, typeof att>();
  for (const a of att) {
    if (!byUser.has(a.userId)) byUser.set(a.userId, []);
    byUser.get(a.userId)!.push(a);
  }
  for (const [, rows] of byUser) {
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      if (!prev.clockOut || !cur.clockIn) continue;
      const pol = resolvePolicy(recordBranchId);
      if (!pol) continue;
      const minRestMin = Number(pol.minRestBetweenShiftsHours ?? 10) * 60;
      const restMin = (cur.clockIn.getTime() - prev.clockOut.getTime()) / 60_000;
      if (restMin > 0 && restMin < minRestMin) {
        breaches.push({
          kind: "insufficient_rest", severity: "violation",
          userId: cur.userId, userName: cur.userName, branchId: pol.branchId ?? null,
          date: cur.date?.toISOString() ?? null,
          detail: `Only ${(restMin / 60).toFixed(1)}h rest between shifts (min ${(minRestMin / 60).toFixed(1)}h)`,
          attendanceId: cur.id,
        });
      }
    }
  }

  // ── Weekly OT: sum worked minutes per user per ISO week ──
  const weekKey = (d: Date) => {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const wk = Math.ceil((((t.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
  };
  const weekly = new Map<string, { userId: number; userName: string | null; minutes: number; week: string }>();
  for (const a of att) {
    if (!a.clockIn) continue;
    const wk = weekKey(a.clockIn);
    const key = `${a.userId}:${wk}`;
    const cur = weekly.get(key) ?? { userId: a.userId, userName: a.userName, minutes: 0, week: wk };
    cur.minutes += a.workedMinutes ?? 0;
    weekly.set(key, cur);
  }
  for (const w of weekly.values()) {
    const pol = resolvePolicy(recordBranchId);
    if (!pol) continue;
    const weeklyOtMin = Number(pol.weeklyOvertimeHours ?? 48) * 60;
    if (w.minutes > weeklyOtMin) {
      breaches.push({
        kind: "weekly_overtime_exceeded", severity: "violation",
        userId: w.userId, userName: w.userName, branchId: pol.branchId ?? null,
        date: w.week,
        detail: `Worked ${(w.minutes / 60).toFixed(1)}h in ${w.week} (weekly limit ${(weeklyOtMin / 60).toFixed(1)}h)`,
      });
    }
  }

  // ── Wage-floor breaches from the latest finalized payroll items ──
  const globalMinWage = Number(globalPolicy?.minHourlyWage ?? 0);
  const items = globalMinWage > 0 ? await db.select({
    id: payrollItemsTable.id,
    userId: payrollItemsTable.userId,
    workedMinutes: payrollItemsTable.workedMinutes,
    grossPay: payrollItemsTable.grossPay,
    userName: usersTable.name,
    periodYear: payrollRunsTable.periodYear,
    periodMonth: payrollRunsTable.periodMonth,
  }).from(payrollItemsTable)
    .leftJoin(payrollRunsTable, eq(payrollRunsTable.id, payrollItemsTable.runId))
    .leftJoin(usersTable, eq(usersTable.id, payrollItemsTable.userId))
    .where(eq(payrollItemsTable.restaurantId, restaurantId))
    .orderBy(desc(payrollRunsTable.periodYear), desc(payrollRunsTable.periodMonth))
    .limit(500) : [];
  for (const it of items) {
    const pol = resolvePolicy(recordBranchId);
    const minHourlyWage = Number(pol?.minHourlyWage ?? 0);
    if (minHourlyWage <= 0) continue;
    const hrs = (it.workedMinutes ?? 0) / 60;
    if (hrs < 1) continue;
    const hourly = Number(it.grossPay ?? 0) / hrs;
    if (hourly < minHourlyWage) {
      breaches.push({
        kind: "below_min_wage", severity: "violation",
        userId: it.userId, userName: it.userName, branchId: pol?.branchId ?? null,
        date: `${it.periodYear}-${String(it.periodMonth).padStart(2, "0")}`,
        detail: `Effective rate ${hourly.toFixed(2)} < min ${minHourlyWage.toFixed(2)}`,
      });
    }
  }

  // ── Leave breaches: annual leave taken vs entitlement ──
  const year = new Date().getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
  const approvedLeave = await db.select({
    userId: leaveRequestsTable.userId,
    totalDays: leaveRequestsTable.totalDays,
    leaveType: leaveRequestsTable.leaveType,
    userName: usersTable.name,
  }).from(leaveRequestsTable)
    .leftJoin(usersTable, eq(usersTable.id, leaveRequestsTable.userId))
    .where(and(
      eq(leaveRequestsTable.restaurantId, restaurantId),
      eq(leaveRequestsTable.status, "approved"),
      gte(leaveRequestsTable.fromDate, yearStart),
      lt(leaveRequestsTable.fromDate, yearEnd),
    ))
    .limit(2000);
  const leaveByUser = new Map<number, { userId: number; userName: string | null; days: number }>();
  for (const l of approvedLeave) {
    const cur = leaveByUser.get(l.userId) ?? { userId: l.userId, userName: l.userName, days: 0 };
    cur.days += Number(l.totalDays ?? 0);
    leaveByUser.set(l.userId, cur);
  }
  for (const u of leaveByUser.values()) {
    const pol = resolvePolicy(recordBranchId);
    if (!pol) continue;
    const allowed = Number(pol.annualLeaveDays ?? 0);
    if (allowed <= 0) continue;
    if (u.days > allowed) {
      breaches.push({
        kind: "annual_leave_exceeded", severity: "violation",
        userId: u.userId, userName: u.userName, branchId: pol.branchId ?? null,
        date: String(year),
        detail: `Took ${u.days.toFixed(1)} days of leave in ${year} (entitlement ${allowed} days)`,
      });
    } else if (u.days >= allowed * 0.9) {
      breaches.push({
        kind: "annual_leave_near_limit", severity: "warning",
        userId: u.userId, userName: u.userName, branchId: pol.branchId ?? null,
        date: String(year),
        detail: `Used ${u.days.toFixed(1)} of ${allowed} annual leave days`,
      });
    }
  }

  res.json({
    generatedAt: new Date().toISOString(),
    policy: globalPolicy ?? null,
    branchPolicies: Array.from(branchPolicies.values()),
    breaches,
  });
});

// ──────────────────── Tax form summaries (W-2 / 1099 ready) ────────────────────

router.get("/restaurants/:restaurantId/hr-compliance/tax-summary/:userId/:year", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const year = Number(req.params.year);
  if (!Number.isFinite(userId) || !Number.isFinite(year)) {
    return void res.status(400).json({ error: "Invalid userId or year" });
  }
  const formType = (req.query.form as string) === "1099" ? "1099-NEC" : "W-2";

  // Scope the user lookup to this restaurant's staff roster so a caller
  // can't pull PII for a user that doesn't belong to the tenant.
  const [staffRow] = await db.select({ id: staffTable.id })
    .from(staffTable)
    .where(and(eq(staffTable.userId, userId), eq(staffTable.restaurantId, restaurantId)));
  if (!staffRow) return void res.status(404).json({ error: "Employee not found in this restaurant" });

  const items = await db.select({
    grossPay: payrollItemsTable.grossPay,
    overtimeAmount: payrollItemsTable.overtimeAmount,
    bonus: payrollItemsTable.bonus,
    otherDeductions: payrollItemsTable.otherDeductions,
    netPay: payrollItemsTable.netPay,
    periodMonth: payrollRunsTable.periodMonth,
  }).from(payrollItemsTable)
    .innerJoin(payrollRunsTable, eq(payrollRunsTable.id, payrollItemsTable.runId))
    .where(and(
      eq(payrollItemsTable.restaurantId, restaurantId),
      eq(payrollItemsTable.userId, userId),
      eq(payrollRunsTable.periodYear, year),
    ));

  const [user] = await db.select({ name: usersTable.name, email: usersTable.email }).from(usersTable)
    .where(eq(usersTable.id, userId));
  const [restaurant] = await db.select({
    name: restaurantsTable.name, address: restaurantsTable.address,
    city: restaurantsTable.city, country: restaurantsTable.country,
  }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));

  const totals = items.reduce((acc, it) => {
    acc.gross += Number(it.grossPay ?? 0);
    acc.overtime += Number(it.overtimeAmount ?? 0);
    acc.bonus += Number(it.bonus ?? 0);
    acc.deductions += Number(it.otherDeductions ?? 0);
    acc.net += Number(it.netPay ?? 0);
    return acc;
  }, { gross: 0, overtime: 0, bonus: 0, deductions: 0, net: 0 });

  const monthly: Record<number, number> = {};
  for (let m = 1; m <= 12; m++) monthly[m] = 0;
  for (const it of items) monthly[it.periodMonth] += Number(it.grossPay ?? 0);

  await recordAuditLog({
    req, module: "hr_compliance", action: "tax_summary.view", entity: "user",
    entityId: userId, restaurantId, details: `${formType} ${year}`,
  });

  if (req.query.format === "csv") {
    const csv = [
      `${formType} Summary,${year}`,
      `Employer,${restaurant?.name ?? ""}`,
      `Employer Address,"${[restaurant?.address, restaurant?.city, restaurant?.country].filter(Boolean).join(", ")}"`,
      `Employee,${user?.name ?? ""}`,
      `Email,${user?.email ?? ""}`,
      ``,
      `Box,Label,Amount`,
      `1,Wages tips other compensation (gross),${totals.gross.toFixed(2)}`,
      `,Overtime included in gross,${totals.overtime.toFixed(2)}`,
      `,Bonuses included in gross,${totals.bonus.toFixed(2)}`,
      `,Other deductions,${totals.deductions.toFixed(2)}`,
      `,Net pay disbursed,${totals.net.toFixed(2)}`,
      ``,
      `Month,Gross`,
      ...Object.entries(monthly).map(([m, v]) => `${m},${v.toFixed(2)}`),
      ``,
      `NOTE: This is a download-ready summary. Replit's HR Compliance module does not perform tax e-filing.`,
    ].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${formType}-${year}-${userId}.csv"`);
    return void res.send(csv);
  }

  res.json({
    formType, year,
    employer: restaurant ?? null,
    employee: user ?? null,
    totals, monthly,
    note: "Summary only. Replit does not file taxes on your behalf.",
  });
});

// ─────────────────────────── Dashboard summary ───────────────────────────

router.get("/restaurants/:restaurantId/hr-compliance/summary", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86_400_000);

  const docs = await db.select().from(staffComplianceDocsTable)
    .where(eq(staffComplianceDocsTable.restaurantId, restaurantId));
  let expired = 0, expiringSoon = 0, valid = 0;
  for (const d of docs) {
    if (!d.expiryDate) { valid++; continue; }
    if (d.expiryDate < now) expired++;
    else if (d.expiryDate <= in30) expiringSoon++;
    else valid++;
  }

  const [{ benefitsCount = 0 } = { benefitsCount: 0 }] = await db.select({
    benefitsCount: sql<number>`count(*)::int`,
  }).from(employeeBenefitsTable)
    .where(and(eq(employeeBenefitsTable.restaurantId, restaurantId), eq(employeeBenefitsTable.status, "active")));

  const [{ staffCount = 0 } = { staffCount: 0 }] = await db.select({
    staffCount: sql<number>`count(*)::int`,
  }).from(staffTable)
    .where(and(eq(staffTable.restaurantId, restaurantId), eq(staffTable.isActive, true)));

  res.json({
    docs: { total: docs.length, expired, expiringSoon, valid },
    benefits: { active: benefitsCount },
    staff: { active: staffCount },
  });
});

// ─────────────────────────── HR audit log ───────────────────────────

router.get("/restaurants/:restaurantId/hr-compliance/audit", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
  const rows = await db.select().from(auditLogsTable)
    .where(and(
      eq(auditLogsTable.restaurantId, restaurantId),
      eq(auditLogsTable.module, "hr_compliance"),
    ))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(limit);
  res.json(rows);
});

export default router;
