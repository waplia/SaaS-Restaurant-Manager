import { useEffect, useState } from "react";
import { useParams, useSearch } from "wouter";
import { CheckCircle2, Clock, ChefHat, Bell, Utensils } from "lucide-react";

interface TrackData {
  order: {
    id: number;
    orderNumber: string;
    status: string;
    paymentStatus: string;
    totalAmount: string;
    customerName: string | null;
    createdAt: string;
    orderType?: string;
    vehicleColor?: string | null;
    vehicleModel?: string | null;
    vehicleNumber?: string | null;
    parkingSpot?: string | null;
    curbsideArrivedAt?: string | null;
    curbsideHandedOverAt?: string | null;
  };
  tickets: Array<{ id: number; status: string; kitchenId: number | null }>;
  items: Array<{ id: number; name: string; quantity: number; status: string | null }>;
  timeline: Array<{ step: string; label: string; at: string | null }>;
}

const STEP_ICONS: Record<string, any> = {
  placed: Clock,
  preparing: ChefHat,
  ready: Bell,
  served: Utensils,
  arrived: Bell,
};

export default function OrderTrackPage() {
  const params = useParams<{ orderId: string }>();
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") ?? "";
  const orderId = Number(params.orderId);
  const [data, setData] = useState<TrackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arriving, setArriving] = useState(false);
  const [arriveError, setArriveError] = useState<string | null>(null);
  const [spotOverride, setSpotOverride] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/public/orders/${orderId}/track?token=${encodeURIComponent(token)}`);
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        const j = await res.json() as TrackData;
        if (!cancelled) { setData(j); setError(null); }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    void load();
    const i = window.setInterval(load, 8000);
    return () => { cancelled = true; window.clearInterval(i); };
  }, [orderId, token]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 grid place-items-center p-6">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow p-6 text-center">
          <div className="text-red-600 font-semibold text-lg">Can't load your order</div>
          <div className="text-sm text-muted-foreground mt-2">{error}</div>
          <div className="text-xs text-muted-foreground mt-4">If you scanned a printed receipt, please ask the staff for help.</div>
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="min-h-screen bg-slate-50 grid place-items-center text-slate-500">Loading your order…</div>;
  }

  const lastDone = [...data.timeline].reverse().find(t => t.at)?.step ?? "placed";
  const stepIndex = ["placed", "preparing", "ready", "served"].indexOf(lastDone);

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 via-white to-white">
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="text-center mb-6">
          <div className="text-xs uppercase tracking-widest text-orange-600 font-medium">Order Status</div>
          <div className="text-3xl font-bold text-slate-900 mt-1" data-testid="text-order-number">#{data.order.orderNumber}</div>
          {data.order.customerName && (
            <div className="text-sm text-slate-600 mt-1">for {data.order.customerName}</div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-5 mb-4">
          <ol className="space-y-4">
            {data.timeline.map((step, idx) => {
              const Icon = STEP_ICONS[step.step] ?? Clock;
              const done = !!step.at;
              const isCurrent = idx === stepIndex;
              return (
                <li key={step.step} className="flex items-start gap-3" data-testid={`step-${step.step}`}>
                  <div className={`shrink-0 w-9 h-9 rounded-full grid place-items-center ${done ? "bg-emerald-500 text-white" : isCurrent ? "bg-orange-500 text-white animate-pulse" : "bg-slate-100 text-slate-400"}`}>
                    {done ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 pt-1">
                    <div className={`font-medium ${done || isCurrent ? "text-slate-900" : "text-slate-400"}`}>{step.label}</div>
                    {step.at && <div className="text-xs text-slate-500 mt-0.5">{new Date(step.at).toLocaleTimeString()}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {data.order.orderType === "curbside" && (
          <div className="bg-white rounded-2xl shadow-sm p-5 mb-4" data-testid="card-curbside">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest text-orange-600 font-medium">Curbside Pickup</div>
                <div className="text-sm text-slate-700 mt-1">
                  {[data.order.vehicleColor, data.order.vehicleModel].filter(Boolean).join(" ")}
                  {data.order.vehicleNumber ? ` · ${data.order.vehicleNumber}` : ""}
                </div>
                {data.order.parkingSpot && (
                  <div className="text-xs text-slate-500 mt-0.5">Spot: {data.order.parkingSpot}</div>
                )}
              </div>
            </div>

            {data.order.curbsideHandedOverAt ? (
              <div className="mt-4 text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3 text-center font-medium">
                Order handed over — enjoy your meal!
              </div>
            ) : data.order.curbsideArrivedAt ? (
              <div className="mt-4 text-sm text-orange-700 bg-orange-50 rounded-lg p-3 text-center">
                Staff has been notified. They'll bring your order out shortly.
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                <input
                  type="text"
                  inputMode="text"
                  placeholder={data.order.parkingSpot ? `Spot ${data.order.parkingSpot} (change if needed)` : "Parking spot (optional)"}
                  value={spotOverride}
                  onChange={(e) => setSpotOverride(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
                  data-testid="input-parking-spot"
                />
                <button
                  type="button"
                  disabled={arriving}
                  onClick={async () => {
                    setArriving(true);
                    setArriveError(null);
                    try {
                      const res = await fetch(`/api/public/orders/${orderId}/arrive`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ token, parkingSpot: spotOverride || undefined }),
                      });
                      if (!res.ok) {
                        const j = await res.json().catch(() => ({}));
                        throw new Error(j.error ?? `HTTP ${res.status}`);
                      }
                      const r = await fetch(`/api/public/orders/${orderId}/track?token=${encodeURIComponent(token)}`);
                      if (r.ok) setData(await r.json() as TrackData);
                    } catch (e) {
                      setArriveError((e as Error).message);
                    } finally {
                      setArriving(false);
                    }
                  }}
                  className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-semibold rounded-lg py-3 transition"
                  data-testid="button-arrived"
                >
                  {arriving ? "Notifying staff…" : "I've arrived"}
                </button>
                {arriveError && <div className="text-xs text-red-600">{arriveError}</div>}
              </div>
            )}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm p-5 mb-4">
          <div className="text-xs uppercase tracking-widest text-slate-500 mb-3">Your items</div>
          <ul className="space-y-2">
            {data.items.map(it => (
              <li key={it.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-800">{it.quantity}× {it.name}</span>
                {it.status && <span className="text-xs text-slate-400 capitalize">{it.status.replace(/_/g, " ")}</span>}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between mt-4 pt-3 border-t">
            <span className="text-slate-500 text-sm">Total</span>
            <span className="font-bold text-lg text-slate-900">₹{data.order.totalAmount}</span>
          </div>
        </div>

        <div className="text-center text-xs text-slate-400 mt-6">
          Updates automatically · Tap-free live tracking
        </div>
      </div>
    </div>
  );
}
