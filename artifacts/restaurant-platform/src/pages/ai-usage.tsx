import { useState, useMemo } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Coins, TrendingUp, FileText, ImageIcon, Plus, Loader2, Download, ChevronLeft, ChevronRight } from "lucide-react";
import {
  useAiWallet,
  useAiRechargePackages,
  useAiUsageSummary,
  useAiTransactions,
  fetchAllAiTransactions,
} from "@/lib/aiHooks";
import { useRestaurantId } from "@/lib/hooks";
import { Link } from "wouter";
import { format } from "date-fns";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Legend } from "recharts";
import { apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const TX_TYPES = ["debit", "refund", "recharge", "monthly_allocation", "manual_credit", "manual_debit", "bonus", "expiry"];
const PAGE_SIZE = 25;

export default function AiUsagePage() {
  const [days, setDays] = useState(30);
  const restaurantId = useRestaurantId();
  const wallet = useAiWallet();
  const usage = useAiUsageSummary(days);
  const packages = useAiRechargePackages();
  const { toast } = useToast();
  const [purchasingId, setPurchasingId] = useState<number | null>(null);

  // Transaction filters (server-side)
  const [filterFeature, setFilterFeature] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const txQueryParams = useMemo(() => ({
    page,
    pageSize: PAGE_SIZE,
    feature: filterFeature === "all" ? null : filterFeature,
    type: filterType === "all" ? null : filterType,
    from: filterFrom || null,
    to: filterTo || null,
  }), [page, filterFeature, filterType, filterFrom, filterTo]);

  const tx = useAiTransactions(txQueryParams);

  // Build daily timeline grid for charts
  const dailySeries = useMemo(() => {
    const map = new Map<string, { day: string; ai_description: number; ai_food_image: number; credits: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      const key = format(d, "yyyy-MM-dd");
      map.set(key, { day: format(d, "MMM d"), ai_description: 0, ai_food_image: 0, credits: 0 });
    }
    for (const row of usage.data?.byDay ?? []) {
      const entry = map.get(row.day);
      if (entry) {
        if (row.feature === "ai_description") entry.ai_description += row.count;
        if (row.feature === "ai_food_image") entry.ai_food_image += row.count;
        entry.credits += row.credits;
      }
    }
    return Array.from(map.values());
  }, [usage.data, days]);

  const featureRows = useMemo(() => {
    const grouped = new Map<string, { feature: string; success: number; error: number; credits: number }>();
    for (const row of usage.data?.byFeature ?? []) {
      const k = row.featureSlug || "other";
      const existing = grouped.get(k) ?? { feature: k, success: 0, error: 0, credits: 0 };
      if (row.status === "success") { existing.success += row.count; existing.credits += row.creditsUsed; }
      else existing.error += row.count;
      grouped.set(k, existing);
    }
    return Array.from(grouped.values());
  }, [usage.data]);

  // Feature dropdown sourced from the (possibly truncated) wallet preview —
  // good enough for a discovery list; the actual filter applies server-side.
  const featureSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const t of wallet.data?.transactions ?? []) if (t.featureSlug) set.add(t.featureSlug);
    for (const t of tx.data?.data ?? []) if (t.featureSlug) set.add(t.featureSlug);
    return Array.from(set);
  }, [wallet.data?.transactions, tx.data?.data]);

  const totalRows = tx.data?.total ?? 0;
  const totalPages = tx.data?.totalPages ?? 1;
  const safePage = Math.min(page, totalPages || 1);
  const pagedTx = tx.data?.data ?? [];

  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }

  async function exportCsv() {
    if (!restaurantId) return;
    setExporting(true);
    try {
      const rows = await fetchAllAiTransactions(restaurantId, {
        feature: txQueryParams.feature,
        type: txQueryParams.type,
        from: txQueryParams.from,
        to: txQueryParams.to,
      });
      if (rows.length === 0) {
        toast({ title: "Nothing to export", description: "No transactions match the current filters." });
        return;
      }
      const header = ["Date", "Type", "Feature", "Bucket", "Credits", "Balance after", "Notes"];
      const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [header.join(",")];
      for (const t of rows) {
        lines.push([
          format(new Date(t.createdAt), "yyyy-MM-dd HH:mm:ss"),
          t.type,
          t.featureSlug ?? "",
          t.bucket ?? "",
          t.credits,
          t.balanceAfter,
          t.notes ?? "",
        ].map(escape).join(","));
      }
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-credit-transactions-${format(new Date(), "yyyyMMdd-HHmm")}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Exported", description: `${rows.length} row(s) downloaded.` });
    } catch (err) {
      toast({ title: "Export failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  async function handleRecharge(pkgId: number) {
    setPurchasingId(pkgId);
    try {
      await apiPost(`/ai/recharge/mock`, { packageId: pkgId });
      await Promise.all([wallet.refetch(), usage.refetch(), tx.refetch()]);
      toast({ title: "Credits added", description: "Your wallet has been topped up." });
    } catch (err) {
      toast({
        title: "Recharge unavailable",
        description: (err as Error).message ?? "Please contact support to add credits.",
        variant: "destructive",
      });
    } finally {
      setPurchasingId(null);
    }
  }

  return (
    <Layout>
      <PageHeader
        title="AI Usage & Credits"
        subtitle="Track your Khana AI spend and recharge when needed."
        actions={
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <div className="p-6 space-y-6">
        {/* Wallet header */}
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 p-6 text-white">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-white/80 text-xs uppercase tracking-wide font-semibold">
                  <Sparkles className="w-3.5 h-3.5" /> Khana AI Wallet
                </div>
                {wallet.isLoading ? (
                  <Skeleton className="h-12 w-32 bg-white/20 mt-2" />
                ) : (
                  <p className="text-5xl font-bold mt-1.5">{(wallet.data?.balance ?? 0).toLocaleString()}<span className="text-xl font-medium text-white/80 ml-2">credits</span></p>
                )}
                <p className="text-sm text-white/80 mt-1">
                  {wallet.data ? <>Reserved {wallet.data.reservedCredits} · Lifetime used {wallet.data.lifetimeCreditsUsed}</> : ""}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center text-xs">
                <Mini label="Monthly" value={wallet.data?.monthlyBalance ?? 0} />
                <Mini label="Top-up" value={wallet.data?.purchasedBalance ?? 0} />
                <Mini label="Bonus" value={wallet.data?.bonusBalance ?? 0} />
              </div>
            </div>
          </div>
        </Card>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Generations over time</CardTitle></CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailySeries} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gd" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gi" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ec4899" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#ec4899" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="day" fontSize={11} tickMargin={6} interval="preserveStartEnd" />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="ai_description" name="Descriptions" stroke="#8b5cf6" fill="url(#gd)" strokeWidth={2} />
                  <Area type="monotone" dataKey="ai_food_image" name="Images" stroke="#ec4899" fill="url(#gi)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Coins className="w-4 h-4" /> Credits spent per day</CardTitle></CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailySeries} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="day" fontSize={11} tickMargin={6} interval="preserveStartEnd" />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="credits" name="Credits" fill="#a855f7" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Per-feature breakdown */}
        <Card>
          <CardHeader><CardTitle className="text-base">Breakdown by feature</CardTitle></CardHeader>
          <CardContent>
            {featureRows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No usage in this window.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {featureRows.map((r) => (
                  <div key={r.feature} className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-semibold capitalize">{r.feature.replace(/_/g, " ")}</p>
                      {r.feature === "ai_food_image" ? <ImageIcon className="w-4 h-4 text-muted-foreground" /> : <FileText className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    <p className="text-2xl font-bold">{r.success.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{r.credits} credits used{r.error > 0 ? ` · ${r.error} failed` : ""}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recharge packages */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><Plus className="w-4 h-4" /> Recharge credits</CardTitle>
              <Link href="/subscription" className="text-xs text-muted-foreground hover:text-foreground">Manage plan →</Link>
            </div>
          </CardHeader>
          <CardContent>
            {packages.isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}</div>
            ) : !packages.data?.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">No recharge packages available right now.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {packages.data.filter((p) => p.isActive && p.showToRestaurants).map((p) => (
                  <div key={p.id} className={`rounded-lg border p-4 ${p.isFeatured ? "border-violet-400 bg-violet-50/50 dark:bg-violet-950/20" : "border-border"}`}>
                    {p.isFeatured && <Badge className="mb-2 bg-violet-500">Best value</Badge>}
                    <p className="font-semibold text-sm">{p.name}</p>
                    {p.description && <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>}
                    <div className="my-3 flex items-baseline gap-1">
                      <span className="text-2xl font-bold">{p.credits.toLocaleString()}</span>
                      <span className="text-xs text-muted-foreground">credits{p.bonusCredits > 0 ? ` + ${p.bonusCredits} bonus` : ""}</span>
                    </div>
                    <p className="text-sm font-medium">₹{Number(p.price).toLocaleString()}</p>
                    <Button
                      className="w-full mt-3"
                      size="sm"
                      onClick={() => handleRecharge(p.id)}
                      disabled={purchasingId === p.id}
                    >
                      {purchasingId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Coins className="w-3.5 h-3.5 mr-1.5" />}
                      Recharge
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Transactions: server-side pagination + filters + full-history CSV export */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Transactions
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{totalRows.toLocaleString()} total</span>
                </CardTitle>
                <Button size="sm" variant="outline" onClick={exportCsv} disabled={exporting || totalRows === 0} className="gap-1.5">
                  {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  {exporting ? "Exporting…" : "Export CSV"}
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wide">Feature</label>
                  <Select value={filterFeature} onValueChange={resetPage(setFilterFeature)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All features</SelectItem>
                      {featureSlugs.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wide">Type</label>
                  <Select value={filterType} onValueChange={resetPage(setFilterType)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {TX_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wide">From</label>
                  <Input type="date" value={filterFrom} onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }} className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wide">To</label>
                  <Input type="date" value={filterTo} onChange={(e) => { setFilterTo(e.target.value); setPage(1); }} className="h-8 text-xs" />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {tx.isLoading ? (
              <div className="p-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : pagedTx.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {totalRows === 0 ? "No transactions match the current filters." : "No transactions on this page."}
              </p>
            ) : (
              <>
                <ul className="divide-y divide-border">
                  {pagedTx.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className={`w-2 h-2 rounded-full ${t.credits >= 0 ? "bg-emerald-500" : "bg-rose-500"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate capitalize">{t.type.replace(/_/g, " ")} {t.featureSlug ? <span className="text-muted-foreground">· {t.featureSlug.replace(/_/g, " ")}</span> : null}</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(t.createdAt), "PP p")}{t.notes ? ` · ${t.notes}` : ""}</p>
                      </div>
                      <span className={`font-mono text-sm ${t.credits >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {t.credits >= 0 ? "+" : ""}{t.credits}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">→ {t.balanceAfter}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between px-4 py-2 border-t border-border text-xs text-muted-foreground">
                  <span>
                    Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, totalRows)} of {totalRows.toLocaleString()}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="h-7 w-7 p-0">
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <span className="px-2 tabular-nums">{safePage} / {totalPages}</span>
                    <Button size="sm" variant="ghost" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="h-7 w-7 p-0">
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white/15 backdrop-blur rounded-lg px-3 py-2 min-w-[80px]">
      <p className="text-white/80 uppercase tracking-wide text-[10px] font-semibold">{label}</p>
      <p className="font-bold text-lg leading-tight">{value.toLocaleString()}</p>
    </div>
  );
}
