/**
 * Stock food image library — REST endpoints.
 *
 * Routes split into two surfaces:
 *   - /admin/stock-food-images/*  — super-admin only, full CRUD.
 *   - /stock-food-images/*        — any authenticated tenant user, read-only
 *                                   (list, search, single match). Used by
 *                                   the menu-editor "Pick from library"
 *                                   picker and the AI-import auto-attach.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, ilike, or, desc, asc, sql, type SQL } from "drizzle-orm";
import { db, stockFoodImagesTable } from "../lib/db";
import { requireSuperAdmin } from "../middleware/authorize";
import {
  findBestStockImageMatch,
  invalidateStockFoodCache,
  seedStockFoodImages,
  slugifyName,
} from "../lib/stockFoodImages";
import { recordAuditLog } from "../lib/audit";
import {
  ObjectStorageService,
  ObjectNotFoundError,
  ObjectStorageNotConfiguredError,
} from "../lib/objectStorage";
import { setObjectAclPolicy } from "../lib/objectAcl";
import { sanitizeStoredUpload, UploadValidationError } from "../lib/uploadSanitizer";

const objectStorageService = new ObjectStorageService();
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB for stock food photos
const ALLOWED_UPLOAD_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

const router = Router();

// ─── Public-ish (auth-required) read endpoints ────────────────────────
// Any authenticated user from any tenant can browse the library to pick
// an image for one of their menu items. There is no tenant-scoped data
// here — the catalog is global and curated by super-admins.

const ListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  cuisine: z.string().trim().max(60).optional(),
  category: z.string().trim().max(60).optional(),
  isVeg: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  offset: z.coerce.number().int().min(0).default(0),
  includeInactive: z.enum(["true", "false"]).optional(),
});

router.get("/stock-food-images", async (req: Request, res: Response) => {
  if (!req.user) return void res.status(401).json({ error: "Authentication required" });
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid query" });
  const { q, cuisine, category, isVeg, limit, offset } = parsed.data;
  // Tenants never see inactive rows; only super-admins (via the /admin
  // route) can list them.
  const filters: SQL[] = [eq(stockFoodImagesTable.isActive, true)];
  if (cuisine) filters.push(eq(stockFoodImagesTable.cuisine, cuisine));
  if (category) filters.push(eq(stockFoodImagesTable.category, category));
  if (isVeg === "true") filters.push(eq(stockFoodImagesTable.isVeg, true));
  if (isVeg === "false") filters.push(eq(stockFoodImagesTable.isVeg, false));
  if (q) {
    const like = `%${q}%`;
    const orCondition = or(
      ilike(stockFoodImagesTable.name, like),
      ilike(stockFoodImagesTable.slug, like),
      sql`EXISTS (SELECT 1 FROM unnest(${stockFoodImagesTable.aliases}) a WHERE a ILIKE ${like})`,
      sql`EXISTS (SELECT 1 FROM unnest(${stockFoodImagesTable.tags}) t WHERE t ILIKE ${like})`,
    );
    if (orCondition) filters.push(orCondition);
  }
  const rows = await db.select().from(stockFoodImagesTable)
    .where(and(...filters))
    .orderBy(asc(stockFoodImagesTable.sortOrder), asc(stockFoodImagesTable.name))
    .limit(limit).offset(offset);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(stockFoodImagesTable).where(and(...filters));
  res.json({ rows, total, limit, offset });
});

router.get("/stock-food-images/match", async (req: Request, res: Response) => {
  if (!req.user) return void res.status(401).json({ error: "Authentication required" });
  const name = String(req.query.name ?? "").trim();
  if (!name) return void res.status(400).json({ error: "name is required" });
  const isVegQ = String(req.query.isVeg ?? "").toLowerCase();
  const isVeg = isVegQ === "true" ? true : isVegQ === "false" ? false : null;
  const match = await findBestStockImageMatch({ name, isVeg });
  res.json({ match });
});

// ─── Super-admin CRUD ─────────────────────────────────────────────────

// imageUrl accepts either a fully-qualified URL or a root-relative storage
// path (e.g. "/api/public/storage/objects/...") produced by the admin
// upload endpoint below.
const ImageUrlSchema = z.union([
  z.string().trim().url().max(1000),
  z.string().trim().regex(/^\/[^\s]+$/, "Must be an absolute URL or a root-relative path").max(1000),
]);
const BaseInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120).optional(),
  cuisine: z.string().trim().max(60).nullish(),
  category: z.string().trim().max(60).nullish(),
  imageUrl: ImageUrlSchema,
  thumbnailUrl: ImageUrlSchema.nullish(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  isVeg: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  attribution: z.string().trim().max(500).nullish(),
});

router.get("/admin/stock-food-images",
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) return void res.status(400).json({ error: "Invalid query" });
    const { q, cuisine, category, isVeg, limit, offset, includeInactive } = parsed.data;
    const filters: SQL[] = [];
    if (includeInactive !== "true") filters.push(eq(stockFoodImagesTable.isActive, true));
    if (cuisine) filters.push(eq(stockFoodImagesTable.cuisine, cuisine));
    if (category) filters.push(eq(stockFoodImagesTable.category, category));
    if (isVeg === "true") filters.push(eq(stockFoodImagesTable.isVeg, true));
    if (isVeg === "false") filters.push(eq(stockFoodImagesTable.isVeg, false));
    if (q) {
      const like = `%${q}%`;
      const orCondition = or(
        ilike(stockFoodImagesTable.name, like),
        ilike(stockFoodImagesTable.slug, like),
        sql`EXISTS (SELECT 1 FROM unnest(${stockFoodImagesTable.aliases}) a WHERE a ILIKE ${like})`,
      );
      if (orCondition) filters.push(orCondition);
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined;
    const baseQuery = db.select().from(stockFoodImagesTable);
    const rowsQuery = whereClause ? baseQuery.where(whereClause) : baseQuery;
    const rows = await rowsQuery
      .orderBy(desc(stockFoodImagesTable.id))
      .limit(limit).offset(offset);
    const countBase = db.select({ total: sql<number>`count(*)::int` }).from(stockFoodImagesTable);
    const countQuery = whereClause ? countBase.where(whereClause) : countBase;
    const [{ total }] = await countQuery;
    res.json({ rows, total, limit, offset });
  });

router.post("/admin/stock-food-images",
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    const parsed = BaseInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const slug = slugifyName(data.slug ?? data.name);
    const [existing] = await db.select({ id: stockFoodImagesTable.id })
      .from(stockFoodImagesTable).where(eq(stockFoodImagesTable.slug, slug));
    if (existing) {
      return void res.status(409).json({ error: `Slug "${slug}" already exists`, slug });
    }
    const [row] = await db.insert(stockFoodImagesTable).values({
      slug,
      name: data.name,
      cuisine: data.cuisine ?? null,
      category: data.category ?? null,
      imageUrl: data.imageUrl,
      thumbnailUrl: data.thumbnailUrl ?? null,
      aliases: data.aliases ?? [],
      tags: data.tags ?? [],
      isVeg: data.isVeg ?? true,
      isActive: data.isActive ?? true,
      sortOrder: data.sortOrder ?? 0,
      attribution: data.attribution ?? null,
      source: "manual",
      createdBy: req.user?.sub ?? null,
    }).returning();
    invalidateStockFoodCache();
    await recordAuditLog({
      req, module: "khana_ai", action: "stock_food_image.create",
      entity: "stock_food_image", entityId: row.id, newValue: row,
    });
    res.status(201).json(row);
  });

const PatchSchema = BaseInputSchema.partial();

router.patch("/admin/stock-food-images/:id",
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return void res.status(400).json({ error: "Invalid id" });
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const [before] = await db.select().from(stockFoodImagesTable).where(eq(stockFoodImagesTable.id, id));
    if (!before) return void res.status(404).json({ error: "Not found" });

    const updates: Partial<typeof stockFoodImagesTable.$inferInsert> = { updatedAt: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.slug !== undefined) updates.slug = slugifyName(data.slug);
    if (data.cuisine !== undefined) updates.cuisine = data.cuisine ?? null;
    if (data.category !== undefined) updates.category = data.category ?? null;
    if (data.imageUrl !== undefined) updates.imageUrl = data.imageUrl;
    if (data.thumbnailUrl !== undefined) updates.thumbnailUrl = data.thumbnailUrl ?? null;
    if (data.aliases !== undefined) updates.aliases = data.aliases;
    if (data.tags !== undefined) updates.tags = data.tags;
    if (data.isVeg !== undefined) updates.isVeg = data.isVeg;
    if (data.isActive !== undefined) updates.isActive = data.isActive;
    if (data.sortOrder !== undefined) updates.sortOrder = data.sortOrder;
    if (data.attribution !== undefined) updates.attribution = data.attribution ?? null;

    // Guard against slug collisions on rename.
    if (updates.slug && updates.slug !== before.slug) {
      const [clash] = await db.select({ id: stockFoodImagesTable.id })
        .from(stockFoodImagesTable).where(eq(stockFoodImagesTable.slug, updates.slug));
      if (clash) return void res.status(409).json({ error: `Slug "${updates.slug}" already exists` });
    }

    const [row] = await db.update(stockFoodImagesTable).set(updates)
      .where(eq(stockFoodImagesTable.id, id)).returning();
    invalidateStockFoodCache();
    await recordAuditLog({
      req, module: "khana_ai", action: "stock_food_image.update",
      entity: "stock_food_image", entityId: id, oldValue: before, newValue: row,
    });
    res.json(row);
  });

// ─── Super-admin: bulk import (CSV/JSON paste) ────────────────────────
const BulkEntrySchema = BaseInputSchema.extend({
  // In bulk, isVeg/isActive/sortOrder all default if missing.
});
const BulkBody = z.object({
  entries: z.array(BulkEntrySchema).min(1).max(500),
  /** If true, existing rows (matched by slug) are overwritten; otherwise skipped. */
  overwrite: z.boolean().optional(),
});

router.post("/admin/stock-food-images/bulk",
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    const parsed = BulkBody.safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const { entries, overwrite } = parsed.data;
    const existing = await db.select({
      id: stockFoodImagesTable.id, slug: stockFoodImagesTable.slug,
    }).from(stockFoodImagesTable);
    const slugToId = new Map(existing.map((r) => [r.slug, r.id]));

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ name: string; error: string }> = [];

    for (const entry of entries) {
      try {
        const slug = slugifyName(entry.slug ?? entry.name);
        const values = {
          slug,
          name: entry.name,
          cuisine: entry.cuisine ?? null,
          category: entry.category ?? null,
          imageUrl: entry.imageUrl,
          thumbnailUrl: entry.thumbnailUrl ?? null,
          aliases: entry.aliases ?? [],
          tags: entry.tags ?? [],
          isVeg: entry.isVeg ?? true,
          isActive: entry.isActive ?? true,
          sortOrder: entry.sortOrder ?? 0,
          attribution: entry.attribution ?? null,
        };
        const existingId = slugToId.get(slug);
        if (existingId) {
          if (overwrite) {
            await db.update(stockFoodImagesTable)
              .set({ ...values, updatedAt: new Date() })
              .where(eq(stockFoodImagesTable.id, existingId));
            updated++;
          } else {
            skipped++;
          }
        } else {
          await db.insert(stockFoodImagesTable).values({
            ...values, source: "bulk_import", createdBy: req.user?.sub ?? null,
          });
          inserted++;
        }
      } catch (err) {
        errors.push({ name: entry.name, error: (err as Error).message ?? "unknown" });
      }
    }
    invalidateStockFoodCache();
    await recordAuditLog({
      req, module: "khana_ai", action: "stock_food_image.bulk_import",
      entity: "stock_food_image",
      newValue: { inserted, updated, skipped, errorCount: errors.length, overwrite: !!overwrite },
    });
    res.json({ inserted, updated, skipped, errors });
  });

// ─── Super-admin: re-run the bundled seed catalog ─────────────────────
router.post("/admin/stock-food-images/reseed",
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    // seedStockFoodImages is idempotent: only inserts missing slugs.
    await seedStockFoodImages();
    invalidateStockFoodCache();
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
      .from(stockFoodImagesTable);
    await recordAuditLog({
      req, module: "khana_ai", action: "stock_food_image.reseed",
      entity: "stock_food_image", newValue: { totalAfter: total },
    });
    res.json({ ok: true, total });
  });

// ─── Super-admin: presigned upload URL for stock food photos ──────────
const RequestUploadBody = z.object({
  name: z.string().trim().min(1).max(256).optional(),
  size: z.number().int().positive().optional(),
  contentType: z.string().trim().min(1).max(128).optional(),
}).optional();

router.post("/admin/stock-food-images/uploads/request-url",
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    const parsed = RequestUploadBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return void res.status(400).json({ error: "Invalid upload request" });
    }
    const meta = parsed.data ?? {};
    if (meta.contentType) {
      const ct = meta.contentType.toLowerCase().split(";")[0].trim();
      if (!ALLOWED_UPLOAD_MIME.has(ct)) {
        return void res.status(415).json({
          error: `File type "${meta.contentType}" not allowed. Allowed: ${Array.from(ALLOWED_UPLOAD_MIME).join(", ")}.`,
        });
      }
    }
    if (meta.size != null && meta.size > MAX_UPLOAD_BYTES) {
      return void res.status(413).json({
        error: `File too large (${Math.round(meta.size / 1024)} KB). Max ${Math.round(MAX_UPLOAD_BYTES / 1024)} KB.`,
      });
    }
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      res.json({ uploadURL, objectPath, maxBytes: MAX_UPLOAD_BYTES });
    } catch (err) {
      if (err instanceof ObjectStorageNotConfiguredError) {
        return void res.status(503).json({ error: err.message });
      }
      req.log.error({ err }, "stock-food upload URL failed");
      res.status(500).json({ error: `Couldn't start upload: ${(err as Error).message}` });
    }
  });

router.post("/admin/stock-food-images/uploads/finalize",
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    const { objectPath } = req.body as { objectPath?: string };
    if (!objectPath || typeof objectPath !== "string" || !objectPath.startsWith("/objects/")) {
      return void res.status(400).json({ error: "objectPath is required" });
    }
    try {
      let file;
      try {
        file = await objectStorageService.getObjectEntityFile(objectPath);
      } catch (e) {
        if (e instanceof ObjectNotFoundError) {
          // Brief retry — GCS occasionally lags on freshly-PUT objects.
          await new Promise((r) => setTimeout(r, 500));
          file = await objectStorageService.getObjectEntityFile(objectPath);
        } else throw e;
      }
      let result;
      try {
        result = await sanitizeStoredUpload(file, {
          allowedKinds: ["image"], maxBytes: MAX_UPLOAD_BYTES,
        });
      } catch (e) {
        if (e instanceof UploadValidationError) {
          return void res.status(e.statusCode).json({ error: e.message });
        }
        throw e;
      }
      if (!ALLOWED_UPLOAD_MIME.has(result.mime)) {
        await file.delete().catch(() => undefined);
        return void res.status(415).json({ error: `Unsupported type "${result.mime}"` });
      }
      await setObjectAclPolicy(file, {
        restaurantId: "system", uploaderId: String(req.user?.sub ?? ""), visibility: "public",
      });
      const wildcardPath = objectPath.replace(/^\/objects\//, "");
      const publicUrl = `/api/public/storage/objects/${wildcardPath}`;
      res.json({ objectPath, publicUrl, contentType: result.mime, size: result.size });
    } catch (err) {
      req.log.error({ err }, "stock-food upload finalize failed");
      res.status(500).json({ error: `Couldn't finalize upload: ${(err as Error).message}` });
    }
  });

router.delete("/admin/stock-food-images/:id",
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return void res.status(400).json({ error: "Invalid id" });
    const [before] = await db.select().from(stockFoodImagesTable).where(eq(stockFoodImagesTable.id, id));
    if (!before) return void res.status(404).json({ error: "Not found" });
    // Soft-delete: flip isActive so any menu_items.image_url already pointing
    // at this row keeps rendering. Hard-delete would orphan those URLs.
    const [row] = await db.update(stockFoodImagesTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(stockFoodImagesTable.id, id)).returning();
    invalidateStockFoodCache();
    await recordAuditLog({
      req, module: "khana_ai", action: "stock_food_image.deactivate",
      entity: "stock_food_image", entityId: id, oldValue: before, newValue: row,
    });
    res.json({ ok: true, row });
  });

export default router;
