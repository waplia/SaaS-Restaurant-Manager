import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp, Users, Building2, CreditCard, Repeat, BarChart3, MapPin,
  UtensilsCrossed, Puzzle, Calendar, ArrowDownToLine, RefreshCw, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

type Currency = "INR" | "USD";

interface OverviewResp {
  currency: Currency;
  fxRate: string;
  period: { from: string; to: string };
  tenancy: {
    totalTenants: number; activeTenants: number; trialTenants: number;
    cancelledTenants: number; suspendedTenants: number;
    newTenantsInPeriod: number; paidRestaurants: number;
  };
  revenue: {
    mrr: number; arr: number; arpr: number;
    subscriptionVolume: number; subscriptionPaymentsCount: number;
    aiRevenue: number; addonRevenue: number;
    gmv: number; vendorCommission: number; inAppPaymentVolume: number;
  };
  engagement: {
    totalOrders: number; totalInAppPayments: number;
    totalCustomers: number; newCustomersInPeriod: number;
  };
  retention: {
    churned: number; baseAtPeriodStart: number; churnRate: number;
    trialsStarted: number; trialsConverted: number; trialConversionRate: number;
  };
}

interface CitiesResp { currency: Currency; rows: Array<{ city: string; restaurants: number; orders: number; gmv: number }> }
interface CategoriesResp { currency: Currency; rows: Array<{ category: string; items_sold: number; revenue: number }> }
interface ModulesResp { totalTenants: number; rows: Array<{ key: string; name: string; category: string; active_tenants: number; trial_tenants: number; cancelled_tenants: number }> }
interface CohortsResp {
  months: number;
  cohorts: Array<{ cohort: string; size: number; retention: Array<{ offset: number; active: number; pct: number }> }>;
}

const RANGES: Array<{ id: string; label: string; days: number }> = [
  { id: "7d",  label: "Last 7 days",   days: 7 },
  { id: "30d", label: "Last 30 days",  days: 30 },
  { id: "90d", label: "Last 90 days",  days: 90 },
  { id: "365d",label: "Last 12 months",days: 365 },
];

function rangeToParams(rangeId: string, currency: Currency): string {
  const days = RANGES.find(r => r.id === rangeId)?.days ?? 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), currency });
  return qs.toString();
}

function fmtCurrency(n: number | undefined, currency: Currency): string {
  if (n == null || isNaN(n as number)) return "—";
  const symbol = currency === "INR" ? "₹" : "$";
  if (Math.abs(n) >= 1e7) return `${symbol}${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `${symbol}${(n / 1e5).toFixed(2)} L`;
  if (Math.abs(n) >= 1e3) return `${symbol}${(n / 1e3).toFixed(2)}k`;
  return `${symbol}${n.toFixed(2)}`;
}

function fmtPct(n: number | undefined, digits = 1): string {
  if (n == null || isNaN(n as number)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtNum(n: number | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function Skel({ className = "h-6 w-24" }: { className?: string }) {
  return <div className={`bg-muted animate-pulse rounded ${className}`} />;
}

function Card({ title, icon: Icon, children, isLoading, action }: {
  title: string; icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode; isLoading?: boolean; action?: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {action}
      </div>
      {isLoading ? <Skel className="h-16 w-full" /> : children}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ─── CSV Export ─────────────────────────────────────────────────────────────

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const text = rows.map(r => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

export default function AdminMetricsTab() {
  const [rangeId, setRangeId] = useState<string>("30d");
  const [currency, setCurrency] = useState<Currency>("INR");
  const params = useMemo(() => rangeToParams(rangeId, currency), [rangeId, currency]);

  const overview = useQuery<OverviewResp>({
    queryKey: ["admin-metrics", "overview", rangeId, currency],
    queryFn: () => apiFetch(`/admin/metrics/overview?${params}`),
  });
  const cities = useQuery<CitiesResp>({
    queryKey: ["admin-metrics", "cities", rangeId, currency],
    queryFn: () => apiFetch(`/admin/metrics/top-cities?${params}&limit=10`),
  });
  const cats = useQuery<CategoriesResp>({
    queryKey: ["admin-metrics", "categories", rangeId, currency],
    queryFn: () => apiFetch(`/admin/metrics/top-categories?${params}&limit=10`),
  });
  const modules = useQuery<ModulesResp>({
    queryKey: ["admin-metrics", "modules"],
    queryFn: () => apiFetch(`/admin/metrics/module-adoption`),
  });
  const cohorts = useQuery<CohortsResp>({
    queryKey: ["admin-metrics", "cohorts"],
    queryFn: () => apiFetch(`/admin/metrics/cohorts?months=12`),
  });

  const refreshAll = () => {
    overview.refetch(); cities.refetch(); cats.refetch(); modules.refetch(); cohorts.refetch();
  };

  const exportCsv = () => {
    const ts = new Date().toISOString().slice(0, 10);
    const rows: Array<Array<string | number>> = [];
    rows.push(["Investor Metrics Snapshot"]);
    rows.push(["Generated", new Date().toISOString()]);
    rows.push(["Range", RANGES.find(r => r.id === rangeId)?.label ?? rangeId]);
    rows.push(["Currency", currency]);
    if (overview.data) {
      const o = overview.data;
      rows.push([]);
      rows.push(["Section", "Metric", "Value"]);
      rows.push(["Tenancy", "Total tenants", o.tenancy.totalTenants]);
      rows.push(["Tenancy", "Active tenants", o.tenancy.activeTenants]);
      rows.push(["Tenancy", "Trial tenants", o.tenancy.trialTenants]);
      rows.push(["Tenancy", "Cancelled tenants", o.tenancy.cancelledTenants]);
      rows.push(["Tenancy", "Suspended tenants", o.tenancy.suspendedTenants]);
      rows.push(["Tenancy", "New tenants in period", o.tenancy.newTenantsInPeriod]);
      rows.push(["Tenancy", "Paid restaurants", o.tenancy.paidRestaurants]);
      rows.push(["Revenue", `MRR (${currency})`, o.revenue.mrr.toFixed(2)]);
      rows.push(["Revenue", `ARR (${currency})`, o.revenue.arr.toFixed(2)]);
      rows.push(["Revenue", `ARPR (${currency})`, o.revenue.arpr.toFixed(2)]);
      rows.push(["Revenue", `Subscription volume in period (${currency})`, o.revenue.subscriptionVolume.toFixed(2)]);
      rows.push(["Revenue", "Subscription payments in period", o.revenue.subscriptionPaymentsCount]);
      rows.push(["Revenue", `AI recharge revenue (${currency})`, o.revenue.aiRevenue.toFixed(2)]);
      rows.push(["Revenue", `Add-on revenue (${currency})`, o.revenue.addonRevenue.toFixed(2)]);
      rows.push(["Revenue", `GMV (${currency})`, o.revenue.gmv.toFixed(2)]);
      rows.push(["Revenue", `Vendor commission (${currency})`, o.revenue.vendorCommission.toFixed(2)]);
      rows.push(["Revenue", `In-app payment volume (${currency})`, o.revenue.inAppPaymentVolume.toFixed(2)]);
      rows.push(["Engagement", "Total orders in period", o.engagement.totalOrders]);
      rows.push(["Engagement", "In-app payments in period", o.engagement.totalInAppPayments]);
      rows.push(["Engagement", "Total customers", o.engagement.totalCustomers]);
      rows.push(["Engagement", "New customers in period", o.engagement.newCustomersInPeriod]);
      rows.push(["Retention", "Churned in period", o.retention.churned]);
      rows.push(["Retention", "Paid base at period start", o.retention.baseAtPeriodStart]);
      rows.push(["Retention", "Churn rate", `${(o.retention.churnRate * 100).toFixed(2)}%`]);
      rows.push(["Retention", "Trials started in period", o.retention.trialsStarted]);
      rows.push(["Retention", "Trials converted", o.retention.trialsConverted]);
      rows.push(["Retention", "Trial conversion rate", `${(o.retention.trialConversionRate * 100).toFixed(2)}%`]);
    }
    if (cities.data) {
      rows.push([]);
      rows.push(["Top Cities", "City", "Restaurants", "Orders", `GMV (${currency})`]);
      cities.data.rows.forEach(r => rows.push(["", r.city, r.restaurants, r.orders, r.gmv.toFixed(2)]));
    }
    if (cats.data) {
      rows.push([]);
      rows.push(["Top Categories", "Category", "Items sold", `Revenue (${currency})`]);
      cats.data.rows.forEach(r => rows.push(["", r.category, r.items_sold, r.revenue.toFixed(2)]));
    }
    if (modules.data) {
      rows.push([]);
      rows.push(["Module Adoption", "Module", "Category", "Active tenants", "Trial tenants", "Cancelled"]);
      modules.data.rows.forEach(r => rows.push(["", r.name, r.category, r.active_tenants, r.trial_tenants, r.cancelled_tenants]));
    }
    if (cohorts.data) {
      rows.push([]);
      const header = ["Cohort", "Size", ...Array.from({ length: cohorts.data.months + 1 }, (_, i) => `M${i}`)];
      rows.push(header);
      cohorts.data.cohorts.forEach(c => {
        rows.push([c.cohort, c.size, ...c.retention.map(r => `${(r.pct * 100).toFixed(1)}%`)]);
      });
    }
    downloadCsv(`investor-metrics-${rangeId}-${currency}-${ts}.csv`, rows);
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <select
            className="text-sm border border-border rounded-md px-2 py-1.5 bg-background text-foreground"
            value={rangeId}
            onChange={e => setRangeId(e.target.value)}
          >
            {RANGES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Currency</span>
          <select
            className="text-sm border border-border rounded-md px-2 py-1.5 bg-background text-foreground"
            value={currency}
            onChange={e => setCurrency(e.target.value as Currency)}
          >
            <option value="INR">INR (₹)</option>
            <option value="USD">USD ($)</option>
          </select>
        </div>
        {overview.data?.fxRate && (
          <span className="text-xs text-muted-foreground">FX: {overview.data.fxRate}</span>
        )}
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={refreshAll} className="gap-2">
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} className="gap-2">
          <ArrowDownToLine className="w-4 h-4" /> Export CSV
        </Button>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card title="MRR" icon={TrendingUp} isLoading={overview.isLoading}>
          <Stat
            label={`Monthly recurring (${currency})`}
            value={fmtCurrency(overview.data?.revenue.mrr, currency)}
            hint={`${overview.data?.tenancy.activeTenants ?? 0} active paid tenants`}
          />
        </Card>
        <Card title="ARR" icon={TrendingUp} isLoading={overview.isLoading}>
          <Stat
            label={`Annual run-rate (${currency})`}
            value={fmtCurrency(overview.data?.revenue.arr, currency)}
          />
        </Card>
        <Card title="ARPR" icon={Building2} isLoading={overview.isLoading}>
          <Stat
            label={`Avg revenue / paid restaurant`}
            value={fmtCurrency(overview.data?.revenue.arpr, currency)}
            hint={`${overview.data?.tenancy.paidRestaurants ?? 0} paid restaurants`}
          />
        </Card>
        <Card title="Churn" icon={Repeat} isLoading={overview.isLoading}>
          <Stat
            label="Period churn rate"
            value={fmtPct(overview.data?.retention.churnRate)}
            hint={`${overview.data?.retention.churned ?? 0} churned / ${overview.data?.retention.baseAtPeriodStart ?? 0} base`}
          />
        </Card>
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card title="Trial conversion" icon={Users} isLoading={overview.isLoading}>
          <Stat
            label="Period"
            value={fmtPct(overview.data?.retention.trialConversionRate)}
            hint={`${overview.data?.retention.trialsConverted ?? 0} of ${overview.data?.retention.trialsStarted ?? 0} trials`}
          />
        </Card>
        <Card title="Subscription volume" icon={CreditCard} isLoading={overview.isLoading}>
          <Stat
            label={`In period (${currency})`}
            value={fmtCurrency(overview.data?.revenue.subscriptionVolume, currency)}
            hint={`${overview.data?.revenue.subscriptionPaymentsCount ?? 0} payments`}
          />
        </Card>
        <Card title="GMV" icon={BarChart3} isLoading={overview.isLoading}>
          <Stat
            label={`Order volume (${currency})`}
            value={fmtCurrency(overview.data?.revenue.gmv, currency)}
            hint={`${fmtNum(overview.data?.engagement.totalOrders)} paid orders`}
          />
        </Card>
        <Card title="Vendor commission" icon={CreditCard} isLoading={overview.isLoading}>
          <Stat
            label={`Aggregator/channel cut (${currency})`}
            value={fmtCurrency(overview.data?.revenue.vendorCommission, currency)}
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card title="AI recharge revenue" icon={TrendingUp} isLoading={overview.isLoading}>
          <Stat label={`In period (${currency})`} value={fmtCurrency(overview.data?.revenue.aiRevenue, currency)} />
        </Card>
        <Card title="Add-on revenue" icon={Puzzle} isLoading={overview.isLoading}>
          <Stat label={`In period (${currency})`} value={fmtCurrency(overview.data?.revenue.addonRevenue, currency)} />
        </Card>
        <Card title="In-app payments" icon={CreditCard} isLoading={overview.isLoading}>
          <Stat
            label="Count in period"
            value={fmtNum(overview.data?.engagement.totalInAppPayments)}
            hint={`${fmtCurrency(overview.data?.revenue.inAppPaymentVolume, currency)} processed`}
          />
        </Card>
        <Card title="Customers" icon={Users} isLoading={overview.isLoading}>
          <Stat
            label="Total"
            value={fmtNum(overview.data?.engagement.totalCustomers)}
            hint={`+${fmtNum(overview.data?.engagement.newCustomersInPeriod)} in period`}
          />
        </Card>
      </div>

      {/* Top cities + categories */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Top cities" icon={MapPin} isLoading={cities.isLoading}>
          {cities.data && cities.data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data in period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2">City</th>
                    <th className="text-right">Restaurants</th>
                    <th className="text-right">Orders</th>
                    <th className="text-right">GMV</th>
                  </tr>
                </thead>
                <tbody>
                  {cities.data?.rows.map(r => (
                    <tr key={r.city} className="border-b border-border/50">
                      <td className="py-2 font-medium text-foreground">{r.city}</td>
                      <td className="text-right tabular-nums">{fmtNum(r.restaurants)}</td>
                      <td className="text-right tabular-nums">{fmtNum(r.orders)}</td>
                      <td className="text-right tabular-nums">{fmtCurrency(r.gmv, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Top menu categories" icon={UtensilsCrossed} isLoading={cats.isLoading}>
          {cats.data && cats.data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data in period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2">Category</th>
                    <th className="text-right">Items sold</th>
                    <th className="text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {cats.data?.rows.map(r => (
                    <tr key={r.category} className="border-b border-border/50">
                      <td className="py-2 font-medium text-foreground">{r.category}</td>
                      <td className="text-right tabular-nums">{fmtNum(r.items_sold)}</td>
                      <td className="text-right tabular-nums">{fmtCurrency(r.revenue, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Module adoption */}
      <Card title="Module adoption" icon={Puzzle} isLoading={modules.isLoading}>
        {modules.data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2">Module</th>
                  <th className="text-left">Category</th>
                  <th className="text-right">Active</th>
                  <th className="text-right">Trial</th>
                  <th className="text-right">Cancelled</th>
                  <th className="text-right">Adoption</th>
                </tr>
              </thead>
              <tbody>
                {modules.data.rows.map(r => {
                  const pct = modules.data!.totalTenants > 0 ? r.active_tenants / modules.data!.totalTenants : 0;
                  return (
                    <tr key={r.key} className="border-b border-border/50">
                      <td className="py-2 font-medium text-foreground">{r.name}</td>
                      <td className="text-muted-foreground">{r.category}</td>
                      <td className="text-right tabular-nums">{fmtNum(r.active_tenants)}</td>
                      <td className="text-right tabular-nums">{fmtNum(r.trial_tenants)}</td>
                      <td className="text-right tabular-nums">{fmtNum(r.cancelled_tenants)}</td>
                      <td className="text-right tabular-nums">{fmtPct(pct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Cohort retention */}
      <Card title="Cohort retention (signup month → order activity)" icon={BarChart3} isLoading={cohorts.isLoading}>
        {cohorts.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Computing cohorts…
          </div>
        ) : cohorts.data && cohorts.data.cohorts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cohort data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left px-2 py-1 sticky left-0 bg-card">Cohort</th>
                  <th className="text-right px-2">Size</th>
                  {cohorts.data && Array.from({ length: cohorts.data.months + 1 }, (_, i) => (
                    <th key={i} className="text-right px-2">M{i}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohorts.data?.cohorts.map(c => (
                  <tr key={c.cohort} className="border-t border-border/50">
                    <td className="px-2 py-1 font-medium text-foreground sticky left-0 bg-card">{c.cohort}</td>
                    <td className="text-right px-2 tabular-nums">{c.size}</td>
                    {c.retention.map(r => {
                      const intensity = Math.min(1, r.pct);
                      const bg = `rgba(249, 115, 22, ${intensity * 0.6})`; // primary orange
                      return (
                        <td key={r.offset} className="text-right px-2 tabular-nums" style={{ backgroundColor: r.active > 0 ? bg : undefined }}>
                          {r.active > 0 ? `${(r.pct * 100).toFixed(0)}%` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
