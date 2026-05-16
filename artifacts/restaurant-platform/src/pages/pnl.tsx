import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { useBranchContext } from "@/lib/branch";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Download, FileDown, TrendingUp, TrendingDown, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Pnl = {
  from: string; to: string;
  sales: number; discounts: number; netRevenue: number;
  foodCost: number; wastage: number;
  staffCost: number; gatewayFees: number; aggregatorCommission: number;
  expensesByKind: Record<string, number>; totalExpenses: number;
  cogs: number; fixedCosts: number; variableCosts: number; marketingCosts: number; otherCosts: number;
  ebitda: number; netProfit: number;
  grossMarginPct: number; netMarginPct: number;
  breakEvenSales: number;
};
type CategoryShare = { categoryId: number | null; name: string; kind: string; amount: number; pctOfSales: number };
type Leak = { name: string; kind: string; prevPctOfSales: number; currPctOfSales: number; deltaPct: number; severity: "high" | "medium" };
type MonthlyEntry = { year: number; month: number; label: string; pnl: Pnl };
type OutletRow = Pnl & { restaurantId: number; name: string; city: string | null };
type PnlSettings = { id: number; restaurantId: number; approvalThreshold: string; fixedCostBaseline: string; leakThresholdPct: string };

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
}
function fmtPct(n: number): string { return `${(n || 0).toFixed(1)}%`; }

function rangeForPeriod(period: string): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const f = new Date(today);
  if (period === "this-month") {
    const m = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: m.toISOString().slice(0, 10), to };
  }
  if (period === "last-month") {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  f.setDate(f.getDate() - (days - 1));
  return { from: f.toISOString().slice(0, 10), to };
}

function exportCSV(filename: string, rows: string[][], headers: string[]) {
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportPDF(title: string, html: string) {
  // Lightweight printable view — opens a new tab with print dialog. The
  // user picks "Save as PDF" from their browser. Avoids pulling in a PDF
  // library and works everywhere.
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px; color: #111; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      h2 { font-size: 14px; margin: 24px 0 8px; color: #444; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: left; }
      th { background: #f5f5f5; font-weight: 600; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      .pos { color: #15803d; }
      .neg { color: #b91c1c; }
    </style></head><body>${html}<script>window.print();</script></body></html>`);
  w.document.close();
}

export default function PnlPage() {
  const restaurantId = useRestaurantId();
  const { user } = useAuth();
  const { tenantId, hasMultipleBranches, branches, selectedBranchId, setSelectedBranchId, isAllBranches } = useBranchContext();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isOwner = user?.role === "owner" || user?.isSuperAdmin;

  const [period, setPeriod] = useState<string>("this-month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const useCustom = period === "custom" && !!customFrom && !!customTo;

  const { from, to } = useMemo(() => useCustom ? { from: customFrom, to: customTo } : rangeForPeriod(period), [period, customFrom, customTo, useCustom]);
  const qs = `?from=${from}&to=${to}`;

  const { data: pnl, isLoading: pnlLoading, error: pnlErr } = useQuery({
    queryKey: ["pnl", restaurantId, from, to],
    queryFn: () => apiGet<Pnl>(`/restaurants/${restaurantId}/pnl${qs}`),
  });
  const { data: cats } = useQuery({
    queryKey: ["pnl-cats", restaurantId, from, to],
    queryFn: () => apiGet<{ categories: CategoryShare[] }>(`/restaurants/${restaurantId}/pnl/categories${qs}`),
  });
  const { data: leaks } = useQuery({
    queryKey: ["pnl-leaks", restaurantId, from, to],
    queryFn: () => apiGet<{ thresholdPct: number; leaks: Leak[] }>(`/restaurants/${restaurantId}/pnl/leaks${qs}`),
  });
  const { data: monthly } = useQuery({
    queryKey: ["pnl-monthly", restaurantId, to],
    queryFn: () => apiGet<{ months: MonthlyEntry[] }>(`/restaurants/${restaurantId}/pnl/monthly?to=${to}&months=6`),
  });
  const { data: outletData } = useQuery({
    queryKey: ["pnl-outlets", tenantId, from, to],
    queryFn: () => apiGet<{ outlets: OutletRow[] }>(`/tenants/${tenantId}/pnl/outlets${qs}`),
    enabled: !!tenantId && hasMultipleBranches,
  });

  const { data: settings } = useQuery({
    queryKey: ["pnl-settings", restaurantId],
    queryFn: () => apiGet<PnlSettings>(`/restaurants/${restaurantId}/pnl/settings`),
  });
  const updateSettings = useMutation({
    mutationFn: (body: Partial<{ approvalThreshold: number; fixedCostBaseline: number; leakThresholdPct: number }>) =>
      apiPut(`/restaurants/${restaurantId}/pnl/settings`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pnl-settings", restaurantId] }); toast({ title: "Settings saved" }); },
    onError: (e: Error) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const [thresholdInput, setThresholdInput] = useState("");
  const [baselineInput, setBaselineInput] = useState("");
  const [leakInput, setLeakInput] = useState("");

  const planLocked = useMemo(() => {
    const m = pnlErr instanceof Error ? pnlErr.message : "";
    return /smart_pnl|plan/i.test(m) || /403/.test(m);
  }, [pnlErr]);

  const handleExportCSV = () => {
    if (!pnl) return;
    const rows: string[][] = [
      ["Sales", String(pnl.sales)],
      ["Discounts", String(pnl.discounts)],
      ["Net Revenue", String(pnl.netRevenue)],
      ["Food cost (inventory)", String(pnl.foodCost - pnl.wastage)],
      ["Wastage", String(pnl.wastage)],
      ["Staff cost (payroll)", String(pnl.staffCost)],
      ["Aggregator commission", String(pnl.aggregatorCommission)],
      ["Payment gateway fees", String(pnl.gatewayFees)],
      ["Fixed expenses", String(pnl.fixedCosts)],
      ["Variable expenses", String(pnl.variableCosts)],
      ["Marketing expenses", String(pnl.marketingCosts)],
      ["Other expenses", String(pnl.otherCosts)],
      ["EBITDA", String(pnl.ebitda)],
      ["Net Profit", String(pnl.netProfit)],
      ["Gross margin %", pnl.grossMarginPct.toFixed(2)],
      ["Net margin %", pnl.netMarginPct.toFixed(2)],
      ["Break-even sales", String(Math.round(pnl.breakEvenSales))],
    ];
    exportCSV(`pnl-${from}-to-${to}.csv`, rows, ["Line item", "Amount (INR)"]);
  };
  const handleExportPDF = () => {
    if (!pnl) return;
    const lines: Array<[string, number, string?]> = [
      ["Sales", pnl.sales],
      ["Discounts", -pnl.discounts],
      ["Net Revenue", pnl.netRevenue, "bold"],
      ["Food cost (inventory)", -(pnl.foodCost - pnl.wastage)],
      ["Wastage", -pnl.wastage],
      ["Staff cost", -pnl.staffCost],
      ["Aggregator commission", -pnl.aggregatorCommission],
      ["Gateway fees", -pnl.gatewayFees],
      ["Fixed expenses", -pnl.fixedCosts],
      ["Variable expenses", -pnl.variableCosts],
      ["Marketing", -pnl.marketingCosts],
      ["Other expenses", -pnl.otherCosts],
      ["Net Profit", pnl.netProfit, "bold"],
    ];
    const tbl = lines.map(([k, v, s]) =>
      `<tr${s === "bold" ? ' style="font-weight:600;background:#f9fafb"' : ""}><td>${k}</td><td class="num ${v >= 0 ? "pos" : "neg"}">${fmtMoney(v)}</td></tr>`).join("");
    const html = `<h1>Profit &amp; Loss Statement</h1>
      <div style="color:#666;font-size:13px;margin-bottom:16px">${from} &nbsp;→&nbsp; ${to}</div>
      <table><thead><tr><th>Line item</th><th class="num">Amount</th></tr></thead><tbody>${tbl}</tbody></table>
      <h2>Margins</h2>
      <table><tbody>
        <tr><td>Gross margin</td><td class="num">${fmtPct(pnl.grossMarginPct)}</td></tr>
        <tr><td>Net margin</td><td class="num">${fmtPct(pnl.netMarginPct)}</td></tr>
        <tr><td>Break-even sales</td><td class="num">${fmtMoney(pnl.breakEvenSales)}</td></tr>
      </tbody></table>`;
    exportPDF(`P&L ${from} to ${to}`, html);
  };

  return (
    <Layout>
      <PageHeader
        title="P&amp;L Dashboard"
        subtitle="Unified profit-and-loss across sales, food cost, payroll, commissions and expenses."
        actions={
          <>
            {hasMultipleBranches && (
              <Select value={selectedBranchId == null ? "all" : String(selectedBranchId)} onValueChange={(v) => setSelectedBranchId(v === "all" ? null : Number(v))}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All outlets</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="this-month">This month</SelectItem>
                <SelectItem value="last-month">Last month</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="custom">Custom…</SelectItem>
              </SelectContent>
            </Select>
            {period === "custom" && (
              <>
                <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="w-[150px]" />
                <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="w-[150px]" />
              </>
            )}
            <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!pnl}><Download className="w-4 h-4 mr-1" />CSV</Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!pnl}><FileDown className="w-4 h-4 mr-1" />PDF</Button>
          </>
        }
      />

      <div className="p-6 space-y-6">
        {planLocked && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
              <div>
                <div className="font-semibold">Smart P&amp;L Dashboard requires a plan upgrade.</div>
                <div className="text-sm text-muted-foreground">Ask your tenant owner to enable the <code>smart_pnl</code> feature on the active plan.</div>
              </div>
            </CardContent>
          </Card>
        )}

        {pnlLoading && <div className="text-muted-foreground">Loading…</div>}

        {pnl && (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard label="Net revenue" value={fmtMoney(pnl.netRevenue)} sub={`${fmtMoney(pnl.sales)} gross`} />
              <KpiCard label="Total costs" value={fmtMoney(pnl.cogs + pnl.staffCost + pnl.aggregatorCommission + pnl.gatewayFees + pnl.totalExpenses - pnl.expensesByKind.cogs)} sub={`${fmtPct(100 - pnl.netMarginPct)} of sales`} />
              <KpiCard
                label="Net profit"
                value={fmtMoney(pnl.netProfit)}
                sub={fmtPct(pnl.netMarginPct)}
                tone={pnl.netProfit >= 0 ? "good" : "bad"}
              />
              <KpiCard label="Break-even sales" value={fmtMoney(pnl.breakEvenSales)} sub={pnl.netRevenue >= pnl.breakEvenSales ? "Above break-even" : "Below break-even"} tone={pnl.netRevenue >= pnl.breakEvenSales ? "good" : "bad"} />
            </div>

            <Tabs defaultValue="statement" className="space-y-4">
              <TabsList>
                <TabsTrigger value="statement">Statement</TabsTrigger>
                <TabsTrigger value="categories">By category</TabsTrigger>
                <TabsTrigger value="leaks">Profit leaks</TabsTrigger>
                <TabsTrigger value="monthly">Monthly trend</TabsTrigger>
                {hasMultipleBranches && <TabsTrigger value="outlets">By outlet</TabsTrigger>}
                <TabsTrigger value="settings"><SettingsIcon className="w-3.5 h-3.5 mr-1" />Settings</TabsTrigger>
              </TabsList>

              <TabsContent value="statement">
                <Card>
                  <CardHeader><CardTitle>Profit &amp; Loss statement</CardTitle></CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <tbody>
                        <Row label="Sales" value={pnl.sales} />
                        <Row label="Discounts" value={-pnl.discounts} />
                        <Row label="Net revenue" value={pnl.netRevenue} bold border />
                        <Row label="Food cost (inventory)" value={-(pnl.foodCost - pnl.wastage)} />
                        <Row label="Wastage" value={-pnl.wastage} />
                        <Row label="COGS expenses" value={-pnl.expensesByKind.cogs} />
                        <Row label="Staff cost (payroll)" value={-pnl.staffCost} />
                        <Row label="Aggregator commission" value={-pnl.aggregatorCommission} />
                        <Row label="Payment gateway fees" value={-pnl.gatewayFees} />
                        <Row label="Gross profit" value={pnl.netRevenue - pnl.cogs - pnl.staffCost - pnl.aggregatorCommission - pnl.gatewayFees} bold border />
                        <Row label="Fixed expenses (rent, etc.)" value={-pnl.fixedCosts} />
                        <Row label="Variable expenses" value={-pnl.variableCosts} />
                        <Row label="Marketing" value={-pnl.marketingCosts} />
                        <Row label="Other expenses" value={-pnl.otherCosts} />
                        <Row label="Net profit (EBITDA)" value={pnl.netProfit} bold border highlight />
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="categories">
                <Card>
                  <CardHeader><CardTitle>Cost share by category</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-muted-foreground">
                        <tr><th className="py-2">Category</th><th>Type</th><th className="text-right">Amount</th><th className="text-right">% of sales</th></tr>
                      </thead>
                      <tbody>
                        {(cats?.categories ?? []).map((c, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="py-2">{c.name}</td>
                            <td><Badge variant="outline" className="capitalize">{c.kind}</Badge></td>
                            <td className="text-right tabular-nums">{fmtMoney(c.amount)}</td>
                            <td className="text-right tabular-nums">{fmtPct(c.pctOfSales)}</td>
                          </tr>
                        ))}
                        {(!cats?.categories || cats.categories.length === 0) && (
                          <tr><td colSpan={4} className="py-4 text-muted-foreground text-center">No costs in this period.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="leaks">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" />Profit leak detector</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground mb-3">
                      Alerts when a category's share of sales jumps materially vs the previous equal-length period.
                      Threshold: <strong>{fmtPct(leaks?.thresholdPct ?? 25)}</strong>.
                    </div>
                    {(!leaks?.leaks || leaks.leaks.length === 0) ? (
                      <div className="text-sm text-muted-foreground">No leaks detected — costs are stable vs the prior period.</div>
                    ) : (
                      <ul className="space-y-2">
                        {leaks.leaks.map((l, i) => (
                          <li key={i} className={cn("p-3 rounded border flex items-center justify-between gap-4",
                            l.severity === "high" ? "border-red-300 bg-red-50 dark:bg-red-950/30" : "border-amber-300 bg-amber-50 dark:bg-amber-950/30")}>
                            <div>
                              <div className="font-semibold">{l.name}</div>
                              <div className="text-xs text-muted-foreground capitalize">{l.kind}</div>
                            </div>
                            <div className="text-right text-sm">
                              <div>{fmtPct(l.prevPctOfSales)} → <strong>{fmtPct(l.currPctOfSales)}</strong></div>
                              <div className="text-red-700 dark:text-red-400 flex items-center gap-1 justify-end"><TrendingUp className="w-3 h-3" />+{l.deltaPct.toFixed(1)} pts</div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="monthly">
                <Card>
                  <CardHeader><CardTitle>6-month rolling trend</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-muted-foreground">
                        <tr>
                          <th className="py-2">Month</th>
                          <th className="text-right">Net revenue</th>
                          <th className="text-right">Costs</th>
                          <th className="text-right">Net profit</th>
                          <th className="text-right">Margin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(monthly?.months ?? []).map((m, i, arr) => {
                          const prev = i > 0 ? arr[i - 1].pnl.netProfit : null;
                          const trend = prev != null && m.pnl.netProfit < prev;
                          const costs = m.pnl.netRevenue - m.pnl.netProfit;
                          return (
                            <tr key={i} className="border-t border-border">
                              <td className="py-2 font-medium">{m.label}</td>
                              <td className="text-right tabular-nums">{fmtMoney(m.pnl.netRevenue)}</td>
                              <td className="text-right tabular-nums">{fmtMoney(costs)}</td>
                              <td className={cn("text-right tabular-nums", m.pnl.netProfit >= 0 ? "text-emerald-600" : "text-red-600")}>{fmtMoney(m.pnl.netProfit)}</td>
                              <td className="text-right tabular-nums">
                                <span className="inline-flex items-center gap-1">
                                  {trend ? <TrendingDown className="w-3 h-3 text-red-500" /> : <TrendingUp className="w-3 h-3 text-emerald-500" />}
                                  {fmtPct(m.pnl.netMarginPct)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              {hasMultipleBranches && (
                <TabsContent value="outlets">
                  <Card>
                    <CardHeader>
                      <CardTitle>Outlet-wise P&amp;L</CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-left text-muted-foreground">
                          <tr>
                            <th className="py-2">Outlet</th>
                            <th>City</th>
                            <th className="text-right">Net revenue</th>
                            <th className="text-right">Food cost</th>
                            <th className="text-right">Staff</th>
                            <th className="text-right">Net profit</th>
                            <th className="text-right">Margin</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(outletData?.outlets ?? []).map(o => (
                            <tr key={o.restaurantId} className="border-t border-border">
                              <td className="py-2 font-medium">{o.name}</td>
                              <td className="text-muted-foreground">{o.city ?? "—"}</td>
                              <td className="text-right tabular-nums">{fmtMoney(o.netRevenue)}</td>
                              <td className="text-right tabular-nums">{fmtMoney(o.foodCost)}</td>
                              <td className="text-right tabular-nums">{fmtMoney(o.staffCost)}</td>
                              <td className={cn("text-right tabular-nums font-semibold", o.netProfit >= 0 ? "text-emerald-600" : "text-red-600")}>{fmtMoney(o.netProfit)}</td>
                              <td className="text-right tabular-nums">{fmtPct(o.netMarginPct)}</td>
                            </tr>
                          ))}
                          {(!outletData?.outlets || outletData.outlets.length === 0) && (
                            <tr><td colSpan={7} className="py-4 text-muted-foreground text-center">No outlets to compare.</td></tr>
                          )}
                        </tbody>
                      </table>
                      {outletData?.outlets && outletData.outlets.length > 0 && (
                        <div className="mt-3 text-right">
                          <Button variant="outline" size="sm" onClick={() => exportCSV(
                            `pnl-outlets-${from}-to-${to}.csv`,
                            outletData.outlets.map(o => [o.name, o.city ?? "", String(o.netRevenue), String(o.foodCost), String(o.staffCost), String(o.netProfit), o.netMarginPct.toFixed(2)]),
                            ["Outlet", "City", "Net revenue", "Food cost", "Staff cost", "Net profit", "Margin %"],
                          )}><Download className="w-3 h-3 mr-1" />Export CSV</Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              <TabsContent value="settings">
                <Card>
                  <CardHeader><CardTitle>P&amp;L &amp; Approval Settings</CardTitle></CardHeader>
                  <CardContent className="space-y-4 max-w-lg">
                    {!isOwner && <p className="text-sm text-muted-foreground">Only the owner can modify these settings.</p>}
                    <div>
                      <Label>Approval threshold (₹)</Label>
                      <Input type="number" min={0} placeholder={settings?.approvalThreshold ?? "5000"} value={thresholdInput} onChange={e => setThresholdInput(e.target.value)} disabled={!isOwner} />
                      <p className="text-xs text-muted-foreground mt-1">Expenses at or above this amount require manager approval before being counted.</p>
                    </div>
                    <div>
                      <Label>Fixed cost baseline (₹/month)</Label>
                      <Input type="number" min={0} placeholder={settings?.fixedCostBaseline ?? "0"} value={baselineInput} onChange={e => setBaselineInput(e.target.value)} disabled={!isOwner} />
                      <p className="text-xs text-muted-foreground mt-1">Used as a sanity floor when computing break-even for new outlets without recorded fixed expenses.</p>
                    </div>
                    <div>
                      <Label>Profit leak threshold (% of sales jump)</Label>
                      <Input type="number" min={0} max={100} step="0.1" placeholder={settings?.leakThresholdPct ?? "25"} value={leakInput} onChange={e => setLeakInput(e.target.value)} disabled={!isOwner} />
                      <p className="text-xs text-muted-foreground mt-1">Categories whose share of sales jumps by this many percentage points vs the prior period are flagged as high-severity leaks.</p>
                    </div>
                    {isOwner && (
                      <Button onClick={() => {
                        const body: Record<string, number> = {};
                        if (thresholdInput) body.approvalThreshold = Number(thresholdInput);
                        if (baselineInput) body.fixedCostBaseline = Number(baselineInput);
                        if (leakInput) body.leakThresholdPct = Number(leakInput);
                        if (Object.keys(body).length === 0) { toast({ title: "Nothing to update" }); return; }
                        updateSettings.mutate(body);
                      }} disabled={updateSettings.isPending}>Save</Button>
                    )}
                    {settings && (
                      <div className="text-xs text-muted-foreground pt-3 border-t border-border">
                        Current: threshold ₹{Number(settings.approvalThreshold).toLocaleString("en-IN")} •
                        baseline ₹{Number(settings.fixedCostBaseline).toLocaleString("en-IN")} •
                        leak {Number(settings.leakThresholdPct).toFixed(1)}%
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}

        {isAllBranches && hasMultipleBranches && (
          <p className="text-xs text-muted-foreground">Statement above shows the currently-selected outlet. Switch to <em>By outlet</em> tab for the full tenant view.</p>
        )}
      </div>
    </Layout>
  );
}

function KpiCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={cn("text-2xl font-bold mt-1 tabular-nums", tone === "good" && "text-emerald-600", tone === "bad" && "text-red-600")}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, bold, border, highlight }: { label: string; value: number; bold?: boolean; border?: boolean; highlight?: boolean }) {
  return (
    <tr className={cn(border && "border-t border-border", highlight && "bg-muted/40")}>
      <td className={cn("py-2", bold && "font-semibold")}>{label}</td>
      <td className={cn("py-2 text-right tabular-nums", bold && "font-semibold", value < 0 && "text-red-600", value > 0 && bold && "text-emerald-600")}>
        {fmtMoney(value)}
      </td>
    </tr>
  );
}
