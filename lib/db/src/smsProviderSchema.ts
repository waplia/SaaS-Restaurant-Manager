/**
 * Per-provider configuration field schema for SMS providers.
 *
 * Single source of truth shared by:
 *  - the super-admin "Add / Edit provider" form (drives the rendered inputs)
 *  - the API server (drives create / update validation)
 *
 * Keeping both sides on the same descriptor guarantees the UI and the
 * validator can never disagree about which fields are required or what
 * shape they take.
 *
 * The on-disk JSON shape stored in `sms_providers.config` is unchanged —
 * the dispatcher in `smsSender.ts` keeps reading the same keys.
 */

export type SmsProviderTypeKey =
  | "twilio"
  | "msg91"
  | "textlocal"
  | "fast2sms"
  | "gupshup"
  | "2factor"
  | "custom";

export type SmsProviderFieldKind =
  | "text"      // plain single-line input
  | "secret"    // password input with show/hide toggle, masked on read
  | "number"    // numeric input
  | "boolean"   // switch
  | "select"    // dropdown from `options`
  | "textarea"  // multi-line text (e.g. JSON headers, body templates)
  | "url";      // URL input, validated as http(s)://…

export type SmsProviderField = {
  key: string;
  label: string;
  kind: SmsProviderFieldKind;
  required?: boolean;
  helper?: string;
  placeholder?: string;
  defaultValue?: string | number | boolean;
  options?: { value: string; label: string }[];
  /** Optional min/max for number inputs. */
  min?: number;
  max?: number;
};

export type SmsProviderSchema = {
  type: SmsProviderTypeKey;
  label: string;
  /** Short blurb under the provider-type select. */
  description?: string;
  fields: SmsProviderField[];
};

const TWILIO: SmsProviderSchema = {
  type: "twilio",
  label: "Twilio",
  description: "International SMS via Twilio. Find credentials in the Twilio Console.",
  fields: [
    { key: "accountSid", label: "Account SID", kind: "text", required: true,
      helper: "Twilio Console → Account → API credentials. Starts with AC…",
      placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
    { key: "authToken", label: "Auth Token", kind: "secret", required: true,
      helper: "Twilio Console → Account → API credentials. Treat like a password." },
    { key: "senderId", label: "Sender (From number / Messaging Service SID)", kind: "text", required: true,
      helper: "An E.164 number you own (+1415…) or a Messaging Service SID (MG…).",
      placeholder: "+15555550100" },
  ],
};

const MSG91: SmsProviderSchema = {
  type: "msg91",
  label: "MSG91 (India / DLT)",
  description: "India-first SMS via MSG91 Flow. Requires DLT-approved templates.",
  fields: [
    { key: "authKey", label: "Auth Key", kind: "secret", required: true,
      helper: "MSG91 Dashboard → Settings → API keys." },
    { key: "senderId", label: "Sender ID", kind: "text", required: true,
      helper: "Your DLT-registered 6-character sender ID, e.g. KHANAL.",
      placeholder: "KHANAL" },
    { key: "route", label: "Route", kind: "select", required: true, defaultValue: "4",
      helper: "MSG91 route. Use 4 for transactional DLT SMS in India.",
      options: [
        { value: "4", label: "4 — Transactional (DLT)" },
        { value: "1", label: "1 — Promotional" },
      ] },
    { key: "countryCode", label: "Default country code", kind: "text", defaultValue: "91",
      helper: "Numeric only, no '+'. Used when a recipient is supplied without a country code.",
      placeholder: "91" },
    { key: "entityId", label: "DLT Entity / Principal Entity ID (optional)", kind: "text",
      helper: "Falls back to the template's DLT ID if blank." },
  ],
};

const TEXTLOCAL: SmsProviderSchema = {
  type: "textlocal",
  label: "Textlocal",
  fields: [
    { key: "apiKey", label: "API Key", kind: "secret", required: true,
      helper: "Textlocal Dashboard → Settings → API keys." },
    { key: "senderId", label: "Sender ID", kind: "text", required: true, defaultValue: "TXTLCL",
      helper: "6-character sender ID approved on your Textlocal account.",
      placeholder: "TXTLCL" },
  ],
};

const FAST2SMS: SmsProviderSchema = {
  type: "fast2sms",
  label: "Fast2SMS",
  fields: [
    { key: "apiKey", label: "API Authorization Key", kind: "secret", required: true,
      helper: "Fast2SMS Dashboard → Dev API → Authorization key." },
    { key: "route", label: "Route", kind: "select", required: true, defaultValue: "q",
      options: [
        { value: "q", label: "q — Quick (no DLT)" },
        { value: "dlt", label: "dlt — DLT approved" },
        { value: "otp", label: "otp — OTP route" },
      ] },
    { key: "senderId", label: "Sender ID", kind: "text",
      helper: "Required for the DLT route. 6-character DLT-registered ID." },
  ],
};

const GUPSHUP: SmsProviderSchema = {
  type: "gupshup",
  label: "Gupshup Enterprise",
  fields: [
    { key: "userId", label: "User ID", kind: "text", required: true,
      helper: "Gupshup Enterprise account login / userid." },
    { key: "apiKey", label: "Password / API Key", kind: "secret", required: true,
      helper: "Gupshup Enterprise account password or API key." },
    { key: "senderId", label: "Sender ID", kind: "text",
      helper: "Optional. Defaults to your account userid when blank." },
  ],
};

const TWOFACTOR: SmsProviderSchema = {
  type: "2factor",
  label: "2Factor.in (India / DLT)",
  description: "India-first OTP + transactional SMS with verify-by-session OTPs.",
  fields: [
    { key: "apiKey", label: "API Key", kind: "secret", required: true,
      helper: "2Factor Dashboard → Account → API key (UUID)." },
    { key: "senderId", label: "Sender ID", kind: "text",
      helper: "Optional 6-character DLT-approved sender, e.g. TFCTR.",
      placeholder: "TFCTR" },
    { key: "mode", label: "Mode", kind: "select", required: true, defaultValue: "live",
      helper: "Sandbox short-circuits the HTTP call and accepts 000000 / 123456 as OTP.",
      options: [
        { value: "live", label: "Live" },
        { value: "sandbox", label: "Sandbox (no real SMS)" },
      ] },
    { key: "defaultCountryCode", label: "Default country code", kind: "text", defaultValue: "+91",
      helper: "Prepended to mobile numbers that arrive without a country prefix.",
      placeholder: "+91" },
    { key: "otpTemplateName", label: "OTP template name", kind: "text",
      helper: "2Factor template name registered for the AUTOGEN OTP flow." },
    { key: "transactionalTemplateId", label: "Transactional DLT template ID", kind: "text",
      helper: "DLT content-template ID for transactional sends." },
    { key: "promotionalTemplateId", label: "Promotional DLT template ID", kind: "text",
      helper: "DLT content-template ID for promotional sends." },
    { key: "smsOtpEnabled", label: "Enable SMS OTP channel", kind: "boolean", defaultValue: true },
    { key: "voiceOtpEnabled", label: "Enable Voice OTP channel", kind: "boolean", defaultValue: false },
    { key: "transactionalEnabled", label: "Enable transactional SMS", kind: "boolean", defaultValue: true },
    { key: "promotionalEnabled", label: "Enable promotional SMS", kind: "boolean", defaultValue: true },
    { key: "otpLength", label: "OTP length", kind: "number", defaultValue: 6, min: 4, max: 8 },
    { key: "otpExpiryMinutes", label: "OTP expiry (minutes)", kind: "number", defaultValue: 5, min: 1, max: 60 },
    { key: "resendCooldownSeconds", label: "Resend cooldown (seconds)", kind: "number", defaultValue: 30, min: 0, max: 600 },
    { key: "maxAttempts", label: "Max verify attempts", kind: "number", defaultValue: 5, min: 1, max: 20 },
    { key: "maxResends", label: "Max resends", kind: "number", defaultValue: 3, min: 0, max: 20 },
    { key: "dailyLimit", label: "Daily OTP limit (0 = unlimited)", kind: "number", defaultValue: 0, min: 0 },
    { key: "monthlyLimit", label: "Monthly OTP limit (0 = unlimited)", kind: "number", defaultValue: 0, min: 0 },
  ],
};

const CUSTOM: SmsProviderSchema = {
  type: "custom",
  label: "Custom HTTP",
  description: "Generic webhook-style gateway. Use {{to}} and {{message}} in the body template.",
  fields: [
    { key: "baseUrl", label: "Base URL", kind: "url", required: true,
      helper: "Full URL including scheme. Example: https://gateway.example.com/send",
      placeholder: "https://gateway.example.com/send" },
    { key: "method", label: "HTTP method", kind: "select", required: true, defaultValue: "POST",
      options: [
        { value: "POST", label: "POST" },
        { value: "GET", label: "GET" },
        { value: "PUT", label: "PUT" },
      ] },
    { key: "headers", label: "HTTP headers (JSON object)", kind: "textarea",
      helper: 'Optional JSON map, e.g. {"Authorization": "Bearer xxx"}.',
      placeholder: '{ "Authorization": "Bearer …" }' },
    { key: "bodyTemplate", label: "Body template", kind: "textarea", required: true,
      helper: 'Rendered with {{to}} and {{message}}. Defaults to a JSON envelope if blank.',
      placeholder: '{"to":"{{to}}","message":"{{message}}"}' },
  ],
};

export const SMS_PROVIDER_SCHEMAS: Record<SmsProviderTypeKey, SmsProviderSchema> = {
  twilio: TWILIO,
  msg91: MSG91,
  textlocal: TEXTLOCAL,
  fast2sms: FAST2SMS,
  gupshup: GUPSHUP,
  "2factor": TWOFACTOR,
  custom: CUSTOM,
};

export const SMS_PROVIDER_TYPE_OPTIONS: { value: SmsProviderTypeKey; label: string }[] =
  (Object.values(SMS_PROVIDER_SCHEMAS) as SmsProviderSchema[])
    .map(s => ({ value: s.type, label: s.label }));

export function getSmsProviderSchema(type: string): SmsProviderSchema | null {
  return (SMS_PROVIDER_SCHEMAS as Record<string, SmsProviderSchema>)[type] ?? null;
}

/** Same masking pattern the API uses when echoing back secrets. */
const MASK_PATTERN = /^(\*{2,}|.{0,2}•{2,}.{0,2})$/;
export function isMaskedSmsSecret(v: unknown): boolean {
  return typeof v === "string" && MASK_PATTERN.test(v);
}

export type SmsProviderFieldError = { key: string; message: string };

/**
 * Validate an incoming config patch against the schema.
 *
 * `existing` is the currently-stored config row (when editing). Secret
 * fields are treated as "already satisfied" when the existing record has a
 * non-empty value, even if the incoming patch echoes the mask placeholder
 * or omits the key — this mirrors the merge-on-write behaviour the API
 * already implements so secrets are not wiped during an edit.
 *
 * Fields not declared in the schema are ignored (they pass through into
 * the stored JSON via the Advanced raw-JSON escape hatch).
 */
export function validateSmsProviderConfig(
  type: string,
  config: unknown,
  existing?: Record<string, unknown> | null,
): SmsProviderFieldError[] {
  const schema = getSmsProviderSchema(type);
  if (!schema) return [{ key: "type", message: `Unknown provider type "${type}"` }];

  const errors: SmsProviderFieldError[] = [];
  const cfg = (config && typeof config === "object" && !Array.isArray(config))
    ? (config as Record<string, unknown>) : {};
  const prev = (existing && typeof existing === "object" && !Array.isArray(existing))
    ? (existing as Record<string, unknown>) : {};

  for (const field of schema.fields) {
    const incoming = cfg[field.key];
    const previous = prev[field.key];

    // Required check
    if (field.required) {
      let satisfied = false;
      const incomingIsBlank = incoming === undefined || incoming === null || incoming === "";
      const incomingIsMask = field.kind === "secret" && isMaskedSmsSecret(incoming);
      if (!incomingIsBlank && !incomingIsMask) {
        satisfied = true;
      } else if (field.kind === "secret" && previous !== undefined && previous !== null && previous !== "") {
        // Secret already on file — incoming blank / mask is fine.
        satisfied = true;
      }
      if (!satisfied) {
        errors.push({ key: field.key, message: `${field.label} is required` });
        continue;
      }
    }

    // Skip type-specific validation when nothing was supplied (and not required).
    if (incoming === undefined || incoming === null || incoming === "") continue;

    if (field.kind === "number") {
      const n = typeof incoming === "number" ? incoming : Number(incoming);
      if (!Number.isFinite(n)) {
        errors.push({ key: field.key, message: `${field.label} must be a number` });
        continue;
      }
      if (typeof field.min === "number" && n < field.min) {
        errors.push({ key: field.key, message: `${field.label} must be ≥ ${field.min}` });
      }
      if (typeof field.max === "number" && n > field.max) {
        errors.push({ key: field.key, message: `${field.label} must be ≤ ${field.max}` });
      }
    } else if (field.kind === "boolean") {
      if (typeof incoming !== "boolean") {
        errors.push({ key: field.key, message: `${field.label} must be true or false` });
      }
    } else if (field.kind === "select") {
      const allowed = (field.options ?? []).map(o => o.value);
      if (!allowed.includes(String(incoming))) {
        errors.push({ key: field.key, message: `${field.label} must be one of ${allowed.join(", ")}` });
      }
    } else if (field.kind === "url") {
      const s = String(incoming).trim();
      try {
        const u = new URL(s);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          errors.push({ key: field.key, message: `${field.label} must use http:// or https://` });
        }
      } catch {
        errors.push({ key: field.key, message: `${field.label} must be a valid URL` });
      }
    } else if (field.kind === "textarea" && field.key === "headers") {
      // Optional JSON-object validation for Custom HTTP headers.
      if (typeof incoming === "string" && incoming.trim().length > 0) {
        try {
          const parsed = JSON.parse(incoming);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            errors.push({ key: field.key, message: "HTTP headers must be a JSON object" });
          }
        } catch {
          errors.push({ key: field.key, message: "HTTP headers must be valid JSON" });
        }
      }
    }
  }

  // Provider-specific cross-field validation.
  if (schema.type === "2factor") {
    const channelKeys = [
      "smsOtpEnabled",
      "voiceOtpEnabled",
      "transactionalEnabled",
      "promotionalEnabled",
    ] as const;
    const resolved = (key: string): boolean => {
      if (Object.prototype.hasOwnProperty.call(cfg, key)) return cfg[key] === true;
      if (Object.prototype.hasOwnProperty.call(prev, key)) return prev[key] === true;
      const field = schema.fields.find(f => f.key === key);
      return field?.defaultValue === true;
    };
    const anyEnabled = channelKeys.some(resolved);
    if (!anyEnabled) {
      errors.push({
        key: "smsOtpEnabled",
        message:
          "Enable at least one 2Factor channel (SMS OTP, Voice OTP, Transactional, or Promotional).",
      });
    }
  }

  return errors;
}

/**
 * Build a default form-state object for a new provider by reading the
 * field defaults out of the schema. Used by the UI when the admin first
 * picks a provider type.
 */
export function smsProviderDefaultConfig(type: string): Record<string, unknown> {
  const schema = getSmsProviderSchema(type);
  if (!schema) return {};
  const out: Record<string, unknown> = {};
  for (const field of schema.fields) {
    if (field.defaultValue !== undefined) out[field.key] = field.defaultValue;
  }
  return out;
}
