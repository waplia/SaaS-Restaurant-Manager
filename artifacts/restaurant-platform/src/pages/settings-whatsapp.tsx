import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Save, Send, RefreshCw, Download, Repeat, QrCode, Power, AlertTriangle, ShieldCheck } from "lucide-react";
import QRCode from "qrcode";
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
type ProviderType = "cloud_api" | "web_qr" | "disabled";
interface ProviderSettingsResp {
  providerType: ProviderType;
  webQrAllowed: boolean;
  webQrAllowedReason: string | null;
  webQrLibraryAvailable: boolean;
  replitDevWarning: string | null;
}
interface SessionView {
  status: "disconnected" | "starting" | "qr_pending" | "connected" | "reconnecting" | "logged_out" | "error" | "library_unavailable";
  phone: string | null;
  profileName: string | null;
  qrPayload: string | null;
  qrExpiresAt: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
}
interface WebQrStatusResp {
  session: SessionView | null;
  allowed: boolean;
  reason: string | null;
  libraryAvailable: boolean;
  replitDevWarning: string | null;
}
interface SafeSendResp {
  safeSendDailyCap: number;
  safeSendHourlyCap: number;
  safeSendMinDelaySec: number;
  safeSendQuietStart: string | null;
  safeSendQuietEnd: string | null;
  safeSendDuplicateWindowSec: number;
  marketingAllowed: boolean;
  marketingOptInRequired: boolean;
}

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
  const { data: provider } = useQuery<{ providerType: ProviderType }>({
    queryKey: ["whatsapp", "provider-settings", rid],
    queryFn: () => apiFetch(`/restaurants/${rid}/whatsapp/provider-settings`),
  });
  const isWebQrProvider = provider?.providerType === "web_qr";
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
      <ProviderSelectorCard />
      <WebQrConnectionCard />
      <SafeSendingCard />

      {!isWebQrProvider && (
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">Cloud API account</h3>
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
      )}

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

function ProviderSelectorCard() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<ProviderSettingsResp>({
    queryKey: ["whatsapp", "provider-settings", rid],
    queryFn: () => apiFetch(`/restaurants/${rid}/whatsapp/provider-settings`),
  });
  const change = useMutation({
    mutationFn: (providerType: ProviderType) =>
      apiAction(`/restaurants/${rid}/whatsapp/provider-settings`, "PATCH", { providerType }),
    onSuccess: () => {
      toast({ title: "Provider updated" });
      qc.invalidateQueries({ queryKey: ["whatsapp", "provider-settings", rid] });
      qc.invalidateQueries({ queryKey: ["whatsapp", "web-qr", "status", rid] });
    },
    onError: e => toast({ title: "Update failed", description: (e as Error).message, variant: "destructive" }),
  });

  if (isLoading || !data) return null;
  const current = data.providerType;
  const opts: { value: ProviderType; label: string; desc: string; disabled?: string }[] = [
    { value: "cloud_api", label: "Meta Cloud API (recommended)", desc: "Official, stable, requires a Meta WABA. Use for production." },
    {
      value: "web_qr",
      label: "WhatsApp Web QR (Baileys, experimental)",
      desc: "Pair via QR code — uses your own WhatsApp number. Not officially supported by Meta; account risk applies.",
      disabled: !data.webQrAllowed
        ? data.webQrAllowedReason ?? "Web QR is not enabled for your plan."
        : !data.webQrLibraryAvailable
          ? "Baileys is not installed on the server."
          : undefined,
    },
    { value: "disabled", label: "Disabled", desc: "Do not send any WhatsApp messages." },
  ];
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-sm">Provider</h3>
        <Badge variant="outline" className="text-[10px]">{current === "cloud_api" ? "Cloud API" : current === "web_qr" ? "Web QR" : "Disabled"}</Badge>
      </div>
      {data.replitDevWarning && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/40 text-amber-800 dark:text-amber-200 rounded-lg p-3 text-xs">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{data.replitDevWarning}</span>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {opts.map(o => (
          <button
            key={o.value}
            type="button"
            disabled={!!o.disabled || change.isPending}
            onClick={() => change.mutate(o.value)}
            className={`text-left rounded-lg border p-3 transition ${current === o.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"} ${o.disabled ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            <p className="text-sm font-medium">{o.label}</p>
            <p className="text-xs text-muted-foreground mt-1">{o.desc}</p>
            {o.disabled && <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">{o.disabled}</p>}
          </button>
        ))}
      </div>
    </div>
  );
}

function WebQrConnectionCard() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: provider } = useQuery<ProviderSettingsResp>({
    queryKey: ["whatsapp", "provider-settings", rid],
    queryFn: () => apiFetch(`/restaurants/${rid}/whatsapp/provider-settings`),
  });
  const isWebQr = provider?.providerType === "web_qr";
  const { data } = useQuery<WebQrStatusResp>({
    queryKey: ["whatsapp", "web-qr", "status", rid],
    queryFn: () => apiFetch(`/restaurants/${rid}/whatsapp/web-qr/status`),
    enabled: isWebQr,
    refetchInterval: () => (isWebQr ? 3000 : false),
  });
  const start = useMutation({
    mutationFn: () => apiAction(`/restaurants/${rid}/whatsapp/web-qr/start`, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp", "web-qr", "status", rid] }),
    onError: e => toast({ title: "Start failed", description: (e as Error).message, variant: "destructive" }),
  });
  const reconnect = useMutation({
    mutationFn: () => apiAction(`/restaurants/${rid}/whatsapp/web-qr/reconnect`, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp", "web-qr", "status", rid] }),
    onError: e => toast({ title: "Reconnect failed", description: (e as Error).message, variant: "destructive" }),
  });
  const disconnect = useMutation({
    mutationFn: () => apiAction(`/restaurants/${rid}/whatsapp/web-qr/disconnect`, "POST"),
    onSuccess: () => { toast({ title: "Disconnected" }); qc.invalidateQueries({ queryKey: ["whatsapp", "web-qr", "status", rid] }); },
    onError: e => toast({ title: "Disconnect failed", description: (e as Error).message, variant: "destructive" }),
  });

  const [qrImg, setQrImg] = useState<string | null>(null);
  useEffect(() => {
    const payload = data?.session?.qrPayload;
    if (!payload) { setQrImg(null); return; }
    QRCode.toDataURL(payload, { width: 240, margin: 1 })
      .then(setQrImg)
      .catch(() => setQrImg(null));
  }, [data?.session?.qrPayload]);

  if (!isWebQr) return null;

  const session = data?.session;
  const status = session?.status ?? "disconnected";
  const statusColor: Record<string, string> = {
    connected: "bg-green-500/15 text-green-700 dark:text-green-300",
    starting: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    qr_pending: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    reconnecting: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    disconnected: "bg-muted text-foreground",
    logged_out: "bg-red-500/15 text-red-700 dark:text-red-300",
    error: "bg-red-500/15 text-red-700 dark:text-red-300",
    library_unavailable: "bg-red-500/15 text-red-700 dark:text-red-300",
  };
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <QrCode className="w-4 h-4" />
          <h3 className="font-semibold text-sm">WhatsApp Web connection</h3>
          <span className={`text-[10px] px-2 py-0.5 rounded ${statusColor[status] ?? ""}`}>{status.replace(/_/g, " ")}</span>
        </div>
        <div className="flex gap-2">
          {status !== "connected" && (
            <Button size="sm" onClick={() => start.mutate()} disabled={start.isPending || !data?.libraryAvailable} className="gap-1.5">
              <QrCode className="w-3.5 h-3.5" /> {status === "qr_pending" ? "Refresh QR" : "Generate QR"}
            </Button>
          )}
          {status === "connected" && (
            <Button size="sm" variant="outline" onClick={() => reconnect.mutate()} disabled={reconnect.isPending} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Reconnect
            </Button>
          )}
          {(status === "connected" || status === "qr_pending" || status === "starting" || status === "reconnecting") && (
            <Button size="sm" variant="outline" onClick={() => disconnect.mutate()} disabled={disconnect.isPending} className="gap-1.5">
              <Power className="w-3.5 h-3.5" /> Disconnect
            </Button>
          )}
        </div>
      </div>

      {!data?.libraryAvailable && (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/40 text-red-800 dark:text-red-200 rounded-lg p-3 text-xs">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>WhatsApp Web library (Baileys) is not installed on the server. Ask your administrator to install <code>@whiskeysockets/baileys</code> and restart the API to enable Web QR.</span>
        </div>
      )}
      {data?.replitDevWarning && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/40 text-amber-800 dark:text-amber-200 rounded-lg p-3 text-xs">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{data.replitDevWarning}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4 items-start">
        <div className="bg-white border border-border rounded-lg p-3 flex items-center justify-center min-h-[240px]">
          {status === "qr_pending" && qrImg
            ? <img src={qrImg} alt="WhatsApp QR" width={240} height={240} />
            : status === "connected"
              ? <div className="text-center"><ShieldCheck className="w-12 h-12 text-green-600 mx-auto" /><p className="text-xs mt-2 text-muted-foreground">Linked to {session?.phone ?? "—"}</p></div>
              : <p className="text-xs text-muted-foreground text-center">{status === "starting" ? "Generating QR…" : "Click Generate QR to begin pairing."}</p>}
        </div>
        <div className="text-xs space-y-2">
          <p><span className="text-muted-foreground">How to pair:</span> Open WhatsApp on your phone → Settings → Linked Devices → Link a Device → scan this QR.</p>
          {session?.phone && <p><span className="text-muted-foreground">Phone:</span> {session.phone}</p>}
          {session?.profileName && <p><span className="text-muted-foreground">Profile:</span> {session.profileName}</p>}
          {session?.lastConnectedAt && <p><span className="text-muted-foreground">Last connected:</span> {new Date(session.lastConnectedAt).toLocaleString()}</p>}
          {session?.lastDisconnectedAt && status !== "connected" && <p><span className="text-muted-foreground">Last disconnected:</span> {new Date(session.lastDisconnectedAt).toLocaleString()}</p>}
          {session?.lastError && <p className="text-red-700 dark:text-red-300">Error: {session.lastError}</p>}
          {data?.reason && !data.allowed && <p className="text-amber-700 dark:text-amber-300">{data.reason}</p>}
        </div>
      </div>
    </div>
  );
}

function SafeSendingCard() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<SafeSendResp>({
    queryKey: ["whatsapp", "safe-send", rid],
    queryFn: () => apiFetch(`/restaurants/${rid}/whatsapp/safe-send`),
  });
  const [form, setForm] = useState<Partial<SafeSendResp>>({});
  const merged: SafeSendResp = { ...(data as SafeSendResp ?? {} as SafeSendResp), ...form };
  const set = <K extends keyof SafeSendResp>(k: K, v: SafeSendResp[K]) => setForm(p => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => apiAction(`/restaurants/${rid}/whatsapp/safe-send`, "PATCH", form),
    onSuccess: () => { toast({ title: "Safe-sending updated" }); setForm({}); qc.invalidateQueries({ queryKey: ["whatsapp", "safe-send", rid] }); },
    onError: e => toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" }),
  });

  if (isLoading || !data) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">Safe-sending guards</h3>
      </div>
      <p className="text-xs text-muted-foreground">Caps and quiet hours protect your number from spam-style behaviour. Apply to both providers. 0 means unlimited.</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Field label="Daily cap (msgs)"><Input type="number" min={0} value={merged.safeSendDailyCap ?? 0} onChange={e => set("safeSendDailyCap", Math.max(0, Number(e.target.value)))} /></Field>
        <Field label="Hourly cap (msgs)"><Input type="number" min={0} value={merged.safeSendHourlyCap ?? 0} onChange={e => set("safeSendHourlyCap", Math.max(0, Number(e.target.value)))} /></Field>
        <Field label="Min delay between sends (sec)"><Input type="number" min={0} value={merged.safeSendMinDelaySec ?? 0} onChange={e => set("safeSendMinDelaySec", Math.max(0, Number(e.target.value)))} /></Field>
        <Field label="Quiet hours start (HH:MM)"><Input placeholder="22:00" value={merged.safeSendQuietStart ?? ""} onChange={e => set("safeSendQuietStart", e.target.value || null)} /></Field>
        <Field label="Quiet hours end (HH:MM)"><Input placeholder="08:00" value={merged.safeSendQuietEnd ?? ""} onChange={e => set("safeSendQuietEnd", e.target.value || null)} /></Field>
        <Field label="Duplicate-suppress window (sec)" hint="Block re-sending the same body to the same number within this window."><Input type="number" min={0} value={merged.safeSendDuplicateWindowSec ?? 0} onChange={e => set("safeSendDuplicateWindowSec", Math.max(0, Number(e.target.value)))} /></Field>
      </div>
      <div className="flex flex-wrap gap-4 pt-1">
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={merged.marketingAllowed ?? true} onChange={e => set("marketingAllowed", e.target.checked)} /> Allow marketing/broadcast messages</label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={merged.marketingOptInRequired ?? true} onChange={e => set("marketingOptInRequired", e.target.checked)} /> Require explicit customer opt-in for marketing</label>
      </div>
      <div className="flex justify-end pt-2">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || Object.keys(form).length === 0} className="gap-1.5"><Save className="w-3.5 h-3.5" /> Save</Button>
      </div>
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
