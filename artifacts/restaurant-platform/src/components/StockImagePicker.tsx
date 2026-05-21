/**
 * Unified menu-item image picker.
 *
 * Tabs:
 *   - Library:  curated/approved stock food images, filterable by cuisine,
 *               dietary type, meal type, spice level and veg flag. Shows
 *               "Suggested for this dish" + "Popular" when no query.
 *   - Reuse:    photos this restaurant already uploaded/generated, so staff
 *               can reuse without paying credits again.
 *   - Upload:   drag/drop an image file (presigned upload).
 *   - AI:       generate an AI photo (plan-gated server-side — credits).
 *
 * The picker reports back the chosen URL plus the `imageSource` and (for
 * library picks) the `libraryImageId`, so the parent can include usage
 * tracking fields when saving the menu item.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search, X, Check, Loader2, ImageIcon, Upload, History, Sparkles, Star, Flame,
} from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export interface StockFoodImage {
  id: number;
  slug: string;
  name: string;
  cuisine: string | null;
  category: string | null;
  imageUrl: string;
  thumbnailUrl: string | null;
  isVeg: boolean;
  isActive: boolean;
  sortOrder: number;
  aliases: string[];
  tags: string[];
  attribution: string | null;
  dietaryType?: string | null;
  mealType?: string | null;
  spiceLevel?: number | null;
  isFeatured?: boolean;
  usageCount?: number;
}

export type PickerImageSource = "library" | "upload" | "ai_generated" | "reuse";

export interface PickerSelection {
  url: string;
  source: PickerImageSource;
  libraryImageId?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Modern callback (preferred). */
  onSelect?: (sel: PickerSelection) => void;
  /** Back-compat: called as (url, row) when a library row is picked. */
  onPick?: (url: string, row: StockFoodImage) => void;
  /** Pre-fill the search box (e.g. with the dish name). */
  initialQuery?: string;
  /** Hint the picker about the item being edited (drives AI tab + Reuse filtering). */
  itemName?: string;
  itemId?: number;
  itemIsVeg?: boolean;
}

type Tab = "library" | "reuse" | "upload" | "ai";

interface RecentPhotoRow {
  image_url: string;
  source: string;
  menu_item_id: number;
  menu_item_name: string | null;
  created_at: string;
}

const PAGE_SIZE = 60;

export function StockImagePicker({
  open, onClose, onSelect, onPick, initialQuery = "", itemName, itemId, itemIsVeg,
}: Props) {
  const RESTAURANT_ID = useRestaurantId();
  const [tab, setTab] = useState<Tab>("library");

  // Emit selection on both new + old callbacks.
  const fire = (sel: PickerSelection, row?: StockFoodImage) => {
    onSelect?.(sel);
    if (row && onPick) onPick(sel.url, row);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4" />
            Pick a photo
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-1 border-b border-border -mx-6 px-6 flex-shrink-0">
          <TabButton active={tab === "library"} onClick={() => setTab("library")} icon={<ImageIcon className="w-3.5 h-3.5" />}>Library</TabButton>
          <TabButton active={tab === "reuse"} onClick={() => setTab("reuse")} icon={<History className="w-3.5 h-3.5" />}>Reuse</TabButton>
          <TabButton active={tab === "upload"} onClick={() => setTab("upload")} icon={<Upload className="w-3.5 h-3.5" />}>Upload</TabButton>
          <TabButton active={tab === "ai"} onClick={() => setTab("ai")} icon={<Sparkles className="w-3.5 h-3.5" />}>AI generate</TabButton>
        </div>

        <div className="flex-1 overflow-y-auto -mx-2 px-2 min-h-[400px]">
          {tab === "library" && (
            <LibraryTab
              initialQuery={initialQuery || itemName || ""}
              itemName={itemName}
              itemIsVeg={itemIsVeg}
              restaurantId={RESTAURANT_ID}
              onPick={(row) => fire({ url: row.imageUrl, source: "library", libraryImageId: row.id }, row)}
            />
          )}
          {tab === "reuse" && (
            <ReuseTab
              restaurantId={RESTAURANT_ID}
              onPick={(url) => fire({ url, source: "reuse" })}
            />
          )}
          {tab === "upload" && (
            <UploadTab
              restaurantId={RESTAURANT_ID}
              onUploaded={(url) => fire({ url, source: "upload" })}
            />
          )}
          {tab === "ai" && (
            <AiTab
              restaurantId={RESTAURANT_ID}
              itemId={itemId}
              onGenerated={(url) => fire({ url, source: "ai_generated" })}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition ${
        active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Library tab ──────────────────────────────────────────────────────
function LibraryTab({
  initialQuery, itemName, itemIsVeg, restaurantId, onPick,
}: {
  initialQuery: string;
  itemName?: string;
  itemIsVeg?: boolean;
  restaurantId: number | undefined;
  onPick: (row: StockFoodImage) => void;
}) {
  const [q, setQ] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [vegOnly, setVegOnly] = useState<"any" | "veg" | "non-veg">(
    itemIsVeg === true ? "veg" : itemIsVeg === false ? "non-veg" : "any",
  );
  const [cuisine, setCuisine] = useState("");
  const [mealType, setMealType] = useState("");
  const [spice, setSpice] = useState<string>("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = useMemo(() => {
    const s = new URLSearchParams();
    if (debounced) s.set("q", debounced);
    if (vegOnly === "veg") s.set("isVeg", "true");
    if (vegOnly === "non-veg") s.set("isVeg", "false");
    if (cuisine) s.set("cuisine", cuisine);
    if (mealType) s.set("mealType", mealType);
    if (spice) s.set("spiceLevel", spice);
    s.set("limit", String(PAGE_SIZE));
    s.set("sort", "featured");
    return s.toString();
  }, [debounced, vegOnly, cuisine, mealType, spice]);

  const { data, isLoading } = useQuery<{ rows: StockFoodImage[]; total: number }>({
    queryKey: ["stock-food-images", params],
    queryFn: () => apiGet(`/stock-food-images?${params}`),
    staleTime: 60_000,
  });

  // Suggestions for the dish name (smart top hits) + popular fallback when no query.
  const suggestParams = new URLSearchParams({
    name: itemName || "",
    limit: "6",
    ...(itemIsVeg != null ? { isVeg: String(itemIsVeg) } : {}),
  }).toString();
  const { data: suggest } = useQuery<{ suggestions: StockFoodImage[] }>({
    queryKey: ["stock-food-images", "suggest", suggestParams],
    queryFn: () => apiGet(`/stock-food-images/suggest?${suggestParams}`),
    enabled: !!itemName && !debounced,
    staleTime: 60_000,
  });
  const { data: popular } = useQuery<{ rows: StockFoodImage[] }>({
    queryKey: ["stock-food-images", "popular"],
    queryFn: () => apiGet(`/stock-food-images/popular?limit=8`),
    enabled: !debounced && !cuisine && !mealType && !spice,
    staleTime: 60_000,
  });
  const { data: recent } = useQuery<{ rows: StockFoodImage[] }>({
    queryKey: ["stock-food-images", "recent", restaurantId],
    queryFn: () => apiGet(`/stock-food-images/recent?restaurantId=${restaurantId}&limit=8`),
    enabled: !!restaurantId && !debounced && !cuisine && !mealType && !spice,
    staleTime: 60_000,
  });

  return (
    <div className="py-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search dish name, e.g. paneer tikka"
            className="pl-8 h-9"
          />
        </div>
        <select value={vegOnly} onChange={(e) => setVegOnly(e.target.value as typeof vegOnly)}
          className="border border-input rounded-md px-2 h-9 text-xs bg-background">
          <option value="any">Veg & Non-veg</option>
          <option value="veg">Veg only</option>
          <option value="non-veg">Non-veg only</option>
        </select>
        <select value={cuisine} onChange={(e) => setCuisine(e.target.value)}
          className="border border-input rounded-md px-2 h-9 text-xs bg-background">
          <option value="">Any cuisine</option>
          <option value="north-indian">North Indian</option>
          <option value="south-indian">South Indian</option>
          <option value="indian">Indian</option>
          <option value="indo-chinese">Indo-Chinese</option>
          <option value="bengali">Bengali</option>
          <option value="punjabi">Punjabi</option>
          <option value="gujarati">Gujarati</option>
          <option value="mughlai">Mughlai</option>
        </select>
        <select value={mealType} onChange={(e) => setMealType(e.target.value)}
          className="border border-input rounded-md px-2 h-9 text-xs bg-background">
          <option value="">Any course</option>
          <option value="breakfast">Breakfast</option>
          <option value="starter">Starter</option>
          <option value="main">Main</option>
          <option value="curry">Curry</option>
          <option value="rice">Rice</option>
          <option value="bread">Bread</option>
          <option value="dessert">Dessert</option>
          <option value="drink">Drink</option>
          <option value="snack">Snack</option>
          <option value="side">Side</option>
        </select>
        <select value={spice} onChange={(e) => setSpice(e.target.value)}
          className="border border-input rounded-md px-2 h-9 text-xs bg-background">
          <option value="">Any spice</option>
          <option value="0">Mild</option>
          <option value="1">Light</option>
          <option value="2">Medium</option>
          <option value="3">Hot</option>
        </select>
        {q && <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setQ("")}><X className="w-4 h-4" /></Button>}
      </div>

      {/* Recent (this restaurant) */}
      {!debounced && !cuisine && !mealType && !spice && recent && recent.rows.length > 0 && (
        <Section label="Recently used by your restaurant" rows={recent.rows} onPick={onPick} />
      )}

      {/* Suggested for current item */}
      {!debounced && !cuisine && !mealType && !spice && suggest && suggest.suggestions.length > 0 && (
        <Section label={`Suggested for "${itemName}"`} rows={suggest.suggestions} onPick={onPick} />
      )}

      {/* Popular fallback */}
      {!debounced && !cuisine && !mealType && !spice && popular && popular.rows.length > 0 && (
        <Section label="Popular across all restaurants" rows={popular.rows} onPick={onPick} />
      )}

      {/* Main grid */}
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          {debounced || cuisine || mealType || spice ? `Results (${data?.total ?? 0})` : "Browse library"}
        </p>
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No matching images.
          </div>
        ) : (
          <Grid rows={data.rows} onPick={onPick} />
        )}
      </div>
    </div>
  );
}

function Section({ label, rows, onPick }: { label: string; rows: StockFoodImage[]; onPick: (r: StockFoodImage) => void }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{label}</p>
      <Grid rows={rows} onPick={onPick} compact />
    </div>
  );
}

function Grid({ rows, onPick, compact = false }: { rows: StockFoodImage[]; onPick: (r: StockFoodImage) => void; compact?: boolean }) {
  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-6" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4"}`}>
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          onClick={() => onPick(row)}
          className="group relative aspect-square rounded-lg overflow-hidden border border-border hover:border-primary hover:ring-2 hover:ring-primary/30 transition bg-muted text-left"
          title={row.name}
        >
          <img
            src={row.thumbnailUrl || row.imageUrl}
            alt={row.name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
          />
          {row.isFeatured && (
            <span className="absolute top-1 left-1 bg-amber-500 text-white rounded-full p-0.5" title="Featured">
              <Star className="w-2.5 h-2.5 fill-white" />
            </span>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
            <p className="text-[10px] font-medium text-white line-clamp-1">{row.name}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <span className={`inline-block w-1.5 h-1.5 rounded-sm ${row.isVeg ? "bg-green-500" : "bg-red-500"}`} />
              {row.cuisine && <span className="text-[8px] text-white/80 truncate">{row.cuisine}</span>}
              {row.spiceLevel != null && row.spiceLevel > 0 && (
                <span className="text-[8px] text-orange-300 ml-auto flex items-center"><Flame className="w-2 h-2" />{row.spiceLevel}</span>
              )}
            </div>
          </div>
          <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
            <div className="bg-primary text-primary-foreground rounded-full p-1.5"><Check className="w-3 h-3" /></div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── Reuse tab ────────────────────────────────────────────────────────
function ReuseTab({ restaurantId, onPick }: { restaurantId: number | undefined; onPick: (url: string) => void }) {
  const { data, isLoading } = useQuery<{ rows: RecentPhotoRow[] }>({
    queryKey: ["stock-food-images", "restaurant-recent", restaurantId],
    queryFn: () => apiGet(`/stock-food-images/restaurant/recent-photos?restaurantId=${restaurantId}&limit=24`),
    enabled: !!restaurantId,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>;
  }
  if (!data || data.rows.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-muted-foreground">
        <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
        No photos uploaded or generated yet — once you upload or AI-generate item photos they'll appear here for easy reuse.
      </div>
    );
  }
  return (
    <div className="py-3">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Photos already used by your restaurant — free to reuse
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {data.rows.map((r) => (
          <button
            key={r.image_url}
            type="button"
            onClick={() => onPick(r.image_url)}
            className="group relative aspect-square rounded-lg overflow-hidden border border-border hover:border-primary hover:ring-2 hover:ring-primary/30 transition bg-muted text-left"
            title={r.menu_item_name ?? r.image_url}
          >
            <img src={resolveUrl(r.image_url)} alt={r.menu_item_name ?? ""} loading="lazy"
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }} />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
              <p className="text-[10px] font-medium text-white line-clamp-1">{r.menu_item_name ?? "—"}</p>
              <p className="text-[8px] text-white/70 capitalize">{r.source.replace("_", " ")}</p>
            </div>
            <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
              <div className="bg-primary text-primary-foreground rounded-full p-1.5"><Check className="w-3 h-3" /></div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Upload tab ───────────────────────────────────────────────────────
function UploadTab({ restaurantId, onUploaded }: { restaurantId: number | undefined; onUploaded: (url: string) => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    if (!restaurantId) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please choose an image file", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const presign = await apiPost<{ uploadURL: string; objectPath: string }>(
        `/restaurants/${restaurantId}/storage/uploads/request-url`,
        { name: file.name, size: file.size, contentType: file.type },
      );
      const put = await fetch(presign.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!put.ok) throw new Error("Upload failed");
      await apiPost(`/restaurants/${restaurantId}/storage/uploads/finalize-public`, { objectPath: presign.objectPath });
      onUploaded(presign.objectPath);
    } catch (e: unknown) {
      toast({ title: (e as { message?: string })?.message ?? "Upload failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-6 flex items-center justify-center">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false);
          const f = e.dataTransfer.files?.[0]; if (f) void handleFile(f);
        }}
        onClick={() => !busy && fileRef.current?.click()}
        className={`w-full max-w-md aspect-[4/3] rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-sm gap-2 cursor-pointer transition ${
          dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:bg-muted/40"
        }`}
      >
        {busy ? (
          <><Loader2 className="w-6 h-6 animate-spin" /> Uploading…</>
        ) : (
          <>
            <Upload className="w-8 h-8 text-muted-foreground" />
            <p className="font-medium">Drag & drop a photo</p>
            <p className="text-xs text-muted-foreground">or click to browse — JPG, PNG, WebP</p>
          </>
        )}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }} />
      </div>
    </div>
  );
}

// ─── AI tab ───────────────────────────────────────────────────────────
function AiTab({ restaurantId, itemId, onGenerated }: { restaurantId: number | undefined; itemId?: number; onGenerated: (url: string) => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const generate = async () => {
    if (!restaurantId || !itemId) {
      toast({ title: "Save the item first, then generate an AI photo", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ payload: { imageUrl: string } }>(
        `/restaurants/${restaurantId}/items/${itemId}/ai-photo`, {},
      );
      setPreviewUrl(res.payload.imageUrl);
    } catch (e: unknown) {
      toast({ title: (e as { message?: string })?.message ?? "AI photo failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-6 flex flex-col items-center justify-center gap-4 max-w-md mx-auto text-center">
      <Sparkles className="w-10 h-10 text-violet-500" />
      <div>
        <p className="font-medium">Generate an AI photo</p>
        <p className="text-xs text-muted-foreground mt-1">
          Costs 1 AI credit. Requires an active plan with image credits.
          {!itemId && " Save the item first to enable generation."}
        </p>
      </div>
      {previewUrl ? (
        <div className="w-full space-y-3">
          <img src={resolveUrl(previewUrl)} alt="AI preview" className="w-full rounded-lg border border-border" />
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => { setPreviewUrl(null); void generate(); }} disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Regenerate
            </Button>
            <Button onClick={() => onGenerated(previewUrl)}>Use this photo</Button>
          </div>
        </div>
      ) : (
        <Button onClick={generate} disabled={busy || !itemId} size="lg">
          {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating…</> : <><Sparkles className="w-4 h-4 mr-2" /> Generate photo</>}
        </Button>
      )}
    </div>
  );
}

function resolveUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("/objects/")) {
    const base = (import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "");
    return `${base}/api/public/storage${url}`;
  }
  return url;
}
