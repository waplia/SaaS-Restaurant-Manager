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

const STORAGE_KEY = "kp:appPrefs";

function readPrefs(): AppPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AppPrefs>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function writePrefs(p: AppPrefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/** Bare read for non-React callers. */
export function getAppPrefs(): AppPrefs { return readPrefs(); }

export function useAppPrefs() {
  const [prefs, setPrefs] = useState<AppPrefs>(() => readPrefs());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setPrefs(readPrefs());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
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
