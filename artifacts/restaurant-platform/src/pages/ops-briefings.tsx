import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Megaphone } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Briefing { id: number; forDate: string; summary: { yesterdayOrders: number; yesterdayRevenue: number; prevDayOrders: number; prevDayRevenue: number; openIncidents: number; panicAlerts24h: number }; sentAt: string | null; }
interface EndOfDay { date: string; orders: { count: number; revenue: number; cancelled: number }; incidents: Array<{ id: number; title: string; severity: string }>; panicAlerts: Array<{ id: number; type: string }>; closingRuns: Array<{ id: number }>; }

export default function OpsBriefingsPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: briefings = [] } = useQuery<Briefing[]>({
    queryKey: ["ops", "briefings", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/ops/briefings`),
  });
  const today = new Date().toISOString().slice(0, 10);
  const { data: eod } = useQuery<EndOfDay>({
    queryKey: ["ops", "eod", restaurantId, today],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/ops/end-of-day?date=${today}`),
  });
  const generate = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/ops/briefings/generate`, { forDate: today }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ops", "briefings"] }); toast({ title: "Briefing generated" }); },
  });
  return (
    <Layout>
      <PageHeader title="Daily Briefings" subtitle="Owner morning briefing & end-of-day summary" icon={Megaphone}
        actions={<Button onClick={() => generate.mutate()} disabled={generate.isPending}>{generate.isPending ? "Generating…" : "Generate today's briefing"}</Button>} />
      <div className="p-6 space-y-6">
        {eod && (
          <Card><CardContent className="p-4">
            <h3 className="font-semibold mb-3">Today's Summary ({eod.date})</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><div className="text-2xl font-semibold">{eod.orders.count}</div><div className="text-muted-foreground">Orders</div></div>
              <div><div className="text-2xl font-semibold">₹{eod.orders.revenue.toFixed(0)}</div><div className="text-muted-foreground">Revenue</div></div>
              <div><div className="text-2xl font-semibold">{eod.orders.cancelled}</div><div className="text-muted-foreground">Cancelled</div></div>
              <div><div className="text-2xl font-semibold">{eod.incidents.length + eod.panicAlerts.length}</div><div className="text-muted-foreground">Incidents + alerts</div></div>
            </div>
            <div className="mt-3 text-sm">
              <b>Closing runs:</b> {eod.closingRuns.length}
            </div>
          </CardContent></Card>
        )}
        <Card><CardContent className="p-4">
          <h3 className="font-semibold mb-3">Recent briefings</h3>
          <div className="space-y-2 text-sm">
            {briefings.map(b => (
              <div key={b.id} className="border rounded p-3">
                <div className="font-medium">{b.forDate}</div>
                <div className="text-muted-foreground">Yesterday: {b.summary.yesterdayOrders} orders · ₹{Number(b.summary.yesterdayRevenue).toFixed(0)} · vs prev {b.summary.prevDayOrders} / ₹{Number(b.summary.prevDayRevenue).toFixed(0)}</div>
                <div className="text-muted-foreground">Open incidents: {b.summary.openIncidents} · Panic 24h: {b.summary.panicAlerts24h}</div>
              </div>
            ))}
            {briefings.length === 0 && <div className="text-muted-foreground">No briefings yet.</div>}
          </div>
        </CardContent></Card>
      </div>
    </Layout>
  );
}
