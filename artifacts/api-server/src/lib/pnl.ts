/**
 * Smart P&L computation (Task #146).
 *
 * Aggregates a single restaurant's profit-and-loss for an arbitrary date
 * range from the underlying primary tables — orders, payments, inventory
 * wastage, payroll, aggregator commissions and approved expenses. Pure
 * data-access; HTTP concerns live in `routes/pnl.ts`.
 */
import { and, eq, gte, lte, lt, sql, inArray } from "drizzle-orm";
import {
  db,
  ordersTable,
  paymentsTable,
  expensesTable,
  expenseCategoriesTable,
  inventoryTransactionsTable,
  inventoryItemsTable,
  payrollRunsTable,
  payrollItemsTable,
  staffTable,
  aggregatorPayoutRowsTable,
  pnlSettingsTable,
  type ExpenseCategoryKind,
} from "./db";

export interface PnlRange {
  from: Date;
  to: Date; // inclusive
}

export interface PnlBreakdown {
  sales: number;            // gross order totals (paid + unpaid, completed orders only)
  discounts: number;        // sum of discount_amount on those orders
  netRevenue: number;       // sales - taxes (totalAmount is already net of discounts)
  foodCost: number;         // inventory consumption + wastage at cost
  wastage: number;          // wastage subset of foodCost
  staffCost: number;        // payroll gross for the period (or salary fallback)
  gatewayFees: number;      // payment-gateway fees recorded as money-out
  aggregatorCommission: number; // commissions deducted by Swiggy/Zomato/etc.
  expensesByKind: Record<ExpenseCategoryKind, number>;
  totalExpenses: number;
  cogs: number;             // foodCost + cogs-classified expenses
  fixedCosts: number;
  variableCosts: number;
  marketingCosts: number;
  otherCosts: number;
  ebitda: number;           // netRevenue - cogs - staffCost - aggregatorCommission - gatewayFees - all expenses
  netProfit: number;        // == ebitda for now (no D&A modelled)
  grossMarginPct: number;
  netMarginPct: number;
  breakEvenSales: number;   // (fixedCosts + staffCost) / grossMarginRatio
}

export interface PnlCategoryShare {
  categoryId: number | null;
  name: string;
  kind: ExpenseCategoryKind | "system";
  amount: number;
  pctOfSales: number;
}

export interface PnlLeak {
  name: string;
  kind: ExpenseCategoryKind | "system";
  prevPctOfSales: number;
  currPctOfSales: number;
  deltaPct: number;          // percentage-point change
  severity: "high" | "medium";
}

const ALL_KINDS: ExpenseCategoryKind[] = ["fixed", "variable", "cogs", "marketing", "other"];

function emptyByKind(): Record<ExpenseCategoryKind, number> {
  return { fixed: 0, variable: 0, cogs: 0, marketing: 0, other: 0 };
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Days in [from, to] inclusive — used to prorate monthly salary fallbacks.
 */
function inclusiveDays(range: PnlRange): number {
  const ms = range.to.getTime() - range.from.getTime();
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

export async function getPnlSettings(restaurantId: number) {
  const [s] = await db.select().from(pnlSettingsTable)
    .where(eq(pnlSettingsTable.restaurantId, restaurantId))
    .limit(1);
  return s ?? null;
}

export async function ensurePnlSettings(restaurantId: number) {
  const existing = await getPnlSettings(restaurantId);
  if (existing) return existing;
  const [created] = await db.insert(pnlSettingsTable).values({ restaurantId }).onConflictDoNothing().returning();
  return created ?? (await getPnlSettings(restaurantId))!;
}

/**
 * Compute a P&L breakdown for one restaurant over [from, to].
 */
export async function computePnl(restaurantId: number, range: PnlRange): Promise<PnlBreakdown> {
  const fromStr = isoDate(range.from);
  const toStr = isoDate(range.to);
  // For orders/payments we use timestamps (createdAt / paymentDate).
  const toEnd = new Date(range.to);
  toEnd.setHours(23, 59, 59, 999);

  // Sales & discounts only count paid orders — mirrors the dashboard /
  // reports logic. Cancelled, voided, and in-progress orders never count.
  const [salesRow] = await db
    .select({
      gross: sql<string>`coalesce(sum(${ordersTable.totalAmount}), 0)::text`,
      discount: sql<string>`coalesce(sum(${ordersTable.discountAmount}), 0)::text`,
      tax: sql<string>`coalesce(sum(${ordersTable.taxAmount}), 0)::text`,
      orders: sql<number>`count(*)::int`,
    })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.restaurantId, restaurantId),
      gte(ordersTable.createdAt, range.from),
      lte(ordersTable.createdAt, toEnd),
      sql`${ordersTable.paymentStatus} = 'paid'`,
    ));
  const sales = num(salesRow?.gross);
  const discounts = num(salesRow?.discount);
  const taxes = num(salesRow?.tax);
  // P&L sales = totals net of taxes (tax is collected for the government,
  // not revenue). `totalAmount` is already net of discounts (it is
  // computed as subtotal + tax + service - discount), so we must NOT
  // subtract discounts again here — that would double-count them.
  const netRevenue = Math.max(0, sales - taxes);

  // Approved expenses bucketed by `expenseType` (snapshotted at write time).
  const expRows = await db
    .select({
      type: expensesTable.expenseType,
      amount: sql<string>`coalesce(sum(${expensesTable.amount}), 0)::text`,
    })
    .from(expensesTable)
    .where(and(
      eq(expensesTable.restaurantId, restaurantId),
      eq(expensesTable.status, "approved"),
      gte(expensesTable.expenseDate, fromStr),
      lte(expensesTable.expenseDate, toStr),
    ))
    .groupBy(expensesTable.expenseType);
  const expensesByKind = emptyByKind();
  for (const r of expRows) {
    const k = (ALL_KINDS as readonly string[]).includes(r.type) ? r.type as ExpenseCategoryKind : "other";
    expensesByKind[k] += num(r.amount);
  }
  const totalExpenses = ALL_KINDS.reduce((s, k) => s + expensesByKind[k], 0);

  // Inventory consumption + wastage at cost. We treat ANY decrement
  // (out / waste / consumed / sold) as food cost and surface wastage
  // separately for the leak panel.
  const [foodRow] = await db
    .select({
      consumed: sql<string>`coalesce(sum(case when ${inventoryTransactionsTable.type} in ('out','waste','consumed','sold') then ${inventoryTransactionsTable.quantity} * ${inventoryItemsTable.costPerUnit} else 0 end), 0)::text`,
      wasted:   sql<string>`coalesce(sum(case when ${inventoryTransactionsTable.type} = 'waste' then ${inventoryTransactionsTable.quantity} * ${inventoryItemsTable.costPerUnit} else 0 end), 0)::text`,
    })
    .from(inventoryTransactionsTable)
    .innerJoin(inventoryItemsTable, eq(inventoryTransactionsTable.itemId, inventoryItemsTable.id))
    .where(and(
      eq(inventoryTransactionsTable.restaurantId, restaurantId),
      gte(inventoryTransactionsTable.createdAt, range.from),
      lte(inventoryTransactionsTable.createdAt, toEnd),
    ));
  const foodCost = num(foodRow?.consumed);
  const wastage = num(foodRow?.wasted);

  // Staff cost: prefer finalized payroll runs that overlap the period; if
  // none exist, fall back to monthly salary × prorated days from the
  // staff master table. This keeps the P&L meaningful for restaurants
  // that haven't yet adopted the payroll module.
  const fromYear = range.from.getFullYear();
  const fromMonth = range.from.getMonth() + 1;
  const toYear = range.to.getFullYear();
  const toMonth = range.to.getMonth() + 1;
  const monthKey = (y: number, m: number) => y * 100 + m;
  const startKey = monthKey(fromYear, fromMonth);
  const endKey = monthKey(toYear, toMonth);

  const runs = await db
    .select({ id: payrollRunsTable.id, year: payrollRunsTable.periodYear, month: payrollRunsTable.periodMonth })
    .from(payrollRunsTable)
    .where(eq(payrollRunsTable.restaurantId, restaurantId));
  const runsInRange = runs.filter(r => {
    const k = monthKey(r.year, r.month);
    return k >= startKey && k <= endKey;
  });
  let staffCost = 0;
  if (runsInRange.length > 0) {
    const rows = await db
      .select({ gross: sql<string>`coalesce(sum(${payrollItemsTable.grossPay}), 0)::text` })
      .from(payrollItemsTable)
      .where(inArray(payrollItemsTable.runId, runsInRange.map(r => r.id)));
    staffCost = num(rows[0]?.gross);
  }
  if (staffCost === 0) {
    const staff = await db
      .select({ salary: staffTable.salary })
      .from(staffTable)
      .where(eq(staffTable.restaurantId, restaurantId));
    const monthlyBill = staff.reduce((s, r) => s + num(r.salary), 0);
    // Prorate per calendar-month segment so multi-month ranges and
    // Feb (28/29) crossings don't over/understate. For each month the
    // range touches, add `monthlyBill * overlapDays / daysInThatMonth`.
    let fraction = 0;
    let cursor = new Date(range.from.getFullYear(), range.from.getMonth(), 1);
    const endExclusive = new Date(range.to.getFullYear(), range.to.getMonth() + 1, 1);
    while (cursor < endExclusive) {
      const monthStart = cursor;
      const monthEndExclusive = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      const daysInMonth = (monthEndExclusive.getTime() - monthStart.getTime()) / 86_400_000;
      const overlapStart = monthStart > range.from ? monthStart : new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate());
      const rangeEndExclusive = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1);
      const overlapEnd = monthEndExclusive < rangeEndExclusive ? monthEndExclusive : rangeEndExclusive;
      const overlapDays = Math.max(0, (overlapEnd.getTime() - overlapStart.getTime()) / 86_400_000);
      fraction += overlapDays / daysInMonth;
      cursor = monthEndExclusive;
    }
    staffCost = monthlyBill * fraction;
  }

  // Payment gateway fees: outflow payments tagged as `gateway_fee` (or
  // method containing "fee"). Generous fallback so we don't double-count.
  const [gwRow] = await db
    .select({ total: sql<string>`coalesce(sum(${paymentsTable.amount}), 0)::text` })
    .from(paymentsTable)
    .where(and(
      eq(paymentsTable.restaurantId, restaurantId),
      eq(paymentsTable.direction, "out"),
      gte(paymentsTable.paymentDate, range.from),
      lte(paymentsTable.paymentDate, toEnd),
      sql`(${paymentsTable.partyType} = 'gateway' or ${paymentsTable.method} ilike '%gateway%' or ${paymentsTable.method} ilike '%fee%')`,
    ));
  const gatewayFees = num(gwRow?.total);

  // Aggregator commissions deducted from us during the period — read
  // from reconciled payout rows so we don't conflate with our own COGS.
  const [aggRow] = await db
    .select({ paise: sql<number>`coalesce(sum(${aggregatorPayoutRowsTable.commissionPaise}), 0)::bigint` })
    .from(aggregatorPayoutRowsTable)
    .where(and(
      eq(aggregatorPayoutRowsTable.restaurantId, restaurantId),
      gte(aggregatorPayoutRowsTable.orderDate, range.from),
      lte(aggregatorPayoutRowsTable.orderDate, toEnd),
    ));
  const aggregatorCommission = num(aggRow?.paise) / 100;

  const cogs = foodCost + expensesByKind.cogs;
  const fixedCosts = expensesByKind.fixed;
  const variableCosts = expensesByKind.variable;
  const marketingCosts = expensesByKind.marketing;
  const otherCosts = expensesByKind.other;

  const grossProfit = netRevenue - cogs - staffCost - aggregatorCommission - gatewayFees;
  const ebitda = grossProfit - fixedCosts - variableCosts - marketingCosts - otherCosts;
  const netProfit = ebitda;

  const grossMarginPct = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
  const netMarginPct = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;
  const grossMarginRatio = netRevenue > 0 ? grossProfit / netRevenue : 0;
  const breakEvenSales = grossMarginRatio > 0
    ? (fixedCosts + staffCost) / grossMarginRatio
    : 0;

  return {
    sales, discounts, netRevenue,
    foodCost, wastage,
    staffCost, gatewayFees, aggregatorCommission,
    expensesByKind, totalExpenses,
    cogs, fixedCosts, variableCosts, marketingCosts, otherCosts,
    ebitda, netProfit, grossMarginPct, netMarginPct,
    breakEvenSales,
  };
}

/**
 * Aggregates approved expenses by category (with display name + kind) so
 * the dashboard can show a "by category" breakdown. Includes synthetic
 * rows for foodCost, wastage, staffCost, gatewayFees and aggregator
 * commissions so the user sees one unified picture.
 */
export async function computeCategoryShare(
  restaurantId: number,
  range: PnlRange,
  pnl: PnlBreakdown,
): Promise<PnlCategoryShare[]> {
  const fromStr = isoDate(range.from);
  const toStr = isoDate(range.to);
  const rows = await db
    .select({
      categoryId: expensesTable.categoryId,
      name: expenseCategoriesTable.name,
      kind: expenseCategoriesTable.categoryKind,
      amount: sql<string>`coalesce(sum(${expensesTable.amount}), 0)::text`,
    })
    .from(expensesTable)
    .innerJoin(expenseCategoriesTable, eq(expensesTable.categoryId, expenseCategoriesTable.id))
    .where(and(
      eq(expensesTable.restaurantId, restaurantId),
      eq(expensesTable.status, "approved"),
      gte(expensesTable.expenseDate, fromStr),
      lte(expensesTable.expenseDate, toStr),
    ))
    .groupBy(expensesTable.categoryId, expenseCategoriesTable.name, expenseCategoriesTable.categoryKind);
  const sales = pnl.sales || 1;
  const out: PnlCategoryShare[] = rows.map(r => ({
    categoryId: r.categoryId,
    name: r.name,
    kind: ((ALL_KINDS as readonly string[]).includes(r.kind) ? r.kind : "other") as ExpenseCategoryKind,
    amount: num(r.amount),
    pctOfSales: (num(r.amount) / sales) * 100,
  }));
  // System (computed) buckets
  const systems: Array<[string, number]> = [
    ["Food cost (inventory)", pnl.foodCost - pnl.wastage],
    ["Wastage", pnl.wastage],
    ["Staff cost", pnl.staffCost],
    ["Aggregator commission", pnl.aggregatorCommission],
    ["Payment gateway fees", pnl.gatewayFees],
  ];
  for (const [name, amount] of systems) {
    if (amount <= 0) continue;
    out.push({ categoryId: null, name, kind: "system", amount, pctOfSales: (amount / sales) * 100 });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/**
 * Profit leak detection — compares each category's share-of-sales in
 * the current period vs the immediately preceding equal-length period.
 * Returns categories whose share grew by ≥ leakThresholdPct (or 5pp,
 * whichever is larger) — the bigger the jump, the more it's "leaking".
 */
export async function detectLeaks(
  restaurantId: number,
  range: PnlRange,
  thresholdPct: number,
): Promise<PnlLeak[]> {
  const days = inclusiveDays(range);
  const prevTo = new Date(range.from.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
  const prevRange: PnlRange = { from: prevFrom, to: prevTo };

  const [currPnl, prevPnl] = await Promise.all([
    computePnl(restaurantId, range),
    computePnl(restaurantId, prevRange),
  ]);
  const [currCats, prevCats] = await Promise.all([
    computeCategoryShare(restaurantId, range, currPnl),
    computeCategoryShare(restaurantId, prevRange, prevPnl),
  ]);
  const prevByName = new Map(prevCats.map(c => [c.name, c]));
  const minDelta = Math.max(5, thresholdPct * 0.4); // pp; below this is noise
  const leaks: PnlLeak[] = [];
  for (const c of currCats) {
    const p = prevByName.get(c.name);
    const prevPct = p?.pctOfSales ?? 0;
    const deltaPct = c.pctOfSales - prevPct;
    if (deltaPct >= minDelta) {
      leaks.push({
        name: c.name, kind: c.kind,
        prevPctOfSales: prevPct,
        currPctOfSales: c.pctOfSales,
        deltaPct,
        severity: deltaPct >= thresholdPct ? "high" : "medium",
      });
    }
  }
  return leaks.sort((a, b) => b.deltaPct - a.deltaPct);
}

/**
 * Build a 6-month rolling comparison ending in the month containing `to`.
 * Each entry covers a calendar month of the restaurant's local clock.
 */
export async function monthlyComparison(restaurantId: number, to: Date, months = 6) {
  const out: Array<{ year: number; month: number; label: string; pnl: PnlBreakdown }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const ref = new Date(to.getFullYear(), to.getMonth() - i, 1);
    const from = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const last = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    last.setHours(23, 59, 59, 999);
    const pnl = await computePnl(restaurantId, { from, to: last });
    const label = `${from.toLocaleString("en-US", { month: "short" })} ${from.getFullYear()}`;
    out.push({ year: from.getFullYear(), month: from.getMonth() + 1, label, pnl });
  }
  return out;
}
