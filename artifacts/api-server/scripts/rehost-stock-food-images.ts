/**
 * One-shot migration: regenerate every external stock_food_images URL
 * (Wikimedia, etc.) with an AI photo from Pollinations and rehost the
 * bytes on our own object storage.
 *
 * Why: Wikimedia hard-blocks Replit's egress (HTTP 400 + "Wikimedia
 * Error" page), so the picker shows broken images. Gemini's free tier
 * is at 0 image-requests/day. Pollinations is free, no-key, fast.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx scripts/rehost-stock-food-images.ts [--dry-run] [--limit=N] [--all]
 *
 *   --all  also reprocesses rows already on /api/public/storage/ (use
 *          if you want to swap older AI photos for fresher ones).
 */
import { db, stockFoodImagesTable } from "../src/lib/db";
import { eq, like, or, asc, not } from "drizzle-orm";
import { ObjectStorageService } from "../src/lib/objectStorage";
import { setObjectAclPolicy } from "../src/lib/objectAcl";

const svc = new ObjectStorageService();

function buildPrompt(row: { name: string; cuisine: string | null; category: string | null; isVeg: boolean }): string {
  const veg = row.isVeg ? "vegetarian" : "";
  const cat = row.category?.trim();
  const cuisine = row.cuisine?.trim();
  return (
    `Professional overhead food photograph of ${row.name}` +
    (cat ? `, a ${cat.toLowerCase()} dish` : "") +
    (cuisine ? `, ${cuisine} cuisine` : "") +
    (veg ? `, ${veg}` : "") +
    `. Restaurant menu style, square crop, natural daylight, shallow depth of field, ` +
    `plated on a neutral ceramic dish on a wooden table, garnished tastefully, vibrant colours, photorealistic, ` +
    `no text, no logo, no watermark.`
  );
}

import OpenAI from "openai";
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

async function generateWithOpenAI(prompt: string): Promise<Buffer> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await openai.images.generate({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024",
      });
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new Error("no b64_json in response");
      const buf = Buffer.from(b64, "base64");
      if (buf.length < 2000) throw new Error(`tiny body ${buf.length}b`);
      return buf;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error("unreachable");
}

async function uploadBuffer(buf: Buffer, slug: string): Promise<string> {
  const uploadURL = await svc.getObjectEntityUploadURL();
  const put = await fetch(uploadURL, {
    method: "PUT",
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(buf.length),
      "Content-Disposition": `attachment; filename="${slug}.jpg"`,
    },
    body: buf,
  });
  if (!put.ok) throw new Error(`PUT failed ${put.status}`);
  const objectPath = svc.normalizeObjectEntityPath(uploadURL);
  const file = await svc.getObjectEntityFile(objectPath);
  await setObjectAclPolicy(file, { restaurantId: "system", uploaderId: "rehost-script", visibility: "public" });
  const wildcard = objectPath.replace(/^\/objects\//, "");
  return `/api/public/storage/objects/${wildcard}`;
}

function arg(name: string): string | undefined {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? m.split("=")[1] : undefined;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const all = process.argv.includes("--all");
  const limit = Number(arg("limit") ?? "0") || 0;

  const whereExternal = or(
    like(stockFoodImagesTable.imageUrl, 'http://%'),
    like(stockFoodImagesTable.imageUrl, 'https://%'),
  )!;
  const whereNotStorage = not(like(stockFoodImagesTable.imageUrl, '/api/public/storage/%'));

  const rows = await db
    .select({
      id: stockFoodImagesTable.id,
      slug: stockFoodImagesTable.slug,
      name: stockFoodImagesTable.name,
      cuisine: stockFoodImagesTable.cuisine,
      category: stockFoodImagesTable.category,
      isVeg: stockFoodImagesTable.isVeg,
      imageUrl: stockFoodImagesTable.imageUrl,
    })
    .from(stockFoodImagesTable)
    .where(all ? whereNotStorage : whereExternal)
    .orderBy(asc(stockFoodImagesTable.id));

  const work = limit > 0 ? rows.slice(0, limit) : rows;
  console.log(`[rehost-ai] ${work.length}/${rows.length} rows to process (dryRun=${dryRun})`);

  let ok = 0, fail = 0, done = 0;
  const failures: Array<{ id: number; slug: string; err: string }> = [];
  const startedAt = Date.now();
  const CONCURRENCY = Number(arg("concurrency") ?? "6");

  async function processOne(row: typeof work[number]) {
    done++;
    const idx = done;
    try {
      if (dryRun) {
        console.log(`  [dry ${idx}/${work.length}] ${row.id} ${row.slug}`);
        ok++; return;
      }
      const buf = await generateWithOpenAI(buildPrompt(row));
      const publicUrl = await uploadBuffer(buf, row.slug);
      await db.update(stockFoodImagesTable)
        .set({ imageUrl: publicUrl, thumbnailUrl: publicUrl })
        .where(eq(stockFoodImagesTable.id, row.id));
      ok++;
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(`  ✓ [${idx}/${work.length} t=${elapsed}s ${(buf.length/1024).toFixed(0)}KB] ${row.id} ${row.slug}`);
    } catch (e) {
      fail++;
      const msg = (e as Error).message ?? String(e);
      failures.push({ id: row.id, slug: row.slug, err: msg });
      console.warn(`  ✗ [${idx}/${work.length}] ${row.id} ${row.slug}: ${msg}`);
    }
  }

  // Simple worker pool.
  const queue = [...work];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const row = queue.shift()!;
      await processOne(row);
    }
  }));

  console.log(`\n[rehost-ai] done in ${((Date.now()-startedAt)/1000).toFixed(0)}s. ok=${ok} fail=${fail}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - id=${f.id} slug=${f.slug}: ${f.err}`);
  }
  process.exit(fail > 0 && ok === 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
