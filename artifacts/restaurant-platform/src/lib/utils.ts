import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Localization driven by App Settings ────────────────────────
// AppSettingsProvider populates this at runtime via setLocaleDefaults().
let _localeDefaults = {
  currency: "INR",
  timezone: "Asia/Kolkata",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "12h" as "12h" | "24h",
};

export function setLocaleDefaults(d: Partial<typeof _localeDefaults>): void {
  _localeDefaults = { ..._localeDefaults, ...d };
}

export function getLocaleDefaults() {
  return _localeDefaults;
}

export function formatCurrency(amount: number | string | null | undefined): string {
  const n = typeof amount === "string" ? Number(amount) : amount ?? 0;
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: _localeDefaults.currency || "INR",
    }).format(n);
  } catch {
    return `${_localeDefaults.currency} ${n.toFixed(2)}`;
  }
}

export function formatDate(date: Date | string | number | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: _localeDefaults.timezone || undefined,
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function formatDateTime(date: Date | string | number | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: _localeDefaults.timezone || undefined,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      hour12: _localeDefaults.timeFormat !== "24h",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}
