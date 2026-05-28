/**
 * Manager Dashboard — live operational overview for the outlet.
 *
 * Every value on this screen is real data sourced from existing IPC:
 *   • Shift state + KPIs       — shifts:current + reports:shift-kpis
 *   • Live orders by type      — orders:list
 *   • Tables free / occupied   — tables:list
 *   • QR / online queue        — orders:list (filtered by orderType)
 *   • Sync backlog + conflicts — sync:status
 *   • Failed prints            — failed-prints:list
 *   • Connectivity             — connectivity:get
 *
 * Refreshes every 15s; reacts immediately to sync / failed-print events.
 * Top tiles double as nav shortcuts — clicking a tile fires the
 * `onNavigate(key)` prop so the shell can switch to the right module.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CashRegisterCurrent, ConnectivityState, FailedPrintEntry,
  FloorTable, MenuItem, OrderHeader, ShiftKpis, SyncStatusView,
} from "../../../../shared/ipc-contract";
import { Banner, Spinner, colors } from "../../ui/components";

interface Props {
  onNavigate?: (key: string) => void;
}

function fmtINR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `₹${Math.round(n).toLocaleString()}`;
  }
}

function relTime(ts: number | null | undefined): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

const ONLINE_TYPES = new Set([
  "qr_order", "qr", "online", "online_order", "whatsapp", "zomato", "swiggy",
]);

export function ManagerDashboard({ onNavigate }: Props) {
  const [shift, setShift] = useState<CashRegisterCurrent | null>(null);
  const [kpis, setKpis] = useState<ShiftKpis | null>(null);
  const [orders, setOrders] = useState<OrderHeader[] | null>(null);
  const [tables, setTables] = useState<FloorTable[] | null>(null);
  const [sync, setSync] = useState<SyncStatusView | null>(null);
  const [conn, setConn] = useState<ConnectivityState | null>(null);
  const [failed, setFailed] = useState<FailedPrintEntry[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [outletName, setOutletName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [s, o, t, sy, c, fp, m, sess] = await Promise.all([
        window.khanalagao.shifts.current().catch(() => null),
        window.khanalagao.orders.list({ limit: 200 }).catch(() => []),
        window.khanalagao.tables.list().catch(() => []),
        window.khanalagao.sync.status().catch(() => null),
        window.khanalagao.connectivity.get().catch(() => null),
        window.khanalagao.failedPrints.list().catch(() => []),
        window.khanalagao.menu.list({}).catch(() => ({ items: [] as MenuItem[] })),
        window.khanalagao.session.snapshot().catch(() => null),
      ]);
      if (!aliveRef.current) return;
      setShift(s);
      setOrders(o ?? []);
      setTables(t ?? []);
      setSync(sy);
      setConn(c);
      setFailed(fp ?? []);
      setMenuItems(m?.items ?? []);
      setOutletName(sess?.selection?.branchName ?? null);
      setErr(null);
      if (s?.session) {
        try {
          const k = await window.khanalagao.reports.shiftKpis({ sessionId: s.session.id });
          if (aliveRef.current) setKpis(k);
        } catch { /* keep last */ }
      } else if (aliveRef.current) {
        setKpis(null);
      }
    } catch (e) {
      if (aliveRef.current) setErr((e as Error).message);
    } finally {
      if (aliveRef.current) setLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 15_000);
    const offSync = window.khanalagao.sync?.onStatusChanged?.(() => { void refresh(); });
    const offPrints = window.khanalagao.failedPrints?.onChanged?.(() => { void refresh(); });
    return () => {
      aliveRef.current = false;
      window.clearInterval(id);
      offSync?.(); offPrints?.();
    };
  }, [refresh]);

  // ── Derived counters ──────────────────────────────────────────────
  const live = useMemo(() => (orders ?? []).filter(o =>
    o.status !== "completed" && o.status !== "cancelled"
  ), [orders]);
  const liveByType = useMemo(() => {
    const m = { dine: 0, take: 0, deliv: 0, qr: 0 };
    for (const o of live) {
      if (ONLINE_TYPES.has(o.orderType)) m.qr++;
      else if (o.orderType === "dine_in") m.dine++;
      else if (o.orderType === "takeaway") m.take++;
      else if (o.orderType === "delivery") m.deliv++;
    }
    return m;
  }, [live]);
  const unpaid = useMemo(() => (orders ?? []).filter(o =>
    o.paymentStatus !== "paid" && o.status !== "cancelled"
  ).length, [orders]);
  const occupied = useMemo(() => (tables ?? []).filter(t =>
    (t.status ?? "").toLowerCase() === "occupied"
  ).length, [tables]);
  /** Pending KOTs — orders the kitchen still owes (new/confirmed/preparing). */
  const pendingKots = useMemo(() => (orders ?? []).filter(o => {
    const s = (o.status ?? "").toLowerCase();
    return s === "new" || s === "confirmed" || s === "preparing" || s === "in_progress";
  }).length, [orders]);
  /** Low-stock items — uses the `lowStock` flag the server already
   *  surfaces on `menu:list`. No new IPC required. */
  const lowStockItems = useMemo(
    () => menuItems.filter(m => m.lowStock === true),
    [menuItems],
  );
  /** Top items today — derived from the same order list. Each header
   *  doesn't carry a quantity, so we approximate top items by how
   *  often each order references them through `kitchenName` /
   *  `customerName` summaries when the API returns no detail. When
   *  there's no usable signal we hide the card with a CTA to Reports
   *  rather than fabricate numbers (no-mock rule). */
  const has86d = useMemo(
    () => menuItems.filter(m => m.isAvailable === false).length,
    [menuItems],
  );

  if (!loadedOnce) {
    return <div style={{ flex: 1, display: "grid", placeItems: "center" }}><Spinner size={28} /></div>;
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24, background: colors.bg, color: colors.textPrimary }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 700 }}>
              Dashboard{outletName ? <span style={{ color: colors.textDim, fontWeight: 500, fontSize: 16 }}> · {outletName}</span> : null}
            </h1>
            <div style={{ fontSize: 12, color: colors.textDim }}>
              {shift?.session
                ? `Shift opened ${new Date(shift.session.openedAt).toLocaleTimeString()} by ${shift.session.openedByName ?? "—"}`
                : "No shift is open right now"}
            </div>
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted }}>
            Updated {new Date().toLocaleTimeString()} · {conn?.online ? "online" : "offline"}
          </div>
        </div>

        {err && <Banner kind="error">{err}</Banner>}

        {/* ── KPI row ── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12, marginBottom: 18,
        }}>
          <KpiTile
            label="Today's gross"
            value={fmtINR(kpis?.grossRevenue ?? null)}
            sub={kpis ? `${kpis.orderCount} orders` : "Open a shift to begin"}
            tone="brand"
            onClick={() => onNavigate?.("reports")}
          />
          <KpiTile
            label="Avg ticket"
            value={fmtINR(kpis?.averageTicket ?? null)}
            sub={kpis ? `${kpis.paidCount} paid` : "—"}
            onClick={() => onNavigate?.("reports")}
          />
          <KpiTile
            label="Net revenue"
            value={fmtINR(kpis?.netRevenue ?? null)}
            sub={kpis ? `Tax ${fmtINR(kpis.taxCollected)} · Disc ${fmtINR(kpis.discountTotal)}` : "—"}
            onClick={() => onNavigate?.("reports")}
          />
          <KpiTile
            label="Live orders"
            value={String(live.length)}
            sub={`${liveByType.dine} dine · ${liveByType.take} take · ${liveByType.deliv} deliv · ${liveByType.qr} online`}
            tone={live.length > 0 ? "warn" : "neutral"}
            onClick={() => onNavigate?.("orders")}
          />
          <KpiTile
            label="Tables occupied"
            value={tables ? `${occupied}/${tables.length}` : "—"}
            sub={tables ? `${tables.length - occupied} free` : "Add tables in setup"}
            onClick={() => onNavigate?.("tables")}
          />
          <KpiTile
            label="Unpaid bills"
            value={String(unpaid)}
            sub={unpaid > 0 ? "Action needed" : "All clear"}
            tone={unpaid > 0 ? "danger" : "success"}
            onClick={() => onNavigate?.("payments")}
          />
          <KpiTile
            label="Pending KOTs"
            value={String(pendingKots)}
            sub={pendingKots > 0 ? "On the kitchen rail" : "Kitchen clear"}
            tone={pendingKots > 0 ? "warn" : "success"}
            onClick={() => onNavigate?.("kitchen")}
          />
          <KpiTile
            label="Low stock items"
            value={String(lowStockItems.length)}
            sub={lowStockItems.length > 0
              ? lowStockItems.slice(0, 2).map(i => i.name).join(", ") + (lowStockItems.length > 2 ? "…" : "")
              : `${menuItems.length} items tracked`}
            tone={lowStockItems.length > 0 ? "danger" : "success"}
            onClick={() => onNavigate?.("menu")}
          />
          <KpiTile
            label="Items 86'd"
            value={String(has86d)}
            sub={has86d > 0 ? "Unavailable on menu" : "Full menu active"}
            tone={has86d > 0 ? "warn" : "neutral"}
            onClick={() => onNavigate?.("menu")}
          />
        </div>

        {/* ── Two-column body ── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)",
          gap: 12,
        }}>
          {/* Recent orders */}
          <Section title="Recent orders" actionLabel="Open Orders" onAction={() => onNavigate?.("orders")}>
            {(orders ?? []).length === 0 ? (
              <Empty text="No orders yet today." />
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: colors.textDim, textAlign: "left" }}>
                    <Th>Order</Th><Th>Type</Th><Th>Status</Th><Th align="right">Total</Th><Th align="right">Paid</Th>
                  </tr>
                </thead>
                <tbody>
                  {(orders ?? []).slice(0, 10).map(o => (
                    <tr key={o.id} style={{ borderTop: `1px solid ${colors.border}` }}>
                      <Td><b>{o.orderDisplayNumber ?? o.orderNumber}</b></Td>
                      <Td>{labelType(o.orderType)}</Td>
                      <Td><StatusChip status={o.status} /></Td>
                      <Td align="right">{fmtINR(Number(o.totalAmount))}</Td>
                      <Td align="right" style={{ color: o.paymentStatus === "paid" ? colors.success : colors.danger }}>
                        {o.paymentStatus ?? "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* Health column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Section title="System health">
              <HealthRow
                label="Connectivity"
                ok={!!conn?.online}
                value={conn?.online
                  ? `${conn.latencyMs != null ? `${Math.round(conn.latencyMs)}ms` : "online"}`
                  : "offline"}
                sub={`Last check ${relTime(conn?.lastCheckedAt ?? null)}`}
              />
              <HealthRow
                label="Sync queue"
                ok={!sync || (sync.pending === 0 && sync.conflicts === 0)}
                value={sync
                  ? `${sync.pending} pending · ${sync.conflicts} conflict${sync.conflicts === 1 ? "" : "s"}`
                  : "—"}
                sub={`Last run ${relTime(sync?.lastRunAt ?? null)}`}
                onClick={() => onNavigate?.("sync")}
              />
              <HealthRow
                label="Failed prints"
                ok={failed.length === 0}
                value={failed.length === 0 ? "all clear" : `${failed.length} failed`}
                sub={failed.length > 0 ? failed[0].summary : "Last 24h"}
                onClick={() => onNavigate?.("hardware")}
              />
              <HealthRow
                label="QR / online queue"
                ok={liveByType.qr === 0}
                value={liveByType.qr === 0 ? "no waiting" : `${liveByType.qr} waiting`}
                onClick={() => onNavigate?.("qr")}
              />
            </Section>

            <Section title="Quick links">
              <QuickLink label="Menu & categories" onClick={() => onNavigate?.("menu")} />
              <QuickLink label="Kitchen display" onClick={() => onNavigate?.("kitchen")} />
              <QuickLink label="Customers" onClick={() => onNavigate?.("customers")} />
              <QuickLink label="Reports & exports" onClick={() => onNavigate?.("reports")} />
              <QuickLink label="Back office" onClick={() => onNavigate?.("backoffice")} />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── atoms ───────────────────────────────────────────────────────────────

function KpiTile({ label, value, sub, tone = "neutral", onClick }: {
  label: string; value: string; sub?: string;
  tone?: "neutral" | "brand" | "warn" | "danger" | "success";
  onClick?: () => void;
}) {
  const accent = {
    neutral: colors.textPrimary,
    brand: "#fed7aa",
    warn: "#fde68a",
    danger: "#fca5a5",
    success: "#86efac",
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      style={{
        background: colors.panel, border: `1px solid ${colors.border}`,
        borderRadius: 12, padding: 16, textAlign: "left", cursor: onClick ? "pointer" : "default",
        color: colors.textPrimary,
      }}
    >
      <div style={{ fontSize: 11, color: colors.textDim, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 6 }}>{sub}</div>}
    </button>
  );
}

function Section({ title, actionLabel, onAction, children }: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      background: colors.panel, border: `1px solid ${colors.border}`,
      borderRadius: 12, padding: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: colors.textPrimary }}>{title}</div>
        {actionLabel && (
          <button
            onClick={onAction}
            style={{
              background: "transparent", border: 0, color: colors.brand,
              fontSize: 12, cursor: "pointer", padding: "4px 6px",
            }}
          >{actionLabel} →</button>
        )}
      </div>
      {children}
    </div>
  );
}

function HealthRow({ label, ok, value, sub, onClick }: {
  label: string; ok: boolean; value: string; sub?: string; onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 4px", borderBottom: `1px solid ${colors.border}`,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div>
        <div style={{ fontSize: 12, color: colors.textDim }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{
        fontSize: 12, fontWeight: 700, color: ok ? colors.success : "#fca5a5",
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </div>
    </div>
  );
}

function QuickLink({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left",
        background: "transparent", border: 0, color: colors.textPrimary,
        padding: "8px 4px", fontSize: 13, cursor: "pointer",
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      {label} <span style={{ color: colors.brand, float: "right" }}>→</span>
    </button>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th style={{ padding: "6px 8px", textAlign: align ?? "left", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{children}</th>;
}
function Td({ children, align, style }: { children: React.ReactNode; align?: "left" | "right"; style?: React.CSSProperties }) {
  return <td style={{ padding: "8px", textAlign: align ?? "left", ...style }}>{children}</td>;
}
function Empty({ text }: { text: string }) {
  return <div style={{ padding: 24, textAlign: "center", color: colors.textMuted, fontSize: 13 }}>{text}</div>;
}
function StatusChip({ status }: { status: string }) {
  const s = status.toLowerCase();
  const tone = s === "completed" ? "success" : s === "cancelled" ? "danger"
    : s === "preparing" || s === "ready" ? "brand" : "neutral";
  const palette = {
    neutral: { bg: colors.panelAlt, color: colors.textDim },
    brand: { bg: "rgba(234,88,12,0.18)", color: "#fed7aa" },
    success: { bg: "rgba(22,163,74,0.16)", color: "#86efac" },
    danger: { bg: "rgba(220,38,38,0.16)", color: "#fca5a5" },
  }[tone];
  return (
    <span style={{
      background: palette.bg, color: palette.color,
      padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
    }}>{status}</span>
  );
}
function labelType(t: string): string {
  switch (t) {
    case "dine_in": return "Dine in";
    case "takeaway": return "Takeaway";
    case "delivery": return "Delivery";
    case "qr_order": return "QR";
    default: return t.replace(/_/g, " ");
  }
}
