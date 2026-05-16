import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity, Brain, Cpu, FileText, ShieldAlert, ScrollText, BarChart3,
  Plus, Pencil, Trash2, X, RefreshCw, CheckCircle, AlertTriangle, Zap, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch, apiAction } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type SubTab = "dashboard" | "providers" | "models" | "prompts" | "safety" | "logs" | "costs";

interface AiProvider {
  id: number; slug: string; name: string; kind: string; isEnabled: boolean;
  apiKeyMasked: string | null; apiKeyConfigured: boolean;
  baseUrl: string | null; orgId: string | null;
  defaultModel: string | null; backupModel: string | null;
  timeoutMs: number; maxTokens: number; temperature: string;
  notes: string | null; status: string;
  lastTestedAt: string | null; lastTestStatus: string | null;
  lastTestLatencyMs: number | null; lastTestError: string | null;
}

interface AiAssignment {
  id: number; featureSlug: string; featureLabel: string; category: string; modality: string;
  primaryProviderId: number | null; primaryModel: string | null;
  fallbackProviderId: number | null; fallbackModel: string | null;
  temperature: string; maxTokens: number;
  systemPrompt: string | null;
  jsonMode: boolean; visionEnabled: boolean; imageGenEnabled: boolean;
  isEnabled: boolean; notes: string | null;
}

interface AiPromptTemplate {
  id: number; slug: string; name: string; description: string | null;
  featureSlug: string | null; outputFormat: string; variables: string[];
  activeVersion: number; isActive: boolean; updatedAt: string;
}

interface AiPromptVersion {
  id: number; templateId: number; version: number;
  systemPrompt: string | null; userTemplate: string; notes: string | null;
  createdAt: string;
}

interface AiSafety {
  id: number;
  requireApprovalReviewReplies: boolean; requireApprovalCampaigns: boolean; requireApprovalMenuImport: boolean;
  blockAbuse: boolean; blockHealthClaims: boolean; blockDefamation: boolean;
  maxRetries: number; rateLimitPerMinute: number; rateLimitPerDayPerRestaurant: number;
  dataPrivacyNotice: string | null; storePrompt: boolean; storeResponse: boolean;
  bannedPhrases: string[];
}

interface AiLog {
  id: number; featureSlug: string; providerSlug: string | null; model: string | null;
  modality: string; status: string; errorMessage: string | null;
  inputTokens: number; outputTokens: number; totalTokens: number;
  latencyMs: number | null; retries: number; fallbackUsed: boolean;
  costUsd: string; creditsUsed: number;
  restaurantId: number | null; userId: number | null;
  createdAt: string;
}

const inputCls = "w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

const PROVIDER_KINDS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Google Gemini" },
  { value: "groq", label: "Groq" },
  { value: "mistral", label: "Mistral" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "perplexity", label: "Perplexity" },
  { value: "replicate", label: "Replicate" },
  { value: "stability", label: "Stability" },
  { value: "custom", label: "Custom (OpenAI-compatible)" },
];

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-card border border-border rounded-xl shadow-xl w-full ${wide ? "max-w-3xl" : "max-w-md"} max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border sticky top-0 bg-card z-10">
          <h3 className="font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
function DashboardSubTab() {
  const { data, isLoading } = useQuery<{
    summary: {
      totalRequests: number; failedRequests: number; totalTokens: number;
      providerCostUsd: string; creditsUsed: number; activeProviders: number;
      activeAssignments: number; aiRevenueUsd: string; profitEstimateUsd: string;
    };
    topFeatures: Array<{ featureSlug: string; requests: number }>;
    topRestaurants: Array<{ restaurantId: number | null; requests: number }>;
    providerUsage: Array<{ providerSlug: string | null; requests: number }>;
    modelUsage: Array<{ model: string | null; requests: number }>;
    dailyUsage: Array<{ day: string; requests: number; costUsd: string }>;
  }>({
    queryKey: ["admin-ai", "dashboard"],
    queryFn: () => apiFetch("/admin/ai/dashboard"),
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;
  if (!data) return null;
  const s = data.summary;
  const cards = [
    { label: "Total requests (30d)", value: s.totalRequests, icon: Activity, color: "text-primary" },
    { label: "Failed requests", value: s.failedRequests, icon: AlertTriangle, color: "text-destructive" },
    { label: "Tokens used", value: s.totalTokens.toLocaleString(), icon: Cpu, color: "text-primary" },
    { label: "Provider cost (est)", value: `$${Number(s.providerCostUsd).toFixed(4)}`, icon: BarChart3, color: "text-amber-600" },
    { label: "Credits used", value: s.creditsUsed, icon: Zap, color: "text-primary" },
    { label: "Active providers", value: s.activeProviders, icon: Brain, color: "text-green-600" },
    { label: "Active assignments", value: s.activeAssignments, icon: FileText, color: "text-primary" },
    { label: "AI revenue (credits)", value: `$${Number(s.aiRevenueUsd).toFixed(2)}`, icon: BarChart3, color: "text-green-600" },
  ];

  const maxDaily = Math.max(1, ...data.dailyUsage.map(d => d.requests));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-card border border-border rounded-lg p-3 space-y-1">
            <Icon className={`w-4 h-4 ${color}`} />
            <p className="text-xl font-bold tabular-nums">{value}</p>
            <p className="text-[11px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm font-semibold mb-3">Daily usage (30d)</p>
          {data.dailyUsage.length === 0 ? (
            <p className="text-xs text-muted-foreground">No requests yet.</p>
          ) : (
            <div className="flex items-end gap-1 h-32">
              {data.dailyUsage.map(d => (
                <div key={d.day} className="flex-1 bg-primary/70 rounded-t" style={{ height: `${(d.requests / maxDaily) * 100}%` }} title={`${d.day}: ${d.requests} requests, $${Number(d.costUsd).toFixed(4)}`} />
              ))}
            </div>
          )}
        </div>
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold mb-2">Top features</p>
            {data.topFeatures.length === 0 ? <p className="text-xs text-muted-foreground">—</p> :
              <ul className="text-xs space-y-1">{data.topFeatures.map(f => <li key={f.featureSlug} className="flex justify-between"><span>{f.featureSlug}</span><span className="tabular-nums">{f.requests}</span></li>)}</ul>}
          </div>
          <div>
            <p className="text-sm font-semibold mb-2">Top restaurants</p>
            {data.topRestaurants.length === 0 ? <p className="text-xs text-muted-foreground">—</p> :
              <ul className="text-xs space-y-1">{data.topRestaurants.map(r => <li key={String(r.restaurantId)} className="flex justify-between"><span>Restaurant #{r.restaurantId ?? "—"}</span><span className="tabular-nums">{r.requests}</span></li>)}</ul>}
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm font-semibold mb-2">Provider usage</p>
          {data.providerUsage.length === 0 ? <p className="text-xs text-muted-foreground">—</p> :
            <ul className="text-xs space-y-1">{data.providerUsage.map(p => <li key={String(p.providerSlug)} className="flex justify-between"><span>{p.providerSlug ?? "(none)"}</span><span className="tabular-nums">{p.requests}</span></li>)}</ul>}
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm font-semibold mb-2">Model usage</p>
          {data.modelUsage.length === 0 ? <p className="text-xs text-muted-foreground">—</p> :
            <ul className="text-xs space-y-1">{data.modelUsage.map(m => <li key={String(m.model)} className="flex justify-between"><span>{m.model ?? "(none)"}</span><span className="tabular-nums">{m.requests}</span></li>)}</ul>}
        </div>
      </div>
    </div>
  );
}

// ─── Providers ───────────────────────────────────────────────────────────────
function ProviderModal({ provider, onClose, onSaved }: { provider: AiProvider | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    slug: provider?.slug ?? "",
    name: provider?.name ?? "",
    kind: provider?.kind ?? "openai",
    isEnabled: provider?.isEnabled ?? true,
    apiKey: provider?.apiKeyMasked ?? "",
    baseUrl: provider?.baseUrl ?? "",
    orgId: provider?.orgId ?? "",
    defaultModel: provider?.defaultModel ?? "",
    backupModel: provider?.backupModel ?? "",
    timeoutMs: provider?.timeoutMs ?? 60000,
    maxTokens: provider?.maxTokens ?? 4096,
    temperature: provider?.temperature ?? "0.70",
    notes: provider?.notes ?? "",
  });
  const isEdit = !!provider;

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...form };
      if (isEdit && form.apiKey === provider?.apiKeyMasked) {
        // Don't resend masked key
        delete (body as Partial<typeof body>).apiKey;
      }
      if (isEdit) await apiAction(`/admin/ai/providers/${provider.id}`, "PATCH", body);
      else await apiAction(`/admin/ai/providers`, "POST", body);
      toast({ title: isEdit ? "Provider updated" : "Provider created" });
      onSaved(); onClose();
    } catch (err) {
      toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <Modal title={isEdit ? `Edit provider: ${provider!.name}` : "Add AI provider"} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Slug" hint={isEdit ? "Immutable" : "lowercase, unique"}>
          <input className={inputCls} value={form.slug} disabled={isEdit}
            onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
        </Field>
        <Field label="Name"><input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Kind">
          <select className={inputCls} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
            {PROVIDER_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </Field>
        <Field label="Enabled">
          <select className={inputCls} value={String(form.isEnabled)} onChange={e => setForm({ ...form, isEnabled: e.target.value === "true" })}>
            <option value="true">Yes</option><option value="false">No</option>
          </select>
        </Field>
        <Field label="API key" hint={isEdit && provider?.apiKeyConfigured ? "Leave masked value to keep current key" : "Stored encrypted (AES-GCM). Never returned in full."}>
          <input className={inputCls} type="password" value={form.apiKey}
            onChange={e => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-…" />
        </Field>
        <Field label="Base URL" hint="Optional override"><input className={inputCls} value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" /></Field>
        <Field label="Org ID (OpenAI only)"><input className={inputCls} value={form.orgId} onChange={e => setForm({ ...form, orgId: e.target.value })} /></Field>
        <Field label="Default model"><input className={inputCls} value={form.defaultModel} onChange={e => setForm({ ...form, defaultModel: e.target.value })} placeholder="e.g. gpt-4o-mini" /></Field>
        <Field label="Backup model"><input className={inputCls} value={form.backupModel} onChange={e => setForm({ ...form, backupModel: e.target.value })} /></Field>
        <Field label="Timeout (ms)"><input className={inputCls} type="number" min="1000" value={form.timeoutMs} onChange={e => setForm({ ...form, timeoutMs: Number(e.target.value) })} /></Field>
        <Field label="Max tokens"><input className={inputCls} type="number" min="1" value={form.maxTokens} onChange={e => setForm({ ...form, maxTokens: Number(e.target.value) })} /></Field>
        <Field label="Temperature"><input className={inputCls} type="number" min="0" max="2" step="0.1" value={form.temperature} onChange={e => setForm({ ...form, temperature: e.target.value })} /></Field>
      </div>
      <Field label="Notes"><textarea className={inputCls + " min-h-16"} value={form.notes ?? ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy || !form.name || (!isEdit && !form.slug)}>{isEdit ? "Save" : "Create provider"}</Button>
      </div>
    </Modal>
  );
}

function ProvidersSubTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: providers = [], isLoading } = useQuery<AiProvider[]>({ queryKey: ["admin-ai", "providers"], queryFn: () => apiFetch("/admin/ai/providers") });
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [creating, setCreating] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);

  const test = async (p: AiProvider) => {
    setTestingId(p.id);
    try {
      const r = await apiAction<{ ok: boolean; latencyMs: number; error?: string }>(`/admin/ai/providers/${p.id}/test`, "POST");
      toast({
        title: r.ok ? `✓ ${p.name} reachable in ${r.latencyMs}ms` : `✗ ${p.name} test failed`,
        description: r.ok ? undefined : r.error,
        variant: r.ok ? undefined : "destructive",
      });
      void qc.invalidateQueries({ queryKey: ["admin-ai", "providers"] });
    } finally { setTestingId(null); }
  };

  const remove = async (p: AiProvider) => {
    if (!confirm(`Delete provider ${p.name}?`)) return;
    try {
      await apiAction(`/admin/ai/providers/${p.id}`, "DELETE");
      toast({ title: "Provider deleted" });
      void qc.invalidateQueries({ queryKey: ["admin-ai", "providers"] });
    } catch (err) { toast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" }); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{providers.length} configured</p>
        <Button onClick={() => setCreating(true)} className="gap-2"><Plus className="w-4 h-4" /> Add provider</Button>
      </div>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Provider</th>
              <th className="text-left px-3 py-2">Kind</th>
              <th className="text-left px-3 py-2">Default model</th>
              <th className="text-left px-3 py-2">API key</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Last test</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="text-center p-6 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>}
            {!isLoading && providers.length === 0 && <tr><td colSpan={7} className="text-center p-6 text-muted-foreground">No providers yet — add one to get started.</td></tr>}
            {providers.map(p => (
              <tr key={p.id} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{p.name}<div className="text-xs text-muted-foreground">{p.slug}</div></td>
                <td className="px-3 py-2 text-xs">{p.kind}</td>
                <td className="px-3 py-2 text-xs">{p.defaultModel ?? "—"}</td>
                <td className="px-3 py-2 text-xs font-mono">{p.apiKeyMasked ?? <span className="text-amber-600">not set</span>}</td>
                <td className="px-3 py-2">{p.isEnabled ? <Badge variant="default" className="gap-1"><CheckCircle className="w-3 h-3" />Enabled</Badge> : <Badge variant="outline">Disabled</Badge>}</td>
                <td className="px-3 py-2 text-xs">
                  {p.lastTestStatus === "success" ? <span className="text-green-600">✓ {p.lastTestLatencyMs}ms</span>
                    : p.lastTestStatus === "error" ? <span className="text-destructive" title={p.lastTestError ?? ""}>✗ failed</span>
                    : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" onClick={() => test(p)} disabled={testingId === p.id} className="gap-1">
                    {testingId === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />} Test
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(p)} className="gap-1"><Pencil className="w-3 h-3" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(p)} className="text-destructive gap-1"><Trash2 className="w-3 h-3" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating && <ProviderModal provider={null} onClose={() => setCreating(false)} onSaved={() => qc.invalidateQueries({ queryKey: ["admin-ai", "providers"] })} />}
      {editing && <ProviderModal provider={editing} onClose={() => setEditing(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["admin-ai", "providers"] })} />}
    </div>
  );
}

// ─── Model Settings (per-feature assignments) ────────────────────────────────
function AssignmentModal({ assignment, providers, onClose, onSaved }: { assignment: AiAssignment | null; providers: AiProvider[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    featureSlug: assignment?.featureSlug ?? "",
    featureLabel: assignment?.featureLabel ?? "",
    category: assignment?.category ?? "general",
    modality: assignment?.modality ?? "text",
    primaryProviderId: assignment?.primaryProviderId ?? null,
    primaryModel: assignment?.primaryModel ?? "",
    fallbackProviderId: assignment?.fallbackProviderId ?? null,
    fallbackModel: assignment?.fallbackModel ?? "",
    temperature: assignment?.temperature ?? "0.70",
    maxTokens: assignment?.maxTokens ?? 2048,
    systemPrompt: assignment?.systemPrompt ?? "",
    jsonMode: assignment?.jsonMode ?? false,
    visionEnabled: assignment?.visionEnabled ?? false,
    imageGenEnabled: assignment?.imageGenEnabled ?? false,
    isEnabled: assignment?.isEnabled ?? true,
    notes: assignment?.notes ?? "",
  });
  const isEdit = !!assignment;

  const save = async () => {
    setBusy(true);
    try {
      if (isEdit) await apiAction(`/admin/ai/assignments/${assignment!.id}`, "PATCH", form);
      else await apiAction(`/admin/ai/assignments`, "POST", form);
      toast({ title: isEdit ? "Assignment updated" : "Assignment created" });
      onSaved(); onClose();
    } catch (err) { toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={isEdit ? `Edit: ${assignment!.featureLabel}` : "New feature → model assignment"} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Feature slug" hint={isEdit ? "Immutable" : "e.g. menu_import"}>
          <input className={inputCls} value={form.featureSlug} disabled={isEdit}
            onChange={e => setForm({ ...form, featureSlug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} />
        </Field>
        <Field label="Feature label"><input className={inputCls} value={form.featureLabel} onChange={e => setForm({ ...form, featureLabel: e.target.value })} /></Field>
        <Field label="Category">
          <select className={inputCls} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
            {["general", "menu", "marketing", "review", "inventory", "upsell", "support"].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Modality">
          <select className={inputCls} value={form.modality} onChange={e => setForm({ ...form, modality: e.target.value })}>
            <option value="text">Text</option><option value="json">JSON</option><option value="vision">Vision</option><option value="image">Image</option>
          </select>
        </Field>
        <Field label="Primary provider">
          <select className={inputCls} value={form.primaryProviderId ?? ""} onChange={e => setForm({ ...form, primaryProviderId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— None —</option>
            {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Primary model"><input className={inputCls} value={form.primaryModel ?? ""} onChange={e => setForm({ ...form, primaryModel: e.target.value })} /></Field>
        <Field label="Fallback provider">
          <select className={inputCls} value={form.fallbackProviderId ?? ""} onChange={e => setForm({ ...form, fallbackProviderId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— None —</option>
            {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Fallback model"><input className={inputCls} value={form.fallbackModel ?? ""} onChange={e => setForm({ ...form, fallbackModel: e.target.value })} /></Field>
        <Field label="Temperature"><input className={inputCls} type="number" min="0" max="2" step="0.1" value={form.temperature} onChange={e => setForm({ ...form, temperature: e.target.value })} /></Field>
        <Field label="Max tokens"><input className={inputCls} type="number" min="1" value={form.maxTokens} onChange={e => setForm({ ...form, maxTokens: Number(e.target.value) })} /></Field>
      </div>
      <Field label="System prompt"><textarea className={inputCls + " min-h-24"} value={form.systemPrompt ?? ""} onChange={e => setForm({ ...form, systemPrompt: e.target.value })} /></Field>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.jsonMode} onChange={e => setForm({ ...form, jsonMode: e.target.checked })} /> JSON mode</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.visionEnabled} onChange={e => setForm({ ...form, visionEnabled: e.target.checked })} /> Vision enabled</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.imageGenEnabled} onChange={e => setForm({ ...form, imageGenEnabled: e.target.checked })} /> Image gen enabled</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isEnabled} onChange={e => setForm({ ...form, isEnabled: e.target.checked })} /> Active</label>
      </div>
      <Field label="Notes"><textarea className={inputCls + " min-h-16"} value={form.notes ?? ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy || !form.featureLabel || (!isEdit && !form.featureSlug)}>{isEdit ? "Save" : "Create assignment"}</Button>
      </div>
    </Modal>
  );
}

function ModelSettingsSubTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: assignments = [] } = useQuery<AiAssignment[]>({ queryKey: ["admin-ai", "assignments"], queryFn: () => apiFetch("/admin/ai/assignments") });
  const { data: providers = [] } = useQuery<AiProvider[]>({ queryKey: ["admin-ai", "providers"], queryFn: () => apiFetch("/admin/ai/providers") });
  const [editing, setEditing] = useState<AiAssignment | null>(null);
  const [creating, setCreating] = useState(false);
  const providerName = useMemo(() => Object.fromEntries(providers.map(p => [p.id, p.name])), [providers]);

  const remove = async (a: AiAssignment) => {
    if (!confirm(`Delete assignment for ${a.featureSlug}?`)) return;
    await apiAction(`/admin/ai/assignments/${a.id}`, "DELETE");
    toast({ title: "Assignment deleted" });
    void qc.invalidateQueries({ queryKey: ["admin-ai", "assignments"] });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">{assignments.length} feature assignments</p>
        <Button onClick={() => setCreating(true)} className="gap-2"><Plus className="w-4 h-4" /> New assignment</Button>
      </div>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Feature</th>
              <th className="text-left px-3 py-2">Modality</th>
              <th className="text-left px-3 py-2">Primary</th>
              <th className="text-left px-3 py-2">Fallback</th>
              <th className="text-left px-3 py-2">Mode</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {assignments.length === 0 && <tr><td colSpan={7} className="text-center p-6 text-muted-foreground">No assignments yet.</td></tr>}
            {assignments.map(a => (
              <tr key={a.id} className="border-t border-border">
                <td className="px-3 py-2"><div className="font-medium">{a.featureLabel}</div><div className="text-xs text-muted-foreground">{a.featureSlug} · {a.category}</div></td>
                <td className="px-3 py-2 text-xs">{a.modality}</td>
                <td className="px-3 py-2 text-xs">{a.primaryProviderId ? `${providerName[a.primaryProviderId] ?? "?"} / ${a.primaryModel ?? "—"}` : "—"}</td>
                <td className="px-3 py-2 text-xs">{a.fallbackProviderId ? `${providerName[a.fallbackProviderId] ?? "?"} / ${a.fallbackModel ?? "—"}` : "—"}</td>
                <td className="px-3 py-2 text-xs space-x-1">
                  {a.jsonMode && <Badge variant="outline" className="text-[10px]">JSON</Badge>}
                  {a.visionEnabled && <Badge variant="outline" className="text-[10px]">Vision</Badge>}
                  {a.imageGenEnabled && <Badge variant="outline" className="text-[10px]">Image</Badge>}
                </td>
                <td className="px-3 py-2">{a.isEnabled ? <Badge variant="default">On</Badge> : <Badge variant="outline">Off</Badge>}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(a)}><Pencil className="w-3 h-3" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(a)} className="text-destructive"><Trash2 className="w-3 h-3" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating && <AssignmentModal assignment={null} providers={providers} onClose={() => setCreating(false)} onSaved={() => qc.invalidateQueries({ queryKey: ["admin-ai", "assignments"] })} />}
      {editing && <AssignmentModal assignment={editing} providers={providers} onClose={() => setEditing(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["admin-ai", "assignments"] })} />}
    </div>
  );
}

// ─── Prompt Templates ────────────────────────────────────────────────────────
function PromptModal({ template, onClose, onSaved }: { template: AiPromptTemplate | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const { data: detail } = useQuery<{ template: AiPromptTemplate; versions: AiPromptVersion[] }>({
    queryKey: ["admin-ai", "prompts", template?.id],
    queryFn: () => apiFetch(`/admin/ai/prompts/${template!.id}`),
    enabled: !!template,
  });
  const activeVer = detail?.versions.find(v => v.version === detail.template.activeVersion);

  const [form, setForm] = useState({
    slug: template?.slug ?? "",
    name: template?.name ?? "",
    description: template?.description ?? "",
    featureSlug: template?.featureSlug ?? "",
    outputFormat: template?.outputFormat ?? "text",
    variables: (template?.variables ?? []).join(", "),
    systemPrompt: "",
    userTemplate: "",
    notes: "",
    makeActive: true,
  });
  const [testVars, setTestVars] = useState("{}");
  const [testResult, setTestResult] = useState<string>("");

  // Hydrate from active version once loaded
  useMemo(() => {
    if (activeVer && template) {
      setForm(f => ({ ...f, systemPrompt: activeVer.systemPrompt ?? "", userTemplate: activeVer.userTemplate }));
    }
  }, [activeVer, template]);

  const isEdit = !!template;

  const save = async () => {
    setBusy(true);
    try {
      const variables = form.variables.split(",").map(s => s.trim()).filter(Boolean);
      if (!isEdit) {
        await apiAction(`/admin/ai/prompts`, "POST", {
          slug: form.slug, name: form.name, description: form.description,
          featureSlug: form.featureSlug || null,
          outputFormat: form.outputFormat, variables,
          systemPrompt: form.systemPrompt, userTemplate: form.userTemplate, notes: form.notes,
        });
      } else {
        await apiAction(`/admin/ai/prompts/${template!.id}`, "PATCH", {
          name: form.name, description: form.description,
          featureSlug: form.featureSlug || null, outputFormat: form.outputFormat, variables,
        });
        // New version if user touched the prompt
        if (form.userTemplate && form.userTemplate !== (activeVer?.userTemplate ?? "")) {
          await apiAction(`/admin/ai/prompts/${template!.id}/versions`, "POST", {
            systemPrompt: form.systemPrompt, userTemplate: form.userTemplate, notes: form.notes, makeActive: form.makeActive,
          });
        }
      }
      toast({ title: isEdit ? "Prompt updated" : "Prompt created" });
      onSaved(); onClose();
    } catch (err) { toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const runTest = async () => {
    if (!template) return;
    try {
      const vars = JSON.parse(testVars || "{}");
      const r = await apiAction<{ ok: boolean; output?: string; error?: string; latencyMs?: number; providerSlug?: string; model?: string }>(`/admin/ai/prompts/${template.id}/test`, "POST", { variables: vars });
      if (r.ok) setTestResult(`✓ ${r.providerSlug}/${r.model} in ${r.latencyMs}ms\n\n${r.output}`);
      else setTestResult(`✗ ${r.error}`);
    } catch (err) { setTestResult(`✗ ${(err as Error).message}`); }
  };

  return (
    <Modal title={isEdit ? `Edit: ${template!.name} (v${template!.activeVersion})` : "New prompt template"} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Slug" hint={isEdit ? "Immutable" : "lowercase"}>
          <input className={inputCls} value={form.slug} disabled={isEdit}
            onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} />
        </Field>
        <Field label="Name"><input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Feature slug (optional)"><input className={inputCls} value={form.featureSlug} onChange={e => setForm({ ...form, featureSlug: e.target.value })} /></Field>
        <Field label="Output format">
          <select className={inputCls} value={form.outputFormat} onChange={e => setForm({ ...form, outputFormat: e.target.value })}>
            <option value="text">Text</option><option value="json">JSON</option><option value="markdown">Markdown</option>
          </select>
        </Field>
        <Field label="Variables (comma-separated)" hint="Used as {{name}} in user template"><input className={inputCls} value={form.variables} onChange={e => setForm({ ...form, variables: e.target.value })} /></Field>
        <Field label="Description"><input className={inputCls} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
      </div>
      <Field label="System prompt"><textarea className={inputCls + " min-h-24 font-mono text-xs"} value={form.systemPrompt} onChange={e => setForm({ ...form, systemPrompt: e.target.value })} /></Field>
      <Field label="User template" hint="Use {{variable}} placeholders"><textarea className={inputCls + " min-h-32 font-mono text-xs"} value={form.userTemplate} onChange={e => setForm({ ...form, userTemplate: e.target.value })} /></Field>
      {isEdit && <Field label="Version notes"><input className={inputCls} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Why this change?" /></Field>}
      {isEdit && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.makeActive} onChange={e => setForm({ ...form, makeActive: e.target.checked })} /> Make new version active</label>}
      {isEdit && (
        <div className="bg-muted/30 border border-border rounded-md p-3 space-y-2">
          <p className="text-xs font-semibold">Test prompt</p>
          <textarea className={inputCls + " min-h-16 font-mono text-xs"} value={testVars} onChange={e => setTestVars(e.target.value)} placeholder='{"name": "value"}' />
          <Button size="sm" variant="outline" onClick={runTest} className="gap-2"><Zap className="w-3 h-3" /> Run test</Button>
          {testResult && <pre className="text-xs whitespace-pre-wrap bg-background border border-border rounded p-2 max-h-48 overflow-auto">{testResult}</pre>}
        </div>
      )}
      {isEdit && detail && (
        <div className="text-xs text-muted-foreground">
          <p className="font-semibold mb-1">Versions ({detail.versions.length})</p>
          <ul className="space-y-0.5">
            {detail.versions.map(v => (
              <li key={v.id}>v{v.version}{v.version === detail.template.activeVersion ? " (active)" : ""} — {new Date(v.createdAt).toLocaleString()}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy || !form.name || (!isEdit && (!form.slug || !form.userTemplate))}>{isEdit ? "Save" : "Create"}</Button>
      </div>
    </Modal>
  );
}

function PromptsSubTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: prompts = [] } = useQuery<AiPromptTemplate[]>({ queryKey: ["admin-ai", "prompts"], queryFn: () => apiFetch("/admin/ai/prompts") });
  const [editing, setEditing] = useState<AiPromptTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  const remove = async (p: AiPromptTemplate) => {
    if (!confirm(`Delete prompt template ${p.name}?`)) return;
    await apiAction(`/admin/ai/prompts/${p.id}`, "DELETE");
    toast({ title: "Deleted" });
    void qc.invalidateQueries({ queryKey: ["admin-ai", "prompts"] });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">{prompts.length} templates</p>
        <Button onClick={() => setCreating(true)} className="gap-2"><Plus className="w-4 h-4" /> New template</Button>
      </div>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Feature</th>
              <th className="text-left px-3 py-2">Format</th>
              <th className="text-left px-3 py-2">Active version</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {prompts.length === 0 && <tr><td colSpan={6} className="text-center p-6 text-muted-foreground">No templates yet.</td></tr>}
            {prompts.map(p => (
              <tr key={p.id} className="border-t border-border">
                <td className="px-3 py-2"><div className="font-medium">{p.name}</div><div className="text-xs text-muted-foreground">{p.slug}</div></td>
                <td className="px-3 py-2 text-xs">{p.featureSlug ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{p.outputFormat}</td>
                <td className="px-3 py-2 text-xs">v{p.activeVersion}</td>
                <td className="px-3 py-2">{p.isActive ? <Badge variant="default">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(p)}><Pencil className="w-3 h-3" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(p)} className="text-destructive"><Trash2 className="w-3 h-3" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating && <PromptModal template={null} onClose={() => setCreating(false)} onSaved={() => qc.invalidateQueries({ queryKey: ["admin-ai", "prompts"] })} />}
      {editing && <PromptModal template={editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ["admin-ai", "prompts"] }); qc.invalidateQueries({ queryKey: ["admin-ai", "prompts", editing.id] }); }} />}
    </div>
  );
}

// ─── Safety Settings ─────────────────────────────────────────────────────────
function SafetySubTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<AiSafety>({ queryKey: ["admin-ai", "safety"], queryFn: () => apiFetch("/admin/ai/safety") });
  const [form, setForm] = useState<AiSafety | null>(null);
  useMemo(() => { if (data && !form) setForm(data); }, [data, form]);
  const mut = useMutation({
    mutationFn: (body: Partial<AiSafety>) => apiAction("/admin/ai/safety", "PATCH", body),
    onSuccess: () => { toast({ title: "Safety settings saved" }); void qc.invalidateQueries({ queryKey: ["admin-ai", "safety"] }); },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading || !form) return <div className="p-8 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;
  const set = <K extends keyof AiSafety>(k: K, v: AiSafety[K]) => setForm({ ...form, [k]: v });

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <p className="text-sm font-semibold">Human approval required</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requireApprovalReviewReplies} onChange={e => set("requireApprovalReviewReplies", e.target.checked)} /> Review replies</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requireApprovalCampaigns} onChange={e => set("requireApprovalCampaigns", e.target.checked)} /> Marketing campaigns</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requireApprovalMenuImport} onChange={e => set("requireApprovalMenuImport", e.target.checked)} /> Menu import</label>
      </div>
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <p className="text-sm font-semibold">Content filters</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.blockAbuse} onChange={e => set("blockAbuse", e.target.checked)} /> Block abusive content</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.blockHealthClaims} onChange={e => set("blockHealthClaims", e.target.checked)} /> Block unverified health claims</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.blockDefamation} onChange={e => set("blockDefamation", e.target.checked)} /> Block defamation</label>
        <Field label="Banned phrases (one per line)">
          <textarea className={inputCls + " min-h-20"} value={form.bannedPhrases.join("\n")} onChange={e => set("bannedPhrases", e.target.value.split("\n").map(s => s.trim()).filter(Boolean))} />
        </Field>
      </div>
      <div className="bg-card border border-border rounded-lg p-4 grid grid-cols-3 gap-4">
        <Field label="Max retries"><input className={inputCls} type="number" min="0" value={form.maxRetries} onChange={e => set("maxRetries", Number(e.target.value))} /></Field>
        <Field label="Rate limit / minute"><input className={inputCls} type="number" min="1" value={form.rateLimitPerMinute} onChange={e => set("rateLimitPerMinute", Number(e.target.value))} /></Field>
        <Field label="Daily limit / restaurant"><input className={inputCls} type="number" min="1" value={form.rateLimitPerDayPerRestaurant} onChange={e => set("rateLimitPerDayPerRestaurant", Number(e.target.value))} /></Field>
      </div>
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <p className="text-sm font-semibold">Data privacy</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.storePrompt} onChange={e => set("storePrompt", e.target.checked)} /> Store prompt snapshots in logs</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.storeResponse} onChange={e => set("storeResponse", e.target.checked)} /> Store response snapshots in logs</label>
        <Field label="Customer-facing privacy notice"><textarea className={inputCls + " min-h-16"} value={form.dataPrivacyNotice ?? ""} onChange={e => set("dataPrivacyNotice", e.target.value)} /></Field>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => mut.mutate(form)} disabled={mut.isPending}>{mut.isPending ? "Saving…" : "Save settings"}</Button>
      </div>
    </div>
  );
}

// ─── Logs ────────────────────────────────────────────────────────────────────
function LogsSubTab() {
  const [filters, setFilters] = useState({ featureSlug: "", providerSlug: "", model: "", status: "", restaurantId: "", from: "", to: "" });
  const [page, setPage] = useState(0);
  const limit = 50;
  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    return p.toString();
  }, [filters, page]);
  const { data, isLoading, refetch } = useQuery<{ rows: AiLog[]; total: number }>({
    queryKey: ["admin-ai", "logs", params],
    queryFn: () => apiFetch(`/admin/ai/logs?${params}`),
  });
  const [detail, setDetail] = useState<AiLog | null>(null);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
        <input className={inputCls} placeholder="Feature slug" value={filters.featureSlug} onChange={e => setFilters({ ...filters, featureSlug: e.target.value })} />
        <input className={inputCls} placeholder="Provider slug" value={filters.providerSlug} onChange={e => setFilters({ ...filters, providerSlug: e.target.value })} />
        <input className={inputCls} placeholder="Model" value={filters.model} onChange={e => setFilters({ ...filters, model: e.target.value })} />
        <select className={inputCls} value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All status</option><option value="success">Success</option><option value="error">Error</option><option value="blocked">Blocked</option>
        </select>
        <input className={inputCls} placeholder="Restaurant ID" value={filters.restaurantId} onChange={e => setFilters({ ...filters, restaurantId: e.target.value })} />
        <input className={inputCls} type="datetime-local" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} />
        <input className={inputCls} type="datetime-local" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => refetch()} className="gap-2"><RefreshCw className="w-3 h-3" /> Refresh</Button>
        <span className="text-xs text-muted-foreground">{data?.total ?? 0} matching</span>
      </div>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-2 py-2">When</th>
              <th className="text-left px-2 py-2">Feature</th>
              <th className="text-left px-2 py-2">Provider/Model</th>
              <th className="text-left px-2 py-2">Status</th>
              <th className="text-right px-2 py-2">Tokens</th>
              <th className="text-right px-2 py-2">Latency</th>
              <th className="text-right px-2 py-2">Cost</th>
              <th className="text-left px-2 py-2">Restaurant</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={9} className="text-center p-6"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>}
            {!isLoading && (data?.rows.length ?? 0) === 0 && <tr><td colSpan={9} className="text-center p-6 text-muted-foreground">No logs.</td></tr>}
            {data?.rows.map(r => (
              <tr key={r.id} className="border-t border-border hover:bg-muted/20 cursor-pointer" onClick={() => setDetail(r)}>
                <td className="px-2 py-1.5 whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-2 py-1.5">{r.featureSlug}</td>
                <td className="px-2 py-1.5">{r.providerSlug ?? "—"}{r.model ? ` / ${r.model}` : ""}{r.fallbackUsed && <Badge variant="outline" className="ml-1 text-[9px]">FB</Badge>}</td>
                <td className="px-2 py-1.5">
                  {r.status === "success" ? <Badge variant="default" className="text-[10px]">OK</Badge>
                    : r.status === "blocked" ? <Badge variant="outline" className="text-[10px]">Blocked</Badge>
                    : <Badge variant="destructive" className="text-[10px]">Error</Badge>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.totalTokens}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.latencyMs ?? "—"}ms</td>
                <td className="px-2 py-1.5 text-right tabular-nums">${Number(r.costUsd).toFixed(6)}</td>
                <td className="px-2 py-1.5">#{r.restaurantId ?? "—"}</td>
                <td className="px-2 py-1.5 text-right text-muted-foreground">›</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Page {page + 1}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Prev</Button>
          <Button variant="outline" size="sm" disabled={(data?.rows.length ?? 0) < limit} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      </div>
      {detail && (
        <Modal title={`Log #${detail.id}`} onClose={() => setDetail(null)} wide>
          <pre className="text-xs whitespace-pre-wrap bg-muted/40 p-3 rounded">{JSON.stringify(detail, null, 2)}</pre>
        </Modal>
      )}
    </div>
  );
}

// ─── Cost Reports ────────────────────────────────────────────────────────────
function CostReportsSubTab() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useQuery<{
    days: number;
    byProvider: Array<{ providerSlug: string | null; requests: number; tokens: number; costUsd: string; failed: number }>;
    byFeature: Array<{ featureSlug: string; requests: number; tokens: number; costUsd: string }>;
    byRestaurant: Array<{ restaurantId: number | null; requests: number; tokens: number; costUsd: string }>;
    byDay: Array<{ day: string; requests: number; costUsd: string }>;
  }>({
    queryKey: ["admin-ai", "cost", days],
    queryFn: () => apiFetch(`/admin/ai/reports/cost?days=${days}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm">Range:</span>
        {[7, 30, 90, 365].map(n => (
          <Button key={n} size="sm" variant={days === n ? "default" : "outline"} onClick={() => setDays(n)}>{n}d</Button>
        ))}
      </div>
      {isLoading && <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>}
      {data && (
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { title: "By Provider", rows: data.byProvider, key: "providerSlug" as const },
            { title: "By Feature", rows: data.byFeature, key: "featureSlug" as const },
            { title: "By Restaurant", rows: data.byRestaurant, key: "restaurantId" as const },
          ].map(section => (
            <div key={section.title} className="bg-card border border-border rounded-lg p-4">
              <p className="text-sm font-semibold mb-2">{section.title}</p>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground"><tr><th className="text-left">Key</th><th className="text-right">Requests</th><th className="text-right">Tokens</th><th className="text-right">Cost</th></tr></thead>
                <tbody>
                  {(section.rows as Array<Record<string, unknown>>).map((r, i) => (
                    <tr key={i} className="border-t border-border/50">
                      <td className="py-1">{String(r[section.key] ?? "—")}</td>
                      <td className="text-right tabular-nums">{Number(r["requests"])}</td>
                      <td className="text-right tabular-nums">{Number(r["tokens"]).toLocaleString()}</td>
                      <td className="text-right tabular-nums">${Number(r["costUsd"]).toFixed(6)}</td>
                    </tr>
                  ))}
                  {section.rows.length === 0 && <tr><td colSpan={4} className="text-center p-2 text-muted-foreground">—</td></tr>}
                </tbody>
              </table>
            </div>
          ))}
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-sm font-semibold mb-2">Daily cost</p>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground"><tr><th className="text-left">Date</th><th className="text-right">Requests</th><th className="text-right">Cost</th></tr></thead>
              <tbody>
                {data.byDay.map(d => (
                  <tr key={d.day} className="border-t border-border/50">
                    <td className="py-1">{d.day}</td>
                    <td className="text-right tabular-nums">{d.requests}</td>
                    <td className="text-right tabular-nums">${Number(d.costUsd).toFixed(6)}</td>
                  </tr>
                ))}
                {data.byDay.length === 0 && <tr><td colSpan={3} className="text-center p-2 text-muted-foreground">—</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Tab Container ──────────────────────────────────────────────────────
export default function AdminAiTab() {
  const [sub, setSub] = useState<SubTab>("dashboard");
  const tabs: Array<{ id: SubTab; label: string; icon: typeof Activity }> = [
    { id: "dashboard", label: "Dashboard", icon: Activity },
    { id: "providers", label: "AI Providers", icon: Brain },
    { id: "models", label: "Model Settings", icon: Cpu },
    { id: "prompts", label: "Prompt Templates", icon: FileText },
    { id: "safety", label: "Safety Settings", icon: ShieldAlert },
    { id: "logs", label: "AI Logs", icon: ScrollText },
    { id: "costs", label: "Cost Reports", icon: BarChart3 },
  ];
  return (
    <div className="space-y-4">
      <div className="border-b border-border flex gap-1 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)}
            className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              sub === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>
      {sub === "dashboard" && <DashboardSubTab />}
      {sub === "providers" && <ProvidersSubTab />}
      {sub === "models" && <ModelSettingsSubTab />}
      {sub === "prompts" && <PromptsSubTab />}
      {sub === "safety" && <SafetySubTab />}
      {sub === "logs" && <LogsSubTab />}
      {sub === "costs" && <CostReportsSubTab />}
    </div>
  );
}
