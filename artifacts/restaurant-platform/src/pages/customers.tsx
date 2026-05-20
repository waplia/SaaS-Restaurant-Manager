import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  useCustomers, useCreateCustomer, useUpdateCustomer,
  useCustomerLoyalty, useAddLoyaltyPoints,
  useCoupons, useCreateCoupon, useUpdateCoupon, useDeleteCoupon,
  useCustomerOrders, useCustomerAddresses, useCreateCustomerAddress, useDeleteCustomerAddress,
  useLoyalty2Summary, useLoyalty2CashbackMutate, useLoyalty2AddStamp, useLoyalty2FamilyAdd,
  useCustomerProfile, useCustomerTags, useAddCustomerTag, useRemoveCustomerTag,
  useCustomerNotes, useCreateCustomerNote, useUpdateCustomerNote, useDeleteCustomerNote,
  useCustomerComplaints, useCreateCustomerComplaint, useUpdateCustomerComplaint,
  useFloorTables,
} from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/PhoneInput";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Plus, Search, Mail, Phone, Star, ShoppingBag, X, Pencil,
  Gift, Trash2, Tag, Users, ArrowUpCircle, ArrowDownCircle, Clock,
  Receipt, MapPin, Home, Building, Navigation, Cake, Heart,
  AlertCircle, MessageSquare, Filter, Columns3, Crown, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type {
  Customer, LoyaltyTransaction, Coupon, Order, CustomerAddress,
  CustomerProfile, CustomerListFilters, CustomerPreferredChannel,
  CustomerNote, CustomerComplaint,
} from "@/lib/types";

const TABS = ["Customers", "Coupons"] as const;
type Tab = typeof TABS[number];

const PROFILE_TABS = ["Overview", "Activity", "Notes", "Tags & Preferences"] as const;
type ProfileTab = typeof PROFILE_TABS[number];

const ALL_COLUMNS = [
  { key: "contact", label: "Contact", default: true },
  { key: "tags", label: "Tags", default: true },
  { key: "orders", label: "Orders", default: true },
  { key: "spent", label: "Total Spent", default: true },
  { key: "aov", label: "Avg Order", default: false },
  { key: "loyalty", label: "Loyalty", default: true },
  { key: "lastVisit", label: "Last Visit", default: true },
  { key: "frequency", label: "Visit Frequency", default: false },
  { key: "channel", label: "Channel", default: false },
  { key: "birthday", label: "Birthday", default: false },
] as const;
type ColumnKey = typeof ALL_COLUMNS[number]["key"];

const COLUMN_STORAGE_KEY = "customers.columns.v1";
const FILTER_STORAGE_KEY = "customers.filters.v1";

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function formatDateTime(d: string) {
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function relativeTime(d: string | null) {
  if (!d) return "Never";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}
function monthDay(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const ADDRESS_LABEL_ICONS: Record<string, React.ReactNode> = {
  Home: <Home className="w-3 h-3" />,
  Work: <Building className="w-3 h-3" />,
  Other: <Navigation className="w-3 h-3" />,
};

const COMPLAINT_STATUS_STYLES: Record<string, string> = {
  open: "bg-red-100 text-red-700 border-red-200",
  in_progress: "bg-yellow-100 text-yellow-700 border-yellow-200",
  resolved: "bg-green-100 text-green-700 border-green-200",
};

// ─── Profile sub-panels ────────────────────────────────────────────────────

function OverviewPanel({ profile }: { profile: CustomerProfile }) {
  const { data: loyalty } = useCustomerLoyalty(profile.id);
  const { data: tables = [] } = useFloorTables();
  const preferredTable = profile.preferredTableId
    ? tables.find(t => t.id === profile.preferredTableId)
    : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Orders" value={String(profile.totalOrders)} />
        <Stat label="LTV" value={`₹${Number(profile.totalSpent).toLocaleString()}`} />
        <Stat label="Points" value={String(loyalty?.balance ?? profile.loyaltyPoints)} accent="yellow" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Avg Order" value={profile.averageOrderValue ? `₹${profile.averageOrderValue.toLocaleString()}` : "—"} />
        <Stat label="Visit Freq" value={profile.visitFrequencyDays != null ? `${profile.visitFrequencyDays}d` : "—"} />
        <Stat
          label="No-shows"
          value={String(profile.noShowCount ?? 0)}
          accent={(profile.noShowCount ?? 0) >= 2 ? "yellow" : undefined}
        />
      </div>

      {(profile.allergies || preferredTable) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1.5 text-xs">
          {profile.allergies && (
            <p className="flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
              <span><span className="font-semibold text-amber-800">Allergies:</span> {profile.allergies}</span>
            </p>
          )}
          {preferredTable && (
            <p className="flex items-center gap-2 text-amber-800">
              <Star className="w-3.5 h-3.5" />
              Preferred table: <span className="font-semibold">{preferredTable.tableNumber}</span> (seats {preferredTable.capacity})
            </p>
          )}
        </div>
      )}

      <div className="space-y-1.5 text-xs text-muted-foreground">
        {profile.email && <p className="flex items-center gap-2"><Mail className="w-3.5 h-3.5" />{profile.email}</p>}
        {profile.phone && <p className="flex items-center gap-2"><Phone className="w-3.5 h-3.5" />{profile.phone}</p>}
        {profile.address && <p className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5" />{profile.address}</p>}
        {profile.birthday && <p className="flex items-center gap-2"><Cake className="w-3.5 h-3.5 text-pink-500" />Birthday {monthDay(profile.birthday)}</p>}
        {profile.anniversary && <p className="flex items-center gap-2"><Heart className="w-3.5 h-3.5 text-red-500" />Anniversary {monthDay(profile.anniversary)}</p>}
        <p className="flex items-center gap-2"><Clock className="w-3.5 h-3.5" />Last visit {relativeTime(profile.lastVisitAt)}</p>
      </div>

      {profile.tags && profile.tags.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Tags</h4>
          <div className="flex flex-wrap gap-1.5">
            {profile.tags.map(t => (
              <Badge key={t.id} variant="secondary" className="text-xs">{t.name}</Badge>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5" /> Favorite items
        </h4>
        {profile.favoriteItems.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No order history yet</p>
        ) : (
          <ul className="space-y-1.5">
            {profile.favoriteItems.map(f => (
              <li key={`${f.menuItemId}-${f.name}`} className="flex items-center justify-between text-xs">
                <span className="truncate">{f.name}</span>
                <span className="text-muted-foreground tabular-nums whitespace-nowrap ml-2">{f.orderCount}× · {f.quantity} qty</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "yellow" }) {
  return (
    <div className={cn("rounded-xl p-3 text-center", accent === "yellow" ? "bg-yellow-50 border border-yellow-100" : "bg-muted/40")}>
      <p className={cn("text-sm font-bold", accent === "yellow" ? "text-yellow-600" : "text-foreground")}>{value}</p>
      <p className={cn("text-xs", accent === "yellow" ? "text-yellow-700" : "text-muted-foreground")}>{label}</p>
    </div>
  );
}

function ActivityPanel({ profile }: { profile: CustomerProfile }) {
  const { data: ordersData } = useCustomerOrders(profile.id);
  const { data: loyalty } = useCustomerLoyalty(profile.id);
  const { data: complaintsList = [] } = useCustomerComplaints(profile.id);
  const [showAddComplaint, setShowAddComplaint] = useState(false);
  const orders: Order[] = ordersData?.data ?? [];

  return (
    <div className="space-y-4">
      <Section title="Complaints" action={<Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAddComplaint(true)}><Plus className="w-3 h-3 mr-1" />Log</Button>}>
        {showAddComplaint && <ComplaintForm customerId={profile.id} onClose={() => setShowAddComplaint(false)} />}
        {complaintsList.length === 0 && !showAddComplaint && <p className="text-xs text-muted-foreground italic">No complaints recorded</p>}
        <div className="space-y-2">
          {complaintsList.map(c => <ComplaintItem key={c.id} complaint={c} customerId={profile.id} />)}
        </div>
      </Section>

      <Section title="Reviews">
        {profile.recentReviews.feedback.length === 0 && profile.recentReviews.external.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No reviews matched yet</p>
        )}
        {profile.recentReviews.feedback.map(r => (
          <div key={`fb-${r.id}`} className="text-xs p-2 rounded-lg bg-muted/40 mb-1.5">
            <div className="flex items-center justify-between mb-0.5">
              <span className="font-medium">In-store feedback</span>
              {r.rating != null && <span className="text-yellow-600">{"★".repeat(r.rating)}</span>}
            </div>
            {r.comment && <p className="text-muted-foreground">{r.comment}</p>}
            <p className="text-[10px] text-muted-foreground mt-0.5">{formatDateTime(r.createdAt)}</p>
          </div>
        ))}
        {profile.recentReviews.external.map(r => (
          <div key={`ext-${r.id}`} className="text-xs p-2 rounded-lg bg-muted/40 mb-1.5">
            <div className="flex items-center justify-between mb-0.5">
              <span className="font-medium capitalize">{r.source}</span>
              {r.rating != null && <span className="text-yellow-600">{"★".repeat(r.rating)}</span>}
            </div>
            {r.comment && <p className="text-muted-foreground">{r.comment}</p>}
            <p className="text-[10px] text-muted-foreground mt-0.5">{r.postedAt ? formatDateTime(r.postedAt) : ""}</p>
          </div>
        ))}
      </Section>

      <Section title="Loyalty history">
        {(!loyalty?.transactions || loyalty.transactions.length === 0) && <p className="text-xs text-muted-foreground italic">No loyalty activity</p>}
        <div className="space-y-1.5">
          {loyalty?.transactions?.slice(0, 10).map((tx: LoyaltyTransaction) => (
            <div key={tx.id} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <div className={cn("w-5 h-5 rounded-full flex items-center justify-center", tx.points > 0 ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600")}>
                  {tx.points > 0 ? <ArrowUpCircle className="w-3 h-3" /> : <ArrowDownCircle className="w-3 h-3" />}
                </div>
                <div className="min-w-0">
                  <p className="font-medium capitalize truncate">{tx.type}{tx.reason ? ` — ${tx.reason}` : ""}</p>
                  <p className="text-[10px] text-muted-foreground">{formatDateTime(tx.createdAt)}</p>
                </div>
              </div>
              <span className={cn("font-bold tabular-nums", tx.points > 0 ? "text-green-600" : "text-red-600")}>
                {tx.points > 0 ? "+" : ""}{tx.points}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Recent orders">
        {orders.length === 0 && <p className="text-xs text-muted-foreground italic">No orders yet</p>}
        <div className="space-y-1.5">
          {orders.slice(0, 10).map(o => (
            <div key={o.id} className="flex items-start gap-2 text-xs py-1.5 border-b border-border/30 last:border-0">
              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Receipt className="w-3 h-3 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <p className="font-semibold">#{o.orderNumber}</p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-muted text-muted-foreground capitalize">{o.status}</span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <p className="text-[10px] text-muted-foreground">{formatDateTime(o.createdAt)}</p>
                  <p className="font-bold text-primary">₹{Number(o.totalAmount).toLocaleString()}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</h4>
        {action}
      </div>
      {children}
    </div>
  );
}

function ComplaintForm({ customerId, onClose, complaint }: { customerId: number; onClose: () => void; complaint?: CustomerComplaint }) {
  const create = useCreateCustomerComplaint();
  const update = useUpdateCustomerComplaint();
  const { toast } = useToast();
  const [form, setForm] = useState({
    channel: complaint?.channel ?? "in_person",
    summary: complaint?.summary ?? "",
    details: complaint?.details ?? "",
  });
  const handleSave = async () => {
    if (!form.summary.trim()) return;
    try {
      if (complaint) {
        await update.mutateAsync({ customerId, complaintId: complaint.id, ...form });
      } else {
        await create.mutateAsync({ customerId, ...form });
      }
      toast({ title: complaint ? "Complaint updated" : "Complaint logged" });
      onClose();
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    }
  };
  return (
    <div className="space-y-2 p-2.5 bg-muted/30 rounded-lg mb-2">
      <Select value={form.channel} onValueChange={v => setForm(p => ({ ...p, channel: v as CustomerComplaint["channel"] }))}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="in_person">In person</SelectItem>
          <SelectItem value="phone">Phone</SelectItem>
          <SelectItem value="whatsapp">WhatsApp</SelectItem>
          <SelectItem value="email">Email</SelectItem>
          <SelectItem value="review">Review</SelectItem>
          <SelectItem value="other">Other</SelectItem>
        </SelectContent>
      </Select>
      <Input placeholder="Short summary" value={form.summary} onChange={e => setForm(p => ({ ...p, summary: e.target.value }))} className="h-8 text-xs" />
      <Textarea placeholder="Details (optional)" value={form.details} onChange={e => setForm(p => ({ ...p, details: e.target.value }))} className="text-xs min-h-[60px]" />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={onClose}>Cancel</Button>
        <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleSave} disabled={!form.summary.trim() || create.isPending || update.isPending}>Save</Button>
      </div>
    </div>
  );
}

function ComplaintItem({ complaint, customerId }: { complaint: CustomerComplaint; customerId: number }) {
  const update = useUpdateCustomerComplaint();
  const [editing, setEditing] = useState(false);
  if (editing) return <ComplaintForm customerId={customerId} complaint={complaint} onClose={() => setEditing(false)} />;
  return (
    <div className="text-xs p-2 rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="font-medium flex-1 min-w-0">{complaint.summary}</p>
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-medium capitalize whitespace-nowrap", COMPLAINT_STATUS_STYLES[complaint.status])}>
          {complaint.status.replace("_", " ")}
        </span>
      </div>
      {complaint.details && <p className="text-muted-foreground mb-1">{complaint.details}</p>}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="capitalize">{complaint.channel.replace("_", " ")} · {formatDateTime(complaint.createdAt)}</span>
        <div className="flex gap-1">
          <button className="hover:text-foreground" onClick={() => setEditing(true)}>Edit</button>
          {complaint.status !== "resolved" && (
            <button className="hover:text-green-600" onClick={() => update.mutate({ customerId, complaintId: complaint.id, status: "resolved" })}>
              Resolve
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function NotesPanel({ customerId }: { customerId: number }) {
  const { data: notes = [] } = useCustomerNotes(customerId);
  const create = useCreateCustomerNote();
  const [body, setBody] = useState("");
  const { toast } = useToast();

  const handleAdd = async () => {
    if (!body.trim()) return;
    try {
      await create.mutateAsync({ customerId, body: body.trim() });
      setBody("");
    } catch {
      toast({ title: "Failed to save note", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Textarea placeholder="Add a note about this customer…" value={body} onChange={e => setBody(e.target.value)} className="text-sm min-h-[70px]" />
        <Button size="sm" className="w-full h-8" onClick={handleAdd} disabled={!body.trim() || create.isPending}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Add note
        </Button>
      </div>
      <div className="space-y-2">
        {notes.length === 0 && <p className="text-xs text-muted-foreground italic text-center py-4">No notes yet</p>}
        {notes.map(n => <NoteItem key={n.id} note={n} customerId={customerId} />)}
      </div>
    </div>
  );
}

function NoteItem({ note, customerId }: { note: CustomerNote; customerId: number }) {
  const update = useUpdateCustomerNote();
  const del = useDeleteCustomerNote();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const { toast } = useToast();

  const ageMs = Date.now() - new Date(note.createdAt).getTime();
  const editable = ageMs <= 15 * 60 * 1000;

  const handleSave = async () => {
    try {
      await update.mutateAsync({ customerId, noteId: note.id, body: draft.trim() });
      setEditing(false);
    } catch {
      toast({ title: "Failed to save (edit window expired?)", variant: "destructive" });
    }
  };

  return (
    <div className="text-xs p-2.5 rounded-lg border border-border bg-card">
      {editing ? (
        <div className="space-y-2">
          <Textarea value={draft} onChange={e => setDraft(e.target.value)} className="text-xs min-h-[60px]" />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => { setEditing(false); setDraft(note.body); }}>Cancel</Button>
            <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleSave} disabled={!draft.trim()}>Save</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap mb-1">{note.body}</p>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{note.authorName ?? "—"} · {formatDateTime(note.createdAt)}{note.updatedAt !== note.createdAt && " (edited)"}</span>
            <div className="flex gap-1">
              {editable && <button className="hover:text-foreground" onClick={() => setEditing(true)}>Edit</button>}
              <button className="hover:text-destructive" onClick={() => del.mutate({ customerId, noteId: note.id })}>Delete</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AllergiesAndTablePanel({ profile }: { profile: CustomerProfile }) {
  const update = useCustomerUpdate(profile.id);
  const { data: tables = [] } = useFloorTables();
  const { toast } = useToast();
  const [allergies, setAllergies] = useState(profile.allergies ?? "");
  const [tableId, setTableId] = useState<number | "">(profile.preferredTableId ?? "");

  useEffect(() => { setAllergies(profile.allergies ?? ""); }, [profile.allergies]);
  useEffect(() => { setTableId(profile.preferredTableId ?? ""); }, [profile.preferredTableId]);

  const saveAllergies = async () => {
    try {
      await update({ allergies: allergies.trim() || null });
      toast({ title: "Allergies saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };
  const saveTable = async (v: string) => {
    const next = v === "" ? null : Number(v);
    setTableId(next ?? "");
    try {
      await update({ preferredTableId: next });
      toast({ title: "Preferred table saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Allergies & dietary notes</Label>
        <Textarea
          value={allergies}
          onChange={e => setAllergies(e.target.value)}
          onBlur={() => { if ((profile.allergies ?? "") !== allergies.trim()) void saveAllergies(); }}
          placeholder="Peanut allergy, lactose intolerant, gluten-free…"
          rows={2}
          className="text-xs"
        />
      </div>
      <div>
        <Label className="text-xs">Preferred table</Label>
        <select
          className="w-full h-8 text-xs border border-input rounded-md px-2 bg-background"
          value={tableId}
          onChange={e => void saveTable(e.target.value)}
        >
          <option value="">No preference</option>
          {tables.map(t => (
            <option key={t.id} value={t.id}>Table {t.tableNumber} · seats {t.capacity}</option>
          ))}
        </select>
      </div>
      {(profile.noShowCount ?? 0) > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
          ⚠ {profile.noShowCount} no-show{(profile.noShowCount ?? 0) === 1 ? "" : "s"} on record
          {profile.lastNoShowAt ? ` · last ${relativeTime(profile.lastNoShowAt)}` : ""}
        </p>
      )}
    </div>
  );
}

function TagsPreferencesPanel({ profile }: { profile: CustomerProfile }) {
  const { data: tagDictionary = [] } = useCustomerTags();
  const addTag = useAddCustomerTag();
  const removeTag = useRemoveCustomerTag();
  const update = useCustomerUpdate(profile.id);
  const { toast } = useToast();
  const [newTag, setNewTag] = useState("");

  // WhatsApp opt-in dialog state
  const [showOptInDialog, setShowOptInDialog] = useState(false);
  const [optInSource, setOptInSource] = useState("verbal");

  const tags = profile.tags ?? [];

  const handleAddTag = async (name: string) => {
    if (!name.trim()) return;
    try {
      await addTag.mutateAsync({ customerId: profile.id, name: name.trim() });
      setNewTag("");
    } catch {
      toast({ title: "Failed to add tag", variant: "destructive" });
    }
  };

  const handleEnableWhatsApp = async () => {
    try {
      await update({ whatsappOptIn: true, whatsappOptInSource: optInSource });
      toast({ title: "WhatsApp opt-in recorded" });
      setShowOptInDialog(false);
    } catch {
      toast({ title: "Failed to update opt-in", variant: "destructive" });
    }
  };

  const handleDisableWhatsApp = async () => {
    try {
      await update({ whatsappOptIn: false });
      toast({ title: "WhatsApp opt-in revoked" });
    } catch {
      toast({ title: "Failed to update opt-in", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5">
      <Section title="Tags">
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.map(t => (
            <Badge key={t.id} variant="secondary" className="text-xs gap-1 pr-1">
              {t.name}
              <button onClick={() => removeTag.mutate({ customerId: profile.id, tagId: t.id })} className="hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
          {tags.length === 0 && <span className="text-xs text-muted-foreground italic">No tags</span>}
        </div>
        <div className="flex gap-1.5">
          <Input
            placeholder="Add tag (e.g. VIP, Vegan)"
            value={newTag}
            onChange={e => setNewTag(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleAddTag(newTag); }}
            className="h-8 text-xs"
            list="customer-tag-suggestions"
          />
          <datalist id="customer-tag-suggestions">
            {tagDictionary.map(t => <option key={t.id} value={t.name} />)}
          </datalist>
          <Button size="sm" className="h-8" onClick={() => handleAddTag(newTag)} disabled={!newTag.trim()}>Add</Button>
        </div>
      </Section>

      <Section title="VIP & milestones">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown className={cn("w-4 h-4", profile.isVip ? "text-yellow-500" : "text-muted-foreground")} />
              <span className="text-sm">VIP customer</span>
            </div>
            <Switch checked={profile.isVip} onCheckedChange={(v) => update({ isVip: v })} />
          </div>
          <div>
            <Label className="text-xs">Birthday</Label>
            <Input type="date" value={profile.birthday ?? ""} onChange={e => update({ birthday: e.target.value || null })} className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs">Anniversary</Label>
            <Input type="date" value={profile.anniversary ?? ""} onChange={e => update({ anniversary: e.target.value || null })} className="h-8 text-xs" />
          </div>
        </div>
      </Section>

      <Section title="Allergies & seating">
        <AllergiesAndTablePanel profile={profile} />
      </Section>

      <Section title="Communication preferences">
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Preferred channel</Label>
            <Select value={profile.preferredChannel} onValueChange={(v) => update({ preferredChannel: v as CustomerPreferredChannel })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="call">Phone call</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="text-xs">
              <p className="font-medium">WhatsApp opt-in</p>
              <p className="text-muted-foreground">
                {profile.whatsappOptIn
                  ? `Enabled ${profile.whatsappOptInAt ? formatDate(profile.whatsappOptInAt) : ""} · ${profile.whatsappOptInSource ?? ""}`
                  : "Customer has not consented"}
              </p>
            </div>
            {profile.whatsappOptIn ? (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleDisableWhatsApp}>Revoke</Button>
            ) : (
              <Button size="sm" className="h-7 text-xs" onClick={() => setShowOptInDialog(true)}>Enable</Button>
            )}
          </div>
        </div>
      </Section>

      {showOptInDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-5 w-full max-w-xs">
            <h3 className="font-semibold mb-2">WhatsApp opt-in source</h3>
            <p className="text-xs text-muted-foreground mb-3">For compliance, record how the customer consented.</p>
            <Select value={optInSource} onValueChange={setOptInSource}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="verbal">Verbal at counter</SelectItem>
                <SelectItem value="signup_form">Sign-up form</SelectItem>
                <SelectItem value="receipt_qr">Receipt QR</SelectItem>
                <SelectItem value="online_order">Online order checkout</SelectItem>
                <SelectItem value="reservation">Reservation</SelectItem>
                <SelectItem value="manual">Manual / other</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2 mt-3">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowOptInDialog(false)}>Cancel</Button>
              <Button size="sm" className="flex-1" onClick={handleEnableWhatsApp}>Confirm</Button>
            </div>
          </div>
        </div>
      )}

      <Section title="Saved addresses">
        <AddressList customerId={profile.id} />
      </Section>
    </div>
  );
}

function useCustomerUpdate(id: number) {
  const update = useUpdateCustomer();
  return async (patch: Omit<import("@/lib/types").UpdateCustomerInput, "id">) => {
    await update.mutateAsync({ id, ...patch });
  };
}

function AddressList({ customerId }: { customerId: number }) {
  const { data: addresses = [] } = useCustomerAddresses(customerId);
  const create = useCreateCustomerAddress();
  const del = useDeleteCustomerAddress();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ address: "", label: "Home" });
  const { toast } = useToast();

  const handleAdd = async () => {
    if (!form.address.trim()) return;
    try {
      await create.mutateAsync({ customerId, address: form.address.trim(), label: form.label });
      setForm({ address: "", label: "Home" });
      setAdding(false);
    } catch {
      toast({ title: "Failed to save address", variant: "destructive" });
    }
  };

  return (
    <div>
      {adding && (
        <div className="space-y-2 mb-2 p-2.5 bg-muted/30 rounded-lg">
          <div className="flex gap-1.5">
            {["Home", "Work", "Other"].map(lbl => (
              <button key={lbl} onClick={() => setForm(p => ({ ...p, label: lbl }))}
                className={cn("flex-1 text-xs py-1 rounded border", form.label === lbl ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground")}>
                {lbl}
              </button>
            ))}
          </div>
          <Input placeholder="Street address, city…" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} className="h-8 text-xs" />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleAdd} disabled={create.isPending || !form.address.trim()}>Save</Button>
          </div>
        </div>
      )}
      {(addresses as CustomerAddress[]).length === 0 && !adding && (
        <p className="text-xs text-muted-foreground italic mb-2">No saved addresses</p>
      )}
      <div className="space-y-1.5">
        {(addresses as CustomerAddress[]).map(addr => (
          <div key={addr.id} className="flex items-start gap-2 group">
            <span className={cn("mt-0.5 p-1 rounded-md flex-shrink-0", addr.isDefault ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
              {ADDRESS_LABEL_ICONS[addr.label] ?? <MapPin className="w-3 h-3" />}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase">{addr.label}{addr.isDefault && " · Default"}</p>
              <p className="text-xs leading-tight">{addr.address}</p>
            </div>
            <button onClick={() => del.mutate({ customerId, addressId: addr.id })}
              className="opacity-0 group-hover:opacity-100 text-destructive/70 hover:text-destructive p-0.5 flex-shrink-0">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
      {!adding && (
        <Button variant="ghost" size="sm" className="w-full h-7 text-xs mt-2" onClick={() => setAdding(true)}>
          <Plus className="w-3 h-3 mr-1" /> Add address
        </Button>
      )}
    </div>
  );
}

// ─── Profile container ────────────────────────────────────────────────────

function CustomerDetailPanel({ customerId, onClose }: { customerId: number; onClose: () => void }) {
  const { data: profile, isLoading } = useCustomerProfile(customerId);
  const updateCustomer = useUpdateCustomer();
  const { toast } = useToast();
  const [tab, setTab] = useState<ProfileTab>("Overview");
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", email: "", phone: "", address: "" });

  useEffect(() => {
    if (profile && editing) {
      setEditForm({ name: profile.name, email: profile.email ?? "", phone: profile.phone ?? "", address: profile.address ?? "" });
    }
  }, [profile?.id, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!profile) return;
    try {
      await updateCustomer.mutateAsync({ id: profile.id, ...editForm });
      toast({ title: "Customer updated" });
      setEditing(false);
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  if (isLoading || !profile) {
    return (
      <div className="w-96 border-l border-border bg-card flex items-center justify-center">
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="w-96 border-l border-border bg-card flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-border flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-bold flex-shrink-0", profile.isVip ? "bg-yellow-100 text-yellow-700" : "bg-primary/15 text-primary")}>
            {profile.name[0]}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate flex items-center gap-1.5">
              {profile.name}
              {profile.isVip && <Crown className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />}
            </p>
            <p className="text-xs text-muted-foreground">Since {formatDate(profile.createdAt)}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditing(!editing)}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {editing && (
        <div className="p-4 space-y-2 border-b border-border bg-muted/10">
          <div><Label className="text-xs">Name</Label><Input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} className="h-8 text-sm" /></div>
          <div><Label className="text-xs">Email</Label><Input type="email" value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} className="h-8 text-sm" /></div>
          <div><Label className="text-xs">Phone</Label><PhoneInput value={editForm.phone} onChange={(v) => setEditForm(p => ({ ...p, phone: v }))} /></div>
          <div><Label className="text-xs">Address</Label><Input value={editForm.address} onChange={e => setEditForm(p => ({ ...p, address: e.target.value }))} className="h-8 text-sm" /></div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" className="flex-1 h-7" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" className="flex-1 h-7" onClick={handleSave} disabled={updateCustomer.isPending}>Save</Button>
          </div>
        </div>
      )}

      <div className="border-b border-border flex flex-shrink-0 overflow-x-auto">
        {PROFILE_TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors",
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "Overview" && (
          <>
            <OverviewPanel profile={profile} />
            <ManualLoyaltyAdjust customerId={profile.id} />
            <LoyaltyTwoStaffActions customerId={profile.id} />
          </>
        )}
        {tab === "Activity" && <ActivityPanel profile={profile} />}
        {tab === "Notes" && <NotesPanel customerId={profile.id} />}
        {tab === "Tags & Preferences" && <TagsPreferencesPanel profile={profile} />}
      </div>
    </div>
  );
}

function LoyaltyTwoStaffActions({ customerId }: { customerId: number }) {
  const { data: summary } = useLoyalty2Summary(customerId);
  const cashback = useLoyalty2CashbackMutate();
  const stamp = useLoyalty2AddStamp();
  const family = useLoyalty2FamilyAdd();
  const { toast } = useToast();
  const [cb, setCb] = useState({ amount: "", type: "credit" as "credit" | "redeem", reason: "" });
  const [stampForm, setStampForm] = useState({ cardKey: "", qty: "1" });
  const [familyPhone, setFamilyPhone] = useState("");

  if (!summary?.config?.enabled) return null;

  const cfg = summary.config;
  const wallet = summary.cashback;
  const stampCards = (cfg.stampCards as { id: string; name: string }[]) ?? [];

  return (
    <div className="px-4 py-3 border-t border-border space-y-4">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Loyalty 2.0</h3>

      {summary.tier?.current && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-lg p-2.5">
          <p className="text-xs font-semibold text-amber-800">{summary.tier.current.name} tier · {summary.tier.current.multiplier}× points</p>
          {summary.tier.next && (
            <p className="text-[10px] text-amber-700">Next: {summary.tier.next.name} at {Number(summary.tier.next.threshold).toLocaleString()} lifetime points</p>
          )}
        </div>
      )}

      {cfg.cashback?.enabled && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">Cashback wallet</p>
            <p className="text-sm font-bold">₹{Number(wallet?.balance ?? 0).toLocaleString()}</p>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setCb(p => ({ ...p, type: "credit" }))}
              className={cn("flex-1 text-xs py-1 rounded border", cb.type === "credit" ? "bg-green-500 text-white border-green-500" : "border-border")}>Credit</button>
            <button onClick={() => setCb(p => ({ ...p, type: "redeem" }))}
              className={cn("flex-1 text-xs py-1 rounded border", cb.type === "redeem" ? "bg-orange-500 text-white border-orange-500" : "border-border")}>Redeem</button>
          </div>
          <Input type="number" placeholder="Amount ₹" value={cb.amount} onChange={e => setCb(p => ({ ...p, amount: e.target.value }))} className="h-8 text-sm" />
          <Input placeholder="Reason" value={cb.reason} onChange={e => setCb(p => ({ ...p, reason: e.target.value }))} className="h-8 text-sm" />
          <Button size="sm" className="w-full h-8" disabled={!cb.amount || cashback.isPending}
            onClick={async () => {
              try { await cashback.mutateAsync({ customerId, amount: Number(cb.amount), type: cb.type, reason: cb.reason }); toast({ title: "Cashback updated" }); setCb({ amount: "", type: "credit", reason: "" }); }
              catch { toast({ title: "Failed", variant: "destructive" }); }
            }}>Apply</Button>
        </div>
      )}

      {stampCards.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium">Add stamp</p>
          <select value={stampForm.cardKey} onChange={e => setStampForm(p => ({ ...p, cardKey: e.target.value }))}
            className="w-full h-8 text-sm rounded-md border border-border bg-card px-2">
            <option value="">Select card</option>
            {stampCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="flex gap-2">
            <Input type="number" min="1" value={stampForm.qty} onChange={e => setStampForm(p => ({ ...p, qty: e.target.value }))} className="w-20 h-8 text-sm" />
            <Button size="sm" className="flex-1 h-8" disabled={!stampForm.cardKey || stamp.isPending}
              onClick={async () => {
                try { await stamp.mutateAsync({ customerId, cardKey: stampForm.cardKey, qty: Number(stampForm.qty) || 1 }); toast({ title: "Stamp added" }); }
                catch { toast({ title: "Failed", variant: "destructive" }); }
              }}>Stamp</Button>
          </div>
        </div>
      )}

      {cfg.family?.enabled && (
        <div className="space-y-2">
          <p className="text-xs font-medium">Family group ({summary.family?.members?.length ?? 0} members)</p>
          <div className="flex gap-2">
            <Input placeholder="Member phone" value={familyPhone} onChange={e => setFamilyPhone(e.target.value)} className="h-8 text-sm" />
            <Button size="sm" className="h-8" disabled={!familyPhone || family.isPending}
              onClick={async () => {
                try { const r = await family.mutateAsync({ customerId, phone: familyPhone }); if (!(r as any).ok) toast({ title: (r as any).reason || "Could not add", variant: "destructive" }); else { toast({ title: "Member added" }); setFamilyPhone(""); } }
                catch { toast({ title: "Failed", variant: "destructive" }); }
              }}>Add</Button>
          </div>
        </div>
      )}

      {summary.referral?.code && (
        <p className="text-xs text-muted-foreground">Referral code: <span className="font-mono font-semibold text-foreground">{summary.referral.code}</span></p>
      )}
    </div>
  );
}

function ManualLoyaltyAdjust({ customerId }: { customerId: number }) {
  const addLoyaltyPoints = useAddLoyaltyPoints();
  const { toast } = useToast();
  const [form, setForm] = useState<{ points: string; type: "earn" | "redeem" | "adjust"; reason: string }>({ points: "", type: "earn", reason: "" });
  const handle = async () => {
    if (!form.points) return;
    try {
      await addLoyaltyPoints.mutateAsync({ customerId, points: Number(form.points), type: form.type, reason: form.reason || undefined });
      toast({ title: "Points updated" });
      setForm({ points: "", type: "earn", reason: "" });
    } catch {
      toast({ title: "Failed to update points", variant: "destructive" });
    }
  };
  return (
    <div className="px-1 py-3 border-t border-border space-y-2">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Adjust loyalty points</h4>
      <div className="flex gap-2">
        {(["earn", "redeem", "adjust"] as const).map(t => (
          <button key={t} onClick={() => setForm(p => ({ ...p, type: t }))}
            className={cn("flex-1 text-xs py-1.5 rounded-lg border capitalize",
              form.type === t
                ? t === "earn" ? "bg-green-500 text-white border-green-500"
                : t === "redeem" ? "bg-orange-500 text-white border-orange-500"
                : "bg-blue-500 text-white border-blue-500"
                : "border-border text-muted-foreground")}>{t}</button>
        ))}
      </div>
      <Input type="number" min="0" placeholder="Points" value={form.points} onChange={e => setForm(p => ({ ...p, points: e.target.value }))} className="h-8 text-sm" />
      <Input placeholder="Reason (optional)" value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} className="h-8 text-sm" />
      <Button size="sm" className="w-full h-8" onClick={handle} disabled={addLoyaltyPoints.isPending || !form.points}>Update points</Button>
    </div>
  );
}

// ─── List + filters ────────────────────────────────────────────────────────

function loadColumns(): Set<ColumnKey> {
  if (typeof window === "undefined") return new Set(ALL_COLUMNS.filter(c => c.default).map(c => c.key));
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set(ALL_COLUMNS.filter(c => c.default).map(c => c.key));
}
function loadFilters(): CustomerListFilters {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function CustomersTab() {
  const [filters, setFilters] = useState<CustomerListFilters>(() => loadFilters());
  const [search, setSearch] = useState(filters.search ?? "");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", notes: "" });
  const [columns, setColumns] = useState<Set<ColumnKey>>(() => loadColumns());

  useEffect(() => {
    try { localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(Array.from(columns))); } catch { /* ignore */ }
  }, [columns]);
  useEffect(() => {
    try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters)); } catch { /* ignore */ }
  }, [filters]);

  const effectiveFilters: CustomerListFilters = useMemo(() => ({
    ...filters, search: search || undefined, page,
  }), [filters, search, page]);

  const { data: customersData } = useCustomers(effectiveFilters);
  const customers: Customer[] = customersData?.data ?? [];
  const total = customersData?.total ?? 0;

  const createCustomer = useCreateCustomer();
  const { toast } = useToast();

  const handleAdd = async () => {
    if (!form.name) return;
    try {
      await createCustomer.mutateAsync(form);
      toast({ title: "Customer added!" });
      setShowAdd(false);
      setForm({ name: "", email: "", phone: "", address: "", notes: "" });
    } catch {
      toast({ title: "Failed to add customer", variant: "destructive" });
    }
  };

  const activeFilterCount =
    (filters.tag ? 1 : 0) + (filters.vip ? 1 : 0) + (filters.preferredChannel ? 1 : 0) +
    (filters.whatsappOptIn !== undefined ? 1 : 0) + (filters.hasComplaints ? 1 : 0) +
    (filters.lastVisitFrom || filters.lastVisitTo ? 1 : 0) + (filters.birthdayMonth ? 1 : 0) +
    (filters.anniversaryMonth ? 1 : 0) + (filters.tier ? 1 : 0);

  return (
    <div className="flex gap-0 h-full">
      <div className={cn("flex-1 min-w-0", selectedId && "hidden lg:block")}>
        <div className="flex gap-3 mb-4 items-center justify-between flex-wrap">
          <div className="flex gap-2 items-center flex-wrap">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search customers..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9 w-56" />
            </div>
            <FilterPopover filters={filters} onChange={(f) => { setFilters(f); setPage(1); }} activeCount={activeFilterCount} />
            <ColumnsPopover columns={columns} onChange={setColumns} />
          </div>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Add Customer
          </Button>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Customer</th>
                  {columns.has("contact") && <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Contact</th>}
                  {columns.has("tags") && <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Tags</th>}
                  {columns.has("orders") && <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Orders</th>}
                  {columns.has("spent") && <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Spent</th>}
                  {columns.has("aov") && <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">AOV</th>}
                  {columns.has("loyalty") && <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Loyalty</th>}
                  {columns.has("lastVisit") && <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Last visit</th>}
                  {columns.has("frequency") && <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Frequency</th>}
                  {columns.has("channel") && <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden xl:table-cell">Channel</th>}
                  {columns.has("birthday") && <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden xl:table-cell">Birthday</th>}
                </tr>
              </thead>
              <tbody>
                {customers.map(c => (
                  <tr key={c.id} className={cn("border-b border-border last:border-0 hover:bg-muted/10 cursor-pointer transition-colors", selectedId === c.id && "bg-primary/5 border-l-2 border-l-primary")} onClick={() => setSelectedId(selectedId === c.id ? null : c.id)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0", c.isVip ? "bg-yellow-100 text-yellow-700" : "bg-primary/15 text-primary")}>
                          {c.name[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate flex items-center gap-1">
                            {c.name}
                            {c.isVip && <Crown className="w-3 h-3 text-yellow-500" />}
                          </p>
                          <p className="text-xs text-muted-foreground">Since {formatDate(c.createdAt)}</p>
                        </div>
                      </div>
                    </td>
                    {columns.has("contact") && (
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="space-y-0.5">
                          {c.email && <p className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="w-3 h-3" />{c.email}</p>}
                          {c.phone && <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</p>}
                        </div>
                      </td>
                    )}
                    {columns.has("tags") && (
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {(c.tags ?? []).slice(0, 3).map(t => <Badge key={t.id} variant="secondary" className="text-[10px] px-1.5 py-0">{t.name}</Badge>)}
                          {(c.tags ?? []).length > 3 && <span className="text-[10px] text-muted-foreground">+{(c.tags ?? []).length - 3}</span>}
                        </div>
                      </td>
                    )}
                    {columns.has("orders") && (
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex items-center gap-1 text-sm"><ShoppingBag className="w-3.5 h-3.5 text-muted-foreground" /><span className="font-medium tabular-nums">{c.totalOrders}</span></div>
                      </td>
                    )}
                    {columns.has("spent") && (
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-sm font-semibold tabular-nums">₹{Number(c.totalSpent).toLocaleString()}</span>
                      </td>
                    )}
                    {columns.has("aov") && (
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-sm tabular-nums">₹{(c.averageOrderValue ?? 0).toLocaleString()}</span>
                      </td>
                    )}
                    {columns.has("loyalty") && (
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="flex items-center gap-1 text-sm"><Star className="w-3.5 h-3.5 text-yellow-500" /><span className="tabular-nums">{c.loyaltyPoints}</span></div>
                      </td>
                    )}
                    {columns.has("lastVisit") && (
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">{relativeTime(c.lastVisitAt)}</td>
                    )}
                    {columns.has("frequency") && (
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground tabular-nums">
                        {c.visitFrequencyDays != null ? `every ${c.visitFrequencyDays}d` : "—"}
                      </td>
                    )}
                    {columns.has("channel") && (
                      <td className="px-4 py-3 hidden xl:table-cell">
                        <span className="text-xs capitalize">{c.preferredChannel}</span>
                        {c.whatsappOptIn && <Check className="inline w-3 h-3 text-green-600 ml-1" />}
                      </td>
                    )}
                    {columns.has("birthday") && (
                      <td className="px-4 py-3 hidden xl:table-cell text-xs text-muted-foreground">
                        {c.birthday ? monthDay(c.birthday) : "—"}
                      </td>
                    )}
                  </tr>
                ))}
                {customers.length === 0 && (
                  <tr><td colSpan={ALL_COLUMNS.length + 1} className="text-center py-12 text-muted-foreground">
                    <Users className="w-10 h-10 mx-auto mb-2 opacity-20" />
                    No customers found
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {total > 20 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-muted-foreground">Showing {customers.length} of {total}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {selectedId !== null && (
        <CustomerDetailPanel
          key={selectedId}
          customerId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Add Customer</h2>
              <button onClick={() => setShowAdd(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div><Label>Name *</Label><Input placeholder="Full name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
              <div><Label>Phone</Label><PhoneInput value={form.phone} onChange={(v) => setForm(p => ({ ...p, phone: v }))} /></div>
              <div><Label>Address</Label><Input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} /></div>
              <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleAdd} disabled={createCustomer.isPending || !form.name}>Add</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterPopover({ filters, onChange, activeCount }: { filters: CustomerListFilters; onChange: (f: CustomerListFilters) => void; activeCount: number }) {
  const { data: tagDictionary = [] } = useCustomerTags();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Filter className="w-3.5 h-3.5" /> Filter
          {activeCount > 0 && <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 text-[10px]">{activeCount}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Filters</h4>
          {activeCount > 0 && <button onClick={() => onChange({})} className="text-xs text-muted-foreground hover:text-foreground">Clear all</button>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Tag</Label>
            <Select value={filters.tag ?? "__all"} onValueChange={v => onChange({ ...filters, tag: v === "__all" ? undefined : v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Any tag</SelectItem>
                {tagDictionary.map(t => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Channel</Label>
            <Select value={filters.preferredChannel ?? "__all"} onValueChange={v => onChange({ ...filters, preferredChannel: v === "__all" ? undefined : (v as CustomerPreferredChannel) })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Any channel</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="call">Call</SelectItem>
                <SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Last visit from</Label>
            <Input type="date" value={filters.lastVisitFrom ?? ""} onChange={e => onChange({ ...filters, lastVisitFrom: e.target.value || undefined })} className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs">Last visit to</Label>
            <Input type="date" value={filters.lastVisitTo ?? ""} onChange={e => onChange({ ...filters, lastVisitTo: e.target.value || undefined })} className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs">Birthday month</Label>
            <Select value={filters.birthdayMonth ? String(filters.birthdayMonth) : "__all"} onValueChange={v => onChange({ ...filters, birthdayMonth: v === "__all" ? undefined : Number(v) })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Any month</SelectItem>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <SelectItem key={m} value={String(m)}>{new Date(2024, m - 1, 1).toLocaleDateString("en", { month: "long" })}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Anniversary month</Label>
            <Select value={filters.anniversaryMonth ? String(filters.anniversaryMonth) : "__all"} onValueChange={v => onChange({ ...filters, anniversaryMonth: v === "__all" ? undefined : Number(v) })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Any month</SelectItem>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <SelectItem key={m} value={String(m)}>{new Date(2024, m - 1, 1).toLocaleDateString("en", { month: "long" })}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Loyalty tier</Label>
            <Select
              value={filters.tier && filters.tier !== "custom" ? filters.tier : "__all"}
              onValueChange={v => onChange({ ...filters, tier: v === "__all" ? undefined : v, tierMin: undefined })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Any tier</SelectItem>
                <SelectItem value="bronze">Bronze (0–999)</SelectItem>
                <SelectItem value="silver">Silver (1,000–4,999)</SelectItem>
                <SelectItem value="gold">Gold (5,000+)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Min loyalty pts (advanced)</Label>
            <Input type="number" min="0" value={filters.tierMin ?? ""} onChange={e => onChange({ ...filters, tierMin: e.target.value ? Number(e.target.value) : undefined, tier: e.target.value ? "custom" : undefined })} className="h-8 text-xs" />
          </div>
        </div>
        <div className="space-y-2 pt-1 border-t border-border">
          <label className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5"><Crown className="w-3.5 h-3.5 text-yellow-500" /> VIP only</span>
            <Switch checked={!!filters.vip} onCheckedChange={v => onChange({ ...filters, vip: v || undefined })} />
          </label>
          <label className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> WhatsApp opted in</span>
            <Switch checked={filters.whatsappOptIn === true} onCheckedChange={v => onChange({ ...filters, whatsappOptIn: v ? true : undefined })} />
          </label>
          <label className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 text-red-500" /> Open complaints</span>
            <Switch checked={!!filters.hasComplaints} onCheckedChange={v => onChange({ ...filters, hasComplaints: v || undefined })} />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ColumnsPopover({ columns, onChange }: { columns: Set<ColumnKey>; onChange: (s: Set<ColumnKey>) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5"><Columns3 className="w-3.5 h-3.5" /> Columns</Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-3 space-y-1.5">
        <h4 className="text-xs font-semibold mb-1">Visible columns</h4>
        {ALL_COLUMNS.map(c => (
          <label key={c.key} className="flex items-center justify-between text-sm py-1">
            <span>{c.label}</span>
            <Switch checked={columns.has(c.key)} onCheckedChange={v => {
              const next = new Set(columns);
              if (v) next.add(c.key); else next.delete(c.key);
              onChange(next);
            }} />
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ─── Coupons (kept as-is) ──────────────────────────────────────────────────

function CouponsTab() {
  const { data: coupons = [] } = useCoupons();
  const createCoupon = useCreateCoupon();
  const updateCoupon = useUpdateCoupon();
  const deleteCoupon = useDeleteCoupon();
  const { toast } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ code: "", discountType: "percentage" as "percentage" | "flat", discountValue: "", minOrderAmount: "", maxDiscountAmount: "", usageLimit: "", validFrom: "", validTo: "" });

  const handleCreate = async () => {
    if (!form.code || !form.discountValue) return;
    try {
      await createCoupon.mutateAsync({
        code: form.code,
        discountType: form.discountType,
        discountValue: form.discountValue,
        minOrderAmount: form.minOrderAmount || undefined,
        maxDiscountAmount: form.maxDiscountAmount || undefined,
        usageLimit: form.usageLimit ? Number(form.usageLimit) : undefined,
        validFrom: form.validFrom || undefined,
        validTo: form.validTo || undefined,
      });
      toast({ title: "Coupon created!" });
      setShowAdd(false);
      setForm({ code: "", discountType: "percentage", discountValue: "", minOrderAmount: "", maxDiscountAmount: "", usageLimit: "", validFrom: "", validTo: "" });
    } catch {
      toast({ title: "Failed to create coupon", variant: "destructive" });
    }
  };

  const handleToggle = async (c: Coupon) => {
    try {
      await updateCoupon.mutateAsync({ id: c.id, isActive: !c.isActive });
      toast({ title: c.isActive ? "Coupon deactivated" : "Coupon activated" });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  const handleDelete = async (c: Coupon) => {
    if (!confirm(`Delete coupon "${c.code}"?`)) return;
    try {
      await deleteCoupon.mutateAsync(c.id);
      toast({ title: "Coupon deleted" });
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  const isExpired = (c: Coupon) => c.validTo ? new Date(c.validTo) < new Date() : false;
  const isLimitReached = (c: Coupon) => c.usageLimit !== null && c.usageCount >= (c.usageLimit ?? 0);

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Create Coupon
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(coupons as Coupon[]).map(c => {
          const expired = isExpired(c);
          const limitReached = isLimitReached(c);
          const effectivelyActive = c.isActive && !expired && !limitReached;

          return (
            <div key={c.id} className={cn("bg-card border rounded-xl p-4 relative overflow-hidden", effectivelyActive ? "border-border" : "border-border/50 opacity-70")}>
              <div className={cn("absolute top-0 left-0 right-0 h-1", effectivelyActive ? "bg-primary" : "bg-muted")} />
              <div className="flex items-start justify-between mb-3 mt-1">
                <div className="flex items-center gap-2">
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", effectivelyActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                    <Tag className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-mono font-bold text-sm">{c.code}</p>
                    <p className="text-xs text-muted-foreground capitalize">{c.discountType} discount</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => handleToggle(c)} className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", effectivelyActive ? "bg-green-100 text-green-700 border-green-200" : "bg-gray-100 text-gray-600 border-gray-200")}>
                    {effectivelyActive ? "Active" : expired ? "Expired" : limitReached ? "Used up" : "Inactive"}
                  </button>
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(c)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Discount</span><span className="text-sm font-bold text-primary">{c.discountType === "percentage" ? `${c.discountValue}%` : `₹${c.discountValue}`} off</span></div>
                {c.minOrderAmount && Number(c.minOrderAmount) > 0 && (<div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Min order</span><span className="text-xs font-medium">₹{Number(c.minOrderAmount).toLocaleString()}</span></div>)}
                {c.maxDiscountAmount && (<div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Max discount</span><span className="text-xs font-medium">₹{Number(c.maxDiscountAmount).toLocaleString()}</span></div>)}
                <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Used</span><span className="text-xs font-medium">{c.usageCount}{c.usageLimit ? ` / ${c.usageLimit}` : ""} times</span></div>
                {c.validTo && (<div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Valid until</span><span className={cn("text-xs font-medium", expired ? "text-red-500" : "")}>{formatDate(c.validTo)}</span></div>)}
              </div>
            </div>
          );
        })}

        {(coupons as Coupon[]).length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            <Gift className="w-10 h-10 mx-auto mb-2 opacity-20" />
            No coupons yet. Create your first discount code.
          </div>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Create Coupon</h2>
              <button onClick={() => setShowAdd(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div><Label>Coupon Code *</Label><Input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="e.g. SAVE20" className="font-mono uppercase" /></div>
              <div>
                <Label>Discount Type</Label>
                <div className="flex gap-2 mt-1">
                  {[{ k: "percentage", label: "Percentage (%)" }, { k: "flat", label: "Flat (₹)" }].map(({ k, label }) => (
                    <button key={k} onClick={() => setForm(p => ({ ...p, discountType: k as "percentage" | "flat" }))} className={cn("flex-1 text-sm py-2 rounded-lg border", form.discountType === k ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted/50")}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div><Label>Discount Value *</Label><Input type="number" min="0" step="0.01" value={form.discountValue} onChange={e => setForm(p => ({ ...p, discountValue: e.target.value }))} placeholder={form.discountType === "percentage" ? "e.g. 20 for 20%" : "e.g. 50 for ₹50 off"} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Min Order Amount (₹)</Label><Input type="number" min="0" value={form.minOrderAmount} onChange={e => setForm(p => ({ ...p, minOrderAmount: e.target.value }))} placeholder="0" /></div>
                {form.discountType === "percentage" && (<div><Label>Max Discount (₹)</Label><Input type="number" min="0" value={form.maxDiscountAmount} onChange={e => setForm(p => ({ ...p, maxDiscountAmount: e.target.value }))} placeholder="No cap" /></div>)}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Usage Limit</Label><Input type="number" min="1" value={form.usageLimit} onChange={e => setForm(p => ({ ...p, usageLimit: e.target.value }))} placeholder="Unlimited" /></div>
                <div><Label>Valid Until</Label><Input type="date" value={form.validTo} onChange={e => setForm(p => ({ ...p, validTo: e.target.value }))} /></div>
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleCreate} disabled={createCoupon.isPending || !form.code || !form.discountValue}>Create Coupon</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CustomersPage() {
  const [tab, setTab] = useState<Tab>("Customers");
  const { data: customersData } = useCustomers({});
  const total = customersData?.total ?? 0;

  return (
    <Layout>
      <PageHeader
        title="Customers"
        subtitle={`${total} registered customers`}
      />
      <div className="p-6 flex flex-col h-[calc(100vh-140px)]">
        <div className="flex gap-1 mb-6 bg-muted/40 rounded-xl p-1 w-fit flex-shrink-0">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
                tab === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "Customers" && <Users className="w-3.5 h-3.5" />}
              {t === "Coupons" && <Tag className="w-3.5 h-3.5" />}
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 flex">
          {tab === "Customers" && <CustomersTab />}
          {tab === "Coupons" && <div className="flex-1 overflow-y-auto"><CouponsTab /></div>}
        </div>
      </div>
    </Layout>
  );
}
