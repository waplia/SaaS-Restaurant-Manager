import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  notificationBroadcastsTable,
  notificationDeliveriesTable,
  notificationTemplatesTable,
  auditLogsTable,
  type AudienceFilter,
  type BroadcastChannel,
} from "../lib/db";
import { requireSuperAdmin } from "../middleware/authorize";
import { dispatchBroadcast, resolveAudience } from "../lib/notificationCenter";
import { logger } from "../lib/logger";

const router = Router();

const ALLOWED_CHANNELS: BroadcastChannel[] = ["in_app", "email", "sms", "whatsapp", "push"];
const ALLOWED_AUDIENCE_TYPES: AudienceFilter["type"][] = ["all", "tenants", "plan_status", "plan", "role", "country", "city"];

function parseAudience(input: unknown): AudienceFilter {
  if (!input || typeof input !== "object") return { type: "all" };
  const a = input as Record<string, unknown>;
  const rawType = String(a.type ?? "all");
  if (!(ALLOWED_AUDIENCE_TYPES as string[]).includes(rawType)) {
    throw new Error(`Invalid audience type: ${rawType}`);
  }
  const type = rawType as AudienceFilter["type"];
  const out: AudienceFilter = { type };
  if (Array.isArray(a.ids)) out.ids = a.ids.map(Number).filter(Number.isFinite);
  if (Array.isArray(a.values)) out.values = a.values.map(String);
  return out;
}

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseChannels(input: unknown): BroadcastChannel[] {
  if (!Array.isArray(input)) return [];
  const list = input.map(String).filter((c): c is BroadcastChannel => (ALLOWED_CHANNELS as string[]).includes(c));
  return Array.from(new Set(list));
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
  let audience: AudienceFilter;
  try { audience = parseAudience(req.body?.audience); }
  catch (err) { return void res.status(400).json({ error: (err as Error).message }); }
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
router.get("/admin/broadcasts", requireSuperAdmin, async (req, res) => {
  const status = (req.query.status as string | undefined) ?? "all";
  const where = status === "all" ? undefined : eq(notificationBroadcastsTable.status, status as never);
  const rows = await db.select().from(notificationBroadcastsTable)
    .where(where)
    .orderBy(desc(notificationBroadcastsTable.createdAt))
    .limit(200);
  res.json({ data: rows });
});

router.get("/admin/broadcasts/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [bc] = await db.select().from(notificationBroadcastsTable).where(eq(notificationBroadcastsTable.id, id));
  if (!bc) return void res.status(404).json({ error: "Not found" });
  const deliveries = await db.select().from(notificationDeliveriesTable)
    .where(eq(notificationDeliveriesTable.broadcastId, id))
    .orderBy(desc(notificationDeliveriesTable.createdAt))
    .limit(500);
  res.json({ broadcast: bc, deliveries });
});

router.post("/admin/broadcasts", requireSuperAdmin, async (req, res) => {
  const { title, message, subject, channels, audience, templateId, scheduledAt, sendNow } = req.body as {
    title?: string; message?: string; subject?: string;
    channels?: unknown; audience?: unknown; templateId?: number | null;
    scheduledAt?: string | null; sendNow?: boolean;
  };
  if (!title || !message) return void res.status(400).json({ error: "title and message are required" });
  const ch = parseChannels(channels);
  if (ch.length === 0) return void res.status(400).json({ error: "Pick at least one channel" });

  let parsedAudience: AudienceFilter;
  try { parsedAudience = parseAudience(audience); }
  catch (err) { return void res.status(400).json({ error: (err as Error).message }); }

  let scheduled: Date | null = null;
  let status: "draft" | "scheduled" = "draft";
  if (scheduledAt) {
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
    templateId: templateId ?? null,
    status,
    scheduledAt: scheduled,
    createdBy: req.user?.id ?? null,
  }).returning();

  await db.insert(auditLogsTable).values({
    userId: req.user?.id ?? null,
    action: "broadcast.created",
    entity: "notification_broadcast",
    entityId: created.id,
    details: `channels=${ch.join(",")} status=${status}`,
  });

  if (sendNow) {
    // Fire-and-forget; client polls list/details for status.
    dispatchBroadcast(created.id).catch(err => logger.error({ err, broadcastId: created.id }, "sendNow dispatch failed"));
  }

  res.status(201).json(created);
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
      total: sql<number>`coalesce(sum(${notificationBroadcastsTable.totalRecipients}), 0)::int`,
      success: sql<number>`coalesce(sum(${notificationBroadcastsTable.successCount}), 0)::int`,
      failure: sql<number>`coalesce(sum(${notificationBroadcastsTable.failureCount}), 0)::int`,
    })
    .from(notificationBroadcastsTable);
  res.json({ byStatus: rows, totals: totals[0] });
});

// Suppress unused-import warning for `and` (kept for future filters).
void and;

export default router;
