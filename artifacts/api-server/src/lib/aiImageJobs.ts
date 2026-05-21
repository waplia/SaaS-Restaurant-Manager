/**
 * Background runner for bulk AI image generation jobs created by super-admins.
 * Each job specifies a provider/style and a list of dish prompts; the runner
 * generates one image per dish and inserts an approved row into stock_food_images
 * tagged with the originating job id.
 *
 * Provider gating: super-admin AI generation is treated as a system credit
 * (no tenant wallet); the runner calls the image provider directly via
 * AIProviderService without going through the per-tenant credit gate.
 */
import { eq, sql } from "drizzle-orm";
import {
  db,
  imageGenerationJobsTable,
  stockFoodImagesTable,
  type ImageGenerationJob,
} from "./db";
import { AIProviderService } from "./aiProviderService";
import { ObjectStorageService, isObjectStorageConfigured } from "./objectStorage";
import { setObjectAclPolicy } from "./objectAcl";
import { buildImageFilename } from "./aiFoodImage";
import { slugifyName, invalidateStockFoodCache } from "./stockFoodImages";
import { logger } from "./logger";

const objectStorage = new ObjectStorageService();

export interface AiJobItemInput {
  name: string;
  cuisine?: string | null;
  category?: string | null;
  mealType?: string | null;
  dietaryType?: string | null;
  isVeg?: boolean;
  spiceLevel?: number | null;
  aliases?: string[];
  tags?: string[];
  /** Optional per-item prompt override. */
  prompt?: string;
}

export interface AiJobItemState extends AiJobItemInput {
  status: "pending" | "running" | "done" | "failed" | "skipped";
  stockImageId?: number | null;
  error?: string | null;
}

function buildPrompt(item: AiJobItemInput, style: string | null, jobPrompt: string | null): string {
  if (item.prompt) return item.prompt;
  const styleHint = item.isVeg === false ? "" : "vegetarian";
  const parts: string[] = [
    `Professional overhead food photograph of ${item.name}`,
  ];
  if (item.category) parts.push(`a ${item.category.toLowerCase()} dish`);
  if (item.cuisine) parts.push(`${item.cuisine} cuisine`);
  if (styleHint) parts.push(styleHint);
  const extra = (style || jobPrompt || "Restaurant menu style, square crop, natural daylight, plated on a neutral ceramic dish on a wooden table, garnished tastefully, vibrant colours, photorealistic").trim();
  return `${parts.join(", ")}. ${extra}, no text, no logo, no watermark.`;
}

/**
 * Process one job to completion. Updates done/failed counters and items[]
 * state as each dish completes. Inserts approved stock_food_images rows.
 */
export async function runImageGenerationJob(jobId: number): Promise<void> {
  const [job] = await db.select().from(imageGenerationJobsTable).where(eq(imageGenerationJobsTable.id, jobId));
  if (!job) {
    logger.warn({ jobId }, "runImageGenerationJob: not found");
    return;
  }
  if (job.status !== "pending" && job.status !== "running") {
    logger.info({ jobId, status: job.status }, "job already terminal — skipping");
    return;
  }
  if (!isObjectStorageConfigured()) {
    await db.update(imageGenerationJobsTable).set({
      status: "failed", errorMessage: "Object storage not configured", completedAt: new Date(), updatedAt: new Date(),
    }).where(eq(imageGenerationJobsTable.id, jobId));
    return;
  }

  await db.update(imageGenerationJobsTable).set({
    status: "running", startedAt: new Date(), updatedAt: new Date(),
  }).where(eq(imageGenerationJobsTable.id, jobId));

  const items = (job.items as AiJobItemState[]) ?? [];
  let done = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.status === "done" || item.status === "skipped") { done++; continue; }
    item.status = "running";
    item.error = null;
    await persistItems(jobId, items, done, failed);

    try {
      const prompt = buildPrompt(item, job.style, job.prompt);
      const result = await AIProviderService.generateImage(
        {
          featureSlug: "ai_food_image",
          tenantId: null,
          restaurantId: null,
          userId: job.createdBy ?? null,
          metadata: { jobId, name: item.name, provider: job.provider },
        },
        { prompt },
      );

      const buffer = Buffer.from(result.b64_json, "base64");
      const contentType = result.mimeType || "image/png";
      const ext = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
      const filename = buildImageFilename(item.name, ext);

      const uploadURL = await objectStorage.getObjectEntityUploadURL();
      const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
      const put = await fetch(uploadURL, {
        method: "PUT", body: buffer,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
      if (!put.ok) throw new Error(`PUT ${put.status}`);

      const objectFile = await objectStorage.getObjectEntityFile(objectPath);
      await setObjectAclPolicy(objectFile, { restaurantId: "system", visibility: "public" });

      const wildcardPath = objectPath.replace(/^\/objects\//, "");
      const publicUrl = `/api/public/storage/objects/${wildcardPath}`;

      // Pick a slug that doesn't collide with an existing one.
      let slug = slugifyName(item.name);
      const [clash] = await db.select({ id: stockFoodImagesTable.id })
        .from(stockFoodImagesTable).where(eq(stockFoodImagesTable.slug, slug));
      if (clash) slug = `${slug}-${Date.now().toString(36).slice(-5)}`;

      const [row] = await db.insert(stockFoodImagesTable).values({
        slug,
        name: item.name,
        cuisine: item.cuisine ?? null,
        category: item.category ?? item.mealType ?? null,
        imageUrl: publicUrl,
        thumbnailUrl: null,
        aliases: item.aliases ?? [],
        tags: item.tags ?? [],
        isVeg: item.isVeg ?? (item.dietaryType !== "non-veg" && item.dietaryType !== "egg"),
        isActive: true,
        sortOrder: 0,
        attribution: `AI generated via ${job.provider}`,
        source: "ai_bulk",
        dietaryType: item.dietaryType ?? null,
        mealType: item.mealType ?? item.category ?? null,
        spiceLevel: item.spiceLevel ?? null,
        provider: job.provider,
        model: job.model ?? null,
        licenseStatus: "approved",
        isApproved: true,
        isFeatured: false,
        generationJobId: jobId,
        createdBy: job.createdBy ?? null,
      }).returning({ id: stockFoodImagesTable.id });

      item.status = "done";
      item.stockImageId = row.id;
      done++;
    } catch (err) {
      item.status = "failed";
      item.error = ((err as Error).message ?? "unknown").slice(0, 500);
      failed++;
      logger.warn({ err, jobId, name: item.name }, "AI image job: item failed");
    }
    await persistItems(jobId, items, done, failed);
  }

  invalidateStockFoodCache();
  await db.update(imageGenerationJobsTable).set({
    status: failed === items.length ? "failed" : "completed",
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(imageGenerationJobsTable.id, jobId));
}

async function persistItems(jobId: number, items: AiJobItemState[], done: number, failed: number): Promise<void> {
  await db.update(imageGenerationJobsTable).set({
    items: items as unknown as Record<string, unknown>[],
    doneItems: done,
    failedItems: failed,
    updatedAt: new Date(),
  }).where(eq(imageGenerationJobsTable.id, jobId));
}

export type { ImageGenerationJob };
