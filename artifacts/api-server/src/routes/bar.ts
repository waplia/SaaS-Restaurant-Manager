import { Router, type Request, type Response, type NextFunction } from "express";
import { eq, and, gte, lte, desc, sql, inArray, isNull } from "drizzle-orm";
import {
  db,
  restaurantsTable,
  inventoryItemsTable,
  inventoryTransactionsTable,
  menuItemsTable,
  kitchensTable,
  liquorProfilesTable,
  menuItemVariantsTable,
  bartenderShiftsTable,
  bartenderBottleCountsTable,
  barSalesTable,
  cashRegisterSessionsTable,
  paymentsTable,
  ordersTable,
  LIQUOR_CATEGORIES,
  VARIANT_KINDS,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router: Router = Router();

const LIQUOR_CATEGORY_SET = new Set<string>(LIQUOR_CATEGORIES as readonly string[]);
const VARIANT_KIND_SET = new Set<string>(VARIANT_KINDS as readonly string[]);
const SERVICE_MODES = new Set(["restaurant", "bar", "hybrid"]);
const MANAGER_ROLES = ["owner", "manager", "super_admin"] as const;

// ──────────────────────────── middleware ────────────────────────────

async function requireBarMode(req: Request, res: Response, next: NextFunction): Promise<void> {
  const restaurantId = Number(req.params.restaurantId);
  const [r] = await db
    .select({ serviceMode: restaurantsTable.serviceMode })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));
  if (!r) {
    res.status(404).json({ error: "Restaurant not found" });
    return;
  }
  if (r.serviceMode === "restaurant" && !req.user?.isSuperAdmin) {
    res.status(403).json({ error: "Bar mode is not enabled. Switch to Bar or Hybrid mode in Settings → Bar." });
    return;
  }
  next();
}

// Mode toggle is allowed even when bar mode is currently OFF, so we expose it
// outside the requireBarMode gate.
router.put(
  "/restaurants/:restaurantId/bar/mode",
  requireRole(...MANAGER_ROLES),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { serviceMode } = req.body as { serviceMode?: string };
    if (!serviceMode || !SERVICE_MODES.has(serviceMode)) {
      return void res.status(400).json({ error: "serviceMode must be one of restaurant|bar|hybrid" });
    }
    const [updated] = await db
      .update(restaurantsTable)
      .set({ serviceMode, updatedAt: new Date() })
      .where(eq(restaurantsTable.id, restaurantId))
      .returning({ id: restaurantsTable.id, serviceMode: restaurantsTable.serviceMode });
    if (!updated) return void res.status(404).json({ error: "Restaurant not found" });
    res.json(updated);
  },
);

// All other bar endpoints require an enabled mode.
router.use(
  "/restaurants/:restaurantId/bar",
  requireRole("owner", "manager", "waiter", "kitchen", "cashier", "super_admin"),
  validateRestaurantAccess,
  requireBarMode,
);

// ──────────────────────────── liquor SKUs ────────────────────────────

router.get("/restaurants/:restaurantId/bar/liquor-skus", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select({
      profile: liquorProfilesTable,
      inventoryItem: inventoryItemsTable,
    })
    .from(liquorProfilesTable)
    .innerJoin(inventoryItemsTable, eq(liquorProfilesTable.inventoryItemId, inventoryItemsTable.id))
    .where(eq(liquorProfilesTable.restaurantId, restaurantId))
    .orderBy(liquorProfilesTable.liquorCategory, inventoryItemsTable.name);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/bar/liquor-skus", requireRole(...MANAGER_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const {
    inventoryItemId,
    liquorCategory,
    bottleSizeMl,
    bottlesOnHand,
    openBottleMlRemaining,
    brand,
    notes,
  } = req.body as Record<string, unknown>;

  const invId = Number(inventoryItemId);
  if (!invId) return void res.status(400).json({ error: "inventoryItemId required" });
  const cat = typeof liquorCategory === "string" && LIQUOR_CATEGORY_SET.has(liquorCategory) ? liquorCategory : "other";
  const size = Math.max(1, Number(bottleSizeMl) || 750);

  const [inv] = await db.select().from(inventoryItemsTable).where(
    and(eq(inventoryItemsTable.id, invId), eq(inventoryItemsTable.restaurantId, restaurantId)),
  );
  if (!inv) return void res.status(404).json({ error: "Inventory item not found" });

  try {
    const [row] = await db.insert(liquorProfilesTable).values({
      restaurantId,
      inventoryItemId: invId,
      liquorCategory: cat,
      bottleSizeMl: size,
      bottlesOnHand: Math.max(0, Number(bottlesOnHand) || 0),
      openBottleMlRemaining: Math.max(0, Number(openBottleMlRemaining) || 0),
      brand: typeof brand === "string" ? brand : null,
      notes: typeof notes === "string" ? notes : null,
    }).returning();
    res.status(201).json(row);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return void res.status(409).json({ error: "A liquor profile already exists for this inventory item" });
    }
    throw e;
  }
});

router.patch("/restaurants/:restaurantId/bar/liquor-skus/:id", requireRole(...MANAGER_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const body = req.body as Record<string, unknown>;
  if (body.liquorCategory !== undefined) {
    const c = String(body.liquorCategory);
    if (!LIQUOR_CATEGORY_SET.has(c)) return void res.status(400).json({ error: "Invalid liquorCategory" });
    updates.liquorCategory = c;
  }
  if (body.bottleSizeMl !== undefined) updates.bottleSizeMl = Math.max(1, Number(body.bottleSizeMl) || 750);
  if (body.bottlesOnHand !== undefined) updates.bottlesOnHand = Math.max(0, Number(body.bottlesOnHand) || 0);
  if (body.openBottleMlRemaining !== undefined) updates.openBottleMlRemaining = Math.max(0, Number(body.openBottleMlRemaining) || 0);
  if (body.brand !== undefined) updates.brand = body.brand === null ? null : String(body.brand);
  if (body.notes !== undefined) updates.notes = body.notes === null ? null : String(body.notes);
  if (body.isActive !== undefined) updates.isActive = !!body.isActive;

  const [updated] = await db.update(liquorProfilesTable).set(updates)
    .where(and(eq(liquorProfilesTable.id, id), eq(liquorProfilesTable.restaurantId, restaurantId)))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Liquor SKU not found" });
  res.json(updated);
});

// ──────────────────────────── menu item variants ────────────────────────────

router.get("/restaurants/:restaurantId/bar/menu-items/:menuItemId/variants", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const menuItemId = Number(req.params.menuItemId);
  const rows = await db.select().from(menuItemVariantsTable)
    .where(and(eq(menuItemVariantsTable.restaurantId, restaurantId), eq(menuItemVariantsTable.menuItemId, menuItemId)))
    .orderBy(menuItemVariantsTable.sortOrder, menuItemVariantsTable.id);
  res.json(rows);
});

// Bulk fetch all variants for a restaurant — used by the variants tab and POS.
router.get("/restaurants/:restaurantId/bar/variants", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(menuItemVariantsTable)
    .where(eq(menuItemVariantsTable.restaurantId, restaurantId))
    .orderBy(menuItemVariantsTable.menuItemId, menuItemVariantsTable.sortOrder);
  res.json(rows);
});

router.post(
  "/restaurants/:restaurantId/bar/menu-items/:menuItemId/variants",
  requireRole(...MANAGER_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const menuItemId = Number(req.params.menuItemId);
    const { kind, label, mlPerSale, price, linkedInventoryItemId, sortOrder } = req.body as Record<string, unknown>;

    const [mi] = await db.select().from(menuItemsTable)
      .where(and(eq(menuItemsTable.id, menuItemId), eq(menuItemsTable.restaurantId, restaurantId)));
    if (!mi) return void res.status(404).json({ error: "Menu item not found" });

    const k = typeof kind === "string" && VARIANT_KIND_SET.has(kind) ? kind : "peg";
    const lbl = typeof label === "string" && label.trim().length > 0 ? label.trim() : null;
    if (!lbl) return void res.status(400).json({ error: "label required" });
    const priceNum = Number(price);
    if (!isFinite(priceNum) || priceNum < 0) return void res.status(400).json({ error: "price must be a non-negative number" });

    const [row] = await db.insert(menuItemVariantsTable).values({
      restaurantId,
      menuItemId,
      kind: k,
      label: lbl,
      mlPerSale: Math.max(0, Number(mlPerSale) || 0),
      price: priceNum.toFixed(2),
      linkedInventoryItemId: linkedInventoryItemId ? Number(linkedInventoryItemId) : null,
      sortOrder: Number(sortOrder) || 0,
    }).returning();

    // Auto-flag the parent menu item as a bar item once it has variants.
    if (!mi.isBarItem) {
      await db.update(menuItemsTable).set({ isBarItem: true }).where(eq(menuItemsTable.id, menuItemId));
    }
    res.status(201).json(row);
  },
);

router.patch(
  "/restaurants/:restaurantId/bar/variants/:id",
  requireRole(...MANAGER_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const body = req.body as Record<string, unknown>;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.kind !== undefined) {
      const k = String(body.kind);
      if (!VARIANT_KIND_SET.has(k)) return void res.status(400).json({ error: "Invalid kind" });
      updates.kind = k;
    }
    if (body.label !== undefined) updates.label = String(body.label).trim();
    if (body.mlPerSale !== undefined) updates.mlPerSale = Math.max(0, Number(body.mlPerSale) || 0);
    if (body.price !== undefined) {
      const p = Number(body.price);
      if (!isFinite(p) || p < 0) return void res.status(400).json({ error: "Invalid price" });
      updates.price = p.toFixed(2);
    }
    if (body.linkedInventoryItemId !== undefined) {
      updates.linkedInventoryItemId = body.linkedInventoryItemId ? Number(body.linkedInventoryItemId) : null;
    }
    if (body.sortOrder !== undefined) updates.sortOrder = Number(body.sortOrder) || 0;
    if (body.isActive !== undefined) updates.isActive = !!body.isActive;

    const [updated] = await db.update(menuItemVariantsTable).set(updates)
      .where(and(eq(menuItemVariantsTable.id, id), eq(menuItemVariantsTable.restaurantId, restaurantId)))
      .returning();
    if (!updated) return void res.status(404).json({ error: "Variant not found" });
    res.json(updated);
  },
);

router.delete(
  "/restaurants/:restaurantId/bar/variants/:id",
  requireRole(...MANAGER_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const [deleted] = await db.delete(menuItemVariantsTable)
      .where(and(eq(menuItemVariantsTable.id, id), eq(menuItemVariantsTable.restaurantId, restaurantId)))
      .returning({ id: menuItemVariantsTable.id });
    if (!deleted) return void res.status(404).json({ error: "Variant not found" });
    res.status(204).end();
  },
);

// ──────────────────────────── bar stations (kitchens with isBar) ────────────────────────────

router.get("/restaurants/:restaurantId/bar/stations", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(kitchensTable)
    .where(and(eq(kitchensTable.restaurantId, restaurantId), eq(kitchensTable.isBar, true)))
    .orderBy(kitchensTable.sortOrder, kitchensTable.id);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/bar/stations", requireRole(...MANAGER_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { name } = req.body as { name?: string };
  const trimmed = (name ?? "Bar").trim() || "Bar";
  const [row] = await db.insert(kitchensTable).values({
    restaurantId,
    name: trimmed,
    isBar: true,
    paperSize: "thermal-80mm",
    printerTarget: "browser",
  }).returning();
  res.status(201).json(row);
});

// ──────────────────────────── bartender shifts ────────────────────────────

router.get("/restaurants/:restaurantId/bar/shifts", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const filters = [eq(bartenderShiftsTable.restaurantId, restaurantId)];
  if (status) filters.push(eq(bartenderShiftsTable.status, status));
  const rows = await db.select().from(bartenderShiftsTable)
    .where(and(...filters))
    .orderBy(desc(bartenderShiftsTable.openedAt))
    .limit(200);
  res.json(rows);
});

router.get("/restaurants/:restaurantId/bar/shifts/current", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = req.user?.sub;
  if (!userId) return void res.status(401).json({ error: "Authentication required" });
  const [row] = await db.select().from(bartenderShiftsTable)
    .where(and(
      eq(bartenderShiftsTable.restaurantId, restaurantId),
      eq(bartenderShiftsTable.bartenderUserId, userId),
      eq(bartenderShiftsTable.status, "open"),
    ));
  res.json(row ?? null);
});

router.post("/restaurants/:restaurantId/bar/shifts/open", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = req.user?.sub;
  if (!userId) return void res.status(401).json({ error: "Authentication required" });

  const { cashSessionId, openingCounts, notes } = req.body as {
    cashSessionId?: number;
    openingCounts?: Array<{ inventoryItemId: number; bottlesCount: number; openBottleMl: number }>;
    notes?: string;
  };

  // Validate optional cashSessionId belongs to this restaurant.
  if (cashSessionId) {
    const [s] = await db.select({ id: cashRegisterSessionsTable.id }).from(cashRegisterSessionsTable)
      .where(and(eq(cashRegisterSessionsTable.id, cashSessionId), eq(cashRegisterSessionsTable.restaurantId, restaurantId)));
    if (!s) return void res.status(400).json({ error: "Cash session does not belong to this restaurant" });
  }

  try {
    const result = await db.transaction(async tx => {
      const [shift] = await tx.insert(bartenderShiftsTable).values({
        restaurantId,
        bartenderUserId: userId,
        cashSessionId: cashSessionId ?? null,
        status: "open",
        notes: notes ?? null,
      }).returning();

      if (Array.isArray(openingCounts) && openingCounts.length > 0) {
        const rows = openingCounts
          .filter(c => c && Number(c.inventoryItemId))
          .map(c => ({
            shiftId: shift.id,
            restaurantId,
            inventoryItemId: Number(c.inventoryItemId),
            phase: "opening" as const,
            bottlesCount: Math.max(0, Number(c.bottlesCount) || 0),
            openBottleMl: Math.max(0, Number(c.openBottleMl) || 0),
          }));
        if (rows.length > 0) await tx.insert(bartenderBottleCountsTable).values(rows);
      }
      return shift;
    });
    res.status(201).json(result);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return void res.status(409).json({ error: "You already have an open bartender shift" });
    }
    throw e;
  }
});

router.post("/restaurants/:restaurantId/bar/shifts/:id/close",
  requireRole("owner", "manager", "cashier", "waiter", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const shiftId = Number(req.params.id);
    const userId = req.user?.sub;
    if (!userId) return void res.status(401).json({ error: "Authentication required" });

    const { closingCounts, countedCash, tipsTotal, closeNotes } = req.body as {
      closingCounts?: Array<{ inventoryItemId: number; bottlesCount: number; openBottleMl: number; notes?: string }>;
      countedCash?: number | string;
      tipsTotal?: number | string;
      closeNotes?: string;
    };

    try {
      const result = await db.transaction(async tx => {
        const [shift] = await tx.select().from(bartenderShiftsTable)
          .where(and(eq(bartenderShiftsTable.id, shiftId), eq(bartenderShiftsTable.restaurantId, restaurantId)));
        if (!shift) throw new Error("NOT_FOUND");
        if (shift.status !== "open") throw new Error("NOT_OPEN");

        // Sales totals during the shift window.
        const closeAt = new Date();
        const salesAgg = await tx.select({
          total: sql<string>`cast(coalesce(sum(${barSalesTable.saleAmount}), 0) as text)`,
        }).from(barSalesTable)
          .where(eq(barSalesTable.bartenderShiftId, shiftId));
        const totalSales = Number(salesAgg[0]?.total ?? 0);

        // Expected cash: if linked to a cash session, defer to its expected
        // cash; otherwise just use total sales (best-effort).
        let expectedCash = totalSales;
        if (shift.cashSessionId) {
          const [cs] = await tx.select({ exp: cashRegisterSessionsTable.expectedCash })
            .from(cashRegisterSessionsTable)
            .where(eq(cashRegisterSessionsTable.id, shift.cashSessionId));
          if (cs?.exp != null) expectedCash = Number(cs.exp);
        }

        const counted = countedCash !== undefined ? Number(countedCash) : 0;
        const variance = counted - expectedCash;

        // Compute expected bottles+ml per SKU = opening + receipts (none tracked
        // here) − ml poured during shift. Receipts are out-of-scope; we trust
        // opening counts to be accurate.
        const opening = await tx.select().from(bartenderBottleCountsTable)
          .where(and(eq(bartenderBottleCountsTable.shiftId, shiftId), eq(bartenderBottleCountsTable.phase, "opening")));
        const pours = await tx.select({
          inventoryItemId: barSalesTable.inventoryItemId,
          mlTotal: sql<string>`cast(coalesce(sum(${barSalesTable.mlPoured}), 0) as text)`,
        }).from(barSalesTable)
          .where(eq(barSalesTable.bartenderShiftId, shiftId))
          .groupBy(barSalesTable.inventoryItemId);

        const profilesByInv = new Map<number, { bottleSizeMl: number }>();
        const invIds = opening.map(o => o.inventoryItemId);
        if (invIds.length > 0) {
          const profs = await tx.select().from(liquorProfilesTable)
            .where(and(eq(liquorProfilesTable.restaurantId, restaurantId), inArray(liquorProfilesTable.inventoryItemId, invIds)));
          for (const p of profs) profilesByInv.set(p.inventoryItemId, { bottleSizeMl: p.bottleSizeMl });
        }
        const pouredByInv = new Map<number, number>();
        for (const p of pours) {
          if (p.inventoryItemId != null) pouredByInv.set(p.inventoryItemId, Number(p.mlTotal));
        }

        const closingByInv = new Map<number, { bottlesCount: number; openBottleMl: number; notes?: string }>();
        for (const c of closingCounts ?? []) {
          if (!c || !Number(c.inventoryItemId)) continue;
          closingByInv.set(Number(c.inventoryItemId), {
            bottlesCount: Math.max(0, Number(c.bottlesCount) || 0),
            openBottleMl: Math.max(0, Number(c.openBottleMl) || 0),
            notes: c.notes,
          });
        }

        const closingRows: typeof bartenderBottleCountsTable.$inferInsert[] = [];
        for (const o of opening) {
          const counted = closingByInv.get(o.inventoryItemId);
          const prof = profilesByInv.get(o.inventoryItemId);
          const bottleSize = prof?.bottleSizeMl ?? 750;
          const totalMlOpening = o.bottlesCount * bottleSize + o.openBottleMl;
          const poured = pouredByInv.get(o.inventoryItemId) ?? 0;
          const expectedTotalMl = Math.max(0, totalMlOpening - poured);
          const expectedBottles = Math.floor(expectedTotalMl / bottleSize);
          const expectedOpenMl = expectedTotalMl - expectedBottles * bottleSize;
          const countedTotalMl = counted ? counted.bottlesCount * bottleSize + counted.openBottleMl : 0;
          closingRows.push({
            shiftId,
            restaurantId,
            inventoryItemId: o.inventoryItemId,
            phase: "closing",
            bottlesCount: counted?.bottlesCount ?? 0,
            openBottleMl: counted?.openBottleMl ?? 0,
            expectedBottles,
            expectedOpenBottleMl: expectedOpenMl,
            varianceMl: counted ? countedTotalMl - expectedTotalMl : null,
            notes: counted?.notes ?? null,
          });
        }
        if (closingRows.length > 0) await tx.insert(bartenderBottleCountsTable).values(closingRows);

        const [updated] = await tx.update(bartenderShiftsTable).set({
          status: "closed",
          closedAt: closeAt,
          countedCash: counted.toFixed(2),
          expectedCash: expectedCash.toFixed(2),
          cashVariance: variance.toFixed(2),
          tipsTotal: (Number(tipsTotal) || 0).toFixed(2),
          totalSales: totalSales.toFixed(2),
          closeNotes: closeNotes ?? null,
        }).where(and(eq(bartenderShiftsTable.id, shiftId), eq(bartenderShiftsTable.status, "open")))
          .returning();
        if (!updated) throw new Error("NOT_OPEN");
        return updated;
      });
      res.json(result);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "NOT_FOUND") return void res.status(404).json({ error: "Shift not found" });
      if (msg === "NOT_OPEN") return void res.status(409).json({ error: "Shift is no longer open" });
      throw e;
    }
  },
);

router.post("/restaurants/:restaurantId/bar/shifts/:id/approve",
  requireRole(...MANAGER_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const shiftId = Number(req.params.id);
    const userId = req.user?.sub;
    if (!userId) return void res.status(401).json({ error: "Authentication required" });

    const [updated] = await db.update(bartenderShiftsTable).set({
      status: "approved",
      approvedAt: new Date(),
      approvedByUserId: userId,
    }).where(and(
      eq(bartenderShiftsTable.id, shiftId),
      eq(bartenderShiftsTable.restaurantId, restaurantId),
      eq(bartenderShiftsTable.status, "closed"),
    )).returning();
    if (!updated) return void res.status(409).json({ error: "Shift must be in closed state to approve" });
    res.json(updated);
  },
);

router.get("/restaurants/:restaurantId/bar/shifts/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const shiftId = Number(req.params.id);
  const [shift] = await db.select().from(bartenderShiftsTable)
    .where(and(eq(bartenderShiftsTable.id, shiftId), eq(bartenderShiftsTable.restaurantId, restaurantId)));
  if (!shift) return void res.status(404).json({ error: "Shift not found" });
  const counts = await db.select().from(bartenderBottleCountsTable)
    .where(eq(bartenderBottleCountsTable.shiftId, shiftId));
  const sales = await db.select().from(barSalesTable)
    .where(eq(barSalesTable.bartenderShiftId, shiftId))
    .orderBy(desc(barSalesTable.createdAt))
    .limit(500);
  res.json({ shift, counts, sales });
});

// ──────────────────────────── liquor report ────────────────────────────

router.get("/restaurants/:restaurantId/bar/report", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : new Date();

  const filters = [
    eq(barSalesTable.restaurantId, restaurantId),
    gte(barSalesTable.createdAt, from),
    lte(barSalesTable.createdAt, to),
  ];

  const byCategory = await db.select({
    liquorCategory: barSalesTable.liquorCategory,
    mlPoured: sql<string>`cast(coalesce(sum(${barSalesTable.mlPoured}), 0) as text)`,
    saleAmount: sql<string>`cast(coalesce(sum(${barSalesTable.saleAmount}), 0) as text)`,
    qty: sql<number>`cast(coalesce(sum(${barSalesTable.qty}), 0) as int)`,
  }).from(barSalesTable)
    .where(and(...filters))
    .groupBy(barSalesTable.liquorCategory);

  const bySku = await db.select({
    inventoryItemId: barSalesTable.inventoryItemId,
    name: inventoryItemsTable.name,
    liquorCategory: barSalesTable.liquorCategory,
    mlPoured: sql<string>`cast(coalesce(sum(${barSalesTable.mlPoured}), 0) as text)`,
    saleAmount: sql<string>`cast(coalesce(sum(${barSalesTable.saleAmount}), 0) as text)`,
    qty: sql<number>`cast(coalesce(sum(${barSalesTable.qty}), 0) as int)`,
  }).from(barSalesTable)
    .leftJoin(inventoryItemsTable, eq(barSalesTable.inventoryItemId, inventoryItemsTable.id))
    .where(and(...filters))
    .groupBy(barSalesTable.inventoryItemId, inventoryItemsTable.name, barSalesTable.liquorCategory)
    .orderBy(desc(sql`sum(${barSalesTable.saleAmount})`));

  const totalsRow = await db.select({
    mlPoured: sql<string>`cast(coalesce(sum(${barSalesTable.mlPoured}), 0) as text)`,
    saleAmount: sql<string>`cast(coalesce(sum(${barSalesTable.saleAmount}), 0) as text)`,
    qty: sql<number>`cast(coalesce(sum(${barSalesTable.qty}), 0) as int)`,
  }).from(barSalesTable).where(and(...filters));

  res.json({
    from: from.toISOString(),
    to: to.toISOString(),
    totals: totalsRow[0] ?? { mlPoured: "0", saleAmount: "0", qty: 0 },
    byCategory,
    bySku,
  });
});

// ──────────────────────────── helper exports ────────────────────────────

/**
 * Apply the ml-deduction + bar-sale-ledger entry for an order item created
 * with a `variantId`. Called by orders.ts after the line is inserted.
 *
 * Strategy: drain `openBottleMlRemaining` first; when it can't cover the pour,
 * open another sealed bottle from `bottlesOnHand` (decrement) and continue.
 * Negative-stock conditions still record the sale but the variance shows up
 * in the bartender shift settlement.
 */
export async function recordVariantPour(args: {
  restaurantId: number;
  orderId: number;
  orderItemId: number;
  variantId: number;
  qty: number;
  unitPrice: number;
}): Promise<void> {
  const { restaurantId, orderId, orderItemId, variantId, qty, unitPrice } = args;
  const [variant] = await db.select().from(menuItemVariantsTable)
    .where(and(eq(menuItemVariantsTable.id, variantId), eq(menuItemVariantsTable.restaurantId, restaurantId)));
  if (!variant) return;

  const totalMl = (variant.mlPerSale ?? 0) * qty;
  let liquorCategory: string | null = null;
  let inventoryItemId: number | null = variant.linkedInventoryItemId ?? null;

  if (variant.linkedInventoryItemId && totalMl > 0) {
    await db.transaction(async tx => {
      const [profile] = await tx.select().from(liquorProfilesTable)
        .where(and(
          eq(liquorProfilesTable.restaurantId, restaurantId),
          eq(liquorProfilesTable.inventoryItemId, variant.linkedInventoryItemId!),
        ));
      if (!profile) return;
      liquorCategory = profile.liquorCategory;
      inventoryItemId = profile.inventoryItemId;

      let remainingMl = totalMl;
      let openMl = profile.openBottleMlRemaining;
      let bottles = profile.bottlesOnHand;

      while (remainingMl > 0) {
        if (openMl <= 0) {
          if (bottles <= 0) {
            // Out of stock — record the pour anyway, the variance will surface
            // in the shift settlement.
            openMl = -remainingMl;
            remainingMl = 0;
            break;
          }
          bottles -= 1;
          openMl = profile.bottleSizeMl;
        }
        const take = Math.min(remainingMl, openMl);
        openMl -= take;
        remainingMl -= take;
      }

      await tx.update(liquorProfilesTable).set({
        bottlesOnHand: bottles,
        openBottleMlRemaining: openMl,
        updatedAt: new Date(),
      }).where(eq(liquorProfilesTable.id, profile.id));

      // Mirror to inventory_transactions for audit trail (qty in ml).
      await tx.insert(inventoryTransactionsTable).values({
        itemId: profile.inventoryItemId,
        restaurantId,
        type: "consume",
        quantity: (totalMl / 1000).toFixed(3),
        notes: `Bar pour for order #${orderId}, item ${orderItemId}, ${totalMl} ml`,
        referenceId: orderItemId,
        referenceType: "bar_pour",
      }).catch(() => {});
    });
  }

  // Find the open bartender shift (any bartender) — first open shift wins.
  const [shift] = await db.select({ id: bartenderShiftsTable.id }).from(bartenderShiftsTable)
    .where(and(eq(bartenderShiftsTable.restaurantId, restaurantId), eq(bartenderShiftsTable.status, "open")))
    .orderBy(desc(bartenderShiftsTable.openedAt))
    .limit(1);

  await db.insert(barSalesTable).values({
    restaurantId,
    orderId,
    orderItemId,
    variantId,
    menuItemId: variant.menuItemId,
    inventoryItemId,
    bartenderShiftId: shift?.id ?? null,
    liquorCategory,
    mlPoured: totalMl,
    qty,
    saleAmount: (unitPrice * qty).toFixed(2),
  }).catch(() => {});
}

export default router;
