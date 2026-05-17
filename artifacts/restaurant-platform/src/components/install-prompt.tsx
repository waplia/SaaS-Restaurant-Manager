import { useEffect, useState } from "react";
import type { InstallPromptEvent } from "@/lib/pwa";

const DISMISS_KEY = "khanalagao-install-dismissed-at";
const DISMISS_TTL_MS = 1000 * 60 * 60 * 24 * 14;

function wasRecentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const [evt, setEvt] = useState<InstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (wasRecentlyDismissed()) return;

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallPromptEvent);
      setVisible(true);
    };

    const installedHandler = () => {
      setEvt(null);
      setVisible(false);
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  if (!visible || !evt) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setVisible(false);
  };

  const install = async () => {
    try {
      await evt.prompt();
      await evt.userChoice;
    } catch {
      // ignore
    }
    setEvt(null);
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Install Khana Lagao"
      style={{
        position: "fixed",
        zIndex: 9999,
        left: "50%",
        bottom: 16,
        transform: "translateX(-50%)",
        maxWidth: 420,
        width: "calc(100% - 32px)",
        background: "white",
        color: "#1c1917",
        border: "1px solid #f1e0d2",
        borderRadius: 12,
        boxShadow: "0 12px 32px rgba(0,0,0,0.16)",
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ flex: 1, fontSize: 14, lineHeight: 1.4 }}>
        <div style={{ fontWeight: 600 }}>Install Khana Lagao</div>
        <div style={{ color: "#57534e" }}>
          Add to your device for quicker access and a full-screen window.
        </div>
      </div>
      <button
        onClick={dismiss}
        style={{
          background: "transparent",
          border: "1px solid #e7e5e4",
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        Not now
      </button>
      <button
        onClick={install}
        style={{
          background: "#e25a0f",
          color: "white",
          border: 0,
          borderRadius: 8,
          padding: "6px 12px",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Install
      </button>
    </div>
  );
}
