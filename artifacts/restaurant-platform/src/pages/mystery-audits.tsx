import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPost, apiPut, apiPatch, apiDelete, getApiUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useRestaurantId } from "@/lib/hooks";
import { resolveImageUrl } from "@/components/ImageUploadField";
import {
  ClipboardCheck, Plus, Trash2, Pencil, FileDown, Loader2, Upload, X,
  AlertTriangle, ListChecks, Layers, History, ClipboardList, Camera,
} from "lucide-react";

type Role = "owner" | "manager" | "auditor" | "super_admin";

interface TemplateRow { id: number; name: string; description: string; isActive: boolean; updatedAt: string }
interface CategoryItem { id?: number; label: string; description?: string | null; maxScore: number; requirePhoto?: boolean; sortOrder?: number }
interface CategoryRow { id?: number; name: string; weight: number; sortOrder?: number; items: CategoryItem[] }
interface TemplateDetail extends TemplateRow { categories: CategoryRow[] }

interface AssignmentRow {
  id: number; templateId: number; restaurantId: number; auditorUserId: number;
  status: string; dueDate: string | null; notes: string | null; createdAt: string;
  templateName: string | null; restaurantName: string | null; auditorName: string | null;
}

interface AuditorOption { id: number; name: string; email: string; role: string }
interface OutletOption { id: number; name: string }

interface SubmissionDetail {
  submission: {
    id: number; templateId: number; restaurantId: number; auditorUserId: number;
    status: "draft" | "submitted" | "locked"; visitDate: string | null; generalNotes: string | null;
    categoryScores: Array<{ categoryId: number; name: string; weight: number; score: number; maxScore: number; percent: number }>;
    totalScore: string; totalMaxScore: string; weightedPercent: string;
    submittedAt: string | null; lockedAt: string | null; pdfObjectPath: string | null;
  };
  responses: Array<{ id?: number; itemId: number; categoryId: number; score: number; maxScore: number; notes: string | null; photos: string[] }>;
  template?: TemplateRow;
  restaurantName?: string | null;
  auditorName?: string | null;
  correctiveActions?: ActionRow[];
}

interface HistoryRow {
  id: number; restaurantId: number; restaurantName: string | null; templateName: string | null;
  visitDate: string | null; submittedAt: string | null; weightedPercent: string;
  totalScore: string; totalMaxScore: string; pdfObjectPath: string | null; auditorName: string | null;
}

interface ActionRow {
  id: number; submissionId: number; restaurantId: number; description: string;
  priority: "low" | "medium" | "high"; status: "open" | "in_progress" | "resolved";
  assignedTo: number | null; assignedToName: string | null; dueDate: string | null;
  resolvedAt: string | null; resolutionNote: string | null;
  itemLabel: string | null; categoryName: string | null;
  restaurantName: string | null; createdAt: string;
}

function emptyTemplate(): TemplateDetail {
  return {
    id: 0, name: "", description: "", isActive: true, updatedAt: "",
    categories: [{ name: "Service", weight: 1, items: [{ label: "", maxScore: 5 }] }],
  };
}

export default function MysteryAuditsPage() {
  const { user } = useAuth();
  const role = (user?.role ?? "") as Role;
  const isManager = user?.isSuperAdmin || role === "owner" || role === "manager";
  const [tab, setTab] = useState(isManager ? "assignments" : "my-audits");

  return (
    <Layout>
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="w-6 h-6" />
          <h1 className="text-2xl font-semibold">Mystery Audits</h1>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap h-auto">
            {isManager && <TabsTrigger value="assignments"><Layers className="w-4 h-4 mr-1" />Assignments</TabsTrigger>}
            <TabsTrigger value="my-audits"><ClipboardList className="w-4 h-4 mr-1" />My Audits</TabsTrigger>
            <TabsTrigger value="history"><History className="w-4 h-4 mr-1" />History</TabsTrigger>
            <TabsTrigger value="actions"><AlertTriangle className="w-4 h-4 mr-1" />Corrective Actions</TabsTrigger>
            {isManager && <TabsTrigger value="templates"><ListChecks className="w-4 h-4 mr-1" />Templates</TabsTrigger>}
          </TabsList>
          {isManager && <TabsContent value="assignments"><AssignmentsPanel /></TabsContent>}
          <TabsContent value="my-audits"><MyAuditsPanel /></TabsContent>
          <TabsContent value="history"><HistoryPanel canExport={!!isManager} /></TabsContent>
          <TabsContent value="actions"><ActionsPanel canEdit={!!isManager} /></TabsContent>
          {isManager && <TabsContent value="templates"><TemplatesPanel /></TabsContent>}
        </Tabs>
      </div>
    </Layout>
  );
}

// ─────────────────── Templates ───────────────────
function TemplatesPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery<{ data: TemplateRow[] }>({ queryKey: ["mystery-audits", "templates"], queryFn: () => apiGet("/mystery-audits/templates") });
  const [editing, setEditing] = useState<TemplateDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/mystery-audits/templates/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mystery-audits", "templates"] }); toast({ title: "Template deleted" }); },
  });
  const openEdit = async (id: number) => {
    const r = await apiGet<{ data: TemplateDetail }>(`/mystery-audits/templates/${id}`);
    setEditing({ ...r.data, categories: (r.data.categories ?? []).map(c => ({ ...c, weight: Number(c.weight), items: c.items ?? [] })) });
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-1" />New Template</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(data?.data ?? []).map(t => (
          <div key={t.id} className="border rounded-lg p-4 bg-card">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold truncate">{t.name}</h3>
                  <Badge variant={t.isActive ? "default" : "secondary"}>{t.isActive ? "Active" : "Archived"}</Badge>
                </div>
                {t.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <Button size="icon" variant="ghost" onClick={() => openEdit(t.id)}><Pencil className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete template?")) del.mutate(t.id); }}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>
          </div>
        ))}
        {(data?.data ?? []).length === 0 && <div className="text-sm text-muted-foreground">No templates yet.</div>}
      </div>
      {(editing || creating) && (
        <TemplateEditor
          initial={editing ?? emptyTemplate()}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); qc.invalidateQueries({ queryKey: ["mystery-audits", "templates"] }); }}
        />
      )}
    </div>
  );
}

function TemplateEditor({ initial, onClose, onSaved }: { initial: TemplateDetail; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [tpl, setTpl] = useState<TemplateDetail>(initial);
  const [saving, setSaving] = useState(false);
  const isNew = !tpl.id;
  const save = async () => {
    if (!tpl.name.trim()) return toast({ title: "Name required", variant: "destructive" });
    if (!tpl.categories.length || tpl.categories.some(c => !c.name.trim() || !c.items.length || c.items.some(i => !i.label.trim()))) {
      return toast({ title: "Each category needs a name and at least one item with a label", variant: "destructive" });
    }
    setSaving(true);
    try {
      const body = { name: tpl.name, description: tpl.description, isActive: tpl.isActive, categories: tpl.categories };
      if (isNew) await apiPost("/mystery-audits/templates", body);
      else await apiPut(`/mystery-audits/templates/${tpl.id}`, body);
      toast({ title: isNew ? "Template created" : "Template updated" });
      onSaved();
    } catch (e: unknown) {
      toast({ title: (e as Error).message ?? "Save failed", variant: "destructive" });
    } finally { setSaving(false); }
  };
  const updateCat = (idx: number, patch: Partial<CategoryRow>) => setTpl(t => ({ ...t, categories: t.categories.map((c, i) => i === idx ? { ...c, ...patch } : c) }));
  const updateItem = (ci: number, ii: number, patch: Partial<CategoryItem>) => setTpl(t => ({
    ...t, categories: t.categories.map((c, i) => i === ci ? { ...c, items: c.items.map((it, j) => j === ii ? { ...it, ...patch } : it) } : c),
  }));
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isNew ? "New audit template" : "Edit audit template"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={tpl.name} onChange={e => setTpl(t => ({ ...t, name: e.target.value }))} />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea rows={2} value={tpl.description} onChange={e => setTpl(t => ({ ...t, description: e.target.value }))} />
          </div>
          <div className="space-y-3">
            {tpl.categories.map((cat, ci) => (
              <div key={ci} className="border rounded-md p-3 space-y-2 bg-muted/20">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-7">
                    <Label className="text-xs">Category</Label>
                    <Input value={cat.name} onChange={e => updateCat(ci, { name: e.target.value })} />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs">Weight</Label>
                    <Input type="number" min="0.1" step="0.1" value={cat.weight} onChange={e => updateCat(ci, { weight: Number(e.target.value) || 1 })} />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <Button size="icon" variant="ghost" onClick={() => setTpl(t => ({ ...t, categories: t.categories.filter((_, i) => i !== ci) }))}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {cat.items.map((it, ii) => (
                    <div key={ii} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-6">
                        <Input placeholder="Item label" value={it.label} onChange={e => updateItem(ci, ii, { label: e.target.value })} />
                      </div>
                      <div className="col-span-2">
                        <Input type="number" min="1" max="100" placeholder="Max" value={it.maxScore} onChange={e => updateItem(ci, ii, { maxScore: Number(e.target.value) || 1 })} />
                      </div>
                      <div className="col-span-3 flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={!!it.requirePhoto} onChange={e => updateItem(ci, ii, { requirePhoto: e.target.checked })} />
                        Photo required
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button size="icon" variant="ghost" onClick={() => setTpl(t => ({ ...t, categories: t.categories.map((c, i) => i === ci ? { ...c, items: c.items.filter((_, j) => j !== ii) } : c) }))}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => updateCat(ci, { items: [...cat.items, { label: "", maxScore: 5 }] })}>
                    <Plus className="w-3 h-3 mr-1" />Add item
                  </Button>
                </div>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setTpl(t => ({ ...t, categories: [...t.categories, { name: "", weight: 1, items: [{ label: "", maxScore: 5 }] }] }))}>
              <Plus className="w-3 h-3 mr-1" />Add category
            </Button>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={tpl.isActive} onChange={e => setTpl(t => ({ ...t, isActive: e.target.checked }))} />
            Active
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────── Assignments (manager view) ───────────────────
function AssignmentsPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const { data } = useQuery<{ data: AssignmentRow[] }>({ queryKey: ["mystery-audits", "assignments"], queryFn: () => apiGet("/mystery-audits/assignments") });
  const cancel = useMutation({
    mutationFn: (id: number) => apiDelete(`/mystery-audits/assignments/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mystery-audits"] }); toast({ title: "Assignment cancelled" }); },
    onError: (e: unknown) => toast({ title: (e as Error).message ?? "Failed", variant: "destructive" }),
  });
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-1" />New Assignment</Button></div>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-2">Outlet</th>
              <th className="text-left p-2">Template</th>
              <th className="text-left p-2">Auditor</th>
              <th className="text-left p-2">Due</th>
              <th className="text-left p-2">Status</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {(data?.data ?? []).map(a => (
              <tr key={a.id} className="border-t">
                <td className="p-2">{a.restaurantName}</td>
                <td className="p-2">{a.templateName}</td>
                <td className="p-2">{a.auditorName}</td>
                <td className="p-2">{a.dueDate ? new Date(a.dueDate).toLocaleDateString() : "—"}</td>
                <td className="p-2"><Badge variant={a.status === "locked" ? "default" : a.status === "cancelled" ? "secondary" : "outline"}>{a.status}</Badge></td>
                <td className="p-2 text-right">
                  {a.status !== "locked" && a.status !== "cancelled" && (
                    <Button size="sm" variant="ghost" onClick={() => { if (confirm("Cancel this assignment?")) cancel.mutate(a.id); }}>Cancel</Button>
                  )}
                </td>
              </tr>
            ))}
            {(data?.data ?? []).length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground text-sm">No assignments yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {creating && <NewAssignmentDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); qc.invalidateQueries({ queryKey: ["mystery-audits", "assignments"] }); }} />}
    </div>
  );
}

function NewAssignmentDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const { data: templates } = useQuery<{ data: TemplateRow[] }>({ queryKey: ["mystery-audits", "templates"], queryFn: () => apiGet("/mystery-audits/templates") });
  const { data: outlets } = useQuery<OutletOption[]>({ queryKey: ["branches", tenantId], queryFn: () => apiGet(`/tenants/${tenantId}/branches`), enabled: !!tenantId });
  const { data: auditors } = useQuery<{ data: AuditorOption[] }>({ queryKey: ["mystery-audits", "auditors"], queryFn: () => apiGet("/mystery-audits/auditors") });
  const [form, setForm] = useState({ templateId: 0, restaurantId: 0, auditorUserId: 0, dueDate: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.templateId || !form.restaurantId || !form.auditorUserId) {
      return toast({ title: "Template, outlet and auditor are required", variant: "destructive" });
    }
    setSaving(true);
    try {
      await apiPost("/mystery-audits/assignments", {
        templateId: form.templateId,
        restaurantId: form.restaurantId,
        auditorUserId: form.auditorUserId,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
        notes: form.notes || null,
      });
      toast({ title: "Assignment created" });
      onCreated();
    } catch (e: unknown) { toast({ title: (e as Error).message ?? "Failed", variant: "destructive" }); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>New audit assignment</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Template</Label>
            <Select value={String(form.templateId || "")} onValueChange={v => setForm(f => ({ ...f, templateId: Number(v) }))}>
              <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
              <SelectContent>
                {(templates?.data ?? []).filter(t => t.isActive).map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Outlet</Label>
            <Select value={String(form.restaurantId || "")} onValueChange={v => setForm(f => ({ ...f, restaurantId: Number(v) }))}>
              <SelectTrigger><SelectValue placeholder="Select outlet" /></SelectTrigger>
              <SelectContent>
                {(outlets ?? []).map(o => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Auditor</Label>
            <Select value={String(form.auditorUserId || "")} onValueChange={v => setForm(f => ({ ...f, auditorUserId: Number(v) }))}>
              <SelectTrigger><SelectValue placeholder="Select auditor" /></SelectTrigger>
              <SelectContent>
                {(auditors?.data ?? []).map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.role})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Due date</Label>
            <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────── My Audits ───────────────────
function MyAuditsPanel() {
  const { data } = useQuery<{ data: AssignmentRow[] }>({ queryKey: ["mystery-audits", "my-audits"], queryFn: () => apiGet("/mystery-audits/my-audits") });
  const [openId, setOpenId] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(data?.data ?? []).map(a => (
          <div key={a.id} className="border rounded-lg p-4 bg-card">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold truncate">{a.templateName}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{a.restaurantName}</p>
                <p className="text-xs mt-1">Due: {a.dueDate ? new Date(a.dueDate).toLocaleDateString() : "—"}</p>
              </div>
              <Badge variant={a.status === "locked" ? "default" : "outline"}>{a.status}</Badge>
            </div>
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={() => setOpenId(a.id)}>{a.status === "locked" ? "View" : "Open"}</Button>
            </div>
          </div>
        ))}
        {(data?.data ?? []).length === 0 && <div className="text-sm text-muted-foreground">No audits assigned to you.</div>}
      </div>
      {openId != null && <FillAuditDialog assignmentId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function FillAuditDialog({ assignmentId, onClose }: { assignmentId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const RESTAURANT_ID = useRestaurantId();
  const { data, refetch } = useQuery<{ data: SubmissionDetail | null }>({
    queryKey: ["mystery-audits", "submission", assignmentId],
    queryFn: () => apiGet(`/mystery-audits/assignments/${assignmentId}/submission`),
  });
  const sub = data?.data?.submission ?? null;
  const submissionId = sub?.id ?? 0;
  const isLocked = sub?.status === "locked";

  const { data: tplResp } = useQuery<{ data: TemplateDetail }>({
    queryKey: ["mystery-audits", "template-detail", sub?.templateId],
    queryFn: () => apiGet(`/mystery-audits/templates/${sub!.templateId}`),
    enabled: !!sub?.templateId,
  });
  const template = tplResp?.data;

  const [responses, setResponses] = useState<Record<number, { score: number; maxScore: number; categoryId: number; notes: string; photos: string[] }>>({});
  const [visitDate, setVisitDate] = useState("");
  const [generalNotes, setGeneralNotes] = useState("");

  useEffect(() => {
    if (!data?.data) return;
    const map: typeof responses = {};
    for (const r of data.data.responses ?? []) {
      map[r.itemId] = { score: r.score, maxScore: r.maxScore, categoryId: r.categoryId, notes: r.notes ?? "", photos: r.photos ?? [] };
    }
    setResponses(map);
    setVisitDate(data.data.submission?.visitDate ? data.data.submission.visitDate.slice(0, 10) : "");
    setGeneralNotes(data.data.submission?.generalNotes ?? "");
  }, [data?.data]);

  const items = useMemo(() => template?.categories.flatMap(c => (c.items ?? []).map(i => ({ ...i, categoryId: c.id!, categoryName: c.name }))) ?? [], [template]);

  const buildPayload = () => ({
    visitDate: visitDate ? new Date(visitDate).toISOString() : null,
    generalNotes,
    responses: items.map(it => {
      const r = responses[it.id!] ?? { score: 0, maxScore: it.maxScore, categoryId: it.categoryId, notes: "", photos: [] };
      return {
        itemId: it.id!,
        categoryId: it.categoryId,
        score: Math.max(0, Math.min(it.maxScore, r.score ?? 0)),
        maxScore: it.maxScore,
        notes: r.notes || null,
        photos: r.photos ?? [],
      };
    }),
  });

  const saveDraft = useMutation({
    mutationFn: () => apiPut(`/mystery-audits/submissions/${submissionId}`, buildPayload()),
    onSuccess: () => { toast({ title: "Saved" }); refetch(); },
    onError: (e: unknown) => toast({ title: (e as Error).message ?? "Save failed", variant: "destructive" }),
  });
  const submit = useMutation({
    mutationFn: async () => {
      await apiPut(`/mystery-audits/submissions/${submissionId}`, buildPayload());
      return apiPost(`/mystery-audits/submissions/${submissionId}/submit`);
    },
    onSuccess: () => {
      toast({ title: "Audit submitted and locked" });
      qc.invalidateQueries({ queryKey: ["mystery-audits"] });
      onClose();
    },
    onError: (e: unknown) => toast({ title: (e as Error).message ?? "Submit failed", variant: "destructive" }),
  });

  const uploadPhoto = async (itemId: number, file: File) => {
    try {
      const presign = await apiPost<{ uploadURL: string; objectPath: string }>(
        `/restaurants/${RESTAURANT_ID}/storage/uploads/request-url`,
        { name: file.name, size: file.size, contentType: file.type },
      );
      const put = await fetch(presign.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!put.ok) throw new Error("Upload failed");
      await apiPost(`/restaurants/${RESTAURANT_ID}/storage/uploads/finalize-public`, { objectPath: presign.objectPath });
      setResponses(r => ({ ...r, [itemId]: { ...(r[itemId] ?? { score: 0, maxScore: 5, categoryId: 0, notes: "", photos: [] }), photos: [...(r[itemId]?.photos ?? []), presign.objectPath] } }));
      toast({ title: "Photo added" });
    } catch (e: unknown) { toast({ title: (e as Error).message ?? "Upload failed", variant: "destructive" }); }
  };

  if (!sub) return null;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {template?.name ?? "Audit"}
            {isLocked && <Badge>Locked</Badge>}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Visit date</Label>
              <Input type="date" value={visitDate} onChange={e => setVisitDate(e.target.value)} disabled={isLocked} />
            </div>
            {isLocked && (
              <div className="text-sm flex flex-col justify-end">
                <div>Score: <strong>{Number(sub.weightedPercent).toFixed(1)}%</strong> ({Number(sub.totalScore).toFixed(1)} / {Number(sub.totalMaxScore).toFixed(1)})</div>
                {sub.pdfObjectPath && <button className="text-primary underline text-xs mt-1 text-left" onClick={() => downloadPdfAuthed(sub.restaurantId, sub.pdfObjectPath!).catch(e => alert(e.message))}>Download PDF</button>}
              </div>
            )}
          </div>
          <div className="space-y-3">
            {(template?.categories ?? []).map(cat => (
              <div key={cat.id} className="border rounded-md p-3 bg-muted/20">
                <div className="font-medium mb-2">{cat.name} <span className="text-xs text-muted-foreground">(weight {cat.weight}x)</span></div>
                <div className="space-y-2">
                  {(cat.items ?? []).map(it => {
                    const r = responses[it.id!] ?? { score: 0, maxScore: it.maxScore, categoryId: cat.id!, notes: "", photos: [] };
                    return (
                      <div key={it.id} className="border rounded p-2 bg-card">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm">{it.label}{it.requirePhoto && <Camera className="inline w-3 h-3 ml-1 text-muted-foreground" />}</span>
                          <div className="flex items-center gap-1 text-sm">
                            <Input type="number" min="0" max={it.maxScore} value={r.score}
                              onChange={e => setResponses(rs => ({ ...rs, [it.id!]: { ...r, score: Number(e.target.value) || 0, categoryId: cat.id! } }))}
                              disabled={isLocked} className="w-16 h-8 text-sm" />
                            <span className="text-muted-foreground">/ {it.maxScore}</span>
                          </div>
                        </div>
                        <Textarea rows={1} className="mt-2 text-xs" placeholder="Notes (optional)" value={r.notes}
                          onChange={e => setResponses(rs => ({ ...rs, [it.id!]: { ...r, notes: e.target.value, categoryId: cat.id! } }))}
                          disabled={isLocked} />
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {(r.photos ?? []).map((p, idx) => (
                            <div key={idx} className="relative w-14 h-14 border rounded overflow-hidden">
                              <img src={resolveImageUrl(p)} alt="" className="w-full h-full object-cover" />
                              {!isLocked && (
                                <button className="absolute top-0 right-0 bg-black/60 text-white rounded-bl px-1"
                                  onClick={() => setResponses(rs => ({ ...rs, [it.id!]: { ...r, photos: r.photos.filter((_, i) => i !== idx), categoryId: cat.id! } }))}>
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          ))}
                          {!isLocked && (
                            <label className="cursor-pointer text-xs flex items-center gap-1 border rounded px-2 py-1 hover:bg-muted">
                              <Upload className="w-3 h-3" />Photo
                              <input type="file" accept="image/*" capture="environment" className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) void uploadPhoto(it.id!, f); e.target.value = ""; }} />
                            </label>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div>
            <Label>Auditor notes</Label>
            <Textarea rows={3} value={generalNotes} onChange={e => setGeneralNotes(e.target.value)} disabled={isLocked} />
          </div>
        </div>
        <DialogFooter>
          {!isLocked && <>
            <Button variant="outline" onClick={() => saveDraft.mutate()} disabled={saveDraft.isPending}>{saveDraft.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save draft</Button>
            <Button onClick={() => { if (confirm("Submit and lock this audit? You won't be able to edit it afterwards.")) submit.mutate(); }} disabled={submit.isPending}>
              {submit.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Submit & lock
            </Button>
          </>}
          {isLocked && <Button variant="outline" onClick={onClose}>Close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────── History (per-outlet + chain-wide) ───────────────────
function HistoryPanel({ canExport }: { canExport: boolean }) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const { data: outlets } = useQuery<OutletOption[]>({ queryKey: ["branches", tenantId], queryFn: () => apiGet(`/tenants/${tenantId}/branches`), enabled: !!tenantId });
  const [restaurantId, setRestaurantId] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const params = restaurantId !== "all" ? `?restaurantId=${restaurantId}` : "";
  const { data } = useQuery<{ data: HistoryRow[] }>({
    queryKey: ["mystery-audits", "history", restaurantId],
    queryFn: () => apiGet(`/mystery-audits/history${params}`),
  });

  const filtered = useMemo(() => {
    return (data?.data ?? []).filter(r => {
      if (from && r.submittedAt && new Date(r.submittedAt) < new Date(from)) return false;
      if (to && r.submittedAt && new Date(r.submittedAt) > new Date(to + "T23:59:59")) return false;
      return true;
    });
  }, [data, from, to]);

  const trend = useMemo(() => {
    return [...filtered].reverse().map(r => ({ x: r.submittedAt ?? r.visitDate ?? "", y: Number(r.weightedPercent) }));
  }, [filtered]);

  const exportCsv = () => {
    const qs = new URLSearchParams();
    if (restaurantId !== "all") qs.set("restaurantId", restaurantId);
    if (from) qs.set("from", new Date(from).toISOString());
    if (to) qs.set("to", new Date(to + "T23:59:59").toISOString());
    const url = getApiUrl(`/mystery-audits/export.csv${qs.toString() ? "?" + qs.toString() : ""}`);
    const token = localStorage.getItem("tt_access_token");
    fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then(async r => {
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `mystery-audits-${Date.now()}.csv`;
      a.click();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label className="text-xs">Outlet</Label>
          <Select value={restaurantId} onValueChange={setRestaurantId}>
            <SelectTrigger className="min-w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All outlets</SelectItem>
              {(outlets ?? []).map(o => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">From</Label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        {canExport && <Button variant="outline" onClick={exportCsv}><FileDown className="w-4 h-4 mr-1" />Export CSV</Button>}
      </div>

      {trend.length > 1 && <TrendChart points={trend} />}

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-2">Date</th>
              <th className="text-left p-2">Outlet</th>
              <th className="text-left p-2">Template</th>
              <th className="text-left p-2">Auditor</th>
              <th className="text-left p-2">Score</th>
              <th className="text-left p-2">PDF</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : "—"}</td>
                <td className="p-2">{r.restaurantName}</td>
                <td className="p-2">{r.templateName}</td>
                <td className="p-2">{r.auditorName}</td>
                <td className="p-2 font-medium">{Number(r.weightedPercent).toFixed(1)}%</td>
                <td className="p-2">{r.pdfObjectPath ? <button className="text-primary underline" onClick={() => downloadPdfAuthed(r.restaurantId, r.pdfObjectPath!).catch(e => alert(e.message))}>Open</button> : "—"}</td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">No audits yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TrendChart({ points }: { points: Array<{ x: string; y: number }> }) {
  const w = 600, h = 120, pad = 24;
  const xs = points.map((_, i) => pad + (i * (w - 2 * pad)) / Math.max(1, points.length - 1));
  const ys = points.map(p => h - pad - ((Math.max(0, Math.min(100, p.y)) / 100) * (h - 2 * pad)));
  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  return (
    <div className="border rounded-lg p-3 bg-card">
      <div className="text-xs text-muted-foreground mb-1">Score trend</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-28">
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="currentColor" strokeOpacity="0.2" />
        <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="currentColor" strokeOpacity="0.2" />
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" className="text-primary" />
        {xs.map((x, i) => <circle key={i} cx={x} cy={ys[i]} r="3" className="fill-primary" />)}
      </svg>
    </div>
  );
}

async function downloadPdfAuthed(restaurantId: number, objectPath: string): Promise<void> {
  const url = getApiUrl(`/restaurants/${restaurantId}/storage${objectPath}`);
  const token = localStorage.getItem("tt_access_token");
  const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new Error("Could not download PDF");
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `audit-${Date.now()}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ─────────────────── Corrective actions ───────────────────
function ActionsPanel({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const params = statusFilter !== "all" ? `?status=${statusFilter}` : "";
  const { data } = useQuery<{ data: ActionRow[] }>({
    queryKey: ["mystery-audits", "actions", statusFilter],
    queryFn: () => apiGet(`/mystery-audits/corrective-actions${params}`),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => apiPatch(`/mystery-audits/corrective-actions/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mystery-audits", "actions"] }); toast({ title: "Updated" }); },
  });
  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/mystery-audits/corrective-actions/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mystery-audits", "actions"] }); toast({ title: "Deleted" }); },
  });
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="min-w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        {(data?.data ?? []).map(a => (
          <div key={a.id} className="border rounded-md p-3 bg-card">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={a.priority === "high" ? "destructive" : a.priority === "medium" ? "default" : "secondary"}>{a.priority}</Badge>
                  <Badge variant={a.status === "resolved" ? "default" : "outline"}>{a.status}</Badge>
                  <span className="text-xs text-muted-foreground">{a.restaurantName} · {a.categoryName ?? ""}{a.itemLabel ? ` / ${a.itemLabel}` : ""}</span>
                </div>
                <p className="mt-1 text-sm">{a.description}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Assigned to: {a.assignedToName ?? "—"} · Due: {a.dueDate ? new Date(a.dueDate).toLocaleDateString() : "—"}
                </p>
              </div>
              {canEdit && (
                <div className="flex flex-col gap-1">
                  {a.status !== "resolved" && (
                    <Button size="sm" variant="outline" onClick={() => {
                      const note = prompt("Resolution note (optional):", a.resolutionNote ?? "");
                      if (note === null) return;
                      update.mutate({ id: a.id, body: { status: "resolved", resolutionNote: note } });
                    }}>Resolve</Button>
                  )}
                  {a.status === "resolved" && (
                    <Button size="sm" variant="outline" onClick={() => update.mutate({ id: a.id, body: { status: "open" } })}>Reopen</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => { if (confirm("Delete this action?")) del.mutate(a.id); }}><Trash2 className="w-4 h-4" /></Button>
                </div>
              )}
            </div>
          </div>
        ))}
        {(data?.data ?? []).length === 0 && <div className="text-sm text-muted-foreground">No corrective actions.</div>}
      </div>
      {canEdit && <NewActionPanel onCreated={() => qc.invalidateQueries({ queryKey: ["mystery-audits", "actions"] })} />}
    </div>
  );
}

function NewActionPanel({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const { data: history } = useQuery<{ data: HistoryRow[] }>({ queryKey: ["mystery-audits", "history", "all"], queryFn: () => apiGet("/mystery-audits/history") });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ submissionId: 0, description: "", priority: "medium" as "low" | "medium" | "high", dueDate: "" });
  const submit = async () => {
    if (!form.submissionId || !form.description.trim()) return toast({ title: "Audit and description required", variant: "destructive" });
    try {
      await apiPost("/mystery-audits/corrective-actions", {
        submissionId: form.submissionId,
        description: form.description.trim(),
        priority: form.priority,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
      });
      toast({ title: "Action created" });
      setOpen(false);
      setForm({ submissionId: 0, description: "", priority: "medium", dueDate: "" });
      onCreated();
    } catch (e: unknown) { toast({ title: (e as Error).message ?? "Failed", variant: "destructive" }); }
  };
  return (
    <>
      <div className="flex justify-end"><Button onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-1" />New corrective action</Button></div>
      {open && (
        <Dialog open onOpenChange={() => setOpen(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>New corrective action</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Audit (submitted)</Label>
                <Select value={String(form.submissionId || "")} onValueChange={v => setForm(f => ({ ...f, submissionId: Number(v) }))}>
                  <SelectTrigger><SelectValue placeholder="Select audit" /></SelectTrigger>
                  <SelectContent>
                    {(history?.data ?? []).map(h => (
                      <SelectItem key={h.id} value={String(h.id)}>
                        {h.restaurantName} · {h.templateName} · {h.submittedAt ? new Date(h.submittedAt).toLocaleDateString() : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Description</Label>
                <Textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Priority</Label>
                  <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as "low" | "medium" | "high" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Due date</Label>
                  <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
