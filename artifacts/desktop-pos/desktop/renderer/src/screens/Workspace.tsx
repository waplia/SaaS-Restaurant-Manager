/**
 * Premium desktop POS shell.
 *
 * Layout:
 *   ┌────────────────────────── topbar (status header) ──────────────────────────┐
 *   │  ☰  KhanaLagao · Outlet · Counter · Cashier   ⏱ shift · ₹ today · ● online  │
 *   │                                                ⚠ prints · ⟳ sync · ⛶ · 👤 ▾ │
 *   ├──────┬────────────────────────────────────────────────────────────────────┤
 *   │ NAV  │  active module (POS / Orders / Tables / Kitchen / QR / …)         │
 *   │ rail │                                                                    │
 *   ├──────┴────────────────────────────────────────────────────────────────────┤
 *   │  bottom shortcut bar — F2 Search · F4 Send · F8 Pay · ? Help …            │
 *   └────────────────────────────────────────────────────────────────────────────┘
 *
 * The sidebar uses large labeled icons with the active item highlighted in
 * the brand orange and unread badges (live orders, new QR orders, failed
 * prints). The footer surfaces the keyboard contract so a new cashier can
 * learn the terminal without leaving the POS screen.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SelectionState, User } from "../../../shared/ipc-contract";
import { Button, colors } from "../ui/components";
import { HardwareSettings } from "./HardwareSettings";
import { useScanner } from "../hooks/useScanner";
import { OrderWorkspace, type WorkspaceHandoff } from "./OrderWorkspace";
import { ReportsScreen } from "./ReportsScreen";
import { TablesScreen } from "./TablesScreen";
import { CustomersScreen } from "./CustomersScreen";
import { QrOrdersPanel } from "./QrOrdersPanel";
import { KitchenScreen } from "./KitchenScreen";
import { PaymentsScreen } from "./PaymentsScreen";
import { ShiftScreen } from "./ShiftScreen";
import { AppSettingsScreen } from "./AppSettingsScreen";
import { CloseShiftModal } from "./order/CloseShiftModal";
import { SyncPanel } from "./order/SyncPanel";
import { FailedPrintsModal } from "./order/FailedPrintsModal";
import { CashMovementModal, type CashMovementKind } from "./order/CashMovementModal";
import { HelpModal } from "./order/Modals";
import { useAppPrefs, hashPin } from "../hooks/useAppPrefs";
import { fmtINR } from "./order/types";
import { ManagerPinModal } from "./ManagerPinModal";
import { broadcastDisplay } from "./CustomerDisplay";

interface Props {
  user: User;
  selection: SelectionState;
  shiftOpenedAt: string | null;
  online: boolean;
  onOpenSettings: () => void;
  onSignOut: () => void;
  onSwitchOutlet: () => void;
}

type NavKey =
  | "pos" | "orders" | "tables" | "kitchen" | "qr" | "customers"
  | "payments" | "shift" | "hardware" | "reports" | "settings";

interface NavEntry {
  key: NavKey;
  label: string;
  icon: React.ReactNode;
}

const NAV: NavEntry[] = [
  { key: "pos", label: "POS", icon: <IconPos /> },
  { key: "orders", label: "Orders", icon: <IconOrders /> },
  { key: "tables", label: "Tables", icon: <IconTables /> },
  { key: "kitchen", label: "Kitchen", icon: <IconKitchen /> },
  { key: "qr", label: "QR orders", icon: <IconQr /> },
  { key: "customers", label: "Customers", icon: <IconCustomers /> },
  { key: "payments", label: "Payments", icon: <IconPayments /> },
  { key: "shift", label: "Shift", icon: <IconShift /> },
  { key: "hardware", label: "Hardware", icon: <IconHardware /> },
  { key: "reports", label: "Reports", icon: <IconReports /> },
  { key: "settings", label: "Settings", icon: <IconSettings /> },
];

const SHORTCUTS: Array<[string, string]> = [
  ["F2", "Search"], ["F3", "Customer"], ["F4", "Send"], ["F5", "Hold"],
  ["F6", "KOT"], ["F7", "Print"], ["F8", "Pay"], ["F9", "Drawer"],
  ["F10", "Close shift"], ["Ctrl+P", "Print"], ["Ctrl+Enter", "Pay"],
  ["Ctrl+N", "New"], ["?", "Help"],
];

/** Which nav items each role can see. Manager sees everything. */
const ROLE_NAV: Record<"cashier" | "waiter" | "manager", Set<NavKey>> = {
  manager: new Set(["pos","orders","tables","kitchen","qr","customers","payments","shift","hardware","reports","settings"]),
  cashier: new Set(["pos","orders","tables","kitchen","qr","customers","payments","shift","reports","settings"]),
  waiter:  new Set(["pos","orders","tables","kitchen","qr","customers","settings"]),
};

export function WorkspaceScreen(props: Props) {
  const { prefs: appPrefs } = useAppPrefs();
  const [active, setActive] = useState<NavKey>(appPrefs.startInPos ? "pos" : "orders");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [locked, setLocked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pendingOps, setPendingOps] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [scannerEnabled, setScannerEnabled] = useState(true);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);
  const [failedCount, setFailedCount] = useState(0);
  const [showFailedPrints, setShowFailedPrints] = useState(false);
  const [cashMovement, setCashMovement] = useState<CashMovementKind | null>(null);
  const [handoff, setHandoff] = useState<WorkspaceHandoff | null>(null);
  const [updateBanner, setUpdateBanner] = useState<{ kind: "info" | "ready"; text: string } | null>(null);
  const [pinGate, setPinGate] = useState<{ reason: string; onAllow: () => void } | null>(null);

  // Badge counters refreshed every 12s — keeps the rail informative without
  // hammering the API. Live = unpaid in-progress orders. New QR = unsettled
  // online/QR orders. Today's sales = sum of paid orders in the open shift.
  const [liveOrderCount, setLiveOrderCount] = useState(0);
  const [newQrCount, setNewQrCount] = useState(0);
  const [todaysSales, setTodaysSales] = useState<number | null>(null);

  const openInOrders = useCallback((h: WorkspaceHandoff) => {
    setHandoff(h);
    setActive("pos");
  }, []);
  const shiftTimer = useShiftTimer(props.shiftOpenedAt);

  // Mirror scanner-enabled state from main.
  useEffect(() => {
    window.khanalagao.scanner.getState().then((s) => setScannerEnabled(s.enabled)).catch(() => undefined);
    const id = window.setInterval(() => {
      window.khanalagao.scanner.getState().then((s) => setScannerEnabled(s.enabled)).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(id);
  }, []);

  // Failed-prints badge.
  useEffect(() => {
    const sync = () => window.khanalagao.failedPrints.list().then((l) => setFailedCount(l.length)).catch(() => undefined);
    void sync();
    const off = window.khanalagao.failedPrints.onChanged(sync);
    return () => { off(); };
  }, []);

  // Pending / conflict pills mirror the sync engine.
  useEffect(() => {
    const sync = async () => {
      try {
        const s = await window.khanalagao.sync.status();
        setPendingOps(s.pending); setConflictCount(s.conflicts);
      } catch { /* ignore — until main is ready */ }
    };
    void sync();
    const off = window.khanalagao.sync.onStatusChanged(sync);
    return () => { off(); };
  }, []);

  // Sidebar badges + today's sales — single poll keeps it cheap.
  useEffect(() => {
    let alive = true;
    const ONLINE_TYPES = new Set([
      "qr_order", "qr", "online", "online_order", "whatsapp", "zomato", "swiggy",
    ]);
    const tick = async () => {
      try {
        const orders = await window.khanalagao.orders.list({ limit: 150 });
        if (!alive) return;
        const live = orders.filter(o => o.status !== "completed" && o.status !== "cancelled");
        setLiveOrderCount(live.length);
        setNewQrCount(live.filter(o => ONLINE_TYPES.has(o.orderType) && o.paymentStatus !== "paid").length);
      } catch { /* keep last known */ }
      try {
        const cur = await window.khanalagao.shifts.current();
        if (!alive) return;
        if (cur.session) {
          const k = await window.khanalagao.reports.shiftKpis({ sessionId: cur.session.id });
          if (alive) setTodaysSales(k.grossRevenue);
        } else {
          setTodaysSales(null);
        }
      } catch { /* keep last known */ }
    };
    void tick();
    const id = window.setInterval(tick, 12_000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  // Fullscreen toggle — uses the browser fullscreen API in dev and the
  // Electron BrowserWindow.setFullScreen in production via IPC if available.
  const toggleFullscreen = useCallback(() => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    const isFs = !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
    try {
      if (isFs) {
        (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc);
        setIsFullscreen(false);
      } else {
        (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
        setIsFullscreen(true);
      }
    } catch { /* not supported — silently ignored */ }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Global keyboard shortcuts — '?' help, F10 close shift, F9 drawer kick,
  // F6 reprint last KOT (forwarded to the order workspace via custom event),
  // Ctrl+P print, Ctrl+Enter pay. Input fields are exempt so cashiers can
  // still type. The other F-keys (F2/F3/F4/F5/F7/F8) are handled inside
  // OrderWorkspace which owns the cart state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && /^(INPUT|TEXTAREA|SELECT)$/i.test(tgt.tagName)) return;
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); setShowHelp(v => !v); return;
      }
      if (e.key === "F10") {
        e.preventDefault(); setShowCloseShift(true); return;
      }
      if (e.key === "F9") {
        e.preventDefault();
        window.khanalagao.drawer.open().catch(err => {
          window.alert(`Drawer kick failed: ${(err as Error).message}`);
        });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("tt:shortcut", { detail: { key: "print" } }));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("tt:shortcut", { detail: { key: "pay" } }));
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto-update lifecycle — main pushes events ("checking", "available",
  // "downloaded", "error"). Show a non-blocking banner so the cashier can
  // restart at a quiet moment.
  useEffect(() => {
    if (!window.khanalagao.updates?.onEvent) return;
    const off = window.khanalagao.updates.onEvent((ev) => {
      const e = ev as { status?: string; version?: string; message?: string };
      if (e.status === "available") {
        setUpdateBanner({ kind: "info", text: `Update ${e.version ?? ""} downloading…` });
      } else if (e.status === "downloaded") {
        setUpdateBanner({ kind: "ready", text: `Update ${e.version ?? ""} ready — restart to apply` });
      } else if (e.status === "error") {
        setUpdateBanner({ kind: "info", text: `Update check failed: ${e.message ?? "unknown"}` });
      }
    });
    return () => { off?.(); };
  }, []);

  // Warn before quit/reload when there are unsaved local ops.
  useEffect(() => {
    if (!appPrefs.warnBeforeExit) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingOps === 0 && conflictCount === 0) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [appPrefs.warnBeforeExit, pendingOps, conflictCount]);

  // Apply density via CSS vars on <html>. The components that opt in
  // read these vars; the defaults below ensure no visual change for
  // existing pages until they migrate.
  useEffect(() => {
    const root = document.documentElement;
    const map: Record<typeof appPrefs.density, { pad: string; font: string }> = {
      comfortable: { pad: "12px", font: "14px" },
      compact:     { pad: "8px",  font: "13px" },
      "large-touch": { pad: "18px", font: "16px" },
    };
    const v = map[appPrefs.density];
    root.style.setProperty("--kp-density-pad", v.pad);
    root.style.setProperty("--kp-density-font", v.font);
    root.dataset.theme = appPrefs.theme;
    root.dataset.density = appPrefs.density;
  }, [appPrefs.density, appPrefs.theme]);

  // Auto-launch the customer-display window when enabled. We re-open it
  // on first run; if the cashier closes it, they re-launch from Settings.
  useEffect(() => {
    if (!appPrefs.customerDisplay) return;
    const w = window.open("#display=customer", "kpCustomerDisplay", "popup=yes,width=1280,height=720");
    if (w) broadcastDisplay({ status: "idle", tagline: appPrefs.customerDisplayTagline });
  }, [appPrefs.customerDisplay, appPrefs.customerDisplayTagline]);

  const onScan = useCallback(async (value: string) => {
    setLastScan(value);
    window.setTimeout(() => setLastScan((cur) => cur === value ? null : cur), 2200);
    const ev = new CustomEvent("tt:scan", { detail: { value }, cancelable: true });
    const consumed = !window.dispatchEvent(ev);
    if (consumed) return;
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

  const badgeFor = (k: NavKey): number | null => {
    if (k === "orders" || k === "pos") return liveOrderCount || null;
    if (k === "qr") return newQrCount || null;
    if (k === "hardware") return failedCount || null;
    return null;
  };

  const clock = useClock();

  return (
    <div style={{
      display: "grid",
      gridTemplateRows: "60px 1fr 32px",
      gridTemplateColumns: "112px 1fr",
      gridTemplateAreas: '"topbar topbar" "sidebar main" "bottombar bottombar"',
      height: "100vh",
      background: colors.bg,
      color: colors.textPrimary,
    }}>
      {/* ─── Status header ──────────────────────────────────────────── */}
      <header style={{
        gridArea: "topbar",
        display: "flex", alignItems: "center", gap: 14,
        padding: "0 18px",
        background: "linear-gradient(180deg, #131a26 0%, #0f1520 100%)",
        borderBottom: `1px solid ${colors.border}`,
        boxShadow: "0 1px 0 rgba(255,255,255,0.02), 0 2px 12px rgba(0,0,0,0.25)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: 15 }}>
          <span style={{
            width: 32, height: 32, borderRadius: 8,
            background: `linear-gradient(135deg, ${colors.brand} 0%, ${colors.brandHover} 100%)`,
            color: "#fff",
            display: "grid", placeItems: "center", fontSize: 15,
            boxShadow: `0 2px 8px ${colors.brand}55`,
          }}>K</span>
          KhanaLagao
        </div>

        <div style={{ width: 1, height: 30, background: colors.border }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 1, fontSize: 12 }}>
          <span style={{ fontWeight: 700, color: colors.textPrimary, fontSize: 13 }}>
            {props.selection.branchName}
          </span>
          <span style={{ color: colors.textDim }}>
            {props.selection.counterName} · {props.user.name}
          </span>
        </div>

        <div style={{ flex: 1 }} />

        <Pill title="Shift duration"
          icon="⏱"
          value={shiftTimer}
          tone="neutral"
        />

        {todaysSales !== null && (
          <Pill title="Today's sales (this shift)"
            icon="₹"
            value={fmtINR(todaysSales)}
            tone="brand"
          />
        )}

        {failedCount > 0 && (
          <Pill title="Failed print jobs — click to review"
            icon="⚠"
            value={`${failedCount} print${failedCount === 1 ? "" : "s"}`}
            tone="danger"
            onClick={() => setShowFailedPrints(true)}
          />
        )}

        {(pendingOps > 0 || conflictCount > 0 || !props.online) && (
          <Pill title="Sync status"
            icon={conflictCount > 0 ? "⚑" : "⟳"}
            value={conflictCount > 0
              ? `${conflictCount} conflict${conflictCount === 1 ? "" : "s"}`
              : `${pendingOps} pending`}
            tone={conflictCount > 0 ? "danger" : "warn"}
            onClick={() => setShowSync(true)}
          />
        )}

        {lastScan && (
          <Pill icon="⌫" value={lastScan.length > 16 ? lastScan.slice(0, 16) + "…" : lastScan} tone="brand" />
        )}

        {scanResult && (
          <Pill title={scanResult.text}
            icon={scanResult.kind === "ok" ? "✓" : scanResult.kind === "warn" ? "!" : "✗"}
            value={scanResult.text.length > 36 ? scanResult.text.slice(0, 36) + "…" : scanResult.text}
            tone={scanResult.kind === "ok" ? "success" : scanResult.kind === "warn" ? "warn" : "danger"}
          />
        )}

        <span title={props.online ? "Online" : "Offline — orders queue locally"}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 10px", borderRadius: 999,
            background: props.online ? "rgba(22,163,74,0.12)" : "rgba(220,38,38,0.14)",
            border: `1px solid ${props.online ? "rgba(22,163,74,0.4)" : "rgba(220,38,38,0.5)"}`,
            fontSize: 12, color: props.online ? "#86efac" : "#fca5a5", fontWeight: 600,
          }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: props.online ? colors.success : colors.danger,
            boxShadow: props.online ? `0 0 6px ${colors.success}` : `0 0 6px ${colors.danger}`,
          }} />
          {props.online ? "Online" : "Offline"}
        </span>

        <span title="Time" style={{
          fontSize: 12, color: colors.textDim, fontVariantNumeric: "tabular-nums",
          padding: "6px 10px", borderRadius: 6, border: `1px solid ${colors.border}`,
        }}>{clock}</span>

        <IconButton title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={toggleFullscreen}>
          {isFullscreen ? "⛶" : "⛶"}
        </IconButton>

        <IconButton title="Lock terminal" onClick={() => setLocked(true)}>🔒</IconButton>

        <div style={{ position: "relative" }}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              background: colors.panelAlt,
              border: `1px solid ${colors.border}`,
              color: colors.textPrimary,
              padding: "7px 12px", borderRadius: 8,
              cursor: "pointer", fontSize: 13, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            <span style={{
              width: 22, height: 22, borderRadius: "50%",
              background: colors.brand, color: "#fff",
              display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700,
            }}>{(props.user.name?.[0] ?? "?").toUpperCase()}</span>
            {props.user.name.split(" ")[0]} ▾
          </button>
          {menuOpen && (
            <div
              onMouseLeave={() => setMenuOpen(false)}
              style={{
                position: "absolute", right: 0, top: "calc(100% + 6px)",
                background: colors.panel, border: `1px solid ${colors.border}`,
                borderRadius: 10, minWidth: 220, padding: 6, zIndex: 30,
                boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
              }}
            >
              <MenuItem onClick={() => { setMenuOpen(false); props.onSwitchOutlet(); }}>Switch outlet / counter</MenuItem>
              <MenuItem onClick={() => { setMenuOpen(false); props.onOpenSettings(); }}>Connection settings</MenuItem>
              <MenuItem onClick={() => { setMenuOpen(false); setActive("settings"); }}>App settings…</MenuItem>
              <MenuItem onClick={() => { setMenuOpen(false); setShowSync(true); }}>Sync status…</MenuItem>
              <MenuItem onClick={() => { setMenuOpen(false); setShowHelp(true); }}>Keyboard shortcuts…</MenuItem>
              <div style={{ height: 1, background: colors.border, margin: "4px 0" }} />
              <MenuItem onClick={() => { setMenuOpen(false); setCashMovement("in"); }}>Cash in…</MenuItem>
              <MenuItem onClick={() => { setMenuOpen(false); setCashMovement("out"); }}>Cash out…</MenuItem>
              <MenuItem onClick={() => { setMenuOpen(false); setCashMovement("expense"); }}>Record expense…</MenuItem>
              <div style={{ height: 1, background: colors.border, margin: "4px 0" }} />
              <MenuItem onClick={() => { setMenuOpen(false); setShowCloseShift(true); }}>Close shift…</MenuItem>
              <MenuItem onClick={() => { setMenuOpen(false); setLocked(true); }}>Lock terminal</MenuItem>
              <MenuItem danger onClick={() => { setMenuOpen(false); props.onSignOut(); }}>Sign out</MenuItem>
            </div>
          )}
        </div>
      </header>

      {/* ─── Sidebar ────────────────────────────────────────────────── */}
      <nav style={{
        gridArea: "sidebar",
        background: "#0d121b",
        borderRight: `1px solid ${colors.border}`,
        padding: "12px 10px",
        display: "flex", flexDirection: "column", gap: 4,
        overflowY: "auto",
      }}>
        {NAV.filter(n => ROLE_NAV[appPrefs.role].has(n.key)).map((n) => {
          const isActive = active === n.key;
          const badge = badgeFor(n.key);
          return (
            <button
              key={n.key}
              onClick={() => setActive(n.key)}
              title={n.label}
              style={{
                position: "relative",
                background: isActive
                  ? `linear-gradient(135deg, ${colors.brand} 0%, ${colors.brandHover} 100%)`
                  : "transparent",
                color: isActive ? "#fff" : colors.textDim,
                border: 0, borderRadius: 10,
                padding: "10px 4px",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                fontSize: 11, fontWeight: 600,
                cursor: "pointer",
                boxShadow: isActive ? `0 4px 14px ${colors.brand}55` : "none",
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                if (!isActive) (e.currentTarget.style.background = colors.panelAlt);
              }}
              onMouseLeave={(e) => {
                if (!isActive) (e.currentTarget.style.background = "transparent");
              }}
            >
              <span style={{
                width: 28, height: 28,
                display: "grid", placeItems: "center",
                color: isActive ? "#fff" : colors.textDim,
              }}>{n.icon}</span>
              <span>{n.label}</span>
              {badge != null && (
                <span style={{
                  position: "absolute", top: 6, right: 10,
                  minWidth: 18, height: 18, padding: "0 5px",
                  background: n.key === "hardware" ? colors.danger : colors.brand,
                  color: "#fff", borderRadius: 999,
                  fontSize: 10, fontWeight: 800,
                  display: "grid", placeItems: "center",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                  border: `2px solid #0d121b`,
                }}>{badge > 99 ? "99+" : badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ─── Main pane ──────────────────────────────────────────────── */}
      <main style={{
        gridArea: "main",
        overflow: "hidden",
        display: "flex", flexDirection: "column", minHeight: 0,
      }}>
        {(active === "pos" || active === "orders") ? (
          // POS = blank slate for a new order (rail collapsed for max menu
          // space). Orders = manage existing tickets (rail expanded so the
          // cashier sees every live order on arrival). Same workspace, two
          // entry modes — keyed so React fully remounts and the rail
          // state actually flips when the cashier switches nav.
          <OrderWorkspace
            key={active}
            handoff={handoff}
            onHandoffConsumed={() => setHandoff(null)}
            initialRailOpen={active === "orders"}
          />
        ) : active === "tables" ? (
          <TablesScreen onOpenTable={(table, orderId) => openInOrders({ kind: "table", tableId: table.id, orderId })} />
        ) : active === "kitchen" ? (
          <KitchenScreen onOpenOrder={(orderId) => openInOrders({ kind: "order", orderId })} />
        ) : active === "qr" ? (
          <QrOrdersPanel onOpenOrder={(orderId) => openInOrders({ kind: "order", orderId })} />
        ) : active === "customers" ? (
          <CustomersScreen onUseInOrder={(customer) => openInOrders({ kind: "customer", customer })} />
        ) : active === "payments" ? (
          <PaymentsScreen onOpenOrder={(orderId) => openInOrders({ kind: "order", orderId })} />
        ) : active === "shift" ? (
          <ShiftScreen
            shiftOpenedAt={props.shiftOpenedAt}
            cashier={appPrefs.cashierName || props.user.name}
            onOpenCash={(k) => setCashMovement(k)}
            onCloseShift={() => setShowCloseShift(true)}
          />
        ) : active === "reports" ? (
          <ReportsScreen />
        ) : active === "settings" ? (
          <AppSettingsScreen onSignOut={props.onSignOut} />
        ) : active === "hardware" ? (
          <div style={{ overflow: "auto", padding: 24, flex: 1 }}>
            <HardwareSettings online={props.online} />
          </div>
        ) : null}
      </main>

      {/* ─── Bottom shortcut bar ────────────────────────────────────── */}
      <footer style={{
        gridArea: "bottombar",
        background: "#0d121b",
        borderTop: `1px solid ${colors.border}`,
        display: "flex", alignItems: "center", gap: 14,
        padding: "0 18px",
        fontSize: 11, color: colors.textDim,
        overflowX: "auto", whiteSpace: "nowrap",
      }}>
        {SHORTCUTS.map(([k, v]) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <kbd style={{
              background: colors.panel, padding: "2px 6px", borderRadius: 4,
              border: `1px solid ${colors.borderStrong}`,
              fontFamily: "monospace", fontSize: 10, color: colors.textPrimary,
            }}>{k}</kbd>
            <span>{v}</span>
          </span>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowHelp(true)}
          style={{
            background: "transparent", border: 0, color: colors.textDim,
            cursor: "pointer", fontSize: 11, padding: "4px 8px",
          }}
        >Shortcuts help →</button>
      </footer>

      {/* ─── Modals & overlays ─────────────────────────────────────── */}
      {showCloseShift && (
        <CloseShiftModal
          onClose={() => setShowCloseShift(false)}
          onClosed={() => { setShowCloseShift(false); setActive("reports"); }}
        />
      )}
      {showSync && <SyncPanel onClose={() => setShowSync(false)} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showFailedPrints && (
        <FailedPrintsModal
          onClose={() => setShowFailedPrints(false)}
          online={props.online}
          onJumpToHardware={() => { setShowFailedPrints(false); setActive("hardware"); }}
        />
      )}
      {cashMovement && (
        <CashMovementModal
          kind={cashMovement}
          cashier={appPrefs.cashierName || props.user.name}
          onClose={() => setCashMovement(null)}
          onSaved={() => setCashMovement(null)}
        />
      )}
      {locked && <LockOverlay user={props.user} onUnlock={() => setLocked(false)} />}
      {pinGate && (
        <ManagerPinModal
          reason={pinGate.reason}
          onCancel={() => setPinGate(null)}
          onAllow={() => { const cb = pinGate.onAllow; setPinGate(null); cb(); }}
        />
      )}
      {updateBanner && (
        <div style={{
          position: "fixed", bottom: 48, right: 18, zIndex: 900,
          background: updateBanner.kind === "ready" ? "rgba(22,163,74,0.18)" : "rgba(59,130,246,0.18)",
          border: `1px solid ${updateBanner.kind === "ready" ? "rgba(22,163,74,0.6)" : "rgba(59,130,246,0.6)"}`,
          color: updateBanner.kind === "ready" ? "#86efac" : "#bfdbfe",
          padding: "10px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
          boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
          display: "flex", gap: 12, alignItems: "center",
        }}>
          <span>⬇ {updateBanner.text}</span>
          {updateBanner.kind === "ready" && (
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "rgba(22,163,74,0.4)", color: "#fff", border: 0,
                padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700,
              }}
            >Reload now</button>
          )}
          <button onClick={() => setUpdateBanner(null)} style={{
            background: "transparent", border: 0, color: "inherit", cursor: "pointer", fontSize: 16,
          }}>×</button>
        </div>
      )}
    </div>
  );
}

// ─── Small UI atoms ──────────────────────────────────────────────────────────

function Pill({ icon, value, tone, title, onClick }: {
  icon: string;
  value: string;
  tone: "neutral" | "brand" | "warn" | "danger" | "success";
  title?: string;
  onClick?: () => void;
}) {
  const palette = {
    neutral: { bg: colors.panelAlt, border: colors.border, color: colors.textPrimary },
    brand:   { bg: "rgba(234,88,12,0.14)", border: "rgba(234,88,12,0.4)", color: "#fed7aa" },
    warn:    { bg: "rgba(234,179,8,0.14)", border: "rgba(234,179,8,0.45)", color: "#fde68a" },
    danger:  { bg: "rgba(220,38,38,0.14)", border: "rgba(220,38,38,0.5)", color: "#fca5a5" },
    success: { bg: "rgba(22,163,74,0.14)", border: "rgba(22,163,74,0.45)", color: "#86efac" },
  }[tone];
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      title={title}
      onClick={onClick}
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.color,
        padding: "6px 10px", borderRadius: 999,
        fontSize: 12, fontWeight: 600,
        display: "inline-flex", alignItems: "center", gap: 6,
        cursor: onClick ? "pointer" : "default",
        fontVariantNumeric: "tabular-nums",
      } as React.CSSProperties}
    >
      <span style={{ fontSize: 13 }}>{icon}</span>{value}
    </Tag>
  );
}

function IconButton({ children, onClick, title }: {
  children: React.ReactNode; onClick: () => void; title: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 34, height: 34, borderRadius: 8,
        background: colors.panelAlt, border: `1px solid ${colors.border}`,
        color: colors.textPrimary, cursor: "pointer",
        display: "grid", placeItems: "center", fontSize: 14,
      }}
    >{children}</button>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left",
        background: "transparent", border: 0, color: danger ? "#fca5a5" : colors.textPrimary,
        padding: "9px 12px", borderRadius: 6, fontSize: 13, cursor: "pointer",
      }}
      onMouseEnter={e => (e.currentTarget.style.background = colors.panelAlt)}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >{children}</button>
  );
}

// ─── Lock overlay ────────────────────────────────────────────────────────────

function LockOverlay({ user, onUnlock }: { user: User; onUnlock: () => void }) {
  // PIN-backed lock when a PIN is configured under App settings → Security.
  // When no PIN is set, falls back to a soft lock (Enter / Unlock button)
  // — the OS/network login already gated terminal access.
  const { prefs } = useAppPrefs();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasPin = !!prefs.lockPinHash;

  async function tryUnlock() {
    if (!hasPin) { onUnlock(); return; }
    setBusy(true); setErr(null);
    try {
      const got = await hashPin(pin);
      if (got === prefs.lockPinHash) { onUnlock(); return; }
      setErr("Wrong PIN — try again."); setPin("");
    } finally { setBusy(false); }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); void tryUnlock(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, hasPin]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)",
      display: "grid", placeItems: "center",
    }}>
      <div style={{ textAlign: "center", color: "#fff", minWidth: 320 }}>
        <div style={{ fontSize: 64 }}>🔒</div>
        <h2 style={{ margin: "10px 0", fontSize: 26 }}>Terminal locked</h2>
        <p style={{ color: colors.textDim, marginBottom: 18 }}>
          Welcome back, {user.name}.{hasPin ? " Enter your PIN to resume." : " Press Enter to resume."}
        </p>
        {hasPin && (
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            placeholder="••••"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            style={{
              width: 200, padding: "10px 14px", borderRadius: 8,
              border: `1px solid ${colors.borderStrong}`, background: colors.panel,
              color: "#fff", fontSize: 22, letterSpacing: 8, textAlign: "center",
              fontFamily: "monospace", marginBottom: 12,
            }}
          />
        )}
        {err && (
          <div style={{ color: "#fca5a5", fontSize: 12, marginBottom: 8 }}>{err}</div>
        )}
        <div>
          <Button onClick={tryUnlock} disabled={busy || (hasPin && pin.length < 4)}>
            {busy ? "Checking…" : "Unlock"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

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

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return useMemo(() => now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), [now]);
}

// ─── Inline SVG icons ────────────────────────────────────────────────────────

function IconBase({ children }: { children: React.ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
function IconPos() {
  return <IconBase>
    <rect x="3" y="4" width="18" height="14" rx="2" />
    <path d="M7 8h10M7 12h6M7 16h4" />
    <path d="M3 20h18" />
  </IconBase>;
}
function IconOrders() {
  return <IconBase>
    <path d="M6 2l1 4h10l1-4" />
    <path d="M4 6h16l-1.5 14a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2L4 6z" />
    <path d="M9 11h6" />
  </IconBase>;
}
function IconTables() {
  return <IconBase>
    <rect x="3" y="10" width="18" height="3" rx="1" />
    <path d="M6 13v7M18 13v7" />
    <circle cx="12" cy="6" r="2" />
  </IconBase>;
}
function IconKitchen() {
  return <IconBase>
    <path d="M5 3v8a4 4 0 0 0 8 0V3" />
    <path d="M9 3v8" />
    <path d="M17 3c2 2 2 5 0 7v11" />
    <path d="M13 21h8" />
  </IconBase>;
}
function IconQr() {
  return <IconBase>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3M20 14v3M14 20h7" />
  </IconBase>;
}
function IconCustomers() {
  return <IconBase>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 21c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <circle cx="17" cy="6" r="2" />
    <path d="M15 13c2 0 6 1.3 6 5" />
  </IconBase>;
}
function IconPayments() {
  return <IconBase>
    <rect x="2" y="6" width="20" height="13" rx="2" />
    <path d="M2 10h20" />
    <path d="M6 16h4" />
  </IconBase>;
}
function IconShift() {
  return <IconBase>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </IconBase>;
}
function IconHardware() {
  return <IconBase>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M7 16v3h10v-3" />
    <path d="M9 9h6" />
  </IconBase>;
}
function IconReports() {
  return <IconBase>
    <path d="M3 21h18" />
    <rect x="6" y="13" width="3" height="6" />
    <rect x="11" y="9" width="3" height="10" />
    <rect x="16" y="5" width="3" height="14" />
  </IconBase>;
}
function IconSettings() {
  return <IconBase>
    <circle cx="12" cy="12" r="3" />
    <path d="M19 12a7 7 0 0 0-.1-1.3l2-1.6-2-3.4-2.4.9a7 7 0 0 0-2.2-1.3L14 3h-4l-.3 2.3a7 7 0 0 0-2.2 1.3l-2.4-.9-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .9.1 1.3l-2 1.6 2 3.4 2.4-.9c.7.5 1.4.9 2.2 1.3L10 21h4l.3-2.3c.8-.3 1.5-.8 2.2-1.3l2.4.9 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z" />
  </IconBase>;
}
