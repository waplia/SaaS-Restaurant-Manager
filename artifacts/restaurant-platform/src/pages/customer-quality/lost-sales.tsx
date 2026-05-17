import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, TrendingDown } from "lucide-react";
import { useLostSales, useCreateLostSale } from "@/lib/hooks-customer-quality";

export default function LostSalesPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useLostSales(days);
  const create = useCreateLostSale();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ eventType: "out_of_stock", channel: "dine_in", reason: "", estimatedValue: "0" });

  return (
    <Layout>
      <PageHeader title="Lost Sales Tracker" description="Track lost revenue from out-of-stock, walk-outs, failed payments" icon={TrendingDown}
        actions={
          <div className="flex gap-2">
            <div className="flex gap-1">{[7, 30, 90].map(d => <Button key={d} size="sm" variant={d === days ? "default" : "outline"} onClick={() => setDays(d)}>{d}d</Button>)}</div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Log lost sale</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Log lost sale</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Type</Label>
                    <Select value={form.eventType} onValueChange={v => setForm({ ...form, eventType: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="out_of_stock">Out of stock</SelectItem>
                        <SelectItem value="cancelled_order">Cancelled order</SelectItem>
                        <SelectItem value="abandoned_cart">Abandoned cart</SelectItem>
                        <SelectItem value="unavailable_zone">Unavailable zone</SelectItem>
                        <SelectItem value="walk_out">Walk out</SelectItem>
                        <SelectItem value="failed_payment">Failed payment</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Channel</Label>
                    <Select value={form.channel} onValueChange={v => setForm({ ...form, channel: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dine_in">Dine-in</SelectItem>
                        <SelectItem value="qr">QR</SelectItem>
                        <SelectItem value="online">Online</SelectItem>
                        <SelectItem value="phone">Phone</SelectItem>
                        <SelectItem value="delivery">Delivery</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Estimated value</Label><Input type="number" step="0.01" value={form.estimatedValue} onChange={e => setForm({ ...form, estimatedValue: e.target.value })} /></div>
                  <div><Label>Reason</Label><Input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></div>
                </div>
                <DialogFooter><Button onClick={async () => { await create.mutateAsync(form); setOpen(false); setForm({ eventType: "out_of_stock", channel: "dine_in", reason: "", estimatedValue: "0" }); }} disabled={create.isPending}>Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Card><CardContent className="py-4"><div className="text-3xl font-bold">₹{Number(data?.totalLost ?? 0).toFixed(2)}</div><div className="text-sm text-muted-foreground">Lost revenue</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-3xl font-bold">{data?.count ?? 0}</div><div className="text-sm text-muted-foreground">Events</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-sm text-muted-foreground mb-1">Top reasons</div>
          {(data?.summary ?? []).slice(0, 3).map((s: any) => <div key={s.event_type} className="flex justify-between text-sm"><span>{s.event_type}</span><span>₹{Number(s.revenue ?? 0).toFixed(0)}</span></div>)}
        </CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Recent</CardTitle></CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {(data?.events ?? []).length === 0 && <p className="text-sm text-muted-foreground">No lost sales yet.</p>}
          <div className="divide-y">
            {(data?.events ?? []).slice(0, 50).map((e: any) => (
              <div key={e.id} className="py-2 flex items-center gap-3 text-sm">
                <Badge variant="outline">{e.eventType}</Badge>
                {e.channel && <Badge variant="secondary">{e.channel}</Badge>}
                <span className="text-muted-foreground flex-1">{e.reason ?? ""}</span>
                <span className="font-medium">₹{Number(e.estimatedValue).toFixed(2)}</span>
                <span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </Layout>
  );
}
