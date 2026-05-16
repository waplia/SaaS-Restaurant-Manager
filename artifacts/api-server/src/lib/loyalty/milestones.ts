import { eq, and, gte, sql } from "drizzle-orm";
import { db, loyaltyMilestoneGrantsTable, ordersTable } from "../db";
import type { MilestoneConfig, MilestoneTier } from "./types";

export async function checkMilestonesForCustomer(args: {
  restaurantId: number; customerId: number; cfg: MilestoneConfig;
}): Promise<MilestoneTier[]> {
  if (!args.cfg.enabled || args.cfg.tiers.length === 0) return [];

  let totalSpend = 0;
  if (args.cfg.windowDays > 0) {
    const since = new Date(Date.now() - args.cfg.windowDays * 86400_000);
    const rows = await db.select({ s: sql<number>`COALESCE(SUM(${ordersTable.totalAmount}), 0)` })
      .from(ordersTable).where(and(
        eq(ordersTable.restaurantId, args.restaurantId),
        eq(ordersTable.customerId, args.customerId),
        eq(ordersTable.status, "completed"),
        gte(ordersTable.createdAt, since),
      ));
    totalSpend = Number(rows[0]?.s ?? 0);
  } else {
    const rows = await db.select({ s: sql<number>`COALESCE(SUM(${ordersTable.totalAmount}), 0)` })
      .from(ordersTable).where(and(
        eq(ordersTable.restaurantId, args.restaurantId),
        eq(ordersTable.customerId, args.customerId),
        eq(ordersTable.status, "completed"),
      ));
    totalSpend = Number(rows[0]?.s ?? 0);
  }

  const granted = await db.select().from(loyaltyMilestoneGrantsTable).where(and(
    eq(loyaltyMilestoneGrantsTable.restaurantId, args.restaurantId),
    eq(loyaltyMilestoneGrantsTable.customerId, args.customerId),
  ));
  const grantedKeys = new Set(granted.map(g => g.milestoneKey));
  const newly: MilestoneTier[] = [];
  for (const tier of args.cfg.tiers) {
    if (totalSpend >= tier.threshold && !grantedKeys.has(tier.key)) {
      await db.insert(loyaltyMilestoneGrantsTable).values({
        restaurantId: args.restaurantId, customerId: args.customerId,
        milestoneKey: tier.key, threshold: tier.threshold.toFixed(2),
        rewardSummary: { rewardType: tier.rewardType, rewardValue: tier.rewardValue },
      }).onConflictDoNothing();
      newly.push(tier);
    }
  }
  return newly;
}
