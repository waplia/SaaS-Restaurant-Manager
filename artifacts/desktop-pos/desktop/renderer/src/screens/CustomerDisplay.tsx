/**
 * Customer-display second-screen view.
 *
 * Renders fullscreen on whatever monitor the cashier drags the second
 * window onto. Listens on a BroadcastChannel for the active cart so the
 * customer can follow along while items are rung up.
 *
 * No backend dependency — all data comes from the cashier window.
 */
import { useEffect, useState } from "react";

interface DisplayPayload {
  items: Array<{ name: string; quantity: number; price: number; lineTotal: number }>;
  subtotal: number;
  tax: number;
  service: number;
  discount: number;
  total: number;
  tendered?: number;
  change?: number;
  orderNumber?: string | null;
  tableLabel?: string | null;
  customerName?: string | null;
  cashierName?: string | null;
  tagline?: string;
  status?: "active" | "paid" | "idle";
}

const fmtINR = (n: number) =>
  "₹" + (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CustomerDisplay() {
  const [data, setData] = useState<DisplayPayload>({
    items: [], subtotal: 0, tax: 0, service: 0, discount: 0, total: 0,
    tagline: "Welcome — Thank you for dining with us",
    status: "idle",
  });

  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel("kp:customer-display");
      ch.onmessage = (e) => {
        if (e.data && typeof e.data === "object") setData(prev => ({ ...prev, ...e.data }));
      };
      ch.postMessage({ type: "ready" });
    } catch { /* unsupported */ }
    const onUnload = () => { try { ch?.close(); } catch { /* ignore */ } };
    window.addEventListener("beforeunload", onUnload);
    return () => { onUnload(); window.removeEventListener("beforeunload", onUnload); };
  }, []);

  const isIdle = !data.items?.length && data.status !== "paid";

  return (
    <div style={{
      position: "fixed", inset: 0, background: "linear-gradient(180deg, #0f1520 0%, #050810 100%)",
      color: "#fff", display: "flex", flexDirection: "column",
      fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
      overflow: "hidden",
    }}>
      <header style={{
        padding: "26px 40px",
        background: "linear-gradient(180deg, rgba(234,88,12,0.18) 0%, transparent 100%)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        display: "flex", alignItems: "center", gap: 18,
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 12,
          background: "linear-gradient(135deg,#ea580c,#c2410c)",
          display: "grid", placeItems: "center", fontSize: 28, fontWeight: 800,
        }}>K</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5 }}>KhanaLagao</div>
          <div style={{ fontSize: 14, color: "#94a3b8", marginTop: 2 }}>
            {data.tableLabel ?? (data.orderNumber ? `Order #${data.orderNumber}` : "Customer display")}
            {data.cashierName ? ` · Served by ${data.cashierName}` : ""}
          </div>
        </div>
        {data.status === "paid" && (
          <div style={{
            fontSize: 16, fontWeight: 700, padding: "8px 18px", borderRadius: 999,
            background: "rgba(22,163,74,0.2)", color: "#86efac",
            border: "1px solid rgba(22,163,74,0.45)",
          }}>✓ Paid · Thank you</div>
        )}
      </header>

      {isIdle ? (
        <div style={{ flex: 1, display: "grid", placeItems: "center", textAlign: "center", padding: 40 }}>
          <div>
            <div style={{ fontSize: 96, marginBottom: 24 }}>🍽️</div>
            <div style={{ fontSize: 48, fontWeight: 800, marginBottom: 16, letterSpacing: -1 }}>
              {data.tagline ?? "Welcome"}
            </div>
            <div style={{ fontSize: 18, color: "#94a3b8" }}>
              Your order will appear here as items are added.
            </div>
          </div>
        </div>
      ) : (
        <main style={{ flex: 1, display: "grid", gridTemplateRows: "1fr auto", overflow: "hidden" }}>
          <div style={{ overflowY: "auto", padding: "20px 40px" }}>
            {data.items.map((it, i) => (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "60px 1fr 110px 130px",
                gap: 14, padding: "14px 0",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                fontSize: 20, alignItems: "center",
              }}>
                <span style={{ fontWeight: 800, color: "#fb923c", fontSize: 22 }}>{it.quantity}×</span>
                <span>{it.name}</span>
                <span style={{ textAlign: "right", color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>
                  {fmtINR(it.price)}
                </span>
                <span style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {fmtINR(it.lineTotal)}
                </span>
              </div>
            ))}
          </div>
          <div style={{
            background: "rgba(13,18,27,0.95)", borderTop: "1px solid rgba(255,255,255,0.08)",
            padding: "24px 40px", display: "grid", gap: 6,
          }}>
            <Row label="Subtotal" value={fmtINR(data.subtotal)} />
            {data.discount > 0 && <Row label="Discount" value={`− ${fmtINR(data.discount)}`} />}
            {data.tax > 0 && <Row label="Tax" value={fmtINR(data.tax)} />}
            {data.service > 0 && <Row label="Service" value={fmtINR(data.service)} />}
            <div style={{
              display: "flex", justifyContent: "space-between", marginTop: 10,
              paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.12)",
              fontSize: 36, fontWeight: 800,
            }}>
              <span>Total</span>
              <span style={{ color: "#fb923c", fontVariantNumeric: "tabular-nums" }}>{fmtINR(data.total)}</span>
            </div>
            {data.tendered != null && data.tendered > 0 && (
              <>
                <Row label="Tendered" value={fmtINR(data.tendered)} muted />
                <Row label="Change" value={fmtINR(data.change ?? 0)} muted highlight />
              </>
            )}
          </div>
        </main>
      )}
    </div>
  );
}

function Row({ label, value, muted, highlight }: { label: string; value: string; muted?: boolean; highlight?: boolean }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      fontSize: muted ? 16 : 18, color: muted ? "#94a3b8" : "#e2e8f0",
    }}>
      <span>{label}</span>
      <span style={{
        fontVariantNumeric: "tabular-nums", fontWeight: 600,
        color: highlight ? "#86efac" : undefined,
      }}>{value}</span>
    </div>
  );
}

/** Cashier-side helper: broadcast the cart state to any open display window. */
export function broadcastDisplay(payload: Partial<DisplayPayload>): void {
  try {
    const ch = new BroadcastChannel("kp:customer-display");
    ch.postMessage(payload);
    ch.close();
  } catch { /* ignore */ }
}
