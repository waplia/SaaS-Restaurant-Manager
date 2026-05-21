/**
 * Curated stock food image library — helpers for normalization, fuzzy
 * matching, in-process caching, and idempotent seeding of the default
 * Indian-cuisine catalog.
 *
 * Used by:
 *   - super-admin CRUD routes (artifacts/api-server/src/routes/stock-food-images.ts)
 *   - the tenant-facing picker (same router, read-only endpoints)
 *   - menu-import auto-attach (writes a library URL onto a freshly-saved
 *     menu_item BEFORE falling back to AI photo generation, saving credits)
 *
 * Approval gate: matchers and the tenant picker only ever surface rows
 * where `is_approved = true AND is_active = true`. Super-admin endpoints
 * see the full set.
 */
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  stockFoodImagesTable,
  restaurantMenuItemImagesTable,
  type StockFoodImage,
  type InsertStockFoodImage,
} from "./db";
import { logger } from "./logger";
import { STOCK_FOOD_IMAGE_SEED } from "./stockFoodImagesSeed";

/**
 * Lowercase + strip accents + collapse non-alphanumeric to a single space.
 * Used both as the key for slug generation and as the basis for matching.
 */
export function normalizeName(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function slugifyName(s: string): string {
  return normalizeName(s).replace(/\s+/g, "-") || "untitled";
}

const STOP_TOKENS = new Set([
  "the", "a", "an", "of", "with", "and", "in", "on", "for",
  "style", "special", "fresh", "homemade", "house", "classic",
  "deluxe", "premium", "extra", "regular", "small", "medium", "large",
  "veg", "non", "nonveg", "non-veg", "veggie",
  "platter", "plate", "bowl", "serving",
]);

export function tokenize(s: string): string[] {
  const n = normalizeName(s);
  if (!n) return [];
  return n.split(" ").filter(t => t.length >= 2 && !STOP_TOKENS.has(t));
}

// ─── In-process cache ─────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { rows: StockFoodImage[]; loadedAt: number } | null = null;

export function invalidateStockFoodCache(): void {
  cache = null;
}

async function loadApprovedCached(): Promise<StockFoodImage[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.rows;
  const rows = await db.select().from(stockFoodImagesTable)
    .where(and(eq(stockFoodImagesTable.isActive, true), eq(stockFoodImagesTable.isApproved, true)));
  cache = { rows, loadedAt: Date.now() };
  return rows;
}

export interface StockMatchInput {
  name: string;
  isVeg?: boolean | null;
  category?: string | null;
  cuisine?: string | null;
}

export interface StockMatchResult {
  row: StockFoodImage;
  score: number;
  matchedOn: "exact" | "alias" | "substring" | "tokens";
}

export async function findBestStockImageMatch(input: StockMatchInput): Promise<StockMatchResult | null> {
  const targetNorm = normalizeName(input.name);
  if (!targetNorm) return null;
  const targetTokens = new Set(tokenize(input.name));
  if (targetTokens.size === 0) return null;

  const rows = await loadApprovedCached();
  let best: StockMatchResult | null = null;

  for (const r of rows) {
    if (input.isVeg === true && r.isVeg === false) continue;

    const candidates: Array<{ text: string; isAlias: boolean }> = [
      { text: r.name, isAlias: false },
      ...((r.aliases ?? []).map((a) => ({ text: a, isAlias: true }))),
    ];

    let bestForRow: StockMatchResult | null = null;
    for (const c of candidates) {
      const cNorm = normalizeName(c.text);
      if (!cNorm) continue;

      let score = 0;
      let matchedOn: StockMatchResult["matchedOn"] = "tokens";
      if (cNorm === targetNorm) {
        score = 1.0;
        matchedOn = c.isAlias ? "alias" : "exact";
      } else if (cNorm.includes(targetNorm) || targetNorm.includes(cNorm)) {
        score = 0.85;
        matchedOn = "substring";
      } else {
        const cTokens = new Set(tokenize(c.text));
        if (cTokens.size === 0) continue;
        const inter = [...targetTokens].filter((t) => cTokens.has(t)).length;
        if (inter === 0) continue;
        const union = new Set([...targetTokens, ...cTokens]).size;
        score = inter / union;
        matchedOn = "tokens";
      }
      if (!bestForRow || score > bestForRow.score) {
        bestForRow = { row: r, score, matchedOn };
      }
    }
    if (bestForRow && bestForRow.score >= 0.6 && (!best || bestForRow.score > best.score)) {
      best = bestForRow;
    }
  }
  return best;
}

/**
 * Return up to N approved library matches above the confidence floor — for
 * the picker's "Suggestions for this dish" strip. Sorted by score descending.
 */
export async function findStockImageSuggestions(input: StockMatchInput, limit = 6): Promise<StockMatchResult[]> {
  const targetNorm = normalizeName(input.name);
  if (!targetNorm) return [];
  const targetTokens = new Set(tokenize(input.name));
  if (targetTokens.size === 0) return [];
  const rows = await loadApprovedCached();
  const out: StockMatchResult[] = [];
  for (const r of rows) {
    if (input.isVeg === true && r.isVeg === false) continue;
    const candidates = [r.name, ...(r.aliases ?? [])];
    let bestScore = 0;
    let how: StockMatchResult["matchedOn"] = "tokens";
    for (const c of candidates) {
      const cNorm = normalizeName(c);
      if (!cNorm) continue;
      let s = 0;
      let m: StockMatchResult["matchedOn"] = "tokens";
      if (cNorm === targetNorm) { s = 1.0; m = "exact"; }
      else if (cNorm.includes(targetNorm) || targetNorm.includes(cNorm)) { s = 0.85; m = "substring"; }
      else {
        const cTok = new Set(tokenize(c));
        const inter = [...targetTokens].filter((t) => cTok.has(t)).length;
        if (inter === 0) continue;
        const union = new Set([...targetTokens, ...cTok]).size;
        s = inter / union;
      }
      if (s > bestScore) { bestScore = s; how = m; }
    }
    if (bestScore >= 0.5) out.push({ row: r, score: bestScore, matchedOn: how });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/**
 * Record a usage event: bumps usage_count + last_used_at on the library row
 * and inserts a restaurant_menu_item_images row for analytics. Best-effort —
 * never throws so menu writes are never blocked by analytics failures.
 */
export async function recordLibraryImageUsage(opts: {
  restaurantId: number;
  menuItemId: number;
  libraryImageId: number | null;
  imageUrl: string;
  source: "library" | "ai_generated" | "upload" | "menu_import_ai" | "menu_import_library" | "reuse";
  attachedBy: number | null;
}): Promise<void> {
  try {
    await db.insert(restaurantMenuItemImagesTable).values({
      restaurantId: opts.restaurantId,
      menuItemId: opts.menuItemId,
      libraryImageId: opts.libraryImageId,
      imageUrl: opts.imageUrl,
      source: opts.source,
      attachedBy: opts.attachedBy,
    });
    if (opts.libraryImageId != null) {
      await db.update(stockFoodImagesTable)
        .set({
          usageCount: sql`${stockFoodImagesTable.usageCount} + 1`,
          lastUsedAt: new Date(),
        })
        .where(eq(stockFoodImagesTable.id, opts.libraryImageId));
    }
  } catch (err) {
    logger.warn({ err, menuItemId: opts.menuItemId }, "recordLibraryImageUsage failed");
  }
}

/**
 * Idempotent startup seeder. Inserts any missing slugs from the curated
 * catalog. Existing rows are left untouched so admin edits (renames,
 * URL swaps, deactivations) are never overwritten.
 */
export async function seedStockFoodImages(): Promise<void> {
  try {
    const existing = await db.select({ slug: stockFoodImagesTable.slug }).from(stockFoodImagesTable);
    const seen = new Set(existing.map((r) => r.slug));
    const toInsert: InsertStockFoodImage[] = [];
    for (const entry of STOCK_FOOD_IMAGE_SEED) {
      const slug = slugifyName(entry.slug ?? entry.name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      toInsert.push({
        slug,
        name: entry.name,
        cuisine: entry.cuisine ?? null,
        category: entry.category ?? null,
        imageUrl: entry.imageUrl,
        thumbnailUrl: entry.thumbnailUrl ?? null,
        aliases: entry.aliases ?? [],
        tags: entry.tags ?? [],
        isVeg: entry.isVeg ?? true,
        isActive: true,
        sortOrder: entry.sortOrder ?? 0,
        attribution: entry.attribution ?? null,
        source: "seed",
        dietaryType: entry.dietaryType ?? (entry.isVeg === false ? "non-veg" : "veg"),
        mealType: entry.mealType ?? entry.category ?? null,
        spiceLevel: entry.spiceLevel ?? null,
        provider: "wikimedia",
        licenseStatus: "approved",
        isApproved: true,
        isFeatured: entry.isFeatured ?? false,
      });
    }
    if (toInsert.length === 0) return;
    await db.insert(stockFoodImagesTable).values(toInsert).onConflictDoNothing({
      target: stockFoodImagesTable.slug,
    });
    invalidateStockFoodCache();
    logger.info({ added: toInsert.length }, "Stock food image catalog seeded");
  } catch (err) {
    logger.error({ err }, "Failed to seed stock food image catalog");
  }
}
