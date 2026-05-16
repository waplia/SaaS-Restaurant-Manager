import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  competitorsTable,
  competitorMenuLinksTable,
  competitorItemsTable,
  competitorItemLinksTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

router.use(
  "/restaurants/:restaurantId/competitors",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);
router.use(
  "/restaurants/:restaurantId/competitor-items",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);

function trim(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function priceMaybe(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!isFinite(n) || n < 0) return undefined;
  return n.toFixed(2);
}

// ─── Competitors ───────────────────────────────────────────────
router.get("/restaurants/:restaurantId/competitors", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select()
    .from(competitorsTable)
    .where(eq(competitorsTable.restaurantId, restaurantId))
    .orderBy(desc(competitorsTable.createdAt));
  res.json({ data: rows });
});

router.post("/restaurants/:restaurantId/competitors", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const name = trim(req.body?.name);
  if (!name) return void res.status(400).json({ error: "name is required" });
  const [row] = await db
    .insert(competitorsTable)
    .values({
      restaurantId,
      name,
      area: trim(req.body?.area),
      cuisine: trim(req.body?.cuisine),
      notes: trim(req.body?.notes),
    })
    .returning();
  res.status(201).json(row);
});

router.get("/restaurants/:restaurantId/competitors/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [competitor] = await db
    .select()
    .from(competitorsTable)
    .where(and(eq(competitorsTable.id, id), eq(competitorsTable.restaurantId, restaurantId)));
  if (!competitor) return void res.status(404).json({ error: "Not found" });

  const [links, items, itemLinks] = await Promise.all([
    db
      .select()
      .from(competitorMenuLinksTable)
      .where(eq(competitorMenuLinksTable.competitorId, id))
      .orderBy(desc(competitorMenuLinksTable.createdAt)),
    db
      .select()
      .from(competitorItemsTable)
      .where(eq(competitorItemsTable.competitorId, id))
      .orderBy(desc(competitorItemsTable.createdAt)),
    db
      .select()
      .from(competitorItemLinksTable)
      .where(eq(competitorItemLinksTable.restaurantId, restaurantId)),
  ]);

  const linkByItemId = new Map<number, number>();
  for (const l of itemLinks) linkByItemId.set(l.competitorItemId, l.menuItemId);

  res.json({
    competitor,
    links,
    items: items.map((it) => ({ ...it, linkedMenuItemId: linkByItemId.get(it.id) ?? null })),
  });
});

router.patch("/restaurants/:restaurantId/competitors/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (req.body?.name !== undefined) {
    const n = trim(req.body.name);
    if (!n) return void res.status(400).json({ error: "name cannot be empty" });
    patch.name = n;
  }
  if (req.body?.area !== undefined) patch.area = trim(req.body.area);
  if (req.body?.cuisine !== undefined) patch.cuisine = trim(req.body.cuisine);
  if (req.body?.notes !== undefined) patch.notes = trim(req.body.notes);

  const [updated] = await db
    .update(competitorsTable)
    .set(patch)
    .where(and(eq(competitorsTable.id, id), eq(competitorsTable.restaurantId, restaurantId)))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/competitors/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const result = await db
    .delete(competitorsTable)
    .where(and(eq(competitorsTable.id, id), eq(competitorsTable.restaurantId, restaurantId)))
    .returning({ id: competitorsTable.id });
  if (result.length === 0) return void res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

router.post("/restaurants/:restaurantId/competitors/:id/refresh", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [updated] = await db
    .update(competitorsTable)
    .set({ lastRefreshedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(competitorsTable.id, id), eq(competitorsTable.restaurantId, restaurantId)))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

// ─── Menu links ────────────────────────────────────────────────
router.post("/restaurants/:restaurantId/competitors/:id/links", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const competitorId = Number(req.params.id);
  const label = trim(req.body?.label);
  const url = trim(req.body?.url);
  if (!label || !url) return void res.status(400).json({ error: "label and url are required" });
  const [competitor] = await db
    .select({ id: competitorsTable.id })
    .from(competitorsTable)
    .where(and(eq(competitorsTable.id, competitorId), eq(competitorsTable.restaurantId, restaurantId)));
  if (!competitor) return void res.status(404).json({ error: "Competitor not found" });
  const [row] = await db
    .insert(competitorMenuLinksTable)
    .values({ competitorId, restaurantId, label, url })
    .returning();
  res.status(201).json(row);
});

router.delete("/restaurants/:restaurantId/competitors/:id/links/:linkId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const competitorId = Number(req.params.id);
  const linkId = Number(req.params.linkId);
  const result = await db
    .delete(competitorMenuLinksTable)
    .where(
      and(
        eq(competitorMenuLinksTable.id, linkId),
        eq(competitorMenuLinksTable.competitorId, competitorId),
        eq(competitorMenuLinksTable.restaurantId, restaurantId),
      ),
    )
    .returning({ id: competitorMenuLinksTable.id });
  if (result.length === 0) return void res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

// ─── Items ─────────────────────────────────────────────────────
router.post("/restaurants/:restaurantId/competitors/:id/items", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const competitorId = Number(req.params.id);
  const name = trim(req.body?.name);
  if (!name) return void res.status(400).json({ error: "name is required" });
  const [competitor] = await db
    .select({ id: competitorsTable.id })
    .from(competitorsTable)
    .where(and(eq(competitorsTable.id, competitorId), eq(competitorsTable.restaurantId, restaurantId)));
  if (!competitor) return void res.status(404).json({ error: "Competitor not found" });
  const price = priceMaybe(req.body?.price);
  const isNew = req.body?.isNew === true || req.body?.isNew === "true";
  const [row] = await db
    .insert(competitorItemsTable)
    .values({
      competitorId,
      restaurantId,
      name,
      category: trim(req.body?.category),
      price: price === undefined ? null : price,
      description: trim(req.body?.description),
      offer: trim(req.body?.offer),
      notes: trim(req.body?.notes),
      isNew,
      noticedAt: isNew ? new Date() : null,
    })
    .returning();
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/competitor-items/:itemId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const itemId = Number(req.params.itemId);
  const [existing] = await db
    .select()
    .from(competitorItemsTable)
    .where(and(eq(competitorItemsTable.id, itemId), eq(competitorItemsTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (req.body?.name !== undefined) {
    const n = trim(req.body.name);
    if (!n) return void res.status(400).json({ error: "name cannot be empty" });
    patch.name = n;
  }
  if (req.body?.category !== undefined) patch.category = trim(req.body.category);
  if (req.body?.price !== undefined) {
    const p = priceMaybe(req.body.price);
    if (p === undefined && req.body.price !== null && req.body.price !== "") {
      return void res.status(400).json({ error: "Invalid price" });
    }
    patch.price = p ?? null;
  }
  if (req.body?.description !== undefined) patch.description = trim(req.body.description);
  if (req.body?.offer !== undefined) patch.offer = trim(req.body.offer);
  if (req.body?.notes !== undefined) patch.notes = trim(req.body.notes);
  if (req.body?.isNew !== undefined) {
    const isNew = req.body.isNew === true || req.body.isNew === "true";
    patch.isNew = isNew;
    if (isNew && !existing.isNew) patch.noticedAt = new Date();
    if (!isNew) patch.noticedAt = null;
  }

  const [updated] = await db
    .update(competitorItemsTable)
    .set(patch)
    .where(eq(competitorItemsTable.id, itemId))
    .returning();
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/competitor-items/:itemId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const itemId = Number(req.params.itemId);
  const result = await db
    .delete(competitorItemsTable)
    .where(and(eq(competitorItemsTable.id, itemId), eq(competitorItemsTable.restaurantId, restaurantId)))
    .returning({ id: competitorItemsTable.id });
  if (result.length === 0) return void res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

// ─── Manual item-to-own-item link ──────────────────────────────
router.put("/restaurants/:restaurantId/competitor-items/:itemId/link", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const itemId = Number(req.params.itemId);
  const menuItemIdRaw = req.body?.menuItemId;
  const [existing] = await db
    .select({ id: competitorItemsTable.id })
    .from(competitorItemsTable)
    .where(and(eq(competitorItemsTable.id, itemId), eq(competitorItemsTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });

  await db
    .delete(competitorItemLinksTable)
    .where(eq(competitorItemLinksTable.competitorItemId, itemId));

  if (menuItemIdRaw === null || menuItemIdRaw === undefined || menuItemIdRaw === "") {
    return void res.json({ competitorItemId: itemId, menuItemId: null });
  }
  const menuItemId = Number(menuItemIdRaw);
  if (!Number.isInteger(menuItemId) || menuItemId <= 0) {
    return void res.status(400).json({ error: "Invalid menuItemId" });
  }
  const [row] = await db
    .insert(competitorItemLinksTable)
    .values({ competitorItemId: itemId, menuItemId, restaurantId })
    .returning();
  res.json({ competitorItemId: itemId, menuItemId: row.menuItemId });
});

// ─── Aggregate views ───────────────────────────────────────────
router.get("/restaurants/:restaurantId/competitors-overview", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [competitors, items, links] = await Promise.all([
    db.select().from(competitorsTable).where(eq(competitorsTable.restaurantId, restaurantId)),
    db.select().from(competitorItemsTable).where(eq(competitorItemsTable.restaurantId, restaurantId)),
    db.select().from(competitorItemLinksTable).where(eq(competitorItemLinksTable.restaurantId, restaurantId)),
  ]);
  const linkByItemId = new Map<number, number>();
  for (const l of links) linkByItemId.set(l.competitorItemId, l.menuItemId);
  res.json({
    competitors,
    items: items.map((it) => ({ ...it, linkedMenuItemId: linkByItemId.get(it.id) ?? null })),
  });
});

export default router;
