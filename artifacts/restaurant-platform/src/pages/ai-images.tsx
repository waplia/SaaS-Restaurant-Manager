import { useState, useMemo, useRef } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ImageIcon, Search, Loader2, Check, RotateCw, Upload, Bot, FileImage, Library } from "lucide-react";
import { useMenuItems, useMenuCategories, useUpdateMenuItem, useRestaurantId } from "@/lib/hooks";
import { useAiWallet } from "@/lib/aiHooks";
import { CreditsPill } from "@/components/ai/CreditsPill";
import { AiGeneratedBadge } from "@/components/ai/AiGeneratedBadge";
import { AiImageSkeleton } from "@/components/ai/AiLoadingSkeleton";
import { InsufficientCreditsModal } from "@/components/ai/InsufficientCreditsModal";
import { resolveImageUrl } from "@/components/ImageUploadField";
import { apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { MenuItem } from "@/lib/types";

const COST = 10;

type ImageSource = "ai_generated" | "uploaded" | "stock";
interface PhotoDraft {
  imageUrl: string;
  source: ImageSource;
  fileName?: string;
}

// Curated, royalty-free stock photo URLs (Unsplash food photography). Owners
// can also paste their own stock-library URL — both flows tag the draft as
// `stock` so the source taxonomy stays accurate.
const STOCK_PRESETS: { label: string; url: string }[] = [
  { label: "Plated curry", url: "https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=900&q=80" },
  { label: "Burger", url: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80" },
  { label: "Pizza", url: "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=80" },
  { label: "Salad bowl", url: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=900&q=80" },
  { label: "Pasta", url: "https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=900&q=80" },
  { label: "Sushi platter", url: "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&w=900&q=80" },
];

export default function AiImagesPage() {
  const restaurantId = useRestaurantId();
  const { data: items = [], isLoading: itemsLoading } = useMenuItems();
  const { data: categories = [] } = useMenuCategories();
  const wallet = useAiWallet();
  const updateItem = useUpdateMenuItem();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"ai" | "upload" | "stock">("ai");
  const [cuisine, setCuisine] = useState("Indian");
  const [ingredients, setIngredients] = useState("");
  const [style, setStyle] = useState("");
  const [stockUrl, setStockUrl] = useState("");
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [draft, setDraft] = useState<PhotoDraft | null>(null);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showInsufficient, setShowInsufficient] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => !q || i.name.toLowerCase().includes(q));
  }, [items, search]);

  function onSelect(item: MenuItem) {
    setSelectedItem(item);
    setDraft(null);
  }

  async function generate() {
    if (!selectedItem) return;
    if ((wallet.data?.balance ?? 0) < COST) { setShowInsufficient(true); return; }
    setGenerating(true);
    setDraft(null);
    try {
      const res = await apiPost<{ payload: { imageUrl: string } }>(
        `/restaurants/${restaurantId}/items/${selectedItem.id}/ai-photo`,
        { cuisine, ingredients, style },
      );
      setDraft({ imageUrl: res.payload.imageUrl, source: "ai_generated" });
      wallet.refetch();
      toast({ title: "Photo ready", description: "Preview below — apply to use it on your menu." });
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

  async function handleUpload(file: File) {
    if (!selectedItem) {
      toast({ title: "Select an item first", description: "Pick a menu item before uploading a photo." });
      return;
    }
    setUploading(true);
    try {
      // Presign + finalize using the same flow as ImageUploadField.
      const presign = await apiPost<{ uploadURL: string; objectPath: string }>(
        `/restaurants/${restaurantId}/storage/uploads/request-url`,
        { contentType: file.type || "image/jpeg" },
      );
      const put = await fetch(presign.uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "image/jpeg" },
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      await apiPost(`/restaurants/${restaurantId}/storage/uploads/finalize-public`, { objectPath: presign.objectPath });
      setDraft({ imageUrl: presign.objectPath, source: "uploaded", fileName: file.name });
      toast({ title: "Photo uploaded", description: "Tagged as your own photo — apply to use it on your menu." });
    } catch (err) {
      toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function pickStock(url: string) {
    if (!selectedItem) {
      toast({ title: "Select an item first", description: "Pick a menu item before choosing a stock photo." });
      return;
    }
    if (!url || !/^https?:\/\//i.test(url)) {
      toast({ title: "Enter a valid URL", description: "Stock photos must be a public http(s) URL.", variant: "destructive" });
      return;
    }
    setDraft({ imageUrl: url, source: "stock" });
    toast({ title: "Stock photo selected", description: "Tagged as stock — apply to use it on your menu." });
  }

  function sourceLabel(s: ImageSource): string {
    if (s === "ai_generated") return "AI generated";
    if (s === "uploaded") return "uploaded";
    return "stock";
  }

  async function applyDraft() {
    if (!selectedItem || !draft) return;
    try {
      await updateItem.mutateAsync({ id: selectedItem.id, imageUrl: draft.imageUrl });
      toast({ title: "Photo applied", description: `${selectedItem.name} (${sourceLabel(draft.source)})` });
      setDraft(null);
    } catch (err) {
      toast({ title: "Could not apply", description: (err as Error).message, variant: "destructive" });
    }
  }

  return (
    <Layout>
      <PageHeader
        title="AI Food Images"
        subtitle="Generate professional dish photographs with AI, or upload your own — both tagged so you always know the source."
        actions={tab === "ai" ? <CreditsPill cost={COST} available={wallet.data?.balance} loading={wallet.isLoading} /> : null}
      />

      <div className="p-6 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        <Card className="h-fit">
          <CardContent className="p-4 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a menu item…" className="pl-9" />
            </div>
            <div className="max-h-[60vh] overflow-y-auto -mx-1 divide-y divide-border">
              {itemsLoading ? (
                <div className="p-2 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No items match.</p>
              ) : filtered.map((item) => {
                const cat = categories.find((c) => c.id === item.categoryId);
                const isActive = selectedItem?.id === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelect(item)}
                    className={`w-full text-left px-3 py-2 hover:bg-muted/60 ${isActive ? "bg-violet-50 dark:bg-violet-950/30" : ""}`}
                  >
                    <p className="font-medium text-sm truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {cat?.name ?? "Uncategorised"}{item.imageUrl ? " · has photo" : " · no photo yet"}
                    </p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="p-5 space-y-4">
              <Tabs value={tab} onValueChange={(v) => setTab(v as "ai" | "upload" | "stock")}>
                <TabsList className="grid grid-cols-3 w-full max-w-xl">
                  <TabsTrigger value="ai" className="gap-1.5"><Bot className="w-3.5 h-3.5" /> AI generate ({COST} cr)</TabsTrigger>
                  <TabsTrigger value="upload" className="gap-1.5"><Upload className="w-3.5 h-3.5" /> Upload your own (free)</TabsTrigger>
                  <TabsTrigger value="stock" className="gap-1.5"><Library className="w-3.5 h-3.5" /> Stock photo (free)</TabsTrigger>
                </TabsList>

                <TabsContent value="ai" className="space-y-4 pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label>Cuisine</Label>
                      <Input value={cuisine} onChange={(e) => setCuisine(e.target.value)} placeholder="Indian, Italian, Thai…" />
                    </div>
                    <div>
                      <Label>Key ingredients (optional)</Label>
                      <Input value={ingredients} onChange={(e) => setIngredients(e.target.value)} placeholder="paneer, basil, lime…" />
                    </div>
                  </div>
                  <div>
                    <Label>Style notes (optional)</Label>
                    <Textarea
                      value={style}
                      rows={2}
                      onChange={(e) => setStyle(e.target.value)}
                      placeholder="e.g. dark moody background, brass plate, top-down, rustic linen napkin…"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm text-muted-foreground min-w-0 truncate">
                      {selectedItem ? <>Generating for <span className="font-medium text-foreground">{selectedItem.name}</span></> : "Select a menu item to begin."}
                    </div>
                    <Button onClick={generate} disabled={!selectedItem || generating} className="gap-1.5 shrink-0">
                      {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      {generating ? "Generating…" : `Generate (${COST} credits)`}
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="upload" className="space-y-3 pt-4">
                  <div className="rounded-lg border border-dashed border-border p-6 text-center bg-muted/30">
                    <FileImage className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm font-medium">Upload your own photo</p>
                    <p className="text-xs text-muted-foreground mb-4">
                      Use a real photo of the dish you've shot in your kitchen. Will be tagged as <span className="font-semibold">Uploaded</span>.
                    </p>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUpload(f);
                      }}
                    />
                    <Button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={!selectedItem || uploading}
                      variant="outline"
                      className="gap-1.5"
                    >
                      {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      {uploading ? "Uploading…" : selectedItem ? "Choose file" : "Select an item first"}
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="stock" className="space-y-3 pt-4">
                  <div>
                    <Label>Paste a stock photo URL</Label>
                    <div className="flex gap-2 mt-1">
                      <Input
                        value={stockUrl}
                        onChange={(e) => setStockUrl(e.target.value)}
                        placeholder="https://images.unsplash.com/…"
                      />
                      <Button
                        type="button"
                        onClick={() => pickStock(stockUrl)}
                        disabled={!selectedItem || !stockUrl}
                        variant="outline"
                        className="gap-1.5 shrink-0"
                      >
                        <Library className="w-3.5 h-3.5" /> Use URL
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Tagged as <span className="font-semibold">Stock</span>. Make sure you have rights to use the image.
                    </p>
                  </div>
                  <div>
                    <Label className="block mb-2">Or pick from a curated set</Label>
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                      {STOCK_PRESETS.map((p) => (
                        <button
                          key={p.url}
                          type="button"
                          onClick={() => pickStock(p.url)}
                          disabled={!selectedItem}
                          className="group relative aspect-square overflow-hidden rounded-md border border-border hover:border-violet-400 disabled:opacity-50"
                          title={p.label}
                        >
                          <img src={p.url} alt={p.label} className="w-full h-full object-cover" loading="lazy" />
                          <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[10px] px-1.5 py-0.5 truncate">
                            {p.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Existing */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wide font-semibold text-muted-foreground">
                  <ImageIcon className="w-3.5 h-3.5" /> Current photo
                </div>
                <div className="aspect-square rounded-lg border border-border bg-muted overflow-hidden flex items-center justify-center">
                  {selectedItem?.imageUrl ? (
                    <img src={resolveImageUrl(selectedItem.imageUrl)} alt={selectedItem.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs text-muted-foreground">No photo set</span>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Draft */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wide font-semibold text-muted-foreground">
                    <Sparkles className="w-3.5 h-3.5" /> Draft
                  </div>
                  {draft && (
                    draft.source === "ai_generated" ? (
                      <AiGeneratedBadge />
                    ) : draft.source === "uploaded" ? (
                      <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 text-[10px]">
                        <Upload className="w-3 h-3 mr-1" /> Uploaded
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-sky-300 bg-sky-50 text-sky-800 text-[10px]">
                        <Library className="w-3 h-3 mr-1" /> Stock
                      </Badge>
                    )
                  )}
                </div>
                {(generating || uploading) ? (
                  <AiImageSkeleton />
                ) : draft ? (
                  <>
                    <img src={resolveImageUrl(draft.imageUrl)} alt="Draft" className="aspect-square w-full rounded-lg border border-border object-cover" />
                    {draft.fileName && <p className="text-[11px] text-muted-foreground truncate">{draft.fileName}</p>}
                  </>
                ) : (
                  <div className="aspect-square rounded-lg border border-dashed border-border bg-muted/40 flex items-center justify-center text-xs text-muted-foreground text-center px-4">
                    Generate or upload a photo to preview here.
                  </div>
                )}
                {draft && (
                  <div className="flex items-center justify-end gap-2">
                    {draft.source === "ai_generated" && (
                      <Button variant="outline" size="sm" onClick={generate} disabled={generating} className="gap-1.5">
                        <RotateCw className="w-3.5 h-3.5" /> Regenerate
                      </Button>
                    )}
                    <Button size="sm" onClick={applyDraft} disabled={updateItem.isPending} className="gap-1.5">
                      {updateItem.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Apply photo
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <InsufficientCreditsModal
        open={showInsufficient}
        onClose={() => setShowInsufficient(false)}
        required={COST}
        available={wallet.data?.balance ?? 0}
        feature="AI Food Images"
      />
    </Layout>
  );
}
