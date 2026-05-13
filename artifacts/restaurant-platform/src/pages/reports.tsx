import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useReports } from "@/lib/hooks";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";
import { format } from "date-fns";
import { TrendingUp, ShoppingBag, Receipt, DollarSign, Download, Users, Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RevenueByDayItem, TaxByDayItem, TopItem, StaffPerformanceItem } from "@/lib/types";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const COLORS = [
  "hsl(24 95% 53%)", "hsl(142 72% 45%)", "hsl(217 91% 60%)",
  "hsl(280 65% 60%)", "hsl(348 83% 55%)",
];

function fmtDateTick(d: string, viewMode: string): string {
  try {
    if (viewMode === "yearly") return d.slice(0, 4);
    if (viewMode === "monthly") return format(new Date(d + "-01T12:00:00"), "MMM yyyy");
    return format(new Date(d + "T12:00:00"), "MMM d");
  } catch { return d; }
}

function fmtDateLabel(d: string, viewMode: string): string {
  try {
    if (viewMode === "yearly") return d.slice(0, 4);
    if (viewMode === "monthly") return format(new Date(d + "-01T12:00:00"), "MMMM yyyy");
    return format(new Date(d + "T12:00:00"), "MMMM d, yyyy");
  } catch { return d; }
}

function fmtTableDate(d: string, viewMode: string): string {
  try {
    if (viewMode === "yearly") return d.slice(0, 4);
    if (viewMode === "monthly") return format(new Date(d + "-01T12:00:00"), "MMMM yyyy");
    return format(new Date(d + "T12:00:00"), "MMM d, yyyy");
  } catch { return d; }
}

type Tab = "sales" | "tax" | "staff";
type ViewMode = "daily" | "monthly" | "yearly";

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
  const [viewMode, setViewMode] = useState<ViewMode>("daily");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  const { data: reports, isLoading } = useReports(
    useCustom && customFrom && customTo ? `custom|${customFrom}|${customTo}` : period,
    useCustom && customFrom && customTo ? { from: customFrom, to: customTo } : undefined,
    viewMode,
  );

  function handleExportCSV() {
    if (!reports) return;
    if (tab === "sales") {
      exportCSV(
        `sales-report-${new Date().toISOString().slice(0, 10)}.csv`,
        (reports.revenueByDay ?? []).map((r: RevenueByDayItem) => [r.date, String(r.revenue), String(r.orders)]),
        ["Date", "Revenue", "Orders"],
      );
    } else if (tab === "tax") {
      exportCSV(
        `tax-report-${new Date().toISOString().slice(0, 10)}.csv`,
        (reports.taxByDay ?? []).map((r: TaxByDayItem) => [r.date, r.tax, r.revenue, String(r.orders), `${r.effectiveRate}%`]),
        ["Date", "Tax Collected", "Revenue", "Orders", "Effective Rate"],
      );
    } else {
      exportCSV(
        `staff-report-${new Date().toISOString().slice(0, 10)}.csv`,
        (reports.staffPerformance ?? []).map((s: StaffPerformanceItem) => [s.name, String(s.orderCount), s.totalRevenue, s.totalHours]),
        ["Staff Name", "Orders Handled", "Revenue Generated", "Hours Worked"],
      );
    }
  }

  function handleExportExcel() {
    if (!reports) return;
    const wb = XLSX.utils.book_new();

    const salesRows = (reports.revenueByDay ?? []).map((r: RevenueByDayItem) => ({
      Date: r.date,
      Revenue: Number(r.revenue),
      Orders: r.orders,
      "Avg Order": r.orders > 0 ? Number((Number(r.revenue) / r.orders).toFixed(2)) : 0,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salesRows), "Sales");

    const taxRows = (reports.taxByDay ?? []).map((r: TaxByDayItem) => ({
      Date: r.date,
      "Tax Collected": Number(r.tax),
      Revenue: Number(r.revenue),
      Orders: r.orders,
      "Effective Rate (%)": Number(r.effectiveRate),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(taxRows), "Tax");

    const staffRows = (reports.staffPerformance ?? []).map((s: StaffPerformanceItem) => ({
      "Staff Member": s.name,
      "Orders Handled": s.orderCount,
      "Revenue Generated": Number(s.totalRevenue),
      "Hours Worked": Number(s.totalHours),
      "Revenue / Order": s.orderCount > 0 ? Number((Number(s.totalRevenue) / s.orderCount).toFixed(2)) : 0,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(staffRows), "Staff Performance");

    const summaryRows = [
      { Metric: "Total Revenue", Value: Number(reports.totalRevenue) },
      { Metric: "Total Orders", Value: reports.totalOrders },
      { Metric: "Avg Order Value", Value: Number(reports.avgOrderValue) },
      { Metric: "Tax Collected", Value: Number(reports.totalTax) },
      { Metric: "Effective Tax Rate (%)", Value: Number(reports.effectiveTaxRate ?? 0) },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Summary");

    XLSX.writeFile(wb, `tabletrack-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function handleExportPDF() {
    if (!reports) return;
    const doc = new jsPDF();
    const dateStr = new Date().toLocaleDateString();

    doc.setFontSize(18);
    doc.text("TableTrack — Analytics Report", 14, 18);
    doc.setFontSize(10);
    doc.text(`Generated: ${dateStr}`, 14, 26);

    doc.setFontSize(13);
    doc.text("Summary", 14, 36);
    autoTable(doc, {
      startY: 40,
      head: [["Metric", "Value"]],
      body: [
        ["Total Revenue", `₹${Number(reports.totalRevenue).toLocaleString()}`],
        ["Total Orders", String(reports.totalOrders)],
        ["Avg Order Value", `₹${Number(reports.avgOrderValue).toFixed(2)}`],
        ["Tax Collected", `₹${Number(reports.totalTax).toLocaleString()}`],
        ["Effective Tax Rate", `${reports.effectiveTaxRate ?? "0.00"}%`],
      ],
    });

    const afterSummary = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 80;
    doc.setFontSize(13);
    doc.text("Daily Revenue", 14, afterSummary + 10);
    autoTable(doc, {
      startY: afterSummary + 14,
      head: [["Date", "Revenue", "Orders", "Avg Order"]],
      body: (reports.revenueByDay ?? []).map((r: RevenueByDayItem) => [
        r.date,
        `₹${Number(r.revenue).toLocaleString()}`,
        String(r.orders),
        r.orders > 0 ? `₹${(Number(r.revenue) / r.orders).toFixed(0)}` : "–",
      ]),
    });

    doc.addPage();
    doc.setFontSize(13);
    doc.text("Tax Breakdown", 14, 18);
    autoTable(doc, {
      startY: 22,
      head: [["Date", "Tax Collected", "Revenue", "Orders", "Rate"]],
      body: (reports.taxByDay ?? []).map((r: TaxByDayItem) => [
        r.date,
        `₹${Number(r.tax).toLocaleString()}`,
        `₹${Number(r.revenue).toLocaleString()}`,
        String(r.orders),
        `${r.effectiveRate}%`,
      ]),
    });

    const afterTax = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 80;
    doc.setFontSize(13);
    doc.text("Staff Performance", 14, afterTax + 10);
    autoTable(doc, {
      startY: afterTax + 14,
      head: [["Staff Member", "Orders", "Revenue", "Hours", "Rev/Order"]],
      body: (reports.staffPerformance ?? []).map((s: StaffPerformanceItem) => [
        s.name,
        String(s.orderCount),
        `₹${Number(s.totalRevenue).toLocaleString()}`,
        `${s.totalHours}h`,
        s.orderCount > 0 ? `₹${(Number(s.totalRevenue) / s.orderCount).toFixed(0)}` : "–",
      ]),
    });

    doc.save(`tabletrack-report-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  const hasExpenseAccess = reports?.totalExpenses != null;
  const netProfitNum = hasExpenseAccess ? Number(reports?.netProfit ?? 0) : 0;
  const statCards = [
    { label: "Total Revenue", value: reports ? `₹${Number(reports.totalRevenue).toLocaleString()}` : "–", icon: DollarSign, color: "bg-orange-100 text-orange-600" },
    ...(hasExpenseAccess ? [
      { label: "Total Expenses", value: `₹${Number(reports?.totalExpenses ?? 0).toLocaleString()}`, icon: Receipt, color: "bg-rose-100 text-rose-600" },
      { label: "Net Profit", value: `₹${netProfitNum.toLocaleString()}`, icon: TrendingUp, color: netProfitNum >= 0 ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600" },
    ] : []),
    { label: "Total Orders", value: reports?.totalOrders ?? "–", icon: ShoppingBag, color: "bg-blue-100 text-blue-600" },
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
            <Button size="sm" variant="outline" onClick={handleExportExcel} disabled={!reports}>
              <Download className="w-4 h-4 mr-1.5" /> Excel
            </Button>
            <Button size="sm" variant="outline" onClick={handleExportPDF} disabled={!reports}>
              <Download className="w-4 h-4 mr-1.5" /> PDF
            </Button>
          </div>
        }
      />
      <div className="p-6 space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 flex-wrap">
            {[
              { label: "7 Days", val: "7d" },
              { label: "30 Days", val: "30d" },
              { label: "90 Days", val: "90d" },
              { label: "1 Month", val: "1m" },
              { label: "1 Year", val: "1y" },
            ].map(({ label, val }) => (
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

          <div className="flex gap-1 border border-border rounded-lg p-0.5 bg-muted/30">
            {(["daily", "monthly", "yearly"] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors ${
                  viewMode === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {v}
              </button>
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

        {hasExpenseAccess && (reports?.expensesByCategory?.length ?? 0) > 0 && (
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">Expenses by Category</h3>
              <span className="text-xs text-muted-foreground">
                ₹{Number(reports?.totalExpenses ?? 0).toLocaleString()} total
              </span>
            </div>
            {(() => {
              const rows = reports?.expensesByCategory ?? [];
              const max = Math.max(...rows.map(r => Number(r.total)), 1);
              return (
                <div className="space-y-2.5">
                  {rows.map(r => {
                    const pct = (Number(r.total) / max) * 100;
                    const total = Number(reports?.totalExpenses ?? 0);
                    const share = total > 0 ? (Number(r.total) / total) * 100 : 0;
                    return (
                      <div key={r.categoryId} className="flex items-center gap-3 text-sm">
                        <div className="flex items-center gap-2 w-44 shrink-0">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />
                          <span className="text-foreground font-medium truncate">{r.categoryName}</span>
                        </div>
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: r.color }} />
                        </div>
                        <span className="text-foreground font-semibold w-24 text-right tabular-nums">
                          ₹{Number(r.total).toLocaleString("en-IN")}
                        </span>
                        <span className="text-muted-foreground w-12 text-right tabular-nums">{share.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        <div className="flex gap-1 border-b border-border">
          {([
            { label: "Sales", val: "sales" as Tab },
            { label: "Tax", val: "tax" as Tab },
            { label: "Staff Performance", val: "staff" as Tab },
          ]).map(({ label, val }) => (
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
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => fmtDateTick(d, viewMode)} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `₹${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                  <Tooltip
                    formatter={(v: number) => [`₹${Number(v).toLocaleString()}`, "Revenue"]}
                    labelFormatter={(d: string) => fmtDateLabel(d, viewMode)}
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
                            {fmtTableDate(row.date, viewMode)}
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

        {tab === "tax" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-sm text-muted-foreground mb-1">Total Tax Collected</p>
                <p className="text-2xl font-bold text-foreground">
                  {isLoading ? "–" : reports ? `₹${Number(reports.totalTax).toLocaleString()}` : "–"}
                </p>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-sm text-muted-foreground mb-1">Effective Tax Rate</p>
                <div className="flex items-baseline gap-1">
                  <p className="text-2xl font-bold text-foreground">
                    {isLoading ? "–" : reports?.effectiveTaxRate ?? "0.00"}
                  </p>
                  <span className="text-muted-foreground text-sm">%</span>
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Percent className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Tax / Revenue Ratio</p>
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {isLoading || !reports ? "–" : Number(reports.totalRevenue) > 0
                    ? `${((Number(reports.totalTax) / Number(reports.totalRevenue)) * 100).toFixed(1)}%`
                    : "0%"}
                </p>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="font-semibold text-foreground mb-4">Daily Tax Collection</h3>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={reports?.taxByDay ?? []} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="taxGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(280 65% 60%)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="hsl(280 65% 60%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => fmtDateTick(d, viewMode)} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `₹${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                  <Tooltip
                    formatter={(v: number) => [`₹${Number(v).toLocaleString()}`, "Tax"]}
                    labelFormatter={(d: string) => fmtDateLabel(d, viewMode)}
                  />
                  <Area type="monotone" dataKey="tax" stroke="hsl(280 65% 60%)" fill="url(#taxGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {(reports?.taxByDay?.length ?? 0) > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <h3 className="font-semibold text-foreground">Daily Tax Breakdown</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Date</th>
                        <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Orders</th>
                        <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Revenue</th>
                        <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Tax Collected</th>
                        <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Effective Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reports?.taxByDay ?? []).slice().reverse().map((row: TaxByDayItem) => (
                        <tr key={row.date} className="border-t border-border hover:bg-muted/20">
                          <td className="px-5 py-2.5 text-foreground">
                            {fmtTableDate(row.date, viewMode)}
                          </td>
                          <td className="px-5 py-2.5 text-right text-foreground">{row.orders}</td>
                          <td className="px-5 py-2.5 text-right text-foreground">₹{Number(row.revenue).toLocaleString()}</td>
                          <td className="px-5 py-2.5 text-right font-medium text-foreground">₹{Number(row.tax).toLocaleString()}</td>
                          <td className="px-5 py-2.5 text-right text-muted-foreground">{row.effectiveRate}%</td>
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
