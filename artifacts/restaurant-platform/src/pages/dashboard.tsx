import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useDashboardSummary, useRevenueTrend, usePopularItems, useLiveKitchen, useStaffActivity, useRestaurantId } from "@/lib/hooks";
import { useSocket } from "@/lib/realtime";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown, ShoppingBag, Table2, ChefHat, DollarSign, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import type { DashboardSummary, KitchenTicket, AuditLogEntry, PopularItem, RevenueTrendItem } from "@/lib/types";

function StatCard({ title, value, subtitle, icon: Icon, trend, trendValue, color = "orange" }: {
  title: string; value: string | number; subtitle?: string; icon: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down"; trendValue?: string; color?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center",
          color === "orange" ? "bg-orange-100 text-orange-600" :
          color === "green" ? "bg-green-100 text-green-600" :
          color === "blue" ? "bg-blue-100 text-blue-600" :
          "bg-purple-100 text-purple-600"
        )}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      {trend && trendValue && (
        <div className={cn("flex items-center gap-1 mt-3 text-xs font-medium", trend === "up" ? "text-green-600" : "text-red-500")}>
          {trend === "up" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {trendValue}% vs yesterday
        </div>
      )}
    </div>
  );
}

function KitchenStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    new: "bg-blue-100 text-blue-700",
    preparing: "bg-yellow-100 text-yellow-700",
    ready: "bg-green-100 text-green-700",
    served: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", colors[status] ?? "bg-gray-100 text-gray-600")}>
      {status}
    </span>
  );
}

const TREND_PERIODS = [
  { label: "Daily (7d)", val: "7d", groupBy: "daily" },
  { label: "Weekly (30d)", val: "30d", groupBy: "weekly" },
  { label: "Monthly (90d)", val: "90d", groupBy: "monthly" },
];

export default function DashboardPage() {
  const restaurantId = useRestaurantId();
  const [trendPeriod, setTrendPeriod] = useState("7d");
  const trendGroupBy = TREND_PERIODS.find(p => p.val === trendPeriod)?.groupBy ?? "daily";

  useSocket(restaurantId);

  const { data: summary } = useDashboardSummary();
  const { data: trendData = [] } = useRevenueTrend(trendPeriod, trendGroupBy);
  const { data: popularItems = [] } = usePopularItems(6);
  const { data: kitchenData } = useLiveKitchen();
  const { data: activityData = [] } = useStaffActivity();

  const s = summary as DashboardSummary | undefined;

  return (
    <Layout>
      <PageHeader
        title="Dashboard"
        subtitle={`${format(new Date(), "EEEE, MMMM d")} · Live overview`}
      />

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Today's Revenue"
            value={s ? `₹${Number(s.todayRevenue).toLocaleString()}` : "–"}
            icon={DollarSign}
            trend={Number(s?.revenueGrowth) >= 0 ? "up" : "down"}
            trendValue={s?.revenueGrowth}
            color="orange"
          />
          <StatCard
            title="Today's Orders"
            value={s?.todayOrders ?? "–"}
            subtitle={`Avg ₹${s?.avgOrderValue ?? "0"}`}
            icon={ShoppingBag}
            trend={Number(s?.ordersGrowth) >= 0 ? "up" : "down"}
            trendValue={s?.ordersGrowth}
            color="blue"
          />
          <StatCard
            title="Active Tables"
            value={s ? `${s.activeTables}/${s.totalTables}` : "–"}
            subtitle="tables occupied"
            icon={Table2}
            color="green"
          />
          <StatCard
            title="Kitchen Queue"
            value={s?.pendingTickets ?? "–"}
            subtitle={(s?.lowStockAlerts ?? 0) > 0 ? `${s!.lowStockAlerts} low stock alerts` : "All stock good"}
            icon={ChefHat}
            color="purple"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">Revenue Trend</h3>
              <div className="flex gap-1">
                {TREND_PERIODS.map(({ label, val }) => (
                  <Button
                    key={val}
                    size="sm"
                    variant={trendPeriod === val ? "default" : "outline"}
                    className="h-7 text-xs px-3"
                    onClick={() => setTrendPeriod(val)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trendData as RevenueTrendItem[]} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(24 95% 53%)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(24 95% 53%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => {
                  try {
                    if (trendGroupBy === "monthly") return format(new Date(d + "-01T12:00:00"), "MMM yyyy");
                    if (trendGroupBy === "weekly") return `Wk ${format(new Date(d + "T12:00:00"), "MMM d")}`;
                    return format(new Date(d + "T12:00:00"), "EEE MMM d");
                  } catch { return d; }
                }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `₹${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                <Tooltip
                  formatter={(v: number) => [`₹${Number(v).toLocaleString()}`, "Revenue"]}
                  labelFormatter={(d: string) => {
                    try {
                      if (trendGroupBy === "monthly") return format(new Date(d + "-01T12:00:00"), "MMMM yyyy");
                      if (trendGroupBy === "weekly") return `Week of ${format(new Date(d + "T12:00:00"), "MMMM d, yyyy")}`;
                      return format(new Date(d + "T12:00:00"), "EEEE, MMMM d, yyyy");
                    } catch { return d; }
                  }}
                />
                <Area type="monotone" dataKey="revenue" stroke="hsl(24 95% 53%)" fill="url(#revGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-4">Top Items (30d)</h3>
            <div className="space-y-3">
              {(popularItems as PopularItem[]).slice(0, 5).map((item, i) => {
                const maxRevenue = Math.max(...(popularItems as PopularItem[]).map(p => Number(p.revenue)));
                const pct = maxRevenue > 0 ? (Number(item.revenue) / maxRevenue) * 100 : 0;
                return (
                  <div key={item.menuItemId} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-muted-foreground w-4 flex-shrink-0">{i + 1}</span>
                        <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                      </div>
                      <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">{item.orderCount} orders</span>
                    </div>
                    <div className="pl-6">
                      <div className="bg-muted rounded-full h-1.5">
                        <div className="bg-primary h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
              {(popularItems as PopularItem[]).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">Live Kitchen</h3>
              <div className="flex gap-3 text-xs">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" />New: {kitchenData?.newCount ?? 0}</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-500" />Prep: {kitchenData?.preparingCount ?? 0}</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" />Ready: {kitchenData?.readyCount ?? 0}</span>
              </div>
            </div>
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {((kitchenData?.tickets ?? []) as KitchenTicket[]).slice(0, 8).map((t) => (
                <div key={t.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-2">
                    {t.isPriority && <AlertTriangle className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />}
                    <div>
                      <p className="text-sm font-medium text-foreground">{t.orderNumber}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.tableNumber ? `Table ${t.tableNumber}` : t.orderType} · {t.items?.length ?? 0} items
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <KitchenStatusBadge status={t.status} />
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(t.createdAt), "h:mm a")}
                    </span>
                  </div>
                </div>
              ))}
              {(kitchenData?.tickets?.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">Kitchen is clear!</p>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-4">Recent Activity</h3>
            <div className="space-y-3 max-h-52 overflow-y-auto">
              {(activityData as AuditLogEntry[]).slice(0, 8).map((a) => (
                <div key={a.id} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0 mt-0.5">
                    {(a.userName ?? "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">
                      <span className="font-medium">{a.userName ?? "System"}</span>{" "}
                      <span className="text-muted-foreground">{a.action} {a.entity}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{format(new Date(a.createdAt), "h:mm a")}</p>
                  </div>
                </div>
              ))}
              {(activityData as AuditLogEntry[]).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">No activity yet</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
