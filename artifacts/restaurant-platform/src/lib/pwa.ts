export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function resolveBase(): string {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  return base.endsWith("/") ? base : `${base}/`;
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (import.meta.env?.DEV) return;

  const base = resolveBase();
  const swUrl = `${base}sw.js`;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(swUrl, { scope: base }).catch((err) => {
      console.warn("[pwa] service worker registration failed", err);
    });
  });
}
