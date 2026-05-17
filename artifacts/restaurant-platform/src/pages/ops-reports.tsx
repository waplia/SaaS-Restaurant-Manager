import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarChart3 } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet } from "@/lib/api";

interface Report {
  windowDays: number;
  serviceTimerPercentiles: { stage: string; count: number; avgMs: number; medianMs: number; p90Ms: number }[];
  incidentSummary: { severity: string; status: string; count: number }[];
  equipmentMaintenanceCost: { totalCost: number; recordCount: number };
  closingChecklistCompliance: { runs: number; cleanRuns: number };
  cleaningProofCompliance: { proofs: number; verifiedProofs: number };
  temperatureLogCompliance: { readings: number; inRangeReadings: number };
}

const fmtMin = (ms: number) => `${(ms / 1000 / 60).toFixed(1)} min`;
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(0)}%` : "—");

export default function OpsReportsPage() {
  const restaurantId = useRestaurantId();
  const [days, setDays] = useState(7);
  const { data } = useQuery<Report>({
    queryKey: ["ops", "reports", restaurantId, days],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/ops/reports?days=${days}`),
  });
  return (
    <Layout>
      <PageHeader title="Operations Reports" subtitle="Compliance, timing and maintenance metrics" icon={BarChart3} />
      <div className="p-6 space-y-6">
        <div className="flex items-end gap-3">
          <div>
            <Label>Window (days)</Label>
            <Input type="number" min={1} max={90} value={days} onChange={e => setDays(Math.max(1, Math.min(90, Number(e.target.value) || 7)))} className="w-32" />
          </div>
        </div>
        <Card><CardContent className="p-4">
          <h3 className="font-semibold mb-3">Service timer percentiles</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            {(data?.serviceTimerPercentiles ?? []).map(t => (
              <div key={t.stage} className="border rounded p-2 space-y-0.5">
                <div className="font-medium">{t.stage}</div>
                <div className="text-muted-foreground">avg {fmtMin(t.avgMs)} · n={t.count}</div>
                <div className="text-muted-foreground">median {fmtMin(t.medianMs)}</div>
                <div className="text-muted-foreground">p90 {fmtMin(t.p90Ms)}</div>
              </div>
            ))}
            {(!data?.serviceTimerPercentiles || data.serviceTimerPercentiles.length === 0) && <div className="text-muted-foreground">No data yet.</div>}
          </div>
        </CardContent></Card>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card><CardContent className="p-4">
            <h3 className="font-semibold mb-2">Incident summary</h3>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th>Severity</th><th>Status</th><th>Count</th></tr></thead>
              <tbody>{(data?.incidentSummary ?? []).map((i, idx) => (
                <tr key={idx} className="border-t"><td>{i.severity}</td><td>{i.status}</td><td>{i.count}</td></tr>
              ))}</tbody>
            </table>
            {(!data?.incidentSummary || data.incidentSummary.length === 0) && <div className="text-muted-foreground mt-2">No incidents in window.</div>}
          </CardContent></Card>
          <Card><CardContent className="p-4 space-y-3 text-sm">
            <h3 className="font-semibold">Compliance & cost</h3>
            <div>Equipment maintenance: ₹{(data?.equipmentMaintenanceCost.totalCost ?? 0).toFixed(2)} across {data?.equipmentMaintenanceCost.recordCount ?? 0} record(s)</div>
            <div>Closing checklist: {pct(data?.closingChecklistCompliance.cleanRuns ?? 0, data?.closingChecklistCompliance.runs ?? 0)} clean ({data?.closingChecklistCompliance.cleanRuns ?? 0}/{data?.closingChecklistCompliance.runs ?? 0})</div>
            <div>Cleaning proofs verified: {pct(data?.cleaningProofCompliance.verifiedProofs ?? 0, data?.cleaningProofCompliance.proofs ?? 0)} ({data?.cleaningProofCompliance.verifiedProofs ?? 0}/{data?.cleaningProofCompliance.proofs ?? 0})</div>
            <div>Temperature readings in range: {pct(data?.temperatureLogCompliance.inRangeReadings ?? 0, data?.temperatureLogCompliance.readings ?? 0)} ({data?.temperatureLogCompliance.inRangeReadings ?? 0}/{data?.temperatureLogCompliance.readings ?? 0})</div>
          </CardContent></Card>
        </div>
      </div>
    </Layout>
  );
}
