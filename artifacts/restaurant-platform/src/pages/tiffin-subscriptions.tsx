import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Pause, Play, X, Calendar } from "lucide-react";
import {
  useTiffinSubscriptions, useCreateTiffinSubscription, useTiffinPlans,
  usePauseTiffinSubscription, useResumeTiffinSubscription, useCancelTiffinSubscription,
  useGenerateCalendar, useTiffinRoutes,
} from "@/lib/tiffin";
import { useCustomers } from "@/lib/hooks";
import { toast } from "@/hooks/use-toast";

export default function TiffinSubscriptionsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const { data: subs = [] } = useTiffinSubscriptions(statusFilter || undefined);
  const { data: plans = [] } = useTiffinPlans();
  const { data: routes = [] } = useTiffinRoutes();
  const { data: customersResp } = useCustomers({ search: "" });
  const customers = (customersResp as { data?: { id: number; name: string; phone?: string }[] } | undefined)?.data ?? [];

  const create = useCreateTiffinSubscription();
  const pause = usePauseTiffinSubscription();
  const resume = useResumeTiffinSubscription();
  const cancel = useCancelTiffinSubscription();
  const genCal = useGenerateCalendar();

  const [show, setShow] = useState(false);
  const [pauseFor, setPauseFor] = useState<number | null>(null);
  const [pauseRange, setPauseRange] = useState({ from: "", to: "" });
  const [form, setForm] = useState({
    customerId: 0, planId: 0, deliveryAddress: "",
    startDate: new Date().toISOString().slice(0, 10),
    preferredSlot: "lunch", mealsPerDay: 1, routeId: 0, routeStop: 0,
  });

  const submit = async () => {
    if (!form.customerId || !form.planId || !form.deliveryAddress) {
      toast({ title: "Customer, plan, and address are required" });
      return;
    }
    try {
      const res = await create.mutateAsync({
        customerId: form.customerId, planId: form.planId,
        deliveryAddress: form.deliveryAddress, startDate: form.startDate,
        preferredSlot: form.preferredSlot, mealsPerDay: form.mealsPerDay,
        routeId: form.routeId || null, routeStop: form.routeStop || null,
        status: "active",
      } as never) as { id: number };
      // Auto-generate calendar for next 30 days
      const to = new Date(form.startDate); to.setDate(to.getDate() + 30);
      try {
        await genCal.mutateAsync({ id: res.id, from: form.startDate, to: to.toISOString().slice(0, 10) });
      } catch { /* non-fatal */ }
      setShow(false);
      toast({ title: "Subscription created", description: "Calendar generated for 30 days" });
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message });
    }
  };

  const submitPause = async () => {
    if (!pauseFor || !pauseRange.from || !pauseRange.to) { toast({ title: "Pause dates required" }); return; }
    try {
      await pause.mutateAsync({ id: pauseFor, from: pauseRange.from, to: pauseRange.to });
      setPauseFor(null);
      setPauseRange({ from: "", to: "" });
      toast({ title: "Subscription paused" });
    } catch (err) { toast({ title: "Failed", description: (err as Error).message }); }
  };

  return (
    <Layout>
      <PageHeader
        title="Tiffin Subscriptions"
        subtitle="Active customer meal subscriptions"
        actions={<Button onClick={() => setShow(true)}><Plus className="w-4 h-4 mr-1" />New Subscription</Button>}
      />

      <div className="flex gap-2 mb-4">
        {["", "active", "paused", "cancelled"].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-xs rounded-md border ${statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border"}`}>
            {s === "" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {show && (
        <div className="bg-card border border-border rounded-xl p-4 mb-6">
          <h3 className="font-semibold mb-3">New Subscription</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label>Customer</Label>
              <select className="w-full border border-border rounded-md p-2 bg-background" value={form.customerId} onChange={e => setForm({ ...form, customerId: Number(e.target.value) })}>
                <option value={0}>Select customer</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ""}</option>)}
              </select>
            </div>
            <div><Label>Plan</Label>
              <select className="w-full border border-border rounded-md p-2 bg-background" value={form.planId} onChange={e => setForm({ ...form, planId: Number(e.target.value) })}>
                <option value={0}>Select plan</option>
                {plans.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.name} (₹{p.pricePerMeal}/meal)</option>)}
              </select>
            </div>
            <div className="md:col-span-2"><Label>Delivery Address</Label><Input value={form.deliveryAddress} onChange={e => setForm({ ...form, deliveryAddress: e.target.value })} /></div>
            <div><Label>Start Date</Label><Input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} /></div>
            <div><Label>Slot</Label>
              <select className="w-full border border-border rounded-md p-2 bg-background" value={form.preferredSlot} onChange={e => setForm({ ...form, preferredSlot: e.target.value })}>
                <option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option>
              </select>
            </div>
            <div><Label>Meals per Day</Label><Input type="number" min={1} value={form.mealsPerDay} onChange={e => setForm({ ...form, mealsPerDay: Number(e.target.value) })} /></div>
            <div><Label>Route (optional)</Label>
              <select className="w-full border border-border rounded-md p-2 bg-background" value={form.routeId} onChange={e => setForm({ ...form, routeId: Number(e.target.value) })}>
                <option value={0}>—</option>
                {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div><Label>Route Stop #</Label><Input type="number" value={form.routeStop} onChange={e => setForm({ ...form, routeStop: Number(e.target.value) })} /></div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={submit} disabled={create.isPending}>Create</Button>
            <Button variant="outline" onClick={() => setShow(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="p-3">Customer</th>
              <th className="p-3">Plan</th>
              <th className="p-3">Status</th>
              <th className="p-3">Slot</th>
              <th className="p-3">Started</th>
              <th className="p-3">Address</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {subs.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No subscriptions yet.</td></tr>}
            {subs.map(s => (
              <tr key={s.id} className="border-t border-border">
                <td className="p-3">
                  <p className="font-medium">{s.customerName}</p>
                  <p className="text-xs text-muted-foreground">{s.customerPhone}</p>
                </td>
                <td className="p-3">{s.planName}</td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === "active" ? "bg-green-100 text-green-700" : s.status === "paused" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
                    {s.status}
                  </span>
                  {s.pausedFrom && <p className="text-[10px] text-muted-foreground mt-1">{s.pausedFrom} → {s.pausedTo}</p>}
                </td>
                <td className="p-3 capitalize">{s.preferredSlot}</td>
                <td className="p-3 text-xs">{s.startDate}</td>
                <td className="p-3 text-xs max-w-xs truncate">{s.deliveryAddress}</td>
                <td className="p-3 text-right">
                  <div className="inline-flex gap-1">
                    {s.status === "active" && (
                      <button title="Pause" onClick={() => setPauseFor(s.id)} className="p-1.5 hover:bg-muted rounded"><Pause className="w-4 h-4" /></button>
                    )}
                    {s.status === "paused" && (
                      <button title="Resume" onClick={() => resume.mutate(s.id)} className="p-1.5 hover:bg-muted rounded"><Play className="w-4 h-4" /></button>
                    )}
                    <button title="Generate next 30 days" onClick={() => {
                      const from = new Date().toISOString().slice(0, 10);
                      const to = new Date(); to.setDate(to.getDate() + 30);
                      genCal.mutate({ id: s.id, from, to: to.toISOString().slice(0, 10) }, {
                        onSuccess: (r) => toast({ title: `Generated`, description: `${(r as { inserted: number }).inserted} deliveries` }),
                      });
                    }} className="p-1.5 hover:bg-muted rounded"><Calendar className="w-4 h-4" /></button>
                    {s.status !== "cancelled" && (
                      <button title="Cancel" onClick={() => { if (confirm("Cancel subscription?")) cancel.mutate(s.id); }} className="p-1.5 hover:bg-muted rounded text-destructive"><X className="w-4 h-4" /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {pauseFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl p-5 w-full max-w-sm">
            <h3 className="font-semibold mb-3">Pause subscription</h3>
            <Label>From</Label>
            <Input type="date" value={pauseRange.from} onChange={e => setPauseRange({ ...pauseRange, from: e.target.value })} />
            <Label className="mt-3">To</Label>
            <Input type="date" value={pauseRange.to} onChange={e => setPauseRange({ ...pauseRange, to: e.target.value })} />
            <div className="flex gap-2 mt-4 justify-end">
              <Button variant="outline" onClick={() => setPauseFor(null)}>Cancel</Button>
              <Button onClick={submitPause}>Pause</Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
