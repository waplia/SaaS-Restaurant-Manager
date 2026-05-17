import { Router } from "express";
import crypto from "crypto";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  db,
  apiKeysTable,
  apiGlobalSettingsTable,
  apiRequestLogsTable,
  restaurantApiOverridesTable,
  webhookEndpointsTable,
  webhookDeliveriesTable,
  oauthAppsTable,
  WEBHOOK_EVENT_TYPES,
  API_SCOPES,
  filterValidScopes,
  DEFAULT_LIVE_SCOPES,
  type WebhookEventType,
  type WebhookDeliveryStatus,
  type ApiKeyEnvironment,
} from "../lib/db";
import { requireRole, requireSuperAdmin } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { generateApiKey, getGlobalSettings, hashKey } from "../lib/apiKeys";
import {
  generateWebhookSecret,
  retryDeliveryNow,
  retryAllFailedForEndpoint,
} from "../lib/webhookDispatcher";
import { recordAuditLog } from "../lib/audit";

const router = Router();

// ────────────────────────────────────────────────────────────────────────────
// Super Admin: Global API/Webhook settings
// ────────────────────────────────────────────────────────────────────────────

router.get("/admin/api-settings", requireSuperAdmin, async (_req, res) => {
  const s = await getGlobalSettings();
  res.json(s);
});

router.put("/admin/api-settings", requireSuperAdmin, async (req, res) => {
  const b = req.body ?? {};
  const before = await getGlobalSettings();
  const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: req.user!.sub };
  if (typeof b.apiEnabled === "boolean") patch.apiEnabled = b.apiEnabled;
  if (Number.isInteger(b.defaultRateLimitPerMin) && b.defaultRateLimitPerMin > 0) patch.defaultRateLimitPerMin = b.defaultRateLimitPerMin;
  if (Number.isInteger(b.webhookMaxAttempts) && b.webhookMaxAttempts >= 1 && b.webhookMaxAttempts <= 20) patch.webhookMaxAttempts = b.webhookMaxAttempts;
  if (Number.isInteger(b.webhookBaseDelaySec) && b.webhookBaseDelaySec >= 1) patch.webhookBaseDelaySec = b.webhookBaseDelaySec;
  if (Number.isInteger(b.logRetentionDays) && b.logRetentionDays >= 1) patch.logRetentionDays = b.logRetentionDays;
  const [row] = await db.update(apiGlobalSettingsTable).set(patch).where(eq(apiGlobalSettingsTable.id, 1)).returning();
  void recordAuditLog({
    req, module: "developer_portal", action: "global_settings_updated", entity: "api_global_settings", entityId: 1,
    oldValue: before, newValue: row,
  });
  res.json(row);
});

// Scope catalog (super admin can inspect)
router.get("/admin/api-scopes", requireSuperAdmin, (_req, res) => {
  res.json({ data: API_SCOPES });
});

// Per-restaurant rate limit override (super admin)
router.get("/admin/restaurants/:restaurantId/api-rate-limit", requireSuperAdmin, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [row] = await db.select().from(restaurantApiOverridesTable).where(eq(restaurantApiOverridesTable.restaurantId, restaurantId));
  res.json(row ?? { restaurantId, rateLimitPerMin: null, apiDisabled: false, apiDisabledReason: null });
});

router.put("/admin/restaurants/:restaurantId/api-rate-limit", requireSuperAdmin, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rateLimitPerMin = req.body?.rateLimitPerMin;
  if (rateLimitPerMin != null && (!Number.isInteger(rateLimitPerMin) || rateLimitPerMin < 1)) {
    return void res.status(400).json({ error: "rateLimitPerMin must be a positive integer or null" });
  }
  const [row] = await db
    .insert(restaurantApiOverridesTable)
    .values({ restaurantId, rateLimitPerMin: rateLimitPerMin ?? null, updatedBy: req.user!.sub })
    .onConflictDoUpdate({
      target: restaurantApiOverridesTable.restaurantId,
      set: { rateLimitPerMin: rateLimitPerMin ?? null, updatedBy: req.user!.sub, updatedAt: new Date() },
    })
    .returning();
  void recordAuditLog({
    req, module: "developer_portal", action: "rate_limit_override_set", entity: "restaurant_api_overrides",
    entityId: restaurantId, targetRestaurantId: restaurantId, newValue: { rateLimitPerMin },
  });
  res.json(row);
});

// Kill-switch: super-admin can disable all API traffic for one tenant
router.put("/admin/restaurants/:restaurantId/api-kill-switch", requireSuperAdmin, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const apiDisabled = req.body?.apiDisabled === true;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : null;
  const [row] = await db
    .insert(restaurantApiOverridesTable)
    .values({ restaurantId, apiDisabled, apiDisabledReason: apiDisabled ? reason : null, updatedBy: req.user!.sub })
    .onConflictDoUpdate({
      target: restaurantApiOverridesTable.restaurantId,
      set: {
        apiDisabled,
        apiDisabledReason: apiDisabled ? reason : null,
        updatedBy: req.user!.sub,
        updatedAt: new Date(),
      },
    })
    .returning();
  void recordAuditLog({
    req, module: "developer_portal", action: apiDisabled ? "tenant_kill_switch_on" : "tenant_kill_switch_off",
    entity: "restaurant_api_overrides", entityId: restaurantId, targetRestaurantId: restaurantId,
    newValue: { apiDisabled, reason },
  });
  res.json(row);
});

// ────────────────────────────────────────────────────────────────────────────
// Super Admin: Global API request logs
// ────────────────────────────────────────────────────────────────────────────

function parseLogFilters(req: { query: Record<string, unknown> }): { conds: SQL[]; page: number; pageSize: number } {
  const conds: SQL[] = [];
  const restaurantId = Number(req.query.restaurantId);
  if (restaurantId) conds.push(eq(apiRequestLogsTable.restaurantId, restaurantId));
  const status = Number(req.query.statusCode);
  if (status) conds.push(eq(apiRequestLogsTable.statusCode, status));
  const method = typeof req.query.method === "string" ? req.query.method.toUpperCase() : null;
  if (method) conds.push(eq(apiRequestLogsTable.method, method));
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  if (from && !isNaN(from.getTime())) conds.push(gte(apiRequestLogsTable.createdAt, from));
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
  if (to && !isNaN(to.getTime())) conds.push(lte(apiRequestLogsTable.createdAt, to));
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
  return { conds, page, pageSize };
}

router.get("/admin/api-logs", requireSuperAdmin, async (req, res) => {
  const { conds, page, pageSize } = parseLogFilters(req);
  const where = conds.length > 0 ? and(...conds) : undefined;
  const [{ c: total }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(apiRequestLogsTable)
    .where(where);
  const rows = await db
    .select()
    .from(apiRequestLogsTable)
    .where(where)
    .orderBy(desc(apiRequestLogsTable.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  res.json({ rows, total, page, pageSize });
});

// ────────────────────────────────────────────────────────────────────────────
// Restaurant: API Keys
// ────────────────────────────────────────────────────────────────────────────

// All developer-portal management routes are plan-gated on `api_access`.
// Super admins bypass the check (handled inside requirePlanFeature). This
// closes the gap where UI gating could be bypassed by calling the API
// directly.
const devPortalGuards = [
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("api_access"),
];

router.use("/restaurants/:restaurantId/api-keys", ...devPortalGuards);
router.use("/restaurants/:restaurantId/api-logs", ...devPortalGuards);
router.use("/restaurants/:restaurantId/api-scopes", ...devPortalGuards);
router.use("/restaurants/:restaurantId/webhooks", ...devPortalGuards);
router.use("/restaurants/:restaurantId/webhook-deliveries", ...devPortalGuards);
router.use("/restaurants/:restaurantId/webhook-health", ...devPortalGuards);
router.use("/restaurants/:restaurantId/oauth-apps", ...devPortalGuards);

router.get("/restaurants/:restaurantId/api-scopes", (_req, res) => {
  res.json({ data: API_SCOPES });
});

router.get("/restaurants/:restaurantId/api-keys", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select({
    id: apiKeysTable.id,
    name: apiKeysTable.name,
    prefix: apiKeysTable.prefix,
    environment: apiKeysTable.environment,
    scopes: apiKeysTable.scopes,
    rateLimitPerMin: apiKeysTable.rateLimitPerMin,
    lastUsedAt: apiKeysTable.lastUsedAt,
    revokedAt: apiKeysTable.revokedAt,
    rotatedFromId: apiKeysTable.rotatedFromId,
    rotatedAt: apiKeysTable.rotatedAt,
    createdAt: apiKeysTable.createdAt,
  }).from(apiKeysTable).where(eq(apiKeysTable.restaurantId, restaurantId)).orderBy(desc(apiKeysTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/api-keys", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return void res.status(400).json({ error: "name is required" });
  const rateLimitPerMin = req.body?.rateLimitPerMin;
  if (rateLimitPerMin != null && (!Number.isInteger(rateLimitPerMin) || rateLimitPerMin < 1)) {
    return void res.status(400).json({ error: "rateLimitPerMin must be a positive integer or null" });
  }
  const env: ApiKeyEnvironment = req.body?.environment === "sandbox" ? "sandbox" : "live";
  // Scope resolution policy:
  //   - omitted / null → fall back to DEFAULT_LIVE_SCOPES (safe read-only set).
  //   - explicit array with at least one valid scope → use the filtered set.
  //   - explicit array that filters to empty (all entries invalid) → reject 400
  //     so client mistakes (typos, stale catalog) surface loudly rather than
  //     silently downgrading to defaults.
  let scopes: string[];
  if (req.body?.scopes === undefined || req.body?.scopes === null) {
    scopes = [...DEFAULT_LIVE_SCOPES];
  } else if (!Array.isArray(req.body.scopes)) {
    return void res.status(400).json({ error: "scopes must be an array of scope strings" });
  } else {
    const requested = filterValidScopes(req.body.scopes);
    if (req.body.scopes.length > 0 && requested.length === 0) {
      return void res.status(400).json({
        error: "scopes contained no valid entries. See GET /api-scopes for the catalog.",
      });
    }
    scopes = requested.length > 0 ? requested : [...DEFAULT_LIVE_SCOPES];
  }
  const { fullKey, prefix, hashed } = generateApiKey(env);
  const [row] = await db.insert(apiKeysTable).values({
    restaurantId,
    name,
    prefix,
    hashedKey: hashed,
    environment: env,
    scopes,
    rateLimitPerMin: rateLimitPerMin ?? null,
    createdBy: req.user!.sub,
  }).returning();
  void recordAuditLog({
    req, restaurantId, module: "developer_portal", action: "api_key_created",
    entity: "api_keys", entityId: row.id,
    newValue: { name: row.name, environment: row.environment, scopes: row.scopes, prefix: row.prefix },
  });
  // Full key is shown once at creation only
  res.status(201).json({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    environment: row.environment,
    scopes: row.scopes,
    rateLimitPerMin: row.rateLimitPerMin,
    createdAt: row.createdAt,
    fullKey,
  });
});

router.patch("/restaurants/:restaurantId/api-keys/:keyId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const keyId = Number(req.params.keyId);
  const patch: Record<string, unknown> = {};
  if (Array.isArray(req.body?.scopes)) {
    const filtered = filterValidScopes(req.body.scopes);
    // Never allow PATCH to write an empty scope array — that would silently
    // upgrade the key to legacy full-access (see keyHasScope semantics).
    // Callers must supply at least one valid scope; to fully disable a key,
    // use DELETE (revoke) instead.
    if (filtered.length === 0) {
      return void res.status(400).json({
        error: "scopes must contain at least one valid scope. To disable a key, revoke it instead.",
      });
    }
    patch.scopes = filtered;
  }
  if (req.body?.rateLimitPerMin === null) patch.rateLimitPerMin = null;
  else if (Number.isInteger(req.body?.rateLimitPerMin) && req.body.rateLimitPerMin >= 1) patch.rateLimitPerMin = req.body.rateLimitPerMin;
  if (typeof req.body?.name === "string" && req.body.name.trim()) patch.name = req.body.name.trim();
  if (Object.keys(patch).length === 0) return void res.status(400).json({ error: "Nothing to update" });
  const [before] = await db.select().from(apiKeysTable)
    .where(and(eq(apiKeysTable.id, keyId), eq(apiKeysTable.restaurantId, restaurantId)));
  if (!before) return void res.status(404).json({ error: "Key not found" });
  if (before.revokedAt) return void res.status(400).json({ error: "Cannot edit a revoked key" });
  const [row] = await db.update(apiKeysTable).set(patch)
    .where(and(eq(apiKeysTable.id, keyId), eq(apiKeysTable.restaurantId, restaurantId))).returning();
  void recordAuditLog({
    req, restaurantId, module: "developer_portal", action: "api_key_updated",
    entity: "api_keys", entityId: row.id, oldValue: { scopes: before.scopes, name: before.name, rateLimitPerMin: before.rateLimitPerMin }, newValue: patch,
  });
  res.json(row);
});

router.delete("/restaurants/:restaurantId/api-keys/:keyId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const keyId = Number(req.params.keyId);
  const [row] = await db.update(apiKeysTable)
    .set({ revokedAt: new Date(), revokedBy: req.user!.sub })
    .where(and(eq(apiKeysTable.id, keyId), eq(apiKeysTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Key not found" });
  void recordAuditLog({
    req, restaurantId, module: "developer_portal", action: "api_key_revoked",
    entity: "api_keys", entityId: row.id, newValue: { name: row.name, environment: row.environment },
  });
  res.json({ id: row.id, revokedAt: row.revokedAt });
});

/** Rotate: mints a new key (same name + scopes + env), revokes the old one. Returns the new full key once. */
router.post("/restaurants/:restaurantId/api-keys/:keyId/rotate", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const keyId = Number(req.params.keyId);
  const [old] = await db.select().from(apiKeysTable)
    .where(and(eq(apiKeysTable.id, keyId), eq(apiKeysTable.restaurantId, restaurantId)));
  if (!old) return void res.status(404).json({ error: "Key not found" });
  if (old.revokedAt) return void res.status(400).json({ error: "Cannot rotate a revoked key" });
  const { fullKey, prefix, hashed } = generateApiKey(old.environment);
  // Atomic rotation: insert the replacement key and revoke the old key in
  // a single transaction so a mid-flight DB failure can't leave both keys
  // active (or, worse, the old key revoked without a replacement).
  const created = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(apiKeysTable).values({
      restaurantId,
      name: old.name,
      prefix,
      hashedKey: hashed,
      environment: old.environment,
      scopes: old.scopes,
      rateLimitPerMin: old.rateLimitPerMin,
      rotatedFromId: old.id,
      rotatedAt: new Date(),
      createdBy: req.user!.sub,
    }).returning();
    await tx.update(apiKeysTable)
      .set({ revokedAt: new Date(), revokedBy: req.user!.sub })
      .where(eq(apiKeysTable.id, old.id));
    return inserted;
  });
  void recordAuditLog({
    req, restaurantId, module: "developer_portal", action: "api_key_rotated",
    entity: "api_keys", entityId: created.id, oldValue: { id: old.id, prefix: old.prefix }, newValue: { id: created.id, prefix: created.prefix },
  });
  res.status(201).json({
    id: created.id,
    name: created.name,
    prefix: created.prefix,
    environment: created.environment,
    scopes: created.scopes,
    rotatedFromId: old.id,
    createdAt: created.createdAt,
    fullKey,
  });
});

/** Per-key usage: bucketed by day for the last `days` days (default 7). */
router.get("/restaurants/:restaurantId/api-keys/:keyId/usage", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const keyId = Number(req.params.keyId);
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
  const since = new Date(Date.now() - days * 86400_000);
  const [{ c: total }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(apiRequestLogsTable)
    .where(and(eq(apiRequestLogsTable.apiKeyId, keyId), eq(apiRequestLogsTable.restaurantId, restaurantId), gte(apiRequestLogsTable.createdAt, since)));
  const [{ e: errors }] = await db.select({ e: sql<number>`count(*) filter (where status_code >= 400)::int` })
    .from(apiRequestLogsTable)
    .where(and(eq(apiRequestLogsTable.apiKeyId, keyId), eq(apiRequestLogsTable.restaurantId, restaurantId), gte(apiRequestLogsTable.createdAt, since)));
  const byDay = await db.execute(sql`
    select date_trunc('day', created_at)::date as day,
           count(*)::int as total,
           count(*) filter (where status_code >= 400)::int as errors,
           round(avg(latency_ms))::int as avg_latency
    from api_request_logs
    where api_key_id = ${keyId} and restaurant_id = ${restaurantId} and created_at >= ${since}
    group by 1
    order by 1
  `);
  res.json({ total, errors, days, byDay: byDay.rows });
});

// Restaurant logs view (mirrors the global view but scoped)
router.get("/restaurants/:restaurantId/api-logs", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { conds, page, pageSize } = parseLogFilters({ query: { ...req.query, restaurantId } });
  const where = and(eq(apiRequestLogsTable.restaurantId, restaurantId), ...conds.filter(c => c !== undefined));
  const [{ c: total }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(apiRequestLogsTable)
    .where(where);
  const rows = await db
    .select()
    .from(apiRequestLogsTable)
    .where(where)
    .orderBy(desc(apiRequestLogsTable.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  res.json({ rows, total, page, pageSize });
});

// ────────────────────────────────────────────────────────────────────────────
// Restaurant: Webhook endpoints
// ────────────────────────────────────────────────────────────────────────────

function parseEvents(input: unknown): WebhookEventType[] {
  if (!Array.isArray(input)) return [];
  const out: WebhookEventType[] = [];
  for (const v of input) {
    if (typeof v === "string" && (WEBHOOK_EVENT_TYPES as string[]).includes(v)) {
      out.push(v as WebhookEventType);
    }
  }
  return Array.from(new Set(out));
}

router.get("/restaurants/:restaurantId/webhooks", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(webhookEndpointsTable)
    .where(eq(webhookEndpointsTable.restaurantId, restaurantId))
    .orderBy(desc(webhookEndpointsTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/webhooks", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  if (!/^https?:\/\//i.test(url)) return void res.status(400).json({ error: "Valid http(s) URL required" });
  const events = parseEvents(req.body?.events);
  if (events.length === 0) return void res.status(400).json({ error: "At least one valid event must be subscribed" });
  const active = req.body?.active !== false;
  const secret = generateWebhookSecret();
  const [row] = await db.insert(webhookEndpointsTable).values({
    restaurantId, url, events, secret, active, createdBy: req.user!.sub,
  }).returning();
  void recordAuditLog({
    req, restaurantId, module: "developer_portal", action: "webhook_created",
    entity: "webhook_endpoints", entityId: row.id, newValue: { url, events, active },
  });
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/webhooks/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof req.body?.url === "string") {
    if (!/^https?:\/\//i.test(req.body.url)) return void res.status(400).json({ error: "Invalid URL" });
    patch.url = req.body.url.trim();
  }
  if (Array.isArray(req.body?.events)) {
    const ev = parseEvents(req.body.events);
    if (ev.length === 0) return void res.status(400).json({ error: "At least one valid event required" });
    patch.events = ev;
  }
  if (typeof req.body?.active === "boolean") patch.active = req.body.active;
  const [row] = await db.update(webhookEndpointsTable).set(patch)
    .where(and(eq(webhookEndpointsTable.id, id), eq(webhookEndpointsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Endpoint not found" });
  void recordAuditLog({
    req, restaurantId, module: "developer_portal", action: "webhook_updated",
    entity: "webhook_endpoints", entityId: row.id, newValue: patch,
  });
  res.json(row);
});

router.post("/restaurants/:restaurantId/webhooks/:id/rotate-secret", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const secret = generateWebhookSecret();
  const [row] = await db.update(webhookEndpointsTable).set({ secret, updatedAt: new Date() })
    .where(and(eq(webhookEndpointsTable.id, id), eq(webhookEndpointsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Endpoint not found" });
  void recordAuditLog({
    req, restaurantId, module: "developer_portal", action: "webhook_secret_rotated",
    entity: "webhook_endpoints", entityId: row.id,
  });
  res.json(row);
});

router.delete("/restaurants/:restaurantId/webhooks/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [row] = await db.delete(webhookEndpointsTable)
    .where(and(eq(webhookEndpointsTable.id, id), eq(webhookEndpointsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Endpoint not found" });
  void recordAuditLog({
    req, restaurantId, module: "developer_portal", action: "webhook_deleted",
    entity: "webhook_endpoints", entityId: id, oldValue: { url: row.url, events: row.events },
  });
  res.json({ id: row.id, deleted: true });
});

// Webhook health at-a-glance: counts by endpoint for last 24 hours
router.get("/restaurants/:restaurantId/webhook-health", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const since = new Date(Date.now() - 86400_000);
  const rows = await db.execute(sql`
    select e.id as endpoint_id, e.url, e.active,
           count(d.id)::int as total_24h,
           count(d.id) filter (where d.status = 'delivered')::int as delivered_24h,
           count(d.id) filter (where d.status = 'failed')::int as failed_24h,
           count(d.id) filter (where d.status = 'permanently_failed')::int as dead_24h,
           count(d.id) filter (where d.status = 'pending')::int as pending,
           max(d.delivered_at) as last_delivered_at,
           max(d.created_at) filter (where d.status in ('failed','permanently_failed')) as last_failure_at
    from webhook_endpoints e
    left join webhook_deliveries d on d.endpoint_id = e.id and d.created_at >= ${since}
    where e.restaurant_id = ${restaurantId}
    group by e.id, e.url, e.active
    order by e.id
  `);
  res.json({ endpoints: rows.rows });
});

// ────────────────────────────────────────────────────────────────────────────
// Restaurant: Webhook delivery logs (success + failures)
// ────────────────────────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/webhook-deliveries", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const conds: SQL[] = [eq(webhookDeliveriesTable.restaurantId, restaurantId)];
  const status = typeof req.query.status === "string" ? (req.query.status as WebhookDeliveryStatus) : null;
  if (status && ["pending", "delivered", "failed", "permanently_failed"].includes(status)) {
    conds.push(eq(webhookDeliveriesTable.status, status));
  }
  const endpointId = Number(req.query.endpointId);
  if (endpointId) conds.push(eq(webhookDeliveriesTable.endpointId, endpointId));
  const failedOnly = req.query.failedOnly === "true" || req.query.failedOnly === "1";
  if (failedOnly) {
    conds.push(sql`${webhookDeliveriesTable.status} IN ('failed', 'permanently_failed')`);
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
  const where = and(...conds);
  const [{ c: total }] = await db.select({ c: sql<number>`count(*)::int` }).from(webhookDeliveriesTable).where(where);
  const rows = await db.select().from(webhookDeliveriesTable).where(where)
    .orderBy(desc(webhookDeliveriesTable.createdAt))
    .limit(pageSize).offset((page - 1) * pageSize);
  res.json({ rows, total, page, pageSize });
});

router.post("/restaurants/:restaurantId/webhook-deliveries/:id/retry", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [d] = await db.select().from(webhookDeliveriesTable)
    .where(and(eq(webhookDeliveriesTable.id, id), eq(webhookDeliveriesTable.restaurantId, restaurantId)));
  if (!d) return void res.status(404).json({ error: "Delivery not found" });
  const updated = await retryDeliveryNow(id);
  res.json(updated);
});

router.post("/restaurants/:restaurantId/webhooks/:id/retry-failed", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [ep] = await db.select().from(webhookEndpointsTable)
    .where(and(eq(webhookEndpointsTable.id, id), eq(webhookEndpointsTable.restaurantId, restaurantId)));
  if (!ep) return void res.status(404).json({ error: "Endpoint not found" });
  const count = await retryAllFailedForEndpoint(id);
  res.json({ retried: count });
});

// ────────────────────────────────────────────────────────────────────────────
// Restaurant: OAuth App placeholders (Step 5)
// ────────────────────────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/oauth-apps", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select({
    id: oauthAppsTable.id, name: oauthAppsTable.name, description: oauthAppsTable.description,
    clientId: oauthAppsTable.clientId, clientSecretPrefix: oauthAppsTable.clientSecretPrefix,
    redirectUris: oauthAppsTable.redirectUris, scopes: oauthAppsTable.scopes, status: oauthAppsTable.status,
    homepageUrl: oauthAppsTable.homepageUrl, createdAt: oauthAppsTable.createdAt,
  }).from(oauthAppsTable)
    .where(eq(oauthAppsTable.restaurantId, restaurantId))
    .orderBy(desc(oauthAppsTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/oauth-apps", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return void res.status(400).json({ error: "name is required" });
  const description = typeof req.body?.description === "string" ? req.body.description.slice(0, 1000) : null;
  const homepageUrl = typeof req.body?.homepageUrl === "string" ? req.body.homepageUrl.trim() : null;
  const redirectUris = Array.isArray(req.body?.redirectUris)
    ? req.body.redirectUris.filter((u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u)).slice(0, 10)
    : [];
  const scopes = filterValidScopes(req.body?.scopes);
  const clientId = `cli_${crypto.randomBytes(12).toString("base64url")}`;
  const fullSecret = `clisec_${crypto.randomBytes(24).toString("base64url")}`;
  const clientSecretHash = hashKey(fullSecret);
  const clientSecretPrefix = fullSecret.slice(0, 14);
  const [row] = await db.insert(oauthAppsTable).values({
    restaurantId, name, description, homepageUrl, redirectUris, scopes,
    clientId, clientSecretHash, clientSecretPrefix, status: "draft", createdBy: req.user!.sub,
  }).returning();
  void recordAuditLog({
    req, restaurantId, module: "developer_portal", action: "oauth_app_created",
    entity: "oauth_apps", entityId: row.id, newValue: { name, scopes, redirectUris },
  });
  // Full client secret returned exactly once (like API keys).
  res.status(201).json({
    id: row.id, name: row.name, clientId: row.clientId, clientSecret: fullSecret,
    scopes: row.scopes, redirectUris: row.redirectUris, status: row.status, createdAt: row.createdAt,
  });
});

router.delete("/restaurants/:restaurantId/oauth-apps/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [row] = await db.delete(oauthAppsTable)
    .where(and(eq(oauthAppsTable.id, id), eq(oauthAppsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "App not found" });
  void recordAuditLog({
    req, restaurantId, module: "developer_portal", action: "oauth_app_deleted",
    entity: "oauth_apps", entityId: id, oldValue: { name: row.name },
  });
  res.json({ id: row.id, deleted: true });
});

export default router;
