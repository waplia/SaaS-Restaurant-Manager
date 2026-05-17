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
import { AlertCircle } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Incident { id: number; type: string; severity: string; status: string; title: string; description: string | null; reportedAt: string; resolutionNotes: string | null; }
const TYPES = ["complaint", "staff_conflict", "equipment", "food", "accident", "safety", "other"];
const SEVS = ["low", "medium", "high", "critical"];

export default function OpsIncidentsPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data = [] } = useQuery<Incident[]>({ queryKey: ["ops", "incidents", restaurantId], queryFn: () => apiGet(`/restaurants/${restaurantId}/ops/incidents`) });
  const [form, setForm] = useState({ type: "complaint", severity: "medium", title: "", description: "" });
  const create = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/ops/incidents`, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ops", "incidents"] }); setForm({ type: "complaint", severity: "medium", title: "", description: "" }); toast({ title: "Incident reported" }); },
  });
  const update = useMutation({
    mutationFn: ({ id, status, notes }: { id: number; status: string; notes?: string }) => apiPatch(`/restaurants/${restaurantId}/ops/incidents/${id}`, { status, resolutionNotes: notes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ops", "incidents"] }),
  });
  return (
    <Layout>
      <PageHeader title="Incident Log" subtitle="Track complaints, accidents, equipment failures" icon={AlertCircle} />
      <div className="p-6 space-y-6">
        <Card><CardContent className="p-4 space-y-3">
          <h3 className="font-semibold">Report incident</h3>
          <div className="grid grid-cols-2 gap-3">
            <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select>
            <Select value={form.severity} onValueChange={v => setForm({ ...form, severity: v })}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{SEVS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
          </div>
          <Input placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <Textarea placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <Button onClick={() => create.mutate()} disabled={!form.title}>Report incident</Button>
        </CardContent></Card>
        <div className="space-y-2">
          {data.map(i => (
            <Card key={i.id}><CardContent className="p-3 text-sm">
              <div className="flex justify-between gap-2">
                <div>
                  <Badge variant={i.severity === "critical" || i.severity === "high" ? "destructive" : "outline"}>{i.severity}</Badge>
                  <Badge variant="outline" className="ml-2">{i.status}</Badge>
                  <Badge variant="outline" className="ml-2">{i.type}</Badge>
                  <div className="font-medium mt-1">{i.title}</div>
                  {i.description && <div className="text-muted-foreground">{i.description}</div>}
                  <div className="text-xs text-muted-foreground">{new Date(i.reportedAt).toLocaleString()}</div>
                </div>
                {i.status !== "closed" && i.status !== "resolved" && (
                  <div className="flex flex-col gap-1">
                    {i.status === "open" && <Button size="sm" variant="outline" onClick={() => update.mutate({ id: i.id, status: "investigating" })}>Investigate</Button>}
                    <Button size="sm" onClick={() => update.mutate({ id: i.id, status: "resolved" })}>Resolve</Button>
                  </div>
                )}
              </div>
            </CardContent></Card>
          ))}
          {data.length === 0 && <div className="text-muted-foreground text-sm">No incidents.</div>}
        </div>
      </div>
    </Layout>
  );
}
