import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Coins, Package, ArrowRight, X, Save, FileText, AlertTriangle, AlertCircle, TrendingDown, Trash2 } from "lucide-react";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useAiWallet } from "@/lib/aiHooks";
import { useToast } from "@/hooks/use-toast";
import { AiGeneratedBadge } from "@/components/ai/AiGeneratedBadge";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";

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
  estCostPerUnit: number;
  estLineCost: number;
  reason: string;
  urgency: "low" | "medium" | "high";
  riskType: RiskType;
}

interface SuggestionPayload {
  summary: string;
  items: SuggestionItem[];
  totalEstimatedCost: number;
  windowDays: number;
}

interface SuggestionRow {
  id: number;
  status: string;
  payload: SuggestionPayload;
  generatedAt: string;
  purchaseOrderId: number | null;
  notes: string | null;
}

const URGENCY_COLOR: Record<string, string> = {
  high: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
  medium: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  low: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
};

const RISK_META: Record<RiskType, { label: string; icon: typeof AlertCircle; cls: string }> = {
  low_stock: { label: "Low stock", icon: AlertCircle, cls: "text-rose-600" },
  overstock: { label: "Overstock", icon: Package, cls: "text-blue-600" },
  wastage: { label: "Wastage risk", icon: Trash2, cls: "text-orange-600" },
  expiring: { label: "Expiring soon", icon: TrendingDown, cls: "text-amber-600" },
};

const COST = 5;

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
      apiPost<{ purchaseOrder: { id: number } }>(
        `/restaurants/${restaurantId}/ai-ops/inventory/suggestions/${id}/draft-po`,
        { selectedInventoryItemIds: ids },
      ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["ai-inventory-suggestions", restaurantId] });
      toast({ title: `Draft PO #${data.purchaseOrder.id} created — review in Inventory.` });
    },
    onError: (e: unknown) => {
      toast({ title: (e as { message?: string })?.message ?? "Could not draft PO", variant: "destructive" });
    },
  });

  const balance = wallet.data?.balance ?? 0;
  const planEnabled = wallet.data?.planKhanaAiEnabled ?? wallet.data?.planAiEnabled ?? false;
  const insufficient = !wallet.isLoading && balance < COST;

  const [expanded, setExpanded] = useState<number | null>(null);
  const [selected, setSelected] = useState<Record<number, Set<number>>>({});

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
        subtitle="Reorder suggestions based on your usage history and stock levels."
        actions={
          <div className="flex gap-2 items-center">
            <Badge variant="secondary" className="gap-1"><Coins className="w-3 h-3" />{balance} cr</Badge>
            <Button
              size="sm"
              onClick={() => generate.mutate()}
              disabled={!planEnabled || insufficient || generate.isPending}
              className="gap-1.5"
            >
              {generate.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Generate ({COST} cr)
            </Button>
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

        {list.isLoading ? (
          <div className="space-y-3">{[0, 1].map(i => <Skeleton key={i} className="h-32" />)}</div>
        ) : !list.data?.data.length ? (
          <Card>
            <CardContent className="p-10 text-center space-y-3">
              <Package className="w-10 h-10 text-muted-foreground mx-auto" />
              <p className="font-semibold">No active suggestions</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Click <em>Generate</em> to analyse your last 30 days of usage and propose reorder quantities.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {list.data.data.map((sug) => {
              const p = sug.payload;
              const isOpen = expanded === sug.id;
              const sorted = [...p.items].sort((a, b) => {
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
                          Est. ₹{p.totalEstimatedCost.toLocaleString()}
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
                            Draft PO ({effectiveIds.length})
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
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {p.summary && <p className="text-sm text-muted-foreground italic">{p.summary}</p>}
                    {p.items.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No items need reordering right now.</p>
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
                              <th className="px-3 py-2 font-medium">Stock</th>
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
                              return (
                                <tr key={i} className="border-t border-border">
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
                                    {it.reason && <p className="text-[10px] text-muted-foreground line-clamp-1">{it.reason}</p>}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className={`inline-flex items-center gap-1 text-[10px] ${meta.cls}`}>
                                      <RIcon className="w-3 h-3" /> {meta.label}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-muted-foreground">{it.currentStock} {it.unit}</td>
                                  <td className="px-3 py-2 font-semibold">
                                    {it.suggestedQuantity > 0 ? `${it.suggestedQuantity} ${it.unit}` : "—"}
                                  </td>
                                  <td className="px-3 py-2 text-muted-foreground">{it.suggestedSupplierName ?? "—"}</td>
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
