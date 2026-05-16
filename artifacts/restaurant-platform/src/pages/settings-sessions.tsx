import { useCallback, useEffect, useState } from "react";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiGet, apiAction, ApiError } from "@/lib/api";
import { Loader2, Monitor, Shield, LogOut } from "lucide-react";

interface SessionRow {
  id: number;
  deviceLabel: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  isCurrent: boolean;
}

interface SessionsResponse { sessions: SessionRow[] }

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return d.toLocaleDateString();
}

export default function SettingsSessionsPage() {
  const { logout } = useAuth();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<SessionsResponse>("/auth/sessions");
      setSessions(data.sessions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const revoke = useCallback(async (row: SessionRow) => {
    if (busyId) return;
    if (!confirm(row.isCurrent
      ? "Sign out this device? You'll be returned to the login screen."
      : `Sign out "${row.deviceLabel ?? "this device"}"? It will need to log in again.`)) return;
    setBusyId(row.id);
    try {
      await apiAction(`/auth/sessions/${row.id}`, "DELETE");
      if (row.isCurrent) {
        // Revoking our own session — drop local credentials and bounce.
        logout();
        return;
      }
      toast({ title: "Signed out", description: row.deviceLabel ?? `Session ${row.id}` });
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed";
      toast({ title: "Couldn't sign out device", description: msg, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }, [busyId, load, logout, toast]);

  const signOutEverywhere = useCallback(() => {
    if (!confirm("Sign out everywhere? Every device — including this one — will be signed out.")) return;
    logout();
  }, [logout]);

  return (
    <SettingsLayout
      activeKey="roles"
      title="Active sessions"
      subtitle="Devices currently signed in to your account."
      actions={
        <Button variant="outline" size="sm" onClick={signOutEverywhere} data-testid="button-signout-everywhere">
          <LogOut className="w-4 h-4 mr-2" />
          Sign out everywhere
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
          <Shield className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>
            If you don't recognise a device, sign it out immediately and change your password.
            "Sign out everywhere" invalidates every active token across all devices in one click.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading sessions…
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No active sessions found.
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border bg-card" data-testid="sessions-list">
            {sessions.map(s => (
              <li key={s.id} className="p-4 flex items-start gap-3" data-testid={`session-row-${s.id}`}>
                <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                  <Monitor className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground truncate">
                      {s.deviceLabel ?? "Unknown device"}
                    </span>
                    {s.isCurrent && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                        This device
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                    <div>
                      {s.ip ? <span data-testid={`session-ip-${s.id}`}>{s.ip}</span> : <span>Unknown IP</span>}
                      <span> · Last active {formatWhen(s.lastUsedAt)}</span>
                      <span> · Signed in {formatWhen(s.createdAt)}</span>
                    </div>
                    {s.userAgent && (
                      <div className="font-mono text-[10px] text-muted-foreground/80 truncate" title={s.userAgent}>
                        {s.userAgent}
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  variant={s.isCurrent ? "outline" : "ghost"}
                  size="sm"
                  onClick={() => void revoke(s)}
                  disabled={busyId === s.id}
                  data-testid={`button-revoke-${s.id}`}
                >
                  {busyId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Sign out"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsLayout>
  );
}
