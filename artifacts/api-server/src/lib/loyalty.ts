import { eq, and, sql, lt, isNull, isNotNull, desc, asc, inArray } from "drizzle-orm";
import { db, restaurantSettingsTable, customersTable, loyaltyTransactionsTable } from "./db";
import { logger } from "./logger";

// Re-export the modular Loyalty 2.0 surface so callers can `import { ... } from "./loyalty"`.
export * from "./loyalty/types";
export { loadLoyalty2Config, isEnabled as isLoyaltyMechanicEnabled, mergeWithDefaults } from "./loyalty/config";
export { runOrderPaidPipeline } from "./loyalty/pipeline";
export {
  creditCashback, debitCashback, getOrCreateWallet,
  computeCashbackEarn, computeRedeemableCashback,
} from "./loyalty/cashback";
export { listStampCards, manualAddStamp, awardStampsForOrder } from "./loyalty/stamps";
export {
  ensureReferralCode, attachReferralByCode, listReferralsForReferrer, referralLeaderboard,
} from "./loyalty/referrals";
export { listMysteryGrants, revealMysteryGrant, maybeGrantMystery, pickWeighted } from "./loyalty/mystery";
export { getStreakState, recordVisitForStreak } from "./loyalty/streaks";
export { activeDoublePointsMultiplier } from "./loyalty/doublePoints";
export {
  getFamilyGroupForCustomer, addFamilyMemberByPhone, removeFamilyMember, ensureGroupForPrimary, resolveSharedCustomerId,
} from "./loyalty/family";
export { logAudit, listRecentAudit } from "./loyalty/audit";
export { isBirthdayWithinWindow, hasBirthdayGrantThisYear, recordBirthdayGrant } from "./loyalty/birthday";

export interface LoyaltyTier {
  id: string;
  name: string;
  threshold: number;
  multiplier?: number;
}

export interface LoyaltyConfig {
  enabled: boolean;
  pointsPerCurrencyUnit: number;
  redemptionRate: number;
  signupBonus: number;
  birthdayBonus: number;
  referralBonus: number;
  tiers: LoyaltyTier[];
  expiryMonths: number;
}

const DEFAULT_CFG: LoyaltyConfig = {
  enabled: false,
  pointsPerCurrencyUnit: 1,
  redemptionRate: 0.05,
  signupBonus: 0,
  birthdayBonus: 0,
  referralBonus: 0,
  tiers: [
    { id: "bronze", name: "Bronze", threshold: 0, multiplier: 1 },
    { id: "silver", name: "Silver", threshold: 1000, multiplier: 1.25 },
    { id: "gold", name: "Gold", threshold: 5000, multiplier: 1.5 },
  ],
  expiryMonths: 0,
};

export async function loadLoyaltyConfig(restaurantId: number): Promise<LoyaltyConfig> {
  const [row] = await db.select().from(restaurantSettingsTable)
    .where(and(eq(restaurantSettingsTable.restaurantId, restaurantId), eq(restaurantSettingsTable.section, "loyalty")));
  const data = (row?.data ?? {}) as Partial<LoyaltyConfig>;
  return {
    enabled: data.enabled ?? DEFAULT_CFG.enabled,
    pointsPerCurrencyUnit: Number(data.pointsPerCurrencyUnit ?? DEFAULT_CFG.pointsPerCurrencyUnit),
    redemptionRate: Number(data.redemptionRate ?? DEFAULT_CFG.redemptionRate),
    signupBonus: Number(data.signupBonus ?? 0),
    birthdayBonus: Number(data.birthdayBonus ?? 0),
    referralBonus: Number(data.referralBonus ?? 0),
    tiers: Array.isArray(data.tiers) && data.tiers.length > 0 ? data.tiers : DEFAULT_CFG.tiers,
    expiryMonths: Number(data.expiryMonths ?? 0),
  };
}

export function pickTier(lifetimePoints: number, tiers: LoyaltyTier[]): LoyaltyTier {
  const sorted = [...tiers].sort((a, b) => Number(a.threshold) - Number(b.threshold));
  let current = sorted[0] ?? { id: "base", name: "Member", threshold: 0, multiplier: 1 };
  for (const t of sorted) {
    if (lifetimePoints >= Number(t.threshold)) current = t;
  }
  return current;
}

export function tierMultiplier(tier: LoyaltyTier): number {
  const m = Number(tier.multiplier ?? 1);
  return Number.isFinite(m) && m > 0 ? m : 1;
}

export function computeEarnedPoints(amount: number, cfg: LoyaltyConfig, tier: LoyaltyTier): number {
  if (!cfg.enabled || cfg.pointsPerCurrencyUnit <= 0 || amount <= 0) return 0;
  return Math.floor(amount * cfg.pointsPerCurrencyUnit * tierMultiplier(tier));
}

export function computeRedemptionDiscount(points: number, cfg: LoyaltyConfig): number {
  const rate = Number(cfg.redemptionRate);
  if (!Number.isFinite(rate) || rate <= 0 || points <= 0) return 0;
  return Math.max(0, points * rate);
}

export function computeExpiryDate(cfg: LoyaltyConfig, from: Date = new Date()): Date | null {
  if (!cfg.expiryMonths || cfg.expiryMonths <= 0) return null;
  const d = new Date(from);
  d.setMonth(d.getMonth() + cfg.expiryMonths);
  return d;
}

export async function getLifetimeEarned(customerId: number, restaurantId: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(${loyaltyTransactionsTable.points}), 0)` })
    .from(loyaltyTransactionsTable)
    .where(and(
      eq(loyaltyTransactionsTable.customerId, customerId),
      eq(loyaltyTransactionsTable.restaurantId, restaurantId),
      eq(loyaltyTransactionsTable.type, "earn"),
    ));
  return Number(row?.total ?? 0);
}

/**
 * Daily job — expires earn transactions whose `expiresAt` is past, using strict
 * FIFO accounting so prior redemptions consume the oldest earn batches first.
 *
 * Algorithm per customer:
 *   1. Load all earn rows chronologically (asc) with their expiresAt/expiredAt.
 *   2. Sum total consumed = -(sum of all redeem + expire txn points).
 *   3. Walk earns oldest-first, allocating consumption to each batch up to its
 *      points value. The remainder per batch is its current "unconsumed" amount.
 *   4. For each earn whose expiresAt is past AND expiredAt is null:
 *        - mark expiredAt = now (the row's lifetime is over either way)
 *        - if unconsumed > 0, accumulate that many points to the expire delta.
 *   5. Write a single 'expire' txn for the deduct amount and decrement balance.
 *
 * Uses a per-process Postgres advisory lock so concurrent schedulers don't
 * double-deduct.
 */
export async function expireDueLoyaltyPoints(): Promise<number> {
  // Postgres advisory lock — namespace 4242, key 1 (arbitrary stable ints).
  const lock = await db.execute(sql`SELECT pg_try_advisory_lock(4242, 1) AS locked`);
  const locked = (lock.rows?.[0] as { locked?: boolean } | undefined)?.locked === true;
  if (!locked) {
    logger.info("[Loyalty] Expiry job skipped — advisory lock held by another worker");
    return 0;
  }

  try {
    const now = new Date();
    const dueRows = await db.select({
      customerId: loyaltyTransactionsTable.customerId,
      restaurantId: loyaltyTransactionsTable.restaurantId,
    }).from(loyaltyTransactionsTable).where(and(
      eq(loyaltyTransactionsTable.type, "earn"),
      isNotNull(loyaltyTransactionsTable.expiresAt),
      isNull(loyaltyTransactionsTable.expiredAt),
      lt(loyaltyTransactionsTable.expiresAt, now),
    ));

    if (dueRows.length === 0) return 0;

    const customerKeys = new Set<string>();
    const customers: Array<{ customerId: number; restaurantId: number }> = [];
    for (const r of dueRows) {
      const key = `${r.restaurantId}:${r.customerId}`;
      if (!customerKeys.has(key)) {
        customerKeys.add(key);
        customers.push({ customerId: r.customerId, restaurantId: r.restaurantId });
      }
    }

    let totalExpired = 0;

    for (const { customerId, restaurantId } of customers) {
      // All balance/ledger/expiredAt writes for one customer happen atomically:
      // a mid-sequence failure rolls back so the customer's balance and ledger
      // never desync.
      const expiredHere = await db.transaction(async (tx) => {
        const allTxns = await tx.select().from(loyaltyTransactionsTable).where(and(
          eq(loyaltyTransactionsTable.customerId, customerId),
          eq(loyaltyTransactionsTable.restaurantId, restaurantId),
        )).orderBy(asc(loyaltyTransactionsTable.createdAt), asc(loyaltyTransactionsTable.id));

        // Total consumption so far (redemptions + prior expirations) — positive number.
        let consumed = 0;
        for (const t of allTxns) if (t.type !== "earn" && t.points < 0) consumed += -t.points;

        // FIFO-allocate consumption against earn batches and find expired-and-unconsumed.
        const earnBatches = allTxns.filter(t => t.type === "earn");
        const idsToMarkExpired: number[] = [];
        let deductFromBalance = 0;

        for (const e of earnBatches) {
          const consumeFromThis = Math.min(consumed, e.points);
          const unconsumed = e.points - consumeFromThis;
          consumed -= consumeFromThis;

          const isPastDue = e.expiresAt && e.expiresAt < now && !e.expiredAt;
          if (isPastDue) {
            idsToMarkExpired.push(e.id);
            if (unconsumed > 0) deductFromBalance += unconsumed;
          }
        }

        if (idsToMarkExpired.length === 0) return 0;

        let expiredAmount = 0;
        if (deductFromBalance > 0) {
          const [cust] = await tx.select({ loyaltyPoints: customersTable.loyaltyPoints })
            .from(customersTable).where(eq(customersTable.id, customerId));
          if (cust) {
            const actualDeduct = Math.min(cust.loyaltyPoints, deductFromBalance);
            if (actualDeduct > 0) {
              await tx.update(customersTable).set({
                loyaltyPoints: Math.max(0, cust.loyaltyPoints - actualDeduct),
                updatedAt: now,
              }).where(eq(customersTable.id, customerId));
              await tx.insert(loyaltyTransactionsTable).values({
                customerId, restaurantId,
                points: -actualDeduct,
                type: "expire",
                reason: `Expired ${actualDeduct} pts (${idsToMarkExpired.length} batch${idsToMarkExpired.length === 1 ? "" : "es"})`,
              });
              expiredAmount = actualDeduct;
            }
          }
        }

        await tx.update(loyaltyTransactionsTable).set({ expiredAt: now })
          .where(inArray(loyaltyTransactionsTable.id, idsToMarkExpired));

        return expiredAmount;
      });

      totalExpired += expiredHere;
    }

    logger.info({ totalExpired, customers: customers.length }, "[Loyalty] Expired due points (FIFO)");
    return totalExpired;
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(4242, 1)`);
  }
}
/** Recent transactions for a customer, capped. */
export async function getRecentLoyaltyHistory(customerId: number, restaurantId: number, limit = 10) {
  return db.select().from(loyaltyTransactionsTable).where(and(
    eq(loyaltyTransactionsTable.customerId, customerId),
    eq(loyaltyTransactionsTable.restaurantId, restaurantId),
  )).orderBy(desc(loyaltyTransactionsTable.createdAt)).limit(limit);
}
