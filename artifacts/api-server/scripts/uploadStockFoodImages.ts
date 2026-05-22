/**
 * One-shot importer for AI-generated stock food images.
 *
 * Reads PNG files from `attached_assets/generated_images/stock-food/` plus
 * the sibling `_manifest.json` produced by the agent's image-generation
 * batch. For each entry, it:
 *   1. Skips if a row with the same slug already exists.
 *   2. Uploads the PNG to Replit Object Storage via the same presigned-URL
 *      flow used by the AI bulk-generation job (sets a `public` ACL).
 *   3. Inserts an approved, active row into `stock_food_images` with
 *      cuisine=north-indian, dietaryType=veg, isVeg=true, source=ai_bulk.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx scripts/uploadStockFoodImages.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import {
  db,
  stockFoodImagesTable,
} from "../src/lib/db";
import {
  ObjectStorageService,
  isObjectStorageConfigured,
} from "../src/lib/objectStorage";
import { setObjectAclPolicy } from "../src/lib/objectAcl";
import {
  invalidateStockFoodCache,
  slugifyName,
} from "../src/lib/stockFoodImages";

interface ManifestEntry {
  name: string;
  category: string;
  hint: string;
  slug: string;
  file: string;
  /** Optional cuisine override; defaults to north-indian for backwards compat. */
  cuisine?: string;
  /** Optional veg flag; defaults to true. */
  isVeg?: boolean;
}

// Resolve relative to *this script file* (not cwd) so the importer can be
// invoked from any directory — `tsx scripts/uploadStockFoodImages.ts` from
// the api-server package, or `pnpm --filter ... exec tsx` from the repo root,
// or directly via an absolute path. Falls back to a CLI override if provided.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_MANIFEST = process.argv.slice(2).find((a) => a.startsWith("--manifest="));
const MANIFEST_PATH = CLI_MANIFEST
  ? path.resolve(CLI_MANIFEST.slice("--manifest=".length))
  : path.resolve(
      __dirname,
      "../../../attached_assets/generated_images/stock-food/_manifest.json",
    );

async function main(): Promise<void> {
  if (!isObjectStorageConfigured()) {
    throw new Error("Object storage not configured (PRIVATE_OBJECT_DIR / PUBLIC_OBJECT_SEARCH_PATHS).");
  }
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Manifest not found: ${MANIFEST_PATH}`);
  }
  const manifest: ManifestEntry[] = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const baseDir = path.dirname(MANIFEST_PATH);
  const svc = new ObjectStorageService();

  let inserted = 0;
  let skipped = 0;
  let missing = 0;
  let failed = 0;

  for (const entry of manifest) {
    const slug = slugifyName(entry.slug || entry.name);
    const existing = await db
      .select({ id: stockFoodImagesTable.id })
      .from(stockFoodImagesTable)
      .where(eq(stockFoodImagesTable.slug, slug));
    if (existing.length > 0) {
      skipped++;
      console.log(`skip   ${slug} (already in library)`);
      continue;
    }

    const pngPath = path.join(baseDir, entry.file);
    if (!fs.existsSync(pngPath)) {
      missing++;
      console.warn(`miss   ${slug} (no PNG at ${pngPath})`);
      continue;
    }

    try {
      const buf = fs.readFileSync(pngPath);
      const uploadURL = await svc.getObjectEntityUploadURL();
      const objectPath = svc.normalizeObjectEntityPath(uploadURL);
      const put = await fetch(uploadURL, {
        method: "PUT",
        body: buf,
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `attachment; filename="${slug}.png"`,
        },
      });
      if (!put.ok) throw new Error(`upload PUT ${put.status}`);

      const objectFile = await svc.getObjectEntityFile(objectPath);
      await setObjectAclPolicy(objectFile, {
        restaurantId: "system",
        visibility: "public",
      });

      const wildcardPath = objectPath.replace(/^\/objects\//, "");
      const publicUrl = `/api/public/storage/objects/${wildcardPath}`;

      const cuisine = entry.cuisine ?? "north-indian";
      const isVeg = entry.isVeg ?? true;
      await db.insert(stockFoodImagesTable).values({
        slug,
        name: entry.name,
        cuisine,
        category: entry.category,
        imageUrl: publicUrl,
        thumbnailUrl: null,
        aliases: [],
        tags: [cuisine, isVeg ? "veg" : "non-veg", entry.category],
        isVeg,
        isActive: true,
        sortOrder: 0,
        attribution: "AI generated",
        source: "ai_bulk",
        dietaryType: isVeg ? "veg" : "non-veg",
        mealType: entry.category,
        spiceLevel: null,
        provider: "google-imagen",
        model: null,
        licenseStatus: "approved",
        isApproved: true,
        isFeatured: false,
        generationJobId: null,
        createdBy: null,
      });
      inserted++;
      console.log(`ok     ${slug}  ->  ${publicUrl}`);
    } catch (err) {
      failed++;
      console.error(`FAIL   ${slug}: ${(err as Error).message}`);
    }
  }

  invalidateStockFoodCache();
  console.log(`\nDone. inserted=${inserted} skipped=${skipped} missing=${missing} failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
