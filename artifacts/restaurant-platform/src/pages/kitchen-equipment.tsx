import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Settings, Plus, Trash2 } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Equipment { id: number; name: string; type: string | null; location: string | null; vendor: string | null; serialNumber: string | null; purchaseDate: string | null; amcExpiresAt: string | null; nextServiceAt: string | null; status: string; notes: string | null; }
interface Maint { id: number; type: string; cost: string | null; vendor: string | null; notes: string | null; performedAt: string; }
const TYPES = ["oven", "fridge", "freezer", "fryer", "printer", "ac", "generator", "pos", "other"];
const STATUSES = ["operational", "needs_service", "out_of_service", "retired"];

export default function KitchenEquipmentPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data = [] } = useQuery<Equipment[]>({ queryKey: ["kitchen", "equipment", restaurantId], queryFn: () => apiGet(`/restaurants/${restaurantId}/kitchen/equipment`) });
  const [form, setForm] = useState({ name: "", type: "oven", location: "", vendor: "", serialNumber: "", purchaseDate: "", amcExpiresAt: "", nextServiceAt: "", status: "operational" });
  const [maintFor, setMaintFor] = useState<Equipment | null>(null);
  const create = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/kitchen/equipment`, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kitchen", "equipment"] }); setForm({ name: "", type: "oven", location: "", vendor: "", serialNumber: "", purchaseDate: "", amcExpiresAt: "", nextServiceAt: "", status: "operational" }); toast({ title: "Equipment added" }); },
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => apiPatch(`/restaurants/${restaurantId}/kitchen/equipment/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchen", "equipment"] }),
  });
  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/kitchen/equipment/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchen", "equipment"] }),
  });
  return (
    <Layout>
      <PageHeader title="Equipment Register" subtitle="Assets, AMC, breakdown & service history" icon={Settings} />
      <div className="p-6 space-y-6">
        <Card><CardContent className="p-4 space-y-3">
          <h3 className="font-semibold">Add equipment</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Input placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
            <Input placeholder="Location" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
            <Input placeholder="Vendor" value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} />
            <Input placeholder="Serial #" value={form.serialNumber} onChange={e => setForm({ ...form, serialNumber: e.target.value })} />
            <Input type="date" placeholder="Purchase date" value={form.purchaseDate} onChange={e => setForm({ ...form, purchaseDate: e.target.value })} />
            <Input type="date" placeholder="AMC expires" value={form.amcExpiresAt} onChange={e => setForm({ ...form, amcExpiresAt: e.target.value })} />
            <Input type="date" placeholder="Next service" value={form.nextServiceAt} onChange={e => setForm({ ...form, nextServiceAt: e.target.value })} />
          </div>
          <Button onClick={() => create.mutate()} disabled={!form.name}><Plus className="w-4 h-4 mr-1"/>Add</Button>
        </CardContent></Card>
        <div className="space-y-2">
          {data.map(e => (
            <Card key={e.id}><CardContent className="p-3 text-sm flex justify-between gap-3">
              <div>
                <div className="font-medium">{e.name} <Badge variant="outline" className="ml-2">{e.type}</Badge> <Badge variant={e.status === "out_of_service" ? "destructive" : "outline"} className="ml-1">{e.status}</Badge></div>
                <div className="text-muted-foreground">{e.location} · {e.vendor}{e.serialNumber ? ` · SN ${e.serialNumber}` : ""}</div>
                <div className="text-xs text-muted-foreground">AMC: {e.amcExpiresAt ?? "—"} · Next service: {e.nextServiceAt ?? "—"}</div>
              </div>
              <div className="flex flex-col gap-1">
                <Select value={e.status} onValueChange={v => setStatus.mutate({ id: e.id, status: v })}><SelectTrigger className="h-8 w-40"><SelectValue/></SelectTrigger><SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setMaintFor(e)}>Maintenance</Button>
                  <Button size="sm" variant="ghost" onClick={() => del.mutate(e.id)}><Trash2 className="w-4 h-4"/></Button>
                </div>
              </div>
            </CardContent></Card>
          ))}
          {data.length === 0 && <div className="text-muted-foreground text-sm">No equipment registered.</div>}
        </div>
      </div>
      {maintFor && <MaintenanceDialog equipment={maintFor} restaurantId={restaurantId} onClose={() => setMaintFor(null)} />}
    </Layout>
  );
}

function MaintenanceDialog({ equipment, restaurantId, onClose }: { equipment: Equipment; restaurantId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data = [] } = useQuery<Maint[]>({
    queryKey: ["kitchen", "equipment", equipment.id, "maint"],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/kitchen/equipment/${equipment.id}/maintenance`),
  });
  const [form, setForm] = useState({ type: "service", cost: "", vendor: "", notes: "" });
  const add = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/kitchen/equipment/${equipment.id}/maintenance`, { ...form, cost: form.cost ? Number(form.cost) : 0 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kitchen", "equipment", equipment.id, "maint"] }); setForm({ type: "service", cost: "", vendor: "", notes: "" }); toast({ title: "Recorded" }); },
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{equipment.name} — maintenance</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{["service", "repair", "breakdown", "inspection"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
            <Input type="number" placeholder="Cost" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} />
            <Input placeholder="Vendor" value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} />
          </div>
          <Textarea placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          <Button onClick={() => add.mutate()}>Add record</Button>
        </div>
        <div className="mt-4 space-y-1 max-h-60 overflow-y-auto">
          {data.map(m => (
            <div key={m.id} className="border rounded p-2 text-sm">
              <Badge variant="outline">{m.type}</Badge> ₹{m.cost ?? 0}{m.vendor ? ` · ${m.vendor}` : ""}
              <div className="text-xs text-muted-foreground">{new Date(m.performedAt).toLocaleString()}</div>
              {m.notes && <div className="text-muted-foreground">{m.notes}</div>}
            </div>
          ))}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
