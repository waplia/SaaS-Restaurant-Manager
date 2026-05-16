import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantId, useMenuItems, useMenuCategories } from "@/lib/hooks";
import { apiGet, apiPost, apiPut, apiDelete, apiPatch } from "@/lib/api";
import { Plus, Pencil, Trash2, Power, Calendar as CalIcon, FlaskConical, X } from "lucide-react";
import { cn } from "@/lib/utils";

type RuleType =
  | "happy_hour" | "lunch_special" | "weekend" | "delivery_only"
  | "outlet" | "customer_group" | "event" | "time_of_day" | "day_of_week" | "custom";

type AdjustmentKind = "percent_off" | "percent_up" | "flat_off" | "fixed_price";
type ScopeKind = "all" | "category" | "item";
type Channel = "dine_in" | "takeaway" | "delivery";
type CustomerGroup = "guest" | "regular" | "vip" | "loyalty_silver" | "loyalty_gold" | "loyalty_platinum";

interface PricingRule {
  id: number;
  name: string;
  ruleType: RuleType;
  description: string | null;
  isActive: boolean;
  priority: number;
  scopeKind: ScopeKind;
  scopeIds: number[];
  adjustmentKind: AdjustmentKind;
  adjustmentValue: string;
  startDate: string | null;
  endDate: string | null;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  channels: Channel[];
  branchIds: number[];
  customerGroups: CustomerGroup[];
}

interface RuleFormState {
  id?: number;
  name: string;
  ruleType: RuleType;
  description: string;
  isActive: boolean;
  priority: number;
  scopeKind: ScopeKind;
  scopeIds: number[];
  adjustmentKind: AdjustmentKind;
  adjustmentValue: string;
  startDate: string;
  endDate: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  channels: Channel[];
  branchIds: number[];
  customerGroups: CustomerGroup[];
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RULE_TYPES: RuleType[] = ["happy_hour", "lunch_special", "weekend", "delivery_only", "outlet", "customer_group", "event", "time_of_day", "day_of_week", "custom"];
const ADJUSTMENT_KINDS: AdjustmentKind[] = ["percent_off", "percent_up", "flat_off", "fixed_price"];
const CHANNELS: Channel[] = ["dine_in", "takeaway", "delivery"];
const CUSTOMER_GROUPS: CustomerGroup[] = ["regular", "vip", "loyalty_silver", "loyalty_gold", "loyalty_platinum", "guest"];

function emptyForm(): RuleFormState {
  return {
    name: "", ruleType: "happy_hour", description: "", isActive: true, priority: 100,
    scopeKind: "all", scopeIds: [], adjustmentKind: "percent_off", adjustmentValue: "10",
    startDate: "", endDate: "", daysOfWeek: [], startTime: "", endTime: "",
    channels: [], branchIds: [], customerGroups: [],
  };
}

function toForm(r: PricingRule): RuleFormState {
  return {
    id: r.id, name: r.name, ruleType: r.ruleType, description: r.description ?? "",
    isActive: r.isActive, priority: r.priority,
    scopeKind: r.scopeKind, scopeIds: r.scopeIds ?? [],
    adjustmentKind: r.adjustmentKind, adjustmentValue: String(r.adjustmentValue),
    startDate: r.startDate ? r.startDate.slice(0, 10) : "",
    endDate: r.endDate ? r.endDate.slice(0, 10) : "",
    daysOfWeek: r.daysOfWeek ?? [], startTime: r.startTime ?? "", endTime: r.endTime ?? "",
    channels: r.channels ?? [], branchIds: r.branchIds ?? [], customerGroups: r.customerGroups ?? [],
  };
}

function toPayload(f: RuleFormState) {
  return {
    name: f.name.trim(),
    ruleType: f.ruleType,
    description: f.description || null,
    isActive: f.isActive,
    priority: Number(f.priority) || 100,
    scopeKind: f.scopeKind,
    scopeIds: f.scopeKind === "all" ? [] : f.scopeIds,
    adjustmentKind: f.adjustmentKind,
    adjustmentValue: Number(f.adjustmentValue) || 0,
    startDate: f.startDate ? new Date(`${f.startDate}T00:00:00.000Z`).toISOString() : null,
    endDate: f.endDate ? new Date(`${f.endDate}T23:59:59.000Z`).toISOString() : null,
    daysOfWeek: f.daysOfWeek,
    startTime: f.startTime || null,
    endTime: f.endTime || null,
    channels: f.channels,
    branchIds: f.branchIds,
    customerGroups: f.customerGroups,
  };
}

function describeRule(r: PricingRule): string {
  const v = Number(r.adjustmentValue);
  switch (r.adjustmentKind) {
    case "percent_off": return `−${v}% off`;
    case "percent_up": return `+${v}% up`;
    case "flat_off": return `−₹${v.toFixed(2)}`;
    case "fixed_price": return `Fixed ₹${v.toFixed(2)}`;
  }
}

export default function PricingRulesPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<RuleFormState | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);

  const rulesQ = useQuery({
    queryKey: ["pricing-rules", restaurantId],
    queryFn: () => apiGet<PricingRule[]>(`/restaurants/${restaurantId}/pricing-rules`),
  });
  const branchesQ = useQuery({
    queryKey: ["branches", restaurantId],
    queryFn: () => apiGet<Array<{ id: number; name: string }>>(`/restaurants/${restaurantId}/branches`).catch(() => []),
  });
  const itemsQ = useMenuItems();
  const catsQ = useMenuCategories();

  const createMut = useMutation({
    mutationFn: (data: ReturnType<typeof toPayload>) => apiPost<PricingRule>(`/restaurants/${restaurantId}/pricing-rules`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pricing-rules"] }); toast({ title: "Pricing rule created" }); setEditing(null); },
    onError: (e: Error) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ReturnType<typeof toPayload> }) => apiPut<PricingRule>(`/restaurants/${restaurantId}/pricing-rules/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pricing-rules"] }); toast({ title: "Pricing rule updated" }); setEditing(null); },
    onError: (e: Error) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => apiPatch(`/restaurants/${restaurantId}/pricing-rules/${id}/toggle`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pricing-rules"] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/pricing-rules/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pricing-rules"] }); toast({ title: "Deleted" }); },
  });

  const rules = rulesQ.data ?? [];

  const submit = () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    const payload = toPayload(editing);
    if (editing.id) updateMut.mutate({ id: editing.id, data: payload });
    else createMut.mutate(payload);
  };

  return (
    <Layout>
      <PageHeader
        title="Pricing Rules"
        description="Happy hour, weekend, delivery, outlet, customer group and event-based dynamic pricing."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowCalendar(true)}><CalIcon className="w-4 h-4 mr-1" /> Calendar</Button>
            <Button variant="outline" onClick={() => setShowSimulator(true)}><FlaskConical className="w-4 h-4 mr-1" /> Simulate</Button>
            <Button onClick={() => setEditing(emptyForm())}><Plus className="w-4 h-4 mr-1" /> New rule</Button>
          </div>
        }
      />

      <div className="space-y-2 p-4">
        {rulesQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!rulesQ.isLoading && rules.length === 0 && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            No pricing rules yet. Create one to start running happy hours, weekend pricing or delivery-only deals.
          </CardContent></Card>
        )}
        {rules.map((r) => (
          <Card key={r.id} className={cn(!r.isActive && "opacity-60")}>
            <CardContent className="py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted">{r.ruleType.replace(/_/g, " ")}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{describeRule(r)}</span>
                  <span className="text-xs text-muted-foreground">priority {r.priority}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Scope: {r.scopeKind}{r.scopeIds.length ? ` (${r.scopeIds.length})` : ""} ·
                  {r.daysOfWeek.length ? ` ${r.daysOfWeek.map((d) => DAY_NAMES[d]).join("/")}` : " any day"} ·
                  {r.startTime || r.endTime ? ` ${r.startTime ?? "—"}–${r.endTime ?? "—"}` : " all day"} ·
                  {r.channels.length ? ` ${r.channels.join("/")}` : " any channel"}
                  {r.branchIds.length ? ` · outlets ${r.branchIds.length}` : ""}
                  {r.customerGroups.length ? ` · ${r.customerGroups.join("/")}` : ""}
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => toggleMut.mutate({ id: r.id, isActive: !r.isActive })} title={r.isActive ? "Disable" : "Enable"}>
                <Power className={cn("w-4 h-4", r.isActive ? "text-emerald-600" : "text-muted-foreground")} />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => setEditing(toForm(r))}><Pencil className="w-4 h-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Delete "${r.name}"?`)) deleteMut.mutate(r.id); }}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {editing && (
        <RuleForm
          form={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSubmit={submit}
          submitting={createMut.isPending || updateMut.isPending}
          branches={branchesQ.data ?? []}
          categories={catsQ.data ?? []}
          items={itemsQ.data ?? []}
        />
      )}
      {showCalendar && <CalendarDialog restaurantId={restaurantId} branches={branchesQ.data ?? []} onClose={() => setShowCalendar(false)} />}
      {showSimulator && <SimulatorDialog restaurantId={restaurantId} branches={branchesQ.data ?? []} items={itemsQ.data ?? []} onClose={() => setShowSimulator(false)} />}
    </Layout>
  );
}

function RuleForm(props: {
  form: RuleFormState;
  onChange: (f: RuleFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  branches: Array<{ id: number; name: string }>;
  categories: Array<{ id: number; name: string }>;
  items: Array<{ id: number; name: string }>;
}) {
  const { form, onChange } = props;
  const set = <K extends keyof RuleFormState>(k: K, v: RuleFormState[K]) => onChange({ ...form, [k]: v });
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-background rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-semibold">{form.id ? "Edit" : "New"} pricing rule</h3>
          <Button variant="ghost" size="icon" onClick={props.onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Happy Hour 4–6 PM" />
            </div>
            <div>
              <Label>Type</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3" value={form.ruleType} onChange={(e) => set("ruleType", e.target.value as RuleType)}>
                {RULE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
              </select>
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Input value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Adjustment</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3" value={form.adjustmentKind} onChange={(e) => set("adjustmentKind", e.target.value as AdjustmentKind)}>
                {ADJUSTMENT_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div>
              <Label>Value</Label>
              <Input type="number" min={0} step="0.01" value={form.adjustmentValue} onChange={(e) => set("adjustmentValue", e.target.value)} />
            </div>
            <div>
              <Label>Priority</Label>
              <Input type="number" min={0} value={form.priority} onChange={(e) => set("priority", Number(e.target.value))} />
            </div>
          </div>

          <div>
            <Label>Scope</Label>
            <div className="flex gap-2 mt-1">
              {(["all", "category", "item"] as ScopeKind[]).map((k) => (
                <Button key={k} type="button" size="sm" variant={form.scopeKind === k ? "default" : "outline"} onClick={() => set("scopeKind", k)}>{k}</Button>
              ))}
            </div>
            {form.scopeKind === "category" && (
              <div className="mt-2 max-h-40 overflow-y-auto border rounded p-2 grid grid-cols-2 gap-1">
                {props.categories.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.scopeIds.includes(c.id)} onChange={() => set("scopeIds", toggle(form.scopeIds, c.id))} />
                    {c.name}
                  </label>
                ))}
              </div>
            )}
            {form.scopeKind === "item" && (
              <div className="mt-2 max-h-40 overflow-y-auto border rounded p-2 grid grid-cols-2 gap-1">
                {props.items.map((i) => (
                  <label key={i.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.scopeIds.includes(i.id)} onChange={() => set("scopeIds", toggle(form.scopeIds, i.id))} />
                    {i.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label>Start date</Label><Input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} /></div>
            <div><Label>End date</Label><Input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} /></div>
            <div><Label>Start time</Label><Input type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} /></div>
            <div><Label>End time</Label><Input type="time" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} /></div>
          </div>

          <div>
            <Label>Days of week</Label>
            <div className="flex gap-1 mt-1">
              {DAY_NAMES.map((d, i) => (
                <Button key={d} type="button" size="sm" variant={form.daysOfWeek.includes(i) ? "default" : "outline"}
                  onClick={() => set("daysOfWeek", toggle(form.daysOfWeek, i))}>{d}</Button>
              ))}
            </div>
          </div>

          <div>
            <Label>Channels (empty = any)</Label>
            <div className="flex gap-2 mt-1">
              {CHANNELS.map((c) => (
                <Button key={c} type="button" size="sm" variant={form.channels.includes(c) ? "default" : "outline"}
                  onClick={() => set("channels", toggle(form.channels, c))}>{c.replace("_", " ")}</Button>
              ))}
            </div>
          </div>

          {props.branches.length > 0 && (
            <div>
              <Label>Outlets (empty = all)</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {props.branches.map((b) => (
                  <Button key={b.id} type="button" size="sm" variant={form.branchIds.includes(b.id) ? "default" : "outline"}
                    onClick={() => set("branchIds", toggle(form.branchIds, b.id))}>{b.name}</Button>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label>Customer groups (empty = anyone)</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {CUSTOMER_GROUPS.map((g) => (
                <Button key={g} type="button" size="sm" variant={form.customerGroups.includes(g) ? "default" : "outline"}
                  onClick={() => set("customerGroups", toggle(form.customerGroups, g))}>{g.replace(/_/g, " ")}</Button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
            Active
          </label>
        </div>
        <div className="border-t border-border px-4 py-3 flex justify-end gap-2">
          <Button variant="outline" onClick={props.onClose}>Cancel</Button>
          <Button onClick={props.onSubmit} disabled={props.submitting}>{props.submitting ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}

function CalendarDialog(props: { restaurantId: number; branches: Array<{ id: number; name: string }>; onClose: () => void }) {
  const [from] = useState(() => new Date().toISOString().slice(0, 10));
  const [to] = useState(() => new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10));
  const [branchId, setBranchId] = useState<string>("");
  const q = useQuery({
    queryKey: ["pricing-calendar", props.restaurantId, from, to, branchId],
    queryFn: () => apiGet<{ slots: Array<{ date: string; hour: number; rules: Array<{ id: number; name: string; ruleType: string; priority: number }>; conflict: boolean }> }>(
      `/restaurants/${props.restaurantId}/pricing-rules/calendar/view?from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`,
    ),
  });
  const grouped = useMemo(() => {
    const m = new Map<string, Array<{ hour: number; rules: Array<{ id: number; name: string; ruleType: string; priority: number }>; conflict: boolean }>>();
    (q.data?.slots ?? []).forEach((s) => {
      const arr = m.get(s.date) ?? [];
      arr.push(s);
      m.set(s.date, arr);
    });
    return Array.from(m.entries());
  }, [q.data]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-background rounded-lg w-full max-w-5xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-semibold">Pricing calendar — {from} to {to}</h3>
          <div className="flex items-center gap-2">
            {props.branches.length > 0 && (
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="h-8 rounded border border-input bg-background px-2 text-sm">
                <option value="">All outlets</option>
                {props.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <Button variant="ghost" size="icon" onClick={props.onClose}><X className="w-4 h-4" /></Button>
          </div>
        </div>
        <div className="p-4 space-y-4">
          {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {grouped.map(([date, slots]) => (
            <div key={date}>
              <h4 className="text-xs font-semibold uppercase mb-1">{date}</h4>
              <div className="grid grid-cols-24 gap-px text-[10px]">
                {Array.from({ length: 24 }, (_, h) => {
                  const slot = slots.find((s) => s.hour === h);
                  const has = slot && slot.rules.length > 0;
                  return (
                    <div key={h}
                      title={slot && has ? slot.rules.map((r) => `${r.name} (p${r.priority})`).join("\n") : `${h}:00 — no rules`}
                      className={cn("h-8 flex items-center justify-center border",
                        has ? (slot!.conflict ? "bg-amber-200 border-amber-400" : "bg-emerald-200 border-emerald-400") : "bg-muted/30 border-border")}>
                      {h}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SimulatorDialog(props: { restaurantId: number; branches: Array<{ id: number; name: string }>; items: Array<{ id: number; name: string; price: string }>; onClose: () => void }) {
  const [menuItemId, setMenuItemId] = useState<number | "">(props.items[0]?.id ?? "");
  const [channel, setChannel] = useState<Channel>("dine_in");
  const [branchId, setBranchId] = useState<string>("");
  const [at, setAt] = useState<string>(() => new Date().toISOString().slice(0, 16));
  const [result, setResult] = useState<{ unitPrice: number; originalPrice: number; appliedRule: { name: string; ruleType: string } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    if (!menuItemId) return;
    try {
      const r = await apiPost<{ unitPrice: number; originalPrice: number; appliedRule: { name: string; ruleType: string } | null }>(
        `/restaurants/${props.restaurantId}/pricing-rules/simulate`,
        { menuItemId, channel, branchId: branchId ? Number(branchId) : null, at: new Date(at).toISOString() },
      );
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-background rounded-lg w-full max-w-md">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-semibold">Simulate price</h3>
          <Button variant="ghost" size="icon" onClick={props.onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <Label>Item</Label>
            <select className="w-full h-10 rounded-md border border-input bg-background px-3" value={menuItemId} onChange={(e) => setMenuItemId(Number(e.target.value))}>
              {props.items.map((i) => <option key={i.id} value={i.id}>{i.name} — ₹{Number(i.price).toFixed(2)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Channel</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3" value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
                {CHANNELS.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
              </select>
            </div>
            <div>
              <Label>Outlet</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">Any</option>
                {props.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <Label>At</Label>
            <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </div>
          <Button className="w-full" onClick={run}>Calculate</Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {result && (
            <div className="border rounded p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Original</span><span>₹{result.originalPrice.toFixed(2)}</span></div>
              <div className="flex justify-between font-semibold"><span>Adjusted</span><span>₹{result.unitPrice.toFixed(2)}</span></div>
              <div className="text-xs text-muted-foreground">
                {result.appliedRule ? `Applied: ${result.appliedRule.name} (${result.appliedRule.ruleType})` : "No matching rule — base price."}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
