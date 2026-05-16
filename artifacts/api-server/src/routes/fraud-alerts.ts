import { Router } from "express";
import { eq, and, desc, sql, gte, lte, type SQL, ne } from "drizzle-orm";
import {
  db,
  fraudAlertsTable,
  fraudDetectorSettingsTable,
  usersTable,
  auditLogsTable,
  FRAUD_DETECTORS,
  FRAUD_DETECTOR_DEFAULTS,
  type FraudDetector,
} from "../lib/db";
import { z } from "zod/v4";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { runDetectorsForRestaurant, ensureDefaultDetectorSettings } from "../lib/fraudDetection";

const router = Router();

const SELECT_COLS = {
  id: fraudAlertsTable.id,
  restaurantId: fraudAlertsTable.restaurantId,
  detector: fraudAlertsTable.detector,
  severity: fraudAlertsTable.severity,
  status: fraudAlertsTable.status,
  subjectUserId: fraudAlertsTable.subjectUserId,
  subjectRole: fraudAlertsTable.subjectRole,
  entityType: fraudAlertsTable.entityType,
  entityId: fraudAlertsTable.entityId,
  windowStart: fraudAlertsTable.windowStart,
  windowEnd: fraudAlertsTable.windowEnd,
  score: fraudAlertsTable.score,
  threshold: fraudAlertsTable.threshold,
  observedValue: fraudAlertsTable.observedValue,
  evidence: fraudAlertsTable.evidence,
  aiSummary: fraudAlertsTable.aiSummary,
  aiSummaryFallback: fraudAlertsTable.aiSummaryFallback,
  reviewedByUserId: fraudAlertsTable.reviewedByUserId,
  reviewedAt: fraudAlertsTable.reviewedAt,
  reviewNotes: fraudAlertsTable.reviewNotes,
  createdAt: fraudAlertsTable.createdAt,
  updatedAt: fraudAlertsTable.updatedAt,
};

router.get(
  "/restaurants/:restaurantId/fraud-alerts",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const conds: SQL[] = [eq(fraudAlertsTable.restaurantId, restaurantId)];
    if (req.query.detector) conds.push(eq(fraudAlertsTable.detector, String(req.query.detector)));
    if (req.query.status) conds.push(eq(fraudAlertsTable.status, String(req.query.status)));
    if (req.query.severity) conds.push(eq(fraudAlertsTable.severity, String(req.query.severity)));
    if (req.query.dateFrom) {
      const d = new Date(String(req.query.dateFrom));
      if (!Number.isNaN(d.getTime())) conds.push(gte(fraudAlertsTable.createdAt, d));
    }
    if (req.query.dateTo) {
      const d = new Date(String(req.query.dateTo));
      if (!Number.isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); conds.push(lte(fraudAlertsTable.createdAt, d)); }
    }
    // Staff can never see alerts about themselves; here only owner/manager/super_admin reach this route,
    // but enforce explicitly: a manager cannot see alerts where they are the subject.
    const me = (req as { user?: { id: number; role: string } }).user;
    if (me && me.role !== "super_admin" && me.role !== "owner") {
      conds.push(ne(fraudAlertsTable.subjectUserId, me.id));
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * limit;
    const where = and(...conds);
    const [rows, totalRow] = await Promise.all([
      db.select(SELECT_COLS).from(fraudAlertsTable).where(where)
        .orderBy(desc(fraudAlertsTable.createdAt)).limit(limit).offset(offset),
      db.select({ c: sql<number>`cast(count(*) as int)` }).from(fraudAlertsTable).where(where),
    ]);
    res.json({ data: rows, total: totalRow[0]?.c ?? 0, page, limit });
  },
);

router.get(
  "/restaurants/:restaurantId/fraud-alerts/:id",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const [row] = await db.select(SELECT_COLS).from(fraudAlertsTable)
      .where(and(eq(fraudAlertsTable.id, id), eq(fraudAlertsTable.restaurantId, restaurantId)));
    if (!row) return void res.status(404).json({ error: "Not found" });
    const me = (req as { user?: { id: number; role: string } }).user;
    if (me && me.role !== "super_admin" && me.role !== "owner" && row.subjectUserId === me.id) {
      return void res.status(403).json({ error: "Cannot view alert about yourself" });
    }
    let subjectName: string | null = null;
    if (row.subjectUserId) {
      const [u] = await db.select({ name: usersTable.name, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.id, row.subjectUserId));
      subjectName = u?.name ?? u?.email ?? null;
    }
    res.json({ ...row, subjectName });
  },
);

const updateStatusSchema = z.object({
  status: z.enum(["open", "acknowledged", "resolved", "false_positive"]),
  reviewNotes: z.string().max(2000).optional(),
});

router.patch(
  "/restaurants/:restaurantId/fraud-alerts/:id",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    const me = (req as { user?: { id: number; role: string } }).user;

    const [existing] = await db.select().from(fraudAlertsTable)
      .where(and(eq(fraudAlertsTable.id, id), eq(fraudAlertsTable.restaurantId, restaurantId)));
    if (!existing) return void res.status(404).json({ error: "Not found" });
    if (me && me.role !== "super_admin" && me.role !== "owner" && existing.subjectUserId === me.id) {
      return void res.status(403).json({ error: "Cannot update alert about yourself" });
    }

    const [updated] = await db.update(fraudAlertsTable).set({
      status: parsed.data.status,
      reviewNotes: parsed.data.reviewNotes ?? existing.reviewNotes,
      reviewedByUserId: me?.id ?? null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(fraudAlertsTable.id, id)).returning();

    await db.insert(auditLogsTable).values({
      restaurantId,
      userId: me?.id ?? null,
      module: "fraud",
      action: "alert_status_changed",
      entity: "fraud_alert",
      entityId: id,
      details: JSON.stringify({ from: existing.status, to: parsed.data.status }),
      oldValue: { status: existing.status, reviewNotes: existing.reviewNotes },
      newValue: { status: parsed.data.status, reviewNotes: parsed.data.reviewNotes ?? existing.reviewNotes },
    });

    res.json(updated);
  },
);

// Manual trigger for a detection run (owner/super_admin only)
router.post(
  "/restaurants/:restaurantId/fraud-alerts/run",
  requireRole("owner", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const me = (req as { user?: { id: number; role: string } }).user;
    const group = (req.body?.group as "fast" | "slow" | "all") ?? "all";
    const result = await runDetectorsForRestaurant(restaurantId, group, me?.id ?? null);
    await db.insert(auditLogsTable).values({
      restaurantId,
      userId: me?.id ?? null,
      module: "fraud",
      action: "manual_run",
      entity: "fraud_engine",
      details: JSON.stringify({ ...result, group }),
    });
    res.json(result);
  },
);

// Settings
router.get(
  "/restaurants/:restaurantId/fraud-settings",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    await ensureDefaultDetectorSettings(restaurantId);
    const rows = await db.select().from(fraudDetectorSettingsTable)
      .where(eq(fraudDetectorSettingsTable.restaurantId, restaurantId));
    const detectors = FRAUD_DETECTORS.map(d => {
      const row = rows.find(r => r.detector === d);
      const def = FRAUD_DETECTOR_DEFAULTS[d];
      return {
        detector: d,
        isEnabled: row?.isEnabled ?? true,
        threshold: row?.threshold != null ? Number(row.threshold) : Number(def.threshold),
        config: { ...def.config, ...(row?.config ?? {}) },
        defaultThreshold: Number(def.threshold),
      };
    });
    res.json({ detectors });
  },
);

const settingSchema = z.object({
  detector: z.enum(FRAUD_DETECTORS),
  isEnabled: z.boolean().optional(),
  threshold: z.number().nonnegative().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

router.patch(
  "/restaurants/:restaurantId/fraud-settings",
  requireRole("owner", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const parsed = settingSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    const me = (req as { user?: { id: number; role: string } }).user;
    const det = parsed.data.detector as FraudDetector;
    const def = FRAUD_DETECTOR_DEFAULTS[det];

    const [existing] = await db.select().from(fraudDetectorSettingsTable)
      .where(and(
        eq(fraudDetectorSettingsTable.restaurantId, restaurantId),
        eq(fraudDetectorSettingsTable.detector, det),
      ));

    const next = {
      isEnabled: parsed.data.isEnabled ?? existing?.isEnabled ?? true,
      threshold: (parsed.data.threshold ?? (existing?.threshold != null ? Number(existing.threshold) : Number(def.threshold))).toString(),
      config: { ...def.config, ...(existing?.config ?? {}), ...(parsed.data.config ?? {}) },
    };

    if (existing) {
      await db.update(fraudDetectorSettingsTable).set({
        isEnabled: next.isEnabled,
        threshold: next.threshold,
        config: next.config,
        updatedAt: new Date(),
      }).where(eq(fraudDetectorSettingsTable.id, existing.id));
    } else {
      await db.insert(fraudDetectorSettingsTable).values({
        restaurantId,
        detector: det,
        isEnabled: next.isEnabled,
        threshold: next.threshold,
        config: next.config,
      });
    }

    await db.insert(auditLogsTable).values({
      restaurantId,
      userId: me?.id ?? null,
      module: "fraud",
      action: "settings_updated",
      entity: "fraud_detector_setting",
      details: JSON.stringify({ detector: det, ...next }),
      oldValue: existing ? { isEnabled: existing.isEnabled, threshold: existing.threshold, config: existing.config } : null,
      newValue: next,
    });

    res.json({ ok: true, detector: det, ...next, threshold: Number(next.threshold) });
  },
);

export default router;
