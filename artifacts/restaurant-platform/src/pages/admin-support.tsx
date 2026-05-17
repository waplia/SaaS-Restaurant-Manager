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
import { LifeBuoy, ArrowLeft, Clock, AlertTriangle, Send, Loader2, Plus, Pencil, Trash2, Save, X, Paperclip, Settings2, Inbox } from "lucide-react";

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
interface SlaSettings {
  id: number;
  lowFirstResponseHours: number; normalFirstResponseHours: number; highFirstResponseHours: number; urgentFirstResponseHours: number;
  lowResolutionHours: number; normalResolutionHours: number; highResolutionHours: number; urgentResolutionHours: number;
  maxAttachmentMb: number;
}
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
  const [tab, setTab] = useState<"queue" | "categories" | "settings">("queue");
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
          <TabBtn active={tab === "categories"} onClick={() => setTab("categories")} icon={Pencil} label="Categories" />
          <TabBtn active={tab === "settings"} onClick={() => setTab("settings")} icon={Settings2} label="SLA Settings" />
        </div>
        {tab === "queue" && <TicketQueue onOpen={setOpenTicketId} />}
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
  const merged = { ...(settings.data ?? {}), ...draft } as SlaSettings;
  const save = useMutation({
    mutationFn: () => apiAction("/admin/support/sla-settings", "PUT", draft),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-support-sla"] }); setDraft({}); toast({ title: "Saved" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  if (!settings.data) return <div className="text-center py-12 text-muted-foreground">Loading...</div>;

  const Field = ({ label, k }: { label: string; k: keyof SlaSettings }) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={0} value={(merged[k] as number) ?? 0} onChange={e => setDraft({ ...draft, [k]: Number(e.target.value) })} />
    </div>
  );

  return (
    <div className="space-y-4 max-w-3xl">
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
