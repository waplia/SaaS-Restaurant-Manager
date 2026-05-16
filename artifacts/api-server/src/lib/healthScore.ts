import { and, eq, gte, lt, lte, sql, desc, inArray } from "drizzle-orm";
import {
  db,
  ordersTable,
  customerFeedbackTable,
  externalReviewsTable,
  inventoryItemsTable,
  inventoryTransactionsTable,
  attendanceTable,
  expensesTable,
  cashRegisterSessionsTable,
  subscriptionPaymentsTable,
  tenantsTable,
  supportTicketsTable,
  restaurantsTable,
  branchesTable,
  restaurantHealthScoresTable,
} from "./db";

export type FactorKey =
  | "sales_growth"
  | "repeat_customers"
  | "ratings"
  | "wastage"
  | "attendance"
  | "profit_margin"
  | "cash_mismatch"
  | "payment_regularity"
  | "subscription"
  | "complaint_rate"
  | "stock_accuracy"
  | "retention";

export const FACTOR_LABELS: Record<FactorKey, string> = {
  sales_growth: "Sales Growth",
  repeat_customers: "Repeat Customers",
  ratings: "Customer Ratings",
  wastage: "Wastage Control",
  attendance: "Staff Attendance",
  profit_margin: "Profit Margin",
  cash_mismatch: "Cash Mismatch",
  payment_regularity: "Payment Regularity",
  subscription: "Subscription Health",
  complaint_rate: "Complaint Rate",
  stock_accuracy: "Stock Accuracy",
  retention: "Customer Retention",
};

// Equal weights — sum to ~100.
export const DEFAULT_WEIGHTS: Record<FactorKey, number> = {
  sales_growth: 9,
  repeat_customers: 9,
  ratings: 10,
  wastage: 8,
  attendance: 8,
  profit_margin: 10,
  cash_mismatch: 7,
  payment_regularity: 8,
  subscription: 7,
  complaint_rate: 8,
  stock_accuracy: 8,
  retention: 8,
};

export type SubScores = Record<FactorKey, number | null>;
export type FactorInputs = Record<string, unknown>;

export interface Suggestion {
  key: FactorKey;
  title: string;
  detail: string;
}

export interface HealthScoreResult {
  overall: number;
  band: "excellent" | "good" | "fair" | "poor" | "critical";
  subScores: SubScores;
  weights: Record<FactorKey, number>;
  inputs: FactorInputs;
  suggestions: Suggestion[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function bandOf(score: number): HealthScoreResult["band"] {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 55) return "fair";
  if (score >= 40) return "poor";
  return "critical";
}

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

// ── Factor computations ──────────────────────────────────────────────

async function factorSalesGrowth(restaurantId: number, now: Date) {
  const d30 = new Date(now.getTime() - 30 * DAY_MS);
  const d60 = new Date(now.getTime() - 60 * DAY_MS);
  const [recent] = await db
    .select({ total: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)` })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.restaurantId, restaurantId),
      eq(ordersTable.paymentStatus, "paid"),
      gte(ordersTable.createdAt, d30),
      lt(ordersTable.createdAt, now),
    ));
  const [prior] = await db
    .select({ total: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)` })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.restaurantId, restaurantId),
      eq(ordersTable.paymentStatus, "paid"),
      gte(ordersTable.createdAt, d60),
      lt(ordersTable.createdAt, d30),
    ));
  const recentTotal = num(recent?.total);
  const priorTotal = num(prior?.total);
  if (recentTotal + priorTotal <= 0) return { score: null as number | null, inputs: { recentTotal, priorTotal, growthPct: null } };
  if (priorTotal <= 0) return { score: 90, inputs: { recentTotal, priorTotal, growthPct: null } };
  const growthPct = ((recentTotal - priorTotal) / priorTotal) * 100;
  // Map: -20% → 0, 0% → 60, +20% → 100
  const score = clamp(60 + growthPct * 2);
  return { score, inputs: { recentTotal, priorTotal, growthPct } };
}

async function factorRepeatCustomers(restaurantId: number, now: Date) {
  const d30 = new Date(now.getTime() - 30 * DAY_MS);
  const d90 = new Date(now.getTime() - 90 * DAY_MS);
  const recent = await db
    .selectDistinct({ id: ordersTable.customerId })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.restaurantId, restaurantId),
      gte(ordersTable.createdAt, d30),
      sql`${ordersTable.customerId} IS NOT NULL`,
    ));
  const recentIds = recent.map(r => r.id!).filter(Boolean) as number[];
  if (recentIds.length === 0) return { score: null, inputs: { recentCustomers: 0, repeatCustomers: 0, repeatPct: null } };
  const repeats = await db
    .selectDistinct({ id: ordersTable.customerId })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.restaurantId, restaurantId),
      gte(ordersTable.createdAt, d90),
      lt(ordersTable.createdAt, d30),
      inArray(ordersTable.customerId, recentIds),
    ));
  const repeatPct = (repeats.length / recentIds.length) * 100;
  // 0% → 30, 30% → 80, 50% → 100
  const score = clamp(30 + repeatPct * 1.5);
  return { score, inputs: { recentCustomers: recentIds.length, repeatCustomers: repeats.length, repeatPct } };
}

async function factorRatings(restaurantId: number, now: Date) {
  const d90 = new Date(now.getTime() - 90 * DAY_MS);
  const [internal] = await db
    .select({ avg: sql<string>`COALESCE(AVG(${customerFeedbackTable.rating}), 0)`, cnt: sql<number>`COUNT(*)::int` })
    .from(customerFeedbackTable)
    .where(and(eq(customerFeedbackTable.restaurantId, restaurantId), gte(customerFeedbackTable.createdAt, d90)));
  const [external] = await db
    .select({ avg: sql<string>`COALESCE(AVG(${externalReviewsTable.rating}), 0)`, cnt: sql<number>`COUNT(*)::int` })
    .from(externalReviewsTable)
    .where(and(eq(externalReviewsTable.restaurantId, restaurantId), gte(externalReviewsTable.createdAt, d90)));
  const intCnt = Number(internal?.cnt ?? 0);
  const extCnt = Number(external?.cnt ?? 0);
  const totalCnt = intCnt + extCnt;
  if (totalCnt === 0) return { score: null, inputs: { avgRating: null, count: 0 } };
  const avg = (num(internal?.avg) * intCnt + num(external?.avg) * extCnt) / totalCnt;
  // 1 → 0, 3 → 50, 5 → 100
  const score = clamp(((avg - 1) / 4) * 100);
  return { score, inputs: { avgRating: avg, count: totalCnt } };
}

async function factorWastage(restaurantId: number, now: Date) {
  const d30 = new Date(now.getTime() - 30 * DAY_MS);
  const rows = await db
    .select({
      type: inventoryTransactionsTable.type,
      qty: inventoryTransactionsTable.quantity,
      cost: inventoryItemsTable.costPerUnit,
    })
    .from(inventoryTransactionsTable)
    .leftJoin(inventoryItemsTable, eq(inventoryItemsTable.id, inventoryTransactionsTable.itemId))
    .where(and(
      eq(inventoryTransactionsTable.restaurantId, restaurantId),
      gte(inventoryTransactionsTable.createdAt, d30),
    ));
  let wastageCost = 0;
  let purchaseCost = 0;
  for (const r of rows) {
    const v = Math.abs(num(r.qty)) * num(r.cost);
    const t = (r.type || "").toLowerCase();
    if (t === "wastage" || t === "waste" || t === "damaged" || t === "spoilage") wastageCost += v;
    else if (t === "purchase" || t === "received" || t === "in") purchaseCost += v;
  }
  if (purchaseCost <= 0 && wastageCost <= 0) return { score: null, inputs: { wastageCost, purchaseCost, wastagePct: null } };
  const denom = Math.max(purchaseCost, wastageCost);
  const wastagePct = denom > 0 ? (wastageCost / denom) * 100 : 0;
  // 0% → 100, 5% → 70, 15% → 0
  const score = clamp(100 - wastagePct * 6.66);
  return { score, inputs: { wastageCost, purchaseCost, wastagePct } };
}

async function factorAttendance(restaurantId: number, now: Date) {
  const d30 = new Date(now.getTime() - 30 * DAY_MS);
  const rows = await db
    .select({ status: attendanceTable.status, late: attendanceTable.lateMinutes })
    .from(attendanceTable)
    .where(and(
      eq(attendanceTable.restaurantId, restaurantId),
      gte(attendanceTable.clockIn, d30),
    ));
  if (rows.length === 0) return { score: null, inputs: { totalRecords: 0, presentPct: null, lateAvg: null } };
  const present = rows.filter(r => (r.status || "").toLowerCase() === "present").length;
  const lateAvg = rows.reduce((s, r) => s + (Number(r.late) || 0), 0) / rows.length;
  const presentPct = (present / rows.length) * 100;
  // presentPct directly, with a small late penalty
  const score = clamp(presentPct - Math.min(lateAvg / 5, 20));
  return { score, inputs: { totalRecords: rows.length, presentPct, lateAvg } };
}

async function factorProfitMargin(restaurantId: number, now: Date) {
  const d30 = new Date(now.getTime() - 30 * DAY_MS);
  const [sales] = await db
    .select({ total: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)` })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.restaurantId, restaurantId),
      eq(ordersTable.paymentStatus, "paid"),
      gte(ordersTable.createdAt, d30),
    ));
  const [exp] = await db
    .select({ total: sql<string>`COALESCE(SUM(${expensesTable.amount}), 0)` })
    .from(expensesTable)
    .where(and(
      eq(expensesTable.restaurantId, restaurantId),
      gte(expensesTable.expenseDate, d30.toISOString().slice(0, 10)),
    ));
  const salesTotal = num(sales?.total);
  const expTotal = num(exp?.total);
  if (salesTotal <= 0) return { score: null, inputs: { sales: salesTotal, expenses: expTotal, marginPct: null } };
  const marginPct = ((salesTotal - expTotal) / salesTotal) * 100;
  // 0% → 30, 20% → 80, 30%+ → 100
  const score = clamp(30 + marginPct * 2.5);
  return { score, inputs: { sales: salesTotal, expenses: expTotal, marginPct } };
}

async function factorCashMismatch(restaurantId: number, now: Date) {
  const d30 = new Date(now.getTime() - 30 * DAY_MS);
  const rows = await db
    .select({ overShort: cashRegisterSessionsTable.overShort })
    .from(cashRegisterSessionsTable)
    .where(and(
      eq(cashRegisterSessionsTable.restaurantId, restaurantId),
      eq(cashRegisterSessionsTable.status, "closed"),
      gte(cashRegisterSessionsTable.openedAt, d30),
    ));
  if (rows.length === 0) return { score: null, inputs: { sessions: 0, mismatched: 0, mismatchPct: null } };
  const mismatched = rows.filter(r => Math.abs(num(r.overShort)) > 50).length;
  const mismatchPct = (mismatched / rows.length) * 100;
  // 0% → 100, 10% → 70, 30%+ → 0
  const score = clamp(100 - mismatchPct * 3.33);
  return { score, inputs: { sessions: rows.length, mismatched, mismatchPct } };
}

async function factorPaymentRegularity(tenantId: number, now: Date) {
  const d180 = new Date(now.getTime() - 180 * DAY_MS);
  const rows = await db
    .select({ status: subscriptionPaymentsTable.status })
    .from(subscriptionPaymentsTable)
    .where(and(
      eq(subscriptionPaymentsTable.tenantId, tenantId),
      gte(subscriptionPaymentsTable.createdAt, d180),
    ));
  if (rows.length === 0) return { score: null, inputs: { payments: 0, succeeded: 0, successPct: null } };
  const succeeded = rows.filter(r => r.status === "succeeded").length;
  const successPct = (succeeded / rows.length) * 100;
  const score = clamp(successPct);
  return { score, inputs: { payments: rows.length, succeeded, successPct } };
}

async function factorSubscription(tenantId: number) {
  const [t] = await db.select({
    status: tenantsTable.planStatus,
    trialEndsAt: tenantsTable.trialEndsAt,
    subscriptionEndsAt: tenantsTable.subscriptionEndsAt,
    isSuspended: tenantsTable.isSuspended,
  }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!t) return { score: null, inputs: {} };
  const status = (t.status || "").toLowerCase();
  let score = 60;
  if (t.isSuspended) score = 0;
  else if (status === "active" || status === "subscribed") score = 100;
  else if (status === "trial") {
    const left = t.trialEndsAt ? (t.trialEndsAt.getTime() - Date.now()) / DAY_MS : 0;
    score = left > 7 ? 70 : left > 0 ? 50 : 25;
  } else if (status === "past_due" || status === "expired") score = 20;
  return { score, inputs: { status, isSuspended: t.isSuspended, subscriptionEndsAt: t.subscriptionEndsAt, trialEndsAt: t.trialEndsAt } };
}

async function factorComplaintRate(tenantId: number, restaurantId: number, now: Date) {
  const d30 = new Date(now.getTime() - 30 * DAY_MS);
  const [tickets] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(supportTicketsTable)
    .where(and(eq(supportTicketsTable.tenantId, tenantId), gte(supportTicketsTable.createdAt, d30)));
  const [orders] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(ordersTable)
    .where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, d30)));
  const ticketCnt = Number(tickets?.cnt ?? 0);
  const orderCnt = Number(orders?.cnt ?? 0);
  if (orderCnt === 0 && ticketCnt === 0) return { score: null, inputs: { tickets: 0, orders: 0, per1k: null } };
  const per1k = orderCnt > 0 ? (ticketCnt / orderCnt) * 1000 : ticketCnt * 100;
  // 0 per 1k → 100; 5 → 70; 20+ → 0
  const score = clamp(100 - per1k * 5);
  return { score, inputs: { tickets: ticketCnt, orders: orderCnt, per1k } };
}

async function factorStockAccuracy(restaurantId: number) {
  const items = await db
    .select({ stock: inventoryItemsTable.currentStock, reorder: inventoryItemsTable.minStockLevel })
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.restaurantId, restaurantId));
  if (items.length === 0) return { score: null, inputs: { items: 0, healthy: 0, healthyPct: null } };
  const healthy = items.filter(i => num(i.stock) >= num(i.reorder)).length;
  const healthyPct = (healthy / items.length) * 100;
  const score = clamp(healthyPct);
  return { score, inputs: { items: items.length, healthy, healthyPct } };
}

async function factorRetention(restaurantId: number, now: Date) {
  const d90 = new Date(now.getTime() - 90 * DAY_MS);
  const d180 = new Date(now.getTime() - 180 * DAY_MS);
  const earlier = await db
    .selectDistinct({ id: ordersTable.customerId })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.restaurantId, restaurantId),
      gte(ordersTable.createdAt, d180),
      lt(ordersTable.createdAt, d90),
      sql`${ordersTable.customerId} IS NOT NULL`,
    ));
  const earlierIds = earlier.map(r => r.id!).filter(Boolean) as number[];
  if (earlierIds.length === 0) return { score: null, inputs: { earlierCustomers: 0, retained: 0, retentionPct: null } };
  const retained = await db
    .selectDistinct({ id: ordersTable.customerId })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.restaurantId, restaurantId),
      gte(ordersTable.createdAt, d90),
      inArray(ordersTable.customerId, earlierIds),
    ));
  const retentionPct = (retained.length / earlierIds.length) * 100;
  // 0% → 20, 30% → 70, 60%+ → 100
  const score = clamp(20 + retentionPct * 1.33);
  return { score, inputs: { earlierCustomers: earlierIds.length, retained: retained.length, retentionPct } };
}

// Suggestion thresholds — only emit suggestions for weak factors (<60).
const SUGGESTION_TEMPLATES: Record<FactorKey, { title: string; detail: string }> = {
  sales_growth: { title: "Boost sales", detail: "Sales declined vs the prior 30 days. Run promos, push upsell suggestions, and review POS conversion." },
  repeat_customers: { title: "Drive repeat visits", detail: "Few customers are returning. Activate loyalty offers, SMS campaigns, and feedback follow-ups." },
  ratings: { title: "Improve customer ratings", detail: "Average rating is low. Reply to reviews, train staff on hospitality, and tighten food quality." },
  wastage: { title: "Cut wastage", detail: "Inventory wastage is high. Audit prep portions, FIFO compliance, and recipe yields." },
  attendance: { title: "Address attendance issues", detail: "Staff attendance/punctuality is weak. Review shift schedules and enforce attendance policies." },
  profit_margin: { title: "Improve margins", detail: "Profit margin is thin. Review menu pricing, supplier costs, and recurring expenses." },
  cash_mismatch: { title: "Tighten cash handling", detail: "Frequent cash discrepancies detected. Enforce blind closes and reconcile EOD." },
  payment_regularity: { title: "Resolve subscription payment failures", detail: "Some subscription payments failed. Update billing details and clear dues." },
  subscription: { title: "Renew or upgrade plan", detail: "Subscription is in trial / past-due / suspended state. Renew to retain features." },
  complaint_rate: { title: "Reduce complaints", detail: "Support tickets per 1k orders are high. Triage causes and add SOPs." },
  stock_accuracy: { title: "Replenish low stock", detail: "Several items are below their min stock level. Run auto-reorder and update PARs." },
  retention: { title: "Reactivate lapsed customers", detail: "Long-term retention is weak. Send reactivation campaigns to lapsed customers." },
};

export async function computeHealthScore(restaurantId: number, opts?: { now?: Date }): Promise<HealthScoreResult & { tenantId: number }> {
  const now = opts?.now ?? new Date();
  const [restaurant] = await db
    .select({ tenantId: restaurantsTable.tenantId })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));
  if (!restaurant) throw new Error(`Restaurant ${restaurantId} not found`);
  const tenantId = restaurant.tenantId;

  const [
    salesGrowth, repeatCustomers, ratings, wastage,
    attendance, profitMargin, cashMismatch, paymentRegularity,
    subscription, complaintRate, stockAccuracy, retention,
  ] = await Promise.all([
    factorSalesGrowth(restaurantId, now),
    factorRepeatCustomers(restaurantId, now),
    factorRatings(restaurantId, now),
    factorWastage(restaurantId, now),
    factorAttendance(restaurantId, now),
    factorProfitMargin(restaurantId, now),
    factorCashMismatch(restaurantId, now),
    factorPaymentRegularity(tenantId, now),
    factorSubscription(tenantId),
    factorComplaintRate(tenantId, restaurantId, now),
    factorStockAccuracy(restaurantId),
    factorRetention(restaurantId, now),
  ]);

  const subScores: SubScores = {
    sales_growth: salesGrowth.score,
    repeat_customers: repeatCustomers.score,
    ratings: ratings.score,
    wastage: wastage.score,
    attendance: attendance.score,
    profit_margin: profitMargin.score,
    cash_mismatch: cashMismatch.score,
    payment_regularity: paymentRegularity.score,
    subscription: subscription.score,
    complaint_rate: complaintRate.score,
    stock_accuracy: stockAccuracy.score,
    retention: retention.score,
  };

  const inputs: FactorInputs = {
    sales_growth: salesGrowth.inputs,
    repeat_customers: repeatCustomers.inputs,
    ratings: ratings.inputs,
    wastage: wastage.inputs,
    attendance: attendance.inputs,
    profit_margin: profitMargin.inputs,
    cash_mismatch: cashMismatch.inputs,
    payment_regularity: paymentRegularity.inputs,
    subscription: subscription.inputs,
    complaint_rate: complaintRate.inputs,
    stock_accuracy: stockAccuracy.inputs,
    retention: retention.inputs,
  };

  // Weighted average, ignoring null factors and renormalizing.
  let weightedSum = 0;
  let weightTotal = 0;
  (Object.keys(subScores) as FactorKey[]).forEach(k => {
    const v = subScores[k];
    if (v == null) return;
    const w = DEFAULT_WEIGHTS[k];
    weightedSum += v * w;
    weightTotal += w;
  });
  const overall = weightTotal > 0 ? weightedSum / weightTotal : 0;

  const suggestions: Suggestion[] = (Object.keys(subScores) as FactorKey[])
    .filter(k => subScores[k] != null && (subScores[k] as number) < 60)
    .sort((a, b) => (subScores[a] as number) - (subScores[b] as number))
    .slice(0, 6)
    .map(k => ({ key: k, ...SUGGESTION_TEMPLATES[k] }));

  return {
    overall: Math.round(overall * 100) / 100,
    band: bandOf(overall),
    subScores,
    weights: DEFAULT_WEIGHTS,
    inputs,
    suggestions,
    tenantId,
  };
}

export async function snapshotHealthScore(restaurantId: number, opts?: { now?: Date }): Promise<HealthScoreResult> {
  const result = await computeHealthScore(restaurantId, opts);
  const now = opts?.now ?? new Date();
  await db.insert(restaurantHealthScoresTable).values({
    tenantId: result.tenantId,
    restaurantId,
    branchId: null,
    snapshotDate: now,
    overallScore: String(result.overall),
    band: result.band,
    subScores: result.subScores as Record<string, number | null>,
    weights: result.weights,
    inputs: result.inputs,
    suggestions: result.suggestions,
  });
  return result;
}

export async function snapshotAllRestaurants(opts?: { now?: Date }): Promise<{ total: number; ok: number; failed: number }> {
  const restaurants = await db
    .select({ id: restaurantsTable.id })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.isActive, true));
  let ok = 0;
  let failed = 0;
  for (const r of restaurants) {
    try {
      await snapshotHealthScore(r.id, opts);
      ok += 1;
    } catch {
      failed += 1;
    }
  }
  return { total: restaurants.length, ok, failed };
}

export async function listLatestForTenant(tenantId: number) {
  // Most recent snapshot per restaurant for a tenant.
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (restaurant_id) *
    FROM restaurant_health_scores
    WHERE tenant_id = ${tenantId}
    ORDER BY restaurant_id, snapshot_date DESC
  `);
  return rows.rows;
}

export async function listHistory(restaurantId: number, days = 90) {
  const since = new Date(Date.now() - days * DAY_MS);
  return db
    .select()
    .from(restaurantHealthScoresTable)
    .where(and(
      eq(restaurantHealthScoresTable.restaurantId, restaurantId),
      gte(restaurantHealthScoresTable.snapshotDate, since),
    ))
    .orderBy(desc(restaurantHealthScoresTable.snapshotDate));
}

export async function getLatest(restaurantId: number) {
  const [row] = await db
    .select()
    .from(restaurantHealthScoresTable)
    .where(eq(restaurantHealthScoresTable.restaurantId, restaurantId))
    .orderBy(desc(restaurantHealthScoresTable.snapshotDate))
    .limit(1);
  return row ?? null;
}

export async function listOutlets(tenantId: number) {
  // Most recent snapshot grouped by branch (if branchId is null we still
  // return one row per restaurant).
  const restaurants = await db
    .select({ id: restaurantsTable.id, name: restaurantsTable.name })
    .from(restaurantsTable)
    .where(and(eq(restaurantsTable.tenantId, tenantId), eq(restaurantsTable.isActive, true)));
  const out: Array<{
    restaurantId: number;
    restaurantName: string;
    branchId: number | null;
    branchName: string | null;
    overallScore: number | null;
    band: string | null;
    snapshotDate: string | null;
  }> = [];
  for (const r of restaurants) {
    const branches = await db
      .select({ id: branchesTable.id, name: branchesTable.name })
      .from(branchesTable)
      .where(and(eq(branchesTable.restaurantId, r.id), eq(branchesTable.isActive, true)));
    const latest = await getLatest(r.id);
    if (branches.length === 0) {
      out.push({
        restaurantId: r.id,
        restaurantName: r.name,
        branchId: null,
        branchName: null,
        overallScore: latest ? Number(latest.overallScore) : null,
        band: latest?.band ?? null,
        snapshotDate: latest?.snapshotDate?.toISOString() ?? null,
      });
    } else {
      for (const b of branches) {
        out.push({
          restaurantId: r.id,
          restaurantName: r.name,
          branchId: b.id,
          branchName: b.name,
          overallScore: latest ? Number(latest.overallScore) : null,
          band: latest?.band ?? null,
          snapshotDate: latest?.snapshotDate?.toISOString() ?? null,
        });
      }
    }
  }
  return out;
}

// Convenience: also re-export labels & weights for routes/UI shape.
export const HEALTH_SCORE_FACTORS: FactorKey[] = Object.keys(FACTOR_LABELS) as FactorKey[];
