/**
 * Shared variable registry for Email + WhatsApp templates (Task #533).
 *
 * Each variable has a key, human label, category (so editors can group them),
 * a short description, and an example value used for previews and Meta
 * sample-value submissions. The registry is read-only at runtime and used
 * by:
 *   - the admin "Variables" tab to render a Meta-style sidebar
 *   - the compliance checker (to flag unknown {{vars}})
 *   - the test-send / preview renderer (to substitute examples)
 *   - the email-template-variables registry seeder
 */

export type TemplateVarCategory =
  | "customer"
  | "order"
  | "restaurant"
  | "subscription"
  | "loyalty"
  | "payment"
  | "auth"
  | "marketing"
  | "system";

export interface TemplateVariable {
  key: string;
  label: string;
  category: TemplateVarCategory;
  description: string;
  example: string;
  /** When true, do NOT expose to restaurant editors (super-admin/system only). */
  systemOnly?: boolean;
}

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  // ─── customer ────────────────────────────────────────────────
  { key: "customer_name", label: "Customer name", category: "customer",
    description: "Full name of the customer.", example: "Anita Sharma" },
  { key: "customer_first_name", label: "Customer first name", category: "customer",
    description: "First name only.", example: "Anita" },
  { key: "customer_phone", label: "Customer phone", category: "customer",
    description: "E.164 phone number.", example: "+919876543210" },
  { key: "customer_email", label: "Customer email", category: "customer",
    description: "Customer email.", example: "anita@example.com" },
  { key: "customer_birthday", label: "Customer birthday", category: "customer",
    description: "Birthday in long format.", example: "12 March" },
  { key: "customer_anniversary", label: "Customer anniversary", category: "customer",
    description: "Anniversary date in long format.", example: "5 August" },

  // ─── order ───────────────────────────────────────────────────
  { key: "order_number", label: "Order number", category: "order",
    description: "Display order number / token.", example: "ORD-1042" },
  { key: "order_total", label: "Order total", category: "order",
    description: "Order amount formatted with currency.", example: "₹650" },
  { key: "order_items_count", label: "Order item count", category: "order",
    description: "Number of items in the order.", example: "3" },
  { key: "order_items_summary", label: "Order items summary", category: "order",
    description: "Comma-separated list of items.", example: "Paneer Tikka, Naan, Lassi" },
  { key: "order_eta_minutes", label: "Order ETA (minutes)", category: "order",
    description: "Estimated time of arrival.", example: "25" },
  { key: "order_status", label: "Order status", category: "order",
    description: "Current status label.", example: "Out for delivery" },
  { key: "order_tracking_url", label: "Order tracking URL", category: "order",
    description: "Public tracking link.", example: "https://example.com/t/abc" },

  // ─── restaurant ──────────────────────────────────────────────
  { key: "restaurant_name", label: "Restaurant name", category: "restaurant",
    description: "Outlet display name.", example: "Spice Garden" },
  { key: "restaurant_phone", label: "Restaurant phone", category: "restaurant",
    description: "Outlet phone number.", example: "+919800011223" },
  { key: "restaurant_address", label: "Restaurant address", category: "restaurant",
    description: "Outlet street address.", example: "12 MG Road, Bengaluru" },
  { key: "restaurant_website", label: "Restaurant website", category: "restaurant",
    description: "Public website URL.", example: "https://spicegarden.example" },

  // ─── subscription / billing ──────────────────────────────────
  { key: "plan_name", label: "Plan name", category: "subscription",
    description: "Subscription plan label.", example: "Growth" },
  { key: "plan_amount", label: "Plan amount", category: "subscription",
    description: "Plan price with currency.", example: "₹1,999" },
  { key: "plan_renewal_date", label: "Plan renewal date", category: "subscription",
    description: "Next renewal date.", example: "12 Jun 2026" },
  { key: "plan_access_until", label: "Plan access until", category: "subscription",
    description: "Last date of access.", example: "30 Jun 2026" },
  { key: "invoice_number", label: "Invoice number", category: "payment",
    description: "Invoice display number.", example: "INV-00045" },
  { key: "invoice_amount", label: "Invoice amount", category: "payment",
    description: "Invoice total with currency.", example: "₹1,999" },
  { key: "invoice_due_date", label: "Invoice due date", category: "payment",
    description: "Due date.", example: "20 May 2026" },
  { key: "payment_method", label: "Payment method", category: "payment",
    description: "Last-4 / method summary.", example: "Visa ••••4242" },

  // ─── loyalty ─────────────────────────────────────────────────
  { key: "loyalty_points", label: "Loyalty points", category: "loyalty",
    description: "Current points balance.", example: "1,250" },
  { key: "loyalty_tier", label: "Loyalty tier", category: "loyalty",
    description: "Tier label.", example: "Gold" },
  { key: "loyalty_reward_name", label: "Reward name", category: "loyalty",
    description: "Reward title.", example: "Free dessert" },
  { key: "loyalty_referral_code", label: "Referral code", category: "loyalty",
    description: "Customer's personal referral code.", example: "ANITA50" },

  // ─── auth / OTP ──────────────────────────────────────────────
  { key: "otp_code", label: "OTP code", category: "auth",
    description: "One-time verification code.", example: "846123" },
  { key: "otp_ttl_minutes", label: "OTP TTL (minutes)", category: "auth",
    description: "Minutes until the OTP expires.", example: "10" },
  { key: "login_url", label: "Login URL", category: "auth",
    description: "Magic-link login URL.", example: "https://app.example/login" },
  { key: "verify_url", label: "Verification URL", category: "auth",
    description: "Email/phone verification URL.", example: "https://app.example/verify/xyz" },
  { key: "reset_url", label: "Password reset URL", category: "auth",
    description: "Password reset URL.", example: "https://app.example/reset/xyz" },
  { key: "signin_device", label: "Sign-in device", category: "auth",
    description: "Device summary.", example: "iPhone 15, Safari" },
  { key: "signin_location", label: "Sign-in location", category: "auth",
    description: "Coarse location.", example: "Bengaluru, IN" },

  // ─── marketing ───────────────────────────────────────────────
  { key: "offer_title", label: "Offer title", category: "marketing",
    description: "Headline of the promotion.", example: "Weekend Special" },
  { key: "offer_discount", label: "Offer discount", category: "marketing",
    description: "Discount label.", example: "20% off" },
  { key: "offer_code", label: "Offer code", category: "marketing",
    description: "Coupon code.", example: "WEEKEND20" },
  { key: "offer_expires_on", label: "Offer expiry", category: "marketing",
    description: "Expiry date.", example: "31 May 2026" },
  { key: "campaign_name", label: "Campaign name", category: "marketing",
    description: "Marketing campaign label.", example: "Diwali Bonanza" },

  // ─── system ──────────────────────────────────────────────────
  { key: "app_name", label: "App name", category: "system",
    description: "Product brand name.", example: "Khana Lagao", systemOnly: true },
  { key: "support_email", label: "Support email", category: "system",
    description: "Customer-support email.", example: "support@khanalagao.com", systemOnly: true },
  { key: "support_phone", label: "Support phone", category: "system",
    description: "Customer-support phone.", example: "+918001234567", systemOnly: true },
  { key: "current_year", label: "Current year", category: "system",
    description: "Current calendar year.", example: "2026", systemOnly: true },
];

export const VARIABLE_INDEX: Record<string, TemplateVariable> = Object.fromEntries(
  TEMPLATE_VARIABLES.map(v => [v.key, v]),
);

export function getVariable(key: string): TemplateVariable | null {
  return VARIABLE_INDEX[key] ?? null;
}

export function listVariablesByCategory(): Record<TemplateVarCategory, TemplateVariable[]> {
  const out = {} as Record<TemplateVarCategory, TemplateVariable[]>;
  for (const v of TEMPLATE_VARIABLES) {
    (out[v.category] ??= []).push(v);
  }
  return out;
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Find every {{var}} occurrence in a body and return unique keys (in order). */
export function extractPlaceholders(body: string | null | undefined): string[] {
  if (!body) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(body)) !== null) {
    const k = m[1];
    if (!seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

/** Substitute {{var}} placeholders with values from the supplied dict. */
export function renderPlaceholders(body: string, values: Record<string, string | number | null | undefined>): string {
  return body.replace(PLACEHOLDER_RE, (_, k: string) => {
    const v = values[k];
    return v === null || v === undefined ? `{{${k}}}` : String(v);
  });
}

/** Build a sample-values dict from the variable registry for preview/test. */
export function buildExampleValues(extra?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of TEMPLATE_VARIABLES) out[v.key] = v.example;
  return { ...out, ...(extra ?? {}) };
}

/**
 * Convert a variableMapping (variablesJson) array to a positional list of
 * example values for Meta submission, ordered by index ascending.
 */
export function variablesToPositionalExamples(mapping: Array<Record<string, unknown>>): string[] {
  const sorted = [...mapping].sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
  return sorted.map(v => {
    if (typeof v.example === "string" && v.example.length > 0) return v.example;
    const reg = typeof v.key === "string" ? getVariable(v.key) : null;
    return reg?.example ?? "example";
  });
}
