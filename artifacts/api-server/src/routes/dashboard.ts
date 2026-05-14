import { Router } from "express";
import { eq, and, gte, lte, desc, count, sql } from "drizzle-orm";
import { db, ordersTable, floorTablesTable, kitchenTicketsTable, inventoryItemsTable, notificationsTable, menuItemsTable, orderItemsTable, auditLogsTable, usersTable, attendanceTable, expensesTable, expenseCategoriesTable, orderDiscountsTable } from "../lib/db";
import { generateDueRecurringExpenses } from "./expenses";
import { requireRole } from "../middleware/authorize";
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

  const [
    todayOrdersRows,
    allTables,
    pendingTickets,
    lowStockItems,
    unreadNotifs,
    yesterdayOrders,
    monthExpensesRow,
  ] = await Promise.all([
    db.select().from(ordersTable).where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, today))),
    db.select().from(floorTablesTable).where(and(eq(floorTablesTable.restaurantId, restaurantId), eq(floorTablesTable.isActive, true))),
    db.select({ count: count() }).from(kitchenTicketsTable).where(and(eq(kitchenTicketsTable.restaurantId, restaurantId), sql`status IN ('new','preparing')`)),
    db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.restaurantId, restaurantId)),
    db.select({ count: count() }).from(notificationsTable).where(and(eq(notificationsTable.restaurantId, restaurantId), eq(notificationsTable.isRead, false))),
    db.select().from(ordersTable).where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, new Date(today.getTime() - 86400000)), sql`created_at < ${today}`)),
    db.select({ sum: sql<string>`coalesce(sum(${expensesTable.amount}), 0)::text` }).from(expensesTable).where(and(eq(expensesTable.restaurantId, restaurantId), gte(expensesTable.expenseDate, monthStartStr))),
  ]);

  const todayRevenue = todayOrdersRows.reduce((s, o) => s + Number(o.totalAmount), 0);
  const yesterdayRevenue = yesterdayOrders.reduce((s, o) => s + Number(o.totalAmount), 0);
  const revenueGrowth = yesterdayRevenue === 0 ? "100" : (((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100).toFixed(1);
  const ordersGrowth = yesterdayOrders.length === 0 ? "100" : (((todayOrdersRows.length - yesterdayOrders.length) / yesterdayOrders.length) * 100).toFixed(1);
  const activeTables = allTables.filter(t => t.status === "occupied").length;
  const lowStockAlerts = lowStockItems.filter(i => Number(i.currentStock) <= Number(i.minStockLevel)).length;
  const avgOrderValue = todayOrdersRows.length ? (todayRevenue / todayOrdersRows.length).toFixed(2) : "0.00";

  res.json({
    todayRevenue: todayRevenue.toFixed(2),
    todayOrders: todayOrdersRows.length,
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
  const orders = await db.select().from(ordersTable).where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, from)));

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

router.get("/restaurants/:restaurantId/dashboard/live-kitchen", async (req, res) => {
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

router.get("/restaurants/:restaurantId/dashboard/reports", async (req, res) => {
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

  // Discount aggregation (T6) — joins ledger rows recorded inside the analytics
  // window to the recording cashier; rows with no cashier (legacy) collapse to
  // a "System" bucket. Grouped by cashier + reason + type so the report can
  // surface comp/manager-override patterns by staff member.
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
    ORDER BY total DESC
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

  res.json({
    paymentsByMethod,
    discountsByCashier,
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

export default router;
