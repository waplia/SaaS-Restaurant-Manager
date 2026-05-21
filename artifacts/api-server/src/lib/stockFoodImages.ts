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
 */
import { eq } from "drizzle-orm";
import { db, stockFoodImagesTable, type StockFoodImage, type InsertStockFoodImage } from "./db";
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

/**
 * Tokens dropped from match comparisons because they appear in nearly every
 * menu and dilute the signal (e.g. "spicy paneer tikka" vs "paneer tikka"
 * should still score very high).
 */
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
// The library changes rarely (super-admin only) and is read on every
// menu-import save. A tiny TTL cache keeps the hot path off the DB
// while still picking up admin edits within a few minutes. Invalidated
// explicitly after any CRUD write.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { rows: StockFoodImage[]; loadedAt: number } | null = null;

export function invalidateStockFoodCache(): void {
  cache = null;
}

async function loadActiveCached(): Promise<StockFoodImage[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.rows;
  const rows = await db.select().from(stockFoodImagesTable).where(eq(stockFoodImagesTable.isActive, true));
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

/**
 * Return the best matching library image for a dish, or null if no row
 * scores above the confidence floor. Diet-safe: a vegetarian item will
 * never be matched to a non-vegetarian library image.
 *
 * Scoring (highest wins):
 *   1.0  exact normalized name match (name or alias)
 *   0.85 one normalized string is a substring of the other
 *   0..1 Jaccard token-set similarity (must be >= 0.6 to qualify)
 */
export async function findBestStockImageMatch(input: StockMatchInput): Promise<StockMatchResult | null> {
  const targetNorm = normalizeName(input.name);
  if (!targetNorm) return null;
  const targetTokens = new Set(tokenize(input.name));
  if (targetTokens.size === 0) return null;

  const rows = await loadActiveCached();
  let best: StockMatchResult | null = null;

  for (const r of rows) {
    // Diet safety: never attach a non-veg image to a veg item.
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
 * Idempotent startup seeder. Inserts any missing slugs from the curated
 * catalog. Existing rows are left untouched so admin edits (renames,
 * URL swaps, deactivations) are never overwritten.
 */
export async function seedStockFoodImages(): Promise<void> {
  try {
    const existing = await db.select({ slug: stockFoodImagesTable.slug }).from(stockFoodImagesTable);
    const have = new Set(existing.map((r) => r.slug));
    const toInsert: InsertStockFoodImage[] = [];
    for (const entry of STOCK_FOOD_IMAGE_SEED) {
      const slug = slugifyName(entry.slug ?? entry.name);
      if (have.has(slug)) continue;
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
      });
    }
    if (toInsert.length === 0) return;
    await db.insert(stockFoodImagesTable).values(toInsert);
    invalidateStockFoodCache();
    logger.info({ added: toInsert.length }, "Stock food image catalog seeded");
  } catch (err) {
    logger.error({ err }, "Failed to seed stock food image catalog");
  }
}
