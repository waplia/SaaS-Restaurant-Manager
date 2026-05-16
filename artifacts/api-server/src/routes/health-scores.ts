import { Router } from "express";
import { and, desc, eq, gte, ilike, sql } from "drizzle-orm";
import {
  db,
  restaurantsTable,
  tenantsTable,
  restaurantHealthScoresTable,
} from "../lib/db";
import { requireRole, requireSuperAdmin } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import {
  computeHealthScore,
  snapshotHealthScore,
  getLatest,
  listHistory,
  listOutlets,
  FACTOR_LABELS,
  DEFAULT_WEIGHTS,
} from "../lib/healthScore";
import { recordAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";

const router = Router();

// ─── Restaurant-facing endpoints ────────────────────────────────────
router.use(
  "/restaurants/:restaurantId/health-score",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);

router.get("/restaurants/:restaurantId/health-score", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  try {
    let snap = await getLatest(restaurantId);
    if (!snap) {
      // Compute on the fly so first-time users see a value.
      const live = await computeHealthScore(restaurantId);
      res.json({
        live: true,
        snapshotDate: new Date().toISOString(),
        overallScore: live.overall,
        band: live.band,
        subScores: live.subScores,
        weights: live.weights,
        inputs: live.inputs,
        suggestions: live.suggestions,
        factorLabels: FACTOR_LABELS,
      });
      return;
    }
    res.json({
      live: false,
      snapshotDate: snap.snapshotDate,
      overallScore: Number(snap.overallScore),
      band: snap.band,
      subScores: snap.subScores,
      weights: snap.weights,
      inputs: snap.inputs,
      suggestions: snap.suggestions,
      factorLabels: FACTOR_LABELS,
    });
  } catch (err) {
    logger.error({ err, restaurantId }, "[health-score] current failed");
    res.status(500).json({ error: "Failed to load health score" });
  }
});

router.get("/restaurants/:restaurantId/health-score/history", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const days = Math.min(365, Math.max(7, Number(req.query.days) || 90));
  try {
    const rows = await listHistory(restaurantId, days);
    res.json({
      days,
      data: rows.map(r => ({
        id: r.id,
        snapshotDate: r.snapshotDate,
        overallScore: Number(r.overallScore),
        band: r.band,
        subScores: r.subScores,
      })),
    });
  } catch (err) {
    logger.error({ err, restaurantId }, "[health-score] history failed");
    res.status(500).json({ error: "Failed to load health score history" });
  }
});

router.get("/restaurants/:restaurantId/health-score/outlets", async (req, res) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant" });
  try {
    const rows = await listOutlets(tenantId);
    res.json({ data: rows });
  } catch (err) {
    logger.error({ err }, "[health-score] outlets failed");
    res.status(500).json({ error: "Failed to load outlets" });
  }
});

router.post("/restaurants/:restaurantId/health-score/recalculate", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  try {
    const result = await snapshotHealthScore(restaurantId);
    await recordAuditLog({
      req,
      module: "health-score",
      action: "recalculate",
      entity: "restaurant",
      entityId: restaurantId,
      restaurantId,
      newValue: { overall: result.overall, band: result.band },
    }).catch(() => undefined);
    res.json({
      ok: true,
      snapshotDate: new Date().toISOString(),
      overallScore: result.overall,
      band: result.band,
      subScores: result.subScores,
      weights: result.weights,
      inputs: result.inputs,
      suggestions: result.suggestions,
      factorLabels: FACTOR_LABELS,
    });
  } catch (err) {
    logger.error({ err, restaurantId }, "[health-score] recalculate failed");
    res.status(500).json({ error: "Failed to recalculate health score" });
  }
});

// ─── Super-Admin: ranking across tenants ────────────────────────────
const adminRouter = Router();
adminRouter.use("/admin/health-scores", requireSuperAdmin);

adminRouter.get("/admin/health-scores", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 25));
  const search = (req.query.search as string | undefined)?.trim() || "";
  const band = (req.query.band as string | undefined)?.trim() || "";
  const sort = (req.query.sort as string | undefined) || "score_desc";

  try {
    // Latest snapshot per restaurant via DISTINCT ON
    const rows = await db.execute(sql`
      SELECT DISTINCT ON (h.restaurant_id)
        h.id, h.restaurant_id, h.tenant_id, h.snapshot_date,
        h.overall_score, h.band, h.sub_scores, h.suggestions,
        r.name AS restaurant_name,
        t.name AS tenant_name, t.slug AS tenant_slug
      FROM restaurant_health_scores h
      JOIN restaurants r ON r.id = h.restaurant_id
      JOIN tenants t ON t.id = h.tenant_id
      ORDER BY h.restaurant_id, h.snapshot_date DESC
    `);
    let data = rows.rows as Array<{
      id: number;
      restaurant_id: number;
      tenant_id: number;
      snapshot_date: string;
      overall_score: string;
      band: string;
      sub_scores: Record<string, number | null>;
      suggestions: Array<{ key: string; title: string; detail: string }>;
      restaurant_name: string;
      tenant_name: string;
      tenant_slug: string;
    }>;

    if (search) {
      const s = search.toLowerCase();
      data = data.filter(d =>
        d.restaurant_name.toLowerCase().includes(s) ||
        d.tenant_name.toLowerCase().includes(s) ||
        d.tenant_slug.toLowerCase().includes(s),
      );
    }
    if (band) data = data.filter(d => d.band === band);

    data.sort((a, b) => {
      const sa = Number(a.overall_score);
      const sb = Number(b.overall_score);
      if (sort === "score_asc") return sa - sb;
      if (sort === "name_asc") return a.restaurant_name.localeCompare(b.restaurant_name);
      return sb - sa;
    });

    const total = data.length;
    const slice = data.slice((page - 1) * pageSize, page * pageSize);

    res.json({
      page, pageSize, total,
      data: slice.map(r => ({
        id: r.id,
        restaurantId: r.restaurant_id,
        tenantId: r.tenant_id,
        restaurantName: r.restaurant_name,
        tenantName: r.tenant_name,
        tenantSlug: r.tenant_slug,
        snapshotDate: r.snapshot_date,
        overallScore: Number(r.overall_score),
        band: r.band,
        subScores: r.sub_scores,
        suggestions: r.suggestions,
      })),
      factorLabels: FACTOR_LABELS,
      weights: DEFAULT_WEIGHTS,
    });
  } catch (err) {
    logger.error({ err }, "[admin/health-scores] list failed");
    res.status(500).json({ error: "Failed to load health scores" });
  }
});

adminRouter.post("/admin/health-scores/recalculate-all", async (req, res) => {
  try {
    const restaurants = await db
      .select({ id: restaurantsTable.id })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.isActive, true));
    let ok = 0, failed = 0;
    for (const r of restaurants) {
      try { await snapshotHealthScore(r.id); ok += 1; } catch { failed += 1; }
    }
    await recordAuditLog({
      req,
      module: "health-score",
      action: "recalculate_all",
      entity: "system",
      newValue: { ok, failed, total: restaurants.length },
    }).catch(() => undefined);
    res.json({ ok: true, total: restaurants.length, succeeded: ok, failed });
  } catch (err) {
    logger.error({ err }, "[admin/health-scores] recalc-all failed");
    res.status(500).json({ error: "Failed to recalculate" });
  }
});

router.use(adminRouter);

export default router;
