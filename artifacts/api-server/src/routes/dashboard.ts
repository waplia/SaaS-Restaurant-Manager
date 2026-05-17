import { Router } from "express";
import { eq, and, gte, lte, desc, count, sql } from "drizzle-orm";
import { db, ordersTable, floorTablesTable, kitchenTicketsTable, kitchensTable, inventoryItemsTable, notificationsTable, menuItemsTable, orderItemsTable, auditLogsTable, usersTable, attendanceTable, expensesTable, expenseCategoriesTable, orderDiscountsTable, ticketDelayAlertsTable, devicesTable } from "../lib/db";
import { AIProviderService } from "../lib/aiProviderService";
import { loadKitchenDelayConfig } from "../lib/kitchenDelay";
import { generateDueRecurringExpenses } from "./expenses";
import { requireRole } from "../middleware/authorize";
import { requirePlanFeature } from "../middleware/planFeature";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

router.use("/restaurants/:restaurantId", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), validateRestaurantAccess);

router.get("/restaurants/:restaurantId/dashboard/summary", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthStartStr = monthStart.toISOString().slice(0, 10);

  // Ensure recurring templates that became due are materialized into expenses
  // before we read this month's totals — otherwise the dashboard can show stale
  // figures for users who don't visit the Expenses page first.
  await generateDueRecurringExpenses(restaurantId).catch(() => undefined);

  // Narrow column selection: `db.select().from(ordersTable)` expands to
  // every schema column, which 500s in any environment whose orders table
  // hasn't received the newest schema-additive migrations. The dashboard
  // only needs status + total + timestamps.
  const orderCols = {
    id: ordersTable.id,
    status: ordersTable.status,
    totalAmount: ordersTable.totalAmount,
    createdAt: ordersTable.createdAt,
  } as const;
  const [
    todayOrdersRows,
    allTables,
    pendingTickets,
    lowStockItems,
    unreadNotifs,
    yesterdayOrders,
    monthExpensesRow,
  ] = await Promise.all([
    db.select(orderCols).from(ordersTable).where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, today))),
    db.select().from(floorTablesTable).where(and(eq(floorTablesTable.restaurantId, restaurantId), eq(floorTablesTable.isActive, true))),
    db.select({ count: count() }).from(kitchenTicketsTable).where(and(eq(kitchenTicketsTable.restaurantId, restaurantId), sql`status IN ('new','preparing')`)),
    db.select({ currentStock: inventoryItemsTable.currentStock, minStockLevel: inventoryItemsTable.minStockLevel }).from(inventoryItemsTable).where(eq(inventoryItemsTable.restaurantId, restaurantId)),
    db.select({ count: count() }).from(notificationsTable).where(and(eq(notificationsTable.restaurantId, restaurantId), eq(notificationsTable.isRead, false))),
    db.select(orderCols).from(ordersTable).where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, new Date(today.getTime() - 86400000)), sql`created_at < ${today}`)),
    db.select({ sum: sql<string>`coalesce(sum(${expensesTable.amount}), 0)::text` }).from(expensesTable).where(and(eq(expensesTable.restaurantId, restaurantId), gte(expensesTable.expenseDate, monthStartStr))),
  ]);

  // Exclude cancelled / voided orders from revenue, order count and AOV so
  // accounting figures aren't diluted by zero-value lines (cashier mistakes,
  // table-side voids, etc).
  const isBillable = (status: string | null) => status !== "cancelled" && status !== "voided";
  const billableToday = todayOrdersRows.filter(o => isBillable(o.status));
  const billableYesterday = yesterdayOrders.filter(o => isBillable(o.status));
  const todayRevenue = billableToday.reduce((s, o) => s + Number(o.totalAmount), 0);
  const yesterdayRevenue = billableYesterday.reduce((s, o) => s + Number(o.totalAmount), 0);
  // Growth = 0% when there's no activity at all; "+100%" only when today has
  // real revenue but yesterday had none — otherwise the dashboard would
  // misleadingly claim a +100% jump on idle days.
  const revenueGrowth = yesterdayRevenue === 0
    ? (todayRevenue === 0 ? "0" : "100")
    : (((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100).toFixed(1);
  const ordersGrowth = billableYesterday.length === 0
    ? (billableToday.length === 0 ? "0" : "100")
    : (((billableToday.length - billableYesterday.length) / billableYesterday.length) * 100).toFixed(1);
  const activeTables = allTables.filter(t => t.status === "occupied").length;
  // Treat 0 min-stock-level as "not tracked" so unconfigured items don't
  // spam owners with bogus low-stock alerts every time stock hits zero.
  const lowStockAlerts = lowStockItems.filter(i => Number(i.minStockLevel) > 0 && Number(i.currentStock) <= Number(i.minStockLevel)).length;
  const avgOrderValue = billableToday.length ? (todayRevenue / billableToday.length).toFixed(2) : "0.00";

  res.json({
    todayRevenue: todayRevenue.toFixed(2),
    todayOrders: billableToday.length,
    activeTables,
    totalTables: allTables.length,
    pendingTickets: pendingTickets[0]?.count ?? 0,
    avgOrderValue,
    revenueGrowth,
    ordersGrowth,
    lowStockAlerts,
    unreadNotifications: unreadNotifs[0]?.count ?? 0,
    monthlyExpenses: ["owner", "manager", "super_admin"].includes(req.user?.role ?? "")
      ? Number(monthExpensesRow[0]?.sum ?? "0").toFixed(2)
      : null,
  });
});

router.get("/restaurants/:restaurantId/dashboard/revenue-trend", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const period = String(req.query.period ?? "7d");
  const from = new Date();
  if (period === "1y") { from.setFullYear(from.getFullYear() - 1); }
  else if (period === "1m" || period === "30d") { from.setMonth(from.getMonth() - 1); }
  else if (period === "90d") { from.setDate(from.getDate() - 90); }
  else { from.setDate(from.getDate() - 7); }
  const days = Math.ceil((new Date().getTime() - from.getTime()) / 86400000);
  from.setHours(0, 0, 0, 0);

  const groupBy = String(req.query.groupBy ?? "daily");
  const orders = await db
    .select({ totalAmount: ordersTable.totalAmount, createdAt: ordersTable.createdAt })
    .from(ordersTable)
    .where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, from)));

  type Bucket = { revenue: number; orders: number };
  const buckets: Record<string, Bucket> = {};

  if (groupBy === "weekly") {
    for (let i = 0; i < days; i += 7) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      buckets[d.toISOString().split("T")[0]] = { revenue: 0, orders: 0 };
    }
    for (const o of orders) {
      const diff = Math.floor((o.createdAt.getTime() - from.getTime()) / (7 * 86400000));
      const weekStart = new Date(from);
      weekStart.setDate(weekStart.getDate() + diff * 7);
      const key = weekStart.toISOString().split("T")[0];
      if (!buckets[key]) buckets[key] = { revenue: 0, orders: 0 };
      buckets[key].revenue += Number(o.totalAmount);
      buckets[key].orders++;
    }
  } else if (groupBy === "monthly") {
    const cur = new Date(from.getFullYear(), from.getMonth(), 1);
    const end = new Date();
    while (cur <= end) {
      const key = cur.toISOString().slice(0, 7);
      buckets[key] = { revenue: 0, orders: 0 };
      cur.setMonth(cur.getMonth() + 1);
    }
    for (const o of orders) {
      const key = o.createdAt.toISOString().slice(0, 7);
      if (buckets[key]) { buckets[key].revenue += Number(o.totalAmount); buckets[key].orders++; }
    }
  } else {
    for (let i = 0; i < days; i++) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      buckets[d.toISOString().split("T")[0]] = { revenue: 0, orders: 0 };
    }
    for (const o of orders) {
      const key = o.createdAt.toISOString().split("T")[0];
      if (buckets[key]) { buckets[key].revenue += Number(o.totalAmount); buckets[key].orders++; }
    }
  }

  res.json(Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, revenue: v.revenue.toFixed(2), orders: v.orders })));
});

router.get("/restaurants/:restaurantId/dashboard/popular-items", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
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
    .innerJoin(ordersTable, and(
      eq(orderItemsTable.orderId, ordersTable.id),
      eq(ordersTable.restaurantId, restaurantId),
      gte(ordersTable.createdAt, from),
    ))
    .groupBy(orderItemsTable.menuItemId, orderItemsTable.menuItemName)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  res.json(rows.map(r => ({ ...r, imageUrl: null, categoryName: null })));
});

router.get("/restaurants/:restaurantId/dashboard/staff-activity", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const limit = Number(req.query.limit ?? 10);
  const rows = await db.select({
    id: auditLogsTable.id,
    userId: auditLogsTable.userId,
    userName: usersTable.name,
    action: auditLogsTable.action,
    entity: auditLogsTable.entity,
    details: auditLogsTable.details,
    createdAt: auditLogsTable.createdAt,
  }).from(auditLogsTable).leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id)).where(eq(auditLogsTable.restaurantId, restaurantId)).orderBy(desc(auditLogsTable.createdAt)).limit(limit);
  res.json(rows);
});

router.get("/restaurants/:restaurantId/dashboard/live-kitchen", requirePlanFeature("kitchen_display"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const tickets = await db.select().from(kitchenTicketsTable).where(and(eq(kitchenTicketsTable.restaurantId, restaurantId), sql`status NOT IN ('served','cancelled')`)).orderBy(desc(kitchenTicketsTable.isPriority), kitchenTicketsTable.createdAt);

  const enriched = await Promise.all(tickets.map(async (t) => {
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, t.orderId));
    const items = order ? await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id)) : [];
    let tableNumber: string | null = null;
    if (order?.tableId) {
      const [tbl] = await db.select().from(floorTablesTable).where(eq(floorTablesTable.id, order.tableId));
      tableNumber = tbl?.tableNumber ?? null;
    }
    return { ...t, orderNumber: order?.orderNumber ?? "", tableNumber, orderType: order?.orderType ?? "dine_in", items };
  }));

  res.json({
    newCount: enriched.filter(t => t.status === "new").length,
    preparingCount: enriched.filter(t => t.status === "preparing").length,
    readyCount: enriched.filter(t => t.status === "ready").length,
    tickets: enriched,
  });
});

router.get("/restaurants/:restaurantId/dashboard/reports", requirePlanFeature("advanced_reports"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { period, from: fromStr, to: toStr } = req.query;
  let from = new Date();
  let to = new Date();

  if (fromStr && toStr) {
    from = new Date(String(fromStr));
    to = new Date(String(toStr));
    to.setHours(23, 59, 59, 999);
  } else {
    const p = String(period);
    if (p === "1y") { from.setFullYear(from.getFullYear() - 1); }
    else if (p === "1m" || p === "30d") { from.setMonth(from.getMonth() - 1); }
    else if (p === "90d") { from.setDate(from.getDate() - 90); }
    else { from.setDate(from.getDate() - 7); }
  }
  from.setHours(0, 0, 0, 0);

  const dateCondition = fromStr && toStr
    ? and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, from), lte(ordersTable.createdAt, to))
    : and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, from));

  const orders = await db.select().from(ordersTable).where(dateCondition);
  const totalRevenue = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
  const totalTax = orders.reduce((s, o) => s + Number(o.taxAmount), 0);
  const avgOrderValue = orders.length ? totalRevenue / orders.length : 0;

  const byDay: Record<string, { revenue: number; tax: number; orders: number }> = {};
  for (const o of orders) {
    const key = o.createdAt.toISOString().split("T")[0];
    if (!byDay[key]) byDay[key] = { revenue: 0, tax: 0, orders: 0 };
    byDay[key].revenue += Number(o.totalAmount);
    byDay[key].tax += Number(o.taxAmount);
    byDay[key].orders++;
  }

  const topItemsRows = await db.select({
    menuItemId: orderItemsTable.menuItemId,
    name: orderItemsTable.menuItemName,
    orderCount: sql<number>`cast(count(*) as int)`,
    revenue: sql<string>`cast(sum(${orderItemsTable.totalPrice}) as text)`,
  }).from(orderItemsTable).innerJoin(ordersTable, and(eq(orderItemsTable.orderId, ordersTable.id), dateCondition!)).groupBy(orderItemsTable.menuItemId, orderItemsTable.menuItemName).orderBy(desc(sql`count(*)`)).limit(10);

  const staffPerfRows = await db.execute<{
    user_id: number;
    name: string;
    order_count: string;
    total_revenue: string;
    total_hours: string;
  }>(sql`
    WITH order_stats AS (
      SELECT
        o.waiter_id AS user_id,
        COUNT(o.id)::int AS order_count,
        COALESCE(SUM(o.total_amount), 0) AS total_revenue
      FROM orders o
      WHERE o.restaurant_id = ${restaurantId}
        AND o.waiter_id IS NOT NULL
        AND o.created_at >= ${from}
        ${to ? sql`AND o.created_at <= ${to}` : sql``}
      GROUP BY o.waiter_id
    ),
    attendance_stats AS (
      SELECT
        a.user_id,
        COALESCE(SUM(a.total_hours), 0) AS total_hours
      FROM attendance a
      WHERE a.restaurant_id = ${restaurantId}
        AND a.clock_in >= ${from}
        ${to ? sql`AND a.clock_in <= ${to}` : sql``}
      GROUP BY a.user_id
    )
    SELECT
      u.id AS user_id,
      u.name,
      COALESCE(os.order_count, 0)::text AS order_count,
      COALESCE(os.total_revenue, 0)::text AS total_revenue,
      COALESCE(att.total_hours, 0)::text AS total_hours
    FROM users u
    LEFT JOIN order_stats os ON os.user_id = u.id
    LEFT JOIN attendance_stats att ON att.user_id = u.id
    WHERE u.restaurant_id = ${restaurantId} AND u.is_active = true
    ORDER BY COALESCE(os.order_count, 0) DESC
    LIMIT 20
  `);

  const groupByParam = String(req.query.groupBy ?? "daily");
  type AggBucket = { revenue: number; tax: number; orders: number };
  const aggBuckets: Record<string, AggBucket> = {};

  for (const [date, v] of Object.entries(byDay)) {
    let key: string;
    if (groupByParam === "yearly") {
      key = date.slice(0, 4);
    } else if (groupByParam === "monthly") {
      key = date.slice(0, 7);
    } else {
      key = date;
    }
    if (!aggBuckets[key]) aggBuckets[key] = { revenue: 0, tax: 0, orders: 0 };
    aggBuckets[key].revenue += v.revenue;
    aggBuckets[key].tax += v.tax;
    aggBuckets[key].orders += v.orders;
  }

  const sortedBuckets = Object.entries(aggBuckets).sort(([a], [b]) => a.localeCompare(b));

  const effectiveTaxRate = totalRevenue > 0 ? ((totalTax / totalRevenue) * 100).toFixed(2) : "0.00";

  // Same catch-up before reading expense aggregates for the analytics window.
  await generateDueRecurringExpenses(restaurantId).catch(() => undefined);

  const expenseConditions: Parameters<typeof and>[0][] = [eq(expensesTable.restaurantId, restaurantId)];
  expenseConditions.push(gte(expensesTable.expenseDate, from.toISOString().slice(0, 10)));
  if (fromStr && toStr) expenseConditions.push(lte(expensesTable.expenseDate, to.toISOString().slice(0, 10)));
  const expenseWhere = and(...expenseConditions);

  const discountsByCashierRows = await db.execute<{
    user_id: number | null;
    name: string;
    type: string;
    reason: string;
    count: string;
    total: string;
  }>(sql`
    SELECT
      d.recorded_by_user_id AS user_id,
      COALESCE(u.name, 'System') AS name,
      d.type,
      COALESCE(NULLIF(d.reason, ''), '(no reason)') AS reason,
      COUNT(*)::text AS count,
      COALESCE(SUM(d.amount), 0)::text AS total
    FROM ${orderDiscountsTable} d
    INNER JOIN ${ordersTable} o ON o.id = d.order_id
    LEFT JOIN ${usersTable} u ON u.id = d.recorded_by_user_id
    WHERE o.restaurant_id = ${restaurantId}
      AND o.created_at >= ${from}
      ${fromStr && toStr ? sql`AND o.created_at <= ${to}` : sql``}
    GROUP BY d.recorded_by_user_id, u.name, d.type, d.reason
    ORDER BY SUM(d.amount) DESC
  `);
  const discountsByCashier = discountsByCashierRows.rows.map(r => ({
    userId: r.user_id,
    name: r.name,
    type: r.type,
    reason: r.reason,
    count: Number(r.count),
    total: r.total,
  }));
  const totalDiscounts = discountsByCashier.reduce((s, r) => s + Number(r.total), 0).toFixed(2);

  const [expenseTotalRow, expenseByCat, paymentsByMethodRows] = await Promise.all([
    db.select({ sum: sql<string>`coalesce(sum(${expensesTable.amount}), 0)::text` }).from(expensesTable).where(expenseWhere),
    db.select({
      categoryId: expensesTable.categoryId,
      categoryName: expenseCategoriesTable.name,
      color: expenseCategoriesTable.color,
      total: sql<string>`coalesce(sum(${expensesTable.amount}), 0)::text`,
    }).from(expensesTable).innerJoin(expenseCategoriesTable, eq(expensesTable.categoryId, expenseCategoriesTable.id))
      .where(expenseWhere).groupBy(expensesTable.categoryId, expenseCategoriesTable.name, expenseCategoriesTable.color),
    db.execute<{ direction: string; method: string; total: string; count: string }>(sql`
      SELECT direction, method,
        COALESCE(SUM(amount), 0)::text AS total,
        COUNT(*)::text AS count
      FROM payments
      WHERE restaurant_id = ${restaurantId}
        AND payment_date >= ${from}
        ${fromStr && toStr ? sql`AND payment_date <= ${to}` : sql``}
      GROUP BY direction, method
      ORDER BY direction, method
    `),
  ]);

  const totalExpenses = Number(expenseTotalRow[0]?.sum ?? "0");
  const netProfit = totalRevenue - totalExpenses;

  const paymentsByMethod = paymentsByMethodRows.rows.map(r => ({
    direction: r.direction,
    method: r.method,
    total: r.total,
    count: Number(r.count),
  }));

  const devicePerfRows = await db.execute<{
    device_id: number | null;
    device_name: string;
    device_type: string;
    is_handheld: boolean;
    assigned_user_id: number | null;
    assigned_user_name: string | null;
    order_count: string;
    total_revenue: string;
  }>(sql`
    SELECT
      d.id AS device_id,
      d.name AS device_name,
      d.type AS device_type,
      d.is_handheld AS is_handheld,
      d.assigned_user_id AS assigned_user_id,
      u.name AS assigned_user_name,
      COALESCE(COUNT(o.id), 0)::text AS order_count,
      COALESCE(SUM(o.total_amount), 0)::text AS total_revenue
    FROM ${devicesTable} d
    LEFT JOIN ${usersTable} u ON u.id = d.assigned_user_id
    LEFT JOIN ${ordersTable} o
      ON o.waiter_id = d.assigned_user_id
     AND o.restaurant_id = ${restaurantId}
     AND o.created_at >= ${from}
     ${fromStr && toStr ? sql`AND o.created_at <= ${to}` : sql``}
    WHERE d.restaurant_id = ${restaurantId}
      AND d.assigned_user_id IS NOT NULL
    GROUP BY d.id, d.name, d.type, d.is_handheld, d.assigned_user_id, u.name
    ORDER BY SUM(o.total_amount) DESC NULLS LAST
  `);
  const devicePerformance = devicePerfRows.rows.map(r => ({
    deviceId: r.device_id,
    deviceName: r.device_name,
    deviceType: r.device_type,
    isHandheld: !!r.is_handheld,
    assignedUserId: r.assigned_user_id,
    assignedUserName: r.assigned_user_name,
    orderCount: Number(r.order_count),
    totalRevenue: r.total_revenue,
  }));

  res.json({
    paymentsByMethod,
    discountsByCashier,
    devicePerformance,
    totalDiscounts,
    totalRevenue: totalRevenue.toFixed(2),
    totalOrders: orders.length,
    totalTax: totalTax.toFixed(2),
    effectiveTaxRate,
    avgOrderValue: avgOrderValue.toFixed(2),
    revenueByDay: sortedBuckets.map(([date, v]) => ({ date, revenue: v.revenue.toFixed(2), orders: v.orders })),
    taxByDay: sortedBuckets.map(([date, v]) => ({
      date,
      tax: v.tax.toFixed(2),
      revenue: v.revenue.toFixed(2),
      orders: v.orders,
      effectiveRate: v.revenue > 0 ? ((v.tax / v.revenue) * 100).toFixed(1) : "0.0",
    })),
    topItems: topItemsRows.map(r => ({ ...r, imageUrl: null, categoryName: null })),
    staffPerformance: staffPerfRows.rows.map(r => ({
      userId: r.user_id,
      name: r.name,
      orderCount: Number(r.order_count),
      totalRevenue: r.total_revenue,
      totalHours: Number(r.total_hours).toFixed(1),
    })),
    ...(["owner", "manager", "super_admin"].includes(req.user?.role ?? "")
      ? {
          totalExpenses: totalExpenses.toFixed(2),
          netProfit: netProfit.toFixed(2),
          expensesByCategory: expenseByCat.map(c => ({ ...c, total: Number(c.total).toFixed(2) })),
        }
      : { totalExpenses: null, netProfit: null, expensesByCategory: [] }),
  });
});

// ─────────────────────── Kitchen Performance Report ───────────────────────

interface KitchenPerfRow {
  station: { id: number | null; name: string };
  ticketsTotal: number;
  ticketsDelayed: number;
  avgPrepMinutes: number | null;
  delayedPct: number;
}

interface DelayedItemRow {
  menuItemId: number | null;
  name: string;
  ticketsDelayed: number;
  avgDelayMinutes: number;
}

interface PeakHourRow { hour: number; ticketsDelayed: number; }

router.get(
  "/restaurants/:restaurantId/dashboard/kitchen-performance",
  requirePlanFeature("kitchen_display"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const fromStr = req.query["from"] ? String(req.query["from"]) : null;
    const toStr = req.query["to"] ? String(req.query["to"]) : null;
    const kitchenIdQ = req.query["kitchenId"] ? Number(req.query["kitchenId"]) : null;

    const to = toStr ? new Date(toStr) : new Date();
    const from = fromStr ? new Date(fromStr) : new Date(to.getTime() - 7 * 86_400_000);

    const conds = [
      eq(kitchenTicketsTable.restaurantId, restaurantId),
      gte(kitchenTicketsTable.createdAt, from),
      lte(kitchenTicketsTable.createdAt, to),
    ];
    if (kitchenIdQ != null) conds.push(eq(kitchenTicketsTable.kitchenId, kitchenIdQ));

    const tickets = await db.select({
      id: kitchenTicketsTable.id,
      orderId: kitchenTicketsTable.orderId,
      kitchenId: kitchenTicketsTable.kitchenId,
      status: kitchenTicketsTable.status,
      isPriority: kitchenTicketsTable.isPriority,
      createdAt: kitchenTicketsTable.createdAt,
      startedAt: kitchenTicketsTable.startedAt,
      completedAt: kitchenTicketsTable.completedAt,
      expectedPrepMinutes: kitchenTicketsTable.expectedPrepMinutes,
      expectedReadyAt: kitchenTicketsTable.expectedReadyAt,
      delayAlertCount: kitchenTicketsTable.delayAlertCount,
    }).from(kitchenTicketsTable).where(and(...conds));

    const kitchens = await db.select().from(kitchensTable).where(eq(kitchensTable.restaurantId, restaurantId));
    const kitchenMap = new Map(kitchens.map(k => [k.id, k.name] as const));

    // Per-station aggregates
    const stationAgg = new Map<number | null, { total: number; delayed: number; prepSum: number; prepCount: number }>();
    for (const t of tickets) {
      const key = t.kitchenId;
      const a = stationAgg.get(key) ?? { total: 0, delayed: 0, prepSum: 0, prepCount: 0 };
      a.total++;
      if ((t.delayAlertCount ?? 0) > 0) a.delayed++;
      if (t.completedAt && t.startedAt) {
        a.prepSum += (new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime()) / 60_000;
        a.prepCount++;
      } else if (t.completedAt) {
        a.prepSum += (new Date(t.completedAt).getTime() - new Date(t.createdAt).getTime()) / 60_000;
        a.prepCount++;
      }
      stationAgg.set(key, a);
    }
    const stations: KitchenPerfRow[] = Array.from(stationAgg.entries()).map(([kid, a]) => ({
      station: { id: kid, name: kid != null ? (kitchenMap.get(kid) ?? `Kitchen ${kid}`) : "Unassigned" },
      ticketsTotal: a.total,
      ticketsDelayed: a.delayed,
      avgPrepMinutes: a.prepCount > 0 ? Number((a.prepSum / a.prepCount).toFixed(1)) : null,
      delayedPct: a.total > 0 ? Number(((a.delayed / a.total) * 100).toFixed(1)) : 0,
    })).sort((a, b) => b.ticketsTotal - a.ticketsTotal);

    // Top delayed items (from order_items in delayed tickets' orders)
    const delayedTicketIds = tickets.filter(t => (t.delayAlertCount ?? 0) > 0).map(t => t.id);
    const delayedAlerts = delayedTicketIds.length > 0
      ? await db.select({
          ticketId: ticketDelayAlertsTable.ticketId,
          delayedByMinutes: ticketDelayAlertsTable.delayedByMinutes,
        }).from(ticketDelayAlertsTable)
          .where(and(eq(ticketDelayAlertsTable.restaurantId, restaurantId), gte(ticketDelayAlertsTable.createdAt, from), lte(ticketDelayAlertsTable.createdAt, to)))
      : [];
    const delayByTicket = new Map<number, number[]>();
    for (const a of delayedAlerts) {
      const arr = delayByTicket.get(a.ticketId) ?? [];
      arr.push(a.delayedByMinutes);
      delayByTicket.set(a.ticketId, arr);
    }

    const orderIdsForDelayed = Array.from(new Set(tickets.filter(t => (t.delayAlertCount ?? 0) > 0).map(t => t.orderId)));
    const delayedOrderItems = orderIdsForDelayed.length > 0
      ? await db.select({
          orderId: orderItemsTable.orderId,
          menuItemId: orderItemsTable.menuItemId,
          menuItemName: orderItemsTable.menuItemName,
        }).from(orderItemsTable).where(sql`${orderItemsTable.orderId} = ANY(${orderIdsForDelayed})`)
      : [];

    const ticketsByOrder = new Map<number, typeof tickets[number][]>();
    for (const t of tickets) {
      const arr = ticketsByOrder.get(t.orderId) ?? [];
      arr.push(t);
      ticketsByOrder.set(t.orderId, arr);
    }

    const itemAgg = new Map<string, { name: string; menuItemId: number | null; count: number; delaySum: number }>();
    for (const oi of delayedOrderItems) {
      const orderTickets = (ticketsByOrder.get(oi.orderId) ?? []).filter(t => (t.delayAlertCount ?? 0) > 0);
      if (orderTickets.length === 0) continue;
      const avgDelay = orderTickets
        .map(t => {
          const delays = delayByTicket.get(t.id) ?? [];
          return delays.length > 0 ? Math.max(...delays) : 0;
        })
        .reduce((s, v) => s + v, 0) / orderTickets.length;
      const k = String(oi.menuItemId ?? oi.menuItemName);
      const a = itemAgg.get(k) ?? { name: oi.menuItemName, menuItemId: oi.menuItemId, count: 0, delaySum: 0 };
      a.count++;
      a.delaySum += avgDelay;
      itemAgg.set(k, a);
    }
    const topDelayedItems: DelayedItemRow[] = Array.from(itemAgg.values())
      .map(a => ({
        menuItemId: a.menuItemId,
        name: a.name,
        ticketsDelayed: a.count,
        avgDelayMinutes: Number((a.delaySum / a.count).toFixed(1)),
      }))
      .sort((a, b) => b.ticketsDelayed - a.ticketsDelayed)
      .slice(0, 10);

    // Peak delay hours (group alert createdAt by hour-of-day)
    const alertsForHours = await db.select({
      createdAt: ticketDelayAlertsTable.createdAt,
    }).from(ticketDelayAlertsTable).where(and(
      eq(ticketDelayAlertsTable.restaurantId, restaurantId),
      gte(ticketDelayAlertsTable.createdAt, from),
      lte(ticketDelayAlertsTable.createdAt, to),
    ));
    const hourBuckets = new Array(24).fill(0);
    for (const a of alertsForHours) {
      const h = new Date(a.createdAt).getHours();
      hourBuckets[h]++;
    }
    const peakHours: PeakHourRow[] = hourBuckets.map((c, h) => ({ hour: h, ticketsDelayed: c }));

    // Station overload: max concurrent open tickets per kitchen during the window.
    // Approximate by sweeping ticket create/complete events.
    const overload = stations.map(s => {
      const sTickets = tickets.filter(t => t.kitchenId === s.station.id);
      const events: Array<{ t: number; delta: number }> = [];
      for (const t of sTickets) {
        events.push({ t: new Date(t.createdAt).getTime(), delta: 1 });
        const end = t.completedAt ? new Date(t.completedAt).getTime() : to.getTime();
        events.push({ t: end, delta: -1 });
      }
      events.sort((a, b) => a.t - b.t || a.delta - b.delta);
      let cur = 0, peak = 0;
      for (const e of events) { cur += e.delta; if (cur > peak) peak = cur; }
      return { stationId: s.station.id, stationName: s.station.name, peakConcurrent: peak };
    });

    const totalTickets = tickets.length;
    const totalDelayed = tickets.filter(t => (t.delayAlertCount ?? 0) > 0).length;
    const completedTickets = tickets.filter(t => t.completedAt);
    const allPrepMinutes = completedTickets.map(t => {
      const start = t.startedAt ? new Date(t.startedAt).getTime() : new Date(t.createdAt).getTime();
      return (new Date(t.completedAt!).getTime() - start) / 60_000;
    });
    const avgPrep = allPrepMinutes.length > 0
      ? Number((allPrepMinutes.reduce((s, v) => s + v, 0) / allPrepMinutes.length).toFixed(1))
      : null;

    res.json({
      window: { from: from.toISOString(), to: to.toISOString() },
      kitchenId: kitchenIdQ,
      summary: {
        ticketsTotal: totalTickets,
        ticketsDelayed: totalDelayed,
        delayedPct: totalTickets > 0 ? Number(((totalDelayed / totalTickets) * 100).toFixed(1)) : 0,
        avgPrepMinutes: avgPrep,
        alertsTotal: alertsForHours.length,
      },
      stations,
      topDelayedItems,
      peakHours,
      overload,
    });
  },
);

router.get(
  "/restaurants/:restaurantId/dashboard/kitchen-delay-alerts",
  requirePlanFeature("kitchen_display"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const limit = Math.min(200, Math.max(1, Number(req.query["limit"] ?? 50)));
    const rows = await db.select({
      id: ticketDelayAlertsTable.id,
      ticketId: ticketDelayAlertsTable.ticketId,
      kitchenId: ticketDelayAlertsTable.kitchenId,
      thresholdMinutes: ticketDelayAlertsTable.thresholdMinutes,
      delayedByMinutes: ticketDelayAlertsTable.delayedByMinutes,
      createdAt: ticketDelayAlertsTable.createdAt,
      orderId: kitchenTicketsTable.orderId,
      orderNumber: ordersTable.orderNumber,
      ticketStatus: kitchenTicketsTable.status,
    })
    .from(ticketDelayAlertsTable)
    .innerJoin(kitchenTicketsTable, eq(kitchenTicketsTable.id, ticketDelayAlertsTable.ticketId))
    .innerJoin(ordersTable, eq(ordersTable.id, kitchenTicketsTable.orderId))
    .where(eq(ticketDelayAlertsTable.restaurantId, restaurantId))
    .orderBy(desc(ticketDelayAlertsTable.createdAt))
    .limit(limit);
    res.json(rows);
  },
);

// AI summary cache (in-memory) keyed by restaurant + window
interface AiSummaryCacheEntry { key: string; expiresAt: number; payload: { summary: string; insights: string[]; generatedAt: string; cached: boolean } }
const aiSummaryCache = new Map<number, AiSummaryCacheEntry>();
const AI_SUMMARY_TTL_MS = 5 * 60 * 1000;

router.get(
  "/restaurants/:restaurantId/dashboard/kitchen-performance/ai-summary",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature("kitchen_display"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const fromStr = req.query["from"] ? String(req.query["from"]) : null;
    const toStr = req.query["to"] ? String(req.query["to"]) : null;
    const cacheKey = `${fromStr ?? ""}|${toStr ?? ""}`;
    const now = Date.now();
    const existing = aiSummaryCache.get(restaurantId);
    if (existing && existing.key === cacheKey && existing.expiresAt > now) {
      return void res.json({ ...existing.payload, cached: true });
    }

    // Reuse the perf endpoint's data by calling the aggregation logic inline.
    // Simpler: refetch a minimal payload here.
    const to = toStr ? new Date(toStr) : new Date();
    const from = fromStr ? new Date(fromStr) : new Date(to.getTime() - 7 * 86_400_000);
    const tickets = await db.select({
      id: kitchenTicketsTable.id,
      kitchenId: kitchenTicketsTable.kitchenId,
      createdAt: kitchenTicketsTable.createdAt,
      completedAt: kitchenTicketsTable.completedAt,
      startedAt: kitchenTicketsTable.startedAt,
      delayAlertCount: kitchenTicketsTable.delayAlertCount,
    }).from(kitchenTicketsTable).where(and(
      eq(kitchenTicketsTable.restaurantId, restaurantId),
      gte(kitchenTicketsTable.createdAt, from),
      lte(kitchenTicketsTable.createdAt, to),
    ));
    const totalDelayed = tickets.filter(t => (t.delayAlertCount ?? 0) > 0).length;
    const cfg = await loadKitchenDelayConfig(restaurantId);

    const stats = {
      windowDays: Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000)),
      ticketsTotal: tickets.length,
      ticketsDelayed: totalDelayed,
      delayedPct: tickets.length > 0 ? (totalDelayed / tickets.length) * 100 : 0,
      thresholdMinutes: cfg.thresholdMinutes,
    };

    let summary = `Over the last ${stats.windowDays} day(s) the kitchen processed ${stats.ticketsTotal} tickets. ${stats.ticketsDelayed} were flagged as delayed (${stats.delayedPct.toFixed(1)}%) past the ${stats.thresholdMinutes} min threshold.`;
    let insights: string[] = [];
    if (stats.ticketsTotal === 0) {
      insights = ["No kitchen activity in this window."];
    } else if (stats.ticketsDelayed === 0) {
      insights = ["No delays detected — kitchen is operating within target."];
    } else {
      insights = [
        `${stats.ticketsDelayed} of ${stats.ticketsTotal} tickets exceeded the ${stats.thresholdMinutes}-minute threshold.`,
        stats.delayedPct > 20 ? "High delay rate — consider reviewing station load or staffing during peak hours." : "Delay rate is within an acceptable range.",
      ];
    }

    // Try to enrich with AI if a provider is configured. Fall back silently otherwise.
    try {
      const ai = await AIProviderService.generateText(
        { featureSlug: "kitchen_performance_summary", restaurantId },
        {
          systemPrompt: "You are an operations analyst. Produce a concise, plain-English summary of kitchen performance and 3 short, actionable insights. Output JSON: {\"summary\":string,\"insights\":string[]}.",
          messages: [{ role: "user", content: `Stats: ${JSON.stringify(stats)}` }],
          temperature: 0.4,
          maxTokens: 400,
          jsonMode: true,
        },
      );
      try {
        const parsed = JSON.parse(ai.text) as { summary?: unknown; insights?: unknown };
        if (typeof parsed.summary === "string" && parsed.summary.trim()) summary = parsed.summary.trim();
        if (Array.isArray(parsed.insights)) {
          const arr = parsed.insights.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 6);
          if (arr.length > 0) insights = arr;
        }
      } catch { /* keep heuristic fallback */ }
    } catch { /* AI not configured or failed — silently use heuristic */ }

    const payload = { summary, insights, generatedAt: new Date().toISOString(), cached: false };
    aiSummaryCache.set(restaurantId, { key: cacheKey, expiresAt: now + AI_SUMMARY_TTL_MS, payload });
    res.json(payload);
  },
);

export default router;
