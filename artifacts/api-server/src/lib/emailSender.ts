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
    // 1) Flat-key lookup: callers may pre-flatten brand vars like
    //    "brand.logoImgHtml" → string. Use this when present.
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      const flat = (vars as Record<string, unknown>)[key];
      if (flat !== undefined && flat !== null) return String(flat);
    }
    // 2) Nested traversal: vars.brand.logoImgHtml etc.
    const v = key.split(".").reduce<unknown>((acc, k) => {
      if (acc && typeof acc === "object" && k in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[k];
      }
      return undefined;
    }, vars);
    return v === undefined || v === null ? "" : String(v);
  });
}

// ─── Premium email layout (v2) ────────────────────────────────────
// A single, shared, professionally designed 600px-max branded email used by
// every default platform email so triggers go out with a consistent look:
//
//   ┌────────────────────────────────────────────────────────────┐
//   │  [ logo or wordmark ]                       (header bar)   │
//   ├────────────────────────────────────────────────────────────┤
//   │  Big heading                                                │
//   │  Lead/intro paragraph                                       │
//   │                                                             │
//   │  Body content (rendered as-is)                              │
//   │                                                             │
//   │            ┌──────────────────────────┐                     │
//   │            │       Primary CTA        │                     │
//   │            └──────────────────────────┘                     │
//   │                                                             │
//   │  Optional secondary link                                    │
//   ├────────────────────────────────────────────────────────────┤
//   │  Help row · "Questions? hello@... · +91 ..."                │
//   │  Address line                                               │
//   │  Social row (icons)                                         │
//   │  Legal row · "© 2026 brand · Unsubscribe · Preferences"     │
//   └────────────────────────────────────────────────────────────┘
//
// The layout is fully inlined (no external CSS), uses bullet-proof tables
// for Outlook, and renders well on mobile via a small <style> block in
// the head that only progressive clients pick up.
//
// All brand-specific bits (logo URL, support email/phone, company address,
// social links, primary color) come from `{{brand.*}}` placeholders that
// `sendByTemplateKey` injects from `getAppSettings()` before rendering. That
// means a single edit in Super Admin → App Settings updates every email
// without re-seeding.
//
// `data-tt-premium="2"` marks the layout version so the seed/upgrade routine
// can re-wrap rows produced by older versions (v1 had data-tt-premium="1").
export type PremiumLayoutInput = {
  preheader?: string;
  heading: string;
  intro?: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  secondaryLabel?: string;
  secondaryUrl?: string;
  footerNote?: string;
  appName?: string;
};

export const PREMIUM_LAYOUT_VERSION = 2;

export function premiumLayout(opts: PremiumLayoutInput): string {
  const appName = opts.appName ?? "{{appName}}";
  const preheader = opts.preheader ?? "";
  const heading = opts.heading;

  // ─── Header (logo image with text fallback) ─────────────────────
  // Email clients block remote images by default, so we render the brand
  // name as a text wordmark *alongside* the logo. Clients that load the
  // image will show it; clients that don't still see the brand name.
  const header = `
    <tr>
      <td style="padding:0;background:#0F172A">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="left" style="padding:22px 32px">
              <a href="{{brand.appUrl}}" style="text-decoration:none;color:#ffffff;display:inline-block">
                {{brand.logoImgHtml}}<span style="vertical-align:middle;font-family:Inter,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:18px;font-weight:700;letter-spacing:-.2px;color:#ffffff">${appName}</span>
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr><td style="height:4px;background:{{brand.primaryColor}};line-height:4px;font-size:0">&nbsp;</td></tr>`;

  // ─── CTA block ──────────────────────────────────────────────────
  // Uses a VML rounded-rect for Outlook + a normal anchor everywhere else.
  const cta = opts.ctaLabel && opts.ctaUrl
    ? `<tr><td align="center" style="padding:8px 0 4px 0">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${opts.ctaUrl}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="14%" stroke="f" fillcolor="{{brand.primaryColor}}">
          <w:anchorlock/>
          <center style="color:#ffffff;font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;">${opts.ctaLabel}</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-->
        <a href="${opts.ctaUrl}" style="display:inline-block;background:{{brand.primaryColor}};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;line-height:1;padding:15px 32px;border-radius:8px;font-family:Inter,'Helvetica Neue',Helvetica,Arial,sans-serif;box-shadow:0 1px 2px rgba(15,23,42,.08)">${opts.ctaLabel}</a>
        <!--<![endif]-->
       </td></tr>`
    : "";

  const secondary = opts.secondaryLabel && opts.secondaryUrl
    ? `<tr><td align="center" style="padding:14px 0 0 0">
         <a href="${opts.secondaryUrl}" style="color:{{brand.primaryColor}};text-decoration:none;font-size:13px;font-weight:500;font-family:Inter,Helvetica,Arial,sans-serif">${opts.secondaryLabel} →</a>
       </td></tr>`
    : "";

  const intro = opts.intro
    ? `<tr><td style="padding:0 0 18px 0;color:#475569;font-size:16px;line-height:1.55;font-family:Inter,'Helvetica Neue',Helvetica,Arial,sans-serif">${opts.intro}</td></tr>`
    : "";

  // ─── Footer ─────────────────────────────────────────────────────
  // Built from injected brand vars. Each row is conditionally rendered
  // via tiny inline placeholders: when a value is empty the surrounding
  // text falls away cleanly because the template is plain-string and
  // {{var}} substitutes to "".
  const footerNote = opts.footerNote
    ? `<p style="margin:14px 0 0 0;color:#94A3B8;font-size:12px;line-height:1.6">${opts.footerNote}</p>`
    : "";

  const footer = `
    <tr><td style="padding:0 32px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="border-top:1px solid #E2E8F0;padding:0;line-height:0;font-size:0">&nbsp;</td></tr>
      </table>
    </td></tr>
    <tr>
      <td style="padding:24px 32px 8px 32px;font-family:Inter,'Helvetica Neue',Helvetica,Arial,sans-serif">
        <p style="margin:0 0 8px 0;color:#0F172A;font-size:14px;font-weight:600;line-height:1.5">Need a hand?</p>
        <p style="margin:0;color:#64748B;font-size:13px;line-height:1.6">
          Reply to this email or reach us at
          <a href="mailto:{{brand.supportEmail}}" style="color:{{brand.primaryColor}};text-decoration:none">{{brand.supportEmail}}</a>{{brand.supportPhoneHtml}}.
        </p>
        ${footerNote}
      </td>
    </tr>
    {{brand.socialRowHtml}}
    <tr>
      <td style="padding:8px 32px 24px 32px;font-family:Inter,'Helvetica Neue',Helvetica,Arial,sans-serif">
        <p style="margin:14px 0 4px 0;color:#94A3B8;font-size:12px;line-height:1.6">{{brand.companyAddress}}</p>
        <p style="margin:0;color:#94A3B8;font-size:12px;line-height:1.6">
          © {{brand.year}} ${appName}. All rights reserved.
          {{brand.unsubscribeFooterHtml}}
        </p>
        {{brand.footerTextHtml}}
      </td>
    </tr>`;

  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${heading}</title>
  <!--[if mso]>
    <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    @media only screen and (max-width:620px) {
      .tt-card { width:100% !important; border-radius:0 !important; border-left:0 !important; border-right:0 !important; }
      .tt-pad  { padding-left:22px !important; padding-right:22px !important; }
      .tt-h    { font-size:22px !important; line-height:1.25 !important; }
    }
    a { color:{{brand.primaryColor}}; }
  </style>
</head>
<body data-tt-premium="${PREMIUM_LAYOUT_VERSION}" style="margin:0;padding:0;background:#F1F5F9;font-family:Inter,'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F1F5F9">
  <tr><td align="center" style="padding:32px 12px">
    <table role="presentation" class="tt-card" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.06)">
      ${header}
      <tr><td class="tt-pad" style="padding:36px 36px 8px 36px">
        <h1 class="tt-h" style="margin:0 0 14px 0;color:#0F172A;font-family:Inter,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:-.3px">${heading}</h1>
      </td></tr>
      <tr><td class="tt-pad" style="padding:0 36px 28px 36px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${intro}
          <tr><td style="color:#1F2937;font-size:15px;line-height:1.65;font-family:Inter,'Helvetica Neue',Helvetica,Arial,sans-serif">${opts.bodyHtml}</td></tr>
          ${cta}
          ${secondary}
        </table>
      </td></tr>
      ${footer}
    </table>
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">
      <tr><td align="center" style="padding:16px 12px 8px 12px;color:#94A3B8;font-family:Inter,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;line-height:1.5">
        This is an automated message from ${appName}. Please do not reply to system addresses; use the support contact above.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** True if the supplied HTML is already wrapped with the premium layout (any version). */
export function hasPremiumLayout(html: string): boolean {
  return typeof html === "string" && html.includes("data-tt-premium");
}

/** True if the body is wrapped with the *current* premium layout version. */
export function hasCurrentPremiumLayout(html: string): boolean {
  return typeof html === "string" && html.includes(`data-tt-premium="${PREMIUM_LAYOUT_VERSION}"`);
}

// ─── Brand variable injection ─────────────────────────────────────
// Pulls logo, colors, support contact, address, social links from
// `app_settings` and turns them into the `{{brand.*}}` placeholders the
// premium layout uses. Cached at the same TTL as `getAppSettings`.
const DEFAULT_PRIMARY = "#F97316";

/** Hex color guard — only #RGB / #RRGGBB allowed, otherwise return fallback. */
function safeHexColor(raw: string | null | undefined, fallback: string): string {
  return typeof raw === "string" && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(raw)
    ? raw
    : fallback;
}

/** Only http/https/mailto/tel URLs are emitted as-is; everything else → "#". */
function safeUrl(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "#";
  const s = raw.trim();
  if (!s) return "#";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^mailto:/i.test(s) || /^tel:/i.test(s)) return s;
  return "#";
}

/** Strip control chars from a phone-like string before putting it in a tel: href. */
function safePhone(raw: string | null | undefined): string {
  return typeof raw === "string" ? raw.replace(/[^\d+\-() ]/g, "").trim() : "";
}

/** Light email validation — used only to avoid emitting mailto:"" anchors. */
function safeEmail(raw: string | null | undefined, fallback: string): string {
  return typeof raw === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : fallback;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function socialRowHtml(links: Record<string, string | null | undefined> | null | undefined, accent: string): string {
  if (!links) return "";
  const order: Array<[string, string]> = [
    ["website",   "Website"],
    ["instagram", "Instagram"],
    ["facebook",  "Facebook"],
    ["twitter",   "Twitter"],
    ["linkedin",  "LinkedIn"],
    ["youtube",   "YouTube"],
  ];
  const cells = order
    .filter(([k]) => typeof links[k] === "string" && links[k]!.trim().length > 0)
    .map(([k, label]) =>
      `<a href="${escapeHtml(links[k]!)}" style="color:${accent};text-decoration:none;font-size:12px;font-weight:500;margin:0 8px;font-family:Inter,Helvetica,Arial,sans-serif">${label}</a>`,
    );
  if (cells.length === 0) return "";
  return `<tr><td align="center" style="padding:12px 32px 0 32px;border-top:1px solid #F1F5F9">${cells.join('<span style="color:#CBD5E1">·</span>')}</td></tr>`;
}

export async function getBrandTemplateVars(opts?: { appUrlFallback?: string }): Promise<Record<string, string>> {
  const s = await getAppSettings().catch(() => null);
  const appName  = s?.appName        || "TableTrack";
  const primary  = safeHexColor(s?.primaryColor ?? null, DEFAULT_PRIMARY);
  const logoUrl  = safeUrl(s?.logoUrl ?? null);
  const support  = safeEmail(s?.supportEmail ?? null, "support@tabletrack.in");
  const phone    = safePhone(s?.supportPhone ?? null);
  const address  = s?.companyAddress || "";
  const footer   = s?.footerText     || "";
  const appUrl   = safeUrl(
    (s as { appUrl?: string } | null)?.appUrl
      ?? opts?.appUrlFallback
      ?? process.env.PUBLIC_APP_URL
      ?? null,
  );
  const social   = (s?.socialLinks ?? null) as Record<string, string> | null;

  const unsubscribeFooterHtml = `<span style="color:#CBD5E1"> · </span><a href="{{unsubscribeUrl}}" style="color:#94A3B8;text-decoration:underline">Unsubscribe</a>`;
  const footerTextHtml = footer
    ? `<p style="margin:8px 0 0 0;color:#94A3B8;font-size:12px;line-height:1.6">${escapeHtml(footer)}</p>`
    : "";

  // When a logo URL is configured, render an <img> tag in the header next
  // to the wordmark; otherwise emit empty markup so just the brand text
  // shows (no broken-image icon in clients that block remote loads).
  // logoUrl is already URL-sanitized by safeUrl(); we still escape for the
  // attribute context as belt-and-braces.
  const logoImgHtml = logoUrl && logoUrl !== "#"
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(appName)}" height="32" style="display:inline-block;vertical-align:middle;height:32px;width:auto;border:0;outline:none;margin-right:10px" />`
    : "";

  // Phone fragment for the "Need a hand?" footer. Renders the " or call
  // <a tel:...>+91 ...</a>" only when a usable phone number is configured,
  // so empty phones don't produce dangling `tel:` anchors.
  const supportPhoneHtml = phone
    ? ` or call <a href="tel:${escapeHtml(phone)}" style="color:${primary};text-decoration:none">${escapeHtml(phone)}</a>`
    : "";

  return {
    "appName": appName,
    "appUrl": appUrl,
    "brand.appUrl": appUrl,
    "brand.logoUrl": logoUrl,
    "brand.logoImgHtml": logoImgHtml,
    "brand.primaryColor": primary,
    "brand.supportEmail": support,
    "brand.supportPhone": phone,
    "brand.supportPhoneHtml": supportPhoneHtml,
    "brand.companyAddress": address ? escapeHtml(address) : "",
    "brand.socialRowHtml": socialRowHtml(social, primary),
    "brand.year": String(new Date().getUTCFullYear()),
    "brand.unsubscribeFooterHtml": unsubscribeFooterHtml,
    "brand.footerTextHtml": footerTextHtml,
  };
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
      // Loud failure: write a `failed` row to email_logs so Super Admin sees
      // the trigger *attempted* and the operator can re-enable / seed the
      // template. Previously this silently returned null which made the
      // Email Center dashboard counters under-report broken triggers.
      logger.warn({ key, to }, "Email template missing or disabled — logging failed send");
      try {
        await db.insert(emailLogsTable).values({
          tenantId: opts.tenantId ?? null, restaurantId: opts.restaurantId ?? null,
          recipient: to, recipientType: opts.recipientType ?? "user",
          templateKey: key, templateId: tpl?.id ?? null,
          providerId: null, providerDriver: null,
          subject: opts.subjectOverride ?? `[${key}] (template missing)`,
          status: "failed",
          error: tpl ? "Template is disabled" : "Template not found",
          campaignId: opts.campaignId ?? null, automationId: opts.automationId ?? null,
        });
      } catch (logErr) {
        logger.error({ err: logErr, key }, "Failed to record missing-template email_logs row");
      }
      return null;
    }
    // Inject brand vars (logo, primary color, support contact, address,
    // social links, year) before rendering so the premium layout's
    // {{brand.*}} placeholders fill in. Per-template `vars` win over
    // brand defaults so callers can still override e.g. appName.
    const brandVars = await getBrandTemplateVars().catch(() => ({}));
    const mergedVars: Record<string, unknown> = { ...brandVars, ...vars };
    const subject = renderTemplate(opts.subjectOverride ?? tpl.subject, mergedVars);
    const html = renderTemplate(tpl.body, mergedVars);
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
  key: string; name: string; event: string; subject: string; body: string; variables: string[];
  category?: "transactional" | "lifecycle" | "marketing";
  preheader?: string; plainText?: string;
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
  // ─── Task #533: Platform email template expansion to 45 ───
  { key: "otp_login", name: "OTP – login", event: "auth.otp_login",
    subject: "Your {{appName}} login code: {{otp}}",
    body: `<p>Hi {{name}},</p><p>Your one-time login code is <strong>{{otp}}</strong>. It expires in {{ttlMinutes}} minutes. Don't share this code with anyone.</p>`,
    variables: ["name", "otp", "ttlMinutes", "appName"], category: "transactional" },
  { key: "otp_verification", name: "OTP – verification", event: "auth.otp_verification",
    subject: "Confirm your action — code {{otp}}",
    body: `<p>Hi {{name}},</p><p>Use code <strong>{{otp}}</strong> to confirm your action. The code expires in {{ttlMinutes}} minutes.</p>`,
    variables: ["name", "otp", "ttlMinutes"], category: "transactional" },
  { key: "order_confirmation_admin", name: "Order confirmation – staff", event: "order.created",
    subject: "New order #{{orderNumber}} at {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>A new order <strong>#{{orderNumber}}</strong> for {{currency}} {{amount}} was placed by {{customerName}}.</p><p><a href="{{orderUrl}}">Open order</a></p>`,
    variables: ["name", "orderNumber", "restaurant", "currency", "amount", "customerName", "orderUrl"], category: "transactional" },
  { key: "low_stock_alert", name: "Low stock alert", event: "inventory.low_stock",
    subject: "Low stock alert at {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>The following items are below their reorder level at <strong>{{restaurant}}</strong>:</p><p>{{itemList}}</p>`,
    variables: ["name", "restaurant", "itemList"], category: "transactional" },
  { key: "daily_summary", name: "Daily summary digest", event: "tenant.daily_summary",
    subject: "{{restaurant}} — yesterday's summary",
    body: `<p>Hi {{name}},</p><p>Orders: <strong>{{orderCount}}</strong> • Revenue: <strong>{{currency}} {{revenue}}</strong> • Avg ticket: <strong>{{currency}} {{avgTicket}}</strong>.</p><p><a href="{{dashboardUrl}}">Open dashboard</a></p>`,
    variables: ["name", "restaurant", "orderCount", "currency", "revenue", "avgTicket", "dashboardUrl"], category: "lifecycle" },
  { key: "weekly_report", name: "Weekly performance report", event: "tenant.weekly_report",
    subject: "Your weekly report — {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>Here's how <strong>{{restaurant}}</strong> performed this week. Revenue {{currency}} {{revenue}} across {{orderCount}} orders.</p><p><a href="{{reportUrl}}">View full report</a></p>`,
    variables: ["name", "restaurant", "currency", "revenue", "orderCount", "reportUrl"], category: "lifecycle" },
  { key: "loyalty_points_credited", name: "Loyalty points credited", event: "loyalty.points_credited",
    subject: "You earned {{points}} points at {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>You just earned <strong>{{points}}</strong> loyalty points. Your new balance is <strong>{{balance}}</strong>.</p>`,
    variables: ["name", "points", "balance", "restaurant"], category: "marketing" },
  { key: "loyalty_points_expiring", name: "Loyalty points expiring", event: "loyalty.points_expiring",
    subject: "{{points}} loyalty points expiring soon",
    body: `<p>Hi {{name}},</p><p><strong>{{points}}</strong> of your loyalty points expire on <strong>{{expiresAt}}</strong>. Visit {{restaurant}} to use them before they're gone.</p>`,
    variables: ["name", "points", "expiresAt", "restaurant"], category: "marketing" },
  // ─── Task #542: Missing premium templates wired into platform triggers ───
  { key: "restaurant_registered", name: "Restaurant registered (pending review)", event: "tenant.registered",
    subject: "We received your application for {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>Thanks for registering <strong>{{restaurant}}</strong> on {{appName}}. Our team will review your details and get back to you within {{reviewHours}} hours.</p>`,
    variables: ["name", "restaurant", "reviewHours", "appName"], category: "lifecycle" },
  { key: "restaurant_approved", name: "Restaurant approved", event: "tenant.approved",
    subject: "{{restaurant}} is approved on {{appName}} 🎉",
    body: `<p>Hi {{name}},</p><p>Great news — <strong>{{restaurant}}</strong> has been approved. You can sign in now and finish your setup.</p>`,
    variables: ["name", "restaurant", "appUrl", "appName"], category: "lifecycle" },
  { key: "restaurant_rejected", name: "Restaurant rejected", event: "tenant.rejected",
    subject: "Update on your {{appName}} application",
    body: `<p>Hi {{name}},</p><p>Thanks for applying. We're unable to approve <strong>{{restaurant}}</strong> at this time. Reason: {{reason}}</p><p>Reply to this email if you'd like us to take another look.</p>`,
    variables: ["name", "restaurant", "reason", "appName"], category: "lifecycle" },
  { key: "wallet_recharge", name: "Wallet recharged", event: "billing.wallet_recharged",
    subject: "Wallet recharged — {{currency}} {{amount}}",
    body: `<p>Hi {{name}},</p><p>Your {{appName}} wallet was recharged by <strong>{{currency}} {{amount}}</strong>. New balance: <strong>{{currency}} {{balance}}</strong>.</p>`,
    variables: ["name", "currency", "amount", "balance", "appName"], category: "transactional" },
  { key: "addon_purchased", name: "Add-on purchased", event: "billing.addon_purchased",
    subject: "{{addonName}} add-on is active",
    body: `<p>Hi {{name}},</p><p>Your purchase of the <strong>{{addonName}}</strong> add-on for {{currency}} {{amount}} is confirmed and active on <strong>{{restaurant}}</strong>.</p>`,
    variables: ["name", "addonName", "currency", "amount", "restaurant"], category: "transactional" },
  { key: "payment_link_sent", name: "Payment link sent", event: "billing.payment_link_sent",
    subject: "Action needed: complete your {{currency}} {{amount}} payment",
    body: `<p>Hi {{name}},</p><p>Please use the link below to complete your payment of <strong>{{currency}} {{amount}}</strong> for {{purpose}}. The link expires on <strong>{{expiresAt}}</strong>.</p>`,
    variables: ["name", "currency", "amount", "purpose", "expiresAt", "payUrl"], category: "transactional" },
  { key: "payment_reminder", name: "Payment reminder", event: "billing.payment_reminder",
    subject: "Reminder: {{currency}} {{amount}} due on {{dueDate}}",
    body: `<p>Hi {{name}},</p><p>This is a friendly reminder that <strong>{{currency}} {{amount}}</strong> for the <strong>{{plan}}</strong> plan is due on <strong>{{dueDate}}</strong>.</p>`,
    variables: ["name", "currency", "amount", "plan", "dueDate", "payUrl"], category: "transactional" },
  { key: "invoice_paid", name: "Invoice paid", event: "billing.invoice_paid",
    subject: "Invoice {{invoiceNumber}} paid",
    body: `<p>Hi {{name}},</p><p>Invoice <strong>{{invoiceNumber}}</strong> for {{currency}} {{amount}} has been marked as paid. Thanks!</p>`,
    variables: ["name", "invoiceNumber", "currency", "amount", "invoiceUrl"], category: "transactional" },
  { key: "ai_credits_added", name: "AI credits added", event: "ai.credits_added",
    subject: "{{credits}} AI credits added to {{restaurant}}",
    body: `<p>Hi {{name}},</p><p><strong>{{credits}}</strong> AI credits were added to your wallet. New balance: <strong>{{balance}}</strong>.</p>`,
    variables: ["name", "credits", "balance", "restaurant"], category: "transactional" },
  { key: "ai_credits_low", name: "AI credits low", event: "ai.credits_low",
    subject: "AI credits running low at {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>Your AI credit balance for <strong>{{restaurant}}</strong> is down to <strong>{{balance}}</strong>. Recharge to keep AI features running.</p>`,
    variables: ["name", "balance", "restaurant", "rechargeUrl"], category: "lifecycle" },
  { key: "ai_credits_exhausted", name: "AI credits exhausted", event: "ai.credits_exhausted",
    subject: "AI credits exhausted at {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>Your AI credits have run out. Some AI features are paused until you recharge.</p>`,
    variables: ["name", "restaurant", "rechargeUrl"], category: "lifecycle" },
  { key: "ai_credits_recharged", name: "AI credits recharged", event: "ai.credits_recharged",
    subject: "AI wallet recharged — {{credits}} credits",
    body: `<p>Hi {{name}},</p><p>Your AI wallet was recharged with <strong>{{credits}}</strong> credits via the <strong>{{packageName}}</strong> package. New balance: <strong>{{balance}}</strong>.</p>`,
    variables: ["name", "credits", "packageName", "balance", "restaurant"], category: "transactional" },
  { key: "ai_usage_summary", name: "AI usage summary", event: "ai.usage_summary",
    subject: "Your AI usage summary — {{periodLabel}}",
    body: `<p>Hi {{name}},</p><p>In <strong>{{periodLabel}}</strong> you used <strong>{{creditsUsed}}</strong> credits across <strong>{{requestCount}}</strong> requests on <strong>{{restaurant}}</strong>.</p>`,
    variables: ["name", "periodLabel", "creditsUsed", "requestCount", "restaurant"], category: "lifecycle" },
  { key: "ai_feature_enabled", name: "AI feature enabled", event: "ai.feature_enabled",
    subject: "AI feature \"{{featureName}}\" is now active",
    body: `<p>Hi {{name}},</p><p>The AI feature <strong>{{featureName}}</strong> is now enabled for <strong>{{restaurant}}</strong>.</p>`,
    variables: ["name", "featureName", "restaurant"], category: "lifecycle" },
  { key: "ai_menu_import_done", name: "AI menu import complete", event: "ai.menu_import_done",
    subject: "Menu import finished for {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>We finished importing your menu. <strong>{{importedCount}}</strong> items were created and <strong>{{skippedCount}}</strong> were skipped.</p>`,
    variables: ["name", "importedCount", "skippedCount", "restaurant", "menuUrl"], category: "transactional" },
  { key: "ai_campaign_generated", name: "AI campaign generated", event: "ai.campaign_generated",
    subject: "Your AI-generated campaign is ready to review",
    body: `<p>Hi {{name}},</p><p>The AI just drafted a new campaign — <strong>{{campaignName}}</strong>. Review and send when you're ready.</p>`,
    variables: ["name", "campaignName", "restaurant", "campaignUrl"], category: "lifecycle" },
  { key: "order_ready", name: "Order ready", event: "order.ready",
    subject: "Your order #{{orderNumber}} is ready",
    body: `<p>Hi {{name}},</p><p>Your order <strong>#{{orderNumber}}</strong> at <strong>{{restaurant}}</strong> is ready{{pickupNote}}.</p>`,
    variables: ["name", "orderNumber", "restaurant", "pickupNote"], category: "transactional" },
  { key: "customer_order_confirmation", name: "Customer order confirmation", event: "order.placed",
    subject: "Order confirmed — #{{orderNumber}} at {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>Your order <strong>#{{orderNumber}}</strong> at <strong>{{restaurant}}</strong> is confirmed. Total: <strong>{{currency}} {{amount}}</strong>.</p><p>{{itemList}}</p>`,
    variables: ["name", "orderNumber", "restaurant", "currency", "amount", "itemList", "orderUrl"], category: "transactional" },
  { key: "security_suspicious_login", name: "Suspicious login", event: "auth.suspicious_login",
    subject: "Suspicious sign-in to your {{appName}} account",
    body: `<p>Hi {{name}},</p><p>We blocked a suspicious sign-in attempt from <strong>{{location}}</strong> at {{signinAt}}. If this was you, you can ignore this email. Otherwise, change your password immediately.</p>`,
    variables: ["name", "location", "signinAt", "appName", "appUrl"], category: "transactional" },
  { key: "security_account_locked", name: "Account locked", event: "auth.account_locked",
    subject: "Your {{appName}} account is locked",
    body: `<p>Hi {{name}},</p><p>Your account was locked after too many failed sign-in attempts. Reset your password to regain access.</p>`,
    variables: ["name", "appName", "resetLink"], category: "transactional" },
  { key: "staff_role_changed", name: "Staff role changed", event: "staff.role_changed",
    subject: "Your role at {{restaurant}} was updated",
    body: `<p>Hi {{name}},</p><p>Your role at <strong>{{restaurant}}</strong> was changed from <strong>{{oldRole}}</strong> to <strong>{{newRole}}</strong>.</p>`,
    variables: ["name", "restaurant", "oldRole", "newRole"], category: "transactional" },
  { key: "staff_access_disabled", name: "Staff access disabled", event: "staff.access_disabled",
    subject: "Your access to {{restaurant}} was disabled",
    body: `<p>Hi {{name}},</p><p>Your access to <strong>{{restaurant}}</strong> on {{appName}} has been disabled by an administrator. Contact your manager if you believe this is a mistake.</p>`,
    variables: ["name", "restaurant", "appName"], category: "transactional" },
  { key: "staff_payroll_generated", name: "Payslip generated", event: "staff.payroll_generated",
    subject: "Your payslip for {{periodLabel}} is ready",
    body: `<p>Hi {{name}},</p><p>Your payslip for <strong>{{periodLabel}}</strong> is ready. Net pay: <strong>{{currency}} {{netPay}}</strong>.</p>`,
    variables: ["name", "periodLabel", "currency", "netPay", "payslipUrl", "restaurant"], category: "transactional" },
  { key: "staff_shift_reminder", name: "Shift reminder", event: "staff.shift_reminder",
    subject: "Shift reminder — {{shiftStart}}",
    body: `<p>Hi {{name}},</p><p>Reminder: your shift at <strong>{{restaurant}}</strong> starts at <strong>{{shiftStart}}</strong>.</p>`,
    variables: ["name", "restaurant", "shiftStart"], category: "transactional" },
  { key: "staff_leave_approved", name: "Leave approved", event: "staff.leave_approved",
    subject: "Your leave request was approved",
    body: `<p>Hi {{name}},</p><p>Your leave from <strong>{{fromDate}}</strong> to <strong>{{toDate}}</strong> at <strong>{{restaurant}}</strong> has been approved.</p>`,
    variables: ["name", "fromDate", "toDate", "restaurant"], category: "transactional" },
  { key: "staff_leave_rejected", name: "Leave rejected", event: "staff.leave_rejected",
    subject: "Your leave request was declined",
    body: `<p>Hi {{name}},</p><p>Your leave request from <strong>{{fromDate}}</strong> to <strong>{{toDate}}</strong> at <strong>{{restaurant}}</strong> was not approved. Reason: {{reason}}</p>`,
    variables: ["name", "fromDate", "toDate", "restaurant", "reason"], category: "transactional" },
  { key: "staff_shift_handover", name: "Shift handover submitted", event: "staff.shift_handover",
    subject: "Shift handover submitted — {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>A shift handover was submitted at <strong>{{restaurant}}</strong>.</p><p>{{summaryHtml}}</p>`,
    variables: ["name", "restaurant", "summaryHtml"], category: "transactional" },
  { key: "onboarding_workspace_created", name: "Workspace created", event: "onboarding.workspace_created",
    subject: "Your {{appName}} workspace is ready",
    body: `<p>Hi {{name}},</p><p>Your workspace for <strong>{{restaurant}}</strong> is set up. Let's get your first menu, QR code, and order in.</p>`,
    variables: ["name", "restaurant", "appName", "appUrl"], category: "lifecycle" },
  { key: "onboarding_first_menu", name: "First menu added", event: "onboarding.first_menu",
    subject: "First menu added — great start!",
    body: `<p>Hi {{name}},</p><p>You just added your first menu items. Next up: generate a QR code for table ordering.</p>`,
    variables: ["name", "restaurant"], category: "lifecycle" },
  { key: "onboarding_first_qr", name: "First QR generated", event: "onboarding.first_qr",
    subject: "Your first QR code is ready",
    body: `<p>Hi {{name}},</p><p>Your first QR code is generated for <strong>{{restaurant}}</strong>. Print it and put it on a table to take your first order.</p>`,
    variables: ["name", "restaurant", "qrUrl"], category: "lifecycle" },
  { key: "onboarding_first_order", name: "First order placed", event: "onboarding.first_order",
    subject: "🎉 You received your first order!",
    body: `<p>Hi {{name}},</p><p>Congrats — <strong>{{restaurant}}</strong> just received its first order. Welcome to the family!</p>`,
    variables: ["name", "restaurant"], category: "lifecycle" },
  { key: "onboarding_first_payment", name: "First payment received", event: "onboarding.first_payment",
    subject: "Your first payment has landed",
    body: `<p>Hi {{name}},</p><p>You received your first payment on {{appName}}. Online payments are now active for <strong>{{restaurant}}</strong>.</p>`,
    variables: ["name", "restaurant", "appName"], category: "lifecycle" },
  { key: "onboarding_incomplete_reminder", name: "Finish your setup", event: "onboarding.incomplete",
    subject: "Finish setting up {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>You're almost done — just <strong>{{remainingSteps}}</strong> step(s) left to start taking orders on <strong>{{restaurant}}</strong>.</p>`,
    variables: ["name", "restaurant", "remainingSteps", "setupUrl"], category: "lifecycle" },
  { key: "maintenance_window", name: "Maintenance window", event: "platform.maintenance",
    subject: "Scheduled maintenance on {{appName}} — {{windowLabel}}",
    body: `<p>Hi {{name}},</p><p>{{appName}} will be undergoing scheduled maintenance during <strong>{{windowLabel}}</strong>. Some features may be temporarily unavailable.</p>`,
    variables: ["name", "appName", "windowLabel"], category: "lifecycle" },
  { key: "super_admin_announcement", name: "Platform announcement", event: "platform.announcement",
    subject: "{{title}}",
    body: `<p>Hi {{name}},</p><p>{{message}}</p>`,
    variables: ["name", "title", "message", "appName"], category: "lifecycle" },
  { key: "sla_breach", name: "SLA breach alert", event: "support.sla_breach",
    subject: "SLA breached on ticket #{{ticketId}}",
    body: `<p>Hi {{name}},</p><p>Ticket <strong>#{{ticketId}}</strong> ({{subjectLine}}) has breached its <strong>{{slaName}}</strong> SLA by <strong>{{overdueLabel}}</strong>.</p>`,
    variables: ["name", "ticketId", "subjectLine", "slaName", "overdueLabel", "ticketUrl"], category: "transactional" },
  { key: "provider_error_alert", name: "Provider error alert", event: "platform.provider_error",
    subject: "{{providerName}} provider error on {{appName}}",
    body: `<p>Hi {{name}},</p><p>The provider <strong>{{providerName}}</strong> ({{providerKind}}) failed: {{errorMessage}}. Please review the configuration in Super Admin.</p>`,
    variables: ["name", "providerName", "providerKind", "errorMessage", "appName"], category: "transactional" },
  { key: "support_ticket_resolved", name: "Support ticket resolved", event: "support.ticket_resolved",
    subject: "Ticket #{{ticketId}} resolved",
    body: `<p>Hi {{name}},</p><p>Ticket <strong>#{{ticketId}}</strong> has been marked as resolved. If anything still isn't right, just reply to this email to reopen.</p>`,
    variables: ["name", "ticketId", "subjectLine", "ticketUrl"], category: "transactional" },
  { key: "reservation_confirmed", name: "Reservation confirmed", event: "reservation.confirmed",
    subject: "Reservation confirmed at {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>Your reservation for <strong>{{guests}}</strong> guests on <strong>{{date}}</strong> at <strong>{{time}}</strong> is confirmed.</p>`,
    variables: ["name", "restaurant", "date", "time", "guests"], category: "transactional" },
  { key: "reservation_reminder", name: "Reservation reminder", event: "reservation.reminder",
    subject: "Reminder: reservation at {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>A friendly reminder of your reservation for <strong>{{guests}}</strong> guests at <strong>{{restaurant}}</strong> on <strong>{{date}}</strong> at <strong>{{time}}</strong>.</p>`,
    variables: ["name", "restaurant", "date", "time", "guests"], category: "transactional" },
  { key: "customer_feedback_request", name: "Customer feedback request", event: "customer.feedback_request",
    subject: "How was your visit to {{restaurant}}?",
    body: `<p>Hi {{name}},</p><p>Thanks for stopping by! We'd love a quick line about your experience.</p>`,
    variables: ["name", "restaurant", "feedbackUrl"], category: "lifecycle" },
  { key: "customer_festival_offer", name: "Festival offer", event: "customer.festival_offer",
    subject: "🎉 {{festivalName}} offer from {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>To celebrate <strong>{{festivalName}}</strong>, we're offering <strong>{{offer}}</strong> at {{restaurant}}. See you soon!</p>`,
    variables: ["name", "festivalName", "offer", "restaurant"], category: "marketing" },
  { key: "customer_coupon_issued", name: "Coupon issued", event: "customer.coupon_issued",
    subject: "Here's a coupon from {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>Use code <strong>{{couponCode}}</strong> to get <strong>{{offer}}</strong> at {{restaurant}}. Valid until <strong>{{expiresAt}}</strong>.</p>`,
    variables: ["name", "couponCode", "offer", "restaurant", "expiresAt"], category: "marketing" },
  { key: "customer_membership_activated", name: "Membership activated", event: "customer.membership_activated",
    subject: "Welcome to {{membershipName}} at {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>Your <strong>{{membershipName}}</strong> membership at <strong>{{restaurant}}</strong> is now active. Enjoy your perks!</p>`,
    variables: ["name", "membershipName", "restaurant"], category: "marketing" },
  { key: "tiffin_subscription_confirmed", name: "Tiffin subscription confirmed", event: "tiffin.subscribed",
    subject: "Tiffin plan confirmed at {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>Your <strong>{{planName}}</strong> tiffin plan is confirmed. Deliveries start on <strong>{{startsOn}}</strong>.</p>`,
    variables: ["name", "planName", "startsOn", "restaurant"], category: "transactional" },
  { key: "catering_quote_sent", name: "Catering quote sent", event: "catering.quote_sent",
    subject: "Catering quote from {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>Here's your catering quote for <strong>{{eventName}}</strong> on <strong>{{eventDate}}</strong>: <strong>{{currency}} {{amount}}</strong>.</p>`,
    variables: ["name", "eventName", "eventDate", "currency", "amount", "restaurant", "quoteUrl"], category: "transactional" },
  { key: "event_booking_confirmed", name: "Event booking confirmed", event: "event.booking_confirmed",
    subject: "Your event booking is confirmed",
    body: `<p>Hi {{name}},</p><p>Your booking for <strong>{{eventName}}</strong> on <strong>{{eventDate}}</strong> at <strong>{{restaurant}}</strong> is confirmed.</p>`,
    variables: ["name", "eventName", "eventDate", "restaurant"], category: "transactional" },
  { key: "refund_confirmation", name: "Refund confirmation (customer)", event: "customer.refund",
    subject: "Refund processed — {{currency}} {{amount}}",
    body: `<p>Hi {{name}},</p><p>A refund of <strong>{{currency}} {{amount}}</strong> for order #{{orderNumber}} has been processed. It may take 5–10 business days to reflect.</p>`,
    variables: ["name", "currency", "amount", "orderNumber"], category: "transactional" },
  { key: "service_apology", name: "Service apology", event: "customer.apology",
    subject: "We're sorry — let's make it right",
    body: `<p>Hi {{name}},</p><p>We're really sorry about your recent experience at <strong>{{restaurant}}</strong>. {{message}}</p>`,
    variables: ["name", "restaurant", "message"], category: "lifecycle" },
  { key: "customer_review_invitation", name: "Customer review invitation", event: "customer.review_invitation",
    subject: "Leave a quick review for {{restaurant}}",
    body: `<p>Hi {{name}},</p><p>Hope you enjoyed your visit. A quick review really helps small kitchens like ours.</p>`,
    variables: ["name", "restaurant", "reviewUrl"], category: "lifecycle" },
  { key: "mobile_verification", name: "Mobile verification", event: "auth.mobile_verification",
    subject: "Your verification code: {{otp}}",
    body: `<p>Hi {{name}},</p><p>Your verification code is <strong>{{otp}}</strong>. It expires in <strong>{{ttlMinutes}}</strong> minutes.</p>`,
    variables: ["name", "otp", "ttlMinutes"], category: "transactional" },
  { key: "po_auto_draft", name: "PO auto-drafted", event: "inventory.po_auto_draft",
    subject: "{{poCount}} draft purchase order(s) created",
    body: `<p>Hi {{name}},</p><p><strong>{{poCount}}</strong> draft purchase order(s) were created from low-stock items at <strong>{{restaurant}}</strong>. {{summaryHtml}}</p>`,
    variables: ["name", "poCount", "restaurant", "summaryHtml", "posUrl"], category: "transactional" },
  { key: "daily_summary_owner", name: "Owner morning briefing", event: "ops.morning_briefing",
    subject: "Morning briefing — {{restaurant}} ({{forDate}})",
    body: `<p>Hi {{name}},</p><p>Here's your briefing for <strong>{{restaurant}}</strong> on <strong>{{forDate}}</strong>.</p><p>{{summaryHtml}}</p>`,
    variables: ["name", "restaurant", "forDate", "summaryHtml"], category: "lifecycle" },
  { key: "platform_internal_notification", name: "Internal notification", event: "platform.internal_notification",
    subject: "{{title}}",
    body: `<p>{{message}}</p>`,
    variables: ["title", "message"], category: "transactional" },
  // ─── Task #546: Canonical key aliases required by Super Admin → Email Center ───
  { key: "signup_verification_otp", name: "Signup verification OTP", event: "auth.signup_verification",
    subject: "Verify your {{appName}} signup — code {{otp}}",
    preheader: "Use this one-time code to finish creating your account.",
    body: `<p>Hi {{name}},</p><p>Welcome to {{appName}}! Use code <strong>{{otp}}</strong> to verify your email and finish signing up. It expires in <strong>{{ttlMinutes}}</strong> minutes.</p>`,
    plainText: "Hi {{name}},\n\nUse code {{otp}} to verify your {{appName}} signup. The code expires in {{ttlMinutes}} minutes.",
    variables: ["name", "otp", "ttlMinutes", "appName"], category: "transactional" },
  { key: "login_otp", name: "Login OTP", event: "auth.login_otp",
    subject: "Your {{appName}} login code: {{otp}}",
    preheader: "Use this one-time code to sign in.",
    body: `<p>Hi {{name}},</p><p>Your one-time login code is <strong>{{otp}}</strong>. It expires in <strong>{{ttlMinutes}}</strong> minutes. Don't share this code with anyone.</p>`,
    plainText: "Hi {{name}},\n\nYour {{appName}} login code is {{otp}}. It expires in {{ttlMinutes}} minutes. Do not share this code.",
    variables: ["name", "otp", "ttlMinutes", "appName"], category: "transactional" },
  { key: "two_factor_otp", name: "Two-factor authentication OTP", event: "auth.two_factor_otp",
    subject: "Your {{appName}} 2FA code: {{otp}}",
    preheader: "Use this code to confirm two-factor authentication.",
    body: `<p>Hi {{name}},</p><p>Your two-factor authentication code is <strong>{{otp}}</strong>. It expires in <strong>{{ttlMinutes}}</strong> minutes.</p>`,
    plainText: "Hi {{name}},\n\nYour {{appName}} 2FA code is {{otp}}. It expires in {{ttlMinutes}} minutes.",
    variables: ["name", "otp", "ttlMinutes", "appName"], category: "transactional" },
  { key: "password_reset_otp", name: "Password reset OTP", event: "auth.password_reset_otp",
    subject: "Reset your {{appName}} password — code {{otp}}",
    preheader: "Use this one-time code to reset your password.",
    body: `<p>Hi {{name}},</p><p>Use code <strong>{{otp}}</strong> to reset your {{appName}} password. The code expires in <strong>{{ttlMinutes}}</strong> minutes. If you didn't request this, ignore this email.</p>`,
    plainText: "Hi {{name}},\n\nUse code {{otp}} to reset your {{appName}} password. The code expires in {{ttlMinutes}} minutes.",
    variables: ["name", "otp", "ttlMinutes", "appName"], category: "transactional" },
  { key: "restaurant_welcome", name: "Restaurant welcome", event: "tenant.welcome",
    subject: "Welcome to {{appName}}, {{name}}!",
    preheader: "Your restaurant workspace is ready.",
    body: `<p>Hi {{name}},</p><p>Welcome to <strong>{{appName}}</strong> — your restaurant <strong>{{restaurant}}</strong> is set up and ready to take orders.</p><p>Sign in any time at <a href="{{appUrl}}">{{appUrl}}</a>.</p><p>— The {{appName}} team</p>`,
    plainText: "Hi {{name}},\n\nWelcome to {{appName}}. Your restaurant {{restaurant}} is ready. Sign in at {{appUrl}}.",
    variables: ["name", "restaurant", "appName", "appUrl"], category: "lifecycle" },
  { key: "trial_ending_soon", name: "Trial ending soon", event: "subscription.trial_ending_soon",
    subject: "Your {{appName}} trial ends in {{daysLeft}} days",
    preheader: "Upgrade to keep your data and continue using {{appName}}.",
    body: `<p>Hi {{name}},</p><p>Your free trial ends on <strong>{{trialEndsAt}}</strong> — that's just <strong>{{daysLeft}}</strong> days away. Upgrade to keep your menu, orders, and customers active.</p><p><a href="{{upgradeUrl}}">Choose a plan</a></p>`,
    plainText: "Hi {{name}},\n\nYour {{appName}} trial ends on {{trialEndsAt}} ({{daysLeft}} days). Upgrade at {{upgradeUrl}}.",
    variables: ["name", "daysLeft", "trialEndsAt", "appName", "upgradeUrl"], category: "lifecycle" },
  { key: "plan_activated", name: "Plan activated", event: "subscription.plan_activated",
    subject: "Your {{plan}} plan is active",
    preheader: "Your subscription is live — here's what's included.",
    body: `<p>Hi {{name}},</p><p>Your subscription to the <strong>{{plan}}</strong> plan is now active. Your next renewal is on <strong>{{renewsAt}}</strong>.</p>`,
    plainText: "Hi {{name}},\n\nYour {{plan}} plan on {{appName}} is active. Renews on {{renewsAt}}.",
    variables: ["name", "plan", "renewsAt", "appName"], category: "transactional" },
  { key: "plan_upgraded", name: "Plan upgraded", event: "subscription.plan_upgraded",
    subject: "You upgraded to {{plan}}",
    preheader: "New limits and features are now available.",
    body: `<p>Hi {{name}},</p><p>Your plan has been upgraded from <strong>{{oldPlan}}</strong> to <strong>{{plan}}</strong>. New limits and features are available immediately.</p>`,
    plainText: "Hi {{name}},\n\nYour plan was upgraded from {{oldPlan}} to {{plan}}.",
    variables: ["name", "oldPlan", "plan"], category: "transactional" },
  { key: "staff_invite", name: "Staff invite", event: "tenant.staff_invited",
    subject: "You're invited to join {{restaurant}} on {{appName}}",
    preheader: "{{inviterName}} added you as {{role}}.",
    body: `<p>Hi {{name}},</p><p>{{inviterName}} invited you to join <strong>{{restaurant}}</strong> as <strong>{{role}}</strong>.</p><p><a href="{{acceptUrl}}">Accept invitation</a></p>`,
    plainText: "Hi {{name}},\n\n{{inviterName}} invited you to join {{restaurant}} as {{role}}. Accept: {{acceptUrl}}",
    variables: ["name", "inviterName", "restaurant", "role", "acceptUrl", "appName"], category: "transactional" },
  { key: "review_request", name: "Review request", event: "customer.review_request",
    subject: "How was your meal at {{restaurant}}?",
    preheader: "A quick review really helps our small kitchen.",
    body: `<p>Hi {{name}},</p><p>Thanks for ordering with us! Would you mind leaving a quick review? <a href="{{reviewUrl}}">Leave a review</a>.</p>`,
    plainText: "Hi {{name}},\n\nThanks for ordering from {{restaurant}}. Leave a review: {{reviewUrl}}",
    variables: ["name", "restaurant", "reviewUrl"], category: "lifecycle" },
  { key: "birthday_offer", name: "Birthday offer", event: "customer.birthday_offer",
    subject: "Happy birthday from {{restaurant}}!",
    preheader: "A little gift from us to you.",
    body: `<p>Hi {{name}},</p><p>Happy birthday from all of us at <strong>{{restaurant}}</strong>! Enjoy <strong>{{offer}}</strong> on us — show this email when you visit.</p>`,
    plainText: "Hi {{name}},\n\nHappy birthday from {{restaurant}}! Enjoy {{offer}} on us.",
    variables: ["name", "restaurant", "offer"], category: "marketing" },
  { key: "win_back_offer", name: "Win-back offer", event: "customer.win_back_offer",
    subject: "We've missed you at {{restaurant}}",
    preheader: "Come back this week for a little something extra.",
    body: `<p>Hi {{name}},</p><p>It's been a while since your last visit. Come back this week and enjoy <strong>{{offer}}</strong>.</p>`,
    plainText: "Hi {{name}},\n\nWe miss you at {{restaurant}}. Come back this week for {{offer}}.",
    variables: ["name", "restaurant", "offer"], category: "marketing" },
];

// Apply the shared premium layout to every default template body so that even
// older keys (whose body is a plain <p>) render with the KhanaLagao card.
// We only re-wrap bodies that don't already carry the premium marker — custom
// HTML created by Super Admin is left untouched at render time.
for (const t of DEFAULT_TEMPLATES) {
  if (hasPremiumLayout(t.body)) continue;
  const cta = t.body.match(/<a\s+href="(\{\{\s*[\w.]+\s*\}\})"[^>]*>([^<]+)<\/a>/);
  t.body = premiumLayout({
    preheader: t.subject,
    heading: t.subject,
    bodyHtml: t.body,
    ctaLabel: cta?.[2],
    ctaUrl: cta?.[1],
  });
}

export async function seedDefaultEmailTemplates(): Promise<void> {
  // Insert any new default keys.
  const existing = await db.select({
    id: emailTemplatesTable.id,
    key: emailTemplatesTable.key,
    body: emailTemplatesTable.body,
    isDefault: emailTemplatesTable.isDefault,
    updatedBy: emailTemplatesTable.updatedBy,
  }).from(emailTemplatesTable);
  const byKey = new Map(existing.map(r => [r.key, r]));
  const missing = DEFAULT_TEMPLATES.filter(t => !byKey.has(t.key));
  if (missing.length > 0) {
    await db.insert(emailTemplatesTable).values(missing.map(t => ({
      key: t.key, name: t.name, event: t.event,
      subject: t.subject, body: t.body, variables: t.variables,
      category: t.category ?? "transactional",
      preheader: t.preheader ?? "",
      plainText: t.plainText ?? htmlToText(t.body),
      scope: "platform", status: "approved",
      isEnabled: true, isDefault: true, isHidden: false,
    })));
    logger.info({ count: missing.length }, "Seeded default email templates");
  }
  // Upgrade default-managed templates whose body is either:
  //   (a) plain pre-premium markup (no marker), or
  //   (b) wrapped with a previous version of the premium layout
  //       (data-tt-premium="1", etc.) — so existing installs pick up the
  //       latest design (logo, footer, social, support row) automatically.
  // We *only* touch rows that have never been edited by a Super Admin
  // (updatedBy IS NULL) so customised content typed in the Email Center
  // is preserved on every server restart — `isDefault=true` alone isn't
  // enough to prove the body is still the seeded default. isDefault=false
  // rows are also left alone.
  const toUpgrade = DEFAULT_TEMPLATES
    .map(t => ({ t, row: byKey.get(t.key) }))
    .filter(({ row }) => row && row.isDefault && row.updatedBy == null && !hasCurrentPremiumLayout(row.body ?? ""));
  for (const { t, row } of toUpgrade) {
    if (!row) continue;
    await db.update(emailTemplatesTable)
      .set({ body: t.body, subject: t.subject, variables: t.variables, updatedAt: new Date() })
      .where(eq(emailTemplatesTable.id, row.id));
  }
  if (toUpgrade.length > 0) {
    logger.info({ count: toUpgrade.length }, "Upgraded default email templates to premium layout");
  }
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
