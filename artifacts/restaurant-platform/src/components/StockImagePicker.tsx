/**
 * Modal picker for the curated stock food image library. Used from the
 * menu editor — staff can pick a real photo without uploading or paying
 * AI credits.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X, Check, Loader2, ImageIcon } from "lucide-react";
import { apiGet } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
}

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (url: string, row: StockFoodImage) => void;
  /** Pre-fill the search box (e.g. with the dish name). */
  initialQuery?: string;
}

const PAGE_SIZE = 60;

export function StockImagePicker({ open, onClose, onPick, initialQuery = "" }: Props) {
  const [q, setQ] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [vegOnly, setVegOnly] = useState<"any" | "veg" | "non-veg">("any");

  // Re-seed query when the modal is re-opened for a new item.
  useEffect(() => {
    if (open) { setQ(initialQuery); setDebounced(initialQuery); }
  }, [open, initialQuery]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = useMemo(() => {
    const s = new URLSearchParams();
    if (debounced) s.set("q", debounced);
    if (vegOnly === "veg") s.set("isVeg", "true");
    if (vegOnly === "non-veg") s.set("isVeg", "false");
    s.set("limit", String(PAGE_SIZE));
    return s.toString();
  }, [debounced, vegOnly]);

  const { data, isLoading } = useQuery<{ rows: StockFoodImage[]; total: number }>({
    queryKey: ["stock-food-images", params],
    queryFn: () => apiGet(`/stock-food-images?${params}`),
    enabled: open,
    staleTime: 60_000,
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4" />
            Pick from food image library
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by dish name, e.g. paneer tikka, dosa, biryani"
              className="pl-8"
            />
          </div>
          <select
            value={vegOnly}
            onChange={(e) => setVegOnly(e.target.value as typeof vegOnly)}
            className="border border-input rounded-md px-2 py-2 text-sm bg-background"
          >
            <option value="any">Any</option>
            <option value="veg">Veg only</option>
            <option value="non-veg">Non-veg only</option>
          </select>
          {q && (
            <Button variant="ghost" size="icon" onClick={() => setQ("")} title="Clear">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading library…
            </div>
          ) : !data || data.rows.length === 0 ? (
            <div className="text-center py-16 text-sm text-muted-foreground">
              <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
              No matching images.
              {debounced && <p className="mt-1 text-xs">Try a simpler search term or ask your admin to add this dish.</p>}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 py-2">
              {data.rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => { onPick(row.imageUrl, row); onClose(); }}
                  className="group relative aspect-square rounded-lg overflow-hidden border border-border hover:border-primary hover:ring-2 hover:ring-primary/30 transition bg-muted"
                  title={row.name}
                >
                  <img
                    src={row.thumbnailUrl || row.imageUrl}
                    alt={row.name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const t = e.target as HTMLImageElement;
                      t.style.display = "none";
                      t.parentElement?.classList.add("bg-muted");
                    }}
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 text-left">
                    <p className="text-[11px] font-medium text-white line-clamp-1">{row.name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className={`inline-block w-2 h-2 rounded-sm ${row.isVeg ? "bg-green-500" : "bg-red-500"}`} />
                      {row.cuisine && <span className="text-[9px] text-white/80">{row.cuisine}</span>}
                    </div>
                  </div>
                  <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                    <div className="bg-primary text-primary-foreground rounded-full p-2"><Check className="w-4 h-4" /></div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {data && (
          <p className="text-[10px] text-muted-foreground flex-shrink-0">
            Showing {data.rows.length} of {data.total}. Images are curated by your platform admin. Selecting one sets the item's photo immediately — no upload needed.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
