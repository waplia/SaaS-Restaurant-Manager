import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiPut, apiDelete, getApiUrl } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useStaff } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, FileText, Plus, Pencil, Trash2, ShieldCheck, HeartPulse,
  Coins, Globe, Receipt, ClipboardList, Download, Bell, History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { StaffMember } from "@/lib/types";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: ShieldCheck },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "benefits", label: "Benefits", icon: HeartPulse },
  { id: "policies", label: "Policies", icon: ClipboardList },
  { id: "wages", label: "Wage Rules", icon: Coins },
  { id: "tax", label: "Tax Forms", icon: Receipt },
  { id: "breaches", label: "Breaches", icon: AlertTriangle },
  { id: "audit", label: "Audit Log", icon: History },
] as const;
type Tab = typeof TABS[number]["id"];

const DOC_TYPES = [
  { value: "id_proof", label: "ID Proof" },
  { value: "address_proof", label: "Address Proof" },
  { value: "work_permit", label: "Work Permit" },
  { value: "visa", label: "Visa" },
  { value: "food_handler_cert", label: "Food Handler Certificate" },
  { value: "alcohol_service_cert", label: "Alcohol Service Certificate" },
  { value: "drivers_license", label: "Driver's License" },
  { value: "police_verification", label: "Police Verification" },
  { value: "medical_fitness", label: "Medical Fitness" },
  { value: "contract", label: "Employment Contract" },
  { value: "nda", label: "NDA" },
  { value: "tax_form", label: "Tax Form" },
  { value: "other", label: "Other" },
];
const DOC_TYPE_LABEL = Object.fromEntries(DOC_TYPES.map(d => [d.value, d.label]));

const BENEFIT_TYPES = [
  { value: "health_insurance", label: "Health Insurance" },
  { value: "dental_insurance", label: "Dental Insurance" },
  { value: "vision_insurance", label: "Vision Insurance" },
  { value: "retirement_401k", label: "Retirement / 401(k)" },
  { value: "provident_fund", label: "Provident Fund" },
  { value: "esi", label: "ESI" },
  { value: "life_insurance", label: "Life Insurance" },
  { value: "meal_allowance", label: "Meal Allowance" },
  { value: "transport_allowance", label: "Transport Allowance" },
  { value: "education_allowance", label: "Education Allowance" },
  { value: "other", label: "Other" },
];
const BENEFIT_TYPE_LABEL = Object.fromEntries(BENEFIT_TYPES.map(b => [b.value, b.label]));

interface HrDoc {
  id: number;
  staffId: number;
  docType: string;
  label: string;
  documentNumber: string | null;
  fileUrl: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  reminderDays: number;
  status: string;
  notes: string | null;
  reminderDismissedUntil: string | null;
}

interface HrBenefit {
  id: number;
  staffId: number;
  benefitType: string;
  planName: string | null;
  provider: string | null;
  policyNumber: string | null;
  monthlyCost: string;
  employerContribution: string;
  employeeContribution: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  notes: string | null;
}

interface HrPolicy {
  id: number;
  restaurantId: number;
  branchId: number | null;
  country: string;
  region: string | null;
  dailyOvertimeHours: string;
  weeklyOvertimeHours: string;
  maxShiftHours: string;
  breakMinutes: number;
  breakAfterHours: string;
  minHourlyWage: string;
  minRestBetweenShiftsHours: string;
  annualLeaveDays: number;
  extra: Record<string, unknown>;
}

interface Branch { id: number; name: string; isMain: boolean }
interface WageRule { country: string; region: string | null; currency: string; minHourly: number; label: string }
interface Summary {
  docs: { total: number; expired: number; expiringSoon: number; valid: number };
  benefits: { active: number };
  staff: { active: number };
}
interface Breach {
  kind: string;
  severity: "warning" | "violation";
  userId: number;
  userName: string | null;
  date: string | null;
  detail: string;
  attendanceId?: number;
}
interface AuditRow {
  id: number;
  module: string;
  action: string;
  entity: string;
  entityId: number | null;
  userDisplay: string | null;
  role: string | null;
  details: string | null;
  createdAt: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.round(ms / 86_400_000);
}

export default function HrCompliancePage() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const rid = useRestaurantId();

  const { data: summary } = useQuery<Summary>({
    queryKey: ["hr-summary", rid],
    queryFn: () => apiGet(`/restaurants/${rid}/hr-compliance/summary`),
  });

  return (
    <Layout>
      <PageHeader
        title="HR Compliance & Benefits"
        subtitle={
          summary
            ? `${summary.staff.active} staff · ${summary.docs.total} documents · ${summary.benefits.active} active benefits`
            : "Employee documents, benefits, wage rules, and HR policy breaches"
        }
      />

      <div className="px-6 pt-4 border-b border-border overflow-x-auto">
        <div className="flex gap-0 min-w-max">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              data-testid={`hr-tab-${id}`}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
                tab === id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {tab === "dashboard" && <DashboardTab summary={summary} />}
        {tab === "documents" && <DocumentsTab />}
        {tab === "benefits" && <BenefitsTab />}
        {tab === "policies" && <PoliciesTab />}
        {tab === "wages" && <WageRulesTab />}
        {tab === "tax" && <TaxFormsTab />}
        {tab === "breaches" && <BreachesTab />}
        {tab === "audit" && <AuditTab />}
      </div>
    </Layout>
  );
}

// ─────────────────────────── Dashboard ───────────────────────────

function DashboardTab({ summary }: { summary?: Summary }) {
  const rid = useRestaurantId();
  const { data: docs = [] } = useQuery<HrDoc[]>({
    queryKey: ["hr-docs", rid],
    queryFn: () => apiGet(`/restaurants/${rid}/hr-compliance/documents`),
  });
  const upcoming = useMemo(() => {
    const now = Date.now();
    return docs
      .filter(d => d.expiryDate)
      .map(d => ({ ...d, days: Math.round((new Date(d.expiryDate!).getTime() - now) / 86_400_000) }))
      .filter(d => d.days <= 60)
      .sort((a, b) => a.days - b.days)
      .slice(0, 10);
  }, [docs]);

  const card = (label: string, value: string | number, tone: string, Icon: typeof FileText) => (
    <div className={cn("p-4 rounded-lg border", tone)}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 opacity-70" />
        <span className="text-sm">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {card("Active Staff", summary?.staff.active ?? "—", "bg-blue-50 border-blue-200 text-blue-800", ShieldCheck)}
        {card("Documents", summary?.docs.total ?? "—", "bg-gray-50 border-gray-200 text-gray-800", FileText)}
        {card("Expiring (30d)", summary?.docs.expiringSoon ?? 0, "bg-amber-50 border-amber-200 text-amber-800", Bell)}
        {card("Expired", summary?.docs.expired ?? 0, "bg-red-50 border-red-200 text-red-800", AlertTriangle)}
      </div>

      <div className="bg-card border rounded-lg p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Bell className="w-4 h-4" /> Upcoming & overdue document renewals
        </h3>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents expiring within 60 days.</p>
        ) : (
          <div className="space-y-2">
            {upcoming.map(d => (
              <div
                key={d.id}
                className={cn(
                  "flex items-center justify-between p-2 rounded border text-sm",
                  d.days < 0 ? "bg-red-50 border-red-200" : d.days <= 14 ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200",
                )}
                data-testid={`hr-upcoming-${d.id}`}
              >
                <div className="flex-1">
                  <div className="font-medium">{d.label}</div>
                  <div className="text-xs text-muted-foreground">{DOC_TYPE_LABEL[d.docType] ?? d.docType}</div>
                </div>
                <div className="text-right text-xs">
                  <div>{fmtDate(d.expiryDate)}</div>
                  <div className={d.days < 0 ? "text-red-600 font-semibold" : "text-amber-700"}>
                    {d.days < 0 ? `Expired ${Math.abs(d.days)}d ago` : `In ${d.days}d`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── Documents ───────────────────────────

function DocumentsTab() {
  const rid = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const allStaff = useStaff().data ?? [];
  const [editing, setEditing] = useState<HrDoc | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const { data: docs = [] } = useQuery<HrDoc[]>({
    queryKey: ["hr-docs", rid],
    queryFn: () => apiGet(`/restaurants/${rid}/hr-compliance/documents`),
  });

  const staffById = useMemo(() => {
    const m = new Map<number, StaffMember>();
    for (const s of allStaff) if (s.staffId) m.set(s.staffId, s);
    return m;
  }, [allStaff]);

  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${rid}/hr-compliance/documents/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hr-docs", rid] }); qc.invalidateQueries({ queryKey: ["hr-summary", rid] }); toast({ title: "Document deleted" }); },
  });

  const dismiss = useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${rid}/hr-compliance/documents/${id}/dismiss`, { days: 14 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hr-docs", rid] }); toast({ title: "Reminder snoozed 14 days" }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAdd(true)} data-testid="hr-doc-add">
          <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Document
        </Button>
      </div>

      <div className="bg-card border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Employee</th>
              <th className="px-3 py-2 text-left">Document</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Issued</th>
              <th className="px-3 py-2 text-left">Expires</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No documents on file. Add one to start tracking expiries.</td></tr>
            )}
            {docs.map(d => {
              const days = daysUntil(d.expiryDate);
              const member = staffById.get(d.staffId);
              const statusBadge = days == null
                ? <span className="text-muted-foreground">No expiry</span>
                : days < 0
                  ? <span className="text-red-600 font-semibold">Expired {Math.abs(days)}d ago</span>
                  : days <= 30
                    ? <span className="text-amber-700">Renew in {days}d</span>
                    : <span className="text-green-700">Valid ({days}d)</span>;
              return (
                <tr key={d.id} className="border-t" data-testid={`hr-doc-row-${d.id}`}>
                  <td className="px-3 py-2">{member?.name ?? `Staff #${d.staffId}`}</td>
                  <td className="px-3 py-2 font-medium">{d.label}</td>
                  <td className="px-3 py-2">{DOC_TYPE_LABEL[d.docType] ?? d.docType}</td>
                  <td className="px-3 py-2">{fmtDate(d.issueDate)}</td>
                  <td className="px-3 py-2">{fmtDate(d.expiryDate)}</td>
                  <td className="px-3 py-2">{statusBadge}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {d.expiryDate && (
                      <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(d.id)} title="Snooze reminder">
                        <Bell className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(d)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { if (confirm("Delete document?")) del.mutate(d.id); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(showAdd || editing) && (
        <DocDialog
          doc={editing}
          staff={allStaff}
          onClose={() => { setShowAdd(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function DocDialog({ doc, staff, onClose }: { doc: HrDoc | null; staff: StaffMember[]; onClose: () => void }) {
  const rid = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    staffId: doc?.staffId ?? (staff.find(s => s.staffId)?.staffId ?? 0),
    docType: doc?.docType ?? "id_proof",
    label: doc?.label ?? "",
    documentNumber: doc?.documentNumber ?? "",
    fileUrl: doc?.fileUrl ?? "",
    issueDate: doc?.issueDate?.slice(0, 10) ?? "",
    expiryDate: doc?.expiryDate?.slice(0, 10) ?? "",
    reminderDays: doc?.reminderDays ?? 30,
    notes: doc?.notes ?? "",
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        staffId: Number(form.staffId),
        docType: form.docType,
        label: form.label.trim(),
        documentNumber: form.documentNumber || null,
        fileUrl: form.fileUrl || null,
        issueDate: form.issueDate ? new Date(form.issueDate).toISOString() : null,
        expiryDate: form.expiryDate ? new Date(form.expiryDate).toISOString() : null,
        reminderDays: Number(form.reminderDays),
        notes: form.notes || null,
      };
      if (doc) return apiPatch(`/restaurants/${rid}/hr-compliance/documents/${doc.id}`, body);
      return apiPost(`/restaurants/${rid}/hr-compliance/documents`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-docs", rid] });
      qc.invalidateQueries({ queryKey: ["hr-summary", rid] });
      toast({ title: doc ? "Document updated" : "Document added" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{doc ? "Edit Document" : "Add Document"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Employee</Label>
            <Select value={String(form.staffId)} onValueChange={v => setForm({ ...form, staffId: Number(v) })}>
              <SelectTrigger data-testid="hr-doc-staff"><SelectValue /></SelectTrigger>
              <SelectContent>
                {staff.filter(s => s.staffId).map(s => (
                  <SelectItem key={s.id} value={String(s.staffId!)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Type</Label>
            <Select value={form.docType} onValueChange={v => setForm({ ...form, docType: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Label</Label>
            <Input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="e.g. Aadhaar Card" data-testid="hr-doc-label" />
          </div>
          <div>
            <Label>Document Number</Label>
            <Input value={form.documentNumber} onChange={e => setForm({ ...form, documentNumber: e.target.value })} />
          </div>
          <div>
            <Label>File URL (optional)</Label>
            <Input value={form.fileUrl} onChange={e => setForm({ ...form, fileUrl: e.target.value })} placeholder="/objects/..." />
          </div>
          <div>
            <Label>Issued</Label>
            <Input type="date" value={form.issueDate} onChange={e => setForm({ ...form, issueDate: e.target.value })} />
          </div>
          <div>
            <Label>Expires</Label>
            <Input type="date" value={form.expiryDate} onChange={e => setForm({ ...form, expiryDate: e.target.value })} data-testid="hr-doc-expiry" />
          </div>
          <div>
            <Label>Remind (days before)</Label>
            <Input type="number" min={0} max={365} value={form.reminderDays} onChange={e => setForm({ ...form, reminderDays: Number(e.target.value) })} />
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !form.label.trim() || !form.staffId} data-testid="hr-doc-save">
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── Benefits ───────────────────────────

function BenefitsTab() {
  const rid = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const allStaff = useStaff().data ?? [];
  const [editing, setEditing] = useState<HrBenefit | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const { data: benefits = [] } = useQuery<HrBenefit[]>({
    queryKey: ["hr-benefits", rid],
    queryFn: () => apiGet(`/restaurants/${rid}/hr-compliance/benefits`),
  });

  const staffById = useMemo(() => {
    const m = new Map<number, StaffMember>();
    for (const s of allStaff) if (s.staffId) m.set(s.staffId, s);
    return m;
  }, [allStaff]);

  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${rid}/hr-compliance/benefits/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hr-benefits", rid] }); qc.invalidateQueries({ queryKey: ["hr-summary", rid] }); toast({ title: "Benefit removed" }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAdd(true)} data-testid="hr-benefit-add"><Plus className="w-3.5 h-3.5 mr-1.5" />Add Benefit</Button>
      </div>

      <div className="bg-card border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Employee</th>
              <th className="px-3 py-2 text-left">Benefit</th>
              <th className="px-3 py-2 text-left">Plan</th>
              <th className="px-3 py-2 text-left">Provider</th>
              <th className="px-3 py-2 text-right">Monthly</th>
              <th className="px-3 py-2 text-right">Employer</th>
              <th className="px-3 py-2 text-right">Employee</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {benefits.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">No benefits enrolled yet.</td></tr>
            )}
            {benefits.map(b => (
              <tr key={b.id} className="border-t" data-testid={`hr-benefit-row-${b.id}`}>
                <td className="px-3 py-2">{staffById.get(b.staffId)?.name ?? `Staff #${b.staffId}`}</td>
                <td className="px-3 py-2">{BENEFIT_TYPE_LABEL[b.benefitType] ?? b.benefitType}</td>
                <td className="px-3 py-2">{b.planName ?? "—"}</td>
                <td className="px-3 py-2">{b.provider ?? "—"}</td>
                <td className="px-3 py-2 text-right">{Number(b.monthlyCost).toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{Number(b.employerContribution).toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{Number(b.employeeContribution).toFixed(2)}</td>
                <td className="px-3 py-2">{b.status}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(b)}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => { if (confirm("Remove benefit?")) del.mutate(b.id); }}><Trash2 className="w-3.5 h-3.5" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(showAdd || editing) && (
        <BenefitDialog benefit={editing} staff={allStaff} onClose={() => { setShowAdd(false); setEditing(null); }} />
      )}
    </div>
  );
}

function BenefitDialog({ benefit, staff, onClose }: { benefit: HrBenefit | null; staff: StaffMember[]; onClose: () => void }) {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    staffId: benefit?.staffId ?? (staff.find(s => s.staffId)?.staffId ?? 0),
    benefitType: benefit?.benefitType ?? "health_insurance",
    planName: benefit?.planName ?? "",
    provider: benefit?.provider ?? "",
    policyNumber: benefit?.policyNumber ?? "",
    monthlyCost: benefit?.monthlyCost ?? "0",
    employerContribution: benefit?.employerContribution ?? "0",
    employeeContribution: benefit?.employeeContribution ?? "0",
    startDate: benefit?.startDate?.slice(0, 10) ?? "",
    endDate: benefit?.endDate?.slice(0, 10) ?? "",
    status: benefit?.status ?? "active",
    notes: benefit?.notes ?? "",
  });
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        ...form,
        staffId: Number(form.staffId),
        startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
        endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
      };
      if (benefit) return apiPatch(`/restaurants/${rid}/hr-compliance/benefits/${benefit.id}`, body);
      return apiPost(`/restaurants/${rid}/hr-compliance/benefits`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-benefits", rid] });
      qc.invalidateQueries({ queryKey: ["hr-summary", rid] });
      toast({ title: benefit ? "Benefit updated" : "Benefit added" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{benefit ? "Edit Benefit" : "Add Benefit"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Employee</Label>
            <Select value={String(form.staffId)} onValueChange={v => setForm({ ...form, staffId: Number(v) })}>
              <SelectTrigger data-testid="hr-benefit-staff"><SelectValue /></SelectTrigger>
              <SelectContent>
                {staff.filter(s => s.staffId).map(s => <SelectItem key={s.id} value={String(s.staffId!)}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Benefit Type</Label>
            <Select value={form.benefitType} onValueChange={v => setForm({ ...form, benefitType: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BENEFIT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Plan Name</Label>
            <Input value={form.planName} onChange={e => setForm({ ...form, planName: e.target.value })} data-testid="hr-benefit-plan" />
          </div>
          <div>
            <Label>Provider</Label>
            <Input value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })} />
          </div>
          <div>
            <Label>Policy Number</Label>
            <Input value={form.policyNumber} onChange={e => setForm({ ...form, policyNumber: e.target.value })} />
          </div>
          <div>
            <Label>Monthly Cost</Label>
            <Input type="number" step="0.01" value={form.monthlyCost} onChange={e => setForm({ ...form, monthlyCost: e.target.value })} />
          </div>
          <div>
            <Label>Employer Contribution</Label>
            <Input type="number" step="0.01" value={form.employerContribution} onChange={e => setForm({ ...form, employerContribution: e.target.value })} />
          </div>
          <div>
            <Label>Employee Contribution</Label>
            <Input type="number" step="0.01" value={form.employeeContribution} onChange={e => setForm({ ...form, employeeContribution: e.target.value })} />
          </div>
          <div>
            <Label>Start</Label>
            <Input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
          </div>
          <div>
            <Label>End</Label>
            <Input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="terminated">Terminated</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !form.staffId} data-testid="hr-benefit-save">
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── Policies ───────────────────────────

function PoliciesTab() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: policies = [] } = useQuery<HrPolicy[]>({
    queryKey: ["hr-policies", rid],
    queryFn: () => apiGet(`/restaurants/${rid}/hr-compliance/policies`),
  });
  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ["branches", rid],
    queryFn: () => apiGet(`/restaurants/${rid}/branches`),
  });

  const [branchId, setBranchId] = useState<number | null>(null);
  const current = useMemo(
    () => policies.find(p => (p.branchId ?? null) === branchId) ?? null,
    [policies, branchId],
  );

  const [form, setForm] = useState({
    country: "IN",
    region: "",
    dailyOvertimeHours: "8",
    weeklyOvertimeHours: "48",
    maxShiftHours: "12",
    breakMinutes: 30,
    breakAfterHours: "5",
    minHourlyWage: "0",
    minRestBetweenShiftsHours: "10",
    annualLeaveDays: 12,
  });

  useEffect(() => {
    if (current) {
      setForm({
        country: current.country,
        region: current.region ?? "",
        dailyOvertimeHours: current.dailyOvertimeHours,
        weeklyOvertimeHours: current.weeklyOvertimeHours,
        maxShiftHours: current.maxShiftHours,
        breakMinutes: current.breakMinutes,
        breakAfterHours: current.breakAfterHours,
        minHourlyWage: current.minHourlyWage,
        minRestBetweenShiftsHours: current.minRestBetweenShiftsHours,
        annualLeaveDays: current.annualLeaveDays,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const save = useMutation({
    mutationFn: () => apiPut(`/restaurants/${rid}/hr-compliance/policies`, {
      branchId,
      country: form.country,
      region: form.region || null,
      dailyOvertimeHours: form.dailyOvertimeHours,
      weeklyOvertimeHours: form.weeklyOvertimeHours,
      maxShiftHours: form.maxShiftHours,
      breakMinutes: Number(form.breakMinutes),
      breakAfterHours: form.breakAfterHours,
      minHourlyWage: form.minHourlyWage,
      minRestBetweenShiftsHours: form.minRestBetweenShiftsHours,
      annualLeaveDays: Number(form.annualLeaveDays),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-policies", rid] });
      toast({ title: "Policy saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Label className="text-xs">Outlet</Label>
        <Select value={branchId == null ? "all" : String(branchId)} onValueChange={v => setBranchId(v === "all" ? null : Number(v))}>
          <SelectTrigger className="w-64" data-testid="hr-policy-branch"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outlets (default)</SelectItem>
            {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}{b.isMain ? " (main)" : ""}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card border rounded-lg p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <Label>Country</Label>
          <Input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} maxLength={4} />
        </div>
        <div>
          <Label>Region / State</Label>
          <Input value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} placeholder="e.g. CA, MH" maxLength={4} />
        </div>
        <div>
          <Label>Min Hourly Wage</Label>
          <Input type="number" step="0.01" value={form.minHourlyWage} onChange={e => setForm({ ...form, minHourlyWage: e.target.value })} data-testid="hr-policy-min-wage" />
        </div>
        <div>
          <Label>Daily Overtime After (hrs)</Label>
          <Input type="number" step="0.25" value={form.dailyOvertimeHours} onChange={e => setForm({ ...form, dailyOvertimeHours: e.target.value })} />
        </div>
        <div>
          <Label>Weekly Overtime After (hrs)</Label>
          <Input type="number" step="0.5" value={form.weeklyOvertimeHours} onChange={e => setForm({ ...form, weeklyOvertimeHours: e.target.value })} />
        </div>
        <div>
          <Label>Max Shift (hrs)</Label>
          <Input type="number" step="0.25" value={form.maxShiftHours} onChange={e => setForm({ ...form, maxShiftHours: e.target.value })} />
        </div>
        <div>
          <Label>Break Minutes</Label>
          <Input type="number" value={form.breakMinutes} onChange={e => setForm({ ...form, breakMinutes: Number(e.target.value) })} />
        </div>
        <div>
          <Label>Break After (hrs)</Label>
          <Input type="number" step="0.25" value={form.breakAfterHours} onChange={e => setForm({ ...form, breakAfterHours: e.target.value })} />
        </div>
        <div>
          <Label>Min Rest Between Shifts (hrs)</Label>
          <Input type="number" step="0.25" value={form.minRestBetweenShiftsHours} onChange={e => setForm({ ...form, minRestBetweenShiftsHours: e.target.value })} />
        </div>
        <div>
          <Label>Annual Leave (days)</Label>
          <Input type="number" value={form.annualLeaveDays} onChange={e => setForm({ ...form, annualLeaveDays: Number(e.target.value) })} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="hr-policy-save">
          {save.isPending ? "Saving…" : "Save Policy"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Policies set per outlet override the restaurant-wide default. Breaches against these
        thresholds surface in the <strong>Breaches</strong> tab and on payroll runs.
      </p>
    </div>
  );
}

// ─────────────────────────── Wage Rules ───────────────────────────

function WageRulesTab() {
  const rid = useRestaurantId();
  const [country, setCountry] = useState("IN");
  const { data } = useQuery<{ country: string; currency: string; rules: WageRule[] }>({
    queryKey: ["hr-wage-rules", rid, country],
    queryFn: () => apiGet(`/restaurants/${rid}/hr-compliance/wage-rules?country=${country}`),
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Label className="text-xs">Country</Label>
        <Select value={country} onValueChange={setCountry}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="IN">India</SelectItem>
            <SelectItem value="US">United States</SelectItem>
            <SelectItem value="GB">United Kingdom</SelectItem>
            <SelectItem value="AE">UAE</SelectItem>
            <SelectItem value="EU">European Union</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Region</th>
              <th className="px-3 py-2 text-left">Label</th>
              <th className="px-3 py-2 text-right">Min Hourly</th>
              <th className="px-3 py-2 text-left">Currency</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rules ?? []).map((r, i) => (
              <tr key={i} className="border-t" data-testid={`hr-wage-row-${i}`}>
                <td className="px-3 py-2">{r.region ?? "Federal"}</td>
                <td className="px-3 py-2">{r.label}</td>
                <td className="px-3 py-2 text-right">{r.minHourly.toFixed(2)}</td>
                <td className="px-3 py-2">{r.currency}</td>
              </tr>
            ))}
            {(data?.rules?.length ?? 0) === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No baked-in rules for this country yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground flex items-center gap-1"><Globe className="w-3 h-3" /> Rates are reference only — confirm against your local labour department.</p>
    </div>
  );
}

// ─────────────────────────── Tax Forms ───────────────────────────

function TaxFormsTab() {
  const rid = useRestaurantId();
  const { data: allStaff = [] } = useStaff();
  const usersById = useMemo(() => {
    const m = new Map<number, StaffMember>();
    for (const s of allStaff) m.set(s.id, s);
    return m;
  }, [allStaff]);
  const [userId, setUserId] = useState<number>(0);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [form, setForm] = useState<"W-2" | "1099">("W-2");

  const { data, refetch, isFetching } = useQuery<{
    formType: string;
    employer: { name: string } | null;
    employee: { name: string; email: string } | null;
    totals: { gross: number; overtime: number; bonus: number; deductions: number; net: number };
    monthly: Record<string, number>;
  }>({
    queryKey: ["hr-tax", rid, userId, year, form],
    queryFn: () => apiGet(`/restaurants/${rid}/hr-compliance/tax-summary/${userId}/${year}?form=${form === "1099" ? "1099" : "w2"}`),
    enabled: userId > 0,
  });

  const downloadCsv = async () => {
    if (!userId) return;
    const token = localStorage.getItem("tt_access_token");
    const url = getApiUrl(`/restaurants/${rid}/hr-compliance/tax-summary/${userId}/${year}?form=${form === "1099" ? "1099" : "w2"}&format=csv`);
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) { alert(`Download failed: ${res.status}`); return; }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = `tax-${form === "1099" ? "1099" : "w2"}-${userId}-${year}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  };

  return (
    <div className="space-y-4">
      <div className="bg-card border rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
        <div>
          <Label>Employee</Label>
          <Select value={String(userId || "")} onValueChange={v => setUserId(Number(v))}>
            <SelectTrigger data-testid="hr-tax-employee"><SelectValue placeholder="Choose…" /></SelectTrigger>
            <SelectContent>
              {allStaff.filter(s => s.staffId).map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Year</Label>
          <Input type="number" value={year} onChange={e => setYear(Number(e.target.value))} />
        </div>
        <div>
          <Label>Form</Label>
          <Select value={form} onValueChange={(v: "W-2" | "1099") => setForm(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="W-2">W-2 (employee)</SelectItem>
              <SelectItem value="1099">1099-NEC (contractor)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => refetch()} disabled={!userId || isFetching} variant="outline">Preview</Button>
          <Button onClick={downloadCsv} disabled={!userId} data-testid="hr-tax-download">
            <Download className="w-3.5 h-3.5 mr-1.5" /> CSV
          </Button>
        </div>
      </div>

      {data && (
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <div>
              <div className="font-semibold">{data.formType} Summary · {year}</div>
              <div className="text-muted-foreground">{data.employee?.name} · {data.employer?.name}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
            <SummaryCell label="Gross" value={data.totals.gross} />
            <SummaryCell label="Overtime" value={data.totals.overtime} />
            <SummaryCell label="Bonus" value={data.totals.bonus} />
            <SummaryCell label="Deductions" value={data.totals.deductions} />
            <SummaryCell label="Net Paid" value={data.totals.net} highlight />
          </div>
          <div className="text-xs text-muted-foreground">
            Download-ready summary. The platform does not perform tax e-filing.
          </div>
        </div>
      )}
      {!data && userId === 0 && (
        <p className="text-sm text-muted-foreground">Pick an employee to preview their wage summary for the chosen year.</p>
      )}
    </div>
  );
}

function SummaryCell({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={cn("p-3 rounded border", highlight ? "bg-primary/5 border-primary/30" : "bg-muted/30")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value.toFixed(2)}</div>
    </div>
  );
}

// ─────────────────────────── Breaches ───────────────────────────

function BreachesTab() {
  const rid = useRestaurantId();
  const { data } = useQuery<{ generatedAt: string; policy: HrPolicy | null; breaches: Breach[] }>({
    queryKey: ["hr-breaches", rid],
    queryFn: () => apiGet(`/restaurants/${rid}/hr-compliance/breaches?days=30`),
  });
  const breaches = data?.breaches ?? [];

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">
        Reviewing the past 30 days against your default policy.
        {data?.policy ? null : <span className="text-amber-700"> No default policy configured — set one in the Policies tab.</span>}
      </div>
      <div className="bg-card border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Severity</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Employee</th>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Detail</th>
            </tr>
          </thead>
          <tbody>
            {breaches.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No breaches detected.</td></tr>
            )}
            {breaches.map((b, i) => (
              <tr key={i} className="border-t" data-testid={`hr-breach-${i}`}>
                <td className="px-3 py-2">
                  <span className={cn(
                    "px-2 py-0.5 rounded text-xs",
                    b.severity === "violation" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700",
                  )}>{b.severity}</span>
                </td>
                <td className="px-3 py-2">{b.kind.replace(/_/g, " ")}</td>
                <td className="px-3 py-2">{b.userName ?? `User #${b.userId}`}</td>
                <td className="px-3 py-2">{b.date ? fmtDate(b.date) : "—"}</td>
                <td className="px-3 py-2">{b.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────── Audit ───────────────────────────

function AuditTab() {
  const rid = useRestaurantId();
  const { data: rows = [] } = useQuery<AuditRow[]>({
    queryKey: ["hr-audit", rid],
    queryFn: () => apiGet(`/restaurants/${rid}/hr-compliance/audit?limit=200`),
  });
  return (
    <div className="bg-card border rounded-lg overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase">
          <tr>
            <th className="px-3 py-2 text-left">When</th>
            <th className="px-3 py-2 text-left">Actor</th>
            <th className="px-3 py-2 text-left">Action</th>
            <th className="px-3 py-2 text-left">Entity</th>
            <th className="px-3 py-2 text-left">Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No HR audit entries yet.</td></tr>
          )}
          {rows.map(r => (
            <tr key={r.id} className="border-t" data-testid={`hr-audit-${r.id}`}>
              <td className="px-3 py-2 whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
              <td className="px-3 py-2">{r.userDisplay ?? "—"}<span className="text-xs text-muted-foreground ml-1">{r.role ?? ""}</span></td>
              <td className="px-3 py-2">{r.action}</td>
              <td className="px-3 py-2">{r.entity} {r.entityId ? `#${r.entityId}` : ""}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{r.details ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
