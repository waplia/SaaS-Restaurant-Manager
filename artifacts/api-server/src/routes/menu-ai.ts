import { Router, type Request, type Response } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db, menuItemsTable, menuCategoriesTable, menuItemAiDraftsTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { generateImage } from "@workspace/integrations-gemini-ai/image";
import { ObjectStorageService } from "../lib/objectStorage";
import { setObjectAclPolicy } from "../lib/objectAcl";

const router = Router();
const objectStorage = new ObjectStorageService();

router.use(
  "/restaurants/:restaurantId/items/:itemId/ai-:rest",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("ai_menu_drafts"),
);
router.use(
  "/restaurants/:restaurantId/items/:itemId/ai-drafts",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("ai_menu_drafts"),
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
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const itemId = Number(req.params.itemId);
    const item = await loadItemWithCategory(restaurantId, itemId);
    if (!item) return void res.status(404).json({ error: "Item not found" });

    const dietHint = item.isVeg ? "vegetarian" : "non-vegetarian (may contain meat or seafood)";
    const prompt = `You are helping a restaurant write its menu copy. Generate JSON for this dish.

Dish name: ${item.name}
Category: ${item.categoryName ?? "Uncategorised"}
Diet hint: ${dietHint}

Return ONLY a JSON object with these fields:
{
  "description": "1-2 appetising sentences (max 240 characters), evocative but factual",
  "allergens": ["common allergens that this dish typically contains, lowercase, e.g. dairy, gluten, nuts, eggs, soy, shellfish, fish, sesame"],
  "tags": ["short dietary or style tags, lowercase, e.g. spicy, popular, vegan, gluten-free, contains-nuts, kids-friendly, signature"]
}

Rules: respond with JSON only, no prose, no markdown fence. Keep allergens and tags arrays to at most 6 items each. If unsure about an allergen, omit it.`;

    try {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });
      const block = message.content[0];
      const raw = block && block.type === "text" ? block.text : "";
      const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      let parsed: DescriptionDraftPayload;
      try {
        const obj = JSON.parse(cleaned);
        parsed = {
          description: typeof obj.description === "string" ? obj.description.trim() : "",
          allergens: Array.isArray(obj.allergens)
            ? obj.allergens.map((s: unknown) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 6)
            : [],
          tags: Array.isArray(obj.tags)
            ? obj.tags.map((s: unknown) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 6)
            : [],
        };
      } catch {
        return void res.status(502).json({ error: "AI returned invalid JSON" });
      }
      if (!parsed.description) {
        return void res.status(502).json({ error: "AI returned an empty description" });
      }

      const [draft] = await db
        .insert(menuItemAiDraftsTable)
        .values({ menuItemId: itemId, restaurantId, kind: "description", payload: parsed })
        .returning();
      await trimDrafts(itemId, "description");

      res.json({ draft, payload: parsed });
    } catch (error) {
      req.log.error({ err: error }, "AI description generation failed");
      res.status(502).json({ error: "Failed to generate description" });
    }
  },
);

router.post(
  "/restaurants/:restaurantId/items/:itemId/ai-photo",
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const itemId = Number(req.params.itemId);
    const item = await loadItemWithCategory(restaurantId, itemId);
    if (!item) return void res.status(404).json({ error: "Item not found" });

    const styleHint = item.isVeg ? "vegetarian" : "";
    const prompt = `Professional overhead food photograph of ${item.name}${item.categoryName ? `, a ${item.categoryName.toLowerCase()} dish` : ""}${styleHint ? `, ${styleHint}` : ""}. Restaurant menu style, square crop, natural daylight, shallow depth of field, plated on a neutral ceramic dish on a wooden table, garnished tastefully, vibrant colours, photorealistic, no text, no logo, no watermark.`;

    try {
      const { b64_json, mimeType } = await generateImage(prompt);
      const buffer = Buffer.from(b64_json, "base64");
      const contentType = mimeType || "image/png";

      const uploadURL = await objectStorage.getObjectEntityUploadURL();
      const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
      const put = await fetch(uploadURL, {
        method: "PUT",
        body: buffer,
        headers: { "Content-Type": contentType },
      });
      if (!put.ok) {
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

      res.json({ draft, payload });
    } catch (error) {
      req.log.error({ err: error }, "AI photo generation failed");
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
