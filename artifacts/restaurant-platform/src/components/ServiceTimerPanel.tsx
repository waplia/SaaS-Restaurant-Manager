import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";

interface TimerEvent {
  id: number;
  orderId: number;
  stage: string;
  occurredAt: string;
  durationMs: number | null;
}

const STAGES = ["placed", "accepted", "kot_fired", "preparing", "ready", "served", "billed"] as const;

const fmtDur = (ms: number | null) => {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
};

export function ServiceTimerPanel({ orderId }: { orderId: number | null | undefined }) {
  const restaurantId = useRestaurantId();
  const enabled = !!orderId && !!restaurantId;
  const { data = [] } = useQuery<TimerEvent[]>({
    queryKey: ["ops", "service-timer", restaurantId, orderId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/ops/service-timer/orders/${orderId}`),
    enabled,
    refetchInterval: 5_000,
  });
  if (!enabled) return null;
  const byStage = new Map<string, TimerEvent>();
  for (const e of data) byStage.set(e.stage, e);
  return (
    <div className="rounded border p-2 text-xs space-y-1 bg-muted/30">
      <div className="font-medium uppercase text-muted-foreground tracking-wide">Service timer</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {STAGES.map(s => {
          const ev = byStage.get(s);
          return (
            <div key={s} className="flex justify-between">
              <span className={ev ? "text-foreground" : "text-muted-foreground"}>{s}</span>
              <span className="tabular-nums text-muted-foreground">{ev ? fmtDur(ev.durationMs) : "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
