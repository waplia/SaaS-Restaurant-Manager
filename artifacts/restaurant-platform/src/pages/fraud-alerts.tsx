import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRestaurantId } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { apiGet, apiAction } from "@/lib/api";
import type { FraudAlert, FraudAlertList, FraudDetectorSetting } from "@/lib/types";
import { ShieldAlert, RefreshCw, Settings as SettingsIcon, AlertTriangle, CheckCircle2, XCircle, Eye } from "lucide-react";

const DETECTOR_LABEL: Record<string, string> = {
  excessive_discounts: "Excessive Discounts",
  void_bills: "Void Bills",
  cancelled_kots: "Cancelled KOTs",
  refund_abuse: "Refund Abuse",
  cash_mismatch: "Cash Mismatch",
  manual_attendance_edits: "Manual Attendance Edits",
  inventory_mismatch: "Inventory Mismatch",
  unusual_free_items: "Unusual Free Items",
};

const SEVERITY_COLOR: Record<string, string> = {
  low: "bg-blue-100 text-blue-700",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-700",
};

const STATUS_COLOR: Record<string, string> = {
  open: "bg-red-100 text-red-700",
  acknowledged: "bg-amber-100 text-amber-800",
  resolved: "bg-green-100 text-green-700",
  false_positive: "bg-gray-100 text-gray-600",
};

function fmt(d: string) {
  return new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function FraudAlertsPage() {
  const restaurantId = useRestaurantId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isOwnerOrAdmin = user?.role === "owner" || user?.role === "super_admin";

  const [filters, setFilters] = useState({ detector: "", status: "open", severity: "" });
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const limit = 25;
  const qs = new URLSearchParams();
  if (filters.detector) qs.set("detector", filters.detector);
  if (filters.status) qs.set("status", filters.status);
  if (filters.severity) qs.set("severity", filters.severity);
  qs.set("page", String(page));
  qs.set("limit", String(limit));

  const listQuery = useQuery({
    queryKey: ["fraud-alerts", restaurantId, filters, page],
    queryFn: () => apiGet<FraudAlertList>(`/restaurants/${restaurantId}/fraud-alerts?${qs.toString()}`),
    enabled: !!restaurantId,
  });

  const detailQuery = useQuery({
    queryKey: ["fraud-alert-detail", restaurantId, selectedId],
    queryFn: () => apiGet<FraudAlert>(`/restaurants/${restaurantId}/fraud-alerts/${selectedId}`),
    enabled: !!restaurantId && !!selectedId,
  });

  const runMutation = useMutation({
    mutationFn: () => apiAction(`/restaurants/${restaurantId}/fraud-alerts/run`, "POST", { group: "all" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fraud-alerts", restaurantId] }),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: number; status: string; reviewNotes?: string }) =>
      apiAction(`/restaurants/${restaurantId}/fraud-alerts/${vars.id}`, "PATCH", { status: vars.status, reviewNotes: vars.reviewNotes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fraud-alerts", restaurantId] });
      qc.invalidateQueries({ queryKey: ["fraud-alert-detail", restaurantId, selectedId] });
    },
  });

  const alerts = listQuery.data?.data ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <Layout>
      <PageHeader
        title="Fraud Alerts"
        subtitle="AI-flagged anomalies in discounts, voids, cash, attendance, inventory and free items."
        actions={
          <div className="flex gap-2">
            {isOwnerOrAdmin && (
              <Button variant="outline" onClick={() => runMutation.mutate()} disabled={runMutation.isPending} data-testid="button-run-detection">
                <RefreshCw className={`w-4 h-4 mr-2 ${runMutation.isPending ? "animate-spin" : ""}`} />
                Run Detection
              </Button>
            )}
            <Button variant="outline" onClick={() => setShowSettings(true)} data-testid="button-fraud-settings">
              <SettingsIcon className="w-4 h-4 mr-2" /> Settings
            </Button>
          </div>
        }
      />

      <div className="p-6 space-y-4">
        <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap gap-3">
          <div className="min-w-[180px]">
            <Label className="text-xs text-muted-foreground">Detector</Label>
            <Select value={filters.detector || "_all"} onValueChange={v => { setFilters(s => ({ ...s, detector: v === "_all" ? "" : v })); setPage(1); }}>
              <SelectTrigger data-testid="filter-detector"><SelectValue placeholder="All detectors" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All detectors</SelectItem>
                {Object.entries(DETECTOR_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[140px]">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={filters.status || "_all"} onValueChange={v => { setFilters(s => ({ ...s, status: v === "_all" ? "" : v })); setPage(1); }}>
              <SelectTrigger data-testid="filter-status"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">Any</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="false_positive">False positive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[140px]">
            <Label className="text-xs text-muted-foreground">Severity</Label>
            <Select value={filters.severity || "_all"} onValueChange={v => { setFilters(s => ({ ...s, severity: v === "_all" ? "" : v })); setPage(1); }}>
              <SelectTrigger data-testid="filter-severity"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">Any</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Detector</th>
                <th className="px-4 py-2">Severity</th>
                <th className="px-4 py-2">Subject</th>
                <th className="px-4 py-2">Score</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Summary</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!listQuery.isLoading && alerts.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
                  No alerts match these filters.
                </td></tr>
              )}
              {alerts.map(a => (
                <tr key={a.id} className="border-t border-border hover:bg-muted/30" data-testid={`fraud-alert-row-${a.id}`}>
                  <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground">{fmt(a.createdAt)}</td>
                  <td className="px-4 py-2 font-medium">{DETECTOR_LABEL[a.detector] ?? a.detector}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${SEVERITY_COLOR[a.severity]}`}>{a.severity}</span>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {a.subjectName ?? (a.subjectUserId ? `User #${a.subjectUserId}` : "—")}
                    {a.subjectRole ? <div className="text-muted-foreground">{a.subjectRole}</div> : null}
                  </td>
                  <td className="px-4 py-2 text-xs">{Number(a.score).toFixed(2)}{a.threshold ? <span className="text-muted-foreground"> / {Number(a.threshold).toFixed(2)}</span> : null}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${STATUS_COLOR[a.status]}`}>{a.status}</span>
                  </td>
                  <td className="px-4 py-2 max-w-md text-xs text-muted-foreground line-clamp-2">{a.aiSummary}</td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setSelectedId(a.id)} data-testid={`button-view-${a.id}`}>
                      <Eye className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">{total} alerts</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
              <span className="px-2 py-1">Page {page} / {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      <FraudAlertDetail
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        alert={detailQuery.data ?? null}
        onUpdate={(status, notes) => selectedId && updateMutation.mutate({ id: selectedId, status, reviewNotes: notes })}
        isUpdating={updateMutation.isPending}
      />

      {showSettings && (
        <FraudSettingsPanel
          restaurantId={restaurantId}
          canEdit={isOwnerOrAdmin}
          onClose={() => setShowSettings(false)}
        />
      )}
    </Layout>
  );
}

function FraudAlertDetail({ open, onClose, alert, onUpdate, isUpdating }: {
  open: boolean; onClose: () => void; alert: FraudAlert | null;
  onUpdate: (status: string, notes?: string) => void; isUpdating: boolean;
}) {
  const [notes, setNotes] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            {alert ? (DETECTOR_LABEL[alert.detector] ?? alert.detector) : "Alert"}
          </DialogTitle>
          <DialogDescription>{alert ? fmt(alert.createdAt) : ""}</DialogDescription>
        </DialogHeader>
        {alert ? (
          <div className="space-y-4 text-sm">
            <div>
              <Label className="text-xs text-muted-foreground">AI Summary {alert.aiSummaryFallback && <span className="text-[10px]">(template)</span>}</Label>
              <p className="mt-1">{alert.aiSummary}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-muted-foreground">Severity:</span> {alert.severity}</div>
              <div><span className="text-muted-foreground">Status:</span> {alert.status}</div>
              <div><span className="text-muted-foreground">Subject:</span> {alert.subjectName ?? (alert.subjectUserId ? `User #${alert.subjectUserId}` : "—")}</div>
              <div><span className="text-muted-foreground">Role:</span> {alert.subjectRole ?? "—"}</div>
              <div><span className="text-muted-foreground">Score:</span> {Number(alert.score).toFixed(2)}</div>
              <div><span className="text-muted-foreground">Threshold:</span> {alert.threshold ? Number(alert.threshold).toFixed(2) : "—"}</div>
              <div><span className="text-muted-foreground">Window start:</span> {fmt(alert.windowStart)}</div>
              <div><span className="text-muted-foreground">Window end:</span> {fmt(alert.windowEnd)}</div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Evidence</Label>
              <pre className="bg-muted p-2 rounded text-[11px] overflow-auto max-h-40 mt-1">{JSON.stringify(alert.evidence, null, 2)}</pre>
            </div>
            <div>
              <Label className="text-xs">Review notes</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={alert.reviewNotes ?? "Add a note about your review…"} data-testid="input-review-notes" />
            </div>
          </div>
        ) : null}
        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => onUpdate("acknowledged", notes || undefined)} disabled={isUpdating} data-testid="button-acknowledge">Acknowledge</Button>
          <Button variant="outline" onClick={() => onUpdate("false_positive", notes || undefined)} disabled={isUpdating} data-testid="button-false-positive">
            <XCircle className="w-4 h-4 mr-1" /> False positive
          </Button>
          <Button onClick={() => onUpdate("resolved", notes || undefined)} disabled={isUpdating} data-testid="button-resolve">
            <CheckCircle2 className="w-4 h-4 mr-1" /> Resolve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FraudSettingsPanel({ restaurantId, canEdit, onClose }: {
  restaurantId: number; canEdit: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["fraud-settings", restaurantId],
    queryFn: () => apiGet<{ detectors: FraudDetectorSetting[] }>(`/restaurants/${restaurantId}/fraud-settings`),
  });
  const saveMutation = useMutation({
    mutationFn: (s: FraudDetectorSetting) =>
      apiAction(`/restaurants/${restaurantId}/fraud-settings`, "PATCH", {
        detector: s.detector, isEnabled: s.isEnabled, threshold: s.threshold,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fraud-settings", restaurantId] }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><SettingsIcon className="w-5 h-5" /> Fraud Detector Settings</DialogTitle>
          <DialogDescription>Toggle detectors and tune thresholds. Changes are audited.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {settingsQuery.isLoading && <div className="text-muted-foreground text-sm">Loading…</div>}
          {settingsQuery.data?.detectors.map(d => (
            <DetectorRow key={d.detector} setting={d} canEdit={canEdit} onSave={(next) => saveMutation.mutate(next)} />
          ))}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetectorRow({ setting, canEdit, onSave }: {
  setting: FraudDetectorSetting; canEdit: boolean; onSave: (s: FraudDetectorSetting) => void;
}) {
  const [enabled, setEnabled] = useState(setting.isEnabled);
  const [threshold, setThreshold] = useState(String(setting.threshold));
  const dirty = enabled !== setting.isEnabled || Number(threshold) !== setting.threshold;
  return (
    <div className="border border-border rounded-lg p-3 flex flex-wrap items-center gap-3" data-testid={`detector-row-${setting.detector}`}>
      <div className="flex-1 min-w-[180px]">
        <div className="font-medium text-sm">{DETECTOR_LABEL[setting.detector] ?? setting.detector}</div>
        <div className="text-xs text-muted-foreground">Default threshold: {setting.defaultThreshold}</div>
      </div>
      <div className="flex items-center gap-2">
        <Label className="text-xs">Enabled</Label>
        <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} data-testid={`switch-${setting.detector}`} />
      </div>
      <div className="flex items-center gap-2">
        <Label className="text-xs">Threshold</Label>
        <Input className="w-24" value={threshold} onChange={e => setThreshold(e.target.value)} disabled={!canEdit} data-testid={`input-threshold-${setting.detector}`} />
      </div>
      <Button size="sm" disabled={!canEdit || !dirty} onClick={() => onSave({ ...setting, isEnabled: enabled, threshold: Number(threshold) })} data-testid={`button-save-${setting.detector}`}>
        Save
      </Button>
    </div>
  );
}
