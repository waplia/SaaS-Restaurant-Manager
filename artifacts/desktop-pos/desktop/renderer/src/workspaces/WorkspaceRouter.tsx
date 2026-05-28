/**
 * Top-level workspace router.
 *
 * Picks the workspace based on the signed-in user's role + an optional
 * per-user override from localStorage (set by the in-app role switcher).
 * Renders a clear "no workspace available" fallback when the user's role
 * doesn't map to any workspace — this is the safety net the task calls
 * for when permissions don't line up with a deployable surface.
 *
 * NOTE: This module relies on `auth:me` returning a single `role` string
 * and assembles permissions client-side via `deriveAccess`. Once the
 * backend exposes structured permissions on the `me` endpoint, replace
 * `deriveAccess` with the server payload — this is the only hot wire
 * that needs to change. See `roles.ts` for the bridge.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Branch, SessionSnapshot, SelectionState, User } from "../../../shared/ipc-contract";
import { Button, BrandHeader, FullscreenCenter, colors } from "../ui/components";
import { WorkspaceScreen } from "../screens/Workspace";
import { ShiftOpenScreen } from "../screens/ShiftOpen";
import { DesktopShell } from "./DesktopShell";
import { NAV_BY_WORKSPACE } from "./navConfigs";
import {
  WORKSPACES, availableWorkspaces, defaultWorkspace,
} from "./roles";
import type { WorkspaceKey } from "./types";

interface Props {
  user: User;
  selection: SelectionState;
  shift: SessionSnapshot["shift"];
  online: boolean;
  onOpenSettings: () => void;
  onSignOut: () => void;
  onSwitchOutlet: () => void;
  onRefresh: () => Promise<void> | void;
}

function overrideKey(userId: number | string) { return `kp:wsOverride:${userId}`; }

function readOverride(userId: number | string): WorkspaceKey | null {
  try {
    const raw = localStorage.getItem(overrideKey(userId));
    if (!raw) return null;
    if ((["cashier","manager","inventory","accountant","marketing","delivery"] as const).includes(raw as WorkspaceKey)) {
      return raw as WorkspaceKey;
    }
  } catch { /* ignore */ }
  return null;
}

export function WorkspaceRouter(props: Props) {
  const { user } = props;
  const available = useMemo(() => availableWorkspaces(user), [user]);
  const fallback = useMemo(() => defaultWorkspace(user), [user]);
  const [active, setActive] = useState<WorkspaceKey | null>(() => {
    const stored = readOverride(user.id);
    if (stored && available.includes(stored)) return stored;
    return fallback;
  });

  // Outlet count — the "Switch outlet / counter" affordance is only
  // useful when the tenant actually has more than one branch. Polled
  // once on mount; refreshed when restaurantId changes.
  const [outletCount, setOutletCount] = useState<number>(1);
  useEffect(() => {
    if (user.restaurantId == null) { setOutletCount(1); return; }
    let alive = true;
    window.khanalagao?.branches?.list({ restaurantId: user.restaurantId })
      .then((bs: Branch[]) => { if (alive) setOutletCount(Math.max(1, bs.length)); })
      .catch(() => { if (alive) setOutletCount(1); });
    return () => { alive = false; };
  }, [user.restaurantId]);

  // If the user list changes (e.g. role updated via me-refresh) and the
  // override is no longer reachable, fall back automatically.
  useEffect(() => {
    if (active && !available.includes(active)) setActive(fallback);
  }, [active, available, fallback]);

  const switchTo = useCallback((k: WorkspaceKey) => {
    if (!available.includes(k)) return;
    try { localStorage.setItem(overrideKey(user.id), k); } catch { /* ignore */ }
    setActive(k);
  }, [available, user.id]);

  if (!active) {
    return <NoWorkspaceScreen user={user} onSignOut={props.onSignOut} />;
  }

  // Cashier-only shift gate. Specialist workspaces (manager, inventory,
  // accountant, marketing, delivery) don't run a cash drawer, so they
  // can enter their workspace without an open shift. Cashier still
  // demands an open shift before the POS surface renders — a closed
  // drawer there is a real correctness issue (no `sessionId` to attach
  // payments to). The "back" button drops them into the workspace
  // switcher by going back to the counter selection if a non-cashier
  // workspace is reachable, otherwise back to the outlet picker.
  if (active === "cashier" && !props.shift.sessionId) {
    return (
      <ShiftOpenScreen
        selection={props.selection}
        user={user}
        onOpened={() => { void props.onRefresh(); }}
        onBack={async () => {
          // If the user has somewhere else to go, drop into that
          // workspace instead of forcing them through the outlet picker.
          const other = available.find(k => k !== "cashier");
          if (other) { switchTo(other); return; }
          await window.khanalagao.selection.setBranch({
            branchId: props.selection.branchId!,
            branchName: props.selection.branchName ?? "",
          });
          await props.onRefresh();
        }}
      />
    );
  }

  // Cashier keeps its existing POS-optimized shell unchanged — we just
  // pass the workspace switcher through so it can render the dropdown
  // when the user has access to more than one workspace.
  if (active === "cashier") {
    return (
      <WorkspaceScreen
        user={user}
        selection={props.selection}
        shiftOpenedAt={props.shift.openedAt}
        online={props.online}
        onOpenSettings={props.onOpenSettings}
        onSignOut={props.onSignOut}
        onSwitchOutlet={props.onSwitchOutlet}
        availableWorkspaces={available}
        outletCount={outletCount}
        onSwitchWorkspace={switchTo}
      />
    );
  }

  const nav = NAV_BY_WORKSPACE[active];
  return (
    <DesktopShell
      user={user}
      selection={props.selection}
      online={props.online}
      workspaceKey={active}
      availableWorkspaces={available}
      outletCount={outletCount}
      navItems={nav}
      onSwitchWorkspace={switchTo}
      onSwitchOutlet={props.onSwitchOutlet}
      onOpenSettings={props.onOpenSettings}
      onSignOut={props.onSignOut}
    />
  );
}

function NoWorkspaceScreen({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  return (
    <FullscreenCenter>
      <div style={{
        width: 460, background: colors.panel,
        border: `1px solid ${colors.border}`, borderRadius: 16, padding: 36,
        textAlign: "center",
      }}>
        <BrandHeader subtitle="No workspace available" />
        <p style={{ color: colors.textDim, fontSize: 13, lineHeight: 1.6 }}>
          Your account ({user.name} · <code>{user.role}</code>) doesn't have
          access to any desktop workspace yet. Ask an admin to grant a role
          from the list below, or sign in with a different account.
        </p>
        <ul style={{
          textAlign: "left", color: colors.textDim, fontSize: 13,
          margin: "16px auto", maxWidth: 320, lineHeight: 1.8,
        }}>
          {Object.values(WORKSPACES).map(w => (
            <li key={w.key}><b style={{ color: colors.textPrimary }}>{w.label}</b> — {w.description}</li>
          ))}
        </ul>
        <Button onClick={onSignOut} style={{ marginTop: 8 }}>Sign out</Button>
      </div>
    </FullscreenCenter>
  );
}
