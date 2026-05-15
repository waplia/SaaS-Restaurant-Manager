import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  db,
  smsProvidersTable,
  smsTemplatesTable,
  smsLogsTable,
  tenantsTable,
  subscriptionPlansTable,
  type SmsProvider,
  type SmsTemplate,
  type SmsTemplateEventKey,
  type SmsLogStatus,
} from "./db";
import { logger } from "./logger";

export type SendInput = {
  to: string;
  body?: string;
  eventKey?: SmsTemplateEventKey;
  variables?: Record<string, string | number | undefined | null>;
  tenantId?: number | null;
  restaurantId?: number | null;
  providerId?: number | null;
  retryOf?: number | null;
  // When true, bypass quota checks (used for super-admin tests).
  bypassQuota?: boolean;
};

export type SendResult = {
  ok: boolean;
  logId: number;
  status: SmsLogStatus;
  providerMessageId?: string | null;
  error?: string;
};

export function renderTemplate(text: string, vars: Record<string, string | number | undefined | null> = {}): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

export async function getActiveProvider(providerId?: number | null): Promise<SmsProvider | null> {
  if (providerId) {
    const [row] = await db.select().from(smsProvidersTable).where(eq(smsProvidersTable.id, providerId));
    return row ?? null;
  }
  const [def] = await db.select().from(smsProvidersTable)
    .where(and(eq(smsProvidersTable.isEnabled, true), eq(smsProvidersTable.isDefault, true)))
    .limit(1);
  if (def) return def;
  const [first] = await db.select().from(smsProvidersTable)
    .where(eq(smsProvidersTable.isEnabled, true))
    .orderBy(smsProvidersTable.id)
    .limit(1);
  return first ?? null;
}

export async function getTemplateForEvent(eventKey: SmsTemplateEventKey): Promise<SmsTemplate | null> {
  const [row] = await db.select().from(smsTemplatesTable)
    .where(and(eq(smsTemplatesTable.eventKey, eventKey), eq(smsTemplatesTable.isActive, true)));
  return row ?? null;
}

function startOfMonthUtc(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function getTenantMonthlyUsage(tenantId: number): Promise<number> {
  const [row] = await db.select({ c: sql<number>`count(*)::int` })
    .from(smsLogsTable)
    .where(and(
      eq(smsLogsTable.tenantId, tenantId),
      gte(smsLogsTable.createdAt, startOfMonthUtc()),
      sql`${smsLogsTable.status} <> 'blocked' AND ${smsLogsTable.status} <> 'failed'`,
    ));
  return Number(row?.c ?? 0);
}

export async function getTenantMonthlyLimit(tenantId: number): Promise<number> {
  const [t] = await db.select({
    override: tenantsTable.smsMonthlyLimit,
    planLimit: subscriptionPlansTable.smsMonthlyLimit,
  })
    .from(tenantsTable)
    .leftJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, tenantsTable.planId))
    .where(eq(tenantsTable.id, tenantId));
  if (!t) return 0;
  if (typeof t.override === "number" && t.override > 0) return t.override;
  return Number(t.planLimit ?? 0);
}

async function callProvider(provider: SmsProvider, to: string, body: string, template: SmsTemplate | null): Promise<{
  providerMessageId: string | null;
  cost?: string | null;
  costCurrency?: string | null;
}> {
  const cfg = provider.config as Record<string, string | undefined>;

  if (provider.type === "twilio") {
    const sid = cfg.accountSid ?? "";
    const tok = cfg.authToken ?? "";
    const from = cfg.senderId ?? cfg.from ?? "";
    if (!sid || !tok || !from) throw new Error("Twilio provider missing accountSid/authToken/senderId");
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const form = new URLSearchParams({ From: from, To: to, Body: body });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${sid}:${tok}`).toString("base64")}`,
      },
      body: form.toString(),
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
    const json = await res.json().catch(() => ({} as Record<string, unknown>));
    return { providerMessageId: typeof json.sid === "string" ? json.sid : null, cost: typeof json.price === "string" ? json.price : null, costCurrency: typeof json.price_unit === "string" ? json.price_unit : null };
  }

  if (provider.type === "msg91") {
    const authKey = cfg.authKey ?? cfg.apiKey ?? "";
    const senderId = cfg.senderId ?? "";
    const route = cfg.route ?? "4";
    const country = cfg.countryCode ?? "91";
    if (!authKey) throw new Error("MSG91 provider missing authKey");
    const dlt = template?.dltTemplateId ?? cfg.entityId ?? "";
    const url = "https://api.msg91.com/api/v5/flow/";
    const payload: Record<string, unknown> = {
      sender: senderId,
      route,
      country,
      mobiles: to.replace(/^\+/, ""),
      authkey: authKey,
      message: body,
    };
    if (dlt) payload.template_id = dlt;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: authKey },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`MSG91 ${res.status}: ${await res.text()}`);
    const json = await res.json().catch(() => ({} as Record<string, unknown>));
    return { providerMessageId: typeof json.request_id === "string" ? json.request_id : (typeof json.message === "string" ? json.message : null) };
  }

  if (provider.type === "textlocal") {
    const apiKey = cfg.apiKey ?? "";
    const sender = cfg.senderId ?? "TXTLCL";
    if (!apiKey) throw new Error("Textlocal provider missing apiKey");
    const form = new URLSearchParams({ apikey: apiKey, numbers: to.replace(/^\+/, ""), sender, message: body });
    const res = await fetch("https://api.textlocal.in/send/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) throw new Error(`Textlocal ${res.status}: ${await res.text()}`);
    const json = await res.json().catch(() => ({} as Record<string, unknown>));
    if (json.status !== "success") throw new Error(`Textlocal: ${JSON.stringify(json.errors ?? json)}`);
    return { providerMessageId: typeof json.batch_id === "string" || typeof json.batch_id === "number" ? String(json.batch_id) : null };
  }

  if (provider.type === "fast2sms") {
    const apiKey = cfg.apiKey ?? "";
    if (!apiKey) throw new Error("Fast2SMS provider missing apiKey");
    const route = cfg.route ?? "q";
    const sender = cfg.senderId ?? "";
    const params = new URLSearchParams({
      authorization: apiKey,
      route,
      message: body,
      numbers: to.replace(/^\+91/, "").replace(/^\+/, ""),
    });
    if (sender) params.set("sender_id", sender);
    if (template?.dltTemplateId) params.set("template_id", template.dltTemplateId);
    const res = await fetch(`https://www.fast2sms.com/dev/bulkV2?${params.toString()}`);
    if (!res.ok) throw new Error(`Fast2SMS ${res.status}: ${await res.text()}`);
    const json = await res.json().catch(() => ({} as Record<string, unknown>));
    if (json.return !== true) throw new Error(`Fast2SMS: ${JSON.stringify(json)}`);
    const reqId = json.request_id;
    return { providerMessageId: typeof reqId === "string" || typeof reqId === "number" ? String(reqId) : null };
  }

  if (provider.type === "gupshup") {
    const apiKey = cfg.apiKey ?? "";
    const sender = cfg.senderId ?? cfg.userId ?? "";
    if (!apiKey || !sender) throw new Error("Gupshup provider missing apiKey/senderId");
    const params = new URLSearchParams({
      method: "SendMessage",
      send_to: to.replace(/^\+/, ""),
      msg: body,
      msg_type: "TEXT",
      userid: sender,
      auth_scheme: "plain",
      password: apiKey,
      v: "1.1",
      format: "json",
    });
    const res = await fetch(`https://enterprise.smsgupshup.com/GatewayAPI/rest?${params.toString()}`);
    if (!res.ok) throw new Error(`Gupshup ${res.status}: ${await res.text()}`);
    const text = await res.text();
    return { providerMessageId: text.slice(0, 200) };
  }

  if (provider.type === "custom") {
    const baseUrl = cfg.baseUrl ?? "";
    if (!baseUrl) throw new Error("Custom provider missing baseUrl");
    const method = (cfg.method ?? "POST").toString().toUpperCase();
    let headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cfg.headers) {
      try { headers = { ...headers, ...(typeof cfg.headers === "string" ? JSON.parse(cfg.headers) : cfg.headers as object) }; } catch { /* ignore */ }
    }
    const tmpl = cfg.bodyTemplate ?? '{"to":"{{to}}","message":"{{message}}"}';
    const rendered = renderTemplate(String(tmpl), { to, message: body });
    const init: RequestInit = { method, headers };
    if (method !== "GET" && method !== "HEAD") init.body = rendered;
    const url = method === "GET"
      ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${new URLSearchParams({ to, message: body }).toString()}`
      : baseUrl;
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`Custom ${res.status}: ${await res.text()}`);
    const txt = await res.text();
    return { providerMessageId: txt.slice(0, 200) };
  }

  throw new Error(`Unknown provider type ${provider.type}`);
}

/**
 * Send an SMS, recording a row in `sms_logs` for every attempt.
 * Quota and provider-enabled checks run inside; failures never throw to
 * callers — they return ok:false with the failure recorded in the log.
 */
export async function sendSmsMessage(input: SendInput): Promise<SendResult> {
  let template: SmsTemplate | null = null;
  let body = input.body ?? "";
  if (input.eventKey) {
    template = await getTemplateForEvent(input.eventKey);
    if (template) body = renderTemplate(template.body, input.variables ?? {});
  }
  if (!body) {
    const [log] = await db.insert(smsLogsTable).values({
      tenantId: input.tenantId ?? null,
      restaurantId: input.restaurantId ?? null,
      recipient: input.to,
      templateId: template?.id ?? null,
      eventKey: (input.eventKey ?? "custom") as SmsTemplateEventKey | "custom",
      providerId: null,
      providerType: null,
      body: "",
      status: "failed",
      error: "Empty body — no template found and no body provided",
      retryOf: input.retryOf ?? null,
    }).returning();
    return { ok: false, logId: log.id, status: "failed", error: "Empty body" };
  }

  // Quota check (per-tenant only). Platform-wide sends (no tenantId) skip.
  if (input.tenantId && !input.bypassQuota) {
    const [limit, used] = await Promise.all([
      getTenantMonthlyLimit(input.tenantId),
      getTenantMonthlyUsage(input.tenantId),
    ]);
    if (limit > 0 && used >= limit) {
      const [log] = await db.insert(smsLogsTable).values({
        tenantId: input.tenantId,
        restaurantId: input.restaurantId ?? null,
        recipient: input.to,
        templateId: template?.id ?? null,
        eventKey: (input.eventKey ?? "custom") as SmsTemplateEventKey | "custom",
        providerId: null,
        providerType: null,
        body,
        status: "blocked",
        error: `Monthly SMS quota exhausted (${used}/${limit})`,
        retryOf: input.retryOf ?? null,
      }).returning();
      return { ok: false, logId: log.id, status: "blocked", error: `Quota exhausted (${used}/${limit})` };
    }
  }

  const provider = await getActiveProvider(input.providerId);
  if (!provider) {
    const [log] = await db.insert(smsLogsTable).values({
      tenantId: input.tenantId ?? null,
      restaurantId: input.restaurantId ?? null,
      recipient: input.to,
      templateId: template?.id ?? null,
      eventKey: (input.eventKey ?? "custom") as SmsTemplateEventKey | "custom",
      providerId: null,
      providerType: null,
      body,
      status: "failed",
      error: "No enabled SMS provider configured",
      retryOf: input.retryOf ?? null,
    }).returning();
    return { ok: false, logId: log.id, status: "failed", error: "No provider" };
  }

  try {
    const result = await callProvider(provider, input.to, body, template);
    const [log] = await db.insert(smsLogsTable).values({
      tenantId: input.tenantId ?? null,
      restaurantId: input.restaurantId ?? null,
      recipient: input.to,
      templateId: template?.id ?? null,
      eventKey: (input.eventKey ?? "custom") as SmsTemplateEventKey | "custom",
      providerId: provider.id,
      providerType: provider.type,
      body,
      status: "sent",
      providerMessageId: result.providerMessageId,
      cost: result.cost ?? null,
      costCurrency: result.costCurrency ?? null,
      retryOf: input.retryOf ?? null,
    }).returning();
    // Best-effort low-balance check after every send.
    if (input.tenantId) {
      checkTenantQuotaAlert(input.tenantId).catch(err => logger.warn({ err }, "low-quota check failed"));
    }
    return { ok: true, logId: log.id, status: "sent", providerMessageId: result.providerMessageId };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    logger.warn({ err, providerId: provider.id, providerType: provider.type }, "SMS send failed");
    const [log] = await db.insert(smsLogsTable).values({
      tenantId: input.tenantId ?? null,
      restaurantId: input.restaurantId ?? null,
      recipient: input.to,
      templateId: template?.id ?? null,
      eventKey: (input.eventKey ?? "custom") as SmsTemplateEventKey | "custom",
      providerId: provider.id,
      providerType: provider.type,
      body,
      status: "failed",
      error: message.slice(0, 1000),
      retryOf: input.retryOf ?? null,
    }).returning();
    return { ok: false, logId: log.id, status: "failed", error: message };
  }
}

/** Retry a failed log row by re-sending. */
export async function retryFailedLog(logId: number): Promise<SendResult> {
  const [orig] = await db.select().from(smsLogsTable).where(eq(smsLogsTable.id, logId));
  if (!orig) return { ok: false, logId: 0, status: "failed", error: "Log not found" };
  if (orig.status === "sent" || orig.status === "delivered") {
    return { ok: false, logId, status: orig.status, error: "Already succeeded" };
  }
  return sendSmsMessage({
    to: orig.recipient,
    body: orig.body,
    eventKey: (orig.eventKey ?? undefined) as SmsTemplateEventKey | undefined,
    tenantId: orig.tenantId,
    restaurantId: orig.restaurantId,
    providerId: orig.providerId,
    retryOf: orig.id,
    bypassQuota: false,
  });
}

/**
 * Best-effort low-quota detection per tenant. Reads the
 * platform-wide threshold (percentage) from the existing app settings table,
 * defaulting to 10%. Crossing it creates a notification per restaurant.
 */
import { notificationsTable, restaurantsTable } from "./db";
function getLowQuotaThresholdPct(): number {
  const n = Number(process.env.SMS_LOW_QUOTA_PCT);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export async function checkTenantQuotaAlert(tenantId: number): Promise<void> {
  const limit = await getTenantMonthlyLimit(tenantId);
  if (limit <= 0) return;
  const used = await getTenantMonthlyUsage(tenantId);
  if (used <= 0) return;
  const remaining = limit - used;
  const remainingPct = (remaining / limit) * 100;
  const thresholdPct = await getLowQuotaThresholdPct();
  if (remainingPct > thresholdPct) return;

  // Avoid duplicate alerts within the same month: search recent notifications.
  const monthStart = startOfMonthUtc();
  const restaurants = await db.select({ id: restaurantsTable.id })
    .from(restaurantsTable).where(eq(restaurantsTable.tenantId, tenantId));
  if (restaurants.length === 0) return;
  const [existing] = await db.select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(
      eq(notificationsTable.type, "sms.low_quota"),
      eq(notificationsTable.entityId, tenantId),
      gte(notificationsTable.createdAt, monthStart),
    ))
    .limit(1);
  if (existing) return;

  await db.insert(notificationsTable).values(
    restaurants.map(r => ({
      restaurantId: r.id,
      type: "sms.low_quota",
      title: "SMS quota running low",
      message: `${used}/${limit} SMS used this month — only ${remaining} remaining (${remainingPct.toFixed(0)}% left).`,
      entityId: tenantId,
      entityType: "tenant",
    })),
  ).catch(err => logger.warn({ err }, "Failed to insert low-quota notification"));
}

/**
 * Sweep all tenants and check quota alerts. Called from the scheduler.
 */
export async function sweepQuotaAlerts(): Promise<void> {
  const tenants = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.isActive, true));
  for (const t of tenants) {
    try { await checkTenantQuotaAlert(t.id); }
    catch (err) { logger.warn({ err, tenantId: t.id }, "Quota sweep failed for tenant"); }
  }
}

/**
 * Resolve the tenant's owner phone number for lifecycle SMS hooks.
 */
import { usersTable } from "./db";
export async function getTenantOwnerPhone(tenantId: number): Promise<string | null> {
  const [u] = await db.select({ phone: usersTable.phone })
    .from(usersTable)
    .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.role, "owner"), eq(usersTable.isActive, true)))
    .orderBy(usersTable.id)
    .limit(1);
  return u?.phone ?? null;
}

/**
 * Convenience helper: send a templated lifecycle SMS to a tenant's owner.
 * Silently noops if no phone or no template+provider; never throws.
 */
export async function sendLifecycleSms(opts: {
  tenantId: number;
  eventKey: SmsTemplateEventKey;
  variables?: Record<string, string | number | undefined | null>;
  to?: string | null;
  restaurantId?: number | null;
}): Promise<void> {
  try {
    const to = opts.to ?? await getTenantOwnerPhone(opts.tenantId);
    if (!to) return;
    await sendSmsMessage({
      to,
      eventKey: opts.eventKey,
      variables: opts.variables,
      tenantId: opts.tenantId,
      restaurantId: opts.restaurantId ?? null,
    });
  } catch (err) {
    logger.warn({ err, eventKey: opts.eventKey, tenantId: opts.tenantId }, "Lifecycle SMS failed");
  }
}

/** Most recent log for a tenant (for the restaurant detail page). */
export async function getRecentTenantLogs(tenantId: number, limit = 10) {
  return db.select().from(smsLogsTable)
    .where(eq(smsLogsTable.tenantId, tenantId))
    .orderBy(desc(smsLogsTable.createdAt))
    .limit(limit);
}
