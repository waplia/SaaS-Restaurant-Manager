import { Router } from "express";
import { z } from "zod";
import { db, auditLogsTable, type AppSettings } from "../lib/db";
import { requireSuperAdmin } from "../middleware/authorize";
import { getAppSettings, updateAppSettings, toPublicAppSettings } from "../lib/appSettings";
import {
  ObjectStorageService,
  ObjectNotFoundError,
  ObjectStorageNotConfiguredError,
} from "../lib/objectStorage";
import { setObjectAclPolicy } from "../lib/objectAcl";
import {
  sanitizeStoredUpload,
  UploadValidationError,
} from "../lib/uploadSanitizer";

const router = Router();
const objectStorageService = new ObjectStorageService();

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const URL_OPTIONAL = z.string().trim().url().or(z.literal("")).nullish();
// Accept absolute URLs OR any root-relative path (covers internal storage
// paths returned by the upload finalize endpoint, as well as static bundled
// assets like "/logo.png" and "/favicon.png").
const ASSET_URL_OPTIONAL = z
  .union([
    z.string().trim().url(),
    z.string().trim().regex(/^\/[^\s]*$/, "Must be an absolute URL or a root-relative path"),
    z.literal(""),
  ])
  .nullish();
const PHONE_RE = /^\+[1-9]\d{6,14}(?:[\s-]?\d{1,6})?$/; // E.164-ish, allows one space/dash group
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB
// Only raster images that the server can fully decode + re-encode. SVG and
// ICO are intentionally rejected because they cannot be safely re-encoded —
// SVG can carry scripts (XSS), and ICO is a multi-image container that
// browsers handle inconsistently. PNG/JPEG/WebP cover every favicon and
// logo use case after server-side conversion.
const ALLOWED_UPLOAD_MIME = new Set([
  "image/png", "image/jpeg", "image/webp",
]);
const phoneSchema = z.string().trim().regex(PHONE_RE, "Phone must include country code, e.g. +91 9876543210").max(40);

const SOCIAL_KEYS = ["facebook", "instagram", "twitter", "linkedin", "youtube", "tiktok"] as const;

const updateSchema = z.object({
  appName: z.string().trim().min(1).max(80).optional(),
  logoUrl: ASSET_URL_OPTIONAL,
  faviconUrl: ASSET_URL_OPTIONAL,
  primaryColor: z.string().regex(HEX_RE, "Must be a hex color").optional(),
  secondaryColor: z.string().regex(HEX_RE, "Must be a hex color").optional(),

  supportEmail: z.string().trim().email().optional(),
  supportPhone: phoneSchema.or(z.literal("")).nullish(),
  supportWhatsapp: phoneSchema.or(z.literal("")).nullish(),
  companyAddress: z.string().trim().max(400).nullish(),

  defaultCurrency: z.string().trim().length(3).optional(),
  defaultTimezone: z.string().trim().min(1).max(64).optional(),
  dateFormat: z.string().trim().min(1).max(32).optional(),
  timeFormat: z.enum(["12h", "24h"]).optional(),

  trialDays: z.number().int().min(0).max(365).optional(),
  maintenanceMode: z.boolean().optional(),
  maintenanceMessage: z.string().trim().max(400).nullish(),
  signupEnabled: z.boolean().optional(),
  landingPageEnabled: z.boolean().optional(),

  authPasswordLoginEnabled: z.boolean().optional(),
  authMobileOtpLoginEnabled: z.boolean().optional(),
  authEmailOtpLoginEnabled: z.boolean().optional(),
  authTwoFactorEnabled: z.boolean().optional(),
  authSelfRegistrationRequireMobileOtp: z.boolean().optional(),
  authOtpDefaultChannel: z.enum(["sms", "whatsapp"]).optional(),

  footerText: z.string().trim().max(400).nullish(),
  socialLinks: z
    .record(z.enum(SOCIAL_KEYS), z.string().trim().url().or(z.literal("")))
    .optional(),
});

/**
 * Sensitive fields are masked when read by anyone other than super-admin.
 * (Settings table currently has no truly secret fields, but we follow the
 * payment_method_settings pattern so future fields like API keys can be
 * added safely.)
 */
const SECRET_FIELDS: Array<keyof AppSettings> = [];

function maskSettings<T extends Partial<AppSettings>>(s: T): T {
  const out: Record<string, unknown> = { ...s };
  for (const k of SECRET_FIELDS) {
    if (out[k as string]) {
      const v = out[k as string];
      out[k as string] = typeof v === "string" && v.length > 4 ? `••••${v.slice(-4)}` : "••••";
    }
  }
  return out as T;
}

// ─── Super-admin: read full settings ───────────────────────────
router.get("/admin/app-settings", requireSuperAdmin, async (_req, res) => {
  const s = await getAppSettings(true);
  res.json(maskSettings(s));
});

// ─── Super-admin: update settings ──────────────────────────────
router.put("/admin/app-settings", requireSuperAdmin, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const patch: Partial<AppSettings> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    if (typeof v === "string" && v === "" && k !== "footerText" && k !== "maintenanceMessage" && k !== "supportPhone" && k !== "supportWhatsapp" && k !== "companyAddress" && k !== "logoUrl" && k !== "faviconUrl") continue;
    (patch as Record<string, unknown>)[k] = v === "" ? null : v;
  }
  // Clean socialLinks: drop empty strings
  if (patch.socialLinks) {
    const cleaned: Record<string, string> = {};
    for (const [key, val] of Object.entries(patch.socialLinks)) {
      if (typeof val === "string" && val.trim()) cleaned[key] = val.trim();
    }
    patch.socialLinks = cleaned;
  }

  const before = await getAppSettings(true);
  const updated = await updateAppSettings(patch, req.user?.sub ?? null);

  const changedKeys = Object.keys(patch).filter((k) => {
    const a = (before as Record<string, unknown>)[k];
    const b = (updated as Record<string, unknown>)[k];
    return JSON.stringify(a) !== JSON.stringify(b);
  });

  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    action: "app_settings.updated",
    entity: "app_settings",
    entityId: 1,
    details: JSON.stringify({ changed: changedKeys, by: req.user?.email ?? null }),
    ipAddress: req.ip ?? null,
  });

  res.json(maskSettings(updated));
});

// ─── Super-admin: presigned upload URL for logo/favicon ────────
const RequestAdminUploadBody = z.object({
  name: z.string().trim().min(1).max(256).optional(),
  size: z.number().int().positive().optional(),
  contentType: z.string().trim().min(1).max(128).optional(),
}).optional();

router.post("/admin/app-settings/uploads/request-url", requireSuperAdmin, async (req, res) => {
  const parsed = RequestAdminUploadBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid upload request", details: parsed.error.flatten() });
    return;
  }
  const meta = parsed.data ?? {};
  // Reject obviously-wrong types up front so we don't waste a presigned URL on
  // an HTML or text payload that will only fail re-encoding later.
  if (meta.contentType) {
    if (!ALLOWED_UPLOAD_MIME.has(meta.contentType.toLowerCase().split(";")[0].trim())) {
      res.status(415).json({
        error: `File type "${meta.contentType}" is not allowed here. Allowed: ${Array.from(ALLOWED_UPLOAD_MIME).join(", ")}.`,
      });
      return;
    }
  }
  if (meta.size != null && meta.size > MAX_UPLOAD_BYTES) {
    res.status(413).json({
      error: `File too large (${Math.round(meta.size / 1024)} KB). Max allowed is ${Math.round(MAX_UPLOAD_BYTES / 1024)} KB.`,
    });
    return;
  }
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({
      uploadURL,
      objectPath,
      maxBytes: MAX_UPLOAD_BYTES,
      allowedMimeTypes: Array.from(ALLOWED_UPLOAD_MIME),
    });
  } catch (err) {
    if (err instanceof ObjectStorageNotConfiguredError) {
      res.status(503).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "admin: failed to create upload URL");
    res.status(500).json({ error: `Couldn't start the upload: ${(err as Error).message}` });
  }
});

/**
 * Resolve the just-PUT object, retrying briefly because GCS occasionally
 * surfaces a freshly-written object as "not found" for the first few hundred
 * milliseconds. Without this the user sees a "URL error" on what was actually
 * a successful upload.
 */
async function resolveObjectWithRetry(objectPath: string) {
  let lastErr: unknown;
  for (const delayMs of [0, 250, 500, 1000]) {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    try {
      return await objectStorageService.getObjectEntityFile(objectPath);
    } catch (e) {
      lastErr = e;
      if (!(e instanceof ObjectNotFoundError)) throw e;
    }
  }
  throw lastErr;
}

// ─── Super-admin: finalize upload (validate size/type + set public ACL) ───
router.post("/admin/app-settings/uploads/finalize", requireSuperAdmin, async (req, res) => {
  const { objectPath } = req.body as { objectPath?: string };
  if (!objectPath || typeof objectPath !== "string" || !objectPath.startsWith("/objects/")) {
    res.status(400).json({ error: "objectPath is required" });
    return;
  }
  try {
    let file;
    try {
      file = await resolveObjectWithRetry(objectPath);
    } catch (e) {
      if (e instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Upload didn't arrive in storage. Please try again." });
        return;
      }
      throw e;
    }
    let result;
    try {
      result = await sanitizeStoredUpload(file, {
        allowedKinds: ["image"],
        maxBytes: MAX_UPLOAD_BYTES,
      });
    } catch (sanErr) {
      if (sanErr instanceof UploadValidationError) {
        res.status(sanErr.statusCode).json({ error: sanErr.message });
        return;
      }
      throw sanErr;
    }
    if (!ALLOWED_UPLOAD_MIME.has(result.mime)) {
      await file.delete().catch(() => undefined);
      res.status(415).json({
        error: `Unsupported file type "${result.mime}". Allowed: ${Array.from(ALLOWED_UPLOAD_MIME).join(", ")}.`,
      });
      return;
    }
    await setObjectAclPolicy(file, { restaurantId: "system", uploaderId: String(req.user?.sub ?? ""), visibility: "public" });
    const wildcardPath = objectPath.replace(/^\/objects\//, "");
    const publicUrl = `/api/public/storage/objects/${wildcardPath}`;
    res.json({ objectPath, publicUrl, contentType: result.mime, size: result.size });
  } catch (err) {
    req.log.error({ err }, "admin: failed to finalize upload");
    res.status(500).json({ error: `Couldn't finalize the upload: ${(err as Error).message}` });
  }
});

// ─── PUBLIC: read non-sensitive settings (no auth) ─────────────
export const publicAppSettingsRouter = Router();
publicAppSettingsRouter.get("/public/app-settings", async (_req, res) => {
  const s = await getAppSettings();
  res.set("Cache-Control", "public, max-age=15");
  res.json(toPublicAppSettings(s));
});

export default router;
