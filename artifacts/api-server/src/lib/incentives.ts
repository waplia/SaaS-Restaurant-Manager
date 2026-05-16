import { and, eq, gte, lt, sql, inArray } from "drizzle-orm";
import {
  db,
  ordersTable,
  attendanceTable,
  customerFeedbackTable,
  usersTable,
  staffIncentiveRulesTable,
  type StaffIncentiveRule,
  type StaffIncentiveRuleType,
} from "./db";
import { monthBounds } from "./payroll";
import { logger } from "./logger";

export type IncentiveBreakdown = Record<string, unknown>;

export interface ComputedIncentive {
  userId: number;
  ruleType: StaffIncentiveRuleType;
  amount: number;
  breakdown: IncentiveBreakdown;
}

interface RuleParams {
  upsell_commission: { ratePct?: number; minOrderAmount?: number };
  review_bonus: { perReview?: number; minRating?: number };
  attendance_bonus: { amount?: number; maxAbsences?: number };
  sales_target: { target?: number; flatBonus?: number; ratePct?: number };
  table_turnover: { perOrder?: number; minOrders?: number };
  low_complaint_bonus: { amount?: number; maxComplaints?: number; complaintRatingAtMost?: number };
}

function num(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function applyCap(amount: number, cap: string | null | undefined): number {
  if (cap === null || cap === undefined || cap === "") return amount;
  const c = Number(cap);
  if (!Number.isFinite(c) || c < 0) return amount;
  return Math.min(amount, c);
}

/**
 * Run all six incentive calculators for one (restaurant, year, month).
 * Pure-ish: only reads from DB. Returns one row per (userId, ruleType)
 * with a non-zero amount. Caller is responsible for upserting rows and
 * handling status transitions (pending vs approved).
 */
export async function computeIncentivesForPeriod(
  restaurantId: number,
  year: number,
  month: number,
): Promise<ComputedIncentive[]> {
  const rules = await db
    .select()
    .from(staffIncentiveRulesTable)
    .where(eq(staffIncentiveRulesTable.restaurantId, restaurantId));
  const enabled = new Map<StaffIncentiveRuleType, StaffIncentiveRule>();
  for (const r of rules) {
    if (r.enabled) enabled.set(r.ruleType as StaffIncentiveRuleType, r);
  }
  if (enabled.size === 0) return [];

  const { start, end } = monthBounds(year, month);

  const staff = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      eq(usersTable.restaurantId, restaurantId),
      eq(usersTable.isActive, true),
      inArray(usersTable.role, ["manager", "waiter", "kitchen", "delivery_executive", "cashier"]),
    ));
  const staffIds = staff.map((s) => s.id);
  if (staffIds.length === 0) return [];

  const out: ComputedIncentive[] = [];

  // ---------- Per-waiter order aggregates (used by 3 rules) ----------
  let orderAgg: Map<number, { total: number; count: number }> | null = null;
  async function loadOrderAgg() {
    if (orderAgg) return orderAgg;
    orderAgg = new Map();
    try {
      const rows = await db
        .select({
          userId: ordersTable.waiterId,
          total: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)`,
          cnt: sql<number>`COUNT(*)`,
        })
        .from(ordersTable)
        .where(and(
          eq(ordersTable.restaurantId, restaurantId),
          eq(ordersTable.status, "completed"),
          gte(ordersTable.createdAt, start),
          lt(ordersTable.createdAt, end),
        ))
        .groupBy(ordersTable.waiterId);
      for (const r of rows) {
        if (r.userId == null) continue;
        orderAgg.set(r.userId, { total: num(r.total), count: Number(r.cnt) || 0 });
      }
    } catch (err) {
      logger.warn({ err }, "incentive order aggregate failed");
    }
    return orderAgg;
  }

  // ---------- 1. Upsell commission ----------
  const upsell = enabled.get("upsell_commission");
  if (upsell) {
    const params = (upsell.params ?? {}) as RuleParams["upsell_commission"];
    const ratePct = num(params.ratePct, 0);
    const minOrder = num(params.minOrderAmount, 0);
    if (ratePct > 0) {
      try {
        const rows = await db
          .select({
            userId: ordersTable.waiterId,
            total: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)`,
            cnt: sql<number>`COUNT(*)`,
          })
          .from(ordersTable)
          .where(and(
            eq(ordersTable.restaurantId, restaurantId),
            eq(ordersTable.status, "completed"),
            gte(ordersTable.createdAt, start),
            lt(ordersTable.createdAt, end),
            gte(ordersTable.totalAmount, String(minOrder)),
          ))
          .groupBy(ordersTable.waiterId);
        for (const r of rows) {
          if (r.userId == null || !staffIds.includes(r.userId)) continue;
          const sales = num(r.total);
          const raw = (sales * ratePct) / 100;
          const amount = applyCap(raw, upsell.monthlyCap);
          if (amount > 0) {
            out.push({
              userId: r.userId,
              ruleType: "upsell_commission",
              amount,
              breakdown: {
                qualifyingSales: sales.toFixed(2),
                qualifyingOrders: Number(r.cnt) || 0,
                ratePct,
                minOrderAmount: minOrder,
                rawAmount: raw.toFixed(2),
                cappedAt: upsell.monthlyCap ?? null,
              },
            });
          }
        }
      } catch (err) {
        logger.warn({ err }, "upsell_commission compute failed");
      }
    }
  }

  // ---------- 2. Review bonus (unattributed bucket) ----------
  // Customer feedback has no staff link in schema. We surface positive
  // reviews as an "unattributed" pool that the owner can manually assign
  // by adjusting amounts on the approval row. We attribute proportionally
  // to each waiter's share of the period's order count as a best-effort
  // fallback so the number is never zero when reviews exist.
  const review = enabled.get("review_bonus");
  if (review) {
    const params = (review.params ?? {}) as RuleParams["review_bonus"];
    const perReview = num(params.perReview, 0);
    const minRating = Math.max(1, Math.min(5, Math.floor(num(params.minRating, 4))));
    if (perReview > 0) {
      try {
        const [{ cnt }] = await db
          .select({ cnt: sql<number>`COUNT(*)` })
          .from(customerFeedbackTable)
          .where(and(
            eq(customerFeedbackTable.restaurantId, restaurantId),
            gte(customerFeedbackTable.rating, minRating),
            gte(customerFeedbackTable.createdAt, start),
            lt(customerFeedbackTable.createdAt, end),
          ));
        const totalReviews = Number(cnt) || 0;
        if (totalReviews > 0) {
          const totalPool = totalReviews * perReview;
          const agg = await loadOrderAgg();
          const totalOrders = Array.from(agg.values()).reduce((a, b) => a + b.count, 0);
          if (totalOrders > 0) {
            for (const [userId, v] of agg) {
              if (!staffIds.includes(userId)) continue;
              const share = v.count / totalOrders;
              const raw = totalPool * share;
              const amount = applyCap(raw, review.monthlyCap);
              if (amount > 0) {
                out.push({
                  userId,
                  ruleType: "review_bonus",
                  amount,
                  breakdown: {
                    totalQualifyingReviews: totalReviews,
                    minRating,
                    perReview,
                    poolAmount: totalPool.toFixed(2),
                    sharePct: (share * 100).toFixed(2),
                    attributionMethod: "proportional_to_orders",
                    rawAmount: raw.toFixed(2),
                    cappedAt: review.monthlyCap ?? null,
                  },
                });
              }
            }
          }
        }
      } catch (err) {
        logger.warn({ err }, "review_bonus compute failed");
      }
    }
  }

  // ---------- 3. Attendance bonus ----------
  const att = enabled.get("attendance_bonus");
  if (att) {
    const params = (att.params ?? {}) as RuleParams["attendance_bonus"];
    const amount = num(params.amount, 0);
    const maxAbsences = Math.max(0, Math.floor(num(params.maxAbsences, 0)));
    if (amount > 0) {
      try {
        const rows = await db
          .select({
            userId: attendanceTable.userId,
            absent: sql<number>`SUM(CASE WHEN ${attendanceTable.status} = 'absent' THEN 1 ELSE 0 END)`,
            present: sql<number>`SUM(CASE WHEN ${attendanceTable.status} IN ('present','half_day','late') THEN 1 ELSE 0 END)`,
          })
          .from(attendanceTable)
          .where(and(
            eq(attendanceTable.restaurantId, restaurantId),
            inArray(attendanceTable.userId, staffIds),
            gte(attendanceTable.date, start),
            lt(attendanceTable.date, end),
          ))
          .groupBy(attendanceTable.userId);
        for (const r of rows) {
          const absent = Number(r.absent) || 0;
          const present = Number(r.present) || 0;
          if (present === 0) continue;
          if (absent > maxAbsences) continue;
          const capped = applyCap(amount, att.monthlyCap);
          out.push({
            userId: r.userId,
            ruleType: "attendance_bonus",
            amount: capped,
            breakdown: {
              daysPresent: present,
              daysAbsent: absent,
              maxAbsences,
              flatAmount: amount,
              cappedAt: att.monthlyCap ?? null,
            },
          });
        }
      } catch (err) {
        logger.warn({ err }, "attendance_bonus compute failed");
      }
    }
  }

  // ---------- 4. Sales target ----------
  const target = enabled.get("sales_target");
  if (target) {
    const params = (target.params ?? {}) as RuleParams["sales_target"];
    const targetAmt = num(params.target, 0);
    const flat = num(params.flatBonus, 0);
    const ratePct = num(params.ratePct, 0);
    if (targetAmt > 0 && (flat > 0 || ratePct > 0)) {
      const agg = await loadOrderAgg();
      for (const [userId, v] of agg) {
        if (!staffIds.includes(userId)) continue;
        if (v.total < targetAmt) continue;
        const overshoot = v.total - targetAmt;
        const raw = flat + (overshoot * ratePct) / 100;
        const amount = applyCap(raw, target.monthlyCap);
        if (amount > 0) {
          out.push({
            userId,
            ruleType: "sales_target",
            amount,
            breakdown: {
              actualSales: v.total.toFixed(2),
              target: targetAmt,
              overshoot: overshoot.toFixed(2),
              flatBonus: flat,
              overshootRatePct: ratePct,
              rawAmount: raw.toFixed(2),
              cappedAt: target.monthlyCap ?? null,
            },
          });
        }
      }
    }
  }

  // ---------- 5. Table turnover ----------
  const turnover = enabled.get("table_turnover");
  if (turnover) {
    const params = (turnover.params ?? {}) as RuleParams["table_turnover"];
    const perOrder = num(params.perOrder, 0);
    const minOrders = Math.max(0, Math.floor(num(params.minOrders, 0)));
    if (perOrder > 0) {
      const agg = await loadOrderAgg();
      for (const [userId, v] of agg) {
        if (!staffIds.includes(userId)) continue;
        if (v.count < minOrders) continue;
        const raw = v.count * perOrder;
        const amount = applyCap(raw, turnover.monthlyCap);
        if (amount > 0) {
          out.push({
            userId,
            ruleType: "table_turnover",
            amount,
            breakdown: {
              ordersServed: v.count,
              minOrders,
              perOrder,
              rawAmount: raw.toFixed(2),
              cappedAt: turnover.monthlyCap ?? null,
            },
          });
        }
      }
    }
  }

  // ---------- 6. Low complaint bonus ----------
  // Define a complaint as customer_feedback with rating <= complaintRatingAtMost.
  // Attributed proportionally to each waiter's share of period orders;
  // staff with complaint share <= maxComplaints earn the flat bonus.
  const lowC = enabled.get("low_complaint_bonus");
  if (lowC) {
    const params = (lowC.params ?? {}) as RuleParams["low_complaint_bonus"];
    const flat = num(params.amount, 0);
    const maxComplaints = Math.max(0, Math.floor(num(params.maxComplaints, 0)));
    const ratingAtMost = Math.max(1, Math.min(5, Math.floor(num(params.complaintRatingAtMost, 2))));
    if (flat > 0) {
      try {
        const [{ cnt }] = await db
          .select({ cnt: sql<number>`COUNT(*)` })
          .from(customerFeedbackTable)
          .where(and(
            eq(customerFeedbackTable.restaurantId, restaurantId),
            lt(customerFeedbackTable.rating, ratingAtMost + 1),
            gte(customerFeedbackTable.createdAt, start),
            lt(customerFeedbackTable.createdAt, end),
          ));
        const totalComplaints = Number(cnt) || 0;
        const agg = await loadOrderAgg();
        const totalOrders = Array.from(agg.values()).reduce((a, b) => a + b.count, 0);
        for (const [userId, v] of agg) {
          if (!staffIds.includes(userId)) continue;
          const share = totalOrders > 0 ? v.count / totalOrders : 0;
          const attributed = totalComplaints * share;
          if (attributed > maxComplaints) continue;
          const capped = applyCap(flat, lowC.monthlyCap);
          out.push({
            userId,
            ruleType: "low_complaint_bonus",
            amount: capped,
            breakdown: {
              totalPeriodComplaints: totalComplaints,
              attributedComplaints: attributed.toFixed(2),
              maxComplaints,
              complaintRatingAtMost: ratingAtMost,
              flatAmount: flat,
              cappedAt: lowC.monthlyCap ?? null,
            },
          });
        }
      } catch (err) {
        logger.warn({ err }, "low_complaint_bonus compute failed");
      }
    }
  }

  return out;
}

/**
 * Returns approved incentive totals per user for the given (restaurantId,
 * year, month). Used by the payroll engine to add an "Incentives" earnings
 * line. The amount is approvedAmount when set, otherwise computedAmount.
 */
export async function getApprovedIncentiveTotals(
  restaurantId: number,
  year: number,
  month: number,
): Promise<Map<number, { total: number; lines: Array<{ ruleType: string; amount: number }> }>> {
  const { staffIncentivesTable } = await import("./db");
  const rows = await db
    .select()
    .from(staffIncentivesTable)
    .where(and(
      eq(staffIncentivesTable.restaurantId, restaurantId),
      eq(staffIncentivesTable.periodYear, year),
      eq(staffIncentivesTable.periodMonth, month),
      eq(staffIncentivesTable.status, "approved"),
    ));
  const out = new Map<number, { total: number; lines: Array<{ ruleType: string; amount: number }> }>();
  for (const r of rows) {
    const amt = num(r.approvedAmount ?? r.computedAmount, 0);
    if (amt <= 0) continue;
    const cur = out.get(r.userId) ?? { total: 0, lines: [] };
    cur.total += amt;
    cur.lines.push({ ruleType: r.ruleType, amount: amt });
    out.set(r.userId, cur);
  }
  return out;
}
