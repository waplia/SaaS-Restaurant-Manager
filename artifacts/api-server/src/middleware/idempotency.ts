import type { Request, Response, NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db, idempotencyKeysTable } from "../lib/db";

/**
 * Server-side idempotency for POS writes that may be retried by the
 * offline queue (web + mobile). When a client sends `X-Idempotency-Key`
 * along with a write to a queueable POS endpoint, we:
 *
 *   1. Look up (restaurantId, key). If a row exists, replay the stored
 *      status + body so a duplicate retry — caused by a lost response
 *      or by an online flush of a previously-queued write — produces
 *      the same outcome instead of creating a duplicate order/payment.
 *   2. Otherwise let the route handler run, capture its JSON response,
 *      and persist it under the key on success (2xx). Non-2xx responses
 *      are deliberately NOT stored: we want the client to retry until
 *      the operation actually succeeds.
 *
 * Keys are restaurant-scoped (a unique index enforces this at the DB
 * level), which also serves as a defense against cross-tenant replay.
 */
export function idempotency() {
  return async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
    const headerKey = req.header("x-idempotency-key") || req.header("X-Idempotency-Key");
    if (!headerKey) return next();
    const key = String(headerKey).trim();
    if (!key) return next();
    const restaurantId = Number(req.params.restaurantId);
    if (!Number.isFinite(restaurantId) || restaurantId <= 0) return next();

    try {
      const [existing] = await db
        .select()
        .from(idempotencyKeysTable)
        .where(and(eq(idempotencyKeysTable.restaurantId, restaurantId), eq(idempotencyKeysTable.key, key)))
        .limit(1);
      if (existing) {
        res.setHeader("X-Idempotent-Replay", "1");
        res.status(existing.statusCode).json(existing.responseBody ?? {});
        return;
      }
    } catch {
      // If the cache lookup fails (DB blip), fall through and run the
      // handler normally. Worst case: no dedupe for this one request.
    }

    const origJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const status = res.statusCode || 200;
      if (status >= 200 && status < 300) {
        const userId = (req as Request & { user?: { id?: number } }).user?.id ?? null;
        // Fire-and-forget: don't block the response on cache write.
        // Unique index will naturally drop a racing duplicate insert.
        db.insert(idempotencyKeysTable)
          .values({
            restaurantId,
            key,
            route: req.originalUrl.split("?")[0] || req.path,
            method: req.method,
            userId: userId ?? undefined,
            statusCode: status,
            responseBody: (body ?? null) as unknown as object,
          })
          .onConflictDoNothing()
          .catch(() => {});
      }
      return origJson(body);
    };
    next();
  };
}
