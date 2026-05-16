/**
 * Khana AI — AI Sales Insights.
 *
 * Aggregates sales/menu/customer signals, asks the model to generate a small
 * batch of focused insights across categories (sales trends, best-sellers,
 * low-margin items, declining sales, peak times, weak weekdays, suggested
 * offers, inventory risk, high-cancellation items, retention), persists them
 * and exposes Active / Saved tabs + Save / Dismiss endpoints.
 *
 * Gated by:
 *   - requireRole("owner","manager","super_admin")
 *   - validateRestaurantAccess
 *   - requirePlanFeature("khana_ai_insights_enabled")
 *   - requireAiCredits("ai_sales_insights") — but only if today's free
 *     allowance from the plan has already been used (super-admins bypass).
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { eq, and, desc, gte, lte, sql, inArray } from "drizzle-orm";
import {
  db,
  ordersTable,
  orderItemsTable,
  menuItemsTable,
  menuCategoriesTable,
  inventoryItemsTable,
  recipeMappingsTable,
  customersTable,
  tenantsTable,
  subscriptionPlansTable,
  aiSalesInsightsTable,
  aiInsightDailyAllowanceTable,
  isFeatureEnabled,
  getFeatureNumber,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { AIProviderService } from "../lib/aiProviderService";
import {
  requireAiCredits,
  commitReservation,
  refundReservation,
  type AiCreditReservation,
} from "../lib/aiCredits";
import { recordAuditLog } from "../lib/audit";

const router = Router();

const FEATURE_SLUG = "ai_sales_insights";
const COOLDOWN_DAYS = 7;
const INSIGHT_TTL_DAYS = 14;

const ALLOWED_CATEGORIES = [
  "sales_trend",
  "best_seller",
  "low_margin",
  "declining_sales",
  "peak_time",
  "weak_weekday",
  "suggested_offer",
  "inventory_risk",
  "high_cancellation",
  "retention",
] as const;
type InsightCategory = (typeof ALLOWED_CATEGORIES)[number];

const ALLOWED_IMPACT = ["low", "medium", "high"] as const;
type Impact = (typeof ALLOWED_IMPACT)[number];

const ALLOWED_TARGET_MODULE = [
  "menu", "inventory", "discounts", "reports", "customers", "orders", null,
] as const;

// Gate everything on the broader Khana AI plan flag AND the insights-specific
// flag — the insights feature is only meaningful when the AI module is on.
router.use(
  "/restaurants/:restaurantId/ai-insights/:rest",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("khana_ai_enabled"),
  requirePlanFeature("khana_ai_insights_enabled"),
);

// ─── Free-allowance helpers ──────────────────────────────────────────────────

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadFreeAllowance(opts: { tenantId: number | null; restaurantId: number; planId: number | null; }) {
  const { tenantId, restaurantId, planId } = opts;
  if (!tenantId) return { dailyLimit: 0, used: 0, remaining: 0 };
  let dailyLimit = 0;
  if (planId) {
    const [plan] = await db
      .select({ featureFlags: subscriptionPlansTable.featureFlags })
      .from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.id, planId));
    dailyLimit = Math.max(0, getFeatureNumber(plan?.featureFlags ?? null, "khana_ai_insights_free_daily"));
  }
  const day = todayUtc();
  const [row] = await db.select().from(aiInsightDailyAllowanceTable).where(and(
    eq(aiInsightDailyAllowanceTable.tenantId, tenantId),
    eq(aiInsightDailyAllowanceTable.restaurantId, restaurantId),
    eq(aiInsightDailyAllowanceTable.day, day),
  ));
  const used = row?.used ?? 0;
  return { dailyLimit, used, remaining: Math.max(0, dailyLimit - used) };
}

/**
 * Atomically reserve one slot of today's free allowance. Returns true if
 * a free slot was claimed (no credits should be charged), false if the
 * caller must fall back to credits.
 */
async function tryClaimFreeSlot(opts: { tenantId: number; restaurantId: number; dailyLimit: number; }): Promise<boolean> {
  if (opts.dailyLimit <= 0) return false;
  const day = todayUtc();
  // Insert-or-update with a guard so we never exceed dailyLimit.
  const result = await db.execute(sql`
    INSERT INTO ai_insight_daily_allowance (tenant_id, restaurant_id, day, used, updated_at)
    VALUES (${opts.tenantId}, ${opts.restaurantId}, ${day}, 1, NOW())
    ON CONFLICT (tenant_id, restaurant_id, day) DO UPDATE
      SET used = ai_insight_daily_allowance.used + 1,
          updated_at = NOW()
      WHERE ai_insight_daily_allowance.used < ${opts.dailyLimit}
    RETURNING used
  `);
  // pg returns rows on rowCount when conditional update matches OR insert succeeds.
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

async function refundFreeSlot(opts: { tenantId: number; restaurantId: number; }) {
  const day = todayUtc();
  await db.execute(sql`
    UPDATE ai_insight_daily_allowance
    SET used = GREATEST(0, used - 1), updated_at = NOW()
    WHERE tenant_id = ${opts.tenantId}
      AND restaurant_id = ${opts.restaurantId}
      AND day = ${day}
  `);
}

// ─── Read endpoints ──────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/ai-insights/list", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const status = String(req.query.status ?? "active");
  if (!["active", "saved", "dismissed"].includes(status)) {
    return void res.status(400).json({ error: "Invalid status" });
  }
  const conditions = [
    eq(aiSalesInsightsTable.restaurantId, restaurantId),
    eq(aiSalesInsightsTable.status, status),
  ];
  if (status === "active") {
    // Hide expired insights from the active feed.
    conditions.push(sql`(${aiSalesInsightsTable.expiresAt} IS NULL OR ${aiSalesInsightsTable.expiresAt} > NOW())`);
  }
  // Optional category filter — comma-separated whitelist.
  const catParam = typeof req.query.category === "string" ? req.query.category.trim() : "";
  if (catParam) {
    const cats = catParam.split(",").map((c) => c.trim()).filter((c) => (ALLOWED_CATEGORIES as readonly string[]).includes(c));
    if (cats.length > 0) conditions.push(inArray(aiSalesInsightsTable.category, cats));
  }
  // Optional impact filter — comma-separated whitelist.
  const impParam = typeof req.query.impact === "string" ? req.query.impact.trim() : "";
  if (impParam) {
    const imps = impParam.split(",").map((c) => c.trim()).filter((c) => (ALLOWED_IMPACT as readonly string[]).includes(c));
    if (imps.length > 0) conditions.push(inArray(aiSalesInsightsTable.impact, imps));
  }
  const rows = await db.select().from(aiSalesInsightsTable)
    .where(and(...conditions))
    .orderBy(desc(aiSalesInsightsTable.generatedAt))
    .limit(100);
  res.json({ data: rows });
});

router.get("/restaurants/:restaurantId/ai-insights/allowance", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const tenantId = req.user?.tenantId ?? null;
  let planId: number | null = null;
  if (tenantId) {
    const [t] = await db.select({ planId: tenantsTable.planId })
      .from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    planId = t?.planId ?? null;
  }
  const a = await loadFreeAllowance({ tenantId, restaurantId, planId });
  res.json({ ...a, isSuperAdmin: !!req.user?.isSuperAdmin });
});

router.patch("/restaurants/:restaurantId/ai-insights/:id", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { status, notes } = (req.body ?? {}) as { status?: string; notes?: string };
  if (status && !["active", "saved", "dismissed"].includes(status)) {
    return void res.status(400).json({ error: "Invalid status" });
  }
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (status) update.status = status;
  if (notes != null) update.notes = String(notes).slice(0, 1000);
  const [row] = await db.update(aiSalesInsightsTable).set(update)
    .where(and(eq(aiSalesInsightsTable.id, id), eq(aiSalesInsightsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({
    req, module: "khana_ai", action: `insight.${status ?? "update"}`,
    entity: "ai_sales_insight", entityId: row.id, newValue: { status, notes },
  });
  res.json({ insight: row });
});

// ─── Generate endpoint ───────────────────────────────────────────────────────

interface RawInsight {
  category?: unknown;
  title?: unknown;
  explanation?: unknown;
  suggestedAction?: unknown;
  impact?: unknown;
  targetModule?: unknown;
  targetId?: unknown;
}

interface CleanInsight {
  category: InsightCategory;
  title: string;
  explanation: string;
  suggestedAction: string | null;
  impact: Impact;
  targetModule: string | null;
  targetId: number | null;
  targetUrl: string | null;
  supportingMetrics: Record<string, unknown>;
}

/**
 * Free-allowance gate. Wraps `requireAiCredits` so:
 *   1. Super-admins bypass everything.
 *   2. If today's plan-defined free quota has remaining slots, claim one
 *      atomically and skip the credit reservation entirely.
 *   3. Otherwise, fall through to `requireAiCredits` to reserve credits
 *      against the wallet.
 *
 * The downstream handler reads `res.locals.aiInsightFreeClaimed` to know
 * whether to refund the free slot on failure.
 */
function freeAllowanceOrCredits(featureSlug: string) {
  const credits = requireAiCredits(featureSlug, () => ({ units: 1 }));
  return async function gate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.user?.isSuperAdmin) {
        res.locals.aiCreditReservation = null;
        res.locals.aiInsightFreeClaimed = false;
        return next();
      }
      const tenantId = req.user?.tenantId;
      const restaurantId = Number(req.params.restaurantId);
      if (!tenantId) {
        res.status(403).json({ error: "AI requires a tenant context" });
        return;
      }
      const [tenant] = await db.select({ planId: tenantsTable.planId })
        .from(tenantsTable).where(eq(tenantsTable.id, tenantId));
      const allowance = await loadFreeAllowance({
        tenantId, restaurantId, planId: tenant?.planId ?? null,
      });
      if (allowance.dailyLimit > 0 && allowance.remaining > 0) {
        const claimed = await tryClaimFreeSlot({
          tenantId, restaurantId, dailyLimit: allowance.dailyLimit,
        });
        if (claimed) {
          res.locals.aiCreditReservation = null;
          res.locals.aiInsightFreeClaimed = true;
          return next();
        }
      }
      // Fall through to standard credits gate.
      res.locals.aiInsightFreeClaimed = false;
      return credits(req, res, next);
    } catch (err) {
      req.log.error({ err }, "[ai-insights] allowance gate failed");
      res.status(500).json({ error: "Allowance check failed" });
    }
  };
}

router.post(
  "/restaurants/:restaurantId/ai-insights/generate",
  freeAllowanceOrCredits(FEATURE_SLUG),
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const reservation = res.locals.aiCreditReservation as AiCreditReservation | null;
    const freeClaimed = res.locals.aiInsightFreeClaimed === true;
    const tenantId = req.user?.tenantId ?? null;

    const cleanup = async (reason: string) => {
      if (reservation) await refundReservation(reservation, reason);
      if (freeClaimed && tenantId) await refundFreeSlot({ tenantId, restaurantId });
    };

    try {
      const since30 = new Date(Date.now() - 30 * 86_400_000);
      const since60 = new Date(Date.now() - 60 * 86_400_000);
      const cooldownSince = new Date(Date.now() - COOLDOWN_DAYS * 86_400_000);

      // Recently dismissed categories — skip them this run to avoid spam.
      const recentlyDismissed = await db.select({ category: aiSalesInsightsTable.category })
        .from(aiSalesInsightsTable)
        .where(and(
          eq(aiSalesInsightsTable.restaurantId, restaurantId),
          eq(aiSalesInsightsTable.status, "dismissed"),
          gte(aiSalesInsightsTable.updatedAt, cooldownSince),
        ));
      const skipCategories = new Set(recentlyDismissed.map((r) => r.category));

      // Aggregate signals in parallel.
      const [
        salesByDay, salesByDow, salesByHour, salesByItem, salesByItem60,
        cancellations, menu, recipeRows, lowStock, customerStats,
      ] = await Promise.all([
        // Daily totals — last 30 days.
        db.select({
          day: sql<string>`to_char(${ordersTable.createdAt}, 'YYYY-MM-DD')`,
          revenue: sql<string>`coalesce(sum(${ordersTable.totalAmount}), 0)`,
          orders: sql<string>`count(distinct ${ordersTable.id})`,
        })
          .from(ordersTable)
          .where(and(
            eq(ordersTable.restaurantId, restaurantId),
            gte(ordersTable.createdAt, since30),
            inArray(ordersTable.status, ["completed", "served", "delivered", "ready"]),
          ))
          .groupBy(sql`to_char(${ordersTable.createdAt}, 'YYYY-MM-DD')`)
          .orderBy(sql`to_char(${ordersTable.createdAt}, 'YYYY-MM-DD')`),
        // Day-of-week totals — last 60 days.
        db.select({
          dow: sql<string>`extract(dow from ${ordersTable.createdAt})::int`,
          revenue: sql<string>`coalesce(sum(${ordersTable.totalAmount}), 0)`,
          orders: sql<string>`count(distinct ${ordersTable.id})`,
        })
          .from(ordersTable)
          .where(and(
            eq(ordersTable.restaurantId, restaurantId),
            gte(ordersTable.createdAt, since60),
            inArray(ordersTable.status, ["completed", "served", "delivered", "ready"]),
          ))
          .groupBy(sql`extract(dow from ${ordersTable.createdAt})`),
        // Hour-of-day — last 30 days.
        db.select({
          hour: sql<string>`extract(hour from ${ordersTable.createdAt})::int`,
          orders: sql<string>`count(distinct ${ordersTable.id})`,
        })
          .from(ordersTable)
          .where(and(
            eq(ordersTable.restaurantId, restaurantId),
            gte(ordersTable.createdAt, since30),
            inArray(ordersTable.status, ["completed", "served", "delivered", "ready"]),
          ))
          .groupBy(sql`extract(hour from ${ordersTable.createdAt})`),
        // Sales by item — last 30 days.
        db.select({
          menuItemId: orderItemsTable.menuItemId,
          qty: sql<string>`coalesce(sum(${orderItemsTable.quantity}), 0)`,
          revenue: sql<string>`coalesce(sum(${orderItemsTable.totalPrice}), 0)`,
        })
          .from(orderItemsTable)
          .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
          .where(and(
            eq(ordersTable.restaurantId, restaurantId),
            gte(ordersTable.createdAt, since30),
            inArray(ordersTable.status, ["completed", "served", "delivered", "ready"]),
          ))
          .groupBy(orderItemsTable.menuItemId),
        // Sales by item — 30-60 days ago window (for trend comparison).
        db.select({
          menuItemId: orderItemsTable.menuItemId,
          qty: sql<string>`coalesce(sum(${orderItemsTable.quantity}), 0)`,
          revenue: sql<string>`coalesce(sum(${orderItemsTable.totalPrice}), 0)`,
        })
          .from(orderItemsTable)
          .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
          .where(and(
            eq(ordersTable.restaurantId, restaurantId),
            gte(ordersTable.createdAt, since60),
            lte(ordersTable.createdAt, since30),
            inArray(ordersTable.status, ["completed", "served", "delivered", "ready"]),
          ))
          .groupBy(orderItemsTable.menuItemId),
        // Cancelled order counts by item — last 30 days.
        db.select({
          menuItemId: orderItemsTable.menuItemId,
          qty: sql<string>`coalesce(sum(${orderItemsTable.quantity}), 0)`,
        })
          .from(orderItemsTable)
          .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
          .where(and(
            eq(ordersTable.restaurantId, restaurantId),
            gte(ordersTable.createdAt, since30),
            eq(ordersTable.status, "cancelled"),
          ))
          .groupBy(orderItemsTable.menuItemId),
        // Menu items with category for COGS / margin calc.
        db.select({
          id: menuItemsTable.id,
          name: menuItemsTable.name,
          price: menuItemsTable.price,
          categoryName: menuCategoriesTable.name,
        })
          .from(menuItemsTable)
          .leftJoin(menuCategoriesTable, eq(menuItemsTable.categoryId, menuCategoriesTable.id))
          .where(eq(menuItemsTable.restaurantId, restaurantId)),
        // Recipe → ingredient cost rollup per menu item.
        db.select({
          menuItemId: recipeMappingsTable.menuItemId,
          quantity: recipeMappingsTable.quantity,
          costPerUnit: inventoryItemsTable.costPerUnit,
        })
          .from(recipeMappingsTable)
          .innerJoin(inventoryItemsTable, eq(inventoryItemsTable.id, recipeMappingsTable.inventoryItemId))
          .where(eq(recipeMappingsTable.restaurantId, restaurantId)),
        // Low / out-of-stock ingredient count.
        db.select({
          id: inventoryItemsTable.id, name: inventoryItemsTable.name,
          currentStock: inventoryItemsTable.currentStock,
          minStockLevel: inventoryItemsTable.minStockLevel,
          unit: inventoryItemsTable.unit,
        })
          .from(inventoryItemsTable)
          .where(and(
            eq(inventoryItemsTable.restaurantId, restaurantId),
            eq(inventoryItemsTable.isActive, true),
            sql`${inventoryItemsTable.currentStock} <= ${inventoryItemsTable.minStockLevel}`,
          ))
          .limit(50),
        // Customer aggregates — repeat vs one-time over 60 days.
        db.select({
          totalCustomers: sql<string>`count(*)::int`,
          repeatCustomers: sql<string>`sum(case when ${customersTable.totalOrders} >= 2 then 1 else 0 end)::int`,
        })
          .from(customersTable)
          .where(eq(customersTable.restaurantId, restaurantId)),
      ]);

      const totalOrders30 = salesByDay.reduce((s, d) => s + Number(d.orders), 0);
      const totalRevenue30 = salesByDay.reduce((s, d) => s + Number(d.revenue), 0);
      if (totalOrders30 < 5) {
        await cleanup("not enough sales history");
        return void res.status(400).json({
          error: "Need at least 5 completed orders in the last 30 days to generate insights.",
        });
      }

      const cogsByItem = new Map<number, number>();
      for (const r of recipeRows) {
        const k = r.menuItemId;
        cogsByItem.set(k, (cogsByItem.get(k) ?? 0) + Number(r.quantity) * Number(r.costPerUnit));
      }
      const itemById = new Map(menu.map((m) => [m.id, m]));
      const sales30ById = new Map(salesByItem.map((s) => [s.menuItemId, { qty: Number(s.qty), revenue: Number(s.revenue) }]));
      const sales60ById = new Map(salesByItem60.map((s) => [s.menuItemId, { qty: Number(s.qty), revenue: Number(s.revenue) }]));
      const cancelById = new Map(cancellations.map((c) => [c.menuItemId, Number(c.qty)]));

      // Best sellers (top by qty, last 30d).
      const bestSellers = Array.from(sales30ById.entries())
        .map(([id, v]) => {
          const m = itemById.get(id);
          return m ? { id, name: m.name, qty: v.qty, revenue: v.revenue } : null;
        })
        .filter((x): x is { id: number; name: string; qty: number; revenue: number } => !!x)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 8);

      // Low-margin items (price - cogs)/price * 100.
      const lowMargin = menu
        .map((m) => {
          const cogs = cogsByItem.get(m.id) ?? 0;
          const price = Number(m.price);
          if (cogs <= 0 || price <= 0) return null;
          const margin = ((price - cogs) / price) * 100;
          const sold = sales30ById.get(m.id)?.qty ?? 0;
          if (sold < 1) return null;
          return { id: m.id, name: m.name, price, cogs: Number(cogs.toFixed(2)), margin: Number(margin.toFixed(1)), sold };
        })
        .filter((x): x is { id: number; name: string; price: number; cogs: number; margin: number; sold: number } => !!x)
        .filter((x) => x.margin < 50)
        .sort((a, b) => a.margin - b.margin)
        .slice(0, 8);

      // Declining items (qty dropped >= 30% vs prior 30d, prior > 5).
      const declining: Array<{ id: number; name: string; qty30: number; qty60: number; pctDrop: number }> = [];
      for (const [id, v60] of sales60ById.entries()) {
        if (v60.qty < 5) continue;
        const v30 = sales30ById.get(id)?.qty ?? 0;
        if (v30 >= v60.qty) continue;
        const drop = ((v60.qty - v30) / v60.qty) * 100;
        if (drop < 30) continue;
        const m = itemById.get(id);
        if (!m) continue;
        declining.push({ id, name: m.name, qty30: v30, qty60: v60.qty, pctDrop: Number(drop.toFixed(1)) });
      }
      declining.sort((a, b) => b.pctDrop - a.pctDrop);

      // High cancellation items.
      const highCancel = Array.from(cancelById.entries())
        .map(([id, qty]) => {
          const m = itemById.get(id);
          const sold = sales30ById.get(id)?.qty ?? 0;
          const total = sold + qty;
          if (!m || total < 5 || qty < 2) return null;
          const rate = (qty / total) * 100;
          if (rate < 10) return null;
          return { id, name: m.name, cancelled: qty, sold, rate: Number(rate.toFixed(1)) };
        })
        .filter((x): x is { id: number; name: string; cancelled: number; sold: number; rate: number } => !!x)
        .sort((a, b) => b.rate - a.rate)
        .slice(0, 6);

      // Peak / weak day-of-week (0=Sun..6=Sat).
      const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const dowMap = new Map<number, { revenue: number; orders: number }>();
      for (let i = 0; i < 7; i++) dowMap.set(i, { revenue: 0, orders: 0 });
      for (const r of salesByDow) {
        const k = Number(r.dow);
        if (Number.isFinite(k)) dowMap.set(k, { revenue: Number(r.revenue), orders: Number(r.orders) });
      }
      const dowRows = Array.from(dowMap.entries()).map(([d, v]) => ({ dow: d, name: dowNames[d], ...v }));
      const peakDow = [...dowRows].sort((a, b) => b.revenue - a.revenue)[0];
      const weakDow = [...dowRows].filter((d) => d.orders > 0).sort((a, b) => a.revenue - b.revenue)[0];

      // Peak hours (top 3).
      const hourMap = new Map<number, number>();
      for (const r of salesByHour) hourMap.set(Number(r.hour), Number(r.orders));
      const peakHours = Array.from(hourMap.entries())
        .map(([h, o]) => ({ hour: h, orders: o }))
        .sort((a, b) => b.orders - a.orders).slice(0, 3);

      // Sales trend over last 30 days — split into halves.
      const half = Math.floor(salesByDay.length / 2);
      const firstHalf = salesByDay.slice(0, half);
      const secondHalf = salesByDay.slice(half);
      const sumRev = (rows: typeof salesByDay) => rows.reduce((s, d) => s + Number(d.revenue), 0);
      const firstRev = sumRev(firstHalf), secondRev = sumRev(secondHalf);
      const trendPct = firstRev > 0 ? Number((((secondRev - firstRev) / firstRev) * 100).toFixed(1)) : 0;

      const cust = customerStats[0] ?? { totalCustomers: "0", repeatCustomers: "0" };
      const totalCustomers = Number(cust.totalCustomers) || 0;
      const repeatCustomers = Number(cust.repeatCustomers) || 0;
      const repeatRate = totalCustomers > 0 ? Number(((repeatCustomers / totalCustomers) * 100).toFixed(1)) : 0;

      const allowedCats = ALLOWED_CATEGORIES.filter((c) => !skipCategories.has(c));

      const briefLines: string[] = [
        `Last 30 days: ${totalOrders30} completed orders, ₹${totalRevenue30.toFixed(0)} revenue.`,
        `Trend (2nd half vs 1st half of 30d): ${trendPct >= 0 ? "+" : ""}${trendPct}% revenue.`,
        `Best-sellers (qty): ${bestSellers.slice(0, 5).map((b) => `${b.name}(${b.qty})`).join(", ") || "—"}.`,
        `Low-margin items (margin <50%): ${lowMargin.slice(0, 5).map((l) => `${l.name}(${l.margin}%)`).join(", ") || "—"}.`,
        `Declining items (≥30% drop vs prior 30d): ${declining.slice(0, 5).map((d) => `${d.name}(${d.pctDrop}%)`).join(", ") || "—"}.`,
        `High-cancel items: ${highCancel.slice(0, 5).map((h) => `${h.name}(${h.rate}%)`).join(", ") || "—"}.`,
        `Peak day-of-week: ${peakDow ? `${peakDow.name} (₹${peakDow.revenue.toFixed(0)})` : "—"}.`,
        `Weakest day-of-week: ${weakDow ? `${weakDow.name} (₹${weakDow.revenue.toFixed(0)})` : "—"}.`,
        `Peak hours: ${peakHours.map((h) => `${String(h.hour).padStart(2, "0")}:00(${h.orders})`).join(", ") || "—"}.`,
        `Inventory: ${lowStock.length} items at/below min-stock.`,
        `Customers: ${totalCustomers} total, ${repeatCustomers} repeat (${repeatRate}% repeat rate).`,
      ];

      const prompt = `You are a restaurant analytics advisor. Read the brief below and produce a small, focused
batch of actionable insights. Each insight must be specific (mention real item names, real numbers from
the brief), short, and end with a clear next action.

Brief:
${briefLines.map((l) => `- ${l}`).join("\n")}

Allowed categories (skip any not listed; skip any whose conditions don't apply):
${allowedCats.join(", ")}

Skipped this run (recently dismissed by the owner): ${Array.from(skipCategories).join(", ") || "(none)"}

Output ONLY this JSON:
{
  "insights": [
    {
      "category": "<one of: ${allowedCats.join(" | ")}>",
      "title": "<short headline, ≤80 chars>",
      "explanation": "<1-2 sentence why, citing specific numbers/items from the brief>",
      "suggestedAction": "<one concrete next step, ≤140 chars>",
      "impact": "low|medium|high",
      "targetModule": "menu|inventory|discounts|reports|customers|orders|null",
      "targetId": <menu item id if relevant, else null>
    }
  ]
}

Rules:
- Produce 4-8 insights. Skip categories with no signal in the brief.
- Cite the actual numbers shown above; do not invent items not in the brief.
- "best_seller" insight should celebrate top performers and suggest leveraging them (combos, upsell).
- "low_margin" must reference real margin %; suggestedAction should mention price tweak or substitution.
- "suggested_offer" must be specific (combo of two items, happy-hour for a weak day/hour, weekday discount, etc.).
- Use targetId for the relevant menu item id when category is best_seller / low_margin / declining_sales / high_cancellation.
- Use targetModule "discounts" for suggested_offer, "inventory" for inventory_risk, "reports" for sales_trend, etc.
- JSON only, no markdown.`;

      const { data, result } = await AIProviderService.generateJson<{ insights?: unknown }>({
        featureSlug: FEATURE_SLUG,
        tenantId,
        restaurantId,
        userId: req.user?.sub ?? null,
        metadata: {
          orders30: totalOrders30,
          revenue30: Number(totalRevenue30.toFixed(2)),
          trendPct,
          freeClaimed,
        },
      }, {
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        maxTokens: 2500,
      });

      const allowedCatSet = new Set<string>(allowedCats);
      const allowedTargetSet = new Set<string | null>(ALLOWED_TARGET_MODULE);
      const rawInsights = Array.isArray(data.insights) ? (data.insights as RawInsight[]) : [];

      const cleaned: CleanInsight[] = rawInsights
        .map((raw): CleanInsight | null => {
          const cat = String(raw.category ?? "").trim();
          if (!allowedCatSet.has(cat)) return null;
          const title = String(raw.title ?? "").trim().slice(0, 200);
          const explanation = String(raw.explanation ?? "").trim().slice(0, 800);
          if (!title || !explanation) return null;
          const suggestedAction = raw.suggestedAction != null
            ? String(raw.suggestedAction).trim().slice(0, 300) || null
            : null;
          const impactRaw = String(raw.impact ?? "medium").toLowerCase();
          const impact: Impact = (ALLOWED_IMPACT as readonly string[]).includes(impactRaw) ? impactRaw as Impact : "medium";
          let targetModule: string | null = raw.targetModule != null && raw.targetModule !== "null"
            ? String(raw.targetModule).trim().toLowerCase() : null;
          if (targetModule === "" || !allowedTargetSet.has(targetModule)) targetModule = null;
          let targetId: number | null = raw.targetId != null && raw.targetId !== "null"
            ? Number(raw.targetId) : null;
          if (!Number.isFinite(targetId)) targetId = null;
          if (targetId != null && targetModule === "menu" && !itemById.has(targetId)) targetId = null;

          // Compute targetUrl for deep-linking from the UI.
          let targetUrl: string | null = null;
          if (targetModule === "menu") targetUrl = "/menu";
          else if (targetModule === "inventory") targetUrl = "/inventory";
          else if (targetModule === "discounts") targetUrl = "/coupons";
          else if (targetModule === "reports") targetUrl = "/reports/sales";
          else if (targetModule === "customers") targetUrl = "/customers";
          else if (targetModule === "orders") targetUrl = "/orders";

          // Attach a tiny supportingMetrics blob per category.
          const metrics: Record<string, unknown> = {};
          if (cat === "sales_trend") { metrics.trendPct = trendPct; metrics.revenue30 = Number(totalRevenue30.toFixed(2)); }
          else if (cat === "best_seller" && targetId != null) {
            const b = bestSellers.find((x) => x.id === targetId);
            if (b) { metrics.qty30 = b.qty; metrics.revenue30 = b.revenue; }
          }
          else if (cat === "low_margin" && targetId != null) {
            const l = lowMargin.find((x) => x.id === targetId);
            if (l) { metrics.margin = l.margin; metrics.price = l.price; metrics.cogs = l.cogs; }
          }
          else if (cat === "declining_sales" && targetId != null) {
            const d = declining.find((x) => x.id === targetId);
            if (d) { metrics.qty30 = d.qty30; metrics.qty60 = d.qty60; metrics.pctDrop = d.pctDrop; }
          }
          else if (cat === "peak_time") metrics.peakHours = peakHours;
          else if (cat === "weak_weekday" && weakDow) metrics.weakDow = { name: weakDow.name, revenue: weakDow.revenue, orders: weakDow.orders };
          else if (cat === "inventory_risk") metrics.lowStockCount = lowStock.length;
          else if (cat === "high_cancellation" && targetId != null) {
            const h = highCancel.find((x) => x.id === targetId);
            if (h) { metrics.rate = h.rate; metrics.cancelled = h.cancelled; metrics.sold = h.sold; }
          }
          else if (cat === "retention") {
            metrics.repeatRate = repeatRate;
            metrics.totalCustomers = totalCustomers;
            metrics.repeatCustomers = repeatCustomers;
          }

          return {
            category: cat as InsightCategory,
            title, explanation, suggestedAction, impact,
            targetModule, targetId, targetUrl,
            supportingMetrics: metrics,
          };
        })
        .filter((x): x is CleanInsight => x !== null)
        // De-dupe — keep at most one of each category per run.
        .filter((x, i, arr) => arr.findIndex((y) => y.category === x.category) === i)
        .slice(0, 10);

      if (cleaned.length === 0) {
        await cleanup("no insights produced");
        return void res.status(502).json({ error: "AI returned no usable insights. Try again later." });
      }

      const expiresAt = new Date(Date.now() + INSIGHT_TTL_DAYS * 86_400_000);
      const inserted = await db.insert(aiSalesInsightsTable).values(
        cleaned.map((c) => ({
          tenantId,
          restaurantId,
          category: c.category,
          title: c.title,
          explanation: c.explanation,
          suggestedAction: c.suggestedAction,
          impact: c.impact,
          targetModule: c.targetModule,
          targetId: c.targetId,
          targetUrl: c.targetUrl,
          supportingMetrics: c.supportingMetrics,
          status: "active" as const,
          confidence: c.impact === "high" ? "0.80" : c.impact === "medium" ? "0.65" : "0.50",
          requestLogId: result.requestLogId,
          generatedBy: req.user?.sub ?? null,
          expiresAt,
        })),
      ).returning();

      if (reservation) {
        await commitReservation({ reservation, userId: req.user?.sub ?? null, requestLogId: result.requestLogId });
      }
      await recordAuditLog({
        req, module: "khana_ai", action: "insights.generate",
        entity: "ai_sales_insight",
        newValue: {
          count: inserted.length,
          freeClaimed,
          requestLogId: result.requestLogId,
        },
      });

      // Return fresh allowance for the UI.
      let allowance: { dailyLimit: number; used: number; remaining: number } | null = null;
      if (tenantId) {
        const [t] = await db.select({ planId: tenantsTable.planId })
          .from(tenantsTable).where(eq(tenantsTable.id, tenantId));
        allowance = await loadFreeAllowance({ tenantId, restaurantId, planId: t?.planId ?? null });
      }
      res.json({ insights: inserted, freeClaimed, allowance });
    } catch (err) {
      await cleanup((err as Error).message ?? "provider error");
      req.log.error({ err }, "AI sales insights generation failed");
      await recordAuditLog({
        req, module: "khana_ai", action: "insights.generate_failed",
        entity: "ai_sales_insight", newValue: { error: (err as Error).message ?? "provider error" },
      });
      res.status(502).json({ error: "Failed to generate sales insights" });
    }
  },
);

export default router;
