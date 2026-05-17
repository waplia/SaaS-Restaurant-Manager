import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost, apiDelete, ApiError } from "@/lib/api";
import { Plus, Trash2, Copy, KeyRound, AlertTriangle, RefreshCw, Activity, FlaskConical, Globe } from "lucide-react";

type Environment = "live" | "sandbox";

interface ScopeDef { key: string; label: string; description: string; category: string; write: boolean }

interface ApiKeyRow {
  id: number;
  name: string;
  prefix: string;
  environment: Environment;
  scopes: string[];
  rateLimitPerMin: number | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  rotatedFromId: number | null;
  rotatedAt: string | null;
  createdAt: string;
}

interface KeyUsage {
  total: number;
  errors: number;
  days: number;
  byDay: { day: string; total: number; errors: number; avg_latency: number }[];
}

export default function ApiKeysPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<Environment>("live");
  const [rateLimit, setRateLimit] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set());
  const [showFull, setShowFull] = useState<{ key: string; name: string; environment: Environment } | null>(null);
  const [usageFor, setUsageFor] = useState<ApiKeyRow | null>(null);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["api-keys", restaurantId],
    queryFn: () => apiGet<ApiKeyRow[]>(`/restaurants/${restaurantId}/api-keys`),
  });

  const { data: scopeCatalog = { data: [] as ScopeDef[] } } = useQuery({
    queryKey: ["api-scopes", restaurantId],
    queryFn: () => apiGet<{ data: ScopeDef[] }>(`/restaurants/${restaurantId}/api-scopes`),
  });
  const allScopes = scopeCatalog.data;

  const { data: usage } = useQuery({
    queryKey: ["api-key-usage", restaurantId, usageFor?.id],
    queryFn: () => apiGet<KeyUsage>(`/restaurants/${restaurantId}/api-keys/${usageFor!.id}/usage?days=7`),
    enabled: !!usageFor,
  });

  const create = useMutation({
    mutationFn: (body: { name: string; environment: Environment; scopes: string[]; rateLimitPerMin: number | null }) =>
      apiPost<{ fullKey: string; name: string; environment: Environment }>(`/restaurants/${restaurantId}/api-keys`, body),
    onSuccess: data => {
      setShowFull({ key: data.fullKey, name: data.name, environment: data.environment });
      setName(""); setRateLimit(""); setSelectedScopes(new Set());
      qc.invalidateQueries({ queryKey: ["api-keys", restaurantId] });
    },
    onError: (e: unknown) => toast({ title: "Failed", description: e instanceof ApiError ? e.message : "Could not create key", variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/api-keys/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["api-keys", restaurantId] }); toast({ title: "Key revoked" }); },
  });

  const rotate = useMutation({
    mutationFn: (id: number) => apiPost<{ fullKey: string; name: string; environment: Environment }>(`/restaurants/${restaurantId}/api-keys/${id}/rotate`),
    onSuccess: data => {
      setShowFull({ key: data.fullKey, name: `${data.name} (rotated)`, environment: data.environment });
      qc.invalidateQueries({ queryKey: ["api-keys", restaurantId] });
      toast({ title: "Key rotated — update your integration" });
    },
    onError: (e: unknown) => toast({ title: "Rotate failed", description: e instanceof ApiError ? e.message : "", variant: "destructive" }),
  });

  const onCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) { toast({ title: "Name is required", variant: "destructive" }); return; }
    const rl = rateLimit.trim() === "" ? null : Number(rateLimit);
    if (rl !== null && (!Number.isInteger(rl) || rl < 1)) {
      toast({ title: "Invalid rate limit", description: "Must be a positive integer or empty", variant: "destructive" }); return;
    }
    create.mutate({ name: trimmed, environment, scopes: Array.from(selectedScopes), rateLimitPerMin: rl });
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: "Copied to clipboard" }); }
    catch { toast({ title: "Copy failed", variant: "destructive" }); }
  };

  const toggleScope = (k: string) => {
    setSelectedScopes(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  };

  const groupedScopes = allScopes.reduce((acc, s) => {
    (acc[s.category] ??= []).push(s); return acc;
  }, {} as Record<string, ScopeDef[]>);

  return (
    <SettingsLayout activeKey="api-keys" title="API Keys" subtitle="Generate scoped live and sandbox keys for third-party integrations.">
      <div className="space-y-6">
        <div className="rounded-lg border border-border bg-card/40 p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4" /> Create new API key
          </h3>

          <div className="grid sm:grid-cols-3 gap-3 items-end">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Key name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Zapier integration" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Rate limit override (req/min)</Label>
              <Input type="number" min="1" value={rateLimit} onChange={e => setRateLimit(e.target.value)} placeholder="(use default)" />
            </div>
          </div>

          <div className="mt-4">
            <Label className="text-xs">Environment</Label>
            <div className="flex gap-2 mt-1.5">
              <button type="button" onClick={() => setEnvironment("live")}
                className={`flex-1 px-3 py-2 rounded-md border text-sm flex items-center justify-center gap-2 transition-colors ${environment === "live" ? "border-primary bg-primary/10 text-primary font-medium" : "border-border bg-background"}`}>
                <Globe className="w-3.5 h-3.5" /> Live (kl_live_…)
              </button>
              <button type="button" onClick={() => setEnvironment("sandbox")}
                className={`flex-1 px-3 py-2 rounded-md border text-sm flex items-center justify-center gap-2 transition-colors ${environment === "sandbox" ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium" : "border-border bg-background"}`}>
                <FlaskConical className="w-3.5 h-3.5" /> Sandbox (kl_test_…)
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">Sandbox keys are for non-production traffic. They authenticate against the same API; use them to keep test traffic out of your live usage dashboards.</p>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Scopes <span className="text-muted-foreground">({selectedScopes.size} selected — leave empty for read-only defaults)</span></Label>
              <Button size="sm" variant="ghost" className="text-xs h-auto py-1" onClick={() => setSelectedScopes(new Set(allScopes.filter(s => !s.write).map(s => s.key)))}>Select all read</Button>
            </div>
            <div className="mt-2 space-y-3">
              {Object.entries(groupedScopes).map(([cat, list]) => (
                <div key={cat}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{cat}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {list.map(s => (
                      <label key={s.key} className="flex items-start gap-2 px-2.5 py-1.5 rounded border border-border bg-background text-xs cursor-pointer hover:bg-accent/40">
                        <input type="checkbox" checked={selectedScopes.has(s.key)} onChange={() => toggleScope(s.key)} className="mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <code className="font-mono text-[11px]">{s.key}</code>
                          {s.write && <span className="ml-1 text-[10px] text-amber-600">write</span>}
                          <p className="text-[10px] text-muted-foreground truncate">{s.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <Button onClick={onCreate} disabled={create.isPending}>{create.isPending ? "Creating…" : "Create key"}</Button>
          </div>
        </div>

        {showFull && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">Save this key now — it will not be shown again.</p>
                  <p className="text-xs text-amber-800/80 dark:text-amber-200/80 mt-0.5">{showFull.environment === "sandbox" ? "Sandbox" : "Live"} key for "{showFull.name}". Anyone with this key can call your API.</p>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-background border border-border rounded text-xs font-mono break-all">{showFull.key}</code>
                  <Button size="sm" variant="outline" onClick={() => copy(showFull.key)}>
                    <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy
                  </Button>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setShowFull(null)}>I've saved it — dismiss</Button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-card/40 overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><KeyRound className="w-4 h-4" /> Your API keys</h3>
            <span className="text-xs text-muted-foreground">{keys.length} total</span>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : keys.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No keys yet — create your first key above.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Env</th>
                  <th className="text-left px-4 py-2 font-medium">Prefix</th>
                  <th className="text-left px-4 py-2 font-medium">Scopes</th>
                  <th className="text-left px-4 py-2 font-medium">Rate</th>
                  <th className="text-left px-4 py-2 font-medium">Last used</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id} className="border-t border-border">
                    <td className="px-4 py-2.5 font-medium">{k.name}{k.rotatedFromId ? <span className="ml-1.5 text-[10px] text-muted-foreground">(rotated)</span> : null}</td>
                    <td className="px-4 py-2.5">
                      {k.environment === "sandbox"
                        ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px] font-medium"><FlaskConical className="w-3 h-3" />sandbox</span>
                        : <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium"><Globe className="w-3 h-3" />live</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{k.prefix}…</td>
                    <td className="px-4 py-2.5 text-xs">
                      {k.scopes.length === 0
                        ? <span className="text-muted-foreground italic">legacy (all)</span>
                        : <span className="font-mono text-[10px]">{k.scopes.length} scope{k.scopes.length === 1 ? "" : "s"}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs">{k.rateLimitPerMin ? `${k.rateLimitPerMin}/min` : "default"}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never"}</td>
                    <td className="px-4 py-2.5">
                      {k.revokedAt
                        ? <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-xs font-medium">Revoked</span>
                        : <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 text-xs font-medium">Active</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right space-x-1">
                      {!k.revokedAt && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setUsageFor(k)} title="View usage"><Activity className="w-3.5 h-3.5" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Rotate "${k.name}"? The current key stops working immediately and a new key is shown once.`)) rotate.mutate(k.id); }} title="Rotate key"><RefreshCw className="w-3.5 h-3.5" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Revoke "${k.name}"? Future requests with this key will be rejected.`)) revoke.mutate(k.id); }} title="Revoke key">
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {usageFor && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onClick={() => setUsageFor(null)}>
            <div className="bg-background border border-border rounded-lg max-w-2xl w-full max-h-[80vh] overflow-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-base font-semibold">Usage — {usageFor.name}</h3>
                  <p className="text-xs text-muted-foreground">Last 7 days · {usageFor.scopes.length === 0 ? "legacy scopes" : `${usageFor.scopes.length} scopes`}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setUsageFor(null)}>Close</Button>
              </div>
              {!usage ? (
                <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded border border-border p-3">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Requests (7d)</p>
                      <p className="text-2xl font-semibold mt-1">{usage.total.toLocaleString()}</p>
                    </div>
                    <div className="rounded border border-border p-3">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Errors (4xx/5xx)</p>
                      <p className="text-2xl font-semibold mt-1 text-destructive">{usage.errors.toLocaleString()}</p>
                    </div>
                    <div className="rounded border border-border p-3">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Error rate</p>
                      <p className="text-2xl font-semibold mt-1">{usage.total > 0 ? `${((usage.errors / usage.total) * 100).toFixed(1)}%` : "—"}</p>
                    </div>
                  </div>

                  <div className="rounded border border-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/30">
                        <tr>
                          <th className="text-left px-3 py-1.5 font-medium">Day</th>
                          <th className="text-right px-3 py-1.5 font-medium">Total</th>
                          <th className="text-right px-3 py-1.5 font-medium">Errors</th>
                          <th className="text-right px-3 py-1.5 font-medium">Avg latency</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usage.byDay.length === 0 ? (
                          <tr><td colSpan={4} className="text-center text-muted-foreground py-4">No requests yet.</td></tr>
                        ) : usage.byDay.map(d => (
                          <tr key={d.day} className="border-t border-border">
                            <td className="px-3 py-1.5">{new Date(d.day).toLocaleDateString()}</td>
                            <td className="px-3 py-1.5 text-right">{d.total}</td>
                            <td className={`px-3 py-1.5 text-right ${d.errors > 0 ? "text-destructive" : ""}`}>{d.errors}</td>
                            <td className="px-3 py-1.5 text-right">{d.avg_latency ?? 0}ms</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <p className="text-xs font-semibold mb-1.5">Granted scopes</p>
                    <div className="flex flex-wrap gap-1">
                      {usageFor.scopes.length === 0
                        ? <span className="text-xs italic text-muted-foreground">Legacy key — all endpoints allowed.</span>
                        : usageFor.scopes.map(s => <code key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">{s}</code>)}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </SettingsLayout>
  );
}
