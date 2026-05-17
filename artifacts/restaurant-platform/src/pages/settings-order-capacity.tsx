import { useState, useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useOrderCapacityConfig,
  useSaveOrderCapacityConfig,
  usePauseOrders,
  useResumeOrders,
  type OrderCapacityConfig,
} from "@/lib/hooks-order-capacity";
import { useToast } from "@/hooks/use-toast";
import { Pause, Play, AlertTriangle, Clock } from "lucide-react";

const ORDER_TYPES = ["dine_in", "takeaway", "delivery", "curbside", "pickup"];

export default function SettingsOrderCapacityPage() {
  const { data, isLoading } = useOrderCapacityConfig();
  const save = useSaveOrderCapacityConfig();
  const pause = usePauseOrders();
  const resume = useResumeOrders();
  const { toast } = useToast();
  const [form, setForm] = useState<OrderCapacityConfig | null>(null);

  useEffect(() => { if (data) setForm(data); }, [data]);
  if (isLoading || !form) return <Layout><div className="p-6">Loading…</div></Layout>;

  function set<K extends keyof OrderCapacityConfig>(k: K, v: OrderCapacityConfig[K]) {
    setForm(prev => prev ? { ...prev, [k]: v } : prev);
  }

  function addOrderTypeCap() {
    if (!form) return;
    const remaining = ORDER_TYPES.find(t => !form.orderTypeCaps.some(c => c.orderType === t));
    if (!remaining) return;
    set("orderTypeCaps", [...form.orderTypeCaps, { orderType: remaining, maxPerSlot: 10 }]);
  }

  async function onPause(target: "qr" | "online" | "all", minutes?: number) {
    await pause.mutateAsync({ target, minutes, reason: form?.unavailableMessage ?? undefined });
    toast({ title: `Paused ${target} orders${minutes ? ` for ${minutes} min` : ""}` });
  }
  async function onResume(target: "qr" | "online" | "all") {
    await resume.mutateAsync({ target });
    toast({ title: `Resumed ${target} orders` });
  }

  return (
    <Layout>
      <PageHeader
        title="Order Throttling & Kitchen Capacity"
        subtitle="Cap orders per slot, pause channels in one tap, and protect kitchen during rush."
      />
      <div className="p-6 max-w-4xl space-y-6">
        <Section title="Enable controls">
          <Toggle label="Enforce order capacity rules" value={form.enabled} onChange={v => set("enabled", v)} testId="toggle-enabled" />
          <Field label="Slot size (minutes)" hint="Rolling time window used to count orders.">
            <Input type="number" min={1} max={240} value={form.slotMinutes}
              onChange={e => set("slotMinutes", Math.max(1, Number(e.target.value)))} data-testid="input-slot" />
          </Field>
          <Field label="Max orders per slot (across all channels)" hint="Leave blank for no overall cap.">
            <Input type="number" min={0} value={form.maxOrdersPerSlot ?? ""}
              onChange={e => set("maxOrdersPerSlot", e.target.value === "" ? null : Math.max(0, Number(e.target.value)))} data-testid="input-max-slot" />
          </Field>
          <Field label="Customer-facing message when at capacity">
            <Textarea rows={2} value={form.unavailableMessage ?? ""}
              onChange={e => set("unavailableMessage", e.target.value || null)} data-testid="input-msg"
              placeholder="e.g. We're cooking flat out — try again in a few minutes!" />
          </Field>
        </Section>

        <Section title="One-tap pause">
          <PauseRow label="QR (in-restaurant)" paused={form.pauseQrOrders}
            onPause={() => onPause("qr", 30)} onResume={() => onResume("qr")} />
          <PauseRow label="Online ordering page" paused={form.pauseOnlineOrders}
            onPause={() => onPause("online", 30)} onResume={() => onResume("online")} />
          <PauseRow label="All online channels" paused={form.pauseQrOrders && form.pauseOnlineOrders}
            onPause={() => onPause("all", 30)} onResume={() => onResume("all")} />
          {form.pauseUntil && (
            <p className="text-xs text-amber-600 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Auto-resume at {new Date(form.pauseUntil).toLocaleString()}
            </p>
          )}
        </Section>

        <Section title="Auto-extend prep during rush">
          <Field label="Trigger threshold (% of slot capacity)">
            <Input type="number" min={1} max={100} value={form.autoExtendThresholdPct}
              onChange={e => set("autoExtendThresholdPct", Math.max(1, Math.min(100, Number(e.target.value))))} data-testid="input-threshold" />
          </Field>
          <Field label="Extra minutes added to ticket prep time">
            <Input type="number" min={0} max={120} value={form.autoExtendPrepMinutes}
              onChange={e => set("autoExtendPrepMinutes", Math.max(0, Number(e.target.value)))} data-testid="input-bump" />
          </Field>
          <Toggle label="Alert managers when rush hits the threshold" value={form.managerAlertOnRush}
            onChange={v => set("managerAlertOnRush", v)} testId="toggle-alert" />
        </Section>

        <Section title="Per-order-type caps (per slot)">
          {form.orderTypeCaps.length === 0 && <p className="text-sm text-muted-foreground">No caps yet.</p>}
          {form.orderTypeCaps.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <select className="border border-border rounded-md h-9 px-2 bg-background"
                value={c.orderType}
                onChange={e => {
                  const next = [...form.orderTypeCaps];
                  next[i] = { ...c, orderType: e.target.value };
                  set("orderTypeCaps", next);
                }}>
                {ORDER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <Input type="number" min={0} className="w-32" value={c.maxPerSlot}
                onChange={e => {
                  const next = [...form.orderTypeCaps];
                  next[i] = { ...c, maxPerSlot: Math.max(0, Number(e.target.value)) };
                  set("orderTypeCaps", next);
                }} />
              <Button size="sm" variant="ghost" onClick={() => set("orderTypeCaps", form.orderTypeCaps.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={addOrderTypeCap}>Add order-type cap</Button>
        </Section>

        <Section title="Per-item caps (per slot)">
          {form.itemCaps.length === 0 && <p className="text-sm text-muted-foreground">No item caps yet.</p>}
          {form.itemCaps.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input type="number" placeholder="Menu item ID" value={c.menuItemId}
                onChange={e => {
                  const next = [...form.itemCaps];
                  next[i] = { ...c, menuItemId: Number(e.target.value) };
                  set("itemCaps", next);
                }} className="w-40" />
              <Input type="number" min={0} className="w-32" placeholder="Max / slot" value={c.maxPerSlot}
                onChange={e => {
                  const next = [...form.itemCaps];
                  next[i] = { ...c, maxPerSlot: Math.max(0, Number(e.target.value)) };
                  set("itemCaps", next);
                }} />
              <Button size="sm" variant="ghost" onClick={() => set("itemCaps", form.itemCaps.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => set("itemCaps", [...form.itemCaps, { menuItemId: 0, maxPerSlot: 5 }])}>Add item cap</Button>
        </Section>

        <Section title="Per-outlet caps (per slot)">
          {form.outletCaps.length === 0 && <p className="text-sm text-muted-foreground">No outlet caps yet.</p>}
          {form.outletCaps.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input type="number" placeholder="Branch ID" value={c.branchId} className="w-40"
                onChange={e => {
                  const next = [...form.outletCaps];
                  next[i] = { ...c, branchId: Number(e.target.value) };
                  set("outletCaps", next);
                }} />
              <Input type="number" min={0} className="w-32" placeholder="Max / slot" value={c.maxPerSlot}
                onChange={e => {
                  const next = [...form.outletCaps];
                  next[i] = { ...c, maxPerSlot: Math.max(0, Number(e.target.value)) };
                  set("outletCaps", next);
                }} />
              <Button size="sm" variant="ghost" onClick={() => set("outletCaps", form.outletCaps.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => set("outletCaps", [...form.outletCaps, { branchId: 0, maxPerSlot: 20 }])}>Add outlet cap</Button>
        </Section>

        <Section title="Paused delivery zones">
          <p className="text-sm text-muted-foreground">Enter delivery zone IDs to pause delivery to that area. Customers in those zones will see “not accepting orders”.</p>
          <Input
            placeholder="e.g. 4, 7, 12"
            value={form.pausedDeliveryZones.join(", ")}
            onChange={e => {
              const ids = e.target.value.split(",").map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
              set("pausedDeliveryZones", ids);
            }}
            data-testid="input-paused-zones"
          />
        </Section>

        <div className="flex justify-end">
          <Button
            onClick={() => save.mutate(form, {
              onSuccess: () => toast({ title: "Capacity settings saved" }),
              onError: (e) => toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" }),
            })}
            disabled={save.isPending}
            data-testid="button-save"
          >
            Save changes
          </Button>
        </div>

        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 border border-border rounded-md p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-500" />
          <div>
            All changes here are recorded in the audit log. Manager and owner roles only. Available on Growth, Pro and Enterprise plans.
          </div>
        </div>
      </div>
    </Layout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-3">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </div>
  );
}
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
function Toggle({ label, value, onChange, testId }: { label: string; value: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <label className="flex items-center justify-between py-2 cursor-pointer">
      <span className="text-sm">{label}</span>
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} data-testid={testId} />
    </label>
  );
}
function PauseRow({ label, paused, onPause, onResume }: { label: string; paused: boolean; onPause: () => void; onResume: () => void }) {
  return (
    <div className="flex items-center justify-between border border-border rounded-md p-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className={"text-xs " + (paused ? "text-red-600" : "text-emerald-600")}>
          {paused ? "Paused" : "Accepting orders"}
        </div>
      </div>
      {paused
        ? <Button size="sm" variant="outline" onClick={onResume}><Play className="w-3.5 h-3.5 mr-1.5" />Resume</Button>
        : <Button size="sm" variant="outline" onClick={onPause}><Pause className="w-3.5 h-3.5 mr-1.5" />Pause 30 min</Button>}
    </div>
  );
}
