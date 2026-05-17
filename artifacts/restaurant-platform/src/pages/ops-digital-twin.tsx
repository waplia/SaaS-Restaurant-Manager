import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LayoutDashboard, RefreshCw, AlertTriangle } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet } from "@/lib/api";

interface Snapshot {
  tables: Array<{ id: number; label: string; status: string; capacity: number }>;
  kitchens: Array<{ id: number; name: string; openTickets: number }>;
  openOrders: Array<{ id: number; status: string; type: string; tableId: number | null; total: string; createdAt: string }>;
  activeAlerts: number;
  kpis: { activeWaiters: number; maxWaiterLoad: number; avgWaitMs: number | null; openOrders: number; openTickets: number };
  waiterLoad: Array<{ waiterId: number | null; openOrders: number }>;
  stageAvg: Array<{ stage: string; avgMs: number; count: number }>;
  bottleneck: { stage: string; avgMs: number; callout: string } | null;
  generatedAt: string;
}

const fmtMin = (ms: number | null) => ms == null ? "—" : `${(ms / 1000 / 60).toFixed(1)} min`;

export default function OpsDigitalTwinPage() {
  const restaurantId = useRestaurantId();
  const { data, isLoading, refetch, isFetching } = useQuery<Snapshot>({
    queryKey: ["ops", "digital-twin", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/ops/digital-twin`),
    refetchInterval: 15_000,
  });
  return (
    <Layout>
      <PageHeader title="Restaurant Digital Twin" subtitle="Live floor and kitchen snapshot" icon={LayoutDashboard}
        actions={<button onClick={() => refetch()} className="text-sm flex items-center gap-1 px-3 py-1.5 border rounded-md"><RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`}/>Refresh</button>} />
      <div className="p-6 space-y-6">
        {isLoading && <div className="text-muted-foreground">Loading snapshot…</div>}
        {data && (
          <>
            {data.bottleneck && (
              <Card className="border-amber-300 bg-amber-50">
                <CardContent className="p-3 flex items-center gap-2 text-amber-900 text-sm">
                  <AlertTriangle className="w-4 h-4" /> {data.bottleneck.callout}
                </CardContent>
              </Card>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <Card><CardContent className="p-4"><div className="text-2xl font-semibold">{data.tables.length}</div><div className="text-sm text-muted-foreground">Tables</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-2xl font-semibold">{data.kpis.openOrders}</div><div className="text-sm text-muted-foreground">Open orders</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-2xl font-semibold">{data.kpis.openTickets}</div><div className="text-sm text-muted-foreground">Open kitchen tickets</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-2xl font-semibold">{data.kpis.activeWaiters}</div><div className="text-sm text-muted-foreground">Active waiters</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-2xl font-semibold">{fmtMin(data.kpis.avgWaitMs)}</div><div className="text-sm text-muted-foreground">Avg wait (4h)</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className={`text-2xl font-semibold ${data.activeAlerts > 0 ? "text-red-600" : ""}`}>{data.activeAlerts}</div><div className="text-sm text-muted-foreground">Panic alerts</div></CardContent></Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card><CardContent className="p-4">
                <h3 className="font-semibold mb-3">Kitchens — open tickets</h3>
                <div className="divide-y text-sm">
                  {data.kitchens.map(k => (
                    <div key={k.id} className="py-2 flex justify-between">
                      <span>{k.name}</span>
                      <span className={k.openTickets > 10 ? "text-red-600 font-semibold" : k.openTickets > 5 ? "text-amber-600 font-medium" : ""}>{k.openTickets}</span>
                    </div>
                  ))}
                  {data.kitchens.length === 0 && <div className="py-4 text-muted-foreground">No kitchens.</div>}
                </div>
              </CardContent></Card>

              <Card><CardContent className="p-4">
                <h3 className="font-semibold mb-3">Waiter load — open orders per waiter</h3>
                <div className="divide-y text-sm">
                  {data.waiterLoad.map(w => (
                    <div key={w.waiterId ?? "none"} className="py-2 flex justify-between">
                      <span>Waiter #{w.waiterId ?? "—"}</span>
                      <span className={w.openOrders > 6 ? "text-red-600 font-semibold" : w.openOrders > 3 ? "text-amber-600 font-medium" : ""}>{w.openOrders}</span>
                    </div>
                  ))}
                  {data.waiterLoad.length === 0 && <div className="py-4 text-muted-foreground">No active waiters.</div>}
                </div>
                <div className="mt-3 text-xs text-muted-foreground">Max load on a single waiter: {data.kpis.maxWaiterLoad}</div>
              </CardContent></Card>
            </div>

            {data.stageAvg.length > 0 && (
              <Card><CardContent className="p-4">
                <h3 className="font-semibold mb-3">Service stages — avg duration (last 4h)</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  {data.stageAvg.map(s => (
                    <div key={s.stage} className={`border rounded p-2 ${data.bottleneck?.stage === s.stage ? "border-amber-400 bg-amber-50" : ""}`}>
                      <div className="font-medium">{s.stage}</div>
                      <div className="text-muted-foreground">{fmtMin(s.avgMs)} · n={s.count}</div>
                    </div>
                  ))}
                </div>
              </CardContent></Card>
            )}

            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold mb-3">Floor</h3>
                <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-8 gap-2">
                  {data.tables.map(t => (
                    <div key={t.id} className={`p-3 rounded-md border text-center text-xs ${t.status === "occupied" ? "bg-amber-100 border-amber-300" : t.status === "reserved" ? "bg-blue-100 border-blue-300" : "bg-green-50 border-green-200"}`}>
                      <div className="font-semibold">{t.label}</div>
                      <div className="text-muted-foreground">{t.status} · {t.capacity}p</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold mb-3">Open orders ({data.openOrders.length})</h3>
                <div className="divide-y">
                  {data.openOrders.map(o => (
                    <div key={o.id} className="py-2 flex justify-between text-sm">
                      <span>#{o.id} <Badge variant="outline" className="ml-2">{o.status}</Badge> {o.type}{o.tableId ? ` · table ${o.tableId}` : ""}</span>
                      <span>₹{o.total}</span>
                    </div>
                  ))}
                  {data.openOrders.length === 0 && <div className="py-4 text-muted-foreground text-sm">No open orders.</div>}
                </div>
              </CardContent>
            </Card>
            <div className="text-xs text-muted-foreground">Updated {new Date(data.generatedAt).toLocaleTimeString()}</div>
          </>
        )}
      </div>
    </Layout>
  );
}
