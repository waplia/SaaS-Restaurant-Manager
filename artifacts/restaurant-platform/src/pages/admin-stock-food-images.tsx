/**
 * Super-admin curator UI for the global stock food image library.
 * Lists, searches, creates, edits, and deactivates entries that every
 * tenant can then pick from inside their menu editor.
 *
 * Rendered as the `stock-food-images` section of /admin (see admin.tsx).
 */
import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Pencil, Trash2, Loader2, ImageIcon, X, Upload, RefreshCw, FileUp } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { StockFoodImage } from "@/components/StockImagePicker";

interface ListResponse { rows: StockFoodImage[]; total: number; limit: number; offset: number; }

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
}

const EMPTY_FORM: FormState = {
  name: "", slug: "", cuisine: "", category: "",
  imageUrl: "", thumbnailUrl: "", aliases: "", tags: "",
  isVeg: true, isActive: true, sortOrder: "0", attribution: "",
};

function toForm(row: StockFoodImage): FormState {
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
  };
}

function splitList(s: string): string[] {
  return s.split(",").map((t) => t.trim()).filter(Boolean);
}

export default function AdminStockFoodImagesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [modalState, setModalState] = useState<{ mode: "create" } | { mode: "edit"; row: StockFoodImage } | null>(null);
  const [deleting, setDeleting] = useState<StockFoodImage | null>(null);
  const [showBulk, setShowBulk] = useState(false);

  const reseedMutation = useMutation({
    mutationFn: async () => apiPost<{ ok: boolean; total: number }>(`/admin/stock-food-images/reseed`, {}),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["admin", "stock-food-images"] });
      qc.invalidateQueries({ queryKey: ["stock-food-images"] });
      toast({ title: "Catalog re-seeded", description: `Library now has ${data.total} images.` });
    },
    onError: (err: Error) => toast({ title: "Re-seed failed", description: err.message, variant: "destructive" }),
  });

  const params = useMemo(() => {
    const s = new URLSearchParams();
    if (q.trim()) s.set("q", q.trim());
    if (includeInactive) s.set("includeInactive", "true");
    s.set("limit", "200");
    return s.toString();
  }, [q, includeInactive]);

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ["admin", "stock-food-images", params],
    queryFn: () => apiGet(`/admin/stock-food-images?${params}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search dishes, aliases, slugs…"
            className="pl-8"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          Show inactive
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={() => reseedMutation.mutate()} disabled={reseedMutation.isPending}>
            {reseedMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Re-run seed
          </Button>
          <Button variant="outline" onClick={() => setShowBulk(true)}>
            <FileUp className="w-4 h-4 mr-1" /> Bulk import
          </Button>
          <Button onClick={() => setModalState({ mode: "create" })}>
            <Plus className="w-4 h-4 mr-1" /> Add image
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : !data || data.rows.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
          <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
          No images yet. Add the first one to populate the tenant picker.
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{data.total} image(s)</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {data.rows.map((row) => (
              <div key={row.id} className="border border-border rounded-lg overflow-hidden bg-card group">
                <div className="aspect-square bg-muted relative">
                  <img
                    src={row.thumbnailUrl || row.imageUrl}
                    alt={row.name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  {!row.isActive && (
                    <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                      <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Inactive</span>
                    </div>
                  )}
                </div>
                <div className="p-2 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-block w-2 h-2 rounded-sm flex-shrink-0 ${row.isVeg ? "bg-green-500" : "bg-red-500"}`} />
                    <p className="text-xs font-medium truncate" title={row.name}>{row.name}</p>
                  </div>
                  {(row.cuisine || row.category) && (
                    <p className="text-[10px] text-muted-foreground truncate">
                      {[row.cuisine, row.category].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  <div className="flex items-center gap-1 pt-1">
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => setModalState({ mode: "edit", row })}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs text-destructive" onClick={() => setDeleting(row)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
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

      {showBulk && (
        <BulkImportModal
          onClose={() => setShowBulk(false)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["admin", "stock-food-images"] });
            qc.invalidateQueries({ queryKey: ["stock-food-images"] });
            setShowBulk(false);
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
    </div>
  );
}

function EditModal({
  mode, row, onClose, onSaved,
}: {
  mode: "create" | "edit";
  row: StockFoodImage | null;
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
          <div className="col-span-2">
            <Label>Image <span className="text-destructive">*</span></Label>
            <StockImageUploadField
              value={form.imageUrl}
              onChange={(url) => setForm((p) => ({ ...p, imageUrl: url }))}
            />
          </div>
          <div className="col-span-2">
            <Label>Thumbnail URL</Label>
            <Input value={form.thumbnailUrl} onChange={(e) => setForm((p) => ({ ...p, thumbnailUrl: e.target.value }))} placeholder="Optional — smaller preview" />
          </div>
          <div className="col-span-2">
            <Label>Aliases (comma-separated)</Label>
            <Input value={form.aliases} onChange={(e) => setForm((p) => ({ ...p, aliases: e.target.value }))} placeholder="paneer makhani, butter paneer" />
            <p className="text-[10px] text-muted-foreground mt-0.5">Other names this dish goes by — boosts auto-match during menu import.</p>
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

/**
 * Upload + URL field for stock food images. Uses the super-admin upload
 * endpoints under `/admin/stock-food-images/uploads/*` so curators can drop
 * a JPEG/PNG/WebP directly instead of hunting for a hot-link URL.
 */
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
      const put = await fetch(presign.uploadURL, {
        method: "PUT", body: file, headers: { "Content-Type": file.type },
      });
      if (!put.ok) throw new Error("Upload failed");
      const fin = await apiPost<{ publicUrl: string }>(
        `/admin/stock-food-images/uploads/finalize`,
        { objectPath: presign.objectPath },
      );
      onChange(fin.publicUrl);
      toast({ title: "Image uploaded" });
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? "Upload failed";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1" />}
          Upload
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowUrl((s) => !s)}>
          URL
        </Button>
        {value && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange("")}>
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
        <span className="text-[10px] text-muted-foreground truncate flex-1">{value || "No image"}</span>
      </div>
      <input
        ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }}
      />
      {showUrl && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://… or /api/public/storage/objects/…"
        />
      )}
      {value && (
        <img
          src={value} alt="preview"
          className="max-h-32 rounded border border-border object-contain bg-muted"
          onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
        />
      )}
    </div>
  );
}

/**
 * Bulk import modal — paste a JSON array of `{ name, imageUrl, ... }`
 * objects (matching the BulkEntrySchema on the server). Existing rows
 * with the same slug are skipped unless "Overwrite" is checked.
 */
function BulkImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [overwrite, setOverwrite] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      let entries: unknown;
      try { entries = JSON.parse(text); }
      catch { throw new Error("Invalid JSON — must be an array of dish objects."); }
      if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error("Provide a non-empty JSON array.");
      }
      return apiPost<{ inserted: number; updated: number; skipped: number; errors: Array<{ name: string; error: string }> }>(
        `/admin/stock-food-images/bulk`, { entries, overwrite },
      );
    },
    onSuccess: (data) => {
      toast({
        title: "Bulk import done",
        description: `${data.inserted} added, ${data.updated} updated, ${data.skipped} skipped${data.errors.length ? `, ${data.errors.length} failed` : ""}.`,
      });
      onDone();
    },
    onError: (err: Error) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const example = `[
  {
    "name": "Paneer Tikka",
    "cuisine": "north-indian",
    "category": "starter",
    "imageUrl": "https://example.com/paneer-tikka.jpg",
    "aliases": ["tandoori paneer"],
    "tags": ["popular"],
    "isVeg": true
  }
]`;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileUp className="w-4 h-4" /> Bulk import images</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Paste a JSON array of dishes. Each entry needs at minimum a <code>name</code> and <code>imageUrl</code>.
            Rows already present (matched by slug) are skipped unless you tick Overwrite.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={example}
            rows={14}
            className="w-full font-mono text-xs p-2 border border-border rounded bg-muted/30"
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            Overwrite existing rows with the same slug
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!text.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteModal({ row, onClose, onDeleted }: { row: StockFoodImage; onClose: () => void; onDeleted: () => void }) {
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
          The image will be hidden from the tenant picker. Menu items that already use this image keep working — we deactivate rather than delete to avoid breaking saved URLs.
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
