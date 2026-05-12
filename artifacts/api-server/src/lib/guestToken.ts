import { createHmac } from "crypto";

const SECRET = process.env.JWT_SECRET ?? "tabletrack-dev-secret-change-in-production";

export function generateGuestToken(orderId: number): string {
  return createHmac("sha256", SECRET).update(`guest-order-${orderId}`).digest("hex").slice(0, 32);
}

export function validateGuestToken(orderId: number, token: string | undefined): boolean {
  if (!token) return false;
  return generateGuestToken(orderId) === token;
}
