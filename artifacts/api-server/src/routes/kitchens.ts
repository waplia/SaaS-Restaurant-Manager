import { Router } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, kitchensTable, menuItemsTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { getDefaultKitchenId } from "../lib/kitchenRouting";
import { validate } from "../middleware/validate";
import { z } from "zod";

const router = Router();

const PaperSize = z.enum(["thermal-58mm", "thermal-80mm", "a4", "a5"]);
const PrinterTarget = z.enum(["browser", "network", "bluetooth", "usb"]);

const CreateKitchenBody = z.object({
  name: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().min(0).optional(),
  printerName: z.string().max(120).nullable().optional(),
  paperSize: PaperSize.optional(),
  autoPrint: z.boolean().optional(),
  printerTarget: PrinterTarget.optional(),
  isDefault: z.boolean().optional(),
});

const UpdateKitchenBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  sortOrder: z.number().int().min(0).optional(),
  printerName: z.string().max(120).nullable().optional(),
  paperSize: PaperSize.optional(),
  autoPrint: z.boolean().optional(),
  printerTarget: PrinterTarget.optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const ReorderKitchensBody = z.object({
  order: z.array(z.coerce.number().int().positive()).min(1),
});

const BulkKitchenBody = z.object({
  itemIds: z.array(z.coerce.number().int().positive()).min(1),
  kitchenId: z.coerce.number().int().positive().nullable(),
});

router.use(
  "/restaurants/:restaurantId",
  requireRole("owner", "manager", "waiter", "kitchen", "super_admin"),
  validateRestaurantAccess,
);

router.get("/restaurants/:restaurantId/kitchens", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  // Ensure default exists.
  await getDefaultKitchenId(restaurantId);
  const rows = await db
    .select()
    .from(kitchensTable)
    .where(eq(kitchensTable.restaurantId, restaurantId))
    .orderBy(kitchensTable.sortOrder, kitchensTable.id);
  res.json(rows);
});

router.post(
  "/restaurants/:restaurantId/kitchens",
  requireRole("owner", "manager", "super_admin"),
  validate({ body: CreateKitchenBody }),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { name, sortOrder, printerName, paperSize, autoPrint, printerTarget, isDefault } = req.body;

    if (isDefault) {
      await db
        .update(kitchensTable)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(kitchensTable.restaurantId, restaurantId));
    }

    const existingCount = await db
      .select({ id: kitchensTable.id })
      .from(kitchensTable)
      .where(eq(kitchensTable.restaurantId, restaurantId));

    const [k] = await db
      .insert(kitchensTable)
      .values({
        restaurantId,
        name: String(name).trim(),
        sortOrder: sortOrder ?? existingCount.length,
        printerName: printerName ?? null,
        paperSize: paperSize ?? "thermal-80mm",
        autoPrint: autoPrint ?? false,
        printerTarget: printerTarget ?? "browser",
        isDefault: isDefault ?? existingCount.length === 0,
      })
      .returning();
    res.status(201).json(k);
  },
);

router.patch(
  "/restaurants/:restaurantId/kitchens/:id",
  requireRole("owner", "manager", "super_admin"),
  validate({ body: UpdateKitchenBody }),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { name, sortOrder, printerName, paperSize, autoPrint, printerTarget, isDefault, isActive } =
      req.body;

    if (isDefault === true) {
      await db
        .update(kitchensTable)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(kitchensTable.restaurantId, restaurantId));
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = String(name).trim();
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    if (printerName !== undefined) updates.printerName = printerName;
    if (paperSize !== undefined) updates.paperSize = paperSize;
    if (autoPrint !== undefined) updates.autoPrint = autoPrint;
    if (printerTarget !== undefined) updates.printerTarget = printerTarget;
    if (isDefault !== undefined) updates.isDefault = isDefault;
    if (isActive !== undefined) updates.isActive = isActive;

    const [updated] = await db
      .update(kitchensTable)
      .set(updates)
      .where(and(eq(kitchensTable.id, id), eq(kitchensTable.restaurantId, restaurantId)))
      .returning();
    if (!updated) return void res.status(404).json({ error: "Not found" });
    res.json(updated);
  },
);

router.delete(
  "/restaurants/:restaurantId/kitchens/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const [k] = await db
      .select()
      .from(kitchensTable)
      .where(and(eq(kitchensTable.id, id), eq(kitchensTable.restaurantId, restaurantId)));
    if (!k) return void res.status(404).json({ error: "Not found" });
    if (k.isDefault) {
      return void res.status(400).json({ error: "Cannot delete the default kitchen" });
    }
    const defaultId = await getDefaultKitchenId(restaurantId);
    // Reassign any menu items pointing at this kitchen to the default.
    await db
      .update(menuItemsTable)
      .set({ kitchenId: defaultId, updatedAt: new Date() })
      .where(and(eq(menuItemsTable.restaurantId, restaurantId), eq(menuItemsTable.kitchenId, id)));
    await db.delete(kitchensTable).where(eq(kitchensTable.id, id));
    res.status(204).send();
  },
);

router.post(
  "/restaurants/:restaurantId/kitchens/reorder",
  requireRole("owner", "manager", "super_admin"),
  validate({ body: ReorderKitchensBody }),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { order } = req.body as { order: number[] };
    for (let i = 0; i < order.length; i++) {
      await db
        .update(kitchensTable)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(and(eq(kitchensTable.id, Number(order[i])), eq(kitchensTable.restaurantId, restaurantId)));
    }
    res.json({ ok: true });
  },
);

router.post(
  "/restaurants/:restaurantId/items/bulk-kitchen",
  requireRole("owner", "manager", "super_admin"),
  validate({ body: BulkKitchenBody }),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { itemIds, kitchenId } = req.body as { itemIds: number[]; kitchenId: number | null };
    if (kitchenId != null) {
      const [k] = await db
        .select()
        .from(kitchensTable)
        .where(and(eq(kitchensTable.id, Number(kitchenId)), eq(kitchensTable.restaurantId, restaurantId)));
      if (!k) return void res.status(404).json({ error: "Kitchen not found" });
    }
    await db
      .update(menuItemsTable)
      .set({ kitchenId: kitchenId ?? null, updatedAt: new Date() })
      .where(and(eq(menuItemsTable.restaurantId, restaurantId), inArray(menuItemsTable.id, itemIds.map(Number))));
    res.json({ updated: itemIds.length });
  },
);

export default router;
