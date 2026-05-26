/**
 * Auth + selection state for the desktop POS.
 *
 * Tokens NEVER leave the main process — the renderer only sees opaque
 * `auth:login` / `auth:me` responses. Selection (restaurant/branch/counter)
 * is persisted so the cashier doesn't have to re-pick on every launch.
 */

import Store from "electron-store";
import type { SelectionState, User } from "../shared/ipc-contract";

export interface SessionShape {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  selection: SelectionState;
  /** ID of the open cash-register session, if any (mirrors server). */
  openSessionId: number | null;
  openSessionAt: string | null;
}

const DEFAULT_SELECTION: SelectionState = {
  restaurantId: null,
  branchId: null,
  branchName: null,
  counterId: null,
  counterName: null,
  rememberDevice: false,
};

const DEFAULT_SESSION: SessionShape = {
  accessToken: null,
  refreshToken: null,
  user: null,
  selection: DEFAULT_SELECTION,
  openSessionId: null,
  openSessionAt: null,
};

interface PersistentStore<T> {
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clear(): void;
}

const store = new Store<SessionShape>({
  name: "khanalagao-pos-session",
  defaults: DEFAULT_SESSION,
  // electron-store handles encryption-at-rest via key obfuscation — good
  // enough for a cashier terminal, not bank-grade. Refresh tokens rotate.
  encryptionKey: "khanalagao-pos-session-v1",
}) as unknown as PersistentStore<SessionShape>;

export const sessionStore = {
  getTokens(): { accessToken: string | null; refreshToken: string | null } {
    return {
      accessToken: store.get("accessToken") ?? null,
      refreshToken: store.get("refreshToken") ?? null,
    };
  },
  setTokens(accessToken: string | null, refreshToken: string | null): void {
    store.set("accessToken", accessToken);
    store.set("refreshToken", refreshToken);
  },
  getUser(): User | null {
    return store.get("user") ?? null;
  },
  setUser(user: User | null): void {
    store.set("user", user);
  },
  getSelection(): SelectionState {
    return { ...DEFAULT_SELECTION, ...(store.get("selection") ?? {}) };
  },
  patchSelection(patch: Partial<SelectionState>): SelectionState {
    const next = { ...this.getSelection(), ...patch };
    store.set("selection", next);
    return next;
  },
  resetSelection(): SelectionState {
    store.set("selection", DEFAULT_SELECTION);
    return DEFAULT_SELECTION;
  },
  getOpenSession(): { id: number | null; at: string | null } {
    return { id: store.get("openSessionId") ?? null, at: store.get("openSessionAt") ?? null };
  },
  setOpenSession(id: number | null, at: string | null): void {
    store.set("openSessionId", id);
    store.set("openSessionAt", at);
  },
  clearAll(): void {
    store.set("accessToken", null);
    store.set("refreshToken", null);
    store.set("user", null);
    store.set("openSessionId", null);
    store.set("openSessionAt", null);
    // Keep selection — they likely log back in at the same terminal.
  },
};
