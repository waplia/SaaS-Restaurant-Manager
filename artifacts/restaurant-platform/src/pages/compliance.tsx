import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiPut, apiDelete, getApiUrl } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, FileText, Plus, Pencil, Trash2, ShieldCheck, Clock,
  CheckCircle2, XCircle, Upload, Bell, Globe, Receipt, Coins, Leaf, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = ["Dashboard", "Documents & Licenses", "Settings"] as const;
type Tab = typeof TABS[number];

const DOC_TYPES: { value: string; label: string }[] = [
  { value: "fssai", label: "FSSAI License" },
  { value: "gst", label: "GST Registration" },
  { value: "fire_noc", label: "Fire NOC" },
  { value: "shop_act", label: "Shop & Establishment Act" },
  { value: "labour", label: "Labour Compliance (PF/ESI)" },
  { value: "hygiene_audit", label: "Hygiene Audit Certificate" },
  { value: "staff_document", label: "Staff Document" },
  { value: "vendor_gst", label: "Vendor GST" },
  { value: "other", label: "Other" },
];
const DOC_TYPE_LABEL: Record<string, string> = Object.fromEntries(DOC_TYPES.map(t => [t.value, t.label]));

const COUNTRIES = [
  { code: "IN", label: "India", taxLabel: "GSTIN", currency: "INR" },
  { code: "US", label: "United States", taxLabel: "EIN", currency: "USD" },
  { code: "GB", label: "United Kingdom", taxLabel: "VAT", currency: "GBP" },
  { code: "AE", label: "United Arab Emirates", taxLabel: "TRN", currency: "AED" },
  { code: "EU", label: "European Union", taxLabel: "VAT", currency: "EUR" },
];

interface ComplianceDocument {
  id: number;
  type: string;
  title: string | null;
  documentNumber: string | null;
  issuingAuthority: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  fileUrl: string | null;
  renewalCost: string | null;
  linkedVendorId: number | null;
  linkedStaffId: number | null;
  status: string;
  notes: string | null;
  reminderDismissedUntil: string | null;
}

interface Summary {
  country: string;
  counts: { total: number; valid: number; expiringSoon: number; expired: number; missing: number };
  upcoming: ComplianceDocument[];
  expiredList: ComplianceDocument[];
  missingRequired: string[];
  requiredForCountry: string[];
}

interface ContactRow {
  id: number; userId: number; name: string | null; email: string | null; phone: string | null; role: string | null;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function daysBetween(a: Date, b: Date): number {
  return Math.ceil((a.getTime() - b.getTime()) / 86_400_000);
}

async function uploadFile(rid: number, file: File): Promise<string> {
  const presign = await apiPost<{ uploadURL: string; objectPath: string }>(
    `/restaurants/${rid}/storage/uploads/request-url`,
    { name: file.name, size: file.size, contentType: file.type || "application/octet-stream" },
  );
  const put = await fetch(presign.uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  await apiPost(`/restaurants/${rid}/storage/uploads/finalize`, { objectPath: presign.objectPath });
  return presign.objectPath;
}

function fileHref(rid: number, p: string | null): string | null {
  if (!p) return null;
  if (/^https?:\/\//.test(p)) return p;
  if (p.startsWith("/objects/")) return getApiUrl(`/restaurants/${rid}/storage${p}`);
  return p;
}

export default function CompliancePage() {
  const [tab, setTab] = useState<Tab>("Dashboard");

  return (
    <Layout>
      <PageHeader
        title="Compliance"
        subtitle="Track licenses, expiries, and global tax/tip/privacy settings."
      />
      <div className="px-6 pt-4">
        <div className="inline-flex border-b border-border gap-1">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              data-testid={`tab-${t}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="p-6">
        {tab === "Dashboard" && <DashboardTab />}
        {tab === "Documents & Licenses" && <DocumentsTab />}
        {tab === "Settings" && <SettingsTab />}
      </div>
    </Layout>
  );
}

function DashboardTab() {
  const rid = useRestaurantId();
  const { data, isLoading } = useQuery<Summary>({
    queryKey: ["compliance", "summary", rid],
    queryFn: () => apiGet<Summary>(`/restaurants/${rid}/compliance/summary`),
  });

  if (isLoading || !data) return <div className="text-muted-foreground">Loading…</div>;

  const cards = [
    { label: "Total Documents", value: data.counts.total, icon: FileText, color: "text-blue-600 bg-blue-50" },
    { label: "Valid", value: data.counts.valid, icon: CheckCircle2, color: "text-green-700 bg-green-50" },
    { label: "Expiring in 30 days", value: data.counts.expiringSoon, icon: Clock, color: "text-yellow-700 bg-yellow-50" },
    { label: "Expired", value: data.counts.expired, icon: XCircle, color: "text-red-700 bg-red-50" },
    { label: "Missing Required", value: data.counts.missing, icon: AlertTriangle, color: "text-orange-700 bg-orange-50" },
  ];

  const now = new Date();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map(c => (
          <div key={c.label} className="rounded-lg border border-border p-4 bg-card">
            <div className={cn("inline-flex items-center justify-center w-9 h-9 rounded-md", c.color)}>
              <c.icon className="w-5 h-5" />
            </div>
            <div className="mt-3 text-2xl font-semibold">{c.value}</div>
            <div className="text-xs text-muted-foreground">{c.label}</div>
          </div>
        ))}
      </div>

      {data.missingRequired.length > 0 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
          <div className="flex items-center gap-2 font-semibold text-orange-900">
            <AlertTriangle className="w-4 h-4" />
            What to do next ({data.country})
          </div>
          <ul className="mt-2 list-disc list-inside text-sm text-orange-900">
            {data.missingRequired.map(t => (
              <li key={t}>Add a {DOC_TYPE_LABEL[t] ?? t} record</li>
            ))}
          </ul>
        </div>
      )}

      <section className="rounded-lg border border-border bg-card">
        <div className="px-4 py-3 border-b border-border font-semibold flex items-center gap-2">
          <Bell className="w-4 h-4" />
          Upcoming expiries
        </div>
        {data.upcoming.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No documents expiring in the next 30 days.</div>
        ) : (
          <ul className="divide-y divide-border">
            {data.upcoming.map(d => {
              const dDays = d.expiryDate ? daysBetween(new Date(d.expiryDate), now) : 0;
              return (
                <li key={d.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{d.title ?? DOC_TYPE_LABEL[d.type] ?? d.type}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {DOC_TYPE_LABEL[d.type] ?? d.type}{d.documentNumber ? ` · ${d.documentNumber}` : ""}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div className={cn(dDays <= 7 ? "text-red-600 font-semibold" : "text-yellow-700")}>
                      {dDays > 0 ? `In ${dDays} day${dDays === 1 ? "" : "s"}` : dDays === 0 ? "Today" : `Overdue ${Math.abs(dDays)}d`}
                    </div>
                    <div className="text-xs text-muted-foreground">{fmtDate(d.expiryDate)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {data.expiredList.length > 0 && (
        <section className="rounded-lg border border-red-200 bg-red-50/50">
          <div className="px-4 py-3 border-b border-red-200 font-semibold flex items-center gap-2 text-red-800">
            <XCircle className="w-4 h-4" />
            Expired documents
          </div>
          <ul className="divide-y divide-red-100">
            {data.expiredList.map(d => (
              <li key={d.id} className="px-4 py-3 text-sm">
                <span className="font-medium">{d.title ?? DOC_TYPE_LABEL[d.type] ?? d.type}</span>
                <span className="text-muted-foreground"> · {DOC_TYPE_LABEL[d.type] ?? d.type}</span>
                <span className="text-red-700"> · expired {fmtDate(d.expiryDate)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

interface DocFormState {
  type: string;
  title: string;
  documentNumber: string;
  issuingAuthority: string;
  issueDate: string;
  expiryDate: string;
  fileUrl: string;
  renewalCost: string;
  notes: string;
}
const EMPTY_FORM: DocFormState = {
  type: "fssai", title: "", documentNumber: "", issuingAuthority: "",
  issueDate: "", expiryDate: "", fileUrl: "", renewalCost: "", notes: "",
};

function DocumentsTab() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: docs = [] } = useQuery<ComplianceDocument[]>({
    queryKey: ["compliance", "docs", rid],
    queryFn: () => apiGet<ComplianceDocument[]>(`/restaurants/${rid}/compliance/documents`),
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ComplianceDocument | null>(null);
  const [form, setForm] = useState<DocFormState>(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState<string>("");

  const filtered = useMemo(() => filter ? docs.filter(d => d.type === filter) : docs, [docs, filter]);

  function startCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }
  function startEdit(d: ComplianceDocument) {
    setEditing(d);
    setForm({
      type: d.type,
      title: d.title ?? "",
      documentNumber: d.documentNumber ?? "",
      issuingAuthority: d.issuingAuthority ?? "",
      issueDate: d.issueDate ? d.issueDate.slice(0, 10) : "",
      expiryDate: d.expiryDate ? d.expiryDate.slice(0, 10) : "",
      fileUrl: d.fileUrl ?? "",
      renewalCost: d.renewalCost ?? "",
      notes: d.notes ?? "",
    });
    setOpen(true);
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        type: form.type,
        title: form.title || null,
        documentNumber: form.documentNumber || null,
        issuingAuthority: form.issuingAuthority || null,
        issueDate: form.issueDate || null,
        expiryDate: form.expiryDate || null,
        fileUrl: form.fileUrl || null,
        renewalCost: form.renewalCost || null,
        notes: form.notes || null,
      };
      if (editing) {
        return apiPatch(`/restaurants/${rid}/compliance/documents/${editing.id}`, payload);
      }
      return apiPost(`/restaurants/${rid}/compliance/documents`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compliance", "docs", rid] });
      qc.invalidateQueries({ queryKey: ["compliance", "summary", rid] });
      setOpen(false);
      toast({ title: editing ? "Document updated" : "Document added" });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${rid}/compliance/documents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compliance", "docs", rid] });
      qc.invalidateQueries({ queryKey: ["compliance", "summary", rid] });
      toast({ title: "Deleted" });
    },
  });

  async function onPickFile(file: File) {
    setUploading(true);
    try {
      const path = await uploadFile(rid, file);
      setForm(f => ({ ...f, fileUrl: path }));
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Filter:</Label>
          <Select value={filter || "all"} onValueChange={(v) => setFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-56" data-testid="select-filter-type">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {DOC_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={startCreate} data-testid="btn-add-doc"><Plus className="w-4 h-4 mr-1" /> Add document</Button>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Type</th>
              <th className="text-left px-4 py-2 font-medium">Title / Number</th>
              <th className="text-left px-4 py-2 font-medium">Authority</th>
              <th className="text-left px-4 py-2 font-medium">Expiry</th>
              <th className="text-left px-4 py-2 font-medium">File</th>
              <th className="text-right px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No documents yet.</td></tr>
            )}
            {filtered.map(d => {
              const link = fileHref(rid, d.fileUrl);
              const expired = d.expiryDate ? new Date(d.expiryDate) < new Date() : false;
              return (
                <tr key={d.id} data-testid={`row-doc-${d.id}`}>
                  <td className="px-4 py-2">{DOC_TYPE_LABEL[d.type] ?? d.type}</td>
                  <td className="px-4 py-2">
                    <div className="font-medium">{d.title ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{d.documentNumber ?? ""}</div>
                  </td>
                  <td className="px-4 py-2">{d.issuingAuthority ?? "—"}</td>
                  <td className={cn("px-4 py-2", expired && "text-red-600 font-medium")}>{fmtDate(d.expiryDate)}</td>
                  <td className="px-4 py-2">
                    {link ? <a href={link} target="_blank" rel="noreferrer" className="text-primary underline">View</a> : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(d)} data-testid={`btn-edit-${d.id}`}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => { if (confirm("Delete this document?")) delMut.mutate(d.id); }} data-testid={`btn-del-${d.id}`}><Trash2 className="w-4 h-4 text-red-600" /></Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit document" : "Add document"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Main FSSAI License" />
            </div>
            <div>
              <Label>Document number / GSTIN</Label>
              <Input value={form.documentNumber} onChange={e => setForm(f => ({ ...f, documentNumber: e.target.value }))} />
            </div>
            <div>
              <Label>Issuing authority</Label>
              <Input value={form.issuingAuthority} onChange={e => setForm(f => ({ ...f, issuingAuthority: e.target.value }))} />
            </div>
            <div>
              <Label>Renewal cost</Label>
              <Input type="number" value={form.renewalCost} onChange={e => setForm(f => ({ ...f, renewalCost: e.target.value }))} />
            </div>
            <div>
              <Label>Issue date</Label>
              <Input type="date" value={form.issueDate} onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))} />
            </div>
            <div>
              <Label>Expiry date</Label>
              <Input type="date" value={form.expiryDate} onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Attached file</Label>
              <div className="flex items-center gap-2">
                <Input type="file" accept=".pdf,image/*"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); }}
                  disabled={uploading}
                  data-testid="input-file"
                />
                {form.fileUrl && (
                  <a className="text-xs text-primary underline" href={fileHref(rid, form.fileUrl) ?? "#"} target="_blank" rel="noreferrer">View current</a>
                )}
              </div>
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || uploading} data-testid="btn-save-doc">
              {editing ? "Save changes" : "Add document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface AllSettings {
  compliance_country?: { country?: string };
  compliance_tax?: {
    country?: string;
    inclusive?: boolean;
    taxIdLabel?: string;
    components?: { name: string; rate: string }[];
  };
  compliance_tip?: {
    enabled?: boolean;
    suggestedPercents?: number[];
    recipient?: "server" | "pool";
    taxable?: boolean;
  };
  compliance_service_charge?: {
    enabled?: boolean;
    type?: "percent" | "fixed";
    amount?: string;
    label?: string;
    appliedBeforeTax?: boolean;
    taxable?: boolean;
  };
  compliance_allergens?: {
    list?: string[];
    requireOnEveryItem?: boolean;
    showOnBills?: boolean;
  };
  compliance_privacy?: {
    consentText?: string;
    retentionDays?: number;
    allowExportRequests?: boolean;
    allowDeleteRequests?: boolean;
    cookieConsentEnabled?: boolean;
  };
}

const DEFAULT_ALLERGENS = ["gluten", "dairy", "nuts", "eggs", "soy", "fish", "shellfish", "sesame"];

function SettingsTab() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<AllSettings>({
    queryKey: ["compliance", "settings", rid],
    queryFn: () => apiGet<AllSettings>(`/restaurants/${rid}/compliance/settings`),
  });

  const saveMut = useMutation({
    mutationFn: async ({ section, payload }: { section: string; payload: unknown }) =>
      apiPut(`/restaurants/${rid}/compliance/settings/${section}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compliance", "settings", rid] });
      toast({ title: "Settings saved" });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading || !data) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <CountrySection data={data} onSave={(p) => saveMut.mutate({ section: "compliance_country", payload: p })} />
      <TaxSection data={data} onSave={(p) => saveMut.mutate({ section: "compliance_tax", payload: p })} />
      <TipSection data={data} onSave={(p) => saveMut.mutate({ section: "compliance_tip", payload: p })} />
      <ServiceChargeSection data={data} onSave={(p) => saveMut.mutate({ section: "compliance_service_charge", payload: p })} />
      <AllergenSection data={data} onSave={(p) => saveMut.mutate({ section: "compliance_allergens", payload: p })} />
      <PrivacySection data={data} onSave={(p) => saveMut.mutate({ section: "compliance_privacy", payload: p })} />
      <ContactsSection />
    </div>
  );
}

function SectionCard({ title, icon: Icon, children, footer }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="px-4 py-3 border-b border-border font-semibold flex items-center gap-2">
        <Icon className="w-4 h-4" /> {title}
      </div>
      <div className="p-4 space-y-3">{children}</div>
      {footer && <div className="px-4 py-3 border-t border-border bg-muted/20 flex justify-end">{footer}</div>}
    </section>
  );
}

function CountrySection({ data, onSave }: { data: AllSettings; onSave: (p: unknown) => void }) {
  const [country, setCountry] = useState(data.compliance_country?.country ?? "IN");
  return (
    <SectionCard title="Country" icon={Globe} footer={<Button onClick={() => onSave({ country })} data-testid="btn-save-country">Save</Button>}>
      <div className="max-w-md">
        <Label>Operating country</Label>
        <Select value={country} onValueChange={setCountry}>
          <SelectTrigger data-testid="select-country"><SelectValue /></SelectTrigger>
          <SelectContent>
            {COUNTRIES.map(c => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">Drives required-document checklist on the dashboard and default tax labels.</p>
      </div>
    </SectionCard>
  );
}

function TaxSection({ data, onSave }: { data: AllSettings; onSave: (p: unknown) => void }) {
  const initial = data.compliance_tax ?? {};
  const [inclusive, setInclusive] = useState<boolean>(initial.inclusive ?? false);
  const [taxIdLabel, setTaxIdLabel] = useState<string>(initial.taxIdLabel ?? "GSTIN");
  const [components, setComponents] = useState<{ name: string; rate: string }[]>(
    initial.components ?? [{ name: "CGST", rate: "2.5" }, { name: "SGST", rate: "2.5" }],
  );
  function update(i: number, patch: Partial<{ name: string; rate: string }>) {
    setComponents(c => c.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  }
  return (
    <SectionCard title="Taxes" icon={Receipt} footer={
      <Button onClick={() => onSave({ inclusive, taxIdLabel, components })} data-testid="btn-save-tax">Save</Button>
    }>
      <div className="grid grid-cols-2 gap-3 max-w-2xl">
        <div>
          <Label>Tax ID label</Label>
          <Input value={taxIdLabel} onChange={e => setTaxIdLabel(e.target.value)} placeholder="GSTIN / VAT / EIN" />
        </div>
        <div className="flex items-center gap-3 mt-6">
          <Switch checked={inclusive} onCheckedChange={setInclusive} id="tax-inclusive" />
          <Label htmlFor="tax-inclusive">Prices include tax</Label>
        </div>
      </div>
      <div>
        <Label>Tax components</Label>
        <div className="space-y-2 mt-1">
          {components.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="max-w-[200px]" value={c.name} onChange={e => update(i, { name: e.target.value })} placeholder="Name (e.g. CGST)" />
              <Input className="max-w-[120px]" type="number" step="0.01" value={c.rate} onChange={e => update(i, { rate: e.target.value })} placeholder="Rate %" />
              <Button variant="ghost" size="sm" onClick={() => setComponents(arr => arr.filter((_, idx) => idx !== i))}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setComponents(arr => [...arr, { name: "", rate: "0" }])}>
            <Plus className="w-4 h-4 mr-1" /> Add component
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

function TipSection({ data, onSave }: { data: AllSettings; onSave: (p: unknown) => void }) {
  const initial = data.compliance_tip ?? {};
  const [enabled, setEnabled] = useState(initial.enabled ?? false);
  const [percents, setPercents] = useState<string>((initial.suggestedPercents ?? [5, 10, 15]).join(","));
  const [recipient, setRecipient] = useState<"server" | "pool">(initial.recipient ?? "server");
  const [taxable, setTaxable] = useState(initial.taxable ?? false);
  return (
    <SectionCard title="Tips" icon={Coins} footer={
      <Button onClick={() => onSave({
        enabled,
        suggestedPercents: percents.split(",").map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n >= 0),
        recipient, taxable,
      })} data-testid="btn-save-tip">Save</Button>
    }>
      <div className="flex items-center gap-3"><Switch checked={enabled} onCheckedChange={setEnabled} id="tip-enabled" /><Label htmlFor="tip-enabled">Enable tips</Label></div>
      <div className="grid grid-cols-2 gap-3 max-w-2xl">
        <div>
          <Label>Suggested percentages (comma-separated)</Label>
          <Input value={percents} onChange={e => setPercents(e.target.value)} placeholder="5, 10, 15" />
        </div>
        <div>
          <Label>Recipient</Label>
          <Select value={recipient} onValueChange={(v) => setRecipient(v as "server" | "pool")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="server">Server who took the order</SelectItem>
              <SelectItem value="pool">Tip pool (split across staff)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-3"><Switch checked={taxable} onCheckedChange={setTaxable} id="tip-taxable" /><Label htmlFor="tip-taxable">Tips are taxable</Label></div>
    </SectionCard>
  );
}

function ServiceChargeSection({ data, onSave }: { data: AllSettings; onSave: (p: unknown) => void }) {
  const initial = data.compliance_service_charge ?? {};
  const [enabled, setEnabled] = useState(initial.enabled ?? false);
  const [type, setType] = useState<"percent" | "fixed">(initial.type ?? "percent");
  const [amount, setAmount] = useState(initial.amount ?? "10");
  const [label, setLabel] = useState(initial.label ?? "Service Charge");
  const [appliedBeforeTax, setAppliedBeforeTax] = useState(initial.appliedBeforeTax ?? true);
  const [taxable, setTaxable] = useState(initial.taxable ?? false);
  return (
    <SectionCard title="Service charge" icon={Receipt} footer={
      <Button onClick={() => onSave({ enabled, type, amount, label, appliedBeforeTax, taxable })} data-testid="btn-save-svc">Save</Button>
    }>
      <div className="flex items-center gap-3"><Switch checked={enabled} onCheckedChange={setEnabled} id="svc-enabled" /><Label htmlFor="svc-enabled">Enable service charge</Label></div>
      <div className="grid grid-cols-2 gap-3 max-w-2xl">
        <div>
          <Label>Label on bill</Label>
          <Input value={label} onChange={e => setLabel(e.target.value)} />
        </div>
        <div>
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as "percent" | "fixed")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="percent">Percentage</SelectItem>
              <SelectItem value="fixed">Fixed amount</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{type === "percent" ? "Percentage (%)" : "Amount"}</Label>
          <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
        </div>
        <div className="flex items-center gap-3 mt-6">
          <Switch checked={appliedBeforeTax} onCheckedChange={setAppliedBeforeTax} id="svc-before-tax" />
          <Label htmlFor="svc-before-tax">Apply before tax</Label>
        </div>
      </div>
      <div className="flex items-center gap-3"><Switch checked={taxable} onCheckedChange={setTaxable} id="svc-taxable" /><Label htmlFor="svc-taxable">Service charge is taxable</Label></div>
    </SectionCard>
  );
}

function AllergenSection({ data, onSave }: { data: AllSettings; onSave: (p: unknown) => void }) {
  const initial = data.compliance_allergens ?? {};
  const [list, setList] = useState<string>((initial.list ?? DEFAULT_ALLERGENS).join(", "));
  const [requireOnEveryItem, setRequireOnEveryItem] = useState(initial.requireOnEveryItem ?? false);
  const [showOnBills, setShowOnBills] = useState(initial.showOnBills ?? true);
  return (
    <SectionCard title="Allergen declaration" icon={Leaf} footer={
      <Button onClick={() => onSave({
        list: list.split(",").map(s => s.trim()).filter(Boolean),
        requireOnEveryItem, showOnBills,
      })} data-testid="btn-save-allergen">Save</Button>
    }>
      <div>
        <Label>Master allergen list (comma-separated)</Label>
        <Textarea rows={2} value={list} onChange={e => setList(e.target.value)} />
      </div>
      <div className="flex items-center gap-3"><Switch checked={requireOnEveryItem} onCheckedChange={setRequireOnEveryItem} id="allg-req" /><Label htmlFor="allg-req">Require allergen tags on every menu item</Label></div>
      <div className="flex items-center gap-3"><Switch checked={showOnBills} onCheckedChange={setShowOnBills} id="allg-show" /><Label htmlFor="allg-show">Show allergen badges on bills/KOTs</Label></div>
    </SectionCard>
  );
}

function PrivacySection({ data, onSave }: { data: AllSettings; onSave: (p: unknown) => void }) {
  const initial = data.compliance_privacy ?? {};
  const [consentText, setConsentText] = useState(initial.consentText ?? "I agree to the processing of my information for order fulfilment, in line with the privacy policy.");
  const [retentionDays, setRetentionDays] = useState<number>(initial.retentionDays ?? 365);
  const [allowExportRequests, setAllowExportRequests] = useState(initial.allowExportRequests ?? true);
  const [allowDeleteRequests, setAllowDeleteRequests] = useState(initial.allowDeleteRequests ?? true);
  const [cookieConsentEnabled, setCookieConsentEnabled] = useState(initial.cookieConsentEnabled ?? false);
  return (
    <SectionCard title="Data privacy & consent" icon={Lock} footer={
      <Button onClick={() => onSave({
        consentText, retentionDays: Number(retentionDays) || 0,
        allowExportRequests, allowDeleteRequests, cookieConsentEnabled,
      })} data-testid="btn-save-privacy">Save</Button>
    }>
      <div>
        <Label>Consent text shown at signup/checkout</Label>
        <Textarea rows={3} value={consentText} onChange={e => setConsentText(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <div>
          <Label>Customer data retention (days)</Label>
          <Input type="number" value={retentionDays} onChange={e => setRetentionDays(Number(e.target.value))} />
        </div>
      </div>
      <div className="flex items-center gap-3"><Switch checked={allowExportRequests} onCheckedChange={setAllowExportRequests} id="priv-export" /><Label htmlFor="priv-export">Allow customer data export requests</Label></div>
      <div className="flex items-center gap-3"><Switch checked={allowDeleteRequests} onCheckedChange={setAllowDeleteRequests} id="priv-del" /><Label htmlFor="priv-del">Allow customer data delete requests</Label></div>
      <div className="flex items-center gap-3"><Switch checked={cookieConsentEnabled} onCheckedChange={setCookieConsentEnabled} id="priv-cookie" /><Label htmlFor="priv-cookie">Show cookie/marketing consent banner</Label></div>
    </SectionCard>
  );
}

function ContactsSection() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: contacts = [] } = useQuery<ContactRow[]>({
    queryKey: ["compliance", "contacts", rid],
    queryFn: () => apiGet<ContactRow[]>(`/restaurants/${rid}/compliance/contacts`),
  });
  const [userId, setUserId] = useState("");
  const addMut = useMutation({
    mutationFn: () => apiPost(`/restaurants/${rid}/compliance/contacts`, { userId: Number(userId) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compliance", "contacts", rid] });
      setUserId("");
      toast({ title: "Contact added" });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });
  const delMut = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${rid}/compliance/contacts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["compliance", "contacts", rid] }),
  });
  return (
    <SectionCard title="Compliance contacts" icon={ShieldCheck}>
      <p className="text-xs text-muted-foreground">These users receive expiry reminders alongside the restaurant owner.</p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {contacts.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No additional contacts. Owners always receive reminders.</li>}
        {contacts.map(c => (
          <li key={c.id} className="px-3 py-2 flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">{c.name ?? c.email ?? `User #${c.userId}`}</div>
              <div className="text-xs text-muted-foreground">{c.email} · {c.role}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => delMut.mutate(c.id)}><Trash2 className="w-4 h-4 text-red-600" /></Button>
          </li>
        ))}
      </ul>
      <div className="flex items-end gap-2 max-w-md">
        <div className="flex-1">
          <Label>Add by user ID</Label>
          <Input value={userId} onChange={e => setUserId(e.target.value)} placeholder="e.g. 12" />
        </div>
        <Button onClick={() => addMut.mutate()} disabled={!userId || addMut.isPending}><Plus className="w-4 h-4 mr-1" /> Add</Button>
      </div>
    </SectionCard>
  );
}
