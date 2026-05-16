import { Router, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../lib/db";
import { requireSuperAdmin } from "../middleware/authorize";

const router = Router();
router.use("/admin/metrics", requireSuperAdmin);

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Range = { from: Date; to: Date; currency: "INR" | "USD" };

function parseRange(req: Request): Range {
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  const fromRaw = String(req.query.from ?? "");
  const toRaw = String(req.query.to ?? "");
  const from = fromRaw ? new Date(fromRaw) : defaultFrom;
  const to = toRaw ? new Date(toRaw) : now;
  const currencyRaw = String(req.query.currency ?? "INR").toUpperCase();
  const currency: "INR" | "USD" = currencyRaw === "USD" ? "USD" : "INR";
  return { from, to, currency };
}

// Fixed FX used to normalize cross-currency data into the requested
// reporting currency. Real exchange rate handling is out of scope for
// this dashboard — we surface the rate in the response so investors can
// see what was applied.
const FX = { INR_PER_USD: 83, USD_PER_INR: 1 / 83 };

function toCurrencyExpr(amountSql: string, sourceCurrencyCol: string, target: "INR" | "USD"): string {
  if (target === "INR") {
    return `CASE WHEN ${sourceCurrencyCol} = 'USD' THEN ${amountSql} * ${FX.INR_PER_USD} ELSE ${amountSql} END`;
  }
  return `CASE WHEN ${sourceCurrencyCol} = 'INR' THEN ${amountSql} * ${FX.USD_PER_INR} ELSE ${amountSql} END`;
}

// Tiny in-memory cache for expensive aggregations.
const cache = new Map<string, { ts: number; data: unknown }>();
const CACHE_TTL_MS = 60_000;

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data as T;
  const data = await fn();
  cache.set(key, { ts: Date.now(), data });
  return data;
}

// ─── /overview ───────────────────────────────────────────────────────────────
//
// Single aggregate endpoint covering tenancy, revenue (MRR/ARR/ARPR), churn,
// trial conversion, payment volume, GMV, total orders/payments/customers, and
// vendor commission. Returns numbers in the requested reporting currency.

router.get("/admin/metrics/overview", async (req, res) => {
  try {
    const { from, to, currency } = parseRange(req);
    const key = `overview:${from.toISOString()}:${to.toISOString()}:${currency}`;
    const data = await cached(key, async () => {
      // Tenancy snapshot at "now".
      const tenancyRows = await db.execute(sql`
        SELECT
          COUNT(*)::int                                                  AS total_tenants,
          COUNT(*) FILTER (WHERE plan_status = 'active')::int            AS active_tenants,
          COUNT(*) FILTER (WHERE plan_status = 'trial')::int             AS trial_tenants,
          COUNT(*) FILTER (WHERE plan_status IN ('cancelled','expired'))::int AS cancelled_tenants,
          COUNT(*) FILTER (WHERE is_suspended = true)::int               AS suspended_tenants,
          COUNT(*) FILTER (WHERE created_at >= ${from} AND created_at <= ${to})::int AS new_tenants_in_period
        FROM tenants
      `);
      const tenancy = (tenancyRows.rows[0] ?? {}) as Record<string, number>;

      // MRR — sum normalized monthly price for active paid tenants, in target currency.
      const fxFactorPlan = currency === "INR"
        ? sql.raw(`CASE WHEN sp.currency = 'USD' THEN ${FX.INR_PER_USD} ELSE 1 END`)
        : sql.raw(`CASE WHEN sp.currency = 'INR' THEN ${FX.USD_PER_INR} ELSE 1 END`);
      const monthlyExpr = sql.raw(`CASE WHEN sp.billing_period = 'yearly' THEN sp.price / 12.0 ELSE sp.price END`);

      const mrrRows = await db.execute(sql`
        SELECT
          COALESCE(SUM(${monthlyExpr} * ${fxFactorPlan}), 0)::float8 AS mrr,
          COUNT(*)::int                                              AS paid_tenants
        FROM tenants t
        JOIN subscription_plans sp ON sp.id = t.plan_id
        WHERE t.plan_status = 'active'
          AND COALESCE(sp.price, 0) > 0
      `);
      const mrr = Number(mrrRows.rows[0]?.mrr ?? 0);
      const paidTenants = Number(mrrRows.rows[0]?.paid_tenants ?? 0);

      // Paid restaurant count (for ARPR).
      const paidRestRows = await db.execute(sql`
        SELECT COUNT(r.id)::int AS paid_restaurants
        FROM restaurants r
        JOIN tenants t ON t.id = r.tenant_id
        WHERE t.plan_status = 'active' AND r.is_active = true
      `);
      const paidRestaurants = Number(paidRestRows.rows[0]?.paid_restaurants ?? 0);

      // Subscription payment volume in period (target currency).
      const fxFactorPay = currency === "INR"
        ? sql.raw(`CASE WHEN currency = 'USD' THEN ${FX.INR_PER_USD} ELSE 1 END`)
        : sql.raw(`CASE WHEN currency = 'INR' THEN ${FX.USD_PER_INR} ELSE 1 END`);
      const paymentRows = await db.execute(sql`
        SELECT
          COALESCE(SUM(amount * ${fxFactorPay}), 0)::float8 AS volume,
          COUNT(*)::int                                     AS count
        FROM subscription_payments
        WHERE status = 'succeeded'
          AND created_at >= ${from} AND created_at <= ${to}
      `);
      const subscriptionVolume = Number(paymentRows.rows[0]?.volume ?? 0);
      const subscriptionPaymentsCount = Number(paymentRows.rows[0]?.count ?? 0);

      // AI recharge revenue in period.
      const aiRows = await db.execute(sql`
        SELECT COALESCE(SUM(amount * ${fxFactorPay}), 0)::float8 AS revenue
        FROM ai_credit_recharges
        WHERE status = 'succeeded'
          AND created_at >= ${from} AND created_at <= ${to}
      `);
      const aiRevenue = Number(aiRows.rows[0]?.revenue ?? 0);

      // Add-on revenue (paid tenant_addons within period, by addon_events of type 'payment').
      const fxFactorAddon = currency === "INR"
        ? sql.raw(`CASE WHEN currency = 'USD' THEN ${FX.INR_PER_USD} ELSE 1 END`)
        : sql.raw(`CASE WHEN currency = 'INR' THEN ${FX.USD_PER_INR} ELSE 1 END`);
      const addonRows = await db.execute(sql`
        SELECT COALESCE(SUM(amount * ${fxFactorAddon}), 0)::float8 AS revenue
        FROM addon_events
        WHERE event_type = 'payment'
          AND amount IS NOT NULL
          AND created_at >= ${from} AND created_at <= ${to}
      `);
      const addonRevenue = Number(addonRows.rows[0]?.revenue ?? 0);

      // GMV — sum of completed/paid order totals in period (assumed INR per restaurant.currency; we normalize).
      const gmvRows = await db.execute(sql`
        SELECT
          COALESCE(SUM(
            o.total_amount * ${currency === "INR"
              ? sql.raw(`CASE WHEN COALESCE(r.currency, 'INR') = 'USD' THEN ${FX.INR_PER_USD} ELSE 1 END`)
              : sql.raw(`CASE WHEN COALESCE(r.currency, 'INR') = 'INR' THEN ${FX.USD_PER_INR} ELSE 1 END`)}
          ), 0)::float8 AS gmv,
          COUNT(*)::int AS orders,
          COALESCE(SUM(
            (o.total_amount * COALESCE(o.channel_commission_pct, 0) / 100.0) * ${currency === "INR"
              ? sql.raw(`CASE WHEN COALESCE(r.currency, 'INR') = 'USD' THEN ${FX.INR_PER_USD} ELSE 1 END`)
              : sql.raw(`CASE WHEN COALESCE(r.currency, 'INR') = 'INR' THEN ${FX.USD_PER_INR} ELSE 1 END`)}
          ), 0)::float8 AS vendor_commission
        FROM orders o
        JOIN restaurants r ON r.id = o.restaurant_id
        WHERE o.payment_status = 'paid'
          AND o.created_at >= ${from} AND o.created_at <= ${to}
      `);
      const gmv = Number(gmvRows.rows[0]?.gmv ?? 0);
      const totalOrders = Number(gmvRows.rows[0]?.orders ?? 0);
      const vendorCommission = Number(gmvRows.rows[0]?.vendor_commission ?? 0);

      // Total in-app payments (operational tender activity) in period.
      const inAppPayRows = await db.execute(sql`
        SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::float8 AS total
        FROM payments
        WHERE payment_date >= ${from} AND payment_date <= ${to}
      `);
      const totalInAppPayments = Number(inAppPayRows.rows[0]?.count ?? 0);
      const inAppPaymentVolume = Number(inAppPayRows.rows[0]?.total ?? 0);

      // Total customers (lifetime, across all restaurants) and new in period.
      const custRows = await db.execute(sql`
        SELECT
          COUNT(*)::int AS total_customers,
          COUNT(*) FILTER (WHERE created_at >= ${from} AND created_at <= ${to})::int AS new_customers_in_period
        FROM customers
      `);
      const totalCustomers = Number(custRows.rows[0]?.total_customers ?? 0);
      const newCustomersInPeriod = Number(custRows.rows[0]?.new_customers_in_period ?? 0);

      // Churn — paid tenants whose subscription ended in period (cancelled/expired).
      const churnedRows = await db.execute(sql`
        SELECT COUNT(*)::int AS churned
        FROM tenants
        WHERE plan_status IN ('cancelled', 'expired')
          AND subscription_ends_at IS NOT NULL
          AND subscription_ends_at >= ${from}
          AND subscription_ends_at <= ${to}
      `);
      const churned = Number(churnedRows.rows[0]?.churned ?? 0);

      // Paid tenants at start of period (active or those who churned within period).
      const startBaseRows = await db.execute(sql`
        SELECT COUNT(*)::int AS base FROM tenants
        WHERE plan_id IS NOT NULL
          AND (subscription_started_at IS NULL OR subscription_started_at < ${from})
          AND (
            plan_status = 'active'
            OR (plan_status IN ('cancelled','expired') AND subscription_ends_at >= ${from})
          )
      `);
      const baseAtPeriodStart = Number(startBaseRows.rows[0]?.base ?? 0);
      const churnRate = baseAtPeriodStart > 0 ? churned / baseAtPeriodStart : 0;

      // Trial conversion — trials that started in period and have since become active.
      const trialRows = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= ${from} AND created_at <= ${to})::int AS trials_started,
          COUNT(*) FILTER (
            WHERE created_at >= ${from} AND created_at <= ${to}
              AND plan_status = 'active'
              AND subscription_started_at IS NOT NULL
          )::int AS trials_converted
        FROM tenants
        WHERE plan_status = 'trial' OR subscription_started_at IS NOT NULL
      `);
      const trialsStarted = Number(trialRows.rows[0]?.trials_started ?? 0);
      const trialsConverted = Number(trialRows.rows[0]?.trials_converted ?? 0);
      const trialConversionRate = trialsStarted > 0 ? trialsConverted / trialsStarted : 0;

      const arr = mrr * 12;
      const arpr = paidRestaurants > 0 ? mrr / paidRestaurants : 0;

      return {
        currency,
        fxRate: currency === "INR" ? `1 USD = ${FX.INR_PER_USD} INR` : `1 INR = ${FX.USD_PER_INR.toFixed(4)} USD`,
        period: { from: from.toISOString(), to: to.toISOString() },
        tenancy: {
          totalTenants: tenancy.total_tenants ?? 0,
          activeTenants: tenancy.active_tenants ?? 0,
          trialTenants: tenancy.trial_tenants ?? 0,
          cancelledTenants: tenancy.cancelled_tenants ?? 0,
          suspendedTenants: tenancy.suspended_tenants ?? 0,
          newTenantsInPeriod: tenancy.new_tenants_in_period ?? 0,
          paidRestaurants,
        },
        revenue: {
          mrr,
          arr,
          arpr,
          subscriptionVolume,
          subscriptionPaymentsCount,
          aiRevenue,
          addonRevenue,
          gmv,
          vendorCommission,
          inAppPaymentVolume,
        },
        engagement: {
          totalOrders,
          totalInAppPayments,
          totalCustomers,
          newCustomersInPeriod,
        },
        retention: {
          churned,
          baseAtPeriodStart,
          churnRate,
          trialsStarted,
          trialsConverted,
          trialConversionRate,
        },
      };
    });
    res.json(data);
  } catch (err) {
    console.error("[admin/metrics/overview] error", err);
    res.status(500).json({ error: "Failed to compute investor metrics overview" });
  }
});

// ─── /top-cities ─────────────────────────────────────────────────────────────

router.get("/admin/metrics/top-cities", async (req, res) => {
  try {
    const { from, to, currency } = parseRange(req);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 10) || 10, 1), 50);
    const key = `cities:${from.toISOString()}:${to.toISOString()}:${currency}:${limit}`;
    const data = await cached(key, async () => {
      const fxFactor = currency === "INR"
        ? sql.raw(`CASE WHEN COALESCE(r.currency, 'INR') = 'USD' THEN ${FX.INR_PER_USD} ELSE 1 END`)
        : sql.raw(`CASE WHEN COALESCE(r.currency, 'INR') = 'INR' THEN ${FX.USD_PER_INR} ELSE 1 END`);
      const rows = await db.execute(sql`
        SELECT
          COALESCE(NULLIF(TRIM(r.city), ''), 'Unknown') AS city,
          COUNT(DISTINCT r.id)::int AS restaurants,
          COUNT(o.id)::int AS orders,
          COALESCE(SUM(o.total_amount * ${fxFactor}), 0)::float8 AS gmv
        FROM restaurants r
        LEFT JOIN orders o
          ON o.restaurant_id = r.id
          AND o.payment_status = 'paid'
          AND o.created_at >= ${from} AND o.created_at <= ${to}
        GROUP BY 1
        ORDER BY gmv DESC, orders DESC, restaurants DESC
        LIMIT ${limit}
      `);
      return { currency, rows: rows.rows };
    });
    res.json(data);
  } catch (err) {
    console.error("[admin/metrics/top-cities] error", err);
    res.status(500).json({ error: "Failed to compute top cities" });
  }
});

// ─── /top-categories ─────────────────────────────────────────────────────────

router.get("/admin/metrics/top-categories", async (req, res) => {
  try {
    const { from, to, currency } = parseRange(req);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 10) || 10, 1), 50);
    const key = `cats:${from.toISOString()}:${to.toISOString()}:${currency}:${limit}`;
    const data = await cached(key, async () => {
      const fxFactor = currency === "INR"
        ? sql.raw(`CASE WHEN COALESCE(r.currency, 'INR') = 'USD' THEN ${FX.INR_PER_USD} ELSE 1 END`)
        : sql.raw(`CASE WHEN COALESCE(r.currency, 'INR') = 'INR' THEN ${FX.USD_PER_INR} ELSE 1 END`);
      const rows = await db.execute(sql`
        SELECT
          COALESCE(NULLIF(TRIM(mc.name), ''), 'Uncategorized') AS category,
          COUNT(oi.id)::int AS items_sold,
          COALESCE(SUM(oi.total_price * ${fxFactor}), 0)::float8 AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN restaurants r ON r.id = o.restaurant_id
        JOIN menu_items mi ON mi.id = oi.menu_item_id
        LEFT JOIN menu_categories mc ON mc.id = mi.category_id
        WHERE o.created_at >= ${from} AND o.created_at <= ${to}
          AND o.payment_status = 'paid'
        GROUP BY 1
        ORDER BY revenue DESC
        LIMIT ${limit}
      `);
      return { currency, rows: rows.rows };
    });
    res.json(data);
  } catch (err) {
    console.error("[admin/metrics/top-categories] error", err);
    res.status(500).json({ error: "Failed to compute top categories" });
  }
});

// ─── /module-adoption ────────────────────────────────────────────────────────

router.get("/admin/metrics/module-adoption", async (_req, res) => {
  try {
    const data = await cached(`modules`, async () => {
      const totalRows = await db.execute(sql`SELECT COUNT(*)::int AS n FROM tenants`);
      const totalTenants = Number(totalRows.rows[0]?.n ?? 0);
      const rows = await db.execute(sql`
        SELECT
          a.key,
          a.name,
          a.category,
          COUNT(DISTINCT ta.tenant_id) FILTER (WHERE ta.status IN ('active','trial'))::int AS active_tenants,
          COUNT(DISTINCT ta.tenant_id) FILTER (WHERE ta.status = 'trial')::int             AS trial_tenants,
          COUNT(DISTINCT ta.tenant_id) FILTER (WHERE ta.status = 'cancelled')::int         AS cancelled_tenants
        FROM addons a
        LEFT JOIN tenant_addons ta ON ta.addon_id = a.id
        WHERE a.is_enabled = true
        GROUP BY a.id, a.key, a.name, a.category
        ORDER BY active_tenants DESC, a.sort_order ASC
      `);
      return { totalTenants, rows: rows.rows };
    });
    res.json(data);
  } catch (err) {
    console.error("[admin/metrics/module-adoption] error", err);
    res.status(500).json({ error: "Failed to compute module adoption" });
  }
});

// ─── /cohorts ────────────────────────────────────────────────────────────────
//
// Cohort retention by tenant signup month. A cohort is "retained" in month N
// if any restaurant belonging to tenants in that cohort produced at least one
// order in month N. We return the last 12 cohorts × up to 12 months out.

router.get("/admin/metrics/cohorts", async (req, res) => {
  try {
    const months = Math.min(Math.max(Number(req.query.months ?? 12) || 12, 3), 18);
    const key = `cohorts:${months}`;
    const data = await cached(key, async () => {
      const rows = await db.execute(sql`
        WITH cohorts AS (
          SELECT
            t.id AS tenant_id,
            DATE_TRUNC('month', t.created_at) AS cohort_month
          FROM tenants t
          WHERE t.created_at >= NOW() - (INTERVAL '1 month' * ${months})
        ),
        activity AS (
          SELECT
            c.cohort_month,
            DATE_TRUNC('month', o.created_at) AS active_month,
            COUNT(DISTINCT c.tenant_id) AS active_tenants
          FROM cohorts c
          JOIN restaurants r ON r.tenant_id = c.tenant_id
          JOIN orders o ON o.restaurant_id = r.id
          WHERE o.created_at >= c.cohort_month
          GROUP BY 1, 2
        ),
        sizes AS (
          SELECT cohort_month, COUNT(*)::int AS cohort_size
          FROM cohorts
          GROUP BY cohort_month
        )
        SELECT
          to_char(s.cohort_month, 'YYYY-MM')        AS cohort,
          s.cohort_size                             AS cohort_size,
          to_char(a.active_month, 'YYYY-MM')        AS active_month,
          (EXTRACT(YEAR FROM AGE(a.active_month, s.cohort_month)) * 12
           + EXTRACT(MONTH FROM AGE(a.active_month, s.cohort_month)))::int AS month_offset,
          COALESCE(a.active_tenants, 0)::int        AS active_tenants
        FROM sizes s
        LEFT JOIN activity a ON a.cohort_month = s.cohort_month
        ORDER BY s.cohort_month ASC, month_offset ASC
      `);
      // Build matrix: { cohort: { size, retention: [{offset, count, pct}] } }
      const map = new Map<string, { size: number; retention: Map<number, number> }>();
      for (const r of rows.rows as Array<Record<string, unknown>>) {
        const cohort = String(r.cohort);
        const size = Number(r.cohort_size ?? 0);
        const off = r.month_offset == null ? null : Number(r.month_offset);
        if (!map.has(cohort)) map.set(cohort, { size, retention: new Map() });
        const entry = map.get(cohort)!;
        if (off !== null && off >= 0 && off <= months) {
          entry.retention.set(off, Number(r.active_tenants ?? 0));
        }
      }
      const cohorts = Array.from(map.entries()).map(([cohort, v]) => ({
        cohort,
        size: v.size,
        retention: Array.from({ length: months + 1 }, (_, i) => {
          const count = v.retention.get(i) ?? 0;
          return { offset: i, active: count, pct: v.size > 0 ? count / v.size : 0 };
        }),
      }));
      return { months, cohorts };
    });
    res.json(data);
  } catch (err) {
    console.error("[admin/metrics/cohorts] error", err);
    res.status(500).json({ error: "Failed to compute cohort retention" });
  }
});

export default router;
