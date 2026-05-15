import { Router } from "express";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  db,
  notificationBroadcastsTable,
  notificationDeliveriesTable,
  notificationTemplatesTable,
  auditLogsTable,
  type AudienceFilter,
  type BroadcastChannel,
  type BroadcastPriority,
  type DeliveryStatus,
} from "../lib/db";
import { requireSuperAdmin } from "../middleware/authorize";
import {
  dispatchBroadcast,
  resolveAudience,
  retryDelivery,
  resendFailedDeliveries,
  getChannelCapabilities,
} from "../lib/notificationCenter";
import { logger } from "../lib/logger";

const router = Router();

const ALLOWED_CHANNELS: BroadcastChannel[] = ["in_app", "email", "sms", "whatsapp", "push"];
const ALLOWED_PRIORITIES: BroadcastPriority[] = ["low", "medium", "high", "urgent"];
const ALLOWED_DELIVERY_STATUSES: DeliveryStatus[] = ["queued", "sent", "delivered", "failed", "skipped", "pending"];

function parseAudience(input: unknown): AudienceFilter {
  if (!input || typeof input !== "object") return {};
  const a = input as Record<string, unknown>;
  const out: AudienceFilter = {};
  const numArr = (v: unknown): number[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const arr = v.map(Number).filter(Number.isFinite);
    return arr.length ? arr : undefined;
  };
  const strArr = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const arr = v.map(String).map(s => s.trim()).filter(Boolean);
    return arr.length ? arr : undefined;
  };
  const tenantIds = numArr(a.tenantIds); if (tenantIds) out.tenantIds = tenantIds;
  const planIds = numArr(a.planIds); if (planIds) out.planIds = planIds;
  const planStatuses = strArr(a.planStatuses); if (planStatuses) out.planStatuses = planStatuses;
  const countries = strArr(a.countries); if (countries) out.countries = countries;
  const cities = strArr(a.cities); if (cities) out.cities = cities;
  const roles = strArr(a.roles); if (roles) out.roles = roles;
  return out;
}

function parseChannels(input: unknown): BroadcastChannel[] {
  if (!Array.isArray(input)) return [];
  const list = input.map(String).filter((c): c is BroadcastChannel => (ALLOWED_CHANNELS as string[]).includes(c));
  return Array.from(new Set(list));
}

function parsePriority(input: unknown): BroadcastPriority {
  const s = String(input ?? "medium");
  return (ALLOWED_PRIORITIES as string[]).includes(s) ? (s as BroadcastPriority) : "medium";
}

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ─── Templates ────────────────────────────────────────────────────
router.get("/admin/notification-templates", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select().from(notificationTemplatesTable).orderBy(desc(notificationTemplatesTable.updatedAt));
  res.json({ data: rows });
});

router.post("/admin/notification-templates", requireSuperAdmin, async (req, res) => {
  const { name, slug, channel, subject, body, variables } = req.body as {
    name?: string; slug?: string; channel?: BroadcastChannel; subject?: string; body?: string; variables?: string[];
  };
  if (!name || !slug || !body) return void res.status(400).json({ error: "name, slug, body are required" });
  if (channel && !ALLOWED_CHANNELS.includes(channel)) return void res.status(400).json({ error: "Invalid channel" });
  try {
    const [created] = await db.insert(notificationTemplatesTable).values({
      name, slug,
      channel: channel ?? "in_app",
      subject: subject ?? null,
      body,
      variables: Array.isArray(variables) ? variables : [],
      createdBy: req.user?.id ?? null,
    }).returning();
    res.status(201).json(created);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return void res.status(409).json({ error: "A template with that slug already exists" });
    }
    throw err;
  }
});

router.put("/admin/notification-templates/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const { name, channel, subject, body, variables } = req.body as {
    name?: string; channel?: BroadcastChannel; subject?: string; body?: string; variables?: string[];
  };
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) patch.name = name;
  if (channel !== undefined) {
    if (!ALLOWED_CHANNELS.includes(channel)) return void res.status(400).json({ error: "Invalid channel" });
    patch.channel = channel;
  }
  if (subject !== undefined) patch.subject = subject;
  if (body !== undefined) patch.body = body;
  if (variables !== undefined) patch.variables = Array.isArray(variables) ? variables : [];
  const [updated] = await db.update(notificationTemplatesTable).set(patch).where(eq(notificationTemplatesTable.id, id)).returning();
  if (!updated) return void res.status(404).json({ error: "Template not found" });
  res.json(updated);
});

router.delete("/admin/notification-templates/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  await db.delete(notificationTemplatesTable).where(eq(notificationTemplatesTable.id, id));
  res.json({ ok: true });
});

// ─── Audience preview ────────────────────────────────────────────
router.post("/admin/broadcasts/audience-preview", requireSuperAdmin, async (req, res) => {
  const audience = parseAudience(req.body?.audience);
  try {
    const recipients = await resolveAudience(audience);
    res.json({
      total: recipients.length,
      withEmail: recipients.filter(r => r.email).length,
      withPhone: recipients.filter(r => r.phone).length,
      withPush: recipients.filter(r => r.pushTokens.length > 0).length,
      sample: recipients.slice(0, 8).map(r => ({
        tenantId: r.tenantId, name: r.name, email: r.email, phone: r.phone,
      })),
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ─── Broadcasts ──────────────────────────────────────────────────
router.get("/admin/broadcasts/channel-capabilities", requireSuperAdmin, (_req, res) => {
  res.json({ data: getChannelCapabilities() });
});

router.get("/admin/broadcasts", requireSuperAdmin, async (req, res) => {
  const status = (req.query.status as string | undefined) ?? "all";
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const where = status === "all" ? undefined : eq(notificationBroadcastsTable.status, status as never);

  const [rows, totalRow] = await Promise.all([
    db.select().from(notificationBroadcastsTable)
      .where(where)
      .orderBy(desc(notificationBroadcastsTable.createdAt))
      .limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` })
      .from(notificationBroadcastsTable)
      .where(where),
  ]);
  res.json({ data: rows, total: totalRow[0]?.count ?? 0, limit, offset });
});

// Per-channel breakdown for one broadcast (for the Sent detail panel).
router.get("/admin/broadcasts/:id/recipient-stats", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const rows = await db.select({
    channel: notificationDeliveriesTable.channel,
    status: notificationDeliveriesTable.status,
    count: sql<number>`count(*)::int`,
  })
    .from(notificationDeliveriesTable)
    .where(eq(notificationDeliveriesTable.broadcastId, id))
    .groupBy(notificationDeliveriesTable.channel, notificationDeliveriesTable.status);
  res.json({ data: rows });
});

router.get("/admin/broadcasts/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [bc] = await db.select().from(notificationBroadcastsTable).where(eq(notificationBroadcastsTable.id, id));
  if (!bc) return void res.status(404).json({ error: "Not found" });
  res.json({ broadcast: bc });
});

router.get("/admin/broadcasts/:id/recipients", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });

  const channel = typeof req.query.channel === "string" ? req.query.channel : "all";
  const status = typeof req.query.status === "string" ? req.query.status : "all";
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const tenantIdFilter = parseId(req.query.tenantId);
  const dateFromRaw = typeof req.query.dateFrom === "string" ? req.query.dateFrom : "";
  const dateToRaw = typeof req.query.dateTo === "string" ? req.query.dateTo : "";
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

  const conditions: SQL[] = [eq(notificationDeliveriesTable.broadcastId, id)];
  if (channel !== "all" && (ALLOWED_CHANNELS as string[]).includes(channel)) {
    conditions.push(eq(notificationDeliveriesTable.channel, channel as BroadcastChannel));
  }
  if (status !== "all" && (ALLOWED_DELIVERY_STATUSES as string[]).includes(status)) {
    conditions.push(eq(notificationDeliveriesTable.status, status as DeliveryStatus));
  }
  if (tenantIdFilter) conditions.push(eq(notificationDeliveriesTable.tenantId, tenantIdFilter));
  if (dateFromRaw) {
    const d = new Date(dateFromRaw);
    if (!Number.isNaN(d.getTime())) conditions.push(sql`${notificationDeliveriesTable.createdAt} >= ${d}`);
  }
  if (dateToRaw) {
    const d = new Date(dateToRaw);
    if (!Number.isNaN(d.getTime())) conditions.push(sql`${notificationDeliveriesTable.createdAt} <= ${d}`);
  }
  if (search) {
    conditions.push(sql`(${notificationDeliveriesTable.recipient} ILIKE ${"%" + search + "%"} OR ${notificationDeliveriesTable.error} ILIKE ${"%" + search + "%"})`);
  }

  const rows = await db.select().from(notificationDeliveriesTable)
    .where(and(...conditions))
    .orderBy(desc(notificationDeliveriesTable.createdAt))
    .limit(limit);
  res.json({ data: rows });
});

router.post("/admin/broadcasts", requireSuperAdmin, async (req, res) => {
  const { title, message, subject, channels, audience, templateId, scheduledAt, sendNow, priority, saveAsTemplate, templateName, templateSlug } = req.body as {
    title?: string; message?: string; subject?: string;
    channels?: unknown; audience?: unknown; templateId?: number | null;
    scheduledAt?: string | null; sendNow?: boolean;
    priority?: BroadcastPriority;
    saveAsTemplate?: boolean; templateName?: string; templateSlug?: string;
  };
  if (!title || !message) return void res.status(400).json({ error: "title and message are required" });
  const ch = parseChannels(channels);
  if (ch.length === 0) return void res.status(400).json({ error: "Pick at least one channel" });
  const parsedAudience = parseAudience(audience);

  let scheduled: Date | null = null;
  let status: "draft" | "scheduled" = "draft";
  if (scheduledAt && !sendNow) {
    const d = new Date(scheduledAt);
    if (Number.isNaN(d.getTime())) return void res.status(400).json({ error: "Invalid scheduledAt" });
    scheduled = d;
    status = "scheduled";
  }

  const [created] = await db.insert(notificationBroadcastsTable).values({
    title,
    message,
    subject: subject ?? null,
    channels: ch,
    audience: parsedAudience,
    priority: parsePriority(priority),
    templateId: templateId ?? null,
    status,
    scheduledAt: scheduled,
    createdBy: req.user?.id ?? null,
  }).returning();

  // Optional: save the compose body as a reusable template.
  if (saveAsTemplate && templateName && templateSlug) {
    try {
      await db.insert(notificationTemplatesTable).values({
        name: templateName,
        slug: templateSlug,
        channel: ch[0],
        subject: subject ?? null,
        body: message,
        variables: [],
        createdBy: req.user?.id ?? null,
      });
    } catch (err) {
      logger.warn({ err }, "saveAsTemplate failed (likely duplicate slug)");
    }
  }

  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "broadcast.created",
    entity: "notification_broadcast",
    entityId: created.id,
    details: `channels=${ch.join(",")} status=${status} priority=${created.priority}`,
  });

  if (sendNow) {
    dispatchBroadcast(created.id).catch(err => logger.error({ err, broadcastId: created.id }, "sendNow dispatch failed"));
  }

  res.status(201).json(created);
});

// Edit a draft or scheduled broadcast.
router.put("/admin/broadcasts/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(notificationBroadcastsTable).where(eq(notificationBroadcastsTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  if (existing.status !== "draft" && existing.status !== "scheduled") {
    return void res.status(400).json({ error: `Cannot edit a ${existing.status} broadcast` });
  }

  const { title, message, subject, channels, audience, scheduledAt, priority } = req.body as {
    title?: string; message?: string; subject?: string;
    channels?: unknown; audience?: unknown;
    scheduledAt?: string | null; priority?: BroadcastPriority;
  };
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (title !== undefined) patch.title = title;
  if (message !== undefined) patch.message = message;
  if (subject !== undefined) patch.subject = subject;
  if (channels !== undefined) {
    const ch = parseChannels(channels);
    if (ch.length === 0) return void res.status(400).json({ error: "Pick at least one channel" });
    patch.channels = ch;
  }
  if (audience !== undefined) patch.audience = parseAudience(audience);
  if (priority !== undefined) patch.priority = parsePriority(priority);
  if (scheduledAt !== undefined) {
    if (scheduledAt === null || scheduledAt === "") {
      patch.scheduledAt = null;
      patch.status = "draft";
    } else {
      const d = new Date(scheduledAt);
      if (Number.isNaN(d.getTime())) return void res.status(400).json({ error: "Invalid scheduledAt" });
      patch.scheduledAt = d;
      patch.status = "scheduled";
    }
  }

  const [updated] = await db.update(notificationBroadcastsTable)
    .set(patch)
    .where(and(
      eq(notificationBroadcastsTable.id, id),
      sql`${notificationBroadcastsTable.status} IN ('draft','scheduled')`,
    ))
    .returning();
  if (!updated) return void res.status(409).json({ error: "Broadcast state changed; reload and retry" });

  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "broadcast.edited",
    entity: "notification_broadcast",
    entityId: id,
  });
  res.json(updated);
});

router.post("/admin/broadcasts/:id/send", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [bc] = await db.select().from(notificationBroadcastsTable).where(eq(notificationBroadcastsTable.id, id));
  if (!bc) return void res.status(404).json({ error: "Not found" });
  if (bc.status !== "draft" && bc.status !== "scheduled") {
    return void res.status(400).json({ error: `Cannot send a ${bc.status} broadcast` });
  }
  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "broadcast.sent_manually",
    entity: "notification_broadcast",
    entityId: id,
  });
  dispatchBroadcast(id).catch(err => logger.error({ err, broadcastId: id }, "Manual dispatch failed"));
  res.json({ ok: true });
});

router.post("/admin/broadcasts/:id/cancel", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [bc] = await db.select().from(notificationBroadcastsTable).where(eq(notificationBroadcastsTable.id, id));
  if (!bc) return void res.status(404).json({ error: "Not found" });
  if (bc.status !== "scheduled" && bc.status !== "draft") {
    return void res.status(400).json({ error: `Cannot cancel a ${bc.status} broadcast` });
  }
  await db.update(notificationBroadcastsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(notificationBroadcastsTable.id, id));
  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "broadcast.cancelled",
    entity: "notification_broadcast",
    entityId: id,
  });
  res.json({ ok: true });
});

router.post("/admin/broadcasts/:id/resend-failed", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  try {
    const result = await resendFailedDeliveries(id);
    await db.insert(auditLogsTable).values({
      userId: req.user?.id ?? null,
      action: "broadcast.resend_failed",
      entity: "notification_broadcast",
      entityId: id,
      details: `retried=${result.retried} succeeded=${result.succeeded}`,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/admin/broadcasts/:id/recipients/:rid/retry", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  const rid = parseId(req.params.rid);
  if (!id || !rid) return void res.status(400).json({ error: "Invalid id" });
  try {
    const [delivery] = await db.select().from(notificationDeliveriesTable).where(eq(notificationDeliveriesTable.id, rid));
    if (!delivery || delivery.broadcastId !== id) return void res.status(404).json({ error: "Delivery not found" });
    const updated = await retryDelivery(rid);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.delete("/admin/broadcasts/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  await db.delete(notificationBroadcastsTable).where(eq(notificationBroadcastsTable.id, id));
  res.json({ ok: true });
});

// ─── Stats ───────────────────────────────────────────────────────
router.get("/admin/broadcasts-stats", requireSuperAdmin, async (_req, res) => {
  const rows = await db
    .select({
      status: notificationBroadcastsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(notificationBroadcastsTable)
    .groupBy(notificationBroadcastsTable.status);
  const totals = await db
    .select({
      totalRecipients: sql<number>`coalesce(sum(${notificationBroadcastsTable.totalRecipients}), 0)::int`,
      successCount: sql<number>`coalesce(sum(${notificationBroadcastsTable.successCount}), 0)::int`,
      failureCount: sql<number>`coalesce(sum(${notificationBroadcastsTable.failureCount}), 0)::int`,
    })
    .from(notificationBroadcastsTable);
  res.json({ byStatus: rows, totals: totals[0] ?? { totalRecipients: 0, successCount: 0, failureCount: 0 } });
});

export default router;
