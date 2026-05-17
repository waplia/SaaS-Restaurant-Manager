import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiAction } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, MessageSquare, Plus, RefreshCcw, Send, Trash2, FileText, Activity, BarChart3, Settings as SettingsIcon } from "lucide-react";
import { toast } from "sonner";

const PROVIDER_TYPES = [
  { value: "twilio", label: "Twilio" },
  { value: "msg91", label: "MSG91 (India / DLT)" },
  { value: "textlocal", label: "Textlocal" },
  { value: "fast2sms", label: "Fast2SMS" },
  { value: "gupshup", label: "Gupshup Enterprise" },
  { value: "custom", label: "Custom HTTP" },
] as const;

const EVENT_KEYS = [
  "welcome", "otp", "trial_ending", "subscription_activated",
  "subscription_expired", "payment_reminder", "payment_received",
  "restaurant_suspended", "demo_booked",
] as const;

type SubTab = "providers" | "templates" | "logs" | "failed" | "usage";

type SmsProvider = {
  id: number; type: string; name: string;
  isEnabled: boolean; isDefault: boolean;
  config: Record<string, string>;
  createdAt: string;
};
type SmsTemplate = {
  id: number; eventKey: string; name: string; body: string;
  variables: string[]; dltTemplateId: string | null;
  category: string; isActive: boolean;
};
type SmsLog = {
  id: number; tenantId: number | null; restaurantId: number | null;
  recipient: string; eventKey: string | null; providerType: string | null;
  body: string; status: string; providerMessageId: string | null;
  cost: string | null; costCurrency: string | null; error: string | null;
  retryOf: number | null; createdAt: string;
};
type UsageRow = {
  tenantId: number; name: string; planName: string | null;
  limit: number; used: number; failed: number; blocked: number;
  remaining: number | null;
};

export default function AdminSmsTab() {
  const [sub, setSub] = useState<SubTab>("providers");
  const tabs: { id: SubTab; label: string; icon: typeof MessageSquare }[] = [
    { id: "providers", label: "Providers", icon: SettingsIcon },
    { id: "templates", label: "Templates", icon: FileText },
    { id: "logs", label: "Logs", icon: Activity },
    { id: "failed", label: "Failed", icon: RefreshCcw },
    { id: "usage", label: "Usage & Limits", icon: BarChart3 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <MessageSquare className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">SMS Settings</h2>
      </div>
      <div className="flex flex-wrap gap-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)}
            className={`px-3 py-1.5 text-sm rounded-md flex items-center gap-2 ${
              sub === t.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>
      {sub === "providers" && <ProvidersPanel />}
      {sub === "templates" && <TemplatesPanel />}
      {sub === "logs" && <LogsPanel statusFilter="" />}
      {sub === "failed" && <LogsPanel statusFilter="failed" />}
      {sub === "usage" && <UsagePanel />}
    </div>
  );
}

// ─────────── Providers ───────────
function ProvidersPanel() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<SmsProvider | null>(null);
  const [creating, setCreating] = useState(false);
  const [testFor, setTestFor] = useState<SmsProvider | null>(null);
  const { data: providers, isLoading } = useQuery<SmsProvider[]>({
    queryKey: ["admin", "sms", "providers"],
    queryFn: () => apiFetch("/admin/sms/providers"),
  });

  const removeMut = useMutation({
    mutationFn: (id: number) => apiAction(`/admin/sms/providers/${id}`, "DELETE"),
    onSuccess: () => { toast.success("Provider deleted"); qc.invalidateQueries({ queryKey: ["admin", "sms", "providers"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)} className="gap-2"><Plus className="w-4 h-4" />Add provider</Button>
      </div>
      {isLoading ? <Loader2 className="animate-spin w-5 h-5 mx-auto" /> : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground"><tr>
              <th className="text-left p-3">Name</th><th className="text-left p-3">Type</th>
              <th className="text-left p-3">Enabled</th><th className="text-left p-3">Default</th>
              <th className="text-right p-3">Actions</th>
            </tr></thead>
            <tbody>
              {providers?.length === 0 && <tr><td colSpan={5} className="text-center p-6 text-muted-foreground">No providers configured yet.</td></tr>}
              {providers?.map(p => (
                <tr key={p.id} className="border-t border-border">
                  <td className="p-3 font-medium">{p.name}</td>
                  <td className="p-3 text-muted-foreground">{p.type}</td>
                  <td className="p-3">{p.isEnabled ? "✓" : "—"}</td>
                  <td className="p-3">{p.isDefault ? "★" : "—"}</td>
                  <td className="p-3 text-right space-x-1">
                    <Button size="sm" variant="outline" onClick={() => setTestFor(p)}><Send className="w-3.5 h-3.5" /></Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(p)}>Edit</Button>
                    <Button size="sm" variant="outline" onClick={() => { if (confirm(`Delete provider "${p.name}"?`)) removeMut.mutate(p.id); }}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(creating || editing) && (
        <ProviderDialog provider={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      )}
      {testFor && <ProviderTestDialog provider={testFor} onClose={() => setTestFor(null)} />}
    </div>
  );
}

function ProviderDialog({ provider, onClose }: { provider: SmsProvider | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(provider?.name ?? "");
  const [type, setType] = useState<string>(provider?.type ?? "twilio");
  const [isEnabled, setIsEnabled] = useState(provider?.isEnabled ?? true);
  const [isDefault, setIsDefault] = useState(provider?.isDefault ?? false);
  const [configJson, setConfigJson] = useState(JSON.stringify(provider?.config ?? {}, null, 2));

  const saveMut = useMutation({
    mutationFn: async () => {
      let config: Record<string, unknown>;
      try { config = JSON.parse(configJson || "{}"); }
      catch { throw new Error("Config must be valid JSON"); }
      const body = { name, type, isEnabled, isDefault, config };
      return provider
        ? apiAction(`/admin/sms/providers/${provider.id}`, "PATCH", body)
        : apiAction("/admin/sms/providers", "POST", body);
    },
    onSuccess: () => { toast.success("Provider saved"); qc.invalidateQueries({ queryKey: ["admin", "sms", "providers"] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const placeholder: Record<string, string> = {
    twilio: '{ "accountSid": "AC...", "authToken": "...", "senderId": "+1XXXXXXXXXX" }',
    msg91: '{ "authKey": "...", "senderId": "KHANAL", "route": "4", "countryCode": "91" }',
    textlocal: '{ "apiKey": "...", "senderId": "TXTLCL" }',
    fast2sms: '{ "apiKey": "...", "route": "q", "senderId": "TXTLCL" }',
    gupshup: '{ "apiKey": "...", "senderId": "...", "userId": "..." }',
    custom: '{ "baseUrl": "https://gateway.example.com/send", "method": "POST", "headers": { "Authorization": "Bearer …" }, "bodyTemplate": "{\\"to\\":\\"{{to}}\\",\\"message\\":\\"{{message}}\\"}" }',
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{provider ? "Edit provider" : "Add SMS provider"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-1"><Label>Provider type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PROVIDER_TYPES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between"><Label>Enabled</Label><Switch checked={isEnabled} onCheckedChange={setIsEnabled} /></div>
          <div className="flex items-center justify-between"><Label>Default provider</Label><Switch checked={isDefault} onCheckedChange={setIsDefault} /></div>
          <div className="space-y-1">
            <Label>Config (JSON)</Label>
            <Textarea rows={8} className="font-mono text-xs" value={configJson} onChange={e => setConfigJson(e.target.value)} placeholder={placeholder[type]} />
            <p className="text-xs text-muted-foreground">Example for {type}: <code>{placeholder[type]}</code></p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>{saveMut.isPending ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderTestDialog({ provider, onClose }: { provider: SmsProvider; onClose: () => void }) {
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("KhanaLagao SMS test from super-admin console.");
  const sendMut = useMutation({
    mutationFn: () => apiAction(`/admin/sms/providers/${provider.id}/test`, "POST", { to, message }),
    onSuccess: (r: { ok: boolean; status: string; error?: string }) =>
      r.ok ? toast.success(`Sent — status ${r.status}`) : toast.error(r.error ?? "Test failed"),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Test {provider.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Recipient phone (e.g. +91…)</Label><Input value={to} onChange={e => setTo(e.target.value)} /></div>
          <div className="space-y-1"><Label>Message</Label><Textarea rows={3} value={message} onChange={e => setMessage(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button disabled={!to || sendMut.isPending} onClick={() => sendMut.mutate()}>{sendMut.isPending ? "Sending..." : "Send test"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────── Templates ───────────
function TemplatesPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ templates: SmsTemplate[]; eventKeys: string[] }>({
    queryKey: ["admin", "sms", "templates"],
    queryFn: () => apiFetch("/admin/sms/templates"),
  });
  const [editing, setEditing] = useState<SmsTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const remove = useMutation({
    mutationFn: (id: number) => apiAction(`/admin/sms/templates/${id}`, "DELETE"),
    onSuccess: () => { toast.success("Template deleted"); qc.invalidateQueries({ queryKey: ["admin", "sms", "templates"] }); },
  });

  const usedKeys = new Set((data?.templates ?? []).map(t => t.eventKey));
  const missingKeys = EVENT_KEYS.filter(k => !usedKeys.has(k));

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{(data?.templates ?? []).length} templates · {missingKeys.length} lifecycle event(s) missing</p>
        <Button onClick={() => setCreating(true)} className="gap-2"><Plus className="w-4 h-4" />Add template</Button>
      </div>
      {missingKeys.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs">
          <strong>Missing templates for events:</strong> {missingKeys.join(", ")}.
          Lifecycle SMS for these events will be skipped until a template is added.
        </div>
      )}
      {isLoading ? <Loader2 className="animate-spin w-5 h-5 mx-auto" /> : (
        <div className="space-y-2">
          {(data?.templates ?? []).map(t => (
            <div key={t.id} className="border border-border rounded-lg p-3 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{t.eventKey}</span>
                  {!t.isActive && <span className="text-xs px-2 py-0.5 rounded bg-destructive/20 text-destructive">disabled</span>}
                  {t.dltTemplateId && <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">DLT: {t.dltTemplateId}</span>}
                </div>
                <p className="text-sm text-foreground/80 mt-1 whitespace-pre-wrap break-words">{t.body}</p>
                {t.variables.length > 0 && <p className="text-xs text-muted-foreground mt-1">Variables: {t.variables.map(v => `{{${v}}}`).join(", ")}</p>}
              </div>
              <div className="flex flex-col gap-1">
                <Button size="sm" variant="outline" onClick={() => setEditing(t)}>Edit</Button>
                <Button size="sm" variant="outline" onClick={() => { if (confirm(`Delete template "${t.name}"?`)) remove.mutate(t.id); }}>
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {(creating || editing) && <TemplateDialog template={editing} onClose={() => { setCreating(false); setEditing(null); }} />}
    </div>
  );
}

function TemplateDialog({ template, onClose }: { template: SmsTemplate | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [eventKey, setEventKey] = useState(template?.eventKey ?? "welcome");
  const [name, setName] = useState(template?.name ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [variables, setVariables] = useState((template?.variables ?? []).join(", "));
  const [dltTemplateId, setDltTemplateId] = useState(template?.dltTemplateId ?? "");
  const [isActive, setIsActive] = useState(template?.isActive ?? true);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        eventKey, name, body,
        variables: variables.split(",").map(s => s.trim()).filter(Boolean),
        dltTemplateId: dltTemplateId || null,
        isActive,
      };
      return template
        ? apiAction(`/admin/sms/templates/${template.id}`, "PATCH", payload)
        : apiAction("/admin/sms/templates", "POST", payload);
    },
    onSuccess: () => { toast.success("Template saved"); qc.invalidateQueries({ queryKey: ["admin", "sms", "templates"] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{template ? "Edit template" : "Add SMS template"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Event key</Label>
            <Select value={eventKey} onValueChange={setEventKey} disabled={!!template}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{EVENT_KEYS.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-1"><Label>Body</Label>
            <Textarea rows={4} value={body} onChange={e => setBody(e.target.value)} />
            <p className="text-xs text-muted-foreground">Use <code>{`{{variable}}`}</code> for placeholders.</p>
          </div>
          <div className="space-y-1"><Label>Variables (comma-separated)</Label><Input value={variables} onChange={e => setVariables(e.target.value)} placeholder="name, restaurant, daysLeft" /></div>
          <div className="space-y-1"><Label>DLT template ID (optional, India)</Label><Input value={dltTemplateId} onChange={e => setDltTemplateId(e.target.value)} /></div>
          <div className="flex items-center justify-between"><Label>Active</Label><Switch checked={isActive} onCheckedChange={setIsActive} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name || !body}>{save.isPending ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────── Logs / Failed ───────────
function LogsPanel({ statusFilter }: { statusFilter: string }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState(statusFilter);
  const [eventKey, setEventKey] = useState<string>("");
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (eventKey) params.set("eventKey", eventKey);
  const url = `/admin/sms/logs${params.toString() ? `?${params}` : ""}`;
  const { data, isLoading } = useQuery<{ rows: SmsLog[]; total: number }>({
    queryKey: ["admin", "sms", "logs", status, eventKey],
    queryFn: () => apiFetch(url),
  });
  const retry = useMutation({
    mutationFn: (id: number) => apiAction(`/admin/sms/logs/${id}/retry`, "POST"),
    onSuccess: (r: { ok: boolean; status: string; error?: string }) => {
      if (r.ok) toast.success(`Retry queued — ${r.status}`);
      else toast.error(r.error ?? "Retry failed");
      qc.invalidateQueries({ queryKey: ["admin", "sms", "logs"] });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="space-y-1"><Label className="text-xs">Status</Label>
          <Select value={status || "all"} onValueChange={v => setStatus(v === "all" ? "" : v)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="blocked">Blocked (quota)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">Event</Label>
          <Select value={eventKey || "all"} onValueChange={v => setEventKey(v === "all" ? "" : v)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {EVENT_KEYS.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}
              <SelectItem value="test">test</SelectItem>
              <SelectItem value="custom">custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto text-sm text-muted-foreground">{data?.total ?? 0} total</div>
      </div>
      {isLoading ? <Loader2 className="animate-spin w-5 h-5 mx-auto" /> : (
        <div className="border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground"><tr>
              <th className="text-left p-2">When</th><th className="text-left p-2">To</th>
              <th className="text-left p-2">Event</th><th className="text-left p-2">Provider</th>
              <th className="text-left p-2">Status</th><th className="text-left p-2">Body / Error</th>
              <th className="text-right p-2">Actions</th>
            </tr></thead>
            <tbody>
              {data?.rows.length === 0 && <tr><td colSpan={7} className="text-center p-6 text-muted-foreground">No SMS logs match.</td></tr>}
              {data?.rows.map(r => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="p-2 whitespace-nowrap text-xs">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="p-2 font-mono text-xs">{r.recipient}</td>
                  <td className="p-2 text-xs">{r.eventKey ?? "—"}</td>
                  <td className="p-2 text-xs">{r.providerType ?? "—"}</td>
                  <td className="p-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      r.status === "sent" || r.status === "delivered" ? "bg-green-100 text-green-700" :
                      r.status === "failed" ? "bg-red-100 text-red-700" :
                      r.status === "blocked" ? "bg-amber-100 text-amber-700" :
                      "bg-muted text-muted-foreground"}`}>{r.status}</span>
                  </td>
                  <td className="p-2 text-xs max-w-md">
                    <div className="line-clamp-2">{r.body}</div>
                    {r.error && <div className="text-destructive line-clamp-2">{r.error}</div>}
                  </td>
                  <td className="p-2 text-right">
                    {(r.status === "failed" || r.status === "blocked") && (
                      <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(r.id)}>
                        <RefreshCcw className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────── Usage / Limits ───────────
function UsagePanel() {
  const qc = useQueryClient();
  const { data: usage, isLoading } = useQuery<UsageRow[]>({
    queryKey: ["admin", "sms", "usage"],
    queryFn: async () => {
      const res = await apiFetch<{ rows: UsageRow[] } | UsageRow[]>("/admin/sms/usage?limit=200");
      return Array.isArray(res) ? res : (res?.rows ?? []);
    },
  });
  const { data: plans } = useQuery<{ id: number; name: string; smsMonthlyLimit: number }[]>({
    queryKey: ["admin", "subscription-plans"],
    queryFn: () => apiFetch("/subscription-plans"),
  });

  const setPlanLimit = useMutation({
    mutationFn: ({ id, limit }: { id: number; limit: number }) =>
      apiAction(`/admin/sms/plans/${id}/limit`, "PATCH", { smsMonthlyLimit: limit }),
    onSuccess: () => { toast.success("Plan SMS limit updated"); qc.invalidateQueries({ queryKey: ["admin", "subscription-plans"] }); qc.invalidateQueries({ queryKey: ["admin", "sms", "usage"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const setTenantLimit = useMutation({
    mutationFn: ({ id, limit }: { id: number; limit: number | null }) =>
      apiAction(`/admin/sms/tenants/${id}/limit`, "PATCH", { smsMonthlyLimit: limit }),
    onSuccess: () => { toast.success("Tenant override updated"); qc.invalidateQueries({ queryKey: ["admin", "sms", "usage"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const sweep = useMutation({
    mutationFn: () => apiAction("/admin/sms/check-quotas", "POST"),
    onSuccess: () => toast.success("Quota check complete"),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Per-plan monthly SMS quota</h3>
        </div>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground"><tr>
              <th className="text-left p-2">Plan</th><th className="text-left p-2">Monthly SMS limit (0 = unlimited)</th><th></th>
            </tr></thead>
            <tbody>
              {plans?.map(p => (
                <tr key={p.id} className="border-t border-border">
                  <td className="p-2">{p.name}</td>
                  <td className="p-2">
                    <PlanLimitInput plan={p} onSave={limit => setPlanLimit.mutate({ id: p.id, limit })} />
                  </td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Per-tenant usage this month</h3>
          <Button size="sm" variant="outline" onClick={() => sweep.mutate()} disabled={sweep.isPending}>
            <RefreshCcw className="w-4 h-4 mr-1" />Run low-balance check
          </Button>
        </div>
        {isLoading ? <Loader2 className="animate-spin w-5 h-5 mx-auto" /> : (
          <div className="border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground"><tr>
                <th className="text-left p-2">Tenant</th><th className="text-left p-2">Plan</th>
                <th className="text-right p-2">Used</th><th className="text-right p-2">Limit</th>
                <th className="text-right p-2">Failed / Blocked</th>
                <th className="text-left p-2">Override</th>
              </tr></thead>
              <tbody>
                {usage?.length === 0 && <tr><td colSpan={6} className="text-center p-6 text-muted-foreground">No tenants.</td></tr>}
                {usage?.map(u => (
                  <tr key={u.tenantId} className="border-t border-border">
                    <td className="p-2">{u.name}</td>
                    <td className="p-2 text-muted-foreground">{u.planName ?? "—"}</td>
                    <td className="p-2 text-right">{u.used}</td>
                    <td className="p-2 text-right">{u.limit > 0 ? u.limit : "∞"}</td>
                    <td className="p-2 text-right text-destructive">{u.failed} / {u.blocked}</td>
                    <td className="p-2">
                      <TenantOverrideInput tenantId={u.tenantId} onSave={limit => setTenantLimit.mutate({ id: u.tenantId, limit })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function PlanLimitInput({ plan, onSave }: { plan: { id: number; smsMonthlyLimit: number }; onSave: (n: number) => void }) {
  const [v, setV] = useState(String(plan.smsMonthlyLimit ?? 0));
  return (
    <div className="flex gap-2">
      <Input type="number" min={0} className="w-32" value={v} onChange={e => setV(e.target.value)} />
      <Button size="sm" variant="outline" onClick={() => onSave(Number(v) || 0)}>Save</Button>
    </div>
  );
}
function TenantOverrideInput({ tenantId, onSave }: { tenantId: number; onSave: (n: number | null) => void }) {
  const [v, setV] = useState<string>("");
  return (
    <div className="flex gap-1">
      <Input placeholder="—" type="number" min={0} className="w-24" value={v} onChange={e => setV(e.target.value)} />
      <Button size="sm" variant="outline" onClick={() => onSave(v === "" ? null : Number(v))}>Set</Button>
      <Button size="sm" variant="ghost" onClick={() => { setV(""); onSave(null); }}>Clear</Button>
      <span className="sr-only">Tenant {tenantId}</span>
    </div>
  );
}
