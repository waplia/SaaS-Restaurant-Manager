/**
 * Task #436 — Public status page.
 *
 * Reads `/public/status` (no auth) and renders active + recent incidents.
 * The overall severity rollup drives the colored banner at the top.
 */
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, AlertOctagon, Activity } from "lucide-react";

type Severity = "minor" | "major" | "critical" | "none";
type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved";

interface IncidentUpdate { id: number; status: IncidentStatus; body: string; createdAt: string; }
interface Incident {
  id: number;
  title: string;
  body: string;
  status: IncidentStatus;
  severity: "minor" | "major" | "critical";
  affectedComponents: string[];
  startedAt: string;
  resolvedAt: string | null;
  updates: IncidentUpdate[];
}
interface StatusPayload {
  title: string;
  description: string;
  overallSeverity: Severity;
  active: Incident[];
  recent: Incident[];
}

const STATUS_COLORS: Record<IncidentStatus, string> = {
  investigating: "bg-orange-100 text-orange-800",
  identified: "bg-amber-100 text-amber-800",
  monitoring: "bg-blue-100 text-blue-800",
  resolved: "bg-green-100 text-green-800",
};
const SEVERITY_LABELS: Record<Severity, string> = {
  none: "All Systems Operational",
  minor: "Minor incident in progress",
  major: "Major incident in progress",
  critical: "Critical outage in progress",
};

async function fetchStatus(): Promise<StatusPayload> {
  // The status page is public — bypass the apiGet wrapper which assumes auth.
  const r = await fetch("/api/public/status");
  if (!r.ok) throw new Error(`Status page unavailable (${r.status})`);
  return r.json();
}

export default function StatusPage() {
  const q = useQuery({ queryKey: ["public-status"], queryFn: fetchStatus, refetchInterval: 60_000 });

  const data = q.data;
  const severity: Severity = data?.overallSeverity ?? "none";

  const bannerColor =
    severity === "critical" ? "bg-red-600 text-white" :
    severity === "major"    ? "bg-orange-500 text-white" :
    severity === "minor"    ? "bg-yellow-500 text-white" :
    "bg-green-600 text-white";

  const Icon =
    severity === "critical" ? AlertOctagon :
    severity === "major"    ? AlertTriangle :
    severity === "minor"    ? Activity :
    CheckCircle2;

  return (
    <div className="min-h-screen bg-background">
      <div className={`${bannerColor} py-8 px-6`}>
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Icon className="h-7 w-7" />
            {data?.title ?? "System Status"}
          </h1>
          <p className="mt-2 text-sm opacity-90">{SEVERITY_LABELS[severity]}</p>
          {data?.description && <p className="mt-1 text-sm opacity-90">{data.description}</p>}
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-8">
        {q.isLoading && <div className="text-center text-muted-foreground py-12">Loading status…</div>}
        {q.error && <div className="text-center text-red-600 py-12">{(q.error as Error).message}</div>}

        {data && data.active.length === 0 && (
          <div className="border rounded-lg p-8 text-center text-muted-foreground">
            <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-green-600" />
            No active incidents.
          </div>
        )}

        {data && data.active.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3">Active Incidents</h2>
            <div className="space-y-4">
              {data.active.map(i => <IncidentCard key={i.id} incident={i} />)}
            </div>
          </section>
        )}

        {data && data.recent.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3">Recently Resolved</h2>
            <div className="space-y-4">
              {data.recent.map(i => <IncidentCard key={i.id} incident={i} compact />)}
            </div>
          </section>
        )}

        <div className="text-xs text-center text-muted-foreground pt-6 border-t">
          Auto-refreshes every minute. Last updated {data ? new Date().toLocaleString() : "—"}.
        </div>
      </div>
    </div>
  );
}

function IncidentCard({ incident, compact }: { incident: Incident; compact?: boolean }) {
  const updates = [...incident.updates].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <article className="border rounded-lg p-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-medium">{incident.title}</div>
          <div className="text-xs text-muted-foreground mt-1">
            Started {new Date(incident.startedAt).toLocaleString()}
            {incident.resolvedAt && <> · Resolved {new Date(incident.resolvedAt).toLocaleString()}</>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={STATUS_COLORS[incident.status]}>{incident.status}</Badge>
          <Badge variant="outline">{incident.severity}</Badge>
        </div>
      </header>
      {incident.affectedComponents.length > 0 && (
        <div className="mt-2 text-xs">
          <span className="text-muted-foreground">Affected: </span>
          {incident.affectedComponents.map(c => <Badge key={c} variant="outline" className="mr-1">{c}</Badge>)}
        </div>
      )}
      {!compact && (
        <div className="mt-3 space-y-3 text-sm">
          {updates.map(u => (
            <div key={u.id} className="border-l-2 pl-3">
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Badge className={STATUS_COLORS[u.status]} variant="outline">{u.status}</Badge>
                {new Date(u.createdAt).toLocaleString()}
              </div>
              <p className="mt-1 whitespace-pre-wrap">{u.body}</p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
