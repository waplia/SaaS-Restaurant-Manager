import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";

interface Vendor {
  id: number; foodCourtId: number; restaurantId: number; restaurantName?: string;
  counterNumber?: string | null; stallName: string; cuisineTags: string[]; commissionType: string;
  commissionPct: string; flatFeePerOrder: string; isActive: boolean; vendorGstin?: string | null;
}

interface RestaurantOpt { id: number; name: string }

export default function FoodCourtVendorsPage() {
  const { id } = useParams<{ id: string }>();
  const fcId = Number(id);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["fc-vendors", fcId],
    queryFn: () => apiGet(`/food-courts/${fcId}/vendors`),
  });
  const { data: restaurants = [] } = useQuery<RestaurantOpt[]>({
    queryKey: ["restaurants"],
    queryFn: () => apiGet("/restaurants"),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    restaurantId: "", stallName: "", counterNumber: "",
    commissionType: "percentage", commissionPct: "10.00", flatFeePerOrder: "0.00",
    settlementUpiId: "", vendorGstin: "",
  });

  const create = useMutation({
    mutationFn: () => apiPost(`/food-courts/${fcId}/vendors`, {
      ...form, restaurantId: Number(form.restaurantId),
    }),
    onSuccess: () => {
      toast({ title: "Vendor onboarded" }); setOpen(false);
      qc.invalidateQueries({ queryKey: ["fc-vendors", fcId] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const toggle = useMutation({
    mutationFn: (v: Vendor) => apiPatch(`/food-courts/${fcId}/vendors/${v.id}`, { isActive: !v.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fc-vendors", fcId] }),
  });

  const remove = useMutation({
    mutationFn: (v: Vendor) => apiDelete(`/food-courts/${fcId}/vendors/${v.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fc-vendors", fcId] }),
  });

  return (
    <Layout>
      <PageHeader title="Vendors" description="Counter stalls onboarded to this food court."
        actions={<Button onClick={() => setOpen(true)} data-testid="add-vendor"><Plus className="w-4 h-4 mr-2" />Add Vendor</Button>}
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Counter</TableHead>
                <TableHead>Stall</TableHead>
                <TableHead>Restaurant</TableHead>
                <TableHead>Commission</TableHead>
                <TableHead>GSTIN</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendors.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No vendors yet</TableCell></TableRow>
              ) : vendors.map(v => (
                <TableRow key={v.id} data-testid={`vendor-${v.id}`}>
                  <TableCell>{v.counterNumber ?? "—"}</TableCell>
                  <TableCell><strong>{v.stallName}</strong></TableCell>
                  <TableCell>{v.restaurantName}</TableCell>
                  <TableCell>{v.commissionType === "percentage" ? `${v.commissionPct}%` : v.commissionType === "flat_per_order" ? `₹${v.flatFeePerOrder}/order` : v.commissionType}</TableCell>
                  <TableCell className="text-xs">{v.vendorGstin ?? "—"}</TableCell>
                  <TableCell><Badge variant={v.isActive ? "default" : "secondary"}>{v.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => toggle.mutate(v)}>{v.isActive ? "Disable" : "Enable"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(v)}>Remove</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Vendor</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Restaurant</Label>
              <Select value={form.restaurantId} onValueChange={v => setForm({ ...form, restaurantId: v })}>
                <SelectTrigger><SelectValue placeholder="Choose restaurant" /></SelectTrigger>
                <SelectContent>
                  {restaurants.map(r => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Stall name</Label><Input value={form.stallName} onChange={e => setForm({ ...form, stallName: e.target.value })} /></div>
              <div><Label>Counter #</Label><Input value={form.counterNumber} onChange={e => setForm({ ...form, counterNumber: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Commission type</Label>
                <Select value={form.commissionType} onValueChange={v => setForm({ ...form, commissionType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage</SelectItem>
                    <SelectItem value="flat_per_order">Flat per order</SelectItem>
                    <SelectItem value="combo">Combo (% + flat)</SelectItem>
                    <SelectItem value="tiered">Tiered</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Commission %</Label><Input value={form.commissionPct} onChange={e => setForm({ ...form, commissionPct: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Flat fee / order ₹</Label><Input value={form.flatFeePerOrder} onChange={e => setForm({ ...form, flatFeePerOrder: e.target.value })} /></div>
              <div><Label>UPI ID</Label><Input value={form.settlementUpiId} onChange={e => setForm({ ...form, settlementUpiId: e.target.value })} /></div>
            </div>
            <div><Label>GSTIN</Label><Input value={form.vendorGstin} onChange={e => setForm({ ...form, vendorGstin: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={!form.restaurantId || !form.stallName || create.isPending}>
              {create.isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
