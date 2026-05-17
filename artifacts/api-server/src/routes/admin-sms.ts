import { Router } from "express";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  smsProvidersTable,
  smsTemplatesTable,
  smsLogsTable,
  subscriptionPlansTable,
  tenantsTable,
  auditLogsTable,
  SMS_TEMPLATE_EVENT_KEYS,
  type SmsProviderType,
  type SmsTemplateEventKey,
} from "../lib/db";
import { requireSuperAdmin } from "../middleware/authorize";
import {
  sendSmsMessage,
  retryFailedLog,
  getTenantMonthlyLimit,
  getTenantMonthlyUsage,
  sweepQuotaAlerts,
} from "../lib/smsSender";

const router = Router();

const VALID_PROVIDERS: SmsProviderType[] = ["twilio", "msg91", "textlocal", "fast2sms", "gupshup", "custom"];

// Keys that must never leak in GET responses (mask everything that looks like
// a credential, token, secret, key, password, signing key, etc).
const SECRET_KEY_PATTERN = /(token|secret|password|apikey|api_key|auth|signature|signing|private|sender_?id_password|sid_?token)/i;
function maskSecret(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  if (s.length === 0) return "";
  if (s.length <= 4) return "****";
  return `${s.slice(0, 2)}••••${s.slice(-2)}`;
}
function maskProviderConfig(config: unknown): unknown {
  if (!config || typeof config !== "object" || Array.isArray(config)) return config ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(k)) {
      out[k] = maskSecret(v);
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = maskProviderConfig(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
function maskProviderRow<T extends { config?: unknown }>(row: T): T {
  return { ...row, config: maskProviderConfig(row.config) } as T;
}
// Detects a value that was produced by maskSecret() — admins editing a
// provider through the UI receive masked placeholders for secrets, and we
// must NOT round-trip those back into the DB and clobber the real key.
const MASK_PATTERN = /^(\*{2,}|.{0,2}•{2,}.{0,2})$/;
function isMaskedValue(v: unknown): boolean {
  return typeof v === "string" && MASK_PATTERN.test(v);
}
// Merge an incoming `config` patch onto the existing stored config:
// - For any secret-looking key whose incoming value is a mask placeholder
//   (or empty string when an existing real value is present), keep the
//   stored value.
// - Otherwise, take the incoming value.
function mergeProviderConfig(existing: unknown, incoming: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = existing && typeof existing === "object" && !Array.isArray(existing)
    ? { ...(existing as Record<string, unknown>) } : {};
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return base;
  for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
    const isSecret = SECRET_KEY_PATTERN.test(k);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      base[k] = mergeProviderConfig(base[k], v);
      continue;
    }
    if (isSecret) {
      // Preserve the stored secret when the client echoes back a mask
      // placeholder, an empty string, or null — these all mean "no
      // change" in the edit UI.
      if (isMaskedValue(v) || v === "" || v === null || v === undefined) continue;
    }
    base[k] = v;
  }
  return base;
}

function audit(userId: number | null | undefined, action: string, entity: string, entityId: number | null, meta?: Record<string, unknown>) {
  return db.insert(auditLogsTable).values({
    userId: userId ?? null,
    action,
    entity,
    entityId,
    details: meta ? JSON.stringify(meta).slice(0, 4000) : null,
  }).catch(() => { /* audit best-effort */ });
}

// ───────── Providers ─────────
router.get("/admin/sms/providers", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select().from(smsProvidersTable).orderBy(desc(smsProvidersTable.isDefault), smsProvidersTable.id);
  res.json(rows.map(maskProviderRow));
});

router.post("/admin/sms/providers", requireSuperAdmin, async (req, res) => {
  const { type, name, isEnabled = true, isDefault = false, config = {} } = req.body ?? {};
  if (!VALID_PROVIDERS.includes(type)) {
    res.status(400).json({ error: `type must be one of ${VALID_PROVIDERS.join(", ")}` });
    return;
  }
  if (!name || typeof name !== "string") { res.status(400).json({ error: "name is required" }); return; }
  if (isDefault) {
    await db.update(smsProvidersTable).set({ isDefault: false }).where(eq(smsProvidersTable.isDefault, true));
  }
  const [row] = await db.insert(smsProvidersTable).values({
    type, name, isEnabled, isDefault, config, createdBy: req.user?.id ?? null,
  }).returning();
  await audit(req.user?.id, "sms.provider.created", "sms_provider", row.id, { type, name });
  res.status(201).json(maskProviderRow(row));
});

router.patch("/admin/sms/providers/:id", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, isEnabled, isDefault, config } = req.body ?? {};
  if (isDefault === true) {
    await db.update(smsProvidersTable).set({ isDefault: false }).where(eq(smsProvidersTable.isDefault, true));
  }
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof name === "string") update.name = name;
  if (typeof isEnabled === "boolean") update.isEnabled = isEnabled;
  if (typeof isDefault === "boolean") update.isDefault = isDefault;
  if (config && typeof config === "object") {
    // Merge against stored config so masked secrets echoed back by the UI
    // don't overwrite the real credentials in the DB.
    const [existing] = await db.select({ config: smsProvidersTable.config })
      .from(smsProvidersTable).where(eq(smsProvidersTable.id, id));
    update.config = mergeProviderConfig(existing?.config, config);
  }
  const [row] = await db.update(smsProvidersTable).set(update).where(eq(smsProvidersTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await audit(req.user?.id, "sms.provider.updated", "sms_provider", id, { fields: Object.keys(update) });
  res.json(maskProviderRow(row));
});

router.delete("/admin/sms/providers/:id", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(smsProvidersTable).where(eq(smsProvidersTable.id, id));
  await audit(req.user?.id, "sms.provider.deleted", "sms_provider", id);
  res.json({ ok: true });
});

router.post("/admin/sms/providers/:id/test", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { to, message } = req.body ?? {};
  if (!to || typeof to !== "string") { res.status(400).json({ error: "to (phone) required" }); return; }
  const result = await sendSmsMessage({
    to,
    body: typeof message === "string" && message.length > 0 ? message : "Khana Lagao SMS test from super-admin console.",
    providerId: id,
    bypassQuota: true,
  });
  await audit(req.user?.id, "sms.provider.tested", "sms_provider", id, { ok: result.ok, status: result.status });
  res.status(result.ok ? 200 : 502).json(result);
});

// ───────── Templates ─────────
router.get("/admin/sms/templates", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select().from(smsTemplatesTable).orderBy(smsTemplatesTable.eventKey);
  res.json({ templates: rows, eventKeys: SMS_TEMPLATE_EVENT_KEYS });
});

router.post("/admin/sms/templates", requireSuperAdmin, async (req, res) => {
  const { eventKey, name, body, variables = [], dltTemplateId, category = "transactional", isActive = true } = req.body ?? {};
  if (!SMS_TEMPLATE_EVENT_KEYS.includes(eventKey)) {
    res.status(400).json({ error: `eventKey must be one of ${SMS_TEMPLATE_EVENT_KEYS.join(", ")}` });
    return;
  }
  if (!name || !body) { res.status(400).json({ error: "name and body are required" }); return; }
  const [row] = await db.insert(smsTemplatesTable).values({
    eventKey: eventKey as SmsTemplateEventKey,
    name, body,
    variables: Array.isArray(variables) ? variables.map(String) : [],
    dltTemplateId: dltTemplateId ?? null,
    category, isActive,
    createdBy: req.user?.id ?? null,
  }).returning();
  await audit(req.user?.id, "sms.template.created", "sms_template", row.id, { eventKey });
  res.status(201).json(row);
});

router.patch("/admin/sms/templates/:id", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { name, body, variables, dltTemplateId, category, isActive } = req.body ?? {};
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof name === "string") update.name = name;
  if (typeof body === "string") update.body = body;
  if (Array.isArray(variables)) update.variables = variables.map(String);
  if (dltTemplateId !== undefined) update.dltTemplateId = dltTemplateId || null;
  if (typeof category === "string") update.category = category;
  if (typeof isActive === "boolean") update.isActive = isActive;
  const [row] = await db.update(smsTemplatesTable).set(update).where(eq(smsTemplatesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await audit(req.user?.id, "sms.template.updated", "sms_template", id, { fields: Object.keys(update) });
  res.json(row);
});

router.delete("/admin/sms/templates/:id", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(smsTemplatesTable).where(eq(smsTemplatesTable.id, id));
  await audit(req.user?.id, "sms.template.deleted", "sms_template", id);
  res.json({ ok: true });
});

// ───────── Logs ─────────
router.get("/admin/sms/logs", requireSuperAdmin, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const tenantId = Number(req.query.tenantId);
  const restaurantId = Number(req.query.restaurantId);
  const eventKey = typeof req.query.eventKey === "string" ? req.query.eventKey : undefined;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const conds = [] as ReturnType<typeof eq>[];
  if (status) conds.push(eq(smsLogsTable.status, status as never));
  if (Number.isFinite(tenantId)) conds.push(eq(smsLogsTable.tenantId, tenantId));
  if (Number.isFinite(restaurantId)) conds.push(eq(smsLogsTable.restaurantId, restaurantId));
  if (eventKey) conds.push(eq(smsLogsTable.eventKey, eventKey as never));

  const where = conds.length > 0 ? and(...conds) : undefined;
  const [rows, totalRow] = await Promise.all([
    db.select().from(smsLogsTable).where(where).orderBy(desc(smsLogsTable.createdAt)).limit(limit).offset(offset),
    db.select({ c: sql<number>`count(*)::int` }).from(smsLogsTable).where(where),
  ]);
  res.json({ rows, total: Number(totalRow[0]?.c ?? 0) });
});

router.post("/admin/sms/logs/:id/retry", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const result = await retryFailedLog(id);
  await audit(req.user?.id, "sms.log.retried", "sms_log", id, { ok: result.ok, status: result.status });
  res.status(result.ok ? 200 : 400).json(result);
});

// ───────── Limits / usage ─────────
router.patch("/admin/sms/plans/:id/limit", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const limit = Number(req.body?.smsMonthlyLimit);
  if (!Number.isInteger(limit) || limit < 0) { res.status(400).json({ error: "smsMonthlyLimit must be a non-negative integer" }); return; }
  const [row] = await db.update(subscriptionPlansTable)
    .set({ smsMonthlyLimit: limit, updatedAt: new Date() })
    .where(eq(subscriptionPlansTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Plan not found" }); return; }
  await audit(req.user?.id, "sms.plan_limit.updated", "subscription_plan", id, { smsMonthlyLimit: limit });
  res.json(row);
});

router.patch("/admin/sms/tenants/:id/limit", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const raw = req.body?.smsMonthlyLimit;
  const limit = raw === null || raw === "" ? null : Number(raw);
  if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
    res.status(400).json({ error: "smsMonthlyLimit must be a non-negative integer or null" });
    return;
  }
  const [row] = await db.update(tenantsTable)
    .set({ smsMonthlyLimit: limit, updatedAt: new Date() })
    .where(eq(tenantsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Tenant not found" }); return; }
  await audit(req.user?.id, "sms.tenant_limit.updated", "tenant", id, { smsMonthlyLimit: limit });
  res.json(row);
});

router.get("/admin/sms/usage", requireSuperAdmin, async (req, res) => {
  const start = new Date();
  start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);

  // Single-tenant lookup is cheap and the existing /restaurant detail UI
  // depends on it — kept unpaginated and short-circuited.
  if (req.query.tenantId) {
    const tid = Number(req.query.tenantId);
    if (!Number.isFinite(tid)) { res.status(400).json({ error: "Invalid tenantId" }); return; }
    const [t] = await db.select({
      id: tenantsTable.id, name: tenantsTable.name, planId: tenantsTable.planId,
      override: tenantsTable.smsMonthlyLimit, planLimit: subscriptionPlansTable.smsMonthlyLimit,
      planName: subscriptionPlansTable.name,
    }).from(tenantsTable)
      .leftJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, tenantsTable.planId))
      .where(eq(tenantsTable.id, tid));
    if (!t) { res.status(404).json({ error: "Tenant not found" }); return; }
    const [u] = await db.select({
      sent: sql<number>`count(*) FILTER (WHERE ${smsLogsTable.status} IN ('sent','delivered'))::int`,
      failed: sql<number>`count(*) FILTER (WHERE ${smsLogsTable.status} = 'failed')::int`,
      blocked: sql<number>`count(*) FILTER (WHERE ${smsLogsTable.status} = 'blocked')::int`,
    }).from(smsLogsTable).where(and(eq(smsLogsTable.tenantId, tid), gte(smsLogsTable.createdAt, start)));
    const limit = (t.override ?? t.planLimit ?? 0) || 0;
    res.json({ tenantId: tid, name: t.name, planName: t.planName, limit, used: u?.sent ?? 0, failed: u?.failed ?? 0, blocked: u?.blocked ?? 0 });
    return;
  }

  // Paginated tenant list. Without pagination this query loads every tenant
  // on the platform — fine for hundreds, broken at thousands.
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const [tenants, totalRow] = await Promise.all([
    db.select({
      id: tenantsTable.id, name: tenantsTable.name, planId: tenantsTable.planId,
      override: tenantsTable.smsMonthlyLimit, planLimit: subscriptionPlansTable.smsMonthlyLimit,
      planName: subscriptionPlansTable.name,
    }).from(tenantsTable)
      .leftJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, tenantsTable.planId))
      .orderBy(tenantsTable.id)
      .limit(limit).offset(offset),
    db.select({ c: sql<number>`count(*)::int` }).from(tenantsTable),
  ]);
  const tenantIds = tenants.map(t => t.id);

  const usageRows = tenantIds.length > 0
    ? await db.select({
        tenantId: smsLogsTable.tenantId,
        sent: sql<number>`count(*) FILTER (WHERE ${smsLogsTable.status} IN ('sent','delivered'))::int`,
        failed: sql<number>`count(*) FILTER (WHERE ${smsLogsTable.status} = 'failed')::int`,
        blocked: sql<number>`count(*) FILTER (WHERE ${smsLogsTable.status} = 'blocked')::int`,
      })
        .from(smsLogsTable)
        .where(and(gte(smsLogsTable.createdAt, start), inArray(smsLogsTable.tenantId, tenantIds)))
        .groupBy(smsLogsTable.tenantId)
    : [];
  const byTenant = new Map(usageRows.map(r => [r.tenantId, r]));

  res.json({
    rows: tenants.map(t => {
      const u = byTenant.get(t.id) ?? { sent: 0, failed: 0, blocked: 0 };
      const lim = (t.override ?? t.planLimit ?? 0) || 0;
      return {
        tenantId: t.id, name: t.name, planId: t.planId, planName: t.planName,
        limit: lim, used: u.sent, failed: u.failed, blocked: u.blocked,
        remaining: lim > 0 ? Math.max(0, lim - u.sent) : null,
      };
    }),
    total: Number(totalRow[0]?.c ?? 0),
    limit, offset,
  });
});

router.post("/admin/sms/check-quotas", requireSuperAdmin, async (_req, res) => {
  await sweepQuotaAlerts();
  res.json({ ok: true });
});

// Convenience: lookup limit + used for a single tenant (used from restaurant detail).
router.get("/admin/sms/tenants/:id/usage", requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const [limit, used] = await Promise.all([getTenantMonthlyLimit(id), getTenantMonthlyUsage(id)]);
  res.json({ tenantId: id, limit, used, remaining: limit > 0 ? Math.max(0, limit - used) : null });
});

export default router;
