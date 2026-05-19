/* Khana Lagao service worker — app-shell caching + branded offline fallback.
 * Live data (API calls, websockets) always go to the network. */
const SW_VERSION = "v1";
const CACHE_NAME = `khanalagao-shell-${SW_VERSION}`;
const OFFLINE_URL = "offline.html";

const PRECACHE_URLS = [
  "offline.html",
  "manifest.webmanifest",
  "favicon.png",
  "favicon-32.png",
  "favicon.svg",
  "logo.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch (_err) {
            // Ignore missing assets so SW install still succeeds.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("khanalagao-shell-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API or websocket traffic.
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/socket")) {
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch (_err) {
          const cache = await caches.open(CACHE_NAME);
          const offline = await cache.match(OFFLINE_URL);
          return (
            offline ||
            new Response("Offline", {
              status: 503,
              headers: { "content-type": "text/plain" },
            })
          );
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        return res;
      } catch (_err) {
        if (cached) return cached;
        throw _err;
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// Web Push handler — accepts JSON payloads of shape
//   { title, body, url?, icon?, badge?, image?, data? }
// Falls back to a generic message when no payload is provided.
self.addEventListener("push", (event) => {
  let payload = { title: "TableTrack", body: "You have a new update." };
  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = {
        title: typeof parsed.title === "string" ? parsed.title : payload.title,
        body: typeof parsed.body === "string" ? parsed.body : payload.body,
        url: typeof parsed.url === "string" ? parsed.url : undefined,
        icon: typeof parsed.icon === "string" ? parsed.icon : undefined,
        badge: typeof parsed.badge === "string" ? parsed.badge : undefined,
        image: typeof parsed.image === "string" ? parsed.image : undefined,
        data: parsed.data ?? {},
      };
    } catch (_err) {
      try { payload.body = event.data.text() || payload.body; } catch (_err2) { /* ignore */ }
    }
  }
  const notificationOptions = {
    body: payload.body,
    icon: payload.icon || "logo.png",
    badge: payload.badge || "favicon.png",
    image: payload.image,
    tag: (payload.data && payload.data.tag) || "tt-notification",
    renotify: true,
    data: { ...(payload.data ?? {}), url: payload.url },
  };
  event.waitUntil(self.registration.showNotification(payload.title, notificationOptions));
});

// Focus the existing tab (or open a new one) when a notification is clicked.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification?.data || {};
  const targetUrl = data.url;
  const logId = data.logId;
  // Wrap targetUrl in click-tracking redirect when we have a logId.
  const navUrl = logId && targetUrl
    ? `/api/public/push/click/${encodeURIComponent(logId)}?u=${encodeURIComponent(targetUrl)}`
    : targetUrl;
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) {
      if ("focus" in client) {
        if (navUrl && "navigate" in client) {
          try { await client.navigate(navUrl); } catch (_err) { /* ignore */ }
        }
        return client.focus();
      }
    }
    if (navUrl && self.clients.openWindow) {
      return self.clients.openWindow(navUrl);
    }
    return null;
  })());
});
