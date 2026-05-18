import type { Request } from "express";
import { db, auditLogsTable, usersTable } from "./db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const REDACT_KEYS = new Set([
  "password",
  "passwordhash",
  "password_hash",
  "newpassword",
  "currentpassword",
  "apikey",
  "api_key",
  "secret",
  "secretkey",
  "secret_key",
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "cardnumber",
  "card_number",
  "cvv",
  "cvc",
  "smtppassword",
  "smtp_password",
  "webhooksecret",
  "webhook_secret",
  "clientsecret",
  "client_secret",
  "managerpin",
  "manager_pin",
  "managerpinhash",
  "manager_pin_hash",
  "authorization",
  "cookie",
  "privatekey",
  "private_key",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) !== null
    ? Object.getPrototypeOf(v) === Object.prototype
    : false;
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(k.toLowerCase())) {
        out[k] = "[REDACTED]";
      } else if (v && typeof v === "object") {
        out[k] = redact(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return value;
}

export function getClientIp(req: Pick<Request, "headers" | "ip" | "socket"> | undefined): string | null {
  if (!req) return null;
  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0]!.trim();
  if (Array.isArray(xff) && xff.length > 0) return String(xff[0]).split(",")[0]!.trim();
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

export function getUserAgent(req: Pick<Request, "headers"> | undefined): string | null {
  if (!req) return null;
  const ua = req.headers?.["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 1000) : null;
}

const userDisplayCache = new Map<number, { name: string | null; email: string | null; role: string | null; ts: number }>();
const CACHE_TTL_MS = 60_000;

async function resolveUserSnapshot(userId: number): Promise<{ display: string | null; role: string | null }> {
  const cached = userDisplayCache.get(userId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { display: cached.name ?? cached.email, role: cached.role };
  }
  const [u] = await db.select({ name: usersTable.name, email: usersTable.email, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!u) return { display: null, role: null };
  userDisplayCache.set(userId, { name: u.name, email: u.email, role: u.role, ts: Date.now() });
  return { display: u.name ?? u.email, role: u.role };
}

export interface AuditInput {
  req?: Pick<Request, "headers" | "ip" | "socket" | "user"> & { user?: { sub?: number; id?: number; role?: string; isSuperAdmin?: boolean; tenantId?: number | null; restaurantId?: number | null; email?: string } };
  module: string;
  action: string;
  entity?: string;
  entityId?: number | string | null;
  restaurantId?: number | null;
  targetRestaurantId?: number | null;
  oldValue?: unknown;
  newValue?: unknown;
  details?: string | null;
  // Override actor (e.g. failed login: user is null but we know the attempted email)
  userId?: number | null;
  userDisplay?: string | null;
  role?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export async function recordAuditLog(input: AuditInput): Promise<void> {
  try {
    const reqUser = input.req?.user as { sub?: number; id?: number; role?: string; isSuperAdmin?: boolean; tenantId?: number | null; restaurantId?: number | null; email?: string } | undefined;
    let userId = input.userId !== undefined ? input.userId : (reqUser?.sub ?? reqUser?.id ?? null);
    let userDisplay = input.userDisplay ?? null;
    let role = input.role ?? null;

    if (userId && (!userDisplay || !role)) {
      const snap = await resolveUserSnapshot(userId);
      if (!userDisplay) userDisplay = snap.display ?? reqUser?.email ?? null;
      if (!role) role = snap.role ?? (reqUser?.isSuperAdmin ? "super_admin" : reqUser?.role ?? null);
    } else if (!userId && !userDisplay) {
      userDisplay = reqUser?.email ?? null;
    }
    if (!role && reqUser) {
      role = reqUser.isSuperAdmin ? "super_admin" : reqUser.role ?? null;
    }

    const ip = input.ip ?? getClientIp(input.req);
    const userAgent = input.userAgent ?? getUserAgent(input.req);

    const restaurantId = input.restaurantId !== undefined
      ? input.restaurantId
      : (reqUser?.isSuperAdmin ? null : reqUser?.restaurantId ?? null);

    const oldValue = input.oldValue !== undefined ? redact(input.oldValue) : null;
    const newValue = input.newValue !== undefined ? redact(input.newValue) : null;

    await db.insert(auditLogsTable).values({
      restaurantId: restaurantId ?? null,
      targetRestaurantId: input.targetRestaurantId ?? null,
      userId: userId ?? null,
      userDisplay,
      role,
      module: input.module,
      action: input.action,
      entity: input.entity ?? input.module,
      entityId: input.entityId == null ? null : (typeof input.entityId === "number" ? input.entityId : Number(input.entityId)) || null,
      details: input.details ?? null,
      // drizzle jsonb expects unknown — cast through unknown for safety
      oldValue: oldValue as never,
      newValue: newValue as never,
      ipAddress: ip ?? null,
      userAgent,
    });
  } catch (err) {
    // Audit failure must never break the request flow.
    logger.warn({ err, module: input.module, action: input.action }, "audit log write failed");
  }
}
