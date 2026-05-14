import express, { Router } from "express";
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
  const { name, description, imageUrl, availableFrom, availableTo } = req.body;
  const [menu] = await db.insert(menusTable).values({ restaurantId: Number(req.params.restaurantId), name, description, imageUrl, availableFrom, availableTo }).returning();
  res.status(201).json(menu);
});

router.patch("/restaurants/:restaurantId/menus/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { name, description, imageUrl, availableFrom, availableTo, isActive, sortOrder } = req.body;
  const updates: Record<string, unknown> = { name, description, availableFrom, availableTo, isActive, sortOrder, updatedAt: new Date() };
  if (imageUrl !== undefined) updates.imageUrl = imageUrl === "" ? null : imageUrl;
  const [updated] = await db.update(menusTable).set(updates).where(and(eq(menusTable.id, Number(req.params.id)), eq(menusTable.restaurantId, Number(req.params.restaurantId)))).returning();
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
  const updates: Record<string, unknown> = { name, description, sortOrder, isActive, updatedAt: new Date() };
  if (imageUrl !== undefined) updates.imageUrl = imageUrl === "" ? null : imageUrl;
  const [updated] = await db.update(menuCategoriesTable).set(updates).where(and(eq(menuCategoriesTable.id, Number(req.params.id)), eq(menuCategoriesTable.restaurantId, Number(req.params.restaurantId)))).returning();
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

  const { categoryId, name, description, price, imageUrl, isVeg, preparationTime, calories, tags, kitchenId } = req.body;
  const [item] = await db.insert(menuItemsTable).values({ restaurantId, categoryId, name, description, price, imageUrl, isVeg, preparationTime, calories, tags, kitchenId: kitchenId ?? null }).returning();
  res.status(201).json(item);
});

router.get("/restaurants/:restaurantId/items/:id", async (req, res) => {
  const [item] = await db.select().from(menuItemsTable).where(and(eq(menuItemsTable.id, Number(req.params.id)), eq(menuItemsTable.restaurantId, Number(req.params.restaurantId))));
  if (!item) return void res.status(404).json({ error: "Not found" });
  res.json(item);
});

router.patch("/restaurants/:restaurantId/items/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { name, description, price, imageUrl, isVeg, isAvailable, preparationTime, calories, sortOrder, categoryId, kitchenId } = req.body;
  const updates: Record<string, unknown> = { name, description, price, isVeg, isAvailable, preparationTime, calories, sortOrder, categoryId, updatedAt: new Date() };
  if (imageUrl !== undefined) updates.imageUrl = imageUrl === "" ? null : imageUrl;
  if (kitchenId !== undefined) updates.kitchenId = kitchenId === "" ? null : kitchenId;
  const [updated] = await db.update(menuItemsTable).set(updates).where(and(eq(menuItemsTable.id, Number(req.params.id)), eq(menuItemsTable.restaurantId, Number(req.params.restaurantId)))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/items/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  await db.delete(menuItemsTable).where(and(eq(menuItemsTable.id, Number(req.params.id)), eq(menuItemsTable.restaurantId, Number(req.params.restaurantId))));
  res.status(204).send();
});

const EXPORT_HEADERS = [
  "SKU", "Menu", "Category", "Name", "Description", "Price", "Tax Rate",
  "Veg", "Available", "Prep Time", "Calories", "Tags", "Allergens", "Image URL",
] as const;

router.get("/restaurants/:restaurantId/items/export.csv", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const items = await db.select().from(menuItemsTable).where(eq(menuItemsTable.restaurantId, restaurantId));
  const categories = await db.select({ id: menuCategoriesTable.id, name: menuCategoriesTable.name, menuId: menuCategoriesTable.menuId }).from(menuCategoriesTable).where(eq(menuCategoriesTable.restaurantId, restaurantId));
  const menus = await db.select({ id: menusTable.id, name: menusTable.name }).from(menusTable).where(eq(menusTable.restaurantId, restaurantId));
  const menuMap = Object.fromEntries(menus.map(m => [m.id, m.name]));
  const catMap = Object.fromEntries(categories.map(c => [c.id, { name: c.name, menuId: c.menuId }]));

  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = items.map(item => {
    const cat = catMap[item.categoryId];
    return [
      item.sku ?? "",
      cat ? (menuMap[cat.menuId] ?? "") : "",
      cat?.name ?? "",
      item.name,
      item.description ?? "",
      item.price,
      item.taxRate ?? "",
      item.isVeg ? "Yes" : "No",
      item.isAvailable ? "Yes" : "No",
      item.preparationTime ?? "",
      item.calories ?? "",
      Array.isArray(item.tags) ? (item.tags as string[]).join(";") : "",
      Array.isArray(item.allergens) ? (item.allergens as string[]).join(";") : "",
      item.imageUrl ?? "",
    ].map(escape).join(",");
  });

  const csv = [EXPORT_HEADERS.map(escape).join(","), ...rows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="menu-items-${restaurantId}.csv"`);
  res.send(csv);
});

function parseCSVText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim().length > 0));
}

function csvToImportRows(text: string): ImportRowInput[] {
  const rows = parseCSVText(text);
  if (rows.length < 2) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = (n: string) => header.indexOf(n.toLowerCase());
  const i = {
    sku: idx("SKU"), menu: idx("Menu"), category: idx("Category"), name: idx("Name"),
    description: idx("Description"), price: idx("Price"), taxRate: idx("Tax Rate"),
    veg: idx("Veg"), available: idx("Available"), prep: idx("Prep Time"),
    calories: idx("Calories"), tags: idx("Tags"), allergens: idx("Allergens"),
    imageUrl: idx("Image URL"),
  };
  const get = (cols: string[], k: number) => (k >= 0 ? (cols[k] ?? "").trim() : "");
  return rows.slice(1).map(cols => ({
    sku: get(cols, i.sku) || null,
    name: get(cols, i.name),
    menuName: get(cols, i.menu),
    categoryName: get(cols, i.category),
    description: get(cols, i.description),
    price: get(cols, i.price),
    taxRate: get(cols, i.taxRate) || null,
    isVeg: get(cols, i.veg).toLowerCase() === "yes",
    isAvailable: get(cols, i.available).toLowerCase() !== "no",
    preparationTime: Number(get(cols, i.prep)) || 15,
    calories: get(cols, i.calories) ? Number(get(cols, i.calories)) : null,
    tags: get(cols, i.tags) ? get(cols, i.tags).split(";").map(s => s.trim()).filter(Boolean) : [],
    allergens: get(cols, i.allergens) ? get(cols, i.allergens).split(";").map(s => s.trim()).filter(Boolean) : [],
    imageUrl: get(cols, i.imageUrl) || null,
  }));
}

type ImportRowInput = {
  sku?: string | null;
  name?: string;
  menuName?: string;
  categoryName?: string;
  description?: string | null;
  price?: string | number;
  taxRate?: string | number | null;
  isVeg?: boolean;
  isAvailable?: boolean;
  preparationTime?: number | string;
  calories?: number | string | null;
  tags?: string[] | null;
  allergens?: string[] | null;
  imageUrl?: string | null;
};

type ImportRowResult = {
  row: number;
  status: "create" | "update" | "error";
  errors: string[];
  name: string;
  sku: string | null;
  category: string | null;
  matchedItemId: number | null;
};

router.post(
  "/restaurants/:restaurantId/items/import",
  requireRole("owner", "manager", "super_admin"),
  express.text({ type: ["text/csv", "text/plain"], limit: "5mb" }),
  async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const dryRun = req.query.dryRun === "1" || (typeof req.body === "object" && req.body && (req.body as { dryRun?: boolean }).dryRun === true);

  let items: ImportRowInput[];
  if (typeof req.body === "string") {
    items = csvToImportRows(req.body);
  } else if (req.body && Array.isArray((req.body as { items?: unknown }).items)) {
    items = (req.body as { items: ImportRowInput[] }).items;
  } else {
    return void res.status(400).json({ error: "Provide CSV text body or { items: [...] }" });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return void res.status(400).json({ error: "No data rows found" });
  }
  if (items.length > 5000) {
    return void res.status(413).json({ error: "Maximum 5000 rows per import" });
  }

  const menusExisting = await db
    .select({ id: menusTable.id, name: menusTable.name })
    .from(menusTable)
    .where(eq(menusTable.restaurantId, restaurantId));
  const menuByName = new Map(menusExisting.map(m => [m.name.toLowerCase(), m.id]));

  const categories = await db
    .select({ id: menuCategoriesTable.id, name: menuCategoriesTable.name, menuId: menuCategoriesTable.menuId })
    .from(menuCategoriesTable)
    .where(eq(menuCategoriesTable.restaurantId, restaurantId));
  const catByMenuName = new Map(categories.map(c => [`${c.menuId}::${c.name.toLowerCase()}`, c.id]));

  const existing = await db
    .select({
      id: menuItemsTable.id,
      sku: menuItemsTable.sku,
      name: menuItemsTable.name,
      categoryId: menuItemsTable.categoryId,
    })
    .from(menuItemsTable)
    .where(eq(menuItemsTable.restaurantId, restaurantId));
  const bySku = new Map<string, number>();
  const byCatName = new Map<string, number>();
  for (const it of existing) {
    if (it.sku) bySku.set(it.sku.toLowerCase(), it.id);
    byCatName.set(`${it.categoryId}::${it.name.toLowerCase()}`, it.id);
  }

  const results: ImportRowResult[] = [];
  const toCreate: Array<{ idx: number; menuName: string; categoryName: string; values: Omit<typeof menuItemsTable.$inferInsert, "categoryId"> }> = [];
  const toUpdate: Array<{ idx: number; id: number; values: Partial<typeof menuItemsTable.$inferInsert> }> = [];
  const seenSku = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const r = items[i] ?? {};
    const errors: string[] = [];

    const name = String(r.name ?? "").trim();
    if (!name) errors.push("Name is required");

    const priceNum = parseFloat(String(r.price ?? ""));
    if (!Number.isFinite(priceNum) || priceNum < 0) errors.push(`Invalid price "${r.price ?? ""}"`);

    const catName = String(r.categoryName ?? "").trim();
    const menuName = String(r.menuName ?? "").trim();
    let categoryId: number | undefined;
    if (!catName) errors.push("Category is required");
    else if (!menuName) errors.push("Menu is required");
    else {
      const existingMenuId = menuByName.get(menuName.toLowerCase());
      if (existingMenuId) categoryId = catByMenuName.get(`${existingMenuId}::${catName.toLowerCase()}`);
    }

    let taxRate: string | null = null;
    if (r.taxRate !== undefined && r.taxRate !== null && String(r.taxRate).trim() !== "") {
      const t = parseFloat(String(r.taxRate));
      if (!Number.isFinite(t) || t < 0 || t > 100) errors.push(`Invalid tax rate "${r.taxRate}"`);
      else taxRate = t.toFixed(2);
    }

    let calories: number | null = null;
    if (r.calories !== undefined && r.calories !== null && String(r.calories).trim() !== "") {
      const c = parseInt(String(r.calories), 10);
      if (!Number.isFinite(c) || c < 0) errors.push(`Invalid calories "${r.calories}"`);
      else calories = c;
    }

    let prep = 15;
    if (r.preparationTime !== undefined && String(r.preparationTime).trim() !== "") {
      const p = parseInt(String(r.preparationTime), 10);
      if (!Number.isFinite(p) || p < 0) errors.push(`Invalid prep time "${r.preparationTime}"`);
      else prep = p;
    }

    const sku = r.sku ? String(r.sku).trim() : "";
    if (sku) {
      const skuKey = sku.toLowerCase();
      if (seenSku.has(skuKey)) errors.push(`Duplicate SKU "${sku}" in this file`);
      else seenSku.add(skuKey);
    }

    let matchedId: number | null = null;
    if (sku && bySku.has(sku.toLowerCase())) {
      matchedId = bySku.get(sku.toLowerCase())!;
    } else if (categoryId && name) {
      matchedId = byCatName.get(`${categoryId}::${name.toLowerCase()}`) ?? null;
    }

    const result: ImportRowResult = {
      row: i + 1,
      status: errors.length ? "error" : matchedId ? "update" : "create",
      errors,
      name,
      sku: sku || null,
      category: catName || null,
      matchedItemId: matchedId,
    };
    results.push(result);

    if (errors.length) continue;

    const baseValues = {
      restaurantId,
      sku: sku || null,
      name,
      description: r.description != null ? String(r.description) : "",
      price: priceNum.toFixed(2),
      taxRate,
      isVeg: r.isVeg ?? true,
      isAvailable: r.isAvailable ?? true,
      preparationTime: prep,
      calories,
      tags: Array.isArray(r.tags) ? r.tags.filter(Boolean) : [],
      allergens: Array.isArray(r.allergens) ? r.allergens.filter(Boolean) : [],
      imageUrl: r.imageUrl ? String(r.imageUrl) : null,
    };

    if (matchedId && categoryId) {
      toUpdate.push({ idx: i, id: matchedId, values: { ...baseValues, categoryId } });
    } else {
      toCreate.push({ idx: i, menuName, categoryName: catName, values: baseValues });
    }
  }

  const summary = {
    total: results.length,
    create: results.filter(r => r.status === "create").length,
    update: results.filter(r => r.status === "update").length,
    error: results.filter(r => r.status === "error").length,
  };

  let planLimit: number | null = null;
  if (!req.user!.isSuperAdmin) {
    const [restaurant] = await db.select({ tenantId: restaurantsTable.tenantId }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
    if (restaurant?.tenantId) {
      const [tenant] = await db.select({ planId: tenantsTable.planId }).from(tenantsTable).where(eq(tenantsTable.id, restaurant.tenantId));
      if (tenant?.planId) {
        const [plan] = await db.select({ maxMenuItems: subscriptionPlansTable.maxMenuItems }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, tenant.planId));
        if (plan && plan.maxMenuItems > 0) planLimit = plan.maxMenuItems;
      }
    }
  }
  if (planLimit !== null) {
    const projected = existing.length + toCreate.length;
    if (projected > planLimit) {
      return void res.status(402).json({
        error: `Your plan allows a maximum of ${planLimit} menu item(s). This import would result in ${projected}.`,
        summary,
        results,
      });
    }
  }

  if (dryRun || summary.error > 0) {
    return void res.json({ dryRun: !!dryRun, committed: false, summary, results });
  }

  await db.transaction(async tx => {
    const menuIdByName = new Map(menuByName);
    const catIdByMenuCat = new Map(catByMenuName);

    const distinctNewMenus = new Set<string>();
    for (const c of toCreate) {
      if (!menuIdByName.has(c.menuName.toLowerCase())) distinctNewMenus.add(c.menuName);
    }
    for (const original of distinctNewMenus) {
      const [created] = await tx.insert(menusTable).values({ restaurantId, name: original }).returning({ id: menusTable.id });
      menuIdByName.set(original.toLowerCase(), created.id);
    }

    const seenNewCats = new Set<string>();
    for (const c of toCreate) {
      const menuId = menuIdByName.get(c.menuName.toLowerCase())!;
      const key = `${menuId}::${c.categoryName.toLowerCase()}`;
      if (catIdByMenuCat.has(key) || seenNewCats.has(key)) continue;
      seenNewCats.add(key);
      const [created] = await tx.insert(menuCategoriesTable).values({ restaurantId, menuId, name: c.categoryName }).returning({ id: menuCategoriesTable.id });
      catIdByMenuCat.set(key, created.id);
    }

    if (toCreate.length) {
      const insertValues = toCreate.map(c => {
        const menuId = menuIdByName.get(c.menuName.toLowerCase())!;
        const categoryId = catIdByMenuCat.get(`${menuId}::${c.categoryName.toLowerCase()}`)!;
        return { ...c.values, categoryId };
      });
      await tx.insert(menuItemsTable).values(insertValues);
    }
    for (const u of toUpdate) {
      await tx
        .update(menuItemsTable)
        .set({ ...u.values, updatedAt: new Date() })
        .where(and(eq(menuItemsTable.id, u.id), eq(menuItemsTable.restaurantId, restaurantId)));
    }
  });

  res.json({ dryRun: false, committed: true, summary, results });
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
