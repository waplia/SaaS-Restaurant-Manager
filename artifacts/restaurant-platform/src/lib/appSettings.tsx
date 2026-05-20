import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { setLocaleDefaults } from "@/lib/utils";

export interface PublicAppSettings {
  appName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  supportEmail: string;
  supportPhone: string | null;
  supportWhatsapp: string | null;
  companyAddress: string | null;
  defaultCurrency: string;
  defaultTimezone: string;
  dateFormat: string;
  timeFormat: string;
  footerText: string | null;
  socialLinks: Record<string, string>;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  signupEnabled: boolean;
  landingPageEnabled: boolean;
  authPasswordLoginEnabled?: boolean;
  authMobileOtpLoginEnabled?: boolean;
  authEmailOtpLoginEnabled?: boolean;
  authTwoFactorEnabled?: boolean;
  authSelfRegistrationRequireMobileOtp?: boolean;
  authOtpDefaultChannel?: "sms" | "whatsapp";
  googleSignInEnabled?: boolean;
}

const DEFAULTS: PublicAppSettings = {
  appName: "KhanaLagao",
  logoUrl: "/logo.png",
  faviconUrl: "/favicon.png",
  primaryColor: "#f97316",
  secondaryColor: "#fb923c",
  supportEmail: "support@khanalagao.app",
  supportPhone: null,
  supportWhatsapp: null,
  companyAddress: null,
  defaultCurrency: "INR",
  defaultTimezone: "Asia/Kolkata",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "12h",
  footerText: null,
  socialLinks: {},
  maintenanceMode: false,
  maintenanceMessage: null,
  signupEnabled: true,
  landingPageEnabled: true,
};

const Ctx = createContext<PublicAppSettings>(DEFAULTS);

export function useAppSettings(): PublicAppSettings {
  return useContext(Ctx);
}

function hexToHsl(hex: string): string | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.replace(/^#/, "").length === 3
    ? "#" + hex.replace(/^#/, "").split("").map((c) => c + c).join("")
    : hex);
  if (!m) return null;
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function applyBranding(s: PublicAppSettings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const p = hexToHsl(s.primaryColor);
  const sec = hexToHsl(s.secondaryColor);
  if (p) root.style.setProperty("--primary", p);
  if (sec) root.style.setProperty("--secondary", sec);
  if (s.appName) document.title = s.appName;
  if (s.faviconUrl) {
    let link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = s.faviconUrl;
  }
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data } = useQuery<PublicAppSettings>({
    queryKey: ["public-app-settings"],
    queryFn: async () => {
      const res = await fetch("/api/public/app-settings");
      if (!res.ok) throw new Error("Failed to load app settings");
      return (await res.json()) as PublicAppSettings;
    },
    staleTime: 60_000,
  });
  const settings = data ?? DEFAULTS;
  useEffect(() => {
    applyBranding(settings);
    setLocaleDefaults({
      currency: settings.defaultCurrency,
      timezone: settings.defaultTimezone,
      dateFormat: settings.dateFormat,
      timeFormat: settings.timeFormat as "12h" | "24h",
    });
  }, [settings]);

  // Allow auth pages through during maintenance so super admins can sign in
  // and toggle the flag off, even when no session exists yet.
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const isAuthPath = /\/(login|register|forgot-password|reset-password)(\/|$)/.test(path);

  // Super admins always reach the app shell so they can toggle maintenance off.
  if (settings.maintenanceMode && !user?.isSuperAdmin && !isAuthPath) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-semibold">{settings.appName} is under maintenance</h1>
          <p className="text-muted-foreground">
            {settings.maintenanceMessage ?? "We'll be back shortly. Thanks for your patience."}
          </p>
          <p className="text-xs text-muted-foreground">
            Super admins can still sign in to manage settings.
          </p>
          <a href="/app/login" className="inline-block text-sm text-primary underline">Sign in</a>
        </div>
      </div>
    );
  }

  return (
    <Ctx.Provider value={settings}>
      {settings.maintenanceMode && user?.isSuperAdmin && (
        <div className="bg-amber-500 text-amber-950 text-center text-xs py-1.5 px-4 font-medium">
          Maintenance mode is ON — only super admins can access the platform. Disable it in App Settings.
        </div>
      )}
      {children}
    </Ctx.Provider>
  );
}

// ─── Localization helpers driven by app settings ─────────────────
export function formatCurrencyWithSettings(amount: number, settings: PublicAppSettings): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: settings.defaultCurrency || "INR",
    }).format(amount);
  } catch {
    return `${settings.defaultCurrency} ${amount.toFixed(2)}`;
  }
}

export function formatDateWithSettings(date: Date | string, settings: PublicAppSettings): string {
  const d = typeof date === "string" ? new Date(date) : date;
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: settings.defaultTimezone || undefined,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      hour12: settings.timeFormat !== "24h",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}
