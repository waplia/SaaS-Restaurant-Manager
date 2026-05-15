import { Router } from "express";
import { eq, and, gte, lt, sql, inArray, desc } from "drizzle-orm";
import {
  db,
  usersTable,
  payrollRunsTable,
  payrollItemsTable,
  payrollPaymentsTable,
  salaryStructuresTable,
  salaryComponentsTable,
  staffAdvancesTable,
  staffAdjustmentsTable,
  attendanceTable,
  ordersTable,
  auditLogsTable,
  restaurantsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { computePayroll, monthBounds, formatMoney, type CalcSalaryStructure, type CalcAttendanceRow } from "../lib/payroll";
import { pushToUserIds } from "../lib/pushNotify";
import { logger } from "../lib/logger";

const router = Router();

// All payroll endpoints are owner-only — payroll is sensitive and we
// deliberately *don't* let branch managers run or finalise payroll.
router.use(
  "/restaurants/:restaurantId/payroll-runs",
  requireRole("owner", "super_admin"),
  validateRestaurantAccess,
);
router.use(
  "/restaurants/:restaurantId/payroll-items",
  requireRole("owner", "super_admin"),
  validateRestaurantAccess,
);
router.use(
  "/restaurants/:restaurantId/payroll-summary",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);

async function audit(restaurantId: number, userId: number | null, action: string, entity: string, entityId: number | null, details?: unknown, ip?: string) {
  try {
    await db.insert(auditLogsTable).values({
      restaurantId,
      userId,
      action,
      entity,
      entityId: entityId ?? undefined,
      details: details ? JSON.stringify(details) : undefined,
      ipAddress: ip,
    });
  } catch {
    /* never break */
  }
}

function parseMoneyStr(v: unknown, field: string): { ok: true; value: string } | { ok: false; error: string } {
  if (v === null || v === undefined || v === "") return { ok: false, error: `${field} is required` };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${field} must be a non-negative number` };
  return { ok: true, value: n.toFixed(2) };
}

function isValidPeriod(year: number, month: number): boolean {
  return Number.isInteger(year) && Number.isInteger(month)
    && year >= 2000 && year <= 2100 && month >= 1 && month <= 12;
}

/**
 * Build the JSON snapshot stored on a payroll item so future edits to the
 * salary structure don't affect historical pay slips.
 */
function snapshotStructure(s: CalcSalaryStructure | null): string {
  if (!s) return JSON.stringify({ type: "custom", components: [] });
  return JSON.stringify(s);
}

interface ComputedItem {
  userId: number;
  userName: string;
  employeeCode: string | null;
  structure: CalcSalaryStructure | null;
  attendance: CalcAttendanceRow[];
  advances: Array<{ id: number; amount: string; settledAmount: string }>;
  adjustments: Array<{ kind: "bonus" | "deduction"; amount: string; label: string }>;
  commissionSales: string;
  commissionOrders: number;
}

/**
 * Gather all per-staff inputs needed to compute a payroll for the given
 * month, in a single set of bulk queries. We return rows as plain objects
 * grouped by userId so the calc engine can run independently of the DB.
 */
async function gatherInputs(restaurantId: number, year: number, month: number) {
  const { start, end, daysInMonth } = monthBounds(year, month);

  // Staff in scope = active users belonging to this restaurant who hold one
  // of the staff-ish roles. Owners do not get a slip.
  const staff = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(and(
      eq(usersTable.restaurantId, restaurantId),
      eq(usersTable.isActive, true),
      inArray(usersTable.role, ["manager", "waiter", "kitchen", "delivery_executive", "cashier"]),
    ));
  if (staff.length === 0) return { items: [] as ComputedItem[], daysInMonth };

  const userIds = staff.map((s) => s.id);

  const structures = await db
    .select()
    .from(salaryStructuresTable)
    .where(and(
      eq(salaryStructuresTable.restaurantId, restaurantId),
      inArray(salaryStructuresTable.userId, userIds),
    ));
  const components = structures.length > 0
    ? await db
        .select()
        .from(salaryComponentsTable)
        .where(inArray(salaryComponentsTable.structureId, structures.map((s) => s.id)))
    : [];
  const structureByUser = new Map<number, CalcSalaryStructure>();
  for (const s of structures) {
    structureByUser.set(s.userId, {
      type: (s.type as CalcSalaryStructure["type"]) ?? "fixed_monthly",
      baseAmount: s.baseAmount,
      hourlyRate: s.hourlyRate,
      dailyRate: s.dailyRate,
      commissionRate: s.commissionRate,
      commissionBase: s.commissionBase,
      currency: s.currency,
      components: components
        .filter((c) => c.structureId === s.id)
        .map((c) => ({
          name: c.name,
          amount: c.amount,
          isRecurring: c.isRecurring,
          isTaxable: c.isTaxable,
        })),
    });
  }

  const attendance = await db
    .select()
    .from(attendanceTable)
    .where(and(
      eq(attendanceTable.restaurantId, restaurantId),
      inArray(attendanceTable.userId, userIds),
      gte(attendanceTable.date, start),
      lt(attendanceTable.date, end),
    ));
  const attByUser = new Map<number, CalcAttendanceRow[]>();
  for (const a of attendance) {
    const row: CalcAttendanceRow = {
      status: a.status,
      workedMinutes: a.workedMinutes ?? 0,
      scheduledMinutes: a.scheduledMinutes ?? 0,
      lateMinutes: a.lateMinutes ?? 0,
      overtimeMinutes: a.overtimeMinutes ?? 0,
      leavePaid: a.leavePaid ?? null,
      leavePortion: a.leavePortion ?? null,
    };
    const list = attByUser.get(a.userId) ?? [];
    list.push(row);
    attByUser.set(a.userId, list);
  }

  // Outstanding advances at the *start* of the run period — anything
  // borrowed during the month is not auto-recovered until next month.
  const advances = await db
    .select()
    .from(staffAdvancesTable)
    .where(and(
      eq(staffAdvancesTable.restaurantId, restaurantId),
      inArray(staffAdvancesTable.userId, userIds),
      lt(staffAdvancesTable.paidOn, end),
    ));
  const advByUser = new Map<number, Array<{ id: number; amount: string; settledAmount: string }>>();
  for (const a of advances) {
    const list = advByUser.get(a.userId) ?? [];
    list.push({ id: a.id, amount: a.amount, settledAmount: a.settledAmount });
    advByUser.set(a.userId, list);
  }

  // Adjustments either applied to this exact month (YYYY-MM) or recurring.
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const adjustments = await db
    .select()
    .from(staffAdjustmentsTable)
    .where(and(
      eq(staffAdjustmentsTable.restaurantId, restaurantId),
      inArray(staffAdjustmentsTable.userId, userIds),
    ));
  const adjByUser = new Map<number, Array<{ kind: "bonus" | "deduction"; amount: string; label: string }>>();
  for (const a of adjustments) {
    if (!a.isRecurring && a.appliesToMonth !== monthKey) continue;
    const list = adjByUser.get(a.userId) ?? [];
    list.push({
      kind: (a.kind === "bonus" ? "bonus" : "deduction"),
      amount: a.amount,
      label: a.label,
    });
    adjByUser.set(a.userId, list);
  }

  // Commission inputs — totalled per cashier/waiter from completed orders.
  let salesByUser = new Map<number, { sales: number; orders: number }>();
  try {
    const rows = await db
      .select({
        userId: ordersTable.waiterId,
        total: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)`,
        cnt: sql<number>`COUNT(*)`,
      })
      .from(ordersTable)
      .where(and(
        eq(ordersTable.restaurantId, restaurantId),
        eq(ordersTable.status, "completed"),
        gte(ordersTable.createdAt, start),
        lt(ordersTable.createdAt, end),
      ))
      .groupBy(ordersTable.waiterId);
    for (const r of rows) {
      if (r.userId == null) continue;
      salesByUser.set(r.userId, { sales: Number(r.total) || 0, orders: Number(r.cnt) || 0 });
    }
  } catch (err) {
    logger.warn({ err }, "payroll commission lookup failed");
  }

  const items: ComputedItem[] = staff.map((u) => ({
    userId: u.id,
    userName: u.name ?? `User #${u.id}`,
    employeeCode: null,
    structure: structureByUser.get(u.id) ?? null,
    attendance: attByUser.get(u.id) ?? [],
    advances: advByUser.get(u.id) ?? [],
    adjustments: adjByUser.get(u.id) ?? [],
    commissionSales: String(salesByUser.get(u.id)?.sales ?? 0),
    commissionOrders: salesByUser.get(u.id)?.orders ?? 0,
  }));

  return { items, daysInMonth };
}

interface RunResponseRow {
  id: number;
  runId: number;
  userId: number;
  userName: string;
  baseAmount: string;
  grossPay: string;
  advanceSettled: string;
  netPay: string;
  paymentStatus: string;
  paidAmount: string;
  overridden: boolean;
  notes: string | null;
  daysWorked: string;
  daysAbsent: string;
  daysPaidLeave: string;
  daysUnpaidLeave: string;
  overtimeMinutes: number;
  earningsBreakdown: Array<{ label: string; amount: string }>;
  deductionsBreakdown: Array<{ label: string; amount: string }>;
}

async function hydrateRun(runId: number) {
  const [run] = await db
    .select()
    .from(payrollRunsTable)
    .where(eq(payrollRunsTable.id, runId))
    .limit(1);
  if (!run) return null;

  const itemRows = await db
    .select({
      item: payrollItemsTable,
      userName: usersTable.name,
    })
    .from(payrollItemsTable)
    .innerJoin(usersTable, eq(usersTable.id, payrollItemsTable.userId))
    .where(eq(payrollItemsTable.runId, runId))
    .orderBy(usersTable.name);

  const items: RunResponseRow[] = itemRows.map((r) => {
    const it = r.item;
    return {
      id: it.id,
      runId: it.runId,
      userId: it.userId,
      userName: r.userName ?? `User #${it.userId}`,
      baseAmount: it.baseAmount,
      grossPay: it.grossPay,
      advanceSettled: it.advanceSettled,
      netPay: it.netPay,
      paymentStatus: it.paymentStatus,
      paidAmount: it.paidAmount,
      overridden: it.overridden,
      notes: it.notes,
      daysWorked: it.daysWorked,
      daysAbsent: it.daysAbsent,
      daysPaidLeave: it.daysPaidLeave,
      daysUnpaidLeave: it.daysUnpaidLeave,
      overtimeMinutes: it.overtimeMinutes,
      earningsBreakdown: it.earningsBreakdown ? JSON.parse(it.earningsBreakdown) : [],
      deductionsBreakdown: it.deductionsBreakdown ? JSON.parse(it.deductionsBreakdown) : [],
    };
  });

  return { run, items };
}

// ---------- List runs ----------
router.get("/restaurants/:restaurantId/payroll-runs", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select()
    .from(payrollRunsTable)
    .where(eq(payrollRunsTable.restaurantId, restaurantId))
    .orderBy(desc(payrollRunsTable.periodYear), desc(payrollRunsTable.periodMonth));
  res.json(rows);
});

// ---------- Create or refresh a draft run ----------
router.post("/restaurants/:restaurantId/payroll-runs", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const callerId = req.user?.sub ?? null;
  const year = Number(req.body?.periodYear);
  const month = Number(req.body?.periodMonth);
  if (!isValidPeriod(year, month)) {
    res.status(400).json({ error: "Invalid periodYear/periodMonth" });
    return;
  }
  // Block re-running future months.
  const now = new Date();
  if (year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)) {
    res.status(400).json({ error: "Cannot run payroll for a future month" });
    return;
  }

  const { items, daysInMonth } = await gatherInputs(restaurantId, year, month);

  const runId = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(payrollRunsTable)
      .where(and(
        eq(payrollRunsTable.restaurantId, restaurantId),
        eq(payrollRunsTable.periodYear, year),
        eq(payrollRunsTable.periodMonth, month),
      ))
      .limit(1);

    if (existing && existing.status === "finalized") {
      // Finalized runs are immutable — return as-is, do not recompute.
      return existing.id;
    }

    let id: number;
    if (existing) {
      id = existing.id;
      // Wipe existing draft items so we always reflect latest inputs.
      // (User overrides are intentionally discarded on re-preview; the UI
      // warns the user before triggering this.)
      await tx.delete(payrollItemsTable).where(eq(payrollItemsTable.runId, id));
    } else {
      const [inserted] = await tx
        .insert(payrollRunsTable)
        .values({
          restaurantId,
          periodYear: year,
          periodMonth: month,
          status: "draft",
          createdByUserId: callerId,
        })
        .returning();
      id = inserted.id;
    }

    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;
    let totalAdvances = 0;

    if (items.length > 0) {
      const rowsToInsert = items.map((it) => {
        const calc = computePayroll({
          structure: it.structure,
          attendance: it.attendance,
          daysInMonth,
          advances: it.advances,
          adjustments: it.adjustments,
          commissionSales: it.commissionSales,
          commissionOrders: it.commissionOrders,
        });
        totalGross += Number(calc.grossPay);
        totalDeductions += Number(calc.attendanceDeduction) + Number(calc.leaveDeduction) + Number(calc.otherDeductions);
        totalNet += Number(calc.netPay);
        totalAdvances += Number(calc.advanceSettled);
        return {
          runId: id,
          userId: it.userId,
          restaurantId,
          structureSnapshot: snapshotStructure(it.structure),
          earningsBreakdown: JSON.stringify(calc.earningsBreakdown),
          deductionsBreakdown: JSON.stringify(calc.deductionsBreakdown),
          baseAmount: calc.baseAmount,
          overtimeMinutes: calc.overtimeMinutes,
          overtimeAmount: calc.overtimeAmount,
          attendanceDeduction: calc.attendanceDeduction,
          lateDeduction: calc.lateDeduction,
          leaveDeduction: calc.leaveDeduction,
          bonus: calc.bonus,
          otherDeductions: calc.otherDeductions,
          grossPay: calc.grossPay,
          advanceSettled: calc.advanceSettled,
          netPay: calc.netPay,
          daysWorked: calc.daysWorked,
          daysAbsent: calc.daysAbsent,
          daysPaidLeave: calc.daysPaidLeave,
          daysUnpaidLeave: calc.daysUnpaidLeave,
          workedMinutes: calc.workedMinutes,
          lateMinutes: calc.lateMinutes,
        };
      });
      await tx.insert(payrollItemsTable).values(rowsToInsert);
    }

    await tx
      .update(payrollRunsTable)
      .set({
        totalGross: totalGross.toFixed(2),
        totalDeductions: totalDeductions.toFixed(2),
        totalNet: totalNet.toFixed(2),
        totalAdvancesSettled: totalAdvances.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(payrollRunsTable.id, id));
    return id;
  });

  await audit(restaurantId, callerId, "preview", "payroll_run", runId, { year, month }, req.ip);
  const result = await hydrateRun(runId);
  res.json(result);
});

// ---------- Get a run ----------
router.get("/restaurants/:restaurantId/payroll-runs/:runId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const runId = Number(req.params.runId);
  const result = await hydrateRun(runId);
  if (!result || result.run.restaurantId !== restaurantId) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(result);
});

// ---------- Patch a draft item (override) ----------
router.patch("/restaurants/:restaurantId/payroll-items/:itemId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const itemId = Number(req.params.itemId);
  const callerId = req.user?.sub ?? null;

  const [item] = await db
    .select()
    .from(payrollItemsTable)
    .where(and(eq(payrollItemsTable.id, itemId), eq(payrollItemsTable.restaurantId, restaurantId)))
    .limit(1);
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, item.runId)).limit(1);
  if (!run || run.status === "finalized") {
    res.status(400).json({ error: "Run is already finalized" });
    return;
  }

  const patch: Record<string, unknown> = { overridden: true, updatedAt: new Date() };
  const numericFields: Array<"bonus" | "otherDeductions" | "advanceSettled" | "overtimeAmount"> = [
    "bonus", "otherDeductions", "advanceSettled", "overtimeAmount",
  ];
  for (const f of numericFields) {
    if (req.body?.[f] !== undefined) {
      const p = parseMoneyStr(req.body[f], f);
      if (!p.ok) { res.status(400).json({ error: p.error }); return; }
      patch[f] = p.value;
    }
  }
  if (req.body?.notes !== undefined) patch.notes = String(req.body.notes ?? "") || null;

  // Recompute gross/net using the new values where supplied.
  const next = {
    base: Number(item.baseAmount),
    bonus: Number(patch.bonus ?? item.bonus),
    otherDed: Number(patch.otherDeductions ?? item.otherDeductions),
    attDed: Number(item.attendanceDeduction),
    leaveDed: Number(item.leaveDeduction),
    ot: Number(patch.overtimeAmount ?? item.overtimeAmount),
    adv: Number(patch.advanceSettled ?? item.advanceSettled),
  };
  const gross = next.base + next.ot + next.bonus - next.attDed - next.leaveDed - next.otherDed;
  const net = gross - next.adv;
  patch.grossPay = gross.toFixed(2);
  patch.netPay = net.toFixed(2);

  await db.update(payrollItemsTable).set(patch).where(eq(payrollItemsTable.id, itemId));

  // Update run totals.
  const sums = await db
    .select({
      g: sql<string>`COALESCE(SUM(${payrollItemsTable.grossPay}), 0)`,
      n: sql<string>`COALESCE(SUM(${payrollItemsTable.netPay}), 0)`,
      a: sql<string>`COALESCE(SUM(${payrollItemsTable.advanceSettled}), 0)`,
    })
    .from(payrollItemsTable)
    .where(eq(payrollItemsTable.runId, item.runId));
  await db
    .update(payrollRunsTable)
    .set({
      totalGross: sums[0].g,
      totalNet: sums[0].n,
      totalAdvancesSettled: sums[0].a,
      updatedAt: new Date(),
    })
    .where(eq(payrollRunsTable.id, item.runId));

  await audit(restaurantId, callerId, "override", "payroll_item", itemId, req.body, req.ip);
  const result = await hydrateRun(item.runId);
  res.json(result);
});

// ---------- Finalize a run ----------
router.post("/restaurants/:restaurantId/payroll-runs/:runId/finalize", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const runId = Number(req.params.runId);
  const callerId = req.user?.sub ?? null;

  const result = await db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(payrollRunsTable)
      .where(and(eq(payrollRunsTable.id, runId), eq(payrollRunsTable.restaurantId, restaurantId)))
      .limit(1);
    if (!run) return { ok: false as const, status: 404, error: "Not found" };
    if (run.status === "finalized") return { ok: false as const, status: 400, error: "Already finalized" };

    const items = await tx
      .select()
      .from(payrollItemsTable)
      .where(eq(payrollItemsTable.runId, runId));

    // Allocate each item's advanceSettled across its outstanding advances
    // FIFO. We need to handle items where staff have multiple open advances.
    for (const it of items) {
      let remaining = Number(it.advanceSettled);
      if (remaining <= 0) continue;
      const open = await tx
        .select()
        .from(staffAdvancesTable)
        .where(and(
          eq(staffAdvancesTable.restaurantId, restaurantId),
          eq(staffAdvancesTable.userId, it.userId),
        ))
        .orderBy(staffAdvancesTable.paidOn);
      for (const adv of open) {
        if (remaining <= 0) break;
        const outstanding = Number(adv.amount) - Number(adv.settledAmount);
        if (outstanding <= 0) continue;
        const apply = Math.min(remaining, outstanding);
        const newSettled = (Number(adv.settledAmount) + apply).toFixed(2);
        await tx
          .update(staffAdvancesTable)
          .set({ settledAmount: newSettled, updatedAt: new Date() })
          .where(eq(staffAdvancesTable.id, adv.id));
        remaining -= apply;
      }
    }

    await tx
      .update(payrollRunsTable)
      .set({
        status: "finalized",
        finalizedByUserId: callerId,
        finalizedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(payrollRunsTable.id, runId));
    return { ok: true as const, items, run };
  });

  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  // Push notify each staff member. Fire-and-forget — never block response.
  const userIds = result.items.map((i) => i.userId);
  void pushToUserIds(userIds, "payroll", {
    title: "Salary slip ready",
    body: `Your salary for ${result.run.periodYear}-${String(result.run.periodMonth).padStart(2, "0")} is available.`,
    data: { runId, kind: "payroll_finalized" },
  });

  await audit(restaurantId, callerId, "finalize", "payroll_run", runId, null, req.ip);
  const hydrated = await hydrateRun(runId);
  res.json(hydrated);
});

// ---------- Record a payment against an item ----------
router.post("/restaurants/:restaurantId/payroll-items/:itemId/payments", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const itemId = Number(req.params.itemId);
  const callerId = req.user?.sub ?? null;

  const amtP = parseMoneyStr(req.body?.amount, "amount");
  if (!amtP.ok) { res.status(400).json({ error: amtP.error }); return; }

  const paidOn = req.body?.paidOn ? new Date(req.body.paidOn) : new Date();
  if (Number.isNaN(paidOn.getTime())) { res.status(400).json({ error: "Invalid paidOn" }); return; }
  const mode = String(req.body?.mode ?? "cash");
  const reference = req.body?.reference ? String(req.body.reference) : null;
  const notes = req.body?.notes ? String(req.body.notes) : null;

  const updated = await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(payrollItemsTable)
      .where(and(eq(payrollItemsTable.id, itemId), eq(payrollItemsTable.restaurantId, restaurantId)))
      .limit(1);
    if (!item) return { ok: false as const, status: 404, error: "Not found" };
    const [run] = await tx.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, item.runId)).limit(1);
    if (!run || run.status !== "finalized") {
      return { ok: false as const, status: 400, error: "Run must be finalized before recording payments" };
    }
    const net = Number(item.netPay);
    const already = Number(item.paidAmount);
    const adding = Number(amtP.value);
    if (already + adding > net + 0.001) {
      return { ok: false as const, status: 400, error: `Amount exceeds remaining balance (${formatMoney(net - already)})` };
    }
    await tx.insert(payrollPaymentsTable).values({
      itemId,
      runId: item.runId,
      restaurantId,
      amount: amtP.value,
      paidOn,
      mode,
      reference,
      notes,
      recordedByUserId: callerId,
    });
    const newPaid = already + adding;
    const newStatus = newPaid + 0.001 >= net ? "paid" : newPaid > 0 ? "partially_paid" : "pending";
    await tx
      .update(payrollItemsTable)
      .set({ paidAmount: newPaid.toFixed(2), paymentStatus: newStatus, updatedAt: new Date() })
      .where(eq(payrollItemsTable.id, itemId));
    return { ok: true as const, item, newStatus, newPaid };
  });

  if (!updated.ok) { res.status(updated.status).json({ error: updated.error }); return; }

  if (updated.newStatus === "paid") {
    void pushToUserIds([updated.item.userId], "payroll", {
      title: "Salary paid",
      body: `${formatMoney(updated.item.netPay)} credited for this month.`,
      data: { itemId, runId: updated.item.runId, kind: "payroll_paid" },
    });
  }

  await audit(restaurantId, callerId, "payment", "payroll_item", itemId, { amount: amtP.value, mode }, req.ip);
  const hydrated = await hydrateRun(updated.item.runId);
  res.json(hydrated);
});

// ---------- List payments for an item ----------
router.get("/restaurants/:restaurantId/payroll-items/:itemId/payments", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const itemId = Number(req.params.itemId);
  const rows = await db
    .select()
    .from(payrollPaymentsTable)
    .where(and(eq(payrollPaymentsTable.itemId, itemId), eq(payrollPaymentsTable.restaurantId, restaurantId)))
    .orderBy(desc(payrollPaymentsTable.paidOn));
  res.json(rows);
});

// ---------- Salary slip HTML ----------
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SLIP_CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; margin: 0; padding: 0; background: #f5f5f5; }
  .slip { max-width: 760px; margin: 24px auto; background: #fff; padding: 32px; border: 1px solid #e5e5e5; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .muted { color: #6b7280; font-size: 13px; }
  .row { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }
  th { background: #fafafa; font-weight: 600; }
  td.amt, th.amt { text-align: right; font-variant-numeric: tabular-nums; }
  .total { font-weight: 700; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 24px; }
  .net { margin-top: 20px; padding: 16px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; }
  .net .amount { font-size: 22px; font-weight: 700; color: #166534; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .badge.paid { background: #dcfce7; color: #166534; }
  .badge.partially_paid { background: #fef9c3; color: #854d0e; }
  .badge.pending { background: #fee2e2; color: #991b1b; }
  @media print { body { background: #fff; } .slip { border: none; margin: 0; max-width: none; } .no-print { display: none; } }
`;

function renderSlipHtml(opts: {
  restaurantName: string;
  user: { name: string };
  run: { periodYear: number; periodMonth: number; finalizedAt: Date | null };
  item: {
    earningsBreakdown: Array<{ label: string; amount: string }>;
    deductionsBreakdown: Array<{ label: string; amount: string }>;
    grossPay: string;
    netPay: string;
    advanceSettled: string;
    daysWorked: string;
    daysAbsent: string;
    daysPaidLeave: string;
    daysUnpaidLeave: string;
    paymentStatus: string;
    paidAmount: string;
  };
}): string {
  const monthName = new Date(opts.run.periodYear, opts.run.periodMonth - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  const earningsRows = opts.item.earningsBreakdown.map(
    (e) => `<tr><td>${escapeHtml(e.label)}</td><td class="amt">${escapeHtml(formatMoney(e.amount))}</td></tr>`,
  ).join("");
  const dedRows = opts.item.deductionsBreakdown.map(
    (d) => `<tr><td>${escapeHtml(d.label)}</td><td class="amt">${escapeHtml(formatMoney(d.amount))}</td></tr>`,
  ).join("");
  const statusLabel = opts.item.paymentStatus.replace("_", " ");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Salary Slip — ${escapeHtml(opts.user.name)} ${escapeHtml(monthName)}</title>
<style>${SLIP_CSS}</style></head>
<body>
  <div class="slip">
    <div class="row"><div>
      <h1>${escapeHtml(opts.restaurantName)}</h1>
      <div class="muted">Salary Slip · ${escapeHtml(monthName)}</div>
    </div><div style="text-align:right">
      <span class="badge ${escapeHtml(opts.item.paymentStatus)}">${escapeHtml(statusLabel)}</span>
      <div class="muted" style="margin-top:4px">${opts.run.finalizedAt ? new Date(opts.run.finalizedAt).toLocaleDateString("en-IN") : "Draft"}</div>
    </div></div>
    <div class="row" style="margin-top:16px"><div>
      <div style="font-weight:600">${escapeHtml(opts.user.name)}</div>
    </div><div class="muted">
      Worked ${escapeHtml(opts.item.daysWorked)} · Absent ${escapeHtml(opts.item.daysAbsent)} · Paid leave ${escapeHtml(opts.item.daysPaidLeave)} · Unpaid leave ${escapeHtml(opts.item.daysUnpaidLeave)}
    </div></div>
    <div class="grid">
      <div>
        <table><thead><tr><th>Earnings</th><th class="amt">Amount</th></tr></thead>
        <tbody>${earningsRows || `<tr><td class="muted">No earnings</td><td></td></tr>`}</tbody></table>
      </div>
      <div>
        <table><thead><tr><th>Deductions</th><th class="amt">Amount</th></tr></thead>
        <tbody>${dedRows || `<tr><td class="muted">No deductions</td><td></td></tr>`}</tbody></table>
      </div>
    </div>
    <div class="net">
      <div>
        <div class="muted">Gross ${escapeHtml(formatMoney(opts.item.grossPay))} · Advance recovered ${escapeHtml(formatMoney(opts.item.advanceSettled))}</div>
        <div style="font-weight:700;margin-top:4px">Net Pay</div>
      </div>
      <div class="amount">${escapeHtml(formatMoney(opts.item.netPay))}</div>
    </div>
    <div class="muted" style="margin-top:24px;font-size:11px">Paid so far: ${escapeHtml(formatMoney(opts.item.paidAmount))} · Generated by Khana Lagao</div>
  </div>
  <script>setTimeout(function(){if(location.search.indexOf("print")!==-1)window.print();},250);</script>
</body></html>`;
}

router.get("/restaurants/:restaurantId/payroll-items/:itemId/slip", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const itemId = Number(req.params.itemId);
  const [item] = await db
    .select()
    .from(payrollItemsTable)
    .where(and(eq(payrollItemsTable.id, itemId), eq(payrollItemsTable.restaurantId, restaurantId)))
    .limit(1);
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, item.runId)).limit(1);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, item.userId)).limit(1);
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId)).limit(1);
  const html = renderSlipHtml({
    restaurantName: restaurant?.name ?? "Restaurant",
    user: { name: user?.name ?? `User #${item.userId}` },
    run: { periodYear: run!.periodYear, periodMonth: run!.periodMonth, finalizedAt: run!.finalizedAt },
    item: {
      earningsBreakdown: item.earningsBreakdown ? JSON.parse(item.earningsBreakdown) : [],
      deductionsBreakdown: item.deductionsBreakdown ? JSON.parse(item.deductionsBreakdown) : [],
      grossPay: item.grossPay,
      netPay: item.netPay,
      advanceSettled: item.advanceSettled,
      daysWorked: item.daysWorked,
      daysAbsent: item.daysAbsent,
      daysPaidLeave: item.daysPaidLeave,
      daysUnpaidLeave: item.daysUnpaidLeave,
      paymentStatus: item.paymentStatus,
      paidAmount: item.paidAmount,
    },
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// ---------- Per-staff payroll summary for a month (used by staff list pill) ----------
router.get("/restaurants/:restaurantId/payroll-summary", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!isValidPeriod(year, month)) {
    res.status(400).json({ error: "Invalid year/month" });
    return;
  }
  const rows = await db
    .select({
      userId: payrollItemsTable.userId,
      itemId: payrollItemsTable.id,
      runId: payrollItemsTable.runId,
      runStatus: payrollRunsTable.status,
      paymentStatus: payrollItemsTable.paymentStatus,
      netPay: payrollItemsTable.netPay,
      paidAmount: payrollItemsTable.paidAmount,
    })
    .from(payrollItemsTable)
    .innerJoin(payrollRunsTable, eq(payrollRunsTable.id, payrollItemsTable.runId))
    .where(and(
      eq(payrollItemsTable.restaurantId, restaurantId),
      eq(payrollRunsTable.periodYear, year),
      eq(payrollRunsTable.periodMonth, month),
    ));
  res.json(rows);
});

export default router;
