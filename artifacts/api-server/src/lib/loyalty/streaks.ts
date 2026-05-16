import { eq, and } from "drizzle-orm";
import { db, loyaltyStreakStateTable } from "../db";
import type { StreakConfig } from "./types";

function startOfWindow(date: Date, kind: "day" | "week"): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  if (kind === "week") {
    const dayIdx = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dayIdx);
  }
  return d.getTime();
}

export async function recordVisitForStreak(args: {
  restaurantId: number; customerId: number; cfg: StreakConfig; at?: Date;
}): Promise<{ streak: number; rewardEarned: boolean }> {
  if (!args.cfg.enabled) return { streak: 0, rewardEarned: false };
  const now = args.at ?? new Date();
  const winMs = args.cfg.windowKind === "week" ? 7 * 86400_000 : 86400_000;

  const [existing] = await db.select().from(loyaltyStreakStateTable).where(and(
    eq(loyaltyStreakStateTable.restaurantId, args.restaurantId),
    eq(loyaltyStreakStateTable.customerId, args.customerId),
  ));

  let streak = 1;
  if (existing && existing.lastVisitAt) {
    const lastWin = startOfWindow(existing.lastVisitAt, args.cfg.windowKind);
    const nowWin = startOfWindow(now, args.cfg.windowKind);
    if (nowWin === lastWin) {
      streak = existing.currentStreak;
    } else if (nowWin === lastWin + winMs) {
      streak = existing.currentStreak + 1;
    } else if (nowWin > lastWin + winMs) {
      streak = 1;
    } else {
      streak = existing.currentStreak;
    }
  }

  const rewardEarned = args.cfg.targetStreak > 0 && streak >= args.cfg.targetStreak && streak !== existing?.currentStreak;
  const longest = Math.max(existing?.longestStreak ?? 0, streak);

  if (existing) {
    await db.update(loyaltyStreakStateTable).set({
      currentStreak: streak, longestStreak: longest, lastVisitAt: now,
      windowKind: args.cfg.windowKind, lastRewardedAt: rewardEarned ? now : existing.lastRewardedAt,
      updatedAt: new Date(),
    }).where(eq(loyaltyStreakStateTable.id, existing.id));
  } else {
    await db.insert(loyaltyStreakStateTable).values({
      restaurantId: args.restaurantId, customerId: args.customerId,
      currentStreak: streak, longestStreak: longest, lastVisitAt: now,
      windowKind: args.cfg.windowKind, lastRewardedAt: rewardEarned ? now : null,
    });
  }
  return { streak, rewardEarned };
}

export async function getStreakState(restaurantId: number, customerId: number) {
  const [row] = await db.select().from(loyaltyStreakStateTable).where(and(
    eq(loyaltyStreakStateTable.restaurantId, restaurantId),
    eq(loyaltyStreakStateTable.customerId, customerId),
  ));
  return row ?? null;
}
