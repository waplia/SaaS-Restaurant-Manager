/**
 * Persistent app/user preferences for the desktop POS renderer.
 *
 * Stored as a single JSON blob in localStorage so the cashier's view choices
 * (menu layout, rail collapse, default tender, etc.) survive reloads. None
 * of these touch the backend.
 */
import { useCallback, useEffect, useState } from "react";

export type MenuLayout = "image" | "compact";
export type DefaultTender = "cash" | "upi" | "card";

export interface AppPrefs {
  /** Menu pane card layout. */
  menuLayout: MenuLayout;
  /** Show item images on tiles (off = label-only, faster scroll). */
  showItemImages: boolean;
  /** Compact cart rows (denser lines for high-volume counters). */
  compactCart: boolean;
  /** Default payment tender when opening the payment modal. */
  defaultTender: DefaultTender;
  /** Auto-print bill copy after payment success (handled main-side, this is a hint). */
  autoPrintBill: boolean;
  /** Auto-open cash drawer for non-cash tenders. */
  autoOpenDrawer: boolean;
  /** Start app directly on the POS screen (desktop wrapper hint). */
  startInPos: boolean;
  /** Launch in fullscreen kiosk mode. */
  fullscreen: boolean;
  /** Launch automatically when the OS user logs in. */
  autoLaunch: boolean;
  /** Keep the display awake while POS is foreground. */
  keepAwake: boolean;
  /** Cashier display name shown in the header / printed on bills. */
  cashierName: string;
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
