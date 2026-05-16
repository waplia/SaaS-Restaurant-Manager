import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useBulkOrders, useCreateBulkOrder, useConfirmBulkOrder, useCorporateCompanies } from "@/lib/corporate";

type LineItem = { menuItemId: number; menuItemName: string; quantity: number; unitPrice: string; notes?: string };

export default function CorporateBulkOrdersPage() {
  const { data: bulks, isLoading } = useBulkOrders();
  const { data: companies } = useCorporateCompanies();
  const create = useCreateBulkOrder();
  const confirm = useConfirmBulkOrder();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({ type: "bulk_lunch" });
  const [items, setItems] = useState<LineItem[]>([]);

  const addItem = () => setItems(it => [...it, { menuItemId: 0, menuItemName: "", quantity: 1, unitPrice: "0" }]);
  const removeItem = (i: number) => setItems(it => it.filter((_, idx) => idx !== i));
  const updItem = (i: number, patch: Partial<LineItem>) => setItems(it => it.map((x, idx) => idx === i ? { ...x, ...patch } : x));

  const submit = async () => {
    try {
      await create.mutateAsync({ ...form, items });
      toast({ title: "Bulk order created" });
      setOpen(false); setForm({ type: "bulk_lunch" }); setItems([]);
    } catch (e) { toast({ title: "Failed", description: String(e), variant: "destructive" }); }
  };

  const onConfirm = async (id: number) => {
    try { await confirm.mutateAsync(id); toast({ title: "Bulk order confirmed and order created" }); }
    catch (e) { toast({ title: "Failed", description: String(e), variant: "destructive" }); }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Bulk & catering orders</h1>
          <p className="text-sm text-muted-foreground">Office lunches, parties, and catering events</p>
        </div>
        <Button onClick={() => setOpen(true)}>+ New bulk order</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          {isLoading ? <div className="p-6">Loading…</div> : (
            <table className="w-full text-sm">
              <thead className="text-left bg-muted/50">
                <tr><th className="p-3">Title</th><th>Type</th><th>Company</th><th>When</th><th>Headcount</th><th>Confirmed ₹</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {bulks?.map(b => (
                  <tr key={b.id} className="border-t">
                    <td className="p-3">{b.title}</td>
                    <td>{b.type}</td>
                    <td>{b.companyName}</td>
                    <td>{new Date(b.scheduledAt).toLocaleString()}</td>
                    <td>{b.headcount ?? "—"}</td>
                    <td>{b.confirmedAmount ? `₹${Number(b.confirmedAmount).toFixed(2)}` : (b.quotedAmount ? `quote ₹${Number(b.quotedAmount).toFixed(2)}` : "—")}</td>
                    <td><Badge>{b.status}</Badge></td>
                    <td>{["draft", "quoted"].includes(b.status) && <Button size="sm" onClick={() => onConfirm(b.id)}>Confirm</Button>}</td>
                  </tr>
                ))}
                {bulks?.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No bulk orders yet.</td></tr>}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New bulk / catering order</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Company *</Label>
                <Select value={form.companyId ? String(form.companyId) : ""} onValueChange={v => setForm(f => ({ ...f, companyId: Number(v) }))}>
                  <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>{companies?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Type</Label>
                <Select value={String(form.type ?? "bulk_lunch")} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="bulk_lunch">Bulk lunch</SelectItem><SelectItem value="catering">Catering</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Title *</Label><Input value={String(form.title ?? "")} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>Scheduled at *</Label><Input type="datetime-local" value={String(form.scheduledAt ?? "")} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} /></div>
              <div><Label>Cutoff at</Label><Input type="datetime-local" value={String(form.cutoffAt ?? "")} onChange={e => setForm(f => ({ ...f, cutoffAt: e.target.value }))} /></div>
              <div><Label>Headcount</Label><Input type="number" value={String(form.headcount ?? "")} onChange={e => setForm(f => ({ ...f, headcount: Number(e.target.value) }))} /></div>
            </div>
            <div><Label>Delivery address</Label><Input value={String(form.deliveryAddress ?? "")} onChange={e => setForm(f => ({ ...f, deliveryAddress: e.target.value }))} /></div>
            <div><Label>Setup notes</Label><Input value={String(form.setupNotes ?? "")} onChange={e => setForm(f => ({ ...f, setupNotes: e.target.value }))} /></div>
            <div>
              <div className="flex items-center justify-between"><Label>Items</Label><Button size="sm" variant="outline" onClick={addItem}>+ Item</Button></div>
              <div className="space-y-2 mt-2">
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-2"><Label className="text-xs">Menu ID</Label><Input type="number" value={it.menuItemId || ""} onChange={e => updItem(i, { menuItemId: Number(e.target.value) })} /></div>
                    <div className="col-span-4"><Label className="text-xs">Name</Label><Input value={it.menuItemName} onChange={e => updItem(i, { menuItemName: e.target.value })} /></div>
                    <div className="col-span-2"><Label className="text-xs">Qty</Label><Input type="number" value={it.quantity} onChange={e => updItem(i, { quantity: Number(e.target.value) })} /></div>
                    <div className="col-span-3"><Label className="text-xs">Unit ₹</Label><Input value={it.unitPrice} onChange={e => updItem(i, { unitPrice: e.target.value })} /></div>
                    <div className="col-span-1"><Button size="sm" variant="ghost" onClick={() => removeItem(i)}>×</Button></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!form.companyId || !form.title || !form.scheduledAt || create.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
