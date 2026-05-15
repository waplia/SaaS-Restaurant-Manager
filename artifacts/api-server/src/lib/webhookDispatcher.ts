import crypto from "crypto";
import { and, eq, lte, or, isNull, asc, desc } from "drizzle-orm";
import {
  db,
  webhookEndpointsTable,
  webhookDeliveriesTable,
  type WebhookEventType,
  type WebhookDelivery,
} from "./db";
import { getGlobalSettings } from "./apiKeys";
import { logger } from "./logger";

export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString("base64url")}`;
}

export function signPayload(secret: string, body: string, timestamp: number): string {
  const data = `${timestamp}.${body}`;
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

export function buildSignatureHeader(secret: string, body: string): { value: string; timestamp: number } {
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = signPayload(secret, body, timestamp);
  return { value: `t=${timestamp},v1=${sig}`, timestamp };
}

/**
 * Enqueue an event for delivery to all matching active endpoints. Each
 * endpoint gets its own delivery row so retries are tracked independently.
 */
export async function emitWebhookEvent(
  restaurantId: number,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const endpoints = await db
    .select()
    .from(webhookEndpointsTable)
    .where(and(eq(webhookEndpointsTable.restaurantId, restaurantId), eq(webhookEndpointsTable.active, true)));

  const matching = endpoints.filter(e => e.events.includes(eventType));
  if (matching.length === 0) return;

  const rows = matching.map(ep => ({
    endpointId: ep.id,
    restaurantId,
    eventType,
    payload,
    status: "pending" as const,
    nextAttemptAt: new Date(),
    attempt: 0,
  }));
  const inserted = await db.insert(webhookDeliveriesTable).values(rows).returning();
  // Fire-and-forget delivery
  void Promise.all(inserted.map(d => attemptDelivery(d.id))).catch(() => {});
}

async function attemptDelivery(deliveryId: number): Promise<void> {
  const [delivery] = await db.select().from(webhookDeliveriesTable).where(eq(webhookDeliveriesTable.id, deliveryId));
  if (!delivery) return;
  if (delivery.status === "delivered" || delivery.status === "permanently_failed") return;

  const [endpoint] = await db.select().from(webhookEndpointsTable).where(eq(webhookEndpointsTable.id, delivery.endpointId));
  if (!endpoint) {
    await db.update(webhookDeliveriesTable)
      .set({ status: "permanently_failed", error: "Endpoint deleted", nextAttemptAt: null })
      .where(eq(webhookDeliveriesTable.id, deliveryId));
    return;
  }

  const settings = await getGlobalSettings();
  const body = JSON.stringify({ event: delivery.eventType, data: delivery.payload, deliveryId, createdAt: delivery.createdAt });
  const sig = buildSignatureHeader(endpoint.secret, body);
  const attempt = delivery.attempt + 1;

  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": sig.value,
        "X-Webhook-Event": delivery.eventType,
        "X-Webhook-Delivery": String(deliveryId),
        "User-Agent": "KhanaLagao-Webhook/1.0",
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    statusCode = res.status;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      error = `HTTP ${res.status}: ${text.slice(0, 500)}`;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const succeeded = statusCode != null && statusCode >= 200 && statusCode < 300;
  if (succeeded) {
    await db.update(webhookDeliveriesTable)
      .set({ status: "delivered", statusCode, error: null, attempt, deliveredAt: new Date(), nextAttemptAt: null })
      .where(eq(webhookDeliveriesTable.id, deliveryId));
    return;
  }

  if (attempt >= settings.webhookMaxAttempts) {
    await db.update(webhookDeliveriesTable)
      .set({ status: "permanently_failed", statusCode, error, attempt, nextAttemptAt: null })
      .where(eq(webhookDeliveriesTable.id, deliveryId));
    logger.warn({ deliveryId, attempt }, "Webhook permanently failed");
    return;
  }

  // Exponential backoff: base * 2^(attempt-1) seconds
  const delaySec = settings.webhookBaseDelaySec * Math.pow(2, attempt - 1);
  const next = new Date(Date.now() + delaySec * 1000);
  await db.update(webhookDeliveriesTable)
    .set({ status: "failed", statusCode, error, attempt, nextAttemptAt: next })
    .where(eq(webhookDeliveriesTable.id, deliveryId));
}

/**
 * Picks pending/failed deliveries whose nextAttemptAt has passed and retries them.
 * Called periodically by the scheduler.
 */
export async function processPendingWebhookDeliveries(maxBatch = 50): Promise<number> {
  const now = new Date();
  const due = await db
    .select({ id: webhookDeliveriesTable.id })
    .from(webhookDeliveriesTable)
    .where(and(
      or(eq(webhookDeliveriesTable.status, "pending"), eq(webhookDeliveriesTable.status, "failed")),
      or(isNull(webhookDeliveriesTable.nextAttemptAt), lte(webhookDeliveriesTable.nextAttemptAt, now)),
    ))
    .orderBy(asc(webhookDeliveriesTable.nextAttemptAt))
    .limit(maxBatch);
  for (const d of due) {
    await attemptDelivery(d.id);
  }
  return due.length;
}

/**
 * Manually retry a single delivery now (resets nextAttemptAt and re-attempts).
 */
export async function retryDeliveryNow(deliveryId: number): Promise<WebhookDelivery | null> {
  await db.update(webhookDeliveriesTable)
    .set({ status: "pending", nextAttemptAt: new Date(), error: null })
    .where(eq(webhookDeliveriesTable.id, deliveryId));
  await attemptDelivery(deliveryId);
  const [out] = await db.select().from(webhookDeliveriesTable).where(eq(webhookDeliveriesTable.id, deliveryId));
  return out ?? null;
}

export async function retryAllFailedForEndpoint(endpointId: number): Promise<number> {
  const failed = await db
    .select({ id: webhookDeliveriesTable.id })
    .from(webhookDeliveriesTable)
    .where(and(
      eq(webhookDeliveriesTable.endpointId, endpointId),
      or(eq(webhookDeliveriesTable.status, "failed"), eq(webhookDeliveriesTable.status, "permanently_failed")),
    ))
    .orderBy(desc(webhookDeliveriesTable.createdAt))
    .limit(200);
  for (const d of failed) {
    await retryDeliveryNow(d.id);
  }
  return failed.length;
}
