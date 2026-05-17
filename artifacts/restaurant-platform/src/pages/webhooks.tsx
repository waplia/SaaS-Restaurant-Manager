import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "@/lib/api";
import { Plus, Trash2, RefreshCw, Copy, Webhook, Pencil, Activity, CheckCircle2, XCircle, Clock } from "lucide-react";

const EVENT_TYPES = [
  "order.created", "order.updated", "order.completed", "order.cancelled",
  "payment.succeeded", "payment.failed",
  "menu.updated", "reservation.created", "customer.created",
] as const;
type EventType = typeof EVENT_TYPES[number];

interface WebhookRow {
  id: number;
  url: string;
  events: EventType[];
  secret: string;
  active: boolean;
  createdAt: string;
}

export default function WebhooksPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WebhookRow | null>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<Set<EventType>>(new Set());
  const [active, setActive] = useState(true);

  const { data: hooks = [], isLoading } = useQuery({
    queryKey: ["webhooks", restaurantId],
    queryFn: () => apiGet<WebhookRow[]>(`/restaurants/${restaurantId}/webhooks`),
  });

  interface HealthRow {
    endpoint_id: number;
    url: string;
    active: boolean;
    total_24h: number;
    delivered_24h: number;
    failed_24h: number;
    dead_24h: number;
    pending: number;
    last_delivered_at: string | null;
    last_failure_at: string | null;
  }
  const { data: health } = useQuery({
    queryKey: ["webhook-health", restaurantId],
    queryFn: () => apiGet<{ endpoints: HealthRow[] }>(`/restaurants/${restaurantId}/webhook-health`),
    refetchInterval: 30000,
  });
  const healthRows = health?.endpoints ?? [];

  const reset = () => { setUrl(""); setEvents(new Set()); setActive(true); setEditing(null); setShowForm(false); };

  const create = useMutation({
    mutationFn: (body: { url: string; events: EventType[]; active: boolean }) =>
      apiPost(`/restaurants/${restaurantId}/webhooks`, body),
    onSuccess: () => { reset(); qc.invalidateQueries({ queryKey: ["webhooks", restaurantId] }); toast({ title: "Webhook created" }); },
    onError: (e: unknown) => toast({ title: "Failed", description: e instanceof ApiError ? e.message : "Could not create", variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: (args: { id: number; body: Partial<{ url: string; events: EventType[]; active: boolean }> }) =>
      apiPatch(`/restaurants/${restaurantId}/webhooks/${args.id}`, args.body),
    onSuccess: () => { reset(); qc.invalidateQueries({ queryKey: ["webhooks", restaurantId] }); toast({ title: "Webhook updated" }); },
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/webhooks/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["webhooks", restaurantId] }); toast({ title: "Webhook deleted" }); },
  });

  const rotate = useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${restaurantId}/webhooks/${id}/rotate-secret`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["webhooks", restaurantId] }); toast({ title: "Secret rotated — update your endpoint" }); },
  });

  const retryFailed = useMutation({
    mutationFn: (id: number) => apiPost<{ retried: number }>(`/restaurants/${restaurantId}/webhooks/${id}/retry-failed`),
    onSuccess: r => toast({ title: `Re-queued ${r.retried} failed deliveries` }),
  });

  const onSubmit = () => {
    if (!/^https?:\/\//i.test(url.trim())) { toast({ title: "Invalid URL", variant: "destructive" }); return; }
    if (events.size === 0) { toast({ title: "Select at least one event", variant: "destructive" }); return; }
    const body = { url: url.trim(), events: Array.from(events), active };
    if (editing) update.mutate({ id: editing.id, body });
    else create.mutate(body);
  };

  const onEdit = (h: WebhookRow) => {
    setEditing(h); setUrl(h.url); setEvents(new Set(h.events)); setActive(h.active); setShowForm(true);
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: "Copied" }); } catch { /* ignore */ }
  };

  const toggleEvent = (e: EventType) => {
    setEvents(prev => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e); else next.add(e);
      return next;
    });
  };

  return (
    <SettingsLayout activeKey="webhooks" title="Webhooks" subtitle="Receive HTTP callbacks when events happen in your restaurant.">
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">Endpoints receive signed POST payloads. Verify signatures using the secret with HMAC-SHA256.</p>
          {!showForm && <Button onClick={() => setShowForm(true)}><Plus className="w-4 h-4 mr-1.5" /> Add endpoint</Button>}
        </div>

        {healthRows.length > 0 && (
          <div className="rounded-lg border border-border bg-card/40 overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <Activity className="w-4 h-4" />
              <h3 className="text-sm font-semibold">Health at a glance · last 24 hours</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
              {healthRows.map(h => {
                const successRate = h.total_24h > 0 ? Math.round((h.delivered_24h / h.total_24h) * 100) : null;
                const tone = h.dead_24h > 0 ? "destructive" : h.failed_24h > 0 ? "amber" : h.total_24h > 0 ? "green" : "muted";
                const toneCls = tone === "destructive" ? "border-destructive/40 bg-destructive/5"
                  : tone === "amber" ? "border-amber-500/40 bg-amber-500/5"
                  : tone === "green" ? "border-green-500/40 bg-green-500/5" : "border-border";
                return (
                  <div key={h.endpoint_id} className={`rounded border p-3 ${toneCls}`}>
                    <div className="flex items-start justify-between gap-2">
                      <code className="text-xs font-mono truncate flex-1 min-w-0">{h.url}</code>
                      {h.active
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-700 dark:text-green-400">on</span>
                        : <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">paused</span>}
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-2 text-center">
                      <div><p className="text-[10px] uppercase text-muted-foreground">Success</p><p className="text-sm font-semibold">{successRate != null ? `${successRate}%` : "—"}</p></div>
                      <div><p className="text-[10px] uppercase text-muted-foreground flex items-center gap-0.5 justify-center"><CheckCircle2 className="w-2.5 h-2.5" /> OK</p><p className="text-sm font-semibold">{h.delivered_24h}</p></div>
                      <div><p className="text-[10px] uppercase text-muted-foreground flex items-center gap-0.5 justify-center"><XCircle className="w-2.5 h-2.5" /> Fail</p><p className="text-sm font-semibold text-destructive">{h.failed_24h + h.dead_24h}</p></div>
                      <div><p className="text-[10px] uppercase text-muted-foreground flex items-center gap-0.5 justify-center"><Clock className="w-2.5 h-2.5" /> Pend</p><p className="text-sm font-semibold">{h.pending}</p></div>
                    </div>
                    {h.last_failure_at && (
                      <p className="text-[10px] text-destructive mt-2">Last failure {new Date(h.last_failure_at).toLocaleString()}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {showForm && (
          <div className="rounded-lg border border-border bg-card/40 p-5 space-y-4">
            <h3 className="text-sm font-semibold">{editing ? "Edit endpoint" : "New endpoint"}</h3>
            <div className="space-y-1.5">
              <Label className="text-xs">URL (HTTPS recommended)</Label>
              <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://your-site.com/webhook" />
            </div>
            <div>
              <Label className="text-xs">Subscribed events</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                {EVENT_TYPES.map(ev => (
                  <label key={ev} className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-border bg-background text-xs cursor-pointer hover:bg-accent/40">
                    <input type="checkbox" checked={events.has(ev)} onChange={() => toggleEvent(ev)} />
                    <span className="font-mono">{ev}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active (deliver events)
            </label>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={reset}>Cancel</Button>
              <Button onClick={onSubmit} disabled={create.isPending || update.isPending}>{editing ? "Save" : "Create"}</Button>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-card/40 overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <Webhook className="w-4 h-4" />
            <h3 className="text-sm font-semibold">Configured endpoints</h3>
            <span className="ml-auto text-xs text-muted-foreground">{hooks.length} total</span>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : hooks.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No webhooks configured.</div>
          ) : (
            <ul className="divide-y divide-border">
              {hooks.map(h => (
                <li key={h.id} className="px-5 py-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono truncate">{h.url}</code>
                        {h.active
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 text-xs">Active</span>
                          : <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">Paused</span>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {h.events.map(e => <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">{e}</span>)}
                      </div>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <Button size="sm" variant="ghost" onClick={() => onEdit(h)} title="Edit"><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm("Rotate secret? Existing integrations will need to be updated.")) rotate.mutate(h.id); }} title="Rotate secret"><RefreshCw className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => retryFailed.mutate(h.id)} title="Retry failed deliveries">↻</Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm("Delete this endpoint? Pending deliveries will be cancelled.")) remove.mutate(h.id); }} title="Delete"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Signing secret</span>
                    <code className="flex-1 text-xs font-mono px-2 py-1 bg-background border border-border rounded truncate">{h.secret}</code>
                    <Button size="sm" variant="outline" onClick={() => copy(h.secret)}><Copy className="w-3 h-3" /></Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SettingsLayout>
  );
}
