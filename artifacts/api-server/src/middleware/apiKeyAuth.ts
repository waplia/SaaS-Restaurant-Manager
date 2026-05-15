import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, apiKeysTable } from "../lib/db";
import {
  countRecentRequests,
  findKeyByPlaintext,
  getEffectiveRateLimit,
  getGlobalSettings,
  logRequest,
} from "../lib/apiKeys";

declare global {
  namespace Express {
    interface Request {
      apiKey?: { id: number; restaurantId: number };
    }
  }
}

/**
 * Authenticates a public API request via `Authorization: Bearer <key>`.
 * Enforces the global API enabled flag and per-key/per-restaurant rate limits.
 * Always logs the result to api_request_logs (success or failure).
 */
export async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const start = Date.now();
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null;
  const endpoint = req.originalUrl.split("?")[0] ?? req.path;
  const method = req.method;

  async function reject(status: number, message: string, code: string, apiKeyId: number | null = null, restaurantId: number | null = null): Promise<void> {
    await logRequest({
      restaurantId,
      apiKeyId,
      endpoint,
      method,
      statusCode: status,
      latencyMs: Date.now() - start,
      ipAddress: ip,
    });
    res.status(status).json({ error: { code, message } });
  }

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    await reject(401, "Missing Authorization: Bearer <api_key> header", "missing_credentials");
    return;
  }
  const token = auth.slice(7).trim();

  const key = await findKeyByPlaintext(token);
  if (!key) {
    await reject(401, "Invalid API key", "invalid_key");
    return;
  }
  if (key.revokedAt) {
    await reject(401, "API key has been revoked", "revoked_key", key.id, key.restaurantId);
    return;
  }

  const settings = await getGlobalSettings();
  if (!settings.apiEnabled) {
    await reject(503, "Public API is currently disabled by the platform", "api_disabled", key.id, key.restaurantId);
    return;
  }

  const limit = await getEffectiveRateLimit(key.restaurantId, key);
  const recent = await countRecentRequests(key.id);
  if (recent >= limit) {
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", "0");
    await reject(429, `Rate limit exceeded (${limit} requests/min)`, "rate_limited", key.id, key.restaurantId);
    return;
  }

  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - recent - 1)));

  req.apiKey = { id: key.id, restaurantId: key.restaurantId };

  // Update last used (best-effort, fire-and-forget)
  db.update(apiKeysTable).set({ lastUsedAt: new Date() }).where(eq(apiKeysTable.id, key.id)).catch(() => {});

  // Hook into res.finish to log completion
  res.on("finish", () => {
    void logRequest({
      restaurantId: key.restaurantId,
      apiKeyId: key.id,
      endpoint,
      method,
      statusCode: res.statusCode,
      latencyMs: Date.now() - start,
      ipAddress: ip,
    });
  });

  next();
}
