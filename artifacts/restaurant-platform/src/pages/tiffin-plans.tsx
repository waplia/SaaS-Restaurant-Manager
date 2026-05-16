import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import {
  useTiffinPlans, useCreateTiffinPlan, useDeleteTiffinPlan,
  type TiffinPlan,
} from "@/lib/tiffin";
import { toast } from "@/hooks/use-toast";

const DAYS = [
  { v: "0", l: "Sun" }, { v: "1", l: "Mon" }, { v: "2", l: "Tue" },
  { v: "3", l: "Wed" }, { v: "4", l: "Thu" }, { v: "5", l: "Fri" }, { v: "6", l: "Sat" },
];

export default function TiffinPlansPage() {
  const { data: plans = [] } = useTiffinPlans();
  const createPlan = useCreateTiffinPlan();
  const deletePlan = useDeleteTiffinPlan();
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({
    name: "", description: "", mealType: "lunch", cuisine: "veg",
    pricePerMeal: "100", monthlyPrice: "2500", daysOfWeek: "1,2,3,4,5,6",
    trialAvailable: false, trialPrice: "0",
  });

  const toggleDay = (d: string) => {
    const set = new Set(form.daysOfWeek.split(",").map(s => s.trim()).filter(Boolean));
    if (set.has(d)) set.delete(d); else set.add(d);
    setForm({ ...form, daysOfWeek: Array.from(set).sort().join(",") });
  };

  const submit = async () => {
    if (!form.name.trim()) { toast({ title: "Name required" }); return; }
    try {
      await createPlan.mutateAsync({
        ...form,
        trialPrice: form.trialAvailable ? form.trialPrice : null,
      } as Partial<TiffinPlan>);
      setShow(false);
      setForm({ ...form, name: "", description: "" });
      toast({ title: "Plan created" });
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message });
    }
  };

  return (
    <Layout>
      <PageHeader
        title="Tiffin Plans"
        subtitle="Weekly & monthly meal subscription plans"
        actions={<Button onClick={() => setShow(true)}><Plus className="w-4 h-4 mr-1" />New Plan</Button>}
      />

      {show && (
        <div className="bg-card border border-border rounded-xl p-4 mb-6">
          <h3 className="font-semibold mb-3">New Plan</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Weekday Veg Lunch" /></div>
            <div><Label>Meal Type</Label>
              <select className="w-full border border-border rounded-md p-2 bg-background" value={form.mealType} onChange={e => setForm({ ...form, mealType: e.target.value })}>
                <option value="breakfast">Breakfast</option><option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option><option value="snacks">Snacks</option>
              </select>
            </div>
            <div><Label>Cuisine</Label>
              <select className="w-full border border-border rounded-md p-2 bg-background" value={form.cuisine} onChange={e => setForm({ ...form, cuisine: e.target.value })}>
                <option value="veg">Veg</option><option value="non_veg">Non-Veg</option>
                <option value="jain">Jain</option><option value="mixed">Mixed</option>
              </select>
            </div>
            <div><Label>Price per Meal (₹)</Label><Input type="number" value={form.pricePerMeal} onChange={e => setForm({ ...form, pricePerMeal: e.target.value })} /></div>
            <div><Label>Monthly Price (₹)</Label><Input type="number" value={form.monthlyPrice} onChange={e => setForm({ ...form, monthlyPrice: e.target.value })} /></div>
            <div className="md:col-span-2"><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div className="md:col-span-2">
              <Label>Days of Week</Label>
              <div className="flex gap-2 flex-wrap mt-1">
                {DAYS.map(d => {
                  const active = form.daysOfWeek.split(",").map(s => s.trim()).includes(d.v);
                  return (
                    <button key={d.v} type="button" onClick={() => toggleDay(d.v)}
                      className={`px-3 py-1.5 rounded-md text-xs border ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border"}`}>
                      {d.l}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="md:col-span-2 flex items-center gap-2">
              <input type="checkbox" id="trial" checked={form.trialAvailable} onChange={e => setForm({ ...form, trialAvailable: e.target.checked })} />
              <Label htmlFor="trial" className="cursor-pointer">Trial available</Label>
              {form.trialAvailable && <Input className="w-32" type="number" value={form.trialPrice} onChange={e => setForm({ ...form, trialPrice: e.target.value })} placeholder="Trial price" />}
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={submit} disabled={createPlan.isPending}>Create</Button>
            <Button variant="outline" onClick={() => setShow(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <section className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-3">All Plans</h3>
        {plans.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tiffin plans yet. Create your first plan above.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {plans.map(p => (
              <div key={p.id} className="border border-border rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{p.mealType} • {p.cuisine.replace("_", " ")}</p>
                  </div>
                  <button onClick={() => { if (confirm("Deactivate plan?")) deletePlan.mutate(p.id); }} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {p.description && <p className="text-xs text-muted-foreground mt-2">{p.description}</p>}
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="bg-muted rounded p-2">
                    <p className="text-[10px] text-muted-foreground">Per meal</p>
                    <p className="font-semibold">₹{p.pricePerMeal}</p>
                  </div>
                  <div className="bg-muted rounded p-2">
                    <p className="text-[10px] text-muted-foreground">Per month</p>
                    <p className="font-semibold">₹{p.monthlyPrice}</p>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  Days: {p.daysOfWeek.split(",").map(d => DAYS.find(x => x.v === d.trim())?.l ?? "").filter(Boolean).join(", ")}
                </p>
                {!p.isActive && <p className="text-xs text-destructive mt-1">Inactive</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </Layout>
  );
}
