/**
 * Smart P&L Dashboard routes (Task #146).
 *
 * GET    /restaurants/:id/pnl                — full breakdown for a date range
 * GET    /restaurants/:id/pnl/categories     — share-of-sales by category
 * GET    /restaurants/:id/pnl/leaks          — profit leak detector
 * GET    /restaurants/:id/pnl/monthly        — 6-month rolling comparison
 * GET    /restaurants/:id/pnl/settings       — per-restaurant config
 * PUT    /restaurants/:id/pnl/settings       — update config
 * GET    /tenants/:tid/pnl/outlets           — one row per outlet (tenant-wide)
 *
 * All routes are gated on the `smart_pnl` plan flag and require an
 * owner / manager / super_admin role.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  restaurantsTable,
  pnlSettingsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { recordAuditLog } from "../lib/audit";
import {
  computePnl,
  computeCategoryShare,
  detectLeaks,
  monthlyComparison,
  ensurePnlSettings,
  type PnlRange,
} from "../lib/pnl";

const router = Router();

router.use(
  "/restaurants/:restaurantId/pnl",
  requireRole("owner", "manager", "accountant", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("smart_pnl"),
);

router.use(
  "/tenants/:tenantId/pnl",
  requireRole("owner", "manager", "accountant", "super_admin"),
  requirePlanFeature("smart_pnl"),
);

// ───────── helpers ─────────

function parseRange(req: Request): PnlRange | { error: string } {
  const { from, to } = req.query;
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(String(from)) && /^\d{4}-\d{2}-\d{2}$/.test(String(to))) {
    const f = new Date(`${from}T00:00:00`);
    const t = new Date(`${to}T00:00:00`);
    if (!Number.isNaN(f.getTime()) && !Number.isNaN(t.getTime()) && f <= t) {
      return { from: f, to: t };
    }
    return { error: "from/to must be valid YYYY-MM-DD with from <= to" };
  }
  // Default: this calendar month so the dashboard has something to show.
  const now = new Date();
  const f = new Date(now.getFullYear(), now.getMonth(), 1);
  const t = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: f, to: t };
}

// ───────── single-outlet endpoints ─────────

router.get("/restaurants/:restaurantId/pnl", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const r = parseRange(req);
  if ("error" in r) return void res.status(400).json({ error: r.error });
  const pnl = await computePnl(restaurantId, r);
  res.json({ from: r.from.toISOString().slice(0, 10), to: r.to.toISOString().slice(0, 10), ...pnl });
});

router.get("/restaurants/:restaurantId/pnl/categories", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const r = parseRange(req);
  if ("error" in r) return void res.status(400).json({ error: r.error });
  const pnl = await computePnl(restaurantId, r);
  const cats = await computeCategoryShare(restaurantId, r, pnl);
  res.json({ categories: cats });
});

router.get("/restaurants/:restaurantId/pnl/leaks", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const r = parseRange(req);
  if ("error" in r) return void res.status(400).json({ error: r.error });
  const settings = await ensurePnlSettings(restaurantId);
  const leaks = await detectLeaks(restaurantId, r, Number(settings.leakThresholdPct));
  res.json({ thresholdPct: Number(settings.leakThresholdPct), leaks });
});

router.get("/restaurants/:restaurantId/pnl/monthly", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const months = Math.min(12, Math.max(2, Number(req.query.months) || 6));
  const ref = req.query.to && /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to))
    ? new Date(`${req.query.to}T00:00:00`)
    : new Date();
  const series = await monthlyComparison(restaurantId, ref, months);
  res.json({ months: series });
});

router.get("/restaurants/:restaurantId/pnl/settings", async (req, res) => {
  const s = await ensurePnlSettings(Number(req.params.restaurantId));
  res.json(s);
});

router.put("/restaurants/:restaurantId/pnl/settings", async (req, res) => {
  if (req.user?.role !== "owner" && !req.user?.isSuperAdmin) {
    return void res.status(403).json({ error: "Only owners can change P&L settings" });
  }
  const restaurantId = Number(req.params.restaurantId);
  const { approvalThreshold, fixedCostBaseline, leakThresholdPct } = req.body ?? {};
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (approvalThreshold !== undefined) {
    const n = Number(approvalThreshold);
    if (!Number.isFinite(n) || n < 0) return void res.status(400).json({ error: "approvalThreshold must be >= 0" });
    updates.approvalThreshold = String(n);
  }
  if (fixedCostBaseline !== undefined) {
    const n = Number(fixedCostBaseline);
    if (!Number.isFinite(n) || n < 0) return void res.status(400).json({ error: "fixedCostBaseline must be >= 0" });
    updates.fixedCostBaseline = String(n);
  }
  if (leakThresholdPct !== undefined) {
    const n = Number(leakThresholdPct);
    if (!Number.isFinite(n) || n < 0 || n > 100) return void res.status(400).json({ error: "leakThresholdPct must be 0-100" });
    updates.leakThresholdPct = String(n);
  }
  await ensurePnlSettings(restaurantId);
  const [updated] = await db.update(pnlSettingsTable).set(updates)
    .where(eq(pnlSettingsTable.restaurantId, restaurantId)).returning();
  await recordAuditLog({
    req, module: "pnl", action: "settings.update", entity: "pnl_settings",
    entityId: updated.id, targetRestaurantId: restaurantId, newValue: updates,
  });
  res.json(updated);
});

// ───────── tenant-wide outlet table ─────────
//
// Returns one P&L row per restaurant the caller can see. Used by the
// "outlet-wise" tab on the dashboard.

type AuthedReq = Request & { restaurantIds?: number[] };

async function loadTenantRestaurants(req: AuthedReq, res: Response, next: NextFunction): Promise<void> {
  const tenantId = Number(req.params.tenantId);
  if (!tenantId || Number.isNaN(tenantId)) {
    res.status(400).json({ error: "Invalid tenantId" });
    return;
  }
  if (!req.user!.isSuperAdmin && req.user!.tenantId !== tenantId) {
    res.status(403).json({ error: "Access denied: cross-tenant request" });
    return;
  }
  const rows = await db
    .select({ id: restaurantsTable.id })
    .from(restaurantsTable)
    .where(and(eq(restaurantsTable.tenantId, tenantId), eq(restaurantsTable.isActive, true)));
  let ids = rows.map(r => r.id);
  if (!req.user!.isSuperAdmin && req.user!.restaurantId && req.user!.role !== "owner") {
    ids = ids.filter(id => id === req.user!.restaurantId);
  }
  req.restaurantIds = ids;
  next();
}

router.get("/tenants/:tenantId/pnl/outlets", loadTenantRestaurants, async (req: AuthedReq, res) => {
  const r = parseRange(req);
  if ("error" in r) return void res.status(400).json({ error: r.error });
  const ids = req.restaurantIds ?? [];
  if (ids.length === 0) return void res.json({ outlets: [] });
  const meta = await db
    .select({ id: restaurantsTable.id, name: restaurantsTable.name, city: restaurantsTable.city })
    .from(restaurantsTable);
  const metaById = new Map(meta.map(m => [m.id, m]));
  const outlets = await Promise.all(
    ids.map(async id => {
      const pnl = await computePnl(id, r);
      const m = metaById.get(id);
      return {
        restaurantId: id,
        name: m?.name ?? `Restaurant ${id}`,
        city: m?.city ?? null,
        ...pnl,
      };
    }),
  );
  outlets.sort((a, b) => b.netProfit - a.netProfit);
  res.json({
    from: r.from.toISOString().slice(0, 10),
    to: r.to.toISOString().slice(0, 10),
    outlets,
  });
});

export default router;
