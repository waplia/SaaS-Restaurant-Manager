import { Router, type Request, type Response, type NextFunction } from "express";
import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  restaurantsTable,
  ordersTable,
  orderItemsTable,
  inventoryItemsTable,
  expensesTable,
  kitchenTicketsTable,
  floorTablesTable,
  notificationsTable,
  attendanceTable,
  staffTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { generateDueRecurringExpenses } from "./expenses";
import { logger } from "../lib/logger";

const router = Router();

// ---------------------------------------------------------------------------
// Multi-branch (i.e. multi-restaurant under one tenant) consolidated views.
//
// In this codebase a "branch" is a Restaurant under a Tenant — orders,
// inventory, expenses etc. are all scoped to restaurantId, and tenants can
// own multiple restaurants.  The consolidated dashboard aggregates across
// every restaurant the calling user has access to within the tenant.
// ---------------------------------------------------------------------------

router.use(
  "/tenants/:tenantId",
  requireRole("owner", "manager", "super_admin"),
);

type AuthedReq = Request & { restaurantIds?: number[]; tenantIdNum?: number };

async function loadAccessibleRestaurants(
  req: AuthedReq,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const tenantId = Number(req.params.tenantId);
  if (!tenantId || Number.isNaN(tenantId)) {
    res.status(400).json({ error: "Invalid tenantId" });
    return;
  }
  if (!req.user!.isSuperAdmin && req.user!.tenantId !== tenantId) {
    res.status(403).json({ error: "Access denied: cross-tenant request" });
    return;
  }
  const rows = await db
    .select({ id: restaurantsTable.id })
    .from(restaurantsTable)
    .where(
      and(
        eq(restaurantsTable.tenantId, tenantId),
        eq(restaurantsTable.isActive, true),
      ),
    );
  let ids = rows.map((r) => r.id);

  // Non-super-admin users that have a specific restaurantId on their JWT
  // (e.g. branch managers) are scoped to just that branch.  Owners with
  // `restaurantId === null` see every restaurant in the tenant.
  if (
    !req.user!.isSuperAdmin &&
    req.user!.restaurantId &&
    !["owner"].includes(req.user!.role)
  ) {
    ids = ids.filter((id) => id === req.user!.restaurantId);
  }

  req.restaurantIds = ids;
  req.tenantIdNum = tenantId;
  next();
}

function pickBranchScope(req: AuthedReq): number[] {
  const all = req.restaurantIds ?? [];
  const raw = req.query.branchId;
  if (!raw || raw === "all") return all;
  const id = Number(raw);
  if (!id || Number.isNaN(id)) return all;
  return all.includes(id) ? [id] : [];
}

function parseRange(req: Request): {
  from: Date;
  to: Date;
  hasExplicitTo: boolean;
} {
  const { period, from: fromStr, to: toStr } = req.query;
  let from = new Date();
  let to = new Date();
  let hasExplicitTo = false;

  if (fromStr && toStr) {
    from = new Date(String(fromStr));
    to = new Date(String(toStr));
    to.setHours(23, 59, 59, 999);
    hasExplicitTo = true;
  } else {
    const p = String(period ?? "30d");
    if (p === "1y") from.setFullYear(from.getFullYear() - 1);
    else if (p === "1m" || p === "30d") from.setMonth(from.getMonth() - 1);
    else if (p === "90d") from.setDate(from.getDate() - 90);
    else from.setDate(from.getDate() - 7);
  }
  from.setHours(0, 0, 0, 0);
  return { from, to, hasExplicitTo };
}

// ---------------------------------------------------------------------------
// GET /tenants/:tenantId/branches — list of restaurants the caller can see.
//   Used to drive the branch switcher in the UI.
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/branches",
  loadAccessibleRestaurants,
  async (req: AuthedReq, res) => {
    if (!req.restaurantIds || req.restaurantIds.length === 0) {
      res.json([]);
      return;
    }
    const rows = await db
      .select({
        id: restaurantsTable.id,
        name: restaurantsTable.name,
        slug: restaurantsTable.slug,
        city: restaurantsTable.city,
        logoUrl: restaurantsTable.logoUrl,
        isActive: restaurantsTable.isActive,
      })
      .from(restaurantsTable)
      .where(inArray(restaurantsTable.id, req.restaurantIds));
    res.json(rows);
  },
);

// ---------------------------------------------------------------------------
// GET /tenants/:tenantId/dashboard/summary — rolled-up KPIs across branches.
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/dashboard/summary",
  loadAccessibleRestaurants,
  async (req: AuthedReq, res) => {
    const ids = pickBranchScope(req);
    if (ids.length === 0) {
      res.json({
        todayRevenue: "0.00",
        todayOrders: 0,
        activeTables: 0,
        totalTables: 0,
        pendingTickets: 0,
        avgOrderValue: "0.00",
        revenueGrowth: "0",
        ordersGrowth: "0",
        lowStockAlerts: 0,
        unreadNotifications: 0,
        monthlyExpenses: null,
        branchCount: 0,
      });
      return;
    }

    try {
    // IST start-of-day — server clock is UTC, so vanilla setHours(0,0,0,0)
    // makes the dashboard show ₹0 sales for the first 5h30m of every
    // Indian morning. Matches the restaurants.timezone schema default.
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(Date.now() + IST_OFFSET_MS);
    istNow.setUTCHours(0, 0, 0, 0);
    const today = new Date(istNow.getTime() - IST_OFFSET_MS);
    const yesterday = new Date(today.getTime() - 86400000);
    // IST month — istNow already carries IST wall-clock components in its
    // UTC accessors (we shifted it by +5h30m above).
    const monthStart = `${istNow.getUTCFullYear()}-${String(istNow.getUTCMonth() + 1).padStart(2, "0")}-01`;

    await Promise.all(
      ids.map((id) => generateDueRecurringExpenses(id).catch(() => undefined)),
    );

    // Narrow column selection: `db.select().from(ordersTable)` expands to
    // every column declared in the schema, which throws an opaque 500 in
    // any environment whose `orders` table hasn't received the latest
    // schema-additive migrations (tip_amount, curbside_*, scheduled_for,
    // etc). The dashboard only needs status + total + timestamps, so list
    // them explicitly and keep this endpoint resilient to drift.
    const orderCols = {
      id: ordersTable.id,
      status: ordersTable.status,
      totalAmount: ordersTable.totalAmount,
      createdAt: ordersTable.createdAt,
    } as const;
    const [
      todayOrders,
      yesterdayOrders,
      tables,
      pendingTickets,
      lowStock,
      unread,
      monthExpenses,
      todayAttendance,
      staffRates,
    ] = await Promise.all([
      db
        .select(orderCols)
        .from(ordersTable)
        .where(
          and(
            inArray(ordersTable.restaurantId, ids),
            gte(ordersTable.createdAt, today),
          ),
        ),
      db
        .select(orderCols)
        .from(ordersTable)
        .where(
          and(
            inArray(ordersTable.restaurantId, ids),
            gte(ordersTable.createdAt, yesterday),
            sql`created_at < ${today}`,
          ),
        ),
      db
        .select()
        .from(floorTablesTable)
        .where(
          and(
            inArray(floorTablesTable.restaurantId, ids),
            eq(floorTablesTable.isActive, true),
          ),
        ),
      db
        .select({ c: sql<number>`cast(count(*) as int)` })
        .from(kitchenTicketsTable)
        .where(
          and(
            inArray(kitchenTicketsTable.restaurantId, ids),
            sql`status IN ('new','preparing')`,
          ),
        ),
      db
        .select({
          currentStock: inventoryItemsTable.currentStock,
          minStockLevel: inventoryItemsTable.minStockLevel,
        })
        .from(inventoryItemsTable)
        .where(inArray(inventoryItemsTable.restaurantId, ids)),
      db
        .select({ c: sql<number>`cast(count(*) as int)` })
        .from(notificationsTable)
        .where(
          and(
            inArray(notificationsTable.restaurantId, ids),
            eq(notificationsTable.isRead, false),
          ),
        ),
      db
        .select({
          sum: sql<string>`coalesce(sum(${expensesTable.amount}), 0)::text`,
        })
        .from(expensesTable)
        .where(
          and(
            inArray(expensesTable.restaurantId, ids),
            gte(expensesTable.expenseDate, monthStart),
          ),
        ),
      // Labour: today's attendance rows, keyed by user.
      db
        .select({
          userId: attendanceTable.userId,
          totalHours: attendanceTable.totalHours,
          clockIn: attendanceTable.clockIn,
          clockOut: attendanceTable.clockOut,
        })
        .from(attendanceTable)
        .where(
          and(
            inArray(attendanceTable.restaurantId, ids),
            gte(attendanceTable.clockIn, today),
          ),
        ),
      // Active staff with salary so we can derive an hourly rate.
      db
        .select({
          userId: staffTable.userId,
          salary: staffTable.salary,
        })
        .from(staffTable)
        .where(
          and(
            inArray(staffTable.restaurantId, ids),
            eq(staffTable.isActive, true),
          ),
        ),
    ]);

    const todayRev = todayOrders.reduce((s, o) => s + Number(o.totalAmount), 0);
    const yRev = yesterdayOrders.reduce((s, o) => s + Number(o.totalAmount), 0);
    const revenueGrowth =
      yRev === 0
        ? "100"
        : (((todayRev - yRev) / yRev) * 100).toFixed(1);
    const ordersGrowth =
      yesterdayOrders.length === 0
        ? "100"
        : (
            ((todayOrders.length - yesterdayOrders.length) /
              yesterdayOrders.length) *
            100
          ).toFixed(1);
    const activeTables = tables.filter((t) => t.status === "occupied").length;
    const lowStockAlerts = lowStock.filter(
      (i) => Number(i.currentStock) <= Number(i.minStockLevel),
    ).length;

    // Labour: hours worked today, plus an estimated labour cost derived from
    // each staff member's salary (treated as a monthly figure with a
    // conventional 160 working hours / month). For open shifts we
    // count time elapsed since clock-in.
    const ratePerUser = new Map<number, number>();
    for (const s of staffRates) {
      const salary = Number(s.salary ?? 0);
      if (salary > 0) ratePerUser.set(s.userId, salary / 160);
    }
    let labourHours = 0;
    let labourCost = 0;
    const now = Date.now();
    for (const a of todayAttendance) {
      // Skip rows with no clock-in timestamp at all — they would throw on
      // `.getTime()` below. The schema marks clockIn as notNull, but stale
      // / hand-edited rows in older tenants can still have it missing.
      if (a.clockIn == null && a.totalHours == null) continue;
      const hours = a.totalHours != null
        ? Number(a.totalHours)
        : a.clockIn == null
          ? 0
          : a.clockOut
            ? (a.clockOut.getTime() - a.clockIn.getTime()) / 3600000
            : (now - a.clockIn.getTime()) / 3600000;
      if (!Number.isFinite(hours) || hours <= 0) continue;
      labourHours += hours;
      labourCost += hours * (ratePerUser.get(a.userId) ?? 0);
    }

    res.json({
      todayRevenue: todayRev.toFixed(2),
      todayOrders: todayOrders.length,
      activeTables,
      totalTables: tables.length,
      pendingTickets: pendingTickets[0]?.c ?? 0,
      avgOrderValue: todayOrders.length
        ? (todayRev / todayOrders.length).toFixed(2)
        : "0.00",
      revenueGrowth,
      ordersGrowth,
      lowStockAlerts,
      unreadNotifications: unread[0]?.c ?? 0,
      monthlyExpenses: ["owner", "manager", "super_admin"].includes(
        req.user?.role ?? "",
      )
        ? Number(monthExpenses[0]?.sum ?? "0").toFixed(2)
        : null,
      todayLabourHours: labourHours.toFixed(1),
      todayLabourCost: labourCost.toFixed(2),
      branchCount: ids.length,
    });
    } catch (err) {
      // Pino's request-level logger only sees the status code, so without
      // this the underlying DrizzleQueryError / TypeError is invisible and
      // the dashboard just renders blank cards forever. Log the real cause
      // and return a structured 500 so the client can show a useful error.
      logger.error(
        { err, tenantId: req.tenantIdNum, ids, userId: req.user?.id },
        "tenant dashboard summary failed",
      );
      res.status(500).json({ error: "Failed to load dashboard summary" });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /tenants/:tenantId/dashboard/revenue-trend
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/dashboard/revenue-trend",
  loadAccessibleRestaurants,
  async (req: AuthedReq, res) => {
    const ids = pickBranchScope(req);
    if (ids.length === 0) {
      res.json([]);
      return;
    }

    const period = String(req.query.period ?? "7d");
    const from = new Date();
    if (period === "1y") from.setFullYear(from.getFullYear() - 1);
    else if (period === "1m" || period === "30d")
      from.setMonth(from.getMonth() - 1);
    else if (period === "90d") from.setDate(from.getDate() - 90);
    else from.setDate(from.getDate() - 7);
    const days = Math.ceil((Date.now() - from.getTime()) / 86400000);
    from.setHours(0, 0, 0, 0);

    const groupBy = String(req.query.groupBy ?? "daily");
    const orders = await db
      .select({
        totalAmount: ordersTable.totalAmount,
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .where(
        and(
          inArray(ordersTable.restaurantId, ids),
          gte(ordersTable.createdAt, from),
        ),
      );

    type Bucket = { revenue: number; orders: number };
    const buckets: Record<string, Bucket> = {};
    if (groupBy === "weekly") {
      for (let i = 0; i < days; i += 7) {
        const d = new Date(from);
        d.setDate(d.getDate() + i);
        buckets[d.toISOString().split("T")[0]] = { revenue: 0, orders: 0 };
      }
      for (const o of orders) {
        const diff = Math.floor(
          (o.createdAt.getTime() - from.getTime()) / (7 * 86400000),
        );
        const ws = new Date(from);
        ws.setDate(ws.getDate() + diff * 7);
        const key = ws.toISOString().split("T")[0];
        if (!buckets[key]) buckets[key] = { revenue: 0, orders: 0 };
        buckets[key].revenue += Number(o.totalAmount);
        buckets[key].orders++;
      }
    } else if (groupBy === "monthly") {
      const cur = new Date(from.getFullYear(), from.getMonth(), 1);
      const end = new Date();
      while (cur <= end) {
        buckets[cur.toISOString().slice(0, 7)] = { revenue: 0, orders: 0 };
        cur.setMonth(cur.getMonth() + 1);
      }
      for (const o of orders) {
        const key = o.createdAt.toISOString().slice(0, 7);
        if (buckets[key]) {
          buckets[key].revenue += Number(o.totalAmount);
          buckets[key].orders++;
        }
      }
    } else {
      for (let i = 0; i < days; i++) {
        const d = new Date(from);
        d.setDate(d.getDate() + i);
        buckets[d.toISOString().split("T")[0]] = { revenue: 0, orders: 0 };
      }
      for (const o of orders) {
        const key = o.createdAt.toISOString().split("T")[0];
        if (buckets[key]) {
          buckets[key].revenue += Number(o.totalAmount);
          buckets[key].orders++;
        }
      }
    }

    res.json(
      Object.entries(buckets)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({
          date,
          revenue: v.revenue.toFixed(2),
          orders: v.orders,
        })),
    );
  },
);

// ---------------------------------------------------------------------------
// GET /tenants/:tenantId/dashboard/popular-items
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/dashboard/popular-items",
  loadAccessibleRestaurants,
  async (req: AuthedReq, res) => {
    const ids = pickBranchScope(req);
    if (ids.length === 0) {
      res.json([]);
      return;
    }
    const limit = Number(req.query.limit ?? 10);
    const from = new Date();
    from.setDate(from.getDate() - 30);

    const rows = await db
      .select({
        menuItemId: orderItemsTable.menuItemId,
        name: orderItemsTable.menuItemName,
        orderCount: sql<number>`cast(count(*) as int)`,
        revenue: sql<string>`cast(sum(${orderItemsTable.totalPrice}) as text)`,
      })
      .from(orderItemsTable)
      .innerJoin(
        ordersTable,
        and(
          eq(orderItemsTable.orderId, ordersTable.id),
          inArray(ordersTable.restaurantId, ids),
          gte(ordersTable.createdAt, from),
        ),
      )
      .groupBy(orderItemsTable.menuItemId, orderItemsTable.menuItemName)
      .orderBy(desc(sql`count(*)`))
      .limit(limit);

    res.json(rows.map((r) => ({ ...r, imageUrl: null, categoryName: null })));
  },
);

// ---------------------------------------------------------------------------
// GET /tenants/:tenantId/dashboard/reports — consolidated reports payload
// shaped to match /restaurants/:id/dashboard/reports so the same UI can read
// from either endpoint.
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/dashboard/reports",
  loadAccessibleRestaurants,
  async (req: AuthedReq, res) => {
    const ids = pickBranchScope(req);
    if (ids.length === 0) {
      res.json({
        totalRevenue: "0.00",
        totalOrders: 0,
        totalTax: "0.00",
        effectiveTaxRate: "0.00",
        avgOrderValue: "0.00",
        revenueByDay: [],
        taxByDay: [],
        topItems: [],
        staffPerformance: [],
        paymentsByMethod: [],
        discountsByCashier: [],
        totalDiscounts: "0.00",
        totalExpenses: null,
        netProfit: null,
        expensesByCategory: [],
      });
      return;
    }

    const { from, to, hasExplicitTo } = parseRange(req);
    const groupBy = String(req.query.groupBy ?? "daily");

    await Promise.all(
      ids.map((id) => generateDueRecurringExpenses(id).catch(() => undefined)),
    );

    const orderConds = [
      inArray(ordersTable.restaurantId, ids),
      gte(ordersTable.createdAt, from),
    ];
    if (hasExplicitTo) orderConds.push(lte(ordersTable.createdAt, to));
    const orderWhere = and(...orderConds);

    const orders = await db.select().from(ordersTable).where(orderWhere);
    const totalRevenue = orders.reduce(
      (s, o) => s + Number(o.totalAmount),
      0,
    );
    const totalTax = orders.reduce((s, o) => s + Number(o.taxAmount), 0);
    const avgOrderValue = orders.length ? totalRevenue / orders.length : 0;

    const byDay: Record<
      string,
      { revenue: number; tax: number; orders: number }
    > = {};
    for (const o of orders) {
      const key = o.createdAt.toISOString().split("T")[0];
      if (!byDay[key]) byDay[key] = { revenue: 0, tax: 0, orders: 0 };
      byDay[key].revenue += Number(o.totalAmount);
      byDay[key].tax += Number(o.taxAmount);
      byDay[key].orders++;
    }

    const aggBuckets: Record<
      string,
      { revenue: number; tax: number; orders: number }
    > = {};
    for (const [date, v] of Object.entries(byDay)) {
      let key: string;
      if (groupBy === "yearly") key = date.slice(0, 4);
      else if (groupBy === "monthly") key = date.slice(0, 7);
      else key = date;
      if (!aggBuckets[key])
        aggBuckets[key] = { revenue: 0, tax: 0, orders: 0 };
      aggBuckets[key].revenue += v.revenue;
      aggBuckets[key].tax += v.tax;
      aggBuckets[key].orders += v.orders;
    }
    const sorted = Object.entries(aggBuckets).sort(([a], [b]) =>
      a.localeCompare(b),
    );

    const topItems = await db
      .select({
        menuItemId: orderItemsTable.menuItemId,
        name: orderItemsTable.menuItemName,
        orderCount: sql<number>`cast(count(*) as int)`,
        revenue: sql<string>`cast(sum(${orderItemsTable.totalPrice}) as text)`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(orderWhere)
      .groupBy(orderItemsTable.menuItemId, orderItemsTable.menuItemName)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    const expConds = [inArray(expensesTable.restaurantId, ids)];
    expConds.push(gte(expensesTable.expenseDate, from.toISOString().slice(0, 10)));
    if (hasExplicitTo)
      expConds.push(lte(expensesTable.expenseDate, to.toISOString().slice(0, 10)));
    const expenseWhere = and(...expConds);

    const expenseTotalRow = await db
      .select({
        sum: sql<string>`coalesce(sum(${expensesTable.amount}), 0)::text`,
      })
      .from(expensesTable)
      .where(expenseWhere);
    const totalExpenses = Number(expenseTotalRow[0]?.sum ?? "0");

    const effectiveTaxRate =
      totalRevenue > 0
        ? ((totalTax / totalRevenue) * 100).toFixed(2)
        : "0.00";

    const hasFinanceAccess = ["owner", "manager", "super_admin"].includes(
      req.user?.role ?? "",
    );

    res.json({
      totalRevenue: totalRevenue.toFixed(2),
      totalOrders: orders.length,
      totalTax: totalTax.toFixed(2),
      effectiveTaxRate,
      avgOrderValue: avgOrderValue.toFixed(2),
      revenueByDay: sorted.map(([date, v]) => ({
        date,
        revenue: v.revenue.toFixed(2),
        orders: v.orders,
      })),
      taxByDay: sorted.map(([date, v]) => ({
        date,
        tax: v.tax.toFixed(2),
        revenue: v.revenue.toFixed(2),
        orders: v.orders,
        effectiveRate:
          v.revenue > 0 ? ((v.tax / v.revenue) * 100).toFixed(1) : "0.0",
      })),
      topItems: topItems.map((r) => ({
        ...r,
        imageUrl: null,
        categoryName: null,
      })),
      staffPerformance: [],
      paymentsByMethod: [],
      discountsByCashier: [],
      totalDiscounts: "0.00",
      ...(hasFinanceAccess
        ? {
            totalExpenses: totalExpenses.toFixed(2),
            netProfit: (totalRevenue - totalExpenses).toFixed(2),
            expensesByCategory: [],
          }
        : { totalExpenses: null, netProfit: null, expensesByCategory: [] }),
    });
  },
);

// ---------------------------------------------------------------------------
// GET /tenants/:tenantId/dashboard/compare-branches — per-branch KPIs for the
// "Compare branches" reports view.
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/dashboard/compare-branches",
  loadAccessibleRestaurants,
  async (req: AuthedReq, res) => {
    const ids = req.restaurantIds ?? [];
    if (ids.length === 0) {
      res.json({ branches: [] });
      return;
    }
    const { from, to, hasExplicitTo } = parseRange(req);

    const restaurants = await db
      .select({
        id: restaurantsTable.id,
        name: restaurantsTable.name,
        city: restaurantsTable.city,
      })
      .from(restaurantsTable)
      .where(inArray(restaurantsTable.id, ids));

    const orderConds = [
      inArray(ordersTable.restaurantId, ids),
      gte(ordersTable.createdAt, from),
    ];
    if (hasExplicitTo) orderConds.push(lte(ordersTable.createdAt, to));

    const perBranch = await db
      .select({
        restaurantId: ordersTable.restaurantId,
        orderCount: sql<number>`cast(count(*) as int)`,
        revenue: sql<string>`coalesce(sum(${ordersTable.totalAmount}), 0)::text`,
        tax: sql<string>`coalesce(sum(${ordersTable.taxAmount}), 0)::text`,
      })
      .from(ordersTable)
      .where(and(...orderConds))
      .groupBy(ordersTable.restaurantId);

    const expConds = [inArray(expensesTable.restaurantId, ids)];
    expConds.push(
      gte(expensesTable.expenseDate, from.toISOString().slice(0, 10)),
    );
    if (hasExplicitTo)
      expConds.push(
        lte(expensesTable.expenseDate, to.toISOString().slice(0, 10)),
      );
    const expensesPer = await db
      .select({
        restaurantId: expensesTable.restaurantId,
        total: sql<string>`coalesce(sum(${expensesTable.amount}), 0)::text`,
      })
      .from(expensesTable)
      .where(and(...expConds))
      .groupBy(expensesTable.restaurantId);
    const expenseMap = new Map(
      expensesPer.map((r) => [r.restaurantId, Number(r.total)]),
    );

    const byId = new Map(perBranch.map((r) => [r.restaurantId, r]));
    const hasFinanceAccess = ["owner", "manager", "super_admin"].includes(
      req.user?.role ?? "",
    );

    const branches = restaurants.map((r) => {
      const row = byId.get(r.id);
      const revenue = Number(row?.revenue ?? "0");
      const orders = Number(row?.orderCount ?? 0);
      const tax = Number(row?.tax ?? "0");
      const expenses = expenseMap.get(r.id) ?? 0;
      return {
        restaurantId: r.id,
        name: r.name,
        city: r.city,
        revenue: revenue.toFixed(2),
        orders,
        tax: tax.toFixed(2),
        avgOrderValue: orders > 0 ? (revenue / orders).toFixed(2) : "0.00",
        expenses: hasFinanceAccess ? expenses.toFixed(2) : null,
        netProfit: hasFinanceAccess ? (revenue - expenses).toFixed(2) : null,
      };
    });

    res.json({ branches });
  },
);

// ---------------------------------------------------------------------------
// GET /tenants/:tenantId/inventory/aggregate — aggregate stock across
// branches, with per-branch breakdown for hover/expansion in the UI.
// Items are grouped by (lowercased name, unit).
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/inventory/aggregate",
  loadAccessibleRestaurants,
  async (req: AuthedReq, res) => {
    const ids = req.restaurantIds ?? [];
    if (ids.length === 0) {
      res.json([]);
      return;
    }

    const [items, restaurants] = await Promise.all([
      db
        .select()
        .from(inventoryItemsTable)
        .where(
          and(
            inArray(inventoryItemsTable.restaurantId, ids),
            eq(inventoryItemsTable.isActive, true),
          ),
        ),
      db
        .select({ id: restaurantsTable.id, name: restaurantsTable.name })
        .from(restaurantsTable)
        .where(inArray(restaurantsTable.id, ids)),
    ]);
    const restaurantName = new Map(restaurants.map((r) => [r.id, r.name]));

    type Group = {
      key: string;
      name: string;
      unit: string;
      category: string;
      totalStock: number;
      totalMin: number;
      lowStockBranches: number;
      branches: {
        restaurantId: number;
        restaurantName: string;
        currentStock: string;
        minStockLevel: string;
        isLowStock: boolean;
      }[];
    };
    const groups = new Map<string, Group>();
    for (const it of items) {
      const key = `${it.name.trim().toLowerCase()}__${it.unit}`;
      const cur = Number(it.currentStock);
      const min = Number(it.minStockLevel);
      const isLowStock = cur <= min;
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          name: it.name,
          unit: it.unit,
          category: it.category ?? "general",
          totalStock: 0,
          totalMin: 0,
          lowStockBranches: 0,
          branches: [],
        };
        groups.set(key, g);
      }
      g.totalStock += cur;
      g.totalMin += min;
      if (isLowStock) g.lowStockBranches++;
      g.branches.push({
        restaurantId: it.restaurantId,
        restaurantName: restaurantName.get(it.restaurantId) ?? "—",
        currentStock: it.currentStock,
        minStockLevel: it.minStockLevel,
        isLowStock,
      });
    }

    const out = Array.from(groups.values())
      .map((g) => ({
        key: g.key,
        name: g.name,
        unit: g.unit,
        category: g.category,
        totalStock: g.totalStock.toFixed(2),
        totalMin: g.totalMin.toFixed(2),
        branchCount: g.branches.length,
        lowStockBranches: g.lowStockBranches,
        isLowStock: g.totalStock <= g.totalMin,
        branches: g.branches.sort((a, b) =>
          a.restaurantName.localeCompare(b.restaurantName),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json(out);
  },
);

export default router;
