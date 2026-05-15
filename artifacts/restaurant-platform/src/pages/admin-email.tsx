import { useMemo, useState } from "react";
import {
  Mail, Plus, Pencil, Trash2, Star, Send, RotateCcw, X, CheckCircle2, AlertTriangle, Eye, FileText, Server,
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
} from "@/lib/hooks";
import { Megaphone } from "lucide-react";

const DRIVER_LABEL: Record<EmailDriver, string> = {
  smtp: "SMTP", sendgrid: "SendGrid", mailgun: "Mailgun", ses: "Amazon SES", custom: "Custom HTTP",
};

const STATUS_BADGE: Record<EmailLogStatus, string> = {
  queued: "bg-amber-500/15 text-amber-700",
  sent: "bg-emerald-500/15 text-emerald-700",
  delivered: "bg-emerald-500/20 text-emerald-700",
  bounced: "bg-orange-500/15 text-orange-700",
  failed: "bg-red-500/15 text-red-700",
};

export default function AdminEmail() {
  const [tab, setTab] = useState<"providers" | "templates" | "logs">("providers");
  return (
    <div className="space-y-4">
      <div className="border-b border-border flex gap-1">
        {[
          { id: "providers" as const, label: "Providers", icon: Server },
          { id: "templates" as const, label: "Templates", icon: FileText },
          { id: "logs" as const, label: "Logs", icon: Mail },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 ${
              tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>
      {tab === "providers" && <ProvidersTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "logs" && <LogsTab />}
    </div>
  );
}

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
            <div className="space-y-1.5"><Label>From name</Label><Input value={fromName} onChange={e => setFromName(e.target.value)} placeholder="Khana Lagao" /></div>
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
