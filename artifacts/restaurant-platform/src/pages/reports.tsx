import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useReports } from "@/lib/hooks";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";
import { format } from "date-fns";
import { TrendingUp, ShoppingBag, Receipt, DollarSign, Download, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RevenueByDayItem, TopItem, StaffPerformanceItem } from "@/lib/types";

const COLORS = [
  "hsl(24 95% 53%)", "hsl(142 72% 45%)", "hsl(217 91% 60%)",
  "hsl(280 65% 60%)", "hsl(348 83% 55%)",
];

type Tab = "sales" | "staff";

function exportCSV(filename: string, rows: string[][], headers: string[]) {
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [period, setPeriod] = useState("30d");
  const [tab, setTab] = useState<Tab>("sales");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  const { data: reports, isLoading } = useReports(
    useCustom && customFrom && customTo ? `custom|${customFrom}|${customTo}` : period,
    useCustom && customFrom && customTo ? { from: customFrom, to: customTo } : undefined,
  );

  function handleExportCSV() {
    if (!reports) return;
    if (tab === "sales") {
      exportCSV(
        `sales-report-${new Date().toISOString().slice(0, 10)}.csv`,
        (reports.revenueByDay ?? []).map((r: RevenueByDayItem) => [r.date, String(r.revenue), String(r.orders)]),
        ["Date", "Revenue", "Orders"],
      );
    } else {
      exportCSV(
        `staff-report-${new Date().toISOString().slice(0, 10)}.csv`,
        (reports.staffPerformance ?? []).map((s: StaffPerformanceItem) => [s.name, String(s.orderCount), s.totalRevenue, s.totalHours]),
        ["Staff Name", "Orders Handled", "Revenue Generated", "Hours Worked"],
      );
    }
  }

  function handleExportPDF() {
    window.print();
  }

  const statCards = [
    { label: "Total Revenue", value: reports ? `₹${Number(reports.totalRevenue).toLocaleString()}` : "–", icon: DollarSign, color: "bg-orange-100 text-orange-600" },
    { label: "Total Orders", value: reports?.totalOrders ?? "–", icon: ShoppingBag, color: "bg-blue-100 text-blue-600" },
    { label: "Avg Order Value", value: reports ? `₹${Number(reports.avgOrderValue).toFixed(0)}` : "–", icon: TrendingUp, color: "bg-green-100 text-green-600" },
    { label: "Tax Collected", value: reports ? `₹${Number(reports.totalTax).toFixed(0)}` : "–", icon: Receipt, color: "bg-purple-100 text-purple-600" },
  ];

  return (
    <Layout>
      <PageHeader
        title="Reports & Analytics"
        subtitle="Performance insights for your restaurant"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleExportCSV} disabled={!reports}>
              <Download className="w-4 h-4 mr-1.5" /> CSV
            </Button>
            <Button size="sm" variant="outline" onClick={handleExportPDF}>
              <Download className="w-4 h-4 mr-1.5" /> PDF
            </Button>
          </div>
        }
      />
      <div className="p-6 space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {[{ label: "7 Days", val: "7d" }, { label: "30 Days", val: "30d" }, { label: "90 Days", val: "90d" }].map(({ label, val }) => (
              <Button
                key={val}
                size="sm"
                variant={!useCustom && period === val ? "default" : "outline"}
                onClick={() => { setPeriod(val); setUseCustom(false); }}
              >
                {label}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="text-sm border border-border rounded-md px-3 py-1.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-muted-foreground text-sm">to</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="text-sm border border-border rounded-md px-3 py-1.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <Button
              size="sm"
              variant={useCustom ? "default" : "outline"}
              disabled={!customFrom || !customTo}
              onClick={() => setUseCustom(true)}
            >
              Apply
            </Button>
          </div>
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

        <div className="flex gap-1 border-b border-border">
          {([{ label: "Sales", val: "sales" as Tab }, { label: "Staff Performance", val: "staff" as Tab }]).map(({ label, val }) => (
            <button
              key={val}
              onClick={() => setTab(val)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === val ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "sales" && (
          <div className="space-y-6">
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
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => {
                    try { return format(new Date(d + "T12:00:00"), "MMM d"); } catch { return d; }
                  }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `₹${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                  <Tooltip
                    formatter={(v: number) => [`₹${Number(v).toLocaleString()}`, "Revenue"]}
                    labelFormatter={(d: string) => { try { return format(new Date(d + "T12:00:00"), "MMMM d, yyyy"); } catch { return d; } }}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(24 95% 53%)" fill="url(#repGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="font-semibold text-foreground mb-4">Orders Per Day</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={reports?.revenueByDay ?? []} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => {
                      try { return format(new Date(d + "T12:00:00"), "MMM d"); } catch { return d; }
                    }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="orders" fill="hsl(217 91% 60%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="font-semibold text-foreground mb-4">Top 5 Items</h3>
                {(reports?.topItems?.length ?? 0) > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={(reports?.topItems ?? []).slice(0, 5)}
                      layout="vertical"
                      margin={{ top: 0, right: 10, left: 80, bottom: 0 }}
                    >
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                      <Tooltip formatter={(v: number) => [v, "Orders"]} />
                      <Bar dataKey="orderCount" radius={[0, 4, 4, 0]}>
                        {(reports?.topItems ?? []).slice(0, 5).map((_: TopItem, i: number) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No data yet</div>
                )}
              </div>
            </div>

            {(reports?.revenueByDay?.length ?? 0) > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <h3 className="font-semibold text-foreground">Daily Revenue Breakdown</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Date</th>
                        <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Orders</th>
                        <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Revenue</th>
                        <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Avg Order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reports?.revenueByDay ?? []).slice().reverse().map((row: RevenueByDayItem) => (
                        <tr key={row.date} className="border-t border-border hover:bg-muted/20">
                          <td className="px-5 py-2.5 text-foreground">
                            {(() => { try { return format(new Date(row.date + "T12:00:00"), "MMM d, yyyy"); } catch { return row.date; } })()}
                          </td>
                          <td className="px-5 py-2.5 text-right text-foreground">{row.orders}</td>
                          <td className="px-5 py-2.5 text-right font-medium text-foreground">₹{Number(row.revenue).toLocaleString()}</td>
                          <td className="px-5 py-2.5 text-right text-muted-foreground">
                            {row.orders > 0 ? `₹${(Number(row.revenue) / row.orders).toFixed(0)}` : "–"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "staff" && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-semibold text-foreground">Staff Performance</h3>
            </div>
            {(reports?.staffPerformance?.length ?? 0) === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No staff data for this period</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Staff Member</th>
                      <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Orders</th>
                      <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Revenue</th>
                      <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Hours</th>
                      <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Rev/Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(reports?.staffPerformance ?? []).map((s: StaffPerformanceItem) => (
                      <tr key={s.userId} className="border-t border-border hover:bg-muted/20">
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                              {s.name[0].toUpperCase()}
                            </div>
                            <span className="font-medium text-foreground">{s.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-2.5 text-right text-foreground">{s.orderCount}</td>
                        <td className="px-5 py-2.5 text-right font-medium text-foreground">₹{Number(s.totalRevenue).toLocaleString()}</td>
                        <td className="px-5 py-2.5 text-right text-muted-foreground">{s.totalHours}h</td>
                        <td className="px-5 py-2.5 text-right text-muted-foreground">
                          {s.orderCount > 0 ? `₹${(Number(s.totalRevenue) / s.orderCount).toFixed(0)}` : "–"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
