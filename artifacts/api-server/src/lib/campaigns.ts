/**
 * Growth Engine — Marketing platform runtime (Task #516).
 *
 * Provides:
 *   - resolveSegment(): turn an audience selector into a list of customer rows
 *   - dispatchOne(): send a single message on a single channel with full
 *     consent / suppression / quota gating + per-recipient log writes
 *   - launchCampaign(): for single-shot campaigns, enrolls + dispatches everyone
 *   - runDueCampaignsTick(): scheduler entry-point — picks up scheduled and
 *     recurring campaigns whose run-time has elapsed and launches them
 *   - advanceOmnichannelEnrollments(): scheduler entry-point — drives
 *     in-flight omnichannel customers through their step plan
 */

import { and, eq, gte, lte, lt, inArray, isNotNull, sql, desc } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignLogsTable,
  campaignStepsTable,
  campaignEnrollmentsTable,
  customersTable,
  ordersTable,
  smsSuppressionListTable,
  whatsappSuppressionListTable,
  webPushSuppressionListTable,
  subscriptionPlansTable,
  tenantsTable,
  restaurantsTable,
  isFeatureEnabled,
  type Campaign,
  type CampaignStep,
} from "./db";
import { sendEmail } from "./emailSender";
import { sendSmsMessage } from "./smsSender";
import { sendBroadcastWhatsApp } from "./whatsapp";
import { sendWebPush } from "./webPush";
import { logger } from "./logger";
import { toE164, DEFAULT_ISO } from "@workspace/phone-utils";

// Memoized restaurant-country lookup so dispatchOne can normalize phones to
// E.164 without an extra round-trip per recipient.
const restaurantIsoCache = new Map<number, { iso: string; at: number }>();
const RESTAURANT_ISO_TTL_MS = 5 * 60 * 1000;
async function getRestaurantIso(restaurantId: number): Promise<string> {
  const cached = restaurantIsoCache.get(restaurantId);
  if (cached && Date.now() - cached.at < RESTAURANT_ISO_TTL_MS) return cached.iso;
  const [row] = await db.select({ country: restaurantsTable.country })
    .from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  const iso = row?.country ?? DEFAULT_ISO;
  restaurantIsoCache.set(restaurantId, { iso, at: Date.now() });
  return iso;
}

export type CustomerRow = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  totalOrders: number;
  totalSpent: string;
  lastVisitAt: Date | null;
  birthday: string | null;
  anniversary: string | null;
  emailMarketingOptIn: boolean;
  emailUnsubscribed: boolean;
  whatsappOptIn: boolean;
  preferredChannel: string;
};

export type ChannelName = "whatsapp" | "sms" | "email" | "push" | "qr_banner";

export type StepContent = {
  subject?: string;
  body?: string;
  html?: string;
  title?: string;
  ctaUrl?: string;
  ctaText?: string;
  imageUrl?: string;
};

export type AudienceFilter = {
  customerIds?: number[];
  segment?:
    | "all"
    | "new"
    | "repeat"
    | "vip"
    | "inactive"
    | "birthday"
    | "anniversary"
    | "high_value"
    | "custom";
  rules?: {
    minTotalOrders?: number;
    maxTotalOrders?: number;
    minTotalSpent?: number;
    inactiveDays?: number;
    activeWithinDays?: number;
    birthdayThisMonth?: boolean;
    requireEmail?: boolean;
    requirePhone?: boolean;
    requireWhatsAppOptIn?: boolean;
    requireEmailOptIn?: boolean;
    excludeIds?: number[];
  };
  limit?: number;
};

// ─────────────────────────────────────────────────────────────────
// Plan flag helper.
// ─────────────────────────────────────────────────────────────────
export async function getPlanFlags(restaurantId: number): Promise<{
  flags: Record<string, boolean>;
  limits: { monthly: number; audience: number; recurring: number };
}> {
  const [r] = await db.select({ tenantId: restaurantsTable.tenantId })
    .from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  if (!r) return { flags: {}, limits: { monthly: 0, audience: 0, recurring: 0 } };
  const [t] = await db.select({ planId: tenantsTable.planId })
    .from(tenantsTable).where(eq(tenantsTable.id, r.tenantId));
  if (!t?.planId) return {
    flags: {},
    limits: { monthly: 999_999, audience: 999_999, recurring: 999 },
  };
  const [p] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, t.planId));
  if (!p) return { flags: {}, limits: { monthly: 0, audience: 0, recurring: 0 } };
  return {
    flags: (p.featureFlags ?? {}) as Record<string, boolean>,
    limits: {
      monthly: p.campaignsMonthlyLimit || 999_999,
      audience: p.campaignsAudienceSizeLimit || 999_999,
      recurring: p.campaignsActiveRecurringLimit || 999,
    },
  };
}

export function channelFeatureKey(channel: ChannelName): string {
  switch (channel) {
    case "whatsapp": return "campaigns_whatsapp";
    case "sms":      return "campaigns_sms";
    case "email":    return "campaigns_email";
    case "push":     return "campaigns_web_push";
    default:         return "campaigns_email";
  }
}

// ─────────────────────────────────────────────────────────────────
// Segment resolution.
// ─────────────────────────────────────────────────────────────────
export async function resolveSegment(
  restaurantId: number,
  audience: AudienceFilter,
  opts: { hardLimit?: number } = {},
): Promise<CustomerRow[]> {
  const wheres = [eq(customersTable.restaurantId, restaurantId), eq(customersTable.isActive, true)];

  if (Array.isArray(audience.customerIds) && audience.customerIds.length > 0) {
    const ids = audience.customerIds.map(Number).filter(Number.isFinite);
    if (ids.length === 0) return [];
    wheres.push(inArray(customersTable.id, ids));
  }

  const r = audience.rules ?? {};
  const seg = audience.segment ?? "all";

  // Apply segment presets.
  if (seg === "vip") wheres.push(eq(customersTable.isVip, true));
  if (seg === "new") wheres.push(sql`${customersTable.totalOrders} <= 1`);
  if (seg === "repeat") wheres.push(sql`${customersTable.totalOrders} >= 2`);
  if (seg === "high_value") wheres.push(sql`${customersTable.totalSpent}::numeric >= 5000`);
  if (seg === "inactive") {
    const days = r.inactiveDays ?? 60;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    wheres.push(sql`${customersTable.lastVisitAt} < ${cutoff} OR ${customersTable.lastVisitAt} IS NULL`);
  }
  if (seg === "birthday") wheres.push(sql`extract(month from ${customersTable.birthday}) = extract(month from current_date)`);
  if (seg === "anniversary") wheres.push(sql`extract(month from ${customersTable.anniversary}) = extract(month from current_date)`);

  // Apply explicit rule overrides.
  if (typeof r.minTotalOrders === "number") wheres.push(sql`${customersTable.totalOrders} >= ${r.minTotalOrders}`);
  if (typeof r.maxTotalOrders === "number") wheres.push(sql`${customersTable.totalOrders} <= ${r.maxTotalOrders}`);
  if (typeof r.minTotalSpent === "number") wheres.push(sql`${customersTable.totalSpent}::numeric >= ${r.minTotalSpent}`);
  if (typeof r.inactiveDays === "number" && seg !== "inactive") {
    const cutoff = new Date(Date.now() - r.inactiveDays * 86_400_000);
    wheres.push(sql`${customersTable.lastVisitAt} < ${cutoff} OR ${customersTable.lastVisitAt} IS NULL`);
  }
  if (typeof r.activeWithinDays === "number") {
    const cutoff = new Date(Date.now() - r.activeWithinDays * 86_400_000);
    wheres.push(sql`${customersTable.lastVisitAt} >= ${cutoff}`);
  }
  if (r.birthdayThisMonth) wheres.push(sql`extract(month from ${customersTable.birthday}) = extract(month from current_date)`);
  if (r.requireEmail) wheres.push(isNotNull(customersTable.email));
  if (r.requirePhone) wheres.push(isNotNull(customersTable.phone));
  if (r.requireWhatsAppOptIn) wheres.push(eq(customersTable.whatsappOptIn, true));
  if (r.requireEmailOptIn) {
    wheres.push(eq(customersTable.emailMarketingOptIn, true));
    wheres.push(eq(customersTable.emailUnsubscribed, false));
  }
  if (Array.isArray(r.excludeIds) && r.excludeIds.length > 0) {
    wheres.push(sql`NOT (${customersTable.id} = ANY(${r.excludeIds}))`);
  }

  const limit = Math.min(opts.hardLimit ?? 50_000, audience.limit ?? 50_000);

  const rows = await db
    .select({
      id: customersTable.id,
      name: customersTable.name,
      email: customersTable.email,
      phone: customersTable.phone,
      totalOrders: customersTable.totalOrders,
      totalSpent: customersTable.totalSpent,
      lastVisitAt: customersTable.lastVisitAt,
      birthday: customersTable.birthday,
      anniversary: customersTable.anniversary,
      emailMarketingOptIn: customersTable.emailMarketingOptIn,
      emailUnsubscribed: customersTable.emailUnsubscribed,
      whatsappOptIn: customersTable.whatsappOptIn,
      preferredChannel: customersTable.preferredChannel,
    })
    .from(customersTable)
    .where(and(...wheres))
    .limit(limit);

  return rows;
}

export async function previewSegment(
  restaurantId: number,
  audience: AudienceFilter,
): Promise<{ total: number; reachable: { email: number; sms: number; whatsapp: number }; sample: CustomerRow[] }> {
  const rows = await resolveSegment(restaurantId, audience, { hardLimit: 5_000 });
  const reachable = { email: 0, sms: 0, whatsapp: 0 };
  for (const r of rows) {
    if (r.email && r.emailMarketingOptIn && !r.emailUnsubscribed) reachable.email++;
    if (r.phone) reachable.sms++;
    if (r.phone && r.whatsappOptIn) reachable.whatsapp++;
  }
  return { total: rows.length, reachable, sample: rows.slice(0, 25) };
}

// ─────────────────────────────────────────────────────────────────
// Template rendering and merge variables.
// ─────────────────────────────────────────────────────────────────
export function renderTemplate(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v === null || v === undefined ? "" : String(v);
  });
}

export function buildMergeVars(c: CustomerRow, restaurantName: string, content: StepContent): Record<string, string> {
  return {
    name: c.name || "there",
    first_name: (c.name || "").split(" ")[0] || "there",
    restaurant: restaurantName,
    cta_url: content.ctaUrl ?? "",
    cta_text: content.ctaText ?? "",
  };
}

// ─────────────────────────────────────────────────────────────────
// Suppression checks.
// ─────────────────────────────────────────────────────────────────
async function isSuppressed(restaurantId: number, channel: ChannelName, identifier: string): Promise<boolean> {
  if (!identifier) return true;
  const table =
    channel === "sms" ? smsSuppressionListTable :
    channel === "whatsapp" ? whatsappSuppressionListTable :
    channel === "push" ? webPushSuppressionListTable :
    null;
  if (!table) return false;
  const [hit] = await db.select({ id: table.id }).from(table)
    .where(and(eq(table.restaurantId, restaurantId), eq(table.identifier, identifier)));
  return Boolean(hit);
}

// ─────────────────────────────────────────────────────────────────
// Dispatch one message on one channel.
// ─────────────────────────────────────────────────────────────────
export type DispatchResult = {
  ok: boolean;
  status: "sent" | "failed" | "skipped";
  reason?: string;
  providerMessageId?: string | null;
};

export async function dispatchOne(opts: {
  campaign: Campaign;
  step?: CampaignStep | null;
  channel: ChannelName;
  customer: CustomerRow;
  content: StepContent;
  restaurantName: string;
  isTest?: boolean;
}): Promise<DispatchResult> {
  const { campaign, step, channel, customer, content, restaurantName, isTest } = opts;
  const vars = buildMergeVars(customer, restaurantName, content);
  const renderedBody = renderTemplate(content.body ?? "", vars);
  const renderedSubject = renderTemplate(content.subject ?? campaign.name, vars);
  const renderedTitle = renderTemplate(content.title ?? campaign.name, vars);
  const renderedHtml = content.html ? renderTemplate(content.html, vars) : undefined;

  let result: DispatchResult = { ok: false, status: "failed" };

  try {
    if (channel === "email") {
      if (!customer.email) { result = { ok: false, status: "skipped", reason: "no_email" }; }
      else if (!customer.emailMarketingOptIn || customer.emailUnsubscribed) {
        result = { ok: false, status: "skipped", reason: "no_consent" };
      } else {
        const html = renderedHtml ?? `<p>Hi ${escapeHtml(customer.name || "there")},</p><p>${escapeHtml(renderedBody).replace(/\n/g, "<br/>")}</p>${
          content.ctaUrl ? `<p><a href="${content.ctaUrl}">${escapeHtml(content.ctaText || "Open")}</a></p>` : ""
        }`;
        const out = await sendEmail({
          to: customer.email, subject: renderedSubject, html, restaurantId: campaign.restaurantId,
          kind: "marketing", recipientType: "customer", campaignId: campaign.id,
        });
        result = { ok: !!out?.ok, status: out?.ok ? "sent" : "failed", reason: out?.ok ? undefined : (out as { reason?: string })?.reason };
      }
    } else if (channel === "sms") {
      if (!customer.phone) { result = { ok: false, status: "skipped", reason: "no_phone" }; }
      else {
        const to = toE164(customer.phone, await getRestaurantIso(campaign.restaurantId));
        if (!to) { result = { ok: false, status: "skipped", reason: "invalid_phone" }; }
        else if (await isSuppressed(campaign.restaurantId, "sms", to)) {
          result = { ok: false, status: "skipped", reason: "suppressed" };
        } else {
          const out = await sendSmsMessage({
            to, body: renderedBody,
            restaurantId: campaign.restaurantId,
            // Use the broadcast pseudo-event so quota/provider routing applies.
            eventKey: "marketing.broadcast" as never,
          });
          result = { ok: out.ok, status: out.ok ? "sent" : "failed", providerMessageId: out.providerMessageId ?? null, reason: out.error };
        }
      }
    } else if (channel === "whatsapp") {
      if (!customer.phone) { result = { ok: false, status: "skipped", reason: "no_phone" }; }
      else if (!customer.whatsappOptIn) { result = { ok: false, status: "skipped", reason: "no_consent" }; }
      else {
        const to = toE164(customer.phone, await getRestaurantIso(campaign.restaurantId));
        if (!to) { result = { ok: false, status: "skipped", reason: "invalid_phone" }; }
        else if (await isSuppressed(campaign.restaurantId, "whatsapp", to)) {
          result = { ok: false, status: "skipped", reason: "suppressed" };
        } else {
          const out = await sendBroadcastWhatsApp({
            restaurantId: campaign.restaurantId, to,
            subject: renderedSubject, body: renderedBody,
            event: `growth.campaign.${campaign.type}`,
          });
          const ok = out.status === "sent" || out.status === "queued" || out.status === "delivered";
          result = { ok, status: ok ? "sent" : "failed", providerMessageId: out.messageId, reason: out.error };
        }
      }
    } else if (channel === "push") {
      const out = await sendWebPush({
        restaurantId: campaign.restaurantId, eventKey: "system.announcement",
        category: "marketing", campaignId: campaign.id,
        payload: {
          title: renderedTitle || renderedSubject,
          body: renderedBody,
          url: content.ctaUrl ?? undefined,
          image: content.imageUrl ?? undefined,
        },
        targetCustomerIds: [customer.id],
      });
      const ok = out.sent > 0;
      result = { ok, status: ok ? "sent" : (out.skipped > 0 ? "skipped" : "failed"), reason: out.reason };
    } else if (channel === "qr_banner") {
      result = { ok: true, status: "sent", reason: "qr_banner_activated" };
    } else {
      result = { ok: false, status: "failed", reason: `unsupported_channel:${channel}` };
    }
  } catch (err) {
    logger.warn({ err, channel, customerId: customer.id, campaignId: campaign.id }, "campaign dispatch failed");
    result = { ok: false, status: "failed", reason: (err as Error).message };
  }

  // Per-recipient log row (skip in test mode to avoid polluting analytics).
  if (!isTest) {
    await db.insert(campaignLogsTable).values({
      campaignId: campaign.id,
      restaurantId: campaign.restaurantId,
      event: result.status,
      stepId: step?.id ?? null,
      channel,
      customerId: customer.id,
      providerMessageId: result.providerMessageId ?? null,
      errorReason: result.reason ?? null,
      contentSnapshot: { subject: renderedSubject, body: renderedBody.slice(0, 500), title: renderedTitle },
      payload: { ok: result.ok, status: result.status, reason: result.reason },
    }).catch(err => logger.warn({ err }, "campaign log insert failed"));
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────
// Launch a single-shot campaign (non-omnichannel).
// ─────────────────────────────────────────────────────────────────
export async function launchSingleShot(campaign: Campaign): Promise<{ sent: number; failed: number; skipped: number; total: number }> {
  const audience = (campaign.audience ?? {}) as AudienceFilter;
  const content = (campaign.content ?? {}) as StepContent;
  const restaurantName = await getRestaurantName(campaign.restaurantId);
  const recipients = await resolveSegment(campaign.restaurantId, audience);
  const totals = { sent: 0, failed: 0, skipped: 0, total: recipients.length };
  for (const c of recipients) {
    const r = await dispatchOne({
      campaign, channel: campaign.channel as ChannelName, customer: c,
      content, restaurantName,
    });
    if (r.status === "sent") totals.sent++;
    else if (r.status === "skipped") totals.skipped++;
    else totals.failed++;
  }
  return totals;
}

// ─────────────────────────────────────────────────────────────────
// Launch an omnichannel campaign — enroll all recipients and let
// advanceOmnichannelEnrollments() drive them through the steps.
// ─────────────────────────────────────────────────────────────────
export async function launchOmnichannel(campaign: Campaign): Promise<{ enrolled: number }> {
  const audience = (campaign.audience ?? {}) as AudienceFilter;
  const recipients = await resolveSegment(campaign.restaurantId, audience);
  if (recipients.length === 0) return { enrolled: 0 };

  const now = new Date();
  const rows = recipients.map(c => ({
    campaignId: campaign.id,
    restaurantId: campaign.restaurantId,
    customerId: c.id,
    currentStepOrder: 0,
    status: "active" as const,
    nextSendAt: now,
    enrolledAt: now,
    updatedAt: now,
  }));
  // Chunk insert to avoid huge single statements.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(campaignEnrollmentsTable).values(rows.slice(i, i + CHUNK))
      .onConflictDoNothing();
  }
  return { enrolled: rows.length };
}

// ─────────────────────────────────────────────────────────────────
// Scheduler tick — pick up due single-shot + recurring campaigns.
// ─────────────────────────────────────────────────────────────────
export async function runDueCampaignsTick(): Promise<{ launched: number }> {
  const now = new Date();
  const due = await db.select().from(campaignsTable).where(and(
    eq(campaignsTable.status, "scheduled"),
    lte(campaignsTable.scheduledAt, now),
  )).limit(50);

  let launched = 0;
  for (const c of due) {
    try {
      await db.update(campaignsTable).set({ status: "sending", updatedAt: new Date() })
        .where(eq(campaignsTable.id, c.id));
      if (c.isOmnichannel) {
        const out = await launchOmnichannel(c);
        await db.update(campaignsTable).set({
          status: "sent", sentAt: new Date(),
          stats: { ...(c.stats ?? {}), enrolled: out.enrolled },
          lastDispatchedAt: new Date(), updatedAt: new Date(),
        }).where(eq(campaignsTable.id, c.id));
      } else {
        const out = await launchSingleShot(c);
        await db.update(campaignsTable).set({
          status: "sent", sentAt: new Date(),
          stats: { ...(c.stats ?? {}), ...out },
          lastDispatchedAt: new Date(), updatedAt: new Date(),
        }).where(eq(campaignsTable.id, c.id));
      }
      await db.insert(campaignLogsTable).values({
        campaignId: c.id, restaurantId: c.restaurantId, event: "dispatched", payload: { trigger: "scheduler" },
      });
      // Reschedule recurring campaigns.
      if (c.scheduleKind === "recurring" && c.recurrence) {
        const next = computeNextRecurrence(now, c.recurrence);
        if (next) {
          await db.update(campaignsTable).set({
            status: "scheduled", scheduledAt: next, updatedAt: new Date(),
          }).where(eq(campaignsTable.id, c.id));
        }
      }
      launched++;
    } catch (err) {
      logger.error({ err, id: c.id }, "growth-engine due campaign launch failed");
      await db.update(campaignsTable).set({ status: "draft", updatedAt: new Date() })
        .where(eq(campaignsTable.id, c.id)).catch(() => {});
    }
  }
  return { launched };
}

// ─────────────────────────────────────────────────────────────────
// Scheduler tick — advance omnichannel enrollments through steps.
// ─────────────────────────────────────────────────────────────────
export async function advanceOmnichannelEnrollments(): Promise<{ sent: number }> {
  const now = new Date();
  const due = await db.select().from(campaignEnrollmentsTable).where(and(
    eq(campaignEnrollmentsTable.status, "active"),
    lte(campaignEnrollmentsTable.nextSendAt, now),
  )).limit(200);

  let sent = 0;
  for (const e of due) {
    try {
      const [c] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, e.campaignId));
      if (!c || c.status === "paused" || c.status === "cancelled" || c.pausedAt || c.cancelledAt) continue;
      const steps = await db.select().from(campaignStepsTable)
        .where(eq(campaignStepsTable.campaignId, e.campaignId))
        .orderBy(campaignStepsTable.order);
      const step = steps[e.currentStepOrder];
      if (!step) {
        await db.update(campaignEnrollmentsTable).set({ status: "completed", updatedAt: new Date() })
          .where(eq(campaignEnrollmentsTable.id, e.id));
        continue;
      }
      const [cust] = await db.select({
        id: customersTable.id, name: customersTable.name, email: customersTable.email,
        phone: customersTable.phone, totalOrders: customersTable.totalOrders,
        totalSpent: customersTable.totalSpent, lastVisitAt: customersTable.lastVisitAt,
        birthday: customersTable.birthday, anniversary: customersTable.anniversary,
        emailMarketingOptIn: customersTable.emailMarketingOptIn,
        emailUnsubscribed: customersTable.emailUnsubscribed,
        whatsappOptIn: customersTable.whatsappOptIn,
        preferredChannel: customersTable.preferredChannel,
      }).from(customersTable).where(eq(customersTable.id, e.customerId));
      if (!cust) {
        await db.update(campaignEnrollmentsTable).set({ status: "exited", updatedAt: new Date() })
          .where(eq(campaignEnrollmentsTable.id, e.id));
        continue;
      }
      const restaurantName = await getRestaurantName(c.restaurantId);
      const result = await dispatchOne({
        campaign: c, step, channel: step.channel as ChannelName,
        customer: cust as CustomerRow,
        content: (step.content ?? {}) as StepContent, restaurantName,
      });
      sent += result.status === "sent" ? 1 : 0;

      const nextStep = steps[e.currentStepOrder + 1];
      const nextSend = nextStep ? new Date(Date.now() + nextStep.delayMinutes * 60_000) : null;
      await db.update(campaignEnrollmentsTable).set({
        currentStepOrder: e.currentStepOrder + 1,
        status: nextStep ? "active" : "completed",
        nextSendAt: nextSend,
        lastSentAt: new Date(),
        lastChannel: step.channel,
        updatedAt: new Date(),
      }).where(eq(campaignEnrollmentsTable.id, e.id));
    } catch (err) {
      logger.error({ err, id: e.id }, "advanceOmnichannel error");
    }
  }
  return { sent };
}

// ─────────────────────────────────────────────────────────────────
// Conversion attribution (called by order routes optionally).
// ─────────────────────────────────────────────────────────────────
export async function attributeOrderToCampaigns(orderId: number, customerId: number, restaurantId: number, revenue: number): Promise<void> {
  try {
    const enrolls = await db.select().from(campaignEnrollmentsTable).where(and(
      eq(campaignEnrollmentsTable.customerId, customerId),
      eq(campaignEnrollmentsTable.restaurantId, restaurantId),
      isNotNull(campaignEnrollmentsTable.lastSentAt),
    ));
    const now = new Date();
    for (const e of enrolls) {
      if (e.convertedAt) continue;
      if (!e.lastSentAt) continue;
      const [c] = await db.select({ window: campaignsTable.attributionWindowHours })
        .from(campaignsTable).where(eq(campaignsTable.id, e.campaignId));
      if (!c) continue;
      const windowMs = (c.window ?? 72) * 3600_000;
      if (now.getTime() - e.lastSentAt.getTime() > windowMs) continue;
      await db.update(campaignEnrollmentsTable).set({
        convertedAt: now, conversionOrderId: orderId,
        conversionRevenue: revenue.toFixed(2),
        status: "converted", updatedAt: now,
      }).where(eq(campaignEnrollmentsTable.id, e.id));
      await db.insert(campaignLogsTable).values({
        campaignId: e.campaignId, restaurantId, event: "converted",
        customerId, payload: { orderId, revenue },
      });
    }
  } catch (err) {
    logger.warn({ err, orderId }, "attribution failed");
  }
}

// ─────────────────────────────────────────────────────────────────
// Analytics rollup for a single campaign.
// ─────────────────────────────────────────────────────────────────
export async function getCampaignAnalytics(campaignId: number, restaurantId: number): Promise<{
  funnel: { sent: number; failed: number; skipped: number; converted: number };
  revenue: number;
  byChannel: Record<string, { sent: number; failed: number; converted: number }>;
  timeline: Array<{ event: string; channel: string | null; at: string; customerId: number | null; reason: string | null }>;
  recipients: Array<{ customerId: number | null; channel: string | null; status: string; sentAt: string; reason: string | null }>;
}> {
  const [funnel] = await db.select({
    sent: sql<number>`count(*) filter (where event = 'sent')::int`,
    failed: sql<number>`count(*) filter (where event = 'failed')::int`,
    skipped: sql<number>`count(*) filter (where event = 'skipped')::int`,
    converted: sql<number>`count(*) filter (where event = 'converted')::int`,
  }).from(campaignLogsTable).where(and(
    eq(campaignLogsTable.campaignId, campaignId),
    eq(campaignLogsTable.restaurantId, restaurantId),
  ));

  const [rev] = await db.select({
    total: sql<number>`coalesce(sum(conversion_revenue)::float, 0)`,
  }).from(campaignEnrollmentsTable).where(and(
    eq(campaignEnrollmentsTable.campaignId, campaignId),
    eq(campaignEnrollmentsTable.restaurantId, restaurantId),
  ));

  const channelRows = await db.select({
    channel: campaignLogsTable.channel,
    sent: sql<number>`count(*) filter (where event = 'sent')::int`,
    failed: sql<number>`count(*) filter (where event = 'failed')::int`,
    converted: sql<number>`count(*) filter (where event = 'converted')::int`,
  }).from(campaignLogsTable).where(and(
    eq(campaignLogsTable.campaignId, campaignId),
    eq(campaignLogsTable.restaurantId, restaurantId),
    isNotNull(campaignLogsTable.channel),
  )).groupBy(campaignLogsTable.channel);

  const byChannel: Record<string, { sent: number; failed: number; converted: number }> = {};
  for (const r of channelRows) {
    if (r.channel) byChannel[r.channel] = { sent: r.sent, failed: r.failed, converted: r.converted };
  }

  const timelineRows = await db.select({
    event: campaignLogsTable.event,
    channel: campaignLogsTable.channel,
    createdAt: campaignLogsTable.createdAt,
    customerId: campaignLogsTable.customerId,
    errorReason: campaignLogsTable.errorReason,
  }).from(campaignLogsTable).where(and(
    eq(campaignLogsTable.campaignId, campaignId),
    eq(campaignLogsTable.restaurantId, restaurantId),
  )).orderBy(desc(campaignLogsTable.createdAt)).limit(200);

  const recipientRows = await db.select({
    customerId: campaignLogsTable.customerId,
    channel: campaignLogsTable.channel,
    event: campaignLogsTable.event,
    createdAt: campaignLogsTable.createdAt,
    errorReason: campaignLogsTable.errorReason,
  }).from(campaignLogsTable).where(and(
    eq(campaignLogsTable.campaignId, campaignId),
    eq(campaignLogsTable.restaurantId, restaurantId),
    isNotNull(campaignLogsTable.customerId),
  )).orderBy(desc(campaignLogsTable.createdAt)).limit(500);

  return {
    funnel: {
      sent: funnel?.sent ?? 0,
      failed: funnel?.failed ?? 0,
      skipped: funnel?.skipped ?? 0,
      converted: funnel?.converted ?? 0,
    },
    revenue: Number(rev?.total ?? 0),
    byChannel,
    timeline: timelineRows.map(r => ({
      event: r.event, channel: r.channel, at: r.createdAt.toISOString(),
      customerId: r.customerId, reason: r.errorReason,
    })),
    recipients: recipientRows.map(r => ({
      customerId: r.customerId, channel: r.channel, status: r.event,
      sentAt: r.createdAt.toISOString(), reason: r.errorReason,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────
// Helpers.
// ─────────────────────────────────────────────────────────────────
function computeNextRecurrence(from: Date, rule: NonNullable<Campaign["recurrence"]>): Date | null {
  if (!rule) return null;
  if (rule.until) {
    const u = new Date(rule.until);
    if (u.getTime() < from.getTime()) return null;
  }
  const out = new Date(from);
  if (rule.frequency === "daily") out.setUTCDate(out.getUTCDate() + 1);
  else if (rule.frequency === "weekly") out.setUTCDate(out.getUTCDate() + 7);
  else if (rule.frequency === "monthly") out.setUTCMonth(out.getUTCMonth() + 1);
  else return null;
  if (rule.hour !== undefined) out.setUTCHours(rule.hour);
  if (rule.minute !== undefined) out.setUTCMinutes(rule.minute);
  return out;
}

async function getRestaurantName(restaurantId: number): Promise<string> {
  const [r] = await db.select({ name: restaurantsTable.name })
    .from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  return r?.name ?? "our restaurant";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

// Counts active recurring campaigns for plan-limit enforcement.
export async function countActiveRecurring(restaurantId: number): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` })
    .from(campaignsTable).where(and(
      eq(campaignsTable.restaurantId, restaurantId),
      eq(campaignsTable.scheduleKind, "recurring"),
      sql`${campaignsTable.status} IN ('scheduled','sending')`,
    ));
  return row?.n ?? 0;
}

export async function countCampaignsThisMonth(restaurantId: number): Promise<number> {
  const start = new Date();
  start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const [row] = await db.select({ n: sql<number>`count(*)::int` })
    .from(campaignsTable).where(and(
      eq(campaignsTable.restaurantId, restaurantId),
      gte(campaignsTable.createdAt, start),
    ));
  return row?.n ?? 0;
}
