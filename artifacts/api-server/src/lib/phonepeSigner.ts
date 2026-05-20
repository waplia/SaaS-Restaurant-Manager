/**
 * PhonePe X-VERIFY checksum + header helpers (Task #522).
 *
 * Per PhonePe Offline / In-Store spec:
 *   X-VERIFY = SHA256( base64Payload + "/" + apiEndpointPath + saltKey ) + "###" + saltIndex
 * for status / refund calls:
 *   X-VERIFY = SHA256( apiEndpointPath + saltKey ) + "###" + saltIndex
 *
 * The signer NEVER takes plaintext salt keys from request bodies; callers must
 * resolve them via `phonepeConfig.getDecryptedConfig()` so secrets only flow
 * through the encrypted store.
 */
import crypto from "crypto";

export interface SigningContext {
  saltKey: string;
  saltIndex: number;
}

/** Base64-encode an object exactly as PhonePe expects: compact JSON, UTF-8. */
export function base64EncodePayload(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

/** SHA-256 hex digest of an arbitrary string. */
export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Compute X-VERIFY for endpoints that POST a base64 payload (Sale, DQR Init,
 * Collect, Paylink Create, Refund, Cancel, …).
 *
 * Formula: SHA256(payloadBase64 + apiPath + saltKey) + "###" + saltIndex
 */
export function generateXVerify(
  payloadBase64: string,
  apiPath: string,
  ctx: SigningContext,
): string {
  const digest = sha256Hex(payloadBase64 + apiPath + ctx.saltKey);
  return `${digest}###${ctx.saltIndex}`;
}

/**
 * Compute X-VERIFY for GET-style endpoints (Status, Refund Status,
 * Reconciliation).
 *
 * Formula: SHA256(apiPath + saltKey) + "###" + saltIndex
 */
export function generateStatusXVerify(
  apiPath: string,
  ctx: SigningContext,
): string {
  const digest = sha256Hex(apiPath + ctx.saltKey);
  return `${digest}###${ctx.saltIndex}`;
}

/**
 * Build the headers PhonePe expects on a POST. `merchantId` is sent in
 * `X-MERCHANT-ID`; we also surface X-CALLBACK-URL when the caller wants S2S
 * notifications routed back to a specific URL.
 */
export function buildPostHeaders(opts: {
  xVerify: string;
  merchantId: string;
  callbackUrl?: string | null;
  callbackUsername?: string | null;
  callbackPassword?: string | null;
}): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "X-VERIFY": opts.xVerify,
    "X-MERCHANT-ID": opts.merchantId,
    Accept: "application/json",
  };
  if (opts.callbackUrl) h["X-CALLBACK-URL"] = opts.callbackUrl;
  if (opts.callbackUsername) h["X-CALL-MODE"] = "POST";
  if (opts.callbackUsername && opts.callbackPassword) {
    h["X-CALLBACK-USERNAME"] = opts.callbackUsername;
    h["X-CALLBACK-PASSWORD-HASH"] = sha256Hex(opts.callbackPassword);
  }
  return h;
}

/** Build headers for a GET (Status / Refund Status / Recon). */
export function buildGetHeaders(opts: {
  xVerify: string;
  merchantId: string;
}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-VERIFY": opts.xVerify,
    "X-MERCHANT-ID": opts.merchantId,
    Accept: "application/json",
  };
}

/**
 * Validate an inbound S2S callback's X-VERIFY signature.
 * PhonePe sends X-VERIFY = SHA256(rawBodyBase64 + saltKey) + "###" + saltIndex.
 */
export function verifyCallbackSignature(opts: {
  rawBodyBase64: string;
  receivedXVerify: string | undefined;
  saltKey: string;
  saltIndex: number;
}): boolean {
  if (!opts.receivedXVerify) return false;
  const expected = `${sha256Hex(opts.rawBodyBase64 + opts.saltKey)}###${opts.saltIndex}`;
  // Constant-time compare on equal-length strings.
  if (expected.length !== opts.receivedXVerify.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(opts.receivedXVerify));
}

/**
 * Validate a transactionId per PhonePe rules (max 38–40 chars, alphanumeric +
 * limited punctuation).
 */
export function isValidMerchantTransactionId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,38}$/.test(id);
}

/** Validate shortOrderId for OPEN-mode EDC (4–8 digits). */
export function isValidShortOrderId(id: string): boolean {
  return /^[0-9]{4,8}$/.test(id);
}

/** Generate a unique merchantTransactionId capped at 38 chars. */
export function generateMerchantTransactionId(prefix = "KL"): string {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(6).toString("hex");
  return `${prefix}${ts}${rand}`.slice(0, 38);
}

/** Generate a 4–8 digit shortOrderId for OPEN-mode EDC. */
export function generateShortOrderId(): string {
  // 6-digit numeric to balance entropy and ease of typing on the EDC.
  return String(100_000 + crypto.randomInt(0, 900_000));
}
