import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  useInventory,
  useWasteEntries,
  useWasteReasons,
  useCreateWasteEntry,
  useApproveWasteEntry,
  useRejectWasteEntry,
  useDonateWasteEntry,
  useWasteSettings,
  useUpdateWasteSettings,
  useCreateWasteReason,
  useUpdateWasteReason,
  useWasteSummary,
  useWasteByReason,
  useWasteByStaff,
  useWasteByItem,
  useRestaurantId,
} from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiPost, getApiUrl } from "@/lib/api";
import {
  Trash2, CheckCircle2, XCircle, HandHeart, Plus, Upload, Loader2,
  AlertTriangle, TrendingDown, ClipboardList, BarChart3, Settings as SettingsIcon, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { format } from "date-fns";
import type { WasteEntry, WasteType } from "@/lib/types";

const TABS = [
  { key: "record", label: "Record Waste", icon: Plus },
  { key: "pending", label: "Pending Approval", icon: ClipboardList },
  { key: "donations", label: "Donations", icon: HandHeart },
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: SettingsIcon },
] as const;
type TabKey = typeof TABS[number]["key"];

const WASTE_TYPES: { value: WasteType; label: string }[] = [
  { value: "wastage", label: "Wastage" },
  { value: "spoilage", label: "Spoilage" },
  { value: "expired", label: "Expired" },
  { value: "overproduction", label: "Overproduction" },
  { value: "leftover", label: "Leftover" },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  rejected: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  donated: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
};

const PIE_COLORS = ["#f97316", "#eab308", "#ef4444", "#8b5cf6", "#0ea5e9", "#22c55e"];

function formatINR(n: number | string): string {
  const num = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(num)) return "₹0";
  return `₹${num.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", STATUS_COLORS[status] ?? "bg-slate-100 text-slate-700")}>
      {status}
    </span>
  );
}

export default function WastePage() {
  const [tab, setTab] = useState<TabKey>("record");
  const { user } = useAuth();
  const isManager = user?.isSuperAdmin || user?.role === "owner" || user?.role === "manager";

  return (
    <Layout>
      <PageHeader title="Waste Management" subtitle="Record, approve, donate and analyze food waste" />
      <div className="px-6 pt-4">
        <div className="flex flex-wrap gap-1 border-b border-border mb-4">
          {TABS.map(t => {
            if (t.key === "settings" && !isManager) return null;
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === "record" && <RecordTab />}
        {tab === "pending" && <PendingTab isManager={isManager} />}
        {tab === "donations" && <DonationsTab isManager={isManager} />}
        {tab === "reports" && <ReportsTab />}
        {tab === "settings" && isManager && <SettingsTab />}
      </div>
    </Layout>
  );
}

// ------------------------------ Record ------------------------------

function RecordTab() {
  const { toast } = useToast();
  const rid = useRestaurantId();
  const { data: items = [] } = useInventory();
  const { data: reasons = [] } = useWasteReasons();
  const createMut = useCreateWasteEntry();
  const [form, setForm] = useState({
    inventoryItemId: 0,
    quantity: "" as string,
    wasteType: "wastage" as WasteType,
    reasonId: 0,
    reasonText: "",
    station: "",
    note: "",
    photoUrl: "",
  });
  const [uploadBusy, setUploadBusy] = useState(false);

  const selectedItem = items.find(i => i.id === form.inventoryItemId);
  const estCost = selectedItem && form.quantity ? Number(selectedItem.costPerUnit) * Number(form.quantity) : 0;
  const activeReasons = reasons.filter(r => r.isActive);

  const submit = async () => {
    if (!form.inventoryItemId || !form.quantity || Number(form.quantity) <= 0) {
      toast({ title: "Pick an item and quantity > 0", variant: "destructive" });
      return;
    }
    try {
      await createMut.mutateAsync({
        inventoryItemId: form.inventoryItemId,
        quantity: form.quantity,
        wasteType: form.wasteType,
        reasonId: form.reasonId || null,
        reasonText: form.reasonText || null,
        station: form.station || null,
        note: form.note || null,
        photoUrl: form.photoUrl || null,
      });
      toast({ title: "Waste entry recorded" });
      setForm({ inventoryItemId: 0, quantity: "", wasteType: "wastage", reasonId: 0, reasonText: "", station: "", note: "", photoUrl: "" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to record";
      toast({ title: msg, variant: "destructive" });
    }
  };

  const onPickPhoto = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please pick an image", variant: "destructive" });
      return;
    }
    setUploadBusy(true);
    try {
      const presign = await apiPost<{ uploadURL: string; objectPath: string }>(
        `/restaurants/${rid}/storage/uploads/request-url`,
        { name: file.name, size: file.size, contentType: file.type },
      );
      const put = await fetch(presign.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!put.ok) throw new Error("Upload failed");
      await apiPost(`/restaurants/${rid}/storage/uploads/finalize`, { objectPath: presign.objectPath });
      setForm(f => ({ ...f, photoUrl: presign.objectPath }));
      toast({ title: "Photo attached" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setUploadBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="p-5 lg:col-span-2 space-y-4">
        <h3 className="font-semibold text-lg">New Waste Entry</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground font-medium">Inventory Item *</label>
            <select
              className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={form.inventoryItemId}
              onChange={e => setForm(f => ({ ...f, inventoryItemId: Number(e.target.value) }))}
            >
              <option value={0}>Select item…</option>
              {items.map(i => (
                <option key={i.id} value={i.id}>{i.name} ({i.unit}) — stock {Number(i.currentStock).toFixed(2)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-medium">Quantity * {selectedItem ? `(${selectedItem.unit})` : ""}</label>
            <Input
              type="number"
              step="0.001"
              min="0"
              value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
              placeholder="0"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-medium">Waste Type</label>
            <select
              className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={form.wasteType}
              onChange={e => setForm(f => ({ ...f, wasteType: e.target.value as WasteType }))}
            >
              {WASTE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-medium">Reason</label>
            <select
              className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={form.reasonId}
              onChange={e => setForm(f => ({ ...f, reasonId: Number(e.target.value) }))}
            >
              <option value={0}>— Select reason —</option>
              {activeReasons.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground font-medium">Reason details (optional)</label>
            <Input
              value={form.reasonText}
              onChange={e => setForm(f => ({ ...f, reasonText: e.target.value }))}
              placeholder="e.g. fridge left open overnight"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-medium">Station / Area</label>
            <Input
              value={form.station}
              onChange={e => setForm(f => ({ ...f, station: e.target.value }))}
              placeholder="e.g. Tandoor, Cold Storage"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-medium">Photo</label>
            <div className="mt-1 flex items-center gap-2">
              <label className="inline-flex items-center gap-2 px-3 h-10 rounded-md border border-input bg-background text-sm cursor-pointer hover:bg-muted">
                {uploadBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {form.photoUrl ? "Replace" : "Attach photo"}
                <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void onPickPhoto(f); e.target.value = ""; }} />
              </label>
              {form.photoUrl && (
                <Button variant="ghost" size="sm" onClick={() => setForm(f => ({ ...f, photoUrl: "" }))}>Remove</Button>
              )}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground font-medium">Note</label>
            <Input
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              placeholder="Additional context for managers"
              className="mt-1"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <div className="text-sm">
            <span className="text-muted-foreground">Estimated cost: </span>
            <span className="font-semibold">{formatINR(estCost)}</span>
          </div>
          <Button onClick={submit} disabled={createMut.isPending}>
            {createMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Submit for approval
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold text-lg mb-2 flex items-center gap-2"><Trash2 className="w-4 h-4" /> How it works</h3>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Staff record the waste with item, quantity and reason.</li>
          <li>Managers approve (deducts inventory) or reject the entry.</li>
          <li>Optionally mark approved waste as donated to a recipient.</li>
          <li>Cost trends and accountability appear in Reports.</li>
        </ol>
        <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200/50 dark:border-amber-500/20 text-xs text-amber-800 dark:text-amber-300 flex gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>Stock is only deducted once an entry is approved or marked donated — no double-deduction.</span>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------ Pending ------------------------------

function PendingTab({ isManager }: { isManager: boolean }) {
  const { data: entries = [], isLoading } = useWasteEntries({ status: "pending" });
  return (
    <div>
      <EntriesTable entries={entries} loading={isLoading} isManager={isManager} showActions />
    </div>
  );
}

function EntriesTable({ entries, loading, isManager, showActions, showDonate }: {
  entries: WasteEntry[]; loading: boolean; isManager: boolean; showActions?: boolean; showDonate?: boolean;
}) {
  const { toast } = useToast();
  const approveMut = useApproveWasteEntry();
  const rejectMut = useRejectWasteEntry();
  const donateMut = useDonateWasteEntry();
  const [donateFor, setDonateFor] = useState<WasteEntry | null>(null);
  const [donateForm, setDonateForm] = useState({ donationRecipient: "", donationPickupAt: "", donationNote: "" });

  if (loading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading…</div>;
  if (!entries.length) return <div className="text-sm text-muted-foreground py-12 text-center">No entries yet.</div>;

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2.5">When</th>
              <th className="text-left px-4 py-2.5">Item</th>
              <th className="text-right px-4 py-2.5">Qty</th>
              <th className="text-left px-4 py-2.5">Type / Reason</th>
              <th className="text-left px-4 py-2.5">Recorded by</th>
              <th className="text-right px-4 py-2.5">Cost</th>
              <th className="text-left px-4 py-2.5">Status</th>
              {showActions && <th className="text-right px-4 py-2.5">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.map(e => (
              <tr key={e.id} className="hover:bg-muted/20">
                <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                  {format(new Date(e.createdAt), "dd MMM, HH:mm")}
                </td>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{e.itemName ?? `#${e.inventoryItemId}`}</div>
                  {e.station && <div className="text-xs text-muted-foreground">{e.station}</div>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{Number(e.quantity).toFixed(2)} {e.unit}</td>
                <td className="px-4 py-2.5">
                  <div className="capitalize">{e.wasteType}</div>
                  <div className="text-xs text-muted-foreground">{e.reasonLabel ?? e.reasonText ?? "—"}</div>
                </td>
                <td className="px-4 py-2.5 text-xs">{e.recordedByName ?? "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatINR(e.totalCost)}</td>
                <td className="px-4 py-2.5"><StatusBadge status={e.status} /></td>
                {showActions && (
                  <td className="px-4 py-2.5 text-right space-x-2 whitespace-nowrap">
                    {isManager && e.status === "pending" && (
                      <>
                        <Button size="sm" variant="outline" onClick={async () => {
                          try { await approveMut.mutateAsync(e.id); toast({ title: "Approved" }); }
                          catch (err) { toast({ title: err instanceof Error ? err.message : "Failed", variant: "destructive" }); }
                        }}>
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={async () => {
                          const note = window.prompt("Reason for rejection (optional):") ?? "";
                          try { await rejectMut.mutateAsync({ id: e.id, rejectionNote: note || undefined }); toast({ title: "Rejected" }); }
                          catch (err) { toast({ title: err instanceof Error ? err.message : "Failed", variant: "destructive" }); }
                        }}>
                          <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                        </Button>
                      </>
                    )}
                    {isManager && showDonate && (e.status === "pending" || e.status === "approved") && (
                      <Button size="sm" variant="outline" onClick={() => { setDonateFor(e); setDonateForm({ donationRecipient: "", donationPickupAt: "", donationNote: "" }); }}>
                        <HandHeart className="w-3.5 h-3.5 mr-1" /> Donate
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {donateFor && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setDonateFor(null)}>
          <Card className="p-5 w-full max-w-md space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold">Mark as donated</h3>
            <div className="text-sm text-muted-foreground">{donateFor.itemName} — {Number(donateFor.quantity).toFixed(2)} {donateFor.unit} ({formatINR(donateFor.totalCost)})</div>
            <div>
              <label className="text-xs text-muted-foreground font-medium">Recipient *</label>
              <Input value={donateForm.donationRecipient} onChange={e => setDonateForm(f => ({ ...f, donationRecipient: e.target.value }))} placeholder="e.g. Akshaya Patra" className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium">Pickup time</label>
              <Input type="datetime-local" value={donateForm.donationPickupAt} onChange={e => setDonateForm(f => ({ ...f, donationPickupAt: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium">Note</label>
              <Input value={donateForm.donationNote} onChange={e => setDonateForm(f => ({ ...f, donationNote: e.target.value }))} className="mt-1" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setDonateFor(null)}>Cancel</Button>
              <Button onClick={async () => {
                if (!donateForm.donationRecipient.trim()) { toast({ title: "Recipient required", variant: "destructive" }); return; }
                try {
                  await donateMut.mutateAsync({ id: donateFor.id, ...donateForm, donationPickupAt: donateForm.donationPickupAt || undefined });
                  toast({ title: "Marked as donated" });
                  setDonateFor(null);
                } catch (err) {
                  toast({ title: err instanceof Error ? err.message : "Failed", variant: "destructive" });
                }
              }}>Confirm donation</Button>
            </div>
          </Card>
        </div>
      )}
    </Card>
  );
}

// ------------------------------ Donations ------------------------------

function DonationsTab({ isManager }: { isManager: boolean }) {
  const { data: approved = [], isLoading: l1 } = useWasteEntries({ status: "approved" });
  const { data: donated = [], isLoading: l2 } = useWasteEntries({ status: "donated" });
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold mb-2">Eligible for donation (approved)</h3>
        <EntriesTable entries={approved} loading={l1} isManager={isManager} showActions showDonate />
      </div>
      <div>
        <h3 className="font-semibold mb-2">Donated</h3>
        <DonatedTable entries={donated} loading={l2} />
      </div>
    </div>
  );
}

function DonatedTable({ entries, loading }: { entries: WasteEntry[]; loading: boolean }) {
  if (loading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading…</div>;
  if (!entries.length) return <div className="text-sm text-muted-foreground py-8 text-center">No donations recorded.</div>;
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2.5">When</th>
              <th className="text-left px-4 py-2.5">Item</th>
              <th className="text-right px-4 py-2.5">Qty</th>
              <th className="text-left px-4 py-2.5">Recipient</th>
              <th className="text-left px-4 py-2.5">Pickup</th>
              <th className="text-right px-4 py-2.5">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.map(e => (
              <tr key={e.id}>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{format(new Date(e.createdAt), "dd MMM, HH:mm")}</td>
                <td className="px-4 py-2.5">{e.itemName ?? `#${e.inventoryItemId}`}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{Number(e.quantity).toFixed(2)} {e.unit}</td>
                <td className="px-4 py-2.5">{e.donationRecipient ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{e.donationPickupAt ? format(new Date(e.donationPickupAt), "dd MMM HH:mm") : "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatINR(e.totalCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ------------------------------ Reports ------------------------------

function ReportsTab() {
  const rid = useRestaurantId();
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, []);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today.toISOString().slice(0, 10));

  const { data: summary } = useWasteSummary({ from, to });
  const { data: byReason = [] } = useWasteByReason({ from, to });
  const { data: byStaff = [] } = useWasteByStaff({ from, to });
  const { data: byItem = [] } = useWasteByItem({ from, to });

  const totals = summary?.totals;
  const trendData = summary?.trend.map(t => ({ day: t.day, cost: Number(t.cost), count: t.count })) ?? [];
  const typeData = summary?.byType.map(t => ({ name: t.wasteType, value: Number(t.cost) })) ?? [];

  const exportUrl = getApiUrl(`/restaurants/${rid}/waste/export.csv?from=${from}&to=${to}`);

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-muted-foreground font-medium">From</label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-1 w-[170px]" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium">To</label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="mt-1 w-[170px]" />
        </div>
        <div className="ml-auto">
          <a href={exportUrl} target="_blank" rel="noreferrer">
            <Button variant="outline"><Download className="w-4 h-4 mr-2" /> Export CSV</Button>
          </a>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total entries</div>
          <div className="text-2xl font-bold">{totals?.totalEntries ?? 0}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Approved cost</div>
          <div className="text-2xl font-bold text-rose-600 dark:text-rose-400">{formatINR(totals?.approvedCost ?? "0")}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Donated value</div>
          <div className="text-2xl font-bold text-sky-600 dark:text-sky-400">{formatINR(totals?.donatedCost ?? "0")}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Pending</div>
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{totals?.pendingCount ?? 0}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Daily waste cost</h3>
            <TrendingDown className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area type="monotone" dataKey="cost" stroke="#f97316" fill="#f97316" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold mb-2">By type</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={typeData} dataKey="value" nameKey="name" outerRadius={80} label>
                  {typeData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => formatINR(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Top items by cost</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byItem.slice(0, 8).map(b => ({ name: b.itemName ?? "—", cost: Number(b.cost) }))}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => formatINR(v)} />
                <Bar dataKey="cost" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold mb-3">By reason</h3>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left py-2">Reason</th>
                <th className="text-right py-2">Count</th>
                <th className="text-right py-2">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {byReason.length === 0 && <tr><td colSpan={3} className="text-center py-6 text-muted-foreground text-xs">No data</td></tr>}
              {byReason.map((r, i) => (
                <tr key={i}>
                  <td className="py-2">{r.reasonLabel ?? r.reasonText ?? "—"}</td>
                  <td className="py-2 text-right tabular-nums">{r.count}</td>
                  <td className="py-2 text-right tabular-nums font-medium">{formatINR(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Staff accountability</h3>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left py-2">Staff</th>
              <th className="text-right py-2">Total entries</th>
              <th className="text-right py-2">Approved</th>
              <th className="text-right py-2">Rejected</th>
              <th className="text-right py-2">Approved cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {byStaff.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-muted-foreground text-xs">No data</td></tr>}
            {byStaff.map((r, i) => (
              <tr key={i}>
                <td className="py-2">{r.userName ?? "—"}</td>
                <td className="py-2 text-right tabular-nums">{r.count}</td>
                <td className="py-2 text-right tabular-nums">{r.approvedCount}</td>
                <td className="py-2 text-right tabular-nums">{r.rejectedCount}</td>
                <td className="py-2 text-right tabular-nums font-medium">{formatINR(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ------------------------------ Settings ------------------------------

function SettingsTab() {
  const { toast } = useToast();
  const { data: settings } = useWasteSettings();
  const { data: reasons = [] } = useWasteReasons();
  const updateSettings = useUpdateWasteSettings();
  const createReason = useCreateWasteReason();
  const updateReason = useUpdateWasteReason();
  const [threshold, setThreshold] = useState("");
  const [autoApprove, setAutoApprove] = useState(false);
  const [newReason, setNewReason] = useState("");

  // Sync local state when settings load
  useMemo(() => {
    if (settings) {
      setThreshold(settings.approvalThreshold);
      setAutoApprove(settings.autoApproveBelowThreshold);
    }
  }, [settings]);

  const saveSettings = async () => {
    try {
      await updateSettings.mutateAsync({ approvalThreshold: threshold, autoApproveBelowThreshold: autoApprove });
      toast({ title: "Saved" });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-5 space-y-3">
        <h3 className="font-semibold">Approval threshold</h3>
        <p className="text-sm text-muted-foreground">When auto-approval is enabled, entries created by managers/owners with a total cost below this amount are approved instantly. Staff entries always require manager approval.</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground font-medium">Threshold (₹)</label>
            <Input type="number" min="0" step="1" value={threshold} onChange={e => setThreshold(e.target.value)} className="mt-1" />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} />
              Auto-approve below threshold
            </label>
          </div>
        </div>
        <Button onClick={saveSettings} disabled={updateSettings.isPending}>Save</Button>
      </Card>

      <Card className="p-5 space-y-3">
        <h3 className="font-semibold">Waste reasons</h3>
        <div className="flex gap-2">
          <Input value={newReason} onChange={e => setNewReason(e.target.value)} placeholder="New reason label" />
          <Button onClick={async () => {
            if (!newReason.trim()) return;
            try { await createReason.mutateAsync({ label: newReason.trim() }); setNewReason(""); toast({ title: "Added" }); }
            catch (e) { toast({ title: e instanceof Error ? e.message : "Failed", variant: "destructive" }); }
          }}>Add</Button>
        </div>
        <div className="divide-y divide-border">
          {reasons.map(r => (
            <div key={r.id} className="flex items-center justify-between py-2">
              <div>
                <div className={cn("font-medium", !r.isActive && "line-through text-muted-foreground")}>{r.label}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={async () => {
                try { await updateReason.mutateAsync({ id: r.id, isActive: !r.isActive }); toast({ title: r.isActive ? "Disabled" : "Enabled" }); }
                catch (e) { toast({ title: e instanceof Error ? e.message : "Failed", variant: "destructive" }); }
              }}>{r.isActive ? "Disable" : "Enable"}</Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
