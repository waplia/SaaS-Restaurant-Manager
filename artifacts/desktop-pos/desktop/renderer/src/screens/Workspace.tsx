import { useCallback, useEffect, useState } from "react";
import type { SelectionState, User } from "../../../shared/ipc-contract";
import { Button, colors } from "../ui/components";
import { HardwareSettings } from "./HardwareSettings";
import { useScanner } from "../hooks/useScanner";
import { OrderWorkspace } from "./OrderWorkspace";
import { ReportsScreen } from "./ReportsScreen";
import { CloseShiftModal } from "./order/CloseShiftModal";

interface Props {
  user: User;
  selection: SelectionState;
  shiftOpenedAt: string | null;
  online: boolean;
  onOpenSettings: () => void;
  onSignOut: () => void;
  onSwitchOutlet: () => void;
}

const NAV = [
  { key: "orders", label: "Orders", enabled: true },
  { key: "tables", label: "Tables", enabled: false },
  { key: "customers", label: "Customers", enabled: false },
  { key: "reports", label: "Reports", enabled: true },
  { key: "hardware", label: "Hardware", enabled: true },
] as const;

export function WorkspaceScreen(props: Props) {
  const [active, setActive] = useState<typeof NAV[number]["key"]>("orders");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [scannerEnabled, setScannerEnabled] = useState(true);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);
  const [failedCount, setFailedCount] = useState(0);
  const shiftTimer = useShiftTimer(props.shiftOpenedAt);

  // Mirror scanner-enabled state from main so the global hook respects the
  // current setting without a settings-screen round-trip.
  useEffect(() => {
    window.khanalagao.scanner.getState().then((s) => setScannerEnabled(s.enabled)).catch(() => undefined);
    const id = window.setInterval(() => {
      window.khanalagao.scanner.getState().then((s) => setScannerEnabled(s.enabled)).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(id);
  }, []);

  // Failed-prints badge in the topbar — driven by main process events.
  useEffect(() => {
    const sync = () => window.khanalagao.failedPrints.list().then((l) => setFailedCount(l.length)).catch(() => undefined);
    void sync();
    const off = window.khanalagao.failedPrints.onChanged(sync);
    return () => { off(); };
  }, []);

  const onScan = useCallback(async (value: string) => {
    setLastScan(value);
    window.setTimeout(() => setLastScan((cur) => cur === value ? null : cur), 2200);
    // Allow item-grid / customer-modal components to claim a scan via the
    // global `tt:scan` event. `preventDefault()` opts out of the default
    // route (customer lookup for phone-shaped scans, menu lookup otherwise).
    const ev = new CustomEvent("tt:scan", { detail: { value }, cancelable: true });
    const consumed = !window.dispatchEvent(ev);
    if (consumed) return;
    // Default consumer: route to the appropriate IPC and surface the result
    // as a toast. Phone-shaped scans (10+ digits, possibly with separators)
    // match the customer-modal lookup; everything else is treated as an
    // item barcode / SKU and routed to the menu lookup.
    const digits = value.replace(/\D+/g, "");
    const showResult = (kind: "ok" | "warn" | "err", text: string) => {
      setScanResult({ kind, text });
      window.setTimeout(() => setScanResult((cur) => cur?.text === text ? null : cur), 3500);
    };
    try {
      if (digits.length >= 10 && digits.length <= 13) {
        const data = await window.khanalagao.customers.lookup({ phone: digits });
        const list = Array.isArray(data) ? data : Array.isArray((data as { customers?: unknown[] })?.customers) ? (data as { customers: unknown[] }).customers : [];
        if (list.length > 0) {
          const top = list[0] as { name?: string; phone?: string };
          showResult("ok", `Customer · ${top.name ?? "Unknown"}${top.phone ? ` · ${top.phone}` : ""}`);
          window.dispatchEvent(new CustomEvent("tt:scan-customer", { detail: { customer: top, value } }));
        } else {
          showResult("warn", `No customer found for ${digits}`);
        }
      } else {
        const item = await window.khanalagao.menu.lookupByBarcode(value);
        if (item) {
          showResult("ok", `Added · ${item.name} (₹${item.price.toFixed(2)})`);
          window.dispatchEvent(new CustomEvent("tt:scan-item", { detail: { item, value } }));
        } else {
          showResult("warn", `No item matches "${value.slice(0, 24)}"`);
        }
      }
    } catch (err) {
      showResult("err", `Scan failed: ${(err as Error).message}`);
    }
  }, []);

  useScanner({ enabled: scannerEnabled, onScan });

  return (
    <div style={{
      display: "grid",
      gridTemplateRows: "56px 1fr",
      gridTemplateColumns: "200px 1fr",
      gridTemplateAreas: '"topbar topbar" "sidebar main"',
      height: "100vh",
      background: colors.bg,
    }}>
      <header style={{
        gridArea: "topbar",
        display: "flex", alignItems: "center", gap: 16,
        padding: "0 20px",
        background: colors.panel,
        borderBottom: `1px solid ${colors.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: 16 }}>
          <span style={{
            width: 28, height: 28, borderRadius: 6,
            background: colors.brand, color: "#fff",
            display: "grid", placeItems: "center", fontSize: 14,
          }}>K</span>
          Khanalagao POS
        </div>
        <div style={{ width: 1, height: 28, background: colors.border }} />
        <div style={{ fontSize: 13, color: colors.textDim }}>
          <b style={{ color: colors.textPrimary }}>{props.selection.branchName}</b>
          {" · "}
          <span>{props.selection.counterName}</span>
          {" · "}
          <span>{props.user.name}</span>
        </div>

        <div style={{ flex: 1 }} />

        <span title="Shift duration" style={{
          fontSize: 13, color: colors.textDim,
          background: colors.bg, padding: "6px 10px", borderRadius: 6,
          border: `1px solid ${colors.border}`, fontVariantNumeric: "tabular-nums",
        }}>⏱ {shiftTimer}</span>

        {failedCount > 0 && (
          <button
            onClick={() => setActive("hardware")}
            title="Failed print jobs — open Hardware tab"
            style={{
              background: "rgba(220,38,38,0.16)", border: `1px solid rgba(220,38,38,0.5)`,
              color: "#fca5a5", padding: "6px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
            }}
          >⚠ {failedCount} failed print{failedCount === 1 ? "" : "s"}</button>
        )}

        {lastScan && (
          <span style={{
            background: colors.brandSoft, color: "#fff",
            padding: "6px 10px", borderRadius: 6, fontSize: 12, fontFamily: "monospace",
          }}>⌫ {lastScan.length > 16 ? lastScan.slice(0, 16) + "…" : lastScan}</span>
        )}

        {scanResult && (
          <span
            title={scanResult.text}
            style={{
              background: scanResult.kind === "ok" ? "rgba(34,197,94,0.16)"
                : scanResult.kind === "warn" ? "rgba(234,179,8,0.16)"
                : "rgba(220,38,38,0.16)",
              border: `1px solid ${scanResult.kind === "ok" ? "rgba(34,197,94,0.45)"
                : scanResult.kind === "warn" ? "rgba(234,179,8,0.45)"
                : "rgba(220,38,38,0.5)"}`,
              color: scanResult.kind === "ok" ? "#86efac"
                : scanResult.kind === "warn" ? "#fde68a"
                : "#fca5a5",
              padding: "6px 10px", borderRadius: 6, fontSize: 12,
              maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >{scanResult.text}</span>
        )}

        <span title={props.online ? "Online" : "Offline"} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 12, color: props.online ? colors.success : colors.danger,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: props.online ? colors.success : colors.danger,
          }} />
          {props.online ? "Online" : "Offline"}
        </span>

        <div style={{ position: "relative" }}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              background: colors.panelAlt, border: 0, color: colors.textPrimary,
              padding: "8px 12px", borderRadius: 6, cursor: "pointer", fontSize: 13,
            }}
          >{props.user.name.split(" ")[0]} ▾</button>
          {menuOpen && (
            <div
              onMouseLeave={() => setMenuOpen(false)}
              style={{
                position: "absolute", right: 0, top: "calc(100% + 4px)",
                background: colors.panel, border: `1px solid ${colors.border}`,
                borderRadius: 8, minWidth: 200, padding: 6, zIndex: 10,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              }}
            >
              <MenuItem onClick={() => { setMenuOpen(false); props.onSwitchOutlet(); }}>Switch outlet / counter</MenuItem>
              <MenuItem onClick={() => { setMenuOpen(false); props.onOpenSettings(); }}>Connection settings</MenuItem>
              <MenuItem onClick={() => { setMenuOpen(false); setShowCloseShift(true); }}>Close shift…</MenuItem>
              <div style={{ height: 1, background: colors.border, margin: "4px 0" }} />
              <MenuItem danger onClick={() => { setMenuOpen(false); props.onSignOut(); }}>Sign out</MenuItem>
            </div>
          )}
        </div>
      </header>

      <nav style={{
        gridArea: "sidebar",
        background: colors.panel,
        borderRight: `1px solid ${colors.border}`,
        padding: 12,
        display: "flex", flexDirection: "column", gap: 4,
      }}>
        {NAV.map((n) => (
          <button
            key={n.key}
            disabled={!n.enabled}
            onClick={() => n.enabled && setActive(n.key)}
            style={{
              background: active === n.key ? colors.brandSoft : "transparent",
              color: !n.enabled ? colors.textMuted : active === n.key ? "#fff" : colors.textPrimary,
              border: 0, textAlign: "left",
              padding: "10px 14px", borderRadius: 6,
              fontSize: 14, fontWeight: 500,
              cursor: n.enabled ? "pointer" : "not-allowed",
              opacity: n.enabled ? 1 : 0.55,
            }}
          >
            {n.label}
            {!n.enabled && <span style={{ fontSize: 10, marginLeft: 6, opacity: 0.7 }}>(soon)</span>}
          </button>
        ))}
      </nav>

      <main style={{
        gridArea: "main",
        overflow: "hidden",
        display: "flex", flexDirection: "column", minHeight: 0,
      }}>
        {active === "orders" ? (
          <OrderWorkspace />
        ) : active === "reports" ? (
          <ReportsScreen />
        ) : active === "hardware" ? (
          <div style={{ overflow: "auto", padding: 24, flex: 1 }}>
            <HardwareSettings online={props.online} />
          </div>
        ) : (
          <div style={{ display: "grid", placeItems: "center", flex: 1, padding: 24 }}>
            <div style={{ textAlign: "center", maxWidth: 420 }}>
              <h2 style={{ margin: "0 0 12px", fontSize: 22 }}>Coming soon</h2>
              <p style={{ color: colors.textDim, lineHeight: 1.5 }}>
                This area unlocks in a later phase.
              </p>
              <div style={{ marginTop: 20 }}>
                <Button variant="ghost" onClick={() => setActive("orders")}>← Back to Orders</Button>
              </div>
            </div>
          </div>
        )}
      </main>

      {showCloseShift && (
        <CloseShiftModal
          onClose={() => setShowCloseShift(false)}
          onClosed={() => {
            setShowCloseShift(false);
            setActive("reports");
          }}
        />
      )}
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left",
        background: "transparent", border: 0, color: danger ? "#fca5a5" : colors.textPrimary,
        padding: "8px 12px", borderRadius: 6, fontSize: 13, cursor: "pointer",
      }}
    >{children}</button>
  );
}

function useShiftTimer(openedAt: string | null): string {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  void tick;
  if (!openedAt) return "—";
  const ms = Date.now() - new Date(openedAt).getTime();
  if (ms < 0) return "0:00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
