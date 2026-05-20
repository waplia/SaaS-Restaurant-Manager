/**
 * Resolve the API base URL for the mobile app.
 *
 * Resolution order:
 *   1. `EXPO_PUBLIC_API_BASE_URL` — explicit override baked at build time
 *      (set via `eas.json` env per profile, or exported in the shell).
 *      Used for staging / production EAS builds and for any local override.
 *   2. `EXPO_PUBLIC_DOMAIN` — the Replit dev domain wired by the
 *      `pnpm --filter @workspace/tabletrack-mobile run dev` script. Kept
 *      so the existing Expo Go dev flow on Replit keeps working.
 *   3. `REPLIT_DEV_DOMAIN` — same Replit dev domain, available when the
 *      bundle is built from inside the Replit container.
 *
 * Always returns a URL without a trailing slash so callers can safely
 * concatenate `/api/...` paths.
 */
function normalize(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  return value.replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  const explicit = normalize(process.env.EXPO_PUBLIC_API_BASE_URL);
  if (explicit) return explicit;

  const expoDomain = normalize(process.env.EXPO_PUBLIC_DOMAIN);
  if (expoDomain) return expoDomain;

  const replitDomain = normalize(process.env.REPLIT_DEV_DOMAIN);
  if (replitDomain) return replitDomain;

  // No domain configured — fall back to empty string so relative
  // `/api/...` paths still hit the host the bundle was loaded from when
  // running on the web preview. Native builds without an explicit value
  // will surface this as a network error on the first call, which is the
  // intended fail-loud behavior.
  return "";
}
