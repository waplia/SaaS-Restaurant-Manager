import { Router } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  salaryStructuresTable,
  salaryComponentsTable,
  staffAdvancesTable,
  staffAdjustmentsTable,
  performanceNotesTable,
  auditLogsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

router.use(
  "/restaurants/:restaurantId",
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

async function userBelongsToRestaurant(userId: number, restaurantId: number): Promise<boolean> {
  if (!userId || !restaurantId) return false;
  const [u] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.restaurantId, restaurantId)))
    .limit(1);
  return !!u;
}

const SALARY_TYPES = new Set(["fixed_monthly", "daily_wage", "hourly_wage", "commission", "custom"]);
const COMMISSION_BASES = new Set(["orders", "sales"]);

/** Parse a money-like field. Returns the string form (fixed to 2 dp) or null. */
function parseMoney(v: unknown, opts: { allowNull?: boolean; field: string }): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === null || v === undefined || v === "") {
    if (opts.allowNull) return { ok: true, value: null };
    return { ok: false, error: `${opts.field} is required` };
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${opts.field} must be a non-negative number` };
  return { ok: true, value: n.toFixed(2) };
}

function parseRate(v: unknown, opts: { allowNull?: boolean; field: string; max?: number }): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === null || v === undefined || v === "") {
    if (opts.allowNull) return { ok: true, value: null };
    return { ok: false, error: `${opts.field} is required` };
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${opts.field} must be a non-negative number` };
  if (opts.max !== undefined && n > opts.max) return { ok: false, error: `${opts.field} must be ≤ ${opts.max}` };
  return { ok: true, value: String(n) };
}

/**
 * Validate that the rate fields supplied are consistent with the salary
 * `type`. Each type requires its own primary numeric (and may require a
 * commission base). Returns a human-readable error or `null` if OK.
 */
function validateSalaryShape(body: Record<string, unknown>): string | null {
  const t = String(body.type ?? "");
  if (!SALARY_TYPES.has(t)) return "Invalid salary type";
  const has = (k: string) => body[k] != null && body[k] !== "";
  if (t === "fixed_monthly" && !has("baseAmount")) return "fixed_monthly requires baseAmount";
  if (t === "daily_wage" && !has("dailyRate")) return "daily_wage requires dailyRate";
  if (t === "hourly_wage" && !has("hourlyRate")) return "hourly_wage requires hourlyRate";
  if (t === "commission") {
    if (!has("commissionRate")) return "commission requires commissionRate";
    if (body.commissionBase && !COMMISSION_BASES.has(String(body.commissionBase))) {
      return "commissionBase must be 'orders' or 'sales'";
    }
  }
  return null;
}

// ---------- Salary structures ----------

router.get("/restaurants/:restaurantId/staff/:userId/salary-structure", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  if (!(await userBelongsToRestaurant(userId, restaurantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [row] = await db
    .select()
    .from(salaryStructuresTable)
    .where(and(eq(salaryStructuresTable.restaurantId, restaurantId), eq(salaryStructuresTable.userId, userId)))
    .limit(1);
  if (!row) {
    res.json(null);
    return;
  }
  const components = await db
    .select()
    .from(salaryComponentsTable)
    .where(eq(salaryComponentsTable.structureId, row.id))
    .orderBy(salaryComponentsTable.id);
  res.json({ ...row, components });
});

router.put("/restaurants/:restaurantId/staff/:userId/salary-structure", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const callerId = req.user?.sub ?? null;
  if (!(await userBelongsToRestaurant(userId, restaurantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const err = validateSalaryShape(req.body ?? {});
  if (err) { res.status(400).json({ error: err }); return; }
  const { type, commissionBase, currency, effectiveFrom, components } = req.body ?? {};

  // Parse all money/rate fields; reject anything malformed before touching DB.
  const baseP = parseMoney(req.body?.baseAmount, { allowNull: true, field: "baseAmount" });
  if (!baseP.ok) { res.status(400).json({ error: baseP.error }); return; }
  const hourlyP = parseMoney(req.body?.hourlyRate, { allowNull: true, field: "hourlyRate" });
  if (!hourlyP.ok) { res.status(400).json({ error: hourlyP.error }); return; }
  const dailyP = parseMoney(req.body?.dailyRate, { allowNull: true, field: "dailyRate" });
  if (!dailyP.ok) { res.status(400).json({ error: dailyP.error }); return; }
  const commP = parseRate(req.body?.commissionRate, { allowNull: true, field: "commissionRate", max: 100 });
  if (!commP.ok) { res.status(400).json({ error: commP.error }); return; }

  let effectiveFromDate: Date | null = null;
  if (effectiveFrom) {
    effectiveFromDate = new Date(effectiveFrom);
    if (Number.isNaN(effectiveFromDate.getTime())) {
      res.status(400).json({ error: "Invalid effectiveFrom date" });
      return;
    }
  }

  const parsedCurrency = currency ? String(currency).toUpperCase().trim() : "INR";
  if (!/^[A-Z]{3}$/.test(parsedCurrency)) {
    res.status(400).json({ error: "currency must be a 3-letter ISO code" });
    return;
  }

  let parsedComponents: Array<{ name: string; amount: string; isRecurring: boolean; isTaxable: boolean }> = [];
  if (components !== undefined) {
    if (!Array.isArray(components)) {
      res.status(400).json({ error: "components must be an array" });
      return;
    }
    for (let i = 0; i < components.length; i++) {
      const c = components[i] as { name?: unknown; amount?: unknown; isRecurring?: unknown; isTaxable?: unknown };
      const name = String(c?.name ?? "").trim();
      if (!name) { res.status(400).json({ error: `components[${i}].name is required` }); return; }
      const amt = parseMoney(c?.amount, { field: `components[${i}].amount` });
      if (!amt.ok) { res.status(400).json({ error: amt.error }); return; }
      parsedComponents.push({
        name,
        amount: amt.value as string,
        isRecurring: c?.isRecurring !== false,
        isTaxable: !!c?.isTaxable,
      });
    }
  }

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(salaryStructuresTable)
      .where(and(eq(salaryStructuresTable.restaurantId, restaurantId), eq(salaryStructuresTable.userId, userId)))
      .limit(1);

    let structureId: number;
    if (existing) {
      await tx
        .update(salaryStructuresTable)
        .set({
          type: String(type),
          baseAmount: baseP.value,
          hourlyRate: hourlyP.value,
          dailyRate: dailyP.value,
          commissionRate: commP.value,
          commissionBase: commissionBase ?? null,
          currency: parsedCurrency,
          effectiveFrom: effectiveFromDate,
          updatedAt: new Date(),
        })
        .where(eq(salaryStructuresTable.id, existing.id));
      structureId = existing.id;
    } else {
      const [inserted] = await tx
        .insert(salaryStructuresTable)
        .values({
          userId,
          restaurantId,
          type: String(type),
          baseAmount: baseP.value,
          hourlyRate: hourlyP.value,
          dailyRate: dailyP.value,
          commissionRate: commP.value,
          commissionBase: commissionBase ?? null,
          currency: parsedCurrency,
          effectiveFrom: effectiveFromDate,
        })
        .returning();
      structureId = inserted.id;
    }

    // Replace components wholesale — simpler and easier to reason about than
    // a diff; components are conceptually a small set per structure.
    await tx.delete(salaryComponentsTable).where(eq(salaryComponentsTable.structureId, structureId));
    if (parsedComponents.length > 0) {
      await tx.insert(salaryComponentsTable).values(
        parsedComponents.map((c) => ({
          structureId,
          restaurantId,
          name: c.name,
          amount: c.amount,
          isRecurring: c.isRecurring,
          isTaxable: c.isTaxable,
        })),
      );
    }
    return structureId;
  });

  await audit(restaurantId, callerId, "upsert", "salary_structure", result, req.body, req.ip);

  const [row] = await db
    .select()
    .from(salaryStructuresTable)
    .where(eq(salaryStructuresTable.id, result))
    .limit(1);
  const compRows = await db
    .select()
    .from(salaryComponentsTable)
    .where(eq(salaryComponentsTable.structureId, result));
  res.json({ ...row, components: compRows });
});

// ---------- Advances ----------

router.get("/restaurants/:restaurantId/staff/:userId/advances", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  if (!(await userBelongsToRestaurant(userId, restaurantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Fetch oldest-first so we can compute a chronological running balance,
  // then return newest-first for display.
  const chronological = await db
    .select()
    .from(staffAdvancesTable)
    .where(and(eq(staffAdvancesTable.restaurantId, restaurantId), eq(staffAdvancesTable.userId, userId)))
    .orderBy(staffAdvancesTable.paidOn, staffAdvancesTable.id);

  let running = 0;
  const withBalance = chronological.map((r) => {
    running += Number(r.amount) - Number(r.settledAmount);
    return { ...r, runningBalance: running.toFixed(2) };
  });
  const totals = chronological.reduce(
    (acc, r) => {
      acc.advanced += Number(r.amount);
      acc.settled += Number(r.settledAmount);
      return acc;
    },
    { advanced: 0, settled: 0 },
  );
  res.json({
    rows: withBalance.slice().reverse(),
    outstanding: (totals.advanced - totals.settled).toFixed(2),
    advanced: totals.advanced.toFixed(2),
    settled: totals.settled.toFixed(2),
  });
});

router.post("/restaurants/:restaurantId/staff/:userId/advances", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const callerId = req.user?.sub ?? null;
  if (!(await userBelongsToRestaurant(userId, restaurantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const { amount, paidOn, notes } = req.body ?? {};
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    res.status(400).json({ error: "amount must be positive" });
    return;
  }
  const paidDate = paidOn ? new Date(paidOn) : new Date();
  if (Number.isNaN(paidDate.getTime())) {
    res.status(400).json({ error: "Invalid paidOn date" });
    return;
  }
  const [row] = await db
    .insert(staffAdvancesTable)
    .values({
      userId,
      restaurantId,
      amount: String(amt.toFixed(2)),
      paidOn: paidDate,
      notes: notes ? String(notes) : null,
      recordedByUserId: callerId,
    })
    .returning();
  await audit(restaurantId, callerId, "create", "staff_advance", row.id, { amount: amt, paidOn: paidDate.toISOString() }, req.ip);
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/staff/:userId/advances/:advanceId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const advanceId = Number(req.params.advanceId);
  const callerId = req.user?.sub ?? null;
  const { notes, settledAmount } = req.body ?? {};
  const [existing] = await db
    .select()
    .from(staffAdvancesTable)
    .where(
      and(
        eq(staffAdvancesTable.id, advanceId),
        eq(staffAdvancesTable.restaurantId, restaurantId),
        eq(staffAdvancesTable.userId, userId),
      ),
    )
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (notes !== undefined) patch.notes = notes === null ? null : String(notes);
  if (settledAmount !== undefined) {
    const s = Number(settledAmount);
    if (!Number.isFinite(s) || s < 0) {
      res.status(400).json({ error: "settledAmount must be non-negative" });
      return;
    }
    if (s > Number(existing.amount) + 1e-6) {
      res.status(400).json({ error: "settledAmount cannot exceed advance amount" });
      return;
    }
    patch.settledAmount = s.toFixed(2);
  }
  const [updated] = await db
    .update(staffAdvancesTable)
    .set(patch)
    .where(
      and(
        eq(staffAdvancesTable.id, advanceId),
        eq(staffAdvancesTable.restaurantId, restaurantId),
        eq(staffAdvancesTable.userId, userId),
      ),
    )
    .returning();
  await audit(restaurantId, callerId, "update", "staff_advance", advanceId, patch, req.ip);
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/staff/:userId/advances/:advanceId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const advanceId = Number(req.params.advanceId);
  const callerId = req.user?.sub ?? null;
  const [deleted] = await db
    .delete(staffAdvancesTable)
    .where(
      and(
        eq(staffAdvancesTable.id, advanceId),
        eq(staffAdvancesTable.restaurantId, restaurantId),
        eq(staffAdvancesTable.userId, userId),
      ),
    )
    .returning();
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  await audit(restaurantId, callerId, "delete", "staff_advance", advanceId, null, req.ip);
  res.json({ ok: true });
});

// ---------- Adjustments ----------

router.get("/restaurants/:restaurantId/staff/:userId/adjustments", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  if (!(await userBelongsToRestaurant(userId, restaurantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const rows = await db
    .select()
    .from(staffAdjustmentsTable)
    .where(and(eq(staffAdjustmentsTable.restaurantId, restaurantId), eq(staffAdjustmentsTable.userId, userId)))
    .orderBy(desc(staffAdjustmentsTable.id));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/staff/:userId/adjustments", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const callerId = req.user?.sub ?? null;
  if (!(await userBelongsToRestaurant(userId, restaurantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const { kind, amount, label, appliesToMonth, isRecurring } = req.body ?? {};
  if (kind !== "bonus" && kind !== "deduction") {
    res.status(400).json({ error: "kind must be bonus or deduction" });
    return;
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    res.status(400).json({ error: "amount must be positive" });
    return;
  }
  if (!label || !String(label).trim()) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  if (appliesToMonth && !/^\d{4}-\d{2}$/.test(String(appliesToMonth))) {
    res.status(400).json({ error: "appliesToMonth must be YYYY-MM" });
    return;
  }
  const [row] = await db
    .insert(staffAdjustmentsTable)
    .values({
      userId,
      restaurantId,
      kind,
      amount: String(amt.toFixed(2)),
      label: String(label).trim(),
      appliesToMonth: appliesToMonth ? String(appliesToMonth) : null,
      isRecurring: !!isRecurring,
      recordedByUserId: callerId,
    })
    .returning();
  await audit(restaurantId, callerId, "create", "staff_adjustment", row.id, req.body, req.ip);
  res.status(201).json(row);
});

router.delete("/restaurants/:restaurantId/staff/:userId/adjustments/:adjId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const adjId = Number(req.params.adjId);
  const callerId = req.user?.sub ?? null;
  const [deleted] = await db
    .delete(staffAdjustmentsTable)
    .where(
      and(
        eq(staffAdjustmentsTable.id, adjId),
        eq(staffAdjustmentsTable.restaurantId, restaurantId),
        eq(staffAdjustmentsTable.userId, userId),
      ),
    )
    .returning();
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  await audit(restaurantId, callerId, "delete", "staff_adjustment", adjId, null, req.ip);
  res.json({ ok: true });
});

// ---------- Performance notes ----------

router.get("/restaurants/:restaurantId/staff/:userId/performance-notes", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  if (!(await userBelongsToRestaurant(userId, restaurantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const rows = await db
    .select({
      id: performanceNotesTable.id,
      userId: performanceNotesTable.userId,
      restaurantId: performanceNotesTable.restaurantId,
      authorUserId: performanceNotesTable.authorUserId,
      rating: performanceNotesTable.rating,
      body: performanceNotesTable.body,
      createdAt: performanceNotesTable.createdAt,
      authorName: usersTable.name,
    })
    .from(performanceNotesTable)
    .leftJoin(usersTable, eq(usersTable.id, performanceNotesTable.authorUserId))
    .where(
      and(
        eq(performanceNotesTable.restaurantId, restaurantId),
        eq(performanceNotesTable.userId, userId),
      ),
    )
    .orderBy(desc(performanceNotesTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/staff/:userId/performance-notes", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const callerId = req.user?.sub ?? null;
  if (!(await userBelongsToRestaurant(userId, restaurantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const { rating, body } = req.body ?? {};
  if (!body || !String(body).trim()) {
    res.status(400).json({ error: "body is required" });
    return;
  }
  let r: number | null = null;
  if (rating !== undefined && rating !== null && rating !== "") {
    r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      res.status(400).json({ error: "rating must be 1-5" });
      return;
    }
  }
  const [row] = await db
    .insert(performanceNotesTable)
    .values({
      userId,
      restaurantId,
      authorUserId: callerId,
      rating: r,
      body: String(body).trim(),
    })
    .returning();
  await audit(restaurantId, callerId, "create", "performance_note", row.id, { rating: r }, req.ip);
  res.status(201).json(row);
});

router.delete("/restaurants/:restaurantId/staff/:userId/performance-notes/:noteId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const noteId = Number(req.params.noteId);
  const callerId = req.user?.sub ?? null;
  const [deleted] = await db
    .delete(performanceNotesTable)
    .where(
      and(
        eq(performanceNotesTable.id, noteId),
        eq(performanceNotesTable.restaurantId, restaurantId),
        eq(performanceNotesTable.userId, userId),
      ),
    )
    .returning();
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  await audit(restaurantId, callerId, "delete", "performance_note", noteId, null, req.ip);
  res.json({ ok: true });
});

export default router;
