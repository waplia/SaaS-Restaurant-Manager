import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Star, Trash2, ExternalLink, Copy, Eye, Megaphone, Sparkles } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { useBranchContext } from "@/lib/branch";
import { useAuth } from "@/lib/auth";
import { apiFetch, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface WallItem {
  id: number;
  branchId: number | null;
  branchName: string | null;
  feedbackId: number | null;
  externalReviewId: number | null;
  source: string;
  sourceLabel: string;
  isApproved: boolean;
  isFeatured: boolean;
  isHidden: boolean;
  shareOnMarketing: boolean;
  displayNameOverride: string | null;
  rating: number | null;
  comment: string | null;
  authorName: string;
  externalUrl: string | null;
  occurredAt: string;
}

interface QrCandidate {
  id: number; branchId: number | null; rating: number; comment: string | null;
  customerName: string | null; createdAt: string;
}
interface ExternalCandidate {
  id: number; source: string; rating: number; reviewText: string | null;
  authorName: string | null; publishedAt: string | null; reviewUrl: string | null;
}

function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return null;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`h-3.5 w-3.5 ${i <= rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
      ))}
    </div>
  );
}

export default function FeedbackWallPage() {
  const restaurantId = useRestaurantId();
  const { selectedBranchId } = useBranchContext();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const canToggleMarketing = !!(user?.isSuperAdmin || user?.role === "owner");
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "pending" | "featured">("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "qr" | "google" | "manual">("all");
  const [pickerOpen, setPickerOpen] = useState(false);

  const wallQuery = useQuery({
    queryKey: ["feedback-wall", restaurantId, selectedBranchId, statusFilter, sourceFilter],
    enabled: !!restaurantId,
    queryFn: () => {
      const params = new URLSearchParams({ status: statusFilter });
      if (selectedBranchId) params.set("branchId", String(selectedBranchId));
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      return apiFetch<WallItem[]>(`/api/restaurants/${restaurantId}/feedback-wall/list?${params}`);
    },
  });

  const candidatesQuery = useQuery({
    queryKey: ["feedback-wall-candidates", restaurantId, selectedBranchId],
    enabled: !!restaurantId && pickerOpen,
    queryFn: () => apiFetch<{ qrFeedback: QrCandidate[]; externalReviews: ExternalCandidate[] }>(
      `/api/restaurants/${restaurantId}/feedback-wall/candidates?minRating=4${selectedBranchId ? `&branchId=${selectedBranchId}` : ""}`
    ),
  });

  const embedQuery = useQuery({
    queryKey: ["feedback-wall-embed", restaurantId],
    enabled: !!restaurantId,
    queryFn: () => apiFetch<{ slug: string; url: string; snippet: string }>(
      `/api/restaurants/${restaurantId}/feedback-wall/embed-snippet`
    ),
  });

  const addItem = useMutation({
    mutationFn: (input: { feedbackId?: number; externalReviewId?: number; isApproved?: boolean }) =>
      apiPost(`/api/restaurants/${restaurantId}/feedback-wall/list`, { isApproved: false, ...input }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["feedback-wall", restaurantId] });
      qc.invalidateQueries({ queryKey: ["feedback-wall-candidates", restaurantId] });
      toast({ title: vars.isApproved ? "Approved & added to wall" : "Added as pending — review under Pending tab" });
    },
  });

  const updateItem = useMutation({
    mutationFn: ({ id, ...patch }: { id: number } & Partial<WallItem>) =>
      apiPatch(`/api/restaurants/${restaurantId}/feedback-wall/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feedback-wall", restaurantId] }),
  });

  const removeItem = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/restaurants/${restaurantId}/feedback-wall/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feedback-wall", restaurantId] }),
  });

  const items = wallQuery.data ?? [];
  const summary = useMemo(() => {
    const total = items.length;
    const approved = items.filter(i => i.isApproved).length;
    const featured = items.filter(i => i.isFeatured).length;
    const marketing = items.filter(i => i.shareOnMarketing).length;
    return { total, approved, featured, marketing };
  }, [items]);

  return (
    <Layout>
      <PageHeader
        title="Customer Feedback Wall"
        description="Curate approved feedback and external reviews into a public wall and embeddable widget."
        icon={Sparkles}
      />
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Items", value: summary.total },
          { label: "Approved", value: summary.approved },
          { label: "Featured", value: summary.featured },
          { label: "On marketing site", value: summary.marketing },
        ].map(s => (
          <Card key={s.label}><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-2xl font-semibold">{s.value}</div>
          </CardContent></Card>
        ))}
      </div>

      <Tabs defaultValue="curate" className="space-y-4">
        <TabsList>
          <TabsTrigger value="curate">Wall items</TabsTrigger>
          <TabsTrigger value="embed">Public link & embed</TabsTrigger>
        </TabsList>

        <TabsContent value="curate" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                <TabsList>
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="pending">Pending</TabsTrigger>
                  <TabsTrigger value="approved">Approved</TabsTrigger>
                  <TabsTrigger value="featured">Featured</TabsTrigger>
                </TabsList>
              </Tabs>
              <div>
                <Label className="text-xs text-muted-foreground">Source</Label>
                <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as typeof sourceFilter)}>
                  <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sources</SelectItem>
                    <SelectItem value="qr">QR feedback</SelectItem>
                    <SelectItem value="google">Google</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {selectedBranchId && (
                <Badge variant="outline" className="h-9 px-3 flex items-center">Filtered by current outlet</Badge>
              )}
            </div>
            <Button onClick={() => setPickerOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add from feedback</Button>
          </div>

          {wallQuery.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
          ) : items.length === 0 ? (
            <Card><CardContent className="p-10 text-center text-muted-foreground">
              No items on the wall yet. Add approved QR feedback or Google reviews to get started.
            </CardContent></Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {items.map(item => (
                <Card key={item.id} className={item.isFeatured ? "border-yellow-400/60" : ""}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0">
                        <div className="h-9 w-9 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-xs font-semibold shrink-0" aria-hidden>
                          {(item.authorName || "G").split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join("")}
                        </div>
                        <div className="min-w-0">
                        <div className="font-medium truncate">{item.authorName}</div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                          <Stars rating={item.rating} />
                          <Badge variant="outline" className="text-[10px]">{item.sourceLabel}</Badge>
                          {item.branchName && <span>· {item.branchName}</span>}
                          <span>· {new Date(item.occurredAt).toLocaleDateString()}</span>
                        </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {item.externalUrl && (
                          <a href={item.externalUrl} target="_blank" rel="noreferrer">
                            <Button size="icon" variant="ghost"><ExternalLink className="h-4 w-4" /></Button>
                          </a>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => removeItem.mutate(item.id)} disabled={removeItem.isPending}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    {item.comment && <p className="text-sm leading-relaxed line-clamp-4">{item.comment}</p>}
                    <Input
                      placeholder="Display name override (optional)"
                      defaultValue={item.displayNameOverride ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (item.displayNameOverride ?? "")) {
                          updateItem.mutate({ id: item.id, displayNameOverride: v || null });
                        }
                      }}
                      className="h-8 text-sm"
                    />
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <label className="flex items-center justify-between text-xs">
                        <span>Approved</span>
                        <Switch checked={item.isApproved} onCheckedChange={(v) => updateItem.mutate({ id: item.id, isApproved: v })} />
                      </label>
                      <label className="flex items-center justify-between text-xs">
                        <span>Featured</span>
                        <Switch checked={item.isFeatured} onCheckedChange={(v) => updateItem.mutate({ id: item.id, isFeatured: v })} />
                      </label>
                      <label className="flex items-center justify-between text-xs">
                        <span>Hidden</span>
                        <Switch checked={item.isHidden} onCheckedChange={(v) => updateItem.mutate({ id: item.id, isHidden: v })} />
                      </label>
                      <label className={`flex items-center justify-between text-xs ${canToggleMarketing ? "" : "opacity-50"}`}>
                        <span className="flex items-center gap-1" title={canToggleMarketing ? "Show this on the public marketing site" : "Only the owner can change marketing visibility"}>
                          <Megaphone className="h-3 w-3" /> Marketing
                        </span>
                        <Switch
                          checked={item.shareOnMarketing}
                          disabled={!canToggleMarketing}
                          onCheckedChange={(v) => updateItem.mutate({ id: item.id, shareOnMarketing: v })}
                        />
                      </label>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="embed" className="space-y-4">
          {embedQuery.data ? (() => {
            const baseUrl = embedQuery.data.url;
            const withParams = (raw: string, extra: Record<string, string>) => {
              try {
                const u = new URL(raw, window.location.origin);
                Object.entries(extra).forEach(([k, v]) => u.searchParams.set(k, v));
                return u.toString();
              } catch {
                const sep = raw.includes("?") ? "&" : "?";
                const qs = new URLSearchParams(extra).toString();
                return `${raw}${sep}${qs}`;
              }
            };
            const outletUrl = selectedBranchId ? withParams(baseUrl, { branchId: String(selectedBranchId) }) : null;
            const outletSnippet = selectedBranchId
              ? embedQuery.data.snippet.replace(/src="([^"]+)"/, (_m, u) => `src="${withParams(u, { branchId: String(selectedBranchId), embed: "1" })}"`)
              : null;
            return (
            <Card><CardContent className="p-5 space-y-4">
              <div>
                <Label className="text-xs">Public wall URL (whole restaurant)</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input value={baseUrl} readOnly className="font-mono text-xs" />
                  <Button variant="outline" onClick={() => { navigator.clipboard.writeText(baseUrl); toast({ title: "URL copied" }); }}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <a href={baseUrl} target="_blank" rel="noreferrer">
                    <Button variant="outline"><Eye className="h-4 w-4 mr-1" /> Preview</Button>
                  </a>
                </div>
              </div>
              {outletUrl && (
                <div>
                  <Label className="text-xs">Per-outlet share URL (current outlet)</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input value={outletUrl} readOnly className="font-mono text-xs" />
                    <Button variant="outline" onClick={() => { navigator.clipboard.writeText(outletUrl); toast({ title: "Outlet URL copied" }); }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">Switch the outlet from the top bar to generate a different outlet link.</p>
                </div>
              )}
              <div>
                <Label className="text-xs">Embed snippet</Label>
                <div className="flex items-start gap-2 mt-1">
                  <pre className="flex-1 text-xs bg-muted p-3 rounded overflow-x-auto">{embedQuery.data.snippet}</pre>
                  <Button variant="outline" onClick={() => { navigator.clipboard.writeText(embedQuery.data!.snippet); toast({ title: "Snippet copied" }); }}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {outletSnippet && (
                <div>
                  <Label className="text-xs">Embed snippet (current outlet only)</Label>
                  <div className="flex items-start gap-2 mt-1">
                    <pre className="flex-1 text-xs bg-muted p-3 rounded overflow-x-auto">{outletSnippet}</pre>
                    <Button variant="outline" onClick={() => { navigator.clipboard.writeText(outletSnippet); toast({ title: "Snippet copied" }); }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Drop the snippet onto your website. The embedded view loads in a clean iframe layout with no chrome.
              </p>
            </CardContent></Card>
            );
          })() : <Skeleton className="h-40" />}
        </TabsContent>
      </Tabs>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add to wall</DialogTitle></DialogHeader>
          {candidatesQuery.isLoading ? <Skeleton className="h-40" /> : (
            <Tabs defaultValue="qr" className="space-y-3">
              <TabsList>
                <TabsTrigger value="qr">QR feedback ({candidatesQuery.data?.qrFeedback.length ?? 0})</TabsTrigger>
                <TabsTrigger value="external">External reviews ({candidatesQuery.data?.externalReviews.length ?? 0})</TabsTrigger>
              </TabsList>
              <TabsContent value="qr" className="space-y-2">
                {candidatesQuery.data?.qrFeedback.length ? candidatesQuery.data.qrFeedback.map(c => (
                  <Card key={c.id}><CardContent className="p-3 flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Stars rating={c.rating} />
                        <span className="text-sm font-medium">{c.customerName ?? "Guest"}</span>
                      </div>
                      {c.comment && <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{c.comment}</p>}
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button size="sm" onClick={() => addItem.mutate({ feedbackId: c.id, isApproved: true })} disabled={addItem.isPending}>Approve & add</Button>
                      <Button size="sm" variant="outline" onClick={() => addItem.mutate({ feedbackId: c.id })} disabled={addItem.isPending}>Add as pending</Button>
                    </div>
                  </CardContent></Card>
                )) : <p className="text-sm text-muted-foreground text-center py-6">No QR feedback above 4 stars to add.</p>}
              </TabsContent>
              <TabsContent value="external" className="space-y-2">
                {candidatesQuery.data?.externalReviews.length ? candidatesQuery.data.externalReviews.map(c => (
                  <Card key={c.id}><CardContent className="p-3 flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Stars rating={c.rating} />
                        <span className="text-sm font-medium">{c.authorName ?? "Anonymous"}</span>
                        <Badge variant="outline" className="text-[10px]">{c.source}</Badge>
                      </div>
                      {c.reviewText && <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{c.reviewText}</p>}
                    </div>
                    <Button size="sm" onClick={() => addItem.mutate({ externalReviewId: c.id })} disabled={addItem.isPending}>Add</Button>
                  </CardContent></Card>
                )) : <p className="text-sm text-muted-foreground text-center py-6">No external reviews to add.</p>}
              </TabsContent>
            </Tabs>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setPickerOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
