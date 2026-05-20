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
  const [tab, setTab] = useState<"settings" | "templates" | "template_center" | "logs" | "usage" | "providers">("template_center");
  const TABS = [
    { k: "template_center", label: "Template Center" },
    { k: "settings", label: "Settings" },
    { k: "providers", label: "Communication providers" },
    { k: "templates", label: "Templates (synced)" },
    { k: "logs", label: "Logs" },
    { k: "usage", label: "Usage" },
  ] as const;
  return (
    <div className="space-y-4">
      <div className="border-b border-border flex gap-1">
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px ${tab === t.k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "settings" && <SettingsTab />}
      {tab === "providers" && <ProvidersTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "template_center" && <TemplateCenterTab />}
      {tab === "logs" && <LogsTab />}
      {tab === "usage" && <UsageTab />}
    </div>
  );
}

// ───────────────────────────── Template Center (Task #533) ──────────────────────────────
interface TplVar { index: number; key: string; label: string; example: string }
interface TplButton { type: "quick_reply" | "url"; text: string; url?: string }
interface TplRow {
  id: number; name: string; language: string; category: string | null; status: string;
  description: string | null; defaultForEvent: string | null;
  headerType: string; headerText: string | null; headerMediaUrl: string | null;
  bodyText: string | null; footerText: string | null;
  buttonsJson: TplButton[]; variablesJson: TplVar[]; sampleValuesJson: { header?: string[]; body?: string[] };
  allowRestaurantEdit: boolean; assignedPlansJson: string[]; assignedRestaurantsJson: number[];
  metaTemplateId: string | null; rejectionReason: string | null; lastSyncedAt: string | null; updatedAt: string;
}
interface VarRegistry { key: string; label: string; category: string; example: string; description?: string }
interface ComplianceIssue { code: string; severity: "error" | "warning" | "info"; message: string; field?: string }
interface VersionRow { id: number; versionNumber: number; status: string; bodyText: string | null; createdAt: string; changeNote: string | null }
interface DashStats { byStatus: Record<string, number>; recentLogs: Array<{ templateName: string | null; status: string; count: number }>; defaultCount: number }

const TPL_STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300",
  paused: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
};

function TemplateCenterTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [view, setView] = useState<"dashboard" | "list" | "editor" | "variables" | "submissions">("dashboard");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<{ status: string; category: string; q: string }>({ status: "", category: "", q: "" });

  const stats = useQuery<DashStats>({
    queryKey: ["wa-tpl-center-dash"],
    queryFn: () => apiFetch("/admin/whatsapp/template-center/dashboard"),
  });
  const variables = useQuery<{ data: VarRegistry[]; byCategory: Record<string, VarRegistry[]> }>({
    queryKey: ["wa-tpl-center-vars"],
    queryFn: () => apiFetch("/admin/whatsapp/template-center/variables"),
  });
  const list = useQuery<{ data: TplRow[]; total: number }>({
    queryKey: ["wa-tpl-center-list", filter],
    queryFn: () => apiFetch(`/admin/whatsapp/template-center/templates?${new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString()}`),
  });
  const submissions = useQuery<{ data: TplRow[]; byStatus: Record<string, number> }>({
    queryKey: ["wa-tpl-center-subs"],
    queryFn: () => apiFetch("/admin/whatsapp/template-center/submissions"),
    enabled: view === "submissions",
  });

  const seedDefaults = useMutation({
    mutationFn: () => apiAction("/admin/whatsapp/template-center/seed-defaults", "POST"),
    onSuccess: (out: { inserted: number; skipped: number; total: number }) => {
      toast({ title: "Seeded", description: `Inserted ${out.inserted}, skipped ${out.skipped}, total ${out.total}.` });
      qc.invalidateQueries({ queryKey: ["wa-tpl-center-list"] });
      qc.invalidateQueries({ queryKey: ["wa-tpl-center-dash"] });
    },
    onError: (e: Error) => toast({ title: "Seed failed", description: e.message, variant: "destructive" }),
  });
  const syncAll = useMutation({
    mutationFn: () => apiAction("/admin/whatsapp/template-center/sync-all", "POST"),
    onSuccess: () => { toast({ title: "Sync requested" }); qc.invalidateQueries({ queryKey: ["wa-tpl-center-list"] }); },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex gap-1">
          {(["dashboard", "list", "editor", "variables", "submissions"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 text-xs font-medium rounded ${view === v ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => seedDefaults.mutate()} disabled={seedDefaults.isPending}>
            <Download className="w-3.5 h-3.5 mr-1" /> Seed defaults
          </Button>
          <Button size="sm" variant="outline" onClick={() => syncAll.mutate()} disabled={syncAll.isPending}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" /> Sync with Meta
          </Button>
        </div>
      </div>

      {view === "dashboard" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {Object.entries(stats.data?.byStatus ?? {}).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{k}</p>
              <p className="text-2xl font-semibold tabular-nums">{v}</p>
            </div>
          ))}
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Default library</p>
            <p className="text-2xl font-semibold tabular-nums">{stats.data?.defaultCount ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">Click Seed defaults to import.</p>
          </div>
          <div className="md:col-span-3 rounded-lg border border-border p-4">
            <p className="text-sm font-semibold mb-2">Recent sends (30 days)</p>
            <div className="space-y-1 text-xs">
              {(stats.data?.recentLogs ?? []).slice(0, 15).map((r, i) => (
                <div key={i} className="flex justify-between border-b border-border/50 py-1">
                  <span>{r.templateName ?? "—"}</span>
                  <span className="text-muted-foreground">{r.status}</span>
                  <span className="tabular-nums">{r.count}</span>
                </div>
              ))}
              {(stats.data?.recentLogs ?? []).length === 0 && <p className="text-muted-foreground">No sends yet.</p>}
            </div>
          </div>
        </div>
      )}

      {view === "list" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Input placeholder="Search…" value={filter.q} onChange={e => setFilter(f => ({ ...f, q: e.target.value }))} className="max-w-xs" />
            <select className="text-sm border border-border rounded px-2 py-1.5 bg-background" value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
              <option value="">All statuses</option>
              {["draft", "pending", "approved", "rejected", "paused"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="text-sm border border-border rounded px-2 py-1.5 bg-background" value={filter.category} onChange={e => setFilter(f => ({ ...f, category: e.target.value }))}>
              <option value="">All categories</option>
              {["UTILITY", "MARKETING", "AUTHENTICATION"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <Button size="sm" onClick={() => { setSelectedId(null); setView("editor"); }}>New template</Button>
          </div>
          <div className="overflow-x-auto border border-border rounded">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr className="text-left text-xs uppercase tracking-wider">
                  <th className="px-3 py-2">Name</th><th className="px-3 py-2">Lang</th><th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Status</th><th className="px-3 py-2">Event</th><th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {(list.data?.data ?? []).map(t => (
                  <tr key={t.id} className="border-t border-border hover:bg-muted/40 cursor-pointer"
                    onClick={() => { setSelectedId(t.id); setView("editor"); }}>
                    <td className="px-3 py-2 font-medium">{t.name}{t.allowRestaurantEdit && <Badge variant="outline" className="ml-2 text-[10px]">editable</Badge>}</td>
                    <td className="px-3 py-2">{t.language}</td>
                    <td className="px-3 py-2">{t.category}</td>
                    <td className="px-3 py-2"><Badge className={TPL_STATUS_STYLES[t.status] ?? ""}>{t.status}</Badge></td>
                    <td className="px-3 py-2 text-muted-foreground">{t.defaultForEvent ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">{new Date(t.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
                {(list.data?.data ?? []).length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No templates yet. Click "Seed defaults" to load the starter library.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "editor" && (
        <TemplateEditor templateId={selectedId} variables={variables.data?.data ?? []}
          onSaved={(id) => { setSelectedId(id); qc.invalidateQueries({ queryKey: ["wa-tpl-center-list"] }); }}
          onDeleted={() => { setSelectedId(null); setView("list"); qc.invalidateQueries({ queryKey: ["wa-tpl-center-list"] }); }} />
      )}

      {view === "variables" && (
        <div className="space-y-3">
          {Object.entries(variables.data?.byCategory ?? {}).map(([cat, vs]) => (
            <div key={cat} className="border border-border rounded">
              <div className="px-3 py-2 bg-muted text-xs uppercase tracking-wider">{cat}</div>
              <table className="w-full text-xs">
                <tbody>
                  {vs.map(v => (
                    <tr key={v.key} className="border-t border-border">
                      <td className="px-3 py-1.5 font-mono">{`{{${v.key}}}`}</td>
                      <td className="px-3 py-1.5">{v.label}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{v.example}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {view === "submissions" && (
        <div className="space-y-3">
          <div className="flex gap-4 text-xs">
            {Object.entries(submissions.data?.byStatus ?? {}).map(([k, v]) => (
              <div key={k}><span className="text-muted-foreground">{k}:</span> <strong className="tabular-nums">{v}</strong></div>
            ))}
          </div>
          <div className="overflow-x-auto border border-border rounded">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wider"><tr>
                <th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-left">Reason</th><th className="px-3 py-2">Last sync</th>
              </tr></thead>
              <tbody>
                {(submissions.data?.data ?? []).map(r => (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/40 cursor-pointer"
                    onClick={() => { setSelectedId(r.id); setView("editor"); }}>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-center"><Badge className={TPL_STATUS_STYLES[r.status] ?? ""}>{r.status}</Badge></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.rejectionReason ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-center text-muted-foreground">{r.lastSyncedAt ? new Date(r.lastSyncedAt).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateEditor({ templateId, variables, onSaved, onDeleted }:
  { templateId: number | null; variables: VarRegistry[]; onSaved: (id: number) => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const detail = useQuery<{ data: TplRow; compliance: { issues: ComplianceIssue[]; summary: { canSubmit: boolean; errors: number; warnings: number } } }>({
    queryKey: ["wa-tpl-center-detail", templateId],
    queryFn: () => apiFetch(`/admin/whatsapp/template-center/templates/${templateId}`),
    enabled: !!templateId,
  });
  const versions = useQuery<{ data: VersionRow[] }>({
    queryKey: ["wa-tpl-center-versions", templateId],
    queryFn: () => apiFetch(`/admin/whatsapp/template-center/templates/${templateId}/versions`),
    enabled: !!templateId,
  });

  const [form, setForm] = useState<Partial<TplRow>>({
    name: "", language: "en", category: "UTILITY", description: "",
    headerType: "none", headerText: "", headerMediaUrl: "",
    bodyText: "", footerText: "", buttonsJson: [], variablesJson: [], sampleValuesJson: {},
    allowRestaurantEdit: false, assignedPlansJson: [], assignedRestaurantsJson: [],
    defaultForEvent: "",
  });
  const [testTo, setTestTo] = useState("");
  const [hydratedFor, setHydratedFor] = useState<number | null>(null);

  if (detail.data && templateId && hydratedFor !== templateId) {
    setForm({ ...detail.data.data });
    setHydratedFor(templateId);
  }

  const save = useMutation({
    mutationFn: () => templateId
      ? apiAction(`/admin/whatsapp/template-center/templates/${templateId}`, "PUT", form)
      : apiAction(`/admin/whatsapp/template-center/templates`, "POST", form),
    onSuccess: (res: { data: TplRow }) => {
      toast({ title: "Saved" });
      onSaved(res.data.id);
      qc.invalidateQueries({ queryKey: ["wa-tpl-center-detail", res.data.id] });
      qc.invalidateQueries({ queryKey: ["wa-tpl-center-versions", res.data.id] });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
  const submit = useMutation({
    mutationFn: () => apiAction(`/admin/whatsapp/template-center/templates/${templateId}/submit`, "POST"),
    onSuccess: () => { toast({ title: "Submitted to Meta" }); qc.invalidateQueries({ queryKey: ["wa-tpl-center-detail", templateId] }); },
    onError: (e: Error) => toast({ title: "Submit failed", description: e.message, variant: "destructive" }),
  });
  const sync = useMutation({
    mutationFn: () => apiAction(`/admin/whatsapp/template-center/templates/${templateId}/sync-status`, "POST"),
    onSuccess: () => { toast({ title: "Status synced" }); qc.invalidateQueries({ queryKey: ["wa-tpl-center-detail", templateId] }); },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: () => apiAction(`/admin/whatsapp/template-center/templates/${templateId}`, "DELETE"),
    onSuccess: () => { toast({ title: "Deleted" }); onDeleted(); },
  });
  const testSend = useMutation({
    mutationFn: () => apiAction(`/admin/whatsapp/template-center/templates/${templateId}/test-send`, "POST", { to: testTo, values: {} }),
    onSuccess: () => toast({ title: "Test sent" }),
    onError: (e: Error) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });
  const rollback = useMutation({
    mutationFn: (vid: number) => apiAction(`/admin/whatsapp/template-center/templates/${templateId}/rollback/${vid}`, "POST"),
    onSuccess: () => { toast({ title: "Rolled back" }); setHydratedFor(null); qc.invalidateQueries({ queryKey: ["wa-tpl-center-detail", templateId] }); },
  });

  const insertVar = (key: string) => {
    setForm(f => ({ ...f, bodyText: (f.bodyText ?? "") + `{{${key}}}` }));
  };
  const checkLocal = useQuery<{ issues: ComplianceIssue[]; summary: { canSubmit: boolean; errors: number; warnings: number } }>({
    queryKey: ["wa-tpl-center-check", form.bodyText, form.headerText, form.footerText, form.category],
    queryFn: () => apiAction("/admin/whatsapp/template-center/check", "POST", form),
    enabled: !!form.bodyText,
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name"><Input value={form.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. khana_order_ready" /></Field>
          <Field label="Language"><Input value={form.language ?? "en"} onChange={e => setForm(f => ({ ...f, language: e.target.value }))} /></Field>
          <Field label="Category">
            <select className="text-sm border border-border rounded px-2 py-1.5 bg-background w-full" value={form.category ?? "UTILITY"} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {["UTILITY", "MARKETING", "AUTHENTICATION"].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Default for event"><Input value={form.defaultForEvent ?? ""} onChange={e => setForm(f => ({ ...f, defaultForEvent: e.target.value }))} placeholder="order.confirmed" /></Field>
        </div>
        <Field label="Description"><Input value={form.description ?? ""} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></Field>

        <div className="grid grid-cols-3 gap-2 items-end">
          <Field label="Header type">
            <select className="text-sm border border-border rounded px-2 py-1.5 bg-background w-full" value={form.headerType ?? "none"} onChange={e => setForm(f => ({ ...f, headerType: e.target.value }))}>
              {["none", "text", "image", "video", "document"].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          {form.headerType === "text" && <Field label="Header text"><Input value={form.headerText ?? ""} onChange={e => setForm(f => ({ ...f, headerText: e.target.value }))} /></Field>}
          {form.headerType && form.headerType !== "none" && form.headerType !== "text" && <Field label="Header media URL"><Input value={form.headerMediaUrl ?? ""} onChange={e => setForm(f => ({ ...f, headerMediaUrl: e.target.value }))} /></Field>}
        </div>

        <Field label="Body">
          <textarea className="w-full min-h-[180px] border border-border rounded p-2 text-sm font-mono bg-background"
            value={form.bodyText ?? ""} onChange={e => setForm(f => ({ ...f, bodyText: e.target.value }))}
            placeholder="Hi {{customer_first_name}}, your order #{{order_number}} is ready." />
        </Field>
        <Field label="Footer"><Input value={form.footerText ?? ""} onChange={e => setForm(f => ({ ...f, footerText: e.target.value }))} /></Field>

        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Insert variable</p>
          <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
            {variables.map(v => (
              <button key={v.key} onClick={() => insertVar(v.key)}
                className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/70 font-mono">{`{{${v.key}}}`}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}><Save className="w-3.5 h-3.5 mr-1" /> Save</Button>
          {templateId && (
            <>
              <Button size="sm" variant="outline" onClick={() => submit.mutate()} disabled={submit.isPending || !checkLocal.data?.summary.canSubmit}>
                <Send className="w-3.5 h-3.5 mr-1" /> Submit to Meta
              </Button>
              <Button size="sm" variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Sync status
              </Button>
              <div className="flex gap-1 items-center">
                <Input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="+91…" className="h-8 w-40" />
                <Button size="sm" variant="outline" onClick={() => testSend.mutate()} disabled={!testTo || testSend.isPending}>
                  Test send
                </Button>
              </div>
              <Button size="sm" variant="ghost" className="ml-auto text-red-600" onClick={() => { if (confirm("Delete this template?")) del.mutate(); }}>Delete</Button>
            </>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="border border-border rounded p-3 bg-muted/30">
          <p className="text-xs font-semibold uppercase tracking-wider mb-2">Preview</p>
          {form.headerType === "text" && form.headerText && <p className="text-sm font-semibold mb-1">{form.headerText}</p>}
          <p className="text-sm whitespace-pre-wrap">{form.bodyText}</p>
          {form.footerText && <p className="text-xs text-muted-foreground mt-2">{form.footerText}</p>}
        </div>
        <div className="border border-border rounded p-3">
          <p className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center justify-between">
            Compliance
            {checkLocal.data && (
              <Badge className={checkLocal.data.summary.canSubmit ? "bg-emerald-500/15 text-emerald-700" : "bg-red-500/15 text-red-700"}>
                {checkLocal.data.summary.canSubmit ? "Pass" : `${checkLocal.data.summary.errors} errors`}
              </Badge>
            )}
          </p>
          {(checkLocal.data?.issues ?? []).slice(0, 8).map((i, idx) => (
            <div key={idx} className={`text-xs py-1 ${i.severity === "error" ? "text-red-600" : i.severity === "warning" ? "text-amber-600" : "text-muted-foreground"}`}>
              <strong>{i.severity}</strong>: {i.message}
            </div>
          ))}
          {detail.data?.data.rejectionReason && (
            <p className="mt-2 text-xs text-red-600 border-t border-border pt-2"><strong>Meta:</strong> {detail.data.data.rejectionReason}</p>
          )}
        </div>
        <div className="border border-border rounded p-3">
          <p className="text-xs font-semibold uppercase tracking-wider mb-2">Versions</p>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {(versions.data?.data ?? []).map(v => (
              <div key={v.id} className="flex items-center justify-between text-xs border-b border-border/50 py-1">
                <span>v{v.versionNumber} · <span className="text-muted-foreground">{v.changeNote ?? ""}</span></span>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => rollback.mutate(v.id)}>
                  <Repeat className="w-3 h-3 mr-1" /> Restore
                </Button>
              </div>
            ))}
            {(versions.data?.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">No versions yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

interface WebQrConfig {
  globalEnabled: boolean;
  allowedPlans: string[];
  plans: Array<{ id: number; slug: string; name: string; webQrEnabled: boolean; webQrDailyCap: number; webQrMonthlyCap: number; webQrMaxSessions: number }>;
  libraryAvailable: boolean;
  replitDevWarning: string | null;
}
interface WebQrSession {
  id: number; restaurantId: number; restaurantName: string | null; tenantId: number | null; tenantName: string | null;
  status: string; phone: string | null; profileName: string | null;
  lastConnectedAt: string | null; lastDisconnectedAt: string | null; lastHeartbeatAt: string | null; lastError: string | null; live: boolean;
}
interface WebQrUsage {
  period: { year: number; month: number };
  summary: Record<string, { sent: number; failed: number; blocked: number; total: number }>;
}

function ProvidersTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const cfg = useQuery<WebQrConfig>({ queryKey: ["admin", "wa", "web-qr", "config"], queryFn: () => apiFetch("/admin/whatsapp/web-qr/config") });
  const sessions = useQuery<{ data: WebQrSession[] }>({ queryKey: ["admin", "wa", "web-qr", "sessions"], queryFn: () => apiFetch("/admin/whatsapp/web-qr/sessions"), refetchInterval: 10000 });
  const usage = useQuery<WebQrUsage>({ queryKey: ["admin", "wa", "web-qr", "usage"], queryFn: () => apiFetch("/admin/whatsapp/web-qr/usage") });

  const saveCfg = useMutation({
    mutationFn: (body: Partial<{ globalEnabled: boolean; allowedPlans: string[] }>) => apiAction("/admin/whatsapp/web-qr/config", "PATCH", body),
    onSuccess: () => { toast({ title: "Updated" }); qc.invalidateQueries({ queryKey: ["admin", "wa", "web-qr", "config"] }); },
    onError: e => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  const savePlan = useMutation({
    mutationFn: ({ planId, ...body }: { planId: number } & Record<string, unknown>) => apiAction(`/admin/whatsapp/web-qr/plans/${planId}`, "PATCH", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "wa", "web-qr", "config"] }); },
    onError: e => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  const kick = useMutation({
    mutationFn: (id: number) => apiAction(`/admin/whatsapp/web-qr/sessions/${id}/disconnect`, "POST"),
    onSuccess: () => { toast({ title: "Disconnected" }); qc.invalidateQueries({ queryKey: ["admin", "wa", "web-qr", "sessions"] }); },
    onError: e => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });

  if (cfg.isLoading || !cfg.data) return <div className="text-sm text-muted-foreground p-6">Loading…</div>;
  const c = cfg.data;

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-semibold text-sm">WhatsApp Web QR (Baileys)</h3>
            <p className="text-xs text-muted-foreground">Global switch for the experimental QR-pairing provider. Restaurants can only enable it if their plan allows it and the library is installed.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={c.globalEnabled} onChange={e => saveCfg.mutate({ globalEnabled: e.target.checked })} />
            <span>{c.globalEnabled ? "Globally enabled" : "Globally disabled"}</span>
          </label>
        </div>
        {!c.libraryAvailable && (
          <div className="bg-red-500/10 border border-red-500/40 text-red-800 dark:text-red-200 rounded-lg p-3 text-xs">
            <strong>Library not installed.</strong> The <code>@whiskeysockets/baileys</code> package is missing on the server. Install it and restart the API to enable Web QR.
          </div>
        )}
        {c.replitDevWarning && (
          <div className="bg-amber-500/10 border border-amber-500/40 text-amber-800 dark:text-amber-200 rounded-lg p-3 text-xs">{c.replitDevWarning}</div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-sm">Per-plan Web QR limits</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b border-border">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Plan</th>
              <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">Enabled</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Daily cap</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Monthly cap</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Max sessions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {c.plans.map(p => (
              <tr key={p.id} className="hover:bg-muted/20">
                <td className="px-3 py-2 text-sm">{p.name} <span className="text-[11px] text-muted-foreground">({p.slug})</span></td>
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" defaultChecked={p.webQrEnabled} onChange={e => savePlan.mutate({ planId: p.id, webQrEnabled: e.target.checked })} />
                </td>
                <td className="px-3 py-2"><input type="number" min={0} defaultValue={p.webQrDailyCap} className="text-xs border border-border rounded px-2 py-1 bg-background w-24" onBlur={e => { const v = Number(e.target.value); if (v !== p.webQrDailyCap) savePlan.mutate({ planId: p.id, webQrDailyCap: v }); }} /></td>
                <td className="px-3 py-2"><input type="number" min={0} defaultValue={p.webQrMonthlyCap} className="text-xs border border-border rounded px-2 py-1 bg-background w-24" onBlur={e => { const v = Number(e.target.value); if (v !== p.webQrMonthlyCap) savePlan.mutate({ planId: p.id, webQrMonthlyCap: v }); }} /></td>
                <td className="px-3 py-2"><input type="number" min={0} defaultValue={p.webQrMaxSessions} className="text-xs border border-border rounded px-2 py-1 bg-background w-24" onBlur={e => { const v = Number(e.target.value); if (v !== p.webQrMaxSessions) savePlan.mutate({ planId: p.id, webQrMaxSessions: v }); }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Active Web QR sessions</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">Live = currently held by this API process. Sessions are restored on restart.</p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b border-border">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Restaurant</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Tenant</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Phone</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Last heartbeat</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(sessions.data?.data ?? []).map(s => (
              <tr key={s.id} className="hover:bg-muted/20">
                <td className="px-3 py-2 text-sm">{s.restaurantName ?? `#${s.restaurantId}`}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{s.tenantName ?? "—"}</td>
                <td className="px-3 py-2 text-xs">
                  <span className={`px-1.5 py-0.5 rounded ${s.status === "connected" ? "bg-green-500/15 text-green-700 dark:text-green-300" : "bg-muted text-muted-foreground"}`}>{s.status}</span>
                  {s.live && <span className="ml-1.5 text-[10px] text-green-700 dark:text-green-300">● live</span>}
                </td>
                <td className="px-3 py-2 text-xs">{s.phone ?? "—"}{s.profileName ? <span className="text-muted-foreground"> · {s.profileName}</span> : null}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{s.lastHeartbeatAt ? new Date(s.lastHeartbeatAt).toLocaleString() : "—"}</td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => kick.mutate(s.id)} disabled={kick.isPending}>Force disconnect</Button>
                </td>
              </tr>
            ))}
            {(sessions.data?.data ?? []).length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground text-sm">No Web QR sessions yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <h3 className="font-semibold text-sm">Sends by provider — {usage.data?.period ? `${usage.data.period.year}-${String(usage.data.period.month).padStart(2, "0")}` : "this month"}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(["cloud_api", "web_qr"] as const).map(p => {
            const s = usage.data?.summary?.[p] ?? { sent: 0, failed: 0, blocked: 0, total: 0 };
            return (
              <div key={p} className="border border-border rounded-lg p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{p === "cloud_api" ? "Cloud API" : "Web QR"}</p>
                <p className="text-2xl font-semibold tabular-nums">{s.sent}</p>
                <p className="text-[11px] text-muted-foreground">delivered · {s.failed} failed · {s.blocked} blocked · {s.total} total</p>
              </div>
            );
          })}
        </div>
      </div>
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
