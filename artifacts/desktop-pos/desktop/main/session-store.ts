/**
 * Auth + selection state for the desktop POS.
 *
 * Tokens NEVER leave the main process — the renderer only sees opaque
 * `auth:login` / `auth:me` responses. Selection (restaurant/branch/counter)
 * is persisted so the cashier doesn't have to re-pick on every launch.
 */

import Store from "electron-store";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { SelectionState, User } from "../shared/ipc-contract";

/** Electron's OS-keychain-backed encryption — used to wrap the cached
 *  offline credential so a stolen session file alone can't yield the
 *  password hash. Loaded lazily because the module isn't available at
 *  import time in the vitest setup (electron is mocked). */
function loadSafeStorage(): {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(buf: Buffer): string;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require("electron") as { safeStorage?: {
      isEncryptionAvailable(): boolean;
      encryptString(s: string): Buffer;
      decryptString(buf: Buffer): string;
    } };
    return electron.safeStorage ?? null;
  } catch {
    return null;
  }
}

/** Offline-login credential — a scrypt hash of the password the cashier
 *  used the last time they signed in online. Used to validate the typed
 *  password locally when the device has no network so a stolen identifier
 *  alone can't unlock the till. */
export interface OfflineCredential {
  identifier: string;   // normalized: lowercased email / phone / name
  salt: string;         // hex
  hash: string;         // hex (scrypt N=16384, r=8, p=1, keylen=64)
  updatedAt: number;
}

export interface SessionShape {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  selection: SelectionState;
  /** ID of the open cash-register session, if any (mirrors server). */
  openSessionId: number | null;
  openSessionAt: string | null;
  /** Plain-JSON cached scrypt hash (used only when OS keychain encryption
   *  isn't available — e.g. Linux installs without libsecret). */
  offlineCredential: OfflineCredential | null;
  /** Base64-encoded ciphertext of the JSON-serialised OfflineCredential,
   *  encrypted via Electron `safeStorage` (OS keychain). Preferred over
   *  the plain field whenever it's present. */
  offlineCredentialEnc: string | null;
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
  offlineCredential: null,
  offlineCredentialEnc: null,
};

const SCRYPT_KEYLEN = 64;

function normalizeIdentifier(s: string): string {
  return s.trim().toLowerCase();
}

function hashPassword(password: string, saltHex: string): string {
  return scryptSync(password, Buffer.from(saltHex, "hex"), SCRYPT_KEYLEN).toString("hex");
}

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
    // Keep selection AND offlineCredential — the same cashier likely logs
    // back in at the same terminal, and they may do so offline.
  },
  /** Cache a scrypt hash of the password the cashier just entered on a
   *  successful online login so it can be re-verified locally next time
   *  the network is unavailable. The cached blob is wrapped with Electron
   *  `safeStorage` (OS keychain) when available; otherwise it falls back
   *  to electron-store's static-key obfuscation with a console warning. */
  setOfflineCredential(identifier: string, password: string): void {
    const cred: OfflineCredential = {
      identifier: normalizeIdentifier(identifier),
      salt: randomBytes(16).toString("hex"),
      hash: hashPassword(password, ""), // placeholder; overwritten below
      updatedAt: Date.now(),
    };
    cred.hash = hashPassword(password, cred.salt);
    const safe = loadSafeStorage();
    if (safe && safe.isEncryptionAvailable()) {
      const enc = safe.encryptString(JSON.stringify(cred)).toString("base64");
      store.set("offlineCredentialEnc", enc);
      store.set("offlineCredential", null);
    } else {
      console.warn("[session-store] safeStorage unavailable — caching offline credential with static-key obfuscation only.");
      store.set("offlineCredential", cred);
      store.set("offlineCredentialEnc", null);
    }
  },
  getOfflineCredential(): OfflineCredential | null {
    const enc = store.get("offlineCredentialEnc") ?? null;
    const safe = loadSafeStorage();
    if (enc && safe && safe.isEncryptionAvailable()) {
      try {
        return JSON.parse(safe.decryptString(Buffer.from(enc, "base64"))) as OfflineCredential;
      } catch {
        return null;
      }
    }
    return store.get("offlineCredential") ?? null;
  },
  /** Verify an identifier+password against the locally cached scrypt hash.
   *  Returns false when no credential is cached, the identifier doesn't
   *  match the last online login, or the password is wrong. Uses constant-
   *  time comparison so a wrong password can't be detected by timing. */
  verifyOfflineCredential(identifier: string, password: string): boolean {
    const cred = this.getOfflineCredential();
    if (!cred) return false;
    if (cred.identifier !== normalizeIdentifier(identifier)) return false;
    const candidate = Buffer.from(hashPassword(password, cred.salt), "hex");
    const expected = Buffer.from(cred.hash, "hex");
    if (candidate.length !== expected.length) return false;
    return timingSafeEqual(candidate, expected);
  },
};
