import { useState, useMemo, useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkles, FileText, Search, Loader2, Check, ListChecks } from "lucide-react";
import { useMenuItems, useMenuCategories, useUpdateMenuItem, useRestaurantId } from "@/lib/hooks";
import { useAiWallet, useAiSettings } from "@/lib/aiHooks";
import { CreditsPill } from "@/components/ai/CreditsPill";
import { AiGeneratedBadge } from "@/components/ai/AiGeneratedBadge";
import { AiLoadingSkeleton } from "@/components/ai/AiLoadingSkeleton";
import { InsufficientCreditsModal } from "@/components/ai/InsufficientCreditsModal";
import { AI_TONES, AI_LANGUAGES, AI_LENGTHS, AI_DESCRIPTION_VARIANTS, type AiDescriptionVariant } from "@/lib/aiOptions";
import { apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { MenuItem } from "@/lib/types";

const COST_PER_VARIANT = 1;

interface DescriptionDraft {
  description: string;
  allergens: string[];
  tags: string[];
  variant?: AiDescriptionVariant;
}

interface BulkResult {
  itemId: number;
  itemName: string;
  variant: AiDescriptionVariant;
  draft?: DescriptionDraft;
  error?: string;
}

export default function AiDescriptionsPage() {
  const restaurantId = useRestaurantId();
  const { data: items = [], isLoading: itemsLoading } = useMenuItems();
  const { data: categories = [] } = useMenuCategories();
  const wallet = useAiWallet();
  const settings = useAiSettings();
  const updateItem = useUpdateMenuItem();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [tone, setTone] = useState("simple");
  const [language, setLanguage] = useState("en");
  const [length, setLength] = useState("short");
  const [variants, setVariants] = useState<AiDescriptionVariant[]>(["short"]);

  // Selection: single (for inline editor) and bulk (checkbox set)
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());

  const [draft, setDraft] = useState<DescriptionDraft | null>(null);
  const [editable, setEditable] = useState<DescriptionDraft | null>(null);
  const [generating, setGenerating] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkResult[]>([]);
  const [showInsufficient, setShowInsufficient] = useState(false);

  // Hydrate defaults from per-restaurant settings on first arrival.
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  useEffect(() => {
    if (!defaultsApplied && settings.data) {
      setTone(settings.data.defaultTone || "simple");
      setLanguage(settings.data.defaultLanguage || "en");
      setLength(settings.data.defaultLength || "short");
      setDefaultsApplied(true);
    }
  }, [settings.data, defaultsApplied]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) =>
      !q || i.name.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);

  function onSelect(item: MenuItem) {
    setSelectedItem(item);
    setDraft(null);
    setEditable(null);
  }

  function toggleBulk(id: number) {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllBulk() {
    if (filtered.every((i) => bulkSelected.has(i.id))) setBulkSelected(new Set());
    else setBulkSelected(new Set(filtered.map((i) => i.id)));
  }

  function toggleVariant(v: AiDescriptionVariant) {
    setVariants((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);
  }

  const totalCostBulk = bulkSelected.size * Math.max(1, variants.length) * COST_PER_VARIANT;
  const totalCostSingle = Math.max(1, variants.length) * COST_PER_VARIANT;

  async function generateOne(itemId: number, variant: AiDescriptionVariant): Promise<DescriptionDraft> {
    const res = await apiPost<{ payload: DescriptionDraft }>(
      `/restaurants/${restaurantId}/items/${itemId}/ai-description`,
      { tone, language, length: variant === "premium" ? "premium" : variant === "qr_menu" ? "short" : length, variant },
    );
    return { ...res.payload, variant };
  }

  async function generate() {
    if (!selectedItem) return;
    const balance = wallet.data?.balance ?? 0;
    if (balance < totalCostSingle) { setShowInsufficient(true); return; }
    setGenerating(true);
    setDraft(null);
    setEditable(null);
    try {
      // For single-item with multiple variants, generate each in turn and
      // surface the last one as the editable draft, while keeping all in
      // bulkResults so the user sees every variant.
      const variantList = variants.length ? variants : (["short"] as AiDescriptionVariant[]);
      const results: BulkResult[] = [];
      for (const v of variantList) {
        try {
          const d = await generateOne(selectedItem.id, v);
          results.push({ itemId: selectedItem.id, itemName: selectedItem.name, variant: v, draft: d });
        } catch (err) {
          results.push({ itemId: selectedItem.id, itemName: selectedItem.name, variant: v, error: (err as Error).message });
        }
      }
      setBulkResults(results);
      const lastOk = [...results].reverse().find((r) => r.draft);
      if (lastOk?.draft) {
        setDraft(lastOk.draft);
        setEditable(lastOk.draft);
      }
      wallet.refetch();
      toast({ title: "Descriptions ready", description: `Generated ${results.filter((r) => r.draft).length} variant(s).` });
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (/credit/i.test(msg) && /insufficient|not enough|out of/i.test(msg)) {
        setShowInsufficient(true);
      } else {
        toast({ title: "Generation failed", description: msg || "Please try again.", variant: "destructive" });
      }
    } finally {
      setGenerating(false);
    }
  }

  async function generateBulk() {
    if (bulkSelected.size === 0) {
      toast({ title: "No items selected", description: "Pick items from the list to bulk generate." });
      return;
    }
    const balance = wallet.data?.balance ?? 0;
    if (balance < totalCostBulk) { setShowInsufficient(true); return; }
    setBulkRunning(true);
    setBulkResults([]);
    try {
      const variantList = variants.length ? variants : (["short"] as AiDescriptionVariant[]);
      const ids = Array.from(bulkSelected);
      const results: BulkResult[] = [];
      for (const id of ids) {
        const item = items.find((i) => i.id === id);
        if (!item) continue;
        for (const v of variantList) {
          try {
            const d = await generateOne(id, v);
            results.push({ itemId: id, itemName: item.name, variant: v, draft: d });
          } catch (err) {
            results.push({ itemId: id, itemName: item.name, variant: v, error: (err as Error).message });
          }
          // Stream progress
          setBulkResults([...results]);
        }
      }
      wallet.refetch();
      const ok = results.filter((r) => r.draft).length;
      const fail = results.filter((r) => r.error).length;
      toast({
        title: `Bulk run complete`,
        description: `${ok} succeeded${fail > 0 ? `, ${fail} failed` : ""}.`,
        variant: fail === results.length ? "destructive" : undefined,
      });
    } finally {
      setBulkRunning(false);
    }
  }

  async function applyBulkDraft(r: BulkResult) {
    if (!r.draft) return;
    try {
      await updateItem.mutateAsync({
        id: r.itemId,
        description: r.draft.description,
        allergens: r.draft.allergens,
        tags: r.draft.tags,
      });
      toast({ title: "Applied", description: `${r.itemName} (${r.variant})` });
    } catch (err) {
      toast({ title: "Could not apply", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function applyDraft() {
    if (!selectedItem || !editable) return;
    try {
      await updateItem.mutateAsync({
        id: selectedItem.id,
        description: editable.description,
        allergens: editable.allergens,
        tags: editable.tags,
      });
      toast({ title: "Applied to menu item", description: selectedItem.name });
      setDraft(null);
      setEditable(null);
    } catch (err) {
      toast({ title: "Could not apply", description: (err as Error).message, variant: "destructive" });
    }
  }

  return (
    <Layout>
      <PageHeader
        title="AI Item Descriptions"
        subtitle="Generate appetising menu descriptions with allergens and tags. Run bulk or per-item across multiple variants."
        actions={<CreditsPill cost={totalCostSingle} available={wallet.data?.balance} loading={wallet.isLoading} />}
      />

      <div className="p-6 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        {/* Item picker with bulk select */}
        <Card className="h-fit">
          <CardContent className="p-4 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a menu item…" className="pl-9" />
            </div>

            <div className="flex items-center justify-between text-xs">
              <button
                onClick={toggleAllBulk}
                className="text-violet-600 hover:underline font-medium"
              >
                {filtered.length > 0 && filtered.every((i) => bulkSelected.has(i.id)) ? "Clear selection" : "Select all"}
              </button>
              <span className="text-muted-foreground">
                {bulkSelected.size > 0 ? `${bulkSelected.size} selected` : "Tap to bulk-select"}
              </span>
            </div>

            <div className="max-h-[55vh] overflow-y-auto -mx-1 divide-y divide-border">
              {itemsLoading ? (
                <div className="p-2 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No items match.</p>
              ) : filtered.map((item) => {
                const cat = categories.find((c) => c.id === item.categoryId);
                const isActive = selectedItem?.id === item.id;
                const isBulk = bulkSelected.has(item.id);
                return (
                  <div key={item.id} className={`flex items-center gap-2 px-3 py-2 hover:bg-muted/60 ${isActive ? "bg-violet-50 dark:bg-violet-950/30" : ""}`}>
                    <Checkbox checked={isBulk} onCheckedChange={() => toggleBulk(item.id)} aria-label={`Bulk select ${item.name}`} />
                    <button
                      onClick={() => onSelect(item)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <p className="font-medium text-sm truncate">{item.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{cat?.name ?? "Uncategorised"}{item.description ? " · has description" : " · no description yet"}</p>
                    </button>
                  </div>
                );
              })}
            </div>

            {bulkSelected.size > 0 && (
              <div className="border-t border-border pt-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Bulk run will generate <span className="font-semibold text-foreground">{bulkSelected.size * Math.max(1, variants.length)}</span> draft(s) — costs <span className="font-semibold text-foreground">{totalCostBulk} credits</span>.
                </p>
                <Button size="sm" onClick={generateBulk} disabled={bulkRunning} className="w-full gap-1.5">
                  {bulkRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListChecks className="w-3.5 h-3.5" />}
                  Generate for {bulkSelected.size} item(s)
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Editor + variants */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>Tone</Label>
                  <Select value={tone} onValueChange={setTone}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AI_TONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Language</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AI_LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Default length</Label>
                  <Select value={length} onValueChange={setLength}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AI_LENGTHS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Variants to generate ({variants.length || 1} × {COST_PER_VARIANT} credit each)</Label>
                <div className="flex flex-wrap gap-2">
                  {AI_DESCRIPTION_VARIANTS.map((v) => {
                    const active = variants.includes(v.value);
                    return (
                      <button
                        key={v.value}
                        type="button"
                        onClick={() => toggleVariant(v.value)}
                        title={v.help}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${active ? "bg-violet-100 border-violet-400 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200" : "bg-background border-border text-muted-foreground hover:border-violet-300"}`}
                      >
                        {active && <Check className="inline w-3 h-3 mr-1" />}
                        {v.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="text-sm text-muted-foreground min-w-0 truncate">
                  {selectedItem ? <>Generating for <span className="font-medium text-foreground">{selectedItem.name}</span></> : "Pick an item on the left to begin (or bulk-select multiple)."}
                </div>
                <Button onClick={generate} disabled={!selectedItem || generating} className="gap-1.5 shrink-0">
                  {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {generating ? "Generating…" : `Generate (${totalCostSingle} credit${totalCostSingle === 1 ? "" : "s"})`}
                </Button>
              </div>
            </CardContent>
          </Card>

          {(generating || bulkRunning) && <AiLoadingSkeleton lines={4} />}

          {bulkResults.length > 0 && (
            <Card>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <ListChecks className="w-4 h-4 text-violet-600" />
                  <h3 className="font-semibold text-sm">Generated variants ({bulkResults.length})</h3>
                </div>
                <div className="divide-y divide-border -mx-2">
                  {bulkResults.map((r, idx) => (
                    <div key={`${r.itemId}-${r.variant}-${idx}`} className="px-2 py-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{r.itemName}</p>
                          <Badge variant="outline" className="mt-0.5 text-[10px] uppercase tracking-wide">{r.variant.replace(/_/g, " ")}</Badge>
                        </div>
                        {r.draft && (
                          <Button size="sm" variant="outline" onClick={() => applyBulkDraft(r)} disabled={updateItem.isPending} className="gap-1.5 shrink-0">
                            <Check className="w-3.5 h-3.5" /> Apply
                          </Button>
                        )}
                      </div>
                      {r.draft ? (
                        <p className="text-sm text-muted-foreground line-clamp-3">{r.draft.description}</p>
                      ) : (
                        <p className="text-xs text-rose-600">{r.error ?? "Failed"}</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {draft && editable && (
            <Card>
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-violet-600" />
                    <h3 className="font-semibold text-sm">Editable draft{editable.variant ? ` · ${editable.variant.replace(/_/g, " ")}` : ""}</h3>
                    <AiGeneratedBadge />
                  </div>
                </div>

                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={editable.description}
                    onChange={(e) => setEditable({ ...editable, description: e.target.value })}
                    rows={4}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <ChipEditor
                    label="Allergens"
                    values={editable.allergens}
                    tone="amber"
                    onChange={(v) => setEditable({ ...editable, allergens: v })}
                  />
                  <ChipEditor
                    label="Tags"
                    values={editable.tags}
                    tone="violet"
                    onChange={(v) => setEditable({ ...editable, tags: v })}
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => { setDraft(null); setEditable(null); }}>Discard</Button>
                  <Button onClick={applyDraft} disabled={updateItem.isPending} className="gap-1.5">
                    {updateItem.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Apply to {selectedItem?.name ?? "item"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <InsufficientCreditsModal
        open={showInsufficient}
        onClose={() => setShowInsufficient(false)}
        required={Math.max(totalCostSingle, totalCostBulk)}
        available={wallet.data?.balance ?? 0}
        feature="AI Item Descriptions"
      />
    </Layout>
  );
}

function ChipEditor({ label, values, tone, onChange }: {
  label: string; values: string[]; tone: "amber" | "violet"; onChange: (v: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const color = tone === "amber" ? "border-amber-300 bg-amber-50 text-amber-800" : "border-violet-300 bg-violet-50 text-violet-800";
  return (
    <div>
      <Label>{label}</Label>
      <div className="rounded-md border border-input bg-background p-2 flex flex-wrap gap-1.5 min-h-[40px]">
        {values.map((v, idx) => (
          <Badge key={`${v}-${idx}`} variant="outline" className={color}>
            {v}
            <button
              onClick={() => onChange(values.filter((_, i) => i !== idx))}
              className="ml-1 opacity-60 hover:opacity-100"
              aria-label={`Remove ${v}`}
            >×</button>
          </Badge>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              const v = input.trim().toLowerCase();
              if (v && !values.includes(v)) onChange([...values, v]);
              setInput("");
            }
          }}
          placeholder="Add and press Enter"
          className="flex-1 min-w-[100px] outline-none bg-transparent text-sm"
        />
      </div>
    </div>
  );
}
