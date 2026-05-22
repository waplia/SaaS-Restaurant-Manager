/**
 * Normalize an image URL before storing it in the database.
 *
 * Different code paths produce different formats for object-storage paths:
 *   - Direct uploads (presigned PUT → finalize-public) yield raw "/objects/<id>"
 *   - AI photo generation also yields raw "/objects/<id>"
 *   - Stock library rows often carry the full "/api/public/storage/objects/<id>"
 *     prefix
 *   - Web clients sometimes pre-prefix the path before PATCH
 *
 * The frontends each have their own resolvers, but they only consistently
 * handle one form, so menu items end up rendering on some surfaces and
 * not others (e.g. shows on mobile but not on the web QR menu, or vice
 * versa).
 *
 * To keep every surface working with a single shape, normalize at write
 * time so `menu_items.image_url` is always either:
 *   - An absolute http(s) URL (untouched), or
 *   - "/api/public/storage/objects/<id>" (publicly reachable via the
 *     API server's public-storage route).
 */
export function normalizeStoredImageUrl(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/api/public/storage/")) return trimmed;
  if (trimmed.startsWith("/objects/")) return `/api/public/storage${trimmed}`;
  return trimmed;
}
