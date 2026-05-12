import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useReports } from "@/lib/hooks";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";
import { format } from "date-fns";
import { TrendingUp, ShoppingBag, Receipt, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RevenueByDayItem, TopItem } from "@/lib/types";

const COLORS = ["hsl(24 95% 53%)", "hsl(142 72% 45%)", "hsl(217 91% 60%)", "hsl(280 65% 60%)", "hsl(348 83% 55%)"];

export default function ReportsPage() {
  const [period, setPeriod] = useState("7d");
  const { data: reports, isLoading } = useReports(period);

  const statCards = [
    { label: "Total Revenue", value: reports ? `₹${Number(reports.totalRevenue).toLocaleString()}` : "–", icon: DollarSign, color: "bg-orange-100 text-orange-600" },
    { label: "Total Orders", value: reports?.totalOrders ?? "–", icon: ShoppingBag, color: "bg-blue-100 text-blue-600" },
    { label: "Avg Order Value", value: reports ? `₹${Number(reports.avgOrderValue).toFixed(0)}` : "–", icon: TrendingUp, color: "bg-green-100 text-green-600" },
    { label: "Total Tax Collected", value: reports ? `₹${Number(reports.totalTax).toFixed(0)}` : "–", icon: Receipt, color: "bg-purple-100 text-purple-600" },
  ];

  return (
    <Layout>
      <PageHeader title="Reports & Analytics" subtitle="Performance insights for your restaurant" />
      <div className="p-6 space-y-6">
        <div className="flex gap-2">
          {[{ label: "7 Days", val: "7d" }, { label: "30 Days", val: "30d" }, { label: "90 Days", val: "90d" }].map(({ label, val }) => (
            <Button key={val} size="sm" variant={period === val ? "default" : "outline"} onClick={() => setPeriod(val)}>{label}</Button>
          ))}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">{label}</p>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground">{isLoading ? "–" : value}</p>
            </div>
          ))}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Revenue Over Time</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={reports?.revenueByDay ?? []} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="repGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(24 95% 53%)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="hsl(24 95% 53%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => { try { return format(new Date(d), "MMM d"); } catch { return d; } }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `₹${v}`} />
              <Tooltip formatter={(v: number) => [`₹${v}`, "Revenue"]} />
              <Area type="monotone" dataKey="revenue" stroke="hsl(24 95% 53%)" fill="url(#repGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-4">Orders Per Day</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={reports?.revenueByDay ?? []} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => { try { return format(new Date(d), "MMM d"); } catch { return d; } }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="orders" fill="hsl(217 91% 60%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-4">Top 5 Items</h3>
            {(reports?.topItems?.length ?? 0) > 0 ? (
              <BarChart width={300} height={200} data={(reports?.topItems ?? []).slice(0, 5)} layout="vertical" margin={{ top: 0, right: 10, left: 80, bottom: 0 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                <Tooltip formatter={(v: number) => [v, "Orders"]} />
                <Bar dataKey="orderCount" radius={[0, 4, 4, 0]}>
                  {(reports?.topItems ?? []).slice(0, 5).map((_: TopItem, i: number) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No data yet</div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
