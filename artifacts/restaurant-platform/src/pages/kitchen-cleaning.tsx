import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardCheck } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Proof { id: number; area: string; beforeUrl: string | null; afterUrl: string | null; notes: string | null; status: string; submittedAt: string; }
const AREAS = ["kitchen", "tables", "washroom", "storage", "floor", "other"];

export default function KitchenCleaningPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", new Date(from).toISOString());
    if (to) p.set("to", new Date(to).toISOString());
    return p.toString();
  }, [from, to]);
  const { data = [] } = useQuery<Proof[]>({
    queryKey: ["kitchen", "cleaning", restaurantId, qs],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/kitchen/cleaning-proofs${qs ? `?${qs}` : ""}`),
  });
  const [form, setForm] = useState({ area: "kitchen", beforeUrl: "", afterUrl: "", notes: "" });
  const create = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/kitchen/cleaning-proofs`, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kitchen", "cleaning"] }); setForm({ area: "kitchen", beforeUrl: "", afterUrl: "", notes: "" }); toast({ title: "Cleaning proof submitted" }); },
  });
  const review = useMutation({
    mutationFn: ({ id, status }: { id: number; status: "approved" | "rejected" }) => apiPatch(`/restaurants/${restaurantId}/kitchen/cleaning-proofs/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchen", "cleaning"] }),
  });
  return (
    <Layout>
      <PageHeader title="Cleaning Proof Gallery" subtitle="Photo-verified cleaning sign-offs" icon={ClipboardCheck} />
      <div className="p-6 space-y-6">
        <Card><CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>From</Label><Input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} /></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 space-y-3">
          <h3 className="font-semibold">Submit proof</h3>
          <Select value={form.area} onValueChange={v => setForm({ ...form, area: v })}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{AREAS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent></Select>
          <Input placeholder="Before photo URL (optional)" value={form.beforeUrl} onChange={e => setForm({ ...form, beforeUrl: e.target.value })} />
          <Input placeholder="After photo URL (optional)" value={form.afterUrl} onChange={e => setForm({ ...form, afterUrl: e.target.value })} />
          <Textarea placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          <Button onClick={() => create.mutate()}>Submit</Button>
        </CardContent></Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.map(p => (
            <Card key={p.id}><CardContent className="p-3 text-sm">
              <div className="flex justify-between">
                <span><Badge variant="outline">{p.area}</Badge> <Badge variant={p.status === "approved" ? "default" : p.status === "rejected" ? "destructive" : "outline"}>{p.status}</Badge></span>
                <span className="text-xs text-muted-foreground">{new Date(p.submittedAt).toLocaleString()}</span>
              </div>
              <div className="flex gap-2 mt-2">
                {p.beforeUrl && <img src={p.beforeUrl} alt="before" className="w-1/2 h-24 object-cover rounded" />}
                {p.afterUrl && <img src={p.afterUrl} alt="after" className="w-1/2 h-24 object-cover rounded" />}
              </div>
              {p.notes && <div className="text-muted-foreground mt-1">{p.notes}</div>}
              {p.status === "submitted" && (
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="outline" onClick={() => review.mutate({ id: p.id, status: "rejected" })}>Reject</Button>
                  <Button size="sm" onClick={() => review.mutate({ id: p.id, status: "approved" })}>Approve</Button>
                </div>
              )}
            </CardContent></Card>
          ))}
          {data.length === 0 && <div className="text-muted-foreground text-sm">No cleaning proofs in window.</div>}
        </div>
      </div>
    </Layout>
  );
}
