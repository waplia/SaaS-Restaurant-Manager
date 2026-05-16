import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Activity, Search, X } from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useAdminAuditLogs, useAdminAuditLogDetail } from "@/lib/hooks";
import { cn } from "@/lib/utils";

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
import type { AuditLog } from "@/lib/types";

const ACTION_HEAD_COLORS: Record<string, string> = {
  create: "bg-green-100 text-green-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-red-100 text-red-700",
  login: "bg-purple-100 text-purple-700",
  logout: "bg-gray-100 text-gray-600",
  impersonate: "bg-amber-100 text-amber-800",
  broadcast: "bg-pink-100 text-pink-700",
  manual_payment: "bg-indigo-100 text-indigo-700",
  payment_method: "bg-indigo-100 text-indigo-700",
  tenant: "bg-teal-100 text-teal-700",
  restaurant: "bg-teal-100 text-teal-700",
  user: "bg-blue-100 text-blue-700",
  plan: "bg-orange-100 text-orange-700",
  template: "bg-pink-100 text-pink-700",
  branch: "bg-teal-100 text-teal-700",
};

function actionColor(a: string) {
  const head = a.split(".")[0] ?? a;
  return ACTION_HEAD_COLORS[head] ?? "bg-muted text-muted-foreground";
}

export default function AdminAuditLogsPage() {
  const [filters, setFilters] = useState({
    q: "", module: "", action: "", role: "", ip: "", restaurantId: "",
    dateFrom: "", dateTo: "",
  });
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const limit = 50;

  function setF<K extends keyof typeof filters>(k: K, v: string) {
    setFilters(s => ({ ...s, [k]: v }));
    setPage(1);
  }

  const { data, isLoading } = useAdminAuditLogs({
    q: filters.q || undefined,
    module: filters.module || undefined,
    action: filters.action || undefined,
    role: filters.role || undefined,
    ip: filters.ip || undefined,
    restaurantId: filters.restaurantId ? Number(filters.restaurantId) : undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    page, limit,
  });
  const logs = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const { data: detail } = useAdminAuditLogDetail(selectedId);

  return (
    <AdminLayout title="Audit Logs" subtitle="Platform-wide event history across auth, restaurants, billing, settings, and more.">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search action, entity, user…" value={filters.q} onChange={e => setF("q", e.target.value)} className="pl-9 h-8 w-64 text-sm" />
          </div>
          <Input placeholder="Module" value={filters.module} onChange={e => setF("module", e.target.value)} className="h-8 w-32 text-sm" />
          <Input placeholder="Action" value={filters.action} onChange={e => setF("action", e.target.value)} className="h-8 w-44 text-sm" />
          <Input placeholder="Role" value={filters.role} onChange={e => setF("role", e.target.value)} className="h-8 w-32 text-sm" />
          <Input placeholder="IP" value={filters.ip} onChange={e => setF("ip", e.target.value)} className="h-8 w-32 text-sm" />
          <Input placeholder="Restaurant ID" value={filters.restaurantId} onChange={e => setF("restaurantId", e.target.value)} className="h-8 w-32 text-sm" />
          <Input type="date" value={filters.dateFrom} onChange={e => setF("dateFrom", e.target.value)} className="h-8 w-36 text-sm" />
          <Input type="date" value={filters.dateTo} onChange={e => setF("dateTo", e.target.value)} className="h-8 w-36 text-sm" />
          <span className="text-xs text-muted-foreground ml-auto self-center">{total} events</span>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">When</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">User</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Role</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Module</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Action</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Entity</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5 hidden lg:table-cell">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log: AuditLog) => (
                <tr key={log.id} className="border-b border-border last:border-0 hover:bg-muted/10 cursor-pointer" onClick={() => setSelectedId(log.id)}>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
                  <td className="px-4 py-3 text-sm">{log.userDisplay ?? (log.userId ? `#${log.userId}` : "—")}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{log.role ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{log.module ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", actionColor(log.action))}>{log.action}</span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm capitalize">{log.entity}</p>
                    {log.entityId && <p className="text-xs text-muted-foreground">#{log.entityId}</p>}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">{log.ipAddress ?? "—"}</td>
                </tr>
              ))}
              {!isLoading && logs.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">
                  <Activity className="w-10 h-10 mx-auto mb-3 opacity-20" /> No events match these filters
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between">
          <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-xs text-muted-foreground">Page {page} of {totalPages} · {total} events</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      </div>

      {selectedId && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSelectedId(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-full max-w-xl bg-card h-full overflow-y-auto p-6 border-l border-border" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-semibold text-lg">{detail?.action ?? "Loading…"}</h3>
                {detail && <p className="text-xs text-muted-foreground">{formatDateTime(detail.createdAt)}</p>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}><X className="w-4 h-4" /></Button>
            </div>
            {detail && (
              <div className="space-y-3 text-sm">
                <Row label="Module" value={detail.module} />
                <Row label="Entity" value={`${detail.entity}${detail.entityId ? ` #${detail.entityId}` : ""}`} />
                <Row label="User" value={detail.userDisplay ?? (detail.userId ? `#${detail.userId}` : "—")} />
                <Row label="Email" value={detail.userEmail ?? null} />
                <Row label="Role" value={detail.role} />
                <Row label="Restaurant" value={detail.restaurantName ?? (detail.targetRestaurantId ? `#${detail.targetRestaurantId}` : detail.restaurantId ? `#${detail.restaurantId}` : "—")} />
                <Row label="IP address" value={detail.ipAddress} />
                <Row label="User agent" value={detail.userAgent} mono />
                {detail.details && <Row label="Details" value={detail.details} />}
                {detail.oldValue !== null && detail.oldValue !== undefined && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Old value</p>
                    <pre className="text-xs bg-muted/40 p-2 rounded overflow-auto max-h-60">{JSON.stringify(detail.oldValue, null, 2)}</pre>
                  </div>
                )}
                {detail.newValue !== null && detail.newValue !== undefined && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">New value</p>
                    <pre className="text-xs bg-muted/40 p-2 rounded overflow-auto max-h-60">{JSON.stringify(detail.newValue, null, 2)}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function Row({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <span className="text-xs font-medium text-muted-foreground w-28 shrink-0">{label}</span>
      <span className={cn("text-xs break-all", mono && "font-mono")}>{value || "—"}</span>
    </div>
  );
}
