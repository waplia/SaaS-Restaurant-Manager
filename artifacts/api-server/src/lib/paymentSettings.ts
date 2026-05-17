import { eq } from "drizzle-orm";
import { db, paymentMethodSettingsTable } from "./db";
import { envCashfreeConfig, type CashfreeConfig } from "./cashfree";
import type { RazorpayConfig } from "./razorpay";

export type ProviderKey = "cashfree" | "razorpay" | "bank" | "upi";

export interface PaymentMethodRow {
  provider: ProviderKey;
  isEnabled: boolean;
  isDefault: boolean;
  config: Record<string, unknown>;
  updatedAt: string | null;
}

export interface BankConfig {
  bankName?: string;
  accountHolder?: string;
  accountNumber?: string;
  ifsc?: string;
  branch?: string;
  instructions?: string;
}

export interface UpiConfig {
  upiId?: string;
  payeeName?: string;
  qrUrl?: string;
}

// Sample manual-payment details shown to tenants when the super-admin hasn't
// configured Bank / UPI yet. Lets tenants still pick a method and submit a
// manual request so onboarding never dead-ends. The `_placeholder` marker is
// removed automatically the first time an admin edits the row (see
// upsertProvider below) so the "Sample details" notice disappears.
export const DEFAULT_BANK_CONFIG: BankConfig & { _placeholder?: boolean } = {
  bankName: "HDFC Bank",
  accountHolder: "KhanaLagao Demo Pvt Ltd",
  accountNumber: "00000000000000",
  ifsc: "HDFC0000000",
  branch: "Bengaluru — Demo Branch",
  instructions: "Please add your tenant ID in the transfer narration so we can match the payment quickly.",
  _placeholder: true,
};

export const DEFAULT_UPI_CONFIG: UpiConfig & { _placeholder?: boolean } = {
  upiId: "khanalagao-demo@upi",
  payeeName: "KhanaLagao Demo",
  // Generated via a public QR endpoint so we don't need a bundled image asset.
  qrUrl: "https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=" +
    encodeURIComponent("upi://pay?pa=khanalagao-demo@upi&pn=KhanaLagao%20Demo"),
  _placeholder: true,
};

const SECRET_FIELDS: Record<ProviderKey, string[]> = {
  cashfree: ["secretKey"],
  razorpay: ["keySecret", "webhookSecret"],
  bank: [],
  upi: [],
};

export function maskSecret(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

export function maskConfig(provider: ProviderKey, config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const k of SECRET_FIELDS[provider]) {
    if (out[k]) out[k] = maskSecret(out[k]);
  }
  return out;
}

export async function getProviderRow(provider: ProviderKey): Promise<PaymentMethodRow | null> {
  const [row] = await db.select().from(paymentMethodSettingsTable).where(eq(paymentMethodSettingsTable.provider, provider));
  if (!row) return null;
  return {
    provider: row.provider as ProviderKey,
    isEnabled: row.isEnabled,
    isDefault: row.isDefault,
    config: row.config ?? {},
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export async function listProviderRows(): Promise<PaymentMethodRow[]> {
  const rows = await db.select().from(paymentMethodSettingsTable);
  return (rows as Array<{ provider: string; isEnabled: boolean; isDefault: boolean; config: Record<string, unknown> | null; updatedAt: Date | null }>).map(r => ({
    provider: r.provider as ProviderKey,
    isEnabled: r.isEnabled,
    isDefault: r.isDefault,
    config: r.config ?? {},
    updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
  }));
}

export async function getEffectiveCashfreeConfig(): Promise<{ enabled: boolean; config: CashfreeConfig | null; isDefault: boolean }> {
  const row = await getProviderRow("cashfree");
  const env = envCashfreeConfig();
  // DB row wins. Otherwise, fall back to env so legacy tenants keep working.
  if (row) {
    const cfg = row.config as { appId?: string; secretKey?: string; env?: string };
    if (cfg.appId && cfg.secretKey) {
      return { enabled: row.isEnabled, isDefault: row.isDefault, config: { appId: cfg.appId, secretKey: cfg.secretKey, env: (cfg.env ?? "sandbox").toLowerCase() } };
    }
    return { enabled: row.isEnabled && !!env, isDefault: row.isDefault, config: env };
  }
  return { enabled: !!env, isDefault: !!env, config: env };
}

export async function getEffectiveRazorpayConfig(): Promise<{ enabled: boolean; config: RazorpayConfig | null; isDefault: boolean }> {
  const row = await getProviderRow("razorpay");
  if (!row) return { enabled: false, isDefault: false, config: null };
  const cfg = row.config as { keyId?: string; keySecret?: string; webhookSecret?: string };
  if (!cfg.keyId || !cfg.keySecret) return { enabled: false, isDefault: row.isDefault, config: null };
  return {
    enabled: row.isEnabled,
    isDefault: row.isDefault,
    config: { keyId: cfg.keyId, keySecret: cfg.keySecret, webhookSecret: cfg.webhookSecret },
  };
}

export async function getEnabledManualMethods(): Promise<{
  bank: { enabled: boolean; isPlaceholder: boolean; config: BankConfig };
  upi: { enabled: boolean; isPlaceholder: boolean; config: UpiConfig };
}> {
  const [bankRow, upiRow] = await Promise.all([getProviderRow("bank"), getProviderRow("upi")]);

  // Bank: if no row exists yet, surface the placeholder defaults so the tenant
  // can still pick the method and submit a manual request.
  let bank: { enabled: boolean; isPlaceholder: boolean; config: BankConfig };
  if (!bankRow) {
    bank = { enabled: true, isPlaceholder: true, config: stripPlaceholderFlag(DEFAULT_BANK_CONFIG) };
  } else {
    const cfg = (bankRow.config ?? {}) as BankConfig & { _placeholder?: boolean };
    bank = { enabled: bankRow.isEnabled, isPlaceholder: cfg._placeholder === true, config: stripPlaceholderFlag(cfg) };
  }

  let upi: { enabled: boolean; isPlaceholder: boolean; config: UpiConfig };
  if (!upiRow) {
    upi = { enabled: true, isPlaceholder: true, config: stripPlaceholderFlag(DEFAULT_UPI_CONFIG) };
  } else {
    const cfg = (upiRow.config ?? {}) as UpiConfig & { _placeholder?: boolean };
    upi = { enabled: upiRow.isEnabled, isPlaceholder: cfg._placeholder === true, config: stripPlaceholderFlag(cfg) };
  }

  return { bank, upi };
}

function stripPlaceholderFlag<T extends { _placeholder?: boolean }>(c: T): Omit<T, "_placeholder"> {
  const { _placeholder: _drop, ...rest } = c;
  return rest;
}

/**
 * Seed the bank/UPI rows once at startup with placeholder defaults so the
 * super-admin can edit them directly in Admin → Payment methods, and so the
 * tenant checkout drawer always has something to display. Idempotent.
 */
export async function seedDefaultManualMethods(): Promise<void> {
  const [bankRow, upiRow] = await Promise.all([getProviderRow("bank"), getProviderRow("upi")]);
  if (!bankRow) {
    await db.insert(paymentMethodSettingsTable).values({
      provider: "bank",
      isEnabled: true,
      isDefault: false,
      config: DEFAULT_BANK_CONFIG as Record<string, unknown>,
    });
  }
  if (!upiRow) {
    await db.insert(paymentMethodSettingsTable).values({
      provider: "upi",
      isEnabled: true,
      isDefault: false,
      config: DEFAULT_UPI_CONFIG as Record<string, unknown>,
    });
  }
}

/**
 * Upsert a provider row. Secret fields that come in masked (••••xxxx)
 * are preserved from the existing row instead of being overwritten with the mask.
 */
export async function upsertProvider(
  provider: ProviderKey,
  body: { isEnabled?: boolean; isDefault?: boolean; config?: Record<string, unknown> },
  userId: number | undefined,
): Promise<PaymentMethodRow> {
  const existing = await getProviderRow(provider);
  const incomingConfig = body.config ?? {};
  const merged: Record<string, unknown> = { ...(existing?.config ?? {}), ...incomingConfig };
  for (const k of SECRET_FIELDS[provider]) {
    const v = incomingConfig[k];
    if (typeof v === "string" && v.startsWith("••••")) {
      // Masked sentinel — keep the previously stored secret as-is.
      merged[k] = (existing?.config ?? {})[k];
    }
  }
  // The first time an admin saves real config for a manual method, drop the
  // placeholder marker so the tenant UI stops showing the "Sample details"
  // notice.
  if ((provider === "bank" || provider === "upi") && body.config) {
    delete (merged as Record<string, unknown>)._placeholder;
  }

  const isEnabled = body.isEnabled ?? existing?.isEnabled ?? false;
  const isDefault = body.isDefault ?? existing?.isDefault ?? false;

  if (existing) {
    await db.update(paymentMethodSettingsTable)
      .set({ isEnabled, isDefault, config: merged, updatedBy: userId, updatedAt: new Date() })
      .where(eq(paymentMethodSettingsTable.provider, provider));
  } else {
    await db.insert(paymentMethodSettingsTable).values({
      provider, isEnabled, isDefault, config: merged, updatedBy: userId,
    });
  }

  // Default provider is exclusive between online providers (cashfree/razorpay).
  if ((provider === "cashfree" || provider === "razorpay") && isDefault) {
    const other = provider === "cashfree" ? "razorpay" : "cashfree";
    await db.update(paymentMethodSettingsTable)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(paymentMethodSettingsTable.provider, other));
  }

  return (await getProviderRow(provider))!;
}
