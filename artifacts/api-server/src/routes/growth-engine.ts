import { Router } from "express";
import { eq, and, desc, sql, inArray, isNotNull } from "drizzle-orm";
import { db, campaignsTable, campaignLogsTable, customersTable } from "../lib/db";
import type { NewCampaign } from "@workspace/db/schema";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { detectOfferConflicts, persistConflictCheck } from "./advanced-growth";
import { sendWebPush } from "../lib/webPush";
import { sendBroadcastWhatsApp } from "../lib/whatsapp";
import { sendEmail } from "../lib/emailSender";
import { sendSmsMessage } from "../lib/smsSender";
import { logger } from "../lib/logger";

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
    createdBy: req.user?.sub ?? null,
  };

  const [c] = await db.insert(campaignsTable).values(values).returning();
  // Run the shared offer-conflict scan so the operator is warned when a
  // new campaign overlaps a live coupon's validity window. Persisted to
  // offer_conflict_checks for audit. Best-effort — never blocks save.
  let conflicts: Awaited<ReturnType<typeof detectOfferConflicts>> = [];
  try {
    conflicts = await detectOfferConflicts(restaurantId, {
      kind: "campaign", label: c.name,
      validFrom: c.scheduledAt ?? c.createdAt ?? null, validTo: null,
    });
    await persistConflictCheck(restaurantId, req.user?.sub ?? null, conflicts);
  } catch (err) {
    void err;
  }
  await db.insert(campaignLogsTable).values({
    campaignId: c.id,
    restaurantId,
    event: "created",
    actorId: req.user?.sub ?? null,
    payload: { name: c.name, type: c.type, channel: c.channel, status: c.status, conflictCount: conflicts.length },
  });
  res.status(201).json({ ...c, conflicts, conflictCount: conflicts.length });
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
    actorId: req.user?.sub ?? null,
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
    actorId: req.user?.sub ?? null,
    payload: { status },
  });
  res.json(updated);
});

// ───────── dispatch (actually send the campaign on its chosen channel) ─────────
// POST /restaurants/:rid/growth/campaigns/:id/dispatch
// Resolves recipients from the campaign's audience selectors and sends via
// the appropriate channel. Per-channel rules:
//   - push:      goes through sendWebPush (already enforces opt-in, quiet hours, caps)
//   - email:     filtered to customers with emailMarketingOptIn && !emailUnsubscribed
//   - whatsapp:  filtered to whatsappOptIn customers, sent via sendBroadcastWhatsApp
//   - sms:       sent to every customer with a phone (provider/quota gates inside)
//   - qr_banner: no per-customer send; just marks the campaign sent
router.post("/restaurants/:restaurantId/growth/campaigns/:id/dispatch", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [c] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId)));
  if (!c) return void res.status(404).json({ error: "Not found" });
  if (c.status === "sent" || c.status === "completed") {
    return void res.status(409).json({ error: `Campaign is already ${c.status}` });
  }

  const content = (c.content ?? {}) as { subject?: string; body?: string; ctaText?: string; ctaUrl?: string };
  const body = content.body ?? "";
  const subject = content.subject ?? c.name;
  if (!body.trim()) return void res.status(400).json({ error: "Campaign body is empty" });

  // Audience selectors (best-effort — extends over time). Right now we
  // support either {customerIds:[…]} or "all customers in restaurant".
  const aud = (c.audience ?? {}) as { customerIds?: number[] };
  const wheres = [eq(customersTable.restaurantId, restaurantId), eq(customersTable.isActive, true)];
  if (Array.isArray(aud.customerIds) && aud.customerIds.length > 0) {
    wheres.push(inArray(customersTable.id, aud.customerIds.map(Number).filter(Number.isFinite)));
  }

  let sent = 0, failed = 0, total = 0, skipped = 0, reason: string | undefined;

  try {
    if (c.channel === "push") {
      const out = await sendWebPush({
        restaurantId, eventKey: "system.announcement", category: "marketing", campaignId: c.id,
        payload: { title: subject, body, url: content.ctaUrl ?? undefined },
        targetCustomerIds: Array.isArray(aud.customerIds) && aud.customerIds.length > 0
          ? aud.customerIds.map(Number).filter(Number.isFinite) : undefined,
      });
      sent = out.sent; failed = out.failed; total = out.total; skipped = out.skipped; reason = out.reason;
    } else if (c.channel === "qr_banner") {
      // QR banner is a display-only campaign — no per-customer send.
      total = 1; sent = 1; reason = "QR banner activated (display-only channel)";
    } else if (c.channel === "email") {
      const rows = await db.select({ id: customersTable.id, email: customersTable.email, name: customersTable.name })
        .from(customersTable)
        .where(and(...wheres, eq(customersTable.emailMarketingOptIn, true), eq(customersTable.emailUnsubscribed, false), isNotNull(customersTable.email)));
      total = rows.length;
      for (const r of rows) {
        if (!r.email) { skipped++; continue; }
        try {
          const html = `<p>Hi ${escapeHtml(r.name || "there")},</p><p>${escapeHtml(body).replace(/\n/g, "<br/>")}</p>${
            content.ctaUrl ? `<p><a href="${content.ctaUrl}">${escapeHtml(content.ctaText || "Open")}</a></p>` : ""
          }`;
          const out = await sendEmail({
            to: r.email, subject, html, restaurantId, kind: "marketing",
            recipientType: "customer", campaignId: c.id,
          });
          if (out?.ok) sent++; else failed++;
        } catch (err) { failed++; logger.warn({ err, customerId: r.id }, "growth-email send failed"); }
      }
    } else if (c.channel === "whatsapp") {
      const rows = await db.select({ id: customersTable.id, phone: customersTable.phone, name: customersTable.name })
        .from(customersTable)
        .where(and(...wheres, eq(customersTable.whatsappOptIn, true), isNotNull(customersTable.phone)));
      total = rows.length;
      const message = renderVars(body, { name: "" });
      for (const r of rows) {
        if (!r.phone) { skipped++; continue; }
        try {
          const out = await sendBroadcastWhatsApp({
            restaurantId, to: r.phone, subject, body: renderVars(body, { name: r.name ?? "" }),
            event: `growth.campaign.${c.type}`,
          });
          if (out.status === "sent" || out.status === "queued" || out.status === "delivered") sent++; else failed++;
        } catch (err) { failed++; logger.warn({ err, customerId: r.id }, "growth-whatsapp send failed"); }
      }
      void message;
    } else if (c.channel === "sms") {
      const rows = await db.select({ id: customersTable.id, phone: customersTable.phone, name: customersTable.name })
        .from(customersTable)
        .where(and(...wheres, isNotNull(customersTable.phone)));
      total = rows.length;
      for (const r of rows) {
        if (!r.phone) { skipped++; continue; }
        try {
          const out = await sendSmsMessage({
            to: r.phone, body: renderVars(body, { name: r.name ?? "" }),
            restaurantId, eventKey: "custom" as never,
          });
          if (out.ok) sent++; else failed++;
        } catch (err) { failed++; logger.warn({ err, customerId: r.id }, "growth-sms send failed"); }
      }
    } else {
      return void res.status(400).json({ error: `Unsupported channel: ${c.channel}` });
    }
  } catch (err) {
    logger.error({ err, campaignId: c.id }, "growth-engine dispatch failed");
    return void res.status(500).json({ error: (err as Error).message ?? "Dispatch failed" });
  }

  const newStatus = sent > 0 ? "sent" : "draft";
  const stats = { ...(c.stats ?? {}), sent, failed, total, skipped, lastDispatchedAt: new Date().toISOString() };
  await db.update(campaignsTable).set({
    status: newStatus, stats,
    sentAt: sent > 0 ? new Date() : c.sentAt,
    updatedAt: new Date(),
  }).where(eq(campaignsTable.id, c.id));
  await db.insert(campaignLogsTable).values({
    campaignId: c.id, restaurantId,
    event: sent > 0 ? "dispatched" : "dispatch_failed",
    actorId: req.user?.sub ?? null,
    payload: { sent, failed, total, skipped, reason, channel: c.channel },
  });

  res.json({ sent, failed, total, skipped, reason, status: newStatus });
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}
function renderVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

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
