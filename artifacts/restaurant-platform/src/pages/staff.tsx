import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  useStaff, useCreateUser, useUpdateUser, useDeleteUser,
  useShifts, useCreateShift, useDeleteShift,
  useStaffShifts, useCreateStaffShift, useDeleteStaffShift,
  useAttendance, useClockIn, useClockOut, usePunchOut,
  useMarkAttendance, usePatchAttendance, useDeleteAttendance, useBulkWeeklyOff,
  useLeavePolicies, useCreateLeavePolicy, useUpdateLeavePolicy, useDeleteLeavePolicy,
  useLeaveBalances, useSetLeaveBalance,
  useLeaveRequests, useCreateLeaveRequest, useApproveLeaveRequest, useRejectLeaveRequest, useCancelLeaveRequest,
  useAuditLogs,
  useRoles, usePermissions, useRoleWithPermissions, useCreateRole, useDeleteRole,
  useAddRolePermission, useRemoveRolePermission,
  useUpdateStaffProfile, useStaffDocuments, useAddStaffDocument, useDeleteStaffDocument,
  useStaffBankAccount, useSaveStaffBankAccount,
  useSalaryStructure, useSaveSalaryStructure,
  useStaffAdvances, useCreateStaffAdvance, useUpdateStaffAdvance, useDeleteStaffAdvance,
  useStaffAdjustments, useCreateStaffAdjustment, useDeleteStaffAdjustment,
  usePerformanceNotes, useCreatePerformanceNote, useDeletePerformanceNote,
  RESTAURANT_ID,
} from "@/lib/hooks";
import { apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveImageUrl } from "@/components/ImageUploadField";
import {
  Plus, User, Phone, Mail, Calendar, Clock, Activity,
  Users, LogIn, LogOut, Search, Trash2, X, ChevronDown, ChevronUp,
  Shield, CheckCircle2, XCircle, FileText, CreditCard, UserCog, Upload, Eye, EyeOff, Download, Loader2,
  CalendarOff, Check, Ban, Clock3, Banknote, Wallet, Star, MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { StaffMember, Shift, StaffShift, AttendanceRecord, AttendanceStatus, AuditLog, Role, Permission, StaffDocument, LeavePolicy, LeaveBalance, LeaveRequest } from "@/lib/types";

function generateTempPassword(): string {
  const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$";
  const all = upper + lower + digits + special;
  let pwd = upper[Math.floor(Math.random() * upper.length)]
    + lower[Math.floor(Math.random() * lower.length)]
    + digits[Math.floor(Math.random() * digits.length)]
    + special[Math.floor(Math.random() * special.length)];
  for (let i = 4; i < 10; i++) pwd += all[Math.floor(Math.random() * all.length)];
  return pwd.split("").sort(() => Math.random() - 0.5).join("");
}

const ROLE_CONFIG: Record<string, { label: string; color: string }> = {
  owner: { label: "Owner", color: "bg-purple-100 text-purple-700" },
  manager: { label: "Manager", color: "bg-blue-100 text-blue-700" },
  waiter: { label: "Waiter", color: "bg-green-100 text-green-700" },
  kitchen: { label: "Kitchen", color: "bg-orange-100 text-orange-700" },
  cashier: { label: "Cashier", color: "bg-yellow-100 text-yellow-700" },
  delivery_executive: { label: "Delivery Executive", color: "bg-cyan-100 text-cyan-700" },
};

const ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS: Record<string, string> = { mon: "M", tue: "T", wed: "W", thu: "T", fri: "F", sat: "S", sun: "S" };
const DAY_FULL: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

type TabType = "team" | "shifts" | "attendance" | "leaves" | "activity" | "roles";

function formatDateTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

const SALARY_TYPES: Array<{ value: string; label: string }> = [
  { value: "fixed_monthly", label: "Fixed monthly" },
  { value: "daily_wage", label: "Daily wage" },
  { value: "hourly_wage", label: "Hourly wage" },
  { value: "commission", label: "Commission" },
  { value: "custom", label: "Custom" },
];

function toDateInput(v: string | null | undefined): string {
  if (!v) return "";
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function formatBytes(n: number | null | undefined): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function ProfileTab({ member }: { member: StaffMember }) {
  const update = useUpdateStaffProfile();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: member.name ?? "",
    email: member.email ?? "",
    phone: member.phone ?? "",
    role: member.role ?? "waiter",
    employeeCode: member.employeeCode ?? "",
    jobTitle: member.jobTitle ?? "",
    department: member.department ?? "",
    salary: member.salary ?? "",
    salaryType: member.salaryType ?? "fixed_monthly",
    hiredAt: toDateInput(member.hiredAt),
    dateOfBirth: toDateInput(member.dateOfBirth),
    gender: member.gender ?? "",
    address: member.address ?? "",
    city: member.city ?? "",
    state: member.state ?? "",
    pincode: member.pincode ?? "",
    emergencyContactName: member.emergencyContactName ?? "",
    emergencyContact: member.emergencyContact ?? "",
    emergencyContactRelation: member.emergencyContactRelation ?? "",
    notes: member.notes ?? "",
  });

  const save = async () => {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (!form.email.trim()) { toast({ title: "Email is required", variant: "destructive" }); return; }
    try {
      await update.mutateAsync({
        userId: member.id,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        role: form.role,
        employeeCode: form.employeeCode || null,
        jobTitle: form.jobTitle || null,
        department: form.department || null,
        salaryType: form.salaryType,
        salary: form.salary === "" ? null : form.salary,
        hiredAt: form.hiredAt || null,
        dateOfBirth: form.dateOfBirth || null,
        gender: form.gender || null,
        address: form.address || null,
        city: form.city || null,
        state: form.state || null,
        pincode: form.pincode || null,
        emergencyContactName: form.emergencyContactName || null,
        emergencyContact: form.emergencyContact || null,
        emergencyContactRelation: form.emergencyContactRelation || null,
        notes: form.notes || null,
      });
      toast({ title: "Profile saved" });
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "Save failed";
      toast({ title: msg, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Account</h4>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Full Name</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
          <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
          <div>
            <Label>Role</Label>
            <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
              <option value="owner">Owner</option>
              <option value="manager">Manager</option>
              <option value="waiter">Waiter</option>
              <option value="kitchen">Kitchen</option>
              <option value="cashier">Cashier</option>
              <option value="delivery_executive">Delivery Executive</option>
            </select>
          </div>
        </div>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Employment</h4>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Employee Code</Label><Input value={form.employeeCode} onChange={e => setForm(p => ({ ...p, employeeCode: e.target.value }))} placeholder="EMP-001" /></div>
          <div><Label>Job Title</Label><Input value={form.jobTitle} onChange={e => setForm(p => ({ ...p, jobTitle: e.target.value }))} placeholder="Senior Waiter" /></div>
          <div><Label>Department</Label><Input value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} placeholder="Floor" /></div>
          <div><Label>Joining Date</Label><Input type="date" value={form.hiredAt} onChange={e => setForm(p => ({ ...p, hiredAt: e.target.value }))} /></div>
          <div>
            <Label>Salary Type</Label>
            <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.salaryType} onChange={e => setForm(p => ({ ...p, salaryType: e.target.value }))}>
              {SALARY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div><Label>Salary Amount</Label><Input type="number" step="0.01" value={form.salary} onChange={e => setForm(p => ({ ...p, salary: e.target.value }))} placeholder="0.00" /></div>
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Personal</h4>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Date of Birth</Label><Input type="date" value={form.dateOfBirth} onChange={e => setForm(p => ({ ...p, dateOfBirth: e.target.value }))} /></div>
          <div>
            <Label>Gender</Label>
            <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.gender} onChange={e => setForm(p => ({ ...p, gender: e.target.value }))}>
              <option value="">—</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="col-span-2"><Label>Address</Label><Input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder="Street, area" /></div>
          <div><Label>City</Label><Input value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} /></div>
          <div><Label>State</Label><Input value={form.state} onChange={e => setForm(p => ({ ...p, state: e.target.value }))} /></div>
          <div><Label>Pincode</Label><Input value={form.pincode} onChange={e => setForm(p => ({ ...p, pincode: e.target.value }))} /></div>
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Emergency Contact</h4>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>Name</Label><Input value={form.emergencyContactName} onChange={e => setForm(p => ({ ...p, emergencyContactName: e.target.value }))} /></div>
          <div><Label>Phone</Label><Input value={form.emergencyContact} onChange={e => setForm(p => ({ ...p, emergencyContact: e.target.value }))} /></div>
          <div><Label>Relation</Label><Input value={form.emergencyContactRelation} onChange={e => setForm(p => ({ ...p, emergencyContactRelation: e.target.value }))} placeholder="Spouse" /></div>
        </div>
      </div>

      <div>
        <Label>Notes</Label>
        <textarea
          className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background min-h-[70px]"
          value={form.notes}
          onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={update.isPending}>{update.isPending ? "Saving…" : "Save Profile"}</Button>
      </div>
    </div>
  );
}

function DocumentsTab({ member }: { member: StaffMember }) {
  const { data: docs = [] } = useStaffDocuments(member.id);
  const addDoc = useAddStaffDocument();
  const delDoc = useDeleteStaffDocument();
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    const docLabel = label.trim() || file.name;
    setUploading(true);
    try {
      const presign = await apiPost<{ uploadURL: string; objectPath: string }>(
        `/restaurants/${RESTAURANT_ID}/storage/uploads/request-url`,
        { name: file.name, size: file.size, contentType: file.type || "application/octet-stream" },
      );
      const put = await fetch(presign.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      if (!put.ok) throw new Error("Upload failed");
      await apiPost(`/restaurants/${RESTAURANT_ID}/storage/uploads/finalize`, { objectPath: presign.objectPath });
      await addDoc.mutateAsync({
        userId: member.id,
        label: docLabel,
        fileUrl: presign.objectPath,
        mimeType: file.type || undefined,
        sizeBytes: file.size,
      });
      toast({ title: "Document uploaded" });
      setLabel("");
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "Upload failed";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (doc: StaffDocument) => {
    try {
      const token = localStorage.getItem("tt_access_token");
      const base = (import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "");
      const url = `${base}/api/restaurants/${RESTAURANT_ID}/staff/${member.id}/documents/${doc.id}/download`;
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = doc.label;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "Download failed";
      toast({ title: msg, variant: "destructive" });
    }
  };

  const handleDelete = async (doc: StaffDocument) => {
    if (!confirm(`Remove "${doc.label}"?`)) return;
    try {
      await delDoc.mutateAsync({ userId: member.id, docId: doc.id });
      toast({ title: "Document removed" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-3">
        <div>
          <Label>Document Label</Label>
          <Input
            placeholder="Aadhaar / PAN / Contract…"
            value={label}
            onChange={e => setLabel(e.target.value)}
          />
        </div>
        <div>
          <input
            id={`doc-file-${member.id}`}
            type="file"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }}
          />
          <Button
            variant="outline"
            className="w-full"
            disabled={uploading}
            onClick={() => document.getElementById(`doc-file-${member.id}`)?.click()}
          >
            {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            {uploading ? "Uploading…" : "Upload Document"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Stored privately. Only the owner/manager can view or download these files.</p>
      </div>

      <div className="space-y-2">
        {docs.length === 0 && (
          <div className="text-center py-10 text-muted-foreground">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No documents uploaded yet</p>
          </div>
        )}
        {docs.map(doc => (
          <div key={doc.id} className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">{doc.label}</p>
              <p className="text-[11px] text-muted-foreground">
                {doc.mimeType ?? "file"} · {formatBytes(doc.sizeBytes)} · {formatDate(doc.createdAt)}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => handleDownload(doc)} className="p-1.5 text-muted-foreground hover:text-foreground" title="Download">
                <Download className="w-4 h-4" />
              </button>
              <button onClick={() => handleDelete(doc)} className="p-1.5 text-muted-foreground hover:text-destructive" title="Delete">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BankTab({ member }: { member: StaffMember }) {
  const [reveal, setReveal] = useState(false);
  const { data: bank } = useStaffBankAccount(member.id, reveal);
  const save = useSaveStaffBankAccount();
  const { toast } = useToast();

  const [form, setForm] = useState({
    accountName: "",
    accountNumber: "",
    ifsc: "",
    bankName: "",
    upiId: "",
  });

  useEffect(() => {
    if (!bank) return;
    setForm({
      accountName: bank.accountName ?? "",
      accountNumber: reveal ? (bank.accountNumber ?? "") : "",
      ifsc: bank.ifsc ?? "",
      bankName: bank.bankName ?? "",
      upiId: bank.upiId ?? "",
    });
  }, [bank, reveal]);

  const handleSave = async () => {
    try {
      await save.mutateAsync({
        userId: member.id,
        accountName: form.accountName || null,
        accountNumber: form.accountNumber || null,
        ifsc: form.ifsc || null,
        bankName: form.bankName || null,
        upiId: form.upiId || null,
      });
      toast({ title: "Bank details saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };

  const accountDisplay = reveal
    ? form.accountNumber
    : (form.accountNumber || (bank?.accountNumberMasked ?? ""));

  return (
    <div className="space-y-4">
      <div className="bg-muted/20 border border-border rounded-xl p-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Account numbers are masked by default. Reveal to view or edit the full number.</p>
        <Button size="sm" variant="outline" onClick={() => setReveal(r => !r)}>
          {reveal ? <><EyeOff className="w-3.5 h-3.5 mr-1.5" /> Hide</> : <><Eye className="w-3.5 h-3.5 mr-1.5" /> Reveal</>}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Account Holder Name</Label><Input value={form.accountName} onChange={e => setForm(p => ({ ...p, accountName: e.target.value }))} /></div>
        <div className="col-span-2">
          <Label>Account Number</Label>
          <Input
            type={reveal ? "text" : "password"}
            value={accountDisplay}
            onChange={e => setForm(p => ({ ...p, accountNumber: e.target.value }))}
            placeholder={reveal ? "Account number" : "••••"}
          />
        </div>
        <div><Label>IFSC Code</Label><Input value={form.ifsc} onChange={e => setForm(p => ({ ...p, ifsc: e.target.value.toUpperCase() }))} placeholder="HDFC0001234" /></div>
        <div><Label>Bank Name</Label><Input value={form.bankName} onChange={e => setForm(p => ({ ...p, bankName: e.target.value }))} /></div>
        <div className="col-span-2"><Label>UPI ID</Label><Input value={form.upiId} onChange={e => setForm(p => ({ ...p, upiId: e.target.value }))} placeholder="name@upi" /></div>
      </div>
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save Bank Details"}</Button>
      </div>
    </div>
  );
}

function DrawerLeaveRequestForm({ userId, onClose }: { userId: number; onClose: () => void }) {
  const { data: policies = [] } = useLeavePolicies();
  const create = useCreateLeaveRequest();
  const { toast } = useToast();
  const active = policies.filter(p => p.isActive);
  const [form, setForm] = useState({
    leaveType: active[0]?.leaveType ?? "",
    fromDate: new Date().toISOString().slice(0, 10),
    toDate: new Date().toISOString().slice(0, 10),
    halfDay: false,
    reason: "",
  });
  useEffect(() => {
    if (!form.leaveType && active.length > 0) setForm(p => ({ ...p, leaveType: active[0].leaveType }));
  }, [active, form.leaveType]);

  const submit = async () => {
    if (!form.leaveType) { toast({ title: "Pick a leave type", variant: "destructive" }); return; }
    try {
      await create.mutateAsync({
        userId,
        leaveType: form.leaveType,
        fromDate: form.fromDate,
        toDate: form.halfDay ? form.fromDate : form.toDate,
        halfDay: form.halfDay,
        reason: form.reason || undefined,
      });
      toast({ title: "Leave request submitted" });
      onClose();
    } catch (e) {
      toast({ title: (e as { message?: string }).message ?? "Submit failed", variant: "destructive" });
    }
  };

  return (
    <div className="bg-muted/30 border border-border rounded-xl p-3 grid grid-cols-2 gap-2 mb-2">
      <div className="col-span-2">
        <Label className="text-[10px]">Leave type</Label>
        <select className="w-full mt-1 border border-input rounded-md px-2 py-1.5 text-xs bg-background" value={form.leaveType} onChange={e => setForm(p => ({ ...p, leaveType: e.target.value }))}>
          {active.length === 0 && <option value="">No active types</option>}
          {active.map(p => <option key={p.leaveType} value={p.leaveType}>{p.label}</option>)}
        </select>
      </div>
      <div><Label className="text-[10px]">From</Label><Input type="date" className="h-8 text-xs" value={form.fromDate} onChange={e => setForm(p => ({ ...p, fromDate: e.target.value }))} /></div>
      <div><Label className="text-[10px]">To</Label><Input type="date" className="h-8 text-xs" value={form.toDate} onChange={e => setForm(p => ({ ...p, toDate: e.target.value }))} disabled={form.halfDay} /></div>
      <label className="flex items-center gap-1.5 text-xs col-span-2">
        <input type="checkbox" checked={form.halfDay} onChange={e => setForm(p => ({ ...p, halfDay: e.target.checked }))} /> Half day
      </label>
      <div className="col-span-2"><Label className="text-[10px]">Reason</Label><Input className="h-8 text-xs" value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} placeholder="Optional" /></div>
      <div className="col-span-2 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={create.isPending}>Submit</Button>
      </div>
    </div>
  );
}

function CompensationTab({ member }: { member: StaffMember }) {
  const { data: structure, isLoading } = useSalaryStructure(member.id);
  const save = useSaveSalaryStructure();
  const { data: adjustments = [] } = useStaffAdjustments(member.id);
  const createAdj = useCreateStaffAdjustment();
  const deleteAdj = useDeleteStaffAdjustment();
  const { toast } = useToast();

  type StructForm = {
    type: "fixed_monthly" | "daily_wage" | "hourly_wage" | "commission" | "custom";
    baseAmount: string; hourlyRate: string; dailyRate: string; commissionRate: string; commissionBase: string; currency: string;
    components: Array<{ name: string; amount: string; isRecurring: boolean; isTaxable: boolean }>;
  };
  const [form, setForm] = useState<StructForm>({
    type: "fixed_monthly", baseAmount: "", hourlyRate: "", dailyRate: "", commissionRate: "", commissionBase: "orders", currency: "INR",
    components: [],
  });
  const [adjForm, setAdjForm] = useState<{ kind: "bonus" | "deduction"; amount: string; label: string; appliesToMonth: string; isRecurring: boolean }>({
    kind: "bonus", amount: "", label: "", appliesToMonth: "", isRecurring: false,
  });

  useEffect(() => {
    if (!structure) return;
    setForm({
      type: structure.type,
      baseAmount: structure.baseAmount ?? "",
      hourlyRate: structure.hourlyRate ?? "",
      dailyRate: structure.dailyRate ?? "",
      commissionRate: structure.commissionRate ?? "",
      commissionBase: structure.commissionBase ?? "orders",
      currency: structure.currency ?? "INR",
      components: structure.components.map(c => ({ name: c.name, amount: c.amount, isRecurring: c.isRecurring, isTaxable: c.isTaxable })),
    });
  }, [structure]);

  async function onSave() {
    try {
      await save.mutateAsync({
        userId: member.id,
        type: form.type,
        baseAmount: form.baseAmount || null,
        hourlyRate: form.hourlyRate || null,
        dailyRate: form.dailyRate || null,
        commissionRate: form.commissionRate || null,
        commissionBase: form.type === "commission" ? form.commissionBase : null,
        currency: form.currency,
        components: form.components.filter(c => c.name.trim()).map(c => ({
          name: c.name.trim(),
          amount: c.amount || "0",
          isRecurring: c.isRecurring,
          isTaxable: c.isTaxable,
        })),
      });
      toast({ title: "Salary structure saved" });
    } catch (e) {
      toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function onAddAdjustment() {
    if (!adjForm.label.trim() || !adjForm.amount) {
      toast({ title: "Label and amount are required", variant: "destructive" });
      return;
    }
    try {
      await createAdj.mutateAsync({
        userId: member.id,
        kind: adjForm.kind,
        amount: adjForm.amount,
        label: adjForm.label.trim(),
        appliesToMonth: adjForm.appliesToMonth || null,
        isRecurring: adjForm.isRecurring,
      });
      setAdjForm({ kind: "bonus", amount: "", label: "", appliesToMonth: "", isRecurring: false });
      toast({ title: "Adjustment added" });
    } catch (e) {
      toast({ title: "Could not add", description: (e as Error).message, variant: "destructive" });
    }
  }

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Salary structure</h3>
          <Button size="sm" onClick={onSave} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Type</Label>
            <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background"
              value={form.type}
              onChange={e => setForm(p => ({ ...p, type: e.target.value as StructForm["type"] }))}>
              <option value="fixed_monthly">Fixed monthly</option>
              <option value="daily_wage">Daily wage</option>
              <option value="hourly_wage">Hourly wage</option>
              <option value="commission">Commission</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <Label>Currency</Label>
            <Input value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value.toUpperCase() }))} />
          </div>
          {form.type === "fixed_monthly" && (
            <div className="col-span-2">
              <Label>Monthly base amount</Label>
              <Input type="number" inputMode="decimal" value={form.baseAmount} onChange={e => setForm(p => ({ ...p, baseAmount: e.target.value }))} />
            </div>
          )}
          {form.type === "daily_wage" && (
            <div className="col-span-2">
              <Label>Daily rate</Label>
              <Input type="number" inputMode="decimal" value={form.dailyRate} onChange={e => setForm(p => ({ ...p, dailyRate: e.target.value }))} />
            </div>
          )}
          {form.type === "hourly_wage" && (
            <div className="col-span-2">
              <Label>Hourly rate</Label>
              <Input type="number" inputMode="decimal" value={form.hourlyRate} onChange={e => setForm(p => ({ ...p, hourlyRate: e.target.value }))} />
            </div>
          )}
          {form.type === "commission" && (
            <>
              <div>
                <Label>Commission % </Label>
                <Input type="number" inputMode="decimal" step="0.001" value={form.commissionRate} onChange={e => setForm(p => ({ ...p, commissionRate: e.target.value }))} />
              </div>
              <div>
                <Label>Base</Label>
                <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background"
                  value={form.commissionBase}
                  onChange={e => setForm(p => ({ ...p, commissionBase: e.target.value }))}>
                  <option value="orders">Orders</option>
                  <option value="sales">Sales</option>
                </select>
              </div>
              <div className="col-span-2">
                <Label>Optional retainer (base amount)</Label>
                <Input type="number" inputMode="decimal" value={form.baseAmount} onChange={e => setForm(p => ({ ...p, baseAmount: e.target.value }))} />
              </div>
            </>
          )}
          {form.type === "custom" && (
            <div className="col-span-2">
              <Label>Notional base</Label>
              <Input type="number" inputMode="decimal" value={form.baseAmount} onChange={e => setForm(p => ({ ...p, baseAmount: e.target.value }))} />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Components (allowances / fixed deductions)</h3>
          <Button size="sm" variant="outline" onClick={() => setForm(p => ({ ...p, components: [...p.components, { name: "", amount: "", isRecurring: true, isTaxable: false }] }))}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add
          </Button>
        </div>
        {form.components.length === 0 && <p className="text-xs text-muted-foreground">No components yet.</p>}
        <div className="space-y-2">
          {form.components.map((c, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-muted/30 p-2 rounded-md">
              <div className="col-span-5">
                <Label className="text-xs">Name</Label>
                <Input value={c.name} onChange={e => setForm(p => ({ ...p, components: p.components.map((x, i) => i === idx ? { ...x, name: e.target.value } : x) }))} placeholder="HRA, Travel, PF…" />
              </div>
              <div className="col-span-3">
                <Label className="text-xs">Amount</Label>
                <Input type="number" inputMode="decimal" value={c.amount} onChange={e => setForm(p => ({ ...p, components: p.components.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x) }))} />
              </div>
              <div className="col-span-3 flex flex-col gap-1 pt-1">
                <label className="text-xs flex items-center gap-1">
                  <input type="checkbox" checked={c.isRecurring} onChange={e => setForm(p => ({ ...p, components: p.components.map((x, i) => i === idx ? { ...x, isRecurring: e.target.checked } : x) }))} />
                  Recurring
                </label>
                <label className="text-xs flex items-center gap-1">
                  <input type="checkbox" checked={c.isTaxable} onChange={e => setForm(p => ({ ...p, components: p.components.map((x, i) => i === idx ? { ...x, isTaxable: e.target.checked } : x) }))} />
                  Taxable
                </label>
              </div>
              <div className="col-span-1 flex justify-end">
                <button onClick={() => setForm(p => ({ ...p, components: p.components.filter((_, i) => i !== idx) }))} className="text-destructive p-1">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">Bonuses & deductions</h3>
        <div className="grid grid-cols-12 gap-2 items-end bg-muted/30 p-2 rounded-md">
          <div className="col-span-3">
            <Label className="text-xs">Kind</Label>
            <select className="w-full mt-1 border border-input rounded-md px-2 py-1.5 text-sm bg-background"
              value={adjForm.kind}
              onChange={e => setAdjForm(p => ({ ...p, kind: e.target.value as "bonus" | "deduction" }))}>
              <option value="bonus">Bonus</option>
              <option value="deduction">Deduction</option>
            </select>
          </div>
          <div className="col-span-3">
            <Label className="text-xs">Amount</Label>
            <Input type="number" inputMode="decimal" value={adjForm.amount} onChange={e => setAdjForm(p => ({ ...p, amount: e.target.value }))} />
          </div>
          <div className="col-span-4">
            <Label className="text-xs">Label</Label>
            <Input value={adjForm.label} onChange={e => setAdjForm(p => ({ ...p, label: e.target.value }))} placeholder="Diwali bonus / late penalty" />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Month</Label>
            <Input placeholder="YYYY-MM" value={adjForm.appliesToMonth} onChange={e => setAdjForm(p => ({ ...p, appliesToMonth: e.target.value }))} />
          </div>
          <div className="col-span-8 flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={adjForm.isRecurring} onChange={e => setAdjForm(p => ({ ...p, isRecurring: e.target.checked }))} />
              Recurring monthly
            </label>
          </div>
          <div className="col-span-4 flex justify-end">
            <Button size="sm" onClick={onAddAdjustment} disabled={createAdj.isPending}><Plus className="w-3.5 h-3.5 mr-1" /> Add</Button>
          </div>
        </div>
        <div className="space-y-1">
          {adjustments.length === 0 && <p className="text-xs text-muted-foreground">None yet.</p>}
          {adjustments.map(a => (
            <div key={a.id} className="flex items-center justify-between text-sm bg-muted/20 px-3 py-2 rounded-md">
              <div className="flex items-center gap-2">
                <span className={cn("text-xs font-semibold px-2 py-0.5 rounded",
                  a.kind === "bonus" ? "bg-green-100 text-green-700" : "bg-rose-100 text-rose-700")}>
                  {a.kind === "bonus" ? "+" : "−"} {a.amount}
                </span>
                <span>{a.label}</span>
                {a.appliesToMonth && <span className="text-xs text-muted-foreground">{a.appliesToMonth}</span>}
                {a.isRecurring && <span className="text-xs text-muted-foreground italic">recurring</span>}
              </div>
              <button onClick={() => deleteAdj.mutate({ userId: member.id, adjId: a.id })} className="text-destructive p-1">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdvancesTab({ member }: { member: StaffMember }) {
  const { data, isLoading } = useStaffAdvances(member.id);
  const create = useCreateStaffAdvance();
  const update = useUpdateStaffAdvance();
  const remove = useDeleteStaffAdvance();
  const { toast } = useToast();
  const [form, setForm] = useState({ amount: "", paidOn: new Date().toISOString().slice(0, 10), notes: "" });
  const [settleFor, setSettleFor] = useState<number | null>(null);
  const [settleAmt, setSettleAmt] = useState("");

  async function onAdd() {
    if (!form.amount) { toast({ title: "Amount required", variant: "destructive" }); return; }
    try {
      await create.mutateAsync({ userId: member.id, amount: form.amount, paidOn: new Date(form.paidOn).toISOString(), notes: form.notes || null });
      setForm({ amount: "", paidOn: new Date().toISOString().slice(0, 10), notes: "" });
      toast({ title: "Advance recorded" });
    } catch (e) {
      toast({ title: "Could not record", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function onSettle(id: number, current: string, total: string) {
    const next = Number(settleAmt);
    if (!Number.isFinite(next) || next <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }
    const remaining = Number(total) - Number(current);
    if (next > remaining + 1e-6) {
      toast({ title: `Cannot exceed remaining ${remaining.toFixed(2)}`, variant: "destructive" });
      return;
    }
    try {
      await update.mutateAsync({ userId: member.id, advanceId: id, settledAmount: (Number(current) + next).toFixed(2) });
      setSettleFor(null); setSettleAmt("");
      toast({ title: "Settlement applied" });
    } catch (e) {
      toast({ title: "Could not update", description: (e as Error).message, variant: "destructive" });
    }
  }

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-muted/30 rounded-md p-3">
          <p className="text-xs text-muted-foreground">Outstanding</p>
          <p className="text-lg font-semibold text-orange-600">{data?.outstanding ?? "0.00"}</p>
        </div>
        <div className="bg-muted/30 rounded-md p-3">
          <p className="text-xs text-muted-foreground">Total advanced</p>
          <p className="text-lg font-semibold">{data?.advanced ?? "0.00"}</p>
        </div>
        <div className="bg-muted/30 rounded-md p-3">
          <p className="text-xs text-muted-foreground">Total settled</p>
          <p className="text-lg font-semibold text-green-700">{data?.settled ?? "0.00"}</p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-2 items-end bg-muted/30 p-3 rounded-md">
        <div className="col-span-4">
          <Label className="text-xs">Amount</Label>
          <Input type="number" inputMode="decimal" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
        </div>
        <div className="col-span-4">
          <Label className="text-xs">Paid on</Label>
          <Input type="date" value={form.paidOn} onChange={e => setForm(p => ({ ...p, paidOn: e.target.value }))} />
        </div>
        <div className="col-span-4 flex justify-end">
          <Button size="sm" onClick={onAdd} disabled={create.isPending}><Plus className="w-3.5 h-3.5 mr-1" /> Record advance</Button>
        </div>
        <div className="col-span-12">
          <Label className="text-xs">Notes</Label>
          <Input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Reason / reference" />
        </div>
      </div>

      <div className="space-y-2">
        {rows.length === 0 && <p className="text-xs text-muted-foreground">No advances recorded yet.</p>}
        {rows.map(r => {
          const outstanding = (Number(r.amount) - Number(r.settledAmount)).toFixed(2);
          return (
            <div key={r.id} className="border border-border rounded-md p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold">{r.amount}</span>
                  <span className="text-xs text-muted-foreground ml-2">{formatDate(r.paidOn)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("text-xs font-medium px-2 py-0.5 rounded",
                    Number(outstanding) > 0 ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700")}>
                    {Number(outstanding) > 0 ? `${outstanding} outstanding` : "Settled"}
                  </span>
                  <button onClick={() => remove.mutate({ userId: member.id, advanceId: r.id })} className="text-destructive p-1">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {r.notes && <p className="text-xs text-muted-foreground mt-1">{r.notes}</p>}
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3">
                <span>Settled so far: {r.settledAmount}</span>
                {r.runningBalance !== undefined && (
                  <span title="Cumulative outstanding balance up to and including this entry">
                    Balance after this entry: <span className="font-medium text-foreground">{r.runningBalance}</span>
                  </span>
                )}
              </div>
              {settleFor === r.id ? (
                <div className="flex items-center gap-2 mt-2">
                  <Input className="h-8 text-xs" type="number" inputMode="decimal" placeholder={`Up to ${outstanding}`} max={outstanding} value={settleAmt} onChange={e => setSettleAmt(e.target.value)} />
                  <Button size="sm" onClick={() => onSettle(r.id, r.settledAmount, r.amount)} disabled={update.isPending}>Apply</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setSettleFor(null); setSettleAmt(""); }}>Cancel</Button>
                </div>
              ) : Number(outstanding) > 0 ? (
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => { setSettleFor(r.id); setSettleAmt(""); }}>
                  Record settlement
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PerformanceNotesTab({ member }: { member: StaffMember }) {
  const { data: notes = [], isLoading } = usePerformanceNotes(member.id);
  const create = useCreatePerformanceNote();
  const remove = useDeletePerformanceNote();
  const { toast } = useToast();
  const [form, setForm] = useState<{ body: string; rating: string }>({ body: "", rating: "" });

  async function onAdd() {
    if (!form.body.trim()) { toast({ title: "Note body required", variant: "destructive" }); return; }
    try {
      await create.mutateAsync({
        userId: member.id,
        body: form.body.trim(),
        rating: form.rating ? Number(form.rating) : null,
      });
      setForm({ body: "", rating: "" });
      toast({ title: "Note added" });
    } catch (e) {
      toast({ title: "Could not add", description: (e as Error).message, variant: "destructive" });
    }
  }

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="bg-muted/30 rounded-md p-3 space-y-2">
        <div>
          <Label className="text-xs">Note</Label>
          <textarea className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background min-h-[72px]"
            value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} placeholder="Observed behavior, achievement, area to improve…" />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Label className="text-xs">Rating</Label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" onClick={() => setForm(p => ({ ...p, rating: String(n) }))} className="p-0.5">
                  <Star className={cn("w-4 h-4", Number(form.rating) >= n ? "fill-yellow-400 text-yellow-500" : "text-muted-foreground")} />
                </button>
              ))}
              {form.rating && <button type="button" onClick={() => setForm(p => ({ ...p, rating: "" }))} className="text-xs text-muted-foreground ml-1">clear</button>}
            </div>
          </div>
          <Button size="sm" onClick={onAdd} disabled={create.isPending}><Plus className="w-3.5 h-3.5 mr-1" /> Add note</Button>
        </div>
      </div>

      <div className="space-y-2">
        {notes.length === 0 && <p className="text-xs text-muted-foreground">No notes yet.</p>}
        {notes.map(n => (
          <div key={n.id} className="border border-border rounded-md p-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <MessageSquare className="w-3 h-3" />
                <span>{n.authorName ?? "Manager"}</span>
                <span>·</span>
                <span>{formatDateTime(n.createdAt)}</span>
                {n.rating != null && (
                  <span className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className={cn("w-3 h-3", i < (n.rating ?? 0) ? "fill-yellow-400 text-yellow-500" : "text-muted-foreground/40")} />
                    ))}
                  </span>
                )}
              </div>
              <button onClick={() => remove.mutate({ userId: member.id, noteId: n.id })} className="text-destructive p-1">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-sm whitespace-pre-wrap">{n.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StaffDrawer({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const [tab, setTab] = useState<"profile" | "documents" | "bank" | "compensation" | "advances" | "notes">("profile");
  const [showRequestLeave, setShowRequestLeave] = useState(false);
  const { user } = useAuth();
  const canRequestForOthers = user?.isSuperAdmin || user?.role === "owner" || user?.role === "manager";
  const initials = member.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  const roleConfig = ROLE_CONFIG[member.role] ?? { label: member.role, color: "bg-gray-100 text-gray-600" };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="bg-card border-l border-border w-full max-w-xl h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-sm overflow-hidden">
              {member.avatarUrl ? <img src={resolveImageUrl(member.avatarUrl)} alt="" className="w-full h-full object-cover" /> : initials}
            </div>
            <div>
              <p className="text-sm font-semibold">{member.name}</p>
              <p className="text-xs text-muted-foreground">
                <span className={cn("font-medium px-1.5 py-0.5 rounded", roleConfig.color)}>{roleConfig.label}</span>
                {member.employeeCode && <span className="ml-2">#{member.employeeCode}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canRequestForOthers && (
              <Button size="sm" variant="outline" onClick={() => setShowRequestLeave(true)}>
                <CalendarOff className="w-3.5 h-3.5 mr-1" /> Request leave
              </Button>
            )}
            <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>
        </div>

        {showRequestLeave && (
          <div className="px-5 pt-4">
            <DrawerLeaveRequestForm userId={member.id} onClose={() => setShowRequestLeave(false)} />
          </div>
        )}

        <div className="px-5 pt-3 border-b border-border flex gap-1">
          {([
            { id: "profile", label: "Profile", Icon: UserCog },
            { id: "documents", label: "Documents", Icon: FileText },
            { id: "bank", label: "Bank", Icon: CreditCard },
            { id: "compensation", label: "Compensation", Icon: Banknote },
            { id: "advances", label: "Advances", Icon: Wallet },
            { id: "notes", label: "Performance", Icon: Star },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-t-md border-b-2 transition-colors",
                tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <t.Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>

        <div className="px-5 py-5">
          {tab === "profile" && <ProfileTab member={member} />}
          {tab === "documents" && <DocumentsTab member={member} />}
          {tab === "bank" && <BankTab member={member} />}
          {tab === "compensation" && <CompensationTab member={member} />}
          {tab === "advances" && <AdvancesTab member={member} />}
          {tab === "notes" && <PerformanceNotesTab member={member} />}
        </div>
      </div>
    </div>
  );
}

function TeamTab({
  roleFilter, setRoleFilter, staff, showAdd, setShowAdd,
}: {
  roleFilter: string | undefined;
  setRoleFilter: (r: string | undefined) => void;
  staff: StaffMember[];
  showAdd: boolean;
  setShowAdd: (b: boolean) => void;
}) {
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const clockIn = useClockIn();
  const punchOut = usePunchOut();
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayEnd = new Date(todayStart); todayEnd.setHours(23, 59, 59, 999);
  const { data: todayAttendance = [] } = useAttendance({ from: todayStart.toISOString(), to: todayEnd.toISOString() });
  const openSessionByUser: Record<number, AttendanceRecord> = {};
  for (const r of todayAttendance) {
    if (!r.clockOut && (r.status === "present" || r.status === "late" || r.status === "half_day")) openSessionByUser[r.userId] = r;
  }
  const { toast } = useToast();

  const [form, setForm] = useState({ name: "", email: "", phone: "", role: "waiter" });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [drawerMember, setDrawerMember] = useState<StaffMember | null>(null);
  const [generatedCreds, setGeneratedCreds] = useState<{ name: string; password: string } | null>(null);

  const handlePunch = async (member: StaffMember) => {
    try {
      if (openSessionByUser[member.id]) {
        await punchOut.mutateAsync({ userId: member.id });
        toast({ title: `${member.name} punched out` });
      } else {
        await clockIn.mutateAsync({ userId: member.id, source: "web" });
        toast({ title: `${member.name} punched in` });
      }
    } catch {
      toast({ title: "Punch failed", variant: "destructive" });
    }
  };

  const { user } = useAuth();
  const ALLOWED_ASSIGNABLE: Record<string, string[]> = {
    owner: ["manager", "waiter", "kitchen", "cashier", "delivery_executive"],
    manager: ["waiter", "kitchen", "cashier", "delivery_executive"],
  };
  const assignableRoles = user?.isSuperAdmin
    ? ["owner", "manager", "waiter", "kitchen", "cashier", "delivery_executive"]
    : (ALLOWED_ASSIGNABLE[user?.role ?? ""] ?? ["waiter", "kitchen", "cashier", "delivery_executive"]);

  const roles = ["owner", "manager", "waiter", "kitchen", "cashier", "delivery_executive"];
  const byRole = (role: string) => staff.filter((s: StaffMember) => s.role === role).length;

  const handleAdd = async () => {
    if (!form.name || !form.email) return;
    const tempPassword = generateTempPassword();
    try {
      await createUser.mutateAsync({ ...form, password: tempPassword, restaurantId: 1, tenantId: 1 });
      setGeneratedCreds({ name: form.name, password: tempPassword });
      setShowAdd(false);
      setForm({ name: "", email: "", phone: "", role: "waiter" });
    } catch {
      toast({ title: "Failed to add staff member", variant: "destructive" });
    }
  };

  const handleToggleActive = async (member: StaffMember) => {
    try {
      await updateUser.mutateAsync({ id: member.id, isActive: !member.isActive });
      toast({ title: member.isActive ? "Staff deactivated" : "Staff activated" });
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Remove this staff member? This cannot be undone.")) return;
    try {
      await deleteUser.mutateAsync(id);
      toast({ title: "Staff member removed" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  return (
    <div>
      <div className="flex gap-2 mb-5 flex-wrap">
        <button onClick={() => setRoleFilter(undefined)} className={cn("text-sm px-3 py-1.5 rounded-lg border", !roleFilter ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted")}>
          All ({staff.length})
        </button>
        {roles.map(role => {
          const cfg = ROLE_CONFIG[role];
          return (
            <button key={role} onClick={() => setRoleFilter(roleFilter === role ? undefined : role)} className={cn("text-sm px-3 py-1.5 rounded-lg border transition-colors", roleFilter === role ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted")}>
              {cfg.label} ({byRole(role)})
            </button>
          );
        })}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Name</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Contact</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Role</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Last Active</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Status</th>
              <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((member: StaffMember) => {
              const roleConfig = ROLE_CONFIG[member.role] ?? { label: member.role, color: "bg-gray-100 text-gray-600" };
              const initials = member.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
              const isExpanded = expandedId === member.id;
              return (
                <>
                  <tr key={member.id} className={cn("border-b border-border hover:bg-muted/10 transition-colors", !isExpanded && "last:border-0")}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
                          {initials}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{member.name}</p>
                          <p className="text-xs text-muted-foreground">{member.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {member.phone ? (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="w-3 h-3" />{member.phone}
                        </p>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", roleConfig.color)}>{roleConfig.label}</span>
                        {member.outstandingAdvance && Number(member.outstandingAdvance) > 0 && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-100 text-orange-700" title="Outstanding salary advance">
                            <Wallet className="w-2.5 h-2.5 inline mr-0.5" />₹ {Number(member.outstandingAdvance).toFixed(0)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground">
                        {member.lastLoginAt ? formatDateTime(member.lastLoginAt) : member.createdAt ? `Joined ${formatDate(member.createdAt)}` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("text-xs font-medium flex items-center gap-1", member.isActive ? "text-green-600" : "text-red-500")}>
                        {member.isActive ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {member.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {openSessionByUser[member.id] ? (
                          <Button size="sm" variant="outline" className="h-7 text-xs text-orange-600 border-orange-300" onClick={() => handlePunch(member)} disabled={punchOut.isPending}>
                            <LogOut className="w-3 h-3 mr-1" /> Punch out
                          </Button>
                        ) : (
                          member.isActive && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-green-700" onClick={() => handlePunch(member)} disabled={clockIn.isPending}>
                              <LogIn className="w-3 h-3 mr-1" /> Punch in
                            </Button>
                          )
                        )}
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDrawerMember(member)}>
                          <UserCog className="w-3 h-3 mr-1" /> Manage
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleToggleActive(member)}>
                          {member.isActive ? "Deactivate" : "Activate"}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(member.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                        <button className="p-1 text-muted-foreground hover:text-foreground" onClick={() => setExpandedId(isExpanded ? null : member.id)}>
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`exp-${member.id}`} className="border-b border-border last:border-0 bg-muted/5">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="flex items-center gap-6 text-xs text-muted-foreground flex-wrap">
                          <div className="flex items-center gap-1.5"><Mail className="w-3 h-3" />{member.email}</div>
                          {member.phone && <div className="flex items-center gap-1.5"><Phone className="w-3 h-3" />{member.phone}</div>}
                          <div className="flex items-center gap-1.5"><Shield className="w-3 h-3" />Role: {roleConfig.label}</div>
                          {member.createdAt && <div className="flex items-center gap-1.5"><Calendar className="w-3 h-3" />Joined: {formatDate(member.createdAt)}</div>}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {staff.length === 0 && (
              <tr><td colSpan={6} className="text-center py-16 text-muted-foreground">
                <User className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">No staff found</p>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {generatedCreds && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-green-600 flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /> Staff Added</h2>
              <button onClick={() => setGeneratedCreds(null)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{generatedCreds.name} has been added. Share these credentials securely — they won't be shown again.</p>
            <div className="bg-muted/60 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Temporary Password</span>
              </div>
              <p className="font-mono text-lg font-bold tracking-widest text-foreground select-all">{generatedCreds.password}</p>
              <p className="text-xs text-orange-600 font-medium">Ask the staff member to change this password on first login.</p>
            </div>
            <Button className="w-full mt-4" onClick={() => { navigator.clipboard?.writeText(generatedCreds.password); setGeneratedCreds(null); }}>Copy & Close</Button>
          </div>
        </div>
      )}

      {drawerMember && (
        <StaffDrawer member={staff.find(s => s.id === drawerMember.id) ?? drawerMember} onClose={() => setDrawerMember(null)} />
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Add Staff Member</h2>
              <button onClick={() => setShowAdd(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <div className="space-y-3">
              <div><Label>Full Name</Label><Input placeholder="Rahul Kumar" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Label>Email</Label><Input type="email" placeholder="rahul@spicegarden.com" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
              <div><Label>Phone</Label><Input placeholder="+91 98765 43210" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
              <div>
                <Label>Role</Label>
                <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                  {assignableRoles.map(r => <option key={r} value={r}>{ROLE_CONFIG[r]?.label ?? r}</option>)}
                </select>
              </div>
              <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">A unique temporary password will be generated and shown to you after adding the staff member.</p>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleAdd} disabled={createUser.isPending}>Add Staff</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ShiftsTab({ staff }: { staff: StaffMember[] }) {
  const { data: shifts = [] } = useShifts();
  const { data: staffShifts = [] } = useStaffShifts();
  const createShift = useCreateShift();
  const deleteShift = useDeleteShift();
  const createStaffShift = useCreateStaffShift();
  const { toast } = useToast();

  const deleteStaffShift = useDeleteStaffShift();
  const [showAdd, setShowAdd] = useState(false);
  const [shiftForm, setShiftForm] = useState({ name: "", startTime: "09:00", endTime: "17:00", days: [] as string[] });
  const [assignForm, setAssignForm] = useState({ userId: "", shiftId: "", date: "", endDate: "", recurringDays: [] as string[] });
  const [showAssign, setShowAssign] = useState(false);

  const toggleAssignDay = (day: string) => {
    setAssignForm(p => ({ ...p, recurringDays: p.recurringDays.includes(day) ? p.recurringDays.filter(d => d !== day) : [...p.recurringDays, day] }));
  };

  const handleDeleteAssignment = async (id: number) => {
    if (!confirm("Remove this assignment?")) return;
    try {
      await deleteStaffShift.mutateAsync(id);
      toast({ title: "Assignment removed" });
    } catch {
      toast({ title: "Failed to remove", variant: "destructive" });
    }
  };

  const toggleDay = (day: string) => {
    setShiftForm(p => ({ ...p, days: p.days.includes(day) ? p.days.filter(d => d !== day) : [...p.days, day] }));
  };

  const handleCreateShift = async () => {
    if (!shiftForm.name || shiftForm.days.length === 0) {
      toast({ title: "Name and at least one day are required", variant: "destructive" });
      return;
    }
    try {
      await createShift.mutateAsync(shiftForm);
      toast({ title: "Shift created" });
      setShiftForm({ name: "", startTime: "09:00", endTime: "17:00", days: [] });
      setShowAdd(false);
    } catch {
      toast({ title: "Failed to create shift", variant: "destructive" });
    }
  };

  const handleDeleteShift = async (id: number) => {
    if (!confirm("Delete this shift?")) return;
    try {
      await deleteShift.mutateAsync(id);
      toast({ title: "Shift deleted" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const handleAssign = async () => {
    if (!assignForm.userId || !assignForm.shiftId || !assignForm.date) return;
    try {
      await createStaffShift.mutateAsync({
        userId: Number(assignForm.userId),
        shiftId: Number(assignForm.shiftId),
        date: assignForm.date,
        endDate: assignForm.endDate || null,
        recurringDays: assignForm.recurringDays,
      });
      toast({ title: assignForm.recurringDays.length > 0 ? "Recurring assignment created" : "Staff assigned to shift" });
      setShowAssign(false);
      setAssignForm({ userId: "", shiftId: "", date: "", endDate: "", recurringDays: [] });
    } catch {
      toast({ title: "Assignment failed", variant: "destructive" });
    }
  };

  const getStaffForShift = (shiftId: number) => {
    const userIds = staffShifts.filter((ss: StaffShift) => ss.shiftId === shiftId).map((ss: StaffShift) => ss.userId);
    return staff.filter((s: StaffMember) => userIds.includes(s.id));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Shift Definitions</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowAssign(true)}>
            <Calendar className="w-3.5 h-3.5 mr-1.5" /> Assign Staff
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> New Shift
          </Button>
        </div>
      </div>

      {showAdd && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <h4 className="text-sm font-medium">Create Shift</h4>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3 md:col-span-1"><Label>Shift Name</Label><Input placeholder="Morning Shift" value={shiftForm.name} onChange={e => setShiftForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label>Start Time</Label><Input type="time" value={shiftForm.startTime} onChange={e => setShiftForm(p => ({ ...p, startTime: e.target.value }))} /></div>
            <div><Label>End Time</Label><Input type="time" value={shiftForm.endTime} onChange={e => setShiftForm(p => ({ ...p, endTime: e.target.value }))} /></div>
          </div>
          <div>
            <Label>Days</Label>
            <div className="flex gap-1.5 mt-1 flex-wrap">
              {ALL_DAYS.map(day => (
                <button key={day} onClick={() => toggleDay(day)} className={cn("w-9 h-9 rounded-full text-xs font-medium border transition-colors", shiftForm.days.includes(day) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted")}>
                  {DAY_LABELS[day]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreateShift} disabled={createShift.isPending}>Create Shift</Button>
            <Button size="sm" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {shifts.filter((s: Shift) => s.isActive).map((shift: Shift) => {
          const assignees = getStaffForShift(shift.id);
          return (
            <div key={shift.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold text-foreground text-sm">{shift.name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3" />
                    {shift.startTime} – {shift.endTime}
                  </p>
                </div>
                <button onClick={() => handleDeleteShift(shift.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex gap-1 mb-3 flex-wrap">
                {ALL_DAYS.map(day => (
                  <span key={day} className={cn("w-6 h-6 rounded text-[10px] font-medium flex items-center justify-center", Array.isArray(shift.days) && shift.days.includes(day) ? "bg-primary/15 text-primary" : "bg-muted/30 text-muted-foreground/40")}>
                    {DAY_LABELS[day]}
                  </span>
                ))}
              </div>
              {assignees.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {assignees.map((s: StaffMember) => (
                    <span key={s.id} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{s.name.split(" ")[0]}</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No staff assigned</p>
              )}
            </div>
          );
        })}
        {shifts.length === 0 && !showAdd && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            <Calendar className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm">No shifts created yet</p>
          </div>
        )}
      </div>

      {shifts.filter((s: Shift) => s.isActive).length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Weekly Schedule</h3>
          <div className="bg-card border border-border rounded-xl overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5 w-36">Shift</th>
                  {ALL_DAYS.map(day => (
                    <th key={day} className="text-center text-xs font-medium text-muted-foreground px-2 py-2.5">{DAY_FULL[day]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shifts.filter((s: Shift) => s.isActive).map((shift: Shift) => {
                  const assignees = getStaffForShift(shift.id);
                  return (
                    <tr key={shift.id} className="border-b border-border last:border-0 hover:bg-muted/10">
                      <td className="px-4 py-3">
                        <p className="text-xs font-semibold text-foreground">{shift.name}</p>
                        <p className="text-[10px] text-muted-foreground">{shift.startTime}–{shift.endTime}</p>
                      </td>
                      {ALL_DAYS.map(day => {
                        const active = Array.isArray(shift.days) && shift.days.includes(day);
                        return (
                          <td key={day} className="px-2 py-3 text-center">
                            {active ? (
                              assignees.length > 0 ? (
                                <div className="flex flex-col gap-0.5 items-center">
                                  {assignees.slice(0, 2).map((s: StaffMember) => (
                                    <span key={s.id} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium leading-tight">{s.name.split(" ")[0]}</span>
                                  ))}
                                  {assignees.length > 2 && <span className="text-[10px] text-muted-foreground">+{assignees.length - 2}</span>}
                                </div>
                              ) : (
                                <span className="inline-block w-3 h-3 rounded-full bg-primary/20" title="Shift runs, no one assigned" />
                              )
                            ) : (
                              <span className="inline-block w-2 h-0.5 rounded bg-muted-foreground/20" />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAssign && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Assign Staff to Shift</h2>
              <button onClick={() => setShowAssign(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Staff Member</Label>
                <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={assignForm.userId} onChange={e => setAssignForm(p => ({ ...p, userId: e.target.value }))}>
                  <option value="">Select staff</option>
                  {staff.filter((s: StaffMember) => s.isActive).map((s: StaffMember) => <option key={s.id} value={s.id}>{s.name} ({ROLE_CONFIG[s.role]?.label ?? s.role})</option>)}
                </select>
              </div>
              <div>
                <Label>Shift</Label>
                <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={assignForm.shiftId} onChange={e => setAssignForm(p => ({ ...p, shiftId: e.target.value }))}>
                  <option value="">Select shift</option>
                  {shifts.filter((s: Shift) => s.isActive).map((s: Shift) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}–{s.endTime})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Start Date</Label>
                  <Input type="date" value={assignForm.date} onChange={e => setAssignForm(p => ({ ...p, date: e.target.value }))} />
                </div>
                <div>
                  <Label>End Date (optional)</Label>
                  <Input type="date" value={assignForm.endDate} onChange={e => setAssignForm(p => ({ ...p, endDate: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label>Recurring Days (optional)</Label>
                <div className="flex gap-1.5 mt-1 flex-wrap">
                  {ALL_DAYS.map(day => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleAssignDay(day)}
                      className={cn("w-9 h-9 rounded-full text-xs font-medium border transition-colors", assignForm.recurringDays.includes(day) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted")}
                    >
                      {DAY_LABELS[day]}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Leave empty for a single-day assignment. With days selected, the assignment recurs on each chosen weekday between the start and end dates.</p>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowAssign(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleAssign} disabled={createStaffShift.isPending}>Assign</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_CONFIG: Record<AttendanceStatus, { label: string; chip: string; cell: string; short: string }> = {
  present:    { label: "Present",    chip: "bg-green-100 text-green-700",   cell: "bg-green-100 text-green-700",  short: "P" },
  late:       { label: "Late",       chip: "bg-amber-100 text-amber-700",   cell: "bg-amber-100 text-amber-700",  short: "L" },
  half_day:   { label: "Half day",   chip: "bg-orange-100 text-orange-700", cell: "bg-orange-100 text-orange-700",short: "½" },
  absent:     { label: "Absent",     chip: "bg-red-100 text-red-700",       cell: "bg-red-100 text-red-700",      short: "A" },
  weekly_off: { label: "Weekly off", chip: "bg-slate-100 text-slate-600",   cell: "bg-slate-100 text-slate-500",  short: "W" },
  leave:      { label: "Leave",      chip: "bg-purple-100 text-purple-700", cell: "bg-purple-100 text-purple-700",short: "Lv" },
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function AttendanceTab({ staff }: { staff: StaffMember[] }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [filterUserId, setFilterUserId] = useState<number | undefined>();
  const [markDrawer, setMarkDrawer] = useState<{ userId: number; date: string } | null>(null);
  const [weeklyOffOpen, setWeeklyOffOpen] = useState(false);

  const firstOfMonth = new Date(year, month, 1);
  const firstOfNext = new Date(year, month + 1, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const { data: attendance = [] } = useAttendance({
    userId: filterUserId,
    from: firstOfMonth.toISOString(),
    to: firstOfNext.toISOString(),
  });

  const punchOut = usePunchOut();
  const deleteAttendance = useDeleteAttendance();
  const { toast } = useToast();

  // userId -> ymd -> record
  const grid: Record<number, Record<string, AttendanceRecord>> = {};
  for (const r of attendance) {
    const key = ymd(new Date(r.date ?? r.clockIn));
    grid[r.userId] = grid[r.userId] || {};
    grid[r.userId][key] = r;
  }

  const openRecords = attendance.filter((r: AttendanceRecord) => !r.clockOut && r.status !== "weekly_off" && r.status !== "leave" && r.status !== "absent");
  const visibleStaff = filterUserId ? staff.filter(s => s.id === filterUserId) : staff;

  const handleClockOut = async (record: AttendanceRecord) => {
    try {
      await punchOut.mutateAsync({ userId: record.userId });
      toast({ title: "Clock-out recorded" });
    } catch {
      toast({ title: "Clock-out failed", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this attendance record?")) return;
    try {
      await deleteAttendance.mutateAsync(id);
      toast({ title: "Record deleted" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const monthName = firstOfMonth.toLocaleString("default", { month: "long", year: "numeric" });
  const dayHeaders = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  function totalsFor(userId: number) {
    const days = grid[userId] ?? {};
    let present = 0, late = 0, halfDay = 0, absent = 0, off = 0, leave = 0;
    let worked = 0, overtime = 0;
    for (const r of Object.values(days)) {
      if (r.status === "present") present++;
      else if (r.status === "late") { present++; late++; }
      else if (r.status === "half_day") halfDay++;
      else if (r.status === "absent") absent++;
      else if (r.status === "weekly_off") off++;
      else if (r.status === "leave") leave++;
      worked += r.workedMinutes ?? 0;
      overtime += r.overtimeMinutes ?? 0;
    }
    return { present, late, halfDay, absent, off, leave, worked, overtime };
  }

  const goPrevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const goNextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };
  const todayKey = ymd(today);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={goPrevMonth}><ChevronUp className="w-4 h-4 -rotate-90" /></Button>
          <div className="text-sm font-semibold min-w-40 text-center">{monthName}</div>
          <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={goNextMonth}><ChevronDown className="w-4 h-4 -rotate-90" /></Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}>Today</Button>
        </div>
        <div className="flex items-center gap-2">
          <select className="border border-input rounded-md px-3 py-1.5 text-sm bg-background" value={filterUserId ?? ""} onChange={e => setFilterUserId(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">All Staff</option>
            {staff.map((s: StaffMember) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={() => setWeeklyOffOpen(true)}>
            Bulk Weekly Off
          </Button>
          <Button size="sm" onClick={() => setMarkDrawer({ userId: staff[0]?.id ?? 0, date: todayKey })}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Mark Attendance
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {(Object.keys(STATUS_CONFIG) as AttendanceStatus[]).map(k => (
          <span key={k} className={cn("px-2 py-0.5 rounded-full font-medium", STATUS_CONFIG[k].chip)}>{STATUS_CONFIG[k].label}</span>
        ))}
      </div>

      {openRecords.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-3 text-orange-600 flex items-center gap-1.5"><LogIn className="w-3.5 h-3.5" /> Currently Clocked In ({openRecords.length})</h4>
          <div className="bg-card border border-orange-200 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-orange-50/50">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Staff</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Clock In</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Duration</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {openRecords.map((record: AttendanceRecord) => {
                  const member = staff.find((s: StaffMember) => s.id === record.userId);
                  const durationMs = Date.now() - new Date(record.clockIn).getTime();
                  const hours = Math.floor(durationMs / 3600000);
                  const mins = Math.floor((durationMs % 3600000) / 60000);
                  return (
                    <tr key={record.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 text-sm font-medium">{member?.name ?? `User #${record.userId}`}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{formatDateTime(record.clockIn)}</td>
                      <td className="px-4 py-3 text-sm text-orange-600 font-medium">{hours}h {mins}m</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleClockOut(record)} disabled={punchOut.isPending}>
                          <LogOut className="w-3 h-3 mr-1" /> Clock Out
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Monthly Attendance Grid</h4>
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="text-xs min-w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left font-medium text-muted-foreground px-3 py-2 sticky left-0 bg-muted/30 z-10 min-w-32">Staff</th>
                {dayHeaders.map(d => {
                  const date = new Date(year, month, d);
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  const isToday = ymd(date) === todayKey;
                  return (
                    <th key={d} className={cn("font-medium text-muted-foreground px-1 py-2 text-center min-w-7", isWeekend && "bg-slate-50/50", isToday && "bg-primary/10 text-primary")}>
                      {d}
                    </th>
                  );
                })}
                <th className="font-medium text-muted-foreground px-3 py-2 text-right min-w-32">Totals</th>
              </tr>
            </thead>
            <tbody>
              {visibleStaff.map(member => {
                const days = grid[member.id] ?? {};
                const t = totalsFor(member.id);
                return (
                  <tr key={member.id} className="border-b border-border last:border-0 hover:bg-muted/5">
                    <td className="px-3 py-2 sticky left-0 bg-background z-10 font-medium">{member.name}</td>
                    {dayHeaders.map(d => {
                      const date = new Date(year, month, d);
                      const key = ymd(date);
                      const r = days[key];
                      const cfg = r ? STATUS_CONFIG[r.status] : null;
                      return (
                        <td key={d} className="p-0.5 text-center">
                          <button
                            onClick={() => setMarkDrawer({ userId: member.id, date: key })}
                            className={cn(
                              "w-6 h-6 rounded font-medium text-[10px] inline-flex items-center justify-center hover:ring-2 hover:ring-primary/30",
                              cfg ? cfg.cell : "bg-muted/20 text-muted-foreground/40",
                            )}
                            title={r ? `${cfg?.label}${r.workedMinutes ? ` · ${(r.workedMinutes/60).toFixed(1)}h` : ""}${r.overtimeMinutes ? ` · OT ${(r.overtimeMinutes/60).toFixed(1)}h` : ""}` : "Click to mark"}
                          >
                            {cfg ? cfg.short : "·"}
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right whitespace-nowrap text-muted-foreground">
                      <span className="font-medium text-foreground">{t.present}P</span>
                      {t.late > 0 && <span className="text-amber-600 ml-1">{t.late}L</span>}
                      {t.absent > 0 && <span className="text-red-600 ml-1">{t.absent}A</span>}
                      {t.off > 0 && <span className="text-slate-500 ml-1">{t.off}W</span>}
                      <span className="ml-2 text-[10px]">· {(t.worked/60).toFixed(1)}h</span>
                      {t.overtime > 0 && <span className="ml-1 text-[10px] text-blue-600">OT {(t.overtime/60).toFixed(1)}h</span>}
                    </td>
                  </tr>
                );
              })}
              {visibleStaff.length === 0 && (
                <tr><td colSpan={daysInMonth + 2} className="text-center py-12 text-muted-foreground text-sm">No staff to display</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {markDrawer && (
        <MarkAttendanceDrawer
          staff={staff}
          initial={markDrawer}
          existing={grid[markDrawer.userId]?.[markDrawer.date] ?? null}
          onClose={() => setMarkDrawer(null)}
          onDelete={handleDelete}
        />
      )}
      {weeklyOffOpen && (
        <BulkWeeklyOffDialog
          staff={staff}
          defaultDate={todayKey}
          onClose={() => setWeeklyOffOpen(false)}
        />
      )}
    </div>
  );
}

function BulkWeeklyOffDialog({ staff, defaultDate, onClose }: {
  staff: StaffMember[];
  defaultDate: string;
  onClose: () => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const bulk = useBulkWeeklyOff();
  const { toast } = useToast();

  const toggle = (id: number) => {
    setSelected(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allSelected = staff.length > 0 && selected.size === staff.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(staff.map(s => s.id)));

  const submit = async () => {
    if (selected.size === 0) {
      toast({ title: "Pick at least one staff member", variant: "destructive" });
      return;
    }
    try {
      await bulk.mutateAsync({ userIds: Array.from(selected), date });
      toast({ title: `Marked weekly off for ${selected.size} staff` });
      onClose();
    } catch {
      toast({ title: "Bulk weekly off failed", variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-lg w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Bulk Weekly Off</h3>
          <button className="text-muted-foreground hover:text-foreground text-sm" onClick={onClose}>✕</button>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Date</label>
          <input
            type="date"
            className="w-full border border-input rounded-md px-3 py-1.5 text-sm bg-background"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Staff ({selected.size}/{staff.length})</label>
            <button className="text-xs text-primary hover:underline" onClick={toggleAll}>
              {allSelected ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto border border-border rounded-md divide-y divide-border">
            {staff.map(s => (
              <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/30">
                <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                <span>{s.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{s.role}</span>
              </label>
            ))}
            {staff.length === 0 && (
              <div className="text-xs text-muted-foreground p-3 text-center">No staff available</div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={bulk.isPending || selected.size === 0}>
            {bulk.isPending ? "Saving…" : `Mark ${selected.size || ""} Weekly Off`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MarkAttendanceDrawer({ staff, initial, existing, onClose, onDelete }: {
  staff: StaffMember[];
  initial: { userId: number; date: string };
  existing: AttendanceRecord | null;
  onClose: () => void;
  onDelete: (id: number) => void;
}) {
  const [userId, setUserId] = useState(initial.userId || staff[0]?.id || 0);
  const [date, setDate] = useState(initial.date);
  const [status, setStatus] = useState<AttendanceStatus>(existing?.status ?? "present");
  const [hours, setHours] = useState<string>(existing?.workedMinutes ? (existing.workedMinutes / 60).toFixed(1) : "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const markMutation = useMarkAttendance();
  const patchMutation = usePatchAttendance();
  const { toast } = useToast();

  const isEdit = !!existing;

  const handleSave = async () => {
    if (!userId || !date) return;
    try {
      const workedMinutes = hours ? Math.round(parseFloat(hours) * 60) : undefined;
      if (isEdit && existing) {
        await patchMutation.mutateAsync({ id: existing.id, status, notes: notes || undefined, workedMinutes });
      } else {
        await markMutation.mutateAsync({ userId, date, status, notes: notes || undefined, workedMinutes });
      }
      toast({ title: isEdit ? "Attendance updated" : "Attendance recorded" });
      onClose();
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{isEdit ? "Edit Attendance" : "Mark Attendance"}</h2>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <Label>Staff Member</Label>
            <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={userId} onChange={e => setUserId(Number(e.target.value))} disabled={isEdit}>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={isEdit} />
          </div>
          <div>
            <Label>Status</Label>
            <div className="grid grid-cols-3 gap-1.5 mt-1">
              {(Object.keys(STATUS_CONFIG) as AttendanceStatus[]).map(k => (
                <button
                  key={k}
                  onClick={() => setStatus(k)}
                  className={cn(
                    "text-xs px-2 py-1.5 rounded-md border font-medium transition-colors",
                    status === k ? STATUS_CONFIG[k].chip + " border-current" : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {STATUS_CONFIG[k].label}
                </button>
              ))}
            </div>
          </div>
          {(status === "present" || status === "late" || status === "half_day") && (
            <div>
              <Label>Hours worked (optional)</Label>
              <Input type="number" step="0.25" min="0" placeholder="e.g. 8" value={hours} onChange={e => setHours(e.target.value)} />
            </div>
          )}
          <div>
            <Label>Notes (optional)</Label>
            <Input placeholder="Reason / context" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div className="flex gap-2 pt-2">
            {isEdit && existing && (
              <Button variant="ghost" className="text-destructive" onClick={() => { onDelete(existing.id); onClose(); }}>
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={markMutation.isPending || patchMutation.isPending}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityTab() {
  const [filterAction, setFilterAction] = useState("");
  const [page, setPage] = useState(1);
  const { data: logs = [] } = useAuditLogs({ action: filterAction || undefined, page });
  const total = logs.length;

  const ACTION_COLORS: Record<string, string> = {
    create: "bg-green-100 text-green-700",
    update: "bg-blue-100 text-blue-700",
    delete: "bg-red-100 text-red-700",
    login: "bg-purple-100 text-purple-700",
    logout: "bg-gray-100 text-gray-600",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Filter by action…" value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(1); }} className="pl-9 h-8 w-52 text-sm" />
        </div>
        <span className="text-xs text-muted-foreground">{total} total events</span>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Action</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Entity</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5 hidden md:table-cell">Details</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Time</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log: AuditLog) => (
              <tr key={log.id} className="border-b border-border last:border-0 hover:bg-muted/10">
                <td className="px-4 py-3">
                  <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full capitalize", ACTION_COLORS[log.action] ?? "bg-muted text-muted-foreground")}>
                    {log.action}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div>
                    <p className="text-sm font-medium capitalize">{log.entity}</p>
                    {log.entityId && <p className="text-xs text-muted-foreground">#{log.entityId}</p>}
                  </div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <p className="text-xs text-muted-foreground truncate max-w-48">{log.details ?? "—"}</p>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(log.createdAt)}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={4} className="text-center py-12 text-muted-foreground text-sm">
                <Activity className="w-10 h-10 mx-auto mb-3 opacity-20" />
                No activity logs found
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {total > 50 && (
        <div className="flex items-center justify-between">
          <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-xs text-muted-foreground">Page {page} · {total} events</span>
          <Button size="sm" variant="outline" disabled={logs.length < 50} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}

function RolesTab() {
  const { data: roles = [] } = useRoles();
  const { data: permissions = [] } = usePermissions();
  const createRole = useCreateRole();
  const deleteRole = useDeleteRole();
  const addPerm = useAddRolePermission();
  const removePerm = useRemoveRolePermission();
  const { toast } = useToast();

  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const { data: selectedRole } = useRoleWithPermissions(selectedRoleId);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", description: "" });

  const grantedIds = new Set((selectedRole?.permissions ?? []).map((p: Permission) => p.id));

  const resourceGroups = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
    if (!acc[p.resource]) acc[p.resource] = [];
    acc[p.resource].push(p);
    return acc;
  }, {});

  const handleCreateRole = async () => {
    if (!createForm.name.trim()) return;
    const slug = createForm.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    try {
      const role = await createRole.mutateAsync({ name: createForm.name, slug, description: createForm.description || undefined });
      toast({ title: "Role created" });
      setSelectedRoleId(role.id);
      setShowCreate(false);
      setCreateForm({ name: "", description: "" });
    } catch {
      toast({ title: "Failed to create role", variant: "destructive" });
    }
  };

  const handleTogglePermission = async (permissionId: number) => {
    if (!selectedRoleId || selectedRole?.isSystem) return;
    try {
      if (grantedIds.has(permissionId)) {
        await removePerm.mutateAsync({ roleId: selectedRoleId, permissionId });
      } else {
        await addPerm.mutateAsync({ roleId: selectedRoleId, permissionId });
      }
    } catch {
      toast({ title: "Failed to update permission", variant: "destructive" });
    }
  };

  const handleDeleteRole = async (id: number) => {
    if (!confirm("Delete this role? This cannot be undone.")) return;
    try {
      await deleteRole.mutateAsync(id);
      toast({ title: "Role deleted" });
      if (selectedRoleId === id) setSelectedRoleId(null);
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="md:col-span-1">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Roles</h3>
          <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="w-3.5 h-3.5 mr-1" /> New Role</Button>
        </div>

        {showCreate && (
          <div className="bg-card border border-border rounded-xl p-4 mb-3 space-y-3">
            <div><Label>Role Name</Label><Input placeholder="e.g. Supervisor" value={createForm.name} onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label>Description</Label><Input placeholder="Optional description" value={createForm.description} onChange={e => setCreateForm(p => ({ ...p, description: e.target.value }))} /></div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreateRole} disabled={createRole.isPending}>Create</Button>
              <Button size="sm" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="space-y-1">
          {roles.map((role: Role) => (
            <div
              key={role.id}
              onClick={() => setSelectedRoleId(role.id === selectedRoleId ? null : role.id)}
              className={cn(
                "flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer border transition-colors",
                selectedRoleId === role.id ? "bg-primary/10 border-primary/30 text-primary" : "border-transparent hover:bg-muted/40 text-foreground"
              )}
            >
              <div>
                <p className="text-sm font-medium">{role.name}</p>
                {role.isSystem && <span className="text-[10px] text-muted-foreground uppercase tracking-wide">System role</span>}
                {role.description && !role.isSystem && <p className="text-xs text-muted-foreground">{role.description}</p>}
              </div>
              {!role.isSystem && (
                <button onClick={e => { e.stopPropagation(); handleDeleteRole(role.id); }} className="text-muted-foreground hover:text-destructive transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
          {roles.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">No roles found</p>}
        </div>
      </div>

      <div className="md:col-span-2">
        {selectedRole ? (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <Shield className="w-5 h-5 text-primary" />
              <div>
                <h3 className="text-sm font-semibold">{selectedRole.name} — Permissions</h3>
                {selectedRole.isSystem && <p className="text-xs text-amber-600">System roles cannot be modified</p>}
              </div>
            </div>
            <div className="space-y-5">
              {Object.entries(resourceGroups).map(([resource, perms]) => (
                <div key={resource}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 capitalize">{resource.replace(/_/g, " ")}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {perms.map((perm: Permission) => {
                      const granted = grantedIds.has(perm.id);
                      return (
                        <button
                          key={perm.id}
                          disabled={selectedRole.isSystem}
                          onClick={() => handleTogglePermission(perm.id)}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
                            granted ? "bg-green-50 border-green-200 text-green-800" : "bg-card border-border text-muted-foreground hover:bg-muted/40"
                          )}
                        >
                          <div className={cn("w-4 h-4 rounded flex items-center justify-center flex-shrink-0", granted ? "bg-green-500 text-white" : "border border-border bg-background")}>
                            {granted && <CheckCircle2 className="w-3 h-3" />}
                          </div>
                          <div>
                            <p className="text-xs font-medium capitalize">{perm.action.replace(/_/g, " ")}</p>
                            {perm.description && <p className="text-[10px] text-muted-foreground">{perm.description}</p>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {permissions.length === 0 && <p className="text-sm text-muted-foreground">No permissions defined</p>}
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Shield className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-sm">Select a role to view and edit its permissions</p>
          </div>
        )}
      </div>
    </div>
  );
}

function LeavesTab({ staff }: { staff: StaffMember[] }) {
  const { user } = useAuth();
  const isPrivileged = user?.isSuperAdmin || user?.role === "owner" || user?.role === "manager";
  const [section, setSection] = useState<"requests" | "balances" | "policies">("requests");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border">
        {([
          { id: "requests" as const, label: "Requests", Icon: Clock3 },
          { id: "balances" as const, label: "Balances", Icon: Activity },
          ...(isPrivileged ? [{ id: "policies" as const, label: "Policies", Icon: Shield }] : []),
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setSection(t.id)}
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium px-3 py-2 border-b-2 transition-colors",
              section === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <t.Icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>
      {section === "requests" && <LeaveRequestsSection staff={staff} isPrivileged={!!isPrivileged} />}
      {section === "balances" && <LeaveBalancesSection staff={staff} isPrivileged={!!isPrivileged} />}
      {section === "policies" && isPrivileged && <LeavePoliciesSection />}
    </div>
  );
}

function LeavePoliciesSection() {
  const { data: policies = [] } = useLeavePolicies();
  const create = useCreateLeavePolicy();
  const update = useUpdateLeavePolicy();
  const del = useDeleteLeavePolicy();
  const { toast } = useToast();
  const [form, setForm] = useState({ leaveType: "", label: "", isPaid: true, entitlementDays: 12, carryForwardMax: 0 });

  const handleCreate = async () => {
    if (!form.leaveType.trim() || !form.label.trim()) {
      toast({ title: "leaveType and label required", variant: "destructive" });
      return;
    }
    try {
      await create.mutateAsync({
        leaveType: form.leaveType.trim().toLowerCase(),
        label: form.label.trim(),
        isPaid: form.isPaid,
        entitlementDays: Number(form.entitlementDays) || 0,
        carryForwardMax: Number(form.carryForwardMax) || 0,
      });
      toast({ title: "Policy created" });
      setForm({ leaveType: "", label: "", isPaid: true, entitlementDays: 12, carryForwardMax: 0 });
    } catch (e) {
      toast({ title: (e as { message?: string }).message ?? "Failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-muted/30 border border-border rounded-xl p-4 grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
        <div><Label>Type key</Label><Input placeholder="paid / sick / unpaid" value={form.leaveType} onChange={e => setForm(p => ({ ...p, leaveType: e.target.value }))} /></div>
        <div><Label>Display label</Label><Input placeholder="Paid Leave" value={form.label} onChange={e => setForm(p => ({ ...p, label: e.target.value }))} /></div>
        <div><Label>Entitlement (days)</Label><Input type="number" min={0} value={form.entitlementDays} onChange={e => setForm(p => ({ ...p, entitlementDays: Number(e.target.value) }))} /></div>
        <div><Label>Carry forward max</Label><Input type="number" min={0} value={form.carryForwardMax} onChange={e => setForm(p => ({ ...p, carryForwardMax: Number(e.target.value) }))} /></div>
        <div className="flex items-center gap-2 pb-2">
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={form.isPaid} onChange={e => setForm(p => ({ ...p, isPaid: e.target.checked }))} /> Paid</label>
          <Button size="sm" onClick={handleCreate} disabled={create.isPending}>Add</Button>
        </div>
      </div>

      <div className="border border-border rounded-xl divide-y divide-border">
        {policies.length === 0 && <p className="text-sm text-muted-foreground p-6 text-center">No leave policies yet</p>}
        {policies.map(p => (
          <div key={p.id} className={cn("flex items-center justify-between gap-3 px-4 py-3", !p.isActive && "opacity-60")}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{p.label} <span className="text-xs text-muted-foreground">({p.leaveType})</span></p>
              <p className="text-xs text-muted-foreground">{p.entitlementDays} days/yr · carry-fwd {p.carryForwardMax} · {p.isPaid ? "Paid" : "Unpaid"}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => update.mutate({ id: p.id, isActive: !p.isActive })}>
                {p.isActive ? "Deactivate" : "Activate"}
              </Button>
              <button onClick={() => del.mutate(p.id)} className="text-muted-foreground hover:text-destructive p-1.5"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeaveBalancesSection({ staff, isPrivileged }: { staff: StaffMember[]; isPrivileged: boolean }) {
  const { user } = useAuth();
  const { data: policies = [] } = useLeavePolicies();
  const [selectedUserId, setSelectedUserId] = useState<number | null>(isPrivileged ? (staff[0]?.id ?? null) : (user?.id ?? null));
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: balances = [] } = useLeaveBalances(selectedUserId, year);
  const setBal = useSetLeaveBalance();
  const { toast } = useToast();

  const balByType = new Map(balances.map(b => [b.leaveType, b]));

  const handleSet = async (leaveType: string, opening: number) => {
    if (!selectedUserId) return;
    try {
      await setBal.mutateAsync({ userId: selectedUserId, year, leaveType, opening });
      toast({ title: "Opening balance saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {isPrivileged && (
          <div>
            <Label>Staff member</Label>
            <select
              className="mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background min-w-[200px]"
              value={selectedUserId ?? ""}
              onChange={e => setSelectedUserId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— pick —</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <Label>Year</Label>
          <Input type="number" className="w-28" value={year} onChange={e => setYear(Number(e.target.value) || year)} />
        </div>
      </div>

      {selectedUserId && policies.filter(p => p.isActive).length === 0 && (
        <p className="text-sm text-muted-foreground py-6 text-center">No active leave policies. Create policies first.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {policies.filter(p => p.isActive).map(p => {
          const bal = balByType.get(p.leaveType);
          const opening = Number(bal?.opening ?? p.entitlementDays);
          const used = Number(bal?.used ?? 0);
          const remaining = Math.max(0, opening - used);
          return (
            <div key={p.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">{p.label}</p>
                <span className={cn("text-[10px] px-2 py-0.5 rounded uppercase tracking-wide", p.isPaid ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700")}>
                  {p.isPaid ? "Paid" : "Unpaid"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center mb-3">
                <div><p className="text-xs text-muted-foreground">Opening</p><p className="text-lg font-bold">{opening}</p></div>
                <div><p className="text-xs text-muted-foreground">Used</p><p className="text-lg font-bold">{used}</p></div>
                <div><p className="text-xs text-muted-foreground">Remaining</p><p className="text-lg font-bold text-primary">{remaining}</p></div>
              </div>
              {isPrivileged && (
                <div className="flex gap-2 items-center">
                  <Input
                    type="number"
                    min={0}
                    defaultValue={opening}
                    onBlur={e => {
                      const v = Number(e.target.value);
                      if (!Number.isNaN(v) && v !== opening) void handleSet(p.leaveType, v);
                    }}
                    className="h-8 text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">Edit opening (saves on blur)</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LeaveRequestsSection({ staff, isPrivileged }: { staff: StaffMember[]; isPrivileged: boolean }) {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const { data: requests = [] } = useLeaveRequests(statusFilter ? { status: statusFilter } : undefined);
  const approve = useApproveLeaveRequest();
  const reject = useRejectLeaveRequest();
  const cancel = useCancelLeaveRequest();
  const { toast } = useToast();
  const { user } = useAuth();
  const staffById = new Map(staff.map(s => [s.id, s]));

  const handleApprove = async (id: number) => {
    const note = prompt("Optional note") ?? undefined;
    try {
      await approve.mutateAsync({ id, decisionNote: note });
      toast({ title: "Leave approved" });
    } catch (e) {
      toast({ title: (e as { message?: string }).message ?? "Approve failed", variant: "destructive" });
    }
  };
  const handleReject = async (id: number) => {
    const note = prompt("Reason for rejection") ?? "";
    try {
      await reject.mutateAsync({ id, decisionNote: note || undefined });
      toast({ title: "Leave rejected" });
    } catch {
      toast({ title: "Reject failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          {["", "pending", "approved", "rejected", "cancelled"].map(s => (
            <button
              key={s || "all"}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-3 py-1.5 text-xs rounded-md border",
                statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {s || "All"}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="w-3.5 h-3.5 mr-1" /> Request Leave</Button>
      </div>

      {showCreate && <CreateLeaveRequestForm staff={staff} isPrivileged={isPrivileged} currentUserId={user?.id ?? 0} onClose={() => setShowCreate(false)} />}

      <div className="border border-border rounded-xl divide-y divide-border">
        {requests.length === 0 && <p className="text-sm text-muted-foreground p-6 text-center">No leave requests</p>}
        {requests.map(r => {
          const name = staffById.get(r.userId)?.name ?? `User #${r.userId}`;
          const canDecide = isPrivileged && r.status === "pending";
          const canCancel = (isPrivileged || r.userId === (user?.id ?? -1)) && (r.status === "pending" || r.status === "approved");
          return (
            <div key={r.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium">{name}</p>
                  <span className="text-[10px] px-2 py-0.5 rounded uppercase bg-muted text-muted-foreground">{r.leaveType}</span>
                  <StatusPill status={r.status} />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatDate(r.fromDate)} → {formatDate(r.toDate)}
                  {r.halfDay && " · half-day"}
                  {" · "}{r.totalDays} day{Number(r.totalDays) === 1 ? "" : "s"}
                </p>
                {r.reason && <p className="text-xs text-muted-foreground mt-1 italic">"{r.reason}"</p>}
                {r.decisionNote && <p className="text-xs text-muted-foreground mt-1">Note: {r.decisionNote}</p>}
              </div>
              <div className="flex items-center gap-1.5">
                {canDecide && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => handleApprove(r.id)}><Check className="w-3.5 h-3.5 mr-1" />Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => handleReject(r.id)} className="text-destructive border-destructive/40"><Ban className="w-3.5 h-3.5 mr-1" />Reject</Button>
                  </>
                )}
                {canCancel && r.status !== "rejected" && (
                  <button
                    onClick={() => { if (confirm("Cancel this request?")) cancel.mutate(r.id); }}
                    className="text-muted-foreground hover:text-destructive p-1.5"
                    title="Cancel"
                  ><X className="w-4 h-4" /></button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    approved: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
    cancelled: "bg-gray-100 text-gray-600",
  };
  return <span className={cn("text-[10px] px-2 py-0.5 rounded uppercase tracking-wide font-medium", cfg[status] ?? "bg-muted text-muted-foreground")}>{status}</span>;
}

function CreateLeaveRequestForm({
  staff, isPrivileged, currentUserId, onClose,
}: { staff: StaffMember[]; isPrivileged: boolean; currentUserId: number; onClose: () => void }) {
  const { data: policies = [] } = useLeavePolicies();
  const create = useCreateLeaveRequest();
  const { toast } = useToast();
  const activePolicies = policies.filter(p => p.isActive);
  const [form, setForm] = useState({
    userId: currentUserId,
    leaveType: activePolicies[0]?.leaveType ?? "",
    fromDate: new Date().toISOString().slice(0, 10),
    toDate: new Date().toISOString().slice(0, 10),
    halfDay: false,
    reason: "",
  });
  useEffect(() => {
    if (!form.leaveType && activePolicies.length > 0) {
      setForm(p => ({ ...p, leaveType: activePolicies[0].leaveType }));
    }
  }, [activePolicies, form.leaveType]);

  const submit = async () => {
    if (!form.leaveType) { toast({ title: "Pick a leave type", variant: "destructive" }); return; }
    try {
      await create.mutateAsync({
        userId: isPrivileged ? form.userId : undefined,
        leaveType: form.leaveType,
        fromDate: form.fromDate,
        toDate: form.toDate,
        halfDay: form.halfDay,
        reason: form.reason || undefined,
      });
      toast({ title: "Leave request submitted" });
      onClose();
    } catch (e) {
      toast({ title: (e as { message?: string }).message ?? "Submit failed", variant: "destructive" });
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
      {isPrivileged && (
        <div className="md:col-span-2">
          <Label>For staff</Label>
          <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.userId} onChange={e => setForm(p => ({ ...p, userId: Number(e.target.value) }))}>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
      <div className={isPrivileged ? "md:col-span-1" : "md:col-span-2"}>
        <Label>Type</Label>
        <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.leaveType} onChange={e => setForm(p => ({ ...p, leaveType: e.target.value }))}>
          {activePolicies.map(p => <option key={p.leaveType} value={p.leaveType}>{p.label}</option>)}
        </select>
      </div>
      <div><Label>From</Label><Input type="date" value={form.fromDate} onChange={e => setForm(p => ({ ...p, fromDate: e.target.value, toDate: form.toDate < e.target.value ? e.target.value : form.toDate }))} /></div>
      <div><Label>To</Label><Input type="date" value={form.toDate} onChange={e => setForm(p => ({ ...p, toDate: e.target.value }))} disabled={form.halfDay} /></div>
      <div className="flex items-center gap-2 pb-2 text-xs">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.halfDay} onChange={e => setForm(p => ({ ...p, halfDay: e.target.checked, toDate: e.target.checked ? p.fromDate : p.toDate }))} /> Half day</label>
      </div>
      <div className="md:col-span-6"><Label>Reason</Label><Input placeholder="Optional" value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} /></div>
      <div className="md:col-span-6 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={create.isPending}>{create.isPending ? "Submitting…" : "Submit"}</Button>
      </div>
    </div>
  );
}

export default function StaffPage() {
  const [tab, setTab] = useState<TabType>("team");
  const [roleFilter, setRoleFilter] = useState<string | undefined>();
  const [showAdd, setShowAdd] = useState(false);
  const { data: staff = [] } = useStaff(roleFilter);
  const allStaff = useStaff().data ?? [];

  const tabs: { id: TabType; label: string; icon: typeof Users }[] = [
    { id: "team", label: "Team", icon: Users },
    { id: "shifts", label: "Shifts", icon: Calendar },
    { id: "attendance", label: "Attendance", icon: Clock },
    { id: "leaves", label: "Leaves", icon: CalendarOff },
    { id: "activity", label: "Activity Log", icon: Activity },
    { id: "roles", label: "Roles & Permissions", icon: Shield },
  ];

  return (
    <Layout>
      <PageHeader
        title="Staff Management"
        subtitle={`${allStaff.length} team members`}
        actions={
          tab === "team" ? (
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Staff
            </Button>
          ) : undefined
        }
      />

      <div className="px-6 pt-4 border-b border-border">
        <div className="flex gap-0">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
                tab === id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {tab === "team" && (
          <TeamTab
            roleFilter={roleFilter}
            setRoleFilter={setRoleFilter}
            staff={staff}
            showAdd={showAdd}
            setShowAdd={setShowAdd}
          />
        )}
        {tab === "shifts" && <ShiftsTab staff={allStaff} />}
        {tab === "attendance" && <AttendanceTab staff={allStaff} />}
        {tab === "leaves" && <LeavesTab staff={allStaff} />}
        {tab === "activity" && <ActivityTab />}
        {tab === "roles" && <RolesTab />}
      </div>
    </Layout>
  );
}
