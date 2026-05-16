import { Router } from "express";
import { and, eq, desc, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  auditLogsTable,
  staffIncentiveRulesTable,
  staffIncentivesTable,
  STAFF_INCENTIVE_RULE_TYPES,
  type StaffIncentiveRuleType,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { computeIncentivesForPeriod } from "../lib/incentives";
import { pushToUserIds } from "../lib/pushNotify";
import { logger } from "../lib/logger";

const router = Router();

// Owner+manager can view; only owner can mutate rules / approvals.
router.use(
  "/restaurants/:restaurantId/staff-incentive-rules",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);
router.use(
  "/restaurants/:restaurantId/staff-incentives",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);

function isValidPeriod(year: number, month: number): boolean {
  return Number.isInteger(year) && Number.isInteger(month)
    && year >= 2000 && year <= 2100 && month >= 1 && month <= 12;
}

function isOwnerOrAdmin(req: { user?: { role?: string; isSuperAdmin?: boolean } }): boolean {
  return Boolean(req.user?.isSuperAdmin || req.user?.role === "owner");
}

async function audit(
  restaurantId: number,
  userId: number | null,
  action: string,
  entity: string,
  entityId: number | null,
  details?: unknown,
  ip?: string,
) {
  try {
    await db.insert(auditLogsTable).values({
      restaurantId,
      userId,
      module: "staff_incentives",
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

// ---------- List rules ----------
router.get("/restaurants/:restaurantId/staff-incentive-rules", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select()
    .from(staffIncentiveRulesTable)
    .where(eq(staffIncentiveRulesTable.restaurantId, restaurantId));
  // Hydrate missing rule types as defaults so the UI gets a stable shape.
  const byType = new Map(rows.map((r) => [r.ruleType, r]));
  const result = STAFF_INCENTIVE_RULE_TYPES.map((t) => {
    const r = byType.get(t);
    if (r) return r;
    return {
      id: 0,
      restaurantId,
      ruleType: t,
      enabled: false,
      params: {},
      monthlyCap: null as string | null,
      updatedByUserId: null as number | null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });
  res.json(result);
});

// ---------- Upsert a rule (owner only) ----------
router.put("/restaurants/:restaurantId/staff-incentive-rules/:ruleType", async (req, res) => {
  if (!isOwnerOrAdmin(req)) { res.status(403).json({ error: "Owner only" }); return; }
  const restaurantId = Number(req.params.restaurantId);
  const ruleType = String(req.params.ruleType) as StaffIncentiveRuleType;
  if (!STAFF_INCENTIVE_RULE_TYPES.includes(ruleType)) {
    res.status(400).json({ error: "Invalid rule type" });
    return;
  }
  const enabled = Boolean(req.body?.enabled);
  const params = (req.body?.params && typeof req.body.params === "object") ? req.body.params : {};
  const capRaw = req.body?.monthlyCap;
  let monthlyCap: string | null = null;
  if (capRaw !== null && capRaw !== undefined && capRaw !== "") {
    const n = Number(capRaw);
    if (!Number.isFinite(n) || n < 0) { res.status(400).json({ error: "Invalid monthlyCap" }); return; }
    monthlyCap = n.toFixed(2);
  }
  const callerId = req.user?.sub ?? null;

  const [existing] = await db
    .select()
    .from(staffIncentiveRulesTable)
    .where(and(
      eq(staffIncentiveRulesTable.restaurantId, restaurantId),
      eq(staffIncentiveRulesTable.ruleType, ruleType),
    ))
    .limit(1);

  let row;
  if (existing) {
    [row] = await db
      .update(staffIncentiveRulesTable)
      .set({ enabled, params, monthlyCap, updatedByUserId: callerId, updatedAt: new Date() })
      .where(eq(staffIncentiveRulesTable.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(staffIncentiveRulesTable)
      .values({ restaurantId, ruleType, enabled, params, monthlyCap, updatedByUserId: callerId })
      .returning();
  }
  await audit(restaurantId, callerId, existing ? "update_rule" : "create_rule", "staff_incentive_rule", row.id, { ruleType, enabled, params, monthlyCap }, req.ip);
  res.json(row);
});

// ---------- List incentives for a period ----------
router.get("/restaurants/:restaurantId/staff-incentives", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!isValidPeriod(year, month)) { res.status(400).json({ error: "Invalid year/month" }); return; }
  const status = req.query.status ? String(req.query.status) : null;
  const where = [
    eq(staffIncentivesTable.restaurantId, restaurantId),
    eq(staffIncentivesTable.periodYear, year),
    eq(staffIncentivesTable.periodMonth, month),
  ];
  if (status) where.push(eq(staffIncentivesTable.status, status));

  const rows = await db
    .select({
      inc: staffIncentivesTable,
      userName: usersTable.name,
    })
    .from(staffIncentivesTable)
    .innerJoin(usersTable, eq(usersTable.id, staffIncentivesTable.userId))
    .where(and(...where))
    .orderBy(desc(staffIncentivesTable.computedAmount));

  res.json(rows.map((r) => ({ ...r.inc, userName: r.userName ?? `User #${r.inc.userId}` })));
});

// ---------- Recompute a period (owner only) ----------
router.post("/restaurants/:restaurantId/staff-incentives/recompute", async (req, res) => {
  if (!isOwnerOrAdmin(req)) { res.status(403).json({ error: "Owner only" }); return; }
  const restaurantId = Number(req.params.restaurantId);
  const year = Number(req.body?.periodYear ?? req.body?.year);
  const month = Number(req.body?.periodMonth ?? req.body?.month);
  if (!isValidPeriod(year, month)) { res.status(400).json({ error: "Invalid year/month" }); return; }
  const callerId = req.user?.sub ?? null;

  const computed = await computeIncentivesForPeriod(restaurantId, year, month);
  const newPendingUserIds: number[] = [];

  await db.transaction(async (tx) => {
    // Pull existing rows for this period so we can preserve approved ones.
    const existing = await tx
      .select()
      .from(staffIncentivesTable)
      .where(and(
        eq(staffIncentivesTable.restaurantId, restaurantId),
        eq(staffIncentivesTable.periodYear, year),
        eq(staffIncentivesTable.periodMonth, month),
      ));
    const existingByKey = new Map(existing.map((e) => [`${e.userId}:${e.ruleType}`, e]));

    for (const c of computed) {
      const key = `${c.userId}:${c.ruleType}`;
      const ex = existingByKey.get(key);
      const amount = c.amount.toFixed(2);
      if (!ex) {
        await tx.insert(staffIncentivesTable).values({
          restaurantId,
          userId: c.userId,
          periodYear: year,
          periodMonth: month,
          ruleType: c.ruleType,
          computedAmount: amount,
          status: "pending",
          breakdown: c.breakdown,
        });
        newPendingUserIds.push(c.userId);
      } else if (ex.status === "pending") {
        await tx
          .update(staffIncentivesTable)
          .set({ computedAmount: amount, breakdown: c.breakdown, updatedAt: new Date() })
          .where(eq(staffIncentivesTable.id, ex.id));
      }
      // approved/rejected rows are left untouched (frozen).
      existingByKey.delete(key);
    }
    // Any leftover pending rows that no longer compute > 0 → delete.
    for (const stale of existingByKey.values()) {
      if (stale.status === "pending") {
        await tx.delete(staffIncentivesTable).where(eq(staffIncentivesTable.id, stale.id));
      }
    }
  });

  // Notify owners of the restaurant that fresh incentives need approval.
  if (newPendingUserIds.length > 0) {
    try {
      const owners = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(
          eq(usersTable.restaurantId, restaurantId),
          eq(usersTable.role, "owner"),
          eq(usersTable.isActive, true),
        ));
      void pushToUserIds(owners.map((o) => o.id), "payroll", {
        title: "New incentives to review",
        body: `${newPendingUserIds.length} new staff incentive${newPendingUserIds.length === 1 ? "" : "s"} for ${year}-${String(month).padStart(2, "0")}.`,
        data: { kind: "staff_incentive_pending", periodYear: year, periodMonth: month },
      });
    } catch (err) {
      logger.warn({ err }, "incentive owner push failed");
    }
  }

  await audit(restaurantId, callerId, "recompute", "staff_incentive_period", null, { year, month, computed: computed.length }, req.ip);
  res.json({ ok: true, count: computed.length });
});

// ---------- Approve / reject / adjust a pending row (owner only) ----------
router.post("/restaurants/:restaurantId/staff-incentives/:id/decide", async (req, res) => {
  if (!isOwnerOrAdmin(req)) { res.status(403).json({ error: "Owner only" }); return; }
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const decision = String(req.body?.decision ?? "");
  if (decision !== "approve" && decision !== "reject") {
    res.status(400).json({ error: "decision must be 'approve' or 'reject'" });
    return;
  }
  const notes = req.body?.notes ? String(req.body.notes) : null;
  let approvedAmount: string | null = null;
  if (decision === "approve" && req.body?.approvedAmount !== undefined && req.body?.approvedAmount !== null && req.body?.approvedAmount !== "") {
    const n = Number(req.body.approvedAmount);
    if (!Number.isFinite(n) || n < 0) { res.status(400).json({ error: "Invalid approvedAmount" }); return; }
    approvedAmount = n.toFixed(2);
  }
  const callerId = req.user?.sub ?? null;

  const [row] = await db
    .select()
    .from(staffIncentivesTable)
    .where(and(eq(staffIncentivesTable.id, id), eq(staffIncentivesTable.restaurantId, restaurantId)))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.status !== "pending") {
    res.status(400).json({ error: `Already ${row.status}` });
    return;
  }

  const finalAmount = decision === "approve" ? (approvedAmount ?? row.computedAmount) : "0";
  const [updated] = await db
    .update(staffIncentivesTable)
    .set({
      status: decision === "approve" ? "approved" : "rejected",
      approvedAmount: decision === "approve" ? finalAmount : null,
      approverUserId: callerId,
      decidedAt: new Date(),
      notes,
      updatedAt: new Date(),
    })
    .where(eq(staffIncentivesTable.id, id))
    .returning();

  if (decision === "approve") {
    void pushToUserIds([row.userId], "payroll", {
      title: "Incentive approved",
      body: `₹${finalAmount} ${row.ruleType.replace(/_/g, " ")} for ${row.periodYear}-${String(row.periodMonth).padStart(2, "0")}.`,
      data: { kind: "staff_incentive_approved", incentiveId: id },
    });
  }
  await audit(restaurantId, callerId, decision, "staff_incentive", id, { approvedAmount: finalAmount, notes }, req.ip);
  res.json(updated);
});

// ---------- Bulk approve all pending for a period (owner only) ----------
router.post("/restaurants/:restaurantId/staff-incentives/approve-all", async (req, res) => {
  if (!isOwnerOrAdmin(req)) { res.status(403).json({ error: "Owner only" }); return; }
  const restaurantId = Number(req.params.restaurantId);
  const year = Number(req.body?.periodYear);
  const month = Number(req.body?.periodMonth);
  if (!isValidPeriod(year, month)) { res.status(400).json({ error: "Invalid year/month" }); return; }
  const callerId = req.user?.sub ?? null;

  const pending = await db
    .select()
    .from(staffIncentivesTable)
    .where(and(
      eq(staffIncentivesTable.restaurantId, restaurantId),
      eq(staffIncentivesTable.periodYear, year),
      eq(staffIncentivesTable.periodMonth, month),
      eq(staffIncentivesTable.status, "pending"),
    ));
  if (pending.length === 0) { res.json({ ok: true, approved: 0 }); return; }

  const updated = await db
    .update(staffIncentivesTable)
    .set({
      status: "approved",
      approvedAmount: sql`${staffIncentivesTable.computedAmount}`,
      approverUserId: callerId,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(staffIncentivesTable.restaurantId, restaurantId),
      eq(staffIncentivesTable.periodYear, year),
      eq(staffIncentivesTable.periodMonth, month),
      eq(staffIncentivesTable.status, "pending"),
    ))
    .returning();

  const userIds = Array.from(new Set(updated.map((u) => u.userId)));
  void pushToUserIds(userIds, "payroll", {
    title: "Incentive approved",
    body: `Your incentives for ${year}-${String(month).padStart(2, "0")} are approved.`,
    data: { kind: "staff_incentive_approved_bulk", periodYear: year, periodMonth: month },
  });
  await audit(restaurantId, callerId, "approve_all", "staff_incentive_period", null, { year, month, count: updated.length }, req.ip);
  res.json({ ok: true, approved: updated.length });
});

// ---------- Leaderboard for a period ----------
router.get("/restaurants/:restaurantId/staff-incentives/leaderboard", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!isValidPeriod(year, month)) { res.status(400).json({ error: "Invalid year/month" }); return; }

  const rows = await db
    .select({
      userId: staffIncentivesTable.userId,
      userName: usersTable.name,
      ruleType: staffIncentivesTable.ruleType,
      status: staffIncentivesTable.status,
      computedAmount: staffIncentivesTable.computedAmount,
      approvedAmount: staffIncentivesTable.approvedAmount,
    })
    .from(staffIncentivesTable)
    .innerJoin(usersTable, eq(usersTable.id, staffIncentivesTable.userId))
    .where(and(
      eq(staffIncentivesTable.restaurantId, restaurantId),
      eq(staffIncentivesTable.periodYear, year),
      eq(staffIncentivesTable.periodMonth, month),
    ));

  const byUser = new Map<number, {
    userId: number;
    userName: string;
    totalApproved: number;
    totalPending: number;
    breakdown: Record<string, number>;
  }>();
  for (const r of rows) {
    const cur = byUser.get(r.userId) ?? {
      userId: r.userId,
      userName: r.userName ?? `User #${r.userId}`,
      totalApproved: 0,
      totalPending: 0,
      breakdown: {},
    };
    const computed = Number(r.computedAmount) || 0;
    const approved = r.approvedAmount != null ? Number(r.approvedAmount) || 0 : 0;
    if (r.status === "approved") {
      cur.totalApproved += approved;
      cur.breakdown[r.ruleType] = (cur.breakdown[r.ruleType] ?? 0) + approved;
    } else if (r.status === "pending") {
      cur.totalPending += computed;
    }
    byUser.set(r.userId, cur);
  }
  const ranked = Array.from(byUser.values()).sort((a, b) =>
    (b.totalApproved + b.totalPending) - (a.totalApproved + a.totalPending),
  );
  res.json(ranked);
});

// ---------- CSV report ----------
router.get("/restaurants/:restaurantId/staff-incentives/report.csv", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!isValidPeriod(year, month)) { res.status(400).json({ error: "Invalid year/month" }); return; }

  const rows = await db
    .select({
      userName: usersTable.name,
      userId: staffIncentivesTable.userId,
      ruleType: staffIncentivesTable.ruleType,
      status: staffIncentivesTable.status,
      computedAmount: staffIncentivesTable.computedAmount,
      approvedAmount: staffIncentivesTable.approvedAmount,
      breakdown: staffIncentivesTable.breakdown,
      decidedAt: staffIncentivesTable.decidedAt,
      notes: staffIncentivesTable.notes,
    })
    .from(staffIncentivesTable)
    .innerJoin(usersTable, eq(usersTable.id, staffIncentivesTable.userId))
    .where(and(
      eq(staffIncentivesTable.restaurantId, restaurantId),
      eq(staffIncentivesTable.periodYear, year),
      eq(staffIncentivesTable.periodMonth, month),
    ))
    .orderBy(usersTable.name);

  function csvEscape(v: unknown): string {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }
  const header = ["Period", "Staff", "User ID", "Rule", "Status", "Computed", "Approved", "Decided At", "Notes", "Breakdown"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      `${year}-${String(month).padStart(2, "0")}`,
      r.userName ?? `User #${r.userId}`,
      r.userId,
      r.ruleType,
      r.status,
      r.computedAmount,
      r.approvedAmount ?? "",
      r.decidedAt ? new Date(r.decidedAt).toISOString() : "",
      r.notes ?? "",
      JSON.stringify(r.breakdown ?? {}),
    ].map(csvEscape).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="incentives-${year}-${String(month).padStart(2, "0")}.csv"`);
  res.send(lines.join("\n"));
});

export default router;
