import { useState, useMemo } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  useReservations, useCreateReservation, useUpdateReservation, useDeleteReservation,
  useFloorTables, useRestaurantInfo,
} from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus, X, CalendarDays, Clock, Users, Phone, Mail, Pencil, Trash2,
  CheckCircle2, UserCheck, XCircle, AlertCircle, Search, Link as LinkIcon, Copy, List, CalendarRange,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import type { Reservation, ReservationStatus, FloorTable, CreateReservationInput } from "@/lib/types";
import { format, parseISO, isSameDay, addDays, startOfDay } from "date-fns";

const STATUS_CONFIG: Record<ReservationStatus, { label: string; bg: string; text: string; dot: string }> = {
  pending:   { label: "Pending",   bg: "bg-yellow-100", text: "text-yellow-800", dot: "bg-yellow-500" },
  confirmed: { label: "Confirmed", bg: "bg-blue-100",   text: "text-blue-800",   dot: "bg-blue-500" },
  seated:    { label: "Seated",    bg: "bg-orange-100", text: "text-orange-800", dot: "bg-orange-500" },
  completed: { label: "Completed", bg: "bg-green-100",  text: "text-green-800",  dot: "bg-green-500" },
  cancelled: { label: "Cancelled", bg: "bg-gray-100",   text: "text-gray-600",   dot: "bg-gray-400" },
  no_show:   { label: "No-show",   bg: "bg-red-100",    text: "text-red-800",    dot: "bg-red-500" },
};

const STATUS_OPTIONS: ReservationStatus[] = ["pending", "confirmed", "seated", "completed", "cancelled", "no_show"];

const HOURS = Array.from({ length: 14 }, (_, i) => i + 9); // 9am - 10pm

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

function ReservationForm({
  reservation,
  defaultDate,
  tables,
  onClose,
  onSaved,
}: {
  reservation?: Reservation;
  defaultDate?: string;
  tables: FloorTable[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const create = useCreateReservation();
  const update = useUpdateReservation();
  const { toast } = useToast();

  const [form, setForm] = useState<CreateReservationInput>({
    guestName: reservation?.guestName ?? "",
    guestPhone: reservation?.guestPhone ?? "",
    guestEmail: reservation?.guestEmail ?? "",
    partySize: reservation?.partySize ?? 2,
    scheduledAt: reservation ? toLocalInput(reservation.scheduledAt) : (defaultDate ? `${defaultDate}T19:00` : ""),
    durationMinutes: reservation?.durationMinutes ?? 90,
    tableId: reservation?.tableId ?? undefined,
    notes: reservation?.notes ?? "",
    status: reservation?.status ?? "confirmed",
  });

  const handleSave = async () => {
    if (!form.guestName.trim()) { toast({ title: "Guest name required", variant: "destructive" }); return; }
    if (!form.scheduledAt) { toast({ title: "Date and time required", variant: "destructive" }); return; }
    if (form.partySize < 1) { toast({ title: "Party size must be at least 1", variant: "destructive" }); return; }
    try {
      if (reservation) {
        await update.mutateAsync({ id: reservation.id, ...form });
        toast({ title: "Reservation updated" });
      } else {
        await create.mutateAsync(form);
        toast({ title: "Reservation created" });
      }
      onSaved();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{reservation ? "Edit Reservation" : "New Reservation"}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <Label>Guest name *</Label>
            <Input value={form.guestName} onChange={e => setForm(f => ({ ...f, guestName: e.target.value }))} placeholder="Full name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Phone</Label>
              <Input value={form.guestPhone ?? ""} onChange={e => setForm(f => ({ ...f, guestPhone: e.target.value }))} placeholder="+91 ..." />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.guestEmail ?? ""} onChange={e => setForm(f => ({ ...f, guestEmail: e.target.value }))} placeholder="optional" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Party size *</Label>
              <Input type="number" min="1" value={form.partySize} onChange={e => setForm(f => ({ ...f, partySize: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>Duration (min)</Label>
              <Input type="number" min="15" step="15" value={form.durationMinutes ?? 90} onChange={e => setForm(f => ({ ...f, durationMinutes: Number(e.target.value) }))} />
            </div>
          </div>
          <div>
            <Label>Date & time *</Label>
            <Input type="datetime-local" value={form.scheduledAt} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} />
          </div>
          <div>
            <Label>Table</Label>
            <select className="w-full h-10 text-sm border border-input rounded-md px-3 bg-background"
              value={form.tableId ?? ""}
              onChange={e => setForm(f => ({ ...f, tableId: e.target.value ? Number(e.target.value) : undefined }))}>
              <option value="">Any table</option>
              {tables.map(t => (
                <option key={t.id} value={t.id}>Table {t.tableNumber} · seats {t.capacity}</option>
              ))}
            </select>
          </div>
          {reservation && (
            <div>
              <Label>Status</Label>
              <select className="w-full h-10 text-sm border border-input rounded-md px-3 bg-background"
                value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as ReservationStatus }))}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
              </select>
            </div>
          )}
          <div>
            <Label>Notes</Label>
            <Input value={form.notes ?? ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Special requests, allergies..." />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={handleSave} disabled={create.isPending || update.isPending}>
              {reservation ? "Save Changes" : "Create"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReservationRow({
  r,
  table,
  canDelete,
  onEdit,
  onAction,
  onDelete,
}: {
  r: Reservation;
  table?: FloorTable;
  canDelete: boolean;
  onEdit: (r: Reservation) => void;
  onAction: (r: Reservation, status: ReservationStatus) => void;
  onDelete: (id: number) => void;
}) {
  const cfg = STATUS_CONFIG[r.status];
  const dt = parseISO(r.scheduledAt);
  const showActions: ReservationStatus[] = (() => {
    if (r.status === "pending") return ["confirmed", "cancelled"];
    if (r.status === "confirmed") return ["seated", "cancelled", "no_show"];
    if (r.status === "seated") return ["completed", "cancelled"];
    return [];
  })();

  return (
    <div className="border border-border rounded-xl p-3 bg-card hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-foreground truncate">{r.guestName}</p>
            <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full", cfg.bg, cfg.text)}>
              <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />{cfg.label}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
            <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{format(dt, "MMM d, h:mm a")}</span>
            <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />{r.partySize} guests</span>
            {table && <span className="inline-flex items-center gap-1">· Table {table.tableNumber}</span>}
            {!r.tableId && <span className="italic">· any table</span>}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
            {r.guestPhone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{r.guestPhone}</span>}
            {r.guestEmail && <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" />{r.guestEmail}</span>}
          </div>
          {r.notes && <p className="text-xs italic text-muted-foreground mt-1">"{r.notes}"</p>}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button onClick={() => onEdit(r)} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
          {canDelete && (
            <button onClick={() => onDelete(r.id)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
          )}
        </div>
      </div>
      {showActions.length > 0 && (
        <div className="flex gap-1.5 mt-3 pt-3 border-t border-border/60 flex-wrap">
          {showActions.includes("confirmed") && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onAction(r, "confirmed")}>
              <CheckCircle2 className="w-3 h-3" /> Confirm
            </Button>
          )}
          {showActions.includes("seated") && (
            <Button size="sm" className="h-7 text-xs gap-1" onClick={() => onAction(r, "seated")}>
              <UserCheck className="w-3 h-3" /> Seat
            </Button>
          )}
          {showActions.includes("completed") && (
            <Button size="sm" className="h-7 text-xs gap-1" onClick={() => onAction(r, "completed")}>
              <CheckCircle2 className="w-3 h-3" /> Complete
            </Button>
          )}
          {showActions.includes("no_show") && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onAction(r, "no_show")}>
              <AlertCircle className="w-3 h-3" /> No-show
            </Button>
          )}
          {showActions.includes("cancelled") && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive" onClick={() => onAction(r, "cancelled")}>
              <XCircle className="w-3 h-3" /> Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function DayView({
  reservations,
  tables,
  date,
  onEdit,
}: {
  reservations: Reservation[];
  tables: FloorTable[];
  date: string;
  onEdit: (r: Reservation) => void;
}) {
  const dayResvs = reservations.filter(r => isSameDay(parseISO(r.scheduledAt), parseISO(`${date}T00:00`)) && r.status !== "cancelled");

  return (
    <div className="bg-card border border-border rounded-xl p-4 overflow-x-auto">
      <p className="text-sm font-semibold mb-3">{format(parseISO(`${date}T00:00`), "EEEE, MMMM d")}</p>
      <div className="space-y-1">
        {HOURS.map(h => {
          const inHour = dayResvs.filter(r => parseISO(r.scheduledAt).getHours() === h);
          return (
            <div key={h} className="flex gap-3 border-b border-border/40 py-2 last:border-0">
              <div className="text-xs font-medium text-muted-foreground w-16 shrink-0 pt-1">
                {h === 12 ? "12:00 PM" : h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`}
              </div>
              <div className="flex-1 space-y-1.5">
                {inHour.length === 0 && <div className="text-xs text-muted-foreground/50 italic pt-1">—</div>}
                {inHour.map(r => {
                  const cfg = STATUS_CONFIG[r.status];
                  const tbl = tables.find(t => t.id === r.tableId);
                  return (
                    <button key={r.id} onClick={() => onEdit(r)} className={cn("w-full text-left rounded-lg px-3 py-2 border transition-shadow hover:shadow-sm", cfg.bg, "border-current/20")}>
                      <div className="flex items-center gap-2 text-xs">
                        <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
                        <span className="font-semibold">{format(parseISO(r.scheduledAt), "h:mm a")}</span>
                        <span className="font-medium">{r.guestName}</span>
                        <span className="text-muted-foreground">· {r.partySize}p</span>
                        {tbl && <span className="text-muted-foreground">· T{tbl.tableNumber}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ReservationsPage() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [date, setDate] = useState<string>(today);
  const [statusFilter, setStatusFilter] = useState<ReservationStatus | "all">("all");
  const [view, setView] = useState<"list" | "day">("list");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Reservation | undefined>();

  const { user } = useAuth();
  const canDelete = !!user && ["owner", "manager", "super_admin"].includes(user.role);
  const { data: tables = [] } = useFloorTables();
  const { data: restaurantInfo } = useRestaurantInfo();
  const { data: reservations = [], refetch } = useReservations({
    date: view === "day" ? date : undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
  });
  const update = useUpdateReservation();
  const del = useDeleteReservation();
  const { toast } = useToast();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (reservations as Reservation[]).filter(r => {
      if (q && !r.guestName.toLowerCase().includes(q) && !(r.guestPhone ?? "").toLowerCase().includes(q)) return false;
      if (view === "list" && date) {
        if (!isSameDay(parseISO(r.scheduledAt), parseISO(`${date}T00:00`))) return false;
      }
      return true;
    });
  }, [reservations, search, date, view]);

  const grouped = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    for (const r of filtered) {
      const key = format(parseISO(r.scheduledAt), "yyyy-MM-dd");
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { pending: 0, confirmed: 0, seated: 0, completed: 0, cancelled: 0, no_show: 0 };
    for (const r of (reservations as Reservation[])) {
      const today = format(new Date(), "yyyy-MM-dd");
      if (format(parseISO(r.scheduledAt), "yyyy-MM-dd") === today) c[r.status] = (c[r.status] ?? 0) + 1;
    }
    return c;
  }, [reservations]);

  const handleAction = async (r: Reservation, status: ReservationStatus) => {
    try {
      await update.mutateAsync({ id: r.id, status });
      toast({ title: `Marked as ${STATUS_CONFIG[status].label}` });
      void refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: "Update failed", description: msg, variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete this reservation?")) return;
    try {
      await del.mutateAsync(id);
      toast({ title: "Reservation deleted" });
      void refetch();
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  const slug = restaurantInfo?.slug;
  const bookingUrl = slug ? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/book/${slug}` : "";

  return (
    <Layout>
      <PageHeader
        title="Reservations"
        subtitle={`Today: ${counts.pending} pending · ${counts.confirmed} confirmed · ${counts.seated} seated · ${counts.completed} completed`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {bookingUrl && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                navigator.clipboard.writeText(bookingUrl).then(() => toast({ title: "Booking link copied" }));
              }}>
                <Copy className="w-3.5 h-3.5" /> Copy public link
              </Button>
            )}
            {bookingUrl && (
              <a href={bookingUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                <LinkIcon className="w-3 h-3" /> Open
              </a>
            )}
            <Button onClick={() => { setEditing(undefined); setShowForm(true); }}>
              <Plus className="w-4 h-4 mr-1.5" /> New Reservation
            </Button>
          </div>
        }
      />

      <div className="p-6 flex-1 overflow-auto">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button onClick={() => setView("list")}
              className={cn("px-3 py-1.5 text-sm flex items-center gap-1.5", view === "list" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>
              <List className="w-3.5 h-3.5" /> List
            </button>
            <button onClick={() => setView("day")}
              className={cn("px-3 py-1.5 text-sm flex items-center gap-1.5 border-l border-border", view === "day" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>
              <CalendarRange className="w-3.5 h-3.5" /> Day View
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setDate(format(addDays(parseISO(`${date}T00:00`), -1), "yyyy-MM-dd"))}>‹</Button>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 w-40" />
            <Button size="sm" variant="outline" onClick={() => setDate(format(addDays(parseISO(`${date}T00:00`), 1), "yyyy-MM-dd"))}>›</Button>
            <Button size="sm" variant="outline" onClick={() => setDate(today)}>Today</Button>
          </div>

          <select
            className="h-9 text-sm border border-input rounded-md px-2 bg-background"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as ReservationStatus | "all")}
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
          </select>

          <div className="relative ml-auto">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search name or phone…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 w-56 h-9" />
          </div>
        </div>

        {view === "day" ? (
          <DayView reservations={reservations as Reservation[]} tables={tables as FloorTable[]} date={date} onEdit={r => { setEditing(r); setShowForm(true); }} />
        ) : (
          <div className="space-y-5">
            {grouped.length === 0 && (
              <div className="bg-card border border-dashed border-border rounded-2xl p-12 text-center text-muted-foreground">
                <CalendarDays className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No reservations</p>
                <p className="text-xs mt-1">Adjust filters or create a new booking</p>
              </div>
            )}
            {grouped.map(([day, items]) => (
              <div key={day}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{format(parseISO(`${day}T00:00`), "EEEE, MMMM d")} · {items.length}</p>
                <div className="space-y-2">
                  {items.map(r => (
                    <ReservationRow
                      key={r.id}
                      r={r}
                      table={(tables as FloorTable[]).find(t => t.id === r.tableId)}
                      canDelete={canDelete}
                      onEdit={r => { setEditing(r); setShowForm(true); }}
                      onAction={handleAction}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <ReservationForm
          reservation={editing}
          defaultDate={date}
          tables={tables as FloorTable[]}
          onClose={() => { setShowForm(false); setEditing(undefined); }}
          onSaved={() => void refetch()}
        />
      )}
    </Layout>
  );
}
