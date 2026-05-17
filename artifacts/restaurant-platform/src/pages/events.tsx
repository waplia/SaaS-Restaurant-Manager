import { useState, useMemo } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  useEvents, useEventDetail, useCreateEvent, useUpdateEvent, useDeleteEvent,
  useEventStatusTransition, useConvertEventToInvoice,
  useCreateEventItem, useDeleteEventItem,
  useCreateEventPayment, useUpdateEventPayment, useDeleteEventPayment,
  useCreateEventStaff, useDeleteEventStaff,
  useCreateEventVendor, useDeleteEventVendor,
  useCreateEventChecklistItem, useToggleEventChecklistItem, useDeleteEventChecklistItem,
  useEventCalendar, useRestaurantId, useRestaurantInfo,
} from "@/lib/hooks";
import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus, X, CalendarDays, Clock, Users, MapPin, Pencil, Trash2,
  CheckCircle2, XCircle, FileText, Receipt, List, CalendarRange, AlertCircle,
  PartyPopper, Briefcase, ChefHat, Phone, Mail, IndianRupee, Square, CheckSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import type {
  EventBooking, EventBookingStatus, EventBookingType, EventBookingDetail,
  CreateEventBookingInput, EventQuotationData,
} from "@/lib/types";
import { printEventQuotation } from "@/lib/printOrder";
import { format, parseISO, addDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameDay, isSameMonth } from "date-fns";

const STATUS_CONFIG: Record<EventBookingStatus, { label: string; bg: string; text: string; dot: string }> = {
  quote:       { label: "Quote",       bg: "bg-yellow-100", text: "text-yellow-800", dot: "bg-yellow-500" },
  confirmed:   { label: "Confirmed",   bg: "bg-blue-100",   text: "text-blue-800",   dot: "bg-blue-500" },
  in_progress: { label: "In progress", bg: "bg-orange-100", text: "text-orange-800", dot: "bg-orange-500" },
  completed:   { label: "Completed",   bg: "bg-green-100",  text: "text-green-800",  dot: "bg-green-500" },
  cancelled:   { label: "Cancelled",   bg: "bg-gray-100",   text: "text-gray-600",   dot: "bg-gray-400" },
};

const TYPE_CONFIG: Record<EventBookingType, { label: string; icon: typeof PartyPopper }> = {
  event:    { label: "Event",    icon: PartyPopper },
  banquet:  { label: "Banquet",  icon: Briefcase },
  catering: { label: "Catering", icon: ChefHat },
};

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

function money(s: string | number | null | undefined): string {
  const n = Number(s ?? 0);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─────────────────────────── Booking form (create / edit) ───────────────────────────

function BookingForm({
  booking,
  onClose,
  onSaved,
}: {
  booking?: EventBooking;
  onClose: () => void;
  onSaved: () => void;
}) {
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const { toast } = useToast();

  const [form, setForm] = useState<CreateEventBookingInput>({
    type: booking?.type ?? "event",
    title: booking?.title ?? "",
    customerName: booking?.customerName ?? "",
    customerPhone: booking?.customerPhone ?? "",
    customerEmail: booking?.customerEmail ?? "",
    eventDate: booking ? toLocalInput(booking.eventDate) : "",
    durationMinutes: booking?.durationMinutes ?? 180,
    venue: booking?.venue ?? "",
    guestCount: booking?.guestCount ?? 0,
    packageDetails: booking?.packageDetails ?? "",
    notes: booking?.notes ?? "",
    taxAmount: booking?.taxAmount ?? "0.00",
    discountAmount: booking?.discountAmount ?? "0.00",
  });

  const handleSave = async () => {
    if (!form.title.trim()) return void toast({ title: "Title required", variant: "destructive" });
    if (!form.customerName.trim()) return void toast({ title: "Customer name required", variant: "destructive" });
    if (!form.eventDate) return void toast({ title: "Event date required", variant: "destructive" });
    try {
      if (booking) {
        await update.mutateAsync({ id: booking.id, ...form });
        toast({ title: "Booking updated" });
      } else {
        await create.mutateAsync(form as unknown as Record<string, unknown>);
        toast({ title: "Booking created" });
      }
      onSaved();
      onClose();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{booking ? "Edit Booking" : "New Booking"}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type *</Label>
              <select className="w-full h-10 text-sm border border-input rounded-md px-3 bg-background"
                value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as EventBookingType }))}>
                {(["event", "banquet", "catering"] as EventBookingType[]).map((t) => (
                  <option key={t} value={t}>{TYPE_CONFIG[t].label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Guests</Label>
              <Input type="number" min="0" value={form.guestCount ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, guestCount: Number(e.target.value) }))} />
            </div>
          </div>
          <div>
            <Label>Title *</Label>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Sharma wedding reception" />
          </div>
          <div>
            <Label>Customer name *</Label>
            <Input value={form.customerName} onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Phone</Label>
              <Input value={form.customerPhone ?? ""} onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))} placeholder="+91 ..." />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.customerEmail ?? ""} onChange={(e) => setForm((f) => ({ ...f, customerEmail: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Event date & time *</Label>
              <Input type="datetime-local" value={form.eventDate} onChange={(e) => setForm((f) => ({ ...f, eventDate: e.target.value }))} />
            </div>
            <div>
              <Label>Duration (min)</Label>
              <Input type="number" min="30" step="30" value={form.durationMinutes ?? 180}
                onChange={(e) => setForm((f) => ({ ...f, durationMinutes: Number(e.target.value) }))} />
            </div>
          </div>
          <div>
            <Label>Venue / Hall</Label>
            <Input value={form.venue ?? ""} onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))} placeholder="e.g. Main hall, Off-site at customer location" />
          </div>
          <div>
            <Label>Package details</Label>
            <textarea className="w-full text-sm border border-input rounded-md px-3 py-2 bg-background min-h-[60px]"
              value={form.packageDetails ?? ""} onChange={(e) => setForm((f) => ({ ...f, packageDetails: e.target.value }))}
              placeholder="Menu pack, decor theme, beverages..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tax amount (₹)</Label>
              <Input type="number" step="0.01" min="0" value={form.taxAmount ?? "0.00"}
                onChange={(e) => setForm((f) => ({ ...f, taxAmount: e.target.value }))} />
            </div>
            <div>
              <Label>Discount (₹)</Label>
              <Input type="number" step="0.01" min="0" value={form.discountAmount ?? "0.00"}
                onChange={(e) => setForm((f) => ({ ...f, discountAmount: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <textarea className="w-full text-sm border border-input rounded-md px-3 py-2 bg-background min-h-[50px]"
              value={form.notes ?? ""} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Allergies, special requests..." />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={handleSave} disabled={create.isPending || update.isPending}>
              {booking ? "Save Changes" : "Create Quote"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Booking detail drawer ───────────────────────────

function BookingDetail({ id, canEdit, onClose, onEdit }: { id: number; canEdit: boolean; onClose: () => void; onEdit: () => void }) {
  const RESTAURANT_ID = useRestaurantId();
  const { toast } = useToast();
  const detail = useEventDetail(id);
  const { data: restaurant } = useRestaurantInfo();

  const transition = useEventStatusTransition();
  const convert = useConvertEventToInvoice();
  const del = useDeleteEvent();

  const addItem = useCreateEventItem();
  const removeItem = useDeleteEventItem();
  const addPayment = useCreateEventPayment();
  const updatePayment = useUpdateEventPayment();
  const removePayment = useDeleteEventPayment();
  const addStaff = useCreateEventStaff();
  const removeStaff = useDeleteEventStaff();
  const addVendor = useCreateEventVendor();
  const removeVendor = useDeleteEventVendor();
  const addCheck = useCreateEventChecklistItem();
  const toggleCheck = useToggleEventChecklistItem();
  const removeCheck = useDeleteEventChecklistItem();

  const [tab, setTab] = useState<"overview" | "items" | "payments" | "staff" | "vendors" | "checklist">("overview");
  const [itemForm, setItemForm] = useState({ kind: "package", name: "", quantity: 1, unitPrice: 0 });
  const [payForm, setPayForm] = useState({ label: "", dueDate: "", amount: 0 });
  const [staffForm, setStaffForm] = useState({ staffName: "", role: "server", notes: "" });
  const [vendorForm, setVendorForm] = useState({ category: "decor", vendorName: "", contactInfo: "", cost: 0 });
  const [checkForm, setCheckForm] = useState({ label: "" });

  if (detail.isLoading) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-card border border-border rounded-2xl p-8 text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full">
          <div className="flex items-start gap-2 text-sm text-destructive mb-3">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Couldn’t load booking</p>
              <p className="text-xs text-muted-foreground mt-1">
                {detail.error instanceof Error ? detail.error.message : "The booking details are unavailable."}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
            <Button size="sm" onClick={() => detail.refetch()}>Retry</Button>
          </div>
        </div>
      </div>
    );
  }

  const d = detail.data as unknown as EventBookingDetail;
  const b = d.booking;
  const cfg = STATUS_CONFIG[b.status];
  const TypeIcon = TYPE_CONFIG[b.type].icon;

  const nextActions: { status: EventBookingStatus; label: string; variant?: "destructive" | "outline" }[] = (() => {
    if (b.status === "quote") return [
      { status: "confirmed", label: "Confirm" },
      { status: "cancelled", label: "Cancel", variant: "destructive" },
    ];
    if (b.status === "confirmed") return [
      { status: "in_progress", label: "Mark in progress" },
      { status: "cancelled", label: "Cancel", variant: "destructive" },
    ];
    if (b.status === "in_progress") return [
      { status: "completed", label: "Mark completed" },
    ];
    return [];
  })();

  const handlePrint = async (kind: "Quotation" | "Invoice") => {
    try {
      const data = await apiGet<EventQuotationData>(`/restaurants/${RESTAURANT_ID}/events/${b.id}/quotation`);
      printEventQuotation({
        documentKind: kind,
        bookingNumber: data.booking.bookingNumber,
        type: data.booking.type,
        title: data.booking.title,
        customerName: data.booking.customerName,
        customerPhone: data.booking.customerPhone,
        customerEmail: data.booking.customerEmail,
        eventDate: data.booking.eventDate,
        durationMinutes: data.booking.durationMinutes,
        venue: data.booking.venue,
        guestCount: data.booking.guestCount,
        packageDetails: data.booking.packageDetails,
        notes: data.booking.notes,
        items: data.items.map((i) => ({
          kind: i.kind,
          name: i.name,
          description: i.description,
          quantity: i.quantity,
          unitPrice: Number(i.unitPrice),
          lineTotal: Number(i.lineTotal),
        })),
        schedule: data.schedule.map((m) => ({
          label: m.label,
          dueDate: m.dueDate,
          amount: Number(m.amount),
          status: m.status,
        })),
        subtotal: Number(data.booking.subtotal),
        taxAmount: Number(data.booking.taxAmount),
        discountAmount: Number(data.booking.discountAmount),
        totalAmount: Number(data.booking.totalAmount),
        advancePaid: Number(data.advancePaid),
        restaurant: data.restaurant
          ? { name: data.restaurant.name, logoUrl: data.restaurant.logoUrl, address: data.restaurant.address, phone: data.restaurant.phone }
          : restaurant
          ? { name: restaurant.name, logoUrl: restaurant.logoUrl, address: restaurant.address, phone: restaurant.phone }
          : undefined,
      });
    } catch (err) {
      toast({ title: "Print failed", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    }
  };

  const handleConvert = async () => {
    try {
      const r = await convert.mutateAsync(b.id);
      toast({ title: "Converted to invoice", description: `Order ${r.orderNumber} created` });
    } catch (err) {
      toast({ title: "Convert failed", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete booking ${b.bookingNumber}? This cannot be undone.`)) return;
    try {
      await del.mutateAsync(b.id);
      toast({ title: "Booking deleted" });
      onClose();
    } catch (err) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-3xl shadow-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <TypeIcon className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-lg font-semibold truncate">{b.title}</h2>
              <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full", cfg.bg, cfg.text)}>
                <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />{cfg.label}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {b.bookingNumber} · {format(parseISO(b.eventDate), "EEE, MMM d yyyy h:mm a")} · {b.guestCount} guests
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-5 overflow-x-auto">
          {(["overview", "items", "payments", "staff", "vendors", "checklist"] as const).map((t) => (
            <button key={t}
              className={cn("px-3 py-2 text-sm border-b-2 -mb-px capitalize whitespace-nowrap", tab === t ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
              onClick={() => setTab(t)}>
              {t}
              {t === "items" && d.items.length > 0 && ` (${d.items.length})`}
              {t === "payments" && d.schedule.length > 0 && ` (${d.schedule.length})`}
              {t === "staff" && d.staff.length > 0 && ` (${d.staff.length})`}
              {t === "vendors" && d.vendors.length > 0 && ` (${d.vendors.length})`}
              {t === "checklist" && d.checklist.length > 0 && ` (${d.checklist.filter((c) => c.completedAt).length}/${d.checklist.length})`}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === "overview" && (
            <OverviewTab detail={d} />
          )}

          {tab === "items" && (
            <div className="space-y-3">
              <div className="space-y-2">
                {d.items.length === 0 && <p className="text-sm text-muted-foreground italic">No items yet — add packages and add-ons below.</p>}
                {d.items.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 border border-border rounded-lg p-3 bg-background">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{i.name} <span className="text-xs text-muted-foreground">[{i.kind}]</span></div>
                      {i.description && <div className="text-xs text-muted-foreground">{i.description}</div>}
                      <div className="text-xs text-muted-foreground">{i.quantity} × {money(i.unitPrice)} = <strong>{money(i.lineTotal)}</strong></div>
                    </div>
                    {canEdit && (
                      <button onClick={() => removeItem.mutate({ eventId: b.id, childId: i.id })} className="p-1 rounded hover:bg-destructive/10 text-destructive"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                ))}
              </div>
              {canEdit && (
                <div className="border-t border-border pt-3 grid grid-cols-2 gap-2">
                  <select className="h-9 text-sm border border-input rounded-md px-2 bg-background col-span-2"
                    value={itemForm.kind} onChange={(e) => setItemForm((f) => ({ ...f, kind: e.target.value }))}>
                    <option value="package">Package</option>
                    <option value="addon">Add-on</option>
                    <option value="service">Service</option>
                  </select>
                  <Input className="col-span-2" placeholder="Item name" value={itemForm.name} onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))} />
                  <Input type="number" min="1" placeholder="Qty" value={itemForm.quantity} onChange={(e) => setItemForm((f) => ({ ...f, quantity: Number(e.target.value) }))} />
                  <Input type="number" step="0.01" min="0" placeholder="Unit price" value={itemForm.unitPrice} onChange={(e) => setItemForm((f) => ({ ...f, unitPrice: Number(e.target.value) }))} />
                  <Button className="col-span-2 gap-1" onClick={async () => {
                    if (!itemForm.name.trim()) return void toast({ title: "Item name required", variant: "destructive" });
                    try {
                      await addItem.mutateAsync({ eventId: b.id, ...itemForm });
                      setItemForm({ kind: "package", name: "", quantity: 1, unitPrice: 0 });
                    } catch (err) { toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }); }
                  }} disabled={addItem.isPending}><Plus className="w-4 h-4" /> Add item</Button>
                </div>
              )}
            </div>
          )}

          {tab === "payments" && (
            <div className="space-y-3">
              <div className="bg-muted rounded-lg p-3 text-sm flex justify-between">
                <span>Total: <strong>{money(b.totalAmount)}</strong></span>
                <span>Paid: <strong className="text-green-700">{money(d.advancePaid)}</strong></span>
                <span>Balance: <strong className="text-red-700">{money(Number(b.totalAmount) - Number(d.advancePaid))}</strong></span>
              </div>
              <div className="space-y-2">
                {d.schedule.length === 0 && <p className="text-sm text-muted-foreground italic">No payment milestones yet.</p>}
                {d.schedule.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 border border-border rounded-lg p-3 bg-background">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{m.label}</div>
                      <div className="text-xs text-muted-foreground">Due {format(parseISO(m.dueDate), "MMM d, yyyy")} · {money(m.amount)}</div>
                    </div>
                    <span className={cn("text-xs px-2 py-0.5 rounded-full",
                      m.status === "paid" ? "bg-green-100 text-green-800" :
                      m.status === "overdue" ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800")}>
                      {m.status}
                    </span>
                    {canEdit && m.status !== "paid" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={async () => {
                        try {
                          await updatePayment.mutateAsync({ eventId: b.id, childId: m.id, markPaid: true, method: "cash" });
                          toast({ title: "Marked paid" });
                        } catch (err) { toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }); }
                      }}>Mark paid</Button>
                    )}
                    {canEdit && m.status !== "paid" && (
                      <button onClick={() => removePayment.mutate({ eventId: b.id, childId: m.id })} className="p-1 rounded hover:bg-destructive/10 text-destructive"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                ))}
              </div>
              {canEdit && (
                <div className="border-t border-border pt-3 grid grid-cols-3 gap-2">
                  <Input className="col-span-3" placeholder="Label (e.g. Advance, Final)" value={payForm.label} onChange={(e) => setPayForm((f) => ({ ...f, label: e.target.value }))} />
                  <Input type="date" value={payForm.dueDate} onChange={(e) => setPayForm((f) => ({ ...f, dueDate: e.target.value }))} />
                  <Input type="number" step="0.01" min="0" placeholder="Amount" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: Number(e.target.value) }))} />
                  <Button className="gap-1" onClick={async () => {
                    if (!payForm.dueDate || payForm.amount <= 0) return void toast({ title: "Date and amount required", variant: "destructive" });
                    try {
                      await addPayment.mutateAsync({ eventId: b.id, label: payForm.label || "Milestone", dueDate: payForm.dueDate, amount: payForm.amount });
                      setPayForm({ label: "", dueDate: "", amount: 0 });
                    } catch (err) { toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }); }
                  }}><Plus className="w-4 h-4" /></Button>
                </div>
              )}
            </div>
          )}

          {tab === "staff" && (
            <div className="space-y-3">
              <div className="space-y-2">
                {d.staff.length === 0 && <p className="text-sm text-muted-foreground italic">No staff assigned yet.</p>}
                {d.staff.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 border border-border rounded-lg p-3 bg-background">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{s.staffName}</div>
                      <div className="text-xs text-muted-foreground capitalize">{s.role}{s.notes ? ` · ${s.notes}` : ""}</div>
                    </div>
                    {canEdit && (
                      <button onClick={() => removeStaff.mutate({ eventId: b.id, childId: s.id })} className="p-1 rounded hover:bg-destructive/10 text-destructive"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                ))}
              </div>
              {canEdit && (
                <div className="border-t border-border pt-3 grid grid-cols-2 gap-2">
                  <Input placeholder="Staff name" value={staffForm.staffName} onChange={(e) => setStaffForm((f) => ({ ...f, staffName: e.target.value }))} />
                  <select className="h-9 text-sm border border-input rounded-md px-2 bg-background"
                    value={staffForm.role} onChange={(e) => setStaffForm((f) => ({ ...f, role: e.target.value }))}>
                    {["server", "chef", "manager", "host", "bartender", "other"].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <Input className="col-span-2" placeholder="Notes (shift hours, contact...)" value={staffForm.notes} onChange={(e) => setStaffForm((f) => ({ ...f, notes: e.target.value }))} />
                  <Button className="col-span-2 gap-1" onClick={async () => {
                    if (!staffForm.staffName.trim()) return void toast({ title: "Name required", variant: "destructive" });
                    try {
                      await addStaff.mutateAsync({ eventId: b.id, ...staffForm });
                      setStaffForm({ staffName: "", role: "server", notes: "" });
                    } catch (err) { toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }); }
                  }}><Plus className="w-4 h-4" /> Assign</Button>
                </div>
              )}
            </div>
          )}

          {tab === "vendors" && (
            <div className="space-y-3">
              <div className="space-y-2">
                {d.vendors.length === 0 && <p className="text-sm text-muted-foreground italic">No vendors / external requirements yet.</p>}
                {d.vendors.map((v) => (
                  <div key={v.id} className="flex items-center gap-3 border border-border rounded-lg p-3 bg-background">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{v.vendorName} <span className="text-xs text-muted-foreground capitalize">[{v.category}]</span></div>
                      <div className="text-xs text-muted-foreground">{v.contactInfo} · {money(v.cost)} · <span className="capitalize">{v.status}</span></div>
                      {v.notes && <div className="text-xs italic text-muted-foreground">{v.notes}</div>}
                    </div>
                    {canEdit && (
                      <button onClick={() => removeVendor.mutate({ eventId: b.id, childId: v.id })} className="p-1 rounded hover:bg-destructive/10 text-destructive"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                ))}
              </div>
              {canEdit && (
                <div className="border-t border-border pt-3 grid grid-cols-2 gap-2">
                  <select className="h-9 text-sm border border-input rounded-md px-2 bg-background"
                    value={vendorForm.category} onChange={(e) => setVendorForm((f) => ({ ...f, category: e.target.value }))}>
                    {["decor", "flowers", "av", "photography", "dj", "rentals", "other"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <Input placeholder="Vendor name" value={vendorForm.vendorName} onChange={(e) => setVendorForm((f) => ({ ...f, vendorName: e.target.value }))} />
                  <Input placeholder="Contact info" value={vendorForm.contactInfo} onChange={(e) => setVendorForm((f) => ({ ...f, contactInfo: e.target.value }))} />
                  <Input type="number" step="0.01" min="0" placeholder="Cost (₹)" value={vendorForm.cost} onChange={(e) => setVendorForm((f) => ({ ...f, cost: Number(e.target.value) }))} />
                  <Button className="col-span-2 gap-1" onClick={async () => {
                    if (!vendorForm.vendorName.trim()) return void toast({ title: "Vendor name required", variant: "destructive" });
                    try {
                      await addVendor.mutateAsync({ eventId: b.id, ...vendorForm });
                      setVendorForm({ category: "decor", vendorName: "", contactInfo: "", cost: 0 });
                    } catch (err) { toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }); }
                  }}><Plus className="w-4 h-4" /> Add vendor</Button>
                </div>
              )}
            </div>
          )}

          {tab === "checklist" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                {d.checklist.length === 0 && <p className="text-sm text-muted-foreground italic">No checklist items yet.</p>}
                {d.checklist.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 border border-border rounded-lg p-2.5 bg-background">
                    <button
                      onClick={() => { if (canEdit) toggleCheck.mutate({ eventId: b.id, childId: c.id, completed: !c.completedAt }); }}
                      disabled={!canEdit}
                      className={cn("text-muted-foreground", canEdit && "hover:text-foreground", !canEdit && "opacity-60 cursor-not-allowed")}
                    >
                      {c.completedAt ? <CheckSquare className="w-5 h-5 text-green-600" /> : <Square className="w-5 h-5" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className={cn("text-sm", c.completedAt && "line-through text-muted-foreground")}>{c.label}</div>
                      {c.notes && <div className="text-xs text-muted-foreground">{c.notes}</div>}
                    </div>
                    {canEdit && (
                      <button onClick={() => removeCheck.mutate({ eventId: b.id, childId: c.id })} className="p-1 rounded hover:bg-destructive/10 text-destructive"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                ))}
              </div>
              {canEdit && (
                <div className="border-t border-border pt-3 flex gap-2">
                  <Input placeholder="Checklist item..." value={checkForm.label} onChange={(e) => setCheckForm({ label: e.target.value })}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter" && checkForm.label.trim()) {
                        try {
                          await addCheck.mutateAsync({ eventId: b.id, label: checkForm.label.trim() });
                          setCheckForm({ label: "" });
                        } catch (err) { toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }); }
                      }
                    }} />
                  <Button onClick={async () => {
                    if (!checkForm.label.trim()) return;
                    try {
                      await addCheck.mutateAsync({ eventId: b.id, label: checkForm.label.trim() });
                      setCheckForm({ label: "" });
                    } catch (err) { toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }); }
                  }} className="gap-1"><Plus className="w-4 h-4" /></Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-border p-4 flex flex-wrap gap-2 justify-between items-center">
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => handlePrint(b.invoicedAt ? "Invoice" : "Quotation")}>
              <FileText className="w-4 h-4" /> Print {b.invoicedAt ? "invoice" : "quote"}
            </Button>
            {canEdit && b.status === "quote" && !b.invoiceOrderId && (
              <Button variant="outline" size="sm" className="gap-1" onClick={handleConvert} disabled={convert.isPending}>
                <Receipt className="w-4 h-4" /> Convert to invoice
              </Button>
            )}
            {b.invoiceOrderId && (
              <span className="text-xs text-muted-foreground self-center">Invoiced (Order #{b.invoiceOrderId})</span>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {canEdit && nextActions.map((a) => (
              <Button key={a.status} size="sm" variant={a.variant ?? "outline"} onClick={async () => {
                try {
                  await transition.mutateAsync({ id: b.id, status: a.status });
                  toast({ title: `Status: ${STATUS_CONFIG[a.status].label}` });
                } catch (err) { toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }); }
              }}>{a.label}</Button>
            ))}
            {canEdit && b.status !== "completed" && b.status !== "cancelled" && (
              <Button size="sm" variant="outline" className="gap-1" onClick={onEdit}><Pencil className="w-4 h-4" /> Edit</Button>
            )}
            {canEdit && (b.status === "quote" || b.status === "cancelled") && (
              <Button size="sm" variant="outline" className="gap-1 text-destructive" onClick={handleDelete}><Trash2 className="w-4 h-4" /> Delete</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ detail }: { detail: EventBookingDetail }) {
  const b = detail.booking;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-muted-foreground mb-1">Customer</div>
          <div className="text-sm font-medium">{b.customerName}</div>
          {b.customerPhone && <div className="text-xs text-muted-foreground inline-flex items-center gap-1"><Phone className="w-3 h-3" />{b.customerPhone}</div>}
          {b.customerEmail && <div className="text-xs text-muted-foreground inline-flex items-center gap-1"><Mail className="w-3 h-3" />{b.customerEmail}</div>}
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Event</div>
          <div className="text-sm inline-flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" />{format(parseISO(b.eventDate), "EEE, MMM d yyyy")}</div>
          <div className="text-sm inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{format(parseISO(b.eventDate), "h:mm a")} ({b.durationMinutes} min)</div>
          {b.venue && <div className="text-sm inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{b.venue}</div>}
          <div className="text-sm inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" />{b.guestCount} guests</div>
        </div>
      </div>
      {b.packageDetails && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">Package details</div>
          <div className="text-sm whitespace-pre-wrap bg-muted/50 rounded-lg p-3">{b.packageDetails}</div>
        </div>
      )}
      {b.notes && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">Notes</div>
          <div className="text-sm whitespace-pre-wrap bg-muted/50 rounded-lg p-3">{b.notes}</div>
        </div>
      )}
      <div className="border-t border-border pt-3">
        <div className="text-xs text-muted-foreground mb-2">Totals</div>
        <div className="grid grid-cols-2 gap-y-1 text-sm max-w-sm">
          <div>Subtotal</div><div className="text-right">{money(b.subtotal)}</div>
          <div>Tax</div><div className="text-right">{money(b.taxAmount)}</div>
          <div>Discount</div><div className="text-right">- {money(b.discountAmount)}</div>
          <div className="font-semibold border-t pt-1">Total</div><div className="text-right font-semibold border-t pt-1">{money(b.totalAmount)}</div>
          <div className="text-green-700">Advance paid</div><div className="text-right text-green-700">{money(detail.advancePaid)}</div>
          <div className="text-red-700">Balance</div><div className="text-right text-red-700">{money(Number(b.totalAmount) - Number(detail.advancePaid))}</div>
        </div>
      </div>
      {detail.history.length > 0 && (
        <div className="border-t border-border pt-3">
          <div className="text-xs text-muted-foreground mb-2">Status history</div>
          <ul className="text-xs space-y-1">
            {detail.history.map((h) => (
              <li key={h.id}>
                <span className="text-muted-foreground">{format(parseISO(h.createdAt), "MMM d, h:mm a")}: </span>
                {h.fromStatus ? `${h.fromStatus} → ` : ""}<strong>{h.toStatus}</strong>
                {h.note && <span className="text-muted-foreground"> — {h.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Calendar (month grid) ───────────────────────────

function MonthCalendar({
  monthAnchor,
  onPick,
  onPrev,
  onNext,
}: {
  monthAnchor: Date;
  onPick: (b: EventBooking) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const start = startOfWeek(startOfMonth(monthAnchor), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(monthAnchor), { weekStartsOn: 1 });
  const fromIso = start.toISOString();
  const toIso = end.toISOString();
  const { data: bookingsRaw = [] } = useEventCalendar({ from: fromIso, to: toIso });
  const bookings = bookingsRaw as unknown as EventBooking[];

  const days: Date[] = useMemo(() => {
    const arr: Date[] = [];
    let d = start;
    while (d <= end) { arr.push(d); d = addDays(d, 1); }
    return arr;
  }, [fromIso, toIso]);

  const byDay = useMemo(() => {
    const m = new Map<string, EventBooking[]>();
    for (const b of bookings) {
      const k = format(parseISO(b.eventDate), "yyyy-MM-dd");
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(b);
    }
    return m;
  }, [bookings]);

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <Button variant="outline" size="sm" onClick={onPrev}>‹ Prev</Button>
        <p className="text-sm font-semibold">{format(monthAnchor, "MMMM yyyy")}</p>
        <Button variant="outline" size="sm" onClick={onNext}>Next ›</Button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden text-xs">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="bg-muted px-2 py-1 text-center font-medium">{d}</div>
        ))}
        {days.map((d) => {
          const k = format(d, "yyyy-MM-dd");
          const dayBookings = byDay.get(k) ?? [];
          const inMonth = isSameMonth(d, monthAnchor);
          const today = isSameDay(d, new Date());
          return (
            <div key={k} className={cn("bg-card min-h-[88px] p-1.5", !inMonth && "opacity-40", today && "ring-2 ring-primary/40")}>
              <div className="text-[10px] text-muted-foreground mb-1">{format(d, "d")}</div>
              <div className="space-y-1">
                {dayBookings.slice(0, 3).map((b) => {
                  const cfg = STATUS_CONFIG[b.status as EventBookingStatus] ?? STATUS_CONFIG.quote;
                  return (
                    <button key={b.id} onClick={() => onPick(b)} className={cn("w-full text-left text-[10px] px-1.5 py-0.5 rounded truncate", cfg.bg, cfg.text)} title={b.title}>
                      {format(parseISO(b.eventDate), "HH:mm")} {b.title}
                    </button>
                  );
                })}
                {dayBookings.length > 3 && <div className="text-[10px] text-muted-foreground">+{dayBookings.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────── Main page ───────────────────────────

export default function EventsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "owner" || user?.role === "manager" || user?.isSuperAdmin === true;
  const [view, setView] = useState<"list" | "calendar">("list");
  const [statusFilter, setStatusFilter] = useState<EventBookingStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<EventBookingType | "all">("all");
  const [openForm, setOpenForm] = useState<{ kind: "create" } | { kind: "edit"; booking: EventBooking } | null>(null);
  const [openDetailId, setOpenDetailId] = useState<number | null>(null);
  const [monthAnchor, setMonthAnchor] = useState<Date>(new Date());

  const filters = useMemo(() => {
    const f: { status?: EventBookingStatus; type?: EventBookingType } = {};
    if (statusFilter !== "all") f.status = statusFilter;
    if (typeFilter !== "all") f.type = typeFilter;
    return f;
  }, [statusFilter, typeFilter]);

  const list = useEvents(filters);

  return (
    <Layout>
      <PageHeader
        title="Events & Catering"
        subtitle="Manage event bookings, banquets and catering jobs end-to-end."
        actions={canEdit ? (
          <Button className="gap-1" onClick={() => setOpenForm({ kind: "create" })}><Plus className="w-4 h-4" /> New booking</Button>
        ) : null}
      />

      <div className="flex flex-wrap gap-2 items-center mb-4">
        <div className="inline-flex border border-border rounded-md overflow-hidden">
          <button className={cn("px-3 py-1.5 text-sm inline-flex items-center gap-1", view === "list" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent")} onClick={() => setView("list")}>
            <List className="w-4 h-4" /> List
          </button>
          <button className={cn("px-3 py-1.5 text-sm inline-flex items-center gap-1", view === "calendar" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent")} onClick={() => setView("calendar")}>
            <CalendarRange className="w-4 h-4" /> Calendar
          </button>
        </div>

        {view === "list" && (
          <>
            <select className="h-9 text-sm border border-input rounded-md px-2 bg-background"
              value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as EventBookingStatus | "all")}>
              <option value="all">All statuses</option>
              {(Object.keys(STATUS_CONFIG) as EventBookingStatus[]).map((s) => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
            </select>
            <select className="h-9 text-sm border border-input rounded-md px-2 bg-background"
              value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as EventBookingType | "all")}>
              <option value="all">All types</option>
              {(Object.keys(TYPE_CONFIG) as EventBookingType[]).map((t) => <option key={t} value={t}>{TYPE_CONFIG[t].label}</option>)}
            </select>
          </>
        )}
      </div>

      {view === "list" ? (
        <div className="space-y-2">
          {list.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {list.error && (
            <div className="p-4 border border-destructive/40 rounded-xl bg-destructive/5 text-sm text-destructive inline-flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {list.error instanceof Error ? list.error.message : "Failed to load bookings"}
            </div>
          )}
          {!list.isLoading && (list.data ?? []).length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <PartyPopper className="w-10 h-10 mx-auto mb-2 opacity-40" />
              No bookings yet. {canEdit ? "Create your first quote to get started." : ""}
            </div>
          )}
          {((list.data ?? []) as unknown as EventBooking[]).map((b) => {
            const cfg = STATUS_CONFIG[b.status];
            const TypeIcon = TYPE_CONFIG[b.type].icon;
            return (
              <button key={b.id} onClick={() => setOpenDetailId(b.id)} className="w-full text-left border border-border rounded-xl p-3 bg-card hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <TypeIcon className="w-4 h-4 text-muted-foreground" />
                      <p className="font-semibold truncate">{b.title}</p>
                      <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full", cfg.bg, cfg.text)}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />{cfg.label}
                      </span>
                      <span className="text-xs text-muted-foreground">{b.bookingNumber}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                      <span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" />{format(parseISO(b.eventDate), "MMM d, yyyy h:mm a")}</span>
                      <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />{b.guestCount} guests</span>
                      <span>· {b.customerName}</span>
                      {b.venue && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{b.venue}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold inline-flex items-center"><IndianRupee className="w-3.5 h-3.5" />{Number(b.totalAmount).toLocaleString("en-IN")}</div>
                    {b.invoiceOrderId && <div className="text-[10px] text-muted-foreground">Invoice #{b.invoiceOrderId}</div>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <MonthCalendar
          monthAnchor={monthAnchor}
          onPick={(b) => setOpenDetailId(b.id)}
          onPrev={() => setMonthAnchor((d) => addDays(startOfMonth(d), -1))}
          onNext={() => setMonthAnchor((d) => addDays(endOfMonth(d), 1))}
        />
      )}

      {openForm && (
        <BookingForm
          booking={openForm.kind === "edit" ? openForm.booking : undefined}
          onClose={() => setOpenForm(null)}
          onSaved={() => {}}
        />
      )}

      {openDetailId !== null && (
        <BookingDetail
          id={openDetailId}
          canEdit={canEdit}
          onClose={() => setOpenDetailId(null)}
          onEdit={() => {
            const b = ((list.data ?? []) as unknown as EventBooking[]).find((x) => x.id === openDetailId);
            if (b) {
              setOpenDetailId(null);
              setOpenForm({ kind: "edit", booking: b });
            }
          }}
        />
      )}
    </Layout>
  );
}
