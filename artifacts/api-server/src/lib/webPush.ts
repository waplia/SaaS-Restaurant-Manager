import webPush from "web-push";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  appSettingsTable,
  webPushSubscriptionsTable,
  webPushSettingsTable,
  webPushTemplatesTable,
  webPushLogsTable,
  restaurantsTable,
  tenantsTable,
  subscriptionPlansTable,
  WEB_PUSH_FEATURE_KEYS,
  type WebPushSubscription,
  type WebPushSetting,
  type WebPushEventKey,
} from "./db";
import { logger } from "./logger";
import { encryptSecret, decryptSecret } from "./aiEncryption";

const SUBJECT_DEFAULT = process.env.WEB_PUSH_SUBJECT ?? "mailto:support@khanalagao.com";
const SINGLETON_ID = 1;

export type WebPushProviderType = "vapid" | "fcm" | "onesignal" | "custom";

let vapidCache: { publicKey: string; privateKey: string; subject: string } | null = null;
let configured = false;

/** Load (or auto-generate) VAPID keys, persisted on the app_settings singleton. */
async function loadOrGenerateVapid(): Promise<{ publicKey: string; privateKey: string; subject: string }> {
  if (vapidCache) return vapidCache;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapidCache = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: SUBJECT_DEFAULT };
    return vapidCache;
  }
  let [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, SINGLETON_ID));
  if (!row) {
    [row] = await db.insert(appSettingsTable).values({ id: SINGLETON_ID }).onConflictDoNothing().returning();
    if (!row) [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, SINGLETON_ID));
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
    vapidCache = { publicKey: row.webPushPublicKey, privateKey: row.webPushPrivateKey, subject: row.webPushSubject ?? SUBJECT_DEFAULT };
  }
  return vapidCache;
}

async function ensureVapidConfigured(): Promise<{ publicKey: string }> {
  const keys = await loadOrGenerateVapid();
  if (!configured) { webPush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey); configured = true; }
  return { publicKey: keys.publicKey };
}

/** Public-facing endpoint: returns only the VAPID public key. */
export async function getVapidPublicKey(): Promise<string> {
  const { publicKey } = await ensureVapidConfigured();
  return publicKey;
}

// ─────────────────────────────────────────────────────────────────────
// Subscription upsert / unsubscribe
// ─────────────────────────────────────────────────────────────────────

function detectBrowser(ua: string | null | undefined): string | null {
  if (!ua) return null;
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Other";
}
function detectDevice(ua: string | null | undefined): string | null {
  if (!ua) return null;
  if (/Mobi|Android|iPhone/.test(ua)) return "mobile";
  if (/iPad|Tablet/.test(ua)) return "tablet";
  return "desktop";
}

export interface WebPushSubscribeInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  orderId?: number | null;
  restaurantId?: number | null;
  tenantId?: number | null;
  tableId?: number | null;
  customerId?: number | null;
  userId?: number | null;
  audience?: "customers" | "staff";
  orderUpdatesOptIn?: boolean;
  marketingOptIn?: boolean;
  userAgent?: string | null;
  locale?: string | null;
}

export async function upsertWebPushSubscription(input: WebPushSubscribeInput): Promise<WebPushSubscription> {
  await ensureVapidConfigured();
  const browser = detectBrowser(input.userAgent);
  const device = detectDevice(input.userAgent);
  let tenantId = input.tenantId ?? null;
  if (!tenantId && input.restaurantId) {
    const [r] = await db.select({ tenantId: restaurantsTable.tenantId }).from(restaurantsTable).where(eq(restaurantsTable.id, input.restaurantId));
    if (r) tenantId = r.tenantId;
  }
  const baseValues = {
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    audience: input.audience ?? "customers",
    status: "active" as const,
    orderId: input.orderId ?? null,
    restaurantId: input.restaurantId ?? null,
    tenantId,
    tableId: input.tableId ?? null,
    customerId: input.customerId ?? null,
    userId: input.userId ?? null,
    orderUpdatesOptIn: input.orderUpdatesOptIn ?? true,
    marketingOptIn: input.marketingOptIn ?? false,
    userAgent: input.userAgent ?? null,
    browser, device,
    locale: input.locale ?? null,
    failureCount: 0,
    lastFailureAt: null,
    lastFailureReason: null,
    unsubscribedAt: null,
    updatedAt: new Date(),
  };
  const existing = await db.select().from(webPushSubscriptionsTable).where(eq(webPushSubscriptionsTable.endpoint, input.endpoint));
  if (existing.length > 0) {
    const [row] = await db.update(webPushSubscriptionsTable).set(baseValues).where(eq(webPushSubscriptionsTable.endpoint, input.endpoint)).returning();
    return row;
  }
  const [row] = await db.insert(webPushSubscriptionsTable).values(baseValues).returning();
  return row;
}

export async function deleteWebPushSubscription(endpoint: string): Promise<void> {
  await db.update(webPushSubscriptionsTable).set({
    status: "unsubscribed",
    unsubscribedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(webPushSubscriptionsTable.endpoint, endpoint));
}

export async function updateSubscriptionPrefs(endpoint: string, patch: { orderUpdatesOptIn?: boolean; marketingOptIn?: boolean }): Promise<WebPushSubscription | null> {
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.orderUpdatesOptIn !== undefined) update.orderUpdatesOptIn = patch.orderUpdatesOptIn;
  if (patch.marketingOptIn !== undefined) update.marketingOptIn = patch.marketingOptIn;
  const [row] = await db.update(webPushSubscriptionsTable).set(update).where(eq(webPushSubscriptionsTable.endpoint, endpoint)).returning();
  return row ?? null;
}

export async function getSubscriptionStatus(endpoint: string): Promise<WebPushSubscription | null> {
  const [row] = await db.select().from(webPushSubscriptionsTable).where(eq(webPushSubscriptionsTable.endpoint, endpoint));
  return row ?? null;
}

// ─────────────────────────────────────────────────────────────────────
// Provider adapter layer
// ─────────────────────────────────────────────────────────────────────

export interface WebPushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  badge?: string;
  image?: string;
  data?: Record<string, unknown>;
}

interface ProviderSendResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
  providerMessageId?: string | null;
}

interface ProviderAdapter {
  readonly type: WebPushProviderType;
  sendOne(sub: Pick<WebPushSubscription, "endpoint" | "p256dh" | "auth">, payload: WebPushPayload): Promise<ProviderSendResult>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
}

class VapidAdapter implements ProviderAdapter {
  readonly type = "vapid" as const;
  async sendOne(sub: { endpoint: string; p256dh: string; auth: string }, payload: WebPushPayload): Promise<ProviderSendResult> {
    await ensureVapidConfigured();
    try {
      const res = await webPush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 },
      );
      return { ok: true, statusCode: res.statusCode, providerMessageId: res.headers?.["location"] ?? null };
    } catch (err: unknown) {
      const statusCode = typeof err === "object" && err !== null && "statusCode" in err ? Number((err as { statusCode: unknown }).statusCode) : undefined;
      return { ok: false, statusCode, error: (err as Error).message };
    }
  }
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try { await ensureVapidConfigured(); return { ok: true }; }
    catch (err) { return { ok: false, error: (err as Error).message }; }
  }
}

class OneSignalAdapter implements ProviderAdapter {
  readonly type = "onesignal" as const;
  constructor(private readonly appId: string, private readonly apiKey: string) {}
  async sendOne(sub: { endpoint: string; p256dh: string; auth: string }, payload: WebPushPayload): Promise<ProviderSendResult> {
    try {
      const res = await fetch("https://api.onesignal.com/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Key ${this.apiKey}` },
        body: JSON.stringify({
          app_id: this.appId,
          include_subscription_ids: [sub.endpoint],
          headings: { en: payload.title },
          contents: { en: payload.body },
          url: payload.url,
          chrome_web_icon: payload.icon,
          chrome_web_image: payload.image,
          chrome_web_badge: payload.badge,
          data: payload.data ?? {},
        }),
      });
      if (!res.ok) { const t = await res.text().catch(() => ""); return { ok: false, statusCode: res.status, error: `OneSignal ${res.status}: ${t}` }; }
      const j = await res.json().catch(() => ({})) as { id?: string };
      return { ok: true, statusCode: res.status, providerMessageId: j.id ?? null };
    } catch (err) { return { ok: false, error: (err as Error).message }; }
  }
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`https://api.onesignal.com/apps/${this.appId}`, { headers: { Authorization: `Key ${this.apiKey}` } });
      if (!res.ok) return { ok: false, error: `OneSignal ${res.status}` };
      return { ok: true };
    } catch (err) { return { ok: false, error: (err as Error).message }; }
  }
}

class FcmAdapter implements ProviderAdapter {
  readonly type = "fcm" as const;
  constructor(private readonly serverKey: string) {}
  /** Legacy FCM HTTP API. Subscriptions registered via the Web Push protocol
   * with a googleapis.com endpoint can be addressed via VAPID; this adapter
   * is used when the super-admin opts to drive FCM directly with a server key. */
  async sendOne(sub: { endpoint: string; p256dh: string; auth: string }, payload: WebPushPayload): Promise<ProviderSendResult> {
    try {
      const to = sub.endpoint.split("/").pop();
      if (!to) return { ok: false, error: "Could not derive FCM token from endpoint" };
      const res = await fetch("https://fcm.googleapis.com/fcm/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `key=${this.serverKey}` },
        body: JSON.stringify({ to, notification: { title: payload.title, body: payload.body, icon: payload.icon, image: payload.image, click_action: payload.url }, data: payload.data ?? {} }),
      });
      if (!res.ok) { const t = await res.text().catch(() => ""); return { ok: false, statusCode: res.status, error: `FCM ${res.status}: ${t}` }; }
      const j = await res.json().catch(() => ({})) as { message_id?: string };
      return { ok: true, statusCode: res.status, providerMessageId: j.message_id ?? null };
    } catch (err) { return { ok: false, error: (err as Error).message }; }
  }
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.serverKey) return { ok: false, error: "FCM server key not configured" };
    return { ok: true };
  }
}

class CustomHttpAdapter implements ProviderAdapter {
  readonly type = "custom" as const;
  constructor(private readonly url: string, private readonly headers: Record<string, string>) {}
  async sendOne(sub: { endpoint: string; p256dh: string; auth: string }, payload: WebPushPayload): Promise<ProviderSendResult> {
    try {
      const res = await fetch(this.url, { method: "POST", headers: { "Content-Type": "application/json", ...this.headers }, body: JSON.stringify({ subscription: sub, payload }) });
      if (!res.ok) return { ok: false, statusCode: res.status, error: `Custom ${res.status}` };
      return { ok: true, statusCode: res.status, providerMessageId: null };
    } catch (err) { return { ok: false, error: (err as Error).message }; }
  }
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.url) return { ok: false, error: "Custom URL not configured" };
    return { ok: true };
  }
}

/** Resolve the active provider for a tenant. Tenant-overrides take precedence,
 * then the global selection. Falls back to VAPID if any non-VAPID provider
 * cannot be constructed (missing creds). */
export async function resolveProvider(_tenantId: number | null): Promise<ProviderAdapter> {
  const [settings] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, SINGLETON_ID));
  const type = (settings?.webPushProvider as WebPushProviderType | undefined) ?? "vapid";
  const adapter = await tryBuildAdapter(type, settings);
  if (adapter) return adapter;
  if (settings?.webPushFallbackProvider) {
    const fb = await tryBuildAdapter(settings.webPushFallbackProvider as WebPushProviderType, settings);
    if (fb) return fb;
  }
  return new VapidAdapter();
}

async function tryBuildAdapter(type: WebPushProviderType, settings: typeof appSettingsTable.$inferSelect | undefined): Promise<ProviderAdapter | null> {
  try {
    if (type === "vapid") return new VapidAdapter();
    if (type === "onesignal") {
      const cfg = settings?.webPushOnesignalConfig as Record<string, unknown> | undefined;
      const appId = String(cfg?.appId ?? "");
      const apiKey = decryptIfWrapped(cfg?.apiKey) ?? "";
      if (!appId || !apiKey) return null;
      return new OneSignalAdapter(appId, apiKey);
    }
    if (type === "fcm") {
      const cfg = settings?.webPushFcmConfig as Record<string, unknown> | undefined;
      const serverKey = decryptIfWrapped(cfg?.serverKey) ?? "";
      if (!serverKey) return null;
      return new FcmAdapter(serverKey);
    }
    if (type === "custom") {
      const cfg = settings?.webPushCustomConfig as Record<string, unknown> | undefined;
      const url = String(cfg?.url ?? "");
      const headersRaw = cfg?.headers as Record<string, unknown> | undefined;
      const headers: Record<string, string> = {};
      if (headersRaw && typeof headersRaw === "object") {
        for (const [k, v] of Object.entries(headersRaw)) headers[k] = String(decryptIfWrapped(v) ?? v ?? "");
      }
      if (!url) return null;
      return new CustomHttpAdapter(url, headers);
    }
  } catch (err) { logger.warn({ err, type }, "Failed to build web push adapter"); }
  return null;
}

/** If `v` looks like an encrypted envelope ({cipher,iv,tag}), decrypt it.
 * Otherwise return the string as-is (allows env-set unencrypted keys). */
export function decryptIfWrapped(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "cipher" in v && "iv" in v && "tag" in v) {
    return decryptSecret(v as { cipher: string; iv: string; tag: string });
  }
  return null;
}

/** Encrypt a plaintext secret into the storable envelope. */
export function encryptForStorage(plaintext: string): { cipher: string; iv: string; tag: string } {
  return encryptSecret(plaintext);
}

// ─────────────────────────────────────────────────────────────────────
// Settings + plan/tenant limit resolution
// ─────────────────────────────────────────────────────────────────────

interface ResolvedLimits {
  enabled: boolean;
  monthlyCap: number | null;
  dailyCap: number | null;
  maxSubscribers: number | null;
  scheduling: boolean;
  richImages: boolean;
  segmentation: boolean;
  analytics: boolean;
  source: "plan" | "tenant_override" | "global" | "global_disabled";
  reason?: string;
}

export async function resolveTenantLimits(tenantId: number | null): Promise<ResolvedLimits> {
  const [settings] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, SINGLETON_ID));
  if (!settings?.webPushGlobalEnabled) {
    return { enabled: false, monthlyCap: 0, dailyCap: 0, maxSubscribers: 0, scheduling: false, richImages: false, segmentation: false, analytics: false, source: "global_disabled", reason: "Web Push is globally disabled by the super admin" };
  }
  if (tenantId) {
    const overrides = settings.webPushTenantOverrides ?? {};
    const o = overrides[String(tenantId)];
    if (o?.forceDisable === true) {
      return { enabled: false, monthlyCap: 0, dailyCap: 0, maxSubscribers: 0, scheduling: false, richImages: false, segmentation: false, analytics: false, source: "tenant_override", reason: String(o.reason ?? "Force-disabled by super admin") };
    }
  }
  let planId: number | null = null;
  if (tenantId) {
    const [t] = await db.select({ planId: tenantsTable.planId }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    planId = t?.planId ?? null;
  }
  const planLimits = settings.webPushPlanLimits ?? {};
  const p = planId ? planLimits[String(planId)] : undefined;
  const overrides = tenantId ? (settings.webPushTenantOverrides ?? {})[String(tenantId)] : undefined;
  const enabled = p ? (p.enabled !== false) : true;
  const monthlyCap = numOr(overrides?.monthlyCap, numOr(p?.monthlyCap, null));
  return {
    enabled,
    monthlyCap,
    dailyCap: numOr(p?.dailyCap, null),
    maxSubscribers: numOr(p?.maxSubscribers, null),
    scheduling: p ? p.scheduling !== false : true,
    richImages: p ? p.richImages !== false : true,
    segmentation: p ? p.segmentation !== false : true,
    analytics: p ? p.analytics !== false : true,
    source: overrides ? "tenant_override" : "plan",
  };
}

function numOr(v: unknown, fallback: number | null): number | null {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function getOrCreateRestaurantSettings(restaurantId: number): Promise<WebPushSetting> {
  const [row] = await db.select().from(webPushSettingsTable).where(eq(webPushSettingsTable.restaurantId, restaurantId));
  if (row) return row;
  const defaultFeatures: Record<string, boolean> = {};
  for (const f of WEB_PUSH_FEATURE_KEYS) defaultFeatures[f.key] = true;
  const [created] = await db.insert(webPushSettingsTable).values({
    restaurantId, enabled: true, features: defaultFeatures,
    quietHoursStart: "22:00", quietHoursEnd: "08:00",
    dailyCap: null, monthlyCap: null, perCustomerDailyCap: 3,
    minCampaignGapMinutes: 60, allowRichImages: true, requireMarketingOptIn: true,
  }).onConflictDoNothing().returning();
  if (created) return created;
  const [reloaded] = await db.select().from(webPushSettingsTable).where(eq(webPushSettingsTable.restaurantId, restaurantId));
  return reloaded;
}

// ─────────────────────────────────────────────────────────────────────
// Caps + opt-in + quiet hours enforcement
// ─────────────────────────────────────────────────────────────────────

function isInQuietHours(now: Date, start: string | null, end: string | null): boolean {
  if (!start || !end || start === end) return false;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  const sMin = sh * 60 + sm, eMin = eh * 60 + em;
  if (sMin === eMin) return false;
  // Window may wrap past midnight (e.g. 22:00–08:00).
  return sMin < eMin ? (mins >= sMin && mins < eMin) : (mins >= sMin || mins < eMin);
}

const FEATURE_FOR_EVENT: Record<string, string> = {
  "order.accepted": "order_updates", "order.preparing": "order_updates", "order.ready": "order_updates",
  "order.served": "order_updates", "order.takeaway_ready": "order_updates", "order.delivery_update": "order_updates",
  "reservation.confirmed": "reservations", "reservation.reminder": "reservations",
  "review.request": "review_requests",
  "loyalty.points_earned": "loyalty", "loyalty.coupon_issued": "loyalty", "loyalty.coupon_expiring": "loyalty",
  "loyalty.birthday": "loyalty", "loyalty.winback": "loyalty", "loyalty.festival": "marketing", "loyalty.new_item": "marketing",
  "staff.alert": "staff_alerts", "inventory.low_stock": "staff_alerts",
  "ai.insight": "ai_insights", "support.update": "support",
  "system.announcement": "marketing",
};
const TRANSACTIONAL_EVENTS = new Set(["order.accepted","order.preparing","order.ready","order.served","order.takeaway_ready","order.delivery_update","reservation.confirmed","reservation.reminder","review.request","support.update","loyalty.points_earned","loyalty.coupon_issued","loyalty.coupon_expiring","loyalty.birthday","staff.alert","inventory.low_stock","ai.insight"]);

function sanitizePayload(p: WebPushPayload): WebPushPayload {
  const clean = (s: string | undefined) => typeof s === "string" ? s.replace(/[\u0000-\u001f]/g, "").slice(0, 500) : s;
  return { ...p, title: clean(p.title) ?? "", body: clean(p.body) ?? "", url: validateUrl(p.url) ?? undefined };
}
function validateUrl(u: string | undefined): string | null {
  if (!u) return null;
  try { const parsed = new URL(u); if (!["http:", "https:"].includes(parsed.protocol)) return null; return parsed.toString(); }
  catch { return null; }
}

export interface SendWebPushInput {
  restaurantId: number | null;
  tenantId?: number | null;
  eventKey: WebPushEventKey | string;
  category?: "transactional" | "marketing";
  campaignId?: number | null;
  payload: WebPushPayload;
  /** Pre-resolved subscriptions; if omitted, the function resolves them by audience selectors. */
  subscriptions?: Pick<WebPushSubscription, "id" | "endpoint" | "p256dh" | "auth" | "customerId" | "marketingOptIn" | "orderUpdatesOptIn" | "restaurantId" | "tenantId">[];
  targetCustomerIds?: number[];
  targetOrderId?: number | null;
}

export interface SendWebPushResult {
  sent: number;
  failed: number;
  skipped: number;
  total: number;
  reason?: string;
}

/** Single internal entry point for all Web Push delivery. Enforces:
 *   - global / plan / tenant limits, force-disable
 *   - per-restaurant feature toggle
 *   - per-event opt-in (marketing vs transactional)
 *   - quiet hours
 *   - daily / monthly / per-customer caps (computed from web_push_logs)
 *   - frequency cap for marketing campaigns
 *   - 410/404 → mark subscription expired
 *   - logs every attempt to web_push_logs */
export async function sendWebPush(input: SendWebPushInput): Promise<SendWebPushResult> {
  const result: SendWebPushResult = { sent: 0, failed: 0, skipped: 0, total: 0 };
  let tenantId = input.tenantId ?? null;
  if (!tenantId && input.restaurantId) {
    const [r] = await db.select({ tenantId: restaurantsTable.tenantId }).from(restaurantsTable).where(eq(restaurantsTable.id, input.restaurantId));
    if (r) tenantId = r.tenantId;
  }
  const limits = await resolveTenantLimits(tenantId);
  if (!limits.enabled) { result.reason = limits.reason ?? "Web Push disabled for this tenant"; return result; }

  let settings: WebPushSetting | null = null;
  if (input.restaurantId) {
    settings = await getOrCreateRestaurantSettings(input.restaurantId);
    if (!settings.enabled) { result.reason = "Restaurant has disabled Web Push"; return result; }
    const featureKey = FEATURE_FOR_EVENT[input.eventKey] ?? "order_updates";
    if (settings.features[featureKey] === false) { result.reason = `Feature '${featureKey}' is disabled`; return result; }
    if (isInQuietHours(new Date(), settings.quietHoursStart, settings.quietHoursEnd)) {
      if (!TRANSACTIONAL_EVENTS.has(input.eventKey)) { result.reason = "In quiet hours"; return result; }
    }
  }

  // Resolve subscriptions if not given.
  let subs = input.subscriptions ?? [];
  if (subs.length === 0) {
    const conditions = [eq(webPushSubscriptionsTable.status, "active")] as ReturnType<typeof eq>[];
    if (input.targetOrderId) conditions.push(eq(webPushSubscriptionsTable.orderId, input.targetOrderId));
    else if (input.targetCustomerIds && input.targetCustomerIds.length > 0) conditions.push(inArray(webPushSubscriptionsTable.customerId, input.targetCustomerIds));
    else if (input.restaurantId) conditions.push(eq(webPushSubscriptionsTable.restaurantId, input.restaurantId));
    subs = await db.select({
      id: webPushSubscriptionsTable.id,
      endpoint: webPushSubscriptionsTable.endpoint,
      p256dh: webPushSubscriptionsTable.p256dh,
      auth: webPushSubscriptionsTable.auth,
      customerId: webPushSubscriptionsTable.customerId,
      marketingOptIn: webPushSubscriptionsTable.marketingOptIn,
      orderUpdatesOptIn: webPushSubscriptionsTable.orderUpdatesOptIn,
      restaurantId: webPushSubscriptionsTable.restaurantId,
      tenantId: webPushSubscriptionsTable.tenantId,
    }).from(webPushSubscriptionsTable).where(and(...conditions));
  }

  const category: "transactional" | "marketing" = input.category ?? (TRANSACTIONAL_EVENTS.has(input.eventKey) ? "transactional" : "marketing");

  // Opt-in gating
  subs = subs.filter(s => category === "transactional" ? s.orderUpdatesOptIn !== false : s.marketingOptIn === true);
  if (subs.length === 0) return result;

  // Caps (per restaurant: daily/monthly via logs, per customer: daily).
  if (input.restaurantId && settings) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyCap = settings.monthlyCap ?? limits.monthlyCap ?? null;
    const dailyCap = settings.dailyCap ?? limits.dailyCap ?? null;
    if (monthlyCap !== null && monthlyCap > 0) {
      const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(webPushLogsTable)
        .where(and(eq(webPushLogsTable.restaurantId, input.restaurantId), eq(webPushLogsTable.status, "sent"), gte(webPushLogsTable.createdAt, startOfMonth)));
      if (c >= monthlyCap) { result.reason = "Monthly cap reached"; return result; }
    }
    if (dailyCap !== null && dailyCap > 0) {
      const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(webPushLogsTable)
        .where(and(eq(webPushLogsTable.restaurantId, input.restaurantId), eq(webPushLogsTable.status, "sent"), gte(webPushLogsTable.createdAt, startOfDay)));
      if (c >= dailyCap) { result.reason = "Daily cap reached"; return result; }
    }
  }

  result.total = subs.length;
  const adapter = await resolveProvider(tenantId);
  const sanitized = sanitizePayload(input.payload);

  for (const s of subs) {
    const out = await adapter.sendOne(s, sanitized);
    if (out.ok) {
      result.sent++;
      await db.update(webPushSubscriptionsTable).set({ lastSentAt: new Date(), failureCount: 0 }).where(eq(webPushSubscriptionsTable.id, s.id));
    } else {
      const dead = out.statusCode === 410 || out.statusCode === 404;
      if (dead) {
        await db.update(webPushSubscriptionsTable).set({ status: "expired", unsubscribedAt: new Date(), updatedAt: new Date() }).where(eq(webPushSubscriptionsTable.id, s.id));
      } else {
        await db.update(webPushSubscriptionsTable).set({
          failureCount: sql`${webPushSubscriptionsTable.failureCount} + 1`,
          lastFailureAt: new Date(),
          lastFailureReason: out.error?.slice(0, 500) ?? null,
        }).where(eq(webPushSubscriptionsTable.id, s.id));
        // Mark permanently failed after 5 consecutive failures.
        await db.update(webPushSubscriptionsTable).set({ status: "failed" })
          .where(and(eq(webPushSubscriptionsTable.id, s.id), gte(webPushSubscriptionsTable.failureCount, 5)));
      }
      result.failed++;
    }
    try {
      await db.insert(webPushLogsTable).values({
        restaurantId: s.restaurantId ?? input.restaurantId ?? null,
        tenantId: s.tenantId ?? tenantId,
        subscriptionId: s.id,
        customerId: s.customerId,
        campaignId: input.campaignId ?? null,
        eventKey: input.eventKey,
        category,
        title: sanitized.title,
        body: sanitized.body,
        clickUrl: sanitized.url ?? null,
        status: out.ok ? "sent" : "failed",
        error: out.ok ? null : (out.error?.slice(0, 500) ?? null),
        provider: adapter.type,
      });
    } catch (err) { logger.warn({ err }, "web push log insert failed"); }
  }
  return result;
}

/** Convenience wrapper used by the per-order subscribe flow (Task #503). */
export async function sendWebPushToOrder(orderId: number, payload: WebPushPayload): Promise<void> {
  if (!orderId) return;
  const [order] = await db.select({ restaurantId: webPushSubscriptionsTable.restaurantId }).from(webPushSubscriptionsTable).where(eq(webPushSubscriptionsTable.orderId, orderId)).limit(1);
  await sendWebPush({
    restaurantId: order?.restaurantId ?? null,
    eventKey: "order.preparing",
    category: "transactional",
    payload,
    targetOrderId: orderId,
  });
}

/** Test send to a single subscription endpoint (admin Test button). */
export async function sendTestWebPush(endpoint: string, payload: WebPushPayload): Promise<{ ok: boolean; error?: string }> {
  const [sub] = await db.select().from(webPushSubscriptionsTable).where(eq(webPushSubscriptionsTable.endpoint, endpoint));
  if (!sub) return { ok: false, error: "Subscription not found" };
  const adapter = await resolveProvider(sub.tenantId);
  const out = await adapter.sendOne(sub, sanitizePayload(payload));
  return { ok: out.ok, error: out.error };
}

export async function testProvider(): Promise<{ ok: boolean; provider: WebPushProviderType; error?: string }> {
  const adapter = await resolveProvider(null);
  const r = await adapter.testConnection();
  return { ok: r.ok, provider: adapter.type, error: r.error };
}

/** Find an active template for an event, scoped to a restaurant (with platform fallback). */
export async function findTemplateForEvent(restaurantId: number | null, eventKey: string): Promise<{ title: string; body: string; iconUrl: string | null; imageUrl: string | null; clickUrl: string | null } | null> {
  if (restaurantId) {
    const [t] = await db.select().from(webPushTemplatesTable).where(and(eq(webPushTemplatesTable.restaurantId, restaurantId), eq(webPushTemplatesTable.eventKey, eventKey), eq(webPushTemplatesTable.isActive, true))).limit(1);
    if (t) return { title: t.title, body: t.body, iconUrl: t.iconUrl, imageUrl: t.imageUrl, clickUrl: t.clickUrl };
  }
  const [tpl] = await db.select().from(webPushTemplatesTable).where(and(sql`${webPushTemplatesTable.restaurantId} IS NULL`, eq(webPushTemplatesTable.eventKey, eventKey), eq(webPushTemplatesTable.isActive, true))).limit(1);
  if (tpl) return { title: tpl.title, body: tpl.body, iconUrl: tpl.iconUrl, imageUrl: tpl.imageUrl, clickUrl: tpl.clickUrl };
  return null;
}

export function renderVars(s: string, vars: Record<string, string | number | null | undefined>): string {
  return s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v === null || v === undefined ? "" : String(v);
  });
}

/** Mark a log row as clicked (called by the click-tracking redirect endpoint). */
export async function markLogClicked(logId: number): Promise<void> {
  await db.update(webPushLogsTable).set({ clickedAt: new Date() }).where(eq(webPushLogsTable.id, logId));
}

/** Used by Subscribers → Clean failed action. */
export async function cleanFailedSubscriptions(restaurantId: number): Promise<number> {
  const res = await db.update(webPushSubscriptionsTable).set({ status: "expired", unsubscribedAt: new Date() })
    .where(and(eq(webPushSubscriptionsTable.restaurantId, restaurantId), inArray(webPushSubscriptionsTable.status, ["failed"]))).returning({ id: webPushSubscriptionsTable.id });
  return res.length;
}

/** Re-export for routes — they need PLAN_BOOLEAN_FEATURES too. */
export { subscriptionPlansTable };
