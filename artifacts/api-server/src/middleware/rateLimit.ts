import type { Request, Response, NextFunction } from "express";

/**
 * Tiny in-memory sliding-window rate limiter. Good enough for a single-node
 * API server; if we move to multi-node we should swap the bucket store for
 * Redis. Kept dependency-free on purpose.
 */
interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

function clientKey(req: Request): string {
  // Use Express's resolved `req.ip` so we only honour `X-Forwarded-For`
  // values that pass through the proxies configured by `app.set("trust proxy", …)`.
  // Reading the raw header here would let any attacker rotate the limiter
  // key by spoofing the header and defeat brute-force protection.
  return (req.ip || req.socket.remoteAddress || "unknown").toString();
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Optional extra discriminator (e.g. lower-cased email). When `ignoreIp`
   * is true the limiter keys off this value alone — useful to stack a
   * per-email bucket on top of a per-IP bucket so neither dimension can be
   * circumvented by varying the other. */
  keyExtra?: (req: Request) => string | null;
  /** When true, drop the client IP from the key so the bucket is shared
   * across all sources for the same `keyExtra` value. */
  ignoreIp?: boolean;
  /** Header-friendly name surfaced in the 429 body for ops triage. */
  name: string;
}

// In non-production environments (Replit dev preview, local, tests) the
// preview iframe + the developer's own browser all share a single outbound
// IP, which makes the per-IP buckets fire constantly during testing
// (e.g. trying register a few times in a row hits the 5/hour cap and
// returns 429). Production is unaffected.
const RATE_LIMIT_BYPASSED =
  process.env.RATE_LIMIT_DISABLED === "1" ||
  (process.env.NODE_ENV !== "production" && process.env.RATE_LIMIT_DISABLED !== "0");

export function rateLimit(opts: RateLimitOptions) {
  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (RATE_LIMIT_BYPASSED) return next();
    const extra = opts.keyExtra?.(req) ?? "";
    if (opts.ignoreIp && !extra) {
      // No email yet (e.g. missing body field) — let the per-IP limiter
      // and downstream validators handle it instead of bucketing under "".
      return next();
    }
    const ipPart = opts.ignoreIp ? "_" : clientKey(req);
    const key = `${opts.name}:${ipPart}:${extra}`;
    const now = Date.now();
    const cutoff = now - opts.windowMs;

    const bucket = buckets.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((t) => t > cutoff);

    if (bucket.hits.length >= opts.max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.hits[0] + opts.windowMs - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({ error: "Too many requests, please try again later." });
      return;
    }

    bucket.hits.push(now);
    buckets.set(key, bucket);
    next();
  };
}

// Periodically prune empty buckets so the map cannot grow forever on a busy host.
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const pruneTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => t > now - 60 * 60 * 1000);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}, PRUNE_INTERVAL_MS);
pruneTimer.unref();
