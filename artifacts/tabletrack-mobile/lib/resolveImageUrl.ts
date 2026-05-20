import { getApiBaseUrl } from "./apiBaseUrl";

/**
 * Mobile equivalent of the web `resolveImageUrl` helper. Converts the
 * relative storage paths returned by the API (e.g. `/objects/uploads/foo.jpg`)
 * into a fully-qualified URL the React Native `<Image>` component can load.
 *
 * - Absolute `http(s)://` and `data:`/`file:` URLs are returned unchanged.
 * - `/objects/...` paths are prefixed with the API base URL + `/api/public/storage`.
 * - Falsy/empty values return `null` so callers can render their placeholder.
 */
export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;
  if (/^(https?:|data:|file:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/objects/")) {
    const base = getApiBaseUrl().replace(/\/+$/, "");
    return `${base}/api/public/storage${trimmed}`;
  }
  return trimmed;
}
