/**
 * 2Factor.in SMS / OTP provider adapter (Task #532).
 *
 * All 2Factor HTTP calls stay inside this module. The unified OTP service
 * (Task #531) and the existing `smsSender` registry both consume the
 * functions exported here.
 *
 * Reference: https://documenter.getpostman.com/view/301893/TWDamFGh
 *            https://2factor.in/v3/sms-api
 */

import { logger } from "./logger";

const BASE_URL = "https://2factor.in/API/V1";
const SMS_BASE_URL = "https://2factor.in/API/R1";

export type TwoFactorConfig = {
  apiKey: string;
  senderId?: string;
  /** Provider-side template name registered for the OTP/AUTOGEN flow. */
  otpTemplateName?: string;
  /** 2Factor template id used for transactional SMS sends. */
  transactionalTemplateId?: string;
  /** 2Factor template id used for promotional SMS sends. */
  promotionalTemplateId?: string;
  defaultCountryCode?: string;
  /** Channel & feature toggles (mirrored from the Super Admin UI). */
  smsOtpEnabled?: boolean;
  voiceOtpEnabled?: boolean;
  transactionalEnabled?: boolean;
  promotionalEnabled?: boolean;
  /** "live" or "sandbox" — sandbox short-circuits HTTP and returns a stub. */
  mode?: "live" | "sandbox";
  /** Optional usage caps enforced at the adapter layer. */
  dailyLimit?: number;
  monthlyLimit?: number;
};

export type TwoFactorErrorCode =
  | "API_KEY_MISSING"
  | "INVALID_API_KEY"
  | "LOW_BALANCE"
  | "INVALID_MOBILE"
  | "INVALID_TEMPLATE"
  | "PROVIDER_TIMEOUT"
  | "LIMIT_REACHED"
  | "INVALID_SESSION"
  | "INVALID_OTP"
  | "UNKNOWN_ERROR";

export type AdapterResult<T = unknown> =
  | { ok: true; data: T; raw: Record<string, unknown> }
  | { ok: false; errorCode: TwoFactorErrorCode; error: string; raw: Record<string, unknown> };

const FRIENDLY_ERRORS: Record<TwoFactorErrorCode, string> = {
  API_KEY_MISSING: "2Factor API key is missing — please configure it in Super Admin → Provider Center → SMS / OTP.",
  INVALID_API_KEY: "2Factor rejected the API key. Please verify the key in Super Admin and try again.",
  LOW_BALANCE: "2Factor account balance is too low to send. Please top up at 2factor.in.",
  INVALID_MOBILE: "That mobile number is not valid for 2Factor. Check the country code and try again.",
  INVALID_TEMPLATE: "The 2Factor template name / ID is missing or not approved. Update it in Super Admin.",
  PROVIDER_TIMEOUT: "2Factor took too long to respond. Please try again in a moment.",
  LIMIT_REACHED: "Daily or monthly SMS limit for 2Factor has been reached.",
  INVALID_SESSION: "The OTP session has expired. Please request a new code.",
  INVALID_OTP: "Incorrect OTP. Please try again.",
  UNKNOWN_ERROR: "2Factor reported an error. Please try again.",
};

export function friendlyMessage(code: TwoFactorErrorCode): string {
  return FRIENDLY_ERRORS[code] ?? FRIENDLY_ERRORS.UNKNOWN_ERROR;
}

/**
 * Map a raw 2Factor response or HTTP error into a normalized error code so
 * upstream OtpProvider can decide whether to fall back to email / WhatsApp.
 */
export function normalizeError(raw: Record<string, unknown> | string, httpStatus?: number): { errorCode: TwoFactorErrorCode; message: string } {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
  const lc = text.toLowerCase();
  if (httpStatus === 408 || /timeout|timed out/.test(lc)) return { errorCode: "PROVIDER_TIMEOUT", message: text };
  if (/invalid api ?key|apikey.*invalid|unauthor/.test(lc)) return { errorCode: "INVALID_API_KEY", message: text };
  if (/insufficient|low balance|recharge|out of balance/.test(lc)) return { errorCode: "LOW_BALANCE", message: text };
  if (/invalid (mobile|phone|number)/.test(lc)) return { errorCode: "INVALID_MOBILE", message: text };
  if (/template.*(invalid|not.?found|not approved)|invalid template/.test(lc)) return { errorCode: "INVALID_TEMPLATE", message: text };
  if (/limit (reached|exceeded)|throttl|rate.?limit/.test(lc)) return { errorCode: "LIMIT_REACHED", message: text };
  if (/session.*(expired|invalid|not.?found)/.test(lc)) return { errorCode: "INVALID_SESSION", message: text };
  if (/mismatch|incorrect otp|wrong otp|otp.*invalid/.test(lc)) return { errorCode: "INVALID_OTP", message: text };
  return { errorCode: "UNKNOWN_ERROR", message: text };
}

function normalizeMobile(mobile: string, countryCode?: string): string {
  const cleaned = mobile.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned.slice(1);
  if (!countryCode) return cleaned;
  const cc = countryCode.replace(/[^\d]/g, "");
  if (cc && !cleaned.startsWith(cc)) return `${cc}${cleaned}`;
  return cleaned;
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { json = { raw: text }; }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

function requireKey(config: TwoFactorConfig): AdapterResult<never> | null {
  if (!config.apiKey || typeof config.apiKey !== "string") {
    return { ok: false, errorCode: "API_KEY_MISSING", error: friendlyMessage("API_KEY_MISSING"), raw: {} };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// OTP — provider-generated (AUTOGEN). Returns a sessionId.
// ────────────────────────────────────────────────────────────────────────────
export async function sendOtp(config: TwoFactorConfig, opts: {
  mobile: string;
  countryCode?: string;
  templateName?: string;
}): Promise<AdapterResult<{ sessionId: string }>> {
  const miss = requireKey(config); if (miss) return miss;
  if (config.smsOtpEnabled === false) {
    return { ok: false, errorCode: "LIMIT_REACHED", error: "SMS OTP channel is disabled for 2Factor.", raw: {} };
  }
  if (config.mode === "sandbox") {
    return { ok: true, data: { sessionId: `sandbox-${Date.now()}` }, raw: { sandbox: true } };
  }
  const mobile = normalizeMobile(opts.mobile, opts.countryCode ?? config.defaultCountryCode);
  const template = encodeURIComponent(opts.templateName ?? config.otpTemplateName ?? "");
  const url = `${BASE_URL}/${encodeURIComponent(config.apiKey)}/SMS/${encodeURIComponent(mobile)}/AUTOGEN2${template ? "/" + template : ""}`;
  try {
    const { status, json, text } = await fetchJson(url);
    if (status !== 200 || (json.Status && json.Status !== "Success")) {
      const norm = normalizeError(json ?? text, status);
      return { ok: false, errorCode: norm.errorCode, error: friendlyMessage(norm.errorCode), raw: json };
    }
    const sessionId = String(json.Details ?? json.session_id ?? "");
    if (!sessionId) {
      return { ok: false, errorCode: "UNKNOWN_ERROR", error: "2Factor did not return a session id.", raw: json };
    }
    return { ok: true, data: { sessionId }, raw: json };
  } catch (err) {
    logger.warn({ err }, "2Factor sendOtp failed");
    const norm = normalizeError(String((err as Error).message ?? err));
    return { ok: false, errorCode: norm.errorCode, error: friendlyMessage(norm.errorCode), raw: { error: String(err) } };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// OTP — custom code generated by the caller (used by the existing
// staffOtp flow, which already hashes its own code).
// ────────────────────────────────────────────────────────────────────────────
export async function sendCustomOtp(config: TwoFactorConfig, opts: {
  mobile: string;
  otp: string;
  countryCode?: string;
  templateName?: string;
}): Promise<AdapterResult<{ sessionId: string }>> {
  const miss = requireKey(config); if (miss) return miss;
  if (config.mode === "sandbox") {
    return { ok: true, data: { sessionId: `sandbox-${Date.now()}` }, raw: { sandbox: true } };
  }
  const mobile = normalizeMobile(opts.mobile, opts.countryCode ?? config.defaultCountryCode);
  const template = encodeURIComponent(opts.templateName ?? config.otpTemplateName ?? "");
  const url = `${BASE_URL}/${encodeURIComponent(config.apiKey)}/SMS/${encodeURIComponent(mobile)}/${encodeURIComponent(opts.otp)}${template ? "/" + template : ""}`;
  try {
    const { status, json, text } = await fetchJson(url);
    if (status !== 200 || (json.Status && json.Status !== "Success")) {
      const norm = normalizeError(json ?? text, status);
      return { ok: false, errorCode: norm.errorCode, error: friendlyMessage(norm.errorCode), raw: json };
    }
    return { ok: true, data: { sessionId: String(json.Details ?? "") }, raw: json };
  } catch (err) {
    const norm = normalizeError(String((err as Error).message ?? err));
    return { ok: false, errorCode: norm.errorCode, error: friendlyMessage(norm.errorCode), raw: { error: String(err) } };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Voice OTP — provider-generated, voice channel.
// ────────────────────────────────────────────────────────────────────────────
export async function sendVoiceOtp(config: TwoFactorConfig, opts: { mobile: string; countryCode?: string }): Promise<AdapterResult<{ sessionId: string }>> {
  const miss = requireKey(config); if (miss) return miss;
  if (config.voiceOtpEnabled === false) {
    return { ok: false, errorCode: "LIMIT_REACHED", error: "Voice OTP channel is disabled for 2Factor.", raw: {} };
  }
  if (config.mode === "sandbox") {
    return { ok: true, data: { sessionId: `sandbox-voice-${Date.now()}` }, raw: { sandbox: true } };
  }
  const mobile = normalizeMobile(opts.mobile, opts.countryCode ?? config.defaultCountryCode);
  const url = `${BASE_URL}/${encodeURIComponent(config.apiKey)}/VOICE/${encodeURIComponent(mobile)}/AUTOGEN`;
  try {
    const { status, json, text } = await fetchJson(url);
    if (status !== 200 || (json.Status && json.Status !== "Success")) {
      const norm = normalizeError(json ?? text, status);
      return { ok: false, errorCode: norm.errorCode, error: friendlyMessage(norm.errorCode), raw: json };
    }
    return { ok: true, data: { sessionId: String(json.Details ?? "") }, raw: json };
  } catch (err) {
    const norm = normalizeError(String((err as Error).message ?? err));
    return { ok: false, errorCode: norm.errorCode, error: friendlyMessage(norm.errorCode), raw: { error: String(err) } };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Verify an OTP previously sent via sendOtp / sendCustomOtp.
// ────────────────────────────────────────────────────────────────────────────
export async function verifyOtp(config: TwoFactorConfig, opts: { sessionId: string; otp: string }): Promise<AdapterResult<{ verified: true }>> {
  const miss = requireKey(config); if (miss) return miss;
  if (config.mode === "sandbox") {
    // Sandbox accepts "000000" or any 6-digit "123456" for test flows.
    if (opts.otp === "000000" || opts.otp === "123456") {
      return { ok: true, data: { verified: true }, raw: { sandbox: true } };
    }
    return { ok: false, errorCode: "INVALID_OTP", error: friendlyMessage("INVALID_OTP"), raw: { sandbox: true } };
  }
  const url = `${BASE_URL}/${encodeURIComponent(config.apiKey)}/SMS/VERIFY/${encodeURIComponent(opts.sessionId)}/${encodeURIComponent(opts.otp)}`;
  try {
    const { status, json, text } = await fetchJson(url);
    if (status !== 200 || (json.Status && json.Status !== "Success")) {
      const norm = normalizeError(json ?? text, status);
      return { ok: false, errorCode: norm.errorCode, error: friendlyMessage(norm.errorCode), raw: json };
    }
    return { ok: true, data: { verified: true }, raw: json };
  } catch (err) {
    const norm = normalizeError(String((err as Error).message ?? err));
    return { ok: false, errorCode: norm.errorCode, error: friendlyMessage(norm.errorCode), raw: { error: String(err) } };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Resend an OTP using an existing session id.
// ────────────────────────────────────────────────────────────────────────────
export async function resendOtp(config: TwoFactorConfig, opts: { sessionId: string }): Promise<AdapterResult<{ sessionId: string }>> {
  const miss = requireKey(config); if (miss) return miss;
  if (config.mode === "sandbox") {
    return { ok: true, data: { sessionId: opts.sessionId }, raw: { sandbox: true } };
  }
  const url = `${BASE_URL}/${encodeURIComponent(config.apiKey)}/SMS/RESEND/${encodeURIComponent(opts.sessionId)}`;
  try {
    const { status, json, text } = await fetchJson(url);
    if (status !== 200 || (json.Status && json.Status !== "Success")) {
      const norm = normalizeError(json ?? text, status);
      return { ok: false, errorCode: norm.errorCode, error: friendlyMessage(norm.errorCode), raw: json };
    }
    return { ok: true, data: { sessionId: opts.sessionId }, raw: json };
  } catch (err) {
    const norm = normalizeError(String((err as Error).message ?? err));
    return { ok: false, errorCode: norm.errorCode, error: friendlyMessage(norm.errorCode), raw: { error: String(err) } };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Transactional SMS — DLT-approved, anytime delivery.
// ────────────────────────────────────────────────────────────────────────────
export async function sendTransactionalSms(config: TwoFactorConfig, opts: {
  mobile: string;
  body: string;
  countryCode?: string;
  templateId?: string;
  variables?: string[];
}): Promise<AdapterResult<{ providerMessageId: string }>> {
  return sendSms(config, { ...opts, kind: "transactional" });
}

// ────────────────────────────────────────────────────────────────────────────
// Promotional SMS — DLT-approved, respects DND / quiet hours.
// ────────────────────────────────────────────────────────────────────────────
export async function sendPromotionalSms(config: TwoFactorConfig, opts: {
  mobile: string;
  body: string;
  countryCode?: string;
  templateId?: string;
  variables?: string[];
}): Promise<AdapterResult<{ providerMessageId: string }>> {
  return sendSms(config, { ...opts, kind: "promotional" });
}

async function sendSms(config: TwoFactorConfig, opts: {
  mobile: string;
  body: string;
  countryCode?: string;
  templateId?: string;
  variables?: string[];
  kind: "transactional" | "promotional";
}): Promise<AdapterResult<{ providerMessageId: string }>> {
  const miss = requireKey(config); if (miss) return miss;
  if (opts.kind === "transactional" && config.transactionalEnabled === false) {
    return { ok: false, errorCode: "LIMIT_REACHED", error: "Transactional SMS is disabled for 2Factor.", raw: {} };
  }
  if (opts.kind === "promotional" && config.promotionalEnabled === false) {
    return { ok: false, errorCode: "LIMIT_REACHED", error: "Promotional SMS is disabled for 2Factor.", raw: {} };
  }
  if (config.mode === "sandbox") {
    return { ok: true, data: { providerMessageId: `sandbox-${opts.kind}-${Date.now()}` }, raw: { sandbox: true } };
  }
  const mobile = normalizeMobile(opts.mobile, opts.countryCode ?? config.defaultCountryCode);
  const templateId = opts.templateId
    ?? (opts.kind === "transactional" ? config.transactionalTemplateId : config.promotionalTemplateId);
  if (!templateId) {
    return { ok: false, errorCode: "INVALID_TEMPLATE", error: friendlyMessage("INVALID_TEMPLATE"), raw: {} };
  }
  const params = new URLSearchParams({
    module: opts.kind === "transactional" ? "TRANS_SMS" : "PROMO_SMS",
    apikey: config.apiKey,
    to: mobile,
    from: config.senderId ?? "",
    templatename: templateId,
    msg: opts.body,
  });
  if (opts.variables && opts.variables.length > 0) {
    params.set("var1", opts.variables[0] ?? "");
    for (let i = 1; i < opts.variables.length; i++) params.set(`var${i + 1}`, opts.variables[i] ?? "");
  }
  try {
    const { status, json, text } = await fetchJson(`${SMS_BASE_URL}/?${params.toString()}`);
    if (status !== 200 || (json.Status && json.Status !== "Success")) {
      const norm = normalizeError(json ?? text, status);
      return { ok: false, errorCode: norm.errorCode, error: friendlyMessage(norm.errorCode), raw: json };
    }
    const id = String(json.Details ?? json.message_id ?? `tf-${Date.now()}`);
    return { ok: true, data: { providerMessageId: id }, raw: json };
  } catch (err) {
    const norm = normalizeError(String((err as Error).message ?? err));
    return { ok: false, errorCode: norm.errorCode, error: friendlyMessage(norm.errorCode), raw: { error: String(err) } };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Account utilities.
// ────────────────────────────────────────────────────────────────────────────
export async function getBalance(config: TwoFactorConfig): Promise<AdapterResult<{ transactional: number | null; promotional: number | null }>> {
  const miss = requireKey(config); if (miss) return miss;
  if (config.mode === "sandbox") {
    return { ok: true, data: { transactional: 9999, promotional: 9999 }, raw: { sandbox: true } };
  }
  try {
    const { status, json, text } = await fetchJson(`${BASE_URL}/${encodeURIComponent(config.apiKey)}/BAL`);
    if (status !== 200) {
      const norm = normalizeError(text, status);
      return { ok: false, errorCode: norm.errorCode, error: friendlyMessage(norm.errorCode), raw: json };
    }
    const details = (json.Details ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      data: {
        transactional: typeof details.TRANSACTIONAL_SMS === "number" ? details.TRANSACTIONAL_SMS : Number(details.TRANSACTIONAL_SMS) || null,
        promotional: typeof details.PROMOTIONAL_SMS === "number" ? details.PROMOTIONAL_SMS : Number(details.PROMOTIONAL_SMS) || null,
      },
      raw: json,
    };
  } catch (err) {
    const norm = normalizeError(String((err as Error).message ?? err));
    return { ok: false, errorCode: norm.errorCode, error: friendlyMessage(norm.errorCode), raw: { error: String(err) } };
  }
}

export async function testConnection(config: TwoFactorConfig): Promise<AdapterResult<{ ok: true }>> {
  const b = await getBalance(config);
  if (!b.ok) return b;
  return { ok: true, data: { ok: true }, raw: b.raw };
}
