import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { verifyToken, type JwtPayload } from "../lib/auth";
import { db, usersTable } from "../lib/db";
import { isSessionActive } from "../lib/sessions";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// Tiny per-process cache so we do not hit the DB on every authenticated
// request just to look up `tokenVersion`. Entries expire after 30 s, which
// caps the worst-case window a revoked token can keep working at ~30 s.
const VERSION_TTL_MS = 30_000;
const versionCache = new Map<number, { v: number; exp: number }>();

async function currentTokenVersion(userId: number): Promise<number | null> {
  const now = Date.now();
  const cached = versionCache.get(userId);
  if (cached && cached.exp > now) return cached.v;
  const [row] = await db
    .select({ tokenVersion: usersTable.tokenVersion, isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!row || !row.isActive) return null;
  versionCache.set(userId, { v: row.tokenVersion, exp: now + VERSION_TTL_MS });
  return row.tokenVersion;
}

export function invalidateTokenVersionCache(userId: number): void {
  versionCache.delete(userId);
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = verifyToken(token);
    if (payload.type !== "access") {
      res.status(401).json({ error: "Refresh token cannot be used for API access" });
      return;
    }
    // Impersonation tokens are read-only: super-admin "view as" sessions
    // can browse but cannot mutate the tenant's data.
    if (payload.impersonated && req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      res.status(403).json({ error: "Impersonation session is read-only." });
      return;
    }
    // Stateful revocation check: every issued JWT carries the user's
    // `tokenVersion` at issue time. Bumping the column server-side
    // (logout-everywhere, password change/reset, force revoke) immediately
    // invalidates every existing token without us tracking each JWT.
    const current = await currentTokenVersion(payload.sub);
    if (current == null) {
      res.status(401).json({ error: "Session expired" });
      return;
    }
    // Post-cutover: every legitimately-issued token MUST carry `tv`.
    // Reject tokens missing the claim outright so any JWT minted before
    // this deploy is rejected immediately (rather than continuing to
    // work until its 24h/7d expiry).
    if (typeof payload.tv !== "number" || payload.tv !== current) {
      res.status(401).json({ error: "Session has been revoked, please sign in again" });
      return;
    }
    // Per-device revocation: tokens minted after the sessions feature
    // shipped carry `sid` + `jti`. If the row's revokedAt is set (or the
    // jti has been rotated past this token), reject just this device
    // without affecting the user's other sessions. Impersonation tokens
    // skip the check — they are minted ad-hoc without a session row.
    if (typeof payload.sid === "number" && !payload.impersonated) {
      const active = await isSessionActive(payload.sid, payload.jti);
      if (!active) {
        res.status(401).json({ error: "This device has been signed out" });
        return;
      }
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export async function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7);
    try {
      const payload = verifyToken(token);
      if (payload.type === "access") {
        const current = await currentTokenVersion(payload.sub);
        if (current != null && typeof payload.tv === "number" && payload.tv === current) {
          if (typeof payload.sid === "number" && !payload.impersonated) {
            if (await isSessionActive(payload.sid, payload.jti)) {
              req.user = payload;
            }
          } else {
            req.user = payload;
          }
        }
      }
    } catch {
      // silently ignore invalid optional tokens
    }
  }
  next();
}
