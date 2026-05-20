import { useEffect, useRef, useState } from "react";
import { useAppSettings } from "@/lib/appSettings";
import { useAuth, type AuthUser } from "@/lib/auth";
import { useLocation } from "wouter";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: {
            client_id: string;
            callback: (resp: { credential?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const GSI_SCRIPT_ID = "google-identity-services";

function ensureGsiScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.getElementById(GSI_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Identity Services")), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.id = GSI_SCRIPT_ID;
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(s);
  });
}

interface Props {
  label?: string;
  /** "login" (default) → server will refuse to create a new account for an
   * unknown Google identity. "register" → the explicit signup path. */
  mode?: "login" | "register";
  onCompleteProfileNeeded?: (info: { missing: { phone: boolean; restaurantName: boolean } }) => void;
}

export function GoogleSignInButton({ label = "Continue with Google", mode = "login", onCompleteProfileNeeded }: Props) {
  const settings = useAppSettings();
  const { acceptAuthPayload } = useAuth();
  const [, navigate] = useLocation();
  const btnRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [config, setConfig] = useState<{ enabled: boolean; clientId: string | null } | null>(null);

  // Settings may not yet include googleSignInEnabled (older cache) — fetch from
  // the dedicated config endpoint as the source of truth for the client id.
  useEffect(() => {
    if (settings.googleSignInEnabled === false) {
      setConfig({ enabled: false, clientId: null });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/google/config");
        if (!res.ok) throw new Error("Could not load Google config");
        const data = (await res.json()) as { enabled: boolean; clientId: string | null };
        if (!cancelled) setConfig(data);
      } catch {
        if (!cancelled) setConfig({ enabled: false, clientId: null });
      }
    })();
    return () => { cancelled = true; };
  }, [settings.googleSignInEnabled]);

  useEffect(() => {
    if (!config?.enabled || !config.clientId || !btnRef.current) return;
    let mounted = true;
    void (async () => {
      try {
        await ensureGsiScript();
        if (!mounted || !btnRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: config.clientId!,
          callback: async (resp) => {
            if (!resp.credential) { setErr("Google sign-in was cancelled."); return; }
            try {
              const r = await fetch("/api/auth/google/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ idToken: resp.credential, mode }),
              });
              const data = await r.json().catch(() => ({}));
              if (!r.ok) {
                throw new Error((data as { error?: string }).error ?? "Google sign-in failed");
              }
              const payload = data as {
                pending?: boolean;
                pendingToken?: string;
                accessToken?: string; refreshToken?: string; user?: AuthUser;
                needsProfileCompletion?: boolean;
                missing?: { phone: boolean; restaurantName: boolean };
              };
              if (payload.pending && payload.pendingToken) {
                sessionStorage.setItem("googlePendingToken", payload.pendingToken);
                sessionStorage.setItem("googleMissingRestaurant", payload.missing?.restaurantName ? "1" : "0");
                navigate("/complete-profile");
                return;
              }
              if (!payload.accessToken || !payload.refreshToken || !payload.user) {
                throw new Error("Unexpected response from server.");
              }
              acceptAuthPayload({ accessToken: payload.accessToken, refreshToken: payload.refreshToken, user: payload.user });
              if (payload.needsProfileCompletion && onCompleteProfileNeeded) {
                onCompleteProfileNeeded({ missing: payload.missing ?? { phone: false, restaurantName: false } });
              } else {
                navigate("/dashboard");
              }
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Google sign-in failed");
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        window.google.accounts.id.renderButton(btnRef.current, {
          theme: "outline",
          size: "large",
          width: btnRef.current.offsetWidth || 320,
          text: label === "Continue with Google" ? "continue_with" : "signin_with",
          shape: "rectangular",
          logo_alignment: "left",
        });
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Google sign-in unavailable");
      }
    })();
    return () => { mounted = false; };
  }, [config, acceptAuthPayload, navigate, onCompleteProfileNeeded, label]);

  if (!config?.enabled) return null;
  return (
    <div className="space-y-2">
      <div ref={btnRef} className="w-full flex justify-center min-h-[44px]" />
      {err && (
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {err}
        </div>
      )}
    </div>
  );
}

export function OrDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      <span>{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
