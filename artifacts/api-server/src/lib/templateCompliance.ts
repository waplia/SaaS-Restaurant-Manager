/**
 * Compliance checker for Email + WhatsApp templates (Task #533).
 *
 * Returns a list of issues with severity. Used by:
 *   - the admin "Compliance" tab (to surface warnings before submit)
 *   - the WhatsApp template submission endpoint (errors block submission)
 *   - the email template save endpoint (warnings only).
 *
 * Rules are intentionally conservative; we err on the side of warning rather
 * than blocking so editors are not surprised by Meta's actual review.
 */

import { VARIABLE_INDEX, extractPlaceholders } from "./templateVariables";

export type ComplianceSeverity = "error" | "warning" | "info";

export interface ComplianceIssue {
  severity: ComplianceSeverity;
  code: string;
  message: string;
  field?: string;
}

export interface WhatsAppTemplateForCompliance {
  name?: string | null;
  language?: string | null;
  category?: string | null;
  headerType?: string | null;
  headerText?: string | null;
  headerMediaUrl?: string | null;
  bodyText?: string | null;
  footerText?: string | null;
  buttonsJson?: Array<Record<string, unknown>> | null;
  variablesJson?: Array<Record<string, unknown>> | null;
  sampleValuesJson?: Record<string, unknown> | null;
}

const META_NAME_RE = /^[a-z0-9_]{1,512}$/;
const META_CATEGORIES = new Set(["MARKETING", "UTILITY", "AUTHENTICATION"]);
const META_BUTTON_LIMIT = 10;
const META_BODY_MAX = 1024;
const META_HEADER_TEXT_MAX = 60;
const META_FOOTER_MAX = 60;
const URL_RE = /^https?:\/\/\S+$/i;

export function checkWhatsAppTemplate(t: WhatsAppTemplateForCompliance): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];

  // ── Name ─────────────────────────────────────────────────────
  const name = (t.name ?? "").trim();
  if (!name) issues.push({ severity: "error", code: "name_required", message: "Template name is required.", field: "name" });
  else if (!META_NAME_RE.test(name)) issues.push({
    severity: "error", code: "name_invalid",
    message: "Meta requires names to be lowercase with letters, numbers and underscores only (max 512 chars).",
    field: "name",
  });

  // ── Category ─────────────────────────────────────────────────
  const cat = (t.category ?? "").toUpperCase();
  if (!cat) issues.push({ severity: "error", code: "category_required", message: "Template category is required.", field: "category" });
  else if (!META_CATEGORIES.has(cat)) issues.push({
    severity: "error", code: "category_invalid",
    message: "Category must be MARKETING, UTILITY or AUTHENTICATION.",
    field: "category",
  });

  // ── Language ─────────────────────────────────────────────────
  if (!t.language) issues.push({
    severity: "warning", code: "language_missing",
    message: "Language not set; defaulting to en. Set it explicitly if other locales are needed.",
    field: "language",
  });

  // ── Body ─────────────────────────────────────────────────────
  const body = (t.bodyText ?? "").trim();
  if (!body) issues.push({ severity: "error", code: "body_required", message: "Body text is required.", field: "bodyText" });
  if (body.length > META_BODY_MAX) issues.push({
    severity: "error", code: "body_too_long",
    message: `Body exceeds ${META_BODY_MAX} characters (current ${body.length}).`,
    field: "bodyText",
  });

  // Placeholders must be sequential {{1}}, {{2}}, … for Meta acceptance.
  const placeholders = extractPlaceholders(body);
  const numeric = placeholders.filter(p => /^\d+$/.test(p)).map(Number).sort((a, b) => a - b);
  const named = placeholders.filter(p => !/^\d+$/.test(p));
  for (const n of named) {
    if (!VARIABLE_INDEX[n]) issues.push({
      severity: "warning", code: "unknown_variable",
      message: `Unknown variable {{${n}}}. Add it to the variable mapping or remove it.`,
      field: "bodyText",
    });
  }
  if (numeric.length > 0) {
    const expected = Array.from({ length: numeric.length }, (_, i) => i + 1);
    if (numeric.some((v, i) => v !== expected[i])) {
      issues.push({
        severity: "error", code: "placeholders_non_sequential",
        message: "Body placeholders must be sequential starting at {{1}} (e.g. {{1}}, {{2}}, {{3}}).",
        field: "bodyText",
      });
    }
  }

  // Variable mapping coverage.
  const mapping = Array.isArray(t.variablesJson) ? t.variablesJson : [];
  const mappingIndexes = new Set(mapping.map(v => Number(v.index)).filter(n => Number.isFinite(n)));
  for (const idx of numeric) {
    if (!mappingIndexes.has(idx)) issues.push({
      severity: "warning", code: "variable_unmapped",
      message: `Placeholder {{${idx}}} is not mapped to a variable. Add a mapping for accurate previews.`,
      field: "variables",
    });
  }

  // ── Header ───────────────────────────────────────────────────
  const headerType = (t.headerType ?? "none").toLowerCase();
  if (!["none", "text", "image", "video", "document"].includes(headerType)) issues.push({
    severity: "error", code: "header_type_invalid",
    message: "Header type must be one of none, text, image, video, document.",
    field: "headerType",
  });
  if (headerType === "text") {
    const ht = t.headerText ?? "";
    if (!ht.trim()) issues.push({ severity: "error", code: "header_text_required", message: "Header text is required.", field: "headerText" });
    if (ht.length > META_HEADER_TEXT_MAX) issues.push({
      severity: "error", code: "header_text_too_long",
      message: `Header text exceeds ${META_HEADER_TEXT_MAX} characters.`,
      field: "headerText",
    });
    const hp = extractPlaceholders(ht).filter(p => /^\d+$/.test(p));
    if (hp.length > 1) issues.push({
      severity: "error", code: "header_placeholders_too_many",
      message: "Header text supports at most one {{1}} placeholder.",
      field: "headerText",
    });
  }
  if (["image", "video", "document"].includes(headerType)) {
    if (!t.headerMediaUrl || !URL_RE.test(t.headerMediaUrl)) issues.push({
      severity: "error", code: "header_media_url_required",
      message: "A sample media URL (https://) is required for media headers.",
      field: "headerMediaUrl",
    });
  }

  // ── Footer ───────────────────────────────────────────────────
  if (t.footerText && t.footerText.length > META_FOOTER_MAX) issues.push({
    severity: "error", code: "footer_too_long",
    message: `Footer exceeds ${META_FOOTER_MAX} characters.`,
    field: "footerText",
  });
  if (t.footerText && extractPlaceholders(t.footerText).length > 0) issues.push({
    severity: "error", code: "footer_no_variables",
    message: "Footer text cannot contain {{variables}}.",
    field: "footerText",
  });

  // ── Buttons ──────────────────────────────────────────────────
  const buttons = Array.isArray(t.buttonsJson) ? t.buttonsJson : [];
  if (buttons.length > META_BUTTON_LIMIT) issues.push({
    severity: "error", code: "buttons_too_many",
    message: `Meta allows at most ${META_BUTTON_LIMIT} buttons.`,
    field: "buttons",
  });
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    const type = String(b?.type ?? "");
    const text = String(b?.text ?? "").trim();
    if (!text) issues.push({ severity: "error", code: "button_text_required", message: `Button #${i + 1} is missing text.`, field: "buttons" });
    if (text.length > 25) issues.push({ severity: "error", code: "button_text_too_long", message: `Button #${i + 1} text exceeds 25 characters.`, field: "buttons" });
    if (!["quick_reply", "url", "phone_number", "copy_code"].includes(type)) issues.push({
      severity: "error", code: "button_type_invalid",
      message: `Button #${i + 1} has invalid type "${type}". Use quick_reply, url, phone_number, or copy_code.`,
      field: "buttons",
    });
    if (type === "url" && (!b?.url || !URL_RE.test(String(b.url)))) issues.push({
      severity: "error", code: "button_url_invalid",
      message: `Button #${i + 1} requires a valid https:// URL.`,
      field: "buttons",
    });
    if (type === "phone_number" && !b?.phone) issues.push({
      severity: "error", code: "button_phone_required",
      message: `Button #${i + 1} requires a phone number in E.164 format.`,
      field: "buttons",
    });
  }

  // ── Sample-value coverage (mandatory before submit) ──────────
  const samples = (t.sampleValuesJson ?? {}) as Record<string, unknown> & { body?: unknown[]; header?: unknown[] };
  const bodySamples = Array.isArray(samples.body) ? samples.body as unknown[] : [];
  for (const idx of numeric) {
    const has = (mapping.find(v => Number(v.index) === idx)?.example as string | undefined);
    const hasBodySample = bodySamples[idx - 1] != null && String(bodySamples[idx - 1]).trim() !== "";
    if (!has && !hasBodySample) issues.push({
      severity: "error", code: "sample_value_required",
      message: `Sample value for {{${idx}}} is required for Meta submission.`,
      field: "sampleValuesJson",
    });
  }
  if (headerType === "text") {
    const hp = extractPlaceholders(t.headerText ?? "").filter(p => /^\d+$/.test(p));
    if (hp.length > 0) {
      const headerSamples = Array.isArray(samples.header) ? samples.header as unknown[] : [];
      if (headerSamples.length === 0 || !String(headerSamples[0] ?? "").trim()) issues.push({
        severity: "error", code: "header_sample_required",
        message: "Header sample value is required when the header uses {{1}}.",
        field: "sampleValuesJson",
      });
    }
  }

  // ── Marketing-category rules ─────────────────────────────────
  if (cat === "MARKETING") {
    if (/\b(otp|verification|verify|verification code)\b/i.test(body)) issues.push({
      severity: "error", code: "marketing_auth_keywords",
      message: "MARKETING templates cannot contain OTP/verification language. Use AUTHENTICATION instead.",
      field: "bodyText",
    });
    // Opt-out / STOP language requirement for promotional sends.
    const hasOptOutText = /\b(stop|unsubscribe|opt[- ]?out|reply\s+stop)\b/i.test(body)
      || /\b(stop|unsubscribe|opt[- ]?out)\b/i.test(t.footerText ?? "");
    const hasOptOutButton = buttons.some(b => String(b?.type) === "quick_reply"
      && /\b(stop|unsubscribe|opt[- ]?out)\b/i.test(String(b?.text ?? "")));
    if (!hasOptOutText && !hasOptOutButton) issues.push({
      severity: "error", code: "marketing_opt_out_required",
      message: "MARKETING templates must include an opt-out (e.g. \"Reply STOP to unsubscribe\") in body, footer, or as a quick-reply button.",
      field: "bodyText",
    });
  }

  // ── Utility-category rules ───────────────────────────────────
  if (cat === "UTILITY") {
    const PROMO_PATTERNS = [
      /\b(?:\d{1,3}\s*%\s*off)\b/i,
      /\b(off your next|special offer|limited[- ]time|sale|deal|discount|coupon|promo|promo code)\b/i,
      /\b(buy[- ]one[- ]get[- ]one|bogo|flash sale)\b/i,
    ];
    if (PROMO_PATTERNS.some(p => p.test(body) || p.test(t.headerText ?? "") || p.test(t.footerText ?? ""))) {
      issues.push({
        severity: "error", code: "utility_promo_language",
        message: "UTILITY templates cannot contain promotional language (discounts, offers, sales, coupons). Use MARKETING instead.",
        field: "bodyText",
      });
    }
  }

  // ── Authentication-category rules ────────────────────────────
  if (cat === "AUTHENTICATION") {
    if (!/\{\{1\}\}/.test(body)) issues.push({
      severity: "error", code: "auth_missing_code_placeholder",
      message: "AUTHENTICATION templates must include a {{1}} placeholder for the verification code.",
      field: "bodyText",
    });
    // AUTH templates must look like security/OTP content only.
    const AUTH_TOPIC = /\b(code|otp|verification|verify|password|sign[- ]?in|login|2fa|two[- ]?factor|security)\b/i;
    if (!AUTH_TOPIC.test(body)) issues.push({
      severity: "error", code: "auth_non_security_content",
      message: "AUTHENTICATION templates must contain only OTP/verification/security content.",
      field: "bodyText",
    });
    const PROMO_IN_AUTH = /\b(off|offer|discount|sale|coupon|promo|deal)\b/i;
    if (PROMO_IN_AUTH.test(body)) issues.push({
      severity: "error", code: "auth_promo_content",
      message: "AUTHENTICATION templates cannot contain promotional content.",
      field: "bodyText",
    });
  }

  return issues;
}

export interface EmailTemplateForCompliance {
  subject?: string | null;
  body?: string | null;
  variables?: string[] | null;
  category?: string | null;
}

export function checkEmailTemplate(t: EmailTemplateForCompliance): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const subject = (t.subject ?? "").trim();
  const body = (t.body ?? "").trim();

  if (!subject) issues.push({ severity: "error", code: "subject_required", message: "Subject is required.", field: "subject" });
  else if (subject.length > 998) issues.push({ severity: "error", code: "subject_too_long", message: "Subject exceeds RFC limit (998 chars).", field: "subject" });

  if (!body) issues.push({ severity: "error", code: "body_required", message: "Body is required.", field: "body" });
  if (body && !/<\/?[a-z][\s\S]*>/i.test(body)) issues.push({
    severity: "info", code: "body_plain_text",
    message: "Body looks like plain text; HTML version recommended for better rendering.",
    field: "body",
  });

  for (const placeholder of [...extractPlaceholders(subject), ...extractPlaceholders(body)]) {
    if (!VARIABLE_INDEX[placeholder] && !(t.variables ?? []).includes(placeholder)) {
      issues.push({
        severity: "warning", code: "unknown_variable",
        message: `Unknown variable {{${placeholder}}}. Add it to the variables array or remove it.`,
      });
    }
  }

  // Common spam-trigger heuristics (advisory only).
  const SPAM_WORDS = ["free!!!", "act now", "guaranteed", "100% free", "click here now", "winner", "buy now"];
  for (const w of SPAM_WORDS) {
    if (subject.toLowerCase().includes(w) || body.toLowerCase().includes(w)) {
      issues.push({
        severity: "warning", code: "spam_trigger",
        message: `Phrase "${w}" can trigger spam filters.`,
      });
    }
  }

  return issues;
}

export function complianceSummary(issues: ComplianceIssue[]): { errors: number; warnings: number; infos: number; canSubmit: boolean } {
  let errors = 0, warnings = 0, infos = 0;
  for (const i of issues) {
    if (i.severity === "error") errors++;
    else if (i.severity === "warning") warnings++;
    else infos++;
  }
  return { errors, warnings, infos, canSubmit: errors === 0 };
}
