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
  slugifyName,
} from "../lib/stockFoodImages";
import { recordAuditLog } from "../lib/audit";

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

const BaseInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120).optional(),
  cuisine: z.string().trim().max(60).nullish(),
  category: z.string().trim().max(60).nullish(),
  imageUrl: z.string().trim().url().max(1000),
  thumbnailUrl: z.string().trim().url().max(1000).nullish(),
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
