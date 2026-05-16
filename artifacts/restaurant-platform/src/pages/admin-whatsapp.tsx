import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, RefreshCw, Send, Download, Repeat, Save, Webhook, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiAction, getApiUrl } from "@/lib/api";

interface WaSettings {
  id: number;
  scope: string;
  isEnabled: boolean;
  usePlatformAccount: boolean;
  provider: string;
  accessToken: string;
  phoneNumberId: string | null;
  wabaId: string | null;
  businessId: string | null;
  webhookVerifyToken: string;
  webhookUrl: string;
  lastTestAt: string | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
}
interface SettingsResp { settings: WaSettings | null; webhookUrl: string }
interface Template { id: number; name: string; language: string; status: string; category: string | null; bodyPreview: string | null; defaultForEvent: string | null; syncedAt: string }
interface LogRow { id: number; restaurantId: number | null; recipient: string; templateName: string | null; status: string; providerMessageId: string | null; reason: string | null; cost: string | null; createdAt: string }
interface UsageRow { restaurantId: number; restaurantName: string; tenantName: string | null; planLimit: number; override: number | null; effectiveLimit: number; sent: number; success: number; failure: number; blocked: number }

const EVENT_OPTIONS = ["", "subscription_reminder", "trial_expiring", "announcement", "order_confirmed", "order_ready"];
const STATUS_COLORS: Record<string, string> = {
  sent: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  delivered: "bg-green-500/15 text-green-700 dark:text-green-300",
  read: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-red-500/15 text-red-700 dark:text-red-300",
  blocked: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  queued: "bg-muted text-muted-foreground",
};

export default function AdminWhatsAppTab() {
  const [tab, setTab] = useState<"settings" | "templates" | "logs" | "usage">("settings");
  return (
    <div className="space-y-4">
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
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<SettingsResp>({
    queryKey: ["admin", "whatsapp", "settings"],
    queryFn: () => apiFetch("/admin/whatsapp/settings"),
  });
  const [form, setForm] = useState<Partial<WaSettings>>({});
  const [test, setTest] = useState({ to: "", body: "Test message from KhanaLagao admin." });

  const merged = { ...(data?.settings ?? {}), ...form };
  const set = (k: keyof WaSettings, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => apiAction<SettingsResp>("/admin/whatsapp/settings", "PUT", form),
    onSuccess: () => { toast({ title: "Saved" }); qc.invalidateQueries({ queryKey: ["admin", "whatsapp", "settings"] }); setForm({}); },
    onError: e => toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" }),
  });

  const sendTest = useMutation({
    mutationFn: () => apiAction<{ status: string; error?: string }>("/admin/whatsapp/test", "POST", test),
    onSuccess: r => toast({
      title: r.status === "sent" ? "Test sent" : `Test ${r.status}`,
      description: r.error,
      variant: r.status === "sent" ? undefined : "destructive",
    }),
    onError: e => toast({ title: "Test failed", description: (e as Error).message, variant: "destructive" }),
  });

  const sync = useMutation({
    mutationFn: () => apiAction<{ synced: number }>("/admin/whatsapp/sync-templates", "POST"),
    onSuccess: r => toast({ title: `Synced ${r.synced} templates` }),
    onError: e => toast({ title: "Sync failed", description: (e as Error).message, variant: "destructive" }),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-6">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">Platform WhatsApp credentials</h3>
            <Badge variant={merged.isEnabled ? "default" : "outline"}>{merged.isEnabled ? "Enabled" : "Disabled"}</Badge>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!merged.isEnabled} onChange={e => set("isEnabled", e.target.checked)} />
            Enabled
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Phone Number ID">
            <Input value={(merged.phoneNumberId as string) ?? ""} onChange={e => set("phoneNumberId", e.target.value)} placeholder="e.g. 123456789012345" />
          </Field>
          <Field label="WhatsApp Business Account ID (WABA)">
            <Input value={(merged.wabaId as string) ?? ""} onChange={e => set("wabaId", e.target.value)} placeholder="e.g. 987654321098765" />
          </Field>
          <Field label="Access token (Meta system user token)" hint="Stored encrypted at rest. Existing token kept if you don't change it.">
            <Input type="password" value={(merged.accessToken as string) ?? ""} onChange={e => set("accessToken", e.target.value)} placeholder="EAA…" />
          </Field>
          <Field label="Business ID (optional)">
            <Input value={(merged.businessId as string) ?? ""} onChange={e => set("businessId", e.target.value)} />
          </Field>
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <p className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-2"><Webhook className="w-3.5 h-3.5" /> Webhook</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Webhook URL (configure this in Meta)">
              <Input value={data?.webhookUrl ?? ""} readOnly />
            </Field>
            <Field label="Verify token" hint="Any random string; used by Meta during webhook setup.">
              <Input value={(merged.webhookVerifyToken as string) ?? ""} onChange={e => set("webhookVerifyToken", e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending} className="gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${sync.isPending ? "animate-spin" : ""}`} /> Sync templates
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || Object.keys(form).length === 0} className="gap-1.5">
            <Save className="w-3.5 h-3.5" /> Save
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm">Send test message</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="To (with country code, no +)"><Input value={test.to} onChange={e => setTest(t => ({ ...t, to: e.target.value }))} placeholder="919876543210" /></Field>
          <Field label="Body (free-text — only works in 24h session)"><Input value={test.body} onChange={e => setTest(t => ({ ...t, body: e.target.value }))} /></Field>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{merged.lastTestAt ? `Last test: ${new Date(merged.lastTestAt as string).toLocaleString()} — ${merged.lastTestStatus}${merged.lastTestError ? ` (${merged.lastTestError})` : ""}` : "No tests yet."}</span>
          <Button size="sm" disabled={!test.to || sendTest.isPending} onClick={() => sendTest.mutate()} className="gap-1.5">
            <Send className="w-3.5 h-3.5" /> Send test
          </Button>
        </div>
      </div>

      <div className="bg-muted/30 border border-border rounded-xl p-4 text-xs text-muted-foreground flex items-start gap-2">
        <KeyRound className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p>
          Configure your Meta WhatsApp Cloud API credentials above. Tenants without their own credentials will use this platform account, subject to per-restaurant monthly limits set on each plan.
        </p>
      </div>
    </div>
  );
}

function TemplatesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ data: Template[] }>({
    queryKey: ["admin", "whatsapp", "templates"],
    queryFn: () => apiFetch("/admin/whatsapp/templates?scope=platform"),
  });
  const setEvent = useMutation({
    mutationFn: ({ id, event }: { id: number; event: string | null }) =>
      apiAction(`/admin/whatsapp/templates/${id}/default-event`, "PUT", { event }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "whatsapp", "templates"] }); toast({ title: "Updated" }); },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-6">Loading…</div>;
  const rows = data?.data ?? [];

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 border-b border-border">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Name</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Language</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Category</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Default for event</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(t => (
            <tr key={t.id} className="hover:bg-muted/20">
              <td className="px-4 py-2 font-medium">{t.name}<p className="text-[11px] text-muted-foreground line-clamp-1">{t.bodyPreview}</p></td>
              <td className="px-4 py-2 text-xs">{t.language}</td>
              <td className="px-4 py-2 text-xs">{t.category ?? "—"}</td>
              <td className="px-4 py-2"><Badge variant={t.status === "approved" ? "default" : "outline"} className="text-[10px]">{t.status}</Badge></td>
              <td className="px-4 py-2">
                <select className="text-xs border border-border rounded px-2 py-1 bg-background"
                  value={t.defaultForEvent ?? ""}
                  onChange={e => setEvent.mutate({ id: t.id, event: e.target.value || null })}>
                  {EVENT_OPTIONS.map(o => <option key={o} value={o}>{o || "— none —"}</option>)}
                </select>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground text-sm">No templates yet. Click "Sync templates" in Settings.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function LogsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ status: "", restaurantId: "", template: "", from: "", to: "" });
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  const { data, isLoading } = useQuery<{ data: LogRow[] }>({
    queryKey: ["admin", "whatsapp", "logs", filters],
    queryFn: () => apiFetch(`/admin/whatsapp/logs?${params.toString()}`),
  });
  const retry = useMutation({
    mutationFn: (id: number) => apiAction(`/admin/whatsapp/logs/${id}/retry`, "POST"),
    onSuccess: () => { toast({ title: "Retried" }); qc.invalidateQueries({ queryKey: ["admin", "whatsapp", "logs"] }); },
    onError: e => toast({ title: "Retry failed", description: (e as Error).message, variant: "destructive" }),
  });
  const retryAll = useMutation({
    mutationFn: () => apiAction<{ retried: number; succeeded: number }>("/admin/whatsapp/logs/retry-failed", "POST"),
    onSuccess: r => { toast({ title: `Retried ${r.retried}`, description: `${r.succeeded} succeeded` }); qc.invalidateQueries({ queryKey: ["admin", "whatsapp", "logs"] }); },
  });

  const exportCsv = () => {
    const url = getApiUrl(`/admin/whatsapp/logs?${params.toString()}&export=csv`);
    window.open(url, "_blank");
  };

  return (
    <div className="space-y-3">
      <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap gap-2 items-end">
        <Field small label="Status">
          <select className="text-xs border border-border rounded px-2 py-1 bg-background h-8" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
            <option value="">All</option>
            {["sent", "delivered", "read", "failed", "blocked", "queued", "failed_or_blocked"].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field small label="Restaurant ID"><Input className="h-8 w-28" value={filters.restaurantId} onChange={e => setFilters(f => ({ ...f, restaurantId: e.target.value }))} /></Field>
        <Field small label="Template"><Input className="h-8 w-40" value={filters.template} onChange={e => setFilters(f => ({ ...f, template: e.target.value }))} /></Field>
        <Field small label="From"><Input type="date" className="h-8" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} /></Field>
        <Field small label="To"><Input type="date" className="h-8" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} /></Field>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={exportCsv} className="gap-1.5"><Download className="w-3.5 h-3.5" />CSV</Button>
        <Button size="sm" variant="outline" onClick={() => retryAll.mutate()} disabled={retryAll.isPending} className="gap-1.5"><Repeat className="w-3.5 h-3.5" />Retry all failed</Button>
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
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ period: { year: number; month: number }; data: UsageRow[] }>({
    queryKey: ["admin", "whatsapp", "usage"],
    queryFn: () => apiFetch("/admin/whatsapp/usage"),
  });
  const updateLimit = useMutation({
    mutationFn: ({ id, override }: { id: number; override: number | null }) =>
      apiAction(`/admin/restaurants/${id}/whatsapp-limit`, "PUT", { override }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "whatsapp", "usage"] }); toast({ title: "Updated" }); },
    onError: e => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-6">Loading…</div>;
  const period = data?.period;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Period: {period ? `${period.year}-${String(period.month).padStart(2, "0")}` : "—"}</p>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b border-border">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Restaurant</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Tenant</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Sent</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Failed</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Blocked</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Plan limit</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Override</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(data?.data ?? []).map(r => (
              <tr key={r.restaurantId} className="hover:bg-muted/20">
                <td className="px-3 py-2 text-sm">{r.restaurantName}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.tenantName ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.sent} / {r.effectiveLimit || "∞"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-red-700 dark:text-red-300">{r.failure}</td>
                <td className="px-3 py-2 text-right tabular-nums text-amber-700 dark:text-amber-300">{r.blocked}</td>
                <td className="px-3 py-2 text-xs">{r.planLimit ?? 0}</td>
                <td className="px-3 py-2">
                  <input type="number" min="0" defaultValue={r.override ?? ""} placeholder="—"
                    className="text-xs border border-border rounded px-2 py-1 bg-background w-24"
                    onBlur={e => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      if (v !== r.override) updateLimit.mutate({ id: r.restaurantId, override: v });
                    }} />
                </td>
              </tr>
            ))}
            {(data?.data ?? []).length === 0 && <tr><td colSpan={7} className="px-3 py-12 text-center text-muted-foreground text-sm">No restaurants.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, hint, children, small }: { label: string; hint?: string; children: React.ReactNode; small?: boolean }) {
  return (
    <div className={small ? "space-y-0.5" : "space-y-1.5"}>
      <label className={small ? "text-[10px] uppercase tracking-wider text-muted-foreground" : "text-xs font-medium text-foreground"}>{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
