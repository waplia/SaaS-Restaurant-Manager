import { Router } from "express";
import { eq, and, ilike } from "drizzle-orm";
import { db, menusTable, menuCategoriesTable, menuItemsTable, modifierGroupsTable, modifiersTable } from "../lib/db";

const router = Router();

router.get("/restaurants/:restaurantId/menus", async (req, res) => {
  const rows = await db.select().from(menusTable).where(eq(menusTable.restaurantId, Number(req.params.restaurantId)));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/menus", async (req, res) => {
  const { name, description, availableFrom, availableTo } = req.body;
  const [menu] = await db.insert(menusTable).values({ restaurantId: Number(req.params.restaurantId), name, description, availableFrom, availableTo }).returning();
  res.status(201).json(menu);
});

router.patch("/restaurants/:restaurantId/menus/:id", async (req, res) => {
  const { name, description, availableFrom, availableTo, isActive, sortOrder } = req.body;
  const [updated] = await db.update(menusTable).set({ name, description, availableFrom, availableTo, isActive, sortOrder, updatedAt: new Date() }).where(eq(menusTable.id, Number(req.params.id))).returning();
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/menus/:id", async (req, res) => {
  await db.delete(menusTable).where(eq(menusTable.id, Number(req.params.id)));
  res.status(204).send();
});

router.get("/restaurants/:restaurantId/categories", async (req, res) => {
  const { menuId } = req.query;
  const conditions: ReturnType<typeof eq>[] = [eq(menuCategoriesTable.restaurantId, Number(req.params.restaurantId))];
  if (menuId) conditions.push(eq(menuCategoriesTable.menuId, Number(menuId)));
  const rows = await db.select().from(menuCategoriesTable).where(and(...conditions));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/categories", async (req, res) => {
  const { menuId, name, description, imageUrl, sortOrder } = req.body;
  const [cat] = await db.insert(menuCategoriesTable).values({ restaurantId: Number(req.params.restaurantId), menuId, name, description, imageUrl, sortOrder }).returning();
  res.status(201).json(cat);
});

router.patch("/restaurants/:restaurantId/categories/:id", async (req, res) => {
  const { name, description, imageUrl, sortOrder, isActive } = req.body;
  const [updated] = await db.update(menuCategoriesTable).set({ name, description, imageUrl, sortOrder, isActive, updatedAt: new Date() }).where(eq(menuCategoriesTable.id, Number(req.params.id))).returning();
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/categories/:id", async (req, res) => {
  await db.delete(menuCategoriesTable).where(eq(menuCategoriesTable.id, Number(req.params.id)));
  res.status(204).send();
});

router.get("/restaurants/:restaurantId/items", async (req, res) => {
  const { categoryId, search } = req.query;
  const conditions: ReturnType<typeof eq | typeof ilike>[] = [eq(menuItemsTable.restaurantId, Number(req.params.restaurantId))];
  if (categoryId) conditions.push(eq(menuItemsTable.categoryId, Number(categoryId)));
  if (search) conditions.push(ilike(menuItemsTable.name, `%${search}%`));
  const rows = await db.select().from(menuItemsTable).where(and(...conditions));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/items", async (req, res) => {
  const { categoryId, name, description, price, imageUrl, isVeg, preparationTime, calories, tags } = req.body;
  const [item] = await db.insert(menuItemsTable).values({ restaurantId: Number(req.params.restaurantId), categoryId, name, description, price, imageUrl, isVeg, preparationTime, calories, tags }).returning();
  res.status(201).json(item);
});

router.get("/restaurants/:restaurantId/items/:id", async (req, res) => {
  const [item] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, Number(req.params.id)));
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});

router.patch("/restaurants/:restaurantId/items/:id", async (req, res) => {
  const { name, description, price, imageUrl, isVeg, isAvailable, preparationTime, calories, sortOrder, categoryId } = req.body;
  const [updated] = await db.update(menuItemsTable).set({ name, description, price, imageUrl, isVeg, isAvailable, preparationTime, calories, sortOrder, categoryId, updatedAt: new Date() }).where(eq(menuItemsTable.id, Number(req.params.id))).returning();
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/items/:id", async (req, res) => {
  await db.delete(menuItemsTable).where(eq(menuItemsTable.id, Number(req.params.id)));
  res.status(204).send();
});

router.get("/items/:itemId/modifier-groups", async (req, res) => {
  const rows = await db.select().from(modifierGroupsTable).where(eq(modifierGroupsTable.menuItemId, Number(req.params.itemId)));
  res.json(rows);
});

router.post("/items/:itemId/modifier-groups", async (req, res) => {
  const { name, isRequired, minSelections, maxSelections } = req.body;
  const [group] = await db.insert(modifierGroupsTable).values({ menuItemId: Number(req.params.itemId), name, isRequired, minSelections, maxSelections }).returning();
  res.status(201).json(group);
});

router.get("/modifier-groups/:groupId/modifiers", async (req, res) => {
  const rows = await db.select().from(modifiersTable).where(eq(modifiersTable.groupId, Number(req.params.groupId)));
  res.json(rows);
});

router.post("/modifier-groups/:groupId/modifiers", async (req, res) => {
  const { name, price, isDefault } = req.body;
  const [modifier] = await db.insert(modifiersTable).values({ groupId: Number(req.params.groupId), name, price, isDefault }).returning();
  res.status(201).json(modifier);
});

export default router;
