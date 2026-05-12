import { Router } from "express";
import { eq, and, gte, desc, count, sql } from "drizzle-orm";
import { db, ordersTable, floorTablesTable, kitchenTicketsTable, inventoryItemsTable, notificationsTable, menuItemsTable, orderItemsTable, auditLogsTable, usersTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

router.use("/restaurants/:restaurantId", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), validateRestaurantAccess);

router.get("/restaurants/:restaurantId/dashboard/summary", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    todayOrdersRows,
    allTables,
    pendingTickets,
    lowStockItems,
    unreadNotifs,
    yesterdayOrders,
  ] = await Promise.all([
    db.select().from(ordersTable).where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, today))),
    db.select().from(floorTablesTable).where(and(eq(floorTablesTable.restaurantId, restaurantId), eq(floorTablesTable.isActive, true))),
    db.select({ count: count() }).from(kitchenTicketsTable).where(and(eq(kitchenTicketsTable.restaurantId, restaurantId), sql`status IN ('new','preparing')`)),
    db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.restaurantId, restaurantId)),
    db.select({ count: count() }).from(notificationsTable).where(and(eq(notificationsTable.restaurantId, restaurantId), eq(notificationsTable.isRead, false))),
    db.select().from(ordersTable).where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, new Date(today.getTime() - 86400000)), sql`created_at < ${today}`)),
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
  });
});

router.get("/restaurants/:restaurantId/dashboard/revenue-trend", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const period = String(req.query.period ?? "7d");
  const days = period === "30d" ? 30 : period === "90d" ? 90 : 7;
  const from = new Date();
  from.setDate(from.getDate() - days);
  from.setHours(0, 0, 0, 0);

  const orders = await db.select().from(ordersTable).where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, from)));

  const byDay: Record<string, { revenue: number; orders: number }> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().split("T")[0];
    byDay[key] = { revenue: 0, orders: 0 };
  }
  for (const o of orders) {
    const key = o.createdAt.toISOString().split("T")[0];
    if (byDay[key]) { byDay[key].revenue += Number(o.totalAmount); byDay[key].orders++; }
  }

  res.json(Object.entries(byDay).map(([date, v]) => ({ date, revenue: v.revenue.toFixed(2), orders: v.orders })));
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
    .innerJoin(ordersTable, and(eq(orderItemsTable.orderId, ordersTable.id), eq(ordersTable.restaurantId, restaurantId)))
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
  } else {
    const days = String(period) === "30d" ? 30 : String(period) === "90d" ? 90 : 7;
    from.setDate(from.getDate() - days);
  }
  from.setHours(0, 0, 0, 0);

  const orders = await db.select().from(ordersTable).where(and(eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, from)));
  const totalRevenue = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
  const totalTax = orders.reduce((s, o) => s + Number(o.taxAmount), 0);
  const avgOrderValue = orders.length ? totalRevenue / orders.length : 0;

  const byDay: Record<string, { revenue: number; orders: number }> = {};
  for (const o of orders) {
    const key = o.createdAt.toISOString().split("T")[0];
    if (!byDay[key]) byDay[key] = { revenue: 0, orders: 0 };
    byDay[key].revenue += Number(o.totalAmount);
    byDay[key].orders++;
  }

  const topItemsRows = await db.select({
    menuItemId: orderItemsTable.menuItemId,
    name: orderItemsTable.menuItemName,
    orderCount: sql<number>`cast(count(*) as int)`,
    revenue: sql<string>`cast(sum(${orderItemsTable.totalPrice}) as text)`,
  }).from(orderItemsTable).innerJoin(ordersTable, and(eq(orderItemsTable.orderId, ordersTable.id), eq(ordersTable.restaurantId, restaurantId), gte(ordersTable.createdAt, from))).groupBy(orderItemsTable.menuItemId, orderItemsTable.menuItemName).orderBy(desc(sql`count(*)`)).limit(10);

  res.json({
    totalRevenue: totalRevenue.toFixed(2),
    totalOrders: orders.length,
    totalTax: totalTax.toFixed(2),
    avgOrderValue: avgOrderValue.toFixed(2),
    revenueByDay: Object.entries(byDay).map(([date, v]) => ({ date, revenue: v.revenue.toFixed(2), orders: v.orders })),
    topItems: topItemsRows.map(r => ({ ...r, imageUrl: null, categoryName: null })),
  });
});

export default router;
