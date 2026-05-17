import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CalendarDays, Send, Copy, TrendingUp, Repeat2, Plus, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  useStaff,
  useShifts,
  useStaffShifts,
  useBulkCreateStaffShifts,
  useDeleteStaffShift,
  useStaffAvailability,
  useReplaceStaffAvailability,
  useShiftTrades,
  useCreateShiftTrade,
  useShiftTradePeerRespond,
  useShiftTradeDecide,
  useShiftTradeCancel,
  usePublishSchedule,
  useSchedulePublications,
  useLaborSettings,
  useUpdateLaborSettings,
  useLaborForecast,
  useLaborReport,
  useLaborViolations,
  useCopyScheduleWeek,
} from "@/lib/hooks";
import type { ShiftTradeRequest, StaffAvailabilitySlot } from "@/lib/types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const day = out.getDay();
  out.setDate(out.getDate() - day);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function fmtISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────
// Hook for deleting a staff shift (one-off; not previously declared).
// ─────────────────────────────────────────────────────────────────────────
// (Defined in hooks.ts already as useDeleteStaffShift? Check via import path.)
// If absent, fallback in-component below.

interface CellAssignment {
  staffShiftId: number;
  userId: number;
  shiftId: number;
  userName: string;
  shiftName: string;
}

export default function StaffSchedulingPage() {
  const { user } = useAuth();
  const role = user?.role ?? "";
  const isManager = ["owner", "manager", "super_admin"].includes(role);
  return (
    <Layout>
      <PageHeader
        title="Staff Scheduling"
        description="Weekly scheduling grid, availability, shift trades, and labor forecast."
      />
      <div className="p-4 md:p-6 max-w-screen-2xl mx-auto">
        <Tabs defaultValue={isManager ? "schedule" : "availability"}>
          <TabsList className="flex flex-wrap">
            {isManager && <TabsTrigger value="schedule">Schedule</TabsTrigger>}
            <TabsTrigger value="availability">My availability</TabsTrigger>
            <TabsTrigger value="trades">Shift trades</TabsTrigger>
            {isManager && <TabsTrigger value="forecast">Forecast</TabsTrigger>}
            {isManager && <TabsTrigger value="report">Labor report</TabsTrigger>}
            {isManager && <TabsTrigger value="settings">Settings</TabsTrigger>}
          </TabsList>
          {isManager && (
            <TabsContent value="schedule" className="mt-4">
              <ScheduleGrid />
            </TabsContent>
          )}
          <TabsContent value="availability" className="mt-4">
            <AvailabilityEditor />
          </TabsContent>
          <TabsContent value="trades" className="mt-4">
            <ShiftTradesPanel isManager={isManager} />
          </TabsContent>
          {isManager && (
            <TabsContent value="forecast" className="mt-4">
              <ForecastPanel />
            </TabsContent>
          )}
          {isManager && (
            <TabsContent value="report" className="mt-4">
              <LaborReportPanel />
            </TabsContent>
          )}
          {isManager && (
            <TabsContent value="settings" className="mt-4">
              <LaborSettingsPanel />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </Layout>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Schedule Grid (role rows × day columns, drag to assign)
// ─────────────────────────────────────────────────────────────────────────

function ScheduleGrid() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"week" | "month">("week");
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });
  const [filterRole, setFilterRole] = useState<string>("all");
  const [pickerCell, setPickerCell] = useState<{ userId: number; date: Date } | null>(null);
  const [monthDay, setMonthDay] = useState<Date | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Month grid: 6 weeks starting from the Sunday on/before the 1st.
  const monthGridStart = startOfWeek(monthAnchor);
  const monthDays = Array.from({ length: 42 }, (_, i) => addDays(monthGridStart, i));
  const monthEnd = addDays(monthGridStart, 42);

  const { data: staff = [] } = useStaff();
  const { data: shifts = [] } = useShifts();
  const { data: allAssignments = [] } = useStaffShifts();
  const { data: violations } = useLaborViolations();
  const bulk = useBulkCreateStaffShifts();
  const delShift = useDeleteStaffShift();
  const copyWeek = useCopyScheduleWeek();

  const filteredStaff = useMemo(
    () => staff.filter(s => s.isActive !== false).filter(s => filterRole === "all" || s.role === filterRole),
    [staff, filterRole],
  );

  const rangeStart = viewMode === "week" ? weekStart : monthGridStart;
  const rangeEnd = viewMode === "week" ? addDays(weekEnd, 1) : monthEnd;

  const cells = useMemo(() => {
    const map = new Map<string, CellAssignment[]>();
    for (const a of allAssignments) {
      const d = new Date(a.date);
      if (d < rangeStart || d >= rangeEnd) continue;
      const key = `${a.userId}:${fmtISODate(d)}`;
      const arr = map.get(key) ?? [];
      const u = staff.find(s => s.id === a.userId);
      const sh = shifts.find(s => s.id === a.shiftId);
      arr.push({
        staffShiftId: a.id,
        userId: a.userId,
        shiftId: a.shiftId,
        userName: u?.name ?? `#${a.userId}`,
        shiftName: sh?.name ?? `Shift #${a.shiftId}`,
      });
      map.set(key, arr);
    }
    return map;
  }, [allAssignments, staff, shifts, rangeStart, rangeEnd]);

  // Per-day aggregation for the month view (count + unique staff).
  const monthCells = useMemo(() => {
    const map = new Map<string, { count: number; staffIds: Set<number> }>();
    for (const a of allAssignments) {
      const d = new Date(a.date);
      if (d < monthGridStart || d >= monthEnd) continue;
      const key = fmtISODate(d);
      const slot = map.get(key) ?? { count: 0, staffIds: new Set<number>() };
      slot.count += 1;
      slot.staffIds.add(a.userId);
      map.set(key, slot);
    }
    return map;
  }, [allAssignments, monthGridStart, monthEnd]);

  const onDragStart = (e: React.DragEvent, shiftId: number) => {
    e.dataTransfer.setData("text/shift-id", String(shiftId));
    e.dataTransfer.effectAllowed = "copy";
  };
  const onDropCell = async (e: React.DragEvent, userId: number, date: Date) => {
    e.preventDefault();
    const shiftId = Number(e.dataTransfer.getData("text/shift-id"));
    if (!shiftId) return;
    try {
      await bulk.mutateAsync({ assignments: [{ userId, shiftId, date: date.toISOString() }] });
      toast({ description: "Shift assigned." });
    } catch (err: unknown) {
      toast({ description: (err as Error).message, variant: "destructive" });
    }
  };

  const onRemove = async (id: number) => {
    try {
      await delShift.mutateAsync(id);
      toast({ description: "Removed." });
    } catch (err: unknown) {
      toast({ description: (err as Error).message, variant: "destructive" });
    }
  };

  const onCopyPrev = async () => {
    try {
      const prev = addDays(weekStart, -7);
      const r = await copyWeek.mutateAsync({ fromWeekStart: prev.toISOString(), toWeekStart: weekStart.toISOString() });
      toast({ description: `Copied ${r.count} assignments from previous week.` });
    } catch (err: unknown) {
      toast({ description: (err as Error).message, variant: "destructive" });
    }
  };

  const roles = Array.from(new Set(staff.map(s => s.role))).filter(Boolean);

  return (
    <div className="space-y-4">
      {violations && violations.violations.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-900/10">
          <CardContent className="p-3 flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-amber-800 dark:text-amber-300">Break / overtime reminders</div>
              <ul className="mt-1 text-amber-900/90 dark:text-amber-200/90 space-y-1">
                {violations.violations.slice(0, 5).map(v => (
                  <li key={v.id}>{v.userName ?? `User #${v.userId}`} — {v.issues.join(", ")} (currently {Math.round(v.currentMinutes / 60 * 10) / 10}h)</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded border bg-muted/30">
          <Button size="sm" variant={viewMode === "week" ? "default" : "ghost"} className="rounded-r-none h-8" onClick={() => setViewMode("week")}>Week</Button>
          <Button size="sm" variant={viewMode === "month" ? "default" : "ghost"} className="rounded-l-none h-8" onClick={() => setViewMode("month")}>Month</Button>
        </div>
        {viewMode === "week" ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, -7))}>← Prev week</Button>
            <Button size="sm" variant="outline" onClick={() => setWeekStart(startOfWeek(new Date()))}>This week</Button>
            <Button size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next week →</Button>
            <div className="text-sm font-medium ml-2">
              <CalendarDays className="inline h-4 w-4 mr-1" />
              {fmtISODate(weekStart)} – {fmtISODate(weekEnd)}
            </div>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => { const d = new Date(monthAnchor); d.setMonth(d.getMonth() - 1); setMonthAnchor(d); }}>← Prev month</Button>
            <Button size="sm" variant="outline" onClick={() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); setMonthAnchor(d); }}>This month</Button>
            <Button size="sm" variant="outline" onClick={() => { const d = new Date(monthAnchor); d.setMonth(d.getMonth() + 1); setMonthAnchor(d); }}>Next month →</Button>
            <div className="text-sm font-medium ml-2">
              <CalendarDays className="inline h-4 w-4 mr-1" />
              {monthAnchor.toLocaleString(undefined, { month: "long", year: "numeric" })}
            </div>
          </>
        )}
        <div className="ml-auto flex flex-wrap gap-2 items-center">
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Role" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {roles.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          {viewMode === "week" && (
            <Button size="sm" variant="outline" onClick={onCopyPrev} disabled={copyWeek.isPending}><Copy className="h-4 w-4 mr-1" />Copy prev week</Button>
          )}
          <Button size="sm" onClick={() => setPublishOpen(true)}><Send className="h-4 w-4 mr-1" />Publish & notify</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="text-xs text-muted-foreground mb-2">Drag a shift onto a cell to assign. Click an assignment to remove.</div>
          <div className="flex flex-wrap gap-2">
            {shifts.filter(s => s.isActive).map(s => (
              <div
                key={s.id}
                draggable
                onDragStart={(e) => onDragStart(e, s.id)}
                className="px-3 py-1.5 rounded border bg-primary/10 text-primary text-xs font-medium cursor-grab hover:bg-primary/20"
                title={`${s.startTime} – ${s.endTime}`}
              >
                {s.name} · {s.startTime}-{s.endTime}
              </div>
            ))}
            {shifts.length === 0 && (
              <div className="text-xs text-muted-foreground">No shifts defined yet. Create shifts under Staff → Shifts.</div>
            )}
          </div>
        </CardContent>
      </Card>

      {viewMode === "month" && (
        <Card>
          <CardContent className="p-0">
            <div className="grid grid-cols-7 text-xs text-muted-foreground border-b">
              {DAY_LABELS.map(d => <div key={d} className="p-2 font-medium">{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {monthDays.map((d, i) => {
                const inMonth = d.getMonth() === monthAnchor.getMonth();
                const slot = monthCells.get(fmtISODate(d));
                const isToday = fmtISODate(d) === fmtISODate(new Date());
                return (
                  <button
                    key={i}
                    onClick={() => setMonthDay(d)}
                    className={`text-left p-2 border-b border-r min-h-[80px] hover:bg-accent/20 ${inMonth ? "" : "bg-muted/20 text-muted-foreground"} ${isToday ? "ring-2 ring-primary ring-inset" : ""}`}
                  >
                    <div className="text-xs font-medium">{d.getDate()}</div>
                    {slot && (
                      <div className="mt-1 text-xs">
                        <Badge variant="secondary" className="text-[10px]">{slot.count} shifts</Badge>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{slot.staffIds.size} staff</div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {viewMode === "week" && (
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="bg-muted/40">
                <th className="text-left p-2 sticky left-0 bg-muted/40 z-10 min-w-[180px]">Staff</th>
                {days.map((d, i) => (
                  <th key={i} className="p-2 text-left min-w-[140px]">
                    <div className="text-xs text-muted-foreground">{DAY_LABELS[d.getDay()]}</div>
                    <div className="font-medium">{d.getDate()}/{d.getMonth() + 1}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredStaff.map(s => (
                <tr key={s.id} className="border-t">
                  <td className="p-2 sticky left-0 bg-background border-r">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.role}</div>
                  </td>
                  {days.map((d, i) => {
                    const key = `${s.id}:${fmtISODate(d)}`;
                    const list = cells.get(key) ?? [];
                    return (
                      <td
                        key={i}
                        className="p-1 align-top border-r min-h-[60px] hover:bg-accent/20"
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
                        onDrop={(e) => onDropCell(e, s.id, d)}
                        onDoubleClick={() => setPickerCell({ userId: s.id, date: d })}
                      >
                        <div className="space-y-1 min-h-[44px]">
                          {list.map(a => (
                            <div
                              key={a.staffShiftId}
                              className="text-xs bg-primary/10 text-primary rounded px-1.5 py-1 flex items-center gap-1 group"
                            >
                              <span className="flex-1 truncate">{a.shiftName}</span>
                              <button onClick={() => onRemove(a.staffShiftId)} className="opacity-0 group-hover:opacity-100">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {filteredStaff.length === 0 && (
                <tr><td colSpan={8} className="p-4 text-center text-muted-foreground text-sm">No staff match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      )}

      {monthDay && (
        <Dialog open onOpenChange={(o) => !o && setMonthDay(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{monthDay.toDateString()}</DialogTitle></DialogHeader>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {filteredStaff.map(s => {
                const list = cells.get(`${s.id}:${fmtISODate(monthDay)}`) ?? [];
                return (
                  <div key={s.id} className="flex items-center gap-2 border rounded p-2">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.role}</div>
                    </div>
                    <div className="flex flex-wrap gap-1 max-w-[60%]">
                      {list.map(a => (
                        <div key={a.staffShiftId} className="text-xs bg-primary/10 text-primary rounded px-2 py-1 flex items-center gap-1">
                          {a.shiftName}
                          <button onClick={() => onRemove(a.staffShiftId)}><X className="h-3 w-3" /></button>
                        </div>
                      ))}
                      <Button size="sm" variant="ghost" onClick={() => { setPickerCell({ userId: s.id, date: monthDay }); }}><Plus className="h-3 w-3" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {pickerCell && (
        <ShiftPickerDialog
          shifts={shifts}
          onClose={() => setPickerCell(null)}
          onPick={async (shiftId) => {
            await bulk.mutateAsync({ assignments: [{ userId: pickerCell.userId, shiftId, date: pickerCell.date.toISOString() }] });
            setPickerCell(null);
          }}
        />
      )}

      {publishOpen && (
        <PublishDialog weekStart={weekStart} weekEnd={weekEnd} onClose={() => setPublishOpen(false)} />
      )}

      <PublicationHistory />
    </div>
  );
}

function ShiftPickerDialog({ shifts, onClose, onPick }: { shifts: { id: number; name: string; startTime: string; endTime: string }[]; onClose: () => void; onPick: (id: number) => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Assign shift</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {shifts.map(s => (
            <Button key={s.id} variant="outline" className="w-full justify-start" onClick={() => onPick(s.id)}>
              {s.name} · {s.startTime}–{s.endTime}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PublishDialog({ weekStart, weekEnd, onClose }: { weekStart: Date; weekEnd: Date; onClose: () => void }) {
  const { toast } = useToast();
  const [push, setPush] = useState(true);
  const [sms, setSms] = useState(false);
  const [whatsapp, setWhatsapp] = useState(false);
  const [note, setNote] = useState("");
  const m = usePublishSchedule();
  const submit = async () => {
    try {
      await m.mutateAsync({
        weekStart: weekStart.toISOString(),
        weekEnd: addDays(weekEnd, 1).toISOString(),
        note: note || undefined,
        channels: { push, sms, whatsapp },
      });
      toast({ description: "Schedule published. Notifications dispatched." });
      onClose();
    } catch (err: unknown) {
      toast({ description: (err as Error).message, variant: "destructive" });
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Publish week & notify staff</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            {fmtISODate(weekStart)} – {fmtISODate(weekEnd)}
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={push} onCheckedChange={(v) => setPush(!!v)} /> In-app push (default ON)</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={sms} onCheckedChange={(v) => setSms(!!v)} /> SMS</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={whatsapp} onCheckedChange={(v) => setWhatsapp(!!v)} /> WhatsApp</label>
          </div>
          <div>
            <Label className="text-xs">Optional note (sent to staff)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please double-check Friday's prep list." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={m.isPending}><Send className="h-4 w-4 mr-1" />Publish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PublicationHistory() {
  const { data = [] } = useSchedulePublications();
  if (data.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Recent publications</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-1 text-sm">
          {data.slice(0, 8).map(p => (
            <div key={p.id} className="flex items-center justify-between border-b py-1">
              <div>
                <span className="font-medium">{p.weekStart.slice(0, 10)} → {p.weekEnd.slice(0, 10)}</span>
                <span className="ml-2 text-xs text-muted-foreground">{p.assignmentCount} assignments</span>
              </div>
              <div className="flex gap-1">
                {p.channels.push && <Badge variant="outline">push</Badge>}
                {p.channels.sms && <Badge variant="outline">sms</Badge>}
                {p.channels.whatsapp && <Badge variant="outline">whatsapp</Badge>}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Availability editor
// ─────────────────────────────────────────────────────────────────────────

interface AvailDraft { dayOfWeek: number; startTime: string; endTime: string; isAvailable: boolean; note: string }

function AvailabilityEditor() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isManager = ["owner", "manager", "super_admin"].includes(user?.role ?? "");
  const { data: staff = [] } = useStaff();
  const [targetUserId, setTargetUserId] = useState<number | undefined>(user?.id ?? undefined);
  const { data = [], refetch } = useStaffAvailability(isManager ? targetUserId : undefined);
  const replace = useReplaceStaffAvailability();
  const [draft, setDraft] = useState<AvailDraft[]>([]);

  // Sync draft when data changes (the query data identity is stable across
  // renders, so this only fires on actual data updates).
  useEffect(() => {
    if (!Array.isArray(data)) return;
    setDraft(
      data.map((s: StaffAvailabilitySlot) => ({
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        isAvailable: s.isAvailable,
        note: s.note ?? "",
      })),
    );
  }, [data]);

  const addRow = () => setDraft([...draft, { dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isAvailable: true, note: "" }]);
  const updateRow = (i: number, patch: Partial<AvailDraft>) => setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const removeRow = (i: number) => setDraft(draft.filter((_, idx) => idx !== i));

  const save = async () => {
    try {
      await replace.mutateAsync({
        userId: isManager ? targetUserId : undefined,
        slots: draft.map(d => ({
          dayOfWeek: d.dayOfWeek,
          startTime: d.startTime,
          endTime: d.endTime,
          isAvailable: d.isAvailable,
          note: d.note || null,
        })),
      });
      toast({ description: "Availability saved." });
      refetch();
    } catch (err: unknown) {
      toast({ description: (err as Error).message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Weekly availability</CardTitle>
        <div className="text-xs text-muted-foreground">Submit your available (or unavailable) hours per weekday. Managers use this when building the schedule.</div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isManager && (
          <div className="flex items-center gap-2">
            <Label className="text-xs">Editing for</Label>
            <Select value={targetUserId ? String(targetUserId) : ""} onValueChange={(v) => setTargetUserId(Number(v))}>
              <SelectTrigger className="h-9 w-64"><SelectValue placeholder="Pick staff" /></SelectTrigger>
              <SelectContent>
                {staff.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.role})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-2">
          {draft.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 border rounded p-2">
              <Select value={String(r.dayOfWeek)} onValueChange={(v) => updateRow(i, { dayOfWeek: Number(v) })}>
                <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DAY_LABELS.map((d, idx) => <SelectItem key={idx} value={String(idx)}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input className="h-8 w-28" type="time" value={r.startTime} onChange={(e) => updateRow(i, { startTime: e.target.value })} />
              <span className="text-xs text-muted-foreground">to</span>
              <Input className="h-8 w-28" type="time" value={r.endTime} onChange={(e) => updateRow(i, { endTime: e.target.value })} />
              <label className="flex items-center gap-1 text-xs">
                <Switch checked={r.isAvailable} onCheckedChange={(v) => updateRow(i, { isAvailable: v })} />
                {r.isAvailable ? "Available" : "Unavailable"}
              </label>
              <Input className="h-8 flex-1 min-w-[140px]" placeholder="Note (optional)" value={r.note} onChange={(e) => updateRow(i, { note: e.target.value })} />
              <Button variant="ghost" size="sm" onClick={() => removeRow(i)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          {draft.length === 0 && <div className="text-xs text-muted-foreground">No slots yet.</div>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-4 w-4 mr-1" />Add slot</Button>
          <Button size="sm" onClick={save} disabled={replace.isPending}>Save availability</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Shift trades
// ─────────────────────────────────────────────────────────────────────────

function ShiftTradesPanel({ isManager }: { isManager: boolean }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [status, setStatus] = useState<string>("pending");
  const { data: trades = [] } = useShiftTrades(status === "all" ? undefined : status);
  const { data: staff = [] } = useStaff();
  const { data: myShifts = [] } = useStaffShifts(isManager ? undefined : user?.id);
  const { data: shifts = [] } = useShifts();

  const create = useCreateShiftTrade();
  const peer = useShiftTradePeerRespond();
  const decide = useShiftTradeDecide();
  const cancel = useShiftTradeCancel();

  const [newOpen, setNewOpen] = useState(false);

  const userName = (id: number | null) => id == null ? "—" : (staff.find(s => s.id === id)?.name ?? `#${id}`);
  const shiftLabel = (staffShiftId: number) => {
    const ss = myShifts.find(s => s.id === staffShiftId);
    if (!ss) return `Shift #${staffShiftId}`;
    const sh = shifts.find(s => s.id === ss.shiftId);
    return `${sh?.name ?? "Shift"} · ${new Date(ss.date).toDateString().slice(0, 10)}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="accepted_peer">Accepted by peer</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => setNewOpen(true)}><Repeat2 className="h-4 w-4 mr-1" />New trade request</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left p-2">From → To</th>
                <th className="text-left p-2">Shift</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t: ShiftTradeRequest) => (
                <tr key={t.id} className="border-t">
                  <td className="p-2">{userName(t.fromUserId)} → {userName(t.toUserId)}</td>
                  <td className="p-2">{shiftLabel(t.staffShiftId)}</td>
                  <td className="p-2">{t.tradeType}</td>
                  <td className="p-2"><Badge variant="outline">{t.status}</Badge></td>
                  <td className="p-2 space-x-1">
                    {t.toUserId === user?.id && t.status === "pending" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => peer.mutate({ id: t.id, accept: true })}>Accept</Button>
                        <Button size="sm" variant="outline" onClick={() => peer.mutate({ id: t.id, accept: false })}>Decline</Button>
                      </>
                    )}
                    {isManager && (t.status === "pending" || t.status === "accepted_peer") && (
                      <>
                        <Button size="sm" onClick={() => decide.mutate({ id: t.id, decision: "approve" })}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: t.id, decision: "reject" })}>Reject</Button>
                      </>
                    )}
                    {t.fromUserId === user?.id && (t.status === "pending" || t.status === "accepted_peer") && (
                      <Button size="sm" variant="ghost" onClick={() => cancel.mutate(t.id)}>Cancel</Button>
                    )}
                  </td>
                </tr>
              ))}
              {trades.length === 0 && (
                <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No trade requests.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {newOpen && (
        <NewTradeDialog
          myShifts={myShifts}
          staff={staff.filter(s => s.id !== user?.id)}
          shifts={shifts}
          onClose={() => setNewOpen(false)}
          onSubmit={async (data) => {
            try {
              await create.mutateAsync(data);
              toast({ description: "Trade request submitted." });
              setNewOpen(false);
            } catch (err: unknown) {
              toast({ description: (err as Error).message, variant: "destructive" });
            }
          }}
        />
      )}
    </div>
  );
}

function NewTradeDialog({
  myShifts, staff, shifts, onClose, onSubmit,
}: {
  myShifts: import("@/lib/types").StaffShift[];
  staff: import("@/lib/types").StaffMember[];
  shifts: import("@/lib/types").Shift[];
  onClose: () => void;
  onSubmit: (data: { staffShiftId: number; toUserId?: number; reason?: string }) => void;
}) {
  const [staffShiftId, setStaffShiftId] = useState<number | undefined>();
  const [toUserId, setToUserId] = useState<number | undefined>();
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New shift trade</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Your shift to trade</Label>
            <Select value={staffShiftId ? String(staffShiftId) : ""} onValueChange={(v) => setStaffShiftId(Number(v))}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Pick a shift" /></SelectTrigger>
              <SelectContent>
                {myShifts.map(s => {
                  const sh = shifts.find(x => x.id === s.shiftId);
                  return <SelectItem key={s.id} value={String(s.id)}>{sh?.name ?? "Shift"} · {new Date(s.date).toDateString().slice(0, 10)}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Offer to (optional)</Label>
            <Select value={toUserId ? String(toUserId) : ""} onValueChange={(v) => setToUserId(Number(v))}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Any teammate" /></SelectTrigger>
              <SelectContent>
                {staff.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.role})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Doctor appointment" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => staffShiftId && onSubmit({ staffShiftId, toUserId, reason: reason || undefined })} disabled={!staffShiftId}>Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Forecast panel
// ─────────────────────────────────────────────────────────────────────────

function ForecastPanel() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const { data, isLoading } = useLaborForecast(weekStart.toISOString());

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, -7))}>← Prev</Button>
        <Button size="sm" variant="outline" onClick={() => setWeekStart(startOfWeek(new Date()))}>This week</Button>
        <Button size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next →</Button>
        <div className="text-sm font-medium ml-2">{fmtISODate(weekStart)}</div>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {data && (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" />Suggested headcount per hour</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="text-xs w-full border-separate border-spacing-0">
                <thead>
                  <tr className="bg-muted/40">
                    <th className="p-1 text-left">Hour</th>
                    {DAY_LABELS.map(d => <th key={d} className="p-1 text-left">{d}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 24 }, (_, h) => h).map(h => {
                    const hasAny = data.slots.some(s => s.hour === h);
                    if (!hasAny) return null;
                    return (
                      <tr key={h} className="border-t">
                        <td className="p-1 font-medium">{String(h).padStart(2, "0")}:00</td>
                        {DAY_LABELS.map((_, dow) => {
                          const s = data.slots.find(x => x.dow === dow && x.hour === h);
                          if (!s) return <td key={dow} className="p-1 text-muted-foreground">—</td>;
                          const bg = s.status === "under" ? "bg-red-100 text-red-800" : s.status === "over" ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-800";
                          return (
                            <td key={dow} className={`p-1 ${bg}`}>
                              <div className="font-medium">{s.scheduledHeadcount} / {s.suggestedHeadcount}</div>
                              <div className="text-[10px] opacity-70">₹{s.avgSales.toFixed(0)}</div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
          {data.alerts.length > 0 && (
            <Card className="border-amber-300 bg-amber-50 dark:bg-amber-900/10">
              <CardHeader className="pb-1"><CardTitle className="text-sm">Over / under-staffed alerts</CardTitle></CardHeader>
              <CardContent className="text-xs">
                <ul className="space-y-1">
                  {data.alerts.slice(0, 12).map((a, i) => (
                    <li key={i}>
                      {DAY_LABELS[a.dow]} {String(a.hour).padStart(2, "0")}:00 — <Badge variant={a.kind === "under" ? "destructive" : "secondary"}>{a.kind}</Badge> suggested {a.suggested}, scheduled {a.scheduled}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Labor cost % vs sales report
// ─────────────────────────────────────────────────────────────────────────

function LaborReportPanel() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monthAgo = new Date(today); monthAgo.setDate(monthAgo.getDate() - 30);
  const [from, setFrom] = useState<string>(fmtISODate(monthAgo));
  const [to, setTo] = useState<string>(fmtISODate(today));
  const { data, isLoading } = useLaborReport(from, to);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div><Label className="text-xs">From</Label><Input type="date" className="h-9" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label className="text-xs">To</Label><Input type="date" className="h-9" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Total sales</div><div className="text-xl font-bold">₹{data.totals.sales.toLocaleString()}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Labor cost</div><div className="text-xl font-bold">₹{data.totals.laborCost.toLocaleString()}</div></CardContent></Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground">Labor % (target {data.targetLaborPct}%)</div>
                <div className={`text-xl font-bold ${data.totals.laborPct > data.targetLaborPct ? "text-red-600" : "text-emerald-600"}`}>{data.totals.laborPct.toFixed(2)}%</div>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="text-sm w-full">
                <thead className="bg-muted/40">
                  <tr><th className="text-left p-2">Day</th><th className="text-right p-2">Sales</th><th className="text-right p-2">Labor</th><th className="text-right p-2">Labor %</th><th className="text-left p-2"></th></tr>
                </thead>
                <tbody>
                  {data.series.map(d => (
                    <tr key={d.day} className="border-t">
                      <td className="p-2">{d.day}</td>
                      <td className="p-2 text-right">₹{d.sales.toLocaleString()}</td>
                      <td className="p-2 text-right">₹{d.laborCost.toLocaleString()}</td>
                      <td className={`p-2 text-right ${d.overTarget ? "text-red-600 font-medium" : ""}`}>{d.laborPct.toFixed(2)}%</td>
                      <td className="p-2">{d.overTarget && <Badge variant="destructive">over target</Badge>}</td>
                    </tr>
                  ))}
                  {data.series.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No data in this range.</td></tr>}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Settings panel (labor target, break/overtime rules)
// ─────────────────────────────────────────────────────────────────────────

function LaborSettingsPanel() {
  const { toast } = useToast();
  const { data: s } = useLaborSettings();
  const update = useUpdateLaborSettings();
  const [form, setForm] = useState<Record<string, string | number>>({});
  useEffect(() => {
    if (!s) return;
    setForm({
      targetLaborPct: s.targetLaborPct,
      defaultHourlyCost: s.defaultHourlyCost,
      salesPerLaborHour: s.salesPerLaborHour,
      breakMinutesPerShift: s.breakMinutesPerShift,
      breakAfterMinutes: s.breakAfterMinutes,
      overtimeAfterMinutesPerDay: s.overtimeAfterMinutesPerDay,
      overtimeAfterMinutesPerWeek: s.overtimeAfterMinutesPerWeek,
    });
  }, [s]);
  const save = async () => {
    try {
      await update.mutateAsync({
        targetLaborPct: String(form.targetLaborPct ?? "25"),
        defaultHourlyCost: String(form.defaultHourlyCost ?? "0"),
        salesPerLaborHour: String(form.salesPerLaborHour ?? "1000"),
        breakMinutesPerShift: Number(form.breakMinutesPerShift ?? 30),
        breakAfterMinutes: Number(form.breakAfterMinutes ?? 300),
        overtimeAfterMinutesPerDay: Number(form.overtimeAfterMinutesPerDay ?? 540),
        overtimeAfterMinutesPerWeek: Number(form.overtimeAfterMinutesPerWeek ?? 2700),
      });
      toast({ description: "Saved." });
    } catch (err: unknown) {
      toast({ description: (err as Error).message, variant: "destructive" });
    }
  };
  if (!s) return <div className="text-sm text-muted-foreground">Loading…</div>;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Labor cost & rules</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[
          { k: "targetLaborPct", label: "Target labor % of sales", help: "Used by the report to flag over-target days." },
          { k: "defaultHourlyCost", label: "Default hourly cost (₹)", help: "Used when a staff member has no salary set." },
          { k: "salesPerLaborHour", label: "Sales per labor-hour (₹)", help: "Used by the forecast to convert sales → suggested headcount." },
          { k: "breakMinutesPerShift", label: "Break minutes per shift" },
          { k: "breakAfterMinutes", label: "Break due after (minutes)" },
          { k: "overtimeAfterMinutesPerDay", label: "Overtime after (minutes/day)" },
          { k: "overtimeAfterMinutesPerWeek", label: "Overtime after (minutes/week)" },
        ].map(f => (
          <div key={f.k}>
            <Label className="text-xs">{f.label}</Label>
            <Input className="h-9" value={String(form[f.k] ?? "")} onChange={(e) => setForm({ ...form, [f.k]: e.target.value })} />
            {f.help && <div className="text-[11px] text-muted-foreground mt-0.5">{f.help}</div>}
          </div>
        ))}
        <div className="md:col-span-2">
          <Button onClick={save} disabled={update.isPending}>Save settings</Button>
        </div>
      </CardContent>
    </Card>
  );
}
