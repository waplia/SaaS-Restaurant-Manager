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
  email: string;
  role: string;
  tenantId: number | null;
  restaurantId: number | null;
  isSuperAdmin: boolean;
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
