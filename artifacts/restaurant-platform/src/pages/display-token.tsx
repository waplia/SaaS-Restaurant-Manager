import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";
import { io, type Socket } from "socket.io-client";

interface TokenItem {
  id: number;
  token: string;
  number: number;
  counter: number;
  status: string;
  customerName: string | null;
  orderType: string;
  branchId: number | null;
  recalledCount: number;
}

interface DisplayPayload {
  restaurantId: number;
  branchId: number | null;
  branchName: string | null;
  settings: {
    prefix: string;
    padding: number;
    defaultCounter: number;
    recallTtsEnabled: boolean;
    showCustomerName: boolean;
  };
  waiting: TokenItem[];
  ready: TokenItem[];
  served: TokenItem[];
}

function useUrl(restaurantId: string, branchId: string): string {
  return `/api/public/display/token/${restaurantId}/${branchId}`;
}

function chime(): void {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.setValueAtTime(1320, ctx.currentTime + 0.18);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    o.connect(g); g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.65);
  } catch { /* ignore */ }
}

function speak(text: string): void {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.9; u.pitch = 1; u.volume = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

export default function DisplayTokenPage() {
  const params = useParams<{ outletId: string }>();
  // outletId can be `<restaurantId>:<branchId>` or `<restaurantId>:all`.
  const [restaurantId, branchId] = (params.outletId ?? "").split(":");
  const url = useUrl(restaurantId, branchId);
  const [data, setData] = useState<DisplayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState<boolean>(() => localStorage.getItem("tt_token_display_muted") === "1");
  const socketRef = useRef<Socket | null>(null);
  const lastReadyIdsRef = useRef<Set<number>>(new Set());

  const refresh = useMemo(() => async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json() as DisplayPayload;
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [url]);

  useEffect(() => {
    void refresh();
    const i = window.setInterval(refresh, 15000);
    return () => window.clearInterval(i);
  }, [refresh]);

  // Socket.io live updates — guest connection (no auth).
  useEffect(() => {
    if (!restaurantId) return;
    const socket = io("", {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      socket.emit("join:tokens", { restaurantId: Number(restaurantId), branchId: branchId === "all" ? "all" : Number(branchId) });
    });
    const handler = () => { void refresh(); };
    socket.on("token:new", handler);
    socket.on("token:update", handler);
    socket.on("token:reset", handler);
    socket.on("token:recall", (payload: TokenItem) => {
      void refresh();
      if (!muted && data?.settings.recallTtsEnabled) {
        chime();
        speak(`Token ${payload.token}, please collect at counter ${payload.counter}.`);
      } else if (!muted) {
        chime();
      }
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [restaurantId, branchId, refresh, muted, data?.settings.recallTtsEnabled]);

  // Announce newly-ready tokens.
  useEffect(() => {
    if (!data) return;
    const currentIds = new Set(data.ready.map(t => t.id));
    const newlyReady = data.ready.filter(t => !lastReadyIdsRef.current.has(t.id));
    lastReadyIdsRef.current = currentIds;
    if (muted) return;
    for (const t of newlyReady) {
      chime();
      if (data.settings.recallTtsEnabled) {
        speak(`Token ${t.token}, please collect at counter ${t.counter}.`);
      }
    }
  }, [data, muted]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localStorage.setItem("tt_token_display_muted", next ? "1" : "0");
  }

  if (error) {
    return <div className="min-h-screen bg-black text-red-400 grid place-items-center text-2xl p-8">Display unavailable: {error}</div>;
  }
  if (!data) {
    return <div className="min-h-screen bg-black text-white grid place-items-center text-3xl">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-6 font-sans">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-sm uppercase tracking-widest text-slate-400">Order Status</div>
          <div className="text-3xl font-bold">{data.branchName ?? "All Outlets"}</div>
        </div>
        <button onClick={toggleMute} className="text-sm bg-white/10 hover:bg-white/20 rounded-full px-4 py-2" data-testid="button-mute-display">
          {muted ? "🔇 Unmute" : "🔊 Mute"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Section title="Now Serving" tokens={data.ready} accent="bg-emerald-500/20 border-emerald-500/40" big highlight />
        <Section title="Preparing" tokens={data.waiting} accent="bg-amber-500/10 border-amber-500/30" />
      </div>

      {data.served.length > 0 && (
        <div className="mt-8">
          <div className="text-sm uppercase tracking-widest text-slate-400 mb-2">Recently Served</div>
          <div className="flex flex-wrap gap-3">
            {data.served.map(t => (
              <div key={t.id} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-xl font-mono">
                {t.token}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-10 text-center text-xs text-slate-500">Updated automatically • TableTrack token display</div>
    </div>
  );
}

function Section({ title, tokens, accent, big, highlight }: { title: string; tokens: TokenItem[]; accent: string; big?: boolean; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl border ${accent} p-5`}>
      <div className="text-sm uppercase tracking-widest text-slate-300 mb-3">{title}</div>
      {tokens.length === 0 ? (
        <div className="text-slate-500 italic py-12 text-center">— None —</div>
      ) : (
        <div className={`grid gap-3 ${big ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}>
          {tokens.slice(0, big ? 6 : 12).map(t => (
            <div
              key={t.id}
              className={`rounded-xl bg-black/40 border border-white/10 p-4 ${highlight ? "animate-pulse" : ""}`}
              data-testid={`token-card-${t.id}`}
            >
              <div className={`font-mono font-extrabold ${big ? "text-6xl" : "text-4xl"} text-white`}>{t.token}</div>
              {t.customerName && (
                <div className="text-slate-300 text-sm mt-1">{t.customerName}</div>
              )}
              <div className="flex items-center justify-between mt-2 text-xs text-slate-400">
                <span className="capitalize">{t.orderType.replace("_", " ")}</span>
                {highlight && <span className="text-emerald-400 font-semibold">Counter {t.counter}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
