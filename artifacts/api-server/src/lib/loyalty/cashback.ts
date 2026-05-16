import { eq, and, sql } from "drizzle-orm";
import { db, loyaltyCashbackWalletsTable, loyaltyCashbackTxnsTable } from "../db";
import type { CashbackConfig } from "./types";

export async function getOrCreateWallet(restaurantId: number, customerId: number) {
  const [existing] = await db.select().from(loyaltyCashbackWalletsTable).where(and(
    eq(loyaltyCashbackWalletsTable.restaurantId, restaurantId),
    eq(loyaltyCashbackWalletsTable.customerId, customerId),
  ));
  if (existing) return existing;
  const [created] = await db.insert(loyaltyCashbackWalletsTable).values({ restaurantId, customerId }).returning();
  return created;
}

export async function creditCashback(args: {
  restaurantId: number; customerId: number;
  amount: number; reason: string; orderId?: number; expiryDays?: number;
}) {
  if (args.amount <= 0) return;
  await getOrCreateWallet(args.restaurantId, args.customerId);
  const expiresAt = args.expiryDays && args.expiryDays > 0
    ? new Date(Date.now() + args.expiryDays * 86400_000) : null;
  await db.insert(loyaltyCashbackTxnsTable).values({
    restaurantId: args.restaurantId, customerId: args.customerId,
    amount: args.amount.toFixed(2), type: "credit", reason: args.reason,
    orderId: args.orderId ?? null, expiresAt,
  });
  await db.update(loyaltyCashbackWalletsTable).set({
    balance: sql`${loyaltyCashbackWalletsTable.balance} + ${args.amount}`,
    lifetimeIssued: sql`${loyaltyCashbackWalletsTable.lifetimeIssued} + ${args.amount}`,
    updatedAt: new Date(),
  }).where(and(
    eq(loyaltyCashbackWalletsTable.restaurantId, args.restaurantId),
    eq(loyaltyCashbackWalletsTable.customerId, args.customerId),
  ));
}

export async function debitCashback(args: {
  restaurantId: number; customerId: number;
  amount: number; reason: string; orderId?: number;
}) {
  if (args.amount <= 0) return 0;
  const wallet = await getOrCreateWallet(args.restaurantId, args.customerId);
  const available = Number(wallet.balance);
  const debit = Math.min(available, args.amount);
  if (debit <= 0) return 0;
  await db.insert(loyaltyCashbackTxnsTable).values({
    restaurantId: args.restaurantId, customerId: args.customerId,
    amount: (-debit).toFixed(2), type: "redeem", reason: args.reason,
    orderId: args.orderId ?? null,
  });
  await db.update(loyaltyCashbackWalletsTable).set({
    balance: sql`GREATEST(0, ${loyaltyCashbackWalletsTable.balance} - ${debit})`,
    lifetimeRedeemed: sql`${loyaltyCashbackWalletsTable.lifetimeRedeemed} + ${debit}`,
    updatedAt: new Date(),
  }).where(and(
    eq(loyaltyCashbackWalletsTable.restaurantId, args.restaurantId),
    eq(loyaltyCashbackWalletsTable.customerId, args.customerId),
  ));
  return debit;
}

export function computeRedeemableCashback(walletBalance: number, orderSubtotal: number, cfg: CashbackConfig): number {
  if (!cfg.enabled) return 0;
  if (orderSubtotal < (cfg.minOrderAmount ?? 0)) return 0;
  if (walletBalance < (cfg.minRedeemAmount ?? 0)) return 0;
  const cap = orderSubtotal * (Math.max(0, Math.min(100, cfg.maxRedeemPercent ?? 100)) / 100);
  return Math.max(0, Math.min(walletBalance, cap));
}

export function computeCashbackEarn(orderSubtotal: number, cfg: CashbackConfig): number {
  if (!cfg.enabled) return 0;
  if (orderSubtotal < (cfg.minOrderAmount ?? 0)) return 0;
  return Math.max(0, +(orderSubtotal * (cfg.percent ?? 0) / 100).toFixed(2));
}
