import { Router } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, campaignsTable, campaignLogsTable } from "../lib/db";
import type { NewCampaign } from "@workspace/db/schema";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

const CHANNELS = new Set(["whatsapp", "sms", "email", "push", "qr_banner"]);
const STATUSES = new Set(["draft", "scheduled", "sent", "paused", "completed"]);

// Legal status transitions. Backend is the source of truth — the UI also
// hides illegal buttons but we must not trust it.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft:     ["scheduled", "sent"],
  scheduled: ["sent", "paused", "draft"],
  paused:    ["scheduled", "draft"],
  sent:      ["completed"],
  completed: [],
};

function parseScheduledAt(input: unknown): { ok: true; value: Date | null } | { ok: false; error: string } {
  if (input === null || input === undefined || input === "") return { ok: true, value: null };
  const d = new Date(input as string);
  if (Number.isNaN(d.getTime())) return { ok: false, error: "scheduledAt is not a valid date" };
  return { ok: true, value: d };
}

const TYPES = new Set([
  "win_back",
  "birthday",
  "anniversary",
  "inactive",
  "first_order",
  "repeat_order",
  "festival",
  "slow_day",
  "item_specific",
  "segmentation",
  "whatsapp_draft",
  "sms_draft",
  "email_draft",
  "coupon_automation",
  "referral",
  "review_booster",
]);

router.use(
  "/restaurants/:restaurantId/growth",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);

// ───────── list (with filters) ─────────
router.get("/restaurants/:restaurantId/growth/campaigns", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { status, channel, type, q } = req.query as Record<string, string | undefined>;
  const wheres = [eq(campaignsTable.restaurantId, restaurantId)];
  if (status && STATUSES.has(status)) wheres.push(eq(campaignsTable.status, status));
  if (channel && CHANNELS.has(channel)) wheres.push(eq(campaignsTable.channel, channel));
  if (type && TYPES.has(type)) wheres.push(eq(campaignsTable.type, type));
  if (q && q.trim()) wheres.push(sql`${campaignsTable.name} ILIKE ${"%" + q.trim() + "%"}`);
  const rows = await db
    .select()
    .from(campaignsTable)
    .where(and(...wheres))
    .orderBy(desc(campaignsTable.updatedAt))
    .limit(500);
  res.json(rows);
});

// ───────── per-status counts for dashboard tiles ─────────
router.get("/restaurants/:restaurantId/growth/analytics", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select({
      status: campaignsTable.status,
      channel: campaignsTable.channel,
      type: campaignsTable.type,
      count: sql<number>`count(*)::int`,
    })
    .from(campaignsTable)
    .where(eq(campaignsTable.restaurantId, restaurantId))
    .groupBy(campaignsTable.status, campaignsTable.channel, campaignsTable.type);

  const byStatus: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + r.count;
    byChannel[r.channel] = (byChannel[r.channel] ?? 0) + r.count;
    byType[r.type] = (byType[r.type] ?? 0) + r.count;
    total += r.count;
  }
  res.json({ total, byStatus, byChannel, byType });
});

// ───────── recent activity log ─────────
router.get("/restaurants/:restaurantId/growth/logs", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const rows = await db
    .select()
    .from(campaignLogsTable)
    .where(eq(campaignLogsTable.restaurantId, restaurantId))
    .orderBy(desc(campaignLogsTable.createdAt))
    .limit(limit);
  res.json(rows);
});

// ───────── single campaign + its logs ─────────
router.get("/restaurants/:restaurantId/growth/campaigns/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [c] = await db
    .select()
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId)));
  if (!c) return void res.status(404).json({ error: "Not found" });
  const logs = await db
    .select()
    .from(campaignLogsTable)
    .where(and(eq(campaignLogsTable.campaignId, id), eq(campaignLogsTable.restaurantId, restaurantId)))
    .orderBy(desc(campaignLogsTable.createdAt))
    .limit(100);
  res.json({ campaign: c, logs });
});

// ───────── create ─────────
router.post("/restaurants/:restaurantId/growth/campaigns", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { name, type, channel, audience, content, scheduledAt } = req.body ?? {};
  if (!name?.trim()) return void res.status(400).json({ error: "name is required" });
  if (!type || !TYPES.has(type)) return void res.status(400).json({ error: "invalid type" });
  if (!channel || !CHANNELS.has(channel)) return void res.status(400).json({ error: "invalid channel" });
  const parsed = parseScheduledAt(scheduledAt);
  if (!parsed.ok) return void res.status(400).json({ error: parsed.error });

  const values: NewCampaign = {
    restaurantId,
    name: String(name).trim(),
    type,
    channel,
    status: parsed.value ? "scheduled" : "draft",
    audience: (audience && typeof audience === "object") ? audience : {},
    content: (content && typeof content === "object") ? content : {},
    stats: { sent: 0, delivered: 0, opened: 0, clicked: 0, converted: 0, revenue: 0 },
    scheduledAt: parsed.value,
    createdBy: req.user?.id ?? null,
  };

  const [c] = await db.insert(campaignsTable).values(values).returning();
  await db.insert(campaignLogsTable).values({
    campaignId: c.id,
    restaurantId,
    event: "created",
    actorId: req.user?.id ?? null,
    payload: { name: c.name, type: c.type, channel: c.channel, status: c.status },
  });
  res.status(201).json(c);
});

// ───────── update (any field) ─────────
router.patch("/restaurants/:restaurantId/growth/campaigns/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { name, type, channel, audience, content, scheduledAt } = req.body ?? {};

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) {
    if (!String(name).trim()) return void res.status(400).json({ error: "name cannot be empty" });
    updates.name = String(name).trim();
  }
  if (type !== undefined) {
    if (!TYPES.has(type)) return void res.status(400).json({ error: "invalid type" });
    updates.type = type;
  }
  if (channel !== undefined) {
    if (!CHANNELS.has(channel)) return void res.status(400).json({ error: "invalid channel" });
    updates.channel = channel;
  }
  if (audience !== undefined) updates.audience = (audience && typeof audience === "object") ? audience : {};
  if (content !== undefined) updates.content = (content && typeof content === "object") ? content : {};
  if (scheduledAt !== undefined) {
    const parsed = parseScheduledAt(scheduledAt);
    if (!parsed.ok) return void res.status(400).json({ error: parsed.error });
    updates.scheduledAt = parsed.value;
  }

  const [updated] = await db
    .update(campaignsTable)
    .set(updates)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId)))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });

  await db.insert(campaignLogsTable).values({
    campaignId: id,
    restaurantId,
    event: "updated",
    actorId: req.user?.id ?? null,
    payload: { fields: Object.keys(updates).filter(k => k !== "updatedAt") },
  });
  res.json(updated);
});

// ───────── status transitions ─────────
router.post("/restaurants/:restaurantId/growth/campaigns/:id/status", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { status } = req.body ?? {};
  if (!status || !STATUSES.has(status)) return void res.status(400).json({ error: "invalid status" });

  // Enforce state-machine integrity backend-side: load current status,
  // reject transitions not in ALLOWED_TRANSITIONS.
  const [current] = await db
    .select({ status: campaignsTable.status })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId)));
  if (!current) return void res.status(404).json({ error: "Not found" });
  if (current.status !== status && !(ALLOWED_TRANSITIONS[current.status] ?? []).includes(status)) {
    return void res.status(400).json({
      error: `Cannot transition from ${current.status} to ${status}`,
    });
  }

  const patch: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === "sent") patch.sentAt = new Date();
  if (status === "completed") patch.completedAt = new Date();

  const [updated] = await db
    .update(campaignsTable)
    .set(patch)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId)))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });

  await db.insert(campaignLogsTable).values({
    campaignId: id,
    restaurantId,
    event: `status:${status}`,
    actorId: req.user?.id ?? null,
    payload: { status },
  });
  res.json(updated);
});

// ───────── delete ─────────
router.delete("/restaurants/:restaurantId/growth/campaigns/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [c] = await db
    .select()
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId)));
  if (!c) return void res.status(404).json({ error: "Not found" });
  // Belt-and-braces: also scope the DELETE itself by restaurantId so the
  // write is safe even if the pre-read drifts from the delete (e.g. race
  // condition where ids are reassigned across tenants).
  await db
    .delete(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId)));
  res.status(204).send();
});

export default router;
