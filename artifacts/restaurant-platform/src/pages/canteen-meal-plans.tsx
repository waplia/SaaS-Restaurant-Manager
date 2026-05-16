import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Ban } from "lucide-react";
import {
  useMealPlans, useSaveMealPlan, useDeleteMealPlan,
  useGlobalRestrictions, useAddGlobalRestriction, useDeleteGlobalRestriction,
  useStudents, useMealPlanSubs, useSubscribeMealPlan, useCancelMealPlanSub,
  rupees,
} from "@/lib/canteen";
import { useMenuItems, useMenuCategories } from "@/lib/hooks";
import { toast } from "@/hooks/use-toast";

export default function CanteenMealPlansPage() {
  const { data: plans = [] } = useMealPlans();
  const save = useSaveMealPlan();
  const del = useDeleteMealPlan();
  const { data: restrictions = [] } = useGlobalRestrictions();
  const addR = useAddGlobalRestriction();
  const delR = useDeleteGlobalRestriction();
  const { data: items = [] } = useMenuItems();
  const { data: cats = [] } = useMenuCategories();
  const { data: students = [] } = useStudents();
  const { data: subs = [] } = useMealPlanSubs();
  const subscribe = useSubscribeMealPlan();
  const cancelSub = useCancelMealPlanSub();

  const [form, setForm] = useState({
    name: "", description: "", mealType: "lunch",
    dailyAllowance: "5000", monthlyPrice: "100000", daysOfWeek: "1,2,3,4,5",
  });
  const [showNew, setShowNew] = useState(false);

  const submit = async () => {
    if (!form.name.trim()) { toast({ title: "Name required" }); return; }
    try {
      await save.mutateAsync({
        name: form.name, description: form.description, mealType: form.mealType,
        dailyAllowance: Math.round(Number(form.dailyAllowance) * 100),
        monthlyPrice: Math.round(Number(form.monthlyPrice) * 100),
        daysOfWeek: form.daysOfWeek,
      });
      setShowNew(false);
      toast({ title: "Plan saved" });
    } catch (err) { toast({ title: "Failed", description: (err as Error).message }); }
  };

  return (
    <Layout>
      <PageHeader title="Meal Plans & Restrictions" subtitle="Subscriptions and item allow-lists for canteen students"
        actions={<Button onClick={() => setShowNew(true)} data-testid="button-new-plan"><Plus className="w-4 h-4 mr-1" />New Plan</Button>} />

      {showNew && (
        <div className="bg-card border border-border rounded-xl p-4 m-6">
          <h3 className="font-semibold mb-3">New Meal Plan</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Meal Type</Label>
              <select className="w-full border border-border rounded-md p-2 bg-background" value={form.mealType} onChange={e => setForm({ ...form, mealType: e.target.value })}>
                <option value="breakfast">Breakfast</option><option value="lunch">Lunch</option>
                <option value="snacks">Snacks</option><option value="dinner">Dinner</option>
              </select>
            </div>
            <div><Label>Days (comma)</Label><Input value={form.daysOfWeek} onChange={e => setForm({ ...form, daysOfWeek: e.target.value })} /></div>
            <div><Label>Daily Allowance (₹)</Label><Input type="number" value={form.dailyAllowance} onChange={e => setForm({ ...form, dailyAllowance: e.target.value })} /></div>
            <div><Label>Monthly Price (₹)</Label><Input type="number" value={form.monthlyPrice} onChange={e => setForm({ ...form, monthlyPrice: e.target.value })} /></div>
            <div className="md:col-span-3"><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
          </div>
          <div className="flex gap-2 mt-3"><Button onClick={submit}>Save</Button><Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button></div>
        </div>
      )}

      <div className="m-6 bg-card border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left"><tr>
            <th className="p-3">Plan</th><th className="p-3">Meal</th><th className="p-3">Days</th>
            <th className="p-3">Daily</th><th className="p-3">Monthly</th><th className="p-3"></th>
          </tr></thead>
          <tbody>
            {plans.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No plans yet</td></tr>}
            {plans.map(p => (
              <tr key={p.id} className="border-t border-border">
                <td className="p-3"><div className="font-medium">{p.name}</div><div className="text-xs text-muted-foreground">{p.description}</div></td>
                <td className="p-3">{p.mealType}</td><td className="p-3 text-xs">{p.daysOfWeek}</td>
                <td className="p-3">{rupees(p.dailyAllowance)}</td><td className="p-3">{rupees(p.monthlyPrice)}</td>
                <td className="p-3"><Button size="sm" variant="ghost" onClick={() => confirm("Deactivate plan?") && del.mutate(p.id)}><Trash2 className="w-3 h-3" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Subscribe student to a plan */}
      <div className="m-6 bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-3">Subscribe Student to Plan</h3>
        <SubscribeForm students={students} plans={plans} onSubmit={subscribe.mutateAsync} />
        <div className="mt-4 text-sm">
          <div className="font-medium mb-2">Active Subscriptions</div>
          {subs.length === 0 && <div className="text-muted-foreground">None.</div>}
          {subs.map(s => (
            <div key={s.id} className="flex items-center justify-between border border-border rounded-md p-2 mb-1">
              <div>{s.studentName} → {s.planName} <span className="text-xs text-muted-foreground">({s.status}, from {s.startDate})</span></div>
              <Button size="sm" variant="ghost" onClick={() => cancelSub.mutate(s.id)}><Trash2 className="w-3 h-3" /></Button>
            </div>
          ))}
        </div>
      </div>

      {/* Global restrictions */}
      <div className="m-6 bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Ban className="w-4 h-4" />Restaurant-Wide Item Restrictions</h3>
        <div className="text-xs text-muted-foreground mb-3">Items / categories that no canteen student is allowed to buy.</div>
        <RestrictionForm items={items} cats={cats} onAdd={addR.mutateAsync} />
        <div className="mt-3 space-y-1">
          {restrictions.map(r => {
            const label = r.scope === "item"
              ? `Item: ${items.find(i => i.id === r.menuItemId)?.name ?? `#${r.menuItemId}`}`
              : `Category: ${cats.find(c => c.id === r.categoryId)?.name ?? `#${r.categoryId}`}`;
            return (
              <div key={r.id} className="flex items-center justify-between text-sm border border-border rounded-md p-2">
                <div>{label}{r.appliesToClass && <span className="text-xs text-muted-foreground ml-2">(class: {r.appliesToClass})</span>}{r.reason && <span className="text-xs text-muted-foreground ml-2">— {r.reason}</span>}</div>
                <Button size="sm" variant="ghost" onClick={() => delR.mutate(r.id)}><Trash2 className="w-3 h-3" /></Button>
              </div>
            );
          })}
          {restrictions.length === 0 && <div className="text-sm text-muted-foreground">No restrictions configured.</div>}
        </div>
      </div>
    </Layout>
  );
}

function SubscribeForm({ students, plans, onSubmit }: {
  students: { id: number; name: string }[];
  plans: { id: number; name: string }[];
  onSubmit: (i: { studentId: number; planId: number; startDate: string }) => Promise<unknown>;
}) {
  const [studentId, setStudentId] = useState<number | "">("");
  const [planId, setPlanId] = useState<number | "">("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
      <select className="border border-border rounded-md p-2 bg-background" value={studentId} onChange={e => setStudentId(Number(e.target.value) || "")}>
        <option value="">Select student</option>
        {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <select className="border border-border rounded-md p-2 bg-background" value={planId} onChange={e => setPlanId(Number(e.target.value) || "")}>
        <option value="">Select plan</option>
        {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
      <Button disabled={!studentId || !planId} onClick={async () => {
        await onSubmit({ studentId: Number(studentId), planId: Number(planId), startDate });
        toast({ title: "Subscribed" });
      }}>Subscribe</Button>
    </div>
  );
}

function RestrictionForm({ items, cats, onAdd }: {
  items: { id: number; name: string }[];
  cats: { id: number; name: string }[];
  onAdd: (i: { scope: "item" | "category"; menuItemId?: number; categoryId?: number; appliesToClass?: string; reason?: string }) => Promise<unknown>;
}) {
  const [scope, setScope] = useState<"item" | "category">("item");
  const [target, setTarget] = useState<number | "">("");
  const [appliesToClass, setAppliesToClass] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
      <select className="border border-border rounded-md p-2 bg-background" value={scope} onChange={e => { setScope(e.target.value as "item" | "category"); setTarget(""); }}>
        <option value="item">Item</option><option value="category">Category</option>
      </select>
      <select className="border border-border rounded-md p-2 bg-background" value={target} onChange={e => setTarget(Number(e.target.value) || "")}>
        <option value="">Select…</option>
        {(scope === "item" ? items : cats).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <Input placeholder="Class (optional)" value={appliesToClass} onChange={e => setAppliesToClass(e.target.value)} />
      <Input placeholder="Reason" value={reason} onChange={e => setReason(e.target.value)} />
      <Button disabled={!target} onClick={async () => {
        await onAdd({
          scope,
          ...(scope === "item" ? { menuItemId: Number(target) } : { categoryId: Number(target) }),
          appliesToClass: appliesToClass || undefined,
          reason: reason || undefined,
        });
        setTarget(""); setReason(""); setAppliesToClass("");
      }}>Add</Button>
    </div>
  );
}
