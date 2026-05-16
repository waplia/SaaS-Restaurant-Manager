import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, MapPin, Phone, Plus, Truck } from "lucide-react";
import {
  useTiffinDeliveries, useMarkAttendance, useTiffinRoutes, useCreateTiffinRoute,
} from "@/lib/tiffin";
import { toast } from "@/hooks/use-toast";

export default function TiffinDeliveriesPage() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [routeId, setRouteId] = useState<number>(0);
  const { data: routes = [] } = useTiffinRoutes();
  const { data: deliveries = [] } = useTiffinDeliveries(date, routeId || undefined);
  const mark = useMarkAttendance();
  const createRoute = useCreateTiffinRoute();
  const [showRoute, setShowRoute] = useState(false);
  const [routeForm, setRouteForm] = useState({ name: "", description: "", slot: "lunch" });

  const total = deliveries.length;
  const delivered = deliveries.filter(d => d.status === "delivered").length;
  const pending = deliveries.filter(d => d.status === "scheduled").length;
  const skipped = deliveries.filter(d => d.status === "skipped" || d.status === "paused").length;

  return (
    <Layout>
      <PageHeader
        title="Today's Deliveries"
        subtitle="Tiffin delivery routes & attendance"
        actions={<Button variant="outline" onClick={() => setShowRoute(true)}><Plus className="w-4 h-4 mr-1" />New Route</Button>}
      />

      <div className="flex gap-3 items-end mb-4 flex-wrap">
        <div>
          <label className="text-xs text-muted-foreground">Date</label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-auto" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Route</label>
          <select className="border border-border rounded-md p-2 bg-background" value={routeId} onChange={e => setRouteId(Number(e.target.value))}>
            <option value={0}>All routes</option>
            {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Total" value={total} />
        <Stat label="Delivered" value={delivered} color="text-green-600" />
        <Stat label="Pending" value={pending} color="text-amber-600" />
        <Stat label="Skipped" value={skipped} color="text-gray-500" />
      </div>

      {showRoute && (
        <div className="bg-card border border-border rounded-xl p-4 mb-4">
          <h3 className="font-semibold mb-3">New Route</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input placeholder="Route name (e.g. North Zone)" value={routeForm.name} onChange={e => setRouteForm({ ...routeForm, name: e.target.value })} />
            <Input placeholder="Description" value={routeForm.description} onChange={e => setRouteForm({ ...routeForm, description: e.target.value })} />
            <select className="border border-border rounded-md p-2 bg-background" value={routeForm.slot} onChange={e => setRouteForm({ ...routeForm, slot: e.target.value })}>
              <option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option>
            </select>
          </div>
          <div className="flex gap-2 mt-3">
            <Button onClick={async () => {
              if (!routeForm.name.trim()) { toast({ title: "Name required" }); return; }
              await createRoute.mutateAsync(routeForm);
              setShowRoute(false);
              setRouteForm({ name: "", description: "", slot: "lunch" });
            }}>Create</Button>
            <Button variant="outline" onClick={() => setShowRoute(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr><th className="p-3 text-left">#</th><th className="p-3 text-left">Customer</th><th className="p-3 text-left">Route</th><th className="p-3 text-left">Address</th><th className="p-3">Meals</th><th className="p-3">Status</th><th className="p-3 text-right">Mark</th></tr>
          </thead>
          <tbody>
            {deliveries.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No deliveries scheduled. Generate calendar from Subscriptions page.</td></tr>}
            {deliveries.map(d => (
              <tr key={d.id} className="border-t border-border">
                <td className="p-3 text-xs text-muted-foreground">{d.routeStop ?? "—"}</td>
                <td className="p-3">
                  <p className="font-medium">{d.customerName}</p>
                  {d.customerPhone && <a href={`tel:${d.customerPhone}`} className="text-xs text-primary flex items-center gap-1"><Phone className="w-3 h-3" />{d.customerPhone}</a>}
                </td>
                <td className="p-3 text-xs flex items-center gap-1"><Truck className="w-3 h-3" />{d.routeName ?? "—"}</td>
                <td className="p-3 text-xs max-w-xs"><div className="flex items-start gap-1"><MapPin className="w-3 h-3 mt-0.5" />{d.deliveryAddress}</div></td>
                <td className="p-3 text-center">{d.mealsCount}</td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    d.status === "delivered" ? "bg-green-100 text-green-700" :
                    d.status === "skipped" || d.status === "paused" ? "bg-gray-100 text-gray-600" :
                    d.status === "not_delivered" ? "bg-red-100 text-red-700" :
                    "bg-amber-100 text-amber-700"
                  }`}>{d.status.replace("_", " ")}</span>
                </td>
                <td className="p-3 text-right">
                  {d.status === "scheduled" && (
                    <div className="inline-flex gap-1">
                      <button title="Delivered" onClick={() => mark.mutate({ id: d.id, status: "delivered" })} className="p-1.5 hover:bg-muted rounded text-green-600"><CheckCircle2 className="w-4 h-4" /></button>
                      <button title="Skip" onClick={() => mark.mutate({ id: d.id, status: "skipped", reason: "no answer" })} className="p-1.5 hover:bg-muted rounded text-gray-500"><XCircle className="w-4 h-4" /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </Layout>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold ${color ?? ""}`}>{value}</p>
    </div>
  );
}
