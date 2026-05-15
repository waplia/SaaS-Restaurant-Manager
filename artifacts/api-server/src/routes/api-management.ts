import { Router } from "express";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  db,
  apiKeysTable,
  apiGlobalSettingsTable,
  apiRequestLogsTable,
  restaurantApiOverridesTable,
  restaurantsTable,
  webhookEndpointsTable,
  webhookDeliveriesTable,
  WEBHOOK_EVENT_TYPES,
  type WebhookEventType,
  type WebhookDeliveryStatus,
} from "../lib/db";
import { requireRole, requireSuperAdmin } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { generateApiKey, getGlobalSettings } from "../lib/apiKeys";
import {
  generateWebhookSecret,
  retryDeliveryNow,
  retryAllFailedForEndpoint,
} from "../lib/webhookDispatcher";

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
  const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: req.user!.sub };
  if (typeof b.apiEnabled === "boolean") patch.apiEnabled = b.apiEnabled;
  if (Number.isInteger(b.defaultRateLimitPerMin) && b.defaultRateLimitPerMin > 0) patch.defaultRateLimitPerMin = b.defaultRateLimitPerMin;
  if (Number.isInteger(b.webhookMaxAttempts) && b.webhookMaxAttempts >= 1 && b.webhookMaxAttempts <= 20) patch.webhookMaxAttempts = b.webhookMaxAttempts;
  if (Number.isInteger(b.webhookBaseDelaySec) && b.webhookBaseDelaySec >= 1) patch.webhookBaseDelaySec = b.webhookBaseDelaySec;
  if (Number.isInteger(b.logRetentionDays) && b.logRetentionDays >= 1) patch.logRetentionDays = b.logRetentionDays;
  await getGlobalSettings(); // ensure row exists
  const [row] = await db.update(apiGlobalSettingsTable).set(patch).where(eq(apiGlobalSettingsTable.id, 1)).returning();
  res.json(row);
});

// Per-restaurant rate limit override (super admin)
router.get("/admin/restaurants/:restaurantId/api-rate-limit", requireSuperAdmin, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [row] = await db.select().from(restaurantApiOverridesTable).where(eq(restaurantApiOverridesTable.restaurantId, restaurantId));
  res.json(row ?? { restaurantId, rateLimitPerMin: null });
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

router.use(
  "/restaurants/:restaurantId/api-keys",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);
router.use(
  "/restaurants/:restaurantId/api-logs",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);
router.use(
  "/restaurants/:restaurantId/webhooks",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);
router.use(
  "/restaurants/:restaurantId/webhook-deliveries",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);

router.get("/restaurants/:restaurantId/api-keys", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select({
    id: apiKeysTable.id,
    name: apiKeysTable.name,
    prefix: apiKeysTable.prefix,
    rateLimitPerMin: apiKeysTable.rateLimitPerMin,
    lastUsedAt: apiKeysTable.lastUsedAt,
    revokedAt: apiKeysTable.revokedAt,
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
  const { fullKey, prefix, hashed } = generateApiKey();
  const [row] = await db.insert(apiKeysTable).values({
    restaurantId,
    name,
    prefix,
    hashedKey: hashed,
    rateLimitPerMin: rateLimitPerMin ?? null,
    createdBy: req.user!.sub,
  }).returning();
  // Full key is shown once at creation only
  res.status(201).json({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    rateLimitPerMin: row.rateLimitPerMin,
    createdAt: row.createdAt,
    fullKey,
  });
});

router.delete("/restaurants/:restaurantId/api-keys/:keyId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const keyId = Number(req.params.keyId);
  const [row] = await db.update(apiKeysTable)
    .set({ revokedAt: new Date(), revokedBy: req.user!.sub })
    .where(and(eq(apiKeysTable.id, keyId), eq(apiKeysTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Key not found" });
  res.json({ id: row.id, revokedAt: row.revokedAt });
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
  res.json(row);
});

router.delete("/restaurants/:restaurantId/webhooks/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [row] = await db.delete(webhookEndpointsTable)
    .where(and(eq(webhookEndpointsTable.id, id), eq(webhookEndpointsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Endpoint not found" });
  res.json({ id: row.id, deleted: true });
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

export default router;
