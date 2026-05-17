import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { CloudOff, RefreshCw, Trash2, AlertTriangle, CheckCircle2, Loader2, Wifi } from "lucide-react";
import { useOnlineStatus, useOfflineQueue, useLastSyncAt } from "@/lib/useOnlineStatus";
import { processQueue, removeEntry, retryEntry, clearDone, type QueueEntry } from "@/lib/offlineQueue";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

const STATUS_META: Record<QueueEntry["status"], { label: string; cls: string }> = {
  pending:  { label: "Pending",  cls: "bg-blue-100 text-blue-700" },
  syncing:  { label: "Syncing",  cls: "bg-orange-100 text-orange-700" },
  failed:   { label: "Will retry", cls: "bg-amber-100 text-amber-800" },
  conflict: { label: "Conflict", cls: "bg-red-100 text-red-700" },
  done:     { label: "Synced",   cls: "bg-green-100 text-green-700" },
};

export default function PosSyncPage() {
  const { online } = useOnlineStatus();
  const entries = useOfflineQueue();
  const lastSync = useLastSyncAt();
  const [syncing, setSyncing] = useState(false);

  const pending = entries.filter(e => e.status !== "done");
  const done = entries.filter(e => e.status === "done");
  const conflicts = entries.filter(e => e.status === "conflict");

  const handleSync = async () => {
    setSyncing(true);
    try { await processQueue(); } finally { setSyncing(false); }
  };

  return (
    <Layout>
      <PageHeader
        title="POS Sync Status"
        subtitle="Offline queue, sync history, and conflict resolution."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleSync} disabled={!online || syncing}>
              {syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Sync now
            </Button>
            {done.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearDone}>
                <Trash2 className="w-4 h-4 mr-2" /> Clear synced
              </Button>
            )}
          </div>
        }
      />

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard
            label="Connection"
            value={online ? "Online" : "Offline"}
            tone={online ? "green" : "red"}
            icon={online ? Wifi : CloudOff}
          />
          <StatCard label="Pending" value={String(pending.length)} tone={pending.length === 0 ? "gray" : "orange"} icon={RefreshCw} />
          <StatCard label="Conflicts" value={String(conflicts.length)} tone={conflicts.length === 0 ? "gray" : "red"} icon={AlertTriangle} />
          <StatCard
            label="Last sync"
            value={lastSync ? formatDistanceToNow(lastSync, { addSuffix: true }) : "Never"}
            tone="gray"
            icon={CheckCircle2}
          />
        </div>

        {!online && (
          <div className="rounded-xl border-2 border-dashed border-red-300 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-semibold flex items-center gap-2"><CloudOff className="w-4 h-4" /> Offline mode active</p>
            <p className="mt-1">Orders, KOTs, table edits and payment notes will keep saving locally and sync the moment you reconnect. Reports, analytics and admin pages are unavailable until you're back online.</p>
          </div>
        )}

        {conflicts.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-white">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600" /> Conflicts needing attention
              </h2>
              <span className="text-xs text-muted-foreground">{conflicts.length}</span>
            </div>
            <ul className="divide-y divide-border">
              {conflicts.map(e => <EntryRow key={e.id} entry={e} />)}
            </ul>
          </div>
        )}

        <div className="rounded-xl border border-border bg-card">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-foreground">Queued changes</h2>
            <span className="text-xs text-muted-foreground">{pending.filter(e => e.status !== "conflict").length} active</span>
          </div>
          {pending.filter(e => e.status !== "conflict").length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted-foreground text-center">Nothing pending. POS is fully in sync.</p>
          ) : (
            <ul className="divide-y divide-border">
              {pending.filter(e => e.status !== "conflict").map(e => <EntryRow key={e.id} entry={e} />)}
            </ul>
          )}
        </div>

        {done.length > 0 && (
          <details className="rounded-xl border border-border bg-card">
            <summary className="px-4 py-3 cursor-pointer font-semibold text-foreground">Recently synced ({done.length})</summary>
            <ul className="divide-y divide-border">
              {done.slice(-50).reverse().map(e => <EntryRow key={e.id} entry={e} />)}
            </ul>
          </details>
        )}
      </div>
    </Layout>
  );
}

function EntryRow({ entry }: { entry: QueueEntry }) {
  const meta = STATUS_META[entry.status];
  return (
    <li className="px-4 py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{entry.label}</span>
          <span className={cn("text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full", meta.cls)}>{meta.label}</span>
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{entry.scope}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {entry.method} {entry.path} · queued {formatDistanceToNow(entry.createdAt, { addSuffix: true })} · {entry.attempts} attempt{entry.attempts !== 1 ? "s" : ""}
        </p>
        {entry.lastError && (
          <p className="text-xs text-red-600 mt-1">{entry.lastError}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {(entry.status === "failed" || entry.status === "conflict") && (
          <Button size="sm" variant="outline" onClick={() => retryEntry(entry.id)}>
            Retry
          </Button>
        )}
        {(entry.status === "conflict" || entry.status === "done") && (
          <Button size="sm" variant="ghost" onClick={() => removeEntry(entry.id)} title="Discard">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </li>
  );
}

function StatCard({ label, value, tone, icon: Icon }: { label: string; value: string; tone: "green" | "red" | "orange" | "gray"; icon: React.ComponentType<{ className?: string }> }) {
  const toneCls = {
    green:  "bg-green-50 text-green-700 border-green-200",
    red:    "bg-red-50 text-red-700 border-red-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
    gray:   "bg-muted/40 text-foreground border-border",
  }[tone];
  return (
    <div className={cn("rounded-xl border p-4 flex items-center gap-3", toneCls)}>
      <Icon className="w-5 h-5" />
      <div>
        <p className="text-xs uppercase tracking-wide opacity-80">{label}</p>
        <p className="text-lg font-bold">{value}</p>
      </div>
    </div>
  );
}
