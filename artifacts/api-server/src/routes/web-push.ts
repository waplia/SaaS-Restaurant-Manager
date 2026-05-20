import { Router } from "express";
import { and, desc, eq, sql, gte } from "drizzle-orm";
import {
  db,
  webPushSubscriptionsTable,
  webPushSettingsTable,
  webPushTemplatesTable,
  webPushCampaignsTable,
  webPushCampaignRecipientsTable,
  webPushLogsTable,
  WEB_PUSH_FEATURE_KEYS,
  WEB_PUSH_EVENT_KEYS,
} from "../lib/db";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import {
  getOrCreateRestaurantSettings,
  resolveTenantLimits,
  sendWebPush,
  sendTestWebPush,
} from "../lib/webPush";
import { recordAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";

const router = Router();

// ────────────────────────────────────────────────────────────
// GET / PUT  restaurant-scoped settings (transactional toggles, caps, quiet hours)
// ────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/web-push/settings", validateRestaurantAccess, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const settings = await getOrCreateRestaurantSettings(restaurantId);
  const tenantId = (req as unknown as { restaurant?: { tenantId: number } }).restaurant?.tenantId
    ?? (req.user as { tenantId?: number } | undefined)?.tenantId
    ?? null;
  const limits = await resolveTenantLimits(tenantId);
  res.json({ settings, limits, knownFeatures: WEB_PUSH_FEATURE_KEYS, knownEvents: WEB_PUSH_EVENT_KEYS });
});

router.put("/restaurants/:restaurantId/web-push/settings", validateRestaurantAccess, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  await getOrCreateRestaurantSettings(restaurantId);
  const body = req.body as {
    enabled?: boolean;
    features?: Record<string, boolean>;
    quietHoursStart?: string | null;
    quietHoursEnd?: string | null;
    dailyCap?: number | null;
    monthlyCap?: number | null;
    perCustomerDailyCap?: number;
    minCampaignGapMinutes?: number;
    allowRichImages?: boolean;
    requireMarketingOptIn?: boolean;
    defaultClickUrl?: string | null;
  };
  const patch: Record<string, unknown> = { updatedBy: (req.user as { sub?: number } | undefined)?.sub ?? null, updatedAt: new Date() };
  for (const k of ["enabled", "features", "quietHoursStart", "quietHoursEnd", "dailyCap", "monthlyCap", "perCustomerDailyCap", "minCampaignGapMinutes", "allowRichImages", "requireMarketingOptIn", "defaultClickUrl"] as const) {
    if (body[k] !== undefined) patch[k] = body[k] as never;
  }
  await db.update(webPushSettingsTable).set(patch).where(eq(webPushSettingsTable.restaurantId, restaurantId));
  await recordAuditLog({ req, module: "web_push", action: "update_settings", entity: "web_push_settings", entityId: restaurantId, newValue: body });
  const fresh = await getOrCreateRestaurantSettings(restaurantId);
  res.json(fresh);
});

// ────────────────────────────────────────────────────────────
// POST  test send to the most-recent active staff subscription
// ────────────────────────────────────────────────────────────
router.post("/restaurants/:restaurantId/web-push/test", validateRestaurantAccess, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { endpoint, title, body } = req.body as { endpoint?: string; title?: string; body?: string };
  const payload = { title: title ?? "TableTrack test push", body: body ?? "This is a test from your restaurant's Web Push settings." };
  let result: { ok: boolean; error?: string };
  if (endpoint) {
    result = await sendTestWebPush(endpoint, payload);
  } else {
    // Default: send via the standard pipeline to whoever's active for this restaurant.
    const r = await sendWebPush({ restaurantId, eventKey: "system.announcement", category: "transactional", payload });
    result = { ok: r.sent > 0, error: r.sent === 0 ? (r.reason ?? `No deliveries (failed=${r.failed}, total=${r.total})`) : undefined };
  }
  await db.update(webPushSettingsTable).set({
    lastTestAt: new Date(),
    lastTestStatus: result.ok ? "ok" : "failed",
    lastTestError: result.error ?? null,
  }).where(eq(webPushSettingsTable.restaurantId, restaurantId));
  await recordAuditLog({ req, module: "web_push", action: "test_send", entity: "web_push_settings", entityId: restaurantId, details: JSON.stringify(result) });
  res.json(result);
});

// ────────────────────────────────────────────────────────────
// Templates CRUD
// ────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/web-push/templates", validateRestaurantAccess, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(webPushTemplatesTable).where(eq(webPushTemplatesTable.restaurantId, restaurantId));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/web-push/templates", validateRestaurantAccess, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { eventKey, name, title, body, iconUrl, imageUrl, clickUrl, variables, isActive } = req.body ?? {};
  if (!eventKey || !name || !title || !body) return void res.status(400).json({ error: "eventKey, name, title, body required" });
  const [row] = await db.insert(webPushTemplatesTable).values({
    restaurantId, eventKey, name, title, body,
    iconUrl: iconUrl ?? null, imageUrl: imageUrl ?? null, clickUrl: clickUrl ?? null,
    variables: Array.isArray(variables) ? variables : [],
    isActive: isActive !== false,
    createdBy: (req.user as { sub?: number } | undefined)?.sub ?? null,
  }).returning();
  await recordAuditLog({ req, module: "web_push", action: "create_template", entity: "web_push_template", entityId: row.id, newValue: { eventKey, name } });
  res.json(row);
});

router.put("/restaurants/:restaurantId/web-push/templates/:id", validateRestaurantAccess, async (req, res) => {
  const id = Number(req.params.id);
  const restaurantId = Number(req.params.restaurantId);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["name", "title", "body", "iconUrl", "imageUrl", "clickUrl", "isActive", "eventKey"] as const) {
    if (req.body?.[k] !== undefined) patch[k] = req.body[k];
  }
  await db.update(webPushTemplatesTable).set(patch).where(and(eq(webPushTemplatesTable.id, id), eq(webPushTemplatesTable.restaurantId, restaurantId)));
  await recordAuditLog({ req, module: "web_push", action: "update_template", entity: "web_push_template", entityId: id, newValue: patch });
  res.json({ success: true });
});

router.delete("/restaurants/:restaurantId/web-push/templates/:id", validateRestaurantAccess, async (req, res) => {
  const id = Number(req.params.id);
  const restaurantId = Number(req.params.restaurantId);
  await db.delete(webPushTemplatesTable).where(and(eq(webPushTemplatesTable.id, id), eq(webPushTemplatesTable.restaurantId, restaurantId)));
  await recordAuditLog({ req, module: "web_push", action: "delete_template", entity: "web_push_template", entityId: id });
  res.json({ success: true });
});

// ────────────────────────────────────────────────────────────
// Subscribers list / cleanup
// ────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/web-push/subscribers", validateRestaurantAccess, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const status = (req.query.status as string | undefined) ?? null;
  const conds = [eq(webPushSubscriptionsTable.restaurantId, restaurantId)] as ReturnType<typeof eq>[];
  if (status) conds.push(eq(webPushSubscriptionsTable.status, status as never));
  const rows = await db.select({
    id: webPushSubscriptionsTable.id,
    audience: webPushSubscriptionsTable.audience,
    status: webPushSubscriptionsTable.status,
    browser: webPushSubscriptionsTable.browser,
    device: webPushSubscriptionsTable.device,
    customerId: webPushSubscriptionsTable.customerId,
    marketingOptIn: webPushSubscriptionsTable.marketingOptIn,
    orderUpdatesOptIn: webPushSubscriptionsTable.orderUpdatesOptIn,
    lastSentAt: webPushSubscriptionsTable.lastSentAt,
    failureCount: webPushSubscriptionsTable.failureCount,
    createdAt: webPushSubscriptionsTable.createdAt,
  }).from(webPushSubscriptionsTable).where(and(...conds)).orderBy(desc(webPushSubscriptionsTable.createdAt)).limit(500);
  res.json(rows);
});

router.delete("/restaurants/:restaurantId/web-push/subscribers/:id", validateRestaurantAccess, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  await db.update(webPushSubscriptionsTable).set({ status: "unsubscribed", unsubscribedAt: new Date() })
    .where(and(eq(webPushSubscriptionsTable.id, id), eq(webPushSubscriptionsTable.restaurantId, restaurantId)));
  await recordAuditLog({ req, module: "web_push", action: "unsubscribe_subscriber", entity: "web_push_subscription", entityId: id });
  res.json({ success: true });
});

router.post("/restaurants/:restaurantId/web-push/subscribers/cleanup", validateRestaurantAccess, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const r = await db.update(webPushSubscriptionsTable)
    .set({ status: "expired", unsubscribedAt: new Date() })
    .where(and(eq(webPushSubscriptionsTable.restaurantId, restaurantId), eq(webPushSubscriptionsTable.status, "failed")))
    .returning({ id: webPushSubscriptionsTable.id });
  await recordAuditLog({ req, module: "web_push", action: "subscriber_cleanup", entity: "restaurant", entityId: restaurantId, details: JSON.stringify({ count: r.length }) });
  res.json({ cleaned: r.length });
});

// ────────────────────────────────────────────────────────────
// Campaigns CRUD + send
// ────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/web-push/campaigns", validateRestaurantAccess, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(webPushCampaignsTable).where(eq(webPushCampaignsTable.restaurantId, restaurantId)).orderBy(desc(webPushCampaignsTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/web-push/campaigns", validateRestaurantAccess, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { name, title, body, iconUrl, imageUrl, clickUrl, segment, scheduledAt, templateId } = req.body ?? {};
  if (!name || !title || !body) return void res.status(400).json({ error: "name, title, body required" });
  const [row] = await db.insert(webPushCampaignsTable).values({
    restaurantId, name, title, body,
    iconUrl: iconUrl ?? null, imageUrl: imageUrl ?? null, clickUrl: clickUrl ?? null,
    templateId: templateId ?? null,
    segment: segment ?? {},
    status: scheduledAt ? "scheduled" : "draft",
    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    createdBy: (req.user as { sub?: number } | undefined)?.sub ?? null,
  }).returning();
  await recordAuditLog({ req, module: "web_push", action: "create_campaign", entity: "web_push_campaign", entityId: row.id, newValue: { name, scheduledAt } });
  res.json(row);
});

router.post("/restaurants/:restaurantId/web-push/campaigns/:id/send", validateRestaurantAccess, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [c] = await db.select().from(webPushCampaignsTable).where(and(eq(webPushCampaignsTable.id, id), eq(webPushCampaignsTable.restaurantId, restaurantId)));
  if (!c) return void res.status(404).json({ error: "Campaign not found" });
  if (c.status === "sent" || c.status === "sending") return void res.status(409).json({ error: "Campaign already in flight" });

  await db.update(webPushCampaignsTable).set({ status: "sending", updatedAt: new Date() }).where(eq(webPushCampaignsTable.id, id));
  try {
    // Resolve subscribers from the campaign's segment definition.
    //   segment.audience: "marketing" (default, marketing opt-in only)
    //                   | "order_updates" (anyone opted-in to order updates)
    //                   | "all" (every active subscriber for this restaurant)
    const segment = (c.segment ?? {}) as { audience?: "marketing" | "order_updates" | "all" };
    const audience = segment.audience ?? "marketing";
    const conditions = [
      eq(webPushSubscriptionsTable.restaurantId, restaurantId),
      eq(webPushSubscriptionsTable.status, "active"),
    ];
    if (audience === "marketing") conditions.push(eq(webPushSubscriptionsTable.marketingOptIn, true));
    else if (audience === "order_updates") conditions.push(eq(webPushSubscriptionsTable.orderUpdatesOptIn, true));
    const subs = await db.select({
      id: webPushSubscriptionsTable.id,
      endpoint: webPushSubscriptionsTable.endpoint,
      p256dh: webPushSubscriptionsTable.p256dh,
      auth: webPushSubscriptionsTable.auth,
      customerId: webPushSubscriptionsTable.customerId,
      marketingOptIn: webPushSubscriptionsTable.marketingOptIn,
      orderUpdatesOptIn: webPushSubscriptionsTable.orderUpdatesOptIn,
      restaurantId: webPushSubscriptionsTable.restaurantId,
      tenantId: webPushSubscriptionsTable.tenantId,
    }).from(webPushSubscriptionsTable).where(and(...conditions));

    const out = await sendWebPush({
      restaurantId, eventKey: "system.announcement", category: "marketing", campaignId: id,
      payload: { title: c.title, body: c.body, url: c.clickUrl ?? undefined, icon: c.iconUrl ?? undefined, image: c.imageUrl ?? undefined },
      subscriptions: subs,
    });

    await db.update(webPushCampaignsTable).set({
      status: out.sent > 0 ? "sent" : "failed",
      sentAt: new Date(),
      targetedCount: out.total,
      sentCount: out.sent,
      failedCount: out.failed,
      updatedAt: new Date(),
    }).where(eq(webPushCampaignsTable.id, id));

    // Insert per-recipient records for analytics.
    if (subs.length > 0) {
      await db.insert(webPushCampaignRecipientsTable).values(subs.map(s => ({
        campaignId: id, subscriptionId: s.id, status: "sent",
      }))).onConflictDoNothing?.();
    }

    await recordAuditLog({ req, module: "web_push", action: "send_campaign", entity: "web_push_campaign", entityId: id, details: JSON.stringify(out) });
    res.json(out);
  } catch (err) {
    logger.error({ err, campaignId: id }, "campaign send failed");
    await db.update(webPushCampaignsTable).set({ status: "failed", updatedAt: new Date() }).where(eq(webPushCampaignsTable.id, id));
    res.status(500).json({ error: "Send failed" });
  }
});

router.delete("/restaurants/:restaurantId/web-push/campaigns/:id", validateRestaurantAccess, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  await db.delete(webPushCampaignsTable).where(and(eq(webPushCampaignsTable.id, id), eq(webPushCampaignsTable.restaurantId, restaurantId)));
  await recordAuditLog({ req, module: "web_push", action: "delete_campaign", entity: "web_push_campaign", entityId: id });
  res.json({ success: true });
});

// ────────────────────────────────────────────────────────────
// Usage report (this restaurant)
// ────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/web-push/usage", validateRestaurantAccess, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const days = Math.max(1, Math.min(365, Number(req.query.days ?? 30)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [{ activeSubscribers }] = await db.select({ activeSubscribers: sql<number>`count(*)::int` }).from(webPushSubscriptionsTable)
    .where(and(eq(webPushSubscriptionsTable.restaurantId, restaurantId), eq(webPushSubscriptionsTable.status, "active")));
  const [{ sent }] = await db.select({ sent: sql<number>`count(*)::int` }).from(webPushLogsTable)
    .where(and(eq(webPushLogsTable.restaurantId, restaurantId), eq(webPushLogsTable.status, "sent"), gte(webPushLogsTable.createdAt, since)));
  const [{ failed }] = await db.select({ failed: sql<number>`count(*)::int` }).from(webPushLogsTable)
    .where(and(eq(webPushLogsTable.restaurantId, restaurantId), eq(webPushLogsTable.status, "failed"), gte(webPushLogsTable.createdAt, since)));
  const recent = await db.select().from(webPushLogsTable)
    .where(eq(webPushLogsTable.restaurantId, restaurantId))
    .orderBy(desc(webPushLogsTable.createdAt))
    .limit(50);
  res.json({ activeSubscribers, sent, failed, recent });
});

export default router;
