import { useMemo, useState } from "react";
import {
  Send, Calendar, FileText, Inbox, AlertTriangle, CheckCircle2, Clock, X,
  Trash2, Plus, Eye, RefreshCw, Mail, MessageSquare, Smartphone, Bell, Megaphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useAdminBroadcasts, useAdminBroadcast, useCreateAdminBroadcast,
  useSendAdminBroadcast, useCancelAdminBroadcast, useDeleteAdminBroadcast,
  useAudiencePreview, useAdminNotificationTemplates,
  useCreateAdminNotificationTemplate, useUpdateAdminNotificationTemplate,
  useDeleteAdminNotificationTemplate, useAdminBroadcastsStats,
  type BroadcastChannel, type AudienceFilter, type AdminBroadcast,
  type AdminNotificationTemplate,
} from "@/lib/hooks";

const CHANNEL_META: Record<BroadcastChannel, { label: string; icon: typeof Mail }> = {
  in_app:  { label: "In-app",   icon: Bell },
  email:   { label: "Email",    icon: Mail },
  sms:     { label: "SMS",      icon: MessageSquare },
  whatsapp:{ label: "WhatsApp", icon: MessageSquare },
  push:    { label: "Push",     icon: Smartphone },
};

const STATUS_BADGE: Record<string, { label: string; className: string; icon: typeof Clock }> = {
  draft:     { label: "Draft",     className: "bg-muted text-foreground border-border",                                icon: FileText },
  scheduled: { label: "Scheduled", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",icon: Calendar },
  sending:   { label: "Sending",   className: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",   icon: RefreshCw },
  sent:      { label: "Sent",      className: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",icon: CheckCircle2 },
  failed:    { label: "Failed",    className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",       icon: AlertTriangle },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground border-border",                          icon: X },
};

type SubTab = "compose" | "scheduled" | "sent" | "templates" | "logs";

export default function AdminNotificationCenter() {
  const [sub, setSub] = useState<SubTab>("compose");
  const { data: stats } = useAdminBroadcastsStats();

  const tabs: Array<{ id: SubTab; label: string; icon: typeof Send }> = [
    { id: "compose",   label: "Compose",      icon: Send },
    { id: "scheduled", label: "Scheduled",    icon: Calendar },
    { id: "sent",      label: "Sent",         icon: Inbox },
    { id: "templates", label: "Templates",    icon: FileText },
    { id: "logs",      label: "Delivery Logs",icon: Eye },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Recipients reached" value={stats?.totals.total ?? 0} icon={Megaphone} />
        <StatCard label="Successful sends"   value={stats?.totals.success ?? 0} icon={CheckCircle2} accent="text-green-600" />
        <StatCard label="Failed sends"       value={stats?.totals.failure ?? 0} icon={AlertTriangle} accent="text-red-600" />
        <StatCard label="Scheduled"          value={(stats?.byStatus.find(s => s.status === "scheduled")?.count) ?? 0} icon={Calendar} accent="text-amber-600" />
      </div>

      <div className="border-b border-border flex flex-wrap gap-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 ${
              sub === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {sub === "compose"   && <ComposeTab />}
      {sub === "scheduled" && <BroadcastList filterStatuses={["scheduled", "draft"]} emptyText="No scheduled broadcasts." />}
      {sub === "sent"      && <BroadcastList filterStatuses={["sent", "sending", "failed", "cancelled"]} emptyText="Nothing sent yet." />}
      {sub === "templates" && <TemplatesTab />}
      {sub === "logs"      && <LogsTab />}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, accent }: { label: string; value: number; icon: typeof Mail; accent?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-2">
      <Icon className={`w-5 h-5 ${accent ?? "text-primary"}`} />
      <p className="text-2xl font-bold tabular-nums text-foreground">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── Compose ────────────────────────────────────────────────────
function ComposeTab() {
  const { toast } = useToast();
  const create = useCreateAdminBroadcast();
  const preview = useAudiencePreview();
  const { data: templatesData } = useAdminNotificationTemplates();

  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [channels, setChannels] = useState<BroadcastChannel[]>(["in_app"]);
  const [audienceType, setAudienceType] = useState<AudienceFilter["type"]>("all");
  const [audienceValues, setAudienceValues] = useState("");
  const [audienceIds, setAudienceIds] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [templateId, setTemplateId] = useState<number | "">("");

  const audience: AudienceFilter = useMemo(() => {
    const a: AudienceFilter = { type: audienceType };
    if (audienceType === "tenants" || audienceType === "plan") {
      a.ids = audienceIds.split(",").map(s => Number(s.trim())).filter(Number.isFinite);
    } else if (audienceType === "plan_status" || audienceType === "country" || audienceType === "city" || audienceType === "role") {
      a.values = audienceValues.split(",").map(s => s.trim()).filter(Boolean);
    }
    return a;
  }, [audienceType, audienceIds, audienceValues]);

  function toggleChannel(ch: BroadcastChannel) {
    setChannels(prev => prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]);
  }

  function applyTemplate(id: number) {
    const t = templatesData?.data.find(x => x.id === id);
    if (!t) return;
    setMessage(t.body);
    if (t.subject) setSubject(t.subject);
    if (!channels.includes(t.channel)) setChannels(prev => Array.from(new Set([...prev, t.channel])));
  }

  function submit(sendNow: boolean) {
    if (!title.trim() || !message.trim()) {
      toast({ title: "Title and message are required", variant: "destructive" });
      return;
    }
    if (channels.length === 0) {
      toast({ title: "Select at least one channel", variant: "destructive" });
      return;
    }
    create.mutate({
      title: title.trim(),
      subject: subject.trim() || undefined,
      message: message.trim(),
      channels,
      audience,
      scheduledAt: sendNow ? null : (scheduledAt || null),
      sendNow,
      templateId: templateId === "" ? null : Number(templateId),
    }, {
      onSuccess: () => {
        toast({ title: sendNow ? "Broadcast queued" : (scheduledAt ? "Scheduled" : "Saved as draft") });
        setTitle(""); setSubject(""); setMessage(""); setScheduledAt(""); setTemplateId("");
      },
      onError: e => toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" }),
    });
  }

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5 space-y-4">
        <h3 className="font-semibold text-foreground">New broadcast</h3>

        {templatesData?.data.length ? (
          <div className="space-y-1.5">
            <Label htmlFor="bc-template">Use a template (optional)</Label>
            <select id="bc-template" value={templateId} onChange={e => {
              const v = e.target.value === "" ? "" : Number(e.target.value);
              setTemplateId(v);
              if (v !== "") applyTemplate(Number(v));
            }} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">— None —</option>
              {templatesData.data.map(t => <option key={t.id} value={t.id}>{t.name} ({t.channel})</option>)}
            </select>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="bc-title">Title</Label>
          <Input id="bc-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Scheduled maintenance Sunday" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bc-subject">Subject (email/push title)</Label>
          <Input id="bc-subject" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Defaults to the title above if empty" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bc-message">Message</Label>
          <Textarea id="bc-message" rows={6} value={message} onChange={e => setMessage(e.target.value)}
            placeholder="Write the body. You can use {{userName}} or {{tenantName}} placeholders." />
          <p className="text-[11px] text-muted-foreground">Variables: <code>{"{{userName}}"}</code>, <code>{"{{userEmail}}"}</code>, <code>{"{{tenantName}}"}</code></p>
        </div>

        <div className="space-y-1.5">
          <Label>Channels</Label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CHANNEL_META) as BroadcastChannel[]).map(ch => {
              const Meta = CHANNEL_META[ch];
              const Icon = Meta.icon;
              const active = channels.includes(ch);
              return (
                <button key={ch} type="button" onClick={() => toggleChannel(ch)}
                  className={`text-xs px-3 py-1.5 rounded-full border inline-flex items-center gap-1.5 transition-colors ${
                    active ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:text-foreground"
                  }`}>
                  <Icon className="w-3.5 h-3.5" />{Meta.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bc-schedule">Schedule for later (optional)</Label>
          <Input id="bc-schedule" type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">Leave empty to send immediately or save as draft.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
          <Button onClick={() => submit(true)} disabled={create.isPending}>
            <Send className="w-4 h-4 mr-1.5" />Send now
          </Button>
          <Button variant="outline" onClick={() => submit(false)} disabled={create.isPending}>
            {scheduledAt ? "Schedule" : "Save draft"}
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h3 className="font-semibold text-foreground">Audience</h3>
        <div className="space-y-1.5">
          <Label htmlFor="aud-type">Target</Label>
          <select id="aud-type" value={audienceType} onChange={e => setAudienceType(e.target.value as AudienceFilter["type"])}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="all">All active tenants</option>
            <option value="plan_status">By plan status</option>
            <option value="plan">By plan ID</option>
            <option value="tenants">Specific tenants (by ID)</option>
            <option value="role">By user role (cross-tenant)</option>
            <option value="country">By country code</option>
            <option value="city">By city name</option>
          </select>
        </div>

        {(audienceType === "tenants" || audienceType === "plan") && (
          <div className="space-y-1.5">
            <Label htmlFor="aud-ids">{audienceType === "tenants" ? "Tenant IDs" : "Plan IDs"} (comma-separated)</Label>
            <Input id="aud-ids" value={audienceIds} onChange={e => setAudienceIds(e.target.value)} placeholder="e.g. 1, 4, 12" />
          </div>
        )}

        {(audienceType === "plan_status" || audienceType === "country" || audienceType === "city" || audienceType === "role") && (
          <div className="space-y-1.5">
            <Label htmlFor="aud-vals">
              {audienceType === "plan_status" ? "Statuses (trial, active, expired, suspended)"
                : audienceType === "role" ? "Roles (owner, manager, …)"
                : audienceType === "country" ? "Country codes (e.g. IN, US)"
                : "Cities"}
            </Label>
            <Input id="aud-vals" value={audienceValues} onChange={e => setAudienceValues(e.target.value)} placeholder="comma-separated" />
          </div>
        )}

        <Button variant="outline" size="sm" onClick={() => preview.mutate(audience)} disabled={preview.isPending} className="w-full">
          <Eye className="w-4 h-4 mr-1.5" />Preview audience
        </Button>

        {preview.data && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <div className="font-semibold text-foreground">{preview.data.total.toLocaleString()} recipients</div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>Email reachable: <span className="font-medium text-foreground">{preview.data.withEmail}</span></div>
              <div>Phone reachable: <span className="font-medium text-foreground">{preview.data.withPhone}</span></div>
              <div>Push reachable:  <span className="font-medium text-foreground">{preview.data.withPush}</span></div>
            </div>
            {preview.data.sample.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border space-y-1">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Sample</div>
                {preview.data.sample.map((s, i) => (
                  <div key={i} className="text-xs">
                    <span className="font-medium">{s.name ?? `Tenant #${s.tenantId}`}</span>
                    {s.email && <span className="text-muted-foreground"> · {s.email}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Broadcast list (scheduled / sent) ───────────────────────────
function BroadcastList({ filterStatuses, emptyText }: { filterStatuses: string[]; emptyText: string }) {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useAdminBroadcasts("all");
  const send = useSendAdminBroadcast();
  const cancel = useCancelAdminBroadcast();
  const del = useDeleteAdminBroadcast();
  const [openId, setOpenId] = useState<number | null>(null);

  const rows = (data?.data ?? []).filter(b => filterStatuses.includes(b.status));

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <p className="text-sm text-muted-foreground">{rows.length} broadcast{rows.length === 1 ? "" : "s"}</p>
        <Button variant="ghost" size="sm" onClick={() => refetch()}><RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh</Button>
      </div>
      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground text-sm">{emptyText}</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
            <tr>
              <th className="px-5 py-3 text-left">Title</th>
              <th className="px-5 py-3 text-left">Channels</th>
              <th className="px-5 py-3 text-left">Audience</th>
              <th className="px-5 py-3 text-left">When</th>
              <th className="px-5 py-3 text-left">Status</th>
              <th className="px-5 py-3 text-left">Reach</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(b => <BroadcastRow key={b.id} bc={b} onView={() => setOpenId(b.id)}
              onSend={() => send.mutate(b.id, {
                onSuccess: () => toast({ title: "Sending…" }),
                onError: e => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
              })}
              onCancel={() => cancel.mutate(b.id, {
                onSuccess: () => toast({ title: "Cancelled" }),
                onError: e => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
              })}
              onDelete={() => {
                if (!window.confirm("Delete this broadcast and all its delivery logs?")) return;
                del.mutate(b.id, {
                  onSuccess: () => toast({ title: "Deleted" }),
                  onError: e => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
                });
              }}
            />)}
          </tbody>
        </table>
      )}
      {openId !== null && <BroadcastDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function BroadcastRow({ bc, onView, onSend, onCancel, onDelete }: { bc: AdminBroadcast; onView: () => void; onSend: () => void; onCancel: () => void; onDelete: () => void }) {
  const status = STATUS_BADGE[bc.status] ?? STATUS_BADGE.draft;
  const StatusIcon = status.icon;
  return (
    <tr className="border-t border-border align-top">
      <td className="px-5 py-3">
        <div className="font-medium text-foreground">{bc.title}</div>
        <div className="text-xs text-muted-foreground line-clamp-1 max-w-xs">{bc.message}</div>
      </td>
      <td className="px-5 py-3">
        <div className="flex flex-wrap gap-1">
          {bc.channels.map(c => {
            const M = CHANNEL_META[c]; const Icon = M.icon;
            return <Badge key={c} variant="outline" className="gap-1 text-[10px]"><Icon className="w-3 h-3" />{M.label}</Badge>;
          })}
        </div>
      </td>
      <td className="px-5 py-3 text-xs">
        <span className="capitalize">{bc.audience.type.replace("_", " ")}</span>
        {bc.audience.values?.length ? <span className="text-muted-foreground"> · {bc.audience.values.join(", ")}</span> : null}
        {bc.audience.ids?.length ? <span className="text-muted-foreground"> · #{bc.audience.ids.join(",#")}</span> : null}
      </td>
      <td className="px-5 py-3 text-xs text-muted-foreground">
        {bc.scheduledAt ? <>Scheduled {new Date(bc.scheduledAt).toLocaleString()}</>
          : bc.sentAt   ? <>Sent {new Date(bc.sentAt).toLocaleString()}</>
          : <>Created {new Date(bc.createdAt).toLocaleString()}</>}
      </td>
      <td className="px-5 py-3">
        <Badge className={`${status.className} gap-1`}><StatusIcon className="w-3 h-3" />{status.label}</Badge>
      </td>
      <td className="px-5 py-3 text-xs">
        <div>{bc.totalRecipients} total</div>
        <div className="text-green-600">{bc.successCount} sent</div>
        {bc.failureCount > 0 && <div className="text-red-600">{bc.failureCount} failed</div>}
      </td>
      <td className="px-5 py-3 text-right">
        <div className="flex flex-wrap gap-1.5 justify-end">
          <Button size="sm" variant="ghost" onClick={onView}><Eye className="w-3.5 h-3.5" /></Button>
          {(bc.status === "draft" || bc.status === "scheduled") && (
            <Button size="sm" onClick={onSend}><Send className="w-3.5 h-3.5 mr-1" />Send</Button>
          )}
          {(bc.status === "draft" || bc.status === "scheduled") && (
            <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
          )}
          <Button size="sm" variant="ghost" className="text-destructive" onClick={onDelete}><Trash2 className="w-3.5 h-3.5" /></Button>
        </div>
      </td>
    </tr>
  );
}

function BroadcastDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, isLoading } = useAdminBroadcast(id);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border sticky top-0 bg-card">
          <h3 className="font-semibold text-foreground">Broadcast #{id}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {isLoading || !data ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <>
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Message</div>
                <div className="font-semibold text-foreground">{data.broadcast.title}</div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-1">{data.broadcast.message}</p>
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Deliveries ({data.deliveries.length})</div>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-muted-foreground uppercase">
                      <tr>
                        <th className="px-3 py-2 text-left">Channel</th>
                        <th className="px-3 py-2 text-left">Tenant</th>
                        <th className="px-3 py-2 text-left">Recipient</th>
                        <th className="px-3 py-2 text-left">Status</th>
                        <th className="px-3 py-2 text-left">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.deliveries.map(d => (
                        <tr key={d.id} className="border-t border-border">
                          <td className="px-3 py-2 capitalize">{d.channel.replace("_", "-")}</td>
                          <td className="px-3 py-2">#{d.tenantId ?? "—"}</td>
                          <td className="px-3 py-2 font-mono">{d.recipient ?? "—"}</td>
                          <td className="px-3 py-2">
                            <span className={
                              d.status === "sent" ? "text-green-600" :
                              d.status === "failed" ? "text-red-600" :
                              d.status === "skipped" ? "text-muted-foreground" : ""
                            }>{d.status}</span>
                            {d.error && <div className="text-[10px] text-muted-foreground">{d.error}</div>}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{d.sentAt ? new Date(d.sentAt).toLocaleString() : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Templates ──────────────────────────────────────────────────
function TemplatesTab() {
  const { data, isLoading } = useAdminNotificationTemplates();
  const [editing, setEditing] = useState<AdminNotificationTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const del = useDeleteAdminNotificationTemplate();
  const { toast } = useToast();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Reusable message templates for broadcasts.</p>
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-1" />New template</Button>
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (data?.data ?? []).length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">No templates yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="px-5 py-3 text-left">Name</th>
                <th className="px-5 py-3 text-left">Slug</th>
                <th className="px-5 py-3 text-left">Channel</th>
                <th className="px-5 py-3 text-left">Subject</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.data ?? []).map(t => (
                <tr key={t.id} className="border-t border-border">
                  <td className="px-5 py-3 font-medium">{t.name}</td>
                  <td className="px-5 py-3 font-mono text-xs">{t.slug}</td>
                  <td className="px-5 py-3 capitalize">{t.channel.replace("_", "-")}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground max-w-xs line-clamp-1">{t.subject ?? "—"}</td>
                  <td className="px-5 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => {
                      if (!window.confirm("Delete this template?")) return;
                      del.mutate(t.id, { onSuccess: () => toast({ title: "Deleted" }) });
                    }}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {(creating || editing) && <TemplateModal template={editing} onClose={() => { setEditing(null); setCreating(false); }} />}
    </div>
  );
}

function TemplateModal({ template, onClose }: { template: AdminNotificationTemplate | null; onClose: () => void }) {
  const { toast } = useToast();
  const create = useCreateAdminNotificationTemplate();
  const update = useUpdateAdminNotificationTemplate();
  const [name, setName] = useState(template?.name ?? "");
  const [slug, setSlug] = useState(template?.slug ?? "");
  const [channel, setChannel] = useState<BroadcastChannel>(template?.channel ?? "in_app");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const isEdit = !!template;
  const busy = create.isPending || update.isPending;

  function save() {
    if (!name.trim() || !body.trim() || (!isEdit && !slug.trim())) {
      toast({ title: "Name, slug and body are required", variant: "destructive" });
      return;
    }
    const onSuccess = () => { toast({ title: isEdit ? "Updated" : "Created" }); onClose(); };
    const onError = (e: unknown) => toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    if (isEdit && template) {
      update.mutate({ id: template.id, name, channel, subject: subject || undefined, body }, { onSuccess, onError });
    } else {
      create.mutate({ name, slug, channel, subject: subject || undefined, body }, { onSuccess, onError });
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border sticky top-0 bg-card">
          <h3 className="font-semibold text-foreground">{isEdit ? "Edit template" : "New template"}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="t-name">Name</Label>
            <Input id="t-name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          {!isEdit && (
            <div className="space-y-1.5">
              <Label htmlFor="t-slug">Slug</Label>
              <Input id="t-slug" value={slug} onChange={e => setSlug(e.target.value)} placeholder="kebab-case unique key" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="t-channel">Default channel</Label>
            <select id="t-channel" value={channel} onChange={e => setChannel(e.target.value as BroadcastChannel)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
              {(Object.keys(CHANNEL_META) as BroadcastChannel[]).map(c => <option key={c} value={c}>{CHANNEL_META[c].label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-subject">Subject</Label>
            <Input id="t-subject" value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-body">Body</Label>
            <Textarea id="t-body" rows={6} value={body} onChange={e => setBody(e.target.value)} />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Logs ───────────────────────────────────────────────────────
function LogsTab() {
  const { data, isLoading, refetch } = useAdminBroadcasts("all");
  const recent = (data?.data ?? []).slice(0, 20);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <p className="text-sm text-muted-foreground">Latest 20 broadcasts and their delivery summary.</p>
        <Button variant="ghost" size="sm" onClick={() => refetch()}><RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh</Button>
      </div>
      {isLoading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : recent.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground">No broadcasts yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
            <tr>
              <th className="px-5 py-3 text-left">When</th>
              <th className="px-5 py-3 text-left">Title</th>
              <th className="px-5 py-3 text-left">Status</th>
              <th className="px-5 py-3 text-left">Channels</th>
              <th className="px-5 py-3 text-right">Total</th>
              <th className="px-5 py-3 text-right">Sent</th>
              <th className="px-5 py-3 text-right">Failed</th>
            </tr>
          </thead>
          <tbody>
            {recent.map(b => {
              const s = STATUS_BADGE[b.status] ?? STATUS_BADGE.draft;
              return (
                <tr key={b.id} className="border-t border-border">
                  <td className="px-5 py-3 text-xs text-muted-foreground">{new Date(b.sentAt ?? b.createdAt).toLocaleString()}</td>
                  <td className="px-5 py-3">{b.title}</td>
                  <td className="px-5 py-3"><Badge className={s.className}>{s.label}</Badge></td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{b.channels.join(", ")}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{b.totalRecipients}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-green-600">{b.successCount}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-red-600">{b.failureCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
