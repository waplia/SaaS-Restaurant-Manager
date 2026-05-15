import nodemailer from "nodemailer";
import { and, eq } from "drizzle-orm";
import {
  db,
  emailProvidersTable,
  emailTemplatesTable,
  emailLogsTable,
  type EmailProvider,
  type EmailTemplate,
  type EmailDriver,
  type EmailLog,
} from "./db";
import { logger } from "./logger";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  tenantId?: number | null;
  templateKey?: string | null;
  templateId?: number | null;
  retryOf?: number | null;
};

export type SendEmailResult = {
  log: EmailLog;
  ok: boolean;
  error?: string;
  providerMessageId?: string | null;
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

type DriverSendResult = { providerMessageId: string | null };

async function sendViaSmtp(provider: EmailProvider, opts: SendEmailInput): Promise<DriverSendResult> {
  const cfg = provider.config as { host?: string; port?: number; username?: string; password?: string; encryption?: "tls" | "ssl" | "none" };
  const port = Number(cfg.port ?? 587);
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port,
    secure: cfg.encryption === "ssl" || port === 465,
    auth: cfg.username ? { user: cfg.username, pass: cfg.password ?? "" } : undefined,
    requireTLS: cfg.encryption === "tls",
  });
  const info = await transporter.sendMail({
    from: provider.fromName ? `"${provider.fromName}" <${provider.fromEmail}>` : provider.fromEmail,
    to: opts.to,
    replyTo: provider.replyTo ?? undefined,
    subject: opts.subject,
    html: opts.html,
    text: opts.text ?? htmlToText(opts.html),
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
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
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
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`api:${cfg.apiKey}`).toString("base64")}`,
    },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`Mailgun ${res.status}: ${await res.text()}`);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { providerMessageId: typeof json.id === "string" ? json.id : null };
}

import { createHmac, createHash } from "crypto";

function sesSign(key: Buffer, msg: string): Buffer {
  return createHmac("sha256", key).update(msg, "utf8").digest();
}

async function sendViaSes(provider: EmailProvider, opts: SendEmailInput): Promise<DriverSendResult> {
  const cfg = provider.config as { accessKey?: string; secretKey?: string; region?: string };
  const accessKey = cfg.accessKey;
  const secretKey = cfg.secretKey;
  const region = cfg.region || "us-east-1";
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
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Amz-Date": amzDate,
      Authorization: authorization,
      Host: host,
    },
    body: payload,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SES ${res.status}: ${text}`);
  const m = /<MessageId>([^<]+)<\/MessageId>/.exec(text);
  return { providerMessageId: m ? m[1] : null };
}

async function sendViaCustom(provider: EmailProvider, opts: SendEmailInput): Promise<DriverSendResult> {
  const cfg = provider.config as { baseUrl?: string; authHeader?: string; bodyTemplate?: string };
  if (!cfg.baseUrl) throw new Error("Custom provider baseUrl is required");
  const vars = {
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text ?? htmlToText(opts.html),
    fromName: provider.fromName,
    fromEmail: provider.fromEmail,
    replyTo: provider.replyTo ?? "",
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
    if (idx > 0) {
      headers[cfg.authHeader.slice(0, idx).trim()] = cfg.authHeader.slice(idx + 1).trim();
    } else {
      headers["Authorization"] = cfg.authHeader;
    }
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
    case "custom":   return sendViaCustom(provider, opts);
  }
}

/** Send an email via a specific provider (used for "test send"). Always logs. */
export async function sendEmailViaProvider(
  provider: EmailProvider,
  opts: SendEmailInput,
): Promise<SendEmailResult> {
  if (!provider.isEnabled) {
    const [log] = await db.insert(emailLogsTable).values({
      tenantId: opts.tenantId ?? null,
      recipient: opts.to,
      templateKey: opts.templateKey ?? null,
      templateId: opts.templateId ?? null,
      providerId: provider.id,
      providerDriver: provider.driver,
      subject: opts.subject,
      status: "failed",
      error: "Provider is disabled",
      retryOf: opts.retryOf ?? null,
    }).returning();
    return { log, ok: false, error: "Provider is disabled" };
  }
  try {
    const out = await sendWithDriver(provider, opts);
    const [log] = await db.insert(emailLogsTable).values({
      tenantId: opts.tenantId ?? null,
      recipient: opts.to,
      templateKey: opts.templateKey ?? null,
      templateId: opts.templateId ?? null,
      providerId: provider.id,
      providerDriver: provider.driver,
      subject: opts.subject,
      status: "sent",
      providerMessageId: out.providerMessageId,
      retryOf: opts.retryOf ?? null,
      sentAt: new Date(),
    }).returning();
    return { log, ok: true, providerMessageId: out.providerMessageId };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    logger.warn({ err, to: opts.to, providerId: provider.id }, "Email send failed");
    const [log] = await db.insert(emailLogsTable).values({
      tenantId: opts.tenantId ?? null,
      recipient: opts.to,
      templateKey: opts.templateKey ?? null,
      templateId: opts.templateId ?? null,
      providerId: provider.id,
      providerDriver: provider.driver,
      subject: opts.subject,
      status: "failed",
      error: msg.slice(0, 4000),
      retryOf: opts.retryOf ?? null,
    }).returning();
    return { log, ok: false, error: msg };
  }
}

/** Send an email using the active default provider. Returns null log if no provider is configured. */
export async function sendEmail(opts: SendEmailInput): Promise<SendEmailResult | null> {
  const provider = await getActiveProvider();
  if (!provider) {
    logger.info({ to: opts.to, subject: opts.subject }, "No email provider configured — email not sent");
    const [log] = await db.insert(emailLogsTable).values({
      tenantId: opts.tenantId ?? null,
      recipient: opts.to,
      templateKey: opts.templateKey ?? null,
      templateId: opts.templateId ?? null,
      providerId: null,
      providerDriver: null,
      subject: opts.subject,
      status: "failed",
      error: "No active email provider configured",
      retryOf: opts.retryOf ?? null,
    }).returning();
    return { log, ok: false, error: "No active email provider configured" };
  }
  return sendEmailViaProvider(provider, opts);
}

/** Look up a template by key and send it through the active provider. Failures are logged but never thrown. */
export async function sendByTemplateKey(
  key: string,
  to: string,
  vars: Record<string, unknown>,
  opts: { tenantId?: number | null; subjectOverride?: string } = {},
): Promise<SendEmailResult | null> {
  try {
    const [tpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.key, key));
    if (!tpl || !tpl.isEnabled) {
      logger.info({ key }, "Email template missing or disabled — skipping send");
      return null;
    }
    const subject = renderTemplate(opts.subjectOverride ?? tpl.subject, vars);
    const html = renderTemplate(tpl.body, vars);
    return await sendEmail({
      to,
      subject,
      html,
      text: htmlToText(html),
      tenantId: opts.tenantId ?? null,
      templateKey: key,
      templateId: tpl.id,
    });
  } catch (err) {
    logger.error({ err, key, to }, "sendByTemplateKey failed");
    return null;
  }
}

export const DEFAULT_TEMPLATES: Array<{
  key: string; name: string; event: string; subject: string; body: string; variables: string[];
}> = [
  {
    key: "welcome", name: "Welcome email", event: "user.signup",
    subject: "Welcome to {{appName}}, {{name}}!",
    body: `<p>Hi {{name}},</p><p>Welcome to <strong>{{appName}}</strong> — your restaurant <strong>{{restaurant}}</strong> is set up and ready.</p><p>You can sign in any time at <a href="{{appUrl}}">{{appUrl}}</a>.</p><p>— The {{appName}} team</p>`,
    variables: ["name", "restaurant", "appName", "appUrl"],
  },
  {
    key: "trial_started", name: "Trial started", event: "subscription.trial_started",
    subject: "Your {{appName}} free trial has started",
    body: `<p>Hi {{name}},</p><p>Your {{trialDays}}-day free trial of {{appName}} is now active. It ends on <strong>{{trialEndsAt}}</strong>.</p><p>Explore the platform and let us know if you have questions.</p>`,
    variables: ["name", "trialDays", "trialEndsAt", "appName"],
  },
  {
    key: "trial_ending", name: "Trial ending soon", event: "subscription.trial_ending",
    subject: "Your {{appName}} trial ends in {{daysLeft}} days",
    body: `<p>Hi {{name}},</p><p>Your free trial ends on <strong>{{trialEndsAt}}</strong>. Upgrade to keep your data and continue using {{appName}}.</p><p><a href="{{upgradeUrl}}">Choose a plan</a></p>`,
    variables: ["name", "daysLeft", "trialEndsAt", "appName", "upgradeUrl"],
  },
  {
    key: "subscription_activated", name: "Subscription activated", event: "subscription.activated",
    subject: "Your {{plan}} plan is active",
    body: `<p>Hi {{name}},</p><p>Your subscription to the <strong>{{plan}}</strong> plan is now active. Your next renewal is on <strong>{{renewsAt}}</strong>.</p><p>Thank you for choosing {{appName}}.</p>`,
    variables: ["name", "plan", "renewsAt", "appName"],
  },
  {
    key: "subscription_expired", name: "Subscription expired", event: "subscription.expired",
    subject: "Your {{appName}} subscription has expired",
    body: `<p>Hi {{name}},</p><p>Your subscription to the <strong>{{plan}}</strong> plan expired on <strong>{{expiredAt}}</strong>. Renew to restore access.</p><p><a href="{{upgradeUrl}}">Renew now</a></p>`,
    variables: ["name", "plan", "expiredAt", "upgradeUrl", "appName"],
  },
  {
    key: "package_upgraded", name: "Package upgraded", event: "subscription.upgraded",
    subject: "You upgraded to {{plan}}",
    body: `<p>Hi {{name}},</p><p>Your plan has been upgraded from <strong>{{oldPlan}}</strong> to <strong>{{plan}}</strong>. New limits and features are available immediately.</p>`,
    variables: ["name", "oldPlan", "plan"],
  },
  {
    key: "package_downgraded", name: "Package downgraded", event: "subscription.downgraded",
    subject: "Your plan was changed to {{plan}}",
    body: `<p>Hi {{name}},</p><p>Your plan has been changed from <strong>{{oldPlan}}</strong> to <strong>{{plan}}</strong>. Some limits may have decreased.</p>`,
    variables: ["name", "oldPlan", "plan"],
  },
  {
    key: "payment_successful", name: "Payment successful", event: "billing.payment_succeeded",
    subject: "Payment received — {{currency}} {{amount}}",
    body: `<p>Hi {{name}},</p><p>We received your payment of <strong>{{currency}} {{amount}}</strong> for the <strong>{{plan}}</strong> plan. Your invoice is ready: <a href="{{invoiceUrl}}">{{invoiceUrl}}</a>.</p>`,
    variables: ["name", "currency", "amount", "plan", "invoiceUrl"],
  },
  {
    key: "payment_failed", name: "Payment failed", event: "billing.payment_failed",
    subject: "Payment failed — action required",
    body: `<p>Hi {{name}},</p><p>Your payment of <strong>{{currency}} {{amount}}</strong> for the <strong>{{plan}}</strong> plan failed. Please update your payment method to avoid service interruption.</p><p>Reason: {{reason}}</p>`,
    variables: ["name", "currency", "amount", "plan", "reason"],
  },
  {
    key: "invoice_generated", name: "Invoice generated", event: "billing.invoice_generated",
    subject: "Your invoice {{invoiceNumber}} is ready",
    body: `<p>Hi {{name}},</p><p>Your invoice <strong>{{invoiceNumber}}</strong> for {{currency}} {{amount}} is available.</p><p><a href="{{invoiceUrl}}">View invoice</a></p>`,
    variables: ["name", "invoiceNumber", "currency", "amount", "invoiceUrl"],
  },
  {
    key: "password_reset", name: "Password reset", event: "auth.password_reset",
    subject: "Reset your {{appName}} password",
    body: `<p>Hi {{name}},</p><p>We received a request to reset your password. Click below to set a new one — the link expires in 1 hour.</p><p><a href="{{resetLink}}">Reset password</a></p><p>If you did not request this, you can safely ignore this email.</p>`,
    variables: ["name", "resetLink", "appName"],
  },
  {
    key: "support_ticket_created", name: "Support ticket created", event: "support.ticket_created",
    subject: "Support ticket #{{ticketId}} received",
    body: `<p>Hi {{name}},</p><p>We received your support request <strong>#{{ticketId}}</strong>: <em>{{subjectLine}}</em>. Our team will get back to you shortly.</p>`,
    variables: ["name", "ticketId", "subjectLine"],
  },
  {
    key: "support_ticket_replied", name: "Support ticket replied", event: "support.ticket_replied",
    subject: "Re: Support ticket #{{ticketId}}",
    body: `<p>Hi {{name}},</p><p>You have a new reply on ticket <strong>#{{ticketId}}</strong>:</p><blockquote>{{reply}}</blockquote><p><a href="{{ticketUrl}}">View ticket</a></p>`,
    variables: ["name", "ticketId", "reply", "ticketUrl"],
  },
  {
    key: "restaurant_suspended", name: "Restaurant suspended", event: "tenant.suspended",
    subject: "Your account on {{appName}} has been suspended",
    body: `<p>Hi {{name}},</p><p>Your restaurant <strong>{{restaurant}}</strong> has been suspended on {{appName}}. Reason: {{reason}}</p><p>Please contact support to resolve this.</p>`,
    variables: ["name", "restaurant", "reason", "appName"],
  },
  {
    key: "feature_announcement", name: "New feature announcement", event: "platform.announcement",
    subject: "{{title}}",
    body: `<p>Hi {{name}},</p><p>{{body}}</p><p>— The {{appName}} team</p>`,
    variables: ["name", "title", "body", "appName"],
  },
];

/** Idempotently insert any default templates that aren't already present. */
export async function seedDefaultEmailTemplates(): Promise<void> {
  const existing = await db.select({ key: emailTemplatesTable.key }).from(emailTemplatesTable);
  const have = new Set(existing.map(r => r.key));
  const missing = DEFAULT_TEMPLATES.filter(t => !have.has(t.key));
  if (missing.length === 0) return;
  await db.insert(emailTemplatesTable).values(missing.map(t => ({
    key: t.key,
    name: t.name,
    event: t.event,
    subject: t.subject,
    body: t.body,
    variables: t.variables,
    isEnabled: true,
  })));
  logger.info({ count: missing.length }, "Seeded default email templates");
}

/** Mask sensitive fields in provider config when returning to the client. */
export function maskProviderConfig(driver: EmailDriver, cfg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...cfg };
  const mask = (k: string) => {
    if (typeof out[k] === "string" && (out[k] as string).length > 0) out[k] = "••••••••";
  };
  if (driver === "smtp") mask("password");
  if (driver === "sendgrid") mask("apiKey");
  if (driver === "mailgun") mask("apiKey");
  if (driver === "ses") mask("secretKey");
  if (driver === "custom") mask("authHeader");
  return out;
}

const SECRET_KEYS: Record<EmailDriver, ReadonlySet<string>> = {
  smtp: new Set(["password"]),
  sendgrid: new Set(["apiKey"]),
  mailgun: new Set(["apiKey"]),
  ses: new Set(["secretKey"]),
  custom: new Set(["authHeader"]),
};

/** Merge an incoming config patch with the existing one. For secret fields,
 *  the masked sentinel ("••••••••") AND an empty/whitespace-only string both
 *  mean "leave the existing value unchanged" — preventing accidental wipes. */
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

export { eq, and };
