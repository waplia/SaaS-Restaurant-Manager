import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const isDev = process.env.NODE_ENV === "development";
const JWT_SECRET = process.env.JWT_SECRET ?? (isDev ? "tabletrack-dev-secret-change-in-production" : "");
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required in production");
}

const RESET_SECRET = process.env.JWT_RESET_SECRET ?? (isDev ? "tabletrack-reset-dev-secret" : "");
if (!RESET_SECRET) {
  throw new Error("JWT_RESET_SECRET environment variable is required in production");
}

const ACCESS_TOKEN_EXPIRY = "24h";
const REFRESH_TOKEN_EXPIRY = "7d";
const RESET_TOKEN_EXPIRY = "1h";
const IMPERSONATION_TOKEN_EXPIRY = "15m";

export const SALT_ROUNDS = 10;

export interface JwtPayload {
  sub: number;
  /** Convenience alias for `sub` (populated by the `authenticate` middleware
   * so route handlers can read `req.user?.id` ergonomically). */
  id?: number;
  email: string;
  /** Best-effort display name copied from the user row by `authenticate`. */
  name?: string | null;
  /** Best-effort phone copied from the user row by `authenticate`. */
  phone?: string | null;
  role: string;
  tenantId: number | null;
  restaurantId: number | null;
  isSuperAdmin: boolean;
  /** Token-version stamp at issue time. Re-checked in `authenticate` so the
   * server can invalidate every existing JWT for a user by bumping
   * `users.tokenVersion` (logout-everywhere / password change / force revoke). */
  tv?: number;
  /** Per-device session id. Tokens carrying `sid` are checked against
   * `user_sessions.revokedAt` in `authenticate` so owners can sign out
   * one device without nuking every other login. Legacy tokens (issued
   * before this feature shipped) lack `sid` and fall back to the
   * tokenVersion check only. */
  sid?: number;
  /** Random per-session identifier embedded in the JWT and stored on
   * the session row, so we can also detect cross-session token replay
   * (a revoked-then-recreated session can't reuse an old token). */
  jti?: string;
  type: "access" | "refresh";
  impersonated?: boolean;
}

export interface ResetPayload {
  sub: number;
  email: string;
  type: "reset";
}

export function signAccessToken(payload: Omit<JwtPayload, "type">): string {
  return jwt.sign({ ...payload, type: "access" }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function signImpersonationToken(payload: Omit<JwtPayload, "type">): string {
  return jwt.sign({ ...payload, type: "access", impersonated: true }, JWT_SECRET, { expiresIn: IMPERSONATION_TOKEN_EXPIRY });
}

export function signRefreshToken(payload: Omit<JwtPayload, "type">): string {
  return jwt.sign({ ...payload, type: "refresh" }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
}

export function signResetToken(payload: Omit<ResetPayload, "type">): string {
  return jwt.sign({ ...payload, type: "reset" }, RESET_SECRET, { expiresIn: RESET_TOKEN_EXPIRY });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as unknown as JwtPayload;
}

export function verifyResetToken(token: string): ResetPayload {
  return jwt.verify(token, RESET_SECRET) as unknown as ResetPayload;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
