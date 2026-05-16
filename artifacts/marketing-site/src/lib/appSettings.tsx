import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

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
  demoModeEnabled: boolean;
  landingPageEnabled: boolean;
}

const DEFAULTS: PublicAppSettings = {
  appName: "KhanaLagao",
  logoUrl: "/logo.png",
  faviconUrl: "/favicon.png",
  primaryColor: "#f97316",
  secondaryColor: "#fb923c",
  supportEmail: "support@tabletrack.app",
  supportPhone: null, supportWhatsapp: null, companyAddress: null,
  defaultCurrency: "INR", defaultTimezone: "Asia/Kolkata",
  dateFormat: "DD/MM/YYYY", timeFormat: "12h",
  footerText: null, socialLinks: {},
  maintenanceMode: false, maintenanceMessage: null,
  signupEnabled: true, demoModeEnabled: false, landingPageEnabled: true,
};

const Ctx = createContext<PublicAppSettings>(DEFAULTS);
export function useAppSettings(): PublicAppSettings { return useContext(Ctx); }

function hexToHsl(hex: string): string | null {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const m = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
  if (!m) return null;
  const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hh = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) { case r: hh = (g - b) / d + (g < b ? 6 : 0); break; case g: hh = (b - r) / d + 2; break; case b: hh = (r - g) / d + 4; break; }
    hh *= 60;
  }
  return `${Math.round(hh)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery<PublicAppSettings>({
    queryKey: ["public-app-settings"],
    queryFn: async () => {
      const res = await fetch("/api/public/app-settings");
      if (!res.ok) throw new Error("Failed");
      return (await res.json()) as PublicAppSettings;
    },
    staleTime: 60_000,
  });
  const settings = data ?? DEFAULTS;
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const p = hexToHsl(settings.primaryColor); if (p) root.style.setProperty("--primary", p);
    const s = hexToHsl(settings.secondaryColor); if (s) root.style.setProperty("--secondary", s);
    if (settings.appName) document.title = `${settings.appName} — The Operating System for Modern Restaurants`;
    if (settings.faviconUrl) {
      let link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
      if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
      link.href = settings.faviconUrl;
    }
  }, [settings]);

  if (settings.maintenanceMode) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-semibold">{settings.appName} is under maintenance</h1>
          <p className="text-muted-foreground">{settings.maintenanceMessage ?? "We'll be back shortly."}</p>
        </div>
      </div>
    );
  }

  return <Ctx.Provider value={settings}>{children}</Ctx.Provider>;
}
