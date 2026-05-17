import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPost } from "@/lib/api";
import {
  LifeBuoy, Plus, Paperclip, Loader2, ArrowLeft, Clock, AlertTriangle, Send, X,
  Phone, Zap, Star, ShieldCheck, ExternalLink,
} from "lucide-react";

type Priority = "low" | "normal" | "high" | "urgent";
type Status = "open" | "pending" | "in_progress" | "waiting_customer" | "resolved" | "closed";

interface Category { id: number; name: string; slug: string; defaultPriority: Priority; isActive: boolean; }
interface SlaInfo { firstResponseDueAt: string | null; resolutionDueAt: string | null; firstResponseRemainingMs: number | null; resolutionRemainingMs: number | null; firstResponseBreached: boolean; resolutionBreached: boolean; isPaused: boolean; }
interface Ticket {
  id: number; ticketNumber: string; subject: string; description: string; status: Status; priority: Priority;
  createdAt: string; updatedAt: string; firstResponseAt: string | null; resolvedAt: string | null;
  category: Category | null; sla: SlaInfo; replyCount: number;
  requester: { id: number; name: string; email: string } | null;
  isEmergency?: boolean;
  satisfactionRating?: number | null;
  satisfactionComment?: string | null;
  escalationLevel?: number;
}
type Tier = "standard" | "priority" | "enterprise";
interface TierCapabilities {
  tier: Tier;
  firstResponseMultiplier: number;
  resolutionMultiplier: number;
  emergencyEnabled: boolean;
  callbackEnabled: boolean;
  liveChatUrl: string | null;
  firstResponseHoursByPriority: Record<Priority, number>;
  resolutionHoursByPriority: Record<Priority, number>;
  statusPageEnabled?: boolean;
}
interface CallbackRequest {
  id: number; phone: string; preferredTime: string | null; topic: string | null; notes: string | null;
  status: string; createdAt: string; acknowledgedAt: string | null; completedAt: string | null;
  handlerNote: string | null;
}
interface Reply { id: number; body: string; createdAt: string; authorName: string | null; authorIsAdmin: boolean; isInternal: boolean; }
interface Attachment { id: number; fileName: string; contentType: string; size: number; createdAt: string; replyId: number | null; isInternal: boolean; }
interface Event { id: number; type: string; createdAt: string; actorName: string | null; actorIsAdmin: boolean; fromValue: string | null; toValue: string | null; }
interface AttachmentDraft { objectPath: string; fileName: string; contentType: string; size: number; }

const STATUS_LABELS: Record<Status, string> = {
  open: "Open", pending: "Pending", in_progress: "In Progress", waiting_customer: "Waiting on You", resolved: "Resolved", closed: "Closed",
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
  const sign = ms < 0 ? "overdue " : "";
  return `${sign}${h}h ${m}m`;
}

/** Live-tick a remaining-ms value using `dueAt` so the timer counts every second. */
function liveRemaining(dueAtIso: string | null, now: number, paused: boolean, baseRemainingMs: number | null): number | null {
  if (baseRemainingMs === null) return null;
  if (paused) return baseRemainingMs;
  if (!dueAtIso) return baseRemainingMs;
  return new Date(dueAtIso).getTime() - now;
}

function formatCountdown(ms: number | null): string {
  if (ms === null) return "—";
  const overdue = ms < 0;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const s = Math.floor((abs % 60_000) / 1000);
  return `${overdue ? "-" : ""}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function useNowTick(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const TIER_LABEL: Record<Tier, string> = { standard: "Standard Support", priority: "Priority Support", enterprise: "Enterprise Support" };
const TIER_COLOR: Record<Tier, string> = {
  standard: "bg-gray-100 text-gray-800",
  priority: "bg-indigo-100 text-indigo-800",
  enterprise: "bg-emerald-100 text-emerald-800",
};

export default function SupportPage() {
  const [openTicketId, setOpenTicketId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showCallback, setShowCallback] = useState(false);
  const [emergencyMode, setEmergencyMode] = useState(false);

  const ticketsQuery = useQuery({
    queryKey: ["support-tickets"],
    queryFn: () => apiGet<{ data: Ticket[] }>("/support/tickets"),
    refetchInterval: 30_000,
  });
  const tickets = ticketsQuery.data?.data ?? [];

  // Task #436 — tier & capabilities banner. Failures degrade silently to
  // "standard" so the rest of the page keeps working if the endpoint hiccups.
  const tierQuery = useQuery({
    queryKey: ["support-sla-tier"],
    queryFn: () => apiGet<TierCapabilities>("/support/sla-tier"),
    staleTime: 60_000,
  });
  const tier = tierQuery.data;

  const callbacksQuery = useQuery({
    queryKey: ["support-callbacks"],
    queryFn: () => apiGet<{ data: CallbackRequest[] }>("/support/callback-requests"),
    refetchInterval: 60_000,
    enabled: !!tier?.callbackEnabled,
  });
  const activeCallbacks = (callbacksQuery.data?.data ?? []).filter(c => c.status !== "completed" && c.status !== "cancelled");

  if (openTicketId !== null) {
    return <TicketDetail id={openTicketId} onBack={() => setOpenTicketId(null)} />;
  }

  return (
    <Layout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><LifeBuoy className="h-6 w-6" />Support</h1>
            <p className="text-sm text-muted-foreground">Open a ticket with our team and track its progress.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {tier?.emergencyEnabled && (
              <Button variant="destructive" onClick={() => { setEmergencyMode(true); setShowNew(true); }}>
                <Zap className="h-4 w-4 mr-2" />Report POS Emergency
              </Button>
            )}
            {tier?.callbackEnabled && (
              <Button variant="outline" onClick={() => setShowCallback(true)}>
                <Phone className="h-4 w-4 mr-2" />Request Callback
              </Button>
            )}
            <Button onClick={() => { setEmergencyMode(false); setShowNew(true); }}>
              <Plus className="h-4 w-4 mr-2" />New Ticket
            </Button>
          </div>
        </div>

        {/* Tier banner */}
        {tier && (
          <div className="border rounded-lg p-4 flex items-start gap-3 bg-card">
            <ShieldCheck className="h-5 w-5 mt-0.5 text-primary" />
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={TIER_COLOR[tier.tier]}>{TIER_LABEL[tier.tier]}</Badge>
                {tier.emergencyEnabled && <Badge variant="outline">POS emergency enabled</Badge>}
                {tier.callbackEnabled && <Badge variant="outline">Phone callbacks enabled</Badge>}
                {tier.liveChatUrl && (
                  <a href={tier.liveChatUrl} target="_blank" rel="noreferrer" className="inline-flex items-center text-sm text-blue-600 hover:underline">
                    <ExternalLink className="h-3 w-3 mr-1" />Live chat
                  </a>
                )}
                {tier.statusPageEnabled && (
                  <a href="/status" target="_blank" rel="noreferrer" className="inline-flex items-center text-sm text-blue-600 hover:underline">
                    <ExternalLink className="h-3 w-3 mr-1" />System status
                  </a>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(["low", "normal", "high", "urgent"] as Priority[]).map(p => (
                  <div key={p} className="border rounded px-2 py-1">
                    <div className="font-medium capitalize">{p}</div>
                    <div>1st reply ≤ {tier.firstResponseHoursByPriority[p]}h</div>
                    <div>Resolve ≤ {tier.resolutionHoursByPriority[p]}h</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Active callbacks summary */}
        {activeCallbacks.length > 0 && (
          <div className="border rounded-lg p-3 text-sm bg-amber-50 dark:bg-amber-950/30 border-amber-200">
            <div className="font-medium flex items-center gap-2"><Phone className="h-4 w-4" />Pending phone callbacks</div>
            <ul className="mt-1 space-y-1">
              {activeCallbacks.map(c => (
                <li key={c.id} className="text-xs">
                  {c.phone} · {c.status} · requested {new Date(c.createdAt).toLocaleString()}
                </li>
              ))}
            </ul>
          </div>
        )}

        {ticketsQuery.isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : tickets.length === 0 ? (
          <div className="border rounded-lg p-12 text-center text-muted-foreground">
            <LifeBuoy className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p>You don't have any support tickets yet.</p>
            <Button className="mt-4" onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-2" />Create your first ticket</Button>
          </div>
        ) : (
          <div className="border rounded-lg divide-y">
            {tickets.map(t => (
              <button key={t.id} onClick={() => setOpenTicketId(t.id)}
                className="w-full text-left p-4 hover:bg-accent flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">{t.ticketNumber}</span>
                    <Badge className={STATUS_COLORS[t.status]}>{STATUS_LABELS[t.status]}</Badge>
                    <Badge className={PRIORITY_COLORS[t.priority]}>{t.priority}</Badge>
                    {t.category && <Badge variant="outline">{t.category.name}</Badge>}
                    {(t.sla.firstResponseBreached || t.sla.resolutionBreached) && (
                      <Badge className="bg-red-100 text-red-800"><AlertTriangle className="h-3 w-3 mr-1" />SLA breached</Badge>
                    )}
                  </div>
                  <div className="mt-1 font-medium truncate">{t.subject}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Updated {new Date(t.updatedAt).toLocaleString()} · {t.replyCount} replies
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
                  <div className="flex items-center gap-1 justify-end"><Clock className="h-3 w-3" />First reply: {formatRemaining(t.sla.firstResponseRemainingMs)}</div>
                  <div className="flex items-center gap-1 justify-end"><Clock className="h-3 w-3" />Resolve: {formatRemaining(t.sla.resolutionRemainingMs)}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {showNew && (
          <NewTicketDialog
            emergency={emergencyMode && !!tier?.emergencyEnabled}
            onClose={() => { setShowNew(false); setEmergencyMode(false); }}
            onCreated={(id) => { setShowNew(false); setEmergencyMode(false); setOpenTicketId(id); }}
          />
        )}
        {showCallback && tier?.callbackEnabled && (
          <CallbackDialog onClose={() => setShowCallback(false)} />
        )}
      </div>
    </Layout>
  );
}

function CallbackDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [phone, setPhone] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");

  const submit = useMutation({
    mutationFn: () => apiPost("/support/callback-requests", { phone, preferredTime, topic, notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["support-callbacks"] });
      toast({ title: "Callback requested", description: "We'll call you back shortly." });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-lg shadow-lg max-w-md w-full">
        <div className="p-6 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Phone className="h-5 w-5" />Request a Callback</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="p-6 space-y-3">
          <div><Label>Phone number</Label><Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98xxxxxxxx" /></div>
          <div><Label>Preferred time</Label><Input value={preferredTime} onChange={e => setPreferredTime(e.target.value)} placeholder="e.g. Today between 4-6 PM" /></div>
          <div><Label>Topic</Label><Input value={topic} onChange={e => setTopic(e.target.value)} placeholder="What would you like to discuss?" /></div>
          <div><Label>Notes</Label><Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional context (optional)" /></div>
        </div>
        <div className="p-6 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => submit.mutate()} disabled={!phone.trim() || submit.isPending}>
            {submit.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Phone className="h-4 w-4 mr-2" />}Submit
          </Button>
        </div>
      </div>
    </div>
  );
}

function NewTicketDialog({ onClose, onCreated, emergency = false }: { onClose: () => void; onCreated: (id: number) => void; emergency?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [subject, setSubject] = useState(emergency ? "POS Emergency — " : "");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [priority, setPriority] = useState<Priority | "">(emergency ? "urgent" : "");
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);

  const cats = useQuery({ queryKey: ["support-categories"], queryFn: () => apiGet<{ data: Category[] }>("/support/categories") });

  const create = useMutation({
    mutationFn: () => apiPost<Ticket>("/support/tickets", {
      subject, description,
      categoryId: categoryId || undefined,
      priority: priority || undefined,
      attachments,
      isEmergency: emergency,
    }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["support-tickets"] });
      toast({ title: emergency ? "Emergency raised" : "Ticket created", description: t.ticketNumber });
      onCreated(t.id);
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-auto">
        <div className={`p-6 border-b flex items-center justify-between ${emergency ? "bg-red-50 dark:bg-red-950/30" : ""}`}>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            {emergency && <Zap className="h-5 w-5 text-red-600" />}
            {emergency ? "Report POS Emergency" : "New Support Ticket"}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="p-6 space-y-4">
          {emergency && (
            <div className="border border-red-200 bg-red-50 dark:bg-red-950/30 rounded-md p-3 text-sm">
              <strong>POS emergency tickets</strong> are routed to our on-call engineers immediately at the urgent priority and bypass the standard queue. Please include the affected outlet, error messages, and any device IDs.
            </div>
          )}
          <div>
            <Label>Subject</Label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Brief summary of your issue" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <select className="w-full border rounded-md px-3 py-2 bg-background" value={categoryId} onChange={e => setCategoryId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">— Select —</option>
                {(cats.data?.data ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Priority</Label>
              <select className="w-full border rounded-md px-3 py-2 bg-background" value={priority} onChange={e => setPriority(e.target.value as Priority)}>
                <option value="">— Default —</option>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea rows={6} value={description} onChange={e => setDescription(e.target.value)} placeholder="Tell us what's going on, including steps to reproduce, screenshots, etc." />
          </div>
          <AttachmentPicker attachments={attachments} onChange={setAttachments} />
        </div>
        <div className="p-6 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!subject.trim() || !description.trim() || create.isPending}>
            {create.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Submit
          </Button>
        </div>
      </div>
    </div>
  );
}

function AttachmentPicker({ attachments, onChange }: { attachments: AttachmentDraft[]; onChange: (a: AttachmentDraft[]) => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const presign = await apiPost<{ uploadURL: string; objectPath: string }>(`/support/tickets/uploads/request-url`, {
        name: file.name, size: file.size, contentType: file.type || "application/octet-stream",
      });
      const put = await fetch(presign.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      if (!put.ok) throw new Error("Upload failed");
      await apiPost(`/support/tickets/uploads/finalize`, { objectPath: presign.objectPath });
      onChange([...attachments, { objectPath: presign.objectPath, fileName: file.name, contentType: file.type || "application/octet-stream", size: file.size }]);
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Label>Attachments</Label>
      <div className="flex items-center gap-2 mt-1">
        <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 border rounded-md hover:bg-accent text-sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          Add file
          <input type="file" className="hidden" disabled={busy} onChange={async e => {
            const f = e.target.files?.[0]; if (!f) return;
            await handleFile(f); e.target.value = "";
          }} />
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

function TicketDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [csatOpen, setCsatOpen] = useState(false);
  const now = useNowTick(1000);

  const detail = useQuery({
    queryKey: ["support-ticket", id],
    queryFn: () => apiGet<{ ticket: Ticket; replies: Reply[]; attachments: Attachment[]; events: Event[] }>(`/support/tickets/${id}`),
    refetchInterval: 30_000,
  });

  const send = useMutation({
    mutationFn: () => apiPost<Reply>(`/support/tickets/${id}/replies`, { body: reply, attachments }),
    onSuccess: () => {
      setReply(""); setAttachments([]);
      qc.invalidateQueries({ queryKey: ["support-ticket", id] });
      qc.invalidateQueries({ queryKey: ["support-tickets"] });
      toast({ title: "Reply sent" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const t = detail.data?.ticket;
  const allItems = useMemo(() => {
    const replies = (detail.data?.replies ?? []).map(r => ({ kind: "reply" as const, at: r.createdAt, payload: r }));
    const events = (detail.data?.events ?? []).map(e => ({ kind: "event" as const, at: e.createdAt, payload: e }));
    return [...replies, ...events].sort((a, b) => a.at.localeCompare(b.at));
  }, [detail.data]);

  return (
    <Layout>
      <div className="p-6 space-y-4 max-w-4xl mx-auto">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-2" />Back to tickets</Button>
        {!t ? <div className="text-center py-12 text-muted-foreground">Loading...</div> : (
          <>
            <div className="border rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-muted-foreground">{t.ticketNumber}</span>
                <Badge className={STATUS_COLORS[t.status]}>{STATUS_LABELS[t.status]}</Badge>
                <Badge className={PRIORITY_COLORS[t.priority]}>{t.priority}</Badge>
                {t.category && <Badge variant="outline">{t.category.name}</Badge>}
                {(t.sla.firstResponseBreached || t.sla.resolutionBreached) && (
                  <Badge className="bg-red-100 text-red-800"><AlertTriangle className="h-3 w-3 mr-1" />SLA breached</Badge>
                )}
                {t.sla.isPaused && <Badge variant="outline">SLA paused</Badge>}
                {t.isEmergency && <Badge className="bg-red-600 text-white"><Zap className="h-3 w-3 mr-1" />Emergency</Badge>}
                {(t.escalationLevel ?? 0) > 0 && <Badge variant="outline">Escalation L{t.escalationLevel}</Badge>}
              </div>
              <h1 className="text-xl font-semibold">{t.subject}</h1>
              <div className="text-sm whitespace-pre-wrap">{t.description}</div>
              <div className="text-xs text-muted-foreground">
                Opened by {t.requester?.name ?? "—"} · {new Date(t.createdAt).toLocaleString()}
              </div>
              {/* Live SLA timers — tick every second using dueAt timestamps. */}
              <div className="flex gap-4 text-xs pt-2 border-t mt-2">
                {(() => {
                  const fr = liveRemaining(t.sla.firstResponseDueAt, now, t.sla.isPaused || !!t.firstResponseAt, t.sla.firstResponseRemainingMs);
                  const rr = liveRemaining(t.sla.resolutionDueAt, now, t.sla.isPaused || !!t.resolvedAt, t.sla.resolutionRemainingMs);
                  const frClass = fr === null ? "text-muted-foreground" : fr < 0 ? "text-red-600 font-medium" : fr < 30 * 60_000 ? "text-orange-600 font-medium" : "text-muted-foreground";
                  const rrClass = rr === null ? "text-muted-foreground" : rr < 0 ? "text-red-600 font-medium" : rr < 60 * 60_000 ? "text-orange-600 font-medium" : "text-muted-foreground";
                  return (
                    <>
                      <span className={frClass}><Clock className="h-3 w-3 inline mr-1" />First response: <span className="font-mono">{formatCountdown(fr)}</span></span>
                      <span className={rrClass}><Clock className="h-3 w-3 inline mr-1" />Resolution: <span className="font-mono">{formatCountdown(rr)}</span></span>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Satisfaction prompt — shows once when ticket is resolved/closed and not yet rated. */}
            {(t.status === "resolved" || t.status === "closed") && (
              t.satisfactionRating
                ? (
                  <div className="border rounded-lg p-3 bg-green-50 dark:bg-green-950/30 text-sm flex items-center gap-2">
                    <Star className="h-4 w-4 text-yellow-500" />
                    You rated this ticket {t.satisfactionRating}/5{t.satisfactionComment ? ` — "${t.satisfactionComment}"` : ""}.
                  </div>
                )
                : (
                  <div className="border rounded-lg p-4 bg-amber-50 dark:bg-amber-950/30 flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-sm">How did we do? Rate your support experience.</div>
                    <Button size="sm" onClick={() => setCsatOpen(true)}><Star className="h-4 w-4 mr-2" />Rate</Button>
                  </div>
                )
            )}
            {csatOpen && (
              <SatisfactionDialog
                ticketId={id}
                onClose={() => setCsatOpen(false)}
                onSaved={() => { setCsatOpen(false); qc.invalidateQueries({ queryKey: ["support-ticket", id] }); }}
              />
            )}

            <div className="space-y-3">
              {allItems.map((it, i) => it.kind === "reply" ? (
                <div key={i} className={`border rounded-lg p-3 ${it.payload.authorIsAdmin ? "bg-blue-50/40 dark:bg-blue-950/30" : ""}`}>
                  <div className="text-xs text-muted-foreground mb-1">
                    <span className="font-medium">{it.payload.authorName ?? "User"}</span>
                    {it.payload.authorIsAdmin && <Badge variant="outline" className="ml-2">Support</Badge>}
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

            {t.status !== "closed" && (
              <div className="border rounded-lg p-4 space-y-3">
                <Label>Reply</Label>
                <Textarea rows={4} value={reply} onChange={e => setReply(e.target.value)} placeholder="Type your reply..." />
                <AttachmentPicker attachments={attachments} onChange={setAttachments} />
                <div className="flex justify-end">
                  <Button onClick={() => send.mutate()} disabled={!reply.trim() || send.isPending}>
                    {send.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                    Send Reply
                  </Button>
                </div>
              </div>
            )}
          </>
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
          <Paperclip className="h-3 w-3" />{a.fileName}
        </a>
      ))}
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
    case "sla_breached": return `SLA breached: ${e.toValue}`;
    default: return `${who} ${e.type}`;
  }
}

function SatisfactionDialog({ ticketId, onClose, onSaved }: { ticketId: number; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  const save = useMutation({
    mutationFn: () => apiPost(`/support/tickets/${ticketId}/satisfaction`, { rating, comment }),
    onSuccess: () => { toast({ title: "Thanks for the feedback" }); onSaved(); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-lg shadow-lg max-w-md w-full">
        <div className="p-6 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Star className="h-5 w-5" />Rate Support</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <Label>How would you rate this support experience?</Label>
            <div className="flex gap-1 mt-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" onClick={() => setRating(n)} className="p-1">
                  <Star className={`h-7 w-7 ${n <= rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Comments (optional)</Label>
            <Textarea rows={3} value={comment} onChange={e => setComment(e.target.value)} placeholder="Tell us what worked or what didn't..." />
          </div>
        </div>
        <div className="p-6 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}Submit
          </Button>
        </div>
      </div>
    </div>
  );
}
