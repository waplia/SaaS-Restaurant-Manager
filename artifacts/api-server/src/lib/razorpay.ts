import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "./logger";

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
}

export interface RazorpayOrderInput {
  receipt: string;
  amount: number;
  currency: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrderResponse {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: string;
  notes?: Record<string, string>;
  [k: string]: unknown;
}

export async function createRazorpayOrder(cfg: RazorpayConfig, input: RazorpayOrderInput): Promise<RazorpayOrderResponse> {
  const auth = Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: Math.round(input.amount * 100),
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
      payment_capture: 1,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, text }, "Razorpay create order failed");
    throw new Error(`Razorpay error ${res.status}: ${text}`);
  }
  return (await res.json()) as RazorpayOrderResponse;
}

export async function fetchRazorpayOrder(cfg: RazorpayConfig, orderId: string): Promise<RazorpayOrderResponse> {
  const auth = Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Razorpay fetch error ${res.status}: ${text}`);
  }
  return (await res.json()) as RazorpayOrderResponse;
}

/**
 * Verifies the Razorpay client-side signature returned after checkout.
 * razorpay_signature = HMAC-SHA256(orderId + "|" + paymentId, keySecret)
 */
export function verifyRazorpayPaymentSignature(cfg: RazorpayConfig, orderId: string, paymentId: string, signature: string): boolean {
  if (!signature || !cfg.keySecret) return false;
  try {
    const expected = createHmac("sha256", cfg.keySecret).update(`${orderId}|${paymentId}`).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Razorpay webhook signature: HMAC-SHA256(rawBody, webhookSecret) hex.
 * Header: `x-razorpay-signature`.
 */
export function verifyRazorpayWebhook(rawBody: string, signature: string | undefined, webhookSecret: string | undefined): boolean {
  if (!signature || !webhookSecret) return false;
  try {
    const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
