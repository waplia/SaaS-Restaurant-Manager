/**
 * Khana AI — Inventory Assistant, Demand Forecasting, Recipe Cost Optimizer.
 *
 * Each generator route follows the standard reserve → generate → commit/refund
 * pattern, gated by:
 *   - requireRole("owner","manager","super_admin")
 *   - validateRestaurantAccess
 *   - requirePlanFeature("khana_ai_enabled")
 *   - requireAiCredits(<feature_slug>)
 *
 * Suggestions/forecasts/snapshots are persisted (save / dismiss) and audit
 * logged. Owners can promote a suggestion into a draft Purchase Order which
 * deep-links into the existing Inventory PO module.
 */
import { Router, type Request, type Response } from "express";
import { eq, and, desc, gte, lte, sql, inArray } from "drizzle-orm";
import crypto from "crypto";
import {
  db,
  inventoryItemsTable,
  suppliersTable,
  recipeMappingsTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  ordersTable,
  orderItemsTable,
  menuItemsTable,
  menuCategoriesTable,
  staffShiftsTable,
  aiInventorySuggestionsTable,
  aiForecastsTable,
  aiRecipeCostSnapshotsTable,
  staffTable,
  attendanceTable,
  orderDiscountsTable,
  customerFeedbackTable,
  payrollItemsTable,
  usersTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { AIProviderService } from "../lib/aiProviderService";
import {
  requireAiCredits,
  commitReservation,
  refundReservation,
  type AiCreditReservation,
} from "../lib/aiCredits";
import { recordAuditLog } from "../lib/audit";
import {
  runDemandForecast,
  computeForecastActuals,
  tomorrowDateInTz,
  ForecastError,
  type ForecastPayload as DemandForecastPayload,
} from "../lib/demandForecast";
import { restaurantsTable } from "../lib/db";

const router = Router();

// All routes here are tenant-scoped under /restaurants/:restaurantId/ai-ops/...
router.use(
  "/restaurants/:restaurantId/ai-ops/:rest",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("khana_ai_enabled"),
);
// Recipe optimizer is per-item under /restaurants/:rid/items/:itemId/ai-recipe-...
router.use(
  "/restaurants/:restaurantId/items/:itemId/ai-recipe-:rest",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("khana_ai_enabled"),
);

function hashInputs(obj: unknown): string {
  return crypto.createHash("sha1").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
}

// ────────────────────────── Inventory Assistant ──────────────────────────

type InventoryRiskType = "low_stock" | "overstock" | "wastage" | "expiring";

interface InventorySuggestionItem {
  inventoryItemId: number | null;
  name: string;
  unit: string;
  currentStock: number;
  minStockLevel: number;
  parLevel: number | null;
  suggestedQuantity: number;
  suggestedSupplierId: number | null;
  suggestedSupplierName: string | null;
  estCostPerUnit: number;
  estLineCost: number;
  reason: string;
  urgency: "low" | "medium" | "high";
  riskType: InventoryRiskType;
}

interface InventorySuggestionPayload {
  summary: string;
  items: InventorySuggestionItem[];
  totalEstimatedCost: number;
  windowDays: number;
}

router.post(
  "/restaurants/:restaurantId/ai-ops/inventory/suggest",
  requireAiCredits("ai_inventory_assistant", () => ({ units: 1 })),
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const reservation = res.locals.aiCreditReservation as AiCreditReservation | null;

    try {
      const since = new Date(Date.now() - 30 * 86_400_000);

      const [items, suppliers, usage] = await Promise.all([
        db.select().from(inventoryItemsTable).where(and(
          eq(inventoryItemsTable.restaurantId, restaurantId),
          eq(inventoryItemsTable.isActive, true),
        )),
        db.select().from(suppliersTable).where(and(
          eq(suppliersTable.restaurantId, restaurantId),
          eq(suppliersTable.isActive, true),
        )),
        db
          .select({
            inventoryItemId: recipeMappingsTable.inventoryItemId,
            qty: sql<string>`coalesce(sum(${recipeMappingsTable.quantity} * ${orderItemsTable.quantity}), 0)`,
          })
          .from(orderItemsTable)
          .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
          .innerJoin(recipeMappingsTable, and(
            eq(recipeMappingsTable.menuItemId, orderItemsTable.menuItemId),
            eq(recipeMappingsTable.restaurantId, restaurantId),
          ))
          .where(and(
            eq(ordersTable.restaurantId, restaurantId),
            gte(ordersTable.createdAt, since),
            inArray(ordersTable.status, ["completed", "served", "delivered", "ready"]),
          ))
          .groupBy(recipeMappingsTable.inventoryItemId),
      ]);

      const usageById = new Map(usage.map((u) => [u.inventoryItemId, Number(u.qty) || 0]));
      const inputs = items.map((it) => {
        const used30 = usageById.get(it.id) ?? 0;
        return {
          id: it.id,
          name: it.name,
          unit: it.unit,
          currentStock: Number(it.currentStock),
          minStockLevel: Number(it.minStockLevel),
          parLevel: it.parLevel != null ? Number(it.parLevel) : null,
          reorderQuantity: it.reorderQuantity != null ? Number(it.reorderQuantity) : null,
          costPerUnit: Number(it.costPerUnit),
          category: it.category,
          supplierId: it.supplierId,
          dailyUsage30d: Number((used30 / 30).toFixed(3)),
        };
      });

      const supplierLines = suppliers.map((s) => `  - id=${s.id} name="${s.name}"`).join("\n") || "  (no suppliers)";
      // Pre-classify so the model focuses on the right action per item.
      const candidates = inputs.map((i) => {
        const daysOfStock = i.dailyUsage30d > 0 ? i.currentStock / i.dailyUsage30d : Infinity;
        const isLow = i.currentStock <= i.minStockLevel || daysOfStock < 7;
        const par = i.parLevel ?? Math.max(i.minStockLevel * 2, i.dailyUsage30d * 14);
        const isOverstock = par > 0 && i.currentStock > par * 1.5 && daysOfStock > 30;
        const isWastage = i.dailyUsage30d === 0 && i.currentStock > i.minStockLevel * 2 && i.currentStock > 0;
        const flag = isLow ? "LOW" : isOverstock ? "OVERSTOCK" : isWastage ? "WASTAGE" : "OK";
        return { ...i, daysOfStock: Number.isFinite(daysOfStock) ? Number(daysOfStock.toFixed(1)) : null, flag };
      });
      const flagged = candidates.filter((c) => c.flag !== "OK").slice(0, 40);
      const itemLines = flagged.map((i) =>
        `  - id=${i.id} flag=${i.flag} name="${i.name}" unit=${i.unit} stock=${i.currentStock} min=${i.minStockLevel} par=${i.parLevel ?? "null"} reorderQty=${i.reorderQuantity ?? "null"} cost=${i.costPerUnit} cat=${i.category} supplier=${i.supplierId ?? "null"} dailyUsage30d=${i.dailyUsage30d} daysOfStock=${i.daysOfStock ?? "∞"}`,
      ).join("\n") || "  (no items needing attention)";

      const prompt = `You are a restaurant inventory analyst. Surface ingredients that need attention: low stock, overstock, expiry/wastage risk.

Suppliers:
${supplierLines}

Items needing attention (already pre-flagged LOW / OVERSTOCK / WASTAGE):
${itemLines}

Return ONLY a JSON object:
{
  "summary": "1-2 sentence overall situation summary",
  "items": [
    {
      "inventoryItemId": <id>,
      "name": "<item name>",
      "unit": "<unit>",
      "riskType": "low_stock" | "overstock" | "wastage" | "expiring",
      "suggestedQuantity": <number — for low_stock: reorder qty in the item's unit; for overstock/wastage: 0>,
      "suggestedSupplierId": <id or null>,
      "estCostPerUnit": <number>,
      "reason": "<short why incl. recommended action: reorder, hold, run-as-special, donate, etc.>",
      "urgency": "low" | "medium" | "high"
    }
  ]
}

Rules:
- For LOW items: suggestedQuantity should bring stock to par (or to ~14 days of usage if no par); urgency "high" if stock < minStockLevel today.
- For OVERSTOCK / WASTAGE items: set suggestedQuantity=0, suggest using up via combos / specials, urgency "low" or "medium".
- Prefer existing supplierId; otherwise pick a plausible supplier (or null).
- Cap at 25 items.
- JSON only, no markdown.`;

      const inputsHash = hashInputs({ items: inputs.map((i) => ({ id: i.id, s: i.currentStock, u: i.dailyUsage30d })) });

      const { data, result } = await AIProviderService.generateJson<{
        summary?: unknown; items?: unknown;
      }>({
        featureSlug: "ai_inventory_assistant",
        tenantId: req.user?.tenantId ?? null,
        restaurantId,
        userId: req.user?.sub ?? null,
        metadata: { inputsHash, itemCount: items.length },
      }, {
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        maxTokens: 2500,
      });

      const itemById = new Map(items.map((i) => [i.id, i]));
      const supplierById = new Map(suppliers.map((s) => [s.id, s]));
      const rawItems = Array.isArray(data.items) ? data.items : [];
      const cleanedItems: InventorySuggestionItem[] = rawItems
        .map((raw: unknown): InventorySuggestionItem | null => {
          const r = raw as Record<string, unknown>;
          const invId = typeof r.inventoryItemId === "number" ? r.inventoryItemId : null;
          const inv = invId != null ? itemById.get(invId) : null;
          if (!inv) return null;
          const qty = Math.max(0, Number(r.suggestedQuantity) || 0);
          const rt = String(r.riskType ?? "low_stock").toLowerCase();
          const riskType: InventoryRiskType =
            rt === "overstock" || rt === "wastage" || rt === "expiring" ? rt : "low_stock";
          // Skip empty low_stock rows; keep zero-qty overstock/wastage rows so owner sees the risk.
          if (qty <= 0 && riskType === "low_stock") return null;
          const cost = Number(r.estCostPerUnit) || Number(inv.costPerUnit) || 0;
          const supplierId = typeof r.suggestedSupplierId === "number"
            ? r.suggestedSupplierId
            : (inv.supplierId ?? null);
          const sup = supplierId != null ? supplierById.get(supplierId) ?? null : null;
          const urg = String(r.urgency ?? "medium").toLowerCase();
          const urgency: "low" | "medium" | "high" = urg === "low" || urg === "high" ? urg : "medium";
          return {
            inventoryItemId: inv.id,
            name: inv.name,
            unit: inv.unit,
            currentStock: Number(inv.currentStock),
            minStockLevel: Number(inv.minStockLevel),
            parLevel: inv.parLevel != null ? Number(inv.parLevel) : null,
            suggestedQuantity: qty,
            suggestedSupplierId: sup?.id ?? null,
            suggestedSupplierName: sup?.name ?? null,
            estCostPerUnit: cost,
            estLineCost: Number((qty * cost).toFixed(2)),
            reason: String(r.reason ?? "").slice(0, 240),
            urgency,
            riskType,
          };
        })
        .filter((x): x is InventorySuggestionItem => x !== null)
        .slice(0, 25);

      const totalEstimatedCost = Number(cleanedItems.reduce((s, i) => s + i.estLineCost, 0).toFixed(2));
      const payload: InventorySuggestionPayload = {
        summary: typeof data.summary === "string" ? data.summary.trim().slice(0, 500) : "",
        items: cleanedItems,
        totalEstimatedCost,
        windowDays: 30,
      };

      const [row] = await db.insert(aiInventorySuggestionsTable).values({
        restaurantId,
        inputsHash,
        payload: payload as unknown,
        confidence: cleanedItems.length > 0 ? "0.75" : "0.20",
        status: "active",
        requestLogId: result.requestLogId,
        generatedBy: req.user?.sub ?? null,
      }).returning();

      if (reservation) {
        await commitReservation({ reservation, userId: req.user?.sub ?? null, requestLogId: result.requestLogId });
      }
      await recordAuditLog({
        req, module: "khana_ai", action: "inventory.suggest",
        entity: "ai_inventory_suggestion", entityId: row.id,
        newValue: { itemCount: cleanedItems.length, totalEstimatedCost, requestLogId: result.requestLogId },
      });
      res.json({ suggestion: row });
    } catch (err) {
      if (reservation) await refundReservation(reservation, (err as Error).message ?? "provider error");
      req.log.error({ err }, "AI inventory suggest failed");
      await recordAuditLog({
        req, module: "khana_ai", action: "inventory.suggest_failed",
        entity: "ai_inventory_suggestion",
        newValue: { error: (err as Error).message ?? "provider error" },
      });
      res.status(502).json({ error: "Failed to generate inventory suggestions" });
    }
  },
);

router.get("/restaurants/:restaurantId/ai-ops/inventory/suggestions", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const status = String(req.query.status ?? "active");
  const rows = await db.select().from(aiInventorySuggestionsTable).where(and(
    eq(aiInventorySuggestionsTable.restaurantId, restaurantId),
    eq(aiInventorySuggestionsTable.status, status),
  )).orderBy(desc(aiInventorySuggestionsTable.generatedAt)).limit(25);
  res.json({ data: rows });
});

router.patch("/restaurants/:restaurantId/ai-ops/inventory/suggestions/:id", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { status, notes } = (req.body ?? {}) as { status?: string; notes?: string };
  const allowed = new Set(["active", "saved", "dismissed"]);
  if (status && !allowed.has(status)) {
    return void res.status(400).json({ error: "Invalid status" });
  }
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (status) update.status = status;
  if (notes != null) update.notes = String(notes).slice(0, 1000);
  const [row] = await db.update(aiInventorySuggestionsTable).set(update)
    .where(and(eq(aiInventorySuggestionsTable.id, id), eq(aiInventorySuggestionsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({
    req, module: "khana_ai", action: `inventory.suggestion.${status ?? "update"}`,
    entity: "ai_inventory_suggestion", entityId: row.id, newValue: { status, notes },
  });
  res.json({ suggestion: row });
});

router.post("/restaurants/:restaurantId/ai-ops/inventory/suggestions/:id/draft-po", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const body = (req.body ?? {}) as { selectedInventoryItemIds?: unknown };
  const selected = Array.isArray(body.selectedInventoryItemIds)
    ? body.selectedInventoryItemIds.map((x) => Number(x)).filter((x) => Number.isFinite(x))
    : null;

  const [sug] = await db.select().from(aiInventorySuggestionsTable).where(and(
    eq(aiInventorySuggestionsTable.id, id),
    eq(aiInventorySuggestionsTable.restaurantId, restaurantId),
  ));
  if (!sug) return void res.status(404).json({ error: "Suggestion not found" });
  const payload = sug.payload as unknown as InventorySuggestionPayload;
  let items = Array.isArray(payload?.items) ? payload.items : [];
  // Reorderable items only — exclude overstock/wastage entries which carry qty=0.
  items = items.filter((i) => i.suggestedQuantity > 0 && i.riskType !== "overstock" && i.riskType !== "wastage");
  if (selected && selected.length > 0) {
    const sel = new Set(selected);
    items = items.filter((i) => i.inventoryItemId != null && sel.has(i.inventoryItemId));
  }
  if (items.length === 0) return void res.status(400).json({ error: "No reorderable items selected" });

  const supplierIds = Array.from(new Set(items.map((i) => i.suggestedSupplierId).filter((x): x is number => x != null)));
  const primarySupplierId = supplierIds.length === 1 ? supplierIds[0] : null;
  const total = items.reduce((s, i) => s + i.estLineCost, 0);

  const [po] = await db.insert(purchaseOrdersTable).values({
    restaurantId,
    supplierId: primarySupplierId,
    status: "pending",
    totalAmount: String(total.toFixed(2)),
    isAutoDrafted: true,
    draftedAt: new Date(),
    notes: `Drafted by Khana AI Inventory Assistant (suggestion #${sug.id})`,
  }).returning();

  if (items.length > 0) {
    await db.insert(purchaseOrderItemsTable).values(items.map((i) => ({
      purchaseOrderId: po.id,
      inventoryItemId: i.inventoryItemId,
      name: i.name,
      unit: i.unit,
      quantity: String(i.suggestedQuantity),
      costPerUnit: String(i.estCostPerUnit.toFixed(2)),
    })));
  }

  await db.update(aiInventorySuggestionsTable).set({
    status: "saved",
    purchaseOrderId: po.id,
    updatedAt: new Date(),
  }).where(eq(aiInventorySuggestionsTable.id, sug.id));

  await recordAuditLog({
    req, module: "khana_ai", action: "po.draft_from_suggestion",
    entity: "purchase_order", entityId: po.id,
    newValue: { suggestionId: sug.id, itemCount: items.length, total },
  });
  res.json({ purchaseOrder: po, suggestionId: sug.id });
});

// ────────────────────────── Demand Forecasting ──────────────────────────
//
// The heavy lifting (data gathering + LLM call + payload normalization +
// persist) lives in `lib/demandForecast.ts` so it can be reused by the
// nightly auto-run scheduler. The route below just handles HTTP concerns
// (credit middleware, error mapping, audit log).

router.post(
  "/restaurants/:restaurantId/ai-ops/forecast/run",
  requireAiCredits("ai_demand_forecast", () => ({ units: 1 })),
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const reservation = res.locals.aiCreditReservation as AiCreditReservation | null;
    const horizonDays = Math.max(1, Math.min(30, Number((req.body ?? {}).horizonDays) || 7));
    const tenantId = req.user?.tenantId ?? null;
    if (!tenantId) {
      if (reservation) await refundReservation(reservation, "no tenant");
      return void res.status(403).json({ error: "AI requires a tenant context" });
    }

    try {
      // Look up restaurant tz so the persisted forecastDate (when 1-day) is
      // anchored in restaurant-local time rather than the server's clock.
      let forecastDate: string | undefined;
      if (horizonDays === 1) {
        const [r] = await db.select({ tz: restaurantsTable.timezone })
          .from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
        forecastDate = tomorrowDateInTz(r?.tz || "Asia/Kolkata");
      }

      const out = await runDemandForecast({
        restaurantId,
        tenantId,
        userId: req.user?.sub ?? null,
        horizonDays,
        forecastDate,
        reservation,
        source: "manual",
      });
      await recordAuditLog({
        req, module: "khana_ai", action: "forecast.run",
        entity: "ai_forecast", entityId: out.forecastId,
        newValue: {
          horizonDays,
          itemCount: out.payload.items.length,
          estimatedRevenue: out.payload.estimatedRevenue,
        },
      });
      return void res.json({ forecast: out.row });
    } catch (err) {
      if (reservation) await refundReservation(reservation, (err as Error).message ?? "provider error");
      if (err instanceof ForecastError) {
        await recordAuditLog({
          req, module: "khana_ai", action: "forecast.run_failed",
          entity: "ai_forecast", newValue: { error: err.message, code: err.code },
        });
        return void res.status(err.status).json({ error: err.message, code: err.code });
      }
      req.log.error({ err }, "AI demand forecast failed");
      await recordAuditLog({
        req, module: "khana_ai", action: "forecast.run_failed",
        entity: "ai_forecast", newValue: { error: (err as Error).message ?? "provider error" },
      });
      return void res.status(502).json({ error: "Failed to generate demand forecast" });
    }
  },
);

// Tomorrow hero: returns the most recent active 1-day forecast (manual or
// nightly). The frontend uses this to render the "Tomorrow's outlook" card
// without forcing a fresh run.
router.get("/restaurants/:restaurantId/ai-ops/forecast/tomorrow", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const [row] = await db.select().from(aiForecastsTable).where(and(
    eq(aiForecastsTable.restaurantId, restaurantId),
    eq(aiForecastsTable.horizonDays, 1),
    eq(aiForecastsTable.status, "active"),
  )).orderBy(desc(aiForecastsTable.generatedAt)).limit(1);
  res.json({ forecast: row ?? null });
});

// Forecast vs actuals recap: finds the most recent 1-day forecast whose
// forecasted day has fully completed (in the restaurant's timezone) and
// returns predicted-vs-actual aggregations. No LLM call.
router.get("/restaurants/:restaurantId/ai-ops/forecast/recap", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const [restaurant] = await db.select({ tz: restaurantsTable.timezone })
    .from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  const tz = restaurant?.tz || "Asia/Kolkata";

  const candidates = await db.select().from(aiForecastsTable).where(and(
    eq(aiForecastsTable.restaurantId, restaurantId),
    eq(aiForecastsTable.horizonDays, 1),
  )).orderBy(desc(aiForecastsTable.generatedAt)).limit(10);

  for (const row of candidates) {
    try {
      const recap = await computeForecastActuals(row, tz);
      if (recap) return void res.json({ recap });
    } catch (err) {
      req.log.warn({ err, forecastId: row.id }, "forecast recap compute failed");
    }
  }
  res.json({ recap: null });
});


router.get("/restaurants/:restaurantId/ai-ops/forecast/list", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const status = String(req.query.status ?? "active");
  const rows = await db.select().from(aiForecastsTable).where(and(
    eq(aiForecastsTable.restaurantId, restaurantId),
    eq(aiForecastsTable.status, status),
  )).orderBy(desc(aiForecastsTable.generatedAt)).limit(25);
  res.json({ data: rows });
});

router.patch("/restaurants/:restaurantId/ai-ops/forecast/:id", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { status, notes } = (req.body ?? {}) as { status?: string; notes?: string };
  const allowed = new Set(["active", "saved", "dismissed"]);
  if (status && !allowed.has(status)) return void res.status(400).json({ error: "Invalid status" });
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (status) update.status = status;
  if (notes != null) update.notes = String(notes).slice(0, 1000);
  const [row] = await db.update(aiForecastsTable).set(update)
    .where(and(eq(aiForecastsTable.id, id), eq(aiForecastsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({
    req, module: "khana_ai", action: `forecast.${status ?? "update"}`,
    entity: "ai_forecast", entityId: row.id, newValue: { status, notes },
  });
  res.json({ forecast: row });
});

// ────────────────────────── Recipe Cost Optimizer ──────────────────────────

interface RecipeSubstitution {
  inventoryItemId: number;
  name: string;
  suggestedReplacement: string;
  estSavingPerUnit: number;
  rationale: string;
}

interface RecipeOptimizerPayload {
  summary: string;
  currentCogs: number;
  currentPrice: number;
  currentMargin: number;
  suggestedPrice: number | null;
  suggestedPortionChange: string | null;
  substitutions: RecipeSubstitution[];
  riskNote: string | null;
}

router.post(
  "/restaurants/:restaurantId/items/:itemId/ai-recipe-optimize",
  requireAiCredits("ai_recipe_optimizer", () => ({ units: 1 })),
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const itemId = Number(req.params.itemId);
    const reservation = res.locals.aiCreditReservation as AiCreditReservation | null;

    try {
      const [item] = await db.select({
        id: menuItemsTable.id, name: menuItemsTable.name, price: menuItemsTable.price,
        categoryName: menuCategoriesTable.name,
      })
        .from(menuItemsTable)
        .leftJoin(menuCategoriesTable, eq(menuItemsTable.categoryId, menuCategoriesTable.id))
        .where(and(eq(menuItemsTable.id, itemId), eq(menuItemsTable.restaurantId, restaurantId)));
      if (!item) {
        if (reservation) await refundReservation(reservation, "item not found");
        return void res.status(404).json({ error: "Menu item not found" });
      }

      const recipe = await db.select({
        id: recipeMappingsTable.id,
        inventoryItemId: recipeMappingsTable.inventoryItemId,
        quantity: recipeMappingsTable.quantity,
        unit: recipeMappingsTable.unit,
        ingredientName: inventoryItemsTable.name,
        costPerUnit: inventoryItemsTable.costPerUnit,
        ingredientUnit: inventoryItemsTable.unit,
      })
        .from(recipeMappingsTable)
        .innerJoin(inventoryItemsTable, eq(inventoryItemsTable.id, recipeMappingsTable.inventoryItemId))
        .where(and(
          eq(recipeMappingsTable.menuItemId, itemId),
          eq(recipeMappingsTable.restaurantId, restaurantId),
        ));

      if (recipe.length === 0) {
        if (reservation) await refundReservation(reservation, "no recipe");
        return void res.status(400).json({ error: "Add ingredients to the recipe first." });
      }

      const currentCogs = recipe.reduce((s, r) => s + Number(r.quantity) * Number(r.costPerUnit), 0);
      const currentPrice = Number(item.price);
      const currentMargin = currentPrice > 0 ? ((currentPrice - currentCogs) / currentPrice) * 100 : 0;

      const competitorPriceRaw = Number((req.body ?? {}).competitorPrice);
      const competitorPrice = Number.isFinite(competitorPriceRaw) && competitorPriceRaw > 0
        ? Number(competitorPriceRaw.toFixed(2)) : null;

      const recipeLines = recipe.map((r) =>
        `  - id=${r.inventoryItemId} name="${r.ingredientName}" qty=${r.quantity}${r.unit} cost=${r.costPerUnit}/${r.ingredientUnit} lineCost=${(Number(r.quantity) * Number(r.costPerUnit)).toFixed(2)}`,
      ).join("\n");

      const prompt = `You are a restaurant menu engineer. Analyse this recipe and suggest cost-saving moves.

Dish: "${item.name}" (${item.categoryName ?? "Uncategorised"})
Current selling price: ₹${currentPrice.toFixed(2)}
Current COGS: ₹${currentCogs.toFixed(2)}
Current margin: ${currentMargin.toFixed(1)}%${competitorPrice != null ? `\nCompetitor price benchmark: ₹${competitorPrice.toFixed(2)} (factor this in when suggesting price changes — do not suggest a price meaningfully above this unless quality justifies it)` : ""}

Recipe ingredients:
${recipeLines}

Return ONLY JSON:
{
  "summary": "1-2 sentence assessment of margin and biggest lever",
  "suggestedPrice": <number or null — only suggest a new price if margin is below 60% AND a small bump (≤10%) is realistic>,
  "suggestedPortionChange": "<short suggestion or null>",
  "substitutions": [
    {
      "inventoryItemId": <id from recipe>,
      "suggestedReplacement": "<ingredient name to swap to>",
      "estSavingPerUnit": <rupees saved per unit of the original ingredient>,
      "rationale": "<short why>"
    }
  ],
  "riskNote": "<short note about risks/quality impact, or null>"
}

Rules:
- Do NOT suggest substitutions that materially change the dish identity.
- estSavingPerUnit must be positive.
- Cap substitutions at 4. JSON only, no prose.`;

      const inputsHash = hashInputs({
        itemId,
        price: currentPrice,
        cogs: currentCogs,
        recipe: recipe.map((r) => ({ id: r.inventoryItemId, q: Number(r.quantity), c: Number(r.costPerUnit) })),
      });

      const { data, result } = await AIProviderService.generateJson<{
        summary?: unknown; suggestedPrice?: unknown; suggestedPortionChange?: unknown;
        substitutions?: unknown; riskNote?: unknown;
      }>({
        featureSlug: "ai_recipe_optimizer",
        tenantId: req.user?.tenantId ?? null,
        restaurantId,
        userId: req.user?.sub ?? null,
        metadata: { itemId, inputsHash },
      }, {
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        maxTokens: 1200,
      });

      const recipeIds = new Set(recipe.map((r) => r.inventoryItemId));
      const recipeById = new Map(recipe.map((r) => [r.inventoryItemId, r]));
      const rawSubs = Array.isArray(data.substitutions) ? data.substitutions : [];
      const substitutions: RecipeSubstitution[] = rawSubs
        .map((raw: unknown): RecipeSubstitution | null => {
          const r = raw as Record<string, unknown>;
          const id = Number(r.inventoryItemId);
          if (!recipeIds.has(id)) return null;
          const saving = Number(r.estSavingPerUnit) || 0;
          if (saving <= 0) return null;
          const orig = recipeById.get(id)!;
          return {
            inventoryItemId: id,
            name: orig.ingredientName,
            suggestedReplacement: String(r.suggestedReplacement ?? "").slice(0, 120),
            estSavingPerUnit: Number(saving.toFixed(2)),
            rationale: String(r.rationale ?? "").slice(0, 240),
          };
        })
        .filter((x): x is RecipeSubstitution => x !== null)
        .slice(0, 4);

      let suggestedPrice: number | null = null;
      if (typeof data.suggestedPrice === "number" && data.suggestedPrice > 0) {
        const cap = competitorPrice != null
          ? Math.min(currentPrice * 1.1, competitorPrice * 1.05)
          : currentPrice * 1.1;
        suggestedPrice = Number(Math.min(data.suggestedPrice, cap).toFixed(2));
      }

      const payload: RecipeOptimizerPayload = {
        summary: typeof data.summary === "string" ? data.summary.trim().slice(0, 500) : "",
        currentCogs: Number(currentCogs.toFixed(2)),
        currentPrice: Number(currentPrice.toFixed(2)),
        currentMargin: Number(currentMargin.toFixed(1)),
        suggestedPrice,
        suggestedPortionChange: typeof data.suggestedPortionChange === "string"
          ? data.suggestedPortionChange.trim().slice(0, 240) || null : null,
        substitutions,
        riskNote: typeof data.riskNote === "string" ? data.riskNote.trim().slice(0, 300) || null : null,
      };

      const conf = substitutions.length > 0 || suggestedPrice ? "0.7" : "0.4";

      const [row] = await db.insert(aiRecipeCostSnapshotsTable).values({
        restaurantId,
        menuItemId: itemId,
        inputsHash,
        currentCogs: currentCogs.toFixed(2),
        currentPrice: currentPrice.toFixed(2),
        suggestedPrice: suggestedPrice != null ? suggestedPrice.toFixed(2) : null,
        payload: payload as unknown,
        confidence: conf,
        status: "active",
        requestLogId: result.requestLogId,
        generatedBy: req.user?.sub ?? null,
      }).returning();

      if (reservation) {
        await commitReservation({ reservation, userId: req.user?.sub ?? null, requestLogId: result.requestLogId });
      }
      await recordAuditLog({
        req, module: "khana_ai", action: "recipe.optimize",
        entity: "menu_item", entityId: itemId,
        newValue: { snapshotId: row.id, currentCogs, suggestedPrice, substitutionCount: substitutions.length, requestLogId: result.requestLogId },
      });
      res.json({ snapshot: row });
    } catch (err) {
      if (reservation) await refundReservation(reservation, (err as Error).message ?? "provider error");
      req.log.error({ err }, "AI recipe optimizer failed");
      await recordAuditLog({
        req, module: "khana_ai", action: "recipe.optimize_failed",
        entity: "menu_item", entityId: itemId,
        newValue: { error: (err as Error).message ?? "provider error" },
      });
      res.status(502).json({ error: "Failed to optimize recipe" });
    }
  },
);

router.get("/restaurants/:restaurantId/items/:itemId/ai-recipe-snapshots", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const itemId = Number(req.params.itemId);
  const rows = await db.select().from(aiRecipeCostSnapshotsTable).where(and(
    eq(aiRecipeCostSnapshotsTable.restaurantId, restaurantId),
    eq(aiRecipeCostSnapshotsTable.menuItemId, itemId),
  )).orderBy(desc(aiRecipeCostSnapshotsTable.generatedAt)).limit(5);
  res.json({ data: rows });
});

router.patch("/restaurants/:restaurantId/items/:itemId/ai-recipe-snapshots/:id", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const itemId = Number(req.params.itemId);
  const id = Number(req.params.id);
  const { status, notes } = (req.body ?? {}) as { status?: string; notes?: string };
  const allowed = new Set(["active", "saved", "dismissed", "applied"]);
  if (status && !allowed.has(status)) return void res.status(400).json({ error: "Invalid status" });
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (status) update.status = status;
  if (notes != null) update.notes = String(notes).slice(0, 1000);
  const [row] = await db.update(aiRecipeCostSnapshotsTable).set(update)
    .where(and(
      eq(aiRecipeCostSnapshotsTable.id, id),
      eq(aiRecipeCostSnapshotsTable.restaurantId, restaurantId),
      eq(aiRecipeCostSnapshotsTable.menuItemId, itemId),
    )).returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({
    req, module: "khana_ai", action: `recipe.snapshot.${status ?? "update"}`,
    entity: "ai_recipe_cost_snapshot", entityId: row.id, newValue: { status, notes },
  });
  res.json({ snapshot: row });
});

// ────────────────────────── Staff Insights ──────────────────────────

interface StaffScorecard {
  userId: number;
  name: string;
  jobTitle: string | null;
  department: string | null;
  attendanceDays: number;
  scheduledDays: number;
  attendanceRate: number;
  lateCount: number;
  avgLateMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number;
  ordersHandled: number;
  ordersCancelled: number;
  cancellationRate: number;
  avgServiceMinutes: number | null;
  feedbackCount: number;
  feedbackAvgRating: number | null;
  feedbackNegative: number;
  discountCount: number;
  discountTotal: number;
  discountShare: number;
  payrollGross: number;
  payrollNet: number;
  payrollLateDeduction: number;
  payrollOvertimeAmount: number;
}

interface StaffInsightCard {
  type: "best_performer" | "training_needs" | "suspicious_activity" | "payroll_anomaly" | "shift_suggestion";
  title: string;
  body: string;
  citations: Array<{ userId: number; name: string; metric: string }>;
  severity: "info" | "warn" | "critical";
}

interface StaffInsightsPayload {
  from: string;
  to: string;
  generatedAt: string;
  scorecards: StaffScorecard[];
  cards: StaffInsightCard[];
  summary: string;
  cached: boolean;
}

const STAFF_INSIGHTS_CACHE = new Map<string, { expiresAt: number; payload: StaffInsightsPayload }>();
const STAFF_INSIGHTS_TTL_MS = 60 * 60 * 1000;

function staffInsightsCacheKey(opts: { tenantId: number; restaurantId: number; from: string; to: string }): string {
  return `${opts.tenantId}:${opts.restaurantId}:${opts.from}:${opts.to}`;
}

function parseDateRange(body: unknown): { from: Date; to: Date; fromStr: string; toStr: string } {
  const b = (body ?? {}) as { from?: string; to?: string };
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 86_400_000);
  const from = b.from ? new Date(b.from) : defaultFrom;
  const to = b.to ? new Date(b.to) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    throw Object.assign(new Error("Invalid date range"), { code: "BAD_RANGE" });
  }
  // Cap at 365 days.
  if (to.getTime() - from.getTime() > 365 * 86_400_000) {
    throw Object.assign(new Error("Date range cannot exceed 365 days"), { code: "RANGE_TOO_WIDE" });
  }
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  return { from, to, fromStr, toStr };
}

async function aggregateStaffMetrics(restaurantId: number, from: Date, to: Date): Promise<StaffScorecard[]> {
  const [staffRows, attendance, orders, cancelled, completedTimes, discounts, feedback, payroll] = await Promise.all([
    db.select({
      userId: staffTable.userId,
      name: usersTable.name,
      jobTitle: staffTable.jobTitle,
      department: staffTable.department,
    }).from(staffTable)
      .innerJoin(usersTable, eq(usersTable.id, staffTable.userId))
      .where(and(eq(staffTable.restaurantId, restaurantId), eq(staffTable.isActive, true))),
    db.select({
      userId: attendanceTable.userId,
      days: sql<string>`count(*)::int`,
      worked: sql<string>`coalesce(sum(${attendanceTable.workedMinutes}), 0)`,
      late: sql<string>`coalesce(sum(${attendanceTable.lateMinutes}), 0)`,
      lateCount: sql<string>`count(*) filter (where ${attendanceTable.lateMinutes} > 0)::int`,
      overtime: sql<string>`coalesce(sum(${attendanceTable.overtimeMinutes}), 0)`,
      scheduled: sql<string>`count(*) filter (where ${attendanceTable.scheduledMinutes} > 0)::int`,
    }).from(attendanceTable)
      .where(and(
        eq(attendanceTable.restaurantId, restaurantId),
        gte(attendanceTable.clockIn, from),
        lte(attendanceTable.clockIn, to),
      ))
      .groupBy(attendanceTable.userId),
    db.select({
      waiterId: ordersTable.waiterId,
      n: sql<string>`count(*)::int`,
    }).from(ordersTable)
      .where(and(
        eq(ordersTable.restaurantId, restaurantId),
        gte(ordersTable.createdAt, from),
        lte(ordersTable.createdAt, to),
        sql`${ordersTable.waiterId} is not null`,
      ))
      .groupBy(ordersTable.waiterId),
    db.select({
      waiterId: ordersTable.waiterId,
      n: sql<string>`count(*)::int`,
    }).from(ordersTable)
      .where(and(
        eq(ordersTable.restaurantId, restaurantId),
        gte(ordersTable.createdAt, from),
        lte(ordersTable.createdAt, to),
        eq(ordersTable.status, "cancelled"),
        sql`${ordersTable.waiterId} is not null`,
      ))
      .groupBy(ordersTable.waiterId),
    db.select({
      waiterId: ordersTable.waiterId,
      avgMin: sql<string>`avg(extract(epoch from (${ordersTable.completedAt} - ${ordersTable.createdAt})) / 60.0)`,
    }).from(ordersTable)
      .where(and(
        eq(ordersTable.restaurantId, restaurantId),
        gte(ordersTable.createdAt, from),
        lte(ordersTable.createdAt, to),
        sql`${ordersTable.completedAt} is not null`,
        sql`${ordersTable.waiterId} is not null`,
      ))
      .groupBy(ordersTable.waiterId),
    db.select({
      userId: orderDiscountsTable.recordedByUserId,
      n: sql<string>`count(*)::int`,
      total: sql<string>`coalesce(sum(${orderDiscountsTable.amount}), 0)`,
    }).from(orderDiscountsTable)
      .where(and(
        eq(orderDiscountsTable.restaurantId, restaurantId),
        gte(orderDiscountsTable.createdAt, from),
        lte(orderDiscountsTable.createdAt, to),
        sql`${orderDiscountsTable.recordedByUserId} is not null`,
      ))
      .groupBy(orderDiscountsTable.recordedByUserId),
    // Staff-tagged feedback: comments mentioning a staff member by name are
    // not structured, so we scope to negative ratings and count per
    // restaurant — owners can see overall feedback context. For per-staff
    // attribution we only include feedback explicitly tagged via category
    // = "staff" plus average rating across the window.
    db.select({
      n: sql<string>`count(*)::int`,
      avg: sql<string>`avg(${customerFeedbackTable.rating})`,
      neg: sql<string>`count(*) filter (where ${customerFeedbackTable.rating} <= 2)::int`,
    }).from(customerFeedbackTable)
      .where(and(
        eq(customerFeedbackTable.restaurantId, restaurantId),
        gte(customerFeedbackTable.createdAt, from),
        lte(customerFeedbackTable.createdAt, to),
        eq(customerFeedbackTable.category, "staff"),
      )),
    db.select({
      userId: payrollItemsTable.userId,
      gross: sql<string>`coalesce(sum(${payrollItemsTable.grossPay}), 0)`,
      net: sql<string>`coalesce(sum(${payrollItemsTable.netPay}), 0)`,
      lateDed: sql<string>`coalesce(sum(${payrollItemsTable.lateDeduction}), 0)`,
      otAmt: sql<string>`coalesce(sum(${payrollItemsTable.overtimeAmount}), 0)`,
    }).from(payrollItemsTable)
      .where(and(
        eq(payrollItemsTable.restaurantId, restaurantId),
        gte(payrollItemsTable.createdAt, from),
        lte(payrollItemsTable.createdAt, to),
      ))
      .groupBy(payrollItemsTable.userId),
  ]);

  const attMap = new Map(attendance.map((a) => [a.userId, a]));
  const ordMap = new Map(orders.map((o) => [o.waiterId as number, Number(o.n) || 0]));
  const cancMap = new Map(cancelled.map((o) => [o.waiterId as number, Number(o.n) || 0]));
  const timeMap = new Map(completedTimes.map((o) => [o.waiterId as number, Number(o.avgMin) || 0]));
  const discMap = new Map(discounts.map((d) => [d.userId as number, { n: Number(d.n) || 0, total: Number(d.total) || 0 }]));
  const payMap = new Map(payroll.map((p) => [p.userId, p]));

  const fbAgg = feedback[0] ?? { n: "0", avg: null, neg: "0" };
  const totalStaff = Math.max(1, staffRows.length);
  const fbPerStaff = Math.floor((Number(fbAgg.n) || 0) / totalStaff);
  const fbAvg = fbAgg.avg != null ? Number(fbAgg.avg) : null;
  const fbNegPerStaff = Math.floor((Number(fbAgg.neg) || 0) / totalStaff);

  return staffRows.map((s) => {
    const a = attMap.get(s.userId);
    const orders = ordMap.get(s.userId) ?? 0;
    const cancelled = cancMap.get(s.userId) ?? 0;
    const svc = timeMap.get(s.userId) ?? null;
    const d = discMap.get(s.userId) ?? { n: 0, total: 0 };
    const p = payMap.get(s.userId);
    const days = a ? Number(a.days) || 0 : 0;
    const sched = a ? Number(a.scheduled) || days : 0;
    const lateCount = a ? Number(a.lateCount) || 0 : 0;
    const lateMin = a ? Number(a.late) || 0 : 0;
    return {
      userId: s.userId,
      name: s.name,
      jobTitle: s.jobTitle,
      department: s.department,
      attendanceDays: days,
      scheduledDays: sched,
      attendanceRate: sched > 0 ? Number(((days / sched) * 100).toFixed(1)) : 0,
      lateCount,
      avgLateMinutes: lateCount > 0 ? Number((lateMin / lateCount).toFixed(1)) : 0,
      overtimeMinutes: a ? Number(a.overtime) || 0 : 0,
      workedMinutes: a ? Number(a.worked) || 0 : 0,
      ordersHandled: orders,
      ordersCancelled: cancelled,
      cancellationRate: orders > 0 ? Number(((cancelled / orders) * 100).toFixed(1)) : 0,
      avgServiceMinutes: svc != null ? Number(svc.toFixed(1)) : null,
      feedbackCount: fbPerStaff,
      feedbackAvgRating: fbAvg,
      feedbackNegative: fbNegPerStaff,
      discountCount: d.n,
      discountTotal: Number(d.total.toFixed(2)),
      discountShare: orders > 0 ? Number(((d.n / orders) * 100).toFixed(1)) : 0,
      payrollGross: p ? Number(Number(p.gross).toFixed(2)) : 0,
      payrollNet: p ? Number(Number(p.net).toFixed(2)) : 0,
      payrollLateDeduction: p ? Number(Number(p.lateDed).toFixed(2)) : 0,
      payrollOvertimeAmount: p ? Number(Number(p.otAmt).toFixed(2)) : 0,
    } satisfies StaffScorecard;
  });
}

router.get(
  "/restaurants/:restaurantId/ai-ops/staff-insights/cached",
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const tenantId = req.user?.tenantId ?? 0;
    try {
      const { fromStr, toStr } = parseDateRange({ from: req.query.from, to: req.query.to });
      const key = staffInsightsCacheKey({ tenantId, restaurantId, from: fromStr, to: toStr });
      const hit = STAFF_INSIGHTS_CACHE.get(key);
      if (hit && hit.expiresAt > Date.now()) {
        res.json({ insights: { ...hit.payload, cached: true } });
        return;
      }
      res.json({ insights: null });
    } catch (err) {
      const e = err as { message?: string };
      res.status(400).json({ error: e.message ?? "Invalid range" });
    }
  },
);

router.post(
  "/restaurants/:restaurantId/ai-ops/staff-insights/generate",
  // Cache short-circuit BEFORE credit reservation, so a 1hr-old generation
  // for the same (tenant, range) does not re-spend credits.
  async (req: Request, res: Response, next) => {
    const restaurantId = Number(req.params.restaurantId);
    const tenantId = req.user?.tenantId ?? 0;
    try {
      const { fromStr, toStr } = parseDateRange(req.body);
      const key = staffInsightsCacheKey({ tenantId, restaurantId, from: fromStr, to: toStr });
      const hit = STAFF_INSIGHTS_CACHE.get(key);
      if (hit && hit.expiresAt > Date.now()) {
        res.json({ insights: { ...hit.payload, cached: true } });
        return;
      }
      next();
    } catch (err) {
      const e = err as { message?: string };
      res.status(400).json({ error: e.message ?? "Invalid range" });
    }
  },
  requireAiCredits("staff_insights", () => ({ units: 1 })),
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const tenantId = req.user?.tenantId ?? 0;
    const reservation = res.locals.aiCreditReservation as AiCreditReservation | null;
    try {
      const { from, to, fromStr, toStr } = parseDateRange(req.body);

      const scorecards = await aggregateStaffMetrics(restaurantId, from, to);

      if (scorecards.length === 0) {
        if (reservation) await refundReservation(reservation, "no active staff");
        res.status(400).json({ error: "No active staff in this restaurant to analyse." });
        return;
      }

      // Compact compact lines for the prompt — keep token usage bounded.
      const top = [...scorecards]
        .sort((a, b) => b.ordersHandled - a.ordersHandled || b.attendanceRate - a.attendanceRate)
        .slice(0, 30);
      const lines = top.map((s) =>
        `  - id=${s.userId} name="${s.name}" role=${s.jobTitle ?? "staff"} attend=${s.attendanceRate}% lateCnt=${s.lateCount} avgLateMin=${s.avgLateMinutes} otMin=${s.overtimeMinutes} orders=${s.ordersHandled} cancelled=${s.ordersCancelled}(${s.cancellationRate}%) avgSvcMin=${s.avgServiceMinutes ?? "n/a"} disc=${s.discountCount}/${s.discountTotal}(${s.discountShare}%) gross=${s.payrollGross} net=${s.payrollNet} lateDed=${s.payrollLateDeduction} otAmt=${s.payrollOvertimeAmount}`,
      ).join("\n");

      const prompt = `You are a restaurant operations analyst. Review per-staff metrics for ${fromStr} → ${toStr} and produce 5 actionable insight cards.

Per-staff metrics:
${lines}

Return ONLY a JSON object:
{
  "summary": "1-2 sentence overall team-health summary",
  "cards": [
    {"type": "best_performer", "title": "<short>", "body": "<2-3 sentences with the key reason>", "citations": [{"userId": <id>, "name": "<name>", "metric": "<which metric proves it>"}], "severity": "info"},
    {"type": "training_needs", "title": "<short>", "body": "<who needs coaching and on what specific weakness>", "citations": [...], "severity": "warn"},
    {"type": "suspicious_activity", "title": "<short>", "body": "<unusual discount/cancellation/attendance pattern vs peers>", "citations": [...], "severity": "warn|critical"},
    {"type": "payroll_anomaly", "title": "<short>", "body": "<overtime spike, late-deduction inconsistency, hours-vs-paid mismatch>", "citations": [...], "severity": "warn|critical"},
    {"type": "shift_suggestion", "title": "<short>", "body": "<staffing/shift change suggestion based on service time + orders>", "citations": [], "severity": "info"}
  ]
}

Rules:
- Cite at least one staff member per card (except shift_suggestion may cite 0 if it's a structural suggestion).
- Severity "critical" only when discount/cancellation outliers exceed 2× peer average AND > 5 events.
- For best_performer: pick highest combined score across attendance, orders handled, low cancellation, low avg service time.
- For payroll_anomaly: flag late-deduction > 10% of gross, OR overtime amount > 25% of gross, OR worked hours not matching expected scheduled hours.
- Keep card body under 240 chars.
- JSON only, no markdown.`;

      const inputsHash = hashInputs({ from: fromStr, to: toStr, ids: scorecards.map((s) => s.userId).sort() });

      const { data, result } = await AIProviderService.generateJson<{
        summary?: unknown; cards?: unknown;
      }>({
        featureSlug: "staff_insights",
        tenantId: req.user?.tenantId ?? null,
        restaurantId,
        userId: req.user?.sub ?? null,
        metadata: { inputsHash, staffCount: scorecards.length, from: fromStr, to: toStr },
      }, {
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        maxTokens: 2000,
      });

      const idToName = new Map(scorecards.map((s) => [s.userId, s.name]));
      const allowed = new Set(["best_performer", "training_needs", "suspicious_activity", "payroll_anomaly", "shift_suggestion"]);
      const sevAllowed = new Set(["info", "warn", "critical"]);
      const rawCards = Array.isArray(data.cards) ? data.cards : [];
      const cards: StaffInsightCard[] = rawCards
        .map((raw: unknown): StaffInsightCard | null => {
          const r = raw as Record<string, unknown>;
          const type = String(r.type ?? "").toLowerCase();
          if (!allowed.has(type)) return null;
          const sev = String(r.severity ?? "info").toLowerCase();
          const severity = (sevAllowed.has(sev) ? sev : "info") as StaffInsightCard["severity"];
          const rawCit = Array.isArray(r.citations) ? r.citations : [];
          const citations = rawCit
            .map((c) => {
              const cc = c as Record<string, unknown>;
              const uid = Number(cc.userId);
              if (!Number.isFinite(uid) || !idToName.has(uid)) return null;
              return {
                userId: uid,
                name: idToName.get(uid) ?? String(cc.name ?? ""),
                metric: String(cc.metric ?? "").slice(0, 120),
              };
            })
            .filter((x): x is { userId: number; name: string; metric: string } => x !== null)
            .slice(0, 5);
          return {
            type: type as StaffInsightCard["type"],
            title: String(r.title ?? "").slice(0, 120),
            body: String(r.body ?? "").slice(0, 320),
            citations,
            severity,
          };
        })
        .filter((x): x is StaffInsightCard => x !== null);

      const payload: StaffInsightsPayload = {
        from: fromStr,
        to: toStr,
        generatedAt: new Date().toISOString(),
        scorecards,
        cards,
        summary: typeof data.summary === "string" ? data.summary.trim().slice(0, 500) : "",
        cached: false,
      };

      STAFF_INSIGHTS_CACHE.set(
        staffInsightsCacheKey({ tenantId, restaurantId, from: fromStr, to: toStr }),
        { expiresAt: Date.now() + STAFF_INSIGHTS_TTL_MS, payload },
      );

      if (reservation) {
        await commitReservation({ reservation, userId: req.user?.sub ?? null, requestLogId: result.requestLogId });
      }
      await recordAuditLog({
        req, module: "khana_ai", action: "staff_insights.generate",
        entity: "ai_staff_insights",
        newValue: { from: fromStr, to: toStr, staffCount: scorecards.length, cardCount: cards.length, requestLogId: result.requestLogId },
      });
      res.json({ insights: payload });
    } catch (err) {
      if (reservation) await refundReservation(reservation, (err as Error).message ?? "provider error");
      req.log.error({ err }, "AI staff insights failed");
      await recordAuditLog({
        req, module: "khana_ai", action: "staff_insights.generate_failed",
        entity: "ai_staff_insights",
        newValue: { error: (err as Error).message ?? "provider error" },
      });
      res.status(502).json({ error: "Failed to generate staff insights" });
    }
  },
);

export default router;
