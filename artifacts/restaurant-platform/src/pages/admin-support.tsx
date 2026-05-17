import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout as Layout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPost, apiAction } from "@/lib/api";
import { LifeBuoy, ArrowLeft, Clock, AlertTriangle, Send, Loader2, Plus, Pencil, Trash2, Save, X, Paperclip, Settings2, Inbox, Phone, Activity, Star, Zap, CheckCircle2 } from "lucide-react";

type Priority = "low" | "normal" | "high" | "urgent";
type Status = "open" | "pending" | "in_progress" | "waiting_customer" | "resolved" | "closed";

interface Category { id: number; name: string; slug: string; description: string | null; defaultPriority: Priority; firstResponseHours: number | null; resolutionHours: number | null; isActive: boolean; sortOrder: number; }
interface SlaInfo { firstResponseRemainingMs: number | null; resolutionRemainingMs: number | null; firstResponseBreached: boolean; resolutionBreached: boolean; isPaused: boolean; }
interface Ticket {
  id: number; ticketNumber: string; subject: string; description: string; status: Status; priority: Priority;
  createdAt: string; updatedAt: string; assigneeId: number | null;
  category: Category | null;
  requester: { id: number; name: string; email: string } | null;
  assignee: { id: number; name: string; email: string } | null;
  tenant: { id: number; name: string; slug: string } | null;
  sla: SlaInfo; replyCount: number;
  slaFirstResponseHours: number | null; slaResolutionHours: number | null;
}
interface Reply { id: number; body: string; createdAt: string; authorName: string | null; authorIsAdmin: boolean; isInternal: boolean; }
interface Attachment { id: number; fileName: string; size: number; replyId: number | null; isInternal: boolean; }
interface Event { id: number; type: string; createdAt: string; actorName: string | null; actorIsAdmin: boolean; fromValue: string | null; toValue: string | null; }
type SupportTier = "standard" | "priority" | "enterprise";
interface SlaEscalationStep { afterMinutes: number; level: number; notifyRole?: "support_agent" | "support_lead" | "support_manager" | "engineering_oncall" | "executive"; notifyEmails?: string[]; }
interface SlaTierConfig {
  firstResponseMultiplier: number;
  resolutionMultiplier: number;
  emergencyEnabled: boolean;
  callbackEnabled: boolean;
}
interface SlaSettings {
  id: number;
  lowFirstResponseHours: number; normalFirstResponseHours: number; highFirstResponseHours: number; urgentFirstResponseHours: number;
  lowResolutionHours: number; normalResolutionHours: number; highResolutionHours: number; urgentResolutionHours: number;
  maxAttachmentMb: number;
  escalationMatrix?: Partial<Record<Priority, SlaEscalationStep[]>> | null;
  tierConfig?: Partial<Record<SupportTier, SlaTierConfig>> | null;
  liveChatUrl?: string | null;
  statusPageEnabled?: boolean;
  statusPageTitle?: string | null;
  statusPageDescription?: string | null;
}
interface CallbackRequest {
  id: number; tenantId: number; phone: string; preferredTime: string | null; topic: string | null; notes: string | null;
  status: "pending" | "acknowledged" | "completed" | "cancelled"; createdAt: string; acknowledgedAt: string | null; completedAt: string | null;
  handlerNote: string | null;
}
interface Incident {
  id: number; title: string; body: string; status: "investigating" | "identified" | "monitoring" | "resolved";
  severity: "minor" | "major" | "critical"; affectedComponents: string[]; isPublished: boolean;
  startedAt: string; resolvedAt: string | null;
}
interface IncidentUpdate { id: number; status: string; body: string; createdAt: string; }
interface Tenant { id: number; name: string; slug: string; }
interface AdminUser { id: number; name: string; email: string; }
interface AttachmentDraft { objectPath: string; fileName: string; contentType: string; size: number; }

const STATUS_LABELS: Record<Status, string> = {
  open: "Open", pending: "Pending", in_progress: "In Progress", waiting_customer: "Waiting Customer", resolved: "Resolved", closed: "Closed",
};
const STATUS_COLORS: Record<Status, string> = {
  open: "bg-blue-100 text-blue-800", pending: "bg-yellow-100 text-yellow-800",
  in_progress: "bg-purple-100 text-purple-800", waiting_customer: "bg-orange-100 text-orange-800",
  resolved: "bg-green-100 text-green-800", closed: "bg-gray-100 text-gray-800",
};
const PRIORITY_COLORS: Record<Priority, string> = {
  low: "bg-gray-100 text-gray-700", normal: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700", urgent: "bg-red-100 text-red-700",
};

function formatRemaining(ms: number | null): string {
  if (ms === null) return "—";
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  return `${ms < 0 ? "-" : ""}${h}h ${m}m`;
}

export default function AdminSupportPage() {
  const [tab, setTab] = useState<"queue" | "categories" | "settings" | "callbacks" | "incidents">("queue");
  const [openTicketId, setOpenTicketId] = useState<number | null>(null);

  if (openTicketId !== null) {
    return <AdminTicketDetail id={openTicketId} onBack={() => setOpenTicketId(null)} />;
  }

  return (
    <Layout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><LifeBuoy className="h-6 w-6" />Support Management</h1>
            <p className="text-sm text-muted-foreground">Tenant tickets, categories, and SLA configuration.</p>
          </div>
        </div>
        <div className="flex gap-2 border-b">
          <TabBtn active={tab === "queue"} onClick={() => setTab("queue")} icon={Inbox} label="Tickets" />
          <TabBtn active={tab === "callbacks"} onClick={() => setTab("callbacks")} icon={Phone} label="Callbacks" />
          <TabBtn active={tab === "incidents"} onClick={() => setTab("incidents")} icon={Activity} label="Incidents" />
          <TabBtn active={tab === "categories"} onClick={() => setTab("categories")} icon={Pencil} label="Categories" />
          <TabBtn active={tab === "settings"} onClick={() => setTab("settings")} icon={Settings2} label="SLA Settings" />
        </div>
        {tab === "queue" && <TicketQueue onOpen={setOpenTicketId} />}
        {tab === "callbacks" && <CallbackQueue />}
        {tab === "incidents" && <IncidentManager />}
        {tab === "categories" && <CategoryManager />}
        {tab === "settings" && <SlaSettingsManager />}
      </div>
    </Layout>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof LifeBuoy; label: string }) {
  return (
    <button onClick={onClick} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
      <Icon className="h-4 w-4" />{label}
    </button>
  );
}

function TicketQueue({ onOpen }: { onOpen: (id: number) => void }) {
  const [status, setStatus] = useState<string>("all");
  const [priority, setPriority] = useState<string>("all");
  const [tenantId, setTenantId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [breaching, setBreaching] = useState(false);

  const tenants = useQuery({ queryKey: ["admin-support-tenants"], queryFn: () => apiGet<{ data: Tenant[] }>("/admin/support/tenants") });
  const list = useQuery({
    queryKey: ["admin-support-tickets", status, priority, tenantId, search, breaching],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (priority !== "all") params.set("priority", priority);
      if (tenantId) params.set("tenantId", tenantId);
      if (search) params.set("search", search);
      if (breaching) params.set("slaBreach", "true");
      return apiGet<{ data: Ticket[]; total: number; counters: Record<string, number>; breachingCount: number }>(
        `/admin/support/tickets?${params.toString()}`
      );
    },
    refetchInterval: 30_000,
  });

  const counters = list.data?.counters ?? {};
  const tickets = list.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {(["open", "pending", "in_progress", "waiting_customer", "resolved", "closed"] as Status[]).map(s => (
          <button key={s} onClick={() => setStatus(status === s ? "all" : s)}
            className={`border rounded-lg p-3 text-left ${status === s ? "ring-2 ring-primary" : ""}`}>
            <div className="text-xs text-muted-foreground">{STATUS_LABELS[s]}</div>
            <div className="text-2xl font-bold">{counters[s] ?? 0}</div>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder="Search tickets..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
        <select className="border rounded-md px-3 py-2 bg-background text-sm" value={priority} onChange={e => setPriority(e.target.value)}>
          <option value="all">All priorities</option>
          <option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
        </select>
        <select className="border rounded-md px-3 py-2 bg-background text-sm" value={tenantId} onChange={e => setTenantId(e.target.value)}>
          <option value="">All tenants</option>
          {(tenants.data?.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={breaching} onChange={e => setBreaching(e.target.checked)} />
          SLA breached only ({list.data?.breachingCount ?? 0})
        </label>
      </div>
      <div className="border rounded-lg divide-y">
        {list.isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading...</div>
        ) : tickets.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No tickets match the filters.</div>
        ) : tickets.map(t => (
          <button key={t.id} onClick={() => onOpen(t.id)} className="w-full text-left p-4 hover:bg-accent flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{t.ticketNumber}</span>
                <Badge className={STATUS_COLORS[t.status]}>{STATUS_LABELS[t.status]}</Badge>
                <Badge className={PRIORITY_COLORS[t.priority]}>{t.priority}</Badge>
                {t.category && <Badge variant="outline">{t.category.name}</Badge>}
                {(t.sla.firstResponseBreached || t.sla.resolutionBreached) && <Badge className="bg-red-100 text-red-800"><AlertTriangle className="h-3 w-3 mr-1" />SLA</Badge>}
              </div>
              <div className="mt-1 font-medium truncate">{t.subject}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {t.tenant?.name ?? "—"} · Requester {t.requester?.name ?? "—"} · {t.replyCount} replies · Updated {new Date(t.updatedAt).toLocaleString()}
              </div>
            </div>
            <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
              <div>Assignee: {t.assignee?.name ?? <span className="italic">Unassigned</span>}</div>
              <div><Clock className="h-3 w-3 inline mr-1" />FR: {formatRemaining(t.sla.firstResponseRemainingMs)}</div>
              <div><Clock className="h-3 w-3 inline mr-1" />RS: {formatRemaining(t.sla.resolutionRemainingMs)}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function AdminTicketDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);

  const detail = useQuery({
    queryKey: ["admin-support-ticket", id],
    queryFn: () => apiGet<{ ticket: Ticket; replies: Reply[]; attachments: Attachment[]; events: Event[] }>(`/admin/support/tickets/${id}`),
    refetchInterval: 30_000,
  });
  const cats = useQuery({ queryKey: ["support-categories"], queryFn: () => apiGet<{ data: Category[] }>("/support/categories") });
  const admins = useQuery({ queryKey: ["admin-support-admins"], queryFn: () => apiGet<{ data: AdminUser[] }>("/admin/support/admins") });

  const patch = useMutation({
    mutationFn: (body: Partial<Ticket>) => apiAction(`/admin/support/tickets/${id}`, "PATCH", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-support-ticket", id] });
      qc.invalidateQueries({ queryKey: ["admin-support-tickets"] });
      toast({ title: "Updated" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const send = useMutation({
    mutationFn: () => apiPost(`/admin/support/tickets/${id}/replies`, { body: reply, isInternal: internal, attachments }),
    onSuccess: () => {
      setReply(""); setInternal(false); setAttachments([]);
      qc.invalidateQueries({ queryKey: ["admin-support-ticket", id] });
      qc.invalidateQueries({ queryKey: ["admin-support-tickets"] });
      toast({ title: internal ? "Internal note added" : "Reply sent" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const close = useMutation({
    mutationFn: () => apiPost(`/admin/support/tickets/${id}/close`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-support-ticket", id] }); qc.invalidateQueries({ queryKey: ["admin-support-tickets"] }); toast({ title: "Closed" }); },
  });
  const reopen = useMutation({
    mutationFn: () => apiPost(`/admin/support/tickets/${id}/reopen`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-support-ticket", id] }); qc.invalidateQueries({ queryKey: ["admin-support-tickets"] }); toast({ title: "Reopened" }); },
  });

  const t = detail.data?.ticket;
  const allItems = useMemo(() => {
    const replies = (detail.data?.replies ?? []).map(r => ({ kind: "reply" as const, at: r.createdAt, payload: r }));
    const events = (detail.data?.events ?? []).map(e => ({ kind: "event" as const, at: e.createdAt, payload: e }));
    return [...replies, ...events].sort((a, b) => a.at.localeCompare(b.at));
  }, [detail.data]);

  return (
    <Layout>
      <div className="p-6 space-y-4 max-w-6xl mx-auto">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-2" />Back to queue</Button>
        {!t ? <div className="text-center py-12 text-muted-foreground">Loading...</div> : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <div className="border rounded-lg p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{t.ticketNumber}</span>
                  <Badge className={STATUS_COLORS[t.status]}>{STATUS_LABELS[t.status]}</Badge>
                  <Badge className={PRIORITY_COLORS[t.priority]}>{t.priority}</Badge>
                  {(t.sla.firstResponseBreached || t.sla.resolutionBreached) && <Badge className="bg-red-100 text-red-800"><AlertTriangle className="h-3 w-3 mr-1" />SLA breached</Badge>}
                  {t.sla.isPaused && <Badge variant="outline">SLA paused</Badge>}
                </div>
                <h1 className="text-xl font-semibold mt-2">{t.subject}</h1>
                <div className="text-sm whitespace-pre-wrap mt-2">{t.description}</div>
                <div className="text-xs text-muted-foreground mt-3">
                  Tenant: {t.tenant?.name} · By {t.requester?.name ?? "—"} ({t.requester?.email ?? "—"}) · {new Date(t.createdAt).toLocaleString()}
                </div>
              </div>

              <div className="space-y-3">
                {allItems.map((it, i) => it.kind === "reply" ? (
                  <div key={i} className={`border rounded-lg p-3 ${it.payload.isInternal ? "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200" : it.payload.authorIsAdmin ? "bg-blue-50/40 dark:bg-blue-950/30" : ""}`}>
                    <div className="text-xs text-muted-foreground mb-1">
                      <span className="font-medium">{it.payload.authorName ?? "User"}</span>
                      {it.payload.authorIsAdmin && <Badge variant="outline" className="ml-2">Support</Badge>}
                      {it.payload.isInternal && <Badge className="ml-2 bg-yellow-200 text-yellow-900">Internal Note</Badge>}
                      <span className="ml-2">{new Date(it.payload.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="text-sm whitespace-pre-wrap">{it.payload.body}</div>
                    <ReplyAttachments ticketId={id} replyId={it.payload.id} all={detail.data?.attachments ?? []} />
                  </div>
                ) : (
                  <div key={i} className="text-xs text-muted-foreground italic px-3">
                    · {formatEvent(it.payload)} — {new Date(it.payload.createdAt).toLocaleString()}
                  </div>
                ))}
              </div>

              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Reply</Label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} />
                    Internal note (only visible to admins)
                  </label>
                </div>
                <Textarea rows={4} value={reply} onChange={e => setReply(e.target.value)} placeholder={internal ? "Internal note..." : "Reply to customer..."} />
                <AttachmentPicker attachments={attachments} onChange={setAttachments} />
                <div className="flex justify-end">
                  <Button onClick={() => send.mutate()} disabled={!reply.trim() || send.isPending}>
                    {send.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                    {internal ? "Save Note" : "Send Reply"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="border rounded-lg p-4 space-y-3">
                <h3 className="font-semibold">Properties</h3>
                <div>
                  <Label>Status</Label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={t.status} onChange={e => patch.mutate({ status: e.target.value as Status })}>
                    {(Object.keys(STATUS_LABELS) as Status[]).map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Priority</Label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={t.priority} onChange={e => patch.mutate({ priority: e.target.value as Priority })}>
                    <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <Label>Category</Label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={t.category?.id ?? ""} onChange={e => patch.mutate({ categoryId: e.target.value ? Number(e.target.value) : null } as Partial<Ticket>)}>
                    <option value="">— None —</option>
                    {(cats.data?.data ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Assignee</Label>
                  <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={t.assigneeId ?? ""} onChange={e => patch.mutate({ assigneeId: e.target.value ? Number(e.target.value) : null } as Partial<Ticket>)}>
                    <option value="">— Unassigned —</option>
                    {(admins.data?.data ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">First Resp (h)</Label>
                    <Input type="number" min={0} defaultValue={t.slaFirstResponseHours ?? ""} placeholder="default"
                      onBlur={e => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== t.slaFirstResponseHours) patch.mutate({ slaFirstResponseHours: v } as Partial<Ticket>); }} />
                  </div>
                  <div>
                    <Label className="text-xs">Resolve (h)</Label>
                    <Input type="number" min={0} defaultValue={t.slaResolutionHours ?? ""} placeholder="default"
                      onBlur={e => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== t.slaResolutionHours) patch.mutate({ slaResolutionHours: v } as Partial<Ticket>); }} />
                  </div>
                </div>
              </div>

              <div className="border rounded-lg p-4 space-y-2 text-sm">
                <h3 className="font-semibold">SLA</h3>
                <div className="text-xs"><Clock className="h-3 w-3 inline mr-1" />First response: {formatRemaining(t.sla.firstResponseRemainingMs)}</div>
                <div className="text-xs"><Clock className="h-3 w-3 inline mr-1" />Resolution: {formatRemaining(t.sla.resolutionRemainingMs)}</div>
              </div>

              <div className="border rounded-lg p-4 space-y-2">
                {t.status !== "closed" ? (
                  <Button variant="outline" className="w-full" onClick={() => close.mutate()}>Close Ticket</Button>
                ) : (
                  <Button variant="outline" className="w-full" onClick={() => reopen.mutate()}>Reopen Ticket</Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function ReplyAttachments({ ticketId, replyId, all }: { ticketId: number; replyId: number | null; all: Attachment[] }) {
  const matching = all.filter(a => a.replyId === replyId);
  if (matching.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      {matching.map(a => (
        <a key={a.id} href={`/api/support/tickets/${ticketId}/attachments/${a.id}/download`}
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mr-2">
          <Paperclip className="h-3 w-3" />{a.fileName} {a.isInternal && <Badge className="ml-1 bg-yellow-100 text-yellow-800">internal</Badge>}
        </a>
      ))}
    </div>
  );
}

function AttachmentPicker({ attachments, onChange }: { attachments: AttachmentDraft[]; onChange: (a: AttachmentDraft[]) => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const handle = async (file: File) => {
    setBusy(true);
    try {
      const contentType = file.type || "application/octet-stream";
      const presign = await apiPost<{ uploadURL: string; objectPath: string; maxBytes?: number }>(
        `/support/tickets/uploads/request-url`,
        { name: file.name, size: file.size, contentType },
      );
      if (presign.maxBytes && file.size > presign.maxBytes) {
        throw new Error(`File is too large (${Math.round(file.size / 1024)} KB). Max ${Math.round(presign.maxBytes / 1024)} KB.`);
      }
      const put = await fetch(presign.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": contentType } });
      if (!put.ok) {
        let detail = "";
        try { detail = (await put.text()).slice(0, 200); } catch { /* ignore */ }
        throw new Error(`Couldn't upload the file to storage (status ${put.status})${detail ? `: ${detail}` : ""}`);
      }
      // Finalize with a short retry window so a brief storage propagation
      // delay doesn't surface as a hard error.
      let lastErr: unknown;
      for (const wait of [0, 400, 900]) {
        if (wait) await new Promise(r => setTimeout(r, wait));
        try {
          await apiPost(`/support/tickets/uploads/finalize`, { objectPath: presign.objectPath });
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          const status = (e as { status?: number })?.status;
          if (status !== 404) break;
        }
      }
      if (lastErr) throw lastErr;
      onChange([...attachments, { objectPath: presign.objectPath, fileName: file.name, contentType, size: file.size }]);
    } catch (e) { toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div className="flex items-center gap-2">
        <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 border rounded-md hover:bg-accent text-sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}Add file
          <input type="file" className="hidden" disabled={busy} onChange={async e => { const f = e.target.files?.[0]; if (f) { await handle(f); e.target.value = ""; } }} />
        </label>
      </div>
      {attachments.length > 0 && (
        <ul className="mt-2 space-y-1">
          {attachments.map((a, i) => (
            <li key={i} className="flex items-center justify-between text-sm p-2 border rounded">
              <span className="truncate">{a.fileName} <span className="text-muted-foreground">({Math.round(a.size / 1024)} KB)</span></span>
              <Button size="icon" variant="ghost" onClick={() => onChange(attachments.filter((_, j) => j !== i))}><X className="h-3 w-3" /></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryManager() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["admin-support-categories"], queryFn: () => apiGet<{ data: Category[] }>("/admin/support/categories") });
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);

  const remove = useMutation({
    mutationFn: (id: number) => apiAction(`/admin/support/categories/${id}`, undefined, "DELETE"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-support-categories"] }); toast({ title: "Deleted" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-2" />New Category</Button>
      </div>
      <div className="border rounded-lg divide-y">
        {(list.data?.data ?? []).map(c => (
          <div key={c.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium">{c.name} <span className="text-xs text-muted-foreground font-mono">({c.slug})</span></div>
              <div className="text-xs text-muted-foreground">{c.description || "—"}</div>
              <div className="text-xs mt-1 flex gap-2">
                <Badge className={PRIORITY_COLORS[c.defaultPriority]}>{c.defaultPriority}</Badge>
                <span>FR: {c.firstResponseHours ?? "default"}h</span>
                <span>RS: {c.resolutionHours ?? "default"}h</span>
                {!c.isActive && <Badge variant="outline">inactive</Badge>}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="icon" variant="ghost" onClick={() => setEditing(c)}><Pencil className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Delete "${c.name}"? Tickets in this category will become uncategorized.`)) remove.mutate(c.id); }}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
        ))}
      </div>
      {(editing || creating) && <CategoryDialog initial={editing} onClose={() => { setEditing(null); setCreating(false); }} />}
    </div>
  );
}

function CategoryDialog({ initial, onClose }: { initial: Category | null; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [defaultPriority, setDefaultPriority] = useState<Priority>(initial?.defaultPriority ?? "normal");
  const [firstResponseHours, setFRH] = useState<string>(initial?.firstResponseHours?.toString() ?? "");
  const [resolutionHours, setRH] = useState<string>(initial?.resolutionHours?.toString() ?? "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [sortOrder, setSortOrder] = useState<string>(String(initial?.sortOrder ?? 0));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name, slug, description: description || null, defaultPriority,
        firstResponseHours: firstResponseHours === "" ? null : Number(firstResponseHours),
        resolutionHours: resolutionHours === "" ? null : Number(resolutionHours),
        isActive, sortOrder: Number(sortOrder) || 0,
      };
      return initial
        ? apiAction(`/admin/support/categories/${initial.id}`, "PATCH", body)
        : apiPost("/admin/support/categories", body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-support-categories"] }); toast({ title: "Saved" }); onClose(); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-lg shadow-lg max-w-lg w-full">
        <div className="p-6 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">{initial ? "Edit Category" : "New Category"}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="p-6 space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div><Label>Slug</Label><Input value={slug} onChange={e => setSlug(e.target.value)} disabled={!!initial} /></div>
          <div><Label>Description</Label><Textarea value={description ?? ""} onChange={e => setDescription(e.target.value)} rows={2} /></div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>Default Priority</Label>
              <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={defaultPriority} onChange={e => setDefaultPriority(e.target.value as Priority)}>
                <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
              </select>
            </div>
            <div><Label>First Resp (h)</Label><Input type="number" min={0} value={firstResponseHours} onChange={e => setFRH(e.target.value)} placeholder="default" /></div>
            <div><Label>Resolve (h)</Label><Input type="number" min={0} value={resolutionHours} onChange={e => setRH(e.target.value)} placeholder="default" /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Sort Order</Label><Input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} /></div>
            <label className="flex items-end gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />Active</label>
          </div>
        </div>
        <div className="p-6 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!name.trim() || !slug.trim() || save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function SlaSettingsManager() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["admin-support-sla"], queryFn: () => apiGet<SlaSettings>("/admin/support/sla-settings") });
  const [draft, setDraft] = useState<Partial<SlaSettings>>({});

  const save = useMutation({
    mutationFn: () => apiAction("/admin/support/sla-settings", "PUT", draft),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-support-sla"] }); setDraft({}); toast({ title: "Saved" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  if (!settings.data) return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  const merged = { ...settings.data, ...draft } as SlaSettings;

  const Field = ({ label, k }: { label: string; k: keyof SlaSettings }) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={0} value={(merged[k] as number) ?? 0} onChange={e => setDraft({ ...draft, [k]: Number(e.target.value) })} />
    </div>
  );

  const tierConfig: Record<SupportTier, SlaTierConfig> = {
    standard: { firstResponseMultiplier: 1, resolutionMultiplier: 1, emergencyEnabled: false, callbackEnabled: false },
    priority: { firstResponseMultiplier: 0.5, resolutionMultiplier: 0.6, emergencyEnabled: true, callbackEnabled: true },
    enterprise: { firstResponseMultiplier: 0.25, resolutionMultiplier: 0.4, emergencyEnabled: true, callbackEnabled: true },
    ...(merged.tierConfig ?? {}),
  } as Record<SupportTier, SlaTierConfig>;

  const setTier = (tier: SupportTier, patch: Partial<SlaTierConfig>) => {
    const next = { ...tierConfig, [tier]: { ...tierConfig[tier], ...patch } };
    setDraft({ ...draft, tierConfig: next });
  };

  const matrix: Partial<Record<Priority, SlaEscalationStep[]>> = merged.escalationMatrix ?? {};
  const setMatrix = (priority: Priority, steps: SlaEscalationStep[]) => {
    setDraft({ ...draft, escalationMatrix: { ...matrix, [priority]: steps } });
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="border rounded-lg p-4">
        <h3 className="font-semibold mb-3">First Response SLA (hours)</h3>
        <div className="grid grid-cols-4 gap-3">
          <Field label="Low" k="lowFirstResponseHours" />
          <Field label="Normal" k="normalFirstResponseHours" />
          <Field label="High" k="highFirstResponseHours" />
          <Field label="Urgent" k="urgentFirstResponseHours" />
        </div>
      </div>
      <div className="border rounded-lg p-4">
        <h3 className="font-semibold mb-3">Resolution SLA (hours)</h3>
        <div className="grid grid-cols-4 gap-3">
          <Field label="Low" k="lowResolutionHours" />
          <Field label="Normal" k="normalResolutionHours" />
          <Field label="High" k="highResolutionHours" />
          <Field label="Urgent" k="urgentResolutionHours" />
        </div>
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="font-semibold">Plan Tiers</h3>
        <p className="text-xs text-muted-foreground">SLA hours above are multiplied by these tier factors. Emergency & callback toggles gate the features per tier.</p>
        <div className="space-y-2">
          {(["standard", "priority", "enterprise"] as SupportTier[]).map(tier => {
            const c = tierConfig[tier];
            return (
              <div key={tier} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end border rounded p-2">
                <div className="md:col-span-1"><Badge variant="outline" className="capitalize">{tier}</Badge></div>
                <div>
                  <Label className="text-xs">1st-response ×</Label>
                  <Input type="number" step="0.05" min={0} value={c.firstResponseMultiplier}
                    onChange={e => setTier(tier, { firstResponseMultiplier: Number(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">Resolution ×</Label>
                  <Input type="number" step="0.05" min={0} value={c.resolutionMultiplier}
                    onChange={e => setTier(tier, { resolutionMultiplier: Number(e.target.value) })} />
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.emergencyEnabled}
                  onChange={e => setTier(tier, { emergencyEnabled: e.target.checked })} />Emergency</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.callbackEnabled}
                  onChange={e => setTier(tier, { callbackEnabled: e.target.checked })} />Callback</label>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="font-semibold">Escalation Matrix</h3>
        <p className="text-xs text-muted-foreground">Per-priority escalation steps fired by the breach sweep. <em>afterMinutes</em> is measured from ticket creation.</p>
        {(["urgent", "high", "normal", "low"] as Priority[]).map(p => {
          const steps = matrix[p] ?? [];
          return (
            <div key={p} className="border rounded p-2">
              <div className="flex items-center justify-between mb-2">
                <Badge className={PRIORITY_COLORS[p]}>{p}</Badge>
                <Button size="sm" variant="outline"
                  onClick={() => setMatrix(p, [...steps, { afterMinutes: 60, level: steps.length + 1, notifyRole: "support_lead", notifyEmails: [] }])}>
                  <Plus className="h-3 w-3 mr-1" />Add step
                </Button>
              </div>
              <div className="space-y-2">
                {steps.length === 0 && <div className="text-xs text-muted-foreground italic">No escalation steps configured.</div>}
                {steps.map((s, i) => (
                  <div key={i} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
                    <div>
                      <Label className="text-xs">After (min)</Label>
                      <Input type="number" min={0} value={s.afterMinutes}
                        onChange={e => setMatrix(p, steps.map((x, j) => j === i ? { ...x, afterMinutes: Number(e.target.value) } : x))} />
                    </div>
                    <div>
                      <Label className="text-xs">Level</Label>
                      <Input type="number" min={1} value={s.level}
                        onChange={e => setMatrix(p, steps.map((x, j) => j === i ? { ...x, level: Number(e.target.value) } : x))} />
                    </div>
                    <div>
                      <Label className="text-xs">Notify role</Label>
                      <select className="w-full border rounded-md px-2 py-1.5 bg-background text-sm" value={s.notifyRole ?? ""}
                        onChange={e => setMatrix(p, steps.map((x, j) => j === i ? { ...x, notifyRole: (e.target.value || undefined) as SlaEscalationStep["notifyRole"] } : x))}>
                        <option value="">—</option>
                        <option value="support_agent">support_agent</option>
                        <option value="support_lead">support_lead</option>
                        <option value="support_manager">support_manager</option>
                        <option value="engineering_oncall">engineering_oncall</option>
                        <option value="executive">executive</option>
                      </select>
                    </div>
                    <div className="md:col-span-1">
                      <Label className="text-xs">Notify emails (comma)</Label>
                      <Input value={(s.notifyEmails ?? []).join(", ")}
                        onChange={e => setMatrix(p, steps.map((x, j) => j === i ? { ...x, notifyEmails: e.target.value.split(",").map(v => v.trim()).filter(Boolean) } : x))} />
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setMatrix(p, steps.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="font-semibold">Live Chat & Status Page</h3>
        <div>
          <Label className="text-xs">Live chat URL (shown on user support page when set)</Label>
          <Input value={merged.liveChatUrl ?? ""} placeholder="https://chat.example.com/widget"
            onChange={e => setDraft({ ...draft, liveChatUrl: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!merged.statusPageEnabled}
            onChange={e => setDraft({ ...draft, statusPageEnabled: e.target.checked })} />
          Public status page enabled at <code>/status</code>
        </label>
        <div>
          <Label className="text-xs">Status page title</Label>
          <Input value={merged.statusPageTitle ?? ""} placeholder="System Status"
            onChange={e => setDraft({ ...draft, statusPageTitle: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Status page description</Label>
          <Textarea rows={2} value={merged.statusPageDescription ?? ""} placeholder="Real-time status of our services."
            onChange={e => setDraft({ ...draft, statusPageDescription: e.target.value })} />
        </div>
      </div>

      <div className="border rounded-lg p-4">
        <h3 className="font-semibold mb-3">Attachments</h3>
        <div className="grid grid-cols-4 gap-3">
          <Field label="Max attachment (MB)" k="maxAttachmentMb" />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={Object.keys(draft).length === 0 || save.isPending}>
          {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Save Changes
        </Button>
      </div>
    </div>
  );
}

function CallbackQueue() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin-callbacks"],
    queryFn: () => apiGet<{ data: CallbackRequest[] }>("/admin/support/callback-requests"),
    refetchInterval: 30_000,
  });
  const list = q.data?.data ?? [];

  const update = useMutation({
    mutationFn: (payload: { id: number; status: CallbackRequest["status"]; handlerNote?: string }) =>
      apiAction(`/admin/support/callback-requests/${payload.id}`, "PATCH", { status: payload.status, handlerNote: payload.handlerNote }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-callbacks"] }); toast({ title: "Updated" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <h3 className="font-semibold flex items-center gap-2"><Phone className="h-5 w-5" />Phone Callback Queue</h3>
      {q.isLoading ? <div className="text-center py-8 text-muted-foreground">Loading…</div>
        : list.length === 0 ? <div className="border rounded-lg p-8 text-center text-muted-foreground">No callback requests yet.</div>
        : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs"><tr>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Phone</th>
                <th className="text-left px-3 py-2">Preferred time</th>
                <th className="text-left px-3 py-2">Topic</th>
                <th className="text-left px-3 py-2">Requested</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr></thead>
              <tbody>
                {list.map(c => (
                  <tr key={c.id} className="border-t">
                    <td className="px-3 py-2"><Badge variant="outline">{c.status}</Badge></td>
                    <td className="px-3 py-2 font-mono">{c.phone}</td>
                    <td className="px-3 py-2">{c.preferredTime ?? "—"}</td>
                    <td className="px-3 py-2">{c.topic ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right space-x-1">
                      {c.status === "pending" && <Button size="sm" variant="outline" onClick={() => update.mutate({ id: c.id, status: "acknowledged" })}>Acknowledge</Button>}
                      {c.status !== "completed" && c.status !== "cancelled" && (
                        <Button size="sm" onClick={() => update.mutate({ id: c.id, status: "completed" })}><CheckCircle2 className="h-3 w-3 mr-1" />Complete</Button>
                      )}
                      {c.status !== "cancelled" && c.status !== "completed" && (
                        <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: c.id, status: "cancelled" })}>Cancel</Button>
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

function IncidentManager() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin-incidents"],
    queryFn: () => apiGet<{ data: Incident[] }>("/admin/support/incidents"),
    refetchInterval: 30_000,
  });
  const list = q.data?.data ?? [];
  const [showNew, setShowNew] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => apiAction(`/admin/support/incidents/${id}`, "DELETE", undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-incidents"] }); toast({ title: "Deleted" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><Activity className="h-5 w-5" />Incidents (Status Page)</h3>
        <Button size="sm" onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-2" />New Incident</Button>
      </div>
      {q.isLoading ? <div className="text-center py-8 text-muted-foreground">Loading…</div>
        : list.length === 0 ? <div className="border rounded-lg p-8 text-center text-muted-foreground">No incidents yet.</div>
        : (
          <div className="space-y-2">
            {list.map(i => (
              <div key={i.id} className="border rounded-lg p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 cursor-pointer" onClick={() => setExpandedId(expandedId === i.id ? null : i.id)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline">{i.status}</Badge>
                      <Badge variant="outline">{i.severity}</Badge>
                      {!i.isPublished && <Badge variant="outline">draft</Badge>}
                      <span className="font-medium">{i.title}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Started {new Date(i.startedAt).toLocaleString()}
                      {i.resolvedAt && <> · Resolved {new Date(i.resolvedAt).toLocaleString()}</>}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => { if (confirm("Delete incident?")) remove.mutate(i.id); }}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
                {expandedId === i.id && <IncidentDetail incident={i} />}
              </div>
            ))}
          </div>
        )}
      {showNew && <IncidentDialog initial={null} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ["admin-incidents"] }); }} />}
    </div>
  );
}

function IncidentDetail({ incident }: { incident: Incident }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const updates = useQuery({
    queryKey: ["admin-incident-updates", incident.id],
    queryFn: () => apiGet<{ incident: Incident; updates: IncidentUpdate[] }>(`/admin/support/incidents/${incident.id}`),
  });
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<Incident["status"]>(incident.status);
  const [editing, setEditing] = useState(false);

  const post = useMutation({
    mutationFn: () => apiPost(`/admin/support/incidents/${incident.id}/updates`, { body, status }),
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["admin-incident-updates", incident.id] });
      qc.invalidateQueries({ queryKey: ["admin-incidents"] });
      toast({ title: "Update posted" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="mt-3 border-t pt-3 space-y-3">
      <div className="text-sm whitespace-pre-wrap">{incident.body}</div>
      {incident.affectedComponents.length > 0 && (
        <div className="text-xs"><span className="text-muted-foreground">Affected: </span>{incident.affectedComponents.map(c => <Badge key={c} variant="outline" className="mr-1">{c}</Badge>)}</div>
      )}

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Updates</div>
        {(updates.data?.updates ?? []).map(u => (
          <div key={u.id} className="border-l-2 pl-3 text-sm">
            <div className="text-xs text-muted-foreground"><Badge variant="outline">{u.status}</Badge> {new Date(u.createdAt).toLocaleString()}</div>
            <div className="whitespace-pre-wrap">{u.body}</div>
          </div>
        ))}
      </div>

      <div className="border-t pt-3 space-y-2">
        <div className="text-xs font-medium">Post update</div>
        <div className="flex gap-2">
          <select className="border rounded-md px-2 py-1.5 bg-background text-sm" value={status} onChange={e => setStatus(e.target.value as Incident["status"])}>
            <option value="investigating">investigating</option>
            <option value="identified">identified</option>
            <option value="monitoring">monitoring</option>
            <option value="resolved">resolved</option>
          </select>
          <Input value={body} onChange={e => setBody(e.target.value)} placeholder="Update message..." />
          <Button size="sm" onClick={() => post.mutate()} disabled={!body.trim() || post.isPending}>
            <Send className="h-4 w-4 mr-1" />Post
          </Button>
        </div>
      </div>

      <div>
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="h-3 w-3 mr-1" />Edit incident</Button>
      </div>
      {editing && <IncidentDialog initial={incident} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); qc.invalidateQueries({ queryKey: ["admin-incidents"] }); }} />}
    </div>
  );
}

function IncidentDialog({ initial, onClose, onSaved }: { initial: Incident | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [status, setStatus] = useState<Incident["status"]>(initial?.status ?? "investigating");
  const [severity, setSeverity] = useState<Incident["severity"]>(initial?.severity ?? "minor");
  const [components, setComponents] = useState((initial?.affectedComponents ?? []).join(", "));
  const [isPublished, setIsPublished] = useState(initial?.isPublished ?? true);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title, body, status, severity, isPublished,
        affectedComponents: components.split(",").map(c => c.trim()).filter(Boolean),
      };
      return initial
        ? apiAction(`/admin/support/incidents/${initial.id}`, "PATCH", payload)
        : apiPost("/admin/support/incidents", payload);
    },
    onSuccess: () => { toast({ title: "Saved" }); onSaved(); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-lg shadow-lg max-w-xl w-full max-h-[90vh] overflow-auto">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">{initial ? "Edit Incident" : "New Incident"}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div><Label>Title</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
          <div><Label>Body</Label><Textarea rows={4} value={body} onChange={e => setBody(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Status</Label>
              <select className="w-full border rounded-md px-3 py-2 bg-background" value={status} onChange={e => setStatus(e.target.value as Incident["status"])}>
                <option value="investigating">investigating</option>
                <option value="identified">identified</option>
                <option value="monitoring">monitoring</option>
                <option value="resolved">resolved</option>
              </select>
            </div>
            <div>
              <Label>Severity</Label>
              <select className="w-full border rounded-md px-3 py-2 bg-background" value={severity} onChange={e => setSeverity(e.target.value as Incident["severity"])}>
                <option value="minor">minor</option>
                <option value="major">major</option>
                <option value="critical">critical</option>
              </select>
            </div>
          </div>
          <div><Label>Affected components (comma-separated)</Label><Input value={components} onChange={e => setComponents(e.target.value)} placeholder="POS, KDS, Dashboard" /></div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPublished} onChange={e => setIsPublished(e.target.checked)} />Published on public status page
          </label>
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!title.trim() || save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatEvent(e: Event): string {
  const who = e.actorName ?? (e.actorIsAdmin ? "Support" : "User");
  switch (e.type) {
    case "created": return `${who} opened the ticket`;
    case "status_changed": return `${who} changed status: ${e.fromValue} → ${e.toValue}`;
    case "priority_changed": return `${who} changed priority: ${e.fromValue} → ${e.toValue}`;
    case "assignee_changed": return `${who} reassigned the ticket`;
    case "category_changed": return `${who} changed category`;
    case "reopened": return `${who} reopened the ticket`;
    case "reply_posted": return `${who} replied`;
    case "internal_note_added": return `${who} added an internal note`;
    default: return `${who} ${e.type}`;
  }
}
