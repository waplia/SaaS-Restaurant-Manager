import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout as Layout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiFetch, apiAction, getApiUrl } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Inbox, Search, Mail, Phone, Building2, MapPin, Download, UserPlus, CalendarClock, Send, ArrowRightCircle, MessageSquare, Smartphone, AlertTriangle } from "lucide-react";

interface Lead {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  restaurantName: string | null;
  city: string | null;
  outletCount: number | null;
  businessType: string | null;
  currentSoftware: string | null;
  preferredDateTime: string | null;
  features: string | null;
  message: string | null;
  sourcePage: string;
  status: string;
  notes: string | null;
  assignedTo: number | null;
  assignedToName: string | null;
  followUpAt: string | null;
  followUpNote: string | null;
  convertedRestaurantId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface LeadNote {
  id: number;
  body: string;
  authorId: number | null;
  authorName: string | null;
  createdAt: string;
}

interface LeadActivityItem {
  id: number;
  type: string;
  payload: Record<string, unknown> | null;
  actorId: number | null;
  actorName: string | null;
  createdAt: string;
}

interface Assignee {
  id: number;
  name: string;
  email: string;
  isSuperAdmin: boolean;
}

interface Stats {
  total: number;
  byStatus: { status: string; count: number }[];
  channels: { email: boolean; sms: boolean; whatsapp: boolean };
}

const STATUSES = ["new", "contacted", "demo_scheduled", "trial_created", "converted", "lost"] as const;
type LeadStatus = typeof STATUSES[number];

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  demo_scheduled: "Demo scheduled",
  trial_created: "Trial created",
  converted: "Converted",
  lost: "Lost",
};

const STATUS_COLOR: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  contacted: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  demo_scheduled: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
  trial_created: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30",
  converted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  lost: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
};

const SOURCES = ["book_demo", "contact"];

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function fmtRelative(d: string | null) {
  if (!d) return "";
  const ms = new Date(d).getTime() - Date.now();
  const hrs = Math.round(ms / 3_600_000);
  if (Math.abs(hrs) < 24) return hrs === 0 ? "now" : (hrs > 0 ? `in ${hrs}h` : `${-hrs}h ago`);
  const days = Math.round(hrs / 24);
  return days > 0 ? `in ${days}d` : `${-days}d ago`;
}

export default function AdminLeadsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (sourceFilter !== "all") params.set("source", sourceFilter);
  if (assigneeFilter !== "all") params.set("assignee", assigneeFilter);
  if (q.trim()) params.set("q", q.trim());
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();

  const { data: leads = [], isLoading } = useQuery<Lead[]>({
    queryKey: ["admin-leads", statusFilter, sourceFilter, assigneeFilter, q, from, to],
    queryFn: () => apiFetch<Lead[]>(`/admin/leads${qs ? `?${qs}` : ""}`),
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ["admin-leads-stats"],
    queryFn: () => apiFetch<Stats>("/admin/leads/stats"),
    refetchInterval: 30_000,
  });

  const { data: assignees = [] } = useQuery<Assignee[]>({
    queryKey: ["admin-leads-assignees"],
    queryFn: () => apiFetch<Assignee[]>("/admin/leads/assignees"),
  });

  const active = useMemo(() => leads.find((l) => l.id === activeId) ?? null, [leads, activeId]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-leads"] });
    qc.invalidateQueries({ queryKey: ["admin-leads-stats"] });
    qc.invalidateQueries({ queryKey: ["admin-lead-detail", activeId] });
    qc.invalidateQueries({ queryKey: ["admin-leads-new-count"] });
  };

  const countFor = (s: string) => stats?.byStatus.find((b) => b.status === s)?.count ?? 0;

  const downloadCsv = async () => {
    try {
      const res = await fetch(getApiUrl(`/admin/leads/export.csv${qs ? `?${qs}` : ""}`), {
        headers: { Authorization: `Bearer ${localStorage.getItem("tt_access_token") ?? ""}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: "Export failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Inbox className="w-7 h-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Marketing leads</h1>
              <p className="text-sm text-muted-foreground">Inquiries from the marketing site, with full pipeline tracking.</p>
            </div>
          </div>
          <Button variant="outline" onClick={downloadCsv} data-testid="button-export-csv">
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
        </div>

        {/* Pipeline */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          <Card data-testid="card-stat-total">
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-medium">Total</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold">{stats?.total ?? 0}</CardContent>
          </Card>
          {STATUSES.map((s) => (
            <Card key={s} data-testid={`card-stat-${s}`} className={statusFilter === s ? "border-primary" : ""}>
              <CardHeader className="pb-2">
                <button onClick={() => setStatusFilter(statusFilter === s ? "all" : s)} className="text-left">
                  <CardTitle className="text-xs text-muted-foreground font-medium">{STATUS_LABEL[s]}</CardTitle>
                </button>
              </CardHeader>
              <CardContent className="text-2xl font-bold">{countFor(s)}</CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="relative md:col-span-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search name, email, restaurant, phone…"
                className="pl-9"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                data-testid="input-search-leads"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="md:col-span-2" data-testid="select-status-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="md:col-span-2" data-testid="select-source-filter"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {SOURCES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger className="md:col-span-2" data-testid="select-assignee-filter"><SelectValue placeholder="Assignee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All assignees</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {assignees.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="md:col-span-1" data-testid="input-date-from" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="md:col-span-1" data-testid="input-date-to" />
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {isLoading ? (
              <div className="p-12 text-center text-muted-foreground">Loading leads…</div>
            ) : leads.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">No leads match your filters.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left p-3">Name</th>
                    <th className="text-left p-3">Restaurant</th>
                    <th className="text-left p-3">Contact</th>
                    <th className="text-left p-3">City</th>
                    <th className="text-left p-3">Business</th>
                    <th className="text-left p-3">Outlets</th>
                    <th className="text-left p-3">Source</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-left p-3">Assignee</th>
                    <th className="text-left p-3">Follow-up</th>
                    <th className="text-left p-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => {
                    const overdue = l.followUpAt && new Date(l.followUpAt).getTime() < Date.now() && l.status !== "converted" && l.status !== "lost";
                    const upcoming = l.followUpAt && !overdue;
                    return (
                      <tr
                        key={l.id}
                        onClick={() => setActiveId(l.id)}
                        className="border-b hover:bg-accent cursor-pointer transition-colors"
                        data-testid={`row-lead-${l.id}`}
                      >
                        <td className="p-3 font-medium" data-testid={`text-lead-name-${l.id}`}>{l.name}</td>
                        <td className="p-3 text-muted-foreground">{l.restaurantName ?? "—"}</td>
                        <td className="p-3 text-muted-foreground">
                          <div className="flex flex-col gap-0.5 text-xs">
                            <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{l.email}</span>
                            {l.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{l.phone}</span>}
                          </div>
                        </td>
                        <td className="p-3 text-muted-foreground">{l.city ?? "—"}</td>
                        <td className="p-3 text-muted-foreground capitalize">{l.businessType ?? "—"}</td>
                        <td className="p-3 text-muted-foreground">{l.outletCount ?? "—"}</td>
                        <td className="p-3 text-muted-foreground capitalize">{l.sourcePage.replace("_", " ")}</td>
                        <td className="p-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLOR[l.status] ?? ""}`}>
                            {STATUS_LABEL[l.status] ?? l.status}
                          </span>
                        </td>
                        <td className="p-3 text-muted-foreground text-xs">{l.assignedToName ?? <span className="italic">Unassigned</span>}</td>
                        <td className="p-3 text-xs">
                          {l.followUpAt ? (
                            <span className={overdue ? "text-rose-600 font-semibold flex items-center gap-1" : upcoming ? "text-amber-600" : ""}>
                              {overdue && <AlertTriangle className="w-3 h-3" />}
                              {new Date(l.followUpAt).toLocaleDateString()}
                              <span className="ml-1 text-muted-foreground">({fmtRelative(l.followUpAt)})</span>
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="p-3 text-muted-foreground text-xs">{new Date(l.createdAt).toLocaleDateString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {active && (
          <LeadDrawer
            lead={active}
            assignees={assignees}
            channels={stats?.channels ?? { email: false, sms: false, whatsapp: false }}
            onClose={() => setActiveId(null)}
            onChanged={invalidate}
            onConvert={() => setConvertOpen(true)}
          />
        )}

        {active && (
          <ConvertDialog
            lead={active}
            open={convertOpen}
            onOpenChange={setConvertOpen}
            onConverted={() => {
              setConvertOpen(false);
              invalidate();
            }}
          />
        )}
      </div>
    </Layout>
  );
}

function LeadDrawer({
  lead, assignees, channels, onClose, onChanged, onConvert,
}: {
  lead: Lead;
  assignees: Assignee[];
  channels: { email: boolean; sms: boolean; whatsapp: boolean };
  onClose: () => void;
  onChanged: () => void;
  onConvert: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: detail } = useQuery<{ lead: Lead; notes: LeadNote[]; activity: LeadActivityItem[] }>({
    queryKey: ["admin-lead-detail", lead.id],
    queryFn: () => apiFetch(`/admin/leads/${lead.id}`),
  });

  const handleErr = (e: Error) => toast({ title: "Action failed", description: e.message, variant: "destructive" });
  const handleOk = (msg: string) => () => { toast({ title: msg }); qc.invalidateQueries({ queryKey: ["admin-lead-detail", lead.id] }); onChanged(); };

  const setStatus = useMutation({
    mutationFn: (status: string) => apiAction(`/admin/leads/${lead.id}/status`, "POST", { status }),
    onSuccess: handleOk("Status updated"),
    onError: handleErr,
  });

  const setAssignee = useMutation({
    mutationFn: (userId: number | null) => apiAction(`/admin/leads/${lead.id}/assignee`, "POST", { userId }),
    onSuccess: handleOk("Assignee updated"),
    onError: handleErr,
  });

  const addNote = useMutation({
    mutationFn: (body: string) => apiAction(`/admin/leads/${lead.id}/notes`, "POST", { body }),
    onSuccess: handleOk("Note added"),
    onError: handleErr,
  });

  const setFollowUp = useMutation({
    mutationFn: ({ at, note }: { at: string | null; note: string | null }) =>
      apiAction(`/admin/leads/${lead.id}/follow-up`, "POST", { at, note }),
    onSuccess: handleOk("Follow-up saved"),
    onError: handleErr,
  });

  const sendMessage = useMutation({
    mutationFn: (vars: { channel: string; subject: string; body: string }) =>
      apiAction(`/admin/leads/${lead.id}/send`, "POST", vars),
    onSuccess: handleOk("Message sent"),
    onError: handleErr,
  });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" data-testid="sheet-lead-detail">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3" data-testid="text-detail-name">
            {lead.name}
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLOR[lead.status] ?? ""}`}>
              {STATUS_LABEL[lead.status] ?? lead.status}
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <Select value={lead.status} onValueChange={(v) => setStatus.mutate(v)}>
            <SelectTrigger className="w-44" data-testid="select-detail-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select
            value={lead.assignedTo ? String(lead.assignedTo) : "unassigned"}
            onValueChange={(v) => setAssignee.mutate(v === "unassigned" ? null : Number(v))}
          >
            <SelectTrigger className="w-52" data-testid="select-detail-assignee">
              <UserPlus className="w-4 h-4 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {assignees.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {lead.status !== "converted" && (
            <Button onClick={onConvert} data-testid="button-convert">
              <ArrowRightCircle className="w-4 h-4 mr-2" /> Convert to Restaurant
            </Button>
          )}
          {lead.convertedRestaurantId && (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
              Restaurant #{lead.convertedRestaurantId}
            </Badge>
          )}
        </div>

        <Tabs defaultValue="details" className="mt-6">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="notes">Notes ({detail?.notes.length ?? 0})</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="actions">Actions</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-3 mt-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email" value={lead.email} />
              <Field label="Phone" value={lead.phone} />
              <Field label="Restaurant" value={lead.restaurantName} />
              <Field label="City" value={lead.city} />
              <Field label="Outlets" value={lead.outletCount?.toString() ?? null} />
              <Field label="Business type" value={lead.businessType} />
              <Field label="Current software" value={lead.currentSoftware} />
              <Field label="Preferred time" value={lead.preferredDateTime} />
              <Field label="Source" value={lead.sourcePage} />
              <Field label="Submitted" value={fmtDate(lead.createdAt)} />
            </div>
            {lead.features && <Field label="Features of interest" value={lead.features} block />}
            {lead.message && <Field label="Message" value={lead.message} block />}
          </TabsContent>

          <TabsContent value="notes" className="mt-4 space-y-4">
            <NoteForm onAdd={(body) => addNote.mutate(body)} disabled={addNote.isPending} />
            <div className="space-y-2">
              {detail?.notes.length === 0 && <p className="text-sm text-muted-foreground italic">No notes yet.</p>}
              {detail?.notes.map((n) => (
                <div key={n.id} className="p-3 rounded-lg border bg-muted/20" data-testid={`note-${n.id}`}>
                  <div className="text-xs text-muted-foreground mb-1">
                    <strong>{n.authorName ?? "Unknown"}</strong> • {fmtDate(n.createdAt)}
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="activity" className="mt-4 space-y-2">
            {detail?.activity.length === 0 && <p className="text-sm text-muted-foreground italic">No activity yet.</p>}
            {detail?.activity.map((a) => (
              <div key={a.id} className="text-xs flex items-start gap-3 p-2 border-b" data-testid={`activity-${a.id}`}>
                <div className="text-muted-foreground whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</div>
                <div className="flex-1">
                  <span className="font-medium capitalize">{a.type.replace(/_/g, " ")}</span>
                  {a.actorName && <span className="text-muted-foreground"> by {a.actorName}</span>}
                  {a.payload && Object.keys(a.payload).length > 0 && (
                    <div className="text-muted-foreground mt-0.5 break-all">
                      {Object.entries(a.payload).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" • ")}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="actions" className="mt-4 space-y-6">
            <FollowUpPanel
              lead={lead}
              onSave={(at, note) => setFollowUp.mutate({ at, note })}
              disabled={setFollowUp.isPending}
            />
            <SendMessagePanel
              lead={lead}
              channels={channels}
              onSend={(vars) => sendMessage.mutate(vars)}
              disabled={sendMessage.isPending}
            />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value, block }: { label: string; value: string | null; block?: boolean }) {
  return (
    <div className={block ? "col-span-2" : ""}>
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-sm whitespace-pre-wrap break-words">{value || "—"}</div>
    </div>
  );
}

function NoteForm({ onAdd, disabled }: { onAdd: (body: string) => void; disabled: boolean }) {
  const [v, setV] = useState("");
  return (
    <div className="space-y-2">
      <Textarea value={v} onChange={(e) => setV(e.target.value)} placeholder="Add a note (visible to admins)…" rows={3} data-testid="textarea-add-note" />
      <div className="flex justify-end">
        <Button size="sm" disabled={disabled || !v.trim()} onClick={() => { onAdd(v.trim()); setV(""); }} data-testid="button-add-note">
          Add note
        </Button>
      </div>
    </div>
  );
}

function FollowUpPanel({ lead, onSave, disabled }: { lead: Lead; onSave: (at: string | null, note: string | null) => void; disabled: boolean }) {
  const [date, setDate] = useState<string>(lead.followUpAt ? new Date(lead.followUpAt).toISOString().slice(0, 10) : "");
  const [time, setTime] = useState<string>(lead.followUpAt ? new Date(lead.followUpAt).toISOString().slice(11, 16) : "");
  const [note, setNote] = useState<string>(lead.followUpNote ?? "");

  return (
    <div className="space-y-3 p-4 border rounded-lg">
      <div className="flex items-center gap-2 font-medium"><CalendarClock className="w-4 h-4" /> Follow-up</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-followup-date" />
        </div>
        <div>
          <Label className="text-xs">Time (optional)</Label>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="input-followup-time" />
        </div>
      </div>
      <div>
        <Label className="text-xs">Reminder note</Label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Call to confirm pricing" data-testid="input-followup-note" />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => { setDate(""); setTime(""); setNote(""); onSave(null, null); }} data-testid="button-clear-followup">
          Clear
        </Button>
        <Button size="sm" disabled={disabled || !date} onClick={() => {
          const at = new Date(`${date}T${time || "09:00"}:00`).toISOString();
          onSave(at, note || null);
        }} data-testid="button-save-followup">
          Save follow-up
        </Button>
      </div>
    </div>
  );
}

function SendMessagePanel({
  lead, channels, onSend, disabled,
}: {
  lead: Lead;
  channels: { email: boolean; sms: boolean; whatsapp: boolean };
  onSend: (vars: { channel: string; subject: string; body: string }) => void;
  disabled: boolean;
}) {
  const [channel, setChannel] = useState<"email" | "sms" | "whatsapp">("email");
  const [subject, setSubject] = useState("Following up from Khana Lagao");
  const [body, setBody] = useState(`Hi ${lead.name.split(" ")[0]},\n\nThanks for reaching out. Happy to set up a quick call.\n\n— TableTrack team`);

  const channelEnabled = channels[channel];
  const missingTo = (channel === "email" && !lead.email) || ((channel === "sms" || channel === "whatsapp") && !lead.phone);

  return (
    <div className="space-y-3 p-4 border rounded-lg">
      <div className="flex items-center gap-2 font-medium"><Send className="w-4 h-4" /> Send message</div>
      <div className="grid grid-cols-3 gap-2">
        {(["email", "sms", "whatsapp"] as const).map((c) => {
          const enabled = channels[c];
          const Icon = c === "email" ? Mail : c === "sms" ? Smartphone : MessageSquare;
          const btn = (
            <Button
              key={c}
              type="button"
              variant={channel === c ? "default" : "outline"}
              size="sm"
              disabled={!enabled}
              onClick={() => setChannel(c)}
              data-testid={`button-channel-${c}`}
              className="capitalize"
            >
              <Icon className="w-4 h-4 mr-1" /> {c}
            </Button>
          );
          if (enabled) return btn;
          return (
            <Tooltip key={c}>
              <TooltipTrigger asChild><span>{btn}</span></TooltipTrigger>
              <TooltipContent>Not configured. Set up the {c} provider in Settings.</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      {channel === "email" && (
        <div>
          <Label className="text-xs">Subject</Label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="input-msg-subject" />
        </div>
      )}
      <div>
        <Label className="text-xs">Message</Label>
        <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} data-testid="textarea-msg-body" />
      </div>
      {missingTo && (
        <p className="text-xs text-amber-600">
          Lead has no {channel === "email" ? "email address" : "phone number"} on file.
        </p>
      )}
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={disabled || !channelEnabled || missingTo || !body.trim()}
          onClick={() => onSend({ channel, subject, body })}
          data-testid="button-send-message"
        >
          Send via {channel}
        </Button>
      </div>
    </div>
  );
}

function ConvertDialog({
  lead, open, onOpenChange, onConverted,
}: {
  lead: Lead;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConverted: () => void;
}) {
  const [restaurantName, setRestaurantName] = useState(lead.restaurantName ?? lead.name);
  const [ownerName, setOwnerName] = useState(lead.name);
  const [email, setEmail] = useState(lead.email);
  const [phone, setPhone] = useState(lead.phone ?? "");
  const [city, setCity] = useState(lead.city ?? "");
  const [planSlug, setPlanSlug] = useState("free-trial");
  const [password, setPassword] = useState("");
  const { toast } = useToast();

  const convert = useMutation({
    mutationFn: () => apiAction<{ restaurant: { id: number; name: string } }>(`/admin/leads/${lead.id}/convert`, "POST", {
      restaurantName, ownerName, email, phone, city, planSlug, password,
    }),
    onSuccess: (data) => {
      toast({ title: "Converted", description: `${data.restaurant.name} created (id ${data.restaurant.id}).` });
      onConverted();
    },
    onError: (e: Error) => toast({ title: "Convert failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-convert">
        <DialogHeader>
          <DialogTitle>Convert to Restaurant</DialogTitle>
          <DialogDescription>This creates a tenant + owner account and links it back to this lead.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Restaurant name *</Label>
            <Input value={restaurantName} onChange={(e) => setRestaurantName(e.target.value)} data-testid="input-convert-restaurant" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Owner name *</Label>
              <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} data-testid="input-convert-owner" />
            </div>
            <div>
              <Label className="text-xs">Owner email *</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-convert-email" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 9876543210" data-testid="input-convert-phone" />
            </div>
            <div>
              <Label className="text-xs">City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} data-testid="input-convert-city" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Plan</Label>
              <Select value={planSlug} onValueChange={setPlanSlug}>
                <SelectTrigger data-testid="select-convert-plan"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="free-trial">Free Trial</SelectItem>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Temp password * (≥ 8 chars)</Label>
              <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Share with the owner" data-testid="input-convert-password" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => convert.mutate()} disabled={convert.isPending} data-testid="button-confirm-convert">
            {convert.isPending ? "Converting…" : "Create restaurant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
