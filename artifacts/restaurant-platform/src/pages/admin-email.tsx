import { useMemo, useState } from "react";
import {
  Mail, Plus, Pencil, Trash2, Star, Send, RotateCcw, X, CheckCircle2, AlertTriangle, Eye, FileText, Server,
  GitBranch, Zap, Sparkles, Ban, BarChart3, Tag, Megaphone as MegaphoneIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  type AdminEmailProvider, type AdminEmailTemplate, type AdminEmailLog, type EmailDriver, type EmailLogStatus,
  useAdminEmailProviders, useCreateAdminEmailProvider, useUpdateAdminEmailProvider,
  useDeleteAdminEmailProvider, useSetDefaultAdminEmailProvider, useTestAdminEmailProvider,
  useAdminEmailTemplates, useCreateAdminEmailTemplate, useUpdateAdminEmailTemplate,
  useDeleteAdminEmailTemplate, usePreviewAdminEmailTemplate, useTestAdminEmailTemplate,
  useAdminEmailLogs, useRetryAdminEmailLog, useBulkRetryAdminEmailLogs,
  useSendAdminEmailAnnouncement,
  type AdminEmailLogFilters,
  useAdminEmailSequences, useCreateAdminEmailSequence, useUpdateAdminEmailSequence, useDeleteAdminEmailSequence,
  useAdminEmailSequence, useAddAdminEmailSequenceStep, useDeleteAdminEmailSequenceStep, useRunAdminEmailSequenceTick,
  useAdminEmailAutomations, useCreateAdminEmailAutomation, useUpdateAdminEmailAutomation, useDeleteAdminEmailAutomation,
  useAdminEmailMarketingTemplates, useCreateAdminEmailMarketingTemplate, useUpdateAdminEmailMarketingTemplate, useDeleteAdminEmailMarketingTemplate,
  useAdminEmailSuppressions, useCreateAdminEmailSuppression, useDeleteAdminEmailSuppression,
  useAdminEmailUnsubscribes,
  useAdminEmailVariables,
  useGenerateAdminEmailAi,
  useAdminEmailDashboard, useAdminEmailPerTenantReport,
  useAdminEmailCampaigns, useAdminEmailCampaignAnalytics,
  type EmailSequenceRow, type EmailAutomationRow, type EmailMarketingTemplateRow, type EmailSuppressionRow,
} from "@/lib/hooks";
import { Megaphone } from "lucide-react";

const DRIVER_LABEL: Record<EmailDriver, string> = {
  smtp: "SMTP", sendgrid: "SendGrid", mailgun: "Mailgun", ses: "Amazon SES", resend: "Resend", postmark: "Postmark", custom: "Custom HTTP",
};

const STATUS_BADGE: Record<EmailLogStatus, string> = {
  queued: "bg-amber-500/15 text-amber-700",
  sent: "bg-emerald-500/15 text-emerald-700",
  delivered: "bg-emerald-500/20 text-emerald-700",
  bounced: "bg-orange-500/15 text-orange-700",
  failed: "bg-red-500/15 text-red-700",
};

type EmailTab = "dashboard" | "providers" | "templates" | "marketing" | "sequences" | "automations" | "campaigns" | "suppressions" | "variables" | "reports" | "logs";

export default function AdminEmail() {
  const [tab, setTab] = useState<EmailTab>("dashboard");
  return (
    <div className="space-y-4">
      <div className="border-b border-border flex gap-1 overflow-x-auto">
        {[
          { id: "dashboard" as const, label: "Dashboard", icon: BarChart3 },
          { id: "providers" as const, label: "Providers", icon: Server },
          { id: "templates" as const, label: "Templates", icon: FileText },
          { id: "marketing" as const, label: "Marketing Library", icon: MegaphoneIcon },
          { id: "sequences" as const, label: "Sequences", icon: GitBranch },
          { id: "automations" as const, label: "Automations", icon: Zap },
          { id: "campaigns" as const, label: "Campaigns", icon: MegaphoneIcon },
          { id: "suppressions" as const, label: "Suppressions", icon: Ban },
          { id: "variables" as const, label: "Variables", icon: Tag },
          { id: "reports" as const, label: "Reports", icon: BarChart3 },
          { id: "logs" as const, label: "Logs", icon: Mail },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 whitespace-nowrap ${
              tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>
      {tab === "dashboard" && <DashboardTab />}
      {tab === "providers" && <ProvidersTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "marketing" && <MarketingLibraryTab />}
      {tab === "sequences" && <SequencesTab />}
      {tab === "automations" && <AutomationsTab />}
      {tab === "campaigns" && <CampaignsTab />}
      {tab === "suppressions" && <SuppressionsTab />}
      {tab === "variables" && <VariablesTab />}
      {tab === "reports" && <ReportsTab />}
      {tab === "logs" && <LogsTab />}
    </div>
  );
}

// ─── Dashboard ─────────────────────────────────────────────────
function DashboardTab() {
  const { data, isLoading } = useAdminEmailDashboard();
  if (isLoading || !data) return <div className="p-8 text-center text-muted-foreground text-sm">Loading dashboard…</div>;
  const c = data.counts;
  const cards: Array<{ label: string; value: number; tone?: string }> = [
    { label: "Sent (30d)", value: c.sent30 },
    { label: "Failed", value: c.failed30, tone: "text-red-700" },
    { label: "Opened", value: c.opens30, tone: "text-blue-700" },
    { label: "Clicked", value: c.clicks30, tone: "text-violet-700" },
    { label: "Unsubscribed", value: c.unsubs30, tone: "text-amber-700" },
    { label: "Active sequences", value: c.activeSequences },
    { label: "Active automations", value: c.activeAutomations },
    { label: "Enrollments", value: c.enrollments },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map(card => (
          <div key={card.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className={`text-2xl font-semibold ${card.tone ?? "text-foreground"}`}>{card.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-sm font-medium mb-3">Top templates (30d)</p>
        {data.topTemplates.length === 0 ? <p className="text-xs text-muted-foreground">No sends yet.</p> :
          <ul className="space-y-2 text-sm">
            {data.topTemplates.map(t => (
              <li key={t.templateKey ?? "(none)"} className="flex justify-between"><span className="font-mono text-xs">{t.templateKey ?? "(none)"}</span><Badge variant="outline">{t.sent} sent · {t.opened} opened</Badge></li>
            ))}
          </ul>}
      </div>
    </div>
  );
}

// ─── Marketing Library ─────────────────────────────────────────
function MarketingLibraryTab() {
  const { data } = useAdminEmailMarketingTemplates();
  const create = useCreateAdminEmailMarketingTemplate();
  const update = useUpdateAdminEmailMarketingTemplate();
  const del = useDeleteAdminEmailMarketingTemplate();
  const [editing, setEditing] = useState<EmailMarketingTemplateRow | "new" | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const { toast } = useToast();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Global marketing email library. Restaurants pick from these when authoring campaigns.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setAiOpen(true)} className="gap-2"><Sparkles className="w-4 h-4" />AI compose</Button>
          <Button size="sm" onClick={() => setEditing("new")} className="gap-2"><Plus className="w-4 h-4" />New</Button>
        </div>
      </div>
      <div className="grid gap-3">
        {(data?.data ?? []).map(t => (
          <div key={t.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium">{t.name}</p>
                <Badge variant="outline">{t.category}</Badge>
                {t.isAiGenerated && <Badge className="bg-violet-500/10 text-violet-700 border-violet-500/20">AI</Badge>}
                {t.isHidden && <Badge variant="secondary">Hidden</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-1 truncate">{t.subject}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setEditing(t)}><Pencil className="w-4 h-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: t.id, isHidden: !t.isHidden })}>{t.isHidden ? "Show" : "Hide"}</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (confirm("Delete?")) del.mutate(t.id); }}><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
        {(data?.data ?? []).length === 0 && <div className="bg-muted/30 border border-dashed rounded-xl p-8 text-center text-sm text-muted-foreground">No marketing templates yet.</div>}
      </div>
      {editing && <MarketingTemplateEditor row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={async (b) => {
        if (editing === "new") await create.mutateAsync(b); else await update.mutateAsync({ id: editing.id, ...b });
        setEditing(null); toast({ title: "Saved" });
      }} />}
      {aiOpen && <AiComposeDialog onClose={() => setAiOpen(false)} onAccept={(r) => { setAiOpen(false); setEditing({ id: 0, key: "", name: r.subject.slice(0, 30), category: "general", subject: r.subject, preheader: r.preheader, body: r.body, ctaLabel: r.ctaLabel ?? null, ctaUrl: null, brandColor: "#f97316", businessTypes: [], planRestrictions: [], isGlobal: true, isHidden: false, isAiGenerated: true, createdAt: "", updatedAt: "" } as EmailMarketingTemplateRow); }} />}
    </div>
  );
}

function MarketingTemplateEditor({ row, onClose, onSave }: { row: EmailMarketingTemplateRow | null; onClose: () => void; onSave: (b: Partial<EmailMarketingTemplateRow>) => Promise<void> }) {
  const [name, setName] = useState(row?.name ?? "");
  const [key, setKey] = useState(row?.key ?? "");
  const [category, setCategory] = useState(row?.category ?? "general");
  const [subject, setSubject] = useState(row?.subject ?? "");
  const [preheader, setPreheader] = useState(row?.preheader ?? "");
  const [body, setBody] = useState(row?.body ?? "");
  const [ctaLabel, setCtaLabel] = useState(row?.ctaLabel ?? "");
  const [ctaUrl, setCtaUrl] = useState(row?.ctaUrl ?? "");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{row?.id ? "Edit" : "New"} marketing template</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Row2><Field label="Name"><Input value={name} onChange={e => setName(e.target.value)} /></Field><Field label="Key"><Input value={key} onChange={e => setKey(e.target.value)} /></Field></Row2>
          <Field label="Category">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["birthday","anniversary","weekend","festival","new_item","win_back","loyalty","feedback","review","membership","tiffin","catering","general"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Subject"><Input value={subject} onChange={e => setSubject(e.target.value)} /></Field>
          <Field label="Preheader"><Input value={preheader} onChange={e => setPreheader(e.target.value)} /></Field>
          <Field label="Body (HTML)"><Textarea rows={8} value={body} onChange={e => setBody(e.target.value)} /></Field>
          <Row2><Field label="CTA label"><Input value={ctaLabel ?? ""} onChange={e => setCtaLabel(e.target.value)} /></Field><Field label="CTA URL"><Input value={ctaUrl ?? ""} onChange={e => setCtaUrl(e.target.value)} /></Field></Row2>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave({ name, key: key || name.toLowerCase().replace(/[^a-z0-9]+/g, "_"), category, subject, preheader, body, ctaLabel: ctaLabel || null, ctaUrl: ctaUrl || null })}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AiComposeDialog({ onClose, onAccept }: { onClose: () => void; onAccept: (r: { subject: string; preheader: string; body: string; ctaLabel?: string }) => void }) {
  const gen = useGenerateAdminEmailAi();
  const [goal, setGoal] = useState("");
  const [tone, setTone] = useState("friendly");
  const [audience, setAudience] = useState("returning customers");
  const [result, setResult] = useState<{ subject: string; preheader: string; body: string; ctaLabel?: string } | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>AI email composer</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Goal"><Textarea rows={3} value={goal} placeholder="e.g. Promote our weekend brunch menu" onChange={e => setGoal(e.target.value)} /></Field>
          <Row2><Field label="Tone"><Input value={tone} onChange={e => setTone(e.target.value)} /></Field><Field label="Audience"><Input value={audience} onChange={e => setAudience(e.target.value)} /></Field></Row2>
          <Button onClick={async () => { const r = await gen.mutateAsync({ action: "compose", prompt: goal, tone, audience }); setResult({ subject: r.subject, preheader: r.preheader, body: r.body }); }} disabled={!goal || gen.isPending}><Sparkles className="w-4 h-4 mr-2" />{gen.isPending ? "Generating…" : "Generate"}</Button>
          {result && (<div className="border border-border rounded-lg p-3 text-sm space-y-2 bg-muted/30">
            <p><span className="font-semibold">Subject:</span> {result.subject}</p>
            <p className="text-xs text-muted-foreground">{result.preheader}</p>
            <div className="text-xs whitespace-pre-wrap font-mono max-h-48 overflow-auto">{result.body}</div>
          </div>)}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {result && <Button onClick={() => onAccept(result)}>Use this</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sequences ─────────────────────────────────────────────────
function SequencesTab() {
  const { data } = useAdminEmailSequences();
  const create = useCreateAdminEmailSequence();
  const update = useUpdateAdminEmailSequence();
  const del = useDeleteAdminEmailSequence();
  const tick = useRunAdminEmailSequenceTick();
  const [editing, setEditing] = useState<EmailSequenceRow | "new" | null>(null);
  const [stepsFor, setStepsFor] = useState<number | null>(null);
  const { toast } = useToast();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Multi-step lifecycle sequences (e.g. signup welcome, demo follow-up, trial nudge).</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => tick.mutate(undefined, { onSuccess: () => toast({ title: "Tick triggered" }) })}><RotateCcw className="w-4 h-4 mr-2" />Run tick</Button>
          <Button size="sm" onClick={() => setEditing("new")}><Plus className="w-4 h-4 mr-2" />New sequence</Button>
        </div>
      </div>
      <div className="grid gap-3">
        {(data?.data ?? []).map(s => (
          <div key={s.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium">{s.name}</p>
                <Badge variant="outline">{s.trigger}</Badge>
                {!s.isEnabled && <Badge variant="secondary">Paused</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
            </div>
            <Switch checked={s.isEnabled} onCheckedChange={(v) => update.mutate({ id: s.id, isEnabled: v })} />
            <Button size="sm" variant="ghost" onClick={() => setStepsFor(s.id)}>Steps</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(s)}><Pencil className="w-4 h-4" /></Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (confirm("Delete?")) del.mutate(s.id); }}><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
        {(data?.data ?? []).length === 0 && <div className="bg-muted/30 border border-dashed rounded-xl p-8 text-center text-sm text-muted-foreground">No sequences yet.</div>}
      </div>
      {editing && <SequenceEditor row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={async (b) => {
        if (editing === "new") await create.mutateAsync(b); else await update.mutateAsync({ id: editing.id, ...b });
        setEditing(null); toast({ title: "Saved" });
      }} />}
      {stepsFor && <SequenceStepsDialog id={stepsFor} onClose={() => setStepsFor(null)} />}
    </div>
  );
}

function SequenceEditor({ row, onClose, onSave }: { row: EmailSequenceRow | null; onClose: () => void; onSave: (b: Partial<EmailSequenceRow>) => Promise<void> }) {
  const [name, setName] = useState(row?.name ?? "");
  const [key, setKey] = useState(row?.key ?? "");
  const [trigger, setTrigger] = useState(row?.trigger ?? "manual");
  const [description, setDescription] = useState(row?.description ?? "");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{row ? "Edit" : "New"} sequence</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Row2><Field label="Name"><Input value={name} onChange={e => setName(e.target.value)} /></Field><Field label="Key"><Input value={key} onChange={e => setKey(e.target.value)} /></Field></Row2>
          <Field label="Trigger">
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["signup","demo_lead_created","trial_started","payment_failed","inactive_restaurant","manual"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Description"><Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} /></Field>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => onSave({ name, key: key || name.toLowerCase().replace(/[^a-z0-9]+/g, "_"), trigger, description })}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SequenceStepsDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const { data } = useAdminEmailSequence(id);
  const addStep = useAddAdminEmailSequenceStep();
  const delStep = useDeleteAdminEmailSequenceStep();
  const [templateKey, setTemplateKey] = useState("");
  const [delayHours, setDelayHours] = useState(24);
  const [label, setLabel] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Steps for {data?.data.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {(data?.data.steps ?? []).map((step) => (
            <div key={step.id} className="border border-border rounded-lg p-3 flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium">#{step.position + 1} {step.label || step.templateKey}</p>
                <p className="text-xs text-muted-foreground">After {step.delayHours}h · template <code className="font-mono">{step.templateKey}</code></p>
              </div>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => delStep.mutate(step.id)}><Trash2 className="w-4 h-4" /></Button>
            </div>
          ))}
          <div className="border border-dashed rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium uppercase text-muted-foreground">Add step</p>
            <Row2><Field label="Template key"><Input value={templateKey} onChange={e => setTemplateKey(e.target.value)} /></Field><Field label="Delay (h)"><Input type="number" value={delayHours} onChange={e => setDelayHours(Number(e.target.value))} /></Field></Row2>
            <Field label="Label"><Input value={label} onChange={e => setLabel(e.target.value)} /></Field>
            <Button size="sm" onClick={async () => { await addStep.mutateAsync({ id, templateKey, delayHours, label }); setTemplateKey(""); setLabel(""); }} disabled={!templateKey}>Add</Button>
          </div>
        </div>
        <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Automations ───────────────────────────────────────────────
function AutomationsTab() {
  const { data } = useAdminEmailAutomations();
  const create = useCreateAdminEmailAutomation();
  const update = useUpdateAdminEmailAutomation();
  const del = useDeleteAdminEmailAutomation();
  const [editing, setEditing] = useState<EmailAutomationRow | "new" | null>(null);
  const { toast } = useToast();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Event-triggered automations (e.g. when a tenant downgrades, when a kitchen ticket fails).</p>
        <Button size="sm" onClick={() => setEditing("new")}><Plus className="w-4 h-4 mr-2" />New automation</Button>
      </div>
      <div className="grid gap-3">
        {(data?.data ?? []).map(a => (
          <div key={a.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium">{a.name}</p>
                <Badge variant="outline">{a.trigger}</Badge>
                {!a.isEnabled && <Badge variant="secondary">Paused</Badge>}
                <Badge>{a.runCount} runs</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{a.description}</p>
            </div>
            <Switch checked={a.isEnabled} onCheckedChange={(v) => update.mutate({ id: a.id, isEnabled: v })} />
            <Button size="sm" variant="ghost" onClick={() => setEditing(a)}><Pencil className="w-4 h-4" /></Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (confirm("Delete?")) del.mutate(a.id); }}><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
        {(data?.data ?? []).length === 0 && <div className="bg-muted/30 border border-dashed rounded-xl p-8 text-center text-sm text-muted-foreground">No automations yet.</div>}
      </div>
      {editing && <AutomationEditor row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={async (b) => {
        if (editing === "new") await create.mutateAsync(b); else await update.mutateAsync({ id: editing.id, ...b });
        setEditing(null); toast({ title: "Saved" });
      }} />}
    </div>
  );
}

function AutomationEditor({ row, onClose, onSave }: { row: EmailAutomationRow | null; onClose: () => void; onSave: (b: Partial<EmailAutomationRow>) => Promise<void> }) {
  const [name, setName] = useState(row?.name ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [trigger, setTrigger] = useState(row?.trigger ?? "");
  const [conditionJson, setConditionJson] = useState(JSON.stringify(row?.conditionJson ?? {}, null, 2));
  const [actions, setActions] = useState(JSON.stringify(row?.actions ?? [{ type: "send_template", params: { key: "", to: "" } }], null, 2));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{row ? "Edit" : "New"} automation</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Row2><Field label="Name"><Input value={name} onChange={e => setName(e.target.value)} /></Field><Field label="Trigger event"><Input value={trigger} placeholder="user.signup" onChange={e => setTrigger(e.target.value)} /></Field></Row2>
          <Field label="Description"><Input value={description} onChange={e => setDescription(e.target.value)} /></Field>
          <Field label="Condition (JSON)"><Textarea rows={4} value={conditionJson} onChange={e => setConditionJson(e.target.value)} /></Field>
          <Field label="Actions (JSON array)"><Textarea rows={6} value={actions} onChange={e => setActions(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => {
            let cj = {}, ac = [];
            try { cj = JSON.parse(conditionJson); ac = JSON.parse(actions); } catch { alert("Invalid JSON"); return; }
            onSave({ name, description, trigger, conditionJson: cj, actions: ac });
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Suppressions ──────────────────────────────────────────────
function CampaignsTab() {
  const [status, setStatus] = useState<string>("");
  const list = useAdminEmailCampaigns(status ? { status } : undefined);
  const analytics = useAdminEmailCampaignAnalytics();
  const rows = list.data?.data ?? [];
  const sum = analytics.data?.summary;
  const cards: Array<{ label: string; value: number; tone?: string }> = sum ? [
    { label: "Total", value: sum.total },
    { label: "Sent", value: sum.sent, tone: "text-emerald-700" },
    { label: "Scheduled", value: sum.scheduled, tone: "text-amber-700" },
    { label: "Draft", value: sum.draft },
    { label: "Failed", value: sum.failed, tone: "text-red-700" },
    { label: "Recipients", value: sum.recipients, tone: "text-blue-700" },
    { label: "Bounces", value: sum.bounces, tone: "text-orange-700" },
  ] : [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
        {cards.map(c => (
          <div key={c.label} className="bg-card border border-border rounded-xl p-3">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className={`text-xl font-semibold ${c.tone ?? "text-foreground"}`}>{c.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-medium">Campaigns (all tenants)</p>
          <select value={status} onChange={e => setStatus(e.target.value)} className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm">
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="sending">Sending</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="canceled">Canceled</option>
          </select>
        </div>
        {rows.length === 0 ? <p className="text-xs text-muted-foreground">No campaigns yet.</p> :
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr><th className="text-left py-2">Name</th><th className="text-left">Tenant</th><th className="text-left">Status</th><th className="text-left">Segment</th><th className="text-right">Sent</th><th className="text-right">Failed</th><th className="text-left">Updated</th></tr>
              </thead>
              <tbody>
                {rows.map(c => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="py-2 font-medium">{c.name}<div className="text-xs text-muted-foreground">{c.subject}</div></td>
                    <td>{c.tenantId ?? "—"}</td>
                    <td><Badge variant="outline">{c.status}</Badge></td>
                    <td className="text-xs">{c.segment}</td>
                    <td className="text-right">{c.sentCount}</td>
                    <td className="text-right text-red-700">{c.failedCount}</td>
                    <td className="text-xs text-muted-foreground">{new Date(c.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      </div>
    </div>
  );
}

function SuppressionsTab() {
  const [search, setSearch] = useState("");
  const { data } = useAdminEmailSuppressions(search);
  const unsubs = useAdminEmailUnsubscribes();
  const create = useCreateAdminEmailSuppression();
  const del = useDeleteAdminEmailSuppression();
  const [email, setEmail] = useState("");
  const [scope, setScope] = useState<"all" | "marketing" | "transactional">("marketing");
  const [reason, setReason] = useState("manual");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input className="max-w-xs" placeholder="Search email…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="bg-card border border-border rounded-xl p-4 space-y-2">
        <p className="text-sm font-medium">Add suppression</p>
        <Row2>
          <Field label="Email"><Input value={email} onChange={e => setEmail(e.target.value)} /></Field>
          <Field label="Scope"><Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["all","marketing","transactional"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></Field>
        </Row2>
        <Row2>
          <Field label="Reason"><Input value={reason} onChange={e => setReason(e.target.value)} /></Field>
          <Field label=""><Button onClick={() => { create.mutate({ email, scope, reason }); setEmail(""); }} disabled={!email}>Add</Button></Field>
        </Row2>
      </div>
      <div className="grid gap-2">
        {(data?.data ?? []).map(s => (
          <div key={s.id} className="bg-card border border-border rounded-lg p-3 flex items-center gap-3">
            <Ban className="w-4 h-4 text-orange-600" />
            <div className="flex-1">
              <p className="text-sm font-medium">{s.email}</p>
              <p className="text-xs text-muted-foreground">{s.scope} · {s.reason} · {new Date(s.createdAt).toLocaleDateString()}</p>
            </div>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => del.mutate(s.id)}><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
        {(data?.data ?? []).length === 0 && <div className="bg-muted/30 border border-dashed rounded-xl p-8 text-center text-sm text-muted-foreground">No suppressions.</div>}
      </div>
      <div>
        <p className="text-sm font-medium mb-2">Recent unsubscribes</p>
        <div className="grid gap-2">
          {(unsubs.data?.data ?? []).slice(0, 20).map(u => (
            <div key={u.id} className="bg-muted/30 border border-border rounded-lg p-2 px-3 text-xs flex justify-between">
              <span>{u.email}</span>
              <span className="text-muted-foreground">{u.scope}{u.restaurantId ? ` · R#${u.restaurantId}` : ""} · {new Date(u.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Variables ─────────────────────────────────────────────────
function VariablesTab() {
  const { data } = useAdminEmailVariables();
  const grouped = useMemo(() => {
    const g: Record<string, Array<{ id: number; domain: string; name: string; description: string; example: string }>> = {};
    for (const v of data?.data ?? []) { g[v.domain] ??= []; g[v.domain].push(v); }
    return g;
  }, [data]);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Read-only registry of template merge variables. Used by the template editor, AI generator, and the live preview. Variables are platform-managed to keep template rendering consistent.</p>
      {Object.keys(grouped).sort().map(d => (
        <div key={d}>
          <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">{d}</p>
          <div className="grid gap-1">
            {grouped[d].map(v => (
              <div key={v.id} className="bg-card border border-border rounded p-2 px-3 flex items-center gap-3 text-sm">
                <code className="font-mono text-xs bg-muted px-1.5 rounded">{`{{${v.name}}}`}</code>
                <span className="flex-1 text-muted-foreground">{v.description}</span>
                <span className="text-xs text-muted-foreground">e.g. {v.example}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {(data?.data ?? []).length === 0 && <div className="bg-muted/30 border border-dashed rounded-xl p-8 text-center text-sm text-muted-foreground">No variables registered.</div>}
    </div>
  );
}

// ─── Reports ───────────────────────────────────────────────────
function ReportsTab() {
  const { data, isLoading } = useAdminEmailPerTenantReport();
  if (isLoading) return <div className="p-8 text-center text-muted-foreground text-sm">Loading reports…</div>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Per-tenant email volume and engagement (last 30 days).</p>
      <div className="overflow-x-auto bg-card border border-border rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-muted/40"><tr>{["Tenant","Sent","Delivered","Opened","Clicked","Bounced","Failed","Unsub","Open %","Click %"].map(h => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {(data?.data ?? []).map(r => (
              <tr key={r.tenantId} className="border-t border-border">
                <td className="px-3 py-2">{r.tenantName}</td>
                <td className="px-3 py-2">{r.sent}</td>
                <td className="px-3 py-2">{r.delivered}</td>
                <td className="px-3 py-2">{r.opened}</td>
                <td className="px-3 py-2">{r.clicked}</td>
                <td className="px-3 py-2">{r.bounced}</td>
                <td className="px-3 py-2">{r.failed}</td>
                <td className="px-3 py-2">{r.unsubscribed}</td>
                <td className="px-3 py-2">{(r.openRate * 100).toFixed(1)}%</td>
                <td className="px-3 py-2">{(r.clickRate * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(data?.data ?? []).length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">No tenant activity in the last 30 days.</div>}
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────
function Row2({ children }: { children: React.ReactNode }) { return <div className="grid grid-cols-2 gap-3">{children}</div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>; }

// ─── Providers ───────────────────────────────────────────────────
function ProvidersTab() {
  const { data, isLoading } = useAdminEmailProviders();
  const [editing, setEditing] = useState<AdminEmailProvider | "new" | null>(null);
  const [testing, setTesting] = useState<AdminEmailProvider | null>(null);

  if (isLoading) return <div className="p-8 text-center text-muted-foreground text-sm">Loading providers…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Configure SMTP, SendGrid, Mailgun, SES, or a custom HTTP endpoint. The default provider is used for all outgoing emails.</p>
        <Button size="sm" onClick={() => setEditing("new")} className="gap-2"><Plus className="w-4 h-4" />Add provider</Button>
      </div>
      {(data?.data ?? []).length === 0 ? (
        <div className="bg-muted/30 border border-dashed border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
          No providers configured yet. Add one to start sending emails.
        </div>
      ) : (
        <div className="grid gap-3">
          {(data?.data ?? []).map(p => (
            <ProviderRow key={p.id} row={p} onEdit={() => setEditing(p)} onTest={() => setTesting(p)} />
          ))}
        </div>
      )}
      {editing && <ProviderEditor row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {testing && <ProviderTestDialog row={testing} onClose={() => setTesting(null)} />}
    </div>
  );
}

function ProviderRow({ row, onEdit, onTest }: { row: AdminEmailProvider; onEdit: () => void; onTest: () => void }) {
  const setDefault = useSetDefaultAdminEmailProvider();
  const del = useDeleteAdminEmailProvider();
  const update = useUpdateAdminEmailProvider();
  const { toast } = useToast();

  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center"><Server className="w-5 h-5 text-muted-foreground" /></div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-foreground">{row.name}</p>
          <Badge variant="outline">{DRIVER_LABEL[row.driver]}</Badge>
          {row.isDefault && <Badge className="bg-primary/10 text-primary border-primary/20"><Star className="w-3 h-3 mr-1" />Default</Badge>}
          {!row.isEnabled && <Badge variant="secondary">Disabled</Badge>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">From: {row.fromName ? `${row.fromName} <${row.fromEmail}>` : row.fromEmail}{row.replyTo ? ` · Reply-to ${row.replyTo}` : ""}</p>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={row.isEnabled} onCheckedChange={(v) => {
          update.mutate({ id: row.id, isEnabled: v }, {
            onSuccess: () => toast({ title: v ? "Provider enabled" : "Provider disabled" }),
          });
        }} />
        {!row.isDefault && row.isEnabled && (
          <Button variant="ghost" size="sm" onClick={() => setDefault.mutate(row.id, {
            onSuccess: () => toast({ title: "Set as default" }),
          })}><Star className="w-4 h-4" /></Button>
        )}
        <Button variant="ghost" size="sm" onClick={onTest}><Send className="w-4 h-4" /></Button>
        <Button variant="ghost" size="sm" onClick={onEdit}><Pencil className="w-4 h-4" /></Button>
        <Button variant="ghost" size="sm" onClick={() => {
          if (confirm(`Delete provider "${row.name}"? Past logs are kept.`)) {
            del.mutate(row.id, { onSuccess: () => toast({ title: "Provider deleted" }) });
          }
        }}><Trash2 className="w-4 h-4 text-red-500" /></Button>
      </div>
    </div>
  );
}

function ProviderEditor({ row, onClose }: { row: AdminEmailProvider | null; onClose: () => void }) {
  const isNew = row === null;
  const [name, setName] = useState(row?.name ?? "");
  const [driver, setDriver] = useState<EmailDriver>(row?.driver ?? "smtp");
  const [fromName, setFromName] = useState(row?.fromName ?? "");
  const [fromEmail, setFromEmail] = useState(row?.fromEmail ?? "");
  const [replyTo, setReplyTo] = useState(row?.replyTo ?? "");
  const [isEnabled, setIsEnabled] = useState(row?.isEnabled ?? true);
  const [isDefault, setIsDefault] = useState(row?.isDefault ?? false);
  const [config, setConfig] = useState<Record<string, unknown>>(row?.config ?? {});
  const create = useCreateAdminEmailProvider();
  const update = useUpdateAdminEmailProvider();
  const { toast } = useToast();
  const saving = create.isPending || update.isPending;

  const setCfg = (k: string, v: unknown) => setConfig(prev => ({ ...prev, [k]: v }));
  const cfg = config as Record<string, string | undefined>;

  const submit = () => {
    if (!name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (!fromEmail.trim()) { toast({ title: "From email is required", variant: "destructive" }); return; }
    const payload = {
      name: name.trim(), driver, fromName: fromName.trim(), fromEmail: fromEmail.trim(),
      replyTo: replyTo.trim() || null, isEnabled, isDefault, config,
    };
    if (isNew) {
      create.mutate(payload, {
        onSuccess: () => { toast({ title: "Provider created" }); onClose(); },
        onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
      });
    } else {
      update.mutate({ id: row!.id, ...payload }, {
        onSuccess: () => { toast({ title: "Provider updated" }); onClose(); },
        onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
      });
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isNew ? "Add email provider" : `Edit ${row!.name}`}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Production SendGrid" />
            </div>
            <div className="space-y-1.5">
              <Label>Driver</Label>
              <Select value={driver} onValueChange={(v) => { setDriver(v as EmailDriver); if (isNew) setConfig({}); }} disabled={!isNew}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(DRIVER_LABEL) as EmailDriver[]).map(d => <SelectItem key={d} value={d}>{DRIVER_LABEL[d]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>From name</Label><Input value={fromName} onChange={e => setFromName(e.target.value)} placeholder="KhanaLagao" /></div>
            <div className="space-y-1.5"><Label>From email</Label><Input value={fromEmail} onChange={e => setFromEmail(e.target.value)} placeholder="hello@example.com" /></div>
          </div>
          <div className="space-y-1.5"><Label>Reply-to (optional)</Label><Input value={replyTo ?? ""} onChange={e => setReplyTo(e.target.value)} placeholder="support@example.com" /></div>

          {driver === "smtp" && (
            <div className="grid grid-cols-2 gap-3 p-3 bg-muted/30 rounded-lg">
              <div className="space-y-1.5"><Label>Host</Label><Input value={cfg.host ?? ""} onChange={e => setCfg("host", e.target.value)} placeholder="smtp.gmail.com" /></div>
              <div className="space-y-1.5"><Label>Port</Label><Input type="number" value={(cfg.port as unknown as string) ?? ""} onChange={e => setCfg("port", Number(e.target.value) || 0)} placeholder="587" /></div>
              <div className="space-y-1.5"><Label>Username</Label><Input value={cfg.username ?? ""} onChange={e => setCfg("username", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Password</Label><Input type="password" value={cfg.password ?? ""} onChange={e => setCfg("password", e.target.value)} placeholder={isNew ? "" : "Leave blank to keep existing"} /></div>
              <div className="space-y-1.5 col-span-2">
                <Label>Encryption</Label>
                <Select value={(cfg.encryption as string) ?? "tls"} onValueChange={(v) => setCfg("encryption", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tls">STARTTLS</SelectItem>
                    <SelectItem value="ssl">SSL</SelectItem>
                    <SelectItem value="none">None</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {driver === "sendgrid" && (
            <div className="p-3 bg-muted/30 rounded-lg space-y-1.5"><Label>API key</Label><Input type="password" value={cfg.apiKey ?? ""} onChange={e => setCfg("apiKey", e.target.value)} placeholder={isNew ? "SG.…" : "Leave blank to keep existing"} /></div>
          )}
          {driver === "mailgun" && (
            <div className="grid grid-cols-2 gap-3 p-3 bg-muted/30 rounded-lg">
              <div className="space-y-1.5"><Label>API key</Label><Input type="password" value={cfg.apiKey ?? ""} onChange={e => setCfg("apiKey", e.target.value)} placeholder={isNew ? "" : "Leave blank to keep existing"} /></div>
              <div className="space-y-1.5"><Label>Domain</Label><Input value={cfg.domain ?? ""} onChange={e => setCfg("domain", e.target.value)} placeholder="mg.example.com" /></div>
              <div className="space-y-1.5 col-span-2">
                <Label>Region</Label>
                <Select value={(cfg.region as string) ?? "us"} onValueChange={(v) => setCfg("region", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="us">US</SelectItem><SelectItem value="eu">EU</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          )}
          {driver === "ses" && (
            <div className="grid grid-cols-2 gap-3 p-3 bg-muted/30 rounded-lg">
              <div className="space-y-1.5"><Label>Access key ID</Label><Input value={cfg.accessKey ?? ""} onChange={e => setCfg("accessKey", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Secret access key</Label><Input type="password" value={cfg.secretKey ?? ""} onChange={e => setCfg("secretKey", e.target.value)} placeholder={isNew ? "" : "Leave blank to keep existing"} /></div>
              <div className="space-y-1.5 col-span-2"><Label>Region</Label><Input value={cfg.region ?? ""} onChange={e => setCfg("region", e.target.value)} placeholder="us-east-1" /></div>
            </div>
          )}
          {driver === "resend" && (
            <div className="p-3 bg-muted/30 rounded-lg space-y-1.5"><Label>API key</Label><Input type="password" value={cfg.apiKey ?? ""} onChange={e => setCfg("apiKey", e.target.value)} placeholder={isNew ? "re_…" : "Leave blank to keep existing"} /></div>
          )}
          {driver === "postmark" && (
            <div className="p-3 bg-muted/30 rounded-lg space-y-1.5"><Label>Server token</Label><Input type="password" value={cfg.serverToken ?? cfg.apiKey ?? ""} onChange={e => setCfg("serverToken", e.target.value)} placeholder={isNew ? "" : "Leave blank to keep existing"} /></div>
          )}
          {driver === "custom" && (
            <div className="grid gap-3 p-3 bg-muted/30 rounded-lg">
              <div className="space-y-1.5"><Label>Endpoint URL</Label><Input value={cfg.baseUrl ?? ""} onChange={e => setCfg("baseUrl", e.target.value)} placeholder="https://api.example.com/send" /></div>
              <div className="space-y-1.5"><Label>Auth header (optional)</Label><Input value={cfg.authHeader ?? ""} onChange={e => setCfg("authHeader", e.target.value)} placeholder={isNew ? "Authorization: Bearer …" : "Leave blank to keep existing"} /></div>
              <div className="space-y-1.5"><Label>Body template (optional JSON, supports {"{{to}}, {{subject}}, {{html}}, {{text}}"})</Label>
                <Textarea rows={5} value={cfg.bodyTemplate ?? ""} onChange={e => setCfg("bodyTemplate", e.target.value)} placeholder='{"to":"{{to}}","subject":"{{subject}}","html":"{{html}}"}' />
              </div>
            </div>
          )}

          <div className="flex items-center gap-6 pt-1">
            <label className="flex items-center gap-2 text-sm"><Switch checked={isEnabled} onCheckedChange={setIsEnabled} />Enabled</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={isDefault} onCheckedChange={setIsDefault} />Set as default</label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : isNew ? "Create provider" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderTestDialog({ row, onClose }: { row: AdminEmailProvider; onClose: () => void }) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(`Test from ${row.name}`);
  const test = useTestAdminEmailProvider();
  const { toast } = useToast();
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Test send via {row.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Send to</Label><Input value={to} onChange={e => setTo(e.target.value)} placeholder="you@example.com" /></div>
          <div className="space-y-1.5"><Label>Subject</Label><Input value={subject} onChange={e => setSubject(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => {
            if (!to) { toast({ title: "Recipient is required", variant: "destructive" }); return; }
            test.mutate({ id: row.id, to, subject }, {
              onSuccess: (r) => { toast({ title: r.ok ? "Test sent" : "Send failed" }); if (r.ok) onClose(); },
              onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
            });
          }} disabled={test.isPending}>{test.isPending ? "Sending…" : "Send test"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Templates ───────────────────────────────────────────────────
function TemplatesTab() {
  const { data, isLoading } = useAdminEmailTemplates();
  const [editing, setEditing] = useState<AdminEmailTemplate | "new" | null>(null);
  const [previewing, setPreviewing] = useState<AdminEmailTemplate | null>(null);
  const [testing, setTesting] = useState<AdminEmailTemplate | null>(null);
  const [announcing, setAnnouncing] = useState<AdminEmailTemplate | "any" | null>(null);
  const del = useDeleteAdminEmailTemplate();
  const { toast } = useToast();

  if (isLoading) return <div className="p-8 text-center text-muted-foreground text-sm">Loading templates…</div>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Edit subject/body for lifecycle emails. Variables in <code className="text-xs bg-muted px-1 rounded">{"{{name}}"}</code> are replaced when sent.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setAnnouncing("any")} className="gap-2"><Megaphone className="w-4 h-4" />Send announcement</Button>
          <Button size="sm" onClick={() => setEditing("new")} className="gap-2"><Plus className="w-4 h-4" />New template</Button>
        </div>
      </div>
      <div className="grid gap-2">
        {(data?.data ?? []).map(t => (
          <div key={t.id} className="bg-card border border-border rounded-xl p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center"><Mail className="w-4 h-4 text-muted-foreground" /></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-sm">{t.name}</p>
                <code className="text-xs px-1.5 py-0.5 bg-muted rounded">{t.key}</code>
                {t.event && <Badge variant="outline" className="text-xs">{t.event}</Badge>}
                {!t.isEnabled && <Badge variant="secondary">Disabled</Badge>}
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{t.subject || "(no subject)"}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPreviewing(t)} title="Preview"><Eye className="w-4 h-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => setTesting(t)} title="Send test"><Send className="w-4 h-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(t)}><Pencil className="w-4 h-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => {
              if (confirm(`Delete template "${t.name}"?`)) {
                del.mutate(t.id, { onSuccess: () => toast({ title: "Template deleted" }) });
              }
            }}><Trash2 className="w-4 h-4 text-red-500" /></Button>
          </div>
        ))}
      </div>
      {editing && <TemplateEditor row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {previewing && <TemplatePreviewDialog row={previewing} onClose={() => setPreviewing(null)} />}
      {testing && <TemplateTestDialog row={testing} onClose={() => setTesting(null)} />}
      {announcing && (
        <AnnouncementDialog
          templates={data?.data ?? []}
          initialKey={announcing === "any" ? "feature_announcement" : announcing.key}
          onClose={() => setAnnouncing(null)}
        />
      )}
    </div>
  );
}

function AnnouncementDialog({ templates, initialKey, onClose }: { templates: AdminEmailTemplate[]; initialKey: string; onClose: () => void }) {
  const [templateKey, setTemplateKey] = useState(initialKey);
  const [audience, setAudience] = useState<"all_tenants" | "single">("all_tenants");
  const [recipient, setRecipient] = useState("");
  const [varsText, setVarsText] = useState('{\n  "title": "What\'s new this month",\n  "message": "We launched a bunch of improvements."\n}');
  const send = useSendAdminEmailAnnouncement();
  const { toast } = useToast();
  const submit = () => {
    let variables: Record<string, unknown> = {};
    try { variables = varsText.trim() ? JSON.parse(varsText) : {}; }
    catch { toast({ title: "Variables must be valid JSON", variant: "destructive" }); return; }
    if (audience === "single" && !recipient.trim()) { toast({ title: "Recipient is required", variant: "destructive" }); return; }
    send.mutate(
      { templateKey, audience, recipient: audience === "single" ? recipient.trim() : undefined, variables },
      { onSuccess: (r) => { toast({ title: `Sent ${r.sent}/${r.total} (${r.failed} failed)` }); onClose(); } },
    );
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Send announcement</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <Label>Template</Label>
            <Select value={templateKey} onValueChange={setTemplateKey}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {templates.filter(t => t.isEnabled).map(t => <SelectItem key={t.id} value={t.key}>{t.name} ({t.key})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Audience</Label>
            <Select value={audience} onValueChange={(v) => setAudience(v as "all_tenants" | "single")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_tenants">All active tenant owners</SelectItem>
                <SelectItem value="single">Single recipient</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {audience === "single" && (
            <div>
              <Label>Recipient email</Label>
              <Input type="email" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="owner@example.com" />
            </div>
          )}
          <div>
            <Label>Variables (JSON)</Label>
            <Textarea rows={6} value={varsText} onChange={e => setVarsText(e.target.value)} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground mt-1">Merged with defaults like <code>name</code> and <code>appName</code>.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={send.isPending}><Send className="w-4 h-4 mr-1" />{send.isPending ? "Sending…" : "Send"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateEditor({ row, onClose }: { row: AdminEmailTemplate | null; onClose: () => void }) {
  const isNew = row === null;
  const [key, setKey] = useState(row?.key ?? "");
  const [name, setName] = useState(row?.name ?? "");
  const [event, setEvent] = useState(row?.event ?? "");
  const [subject, setSubject] = useState(row?.subject ?? "");
  const [body, setBody] = useState(row?.body ?? "");
  const [variables, setVariables] = useState((row?.variables ?? []).join(", "));
  const [isEnabled, setIsEnabled] = useState(row?.isEnabled ?? true);
  const create = useCreateAdminEmailTemplate();
  const update = useUpdateAdminEmailTemplate();
  const { toast } = useToast();
  const saving = create.isPending || update.isPending;

  const submit = () => {
    if (!name.trim() || (isNew && !key.trim())) { toast({ title: "Key and name are required", variant: "destructive" }); return; }
    const vars = variables.split(",").map(s => s.trim()).filter(Boolean);
    const payload = { name: name.trim(), event: event.trim() || undefined, subject, body, variables: vars, isEnabled };
    if (isNew) {
      create.mutate({ key: key.trim(), ...payload }, {
        onSuccess: () => { toast({ title: "Template created" }); onClose(); },
        onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
      });
    } else {
      update.mutate({ id: row!.id, ...payload }, {
        onSuccess: () => { toast({ title: "Template updated" }); onClose(); },
        onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
      });
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isNew ? "New template" : `Edit ${row!.name}`}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Key</Label><Input value={key} onChange={e => setKey(e.target.value)} disabled={!isNew} placeholder="welcome" /></div>
            <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Welcome email" /></div>
          </div>
          <div className="space-y-1.5"><Label>Event (optional)</Label><Input value={event} onChange={e => setEvent(e.target.value)} placeholder="user.signup" /></div>
          <div className="space-y-1.5"><Label>Subject</Label><Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Welcome to {{appName}}" /></div>
          <div className="space-y-1.5"><Label>HTML body</Label><Textarea rows={12} value={body} onChange={e => setBody(e.target.value)} className="font-mono text-xs" /></div>
          <div className="space-y-1.5"><Label>Variables (comma-separated)</Label><Input value={variables} onChange={e => setVariables(e.target.value)} placeholder="name, restaurant, appName" /></div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={isEnabled} onCheckedChange={setIsEnabled} />Enabled</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : isNew ? "Create template" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplatePreviewDialog({ row, onClose }: { row: AdminEmailTemplate; onClose: () => void }) {
  const [sample, setSample] = useState<Record<string, string>>(() => Object.fromEntries((row.variables ?? []).map(v => [v, ""])));
  const preview = usePreviewAdminEmailTemplate();
  const result = preview.data;
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Preview: {row.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {(row.variables ?? []).length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {(row.variables ?? []).map(v => (
                <div key={v} className="space-y-1"><Label className="text-xs">{v}</Label>
                  <Input value={sample[v] ?? ""} onChange={e => setSample(s => ({ ...s, [v]: e.target.value }))} />
                </div>
              ))}
            </div>
          )}
          <Button size="sm" onClick={() => preview.mutate({ id: row.id, sample })}>Render preview</Button>
          {result && (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-muted/40 text-sm border-b border-border"><span className="text-muted-foreground">Subject:</span> {result.subject}</div>
              <div className="p-4 bg-white text-sm" dangerouslySetInnerHTML={{ __html: result.html }} />
            </div>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateTestDialog({ row, onClose }: { row: AdminEmailTemplate; onClose: () => void }) {
  const [to, setTo] = useState("");
  const [sample, setSample] = useState<Record<string, string>>(() => Object.fromEntries((row.variables ?? []).map(v => [v, ""])));
  const test = useTestAdminEmailTemplate();
  const { toast } = useToast();
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Test send: {row.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Send to</Label><Input value={to} onChange={e => setTo(e.target.value)} placeholder="you@example.com" /></div>
          {(row.variables ?? []).length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Sample variable values</p>
              <div className="grid grid-cols-2 gap-2">
                {(row.variables ?? []).map(v => (
                  <div key={v} className="space-y-1"><Label className="text-xs">{v}</Label>
                    <Input value={sample[v] ?? ""} onChange={e => setSample(s => ({ ...s, [v]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => {
            if (!to) { toast({ title: "Recipient is required", variant: "destructive" }); return; }
            test.mutate({ id: row.id, to, sample }, {
              onSuccess: (r) => { toast({ title: r.ok ? "Test sent" : "Send failed" }); if (r.ok) onClose(); },
              onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
            });
          }} disabled={test.isPending}>{test.isPending ? "Sending…" : "Send test"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Logs ────────────────────────────────────────────────────────
function LogsTab() {
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const [baseFilters, setBaseFilters] = useState<AdminEmailLogFilters>({ status: "all", provider: "all", template: "all" });
  const filters = useMemo<AdminEmailLogFilters>(() => ({ ...baseFilters, limit: PAGE_SIZE, offset: page * PAGE_SIZE }), [baseFilters, page]);
  const setFilters = (updater: (prev: AdminEmailLogFilters) => AdminEmailLogFilters) => {
    setBaseFilters(prev => updater(prev));
    setPage(0);
  };
  const { data, isLoading } = useAdminEmailLogs(filters);
  const { data: tplData } = useAdminEmailTemplates();
  const { data: provData } = useAdminEmailProviders();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [detail, setDetail] = useState<AdminEmailLog | null>(null);
  const retry = useRetryAdminEmailLog();
  const bulkRetry = useBulkRetryAdminEmailLogs();
  const { toast } = useToast();
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const failedSelectedCount = useMemo(() => rows.filter(r => selected.has(r.id) && r.status !== "sent" && r.status !== "delivered").length, [rows, selected]);

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-5 gap-2">
        <Input placeholder="Search recipient/subject/error…" value={filters.search ?? ""} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
        <Select value={filters.status ?? "all"} onValueChange={(v) => setFilters(f => ({ ...f, status: v as EmailLogStatus | "all" }))}>
          <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="bounced">Bounced</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.provider ?? "all"} onValueChange={(v) => setFilters(f => ({ ...f, provider: v }))}>
          <SelectTrigger><SelectValue placeholder="Provider" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            {(provData?.data ?? []).map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.template ?? "all"} onValueChange={(v) => setFilters(f => ({ ...f, template: v }))}>
          <SelectTrigger><SelectValue placeholder="Template" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All templates</SelectItem>
            {(tplData?.data ?? []).map(t => <SelectItem key={t.id} value={t.key}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          {failedSelectedCount > 0 && (
            <Button size="sm" variant="outline" onClick={() => {
              const ids = Array.from(selected);
              bulkRetry.mutate(ids, {
                onSuccess: (r) => { toast({ title: `Retried ${r.retried} — ${r.succeeded} ok, ${r.failed} failed` }); setSelected(new Set()); },
              });
            }} disabled={bulkRetry.isPending}>
              <RotateCcw className="w-4 h-4 mr-1" />Retry {failedSelectedCount}
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground text-sm">Loading logs…</div>
      ) : rows.length === 0 ? (
        <div className="bg-muted/30 border border-dashed border-border rounded-xl p-8 text-center text-sm text-muted-foreground">No email logs match your filters yet.</div>
      ) : (
        <>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="p-2 text-left w-8"><input type="checkbox" checked={selected.size === rows.length && rows.length > 0}
                  onChange={e => setSelected(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())} /></th>
                <th className="p-2 text-left">When</th>
                <th className="p-2 text-left">Recipient</th>
                <th className="p-2 text-left">Template</th>
                <th className="p-2 text-left">Subject</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-left">Provider</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/20">
                  <td className="p-2"><input type="checkbox" checked={selected.has(r.id)} onChange={e => {
                    setSelected(s => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; });
                  }} /></td>
                  <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="p-2"><div className="font-medium">{r.recipient}</div>{r.tenantName && <div className="text-xs text-muted-foreground">{r.tenantName}</div>}</td>
                  <td className="p-2 text-xs">{r.templateKey ?? "—"}</td>
                  <td className="p-2 text-xs max-w-[18ch] truncate" title={r.subject ?? ""}>{r.subject ?? "—"}</td>
                  <td className="p-2"><Badge className={STATUS_BADGE[r.status]}>{r.status === "sent" || r.status === "delivered" ? <CheckCircle2 className="w-3 h-3 mr-1" /> : r.status === "failed" ? <AlertTriangle className="w-3 h-3 mr-1" /> : null}{r.status}</Badge></td>
                  <td className="p-2 text-xs">{r.providerDriver ? DRIVER_LABEL[r.providerDriver] : "—"}</td>
                  <td className="p-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setDetail(r)}><Eye className="w-4 h-4" /></Button>
                    {(r.status === "failed" || r.status === "bounced" || r.status === "queued") && (
                      <Button variant="ghost" size="sm" onClick={() => retry.mutate(r.id, {
                        onSuccess: (out) => toast({ title: out.ok ? "Retry sent" : "Retry failed" }),
                      })}><RotateCcw className="w-4 h-4" /></Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div>Showing {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + rows.length} of {total}</div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</Button>
            <span>Page {page + 1} of {totalPages}</span>
            <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
        </>
      )}

      {detail && (
        <Dialog open onOpenChange={() => setDetail(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Log #{detail.id}</DialogTitle></DialogHeader>
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div><span className="text-muted-foreground">Recipient:</span> {detail.recipient}</div>
                <div><span className="text-muted-foreground">Status:</span> <Badge className={STATUS_BADGE[detail.status]}>{detail.status}</Badge></div>
                <div><span className="text-muted-foreground">Template:</span> {detail.templateKey ?? "—"}</div>
                <div><span className="text-muted-foreground">Provider:</span> {detail.providerDriver ? DRIVER_LABEL[detail.providerDriver] : "—"}</div>
                <div><span className="text-muted-foreground">Tenant:</span> {detail.tenantName ?? "—"}</div>
                <div><span className="text-muted-foreground">Provider msg id:</span> {detail.providerMessageId ?? "—"}</div>
                <div><span className="text-muted-foreground">Created:</span> {new Date(detail.createdAt).toLocaleString()}</div>
                <div><span className="text-muted-foreground">Sent:</span> {detail.sentAt ? new Date(detail.sentAt).toLocaleString() : "—"}</div>
              </div>
              <div className="pt-2"><span className="text-muted-foreground">Subject:</span> <div className="text-foreground">{detail.subject ?? "—"}</div></div>
              {detail.error && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-700 text-xs whitespace-pre-wrap">{detail.error}</div>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
              {(detail.status === "failed" || detail.status === "bounced" || detail.status === "queued") && (
                <Button onClick={() => retry.mutate(detail.id, {
                  onSuccess: (out) => { toast({ title: out.ok ? "Retry sent" : "Retry failed" }); setDetail(null); },
                })} disabled={retry.isPending}><RotateCcw className="w-4 h-4 mr-1" />Retry</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
