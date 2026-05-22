import * as React from "react";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiAction, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, MessageSquare, Plus, RefreshCcw, Send, Trash2, FileText, Activity, BarChart3, Settings as SettingsIcon, Eye, EyeOff, CheckCircle2, XCircle, CircleDashed } from "lucide-react";
import { toast } from "sonner";
import {
  SMS_PROVIDER_TYPE_OPTIONS,
  getSmsProviderSchema,
  smsProviderDefaultConfig,
  validateSmsProviderConfig,
  isMaskedSmsSecret,
  type SmsProviderField,
  type SmsProviderSchema,
} from "@workspace/db/smsProviderSchema";

const PROVIDER_TYPES = SMS_PROVIDER_TYPE_OPTIONS;

const EVENT_KEYS = [
  "welcome", "otp", "trial_ending", "subscription_activated",
  "subscription_expired", "payment_reminder", "payment_received",
  "restaurant_suspended", "demo_booked",
] as const;

type SubTab = "providers" | "templates" | "logs" | "failed" | "usage";

type SmsProvider = {
  id: number; type: string; name: string;
  isEnabled: boolean; isDefault: boolean;
  config: Record<string, unknown>;
  lastTestStatus: "ok" | "failed" | null;
  lastTestError: string | null;
  lastTestAt: string | null;
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
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Enabled</th><th className="text-left p-3">Default</th>
              <th className="text-right p-3">Actions</th>
            </tr></thead>
            <tbody>
              {providers?.length === 0 && <tr><td colSpan={6} className="text-center p-6 text-muted-foreground">No providers configured yet.</td></tr>}
              {providers?.map(p => (
                <tr key={p.id} className="border-t border-border">
                  <td className="p-3 font-medium">{p.name}</td>
                  <td className="p-3 text-muted-foreground">{p.type}</td>
                  <td className="p-3"><ProviderStatusPill provider={p} /></td>
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

function ProviderStatusPill({ provider }: { provider: SmsProvider }) {
  const when = provider.lastTestAt ? new Date(provider.lastTestAt).toLocaleString() : null;
  if (provider.lastTestStatus === "ok") {
    return (
      <span title={`Last tested ${when}`} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">
        <CheckCircle2 className="w-3 h-3" />Reachable
        {when && <span className="text-[10px] text-green-700/70">· {when}</span>}
      </span>
    );
  }
  if (provider.lastTestStatus === "failed") {
    return (
      <span title={provider.lastTestError ? `${provider.lastTestError}\n(${when ?? ""})` : `Last tested ${when}`}
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">
        <XCircle className="w-3 h-3" />Last test failed
        {when && <span className="text-[10px] text-red-700/70">· {when}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
      <CircleDashed className="w-3 h-3" />Not tested
    </span>
  );
}

// ─────────── Provider field input (driven by the shared schema) ───────────
function ProviderFieldInput({
  field, value, onChange, error,
}: {
  field: SmsProviderField;
  value: unknown;
  onChange: (next: unknown) => void;
  error?: string;
}) {
  const [reveal, setReveal] = useState(false);
  const id = `cfg-${field.key}`;
  const errorCls = error ? "border-destructive focus-visible:ring-destructive" : "";

  let input: React.JSX.Element;
  if (field.kind === "boolean") {
    input = (
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="font-normal">{field.label}</Label>
        <Switch id={id} checked={value === true} onCheckedChange={onChange} />
      </div>
    );
  } else if (field.kind === "select") {
    input = (
      <Select value={String(value ?? field.defaultValue ?? "")} onValueChange={onChange}>
        <SelectTrigger id={id} className={errorCls}><SelectValue /></SelectTrigger>
        <SelectContent>
          {(field.options ?? []).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  } else if (field.kind === "number") {
    input = (
      <Input id={id} type="number" className={errorCls}
        min={field.min} max={field.max}
        value={value === undefined || value === null ? "" : String(value)}
        placeholder={field.placeholder}
        onChange={e => {
          const raw = e.target.value;
          if (raw === "") { onChange(undefined); return; }
          const n = Number(raw);
          onChange(Number.isFinite(n) ? n : raw);
        }}
      />
    );
  } else if (field.kind === "textarea") {
    input = (
      <Textarea id={id} rows={4} className={`font-mono text-xs ${errorCls}`}
        value={typeof value === "string" ? value : (value == null ? "" : JSON.stringify(value, null, 2))}
        placeholder={field.placeholder}
        onChange={e => onChange(e.target.value)}
      />
    );
  } else if (field.kind === "secret") {
    input = (
      <div className="relative">
        <Input id={id} type={reveal ? "text" : "password"}
          className={`pr-9 ${errorCls}`}
          autoComplete="off"
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder ?? (isMaskedSmsSecret(value) ? "" : "")}
          onChange={e => onChange(e.target.value)}
        />
        <button type="button" tabIndex={-1}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
          onClick={() => setReveal(v => !v)}
          aria-label={reveal ? "Hide" : "Show"}>
          {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    );
  } else {
    input = (
      <Input id={id} type={field.kind === "url" ? "url" : "text"} className={errorCls}
        value={typeof value === "string" ? value : (value == null ? "" : String(value))}
        placeholder={field.placeholder}
        onChange={e => onChange(e.target.value)}
      />
    );
  }

  if (field.kind === "boolean") {
    return (
      <div className="space-y-1">
        {input}
        {field.helper && <p className="text-xs text-muted-foreground">{field.helper}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{field.label}{field.required && <span className="text-destructive"> *</span>}</Label>
      {input}
      {field.helper && <p className="text-xs text-muted-foreground">{field.helper}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ProviderDialog({ provider, onClose }: { provider: SmsProvider | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(provider?.name ?? "");
  const [type, setType] = useState<string>(provider?.type ?? "twilio");
  const [isEnabled, setIsEnabled] = useState(provider?.isEnabled ?? true);
  const [isDefault, setIsDefault] = useState(provider?.isDefault ?? false);
  // Seed config: existing values for edits, or schema-provided defaults
  // for new providers. Persisted across type switches via per-type state
  // so the admin doesn't lose data when they change their mind.
  const initialPerType = useMemo(() => {
    const seed: Record<string, Record<string, unknown>> = {};
    const startType = provider?.type ?? "twilio";
    seed[startType] = provider
      ? { ...(provider.config ?? {}) }
      : { ...smsProviderDefaultConfig(startType) };
    return seed;
  }, [provider]);
  const [perTypeConfig, setPerTypeConfig] = useState<Record<string, Record<string, unknown>>>(initialPerType);
  const [showAdvanced, setShowAdvanced] = useState(type === "custom");
  const [advancedJson, setAdvancedJson] = useState<string>(() =>
    JSON.stringify(perTypeConfig[type] ?? {}, null, 2));
  const [advancedJsonError, setAdvancedJsonError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const schema: SmsProviderSchema | null = getSmsProviderSchema(type);
  const config = perTypeConfig[type] ?? {};

  function switchType(next: string) {
    setType(next);
    setFieldErrors({});
    setPerTypeConfig(prev => {
      if (prev[next]) return prev;
      return { ...prev, [next]: { ...smsProviderDefaultConfig(next) } };
    });
    // Reset advanced JSON to mirror the newly-active config.
    setAdvancedJson(JSON.stringify(perTypeConfig[next] ?? smsProviderDefaultConfig(next), null, 2));
    setAdvancedJsonError(null);
    if (next === "custom") setShowAdvanced(true);
  }

  function setFieldValue(key: string, value: unknown) {
    setPerTypeConfig(prev => {
      const cur = { ...(prev[type] ?? {}) };
      if (value === undefined) delete cur[key];
      else cur[key] = value;
      const nextState = { ...prev, [type]: cur };
      // Keep the advanced JSON view in sync when it's not the active editor.
      if (!showAdvanced) setAdvancedJson(JSON.stringify(cur, null, 2));
      return nextState;
    });
    if (fieldErrors[key]) {
      setFieldErrors(prev => {
        const { [key]: _, ...rest } = prev;
        return rest;
      });
    }
  }

  function commitAdvancedJson(text: string) {
    setAdvancedJson(text);
    try {
      const parsed = text.trim() === "" ? {} : JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setAdvancedJsonError("Must be a JSON object");
        return;
      }
      setAdvancedJsonError(null);
      setPerTypeConfig(prev => ({ ...prev, [type]: parsed as Record<string, unknown> }));
    } catch (e) {
      setAdvancedJsonError((e as Error).message);
    }
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name is required");
      if (advancedJsonError) throw new Error(`Advanced JSON: ${advancedJsonError}`);
      const errs = validateSmsProviderConfig(type, config, provider?.config ?? null);
      if (errs.length > 0) {
        const map: Record<string, string> = {};
        for (const e of errs) map[e.key] = e.message;
        setFieldErrors(map);
        throw new Error(errs[0].message);
      }
      const body = { name, type, isEnabled, isDefault, config };
      return provider
        ? apiAction(`/admin/sms/providers/${provider.id}`, "PATCH", body)
        : apiAction("/admin/sms/providers", "POST", body);
    },
    onSuccess: () => { toast.success("Provider saved"); qc.invalidateQueries({ queryKey: ["admin", "sms", "providers"] }); onClose(); },
    onError: (e: Error) => {
      // Hydrate inline errors from the server's field-level validation if present.
      if (e instanceof ApiError && e.data && typeof e.data === "object") {
        const data = e.data as { fieldErrors?: { key: string; message: string }[] };
        if (Array.isArray(data.fieldErrors)) {
          const map: Record<string, string> = {};
          for (const f of data.fieldErrors) map[f.key] = f.message;
          setFieldErrors(map);
        }
      }
      toast.error(e.message);
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{provider ? "Edit provider" : "Add SMS provider"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="prov-name">Name <span className="text-destructive">*</span></Label>
            <Input id="prov-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Twilio production" />
          </div>
          <div className="space-y-1">
            <Label>Provider type</Label>
            <Select value={type} onValueChange={switchType} disabled={!!provider}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PROVIDER_TYPES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
            {schema?.description && <p className="text-xs text-muted-foreground">{schema.description}</p>}
            {provider && <p className="text-xs text-muted-foreground">Type can't be changed for an existing provider.</p>}
          </div>
          <div className="flex items-center justify-between"><Label>Enabled</Label><Switch checked={isEnabled} onCheckedChange={setIsEnabled} /></div>
          <div className="flex items-center justify-between"><Label>Default provider</Label><Switch checked={isDefault} onCheckedChange={setIsDefault} /></div>

          {!showAdvanced && schema && (
            <div className="space-y-3 border-t border-border pt-3">
              <h4 className="text-sm font-semibold">{schema.label} credentials</h4>
              {schema.fields.map(field => (
                <ProviderFieldInput
                  key={field.key}
                  field={field}
                  value={config[field.key]}
                  error={fieldErrors[field.key]}
                  onChange={v => setFieldValue(field.key, v)}
                />
              ))}
              {provider && schema.fields.some(f => f.kind === "secret") && (
                <p className="text-xs text-muted-foreground">
                  Existing secrets are masked. Leave them as-is to keep the stored value.
                </p>
              )}
            </div>
          )}

          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Advanced (raw JSON)</Label>
              <Switch checked={showAdvanced} onCheckedChange={v => {
                setShowAdvanced(v);
                if (v) setAdvancedJson(JSON.stringify(config, null, 2));
                else if (!advancedJsonError) {
                  // Pull JSON edits back into the per-field form.
                  try {
                    const parsed = JSON.parse(advancedJson || "{}");
                    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                      setPerTypeConfig(prev => ({ ...prev, [type]: parsed as Record<string, unknown> }));
                    }
                  } catch { /* keep what we had */ }
                }
              }} />
            </div>
            {showAdvanced && (
              <>
                <Textarea rows={8} className="font-mono text-xs"
                  value={advancedJson}
                  onChange={e => commitAdvancedJson(e.target.value)}
                />
                {advancedJsonError && <p className="text-xs text-destructive">{advancedJsonError}</p>}
                <p className="text-xs text-muted-foreground">
                  Edits here apply to the same config saved by the form above. Use this for unknown keys or Custom HTTP power-user setups.
                </p>
              </>
            )}
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

type ProviderTestResponse = {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: string | null;
  providerMessageId: string | null;
  providerSessionId: string | null;
  testedAt: string;
};

function ProviderTestDialog({ provider, onClose }: { provider: SmsProvider; onClose: () => void }) {
  const qc = useQueryClient();
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("KhanaLagao SMS test from super-admin console.");
  const [result, setResult] = useState<ProviderTestResponse | null>(null);
  const sendMut = useMutation({
    mutationFn: () => apiAction<ProviderTestResponse>(`/admin/sms/providers/${provider.id}/test`, "POST", { to, message }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["admin", "sms", "providers"] });
      if (r.ok) toast.success(`Sent — status ${r.status}`);
      else toast.error(`Test failed${r.errorCode ? ` (${r.errorCode})` : ""}`);
    },
    onError: (e: Error) => {
      // The test endpoint replies 200 even on provider-side failures, so
      // we only land here on transport / auth / 4xx-validation errors.
      setResult({
        ok: false, status: "failed",
        error: e.message, errorCode: e instanceof ApiError ? String(e.status) : null,
        providerMessageId: null, providerSessionId: null,
        testedAt: new Date().toISOString(),
      });
      toast.error(e.message);
    },
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Test {provider.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Recipient phone (e.g. +91…)</Label><Input value={to} onChange={e => setTo(e.target.value)} /></div>
          <div className="space-y-1"><Label>Message</Label><Textarea rows={3} value={message} onChange={e => setMessage(e.target.value)} /></div>
          {result && (
            <div className={`rounded-md border p-3 text-sm ${
              result.ok
                ? "border-green-300 bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-200"
                : "border-red-300 bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200"
            }`}>
              <div className="font-semibold flex items-center gap-1.5">
                {result.ok
                  ? <><CheckCircle2 className="w-4 h-4" />Reachable — gateway accepted the message</>
                  : <><XCircle className="w-4 h-4" />Test failed</>}
              </div>
              {result.ok && result.providerMessageId && (
                <div className="text-xs mt-1">Provider message id: <code className="font-mono">{result.providerMessageId}</code></div>
              )}
              {!result.ok && (
                <div className="text-xs mt-1 break-words">
                  {result.errorCode && <div><strong>Code:</strong> <code className="font-mono">{result.errorCode}</code></div>}
                  {result.error && <div className="mt-0.5"><strong>Message:</strong> {result.error}</div>}
                </div>
              )}
              <div className="text-[10px] opacity-70 mt-1">{new Date(result.testedAt).toLocaleString()}</div>
            </div>
          )}
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
