import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, RefreshCw, Check } from "lucide-react";
import { usePortionDriftEvents, useAcknowledgePortionDrift, useRunPortionDriftSweep } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";

export default function PortionDriftPage() {
  const { toast } = useToast();
  const ALL = "__all";
  const [status, setStatus] = useState<string>("open");
  const [severity, setSeverity] = useState<string>(ALL);
  const eventsQ = usePortionDriftEvents({
    status: status && status !== ALL ? status : undefined,
    severity: severity && severity !== ALL ? severity : undefined,
  });
  const ack = useAcknowledgePortionDrift();
  const sweep = useRunPortionDriftSweep();

  const sevColor = (s: string) => s === "critical" ? "destructive" : s === "warning" ? "default" : "secondary";

  return (
    <Layout>
      <PageHeader title="Portion Drift" subtitle="When actual usage drifts >10% from recipe expectations." icon={AlertTriangle}>
        <Button onClick={async () => {
          try { const r = await sweep.mutateAsync(7) as { created: number; checked: number }; toast({ title: `Scan complete`, description: `${r.created} new alerts from ${r.checked} ingredients` }); }
          catch (e) { toast({ title: "Failed", description: String(e), variant: "destructive" }); }
        }} disabled={sweep.isPending} data-testid="button-run-sweep">
          <RefreshCw className={`w-4 h-4 mr-1 ${sweep.isPending ? "animate-spin" : ""}`} /> Re-scan last 7d
        </Button>
      </PageHeader>

      <div className="flex flex-wrap gap-2 mb-4">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40" data-testid="select-status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="acknowledged">Acknowledged</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value={ALL}>All</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-40" data-testid="select-severity"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {eventsQ.isLoading && <p className="text-muted-foreground">Loading…</p>}
      {!eventsQ.isLoading && (eventsQ.data ?? []).length === 0 && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          No drift events match the filters. Try <strong>Re-scan</strong> to populate alerts.
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {(eventsQ.data ?? []).map(ev => {
          const drift = Number(ev.driftPct);
          const dir = drift > 0 ? "over" : "under";
          return (
            <Card key={ev.id}>
              <CardContent className="py-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={sevColor(ev.severity) as any}>{ev.severity}</Badge>
                    <Badge variant="outline">{ev.status}</Badge>
                    <span className="font-medium truncate">{ev.inventoryItemName ?? `#${ev.inventoryItemId}`}</span>
                    <span className={`font-semibold ${drift > 0 ? "text-red-600" : "text-amber-600"}`}>{drift > 0 ? "+" : ""}{drift.toFixed(1)}% {dir}-usage</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Expected: {Number(ev.expectedQuantity).toFixed(2)} {ev.inventoryUnit ?? ""} • Actual: {Number(ev.actualQuantity).toFixed(2)} {ev.inventoryUnit ?? ""} • Period {new Date(ev.periodStart).toLocaleDateString()} → {new Date(ev.periodEnd).toLocaleDateString()}
                  </p>
                  {ev.notes && <p className="text-xs italic mt-1">"{ev.notes}"</p>}
                </div>
                {ev.status === "open" && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => ack.mutate({ id: ev.id })} data-testid={`button-ack-${ev.id}`}>Acknowledge</Button>
                    <Button size="sm" onClick={() => ack.mutate({ id: ev.id, resolved: true })} data-testid={`button-resolve-${ev.id}`}><Check className="w-3 h-3 mr-1"/> Resolve</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </Layout>
  );
}
