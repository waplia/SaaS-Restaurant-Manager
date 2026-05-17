import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout as Layout } from "@/components/layout/AdminLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPut, ApiError } from "@/lib/api";
import { ShieldAlert, Ban, BookOpen } from "lucide-react";

interface ScopeDef { key: string; label: string; description: string; category: string; write: boolean }
interface TenantOverride { restaurantId: number; rateLimitPerMin: number | null; apiDisabled: boolean; apiDisabledReason: string | null }

interface GlobalSettings {
  apiEnabled: boolean;
  defaultRateLimitPerMin: number;
  webhookMaxAttempts: number;
  webhookBaseDelaySec: number;
  logRetentionDays: number;
}

interface LogRow {
  id: number;
  restaurantId: number | null;
  apiKeyId: number | null;
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  ipAddress: string | null;
  createdAt: string;
}

export default function AdminApiSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: settings } = useQuery({
    queryKey: ["admin-api-settings"],
    queryFn: () => apiGet<GlobalSettings>("/admin/api-settings"),
  });

  const [form, setForm] = useState<GlobalSettings | null>(null);
  useEffect(() => { if (settings) setForm(settings); }, [settings]);

  const save = useMutation({
    mutationFn: (body: Partial<GlobalSettings>) => apiPut<GlobalSettings>("/admin/api-settings", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-api-settings"] }); toast({ title: "Settings saved" }); },
    onError: (e: unknown) => toast({ title: "Failed", description: e instanceof ApiError ? e.message : "Save failed", variant: "destructive" }),
  });

  const [restaurantFilter, setRestaurantFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  const { data: logs } = useQuery({
    queryKey: ["admin-api-logs", restaurantFilter, statusFilter, page],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(page), pageSize: "50" });
      if (restaurantFilter) qs.set("restaurantId", restaurantFilter);
      if (statusFilter) qs.set("statusCode", statusFilter);
      return apiGet<{ rows: LogRow[]; total: number; pageSize: number }>(`/admin/api-logs?${qs}`);
    },
  });

  const { data: scopeCatalog } = useQuery({
    queryKey: ["admin-api-scopes"],
    queryFn: () => apiGet<{ data: ScopeDef[] }>("/admin/api-scopes"),
  });

  const [killRestaurantId, setKillRestaurantId] = useState("");
  const [killReason, setKillReason] = useState("");
  const killId = Number(killRestaurantId) || 0;
  const { data: killOverride } = useQuery({
    queryKey: ["admin-kill-switch", killId],
    queryFn: () => apiGet<TenantOverride>(`/admin/restaurants/${killId}/api-rate-limit`),
    enabled: killId > 0,
  });
  const setKillSwitch = useMutation({
    mutationFn: (body: { apiDisabled: boolean; reason: string | null }) => apiPut(`/admin/restaurants/${killId}/api-kill-switch`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-kill-switch", killId] }); toast({ title: "Kill switch updated" }); },
    onError: (e: unknown) => toast({ title: "Failed", description: e instanceof ApiError ? e.message : "", variant: "destructive" }),
  });

  if (!form) return <Layout><div className="p-8">Loading…</div></Layout>;

  const rows = logs?.rows ?? [];
  const total = logs?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / (logs?.pageSize ?? 50)));

  return (
    <Layout>
      <PageHeader title="API & Webhook Settings" subtitle="Platform-wide controls for the public API and webhook dispatcher." />
      <div className="p-8 max-w-5xl space-y-6">
        <div className="rounded-lg border border-border bg-card/40 p-5 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2"><ShieldAlert className="w-4 h-4" /> Global API controls</h3>

          <div className="flex items-center justify-between rounded border border-border bg-background p-3">
            <div>
              <p className="text-sm font-medium">Public API enabled</p>
              <p className="text-xs text-muted-foreground">When off, all key-authenticated requests are rejected with HTTP 503.</p>
            </div>
            <button
              role="switch"
              aria-checked={form.apiEnabled}
              onClick={() => setForm({ ...form, apiEnabled: !form.apiEnabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${form.apiEnabled ? "bg-primary" : "bg-muted"}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${form.apiEnabled ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Default rate limit (requests/min)</Label>
              <Input type="number" min="1" value={form.defaultRateLimitPerMin}
                onChange={e => setForm({ ...form, defaultRateLimitPerMin: Math.max(1, Number(e.target.value) || 1) })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Log retention (days)</Label>
              <Input type="number" min="1" value={form.logRetentionDays}
                onChange={e => setForm({ ...form, logRetentionDays: Math.max(1, Number(e.target.value) || 1) })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Webhook max attempts</Label>
              <Input type="number" min="1" max="20" value={form.webhookMaxAttempts}
                onChange={e => setForm({ ...form, webhookMaxAttempts: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Webhook base backoff (sec)</Label>
              <Input type="number" min="1" value={form.webhookBaseDelaySec}
                onChange={e => setForm({ ...form, webhookBaseDelaySec: Math.max(1, Number(e.target.value) || 1) })} />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save settings"}</Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card/40 p-5 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Ban className="w-4 h-4" /> Per-restaurant kill switch <span className="text-xs font-normal text-muted-foreground">(scoped to a single restaurant ID; use the Global toggle above to halt all tenants at once)</span></h3>
          <p className="text-xs text-muted-foreground">Instantly block all public-API traffic for one restaurant. Existing keys stay alive but every request returns <code>503 tenant_api_disabled</code>. Action is recorded in the audit log.</p>
          <div className="flex gap-2 items-end">
            <div className="space-y-1.5"><Label className="text-xs">Restaurant ID</Label><Input className="w-32" type="number" value={killRestaurantId} onChange={e => setKillRestaurantId(e.target.value)} placeholder="e.g. 42" /></div>
            <div className="flex-1 space-y-1.5"><Label className="text-xs">Reason (shown to caller)</Label><Input value={killReason} onChange={e => setKillReason(e.target.value)} placeholder="Suspended pending billing resolution" /></div>
          </div>
          {killId > 0 && killOverride && (
            <div className="rounded border border-border bg-background p-3 flex items-center justify-between">
              <div>
                <p className="text-sm">Current state: {killOverride.apiDisabled
                  ? <span className="font-semibold text-destructive">API DISABLED</span>
                  : <span className="font-semibold text-green-700 dark:text-green-400">enabled</span>}</p>
                {killOverride.apiDisabledReason && <p className="text-xs text-muted-foreground">Reason: {killOverride.apiDisabledReason}</p>}
              </div>
              <div className="flex gap-2">
                {killOverride.apiDisabled ? (
                  <Button size="sm" variant="outline" onClick={() => setKillSwitch.mutate({ apiDisabled: false, reason: null })}>Re-enable</Button>
                ) : (
                  <Button size="sm" variant="destructive" onClick={() => { if (confirm(`Disable all API access for restaurant ${killId}?`)) setKillSwitch.mutate({ apiDisabled: true, reason: killReason.trim() || null }); }}>Disable API</Button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card/40 p-5 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2"><BookOpen className="w-4 h-4" /> Scope catalog ({scopeCatalog?.data.length ?? 0})</h3>
          <p className="text-xs text-muted-foreground">Scopes published in the platform-wide catalog. Tenants attach these to API keys and OAuth apps.</p>
          {scopeCatalog && (
            <table className="w-full text-xs border border-border rounded">
              <thead className="bg-muted/30"><tr><th className="text-left px-3 py-1.5">Scope</th><th className="text-left px-3 py-1.5">Category</th><th className="text-left px-3 py-1.5">Write</th><th className="text-left px-3 py-1.5">Description</th></tr></thead>
              <tbody>{scopeCatalog.data.map(s => (
                <tr key={s.key} className="border-t border-border">
                  <td className="px-3 py-1.5 font-mono">{s.key}</td>
                  <td className="px-3 py-1.5">{s.category}</td>
                  <td className="px-3 py-1.5">{s.write ? "yes" : "no"}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{s.description}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card/40 overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-3 flex-wrap">
            <h3 className="text-sm font-semibold">Platform-wide API request logs</h3>
            <Input className="h-8 w-32 text-xs" placeholder="restaurantId" value={restaurantFilter} onChange={e => { setRestaurantFilter(e.target.value); setPage(1); }} />
            <Input className="h-8 w-28 text-xs" placeholder="statusCode" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} />
            <span className="ml-auto text-xs text-muted-foreground">{total} total</span>
          </div>
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No requests recorded.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Time</th>
                  <th className="text-left px-4 py-2 font-medium">Restaurant</th>
                  <th className="text-left px-4 py-2 font-medium">Method</th>
                  <th className="text-left px-4 py-2 font-medium">Endpoint</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Latency</th>
                  <th className="text-left px-4 py-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2 text-xs">{r.restaurantId ?? "—"}</td>
                    <td className="px-4 py-2 text-xs font-mono">{r.method}</td>
                    <td className="px-4 py-2 text-xs font-mono truncate max-w-[260px]">{r.endpoint}</td>
                    <td className={`px-4 py-2 text-xs font-medium ${r.statusCode >= 400 ? "text-destructive" : "text-green-700 dark:text-green-400"}`}>{r.statusCode}</td>
                    <td className="px-4 py-2 text-xs">{r.latencyMs}ms</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{r.ipAddress ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {totalPages > 1 && (
            <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
              <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</Button>
              <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
