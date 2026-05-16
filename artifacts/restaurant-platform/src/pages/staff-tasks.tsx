import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Edit, QrCode, Check, X, RotateCcw, Download, Image as ImageIcon } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { apiFetch, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Area {
  id: number;
  restaurantId: number;
  name: string;
  description: string | null;
  qrToken: string;
  isActive: boolean;
  createdAt: string;
}
interface ChecklistItem { key: string; label: string; requirePhoto?: boolean }
interface Checklist {
  id: number;
  restaurantId: number;
  areaId: number;
  name: string;
  description: string | null;
  items: ChecklistItem[];
  photoRequired: boolean;
  scheduleType: "interval" | "times_per_day" | "none";
  intervalMinutes: number;
  timesPerDay: number;
  windowMinutes: number;
  isActive: boolean;
}
interface SubmissionRow {
  submission: {
    id: number; areaId: number; checklistId: number; staffUserId: number;
    submittedAt: string; status: "pending" | "approved" | "rejected";
    notes: string | null; photoUrls: string[]; windowStart: string | null;
  };
  areaName: string | null;
  checklistName: string | null;
  staffName: string | null;
  staffEmail: string | null;
  items: Array<{ id: number; itemKey: string; itemLabel: string; checked: boolean }>;
  verification: { action: string; comment: string | null; createdAt: string } | null;
}

export default function StaffTasksPage() {
  const restaurantId = useRestaurantId();
  return (
    <Layout>
      <PageHeader
        title="Staff Tasks"
        subtitle="QR-based task areas, scheduled checklists, and verification queue"
      />
      <div className="px-4 md:px-6 py-4">
        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Pending Verification</TabsTrigger>
            <TabsTrigger value="areas">Areas & QR</TabsTrigger>
            <TabsTrigger value="checklists">Checklists</TabsTrigger>
            <TabsTrigger value="history">History & Missed</TabsTrigger>
          </TabsList>
          <TabsContent value="pending"><PendingTab restaurantId={restaurantId} /></TabsContent>
          <TabsContent value="areas"><AreasTab restaurantId={restaurantId} /></TabsContent>
          <TabsContent value="checklists"><ChecklistsTab restaurantId={restaurantId} /></TabsContent>
          <TabsContent value="history"><HistoryTab restaurantId={restaurantId} /></TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

// ─── Pending verification tab ────────────────────────────────────────────────

function PendingTab({ restaurantId }: { restaurantId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [comment, setComment] = useState<Record<number, string>>({});

  const list = useQuery<SubmissionRow[]>({
    queryKey: ["staff-tasks", restaurantId, "pending"],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/staff-tasks/manage/pending`),
    enabled: !!restaurantId,
  });

  const verify = useMutation({
    mutationFn: ({ id, action, c }: { id: number; action: "approved" | "rejected"; c: string }) =>
      apiPost(`/restaurants/${restaurantId}/staff-tasks/manage/submissions/${id}/verify`, { action, comment: c }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["staff-tasks", restaurantId, "pending"] });
      qc.invalidateQueries({ queryKey: ["staff-tasks", restaurantId, "history"] });
      toast({ title: v.action === "approved" ? "Approved" : "Rejected" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  if (list.isLoading) return <div className="py-8 text-muted-foreground">Loading…</div>;
  const rows = list.data ?? [];
  if (rows.length === 0) return <div className="py-8 text-muted-foreground">No submissions awaiting verification.</div>;

  return (
    <div className="grid gap-3">
      {rows.map(r => (
        <Card key={r.submission.id}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{r.checklistName} <span className="text-muted-foreground">· {r.areaName}</span></div>
                <div className="text-sm text-muted-foreground">
                  By {r.staffName ?? r.staffEmail ?? `User #${r.submission.staffUserId}`} · {new Date(r.submission.submittedAt).toLocaleString()}
                </div>
              </div>
              <Badge variant="secondary">Pending</Badge>
            </div>
            <ul className="text-sm grid grid-cols-1 md:grid-cols-2 gap-y-1">
              {r.items.map(it => (
                <li key={it.id} className="flex gap-2">
                  <span className={it.checked ? "text-emerald-600" : "text-rose-600"}>
                    {it.checked ? "✓" : "✗"}
                  </span>
                  <span>{it.itemLabel}</span>
                </li>
              ))}
            </ul>
            {r.submission.notes ? <div className="text-sm text-muted-foreground">Notes: {r.submission.notes}</div> : null}
            {r.submission.photoUrls.length > 0 ? (
              <div className="flex gap-2 flex-wrap">
                {r.submission.photoUrls.map(u => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" className="block">
                    <img src={u} alt="proof" className="h-20 w-20 object-cover rounded border" />
                  </a>
                ))}
              </div>
            ) : null}
            <div className="flex flex-col md:flex-row gap-2">
              <Input
                placeholder="Optional comment"
                value={comment[r.submission.id] ?? ""}
                onChange={e => setComment(s => ({ ...s, [r.submission.id]: e.target.value }))}
              />
              <Button
                variant="default"
                onClick={() => verify.mutate({ id: r.submission.id, action: "approved", c: comment[r.submission.id] ?? "" })}
                disabled={verify.isPending}
              ><Check className="w-4 h-4 mr-1" />Approve</Button>
              <Button
                variant="destructive"
                onClick={() => verify.mutate({ id: r.submission.id, action: "rejected", c: comment[r.submission.id] ?? "" })}
                disabled={verify.isPending}
              ><X className="w-4 h-4 mr-1" />Reject</Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Areas tab ───────────────────────────────────────────────────────────────

function AreasTab({ restaurantId }: { restaurantId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Area | null>(null);
  const [form, setForm] = useState<{ name: string; description: string; isActive: boolean }>({ name: "", description: "", isActive: true });
  const [qrViewing, setQrViewing] = useState<Area | null>(null);

  const list = useQuery<Area[]>({
    queryKey: ["staff-tasks", restaurantId, "areas"],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/staff-tasks/manage/areas`),
    enabled: !!restaurantId,
  });

  const save = useMutation({
    mutationFn: () => editing
      ? apiPatch(`/restaurants/${restaurantId}/staff-tasks/manage/areas/${editing.id}`, form)
      : apiPost(`/restaurants/${restaurantId}/staff-tasks/manage/areas`, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-tasks", restaurantId, "areas"] });
      setCreating(false); setEditing(null);
      toast({ title: editing ? "Area updated" : "Area created" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/staff-tasks/manage/areas/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-tasks", restaurantId, "areas"] });
      toast({ title: "Area deleted" });
    },
  });
  const regen = useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${restaurantId}/staff-tasks/manage/areas/${id}/regenerate-qr`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-tasks", restaurantId, "areas"] });
      toast({ title: "QR regenerated" });
    },
  });

  function openCreate() { setForm({ name: "", description: "", isActive: true }); setEditing(null); setCreating(true); }
  function openEdit(a: Area) {
    setEditing(a);
    setForm({ name: a.name, description: a.description ?? "", isActive: a.isActive });
    setCreating(true);
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-1" />New Area</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {(list.data ?? []).map(a => (
          <Card key={a.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium">{a.name}</div>
                  <div className="text-sm text-muted-foreground">{a.description}</div>
                  <div className="text-xs text-muted-foreground mt-1">Token: <code>{a.qrToken}</code></div>
                </div>
                <Badge variant={a.isActive ? "default" : "secondary"}>{a.isActive ? "Active" : "Inactive"}</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setQrViewing(a)}><QrCode className="w-4 h-4 mr-1" />View QR</Button>
                <Button size="sm" variant="outline" onClick={() => openEdit(a)}><Edit className="w-4 h-4 mr-1" />Edit</Button>
                <Button size="sm" variant="outline" onClick={() => regen.mutate(a.id)}><RotateCcw className="w-4 h-4 mr-1" />Regen</Button>
                <Button size="sm" variant="destructive" onClick={() => { if (confirm("Delete area?")) del.mutate(a.id); }}><Trash2 className="w-4 h-4 mr-1" />Delete</Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {list.data && list.data.length === 0 ? (
          <div className="col-span-2 text-muted-foreground py-8 text-center">No areas yet. Create one to print its QR.</div>
        ) : null}
      </div>

      <Dialog open={creating} onOpenChange={o => !o && setCreating(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Area" : "New Area"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="flex items-center gap-2"><Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} /><Label>Active</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !form.name.trim()}>{editing ? "Save" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!qrViewing} onOpenChange={o => !o && setQrViewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{qrViewing?.name} — QR</DialogTitle></DialogHeader>
          {qrViewing ? (
            <div className="flex flex-col items-center gap-3">
              <img
                src={`/api/restaurants/${restaurantId}/staff-tasks/manage/areas/${qrViewing.id}/qr.svg`}
                alt="QR"
                className="w-72 h-72 border p-2 bg-white"
              />
              <div className="text-xs text-muted-foreground break-all">/staff-task/{qrViewing.qrToken}</div>
              <a
                href={`/api/restaurants/${restaurantId}/staff-tasks/manage/areas/${qrViewing.id}/qr.svg`}
                download={`${qrViewing.name}.svg`}
              >
                <Button variant="outline"><Download className="w-4 h-4 mr-1" />Download SVG</Button>
              </a>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Checklists tab ──────────────────────────────────────────────────────────

interface ChecklistForm {
  areaId: number | null;
  name: string;
  description: string;
  items: ChecklistItem[];
  photoRequired: boolean;
  scheduleType: "interval" | "times_per_day" | "none";
  intervalMinutes: number;
  timesPerDay: number;
  windowMinutes: number;
  isActive: boolean;
}
const emptyChecklistForm: ChecklistForm = {
  areaId: null, name: "", description: "", items: [],
  photoRequired: false, scheduleType: "none", intervalMinutes: 120, timesPerDay: 3, windowMinutes: 60, isActive: true,
};

function ChecklistsTab({ restaurantId }: { restaurantId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Checklist | null>(null);
  const [form, setForm] = useState<ChecklistForm>(emptyChecklistForm);
  const [newItemLabel, setNewItemLabel] = useState("");

  const areas = useQuery<Area[]>({
    queryKey: ["staff-tasks", restaurantId, "areas"],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/staff-tasks/manage/areas`),
    enabled: !!restaurantId,
  });
  const list = useQuery<Checklist[]>({
    queryKey: ["staff-tasks", restaurantId, "checklists"],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/staff-tasks/manage/checklists`),
    enabled: !!restaurantId,
  });
  const areaName = (id: number) => areas.data?.find(a => a.id === id)?.name ?? `#${id}`;

  const save = useMutation({
    mutationFn: () => editing
      ? apiPatch(`/restaurants/${restaurantId}/staff-tasks/manage/checklists/${editing.id}`, form)
      : apiPost(`/restaurants/${restaurantId}/staff-tasks/manage/checklists`, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-tasks", restaurantId, "checklists"] });
      setCreating(false); setEditing(null);
      toast({ title: editing ? "Checklist saved" : "Checklist created" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/staff-tasks/manage/checklists/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff-tasks", restaurantId, "checklists"] }),
  });

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyChecklistForm, areaId: areas.data?.[0]?.id ?? null });
    setCreating(true);
  }
  function openEdit(c: Checklist) {
    setEditing(c);
    setForm({
      areaId: c.areaId, name: c.name, description: c.description ?? "",
      items: c.items, photoRequired: c.photoRequired, scheduleType: c.scheduleType,
      intervalMinutes: c.intervalMinutes, timesPerDay: c.timesPerDay,
      windowMinutes: c.windowMinutes, isActive: c.isActive,
    });
    setCreating(true);
  }

  function addItem() {
    const label = newItemLabel.trim();
    if (!label) return;
    setForm(f => ({ ...f, items: [...f.items, { key: `item_${f.items.length + 1}_${Date.now().toString(36)}`, label }] }));
    setNewItemLabel("");
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={openCreate} disabled={!areas.data || areas.data.length === 0}>
          <Plus className="w-4 h-4 mr-1" />New Checklist
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {(list.data ?? []).map(c => (
          <Card key={c.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex justify-between">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-sm text-muted-foreground">{areaName(c.areaId)} · {c.items.length} items</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {c.scheduleType === "none" ? "Ad-hoc"
                      : c.scheduleType === "interval" ? `Every ${c.intervalMinutes} min`
                      : `${c.timesPerDay}× per day · ${c.windowMinutes}-min window`}
                    {c.photoRequired ? " · 📷 photo required" : ""}
                  </div>
                </div>
                <Badge variant={c.isActive ? "default" : "secondary"}>{c.isActive ? "Active" : "Inactive"}</Badge>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(c)}><Edit className="w-4 h-4 mr-1" />Edit</Button>
                <Button size="sm" variant="destructive" onClick={() => { if (confirm("Delete checklist?")) del.mutate(c.id); }}><Trash2 className="w-4 h-4 mr-1" />Delete</Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {list.data && list.data.length === 0 ? (
          <div className="col-span-2 text-muted-foreground py-8 text-center">No checklists yet.</div>
        ) : null}
      </div>

      <Dialog open={creating} onOpenChange={o => !o && setCreating(false)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Checklist" : "New Checklist"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Area</Label>
                <Select value={form.areaId ? String(form.areaId) : ""} onValueChange={v => setForm(f => ({ ...f, areaId: Number(v) }))}>
                  <SelectTrigger><SelectValue placeholder="Pick area" /></SelectTrigger>
                  <SelectContent>
                    {(areas.data ?? []).map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            </div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>

            <div>
              <Label>Items</Label>
              <ul className="space-y-1 mb-2">
                {form.items.map((it, idx) => (
                  <li key={it.key} className="flex items-center gap-2">
                    <Input value={it.label} onChange={e => setForm(f => ({ ...f, items: f.items.map((x, i) => i === idx ? { ...x, label: e.target.value } : x) }))} />
                    <Button size="sm" variant="ghost" onClick={() => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))}><Trash2 className="w-4 h-4" /></Button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Input placeholder="Add item…" value={newItemLabel} onChange={e => setNewItemLabel(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }} />
                <Button variant="outline" onClick={addItem}><Plus className="w-4 h-4" /></Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Schedule</Label>
                <Select value={form.scheduleType} onValueChange={v => setForm(f => ({ ...f, scheduleType: v as ChecklistForm["scheduleType"] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ad-hoc (no schedule)</SelectItem>
                    <SelectItem value="interval">Every N minutes</SelectItem>
                    <SelectItem value="times_per_day">N times per day</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.scheduleType === "interval" ? (
                <div><Label>Interval (min)</Label><Input type="number" value={form.intervalMinutes} onChange={e => setForm(f => ({ ...f, intervalMinutes: Number(e.target.value) || 60 }))} /></div>
              ) : form.scheduleType === "times_per_day" ? (
                <>
                  <div><Label>Times per day</Label><Input type="number" value={form.timesPerDay} onChange={e => setForm(f => ({ ...f, timesPerDay: Number(e.target.value) || 1 }))} /></div>
                  <div><Label>Window (min)</Label><Input type="number" value={form.windowMinutes} onChange={e => setForm(f => ({ ...f, windowMinutes: Number(e.target.value) || 60 }))} /></div>
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2"><Switch checked={form.photoRequired} onCheckedChange={v => setForm(f => ({ ...f, photoRequired: v }))} /><Label>Photo required</Label></div>
              <div className="flex items-center gap-2"><Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} /><Label>Active</Label></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || !form.name.trim() || !form.areaId || form.items.length === 0}
            >{editing ? "Save" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── History & Missed tab ────────────────────────────────────────────────────

interface MissedRow {
  missed: { id: number; areaId: number; checklistId: number; windowStart: string; windowEnd: string; notifiedAt: string | null };
  areaName: string | null;
  checklistName: string | null;
}

function HistoryTab({ restaurantId }: { restaurantId: number }) {
  const subs = useQuery<SubmissionRow[]>({
    queryKey: ["staff-tasks", restaurantId, "history"],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/staff-tasks/manage/submissions?limit=200`),
    enabled: !!restaurantId,
  });
  const missed = useQuery<MissedRow[]>({
    queryKey: ["staff-tasks", restaurantId, "missed"],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/staff-tasks/manage/missed?days=14`),
    enabled: !!restaurantId,
  });

  const stats = useMemo(() => {
    const rows = subs.data ?? [];
    const byStatus = { approved: 0, rejected: 0, pending: 0 };
    for (const r of rows) byStatus[r.submission.status] = (byStatus[r.submission.status] ?? 0) + 1;
    return { total: rows.length, ...byStatus };
  }, [subs.data]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total</div><div className="text-2xl font-semibold">{stats.total}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Approved</div><div className="text-2xl font-semibold text-emerald-600">{stats.approved}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Rejected</div><div className="text-2xl font-semibold text-rose-600">{stats.rejected}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Missed (14d)</div><div className="text-2xl font-semibold text-amber-600">{missed.data?.length ?? 0}</div></CardContent></Card>
      </div>

      <div>
        <h3 className="font-medium mb-2">Recent submissions</h3>
        <div className="space-y-2">
          {(subs.data ?? []).map(r => (
            <Card key={r.submission.id}>
              <CardContent className="p-3 flex justify-between items-center text-sm">
                <div>
                  <div className="font-medium">{r.checklistName} <span className="text-muted-foreground">· {r.areaName}</span></div>
                  <div className="text-muted-foreground">{r.staffName ?? r.staffEmail} · {new Date(r.submission.submittedAt).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-2">
                  {r.submission.photoUrls.length > 0 ? <ImageIcon className="w-4 h-4 text-muted-foreground" /> : null}
                  <Badge variant={r.submission.status === "approved" ? "default" : r.submission.status === "rejected" ? "destructive" : "secondary"}>
                    {r.submission.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
          {subs.data && subs.data.length === 0 ? <div className="text-muted-foreground py-4">No history yet.</div> : null}
        </div>
      </div>

      <div>
        <h3 className="font-medium mb-2">Missed windows</h3>
        <div className="space-y-1 text-sm">
          {(missed.data ?? []).map(m => (
            <div key={m.missed.id} className="flex justify-between p-2 border rounded">
              <span>{m.checklistName} · {m.areaName}</span>
              <span className="text-muted-foreground">
                {new Date(m.missed.windowStart).toLocaleString()} → {new Date(m.missed.windowEnd).toLocaleTimeString()}
              </span>
            </div>
          ))}
          {missed.data && missed.data.length === 0 ? <div className="text-muted-foreground py-4">No missed windows in the last 14 days. 🎉</div> : null}
        </div>
      </div>
    </div>
  );
}
