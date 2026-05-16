import { useMemo, useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Folder, Upload, Search, Download, Trash2, Pencil, AlertTriangle, Clock,
  FileText, Calendar, Tag as TagIcon, Loader2, Plus, Shield, History as HistoryIcon, X,
} from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost, apiPatch, apiDelete, getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

type Permission = "view" | "download" | "edit" | "delete";
type Doc = {
  id: number;
  restaurantId: number;
  branchId: number | null;
  category: string;
  title: string;
  description: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  objectPath: string;
  tags: string[];
  issuedAt: string | null;
  expiresAt: string | null;
  reminderDays: number;
  referenceNumber: string | null;
  issuer: string | null;
  isRequired: boolean;
  status: string;
  version: number;
  uploadedBy: number | null;
  createdAt: string;
  updatedAt: string;
  permissions: Permission[];
};
type Stats = {
  total: number; expired: number; expiring: number;
  byCategory: { category: string; count: number }[];
};
type Grant = {
  id: number; documentId: number; principalType: "role" | "user";
  principalRef: string; permission: Permission;
};
type AuditRow = {
  id: number; documentId: number | null; userDisplay: string | null;
  action: string; details: Record<string, unknown> | null; createdAt: string;
};

const CATEGORIES: { value: string; label: string }[] = [
  { value: "fssai", label: "FSSAI" }, { value: "gst", label: "GST" },
  { value: "rent", label: "Rent / Lease" }, { value: "staff", label: "Staff" },
  { value: "vendor", label: "Vendor" }, { value: "franchise", label: "Franchise" },
  { value: "fire", label: "Fire / NOC" }, { value: "bank", label: "Bank" },
  { value: "insurance", label: "Insurance" }, { value: "payroll", label: "Payroll" },
  { value: "tax", label: "Tax" }, { value: "invoice", label: "Invoice" },
  { value: "compliance", label: "Compliance" }, { value: "other", label: "Other" },
];
const ROLES = ["owner", "manager", "accountant", "staff", "waiter", "chef"];

function categoryLabel(v: string): string {
  return CATEGORIES.find(c => c.value === v)?.label ?? v;
}
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function expiryBadge(d: Doc): { label: string; tone: "ok" | "warn" | "danger" | "neutral" } | null {
  if (!d.expiresAt) return null;
  const days = Math.ceil((new Date(d.expiresAt).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: `Expired ${-days}d ago`, tone: "danger" };
  if (days <= d.reminderDays) return { label: `Expires in ${days}d`, tone: "warn" };
  return { label: `Valid · ${days}d`, tone: "ok" };
}

async function uploadToVault(rid: number, file: File): Promise<{ objectPath: string; size: number }> {
  const presign = await apiPost<{ uploadURL: string; objectPath: string }>(
    `/restaurants/${rid}/storage/uploads/request-url`,
    { name: file.name, size: file.size, contentType: file.type || "application/octet-stream" },
  );
  const put = await fetch(presign.uploadURL, {
    method: "PUT", body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return { objectPath: presign.objectPath, size: file.size };
}

export default function DocumentsPage() {
  const rid = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<"all" | "expiring" | "expired">("all");
  const [category, setCategory] = useState<string>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<Doc | null>(null);
  const [auditFor, setAuditFor] = useState<Doc | null>(null);

  const filters = useMemo(() => {
    const p = new URLSearchParams();
    if (category !== "all") p.set("category", category);
    if (q.trim()) p.set("q", q.trim());
    if (tab === "expiring") p.set("expiring", "1");
    if (tab === "expired") p.set("expired", "1");
    return p.toString();
  }, [category, q, tab]);

  const docsQ = useQuery({
    queryKey: ["documents", rid, filters],
    queryFn: () => apiGet<Doc[]>(`/restaurants/${rid}/documents${filters ? `?${filters}` : ""}`),
    enabled: !!rid,
  });
  const statsQ = useQuery({
    queryKey: ["documents-stats", rid],
    queryFn: () => apiGet<Stats>(`/restaurants/${rid}/documents/stats`),
    enabled: !!rid,
  });

  const removeMut = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${rid}/documents/${id}`),
    onSuccess: () => {
      toast({ title: "Document deleted" });
      qc.invalidateQueries({ queryKey: ["documents", rid] });
      qc.invalidateQueries({ queryKey: ["documents-stats", rid] });
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const docs = docsQ.data ?? [];
  const allSelectable = docs.filter(d => d.permissions.includes("download"));
  const allChecked = allSelectable.length > 0 && allSelectable.every(d => selected.has(d.id));

  function toggleAll() {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(allSelectable.map(d => d.id)));
  }

  async function bulkDownload() {
    if (selected.size === 0) return;
    const res = await fetch(getApiUrl(`/restaurants/${rid}/documents/bulk-download`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected) }),
    });
    if (!res.ok) {
      toast({ title: "Bulk download failed", variant: "destructive" });
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `documents-${Date.now()}.zip`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setSelected(new Set());
  }

  async function downloadOne(d: Doc) {
    const res = await fetch(getApiUrl(`/restaurants/${rid}/documents/${d.id}/download`), {
      credentials: "include",
    });
    if (!res.ok) { toast({ title: "Download failed", variant: "destructive" }); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = d.fileName;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  const stats = statsQ.data;

  return (
    <Layout>
      <PageHeader title="Document Vault" subtitle="Centralized store for FSSAI, GST, rent, staff, vendor and other business documents." icon={Folder}>
        <Button onClick={() => setUploadOpen(true)} data-testid="button-upload-document">
          <Upload className="w-4 h-4 mr-2" /> Upload
        </Button>
      </PageHeader>

      {/* Stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
        <StatTile icon={FileText} label="Total documents" value={stats?.total ?? 0} />
        <StatTile icon={Clock} label="Expiring (≤30d)" value={stats?.expiring ?? 0} tone="warn" />
        <StatTile icon={AlertTriangle} label="Expired" value={stats?.expired ?? 0} tone="danger" />
        <StatTile icon={Shield} label="Categories used" value={stats?.byCategory.length ?? 0} />
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="expiring">Expiring</TabsTrigger>
                <TabsTrigger value="expired">Expired</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, reference, issuer…" className="pl-9" data-testid="input-search-documents" />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full md:w-[220px]" data-testid="select-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {selected.size > 0 && (
              <Button variant="outline" onClick={bulkDownload} data-testid="button-bulk-download">
                <Download className="w-4 h-4 mr-2" /> Download {selected.size} as ZIP
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {docsQ.isLoading ? (
            <div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : docs.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Folder className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>No documents yet. Click <strong>Upload</strong> to add your first one.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="p-3 w-10"><Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label="Select all" /></th>
                    <th className="p-3">Title</th>
                    <th className="p-3">Category</th>
                    <th className="p-3">Expiry</th>
                    <th className="p-3">Size</th>
                    <th className="p-3">Updated</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map(d => {
                    const exp = expiryBadge(d);
                    const canEdit = d.permissions.includes("edit");
                    const canDelete = d.permissions.includes("delete");
                    const canDownload = d.permissions.includes("download");
                    return (
                      <tr key={d.id} className="border-t hover:bg-muted/20">
                        <td className="p-3">
                          <Checkbox
                            checked={selected.has(d.id)}
                            disabled={!canDownload}
                            onCheckedChange={(v) => {
                              const next = new Set(selected);
                              if (v) next.add(d.id); else next.delete(d.id);
                              setSelected(next);
                            }}
                            aria-label={`Select ${d.title}`}
                          />
                        </td>
                        <td className="p-3">
                          <div className="font-medium" data-testid={`text-doc-title-${d.id}`}>{d.title}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[280px]">{d.fileName}</div>
                          {d.tags.length > 0 && (
                            <div className="flex gap-1 mt-1 flex-wrap">
                              {d.tags.slice(0, 4).map(t => (
                                <Badge key={t} variant="outline" className="text-[10px] px-1 py-0">{t}</Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="p-3">
                          <Badge variant="secondary">{categoryLabel(d.category)}</Badge>
                          {d.isRequired && <Badge className="ml-1 bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100">Required</Badge>}
                        </td>
                        <td className="p-3">
                          {exp ? (
                            <span className={cn(
                              "inline-flex items-center gap-1 text-xs px-2 py-1 rounded",
                              exp.tone === "danger" && "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
                              exp.tone === "warn" && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
                              exp.tone === "ok" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
                            )}>
                              <Calendar className="w-3 h-3" /> {exp.label}
                            </span>
                          ) : <span className="text-muted-foreground text-xs">No expiry</span>}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">{fmtBytes(d.sizeBytes)}</td>
                        <td className="p-3 text-xs text-muted-foreground">{fmtDate(d.updatedAt)}</td>
                        <td className="p-3 text-right">
                          <div className="inline-flex gap-1">
                            <Button size="sm" variant="ghost" disabled={!canDownload} onClick={() => downloadOne(d)} data-testid={`button-download-${d.id}`}>
                              <Download className="w-4 h-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setAuditFor(d)} title="History">
                              <HistoryIcon className="w-4 h-4" />
                            </Button>
                            <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => setEditing(d)} data-testid={`button-edit-${d.id}`}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button size="sm" variant="ghost" disabled={!canDelete}
                              onClick={() => { if (confirm(`Delete "${d.title}"?`)) removeMut.mutate(d.id); }}
                              data-testid={`button-delete-${d.id}`}>
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {uploadOpen && rid && <UploadDialog rid={rid} onClose={() => setUploadOpen(false)} onSaved={() => {
        qc.invalidateQueries({ queryKey: ["documents", rid] });
        qc.invalidateQueries({ queryKey: ["documents-stats", rid] });
      }} />}
      {editing && rid && <EditDialog rid={rid} doc={editing} onClose={() => setEditing(null)} onSaved={() => {
        qc.invalidateQueries({ queryKey: ["documents", rid] });
      }} />}
      {auditFor && rid && <AuditDialog rid={rid} doc={auditFor} onClose={() => setAuditFor(null)} />}
    </Layout>
  );
}

function StatTile({ icon: Icon, label, value, tone }: { icon: typeof FileText; label: string; value: number; tone?: "warn" | "danger" }) {
  return (
    <Card>
      <CardContent className="pt-4 flex items-center gap-3">
        <div className={cn(
          "w-10 h-10 rounded-lg flex items-center justify-center",
          tone === "warn" && "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
          tone === "danger" && "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
          !tone && "bg-primary/10 text-primary",
        )}><Icon className="w-5 h-5" /></div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-2xl font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function UploadDialog({ rid, onClose, onSaved }: { rid: number; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("fssai");
  const [description, setDescription] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [issuer, setIssuer] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [reminderDays, setReminderDays] = useState(30);
  const [tagsText, setTagsText] = useState("");
  const [isRequired, setIsRequired] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!file) { toast({ title: "Pick a file", variant: "destructive" }); return; }
    if (!title.trim()) { toast({ title: "Title is required", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const { objectPath, size } = await uploadToVault(rid, file);
      await apiPost(`/restaurants/${rid}/documents`, {
        category, title: title.trim(),
        description: description.trim() || null,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: size,
        objectPath,
        tags: tagsText.split(",").map(s => s.trim()).filter(Boolean).slice(0, 20),
        issuedAt: issuedAt ? new Date(issuedAt).toISOString() : null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        reminderDays,
        referenceNumber: referenceNumber.trim() || null,
        issuer: issuer.trim() || null,
        isRequired,
      });
      toast({ title: "Document uploaded" });
      onSaved();
      onClose();
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Upload document</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <label className="text-sm font-medium">File*</label>
            <Input ref={fileRef} type="file" accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-file" />
            {file && <div className="text-xs text-muted-foreground mt-1">{file.name} · {fmtBytes(file.size)}</div>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Title*</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. FSSAI License 2026" data-testid="input-title" />
            </div>
            <div>
              <label className="text-sm font-medium">Category*</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger data-testid="select-upload-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Reference number</label>
              <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="License / GSTIN / etc." />
            </div>
            <div>
              <label className="text-sm font-medium">Issued by</label>
              <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="FSSAI / Income Tax Dept / …" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium">Issued on</label>
              <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">Expires on</label>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} data-testid="input-expires-at" />
            </div>
            <div>
              <label className="text-sm font-medium">Remind (days before)</label>
              <Input type="number" min={0} max={365} value={reminderDays} onChange={(e) => setReminderDays(Number(e.target.value) || 0)} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Tags (comma-separated)</label>
            <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="2026, branch-mumbai, renewable" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isRequired} onCheckedChange={(v) => setIsRequired(!!v)} />
            Mark as required compliance document
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy} data-testid="button-submit-upload">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ rid, doc, onClose, onSaved }: { rid: number; doc: Doc; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState(doc.title);
  const [category, setCategory] = useState(doc.category);
  const [description, setDescription] = useState(doc.description ?? "");
  const [referenceNumber, setReferenceNumber] = useState(doc.referenceNumber ?? "");
  const [issuer, setIssuer] = useState(doc.issuer ?? "");
  const [expiresAt, setExpiresAt] = useState(doc.expiresAt ? doc.expiresAt.slice(0, 10) : "");
  const [reminderDays, setReminderDays] = useState(doc.reminderDays);
  const [tagsText, setTagsText] = useState(doc.tags.join(", "));
  const [isRequired, setIsRequired] = useState(doc.isRequired);
  const [busy, setBusy] = useState(false);

  // Grants
  const grantsQ = useQuery({
    queryKey: ["doc-grants", doc.id],
    queryFn: () => apiGet<Doc & { grants: Grant[] }>(`/restaurants/${rid}/documents/${doc.id}`),
  });
  const grants = grantsQ.data?.grants ?? [];
  const [newRole, setNewRole] = useState("manager");
  const [newPerm, setNewPerm] = useState<Permission>("view");

  async function save() {
    setBusy(true);
    try {
      await apiPatch(`/restaurants/${rid}/documents/${doc.id}`, {
        title: title.trim(), category, description: description.trim() || null,
        referenceNumber: referenceNumber.trim() || null,
        issuer: issuer.trim() || null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        reminderDays, isRequired,
        tags: tagsText.split(",").map(s => s.trim()).filter(Boolean).slice(0, 20),
      });
      toast({ title: "Document updated" });
      onSaved(); onClose();
    } catch (e) { toast({ title: "Update failed", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  }
  async function addGrant() {
    try {
      await apiPost(`/restaurants/${rid}/documents/${doc.id}/grants`, {
        principalType: "role", principalRef: newRole, permission: newPerm,
      });
      qc.invalidateQueries({ queryKey: ["doc-grants", doc.id] });
    } catch (e) { toast({ title: "Grant failed", description: (e as Error).message, variant: "destructive" }); }
  }
  async function removeGrant(id: number) {
    try {
      await apiDelete(`/restaurants/${rid}/documents/${doc.id}/grants/${id}`);
      qc.invalidateQueries({ queryKey: ["doc-grants", doc.id] });
    } catch (e) { toast({ title: "Revoke failed", description: (e as Error).message, variant: "destructive" }); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit document</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Title</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Reference number</label>
              <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">Issued by</label>
              <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium">Expires</label>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">Reminder (days)</label>
              <Input type="number" min={0} max={365} value={reminderDays} onChange={(e) => setReminderDays(Number(e.target.value) || 0)} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={isRequired} onCheckedChange={(v) => setIsRequired(!!v)} /> Required
              </label>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Tags</label>
            <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
          </div>

          {/* Grants */}
          <div className="border-t pt-3 mt-2">
            <div className="font-medium mb-2 flex items-center gap-2"><Shield className="w-4 h-4" /> Access grants</div>
            <div className="flex gap-2 items-end mb-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Role</label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Permission</label>
                <Select value={newPerm} onValueChange={(v) => setNewPerm(v as Permission)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="view">view</SelectItem>
                    <SelectItem value="download">download</SelectItem>
                    <SelectItem value="edit">edit</SelectItem>
                    <SelectItem value="delete">delete</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={addGrant} size="sm"><Plus className="w-4 h-4 mr-1" /> Grant</Button>
            </div>
            <div className="space-y-1">
              {grants.length === 0 && <div className="text-xs text-muted-foreground">No explicit grants — falls back to category defaults for the role.</div>}
              {grants.map(g => (
                <div key={g.id} className="flex items-center justify-between text-sm bg-muted/30 rounded px-2 py-1">
                  <span><Badge variant="outline">{g.principalType}</Badge> <strong>{g.principalRef}</strong> — {g.permission}</span>
                  <Button size="sm" variant="ghost" onClick={() => removeGrant(g.id)}><X className="w-4 h-4" /></Button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy} data-testid="button-save-edit">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AuditDialog({ rid, doc, onClose }: { rid: number; doc: Doc; onClose: () => void }) {
  const auditQ = useQuery({
    queryKey: ["doc-audit", doc.id],
    queryFn: () => apiGet<AuditRow[]>(`/restaurants/${rid}/documents/audit-log?documentId=${doc.id}`),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>History — {doc.title}</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-2">
          {auditQ.isLoading && <Loader2 className="w-5 h-5 animate-spin mx-auto" />}
          {auditQ.data?.length === 0 && <div className="text-sm text-muted-foreground">No history yet.</div>}
          {auditQ.data?.map(r => (
            <div key={r.id} className="flex items-start gap-2 text-sm border-b pb-2">
              <Badge variant="outline" className="capitalize">{r.action}</Badge>
              <div className="flex-1">
                <div>{r.userDisplay ?? "System"}</div>
                {r.details && <div className="text-xs text-muted-foreground break-all">{JSON.stringify(r.details)}</div>}
              </div>
              <div className="text-xs text-muted-foreground whitespace-nowrap">
                {new Date(r.createdAt).toLocaleString("en-IN")}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
