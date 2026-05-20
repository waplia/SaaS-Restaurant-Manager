/**
 * PhonePe provider configuration service (Task #522).
 *
 * Owns the single super-admin-managed configuration row used by every
 * PhonePe Offline endpoint. Encrypts/decrypts the salt key + callback
 * basic-auth password via aiEncryption, returns masked values to the UI,
 * resolves UAT vs Production base URLs, and exposes a "Test connection"
 * helper that signs a dummy status check against the live endpoint.
 */
import { eq, desc } from "drizzle-orm";
import {
  db,
  phonepeProviderConfigsTable,
  type PhonePeProviderConfigRow,
  type PhonePeEnv,
  type PhonePeSolution,
} from "./db";
import { encryptSecret, decryptSecret, maskSecret } from "./aiEncryption";
import { logger } from "./logger";
import {
  generateStatusXVerify,
  buildGetHeaders,
  generateMerchantTransactionId,
} from "./phonepeSigner";

const UAT_BASE_URL = "https://mercury-uat.phonepe.com";
const PROD_BASE_URL = "https://mercury-t2.phonepe.com";

/** Solutions defined by the PhonePe Offline product family. */
export const PHONEPE_SOLUTIONS: PhonePeSolution[] = [
  "EDC",
  "DYNAMIC_QR",
  "COLLECT",
  "PAYLINK",
  "STATIC_QR",
];

export interface PhonePeRuntimeConfig {
  enabled: boolean;
  env: PhonePeEnv;
  baseUrl: string;
  merchantId: string;
  saltKey: string;
  saltIndex: number;
  callbackUsername: string | null;
  callbackPassword: string | null;
  enabledSolutions: Record<PhonePeSolution, boolean>;
  defaultTimeoutSec: number;
  refundApiEnabled: boolean;
}

export interface PhonePeMaskedConfig {
  id: number | null;
  isEnabled: boolean;
  env: PhonePeEnv;
  merchantId: string | null;
  saltKeyMasked: string | null;
  saltIndex: number;
  callbackUsername: string | null;
  callbackPasswordMasked: string | null;
  defaultTimeoutSec: number;
  enabledSolutions: Record<PhonePeSolution, boolean>;
  uatBaseUrl: string | null;
  prodBaseUrl: string | null;
  refundApiEnabled: boolean;
  configured: boolean;
  updatedAt: string | null;
}

function defaultEnabledSolutions(): Record<PhonePeSolution, boolean> {
  return { EDC: true, DYNAMIC_QR: true, COLLECT: true, PAYLINK: true, STATIC_QR: true };
}

async function getRawRow(): Promise<PhonePeProviderConfigRow | null> {
  const [row] = await db
    .select()
    .from(phonepeProviderConfigsTable)
    .orderBy(desc(phonepeProviderConfigsTable.id))
    .limit(1);
  return row ?? null;
}

export function resolveBaseUrl(row: { env: PhonePeEnv; uatBaseUrl: string | null; prodBaseUrl: string | null }): string {
  if (row.env === "prod") return row.prodBaseUrl || PROD_BASE_URL;
  return row.uatBaseUrl || UAT_BASE_URL;
}

export async function getMaskedConfig(): Promise<PhonePeMaskedConfig> {
  const row = await getRawRow();
  if (!row) {
    return {
      id: null,
      isEnabled: false,
      env: "uat",
      merchantId: null,
      saltKeyMasked: null,
      saltIndex: 1,
      callbackUsername: null,
      callbackPasswordMasked: null,
      defaultTimeoutSec: 120,
      enabledSolutions: defaultEnabledSolutions(),
      uatBaseUrl: null,
      prodBaseUrl: null,
      refundApiEnabled: true,
      configured: false,
      updatedAt: null,
    };
  }
  const saltKeyPlain = decryptSecret({ cipher: row.saltKeyCipher, iv: row.saltKeyIv, tag: row.saltKeyTag });
  const pwdPlain = decryptSecret({ cipher: row.callbackPasswordCipher, iv: row.callbackPasswordIv, tag: row.callbackPasswordTag });
  const merged: Record<PhonePeSolution, boolean> = {
    ...defaultEnabledSolutions(),
    ...(row.enabledSolutions as Record<PhonePeSolution, boolean>),
  };
  return {
    id: row.id,
    isEnabled: row.isEnabled,
    env: row.env,
    merchantId: row.merchantId,
    saltKeyMasked: saltKeyPlain ? maskSecret(saltKeyPlain) : null,
    saltIndex: row.saltIndex,
    callbackUsername: row.callbackUsername,
    callbackPasswordMasked: pwdPlain ? maskSecret(pwdPlain) : null,
    defaultTimeoutSec: row.defaultTimeoutSec,
    enabledSolutions: merged,
    uatBaseUrl: row.uatBaseUrl,
    prodBaseUrl: row.prodBaseUrl,
    refundApiEnabled: row.refundApiEnabled,
    configured: !!(row.merchantId && saltKeyPlain),
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

export async function getRuntimeConfig(): Promise<PhonePeRuntimeConfig | null> {
  const row = await getRawRow();
  if (!row) return null;
  const saltKey = decryptSecret({ cipher: row.saltKeyCipher, iv: row.saltKeyIv, tag: row.saltKeyTag });
  if (!row.merchantId || !saltKey) return null;
  const callbackPassword = decryptSecret({ cipher: row.callbackPasswordCipher, iv: row.callbackPasswordIv, tag: row.callbackPasswordTag });
  const merged: Record<PhonePeSolution, boolean> = {
    ...defaultEnabledSolutions(),
    ...(row.enabledSolutions as Record<PhonePeSolution, boolean>),
  };
  return {
    enabled: row.isEnabled,
    env: row.env,
    baseUrl: resolveBaseUrl(row),
    merchantId: row.merchantId,
    saltKey,
    saltIndex: row.saltIndex,
    callbackUsername: row.callbackUsername,
    callbackPassword,
    enabledSolutions: merged,
    defaultTimeoutSec: row.defaultTimeoutSec,
    refundApiEnabled: row.refundApiEnabled,
  };
}

export interface UpsertConfigInput {
  isEnabled?: boolean;
  env?: PhonePeEnv;
  merchantId?: string | null;
  saltKey?: string | null;
  saltIndex?: number;
  callbackUsername?: string | null;
  callbackPassword?: string | null;
  defaultTimeoutSec?: number;
  enabledSolutions?: Partial<Record<PhonePeSolution, boolean>>;
  uatBaseUrl?: string | null;
  prodBaseUrl?: string | null;
  refundApiEnabled?: boolean;
  updatedBy?: number | null;
}

/** Update or create the single config row. Secrets are encrypted before save.
 *  Masked sentinels (containing "…") are preserved from the existing row. */
export async function upsertConfig(input: UpsertConfigInput): Promise<PhonePeMaskedConfig> {
  const existing = await getRawRow();
  const next: Partial<PhonePeProviderConfigRow> = {};

  if (input.isEnabled !== undefined) next.isEnabled = input.isEnabled;
  if (input.env !== undefined) next.env = input.env;
  if (input.merchantId !== undefined) next.merchantId = input.merchantId;
  if (input.saltIndex !== undefined) next.saltIndex = input.saltIndex;
  if (input.callbackUsername !== undefined) next.callbackUsername = input.callbackUsername;
  if (input.defaultTimeoutSec !== undefined) next.defaultTimeoutSec = input.defaultTimeoutSec;
  if (input.uatBaseUrl !== undefined) next.uatBaseUrl = input.uatBaseUrl;
  if (input.prodBaseUrl !== undefined) next.prodBaseUrl = input.prodBaseUrl;
  if (input.refundApiEnabled !== undefined) next.refundApiEnabled = input.refundApiEnabled;
  if (input.updatedBy !== undefined) next.updatedBy = input.updatedBy;

  if (input.enabledSolutions !== undefined) {
    const merged: Record<string, boolean> = {
      ...defaultEnabledSolutions(),
      ...((existing?.enabledSolutions as Record<string, boolean>) ?? {}),
      ...input.enabledSolutions,
    };
    next.enabledSolutions = merged;
  }

  if (input.saltKey !== undefined && input.saltKey !== null && !input.saltKey.includes("…")) {
    if (input.saltKey === "") {
      next.saltKeyCipher = null;
      next.saltKeyIv = null;
      next.saltKeyTag = null;
    } else {
      const enc = encryptSecret(input.saltKey);
      next.saltKeyCipher = enc.cipher;
      next.saltKeyIv = enc.iv;
      next.saltKeyTag = enc.tag;
    }
  }
  if (input.callbackPassword !== undefined && input.callbackPassword !== null && !input.callbackPassword.includes("…")) {
    if (input.callbackPassword === "") {
      next.callbackPasswordCipher = null;
      next.callbackPasswordIv = null;
      next.callbackPasswordTag = null;
    } else {
      const enc = encryptSecret(input.callbackPassword);
      next.callbackPasswordCipher = enc.cipher;
      next.callbackPasswordIv = enc.iv;
      next.callbackPasswordTag = enc.tag;
    }
  }

  next.updatedAt = new Date();

  if (existing) {
    await db.update(phonepeProviderConfigsTable).set(next).where(eq(phonepeProviderConfigsTable.id, existing.id));
  } else {
    await db.insert(phonepeProviderConfigsTable).values({
      isEnabled: next.isEnabled ?? false,
      env: (next.env ?? "uat") as PhonePeEnv,
      merchantId: next.merchantId ?? null,
      saltIndex: next.saltIndex ?? 1,
      saltKeyCipher: next.saltKeyCipher ?? null,
      saltKeyIv: next.saltKeyIv ?? null,
      saltKeyTag: next.saltKeyTag ?? null,
      callbackUsername: next.callbackUsername ?? null,
      callbackPasswordCipher: next.callbackPasswordCipher ?? null,
      callbackPasswordIv: next.callbackPasswordIv ?? null,
      callbackPasswordTag: next.callbackPasswordTag ?? null,
      defaultTimeoutSec: next.defaultTimeoutSec ?? 120,
      enabledSolutions: (next.enabledSolutions ?? defaultEnabledSolutions()) as Record<string, boolean>,
      uatBaseUrl: next.uatBaseUrl ?? null,
      prodBaseUrl: next.prodBaseUrl ?? null,
      refundApiEnabled: next.refundApiEnabled ?? true,
      updatedBy: next.updatedBy ?? null,
    });
  }
  return getMaskedConfig();
}

/**
 * Ping the PhonePe Status endpoint with a synthetic merchantTransactionId.
 * A 4xx with "Transaction not found" indicates the connection + checksum work;
 * a network/4xx-with-bad-checksum response surfaces a clear error.
 */
export async function testConnection(): Promise<{ ok: boolean; message: string; httpStatus?: number; phonepeCode?: string }> {
  const cfg = await getRuntimeConfig();
  if (!cfg) return { ok: false, message: "PhonePe is not configured. Save merchant ID + salt key first." };
  const fakeTxn = generateMerchantTransactionId("PING");
  const path = `/v3/transaction/${cfg.merchantId}/${fakeTxn}/status`;
  const xv = generateStatusXVerify(path, { saltKey: cfg.saltKey, saltIndex: cfg.saltIndex });
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, { method: "GET", headers: buildGetHeaders({ xVerify: xv, merchantId: cfg.merchantId }) });
    const text = await res.text();
    let parsed: { code?: string; message?: string } | null = null;
    try { parsed = JSON.parse(text); } catch { /* ignore */ }
    // A "TRANSACTION_NOT_FOUND" response proves the salt + merchant + URL are valid.
    if (parsed?.code === "TRANSACTION_NOT_FOUND" || parsed?.code === "PAYMENT_PENDING") {
      return { ok: true, message: "Connection verified. PhonePe accepted the X-VERIFY checksum.", httpStatus: res.status, phonepeCode: parsed.code };
    }
    if (res.ok || res.status === 400 || res.status === 404) {
      return { ok: !!parsed?.code, message: (parsed?.message ?? text.slice(0, 240)) || `HTTP ${res.status}`, httpStatus: res.status, phonepeCode: parsed?.code };
    }
    return { ok: false, message: parsed?.message ?? `Unexpected HTTP ${res.status}`, httpStatus: res.status, phonepeCode: parsed?.code };
  } catch (err) {
    logger.warn({ err }, "PhonePe testConnection failed");
    return { ok: false, message: err instanceof Error ? err.message : "Unknown network error" };
  }
}

/** Human-readable mapping for known PhonePe response codes. */
export const PHONEPE_ERROR_MAP: Record<string, string> = {
  SOLUTION_NOT_ENABLED: "PhonePe says this payment solution is not enabled for the merchant. Ask PhonePe support to enable it on your MID.",
  UNAUTHORIZED: "PhonePe rejected the request as unauthorized. The salt key or merchant ID is wrong.",
  INVALID_REQUEST: "PhonePe could not parse the request payload. Check the amount, transactionId and terminal mapping.",
  INVALID_TRANSACTION_ID: "transactionId is invalid (must be ≤ 38 chars, alphanumeric/_/-).",
  INVALID_MERCHANT_ID: "Merchant ID is invalid for this environment.",
  INVALID_AMOUNT: "Amount must be a positive integer in paise.",
  INVALID_STORE_ID: "Store ID is unknown to PhonePe.",
  INVALID_TERMINAL_ID: "Terminal ID is unknown to PhonePe or not mapped to this store.",
  DUPLICATE_TRANSACTION_ID: "This transactionId was already used. Each transaction must be unique.",
  INTEGRATEDMODE_NOT_ENABLED_ON_TERMINAL: "The PhonePe terminal is not in Integrated Mode. Ask PhonePe to enable Integrated Mode for this terminal.",
  SHORT_CODE_NOT_GENERATED: "PhonePe did not return a short code. Retry; if it persists, contact PhonePe support.",
  SHORT_CODE_EXPIRED: "The OPEN-mode short code has expired. Generate a new sale request.",
  SHORT_CODE_ALREADY_USED: "The OPEN-mode short code was already entered on another EDC. Generate a new one.",
  TRANSACTION_NOT_FOUND: "PhonePe has not yet seen this transaction. It may still be in transit on the EDC.",
  PAYMENT_PENDING: "The customer has not completed the payment yet on the EDC.",
  PAYMENT_DECLINED: "The customer's bank or PhonePe declined the payment.",
  PAYMENT_ERROR: "PhonePe returned a generic payment error. Check status before retrying.",
  PAYMENT_CANCELLED: "The customer cancelled the payment on the EDC.",
  PAYMENT_SUCCESS: "Payment completed successfully.",
  REFUND_NOT_ENABLED: "Refund API is not enabled on this merchant. Process the refund manually and use 'Mark as refunded'.",
};

export function explainPhonePeCode(code: string | null | undefined, fallback?: string | null): string {
  if (!code) return fallback ?? "PhonePe returned no response code.";
  return PHONEPE_ERROR_MAP[code] ?? fallback ?? code;
}
