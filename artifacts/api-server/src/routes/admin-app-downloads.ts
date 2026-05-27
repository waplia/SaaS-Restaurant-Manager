/**
 * Super-Admin: App Downloads manager.
 *
 * CRUD for platform/version rows in `app_downloads`, including the
 * presigned-upload + finalize flow for APK/AAB/EXE/DMG/ZIP/image binaries
 * via the shared ObjectStorageService. Read-only analytics aggregates
 * over `app_download_logs`.
 */
import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  appDownloadsTable,
  appDownloadLogsTable,
  auditLogsTable,
  type AppDownloadPlatform,
  type AppDownloadStatus,
  type AppDownloadType,
} from "../lib/db";
import { requireSuperAdmin } from "../middleware/authorize";
import {
  ObjectStorageService,
  ObjectStorageNotConfiguredError,
  ObjectNotFoundError,
} from "../lib/objectStorage";
import { setObjectAclPolicy } from "../lib/objectAcl";

const router = Router();
const objectStorageService = new ObjectStorageService();

const PLATFORMS = ["android", "ios", "windows", "macos", "web"] as const;
const STATUSES = ["available", "coming_soon", "deprecated", "archived"] as const;
const TYPES = ["uploaded_file", "external_link", "store_link"] as const;

// Allowed file extension per platform for uploaded_file downloads.
const EXT_BY_PLATFORM: Record<AppDownloadPlatform, string[]> = {
  android: [".apk", ".aab"],
  ios: [".ipa", ".zip"],
  windows: [".exe", ".msi", ".zip"],
  macos: [".dmg", ".pkg", ".zip"],
  web: [".zip"],
};
const MAX_BINARY_BYTES = 500 * 1024 * 1024; // 500 MB cap
const MAX_ICON_BYTES = 5 * 1024 * 1024;

const RowSchema = z.object({
  platform: z.enum(PLATFORMS),
  appName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  version: z.string().trim().min(1).max(64),
  buildNumber: z.string().trim().max(64).nullable().optional(),
  releaseDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(STATUSES).optional(),
  downloadType: z.enum(TYPES),
  downloadUrl: z.string().trim().max(2048).nullable().optional(),
  uploadedFileUrl: z.string().trim().max(2048).nullable().optional(),
  fileSize: z.number().int().nonnegative().nullable().optional(),
  iconUrl: z.string().trim().max(2048).nullable().optional(),
  minimumOsVersion: z.string().trim().max(64).nullable().optional(),
  systemRequirements: z.string().trim().max(2000).nullable().optional(),
  releaseNotes: z.string().trim().max(20000).nullable().optional(),
  installationGuide: z.string().trim().max(20000).nullable().optional(),
  isLatest: z.boolean().optional(),
  isVisible: z.boolean().optional(),
  forceUpdate: z.boolean().optional(),
  recommendedUpdate: z.boolean().optional(),
  allowedPlansJson: z.array(z.number().int().positive()).nullable().optional(),
  allowedRestaurantsJson: z.array(z.number().int().positive()).nullable().optional(),
});

function validateDownloadRef(body: z.infer<typeof RowSchema>) {
  if (body.downloadType === "uploaded_file") {
    // The per-platform extension allow-list is enforced at presign time
    // against the original filename. Object storage assigns an
    // extensionless key (`uploads/<uuid>`) so we don't re-check the suffix
    // here — we only require that an object reference is present.
    if (!body.uploadedFileUrl) return "uploadedFileUrl is required for uploaded_file downloads";
    if (!body.uploadedFileUrl.startsWith("/objects/") && !body.uploadedFileUrl.startsWith("/api/public/storage/")) {
      return "uploadedFileUrl must be a finalized object storage reference";
    }
  } else {
    if (!body.downloadUrl) return "downloadUrl is required for external_link/store_link downloads";
    if (!/^https?:\/\//i.test(body.downloadUrl)) return "downloadUrl must be a valid http(s) URL";
  }
  return null;
}

function audit(userId: number | null | undefined, action: string, entityId: number | null, details: unknown) {
  return db.insert(auditLogsTable).values({
    userId: userId ?? null,
    action,
    entity: "app_download",
    entityId,
    details: JSON.stringify(details).slice(0, 4000),
  }).catch(() => undefined);
}

router.use("/admin/app-downloads", requireSuperAdmin);

router.get("/admin/app-downloads", async (req, res) => {
  const platform = typeof req.query.platform === "string" ? req.query.platform : null;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const conds = [] as any[];
  if (platform && (PLATFORMS as readonly string[]).includes(platform)) conds.push(eq(appDownloadsTable.platform, platform as AppDownloadPlatform));
  if (status && (STATUSES as readonly string[]).includes(status)) conds.push(eq(appDownloadsTable.status, status as AppDownloadStatus));
  const rows = await db.select().from(appDownloadsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(appDownloadsTable.isLatest), desc(appDownloadsTable.releaseDate), desc(appDownloadsTable.createdAt));
  res.json({ items: rows });
});

router.get("/admin/app-downloads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return void res.status(400).json({ error: "Invalid id" });
  const [row] = await db.select().from(appDownloadsTable).where(eq(appDownloadsTable.id, id));
  if (!row) return void res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.post("/admin/app-downloads", async (req, res) => {
  const parsed = RowSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const err = validateDownloadRef(parsed.data);
  if (err) return void res.status(400).json({ error: err });

  const result = await db.transaction(async (tx) => {
    if (parsed.data.isLatest) {
      await tx.update(appDownloadsTable)
        .set({ isLatest: false, updatedAt: new Date() })
        .where(and(eq(appDownloadsTable.platform, parsed.data.platform), eq(appDownloadsTable.isLatest, true)));
    }
    const [row] = await tx.insert(appDownloadsTable).values({
      platform: parsed.data.platform,
      appName: parsed.data.appName,
      description: parsed.data.description ?? null,
      version: parsed.data.version,
      buildNumber: parsed.data.buildNumber ?? null,
      releaseDate: parsed.data.releaseDate ?? null,
      status: parsed.data.status ?? "available",
      downloadType: parsed.data.downloadType,
      downloadUrl: parsed.data.downloadUrl ?? null,
      uploadedFileUrl: parsed.data.uploadedFileUrl ?? null,
      fileSize: parsed.data.fileSize ?? null,
      iconUrl: parsed.data.iconUrl ?? null,
      minimumOsVersion: parsed.data.minimumOsVersion ?? null,
      systemRequirements: parsed.data.systemRequirements ?? null,
      releaseNotes: parsed.data.releaseNotes ?? null,
      installationGuide: parsed.data.installationGuide ?? null,
      isLatest: parsed.data.isLatest ?? false,
      isVisible: parsed.data.isVisible ?? true,
      forceUpdate: parsed.data.forceUpdate ?? false,
      recommendedUpdate: parsed.data.recommendedUpdate ?? false,
      allowedPlansJson: parsed.data.allowedPlansJson ?? null,
      allowedRestaurantsJson: parsed.data.allowedRestaurantsJson ?? null,
      createdBy: req.user?.sub ?? null,
    }).returning();
    return row;
  });

  void audit(req.user?.sub, "app_download.created", result.id, { platform: result.platform, version: result.version });
  res.status(201).json(result);
});

router.patch("/admin/app-downloads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return void res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(appDownloadsTable).where(eq(appDownloadsTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Not found" });

  const parsed = RowSchema.partial().safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const merged = { ...existing, ...parsed.data } as z.infer<typeof RowSchema>;
  const refErr = validateDownloadRef(merged);
  if (refErr) return void res.status(400).json({ error: refErr });

  const result = await db.transaction(async (tx) => {
    if (parsed.data.isLatest === true) {
      await tx.update(appDownloadsTable)
        .set({ isLatest: false, updatedAt: new Date() })
        .where(and(eq(appDownloadsTable.platform, merged.platform), eq(appDownloadsTable.isLatest, true)));
    }
    const [row] = await tx.update(appDownloadsTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(appDownloadsTable.id, id))
      .returning();
    return row;
  });

  void audit(req.user?.sub, "app_download.updated", id, { changed: Object.keys(parsed.data) });
  res.json(result);
});

router.post("/admin/app-downloads/:id/mark-latest", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return void res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(appDownloadsTable).where(eq(appDownloadsTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Not found" });

  await db.transaction(async (tx) => {
    await tx.update(appDownloadsTable)
      .set({ isLatest: false, updatedAt: new Date() })
      .where(and(eq(appDownloadsTable.platform, existing.platform), eq(appDownloadsTable.isLatest, true)));
    await tx.update(appDownloadsTable)
      .set({ isLatest: true, updatedAt: new Date() })
      .where(eq(appDownloadsTable.id, id));
  });
  void audit(req.user?.sub, "app_download.marked_latest", id, { platform: existing.platform, version: existing.version });
  res.json({ ok: true });
});

router.post("/admin/app-downloads/:id/archive", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return void res.status(400).json({ error: "Invalid id" });
  const [row] = await db.update(appDownloadsTable)
    .set({ status: "archived", isLatest: false, isVisible: false, updatedAt: new Date() })
    .where(eq(appDownloadsTable.id, id))
    .returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  void audit(req.user?.sub, "app_download.archived", id, { platform: row.platform, version: row.version });
  res.json(row);
});

router.delete("/admin/app-downloads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return void res.status(400).json({ error: "Invalid id" });
  const [row] = await db.delete(appDownloadsTable).where(eq(appDownloadsTable.id, id)).returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  void audit(req.user?.sub, "app_download.deleted", id, { platform: row.platform, version: row.version });
  res.json({ ok: true });
});

// ── Upload presign + finalize ──────────────────────────────────────────────
const UploadRequestSchema = z.object({
  kind: z.enum(["binary", "icon"]).default("binary"),
  platform: z.enum(PLATFORMS).optional(),
  name: z.string().trim().max(256).optional(),
  size: z.number().int().positive().optional(),
  contentType: z.string().trim().max(128).optional(),
});

router.post("/admin/app-downloads/uploads/request-url", async (req, res) => {
  const parsed = UploadRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) return void res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  const maxBytes = parsed.data.kind === "icon" ? MAX_ICON_BYTES : MAX_BINARY_BYTES;
  if (parsed.data.size && parsed.data.size > maxBytes) {
    return void res.status(413).json({ error: `File too large. Max ${Math.round(maxBytes / 1024 / 1024)} MB.` });
  }
  if (parsed.data.kind === "binary" && parsed.data.platform && parsed.data.name) {
    const exts = EXT_BY_PLATFORM[parsed.data.platform];
    const lower = parsed.data.name.toLowerCase();
    if (parsed.data.platform !== "web" && !exts.some((e) => lower.endsWith(e))) {
      return void res.status(415).json({ error: `File for ${parsed.data.platform} must have extension: ${exts.join(", ")}` });
    }
  }
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath, maxBytes });
  } catch (err) {
    if (err instanceof ObjectStorageNotConfiguredError) return void res.status(503).json({ error: err.message });
    req.log.error({ err }, "admin app-downloads: presign failed");
    res.status(500).json({ error: `Couldn't start the upload: ${(err as Error).message}` });
  }
});

router.post("/admin/app-downloads/uploads/finalize", async (req, res) => {
  const { objectPath, kind } = (req.body ?? {}) as { objectPath?: string; kind?: "binary" | "icon" };
  if (!objectPath || !objectPath.startsWith("/objects/")) {
    return void res.status(400).json({ error: "objectPath is required" });
  }
  try {
    const file = await objectStorageService.getObjectEntityFile(objectPath);
    const [meta] = await file.getMetadata();
    const size = typeof meta.size === "string" ? Number(meta.size) : (meta.size as number | undefined) ?? null;
    // Icons are publicly readable so they can render in the download cards
    // without an auth round-trip. Binaries stay private; the restaurant
    // endpoint re-checks visibility and issues a short-lived signed GET URL.
    const visibility = kind === "icon" ? "public" : "private";
    await setObjectAclPolicy(file, {
      restaurantId: "system",
      uploaderId: String(req.user?.sub ?? ""),
      visibility,
    });
    const wildcardPath = objectPath.replace(/^\/objects\//, "");
    // For icons we return a directly-renderable public URL. For binaries we
    // return the internal `/objects/...` reference; restaurants resolve it
    // to a signed URL via /app-downloads/:id/download-url.
    const publicUrl = visibility === "public" ? `/api/public/storage/objects/${wildcardPath}` : objectPath;
    res.json({ objectPath, publicUrl, size, contentType: meta.contentType ?? null });
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return void res.status(404).json({ error: "Upload didn't arrive in storage. Please try again." });
    req.log.error({ err }, "admin app-downloads: finalize failed");
    res.status(500).json({ error: `Couldn't finalize the upload: ${(err as Error).message}` });
  }
});

// ── Analytics ──────────────────────────────────────────────────────────────
router.get("/admin/app-downloads/analytics/summary", async (_req, res) => {
  const totals = await db.select({
    platform: appDownloadLogsTable.platform,
    action: appDownloadLogsTable.action,
    count: sql<number>`count(*)::int`,
  }).from(appDownloadLogsTable).groupBy(appDownloadLogsTable.platform, appDownloadLogsTable.action);

  const topApps = await db.select({
    appDownloadId: appDownloadLogsTable.appDownloadId,
    platform: appDownloadLogsTable.platform,
    version: appDownloadLogsTable.version,
    count: sql<number>`count(*)::int`,
  }).from(appDownloadLogsTable)
    .where(eq(appDownloadLogsTable.action, "downloaded"))
    .groupBy(appDownloadLogsTable.appDownloadId, appDownloadLogsTable.platform, appDownloadLogsTable.version)
    .orderBy(sql`count(*) desc`)
    .limit(10);

  // "Restaurants on old versions" — for each (platform, restaurant), look at
  // the most recent `downloaded` event and count it as outdated when that
  // version doesn't match the current `is_latest` row. Uses Postgres
  // DISTINCT ON to pull the latest event per restaurant deterministically.
  const latest = await db.select({
    platform: appDownloadsTable.platform,
    version: appDownloadsTable.version,
  }).from(appDownloadsTable).where(eq(appDownloadsTable.isLatest, true));
  const latestMap = new Map(latest.map((l) => [l.platform, l.version] as const));

  const lastPerRestaurant = await db.execute<{
    platform: AppDownloadPlatform;
    restaurant_id: number;
    version: string | null;
  }>(sql`
    select distinct on (platform, restaurant_id)
      platform, restaurant_id, version
    from ${appDownloadLogsTable}
    where action = 'downloaded' and restaurant_id is not null
    order by platform, restaurant_id, created_at desc
  `);

  const onOld: Record<string, number> = {};
  for (const r of lastPerRestaurant.rows ?? []) {
    const latestV = latestMap.get(r.platform);
    if (latestV && r.version && r.version !== latestV) {
      onOld[r.platform] = (onOld[r.platform] ?? 0) + 1;
    }
  }

  res.json({ totals, topApps, restaurantsOnOldVersions: onOld });
});

export default router;
