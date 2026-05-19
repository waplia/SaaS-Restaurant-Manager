import webPush from "web-push";
import { eq } from "drizzle-orm";
import { db, appSettingsTable, webPushSubscriptionsTable } from "./db";
import { logger } from "./logger";

const SUBJECT_DEFAULT = process.env.WEB_PUSH_SUBJECT ?? "mailto:support@khanalagao.com";
const SINGLETON_ID = 1;

let vapidCache: { publicKey: string; privateKey: string; subject: string } | null = null;
let configured = false;

async function loadOrGenerateVapid(): Promise<{ publicKey: string; privateKey: string; subject: string }> {
  if (vapidCache) return vapidCache;

  // Env vars take precedence (deployments may want to lock keys explicitly).
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapidCache = {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      subject: SUBJECT_DEFAULT,
    };
    return vapidCache;
  }

  // Otherwise auto-generate once and persist on the singleton app_settings row
  // so existing subscriptions stay valid across api-server restarts.
  let [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, SINGLETON_ID));
  if (!row) {
    [row] = await db.insert(appSettingsTable).values({ id: SINGLETON_ID }).onConflictDoNothing().returning();
    if (!row) {
      [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, SINGLETON_ID));
    }
  }
  if (!row.webPushPublicKey || !row.webPushPrivateKey) {
    const generated = webPush.generateVAPIDKeys();
    await db.update(appSettingsTable).set({
      webPushPublicKey: generated.publicKey,
      webPushPrivateKey: generated.privateKey,
      webPushSubject: row.webPushSubject ?? SUBJECT_DEFAULT,
    }).where(eq(appSettingsTable.id, SINGLETON_ID));
    vapidCache = { publicKey: generated.publicKey, privateKey: generated.privateKey, subject: row.webPushSubject ?? SUBJECT_DEFAULT };
  } else {
    vapidCache = {
      publicKey: row.webPushPublicKey,
      privateKey: row.webPushPrivateKey,
      subject: row.webPushSubject ?? SUBJECT_DEFAULT,
    };
  }
  return vapidCache;
}

async function ensureConfigured(): Promise<{ publicKey: string }> {
  const keys = await loadOrGenerateVapid();
  if (!configured) {
    webPush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
    configured = true;
  }
  return { publicKey: keys.publicKey };
}

export async function getVapidPublicKey(): Promise<string> {
  const { publicKey } = await ensureConfigured();
  return publicKey;
}

export interface WebPushSubscribeInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  orderId?: number | null;
  restaurantId?: number | null;
  tableId?: number | null;
  userAgent?: string | null;
}

export async function upsertWebPushSubscription(input: WebPushSubscribeInput): Promise<void> {
  await ensureConfigured();
  const existing = await db
    .select({ id: webPushSubscriptionsTable.id })
    .from(webPushSubscriptionsTable)
    .where(eq(webPushSubscriptionsTable.endpoint, input.endpoint));
  if (existing.length > 0) {
    await db.update(webPushSubscriptionsTable).set({
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      orderId: input.orderId ?? null,
      restaurantId: input.restaurantId ?? null,
      tableId: input.tableId ?? null,
      userAgent: input.userAgent ?? null,
    }).where(eq(webPushSubscriptionsTable.endpoint, input.endpoint));
    return;
  }
  await db.insert(webPushSubscriptionsTable).values({
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    orderId: input.orderId ?? null,
    restaurantId: input.restaurantId ?? null,
    tableId: input.tableId ?? null,
    userAgent: input.userAgent ?? null,
  });
}

export async function deleteWebPushSubscription(endpoint: string): Promise<void> {
  await db.delete(webPushSubscriptionsTable).where(eq(webPushSubscriptionsTable.endpoint, endpoint));
}

export interface WebPushPayload {
  title: string;
  body: string;
  url?: string;
  data?: Record<string, unknown>;
}

async function sendOne(
  sub: { id: number; endpoint: string; p256dh: string; auth: string },
  payload: WebPushPayload,
): Promise<void> {
  try {
    await webPush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 },
    );
    await db.update(webPushSubscriptionsTable)
      .set({ lastSentAt: new Date() })
      .where(eq(webPushSubscriptionsTable.id, sub.id));
  } catch (err: unknown) {
    const status = typeof err === "object" && err !== null && "statusCode" in err
      ? Number((err as { statusCode: unknown }).statusCode)
      : undefined;
    // 404 Not Found / 410 Gone => subscription is permanently dead; remove it.
    if (status === 404 || status === 410) {
      await db.delete(webPushSubscriptionsTable).where(eq(webPushSubscriptionsTable.id, sub.id));
      return;
    }
    logger.warn({ err, endpoint: sub.endpoint, status }, "web-push delivery failed");
  }
}

export async function sendWebPushToOrder(orderId: number, payload: WebPushPayload): Promise<void> {
  if (!orderId) return;
  try {
    await ensureConfigured();
  } catch (err) {
    logger.warn({ err }, "web-push not configured; skipping");
    return;
  }
  const subs = await db
    .select({
      id: webPushSubscriptionsTable.id,
      endpoint: webPushSubscriptionsTable.endpoint,
      p256dh: webPushSubscriptionsTable.p256dh,
      auth: webPushSubscriptionsTable.auth,
    })
    .from(webPushSubscriptionsTable)
    .where(eq(webPushSubscriptionsTable.orderId, orderId));
  if (subs.length === 0) return;
  await Promise.all(subs.map(s => sendOne(s, payload)));
}
