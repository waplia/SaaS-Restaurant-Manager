import { useEffect, useMemo, useRef, useState } from "react";
import {
  Megaphone, Send, Calendar, FileText, ListChecks, Plus, Trash2, X,
  RefreshCw, Pencil, AlertTriangle, Mail, Smartphone, MessageSquare, Bell, MessageCircle,
  Bold, Italic, Link as LinkIcon, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  type AdminBroadcast,
  type AdminBroadcastDelivery,
  type AdminNotificationTemplate,
  type AudienceFilter,
  type BroadcastChannel,
  type BroadcastPriority,
  type BroadcastStatus,
  type CreateAdminBroadcastBody,
  type DeliveryStatus,
  useAdminBroadcasts,
  useAdminBroadcastRecipients,
  useAdminBroadcastRecipientStats,
  useAdminBroadcastsStats,
  useAdminNotificationTemplates,
  useAudiencePreview,
  useCancelAdminBroadcast,
  useCreateAdminBroadcast,
  useCreateAdminNotificationTemplate,
  useDeleteAdminBroadcast,
  useDeleteAdminNotificationTemplate,
  useResendFailedBroadcast,
  useRetryBroadcastRecipient,
  useSendAdminBroadcast,
  useUpdateAdminBroadcast,
  useUpdateAdminNotificationTemplate,
} from "@/lib/hooks";

const SUB_TABS = [
  { id: "compose", label: "Compose", icon: Megaphone },
  { id: "scheduled", label: "Scheduled", icon: Calendar },
  { id: "sent", label: "Sent", icon: Send },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "logs", label: "Delivery Logs", icon: ListChecks },
] as const;
type SubTab = typeof SUB_TABS[number]["id"];

const ALL_CHANNELS: { id: BroadcastChannel; label: string; icon: typeof Mail }[] = [
  { id: "in_app", label: "In-app", icon: Bell },
  { id: "email", label: "Email", icon: Mail },
  { id: "sms", label: "SMS", icon: Smartphone },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "push", label: "Push", icon: MessageSquare },
];

const PRIORITIES: { id: BroadcastPriority; label: string; tone: string }[] = [
  { id: "low", label: "Low", tone: "bg-slate-100 text-slate-700" },
  { id: "medium", label: "Medium", tone: "bg-blue-100 text-blue-700" },
  { id: "high", label: "High", tone: "bg-amber-100 text-amber-700" },
  { id: "urgent", label: "Urgent", tone: "bg-red-100 text-red-700" },
];

const STATUS_TONES: Record<BroadcastStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  scheduled: "bg-blue-100 text-blue-700",
  sending: "bg-amber-100 text-amber-700",
  sent: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-500",
};

const DELIVERY_TONES: Record<DeliveryStatus, string> = {
  pending: "bg-slate-100 text-slate-700",
  queued: "bg-slate-100 text-slate-700",
  sent: "bg-green-100 text-green-700",
  delivered: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  skipped: "bg-slate-100 text-slate-500",
};

export default function AdminNotificationCenter() {
  const [tab, setTab] = useState<SubTab>("compose");
  const [logsBroadcastId, setLogsBroadcastId] = useState<number | null>(null);

  const openLogsFor = (id: number) => {
    setLogsBroadcastId(id);
    setTab("logs");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-orange-500" /> Notification Center
        </h2>
      </div>
      <div className="flex flex-wrap gap-1 border-b">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition ${
              tab === t.id ? "border-orange-500 text-orange-600 font-medium" : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "compose" && <ComposeTab onOpenLogs={openLogsFor} />}
      {tab === "scheduled" && <ScheduledTab onOpenLogs={openLogsFor} />}
      {tab === "sent" && <SentTab onOpenLogs={openLogsFor} />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "logs" && <DeliveryLogsTab broadcastId={logsBroadcastId} setBroadcastId={setLogsBroadcastId} />}
    </div>
  );
}

// ─── Compose ─────────────────────────────────────────────────────
type ComposeProps = { onOpenLogs: (id: number) => void; existing?: AdminBroadcast | null; onDone?: () => void };

function ComposeTab({ onOpenLogs, existing = null, onDone }: ComposeProps) {
  const { toast } = useToast();
  const isEdit = !!existing;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [subject, setSubject] = useState(existing?.subject ?? "");
  const [message, setMessage] = useState(existing?.message ?? "");
  const [channels, setChannels] = useState<BroadcastChannel[]>(existing?.channels ?? ["in_app"]);
  const [priority, setPriority] = useState<BroadcastPriority>(existing?.priority ?? "medium");
  const [audience, setAudience] = useState<AudienceFilter>(existing?.audience ?? {});
  const [scheduledAt, setScheduledAt] = useState<string>(
    existing?.scheduledAt ? new Date(existing.scheduledAt).toISOString().slice(0, 16) : "",
  );
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateSlug, setTemplateSlug] = useState("");
  const [confirm, setConfirm] = useState<null | { mode: "now" | "schedule" }>(null);

  const create = useCreateAdminBroadcast();
  const update = useUpdateAdminBroadcast();
  const audiencePreview = useAudiencePreview();
  const templates = useAdminNotificationTemplates();
  const messageRef = useRef<HTMLTextAreaElement | null>(null);

  // Live (debounced) audience preview: refresh whenever the audience changes.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      audiencePreview.mutate(audience);
    }, 400);
    return () => window.clearTimeout(handle);
    // We intentionally depend only on the serialized audience — calling mutate is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(audience)]);

  // Rich-text-lite: wrap current selection with markers (bold/italic/link).
  const wrapSelection = (kind: "bold" | "italic" | "link") => {
    const ta = messageRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = message.slice(start, end);
    let inserted = "";
    if (kind === "bold") inserted = `**${selected || "bold text"}**`;
    else if (kind === "italic") inserted = `*${selected || "italic text"}*`;
    else if (kind === "link") {
      const url = window.prompt("Link URL", "https://");
      if (!url) return;
      inserted = `[${selected || "link text"}](${url})`;
    }
    const next = message.slice(0, start) + inserted + message.slice(end);
    setMessage(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + inserted.length, start + inserted.length);
    });
  };

  const toggleChannel = (c: BroadcastChannel) =>
    setChannels(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  const applyTemplate = (t: AdminNotificationTemplate) => {
    setMessage(t.body);
    if (t.subject) setSubject(t.subject);
    if (!channels.includes(t.channel)) setChannels(prev => Array.from(new Set([...prev, t.channel])));
    toast({ title: `Loaded template: ${t.name}` });
  };

  const previewAudience = () => {
    audiencePreview.mutate(audience);
  };

  const validate = (mode: "now" | "schedule" | "draft"): string | null => {
    if (!title.trim()) return "Title is required";
    if (!message.trim()) return "Message is required";
    if (channels.length === 0) return "Pick at least one channel";
    if (mode === "schedule" && !scheduledAt) return "Pick a date/time to schedule";
    if (saveAsTemplate && (!templateName.trim() || !templateSlug.trim())) return "Template name and slug are required";
    return null;
  };

  const submit = (mode: "now" | "schedule" | "draft") => {
    const err = validate(mode);
    if (err) { toast({ title: err, variant: "destructive" }); return; }
    if (mode !== "draft" && !isEdit) { setConfirm({ mode: mode as "now" | "schedule" }); return; }
    doSubmit(mode);
  };

  const doSubmit = (mode: "now" | "schedule" | "draft") => {
    const body: CreateAdminBroadcastBody = {
      title: title.trim(),
      message: message.trim(),
      subject: subject.trim() || undefined,
      channels,
      audience,
      priority,
      scheduledAt: mode === "schedule" ? new Date(scheduledAt).toISOString() : null,
      sendNow: mode === "now",
      saveAsTemplate,
      templateName: saveAsTemplate ? templateName.trim() : undefined,
      templateSlug: saveAsTemplate ? templateSlug.trim() : undefined,
    };

    if (isEdit && existing) {
      update.mutate({
        id: existing.id,
        title: body.title,
        message: body.message,
        subject: body.subject,
        channels: body.channels,
        audience: body.audience,
        priority: body.priority,
        scheduledAt: body.scheduledAt,
      }, {
        onSuccess: () => { toast({ title: "Broadcast updated" }); onDone?.(); },
        onError: (e: unknown) => toast({ title: "Update failed", description: (e as Error).message, variant: "destructive" }),
      });
      return;
    }

    create.mutate(body, {
      onSuccess: bc => {
        toast({
          title: mode === "now" ? "Broadcast sent" : mode === "schedule" ? "Broadcast scheduled" : "Saved as draft",
          description: mode === "now" ? "Check Delivery Logs for results" : undefined,
        });
        if (mode === "now") onOpenLogs(bc.id);
        if (!isEdit) {
          setTitle(""); setSubject(""); setMessage(""); setChannels(["in_app"]);
          setPriority("medium"); setAudience({}); setScheduledAt("");
          setSaveAsTemplate(false); setTemplateName(""); setTemplateSlug("");
        }
      },
      onError: (e: unknown) => toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" }),
    });
  };

  const previewData = audiencePreview.data;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {/* Composer */}
      <div className="md:col-span-2 space-y-4 border rounded-lg p-4 bg-white">
        <div>
          <Label>Title</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Internal title (also used as in-app title if no subject)" />
        </div>
        <div>
          <Label>Subject (used for email / in-app heading)</Label>
          <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Optional subject line" />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label>Message</Label>
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="outline" onClick={() => wrapSelection("bold")} title="Bold (**text**)">
                <Bold className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => wrapSelection("italic")} title="Italic (*text*)">
                <Italic className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => wrapSelection("link")} title="Link ([text](url))">
                <LinkIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <Textarea ref={messageRef} value={message} onChange={e => setMessage(e.target.value)} rows={6}
            placeholder="Body — supports {{userName}}, {{userEmail}} variables. Markdown ** * [text](url) renders in email." />
          <p className="text-xs text-slate-500 mt-1">SMS/in-app strip formatting; HTML is not rendered.</p>
        </div>

        <div>
          <Label>Channels</Label>
          <div className="flex flex-wrap gap-2 mt-1">
            {ALL_CHANNELS.map(c => {
              const on = channels.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleChannel(c.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition ${
                    on ? "bg-orange-500 text-white border-orange-500" : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <c.icon className="h-3.5 w-3.5" /> {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Priority</Label>
            <Select value={priority} onValueChange={v => setPriority(v as BroadcastPriority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITIES.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {priority === "urgent" && (
              <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Urgent in-app messages render as a banner.
              </p>
            )}
          </div>
          <div>
            <Label>Schedule for (optional)</Label>
            <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
          </div>
        </div>

        <div className="border-t pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="cursor-pointer">Save this message as a reusable template</Label>
            <Switch checked={saveAsTemplate} onCheckedChange={setSaveAsTemplate} />
          </div>
          {saveAsTemplate && (
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Template name" value={templateName} onChange={e => setTemplateName(e.target.value)} />
              <Input placeholder="unique-slug" value={templateSlug} onChange={e => setTemplateSlug(e.target.value)} />
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          {!isEdit && <Button variant="outline" onClick={() => submit("draft")} disabled={create.isPending}>Save draft</Button>}
          <Button variant="outline" onClick={() => submit("schedule")} disabled={create.isPending || update.isPending}>
            <Calendar className="h-4 w-4 mr-1" /> {isEdit ? "Save schedule" : "Schedule"}
          </Button>
          <Button onClick={() => submit("now")} disabled={create.isPending || update.isPending} className="bg-orange-500 hover:bg-orange-600">
            <Send className="h-4 w-4 mr-1" /> {isEdit ? "Save changes" : "Send now"}
          </Button>
          {isEdit && onDone && <Button variant="ghost" onClick={onDone}>Cancel</Button>}
        </div>
      </div>

      {/* Audience + templates side panel */}
      <div className="space-y-4">
        <AudienceBuilder audience={audience} onChange={setAudience} />
        <div className="border rounded-lg p-3 bg-white">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Audience preview</p>
            <span className="text-xs text-slate-400 flex items-center gap-1">
              {audiencePreview.isPending && <RefreshCw className="h-3 w-3 animate-spin" />} Live
            </span>
          </div>
          {previewData ? (
            <div className="text-sm space-y-1">
              <div><strong className="text-2xl text-orange-600">{previewData.total}</strong> recipients</div>
              <div className="text-xs text-slate-500">
                {previewData.withEmail} with email · {previewData.withPhone} with phone · {previewData.withPush} with push
              </div>
              {previewData.sample.length > 0 && (
                <ul className="mt-2 text-xs text-slate-600 space-y-0.5 max-h-40 overflow-auto">
                  {previewData.sample.map(s => (
                    <li key={s.tenantId}>· {s.name ?? `tenant#${s.tenantId}`} {s.email ? `<${s.email}>` : ""}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500">Adjust audience filters to see live recipient counts.</p>
          )}
        </div>

        <div className="border rounded-lg p-3 bg-white">
          <p className="text-sm font-medium mb-2">Apply a template</p>
          <div className="space-y-1 max-h-56 overflow-auto">
            {templates.data?.data.length ? templates.data.data.map(t => (
              <button key={t.id} type="button" onClick={() => applyTemplate(t)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-100 text-sm">
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-slate-500">{t.slug} · {t.channel}</div>
              </button>
            )) : <p className="text-xs text-slate-500">No templates yet.</p>}
          </div>
        </div>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={open => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.mode === "now" ? "Send broadcast now?" : "Schedule this broadcast?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will reach approximately <strong>{previewData?.total ?? "?"}</strong> recipients across {channels.length} channel(s)
              with priority <strong>{priority}</strong>. This action cannot be undone once sent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const m = confirm?.mode ?? "now"; setConfirm(null); doSubmit(m); }}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Audience builder (combinable filters) ───────────────────────
function AudienceBuilder({ audience, onChange }: { audience: AudienceFilter; onChange: (a: AudienceFilter) => void }) {
  const setStrField = (key: "planStatuses" | "countries" | "cities" | "roles", raw: string) => {
    const arr = raw.split(",").map(s => s.trim()).filter(Boolean);
    onChange({ ...audience, [key]: arr.length ? arr : undefined });
  };
  const setNumField = (key: "tenantIds" | "planIds", raw: string) => {
    const arr = raw.split(",").map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
    onChange({ ...audience, [key]: arr.length ? arr : undefined });
  };

  const isAll = !audience.tenantIds && !audience.planIds && !audience.planStatuses && !audience.countries && !audience.cities && !audience.roles;

  return (
    <div className="border rounded-lg p-3 bg-white">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium">Audience</p>
        {!isAll && <Button size="sm" variant="ghost" onClick={() => onChange({})}>Clear</Button>}
      </div>
      {isAll && <p className="text-xs text-slate-500 mb-2">No filters: all active tenant owners.</p>}
      <div className="space-y-2 text-xs">
        <div>
          <Label className="text-xs">Plan statuses (comma-sep: trial, active, past_due, cancelled)</Label>
          <Input value={(audience.planStatuses ?? []).join(", ")} onChange={e => setStrField("planStatuses", e.target.value)} placeholder="trial, active" />
        </div>
        <div>
          <Label className="text-xs">Plan IDs</Label>
          <Input value={(audience.planIds ?? []).join(", ")} onChange={e => setNumField("planIds", e.target.value)} placeholder="1, 2" />
        </div>
        <div>
          <Label className="text-xs">Tenant IDs</Label>
          <Input value={(audience.tenantIds ?? []).join(", ")} onChange={e => setNumField("tenantIds", e.target.value)} placeholder="42, 88" />
        </div>
        <div>
          <Label className="text-xs">Countries</Label>
          <Input value={(audience.countries ?? []).join(", ")} onChange={e => setStrField("countries", e.target.value)} placeholder="India, UAE" />
        </div>
        <div>
          <Label className="text-xs">Cities</Label>
          <Input value={(audience.cities ?? []).join(", ")} onChange={e => setStrField("cities", e.target.value)} placeholder="Mumbai, Bengaluru" />
        </div>
        <div>
          <Label className="text-xs">Roles (default: owner)</Label>
          <Input value={(audience.roles ?? []).join(", ")} onChange={e => setStrField("roles", e.target.value)} placeholder="owner, manager" />
        </div>
      </div>
      <p className="text-[11px] text-slate-500 mt-2">Filters combine with AND. Empty = all.</p>
    </div>
  );
}

// ─── Scheduled / Sent shared list ────────────────────────────────
function BroadcastRow({
  bc, onOpenLogs, onEdit,
  showResendFailed = false, showSendNow = false, showCancel = false,
}: {
  bc: AdminBroadcast;
  onOpenLogs: (id: number) => void;
  onEdit?: (bc: AdminBroadcast) => void;
  showResendFailed?: boolean;
  showSendNow?: boolean;
  showCancel?: boolean;
}) {
  const send = useSendAdminBroadcast();
  const cancel = useCancelAdminBroadcast();
  const del = useDeleteAdminBroadcast();
  const resend = useResendFailedBroadcast();
  const { toast } = useToast();

  return (
    <div className="border rounded-lg p-3 flex flex-wrap items-start gap-3 bg-white">
      <div className="flex-1 min-w-[260px]">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{bc.title}</span>
          <Badge className={STATUS_TONES[bc.status]}>{bc.status}</Badge>
          <Badge className={PRIORITIES.find(p => p.id === bc.priority)?.tone ?? ""}>{bc.priority}</Badge>
          {bc.channels.map(c => <Badge key={c} variant="outline" className="text-xs">{c}</Badge>)}
        </div>
        <div className="text-xs text-slate-500 mt-1">
          {bc.scheduledAt && <>Scheduled: {new Date(bc.scheduledAt).toLocaleString()} · </>}
          {bc.sentAt && <>Sent: {new Date(bc.sentAt).toLocaleString()} · </>}
          {bc.totalRecipients > 0 && <>{bc.successCount}/{bc.totalRecipients} delivered, {bc.failureCount} failed</>}
        </div>
        <p className="text-sm mt-1 line-clamp-2 text-slate-700">{bc.message}</p>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" onClick={() => onOpenLogs(bc.id)}>
          <ListChecks className="h-3.5 w-3.5 mr-1" /> Logs
        </Button>
        {onEdit && (bc.status === "draft" || bc.status === "scheduled") && (
          <Button size="sm" variant="outline" onClick={() => onEdit(bc)}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>
        )}
        {showSendNow && (
          <Button size="sm" onClick={() => send.mutate(bc.id, {
            onSuccess: () => toast({ title: "Send started" }),
            onError: e => toast({ title: "Send failed", description: (e as Error).message, variant: "destructive" }),
          })} className="bg-orange-500 hover:bg-orange-600">
            <Send className="h-3.5 w-3.5 mr-1" /> Send now
          </Button>
        )}
        {showResendFailed && bc.failureCount > 0 && (
          <Button size="sm" variant="outline" disabled={resend.isPending} onClick={() => resend.mutate(bc.id, {
            onSuccess: r => toast({ title: `Retried ${r.retried}`, description: `${r.succeeded} succeeded, ${r.failed} failed` }),
            onError: e => toast({ title: "Resend failed", description: (e as Error).message, variant: "destructive" }),
          })}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${resend.isPending ? "animate-spin" : ""}`} /> Resend failed
          </Button>
        )}
        {showCancel && (
          <Button size="sm" variant="outline" onClick={() => cancel.mutate(bc.id, {
            onSuccess: () => toast({ title: "Cancelled" }),
          })}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => {
          if (!confirm("Delete this broadcast and its delivery rows?")) return;
          del.mutate(bc.id, { onSuccess: () => toast({ title: "Deleted" }) });
        }}>
          <Trash2 className="h-3.5 w-3.5 text-red-500" />
        </Button>
      </div>
    </div>
  );
}

function ScheduledTab({ onOpenLogs }: { onOpenLogs: (id: number) => void }) {
  const drafts = useAdminBroadcasts("draft");
  const scheduled = useAdminBroadcasts("scheduled");
  const [editing, setEditing] = useState<AdminBroadcast | null>(null);

  if (editing) {
    return <ComposeTab onOpenLogs={onOpenLogs} existing={editing} onDone={() => setEditing(null)} />;
  }

  const allRows = [
    ...(scheduled.data?.data ?? []),
    ...(drafts.data?.data ?? []),
  ];

  return (
    <div className="space-y-2">
      {allRows.length === 0 && <p className="text-sm text-slate-500">No drafts or scheduled broadcasts.</p>}
      {allRows.map(bc => (
        <BroadcastRow key={bc.id} bc={bc} onOpenLogs={onOpenLogs} onEdit={setEditing}
          showSendNow showCancel />
      ))}
    </div>
  );
}

function SentTab({ onOpenLogs }: { onOpenLogs: (id: number) => void }) {
  const PAGE_SIZE = 25;
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"sent" | "sending" | "failed" | "all">("sent");
  const list = useAdminBroadcasts(statusFilter === "all" ? "all" : statusFilter, page, PAGE_SIZE);
  const stats = useAdminBroadcastsStats();
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = list.data?.data ?? [];

  return (
    <div className="space-y-3">
      {stats.data && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Total recipients" value={stats.data.totals.totalRecipients} />
          <Stat label="Delivered" value={stats.data.totals.successCount} tone="text-green-600" />
          <Stat label="Failed" value={stats.data.totals.failureCount} tone="text-red-600" />
        </div>
      )}
      <div className="flex items-center gap-2">
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v as typeof statusFilter); setPage(1); }}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="sending">Sending</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="all">All non-draft</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-slate-500">{total} total</span>
      </div>
      {rows.length === 0 && <p className="text-sm text-slate-500">No broadcasts match this filter.</p>}
      {rows.map(bc => (
        <BroadcastRowWithDetail key={bc.id} bc={bc} onOpenLogs={onOpenLogs} />
      ))}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-sm text-slate-600">Page {page} of {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function BroadcastRowWithDetail({ bc, onOpenLogs }: { bc: AdminBroadcast; onOpenLogs: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const stats = useAdminBroadcastRecipientStats(open ? bc.id : null);

  // Aggregate stats by channel for the detail panel.
  const perChannel = useMemo(() => {
    const map = new Map<BroadcastChannel, Record<string, number>>();
    for (const c of bc.channels) map.set(c, { sent: 0, delivered: 0, failed: 0, queued: 0, skipped: 0 });
    for (const row of stats.data?.data ?? []) {
      const cur = map.get(row.channel) ?? {};
      cur[row.status] = (cur[row.status] ?? 0) + row.count;
      map.set(row.channel, cur);
    }
    return Array.from(map.entries());
  }, [bc.channels, stats.data]);

  return (
    <div className="space-y-2">
      <div className="cursor-pointer" onClick={() => setOpen(o => !o)}>
        <BroadcastRow bc={bc} onOpenLogs={onOpenLogs} showResendFailed />
      </div>
      {open && (
        <div className="border rounded-lg p-3 bg-slate-50 ml-4 text-sm">
          <p className="font-medium text-xs text-slate-500 mb-2">Per-channel breakdown</p>
          {perChannel.length === 0 && <p className="text-xs text-slate-500">No deliveries recorded.</p>}
          <div className="space-y-1">
            {perChannel.map(([channel, counts]) => (
              <div key={channel} className="flex items-center gap-3 text-xs">
                <Badge variant="outline" className="text-xs w-20 justify-center">{channel}</Badge>
                <span>queued: <strong>{counts.queued ?? 0}</strong></span>
                <span>sent: <strong className="text-green-700">{counts.sent ?? 0}</strong></span>
                <span>delivered: <strong className="text-emerald-700">{counts.delivered ?? 0}</strong></span>
                <span>failed: <strong className="text-red-700">{counts.failed ?? 0}</strong></span>
                <span>skipped: <strong className="text-slate-500">{counts.skipped ?? 0}</strong></span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="border rounded-lg p-3 bg-white">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

// ─── Templates ───────────────────────────────────────────────────
function TemplatesTab() {
  const templates = useAdminNotificationTemplates();
  const [editing, setEditing] = useState<AdminNotificationTemplate | null | "new">(null);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")} className="bg-orange-500 hover:bg-orange-600">
          <Plus className="h-4 w-4 mr-1" /> New template
        </Button>
      </div>
      <div className="space-y-2">
        {templates.data?.data.length === 0 && <p className="text-sm text-slate-500">No templates yet.</p>}
        {templates.data?.data.map(t => (
          <TemplateRow key={t.id} t={t} onEdit={() => setEditing(t)} />
        ))}
      </div>
      {editing !== null && <TemplateEditor template={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TemplateRow({ t, onEdit }: { t: AdminNotificationTemplate; onEdit: () => void }) {
  const del = useDeleteAdminNotificationTemplate();
  const { toast } = useToast();
  return (
    <div className="border rounded-lg p-3 flex items-start gap-3 bg-white">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{t.name}</span>
          <Badge variant="outline" className="text-xs">{t.slug}</Badge>
          <Badge className="text-xs bg-slate-100 text-slate-700">{t.channel}</Badge>
        </div>
        {t.subject && <p className="text-xs text-slate-500 mt-1">{t.subject}</p>}
        <p className="text-sm text-slate-700 mt-1 line-clamp-2">{t.body}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></Button>
      <Button size="sm" variant="ghost" onClick={() => {
        if (!confirm(`Delete template "${t.name}"?`)) return;
        del.mutate(t.id, { onSuccess: () => toast({ title: "Deleted" }) });
      }}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
    </div>
  );
}

function TemplateEditor({ template, onClose }: { template: AdminNotificationTemplate | null; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(template?.name ?? "");
  const [slug, setSlug] = useState(template?.slug ?? "");
  const [channel, setChannel] = useState<BroadcastChannel>(template?.channel ?? "in_app");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const create = useCreateAdminNotificationTemplate();
  const update = useUpdateAdminNotificationTemplate();
  const isEdit = !!template;
  const busy = create.isPending || update.isPending;

  const save = () => {
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
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{isEdit ? "Edit template" : "New template"}</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div><Label>Slug</Label><Input value={slug} onChange={e => setSlug(e.target.value)} disabled={isEdit} /></div>
        </div>
        <div>
          <Label>Channel</Label>
          <Select value={channel} onValueChange={v => setChannel(v as BroadcastChannel)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ALL_CHANNELS.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label>Subject</Label><Input value={subject} onChange={e => setSubject(e.target.value)} /></div>
        <div><Label>Body</Label><Textarea rows={6} value={body} onChange={e => setBody(e.target.value)} /></div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy} className="bg-orange-500 hover:bg-orange-600">{isEdit ? "Save" : "Create"}</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Delivery Logs ───────────────────────────────────────────────
function DeliveryLogsTab({ broadcastId, setBroadcastId }: { broadcastId: number | null; setBroadcastId: (id: number | null) => void }) {
  const all = useAdminBroadcasts("all", 1, 200);
  const [channel, setChannel] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [tenantId, setTenantId] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const recipients = useAdminBroadcastRecipients(broadcastId, {
    channel, status, search,
    tenantId: tenantId ? Number(tenantId) : null,
    dateFrom: dateFrom ? new Date(dateFrom).toISOString() : "",
    dateTo: dateTo ? new Date(dateTo).toISOString() : "",
  });
  const retry = useRetryBroadcastRecipient();
  const resend = useResendFailedBroadcast();
  const { toast } = useToast();

  const broadcasts = all.data?.data ?? [];
  const selected = useMemo(() => broadcasts.find(b => b.id === broadcastId) ?? null, [broadcasts, broadcastId]);

  return (
    <div className="grid gap-3 md:grid-cols-[260px_1fr]">
      <div className="border rounded-lg p-2 bg-white max-h-[600px] overflow-auto">
        <p className="text-xs font-medium text-slate-500 px-2 py-1">Broadcasts</p>
        {broadcasts.length === 0 && <p className="text-xs text-slate-500 px-2 py-2">None yet.</p>}
        {broadcasts.map(b => (
          <button key={b.id} onClick={() => setBroadcastId(b.id)}
            className={`w-full text-left px-2 py-1.5 rounded text-sm ${broadcastId === b.id ? "bg-orange-50 text-orange-700" : "hover:bg-slate-100"}`}>
            <div className="font-medium truncate">{b.title}</div>
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <Badge className={`${STATUS_TONES[b.status]} text-[10px] px-1`}>{b.status}</Badge>
              {b.totalRecipients > 0 && <span>· {b.successCount}/{b.totalRecipients}</span>}
            </div>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {!selected && <p className="text-sm text-slate-500">Select a broadcast to view per-recipient delivery logs.</p>}
        {selected && (
          <>
            <div className="border rounded-lg p-3 bg-white">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="font-medium">{selected.title}</p>
                  <p className="text-xs text-slate-500">{selected.channels.join(", ")} · priority {selected.priority}</p>
                </div>
                {selected.failureCount > 0 && (
                  <Button size="sm" variant="outline" disabled={resend.isPending} onClick={() => resend.mutate(selected.id, {
                    onSuccess: r => toast({ title: `Retried ${r.retried}`, description: `${r.succeeded} succeeded` }),
                  })}>
                    <RefreshCw className={`h-3.5 w-3.5 mr-1 ${resend.isPending ? "animate-spin" : ""}`} /> Resend all failed
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border rounded-lg p-2 bg-white">
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  {ALL_CHANNELS.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="queued">Queued</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="skipped">Skipped</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Tenant ID" value={tenantId} onChange={e => setTenantId(e.target.value.replace(/[^0-9]/g, ""))} className="w-[110px]" />
              <Input type="datetime-local" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-[200px]" title="From" />
              <Input type="datetime-local" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-[200px]" title="To" />
              <Input placeholder="Search recipient or error…" value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-[200px]" />
              {(channel !== "all" || status !== "all" || search || tenantId || dateFrom || dateTo) && (
                <Button size="sm" variant="ghost" onClick={() => {
                  setChannel("all"); setStatus("all"); setSearch(""); setTenantId(""); setDateFrom(""); setDateTo("");
                }}>Clear</Button>
              )}
            </div>

            <div className="border rounded-lg bg-white overflow-auto max-h-[500px]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Channel</th>
                    <th className="text-left p-2">Recipient</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">When</th>
                    <th className="text-left p-2">Error</th>
                    <th className="text-right p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.data?.data.length === 0 && (
                    <tr><td colSpan={6} className="p-4 text-center text-slate-500 text-sm">No deliveries match these filters.</td></tr>
                  )}
                  {recipients.data?.data.map((d: AdminBroadcastDelivery) => (
                    <tr key={d.id} className="border-t">
                      <td className="p-2"><Badge variant="outline" className="text-xs">{d.channel}</Badge></td>
                      <td className="p-2 max-w-[200px] truncate" title={d.recipient ?? ""}>{d.recipient ?? "—"}</td>
                      <td className="p-2"><Badge className={DELIVERY_TONES[d.status]}>{d.status}</Badge></td>
                      <td className="p-2 text-xs text-slate-500">{d.sentAt ? new Date(d.sentAt).toLocaleString() : new Date(d.createdAt).toLocaleString()}</td>
                      <td className="p-2 text-xs text-red-600 max-w-[260px] truncate" title={d.error ?? ""}>{d.error ?? ""}</td>
                      <td className="p-2 text-right">
                        {d.status === "failed" && (
                          <Button size="sm" variant="outline" disabled={retry.isPending}
                            onClick={() => retry.mutate({ broadcastId: selected.id, deliveryId: d.id }, {
                              onSuccess: r => toast({ title: r.status === "sent" ? "Retried successfully" : `Retry ${r.status}`, description: r.error ?? undefined }),
                              onError: e => toast({ title: "Retry failed", description: (e as Error).message, variant: "destructive" }),
                            })}>
                            <RefreshCw className="h-3 w-3 mr-1" /> Retry
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
