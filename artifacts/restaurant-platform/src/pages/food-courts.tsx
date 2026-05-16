import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { UtensilsCrossed, Plus, MapPin, Settings as SettingsIcon } from "lucide-react";

interface FoodCourt {
  id: number; name: string; slug: string; status: string; addressLine?: string | null;
  city?: string | null; totalSeats: number; defaultCommissionPct: string;
  seatingMode: string; tokenPrefix: string;
}

export default function FoodCourtsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: courts = [], isLoading } = useQuery<FoodCourt[]>({
    queryKey: ["food-courts"],
    queryFn: () => apiGet("/food-courts"),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", addressLine: "", city: "", totalSeats: 0, defaultCommissionPct: "10.00",
    seatingMode: "shared" as "shared" | "table_assigned", tokenPrefix: "FC",
  });

  const create = useMutation({
    mutationFn: () => apiPost("/food-courts", { ...form, totalSeats: Number(form.totalSeats) }),
    onSuccess: () => {
      toast({ title: "Food court created" });
      setOpen(false);
      setForm({ name: "", addressLine: "", city: "", totalSeats: 0, defaultCommissionPct: "10.00", seatingMode: "shared", tokenPrefix: "FC" });
      qc.invalidateQueries({ queryKey: ["food-courts"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Layout>
      <PageHeader
        title="Food Courts"
        description="Manage venues, vendors, commissions, and settlements."
        actions={
          <Button onClick={() => setOpen(true)} data-testid="new-food-court">
            <Plus className="w-4 h-4 mr-2" /> New Food Court
          </Button>
        }
      />

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : courts.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          <UtensilsCrossed className="w-10 h-10 mx-auto mb-2 opacity-60" />
          No food courts yet. Create your first venue to onboard vendors.
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {courts.map(fc => (
            <Card key={fc.id} data-testid={`fc-card-${fc.id}`}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{fc.name}</span>
                  <Badge variant={fc.status === "active" ? "default" : "secondary"}>{fc.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {fc.addressLine && <div className="flex items-center gap-1 text-muted-foreground"><MapPin className="w-3 h-3" /> {fc.addressLine}{fc.city ? `, ${fc.city}` : ""}</div>}
                <div>Seats: <strong>{fc.totalSeats}</strong> · Mode: {fc.seatingMode}</div>
                <div>Default commission: <strong>{fc.defaultCommissionPct}%</strong></div>
                <div>Token prefix: <code>{fc.tokenPrefix}</code></div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Link href={`/food-court/${fc.id}/overview`}><Button size="sm" variant="outline">Overview</Button></Link>
                  <Link href={`/food-court/${fc.id}/vendors`}><Button size="sm" variant="outline">Vendors</Button></Link>
                  <Link href={`/food-court/${fc.id}/pos`}><Button size="sm">Open POS</Button></Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Food Court</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} data-testid="fc-name" /></div>
            <div><Label>Address</Label><Input value={form.addressLine} onChange={e => setForm({ ...form, addressLine: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>City</Label><Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
              <div><Label>Total seats</Label><Input type="number" value={form.totalSeats} onChange={e => setForm({ ...form, totalSeats: Number(e.target.value) })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Seating mode</Label>
                <Select value={form.seatingMode} onValueChange={(v) => setForm({ ...form, seatingMode: v as typeof form.seatingMode })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shared">Shared seating</SelectItem>
                    <SelectItem value="table_assigned">Table assigned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Default commission %</Label><Input value={form.defaultCommissionPct} onChange={e => setForm({ ...form, defaultCommissionPct: e.target.value })} /></div>
            </div>
            <div><Label>Token prefix</Label><Input value={form.tokenPrefix} onChange={e => setForm({ ...form, tokenPrefix: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={!form.name || create.isPending}>
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
