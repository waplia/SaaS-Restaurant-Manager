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
import { WorkspaceScreen } from "./screens/Workspace";
import { ConnectionSettingsScreen } from "./screens/ConnectionSettings";
import { FullscreenCenter, Spinner } from "./ui/components";

type Override = "settings" | "switch-outlet" | null;

export function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [version, setVersion] = useState("");
  const [platform, setPlatform] = useState("");
  const [override, setOverride] = useState<Override>(null);
  const [online, setOnline] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    const snap = await window.khanalagao.session.snapshot();
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

  // Gate 5 — open shift
  if (!snapshot.shift.sessionId) {
    return (
      <ShiftOpenScreen
        selection={snapshot.selection}
        user={snapshot.auth.user}
        onOpened={refresh}
        onBack={async () => {
          await window.khanalagao.selection.setBranch({
            branchId: snapshot.selection.branchId!,
            branchName: snapshot.selection.branchName ?? "",
          });
          await refresh();
        }}
      />
    );
  }

  // Workspace
  return (
    <WorkspaceScreen
      user={snapshot.auth.user}
      selection={snapshot.selection}
      shiftOpenedAt={snapshot.shift.openedAt}
      online={online}
      onOpenSettings={() => setOverride("settings")}
      onSignOut={signOut}
      onSwitchOutlet={switchOutlet}
    />
  );
}
