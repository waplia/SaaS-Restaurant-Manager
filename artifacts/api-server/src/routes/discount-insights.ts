import { Router } from "express";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, ordersTable, orderDiscountsTable, customersTable, usersTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

router.use(
  "/restaurants/:restaurantId/reports/discount-insights",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);

type Period = "today" | "7d" | "30d" | "custom";
function periodWindow(period: Period, from?: string, to?: string): { start: Date; end: Date } {
  const end = period === "custom" && to ? new Date(to) : new Date();
  if (period === "custom" && from) return { start: new Date(from), end };
  const days = period === "today" ? 1 : period === "7d" ? 7 : 30;
  const start = new Date(end.getTime() - days * 86_400_000);
  return { start, end };
}

// Discount insights — ROI / breakdown report. Per-restaurant only.
// Query params:
//   period   = today | 7d | 30d | custom (default 7d)
//   from,to  = ISO timestamps when period=custom
//   groupBy  = type | reason | staff | customer | day  (default 'type')
//   format   = json | csv  (default json)
router.get("/restaurants/:restaurantId/reports/discount-insights", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const period = (String(req.query.period ?? "7d") as Period);
  const groupBy = String(req.query.groupBy ?? "type");
  const format = String(req.query.format ?? "json");
  const { start, end } = periodWindow(period, req.query.from as string, req.query.to as string);

  const baseWhere = and(
    eq(orderDiscountsTable.restaurantId, restaurantId),
    gte(orderDiscountsTable.createdAt, start),
    lte(orderDiscountsTable.createdAt, end),
  );

  // Headline KPIs (always returned).
  const [kpi] = await db
    .select({
      discountCount: sql<number>`count(*)::int`,
      totalDiscount: sql<number>`coalesce(sum(${orderDiscountsTable.amount}), 0)::float`,
      ordersCount: sql<number>`count(distinct ${orderDiscountsTable.orderId})::int`,
      grossRevenue: sql<number>`coalesce(sum(distinct ${ordersTable.subtotal}), 0)::float`,
      netRevenue: sql<number>`coalesce(sum(distinct ${ordersTable.totalAmount}), 0)::float`,
    })
    .from(orderDiscountsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, orderDiscountsTable.orderId))
    .where(baseWhere);

  // ROI heuristic: revenue captured per ₹1 of discount given.
  const roi = kpi && kpi.totalDiscount > 0 ? (kpi.netRevenue / kpi.totalDiscount) : null;

  type Row = {
    key: string;
    label: string;
    discountCount: number;
    totalDiscount: number;
    ordersCount: number;
    grossRevenue: number;
    netRevenue: number;
    roi: number | null;
  };

  let rows: Row[] = [];

  if (groupBy === "type") {
    const r = await db
      .select({
        key: orderDiscountsTable.type,
        discountCount: sql<number>`count(*)::int`,
        totalDiscount: sql<number>`coalesce(sum(${orderDiscountsTable.amount}), 0)::float`,
        ordersCount: sql<number>`count(distinct ${orderDiscountsTable.orderId})::int`,
        grossRevenue: sql<number>`coalesce(sum(distinct ${ordersTable.subtotal}), 0)::float`,
        netRevenue: sql<number>`coalesce(sum(distinct ${ordersTable.totalAmount}), 0)::float`,
      })
      .from(orderDiscountsTable)
      .innerJoin(ordersTable, eq(ordersTable.id, orderDiscountsTable.orderId))
      .where(baseWhere)
      .groupBy(orderDiscountsTable.type);
    rows = r.map(x => ({
      key: x.key,
      label: x.key,
      discountCount: x.discountCount,
      totalDiscount: x.totalDiscount,
      ordersCount: x.ordersCount,
      grossRevenue: x.grossRevenue,
      netRevenue: x.netRevenue,
      roi: x.totalDiscount > 0 ? x.netRevenue / x.totalDiscount : null,
    }));
  } else if (groupBy === "reason") {
    const r = await db
      .select({
        key: orderDiscountsTable.reason,
        discountCount: sql<number>`count(*)::int`,
        totalDiscount: sql<number>`coalesce(sum(${orderDiscountsTable.amount}), 0)::float`,
        ordersCount: sql<number>`count(distinct ${orderDiscountsTable.orderId})::int`,
        grossRevenue: sql<number>`coalesce(sum(distinct ${ordersTable.subtotal}), 0)::float`,
        netRevenue: sql<number>`coalesce(sum(distinct ${ordersTable.totalAmount}), 0)::float`,
      })
      .from(orderDiscountsTable)
      .innerJoin(ordersTable, eq(ordersTable.id, orderDiscountsTable.orderId))
      .where(baseWhere)
      .groupBy(orderDiscountsTable.reason);
    rows = r.map(x => ({
      key: x.key,
      label: x.key,
      discountCount: x.discountCount,
      totalDiscount: x.totalDiscount,
      ordersCount: x.ordersCount,
      grossRevenue: x.grossRevenue,
      netRevenue: x.netRevenue,
      roi: x.totalDiscount > 0 ? x.netRevenue / x.totalDiscount : null,
    }));
  } else if (groupBy === "staff") {
    const r = await db
      .select({
        key: orderDiscountsTable.recordedByUserId,
        userName: usersTable.name,
        userRole: usersTable.role,
        discountCount: sql<number>`count(*)::int`,
        totalDiscount: sql<number>`coalesce(sum(${orderDiscountsTable.amount}), 0)::float`,
        ordersCount: sql<number>`count(distinct ${orderDiscountsTable.orderId})::int`,
        grossRevenue: sql<number>`coalesce(sum(distinct ${ordersTable.subtotal}), 0)::float`,
        netRevenue: sql<number>`coalesce(sum(distinct ${ordersTable.totalAmount}), 0)::float`,
      })
      .from(orderDiscountsTable)
      .innerJoin(ordersTable, eq(ordersTable.id, orderDiscountsTable.orderId))
      .leftJoin(usersTable, eq(usersTable.id, orderDiscountsTable.recordedByUserId))
      .where(baseWhere)
      .groupBy(orderDiscountsTable.recordedByUserId, usersTable.name, usersTable.role);
    rows = r.map(x => ({
      key: String(x.key ?? "system"),
      label: x.userName ? `${x.userName}${x.userRole ? ` (${x.userRole})` : ""}` : "System / unattributed",
      discountCount: x.discountCount,
      totalDiscount: x.totalDiscount,
      ordersCount: x.ordersCount,
      grossRevenue: x.grossRevenue,
      netRevenue: x.netRevenue,
      roi: x.totalDiscount > 0 ? x.netRevenue / x.totalDiscount : null,
    }));
  } else if (groupBy === "customer") {
    const r = await db
      .select({
        key: ordersTable.customerId,
        phone: ordersTable.customerPhone,
        customerName: customersTable.name,
        discountCount: sql<number>`count(*)::int`,
        totalDiscount: sql<number>`coalesce(sum(${orderDiscountsTable.amount}), 0)::float`,
        ordersCount: sql<number>`count(distinct ${orderDiscountsTable.orderId})::int`,
        grossRevenue: sql<number>`coalesce(sum(distinct ${ordersTable.subtotal}), 0)::float`,
        netRevenue: sql<number>`coalesce(sum(distinct ${ordersTable.totalAmount}), 0)::float`,
      })
      .from(orderDiscountsTable)
      .innerJoin(ordersTable, eq(ordersTable.id, orderDiscountsTable.orderId))
      .leftJoin(customersTable, eq(customersTable.id, ordersTable.customerId))
      .where(baseWhere)
      .groupBy(ordersTable.customerId, ordersTable.customerPhone, customersTable.name);
    rows = r.map(x => ({
      key: String(x.key ?? x.phone ?? "anonymous"),
      label: x.customerName ?? x.phone ?? "Walk-in / anonymous",
      discountCount: x.discountCount,
      totalDiscount: x.totalDiscount,
      ordersCount: x.ordersCount,
      grossRevenue: x.grossRevenue,
      netRevenue: x.netRevenue,
      roi: x.totalDiscount > 0 ? x.netRevenue / x.totalDiscount : null,
    }));
  } else if (groupBy === "day") {
    const r = await db
      .select({
        key: sql<string>`to_char(${orderDiscountsTable.createdAt}, 'YYYY-MM-DD')`,
        discountCount: sql<number>`count(*)::int`,
        totalDiscount: sql<number>`coalesce(sum(${orderDiscountsTable.amount}), 0)::float`,
        ordersCount: sql<number>`count(distinct ${orderDiscountsTable.orderId})::int`,
        grossRevenue: sql<number>`coalesce(sum(distinct ${ordersTable.subtotal}), 0)::float`,
        netRevenue: sql<number>`coalesce(sum(distinct ${ordersTable.totalAmount}), 0)::float`,
      })
      .from(orderDiscountsTable)
      .innerJoin(ordersTable, eq(ordersTable.id, orderDiscountsTable.orderId))
      .where(baseWhere)
      .groupBy(sql`to_char(${orderDiscountsTable.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${orderDiscountsTable.createdAt}, 'YYYY-MM-DD')`);
    rows = r.map(x => ({
      key: x.key,
      label: x.key,
      discountCount: x.discountCount,
      totalDiscount: x.totalDiscount,
      ordersCount: x.ordersCount,
      grossRevenue: x.grossRevenue,
      netRevenue: x.netRevenue,
      roi: x.totalDiscount > 0 ? x.netRevenue / x.totalDiscount : null,
    }));
  } else {
    return void res.status(400).json({ error: "groupBy must be type|reason|staff|customer|day" });
  }

  rows.sort((a, b) => b.totalDiscount - a.totalDiscount);

  if (format === "csv") {
    const header = ["group", "label", "discounts", "total_discount", "orders", "gross_revenue", "net_revenue", "roi"];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push([groupBy, r.label, r.discountCount, r.totalDiscount.toFixed(2), r.ordersCount, r.grossRevenue.toFixed(2), r.netRevenue.toFixed(2), r.roi?.toFixed(2) ?? ""].map(esc).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="discount-insights-${period}-${groupBy}.csv"`);
    return void res.send(lines.join("\n"));
  }

  res.json({
    period,
    from: start.toISOString(),
    to: end.toISOString(),
    groupBy,
    kpis: {
      discountCount: kpi?.discountCount ?? 0,
      totalDiscount: kpi?.totalDiscount ?? 0,
      ordersCount: kpi?.ordersCount ?? 0,
      grossRevenue: kpi?.grossRevenue ?? 0,
      netRevenue: kpi?.netRevenue ?? 0,
      roi,
    },
    rows,
  });
});

export default router;
