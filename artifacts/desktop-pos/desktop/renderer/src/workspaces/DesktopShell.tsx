/**
 * Generic role-aware desktop shell.
 *
 * Hosts every non-Cashier workspace (Manager Office, Inventory, Accounts,
 * Marketing, Delivery). Provides the consistent chrome described in the
 * task: status header with switchers + theme/density toggles, permission-
 * gated left rail with Favorites/Recents, command palette (Ctrl+K), and
 * a bottom status bar with last-sync + "Sync now".
 *
 * The cashier WorkspaceScreen has its own POS-optimized chrome and keeps
 * its existing layout — it just plugs the same CommandPalette + role
 * switcher into the header (see `Workspace.tsx`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SelectionState, User } from "../../../shared/ipc-contract";
import { colors } from "../ui/components";
import { useAppPrefs } from "../hooks/useAppPrefs";
import { useFavoritesRecents } from "../hooks/useFavoritesRecents";
import { CommandPalette } from "./CommandPalette";
import { ComingSoon } from "./ComingSoon";
import { WORKSPACES, deriveAccess, hasAllModules, hasAnyPermission } from "./roles";
import { usePlanFeatures } from "./usePlanFeatures";
import type { NavItem, WorkspaceKey } from "./types";
import { LockOverlay } from "../screens/Workspace";

interface Props {
  user: User;
  selection: SelectionState;
  online: boolean;
  workspaceKey: WorkspaceKey;
  /** Workspaces the signed-in user can switch to. Length 1 → no switcher. */
  availableWorkspaces: WorkspaceKey[];
  /** Count of outlets/branches the tenant has. Used to hide the
   *  "Switch outlet" affordance for single-outlet tenants. */
  outletCount: number;
  navItems: NavItem[];
  /** Render the active module. Receive the active item; return null to
   *  fall back to the consistent "coming soon" empty state. */
  renderModule?: (
    item: NavItem,
    helpers: {
      navigate: (key: string) => void;
      /** The same filtered nav list the sidebar renders — already
       *  permission/module/feature-gated. Module screens (e.g. the
       *  Back Office index) MUST use this rather than the raw
       *  `navItems` prop so they never surface a card the user can't
       *  open. Keeping a single source of truth here is what enforces
       *  the "hidden, not disabled" requirement end-to-end. */
      visibleItems: NavItem[];
    },
  ) => React.ReactNode;
  onSwitchWorkspace: (key: WorkspaceKey) => void;
  onSwitchOutlet: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
}

const SYNC_KEY_LAST_AT = "kp:lastSyncAt";

export function DesktopShell(props: Props) {
  const { user, navItems, workspaceKey } = props;
  const { prefs, update } = useAppPrefs();
  const access = useMemo(() => deriveAccess(user), [user]);
  const meta = WORKSPACES[workspaceKey];
  const plan = usePlanFeatures(user.restaurantId);

  const fav = useFavoritesRecents(user.id, workspaceKey);
  // Plan-feature gating: when a nav item names a `requiredFeature`
  // and the tenant's plan doesn't include it, hide the item. While
  // the subscription request is in-flight we conservatively hide
  // every gated item so the user never sees a row that's about to
  // disappear once the response arrives. Super-admin bypasses the
  // gate so the platform team can always reach every module.
  const visibleItems = useMemo(() => {
    const isSuperAdmin = !!user.isSuperAdmin;
    return navItems.filter(it => {
      if (!hasAnyPermission(access, it.requiredPermissions)) return false;
      if (!hasAllModules(access, it.requiredModules)) return false;
      if (it.requiredFeature && !isSuperAdmin) {
        if (!plan.loaded) return false;
        if (!plan.enabled.has(it.requiredFeature)) return false;
      }
      return true;
    });
  }, [navItems, access, plan, user.isSuperAdmin]);
  const [active, setActive] = useState<string>(() =>
    fav.favorites.find(k => visibleItems.some(v => v.key === k))
      ?? visibleItems[0]?.key ?? "");

  // When the workspace itself changes (role switcher), reset the active
  // module to the new workspace's preferred starting point. Without this,
  // switching from Inventory → Manager could leave the shell pointing at
  // a key that no longer exists in the new nav, showing an empty pane.
  useEffect(() => {
    setActive(prev => {
      if (prev && visibleItems.some(v => v.key === prev)) return prev;
      return fav.favorites.find(k => visibleItems.some(v => v.key === k))
        ?? visibleItems[0]?.key ?? "";
    });
    // Intentionally key on workspaceKey alone — favorites/recents
    // changes inside a workspace must NOT yank the user off their
    // current module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceKey]);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [outletMenuOpen, setOutletMenuOpen] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(() => {
    const raw = localStorage.getItem(SYNC_KEY_LAST_AT);
    return raw ? Number(raw) : null;
  });
  const [syncing, setSyncing] = useState(false);

  // Live status signals — same sources the cashier shell uses so the new
  // workspaces show parity badges/pills (failed prints, pending sync ops,
  // today's gross, live order count, shift status).
  const [failedPrints, setFailedPrints] = useState(0);
  const [pendingOps, setPendingOps] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [liveOrders, setLiveOrders] = useState<number | null>(null);
  const [newQrOrders, setNewQrOrders] = useState<number>(0);
  const [todaysSales, setTodaysSales] = useState<number | null>(null);
  const [shiftOpen, setShiftOpen] = useState<boolean | null>(null);
  const [printersConfigured, setPrintersConfigured] = useState<boolean | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() =>
    !!document.fullscreenElement);
  const [locked, setLocked] = useState(false);

  // Map of nav-item key → numeric badge. Computed once from the live
  // signals above so every NavRow / palette row can pull from the same
  // source without re-querying IPC.
  const badges: Record<string, number> = useMemo(() => ({
    orders: liveOrders ?? 0,
    overview: liveOrders ?? 0,
    qr: newQrOrders,
    dispatch: liveOrders ?? 0,
    live: liveOrders ?? 0,
    hardware: failedPrints,
    integrations: failedPrints,
  }), [liveOrders, newQrOrders, failedPrints]);

  // Apply theme + density CSS vars (the same hook the cashier shell uses).
  useEffect(() => {
    const root = document.documentElement;
    const map = {
      comfortable: { pad: "12px", font: "14px" },
      compact: { pad: "8px", font: "13px" },
      "large-touch": { pad: "18px", font: "16px" },
    } as const;
    const v = map[prefs.density];
    root.style.setProperty("--kp-density-pad", v.pad);
    root.style.setProperty("--kp-density-font", v.font);
    root.dataset.theme = prefs.theme;
    root.dataset.density = prefs.density;
  }, [prefs.density, prefs.theme]);

  // Tick the header clock.
  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Failed-prints badge — same source as the cashier hardware tab.
  useEffect(() => {
    const tick = () => window.khanalagao?.failedPrints?.list()
      .then(l => setFailedPrints(l.length)).catch(() => undefined);
    void tick();
    const off = window.khanalagao?.failedPrints?.onChanged?.(tick);
    return () => { off?.(); };
  }, []);

  // Pending sync / conflict counts — mirror engine status.
  useEffect(() => {
    const tick = async () => {
      try {
        const s = await window.khanalagao?.sync?.status();
        if (s) { setPendingOps(s.pending); setConflictCount(s.conflicts); }
      } catch { /* engine warming up */ }
    };
    void tick();
    const off = window.khanalagao?.sync?.onStatusChanged?.(tick);
    return () => { off?.(); };
  }, []);

  // Today's gross + live order count + shift status — single 12s poll.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const orders = await window.khanalagao?.orders?.list({ limit: 150 });
        if (!alive || !orders) return;
        const live = orders.filter(o => o.status !== "completed" && o.status !== "cancelled");
        setLiveOrders(live.length);
        const ONLINE_TYPES = new Set([
          "qr_order", "qr", "online", "online_order", "whatsapp", "zomato", "swiggy",
        ]);
        setNewQrOrders(live.filter(o =>
          ONLINE_TYPES.has(o.orderType) && o.paymentStatus !== "paid"
        ).length);
      } catch { /* keep last */ }
      try {
        const cur = await window.khanalagao?.shifts?.current();
        if (!alive) return;
        setShiftOpen(!!cur?.session);
        if (cur?.session) {
          const k = await window.khanalagao.reports.shiftKpis({ sessionId: cur.session.id });
          if (alive) setTodaysSales(k.grossRevenue);
        } else {
          setTodaysSales(null);
        }
      } catch { /* keep last */ }
    };
    void tick();
    const id = window.setInterval(tick, 12_000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  // Printer health — "configured" means at least one OS printer is
  // assigned to a role. Combined with `failedPrints > 0` this drives the
  // printer pill (green / red / unconfigured).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const a = await window.khanalagao?.printers?.getAssignments();
        if (!alive) return;
        const any = !!a && Object.values(a).some(v => v != null && v !== "");
        setPrintersConfigured(any);
      } catch { /* main not ready */ }
    };
    void tick();
    const id = window.setInterval(tick, 30_000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  // Track real fullscreen state so the toggle button reflects reality
  // even when the user exits via the OS chrome.
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    } catch { /* unsupported */ }
  }, []);

  // Global Ctrl+K / Cmd+K — palette overlay. Inputs are exempted only
  // when the user is mid-typing in a textbox; the palette itself
  // listens on its own input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(v => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeItem = useMemo(() => visibleItems.find(i => i.key === active), [visibleItems, active]);

  const openItem = useCallback((it: NavItem) => {
    setActive(it.key);
    fav.recordRecent(it.key);
  }, [fav]);

  const triggerSync = useCallback(async () => {
    setSyncing(true);
    try {
      // Best-effort: the real sync engine ships with the offline task.
      // For now, hit the connectivity probe so the status pill refreshes
      // and record the wall-clock timestamp for the bottom bar.
      try {
        if (window.khanalagao?.sync?.status) await window.khanalagao.sync.status();
      } catch { /* engine not yet wired in this build */ }
      const now = Date.now();
      localStorage.setItem(SYNC_KEY_LAST_AT, String(now));
      setLastSyncAt(now);
    } finally {
      setSyncing(false);
    }
  }, []);

  const switcherWorkspaces = props.availableWorkspaces.filter(k => k !== workspaceKey);

  return (
    <div style={{
      display: "grid",
      gridTemplateRows: "60px 1fr 32px",
      gridTemplateColumns: "240px 1fr",
      gridTemplateAreas: '"topbar topbar" "sidebar main" "bottombar bottombar"',
      height: "100vh",
      background: colors.bg,
      color: colors.textPrimary,
    }}>
      {/* ─── Status header ──────────────────────────────────────────── */}
      <header style={{
        gridArea: "topbar",
        display: "flex", alignItems: "center", gap: 12, padding: "0 18px",
        background: "linear-gradient(180deg, #131a26 0%, #0f1520 100%)",
        borderBottom: `1px solid ${colors.border}`,
        boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: 15 }}>
          <span style={{
            width: 32, height: 32, borderRadius: 8,
            background: `linear-gradient(135deg, ${colors.brand} 0%, ${colors.brandHover} 100%)`,
            color: "#fff", display: "grid", placeItems: "center", fontSize: 15,
            boxShadow: `0 2px 8px ${colors.brand}55`,
          }}>{meta.glyph}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 1, lineHeight: 1.1 }}>
            <span>{meta.label}</span>
            <span style={{ fontSize: 10, color: colors.textMuted, fontWeight: 500 }}>KhanaLagao Desktop</span>
          </div>
        </div>

        <div style={{ width: 1, height: 30, background: colors.border }} />

        {/* Outlet info + outlet switcher */}
        <OutletButton
          label={props.selection.branchName ?? "—"}
          sub={`${props.selection.counterName ?? ""} · ${user.name}`}
          onClick={() => setOutletMenuOpen(v => !v)}
          open={outletMenuOpen}
        >
          {outletMenuOpen && (
            <DropMenu onClose={() => setOutletMenuOpen(false)}>
              <MenuRow muted>Active outlet / counter</MenuRow>
              <MenuRow>
                <div style={{ fontWeight: 700 }}>{props.selection.branchName}</div>
                <div style={{ fontSize: 11, color: colors.textDim }}>{props.selection.counterName}</div>
              </MenuRow>
              {/* Switching is only meaningful when there is more than one
                  outlet to switch to. Single-outlet tenants get a clean
                  read-only display instead of a dead-end action. */}
              {props.outletCount > 1 && (<>
                <Divider />
                <MenuRow onClick={() => { setOutletMenuOpen(false); props.onSwitchOutlet(); }}>
                  Switch outlet / counter…
                </MenuRow>
              </>)}
            </DropMenu>
          )}
        </OutletButton>

        <div style={{ flex: 1 }} />

        {/* Command palette hint */}
        <button
          onClick={() => setPaletteOpen(true)}
          title="Open command palette"
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: colors.panelAlt, border: `1px solid ${colors.border}`,
            color: colors.textDim, padding: "6px 10px 6px 12px", borderRadius: 8,
            fontSize: 12, cursor: "pointer",
          }}
        >
          <span>Search…</span>
          <kbd style={{
            background: colors.panel, padding: "1px 6px", borderRadius: 4,
            border: `1px solid ${colors.borderStrong}`, fontFamily: "monospace",
            fontSize: 10, color: colors.textPrimary,
          }}>{navigator.platform.includes("Mac") ? "⌘K" : "Ctrl+K"}</kbd>
        </button>

        {/* Role / workspace switcher — only when the user has >1 */}
        {switcherWorkspaces.length > 0 && (
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setWorkspaceMenuOpen(v => !v)}
              title="Switch workspace"
              style={{
                background: colors.panelAlt, border: `1px solid ${colors.border}`,
                color: colors.textPrimary, padding: "6px 10px", borderRadius: 8,
                fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              <span>Workspace</span><span style={{ color: colors.textDim }}>▾</span>
            </button>
            {workspaceMenuOpen && (
              <DropMenu onClose={() => setWorkspaceMenuOpen(false)}>
                <MenuRow muted>Switch to another workspace</MenuRow>
                {switcherWorkspaces.map(k => (
                  <MenuRow key={k} onClick={() => { setWorkspaceMenuOpen(false); props.onSwitchWorkspace(k); }}>
                    <div style={{ fontWeight: 700 }}>{WORKSPACES[k].label}</div>
                    <div style={{ fontSize: 11, color: colors.textDim }}>{WORKSPACES[k].description}</div>
                  </MenuRow>
                ))}
              </DropMenu>
            )}
          </div>
        )}

        {/* Live status pills — mirror the cashier shell so any workspace
            (Manager, Inventory, etc.) shows the same operational signals
            an owner needs at a glance: today's gross, live orders,
            sync backlog, failed prints, shift state. */}
        {todaysSales != null && (
          <StatusPill icon="₹" tone="success"
            label={fmtMoney(todaysSales)} title="Today's gross (open shift)" />
        )}
        {liveOrders != null && liveOrders > 0 && (
          <StatusPill icon="▢" tone="brand"
            label={`${liveOrders} live`} title="Live (unfinished) orders" />
        )}
        {shiftOpen === false && (
          <StatusPill icon="◐" tone="warn" label="No shift" title="Cash shift not open" />
        )}
        {pendingOps > 0 && (
          <StatusPill icon="↻" tone={conflictCount > 0 ? "danger" : "warn"}
            label={conflictCount > 0 ? `${pendingOps} · ${conflictCount} conflict${conflictCount === 1 ? "" : "s"}` : `${pendingOps} pending`}
            title="Operations waiting to sync" />
        )}
        {/* Printer health — green when configured + no failures, red on
            failed jobs, neutral when no printer is set up yet. */}
        {printersConfigured === false ? (
          <StatusPill icon="⎙" tone="warn" label="No printer" title="No printers assigned — open Hardware to set up" />
        ) : failedPrints > 0 ? (
          <StatusPill icon="⎙" tone="danger" label={`${failedPrints} print${failedPrints === 1 ? "" : "s"}`}
            title="Failed print jobs — open Hardware to retry" />
        ) : printersConfigured === true ? (
          <StatusPill icon="⎙" tone="success" label="Printers OK" title="All assigned printers are healthy" />
        ) : null}

        {/* Online/offline pill */}
        <span title={props.online ? "Online" : "Offline — changes queue locally"}
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

        {/* Quick theme toggle */}
        <button
          title={prefs.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => update({ theme: prefs.theme === "dark" ? "light" : "dark" })}
          style={{
            width: 34, height: 34, borderRadius: 8,
            background: colors.panelAlt, border: `1px solid ${colors.border}`,
            color: colors.textPrimary, cursor: "pointer",
            display: "grid", placeItems: "center", fontSize: 14,
          }}
        >{prefs.theme === "dark" ? "☼" : "☾"}</button>

        {/* Fullscreen toggle — parity with the cashier shell so kiosk
            mode is one click away from any workspace. */}
        <button
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          onClick={toggleFullscreen}
          style={{
            width: 34, height: 34, borderRadius: 8,
            background: colors.panelAlt, border: `1px solid ${colors.border}`,
            color: colors.textPrimary, cursor: "pointer",
            display: "grid", placeItems: "center", fontSize: 14,
          }}
        >{isFullscreen ? "⤡" : "⤢"}</button>

        {/* Lock terminal — PIN-backed if configured, otherwise a soft
            lock screen. Same overlay component as cashier. */}
        <button
          title="Lock terminal"
          onClick={() => setLocked(true)}
          style={{
            width: 34, height: 34, borderRadius: 8,
            background: colors.panelAlt, border: `1px solid ${colors.border}`,
            color: colors.textPrimary, cursor: "pointer",
            display: "grid", placeItems: "center", fontSize: 14,
          }}
        >🔒</button>

        <span title="Time" style={{
          fontSize: 12, color: colors.textDim, fontVariantNumeric: "tabular-nums",
          padding: "6px 10px", borderRadius: 6, border: `1px solid ${colors.border}`,
        }}>{clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>

        {/* Profile menu */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            style={{
              background: colors.panelAlt, border: `1px solid ${colors.border}`,
              color: colors.textPrimary, padding: "7px 12px", borderRadius: 8,
              cursor: "pointer", fontSize: 13, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            <span style={{
              width: 22, height: 22, borderRadius: "50%",
              background: colors.brand, color: "#fff",
              display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700,
            }}>{(user.name?.[0] ?? "?").toUpperCase()}</span>
            {user.name.split(" ")[0]} ▾
          </button>
          {menuOpen && (
            <DropMenu onClose={() => setMenuOpen(false)}>
              {props.outletCount > 1 && (
                <MenuRow onClick={() => { setMenuOpen(false); props.onSwitchOutlet(); }}>
                  Switch outlet / counter
                </MenuRow>
              )}
              <MenuRow onClick={() => { setMenuOpen(false); props.onOpenSettings(); }}>
                Connection settings
              </MenuRow>
              <MenuRow onClick={() => {
                setMenuOpen(false);
                update({ density: prefs.density === "compact" ? "comfortable" : "compact" });
              }}>{prefs.density === "compact" ? "Switch to comfortable density" : "Switch to compact density"}</MenuRow>
              <MenuRow onClick={() => {
                setMenuOpen(false);
                update({ density: prefs.density === "large-touch" ? "comfortable" : "large-touch" });
              }}>{prefs.density === "large-touch" ? "Disable touch density" : "Switch to touch density"}</MenuRow>
              <Divider />
              <MenuRow danger onClick={() => { setMenuOpen(false); props.onSignOut(); }}>Sign out</MenuRow>
            </DropMenu>
          )}
        </div>
      </header>

      {/* ─── Sidebar ────────────────────────────────────────────────── */}
      <nav style={{
        gridArea: "sidebar",
        background: "#0d121b",
        borderRight: `1px solid ${colors.border}`,
        padding: "12px 8px",
        display: "flex", flexDirection: "column", gap: 2,
        overflowY: "auto",
      }}>
        {fav.favorites.length > 0 && (
          <NavGroup label="Favorites">
            <FavoritesList
              keys={fav.favorites}
              items={visibleItems}
              activeKey={active}
              onPick={openItem}
              onUnpin={(k) => fav.toggleFavorite(k)}
              onReorder={fav.reorderFavorites}
            />
          </NavGroup>
        )}
        {fav.recents.length > 0 && (
          <NavGroup label="Recents">
            {fav.recents
              .map(k => visibleItems.find(v => v.key === k))
              .filter((x): x is NavItem => !!x)
              .slice(0, 5)
              .map(item => (
                <NavRow
                  key={`rec-${item.key}`}
                  item={item}
                  active={active === item.key}
                  isFavorite={fav.isFavorite(item.key)}
                  badge={badges[item.key]}
                  onClick={() => openItem(item)}
                  onToggleFavorite={() => fav.toggleFavorite(item.key)}
                />
              ))}
          </NavGroup>
        )}
        {Object.entries(groupBy(visibleItems, i => i.group)).map(([group, items]) => (
          <NavGroup key={group} label={group}>
            {items.map(item => (
              <NavRow
                key={item.key}
                item={item}
                active={active === item.key}
                isFavorite={fav.isFavorite(item.key)}
                badge={badges[item.key]}
                onClick={() => openItem(item)}
                onToggleFavorite={() => fav.toggleFavorite(item.key)}
              />
            ))}
          </NavGroup>
        ))}
        {visibleItems.length === 0 && (
          <div style={{ padding: 12, color: colors.textMuted, fontSize: 12 }}>
            No modules are enabled for your role in this workspace.
          </div>
        )}
      </nav>

      {/* ─── Main pane ──────────────────────────────────────────────── */}
      <main style={{
        gridArea: "main",
        overflow: "hidden",
        display: "flex", flexDirection: "column", minHeight: 0,
      }}>
        {activeItem ? (
          (() => {
            const rendered = !activeItem.comingSoon && props.renderModule
              ? props.renderModule(activeItem, {
                  navigate: (k) => {
                    const next = visibleItems.find(v => v.key === k);
                    if (next) openItem(next);
                  },
                  visibleItems,
                }) : null;
            if (rendered) return rendered;
            return (
              <ComingSoon
                title={activeItem.label}
                group={activeItem.group}
                description={`The “${activeItem.label}” module is part of the upcoming ${meta.label} build.`}
              />
            );
          })()
        ) : (
          <ComingSoon
            title="Nothing selected"
            description="Pick a module from the left to get started, or press Ctrl+K to search."
          />
        )}
      </main>

      {/* ─── Bottom status bar ──────────────────────────────────────── */}
      <footer style={{
        gridArea: "bottombar",
        background: "#0d121b",
        borderTop: `1px solid ${colors.border}`,
        display: "flex", alignItems: "center", gap: 14,
        padding: "0 18px",
        fontSize: 11, color: colors.textDim,
      }}>
        <span>Last sync: <b style={{ color: colors.textPrimary }}>{lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString() : "—"}</b></span>
        <button
          onClick={() => void triggerSync()}
          disabled={syncing}
          style={{
            background: "transparent", border: 0, color: colors.brand,
            cursor: "pointer", fontSize: 11, padding: "4px 8px",
          }}
        >{syncing ? "Syncing…" : "Sync now"}</button>
        <div style={{ flex: 1 }} />
        <span>{meta.label} · {user.role}</span>
      </footer>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={visibleItems}
        access={access}
        favorites={fav.favorites}
        recents={fav.recents}
        workspaceLabel={meta.label}
        onPick={openItem}
      />

      {locked && <LockOverlay user={user} onUnlock={() => setLocked(false)} />}
    </div>
  );
}

// ─── Sidebar atoms ───────────────────────────────────────────────────────────

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{
        fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6,
        color: colors.textMuted, padding: "8px 10px 4px",
      }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{children}</div>
    </div>
  );
}

function NavRow({ item, active, isFavorite, badge, onClick, onToggleFavorite }: {
  item: NavItem;
  active: boolean;
  isFavorite: boolean;
  /** Optional numeric badge (live orders, failed prints, etc). 0/undefined → none. */
  badge?: number;
  onClick: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
      <button
        onClick={onClick}
        title={item.label}
        style={{
          flex: 1, textAlign: "left",
          background: active
            ? `linear-gradient(135deg, ${colors.brand} 0%, ${colors.brandHover} 100%)`
            : "transparent",
          color: active ? "#fff" : colors.textDim,
          border: 0, borderRadius: "8px 0 0 8px",
          padding: "8px 10px",
          display: "flex", alignItems: "center", gap: 10,
          fontSize: 13, fontWeight: 600, cursor: "pointer",
          boxShadow: active ? `0 4px 14px ${colors.brand}33` : "none",
        }}
      >
        <span style={{
          width: 20, height: 20, display: "grid", placeItems: "center",
          color: active ? "#fff" : colors.textDim,
        }}>{item.icon ?? "•"}</span>
        <span style={{ flex: 1 }}>{item.label}</span>
        {badge != null && badge > 0 && (
          <span
            title={`${badge} item${badge === 1 ? "" : "s"} need attention`}
            style={{
              fontSize: 10, fontWeight: 800,
              color: active ? "#fff" : "#fca5a5",
              background: active ? "rgba(255,255,255,0.18)" : "rgba(220,38,38,0.22)",
              border: active ? "1px solid rgba(255,255,255,0.35)" : "1px solid rgba(220,38,38,0.4)",
              padding: "1px 6px", borderRadius: 999,
              minWidth: 18, textAlign: "center",
            }}
          >{badge > 99 ? "99+" : badge}</span>
        )}
        {item.comingSoon && (
          <span style={{
            fontSize: 10, color: active ? "#fff" : "#fed7aa",
            background: active ? "rgba(255,255,255,0.15)" : "rgba(234,88,12,0.18)",
            border: active ? "1px solid rgba(255,255,255,0.35)" : "1px solid rgba(234,88,12,0.35)",
            padding: "1px 6px", borderRadius: 999, fontWeight: 700,
          }}>Soon</span>
        )}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
        title={isFavorite ? "Unpin from Favorites" : "Pin to Favorites"}
        style={{
          background: "transparent", border: 0, color: isFavorite ? "#fbbf24" : colors.textMuted,
          width: 26, cursor: "pointer", fontSize: 12, borderRadius: "0 8px 8px 0",
        }}
      >{isFavorite ? "★" : "☆"}</button>
    </div>
  );
}

function groupBy<T>(arr: T[], fn: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of arr) {
    const k = fn(item);
    (out[k] ?? (out[k] = [])).push(item);
  }
  return out;
}

// ─── Header dropdown atoms ───────────────────────────────────────────────────

function OutletButton({
  label, sub, onClick, open, children,
}: { label: string; sub?: string; onClick: () => void; open: boolean; children?: React.ReactNode }) {
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={onClick}
        style={{
          background: open ? colors.panelAlt : "transparent",
          border: `1px solid ${open ? colors.borderStrong : "transparent"}`,
          color: colors.textPrimary, borderRadius: 8,
          padding: "4px 10px", cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700 }}>{label} <span style={{ color: colors.textDim }}>▾</span></span>
        {sub && <span style={{ fontSize: 11, color: colors.textDim }}>{sub}</span>}
      </button>
      {children}
    </div>
  );
}

function DropMenu({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onMouseLeave={onClose}
      style={{
        position: "absolute", top: "calc(100% + 6px)", right: 0,
        minWidth: 240, background: colors.panel,
        border: `1px solid ${colors.border}`, borderRadius: 10, padding: 6,
        boxShadow: "0 12px 32px rgba(0,0,0,0.45)", zIndex: 60,
      }}
    >{children}</div>
  );
}

function MenuRow({ children, onClick, muted, danger }: {
  children: React.ReactNode; onClick?: () => void; muted?: boolean; danger?: boolean;
}) {
  if (muted) {
    return (
      <div style={{
        padding: "6px 10px", fontSize: 10, textTransform: "uppercase",
        letterSpacing: 0.6, color: colors.textMuted,
      }}>{children}</div>
    );
  }
  const props: React.HTMLAttributes<HTMLDivElement> = {
    onClick,
    style: {
      padding: "8px 10px", borderRadius: 6,
      color: danger ? "#fca5a5" : colors.textPrimary,
      cursor: onClick ? "pointer" : "default", fontSize: 13,
    },
    onMouseEnter: (e) => { if (onClick) (e.currentTarget.style.background = colors.panelAlt); },
    onMouseLeave: (e) => { e.currentTarget.style.background = "transparent"; },
  };
  return <div {...props}>{children}</div>;
}

function Divider() {
  return <div style={{ height: 1, background: colors.border, margin: "4px 0" }} />;
}

// ─── Status pill (header) ────────────────────────────────────────────────────

function StatusPill({ icon, label, tone, title }: {
  icon: string; label: string;
  tone: "neutral" | "brand" | "warn" | "danger" | "success";
  title?: string;
}) {
  const palette = {
    neutral: { bg: colors.panelAlt, border: colors.border, color: colors.textPrimary },
    brand:   { bg: "rgba(234,88,12,0.14)", border: "rgba(234,88,12,0.4)", color: "#fed7aa" },
    warn:    { bg: "rgba(234,179,8,0.14)", border: "rgba(234,179,8,0.45)", color: "#fde68a" },
    danger:  { bg: "rgba(220,38,38,0.14)", border: "rgba(220,38,38,0.5)", color: "#fca5a5" },
    success: { bg: "rgba(22,163,74,0.14)", border: "rgba(22,163,74,0.45)", color: "#86efac" },
  }[tone];
  return (
    <span title={title} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "5px 10px", borderRadius: 999,
      background: palette.bg, border: `1px solid ${palette.border}`,
      color: palette.color, fontSize: 12, fontWeight: 700,
      fontVariantNumeric: "tabular-nums",
    }}>
      <span style={{ fontSize: 11, opacity: 0.85 }}>{icon}</span>
      {label}
    </span>
  );
}

function fmtMoney(n: number): string {
  // Mirrors the cashier shell's INR formatter without pulling its module
  // graph into the new shell. Locale set to en-IN for the lakh grouping.
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency", currency: "INR", maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `₹${Math.round(n).toLocaleString()}`;
  }
}

// ─── Favorites list with drag-to-reorder ─────────────────────────────────────

function FavoritesList({
  keys, items, activeKey, onPick, onUnpin, onReorder,
}: {
  keys: string[];
  items: NavItem[];
  activeKey: string;
  onPick: (item: NavItem) => void;
  onUnpin: (key: string) => void;
  onReorder: (from: number, to: number) => void;
}) {
  // Track which row is being dragged so the rest of the list can show a
  // subtle insertion line. We only render rows whose key still exists in
  // the visible nav (so a permission change quietly drops dead pins).
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const rows = keys
    .map((k, originalIndex) => ({ key: k, originalIndex, item: items.find(v => v.key === k) }))
    .filter((r): r is { key: string; originalIndex: number; item: NavItem } => !!r.item);

  if (rows.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {rows.map((row, i) => {
        const isActive = activeKey === row.key;
        const isOver = dragOver === i;
        return (
          <div
            key={`fav-${row.key}`}
            draggable
            onDragStart={(e) => {
              dragFrom.current = row.originalIndex;
              e.dataTransfer.effectAllowed = "move";
              // Some browsers refuse to start a drag without payload.
              try { e.dataTransfer.setData("text/plain", row.key); } catch { /* ignore */ }
            }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(i); }}
            onDragLeave={() => setDragOver(prev => (prev === i ? null : prev))}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragFrom.current;
              const to = row.originalIndex;
              dragFrom.current = null; setDragOver(null);
              if (from != null && from !== to) onReorder(from, to);
            }}
            onDragEnd={() => { dragFrom.current = null; setDragOver(null); }}
            style={{
              display: "flex", alignItems: "stretch", gap: 0,
              borderTop: isOver ? `2px solid ${colors.brand}` : "2px solid transparent",
            }}
          >
            <span
              title="Drag to reorder"
              style={{
                width: 14, display: "grid", placeItems: "center",
                color: colors.textMuted, fontSize: 11, cursor: "grab",
                userSelect: "none",
              }}
            >⋮⋮</span>
            <button
              onClick={() => onPick(row.item)}
              title={row.item.label}
              style={{
                flex: 1, textAlign: "left",
                background: isActive
                  ? `linear-gradient(135deg, ${colors.brand} 0%, ${colors.brandHover} 100%)`
                  : "transparent",
                color: isActive ? "#fff" : colors.textDim,
                border: 0, borderRadius: "8px 0 0 8px",
                padding: "8px 10px",
                display: "flex", alignItems: "center", gap: 10,
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                boxShadow: isActive ? `0 4px 14px ${colors.brand}33` : "none",
              }}
            >
              <span style={{ width: 20, display: "grid", placeItems: "center" }}>
                {row.item.icon ?? "•"}
              </span>
              <span style={{ flex: 1 }}>{row.item.label}</span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onUnpin(row.key); }}
              title="Unpin from Favorites"
              style={{
                background: "transparent", border: 0, color: "#fbbf24",
                width: 26, cursor: "pointer", fontSize: 12, borderRadius: "0 8px 8px 0",
              }}
            >★</button>
          </div>
        );
      })}
    </div>
  );
}
