/**
 * Menu-item AI helpers, refactored to route through:
 *   - `AIProviderService.generateJson` / `generateImage` so super-admins can
 *     swap provider/model per-feature in admin → AI Control.
 *   - `requireAiCredits` so every successful call deducts from the tenant's
 *     Khana AI wallet (1 credit for description, 10 for image — defaults
 *     seeded in ai_feature_credit_rules).
 *
 * The route handlers always commitReservation on success and refundReservation
 * on failure so a provider error never burns credits.
 */
import { Router, type Request, type Response } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db, menuItemsTable, menuCategoriesTable, menuItemAiDraftsTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { AIProviderService } from "../lib/aiProviderService";
import { requireAiCredits, reserveCredits, commitReservation, refundReservation, type AiCreditReservation } from "../lib/aiCredits";
import { ObjectStorageService } from "../lib/objectStorage";
import { setObjectAclPolicy } from "../lib/objectAcl";
import { recordAuditLog } from "../lib/audit";
import { buildImageFilename } from "../lib/aiFoodImage";

const router = Router();
const objectStorage = new ObjectStorageService();

router.use(
  "/restaurants/:restaurantId/items/:itemId/ai-:rest",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("khana_ai_enabled"),
);
router.use(
  "/restaurants/:restaurantId/items/:itemId/ai-drafts",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("khana_ai_enabled"),
);
router.use(
  "/restaurants/:restaurantId/items/ai-nutrition-bulk",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("khana_ai_enabled"),
);

type DescriptionDraftPayload = {
  description: string;
  allergens: string[];
  tags: string[];
};

type PhotoDraftPayload = {
  imageUrl: string;
};

async function loadItemWithCategory(restaurantId: number, itemId: number) {
  const [item] = await db
    .select({
      id: menuItemsTable.id,
      name: menuItemsTable.name,
      isVeg: menuItemsTable.isVeg,
      categoryName: menuCategoriesTable.name,
    })
    .from(menuItemsTable)
    .leftJoin(menuCategoriesTable, eq(menuItemsTable.categoryId, menuCategoriesTable.id))
    .where(and(eq(menuItemsTable.id, itemId), eq(menuItemsTable.restaurantId, restaurantId)));
  return item ?? null;
}

async function trimDrafts(menuItemId: number, kind: string) {
  const rows = await db
    .select({ id: menuItemAiDraftsTable.id })
    .from(menuItemAiDraftsTable)
    .where(and(eq(menuItemAiDraftsTable.menuItemId, menuItemId), eq(menuItemAiDraftsTable.kind, kind)))
    .orderBy(desc(menuItemAiDraftsTable.createdAt), desc(menuItemAiDraftsTable.id));
  const toDelete = rows.slice(3).map((r) => r.id);
  if (toDelete.length === 0) return;
  await db.delete(menuItemAiDraftsTable).where(inArray(menuItemAiDraftsTable.id, toDelete));
}

router.post(
  "/restaurants/:restaurantId/items/:itemId/ai-description",
  requireAiCredits("ai_description", () => ({ units: 1 })),
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const itemId = Number(req.params.itemId);
    const reservation = res.locals.aiCreditReservation as AiCreditReservation | null;
    const item = await loadItemWithCategory(restaurantId, itemId);
    if (!item) {
      if (reservation) await refundReservation(reservation, "item not found");
      return void res.status(404).json({ error: "Item not found" });
    }

    const dietHint = item.isVeg ? "vegetarian" : "non-vegetarian (may contain meat or seafood)";
    const tone = String((req.body as { tone?: string })?.tone ?? "simple");
    const language = String((req.body as { language?: string })?.language ?? "en");
    const length = String((req.body as { length?: string })?.length ?? "short");
    const variant = String((req.body as { variant?: string })?.variant ?? "short");

    const lengthGuide = length === "premium" ? "2-3 sentences, max 320 characters"
      : length === "long" ? "3-4 sentences, max 420 characters"
      : "1-2 sentences, max 240 characters";

    const variantGuide: Record<string, string> = {
      short: "A short blurb suitable for compact menu cards.",
      premium: "Evocative, restaurant-grade copy suitable for fine-dining presentation.",
      qr_menu: "Punchy phrasing optimised for QR table menus — front-loads the most appetising detail.",
      online_ordering: "Conversion-focused copy for delivery / pickup carts — emphasises freshness and portion.",
      allergen_focused: "Lead with common allergens or dietary safety up front, then describe the dish.",
      ingredient_focused: "Highlight the key ingredients and cooking method clearly.",
      upsell: "Encourages add-ons, premium swaps, or pairing suggestions where natural.",
    };
    const variantHint = variantGuide[variant] ?? variantGuide.short;

    const prompt = `You are helping a restaurant write its menu copy. Generate JSON for this dish.

Dish name: ${item.name}
Category: ${item.categoryName ?? "Uncategorised"}
Diet hint: ${dietHint}
Tone: ${tone}
Language: ${language}
Length: ${lengthGuide}
Variant: ${variant} — ${variantHint}

Return ONLY a JSON object with these fields:
{
  "description": "${lengthGuide}, evocative but factual, written in ${language}",
  "allergens": ["common allergens that this dish typically contains, lowercase, e.g. dairy, gluten, nuts, eggs, soy, shellfish, fish, sesame"],
  "tags": ["short dietary or style tags, lowercase, e.g. spicy, popular, vegan, gluten-free, contains-nuts, kids-friendly, signature"]
}

Rules: respond with JSON only, no prose, no markdown fence. Keep allergens and tags arrays to at most 6 items each. If unsure about an allergen, omit it.`;

    try {
      const { data, result: textResult } = await AIProviderService.generateJson<{
        description?: unknown; allergens?: unknown; tags?: unknown;
      }>({
        featureSlug: "ai_description",
        tenantId: req.user?.tenantId ?? null,
        restaurantId,
        userId: req.user?.sub ?? null,
        metadata: { itemId, tone, language, length },
      }, {
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        maxTokens: 800,
      });

      const parsed: DescriptionDraftPayload = {
        description: typeof data.description === "string" ? data.description.trim() : "",
        allergens: Array.isArray(data.allergens)
          ? data.allergens.map((s: unknown) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 6)
          : [],
        tags: Array.isArray(data.tags)
          ? data.tags.map((s: unknown) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 6)
          : [],
      };
      if (!parsed.description) {
        if (reservation) await refundReservation(reservation, "empty description");
        return void res.status(502).json({ error: "AI returned an empty description" });
      }

      const [draft] = await db
        .insert(menuItemAiDraftsTable)
        .values({ menuItemId: itemId, restaurantId, kind: "description", payload: parsed })
        .returning();
      await trimDrafts(itemId, "description");
      if (reservation) await commitReservation({
        reservation,
        userId: req.user?.sub ?? null,
        requestLogId: textResult.requestLogId,
      });
      await recordAuditLog({
        req,
        module: "khana_ai",
        action: "ai_description.generate",
        entity: "menu_item",
        entityId: itemId,
        newValue: { variant, language, length, draftId: draft?.id, requestLogId: textResult.requestLogId },
      });

      res.json({ draft, payload: parsed });
    } catch (error) {
      if (reservation) await refundReservation(reservation, (error as Error).message ?? "provider error");
      req.log.error({ err: error }, "AI description generation failed");
      await recordAuditLog({
        req,
        module: "khana_ai",
        action: "ai_description.generate_failed",
        entity: "menu_item",
        entityId: itemId,
        newValue: { error: (error as Error).message ?? "provider error" },
      });
      res.status(502).json({ error: "Failed to generate description" });
    }
  },
);

router.post(
  "/restaurants/:restaurantId/items/:itemId/ai-photo",
  requireAiCredits("ai_food_image", () => ({ units: 1 })),
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const itemId = Number(req.params.itemId);
    const reservation = res.locals.aiCreditReservation as AiCreditReservation | null;
    const item = await loadItemWithCategory(restaurantId, itemId);
    if (!item) {
      if (reservation) await refundReservation(reservation, "item not found");
      return void res.status(404).json({ error: "Item not found" });
    }

    const styleHint = item.isVeg ? "vegetarian" : "";
    const extraStyle = String((req.body as { style?: string })?.style ?? "").trim();
    const ingredients = String((req.body as { ingredients?: string })?.ingredients ?? "").trim();
    const cuisine = String((req.body as { cuisine?: string })?.cuisine ?? "").trim();
    const prompt = `Professional overhead food photograph of ${item.name}${item.categoryName ? `, a ${item.categoryName.toLowerCase()} dish` : ""}${cuisine ? `, ${cuisine} cuisine` : ""}${styleHint ? `, ${styleHint}` : ""}${ingredients ? `, with ${ingredients}` : ""}. ${extraStyle || "Restaurant menu style, square crop, natural daylight, shallow depth of field, plated on a neutral ceramic dish on a wooden table, garnished tastefully, vibrant colours, photorealistic"}, no text, no logo, no watermark.`;

    try {
      const result = await AIProviderService.generateImage({
        featureSlug: "ai_food_image",
        tenantId: req.user?.tenantId ?? null,
        restaurantId,
        userId: req.user?.sub ?? null,
        metadata: { itemId, cuisine, ingredients, style: extraStyle },
      }, { prompt });

      const buffer = Buffer.from(result.b64_json, "base64");
      const contentType = result.mimeType || "image/png";

      const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg"
        : contentType.includes("webp") ? "webp" : "png";
      const filename = buildImageFilename(item.name, ext);
      const uploadURL = await objectStorage.getObjectEntityUploadURL();
      const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
      const put = await fetch(uploadURL, {
        method: "PUT",
        body: buffer,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `inline; filename="${filename}"`,
        },
      });
      if (!put.ok) {
        if (reservation) await refundReservation(reservation, "object storage put failed");
        req.log.error({ status: put.status }, "Upload to object storage failed");
        return void res.status(502).json({ error: "Failed to store generated image" });
      }
      const objectFile = await objectStorage.getObjectEntityFile(objectPath);
      await setObjectAclPolicy(objectFile, {
        restaurantId: String(restaurantId),
        uploaderId: req.user?.sub ? String(req.user.sub) : undefined,
        visibility: "public",
      });
      try {
        await objectFile.setMetadata({ contentDisposition: `inline; filename="${filename}"` });
      } catch {
        /* non-fatal */
      }

      const payload: PhotoDraftPayload = { imageUrl: objectPath };
      const [draft] = await db
        .insert(menuItemAiDraftsTable)
        .values({ menuItemId: itemId, restaurantId, kind: "photo", payload })
        .returning();
      await trimDrafts(itemId, "photo");
      if (reservation) await commitReservation({
        reservation,
        userId: req.user?.sub ?? null,
        requestLogId: result.requestLogId,
      });
      await recordAuditLog({
        req,
        module: "khana_ai",
        action: "ai_food_image.generate",
        entity: "menu_item",
        entityId: itemId,
        newValue: { source: "ai_generated", cuisine, ingredients, draftId: draft?.id, objectPath, requestLogId: result.requestLogId },
      });

      res.json({ draft, payload });
    } catch (error) {
      if (reservation) await refundReservation(reservation, (error as Error).message ?? "provider error");
      req.log.error({ err: error }, "AI photo generation failed");
      await recordAuditLog({
        req,
        module: "khana_ai",
        action: "ai_food_image.generate_failed",
        entity: "menu_item",
        entityId: itemId,
        newValue: { error: (error as Error).message ?? "provider error" },
      });
      res.status(502).json({ error: "Failed to generate photo" });
    }
  },
);

type NutritionDraftPayload = {
  calories: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  containsDairy: boolean | null;
  containsNuts: boolean | null;
  containsGluten: boolean | null;
  isVegan: boolean | null;
  isJain: boolean | null;
  spicyLevel: number | null;
  notes: string | null;
};

const NUTRITION_PROMPT_FIELDS = `{
  "calories": "integer kcal per serving (typical restaurant portion), or null if unsure",
  "proteinG": "grams of protein per serving (number), or null",
  "fatG": "grams of fat per serving (number), or null",
  "carbsG": "grams of carbohydrates per serving (number), or null",
  "containsDairy": "true | false — does this typically contain dairy (milk, cream, butter, cheese, ghee, yoghurt)",
  "containsNuts": "true | false — does this typically contain tree nuts or peanuts",
  "containsGluten": "true | false — does this typically contain gluten (wheat, barley, rye)",
  "isVegan": "true | false — strictly vegan (no dairy, eggs, honey, animal products)",
  "isJain": "true | false — Jain-friendly (no onion, garlic, root vegetables, plus vegetarian)",
  "spicyLevel": "integer 0-3 (0 = not spicy, 1 = mild, 2 = medium, 3 = hot)",
  "notes": "1-sentence caveat for the owner, e.g. 'estimate assumes ghee — swap to oil for vegan'"
}`;

function buildNutritionPrompt(name: string, category: string | null, isVeg: boolean, description: string | null): string {
  const dietHint = isVeg ? "vegetarian" : "non-vegetarian (may contain meat, seafood or eggs)";
  return `You are a food scientist helping a restaurant fill in nutrition + allergen data for a dish.

Dish name: ${name}
Category: ${category ?? "Uncategorised"}
Diet hint: ${dietHint}
${description ? `Description: ${description}\n` : ""}
Estimate values for a single typical restaurant serving. Be conservative — when unsure about an allergen, set it to true (safer to over-flag than under-flag). Round grams to whole numbers.

Return ONLY a JSON object with these fields:
${NUTRITION_PROMPT_FIELDS}

Rules: respond with JSON only, no prose, no markdown fence.`;
}

function parseNutritionResponse(data: Record<string, unknown>): NutritionDraftPayload {
  const num = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
  const spicy = num(data.spicyLevel);
  return {
    calories: num(data.calories) != null ? Math.round(num(data.calories)!) : null,
    proteinG: num(data.proteinG),
    fatG: num(data.fatG),
    carbsG: num(data.carbsG),
    containsDairy: bool(data.containsDairy),
    containsNuts: bool(data.containsNuts),
    containsGluten: bool(data.containsGluten),
    isVegan: bool(data.isVegan),
    isJain: bool(data.isJain),
    spicyLevel: spicy != null ? Math.max(0, Math.min(3, Math.round(spicy))) : null,
    notes: typeof data.notes === "string" && data.notes.trim() ? data.notes.trim().slice(0, 240) : null,
  };
}

async function generateNutritionForItem(
  restaurantId: number,
  itemId: number,
  userId: number | null,
  tenantId: number | null,
  metaExtra: Record<string, unknown> = {},
): Promise<{ payload: NutritionDraftPayload; requestLogId: number | null } | { error: string }> {
  const [item] = await db
    .select({
      id: menuItemsTable.id,
      name: menuItemsTable.name,
      isVeg: menuItemsTable.isVeg,
      description: menuItemsTable.description,
      categoryName: menuCategoriesTable.name,
    })
    .from(menuItemsTable)
    .leftJoin(menuCategoriesTable, eq(menuItemsTable.categoryId, menuCategoriesTable.id))
    .where(and(eq(menuItemsTable.id, itemId), eq(menuItemsTable.restaurantId, restaurantId)));
  if (!item) return { error: "Item not found" };

  const prompt = buildNutritionPrompt(item.name, item.categoryName, !!item.isVeg, item.description);
  const { data, result } = await AIProviderService.generateJson<Record<string, unknown>>({
    featureSlug: "ai_nutrition",
    tenantId,
    restaurantId,
    userId,
    metadata: { itemId, ...metaExtra },
  }, {
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    maxTokens: 500,
  });
  return { payload: parseNutritionResponse(data), requestLogId: result.requestLogId ?? null };
}

router.post(
  "/restaurants/:restaurantId/items/:itemId/ai-nutrition",
  requireAiCredits("ai_nutrition", () => ({ units: 1 })),
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const itemId = Number(req.params.itemId);
    const reservation = res.locals.aiCreditReservation as AiCreditReservation | null;

    try {
      const out = await generateNutritionForItem(
        restaurantId,
        itemId,
        req.user?.sub ?? null,
        req.user?.tenantId ?? null,
      );
      if ("error" in out) {
        if (reservation) await refundReservation(reservation, out.error);
        return void res.status(404).json({ error: out.error });
      }

      const [draft] = await db
        .insert(menuItemAiDraftsTable)
        .values({ menuItemId: itemId, restaurantId, kind: "nutrition", payload: out.payload })
        .returning();
      await trimDrafts(itemId, "nutrition");

      if (reservation) await commitReservation({
        reservation,
        userId: req.user?.sub ?? null,
        requestLogId: out.requestLogId,
      });
      await recordAuditLog({
        req,
        module: "khana_ai",
        action: "ai_nutrition.generate",
        entity: "menu_item",
        entityId: itemId,
        newValue: { draftId: draft?.id, requestLogId: out.requestLogId },
      });

      res.json({ draft, payload: out.payload });
    } catch (error) {
      if (reservation) await refundReservation(reservation, (error as Error).message ?? "provider error");
      req.log.error({ err: error }, "AI nutrition generation failed");
      await recordAuditLog({
        req,
        module: "khana_ai",
        action: "ai_nutrition.generate_failed",
        entity: "menu_item",
        entityId: itemId,
        newValue: { error: (error as Error).message ?? "provider error" },
      });
      res.status(502).json({ error: "Failed to generate nutrition" });
    }
  },
);

// Bulk generation. Reserves + commits credits PER ITEM so the wallet only
// gets charged for items that actually succeed. The middleware does cap +
// plan checks once with units=0, then we hand-roll per-item reservations
// inside the handler — keeping the credit ledger contract clean (no forged
// reservation casts, no partial-commit hacks).
router.post(
  "/restaurants/:restaurantId/items/ai-nutrition-bulk",
  requireAiCredits("ai_nutrition", () => ({ units: 0 })),
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const tenantId = req.user?.tenantId ?? null;
    const itemIds = Array.isArray((req.body as { itemIds?: unknown[] })?.itemIds)
      ? (req.body as { itemIds: unknown[] }).itemIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    if (itemIds.length === 0) {
      return void res.status(400).json({ error: "itemIds is required" });
    }
    if (itemIds.length > 50) {
      return void res.status(400).json({ error: "Max 50 items per bulk request" });
    }

    type RowResult = { itemId: number; status: "ok" | "error"; draftId?: number; payload?: NutritionDraftPayload; error?: string };
    const results: RowResult[] = [];
    let successCount = 0;
    let chargedCredits = 0;

    for (const itemId of itemIds) {
      let perItemReservation: AiCreditReservation | null = null;
      // Per-item reservation: 1 credit each. Super-admins skip wallets.
      if (tenantId && !req.user?.isSuperAdmin) {
        try {
          perItemReservation = await reserveCredits({
            tenantId,
            featureSlug: "ai_nutrition",
            credits: 1,
            meta: { itemId, bulk: true },
          });
        } catch (err) {
          const e = err as { code?: string };
          results.push({ itemId, status: "error", error: e.code === "INSUFFICIENT_CREDITS" ? "Out of credits" : "Reservation failed" });
          continue;
        }
      }
      try {
        const out = await generateNutritionForItem(
          restaurantId,
          itemId,
          req.user?.sub ?? null,
          tenantId,
          { bulk: true },
        );
        if ("error" in out) {
          if (perItemReservation) await refundReservation(perItemReservation, out.error);
          results.push({ itemId, status: "error", error: out.error });
          continue;
        }
        const [draft] = await db
          .insert(menuItemAiDraftsTable)
          .values({ menuItemId: itemId, restaurantId, kind: "nutrition", payload: out.payload })
          .returning();
        await trimDrafts(itemId, "nutrition");
        if (perItemReservation) {
          await commitReservation({
            reservation: perItemReservation,
            userId: req.user?.sub ?? null,
            requestLogId: out.requestLogId,
          });
          chargedCredits += perItemReservation.reservedCredits;
        }
        successCount++;
        results.push({ itemId, status: "ok", draftId: draft?.id, payload: out.payload });
      } catch (e) {
        if (perItemReservation) await refundReservation(perItemReservation, (e as Error).message ?? "provider error");
        results.push({ itemId, status: "error", error: (e as Error).message ?? "provider error" });
      }
    }

    await recordAuditLog({
      req,
      module: "khana_ai",
      action: "ai_nutrition.bulk_generate",
      entity: "menu_items",
      entityId: null,
      newValue: { restaurantId, attempted: itemIds.length, succeeded: successCount, chargedCredits },
    });

    res.json({ results, summary: { attempted: itemIds.length, succeeded: successCount, failed: itemIds.length - successCount, chargedCredits } });
  },
);

router.get(
  "/restaurants/:restaurantId/items/:itemId/ai-drafts",
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const itemId = Number(req.params.itemId);
    const item = await loadItemWithCategory(restaurantId, itemId);
    if (!item) return void res.status(404).json({ error: "Item not found" });

    const rows = await db
      .select()
      .from(menuItemAiDraftsTable)
      .where(eq(menuItemAiDraftsTable.menuItemId, itemId))
      .orderBy(desc(menuItemAiDraftsTable.createdAt));

    const description = rows.filter((r) => r.kind === "description").slice(0, 3);
    const photo = rows.filter((r) => r.kind === "photo").slice(0, 3);
    const nutrition = rows.filter((r) => r.kind === "nutrition").slice(0, 3);
    res.json({ description, photo, nutrition });
  },
);

export default router;
