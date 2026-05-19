import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { api } from "@/lib/api";

type Status = { subscribed: boolean; orderUpdatesOptIn?: boolean; marketingOptIn?: boolean };

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export default function PushOptIn({ customerId }: { customerId?: number | null }) {
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (!ok) return;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) { setStatus({ subscribed: false }); return; }
        setEndpoint(sub.endpoint);
        const s = await api<Status>(`/public/push/status?endpoint=${encodeURIComponent(sub.endpoint)}`);
        setStatus(s);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  async function enable() {
    setBusy(true); setError(null);
    try {
      if (Notification.permission === "denied") throw new Error("Notifications are blocked in your browser settings.");
      const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Permission was not granted.");
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await api<{ publicKey: string | null }>("/public/push/vapid-public-key");
      if (!publicKey) throw new Error("Web Push is not configured by the platform yet.");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
      await api("/public/push/subscribe", {
        method: "POST",
        body: JSON.stringify({
          subscription: { endpoint: json.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } },
          customerId: customerId ?? undefined,
          audience: "customers",
          orderUpdatesOptIn: true,
          marketingOptIn: false,
        }),
      });
      setEndpoint(json.endpoint);
      setStatus({ subscribed: true, orderUpdatesOptIn: true, marketingOptIn: false });
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe().catch(() => {});
        await api("/public/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      }
      setStatus({ subscribed: false });
      setEndpoint(null);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function togglePref(field: "orderUpdatesOptIn" | "marketingOptIn", value: boolean) {
    if (!endpoint || !status?.subscribed) return;
    setStatus({ ...status, [field]: value });
    try {
      await api("/public/push/subscription", {
        method: "PATCH",
        body: JSON.stringify({ endpoint, [field]: value }),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!supported) {
    return (
      <div className="card p-5 mt-4">
        <div className="flex items-center gap-3">
          <BellOff size={20} className="text-zinc-400" />
          <div>
            <p className="font-medium">Browser notifications</p>
            <p className="text-xs text-zinc-500">Your browser doesn't support Web Push.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-5 mt-4 space-y-4">
      <div className="flex items-center gap-3">
        <Bell size={20} className="text-[rgb(var(--primary))]" />
        <div className="flex-1">
          <p className="font-medium">Browser notifications</p>
          <p className="text-xs text-zinc-500">Get instant updates when your order is ready.</p>
        </div>
        {status?.subscribed ? (
          <button onClick={disable} disabled={busy} className="text-sm text-red-600 underline disabled:opacity-50">Disable</button>
        ) : (
          <button onClick={enable} disabled={busy} className="btn-primary px-3 py-1.5 text-sm">{busy ? "…" : "Enable"}</button>
        )}
      </div>
      {status?.subscribed && (
        <div className="space-y-2 pt-2 border-t border-zinc-100">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Order status updates</span>
            <input type="checkbox" checked={!!status.orderUpdatesOptIn} onChange={e => togglePref("orderUpdatesOptIn", e.target.checked)} />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Offers & marketing</span>
            <input type="checkbox" checked={!!status.marketingOptIn} onChange={e => togglePref("marketingOptIn", e.target.checked)} />
          </label>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
