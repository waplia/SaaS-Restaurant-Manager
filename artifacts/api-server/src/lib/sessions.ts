import crypto from "node:crypto";
import type { Request } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, userSessionsTable } from "./db";

// Short cache of (sid -> revoked?) so the per-request session check does not
// hit the DB on every authenticated call. Mirrors the tokenVersion cache in
// `authenticate` — 30s window caps how long a revoked token can keep working.
const SESSION_TTL_MS = 30_000;
const sessionCache = new Map<number, { jti: string; revoked: boolean; exp: number }>();

export function invalidateSessionCache(sid: number): void {
  sessionCache.delete(sid);
}

interface CachedSession { jti: string; revoked: boolean }

async function loadSession(sid: number): Promise<CachedSession | null> {
  const now = Date.now();
  const cached = sessionCache.get(sid);
  if (cached && cached.exp > now) return { jti: cached.jti, revoked: cached.revoked };
  const [row] = await db
    .select({ jti: userSessionsTable.jti, revokedAt: userSessionsTable.revokedAt })
    .from(userSessionsTable)
    .where(eq(userSessionsTable.id, sid));
  if (!row) return null;
  const entry = { jti: row.jti, revoked: row.revokedAt != null };
  sessionCache.set(sid, { ...entry, exp: now + SESSION_TTL_MS });
  return entry;
}

export async function isSessionActive(sid: number, jti: string | undefined): Promise<boolean> {
  if (!jti) return false;
  const s = await loadSession(sid);
  if (!s) return false;
  if (s.revoked) return false;
  return s.jti === jti;
}

export function extractIp(req: Request): string | null {
  // Use Express's resolved `req.ip` so we only honour `X-Forwarded-For`
  // entries from proxies whitelisted via `app.set("trust proxy", …)`.
  const raw = req.ip ?? req.socket.remoteAddress ?? null;
  return raw ? raw.toString().slice(0, 64) : null;
}

export function extractUserAgent(req: Request): string | null {
  const ua = req.headers["user-agent"];
  if (!ua) return null;
  return String(ua).slice(0, 512);
}

// Best-effort human label like "Chrome on macOS" so the sessions list reads
// as device names rather than raw UA strings. Cheap regex-based parsing;
// good enough for the settings UI and we keep the raw UA alongside it.
export function labelFromUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";
  else if (/curl\//i.test(ua)) browser = "curl";
  else if (/PostmanRuntime/i.test(ua)) browser = "Postman";

  let os = "Unknown";
  if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/Windows NT/.test(ua)) os = "Windows";
  else if (/Linux/.test(ua)) os = "Linux";

  return `${browser} on ${os}`;
}

export interface CreateSessionInput {
  userId: number;
  req: Request;
}

export interface CreatedSession {
  id: number;
  jti: string;
}

export async function createSession({ userId, req }: CreateSessionInput): Promise<CreatedSession> {
  const jti = crypto.randomBytes(18).toString("base64url");
  const ua = extractUserAgent(req);
  const [row] = await db.insert(userSessionsTable).values({
    userId,
    jti,
    deviceLabel: labelFromUserAgent(ua),
    ip: extractIp(req),
    userAgent: ua,
  }).returning({ id: userSessionsTable.id });
  return { id: row.id, jti };
}

// Refresh path: rotate jti, update last-seen/ip/ua. Rotating the jti means a
// stolen-then-replayed refresh token will fail (its jti no longer matches
// the row) — only the device that completed the most recent refresh can
// continue. Returns null if the session is revoked or jti doesn't match.
export async function rotateSession(sid: number, currentJti: string, req: Request): Promise<CreatedSession | null> {
  const newJti = crypto.randomBytes(18).toString("base64url");
  const ua = extractUserAgent(req);
  const [updated] = await db
    .update(userSessionsTable)
    .set({
      jti: newJti,
      lastUsedAt: new Date(),
      ip: extractIp(req),
      userAgent: ua,
      deviceLabel: labelFromUserAgent(ua),
    })
    .where(and(
      eq(userSessionsTable.id, sid),
      eq(userSessionsTable.jti, currentJti),
      isNull(userSessionsTable.revokedAt),
    ))
    .returning({ id: userSessionsTable.id });
  if (!updated) return null;
  invalidateSessionCache(sid);
  return { id: updated.id, jti: newJti };
}

export async function revokeSession(sid: number, userId: number): Promise<boolean> {
  const result = await db
    .update(userSessionsTable)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(userSessionsTable.id, sid),
      eq(userSessionsTable.userId, userId),
      isNull(userSessionsTable.revokedAt),
    ))
    .returning({ id: userSessionsTable.id });
  invalidateSessionCache(sid);
  return result.length > 0;
}

export async function revokeAllSessions(userId: number): Promise<void> {
  const rows = await db
    .update(userSessionsTable)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(userSessionsTable.userId, userId),
      isNull(userSessionsTable.revokedAt),
    ))
    .returning({ id: userSessionsTable.id });
  for (const r of rows) invalidateSessionCache(r.id);
}
