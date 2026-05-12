import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET ?? "tabletrack-dev-secret-change-in-production";
const ACCESS_TOKEN_EXPIRY = "24h";
const REFRESH_TOKEN_EXPIRY = "7d";

export const SALT_ROUNDS = 10;

export interface JwtPayload {
  sub: number;
  email: string;
  role: string;
  tenantId: number | null;
  restaurantId: number | null;
  isSuperAdmin: boolean;
  type: "access" | "refresh";
}

export function signAccessToken(payload: Omit<JwtPayload, "type">): string {
  return jwt.sign({ ...payload, type: "access" }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function signRefreshToken(payload: Omit<JwtPayload, "type">): string {
  return jwt.sign({ ...payload, type: "refresh" }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as unknown as JwtPayload;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
