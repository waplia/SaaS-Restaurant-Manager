/**
 * Stock food image library — REST endpoints.
 *
 * Routes split into two surfaces:
 *   - /admin/stock-food-images/*  — super-admin only, full CRUD + bulk
 *                                   actions + AI bulk-generation jobs.
 *   - /stock-food-images/*        — any authenticated tenant user, read-only
 *                                   (list/search/match/suggest/popular/
 *                                   recently-used). Used by the menu-editor
 *                                   "Pick from library" picker and the
 *                                   AI-import auto-attach.
 *
 * The tenant surface only ever returns rows where is_approved = true and
 * is_active = true. Super-admins see everything via /admin/.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, inArray, ilike, or, desc, asc, sql, gt, type SQL } from "drizzle-orm";
import {
  db,
  stockFoodImagesTable,
  imageGenerationJobsTable,
  restaurantMenuItemImagesTable,
  menuItemsTable,
} from "../lib/db";
import { requireSuperAdmin } from "../middleware/authorize";
import {
  findBestStockImageMatch,
  findStockImageSuggestions,
  invalidateStockFoodCache,
  seedStockFoodImages,
  slugifyName,
} from "../lib/stockFoodImages";
import { runImageGenerationJob, type AiJobItemState } from "../lib/aiImageJobs";
import { recordAuditLog } from "../lib/audit";
import {
  ObjectStorageService,
  ObjectNotFoundError,
  ObjectStorageNotConfiguredError,
} from "../lib/objectStorage";
import { setObjectAclPolicy } from "../lib/objectAcl";
import { sanitizeStoredUpload, UploadValidationError } from "../lib/uploadSanitizer";

const objectStorageService = new ObjectStorageService();
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

const router = Router();

// ─── Shared query parser ──────────────────────────────────────────────
const ListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  cuisine: z.string().trim().max(60).optional(),
  category: z.string().trim().max(60).optional(),
  isVeg: z.enum(["true", "false"]).optional(),
  dietaryType: z.string().trim().max(40).optional(),
  mealType: z.string().trim().max(40).optional(),
  spiceLevel: z.coerce.number().int().min(0).max(3).optional(),
  provider: z.string().trim().max(40).optional(),
  source: z.string().trim().max(40).optional(),
  featured: z.enum(["true", "false"]).optional(),
  approved: z.enum(["true", "false", "any"]).optional(),
  sort: z.enum(["recent", "name", "usage", "featured"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  offset: z.coerce.number().int().min(0).default(0),
  includeInactive: z.enum(["true", "false"]).optional(),
});
type ListParams = z.infer<typeof ListQuery>;

function buildFilters(p: ListParams, scope: "tenant" | "admin"): SQL[] {
  const filters: SQL[] = [];
  if (scope === "tenant") {
    filters.push(eq(stockFoodImagesTable.isActive, true));
    filters.push(eq(stockFoodImagesTable.isApproved, true));
  } else {
    if (p.includeInactive !== "true") filters.push(eq(stockFoodImagesTable.isActive, true));
    if (p.approved === "true") filters.push(eq(stockFoodImagesTable.isApproved, true));
    if (p.approved === "false") filters.push(eq(stockFoodImagesTable.isApproved, false));
  }
  if (p.cuisine) filters.push(eq(stockFoodImagesTable.cuisine, p.cuisine));
  if (p.category) filters.push(eq(stockFoodImagesTable.category, p.category));
  if (p.dietaryType) filters.push(eq(stockFoodImagesTable.dietaryType, p.dietaryType));
  if (p.mealType) filters.push(eq(stockFoodImagesTable.mealType, p.mealType));
  if (p.spiceLevel != null) filters.push(eq(stockFoodImagesTable.spiceLevel, p.spiceLevel));
  if (p.provider) filters.push(eq(stockFoodImagesTable.provider, p.provider));
  if (p.source) filters.push(eq(stockFoodImagesTable.source, p.source));
  if (p.featured === "true") filters.push(eq(stockFoodImagesTable.isFeatured, true));
  if (p.featured === "false") filters.push(eq(stockFoodImagesTable.isFeatured, false));
  if (p.isVeg === "true") filters.push(eq(stockFoodImagesTable.isVeg, true));
  if (p.isVeg === "false") filters.push(eq(stockFoodImagesTable.isVeg, false));
  if (p.q) {
    const like = `%${p.q}%`;
    const orCondition = or(
      ilike(stockFoodImagesTable.name, like),
      ilike(stockFoodImagesTable.slug, like),
      sql`EXISTS (SELECT 1 FROM unnest(${stockFoodImagesTable.aliases}) a WHERE a ILIKE ${like})`,
      sql`EXISTS (SELECT 1 FROM unnest(${stockFoodImagesTable.tags}) t WHERE t ILIKE ${like})`,
    );
    if (orCondition) filters.push(orCondition);
  }
  return filters;
}

function buildOrderBy(sort: ListParams["sort"]) {
  switch (sort) {
    case "usage": return [desc(stockFoodImagesTable.usageCount), asc(stockFoodImagesTable.name)];
    case "name": return [asc(stockFoodImagesTable.name)];
    case "featured": return [desc(stockFoodImagesTable.isFeatured), asc(stockFoodImagesTable.sortOrder), asc(stockFoodImagesTable.name)];
    case "recent": return [desc(stockFoodImagesTable.id)];
    default: return [asc(stockFoodImagesTable.sortOrder), asc(stockFoodImagesTable.name)];
  }
}

// ─── Tenant-facing (auth-required) read endpoints ─────────────────────
router.get("/stock-food-images", async (req: Request, res: Response) => {
  if (!req.user) return void res.status(401).json({ error: "Authentication required" });
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid query" });
  const filters = buildFilters(parsed.data, "tenant");
  const where = and(...filters);
  const rows = await db.select().from(stockFoodImagesTable).where(where)
    .orderBy(...buildOrderBy(parsed.data.sort))
    .limit(parsed.data.limit).offset(parsed.data.offset);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(stockFoodImagesTable).where(where);
  res.json({ rows, total, limit: parsed.data.limit, offset: parsed.data.offset });
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

router.get("/stock-food-images/suggest", async (req: Request, res: Response) => {
  if (!req.user) return void res.status(401).json({ error: "Authentication required" });
  const name = String(req.query.name ?? "").trim();
  if (!name) return void res.status(400).json({ error: "name is required" });
  const isVegQ = String(req.query.isVeg ?? "").toLowerCase();
  const isVeg = isVegQ === "true" ? true : isVegQ === "false" ? false : null;
  const limit = Math.min(20, Math.max(1, Number(req.query.limit ?? 6)));
  const suggestions = await findStockImageSuggestions({ name, isVeg }, limit);
  res.json({ suggestions });
});

router.get("/stock-food-images/popular", async (req: Request, res: Response) => {
  if (!req.user) return void res.status(401).json({ error: "Authentication required" });
  const limit = Math.min(60, Math.max(1, Number(req.query.limit ?? 12)));
  const rows = await db.select().from(stockFoodImagesTable)
    .where(and(
      eq(stockFoodImagesTable.isActive, true),
      eq(stockFoodImagesTable.isApproved, true),
      gt(stockFoodImagesTable.usageCount, 0),
    ))
    .orderBy(desc(stockFoodImagesTable.usageCount), asc(stockFoodImagesTable.name))
    .limit(limit);
  res.json({ rows });
});

/**
 * Recently used library images by the calling user's restaurant.
 * Falls back to global featured rows when the restaurant has nothing recent.
 */
router.get("/stock-food-images/recent", async (req: Request, res: Response) => {
  if (!req.user) return void res.status(401).json({ error: "Authentication required" });
  const restaurantId = Number(req.query.restaurantId);
  if (!Number.isFinite(restaurantId)) return void res.status(400).json({ error: "restaurantId is required" });
  const limit = Math.min(30, Math.max(1, Number(req.query.limit ?? 8)));
  // Distinct on libraryImageId by taking the most recent attachment per image.
  const rows = await db.execute<{
    id: number; slug: string; name: string; cuisine: string | null;
    category: string | null; image_url: string; thumbnail_url: string | null;
    is_veg: boolean; is_active: boolean; sort_order: number; aliases: string[]; tags: string[];
    attribution: string | null; last_attached: Date;
  }>(sql`
    SELECT s.id, s.slug, s.name, s.cuisine, s.category, s.image_url, s.thumbnail_url,
           s.is_veg, s.is_active, s.sort_order, s.aliases, s.tags, s.attribution,
           MAX(r.created_at) AS last_attached
    FROM ${restaurantMenuItemImagesTable} r
    JOIN ${stockFoodImagesTable} s ON s.id = r.library_image_id
    WHERE r.restaurant_id = ${restaurantId}
      AND r.library_image_id IS NOT NULL
      AND s.is_active = true
      AND s.is_approved = true
    GROUP BY s.id
    ORDER BY MAX(r.created_at) DESC
    LIMIT ${limit}
  `);
  const items = (rows.rows ?? []).map((r) => ({
    id: r.id, slug: r.slug, name: r.name, cuisine: r.cuisine, category: r.category,
    imageUrl: r.image_url, thumbnailUrl: r.thumbnail_url, isVeg: r.is_veg, isActive: r.is_active,
    sortOrder: r.sort_order, aliases: r.aliases ?? [], tags: r.tags ?? [], attribution: r.attribution,
    lastAttached: r.last_attached,
  }));
  res.json({ rows: items });
});

/**
 * Recently used custom (non-library) photos uploaded or AI-generated by the
 * tenant — for the "Reuse a photo" tab in the unified picker.
 */
router.get("/stock-food-images/restaurant/recent-photos", async (req: Request, res: Response) => {
  if (!req.user) return void res.status(401).json({ error: "Authentication required" });
  const restaurantId = Number(req.query.restaurantId);
  if (!Number.isFinite(restaurantId)) return void res.status(400).json({ error: "restaurantId is required" });
  const limit = Math.min(30, Math.max(1, Number(req.query.limit ?? 12)));
  const result = await db.execute<{
    image_url: string; source: string; menu_item_id: number; menu_item_name: string | null; created_at: Date;
  }>(sql`
    SELECT DISTINCT ON (image_url) image_url, source, menu_item_id,
      (SELECT name FROM ${menuItemsTable} WHERE id = r.menu_item_id) AS menu_item_name,
      created_at
    FROM ${restaurantMenuItemImagesTable} r
    WHERE restaurant_id = ${restaurantId} AND library_image_id IS NULL
    ORDER BY image_url, created_at DESC
    LIMIT ${limit}
  `);
  res.json({ rows: result.rows ?? [] });
});

// ─── Super-admin CRUD ─────────────────────────────────────────────────
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
  dietaryType: z.string().trim().max(40).nullish(),
  mealType: z.string().trim().max(40).nullish(),
  spiceLevel: z.number().int().min(0).max(3).nullish(),
  provider: z.string().trim().max(40).nullish(),
  model: z.string().trim().max(80).nullish(),
  licenseStatus: z.enum(["approved", "restricted", "unknown"]).optional(),
  isApproved: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
});

router.get("/admin/stock-food-images", requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid query" });
  const filters = buildFilters(parsed.data, "admin");
  const where = filters.length > 0 ? and(...filters) : undefined;
  const baseQuery = db.select().from(stockFoodImagesTable);
  const rows = await (where ? baseQuery.where(where) : baseQuery)
    .orderBy(...buildOrderBy(parsed.data.sort ?? "recent"))
    .limit(parsed.data.limit).offset(parsed.data.offset);
  const countBase = db.select({ total: sql<number>`count(*)::int` }).from(stockFoodImagesTable);
  const [{ total }] = await (where ? countBase.where(where) : countBase);
  res.json({ rows, total, limit: parsed.data.limit, offset: parsed.data.offset });
});

router.post("/admin/stock-food-images", requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = BaseInputSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const data = parsed.data;
  const slug = slugifyName(data.slug ?? data.name);
  const [existing] = await db.select({ id: stockFoodImagesTable.id })
    .from(stockFoodImagesTable).where(eq(stockFoodImagesTable.slug, slug));
  if (existing) return void res.status(409).json({ error: `Slug "${slug}" already exists`, slug });
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
    dietaryType: data.dietaryType ?? null,
    mealType: data.mealType ?? null,
    spiceLevel: data.spiceLevel ?? null,
    provider: data.provider ?? "upload",
    model: data.model ?? null,
    licenseStatus: data.licenseStatus ?? "unknown",
    isApproved: data.isApproved ?? true,
    isFeatured: data.isFeatured ?? false,
    createdBy: req.user?.sub ?? null,
  }).returning();
  invalidateStockFoodCache();
  await recordAuditLog({ req, module: "khana_ai", action: "stock_food_image.create",
    entity: "stock_food_image", entityId: row.id, newValue: row });
  res.status(201).json(row);
});

const PatchSchema = BaseInputSchema.partial();
router.patch("/admin/stock-food-images/:id", requireSuperAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return void res.status(400).json({ error: "Invalid id" });
  const parsed = PatchSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const data = parsed.data;
  const [before] = await db.select().from(stockFoodImagesTable).where(eq(stockFoodImagesTable.id, id));
  if (!before) return void res.status(404).json({ error: "Not found" });

  const updates: Partial<typeof stockFoodImagesTable.$inferInsert> = { updatedAt: new Date() };
  for (const k of ["name", "cuisine", "category", "imageUrl", "thumbnailUrl", "aliases", "tags",
    "isVeg", "isActive", "sortOrder", "attribution", "dietaryType", "mealType", "spiceLevel",
    "provider", "model", "licenseStatus", "isApproved", "isFeatured"] as const) {
    if (data[k as keyof typeof data] !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (updates as any)[k] = (data as any)[k] ?? null;
    }
  }
  if (data.slug !== undefined) {
    updates.slug = slugifyName(data.slug);
    if (updates.slug !== before.slug) {
      const [clash] = await db.select({ id: stockFoodImagesTable.id })
        .from(stockFoodImagesTable).where(eq(stockFoodImagesTable.slug, updates.slug));
      if (clash) return void res.status(409).json({ error: `Slug "${updates.slug}" already exists` });
    }
  }
  const [row] = await db.update(stockFoodImagesTable).set(updates).where(eq(stockFoodImagesTable.id, id)).returning();
  invalidateStockFoodCache();
  await recordAuditLog({ req, module: "khana_ai", action: "stock_food_image.update",
    entity: "stock_food_image", entityId: id, oldValue: before, newValue: row });
  res.json(row);
});

// ─── Bulk actions (approve/feature/deactivate/delete) ─────────────────
const BulkActionBody = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  action: z.enum(["approve", "unapprove", "feature", "unfeature", "activate", "deactivate"]),
});
router.post("/admin/stock-food-images/bulk-action", requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = BulkActionBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const { ids, action } = parsed.data;
  const updates: Partial<typeof stockFoodImagesTable.$inferInsert> = { updatedAt: new Date() };
  switch (action) {
    case "approve": updates.isApproved = true; break;
    case "unapprove": updates.isApproved = false; break;
    case "feature": updates.isFeatured = true; break;
    case "unfeature": updates.isFeatured = false; break;
    case "activate": updates.isActive = true; break;
    case "deactivate": updates.isActive = false; break;
  }
  const updated = await db.update(stockFoodImagesTable).set(updates)
    .where(inArray(stockFoodImagesTable.id, ids)).returning({ id: stockFoodImagesTable.id });
  invalidateStockFoodCache();
  await recordAuditLog({ req, module: "khana_ai", action: `stock_food_image.bulk_${action}`,
    entity: "stock_food_image", newValue: { ids, count: updated.length } });
  res.json({ ok: true, action, updated: updated.length });
});

// ─── Usage drawer endpoint ────────────────────────────────────────────
router.get("/admin/stock-food-images/:id/usage", requireSuperAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return void res.status(400).json({ error: "Invalid id" });
  const [row] = await db.select().from(stockFoodImagesTable).where(eq(stockFoodImagesTable.id, id));
  if (!row) return void res.status(404).json({ error: "Not found" });
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const usages = await db.execute<{
    id: number; restaurant_id: number; menu_item_id: number; source: string;
    image_url: string; created_at: Date; menu_item_name: string | null;
  }>(sql`
    SELECT r.id, r.restaurant_id, r.menu_item_id, r.source, r.image_url, r.created_at,
      (SELECT name FROM ${menuItemsTable} WHERE id = r.menu_item_id) AS menu_item_name
    FROM ${restaurantMenuItemImagesTable} r
    WHERE r.library_image_id = ${id}
    ORDER BY r.created_at DESC
    LIMIT ${limit}
  `);
  res.json({ image: row, usages: usages.rows ?? [] });
});

// ─── Bulk import via JSON paste ───────────────────────────────────────
const BulkEntrySchema = BaseInputSchema;
const BulkBody = z.object({
  entries: z.array(BulkEntrySchema).min(1).max(500),
  overwrite: z.boolean().optional(),
});
router.post("/admin/stock-food-images/bulk", requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = BulkBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const { entries, overwrite } = parsed.data;
  const existing = await db.select({ id: stockFoodImagesTable.id, slug: stockFoodImagesTable.slug }).from(stockFoodImagesTable);
  const slugToId = new Map(existing.map((r) => [r.slug, r.id]));
  let inserted = 0, updated = 0, skipped = 0;
  const errors: Array<{ name: string; error: string }> = [];
  for (const entry of entries) {
    try {
      const slug = slugifyName(entry.slug ?? entry.name);
      const values = {
        slug, name: entry.name,
        cuisine: entry.cuisine ?? null, category: entry.category ?? null,
        imageUrl: entry.imageUrl, thumbnailUrl: entry.thumbnailUrl ?? null,
        aliases: entry.aliases ?? [], tags: entry.tags ?? [],
        isVeg: entry.isVeg ?? true, isActive: entry.isActive ?? true,
        sortOrder: entry.sortOrder ?? 0, attribution: entry.attribution ?? null,
        dietaryType: entry.dietaryType ?? null, mealType: entry.mealType ?? null,
        spiceLevel: entry.spiceLevel ?? null,
        provider: entry.provider ?? "bulk_import", model: entry.model ?? null,
        licenseStatus: entry.licenseStatus ?? "unknown",
        isApproved: entry.isApproved ?? true, isFeatured: entry.isFeatured ?? false,
      };
      const existingId = slugToId.get(slug);
      if (existingId) {
        if (overwrite) {
          await db.update(stockFoodImagesTable).set({ ...values, updatedAt: new Date() })
            .where(eq(stockFoodImagesTable.id, existingId));
          updated++;
        } else skipped++;
      } else {
        await db.insert(stockFoodImagesTable).values({ ...values, source: "bulk_import", createdBy: req.user?.sub ?? null });
        inserted++;
      }
    } catch (err) {
      errors.push({ name: entry.name, error: (err as Error).message ?? "unknown" });
    }
  }
  invalidateStockFoodCache();
  await recordAuditLog({ req, module: "khana_ai", action: "stock_food_image.bulk_import",
    entity: "stock_food_image", newValue: { inserted, updated, skipped, errorCount: errors.length, overwrite: !!overwrite } });
  res.json({ inserted, updated, skipped, errors });
});

router.post("/admin/stock-food-images/reseed", requireSuperAdmin, async (req: Request, res: Response) => {
  await seedStockFoodImages();
  invalidateStockFoodCache();
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(stockFoodImagesTable);
  await recordAuditLog({ req, module: "khana_ai", action: "stock_food_image.reseed",
    entity: "stock_food_image", newValue: { totalAfter: total } });
  res.json({ ok: true, total });
});

// ─── AI Bulk Generation Jobs ──────────────────────────────────────────
const AiJobItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  cuisine: z.string().trim().max(60).nullish(),
  category: z.string().trim().max(60).nullish(),
  mealType: z.string().trim().max(40).nullish(),
  dietaryType: z.string().trim().max(40).nullish(),
  isVeg: z.boolean().optional(),
  spiceLevel: z.number().int().min(0).max(3).nullish(),
  aliases: z.array(z.string().trim().max(120)).max(10).optional(),
  tags: z.array(z.string().trim().max(60)).max(10).optional(),
  prompt: z.string().trim().max(800).optional(),
});
const AiJobCreateBody = z.object({
  provider: z.enum(["openai", "gemini", "stable-diffusion", "replicate"]).default("openai"),
  model: z.string().trim().max(80).nullish(),
  style: z.string().trim().max(400).nullish(),
  prompt: z.string().trim().max(800).nullish(),
  items: z.array(AiJobItemSchema).min(1).max(100),
});

router.post("/admin/stock-food-images/ai-jobs", requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = AiJobCreateBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const { provider, model, style, prompt, items } = parsed.data;
  const itemsState: AiJobItemState[] = items.map((i) => ({ ...i, status: "pending" as const }));
  const [job] = await db.insert(imageGenerationJobsTable).values({
    status: "pending",
    provider,
    model: model ?? null,
    style: style ?? null,
    prompt: prompt ?? null,
    totalItems: items.length,
    items: itemsState as unknown as Record<string, unknown>[],
    createdBy: req.user?.sub ?? null,
  }).returning();
  await recordAuditLog({ req, module: "khana_ai", action: "stock_food_image.ai_job_create",
    entity: "image_generation_job", entityId: job.id, newValue: { provider, count: items.length } });
  setImmediate(() => {
    runImageGenerationJob(job.id).catch((err) => req.log.error({ err, jobId: job.id }, "AI image job failed"));
  });
  res.status(202).json({ id: job.id, status: job.status, totalItems: job.totalItems });
});

router.get("/admin/stock-food-images/ai-jobs", requireSuperAdmin, async (req: Request, res: Response) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
  const rows = await db.select().from(imageGenerationJobsTable)
    .orderBy(desc(imageGenerationJobsTable.createdAt))
    .limit(limit);
  res.json({ rows });
});

router.get("/admin/stock-food-images/ai-jobs/:id", requireSuperAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return void res.status(400).json({ error: "Invalid id" });
  const [row] = await db.select().from(imageGenerationJobsTable).where(eq(imageGenerationJobsTable.id, id));
  if (!row) return void res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.post("/admin/stock-food-images/ai-jobs/:id/cancel", requireSuperAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return void res.status(400).json({ error: "Invalid id" });
  const [updated] = await db.update(imageGenerationJobsTable)
    .set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(imageGenerationJobsTable.id, id), inArray(imageGenerationJobsTable.status, ["pending", "running"])))
    .returning();
  if (!updated) return void res.status(409).json({ error: "Job already terminal" });
  await recordAuditLog({ req, module: "khana_ai", action: "stock_food_image.ai_job_cancel",
    entity: "image_generation_job", entityId: id });
  res.json({ ok: true });
});

// ─── Super-admin upload endpoints (unchanged) ─────────────────────────
const RequestUploadBody = z.object({
  name: z.string().trim().min(1).max(256).optional(),
  size: z.number().int().positive().optional(),
  contentType: z.string().trim().min(1).max(128).optional(),
}).optional();

router.post("/admin/stock-food-images/uploads/request-url", requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = RequestUploadBody.safeParse(req.body ?? {});
  if (!parsed.success) return void res.status(400).json({ error: "Invalid upload request" });
  const meta = parsed.data ?? {};
  if (meta.contentType) {
    const ct = meta.contentType.toLowerCase().split(";")[0].trim();
    if (!ALLOWED_UPLOAD_MIME.has(ct)) {
      return void res.status(415).json({ error: `File type "${meta.contentType}" not allowed. Allowed: ${Array.from(ALLOWED_UPLOAD_MIME).join(", ")}.` });
    }
  }
  if (meta.size != null && meta.size > MAX_UPLOAD_BYTES) {
    return void res.status(413).json({ error: `File too large (${Math.round(meta.size / 1024)} KB). Max ${Math.round(MAX_UPLOAD_BYTES / 1024)} KB.` });
  }
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath, maxBytes: MAX_UPLOAD_BYTES });
  } catch (err) {
    if (err instanceof ObjectStorageNotConfiguredError) return void res.status(503).json({ error: err.message });
    req.log.error({ err }, "stock-food upload URL failed");
    res.status(500).json({ error: `Couldn't start upload: ${(err as Error).message}` });
  }
});

router.post("/admin/stock-food-images/uploads/finalize", requireSuperAdmin, async (req: Request, res: Response) => {
  const { objectPath } = req.body as { objectPath?: string };
  if (!objectPath || typeof objectPath !== "string" || !objectPath.startsWith("/objects/")) {
    return void res.status(400).json({ error: "objectPath is required" });
  }
  try {
    let file;
    try { file = await objectStorageService.getObjectEntityFile(objectPath); }
    catch (e) {
      if (e instanceof ObjectNotFoundError) {
        await new Promise((r) => setTimeout(r, 500));
        file = await objectStorageService.getObjectEntityFile(objectPath);
      } else throw e;
    }
    let result;
    try { result = await sanitizeStoredUpload(file, { allowedKinds: ["image"], maxBytes: MAX_UPLOAD_BYTES }); }
    catch (e) {
      if (e instanceof UploadValidationError) return void res.status(e.statusCode).json({ error: e.message });
      throw e;
    }
    if (!ALLOWED_UPLOAD_MIME.has(result.mime)) {
      await file.delete().catch(() => undefined);
      return void res.status(415).json({ error: `Unsupported type "${result.mime}"` });
    }
    await setObjectAclPolicy(file, { restaurantId: "system", uploaderId: String(req.user?.sub ?? ""), visibility: "public" });
    const wildcardPath = objectPath.replace(/^\/objects\//, "");
    const publicUrl = `/api/public/storage/objects/${wildcardPath}`;
    res.json({ objectPath, publicUrl, contentType: result.mime, size: result.size });
  } catch (err) {
    req.log.error({ err }, "stock-food upload finalize failed");
    res.status(500).json({ error: `Couldn't finalize upload: ${(err as Error).message}` });
  }
});

router.delete("/admin/stock-food-images/:id", requireSuperAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return void res.status(400).json({ error: "Invalid id" });
  const [before] = await db.select().from(stockFoodImagesTable).where(eq(stockFoodImagesTable.id, id));
  if (!before) return void res.status(404).json({ error: "Not found" });
  const [row] = await db.update(stockFoodImagesTable).set({ isActive: false, updatedAt: new Date() })
    .where(eq(stockFoodImagesTable.id, id)).returning();
  invalidateStockFoodCache();
  await recordAuditLog({ req, module: "khana_ai", action: "stock_food_image.deactivate",
    entity: "stock_food_image", entityId: id, oldValue: before, newValue: row });
  res.json({ ok: true, row });
});

export default router;
