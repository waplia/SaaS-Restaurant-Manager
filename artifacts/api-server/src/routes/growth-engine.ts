import { Router } from "express";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignLogsTable,
  campaignStepsTable,
  campaignEnrollmentsTable,
  customersTable,
  smsMarketingTemplatesTable,
  whatsappMarketingTemplatesTable,
  webPushMarketingTemplatesTable,
  emailTemplatesTable,
  smsSuppressionListTable,
  whatsappSuppressionListTable,
  webPushSuppressionListTable,
  webPushSubscriptionsTable,
} from "../lib/db";
import { sendTestWebPush } from "../lib/webPush";
import type { NewCampaign, NewCampaignStep } from "@workspace/db/schema";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { detectOfferConflicts, persistConflictCheck } from "./advanced-growth";
import {
  resolveSegment, previewSegment, dispatchOne, launchSingleShot, launchOmnichannel,
  getCampaignAnalytics, getPlanFlags, channelFeatureKey, countActiveRecurring, countCampaignsThisMonth,
  type AudienceFilter, type ChannelName, type StepContent,
} from "../lib/campaigns";
import { logger } from "../lib/logger";

const router = Router();

const CHANNELS = new Set(["whatsapp", "sms", "email", "push", "qr_banner"]);
const STATUSES = new Set(["draft", "scheduled", "sending", "sent", "paused", "completed", "cancelled"]);
const SCHEDULE_KINDS = new Set(["now", "scheduled", "recurring"]);
const GOALS = new Set([
  "acquisition", "retention", "win_back", "loyalty", "promotion", "announcement",
  "birthday", "anniversary", "review", "feedback", "abandoned_cart", "festival",
]);
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft:     ["scheduled", "sending", "sent", "cancelled"],
  scheduled: ["sending", "sent", "paused", "draft", "cancelled"],
  sending:   ["sent", "failed", "paused", "cancelled"],
  paused:    ["scheduled", "draft", "cancelled"],
  sent:      ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const TYPES = new Set([
  "win_back", "birthday", "anniversary", "inactive", "first_order", "repeat_order",
  "festival", "slow_day", "item_specific", "segmentation", "whatsapp_draft",
  "sms_draft", "email_draft", "coupon_automation", "referral", "review_booster",
  "custom", "broadcast", "loyalty", "promotion",
]);

function parseDate(input: unknown): { ok: true; value: Date | null } | { ok: false; error: string } {
  if (input === null || input === undefined || input === "") return { ok: true, value: null };
  const d = new Date(input as string);
  if (Number.isNaN(d.getTime())) return { ok: false, error: "invalid date" };
  return { ok: true, value: d };
}

router.use(
  "/restaurants/:restaurantId/growth",
  requireRole("owner", "manager", "marketing", "super_admin"),
  validateRestaurantAccess,
);

// ════════════════════════════════════════════════════════════════
// CAMPAIGN LIST / DETAIL
// ════════════════════════════════════════════════════════════════
router.get("/restaurants/:restaurantId/growth/campaigns", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { status, channel, type, goal, q, scheduleKind } = req.query as Record<string, string | undefined>;
  const wheres = [eq(campaignsTable.restaurantId, restaurantId)];
  if (status && STATUSES.has(status)) wheres.push(eq(campaignsTable.status, status));
  if (channel && CHANNELS.has(channel)) wheres.push(eq(campaignsTable.channel, channel));
  if (type && TYPES.has(type)) wheres.push(eq(campaignsTable.type, type));
  if (goal && GOALS.has(goal)) wheres.push(eq(campaignsTable.goal, goal));
  if (scheduleKind && SCHEDULE_KINDS.has(scheduleKind)) wheres.push(eq(campaignsTable.scheduleKind, scheduleKind));
  if (q && q.trim()) wheres.push(sql`${campaignsTable.name} ILIKE ${"%" + q.trim() + "%"}`);
  const rows = await db.select().from(campaignsTable).where(and(...wheres))
    .orderBy(desc(campaignsTable.updatedAt)).limit(500);
  res.json(rows);
});

router.get("/restaurants/:restaurantId/growth/analytics", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select({
    status: campaignsTable.status,
    channel: campaignsTable.channel,
    type: campaignsTable.type,
    goal: campaignsTable.goal,
    count: sql<number>`count(*)::int`,
  }).from(campaignsTable).where(eq(campaignsTable.restaurantId, restaurantId))
    .groupBy(campaignsTable.status, campaignsTable.channel, campaignsTable.type, campaignsTable.goal);

  const byStatus: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byGoal: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + r.count;
    byChannel[r.channel] = (byChannel[r.channel] ?? 0) + r.count;
    byType[r.type] = (byType[r.type] ?? 0) + r.count;
    byGoal[r.goal] = (byGoal[r.goal] ?? 0) + r.count;
    total += r.count;
  }
  const [sendTotals] = await db.select({
    sent: sql<number>`count(*) filter (where event = 'sent')::int`,
    converted: sql<number>`count(*) filter (where event = 'converted')::int`,
    failed: sql<number>`count(*) filter (where event = 'failed')::int`,
  }).from(campaignLogsTable).where(eq(campaignLogsTable.restaurantId, restaurantId));
  res.json({ total, byStatus, byChannel, byType, byGoal, sends: sendTotals ?? {} });
});

router.get("/restaurants/:restaurantId/growth/logs", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const rows = await db.select().from(campaignLogsTable)
    .where(eq(campaignLogsTable.restaurantId, restaurantId))
    .orderBy(desc(campaignLogsTable.createdAt)).limit(limit);
  res.json(rows);
});

router.get("/restaurants/:restaurantId/growth/campaigns/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [c] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId)));
  if (!c) return void res.status(404).json({ error: "Not found" });
  const steps = await db.select().from(campaignStepsTable)
    .where(eq(campaignStepsTable.campaignId, id))
    .orderBy(campaignStepsTable.order);
  const logs = await db.select().from(campaignLogsTable)
    .where(and(eq(campaignLogsTable.campaignId, id), eq(campaignLogsTable.restaurantId, restaurantId)))
    .orderBy(desc(campaignLogsTable.createdAt)).limit(100);
  res.json({ campaign: c, steps, logs });
});

// ════════════════════════════════════════════════════════════════
// CAMPAIGN DRAFT / CREATE / UPDATE / DELETE
// ════════════════════════════════════════════════════════════════
router.post("/restaurants/:restaurantId/growth/campaigns/draft", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const goal = (req.body?.goal && GOALS.has(req.body.goal)) ? req.body.goal : "retention";
  const values: NewCampaign = {
    restaurantId,
    name: (req.body?.name?.trim?.() || "Untitled campaign").slice(0, 200),
    type: TYPES.has(req.body?.type) ? req.body.type : "custom",
    channel: CHANNELS.has(req.body?.channel) ? req.body.channel : "email",
    status: "draft", goal,
    audience: {}, content: {}, channels: [],
    stats: { sent: 0, delivered: 0, opened: 0, clicked: 0, converted: 0, revenue: 0 },
    scheduleKind: "now",
    createdBy: req.user?.sub ?? null,
  };
  const [c] = await db.insert(campaignsTable).values(values).returning();
  await db.insert(campaignLogsTable).values({
    campaignId: c.id, restaurantId, event: "created", actorId: req.user?.sub ?? null,
    payload: { source: "wizard.draft" },
  });
  res.status(201).json(c);
});

router.post("/restaurants/:restaurantId/growth/campaigns", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { name, type, channel, audience, content, scheduledAt, goal, channels, isOmnichannel, scheduleKind, recurrence, timezone, attributionWindowHours } = req.body ?? {};
  if (!name?.trim()) return void res.status(400).json({ error: "name is required" });
  if (!type || !TYPES.has(type)) return void res.status(400).json({ error: "invalid type" });
  if (!channel || !CHANNELS.has(channel)) return void res.status(400).json({ error: "invalid channel" });
  const parsed = parseDate(scheduledAt);
  if (!parsed.ok) return void res.status(400).json({ error: parsed.error });

  const values: NewCampaign = {
    restaurantId,
    name: String(name).trim(),
    type, channel,
    status: parsed.value ? "scheduled" : "draft",
    audience: (audience && typeof audience === "object") ? audience : {},
    content: (content && typeof content === "object") ? content : {},
    stats: { sent: 0, delivered: 0, opened: 0, clicked: 0, converted: 0, revenue: 0 },
    scheduledAt: parsed.value,
    goal: GOALS.has(goal) ? goal : "retention",
    isOmnichannel: Boolean(isOmnichannel),
    channels: Array.isArray(channels) ? channels : [],
    scheduleKind: SCHEDULE_KINDS.has(scheduleKind) ? scheduleKind : (parsed.value ? "scheduled" : "now"),
    recurrence: recurrence ?? null,
    timezone: typeof timezone === "string" ? timezone : "Asia/Kolkata",
    attributionWindowHours: Number.isFinite(attributionWindowHours) ? attributionWindowHours : 72,
    createdBy: req.user?.sub ?? null,
  };

  const [c] = await db.insert(campaignsTable).values(values).returning();
  let conflicts: Awaited<ReturnType<typeof detectOfferConflicts>> = [];
  try {
    conflicts = await detectOfferConflicts(restaurantId, {
      kind: "campaign", label: c.name,
      validFrom: c.scheduledAt ?? c.createdAt ?? null, validTo: null,
    });
    await persistConflictCheck(restaurantId, req.user?.sub ?? null, conflicts);
  } catch (err) { void err; }
  await db.insert(campaignLogsTable).values({
    campaignId: c.id, restaurantId, event: "created", actorId: req.user?.sub ?? null,
    payload: { name: c.name, type: c.type, channel: c.channel, status: c.status, conflictCount: conflicts.length },
  });
  res.status(201).json({ ...c, conflicts, conflictCount: conflicts.length });
});

router.patch("/restaurants/:restaurantId/growth/campaigns/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const b = req.body ?? {};
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (b.name !== undefined) {
    if (!String(b.name).trim()) return void res.status(400).json({ error: "name cannot be empty" });
    updates.name = String(b.name).trim();
  }
  if (b.type !== undefined) {
    if (!TYPES.has(b.type)) return void res.status(400).json({ error: "invalid type" });
    updates.type = b.type;
  }
  if (b.channel !== undefined) {
    if (!CHANNELS.has(b.channel)) return void res.status(400).json({ error: "invalid channel" });
    updates.channel = b.channel;
  }
  if (b.goal !== undefined) {
    if (!GOALS.has(b.goal)) return void res.status(400).json({ error: "invalid goal" });
    updates.goal = b.goal;
  }
  if (b.audience !== undefined) updates.audience = (b.audience && typeof b.audience === "object") ? b.audience : {};
  if (b.content !== undefined) updates.content = (b.content && typeof b.content === "object") ? b.content : {};
  if (b.channels !== undefined) updates.channels = Array.isArray(b.channels) ? b.channels : [];
  if (b.isOmnichannel !== undefined) updates.isOmnichannel = Boolean(b.isOmnichannel);
  if (b.scheduleKind !== undefined) {
    if (!SCHEDULE_KINDS.has(b.scheduleKind)) return void res.status(400).json({ error: "invalid scheduleKind" });
    updates.scheduleKind = b.scheduleKind;
  }
  if (b.recurrence !== undefined) updates.recurrence = b.recurrence;
  if (b.timezone !== undefined) updates.timezone = String(b.timezone);
  if (b.attributionWindowHours !== undefined) updates.attributionWindowHours = Number(b.attributionWindowHours) || 72;
  if (b.scheduledAt !== undefined) {
    const parsed = parseDate(b.scheduledAt);
    if (!parsed.ok) return void res.status(400).json({ error: parsed.error });
    updates.scheduledAt = parsed.value;
  }

  const [updated] = await db.update(campaignsTable).set(updates)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId)))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  await db.insert(campaignLogsTable).values({
    campaignId: id, restaurantId, event: "updated", actorId: req.user?.sub ?? null,
    payload: { fields: Object.keys(updates).filter(k => k !== "updatedAt") },
  });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/growth/campaigns/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  await db.delete(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId)));
  res.status(204).send();
});

// ════════════════════════════════════════════════════════════════
// CAMPAIGN STEPS (omnichannel plan)
// ════════════════════════════════════════════════════════════════
router.put("/restaurants/:restaurantId/growth/campaigns/:id/steps", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
  const [c] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId)));
  if (!c) return void res.status(404).json({ error: "Not found" });
  await db.delete(campaignStepsTable).where(eq(campaignStepsTable.campaignId, id));
  if (steps.length > 0) {
    const rows: NewCampaignStep[] = steps.map((s: { channel?: string; templateKey?: string; templateId?: number; content?: StepContent; delayMinutes?: number; waitForEvent?: string }, i: number) => ({
      campaignId: id, restaurantId,
      order: i,
      channel: CHANNELS.has(s.channel ?? "") ? (s.channel as string) : "email",
      templateKey: s.templateKey ?? null,
      templateId: s.templateId ?? null,
      content: s.content ?? {},
      delayMinutes: Math.max(0, Number(s.delayMinutes) || 0),
      waitForEvent: s.waitForEvent ?? null,
    }));
    await db.insert(campaignStepsTable).values(rows);
  }
  const saved = await db.select().from(campaignStepsTable)
    .where(eq(campaignStepsTable.campaignId, id))
    .orderBy(campaignStepsTable.order);
  res.json(saved);
});

// ════════════════════════════════════════════════════════════════
// PREVIEW / DRY-RUN / TEST-SEND / LAUNCH
// ════════════════════════════════════════════════════════════════
router.post("/restaurants/:restaurantId/growth/campaigns/:id/preview", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [c] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId)));
  if (!c) return void res.status(404).json({ error: "Not found" });
  const aud = (c.audience ?? {}) as AudienceFilter;
  const out = await previewSegment(restaurantId, aud, (c.channel as ChannelName) ?? null);
  res.json(out);
});

router.post("/restaurants/:restaurantId/growth/segments/preview", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const audience = (req.body?.audience ?? {}) as AudienceFilter;
  const channel = (req.body?.channel ?? null) as ChannelName | null;
  const out = await previewSegment(restaurantId, audience, channel && CHANNELS.has(channel) ? channel : null);
  res.json(out);
});

router.post("/restaurants/:restaurantId/growth/campaigns/:id/dry-run", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [c] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId)));
  if (!c) return void res.status(404).json({ error: "Not found" });
  const aud = (c.audience ?? {}) as AudienceFilter;
  const rows = await resolveSegment(restaurantId, aud);
  const planFlags = await getPlanFlags(restaurantId);
  let blocked = 0;
  const issues: string[] = [];
  // Validate channel features.
  const channelsToValidate: ChannelName[] = c.isOmnichannel
    ? (c.channels ?? []).map(ch => ch.channel as ChannelName)
    : [c.channel as ChannelName];
  for (const ch of channelsToValidate) {
    const key = channelFeatureKey(ch);
    if (planFlags.flags[key] === false) {
      issues.push(`Plan does not include ${key}`);
      blocked++;
    }
  }
  if (rows.length > planFlags.limits.audience) {
    issues.push(`Audience size ${rows.length} exceeds plan limit ${planFlags.limits.audience}`);
    blocked++;
  }
  res.json({
    audienceSize: rows.length,
    channels: channelsToValidate,
    issues,
    canLaunch: blocked === 0 && rows.length > 0,
    planLimits: planFlags.limits,
  });
});

router.post("/restaurants/:restaurantId/growth/campaigns/:id/test-send", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { to, channel, subscriptionId } = req.body ?? {};
  const [c] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId)));
  if (!c) return void res.status(404).json({ error: "Not found" });
  const ch = (channel && CHANNELS.has(channel)) ? (channel as ChannelName) : (c.channel as ChannelName);

  // Web Push test: deliver to a real subscription (picked in the UI from the
  // Subscribers list) via the same code path the Web Push settings page uses.
  if (ch === "push") {
    const content = (c.content ?? {}) as StepContent;
    let endpoint: string | null = null;
    if (typeof subscriptionId === "number" && subscriptionId > 0) {
      const [sub] = await db.select({ endpoint: webPushSubscriptionsTable.endpoint, restaurantId: webPushSubscriptionsTable.restaurantId })
        .from(webPushSubscriptionsTable).where(eq(webPushSubscriptionsTable.id, subscriptionId));
      if (!sub || sub.restaurantId !== restaurantId) return void res.status(404).json({ error: "Subscription not found for this restaurant" });
      endpoint = sub.endpoint;
    } else if (typeof to === "string" && /^https?:\/\//i.test(to)) {
      endpoint = to;
    } else {
      // Fall back to the most recent active subscription so the user can test
      // without picking one explicitly.
      const [sub] = await db.select({ endpoint: webPushSubscriptionsTable.endpoint })
        .from(webPushSubscriptionsTable)
        .where(and(eq(webPushSubscriptionsTable.restaurantId, restaurantId), eq(webPushSubscriptionsTable.status, "active")))
        .orderBy(desc(webPushSubscriptionsTable.createdAt))
        .limit(1);
      if (!sub) return void res.status(400).json({ error: "No active Web Push subscribers to test against. Open the storefront, allow notifications, then retry." });
      endpoint = sub.endpoint;
    }
    const r = await sendTestWebPush(endpoint, {
      title: content.title || content.subject || c.name,
      body: content.body ?? "",
      url: content.ctaUrl ?? undefined,
      image: content.imageUrl ?? undefined,
    });
    return void res.json({ ok: r.ok, status: r.ok ? "sent" : "failed", reason: r.error ?? null, endpoint });
  }

  if (!to || typeof to !== "string") return void res.status(400).json({ error: "to is required" });
  const fakeCustomer = {
    id: -1, name: "Test User",
    email: ch === "email" ? to : null,
    phone: (ch === "sms" || ch === "whatsapp") ? to : null,
    totalOrders: 1, totalSpent: "0", lastVisitAt: new Date(),
    birthday: null, anniversary: null,
    emailMarketingOptIn: true, emailUnsubscribed: false, whatsappOptIn: true,
    preferredChannel: ch,
  };
  const out = await dispatchOne({
    campaign: c, channel: ch,
    customer: fakeCustomer,
    content: (c.content ?? {}) as StepContent,
    restaurantName: "Preview", isTest: true,
  });
  res.json(out);
});

router.post("/restaurants/:restaurantId/growth/campaigns/:id/launch", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  // Approval gate: launching requires the `campaign.launch` permission.
  // Owners / managers / super_admin always have it; other roles (e.g.
  // marketing) save drafts that require approval. Per-user permission
  // overrides on req.user.permissions can grant launch to anyone.
  const role = req.user?.role;
  const perms = (req.user as { permissions?: string[] } | undefined)?.permissions ?? [];
  const canLaunch =
    role === "owner" || role === "manager" || role === "super_admin"
    || perms.includes("campaign.launch");
  if (!canLaunch) {
    return void res.status(403).json({
      error: "You don't have permission to launch campaigns. Ask an owner or manager to approve.",
      code: "requires_approval",
    });
  }
  const [c] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId)));
  if (!c) return void res.status(404).json({ error: "Not found" });
  if (c.status === "sent" || c.status === "sending" || c.status === "completed") {
    return void res.status(409).json({ error: `Campaign is already ${c.status}` });
  }

  // Enforce plan limits and feature flags.
  const planFlags = await getPlanFlags(restaurantId);
  const channelsToValidate: ChannelName[] = c.isOmnichannel
    ? ((c.channels ?? []) as Array<{ channel: string }>).map(ch => ch.channel as ChannelName)
    : [c.channel as ChannelName];
  for (const ch of channelsToValidate) {
    const key = channelFeatureKey(ch);
    if (planFlags.flags[key] === false) {
      return void res.status(402).json({ error: `Your plan does not include ${key}. Please upgrade.` });
    }
  }
  if (c.isOmnichannel && planFlags.flags["campaigns_omnichannel"] === false) {
    return void res.status(402).json({ error: "Your plan does not include omnichannel campaigns." });
  }
  const monthly = await countCampaignsThisMonth(restaurantId);
  if (monthly >= planFlags.limits.monthly) {
    return void res.status(402).json({ error: `Monthly campaign limit reached (${planFlags.limits.monthly}).` });
  }
  if (c.scheduleKind === "recurring") {
    const active = await countActiveRecurring(restaurantId);
    if (active >= planFlags.limits.recurring) {
      return void res.status(402).json({ error: `Active recurring campaigns limit reached (${planFlags.limits.recurring}).` });
    }
  }

  // Scheduled launch — just flip to scheduled status; cron will pick it up.
  if (c.scheduleKind === "scheduled" || c.scheduleKind === "recurring") {
    if (!c.scheduledAt) {
      return void res.status(400).json({ error: "scheduledAt is required for scheduled campaigns" });
    }
    const [updated] = await db.update(campaignsTable).set({
      status: "scheduled", updatedAt: new Date(),
    }).where(eq(campaignsTable.id, id)).returning();
    await db.insert(campaignLogsTable).values({
      campaignId: id, restaurantId, event: "scheduled", actorId: req.user?.sub ?? null,
      payload: { scheduledAt: c.scheduledAt },
    });
    return void res.json({ scheduled: true, campaign: updated });
  }

  // Immediate launch.
  await db.update(campaignsTable).set({ status: "sending", updatedAt: new Date() })
    .where(eq(campaignsTable.id, id));
  try {
    if (c.isOmnichannel) {
      const out = await launchOmnichannel(c);
      const [updated] = await db.update(campaignsTable).set({
        status: "sent", sentAt: new Date(),
        stats: { ...(c.stats ?? {}), enrolled: out.enrolled },
        lastDispatchedAt: new Date(), updatedAt: new Date(),
      }).where(eq(campaignsTable.id, id)).returning();
      await db.insert(campaignLogsTable).values({
        campaignId: id, restaurantId, event: "dispatched", actorId: req.user?.sub ?? null,
        payload: { mode: "omnichannel", enrolled: out.enrolled },
      });
      return void res.json({ campaign: updated, ...out });
    }
    const out = await launchSingleShot(c);
    const [updated] = await db.update(campaignsTable).set({
      status: "sent", sentAt: new Date(),
      stats: { ...(c.stats ?? {}), ...out },
      lastDispatchedAt: new Date(), updatedAt: new Date(),
    }).where(eq(campaignsTable.id, id)).returning();
    await db.insert(campaignLogsTable).values({
      campaignId: id, restaurantId, event: "dispatched", actorId: req.user?.sub ?? null,
      payload: { mode: "single", ...out },
    });
    res.json({ campaign: updated, ...out });
  } catch (err) {
    logger.error({ err, id }, "campaign launch failed");
    await db.update(campaignsTable).set({ status: "draft", updatedAt: new Date() })
      .where(eq(campaignsTable.id, id));
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/restaurants/:restaurantId/growth/campaigns/:id/pause", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [updated] = await db.update(campaignsTable).set({
    status: "paused", pausedAt: new Date(), updatedAt: new Date(),
  }).where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  await db.insert(campaignLogsTable).values({ campaignId: id, restaurantId, event: "paused", actorId: req.user?.sub ?? null });
  res.json(updated);
});

router.post("/restaurants/:restaurantId/growth/campaigns/:id/resume", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [updated] = await db.update(campaignsTable).set({
    status: "scheduled", pausedAt: null, updatedAt: new Date(),
  }).where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  await db.insert(campaignLogsTable).values({ campaignId: id, restaurantId, event: "resumed", actorId: req.user?.sub ?? null });
  res.json(updated);
});

router.post("/restaurants/:restaurantId/growth/campaigns/:id/cancel", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [updated] = await db.update(campaignsTable).set({
    status: "cancelled", cancelledAt: new Date(), updatedAt: new Date(),
  }).where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  await db.update(campaignEnrollmentsTable).set({ status: "exited", updatedAt: new Date() })
    .where(and(eq(campaignEnrollmentsTable.campaignId, id), eq(campaignEnrollmentsTable.status, "active")));
  await db.insert(campaignLogsTable).values({ campaignId: id, restaurantId, event: "cancelled", actorId: req.user?.sub ?? null });
  res.json(updated);
});

router.post("/restaurants/:restaurantId/growth/campaigns/:id/clone", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [c] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId)));
  if (!c) return void res.status(404).json({ error: "Not found" });
  const { id: _id, createdAt: _ca, updatedAt: _ua, sentAt: _sa, completedAt: _co, pausedAt: _pa, cancelledAt: _ca2, lastDispatchedAt: _ld, ...rest } = c;
  const [copy] = await db.insert(campaignsTable).values({
    ...rest, name: `${c.name} (copy)`, status: "draft", stats: {}, scheduledAt: null,
  }).returning();
  const steps = await db.select().from(campaignStepsTable)
    .where(eq(campaignStepsTable.campaignId, id)).orderBy(campaignStepsTable.order);
  if (steps.length > 0) {
    await db.insert(campaignStepsTable).values(steps.map(s => ({
      campaignId: copy.id, restaurantId, order: s.order, channel: s.channel,
      templateKey: s.templateKey, templateId: s.templateId,
      content: s.content, delayMinutes: s.delayMinutes, waitForEvent: s.waitForEvent,
    })));
  }
  await db.insert(campaignLogsTable).values({
    campaignId: copy.id, restaurantId, event: "cloned",
    actorId: req.user?.sub ?? null, payload: { fromId: id },
  });
  res.status(201).json(copy);
});

// Legacy dispatch endpoint kept for backwards compatibility — delegates to launch.
router.post("/restaurants/:restaurantId/growth/campaigns/:id/dispatch", async (req, res, next) => {
  req.url = req.url.replace("/dispatch", "/launch");
  return next();
});

router.get("/restaurants/:restaurantId/growth/campaigns/:id/analytics", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const out = await getCampaignAnalytics(id, restaurantId);
  res.json(out);
});

// ════════════════════════════════════════════════════════════════
// PER-CHANNEL TEMPLATES (sms / whatsapp / web-push)
// Email templates already have a dedicated endpoint (admin-email).
// ════════════════════════════════════════════════════════════════
function templateTableFor(channel: string) {
  if (channel === "sms") return smsMarketingTemplatesTable;
  if (channel === "whatsapp") return whatsappMarketingTemplatesTable;
  if (channel === "push") return webPushMarketingTemplatesTable;
  return null;
}

router.get("/restaurants/:restaurantId/growth/templates/:channel", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  if (req.params.channel === "email") {
    // Email templates live in the shared `emailTemplatesTable` (scope =
    // "platform" for built-ins, "restaurant" for tenant-owned). The
    // `isEnabled` flag plays the role that `isActive` does on the other
    // per-channel marketing template tables, and the response is shaped
    // to match (so the mobile UI can stay channel-agnostic).
    const rows = await db.select().from(emailTemplatesTable)
      .where(sql`((${emailTemplatesTable.scope} = 'platform' AND ${emailTemplatesTable.isGlobal} = true)
              OR (${emailTemplatesTable.scope} = 'restaurant' AND ${emailTemplatesTable.restaurantId} = ${restaurantId}))
              AND ${emailTemplatesTable.isEnabled} = true
              AND ${emailTemplatesTable.isHidden} = false`)
      .orderBy(desc(emailTemplatesTable.updatedAt))
      .limit(500);
    return void res.json(rows.map(r => ({
      id: r.id, name: r.name, category: r.category, body: r.body,
      title: r.subject, isGlobal: r.scope === "platform" || r.isGlobal,
      updatedAt: r.updatedAt,
    })));
  }
  const t = templateTableFor(req.params.channel);
  if (!t) return void res.status(400).json({ error: "invalid channel" });
  const rows = await db.select().from(t).where(sql`(${t.restaurantId} = ${restaurantId} OR ${t.isGlobal} = true) AND ${t.isActive} = true`)
    .orderBy(desc(t.updatedAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/growth/templates/:channel", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  if (req.params.channel === "email") {
    const { name, category, body, title, subject } = req.body ?? {};
    if (!name || !body) return void res.status(400).json({ error: "name and body are required" });
    const [row] = await db.insert(emailTemplatesTable).values({
      key: String(name).toLowerCase().replace(/\s+/g, "_").slice(0, 120),
      name: String(name).slice(0, 200),
      category: (category || "marketing") as never,
      subject: String(subject || title || name).slice(0, 200),
      body: String(body),
      scope: "restaurant",
      restaurantId,
      isGlobal: false,
      isEnabled: true,
      status: "approved",
    }).returning();
    return void res.status(201).json({
      id: row.id, name: row.name, category: row.category, body: row.body,
      title: row.subject, isGlobal: false, updatedAt: row.updatedAt,
    });
  }
  const t = templateTableFor(req.params.channel);
  if (!t) return void res.status(400).json({ error: "invalid channel" });
  const { key, name, category, body, title, iconUrl, imageUrl, clickUrl, language, metaTemplateName } = req.body ?? {};
  if (!name || !body) return void res.status(400).json({ error: "name and body are required" });
  const values: Record<string, unknown> = {
    restaurantId, key: (key || name).toLowerCase().replace(/\s+/g, "_").slice(0, 120),
    name: String(name).slice(0, 200), category: category || "general",
    body: String(body), isGlobal: false, isActive: true,
  };
  if (req.params.channel === "whatsapp") {
    values.language = language || "en";
    values.metaTemplateName = metaTemplateName || null;
  }
  if (req.params.channel === "push") {
    values.title = title || name;
    values.iconUrl = iconUrl || null;
    values.imageUrl = imageUrl || null;
    values.clickUrl = clickUrl || null;
  }
  const [row] = await db.insert(t).values(values as never).returning();
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/growth/templates/:channel/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  if (req.params.channel === "email") {
    const b = req.body ?? {};
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (b.name !== undefined) update.name = String(b.name).slice(0, 200);
    if (b.category !== undefined) update.category = b.category;
    if (b.body !== undefined) update.body = String(b.body);
    if (b.title !== undefined) update.subject = String(b.title).slice(0, 200);
    if (b.subject !== undefined) update.subject = String(b.subject).slice(0, 200);
    if (b.isActive !== undefined) update.isEnabled = !!b.isActive;
    const [row] = await db.update(emailTemplatesTable).set(update as never)
      .where(and(
        eq(emailTemplatesTable.id, id),
        eq(emailTemplatesTable.restaurantId, restaurantId),
        eq(emailTemplatesTable.scope, "restaurant"),
      )).returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    return void res.json({
      id: row.id, name: row.name, category: row.category, body: row.body,
      title: row.subject, isGlobal: false, updatedAt: row.updatedAt,
    });
  }
  const t = templateTableFor(req.params.channel);
  if (!t) return void res.status(400).json({ error: "invalid channel" });
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const b = req.body ?? {};
  for (const k of ["name", "category", "body", "title", "iconUrl", "imageUrl", "clickUrl", "language", "metaTemplateName", "isActive"]) {
    if (b[k] !== undefined && k in t) updates[k] = b[k];
  }
  const [row] = await db.update(t).set(updates as never)
    .where(and(eq(t.id, id), eq(t.restaurantId, restaurantId))).returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/restaurants/:restaurantId/growth/templates/:channel/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  if (req.params.channel === "email") {
    await db.delete(emailTemplatesTable).where(and(
      eq(emailTemplatesTable.id, id),
      eq(emailTemplatesTable.restaurantId, restaurantId),
      eq(emailTemplatesTable.scope, "restaurant"),
    ));
    return void res.status(204).send();
  }
  const t = templateTableFor(req.params.channel);
  if (!t) return void res.status(400).json({ error: "invalid channel" });
  await db.delete(t).where(and(eq(t.id, id), eq(t.restaurantId, restaurantId)));
  res.status(204).send();
});

// ════════════════════════════════════════════════════════════════
// SUPPRESSION LISTS (per-channel)
// ════════════════════════════════════════════════════════════════
function suppressionTableFor(channel: string) {
  if (channel === "sms") return smsSuppressionListTable;
  if (channel === "whatsapp") return whatsappSuppressionListTable;
  if (channel === "push") return webPushSuppressionListTable;
  return null;
}

router.get("/restaurants/:restaurantId/growth/suppressions/:channel", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const t = suppressionTableFor(req.params.channel);
  if (!t) return void res.status(400).json({ error: "invalid channel" });
  const rows = await db.select().from(t).where(eq(t.restaurantId, restaurantId))
    .orderBy(desc(t.createdAt)).limit(500);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/growth/suppressions/:channel", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const t = suppressionTableFor(req.params.channel);
  if (!t) return void res.status(400).json({ error: "invalid channel" });
  const { identifier, reason } = req.body ?? {};
  if (!identifier) return void res.status(400).json({ error: "identifier required" });
  const [row] = await db.insert(t).values({
    restaurantId, identifier: String(identifier), reason: reason || "manual",
  }).onConflictDoNothing().returning();
  res.status(201).json(row ?? { restaurantId, identifier, reason: reason || "manual" });
});

router.delete("/restaurants/:restaurantId/growth/suppressions/:channel/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const t = suppressionTableFor(req.params.channel);
  if (!t) return void res.status(400).json({ error: "invalid channel" });
  await db.delete(t).where(and(eq(t.id, id), eq(t.restaurantId, restaurantId)));
  res.status(204).send();
});

// ════════════════════════════════════════════════════════════════
// PLAN INFO (so wizard can show available channels / limits)
// ════════════════════════════════════════════════════════════════
router.get("/restaurants/:restaurantId/growth/plan-info", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const out = await getPlanFlags(restaurantId);
  const monthly = await countCampaignsThisMonth(restaurantId);
  const recurring = await countActiveRecurring(restaurantId);
  res.json({
    flags: {
      sms: out.flags.campaigns_sms !== false,
      whatsapp: out.flags.campaigns_whatsapp !== false,
      email: out.flags.campaigns_email !== false,
      push: out.flags.campaigns_web_push !== false,
      omnichannel: out.flags.campaigns_omnichannel !== false,
      ai: out.flags.campaigns_ai_generation !== false,
      advancedSegments: out.flags.campaigns_advanced_segments !== false,
      recurring: out.flags.campaigns_recurring !== false,
    },
    limits: out.limits,
    usage: { monthly, recurring },
  });
});

// ════════════════════════════════════════════════════════════════
// LEGACY status endpoint (kept for callers that still post one).
// ════════════════════════════════════════════════════════════════
router.post("/restaurants/:restaurantId/growth/campaigns/:id/status", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { status } = req.body ?? {};
  if (!status || !STATUSES.has(status)) return void res.status(400).json({ error: "invalid status" });
  const [current] = await db.select({ status: campaignsTable.status }).from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId)));
  if (!current) return void res.status(404).json({ error: "Not found" });
  if (current.status !== status && !(ALLOWED_TRANSITIONS[current.status] ?? []).includes(status)) {
    return void res.status(400).json({ error: `Cannot transition from ${current.status} to ${status}` });
  }
  const patch: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === "sent") patch.sentAt = new Date();
  if (status === "completed") patch.completedAt = new Date();
  if (status === "paused") patch.pausedAt = new Date();
  if (status === "cancelled") patch.cancelledAt = new Date();
  const [updated] = await db.update(campaignsTable).set(patch)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.restaurantId, restaurantId))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  await db.insert(campaignLogsTable).values({
    campaignId: id, restaurantId, event: `status:${status}`,
    actorId: req.user?.sub ?? null, payload: { status },
  });
  res.json(updated);
});

export default router;
