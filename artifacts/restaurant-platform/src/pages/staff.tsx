import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  useStaff, useCreateUser, useUpdateUser, useDeleteUser,
  useShifts, useCreateShift, useDeleteShift,
  useStaffShifts, useCreateStaffShift,
  useAttendance, useClockIn, useClockOut,
  useAuditLogs,
} from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus, User, Phone, Mail, Calendar, Clock, Activity,
  Users, LogIn, LogOut, Search, Trash2, X, ChevronDown, ChevronUp,
  Shield, CheckCircle2, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { StaffMember, Shift, StaffShift, AttendanceRecord, AuditLog } from "@/lib/types";

const ROLE_CONFIG: Record<string, { label: string; color: string }> = {
  owner: { label: "Owner", color: "bg-purple-100 text-purple-700" },
  manager: { label: "Manager", color: "bg-blue-100 text-blue-700" },
  waiter: { label: "Waiter", color: "bg-green-100 text-green-700" },
  kitchen: { label: "Kitchen", color: "bg-orange-100 text-orange-700" },
  cashier: { label: "Cashier", color: "bg-yellow-100 text-yellow-700" },
};

const ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS: Record<string, string> = { mon: "M", tue: "T", wed: "W", thu: "T", fri: "F", sat: "S", sun: "S" };
const DAY_FULL: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

type TabType = "team" | "shifts" | "attendance" | "activity";

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
  const { toast } = useToast();

  const [form, setForm] = useState({ name: "", email: "", phone: "", role: "waiter", passwordHash: "Welcome@123" });
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const roles = ["owner", "manager", "waiter", "kitchen", "cashier"];
  const byRole = (role: string) => staff.filter((s: StaffMember) => s.role === role).length;

  const handleAdd = async () => {
    if (!form.name || !form.email) return;
    try {
      await createUser.mutateAsync({ ...form, restaurantId: 1, tenantId: 1 });
      toast({ title: "Staff member added!" });
      setShowAdd(false);
      setForm({ name: "", email: "", phone: "", role: "waiter", passwordHash: "Welcome@123" });
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
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", roleConfig.color)}>{roleConfig.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("text-xs font-medium flex items-center gap-1", member.isActive ? "text-green-600" : "text-red-500")}>
                        {member.isActive ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {member.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
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
                      <td colSpan={5} className="px-4 py-3">
                        <div className="flex items-center gap-6 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1.5"><Mail className="w-3 h-3" />{member.email}</div>
                          {member.phone && <div className="flex items-center gap-1.5"><Phone className="w-3 h-3" />{member.phone}</div>}
                          <div className="flex items-center gap-1.5"><Shield className="w-3 h-3" />Role: {roleConfig.label}</div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {staff.length === 0 && (
              <tr><td colSpan={5} className="text-center py-16 text-muted-foreground">
                <User className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">No staff found</p>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

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
                  {Object.entries(ROLE_CONFIG).map(([r, c]) => <option key={r} value={r}>{c.label}</option>)}
                </select>
              </div>
              <div><Label>Default Password</Label><Input value={form.passwordHash} onChange={e => setForm(p => ({ ...p, passwordHash: e.target.value }))} /></div>
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

  const [showAdd, setShowAdd] = useState(false);
  const [shiftForm, setShiftForm] = useState({ name: "", startTime: "09:00", endTime: "17:00", days: [] as string[] });
  const [assignForm, setAssignForm] = useState({ userId: "", shiftId: "", date: "" });
  const [showAssign, setShowAssign] = useState(false);

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
      await createStaffShift.mutateAsync({ userId: Number(assignForm.userId), shiftId: Number(assignForm.shiftId), date: assignForm.date });
      toast({ title: "Staff assigned to shift" });
      setShowAssign(false);
      setAssignForm({ userId: "", shiftId: "", date: "" });
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
              <div>
                <Label>Date</Label>
                <Input type="date" value={assignForm.date} onChange={e => setAssignForm(p => ({ ...p, date: e.target.value }))} />
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

function AttendanceTab({ staff }: { staff: StaffMember[] }) {
  const [filterUserId, setFilterUserId] = useState<number | undefined>();
  const { data: attendance = [] } = useAttendance(filterUserId);
  const clockIn = useClockIn();
  const clockOut = useClockOut();
  const { toast } = useToast();

  const [clockInUserId, setClockInUserId] = useState("");

  const handleClockIn = async () => {
    if (!clockInUserId) return;
    try {
      await clockIn.mutateAsync({ userId: Number(clockInUserId) });
      toast({ title: "Clock-in recorded" });
      setClockInUserId("");
    } catch {
      toast({ title: "Clock-in failed", variant: "destructive" });
    }
  };

  const handleClockOut = async (record: AttendanceRecord) => {
    try {
      await clockOut.mutateAsync({ id: record.id });
      toast({ title: "Clock-out recorded" });
    } catch {
      toast({ title: "Clock-out failed", variant: "destructive" });
    }
  };

  const openRecords = attendance.filter((r: AttendanceRecord) => !r.clockOut);
  const closedRecords = attendance.filter((r: AttendanceRecord) => !!r.clockOut);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <h4 className="text-sm font-semibold mb-3">Clock In</h4>
          <div className="flex gap-2">
            <select className="flex-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={clockInUserId} onChange={e => setClockInUserId(e.target.value)}>
              <option value="">Select staff member</option>
              {staff.filter((s: StaffMember) => s.isActive).map((s: StaffMember) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Button onClick={handleClockIn} disabled={!clockInUserId || clockIn.isPending}>
              <LogIn className="w-4 h-4 mr-1.5" /> Clock In
            </Button>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h4 className="text-sm font-semibold mb-3">Filter Records</h4>
          <select className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background" value={filterUserId ?? ""} onChange={e => setFilterUserId(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">All Staff</option>
            {staff.map((s: StaffMember) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
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
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleClockOut(record)} disabled={clockOut.isPending}>
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
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Attendance History</h4>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Staff</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Clock In</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5 hidden sm:table-cell">Clock Out</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Hours</th>
              </tr>
            </thead>
            <tbody>
              {closedRecords.map((record: AttendanceRecord) => {
                const member = staff.find((s: StaffMember) => s.id === record.userId);
                return (
                  <tr key={record.id} className="border-b border-border last:border-0 hover:bg-muted/10">
                    <td className="px-4 py-3 text-sm font-medium">{member?.name ?? `User #${record.userId}`}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{formatDateTime(record.clockIn)}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground hidden sm:table-cell">{record.clockOut ? formatDateTime(record.clockOut) : "—"}</td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-foreground">{record.totalHours ? `${parseFloat(record.totalHours).toFixed(1)}h` : "—"}</span>
                    </td>
                  </tr>
                );
              })}
              {closedRecords.length === 0 && (
                <tr><td colSpan={4} className="text-center py-12 text-muted-foreground text-sm">No attendance records yet</td></tr>
              )}
            </tbody>
          </table>
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
    { id: "activity", label: "Activity Log", icon: Activity },
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
        {tab === "activity" && <ActivityTab />}
      </div>
    </Layout>
  );
}
