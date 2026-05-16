import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useCustomers } from "@/lib/hooks";
import { Plus, Copy, Archive, Pause, Play, X, Receipt, Users as UsersIcon, RefreshCw } from "lucide-react";

type MealPlanTemplate = {
  id: number; name: string; description: string | null; type: string;
  price: string; currency: string; billingCycle: string; cycleDays: number | null;
  durationCycles: number | null; autoRenew: boolean;
  mealsPerCycle: number | null; creditsPerCycle: number | null; bonusCredits: number;
  maxFamilyMembers: number; isActive: boolean; showOnCustomerApp: boolean;
  archivedAt: string | null;
};
type Subscription = {
  id: number; customerId: number; templateId: number; status: string;
  currentCycleStart: string | null; currentCycleEnd: string | null; nextBillingDate: string | null;
  mealsRemaining: number; mealsUsed: number; creditsRemaining: number; creditsUsed: number;
  paymentMethod: string | null; failedAttempts: number;
};
type SubRow = {
  sub: Subscription;
  customer: { id: number; name: string; phone: string | null; email: string | null } | null;
  template: { id: number; name: string; type: string } | null;
};

function statusBadge(s: string) {
  const variant: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    paused: "bg-yellow-100 text-yellow-700",
    pending: "bg-blue-100 text-blue-700",
    expired: "bg-gray-200 text-gray-700",
    cancelled: "bg-red-100 text-red-700",
  };
  return <Badge className={variant[s] ?? ""}>{s}</Badge>;
}

function CreateTemplateDialog({ restaurantId, onCreated }: { restaurantId: number; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", description: "", type: "monthly_pass",
    price: "", billingCycle: "monthly", durationCycles: "",
    mealsPerCycle: "", creditsPerCycle: "", bonusCredits: "0",
    maxFamilyMembers: "1", autoRenew: true, showOnCustomerApp: true,
  });
  const { toast } = useToast();
  const create = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/meal-plan-templates`, {
      name: form.name,
      description: form.description || undefined,
      type: form.type,
      price: form.price,
      billingCycle: form.billingCycle,
      durationCycles: form.durationCycles ? Number(form.durationCycles) : null,
      mealsPerCycle: form.mealsPerCycle ? Number(form.mealsPerCycle) : null,
      creditsPerCycle: form.creditsPerCycle ? Number(form.creditsPerCycle) : null,
      bonusCredits: Number(form.bonusCredits || 0),
      maxFamilyMembers: Number(form.maxFamilyMembers || 1),
      autoRenew: form.autoRenew,
      showOnCustomerApp: form.showOnCustomerApp,
    }),
    onSuccess: () => {
      toast({ title: "Template created" });
      setOpen(false);
      setForm({ ...form, name: "", price: "", description: "" });
      onCreated();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="w-4 h-4 mr-1" /> New Plan</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create meal plan template</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Type</Label>
              <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["monthly_pass", "coffee", "tiffin", "office", "student", "gym", "family", "credits", "custom"].map(t =>
                    <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Billing cycle</Label>
              <Select value={form.billingCycle} onValueChange={v => setForm({ ...form, billingCycle: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["daily", "weekly", "monthly", "quarterly"].map(t =>
                    <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Price (₹)</Label><Input type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></div>
            <div><Label>Duration (cycles, blank = open)</Label><Input type="number" value={form.durationCycles} onChange={e => setForm({ ...form, durationCycles: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Meals / cycle</Label><Input type="number" value={form.mealsPerCycle} onChange={e => setForm({ ...form, mealsPerCycle: e.target.value })} /></div>
            <div><Label>Credits / cycle</Label><Input type="number" value={form.creditsPerCycle} onChange={e => setForm({ ...form, creditsPerCycle: e.target.value })} /></div>
            <div><Label>Bonus credits</Label><Input type="number" value={form.bonusCredits} onChange={e => setForm({ ...form, bonusCredits: e.target.value })} /></div>
          </div>
          <div><Label>Max family members</Label><Input type="number" value={form.maxFamilyMembers} onChange={e => setForm({ ...form, maxFamilyMembers: e.target.value })} /></div>
          <div className="flex items-center gap-2"><Switch checked={form.autoRenew} onCheckedChange={v => setForm({ ...form, autoRenew: v })} /><Label>Auto-renew</Label></div>
          <div className="flex items-center gap-2"><Switch checked={form.showOnCustomerApp} onCheckedChange={v => setForm({ ...form, showOnCustomerApp: v })} /><Label>Show in customer app</Label></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!form.name || !form.price || create.isPending}>
            {create.isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SellSubscriptionDialog({ restaurantId, templates, onSold }: {
  restaurantId: number; templates: MealPlanTemplate[]; onSold: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: cs } = useCustomers({ search });
  const customers = cs?.data ?? [];
  const [customerId, setCustomerId] = useState<number | "">("");
  const [templateId, setTemplateId] = useState<number | "">("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const { toast } = useToast();
  const sell = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/customer-subscriptions`, {
      customerId, templateId, paymentMethod,
    }),
    onSuccess: () => {
      toast({ title: "Subscription activated" });
      setOpen(false); setCustomerId(""); setTemplateId("");
      onSold();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const activeTemplates = templates.filter(t => t.isActive && !t.archivedAt);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Plus className="w-4 h-4 mr-1" />Sell to customer</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Sell subscription</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Plan</Label>
            <Select value={String(templateId)} onValueChange={v => setTemplateId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Choose a plan" /></SelectTrigger>
              <SelectContent>
                {activeTemplates.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name} — ₹{t.price}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Customer</Label>
            <Input placeholder="Search customer by name/phone" value={search} onChange={e => setSearch(e.target.value)} />
            <div className="max-h-40 overflow-auto mt-2 border rounded">
              {customers.map(c => (
                <button key={c.id} onClick={() => setCustomerId(c.id)}
                  className={`w-full text-left p-2 hover:bg-muted ${customerId === c.id ? "bg-primary/10" : ""}`}>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.phone ?? c.email ?? ""}</div>
                </button>
              ))}
              {customers.length === 0 && <div className="p-2 text-sm text-muted-foreground">No customers</div>}
            </div>
          </div>
          <div><Label>Payment method</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["cash", "upi", "card", "razorpay", "cashfree", "bank", "wallet"].map(p =>
                  <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => sell.mutate()} disabled={!customerId || !templateId || sell.isPending}>
            {sell.isPending ? "Activating..." : "Activate subscription"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubscriptionRow({ row, restaurantId, onChange }: {
  row: SubRow; restaurantId: number; onChange: () => void;
}) {
  const { sub, customer, template } = row;
  const { toast } = useToast();
  const action = (path: string, label: string, body: unknown = {}) =>
    apiPost(`/restaurants/${restaurantId}/customer-subscriptions/${sub.id}/${path}`, body)
      .then(() => { toast({ title: label }); onChange(); })
      .catch((e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }));
  return (
    <tr className="border-b">
      <td className="p-2">
        <div className="font-medium">{customer?.name ?? "—"}</div>
        <div className="text-xs text-muted-foreground">{customer?.phone ?? customer?.email ?? ""}</div>
      </td>
      <td className="p-2">{template?.name ?? "—"}</td>
      <td className="p-2">{statusBadge(sub.status)}</td>
      <td className="p-2 text-sm">
        Meals: {sub.mealsRemaining} / used {sub.mealsUsed}<br />
        Credits: {sub.creditsRemaining} / used {sub.creditsUsed}
      </td>
      <td className="p-2 text-xs text-muted-foreground">
        {sub.nextBillingDate ? `Renews ${new Date(sub.nextBillingDate).toLocaleDateString()}` : "—"}
        {sub.failedAttempts > 0 && <div className="text-red-600">Failed attempts: {sub.failedAttempts}</div>}
      </td>
      <td className="p-2">
        <div className="flex gap-1 flex-wrap">
          {sub.status === "active" && (
            <Button size="sm" variant="outline" onClick={() => action("pause", "Paused")}><Pause className="w-3 h-3" /></Button>
          )}
          {sub.status === "paused" && (
            <Button size="sm" variant="outline" onClick={() => action("resume", "Resumed")}><Play className="w-3 h-3" /></Button>
          )}
          {(sub.status === "active" || sub.status === "paused") && (
            <Button size="sm" variant="destructive" onClick={() => {
              if (confirm("Cancel this subscription immediately?")) action("cancel", "Cancelled", { atCycleEnd: false });
            }}><X className="w-3 h-3" /></Button>
          )}
          {sub.status === "active" && (
            <Button size="sm" variant="outline" title="Charge now" onClick={() => action("charge-now", "Charged")}><RefreshCw className="w-3 h-3" /></Button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function MembershipsPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const templatesQ = useQuery({
    queryKey: ["meal-plan-templates", restaurantId],
    queryFn: () => apiGet<MealPlanTemplate[]>(`/restaurants/${restaurantId}/meal-plan-templates?includeArchived=true`),
  });
  const subsQ = useQuery({
    queryKey: ["customer-subscriptions", restaurantId],
    queryFn: () => apiGet<SubRow[]>(`/restaurants/${restaurantId}/customer-subscriptions`),
  });
  const archiveTemplate = useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${restaurantId}/meal-plan-templates/${id}/archive`),
    onSuccess: () => { toast({ title: "Archived" }); qc.invalidateQueries({ queryKey: ["meal-plan-templates"] }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const duplicateTemplate = useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${restaurantId}/meal-plan-templates/${id}/duplicate`),
    onSuccess: () => { toast({ title: "Duplicated" }); qc.invalidateQueries({ queryKey: ["meal-plan-templates"] }); },
  });
  const togglePublish = useMutation({
    mutationFn: ({ id, show }: { id: number; show: boolean }) =>
      apiPatch(`/restaurants/${restaurantId}/meal-plan-templates/${id}`, { showOnCustomerApp: show, isActive: show }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meal-plan-templates"] }),
  });
  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["meal-plan-templates"] });
    qc.invalidateQueries({ queryKey: ["customer-subscriptions"] });
  };
  const templates = templatesQ.data ?? [];
  const subs = subsQ.data ?? [];

  return (
    <Layout>
      <PageHeader title="Memberships & Meal Plans" subtitle="Templates, customer subscriptions, and auto-billing." />
      <div className="p-6">
        <Tabs defaultValue="templates">
          <TabsList>
            <TabsTrigger value="templates">Plan Templates ({templates.filter(t => !t.archivedAt).length})</TabsTrigger>
            <TabsTrigger value="subscriptions">Customer Subscriptions ({subs.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="templates" className="mt-4">
            <div className="flex justify-end gap-2 mb-3">
              <CreateTemplateDialog restaurantId={restaurantId} onCreated={refreshAll} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map(t => (
                <div key={t.id} className={`border rounded-lg p-4 ${t.archivedAt ? "opacity-50" : ""}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-semibold">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{t.type} · {t.billingCycle}</div>
                    </div>
                    <div className="text-xl font-bold">₹{t.price}</div>
                  </div>
                  {t.description && <div className="text-sm mt-2 text-muted-foreground">{t.description}</div>}
                  <div className="text-sm mt-3 space-y-1">
                    {t.mealsPerCycle && <div>🍽️ {t.mealsPerCycle} meals / cycle</div>}
                    {t.creditsPerCycle && <div>💳 {t.creditsPerCycle} credits / cycle{t.bonusCredits ? ` + ${t.bonusCredits} bonus` : ""}</div>}
                    {t.maxFamilyMembers > 1 && <div>👨‍👩‍👧 Up to {t.maxFamilyMembers} family members</div>}
                    {t.durationCycles && <div>⏳ {t.durationCycles} cycles</div>}
                    {t.autoRenew && <div className="text-green-700">↻ Auto-renews</div>}
                  </div>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {t.archivedAt
                      ? <Badge variant="outline">Archived</Badge>
                      : (
                        <Switch checked={t.showOnCustomerApp}
                          onCheckedChange={(v) => togglePublish.mutate({ id: t.id, show: v })} />
                      )}
                    {!t.archivedAt && <span className="text-xs text-muted-foreground self-center">{t.showOnCustomerApp ? "Visible" : "Hidden"}</span>}
                    <div className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" title="Duplicate" onClick={() => duplicateTemplate.mutate(t.id)}><Copy className="w-3 h-3" /></Button>
                      {!t.archivedAt && (
                        <Button size="sm" variant="ghost" title="Archive" onClick={() => {
                          if (confirm("Archive this template?")) archiveTemplate.mutate(t.id);
                        }}><Archive className="w-3 h-3" /></Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {templates.length === 0 && (
                <div className="col-span-full text-center text-muted-foreground py-12">
                  No plan templates yet. Click <strong>New Plan</strong> to create your first one.
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="subscriptions" className="mt-4">
            <div className="flex justify-end gap-2 mb-3">
              <SellSubscriptionDialog restaurantId={restaurantId} templates={templates} onSold={refreshAll} />
            </div>
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-2 text-left">Customer</th>
                    <th className="p-2 text-left">Plan</th>
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-left">Balance</th>
                    <th className="p-2 text-left">Renewal</th>
                    <th className="p-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map(row => (
                    <SubscriptionRow key={row.sub.id} row={row} restaurantId={restaurantId} onChange={refreshAll} />
                  ))}
                  {subs.length === 0 && (
                    <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">No active subscriptions yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
