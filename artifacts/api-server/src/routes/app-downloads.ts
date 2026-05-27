/**
 * Restaurant-facing App Downloads endpoints.
 *
 * Returns the latest visible download per platform, filtered by the caller's
 * plan and explicit per-restaurant allowlists. Tracks view/download/guide
 * events to `app_download_logs`.
 */
import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  appDownloadsTable,
  appDownloadLogsTable,
  tenantsTable,
  restaurantsTable,
  type AppDownloadPlatform,
} from "../lib/db";
import { requireRole, STAFF_ROLES } from "../middleware/authorize";
import { ObjectStorageService, ObjectNotFoundError, ObjectStorageNotConfiguredError } from "../lib/objectStorage";

const objectStorageService = new ObjectStorageService();

const router = Router();

const PLATFORMS = ["android", "ios", "windows", "macos", "web"] as const;

async function getCallerPlanAndRestaurant(req: any): Promise<{ planId: number | null; restaurantId: number | null }> {
  let restaurantId: number | null = req.user?.restaurantId ?? null;
  if (!restaurantId && req.user?.tenantId) {
    const [r] = await db.select({ id: restaurantsTable.id })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.tenantId, req.user.tenantId))
      .limit(1);
    restaurantId = r?.id ?? null;
  }
  let planId: number | null = null;
  if (req.user?.tenantId) {
    const [t] = await db.select({ planId: tenantsTable.planId })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, req.user.tenantId));
    planId = t?.planId ?? null;
  }
  return { planId, restaurantId };
}

function rowVisibleTo(row: typeof appDownloadsTable.$inferSelect, planId: number | null, restaurantId: number | null, isSuperAdmin: boolean): boolean {
  if (isSuperAdmin) return true;
  if (!row.isVisible) return false;
  if (row.status === "archived") return false;
  if (Array.isArray(row.allowedPlansJson) && row.allowedPlansJson.length > 0) {
    if (planId == null || !row.allowedPlansJson.includes(planId)) return false;
  }
  if (Array.isArray(row.allowedRestaurantsJson) && row.allowedRestaurantsJson.length > 0) {
    if (restaurantId == null || !row.allowedRestaurantsJson.includes(restaurantId)) return false;
  }
  return true;
}

// Authenticated reads — any staff role can see what they're entitled to.
router.get("/app-downloads", requireRole(...STAFF_ROLES), async (req, res) => {
  const { planId, restaurantId } = await getCallerPlanAndRestaurant(req);
  const rows = await db.select().from(appDownloadsTable)
    .orderBy(desc(appDownloadsTable.isLatest), desc(appDownloadsTable.releaseDate), desc(appDownloadsTable.createdAt));
  const visible = rows.filter((r) => rowVisibleTo(r, planId, restaurantId, !!req.user?.isSuperAdmin));

  // For each platform, surface the latest visible (or most recent) entry plus
  // the full version history for that platform.
  const byPlatform: Record<string, { latest: any | null; versions: any[] }> = {};
  for (const p of PLATFORMS) {
    const list = visible.filter((v) => v.platform === p);
    const latest = list.find((v) => v.isLatest) ?? list[0] ?? null;
    byPlatform[p] = { latest, versions: list };
  }
  res.json({ platforms: byPlatform });
});

router.get("/app-downloads/:platform", requireRole(...STAFF_ROLES), async (req, res) => {
  const platform = req.params.platform as AppDownloadPlatform;
  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    return void res.status(400).json({ error: "Invalid platform" });
  }
  const { planId, restaurantId } = await getCallerPlanAndRestaurant(req);
  const rows = await db.select().from(appDownloadsTable)
    .where(eq(appDownloadsTable.platform, platform))
    .orderBy(desc(appDownloadsTable.isLatest), desc(appDownloadsTable.releaseDate), desc(appDownloadsTable.createdAt));
  const visible = rows.filter((r) => rowVisibleTo(r, planId, restaurantId, !!req.user?.isSuperAdmin));
  const latest = visible.find((v) => v.isLatest) ?? visible[0] ?? null;
  if (!latest) return void res.status(404).json({ error: "No download available for this platform" });
  res.json({ latest, versions: visible });
});

const TrackSchema = z.object({
  appDownloadId: z.number().int().positive().nullable().optional(),
  platform: z.enum(PLATFORMS),
  action: z.enum(["viewed", "downloaded", "opened_guide"]),
  version: z.string().trim().max(64).nullable().optional(),
});

/**
 * Resolve a short-lived signed GET URL for an uploaded binary, after
 * re-checking that the caller is still allowed to see this row. External /
 * store links are returned as-is — they're already public URLs.
 */
router.get("/app-downloads/:id/download-url", requireRole(...STAFF_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return void res.status(400).json({ error: "Invalid id" });
  const [row] = await db.select().from(appDownloadsTable).where(eq(appDownloadsTable.id, id));
  if (!row) return void res.status(404).json({ error: "Not found" });

  const { planId, restaurantId } = await getCallerPlanAndRestaurant(req);
  if (!rowVisibleTo(row, planId, restaurantId, !!req.user?.isSuperAdmin)) {
    return void res.status(403).json({ error: "Not available for your account" });
  }

  if (row.downloadType !== "uploaded_file") {
    if (!row.downloadUrl) return void res.status(404).json({ error: "No download URL configured" });
    return void res.json({ url: row.downloadUrl, kind: row.downloadType, expiresInSec: null });
  }

  const objectPath = row.uploadedFileUrl;
  if (!objectPath || !objectPath.startsWith("/objects/")) {
    return void res.status(404).json({ error: "Uploaded file is missing" });
  }
  try {
    const file = await objectStorageService.getObjectEntityFile(objectPath);
    const ttlSec = 300;
    // @google-cloud/storage v7's getSignedUrl works against the Replit
    // sidecar-backed storage client; we use it directly so we don't need to
    // export the private signObjectURL helper.
    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      version: "v4",
      expires: Date.now() + ttlSec * 1000,
    });
    res.json({ url: signedUrl, kind: "uploaded_file", expiresInSec: ttlSec });
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return void res.status(404).json({ error: "File is missing from storage" });
    if (err instanceof ObjectStorageNotConfiguredError) return void res.status(503).json({ error: err.message });
    req.log.error({ err }, "app-downloads: signed url failed");
    res.status(500).json({ error: `Couldn't generate download link: ${(err as Error).message}` });
  }
});

router.post("/app-downloads/track", requireRole(...STAFF_ROLES), async (req, res) => {
  const parsed = TrackSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const { restaurantId } = await getCallerPlanAndRestaurant(req);
  const ipRaw = req.ip ?? (req.headers["x-forwarded-for"] as string | undefined) ?? null;
  const ip = typeof ipRaw === "string" ? ipRaw.slice(0, 64) : null;
  const ua = typeof req.headers["user-agent"] === "string" ? (req.headers["user-agent"] as string).slice(0, 512) : null;

  await db.insert(appDownloadLogsTable).values({
    restaurantId: restaurantId ?? null,
    userId: req.user?.sub ?? null,
    appDownloadId: parsed.data.appDownloadId ?? null,
    platform: parsed.data.platform,
    action: parsed.data.action,
    version: parsed.data.version ?? null,
    ipAddress: ip,
    userAgent: ua,
  });
  res.json({ ok: true });
});

export default router;
