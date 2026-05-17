import nodemailer from "nodemailer";
import { and, eq, sql, or, inArray } from "drizzle-orm";
import {
  db,
  emailProvidersTable,
  emailTemplatesTable,
  emailLogsTable,
  emailSuppressionListTable,
  emailUnsubscribesTable,
  emailMonthlyUsageTable,
  emailRestaurantSettingsTable,
  tenantsTable,
  subscriptionPlansTable,
  type EmailProvider,
  type EmailTemplate,
  type EmailDriver,
  type EmailLog,
} from "./db";
import { logger } from "./logger";
import {
  injectTracking,
  randomTrackingToken,
  unsubscribeUrl as buildUnsubUrl,
} from "./emailTracking";

export type EmailKind = "transactional" | "marketing";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  tenantId?: number | null;
  restaurantId?: number | null;
  templateKey?: string | null;
  templateId?: number | null;
  retryOf?: number | null;
  kind?: EmailKind;
  recipientType?: "user" | "customer" | "lead" | "support";
  campaignId?: number | null;
  automationId?: number | null;
  sequenceId?: number | null;
  sequenceStepId?: number | null;
  enrollmentId?: number | null;
  /** Skip tracking/unsubscribe injection (e.g. provider test sends). */
  noTracking?: boolean;
  /** Already verified consent / opt-in upstream. */
  skipConsentCheck?: boolean;
};

export type SendEmailResult = {
  log: EmailLog;
  ok: boolean;
  error?: string;
  providerMessageId?: string | null;
  skippedReason?: string;
};

export function renderTemplate(text: string, vars: Record<string, unknown>): string {
  return String(text ?? "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = key.split(".").reduce<unknown>((acc, k) => {
      if (acc && typeof acc === "object" && k in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[k];
      }
      return undefined;
    }, vars);
    return v === undefined || v === null ? "" : String(v);
  });
}

export function htmlToText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>(\n)?/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export async function getActiveProvider(): Promise<EmailProvider | null> {
  const enabled = await db.select().from(emailProvidersTable).where(eq(emailProvidersTable.isEnabled, true));
  return enabled.find(p => p.isDefault) ?? enabled[0] ?? null;
}

export async function getProviderById(id: number): Promise<EmailProvider | null> {
  const [row] = await db.select().from(emailProvidersTable).where(eq(emailProvidersTable.id, id));
  return row ?? null;
}

// ─── Suppression / consent checks ───────────────────────────────
function normalizeEmail(e: string): string { return String(e || "").trim().toLowerCase(); }

export async function isSuppressed(email: string, scope: "marketing" | "transactional" | "all" = "all"): Promise<{ suppressed: boolean; reason?: string }> {
  const e = normalizeEmail(email);
  if (!e) return { suppressed: true, reason: "invalid email" };
  const rows = await db.select().from(emailSuppressionListTable).where(eq(emailSuppressionListTable.email, e));
  const hit = rows.find(r => r.scope === "all" || r.scope === scope);
  if (hit) return { suppressed: true, reason: `${hit.reason} (${hit.scope})` };
  return { suppressed: false };
}

export async function isUnsubscribed(email: string, restaurantId?: number | null): Promise<boolean> {
  const e = normalizeEmail(email);
  if (!e) return true;
  const rows = await db.select().from(emailUnsubscribesTable).where(eq(emailUnsubscribesTable.email, e));
  return rows.some(r => r.scope === "all" || (restaurantId != null && r.restaurantId === restaurantId));
}

// ─── Plan-limit enforcement ─────────────────────────────────────
function periodKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type PlanEmailLimits = {
  emailMonthlyLimit: number;
  emailMarketingMonthlyLimit: number;
  emailActiveSequencesLimit: number;
  emailCustomTemplatesLimit: number;
};

export async function getTenantEmailLimits(tenantId: number): Promise<PlanEmailLimits | null> {
  const [t] = await db.select({ planId: tenantsTable.planId }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!t?.planId) return null;
  const [p] = await db.select({
    emailMonthlyLimit: subscriptionPlansTable.emailMonthlyLimit,
    emailMarketingMonthlyLimit: subscriptionPlansTable.emailMarketingMonthlyLimit,
    emailActiveSequencesLimit: subscriptionPlansTable.emailActiveSequencesLimit,
    emailCustomTemplatesLimit: subscriptionPlansTable.emailCustomTemplatesLimit,
  }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, t.planId));
  return p ?? null;
}

export async function getMonthlyUsage(tenantId: number): Promise<{ transactional: number; marketing: number; period: string }> {
  const period = periodKey();
  const [row] = await db.select().from(emailMonthlyUsageTable)
    .where(and(eq(emailMonthlyUsageTable.tenantId, tenantId), eq(emailMonthlyUsageTable.periodKey, period)));
  return { transactional: row?.transactionalCount ?? 0, marketing: row?.marketingCount ?? 0, period };
}

async function incrementUsage(tenantId: number, kind: EmailKind): Promise<void> {
  const period = periodKey();
  const col = kind === "marketing" ? emailMonthlyUsageTable.marketingCount : emailMonthlyUsageTable.transactionalCount;
  // Upsert: insert with 1 or increment existing.
  const existing = await db.select().from(emailMonthlyUsageTable)
    .where(and(eq(emailMonthlyUsageTable.tenantId, tenantId), eq(emailMonthlyUsageTable.periodKey, period)));
  if (existing.length === 0) {
    await db.insert(emailMonthlyUsageTable).values({
      tenantId, periodKey: period,
      transactionalCount: kind === "transactional" ? 1 : 0,
      marketingCount: kind === "marketing" ? 1 : 0,
    }).onConflictDoNothing();
    return;
  }
  await db.update(emailMonthlyUsageTable)
    .set({ ...(kind === "marketing" ? { marketingCount: sql`${col} + 1` } : { transactionalCount: sql`${col} + 1` }), updatedAt: new Date() })
    .where(and(eq(emailMonthlyUsageTable.tenantId, tenantId), eq(emailMonthlyUsageTable.periodKey, period)));
}

export async function checkPlanLimitAllows(tenantId: number | null | undefined, kind: EmailKind): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!tenantId) return { ok: true };
  const limits = await getTenantEmailLimits(tenantId);
  if (!limits) return { ok: true };
  const usage = await getMonthlyUsage(tenantId);
  if (kind === "marketing") {
    const cap = limits.emailMarketingMonthlyLimit ?? 0;
    if (cap > 0 && usage.marketing >= cap) return { ok: false, reason: `Marketing email cap reached (${usage.marketing}/${cap})` };
    if (cap === 0 && limits.emailMonthlyLimit > 0 && (usage.transactional + usage.marketing) >= limits.emailMonthlyLimit) {
      return { ok: false, reason: `Monthly email cap reached (${usage.transactional + usage.marketing}/${limits.emailMonthlyLimit})` };
    }
  } else {
    const cap = limits.emailMonthlyLimit ?? 0;
    if (cap > 0 && (usage.transactional + usage.marketing) >= cap) return { ok: false, reason: `Monthly email cap reached (${usage.transactional + usage.marketing}/${cap})` };
  }
  return { ok: true };
}

// ─── Driver implementations ─────────────────────────────────────
type DriverSendResult = { providerMessageId: string | null };

async function sendViaSmtp(provider: EmailProvider, opts: SendEmailInput): Promise<DriverSendResult> {
  const cfg = provider.config as { host?: string; port?: number; username?: string; password?: string; encryption?: "tls" | "ssl" | "none" };
  const port = Number(cfg.port ?? 587);
  const transporter = nodemailer.createTransport({
    host: cfg.host, port,
    secure: cfg.encryption === "ssl" || port === 465,
    auth: cfg.username ? { user: cfg.username, pass: cfg.password ?? "" } : undefined,
    requireTLS: cfg.encryption === "tls",
  });
  const info = await transporter.sendMail({
    from: provider.fromName ? `"${provider.fromName}" <${provider.fromEmail}>` : provider.fromEmail,
    to: opts.to, replyTo: provider.replyTo ?? undefined,
    subject: opts.subject, html: opts.html, text: opts.text ?? htmlToText(opts.html),
  });
  return { providerMessageId: info?.messageId ?? null };
}

async function sendViaSendGrid(provider: EmailProvider, opts: SendEmailInput): Promise<DriverSendResult> {
  const cfg = provider.config as { apiKey?: string };
  if (!cfg.apiKey) throw new Error("SendGrid API key is missing");
  const body = {
    personalizations: [{ to: [{ email: opts.to }] }],
    from: { email: provider.fromEmail, name: provider.fromName || undefined },
    reply_to: provider.replyTo ? { email: provider.replyTo } : undefined,
    subject: opts.subject,
    content: [
      { type: "text/plain", value: opts.text ?? htmlToText(opts.html) },
      { type: "text/html", value: opts.html },
    ],
  };
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${await res.text()}`);
  return { providerMessageId: res.headers.get("x-message-id") };
}

async function sendViaMailgun(provider: EmailProvider, opts: SendEmailInput): Promise<DriverSendResult> {
  const cfg = provider.config as { apiKey?: string; domain?: string; region?: "us" | "eu" };
  if (!cfg.apiKey || !cfg.domain) throw new Error("Mailgun apiKey and domain are required");
  const base = cfg.region === "eu" ? "https://api.eu.mailgun.net/v3" : "https://api.mailgun.net/v3";
  const form = new URLSearchParams();
  form.set("from", provider.fromName ? `${provider.fromName} <${provider.fromEmail}>` : provider.fromEmail);
  form.set("to", opts.to);
  if (provider.replyTo) form.set("h:Reply-To", provider.replyTo);
  form.set("subject", opts.subject);
  form.set("html", opts.html);
  form.set("text", opts.text ?? htmlToText(opts.html));
  const res = await fetch(`${base}/${encodeURIComponent(cfg.domain)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`api:${cfg.apiKey}`).toString("base64")}` },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`Mailgun ${res.status}: ${await res.text()}`);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { providerMessageId: typeof json.id === "string" ? json.id : null };
}

import { createHmac, createHash } from "crypto";

function sesSign(key: Buffer, msg: string): Buffer { return createHmac("sha256", key).update(msg, "utf8").digest(); }

async function sendViaSes(provider: EmailProvider, opts: SendEmailInput): Promise<DriverSendResult> {
  const cfg = provider.config as { accessKey?: string; secretKey?: string; region?: string };
  const accessKey = cfg.accessKey; const secretKey = cfg.secretKey; const region = cfg.region || "us-east-1";
  if (!accessKey || !secretKey) throw new Error("AWS access key and secret key are required");
  const host = `email.${region}.amazonaws.com`;
  const url = `https://${host}/`;
  const params = new URLSearchParams();
  params.set("Action", "SendEmail");
  params.set("Source", provider.fromName ? `${provider.fromName} <${provider.fromEmail}>` : provider.fromEmail);
  params.set("Destination.ToAddresses.member.1", opts.to);
  if (provider.replyTo) params.set("ReplyToAddresses.member.1", provider.replyTo);
  params.set("Message.Subject.Data", opts.subject);
  params.set("Message.Body.Html.Data", opts.html);
  params.set("Message.Body.Text.Data", opts.text ?? htmlToText(opts.html));
  const payload = params.toString();
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(payload).digest("hex");
  const canonicalHeaders = `content-type:application/x-www-form-urlencoded\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-date";
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const credentialScope = `${dateStamp}/${region}/ses/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${createHash("sha256").update(canonicalRequest).digest("hex")}`;
  const kDate = sesSign(Buffer.from(`AWS4${secretKey}`, "utf8"), dateStamp);
  const kRegion = sesSign(kDate, region);
  const kService = sesSign(kRegion, "ses");
  const kSigning = sesSign(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Amz-Date": amzDate, Authorization: authorization, Host: host },
    body: payload,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SES ${res.status}: ${text}`);
  const m = /<MessageId>([^<]+)<\/MessageId>/.exec(text);
  return { providerMessageId: m ? m[1] : null };
}

async function sendViaResend(provider: EmailProvider, opts: SendEmailInput): Promise<DriverSendResult> {
  const cfg = provider.config as { apiKey?: string };
  if (!cfg.apiKey) throw new Error("Resend API key is missing");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      from: provider.fromName ? `${provider.fromName} <${provider.fromEmail}>` : provider.fromEmail,
      to: [opts.to], reply_to: provider.replyTo ?? undefined,
      subject: opts.subject, html: opts.html, text: opts.text ?? htmlToText(opts.html),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { providerMessageId: typeof json.id === "string" ? json.id : null };
}

async function sendViaPostmark(provider: EmailProvider, opts: SendEmailInput): Promise<DriverSendResult> {
  const cfg = provider.config as { serverToken?: string };
  if (!cfg.serverToken) throw new Error("Postmark serverToken is missing");
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Postmark-Server-Token": cfg.serverToken },
    body: JSON.stringify({
      From: provider.fromName ? `${provider.fromName} <${provider.fromEmail}>` : provider.fromEmail,
      To: opts.to, ReplyTo: provider.replyTo ?? undefined,
      Subject: opts.subject, HtmlBody: opts.html, TextBody: opts.text ?? htmlToText(opts.html),
      MessageStream: "outbound",
    }),
  });
  if (!res.ok) throw new Error(`Postmark ${res.status}: ${await res.text()}`);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { providerMessageId: typeof json.MessageID === "string" ? json.MessageID : null };
}

async function sendViaCustom(provider: EmailProvider, opts: SendEmailInput): Promise<DriverSendResult> {
  const cfg = provider.config as { baseUrl?: string; authHeader?: string; bodyTemplate?: string };
  if (!cfg.baseUrl) throw new Error("Custom provider baseUrl is required");
  const vars = {
    to: opts.to, subject: opts.subject, html: opts.html, text: opts.text ?? htmlToText(opts.html),
    fromName: provider.fromName, fromEmail: provider.fromEmail, replyTo: provider.replyTo ?? "",
  };
  let bodyStr: string;
  if (cfg.bodyTemplate && cfg.bodyTemplate.trim().length > 0) {
    bodyStr = renderTemplate(cfg.bodyTemplate, vars as unknown as Record<string, unknown>);
  } else {
    bodyStr = JSON.stringify(vars);
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.authHeader) {
    const idx = cfg.authHeader.indexOf(":");
    if (idx > 0) headers[cfg.authHeader.slice(0, idx).trim()] = cfg.authHeader.slice(idx + 1).trim();
    else headers["Authorization"] = cfg.authHeader;
  }
  const res = await fetch(cfg.baseUrl, { method: "POST", headers, body: bodyStr });
  if (!res.ok) throw new Error(`Custom provider ${res.status}: ${await res.text()}`);
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof out.id === "string" ? out.id : typeof out.messageId === "string" ? out.messageId : null;
  return { providerMessageId: id };
}

async function sendWithDriver(provider: EmailProvider, opts: SendEmailInput): Promise<DriverSendResult> {
  switch (provider.driver) {
    case "smtp":     return sendViaSmtp(provider, opts);
    case "sendgrid": return sendViaSendGrid(provider, opts);
    case "mailgun":  return sendViaMailgun(provider, opts);
    case "ses":      return sendViaSes(provider, opts);
    case "resend":   return sendViaResend(provider, opts);
    case "postmark": return sendViaPostmark(provider, opts);
    case "custom":   return sendViaCustom(provider, opts);
  }
}

// ─── Public entrypoints ─────────────────────────────────────────

/** Send an email via a specific provider (used for "test send"). Always logs. */
export async function sendEmailViaProvider(
  provider: EmailProvider,
  opts: SendEmailInput,
): Promise<SendEmailResult> {
  const kind: EmailKind = opts.kind ?? "transactional";
  const trackingToken = opts.noTracking ? null : randomTrackingToken();
  // Pre-flight checks (consent, suppression, plan limit)
  if (!opts.skipConsentCheck) {
    const sup = await isSuppressed(opts.to, kind);
    if (sup.suppressed) {
      const [log] = await db.insert(emailLogsTable).values({
        tenantId: opts.tenantId ?? null, restaurantId: opts.restaurantId ?? null,
        recipient: opts.to, recipientType: opts.recipientType ?? "user",
        templateKey: opts.templateKey ?? null, templateId: opts.templateId ?? null,
        providerId: provider.id, providerDriver: provider.driver,
        subject: opts.subject, status: "failed", error: `suppressed: ${sup.reason ?? "unknown"}`,
        campaignId: opts.campaignId ?? null, automationId: opts.automationId ?? null,
        sequenceId: opts.sequenceId ?? null, sequenceStepId: opts.sequenceStepId ?? null,
        enrollmentId: opts.enrollmentId ?? null,
      }).returning();
      return { log, ok: false, error: sup.reason, skippedReason: "suppressed" };
    }
    if (kind === "marketing") {
      // Restaurant-level marketing kill-switch (Email Center settings).
      if (opts.restaurantId) {
        const settings = await getRestaurantEmailSettings(opts.restaurantId);
        if (!settings.marketingEnabled) {
          const [log] = await db.insert(emailLogsTable).values({
            tenantId: opts.tenantId ?? null, restaurantId: opts.restaurantId ?? null,
            recipient: opts.to, recipientType: opts.recipientType ?? "customer",
            templateKey: opts.templateKey ?? null, templateId: opts.templateId ?? null,
            providerId: provider.id, providerDriver: provider.driver,
            subject: opts.subject, status: "failed", error: "marketing disabled for restaurant",
            campaignId: opts.campaignId ?? null, automationId: opts.automationId ?? null,
          }).returning();
          return { log, ok: false, error: "Marketing emails disabled for this restaurant", skippedReason: "marketing_disabled" };
        }
      }
      // Central opt-in check: if a customer record exists for this email
      // under this restaurant, the customer must be opted-in and not
      // unsubscribed. Applies to every marketing send path (campaigns,
      // automations, templated marketing) — not just campaign recipient
      // selection.
      if (opts.restaurantId && !opts.skipConsentCheck) {
        const { customersTable } = await import("./db");
        const [cust] = await db.select({
          id: customersTable.id,
          optIn: customersTable.emailMarketingOptIn,
          unsubscribed: customersTable.emailUnsubscribed,
        }).from(customersTable).where(and(
          eq(customersTable.restaurantId, opts.restaurantId),
          eq(customersTable.email, opts.to.trim().toLowerCase()),
        )).limit(1);
        // Strict opt-in: marketing requires a customer record with positive
        // emailMarketingOptIn=true and not unsubscribed. Missing record =>
        // no consent on file => deny.
        if (!cust || !cust.optIn || cust.unsubscribed) {
          const [log] = await db.insert(emailLogsTable).values({
            tenantId: opts.tenantId ?? null, restaurantId: opts.restaurantId ?? null,
            recipient: opts.to, recipientType: opts.recipientType ?? "customer",
            templateKey: opts.templateKey ?? null, templateId: opts.templateId ?? null,
            providerId: provider.id, providerDriver: provider.driver,
            subject: opts.subject, status: "failed",
            error: cust ? "recipient not opted-in" : "no consent on file",
            campaignId: opts.campaignId ?? null, automationId: opts.automationId ?? null,
          }).returning();
          return { log, ok: false, error: "Customer is not opted-in to marketing emails", skippedReason: "no_consent" };
        }
      }
      const unsub = await isUnsubscribed(opts.to, opts.restaurantId ?? null);
      if (unsub) {
        const [log] = await db.insert(emailLogsTable).values({
          tenantId: opts.tenantId ?? null, restaurantId: opts.restaurantId ?? null,
          recipient: opts.to, recipientType: opts.recipientType ?? "customer",
          templateKey: opts.templateKey ?? null, templateId: opts.templateId ?? null,
          providerId: provider.id, providerDriver: provider.driver,
          subject: opts.subject, status: "failed", error: "recipient unsubscribed",
          campaignId: opts.campaignId ?? null, automationId: opts.automationId ?? null,
        }).returning();
        return { log, ok: false, error: "unsubscribed", skippedReason: "unsubscribed" };
      }
    }
  }

  // Centralized plan-feature gate: every marketing send (manual,
  // scheduled-campaign, automation, sequence, templated marketing)
  // must come from a tenant whose plan includes the `email_marketing`
  // feature. Tenants without a plan (trial) are allowed; super-admin
  // sends with no tenant context are also allowed.
  if (kind === "marketing" && opts.tenantId) {
    try {
      const { tenantsTable, subscriptionPlansTable, isFeatureEnabled } = await import("./db");
      const [tenant] = await db.select({ planId: tenantsTable.planId })
        .from(tenantsTable).where(eq(tenantsTable.id, opts.tenantId));
      if (tenant?.planId) {
        const [plan] = await db.select({ featureFlags: subscriptionPlansTable.featureFlags })
          .from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, tenant.planId));
        if (plan && !isFeatureEnabled(plan.featureFlags, "email_marketing")) {
          const [log] = await db.insert(emailLogsTable).values({
            tenantId: opts.tenantId ?? null, restaurantId: opts.restaurantId ?? null,
            recipient: opts.to, recipientType: opts.recipientType ?? "customer",
            templateKey: opts.templateKey ?? null, templateId: opts.templateId ?? null,
            providerId: provider.id, providerDriver: provider.driver,
            subject: opts.subject, status: "failed", error: "plan_feature: email_marketing not included",
            campaignId: opts.campaignId ?? null, automationId: opts.automationId ?? null,
          }).returning();
          return { log, ok: false, error: "Marketing email is not included in your plan", skippedReason: "plan_feature" };
        }
      }
    } catch (err) {
      logger.warn({ err }, "marketing plan-feature gate lookup failed (allowing send)");
    }
  }

  const limitCheck = await checkPlanLimitAllows(opts.tenantId ?? null, kind);
  if (!limitCheck.ok) {
    const [log] = await db.insert(emailLogsTable).values({
      tenantId: opts.tenantId ?? null, restaurantId: opts.restaurantId ?? null,
      recipient: opts.to, recipientType: opts.recipientType ?? "user",
      templateKey: opts.templateKey ?? null, templateId: opts.templateId ?? null,
      providerId: provider.id, providerDriver: provider.driver,
      subject: opts.subject, status: "failed", error: `plan_limit: ${limitCheck.reason}`,
      campaignId: opts.campaignId ?? null, automationId: opts.automationId ?? null,
    }).returning();
    return { log, ok: false, error: limitCheck.reason, skippedReason: "plan_limit" };
  }

  if (!provider.isEnabled) {
    const [log] = await db.insert(emailLogsTable).values({
      tenantId: opts.tenantId ?? null, restaurantId: opts.restaurantId ?? null,
      recipient: opts.to, recipientType: opts.recipientType ?? "user",
      templateKey: opts.templateKey ?? null, templateId: opts.templateId ?? null,
      providerId: provider.id, providerDriver: provider.driver,
      subject: opts.subject, status: "failed", error: "Provider is disabled",
      retryOf: opts.retryOf ?? null,
      campaignId: opts.campaignId ?? null, automationId: opts.automationId ?? null,
    }).returning();
    return { log, ok: false, error: "Provider is disabled" };
  }
  // Inject open pixel + click rewriting (and unsubscribe link for marketing).
  let htmlToSend = opts.html;
  if (trackingToken) {
    const unsubLink = kind === "marketing"
      ? buildUnsubUrl(opts.to, opts.restaurantId ?? null, opts.restaurantId ? "restaurant" : "all")
      : undefined;
    let businessAddress: string | null = null;
    let consentReason: string | null = null;
    if (kind === "marketing" && opts.restaurantId) {
      try {
        const s = await getRestaurantEmailSettings(opts.restaurantId);
        businessAddress = (s.businessAddress || "").trim() || null;
        consentReason = "You're receiving this because you opted in to marketing communications from this restaurant.";
      } catch { /* non-fatal */ }
    }
    htmlToSend = injectTracking(opts.html, trackingToken, {
      unsubscribeUrl: unsubLink,
      businessAddress,
      consentReason,
    });
  }
  const sendOpts: SendEmailInput = { ...opts, html: htmlToSend };
  try {
    const out = await sendWithDriver(provider, sendOpts);
    const [log] = await db.insert(emailLogsTable).values({
      tenantId: opts.tenantId ?? null, restaurantId: opts.restaurantId ?? null,
      recipient: opts.to, recipientType: opts.recipientType ?? "user",
      templateKey: opts.templateKey ?? null, templateId: opts.templateId ?? null,
      providerId: provider.id, providerDriver: provider.driver,
      subject: opts.subject, htmlSnapshot: htmlToSend.slice(0, 200_000),
      status: "sent", providerMessageId: out.providerMessageId, trackingToken,
      retryOf: opts.retryOf ?? null,
      campaignId: opts.campaignId ?? null, automationId: opts.automationId ?? null,
      sequenceId: opts.sequenceId ?? null, sequenceStepId: opts.sequenceStepId ?? null,
      enrollmentId: opts.enrollmentId ?? null,
      sentAt: new Date(),
    }).returning();
    if (opts.tenantId) await incrementUsage(opts.tenantId, kind).catch(() => {});
    return { log, ok: true, providerMessageId: out.providerMessageId };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    logger.warn({ err, to: opts.to, providerId: provider.id }, "Email send failed");
    const [log] = await db.insert(emailLogsTable).values({
      tenantId: opts.tenantId ?? null, restaurantId: opts.restaurantId ?? null,
      recipient: opts.to, recipientType: opts.recipientType ?? "user",
      templateKey: opts.templateKey ?? null, templateId: opts.templateId ?? null,
      providerId: provider.id, providerDriver: provider.driver,
      subject: opts.subject, status: "failed", error: msg.slice(0, 4000),
      retryOf: opts.retryOf ?? null,
      campaignId: opts.campaignId ?? null, automationId: opts.automationId ?? null,
      sequenceId: opts.sequenceId ?? null, sequenceStepId: opts.sequenceStepId ?? null,
      enrollmentId: opts.enrollmentId ?? null,
    }).returning();
    return { log, ok: false, error: msg };
  }
}

export async function sendEmail(opts: SendEmailInput): Promise<SendEmailResult | null> {
  const provider = await getActiveProvider();
  if (!provider) {
    logger.info({ to: opts.to, subject: opts.subject }, "No email provider configured — email not sent");
    const [log] = await db.insert(emailLogsTable).values({
      tenantId: opts.tenantId ?? null, restaurantId: opts.restaurantId ?? null,
      recipient: opts.to, recipientType: opts.recipientType ?? "user",
      templateKey: opts.templateKey ?? null, templateId: opts.templateId ?? null,
      providerId: null, providerDriver: null,
      subject: opts.subject, status: "failed", error: "No active email provider configured",
      retryOf: opts.retryOf ?? null,
      campaignId: opts.campaignId ?? null, automationId: opts.automationId ?? null,
    }).returning();
    return { log, ok: false, error: "No active email provider configured" };
  }
  return sendEmailViaProvider(provider, opts);
}

export async function sendByTemplateKey(
  key: string,
  to: string,
  vars: Record<string, unknown>,
  opts: {
    tenantId?: number | null; restaurantId?: number | null;
    subjectOverride?: string; kind?: EmailKind;
    recipientType?: SendEmailInput["recipientType"];
    campaignId?: number | null; automationId?: number | null;
    sequenceId?: number | null; sequenceStepId?: number | null;
    enrollmentId?: number | null;
  } = {},
): Promise<SendEmailResult | null> {
  try {
    const [tpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.key, key));
    if (!tpl || !tpl.isEnabled) {
      logger.info({ key }, "Email template missing or disabled — skipping send");
      return null;
    }
    const subject = renderTemplate(opts.subjectOverride ?? tpl.subject, vars);
    const html = renderTemplate(tpl.body, vars);
    const kind: EmailKind = opts.kind ?? (tpl.category === "marketing" ? "marketing" : "transactional");
    return await sendEmail({
      to, subject, html, text: htmlToText(html),
      tenantId: opts.tenantId ?? null, restaurantId: opts.restaurantId ?? null,
      templateKey: key, templateId: tpl.id, kind, recipientType: opts.recipientType,
      campaignId: opts.campaignId ?? null, automationId: opts.automationId ?? null,
      sequenceId: opts.sequenceId ?? null, sequenceStepId: opts.sequenceStepId ?? null,
      enrollmentId: opts.enrollmentId ?? null,
    });
  } catch (err) {
    logger.error({ err, key, to }, "sendByTemplateKey failed");
    return null;
  }
}

export const DEFAULT_TEMPLATES: Array<{
  key: string; name: string; event: string; subject: string; body: string; variables: string[]; category?: "transactional" | "lifecycle" | "marketing";
}> = [
  { key: "welcome", name: "Welcome email", event: "user.signup",
    subject: "Welcome to {{appName}}, {{name}}!",
    body: `<p>Hi {{name}},</p><p>Welcome to <strong>{{appName}}</strong> — your restaurant <strong>{{restaurant}}</strong> is set up and ready.</p><p>You can sign in any time at <a href="{{appUrl}}">{{appUrl}}</a>.</p><p>— The {{appName}} team</p>`,
    variables: ["name", "restaurant", "appName", "appUrl"], category: "transactional" },
  { key: "trial_started", name: "Trial started", event: "subscription.trial_started",
    subject: "Your {{appName}} free trial has started",
    body: `<p>Hi {{name}},</p><p>Your {{trialDays}}-day free trial of {{appName}} is now active. It ends on <strong>{{trialEndsAt}}</strong>.</p>`,
    variables: ["name", "trialDays", "trialEndsAt", "appName"], category: "lifecycle" },
  { key: "trial_ending", name: "Trial ending soon", event: "subscription.trial_ending",
    subject: "Your {{appName}} trial ends in {{daysLeft}} days",
    body: `<p>Hi {{name}},</p><p>Your free trial ends on <strong>{{trialEndsAt}}</strong>. Upgrade to keep your data and continue using {{appName}}.</p><p><a href="{{upgradeUrl}}">Choose a plan</a></p>`,
    variables: ["name", "daysLeft", "trialEndsAt", "appName", "upgradeUrl"], category: "lifecycle" },
  { key: "subscription_activated", name: "Subscription activated", event: "subscription.activated",
    subject: "Your {{plan}} plan is active",
    body: `<p>Hi {{name}},</p><p>Your subscription to the <strong>{{plan}}</strong> plan is now active. Your next renewal is on <strong>{{renewsAt}}</strong>.</p>`,
    variables: ["name", "plan", "renewsAt", "appName"], category: "transactional" },
  { key: "subscription_expired", name: "Subscription expired", event: "subscription.expired",
    subject: "Your {{appName}} subscription has expired",
    body: `<p>Hi {{name}},</p><p>Your subscription to the <strong>{{plan}}</strong> plan expired on <strong>{{expiredAt}}</strong>. Renew to restore access.</p><p><a href="{{upgradeUrl}}">Renew now</a></p>`,
    variables: ["name", "plan", "expiredAt", "upgradeUrl", "appName"], category: "lifecycle" },
  { key: "package_upgraded", name: "Package upgraded", event: "subscription.upgraded",
    subject: "You upgraded to {{plan}}",
    body: `<p>Hi {{name}},</p><p>Your plan has been upgraded from <strong>{{oldPlan}}</strong> to <strong>{{plan}}</strong>. New limits and features are available immediately.</p>`,
    variables: ["name", "oldPlan", "plan"], category: "transactional" },
  { key: "package_downgraded", name: "Package downgraded", event: "subscription.downgraded",
    subject: "Your plan was changed to {{plan}}",
    body: `<p>Hi {{name}},</p><p>Your plan has been changed from <strong>{{oldPlan}}</strong> to <strong>{{plan}}</strong>. Some limits may have decreased.</p>`,
    variables: ["name", "oldPlan", "plan"], category: "transactional" },
  { key: "payment_successful", name: "Payment successful", event: "billing.payment_succeeded",
    subject: "Payment received — {{currency}} {{amount}}",
    body: `<p>Hi {{name}},</p><p>We received your payment of <strong>{{currency}} {{amount}}</strong> for the <strong>{{plan}}</strong> plan.</p>`,
    variables: ["name", "currency", "amount", "plan", "invoiceUrl"], category: "transactional" },
  { key: "payment_failed", name: "Payment failed", event: "billing.payment_failed",
    subject: "Payment failed — action required",
    body: `<p>Hi {{name}},</p><p>Your payment of <strong>{{currency}} {{amount}}</strong> for the <strong>{{plan}}</strong> plan failed. Please update your payment method to avoid service interruption.</p><p>Reason: {{reason}}</p>`,
    variables: ["name", "currency", "amount", "plan", "reason"], category: "transactional" },
  { key: "invoice_generated", name: "Invoice generated", event: "billing.invoice_generated",
    subject: "Your invoice {{invoiceNumber}} is ready",
    body: `<p>Hi {{name}},</p><p>Your invoice <strong>{{invoiceNumber}}</strong> for {{currency}} {{amount}} is available.</p><p><a href="{{invoiceUrl}}">View invoice</a></p>`,
    variables: ["name", "invoiceNumber", "currency", "amount", "invoiceUrl"], category: "transactional" },
  { key: "password_reset", name: "Password reset", event: "auth.password_reset",
    subject: "Reset your {{appName}} password",
    body: `<p>Hi {{name}},</p><p>We received a request to reset your password. Click below to set a new one — the link expires in 1 hour.</p><p><a href="{{resetLink}}">Reset password</a></p>`,
    variables: ["name", "resetLink", "appName"], category: "transactional" },
  { key: "support_ticket_created", name: "Support ticket created", event: "support.ticket_created",
    subject: "Support ticket #{{ticketId}} received",
    body: `<p>Hi {{name}},</p><p>We received your support request <strong>#{{ticketId}}</strong>: <em>{{subjectLine}}</em>. Our team will get back to you shortly.</p>`,
    variables: ["name", "ticketId", "subjectLine"], category: "transactional" },
  { key: "support_ticket_replied", name: "Support ticket replied", event: "support.ticket_replied",
    subject: "Re: Support ticket #{{ticketId}}",
    body: `<p>Hi {{name}},</p><p>You have a new reply on ticket <strong>#{{ticketId}}</strong>:</p><blockquote>{{reply}}</blockquote><p><a href="{{ticketUrl}}">View ticket</a></p>`,
    variables: ["name", "ticketId", "reply", "ticketUrl"], category: "transactional" },
  { key: "restaurant_suspended", name: "Restaurant suspended", event: "tenant.suspended",
    subject: "Your account on {{appName}} has been suspended",
    body: `<p>Hi {{name}},</p><p>Your restaurant <strong>{{restaurant}}</strong> has been suspended on {{appName}}. Reason: {{reason}}</p>`,
    variables: ["name", "restaurant", "reason", "appName"], category: "transactional" },
  { key: "feature_announcement", name: "New feature announcement", event: "platform.announcement",
    subject: "{{title}}",
    body: `<p>Hi {{name}},</p><p>{{body}}</p><p>— The {{appName}} team</p>`,
    variables: ["name", "title", "body", "appName"], category: "lifecycle" },
  // ─── Task #414: Lifecycle / follow-up additions ────────────────
  { key: "demo_thank_you", name: "Demo thank-you", event: "lead.demo_requested",
    subject: "Thanks for booking a demo with {{appName}}",
    body: `<p>Hi {{name}},</p><p>Thanks for booking a demo! We've blocked the slot and will reach out shortly with a calendar invite.</p>`,
    variables: ["name", "appName"], category: "lifecycle" },
  { key: "demo_no_show", name: "Demo no-show", event: "lead.demo_no_show",
    subject: "Sorry we missed you — rebook your {{appName}} demo",
    body: `<p>Hi {{name}},</p><p>We missed you for the scheduled demo. <a href="{{rebookUrl}}">Pick a new slot</a> any time.</p>`,
    variables: ["name", "rebookUrl"], category: "lifecycle" },
  { key: "demo_followup_3day", name: "Demo follow-up (3 days)", event: "lead.demo_followup",
    subject: "Quick follow-up on your {{appName}} demo",
    body: `<p>Hi {{name}},</p><p>Just checking in after your demo — happy to answer any pricing questions or set up a sandbox.</p>`,
    variables: ["name", "appName"], category: "lifecycle" },
  { key: "inactive_restaurant", name: "Inactive restaurant nudge", event: "tenant.inactive",
    subject: "We miss you at {{appName}}",
    body: `<p>Hi {{name}},</p><p>Your restaurant hasn't taken an order in {{daysInactive}} days. Need help? Reply to this email — we're here.</p>`,
    variables: ["name", "daysInactive"], category: "lifecycle" },
  { key: "customer_birthday", name: "Customer birthday", event: "customer.birthday",
    subject: "Happy birthday from {{restaurant}}!",
    body: `<p>Hi {{name}},</p><p>Happy birthday from all of us at <strong>{{restaurant}}</strong>! Enjoy <strong>{{offer}}</strong> on us — show this email when you visit.</p>`,
    variables: ["name", "restaurant", "offer"], category: "marketing" },
  { key: "customer_anniversary", name: "Customer anniversary", event: "customer.anniversary",
    subject: "It's been a year, {{name}} 🎉",
    body: `<p>Thanks for being a {{restaurant}} regular for a whole year! Here's a little something on us: <strong>{{offer}}</strong>.</p>`,
    variables: ["name", "restaurant", "offer"], category: "marketing" },
  { key: "customer_win_back", name: "Customer win-back", event: "customer.inactive",
    subject: "We've missed you at {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>It's been a while since your last visit. Come back this week and enjoy <strong>{{offer}}</strong>.</p>`,
    variables: ["name", "restaurant", "offer"], category: "marketing" },
  { key: "customer_review_request", name: "Review request", event: "customer.order_completed",
    subject: "How was your meal at {{restaurant}}?",
    body: `<p>Hi {{name}},</p><p>Thanks for ordering with us! Would you mind leaving a quick review? <a href="{{reviewUrl}}">Leave a review</a>.</p>`,
    variables: ["name", "restaurant", "reviewUrl"], category: "lifecycle" },
  // ─── Task #414: Required transactional key expansion (30+ keys total) ───
  { key: "email_verification", name: "Email verification", event: "auth.email_verification",
    subject: "Verify your email for {{appName}}",
    body: `<p>Hi {{name}},</p><p>Please verify your email by clicking the link below. The link expires in 24 hours.</p><p><a href="{{verifyUrl}}">Verify email</a></p>`,
    variables: ["name", "verifyUrl", "appName"], category: "transactional" },
  { key: "super_admin_created_account", name: "Account created by admin", event: "tenant.admin_created",
    subject: "Your {{appName}} account is ready",
    body: `<p>Hi {{name}},</p><p>An administrator created an account for <strong>{{restaurant}}</strong> on {{appName}}. Sign in with your email and the temporary password <code>{{tempPassword}}</code>, then change it from your profile.</p><p><a href="{{appUrl}}">Sign in</a></p>`,
    variables: ["name", "restaurant", "tempPassword", "appUrl", "appName"], category: "transactional" },
  { key: "trial_expired", name: "Trial expired", event: "subscription.trial_expired",
    subject: "Your {{appName}} trial has expired",
    body: `<p>Hi {{name}},</p><p>Your free trial ended on <strong>{{trialEndedAt}}</strong>. Upgrade now to keep using {{appName}} without interruption.</p><p><a href="{{upgradeUrl}}">Choose a plan</a></p>`,
    variables: ["name", "trialEndedAt", "upgradeUrl", "appName"], category: "lifecycle" },
  { key: "plan_renewed", name: "Plan renewed", event: "subscription.renewed",
    subject: "Your {{plan}} plan was renewed",
    body: `<p>Hi {{name}},</p><p>Your <strong>{{plan}}</strong> plan was renewed for {{currency}} {{amount}}. Next renewal: <strong>{{renewsAt}}</strong>.</p>`,
    variables: ["name", "plan", "currency", "amount", "renewsAt"], category: "transactional" },
  { key: "plan_cancelled", name: "Plan cancelled", event: "subscription.cancelled",
    subject: "Your {{appName}} subscription was cancelled",
    body: `<p>Hi {{name}},</p><p>Your subscription to <strong>{{plan}}</strong> has been cancelled. You'll have access until <strong>{{accessUntil}}</strong>.</p>`,
    variables: ["name", "plan", "accessUntil", "appName"], category: "transactional" },
  { key: "payment_refunded", name: "Payment refunded", event: "billing.payment_refunded",
    subject: "Refund processed — {{currency}} {{amount}}",
    body: `<p>Hi {{name}},</p><p>A refund of <strong>{{currency}} {{amount}}</strong> has been processed to your original payment method. It may take 5–10 business days to reflect.</p>`,
    variables: ["name", "currency", "amount", "invoiceUrl"], category: "transactional" },
  { key: "payment_method_updated", name: "Payment method updated", event: "billing.payment_method_updated",
    subject: "Your payment method was updated",
    body: `<p>Hi {{name}},</p><p>Your payment method on file was updated to <strong>{{methodSummary}}</strong>. If this wasn't you, please contact support immediately.</p>`,
    variables: ["name", "methodSummary"], category: "transactional" },
  { key: "payment_upcoming", name: "Upcoming payment reminder", event: "billing.payment_upcoming",
    subject: "Heads up — {{currency}} {{amount}} due on {{dueDate}}",
    body: `<p>Hi {{name}},</p><p>Your next charge of <strong>{{currency}} {{amount}}</strong> for the <strong>{{plan}}</strong> plan is scheduled for <strong>{{dueDate}}</strong>.</p>`,
    variables: ["name", "currency", "amount", "plan", "dueDate"], category: "transactional" },
  { key: "security_login_new_device", name: "New device sign-in", event: "auth.new_device_signin",
    subject: "New sign-in to your {{appName}} account",
    body: `<p>Hi {{name}},</p><p>We noticed a new sign-in to your account from <strong>{{device}}</strong> ({{location}}) at {{signinAt}}. If this wasn't you, change your password immediately.</p>`,
    variables: ["name", "device", "location", "signinAt", "appName"], category: "transactional" },
  { key: "security_password_changed", name: "Password changed", event: "auth.password_changed",
    subject: "Your {{appName}} password was changed",
    body: `<p>Hi {{name}},</p><p>Your password was changed at {{changedAt}}. If you didn't do this, reset your password right away and contact support.</p>`,
    variables: ["name", "changedAt", "appName"], category: "transactional" },
  { key: "security_two_factor_enabled", name: "Two-factor enabled", event: "auth.two_factor_enabled",
    subject: "Two-factor authentication enabled",
    body: `<p>Hi {{name}},</p><p>Two-factor authentication was enabled on your account. Your account is now more secure.</p>`,
    variables: ["name"], category: "transactional" },
  { key: "team_member_invited", name: "Team member invited", event: "tenant.member_invited",
    subject: "You're invited to join {{restaurant}} on {{appName}}",
    body: `<p>Hi {{name}},</p><p>{{inviterName}} invited you to join <strong>{{restaurant}}</strong> as <strong>{{role}}</strong>.</p><p><a href="{{acceptUrl}}">Accept invitation</a></p>`,
    variables: ["name", "inviterName", "restaurant", "role", "acceptUrl", "appName"], category: "transactional" },
  { key: "team_member_removed", name: "Team member removed", event: "tenant.member_removed",
    subject: "Your access to {{restaurant}} has ended",
    body: `<p>Hi {{name}},</p><p>Your access to <strong>{{restaurant}}</strong> on {{appName}} has been removed by an administrator.</p>`,
    variables: ["name", "restaurant", "appName"], category: "transactional" },
  { key: "restaurant_reactivated", name: "Restaurant reactivated", event: "tenant.reactivated",
    subject: "Welcome back — {{restaurant}} is active again",
    body: `<p>Hi {{name}},</p><p>Your restaurant <strong>{{restaurant}}</strong> has been reactivated on {{appName}}. You can sign in and resume operations immediately.</p>`,
    variables: ["name", "restaurant", "appName"], category: "transactional" },
];

export async function seedDefaultEmailTemplates(): Promise<void> {
  const existing = await db.select({ key: emailTemplatesTable.key }).from(emailTemplatesTable);
  const have = new Set(existing.map(r => r.key));
  const missing = DEFAULT_TEMPLATES.filter(t => !have.has(t.key));
  if (missing.length === 0) return;
  await db.insert(emailTemplatesTable).values(missing.map(t => ({
    key: t.key, name: t.name, event: t.event,
    subject: t.subject, body: t.body, variables: t.variables,
    category: t.category ?? "transactional",
    isEnabled: true, isDefault: true,
  })));
  logger.info({ count: missing.length }, "Seeded default email templates");
}

export function maskProviderConfig(driver: EmailDriver, cfg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...cfg };
  const mask = (k: string) => { if (typeof out[k] === "string" && (out[k] as string).length > 0) out[k] = "••••••••"; };
  if (driver === "smtp") mask("password");
  if (driver === "sendgrid") mask("apiKey");
  if (driver === "mailgun") mask("apiKey");
  if (driver === "ses") mask("secretKey");
  if (driver === "resend") mask("apiKey");
  if (driver === "postmark") mask("serverToken");
  if (driver === "custom") mask("authHeader");
  return out;
}

const SECRET_KEYS: Record<EmailDriver, ReadonlySet<string>> = {
  smtp: new Set(["password"]),
  sendgrid: new Set(["apiKey"]),
  mailgun: new Set(["apiKey"]),
  ses: new Set(["secretKey"]),
  resend: new Set(["apiKey"]),
  postmark: new Set(["serverToken"]),
  custom: new Set(["authHeader"]),
};

export function mergeProviderConfig(
  driver: EmailDriver,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!incoming) return existing;
  const secrets = SECRET_KEYS[driver];
  const merged: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof v === "string" && v === "••••••••") continue;
    if (secrets.has(k) && typeof v === "string" && v.trim() === "" && existing[k]) continue;
    merged[k] = v;
  }
  return merged;
}

/** Resolve per-restaurant email settings, creating a default row if missing. */
export async function getRestaurantEmailSettings(restaurantId: number) {
  const [row] = await db.select().from(emailRestaurantSettingsTable).where(eq(emailRestaurantSettingsTable.restaurantId, restaurantId));
  if (row) return row;
  const [created] = await db.insert(emailRestaurantSettingsTable).values({ restaurantId }).returning();
  return created;
}

// Re-exports kept for backwards compat
export { eq, and, or, inArray, sql };
