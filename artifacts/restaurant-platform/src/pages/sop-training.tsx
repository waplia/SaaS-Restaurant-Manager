import { useEffect, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPost, apiPatch, apiDelete, apiPut } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Plus, Trash2, Pencil, BookOpen, GraduationCap, ClipboardCheck, Users, Loader2 } from "lucide-react";

type Role = "owner" | "manager" | "cashier" | "waiter" | "kitchen" | "delivery_executive";
const ROLES: Role[] = ["owner", "manager", "cashier", "waiter", "kitchen", "delivery_executive"];
const SOP_CATEGORIES = ["recipe", "cleaning", "opening", "closing", "hygiene", "fire_safety", "other"] as const;
type SopCategory = typeof SOP_CATEGORIES[number];

interface ChecklistItem { id?: number; label: string; isRequired: boolean; sortOrder?: number }
interface Sop { id: number; title: string; category: SopCategory; content: string; visibleRoles: Role[]; isPublished: boolean; version: number; checklist: ChecklistItem[]; attachments: Array<{ name: string; url: string }>; updatedAt: string }
interface Course { id: number; title: string; description: string; requiredRoles: Role[]; isPublished: boolean; isOnboarding: boolean; expiryMonths: number | null; requiresApproval: boolean; passMarkPercent: number }
interface Module { id?: number; title: string; videoUrl: string | null; documents: Array<{ name: string; url: string }>; linkedSopId: number | null; body: string }
interface Question { id?: number; question: string; options: string[]; correctIndex: number }
interface PendingApproval { id: number; assignmentId: number; courseTitle: string; userName: string; userEmail: string; score: number | null; createdAt: string }
interface ProgressRow { user: { id: number; name: string; role: string; email: string }; required: Array<{ courseId: number; courseTitle: string; status: string; lastScore: number | null; expiresAt: string | null }>; completionPercent: number }
interface StaffUser { id: number; name: string; email: string; role: string; isActive: boolean }

function rolesLabel(roles: Role[]) { return roles.length === 0 ? "All staff" : roles.join(", "); }

function emptyChecklist(): ChecklistItem[] { return [{ label: "", isRequired: true }]; }

export default function SopTrainingPage() {
  const { user } = useAuth();
  const isAuthor = user?.role === "owner" || user?.role === "manager" || user?.isSuperAdmin;
  const [tab, setTab] = useState("sops");
  return (
    <Layout>
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <BookOpen className="w-6 h-6" />
          <h1 className="text-2xl font-semibold">SOP &amp; Training</h1>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="sops"><BookOpen className="w-4 h-4 mr-1" />SOPs</TabsTrigger>
            {isAuthor && <TabsTrigger value="courses"><GraduationCap className="w-4 h-4 mr-1" />Courses</TabsTrigger>}
            {isAuthor && <TabsTrigger value="approvals"><ClipboardCheck className="w-4 h-4 mr-1" />Approvals</TabsTrigger>}
            {isAuthor && <TabsTrigger value="progress"><Users className="w-4 h-4 mr-1" />Progress</TabsTrigger>}
          </TabsList>
          <TabsContent value="sops"><SopsPanel canEdit={!!isAuthor} /></TabsContent>
          {isAuthor && <TabsContent value="courses"><CoursesPanel /></TabsContent>}
          {isAuthor && <TabsContent value="approvals"><ApprovalsPanel /></TabsContent>}
          {isAuthor && <TabsContent value="progress"><ProgressPanel /></TabsContent>}
        </Tabs>
      </div>
    </Layout>
  );
}

// ─────────────────────────── SOPs ───────────────────────────
function SopsPanel({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery<{ data: Sop[] }>({ queryKey: ["sops"], queryFn: () => apiGet("/sop-training/sops") });
  const [editing, setEditing] = useState<Sop | null>(null);
  const [creating, setCreating] = useState(false);

  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/sop-training/sops/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sops"] }); toast({ title: "SOP deleted" }); },
  });

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-1" />New SOP</Button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(data?.data ?? []).map(sop => (
          <div key={sop.id} className="border rounded-lg p-4 bg-card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{sop.title}</h3>
                  <Badge variant={sop.isPublished ? "default" : "secondary"}>{sop.isPublished ? "Published" : "Draft"}</Badge>
                  <Badge variant="outline">v{sop.version}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{sop.category} · {rolesLabel(sop.visibleRoles)}</div>
              </div>
              {canEdit && (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => setEditing(sop)}><Pencil className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete SOP?")) del.mutate(sop.id); }}><Trash2 className="w-4 h-4" /></Button>
                </div>
              )}
            </div>
            <p className="text-sm mt-2 whitespace-pre-wrap line-clamp-4">{sop.content}</p>
            {sop.checklist.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-medium mb-1">Checklist ({sop.checklist.length} items)</div>
                <ChecklistRunForm sop={sop} />
              </div>
            )}
            {sop.attachments.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {sop.attachments.map((a, i) => (
                  <a key={i} href={a.url} target="_blank" rel="noreferrer" className="text-xs underline">{a.name}</a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {(creating || editing) && (
        <SopEditorDialog
          sop={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["sops"] }); setCreating(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function ChecklistRunForm({ sop }: { sop: Sop }) {
  const { toast } = useToast();
  const [results, setResults] = useState<Record<string, { checked: boolean; note?: string }>>({});
  const [notes, setNotes] = useState("");
  const submit = useMutation({
    mutationFn: () => apiPost(`/sop-training/sops/${sop.id}/checklist-runs`, { results, notes }),
    onSuccess: () => { toast({ title: "Checklist submitted" }); setResults({}); setNotes(""); },
  });
  return (
    <div className="space-y-2">
      {sop.checklist.map(item => {
        const key = String(item.id ?? item.label);
        const checked = !!results[key]?.checked;
        return (
          <label key={key} className="flex items-start gap-2 text-sm">
            <Checkbox checked={checked} onCheckedChange={v => setResults(r => ({ ...r, [key]: { checked: !!v } }))} />
            <span className={checked ? "line-through text-muted-foreground" : ""}>{item.label}{item.isRequired && <span className="text-red-500"> *</span>}</span>
          </label>
        );
      })}
      <Textarea placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
      <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending}>
        {submit.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Submit completion
      </Button>
    </div>
  );
}

function SopEditorDialog({ sop, onClose, onSaved }: { sop: Sop | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(sop?.title ?? "");
  const [category, setCategory] = useState<SopCategory>(sop?.category ?? "other");
  const [content, setContent] = useState(sop?.content ?? "");
  const [visibleRoles, setVisibleRoles] = useState<Role[]>(sop?.visibleRoles ?? []);
  const [isPublished, setIsPublished] = useState(sop?.isPublished ?? false);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(sop?.checklist?.length ? sop.checklist : emptyChecklist());
  const [attachments, setAttachments] = useState(sop?.attachments ?? []);
  const [uploading, setUploading] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const payload = { title, category, content, visibleRoles, isPublished, checklist, attachments };
      if (sop) return apiPatch(`/sop-training/sops/${sop.id}`, payload);
      return apiPost("/sop-training/sops", payload);
    },
    onSuccess: () => { toast({ title: sop ? "SOP updated" : "SOP created" }); onSaved(); },
    onError: (err: Error) => toast({ title: "Failed to save", description: err.message, variant: "destructive" }),
  });

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const r = await apiPost<{ uploadURL: string; objectPath: string }>("/sop-training/uploads/request-url", {});
      await fetch(r.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      await apiPost("/sop-training/uploads/finalize", { objectPath: r.objectPath });
      setAttachments(a => [...a, { name: file.name, url: r.objectPath }]);
    } finally { setUploading(false); }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{sop ? "Edit SOP" : "New SOP"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Title</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <Select value={category} onValueChange={v => setCategory(v as SopCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOP_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Visible to roles</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {ROLES.map(r => (
                  <label key={r} className="flex items-center gap-1 text-xs">
                    <Checkbox checked={visibleRoles.includes(r)} onCheckedChange={v => setVisibleRoles(rs => v ? [...rs, r] : rs.filter(x => x !== r))} />{r}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div><Label>Content</Label><Textarea value={content} onChange={e => setContent(e.target.value)} rows={6} /></div>
          <div>
            <Label>Checklist items</Label>
            <div className="space-y-2">
              {checklist.map((it, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input value={it.label} onChange={e => setChecklist(c => c.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder={`Item ${i + 1}`} />
                  <label className="flex items-center gap-1 text-xs"><Checkbox checked={it.isRequired} onCheckedChange={v => setChecklist(c => c.map((x, j) => j === i ? { ...x, isRequired: !!v } : x))} />Required</label>
                  <Button size="icon" variant="ghost" onClick={() => setChecklist(c => c.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setChecklist(c => [...c, { label: "", isRequired: true }])}><Plus className="w-3 h-3 mr-1" />Add item</Button>
            </div>
          </div>
          <div>
            <Label>Attachments</Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {attachments.map((a, i) => (
                <div key={i} className="flex items-center gap-1 text-xs border rounded px-2 py-1">
                  <span>{a.name}</span>
                  <Button size="icon" variant="ghost" className="h-4 w-4" onClick={() => setAttachments(at => at.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3" /></Button>
                </div>
              ))}
            </div>
            <Input type="file" disabled={uploading} onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }} />
          </div>
          <label className="flex items-center gap-2"><Checkbox checked={isPublished} onCheckedChange={v => setIsPublished(!!v)} />Published (visible to staff)</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !title}>{save.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── Courses ───────────────────────────
function CoursesPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery<{ data: Course[] }>({ queryKey: ["courses"], queryFn: () => apiGet("/sop-training/courses") });
  const [editing, setEditing] = useState<Course | null>(null);
  const [creating, setCreating] = useState(false);
  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/sop-training/courses/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["courses"] }); toast({ title: "Course deleted" }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-1" />New Course</Button></div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(data?.data ?? []).map(c => (
          <div key={c.id} className="border rounded-lg p-4 bg-card">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{c.title}</h3>
                  <Badge variant={c.isPublished ? "default" : "secondary"}>{c.isPublished ? "Published" : "Draft"}</Badge>
                  {c.isOnboarding && <Badge variant="outline">Onboarding</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-1">For: {rolesLabel(c.requiredRoles)} · Pass: {c.passMarkPercent}% {c.requiresApproval && "· Approval"} {c.expiryMonths && `· Expires ${c.expiryMonths}mo`}</div>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => setEditing(c)}><Pencil className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete course?")) del.mutate(c.id); }}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>
            <p className="text-sm mt-2">{c.description}</p>
            <div className="mt-2"><AssignButton courseId={c.id} /></div>
          </div>
        ))}
      </div>
      {(creating || editing) && (
        <CourseEditorDialog course={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { qc.invalidateQueries({ queryKey: ["courses"] }); setCreating(false); setEditing(null); }} />
      )}
    </div>
  );
}

function AssignButton({ courseId }: { courseId: number }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const { data } = useQuery<StaffUser[]>({ queryKey: ["users-list"], queryFn: () => apiGet("/users"), enabled: open });
  const [selected, setSelected] = useState<number[]>([]);
  const assign = useMutation({
    mutationFn: () => apiPost(`/sop-training/courses/${courseId}/assign`, { userIds: selected }),
    onSuccess: (r: { assigned: number }) => { toast({ title: `Assigned to ${r.assigned} staff` }); setOpen(false); setSelected([]); },
  });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Users className="w-3 h-3 mr-1" />Assign staff</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign staff</DialogTitle></DialogHeader>
          <div className="max-h-80 overflow-y-auto space-y-1">
            {(data ?? []).filter(u => u.isActive).map(u => (
              <label key={u.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={selected.includes(u.id)} onCheckedChange={v => setSelected(s => v ? [...s, u.id] : s.filter(x => x !== u.id))} />
                {u.name} <span className="text-xs text-muted-foreground">({u.role})</span>
              </label>
            ))}
          </div>
          <DialogFooter><Button onClick={() => assign.mutate()} disabled={!selected.length || assign.isPending}>Assign</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CourseEditorDialog({ course, onClose, onSaved }: { course: Course | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(course?.title ?? "");
  const [description, setDescription] = useState(course?.description ?? "");
  const [requiredRoles, setRequiredRoles] = useState<Role[]>(course?.requiredRoles ?? []);
  const [isPublished, setIsPublished] = useState(course?.isPublished ?? false);
  const [isOnboarding, setIsOnboarding] = useState(course?.isOnboarding ?? false);
  const [requiresApproval, setRequiresApproval] = useState(course?.requiresApproval ?? false);
  const [passMarkPercent, setPass] = useState(course?.passMarkPercent ?? 70);
  const [expiryMonths, setExpiry] = useState<number | "">(course?.expiryMonths ?? "");
  const [modules, setModules] = useState<Module[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loaded, setLoaded] = useState(!course);

  useEffect(() => {
    if (!course) return;
    apiGet<{ modules: Module[]; questions: Question[] }>(`/sop-training/courses/${course.id}`).then(r => {
      setModules(r.modules); setQuestions(r.questions); setLoaded(true);
    });
  }, [course]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = { title, description, requiredRoles, isPublished, isOnboarding, requiresApproval, passMarkPercent, expiryMonths: expiryMonths === "" ? null : expiryMonths };
      const saved = course
        ? await apiPatch<Course>(`/sop-training/courses/${course.id}`, payload)
        : await apiPost<Course>("/sop-training/courses", payload);
      await apiPut(`/sop-training/courses/${saved.id}/modules`, { modules });
      await apiPut(`/sop-training/courses/${saved.id}/questions`, { questions });
      return saved;
    },
    onSuccess: () => { toast({ title: course ? "Course updated" : "Course created" }); onSaved(); },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  if (!loaded) return null;
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{course ? "Edit course" : "New course"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Title</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
          <div><Label>Description</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Pass mark %</Label><Input type="number" value={passMarkPercent} onChange={e => setPass(Number(e.target.value) || 0)} /></div>
            <div><Label>Expiry (months)</Label><Input type="number" value={expiryMonths} onChange={e => setExpiry(e.target.value === "" ? "" : Number(e.target.value))} /></div>
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={isPublished} onCheckedChange={v => setIsPublished(!!v)} />Published</label>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={isOnboarding} onCheckedChange={v => setIsOnboarding(!!v)} />Onboarding (auto-assign new staff)</label>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={requiresApproval} onCheckedChange={v => setRequiresApproval(!!v)} />Requires manager approval</label>
            </div>
          </div>
          <div>
            <Label>Required roles</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {ROLES.map(r => (
                <label key={r} className="flex items-center gap-1 text-xs">
                  <Checkbox checked={requiredRoles.includes(r)} onCheckedChange={v => setRequiredRoles(rs => v ? [...rs, r] : rs.filter(x => x !== r))} />{r}
                </label>
              ))}
            </div>
          </div>
          <div className="border-t pt-3">
            <div className="flex items-center justify-between mb-2"><Label>Modules</Label>
              <Button size="sm" variant="outline" onClick={() => setModules(m => [...m, { title: "", videoUrl: "", documents: [], linkedSopId: null, body: "" }])}><Plus className="w-3 h-3 mr-1" />Add module</Button>
            </div>
            <div className="space-y-3">
              {modules.map((m, i) => (
                <div key={i} className="border rounded p-2 space-y-2">
                  <div className="flex gap-2"><Input value={m.title} onChange={e => setModules(arr => arr.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} placeholder={`Module ${i + 1} title`} />
                    <Button size="icon" variant="ghost" onClick={() => setModules(arr => arr.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                  <Input value={m.videoUrl ?? ""} onChange={e => setModules(arr => arr.map((x, j) => j === i ? { ...x, videoUrl: e.target.value } : x))} placeholder="Video URL (YouTube/Vimeo)" />
                  <Textarea value={m.body} onChange={e => setModules(arr => arr.map((x, j) => j === i ? { ...x, body: e.target.value } : x))} placeholder="Module notes / instructions" rows={2} />
                </div>
              ))}
            </div>
          </div>
          <div className="border-t pt-3">
            <div className="flex items-center justify-between mb-2"><Label>Quiz questions</Label>
              <Button size="sm" variant="outline" onClick={() => setQuestions(q => [...q, { question: "", options: ["", ""], correctIndex: 0 }])}><Plus className="w-3 h-3 mr-1" />Add question</Button>
            </div>
            <div className="space-y-3">
              {questions.map((q, i) => (
                <div key={i} className="border rounded p-2 space-y-2">
                  <div className="flex gap-2">
                    <Input value={q.question} onChange={e => setQuestions(arr => arr.map((x, j) => j === i ? { ...x, question: e.target.value } : x))} placeholder={`Question ${i + 1}`} />
                    <Button size="icon" variant="ghost" onClick={() => setQuestions(arr => arr.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                  {q.options.map((opt, k) => (
                    <div key={k} className="flex gap-2 items-center">
                      <input type="radio" checked={q.correctIndex === k} onChange={() => setQuestions(arr => arr.map((x, j) => j === i ? { ...x, correctIndex: k } : x))} />
                      <Input value={opt} onChange={e => setQuestions(arr => arr.map((x, j) => j === i ? { ...x, options: x.options.map((o, l) => l === k ? e.target.value : o) } : x))} placeholder={`Option ${k + 1}`} />
                      <Button size="icon" variant="ghost" onClick={() => setQuestions(arr => arr.map((x, j) => j === i ? { ...x, options: x.options.filter((_, l) => l !== k), correctIndex: Math.min(x.correctIndex, x.options.length - 2) } : x))}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => setQuestions(arr => arr.map((x, j) => j === i ? { ...x, options: [...x.options, ""] } : x))}><Plus className="w-3 h-3 mr-1" />Add option</Button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} disabled={save.isPending || !title}>{save.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── Approvals ───────────────────────────
function ApprovalsPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery<{ data: PendingApproval[] }>({ queryKey: ["approvals-pending"], queryFn: () => apiGet("/sop-training/approvals/pending") });
  const decide = useMutation({
    mutationFn: (args: { id: number; decision: "approved" | "rejected"; note?: string }) => apiPost(`/sop-training/approvals/${args.id}/decision`, { decision: args.decision, note: args.note }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["approvals-pending"] }); toast({ title: "Decision recorded" }); },
  });
  const rows = data?.data ?? [];
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No pending approvals.</p>;
  return (
    <div className="space-y-2">
      {rows.map(r => (
        <div key={r.id} className="border rounded p-3 flex items-center justify-between">
          <div>
            <div className="font-medium">{r.userName} <span className="text-xs text-muted-foreground">({r.userEmail})</span></div>
            <div className="text-sm text-muted-foreground">{r.courseTitle} · score {r.score ?? "—"}%</div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { const note = prompt("Reason (optional)") ?? ""; decide.mutate({ id: r.id, decision: "rejected", note }); }}>Reject</Button>
            <Button size="sm" onClick={() => decide.mutate({ id: r.id, decision: "approved" })}>Approve</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────── Progress ───────────────────────────
function ProgressPanel() {
  const [role, setRole] = useState<string>("");
  const { data } = useQuery<{ data: ProgressRow[] }>({ queryKey: ["progress", role], queryFn: () => apiGet(`/sop-training/progress${role ? `?role=${role}` : ""}`) });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label>Filter by role</Label>
        <Select value={role || "all"} onValueChange={v => setRole(v === "all" ? "" : v)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="border rounded">
        <table className="w-full text-sm">
          <thead className="bg-muted/50"><tr><th className="text-left p-2">Staff</th><th className="text-left p-2">Role</th><th className="text-left p-2">Required courses</th><th className="text-left p-2">Completion</th></tr></thead>
          <tbody>
            {(data?.data ?? []).map(row => (
              <tr key={row.user.id} className="border-t">
                <td className="p-2">{row.user.name}</td>
                <td className="p-2">{row.user.role}</td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    {row.required.map(c => (
                      <Badge key={c.courseId} variant={c.status === "completed" ? "default" : c.status === "expired" ? "destructive" : "secondary"}>{c.courseTitle}: {c.status}</Badge>
                    ))}
                  </div>
                </td>
                <td className="p-2 font-medium">{row.completionPercent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
