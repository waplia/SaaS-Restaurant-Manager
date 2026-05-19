import { Router } from "express";
import { and, eq, gte, sql } from "drizzle-orm";
import {
  db,
  appSettingsTable,
  webPushSubscriptionsTable,
  webPushLogsTable,
  webPushTemplatesTable,
  tenantsTable,
  subscriptionPlansTable,
  restaurantsTable,
  WEB_PUSH_FEATURE_KEYS,
  WEB_PUSH_EVENT_KEYS,
} from "../lib/db";
import { requireSuperAdmin } from "../middleware/authorize";
import {
  encryptForStorage,
  decryptIfWrapped,
  testProvider,
  sendTestWebPush,
  getVapidPublicKey,
} from "../lib/webPush";
import { recordAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";

const router = Router();

// All endpoints require super-admin.
router.use(requireSuperAdmin);

const SECRET_KEYS = ["apiKey", "serverKey", "privateKey", "secret", "token", "authToken", "password"];
const isSecretKey = (k: string) => /token|secret|password|apikey|api_key|private|signing|authorization/i.test(k);

function maskValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v && "cipher" in (v as Record<string, unknown>)) {
    const plain = decryptIfWrapped(v) ?? "";
    if (!plain) return "";
    if (plain.length <= 6) return "•".repeat(plain.length);
    return `${plain.slice(0, 3)}••••${plain.slice(-3)}`;
  }
  const s = String(v);
  if (s.length === 0) return "";
  if (s.length <= 6) return "•".repeat(s.length);
  return `${s.slice(0, 3)}••••${s.slice(-3)}`;
}

function maskConfig(cfg: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!cfg || typeof cfg !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (isSecretKey(k)) out[k] = maskValue(v);
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = maskConfig(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

const MASK_RE = /^(\*{2,}|.{0,3}•{2,}.{0,3})$/;
function isMaskedValue(v: unknown): boolean {
  return typeof v === "string" && MASK_RE.test(v);
}

/** Merge an incoming config patch over the stored config, encrypting newly-set
 * secret fields and preserving stored secrets when the client echoes a mask
 * placeholder. */
function mergeAndEncryptConfig(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (isSecretKey(k)) {
      if (v === undefined || v === null || v === "" || isMaskedValue(v)) continue;
      base[k] = encryptForStorage(String(v));
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      base[k] = mergeAndEncryptConfig((base[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
    } else {
      base[k] = v;
    }
  }
  return base;
}

// ────────────────────────────────────────────────────────────
// GET /api/admin/web-push/provider
// Returns the current platform-wide provider config with secrets masked.
// ────────────────────────────────────────────────────────────
router.get("/api/admin/web-push/provider", async (_req, res) => {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
  // Ensure VAPID keys are generated so the public key surfaces immediately.
  const vapidPublicKey = await getVapidPublicKey().catch(() => null);
  res.json({
    provider: row?.webPushProvider ?? "vapid",
    fallbackProvider: row?.webPushFallbackProvider ?? null,
    globalEnabled: row?.webPushGlobalEnabled ?? true,
    vapid: {
      publicKey: vapidPublicKey,
      subject: row?.webPushSubject ?? null,
      privateKeyConfigured: !!row?.webPushPrivateKey,
    },
    fcm: maskConfig(row?.webPushFcmConfig as Record<string, unknown>),
    onesignal: maskConfig(row?.webPushOnesignalConfig as Record<string, unknown>),
    custom: maskConfig(row?.webPushCustomConfig as Record<string, unknown>),
    defaults: {
      iconUrl: row?.webPushDefaultIcon ?? null,
      badgeUrl: row?.webPushDefaultBadge ?? null,
      fallbackImageUrl: row?.webPushFallbackImage ?? null,
      defaultClickUrl: row?.webPushDefaultClickUrl ?? null,
    },
    planLimits: row?.webPushPlanLimits ?? {},
    tenantOverrides: row?.webPushTenantOverrides ?? {},
    knownFeatures: WEB_PUSH_FEATURE_KEYS,
    knownEvents: WEB_PUSH_EVENT_KEYS,
  });
});

// ────────────────────────────────────────────────────────────
// PUT /api/admin/web-push/provider
// Updates provider selection, secrets, defaults. Secret fields are encrypted
// at rest. Mask placeholders are preserved (no clobber).
// ────────────────────────────────────────────────────────────
router.put("/api/admin/web-push/provider", async (req, res) => {
  const body = req.body as {
    provider?: "vapid" | "fcm" | "onesignal" | "custom";
    fallbackProvider?: "vapid" | "fcm" | "onesignal" | "custom" | null;
    globalEnabled?: boolean;
    vapid?: { subject?: string; privateKey?: string; publicKey?: string };
    fcm?: Record<string, unknown>;
    onesignal?: Record<string, unknown>;
    custom?: Record<string, unknown>;
    defaults?: { iconUrl?: string | null; badgeUrl?: string | null; fallbackImageUrl?: string | null; defaultClickUrl?: string | null };
  };
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
  if (!row) return void res.status(404).json({ error: "App settings missing" });

  const patch: Record<string, unknown> = {};
  if (body.provider) patch.webPushProvider = body.provider;
  if (body.fallbackProvider !== undefined) patch.webPushFallbackProvider = body.fallbackProvider ?? null;
  if (body.globalEnabled !== undefined) patch.webPushGlobalEnabled = !!body.globalEnabled;
  if (body.vapid) {
    if (body.vapid.subject !== undefined) patch.webPushSubject = body.vapid.subject || null;
    // Allow super admin to rotate VAPID keys; we store them plaintext (same as auto-generated).
    if (body.vapid.publicKey && body.vapid.privateKey && !isMaskedValue(body.vapid.privateKey)) {
      patch.webPushPublicKey = body.vapid.publicKey;
      patch.webPushPrivateKey = body.vapid.privateKey;
    }
  }
  if (body.fcm) patch.webPushFcmConfig = mergeAndEncryptConfig(row.webPushFcmConfig ?? {}, body.fcm);
  if (body.onesignal) patch.webPushOnesignalConfig = mergeAndEncryptConfig(row.webPushOnesignalConfig ?? {}, body.onesignal);
  if (body.custom) patch.webPushCustomConfig = mergeAndEncryptConfig(row.webPushCustomConfig ?? {}, body.custom);
  if (body.defaults) {
    if (body.defaults.iconUrl !== undefined) patch.webPushDefaultIcon = body.defaults.iconUrl || null;
    if (body.defaults.badgeUrl !== undefined) patch.webPushDefaultBadge = body.defaults.badgeUrl || null;
    if (body.defaults.fallbackImageUrl !== undefined) patch.webPushFallbackImage = body.defaults.fallbackImageUrl || null;
    if (body.defaults.defaultClickUrl !== undefined) patch.webPushDefaultClickUrl = body.defaults.defaultClickUrl || null;
  }
  patch.updatedAt = new Date();

  await db.update(appSettingsTable).set(patch).where(eq(appSettingsTable.id, 1));
  await recordAuditLog({
    req, module: "web_push", action: "update_provider", entity: "app_settings", entityId: 1,
    details: { provider: body.provider, fallback: body.fallbackProvider, globalEnabled: body.globalEnabled },
  });
  res.json({ success: true });
});

// ────────────────────────────────────────────────────────────
// PUT /api/admin/web-push/plan-limits  { planLimits: Record<planId, limits> }
// ────────────────────────────────────────────────────────────
router.put("/api/admin/web-push/plan-limits", async (req, res) => {
  const { planLimits } = req.body as { planLimits?: Record<string, Record<string, unknown>> };
  if (!planLimits || typeof planLimits !== "object") return void res.status(400).json({ error: "planLimits required" });
  await db.update(appSettingsTable).set({ webPushPlanLimits: planLimits, updatedAt: new Date() }).where(eq(appSettingsTable.id, 1));
  await recordAuditLog({ req, module: "web_push", action: "update_plan_limits", entity: "app_settings", entityId: 1, newValue: planLimits });
  res.json({ success: true });
});

// ────────────────────────────────────────────────────────────
// PUT /api/admin/web-push/tenant-override/:tenantId
// Set or clear (DELETE) per-tenant overrides.
// ────────────────────────────────────────────────────────────
router.put("/api/admin/web-push/tenant-override/:tenantId", async (req, res) => {
  const tenantId = Number(req.params.tenantId);
  if (!tenantId) return void res.status(400).json({ error: "Invalid tenantId" });
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
  const overrides = { ...(row?.webPushTenantOverrides ?? {}) } as Record<string, Record<string, unknown>>;
  overrides[String(tenantId)] = { ...(req.body ?? {}), setAt: new Date().toISOString() };
  await db.update(appSettingsTable).set({ webPushTenantOverrides: overrides }).where(eq(appSettingsTable.id, 1));
  await recordAuditLog({ req, module: "web_push", action: "tenant_override_set", entity: "tenant", entityId: tenantId, newValue: overrides[String(tenantId)] });
  res.json({ success: true });
});

router.delete("/api/admin/web-push/tenant-override/:tenantId", async (req, res) => {
  const tenantId = Number(req.params.tenantId);
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
  const overrides = { ...(row?.webPushTenantOverrides ?? {}) } as Record<string, Record<string, unknown>>;
  delete overrides[String(tenantId)];
  await db.update(appSettingsTable).set({ webPushTenantOverrides: overrides }).where(eq(appSettingsTable.id, 1));
  await recordAuditLog({ req, module: "web_push", action: "tenant_override_clear", entity: "tenant", entityId: tenantId });
  res.json({ success: true });
});

// ────────────────────────────────────────────────────────────
// GET /api/admin/web-push/plans  — list of plans for the limits matrix UI.
// ────────────────────────────────────────────────────────────
router.get("/api/admin/web-push/plans", async (_req, res) => {
  const plans = await db.select({ id: subscriptionPlansTable.id, name: subscriptionPlansTable.name }).from(subscriptionPlansTable);
  res.json(plans);
});

// ────────────────────────────────────────────────────────────
// POST /api/admin/web-push/test  — provider smoke test.
// ────────────────────────────────────────────────────────────
router.post("/api/admin/web-push/test", async (req, res) => {
  const { endpoint, title, body } = req.body as { endpoint?: string; title?: string; body?: string };
  if (endpoint) {
    const r = await sendTestWebPush(endpoint, { title: title ?? "Test push", body: body ?? "If you can read this, push delivery is working." });
    return void res.json(r);
  }
  const r = await testProvider();
  res.json(r);
});

// ────────────────────────────────────────────────────────────
// GET /api/admin/web-push/stats  — platform reports.
// ────────────────────────────────────────────────────────────
router.get("/api/admin/web-push/stats", async (req, res) => {
  const days = Math.max(1, Math.min(90, Number(req.query.days ?? 30)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  try {
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(webPushSubscriptionsTable);
    const [{ active }] = await db.select({ active: sql<number>`count(*)::int` }).from(webPushSubscriptionsTable).where(eq(webPushSubscriptionsTable.status, "active"));
    const [{ sent }] = await db.select({ sent: sql<number>`count(*)::int` }).from(webPushLogsTable)
      .where(and(eq(webPushLogsTable.status, "sent"), gte(webPushLogsTable.createdAt, since)));
    const [{ failed }] = await db.select({ failed: sql<number>`count(*)::int` }).from(webPushLogsTable)
      .where(and(eq(webPushLogsTable.status, "failed"), gte(webPushLogsTable.createdAt, since)));
    const byTenant = await db.execute(sql`
      SELECT t.id, t.name, COUNT(l.id)::int as sent
      FROM ${tenantsTable} t
      LEFT JOIN ${webPushLogsTable} l ON l.tenant_id = t.id AND l.status = 'sent' AND l.created_at >= ${since}
      GROUP BY t.id, t.name ORDER BY sent DESC LIMIT 20
    `);
    res.json({ totals: { subscriptions: total, active, sent, failed }, byTenant: byTenant.rows });
  } catch (err) {
    logger.error({ err }, "web push stats failed");
    res.json({ totals: { subscriptions: 0, active: 0, sent: 0, failed: 0 }, byTenant: [] });
  }
});

// ────────────────────────────────────────────────────────────
// Platform-level (NULL restaurantId) default templates
// ────────────────────────────────────────────────────────────
router.get("/api/admin/web-push/templates", async (_req, res) => {
  const rows = await db.select().from(webPushTemplatesTable).where(sql`${webPushTemplatesTable.restaurantId} IS NULL`);
  res.json(rows);
});

router.post("/api/admin/web-push/templates", async (req, res) => {
  const { eventKey, name, title, body, iconUrl, imageUrl, clickUrl, variables } = req.body ?? {};
  if (!eventKey || !name || !title || !body) return void res.status(400).json({ error: "eventKey, name, title, body required" });
  const [row] = await db.insert(webPushTemplatesTable).values({
    restaurantId: null, eventKey, name, title, body,
    iconUrl: iconUrl ?? null, imageUrl: imageUrl ?? null, clickUrl: clickUrl ?? null,
    variables: Array.isArray(variables) ? variables : [],
    createdBy: (req.user as { sub?: number } | undefined)?.sub ?? null,
  }).returning();
  await recordAuditLog({ req, module: "web_push", action: "create_template", entity: "web_push_template", entityId: row.id, newValue: { eventKey, name } });
  res.json(row);
});

router.delete("/api/admin/web-push/templates/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(webPushTemplatesTable).where(and(eq(webPushTemplatesTable.id, id), sql`${webPushTemplatesTable.restaurantId} IS NULL`));
  await recordAuditLog({ req, module: "web_push", action: "delete_template", entity: "web_push_template", entityId: id });
  res.json({ success: true });
});

export default router;
