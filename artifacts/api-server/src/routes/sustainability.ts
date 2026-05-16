import { Router } from "express";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import {
  db,
  sustainabilityFoodWasteTable,
  sustainabilityPackagingTable,
  sustainabilityDonationsTable,
  sustainabilityLocalVendorsTable,
  sustainabilityReusablePackagingTable,
  sustainabilityEnergyTable,
  sustainabilityWaterTable,
  sustainabilityCarbonTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import {
  computeSustainabilityScore,
  snapshotSustainabilityScore,
  getSustainabilityTrend,
  currentMonthKey,
  SUSTAINABILITY_FACTOR_LABELS,
  SUSTAINABILITY_WEIGHTS,
} from "../lib/sustainabilityScore";
import { logger } from "../lib/logger";

const router = Router();

router.use(
  "/restaurants/:restaurantId/sustainability",
  requireRole("owner", "manager", "staff", "cashier", "waiter", "kitchen", "super_admin"),
  validateRestaurantAccess,
);

const writers = requireRole("owner", "manager", "super_admin");

// ── Generic CRUD factory for category tables ────────────────────────
type AnyTable = typeof sustainabilityFoodWasteTable;
function mountCategory(
  pathSegment: string,
  table: AnyTable,
  allowedFields: string[],
) {
  const base = `/restaurants/:restaurantId/sustainability/${pathSegment}`;

  router.get(base, async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { from, to } = req.query as { from?: string; to?: string };
    const conds = [eq(table.restaurantId, restaurantId)];
    if (from) conds.push(gte(table.entryDate, from));
    if (to) conds.push(lte(table.entryDate, to));
    const rows = await db.select().from(table)
      .where(and(...conds))
      .orderBy(desc(table.entryDate), desc(table.id))
      .limit(500);
    res.json(rows);
  });

  router.post(base, writers, async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const values: Record<string, unknown> = { restaurantId };
    for (const f of allowedFields) {
      if (req.body?.[f] !== undefined) values[f] = req.body[f];
    }
    if (!values.entryDate) values.entryDate = new Date().toISOString().slice(0, 10);
    if (req.user?.sub) values.createdBy = req.user.sub;
    try {
      const [row] = await db.insert(table).values(values as never).returning();
      res.status(201).json(row);
    } catch (err) {
      logger.error({ err, pathSegment }, "[sustainability] insert failed");
      res.status(400).json({ error: "Invalid entry" });
    }
  });

  router.patch(`${base}/:id`, writers, async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const f of allowedFields) {
      if (req.body?.[f] !== undefined) updates[f] = req.body[f];
    }
    const [row] = await db.update(table).set(updates as never)
      .where(and(eq(table.id, id), eq(table.restaurantId, restaurantId)))
      .returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    res.json(row);
  });

  router.delete(`${base}/:id`, writers, async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    await db.delete(table).where(and(eq(table.id, id), eq(table.restaurantId, restaurantId)));
    res.status(204).send();
  });
}

mountCategory("food-waste", sustainabilityFoodWasteTable as AnyTable,
  ["entryDate", "quantity", "unit", "reason", "inventoryItemId", "menuItemId", "notes"]);
mountCategory("packaging", sustainabilityPackagingTable as unknown as AnyTable,
  ["entryDate", "type", "quantity", "unit", "notes"]);
mountCategory("donations", sustainabilityDonationsTable as unknown as AnyTable,
  ["entryDate", "recipient", "item", "quantity", "unit", "notes"]);
mountCategory("local-vendors", sustainabilityLocalVendorsTable as unknown as AnyTable,
  ["entryDate", "vendorName", "supplierId", "isLocal", "distanceKm", "spend", "notes"]);
mountCategory("reusable-packaging", sustainabilityReusablePackagingTable as unknown as AnyTable,
  ["entryDate", "item", "inCirculation", "returns", "losses", "notes"]);
mountCategory("energy", sustainabilityEnergyTable as unknown as AnyTable,
  ["entryDate", "kwh", "note"]);
mountCategory("water", sustainabilityWaterTable as unknown as AnyTable,
  ["entryDate", "liters", "note"]);
mountCategory("carbon", sustainabilityCarbonTable as unknown as AnyTable,
  ["entryDate", "estimatedKg", "manualOverrideKg", "note"]);

// ── Score / trend / report ──────────────────────────────────────────
router.get("/restaurants/:restaurantId/sustainability/score", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const monthKey = (req.query.month as string) || currentMonthKey();
  try {
    const result = await computeSustainabilityScore(restaurantId, monthKey);
    res.json({
      ...result,
      factorLabels: SUSTAINABILITY_FACTOR_LABELS,
    });
  } catch (err) {
    logger.error({ err, restaurantId }, "[sustainability] score failed");
    res.status(500).json({ error: "Failed to compute sustainability score" });
  }
});

router.post("/restaurants/:restaurantId/sustainability/score/snapshot", writers, async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const monthKey = (req.body?.month as string) || currentMonthKey();
  try {
    const result = await snapshotSustainabilityScore(restaurantId, monthKey);
    res.json({ ...result, factorLabels: SUSTAINABILITY_FACTOR_LABELS });
  } catch (err) {
    logger.error({ err, restaurantId }, "[sustainability] snapshot failed");
    res.status(500).json({ error: "Failed to snapshot sustainability score" });
  }
});

router.get("/restaurants/:restaurantId/sustainability/trend", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const months = Math.min(24, Math.max(3, Number(req.query.months) || 12));
  try {
    const data = await getSustainabilityTrend(restaurantId, months);
    res.json({
      months,
      data,
      factorLabels: SUSTAINABILITY_FACTOR_LABELS,
      weights: SUSTAINABILITY_WEIGHTS,
    });
  } catch (err) {
    logger.error({ err, restaurantId }, "[sustainability] trend failed");
    res.status(500).json({ error: "Failed to load trend" });
  }
});

router.get("/restaurants/:restaurantId/sustainability/report", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const from = (req.query.from as string) || "1970-01-01";
  const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
  const monthKey = (req.query.month as string) || currentMonthKey();

  try {
    const [score, foodWaste, packaging, donations, vendors, reusable, energy, water] = await Promise.all([
      computeSustainabilityScore(restaurantId, monthKey),
      db.select().from(sustainabilityFoodWasteTable).where(and(
        eq(sustainabilityFoodWasteTable.restaurantId, restaurantId),
        gte(sustainabilityFoodWasteTable.entryDate, from),
        lte(sustainabilityFoodWasteTable.entryDate, to),
      )),
      db.select().from(sustainabilityPackagingTable).where(and(
        eq(sustainabilityPackagingTable.restaurantId, restaurantId),
        gte(sustainabilityPackagingTable.entryDate, from),
        lte(sustainabilityPackagingTable.entryDate, to),
      )),
      db.select().from(sustainabilityDonationsTable).where(and(
        eq(sustainabilityDonationsTable.restaurantId, restaurantId),
        gte(sustainabilityDonationsTable.entryDate, from),
        lte(sustainabilityDonationsTable.entryDate, to),
      )),
      db.select().from(sustainabilityLocalVendorsTable).where(and(
        eq(sustainabilityLocalVendorsTable.restaurantId, restaurantId),
        gte(sustainabilityLocalVendorsTable.entryDate, from),
        lte(sustainabilityLocalVendorsTable.entryDate, to),
      )),
      db.select().from(sustainabilityReusablePackagingTable).where(and(
        eq(sustainabilityReusablePackagingTable.restaurantId, restaurantId),
        gte(sustainabilityReusablePackagingTable.entryDate, from),
        lte(sustainabilityReusablePackagingTable.entryDate, to),
      )),
      db.select().from(sustainabilityEnergyTable).where(and(
        eq(sustainabilityEnergyTable.restaurantId, restaurantId),
        gte(sustainabilityEnergyTable.entryDate, from),
        lte(sustainabilityEnergyTable.entryDate, to),
      )),
      db.select().from(sustainabilityWaterTable).where(and(
        eq(sustainabilityWaterTable.restaurantId, restaurantId),
        gte(sustainabilityWaterTable.entryDate, from),
        lte(sustainabilityWaterTable.entryDate, to),
      )),
    ]);

    res.json({
      from, to, monthKey,
      score: { ...score, factorLabels: SUSTAINABILITY_FACTOR_LABELS },
      entries: { foodWaste, packaging, donations, vendors, reusable, energy, water },
    });
  } catch (err) {
    logger.error({ err, restaurantId }, "[sustainability] report failed");
    res.status(500).json({ error: "Failed to build report" });
  }
});

export default router;
