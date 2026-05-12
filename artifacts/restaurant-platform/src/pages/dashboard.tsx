import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useDashboardSummary, useRevenueTrend, usePopularItems, useLiveKitchen, useStaffActivity } from "@/lib/hooks";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { TrendingUp, TrendingDown, ShoppingBag, Table2, ChefHat, DollarSign, AlertTriangle, Bell, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

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
        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", color === "orange" ? "bg-orange-100 text-orange-600" : color === "green" ? "bg-green-100 text-green-600" : color === "blue" ? "bg-blue-100 text-blue-600" : "bg-purple-100 text-purple-600")}>
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

export default function DashboardPage() {
  const { data: summary, isLoading } = useDashboardSummary();
  const { data: trend } = useRevenueTrend("7d");
  const { data: popular } = usePopularItems(6);
  const { data: kitchen } = useLiveKitchen();
  const { data: activity } = useStaffActivity();

  const s = summary as any;
  const trendData = (trend as any[]) ?? [];
  const popularItems = (popular as any[]) ?? [];
  const kitchenData = kitchen as any;
  const activityData = (activity as any[]) ?? [];

  return (
    <Layout>
      <PageHeader title="Dashboard" subtitle={`${format(new Date(), "EEEE, MMMM d")} · Spice Garden, Bangalore`} />

      <div className="p-6 space-y-6">
        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Today's Revenue" value={s ? `₹${Number(s.todayRevenue).toLocaleString()}` : "–"} icon={DollarSign} trend="up" trendValue={s?.revenueGrowth} color="orange" />
          <StatCard title="Today's Orders" value={s?.todayOrders ?? "–"} subtitle={`Avg ₹${s?.avgOrderValue ?? "0"}`} icon={ShoppingBag} trend="up" trendValue={s?.ordersGrowth} color="blue" />
          <StatCard title="Active Tables" value={s ? `${s.activeTables}/${s.totalTables}` : "–"} subtitle="tables occupied" icon={Table2} color="green" />
          <StatCard title="Kitchen Queue" value={s?.pendingTickets ?? "–"} subtitle={s?.lowStockAlerts > 0 ? `${s.lowStockAlerts} low stock alerts` : "All stock good"} icon={ChefHat} color="purple" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Revenue trend */}
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-4">Revenue — Last 7 Days</h3>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(24 95% 53%)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(24 95% 53%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => format(new Date(d), "MMM d")} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${v}`} />
                <Tooltip formatter={(v: number) => [`₹${v}`, "Revenue"]} />
                <Area type="monotone" dataKey="revenue" stroke="hsl(24 95% 53%)" fill="url(#revGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Popular items */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-4">Top Items (30d)</h3>
            <div className="space-y-3">
              {popularItems.slice(0, 5).map((item: any, i: number) => (
                <div key={item.menuItemId} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-muted-foreground w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.orderCount} orders</p>
                  </div>
                  <p className="text-sm font-semibold text-foreground">₹{Number(item.revenue).toFixed(0)}</p>
                </div>
              ))}
              {popularItems.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Live kitchen */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">Live Kitchen</h3>
              <div className="flex gap-3 text-xs">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> New: {kitchenData?.newCount ?? 0}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" /> Prep: {kitchenData?.preparingCount ?? 0}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Ready: {kitchenData?.readyCount ?? 0}</span>
              </div>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {(kitchenData?.tickets ?? []).slice(0, 5).map((t: any) => (
                <div key={t.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-2">
                    {t.isPriority && <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />}
                    <div>
                      <p className="text-sm font-medium text-foreground">{t.orderNumber}</p>
                      <p className="text-xs text-muted-foreground">{t.tableNumber ? `Table ${t.tableNumber}` : t.orderType}</p>
                    </div>
                  </div>
                  <KitchenStatusBadge status={t.status} />
                </div>
              ))}
              {(kitchenData?.tickets?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground text-center py-4">Kitchen is clear!</p>}
            </div>
          </div>

          {/* Staff activity */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-4">Recent Activity</h3>
            <div className="space-y-3">
              {activityData.slice(0, 6).map((a: any) => (
                <div key={a.id} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0 mt-0.5">
                    {(a.userName ?? "?")[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground"><span className="font-medium">{a.userName ?? "System"}</span> {a.action} {a.entity}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(a.createdAt), "h:mm a")}</p>
                  </div>
                </div>
              ))}
              {activityData.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No activity yet</p>}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
