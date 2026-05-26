/**
 * IPC handler registry.
 *
 * Maps every channel from `desktop/shared/ipc-contract.ts` to a main-process
 * implementation. Each handler is wrapped in a uniform try/catch that returns
 * `{ ok:true, data }` or `{ ok:false, error }` — the preload bridge unwraps
 * this so renderer code can `await` and `try/catch` like a normal function.
 */

import { ipcMain, app, shell, BrowserWindow } from "electron";
import type { IpcChannel, IpcContract, IpcEnvelope, SessionSnapshot } from "../../shared/ipc-contract";
import { ApiClient, ApiError } from "../api/client";
import { sessionStore } from "../session-store";

interface SettingsApi {
  get: () => { apiBaseUrl: string };
  set: (patch: { apiBaseUrl?: string }) => { apiBaseUrl: string };
}

export function registerApiIpc(opts: { client: ApiClient; settings: SettingsApi; getWindow: () => BrowserWindow | null }): void {
  const { client, settings, getWindow } = opts;

  client.onAuthLost(() => {
    getWindow()?.webContents.send("auth:invalidated");
  });

  function snapshot(): SessionSnapshot {
    const user = sessionStore.getUser();
    const tokens = sessionStore.getTokens();
    const sel = sessionStore.getSelection();
    const open = sessionStore.getOpenSession();
    return {
      auth: { isAuthenticated: !!user && !!tokens.accessToken, user },
      selection: sel,
      shift: { sessionId: open.id, openedAt: open.at },
    };
  }

  function handle<C extends IpcChannel>(
    channel: C,
    fn: (req: IpcContract[C]["req"]) => Promise<IpcContract[C]["res"]> | IpcContract[C]["res"],
  ): void {
    ipcMain.handle(channel, async (_e, req: IpcContract[C]["req"]): Promise<IpcEnvelope<IpcContract[C]["res"]>> => {
      try {
        const data = await fn(req);
        return { ok: true, data };
      } catch (err) {
        const message = err instanceof ApiError ? err.message
          : err instanceof Error ? err.message
          : String(err);
        return { ok: false, error: message };
      }
    });
  }

  function requireRestaurantId(): number {
    const sel = sessionStore.getSelection();
    const user = sessionStore.getUser();
    const id = sel.restaurantId ?? user?.restaurantId ?? null;
    if (!id) throw new Error("Pick a restaurant first.");
    return id;
  }

  // ─── App / settings / session snapshot ───────────────────────────────
  handle("settings:get", () => settings.get());
  handle("settings:set", (patch) => {
    const next = settings.set(patch);
    client.setBaseUrl(next.apiBaseUrl);
    return next;
  });
  handle("session:snapshot", () => snapshot());
  handle("session:clear-selection", () => {
    sessionStore.resetSelection();
    sessionStore.setOpenSession(null, null);
    return snapshot();
  });
  handle("app:version", () => ({ version: app.getVersion(), platform: process.platform }));
  handle("app:open-external", (url) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new Error("blocked");
    void shell.openExternal(url);
    return true as const;
  });

  // ─── Auth ────────────────────────────────────────────────────────────
  handle("auth:login", async ({ identifier, password, rememberDevice }) => {
    const r = await client.login(identifier, password);
    sessionStore.setTokens(r.accessToken, r.refreshToken);
    sessionStore.setUser(r.user);
    sessionStore.patchSelection({ rememberDevice: !!rememberDevice });
    // If the user only belongs to one restaurant, pre-select it.
    if (r.user.restaurantId && !sessionStore.getSelection().restaurantId) {
      sessionStore.patchSelection({ restaurantId: r.user.restaurantId });
    }
    return { user: r.user };
  });

  handle("auth:refresh", async () => {
    const { refreshToken } = sessionStore.getTokens();
    if (!refreshToken) throw new Error("No refresh token");
    const r = await client.request<{ accessToken: string; refreshToken: string }>(
      "/api/auth/refresh",
      { method: "POST", body: { refreshToken }, noAuth: true },
    );
    sessionStore.setTokens(r.accessToken, r.refreshToken);
    return { ok: true as const };
  });

  handle("auth:logout", async () => {
    await client.logout();
    sessionStore.clearAll();
    sessionStore.resetSelection();
    return true as const;
  });

  handle("auth:me", async () => {
    const user = await client.me();
    sessionStore.setUser(user);
    return user;
  });

  // ─── Restaurants / branches / terminals ──────────────────────────────
  handle("restaurants:list", () => client.listRestaurants());
  handle("branches:list", ({ restaurantId }) => client.listBranches(restaurantId));
  handle("terminals:list", ({ restaurantId }) => client.listTerminals(restaurantId));

  // ─── Selection ───────────────────────────────────────────────────────
  handle("selection:set-restaurant", ({ restaurantId }) => {
    return sessionStore.patchSelection({
      restaurantId,
      branchId: null, branchName: null,
      counterId: null, counterName: null,
    });
  });
  handle("selection:set-branch", ({ branchId, branchName }) => {
    return sessionStore.patchSelection({
      branchId, branchName,
      counterId: null, counterName: null,
    });
  });
  handle("selection:set-counter", ({ counterId, counterName }) => {
    return sessionStore.patchSelection({ counterId, counterName });
  });

  // ─── Shifts ──────────────────────────────────────────────────────────
  handle("shifts:current", async () => {
    const r = await client.currentShift(requireRestaurantId());
    sessionStore.setOpenSession(r.session?.id ?? null, r.session?.openedAt ?? null);
    return r;
  });

  handle("shifts:open", async ({ openingCash, notes }) => {
    const session = await client.openShift(requireRestaurantId(), Number(openingCash) || 0, notes);
    sessionStore.setOpenSession(session.id, session.openedAt);
    return session;
  });

  handle("shifts:close", async ({ sessionId, countedAmount, closeNotes }) => {
    const r = await client.closeShift(requireRestaurantId(), sessionId, countedAmount, closeNotes);
    sessionStore.setOpenSession(null, null);
    return r;
  });

  // ─── Phase 2+ placeholders ───────────────────────────────────────────
  handle("menu:list", () => { throw new Error("menu:list not yet implemented (Phase 2)"); });
  handle("menu:categories", () => { throw new Error("menu:categories not yet implemented (Phase 2)"); });
  handle("orders:list", () => { throw new Error("orders:list not yet implemented (Phase 2)"); });
  handle("orders:create", () => { throw new Error("orders:create not yet implemented (Phase 2)"); });
  handle("orders:update", () => { throw new Error("orders:update not yet implemented (Phase 2)"); });
  handle("customers:lookup", () => { throw new Error("customers:lookup not yet implemented (Phase 2)"); });
  handle("payments:record", () => { throw new Error("payments:record not yet implemented (Phase 4)"); });
}
