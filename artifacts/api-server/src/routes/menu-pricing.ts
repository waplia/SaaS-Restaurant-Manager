/**
 * AI Recipe Cost & Price Optimizer
 *
 * - GET    /restaurants/:rid/pricing/settings           — read targets/defaults
 * - PUT    /restaurants/:rid/pricing/settings           — write targets/defaults (audited)
 * - GET    /restaurants/:rid/pricing/optimizer          — list view (cost / price / margin / status)
 * - GET    /restaurants/:rid/pricing/items/:id          — detail (recipe + rule-based suggestion + combo)
 * - POST   /restaurants/:rid/pricing/items/:id/ai-suggest  — AI rationale (falls back to rule math)
 * - POST   /restaurants/:rid/pricing/items/:id/apply-price — accept suggested price (audited)
 * - PUT    /restaurants/:rid/pricing/items/:id/meta     — competitor price, per-item waste/overhead
 */
import { Router, type Request, type Response } from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  menuItemsTable,
  menuCategoriesTable,
  recipeMappingsTable,
  inventoryItemsTable,
  restaurantsTable,
  restaurantSettingsTable,
  menuItemPricingMetaTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { recordAuditLog } from "../lib/audit";
import { AIProviderService } from "../lib/aiProviderService";
import { logger } from "../lib/logger";

const router = Router();

router.use(
  "/restaurants/:restaurantId/pricing",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);
router.use(
  "/restaurants/:restaurantId/pricing/:rest",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);

const DEFAULT_TARGET_FOOD_COST_PCT = 30; // industry rule of thumb
const DEFAULT_LOW_MARGIN_BUFFER_PCT = 5; // alert when food cost % >= target + buffer
const DEFAULT_OVERHEAD_PCT = 0;
const DEFAULT_WASTE_PCT = 0;

interface PricingSettings {
  targetFoodCostPct: number;
  lowMarginBufferPct: number;
  defaultOverheadPct: number;
  defaultWastePct: number;
}

function clampPct(n: unknown, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(100, Number(v.toFixed(2))));
}

function parseSettings(raw: unknown): PricingSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    targetFoodCostPct: clampPct(obj.targetFoodCostPct, DEFAULT_TARGET_FOOD_COST_PCT),
    lowMarginBufferPct: clampPct(obj.lowMarginBufferPct, DEFAULT_LOW_MARGIN_BUFFER_PCT),
    defaultOverheadPct: clampPct(obj.defaultOverheadPct, DEFAULT_OVERHEAD_PCT),
    defaultWastePct: clampPct(obj.defaultWastePct, DEFAULT_WASTE_PCT),
  };
}

async function loadSettings(restaurantId: number): Promise<PricingSettings> {
  const [row] = await db.select().from(restaurantSettingsTable).where(and(
    eq(restaurantSettingsTable.restaurantId, restaurantId),
    eq(restaurantSettingsTable.section, "pricing"),
  ));
  return parseSettings(row?.data);
}

async function loadCurrency(restaurantId: number): Promise<string> {
  const [r] = await db.select({ currency: restaurantsTable.currency })
    .from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  return r?.currency ?? "INR";
}

interface RecipeLine {
  inventoryItemId: number;
  ingredientName: string | null;
  quantity: number;
  unit: string;
  costPerUnit: number;
  ingredientUnit: string | null;
  lineCost: number;
}

interface MetaRow {
  competitorPrice: number | null;
  wastePct: number | null;
  overheadPct: number | null;
}

interface ItemComputation {
  id: number;
  name: string;
  categoryId: number | null;
  categoryName: string | null;
  price: number;
  rawCogs: number;
  effectiveCogs: number;
  margin: number; // %
  foodCostPct: number; // %
  hasRecipe: boolean;
  ingredientCount: number;
  competitorPrice: number | null;
  wastePct: number;
  overheadPct: number;
  status: "no_recipe" | "healthy" | "low_margin" | "losing_money";
  suggestedPrice: number | null;
}

function computeItem(
  item: { id: number; name: string; price: string; categoryId: number | null; categoryName: string | null },
  recipe: RecipeLine[],
  meta: MetaRow | null,
  settings: PricingSettings,
): ItemComputation {
  const wastePct = meta?.wastePct ?? settings.defaultWastePct;
  const overheadPct = meta?.overheadPct ?? settings.defaultOverheadPct;
  const competitorPrice = meta?.competitorPrice ?? null;

  const rawCogs = recipe.reduce((s, r) => s + r.lineCost, 0);
  // yield/waste inflates cost, then overhead is a markup on cogs
  const wasteFactor = 1 + Math.max(0, wastePct) / 100;
  const overheadFactor = 1 + Math.max(0, overheadPct) / 100;
  const effectiveCogs = rawCogs * wasteFactor * overheadFactor;

  const price = Number(item.price);
  const margin = price > 0 ? ((price - effectiveCogs) / price) * 100 : 0;
  const foodCostPct = price > 0 ? (effectiveCogs / price) * 100 : 0;

  // Suggested price: hit target food cost %.
  // suggested = effectiveCogs / (target / 100). Round to nearest 5 for INR-friendly numbers.
  let suggestedPrice: number | null = null;
  if (recipe.length > 0 && effectiveCogs > 0) {
    const raw = effectiveCogs / (settings.targetFoodCostPct / 100);
    // Nudge toward competitor: if competitor is set and raw is meaningfully above, average them.
    let withCompetitor = raw;
    if (competitorPrice != null && competitorPrice > 0) {
      withCompetitor = (raw + competitorPrice) / 2;
      // never go below cost-recovery (target food cost) regardless of competitor
      if (withCompetitor < raw * 0.9) withCompetitor = raw * 0.9;
    }
    // Round up to nearest 5 (currency-agnostic but works well for INR/whole units)
    suggestedPrice = Math.ceil(withCompetitor / 5) * 5;
  }

  let status: ItemComputation["status"];
  if (recipe.length === 0) status = "no_recipe";
  else if (price > 0 && effectiveCogs >= price) status = "losing_money";
  else if (price > 0 && foodCostPct >= settings.targetFoodCostPct + settings.lowMarginBufferPct) status = "low_margin";
  else status = "healthy";

  return {
    id: item.id,
    name: item.name,
    categoryId: item.categoryId,
    categoryName: item.categoryName,
    price,
    rawCogs,
    effectiveCogs,
    margin: Number(margin.toFixed(2)),
    foodCostPct: Number(foodCostPct.toFixed(2)),
    hasRecipe: recipe.length > 0,
    ingredientCount: recipe.length,
    competitorPrice,
    wastePct,
    overheadPct,
    status,
    suggestedPrice: suggestedPrice != null ? Number(suggestedPrice.toFixed(2)) : null,
  };
}

async function loadAllForRestaurant(restaurantId: number, settings: PricingSettings) {
  const items = await db.select({
    id: menuItemsTable.id,
    name: menuItemsTable.name,
    price: menuItemsTable.price,
    categoryId: menuItemsTable.categoryId,
    categoryName: menuCategoriesTable.name,
  }).from(menuItemsTable)
    .leftJoin(menuCategoriesTable, eq(menuItemsTable.categoryId, menuCategoriesTable.id))
    .where(eq(menuItemsTable.restaurantId, restaurantId));

  const mappings = await db.select({
    menuItemId: recipeMappingsTable.menuItemId,
    inventoryItemId: recipeMappingsTable.inventoryItemId,
    quantity: recipeMappingsTable.quantity,
    unit: recipeMappingsTable.unit,
    ingredientName: inventoryItemsTable.name,
    costPerUnit: inventoryItemsTable.costPerUnit,
    ingredientUnit: inventoryItemsTable.unit,
  }).from(recipeMappingsTable)
    .leftJoin(inventoryItemsTable, eq(recipeMappingsTable.inventoryItemId, inventoryItemsTable.id))
    .where(eq(recipeMappingsTable.restaurantId, restaurantId));

  const metas = await db.select().from(menuItemPricingMetaTable)
    .where(eq(menuItemPricingMetaTable.restaurantId, restaurantId));

  const recipeByItem = new Map<number, RecipeLine[]>();
  for (const m of mappings) {
    const qty = Number(m.quantity);
    const cpu = Number(m.costPerUnit ?? 0);
    const line: RecipeLine = {
      inventoryItemId: m.inventoryItemId,
      ingredientName: m.ingredientName,
      quantity: qty,
      unit: m.unit,
      costPerUnit: cpu,
      ingredientUnit: m.ingredientUnit,
      lineCost: qty * cpu,
    };
    const arr = recipeByItem.get(m.menuItemId) ?? [];
    arr.push(line);
    recipeByItem.set(m.menuItemId, arr);
  }
  const metaByItem = new Map<number, MetaRow>();
  for (const r of metas) {
    metaByItem.set(r.menuItemId, {
      competitorPrice: r.competitorPrice != null ? Number(r.competitorPrice) : null,
      wastePct: r.wastePct != null ? Number(r.wastePct) : null,
      overheadPct: r.overheadPct != null ? Number(r.overheadPct) : null,
    });
  }

  const computed = items.map((it) => computeItem(it, recipeByItem.get(it.id) ?? [], metaByItem.get(it.id) ?? null, settings));
  return { computed, recipeByItem, metaByItem };
}

// ────────────────────────── Settings ──────────────────────────

router.get("/restaurants/:restaurantId/pricing/settings", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const settings = await loadSettings(restaurantId);
  const currency = await loadCurrency(restaurantId);
  res.json({ ...settings, currency });
});

router.put("/restaurants/:restaurantId/pricing/settings", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const before = await loadSettings(restaurantId);
  const next = parseSettings({ ...before, ...(req.body ?? {}) });
  await db.insert(restaurantSettingsTable).values({
    restaurantId,
    section: "pricing",
    data: next as never,
    updatedBy: req.user?.sub ?? null,
  }).onConflictDoUpdate({
    target: [restaurantSettingsTable.restaurantId, restaurantSettingsTable.section],
    set: { data: next as never, updatedBy: req.user?.sub ?? null, updatedAt: new Date() },
  });
  await recordAuditLog({
    req, module: "menu_pricing", action: "settings_updated", entity: "pricing_settings",
    restaurantId, oldValue: before, newValue: next,
  });
  res.json(next);
});

// ────────────────────────── Optimizer list ──────────────────────────

router.get("/restaurants/:restaurantId/pricing/optimizer", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const settings = await loadSettings(restaurantId);
  const currency = await loadCurrency(restaurantId);
  const { computed } = await loadAllForRestaurant(restaurantId, settings);
  res.json({ settings, currency, items: computed });
});

// ────────────────────────── Item detail (recipe + rule-based suggestion) ──────────

interface ComboSuggestion {
  partnerItemIds: number[];
  partnerItemNames: string[];
  bundlePrice: number;
  blendedFoodCostPct: number;
  blendedMarginPct: number;
  rationale: string;
}

function buildRuleBasedSuggestion(
  item: ItemComputation,
  others: ItemComputation[],
  settings: PricingSettings,
  currency: string,
): { rationale: string; combo: ComboSuggestion | null } {
  const sym = currency === "INR" ? "₹" : currency + " ";
  const parts: string[] = [];
  if (item.suggestedPrice != null) {
    parts.push(`Aim for a ${settings.targetFoodCostPct}% food-cost target — that puts the price near ${sym}${item.suggestedPrice.toFixed(2)}.`);
  } else {
    parts.push(`Add a recipe so we can compute a target price.`);
  }
  if (item.competitorPrice != null) {
    parts.push(`Your competitor sits at ${sym}${item.competitorPrice.toFixed(2)}; the suggestion blends both numbers so you stay within market.`);
  }
  if (item.status === "losing_money") {
    parts.push(`This item currently costs more than it sells for — raise the price or trim portions immediately.`);
  } else if (item.status === "low_margin") {
    parts.push(`Margin is below your healthy threshold (${(settings.targetFoodCostPct + settings.lowMarginBufferPct).toFixed(0)}% food-cost ceiling).`);
  } else if (item.status === "healthy") {
    parts.push(`Margin is healthy — no urgent change needed.`);
  }

  // Combo suggestion for low-margin / losing items only — bundle with the 1-2 highest-margin items.
  let combo: ComboSuggestion | null = null;
  if ((item.status === "low_margin" || item.status === "losing_money") && item.hasRecipe && item.price > 0) {
    const candidates = others
      .filter((o) => o.id !== item.id && o.hasRecipe && o.price > 0 && o.margin > item.margin + 10)
      .sort((a, b) => b.margin - a.margin)
      .slice(0, 2);
    if (candidates.length > 0) {
      const partnerCogs = candidates.reduce((s, c) => s + c.effectiveCogs, 0);
      const partnerPrice = candidates.reduce((s, c) => s + c.price, 0);
      const totalCogs = item.effectiveCogs + partnerCogs;
      // Bundle at ~10% off total list price to entice the buyer.
      const listTotal = item.price + partnerPrice;
      const bundlePrice = Math.ceil((listTotal * 0.9) / 5) * 5;
      const blendedFoodCostPct = bundlePrice > 0 ? (totalCogs / bundlePrice) * 100 : 0;
      const blendedMarginPct = bundlePrice > 0 ? ((bundlePrice - totalCogs) / bundlePrice) * 100 : 0;
      combo = {
        partnerItemIds: candidates.map((c) => c.id),
        partnerItemNames: candidates.map((c) => c.name),
        bundlePrice,
        blendedFoodCostPct: Number(blendedFoodCostPct.toFixed(2)),
        blendedMarginPct: Number(blendedMarginPct.toFixed(2)),
        rationale: `Bundle with ${candidates.map((c) => `"${c.name}"`).join(" + ")} to lift the blended margin to ~${blendedMarginPct.toFixed(0)}%.`,
      };
    }
  }

  return { rationale: parts.join(" "), combo };
}

async function loadItemDetail(restaurantId: number, itemId: number) {
  const settings = await loadSettings(restaurantId);
  const currency = await loadCurrency(restaurantId);
  const { computed, recipeByItem } = await loadAllForRestaurant(restaurantId, settings);
  const item = computed.find((c) => c.id === itemId) ?? null;
  if (!item) return null;
  const recipe = recipeByItem.get(itemId) ?? [];
  const others = computed.filter((c) => c.id !== itemId);
  const ruleBased = buildRuleBasedSuggestion(item, others, settings, currency);
  return { settings, currency, item, recipe, others, ruleBased };
}

router.get("/restaurants/:restaurantId/pricing/items/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const itemId = Number(req.params.id);
  const detail = await loadItemDetail(restaurantId, itemId);
  if (!detail) return void res.status(404).json({ error: "Item not found" });
  const { settings, currency, item, recipe, ruleBased } = detail;
  res.json({ settings, currency, item, recipe, suggestion: { source: "rule", ...ruleBased } });
});

// ────────────────────────── AI suggestion (graceful fallback) ──────────────────────────

router.post("/restaurants/:restaurantId/pricing/items/:id/ai-suggest", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const itemId = Number(req.params.id);
  const detail = await loadItemDetail(restaurantId, itemId);
  if (!detail) return void res.status(404).json({ error: "Item not found" });
  const { settings, currency, item, recipe, others, ruleBased } = detail;

  const sym = currency === "INR" ? "₹" : currency + " ";
  if (!item.hasRecipe) {
    return void res.json({
      source: "rule", rationale: `Add a recipe so we can compute a target price.`,
      combo: null, suggestedPrice: null,
    });
  }

  const recipeLines = recipe.map((r) =>
    `  - ${r.ingredientName ?? "?"} qty=${r.quantity}${r.unit} cost=${r.costPerUnit}/${r.ingredientUnit ?? "unit"} lineCost=${r.lineCost.toFixed(2)}`,
  ).join("\n");
  const partnerCandidates = others
    .filter((o) => o.hasRecipe && o.price > 0 && o.margin > item.margin + 10)
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 5);
  const partnerLines = partnerCandidates
    .map((o) => `  - id=${o.id} name="${o.name}" price=${o.price.toFixed(2)} margin=${o.margin.toFixed(0)}%`)
    .join("\n") || "  (none above this item's margin)";

  const prompt = `You are a restaurant menu pricing analyst. Output ONLY JSON.

Currency: ${currency}
Target food-cost %: ${settings.targetFoodCostPct}
Low-margin alert when food-cost % >= ${(settings.targetFoodCostPct + settings.lowMarginBufferPct).toFixed(0)}

Dish: "${item.name}" (${item.categoryName ?? "Uncategorised"})
Current price: ${sym}${item.price.toFixed(2)}
Effective COGS (incl. waste & overhead): ${sym}${item.effectiveCogs.toFixed(2)}
Current margin: ${item.margin.toFixed(1)}%
Current food-cost %: ${item.foodCostPct.toFixed(1)}%
${item.competitorPrice != null ? `Competitor price (manual): ${sym}${item.competitorPrice.toFixed(2)}` : "No competitor price provided."}

Recipe:
${recipeLines}

Other higher-margin menu items eligible as combo partners:
${partnerLines}

Return JSON of the form:
{
  "suggestedPrice": <number, rounded to nearest 5 in the local currency, or null if you do not recommend changing>,
  "rationale": "<2-3 plain sentences explaining target food-cost %, current margin, and competitor reference if any>",
  "combo": null OR {
    "partnerItemIds": [<id>, ...],   // 1 or 2 ids from the partner list above
    "bundlePrice": <number rounded to nearest 5>,
    "rationale": "<one sentence>"
  }
}

Rules:
- Suggest a combo only when the item's status is "low_margin" or "losing_money".
- Do not invent partner ids; only choose from the partner list.
- Bundle price should be discounted vs the sum of list prices but still keep blended food-cost % at or below ${(settings.targetFoodCostPct + settings.lowMarginBufferPct).toFixed(0)}%.`;

  try {
    const { data } = await AIProviderService.generateJson<{
      suggestedPrice?: unknown; rationale?: unknown;
      combo?: { partnerItemIds?: unknown; bundlePrice?: unknown; rationale?: unknown } | null;
    }>({
      featureSlug: "ai_recipe_optimizer",
      tenantId: req.user?.tenantId ?? null,
      restaurantId,
      userId: req.user?.sub ?? null,
      metadata: { itemId, scope: "pricing_optimizer" },
    }, {
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      maxTokens: 800,
    });

    const aiPriceRaw = Number(data.suggestedPrice);
    const suggestedPrice = Number.isFinite(aiPriceRaw) && aiPriceRaw > 0 ? Number(aiPriceRaw.toFixed(2)) : item.suggestedPrice;
    const rationale = typeof data.rationale === "string" && data.rationale.trim().length > 0
      ? data.rationale.trim() : ruleBased.rationale;

    let combo: ComboSuggestion | null = null;
    const c = data.combo;
    if (c && (item.status === "low_margin" || item.status === "losing_money")) {
      const ids = Array.isArray(c.partnerItemIds) ? c.partnerItemIds.map(Number).filter((n) => Number.isFinite(n)) : [];
      const partners = ids.map((id) => partnerCandidates.find((p) => p.id === id)).filter((p): p is ItemComputation => !!p).slice(0, 2);
      const bundlePriceRaw = Number(c.bundlePrice);
      if (partners.length > 0 && Number.isFinite(bundlePriceRaw) && bundlePriceRaw > 0) {
        const totalCogs = item.effectiveCogs + partners.reduce((s, p) => s + p.effectiveCogs, 0);
        const blendedFoodCostPct = (totalCogs / bundlePriceRaw) * 100;
        const blendedMarginPct = ((bundlePriceRaw - totalCogs) / bundlePriceRaw) * 100;
        combo = {
          partnerItemIds: partners.map((p) => p.id),
          partnerItemNames: partners.map((p) => p.name),
          bundlePrice: Number(bundlePriceRaw.toFixed(2)),
          blendedFoodCostPct: Number(blendedFoodCostPct.toFixed(2)),
          blendedMarginPct: Number(blendedMarginPct.toFixed(2)),
          rationale: typeof c.rationale === "string" ? c.rationale : ruleBased.combo?.rationale ?? "",
        };
      }
    }
    if (!combo) combo = ruleBased.combo;

    return void res.json({ source: "ai", suggestedPrice, rationale, combo });
  } catch (err) {
    logger.warn({ err, itemId, restaurantId }, "ai pricing suggestion failed; falling back to rule");
    return void res.json({
      source: "rule",
      suggestedPrice: item.suggestedPrice,
      rationale: ruleBased.rationale,
      combo: ruleBased.combo,
    });
  }
});

// ────────────────────────── Apply suggested price ──────────────────────────

router.post("/restaurants/:restaurantId/pricing/items/:id/apply-price", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const itemId = Number(req.params.id);
  const newPriceRaw = Number((req.body ?? {}).newPrice);
  if (!Number.isFinite(newPriceRaw) || newPriceRaw <= 0) {
    return void res.status(400).json({ error: "newPrice must be a positive number" });
  }
  const newPrice = Number(newPriceRaw.toFixed(2));

  const [existing] = await db.select().from(menuItemsTable)
    .where(and(eq(menuItemsTable.id, itemId), eq(menuItemsTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Item not found" });
  const oldPrice = Number(existing.price);

  const [updated] = await db.update(menuItemsTable)
    .set({ price: String(newPrice), updatedAt: new Date() })
    .where(and(eq(menuItemsTable.id, itemId), eq(menuItemsTable.restaurantId, restaurantId)))
    .returning();

  await recordAuditLog({
    req, module: "menu_pricing", action: "apply_suggested_price",
    entity: "menu_item", entityId: itemId, restaurantId,
    oldValue: { price: oldPrice }, newValue: { price: newPrice },
    details: `Applied AI-suggested price for "${existing.name}"`,
  });

  res.json({ id: updated.id, name: updated.name, oldPrice, newPrice });
});

// ────────────────────────── Per-item meta (competitor + overrides) ──────────

router.put("/restaurants/:restaurantId/pricing/items/:id/meta", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const itemId = Number(req.params.id);
  const [item] = await db.select({ id: menuItemsTable.id, name: menuItemsTable.name })
    .from(menuItemsTable)
    .where(and(eq(menuItemsTable.id, itemId), eq(menuItemsTable.restaurantId, restaurantId)));
  if (!item) return void res.status(404).json({ error: "Item not found" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const competitorPrice =
    body.competitorPrice === null || body.competitorPrice === ""
      ? null
      : Number.isFinite(Number(body.competitorPrice)) && Number(body.competitorPrice) > 0
        ? Number(Number(body.competitorPrice).toFixed(2))
        : undefined;
  const wastePct =
    body.wastePct === null || body.wastePct === ""
      ? null
      : Number.isFinite(Number(body.wastePct))
        ? clampPct(body.wastePct, 0)
        : undefined;
  const overheadPct =
    body.overheadPct === null || body.overheadPct === ""
      ? null
      : Number.isFinite(Number(body.overheadPct))
        ? clampPct(body.overheadPct, 0)
        : undefined;

  const [existing] = await db.select().from(menuItemPricingMetaTable)
    .where(eq(menuItemPricingMetaTable.menuItemId, itemId));

  const merged = {
    competitorPrice: competitorPrice === undefined ? existing?.competitorPrice ?? null : competitorPrice,
    wastePct: wastePct === undefined ? existing?.wastePct ?? null : wastePct,
    overheadPct: overheadPct === undefined ? existing?.overheadPct ?? null : overheadPct,
  };

  if (existing) {
    await db.update(menuItemPricingMetaTable).set({
      competitorPrice: merged.competitorPrice as never,
      wastePct: merged.wastePct as never,
      overheadPct: merged.overheadPct as never,
      updatedAt: new Date(),
    }).where(eq(menuItemPricingMetaTable.id, existing.id));
  } else {
    await db.insert(menuItemPricingMetaTable).values({
      restaurantId,
      menuItemId: itemId,
      competitorPrice: merged.competitorPrice as never,
      wastePct: merged.wastePct as never,
      overheadPct: merged.overheadPct as never,
    });
  }

  await recordAuditLog({
    req, module: "menu_pricing", action: "update_pricing_meta",
    entity: "menu_item", entityId: itemId, restaurantId,
    oldValue: existing
      ? { competitorPrice: existing.competitorPrice, wastePct: existing.wastePct, overheadPct: existing.overheadPct }
      : null,
    newValue: merged,
  });

  res.json({
    menuItemId: itemId,
    competitorPrice: merged.competitorPrice != null ? Number(merged.competitorPrice) : null,
    wastePct: merged.wastePct != null ? Number(merged.wastePct) : null,
    overheadPct: merged.overheadPct != null ? Number(merged.overheadPct) : null,
  });
});

// silence unused-imports warning
void sql;

export default router;
