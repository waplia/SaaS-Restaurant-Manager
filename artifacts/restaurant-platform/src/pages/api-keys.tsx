import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost, apiDelete, ApiError } from "@/lib/api";
import { Plus, Trash2, Copy, KeyRound, AlertTriangle } from "lucide-react";

interface ApiKeyRow {
  id: number;
  name: string;
  prefix: string;
  rateLimitPerMin: number | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export default function ApiKeysPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [rateLimit, setRateLimit] = useState("");
  const [showFull, setShowFull] = useState<{ key: string; name: string } | null>(null);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["api-keys", restaurantId],
    queryFn: () => apiGet<ApiKeyRow[]>(`/restaurants/${restaurantId}/api-keys`),
  });

  const create = useMutation({
    mutationFn: (body: { name: string; rateLimitPerMin: number | null }) =>
      apiPost<{ fullKey: string; name: string }>(`/restaurants/${restaurantId}/api-keys`, body),
    onSuccess: data => {
      setShowFull({ key: data.fullKey, name: data.name });
      setName("");
      setRateLimit("");
      qc.invalidateQueries({ queryKey: ["api-keys", restaurantId] });
    },
    onError: (e: unknown) => toast({ title: "Failed", description: e instanceof ApiError ? e.message : "Could not create key", variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/api-keys/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-keys", restaurantId] });
      toast({ title: "Key revoked" });
    },
  });

  const onCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) { toast({ title: "Name is required", variant: "destructive" }); return; }
    const rl = rateLimit.trim() === "" ? null : Number(rateLimit);
    if (rl !== null && (!Number.isInteger(rl) || rl < 1)) {
      toast({ title: "Invalid rate limit", description: "Must be a positive integer or empty", variant: "destructive" }); return;
    }
    create.mutate({ name: trimmed, rateLimitPerMin: rl });
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: "Copied to clipboard" }); }
    catch { toast({ title: "Copy failed", variant: "destructive" }); }
  };

  return (
    <SettingsLayout activeKey="api-keys" title="API Keys" subtitle="Generate and manage API keys for third-party integrations.">
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
          <div className="mt-4 flex justify-end">
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
                  <p className="text-xs text-amber-800/80 dark:text-amber-200/80 mt-0.5">Key for "{showFull.name}". Anyone with this key can call your API.</p>
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
                  <th className="text-left px-4 py-2 font-medium">Prefix</th>
                  <th className="text-left px-4 py-2 font-medium">Rate limit</th>
                  <th className="text-left px-4 py-2 font-medium">Last used</th>
                  <th className="text-left px-4 py-2 font-medium">Created</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id} className="border-t border-border">
                    <td className="px-4 py-2.5 font-medium">{k.name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{k.prefix}…</td>
                    <td className="px-4 py-2.5 text-xs">{k.rateLimitPerMin ? `${k.rateLimitPerMin}/min` : "default"}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never"}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(k.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5">
                      {k.revokedAt
                        ? <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-xs font-medium">Revoked</span>
                        : <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 text-xs font-medium">Active</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {!k.revokedAt && (
                        <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Revoke "${k.name}"? Future requests with this key will be rejected.`)) revoke.mutate(k.id); }}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </SettingsLayout>
  );
}
