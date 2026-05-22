import { getApiBaseUrl } from "./apiBaseUrl";

/**
 * Mobile equivalent of the web `resolveImageUrl` helper. Converts the
 * relative storage paths returned by the API into a fully-qualified URL the
 * React Native `<Image>` component can load.
 *
 * Accepted shapes:
 * - Absolute `http(s)://`, `data:`, and `file:` URLs — returned unchanged.
 * - `/api/...` (e.g. `/api/public/storage/objects/...`, the canonical shape
 *    written by the AI menu importer) — prefixed with the API base URL.
 * - `/objects/...` (legacy raw object-storage path) — prefixed with API base
 *    URL + `/api/public/storage`.
 * - Any other `/`-rooted path — prefixed with the API base URL (so things
 *    like `/uploads/...` also work).
 * - Falsy/empty values return `null` so callers can render their placeholder.
 *
 * The web side renders these through the iframe origin so a bare `/api/...`
 * works automatically, but on native a relative URI resolves against the
 * Expo packager and 404s — hence the explicit base-URL prefix here.
 */
export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;
  if (/^(https?:|data:|file:)/i.test(trimmed)) return trimmed;
  const base = getApiBaseUrl().replace(/\/+$/, "");
  if (trimmed.startsWith("/objects/")) {
    return `${base}/api/public/storage${trimmed}`;
  }
  if (trimmed.startsWith("/")) {
    return `${base}${trimmed}`;
  }
  return trimmed;
}
