import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Alert { id: number; type: string; message: string | null; status: string; raisedAt: string; resolvedAt: string | null; }
const TYPES = ["angry_customer", "emergency", "kitchen", "payment", "equipment", "other"];

export default function OpsPanicPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data = [] } = useQuery<Alert[]>({
    queryKey: ["ops", "panic", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/ops/panic-alerts`),
    refetchInterval: 10_000,
  });
  const [type, setType] = useState("angry_customer");
  const [msg, setMsg] = useState("");
  const raise = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/ops/panic-alerts`, { type, message: msg }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ops", "panic"] }); setMsg(""); toast({ title: "Alert raised" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: number; status: "acknowledged" | "resolved" }) => apiPatch(`/restaurants/${restaurantId}/ops/panic-alerts/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ops", "panic"] }),
  });
  return (
    <Layout>
      <PageHeader title="Panic Button" subtitle="One-tap manager alerts" icon={AlertTriangle} />
      <div className="p-6 space-y-6">
        <Card>
          <CardContent className="p-4 space-y-3">
            <h3 className="font-semibold">Raise alert</h3>
            <Select value={type} onValueChange={setType}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select>
            <Textarea placeholder="Optional message" value={msg} onChange={e => setMsg(e.target.value)} />
            <Button className="bg-red-600 hover:bg-red-700" onClick={() => raise.mutate()} disabled={raise.isPending}>{raise.isPending ? "Raising…" : "RAISE PANIC ALERT"}</Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3">Recent alerts</h3>
            <div className="divide-y">
              {data.map(a => (
                <div key={a.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <Badge variant={a.status === "open" ? "destructive" : "outline"}>{a.status}</Badge>
                    <span className="ml-2 font-medium">{a.type}</span>
                    {a.message && <div className="text-muted-foreground text-xs">{a.message}</div>}
                    <div className="text-xs text-muted-foreground">{new Date(a.raisedAt).toLocaleString()}</div>
                  </div>
                  {a.status !== "resolved" && (
                    <div className="flex gap-2">
                      {a.status === "open" && <Button size="sm" variant="outline" onClick={() => update.mutate({ id: a.id, status: "acknowledged" })}>Ack</Button>}
                      <Button size="sm" onClick={() => update.mutate({ id: a.id, status: "resolved" })}>Resolve</Button>
                    </div>
                  )}
                </div>
              ))}
              {data.length === 0 && <div className="py-4 text-muted-foreground text-sm">No alerts.</div>}
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
