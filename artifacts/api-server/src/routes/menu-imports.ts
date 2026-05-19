/**
 * Khana AI — AI Menu Import (PDF / image / screenshot / Excel / CSV / URL / text).
 * Mounted under /restaurants/:restaurantId/ai/menu-import.
 */
import { Router, type Request, type Response } from "express";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import dns from "node:dns/promises";
import net from "node:net";
import {
  db,
  aiMenuImportsTable,
  aiMenuImportItemsTable,
  menuItemsTable,
  menuCategoriesTable,
  menusTable,
  modifierGroupsTable,
  modifiersTable,
  orderItemsTable,
  usersTable,
  type AiMenuImport,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { AIProviderService } from "../lib/aiProviderService";
import {
  requireAiCredits,
  commitReservation,
  refundReservation,
  reserveCredits,
  type AiCreditReservation,
} from "../lib/aiCredits";
import { ObjectStorageService, isObjectStorageConfigured } from "../lib/objectStorage";
import { getObjectAclPolicy, isAclOwnerOf, ObjectPermission } from "../lib/objectAcl";
import { recordAuditLog } from "../lib/audit";
import { generateAndAttachItemPhoto } from "../lib/aiFoodImage";

const router = Router();
const objectStorage = new ObjectStorageService();

router.use(
  "/restaurants/:restaurantId/ai/menu-import",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("khana_ai_enabled"),
);

type ImportSource = "pdf" | "image" | "screenshot" | "excel" | "csv" | "url" | "text";

interface StartBody {
  source: ImportSource;
  fileName?: string;
  objectPath?: string;
  url?: string;
  text?: string;
  estimatedPages?: number;
}

interface StructuredItem {
  categoryName: string;
  subcategoryName?: string | null;
  name: string;
  price: number;
  currency?: string | null;
  description?: string | null;
  variants?: Array<{ name: string; price: number }>;
  addOns?: Array<{ name: string; price: number }>;
  dietTag?: "veg" | "non-veg" | "egg" | null;
  spicyLevel?: number | null;
  bestseller?: boolean | null;
  prepTimeMinutes?: number | null;
  taxCategory?: string | null;
  allergens?: string[];
  tags?: string[];
  confidence?: number;
}

const CONFIDENCE_THRESHOLD = 0.7;
const MAX_FILE_BYTES_PDF = 25 * 1024 * 1024;          // 25 MB
const MAX_FILE_BYTES_IMAGE = 15 * 1024 * 1024;        // 15 MB
const MAX_FILE_BYTES_SPREADSHEET = 10 * 1024 * 1024;  // 10 MB
const MAX_TEXT_CHARS = 200_000;                       // ~200k chars
const PER_PAGE_CREDITS = 5;
const PER_IMAGE_CREDITS = 5;
const PER_BLOCK_CREDITS = 5;
const ITEMS_PER_BLOCK = 50;

// ─── Estimation ───────────────────────────────────────────────────────────────

function estimateUnits(body: StartBody): { units: number; unitType: string } {
  // Source-informed estimate. The post-extraction reconciliation tops the
  // reservation up if the AI returns more units than estimated, so users do
  // not need worst-case credits up front for small imports.
  switch (body.source) {
    case "pdf": {
      const pages = Math.max(1, Math.min(50, Math.ceil(body.estimatedPages ?? 2)));
      return { units: pages, unitType: "page" };
    }
    case "image":
    case "screenshot":
      return { units: 1, unitType: "image" };
    case "csv":
    case "excel":
    case "text":
    case "url": {
      const chars = (body.text ?? "").length;
      // ~5k chars ≈ one 50-item block; URL with no text yet defaults to 2 blocks.
      const fromText = chars > 0 ? Math.ceil(chars / 5_000) : 0;
      const blocks = Math.max(
        1,
        Math.min(20, fromText || (body.source === "url" ? 2 : body.objectPath ? 4 : 1)),
      );
      return { units: blocks, unitType: "block50" };
    }
  }
}

function actualUnitsFor(source: ImportSource, extractedItems: number, pdfPages: number): number {
  switch (source) {
    case "pdf": return Math.max(1, pdfPages);
    case "image":
    case "screenshot": return 1;
    default: return Math.max(1, Math.ceil(extractedItems / ITEMS_PER_BLOCK));
  }
}

function ratePerUnit(source: ImportSource): number {
  if (source === "pdf") return PER_PAGE_CREDITS;
  if (source === "image" || source === "screenshot") return PER_IMAGE_CREDITS;
  return PER_BLOCK_CREDITS;
}

// ─── SSRF protection for URL imports ─────────────────────────────────────────

function isPrivateIp(ip: string): boolean {
  if (!net.isIP(ip)) return true;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;                       // loopback
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;          // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;                        // multicast / reserved
    return false;
  }
  // IPv6
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // ULA
  if (v.startsWith("fe80")) return true;                      // link-local
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7)); // mapped v4
  return false;
}

async function validateUrlForFetch(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new Error("Invalid URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }
  const host = parsed.hostname;
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error("URL host is not allowed");
  }
  const addrs = await dns.lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new Error("Could not resolve URL host");
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error("URL resolves to a private/internal address");
  }
  return parsed;
}

const URL_FETCH_MAX_BYTES = 5 * 1024 * 1024; // 5 MB cap on URL responses.

async function safeFetchHtml(rawUrl: string): Promise<string> {
  // Manual redirect handling so each hop is re-validated against SSRF rules.
  let current = await validateUrlForFetch(rawUrl);
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(current.toString(), {
      headers: { "User-Agent": "KhanaLagao-MenuImport/1.0" },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`Redirect without Location header (${res.status})`);
      current = await validateUrlForFetch(new URL(loc, current).toString());
      continue;
    }
    if (!res.ok) throw new Error(`Failed to fetch URL (${res.status})`);
    // Reject if Content-Length already exceeds the cap.
    const cl = Number(res.headers.get("content-length") ?? "0");
    if (cl && cl > URL_FETCH_MAX_BYTES) throw new Error("URL response too large");
    // Stream and abort if we exceed the cap mid-flight.
    const reader = res.body?.getReader();
    if (!reader) return await res.text();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > URL_FETCH_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("URL response too large");
      }
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks.map(c => Buffer.from(c))));
  }
  throw new Error("Too many redirects");
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

async function fetchObjectAsDataUrl(
  objectPath: string,
  fallbackMime: string,
  restaurantId: number,
): Promise<{ dataUrl: string; mimeType: string; bytes: number }> {
  const file = await objectStorage.getObjectEntityFile(objectPath);
  // ACL ownership check — user-supplied objectPath must belong to this restaurant.
  const acl = await getObjectAclPolicy(file);
  if (!isAclOwnerOf(acl, restaurantId, ObjectPermission.READ)) {
    throw new Error("Uploaded file does not belong to this restaurant");
  }
  const [metadata] = await file.getMetadata();
  const mimeType = (metadata.contentType as string) || fallbackMime;
  const [buf] = await file.download();
  return { dataUrl: `data:${mimeType};base64,${buf.toString("base64")}`, mimeType, bytes: buf.length };
}

async function fetchObjectAsText(objectPath: string, restaurantId: number): Promise<string> {
  const file = await objectStorage.getObjectEntityFile(objectPath);
  const acl = await getObjectAclPolicy(file);
  if (!isAclOwnerOf(acl, restaurantId, ObjectPermission.READ)) {
    throw new Error("Uploaded file does not belong to this restaurant");
  }
  const [buf] = await file.download();
  return buf.toString("utf8");
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim().length > 0));
}

const STRUCTURING_INSTRUCTIONS = `You are a restaurant menu extraction assistant. Read the source provided and extract every menu item you can identify.

Return ONLY a JSON object of this exact shape (no markdown fence, no prose):
{
  "items": [
    {
      "categoryName": "string (e.g. Starters, Mains, Drinks)",
      "subcategoryName": "string or null",
      "name": "string",
      "price": number (in the local currency, no symbols, e.g. 249.00),
      "currency": "string or null (e.g. INR, USD)",
      "description": "string or null",
      "variants": [{ "name": "string (e.g. Half, Full)", "price": number }],
      "addOns":   [{ "name": "string (e.g. Extra cheese)", "price": number }],
      "dietTag": "veg" | "non-veg" | "egg" | null,
      "spicyLevel": integer 0–5 or null,
      "bestseller": boolean or null,
      "prepTimeMinutes": integer or null,
      "taxCategory": "string or null",
      "allergens": ["lowercase strings, max 6"],
      "tags": ["lowercase strings, max 6"],
      "confidence": number 0–1
    }
  ],
  "pageCount": optional integer (only when source is a multi-page document)
}

Rules: skip section headers and decorative copy; if price is missing set 0 and lower confidence; do not invent items; do not duplicate; max 200 items.`;

interface AiStructuredResponse {
  items?: unknown;
  pageCount?: number;
}

// ─── Background processing ───────────────────────────────────────────────────

interface ProcessCtx {
  restaurantId: number;
  tenantId: number | null;
  userId: number | null;
  reservation: AiCreditReservation | null;
}

async function processImport(importId: number, body: StartBody, ctx: ProcessCtx) {
  let committed = false;
  try {
    await db.update(aiMenuImportsTable).set({ status: "processing", updatedAt: new Date() }).where(eq(aiMenuImportsTable.id, importId));

    let textPayload: string | null = null;
    let imageDataUrl: string | null = null;

    if (body.source === "pdf") {
      if (!body.objectPath) throw new Error("PDF upload requires objectPath");
      const r = await fetchObjectAsDataUrl(body.objectPath, "application/pdf", ctx.restaurantId);
      if (r.bytes > MAX_FILE_BYTES_PDF) throw new Error(`PDF exceeds ${Math.round(MAX_FILE_BYTES_PDF / 1024 / 1024)} MB limit`);
      imageDataUrl = r.dataUrl;
    } else if (body.source === "image" || body.source === "screenshot") {
      if (!body.objectPath) throw new Error("Image upload requires objectPath");
      const r = await fetchObjectAsDataUrl(body.objectPath, "image/jpeg", ctx.restaurantId);
      if (r.bytes > MAX_FILE_BYTES_IMAGE) throw new Error(`Image exceeds ${Math.round(MAX_FILE_BYTES_IMAGE / 1024 / 1024)} MB limit`);
      imageDataUrl = r.dataUrl;
    } else if (body.source === "excel" || body.source === "csv") {
      const raw = body.text ?? (body.objectPath ? await fetchObjectAsText(body.objectPath, ctx.restaurantId) : null);
      if (!raw) throw new Error("Spreadsheet import requires text or objectPath");
      if (Buffer.byteLength(raw, "utf8") > MAX_FILE_BYTES_SPREADSHEET) throw new Error(`Spreadsheet exceeds ${Math.round(MAX_FILE_BYTES_SPREADSHEET / 1024 / 1024)} MB limit`);
      const rows = parseCsvText(raw);
      textPayload = (rows.length > 0 ? rows.map(r => r.join(" | ")).join("\n") : raw).slice(0, MAX_TEXT_CHARS);
    } else if (body.source === "url") {
      if (!body.url) throw new Error("URL import requires url");
      const html = await safeFetchHtml(body.url);
      textPayload = stripHtmlToText(html).slice(0, MAX_TEXT_CHARS);
    } else if (body.source === "text") {
      if (!body.text || body.text.trim().length < 5) throw new Error("Text import requires text body");
      if (body.text.length > MAX_TEXT_CHARS) throw new Error(`Text exceeds ${MAX_TEXT_CHARS.toLocaleString()} character limit`);
      textPayload = body.text;
    }

    let aiData: AiStructuredResponse;
    let requestLogId: number | null = null;
    if (imageDataUrl) {
      const v = await AIProviderService.generateVision({
        featureSlug: "ai_menu_import",
        tenantId: ctx.tenantId, restaurantId: ctx.restaurantId, userId: ctx.userId,
        metadata: { importId, source: body.source, fileName: body.fileName },
      }, {
        messages: [{ role: "user", content: STRUCTURING_INSTRUCTIONS + "\n\nExtract every item from the attached document." }],
        imageDataUrl, temperature: 0.2, maxTokens: 8000,
      });
      requestLogId = v.requestLogId ?? null;
      const cleaned = v.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      try { aiData = JSON.parse(cleaned) as AiStructuredResponse; }
      catch {
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (!m) throw new Error("AI returned non-JSON response");
        aiData = JSON.parse(m[0]) as AiStructuredResponse;
      }
    } else if (textPayload) {
      const r = await AIProviderService.generateJson<AiStructuredResponse>({
        featureSlug: "ai_menu_import",
        tenantId: ctx.tenantId, restaurantId: ctx.restaurantId, userId: ctx.userId,
        metadata: { importId, source: body.source, fileName: body.fileName },
      }, {
        messages: [{ role: "user", content: `${STRUCTURING_INSTRUCTIONS}\n\nSource:\n"""\n${textPayload}\n"""` }],
        temperature: 0.2, maxTokens: 8000,
      });
      aiData = r.data;
      requestLogId = r.result.requestLogId ?? null;
    } else {
      throw new Error("No source content to process");
    }

    const items: StructuredItem[] = Array.isArray(aiData.items) ? (aiData.items as StructuredItem[]) : [];
    if (items.length === 0) throw new Error("AI did not extract any menu items");

    const existing = await db
      .select({ id: menuItemsTable.id, name: menuItemsTable.name })
      .from(menuItemsTable)
      .where(eq(menuItemsTable.restaurantId, ctx.restaurantId));
    const byName = new Map<string, number>();
    for (const ex of existing) byName.set(ex.name.toLowerCase().trim(), ex.id);

    let needsReviewCount = 0;
    const draftRows: Array<typeof aiMenuImportItemsTable.$inferInsert> = [];
    items.forEach((raw, idx) => {
      const name = String(raw.name ?? "").trim();
      if (!name) return;
      const priceNum = Number(raw.price);
      const price = Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : 0;
      const confidenceRaw = typeof raw.confidence === "number" ? raw.confidence : 0.85;
      const confidence = Math.max(0, Math.min(1, confidenceRaw));
      const needsReview = confidence < CONFIDENCE_THRESHOLD || price === 0;
      if (needsReview) needsReviewCount++;
      const dupId = byName.get(name.toLowerCase()) ?? null;

      const structured: StructuredItem = {
        categoryName: String(raw.categoryName ?? "Uncategorised").trim() || "Uncategorised",
        subcategoryName: raw.subcategoryName ? String(raw.subcategoryName) : null,
        name,
        price,
        currency: raw.currency ? String(raw.currency) : null,
        description: raw.description ? String(raw.description) : null,
        variants: Array.isArray(raw.variants) ? raw.variants.map(v => ({ name: String(v.name ?? "").trim(), price: Number(v.price) || 0 })).filter(v => v.name) : [],
        addOns: Array.isArray(raw.addOns) ? raw.addOns.map(v => ({ name: String(v.name ?? "").trim(), price: Number(v.price) || 0 })).filter(v => v.name) : [],
        dietTag: raw.dietTag === "veg" || raw.dietTag === "non-veg" || raw.dietTag === "egg" ? raw.dietTag : null,
        spicyLevel: typeof raw.spicyLevel === "number" ? Math.max(0, Math.min(5, Math.round(raw.spicyLevel))) : null,
        bestseller: raw.bestseller === true ? true : raw.bestseller === false ? false : null,
        prepTimeMinutes: typeof raw.prepTimeMinutes === "number" ? Math.max(1, Math.round(raw.prepTimeMinutes)) : null,
        taxCategory: raw.taxCategory ? String(raw.taxCategory) : null,
        allergens: Array.isArray(raw.allergens) ? raw.allergens.map((s: unknown) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 6) : [],
        tags: Array.isArray(raw.tags) ? raw.tags.map((s: unknown) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 6) : [],
        confidence,
      };

      draftRows.push({
        importId, restaurantId: ctx.restaurantId, rowIndex: idx,
        status: "draft",
        structured: structured as unknown as Record<string, unknown>,
        confidence: confidence.toFixed(3),
        needsReview,
        duplicateMatchId: dupId,
      });
    });

    if (draftRows.length > 0) await db.insert(aiMenuImportItemsTable).values(draftRows);

    // Commit credits based on real units extracted.
    const pdfPages = body.source === "pdf" ? Math.max(1, Math.min(50, Math.ceil(aiData.pageCount ?? body.estimatedPages ?? 1))) : 1;
    const realUnits = actualUnitsFor(body.source, draftRows.length, pdfPages);
    const realCredits = realUnits * ratePerUnit(body.source);
    if (ctx.reservation) {
      // Top up the reservation if the AI extracted more units than estimated,
      // so commitReservation can debit the *actual* amount instead of being
      // capped at the initial estimate. If the wallet has insufficient balance
      // for the top-up we fall back to debiting whatever was reserved.
      const shortfall = realCredits - ctx.reservation.reservedCredits;
      if (shortfall > 0) {
        // Strict billing: if the wallet cannot cover the actual usage, fail
        // the import and refund the original reservation. This avoids ever
        // committing less than realCredits on a successful extraction.
        const extra = await reserveCredits({
          tenantId: ctx.reservation.tenantId,
          featureSlug: ctx.reservation.featureSlug,
          credits: shortfall,
          meta: { ...ctx.reservation.meta, topUp: true, importId },
        });
        ctx.reservation = {
          ...ctx.reservation,
          reservedCredits: ctx.reservation.reservedCredits + extra.reservedCredits,
        };
      }
      await commitReservation({
        reservation: ctx.reservation,
        userId: ctx.userId,
        requestLogId,
        actualCredits: realCredits,
      });
      committed = true;
    }

    await db.update(aiMenuImportsTable).set({
      status: "ready",
      totalRows: draftRows.length,
      needsReviewCount,
      actualCredits: Math.min(realCredits, ctx.reservation?.reservedCredits ?? realCredits),
      summary: { extractedCount: draftRows.length, needsReviewCount, requestLogId, pdfPages, realUnits },
      updatedAt: new Date(),
    }).where(eq(aiMenuImportsTable.id, importId));
  } catch (err) {
    const msg = (err as Error).message ?? "Import failed";
    if (ctx.reservation && !committed) {
      await refundReservation(ctx.reservation, msg).catch(() => undefined);
    }
    await db.update(aiMenuImportsTable).set({
      status: "failed",
      errorMessage: msg.slice(0, 500),
      actualCredits: 0,
      updatedAt: new Date(),
    }).where(eq(aiMenuImportsTable.id, importId));
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.post(
  "/restaurants/:restaurantId/ai/menu-import/start",
  // Validate the request shape *before* the credit-reservation middleware so
  // malformed requests get a clean 4xx instead of failing inside billing logic.
  (req: Request, res: Response, next) => {
    const body = (req.body ?? {}) as StartBody;
    const allowed: ImportSource[] = ["pdf", "image", "screenshot", "csv", "excel", "url", "text"];
    if (!body.source || !allowed.includes(body.source)) {
      return void res.status(400).json({ error: "source is required and must be one of: " + allowed.join(", ") });
    }
    if (body.source === "url") {
      if (!body.url) return void res.status(400).json({ error: "url is required for source=url" });
      try { new URL(body.url); } catch { return void res.status(400).json({ error: "Invalid URL" }); }
    }
    if (body.source === "text" && (!body.text || body.text.trim().length < 5)) {
      return void res.status(400).json({ error: "text is required for source=text" });
    }
    if ((body.source === "pdf" || body.source === "image" || body.source === "screenshot" || body.source === "excel") && !body.objectPath) {
      return void res.status(400).json({ error: `objectPath is required for source=${body.source}` });
    }
    if (body.source === "csv" && !body.objectPath && !body.text) {
      return void res.status(400).json({ error: "objectPath or text is required for source=csv" });
    }
    next();
  },
  requireAiCredits("ai_menu_import", (req) => {
    const body = (req.body ?? {}) as StartBody;
    const { units, unitType } = estimateUnits(body);
    return { units, meta: { source: body.source, unitType } };
  }),
  async (req: Request, res: Response) => {
    const reservation = (res.locals.aiCreditReservation as AiCreditReservation | null) ?? null;
    const restaurantId = Number(req.params.restaurantId);
    const body = (req.body ?? {}) as StartBody;
    if (!body.source) {
      if (reservation) await refundReservation(reservation, "missing source");
      return void res.status(400).json({ error: "source is required" });
    }
    // Quick validations before reserving the row.
    if (body.source === "url" && body.url) {
      try { new URL(body.url); } catch {
        if (reservation) await refundReservation(reservation, "invalid url");
        return void res.status(400).json({ error: "Invalid URL" });
      }
    }

    const { units } = estimateUnits(body);
    const estimatedCredits = units * ratePerUnit(body.source);

    const [created] = await db.insert(aiMenuImportsTable).values({
      restaurantId,
      tenantId: req.user?.tenantId ?? null,
      source: body.source,
      status: "pending",
      fileName: body.fileName ?? null,
      fileRef: body.objectPath ?? null,
      sourceUrl: body.url ?? null,
      sourceTextPreview: body.text ? body.text.slice(0, 1000) : null,
      estimatedCredits,
      createdBy: req.user?.sub ?? null,
    }).returning();

    await recordAuditLog({
      req,
      module: "khana_ai",
      action: "menu_import",
      entity: "ai_menu_import",
      entityId: created.id,
      newValue: { phase: "start", source: body.source, fileName: body.fileName, estimatedCredits },
    });

    setImmediate(() => {
      processImport(created.id, body, {
        restaurantId,
        tenantId: req.user?.tenantId ?? null,
        userId: req.user?.sub ?? null,
        reservation,
      }).catch((err) => req.log.error({ err, importId: created.id }, "menu import failed"));
    });

    res.status(202).json({ id: created.id, status: created.status, estimatedCredits });
  },
);

router.get("/restaurants/:restaurantId/ai/menu-import/imports", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 30)));
  const rows = await db
    .select({
      import: aiMenuImportsTable,
      createdByName: usersTable.name,
      createdByEmail: usersTable.email,
    })
    .from(aiMenuImportsTable)
    .leftJoin(usersTable, eq(usersTable.id, aiMenuImportsTable.createdBy))
    .where(eq(aiMenuImportsTable.restaurantId, restaurantId))
    .orderBy(desc(aiMenuImportsTable.createdAt))
    .limit(limit);
  res.json(rows.map(r => ({ ...r.import, createdByName: r.createdByName, createdByEmail: r.createdByEmail })));
});

router.get("/restaurants/:restaurantId/ai/menu-import/imports/:id", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [row] = await db.select().from(aiMenuImportsTable)
    .where(and(eq(aiMenuImportsTable.id, id), eq(aiMenuImportsTable.restaurantId, restaurantId)));
  if (!row) return void res.status(404).json({ error: "Import not found" });
  const items = await db.select().from(aiMenuImportItemsTable)
    .where(eq(aiMenuImportItemsTable.importId, id))
    .orderBy(aiMenuImportItemsTable.rowIndex);
  res.json({ import: row, items });
});

interface SaveBody {
  rowIds: number[];
  edits?: Record<number, Partial<StructuredItem>>;
}

router.post("/restaurants/:restaurantId/ai/menu-import/imports/:id/save", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const body = (req.body ?? {}) as SaveBody;
  if (!Array.isArray(body.rowIds) || body.rowIds.length === 0) {
    return void res.status(400).json({ error: "rowIds required" });
  }

  const [importRow] = await db.select().from(aiMenuImportsTable)
    .where(and(eq(aiMenuImportsTable.id, id), eq(aiMenuImportsTable.restaurantId, restaurantId)));
  if (!importRow) return void res.status(404).json({ error: "Import not found" });
  if (importRow.status !== "ready" && importRow.status !== "partially_saved") {
    return void res.status(400).json({ error: `Cannot save in status ${importRow.status}` });
  }

  const rowIds = body.rowIds.map(Number).filter(Number.isFinite);
  // Pre-fetch (no status filter) so we can reject the request early if any
  // requested row is non-draft instead of silently filtering it out.
  const requested = await db.select().from(aiMenuImportItemsTable)
    .where(and(eq(aiMenuImportItemsTable.importId, id), inArray(aiMenuImportItemsTable.id, rowIds)));
  if (requested.length === 0) return void res.status(400).json({ error: "No matching rows" });
  const nonDraft = requested.filter(r => r.status !== "draft");
  if (nonDraft.length > 0) {
    return void res.status(409).json({ error: "Some rows are no longer in draft state", rowIds: nonDraft.map(r => r.id) });
  }
  const draftItems = requested;

  const menuName = importRow.fileName?.replace(/\.[^.]+$/, "") || `AI Import — ${new Date(importRow.createdAt).toLocaleDateString()}`;
  const created: number[] = [];
  // Collected inside the tx and processed after commit so a slow / failing
  // image provider can never roll back the menu save.
  const photoQueue: Array<{
    draftId: number;
    itemId: number;
    name: string;
    categoryName: string | null;
    isVeg: boolean;
    cuisine: string | null;
    ingredients: string | null;
  }> = [];

  try {
  await db.transaction(async (tx) => {
    // Re-check inside the transaction with a row-level lock to prevent a
    // concurrent save of the same draft rows from creating duplicates.
    const locked = await tx.select({ id: aiMenuImportItemsTable.id, status: aiMenuImportItemsTable.status })
      .from(aiMenuImportItemsTable)
      .where(and(eq(aiMenuImportItemsTable.importId, id), inArray(aiMenuImportItemsTable.id, rowIds)))
      .for("update");
    if (locked.some(r => r.status !== "draft")) {
      throw new Error("Concurrent save detected — some rows are no longer draft");
    }
    let [menu] = await tx.select().from(menusTable)
      .where(and(eq(menusTable.restaurantId, restaurantId), eq(menusTable.name, menuName)));
    if (!menu) {
      [menu] = await tx.insert(menusTable).values({ restaurantId, name: menuName, description: `Imported from ${importRow.source}` }).returning();
    }

    const catCache = new Map<string, number>();
    const existingCats = await tx.select({ id: menuCategoriesTable.id, name: menuCategoriesTable.name })
      .from(menuCategoriesTable).where(and(eq(menuCategoriesTable.restaurantId, restaurantId), eq(menuCategoriesTable.menuId, menu.id)));
    for (const c of existingCats) catCache.set(c.name.toLowerCase(), c.id);

    const resolveCategory = async (name: string): Promise<number> => {
      const key = name.toLowerCase().trim();
      if (catCache.has(key)) return catCache.get(key)!;
      const [cat] = await tx.insert(menuCategoriesTable).values({ restaurantId, menuId: menu.id, name: name.trim() }).returning({ id: menuCategoriesTable.id });
      catCache.set(key, cat.id);
      return cat.id;
    };

    for (const draft of draftItems) {
        const structured = draft.structured as unknown as StructuredItem;
        const edited = body.edits?.[draft.id] ?? {};
        const merged: StructuredItem = { ...structured, ...edited } as StructuredItem;
        const categoryId = await resolveCategory(merged.categoryName || "Uncategorised");
        const tagsArr: string[] = [...(merged.tags ?? [])];
        if (merged.bestseller) tagsArr.push("bestseller");
        if (typeof merged.spicyLevel === "number" && merged.spicyLevel > 0) tagsArr.push(`spicy-${merged.spicyLevel}`);
        if (merged.subcategoryName) tagsArr.push(`section:${merged.subcategoryName.toLowerCase()}`);
        const isVeg = merged.dietTag === "veg";

        const now = new Date();
        const [item] = await tx.insert(menuItemsTable).values({
          restaurantId,
          categoryId,
          name: merged.name,
          description: merged.description ?? "",
          price: Number(merged.price ?? 0).toFixed(2),
          isVeg,
          isAvailable: true,
          preparationTime: merged.prepTimeMinutes ?? 15,
          tags: Array.from(new Set(tagsArr.filter(Boolean))).slice(0, 12),
          allergens: (merged.allergens ?? []).slice(0, 8),
        }).returning({ id: menuItemsTable.id });

        // Persist variants and add-ons as modifier groups linked to the item.
        const groupSpecs: Array<{ name: string; required: boolean; min: number; max: number; options: Array<{ name: string; price: number }> }> = [];
        if (merged.variants && merged.variants.length > 0) {
          groupSpecs.push({ name: "Variants", required: true, min: 1, max: 1, options: merged.variants });
        }
        if (merged.addOns && merged.addOns.length > 0) {
          groupSpecs.push({ name: "Add-ons", required: false, min: 0, max: merged.addOns.length, options: merged.addOns });
        }
        for (const spec of groupSpecs) {
          const [grp] = await tx.insert(modifierGroupsTable).values({
            menuItemId: item.id,
            name: spec.name,
            isRequired: spec.required,
            minSelections: spec.min,
            maxSelections: spec.max,
          }).returning({ id: modifierGroupsTable.id });
          if (spec.options.length > 0) {
            await tx.insert(modifiersTable).values(spec.options.map((o, i) => ({
              groupId: grp.id,
              name: o.name,
              price: Number(o.price ?? 0).toFixed(2),
              isDefault: spec.required && i === 0,
              isAvailable: true,
            })));
          }
        }

        // Defensive: ensure we only flip a row that is still draft. The row
        // is locked above, so this UPDATE can never collide with a parallel save.
        const upd = await tx.update(aiMenuImportItemsTable).set({
          status: "saved",
          menuItemId: item.id,
          savedAt: now,
          structured: merged as unknown as Record<string, unknown>,
          imageStatus: "queued",
          imageError: null,
        }).where(and(eq(aiMenuImportItemsTable.id, draft.id), eq(aiMenuImportItemsTable.status, "draft")))
          .returning({ id: aiMenuImportItemsTable.id });
        if (upd.length === 0) {
          throw new Error(`Row ${draft.id} was no longer draft when saving`);
        }
        created.push(item.id);
        // Remember the draft row + item context so we can backfill its AI
        // photo *outside* the transaction (see post-commit block below).
        photoQueue.push({
          draftId: draft.id,
          itemId: item.id,
          name: merged.name,
          categoryName: merged.categoryName ?? null,
          isVeg,
          cuisine: (merged as { cuisineType?: string }).cuisineType ?? null,
          ingredients: merged.description ?? (merged.allergens ?? []).join(", "),
        });
    }

    const remaining = await tx.select({ id: aiMenuImportItemsTable.id }).from(aiMenuImportItemsTable)
      .where(and(eq(aiMenuImportItemsTable.importId, id), eq(aiMenuImportItemsTable.status, "draft")));
    const newStatus = remaining.length > 0 ? "partially_saved" : "saved";
    await tx.update(aiMenuImportsTable).set({
      status: newStatus,
      // Atomic increment within the transaction so concurrent saves of
      // disjoint row sets cannot lose updates on this counter.
      savedItemCount: sql`${aiMenuImportsTable.savedItemCount} + ${created.length}`,
      savedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(aiMenuImportsTable.id, id));
  });
  } catch (err) {
    return void res.status(409).json({ error: (err as Error).message ?? "Save failed", savedCount: 0 });
  }

  await recordAuditLog({
    req, module: "khana_ai", action: "menu_import",
    entity: "ai_menu_import", entityId: id,
    newValue: { phase: "save", source: importRow.source, savedCount: created.length, fileName: importRow.fileName },
  });

  // Kick off AI image generation for every newly-saved item, in the
  // background with a small concurrency cap so the HTTP response returns
  // immediately. Each image takes 5-15s; we don't want to block the user.
  if (photoQueue.length > 0) {
    const tenantId = req.user?.tenantId ?? null;
    const userId = req.user?.sub ?? null;
    if (!isObjectStorageConfigured()) {
      // Mark every row as skipped so the import history shows why no
      // photos appeared.
      await db.update(aiMenuImportItemsTable)
        .set({ imageStatus: "skipped_no_storage", imageError: "Object storage not configured" })
        .where(inArray(aiMenuImportItemsTable.id, photoQueue.map(p => p.draftId)));
    } else {
      setImmediate(() => {
        backfillPhotos(id, restaurantId, tenantId, userId, photoQueue)
          .catch((err) => req.log.error({ err, importId: id }, "menu-import photo backfill failed"));
      });
    }
  }

  res.json({ savedCount: created.length, savedItemIds: created, errors: [] });
});

/**
 * Process the photoQueue with a small concurrency cap, updating each draft
 * row's imageStatus as it progresses. Runs after the save transaction has
 * committed so a slow / failing provider can never undo the menu save.
 */
async function backfillPhotos(
  importId: number,
  restaurantId: number,
  tenantId: number | null,
  userId: number | null,
  queue: Array<{
    draftId: number;
    itemId: number;
    name: string;
    categoryName: string | null;
    isVeg: boolean;
    cuisine: string | null;
    ingredients: string | null;
  }>,
): Promise<void> {
  const CONCURRENCY = 3;
  let cursor = 0;
  let done = 0;
  let failed = 0;
  let skippedCredits = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= queue.length) return;
      const job = queue[idx];
      try {
        await db.update(aiMenuImportItemsTable)
          .set({ imageStatus: "generating", imageError: null })
          .where(eq(aiMenuImportItemsTable.id, job.draftId));
        const result = await generateAndAttachItemPhoto({
          tenantId,
          restaurantId,
          userId,
          itemId: job.itemId,
          inputs: {
            name: job.name,
            categoryName: job.categoryName,
            isVeg: job.isVeg,
            cuisine: job.cuisine,
            ingredients: job.ingredients,
          },
        });
        if (result.ok) {
          await db.update(aiMenuImportItemsTable)
            .set({ imageStatus: "done", imageError: null })
            .where(eq(aiMenuImportItemsTable.id, job.draftId));
          done++;
        } else if (result.code === "INSUFFICIENT_CREDITS") {
          await db.update(aiMenuImportItemsTable)
            .set({ imageStatus: "skipped_credits", imageError: result.reason })
            .where(eq(aiMenuImportItemsTable.id, job.draftId));
          skippedCredits++;
        } else {
          await db.update(aiMenuImportItemsTable)
            .set({ imageStatus: "failed", imageError: result.reason.slice(0, 500) })
            .where(eq(aiMenuImportItemsTable.id, job.draftId));
          failed++;
        }
      } catch (err) {
        failed++;
        await db.update(aiMenuImportItemsTable)
          .set({ imageStatus: "failed", imageError: ((err as Error).message ?? "unknown").slice(0, 500) })
          .where(eq(aiMenuImportItemsTable.id, job.draftId))
          .catch(() => {});
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()));

  // Persist a CUMULATIVE summary so the import-history page can show
  // "Generated photos for X of Y items." For imports saved in multiple
  // passes (partially_saved flow), we add this batch's counts to whatever
  // earlier passes already contributed instead of overwriting.
  const [row] = await db.select({ summary: aiMenuImportsTable.summary })
    .from(aiMenuImportsTable).where(eq(aiMenuImportsTable.id, importId));
  const prevSummary = (row?.summary ?? {}) as Record<string, unknown>;
  const prevPhotos = (prevSummary.photos ?? {}) as {
    total?: number; done?: number; failed?: number; skippedCredits?: number;
  };
  await db.update(aiMenuImportsTable).set({
    summary: {
      ...prevSummary,
      photos: {
        total: (prevPhotos.total ?? 0) + queue.length,
        done: (prevPhotos.done ?? 0) + done,
        failed: (prevPhotos.failed ?? 0) + failed,
        skippedCredits: (prevPhotos.skippedCredits ?? 0) + skippedCredits,
      },
    },
    updatedAt: new Date(),
  }).where(eq(aiMenuImportsTable.id, importId));
}

router.post("/restaurants/:restaurantId/ai/menu-import/imports/:id/rollback", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);

  const [importRow] = await db.select().from(aiMenuImportsTable)
    .where(and(eq(aiMenuImportsTable.id, id), eq(aiMenuImportsTable.restaurantId, restaurantId)));
  if (!importRow) return void res.status(404).json({ error: "Import not found" });
  if (importRow.status !== "saved" && importRow.status !== "partially_saved") {
    return void res.status(400).json({ error: "Only saved imports can be rolled back" });
  }

  const ageMs = Date.now() - new Date(importRow.savedAt ?? importRow.createdAt).getTime();
  if (ageMs > 7 * 24 * 60 * 60 * 1000) {
    return void res.status(400).json({ error: "Rollback window has expired (7 days)" });
  }

  // Only the most recent saved import is rollable.
  const [latest] = await db.select({ id: aiMenuImportsTable.id }).from(aiMenuImportsTable)
    .where(and(
      eq(aiMenuImportsTable.restaurantId, restaurantId),
      inArray(aiMenuImportsTable.status, ["saved", "partially_saved"]),
    ))
    .orderBy(desc(aiMenuImportsTable.savedAt))
    .limit(1);
  if (!latest || latest.id !== id) {
    return void res.status(400).json({ error: "Only the most recent import can be rolled back" });
  }

  const savedRows = await db.select().from(aiMenuImportItemsTable)
    .where(and(eq(aiMenuImportItemsTable.importId, id), eq(aiMenuImportItemsTable.status, "saved")));
  const ids = savedRows.map(r => r.menuItemId).filter((x): x is number => typeof x === "number");
  if (ids.length === 0) return void res.status(400).json({ error: "Nothing to roll back" });

  const soldRows = await db.select({ menuItemId: orderItemsTable.menuItemId }).from(orderItemsTable)
    .where(inArray(orderItemsTable.menuItemId, ids));
  const sold = new Set(soldRows.map(r => r.menuItemId));

  const items = await db.select({ id: menuItemsTable.id, updatedAt: menuItemsTable.updatedAt })
    .from(menuItemsTable).where(inArray(menuItemsTable.id, ids));
  const itemUpdatedAt = new Map(items.map(i => [i.id, i.updatedAt]));

  const removed: number[] = [];
  const skipped: Array<{ menuItemId: number; reason: string }> = [];

  for (const draft of savedRows) {
    const mid = draft.menuItemId;
    if (mid == null) continue;
    if (sold.has(mid)) { skipped.push({ menuItemId: mid, reason: "sold" }); continue; }
    const updated = itemUpdatedAt.get(mid);
    const savedAt = draft.savedAt;
    // Strict edit detection: any update strictly after savedAt counts as edited.
    if (updated && savedAt && updated.getTime() > savedAt.getTime()) {
      skipped.push({ menuItemId: mid, reason: "edited" });
      continue;
    }
    try {
      await db.transaction(async (tx) => {
        // Cascade-delete modifier groups + their modifiers, then the menu item.
        const groups = await tx.select({ id: modifierGroupsTable.id })
          .from(modifierGroupsTable).where(eq(modifierGroupsTable.menuItemId, mid));
        const groupIds = groups.map(g => g.id);
        if (groupIds.length > 0) {
          await tx.delete(modifiersTable).where(inArray(modifiersTable.groupId, groupIds));
          await tx.delete(modifierGroupsTable).where(inArray(modifierGroupsTable.id, groupIds));
        }
        await tx.delete(menuItemsTable).where(eq(menuItemsTable.id, mid));
        await tx.update(aiMenuImportItemsTable).set({ status: "rolled_back", menuItemId: null })
          .where(eq(aiMenuImportItemsTable.id, draft.id));
      });
      removed.push(mid);
    } catch (err) {
      skipped.push({ menuItemId: mid, reason: (err as Error).message ?? "delete failed" });
    }
  }

  const finalStatus: AiMenuImport["status"] = removed.length === ids.length ? "rolled_back" : "partially_saved";
  await db.update(aiMenuImportsTable).set({
    status: finalStatus,
    rolledBackAt: new Date(),
    updatedAt: new Date(),
    summary: { ...(importRow.summary ?? {}), rolledBack: removed.length, rollbackSkipped: skipped.length },
  }).where(eq(aiMenuImportsTable.id, id));

  await recordAuditLog({
    req, module: "khana_ai", action: "menu_import",
    entity: "ai_menu_import", entityId: id,
    newValue: { phase: "rollback", removed: removed.length, skipped: skipped.length, reasons: skipped },
  });

  res.json({ removed: removed.length, skipped });
});

export default router;
