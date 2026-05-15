import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  HardDrive, Database, Server, RefreshCw, Trash2, Download, Save, AlertTriangle,
  CheckCircle, XCircle, Clock, Cloud, FolderArchive, Settings as Cog, RotateCcw,
  Box, Activity, PlayCircle, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiAction, getApiUrl } from "@/lib/api";

type BackupType = "db" | "files" | "full";
type BackupDestination = "local" | "s3" | "dropbox" | "gdrive";
type BackupStatus = "pending" | "running" | "completed" | "failed";

interface Backup {
  id: number;
  type: BackupType;
  destination: BackupDestination;
  filePath: string | null;
  remoteKey: string | null;
  size: number;
  status: BackupStatus;
  error: string | null;
  source: string;
  createdBy: number | null;
  createdAt: string;
  completedAt: string | null;
}

interface Schedule {
  id: number;
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly";
  timeOfDay: string;
  retentionCount: number;
  includes: BackupType;
  destination: BackupDestination;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

interface S3Settings {
  enabled: boolean;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
}

interface SystemStatus {
  cron: { name: string; schedule: string; lastRunAt: string | null; nextRunAt: string | null; status: "ok" | "failed" | "pending"; lastError?: string | null }[];
  queue: { pending: number; processing: number; failed: number; recentFailures: { broadcastId: number; channel: string; error: string | null; createdAt: string }[] };
  storage: { backupsBytes: number; uploadsBytes: number; diskTotalBytes: number; diskFreeBytes: number; s3Bytes: number | null; s3Configured: boolean };
  app: { version: string; commit: string | null; buildDate: string | null; buildEnv: string };
  environment: { nodeVersion: string; envName: string; uptimeSeconds: number; hostname: string; dbOk: boolean; objectStorageOk: boolean };
}

function fmtBytes(n: number): string {
  if (!n || n < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString();
}

function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400); secs %= 86400;
  const h = Math.floor(secs / 3600); secs %= 3600;
  const m = Math.floor(secs / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const STATUS_TONE: Record<BackupStatus, string> = {
  pending: "bg-slate-100 text-slate-700",
  running: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

const TYPE_LABEL: Record<BackupType, string> = { db: "Database", files: "Files", full: "Full" };
const DEST_LABEL: Record<BackupDestination, string> = { local: "Local disk", s3: "Amazon S3", dropbox: "Dropbox", gdrive: "Google Drive" };

export default function AdminMaintenance() {
  return (
    <div className="space-y-6">
      <BackupsCard />
      <ScheduleCard />
      <DestinationsCard />
      <ActionsCard />
      <SystemStatusCard />
    </div>
  );
}

// ─── Backups ──────────────────────────────────────────────────────
function BackupsCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ data: Backup[] }>({
    queryKey: ["maint", "backups"],
    queryFn: () => apiFetch("/admin/maintenance/backups"),
    refetchInterval: 5000,
  });
  const create = useMutation({
    mutationFn: (body: { type: BackupType; destination: BackupDestination }) =>
      apiAction<Backup>("/admin/maintenance/backups", "POST", body),
    onSuccess: r => {
      toast({ title: r.status === "completed" ? "Backup created" : `Backup ${r.status}`, description: r.error ?? undefined, variant: r.status === "failed" ? "destructive" : undefined });
      void qc.invalidateQueries({ queryKey: ["maint", "backups"] });
    },
    onError: (e: Error) => toast({ title: "Backup failed", description: e.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (id: number) => apiAction(`/admin/maintenance/backups/${id}`, "DELETE"),
    onSuccess: () => { toast({ title: "Backup deleted" }); void qc.invalidateQueries({ queryKey: ["maint", "backups"] }); },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const [destination, setDestination] = useState<BackupDestination>("local");
  const [restoreFor, setRestoreFor] = useState<Backup | null>(null);
  const [restoreText, setRestoreText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Backup | null>(null);
  const restoring = useMutation({
    mutationFn: (id: number) => apiAction<{ ok: boolean }>(`/admin/maintenance/backups/${id}/restore`, "POST", { confirm: "RESTORE" }),
    onSuccess: () => toast({ title: "Restore submitted" }),
    onError: (e: Error) => toast({ title: "Restore not enabled", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FolderArchive className="h-5 w-5 text-orange-500" />
          <h3 className="font-semibold">Backups</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="text-sm border border-border rounded-md px-2 py-1.5 bg-background" value={destination} onChange={e => setDestination(e.target.value as BackupDestination)}>
            <option value="local">Local disk</option>
            <option value="s3">Amazon S3</option>
            <option value="dropbox" disabled>Dropbox (coming soon)</option>
            <option value="gdrive" disabled>Google Drive (coming soon)</option>
          </select>
          <Button size="sm" variant="outline" disabled={create.isPending} onClick={() => create.mutate({ type: "db", destination })}>
            <Database className="h-4 w-4 mr-1" /> Backup database
          </Button>
          <Button size="sm" variant="outline" disabled={create.isPending} onClick={() => create.mutate({ type: "files", destination })}>
            <HardDrive className="h-4 w-4 mr-1" /> Backup files
          </Button>
          <Button size="sm" disabled={create.isPending} onClick={() => create.mutate({ type: "full", destination })} className="bg-orange-500 hover:bg-orange-600">
            {create.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-1" />} Full backup
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2">Type</th>
              <th className="text-left px-4 py-2">Destination</th>
              <th className="text-left px-4 py-2">Size</th>
              <th className="text-left px-4 py-2">Created</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-right px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!isLoading && data?.data.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No backups yet — create one above.</td></tr>
            )}
            {data?.data.map(b => (
              <tr key={b.id} className="border-t border-border">
                <td className="px-4 py-2 font-medium">{TYPE_LABEL[b.type]}</td>
                <td className="px-4 py-2">{DEST_LABEL[b.destination]} <span className="text-xs text-muted-foreground">({b.source})</span></td>
                <td className="px-4 py-2 tabular-nums">{fmtBytes(b.size)}</td>
                <td className="px-4 py-2 text-xs">{fmtDate(b.createdAt)}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_TONE[b.status]}`}>{b.status}</span>
                  {b.error && <div className="text-xs text-red-600 mt-1 max-w-md truncate" title={b.error}>{b.error}</div>}
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-1">
                    {b.status === "completed" && (
                      <a href={getApiUrl(`/admin/maintenance/backups/${b.id}/download`)}
                         onClick={async (e) => {
                           e.preventDefault();
                           const tok = localStorage.getItem("tt_access_token");
                           const res = await fetch(getApiUrl(`/admin/maintenance/backups/${b.id}/download`), {
                             headers: tok ? { Authorization: `Bearer ${tok}` } : {},
                           });
                           if (!res.ok) { toast({ title: "Download failed", variant: "destructive" }); return; }
                           const blob = await res.blob();
                           const url = URL.createObjectURL(blob);
                           const a = document.createElement("a");
                           a.href = url;
                           const cd = res.headers.get("content-disposition");
                           const m = cd && /filename="?([^"]+)"?/.exec(cd);
                           a.download = m?.[1] ?? `backup-${b.id}`;
                           a.click();
                           URL.revokeObjectURL(url);
                         }}>
                        <Button size="sm" variant="ghost"><Download className="h-4 w-4" /></Button>
                      </a>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => { setRestoreFor(b); setRestoreText(""); }}>
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(b)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AlertDialog open={confirmDelete !== null} onOpenChange={open => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              The backup file will be permanently removed{confirmDelete?.remoteKey ? " (including the S3 object)" : ""}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirmDelete) del.mutate(confirmDelete.id); setConfirmDelete(null); }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={restoreFor !== null} onOpenChange={open => !open && setRestoreFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" /> Restore backup
            </AlertDialogTitle>
            <AlertDialogDescription>
              <p className="mb-2">
                Restoring will <strong>overwrite all current platform data</strong> with the contents of this backup.
                This cannot be undone. Type <code className="px-1 py-0.5 bg-muted rounded">RESTORE</code> below to confirm.
              </p>
              <Input value={restoreText} onChange={e => setRestoreText(e.target.value)} placeholder="RESTORE" />
              <p className="text-xs text-muted-foreground mt-2">
                Note: Restore is not yet enabled in this build. Submitting will record the request and surface the engineering contact message.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoreText !== "RESTORE"}
              onClick={() => { if (restoreFor) restoring.mutate(restoreFor.id); setRestoreFor(null); }}>
              Confirm restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Schedule ─────────────────────────────────────────────────────
function ScheduleCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Schedule>({
    queryKey: ["maint", "schedule"],
    queryFn: () => apiFetch("/admin/maintenance/schedule"),
  });
  const save = useMutation({
    mutationFn: (body: Partial<Schedule>) => apiAction<Schedule>("/admin/maintenance/schedule", "PUT", body),
    onSuccess: () => { toast({ title: "Schedule saved" }); void qc.invalidateQueries({ queryKey: ["maint", "schedule"] }); },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const [draft, setDraft] = useState<Partial<Schedule>>({});
  const eff = { ...data, ...draft } as Schedule | undefined;
  const set = (patch: Partial<Schedule>) => setDraft(d => ({ ...d, ...patch }));

  if (isLoading || !eff) {
    return <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Loading schedule…</div>;
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Clock className="h-5 w-5 text-orange-500" />
        <h3 className="font-semibold">Scheduled backup</h3>
      </div>
      <div className="p-5 grid gap-4 md:grid-cols-3">
        <div className="md:col-span-3 flex items-center justify-between">
          <Label>Run automatic backups</Label>
          <Switch checked={!!eff.enabled} onCheckedChange={v => set({ enabled: v })} />
        </div>
        <div>
          <Label>Frequency</Label>
          <select className="w-full text-sm border border-border rounded-md px-2 py-2 bg-background" value={eff.frequency} onChange={e => set({ frequency: e.target.value as Schedule["frequency"] })}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div>
          <Label>Time of day</Label>
          <Input type="time" value={eff.timeOfDay} onChange={e => set({ timeOfDay: e.target.value })} />
        </div>
        <div>
          <Label>Retention (keep last N)</Label>
          <Input type="number" min={1} max={365} value={eff.retentionCount} onChange={e => set({ retentionCount: Number(e.target.value) })} />
        </div>
        <div>
          <Label>What to include</Label>
          <select className="w-full text-sm border border-border rounded-md px-2 py-2 bg-background" value={eff.includes} onChange={e => set({ includes: e.target.value as BackupType })}>
            <option value="db">Database only</option>
            <option value="files">Files only</option>
            <option value="full">Database + files</option>
          </select>
        </div>
        <div>
          <Label>Destination</Label>
          <select className="w-full text-sm border border-border rounded-md px-2 py-2 bg-background" value={eff.destination} onChange={e => set({ destination: e.target.value as BackupDestination })}>
            <option value="local">Local disk</option>
            <option value="s3">Amazon S3</option>
            <option value="dropbox" disabled>Dropbox (coming soon)</option>
            <option value="gdrive" disabled>Google Drive (coming soon)</option>
          </select>
        </div>
        <div className="md:col-span-3 flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-3">
          <span>Last run: {fmtDate(eff.lastRunAt)} · Next run: {fmtDate(eff.nextRunAt)}</span>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(draft)}>
            <Save className="h-4 w-4 mr-1" /> Save schedule
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Destinations ─────────────────────────────────────────────────
function DestinationsCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery<S3Settings>({
    queryKey: ["maint", "s3"],
    queryFn: () => apiFetch("/admin/maintenance/destinations/s3"),
  });
  const [draft, setDraft] = useState<Partial<S3Settings>>({});
  const eff = { ...data, ...draft } as S3Settings | undefined;
  const set = (p: Partial<S3Settings>) => setDraft(d => ({ ...d, ...p }));

  const save = useMutation({
    mutationFn: (body: Partial<S3Settings>) => apiAction<S3Settings>("/admin/maintenance/destinations/s3", "PUT", body),
    onSuccess: () => { toast({ title: "S3 settings saved" }); setDraft({}); void qc.invalidateQueries({ queryKey: ["maint", "s3"] }); },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
  const test = useMutation({
    mutationFn: (body: Partial<S3Settings>) => apiAction<{ ok: boolean; error?: string }>("/admin/maintenance/destinations/s3/test", "POST", body),
    onSuccess: r => toast({ title: r.ok ? "S3 connection OK" : "S3 connection failed", description: r.error, variant: r.ok ? undefined : "destructive" }),
    onError: (e: Error) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  if (!eff) return null;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Cloud className="h-5 w-5 text-orange-500" />
        <h3 className="font-semibold">Storage destinations</h3>
      </div>
      <div className="p-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border p-4 bg-muted/20">
          <div className="flex items-center gap-2 mb-1">
            <HardDrive className="h-4 w-4 text-slate-600" />
            <p className="font-medium">Local disk</p>
            <Badge variant="outline" className="ml-auto">Always on</Badge>
          </div>
          <p className="text-xs text-muted-foreground">Backups are written to the server's backup directory and served via the download endpoint.</p>
        </div>

        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 mb-2">
            <Cloud className="h-4 w-4 text-orange-500" />
            <p className="font-medium">Amazon S3</p>
            <div className="ml-auto flex items-center gap-2">
              <Label className="text-xs">Enabled</Label>
              <Switch checked={!!eff.enabled} onCheckedChange={v => set({ enabled: v })} />
            </div>
          </div>
          <div className="grid gap-2 grid-cols-2">
            <div className="col-span-2"><Label className="text-xs">Bucket</Label><Input value={eff.bucket ?? ""} onChange={e => set({ bucket: e.target.value })} /></div>
            <div><Label className="text-xs">Region</Label><Input value={eff.region ?? ""} onChange={e => set({ region: e.target.value })} /></div>
            <div><Label className="text-xs">Prefix</Label><Input value={eff.prefix ?? ""} onChange={e => set({ prefix: e.target.value })} /></div>
            <div><Label className="text-xs">Access key ID</Label><Input value={eff.accessKeyId ?? ""} onChange={e => set({ accessKeyId: e.target.value })} /></div>
            <div><Label className="text-xs">Secret access key</Label><Input type="password" value={eff.secretAccessKey ?? ""} onChange={e => set({ secretAccessKey: e.target.value })} placeholder="********" /></div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate(draft)}>
              <Activity className="h-4 w-4 mr-1" /> Test connection
            </Button>
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(draft)}>
              <Save className="h-4 w-4 mr-1" /> Save
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-dashed border-border p-4 bg-muted/10 opacity-70">
          <div className="flex items-center gap-2 mb-1">
            <Box className="h-4 w-4 text-slate-500" />
            <p className="font-medium">Dropbox</p>
            <Badge variant="secondary" className="ml-auto">Coming soon</Badge>
          </div>
          <p className="text-xs text-muted-foreground">Dropbox destination will be available in a future release.</p>
        </div>

        <div className="rounded-lg border border-dashed border-border p-4 bg-muted/10 opacity-70">
          <div className="flex items-center gap-2 mb-1">
            <Box className="h-4 w-4 text-slate-500" />
            <p className="font-medium">Google Drive</p>
            <Badge variant="secondary" className="ml-auto">Coming soon</Badge>
          </div>
          <p className="text-xs text-muted-foreground">Google Drive destination will be available in a future release.</p>
        </div>
      </div>
    </div>
  );
}

// ─── Maintenance actions ──────────────────────────────────────────
function ActionsCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirmClear, setConfirmClear] = useState(false);
  const clearCache = useMutation({
    mutationFn: () => apiAction<{ cleared: number }>("/admin/maintenance/cache/clear", "POST"),
    onSuccess: r => { toast({ title: `Cleared ${r.cleared} cache entries` }); void qc.invalidateQueries({ queryKey: ["maint", "status"] }); },
    onError: (e: Error) => toast({ title: "Clear failed", description: e.message, variant: "destructive" }),
  });
  const retry = useMutation({
    mutationFn: () => apiAction<{ retried: number }>("/admin/maintenance/queue/retry-failed", "POST"),
    onSuccess: r => { toast({ title: `Re-queued ${r.retried} failed jobs` }); void qc.invalidateQueries({ queryKey: ["maint", "status"] }); },
    onError: (e: Error) => toast({ title: "Retry failed", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Cog className="h-5 w-5 text-orange-500" />
        <h3 className="font-semibold">Maintenance actions</h3>
      </div>
      <div className="p-5 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setConfirmClear(true)} disabled={clearCache.isPending}>
          <RefreshCw className="h-4 w-4 mr-1" /> Clear server cache
        </Button>
        <Button variant="outline" onClick={() => retry.mutate()} disabled={retry.isPending}>
          <RotateCcw className="h-4 w-4 mr-1" /> Retry failed background jobs
        </Button>
      </div>
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear server cache?</AlertDialogTitle>
            <AlertDialogDescription>
              This drops all in-memory cached values on the API server. Subsequent requests will recompute from source — performance may dip briefly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmClear(false); clearCache.mutate(); }}>Clear cache</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── System status ────────────────────────────────────────────────
function SystemStatusCard() {
  const { data } = useQuery<SystemStatus>({
    queryKey: ["maint", "status"],
    queryFn: () => apiFetch("/admin/maintenance/status"),
    refetchInterval: 10000,
  });
  if (!data) return <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Loading status…</div>;

  const diskUsedPct = data.storage.diskTotalBytes ? Math.round(((data.storage.diskTotalBytes - data.storage.diskFreeBytes) / data.storage.diskTotalBytes) * 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Server className="h-5 w-5 text-orange-500" />
        <h3 className="font-semibold">System status</h3>
      </div>
      <div className="p-5 grid gap-4 lg:grid-cols-2">
        <StatusBox title="Cron jobs" icon={Clock}>
          {data.cron.length === 0 && <p className="text-xs text-muted-foreground">No registered jobs.</p>}
          <ul className="text-sm space-y-1">
            {data.cron.map(j => (
              <li key={j.name} className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs">{j.name}</span>
                <span className="text-xs text-muted-foreground flex-1 px-2">{j.schedule}</span>
                <Badge variant={j.status === "ok" ? "default" : j.status === "failed" ? "destructive" : "secondary"} className="text-xs">{j.status}</Badge>
                <span className="text-xs text-muted-foreground hidden md:inline">{j.lastRunAt ? new Date(j.lastRunAt).toLocaleTimeString() : "—"}</span>
              </li>
            ))}
          </ul>
        </StatusBox>

        <StatusBox title="Background queues" icon={Activity}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Pending" value={data.queue.pending} tone="text-slate-700" />
            <Stat label="Processing" value={data.queue.processing} tone="text-amber-700" />
            <Stat label="Failed" value={data.queue.failed} tone="text-red-700" />
          </div>
          {data.queue.recentFailures.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-muted-foreground cursor-pointer">Recent failures</summary>
              <ul className="mt-1 text-xs space-y-1 max-h-32 overflow-auto">
                {data.queue.recentFailures.map((f, i) => (
                  <li key={i}>· {f.channel} broadcast #{f.broadcastId}: <span className="text-red-600">{f.error ?? "unknown"}</span></li>
                ))}
              </ul>
            </details>
          )}
        </StatusBox>

        <StatusBox title="Storage usage" icon={HardDrive}>
          <ul className="text-sm space-y-1">
            <li className="flex justify-between"><span className="text-muted-foreground">Backups folder</span><span className="tabular-nums">{fmtBytes(data.storage.backupsBytes)}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Uploads folder</span><span className="tabular-nums">{fmtBytes(data.storage.uploadsBytes)}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Disk used</span><span className="tabular-nums">{fmtBytes(data.storage.diskTotalBytes - data.storage.diskFreeBytes)} / {fmtBytes(data.storage.diskTotalBytes)} ({diskUsedPct}%)</span></li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">Amazon S3</span>
              <span className="tabular-nums">{data.storage.s3Configured ? fmtBytes(data.storage.s3Bytes ?? 0) : "Not configured"}</span>
            </li>
          </ul>
        </StatusBox>

        <StatusBox title="App version" icon={Box}>
          <ul className="text-sm space-y-1">
            <li className="flex justify-between"><span className="text-muted-foreground">Version</span><span>{data.app.version}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Commit / deploy</span><span className="font-mono text-xs">{data.app.commit ?? "—"}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Build date</span><span>{data.app.buildDate ?? "—"}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Build env</span><span>{data.app.buildEnv}</span></li>
          </ul>
        </StatusBox>

        <StatusBox title="Environment" icon={Server}>
          <ul className="text-sm space-y-1">
            <li className="flex justify-between"><span className="text-muted-foreground">Node</span><span>{data.environment.nodeVersion}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Env</span><span>{data.environment.envName}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Hostname</span><span className="font-mono text-xs">{data.environment.hostname}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Uptime</span><span>{fmtUptime(data.environment.uptimeSeconds)}</span></li>
            <li className="flex justify-between items-center">
              <span className="text-muted-foreground">Database</span>
              {data.environment.dbOk ? <Badge variant="default" className="text-xs gap-1"><CheckCircle className="h-3 w-3" /> ok</Badge> : <Badge variant="destructive" className="text-xs gap-1"><XCircle className="h-3 w-3" /> down</Badge>}
            </li>
            <li className="flex justify-between items-center">
              <span className="text-muted-foreground">Object storage</span>
              {data.environment.objectStorageOk ? <Badge variant="default" className="text-xs gap-1"><CheckCircle className="h-3 w-3" /> ok</Badge> : <Badge variant="destructive" className="text-xs gap-1"><XCircle className="h-3 w-3" /> down</Badge>}
            </li>
          </ul>
        </StatusBox>
      </div>
    </div>
  );
}

function StatusBox({ title, icon: Icon, children }: { title: string; icon: typeof Clock; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-4 bg-muted/10">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-orange-500" />
        <p className="font-medium text-sm">{title}</p>
      </div>
      {children}
    </div>
  );
}
function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
