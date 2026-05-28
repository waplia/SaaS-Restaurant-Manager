/**
 * Persistent app/user preferences for the desktop POS renderer.
 *
 * Stored as a single JSON blob in localStorage so cashier view choices
 * (menu layout, theme, density, tender, sound, PIN, customer-display)
 * survive reloads. None of these touch the backend.
 */
import { useCallback, useEffect, useState } from "react";

export type MenuLayout = "image" | "compact" | "fast";
export type DefaultTender = "cash" | "upi" | "card";
export type ThemeMode = "dark" | "light";
export type Density = "comfortable" | "compact" | "large-touch";
export type StaffRole = "cashier" | "waiter" | "manager";

export interface AppPrefs {
  /** Menu pane card layout. */
  menuLayout: MenuLayout;
  /** Show item images on tiles (off = label-only, faster scroll). */
  showItemImages: boolean;
  /** Compact cart rows (denser lines for high-volume counters). */
  compactCart: boolean;
  /** Default payment tender when opening the payment modal. */
  defaultTender: DefaultTender;
  /** Auto-print bill copy after payment success (hint to main). */
  autoPrintBill: boolean;
  /** Auto-open cash drawer for non-cash tenders. */
  autoOpenDrawer: boolean;
  /** Start app directly on the POS screen. */
  startInPos: boolean;
  /** Launch in fullscreen kiosk mode. */
  fullscreen: boolean;
  /** Launch automatically when the OS user logs in. */
  autoLaunch: boolean;
  /** Keep the display awake while POS is foreground. */
  keepAwake: boolean;
  /** Cashier display name shown in the header / printed on bills. */
  cashierName: string;
  /** Theme — dark (default) or light. Drives CSS vars. */
  theme: ThemeMode;
  /** UI density — affects padding / typography scale. */
  density: Density;
  /** Operational role of the signed-in user on this terminal. Drives
   *  which screens & destructive actions are gated. */
  role: StaffRole;
  /** Warn before quitting/reloading when there's unsaved local state. */
  warnBeforeExit: boolean;
  /** SHA-256 of the optional 4–8 digit PIN used to unlock and for the
   *  manager-PIN gate. Empty string = no PIN set. */
  lockPinHash: string;
  /** Customer-display second-screen on/off. */
  customerDisplay: boolean;
  /** Customer-display tagline shown when idle. */
  customerDisplayTagline: string;
}

const DEFAULTS: AppPrefs = {
  menuLayout: "image",
  showItemImages: true,
  compactCart: false,
  defaultTender: "cash",
  autoPrintBill: true,
  autoOpenDrawer: true,
  startInPos: true,
  fullscreen: false,
  autoLaunch: false,
  keepAwake: true,
  cashierName: "",
  theme: "dark",
  density: "comfortable",
  role: "cashier",
  warnBeforeExit: true,
  lockPinHash: "",
  customerDisplay: false,
  customerDisplayTagline: "Welcome — Thank you for dining with us",
};

/**
 * Storage scoping
 *
 * Prefs are stored per user so shared terminals don't leak one
 * cashier's theme / density / lock PIN / role to the next. App.tsx
 * calls `setCurrentPrefsUserId(user.id)` immediately after auth; before
 * that (login screen, etc) we fall back to the legacy "_guest" key.
 *
 * For a one-shot migration, when a user-scoped key is missing we copy
 * the legacy global blob into the new user-scoped key on first read —
 * so existing terminals don't lose their settings on first launch
 * after the upgrade.
 */
const LEGACY_KEY = "kp:appPrefs";
const KEY_PREFIX = "kp:appPrefs:u:";
let CURRENT_USER_ID: string = "_guest";
const subscribers = new Set<() => void>();

export function setCurrentPrefsUserId(id: number | string | null | undefined) {
  const next = id == null ? "_guest" : String(id);
  if (next === CURRENT_USER_ID) return;
  CURRENT_USER_ID = next;
  for (const fn of subscribers) fn();
}

function storageKeyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function readPrefs(): AppPrefs {
  const key = storageKeyFor(CURRENT_USER_ID);
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppPrefs>) };
    // First read for this user — seed from the legacy global blob if
    // present so existing installs keep their settings.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = { ...DEFAULTS, ...(JSON.parse(legacy) as Partial<AppPrefs>) };
      try { localStorage.setItem(key, JSON.stringify(parsed)); } catch { /* ignore */ }
      return parsed;
    }
    return { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function writePrefs(p: AppPrefs) {
  const key = storageKeyFor(CURRENT_USER_ID);
  try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* ignore */ }
}

/** Bare read for non-React callers. */
export function getAppPrefs(): AppPrefs { return readPrefs(); }

export function useAppPrefs() {
  const [prefs, setPrefs] = useState<AppPrefs>(() => readPrefs());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key && (e.key === storageKeyFor(CURRENT_USER_ID) || e.key === LEGACY_KEY)) {
        setPrefs(readPrefs());
      }
    };
    const onUserSwitch = () => setPrefs(readPrefs());
    window.addEventListener("storage", onStorage);
    subscribers.add(onUserSwitch);
    return () => {
      window.removeEventListener("storage", onStorage);
      subscribers.delete(onUserSwitch);
    };
  }, []);

  const update = useCallback((patch: Partial<AppPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch };
      writePrefs(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setPrefs(DEFAULTS);
    writePrefs(DEFAULTS);
  }, []);

  return { prefs, update, reset };
}

/** SHA-256 hex digest. Used for the optional terminal-lock PIN. */
export async function hashPin(pin: string): Promise<string> {
  const enc = new TextEncoder().encode(pin);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0")).join("");
}
