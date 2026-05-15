import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost } from "@/lib/api";

interface DeliveryRow {
  id: number;
  endpointId: number;
  eventType: string;
  payload: unknown;
  statusCode: number | null;
  error: string | null;
  attempt: number;
  status: "pending" | "delivered" | "failed" | "permanently_failed";
  nextAttemptAt: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

const STATUS_OPTIONS = ["", "pending", "delivered", "failed", "permanently_failed"] as const;

export default function WebhookLogsPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState<string>("failed");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["webhook-deliveries", restaurantId, status, page],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (status) qs.set("status", status);
      return apiGet<{ rows: DeliveryRow[]; total: number; pageSize: number }>(`/restaurants/${restaurantId}/webhook-deliveries?${qs}`);
    },
    refetchInterval: 10000,
  });

  const retry = useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${restaurantId}/webhook-deliveries/${id}/retry`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["webhook-deliveries", restaurantId] }); toast({ title: "Retry requested" }); },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / (data?.pageSize ?? 25)));

  const statusBadge = (s: DeliveryRow["status"]) => {
    const cls = s === "delivered" ? "bg-green-500/10 text-green-700 dark:text-green-400"
      : s === "pending" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : s === "failed" ? "bg-orange-500/10 text-orange-700 dark:text-orange-400"
      : "bg-destructive/10 text-destructive";
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{s}</span>;
  };

  return (
    <SettingsLayout activeKey="webhook-logs" title="Webhook Delivery Logs" subtitle="See every outgoing delivery, retry, or permanent failure.">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <label className="text-xs text-muted-foreground">Filter:</label>
          <select className="h-8 rounded border border-border bg-background px-2 text-sm" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
            {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o || "All"}</option>)}
          </select>
          <span className="ml-auto text-xs text-muted-foreground">{total} total</span>
        </div>

        <div className="rounded-lg border border-border bg-card/40 overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No deliveries match.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Time</th>
                  <th className="text-left px-4 py-2 font-medium">Event</th>
                  <th className="text-left px-4 py-2 font-medium">Endpoint</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Code</th>
                  <th className="text-left px-4 py-2 font-medium">Attempt</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <>
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r.eventType}</td>
                      <td className="px-4 py-2 text-xs">#{r.endpointId}</td>
                      <td className="px-4 py-2">{statusBadge(r.status)}</td>
                      <td className="px-4 py-2 text-xs">{r.statusCode ?? "—"}</td>
                      <td className="px-4 py-2 text-xs">{r.attempt}</td>
                      <td className="px-4 py-2 text-right space-x-1">
                        <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>{expanded === r.id ? "Hide" : "View"}</Button>
                        {(r.status === "failed" || r.status === "permanently_failed") && (
                          <Button size="sm" variant="outline" onClick={() => retry.mutate(r.id)}>Retry</Button>
                        )}
                      </td>
                    </tr>
                    {expanded === r.id && (
                      <tr key={r.id + "-detail"} className="border-t border-border bg-muted/10">
                        <td colSpan={7} className="px-4 py-3 space-y-2">
                          {r.error && <div className="text-xs text-destructive"><strong>Error:</strong> {r.error}</div>}
                          {r.nextAttemptAt && <div className="text-xs text-muted-foreground"><strong>Next attempt:</strong> {new Date(r.nextAttemptAt).toLocaleString()}</div>}
                          <pre className="text-[11px] font-mono bg-background border border-border rounded p-2 overflow-auto max-h-60">{JSON.stringify(r.payload, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</Button>
            <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        )}
      </div>
    </SettingsLayout>
  );
}
