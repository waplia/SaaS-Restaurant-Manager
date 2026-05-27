import { eq, and, sql, count } from "drizzle-orm";
import { db, customersTable, loyaltyTransactionsTable, ordersTable, notificationsTable } from "../db";
import { logger } from "../logger";
import { loadLoyalty2Config, isEnabled } from "./config";
import type { Loyalty2Config } from "./types";
import { creditCashback, computeCashbackEarn } from "./cashback";
import { awardStampsForOrder } from "./stamps";
import { activeDoublePointsMultiplier } from "./doublePoints";
import { computeItemBonuses } from "./itemRules";
import { recordVisitForStreak } from "./streaks";
import { checkMilestonesForCustomer } from "./milestones";
import { maybeGrantMystery } from "./mystery";
import { getPendingReferralForReferee, markReferralConverted } from "./referrals";
import { resolveSharedCustomerId } from "./family";
import { logAudit } from "./audit";
import { formatOrderNumber } from "../orderNumber";

function pickTier(lifetimePoints: number, cfg: Loyalty2Config) {
  const sorted = [...cfg.tiers].sort((a, b) => a.threshold - b.threshold);
  let cur = sorted[0] ?? { id: "base", name: "Member", threshold: 0, multiplier: 1 };
  for (const t of sorted) if (lifetimePoints >= t.threshold) cur = t;
  return cur;
}

function computeExpiry(cfg: Loyalty2Config): Date | null {
  if (!cfg.expiryMonths || cfg.expiryMonths <= 0) return null;
  const d = new Date();
  d.setMonth(d.getMonth() + cfg.expiryMonths);
  return d;
}

export interface OrderPaidContext {
  restaurantId: number;
  order: typeof ordersTable.$inferSelect;
}

/**
 * Single "on order paid" pipeline. Runs every enabled mechanic, writes a
 * single set of loyalty ledger entries, never throws — individual modules
 * are catch-isolated so one failure doesn't block the rest.
 */
export async function runOrderPaidPipeline(ctx: OrderPaidContext): Promise<void> {
  const { restaurantId, order } = ctx;
  if (!order.customerId) return;

  const cfg = await loadLoyalty2Config(restaurantId);
  if (!cfg.enabled) {
    // Legacy points-only fallback runs in earnLoyaltyForOrder; nothing more to do.
    return;
  }

  const customerId = order.customerId;
  const sharedId = await resolveSharedCustomerId(restaurantId, customerId, cfg.family);

  const subtotal = Number(order.subtotal);
  const pointsRedeemed = order.loyaltyPointsRedeemed ?? 0;

  // 1) tier
  const lifetimeEarned = Number((await db.select({
    s: sql<number>`COALESCE(SUM(${loyaltyTransactionsTable.points}), 0)`,
  }).from(loyaltyTransactionsTable).where(and(
    eq(loyaltyTransactionsTable.customerId, sharedId),
    eq(loyaltyTransactionsTable.restaurantId, restaurantId),
    eq(loyaltyTransactionsTable.type, "earn"),
  )))[0]?.s ?? 0);
  const tier = pickTier(lifetimeEarned, cfg);

  // 2) double-points multiplier
  const dp = isEnabled(cfg, "doublePoints")
    ? activeDoublePointsMultiplier({ cfg: cfg.doublePoints, orderType: order.orderType })
    : { multiplier: 1, rule: null };

  // 3) base earn = floor(subtotal * pointsPerCurrencyUnit * tierMultiplier * dpMultiplier)
  const tierMult = Math.max(1, Number(tier.multiplier ?? 1));
  let pointsEarned = 0;
  if (cfg.pointsPerCurrencyUnit > 0 && subtotal > 0) {
    pointsEarned = Math.floor(subtotal * cfg.pointsPerCurrencyUnit * tierMult * dp.multiplier);
  }

  // 4) item-rule bonuses
  let itemStampEarns = new Map<string, number>();
  if (isEnabled(cfg, "itemRules")) {
    const ib = await computeItemBonuses({
      restaurantId, orderId: order.id,
      pointsPerCurrencyUnit: cfg.pointsPerCurrencyUnit, cfg: cfg.itemRules,
    });
    pointsEarned += ib.bonusPoints;
    itemStampEarns = ib.stampCardEarns;
  }

  // 5) ledger writes
  const txns: Array<typeof loyaltyTransactionsTable.$inferInsert> = [];
  let balanceDelta = 0;
  if (pointsEarned > 0) {
    txns.push({
      customerId: sharedId, restaurantId, points: pointsEarned, type: "earn",
      reason: `Order #${formatOrderNumber(order.orderNumber)}` +
        (tierMult !== 1 ? ` · ${tier.name} ×${tierMult}` : "") +
        (dp.multiplier > 1 ? ` · ${dp.rule?.label ?? "Double pts"} ×${dp.multiplier}` : ""),
      orderId: order.id, expiresAt: computeExpiry(cfg),
    });
    balanceDelta += pointsEarned;
  }
  if (pointsRedeemed > 0) {
    const [c] = await db.select({ p: customersTable.loyaltyPoints }).from(customersTable).where(eq(customersTable.id, sharedId));
    const debit = Math.min(pointsRedeemed, (c?.p ?? 0) + balanceDelta);
    if (debit > 0) {
      txns.push({
        customerId: sharedId, restaurantId, points: -debit, type: "redeem",
        reason: `Redeemed for order #${formatOrderNumber(order.orderNumber)}`, orderId: order.id,
      });
      balanceDelta -= debit;
    }
  }
  if (txns.length > 0) await db.insert(loyaltyTransactionsTable).values(txns);
  if (balanceDelta !== 0) {
    await db.update(customersTable).set({
      loyaltyPoints: sql`GREATEST(0, ${customersTable.loyaltyPoints} + ${balanceDelta})`,
      totalOrders: sql`${customersTable.totalOrders} + 1`,
      totalSpent: sql`${customersTable.totalSpent} + ${Number(order.totalAmount)}`,
      updatedAt: new Date(),
    }).where(eq(customersTable.id, sharedId));
  } else {
    await db.update(customersTable).set({
      totalOrders: sql`${customersTable.totalOrders} + 1`,
      totalSpent: sql`${customersTable.totalSpent} + ${Number(order.totalAmount)}`,
      updatedAt: new Date(),
    }).where(eq(customersTable.id, sharedId));
  }

  // VIP derivation (cust_vip_alerts): auto-flip isVip once the customer
  // crosses repeat-visit OR top-spender thresholds. Idempotent — only
  // flips false→true so a manual unset is preserved until the next bump.
  try {
    await db.update(customersTable).set({ isVip: true, updatedAt: new Date() })
      .where(and(
        eq(customersTable.id, sharedId),
        eq(customersTable.isVip, false),
        sql`(${customersTable.totalOrders} >= 20 OR ${customersTable.totalSpent} >= 50000)`,
      ));
  } catch (err) {
    console.error(`[VIP derive] failed for customer ${sharedId}:`, err);
  }

  // 6) cashback earn
  if (isEnabled(cfg, "cashback")) {
    try {
      const cb = computeCashbackEarn(subtotal, cfg.cashback);
      if (cb > 0) {
        await creditCashback({
          restaurantId, customerId: sharedId, amount: cb,
          reason: `Cashback for order #${formatOrderNumber(order.orderNumber)}`,
          orderId: order.id, expiryDays: cfg.cashback.expiryDays,
        });
        await notify(restaurantId, "cashback_credited", `₹${cb.toFixed(2)} cashback credited`, sharedId);
      }
    } catch (e) { logger.error({ e }, "[Loyalty2] cashback failed"); }
  }

  // 7) stamps
  if (isEnabled(cfg, "stamps")) {
    try {
      const completions = await awardStampsForOrder({
        restaurantId, customerId: sharedId, orderId: order.id, cards: cfg.stampCards,
      });
      for (const c of completions) {
        await issueStampReward(restaurantId, sharedId, c, order.id);
        await notify(restaurantId, "stamp_card_completed", `Stamp card "${c.cardName}" completed!`, sharedId);
      }
      // Apply item-rule extra stamp earns separately
      if (itemStampEarns.size > 0) {
        const { manualAddStamp } = await import("./stamps");
        for (const [cardId, qty] of itemStampEarns.entries()) {
          await manualAddStamp(restaurantId, sharedId, cardId, qty);
        }
      }
    } catch (e) { logger.error({ e }, "[Loyalty2] stamps failed"); }
  }

  // 8) streaks
  if (isEnabled(cfg, "streak")) {
    try {
      const { rewardEarned, streak } = await recordVisitForStreak({
        restaurantId, customerId: sharedId, cfg: cfg.streak,
      });
      if (rewardEarned) {
        await issueGenericReward(restaurantId, sharedId, cfg.streak.rewardType, cfg.streak.rewardValue, `Streak ×${streak} reward`);
        await notify(restaurantId, "streak_reward", `You hit a ${streak}-${cfg.streak.windowKind} streak!`, sharedId);
      }
    } catch (e) { logger.error({ e }, "[Loyalty2] streak failed"); }
  }

  // 9) milestones
  if (isEnabled(cfg, "milestones")) {
    try {
      const newly = await checkMilestonesForCustomer({
        restaurantId, customerId: sharedId, cfg: cfg.milestones,
      });
      for (const m of newly) {
        await issueGenericReward(restaurantId, sharedId, m.rewardType, m.rewardValue, `Milestone ${m.key}`);
        await notify(restaurantId, "milestone_hit", `Milestone reached: ${m.key}`, sharedId);
      }
    } catch (e) { logger.error({ e }, "[Loyalty2] milestones failed"); }
  }

  // 10) mystery
  if (isEnabled(cfg, "mystery")) {
    try {
      const oc = (await db.select({ c: count() }).from(ordersTable)
        .where(and(eq(ordersTable.restaurantId, restaurantId), eq(ordersTable.customerId, sharedId))))[0]?.c;
      const result = await maybeGrantMystery({
        restaurantId, customerId: sharedId, orderId: order.id,
        cfg: cfg.mystery, orderCountForCustomer: Number(oc ?? 0),
      });
      if (result.granted) {
        await notify(restaurantId, "mystery_won", `Mystery reward unlocked: ${result.reward.label}`, sharedId);
      }
    } catch (e) { logger.error({ e }, "[Loyalty2] mystery failed"); }
  }

  // 11) referral conversion (if this is referee's first qualifying order)
  if (isEnabled(cfg, "referral")) {
    try {
      const pending = await getPendingReferralForReferee(restaurantId, customerId);
      if (pending && Number(order.totalAmount) >= cfg.referral.minFirstOrder) {
        const summary: Record<string, unknown> = {
          rewardType: cfg.referral.rewardType,
          referrerReward: cfg.referral.referrerReward,
          refereeReward: cfg.referral.refereeReward,
          orderId: order.id,
        };
        await issueGenericReward(restaurantId, pending.referrerId, cfg.referral.rewardType, cfg.referral.referrerReward, `Referral converted: friend completed first order`);
        await issueGenericReward(restaurantId, customerId, cfg.referral.rewardType, cfg.referral.refereeReward, `Welcome — referral reward`);
        await markReferralConverted(pending.id, summary);
        await notify(restaurantId, "referral_converted", "A referral converted!", pending.referrerId);
      }
    } catch (e) { logger.error({ e }, "[Loyalty2] referral failed"); }
  }

  await logAudit({ restaurantId, customerId: sharedId, action: "order_paid_pipeline", payload: {
    orderId: order.id, pointsEarned, dpMultiplier: dp.multiplier, tier: tier.id,
  }});
}

async function issueStampReward(restaurantId: number, customerId: number, c: { rewardType: string; rewardValue: number | string; cardName: string }, orderId: number) {
  if (c.rewardType === "points") {
    const pts = Math.max(0, Number(c.rewardValue) || 0);
    if (pts > 0) {
      await db.insert(loyaltyTransactionsTable).values({
        customerId, restaurantId, points: pts, type: "earn",
        reason: `Stamp card reward: ${c.cardName}`, orderId,
      });
      await db.update(customersTable).set({
        loyaltyPoints: sql`${customersTable.loyaltyPoints} + ${pts}`, updatedAt: new Date(),
      }).where(eq(customersTable.id, customerId));
    }
  } else if (c.rewardType === "cashback") {
    await creditCashback({ restaurantId, customerId, amount: Number(c.rewardValue) || 0, reason: `Stamp card reward: ${c.cardName}`, orderId });
  }
  // free_item / coupon: recorded in audit; coupon issuance is out of scope here.
}

async function issueGenericReward(restaurantId: number, customerId: number, type: string, value: number | string, reason: string) {
  if (type === "points") {
    const pts = Math.max(0, Number(value) || 0);
    if (pts > 0) {
      await db.insert(loyaltyTransactionsTable).values({
        customerId, restaurantId, points: pts, type: "earn", reason,
      });
      await db.update(customersTable).set({
        loyaltyPoints: sql`${customersTable.loyaltyPoints} + ${pts}`, updatedAt: new Date(),
      }).where(eq(customersTable.id, customerId));
    }
  } else if (type === "cashback") {
    await creditCashback({ restaurantId, customerId, amount: Number(value) || 0, reason });
  }
}

async function notify(restaurantId: number, type: string, message: string, entityId: number) {
  await db.insert(notificationsTable).values({
    restaurantId, type, title: "Loyalty",
    message, entityId, entityType: "customer",
  }).catch(() => {});
}
