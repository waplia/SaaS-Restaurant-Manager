/**
 * Shared AI food-image generator used by:
 *   - POST /restaurants/:id/items/:itemId/ai-photo (creates a *draft* the
 *     user can accept on the menu item screen).
 *   - The /ai/menu-import/.../save flow (writes the generated image
 *     directly onto the freshly-created item's image_url so imports come
 *     back fully illustrated).
 *
 * Handles credit reservation/commit/refund, calls AIProviderService.generateImage,
 * uploads to object storage with a human-readable filename, and tags the GCS
 * object with the tenant's ACL policy.
 */
import { eq } from "drizzle-orm";
import { db, menuItemsTable } from "./db";
import { AIProviderService } from "./aiProviderService";
import {
  commitReservation,
  refundReservation,
  gatePublicAiCall,
  type AiCreditReservation,
} from "./aiCredits";
import { ObjectStorageService, isObjectStorageConfigured } from "./objectStorage";
import { setObjectAclPolicy } from "./objectAcl";
import { normalizeStoredImageUrl } from "./imageUrl";

const objectStorage = new ObjectStorageService();

export interface FoodImageInputs {
  name: string;
  categoryName?: string | null;
  isVeg?: boolean | null;
  cuisine?: string | null;
  ingredients?: string | null;
  style?: string | null;
}

export interface FoodImageResult {
  objectPath: string;
  filename: string;
  requestLogId?: number | null;
}

/**
 * Build a kebab-case, ASCII-safe slug from an item name. Suffixed with a short
 * random token so two items with the same name don't collide.
 */
export function buildImageFilename(name: string, ext: string = "png"): string {
  const slug = (name || "menu-item")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "menu-item";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${slug}-${suffix}.${ext}`;
}

function buildPrompt(inputs: FoodImageInputs): string {
  const styleHint = inputs.isVeg ? "vegetarian" : "";
  const cat = inputs.categoryName?.trim();
  const cuisine = inputs.cuisine?.trim();
  const ing = inputs.ingredients?.trim();
  const extra = inputs.style?.trim();
  return `Professional overhead food photograph of ${inputs.name}` +
    `${cat ? `, a ${cat.toLowerCase()} dish` : ""}` +
    `${cuisine ? `, ${cuisine} cuisine` : ""}` +
    `${styleHint ? `, ${styleHint}` : ""}` +
    `${ing ? `, with ${ing}` : ""}. ` +
    `${extra || "Restaurant menu style, square crop, natural daylight, shallow depth of field, plated on a neutral ceramic dish on a wooden table, garnished tastefully, vibrant colours, photorealistic"}, no text, no logo, no watermark.`;
}

/**
 * Generate one food image and upload it. Handles credit reservation +
 * commit/refund. Returns the canonical object path (suitable for
 * menu_items.image_url) and the human-readable filename.
 *
 * Throws on any failure (caller decides whether to surface or skip).
 */
export async function generateFoodImage(opts: {
  tenantId: number | null;
  restaurantId: number;
  userId: number | null;
  inputs: FoodImageInputs;
  /**
   * Optional pre-existing reservation from `requireAiCredits` middleware.
   * When provided, the helper will NOT reserve credits again — it just
   * commits/refunds the passed-in reservation. This lets HTTP routes keep
   * the full plan/feature/cap/quota/super-admin checks that
   * `requireAiCredits` performs, while the menu-import background backfill
   * (which has no middleware in front of it) can fall back to the simpler
   * internal `reserveCredits` path.
   */
  existingReservation?: AiCreditReservation | null;
  /**
   * Set to true when the HTTP route already ran `requireAiCredits`
   * middleware. In that case, do NOT auto-reserve here: the middleware
   * may have intentionally returned a null reservation (super-admin
   * bypass, free-quota path, etc.) and we must respect that decision.
   */
  creditsAlreadyHandled?: boolean;
  source?: string;
}): Promise<FoodImageResult> {
  if (!isObjectStorageConfigured()) {
    throw new Error("Object storage is not configured");
  }

  // When called outside the requireAiCredits middleware (e.g. menu-import
  // background backfill) we run the same plan / feature-toggle / daily +
  // monthly cap / credit-rule resolution that the HTTP path enforces, via
  // `gatePublicAiCall`. This ensures identical accounting semantics — not a
  // hardcoded 1-credit reservation that would bypass policy.
  let reservation: AiCreditReservation | null = opts.existingReservation ?? null;
  if (!reservation && !opts.creditsAlreadyHandled && opts.tenantId != null) {
    const gate = await gatePublicAiCall({
      tenantId: opts.tenantId,
      featureSlug: "ai_food_image",
      units: 1,
      meta: { source: opts.source ?? "menu_import_auto", restaurantId: opts.restaurantId, itemName: opts.inputs.name },
    });
    if (!gate.ok) {
      // Map gate reasons onto the error.code shape that callers
      // (generateAndAttachItemPhoto / menu-imports) already branch on so
      // "insufficient_credits" continues to surface as INSUFFICIENT_CREDITS
      // (=> imageStatus: skipped_credits) and other policy denials surface
      // distinctly without being miscategorised as a generation failure.
      const codeMap: Record<string, string> = {
        insufficient_credits: "INSUFFICIENT_CREDITS",
        ai_not_in_plan: "AI_NOT_IN_PLAN",
        ai_feature_disabled: "AI_FEATURE_DISABLED",
        daily_cap_reached: "DAILY_CAP_REACHED",
        feature_cap_reached: "FEATURE_CAP_REACHED",
        no_credit_rule: "NO_CREDIT_RULE",
        tenant_suspended: "TENANT_SUSPENDED",
        wallet_blocked: "WALLET_BLOCKED",
        wallet_error: "WALLET_ERROR",
      };
      throw Object.assign(new Error(`ai_food_image gate denied: ${gate.reason}`), {
        code: codeMap[gate.reason] ?? "AI_GATE_DENIED",
      });
    }
    reservation = gate.reservation;
  }

  try {
    const result = await AIProviderService.generateImage(
      {
        featureSlug: "ai_food_image",
        tenantId: opts.tenantId,
        restaurantId: opts.restaurantId,
        userId: opts.userId,
        metadata: { itemName: opts.inputs.name, cuisine: opts.inputs.cuisine, ingredients: opts.inputs.ingredients },
      },
      { prompt: buildPrompt(opts.inputs) },
    );

    const buffer = Buffer.from(result.b64_json, "base64");
    const contentType = result.mimeType || "image/png";
    const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg"
      : contentType.includes("webp") ? "webp" : "png";
    const filename = buildImageFilename(opts.inputs.name, ext);

    const uploadURL = await objectStorage.getObjectEntityUploadURL();
    const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);

    const put = await fetch(uploadURL, {
      method: "PUT",
      body: buffer,
      headers: {
        "Content-Type": contentType,
        // Restaurant owners downloading the asset get a readable filename
        // (e.g. "paneer-tikka-7gk2qa.png") instead of the UUID object key.
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
    if (!put.ok) {
      throw new Error(`Object storage PUT failed with status ${put.status}`);
    }

    const objectFile = await objectStorage.getObjectEntityFile(objectPath);
    await setObjectAclPolicy(objectFile, {
      restaurantId: String(opts.restaurantId),
      uploaderId: opts.userId != null ? String(opts.userId) : undefined,
      visibility: "public",
    });
    // Persist the human-readable filename on the object metadata so any
    // subsequent download surfaces the correct name.
    try {
      await objectFile.setMetadata({ contentDisposition: `attachment; filename="${filename}"` });
    } catch {
      /* non-fatal — filename also baked into upload PUT above */
    }

    if (reservation) {
      await commitReservation({
        reservation,
        userId: opts.userId,
        requestLogId: result.requestLogId,
      });
    }

    return { objectPath, filename, requestLogId: result.requestLogId };
  } catch (err) {
    if (reservation) {
      await refundReservation(reservation, (err as Error).message ?? "image generation failed");
    }
    throw err;
  }
}

/**
 * Convenience wrapper used by the menu-import save flow: generates an image
 * and writes the resulting object path to menu_items.image_url for the given
 * item id. Returns true on success, false on any failure (caller logs).
 */
export async function generateAndAttachItemPhoto(opts: {
  tenantId: number | null;
  restaurantId: number;
  userId: number | null;
  itemId: number;
  inputs: FoodImageInputs;
}): Promise<{ ok: true; objectPath: string; filename: string } | { ok: false; reason: string; code?: string }> {
  try {
    const { objectPath, filename } = await generateFoodImage(opts);
    // Important: do NOT bump updatedAt here. The rollback flow treats any
    // menu_items.updatedAt strictly later than savedAt as a user edit and
    // refuses to delete the row. A system-generated photo backfill must
    // not lock the import out of rollback. We also require .returning() so
    // we can detect the row vanishing mid-backfill (race with rollback)
    // and surface it as a failure instead of falsely reporting success.
    const storedImageUrl = normalizeStoredImageUrl(objectPath) ?? objectPath;
    const updated = await db.update(menuItemsTable)
      .set({ imageUrl: storedImageUrl })
      .where(eq(menuItemsTable.id, opts.itemId))
      .returning({ id: menuItemsTable.id });
    if (updated.length === 0) {
      return { ok: false, reason: "menu item no longer exists", code: "ITEM_GONE" };
    }
    // Best-effort usage analytics — never throws.
    try {
      const { recordLibraryImageUsage } = await import("./stockFoodImages");
      await recordLibraryImageUsage({
        restaurantId: opts.restaurantId,
        menuItemId: opts.itemId,
        libraryImageId: null,
        imageUrl: storedImageUrl,
        source: "menu_import_ai",
        attachedBy: opts.userId,
      });
    } catch { /* swallow */ }
    return { ok: true, objectPath, filename };
  } catch (err) {
    const e = err as Error & { code?: string };
    return { ok: false, reason: e.message ?? "unknown error", code: e.code };
  }
}
