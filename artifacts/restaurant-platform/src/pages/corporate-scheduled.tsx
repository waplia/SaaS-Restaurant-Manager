import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useScheduledOrders, useCreateScheduledOrder, useUpdateScheduledOrder, useRunDueScheduled, useCorporateCompanies } from "@/lib/corporate";

const RECURRENCES = [
  { value: "one_off", label: "One-off" },
  { value: "daily", label: "Daily" },
  { value: "daily_weekdays", label: "Weekdays only" },
  { value: "weekly", label: "Weekly" },
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CorporateScheduledPage() {
  const { data: scheduled, isLoading } = useScheduledOrders();
  const { data: companies } = useCorporateCompanies();
  const create = useCreateScheduledOrder();
  const update = useUpdateScheduledOrder();
  const runDue = useRunDueScheduled();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({ recurrence: "one_off", scheduledTime: "12:00" });
  const [items, setItems] = useState<Array<{ menuItemId: number; name: string; quantity: number; unitPrice: string }>>([]);

  const addItem = () => setItems(it => [...it, { menuItemId: 0, name: "", quantity: 1, unitPrice: "0" }]);
  const removeItem = (i: number) => setItems(it => it.filter((_, idx) => idx !== i));

  const submit = async () => {
    try {
      await create.mutateAsync({ ...form, items });
      toast({ title: "Scheduled order created" });
      setOpen(false); setForm({ recurrence: "one_off", scheduledTime: "12:00" }); setItems([]);
    } catch (e) { toast({ title: "Failed", description: String(e), variant: "destructive" }); }
  };

  const togglePause = async (id: number, status: string) => {
    await update.mutateAsync({ id, status: status === "active" ? "paused" : "active" });
  };

  const onRunDue = async () => {
    const r = await runDue.mutateAsync();
    toast({ title: `Materialised ${r.materialised} order(s)` });
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Scheduled & recurring orders</h1>
          <p className="text-sm text-muted-foreground">Daily lunches, weekly orders, one-off scheduled deliveries</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onRunDue} disabled={runDue.isPending}>Run due now</Button>
          <Button onClick={() => setOpen(true)}>+ New schedule</Button>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          {isLoading ? <div className="p-6">Loading…</div> : (
            <table className="w-full text-sm">
              <thead className="text-left bg-muted/50">
                <tr><th className="p-3">Title</th><th>Company</th><th>Employee</th><th>Recurrence</th><th>Time</th><th>Next run</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {scheduled?.map(s => (
                  <tr key={s.id} className="border-t">
                    <td className="p-3">{s.title}</td>
                    <td>{s.companyName}</td>
                    <td>{s.employeeName || "—"}</td>
                    <td>{s.recurrence}{s.recurrence === "weekly" && s.weekday != null ? ` (${WEEKDAYS[s.weekday]})` : ""}</td>
                    <td>{s.scheduledTime}</td>
                    <td>{s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : "—"}</td>
                    <td><Badge variant={s.status === "active" ? "default" : "secondary"}>{s.status}</Badge></td>
                    <td><Button size="sm" variant="ghost" onClick={() => togglePause(s.id, s.status)}>{s.status === "active" ? "Pause" : "Resume"}</Button></td>
                  </tr>
                ))}
                {scheduled?.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No scheduled orders.</td></tr>}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New scheduled order</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Company *</Label>
                <Select value={form.companyId ? String(form.companyId) : ""} onValueChange={v => setForm(f => ({ ...f, companyId: Number(v) }))}>
                  <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>{companies?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Title *</Label><Input value={String(form.title ?? "")} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>Recurrence</Label>
                <Select value={String(form.recurrence)} onValueChange={v => setForm(f => ({ ...f, recurrence: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RECURRENCES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {form.recurrence === "weekly" && <div><Label>Weekday</Label>
                <Select value={form.weekday != null ? String(form.weekday) : ""} onValueChange={v => setForm(f => ({ ...f, weekday: Number(v) }))}>
                  <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>{WEEKDAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>}
              <div><Label>Time (HH:MM)</Label><Input value={String(form.scheduledTime ?? "")} onChange={e => setForm(f => ({ ...f, scheduledTime: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Start date *</Label><Input type="date" value={String(form.startDate ?? "")} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div><Label>End date</Label><Input type="date" value={String(form.endDate ?? "")} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            </div>
            <div><Label>Delivery address</Label><Input value={String(form.deliveryAddress ?? "")} onChange={e => setForm(f => ({ ...f, deliveryAddress: e.target.value }))} /></div>
            <div>
              <div className="flex items-center justify-between"><Label>Items</Label><Button size="sm" variant="outline" onClick={addItem}>+ Item</Button></div>
              <div className="space-y-2 mt-2">
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-2"><Label className="text-xs">Menu ID</Label><Input type="number" value={it.menuItemId || ""} onChange={e => setItems(arr => arr.map((x, idx) => idx === i ? { ...x, menuItemId: Number(e.target.value) } : x))} /></div>
                    <div className="col-span-4"><Label className="text-xs">Name</Label><Input value={it.name} onChange={e => setItems(arr => arr.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} /></div>
                    <div className="col-span-2"><Label className="text-xs">Qty</Label><Input type="number" value={it.quantity} onChange={e => setItems(arr => arr.map((x, idx) => idx === i ? { ...x, quantity: Number(e.target.value) } : x))} /></div>
                    <div className="col-span-3"><Label className="text-xs">Unit ₹</Label><Input value={it.unitPrice} onChange={e => setItems(arr => arr.map((x, idx) => idx === i ? { ...x, unitPrice: e.target.value } : x))} /></div>
                    <div className="col-span-1"><Button size="sm" variant="ghost" onClick={() => removeItem(i)}>×</Button></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!form.companyId || !form.title || !form.startDate || items.length === 0 || create.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
