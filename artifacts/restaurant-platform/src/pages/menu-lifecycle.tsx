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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiGet, apiPost } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";

interface Tx { id: number; menuItemId: number; fromState: string | null; toState: string; reason: string | null; createdAt: string; }

export default function MenuLifecyclePage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ menuItemId: "", toState: "active", reason: "" });

  const { data } = useQuery({ queryKey: ["lifecycle", restaurantId], queryFn: () => apiGet<{ data: Tx[] }>(`/restaurants/${restaurantId}/menu-intel/lifecycle`) });

  const transition = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/menu-intel/lifecycle`, { menuItemId: Number(form.menuItemId), toState: form.toState, reason: form.reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lifecycle", restaurantId] }); setOpen(false); setForm({ menuItemId: "", toState: "active", reason: "" }); toast({ title: "Transitioned" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const autoClassify = useMutation({
    mutationFn: () => apiPost<{ transitions: unknown[] }>(`/restaurants/${restaurantId}/menu-intel/lifecycle/auto-classify`, {}),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["lifecycle", restaurantId] }); toast({ title: "Auto-classified", description: `${r.transitions.length} transitions applied` }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const colorMap: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    draft: "outline",
    testing: "outline",
    active: "default",
    bestseller: "default",
    declining: "secondary",
    discontinued: "destructive",
  };

  return (
    <Layout>
      <PageHeader
        title="Menu Item Lifecycle"
        description="Draft → testing → active → bestseller / declining → discontinued, with audit trail."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => autoClassify.mutate()} disabled={autoClassify.isPending}>Auto-classify</Button>
            <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Transition</Button>
          </div>
        }
      />
      <div className="p-4 sm:p-6 max-w-5xl">
        <Card><CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr><th className="text-left p-3">Item</th><th className="text-left p-3">From</th><th className="text-left p-3">To</th><th className="text-left p-3">Reason</th><th className="text-right p-3">When</th></tr></thead>
            <tbody>
              {(data?.data ?? []).map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="p-3">#{t.menuItemId}</td>
                  <td className="p-3">{t.fromState ?? "—"}</td>
                  <td className="p-3"><Badge variant={colorMap[t.toState] ?? "default"}>{t.toState}</Badge></td>
                  <td className="p-3 text-muted-foreground">{t.reason ?? "—"}</td>
                  <td className="p-3 text-right text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {(data?.data ?? []).length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No transitions yet.</td></tr>}
            </tbody>
          </table>
        </CardContent></Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transition menu item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Menu item ID</Label><Input type="number" value={form.menuItemId} onChange={(e) => setForm({ ...form, menuItemId: e.target.value })} /></div>
            <div><Label>To state</Label>
              <Select value={form.toState} onValueChange={(v) => setForm({ ...form, toState: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="testing">Testing</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="bestseller">Bestseller</SelectItem>
                  <SelectItem value="declining">Declining</SelectItem>
                  <SelectItem value="discontinued">Discontinued</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Reason</Label><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={() => transition.mutate()} disabled={!form.menuItemId}>Apply</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
