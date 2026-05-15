import { Router, type Request, type Response } from "express";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  db,
  whatsappSettingsTable,
  whatsappTemplatesTable,
  whatsappLogsTable,
  whatsappUsageTable,
  restaurantsTable,
  tenantsTable,
  subscriptionPlansTable,
  auditLogsTable,
} from "../lib/db";
import { requireRole, requireSuperAdmin } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import {
  getPlatformSettings,
  getRestaurantSettings,
  upsertSettings,
  maskSettings,
  syncTemplates,
  sendWhatsAppMessage,
  retryWhatsAppLog,
  retryFailedLogs,
  getUsage,
  getEffectiveLimit,
  resolveCredsForRestaurant,
  findWebhookCredsForVerify,
  processWebhookEvent,
  getWebhookUrl,
} from "../lib/whatsapp";
import { logger } from "../lib/logger";

const router = Router();

const ALLOWED_STATUSES = new Set(["queued", "sent", "delivered", "read", "failed", "blocked"]);

function parseInt1(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function logsToCsv(rows: Array<Record<string, unknown>>): string {
  const headers = ["id", "createdAt", "restaurantId", "recipient", "templateName", "status", "providerMessageId", "cost", "costCurrency", "reason"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map(h => csvEscape(r[h])).join(","));
  }
  return lines.join("\n");
}

// ─── Public webhook (no auth) ─────────────────────────────────────
export const whatsappPublicRouter = Router();

whatsappPublicRouter.get("/whatsapp/webhook", async (req, res) => {
  const mode = String(req.query["hub.mode"] ?? "");
  const token = String(req.query["hub.verify_token"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");
  if (mode !== "subscribe" || !token) {
    return void res.status(400).send("Bad request");
  }
  const ok = await findWebhookCredsForVerify(token);
  if (!ok) return void res.status(403).send("Forbidden");
  res.status(200).send(challenge);
});

whatsappPublicRouter.post("/whatsapp/webhook", async (req: Request, res: Response) => {
  try {
    await processWebhookEvent(req.body ?? {});
  } catch (err) {
    logger.error({ err }, "WhatsApp webhook processing failed");
  }
  // Always 200 — Meta retries on non-2xx, and we don't want to thrash.
  res.status(200).json({ received: true });
});

// ─── Super-admin routes ───────────────────────────────────────────

router.get("/admin/whatsapp/settings", requireSuperAdmin, async (_req, res) => {
  const row = await getPlatformSettings();
  res.json({ settings: maskSettings(row), webhookUrl: getWebhookUrl() });
});

router.put("/admin/whatsapp/settings", requireSuperAdmin, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const row = await upsertSettings("platform", null, body, req.user?.sub ?? null);
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    action: "whatsapp.platform_settings.updated",
    entity: "whatsapp_settings",
    entityId: row.id,
  });
  res.json({ settings: maskSettings(row), webhookUrl: getWebhookUrl() });
});

router.post("/admin/whatsapp/sync-templates", requireSuperAdmin, async (req, res) => {
  try {
    const result = await syncTemplates("platform", null);
    await db.insert(auditLogsTable).values({
      userId: req.user?.sub ?? null,
      action: "whatsapp.platform_templates.synced",
      entity: "whatsapp_settings",
      details: `synced=${result.synced}`,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post("/admin/whatsapp/test", requireSuperAdmin, async (req, res) => {
  const { to, body, templateName, templateLanguage, templateVariables } = req.body as {
    to?: string; body?: string; templateName?: string; templateLanguage?: string; templateVariables?: string[];
  };
  if (!to) return void res.status(400).json({ error: "to is required" });
  if (!body && !templateName) return void res.status(400).json({ error: "body or templateName is required" });
  const result = await sendWhatsAppMessage({
    restaurantId: null,
    to,
    body,
    templateName,
    templateLanguage,
    templateVariables,
    meta: { source: "admin_test" },
    sentBy: req.user?.sub ?? null,
    skipQuota: true,
  });
  // Persist the test outcome on the platform settings row for UI feedback.
  await db.update(whatsappSettingsTable).set({
    lastTestAt: new Date(),
    lastTestStatus: result.status,
    lastTestError: result.error ?? null,
    updatedAt: new Date(),
  }).where(eq(whatsappSettingsTable.scope, "platform"));
  res.json(result);
});

router.get("/admin/whatsapp/templates", requireSuperAdmin, async (req, res) => {
  const scope = String(req.query.scope ?? "platform");
  const conds: SQL[] = [eq(whatsappTemplatesTable.scope, scope)];
  if (scope === "restaurant" && req.query.restaurantId) {
    const rid = parseInt1(req.query.restaurantId);
    if (rid) conds.push(eq(whatsappTemplatesTable.restaurantId, rid));
  }
  const rows = await db.select().from(whatsappTemplatesTable)
    .where(and(...conds))
    .orderBy(desc(whatsappTemplatesTable.syncedAt))
    .limit(500);
  res.json({ data: rows });
});

router.put("/admin/whatsapp/templates/:id/default-event", requireSuperAdmin, async (req, res) => {
  const id = parseInt1(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const { event } = req.body as { event?: string | null };
  // Clear other defaults for the same event within the same scope.
  if (event) {
    const [tpl] = await db.select().from(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, id));
    if (tpl) {
      await db.update(whatsappTemplatesTable)
        .set({ defaultForEvent: null })
        .where(and(eq(whatsappTemplatesTable.scope, tpl.scope), eq(whatsappTemplatesTable.defaultForEvent, event)));
    }
  }
  const [updated] = await db.update(whatsappTemplatesTable)
    .set({ defaultForEvent: event ?? null })
    .where(eq(whatsappTemplatesTable.id, id))
    .returning();
  res.json(updated);
});

async function listLogs(req: Request, scope: "all" | { restaurantId: number }): Promise<Array<Record<string, unknown>>> {
  const conds: SQL[] = [];
  if (scope !== "all") conds.push(eq(whatsappLogsTable.restaurantId, scope.restaurantId));
  if (req.query.restaurantId && scope === "all") {
    const rid = parseInt1(req.query.restaurantId);
    if (rid) conds.push(eq(whatsappLogsTable.restaurantId, rid));
  }
  if (req.query.status) {
    const s = String(req.query.status);
    if (ALLOWED_STATUSES.has(s)) conds.push(eq(whatsappLogsTable.status, s));
    else if (s === "failed_or_blocked") conds.push(sql`${whatsappLogsTable.status} IN ('failed','blocked')`);
  }
  if (req.query.template) {
    conds.push(eq(whatsappLogsTable.templateName, String(req.query.template)));
  }
  if (req.query.from) {
    const d = new Date(String(req.query.from));
    if (!Number.isNaN(d.getTime())) conds.push(sql`${whatsappLogsTable.createdAt} >= ${d}`);
  }
  if (req.query.to) {
    const d = new Date(String(req.query.to));
    if (!Number.isNaN(d.getTime())) conds.push(sql`${whatsappLogsTable.createdAt} <= ${d}`);
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
  const rows = await db.select().from(whatsappLogsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(whatsappLogsTable.createdAt))
    .limit(limit);
  return rows as unknown as Array<Record<string, unknown>>;
}

router.get("/admin/whatsapp/logs", requireSuperAdmin, async (req, res) => {
  const rows = await listLogs(req, "all");
  if (req.query.export === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="whatsapp-logs.csv"`);
    return void res.send(logsToCsv(rows));
  }
  res.json({ data: rows });
});

router.post("/admin/whatsapp/logs/:id/retry", requireSuperAdmin, async (req, res) => {
  const id = parseInt1(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  try {
    const result = await retryWhatsAppLog(id, req.user?.sub ?? null);
    await db.insert(auditLogsTable).values({
      userId: req.user?.sub ?? null,
      action: "whatsapp.log.retried",
      entity: "whatsapp_logs",
      entityId: id,
      details: `status=${result.status}`,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post("/admin/whatsapp/logs/retry-failed", requireSuperAdmin, async (req, res) => {
  const result = await retryFailedLogs("platform", null, req.user?.sub ?? null);
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    action: "whatsapp.logs.retry_failed",
    entity: "whatsapp_logs",
    details: `retried=${result.retried} succeeded=${result.succeeded}`,
  });
  res.json(result);
});

router.get("/admin/whatsapp/usage", requireSuperAdmin, async (_req, res) => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const rows = await db.select({
    restaurantId: restaurantsTable.id,
    restaurantName: restaurantsTable.name,
    tenantId: tenantsTable.id,
    tenantName: tenantsTable.name,
    planLimit: subscriptionPlansTable.whatsappMonthlyLimit,
    override: restaurantsTable.whatsappMonthlyLimitOverride,
    sent: whatsappUsageTable.sent,
    success: whatsappUsageTable.success,
    failure: whatsappUsageTable.failure,
    blocked: whatsappUsageTable.blocked,
  })
    .from(restaurantsTable)
    .leftJoin(tenantsTable, eq(tenantsTable.id, restaurantsTable.tenantId))
    .leftJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, tenantsTable.planId))
    .leftJoin(whatsappUsageTable, and(
      eq(whatsappUsageTable.restaurantId, restaurantsTable.id),
      eq(whatsappUsageTable.year, year),
      eq(whatsappUsageTable.month, month),
    ))
    .orderBy(restaurantsTable.name)
    .limit(500);
  res.json({
    period: { year, month },
    data: rows.map(r => ({
      ...r,
      effectiveLimit: r.override ?? r.planLimit ?? 0,
      sent: r.sent ?? 0,
      success: r.success ?? 0,
      failure: r.failure ?? 0,
      blocked: r.blocked ?? 0,
    })),
  });
});

router.put("/admin/restaurants/:id/whatsapp-limit", requireSuperAdmin, async (req, res) => {
  const id = parseInt1(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const { override } = req.body as { override?: number | null };
  const value = override === null || override === undefined || override === ("" as unknown) ? null : Number(override);
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    return void res.status(400).json({ error: "override must be a non-negative number or null" });
  }
  const [row] = await db.update(restaurantsTable)
    .set({ whatsappMonthlyLimitOverride: value })
    .where(eq(restaurantsTable.id, id))
    .returning();
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    action: "whatsapp.restaurant_limit.updated",
    entity: "restaurants",
    entityId: id,
    details: `override=${value ?? "null"}`,
  });
  res.json(row);
});

// ─── Restaurant-scoped routes ─────────────────────────────────────

router.get("/restaurants/:restaurantId/whatsapp/settings", requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const row = await getRestaurantSettings(rid);
  // Also return whether platform creds exist so the UI can offer "use platform account".
  const platform = await getPlatformSettings();
  res.json({
    settings: maskSettings(row),
    webhookUrl: getWebhookUrl(),
    platformAvailable: !!platform?.isEnabled && !!platform?.accessToken && !!platform?.phoneNumberId,
  });
});

router.put("/restaurants/:restaurantId/whatsapp/settings", requireRole("owner", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const row = await upsertSettings("restaurant", rid, req.body as Record<string, unknown>, req.user?.sub ?? null);
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    restaurantId: rid,
    action: "whatsapp.settings.updated",
    entity: "whatsapp_settings",
    entityId: row.id,
  });
  res.json({ settings: maskSettings(row), webhookUrl: getWebhookUrl() });
});

router.post("/restaurants/:restaurantId/whatsapp/sync-templates", requireRole("owner", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const rid = Number(req.params.restaurantId);
  try {
    const result = await syncTemplates("restaurant", rid);
    await db.insert(auditLogsTable).values({
      userId: req.user?.sub ?? null,
      restaurantId: rid,
      action: "whatsapp.templates.synced",
      entity: "whatsapp_settings",
      details: `synced=${result.synced}`,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post("/restaurants/:restaurantId/whatsapp/test", requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const { to, body, templateName, templateLanguage, templateVariables } = req.body as {
    to?: string; body?: string; templateName?: string; templateLanguage?: string; templateVariables?: string[];
  };
  if (!to) return void res.status(400).json({ error: "to is required" });
  if (!body && !templateName) return void res.status(400).json({ error: "body or templateName is required" });
  const result = await sendWhatsAppMessage({
    restaurantId: rid,
    tenantId: req.user?.tenantId ?? null,
    to,
    body,
    templateName,
    templateLanguage,
    templateVariables,
    meta: { source: "restaurant_test" },
    sentBy: req.user?.sub ?? null,
    skipQuota: true,
  });
  // Persist test outcome on the restaurant settings row.
  const existing = await getRestaurantSettings(rid);
  if (existing) {
    await db.update(whatsappSettingsTable).set({
      lastTestAt: new Date(),
      lastTestStatus: result.status,
      lastTestError: result.error ?? null,
      updatedAt: new Date(),
    }).where(eq(whatsappSettingsTable.id, existing.id));
  }
  res.json(result);
});

router.get("/restaurants/:restaurantId/whatsapp/templates", requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const rid = Number(req.params.restaurantId);
  // Surface own templates AND platform templates if the restaurant uses platform creds.
  const creds = await resolveCredsForRestaurant(rid);
  const conds: SQL[] = [];
  if (creds.source === "platform") {
    conds.push(eq(whatsappTemplatesTable.scope, "platform"));
  } else {
    conds.push(and(eq(whatsappTemplatesTable.scope, "restaurant"), eq(whatsappTemplatesTable.restaurantId, rid))!);
  }
  const rows = await db.select().from(whatsappTemplatesTable)
    .where(and(...conds))
    .orderBy(desc(whatsappTemplatesTable.syncedAt))
    .limit(500);
  res.json({ data: rows, source: creds.source });
});

router.put("/restaurants/:restaurantId/whatsapp/templates/:id/event", requireRole("owner", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const id = parseInt1(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const { event } = req.body as { event?: string | null };
  const [tpl] = await db.select().from(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, id));
  if (!tpl) return void res.status(404).json({ error: "Template not found" });
  if (tpl.scope === "restaurant" && tpl.restaurantId !== rid) {
    return void res.status(403).json({ error: "Cross-restaurant template" });
  }
  // Restaurant cannot change platform-template defaults; we store it as a per-restaurant mapping in settings instead.
  if (tpl.scope === "platform") {
    return void res.status(400).json({ error: "Cannot mark a platform template as restaurant default; switch to your own credentials and sync your templates." });
  }
  if (event) {
    await db.update(whatsappTemplatesTable)
      .set({ defaultForEvent: null })
      .where(and(eq(whatsappTemplatesTable.scope, "restaurant"), eq(whatsappTemplatesTable.restaurantId, rid), eq(whatsappTemplatesTable.defaultForEvent, event)));
  }
  const [updated] = await db.update(whatsappTemplatesTable)
    .set({ defaultForEvent: event ?? null })
    .where(eq(whatsappTemplatesTable.id, id))
    .returning();
  res.json(updated);
});

router.get("/restaurants/:restaurantId/whatsapp/logs", requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const rows = await listLogs(req, { restaurantId: rid });
  if (req.query.export === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="whatsapp-logs.csv"`);
    return void res.send(logsToCsv(rows));
  }
  res.json({ data: rows });
});

router.post("/restaurants/:restaurantId/whatsapp/logs/:id/retry", requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const id = parseInt1(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [row] = await db.select().from(whatsappLogsTable).where(eq(whatsappLogsTable.id, id));
  if (!row || row.restaurantId !== rid) return void res.status(404).json({ error: "Not found" });
  try {
    const result = await retryWhatsAppLog(id, req.user?.sub ?? null);
    await db.insert(auditLogsTable).values({
      userId: req.user?.sub ?? null,
      restaurantId: rid,
      action: "whatsapp.log.retried",
      entity: "whatsapp_logs",
      entityId: id,
      details: `status=${result.status}`,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post("/restaurants/:restaurantId/whatsapp/logs/retry-failed", requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const result = await retryFailedLogs("restaurant", rid, req.user?.sub ?? null);
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    restaurantId: rid,
    action: "whatsapp.logs.retry_failed",
    entity: "whatsapp_logs",
    details: `retried=${result.retried} succeeded=${result.succeeded}`,
  });
  res.json(result);
});

router.get("/restaurants/:restaurantId/whatsapp/usage", requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const usage = await getUsage(rid);
  res.json(usage);
});

router.post("/restaurants/:restaurantId/whatsapp/announce", requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const { recipients, templateName, templateLanguage, templateVariables, body } = req.body as {
    recipients?: string[]; templateName?: string; templateLanguage?: string; templateVariables?: string[]; body?: string;
  };
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return void res.status(400).json({ error: "recipients (string[]) is required" });
  }
  if (!templateName && !body) return void res.status(400).json({ error: "templateName or body is required" });

  let sent = 0, failed = 0, blocked = 0;
  for (const to of recipients) {
    const out = await sendWhatsAppMessage({
      restaurantId: rid,
      tenantId: req.user?.tenantId ?? null,
      to,
      body,
      templateName,
      templateLanguage,
      templateVariables,
      meta: { source: "restaurant_announcement" },
      sentBy: req.user?.sub ?? null,
    });
    if (out.status === "sent") sent++;
    else if (out.status === "blocked") blocked++;
    else failed++;
  }
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    restaurantId: rid,
    action: "whatsapp.announcement.sent",
    entity: "whatsapp_logs",
    details: `sent=${sent} failed=${failed} blocked=${blocked}`,
  });
  res.json({ sent, failed, blocked, total: recipients.length });
});

export default router;
