import { eq, and, isNotNull, lt, sql } from "drizzle-orm";
import {
  db, customersTable, restaurantsTable, notificationsTable,
  loyaltyStreakStateTable,
} from "../db";
import { logger } from "../logger";
import { loadLoyalty2Config, isEnabled } from "./config";
import { isBirthdayWithinWindow, hasBirthdayGrantThisYear, recordBirthdayGrant } from "./birthday";
import { checkMilestonesForCustomer } from "./milestones";
import { activeDoublePointsMultiplier } from "./doublePoints";
import { creditCashback } from "./cashback";

async function forEachActiveRestaurant(fn: (restaurantId: number) => Promise<void>) {
  const rows = await db.select({ id: restaurantsTable.id }).from(restaurantsTable);
  for (const r of rows) {
    try { await fn(r.id); }
    catch (e) { logger.error({ e, restaurantId: r.id }, "[Loyalty2 job] per-restaurant failure"); }
  }
}

export async function runBirthdayJob() {
  await forEachActiveRestaurant(async (restaurantId) => {
    const cfg = await loadLoyalty2Config(restaurantId);
    if (!isEnabled(cfg, "birthday")) return;

    const customers = await db.select().from(customersTable).where(and(
      eq(customersTable.restaurantId, restaurantId),
      isNotNull(customersTable.dateOfBirth),
    ));
    const year = new Date().getFullYear();
    let granted = 0;
    for (const c of customers) {
      if (!isBirthdayWithinWindow(c.dateOfBirth, cfg.birthday.windowDays)) continue;
      if (await hasBirthdayGrantThisYear(restaurantId, c.id, year)) continue;
      const reward = { rewardType: cfg.birthday.rewardType, rewardValue: cfg.birthday.rewardValue, year };
      if (cfg.birthday.rewardType === "points") {
        const pts = Math.max(0, Number(cfg.birthday.rewardValue) || 0);
        if (pts > 0) {
          await db.insert((await import("../db")).loyaltyTransactionsTable).values({
            customerId: c.id, restaurantId, points: pts, type: "earn", reason: `Birthday gift ${year}`,
          });
          await db.update(customersTable).set({
            loyaltyPoints: sql`${customersTable.loyaltyPoints} + ${pts}`, updatedAt: new Date(),
          }).where(eq(customersTable.id, c.id));
        }
      } else if (cfg.birthday.rewardType === "cashback") {
        await creditCashback({
          restaurantId, customerId: c.id,
          amount: Number(cfg.birthday.rewardValue) || 0,
          reason: `Birthday gift ${year}`, expiryDays: 30,
        });
      }
      await recordBirthdayGrant(restaurantId, c.id, year, reward);
      if (cfg.birthday.notify) {
        await db.insert(notificationsTable).values({
          restaurantId, type: "birthday_reward", title: "Happy Birthday!",
          message: `${c.name}, your birthday gift is waiting at our restaurant.`,
          entityId: c.id, entityType: "customer",
        }).catch(() => {});
      }
      granted++;
    }
    if (granted > 0) logger.info({ restaurantId, granted }, "[Loyalty2] birthday grants");
  });
}

export async function runMilestoneSweep() {
  await forEachActiveRestaurant(async (restaurantId) => {
    const cfg = await loadLoyalty2Config(restaurantId);
    if (!isEnabled(cfg, "milestones")) return;
    // Cap to recently active customers (any orders in past 60 days) to keep this cheap.
    const recent = await db.select({ id: customersTable.id })
      .from(customersTable)
      .where(and(eq(customersTable.restaurantId, restaurantId)))
      .limit(500);
    for (const c of recent) {
      await checkMilestonesForCustomer({ restaurantId, customerId: c.id, cfg: cfg.milestones }).catch(() => {});
    }
  });
}

export async function runStreakGraceJob() {
  // Reset streaks that haven't been touched within (window + graceDays).
  await forEachActiveRestaurant(async (restaurantId) => {
    const cfg = await loadLoyalty2Config(restaurantId);
    if (!isEnabled(cfg, "streak")) return;
    const winMs = cfg.streak.windowKind === "week" ? 7 * 86400_000 : 86400_000;
    const cutoff = new Date(Date.now() - winMs - (cfg.tierRules.graceDays ?? 0) * 86400_000);
    const res = await db.update(loyaltyStreakStateTable)
      .set({ currentStreak: 0, updatedAt: new Date() })
      .where(and(
        eq(loyaltyStreakStateTable.restaurantId, restaurantId),
        lt(loyaltyStreakStateTable.lastVisitAt, cutoff),
      )).returning({ id: loyaltyStreakStateTable.id });
    if (res.length > 0) logger.info({ restaurantId, reset: res.length }, "[Loyalty2] streak grace expirations");
  });
}

export async function runDoublePointsAnnouncer() {
  await forEachActiveRestaurant(async (restaurantId) => {
    const cfg = await loadLoyalty2Config(restaurantId);
    if (!isEnabled(cfg, "doublePoints")) return;
    const r = activeDoublePointsMultiplier({ cfg: cfg.doublePoints });
    if (r.multiplier > 1 && r.rule) {
      await db.insert(notificationsTable).values({
        restaurantId, type: "double_points_active", title: "Bonus points active",
        message: `${r.rule.label}: earn ${r.multiplier}× points right now.`,
        entityId: 0, entityType: "loyalty",
      }).catch(() => {});
    }
  });
}
