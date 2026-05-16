import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Save, Send, RefreshCw, Download, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiAction, getApiUrl } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";

interface WaSettings {
  id: number; isEnabled: boolean; usePlatformAccount: boolean;
  accessToken: string; phoneNumberId: string | null; wabaId: string | null;
  businessId: string | null; webhookVerifyToken: string;
  lastTestAt: string | null; lastTestStatus: string | null; lastTestError: string | null;
}
interface SettingsResp { settings: WaSettings | null; webhookUrl: string; platformAvailable: boolean }
interface Template { id: number; name: string; language: string; status: string; category: string | null; bodyPreview: string | null; defaultForEvent: string | null }
interface LogRow { id: number; recipient: string; templateName: string | null; status: string; reason: string | null; createdAt: string }
interface UsageResp { sent: number; success: number; failure: number; blocked: number; limit: number; remaining: number }

const STATUS_COLORS: Record<string, string> = {
  sent: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  delivered: "bg-green-500/15 text-green-700 dark:text-green-300",
  read: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-red-500/15 text-red-700 dark:text-red-300",
  blocked: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};
const EVENT_OPTIONS = ["", "subscription_reminder", "trial_expiring", "announcement", "order_confirmed", "order_ready"];

export default function WhatsAppSection() {
  const [tab, setTab] = useState<"settings" | "templates" | "logs" | "usage">("settings");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageCircle className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">WhatsApp</h2>
      </div>
      <p className="text-sm text-muted-foreground">Send order updates, reminders, and announcements via WhatsApp using the platform account or your own Meta WhatsApp Cloud API credentials.</p>
      <div className="border-b border-border flex gap-1">
        {(["settings", "templates", "logs", "usage"] as const).map(k => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px capitalize ${tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {k}
          </button>
        ))}
      </div>
      {tab === "settings" && <SettingsTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "logs" && <LogsTab />}
      {tab === "usage" && <UsageTab />}
    </div>
  );
}

function SettingsTab() {
  const rid = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<SettingsResp>({
    queryKey: ["whatsapp", "settings", rid],
    queryFn: () => apiFetch(`/restaurants/${rid}/whatsapp/settings`),
  });
  const [form, setForm] = useState<Partial<WaSettings>>({});
  const [test, setTest] = useState({ to: "", body: "Hello from our restaurant!" });

  const merged = { ...(data?.settings ?? {}), ...form };
  const usePlatform = merged.usePlatformAccount !== false;
  const set = (k: keyof WaSettings, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => apiAction(`/restaurants/${rid}/whatsapp/settings`, "PUT", form),
    onSuccess: () => { toast({ title: "Saved" }); qc.invalidateQueries({ queryKey: ["whatsapp", "settings", rid] }); setForm({}); },
    onError: e => toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" }),
  });
  const sendTest = useMutation({
    mutationFn: () => apiAction<{ status: string; error?: string }>(`/restaurants/${rid}/whatsapp/test`, "POST", test),
    onSuccess: r => toast({ title: r.status === "sent" ? "Test sent" : `Test ${r.status}`, description: r.error, variant: r.status === "sent" ? undefined : "destructive" }),
    onError: e => toast({ title: "Test failed", description: (e as Error).message, variant: "destructive" }),
  });
  const sync = useMutation({
    mutationFn: () => apiAction<{ synced: number }>(`/restaurants/${rid}/whatsapp/sync-templates`, "POST"),
    onSuccess: r => toast({ title: `Synced ${r.synced} templates` }),
    onError: e => toast({ title: "Sync failed", description: (e as Error).message, variant: "destructive" }),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-6">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">Provider</h3>
            <Badge variant={merged.isEnabled ? "default" : "outline"}>{merged.isEnabled ? "Enabled" : "Disabled"}</Badge>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!merged.isEnabled} onChange={e => set("isEnabled", e.target.checked)} />
            Enable WhatsApp
          </label>
        </div>

        <div className="space-y-2 border border-border rounded-lg p-3 bg-muted/20">
          <p className="text-xs font-medium">Account source</p>
          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input type="radio" checked={usePlatform} onChange={() => set("usePlatformAccount", true)} disabled={!data?.platformAvailable} className="mt-0.5" />
            <span>
              <span className="font-medium">Use platform account</span>
              <span className="block text-xs text-muted-foreground">{data?.platformAvailable ? "KhanaLagao's WhatsApp Business is used. Subject to your plan's monthly limit." : "Platform account not configured by admin yet."}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input type="radio" checked={!usePlatform} onChange={() => set("usePlatformAccount", false)} className="mt-0.5" />
            <span>
              <span className="font-medium">Use my own Meta WhatsApp Cloud API account</span>
              <span className="block text-xs text-muted-foreground">You'll need a Meta Business account, a WABA, a phone number, and a system-user access token.</span>
            </span>
          </label>
        </div>

        {!usePlatform && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Phone Number ID"><Input value={(merged.phoneNumberId as string) ?? ""} onChange={e => set("phoneNumberId", e.target.value)} /></Field>
            <Field label="WABA ID"><Input value={(merged.wabaId as string) ?? ""} onChange={e => set("wabaId", e.target.value)} /></Field>
            <Field label="Access token" hint="Stored encrypted. Existing token is kept if blank/masked."><Input type="password" value={(merged.accessToken as string) ?? ""} onChange={e => set("accessToken", e.target.value)} placeholder="EAA…" /></Field>
            <Field label="Business ID (optional)"><Input value={(merged.businessId as string) ?? ""} onChange={e => set("businessId", e.target.value)} /></Field>
            <Field label="Webhook URL (configure in Meta)"><Input value={data?.webhookUrl ?? ""} readOnly /></Field>
            <Field label="Webhook verify token"><Input value={(merged.webhookVerifyToken as string) ?? ""} onChange={e => set("webhookVerifyToken", e.target.value)} /></Field>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          {!usePlatform && (
            <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending} className="gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${sync.isPending ? "animate-spin" : ""}`} /> Sync templates
            </Button>
          )}
          <Button onClick={() => save.mutate()} disabled={save.isPending || Object.keys(form).length === 0} className="gap-1.5">
            <Save className="w-3.5 h-3.5" /> Save
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2"><Send className="w-4 h-4" /> Send test message</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="To (with country code, no +)"><Input value={test.to} onChange={e => setTest(t => ({ ...t, to: e.target.value }))} placeholder="919876543210" /></Field>
          <Field label="Body"><Input value={test.body} onChange={e => setTest(t => ({ ...t, body: e.target.value }))} /></Field>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{merged.lastTestAt ? `Last test: ${new Date(merged.lastTestAt as string).toLocaleString()} — ${merged.lastTestStatus}` : "No tests yet."}</span>
          <Button size="sm" onClick={() => sendTest.mutate()} disabled={!test.to || sendTest.isPending} className="gap-1.5"><Send className="w-3.5 h-3.5" /> Send test</Button>
        </div>
      </div>
    </div>
  );
}

function TemplatesTab() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ data: Template[]; source: string }>({
    queryKey: ["whatsapp", "templates", rid],
    queryFn: () => apiFetch(`/restaurants/${rid}/whatsapp/templates`),
  });
  const setEvent = useMutation({
    mutationFn: ({ id, event }: { id: number; event: string | null }) =>
      apiAction(`/restaurants/${rid}/whatsapp/templates/${id}/event`, "PUT", { event }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp", "templates", rid] }),
    onError: e => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-6">Loading…</div>;
  const rows = data?.data ?? [];
  const fromPlatform = data?.source === "platform";

  return (
    <div className="space-y-3">
      {fromPlatform && (
        <div className="bg-muted/30 border border-border rounded-xl p-3 text-xs text-muted-foreground">
          You're using the platform WhatsApp account, so you see platform-managed templates. Switch to your own account in Settings to manage your own.
        </div>
      )}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b border-border">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Name</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Lang</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Default for event</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(t => (
              <tr key={t.id} className="hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">{t.name}<p className="text-[11px] text-muted-foreground line-clamp-1">{t.bodyPreview}</p></td>
                <td className="px-3 py-2 text-xs">{t.language}</td>
                <td className="px-3 py-2"><Badge variant={t.status === "approved" ? "default" : "outline"} className="text-[10px]">{t.status}</Badge></td>
                <td className="px-3 py-2">
                  {fromPlatform ? <span className="text-xs text-muted-foreground">{t.defaultForEvent ?? "—"}</span> :
                    <select className="text-xs border border-border rounded px-2 py-1 bg-background"
                      value={t.defaultForEvent ?? ""}
                      onChange={e => setEvent.mutate({ id: t.id, event: e.target.value || null })}>
                      {EVENT_OPTIONS.map(o => <option key={o} value={o}>{o || "— none —"}</option>)}
                    </select>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-12 text-center text-muted-foreground text-sm">No templates yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LogsTab() {
  const rid = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ status: "", template: "", from: "", to: "" });
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  const { data, isLoading } = useQuery<{ data: LogRow[] }>({
    queryKey: ["whatsapp", "logs", rid, filters],
    queryFn: () => apiFetch(`/restaurants/${rid}/whatsapp/logs?${params.toString()}`),
  });
  const retry = useMutation({
    mutationFn: (id: number) => apiAction(`/restaurants/${rid}/whatsapp/logs/${id}/retry`, "POST"),
    onSuccess: () => { toast({ title: "Retried" }); qc.invalidateQueries({ queryKey: ["whatsapp", "logs", rid] }); },
    onError: e => toast({ title: "Retry failed", description: (e as Error).message, variant: "destructive" }),
  });
  const retryAll = useMutation({
    mutationFn: () => apiAction<{ retried: number; succeeded: number }>(`/restaurants/${rid}/whatsapp/logs/retry-failed`, "POST"),
    onSuccess: r => { toast({ title: `Retried ${r.retried}`, description: `${r.succeeded} succeeded` }); qc.invalidateQueries({ queryKey: ["whatsapp", "logs", rid] }); },
  });

  return (
    <div className="space-y-3">
      <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap gap-2 items-end">
        <div className="space-y-0.5">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</label>
          <select className="text-xs border border-border rounded px-2 py-1 bg-background h-8" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
            <option value="">All</option>
            {["sent", "delivered", "read", "failed", "blocked", "queued", "failed_or_blocked"].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="space-y-0.5"><label className="text-[10px] uppercase tracking-wider text-muted-foreground">Template</label><Input className="h-8 w-40" value={filters.template} onChange={e => setFilters(f => ({ ...f, template: e.target.value }))} /></div>
        <div className="space-y-0.5"><label className="text-[10px] uppercase tracking-wider text-muted-foreground">From</label><Input type="date" className="h-8" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} /></div>
        <div className="space-y-0.5"><label className="text-[10px] uppercase tracking-wider text-muted-foreground">To</label><Input type="date" className="h-8" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} /></div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => window.open(getApiUrl(`/restaurants/${rid}/whatsapp/logs?${params.toString()}&export=csv`), "_blank")} className="gap-1.5"><Download className="w-3.5 h-3.5" />CSV</Button>
        <Button size="sm" variant="outline" onClick={() => retryAll.mutate()} disabled={retryAll.isPending} className="gap-1.5"><Repeat className="w-3.5 h-3.5" />Retry failed</Button>
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b border-border">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">When</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Recipient</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Template</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Reason</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground text-sm">Loading…</td></tr> :
              (data?.data ?? []).map(row => (
                <tr key={row.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs">{row.recipient}</td>
                  <td className="px-3 py-2 text-xs">{row.templateName ?? <span className="text-muted-foreground">text</span>}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_COLORS[row.status] ?? ""}`}>{row.status}</span></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground line-clamp-1 max-w-xs">{row.reason ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {(row.status === "failed" || (row.status === "blocked" && row.reason !== "quota")) &&
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => retry.mutate(row.id)} disabled={retry.isPending}>Retry</Button>}
                  </td>
                </tr>
              ))}
            {!isLoading && (data?.data ?? []).length === 0 && <tr><td colSpan={6} className="px-3 py-12 text-center text-muted-foreground text-sm">No messages.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsageTab() {
  const rid = useRestaurantId();
  const { data, isLoading } = useQuery<UsageResp>({
    queryKey: ["whatsapp", "usage", rid],
    queryFn: () => apiFetch(`/restaurants/${rid}/whatsapp/usage`),
  });
  if (isLoading) return <div className="text-sm text-muted-foreground p-6">Loading…</div>;
  const u = data!;
  const pct = u.limit > 0 ? Math.min(100, Math.round((u.sent / u.limit) * 100)) : 0;
  const color = pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="font-semibold text-sm">This month</h3>
          <span className="text-xs text-muted-foreground">{u.sent} of {u.limit > 0 ? u.limit : "unlimited"}</span>
        </div>
        {u.limit > 0 && (
          <div className="bg-muted rounded-full h-2 overflow-hidden">
            <div className={`h-2 ${color}`} style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
          <Stat label="Sent" value={u.sent} />
          <Stat label="Successful" value={u.success} tone="green" />
          <Stat label="Failed" value={u.failure} tone="red" />
          <Stat label="Blocked" value={u.blocked} tone="amber" />
        </div>
      </div>
      {u.limit > 0 && u.sent >= u.limit && (
        <div className="bg-destructive/10 border border-destructive/40 text-destructive rounded-xl p-4 text-sm">
          You've hit this month's WhatsApp limit. New messages will be blocked until next month, or contact your account manager to increase the limit.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "green" | "red" | "amber" }) {
  const color = tone === "green" ? "text-green-700 dark:text-green-300" : tone === "red" ? "text-red-700 dark:text-red-300" : tone === "amber" ? "text-amber-700 dark:text-amber-300" : "text-foreground";
  return (
    <div className="bg-muted/30 border border-border rounded-lg p-3">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
