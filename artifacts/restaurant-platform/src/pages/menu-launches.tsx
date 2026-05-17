import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";

interface Launch { id: number; menuItemId: number; launchedAt: string; targetOrders: number | null; targetRevenue: string | null; trackingWindowDays: number; status: string; notes: string | null; actualOrders: number; actualRevenue: string; }

export default function MenuLaunchesPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ menuItemId: "", targetOrders: "", targetRevenue: "", trackingWindowDays: "30", notes: "" });

  const { data } = useQuery({ queryKey: ["launches", restaurantId], queryFn: () => apiGet<{ data: Launch[] }>(`/restaurants/${restaurantId}/menu-intel/launches`) });

  const create = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/menu-intel/launches`, {
      menuItemId: Number(form.menuItemId),
      targetOrders: form.targetOrders ? Number(form.targetOrders) : null,
      targetRevenue: form.targetRevenue || null,
      trackingWindowDays: Number(form.trackingWindowDays) || 30,
      notes: form.notes,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["launches", restaurantId] }); setOpen(false); setForm({ menuItemId: "", targetOrders: "", targetRevenue: "", trackingWindowDays: "30", notes: "" }); toast({ title: "Launch tracked" }); },
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => apiPatch(`/restaurants/${restaurantId}/menu-intel/launches/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["launches", restaurantId] }),
  });

  return (
    <Layout>
      <PageHeader title="New Launch Tracker" description="Track newly launched dishes against targets." actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New launch</Button>} />
      <div className="p-4 sm:p-6 max-w-5xl space-y-3">
        {(data?.data ?? []).map((l) => {
          const orderPct = l.targetOrders ? Math.min(100, (l.actualOrders / l.targetOrders) * 100) : 0;
          return (
            <Card key={l.id}><CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="font-medium">Item #{l.menuItemId} <Badge className="ml-2">{l.status}</Badge></div>
                  <div className="text-xs text-muted-foreground">Launched {new Date(l.launchedAt).toLocaleDateString()} · {l.trackingWindowDays}d window</div>
                </div>
                <select className="text-xs border rounded px-2 py-1" value={l.status} onChange={(e) => updateStatus.mutate({ id: l.id, status: e.target.value })}>
                  <option value="active">Active</option><option value="success">Success</option><option value="underperforming">Underperforming</option><option value="archived">Archived</option>
                </select>
              </div>
              <div className="text-sm">Orders: {l.actualOrders}{l.targetOrders ? ` / ${l.targetOrders}` : ""} · Revenue: ₹{Number(l.actualRevenue).toFixed(2)}{l.targetRevenue ? ` / ₹${l.targetRevenue}` : ""}</div>
              {l.targetOrders && <div className="h-2 bg-muted rounded"><div className="h-2 bg-green-500 rounded" style={{ width: `${orderPct}%` }} /></div>}
              {l.notes && <div className="text-xs text-muted-foreground">{l.notes}</div>}
            </CardContent></Card>
          );
        })}
        {(data?.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No tracked launches yet.</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Track a launch</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Menu item ID</Label><Input type="number" value={form.menuItemId} onChange={(e) => setForm({ ...form, menuItemId: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Target orders</Label><Input type="number" value={form.targetOrders} onChange={(e) => setForm({ ...form, targetOrders: e.target.value })} /></div>
              <div><Label>Target revenue</Label><Input type="number" value={form.targetRevenue} onChange={(e) => setForm({ ...form, targetRevenue: e.target.value })} /></div>
            </div>
            <div><Label>Window (days)</Label><Input type="number" value={form.trackingWindowDays} onChange={(e) => setForm({ ...form, trackingWindowDays: e.target.value })} /></div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={() => create.mutate()} disabled={!form.menuItemId}>Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
