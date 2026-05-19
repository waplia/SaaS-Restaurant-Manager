import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Save, Send, Trash2, Plus, RefreshCw, Megaphone, FileText, Users, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiAction, apiDelete } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";

type Features = Record<string, boolean>;
interface Settings {
  id: number;
  restaurantId: number;
  enabled: boolean;
  features: Features;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  dailyCap: number | null;
  monthlyCap: number | null;
  perCustomerDailyCap: number;
  minCampaignGapMinutes: number;
  allowRichImages: boolean;
  requireMarketingOptIn: boolean;
  defaultClickUrl: string | null;
  lastTestAt: string | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
}
interface Limits { dailyCap?: number | null; monthlyCap?: number | null; allowRichImages?: boolean; allowedFeatures?: string[] }
interface SettingsResp { settings: Settings; limits: Limits; knownFeatures: string[]; knownEvents: string[] }
interface Template { id: number; eventKey: string; name: string; title: string; body: string; iconUrl: string | null; imageUrl: string | null; clickUrl: string | null; variables: string[]; isActive: boolean }
interface Campaign { id: number; name: string; title: string; body: string; status: string; scheduledAt: string | null; sentAt: string | null; targetedCount: number; sentCount: number; failedCount: number; clickedCount: number }
interface Subscriber { id: number; audience: string; status: string; browser: string | null; device: string | null; customerId: number | null; marketingOptIn: boolean; orderUpdatesOptIn: boolean; lastSentAt: string | null; failureCount: number; createdAt: string }
interface Usage { activeSubscribers: number; sent: number; failed: number; recent: Array<{ id: number; status: string; eventKey: string; failureReason: string | null; createdAt: string }> }

export default function WebPushSection() {
  const [tab, setTab] = useState<"settings" | "templates" | "campaigns" | "subscribers" | "usage">("settings");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Bell className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">Web Push Notifications</h2>
      </div>
      <p className="text-sm text-muted-foreground">Send rich browser notifications to customers and staff. The platform provider is set by the super admin; you control opt-in events, quiet hours, and campaigns.</p>
      <div className="border-b border-border flex gap-1 flex-wrap">
        {([
          ["settings", "Settings", Bell],
          ["templates", "Templates", FileText],
          ["campaigns", "Campaigns", Megaphone],
          ["subscribers", "Subscribers", Users],
          ["usage", "Usage", BarChart3],
        ] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px inline-flex items-center gap-1.5 ${tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>
      {tab === "settings" && <SettingsTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "campaigns" && <CampaignsTab />}
      {tab === "subscribers" && <SubscribersTab />}
      {tab === "usage" && <UsageTab />}
    </div>
  );
}

function SettingsTab() {
  const rid = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<SettingsResp>({
    queryKey: ["web-push", "settings", rid],
    queryFn: () => apiFetch(`/restaurants/${rid}/web-push/settings`),
  });
  const [form, setForm] = useState<Partial<Settings>>({});
  const merged = { ...(data?.settings ?? {} as Settings), ...form };
  const set = (k: keyof Settings, v: unknown) => setForm(p => ({ ...p, [k]: v }));
  const features = (merged.features ?? {}) as Features;
  const setFeature = (k: string, v: boolean) => set("features", { ...features, [k]: v });

  const save = useMutation({
    mutationFn: () => apiAction(`/restaurants/${rid}/web-push/settings`, "PUT", form),
    onSuccess: () => { toast({ title: "Saved" }); setForm({}); qc.invalidateQueries({ queryKey: ["web-push", "settings", rid] }); },
    onError: e => toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" }),
  });
  const test = useMutation({
    mutationFn: () => apiAction<{ ok: boolean; error?: string }>(`/restaurants/${rid}/web-push/test`, "POST", {}),
    onSuccess: r => { toast({ title: r.ok ? "Test sent" : "Test failed", description: r.error, variant: r.ok ? undefined : "destructive" }); qc.invalidateQueries({ queryKey: ["web-push", "settings", rid] }); },
    onError: e => toast({ title: "Test failed", description: (e as Error).message, variant: "destructive" }),
  });

  if (isLoading || !data) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const limits = data.limits ?? {};

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Enable Web Push for this restaurant</div>
            <div className="text-xs text-muted-foreground">When off, no notifications are sent regardless of triggers below.</div>
          </div>
          <Switch checked={!!merged.enabled} onCheckedChange={v => set("enabled", v)} />
        </div>
        {data.settings.lastTestAt && (
          <div className="text-xs text-muted-foreground">Last test: {new Date(data.settings.lastTestAt).toLocaleString()} — {data.settings.lastTestStatus ?? "—"}{data.settings.lastTestError ? ` (${data.settings.lastTestError})` : ""}</div>
        )}
      </div>

      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="font-medium">Trigger events</div>
        <div className="text-xs text-muted-foreground">Choose which events should send a Web Push notification.</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {data.knownFeatures.map(k => {
            const allowed = !limits.allowedFeatures || limits.allowedFeatures.includes(k);
            return (
              <label key={k} className={`flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 ${allowed ? "" : "opacity-60"}`}>
                <span className="text-sm">{k.replace(/_/g, " ").replace(/\./g, " · ")}</span>
                <Switch disabled={!allowed} checked={!!features[k]} onCheckedChange={v => setFeature(k, v)} />
              </label>
            );
          })}
        </div>
        {limits.allowedFeatures && <div className="text-xs text-muted-foreground">Your plan includes: {limits.allowedFeatures.join(", ")}</div>}
      </div>

      <div className="rounded-lg border border-border p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Quiet hours start (HH:MM)</Label>
          <Input value={merged.quietHoursStart ?? ""} onChange={e => set("quietHoursStart", e.target.value || null)} placeholder="22:00" />
        </div>
        <div>
          <Label>Quiet hours end (HH:MM)</Label>
          <Input value={merged.quietHoursEnd ?? ""} onChange={e => set("quietHoursEnd", e.target.value || null)} placeholder="08:00" />
        </div>
        <div>
          <Label>Daily cap {limits.dailyCap ? <span className="text-xs text-muted-foreground">(plan max {limits.dailyCap})</span> : null}</Label>
          <Input type="number" value={merged.dailyCap ?? ""} onChange={e => set("dailyCap", e.target.value ? Number(e.target.value) : null)} />
        </div>
        <div>
          <Label>Monthly cap {limits.monthlyCap ? <span className="text-xs text-muted-foreground">(plan max {limits.monthlyCap})</span> : null}</Label>
          <Input type="number" value={merged.monthlyCap ?? ""} onChange={e => set("monthlyCap", e.target.value ? Number(e.target.value) : null)} />
        </div>
        <div>
          <Label>Per-customer daily cap</Label>
          <Input type="number" value={merged.perCustomerDailyCap ?? 3} onChange={e => set("perCustomerDailyCap", Number(e.target.value))} />
        </div>
        <div>
          <Label>Minimum gap between marketing campaigns (minutes)</Label>
          <Input type="number" value={merged.minCampaignGapMinutes ?? 60} onChange={e => set("minCampaignGapMinutes", Number(e.target.value))} />
        </div>
        <div className="md:col-span-2">
          <Label>Default click URL</Label>
          <Input value={merged.defaultClickUrl ?? ""} onChange={e => set("defaultClickUrl", e.target.value || null)} placeholder="/orders" />
        </div>
        <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 md:col-span-2">
          <span className="text-sm">Allow rich images {limits.allowRichImages === false ? <span className="text-xs text-muted-foreground">(not available on your plan)</span> : null}</span>
          <Switch disabled={limits.allowRichImages === false} checked={!!merged.allowRichImages} onCheckedChange={v => set("allowRichImages", v)} />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 md:col-span-2">
          <span className="text-sm">Require explicit marketing opt-in for promotional campaigns</span>
          <Switch checked={merged.requireMarketingOptIn !== false} onCheckedChange={v => set("requireMarketingOptIn", v)} />
        </label>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending || Object.keys(form).length === 0}><Save className="w-4 h-4 mr-1.5" />Save</Button>
        <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}><Send className="w-4 h-4 mr-1.5" />Send test push</Button>
      </div>
    </div>
  );
}

function TemplatesTab() {
  const rid = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data = [] } = useQuery<Template[]>({ queryKey: ["web-push", "templates", rid], queryFn: () => apiFetch(`/restaurants/${rid}/web-push/templates`) });
  const { data: settings } = useQuery<SettingsResp>({ queryKey: ["web-push", "settings", rid], queryFn: () => apiFetch(`/restaurants/${rid}/web-push/settings`) });
  const [draft, setDraft] = useState<Partial<Template>>({ eventKey: "", name: "", title: "", body: "" });
  const create = useMutation({
    mutationFn: () => apiAction(`/restaurants/${rid}/web-push/templates`, "POST", draft),
    onSuccess: () => { toast({ title: "Template created" }); setDraft({ eventKey: "", name: "", title: "", body: "" }); qc.invalidateQueries({ queryKey: ["web-push", "templates", rid] }); },
    onError: e => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${rid}/web-push/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["web-push", "templates", rid] }),
  });
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>Event</Label>
          <select className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm" value={draft.eventKey ?? ""} onChange={e => setDraft({ ...draft, eventKey: e.target.value })}>
            <option value="">Select event…</option>
            {(settings?.knownEvents ?? []).map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div>
          <Label>Internal name</Label>
          <Input value={draft.name ?? ""} onChange={e => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <Label>Title</Label>
          <Input value={draft.title ?? ""} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Your order is ready, {{customerName}}!" />
        </div>
        <div className="md:col-span-2">
          <Label>Body</Label>
          <Textarea value={draft.body ?? ""} onChange={e => setDraft({ ...draft, body: e.target.value })} placeholder="Order #{{orderNumber}} is ready for pickup." rows={3} />
        </div>
        <div>
          <Label>Icon URL</Label>
          <Input value={draft.iconUrl ?? ""} onChange={e => setDraft({ ...draft, iconUrl: e.target.value })} />
        </div>
        <div>
          <Label>Image URL (large)</Label>
          <Input value={draft.imageUrl ?? ""} onChange={e => setDraft({ ...draft, imageUrl: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <Label>Click URL</Label>
          <Input value={draft.clickUrl ?? ""} onChange={e => setDraft({ ...draft, clickUrl: e.target.value })} placeholder="/orders/{{orderId}}" />
        </div>
        <div className="md:col-span-2">
          <Button onClick={() => create.mutate()} disabled={create.isPending || !draft.eventKey || !draft.name || !draft.title || !draft.body}><Plus className="w-4 h-4 mr-1.5" />Add template</Button>
        </div>
      </div>
      <div className="border border-border rounded-lg divide-y divide-border">
        {data.length === 0 && <div className="p-4 text-sm text-muted-foreground">No templates yet. Defaults will be used until you create one.</div>}
        {data.map(t => (
          <div key={t.id} className="p-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">{t.name} <Badge variant="outline" className="ml-2 text-[10px]">{t.eventKey}</Badge></div>
              <div className="text-sm text-foreground/90 mt-0.5">{t.title}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{t.body}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => del.mutate(t.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CampaignsTab() {
  const rid = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data = [] } = useQuery<Campaign[]>({ queryKey: ["web-push", "campaigns", rid], queryFn: () => apiFetch(`/restaurants/${rid}/web-push/campaigns`) });
  const [draft, setDraft] = useState<Partial<Campaign> & { iconUrl?: string; imageUrl?: string; clickUrl?: string }>({ name: "", title: "", body: "" });
  const create = useMutation({
    mutationFn: () => apiAction(`/restaurants/${rid}/web-push/campaigns`, "POST", draft),
    onSuccess: () => { toast({ title: "Campaign saved" }); setDraft({ name: "", title: "", body: "" }); qc.invalidateQueries({ queryKey: ["web-push", "campaigns", rid] }); },
    onError: e => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  const send = useMutation({
    mutationFn: (id: number) => apiAction<{ sent: number; failed: number; total: number; reason?: string }>(`/restaurants/${rid}/web-push/campaigns/${id}/send`, "POST"),
    onSuccess: r => { toast({ title: `${r.sent}/${r.total} delivered`, description: r.reason }); qc.invalidateQueries({ queryKey: ["web-push", "campaigns", rid] }); },
    onError: e => toast({ title: "Send failed", description: (e as Error).message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${rid}/web-push/campaigns/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["web-push", "campaigns", rid] }),
  });
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2"><Label>Name</Label><Input value={draft.name ?? ""} onChange={e => setDraft({ ...draft, name: e.target.value })} /></div>
        <div className="md:col-span-2"><Label>Title</Label><Input value={draft.title ?? ""} onChange={e => setDraft({ ...draft, title: e.target.value })} /></div>
        <div className="md:col-span-2"><Label>Body</Label><Textarea rows={3} value={draft.body ?? ""} onChange={e => setDraft({ ...draft, body: e.target.value })} /></div>
        <div><Label>Icon URL</Label><Input value={draft.iconUrl ?? ""} onChange={e => setDraft({ ...draft, iconUrl: e.target.value })} /></div>
        <div><Label>Image URL</Label><Input value={draft.imageUrl ?? ""} onChange={e => setDraft({ ...draft, imageUrl: e.target.value })} /></div>
        <div className="md:col-span-2"><Label>Click URL</Label><Input value={draft.clickUrl ?? ""} onChange={e => setDraft({ ...draft, clickUrl: e.target.value })} /></div>
        <div className="md:col-span-2">
          <Button onClick={() => create.mutate()} disabled={create.isPending || !draft.name || !draft.title || !draft.body}><Plus className="w-4 h-4 mr-1.5" />Save draft</Button>
        </div>
      </div>
      <div className="border border-border rounded-lg divide-y divide-border">
        {data.length === 0 && <div className="p-4 text-sm text-muted-foreground">No campaigns yet.</div>}
        {data.map(c => (
          <div key={c.id} className="p-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{c.name} <Badge variant="outline" className="ml-2 text-[10px] uppercase">{c.status}</Badge></div>
              <div className="text-sm">{c.title}</div>
              <div className="text-xs text-muted-foreground truncate">{c.body}</div>
              {c.sentAt && <div className="text-xs text-muted-foreground mt-0.5">Sent {new Date(c.sentAt).toLocaleString()} · {c.sentCount}/{c.targetedCount} delivered · {c.failedCount} failed · {c.clickedCount} clicks</div>}
            </div>
            <div className="flex gap-1">
              {(c.status === "draft" || c.status === "scheduled" || c.status === "failed") && (
                <Button size="sm" onClick={() => send.mutate(c.id)} disabled={send.isPending}><Send className="w-3.5 h-3.5 mr-1" />Send</Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => del.mutate(c.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SubscribersTab() {
  const rid = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data = [] } = useQuery<Subscriber[]>({ queryKey: ["web-push", "subscribers", rid], queryFn: () => apiFetch(`/restaurants/${rid}/web-push/subscribers`) });
  const cleanup = useMutation({
    mutationFn: () => apiAction<{ cleaned: number }>(`/restaurants/${rid}/web-push/subscribers/cleanup`, "POST"),
    onSuccess: r => { toast({ title: `Marked ${r.cleaned} as expired` }); qc.invalidateQueries({ queryKey: ["web-push", "subscribers", rid] }); },
  });
  const unsub = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${rid}/web-push/subscribers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["web-push", "subscribers", rid] }),
  });
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">{data.length} subscriber{data.length === 1 ? "" : "s"}</div>
        <Button variant="outline" size="sm" onClick={() => cleanup.mutate()} disabled={cleanup.isPending}><RefreshCw className="w-3.5 h-3.5 mr-1" />Cleanup failed</Button>
      </div>
      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase">
            <tr><th className="px-3 py-2 text-left">Audience</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Browser / device</th><th className="px-3 py-2 text-left">Opt-ins</th><th className="px-3 py-2 text-left">Last sent</th><th className="px-3 py-2 text-left">Failures</th><th></th></tr>
          </thead>
          <tbody>
            {data.map(s => (
              <tr key={s.id} className="border-t border-border">
                <td className="px-3 py-2">{s.audience}</td>
                <td className="px-3 py-2"><Badge variant={s.status === "active" ? "default" : "outline"}>{s.status}</Badge></td>
                <td className="px-3 py-2 text-xs">{s.browser ?? "—"} / {s.device ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{s.orderUpdatesOptIn ? "orders" : ""} {s.marketingOptIn ? "marketing" : ""}</td>
                <td className="px-3 py-2 text-xs">{s.lastSentAt ? new Date(s.lastSentAt).toLocaleString() : "—"}</td>
                <td className="px-3 py-2 text-xs">{s.failureCount}</td>
                <td className="px-3 py-2"><Button variant="ghost" size="icon" onClick={() => unsub.mutate(s.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button></td>
              </tr>
            ))}
            {data.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No subscribers yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsageTab() {
  const rid = useRestaurantId();
  const { data } = useQuery<Usage>({ queryKey: ["web-push", "usage", rid], queryFn: () => apiFetch(`/restaurants/${rid}/web-push/usage`) });
  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border p-4"><div className="text-xs text-muted-foreground">Active subscribers</div><div className="text-2xl font-semibold">{data.activeSubscribers}</div></div>
        <div className="rounded-lg border border-border p-4"><div className="text-xs text-muted-foreground">Sent (30d)</div><div className="text-2xl font-semibold">{data.sent}</div></div>
        <div className="rounded-lg border border-border p-4"><div className="text-xs text-muted-foreground">Failed (30d)</div><div className="text-2xl font-semibold">{data.failed}</div></div>
      </div>
      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase"><tr><th className="px-3 py-2 text-left">Event</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Reason</th><th className="px-3 py-2 text-left">When</th></tr></thead>
          <tbody>
            {data.recent.map(l => (
              <tr key={l.id} className="border-t border-border"><td className="px-3 py-2">{l.eventKey}</td><td className="px-3 py-2"><Badge variant={l.status === "sent" ? "default" : "outline"}>{l.status}</Badge></td><td className="px-3 py-2 text-xs">{l.failureReason ?? "—"}</td><td className="px-3 py-2 text-xs">{new Date(l.createdAt).toLocaleString()}</td></tr>
            ))}
            {data.recent.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No activity yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
