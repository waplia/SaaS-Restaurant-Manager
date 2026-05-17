import { Router } from "express";
import { and, desc, eq, gte, lte, sql, inArray } from "drizzle-orm";
import {
  db,
  inventoryItemsTable,
  inventoryTransactionsTable,
  recipeMappingsTable,
  recipeVersionsTable,
  recipeVersionLinesTable,
  portionDriftEventsTable,
  tasteTestNotesTable,
  menuItemsTable,
  orderItemsTable,
  ordersTable,
  notificationsTable,
  NEW_AUDIT_ENTITIES,
  AUDIT_ACTIONS,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { requirePlanFeature } from "../middleware/planFeature";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { recordAuditLog } from "../lib/audit";

const router = Router();

const baseScopes = [
  "/restaurants/:restaurantId/packaging-items",
  "/restaurants/:restaurantId/packaging-recipes",
  "/restaurants/:restaurantId/condiment-items",
  "/restaurants/:restaurantId/condiment-recipes",
  "/restaurants/:restaurantId/portion-drift",
  "/restaurants/:restaurantId/recipe-versions",
  "/restaurants/:restaurantId/taste-tests",
];
router.use(baseScopes, requireRole("owner", "manager", "kitchen", "super_admin"), validateRestaurantAccess);

// ─────────────────────────────────────────────────────────────────
// PACKAGING & CONDIMENT — both are inventory_items with a `kind`,
// recipe mappings with same kind get auto-deducted on order completion.
// ─────────────────────────────────────────────────────────────────

function inventoryByKindRoutes(kind: "packaging" | "condiment", planKey: string, auditEntity: string) {
  const itemPath = `/restaurants/:restaurantId/${kind}-items`;
  const recipePath = `/restaurants/:restaurantId/${kind}-recipes`;

  router.use(itemPath, requirePlanFeature(planKey));
  router.use(recipePath, requirePlanFeature(planKey));

  router.get(itemPath, async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const rows = await db.select().from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.restaurantId, rid), eq(inventoryItemsTable.kind, kind), eq(inventoryItemsTable.isActive, true)));
    res.json(rows);
  });

  router.post(itemPath, requireRole("owner", "manager", "super_admin"), async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const { name, unit, currentStock, minStockLevel, parLevel, reorderQuantity, costPerUnit, supplierId } = req.body as Record<string, unknown>;
    if (!name || typeof name !== "string") return void res.status(400).json({ error: "name required" });
    const [inserted] = await db.insert(inventoryItemsTable).values({
      restaurantId: rid,
      name: String(name),
      unit: typeof unit === "string" ? unit : "unit",
      currentStock: currentStock != null ? String(currentStock) : "0.000",
      minStockLevel: minStockLevel != null ? String(minStockLevel) : "0.000",
      parLevel: parLevel != null ? String(parLevel) : null,
      reorderQuantity: reorderQuantity != null ? String(reorderQuantity) : null,
      costPerUnit: costPerUnit != null ? String(costPerUnit) : "0.00",
      supplierId: supplierId != null ? Number(supplierId) : null,
      category: kind,
      kind,
    }).returning();
    await recordAuditLog({ req, module: kind, action: AUDIT_ACTIONS.CREATED, entity: auditEntity, entityId: inserted!.id, restaurantId: rid, newValue: inserted });
    res.status(201).json(inserted);
  });

  router.patch(`${itemPath}/:id`, requireRole("owner", "manager", "super_admin"), async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const b = req.body as Record<string, unknown>;
    for (const k of ["name", "unit", "category"] as const) if (b[k] != null) updates[k] = String(b[k]);
    for (const k of ["currentStock", "minStockLevel", "parLevel", "reorderQuantity", "costPerUnit"] as const) {
      if (b[k] != null) updates[k] = String(b[k]);
    }
    if (b.supplierId !== undefined) updates.supplierId = b.supplierId == null ? null : Number(b.supplierId);
    const [before] = await db.select().from(inventoryItemsTable).where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.restaurantId, rid)));
    if (!before) return void res.status(404).json({ error: "Not found" });
    const [updated] = await db.update(inventoryItemsTable).set(updates).where(eq(inventoryItemsTable.id, id)).returning();
    await recordAuditLog({ req, module: kind, action: AUDIT_ACTIONS.UPDATED, entity: auditEntity, entityId: id, restaurantId: rid, oldValue: before, newValue: updated });
    res.json(updated);
  });

  router.delete(`${itemPath}/:id`, requireRole("owner", "manager", "super_admin"), async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    await db.update(inventoryItemsTable).set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.restaurantId, rid)));
    await recordAuditLog({ req, module: kind, action: AUDIT_ACTIONS.DELETED, entity: auditEntity, entityId: id, restaurantId: rid });
    res.status(204).send();
  });

  // Adjust stock (manual count, waste write-off, receive).
  router.post(`${itemPath}/:id/adjust`, requireRole("owner", "manager", "super_admin"), async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { delta, reason } = req.body as { delta: number | string; reason?: string };
    const d = Number(delta);
    if (!Number.isFinite(d)) return void res.status(400).json({ error: "delta required" });
    const [updated] = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(inventoryItemsTable)
        .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.restaurantId, rid))).for("update");
      if (!row) return [null];
      const newStock = Math.max(0, Number(row.currentStock) + d);
      const [u] = await tx.update(inventoryItemsTable)
        .set({ currentStock: newStock.toFixed(3), updatedAt: new Date() })
        .where(eq(inventoryItemsTable.id, id)).returning();
      await tx.insert(inventoryTransactionsTable).values({
        itemId: id,
        restaurantId: rid,
        type: d >= 0 ? "adjustment" : "use",
        quantity: Math.abs(d).toFixed(3),
        notes: reason ?? `Manual ${kind} adjustment`,
        referenceType: kind,
      });
      return [u];
    });
    if (!updated) return void res.status(404).json({ error: "Not found" });
    await recordAuditLog({ req, module: kind, action: AUDIT_ACTIONS.UPDATED, entity: auditEntity, entityId: id, restaurantId: rid, details: `delta=${d} reason=${reason ?? ""}` });
    res.json(updated);
  });

  // Recipe mappings (which menu_items consume which packaging/condiment items, and how much).
  router.get(recipePath, async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const { menuItemId } = req.query;
    const cond = [eq(recipeMappingsTable.restaurantId, rid), eq(recipeMappingsTable.kind, kind)];
    if (menuItemId) cond.push(eq(recipeMappingsTable.menuItemId, Number(menuItemId)));
    const rows = await db.select({
      id: recipeMappingsTable.id,
      menuItemId: recipeMappingsTable.menuItemId,
      menuItemName: menuItemsTable.name,
      inventoryItemId: recipeMappingsTable.inventoryItemId,
      inventoryItemName: inventoryItemsTable.name,
      quantity: recipeMappingsTable.quantity,
      unit: recipeMappingsTable.unit,
      kind: recipeMappingsTable.kind,
      costPerUnit: inventoryItemsTable.costPerUnit,
    }).from(recipeMappingsTable)
      .leftJoin(inventoryItemsTable, eq(recipeMappingsTable.inventoryItemId, inventoryItemsTable.id))
      .leftJoin(menuItemsTable, eq(recipeMappingsTable.menuItemId, menuItemsTable.id))
      .where(and(...cond));
    res.json(rows);
  });

  router.post(recipePath, requireRole("owner", "manager", "super_admin"), async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const { menuItemId, inventoryItemId, quantity, unit } = req.body as Record<string, unknown>;
    if (!menuItemId || !inventoryItemId) return void res.status(400).json({ error: "menuItemId and inventoryItemId required" });
    // Tenant-integrity: both the inventory item and the menu item must belong to this restaurant.
    const [inv] = await db.select({ kind: inventoryItemsTable.kind }).from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.id, Number(inventoryItemId)), eq(inventoryItemsTable.restaurantId, rid)));
    if (!inv || inv.kind !== kind) return void res.status(400).json({ error: `Inventory item is not a ${kind} in this restaurant` });
    const [mi] = await db.select({ id: menuItemsTable.id }).from(menuItemsTable)
      .where(and(eq(menuItemsTable.id, Number(menuItemId)), eq(menuItemsTable.restaurantId, rid)));
    if (!mi) return void res.status(400).json({ error: "menu item not found in this restaurant" });
    const [inserted] = await db.insert(recipeMappingsTable).values({
      restaurantId: rid,
      menuItemId: Number(menuItemId),
      inventoryItemId: Number(inventoryItemId),
      quantity: String(quantity ?? "1"),
      unit: typeof unit === "string" ? unit : "unit",
      kind,
    }).returning();
    await recordAuditLog({ req, module: kind, action: AUDIT_ACTIONS.CREATED, entity: auditEntity, entityId: inserted!.id, restaurantId: rid, newValue: inserted, details: `recipe_mapping for menu_item ${menuItemId}` });
    res.status(201).json(inserted);
  });

  router.patch(`${recipePath}/:id`, requireRole("owner", "manager", "super_admin"), async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body.quantity != null) updates.quantity = String(req.body.quantity);
    if (req.body.unit != null) updates.unit = String(req.body.unit);
    const [updated] = await db.update(recipeMappingsTable).set(updates)
      .where(and(eq(recipeMappingsTable.id, id), eq(recipeMappingsTable.restaurantId, rid), eq(recipeMappingsTable.kind, kind)))
      .returning();
    if (!updated) return void res.status(404).json({ error: "Not found" });
    await recordAuditLog({ req, module: kind, action: AUDIT_ACTIONS.UPDATED, entity: auditEntity, entityId: id, restaurantId: rid, newValue: updated });
    res.json(updated);
  });

  router.delete(`${recipePath}/:id`, requireRole("owner", "manager", "super_admin"), async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    await db.delete(recipeMappingsTable)
      .where(and(eq(recipeMappingsTable.id, id), eq(recipeMappingsTable.restaurantId, rid), eq(recipeMappingsTable.kind, kind)));
    await recordAuditLog({ req, module: kind, action: AUDIT_ACTIONS.DELETED, entity: auditEntity, entityId: id, restaurantId: rid });
    res.status(204).send();
  });
}

inventoryByKindRoutes("packaging", "inv_packaging", NEW_AUDIT_ENTITIES.PACKAGING_ITEM);
inventoryByKindRoutes("condiment", "inv_condiments", NEW_AUDIT_ENTITIES.CONDIMENT_USAGE);

// ─────────────────────────────────────────────────────────────────
// PORTION DRIFT
// ─────────────────────────────────────────────────────────────────

router.use("/restaurants/:restaurantId/portion-drift", requirePlanFeature("inv_portion_drift"));

router.get("/restaurants/:restaurantId/portion-drift", async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const { status, severity, from, to } = req.query;
  const cond = [eq(portionDriftEventsTable.restaurantId, rid)];
  if (status) cond.push(eq(portionDriftEventsTable.status, String(status)));
  if (severity) cond.push(eq(portionDriftEventsTable.severity, String(severity)));
  if (from) cond.push(gte(portionDriftEventsTable.createdAt, new Date(String(from))));
  if (to) cond.push(lte(portionDriftEventsTable.createdAt, new Date(String(to))));
  const rows = await db.select({
    id: portionDriftEventsTable.id,
    inventoryItemId: portionDriftEventsTable.inventoryItemId,
    inventoryItemName: inventoryItemsTable.name,
    inventoryUnit: inventoryItemsTable.unit,
    periodStart: portionDriftEventsTable.periodStart,
    periodEnd: portionDriftEventsTable.periodEnd,
    expectedQuantity: portionDriftEventsTable.expectedQuantity,
    actualQuantity: portionDriftEventsTable.actualQuantity,
    driftPct: portionDriftEventsTable.driftPct,
    severity: portionDriftEventsTable.severity,
    status: portionDriftEventsTable.status,
    notes: portionDriftEventsTable.notes,
    createdAt: portionDriftEventsTable.createdAt,
    acknowledgedAt: portionDriftEventsTable.acknowledgedAt,
  }).from(portionDriftEventsTable)
    .leftJoin(inventoryItemsTable, eq(portionDriftEventsTable.inventoryItemId, inventoryItemsTable.id))
    .where(and(...cond))
    .orderBy(desc(portionDriftEventsTable.createdAt))
    .limit(500);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/portion-drift/:id/ack", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { notes, resolved } = req.body as { notes?: string; resolved?: boolean };
  const userId = req.user?.sub ?? req.user?.id ?? null;
  const [updated] = await db.update(portionDriftEventsTable).set({
    status: resolved ? "resolved" : "acknowledged",
    acknowledgedBy: userId,
    acknowledgedAt: new Date(),
    notes: notes ?? null,
  }).where(and(eq(portionDriftEventsTable.id, id), eq(portionDriftEventsTable.restaurantId, rid))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({ req, module: "portion_drift", action: resolved ? AUDIT_ACTIONS.RESOLVED : AUDIT_ACTIONS.UPDATED, entity: NEW_AUDIT_ENTITIES.PORTION_DRIFT_ALERT, entityId: id, restaurantId: rid, details: notes });
  res.json(updated);
});

router.post("/restaurants/:restaurantId/portion-drift/run", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const { days } = req.body as { days?: number };
  const lookback = Math.max(1, Math.min(30, Number(days ?? 1)));
  const summary = await runPortionDriftSweep(rid, lookback);
  await recordAuditLog({ req, module: "portion_drift", action: AUDIT_ACTIONS.TRIGGERED, entity: NEW_AUDIT_ENTITIES.PORTION_DRIFT_ALERT, restaurantId: rid, details: `manual sweep ${lookback}d → ${summary.created} new` });
  res.json(summary);
});

/**
 * For each ingredient consumed by orders in [periodStart, periodEnd],
 * compute expected_quantity = Σ(recipe_mapping.quantity × order_items.quantity)
 * across all kinds, and actual_quantity = Σ(inventory_transactions.quantity)
 * for type='use'. If |drift| > 5% AND |diff| > min threshold, create an event.
 */
export async function runPortionDriftSweep(restaurantId: number, lookbackDays: number): Promise<{ created: number; checked: number }> {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const expectedRows = await db.execute(sql`
    SELECT rm.inventory_item_id AS item_id,
           SUM(rm.quantity::numeric * oi.quantity)::numeric AS expected
      FROM recipe_mappings rm
      JOIN order_items oi ON oi.menu_item_id = rm.menu_item_id
      JOIN orders o ON o.id = oi.order_id
     WHERE rm.restaurant_id = ${restaurantId}
       AND o.restaurant_id = ${restaurantId}
       AND o.payment_status = 'paid'
       AND o.created_at >= ${periodStart}
       AND o.created_at <  ${periodEnd}
     GROUP BY rm.inventory_item_id
  `);

  const actualRows = await db.execute(sql`
    SELECT item_id, SUM(quantity::numeric)::numeric AS actual
      FROM inventory_transactions
     WHERE restaurant_id = ${restaurantId}
       AND type = 'use'
       AND created_at >= ${periodStart}
       AND created_at <  ${periodEnd}
     GROUP BY item_id
  `);

  const exp = new Map<number, number>();
  for (const r of (expectedRows as unknown as { rows: { item_id: number; expected: string }[] }).rows) {
    exp.set(Number(r.item_id), Number(r.expected ?? 0));
  }
  const act = new Map<number, number>();
  for (const r of (actualRows as unknown as { rows: { item_id: number; actual: string }[] }).rows) {
    act.set(Number(r.item_id), Number(r.actual ?? 0));
  }

  const allIds = new Set<number>([...exp.keys(), ...act.keys()]);
  let created = 0;
  let checked = 0;
  for (const itemId of allIds) {
    checked++;
    const expectedQ = exp.get(itemId) ?? 0;
    const actualQ = act.get(itemId) ?? 0;
    if (expectedQ <= 0 && actualQ <= 0) continue;
    const base = Math.max(expectedQ, 0.0001);
    const driftPct = ((actualQ - expectedQ) / base) * 100;
    const absPct = Math.abs(driftPct);
    if (absPct < 10) continue;                              // ignore <10% noise
    const severity: "info" | "warning" | "critical" = absPct >= 25 ? "critical" : "warning";
    await db.insert(portionDriftEventsTable).values({
      restaurantId,
      inventoryItemId: itemId,
      periodStart,
      periodEnd,
      expectedQuantity: expectedQ.toFixed(3),
      actualQuantity: actualQ.toFixed(3),
      driftPct: driftPct.toFixed(2),
      severity,
      status: "open",
    });
    created++;
  }

  if (created > 0) {
    await db.insert(notificationsTable).values({
      restaurantId,
      type: "portion_drift",
      title: "Portion drift detected",
      message: `${created} ingredient(s) drifted >10% from expected usage in the last ${lookbackDays}d`,
      entityType: "portion_drift_alert",
    }).catch(() => {});
  }

  return { created, checked };
}

// ─────────────────────────────────────────────────────────────────
// RECIPE VERSIONS
// ─────────────────────────────────────────────────────────────────

router.use("/restaurants/:restaurantId/recipe-versions", requirePlanFeature("inv_recipe_versioning"));

router.get("/restaurants/:restaurantId/recipe-versions", async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const { menuItemId } = req.query;
  const cond = [eq(recipeVersionsTable.restaurantId, rid)];
  if (menuItemId) cond.push(eq(recipeVersionsTable.menuItemId, Number(menuItemId)));
  const rows = await db.select({
    id: recipeVersionsTable.id,
    menuItemId: recipeVersionsTable.menuItemId,
    menuItemName: menuItemsTable.name,
    versionNumber: recipeVersionsTable.versionNumber,
    status: recipeVersionsTable.status,
    isActive: recipeVersionsTable.isActive,
    totalCost: recipeVersionsTable.totalCost,
    notes: recipeVersionsTable.notes,
    createdBy: recipeVersionsTable.createdBy,
    approvedBy: recipeVersionsTable.approvedBy,
    approvedAt: recipeVersionsTable.approvedAt,
    activatedAt: recipeVersionsTable.activatedAt,
    createdAt: recipeVersionsTable.createdAt,
  }).from(recipeVersionsTable)
    .leftJoin(menuItemsTable, eq(recipeVersionsTable.menuItemId, menuItemsTable.id))
    .where(and(...cond))
    .orderBy(desc(recipeVersionsTable.menuItemId), desc(recipeVersionsTable.versionNumber));
  res.json(rows);
});

router.get("/restaurants/:restaurantId/recipe-versions/:id", async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [v] = await db.select().from(recipeVersionsTable)
    .where(and(eq(recipeVersionsTable.id, id), eq(recipeVersionsTable.restaurantId, rid)));
  if (!v) return void res.status(404).json({ error: "Not found" });
  const lines = await db.select({
    id: recipeVersionLinesTable.id,
    inventoryItemId: recipeVersionLinesTable.inventoryItemId,
    inventoryItemName: inventoryItemsTable.name,
    inventoryUnit: inventoryItemsTable.unit,
    quantity: recipeVersionLinesTable.quantity,
    unit: recipeVersionLinesTable.unit,
    costAtSnapshot: recipeVersionLinesTable.costAtSnapshot,
  }).from(recipeVersionLinesTable)
    .leftJoin(inventoryItemsTable, eq(recipeVersionLinesTable.inventoryItemId, inventoryItemsTable.id))
    .where(eq(recipeVersionLinesTable.versionId, id));
  res.json({ ...v, lines });
});

// Snapshot the currently-live recipe (or empty) into a new draft version.
router.post("/restaurants/:restaurantId/recipe-versions", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const { menuItemId, notes, lines } = req.body as { menuItemId: number; notes?: string; lines?: Array<{ inventoryItemId: number; quantity: string | number; unit?: string }> };
  if (!menuItemId) return void res.status(400).json({ error: "menuItemId required" });
  // Tenant-integrity: verify the menu item belongs to this restaurant.
  const [mi] = await db.select({ id: menuItemsTable.id }).from(menuItemsTable)
    .where(and(eq(menuItemsTable.id, Number(menuItemId)), eq(menuItemsTable.restaurantId, rid)));
  if (!mi) return void res.status(400).json({ error: "menu item not found in this restaurant" });
  if (lines && lines.length > 0) {
    const lineIds = Array.from(new Set(lines.map(l => Number(l.inventoryItemId))));
    const owned = await db.select({ id: inventoryItemsTable.id }).from(inventoryItemsTable)
      .where(and(inArray(inventoryItemsTable.id, lineIds), eq(inventoryItemsTable.restaurantId, rid)));
    if (owned.length !== lineIds.length) return void res.status(400).json({ error: "one or more inventory items not found in this restaurant" });
  }

  const [existing] = await db.select({ maxV: sql<number>`COALESCE(MAX(${recipeVersionsTable.versionNumber}), 0)` })
    .from(recipeVersionsTable)
    .where(and(eq(recipeVersionsTable.restaurantId, rid), eq(recipeVersionsTable.menuItemId, menuItemId)));
  const versionNumber = Number(existing?.maxV ?? 0) + 1;

  // Source lines: explicit body, else current ingredient mappings.
  let sourceLines = lines ?? [];
  if (sourceLines.length === 0) {
    const cur = await db.select({
      inventoryItemId: recipeMappingsTable.inventoryItemId,
      quantity: recipeMappingsTable.quantity,
      unit: recipeMappingsTable.unit,
    }).from(recipeMappingsTable)
      .where(and(eq(recipeMappingsTable.restaurantId, rid), eq(recipeMappingsTable.menuItemId, menuItemId), eq(recipeMappingsTable.kind, "ingredient")));
    sourceLines = cur.map(c => ({ inventoryItemId: c.inventoryItemId, quantity: c.quantity, unit: c.unit }));
  }

  let totalCost = 0;
  const linesWithCost: Array<{ inventoryItemId: number; quantity: string; unit: string; costAtSnapshot: string }> = [];
  if (sourceLines.length > 0) {
    const ids = Array.from(new Set(sourceLines.map(l => Number(l.inventoryItemId))));
    const items = await db.select({ id: inventoryItemsTable.id, costPerUnit: inventoryItemsTable.costPerUnit })
      .from(inventoryItemsTable).where(inArray(inventoryItemsTable.id, ids));
    const costMap = new Map(items.map(i => [i.id, Number(i.costPerUnit ?? 0)]));
    for (const l of sourceLines) {
      const qty = Number(l.quantity);
      const cost = costMap.get(Number(l.inventoryItemId)) ?? 0;
      totalCost += qty * cost;
      linesWithCost.push({
        inventoryItemId: Number(l.inventoryItemId),
        quantity: qty.toFixed(3),
        unit: l.unit ?? "kg",
        costAtSnapshot: cost.toFixed(2),
      });
    }
  }

  const userId = req.user?.sub ?? req.user?.id ?? null;
  const [created] = await db.insert(recipeVersionsTable).values({
    restaurantId: rid,
    menuItemId,
    versionNumber,
    status: "draft",
    totalCost: totalCost.toFixed(2),
    notes: notes ?? null,
    createdBy: userId,
  }).returning();

  if (linesWithCost.length > 0) {
    await db.insert(recipeVersionLinesTable).values(linesWithCost.map(l => ({ ...l, versionId: created!.id })));
  }
  await recordAuditLog({ req, module: "recipe_version", action: AUDIT_ACTIONS.CREATED, entity: NEW_AUDIT_ENTITIES.RECIPE_VERSION, entityId: created!.id, restaurantId: rid, newValue: created });
  res.status(201).json(created);
});

router.patch("/restaurants/:restaurantId/recipe-versions/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [before] = await db.select().from(recipeVersionsTable)
    .where(and(eq(recipeVersionsTable.id, id), eq(recipeVersionsTable.restaurantId, rid)));
  if (!before) return void res.status(404).json({ error: "Not found" });
  if (before.status !== "draft") return void res.status(409).json({ error: "Only draft versions can be edited" });

  const { notes, lines } = req.body as { notes?: string; lines?: Array<{ inventoryItemId: number; quantity: string | number; unit?: string }> };
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (notes !== undefined) updates.notes = notes;

  let totalCost = Number(before.totalCost);
  if (Array.isArray(lines)) {
    if (lines.length > 0) {
      // Tenant-integrity: every inventory item referenced must belong to this restaurant.
      const ids = Array.from(new Set(lines.map(l => Number(l.inventoryItemId))));
      const owned = await db.select({ id: inventoryItemsTable.id }).from(inventoryItemsTable)
        .where(and(inArray(inventoryItemsTable.id, ids), eq(inventoryItemsTable.restaurantId, rid)));
      if (owned.length !== ids.length) return void res.status(400).json({ error: "one or more inventory items not found in this restaurant" });
    }
    await db.delete(recipeVersionLinesTable).where(eq(recipeVersionLinesTable.versionId, id));
    if (lines.length > 0) {
      const ids = Array.from(new Set(lines.map(l => Number(l.inventoryItemId))));
      const items = await db.select({ id: inventoryItemsTable.id, costPerUnit: inventoryItemsTable.costPerUnit })
        .from(inventoryItemsTable).where(and(inArray(inventoryItemsTable.id, ids), eq(inventoryItemsTable.restaurantId, rid)));
      const costMap = new Map(items.map(i => [i.id, Number(i.costPerUnit ?? 0)]));
      totalCost = 0;
      const rows = lines.map(l => {
        const qty = Number(l.quantity);
        const cost = costMap.get(Number(l.inventoryItemId)) ?? 0;
        totalCost += qty * cost;
        return {
          versionId: id,
          inventoryItemId: Number(l.inventoryItemId),
          quantity: qty.toFixed(3),
          unit: l.unit ?? "kg",
          costAtSnapshot: cost.toFixed(2),
        };
      });
      await db.insert(recipeVersionLinesTable).values(rows);
    } else {
      totalCost = 0;
    }
    updates.totalCost = totalCost.toFixed(2);
  }

  const [updated] = await db.update(recipeVersionsTable).set(updates).where(eq(recipeVersionsTable.id, id)).returning();
  await recordAuditLog({ req, module: "recipe_version", action: AUDIT_ACTIONS.UPDATED, entity: NEW_AUDIT_ENTITIES.RECIPE_VERSION, entityId: id, restaurantId: rid, oldValue: before, newValue: updated });
  res.json(updated);
});

router.post("/restaurants/:restaurantId/recipe-versions/:id/submit", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [v] = await db.select().from(recipeVersionsTable).where(and(eq(recipeVersionsTable.id, id), eq(recipeVersionsTable.restaurantId, rid)));
  if (!v) return void res.status(404).json({ error: "Not found" });
  if (v.status !== "draft") return void res.status(409).json({ error: "Only drafts can be submitted" });
  const [u] = await db.update(recipeVersionsTable).set({ status: "pending_approval", updatedAt: new Date() })
    .where(eq(recipeVersionsTable.id, id)).returning();
  await recordAuditLog({ req, module: "recipe_version", action: "submitted", entity: NEW_AUDIT_ENTITIES.RECIPE_VERSION, entityId: id, restaurantId: rid });
  res.json(u);
});

router.post("/restaurants/:restaurantId/recipe-versions/:id/approve", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [v] = await db.select().from(recipeVersionsTable).where(and(eq(recipeVersionsTable.id, id), eq(recipeVersionsTable.restaurantId, rid)));
  if (!v) return void res.status(404).json({ error: "Not found" });
  if (v.status !== "pending_approval" && v.status !== "draft") return void res.status(409).json({ error: "Not in approvable state" });
  const userId = req.user?.sub ?? req.user?.id ?? null;
  const [u] = await db.update(recipeVersionsTable).set({
    status: "approved", approvedBy: userId, approvedAt: new Date(), updatedAt: new Date(),
  }).where(eq(recipeVersionsTable.id, id)).returning();
  await recordAuditLog({ req, module: "recipe_version", action: AUDIT_ACTIONS.APPROVED, entity: NEW_AUDIT_ENTITIES.RECIPE_VERSION, entityId: id, restaurantId: rid });
  res.json(u);
});

router.post("/restaurants/:restaurantId/recipe-versions/:id/reject", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { reason } = req.body as { reason?: string };
  const [u] = await db.update(recipeVersionsTable).set({
    status: "rejected", notes: reason ?? null, updatedAt: new Date(),
  }).where(and(eq(recipeVersionsTable.id, id), eq(recipeVersionsTable.restaurantId, rid))).returning();
  if (!u) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({ req, module: "recipe_version", action: AUDIT_ACTIONS.REJECTED, entity: NEW_AUDIT_ENTITIES.RECIPE_VERSION, entityId: id, restaurantId: rid, details: reason });
  res.json(u);
});

// Activate (rollout) — replaces the live ingredient recipe with this version's
// lines, archives the previously-active version, gated on an approved taste test
// when feature kq_taste_testing is enabled & a taste test exists for this item.
router.post("/restaurants/:restaurantId/recipe-versions/:id/activate", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [v] = await db.select().from(recipeVersionsTable).where(and(eq(recipeVersionsTable.id, id), eq(recipeVersionsTable.restaurantId, rid)));
  if (!v) return void res.status(404).json({ error: "Not found" });
  if (v.status !== "approved" && v.status !== "active") return void res.status(409).json({ error: "Version must be approved before activation" });

  // Strict taste-test gate: require ≥1 approved taste-test for THIS version
  // before activation can proceed. This guarantees QA sign-off on every rollout.
  const tt = await db.select({ status: tasteTestNotesTable.status, recipeVersionId: tasteTestNotesTable.recipeVersionId })
    .from(tasteTestNotesTable)
    .where(and(eq(tasteTestNotesTable.restaurantId, rid), eq(tasteTestNotesTable.menuItemId, v.menuItemId)));
  const okForThisVersion = tt.some(t => t.status === "approved" && t.recipeVersionId === id);
  if (!okForThisVersion) {
    return void res.status(409).json({
      error: "At least one approved taste test tied to this recipe version is required before activation.",
      hint: "Go to /kitchen/taste-testing, create a taste test linked to this version, and have a manager approve it.",
    });
  }

  const lines = await db.select().from(recipeVersionLinesTable).where(eq(recipeVersionLinesTable.versionId, id));

  // Recompute total cost at activation time using current inventory prices,
  // and refresh each line's costAtSnapshot. This ensures the live cost reflects
  // today's rates rather than the rates at draft creation time.
  let recomputedTotal = 0;
  const refreshedLines: Array<typeof lines[number] & { costAtSnapshot: string }> = [];
  if (lines.length > 0) {
    const ids = Array.from(new Set(lines.map(l => l.inventoryItemId)));
    const items = await db.select({ id: inventoryItemsTable.id, costPerUnit: inventoryItemsTable.costPerUnit })
      .from(inventoryItemsTable)
      .where(and(inArray(inventoryItemsTable.id, ids), eq(inventoryItemsTable.restaurantId, rid)));
    const costMap = new Map(items.map(i => [i.id, Number(i.costPerUnit ?? 0)]));
    for (const l of lines) {
      const cost = costMap.get(l.inventoryItemId) ?? 0;
      recomputedTotal += Number(l.quantity) * cost;
      refreshedLines.push({ ...l, costAtSnapshot: cost.toFixed(2) });
    }
  }

  await db.transaction(async (tx) => {
    // Archive any currently-active version for this menu item
    await tx.update(recipeVersionsTable).set({ isActive: false, status: "archived", archivedAt: new Date() })
      .where(and(eq(recipeVersionsTable.restaurantId, rid), eq(recipeVersionsTable.menuItemId, v.menuItemId), eq(recipeVersionsTable.isActive, true)));
    // Replace ingredient mappings (don't touch packaging/condiment kinds)
    await tx.delete(recipeMappingsTable).where(and(
      eq(recipeMappingsTable.restaurantId, rid),
      eq(recipeMappingsTable.menuItemId, v.menuItemId),
      eq(recipeMappingsTable.kind, "ingredient"),
    ));
    if (refreshedLines.length > 0) {
      await tx.insert(recipeMappingsTable).values(refreshedLines.map(l => ({
        restaurantId: rid,
        menuItemId: v.menuItemId,
        inventoryItemId: l.inventoryItemId,
        quantity: l.quantity,
        unit: l.unit,
        kind: "ingredient" as const,
      })));
      // Persist refreshed snapshot cost back onto the version lines.
      for (const l of refreshedLines) {
        await tx.update(recipeVersionLinesTable).set({ costAtSnapshot: l.costAtSnapshot })
          .where(eq(recipeVersionLinesTable.id, l.id));
      }
    }
    await tx.update(recipeVersionsTable).set({
      isActive: true, status: "active", activatedAt: new Date(), updatedAt: new Date(),
      totalCost: recomputedTotal.toFixed(2),
    }).where(eq(recipeVersionsTable.id, id));
  });

  await recordAuditLog({ req, module: "recipe_version", action: AUDIT_ACTIONS.PUBLISHED, entity: NEW_AUDIT_ENTITIES.RECIPE_VERSION, entityId: id, restaurantId: rid, details: `activated v${v.versionNumber}` });
  res.json({ ok: true });
});

// Rollback to a previously archived/approved version (just re-activate it).
router.post("/restaurants/:restaurantId/recipe-versions/:id/rollback", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [v] = await db.select().from(recipeVersionsTable).where(and(eq(recipeVersionsTable.id, id), eq(recipeVersionsTable.restaurantId, rid)));
  if (!v) return void res.status(404).json({ error: "Not found" });
  // Re-mark as approved then activate
  await db.update(recipeVersionsTable).set({ status: "approved", updatedAt: new Date() }).where(eq(recipeVersionsTable.id, id));
  // reuse activation path inline
  req.params.id = String(id);
  const lines = await db.select().from(recipeVersionLinesTable).where(eq(recipeVersionLinesTable.versionId, id));
  await db.transaction(async (tx) => {
    await tx.update(recipeVersionsTable).set({ isActive: false, status: "archived", archivedAt: new Date() })
      .where(and(eq(recipeVersionsTable.restaurantId, rid), eq(recipeVersionsTable.menuItemId, v.menuItemId), eq(recipeVersionsTable.isActive, true)));
    await tx.delete(recipeMappingsTable).where(and(
      eq(recipeMappingsTable.restaurantId, rid),
      eq(recipeMappingsTable.menuItemId, v.menuItemId),
      eq(recipeMappingsTable.kind, "ingredient"),
    ));
    if (lines.length > 0) {
      await tx.insert(recipeMappingsTable).values(lines.map(l => ({
        restaurantId: rid,
        menuItemId: v.menuItemId,
        inventoryItemId: l.inventoryItemId,
        quantity: l.quantity,
        unit: l.unit,
        kind: "ingredient" as const,
      })));
    }
    await tx.update(recipeVersionsTable).set({ isActive: true, status: "active", activatedAt: new Date(), updatedAt: new Date() })
      .where(eq(recipeVersionsTable.id, id));
  });
  await recordAuditLog({ req, module: "recipe_version", action: "rolled_back", entity: NEW_AUDIT_ENTITIES.RECIPE_VERSION, entityId: id, restaurantId: rid, details: `rolled back to v${v.versionNumber}` });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────
// TASTE TESTS
// ─────────────────────────────────────────────────────────────────

router.use("/restaurants/:restaurantId/taste-tests", requirePlanFeature("kq_taste_testing"));

router.get("/restaurants/:restaurantId/taste-tests", async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const { status, menuItemId, from, to } = req.query;
  const cond = [eq(tasteTestNotesTable.restaurantId, rid)];
  if (status) cond.push(eq(tasteTestNotesTable.status, String(status)));
  if (menuItemId) cond.push(eq(tasteTestNotesTable.menuItemId, Number(menuItemId)));
  if (from) cond.push(gte(tasteTestNotesTable.createdAt, new Date(String(from))));
  if (to) cond.push(lte(tasteTestNotesTable.createdAt, new Date(String(to))));
  const rows = await db.select({
    id: tasteTestNotesTable.id,
    menuItemId: tasteTestNotesTable.menuItemId,
    menuItemName: menuItemsTable.name,
    recipeVersionId: tasteTestNotesTable.recipeVersionId,
    tasterId: tasteTestNotesTable.tasterId,
    tasterName: tasteTestNotesTable.tasterName,
    rating: tasteTestNotesTable.rating,
    appearance: tasteTestNotesTable.appearance,
    aroma: tasteTestNotesTable.aroma,
    taste: tasteTestNotesTable.taste,
    texture: tasteTestNotesTable.texture,
    temperature: tasteTestNotesTable.temperature,
    notes: tasteTestNotesTable.notes,
    correctiveActions: tasteTestNotesTable.correctiveActions,
    status: tasteTestNotesTable.status,
    approvedBy: tasteTestNotesTable.approvedBy,
    approvedAt: tasteTestNotesTable.approvedAt,
    rejectedReason: tasteTestNotesTable.rejectedReason,
    createdAt: tasteTestNotesTable.createdAt,
  }).from(tasteTestNotesTable)
    .leftJoin(menuItemsTable, eq(tasteTestNotesTable.menuItemId, menuItemsTable.id))
    .where(and(...cond))
    .orderBy(desc(tasteTestNotesTable.createdAt))
    .limit(500);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/taste-tests", requireRole("owner", "manager", "kitchen", "super_admin"), async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const b = req.body as Record<string, unknown>;
  if (!b.menuItemId) return void res.status(400).json({ error: "menuItemId required" });
  // Tenant-integrity: menu item must belong to this restaurant.
  const [mi] = await db.select({ id: menuItemsTable.id }).from(menuItemsTable)
    .where(and(eq(menuItemsTable.id, Number(b.menuItemId)), eq(menuItemsTable.restaurantId, rid)));
  if (!mi) return void res.status(400).json({ error: "menu item not found in this restaurant" });
  // If a recipeVersionId is supplied it must belong to the same restaurant AND the same menu item.
  if (b.recipeVersionId != null) {
    const [rv] = await db.select({ id: recipeVersionsTable.id, menuItemId: recipeVersionsTable.menuItemId })
      .from(recipeVersionsTable)
      .where(and(eq(recipeVersionsTable.id, Number(b.recipeVersionId)), eq(recipeVersionsTable.restaurantId, rid)));
    if (!rv) return void res.status(400).json({ error: "recipe version not found in this restaurant" });
    if (rv.menuItemId !== Number(b.menuItemId)) return void res.status(400).json({ error: "recipe version does not belong to this menu item" });
  }
  const userId = req.user?.sub ?? req.user?.id ?? null;
  const [inserted] = await db.insert(tasteTestNotesTable).values({
    restaurantId: rid,
    menuItemId: Number(b.menuItemId),
    recipeVersionId: b.recipeVersionId != null ? Number(b.recipeVersionId) : null,
    tasterId: userId,
    tasterName: typeof b.tasterName === "string" ? b.tasterName : (req.user?.email ?? null),
    rating: b.rating != null ? Math.max(1, Math.min(5, Number(b.rating))) : 3,
    appearance: b.appearance != null ? Number(b.appearance) : null,
    aroma: b.aroma != null ? Number(b.aroma) : null,
    taste: b.taste != null ? Number(b.taste) : null,
    texture: b.texture != null ? Number(b.texture) : null,
    temperature: b.temperature != null ? Number(b.temperature) : null,
    notes: typeof b.notes === "string" ? b.notes : null,
    correctiveActions: typeof b.correctiveActions === "string" ? b.correctiveActions : null,
    status: "pending",
  }).returning();
  await recordAuditLog({ req, module: "taste_test", action: AUDIT_ACTIONS.CREATED, entity: NEW_AUDIT_ENTITIES.TASTE_TEST, entityId: inserted!.id, restaurantId: rid, newValue: inserted });
  res.status(201).json(inserted);
});

router.post("/restaurants/:restaurantId/taste-tests/:id/approve", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const userId = req.user?.sub ?? req.user?.id ?? null;
  const [u] = await db.update(tasteTestNotesTable).set({
    status: "approved", approvedBy: userId, approvedAt: new Date(), updatedAt: new Date(),
  }).where(and(eq(tasteTestNotesTable.id, id), eq(tasteTestNotesTable.restaurantId, rid))).returning();
  if (!u) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({ req, module: "taste_test", action: AUDIT_ACTIONS.APPROVED, entity: NEW_AUDIT_ENTITIES.TASTE_TEST, entityId: id, restaurantId: rid });
  res.json(u);
});

router.post("/restaurants/:restaurantId/taste-tests/:id/reject", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { reason } = req.body as { reason?: string };
  const [u] = await db.update(tasteTestNotesTable).set({
    status: "rejected", rejectedReason: reason ?? null, updatedAt: new Date(),
  }).where(and(eq(tasteTestNotesTable.id, id), eq(tasteTestNotesTable.restaurantId, rid))).returning();
  if (!u) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({ req, module: "taste_test", action: AUDIT_ACTIONS.REJECTED, entity: NEW_AUDIT_ENTITIES.TASTE_TEST, entityId: id, restaurantId: rid, details: reason });
  res.json(u);
});

router.delete("/restaurants/:restaurantId/taste-tests/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const rid = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  await db.delete(tasteTestNotesTable)
    .where(and(eq(tasteTestNotesTable.id, id), eq(tasteTestNotesTable.restaurantId, rid)));
  await recordAuditLog({ req, module: "taste_test", action: AUDIT_ACTIONS.DELETED, entity: NEW_AUDIT_ENTITIES.TASTE_TEST, entityId: id, restaurantId: rid });
  res.status(204).send();
});

export default router;
