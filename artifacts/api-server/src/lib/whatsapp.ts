import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  whatsappSettingsTable,
  whatsappTemplatesTable,
  whatsappLogsTable,
  whatsappUsageTable,
  restaurantsTable,
  tenantsTable,
  subscriptionPlansTable,
  appSettingsTable,
  type WhatsAppSetting,
  type WhatsAppLog,
} from "./db";
import { logger } from "./logger";
import { applySafeSendGuards, type SafeSendCategory } from "./whatsappSafeSend";
import { sendTextViaWebQr, isSessionConnected } from "./whatsappWebQr";
import type { WhatsAppProviderType } from "./whatsappProviders";

export type WhatsAppScope = "platform" | "restaurant";

export interface ResolvedWhatsAppCreds {
  source: "platform" | "restaurant";
  enabled: boolean;
  accessToken: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  businessId: string | null;
  webhookVerifyToken: string | null;
}

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v20.0";

export function maskSecret(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

const SECRET_FIELDS: Array<keyof WhatsAppSetting> = ["accessToken", "webhookVerifyToken"];

export function maskSettings(row: WhatsAppSetting | null): (Omit<WhatsAppSetting, "accessToken" | "webhookVerifyToken"> & { accessToken: string; webhookVerifyToken: string; webhookUrl: string }) | null {
  if (!row) return null;
  return {
    ...row,
    accessToken: maskSecret(row.accessToken),
    webhookVerifyToken: maskSecret(row.webhookVerifyToken),
    webhookUrl: getWebhookUrl(),
  };
}

export function getWebhookUrl(): string {
  const base = process.env.PUBLIC_API_BASE_URL ?? process.env.REPLIT_DEV_DOMAIN
    ? (process.env.PUBLIC_API_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`)
    : "";
  return `${base.replace(/\/$/, "")}/api/whatsapp/webhook`;
}

export async function getPlatformSettings(): Promise<WhatsAppSetting | null> {
  const [row] = await db.select().from(whatsappSettingsTable).where(eq(whatsappSettingsTable.scope, "platform"));
  return row ?? null;
}

export async function getRestaurantSettings(restaurantId: number): Promise<WhatsAppSetting | null> {
  const [row] = await db.select().from(whatsappSettingsTable).where(and(
    eq(whatsappSettingsTable.scope, "restaurant"),
    eq(whatsappSettingsTable.restaurantId, restaurantId),
  ));
  return row ?? null;
}

/**
 * Upsert a settings row. Secret fields that arrive masked (••••xxxx) are
 * preserved from the existing row instead of being overwritten with the mask.
 */
export async function upsertSettings(
  scope: WhatsAppScope,
  restaurantId: number | null,
  patch: Partial<WhatsAppSetting>,
  userId: number | null,
): Promise<WhatsAppSetting> {
  const existing = scope === "platform"
    ? await getPlatformSettings()
    : await getRestaurantSettings(restaurantId!);

  const merged: Record<string, unknown> = { ...(existing ?? {}), ...patch };
  for (const k of SECRET_FIELDS) {
    const v = (patch as Record<string, unknown>)[k as string];
    if (typeof v === "string" && v.startsWith("••••")) {
      merged[k as string] = (existing as Record<string, unknown> | null)?.[k as string] ?? null;
    }
  }

  // Safe-send + provider type columns. These are optional; we only update
  // fields that were explicitly provided in `patch` so callers can PATCH a
  // subset without wiping unrelated settings.
  const safeSendKeys = [
    "providerType",
    "safeSendDailyCap", "safeSendHourlyCap", "safeSendMinDelaySec",
    "safeSendQuietStart", "safeSendQuietEnd", "safeSendDuplicateWindowSec",
    "marketingAllowed", "marketingOptInRequired",
  ] as const;
  const safePatch: Record<string, unknown> = {};
  for (const k of safeSendKeys) if (k in patch) safePatch[k] = (patch as Record<string, unknown>)[k];

  if (existing) {
    const [row] = await db.update(whatsappSettingsTable).set({
      isEnabled: merged.isEnabled as boolean ?? existing.isEnabled,
      usePlatformAccount: merged.usePlatformAccount as boolean ?? existing.usePlatformAccount,
      provider: (merged.provider as string) ?? existing.provider,
      accessToken: merged.accessToken as string | null ?? null,
      phoneNumberId: merged.phoneNumberId as string | null ?? null,
      wabaId: merged.wabaId as string | null ?? null,
      businessId: merged.businessId as string | null ?? null,
      webhookVerifyToken: merged.webhookVerifyToken as string | null ?? null,
      ...safePatch,
      updatedBy: userId,
      updatedAt: new Date(),
    }).where(eq(whatsappSettingsTable.id, existing.id)).returning();
    return row;
  }
  const [row] = await db.insert(whatsappSettingsTable).values({
    scope,
    restaurantId: scope === "restaurant" ? restaurantId : null,
    provider: (patch.provider as string) ?? "meta_cloud",
    isEnabled: !!patch.isEnabled,
    usePlatformAccount: patch.usePlatformAccount ?? true,
    accessToken: (patch.accessToken as string | null) ?? null,
    phoneNumberId: (patch.phoneNumberId as string | null) ?? null,
    wabaId: (patch.wabaId as string | null) ?? null,
    businessId: (patch.businessId as string | null) ?? null,
    webhookVerifyToken: (patch.webhookVerifyToken as string | null) ?? null,
    ...safePatch,
    updatedBy: userId,
  }).returning();
  return row;
}

/**
 * Resolve credentials for a restaurant. If the restaurant uses the platform
 * account, returns platform credentials; otherwise returns the restaurant's
 * own credentials. `enabled` collapses both rows' enable flags.
 */
export async function resolveCredsForRestaurant(restaurantId: number): Promise<ResolvedWhatsAppCreds> {
  const [platform, own] = await Promise.all([
    getPlatformSettings(),
    getRestaurantSettings(restaurantId),
  ]);
  const usePlatform = own?.usePlatformAccount !== false; // default to platform if no row
  const src = usePlatform ? platform : own;
  const enabled = !!(usePlatform ? platform?.isEnabled : own?.isEnabled);
  return {
    source: usePlatform ? "platform" : "restaurant",
    enabled: enabled && !!src?.accessToken && !!src?.phoneNumberId,
    accessToken: src?.accessToken ?? null,
    phoneNumberId: src?.phoneNumberId ?? null,
    wabaId: src?.wabaId ?? null,
    businessId: src?.businessId ?? null,
    webhookVerifyToken: src?.webhookVerifyToken ?? null,
  };
}

// ─── Meta WhatsApp Cloud API client ───────────────────────────────

interface MetaSendResponse {
  messages?: Array<{ id: string }>;
  error?: { message?: string; code?: number };
}

async function metaCall<T>(path: string, accessToken: string, init: RequestInit & { method: string }): Promise<T> {
  const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    const err = (json as { error?: { message?: string } } | null)?.error?.message ?? text ?? `HTTP ${res.status}`;
    throw new Error(`Meta API ${res.status}: ${err}`);
  }
  return (json ?? {}) as T;
}

/** Send a free-text (session) message. Only works inside the 24-hour window. */
export async function metaSendText(creds: ResolvedWhatsAppCreds, to: string, body: string): Promise<{ messageId: string | null }> {
  if (!creds.accessToken || !creds.phoneNumberId) throw new Error("WhatsApp not configured");
  const out = await metaCall<MetaSendResponse>(`/${creds.phoneNumberId}/messages`, creds.accessToken, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizePhone(to),
      type: "text",
      text: { body },
    }),
  });
  return { messageId: out.messages?.[0]?.id ?? null };
}

/** Send a template (transactional) message. Required outside the 24-hour window. */
export async function metaSendTemplate(
  creds: ResolvedWhatsAppCreds,
  to: string,
  templateName: string,
  language: string,
  variables: string[] = [],
): Promise<{ messageId: string | null }> {
  if (!creds.accessToken || !creds.phoneNumberId) throw new Error("WhatsApp not configured");
  const components = variables.length
    ? [{ type: "body", parameters: variables.map(v => ({ type: "text", text: v })) }]
    : undefined;
  const out = await metaCall<MetaSendResponse>(`/${creds.phoneNumberId}/messages`, creds.accessToken, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizePhone(to),
      type: "template",
      template: { name: templateName, language: { code: language }, ...(components ? { components } : {}) },
    }),
  });
  return { messageId: out.messages?.[0]?.id ?? null };
}

interface MetaTemplateRow {
  id?: string;
  name?: string;
  language?: string;
  category?: string;
  status?: string;
  components?: Array<{ type?: string; text?: string; format?: string }>;
}

/** Pull the WABA's templates and upsert them locally. Returns count synced. */
export async function syncTemplates(scope: WhatsAppScope, restaurantId: number | null): Promise<{ synced: number }> {
  const creds = scope === "platform"
    ? await platformAsCreds()
    : await resolveCredsForRestaurant(restaurantId!);
  if (!creds.accessToken || !creds.wabaId) {
    throw new Error("Cannot sync templates: missing access token or WABA ID");
  }

  let synced = 0;
  let next: string | null = `/${creds.wabaId}/message_templates?limit=100&fields=name,language,status,category,components`;
  while (next) {
    const url: string = next;
    const res = await metaCall<{ data: MetaTemplateRow[]; paging?: { next?: string } }>(url, creds.accessToken, { method: "GET" });
    for (const t of res.data ?? []) {
      if (!t.name) continue;
      const body = (t.components ?? []).find(c => c.type === "BODY")?.text ?? "";
      await db.insert(whatsappTemplatesTable).values({
        scope,
        restaurantId: scope === "restaurant" ? restaurantId : null,
        name: t.name,
        language: t.language ?? "en",
        category: t.category ?? null,
        status: (t.status ?? "pending").toLowerCase(),
        bodyPreview: body.slice(0, 500),
        raw: t as unknown as Record<string, unknown>,
        syncedAt: new Date(),
      }).onConflictDoUpdate({
        target: [whatsappTemplatesTable.scope, whatsappTemplatesTable.restaurantId, whatsappTemplatesTable.name, whatsappTemplatesTable.language],
        set: {
          category: t.category ?? null,
          status: (t.status ?? "pending").toLowerCase(),
          bodyPreview: body.slice(0, 500),
          raw: t as unknown as Record<string, unknown>,
          syncedAt: new Date(),
        },
      });
      synced++;
    }
    next = res.paging?.next ? new URL(res.paging.next).pathname + new URL(res.paging.next).search : null;
    // Meta returns absolute URLs; strip the version prefix to keep our helper happy.
    if (next?.startsWith(`/${META_GRAPH_VERSION}`)) next = next.slice(META_GRAPH_VERSION.length + 1);
  }
  return { synced };
}

async function platformAsCreds(): Promise<ResolvedWhatsAppCreds> {
  const row = await getPlatformSettings();
  return {
    source: "platform",
    enabled: !!row?.isEnabled && !!row?.accessToken && !!row?.phoneNumberId,
    accessToken: row?.accessToken ?? null,
    phoneNumberId: row?.phoneNumberId ?? null,
    wabaId: row?.wabaId ?? null,
    businessId: row?.businessId ?? null,
    webhookVerifyToken: row?.webhookVerifyToken ?? null,
  };
}

// ─── Quota & usage ────────────────────────────────────────────────

export async function getEffectiveLimit(restaurantId: number): Promise<number> {
  const [r] = await db.select({
    override: restaurantsTable.whatsappMonthlyLimitOverride,
    tenantId: restaurantsTable.tenantId,
  }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  if (!r) return 0;
  if (r.override !== null && r.override !== undefined) return Number(r.override);
  const [tenant] = await db.select({ planId: tenantsTable.planId }).from(tenantsTable).where(eq(tenantsTable.id, r.tenantId));
  if (!tenant?.planId) return 0;
  const [plan] = await db.select({ limit: subscriptionPlansTable.whatsappMonthlyLimit })
    .from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, tenant.planId));
  return Number(plan?.limit ?? 0);
}

function currentMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export async function getUsage(restaurantId: number): Promise<{ sent: number; success: number; failure: number; blocked: number; limit: number; remaining: number }> {
  const { year, month } = currentMonth();
  const [row] = await db.select().from(whatsappUsageTable).where(and(
    eq(whatsappUsageTable.restaurantId, restaurantId),
    eq(whatsappUsageTable.year, year),
    eq(whatsappUsageTable.month, month),
  ));
  const limit = await getEffectiveLimit(restaurantId);
  const sent = row?.sent ?? 0;
  return {
    sent,
    success: row?.success ?? 0,
    failure: row?.failure ?? 0,
    blocked: row?.blocked ?? 0,
    limit,
    remaining: limit > 0 ? Math.max(0, limit - sent) : Number.MAX_SAFE_INTEGER,
  };
}

async function bumpUsage(restaurantId: number, kind: "success" | "failure" | "blocked"): Promise<void> {
  const { year, month } = currentMonth();
  const sentDelta = kind === "blocked" ? 0 : 1;
  await db.insert(whatsappUsageTable).values({
    restaurantId, year, month,
    sent: sentDelta,
    success: kind === "success" ? 1 : 0,
    failure: kind === "failure" ? 1 : 0,
    blocked: kind === "blocked" ? 1 : 0,
  }).onConflictDoUpdate({
    target: [whatsappUsageTable.restaurantId, whatsappUsageTable.year, whatsappUsageTable.month],
    set: {
      sent: sql`${whatsappUsageTable.sent} + ${sentDelta}`,
      success: sql`${whatsappUsageTable.success} + ${kind === "success" ? 1 : 0}`,
      failure: sql`${whatsappUsageTable.failure} + ${kind === "failure" ? 1 : 0}`,
      blocked: sql`${whatsappUsageTable.blocked} + ${kind === "blocked" ? 1 : 0}`,
      updatedAt: new Date(),
    },
  });
}

// ─── Unified send ─────────────────────────────────────────────────

export interface SendOptions {
  /** Restaurant context. Required so quotas, settings, and logs are tenant-scoped. Pass null only for super-admin platform tests. */
  restaurantId: number | null;
  tenantId?: number | null;
  to: string;
  /** If templateName is provided, sends a template; otherwise sends a session text. */
  templateName?: string;
  templateLanguage?: string;
  templateVariables?: string[];
  body?: string;
  /** Free-form context recorded on the log row. */
  meta?: Record<string, unknown>;
  sentBy?: number | null;
  /** When true, skip the quota enforcement (super-admin test sends, system messages). */
  skipQuota?: boolean;
  /** Classify the send so safe-send guards (opt-in, quiet hours, marketing flag) apply correctly. Defaults to "transactional". */
  category?: SafeSendCategory;
  /** Override the provider pipeline (used by campaign retries and tests). Falls back to the restaurant's whatsapp_settings.providerType. */
  providerOverride?: WhatsAppProviderType;
}

export interface SendResult {
  status: "sent" | "failed" | "blocked";
  logId: number;
  providerMessageId: string | null;
  error?: string;
}

/** Resolve the provider pipeline for a restaurant; defaults to "cloud_api". */
export async function resolveProviderType(restaurantId: number | null): Promise<WhatsAppProviderType> {
  if (!restaurantId) return "cloud_api";
  const row = await getRestaurantSettings(restaurantId);
  const t = (row?.providerType ?? "cloud_api") as WhatsAppProviderType;
  if (t === "cloud_api" || t === "web_qr" || t === "disabled") return t;
  return "cloud_api";
}

/** Returns true when Web QR is globally enabled AND the tenant's plan permits it. */
export async function isWebQrAllowed(restaurantId: number): Promise<{ allowed: boolean; reason?: string }> {
  const [app] = await db.select({
    on: appSettingsTable.whatsappWebQrGlobalEnabled,
    allowedPlans: appSettingsTable.whatsappWebQrAllowedPlans,
  }).from(appSettingsTable).where(eq(appSettingsTable.id, 1));
  if (!app?.on) return { allowed: false, reason: "Web QR is disabled platform-wide." };
  const [r] = await db.select({ tenantId: restaurantsTable.tenantId }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  if (!r) return { allowed: false, reason: "Unknown restaurant." };
  const [tenant] = await db.select({ planId: tenantsTable.planId }).from(tenantsTable).where(eq(tenantsTable.id, r.tenantId));
  if (!tenant?.planId) return { allowed: false, reason: "No active plan." };
  const [plan] = await db.select({
    slug: subscriptionPlansTable.slug,
    on: subscriptionPlansTable.whatsappWebQrEnabled,
  }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, tenant.planId));
  if (!plan) return { allowed: false, reason: "Plan not found." };
  const list = app.allowedPlans ?? [];
  if (list.length > 0 && !list.includes(plan.slug)) return { allowed: false, reason: "Your plan is not on the Web QR allow-list." };
  if (!plan.on) return { allowed: false, reason: "Your plan does not include WhatsApp Web QR." };
  return { allowed: true };
}

async function insertLog(opts: SendOptions, provider: WhatsAppProviderType, status: SendResult["status"], extra: { providerMessageId?: string | null; reason?: string | null }): Promise<number> {
  const [row] = await db.insert(whatsappLogsTable).values({
    restaurantId: opts.restaurantId,
    tenantId: opts.tenantId ?? null,
    provider,
    recipient: opts.to,
    templateName: opts.templateName ?? null,
    templateLanguage: opts.templateLanguage ?? null,
    body: opts.body ?? null,
    status,
    providerMessageId: extra.providerMessageId ?? null,
    reason: extra.reason ?? null,
    meta: opts.meta ?? {},
    sentBy: opts.sentBy ?? null,
  }).returning({ id: whatsappLogsTable.id });
  return row.id;
}

/**
 * Unified send entrypoint. Resolves provider, enforces enable + monthly
 * limit + safe-send guards, performs the send via the chosen provider,
 * writes a log row, and updates usage. The Cloud API path is byte-for-byte
 * the same Meta Graph call as before — restaurants still on `cloud_api`
 * see no behavioural change.
 */
export async function sendWhatsAppMessage(opts: SendOptions): Promise<SendResult> {
  const restaurantId = opts.restaurantId;
  const category = opts.category ?? "transactional";

  // Resolve provider pipeline. Restaurant-less platform sends (super-admin
  // tests, owner-tenant announcements) always use Cloud API.
  const providerType: WhatsAppProviderType = opts.providerOverride
    ?? (restaurantId ? await resolveProviderType(restaurantId) : "cloud_api");

  if (providerType === "disabled") {
    const logId = await insertLog(opts, "cloud_api", "blocked", { reason: "disabled" });
    if (restaurantId) await bumpUsage(restaurantId, "blocked");
    return { status: "blocked", logId, providerMessageId: null, error: "WhatsApp provider is set to Disabled" };
  }

  // Quota enforcement (universal, both providers).
  if (restaurantId && !opts.skipQuota) {
    const usage = await getUsage(restaurantId);
    if (usage.limit > 0 && usage.sent >= usage.limit) {
      const logId = await insertLog(opts, providerType, "blocked", { reason: "quota" });
      await bumpUsage(restaurantId, "blocked");
      return { status: "blocked", logId, providerMessageId: null, error: "Monthly WhatsApp quota exceeded" };
    }
  }

  // Safe-send guards (rate limits, opt-in, marketing, quiet hours, dup-window).
  // Skipped only when callers explicitly bypass quota (system pings, tests).
  if (restaurantId && !opts.skipQuota) {
    const settings = await getRestaurantSettings(restaurantId);
    if (settings) {
      const verdict = await applySafeSendGuards({
        restaurantId, settings, to: opts.to, body: opts.body ?? null, templateName: opts.templateName ?? null, category,
      });
      if (!verdict.ok) {
        const logId = await insertLog(opts, providerType, "blocked", { reason: verdict.reason ?? "safe_send" });
        await bumpUsage(restaurantId, "blocked");
        return { status: "blocked", logId, providerMessageId: null, error: `Blocked by safe-send rule: ${verdict.reason}` };
      }
    }
  }

  if (providerType === "web_qr") {
    if (!restaurantId) {
      const logId = await insertLog(opts, "web_qr", "blocked", { reason: "no_session" });
      return { status: "blocked", logId, providerMessageId: null, error: "Web QR requires a restaurant context" };
    }
    if (!isSessionConnected(restaurantId)) {
      const logId = await insertLog(opts, "web_qr", "blocked", { reason: "no_session" });
      await bumpUsage(restaurantId, "blocked");
      return { status: "blocked", logId, providerMessageId: null, error: "WhatsApp Web session is not connected" };
    }
    try {
      const res = await sendTextViaWebQr(restaurantId, opts.to, opts.body ?? "");
      const logId = await insertLog(opts, "web_qr", "sent", { providerMessageId: res.messageId });
      await bumpUsage(restaurantId, "success");
      return { status: "sent", logId, providerMessageId: res.messageId };
    } catch (err) {
      const message = (err as Error).message;
      logger.error({ err, to: opts.to, restaurantId }, "WhatsApp Web QR send failed");
      const reason = message === "no_session" ? "no_session" : message;
      const status: SendResult["status"] = message === "no_session" ? "blocked" : "failed";
      const logId = await insertLog(opts, "web_qr", status, { reason });
      if (status === "blocked") await bumpUsage(restaurantId, "blocked"); else await bumpUsage(restaurantId, "failure");
      return { status, logId, providerMessageId: null, error: message };
    }
  }

  // ─── Cloud API path (unchanged) ─────────────────────────────────────
  const creds: ResolvedWhatsAppCreds = restaurantId
    ? await resolveCredsForRestaurant(restaurantId)
    : await platformAsCreds();

  if (!creds.enabled) {
    const logId = await insertLog(opts, "cloud_api", "blocked", { reason: "disabled" });
    if (restaurantId) await bumpUsage(restaurantId, "blocked");
    return { status: "blocked", logId, providerMessageId: null, error: "WhatsApp is not enabled" };
  }

  try {
    const res = opts.templateName
      ? await metaSendTemplate(creds, opts.to, opts.templateName, opts.templateLanguage ?? "en", opts.templateVariables ?? [])
      : await metaSendText(creds, opts.to, opts.body ?? "");
    const logId = await insertLog(opts, "cloud_api", "sent", { providerMessageId: res.messageId });
    if (restaurantId) await bumpUsage(restaurantId, "success");
    return { status: "sent", logId, providerMessageId: res.messageId };
  } catch (err) {
    const message = (err as Error).message;
    logger.error({ err, to: opts.to }, "WhatsApp send failed");
    const logId = await insertLog(opts, "cloud_api", "failed", { reason: message });
    if (restaurantId) await bumpUsage(restaurantId, "failure");
    return { status: "failed", logId, providerMessageId: null, error: message };
  }
}

/** Re-attempt a previously logged message. Reuses the original recipient/body. */
export async function retryWhatsAppLog(logId: number, sentBy: number | null): Promise<SendResult> {
  const [row] = await db.select().from(whatsappLogsTable).where(eq(whatsappLogsTable.id, logId));
  if (!row) throw new Error("Log not found");
  if (row.status === "sent" || row.status === "delivered" || row.status === "read") {
    throw new Error("Cannot retry a successful message");
  }
  // Quota-blocked rows do not auto-retry — admins must lift the quota first.
  if (row.status === "blocked" && row.reason === "quota") {
    throw new Error("Cannot retry a quota-blocked message until the quota is lifted");
  }
  return sendWhatsAppMessage({
    restaurantId: row.restaurantId,
    tenantId: row.tenantId,
    to: row.recipient,
    templateName: row.templateName ?? undefined,
    templateLanguage: row.templateLanguage ?? undefined,
    body: row.body ?? undefined,
    meta: { ...(row.meta ?? {}), retryOf: row.id },
    sentBy,
  });
}

export async function retryFailedLogs(scope: WhatsAppScope, restaurantId: number | null, sentBy: number | null): Promise<{ retried: number; succeeded: number; failed: number }> {
  const conds = [eq(whatsappLogsTable.status, "failed")];
  if (scope === "restaurant" && restaurantId) conds.push(eq(whatsappLogsTable.restaurantId, restaurantId));
  const rows = await db.select({ id: whatsappLogsTable.id }).from(whatsappLogsTable)
    .where(and(...conds))
    .orderBy(desc(whatsappLogsTable.createdAt))
    .limit(200);
  let succeeded = 0, failed = 0;
  for (const r of rows) {
    try {
      const res = await retryWhatsAppLog(r.id, sentBy);
      if (res.status === "sent") succeeded++; else failed++;
    } catch { failed++; }
  }
  return { retried: rows.length, succeeded, failed };
}

// ─── Webhook handling ─────────────────────────────────────────────

export async function findWebhookCredsForVerify(token: string): Promise<boolean> {
  // Match against any settings row's verify token.
  const [row] = await db.select({ id: whatsappSettingsTable.id })
    .from(whatsappSettingsTable)
    .where(eq(whatsappSettingsTable.webhookVerifyToken, token))
    .limit(1);
  return !!row;
}

interface WebhookStatus {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: Array<{ message?: string; title?: string }>;
  pricing?: { category?: string; pricing_model?: string };
  conversation?: { id?: string; origin?: { type?: string } };
}

interface MetaWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        statuses?: WebhookStatus[];
      };
    }>;
  }>;
}

/** Update logs from incoming Meta status webhooks. */
export async function processWebhookEvent(payload: MetaWebhookPayload): Promise<{ updated: number }> {
  let updated = 0;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        if (!status.id || !status.status) continue;
        const errMsg = status.errors?.[0]?.message ?? null;
        const next = status.status.toLowerCase();
        const patch: Partial<WhatsAppLog> = {
          status: next,
          updatedAt: new Date(),
        };
        if (errMsg) patch.reason = errMsg;
        const result = await db.update(whatsappLogsTable)
          .set(patch)
          .where(eq(whatsappLogsTable.providerMessageId, status.id))
          .returning({ id: whatsappLogsTable.id });
        updated += result.length;
      }
    }
  }
  return { updated };
}

function normalizePhone(p: string): string {
  // Strip the WhatsApp scheme if present and any non-digit chars; keep leading +.
  return p.replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "").replace(/^\+/, "");
}

/** Plain helper for the broadcast pipeline (notificationCenter). */
export async function sendBroadcastWhatsApp(opts: {
  restaurantId: number | null;
  tenantId?: number | null;
  to: string;
  subject?: string;
  message?: string;
  body?: string;
  event?: string;
  templateVars?: Record<string, string>;
}): Promise<{ messageId: string | null; status: string; error?: string }> {
  const body = opts.body
    ?? (opts.subject ? `*${opts.subject}*\n\n${opts.message ?? ""}` : (opts.message ?? ""));
  const result = await sendWhatsAppMessage({
    restaurantId: opts.restaurantId,
    tenantId: opts.tenantId ?? null,
    to: opts.to,
    body,
    meta: { source: "broadcast", event: opts.event, templateVars: opts.templateVars },
  });
  return { messageId: result.providerMessageId, status: result.status, error: result.error };
}
