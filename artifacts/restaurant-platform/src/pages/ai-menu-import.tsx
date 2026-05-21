import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams, Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Upload, FileText, Globe, Image as ImageIcon, FileSpreadsheet, Sparkles, AlertCircle, History as HistoryIcon, RotateCcw, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { useAiWallet } from "@/lib/aiHooks";
import { CreditsPill } from "@/components/ai/CreditsPill";
import { InsufficientCreditsModal } from "@/components/ai/InsufficientCreditsModal";
import { apiPost, apiGet } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type ImportSource = "pdf" | "image" | "screenshot" | "excel" | "csv" | "url" | "text";

interface ImportRow {
  id: number;
  source: ImportSource;
  status: "pending" | "processing" | "ready" | "saved" | "partially_saved" | "failed" | "rolled_back";
  fileName: string | null;
  totalRows: number;
  savedItemCount: number;
  needsReviewCount: number;
  estimatedCredits: number;
  actualCredits: number;
  errorMessage: string | null;
  summary: Record<string, unknown> | null;
  createdAt: string;
  savedAt: string | null;
  rolledBackAt: string | null;
}

interface StructuredItem {
  categoryName: string;
  subcategoryName?: string | null;
  name: string;
  price: number;
  currency?: string | null;
  description?: string | null;
  variants?: Array<{ name: string; price: number }>;
  addOns?: Array<{ name: string; price: number }>;
  dietTag?: "veg" | "non-veg" | "egg" | null;
  spicyLevel?: number | null;
  bestseller?: boolean | null;
  prepTimeMinutes?: number | null;
  taxCategory?: string | null;
  allergens?: string[];
  tags?: string[];
}

interface ImportItemRow {
  id: number;
  importId: number;
  rowIndex: number;
  status: "draft" | "saved" | "skipped" | "error" | "rolled_back";
  structured: StructuredItem;
  confidence: string;
  needsReview: boolean;
  duplicateMatchId: number | null;
  menuItemId: number | null;
}

interface ImportDetail { import: ImportRow; items: ImportItemRow[] }

const PER_PAGE_CREDITS = 5;
const PER_IMAGE_CREDITS = 5;
const PER_BLOCK_CREDITS = 5;

function parseOptionLines(text: string): Array<{ name: string; price: number }> {
  return text.split("\n").map(line => {
    const t = line.trim();
    if (!t) return null;
    const m = t.match(/^(.*?)[\s@:|-]+(\d+(?:\.\d+)?)\s*$/);
    if (m) return { name: m[1].trim(), price: Number(m[2]) || 0 };
    return { name: t, price: 0 };
  }).filter((v): v is { name: string; price: number } => !!v && v.name.length > 0);
}

function estimateCredits(source: ImportSource, file: File | null, textContent: string, hasUrl: boolean): number {
  // Mirrors the backend's source-informed estimate. Backend tops the
  // reservation up after extraction if real units exceed the estimate, so
  // users only need realistic credits up front, not worst-case.
  switch (source) {
    case "pdf": {
      const pages = file ? Math.max(1, Math.min(50, Math.ceil(file.size / 100_000))) : 2;
      return pages * PER_PAGE_CREDITS;
    }
    case "image":
    case "screenshot":
      return PER_IMAGE_CREDITS;
    case "csv":
    case "excel": {
      const chars = textContent.length;
      const fromText = chars > 0 ? Math.ceil(chars / 5_000) : 0;
      const blocks = Math.max(1, Math.min(20, fromText || (file ? 4 : 1)));
      return blocks * PER_BLOCK_CREDITS;
    }
    case "text": {
      const chars = textContent.length;
      const blocks = Math.max(1, Math.min(20, Math.ceil(chars / 5_000) || 1));
      return blocks * PER_BLOCK_CREDITS;
    }
    case "url":
      return (hasUrl ? 2 : 1) * PER_BLOCK_CREDITS;
  }
}

export default function AiMenuImportPage() {
  const params = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const restaurantId = useRestaurantId();
  const wallet = useAiWallet();
  const { toast } = useToast();

  const [source, setSource] = useState<ImportSource>("pdf");
  const [textContent, setTextContent] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [starting, setStarting] = useState(false);
  const [showInsufficient, setShowInsufficient] = useState(false);

  const [activeId, setActiveId] = useState<number | null>(params.id ? Number(params.id) : null);
  useEffect(() => { if (params.id) setActiveId(Number(params.id)); }, [params.id]);

  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<Record<number, Partial<StructuredItem>>>({});
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "review" | "duplicates">("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  function toggleExpand(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Poll while processing.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function loop() {
      try {
        const res = await apiGet<ImportDetail>(`/restaurants/${restaurantId}/ai/menu-import/imports/${activeId}`);
        if (cancelled) return;
        setDetail(res);
        if (res.import.status === "pending" || res.import.status === "processing") {
          timer = setTimeout(loop, 2000);
        }
      } catch (err) {
        if (!cancelled) toast({ title: "Could not load import", description: (err as Error).message, variant: "destructive" });
      }
    }
    loop();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [activeId, restaurantId, toast]);

  // Default: select all not-yet-saved, not-flagged-for-review rows when first loaded.
  useEffect(() => {
    if (!detail) return;
    if (selected.size > 0) return;
    const initial = new Set<number>();
    for (const it of detail.items) {
      if (it.status === "draft" && !it.needsReview && !it.duplicateMatchId) initial.add(it.id);
    }
    if (initial.size > 0) setSelected(initial);
  }, [detail]); // eslint-disable-line react-hooks/exhaustive-deps

  async function uploadFile(f: File): Promise<{ objectPath: string }> {
    const presign = await apiPost<{ uploadURL: string; objectPath: string }>(
      `/restaurants/${restaurantId}/storage/uploads/request-url`,
      { name: f.name, size: f.size, contentType: f.type || "application/octet-stream" },
    );
    const put = await fetch(presign.uploadURL, { method: "PUT", body: f, headers: { "Content-Type": f.type || "application/octet-stream" } });
    if (!put.ok) throw new Error(`Upload failed (${put.status})`);
    await apiPost(`/restaurants/${restaurantId}/storage/uploads/finalize`, { objectPath: presign.objectPath });
    return { objectPath: presign.objectPath };
  }

  async function startImport() {
    setStarting(true);
    try {
      const body: Record<string, unknown> = { source };
      if (source === "url") {
        if (!/^https?:\/\//i.test(url.trim())) throw new Error("Enter a valid http(s) URL");
        body.url = url.trim();
      } else if (source === "text") {
        if (textContent.trim().length < 5) throw new Error("Paste your menu text first");
        if (textContent.length > 200_000) throw new Error("Text is too long (max 200,000 characters)");
        body.text = textContent;
      } else {
        if (!file) throw new Error("Choose a file to import");
        const sizeCap =
          source === "pdf" ? 25 * 1024 * 1024 :
          source === "image" || source === "screenshot" ? 15 * 1024 * 1024 :
          10 * 1024 * 1024;
        if (file.size > sizeCap) throw new Error(`File is too large (max ${Math.round(sizeCap / 1024 / 1024)} MB)`);
        body.fileName = file.name;
        {
          const { objectPath } = await uploadFile(file);
          body.objectPath = objectPath;
        }
        if (source === "pdf") body.estimatedPages = Math.max(1, Math.ceil(file.size / 100_000));
      }
      const res = await apiPost<{ id: number }>(`/restaurants/${restaurantId}/ai/menu-import/start`, body);
      wallet.refetch();
      toast({ title: "Import started", description: "AI is reading your menu — this can take 30–90 seconds." });
      setActiveId(res.id);
      setLocation(`/ai/menu-import/${res.id}`);
      setDetail(null);
      setSelected(new Set());
      setEdits({});
    } catch (err) {
      const msg = (err as Error).message || "Failed to start import";
      if (/credit/i.test(msg) && /insufficient|not enough|out of/i.test(msg)) setShowInsufficient(true);
      else toast({ title: "Could not start import", description: msg, variant: "destructive" });
    } finally {
      setStarting(false);
    }
  }

  function toggleRow(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function setEdit(id: number, patch: Partial<StructuredItem>) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function saveSelected() {
    if (!detail || selected.size === 0) return;
    setSaving(true);
    try {
      const res = await apiPost<{ savedCount: number; errors: Array<{ rowId: number; error: string }> }>(
        `/restaurants/${restaurantId}/ai/menu-import/imports/${detail.import.id}/save`,
        { rowIds: Array.from(selected), edits },
      );
      toast({ title: `Saved ${res.savedCount} item${res.savedCount === 1 ? "" : "s"}`, description: res.errors.length ? `${res.errors.length} row(s) failed — see preview.` : "Items added to your menu." });
      // Reload
      const fresh = await apiGet<ImportDetail>(`/restaurants/${restaurantId}/ai/menu-import/imports/${detail.import.id}`);
      setDetail(fresh);
      setSelected(new Set());
      setEdits({});
    } catch (err) {
      toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function rollback() {
    if (!detail) return;
    if (!confirm("Roll back the items created by this import? Items that have been edited or sold will be kept.")) return;
    try {
      const res = await apiPost<{ removed: number; skipped: Array<{ menuItemId: number; reason: string }> }>(
        `/restaurants/${restaurantId}/ai/menu-import/imports/${detail.import.id}/rollback`, {},
      );
      toast({ title: `Rolled back ${res.removed} item${res.removed === 1 ? "" : "s"}`, description: res.skipped.length ? `${res.skipped.length} kept (edited or sold).` : "Done." });
      const fresh = await apiGet<ImportDetail>(`/restaurants/${restaurantId}/ai/menu-import/imports/${detail.import.id}`);
      setDetail(fresh);
    } catch (err) {
      toast({ title: "Rollback failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  const filteredRows = useMemo(() => {
    if (!detail) return [];
    const q = search.trim().toLowerCase();
    return detail.items.filter(it => {
      if (filter === "review" && !it.needsReview) return false;
      if (filter === "duplicates" && !it.duplicateMatchId) return false;
      if (q && !(it.structured.name.toLowerCase().includes(q) || (it.structured.categoryName ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [detail, search, filter]);

  const costEstimate = useMemo(
    () => estimateCredits(source, file, textContent, url.trim().length > 0),
    [source, file, textContent, url],
  );

  const status = detail?.import.status;
  const isProcessing = status === "pending" || status === "processing";
  const isReady = status === "ready" || status === "partially_saved";
  const hasRows = isReady || status === "saved" || status === "rolled_back";
  const canRollback = status === "saved" || status === "partially_saved";

  return (
    <Layout>
      <PageHeader
        title="AI Menu Import"
        subtitle="Drop a PDF, image, screenshot, spreadsheet, URL or pasted text — AI structures it into menu items you can review and save in one click."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/ai/menu-import/history"><Button variant="outline" size="sm" className="gap-1.5"><HistoryIcon className="w-3.5 h-3.5" /> History</Button></Link>
            <CreditsPill cost={costEstimate} available={wallet.data?.balance} loading={wallet.isLoading} />
          </div>
        }
      />

      <div className="p-6 space-y-6">
        {!activeId && (
          <Card>
            <CardContent className="p-5 space-y-4">
              <Tabs value={source} onValueChange={(v) => { setSource(v as ImportSource); setFile(null); }}>
                <TabsList className="flex flex-wrap gap-1">
                  <TabsTrigger value="pdf" className="gap-1.5"><FileText className="w-3.5 h-3.5" /> PDF</TabsTrigger>
                  <TabsTrigger value="image" className="gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> Image</TabsTrigger>
                  <TabsTrigger value="screenshot" className="gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> Screenshot</TabsTrigger>
                  <TabsTrigger value="csv" className="gap-1.5"><FileSpreadsheet className="w-3.5 h-3.5" /> CSV</TabsTrigger>
                  <TabsTrigger value="excel" className="gap-1.5"><FileSpreadsheet className="w-3.5 h-3.5" /> Excel</TabsTrigger>
                  <TabsTrigger value="url" className="gap-1.5"><Globe className="w-3.5 h-3.5" /> URL</TabsTrigger>
                  <TabsTrigger value="text" className="gap-1.5"><FileText className="w-3.5 h-3.5" /> Text</TabsTrigger>
                </TabsList>

                {(source === "pdf" || source === "image" || source === "screenshot" || source === "csv" || source === "excel") && (
                  <TabsContent value={source} className="pt-4 space-y-3">
                    <div className="rounded-lg border border-dashed border-border p-6 text-center bg-muted/30">
                      <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-sm font-medium mb-1">
                        {source === "pdf" && "Upload a menu PDF (charged per page)"}
                        {source === "image" && "Upload a photo of your printed menu (1 image)"}
                        {source === "screenshot" && "Upload a screenshot of your menu (1 image)"}
                        {source === "csv" && "Upload a CSV exported from your previous menu"}
                        {source === "excel" && "Upload an Excel sheet — convert .xlsx to CSV first for best results"}
                      </p>
                      <input
                        ref={fileRef}
                        type="file"
                        hidden
                        accept={
                          source === "pdf" ? "application/pdf" :
                          source === "csv" || source === "excel" ? ".csv,.xlsx,text/csv" :
                          "image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif"
                        }
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      />
                      <div className="flex items-center justify-center gap-3">
                        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                          <Upload className="w-3.5 h-3.5 mr-1.5" /> Choose file
                        </Button>
                        {file && <span className="text-xs text-muted-foreground truncate max-w-[260px]">{file.name} · {(file.size / 1024).toFixed(0)} KB</span>}
                      </div>
                    </div>
                  </TabsContent>
                )}
                {source === "url" && (
                  <TabsContent value="url" className="pt-4 space-y-2">
                    <Label>Menu URL</Label>
                    <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/menu" />
                    <p className="text-[11px] text-muted-foreground">We'll fetch the page text and let AI extract items. Works best for plain HTML menus.</p>
                  </TabsContent>
                )}
                {source === "text" && (
                  <TabsContent value="text" className="pt-4 space-y-2">
                    <Label>Paste your menu text</Label>
                    <Textarea rows={10} value={textContent} onChange={(e) => setTextContent(e.target.value)} placeholder="Paneer Tikka — 249&#10;Butter Naan — 60&#10;Veg Biryani — 180&#10;…" />
                    <p className="text-[11px] text-muted-foreground">Charged per 50 items extracted.</p>
                  </TabsContent>
                )}
              </Tabs>

              <div className="flex items-center justify-end pt-2 border-t border-border">
                <Button onClick={startImport} disabled={starting} className="gap-1.5">
                  {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {starting ? "Starting…" : "Run import"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {activeId && (
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Import #{activeId}</p>
                  <p className="text-xs text-muted-foreground">{detail?.import.fileName ?? detail?.import.source ?? "Loading…"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={status} />
                  {canRollback && <Button size="sm" variant="outline" onClick={rollback} className="gap-1.5"><RotateCcw className="w-3.5 h-3.5" /> Rollback</Button>}
                  <Button size="sm" variant="outline" onClick={() => { setActiveId(null); setDetail(null); setLocation("/ai/menu-import"); }}>New import</Button>
                </div>
              </div>

              {status === "failed" && (
                <div className="rounded-md border border-rose-300 bg-rose-50 dark:bg-rose-950/30 p-3 text-sm text-rose-800 dark:text-rose-200 flex gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{detail?.import.errorMessage ?? "Import failed."}</span>
                </div>
              )}

              {isProcessing && (
                <div className="flex items-center gap-3 p-4 rounded-md bg-violet-50 dark:bg-violet-950/30 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-violet-600" />
                  AI is reading your menu — this normally takes 30–90 seconds…
                </div>
              )}

              {detail && hasRows && (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-sm text-muted-foreground">
                      Extracted <strong className="text-foreground">{detail.import.totalRows}</strong> item{detail.import.totalRows === 1 ? "" : "s"} ·
                      {" "}<strong className="text-foreground">{detail.import.needsReviewCount}</strong> need review ·
                      {" "}<strong className="text-foreground">{detail.import.savedItemCount}</strong> already saved
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter…" className="h-8 w-48" />
                      <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="h-8 text-xs rounded-md border border-input bg-background px-2">
                        <option value="all">All</option>
                        <option value="review">Needs review</option>
                        <option value="duplicates">Duplicates</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{selected.size} of {filteredRows.filter(r => r.status === "draft").length} selected</span>
                    <Button size="sm" variant="outline" className="h-7"
                      onClick={() => setSelected(prev => {
                        const next = new Set(prev);
                        for (const r of filteredRows) if (r.status === "draft") next.add(r.id);
                        return next;
                      })}>Select all (filtered)</Button>
                    <Button size="sm" variant="outline" className="h-7"
                      onClick={() => setSelected(prev => {
                        const next = new Set(prev);
                        for (const r of filteredRows) next.delete(r.id);
                        return next;
                      })}>Deselect filtered</Button>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => setSelected(new Set())}>Clear all</Button>
                    <Button size="sm" variant="outline" className="h-7"
                      onClick={() => setSelected(prev => {
                        const next = new Set(prev);
                        for (const r of filteredRows) if (r.status === "draft" && !r.duplicateMatchId) next.add(r.id);
                        return next;
                      })}>Select non-duplicates</Button>
                  </div>

                  <div className="border border-border rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs uppercase tracking-wide">
                        <tr>
                          <th className="px-2 py-2 w-8"></th>
                          <th className="px-2 py-2 w-6"></th>
                          <th className="px-2 py-2 text-left">Category</th>
                          <th className="px-2 py-2 text-left">Item</th>
                          <th className="px-2 py-2 text-right">Price</th>
                          <th className="px-2 py-2 text-left">Diet</th>
                          <th className="px-2 py-2 text-right">Conf.</th>
                          <th className="px-2 py-2 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRows.length === 0 && (
                          <tr><td colSpan={8} className="text-center text-xs text-muted-foreground py-6">No rows match.</td></tr>
                        )}
                        {filteredRows.map(row => {
                          const merged = { ...row.structured, ...(edits[row.id] ?? {}) };
                          const isSaved = row.status !== "draft";
                          const isOpen = expanded.has(row.id);
                          return (
                            <>
                            <tr key={row.id} className={"border-t border-border " + (row.needsReview ? "bg-amber-50/40 dark:bg-amber-950/10" : "")}>
                              <td className="px-2 py-1.5 align-top">
                                <Checkbox
                                  checked={selected.has(row.id)}
                                  disabled={isSaved}
                                  onCheckedChange={() => toggleRow(row.id)}
                                />
                              </td>
                              <td className="px-1 py-1.5 align-top">
                                <button onClick={() => toggleExpand(row.id)} className="p-1 hover:bg-muted rounded" title="Edit more fields">
                                  {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                </button>
                              </td>
                              <td className="px-2 py-1.5 align-top">
                                <Input
                                  value={merged.categoryName ?? ""}
                                  disabled={isSaved}
                                  onChange={(e) => setEdit(row.id, { categoryName: e.target.value })}
                                  className="h-7 text-xs"
                                />
                              </td>
                              <td className="px-2 py-1.5 align-top">
                                <Input
                                  value={merged.name ?? ""}
                                  disabled={isSaved}
                                  onChange={(e) => setEdit(row.id, { name: e.target.value })}
                                  className="h-7 text-xs"
                                />
                                {merged.description && <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{merged.description}</p>}
                                {row.duplicateMatchId && <Badge variant="outline" className="mt-1 text-[10px] border-amber-300 bg-amber-50 text-amber-800">Possible duplicate</Badge>}
                              </td>
                              <td className="px-2 py-1.5 align-top">
                                <Input
                                  type="number"
                                  value={String(merged.price ?? 0)}
                                  disabled={isSaved}
                                  onChange={(e) => setEdit(row.id, { price: Number(e.target.value) })}
                                  className="h-7 text-xs text-right w-20"
                                />
                              </td>
                              <td className="px-2 py-1.5 align-top">
                                <select
                                  value={merged.dietTag ?? ""}
                                  disabled={isSaved}
                                  onChange={(e) => setEdit(row.id, { dietTag: (e.target.value || null) as StructuredItem["dietTag"] })}
                                  className="h-7 text-xs rounded-md border border-input bg-background px-1"
                                >
                                  <option value="">—</option>
                                  <option value="veg">Veg</option>
                                  <option value="non-veg">Non-veg</option>
                                  <option value="egg">Egg</option>
                                </select>
                              </td>
                              <td className="px-2 py-1.5 align-top text-right text-xs tabular-nums">
                                {(Number(row.confidence) * 100).toFixed(0)}%
                              </td>
                              <td className="px-2 py-1.5 align-top">
                                {row.status === "saved" ? (
                                  <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1" /> Saved</Badge>
                                ) : row.status === "rolled_back" ? (
                                  <Badge variant="outline" className="text-[10px]">Rolled back</Badge>
                                ) : row.needsReview ? (
                                  <Badge variant="outline" className="text-[10px] border-amber-300 bg-amber-50 text-amber-800">Review</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px]">{(Number(row.confidence) * 100).toFixed(0)}%</Badge>
                                )}
                              </td>
                            </tr>
                            {isOpen && (
                              <tr className="border-t border-border bg-muted/20">
                                <td colSpan={8} className="px-3 py-3">
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className="md:col-span-2">
                                      <Label className="text-[11px]">Description</Label>
                                      <Textarea rows={2} disabled={isSaved} value={merged.description ?? ""}
                                        onChange={(e) => setEdit(row.id, { description: e.target.value })} className="text-xs" />
                                    </div>
                                    <div>
                                      <Label className="text-[11px]">Subcategory</Label>
                                      <Input disabled={isSaved} value={merged.subcategoryName ?? ""}
                                        onChange={(e) => setEdit(row.id, { subcategoryName: e.target.value })} className="h-7 text-xs" />
                                    </div>
                                    <div>
                                      <Label className="text-[11px]">Prep time (min)</Label>
                                      <Input type="number" disabled={isSaved} value={String(merged.prepTimeMinutes ?? "")}
                                        onChange={(e) => setEdit(row.id, { prepTimeMinutes: Number(e.target.value) || null })} className="h-7 text-xs" />
                                    </div>
                                    <div>
                                      <Label className="text-[11px]">Spicy (0–5)</Label>
                                      <Input type="number" min={0} max={5} disabled={isSaved} value={String(merged.spicyLevel ?? "")}
                                        onChange={(e) => setEdit(row.id, { spicyLevel: e.target.value === "" ? null : Math.max(0, Math.min(5, Number(e.target.value))) })} className="h-7 text-xs" />
                                    </div>
                                    <div>
                                      <Label className="text-[11px]">Tax category</Label>
                                      <Input disabled={isSaved} value={merged.taxCategory ?? ""}
                                        onChange={(e) => setEdit(row.id, { taxCategory: e.target.value })} className="h-7 text-xs" />
                                    </div>
                                    <div className="md:col-span-2">
                                      <Label className="text-[11px]">Tags (comma-separated)</Label>
                                      <Input disabled={isSaved} value={(merged.tags ?? []).join(", ")}
                                        onChange={(e) => setEdit(row.id, { tags: e.target.value.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) })} className="h-7 text-xs" />
                                    </div>
                                    <div className="md:col-span-3">
                                      <Label className="text-[11px]">Allergens (comma-separated)</Label>
                                      <Input disabled={isSaved} value={(merged.allergens ?? []).join(", ")}
                                        onChange={(e) => setEdit(row.id, { allergens: e.target.value.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) })} className="h-7 text-xs" />
                                    </div>
                                    <div className="md:col-span-3">
                                      <Label className="text-[11px]">Variants (one per line, format: name @ price)</Label>
                                      <Textarea rows={2} disabled={isSaved}
                                        value={(merged.variants ?? []).map(v => `${v.name} @ ${v.price}`).join("\n")}
                                        onChange={(e) => setEdit(row.id, { variants: parseOptionLines(e.target.value) })}
                                        className="text-xs font-mono"
                                        placeholder={"Half @ 199\nFull @ 349"} />
                                    </div>
                                    <div className="md:col-span-3">
                                      <Label className="text-[11px]">Add-ons (one per line, format: name @ price)</Label>
                                      <Textarea rows={2} disabled={isSaved}
                                        value={(merged.addOns ?? []).map(v => `${v.name} @ ${v.price}`).join("\n")}
                                        onChange={(e) => setEdit(row.id, { addOns: parseOptionLines(e.target.value) })}
                                        className="text-xs font-mono"
                                        placeholder={"Extra cheese @ 40\nExtra sauce @ 20"} />
                                    </div>
                                    <label className="flex items-center gap-2 text-xs">
                                      <Checkbox disabled={isSaved} checked={!!merged.bestseller}
                                        onCheckedChange={(v) => setEdit(row.id, { bestseller: !!v })} /> Bestseller
                                    </label>
                                  </div>
                                </td>
                              </tr>
                            )}
                            </>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {isReady ? (
                    <div className="flex items-center justify-between pt-2 border-t border-border">
                      <div className="text-xs text-muted-foreground">{selected.size} selected of {detail.items.filter(i => i.status === "draft").length} draft items</div>
                      <Button onClick={saveSelected} disabled={saving || selected.size === 0} className="gap-1.5">
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        Save {selected.size} item{selected.size === 1 ? "" : "s"} to menu
                      </Button>
                    </div>
                  ) : (
                    <div className="pt-2 border-t border-border text-xs text-muted-foreground">
                      This import is {status === "rolled_back" ? "rolled back" : "fully saved"} — rows are read-only.
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <InsufficientCreditsModal
        open={showInsufficient}
        onClose={() => setShowInsufficient(false)}
        required={costEstimate}
        available={wallet.data?.balance ?? 0}
        feature="AI Menu Import"
      />
    </Layout>
  );
}

function StatusBadge({ status }: { status?: ImportRow["status"] }) {
  if (!status) return null;
  const map: Record<string, { cls: string; label: string }> = {
    pending:          { cls: "bg-slate-100 text-slate-800 border-slate-300", label: "Pending" },
    processing:       { cls: "bg-violet-100 text-violet-800 border-violet-300", label: "Processing" },
    ready:            { cls: "bg-sky-100 text-sky-800 border-sky-300", label: "Ready to review" },
    saved:            { cls: "bg-emerald-100 text-emerald-800 border-emerald-300", label: "Saved" },
    partially_saved:  { cls: "bg-amber-100 text-amber-800 border-amber-300", label: "Partially saved" },
    failed:           { cls: "bg-rose-100 text-rose-800 border-rose-300", label: "Failed" },
    rolled_back:      { cls: "bg-slate-100 text-slate-700 border-slate-300", label: "Rolled back" },
  };
  const m = map[status] ?? map.pending;
  return <Badge variant="outline" className={`text-[10px] ${m.cls}`}>{m.label}</Badge>;
}
