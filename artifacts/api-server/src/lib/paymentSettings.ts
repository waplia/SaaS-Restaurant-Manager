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

export async function getEnabledManualMethods(): Promise<{ bank: { enabled: boolean; config: BankConfig }; upi: { enabled: boolean; config: UpiConfig } }> {
  const [bankRow, upiRow] = await Promise.all([getProviderRow("bank"), getProviderRow("upi")]);
  return {
    bank: { enabled: !!bankRow?.isEnabled, config: (bankRow?.config ?? {}) as BankConfig },
    upi: { enabled: !!upiRow?.isEnabled, config: (upiRow?.config ?? {}) as UpiConfig },
  };
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
