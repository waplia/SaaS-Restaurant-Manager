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
import { requireAiCredits, commitReservation, refundReservation, type AiCreditReservation } from "../lib/aiCredits";
import { ObjectStorageService } from "../lib/objectStorage";
import { setObjectAclPolicy } from "../lib/objectAcl";
import { recordAuditLog } from "../lib/audit";

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

      const uploadURL = await objectStorage.getObjectEntityUploadURL();
      const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
      const put = await fetch(uploadURL, {
        method: "PUT",
        body: buffer,
        headers: { "Content-Type": contentType },
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
    res.json({ description, photo });
  },
);

export default router;
