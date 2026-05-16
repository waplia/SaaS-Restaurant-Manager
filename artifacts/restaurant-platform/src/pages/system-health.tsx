import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity, AlertTriangle, ArrowLeft, CheckCircle2, Clock, Cpu, Database,
  HardDrive, Mail, MessageCircle, MessageSquare, RefreshCw, ServerCrash,
  ShieldAlert, ShieldCheck, Smartphone, Webhook, X, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiFetch, apiAction } from "@/lib/api";
import { AdminLayout } from "@/components/layout/AdminLayout";

type Overall = "operational" | "degraded" | "outage";
type CronEntry = {
  name: string; schedule: string; description?: string;
  lastRunAt: string | null; lastStatus: "ok" | "failed" | null;
  lastError: string | null; lastDurationMs: number | null;
};
type Overview = {
  overall: Overall;
  checkedAt: string;
  database: { status: "ok" | "degraded" | "down"; latencyMs: number | null; error?: string };
  uptime: { startedAt: string; uptimeSeconds: number; nodeVersion: string; platform: string; pid: number; memory: { rssMb: number; heapUsedMb: number } };
  storage: { status: "ok" | "degraded" | "unavailable"; bytesUsed: number | null; objectCount: number | null; bucket: string | null; error?: string };
  queue: { status: "ok" | "degraded"; pending: number; running: number; failedLast24h: number; lastDispatchAt: string | null };
  cron: CronEntry[];
  exceptions: { last24h: number };
};
type LogRow = {
  id: number;
  category: string;
  level: "info" | "warn" | "error" | "fatal";
  status: "success" | "failed" | "skipped";
  message: string;
  route: string | null;
  method: string | null;
  statusCode: number | null;
  tenantId: number | null;
  userId: number | null;
  jobName: string | null;
  payload: unknown;
  stack: string | null;
  source: string | null;
  createdAt: string;
};
type LogList = { data: LogRow[]; page: number; pageSize: number; total: number };
type LogStats = { since: string; counts: Record<string, { total: number; failed: number }> };

const TABS = [
  { id: "app_error",       label: "App errors",      icon: ServerCrash },
  { id: "exception",       label: "Exceptions",      icon: AlertTriangle },
  { id: "api_error",       label: "API errors",      icon: ShieldAlert },
  { id: "payment_webhook", label: "Payment webhooks", icon: Webhook },
  { id: "job_failure",     label: "Failed jobs",     icon: Zap },
  { id: "sms",             label: "SMS",             icon: Smartphone },
  { id: "whatsapp",        label: "WhatsApp",        icon: MessageCircle },
  { id: "email",           label: "Email",           icon: Mail },
] as const;
type TabId = typeof TABS[number]["id"];

function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function fmtDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function StatusPill({ status }: { status: "ok" | "degraded" | "down" | "unavailable" | "operational" | "outage" | "success" | "failed" | "skipped" }) {
  const map: Record<string, { label: string; cls: string }> = {
    ok:          { label: "OK",          cls: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30" },
    operational: { label: "Operational", cls: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30" },
    success:     { label: "Success",     cls: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30" },
    degraded:    { label: "Degraded",    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
    skipped:     { label: "Skipped",     cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
    unavailable: { label: "Unavailable", cls: "bg-muted text-muted-foreground border-border" },
    down:        { label: "Down",        cls: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30" },
    outage:      { label: "Outage",      cls: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30" },
    failed:      { label: "Failed",      cls: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30" },
  };
  const cfg = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground border-border" };
  return <Badge className={`${cfg.cls} border`}>{cfg.label}</Badge>;
}

function StatusCard({ icon: Icon, title, status, lines, extra }: {
  icon: typeof Database; title: string;
  status: "ok" | "degraded" | "down" | "unavailable" | "operational";
  lines: Array<{ label: string; value: string }>;
  extra?: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-foreground">{title}</h3>
        </div>
        <StatusPill status={status} />
      </div>
      <dl className="text-sm space-y-1.5">
        {lines.map(l => (
          <div key={l.label} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{l.label}</dt>
            <dd className="text-foreground font-medium text-right truncate max-w-[60%]" title={l.value}>{l.value}</dd>
          </div>
        ))}
      </dl>
      {extra}
    </div>
  );
}

export default function SystemHealthPage() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<TabId>("app_error");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [statusFilter, setStatusFilter] = useState<"" | "success" | "failed">("");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<LogRow | null>(null);

  useEffect(() => { setPage(1); }, [tab, statusFilter, q, from, to]);

  const overview = useQuery<Overview>({
    queryKey: ["system-health", "overview"],
    queryFn: () => apiFetch("/admin/system-health/overview"),
    refetchInterval: 30000,
  });

  const stats = useQuery<LogStats>({
    queryKey: ["system-health", "log-stats"],
    queryFn: () => apiFetch("/admin/system-health/log-stats"),
    refetchInterval: 60000,
  });

  const queryString = useMemo(() => {
    const sp = new URLSearchParams({ category: tab, page: String(page), pageSize: String(pageSize) });
    if (statusFilter) sp.set("status", statusFilter);
    if (q) sp.set("q", q);
    if (from) sp.set("from", new Date(from).toISOString());
    if (to) sp.set("to", new Date(to).toISOString());
    return sp.toString();
  }, [tab, page, pageSize, statusFilter, q, from, to]);

  const logs = useQuery<LogList>({
    queryKey: ["system-health", "logs", queryString],
    queryFn: () => apiFetch(`/admin/system-health/logs?${queryString}`),
  });

  const retry = useMutation({
    mutationFn: (id: number) => apiAction<{ ok: boolean; retried: string }>(`/admin/system-health/jobs/${id}/retry`, "POST"),
    onSuccess: (r) => {
      toast({ title: "Retry triggered", description: r.retried });
      void qc.invalidateQueries({ queryKey: ["system-health"] });
    },
    onError: (e) => toast({ title: "Retry failed", description: (e as Error).message, variant: "destructive" }),
  });

  const submitSearch = (e: React.FormEvent) => { e.preventDefault(); setQ(qInput); };

  if (!user?.isSuperAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <ShieldCheck className="w-12 h-12 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-semibold">Super Admin Access Only</h2>
          <p className="text-muted-foreground text-sm">You do not have permission to view this page.</p>
          <Link href="/admin"><Button variant="outline">Back to admin</Button></Link>
        </div>
      </div>
    );
  }

  const ov = overview.data;
  const pageCount = logs.data ? Math.max(1, Math.ceil(logs.data.total / pageSize)) : 1;

  return (
    <AdminLayout
      title="System Health & Logs"
      subtitle="Real-time platform diagnostics"
      actions={
        <Button variant="outline" size="sm" onClick={() => { void overview.refetch(); void stats.refetch(); void logs.refetch(); }} className="gap-1">
          <RefreshCw className={`w-4 h-4 ${overview.isFetching ? "animate-spin" : ""}`} />Refresh
        </Button>
      }
    >
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Overall banner */}
        {ov && (
          <div className={`rounded-xl border p-4 flex items-center justify-between ${
            ov.overall === "operational" ? "bg-green-500/10 border-green-500/30" :
            ov.overall === "degraded"    ? "bg-amber-500/10 border-amber-500/30" :
                                            "bg-red-500/10 border-red-500/30"
          }`}>
            <div className="flex items-center gap-3">
              {ov.overall === "operational" ? <CheckCircle2 className="w-5 h-5 text-green-600" /> :
               ov.overall === "degraded"    ? <AlertTriangle className="w-5 h-5 text-amber-600" /> :
                                              <ServerCrash className="w-5 h-5 text-red-600" />}
              <div>
                <p className="font-semibold capitalize">{ov.overall}</p>
                <p className="text-xs text-muted-foreground">Last checked: {fmtTime(ov.checkedAt)}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Auto-refresh every 30s</p>
          </div>
        )}

        {/* Status cards */}
        {ov && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatusCard
              icon={Database} title="Database" status={ov.database.status}
              lines={[
                { label: "Latency", value: ov.database.latencyMs != null ? `${ov.database.latencyMs} ms` : "—" },
                ...(ov.database.error ? [{ label: "Error", value: ov.database.error }] : []),
              ]}
            />
            <StatusCard
              icon={Cpu} title="Server" status="operational"
              lines={[
                { label: "Uptime", value: fmtDuration(ov.uptime.uptimeSeconds) },
                { label: "Started", value: fmtTime(ov.uptime.startedAt) },
                { label: "Node", value: ov.uptime.nodeVersion },
                { label: "Memory (RSS)", value: `${ov.uptime.memory.rssMb} MB` },
              ]}
            />
            <StatusCard
              icon={HardDrive} title="Object storage" status={ov.storage.status === "unavailable" ? "unavailable" : ov.storage.status}
              lines={[
                { label: "Used", value: fmtBytes(ov.storage.bytesUsed) },
                { label: "Objects", value: ov.storage.objectCount?.toLocaleString() ?? "—" },
                { label: "Bucket", value: ov.storage.bucket ?? "—" },
                ...(ov.storage.error ? [{ label: "Note", value: ov.storage.error }] : []),
              ]}
            />
            <StatusCard
              icon={MessageSquare} title="Notification queue" status={ov.queue.status}
              lines={[
                { label: "Pending (scheduled)", value: String(ov.queue.pending) },
                { label: "In flight", value: String(ov.queue.running) },
                { label: "Failed (24h)", value: String(ov.queue.failedLast24h) },
                { label: "Last dispatch", value: ov.queue.lastDispatchAt ? fmtTime(ov.queue.lastDispatchAt) : "—" },
              ]}
            />
          </div>
        )}

        {/* Cron jobs */}
        {ov && (
          <div className="bg-card border border-border rounded-xl">
            <div className="px-6 py-4 border-b border-border flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              <h2 className="font-semibold">Scheduled jobs</h2>
              <span className="text-xs text-muted-foreground">({ov.cron.length})</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground uppercase">
                    <th className="px-6 py-3 text-left">Job</th>
                    <th className="px-6 py-3 text-left">Schedule</th>
                    <th className="px-6 py-3 text-left">Last run</th>
                    <th className="px-6 py-3 text-left">Duration</th>
                    <th className="px-6 py-3 text-left">Status</th>
                    <th className="px-6 py-3 text-left">Last error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ov.cron.map(c => (
                    <tr key={c.name} className="hover:bg-muted/20">
                      <td className="px-6 py-3">
                        <p className="font-medium">{c.name}</p>
                        {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
                      </td>
                      <td className="px-6 py-3 font-mono text-xs">{c.schedule}</td>
                      <td className="px-6 py-3 text-xs text-muted-foreground">{fmtTime(c.lastRunAt)}</td>
                      <td className="px-6 py-3 text-xs text-muted-foreground">{c.lastDurationMs != null ? `${c.lastDurationMs} ms` : "—"}</td>
                      <td className="px-6 py-3">{c.lastStatus ? <StatusPill status={c.lastStatus === "ok" ? "ok" : "failed"} /> : <span className="text-xs text-muted-foreground">Not run yet</span>}</td>
                      <td className="px-6 py-3 text-xs text-red-600 truncate max-w-xs" title={c.lastError ?? ""}>{c.lastError ?? "—"}</td>
                    </tr>
                  ))}
                  {ov.cron.length === 0 && <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No scheduled jobs registered.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-border flex gap-1 overflow-x-auto">
          {TABS.map(t => {
            const c = stats.data?.counts[t.id];
            const failed = c?.failed ?? 0;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 whitespace-nowrap ${
                  tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}>
                <t.icon className="w-4 h-4" />{t.label}
                {failed > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-700 dark:text-red-400">{failed}</span>}
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-end gap-3">
          <form onSubmit={submitSearch} className="flex items-center gap-2">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Search</label>
              <input className="h-9 rounded-md border border-input bg-background px-3 text-sm w-56" placeholder="Message, route, job…"
                value={qInput} onChange={e => setQInput(e.target.value)} />
            </div>
            <Button type="submit" size="sm" variant="outline">Apply</Button>
          </form>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Status</label>
            <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value as "" | "success" | "failed")}>
              <option value="">All</option><option value="success">Success</option><option value="failed">Failed</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">From</label>
            <input type="datetime-local" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">To</label>
            <input type="datetime-local" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); setQInput(""); setStatusFilter(""); setFrom(""); setTo(""); }}>
            Clear
          </Button>
        </div>

        {/* Logs table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {logs.isLoading ? (
            <div className="p-12 text-center text-muted-foreground text-sm">Loading logs…</div>
          ) : logs.data && logs.data.data.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-sm">No log entries match your filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground uppercase">
                    <th className="px-4 py-3 text-left">When</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Message</th>
                    <th className="px-4 py-3 text-left">Source</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logs.data?.data.map(row => (
                    <tr key={`${tab}-${row.id}`} className="hover:bg-muted/20 cursor-pointer" onClick={() => setSelected(row)}>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtTime(row.createdAt)}</td>
                      <td className="px-4 py-3"><StatusPill status={row.status} /></td>
                      <td className="px-4 py-3">
                        <p className="text-foreground line-clamp-2">{row.message}</p>
                        {row.statusCode && <span className="text-[10px] text-muted-foreground font-mono">HTTP {row.statusCode}</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {row.method && row.route ? `${row.method} ${row.route}` : row.jobName ?? row.source ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setSelected(row); }}>View</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {logs.data && logs.data.total > 0 && (
            <div className="px-6 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
              <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, logs.data.total)} of {logs.data.total}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-stretch justify-end" onClick={() => setSelected(null)}>
          <div className="bg-card w-full max-w-2xl h-full overflow-y-auto border-l border-border" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-card">
              <div>
                <p className="font-semibold">Log entry #{selected.id}</p>
                <p className="text-xs text-muted-foreground">{fmtTime(selected.createdAt)} · <span className="capitalize">{selected.category.replace("_", " ")}</span></p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}><X className="w-4 h-4" /></Button>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <div className="flex items-center gap-2"><StatusPill status={selected.status} /><Badge variant="outline" className="capitalize">{selected.level}</Badge></div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Message</p>
                <p className="text-foreground whitespace-pre-wrap">{selected.message}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                {selected.method && <Field label="Method" value={selected.method} />}
                {selected.route && <Field label="Route" value={selected.route} />}
                {selected.statusCode != null && <Field label="HTTP" value={String(selected.statusCode)} />}
                {selected.jobName && <Field label="Job" value={selected.jobName} />}
                {selected.tenantId != null && <Field label="Tenant ID" value={String(selected.tenantId)} />}
                {selected.userId != null && <Field label="User ID" value={String(selected.userId)} />}
                {selected.source && <Field label="Source" value={selected.source} />}
              </div>
              {selected.payload != null && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Payload</p>
                  <pre className="bg-muted/30 border border-border rounded-md p-3 text-xs overflow-x-auto">{JSON.stringify(selected.payload, null, 2)}</pre>
                </div>
              )}
              {selected.stack && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Stack trace</p>
                  <pre className="bg-muted/30 border border-border rounded-md p-3 text-xs overflow-x-auto whitespace-pre-wrap">{selected.stack}</pre>
                </div>
              )}
              {selected.category === "job_failure" && (
                <div className="pt-2">
                  <Button onClick={() => retry.mutate(selected.id)} disabled={retry.isPending} className="gap-1">
                    <RefreshCw className={`w-4 h-4 ${retry.isPending ? "animate-spin" : ""}`} />Retry job
                  </Button>
                  <p className="text-[11px] text-muted-foreground mt-1">Retry is supported for jobs whose payload identifies a known handler (e.g. broadcasts).</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="text-foreground font-medium break-all">{value}</p>
    </div>
  );
}
