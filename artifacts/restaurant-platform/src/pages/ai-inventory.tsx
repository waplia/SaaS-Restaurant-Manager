import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Coins, Package, ArrowRight, X, Save, FileText, AlertTriangle, AlertCircle, TrendingDown, Trash2, Info, CalendarClock, Truck } from "lucide-react";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useRestaurantId, useInventory } from "@/lib/hooks";
import { useAiWallet } from "@/lib/aiHooks";
import { useToast } from "@/hooks/use-toast";
import { AiGeneratedBadge } from "@/components/ai/AiGeneratedBadge";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type RiskType = "low_stock" | "overstock" | "wastage" | "expiring";

interface SuggestionItem {
  inventoryItemId: number | null;
  name: string;
  unit: string;
  currentStock: number;
  minStockLevel: number;
  parLevel: number | null;
  suggestedQuantity: number;
  suggestedSupplierId: number | null;
  suggestedSupplierName: string | null;
  supplierRationale: string | null;
  estCostPerUnit: number;
  estLineCost: number;
  reason: string;
  urgency: "low" | "medium" | "high";
  riskType: RiskType;
  earliestExpiryDate: string | null;
  atRiskQuantity: number;
}

interface SuggestionPayload {
  summary: string;
  items: SuggestionItem[];
  totalEstimatedCost: number;
  windowDays: number;
  expiryWindowDays: number;
}

interface SuggestionRow {
  id: number;
  status: string;
  payload: SuggestionPayload;
  generatedAt: string;
  purchaseOrderId: number | null;
  notes: string | null;
}

interface ForecastNeedsResponse {
  forecast: { id: number; generatedAt: string; horizonDays: number } | null;
  needs: Array<Record<string, unknown>>;
}

const URGENCY_COLOR: Record<string, string> = {
  high: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
  medium: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  low: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
};

// Distinct color per risk type — separates the four risk categories visually.
const RISK_META: Record<RiskType, { label: string; icon: typeof AlertCircle; cls: string; chip: string }> = {
  low_stock: {
    label: "Low stock", icon: AlertCircle,
    cls: "text-rose-600",
    chip: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
  },
  expiring: {
    label: "Expiring soon", icon: CalendarClock,
    cls: "text-amber-600",
    chip: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  },
  overstock: {
    label: "Overstock", icon: Package,
    cls: "text-blue-600",
    chip: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900",
  },
  wastage: {
    label: "Wastage risk", icon: Trash2,
    cls: "text-orange-600",
    chip: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900",
  },
};

const RISK_ORDER: RiskType[] = ["low_stock", "expiring", "overstock", "wastage"];
// Matches backend `requireAiCredits("ai_inventory_assistant", () => ({ units: 1 }))`.
const COST = 1;

export default function AiInventoryPage() {
  const restaurantId = useRestaurantId();
  const wallet = useAiWallet();
  const { toast } = useToast();
  const qc = useQueryClient();

  const list = useQuery<{ data: SuggestionRow[] }>({
    queryKey: ["ai-inventory-suggestions", restaurantId, "active"],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/ai-ops/inventory/suggestions?status=active`),
    enabled: !!restaurantId,
  });

  const forecastNeeds = useQuery<ForecastNeedsResponse>({
    queryKey: ["ai-inventory-forecast-needs", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/ai-ops/inventory/forecast-needs?limit=8`),
    enabled: !!restaurantId,
  });
  const inventoryAll = useInventory();
  // Index inventory by name and id so the forecast panel can show current stock vs requirement.
  const inventoryIndex = useMemo(() => {
    const byName = new Map<string, { id: number; currentStock: number; unit: string }>();
    const byId = new Map<number, { id: number; currentStock: number; unit: string }>();
    for (const it of inventoryAll.data ?? []) {
      const rec = { id: it.id, currentStock: Number(it.currentStock), unit: it.unit };
      byName.set(it.name.toLowerCase().trim(), rec);
      byId.set(it.id, rec);
    }
    return { byName, byId };
  }, [inventoryAll.data]);

  const generate = useMutation({
    mutationFn: () => apiPost<{ suggestion: SuggestionRow }>(`/restaurants/${restaurantId}/ai-ops/inventory/suggest`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-inventory-suggestions", restaurantId] });
      qc.invalidateQueries({ queryKey: ["ai-wallet"] });
      toast({ title: "Suggestion generated" });
    },
    onError: (e: unknown) => {
      const msg = (e as { message?: string })?.message ?? "Failed to generate";
      toast({ title: msg, variant: "destructive" });
    },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: "saved" | "dismissed" }) =>
      apiPatch(`/restaurants/${restaurantId}/ai-ops/inventory/suggestions/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-inventory-suggestions", restaurantId] }),
  });

  const draftPo = useMutation({
    mutationFn: ({ id, ids }: { id: number; ids: number[] }) =>
      apiPost<{ purchaseOrders: Array<{ id: number; supplierId: number | null; itemCount: number; total: number }>; purchaseOrder: { id: number } | null }>(
        `/restaurants/${restaurantId}/ai-ops/inventory/suggestions/${id}/draft-po`,
        { selectedInventoryItemIds: ids, groupBySupplier: true },
      ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["ai-inventory-suggestions", restaurantId] });
      const count = data.purchaseOrders?.length ?? (data.purchaseOrder ? 1 : 0);
      const ids = (data.purchaseOrders ?? []).map((po) => `#${po.id}`).join(", ");
      toast({
        title: count > 1
          ? `${count} draft POs created (${ids}) — one per supplier.`
          : `Draft PO ${ids || `#${data.purchaseOrder?.id}`} created — review in Inventory.`,
      });
    },
    onError: (e: unknown) => {
      toast({ title: (e as { message?: string })?.message ?? "Could not draft PO", variant: "destructive" });
    },
  });

  const balance = wallet.data?.balance ?? 0;
  const planEnabled = wallet.data?.planKhanaAiEnabled ?? wallet.data?.planAiEnabled ?? false;
  const insufficient = !wallet.isLoading && balance < COST;
  const balanceAfter = Math.max(0, balance - COST);

  const [expanded, setExpanded] = useState<number | null>(null);
  const [selected, setSelected] = useState<Record<number, Set<number>>>({});
  // Filter chips: which risk types are visible. All on by default.
  const [riskFilter, setRiskFilter] = useState<Set<RiskType>>(new Set(RISK_ORDER));
  const toggleRisk = (r: RiskType) => setRiskFilter((prev) => {
    const next = new Set(prev);
    if (next.has(r)) next.delete(r); else next.add(r);
    if (next.size === 0) return new Set(RISK_ORDER);
    return next;
  });

  const toggleItem = (sugId: number, invId: number) => {
    setSelected((prev) => {
      const cur = new Set(prev[sugId] ?? []);
      if (cur.has(invId)) cur.delete(invId); else cur.add(invId);
      return { ...prev, [sugId]: cur };
    });
  };
  const toggleAll = (sugId: number, ids: number[], allOn: boolean) => {
    setSelected((prev) => ({ ...prev, [sugId]: allOn ? new Set() : new Set(ids) }));
  };

  return (
    <Layout>
      <PageHeader
        title="AI Inventory Assistant"
        subtitle="Reorder suggestions based on your usage history, expiry windows, and stock levels."
        actions={
          <div className="flex gap-2 items-center">
            <Badge variant="secondary" className="gap-1"><Coins className="w-3 h-3" />{balance} cr</Badge>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      size="sm"
                      onClick={() => generate.mutate()}
                      disabled={!planEnabled || insufficient || generate.isPending}
                      className="gap-1.5"
                    >
                      {generate.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      Generate ({COST} cr)
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-xs">
                    Cost: <strong>{COST}</strong> credits<br />
                    Balance after: <strong>{balanceAfter}</strong> credits
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        }
      />

      <div className="p-6 space-y-4">
        {!planEnabled && !wallet.isLoading && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Khana AI is not in your plan</p>
                <p className="text-sm text-muted-foreground">Upgrade to use AI inventory suggestions.</p>
              </div>
              <Link href="/subscription"><Button size="sm">Upgrade</Button></Link>
            </CardContent>
          </Card>
        )}

        {insufficient && planEnabled && (
          <Card className="border-rose-300 bg-rose-50 dark:bg-rose-950/20">
            <CardContent className="p-4 flex items-start gap-3">
              <Coins className="w-5 h-5 text-rose-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Out of credits</p>
                <p className="text-sm text-muted-foreground">You need {COST} credits for an inventory suggestion.</p>
              </div>
              <Link href="/ai/usage"><Button size="sm">Recharge</Button></Link>
            </CardContent>
          </Card>
        )}

        {/* Forecast-grounded raw-material needs (free — uses latest forecast). */}
        {forecastNeeds.data?.forecast && forecastNeeds.data.needs.length > 0 && (
          <Card className="border-indigo-200 bg-indigo-50/50 dark:bg-indigo-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-indigo-600" />
                Forecast-grounded raw material needs
                <Badge variant="outline" className="text-[10px] font-normal">
                  {forecastNeeds.data.forecast.horizonDays}-day horizon
                </Badge>
                <span className="text-[10px] text-muted-foreground font-normal ml-auto">No AI charge</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {forecastNeeds.data.needs.map((n, i) => {
                  const name = String(n.name ?? n.itemName ?? "—");
                  const qtyRaw = n.quantity ?? n.requiredQuantity ?? n.qty;
                  const requiredNum = qtyRaw != null && Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : null;
                  const itemIdRaw = n.inventoryItemId ?? n.itemId;
                  const itemId = typeof itemIdRaw === "number" ? itemIdRaw : null;
                  const matched = (itemId != null ? inventoryIndex.byId.get(itemId) : null) ?? inventoryIndex.byName.get(name.toLowerCase().trim());
                  const unit = String(n.unit ?? matched?.unit ?? "");
                  const currentStock = matched?.currentStock ?? null;
                  const shortfall = requiredNum != null && currentStock != null ? Math.max(0, requiredNum - currentStock) : null;
                  const covered = requiredNum != null && currentStock != null && requiredNum > 0
                    ? Math.min(100, Math.round((currentStock / requiredNum) * 100))
                    : null;
                  const note = (n.note ?? n.reason) as string | number | null | undefined;
                  return (
                    <div key={i} className="rounded-md border border-indigo-200 dark:border-indigo-900 bg-white dark:bg-slate-900 px-3 py-2">
                      <p className="text-xs font-semibold truncate" title={name}>{name}</p>
                      <div className="text-[11px] text-muted-foreground space-y-0.5 mt-0.5">
                        <div className="flex items-center justify-between gap-1">
                          <span>Need</span>
                          <span className="font-medium text-foreground">{requiredNum != null ? `${requiredNum} ${unit}` : "—"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-1">
                          <span>Stock</span>
                          <span className={`font-medium ${currentStock == null ? "text-muted-foreground" : shortfall && shortfall > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                            {currentStock != null ? `${currentStock} ${unit}` : "—"}
                          </span>
                        </div>
                        {shortfall != null && shortfall > 0 && (
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-rose-600">Shortfall</span>
                            <span className="font-semibold text-rose-600">{shortfall.toFixed(2)} {unit}</span>
                          </div>
                        )}
                        {covered != null && (
                          <div className="h-1 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full ${covered >= 100 ? "bg-emerald-500" : covered >= 50 ? "bg-amber-500" : "bg-rose-500"}`}
                              style={{ width: `${covered}%` }}
                            />
                          </div>
                        )}
                      </div>
                      {note && <p className="text-[10px] text-muted-foreground line-clamp-2 mt-1">{String(note)}</p>}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Risk filter chips */}
        {(list.data?.data.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Filter:</span>
            {RISK_ORDER.map((r) => {
              const meta = RISK_META[r];
              const active = riskFilter.has(r);
              const Icon = meta.icon;
              return (
                <button
                  key={r}
                  onClick={() => toggleRisk(r)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border transition ${active ? meta.chip : "bg-muted text-muted-foreground border-border opacity-60"}`}
                >
                  <Icon className="w-3 h-3" />
                  {meta.label}
                </button>
              );
            })}
          </div>
        )}

        {list.isLoading ? (
          <div className="space-y-3">{[0, 1].map(i => <Skeleton key={i} className="h-32" />)}</div>
        ) : !list.data?.data.length ? (
          <Card>
            <CardContent className="p-10 text-center space-y-3">
              <Package className="w-10 h-10 text-muted-foreground mx-auto" />
              <p className="font-semibold">No active suggestions</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Click <em>Generate</em> to analyse your last 30 days of usage, expiry windows, and supplier history.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {list.data.data.map((sug) => {
              const p = sug.payload;
              const isOpen = expanded === sug.id;
              const filtered = p.items.filter((it) => riskFilter.has(it.riskType));
              const sorted = [...filtered].sort((a, b) => {
                const order = { high: 0, medium: 1, low: 2 } as const;
                return order[a.urgency] - order[b.urgency];
              });
              const visible = isOpen ? sorted : sorted.slice(0, 5);
              const reorderable = sorted
                .filter((it) => it.suggestedQuantity > 0 && it.riskType === "low_stock" && it.inventoryItemId != null)
                .map((it) => it.inventoryItemId as number);
              const sel = selected[sug.id] ?? new Set<number>();
              const effectiveIds = sel.size > 0 ? Array.from(sel) : reorderable;
              const allSelected = sel.size > 0 && sel.size === reorderable.length;
              // Group selected items by supplier for the multi-PO preview.
              const previewItems = sorted.filter((it) => it.inventoryItemId != null && (sel.size === 0 ? reorderable.includes(it.inventoryItemId as number) : sel.has(it.inventoryItemId as number)));
              const supplierGroups = new Map<string, { name: string; count: number; total: number }>();
              for (const it of previewItems) {
                const key = String(it.suggestedSupplierId ?? "none");
                const name = it.suggestedSupplierName ?? "Unassigned";
                const cur = supplierGroups.get(key);
                if (cur) { cur.count += 1; cur.total += it.estLineCost; }
                else supplierGroups.set(key, { name, count: 1, total: it.estLineCost });
              }
              const supplierGroupArr = Array.from(supplierGroups.values());
              return (
                <Card key={sug.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1">
                        <CardTitle className="text-base flex items-center gap-2">
                          Suggestion #{sug.id} <AiGeneratedBadge />
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(sug.generatedAt), "PP p")} ·{" "}
                          {p.items.length} item{p.items.length === 1 ? "" : "s"} ·{" "}
                          Est. ₹{p.totalEstimatedCost.toLocaleString()} ·{" "}
                          Expiry window {p.expiryWindowDays ?? 7}d
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {sug.purchaseOrderId ? (
                          <Link href="/inventory">
                            <Button size="sm" variant="outline" className="gap-1">
                              <FileText className="w-3.5 h-3.5" /> PO #{sug.purchaseOrderId}
                            </Button>
                          </Link>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => draftPo.mutate({ id: sug.id, ids: effectiveIds })}
                            disabled={draftPo.isPending || effectiveIds.length === 0}
                            className="gap-1"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            Draft {supplierGroupArr.length > 1 ? `${supplierGroupArr.length} POs` : "PO"} ({effectiveIds.length})
                          </Button>
                        )}
                        <Button
                          size="sm" variant="outline"
                          onClick={() => updateStatus.mutate({ id: sug.id, status: "saved" })}
                          className="gap-1"
                        >
                          <Save className="w-3.5 h-3.5" /> Save
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => updateStatus.mutate({ id: sug.id, status: "dismissed" })}
                          className="gap-1 text-muted-foreground"
                        >
                          <X className="w-3.5 h-3.5" /> Dismiss
                        </Button>
                      </div>
                    </div>
                    {supplierGroupArr.length > 1 && !sug.purchaseOrderId && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <Truck className="w-3 h-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Will create one PO per supplier:</span>
                        {supplierGroupArr.map((g, i) => (
                          <Badge key={i} variant="outline" className="font-normal">
                            {g.name} · {g.count} item{g.count === 1 ? "" : "s"} · ₹{g.total.toLocaleString()}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {p.summary && <p className="text-sm text-muted-foreground italic">{p.summary}</p>}
                    {sorted.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No items match the active filters.</p>
                    ) : (
                      <div className="border border-border rounded-lg overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/50">
                            <tr className="text-left">
                              <th className="px-2 py-2 w-8">
                                {reorderable.length > 0 && (
                                  <Checkbox
                                    checked={allSelected}
                                    onCheckedChange={() => toggleAll(sug.id, reorderable, allSelected)}
                                    aria-label="Select all"
                                  />
                                )}
                              </th>
                              <th className="px-3 py-2 font-medium">Item</th>
                              <th className="px-3 py-2 font-medium">Risk</th>
                              <th className="px-3 py-2 font-medium">Stock / batch</th>
                              <th className="px-3 py-2 font-medium">Reorder</th>
                              <th className="px-3 py-2 font-medium">Supplier</th>
                              <th className="px-3 py-2 font-medium text-right">Est. cost</th>
                              <th className="px-3 py-2 font-medium">Urgency</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visible.map((it, i) => {
                              const meta = RISK_META[it.riskType] ?? RISK_META.low_stock;
                              const RIcon = meta.icon;
                              const checkable = it.riskType === "low_stock" && it.suggestedQuantity > 0 && it.inventoryItemId != null;
                              const isChecked = it.inventoryItemId != null && sel.has(it.inventoryItemId);
                              const checkedDefault = sel.size === 0 && checkable;
                              const expDate = it.earliestExpiryDate ? new Date(it.earliestExpiryDate) : null;
                              const daysToExpiry = expDate ? Math.ceil((expDate.getTime() - Date.now()) / 86_400_000) : null;
                              return (
                                <tr key={i} className="border-t border-border align-top">
                                  <td className="px-2 py-2">
                                    {checkable && (
                                      <Checkbox
                                        checked={isChecked || checkedDefault}
                                        onCheckedChange={() => toggleItem(sug.id, it.inventoryItemId as number)}
                                        aria-label={`Select ${it.name}`}
                                      />
                                    )}
                                  </td>
                                  <td className="px-3 py-2">
                                    <p className="font-medium">{it.name}</p>
                                    {it.reason && <p className="text-[10px] text-muted-foreground line-clamp-2">{it.reason}</p>}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${meta.chip}`}>
                                      <RIcon className="w-3 h-3" /> {meta.label}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-muted-foreground">
                                    <div>{it.currentStock} {it.unit}</div>
                                    {expDate && (
                                      <div className={`text-[10px] mt-0.5 inline-flex items-center gap-1 ${daysToExpiry != null && daysToExpiry <= 2 ? "text-rose-600" : daysToExpiry != null && daysToExpiry <= (p.expiryWindowDays ?? 7) ? "text-amber-600" : "text-muted-foreground"}`}>
                                        <CalendarClock className="w-3 h-3" />
                                        Exp {format(expDate, "dd MMM")}
                                        {it.atRiskQuantity > 0 && ` · ${it.atRiskQuantity} ${it.unit} at risk`}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 font-semibold">
                                    {it.suggestedQuantity > 0 ? `${it.suggestedQuantity} ${it.unit}` : "—"}
                                  </td>
                                  <td className="px-3 py-2 text-muted-foreground">
                                    <div className="flex items-center gap-1">
                                      <span>{it.suggestedSupplierName ?? "—"}</span>
                                      {it.supplierRationale && (
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                                            </TooltipTrigger>
                                            <TooltipContent className="max-w-xs">
                                              <p className="text-xs">{it.supplierRationale}</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    {it.estLineCost > 0 ? `₹${it.estLineCost.toLocaleString()}` : "—"}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${URGENCY_COLOR[it.urgency]}`}>
                                      {it.urgency}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {sorted.length > 5 && (
                          <button
                            onClick={() => setExpanded(isOpen ? null : sug.id)}
                            className="w-full text-xs py-2 text-muted-foreground hover:bg-muted/30 border-t border-border"
                          >
                            {isOpen ? "Show less" : `Show ${sorted.length - 5} more`} <ArrowRight className="w-3 h-3 inline" />
                          </button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
