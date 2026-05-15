import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "./logger";

const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID ?? "";
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY ?? "";
const CASHFREE_ENV = (process.env.CASHFREE_ENV ?? "sandbox").toLowerCase();
const CASHFREE_API_VERSION = "2023-08-01";

export function isCashfreeConfigured(): boolean {
  return !!(CASHFREE_APP_ID && CASHFREE_SECRET_KEY);
}

function baseUrl(): string {
  return CASHFREE_ENV === "production" || CASHFREE_ENV === "prod"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
}

function headers(): Record<string, string> {
  return {
    "x-api-version": CASHFREE_API_VERSION,
    "x-client-id": CASHFREE_APP_ID,
    "x-client-secret": CASHFREE_SECRET_KEY,
    "Content-Type": "application/json",
  };
}

export interface CashfreeOrderInput {
  orderId: string;
  amount: number;
  currency: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  returnUrl: string;
  notifyUrl?: string;
  notes?: Record<string, string>;
}

export interface CashfreeOrderResponse {
  cf_order_id?: string | number;
  order_id: string;
  payment_session_id?: string;
  order_status?: string;
  payments?: { url?: string };
  [k: string]: unknown;
}

export async function createCashfreeOrder(input: CashfreeOrderInput): Promise<CashfreeOrderResponse> {
  const body = {
    order_id: input.orderId,
    order_amount: Number(input.amount.toFixed(2)),
    order_currency: input.currency,
    customer_details: {
      customer_id: input.customerId,
      customer_name: input.customerName,
      customer_email: input.customerEmail,
      customer_phone: input.customerPhone,
    },
    order_meta: {
      return_url: `${input.returnUrl}${input.returnUrl.includes("?") ? "&" : "?"}cashfree_order_id={order_id}`,
      notify_url: input.notifyUrl,
    },
    order_note: "Khana Lagao subscription",
    order_tags: input.notes,
  };

  const res = await fetch(`${baseUrl()}/orders`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, text }, "Cashfree create order failed");
    throw new Error(`Cashfree error ${res.status}: ${text}`);
  }
  return (await res.json()) as CashfreeOrderResponse;
}

export async function fetchCashfreeOrder(orderId: string): Promise<CashfreeOrderResponse> {
  const res = await fetch(`${baseUrl()}/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: headers(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cashfree fetch error ${res.status}: ${text}`);
  }
  return (await res.json()) as CashfreeOrderResponse;
}

export function buildCheckoutUrl(paymentSessionId: string): string {
  // Cashfree's hosted checkout URL pattern
  const host = CASHFREE_ENV === "production" || CASHFREE_ENV === "prod"
    ? "https://payments.cashfree.com"
    : "https://payments-test.cashfree.com";
  return `${host}/pg/view/sessions/checkout/web/${paymentSessionId}`;
}

/**
 * Verifies the Cashfree webhook signature.
 * Cashfree signs `${timestamp}${rawBody}` with HMAC-SHA256 using the secret key,
 * then base64-encodes it. Header: `x-webhook-signature`, timestamp: `x-webhook-timestamp`.
 */
export function verifyCashfreeWebhook(rawBody: string, signature: string | undefined, timestamp: string | undefined): boolean {
  if (!signature || !timestamp || !CASHFREE_SECRET_KEY) return false;
  try {
    const expected = createHmac("sha256", CASHFREE_SECRET_KEY).update(timestamp + rawBody).digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
