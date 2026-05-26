import { useEffect, useState } from "react";
import type { SelectionState, User } from "../../../shared/ipc-contract";
import { Button, colors } from "../ui/components";

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
  { key: "reports", label: "Reports", enabled: false },
  { key: "settings", label: "Settings", enabled: false },
] as const;

export function WorkspaceScreen(props: Props) {
  const [active, setActive] = useState<typeof NAV[number]["key"]>("orders");
  const [menuOpen, setMenuOpen] = useState(false);
  const shiftTimer = useShiftTimer(props.shiftOpenedAt);

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
        overflow: "auto", padding: 24,
        display: "grid", placeItems: "center",
      }}>
        <div style={{ textAlign: "center", maxWidth: 480 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 22 }}>Workspace ready</h2>
          <p style={{ color: colors.textDim, lineHeight: 1.5 }}>
            Your shift is open and the terminal is connected. The order entry workspace
            arrives in <b style={{ color: colors.textPrimary }}>Phase 2</b> — menu grid,
            cart, modifiers, and KOT print.
          </p>
          <div style={{ marginTop: 24, display: "flex", gap: 8, justifyContent: "center" }}>
            <Button variant="ghost" onClick={props.onSwitchOutlet}>Switch counter</Button>
          </div>
        </div>
      </main>
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
