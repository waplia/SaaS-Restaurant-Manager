/**
 * Desktop POS shell — native, no webview.
 *
 * Drives a tiny gate-based state machine:
 *   • no API URL              → ConnectionSettings
 *   • not authenticated       → Login
 *   • authenticated, no outlet → OutletPicker
 *   • outlet but no counter    → CounterPicker
 *   • counter but no open shift→ ShiftOpen
 *   • everything ready         → Workspace
 *
 * Every data op is an IPC call into the main process — see
 * `desktop/shared/ipc-contract.ts` for the full surface.
 */

import { useCallback, useEffect, useState } from "react";
import type { SessionSnapshot, User } from "../../shared/ipc-contract";
import { LoginScreen } from "./screens/Login";
import { OutletPickerScreen } from "./screens/OutletPicker";
import { CounterPickerScreen } from "./screens/CounterPicker";
import { ShiftOpenScreen } from "./screens/ShiftOpen";
import { WorkspaceRouter } from "./workspaces/WorkspaceRouter";
import { ConnectionSettingsScreen } from "./screens/ConnectionSettings";
import { CustomerDisplay } from "./screens/CustomerDisplay";
import { FullscreenCenter, Spinner } from "./ui/components";
import { setCurrentPrefsUserId } from "./hooks/useAppPrefs";

type Override = "settings" | "switch-outlet" | null;

// Customer-display second window: opened by the cashier via window.open
// with #display=customer in the hash. Renders a completely separate
// surface that just listens on a BroadcastChannel.
function isCustomerDisplayWindow(): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.hash.includes("display=customer")) return true;
  if (window.location.search.includes("display=customer")) return true;
  return false;
}

export function App() {
  if (isCustomerDisplayWindow()) {
    return <CustomerDisplay />;
  }
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [version, setVersion] = useState("");
  const [platform, setPlatform] = useState("");
  const [override, setOverride] = useState<Override>(null);
  const [online, setOnline] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    const snap = await window.khanalagao.session.snapshot();
    // Point useAppPrefs at the signed-in user so theme / density /
    // lock-PIN / etc are per-user on shared terminals. `null` resets
    // to the "_guest" scope used by the login + connection screens.
    setCurrentPrefsUserId(snap.auth.user?.id ?? null);
    setSnapshot(snap);
  }, []);

  useEffect(() => {
    (async () => {
      const [s, v, snap] = await Promise.all([
        window.khanalagao.settings.get(),
        window.khanalagao.app.version(),
        window.khanalagao.session.snapshot(),
      ]);
      setApiBaseUrl(s.apiBaseUrl);
      setVersion(v.version);
      setPlatform(v.platform);
      // Scope useAppPrefs to the signed-in user *before* rendering the
      // snapshot — otherwise the first paint reads "_guest" theme /
      // density / lock PIN even for persisted sessions on shared
      // terminals, which is exactly the bug per-user prefs are meant
      // to prevent. Mirror this in every refresh path below.
      setCurrentPrefsUserId(snap.auth.user?.id ?? null);
      setSnapshot(snap);
    })().catch(console.error);

    // Token-refresh failure → land back on login.
    const offAuth = window.khanalagao.auth.onInvalidated(() => {
      void refresh();
    });

    // Phase 5 — drive the online pill from the main-process /healthz probe
    // instead of `navigator.onLine`, which only reflects raw link state.
    let lastOnline = true;
    let hasShownOfflineToast = false;
    window.khanalagao.connectivity.get()
      .then((s) => { lastOnline = s.online; setOnline(s.online); })
      .catch(() => undefined);
    const offConn = window.khanalagao.connectivity.onChange((s) => {
      setOnline(s.online);
      // One-time toast when we *first* drop offline. Reset after a recovery
      // so a second outage in the same session still notifies the cashier.
      if (!s.online && lastOnline && !hasShownOfflineToast) {
        hasShownOfflineToast = true;
        try {
          // Lightweight DOM toast — Workspace will surface a proper banner
          // via the connectivity pill, but the toast gives an immediate cue.
          const div = document.createElement("div");
          div.textContent = "Offline mode — orders will sync when reconnected";
          div.setAttribute("role", "status");
          div.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;background:#1f2937;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,.2);";
          document.body.appendChild(div);
          setTimeout(() => div.remove(), 4500);
        } catch { /* renderer-only */ }
      }
      if (s.online && !lastOnline) hasShownOfflineToast = false;
      lastOnline = s.online;
    });

    return () => {
      offAuth();
      offConn();
    };
  }, [refresh]);

  // Once an outlet is picked, ask the server whether a shift is already open
  // (e.g. cashier crashed and reopened the app mid-shift). Skips on signed-out
  // state to avoid unnecessary 401s.
  useEffect(() => {
    if (!snapshot?.auth.isAuthenticated) return;
    if (!snapshot.selection.restaurantId) return;
    window.khanalagao.shifts.current()
      .then((r) => {
        if (r.session) void refresh();
      })
      .catch(() => { /* surfaced when user reaches ShiftOpen */ });
  }, [snapshot?.auth.isAuthenticated, snapshot?.selection.restaurantId, refresh]);

  // Loading
  if (!snapshot || apiBaseUrl === null) {
    return <FullscreenCenter><Spinner size={28} /></FullscreenCenter>;
  }

  // Settings override (always available via menu)
  if (override === "settings") {
    return (
      <ConnectionSettingsScreen
        initialUrl={apiBaseUrl}
        version={version}
        platform={platform}
        onSaved={(url) => { setApiBaseUrl(url); setOverride(null); }}
        onClose={() => setOverride(null)}
      />
    );
  }

  // Gate 1 — connection
  if (!apiBaseUrl) {
    return (
      <ConnectionSettingsScreen
        initialUrl=""
        version={version}
        platform={platform}
        onSaved={(url) => { setApiBaseUrl(url); }}
      />
    );
  }

  // Gate 2 — authentication
  if (!snapshot.auth.isAuthenticated || !snapshot.auth.user) {
    return (
      <LoginScreen
        apiBaseUrl={apiBaseUrl}
        onSignedIn={async (_user: User) => { await refresh(); }}
        onOpenSettings={() => setOverride("settings")}
      />
    );
  }

  const signOut = async () => {
    try { await window.khanalagao.auth.logout(); }
    finally { await refresh(); }
  };

  const switchOutlet = async () => {
    await window.khanalagao.session.clearSelection();
    setOverride(null);
    await refresh();
  };

  // Gate 3 — outlet (restaurant + branch)
  if (override === "switch-outlet" || !snapshot.selection.restaurantId || !snapshot.selection.branchId) {
    return (
      <OutletPickerScreen
        selection={snapshot.selection}
        onPicked={async () => { setOverride(null); await refresh(); }}
        onSignOut={signOut}
      />
    );
  }

  // Gate 4 — counter
  if (!snapshot.selection.counterId) {
    return (
      <CounterPickerScreen
        selection={snapshot.selection}
        onPicked={async () => { await refresh(); }}
        onBack={async () => {
          await window.khanalagao.selection.setRestaurant({ restaurantId: snapshot.selection.restaurantId! });
          await refresh();
        }}
      />
    );
  }

  // NOTE: the open-shift gate used to live here, forcing *every* role
  // through ShiftOpenScreen even when they were headed for Manager /
  // Inventory / Accounts / Marketing / Delivery — none of which need a
  // cash drawer to do their job. The gate now lives inside
  // WorkspaceRouter and is applied **only** when the user is entering
  // the Cashier workspace. Specialist roles can now sign in and reach
  // their workspace without first asking a cashier to open a shift.
  return (
    <WorkspaceRouter
      user={snapshot.auth.user}
      selection={snapshot.selection}
      shift={snapshot.shift}
      online={online}
      onOpenSettings={() => setOverride("settings")}
      onSignOut={signOut}
      onSwitchOutlet={switchOutlet}
      onRefresh={refresh}
    />
  );
}
