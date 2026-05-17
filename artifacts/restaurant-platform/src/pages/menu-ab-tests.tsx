import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { Plus, Play, Square, Trash2 } from "lucide-react";

interface Exp {
  id: number; name: string; hypothesis: string | null; menuItemId: number;
  variantAName: string; variantBName: string; variantAPrice: string | null; variantBPrice: string | null;
  status: string; winnerVariant: string | null; startedAt: string | null;
}
interface Result { variant: string; sessions: number; impressions: number; clicks: number; orders: number; revenue: string; }

export default function MenuAbTestsPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", menuItemId: "", hypothesis: "", variantAPrice: "", variantBPrice: "" });
  const [resultsFor, setResultsFor] = useState<number | null>(null);

  const { data } = useQuery({ queryKey: ["ab", restaurantId], queryFn: () => apiGet<{ data: Exp[] }>(`/restaurants/${restaurantId}/menu-intel/ab-tests`) });
  const { data: results } = useQuery({
    queryKey: ["ab-results", resultsFor], enabled: resultsFor != null,
    queryFn: () => apiGet<{ data: Result[]; significance: { aRate: number; bRate: number; uplift: number; pValue: number; significant: boolean; leader: "a" | "b" | "tie" } | null }>(`/restaurants/${restaurantId}/menu-intel/ab-tests/${resultsFor}/results`),
  });

  const create = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/menu-intel/ab-tests`, {
      name: form.name, menuItemId: Number(form.menuItemId), hypothesis: form.hypothesis || null,
      variantAPrice: form.variantAPrice || null, variantBPrice: form.variantBPrice || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ab", restaurantId] }); setOpen(false); setForm({ name: "", menuItemId: "", hypothesis: "", variantAPrice: "", variantBPrice: "" }); toast({ title: "A/B test created" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: object }) => apiPatch(`/restaurants/${restaurantId}/menu-intel/ab-tests/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ab", restaurantId] }),
  });
  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/menu-intel/ab-tests/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ab", restaurantId] }),
  });

  return (
    <Layout>
      <PageHeader title="Menu A/B Tests" description="Run price and description tests on menu items." actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New test</Button>} />
      <div className="p-4 sm:p-6 max-w-6xl space-y-3">
        {(data?.data ?? []).map((e) => (
          <Card key={e.id}>
            <CardContent className="p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="font-medium">{e.name} <Badge variant={e.status === "running" ? "default" : "secondary"} className="ml-2">{e.status}</Badge>{e.winnerVariant && <Badge className="ml-1">Winner: {e.winnerVariant.toUpperCase()}</Badge>}</div>
                <div className="text-xs text-muted-foreground">Item #{e.menuItemId} · A: ₹{e.variantAPrice ?? "—"} · B: ₹{e.variantBPrice ?? "—"}</div>
              </div>
              {e.status === "draft" && <Button size="sm" variant="outline" onClick={() => update.mutate({ id: e.id, patch: { status: "running" } })}><Play className="h-4 w-4 mr-1" />Start</Button>}
              {e.status === "running" && <Button size="sm" variant="outline" onClick={() => update.mutate({ id: e.id, patch: { status: "completed" } })}><Square className="h-4 w-4 mr-1" />Stop</Button>}
              <Button size="sm" variant="outline" onClick={() => setResultsFor(e.id)}>Results</Button>
              <Button size="sm" variant="ghost" onClick={() => del.mutate(e.id)}><Trash2 className="h-4 w-4" /></Button>
            </CardContent>
          </Card>
        ))}
        {(data?.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No tests yet.</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New A/B Test</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Menu item ID</Label><Input type="number" value={form.menuItemId} onChange={(e) => setForm({ ...form, menuItemId: e.target.value })} /></div>
            <div><Label>Hypothesis</Label><Input value={form.hypothesis} onChange={(e) => setForm({ ...form, hypothesis: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Variant A price</Label><Input type="number" value={form.variantAPrice} onChange={(e) => setForm({ ...form, variantAPrice: e.target.value })} /></div>
              <div><Label>Variant B price</Label><Input type="number" value={form.variantBPrice} onChange={(e) => setForm({ ...form, variantBPrice: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter><Button onClick={() => create.mutate()} disabled={!form.name || !form.menuItemId}>Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resultsFor != null} onOpenChange={(o) => !o && setResultsFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Experiment results</DialogTitle></DialogHeader>
          {results?.significance && (
            <div className={`rounded-md border p-3 text-sm mb-3 ${results.significance.significant ? "bg-green-50 border-green-200" : "bg-muted/40"}`}>
              <div className="font-medium">
                {results.significance.significant
                  ? `Variant ${results.significance.leader.toUpperCase()} wins at 95% confidence`
                  : "Not statistically significant yet"}
              </div>
              <div className="text-muted-foreground text-xs mt-1">
                A: {(results.significance.aRate * 100).toFixed(1)}% · B: {(results.significance.bRate * 100).toFixed(1)}% · uplift {(results.significance.uplift * 100).toFixed(1)}% · p={results.significance.pValue.toFixed(3)}
              </div>
            </div>
          )}
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th>Variant</th><th>Sessions</th><th>Impr.</th><th>Clicks</th><th>Orders</th><th>Revenue</th></tr></thead>
            <tbody>
              {(results?.data ?? []).map((r) => (
                <tr key={r.variant} className="border-t">
                  <td className="py-2">{r.variant.toUpperCase()}</td>
                  <td>{r.sessions}</td><td>{r.impressions}</td><td>{r.clicks}</td><td>{r.orders}</td><td>₹{Number(r.revenue).toFixed(2)}</td>
                </tr>
              ))}
              {(results?.data ?? []).length === 0 && <tr><td colSpan={6} className="py-3 text-muted-foreground">No assignments yet.</td></tr>}
            </tbody>
          </table>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
