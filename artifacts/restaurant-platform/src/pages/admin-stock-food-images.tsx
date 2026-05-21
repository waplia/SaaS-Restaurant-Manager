/**
 * Super-admin curator UI for the global food image library.
 *
 * Tabs:
 *  - Images:  full grid with filter chips, multi-select, bulk approve/
 *             feature/deactivate, edit modal, usage drawer.
 *  - AI jobs: bulk image generation queue — create a job with N dish
 *             prompts, watch progress, cancel pending jobs.
 *  - Import:  JSON paste bulk-importer.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Search, Pencil, Trash2, Loader2, ImageIcon, X, Upload, RefreshCw, FileUp,
  Star, CheckCircle2, XCircle, Eye, Sparkles, ListChecks, Activity, Flame,
} from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { StockFoodImage } from "@/components/StockImagePicker";

interface StockImageRow extends StockFoodImage {
  source?: string | null;
  dietaryType?: string | null;
  mealType?: string | null;
  spiceLevel?: number | null;
  provider?: string | null;
  model?: string | null;
  licenseStatus?: string;
  isApproved?: boolean;
  isFeatured?: boolean;
  usageCount?: number;
  generationJobId?: number | null;
}

interface ListResponse { rows: StockImageRow[]; total: number; limit: number; offset: number; }

interface FormState {
  name: string;
  slug: string;
  cuisine: string;
  category: string;
  imageUrl: string;
  thumbnailUrl: string;
  aliases: string;
  tags: string;
  isVeg: boolean;
  isActive: boolean;
  sortOrder: string;
  attribution: string;
  dietaryType: string;
  mealType: string;
  spiceLevel: string;
  provider: string;
  licenseStatus: "approved" | "restricted" | "unknown";
  isApproved: boolean;
  isFeatured: boolean;
}

const EMPTY_FORM: FormState = {
  name: "", slug: "", cuisine: "", category: "",
  imageUrl: "", thumbnailUrl: "", aliases: "", tags: "",
  isVeg: true, isActive: true, sortOrder: "0", attribution: "",
  dietaryType: "", mealType: "", spiceLevel: "",
  provider: "", licenseStatus: "unknown", isApproved: true, isFeatured: false,
};

function toForm(row: StockImageRow): FormState {
  return {
    name: row.name,
    slug: row.slug,
    cuisine: row.cuisine ?? "",
    category: row.category ?? "",
    imageUrl: row.imageUrl,
    thumbnailUrl: row.thumbnailUrl ?? "",
    aliases: (row.aliases ?? []).join(", "),
    tags: (row.tags ?? []).join(", "),
    isVeg: row.isVeg,
    isActive: row.isActive,
    sortOrder: String(row.sortOrder ?? 0),
    attribution: row.attribution ?? "",
    dietaryType: row.dietaryType ?? "",
    mealType: row.mealType ?? "",
    spiceLevel: row.spiceLevel != null ? String(row.spiceLevel) : "",
    provider: row.provider ?? "",
    licenseStatus: (row.licenseStatus as FormState["licenseStatus"]) ?? "unknown",
    isApproved: row.isApproved ?? true,
    isFeatured: row.isFeatured ?? false,
  };
}

function splitList(s: string): string[] {
  return s.split(",").map((t) => t.trim()).filter(Boolean);
}

type Tab = "images" | "jobs" | "import";

export default function AdminStockFoodImagesTab() {
  const [tab, setTab] = useState<Tab>("images");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-border">
        <SubTab active={tab === "images"} onClick={() => setTab("images")} icon={<ImageIcon className="w-3.5 h-3.5" />}>Images</SubTab>
        <SubTab active={tab === "jobs"} onClick={() => setTab("jobs")} icon={<Sparkles className="w-3.5 h-3.5" />}>AI Jobs</SubTab>
        <SubTab active={tab === "import"} onClick={() => setTab("import")} icon={<FileUp className="w-3.5 h-3.5" />}>Bulk import</SubTab>
      </div>
      {tab === "images" && <ImagesTab />}
      {tab === "jobs" && <JobsTab />}
      {tab === "import" && <ImportTab />}
    </div>
  );
}

function SubTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition ${
        active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}>
      {icon}{children}
    </button>
  );
}

// ─── Images tab ───────────────────────────────────────────────────────
function ImagesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  // Debounced copy of `q` — keeps each keystroke from triggering an
  // immediate refetch + re-render, which otherwise drops fast typing
  // and makes the search box feel sluggish on large catalogs.
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const [cuisine, setCuisine] = useState("");
  const [mealType, setMealType] = useState("");
  const [source, setSource] = useState("");
  const [approved, setApproved] = useState<"any" | "true" | "false">("any");
  const [featured, setFeatured] = useState<"any" | "true" | "false">("any");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [sort, setSort] = useState<"recent" | "name" | "usage" | "featured">("recent");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [modalState, setModalState] = useState<{ mode: "create" } | { mode: "edit"; row: StockImageRow } | null>(null);
  const [deleting, setDeleting] = useState<StockImageRow | null>(null);
  const [usageRow, setUsageRow] = useState<StockImageRow | null>(null);

  const reseedMutation = useMutation({
    mutationFn: async () => apiPost<{ ok: boolean; total: number }>(`/admin/stock-food-images/reseed`, {}),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["admin", "stock-food-images"] });
      qc.invalidateQueries({ queryKey: ["stock-food-images"] });
      toast({ title: "Catalog re-seeded", description: `Library now has ${data.total} images.` });
    },
    onError: (err: Error) => toast({ title: "Re-seed failed", description: err.message, variant: "destructive" }),
  });

  const bulkAction = useMutation({
    mutationFn: async ({ action }: { action: string }) =>
      apiPost<{ updated: number }>(`/admin/stock-food-images/bulk-action`, { ids: Array.from(selected), action }),
    onSuccess: (data, vars) => {
      toast({ title: `${vars.action} applied`, description: `${data.updated} image(s) updated.` });
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["admin", "stock-food-images"] });
      qc.invalidateQueries({ queryKey: ["stock-food-images"] });
    },
    onError: (err: Error) => toast({ title: "Bulk action failed", description: err.message, variant: "destructive" }),
  });

  const params = useMemo(() => {
    const s = new URLSearchParams();
    if (debouncedQ.trim()) s.set("q", debouncedQ.trim());
    if (cuisine) s.set("cuisine", cuisine);
    if (mealType) s.set("mealType", mealType);
    if (source) s.set("source", source);
    if (approved !== "any") s.set("approved", approved);
    if (featured !== "any") s.set("featured", featured);
    if (includeInactive) s.set("includeInactive", "true");
    s.set("sort", sort);
    s.set("limit", "200");
    return s.toString();
  }, [debouncedQ, cuisine, mealType, source, approved, featured, includeInactive, sort]);

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ["admin", "stock-food-images", params],
    queryFn: () => apiGet(`/admin/stock-food-images?${params}`),
  });

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (!data) return;
    if (selected.size === data.rows.length) setSelected(new Set());
    else setSelected(new Set(data.rows.map((r) => r.id)));
  };

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dishes, aliases, slugs…" className="pl-8 h-9" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => reseedMutation.mutate()} disabled={reseedMutation.isPending}>
            {reseedMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            Re-seed
          </Button>
          <Button size="sm" onClick={() => setModalState({ mode: "create" })}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add image
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs">
        <select value={cuisine} onChange={(e) => setCuisine(e.target.value)} className="border border-input rounded-md px-2 h-8 bg-background">
          <option value="">All cuisines</option>
          <option value="north-indian">North Indian</option>
          <option value="south-indian">South Indian</option>
          <option value="indian">Indian</option>
          <option value="indo-chinese">Indo-Chinese</option>
          <option value="bengali">Bengali</option>
          <option value="punjabi">Punjabi</option>
          <option value="gujarati">Gujarati</option>
          <option value="mughlai">Mughlai</option>
        </select>
        <select value={mealType} onChange={(e) => setMealType(e.target.value)} className="border border-input rounded-md px-2 h-8 bg-background">
          <option value="">All courses</option>
          <option value="breakfast">Breakfast</option><option value="starter">Starter</option>
          <option value="main">Main</option><option value="curry">Curry</option>
          <option value="rice">Rice</option><option value="bread">Bread</option>
          <option value="dessert">Dessert</option><option value="drink">Drink</option>
          <option value="snack">Snack</option><option value="side">Side</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="border border-input rounded-md px-2 h-8 bg-background">
          <option value="">All sources</option>
          <option value="seed">Seed</option>
          <option value="manual">Manual</option>
          <option value="ai">AI generated</option>
        </select>
        <select value={approved} onChange={(e) => setApproved(e.target.value as typeof approved)} className="border border-input rounded-md px-2 h-8 bg-background">
          <option value="any">Any approval</option>
          <option value="true">Approved</option>
          <option value="false">Pending</option>
        </select>
        <select value={featured} onChange={(e) => setFeatured(e.target.value as typeof featured)} className="border border-input rounded-md px-2 h-8 bg-background">
          <option value="any">Any</option>
          <option value="true">Featured</option>
          <option value="false">Not featured</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="border border-input rounded-md px-2 h-8 bg-background">
          <option value="recent">Newest</option>
          <option value="name">Name</option>
          <option value="usage">Most used</option>
          <option value="featured">Featured first</option>
        </select>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap bg-primary/5 border border-primary/30 rounded-md px-3 py-2 text-xs">
          <ListChecks className="w-4 h-4 text-primary" />
          <span className="font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" className="h-7" onClick={() => bulkAction.mutate({ action: "approve" })} disabled={bulkAction.isPending}>
            <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
          </Button>
          <Button size="sm" variant="outline" className="h-7" onClick={() => bulkAction.mutate({ action: "unapprove" })} disabled={bulkAction.isPending}>
            <XCircle className="w-3 h-3 mr-1" /> Un-approve
          </Button>
          <Button size="sm" variant="outline" className="h-7" onClick={() => bulkAction.mutate({ action: "feature" })} disabled={bulkAction.isPending}>
            <Star className="w-3 h-3 mr-1" /> Feature
          </Button>
          <Button size="sm" variant="outline" className="h-7" onClick={() => bulkAction.mutate({ action: "unfeature" })} disabled={bulkAction.isPending}>
            Un-feature
          </Button>
          <Button size="sm" variant="outline" className="h-7" onClick={() => bulkAction.mutate({ action: "deactivate" })} disabled={bulkAction.isPending}>
            <X className="w-3 h-3 mr-1" /> Deactivate
          </Button>
          <Button size="sm" variant="ghost" className="h-7 ml-auto" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : !data || data.rows.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
          <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
          No images match the current filters.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={selected.size === data.rows.length && data.rows.length > 0} onChange={toggleAll} />
              Select all on page
            </label>
            <span className="ml-auto">{data.total} image(s)</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {data.rows.map((row) => (
              <ImageCard
                key={row.id}
                row={row}
                checked={selected.has(row.id)}
                onToggle={() => toggle(row.id)}
                onEdit={() => setModalState({ mode: "edit", row })}
                onDelete={() => setDeleting(row)}
                onUsage={() => setUsageRow(row)}
              />
            ))}
          </div>
        </>
      )}

      {modalState && (
        <EditModal
          mode={modalState.mode}
          row={modalState.mode === "edit" ? modalState.row : null}
          onClose={() => setModalState(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["admin", "stock-food-images"] });
            qc.invalidateQueries({ queryKey: ["stock-food-images"] });
            toast({ title: "Saved" });
            setModalState(null);
          }}
        />
      )}
      {deleting && (
        <DeleteModal
          row={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            qc.invalidateQueries({ queryKey: ["admin", "stock-food-images"] });
            qc.invalidateQueries({ queryKey: ["stock-food-images"] });
            toast({ title: "Image deactivated" });
            setDeleting(null);
          }}
        />
      )}
      {usageRow && <UsageDrawer row={usageRow} onClose={() => setUsageRow(null)} />}
    </div>
  );
}

function ImageCard({
  row, checked, onToggle, onEdit, onDelete, onUsage,
}: {
  row: StockImageRow; checked: boolean;
  onToggle: () => void; onEdit: () => void; onDelete: () => void; onUsage: () => void;
}) {
  return (
    <div className={`border rounded-lg overflow-hidden bg-card group transition ${checked ? "border-primary ring-2 ring-primary/30" : "border-border"}`}>
      <div className="aspect-square bg-muted relative">
        <img
          src={row.thumbnailUrl || row.imageUrl} alt={row.name} loading="lazy"
          className="w-full h-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
        />
        <div className="absolute top-1 left-1">
          <input type="checkbox" checked={checked} onChange={onToggle} className="w-4 h-4 accent-primary" />
        </div>
        <div className="absolute top-1 right-1 flex flex-col gap-1">
          {row.isFeatured && <span className="bg-amber-500 text-white rounded-full p-1" title="Featured"><Star className="w-3 h-3 fill-white" /></span>}
          {row.isApproved === false && <span className="bg-yellow-500 text-white rounded-full text-[9px] px-1.5 py-0.5 font-bold" title="Pending approval">PEND</span>}
          {row.source === "ai" && <span className="bg-violet-500 text-white rounded-full p-1" title="AI generated"><Sparkles className="w-3 h-3" /></span>}
        </div>
        {!row.isActive && (
          <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Inactive</span>
          </div>
        )}
        {(row.usageCount ?? 0) > 0 && (
          <span className="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] font-medium px-1.5 py-0.5 rounded">
            {row.usageCount} use{row.usageCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="p-2 space-y-1">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-sm flex-shrink-0 ${row.isVeg ? "bg-green-500" : "bg-red-500"}`} />
          <p className="text-xs font-medium truncate flex-1" title={row.name}>{row.name}</p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {row.cuisine && <span className="text-[9px] bg-muted px-1 rounded">{row.cuisine}</span>}
          {row.mealType && <span className="text-[9px] bg-muted px-1 rounded">{row.mealType}</span>}
          {row.dietaryType && <span className="text-[9px] bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 px-1 rounded">{row.dietaryType}</span>}
          {row.spiceLevel != null && row.spiceLevel > 0 && (
            <span className="text-[9px] text-orange-600 flex items-center"><Flame className="w-2.5 h-2.5" />{row.spiceLevel}</span>
          )}
        </div>
        <div className="flex items-center gap-1 pt-1">
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={onUsage} title="Where is this used?">
            <Eye className="w-3 h-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={onEdit} title="Edit">
            <Pencil className="w-3 h-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs text-destructive ml-auto" onClick={onDelete} title="Deactivate">
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit modal ───────────────────────────────────────────────────────
function EditModal({
  mode, row, onClose, onSaved,
}: {
  mode: "create" | "edit";
  row: StockImageRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(row ? toForm(row) : EMPTY_FORM);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim() || undefined,
        cuisine: form.cuisine.trim() || null,
        category: form.category.trim() || null,
        imageUrl: form.imageUrl.trim(),
        thumbnailUrl: form.thumbnailUrl.trim() || null,
        aliases: splitList(form.aliases),
        tags: splitList(form.tags),
        isVeg: form.isVeg,
        isActive: form.isActive,
        sortOrder: Number(form.sortOrder) || 0,
        attribution: form.attribution.trim() || null,
        dietaryType: form.dietaryType.trim() || null,
        mealType: form.mealType.trim() || null,
        spiceLevel: form.spiceLevel === "" ? null : Number(form.spiceLevel),
        provider: form.provider.trim() || null,
        licenseStatus: form.licenseStatus,
        isApproved: form.isApproved,
        isFeatured: form.isFeatured,
      };
      if (mode === "edit" && row) {
        return apiPatch(`/admin/stock-food-images/${row.id}`, payload);
      }
      return apiPost(`/admin/stock-food-images`, payload);
    },
    onSuccess: onSaved,
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const disabled = !form.name.trim() || !form.imageUrl.trim();

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit image" : "Add image"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Name <span className="text-destructive">*</span></Label>
            <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Paneer Tikka" />
          </div>
          <div>
            <Label>Slug</Label>
            <Input value={form.slug} onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))} placeholder="auto from name" />
          </div>
          <div>
            <Label>Sort order</Label>
            <Input type="number" value={form.sortOrder} onChange={(e) => setForm((p) => ({ ...p, sortOrder: e.target.value }))} />
          </div>
          <div>
            <Label>Cuisine</Label>
            <Input value={form.cuisine} onChange={(e) => setForm((p) => ({ ...p, cuisine: e.target.value }))} placeholder="north-indian, south-indian…" />
          </div>
          <div>
            <Label>Category</Label>
            <Input value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} placeholder="curry, snack, bread, rice…" />
          </div>
          <div>
            <Label>Dietary type</Label>
            <select value={form.dietaryType} onChange={(e) => setForm((p) => ({ ...p, dietaryType: e.target.value }))}
              className="w-full mt-1 border border-input rounded-md px-2 py-2 text-sm bg-background">
              <option value="">—</option>
              <option value="veg">Veg</option>
              <option value="non-veg">Non-veg</option>
              <option value="vegan">Vegan</option>
              <option value="egg">Egg</option>
              <option value="jain">Jain</option>
            </select>
          </div>
          <div>
            <Label>Meal type</Label>
            <select value={form.mealType} onChange={(e) => setForm((p) => ({ ...p, mealType: e.target.value }))}
              className="w-full mt-1 border border-input rounded-md px-2 py-2 text-sm bg-background">
              <option value="">—</option>
              <option value="breakfast">Breakfast</option><option value="starter">Starter</option>
              <option value="main">Main</option><option value="curry">Curry</option>
              <option value="rice">Rice</option><option value="bread">Bread</option>
              <option value="dessert">Dessert</option><option value="drink">Drink</option>
              <option value="snack">Snack</option><option value="side">Side</option>
            </select>
          </div>
          <div>
            <Label>Spice level (0–3)</Label>
            <Input type="number" min={0} max={3} value={form.spiceLevel} onChange={(e) => setForm((p) => ({ ...p, spiceLevel: e.target.value }))} placeholder="0 = mild, 3 = hot" />
          </div>
          <div>
            <Label>Provider</Label>
            <Input value={form.provider} onChange={(e) => setForm((p) => ({ ...p, provider: e.target.value }))} placeholder="wikimedia, openai, upload…" />
          </div>
          <div>
            <Label>License status</Label>
            <select value={form.licenseStatus} onChange={(e) => setForm((p) => ({ ...p, licenseStatus: e.target.value as FormState["licenseStatus"] }))}
              className="w-full mt-1 border border-input rounded-md px-2 py-2 text-sm bg-background">
              <option value="approved">Approved</option>
              <option value="restricted">Restricted</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
          <div className="col-span-2">
            <Label>Image <span className="text-destructive">*</span></Label>
            <StockImageUploadField value={form.imageUrl} onChange={(url) => setForm((p) => ({ ...p, imageUrl: url }))} />
          </div>
          <div className="col-span-2">
            <Label>Thumbnail URL</Label>
            <Input value={form.thumbnailUrl} onChange={(e) => setForm((p) => ({ ...p, thumbnailUrl: e.target.value }))} placeholder="Optional — smaller preview" />
          </div>
          <div className="col-span-2">
            <Label>Aliases (comma-separated)</Label>
            <Input value={form.aliases} onChange={(e) => setForm((p) => ({ ...p, aliases: e.target.value }))} placeholder="paneer makhani, butter paneer" />
            <p className="text-[10px] text-muted-foreground mt-0.5">Boosts auto-match during AI menu import.</p>
          </div>
          <div className="col-span-2">
            <Label>Tags (comma-separated)</Label>
            <Input value={form.tags} onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))} placeholder="popular, tandoor, creamy" />
          </div>
          <div className="col-span-2">
            <Label>Attribution</Label>
            <Input value={form.attribution} onChange={(e) => setForm((p) => ({ ...p, attribution: e.target.value }))} placeholder="Wikimedia Commons / photographer" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isVeg} onChange={(e) => setForm((p) => ({ ...p, isVeg: e.target.checked }))} />
            Vegetarian
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))} />
            Active
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isApproved} onChange={(e) => setForm((p) => ({ ...p, isApproved: e.target.checked }))} />
            Approved (visible to tenants)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm((p) => ({ ...p, isFeatured: e.target.checked }))} />
            Featured
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={disabled || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {mode === "edit" ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Upload field for admin (uses /admin/stock-food-images/uploads) ───
function StockImageUploadField({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [showUrl, setShowUrl] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please choose an image file", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const presign = await apiPost<{ uploadURL: string; objectPath: string }>(
        `/admin/stock-food-images/uploads/request-url`,
        { name: file.name, size: file.size, contentType: file.type },
      );
      const put = await fetch(presign.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!put.ok) throw new Error("Upload failed");
      const fin = await apiPost<{ publicUrl: string }>(
        `/admin/stock-food-images/uploads/finalize`, { objectPath: presign.objectPath },
      );
      onChange(fin.publicUrl);
      toast({ title: "Image uploaded" });
    } catch (e: unknown) {
      toast({ title: (e as { message?: string })?.message ?? "Upload failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1" />} Upload
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowUrl((s) => !s)}>URL</Button>
        {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange("")}><X className="w-3.5 h-3.5" /></Button>}
        <span className="text-[10px] text-muted-foreground truncate flex-1">{value || "No image"}</span>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }} />
      {showUrl && (
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://… or /objects/…" />
      )}
      {value && (
        <img src={value} alt="preview" className="max-h-32 rounded border border-border object-contain bg-muted"
          onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }} />
      )}
    </div>
  );
}

// ─── Delete modal ─────────────────────────────────────────────────────
function DeleteModal({ row, onClose, onDeleted }: { row: StockImageRow; onClose: () => void; onDeleted: () => void }) {
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: async () => apiDelete(`/admin/stock-food-images/${row.id}`),
    onSuccess: onDeleted,
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><X className="w-4 h-4" /> Deactivate "{row.name}"?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          The image is hidden from the tenant picker. Menu items already using this image keep working — we deactivate rather than delete.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Deactivate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Usage drawer ─────────────────────────────────────────────────────
function UsageDrawer({ row, onClose }: { row: StockImageRow; onClose: () => void }) {
  const { data, isLoading } = useQuery<{
    image: StockImageRow;
    usages: Array<{ id: number; restaurant_id: number; menu_item_id: number; source: string; image_url: string; created_at: string; menu_item_name: string | null }>;
  }>({
    queryKey: ["admin", "stock-food-images", "usage", row.id],
    queryFn: () => apiGet(`/admin/stock-food-images/${row.id}/usage?limit=100`),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Activity className="w-4 h-4" /> "{row.name}" usage</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <img src={row.thumbnailUrl || row.imageUrl} alt="" className="w-20 h-20 object-cover rounded border border-border" />
            <div className="text-sm">
              <p className="font-medium">{row.name}</p>
              <p className="text-xs text-muted-foreground">Total uses: {row.usageCount ?? 0}</p>
              <p className="text-xs text-muted-foreground">Slug: {row.slug}</p>
            </div>
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
            </div>
          ) : !data || data.usages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Not yet attached to any menu item.</p>
          ) : (
            <div className="border border-border rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted text-left">
                  <tr>
                    <th className="px-2 py-1.5">Restaurant</th>
                    <th className="px-2 py-1.5">Menu item</th>
                    <th className="px-2 py-1.5">Source</th>
                    <th className="px-2 py-1.5">When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.usages.map((u) => (
                    <tr key={u.id} className="border-t border-border">
                      <td className="px-2 py-1.5">#{u.restaurant_id}</td>
                      <td className="px-2 py-1.5">{u.menu_item_name ?? `#${u.menu_item_id}`}</td>
                      <td className="px-2 py-1.5 capitalize">{u.source.replace("_", " ")}</td>
                      <td className="px-2 py-1.5">{new Date(u.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── AI Jobs tab ──────────────────────────────────────────────────────
interface AiJobRow {
  id: number;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  total: number;
  succeeded: number;
  failed: number;
  prompt: string | null;
  provider: string | null;
  createdAt: string;
  finishedAt: string | null;
  createdBy: number | null;
}

function JobsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading } = useQuery<{ rows: AiJobRow[] }>({
    queryKey: ["admin", "stock-food-images", "ai-jobs"],
    queryFn: () => apiGet(`/admin/stock-food-images/ai-jobs`),
    refetchInterval: 5000,
  });
  const cancel = useMutation({
    mutationFn: async (id: number) => apiPost(`/admin/stock-food-images/ai-jobs/${id}/cancel`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "stock-food-images", "ai-jobs"] });
      toast({ title: "Job cancelled" });
    },
    onError: (e: Error) => toast({ title: "Cancel failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Background jobs that generate AI photos and add them straight to the library.</p>
        <Button size="sm" onClick={() => setShowCreate(true)}><Sparkles className="w-3.5 h-3.5 mr-1" /> New AI job</Button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      ) : !data || data.rows.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
          No AI generation jobs yet.
        </div>
      ) : (
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Progress</th>
                <th className="px-2 py-1.5">Provider</th>
                <th className="px-2 py-1.5">Created</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((j) => (
                <tr key={j.id} className="border-t border-border">
                  <td className="px-2 py-1.5 font-mono">#{j.id}</td>
                  <td className="px-2 py-1.5">
                    <StatusBadge status={j.status} />
                  </td>
                  <td className="px-2 py-1.5">
                    {j.succeeded + j.failed}/{j.total}
                    {j.failed > 0 && <span className="text-red-600 ml-1">({j.failed} failed)</span>}
                  </td>
                  <td className="px-2 py-1.5">{j.provider ?? "—"}</td>
                  <td className="px-2 py-1.5">{new Date(j.createdAt).toLocaleString()}</td>
                  <td className="px-2 py-1.5">
                    {(j.status === "pending" || j.status === "running") && (
                      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => cancel.mutate(j.id)}>Cancel</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showCreate && (
        <CreateJobModal onClose={() => setShowCreate(false)} onCreated={() => {
          setShowCreate(false);
          qc.invalidateQueries({ queryKey: ["admin", "stock-food-images", "ai-jobs"] });
        }} />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: AiJobRow["status"] }) {
  const map = {
    pending: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    running: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    cancelled: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  };
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${map[status]}`}>{status}</span>;
}

function CreateJobModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [cuisine, setCuisine] = useState("indian");
  const [category, setCategory] = useState("");
  const [provider, setProvider] = useState("openai");
  const [isVeg, setIsVeg] = useState(true);

  const mut = useMutation({
    mutationFn: async () => {
      const items = text.split("\n").map((l) => l.trim()).filter(Boolean).map((name) => ({
        name, cuisine, category: category || null, isVeg,
      }));
      if (items.length === 0) throw new Error("Add at least one dish name.");
      return apiPost<{ jobId: number; total: number }>(`/admin/stock-food-images/ai-jobs`, {
        items, provider, cuisine, category: category || null,
      });
    },
    onSuccess: (data) => {
      toast({ title: "Job queued", description: `Generating ${data.total} images.` });
      onCreated();
    },
    onError: (e: Error) => toast({ title: "Failed to queue", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-500" /> Bulk AI image generation</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Paste one dish name per line. Each one generates an AI photo, uploads it, and adds a new approved library row.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Cuisine</Label>
              <Input value={cuisine} onChange={(e) => setCuisine(e.target.value)} className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="curry, snack…" className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Provider</Label>
              <select value={provider} onChange={(e) => setProvider(e.target.value)}
                className="w-full mt-1 border border-input rounded-md px-2 h-8 text-xs bg-background">
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={isVeg} onChange={(e) => setIsVeg(e.target.checked)} />
            Mark all as vegetarian
          </label>
          <textarea
            value={text} onChange={(e) => setText(e.target.value)}
            placeholder={"Paneer Tikka\nMasala Dosa\nButter Chicken\n…"}
            rows={10}
            className="w-full font-mono text-xs p-2 border border-border rounded bg-muted/30"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!text.trim() || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Queue job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk import tab ──────────────────────────────────────────────────
function ImportTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [overwrite, setOverwrite] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      let entries: unknown;
      try { entries = JSON.parse(text); }
      catch { throw new Error("Invalid JSON — must be an array of dish objects."); }
      if (!Array.isArray(entries) || entries.length === 0) throw new Error("Provide a non-empty JSON array.");
      return apiPost<{ inserted: number; updated: number; skipped: number; errors: Array<{ name: string; error: string }> }>(
        `/admin/stock-food-images/bulk`, { entries, overwrite },
      );
    },
    onSuccess: (data) => {
      toast({ title: "Bulk import done", description: `${data.inserted} added, ${data.updated} updated, ${data.skipped} skipped${data.errors.length ? `, ${data.errors.length} failed` : ""}.` });
      qc.invalidateQueries({ queryKey: ["admin", "stock-food-images"] });
      qc.invalidateQueries({ queryKey: ["stock-food-images"] });
    },
    onError: (err: Error) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const example = `[\n  {\n    "name": "Paneer Tikka",\n    "cuisine": "north-indian",\n    "category": "starter",\n    "imageUrl": "https://example.com/paneer-tikka.jpg",\n    "aliases": ["tandoori paneer"],\n    "tags": ["popular"],\n    "isVeg": true,\n    "dietaryType": "veg",\n    "mealType": "starter",\n    "spiceLevel": 2\n  }\n]`;

  return (
    <div className="space-y-3 max-w-3xl">
      <p className="text-xs text-muted-foreground">
        Paste a JSON array of dishes. Each entry needs at minimum a <code>name</code> and <code>imageUrl</code>.
        Rows already present (matched by slug) are skipped unless you tick Overwrite.
      </p>
      <textarea
        value={text} onChange={(e) => setText(e.target.value)} placeholder={example} rows={16}
        className="w-full font-mono text-xs p-2 border border-border rounded bg-muted/30"
      />
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          Overwrite existing rows with the same slug
        </label>
        <Button disabled={!text.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
          Import
        </Button>
      </div>
    </div>
  );
}
