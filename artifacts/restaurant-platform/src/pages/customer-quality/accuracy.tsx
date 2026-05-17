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
import { Plus, Target } from "lucide-react";
import { useAccuracy, useCreateAccuracy } from "@/lib/hooks-customer-quality";

export default function AccuracyPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useAccuracy(days);
  const create = useCreateAccuracy();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ orderId: "", eventType: "wrong_item", weight: 1, notes: "" });

  return (
    <Layout>
      <PageHeader title="Order Accuracy Score" description="Track wrong items, missing items, and KOT cancellations" icon={Target}
        actions={
          <div className="flex gap-2">
            <div className="flex gap-1">{[7, 30, 90].map(d => <Button key={d} size="sm" variant={d === days ? "default" : "outline"} onClick={() => setDays(d)}>{d}d</Button>)}</div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Log issue</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Log accuracy issue</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Order ID (optional)</Label><Input type="number" value={form.orderId} onChange={e => setForm({ ...form, orderId: e.target.value })} /></div>
                  <div><Label>Type</Label>
                    <Select value={form.eventType} onValueChange={v => setForm({ ...form, eventType: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="wrong_item">Wrong item</SelectItem>
                        <SelectItem value="missing_item">Missing item</SelectItem>
                        <SelectItem value="kot_cancel">KOT cancel</SelectItem>
                        <SelectItem value="correction">Correction</SelectItem>
                        <SelectItem value="complaint">Complaint</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Weight (1–5)</Label><Input type="number" min={1} max={5} value={form.weight} onChange={e => setForm({ ...form, weight: Number(e.target.value) })} /></div>
                  <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                </div>
                <DialogFooter><Button onClick={async () => { await create.mutateAsync({ ...form, orderId: form.orderId ? Number(form.orderId) : null }); setOpen(false); setForm({ orderId: "", eventType: "wrong_item", weight: 1, notes: "" }); }} disabled={create.isPending}>Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Card><CardContent className="py-4"><div className="text-4xl font-bold">{data?.score ?? 100}%</div><div className="text-sm text-muted-foreground">Accuracy score</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-3xl font-bold">{data?.totalOrders ?? 0}</div><div className="text-sm text-muted-foreground">Orders in window</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-3xl font-bold">{data?.totalIssues ?? 0}</div><div className="text-sm text-muted-foreground">Total issue weight</div></CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Recent issues</CardTitle></CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {(data?.events ?? []).length === 0 && <p className="text-sm text-muted-foreground">No accuracy issues.</p>}
          <div className="divide-y">
            {(data?.events ?? []).slice(0, 30).map((e: any) => (
              <div key={e.id} className="py-2 flex items-center gap-3 text-sm">
                <Badge variant="outline">{e.eventType}</Badge>
                <span>Order #{e.orderId ?? "-"}</span>
                <span className="text-muted-foreground flex-1">{e.notes ?? ""}</span>
                <span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </Layout>
  );
}
