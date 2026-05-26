import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useWaiterRequests, useAcknowledgeWaiterRequest, useResolveWaiterRequest, useGuestVerifications, useFloorTables } from "@/lib/hooks";
import { GuestVerificationCard } from "@/components/GuestVerificationCard";
import type { FloorTable } from "@/lib/types";
import { AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BellRing, Receipt, GlassWater, MessageSquare, Check, CheckCircle2, Clock, History, ShieldAlert } from "lucide-react";
import { formatDistanceToNow, parseISO, differenceInSeconds } from "date-fns";
import { cn } from "@/lib/utils";
import type { WaiterRequest } from "@/lib/types";

const TYPE_META: Record<WaiterRequest["type"], { label: string; icon: typeof BellRing; color: string }> = {
  call_waiter: { label: "Call Waiter", icon: BellRing, color: "bg-orange-100 text-orange-700 border-orange-300" },
  request_bill: { label: "Request Bill", icon: Receipt, color: "bg-blue-100 text-blue-700 border-blue-300" },
  water: { label: "Water", icon: GlassWater, color: "bg-cyan-100 text-cyan-700 border-cyan-300" },
  custom: { label: "Other", icon: MessageSquare, color: "bg-purple-100 text-purple-700 border-purple-300" },
};

function waitTime(createdAt: string): string {
  const seconds = differenceInSeconds(new Date(), parseISO(createdAt));
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ${seconds % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function urgencyClass(createdAt: string, status: string): string {
  if (status !== "pending") return "";
  const seconds = differenceInSeconds(new Date(), parseISO(createdAt));
  if (seconds > 300) return "ring-2 ring-red-400 animate-pulse";
  if (seconds > 120) return "ring-2 ring-amber-400";
  return "";
}

function RequestCard({ r, onAck, onResolve, busy }: { r: WaiterRequest; onAck: (id: number) => void; onResolve: (id: number) => void; busy: boolean }) {
  const meta = TYPE_META[r.type] ?? TYPE_META.call_waiter;
  const Icon = meta.icon;
  const isResolved = r.status === "resolved";
  return (
    <div className={cn(
      "border-2 rounded-xl p-4 bg-card transition-all",
      isResolved ? "border-border opacity-60" : "border-border shadow-sm",
      urgencyClass(r.createdAt, r.status),
    )}>
      <div className="flex items-start gap-3">
        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 border", meta.color)}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-foreground text-base">Table {r.tableNumber ?? r.tableId}</p>
            <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full border", meta.color)}>{meta.label}</span>
            {r.status === "acknowledged" && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 border border-yellow-300">Acknowledged</span>
            )}
            {r.status === "resolved" && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-800 border border-green-300">Resolved</span>
            )}
          </div>
          {r.note && <p className="text-sm text-muted-foreground mt-1 break-words">"{r.note}"</p>}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {waitTime(r.createdAt)} ago</span>
            {r.acknowledgedByName && r.status !== "resolved" && (
              <span>Ack'd by {r.acknowledgedByName}</span>
            )}
            {r.status === "resolved" && r.resolvedAt && (
              <span>Resolved {formatDistanceToNow(parseISO(r.resolvedAt), { addSuffix: true })}</span>
            )}
          </div>
        </div>
        {!isResolved && (
          <div className="flex flex-col gap-2">
            {r.status === "pending" && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onAck(r.id)} className="gap-1.5">
                <Check className="w-3.5 h-3.5" /> Acknowledge
              </Button>
            )}
            <Button size="sm" disabled={busy} onClick={() => onResolve(r.id)} className="gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Resolve
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function WaiterRequestsPage() {
  const { data: requests = [] } = useWaiterRequests();
  const { data: heldVerifications = [] } = useGuestVerifications();
  const { data: tables = [] } = useFloorTables();
  const ack = useAcknowledgeWaiterRequest();
  const resolve = useResolveWaiterRequest();
  const { toast } = useToast();
  const [showHistory, setShowHistory] = useState(false);

  const tableLabelById = useMemo(() => {
    const m = new Map<number, string>();
    (tables as FloorTable[]).forEach(t => m.set(t.id, t.tableNumber));
    return m;
  }, [tables]);

  const { active, history, pendingCount } = useMemo(() => {
    const active = requests.filter(r => r.status !== "resolved");
    const history = requests.filter(r => r.status === "resolved");
    const pendingCount = requests.filter(r => r.status === "pending").length;
    return { active, history, pendingCount };
  }, [requests]);

  const busy = ack.isPending || resolve.isPending;

  const handleAck = async (id: number) => {
    try { await ack.mutateAsync(id); }
    catch { toast({ title: "Could not acknowledge request", variant: "destructive" }); }
  };
  const handleResolve = async (id: number) => {
    try { await resolve.mutateAsync(id); toast({ title: "Request resolved" }); }
    catch { toast({ title: "Could not resolve request", variant: "destructive" }); }
  };

  return (
    <Layout>
      <PageHeader
        title="Waiter Requests"
        subtitle={`${pendingCount} pending · ${active.length} active${heldVerifications.length ? ` · ${heldVerifications.length} guest verifications` : ""}`}
      />
      <div className="p-6 max-w-4xl space-y-6">
        {heldVerifications.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-600" />
                Guest Verification ({heldVerifications.length})
              </h2>
            </div>
            <div className="space-y-3">
              {heldVerifications.map(v => (
                <GuestVerificationCard
                  key={v.orderId}
                  v={v}
                  tableLabel={v.tableId != null ? tableLabelById.get(v.tableId) : undefined}
                />
              ))}
            </div>
          </div>
        )}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-foreground">Active Requests</h2>
          </div>
          <div className="space-y-3">
            {active.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-border rounded-xl text-muted-foreground">
                <BellRing className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>No active requests right now.</p>
                <p className="text-xs mt-1">New requests appear here in realtime.</p>
              </div>
            ) : (
              active.map(r => (
                <RequestCard key={r.id} r={r} onAck={handleAck} onResolve={handleResolve} busy={busy} />
              ))
            )}
          </div>
        </div>

        <div>
          <button
            onClick={() => setShowHistory(s => !s)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <History className="w-4 h-4" />
            {showHistory ? "Hide" : "Show"} resolved (last 24h) · {history.length}
          </button>
          {showHistory && (
            <div className="mt-3 space-y-2">
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No resolved requests in the last 24 hours.</p>
              ) : (
                history.map(r => (
                  <RequestCard key={r.id} r={r} onAck={handleAck} onResolve={handleResolve} busy={busy} />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
