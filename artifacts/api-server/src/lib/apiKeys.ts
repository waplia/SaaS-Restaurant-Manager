import crypto from "crypto";
import { eq, and, gte, sql } from "drizzle-orm";
import {
  db,
  apiKeysTable,
  apiGlobalSettingsTable,
  restaurantApiOverridesTable,
  apiRequestLogsTable,
  type ApiGlobalSettings,
  type ApiKey,
  type ApiKeyEnvironment,
  type RestaurantApiOverride,
} from "./db";

const LIVE_PREFIX = "kl_live_";
const SANDBOX_PREFIX = "kl_test_";

export function generateApiKey(env: ApiKeyEnvironment = "live"): { fullKey: string; prefix: string; hashed: string } {
  const random = crypto.randomBytes(32).toString("base64url");
  const base = env === "sandbox" ? SANDBOX_PREFIX : LIVE_PREFIX;
  const fullKey = `${base}${random}`;
  const prefix = fullKey.slice(0, 12);
  const hashed = hashKey(fullKey);
  return { fullKey, prefix, hashed };
}

export function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export async function getGlobalSettings(): Promise<ApiGlobalSettings> {
  const [row] = await db.select().from(apiGlobalSettingsTable).where(eq(apiGlobalSettingsTable.id, 1));
  if (row) return row;
  const [created] = await db
    .insert(apiGlobalSettingsTable)
    .values({ id: 1 })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [reread] = await db.select().from(apiGlobalSettingsTable).where(eq(apiGlobalSettingsTable.id, 1));
  return reread!;
}

export async function getRestaurantOverride(restaurantId: number): Promise<RestaurantApiOverride | null> {
  const [row] = await db
    .select()
    .from(restaurantApiOverridesTable)
    .where(eq(restaurantApiOverridesTable.restaurantId, restaurantId));
  return row ?? null;
}

export async function getEffectiveRateLimit(restaurantId: number, key: ApiKey): Promise<number> {
  if (key.rateLimitPerMin && key.rateLimitPerMin > 0) return key.rateLimitPerMin;
  const override = await getRestaurantOverride(restaurantId);
  if (override?.rateLimitPerMin && override.rateLimitPerMin > 0) return override.rateLimitPerMin;
  const settings = await getGlobalSettings();
  return settings.defaultRateLimitPerMin;
}

export async function findKeyByPlaintext(plaintext: string): Promise<ApiKey | null> {
  const hashed = hashKey(plaintext);
  const [row] = await db.select().from(apiKeysTable).where(eq(apiKeysTable.hashedKey, hashed));
  return row ?? null;
}

/** Count requests for the api key in the last 60 seconds. */
export async function countRecentRequests(apiKeyId: number): Promise<number> {
  const since = new Date(Date.now() - 60_000);
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(apiRequestLogsTable)
    .where(and(eq(apiRequestLogsTable.apiKeyId, apiKeyId), gte(apiRequestLogsTable.createdAt, since)));
  return row?.c ?? 0;
}

export async function logRequest(args: {
  restaurantId: number | null;
  apiKeyId: number | null;
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  ipAddress: string | null;
}): Promise<void> {
  try {
    await db.insert(apiRequestLogsTable).values(args);
  } catch {
    // log table failure must never break the request flow
  }
}

/**
 * Returns true when the key has the given scope. A key with an empty scope list
 * is treated as legacy "full access" (backward compatible with keys created
 * before scope support shipped).
 */
export function keyHasScope(key: Pick<ApiKey, "scopes">, scope: string): boolean {
  if (!key.scopes || key.scopes.length === 0) return true;
  return key.scopes.includes(scope);
}
