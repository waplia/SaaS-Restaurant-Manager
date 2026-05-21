import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity, Brain, Cpu, FileText, ShieldAlert, ScrollText, BarChart3,
  Plus, Pencil, Trash2, X, RefreshCw, CheckCircle, AlertTriangle, Zap, Loader2,
  Wallet, Coins, Package, Ban, Search, ArrowDownToLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch, apiAction } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type SubTab = "dashboard" | "providers" | "models" | "prompts" | "safety" | "logs" | "costs" | "credit-rules" | "recharge-packages" | "wallets" | "ledger";

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
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

const inputCls = "w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

const PROVIDER_KINDS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Google Gemini" },
  { value: "groq", label: "Groq (Llama on Groq Cloud)" },
  { value: "xai", label: "xAI Grok" },
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
  const [bulkOpen, setBulkOpen] = useState(false);
  const providerName = useMemo(() => Object.fromEntries(providers.map(p => [p.id, p.name])), [providers]);

  const remove = async (a: AiAssignment) => {
    if (!confirm(`Delete assignment for ${a.featureSlug}?`)) return;
    await apiAction(`/admin/ai/assignments/${a.id}`, "DELETE");
    toast({ title: "Assignment deleted" });
    void qc.invalidateQueries({ queryKey: ["admin-ai", "assignments"] });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center gap-2">
        <p className="text-sm text-muted-foreground">{assignments.length} feature assignments</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBulkOpen(true)} className="gap-2"><Zap className="w-4 h-4" /> Bulk update</Button>
          <Button onClick={() => setCreating(true)} className="gap-2"><Plus className="w-4 h-4" /> New assignment</Button>
        </div>
      </div>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Feature</th>
              <th className="text-left px-3 py-2">Tier</th>
              <th className="text-left px-3 py-2">Modality</th>
              <th className="text-left px-3 py-2">Primary</th>
              <th className="text-left px-3 py-2">Fallback</th>
              <th className="text-left px-3 py-2">Mode</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {assignments.length === 0 && <tr><td colSpan={8} className="text-center p-6 text-muted-foreground">No assignments yet.</td></tr>}
            {assignments.map(a => {
              const t = tierOf(a);
              return (
              <tr key={a.id} className="border-t border-border">
                <td className="px-3 py-2"><div className="font-medium">{a.featureLabel}</div><div className="text-xs text-muted-foreground">{a.featureSlug} · {a.category}</div></td>
                <td className="px-3 py-2 text-xs">
                  {t === "normal" && <Badge variant="outline" className="text-[10px]">Normal</Badge>}
                  {t === "advance" && <Badge variant="secondary" className="text-[10px]">Advance</Badge>}
                  {t === "reasoning" && <Badge variant="default" className="text-[10px]">Reasoning</Badge>}
                </td>
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
              );
            })}
          </tbody>
        </table>
      </div>
      {creating && <AssignmentModal assignment={null} providers={providers} onClose={() => setCreating(false)} onSaved={() => qc.invalidateQueries({ queryKey: ["admin-ai", "assignments"] })} />}
      {editing && <AssignmentModal assignment={editing} providers={providers} onClose={() => setEditing(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["admin-ai", "assignments"] })} />}
      {bulkOpen && (
        <BulkAssignmentModal
          assignments={assignments}
          providers={providers}
          onClose={() => setBulkOpen(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["admin-ai", "assignments"] })}
        />
      )}
    </div>
  );
}

/**
 * Tier classification — three buckets based on how much reasoning the
 * feature really needs, derived from the primary model name so we don't
 * need a schema column:
 *   - "normal"    : lightweight tasks on a *-flash-lite model
 *                   (e.g. short suggestions, simple summaries)
 *   - "advance"   : mid-weight tasks on a *-flash model
 *                   (e.g. menu import, fraud detection, recipe optimizer —
 *                    things that need more than flash-lite but don't need
 *                    a full reasoning model)
 *   - "reasoning" : heavyweight tasks on a premium reasoning model
 *                   (sonnet / gpt-4 / gemini pro / o-series / etc.)
 */
type Tier = "normal" | "advance" | "reasoning";

function tierOf(a: AiAssignment): Tier {
  const m = (a.primaryModel ?? "").toLowerCase();
  if (m.includes("flash-lite")) return "normal";
  if (m.includes("flash")) return "advance";
  return "reasoning";
}

const TIER_LABELS: Record<Tier, string> = {
  normal: "Normal",
  advance: "Advance",
  reasoning: "Reasoning",
};

/**
 * Bulk update modal — lets the super admin re-bind many feature assignments
 * to a new provider/model in one click. Two scopes are offered:
 *   - "all"       : every assignment in the system
 *   - "category"  : just rows in a selected category (e.g. "marketing")
 *   - "modality"  : just rows of a given modality (e.g. text vs image)
 *   - "provider"  : every row currently bound to a specific provider
 *                   (use case: "move everything off OpenAI to Anthropic")
 * The patch can change primary provider/model, fallback provider/model, or
 * the enabled flag. A preview count is shown before applying so the admin
 * sees exactly how many rows will be touched.
 */
function BulkAssignmentModal({
  assignments, providers, onClose, onSaved,
}: {
  assignments: AiAssignment[];
  providers: AiProvider[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"all" | "category" | "modality" | "tier" | "provider">("all");
  const [category, setCategory] = useState("");
  const [modality, setModality] = useState("text");
  const [tier, setTier] = useState<Tier>("normal");
  const [filterProviderId, setFilterProviderId] = useState<number | "">("");

  // Patch fields. Empty string = "leave unchanged"; null is allowed for
  // fallback to explicitly clear it.
  const [newPrimaryProviderId, setNewPrimaryProviderId] = useState<number | "">("");
  const [newPrimaryModel, setNewPrimaryModel] = useState("");
  const [touchFallback, setTouchFallback] = useState(false);
  const [newFallbackProviderId, setNewFallbackProviderId] = useState<number | "" | "clear">("");
  const [newFallbackModel, setNewFallbackModel] = useState("");

  // Distinct categories/modalities present in the current assignments — much
  // friendlier than free-text since the column is effectively an enum.
  const categories = useMemo(
    () => Array.from(new Set(assignments.map(a => a.category).filter(Boolean))).sort(),
    [assignments],
  );
  const modalities = useMemo(
    () => Array.from(new Set(assignments.map(a => a.modality).filter(Boolean))).sort(),
    [assignments],
  );

  // Live preview of how many rows the current filter selects.
  const matched = useMemo(() => {
    if (scope === "all") return assignments;
    if (scope === "category") return assignments.filter(a => a.category === category);
    if (scope === "modality") return assignments.filter(a => a.modality === modality);
    if (scope === "tier") return assignments.filter(a => tierOf(a) === tier);
    if (scope === "provider") return assignments.filter(a => a.primaryProviderId === filterProviderId);
    return [];
  }, [scope, assignments, category, modality, tier, filterProviderId]);

  // Suggest a default model from the chosen provider so the admin doesn't
  // have to type one out every time. They can still override.
  const pickedProvider = providers.find(p => p.id === newPrimaryProviderId);
  useEffect(() => {
    if (pickedProvider && !newPrimaryModel) {
      setNewPrimaryModel(pickedProvider.defaultModel ?? "");
    }
  }, [pickedProvider, newPrimaryModel]);

  const hasPatch =
    newPrimaryProviderId !== "" ||
    newPrimaryModel.trim() !== "" ||
    touchFallback;

  const apply = async () => {
    if (matched.length === 0) {
      toast({ title: "Nothing to update", description: "No assignments match the current filter.", variant: "destructive" });
      return;
    }
    if (!hasPatch) {
      toast({ title: "No changes", description: "Pick at least one field to update.", variant: "destructive" });
      return;
    }
    if (!confirm(`Update ${matched.length} assignment${matched.length === 1 ? "" : "s"}? This cannot be undone in bulk.`)) return;

    const filter: Record<string, unknown> = {};
    if (scope === "category") filter.category = category;
    else if (scope === "modality") filter.modality = modality;
    else if (scope === "tier") filter.tier = tier;
    else if (scope === "provider") filter.primaryProviderId = filterProviderId;
    // scope === "all" → no filter keys, server treats as "every row"

    const patch: Record<string, unknown> = {};
    if (newPrimaryProviderId !== "") patch.primaryProviderId = newPrimaryProviderId;
    if (newPrimaryModel.trim() !== "") patch.primaryModel = newPrimaryModel.trim();
    if (touchFallback) {
      // Empty select = leave unchanged (don't send the key). "clear" = send
      // null to explicitly wipe the FK. A real provider id sends that id.
      if (newFallbackProviderId === "clear") patch.fallbackProviderId = null;
      else if (newFallbackProviderId !== "") patch.fallbackProviderId = newFallbackProviderId;
      // Same idea for the model string: only include it when the admin
      // actually typed something or explicitly cleared the provider.
      if (newFallbackModel.trim() !== "") patch.fallbackModel = newFallbackModel.trim();
      else if (newFallbackProviderId === "clear") patch.fallbackModel = null;
    }

    setBusy(true);
    try {
      const res = await apiAction<{ updated: number }>(`/admin/ai/assignments/bulk`, "POST", { filter, patch });
      toast({ title: "Bulk update complete", description: `${res.updated} assignment${res.updated === 1 ? "" : "s"} updated.` });
      onSaved();
      onClose();
    } catch (err) {
      toast({ title: "Bulk update failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Bulk update assignments" onClose={onClose} wide>
      <div className="space-y-4">
        <Field label="Apply to" hint="Pick which assignments this change should affect.">
          <select className={inputCls} value={scope} onChange={e => setScope(e.target.value as typeof scope)}>
            <option value="all">All assignments ({assignments.length})</option>
            <option value="category">By category</option>
            <option value="modality">By modality</option>
            <option value="tier">By tier (Normal / Advance)</option>
            <option value="provider">By current primary provider</option>
          </select>
        </Field>

        {scope === "tier" && (
          <Field label="Tier" hint="Normal = flash-lite. Advance = flash (mid-weight reasoning). Reasoning = premium models (pro/sonnet/gpt-4).">
            <select className={inputCls} value={tier} onChange={e => setTier(e.target.value as Tier)}>
              <option value="normal">Normal (flash-lite)</option>
              <option value="advance">Advance (flash)</option>
              <option value="reasoning">Reasoning (premium)</option>
            </select>
          </Field>
        )}

        {scope === "category" && (
          <Field label="Category">
            <select className={inputCls} value={category} onChange={e => setCategory(e.target.value)}>
              <option value="">Pick a category…</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        )}
        {scope === "modality" && (
          <Field label="Modality">
            <select className={inputCls} value={modality} onChange={e => setModality(e.target.value)}>
              {modalities.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        )}
        {scope === "provider" && (
          <Field label="Currently bound to">
            <select className={inputCls} value={filterProviderId} onChange={e => setFilterProviderId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Pick a provider…</option>
              {providers.map(p => <option key={p.id} value={p.id}>{p.name} ({p.kind})</option>)}
            </select>
          </Field>
        )}

        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {matched.length === 0
            ? "No assignments match this filter yet."
            : `${matched.length} assignment${matched.length === 1 ? "" : "s"} will be updated.`}
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <h4 className="text-sm font-semibold text-foreground">New settings</h4>
          <p className="text-xs text-muted-foreground">Leave a field blank to keep it as-is.</p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="New primary provider">
              <select
                className={inputCls}
                value={newPrimaryProviderId}
                onChange={e => {
                  const v = e.target.value ? Number(e.target.value) : "";
                  setNewPrimaryProviderId(v);
                  // Reset suggested model so the effect re-suggests for the new provider.
                  setNewPrimaryModel("");
                }}
              >
                <option value="">Don't change</option>
                {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="New primary model" hint={pickedProvider?.defaultModel ? `Default: ${pickedProvider.defaultModel}` : undefined}>
              <input
                className={inputCls}
                value={newPrimaryModel}
                placeholder="e.g. gpt-4o-mini"
                onChange={e => setNewPrimaryModel(e.target.value)}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={touchFallback} onChange={e => setTouchFallback(e.target.checked)} />
            <span>Also update fallback</span>
          </label>
          {touchFallback && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="New fallback provider">
                <select
                  className={inputCls}
                  value={newFallbackProviderId}
                  onChange={e => setNewFallbackProviderId(e.target.value === "clear" ? "clear" : e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">Don't change</option>
                  <option value="clear">— Clear fallback —</option>
                  {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="New fallback model">
                <input
                  className={inputCls}
                  value={newFallbackModel}
                  placeholder="e.g. claude-3-5-haiku"
                  onChange={e => setNewFallbackModel(e.target.value)}
                />
              </Field>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={apply} disabled={busy || matched.length === 0 || !hasPatch} className="gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Apply to {matched.length}
          </Button>
        </div>
      </div>
    </Modal>
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
  useEffect(() => {
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
  useEffect(() => { if (data && !form) setForm(data); }, [data, form]);
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
  const { toast } = useToast();
  const [filters, setFilters] = useState({ featureSlug: "", providerSlug: "", model: "", status: "", restaurantId: "", userId: "", from: "", to: "" });
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
      <div className="grid grid-cols-2 md:grid-cols-8 gap-2">
        <input className={inputCls} placeholder="Feature slug" value={filters.featureSlug} onChange={e => setFilters({ ...filters, featureSlug: e.target.value })} />
        <input className={inputCls} placeholder="Provider slug" value={filters.providerSlug} onChange={e => setFilters({ ...filters, providerSlug: e.target.value })} />
        <input className={inputCls} placeholder="Model" value={filters.model} onChange={e => setFilters({ ...filters, model: e.target.value })} />
        <select className={inputCls} value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All status</option><option value="success">Success</option><option value="error">Error</option><option value="blocked">Blocked</option>
        </select>
        <input className={inputCls} placeholder="Restaurant ID" value={filters.restaurantId} onChange={e => setFilters({ ...filters, restaurantId: e.target.value })} />
        <input className={inputCls} placeholder="User ID" value={filters.userId} onChange={e => setFilters({ ...filters, userId: e.target.value })} />
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
          <div className="space-y-3">
            <pre className="text-xs whitespace-pre-wrap bg-muted/40 p-3 rounded max-h-96 overflow-auto">{JSON.stringify(detail, null, 2)}</pre>
            {detail.status !== "blocked" && detail.featureSlug === "prompt_test" && detail.metadata && typeof detail.metadata === "object" && "promptTemplateId" in (detail.metadata as Record<string, unknown>) && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const tplId = (detail.metadata as Record<string, unknown>)["promptTemplateId"];
                    await apiAction(`/admin/ai/prompts/${tplId}/test`, "POST", { variables: {} });
                    toast({ title: "Retry submitted" });
                    refetch();
                  } catch (err) { toast({ title: "Retry failed", description: (err as Error).message, variant: "destructive" }); }
                }}
              >Retry safe (prompt test re-run)</Button>
            )}
          </div>
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
    byProvider: Array<{ providerSlug: string | null; requests: number; tokens: number; costUsd: string; failed: number; failedCostUsd: string }>;
    byFeature: Array<{ featureSlug: string; requests: number; tokens: number; costUsd: string }>;
    byRestaurant: Array<{ restaurantId: number | null; requests: number; tokens: number; costUsd: string }>;
    byDay: Array<{ day: string; requests: number; costUsd: string }>;
    byMonth: Array<{ month: string; requests: number; tokens: number; costUsd: string; imageCostUsd: string; failedCostUsd: string }>;
    byModality: Array<{ modality: string; requests: number; costUsd: string; failed: number; failedCostUsd: string }>;
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
            <p className="text-sm font-semibold mb-2">By Modality (image vs text — failed cost shown)</p>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground"><tr><th className="text-left">Modality</th><th className="text-right">Requests</th><th className="text-right">Total cost</th><th className="text-right">Failed cost</th></tr></thead>
              <tbody>
                {data.byModality.map(r => (
                  <tr key={r.modality} className="border-t border-border/50">
                    <td className="py-1">{r.modality}</td>
                    <td className="text-right tabular-nums">{r.requests}</td>
                    <td className="text-right tabular-nums">${Number(r.costUsd).toFixed(6)}</td>
                    <td className="text-right tabular-nums text-destructive">${Number(r.failedCostUsd).toFixed(6)}</td>
                  </tr>
                ))}
                {data.byModality.length === 0 && <tr><td colSpan={4} className="text-center p-2 text-muted-foreground">—</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-sm font-semibold mb-2">Monthly cost (image-gen + failed breakdown)</p>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground"><tr><th className="text-left">Month</th><th className="text-right">Requests</th><th className="text-right">Total</th><th className="text-right">Image</th><th className="text-right">Failed</th></tr></thead>
              <tbody>
                {data.byMonth.map(m => (
                  <tr key={m.month} className="border-t border-border/50">
                    <td className="py-1">{m.month}</td>
                    <td className="text-right tabular-nums">{m.requests}</td>
                    <td className="text-right tabular-nums">${Number(m.costUsd).toFixed(4)}</td>
                    <td className="text-right tabular-nums">${Number(m.imageCostUsd).toFixed(4)}</td>
                    <td className="text-right tabular-nums text-destructive">${Number(m.failedCostUsd).toFixed(4)}</td>
                  </tr>
                ))}
                {data.byMonth.length === 0 && <tr><td colSpan={5} className="text-center p-2 text-muted-foreground">—</td></tr>}
              </tbody>
            </table>
          </div>
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

// ─── Credit Rules ────────────────────────────────────────────────────────────
interface CreditRule {
  id: number; featureSlug: string; label: string; description: string | null;
  unitType: string; creditsPerUnit: string; minimumCredits: number;
  freeAllowancePerMonth: number; isActive: boolean;
  scopeType?: "global" | "plan" | "restaurant"; scopeId?: number | null;
}
function CreditRuleModal({ rule, onClose, onSaved }: { rule: CreditRule | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    featureSlug: rule?.featureSlug ?? "",
    label: rule?.label ?? "",
    description: rule?.description ?? "",
    unitType: rule?.unitType ?? "request",
    creditsPerUnit: rule?.creditsPerUnit ?? "1",
    minimumCredits: rule?.minimumCredits ?? 1,
    freeAllowancePerMonth: rule?.freeAllowancePerMonth ?? 0,
    isActive: rule?.isActive ?? true,
    scopeType: rule?.scopeType ?? "global",
    scopeId: rule?.scopeId ?? null,
  });
  const save = async () => {
    setBusy(true);
    try {
      if (rule) await apiAction(`/admin/ai/credit-rules/${rule.id}`, "PATCH", form);
      else await apiAction(`/admin/ai/credit-rules`, "POST", form);
      toast({ title: rule ? "Rule updated" : "Rule created" });
      onSaved(); onClose();
    } catch (err) { toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={rule ? `Edit rule: ${rule.featureSlug}` : "New credit rule"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Feature slug"><input className={inputCls} value={form.featureSlug} onChange={e => setForm({ ...form, featureSlug: e.target.value })} /></Field>
        <Field label="Label"><input className={inputCls} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} /></Field>
        <Field label="Unit type">
          <select className={inputCls} value={form.unitType} onChange={e => setForm({ ...form, unitType: e.target.value })}>
            <option value="request">Request</option>
            <option value="token">Token</option>
            <option value="image">Image</option>
            <option value="minute">Minute</option>
          </select>
        </Field>
        <Field label="Credits per unit"><input className={inputCls} value={form.creditsPerUnit} onChange={e => setForm({ ...form, creditsPerUnit: e.target.value })} /></Field>
        <Field label="Minimum credits"><input type="number" className={inputCls} value={form.minimumCredits} onChange={e => setForm({ ...form, minimumCredits: Number(e.target.value) })} /></Field>
        <Field label="Free allowance / month"><input type="number" className={inputCls} value={form.freeAllowancePerMonth} onChange={e => setForm({ ...form, freeAllowancePerMonth: Number(e.target.value) })} /></Field>
        <Field label="Scope">
          <select
            className={inputCls}
            value={form.scopeType}
            onChange={e => {
              const next = e.target.value as "global" | "plan" | "restaurant";
              setForm({ ...form, scopeType: next, scopeId: next === "global" ? null : form.scopeId });
            }}
          >
            <option value="global">Global (all tenants)</option>
            <option value="plan">Plan override</option>
            <option value="restaurant">Restaurant override</option>
          </select>
        </Field>
        <Field label={form.scopeType === "plan" ? "Plan ID" : form.scopeType === "restaurant" ? "Restaurant (tenant) ID" : "Scope ID"}>
          <input
            type="number"
            className={inputCls}
            disabled={form.scopeType === "global"}
            value={form.scopeId ?? ""}
            placeholder={form.scopeType === "global" ? "—" : "e.g. 12"}
            onChange={e => setForm({ ...form, scopeId: e.target.value ? Number(e.target.value) : null })}
          />
        </Field>
        <Field label="Active">
          <select className={inputCls} value={String(form.isActive)} onChange={e => setForm({ ...form, isActive: e.target.value === "true" })}>
            <option value="true">Yes</option><option value="false">No</option>
          </select>
        </Field>
      </div>
      <Field label="Description">
        <textarea className={inputCls + " min-h-16"} value={form.description ?? ""} onChange={e => setForm({ ...form, description: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy || !form.featureSlug || !form.label}>{rule ? "Save" : "Create"}</Button>
      </div>
    </Modal>
  );
}
function CreditRulesSubTab() {
  const qc = useQueryClient(); const { toast } = useToast();
  const { data = [], isLoading } = useQuery<CreditRule[]>({ queryKey: ["admin-ai", "credit-rules"], queryFn: async () => {
    const res = await apiFetch<{ rows: CreditRule[] } | CreditRule[]>("/admin/ai/credit-rules?limit=500");
    return Array.isArray(res) ? res : (res?.rows ?? []);
  } });
  const [editing, setEditing] = useState<CreditRule | null>(null);
  const [creating, setCreating] = useState(false);
  const remove = async (r: CreditRule) => {
    if (!confirm(`Delete rule "${r.featureSlug}"?`)) return;
    try { await apiAction(`/admin/ai/credit-rules/${r.id}`, "DELETE"); void qc.invalidateQueries({ queryKey: ["admin-ai", "credit-rules"] }); toast({ title: "Deleted" }); }
    catch (err) { toast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" }); }
  };
  return (
    <div className="bg-card border border-border rounded-xl">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <p className="font-semibold text-sm flex items-center gap-2"><Coins className="w-4 h-4 text-primary" />Credit rules <span className="text-xs text-muted-foreground">({data.length})</span></p>
        <Button size="sm" onClick={() => setCreating(true)} className="gap-1"><Plus className="w-3.5 h-3.5" />New rule</Button>
      </div>
      {isLoading ? <div className="p-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div> : (
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs text-muted-foreground"><tr>
            <th className="px-3 py-2 text-left">Feature</th><th className="px-3 py-2 text-left">Label</th>
            <th className="px-3 py-2 text-right">Credits/unit</th><th className="px-3 py-2 text-right">Min</th>
            <th className="px-3 py-2 text-right">Free/mo</th><th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {data.map(r => (
              <tr key={r.id} className="hover:bg-muted/20">
                <td className="px-3 py-2 font-mono text-xs">{r.featureSlug}</td>
                <td className="px-3 py-2">{r.label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.creditsPerUnit} / {r.unitType}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.minimumCredits}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.freeAllowancePerMonth}</td>
                <td className="px-3 py-2">{r.isActive ? <Badge>Active</Badge> : <Badge variant="outline">Off</Badge>}</td>
                <td className="px-3 py-2 text-right space-x-1">
                  <Button size="sm" variant="outline" onClick={() => setEditing(r)} className="gap-1"><Pencil className="w-3 h-3" /></Button>
                  <Button size="sm" variant="outline" onClick={() => void remove(r)} className="gap-1 text-destructive"><Trash2 className="w-3 h-3" /></Button>
                </td>
              </tr>
            ))}
            {data.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground text-xs">No rules yet.</td></tr>}
          </tbody>
        </table>
      )}
      {creating && <CreditRuleModal rule={null} onClose={() => setCreating(false)} onSaved={() => qc.invalidateQueries({ queryKey: ["admin-ai", "credit-rules"] })} />}
      {editing && <CreditRuleModal rule={editing} onClose={() => setEditing(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["admin-ai", "credit-rules"] })} />}
    </div>
  );
}

// ─── Recharge Packages ───────────────────────────────────────────────────────
interface RechargePackage {
  id: number; slug: string; name: string; description: string | null;
  credits: number; bonusCredits: number; price: string; currency: string;
  validityDays: number | null; sortOrder: number; isActive: boolean; isFeatured: boolean;
  showToRestaurants?: boolean;
}
function RechargePackageModal({ pkg, onClose, onSaved }: { pkg: RechargePackage | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    slug: pkg?.slug ?? "", name: pkg?.name ?? "", description: pkg?.description ?? "",
    credits: pkg?.credits ?? 1000, bonusCredits: pkg?.bonusCredits ?? 0,
    price: pkg?.price ?? "499", currency: pkg?.currency ?? "INR",
    validityDays: pkg?.validityDays ?? null, sortOrder: pkg?.sortOrder ?? 0,
    isActive: pkg?.isActive ?? true, isFeatured: pkg?.isFeatured ?? false,
    showToRestaurants: pkg?.showToRestaurants ?? true,
  });
  const save = async () => {
    setBusy(true);
    try {
      if (pkg) await apiAction(`/admin/ai/recharge-packages/${pkg.id}`, "PATCH", form);
      else await apiAction(`/admin/ai/recharge-packages`, "POST", form);
      toast({ title: pkg ? "Package updated" : "Package created" });
      onSaved(); onClose();
    } catch (err) { toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={pkg ? `Edit package: ${pkg.name}` : "New recharge package"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Slug"><input className={inputCls} value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} /></Field>
        <Field label="Name"><input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Credits"><input type="number" className={inputCls} value={form.credits} onChange={e => setForm({ ...form, credits: Number(e.target.value) })} /></Field>
        <Field label="Bonus credits"><input type="number" className={inputCls} value={form.bonusCredits} onChange={e => setForm({ ...form, bonusCredits: Number(e.target.value) })} /></Field>
        <Field label="Price"><input className={inputCls} value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></Field>
        <Field label="Currency">
          <select className={inputCls} value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>
            <option value="INR">INR</option><option value="USD">USD</option>
          </select>
        </Field>
        <Field label="Validity (days, optional)"><input type="number" className={inputCls} value={form.validityDays ?? ""} onChange={e => setForm({ ...form, validityDays: e.target.value ? Number(e.target.value) : null })} /></Field>
        <Field label="Sort order"><input type="number" className={inputCls} value={form.sortOrder} onChange={e => setForm({ ...form, sortOrder: Number(e.target.value) })} /></Field>
        <Field label="Active">
          <select className={inputCls} value={String(form.isActive)} onChange={e => setForm({ ...form, isActive: e.target.value === "true" })}>
            <option value="true">Yes</option><option value="false">No</option>
          </select>
        </Field>
        <Field label="Featured">
          <select className={inputCls} value={String(form.isFeatured)} onChange={e => setForm({ ...form, isFeatured: e.target.value === "true" })}>
            <option value="false">No</option><option value="true">Yes</option>
          </select>
        </Field>
        <Field label="Show to restaurants">
          <select className={inputCls} value={String(form.showToRestaurants)} onChange={e => setForm({ ...form, showToRestaurants: e.target.value === "true" })}>
            <option value="true">Yes — visible in subscription page</option>
            <option value="false">No — hidden (super-admin only)</option>
          </select>
        </Field>
      </div>
      <Field label="Description"><textarea className={inputCls + " min-h-16"} value={form.description ?? ""} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy || !form.slug || !form.name}>{pkg ? "Save" : "Create"}</Button>
      </div>
    </Modal>
  );
}
function RechargePackagesSubTab() {
  const qc = useQueryClient(); const { toast } = useToast();
  const { data = [], isLoading } = useQuery<RechargePackage[]>({ queryKey: ["admin-ai", "recharge-packages"], queryFn: async () => {
    const res = await apiFetch<{ rows: RechargePackage[] } | RechargePackage[]>("/admin/ai/recharge-packages?limit=500");
    return Array.isArray(res) ? res : (res?.rows ?? []);
  } });
  const [editing, setEditing] = useState<RechargePackage | null>(null);
  const [creating, setCreating] = useState(false);
  const remove = async (p: RechargePackage) => {
    if (!confirm(`Delete package "${p.name}"?`)) return;
    try { await apiAction(`/admin/ai/recharge-packages/${p.id}`, "DELETE"); void qc.invalidateQueries({ queryKey: ["admin-ai", "recharge-packages"] }); toast({ title: "Deleted" }); }
    catch (err) { toast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" }); }
  };
  return (
    <div className="bg-card border border-border rounded-xl">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <p className="font-semibold text-sm flex items-center gap-2"><Package className="w-4 h-4 text-primary" />Recharge packages <span className="text-xs text-muted-foreground">({data.length})</span></p>
        <Button size="sm" onClick={() => setCreating(true)} className="gap-1"><Plus className="w-3.5 h-3.5" />New package</Button>
      </div>
      {isLoading ? <div className="p-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div> : (
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs text-muted-foreground"><tr>
            <th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-right">Credits</th>
            <th className="px-3 py-2 text-right">Bonus</th><th className="px-3 py-2 text-right">Price</th>
            <th className="px-3 py-2 text-right">Validity</th><th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {data.map(p => (
              <tr key={p.id} className="hover:bg-muted/20">
                <td className="px-3 py-2"><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.slug}</p></td>
                <td className="px-3 py-2 text-right tabular-nums">{p.credits.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">+{p.bonusCredits.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.currency} {p.price}</td>
                <td className="px-3 py-2 text-right text-xs">{p.validityDays ? `${p.validityDays}d` : "—"}</td>
                <td className="px-3 py-2 space-x-1">
                  {p.isActive ? <Badge>Active</Badge> : <Badge variant="outline">Off</Badge>}
                  {p.isFeatured && <Badge variant="secondary">★</Badge>}
                </td>
                <td className="px-3 py-2 text-right space-x-1">
                  <Button size="sm" variant="outline" onClick={() => setEditing(p)} className="gap-1"><Pencil className="w-3 h-3" /></Button>
                  <Button size="sm" variant="outline" onClick={() => void remove(p)} className="gap-1 text-destructive"><Trash2 className="w-3 h-3" /></Button>
                </td>
              </tr>
            ))}
            {data.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground text-xs">No packages yet.</td></tr>}
          </tbody>
        </table>
      )}
      {creating && <RechargePackageModal pkg={null} onClose={() => setCreating(false)} onSaved={() => qc.invalidateQueries({ queryKey: ["admin-ai", "recharge-packages"] })} />}
      {editing && <RechargePackageModal pkg={editing} onClose={() => setEditing(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["admin-ai", "recharge-packages"] })} />}
    </div>
  );
}

// ─── Wallets ─────────────────────────────────────────────────────────────────
interface WalletRow {
  walletId: number | null; tenantId: number; tenantName: string;
  balance: number; monthlyBalance: number; purchasedBalance: number; bonusBalance: number;
  reservedCredits: number; lifetimeCreditsUsed: number; lifetimeCreditsPurchased: number;
  isBlocked: boolean; betaFeatures: string[];
}
function WalletDetailModal({ tenantId, onClose }: { tenantId: number; onClose: () => void }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const { data, refetch } = useQuery<{ wallet: WalletRow; recentTransactions: Array<{ id: number; createdAt: string; type: string; featureSlug: string | null; creditsDelta: string; description: string | null }>; rechargePackages: RechargePackage[] }>({
    queryKey: ["admin-ai", "wallet", tenantId],
    queryFn: () => apiFetch(`/admin/ai/wallets/${tenantId}`),
  });
  const [adjust, setAdjust] = useState({ credits: 0, bucket: "monthly", description: "" });
  const [recharge, setRecharge] = useState<{ packageId: number | null; reference: string }>({ packageId: null, reference: "" });
  const [betaInput, setBetaInput] = useState("");
  const refresh = () => { void refetch(); void qc.invalidateQueries({ queryKey: ["admin-ai", "wallets"] }); };
  if (!data) return <Modal title="Wallet" onClose={onClose}><div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div></Modal>;
  const w = data.wallet;
  const doAdjust = async () => {
    try { await apiAction(`/admin/ai/wallets/${tenantId}/adjust`, "POST", adjust); toast({ title: "Adjusted" }); setAdjust({ credits: 0, bucket: "monthly", description: "" }); refresh(); }
    catch (err) { toast({ title: "Failed", description: (err as Error).message, variant: "destructive" }); }
  };
  const doBlock = async () => {
    try { await apiAction(`/admin/ai/wallets/${tenantId}/block`, "POST", { isBlocked: !w.isBlocked }); toast({ title: w.isBlocked ? "Unblocked" : "Blocked" }); refresh(); }
    catch (err) { toast({ title: "Failed", description: (err as Error).message, variant: "destructive" }); }
  };
  const doRecharge = async () => {
    if (!recharge.packageId) return;
    try { await apiAction(`/admin/ai/wallets/${tenantId}/recharge`, "POST", recharge); toast({ title: "Recharged" }); setRecharge({ packageId: null, reference: "" }); refresh(); }
    catch (err) { toast({ title: "Failed", description: (err as Error).message, variant: "destructive" }); }
  };
  const doAllocate = async () => {
    try { await apiAction(`/admin/ai/wallets/${tenantId}/allocate-monthly`, "POST"); toast({ title: "Allocated" }); refresh(); }
    catch (err) { toast({ title: "Failed", description: (err as Error).message, variant: "destructive" }); }
  };
  const addBeta = async () => {
    const beta = [...new Set([...w.betaFeatures, betaInput.trim()].filter(Boolean))];
    try { await apiAction(`/admin/ai/wallets/${tenantId}/beta-features`, "POST", { betaFeatures: beta }); setBetaInput(""); refresh(); }
    catch (err) { toast({ title: "Failed", description: (err as Error).message, variant: "destructive" }); }
  };
  const removeBeta = async (slug: string) => {
    const beta = w.betaFeatures.filter(s => s !== slug);
    try { await apiAction(`/admin/ai/wallets/${tenantId}/beta-features`, "POST", { betaFeatures: beta }); refresh(); }
    catch (err) { toast({ title: "Failed", description: (err as Error).message, variant: "destructive" }); }
  };
  return (
    <Modal title={`Wallet: ${w.tenantName}`} onClose={onClose} wide>
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { label: "Balance", value: w.balance, color: "text-primary" },
          { label: "Monthly", value: w.monthlyBalance, color: "text-foreground" },
          { label: "Purchased", value: w.purchasedBalance, color: "text-green-600" },
          { label: "Bonus", value: w.bonusBalance, color: "text-amber-600" },
          { label: "Reserved", value: w.reservedCredits, color: "text-muted-foreground" },
          { label: "Lifetime used", value: w.lifetimeCreditsUsed, color: "text-muted-foreground" },
          { label: "Lifetime bought", value: w.lifetimeCreditsPurchased, color: "text-muted-foreground" },
          { label: "Status", value: w.isBlocked ? "Blocked" : "OK", color: w.isBlocked ? "text-destructive" : "text-green-600" },
        ].map(c => (
          <div key={c.label} className="bg-muted/20 rounded p-2"><p className="text-[11px] text-muted-foreground">{c.label}</p><p className={`text-base font-bold ${c.color} tabular-nums`}>{typeof c.value === "number" ? c.value.toLocaleString() : c.value}</p></div>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-border rounded-lg p-3 space-y-2">
          <p className="text-sm font-semibold">Adjust balance</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Credits (+/-)"><input type="number" className={inputCls} value={adjust.credits} onChange={e => setAdjust({ ...adjust, credits: Number(e.target.value) })} /></Field>
            <Field label="Bucket">
              <select className={inputCls} value={adjust.bucket} onChange={e => setAdjust({ ...adjust, bucket: e.target.value })}>
                <option value="monthly">Monthly</option><option value="purchased">Purchased</option><option value="bonus">Bonus</option>
              </select>
            </Field>
          </div>
          <Field label="Description"><input className={inputCls} value={adjust.description} onChange={e => setAdjust({ ...adjust, description: e.target.value })} /></Field>
          <Button size="sm" onClick={doAdjust} disabled={adjust.credits === 0}>Apply</Button>
        </div>
        <div className="border border-border rounded-lg p-3 space-y-2">
          <p className="text-sm font-semibold">Recharge (free)</p>
          <Field label="Package">
            <select className={inputCls} value={recharge.packageId ?? ""} onChange={e => setRecharge({ ...recharge, packageId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Select package…</option>
              {data.rechargePackages.map(p => <option key={p.id} value={p.id}>{p.name} — {p.credits}+{p.bonusCredits} cr</option>)}
            </select>
          </Field>
          <Field label="Reference"><input className={inputCls} value={recharge.reference} onChange={e => setRecharge({ ...recharge, reference: e.target.value })} /></Field>
          <div className="flex gap-2">
            <Button size="sm" onClick={doRecharge} disabled={!recharge.packageId}>Recharge</Button>
            <Button size="sm" variant="outline" onClick={doAllocate} className="gap-1"><RefreshCw className="w-3 h-3" />Allocate monthly</Button>
            <Button size="sm" variant="outline" onClick={doBlock} className={`gap-1 ${w.isBlocked ? "text-green-600" : "text-destructive"}`}><Ban className="w-3 h-3" />{w.isBlocked ? "Unblock" : "Block"}</Button>
          </div>
        </div>
        <div className="border border-border rounded-lg p-3 space-y-2 md:col-span-2">
          <p className="text-sm font-semibold">Beta features</p>
          <div className="flex flex-wrap gap-1">
            {w.betaFeatures.map(slug => (
              <span key={slug} className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full">{slug}<button onClick={() => void removeBeta(slug)}><X className="w-3 h-3" /></button></span>
            ))}
            {w.betaFeatures.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
          </div>
          <div className="flex gap-2">
            <input className={inputCls + " flex-1"} placeholder="feature-slug" value={betaInput} onChange={e => setBetaInput(e.target.value)} />
            <Button size="sm" onClick={addBeta} disabled={!betaInput.trim()}>Add</Button>
          </div>
        </div>
        <div className="border border-border rounded-lg p-3 md:col-span-2">
          <p className="text-sm font-semibold mb-2">Recent transactions</p>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground"><tr><th className="text-left py-1">Time</th><th className="text-left">Type</th><th className="text-left">Feature</th><th className="text-right">Δ</th><th className="text-left">Note</th></tr></thead>
              <tbody>
                {data.recentTransactions.map(t => (
                  <tr key={t.id} className="border-t border-border/50"><td className="py-1">{new Date(t.createdAt).toLocaleString()}</td><td>{t.type}</td><td className="font-mono">{t.featureSlug ?? "—"}</td><td className="text-right tabular-nums">{t.creditsDelta}</td><td className="truncate max-w-xs">{t.description ?? "—"}</td></tr>
                ))}
                {data.recentTransactions.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No transactions.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="flex justify-end pt-3"><Button variant="outline" onClick={onClose}>Close</Button></div>
    </Modal>
  );
}
function WalletsSubTab() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const { data = [], isLoading } = useQuery<WalletRow[]>({ queryKey: ["admin-ai", "wallets", search], queryFn: () => apiFetch(`/admin/ai/wallets?search=${encodeURIComponent(search)}`) });
  return (
    <div className="bg-card border border-border rounded-xl">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <p className="font-semibold text-sm flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" />Tenant wallets <span className="text-xs text-muted-foreground">({data.length})</span></p>
        <div className="relative"><Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className={inputCls + " pl-7 w-64"} placeholder="Search tenants…" value={search} onChange={e => setSearch(e.target.value)} /></div>
      </div>
      {isLoading ? <div className="p-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div> : (
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs text-muted-foreground"><tr>
            <th className="px-3 py-2 text-left">Tenant</th><th className="px-3 py-2 text-right">Balance</th>
            <th className="px-3 py-2 text-right">Monthly</th><th className="px-3 py-2 text-right">Purchased</th>
            <th className="px-3 py-2 text-right">Bonus</th><th className="px-3 py-2 text-right">Used</th>
            <th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {data.map(w => (
              <tr key={w.tenantId} className="hover:bg-muted/20">
                <td className="px-3 py-2"><p className="font-medium">{w.tenantName}</p><p className="text-xs text-muted-foreground">#{w.tenantId}</p></td>
                <td className="px-3 py-2 text-right font-bold tabular-nums">{w.balance.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{w.monthlyBalance.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{w.purchasedBalance.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{w.bonusBalance.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{w.lifetimeCreditsUsed.toLocaleString()}</td>
                <td className="px-3 py-2">{w.isBlocked ? <Badge variant="destructive">Blocked</Badge> : <Badge>OK</Badge>}</td>
                <td className="px-3 py-2 text-right"><Button size="sm" variant="outline" onClick={() => setOpen(w.tenantId)} className="gap-1"><Wallet className="w-3 h-3" />Manage</Button></td>
              </tr>
            ))}
            {data.length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground text-xs">No tenants found.</td></tr>}
          </tbody>
        </table>
      )}
      {open !== null && <WalletDetailModal tenantId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ─── Ledger ──────────────────────────────────────────────────────────────────
function LedgerSubTab() {
  const [filter, setFilter] = useState({ tenantId: "", type: "", featureSlug: "" });
  const { data = [], isLoading } = useQuery<Array<{ id: number; tenantId: number; tenantName: string | null; createdAt: string; type: string; featureSlug: string | null; creditsDelta: string; pricePaid: string | null; description: string | null }>>({
    queryKey: ["admin-ai", "ledger", filter],
    queryFn: () => apiFetch(`/admin/ai/ledger?${new URLSearchParams(Object.fromEntries(Object.entries(filter).filter(([, v]) => v))).toString()}`),
  });
  return (
    <div className="bg-card border border-border rounded-xl">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <p className="font-semibold text-sm flex items-center gap-2"><ArrowDownToLine className="w-4 h-4 text-primary" />Credit ledger <span className="text-xs text-muted-foreground">({data.length})</span></p>
        <div className="flex gap-2">
          <input className={inputCls + " w-32"} placeholder="Tenant ID" value={filter.tenantId} onChange={e => setFilter({ ...filter, tenantId: e.target.value })} />
          <select className={inputCls + " w-36"} value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })}>
            <option value="">All types</option><option value="usage">Usage</option><option value="recharge">Recharge</option>
            <option value="monthly_allocation">Monthly</option><option value="adjustment">Adjustment</option><option value="refund">Refund</option>
          </select>
          <input className={inputCls + " w-40"} placeholder="Feature slug" value={filter.featureSlug} onChange={e => setFilter({ ...filter, featureSlug: e.target.value })} />
        </div>
      </div>
      {isLoading ? <div className="p-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div> : (
        <div className="overflow-x-auto max-h-[60vh]">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-muted-foreground sticky top-0"><tr>
              <th className="px-3 py-2 text-left">Time</th><th className="px-3 py-2 text-left">Tenant</th>
              <th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Feature</th>
              <th className="px-3 py-2 text-right">Credits</th><th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2 text-left">Note</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {data.map(t => (
                <tr key={t.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(t.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">{t.tenantName ?? `#${t.tenantId}`}</td>
                  <td className="px-3 py-2">{t.type}</td>
                  <td className="px-3 py-2 font-mono">{t.featureSlug ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.creditsDelta}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.pricePaid ?? "—"}</td>
                  <td className="px-3 py-2 truncate max-w-xs">{t.description ?? "—"}</td>
                </tr>
              ))}
              {data.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">No transactions.</td></tr>}
            </tbody>
          </table>
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
    { id: "credit-rules", label: "Credit Rules", icon: Coins },
    { id: "recharge-packages", label: "Recharge Packages", icon: Package },
    { id: "wallets", label: "Wallets", icon: Wallet },
    { id: "ledger", label: "Ledger", icon: ArrowDownToLine },
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
      {sub === "credit-rules" && <CreditRulesSubTab />}
      {sub === "recharge-packages" && <RechargePackagesSubTab />}
      {sub === "wallets" && <WalletsSubTab />}
      {sub === "ledger" && <LedgerSubTab />}
      {sub === "logs" && <LogsSubTab />}
      {sub === "costs" && <CostReportsSubTab />}
    </div>
  );
}
