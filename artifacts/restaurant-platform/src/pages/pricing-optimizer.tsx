import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Loader2, AlertTriangle, CheckCircle2, TrendingDown, Save, IndianRupee } from "lucide-react";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";

type Status = "no_recipe" | "healthy" | "low_margin" | "losing_money";
interface Item {
  id: number;
  name: string;
  categoryId: number | null;
  categoryName: string | null;
  price: number;
  rawCogs: number;
  effectiveCogs: number;
  margin: number;
  foodCostPct: number;
  hasRecipe: boolean;
  ingredientCount: number;
  competitorPrice: number | null;
  wastePct: number;
  overheadPct: number;
  status: Status;
  suggestedPrice: number | null;
}
interface Settings {
  targetFoodCostPct: number;
  lowMarginBufferPct: number;
  defaultOverheadPct: number;
  defaultWastePct: number;
}
interface OptimizerResponse { settings: Settings; currency: string; items: Item[]; }
interface RecipeLine {
  inventoryItemId: number;
  ingredientName: string | null;
  quantity: number;
  unit: string;
  costPerUnit: number;
  ingredientUnit: string | null;
  lineCost: number;
}
interface ComboSuggestion {
  partnerItemIds: number[];
  partnerItemNames: string[];
  bundlePrice: number;
  blendedFoodCostPct: number;
  blendedMarginPct: number;
  rationale: string;
}
interface DetailResponse {
  settings: Settings;
  currency: string;
  item: Item;
  recipe: RecipeLine[];
  suggestion: { source: "rule"; rationale: string; combo: ComboSuggestion | null };
}
interface AiSuggestion {
  source: "ai" | "rule";
  suggestedPrice: number | null;
  rationale: string;
  combo: ComboSuggestion | null;
}

const STATUS_BADGE: Record<Status, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  healthy: { label: "Healthy", variant: "default" },
  low_margin: { label: "Low margin", variant: "secondary" },
  losing_money: { label: "Losing money", variant: "destructive" },
  no_recipe: { label: "No recipe", variant: "outline" },
};

type SortKey = "name" | "price" | "cogs" | "margin" | "status";
type StatusFilter = "all" | Status;

export default function PricingOptimizerPage() {
  const restaurantId = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("margin");
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingPrice, setPendingPrice] = useState<number | null>(null);

  const list = useQuery<OptimizerResponse>({
    queryKey: ["pricing-optimizer", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/pricing/optimizer`),
    enabled: !!restaurantId,
  });

  const settingsMut = useMutation({
    mutationFn: (next: Partial<Settings>) =>
      apiPut(`/restaurants/${restaurantId}/pricing/settings`, next),
    onSuccess: () => {
      toast({ title: "Targets updated" });
      qc.invalidateQueries({ queryKey: ["pricing-optimizer", restaurantId] });
      qc.invalidateQueries({ queryKey: ["pricing-detail", restaurantId] });
    },
    onError: (err: Error) => toast({ title: "Could not save", description: err.message, variant: "destructive" }),
  });

  const items = list.data?.items ?? [];
  const settings = list.data?.settings;
  const currency = list.data?.currency ?? "INR";
  const sym = currency === "INR" ? "₹" : currency + " ";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = items.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (q && !i.name.toLowerCase().includes(q) && !(i.categoryName ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
    out = [...out].sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;
      switch (sortKey) {
        case "name": va = a.name.toLowerCase(); vb = b.name.toLowerCase(); break;
        case "price": va = a.price; vb = b.price; break;
        case "cogs": va = a.effectiveCogs; vb = b.effectiveCogs; break;
        case "margin": va = a.margin; vb = b.margin; break;
        case "status": va = a.status; vb = b.status; break;
      }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
    return out;
  }, [items, statusFilter, search, sortKey, sortAsc]);

  const counts = useMemo(() => {
    const c = { healthy: 0, low_margin: 0, losing_money: 0, no_recipe: 0 };
    for (const i of items) c[i.status]++;
    return c;
  }, [items]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortAsc((v) => !v);
    else { setSortKey(k); setSortAsc(true); }
  };

  return (
    <Layout>
      <PageHeader
        title="Cost & Price Optimizer"
        description="See the true food cost of every menu item, an AI-suggested price, and quickly fix items that aren't making enough money."
      />

      <div className="grid gap-4 md:grid-cols-4 mb-4">
        <SummaryCard label="Healthy" value={counts.healthy} icon={<CheckCircle2 className="h-5 w-5 text-green-600" />} />
        <SummaryCard label="Low margin" value={counts.low_margin} icon={<TrendingDown className="h-5 w-5 text-amber-600" />} />
        <SummaryCard label="Losing money" value={counts.losing_money} icon={<AlertTriangle className="h-5 w-5 text-destructive" />} />
        <SummaryCard label="No recipe" value={counts.no_recipe} icon={<IndianRupee className="h-5 w-5 text-muted-foreground" />} />
      </div>

      {settings && (
        <SettingsCard
          settings={settings}
          saving={settingsMut.isPending}
          onSave={(s) => settingsMut.mutate(s)}
        />
      )}

      <Card className="mt-4">
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <CardTitle>Menu items</CardTitle>
          <div className="flex flex-wrap gap-2 items-center">
            <Input
              data-testid="input-search"
              placeholder="Search name or category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
            />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-40" data-testid="select-status-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="losing_money">Losing money</SelectItem>
                <SelectItem value="low_margin">Low margin</SelectItem>
                <SelectItem value="healthy">Healthy</SelectItem>
                <SelectItem value="no_recipe">No recipe</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">No menu items match these filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer" onClick={() => toggleSort("name")}>Item</TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort("cogs")}>Food cost</TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort("price")}>Current price</TableHead>
                    <TableHead className="text-right">Suggested</TableHead>
                    <TableHead className="text-right">Competitor</TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort("margin")}>Margin %</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => toggleSort("status")}>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((i) => (
                    <TableRow
                      key={i.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setSelectedId(i.id)}
                      data-testid={`row-item-${i.id}`}
                    >
                      <TableCell>
                        <div className="font-medium">{i.name}</div>
                        <div className="text-xs text-muted-foreground">{i.categoryName ?? "Uncategorised"}</div>
                      </TableCell>
                      <TableCell className="text-right font-mono">{i.hasRecipe ? formatCurrency(i.effectiveCogs) : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(i.price)}</TableCell>
                      <TableCell className="text-right font-mono">
                        {i.suggestedPrice != null ? (
                          <span className={i.suggestedPrice > i.price + 0.5 ? "text-amber-600 font-semibold" : ""}>
                            {formatCurrency(i.suggestedPrice)}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {i.competitorPrice != null ? formatCurrency(i.competitorPrice) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {i.hasRecipe ? `${i.margin.toFixed(1)}%` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGE[i.status].variant} data-testid={`badge-status-${i.id}`}>
                          {STATUS_BADGE[i.status].label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <DetailDrawer
        restaurantId={restaurantId}
        itemId={selectedId}
        currency={currency}
        sym={sym}
        onClose={() => setSelectedId(null)}
        onApplyPrice={(price) => { setPendingPrice(price); setConfirmOpen(true); }}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply suggested price?</AlertDialogTitle>
            <AlertDialogDescription>
              This will update the menu item's selling price to {pendingPrice != null ? formatCurrency(pendingPrice) : ""}. The change is recorded in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-apply"
              onClick={async () => {
                if (selectedId == null || pendingPrice == null) return;
                try {
                  await apiPost(`/restaurants/${restaurantId}/pricing/items/${selectedId}/apply-price`, { newPrice: pendingPrice });
                  toast({ title: "Price updated" });
                  qc.invalidateQueries({ queryKey: ["pricing-optimizer", restaurantId] });
                  qc.invalidateQueries({ queryKey: ["pricing-detail", restaurantId, selectedId] });
                  qc.invalidateQueries({ queryKey: ["menu-items"] });
                  setConfirmOpen(false);
                } catch (e) {
                  toast({ title: "Could not update price", description: (e as Error).message, variant: "destructive" });
                }
              }}
            >
              Apply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}

function SummaryCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md border p-2">{icon}</div>
        <div>
          <div className="text-2xl font-semibold leading-none">{value}</div>
          <div className="text-xs text-muted-foreground mt-1">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsCard({ settings, saving, onSave }: { settings: Settings; saving: boolean; onSave: (s: Partial<Settings>) => void }) {
  const [target, setTarget] = useState(settings.targetFoodCostPct.toString());
  const [buffer, setBuffer] = useState(settings.lowMarginBufferPct.toString());
  const [overhead, setOverhead] = useState(settings.defaultOverheadPct.toString());
  const [waste, setWaste] = useState(settings.defaultWastePct.toString());
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pricing targets</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-5 items-end">
          <div>
            <Label>Target food-cost %</Label>
            <Input data-testid="input-target-fc" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <div>
            <Label>Low-margin buffer (pts)</Label>
            <Input data-testid="input-buffer" inputMode="decimal" value={buffer} onChange={(e) => setBuffer(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">Alert when food cost % ≥ target + buffer.</p>
          </div>
          <div>
            <Label>Default waste %</Label>
            <Input data-testid="input-waste" inputMode="decimal" value={waste} onChange={(e) => setWaste(e.target.value)} />
          </div>
          <div>
            <Label>Default overhead %</Label>
            <Input data-testid="input-overhead" inputMode="decimal" value={overhead} onChange={(e) => setOverhead(e.target.value)} />
          </div>
          <Button
            data-testid="button-save-settings"
            onClick={() => onSave({
              targetFoodCostPct: Number(target),
              lowMarginBufferPct: Number(buffer),
              defaultOverheadPct: Number(overhead),
              defaultWastePct: Number(waste),
            })}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save targets
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DetailDrawer({
  restaurantId, itemId, currency, sym, onClose, onApplyPrice,
}: {
  restaurantId: number; itemId: number | null; currency: string; sym: string;
  onClose: () => void; onApplyPrice: (price: number) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const open = itemId != null;

  const detail = useQuery<DetailResponse>({
    queryKey: ["pricing-detail", restaurantId, itemId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/pricing/items/${itemId}`),
    enabled: open && itemId != null,
  });

  const [aiResult, setAiResult] = useState<AiSuggestion | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [competitor, setCompetitor] = useState("");
  const [waste, setWaste] = useState("");
  const [overhead, setOverhead] = useState("");

  const item = detail.data?.item;
  const recipe = detail.data?.recipe ?? [];
  const ruleSugg = detail.data?.suggestion;

  // Sync editable fields from server.
  useMemo(() => {
    if (!item) return;
    setCompetitor(item.competitorPrice != null ? String(item.competitorPrice) : "");
    setWaste(String(item.wastePct ?? ""));
    setOverhead(String(item.overheadPct ?? ""));
    setAiResult(null);
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMeta = useMutation({
    mutationFn: (body: { competitorPrice?: number | null; wastePct?: number | null; overheadPct?: number | null }) =>
      apiPut(`/restaurants/${restaurantId}/pricing/items/${itemId}/meta`, body),
    onSuccess: () => {
      toast({ title: "Saved" });
      qc.invalidateQueries({ queryKey: ["pricing-optimizer", restaurantId] });
      qc.invalidateQueries({ queryKey: ["pricing-detail", restaurantId, itemId] });
    },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const askAi = async () => {
    if (itemId == null) return;
    setLoadingAi(true);
    try {
      const res = await apiPost<AiSuggestion>(`/restaurants/${restaurantId}/pricing/items/${itemId}/ai-suggest`);
      setAiResult(res);
    } catch (e) {
      toast({ title: "AI unavailable, using rule-based math", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoadingAi(false);
    }
  };

  const effectiveSugg: AiSuggestion = aiResult ?? (ruleSugg && item ? {
    source: "rule",
    suggestedPrice: item.suggestedPrice,
    rationale: ruleSugg.rationale,
    combo: ruleSugg.combo,
  } : { source: "rule", suggestedPrice: null, rationale: "", combo: null });

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle data-testid="text-detail-title">{item?.name ?? "Loading…"}</SheetTitle>
        </SheetHeader>

        {detail.isLoading || !item ? (
          <div className="space-y-3 py-6">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Current price" value={formatCurrency(item.price)} />
              <Stat label="Food cost" value={item.hasRecipe ? formatCurrency(item.effectiveCogs) : "—"} />
              <Stat label="Margin" value={item.hasRecipe ? `${item.margin.toFixed(1)}%` : "—"} />
            </div>

            <Card>
              <CardHeader><CardTitle className="text-sm">Recipe ({recipe.length} ingredient{recipe.length === 1 ? "" : "s"})</CardTitle></CardHeader>
              <CardContent>
                {recipe.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    Add a recipe to this menu item from the Inventory → Recipe Mappings page so we can compute its food cost.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ingredient</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Cost / unit</TableHead>
                        <TableHead className="text-right">Line cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recipe.map((r) => (
                        <TableRow key={r.inventoryItemId}>
                          <TableCell>{r.ingredientName ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{r.quantity} {r.unit}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(r.costPerUnit)}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(r.lineCost)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell colSpan={3} className="text-right font-medium">Raw COGS</TableCell>
                        <TableCell className="text-right font-mono font-semibold">{formatCurrency(item.rawCogs)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell colSpan={3} className="text-right text-muted-foreground">+ {item.wastePct.toFixed(1)}% waste, + {item.overheadPct.toFixed(1)}% overhead</TableCell>
                        <TableCell className="text-right font-mono font-semibold">{formatCurrency(item.effectiveCogs)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Competitor & overrides</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3 items-end">
                  <div>
                    <Label>Competitor price ({sym})</Label>
                    <Input data-testid="input-competitor-price" inputMode="decimal" value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder="optional" />
                  </div>
                  <div>
                    <Label>Waste %</Label>
                    <Input data-testid="input-item-waste" inputMode="decimal" value={waste} onChange={(e) => setWaste(e.target.value)} placeholder="default" />
                  </div>
                  <div>
                    <Label>Overhead %</Label>
                    <Input data-testid="input-item-overhead" inputMode="decimal" value={overhead} onChange={(e) => setOverhead(e.target.value)} placeholder="default" />
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    data-testid="button-save-meta"
                    variant="outline"
                    size="sm"
                    onClick={() => saveMeta.mutate({
                      competitorPrice: competitor.trim() === "" ? null : Number(competitor),
                      wastePct: waste.trim() === "" ? null : Number(waste),
                      overheadPct: overhead.trim() === "" ? null : Number(overhead),
                    })}
                    disabled={saveMeta.isPending}
                  >
                    {saveMeta.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Save
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">AI suggestion</CardTitle>
                <Button
                  data-testid="button-ask-ai"
                  variant="outline"
                  size="sm"
                  onClick={askAi}
                  disabled={loadingAi || !item.hasRecipe}
                >
                  {loadingAi ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  Refine with AI
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Suggested price ({effectiveSugg.source === "ai" ? "AI" : "rule-based"})</div>
                    <div className="text-2xl font-semibold" data-testid="text-suggested-price">
                      {effectiveSugg.suggestedPrice != null ? formatCurrency(effectiveSugg.suggestedPrice) : "—"}
                    </div>
                  </div>
                  <Button
                    data-testid="button-apply-price"
                    disabled={effectiveSugg.suggestedPrice == null || effectiveSugg.suggestedPrice === item.price}
                    onClick={() => effectiveSugg.suggestedPrice != null && onApplyPrice(effectiveSugg.suggestedPrice)}
                  >
                    Apply suggested price
                  </Button>
                </div>
                {effectiveSugg.rationale && (
                  <div className="text-sm text-muted-foreground" data-testid="text-rationale">{effectiveSugg.rationale}</div>
                )}
                {item.status === "low_margin" || item.status === "losing_money" ? (
                  effectiveSugg.combo ? (
                    <div className="rounded-md border p-3 bg-muted/40">
                      <div className="text-sm font-medium">Combo idea</div>
                      <div className="text-sm">
                        Bundle "{item.name}" with {effectiveSugg.combo.partnerItemNames.map((n) => `"${n}"`).join(" + ")} at {formatCurrency(effectiveSugg.combo.bundlePrice)}.
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Blended margin: <span className="font-semibold">{effectiveSugg.combo.blendedMarginPct.toFixed(1)}%</span> · blended food cost: {effectiveSugg.combo.blendedFoodCostPct.toFixed(1)}%
                      </div>
                      {effectiveSugg.combo.rationale && (
                        <div className="text-xs text-muted-foreground mt-1">{effectiveSugg.combo.rationale}</div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">No suitable higher-margin partners available for a combo bundle.</div>
                  )
                ) : null}
              </CardContent>
            </Card>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  );
}
