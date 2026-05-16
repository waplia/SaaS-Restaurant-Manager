import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Cake, Plus, Trash2, AlertTriangle, Package, ChefHat, Calendar as CalendarIcon, FileText, ShoppingBag } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useRestaurantId, useRestaurantInfo, useMenuItems } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

type Plan = { id: number; planDate: string; status: string; notes: string | null };
type PlanItem = { id: number; menuItemId: number; plannedQuantity: string; producedQuantity: string; status: string; notes: string | null };
type PlanDetail = { plan: Plan; items: Array<{ item: PlanItem; menuItem: { id: number; name: string; price: string; isCake: boolean } | null }> };
type Batch = { batch: { id: number; batchNumber: string; menuItemId: number; quantityProduced: string; quantityRemaining: string; producedAt: string; expiryAt: string | null; status: string; storageLocation: string | null; unitCost: string }; menuItemName: string | null };
type Wastage = { wastage: { id: number; quantity: string; reason: string; createdAt: string; notes: string | null }; menuItemName: string | null; batchNumber: string | null; unitCost: string | null };
type Booking = { id: number; bookingNumber: string; customerName: string; customerPhone: string | null; cakeName: string; sizeLabel: string | null; flavor: string | null; quantity: number; designNotes: string | null; referenceImageUrl: string | null; deliveryAt: string; deliveryAddress: string | null; isPickup: boolean; totalAmount: string; advanceAmount: string; paidAmount: string; status: string };
type ForecastIngredient = { inventoryItemId: number; name: string; unit: string; required: string; onHand: string; shortfall: string; supplierId: number | null; costPerUnit: string };
type Forecast = { ingredients: ForecastIngredient[]; from: string; to: string };
type Report = { from: string; to: string; production: Array<{ menuItemId: number; name: string; planned: string; produced: string }>; wastage: Array<{ menuItemId: number; name: string; qty: string; cost: string }>; totalWastageCost: string; bookings: Array<{ status: string; cnt: number }> };

type Tab = "plan" | "batches" | "wastage" | "bookings" | "forecast" | "report";

export default function BakeryPage() {
  const [tab, setTab] = useState<Tab>("plan");
  const { data: info } = useRestaurantInfo();
  const enabled = (info as { bakeryModeEnabled?: boolean } | undefined)?.bakeryModeEnabled;

  return (
    <Layout>
      <PageHeader title="Bakery" subtitle="Production planning, batches, expiry & cake pre-orders" />
      {!enabled ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-sm">
          <p className="font-medium text-yellow-900">Bakery mode is disabled</p>
          <p className="text-yellow-800 mt-1">Enable Bakery mode under Settings → General to use production planning, finished-goods batches, wastage tracking, cake pre-orders, ingredient forecast and the production report.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-1 border-b mb-4 overflow-x-auto">
            {([
              ["plan", "Production Plan", ChefHat],
              ["batches", "Batches", Package],
              ["wastage", "Wastage", AlertTriangle],
              ["bookings", "Cake Bookings", Cake],
              ["forecast", "Ingredient Forecast", ShoppingBag],
              ["report", "Report", FileText],
            ] as const).map(([k, label, Icon]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={cn(
                  "px-3 py-2 text-sm font-medium flex items-center gap-2 border-b-2 -mb-px",
                  tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="w-4 h-4" />{label}
              </button>
            ))}
          </div>
          {tab === "plan" && <PlanTab />}
          {tab === "batches" && <BatchesTab />}
          {tab === "wastage" && <WastageTab />}
          {tab === "bookings" && <BookingsTab />}
          {tab === "forecast" && <ForecastTab />}
          {tab === "report" && <ReportTab />}
        </>
      )}
    </Layout>
  );
}

// ─────────────────────── Production Plan ───────────────────────

function PlanTab() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [openCreate, setOpenCreate] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null);

  const { data: plans = [] } = useQuery({
    queryKey: ["bakery", "plans", restaurantId],
    queryFn: () => apiGet<Plan[]>(`/restaurants/${restaurantId}/bakery/plans`),
  });

  const detailQ = useQuery({
    queryKey: ["bakery", "plan", restaurantId, selectedPlan],
    queryFn: () => apiGet<PlanDetail>(`/restaurants/${restaurantId}/bakery/plans/${selectedPlan}`),
    enabled: !!selectedPlan,
  });

  const createPlan = useMutation({
    mutationFn: (data: { planDate: string; notes?: string }) =>
      apiPost(`/restaurants/${restaurantId}/bakery/plans`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bakery", "plans", restaurantId] });
      setOpenCreate(false);
      toast.toast({ title: "Plan created" });
    },
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-1">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Plans</h3>
          <Button size="sm" onClick={() => setOpenCreate(true)}><Plus className="w-3 h-3 mr-1" />New</Button>
        </div>
        <div className="space-y-1">
          {plans.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedPlan(p.id)}
              className={cn(
                "w-full text-left px-3 py-2 rounded border text-sm",
                selectedPlan === p.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
              )}
            >
              <div className="font-medium">{format(new Date(p.planDate), "EEE, dd MMM yyyy")}</div>
              <div className="text-xs text-muted-foreground capitalize">{p.status}</div>
            </button>
          ))}
          {plans.length === 0 && <p className="text-sm text-muted-foreground">No plans yet.</p>}
        </div>
      </div>
      <div className="md:col-span-2">
        {selectedPlan && detailQ.data ? (
          <PlanDetailPanel detail={detailQ.data} restaurantId={restaurantId} />
        ) : (
          <p className="text-sm text-muted-foreground">Select a plan to view items.</p>
        )}
      </div>

      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>New production plan</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Date</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => createPlan.mutate({ planDate: new Date(date).toISOString() })}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlanDetailPanel({ detail, restaurantId }: { detail: PlanDetail; restaurantId: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: menu } = useMenuItems();
  const [addOpen, setAddOpen] = useState(false);
  const [completeFor, setCompleteFor] = useState<{ id: number; planned: string; menuItemName?: string } | null>(null);

  const addItem = useMutation({
    mutationFn: (data: { menuItemId: number; plannedQuantity: number }) =>
      apiPost(`/restaurants/${restaurantId}/bakery/plans/${detail.plan.id}/items`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bakery", "plan", restaurantId, detail.plan.id] });
      setAddOpen(false);
    },
  });
  const updItem = useMutation({
    mutationFn: ({ id, ...data }: { id: number; status?: string }) =>
      apiPatch(`/restaurants/${restaurantId}/bakery/plans/${detail.plan.id}/items/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bakery", "plan", restaurantId, detail.plan.id] }),
  });
  const delItem = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/bakery/plans/${detail.plan.id}/items/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bakery", "plan", restaurantId, detail.plan.id] }),
  });
  const complete = useMutation({
    mutationFn: ({ id, ...data }: { id: number; quantityProduced: number; unitCost?: number; storageLocation?: string }) =>
      apiPost(`/restaurants/${restaurantId}/bakery/plans/${detail.plan.id}/items/${id}/complete`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bakery", "plan", restaurantId, detail.plan.id] });
      qc.invalidateQueries({ queryKey: ["bakery", "batches", restaurantId] });
      setCompleteFor(null);
      toast.toast({ title: "Batch created" });
    },
  });

  const [newItem, setNewItem] = useState({ menuItemId: 0, plannedQuantity: 1 });
  const [completeForm, setCompleteForm] = useState({ quantityProduced: 0, unitCost: 0, storageLocation: "" });

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-base font-semibold">{format(new Date(detail.plan.planDate), "EEE, dd MMM yyyy")}</h3>
        <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="w-3 h-3 mr-1" />Add item</Button>
      </div>
      <div className="border rounded">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr><th className="text-left px-2 py-1.5">Item</th><th className="text-right px-2 py-1.5">Planned</th><th className="text-right px-2 py-1.5">Produced</th><th className="px-2 py-1.5">Status</th><th className="px-2 py-1.5"></th></tr>
          </thead>
          <tbody>
            {detail.items.map(({ item, menuItem }) => (
              <tr key={item.id} className="border-t">
                <td className="px-2 py-2">{menuItem?.name ?? `#${item.menuItemId}`}</td>
                <td className="px-2 py-2 text-right">{Number(item.plannedQuantity)}</td>
                <td className="px-2 py-2 text-right">{Number(item.producedQuantity)}</td>
                <td className="px-2 py-2 capitalize">{item.status.replace("_", " ")}</td>
                <td className="px-2 py-2 text-right space-x-1">
                  {item.status !== "done" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => updItem.mutate({ id: item.id, status: "in_progress" })}>Start</Button>
                      <Button size="sm" onClick={() => { setCompleteForm({ quantityProduced: Number(item.plannedQuantity), unitCost: 0, storageLocation: "" }); setCompleteFor({ id: item.id, planned: item.plannedQuantity, menuItemName: menuItem?.name }); }}>Complete</Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => delItem.mutate(item.id)}><Trash2 className="w-3 h-3" /></Button>
                </td>
              </tr>
            ))}
            {detail.items.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-center text-muted-foreground">No items.</td></tr>}
          </tbody>
        </table>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add to plan</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Menu item</Label>
              <Select value={String(newItem.menuItemId || "")} onValueChange={v => setNewItem(s => ({ ...s, menuItemId: Number(v) }))}>
                <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {(menu ?? []).map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Planned quantity</Label>
              <Input type="number" min={1} value={newItem.plannedQuantity} onChange={e => setNewItem(s => ({ ...s, plannedQuantity: Number(e.target.value) }))} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => addItem.mutate(newItem)} disabled={!newItem.menuItemId}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!completeFor} onOpenChange={o => !o && setCompleteFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Complete production — {completeFor?.menuItemName}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Quantity produced</Label><Input type="number" value={completeForm.quantityProduced} onChange={e => setCompleteForm(s => ({ ...s, quantityProduced: Number(e.target.value) }))} /></div>
            <div><Label>Unit cost (₹, optional)</Label><Input type="number" value={completeForm.unitCost} onChange={e => setCompleteForm(s => ({ ...s, unitCost: Number(e.target.value) }))} /></div>
            <div><Label>Storage location</Label><Input value={completeForm.storageLocation} onChange={e => setCompleteForm(s => ({ ...s, storageLocation: e.target.value }))} placeholder="e.g. Display A, Cold storage 2" /></div>
          </div>
          <DialogFooter>
            <Button onClick={() => completeFor && complete.mutate({ id: completeFor.id, ...completeForm })}>Create batch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────── Batches ───────────────────────

function BatchesTab() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const toast = useToast();
  const { data = [] } = useQuery({
    queryKey: ["bakery", "batches", restaurantId],
    queryFn: () => apiGet<Batch[]>(`/restaurants/${restaurantId}/bakery/batches?activeOnly=true`),
  });
  const [wastageFor, setWastageFor] = useState<{ id: number; remaining: string } | null>(null);
  const [wForm, setWForm] = useState({ quantity: 0, reason: "expired", notes: "" });
  const createW = useMutation({
    mutationFn: ({ id, ...data }: { id: number; quantity: number; reason: string; notes?: string }) =>
      apiPost(`/restaurants/${restaurantId}/bakery/batches/${id}/wastage`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bakery", "batches", restaurantId] });
      qc.invalidateQueries({ queryKey: ["bakery", "wastage", restaurantId] });
      setWastageFor(null);
      toast.toast({ title: "Wastage recorded" });
    },
  });

  return (
    <div className="border rounded">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr><th className="text-left px-2 py-1.5">Batch</th><th className="text-left px-2 py-1.5">Item</th><th className="text-right px-2 py-1.5">Produced</th><th className="text-right px-2 py-1.5">Remaining</th><th className="px-2 py-1.5">Expires</th><th className="px-2 py-1.5">Location</th><th className="px-2 py-1.5"></th></tr>
        </thead>
        <tbody>
          {data.map(({ batch, menuItemName }) => {
            const expDate = batch.expiryAt ? new Date(batch.expiryAt) : null;
            const expSoon = expDate && expDate.getTime() - Date.now() < 6 * 3600_000;
            return (
              <tr key={batch.id} className={cn("border-t", expSoon && "bg-orange-50")}>
                <td className="px-2 py-2 font-mono text-xs">{batch.batchNumber}</td>
                <td className="px-2 py-2">{menuItemName ?? "—"}</td>
                <td className="px-2 py-2 text-right">{Number(batch.quantityProduced)}</td>
                <td className="px-2 py-2 text-right">{Number(batch.quantityRemaining)}</td>
                <td className="px-2 py-2 text-xs">{expDate ? format(expDate, "dd MMM HH:mm") : "—"}</td>
                <td className="px-2 py-2 text-xs">{batch.storageLocation ?? "—"}</td>
                <td className="px-2 py-2 text-right">
                  <Button size="sm" variant="outline" onClick={() => { setWForm({ quantity: 0, reason: "expired", notes: "" }); setWastageFor({ id: batch.id, remaining: batch.quantityRemaining }); }}>Wastage</Button>
                </td>
              </tr>
            );
          })}
          {data.length === 0 && <tr><td colSpan={7} className="px-2 py-3 text-center text-muted-foreground">No active batches.</td></tr>}
        </tbody>
      </table>

      <Dialog open={!!wastageFor} onOpenChange={o => !o && setWastageFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record wastage</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Quantity (max {wastageFor?.remaining})</Label><Input type="number" value={wForm.quantity} onChange={e => setWForm(s => ({ ...s, quantity: Number(e.target.value) }))} /></div>
            <div>
              <Label>Reason</Label>
              <Select value={wForm.reason} onValueChange={v => setWForm(s => ({ ...s, reason: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["expired", "damaged", "unsold", "sample", "other"].map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Notes</Label><Textarea value={wForm.notes} onChange={e => setWForm(s => ({ ...s, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button onClick={() => wastageFor && createW.mutate({ id: wastageFor.id, ...wForm })}>Record</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────── Wastage log ───────────────────────

function WastageTab() {
  const restaurantId = useRestaurantId();
  const { data = [] } = useQuery({
    queryKey: ["bakery", "wastage", restaurantId],
    queryFn: () => apiGet<Wastage[]>(`/restaurants/${restaurantId}/bakery/wastage`),
  });
  return (
    <div className="border rounded">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr><th className="text-left px-2 py-1.5">Date</th><th className="text-left px-2 py-1.5">Item</th><th className="text-left px-2 py-1.5">Batch</th><th className="text-right px-2 py-1.5">Qty</th><th className="text-left px-2 py-1.5">Reason</th><th className="text-right px-2 py-1.5">Cost</th><th className="text-left px-2 py-1.5">Notes</th></tr>
        </thead>
        <tbody>
          {data.map(({ wastage, menuItemName, batchNumber, unitCost }) => (
            <tr key={wastage.id} className="border-t">
              <td className="px-2 py-2 text-xs">{format(new Date(wastage.createdAt), "dd MMM HH:mm")}</td>
              <td className="px-2 py-2">{menuItemName ?? "—"}</td>
              <td className="px-2 py-2 font-mono text-xs">{batchNumber ?? "—"}</td>
              <td className="px-2 py-2 text-right">{Number(wastage.quantity)}</td>
              <td className="px-2 py-2 capitalize">{wastage.reason}</td>
              <td className="px-2 py-2 text-right">₹{(Number(wastage.quantity) * Number(unitCost ?? 0)).toFixed(2)}</td>
              <td className="px-2 py-2 text-xs">{wastage.notes ?? ""}</td>
            </tr>
          ))}
          {data.length === 0 && <tr><td colSpan={7} className="px-2 py-3 text-center text-muted-foreground">No wastage recorded.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────── Cake Bookings ───────────────────────

function BookingsTab() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const toast = useToast();
  const [openCreate, setOpenCreate] = useState(false);
  const { data = [] } = useQuery({
    queryKey: ["bakery", "bookings", restaurantId],
    queryFn: () => apiGet<Booking[]>(`/restaurants/${restaurantId}/bakery/bookings`),
  });
  const create = useMutation({
    mutationFn: (data: Partial<Booking>) => apiPost(`/restaurants/${restaurantId}/bakery/bookings`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bakery", "bookings", restaurantId] });
      setOpenCreate(false);
      toast.toast({ title: "Booking created" });
    },
  });
  const update = useMutation({
    mutationFn: ({ id, ...data }: Partial<Booking> & { id: number }) =>
      apiPatch(`/restaurants/${restaurantId}/bakery/bookings/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bakery", "bookings", restaurantId] }),
  });
  const confirmPay = useMutation({
    mutationFn: ({ id, amount, method }: { id: number; amount: number; method: string }) =>
      apiPost(`/restaurants/${restaurantId}/bakery/bookings/${id}/confirm-payment`, { amount, method }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bakery", "bookings", restaurantId] });
      toast.toast({ title: "Advance recorded" });
    },
  });

  const [form, setForm] = useState({
    customerName: "", customerPhone: "", customerEmail: "",
    cakeName: "", sizeLabel: "", flavor: "", quantity: 1,
    designNotes: "", referenceImageUrl: "",
    deliveryAt: format(new Date(Date.now() + 86400_000), "yyyy-MM-dd'T'HH:mm"),
    deliveryAddress: "", isPickup: true,
    totalAmount: 0, advanceAmount: 0,
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-between">
        <h3 className="text-sm font-semibold">Pre-orders</h3>
        <Button size="sm" onClick={() => setOpenCreate(true)}><Plus className="w-3 h-3 mr-1" />New booking</Button>
      </div>
      <div className="border rounded">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr><th className="text-left px-2 py-1.5">Booking</th><th className="text-left px-2 py-1.5">Customer</th><th className="text-left px-2 py-1.5">Cake</th><th className="text-left px-2 py-1.5">Delivery</th><th className="text-right px-2 py-1.5">Total</th><th className="text-right px-2 py-1.5">Paid</th><th className="px-2 py-1.5">Status</th><th className="px-2 py-1.5"></th></tr>
          </thead>
          <tbody>
            {data.map(b => (
              <tr key={b.id} className="border-t">
                <td className="px-2 py-2 font-mono text-xs">{b.bookingNumber}</td>
                <td className="px-2 py-2">{b.customerName}<div className="text-xs text-muted-foreground">{b.customerPhone}</div></td>
                <td className="px-2 py-2">{b.cakeName}<div className="text-xs text-muted-foreground">{[b.sizeLabel, b.flavor].filter(Boolean).join(" · ")}</div></td>
                <td className="px-2 py-2 text-xs">{format(new Date(b.deliveryAt), "dd MMM HH:mm")}<div className="text-muted-foreground">{b.isPickup ? "Pickup" : "Delivery"}</div></td>
                <td className="px-2 py-2 text-right">₹{Number(b.totalAmount).toFixed(2)}</td>
                <td className="px-2 py-2 text-right">₹{Number(b.paidAmount).toFixed(2)}</td>
                <td className="px-2 py-2 capitalize">{b.status.replace("_", " ")}</td>
                <td className="px-2 py-2 space-x-1 text-right">
                  {b.status === "new" && <Button size="sm" onClick={() => update.mutate({ id: b.id, status: "confirmed" })}>Confirm</Button>}
                  {b.status === "confirmed" && <Button size="sm" onClick={() => update.mutate({ id: b.id, status: "in_production" })}>Start</Button>}
                  {b.status === "in_production" && <Button size="sm" onClick={() => update.mutate({ id: b.id, status: "ready" })}>Ready</Button>}
                  {b.status === "ready" && <Button size="sm" onClick={() => update.mutate({ id: b.id, status: "delivered" })}>Deliver</Button>}
                  {Number(b.paidAmount) < Number(b.totalAmount) && (
                    <Button size="sm" variant="outline" onClick={() => {
                      const remaining = Number(b.totalAmount) - Number(b.paidAmount);
                      const amt = prompt(`Enter amount (max ₹${remaining})`, String(b.advanceAmount));
                      if (amt) confirmPay.mutate({ id: b.id, amount: Number(amt), method: "cash" });
                    }}>+Pay</Button>
                  )}
                </td>
              </tr>
            ))}
            {data.length === 0 && <tr><td colSpan={8} className="px-2 py-3 text-center text-muted-foreground">No bookings.</td></tr>}
          </tbody>
        </table>
      </div>

      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New cake pre-order</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Customer name</Label><Input value={form.customerName} onChange={e => setForm(s => ({ ...s, customerName: e.target.value }))} /></div>
            <div><Label>Phone</Label><Input value={form.customerPhone} onChange={e => setForm(s => ({ ...s, customerPhone: e.target.value }))} /></div>
            <div className="col-span-2"><Label>Cake name</Label><Input value={form.cakeName} onChange={e => setForm(s => ({ ...s, cakeName: e.target.value }))} /></div>
            <div><Label>Size</Label><Input value={form.sizeLabel} onChange={e => setForm(s => ({ ...s, sizeLabel: e.target.value }))} placeholder="1kg / 8 inch" /></div>
            <div><Label>Flavor</Label><Input value={form.flavor} onChange={e => setForm(s => ({ ...s, flavor: e.target.value }))} /></div>
            <div><Label>Quantity</Label><Input type="number" min={1} value={form.quantity} onChange={e => setForm(s => ({ ...s, quantity: Number(e.target.value) }))} /></div>
            <div><Label>Delivery date & time</Label><Input type="datetime-local" value={form.deliveryAt} onChange={e => setForm(s => ({ ...s, deliveryAt: e.target.value }))} /></div>
            <div className="col-span-2"><Label>Design notes</Label><Textarea value={form.designNotes} onChange={e => setForm(s => ({ ...s, designNotes: e.target.value }))} placeholder="Color theme, message, decorations…" /></div>
            <div className="col-span-2"><Label>Reference image URL (optional)</Label><Input value={form.referenceImageUrl} onChange={e => setForm(s => ({ ...s, referenceImageUrl: e.target.value }))} /></div>
            <div><Label>Total ₹</Label><Input type="number" value={form.totalAmount} onChange={e => setForm(s => ({ ...s, totalAmount: Number(e.target.value) }))} /></div>
            <div><Label>Advance ₹</Label><Input type="number" value={form.advanceAmount} onChange={e => setForm(s => ({ ...s, advanceAmount: Number(e.target.value) }))} /></div>
          </div>
          <DialogFooter>
            <Button onClick={() => create.mutate({ ...form, deliveryAt: new Date(form.deliveryAt).toISOString() } as unknown as Partial<Booking>)}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────── Forecast ───────────────────────

function ForecastTab() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const toast = useToast();
  const today = format(new Date(), "yyyy-MM-dd");
  const week = format(new Date(Date.now() + 7 * 86400_000), "yyyy-MM-dd");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(week);
  const { data } = useQuery({
    queryKey: ["bakery", "forecast", restaurantId, from, to],
    queryFn: () => apiGet<Forecast>(`/restaurants/${restaurantId}/bakery/forecast?from=${from}&to=${to}`),
  });
  const createPO = useMutation({
    mutationFn: (items: Array<{ inventoryItemId: number; name: string; unit: string; quantity: number; costPerUnit: number }>) =>
      apiPost(`/restaurants/${restaurantId}/bakery/forecast/create-po`, { items }),
    onSuccess: () => {
      toast.toast({ title: "Purchase order drafted" });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
  const shortfalls = (data?.ingredients ?? []).filter(i => Number(i.shortfall) > 0);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-end">
        <div><Label>From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <Button
          disabled={shortfalls.length === 0}
          onClick={() => createPO.mutate(shortfalls.map(i => ({ inventoryItemId: i.inventoryItemId, name: i.name, unit: i.unit, quantity: Number(i.shortfall), costPerUnit: Number(i.costPerUnit) })))}
        >Create PO from shortfalls</Button>
      </div>
      <div className="border rounded">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr><th className="text-left px-2 py-1.5">Ingredient</th><th className="px-2 py-1.5">Unit</th><th className="text-right px-2 py-1.5">Required</th><th className="text-right px-2 py-1.5">On hand</th><th className="text-right px-2 py-1.5">Shortfall</th></tr>
          </thead>
          <tbody>
            {(data?.ingredients ?? []).map(i => (
              <tr key={i.inventoryItemId} className={cn("border-t", Number(i.shortfall) > 0 && "bg-red-50")}>
                <td className="px-2 py-2">{i.name}</td>
                <td className="px-2 py-2 text-xs">{i.unit}</td>
                <td className="px-2 py-2 text-right">{Number(i.required)}</td>
                <td className="px-2 py-2 text-right">{Number(i.onHand)}</td>
                <td className="px-2 py-2 text-right font-medium">{Number(i.shortfall)}</td>
              </tr>
            ))}
            {(data?.ingredients ?? []).length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-center text-muted-foreground">No ingredient data — add a production plan and recipe mappings.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────── Report ───────────────────────

function ReportTab() {
  const restaurantId = useRestaurantId();
  const today = format(new Date(), "yyyy-MM-dd");
  const weekAgo = format(new Date(Date.now() - 7 * 86400_000), "yyyy-MM-dd");
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const { data } = useQuery({
    queryKey: ["bakery", "report", restaurantId, from, to],
    queryFn: () => apiGet<Report>(`/restaurants/${restaurantId}/bakery/report?from=${from}&to=${to}`),
  });

  const exportCsv = () => {
    if (!data) return;
    const lines = ["Item,Planned,Produced"];
    for (const r of data.production) lines.push(`"${r.name}",${Number(r.planned)},${Number(r.produced)}`);
    lines.push("", "Item,WastageQty,WastageCost");
    for (const r of data.wastage) lines.push(`"${r.name}",${Number(r.qty)},${Number(r.cost).toFixed(2)}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `bakery-report-${from}-to-${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const totals = useMemo(() => {
    if (!data) return { planned: 0, produced: 0, wasted: 0, wasteCost: 0 };
    return {
      planned: data.production.reduce((s, r) => s + Number(r.planned), 0),
      produced: data.production.reduce((s, r) => s + Number(r.produced), 0),
      wasted: data.wastage.reduce((s, r) => s + Number(r.qty), 0),
      wasteCost: Number(data.totalWastageCost),
    };
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-end">
        <div><Label>From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Planned" value={totals.planned.toString()} />
        <Stat label="Produced" value={totals.produced.toString()} />
        <Stat label="Wastage qty" value={totals.wasted.toString()} />
        <Stat label="Wastage cost" value={`₹${totals.wasteCost.toFixed(2)}`} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h4 className="text-sm font-semibold mb-2">Production by item</h4>
          <table className="w-full text-sm border">
            <thead className="bg-muted"><tr><th className="text-left px-2 py-1.5">Item</th><th className="text-right px-2 py-1.5">Planned</th><th className="text-right px-2 py-1.5">Produced</th></tr></thead>
            <tbody>
              {(data?.production ?? []).map(r => (
                <tr key={r.menuItemId} className="border-t">
                  <td className="px-2 py-1.5">{r.name}</td>
                  <td className="px-2 py-1.5 text-right">{Number(r.planned)}</td>
                  <td className="px-2 py-1.5 text-right">{Number(r.produced)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-2">Wastage by item</h4>
          <table className="w-full text-sm border">
            <thead className="bg-muted"><tr><th className="text-left px-2 py-1.5">Item</th><th className="text-right px-2 py-1.5">Qty</th><th className="text-right px-2 py-1.5">Cost</th></tr></thead>
            <tbody>
              {(data?.wastage ?? []).map(r => (
                <tr key={r.menuItemId} className="border-t">
                  <td className="px-2 py-1.5">{r.name}</td>
                  <td className="px-2 py-1.5 text-right">{Number(r.qty)}</td>
                  <td className="px-2 py-1.5 text-right">₹{Number(r.cost).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h4 className="text-sm font-semibold mb-2">Pre-orders by status</h4>
        <div className="flex gap-2 flex-wrap">
          {(data?.bookings ?? []).map(s => (
            <span key={s.status} className="text-xs px-2 py-1 bg-muted rounded">{s.status}: {s.cnt}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded p-3 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}
