import { useMemo, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Download, ExternalLink, Trash2, Edit, BarChart3, Sparkles } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { useBranchContext } from "@/lib/branch";
import { apiFetch, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface ReviewQR {
  id: number;
  restaurantId: number;
  branchId: number | null;
  qrCode: string;
  title: string;
  customMessage: string | null;
  thankYouMessage: string;
  negativeFeedbackMessage: string;
  googleReviewUrl: string | null;
  googlePlaceId: string | null;
  positiveThreshold: number;
  showGoogleButtonOnNegative: boolean;
  aiAssistEnabled: boolean;
  isActive: boolean;
  createdAt: string;
}

interface QrAnalytics {
  totals: { scans: number; rated: number; googleRedirects: number; negativeFeedback: number; avgRating: number };
  byDay: Array<{ day: string; event: string; rating: number | null; count: number }>;
}

const empty = {
  title: "How was your experience?",
  customMessage: "",
  thankYouMessage: "Thanks for your feedback!",
  negativeFeedbackMessage: "Sorry to hear that. We'd love a chance to make it right.",
  googleReviewUrl: "",
  googlePlaceId: "",
  positiveThreshold: 4,
  showGoogleButtonOnNegative: false,
  aiAssistEnabled: true,
  isActive: true,
  branchId: null as number | null,
};

export default function ReviewQrsPage() {
  const restaurantId = useRestaurantId();
  const { branches } = useBranchContext();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<ReviewQR | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [analyticsQrId, setAnalyticsQrId] = useState<number | null>(null);

  const list = useQuery<ReviewQR[]>({
    queryKey: ["review-qrs", restaurantId],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/review-qrs/list`),
    enabled: !!restaurantId,
  });

  const analytics = useQuery<QrAnalytics>({
    queryKey: ["review-qrs", restaurantId, "analytics", analyticsQrId],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/review-qrs/analytics?days=30${analyticsQrId ? `&qrId=${analyticsQrId}` : ""}`),
    enabled: !!restaurantId,
  });

  const dailyChart = useMemo(() => {
    const rows = analytics.data?.byDay ?? [];
    const map = new Map<string, { day: string; scans: number; google: number; private: number }>();
    for (const r of rows) {
      const cur = map.get(r.day) ?? { day: r.day, scans: 0, google: 0, private: 0 };
      if (r.event === "scan") cur.scans += r.count;
      else if (r.event === "google_redirect") cur.google += r.count;
      else if (r.event === "submitted_negative") cur.private += r.count;
      map.set(r.day, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [analytics.data]);

  function openCreate() {
    setForm({ ...empty });
    setEditing(null);
    setCreating(true);
  }

  function openEdit(qr: ReviewQR) {
    setEditing(qr);
    setForm({
      title: qr.title,
      customMessage: qr.customMessage ?? "",
      thankYouMessage: qr.thankYouMessage,
      negativeFeedbackMessage: qr.negativeFeedbackMessage,
      googleReviewUrl: qr.googleReviewUrl ?? "",
      googlePlaceId: qr.googlePlaceId ?? "",
      positiveThreshold: qr.positiveThreshold,
      showGoogleButtonOnNegative: qr.showGoogleButtonOnNegative,
      aiAssistEnabled: qr.aiAssistEnabled ?? true,
      isActive: qr.isActive,
      branchId: qr.branchId,
    });
    setCreating(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const body = { ...form };
      if (editing) return apiPatch(`/restaurants/${restaurantId}/review-qrs/${editing.id}`, body);
      return apiPost(`/restaurants/${restaurantId}/review-qrs/list`, body);
    },
    onSuccess: () => {
      toast({ title: editing ? "QR updated" : "QR created" });
      setCreating(false);
      qc.invalidateQueries({ queryKey: ["review-qrs", restaurantId] });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/review-qrs/${id}`),
    onSuccess: () => {
      toast({ title: "Deleted" });
      qc.invalidateQueries({ queryKey: ["review-qrs", restaurantId] });
    },
  });

  function publicUrl(qrCode: string) {
    return `${window.location.origin}/review/${qrCode}`;
  }

  function downloadSvg(qr: ReviewQR) {
    const url = `/api/restaurants/${restaurantId}/review-qrs/${qr.id}/qr.svg`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `review-qr-${qr.qrCode}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <Layout>
      <PageHeader
        title="Review QRs"
        subtitle="Print-ready QR codes that route 4–5★ guests to Google and 1–3★ to a private form."
        actions={
          <Button onClick={openCreate} data-testid="button-new-review-qr">
            <Plus className="mr-2 h-4 w-4" /> New QR
          </Button>
        }
      />

      {/* Aggregate analytics */}
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 mb-4">
        {[
          { label: "Scans (30d)", value: analytics.data?.totals.scans ?? 0 },
          { label: "Ratings", value: analytics.data?.totals.rated ?? 0 },
          { label: "Avg ★", value: analytics.data?.totals.avgRating ?? 0 },
          { label: "Google redirects", value: analytics.data?.totals.googleRedirects ?? 0 },
          { label: "Private feedback", value: analytics.data?.totals.negativeFeedback ?? 0 },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-2xl font-semibold mt-1">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-medium">Daily activity (last 30 days)</div>
              <div className="text-xs text-muted-foreground">
                {analyticsQrId ? "Filtered to one QR" : "All QRs combined"}
                {analyticsQrId && (
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => setAnalyticsQrId(null)}
                    data-testid="button-clear-qr-filter"
                  >
                    Clear filter
                  </button>
                )}
              </div>
            </div>
          </div>
          {dailyChart.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No scans yet — print a QR and place it on the table.
            </div>
          ) : (
            <div className="h-56" data-testid="chart-review-qr-daily">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="scans" name="Scans" stroke="#6366f1" fill="#6366f1" fillOpacity={0.18} />
                  <Area type="monotone" dataKey="google" name="Google redirects" stroke="#10b981" fill="#10b981" fillOpacity={0.18} />
                  <Area type="monotone" dataKey="private" name="Private feedback" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.18} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {list.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((n) => <Skeleton key={n} className="h-40" />)}
        </div>
      ) : (list.data?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <Sparkles className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-medium mb-1">No review QRs yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Create one per branch and print it on the receipt.</p>
            <Button onClick={openCreate}>Create your first QR</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.data!.map((qr) => {
            const branch = branches?.find((b) => b.id === qr.branchId);
            return (
              <Card key={qr.id} data-testid={`card-review-qr-${qr.id}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{qr.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{branch?.name ?? "All branches"}</div>
                    </div>
                    <Badge variant={qr.isActive ? "default" : "outline"}>{qr.isActive ? "Active" : "Off"}</Badge>
                  </div>
                  <div className="text-xs font-mono bg-muted rounded p-2 truncate">{publicUrl(qr.qrCode)}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => downloadSvg(qr)} data-testid={`button-download-${qr.id}`}>
                      <Download className="h-3.5 w-3.5 mr-1.5" /> SVG
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => window.open(publicUrl(qr.qrCode), "_blank")}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Preview
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setAnalyticsQrId(qr.id)}>
                      <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Stats
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(qr)} data-testid={`button-edit-${qr.id}`}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { if (confirm("Delete this QR?")) del.mutate(qr.id); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Review QR" : "New Review QR"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Branch</Label>
                <Select
                  value={form.branchId ? String(form.branchId) : "all"}
                  onValueChange={(v) => setForm({ ...form, branchId: v === "all" ? null : Number(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All branches</SelectItem>
                    {(branches ?? []).map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Positive threshold (★)</Label>
                <Select
                  value={String(form.positiveThreshold)}
                  onValueChange={(v) => setForm({ ...form, positiveThreshold: Number(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}★ and above → Google</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Title</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <Label>Welcome message</Label>
              <Textarea value={form.customMessage} onChange={(e) => setForm({ ...form, customMessage: e.target.value })} rows={2} />
            </div>
            <div>
              <Label>Thank-you (positive)</Label>
              <Textarea value={form.thankYouMessage} onChange={(e) => setForm({ ...form, thankYouMessage: e.target.value })} rows={2} />
            </div>
            <div>
              <Label>Apology (negative)</Label>
              <Textarea value={form.negativeFeedbackMessage} onChange={(e) => setForm({ ...form, negativeFeedbackMessage: e.target.value })} rows={2} />
            </div>
            <div>
              <Label>Google review URL</Label>
              <Input
                placeholder="https://g.page/r/..."
                value={form.googleReviewUrl}
                onChange={(e) => setForm({ ...form, googleReviewUrl: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Paste your Google Maps review link. (GBP auto-sync coming soon — use copy-paste mode for now.)
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
              <Label>Active</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={form.showGoogleButtonOnNegative}
                onCheckedChange={(v) => setForm({ ...form, showGoogleButtonOnNegative: v })}
              />
              <Label>Also show Google link on negative page</Label>
            </div>
            <div className="flex items-start gap-3">
              <Switch
                checked={form.aiAssistEnabled}
                onCheckedChange={(v) => setForm({ ...form, aiAssistEnabled: v })}
                data-testid="switch-ai-assist"
              />
              <div>
                <Label className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> AI review draft assist
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When a 4–5★ guest taps a few tags, AI writes a friendly draft for them to copy into Google. Uses 1 Khana AI credit per draft.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-qr">
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
