import { eq, and, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, orderDiscountsTable, restaurantSettingsTable } from "./db";

export interface DiscountsConfig {
  presetReasons: string[];
  thresholdPercent: number;
  thresholdAmount: number;
  hasManagerPin: boolean;
  managerPinHash: string | null;
}

const DEFAULT_REASONS = [
  "Loyal customer",
  "Comp item",
  "Manager override",
  "Damaged / quality issue",
  "Promo / marketing",
  "Staff meal",
];

interface RawDiscountsConfig {
  presetReasons?: unknown;
  thresholdPercent?: unknown;
  thresholdAmount?: unknown;
  managerPinHash?: unknown;
}

export async function loadDiscountsConfig(restaurantId: number): Promise<DiscountsConfig> {
  const [row] = await db.select().from(restaurantSettingsTable).where(and(
    eq(restaurantSettingsTable.restaurantId, restaurantId),
    eq(restaurantSettingsTable.section, "discounts"),
  ));
  const data = (row?.data ?? {}) as RawDiscountsConfig;
  const presetReasons = Array.isArray(data.presetReasons) && data.presetReasons.length > 0
    ? data.presetReasons.filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    : DEFAULT_REASONS;
  const thresholdPercent = Number(data.thresholdPercent ?? 15);
  const thresholdAmount = Number(data.thresholdAmount ?? 500);
  const managerPinHash = typeof data.managerPinHash === "string" && data.managerPinHash.length > 0
    ? data.managerPinHash : null;
  return {
    presetReasons,
    thresholdPercent: isFinite(thresholdPercent) && thresholdPercent > 0 ? thresholdPercent : 15,
    thresholdAmount: isFinite(thresholdAmount) && thresholdAmount > 0 ? thresholdAmount : 500,
    hasManagerPin: !!managerPinHash,
    managerPinHash,
  };
}

export function exceedsThreshold(amount: number, subtotal: number, cfg: DiscountsConfig): boolean {
  if (subtotal <= 0) return amount > 0; // any discount on an empty order needs approval
  const pct = (amount / subtotal) * 100;
  return pct >= cfg.thresholdPercent || amount >= cfg.thresholdAmount;
}

export async function verifyManagerPin(pin: string, cfg: DiscountsConfig): Promise<boolean> {
  if (!cfg.managerPinHash) return false;
  const candidate = String(pin ?? "").trim();
  if (!candidate) return false;
  return bcrypt.compare(candidate, cfg.managerPinHash);
}

export async function hashManagerPin(pin: string): Promise<string> {
  return bcrypt.hash(String(pin), 10);
}

export async function sumOrderDiscounts(orderId: number): Promise<number> {
  const [row] = await db.select({ total: sql<string>`COALESCE(SUM(${orderDiscountsTable.amount}), 0)` })
    .from(orderDiscountsTable).where(eq(orderDiscountsTable.orderId, orderId));
  return Number(row?.total ?? 0);
}

export async function listOrderDiscounts(orderId: number) {
  return db.select().from(orderDiscountsTable)
    .where(eq(orderDiscountsTable.orderId, orderId))
    .orderBy(orderDiscountsTable.createdAt);
}

export async function deleteOrderDiscountsByType(orderId: number, type: string): Promise<void> {
  await db.delete(orderDiscountsTable)
    .where(and(eq(orderDiscountsTable.orderId, orderId), eq(orderDiscountsTable.type, type)));
}
