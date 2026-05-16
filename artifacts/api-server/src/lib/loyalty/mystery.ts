import { eq, and, count } from "drizzle-orm";
import { db, loyaltyMysteryGrantsTable, ordersTable } from "../db";
import type { MysteryConfig, MysteryRewardOption } from "./types";

export function pickWeighted(pool: MysteryRewardOption[], rng: () => number = Math.random): MysteryRewardOption | null {
  if (pool.length === 0) return null;
  const total = pool.reduce((s, p) => s + Math.max(0, p.weight), 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const p of pool) {
    r -= Math.max(0, p.weight);
    if (r <= 0) return p;
  }
  return pool[pool.length - 1];
}

export async function maybeGrantMystery(args: {
  restaurantId: number; customerId: number; orderId?: number;
  cfg: MysteryConfig; orderCountForCustomer?: number;
}): Promise<{ granted: false } | { granted: true; reward: MysteryRewardOption; grantId: number }> {
  if (!args.cfg.enabled || args.cfg.pool.length === 0) return { granted: false };

  let shouldDraw = false;
  if (args.cfg.triggerKind === "order_count") {
    const cnt = args.orderCountForCustomer ?? (await db.select({ c: count() }).from(ordersTable)
      .where(and(eq(ordersTable.restaurantId, args.restaurantId), eq(ordersTable.customerId, args.customerId)))
    )[0]?.c ?? 0;
    shouldDraw = Number(cnt) > 0 && args.cfg.triggerValue > 0 && Number(cnt) % args.cfg.triggerValue === 0;
  } else if (args.cfg.triggerKind === "order_chance") {
    shouldDraw = Math.random() < (args.cfg.triggerValue ?? 0) / 100;
  } else if (args.cfg.triggerKind === "scratch") {
    shouldDraw = true;
  }
  if (!shouldDraw) return { granted: false };

  const reward = pickWeighted(args.cfg.pool);
  if (!reward) return { granted: false };

  const [grant] = await db.insert(loyaltyMysteryGrantsTable).values({
    restaurantId: args.restaurantId, customerId: args.customerId,
    rewardKey: reward.key, rewardLabel: reward.label,
    rewardData: { rewardType: reward.rewardType, rewardValue: reward.rewardValue },
    orderId: args.orderId ?? null,
    status: args.cfg.triggerKind === "scratch" ? "granted" : "granted",
  }).returning();
  return { granted: true, reward, grantId: grant.id };
}

export async function listMysteryGrants(restaurantId: number, customerId: number, limit = 20) {
  const rows = await db.select().from(loyaltyMysteryGrantsTable).where(and(
    eq(loyaltyMysteryGrantsTable.restaurantId, restaurantId),
    eq(loyaltyMysteryGrantsTable.customerId, customerId),
  )).limit(limit);
  return rows;
}

export async function revealMysteryGrant(restaurantId: number, customerId: number, id: number) {
  const [row] = await db.update(loyaltyMysteryGrantsTable).set({
    revealedAt: new Date(), status: "revealed",
  }).where(and(
    eq(loyaltyMysteryGrantsTable.id, id),
    eq(loyaltyMysteryGrantsTable.restaurantId, restaurantId),
    eq(loyaltyMysteryGrantsTable.customerId, customerId),
  )).returning();
  return row ?? null;
}
