import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { History } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet } from "@/lib/api";

interface Event { id: number; eventType: string; entity: string | null; entityId: number | null; actorUserId: number | null; summary: string; occurredAt: string; metadata: Record<string, unknown> | null; }
interface StageStats { stage: string; count: number; avgMs: number; medianMs: number; p90Ms: number; }
interface ServiceSummary { windowDays: number; overall: StageStats[]; byStageDay: (StageStats & { day: string })[]; }
const fmtMin = (ms: number) => `${(ms / 1000 / 60).toFixed(1)} min`;

export default function OpsTimelinePage() {
  const restaurantId = useRestaurantId();
  const [entity, setEntity] = useState("");
  const [entityId, setEntityId] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const qs = useMemo(() => {
    const p = new URLSearchParams({ limit: "200" });
    if (entity) p.set("entity", entity);
    if (entityId) p.set("entityId", entityId);
    if (actorUserId) p.set("actorUserId", actorUserId);
    if (from) p.set("from", new Date(from).toISOString());
    if (to) p.set("to", new Date(to).toISOString());
    return p.toString();
  }, [entity, entityId, actorUserId, from, to]);

  const { data: events = [] } = useQuery<Event[]>({
    queryKey: ["ops", "timeline", restaurantId, qs],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/ops/timeline?${qs}`),
    refetchInterval: 15_000,
  });
  const { data: summary } = useQuery<ServiceSummary>({
    queryKey: ["ops", "service-timer", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/ops/service-timer/summary?days=7`),
  });
  const overall = summary?.overall ?? [];
  return (
    <Layout>
      <PageHeader title="Service Timeline" subtitle="Minute-by-minute restaurant events" icon={History} />
      <div className="p-6 space-y-6">
        <Card><CardContent className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <div><Label>Entity</Label><Input placeholder="order, incident, …" value={entity} onChange={e => setEntity(e.target.value)} /></div>
          <div><Label>Entity ID</Label><Input value={entityId} onChange={e => setEntityId(e.target.value.replace(/[^0-9]/g, ""))} /></div>
          <div><Label>Staff user ID</Label><Input value={actorUserId} onChange={e => setActorUserId(e.target.value.replace(/[^0-9]/g, ""))} /></div>
          <div><Label>From</Label><Input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} /></div>
        </CardContent></Card>
        {overall.length > 0 && (
          <Card><CardContent className="p-4">
            <h3 className="font-semibold mb-2">Service times — last {summary?.windowDays ?? 7} days</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              {overall.map(t => (
                <div key={t.stage} className="border rounded p-2 space-y-0.5">
                  <div className="font-medium">{t.stage}</div>
                  <div className="text-muted-foreground">avg {fmtMin(t.avgMs)} · n={t.count}</div>
                  <div className="text-muted-foreground">median {fmtMin(t.medianMs)}</div>
                  <div className="text-muted-foreground">p90 {fmtMin(t.p90Ms)}</div>
                </div>
              ))}
            </div>
          </CardContent></Card>
        )}
        <Card><CardContent className="p-4">
          <h3 className="font-semibold mb-3">Events</h3>
          <div className="divide-y">
            {events.map(e => (
              <div key={e.id} className="py-2 text-sm flex justify-between gap-3">
                <div>
                  <Badge variant="outline" className="mr-2">{e.eventType}</Badge>
                  {e.summary}
                  {e.entity && <span className="ml-2 text-xs text-muted-foreground">[{e.entity}#{e.entityId ?? "?"}{e.actorUserId ? ` by user ${e.actorUserId}` : ""}]</span>}
                </div>
                <span className="text-muted-foreground text-xs whitespace-nowrap">{new Date(e.occurredAt).toLocaleString()}</span>
              </div>
            ))}
            {events.length === 0 && <div className="py-4 text-muted-foreground text-sm">No events match those filters.</div>}
          </div>
        </CardContent></Card>
      </div>
    </Layout>
  );
}
