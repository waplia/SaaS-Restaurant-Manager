import { Router } from "express";
import { eq, and, ilike } from "drizzle-orm";
import { db, menusTable, menuCategoriesTable, menuItemsTable, modifierGroupsTable, modifiersTable, subscriptionPlansTable, tenantsTable, restaurantsTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

router.use("/restaurants/:restaurantId", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), validateRestaurantAccess);

/**
 * Verifies that the menu item identified by itemId belongs to a restaurant
 * that is within the authenticated user's tenant scope.
 * Returns the menuItem row or null if not found/unauthorized.
 */
async function resolveMenuItemTenantScope(
  itemId: number,
  user: NonNullable<Express.Request["user"]>
): Promise<boolean> {
  if (user.isSuperAdmin) return true;
  const [item] = await db
    .select({ restaurantId: menuItemsTable.restaurantId })
    .from(menuItemsTable)
    .where(eq(menuItemsTable.id, itemId));
  if (!item) return false;
  const [restaurant] = await db
    .select({ tenantId: restaurantsTable.tenantId })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, item.restaurantId));
  return restaurant?.tenantId === user.tenantId;
}

/**
 * Verifies that a modifier group belongs to a menu item in the user's tenant.
 */
async function resolveModifierGroupTenantScope(
  groupId: number,
  user: NonNullable<Express.Request["user"]>
): Promise<boolean> {
  if (user.isSuperAdmin) return true;
  const [group] = await db
    .select({ menuItemId: modifierGroupsTable.menuItemId })
    .from(modifierGroupsTable)
    .where(eq(modifierGroupsTable.id, groupId));
  if (!group) return false;
  return resolveMenuItemTenantScope(group.menuItemId, user);
}

router.get("/restaurants/:restaurantId/menus", async (req, res) => {
  const rows = await db.select().from(menusTable).where(eq(menusTable.restaurantId, Number(req.params.restaurantId)));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/menus", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { name, description, availableFrom, availableTo } = req.body;
  const [menu] = await db.insert(menusTable).values({ restaurantId: Number(req.params.restaurantId), name, description, availableFrom, availableTo }).returning();
  res.status(201).json(menu);
});

router.patch("/restaurants/:restaurantId/menus/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { name, description, availableFrom, availableTo, isActive, sortOrder } = req.body;
  const [updated] = await db.update(menusTable).set({ name, description, availableFrom, availableTo, isActive, sortOrder, updatedAt: new Date() }).where(and(eq(menusTable.id, Number(req.params.id)), eq(menusTable.restaurantId, Number(req.params.restaurantId)))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/menus/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  await db.delete(menusTable).where(and(eq(menusTable.id, Number(req.params.id)), eq(menusTable.restaurantId, Number(req.params.restaurantId))));
  res.status(204).send();
});

router.get("/restaurants/:restaurantId/categories", async (req, res) => {
  const { menuId } = req.query;
  const conditions: ReturnType<typeof eq>[] = [eq(menuCategoriesTable.restaurantId, Number(req.params.restaurantId))];
  if (menuId) conditions.push(eq(menuCategoriesTable.menuId, Number(menuId)));
  const rows = await db.select().from(menuCategoriesTable).where(and(...conditions));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/categories", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { menuId, name, description, imageUrl, sortOrder } = req.body;
  const [cat] = await db.insert(menuCategoriesTable).values({ restaurantId: Number(req.params.restaurantId), menuId, name, description, imageUrl, sortOrder }).returning();
  res.status(201).json(cat);
});

router.patch("/restaurants/:restaurantId/categories/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { name, description, imageUrl, sortOrder, isActive } = req.body;
  const [updated] = await db.update(menuCategoriesTable).set({ name, description, imageUrl, sortOrder, isActive, updatedAt: new Date() }).where(and(eq(menuCategoriesTable.id, Number(req.params.id)), eq(menuCategoriesTable.restaurantId, Number(req.params.restaurantId)))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/categories/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  await db.delete(menuCategoriesTable).where(and(eq(menuCategoriesTable.id, Number(req.params.id)), eq(menuCategoriesTable.restaurantId, Number(req.params.restaurantId))));
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

router.post("/restaurants/:restaurantId/items", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);

  if (!req.user!.isSuperAdmin) {
    const [restaurant] = await db.select({ tenantId: restaurantsTable.tenantId }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
    if (restaurant?.tenantId) {
      const [tenant] = await db.select({ planId: tenantsTable.planId }).from(tenantsTable).where(eq(tenantsTable.id, restaurant.tenantId));
      if (tenant?.planId) {
        const [plan] = await db.select({ maxMenuItems: subscriptionPlansTable.maxMenuItems }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, tenant.planId));
        if (plan && plan.maxMenuItems > 0) {
          const existing = await db.select().from(menuItemsTable).where(eq(menuItemsTable.restaurantId, restaurantId));
          if (existing.length >= plan.maxMenuItems) {
            return void res.status(402).json({ error: `Your plan allows a maximum of ${plan.maxMenuItems} menu item(s). Upgrade to add more.` });
          }
        }
      }
    }
  }

  const { categoryId, name, description, price, imageUrl, isVeg, preparationTime, calories, tags } = req.body;
  const [item] = await db.insert(menuItemsTable).values({ restaurantId, categoryId, name, description, price, imageUrl, isVeg, preparationTime, calories, tags }).returning();
  res.status(201).json(item);
});

router.get("/restaurants/:restaurantId/items/:id", async (req, res) => {
  const [item] = await db.select().from(menuItemsTable).where(and(eq(menuItemsTable.id, Number(req.params.id)), eq(menuItemsTable.restaurantId, Number(req.params.restaurantId))));
  if (!item) return void res.status(404).json({ error: "Not found" });
  res.json(item);
});

router.patch("/restaurants/:restaurantId/items/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { name, description, price, imageUrl, isVeg, isAvailable, preparationTime, calories, sortOrder, categoryId } = req.body;
  const [updated] = await db.update(menuItemsTable).set({ name, description, price, imageUrl, isVeg, isAvailable, preparationTime, calories, sortOrder, categoryId, updatedAt: new Date() }).where(and(eq(menuItemsTable.id, Number(req.params.id)), eq(menuItemsTable.restaurantId, Number(req.params.restaurantId)))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/items/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  await db.delete(menuItemsTable).where(and(eq(menuItemsTable.id, Number(req.params.id)), eq(menuItemsTable.restaurantId, Number(req.params.restaurantId))));
  res.status(204).send();
});

router.get("/restaurants/:restaurantId/items/export.csv", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const items = await db.select().from(menuItemsTable).where(eq(menuItemsTable.restaurantId, restaurantId));
  const categories = await db.select({ id: menuCategoriesTable.id, name: menuCategoriesTable.name }).from(menuCategoriesTable).where(eq(menuCategoriesTable.restaurantId, restaurantId));
  const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]));

  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const headers = ["Name", "Price", "Category", "Veg", "Available", "Prep Time", "Calories", "Tags"];
  const rows = items.map(item => [
    item.name,
    item.price,
    catMap[item.categoryId] ?? "",
    item.isVeg ? "Yes" : "No",
    item.isAvailable ? "Yes" : "No",
    item.preparationTime ?? "",
    item.calories ?? "",
    Array.isArray(item.tags) ? (item.tags as string[]).join(";") : "",
  ].map(escape).join(","));

  const csv = [headers.map(escape).join(","), ...rows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="menu-items-${restaurantId}.csv"`);
  res.send(csv);
});

router.post("/restaurants/:restaurantId/items/import", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);

  const { items } = req.body as {
    items: Array<{
      name: string;
      price: string;
      categoryName?: string;
      isVeg?: boolean;
      preparationTime?: number;
      calories?: number;
      tags?: string[];
    }>;
  };

  if (!Array.isArray(items) || items.length === 0) {
    return void res.status(400).json({ error: "items array is required" });
  }

  const categories = await db.select({ id: menuCategoriesTable.id, name: menuCategoriesTable.name }).from(menuCategoriesTable).where(eq(menuCategoriesTable.restaurantId, restaurantId));
  const catByName = Object.fromEntries(categories.map(c => [c.name.toLowerCase(), c.id]));
  const defaultCatId = categories[0]?.id;

  if (!defaultCatId) {
    return void res.status(422).json({ error: "No categories exist for this restaurant. Create at least one category before importing." });
  }

  const errors: string[] = [];
  const toInsert: typeof menuItemsTable.$inferInsert[] = [];

  for (let i = 0; i < items.length; i++) {
    const row = items[i];
    if (!row.name?.trim() || !row.price) {
      errors.push(`Row ${i + 1}: name and price are required`);
      continue;
    }
    const price = parseFloat(String(row.price));
    if (isNaN(price) || price < 0) {
      errors.push(`Row ${i + 1}: invalid price "${row.price}"`);
      continue;
    }
    const catId = (row.categoryName ? catByName[row.categoryName.toLowerCase()] : undefined) ?? defaultCatId;
    toInsert.push({
      restaurantId,
      categoryId: catId,
      name: row.name.trim(),
      price: String(price.toFixed(2)),
      description: "",
      isVeg: row.isVeg ?? false,
      preparationTime: row.preparationTime ?? 15,
      calories: row.calories ?? null,
      tags: row.tags ?? null,
    });
  }

  let imported = 0;
  if (toInsert.length > 0) {
    const inserted = await db.insert(menuItemsTable).values(toInsert).returning({ id: menuItemsTable.id });
    imported = inserted.length;
  }

  res.json({ imported, skipped: items.length - imported - errors.length, errors });
});

router.get("/items/:itemId/modifier-groups", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (req, res) => {
  const itemId = Number(req.params.itemId);
  const allowed = await resolveMenuItemTenantScope(itemId, req.user!);
  if (!allowed) return void res.status(403).json({ error: "Access denied" });
  const rows = await db.select().from(modifierGroupsTable).where(eq(modifierGroupsTable.menuItemId, itemId));
  res.json(rows);
});

router.post("/items/:itemId/modifier-groups", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const itemId = Number(req.params.itemId);
  const allowed = await resolveMenuItemTenantScope(itemId, req.user!);
  if (!allowed) return void res.status(403).json({ error: "Access denied" });
  const { name, isRequired, minSelections, maxSelections } = req.body;
  const [group] = await db.insert(modifierGroupsTable).values({ menuItemId: itemId, name, isRequired, minSelections, maxSelections }).returning();
  res.status(201).json(group);
});

router.get("/modifier-groups/:groupId/modifiers", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (req, res) => {
  const groupId = Number(req.params.groupId);
  const allowed = await resolveModifierGroupTenantScope(groupId, req.user!);
  if (!allowed) return void res.status(403).json({ error: "Access denied" });
  const rows = await db.select().from(modifiersTable).where(eq(modifiersTable.groupId, groupId));
  res.json(rows);
});

router.post("/modifier-groups/:groupId/modifiers", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const groupId = Number(req.params.groupId);
  const allowed = await resolveModifierGroupTenantScope(groupId, req.user!);
  if (!allowed) return void res.status(403).json({ error: "Access denied" });
  const { name, price, isDefault } = req.body;
  const [modifier] = await db.insert(modifiersTable).values({ groupId, name, price, isDefault }).returning();
  res.status(201).json(modifier);
});

export default router;
