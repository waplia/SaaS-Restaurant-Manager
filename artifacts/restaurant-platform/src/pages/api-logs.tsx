import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet } from "@/lib/api";

interface LogRow {
  id: number;
  apiKeyId: number | null;
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  ipAddress: string | null;
  createdAt: string;
}

export default function ApiLogsPage() {
  const restaurantId = useRestaurantId();
  const [method, setMethod] = useState("");
  const [statusCode, setStatusCode] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["api-logs", restaurantId, method, statusCode, page],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(page), pageSize: "50" });
      if (method) qs.set("method", method);
      if (statusCode) qs.set("statusCode", statusCode);
      return apiGet<{ rows: LogRow[]; total: number; pageSize: number }>(`/restaurants/${restaurantId}/api-logs?${qs}`);
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / (data?.pageSize ?? 50)));

  return (
    <SettingsLayout activeKey="api-logs" title="API Usage Logs" subtitle="Every request authenticated with one of your API keys.">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Method</label>
            <select className="h-8 rounded border border-border bg-background px-2 text-sm" value={method} onChange={e => { setMethod(e.target.value); setPage(1); }}>
              <option value="">All</option>
              <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Status code</label>
            <Input type="number" className="h-8 w-28" value={statusCode} onChange={e => { setStatusCode(e.target.value); setPage(1); }} placeholder="e.g. 200" />
          </div>
          <span className="ml-auto text-xs text-muted-foreground">{total} requests</span>
        </div>

        <div className="rounded-lg border border-border bg-card/40 overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No requests yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Time</th>
                  <th className="text-left px-4 py-2 font-medium">Method</th>
                  <th className="text-left px-4 py-2 font-medium">Endpoint</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Latency</th>
                  <th className="text-left px-4 py-2 font-medium">Key</th>
                  <th className="text-left px-4 py-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2 text-xs font-mono">{r.method}</td>
                    <td className="px-4 py-2 text-xs font-mono truncate max-w-[280px]">{r.endpoint}</td>
                    <td className={`px-4 py-2 text-xs font-medium ${r.statusCode >= 400 ? "text-destructive" : r.statusCode >= 300 ? "text-amber-600" : "text-green-700 dark:text-green-400"}`}>{r.statusCode}</td>
                    <td className="px-4 py-2 text-xs">{r.latencyMs}ms</td>
                    <td className="px-4 py-2 text-xs">{r.apiKeyId ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{r.ipAddress ?? "—"}</td>
                  </tr>
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
