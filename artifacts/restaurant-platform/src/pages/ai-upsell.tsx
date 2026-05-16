import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Loader2, Coins, Plus, Trash2, Check, X, TrendingUp, Eye, MousePointerClick, IndianRupee, Edit, Save } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useBranchContext } from "@/lib/branch";
import { useAiWallet } from "@/lib/aiHooks";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const COST = 3;
const TRIGGER_LABELS: Record<string, string> = {
  item_in_cart: "Item in cart",
  category_in_cart: "Category in cart",
  cart_total_below_threshold: "Cart total below",
  time_of_day: "Time of day",
  customer_segment: "Customer segment",
};
const TRIGGER_TYPES = Object.keys(TRIGGER_LABELS);

interface SuggestedRule {
  name: string;
  channel: "pos" | "qr" | "both";
  priority: number;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  suggestedItemIds: number[];
  message: string | null;
  rationale?: string | null;
  expectedLiftPct?: number;
  confidence?: number;
}
interface SuggestionRow { id: number; status: string; payload: { rules: SuggestedRule[] }; confidence: string | null; generatedAt: string }
interface RuleRow {
  id: number;
  name: string;
  channel: string;
  priority: number;
  isEnabled: boolean;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  suggestedItemIds: number[];
  message: string | null;
  branchId: number | null;
  source: string;
  createdAt: string;
}
interface MenuItemLite { id: number; name: string; price: string; categoryId: number | null }
interface CategoryLite { id: number; name: string }

interface RuleDraft {
  id?: number;
  name: string;
  channel: "pos" | "qr" | "both";
  priority: number;
  isEnabled: boolean;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  suggestedItemIds: number[];
  message: string | null;
  branchId: number | null;
}

const EMPTY_DRAFT: RuleDraft = {
  name: "", channel: "both", priority: 50, isEnabled: true,
  triggerType: "item_in_cart", triggerConfig: { menuItemIds: [] },
  suggestedItemIds: [], message: "", branchId: null,
};

export default function AiUpsellPage() {
  const restaurantId = useRestaurantId();
  const wallet = useAiWallet();
  const { branches } = useBranchContext();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_DRAFT);
  const [selected, setSelected] = useState<Record<number, Set<number>>>({});

  const suggestions = useQuery<{ data: SuggestionRow[] }>({
    queryKey: ["ai-upsell-suggestions", restaurantId, "active"],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/ai-ops/upsell/suggestions?status=active`),
    enabled: !!restaurantId,
  });
  const rules = useQuery<{ data: RuleRow[] }>({
    queryKey: ["ai-upsell-rules", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/ai-ops/upsell/rules`),
    enabled: !!restaurantId,
  });
  const menuItems = useQuery<{ data: MenuItemLite[] }>({
    queryKey: ["upsell-menu-items", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/menu/items`),
    enabled: !!restaurantId,
  });
  const categories = useQuery<{ data: CategoryLite[] }>({
    queryKey: ["upsell-cats", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/menu/categories`),
    enabled: !!restaurantId,
  });
  const itemsById = useMemo(() => {
    const m = new Map<number, MenuItemLite>();
    for (const i of menuItems.data?.data ?? []) m.set(i.id, i);
    return m;
  }, [menuItems.data]);

  // Performance filters
  const [days, setDays] = useState(30);
  const [chFilter, setChFilter] = useState<"all" | "pos" | "qr">("all");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const perf = useQuery<{ sinceDays: number; byRule: { ruleId: number | null; ruleName: string | null; eventType: string; count: number; revenue: string }[]; byChannel: { channel: string; eventType: string; count: number; revenue: string }[]; series: { day: string; eventType: string; count: number; revenue: string }[] }>({
    queryKey: ["ai-upsell-performance", restaurantId, days, chFilter, branchFilter],
    queryFn: () => {
      const qs = new URLSearchParams({ days: String(days) });
      if (chFilter !== "all") qs.set("channel", chFilter);
      if (branchFilter !== "all") qs.set("branchId", branchFilter);
      return apiGet(`/restaurants/${restaurantId}/ai-ops/upsell/performance?${qs}`);
    },
    enabled: !!restaurantId,
  });

  const generate = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/ai-ops/upsell/suggest`),
    onSuccess: () => {
      toast({ title: "AI suggestions generated" });
      qc.invalidateQueries({ queryKey: ["ai-upsell-suggestions", restaurantId] });
      qc.invalidateQueries({ queryKey: ["ai-wallet"] });
    },
    onError: (err: Error) => toast({ title: "Could not generate", description: err.message, variant: "destructive" }),
  });

  const acceptSuggestion = useMutation({
    mutationFn: (vars: { suggestionId: number; index: number }) =>
      apiPost(`/restaurants/${restaurantId}/ai-ops/upsell/suggestions/${vars.suggestionId}/accept`, { index: vars.index }),
    onSuccess: () => {
      toast({ title: "Rule activated" });
      qc.invalidateQueries({ queryKey: ["ai-upsell-rules", restaurantId] });
      qc.invalidateQueries({ queryKey: ["ai-upsell-suggestions", restaurantId] });
    },
  });
  const dismissBatch = useMutation({
    mutationFn: (id: number) => apiPatch(`/restaurants/${restaurantId}/ai-ops/upsell/suggestions/${id}`, { status: "dismissed" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-upsell-suggestions", restaurantId] }),
  });
  const bulkAccept = useMutation({
    mutationFn: (vars: { suggestionId: number; indices: number[] }) =>
      apiPost(`/restaurants/${restaurantId}/ai-ops/upsell/suggestions/${vars.suggestionId}/accept-bulk`, { indices: vars.indices }),
    onSuccess: (res: { created: unknown[]; skipped: number[] }, vars) => {
      toast({ title: `Activated ${res.created.length} rule(s)`, description: res.skipped.length ? `Skipped ${res.skipped.length} invalid rule(s)` : undefined });
      setSelected(s => ({ ...s, [vars.suggestionId]: new Set() }));
      qc.invalidateQueries({ queryKey: ["ai-upsell-rules", restaurantId] });
      qc.invalidateQueries({ queryKey: ["ai-upsell-suggestions", restaurantId] });
    },
  });
  const dismissOne = useMutation({
    mutationFn: (vars: { id: number; index: number }) =>
      apiPatch(`/restaurants/${restaurantId}/ai-ops/upsell/suggestions/${vars.id}`, { dismissIndex: vars.index }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-upsell-suggestions", restaurantId] }),
  });

  const saveRule = useMutation({
    mutationFn: (d: RuleDraft) => d.id
      ? apiPatch(`/restaurants/${restaurantId}/ai-ops/upsell/rules/${d.id}`, d)
      : apiPost(`/restaurants/${restaurantId}/ai-ops/upsell/rules`, { ...d, source: "manual" }),
    onSuccess: () => {
      toast({ title: draft.id ? "Rule updated" : "Rule created" });
      qc.invalidateQueries({ queryKey: ["ai-upsell-rules", restaurantId] });
      setEditorOpen(false);
    },
    onError: (err: Error) => toast({ title: "Could not save rule", description: err.message, variant: "destructive" }),
  });
  const updateRule = useMutation({
    mutationFn: (vars: { id: number; patch: Partial<RuleRow> }) =>
      apiPatch(`/restaurants/${restaurantId}/ai-ops/upsell/rules/${vars.id}`, vars.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-upsell-rules", restaurantId] }),
  });
  const deleteRule = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/ai-ops/upsell/rules/${id}`),
    onSuccess: () => {
      toast({ title: "Rule removed" });
      qc.invalidateQueries({ queryKey: ["ai-upsell-rules", restaurantId] });
    },
  });

  const balance = wallet.data?.balance ?? 0;
  const insufficient = balance < COST;

  const totals = useMemo(() => {
    const ch = perf.data?.byChannel ?? [];
    const sum = (et: string) => ch.filter((c) => c.eventType === et).reduce((s, c) => s + c.count, 0);
    const rev = ch.filter((c) => c.eventType === "convert" || c.eventType === "accept").reduce((s, c) => s + Number(c.revenue), 0);
    const impressions = sum("impression");
    const accepts = sum("accept");
    const acceptRate = impressions > 0 ? (accepts / impressions) * 100 : 0;
    return { impressions, accepts, rev, acceptRate };
  }, [perf.data]);

  const openCreate = () => { setDraft({ ...EMPTY_DRAFT }); setEditorOpen(true); };
  const openEdit = (r: RuleRow) => {
    setDraft({
      id: r.id, name: r.name, channel: (r.channel as "pos" | "qr" | "both") ?? "both", priority: r.priority,
      isEnabled: r.isEnabled, triggerType: r.triggerType, triggerConfig: r.triggerConfig ?? {},
      suggestedItemIds: r.suggestedItemIds ?? [], message: r.message ?? "", branchId: r.branchId,
    });
    setEditorOpen(true);
  };
  const openEditFromSuggestion = (s: SuggestionRow, idx: number) => {
    const r = s.payload.rules[idx];
    setDraft({
      name: r.name, channel: r.channel, priority: r.priority, isEnabled: true,
      triggerType: r.triggerType, triggerConfig: r.triggerConfig ?? {},
      suggestedItemIds: r.suggestedItemIds ?? [], message: r.message ?? "", branchId: null,
    });
    setEditorOpen(true);
  };

  return (
    <Layout>
      <PageHeader
        title="AI Upsell Engine"
        subtitle="Generate, manage and measure smart upsell rules across POS and QR menu."
        actions={
          <div className="flex items-center gap-2">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Coins className="w-3.5 h-3.5" /> {balance} credits
            </div>
            <Button onClick={() => generate.mutate()} disabled={generate.isPending || insufficient}>
              {generate.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              Generate ({COST} credits)
            </Button>
          </div>
        }
      />

      {insufficient && (
        <div className="mx-6 mb-4 px-4 py-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-sm text-amber-800 dark:text-amber-300">
          You need {COST} credits to generate upsell rules. Top up in <a href="/ai/usage" className="underline font-medium">Usage & Credits</a>.
        </div>
      )}

      <div className="px-6 pb-10">
        <Tabs defaultValue="suggestions">
          <TabsList>
            <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
            <TabsTrigger value="rules">Active Rules ({rules.data?.data?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
          </TabsList>

          {/* ── Suggestions ── */}
          <TabsContent value="suggestions" className="mt-4 space-y-3">
            {suggestions.isLoading && <Skeleton className="h-40 w-full" />}
            {suggestions.data?.data?.length === 0 && (
              <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
                No AI suggestions yet — click <strong>Generate</strong> to get started.
              </CardContent></Card>
            )}
            {suggestions.data?.data?.map((sug) => {
              const sel = selected[sug.id] ?? new Set<number>();
              const toggleSel = (i: number) => {
                const next = new Set(sel);
                if (next.has(i)) next.delete(i); else next.add(i);
                setSelected(s => ({ ...s, [sug.id]: next }));
              };
              const selectAll = () => setSelected(s => ({ ...s, [sug.id]: new Set(sug.payload.rules.map((_, i) => i)) }));
              const clearSel = () => setSelected(s => ({ ...s, [sug.id]: new Set() }));
              return (
              <Card key={sug.id}>
                <CardHeader className="flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" /> Batch #{sug.id}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(sug.generatedAt), "PPp")} · {sug.payload.rules.length} rule(s)
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {sel.size > 0 ? (
                      <>
                        <span className="text-xs text-muted-foreground mr-1">{sel.size} selected</span>
                        <Button size="sm" variant="ghost" onClick={clearSel}>Clear</Button>
                        <Button size="sm" onClick={() => bulkAccept.mutate({ suggestionId: sug.id, indices: Array.from(sel) })} disabled={bulkAccept.isPending}>
                          <Check className="w-3.5 h-3.5 mr-1" /> Approve {sel.size}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" onClick={selectAll}>Select all</Button>
                        <Button size="sm" variant="ghost" onClick={() => dismissBatch.mutate(sug.id)}>
                          <X className="w-4 h-4 mr-1" /> Dismiss batch
                        </Button>
                      </>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {sug.payload.rules.map((r, i) => {
                    const lift = r.expectedLiftPct ?? estimateLift(r, itemsById);
                    const conf = r.confidence != null ? Math.round(r.confidence * 100) : null;
                    const targets = r.suggestedItemIds.map(id => itemsById.get(id)?.name).filter(Boolean) as string[];
                    return (
                      <div key={i} className={`border rounded-lg p-3 space-y-2 ${sel.has(i) ? "border-primary bg-primary/5" : "border-border"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <input type="checkbox" className="mt-1 h-4 w-4 rounded accent-primary" checked={sel.has(i)} onChange={() => toggleSel(i)} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <p className="font-medium text-sm">{r.name}</p>
                              <Badge variant="outline" className="text-xs">{r.channel.toUpperCase()}</Badge>
                              <Badge variant="secondary" className="text-xs">{TRIGGER_LABELS[r.triggerType] ?? r.triggerType}</Badge>
                              <span className="text-xs text-muted-foreground">{describeTrigger(r.triggerType, r.triggerConfig, itemsById, categories.data?.data ?? [])}</span>
                            </div>
                            {r.message && <p className="text-xs text-muted-foreground italic">"{r.message}"</p>}
                            {r.rationale && <p className="text-xs text-muted-foreground/80 mt-1">{r.rationale}</p>}
                            <div className="flex items-center gap-3 mt-1.5 text-xs">
                              <span className="text-muted-foreground">→ Suggests: <span className="text-foreground">{targets.slice(0, 3).join(", ") || "—"}{targets.length > 3 ? ` +${targets.length - 3}` : ""}</span></span>
                              {lift > 0 && <Badge className="bg-green-500/10 text-green-600 border border-green-500/20 text-xs">+{lift.toFixed(1)}% lift</Badge>}
                              {conf != null && <Badge variant="outline" className="text-xs">{conf}% confidence</Badge>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <Button size="sm" variant="outline" onClick={() => openEditFromSuggestion(sug, i)}>
                              <Edit className="w-3.5 h-3.5 mr-1" /> Edit
                            </Button>
                            <Button size="sm" onClick={() => acceptSuggestion.mutate({ suggestionId: sug.id, index: i })} disabled={acceptSuggestion.isPending}>
                              <Check className="w-3.5 h-3.5 mr-1" /> Approve
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => dismissOne.mutate({ id: sug.id, index: i })}>
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
            })}
          </TabsContent>

          {/* ── Active Rules ── */}
          <TabsContent value="rules" className="mt-4 space-y-2">
            <div className="flex justify-end">
              <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> New rule</Button>
            </div>
            {rules.isLoading && <Skeleton className="h-40 w-full" />}
            {rules.data?.data?.length === 0 && (
              <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
                No upsell rules yet. Generate AI suggestions or create one manually.
              </CardContent></Card>
            )}
            {rules.data?.data?.map((rule) => (
              <Card key={rule.id}>
                <CardContent className="py-3 flex items-center gap-4">
                  <Switch checked={rule.isEnabled} onCheckedChange={(v) => updateRule.mutate({ id: rule.id, patch: { isEnabled: v } })} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <p className="font-medium text-sm">{rule.name}</p>
                      <Badge variant="outline" className="text-xs">{rule.channel.toUpperCase()}</Badge>
                      <Badge variant="secondary" className="text-xs">{TRIGGER_LABELS[rule.triggerType] ?? rule.triggerType}</Badge>
                      {rule.source === "ai" && <Badge className="text-xs bg-primary/10 text-primary border border-primary/20">AI</Badge>}
                      {rule.branchId && <Badge variant="outline" className="text-xs">Branch {branches.find(b => b.id === rule.branchId)?.name ?? rule.branchId}</Badge>}
                    </div>
                    {rule.message && <p className="text-xs text-muted-foreground italic">"{rule.message}"</p>}
                    <p className="text-xs text-muted-foreground/70">
                      {describeTrigger(rule.triggerType, rule.triggerConfig, itemsById, categories.data?.data ?? [])} · {rule.suggestedItemIds.length} suggested · priority {rule.priority}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(rule)}><Edit className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Delete "${rule.name}"?`)) deleteRule.mutate(rule.id); }}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* ── Performance ── */}
          <TabsContent value="performance" className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
                <SelectTrigger className="w-32 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
              <Select value={chFilter} onValueChange={v => setChFilter(v as "all" | "pos" | "qr")}>
                <SelectTrigger className="w-32 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  <SelectItem value="pos">POS</SelectItem>
                  <SelectItem value="qr">QR menu</SelectItem>
                </SelectContent>
              </Select>
              {branches.length > 1 && (
                <Select value={branchFilter} onValueChange={setBranchFilter}>
                  <SelectTrigger className="w-40 h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All branches</SelectItem>
                    {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon={Eye} label="Impressions" value={totals.impressions} />
              <StatCard icon={MousePointerClick} label="Accepts" value={totals.accepts} />
              <StatCard icon={TrendingUp} label="Accept rate" value={`${totals.acceptRate.toFixed(1)}%`} />
              <StatCard icon={IndianRupee} label="Attributed revenue" value={`₹${totals.rev.toFixed(0)}`} />
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base">Daily activity</CardTitle></CardHeader>
              <CardContent>
                <DailyChart series={perf.data?.series ?? []} days={days} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">By Rule</CardTitle></CardHeader>
              <CardContent>
                {(perf.data?.byRule?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No events yet.</p>
                ) : (
                  <RulePerfTable rows={perf.data?.byRule ?? []} />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <RuleEditorDialog
        open={editorOpen} onClose={() => setEditorOpen(false)}
        draft={draft} setDraft={setDraft}
        items={menuItems.data?.data ?? []}
        categories={categories.data?.data ?? []}
        branches={branches.map(b => ({ id: b.id, name: b.name }))}
        onSave={() => saveRule.mutate(draft)}
        saving={saveRule.isPending}
      />
    </Layout>
  );
}

function estimateLift(r: SuggestedRule, itemsById: Map<number, MenuItemLite>): number {
  const prices = r.suggestedItemIds.map(id => Number(itemsById.get(id)?.price ?? 0));
  const avgPrice = prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : 0;
  // Heuristic: ~10% acceptance × confidence, expressed as % of an assumed ₹500 ticket.
  const conf = r.confidence ?? 0.5;
  return Math.min(30, (avgPrice * 0.1 * conf / 500) * 100);
}

function describeTrigger(type: string, cfg: Record<string, unknown>, itemsById: Map<number, MenuItemLite>, cats: CategoryLite[]): string {
  if (type === "item_in_cart") {
    const ids = Array.isArray(cfg.menuItemIds) ? cfg.menuItemIds as number[] : [];
    const names = ids.map(id => itemsById.get(id)?.name).filter(Boolean) as string[];
    return `When cart has: ${names.slice(0, 2).join(", ") || "—"}${names.length > 2 ? ` +${names.length - 2}` : ""}`;
  }
  if (type === "category_in_cart") {
    const ids = Array.isArray(cfg.categoryIds) ? cfg.categoryIds as number[] : [];
    const names = ids.map(id => cats.find(c => c.id === id)?.name).filter(Boolean) as string[];
    return `Category: ${names.join(", ") || "—"}`;
  }
  if (type === "cart_total_below_threshold") return `Cart total < ₹${Number(cfg.threshold ?? 0)}`;
  if (type === "time_of_day") {
    const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    return `${fmt(Number(cfg.startMinutes ?? 0))}–${fmt(Number(cfg.endMinutes ?? 0))}`;
  }
  if (type === "customer_segment") {
    const segs = Array.isArray(cfg.segments) ? cfg.segments as string[] : [];
    return `Segments: ${segs.join(", ") || "—"}`;
  }
  return "";
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Icon className="w-3.5 h-3.5" /> {label}
        </div>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function RulePerfTable({ rows }: { rows: { ruleId: number | null; ruleName: string | null; eventType: string; count: number; revenue: string }[] }) {
  // Pivot by rule
  const byRule = new Map<string, { ruleName: string; impressions: number; accepts: number; converts: number; revenue: number }>();
  for (const r of rows) {
    const k = String(r.ruleId ?? "—");
    const e = byRule.get(k) ?? { ruleName: r.ruleName ?? `#${r.ruleId ?? "—"}`, impressions: 0, accepts: 0, converts: 0, revenue: 0 };
    if (r.eventType === "impression") e.impressions += r.count;
    if (r.eventType === "accept") { e.accepts += r.count; e.revenue += Number(r.revenue); }
    if (r.eventType === "convert") { e.converts += r.count; e.revenue += Number(r.revenue); }
    byRule.set(k, e);
  }
  const list = Array.from(byRule.values()).sort((a, b) => b.accepts - a.accepts);
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-muted-foreground border-b border-border">
        <tr><th className="text-left py-2">Rule</th><th className="text-right">Impressions</th><th className="text-right">Accepts</th><th className="text-right">Conv. Rate</th><th className="text-right">Revenue</th></tr>
      </thead>
      <tbody>
        {list.map((r, i) => (
          <tr key={i} className="border-b border-border/30">
            <td className="py-1.5">{r.ruleName}</td>
            <td className="text-right">{r.impressions}</td>
            <td className="text-right">{r.accepts}</td>
            <td className="text-right">{r.impressions > 0 ? `${((r.accepts / r.impressions) * 100).toFixed(1)}%` : "—"}</td>
            <td className="text-right">₹{r.revenue.toFixed(0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DailyChart({ series, days }: { series: { day: string; eventType: string; count: number; revenue: string }[]; days: number }) {
  const buckets = useMemo(() => {
    const map = new Map<string, { day: string; impressions: number; accepts: number; revenue: number }>();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86_400_000);
      const k = d.toISOString().slice(0, 10);
      map.set(k, { day: k, impressions: 0, accepts: 0, revenue: 0 });
    }
    for (const r of series) {
      const e = map.get(r.day);
      if (!e) continue;
      if (r.eventType === "impression") e.impressions += r.count;
      if (r.eventType === "accept") { e.accepts += r.count; e.revenue += Number(r.revenue); }
      if (r.eventType === "convert") e.revenue += Number(r.revenue);
    }
    return Array.from(map.values());
  }, [series, days]);
  const max = Math.max(1, ...buckets.map(b => Math.max(b.impressions, b.accepts)));
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-0.5 h-32">
        {buckets.map((b, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end gap-0.5 group relative" title={`${b.day}: ${b.impressions} impressions, ${b.accepts} accepts, ₹${b.revenue.toFixed(0)}`}>
            <div className="bg-primary/30 w-full rounded-sm" style={{ height: `${(b.impressions / max) * 100}%` }} />
            <div className="bg-primary w-full rounded-sm" style={{ height: `${(b.accepts / max) * 100}%`, minHeight: b.accepts > 0 ? "2px" : "0" }} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-primary/30 rounded-sm" /> Impressions</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-primary rounded-sm" /> Accepts</span>
      </div>
    </div>
  );
}

function RuleEditorDialog({
  open, onClose, draft, setDraft, items, categories, branches, onSave, saving,
}: {
  open: boolean; onClose: () => void;
  draft: RuleDraft; setDraft: (d: RuleDraft) => void;
  items: MenuItemLite[]; categories: CategoryLite[];
  branches: { id: number; name: string }[];
  onSave: () => void; saving: boolean;
}) {
  // Reset trigger config when type changes.
  useEffect(() => {
    if (!open) return;
    const t = draft.triggerType;
    const cfg = draft.triggerConfig ?? {};
    const ok =
      (t === "item_in_cart" && Array.isArray(cfg.menuItemIds)) ||
      (t === "category_in_cart" && Array.isArray(cfg.categoryIds)) ||
      (t === "cart_total_below_threshold" && typeof cfg.threshold === "number") ||
      (t === "time_of_day" && typeof cfg.startMinutes === "number") ||
      (t === "customer_segment" && Array.isArray(cfg.segments));
    if (!ok) {
      const empty: Record<string, Record<string, unknown>> = {
        item_in_cart: { menuItemIds: [] },
        category_in_cart: { categoryIds: [] },
        cart_total_below_threshold: { threshold: 300 },
        time_of_day: { startMinutes: 11 * 60, endMinutes: 15 * 60 },
        customer_segment: { segments: ["new"] },
      };
      setDraft({ ...draft, triggerConfig: empty[t] ?? {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.triggerType, open]);

  const cfg = draft.triggerConfig as Record<string, unknown>;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{draft.id ? "Edit upsell rule" : "New upsell rule"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <Label>Rule name</Label>
            <Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Add fries with burger" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Channel</Label>
              <Select value={draft.channel} onValueChange={v => setDraft({ ...draft, channel: v as "pos" | "qr" | "both" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Both</SelectItem>
                  <SelectItem value="pos">POS only</SelectItem>
                  <SelectItem value="qr">QR menu only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Input type="number" min={0} max={100} value={draft.priority} onChange={e => setDraft({ ...draft, priority: Number(e.target.value) || 0 })} />
            </div>
            {branches.length > 1 && (
              <div>
                <Label>Branch</Label>
                <Select value={draft.branchId == null ? "all" : String(draft.branchId)} onValueChange={v => setDraft({ ...draft, branchId: v === "all" ? null : Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All branches</SelectItem>
                    {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div>
            <Label>Trigger type</Label>
            <Select value={draft.triggerType} onValueChange={v => setDraft({ ...draft, triggerType: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TRIGGER_TYPES.map(t => <SelectItem key={t} value={t}>{TRIGGER_LABELS[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Trigger-specific config */}
          <div className="border border-border rounded-md p-3 bg-muted/30 space-y-2">
            {draft.triggerType === "item_in_cart" && (
              <MultiPicker
                label="Trigger items (cart contains any of)"
                options={items.map(i => ({ id: i.id, label: i.name }))}
                selected={(cfg.menuItemIds as number[]) ?? []}
                onChange={ids => setDraft({ ...draft, triggerConfig: { ...cfg, menuItemIds: ids } })}
              />
            )}
            {draft.triggerType === "category_in_cart" && (
              <MultiPicker
                label="Trigger categories"
                options={categories.map(c => ({ id: c.id, label: c.name }))}
                selected={(cfg.categoryIds as number[]) ?? []}
                onChange={ids => setDraft({ ...draft, triggerConfig: { ...cfg, categoryIds: ids } })}
              />
            )}
            {draft.triggerType === "cart_total_below_threshold" && (
              <div>
                <Label>Cart total below (₹)</Label>
                <Input type="number" min={0} value={Number(cfg.threshold ?? 0)} onChange={e => setDraft({ ...draft, triggerConfig: { ...cfg, threshold: Number(e.target.value) || 0 } })} />
              </div>
            )}
            {draft.triggerType === "time_of_day" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Start time</Label>
                  <Input type="time" value={minutesToTime(Number(cfg.startMinutes ?? 0))} onChange={e => setDraft({ ...draft, triggerConfig: { ...cfg, startMinutes: timeToMinutes(e.target.value) } })} />
                </div>
                <div>
                  <Label>End time</Label>
                  <Input type="time" value={minutesToTime(Number(cfg.endMinutes ?? 0))} onChange={e => setDraft({ ...draft, triggerConfig: { ...cfg, endMinutes: timeToMinutes(e.target.value) } })} />
                </div>
              </div>
            )}
            {draft.triggerType === "customer_segment" && (
              <div>
                <Label>Segments</Label>
                <div className="flex gap-2 mt-1">
                  {["new", "returning", "vip"].map(s => {
                    const selected = ((cfg.segments as string[]) ?? []).includes(s);
                    return (
                      <button key={s} type="button" onClick={() => {
                        const cur = (cfg.segments as string[]) ?? [];
                        const next = selected ? cur.filter(x => x !== s) : [...cur, s];
                        setDraft({ ...draft, triggerConfig: { ...cfg, segments: next } });
                      }} className={`px-3 py-1.5 rounded-md text-xs border ${selected ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>{s}</button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <MultiPicker
            label="Suggest these items (max 5)"
            options={items.map(i => ({ id: i.id, label: `${i.name} · ₹${i.price}` }))}
            selected={draft.suggestedItemIds}
            onChange={ids => setDraft({ ...draft, suggestedItemIds: ids.slice(0, 5) })}
          />

          <div>
            <Label>Suggestion message (shown to customer)</Label>
            <Textarea rows={2} maxLength={120} value={draft.message ?? ""} onChange={e => setDraft({ ...draft, message: e.target.value })} placeholder="Add fries to make it a meal — ₹49" />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.isEnabled} onCheckedChange={v => setDraft({ ...draft, isEnabled: v })} />
            Enabled
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={saving || !draft.name || draft.suggestedItemIds.length === 0}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MultiPicker({ label, options, selected, onChange }: { label: string; options: { id: number; label: string }[]; selected: number[]; onChange: (ids: number[]) => void }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return options.filter(o => !lq || o.label.toLowerCase().includes(lq)).slice(0, 50);
  }, [options, q]);
  const sel = new Set(selected);
  return (
    <div>
      <Label>{label}</Label>
      <Input className="mb-1.5" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="max-h-32 overflow-y-auto border border-border rounded-md p-1.5 bg-background space-y-0.5">
        {filtered.length === 0 && <p className="text-xs text-muted-foreground py-2 text-center">No matches</p>}
        {filtered.map(o => {
          const isSel = sel.has(o.id);
          return (
            <button key={o.id} type="button" onClick={() => onChange(isSel ? selected.filter(i => i !== o.id) : [...selected, o.id])}
              className={`w-full text-left text-xs px-2 py-1 rounded flex items-center gap-2 ${isSel ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}>
              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${isSel ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                {isSel && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
              </span>
              <span className="truncate">{o.label}</span>
            </button>
          );
        })}
      </div>
      {selected.length > 0 && <p className="text-xs text-muted-foreground mt-1">{selected.length} selected</p>}
    </div>
  );
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60), mi = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
