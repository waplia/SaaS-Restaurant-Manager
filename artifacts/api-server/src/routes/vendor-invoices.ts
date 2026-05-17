/**
 * Vendor Invoice OCR (Task #427).
 *
 * Owner / manager uploads a supplier invoice (PDF or image). The OCR pass
 * uses `AIProviderService.generateVision` (metered through Khana AI credits
 * under the `vendor_invoice_ocr` feature slug). The extracted record is
 * created as a `draft` vendor_invoice with one row per detected line. The
 * reviewer can correct fields, match a purchase order (auto-detected by
 * supplier when possible, with per-line price-variance flagging), then
 * approve — which atomically:
 *   1. Creates an `expenses` row (status=approved) as the vendor bill.
 *   2. Increments stock on every matched inventory item + writes an
 *      `inventory_transactions` "receive" row and an `inventory_item_batches`
 *      row tied to the originating PO.
 *   3. Flips the vendor_invoice to `approved` and links the expense id.
 *
 * Every upload, correction, approval and rejection writes an audit log.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  vendorInvoicesTable,
  vendorInvoiceLinesTable,
  suppliersTable,
  branchesTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  inventoryItemsTable,
  inventoryStockTable,
  inventoryTransactionsTable,
  inventoryItemBatchesTable,
  expensesTable,
  expenseCategoriesTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { requirePlanFeature } from "../middleware/planFeature";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import {
  requireAiCredits,
  commitReservation,
  refundReservation,
  type AiCreditReservation,
} from "../lib/aiCredits";
import { AIProviderService } from "../lib/aiProviderService";
import { ObjectStorageService } from "../lib/objectStorage";
import { getObjectAclPolicy, isAclOwnerOf, ObjectPermission } from "../lib/objectAcl";
import { recordAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const AUDIT_MODULE = "vendor_invoice";
const AUDIT_ENTITY = "vendor_invoice";
const FEATURE_SLUG = "vendor_invoice_ocr";
const PLAN_FEATURE = "inv_vendor_invoice_ocr";
// % above which a line's unit price vs the matched PO unit price is flagged.
const PRICE_VARIANCE_THRESHOLD_PCT = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const baseScope = "/restaurants/:restaurantId/vendor-invoices";
router.use(
  baseScope,
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature(PLAN_FEATURE),
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ExtractedLine {
  description?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  lineTotal?: number;
  confidence?: number;
}
interface ExtractedInvoice {
  vendorName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  totalAmount?: number | null;
  taxAmount?: number | null;
  currency?: string | null;
  pageCount?: number | null;
  lines?: ExtractedLine[];
  confidence?: Record<string, number>;
}

const OCR_PROMPT = `You are an invoice extraction assistant for a restaurant back-office.
Read the attached supplier invoice (PDF or image) and return ONLY a JSON object of this exact shape (no markdown fence, no prose):
{
  "vendorName": string | null,
  "invoiceNumber": string | null,
  "invoiceDate": "YYYY-MM-DD" | null,
  "dueDate": "YYYY-MM-DD" | null,
  "currency": string | null (ISO code like "INR" or "USD"),
  "totalAmount": number | null (grand total inclusive of tax),
  "taxAmount": number | null (just the tax portion),
  "pageCount": integer (1 if image),
  "lines": [
    {
      "description": string,
      "quantity": number,
      "unit": string (e.g. "kg", "ltr", "pcs", "box"),
      "unitPrice": number,
      "lineTotal": number,
      "confidence": number 0–1
    }
  ],
  "confidence": { "vendor": 0–1, "invoiceNumber": 0–1, "total": 0–1, "date": 0–1 }
}
Rules: do not invent values; if unsure of a number set 0 and lower the confidence; ignore header/footer ornaments; max 100 line items.`;

// Server-side allowlist: only invoice-like files may reach the OCR provider.
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif",
]);

class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function fetchUploadedFileAsDataUrl(
  objectPath: string,
  restaurantId: number,
): Promise<{ dataUrl: string; mimeType: string; bytes: number }> {
  const file = await objectStorage.getObjectEntityFile(objectPath);
  const acl = await getObjectAclPolicy(file);
  if (!isAclOwnerOf(acl, restaurantId, ObjectPermission.READ)) {
    throw new HttpError(403, "Uploaded file does not belong to this restaurant");
  }
  const [metadata] = await file.getMetadata();
  const mimeType = (metadata.contentType as string) || "application/octet-stream";
  if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
    throw new HttpError(415, `Unsupported file type "${mimeType}". Upload a PDF or image (JPEG/PNG/WebP/HEIC).`);
  }
  const [buf] = await file.download();
  if (buf.length > MAX_FILE_BYTES) {
    throw new HttpError(413, `File exceeds ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB limit`);
  }
  return { dataUrl: `data:${mimeType};base64,${buf.toString("base64")}`, mimeType, bytes: buf.length };
}

function parseAiJson(text: string): ExtractedInvoice {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(cleaned) as ExtractedInvoice; }
  catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("AI returned non-JSON response");
    return JSON.parse(m[0]) as ExtractedInvoice;
  }
}

function toNumber(v: unknown, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function toDateString(v: unknown): string | null {
  if (!v || typeof v !== "string") return null;
  const m = v.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
}

// Fuzzy supplier match by name.
async function findSupplierByName(restaurantId: number, name: string | null | undefined): Promise<number | null> {
  if (!name) return null;
  const rows = await db.select({ id: suppliersTable.id, name: suppliersTable.name })
    .from(suppliersTable)
    .where(and(eq(suppliersTable.restaurantId, restaurantId), eq(suppliersTable.isActive, true)));
  const lower = name.toLowerCase().trim();
  const exact = rows.find(r => r.name.toLowerCase().trim() === lower);
  if (exact) return exact.id;
  const partial = rows.find(r => lower.includes(r.name.toLowerCase().trim()) || r.name.toLowerCase().trim().includes(lower));
  return partial?.id ?? null;
}

// Multi-tenant ownership guards. Any line/PO reference written must belong to
// the same restaurant — never trust client-supplied FK ids.
async function ownedInventoryItemIds(restaurantId: number, ids: number[]): Promise<Set<number>> {
  const unique = Array.from(new Set(ids.filter((n): n is number => Number.isInteger(n) && n > 0)));
  if (unique.length === 0) return new Set();
  const rows = await db.select({ id: inventoryItemsTable.id })
    .from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.restaurantId, restaurantId), inArray(inventoryItemsTable.id, unique)));
  return new Set(rows.map(r => r.id));
}

async function ownedPoItemIds(restaurantId: number, ids: number[]): Promise<Set<number>> {
  const unique = Array.from(new Set(ids.filter((n): n is number => Number.isInteger(n) && n > 0)));
  if (unique.length === 0) return new Set();
  const rows = await db.select({ id: purchaseOrderItemsTable.id })
    .from(purchaseOrderItemsTable)
    .innerJoin(purchaseOrdersTable, eq(purchaseOrderItemsTable.purchaseOrderId, purchaseOrdersTable.id))
    .where(and(eq(purchaseOrdersTable.restaurantId, restaurantId), inArray(purchaseOrderItemsTable.id, unique)));
  return new Set(rows.map(r => r.id));
}

// Fuzzy item match by description / name.
function matchInventoryItem(items: Array<{ id: number; name: string }>, description: string): number | null {
  if (!description) return null;
  const d = description.toLowerCase().trim();
  const exact = items.find(i => i.name.toLowerCase().trim() === d);
  if (exact) return exact.id;
  // partial overlap of any non-trivial token
  const tokens = d.split(/[\s,]+/).filter(t => t.length >= 3);
  let best: { id: number; score: number } | null = null;
  for (const item of items) {
    const itemLower = item.name.toLowerCase();
    let score = 0;
    for (const t of tokens) if (itemLower.includes(t)) score += t.length;
    if (score > 0 && (!best || score > best.score)) best = { id: item.id, score };
  }
  return best?.id ?? null;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

const UploadBody = z.object({
  objectPath: z.string().min(1),
  purchaseOrderId: z.number().int().positive().optional(),
  pageCountHint: z.number().int().positive().max(20).optional(),
  notes: z.string().max(2000).optional(),
});

/**
 * POST /upload — accept an already-finalised uploaded file (presigned PUT path),
 * run OCR, persist a draft vendor_invoice + lines, attempt PO + inventory matching.
 *
 * Body: { objectPath, purchaseOrderId?, pageCountHint?, notes? }
 */
router.post(
  `${baseScope}/upload`,
  requireAiCredits(FEATURE_SLUG, (req) => {
    const body = (req.body ?? {}) as { pageCountHint?: number };
    const pages = Math.max(1, Math.min(20, Number(body.pageCountHint ?? 1) || 1));
    return { units: pages };
  }),
  async (req: Request, res: Response) => {
    const reservation = res.locals.aiCreditReservation as AiCreditReservation | null;
    const parsed = UploadBody.safeParse(req.body);
    if (!parsed.success) {
      if (reservation) await refundReservation(reservation, "invalid request");
      res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }
    const restaurantId = Number(req.params.restaurantId);
    const userId = req.user?.sub ?? null;
    const tenantId = req.user?.tenantId ?? null;
    const { objectPath, purchaseOrderId, notes } = parsed.data;

    let actualPages = 1;
    try {
      // 1. Pull file from storage (ACL-checked).
      const { dataUrl, mimeType } = await fetchUploadedFileAsDataUrl(objectPath, restaurantId);

      // 2. OCR via vision provider.
      let v: Awaited<ReturnType<typeof AIProviderService.generateVision>>;
      try {
        v = await AIProviderService.generateVision(
          {
            featureSlug: FEATURE_SLUG,
            tenantId,
            restaurantId,
            userId,
            metadata: { objectPath, purchaseOrderId: purchaseOrderId ?? null },
          },
          {
            messages: [{ role: "user", content: OCR_PROMPT }],
            imageDataUrl: dataUrl,
            temperature: 0.1,
            maxTokens: 4000,
          },
        );
      } catch (providerErr) {
        // Surface configuration / provider availability errors as 4xx so the
        // UI can prompt operators to set up Khana AI rather than showing a
        // generic 500. AIProviderService throws with these strings.
        const msg = (providerErr as Error).message ?? "";
        if (/No AI provider\/model configured|No vision provider configured|provider key/i.test(msg)) {
          if (reservation) await refundReservation(reservation, "ai provider not configured").catch(() => undefined);
          res.status(503).json({
            error: "Khana AI is not configured for vendor invoice OCR yet. Please connect a vision-capable provider in AI settings.",
            code: "CONFIGURATION_REQUIRED",
          });
          return;
        }
        throw providerErr;
      }

      const extracted = parseAiJson(v.text);
      actualPages = Math.max(1, Math.min(20, Number(extracted.pageCount ?? 1) || 1));

      // 3. Resolve supplier from name (best-effort) and PO context.
      const supplierId = await findSupplierByName(restaurantId, extracted.vendorName ?? null);

      let poRow: { id: number; supplierId: number | null } | null = null;
      if (purchaseOrderId) {
        const [po] = await db
          .select({ id: purchaseOrdersTable.id, supplierId: purchaseOrdersTable.supplierId })
          .from(purchaseOrdersTable)
          .where(and(eq(purchaseOrdersTable.id, purchaseOrderId), eq(purchaseOrdersTable.restaurantId, restaurantId)));
        if (!po) throw new HttpError(404, "Purchase order not found");
        poRow = po;
      }

      const poItems = poRow
        ? await db.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.purchaseOrderId, poRow.id))
        : [];
      const inventoryItems = await db
        .select({ id: inventoryItemsTable.id, name: inventoryItemsTable.name })
        .from(inventoryItemsTable)
        .where(and(eq(inventoryItemsTable.restaurantId, restaurantId), eq(inventoryItemsTable.isActive, true)));

      // 4. Persist draft + lines.
      let invoiceId = 0;
      let hasVariance = false;
      await db.transaction(async (tx) => {
        const [inserted] = await tx.insert(vendorInvoicesTable).values({
          restaurantId,
          supplierId: supplierId ?? poRow?.supplierId ?? null,
          purchaseOrderId: purchaseOrderId ?? null,
          status: purchaseOrderId ? "matched" : "draft",
          vendorName: extracted.vendorName ?? null,
          invoiceNumber: extracted.invoiceNumber ?? null,
          invoiceDate: toDateString(extracted.invoiceDate),
          dueDate: toDateString(extracted.dueDate),
          totalAmount: String(toNumber(extracted.totalAmount, 0)),
          taxAmount: String(toNumber(extracted.taxAmount, 0)),
          currency: (extracted.currency ?? "INR").toUpperCase().slice(0, 8),
          uploadObjectPath: objectPath,
          uploadMimeType: mimeType,
          extractedData: (extracted as unknown) as Record<string, unknown>,
          confidenceScores: extracted.confidence ?? {},
          hasPriceVariance: "false",
          notes: notes ?? null,
          createdBy: userId,
        }).returning({ id: vendorInvoicesTable.id });
        invoiceId = inserted!.id;

        const lines = Array.isArray(extracted.lines) ? extracted.lines : [];
        if (lines.length > 0) {
          const lineRows = lines.slice(0, 100).map((l, idx) => {
            const description = String(l.description ?? "").slice(0, 500);
            const matchedItem = matchInventoryItem(inventoryItems, description);
            // PO match: prefer same matched inventory item, else by description.
            let matchedPoItem: (typeof poItems)[number] | null = null;
            if (matchedItem) {
              matchedPoItem = poItems.find(p => p.inventoryItemId === matchedItem) ?? null;
            }
            if (!matchedPoItem && description) {
              const dLower = description.toLowerCase();
              matchedPoItem = poItems.find(p => p.name.toLowerCase().includes(dLower) || dLower.includes(p.name.toLowerCase())) ?? null;
            }
            const unitPrice = toNumber(l.unitPrice, 0);
            const qty = toNumber(l.quantity, 0);
            let variancePct: number | null = null;
            if (matchedPoItem && Number(matchedPoItem.costPerUnit) > 0) {
              const poPrice = Number(matchedPoItem.costPerUnit);
              variancePct = ((unitPrice - poPrice) / poPrice) * 100;
              if (Math.abs(variancePct) > PRICE_VARIANCE_THRESHOLD_PCT) hasVariance = true;
            }
            return {
              vendorInvoiceId: invoiceId,
              lineNumber: idx + 1,
              description,
              quantity: String(qty),
              unit: String(l.unit ?? "unit").slice(0, 32),
              unitPrice: String(unitPrice),
              lineTotal: String(toNumber(l.lineTotal, qty * unitPrice)),
              matchedInventoryItemId: matchedItem ?? null,
              matchedPoItemId: matchedPoItem?.id ?? null,
              priceVariancePct: variancePct == null ? null : String(variancePct.toFixed(2)),
              confidence: String(Math.max(0, Math.min(1, toNumber(l.confidence, 0.5)))),
            };
          });
          await tx.insert(vendorInvoiceLinesTable).values(lineRows);
        }
        if (hasVariance) {
          await tx.update(vendorInvoicesTable)
            .set({ hasPriceVariance: "true", updatedAt: new Date() })
            .where(eq(vendorInvoicesTable.id, invoiceId));
        }
      });

      // 5. Commit credits priced by the actual page count returned by OCR.
      //    `commitReservation` strict-caps the charge to what was reserved —
      //    so if the estimator under-reserved (e.g. user passed pageCountHint=1
      //    on a 3-page PDF) the customer is only billed for the reserved
      //    pages; the overrun is recorded on the ledger so we can tighten the
      //    estimator. If actualPages < reserved, the unused credits are
      //    released back to the wallet automatically.
      const CREDITS_PER_PAGE = 5;
      const actualCredits = Math.max(CREDITS_PER_PAGE, actualPages * CREDITS_PER_PAGE);
      if (reservation) {
        await commitReservation({
          reservation,
          actualCredits,
          requestLogId: v.requestLogId,
          userId,
        });
      }

      await recordAuditLog({
        req,
        module: AUDIT_MODULE,
        action: "uploaded",
        entity: AUDIT_ENTITY,
        entityId: invoiceId,
        restaurantId,
        newValue: {
          objectPath,
          vendorName: extracted.vendorName ?? null,
          invoiceNumber: extracted.invoiceNumber ?? null,
          totalAmount: extracted.totalAmount ?? null,
          lineCount: Array.isArray(extracted.lines) ? extracted.lines.length : 0,
          hasPriceVariance: hasVariance,
          pages: actualPages,
          creditsCharged: Math.min(actualCredits, reservation?.reservedCredits ?? 0),
        },
      });

      res.status(201).json({ id: invoiceId, hasPriceVariance: hasVariance, pages: actualPages });
    } catch (err) {
      if (reservation) await refundReservation(reservation, (err as Error).message).catch(() => undefined);
      // Normalize known client errors (bad MIME, missing PO, oversize file,
      // ACL mismatch) to 4xx so the UI shows actionable messages.
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      logger.error({ err, objectPath, restaurantId }, "vendor invoice OCR failed");
      res.status(500).json({ error: `OCR failed: ${(err as Error).message}` });
    }
  },
);

// ─── List & detail ───────────────────────────────────────────────────────────

router.get(baseScope, async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const conditions = [eq(vendorInvoicesTable.restaurantId, restaurantId)];
  if (status) conditions.push(eq(vendorInvoicesTable.status, status));
  const rows = await db.select().from(vendorInvoicesTable)
    .where(and(...conditions))
    .orderBy(desc(vendorInvoicesTable.createdAt))
    .limit(200);
  res.json(rows);
});

router.get(`${baseScope}/:id`, async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [invoice] = await db.select().from(vendorInvoicesTable)
    .where(and(eq(vendorInvoicesTable.id, id), eq(vendorInvoicesTable.restaurantId, restaurantId)));
  if (!invoice) { res.status(404).json({ error: "Not found" }); return; }
  const lines = await db.select().from(vendorInvoiceLinesTable)
    .where(eq(vendorInvoiceLinesTable.vendorInvoiceId, id))
    .orderBy(vendorInvoiceLinesTable.lineNumber);
  res.json({ invoice, lines });
});

// Signed read URL for the uploaded file (proxied through storage route).
router.get(`${baseScope}/:id/file`, async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [invoice] = await db.select({
    uploadObjectPath: vendorInvoicesTable.uploadObjectPath,
    uploadMimeType: vendorInvoicesTable.uploadMimeType,
  }).from(vendorInvoicesTable)
    .where(and(eq(vendorInvoicesTable.id, id), eq(vendorInvoicesTable.restaurantId, restaurantId)));
  if (!invoice) { res.status(404).json({ error: "Not found" }); return; }
  try {
    const file = await objectStorage.getObjectEntityFile(invoice.uploadObjectPath);
    const acl = await getObjectAclPolicy(file);
    if (!isAclOwnerOf(acl, restaurantId, ObjectPermission.READ)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", (metadata.contentType as string) || invoice.uploadMimeType || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=300");
    file.createReadStream().on("error", () => res.status(500).end()).pipe(res);
  } catch (err) {
    logger.warn({ err }, "vendor invoice file fetch failed");
    res.status(404).json({ error: "File unavailable" });
  }
});

// ─── Correct / Match PO ──────────────────────────────────────────────────────

const PatchBody = z.object({
  supplierId: z.number().int().positive().nullable().optional(),
  vendorName: z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  totalAmount: z.number().nonnegative().optional(),
  taxAmount: z.number().nonnegative().optional(),
  currency: z.string().max(8).optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(z.object({
    id: z.number().int().positive().optional(),
    description: z.string(),
    quantity: z.number().nonnegative(),
    unit: z.string().max(32),
    unitPrice: z.number().nonnegative(),
    lineTotal: z.number().nonnegative().optional(),
    matchedInventoryItemId: z.number().int().positive().nullable().optional(),
    matchedPoItemId: z.number().int().positive().nullable().optional(),
  })).optional(),
});

async function recomputeVariance(tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0], invoiceId: number, restaurantId: number): Promise<boolean> {
  const lines = await tx.select().from(vendorInvoiceLinesTable).where(eq(vendorInvoiceLinesTable.vendorInvoiceId, invoiceId));
  let hasVariance = false;
  for (const l of lines) {
    if (l.matchedPoItemId) {
      // Restaurant-scoped lookup so cross-tenant PO ids can never leak prices.
      const [po] = await tx.select({ costPerUnit: purchaseOrderItemsTable.costPerUnit })
        .from(purchaseOrderItemsTable)
        .innerJoin(purchaseOrdersTable, eq(purchaseOrderItemsTable.purchaseOrderId, purchaseOrdersTable.id))
        .where(and(
          eq(purchaseOrderItemsTable.id, l.matchedPoItemId),
          eq(purchaseOrdersTable.restaurantId, restaurantId),
        ));
      if (po && Number(po.costPerUnit) > 0) {
        const pct = ((Number(l.unitPrice) - Number(po.costPerUnit)) / Number(po.costPerUnit)) * 100;
        const newPct = pct.toFixed(2);
        await tx.update(vendorInvoiceLinesTable)
          .set({ priceVariancePct: newPct })
          .where(eq(vendorInvoiceLinesTable.id, l.id));
        if (Math.abs(pct) > PRICE_VARIANCE_THRESHOLD_PCT) hasVariance = true;
      }
    } else if (l.priceVariancePct != null) {
      await tx.update(vendorInvoiceLinesTable)
        .set({ priceVariancePct: null })
        .where(eq(vendorInvoiceLinesTable.id, l.id));
    }
  }
  return hasVariance;
}

router.patch(`${baseScope}/:id/correct`, async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() }); return; }
  const body = parsed.data;

  const [before] = await db.select().from(vendorInvoicesTable)
    .where(and(eq(vendorInvoicesTable.id, id), eq(vendorInvoicesTable.restaurantId, restaurantId)));
  if (!before) { res.status(404).json({ error: "Not found" }); return; }
  if (before.status === "approved") { res.status(409).json({ error: "Already approved — cannot edit" }); return; }

  await db.transaction(async (tx) => {
    const headerPatch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.supplierId !== undefined) {
      // Validate cross-tenant: only accept supplier ids that belong to this
      // restaurant. Unknown / cross-tenant ids are coerced to null rather
      // than silently writing a foreign FK.
      if (body.supplierId == null) {
        headerPatch.supplierId = null;
      } else {
        const [supplier] = await tx.select({ id: suppliersTable.id })
          .from(suppliersTable)
          .where(and(eq(suppliersTable.id, body.supplierId), eq(suppliersTable.restaurantId, restaurantId)));
        headerPatch.supplierId = supplier?.id ?? null;
      }
    }
    if (body.vendorName !== undefined) headerPatch.vendorName = body.vendorName;
    if (body.invoiceNumber !== undefined) headerPatch.invoiceNumber = body.invoiceNumber;
    if (body.invoiceDate !== undefined) headerPatch.invoiceDate = toDateString(body.invoiceDate);
    if (body.dueDate !== undefined) headerPatch.dueDate = toDateString(body.dueDate);
    if (body.totalAmount !== undefined) headerPatch.totalAmount = String(body.totalAmount);
    if (body.taxAmount !== undefined) headerPatch.taxAmount = String(body.taxAmount);
    if (body.currency !== undefined) headerPatch.currency = body.currency.toUpperCase();
    if (body.notes !== undefined) headerPatch.notes = body.notes;
    await tx.update(vendorInvoicesTable).set(headerPatch).where(eq(vendorInvoicesTable.id, id));

    if (body.lines) {
      // Validate FK ownership before persisting — client-supplied ids must
      // belong to this restaurant or they're silently nulled out. This stops
      // cross-tenant references from leaking into inventory_transactions /
      // inventory_item_batches at approve time.
      const invIds = body.lines.map(l => l.matchedInventoryItemId).filter((n): n is number => typeof n === "number");
      const poIds = body.lines.map(l => l.matchedPoItemId).filter((n): n is number => typeof n === "number");
      const ownedInv = await ownedInventoryItemIds(restaurantId, invIds);
      const ownedPo = await ownedPoItemIds(restaurantId, poIds);

      // Replace-all lines (simpler than diffing — invoice line edits are bulk).
      await tx.delete(vendorInvoiceLinesTable).where(eq(vendorInvoiceLinesTable.vendorInvoiceId, id));
      if (body.lines.length > 0) {
        await tx.insert(vendorInvoiceLinesTable).values(body.lines.slice(0, 100).map((l, idx) => ({
          vendorInvoiceId: id,
          lineNumber: idx + 1,
          description: l.description.slice(0, 500),
          quantity: String(l.quantity),
          unit: l.unit,
          unitPrice: String(l.unitPrice),
          lineTotal: String(l.lineTotal ?? l.quantity * l.unitPrice),
          matchedInventoryItemId: l.matchedInventoryItemId && ownedInv.has(l.matchedInventoryItemId)
            ? l.matchedInventoryItemId : null,
          matchedPoItemId: l.matchedPoItemId && ownedPo.has(l.matchedPoItemId)
            ? l.matchedPoItemId : null,
          confidence: "1.000",
        })));
      }
    }

    const hasVariance = await recomputeVariance(tx, id, restaurantId);
    await tx.update(vendorInvoicesTable)
      .set({ hasPriceVariance: hasVariance ? "true" : "false", updatedAt: new Date() })
      .where(eq(vendorInvoicesTable.id, id));
  });

  const [after] = await db.select().from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  await recordAuditLog({
    req, module: AUDIT_MODULE, action: "corrected", entity: AUDIT_ENTITY,
    entityId: id, restaurantId, oldValue: before, newValue: after,
  });
  res.json(after);
});

const MatchPoBody = z.object({ purchaseOrderId: z.number().int().positive().nullable() });

router.post(`${baseScope}/:id/match-po`, async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const parsed = MatchPoBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const { purchaseOrderId } = parsed.data;

  const [before] = await db.select().from(vendorInvoicesTable)
    .where(and(eq(vendorInvoicesTable.id, id), eq(vendorInvoicesTable.restaurantId, restaurantId)));
  if (!before) { res.status(404).json({ error: "Not found" }); return; }
  if (before.status === "approved") { res.status(409).json({ error: "Already approved" }); return; }

  if (purchaseOrderId) {
    const [po] = await db.select({ id: purchaseOrdersTable.id })
      .from(purchaseOrdersTable)
      .where(and(eq(purchaseOrdersTable.id, purchaseOrderId), eq(purchaseOrdersTable.restaurantId, restaurantId)));
    if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  }

  await db.transaction(async (tx) => {
    await tx.update(vendorInvoicesTable).set({
      purchaseOrderId: purchaseOrderId,
      status: purchaseOrderId ? "matched" : "draft",
      updatedAt: new Date(),
    }).where(eq(vendorInvoicesTable.id, id));

    // Auto-rematch lines against the new PO.
    const poItems = purchaseOrderId
      ? await tx.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.purchaseOrderId, purchaseOrderId))
      : [];
    const lines = await tx.select().from(vendorInvoiceLinesTable).where(eq(vendorInvoiceLinesTable.vendorInvoiceId, id));
    for (const l of lines) {
      let matchedPo: (typeof poItems)[number] | null = null;
      if (l.matchedInventoryItemId) {
        matchedPo = poItems.find(p => p.inventoryItemId === l.matchedInventoryItemId) ?? null;
      }
      if (!matchedPo && l.description) {
        const d = l.description.toLowerCase();
        matchedPo = poItems.find(p => p.name.toLowerCase().includes(d) || d.includes(p.name.toLowerCase())) ?? null;
      }
      await tx.update(vendorInvoiceLinesTable)
        .set({ matchedPoItemId: matchedPo?.id ?? null })
        .where(eq(vendorInvoiceLinesTable.id, l.id));
    }
    const hasVariance = await recomputeVariance(tx, id, restaurantId);
    await tx.update(vendorInvoicesTable)
      .set({ hasPriceVariance: hasVariance ? "true" : "false", updatedAt: new Date() })
      .where(eq(vendorInvoicesTable.id, id));
  });

  await recordAuditLog({
    req, module: AUDIT_MODULE, action: "matched_po", entity: AUDIT_ENTITY,
    entityId: id, restaurantId,
    oldValue: { purchaseOrderId: before.purchaseOrderId },
    newValue: { purchaseOrderId },
  });
  const [after] = await db.select().from(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  res.json(after);
});

// ─── Approve / Reject ────────────────────────────────────────────────────────

const ApproveBody = z.object({
  expenseCategoryId: z.number().int().positive(),
  branchId: z.number().int().positive().optional(),
  paymentMethod: z.string().max(32).optional(),
});

router.post(`${baseScope}/:id/approve`, async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const userId = req.user?.sub ?? null;
  const parsed = ApproveBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() }); return; }
  const { expenseCategoryId, branchId, paymentMethod } = parsed.data;

  const [invoice] = await db.select().from(vendorInvoicesTable)
    .where(and(eq(vendorInvoicesTable.id, id), eq(vendorInvoicesTable.restaurantId, restaurantId)));
  if (!invoice) { res.status(404).json({ error: "Not found" }); return; }
  if (invoice.status === "approved") { res.status(409).json({ error: "Already approved" }); return; }
  if (invoice.status === "rejected") { res.status(409).json({ error: "Cannot approve a rejected invoice" }); return; }

  const [category] = await db.select().from(expenseCategoriesTable)
    .where(and(eq(expenseCategoriesTable.id, expenseCategoryId), eq(expenseCategoriesTable.restaurantId, restaurantId)));
  if (!category) { res.status(400).json({ error: "Expense category not found" }); return; }

  // Validate branchId ownership (parity with other FK checks).
  if (branchId != null) {
    const [branch] = await db.select({ id: branchesTable.id })
      .from(branchesTable)
      .where(and(eq(branchesTable.id, branchId), eq(branchesTable.restaurantId, restaurantId)));
    if (!branch) { res.status(400).json({ error: "Branch not found for this restaurant" }); return; }
  }

  let expenseId = 0;
  let alreadyApproved = false;
  await db.transaction(async (tx) => {
    // Atomic, idempotent state transition: only one concurrent caller can
    // flip status away from draft/matched. We pre-claim the row here so
    // duplicate expense posting and double stock increments are impossible
    // even under racing approve requests.
    const claimed = await tx.update(vendorInvoicesTable)
      .set({ status: "approving", updatedAt: new Date() })
      .where(and(
        eq(vendorInvoicesTable.id, id),
        eq(vendorInvoicesTable.restaurantId, restaurantId),
        inArray(vendorInvoicesTable.status, ["draft", "matched"]),
        sql`${vendorInvoicesTable.expenseId} IS NULL`,
      ))
      .returning({ id: vendorInvoicesTable.id });
    if (claimed.length === 0) {
      alreadyApproved = true;
      return;
    }

    // 1. Create the vendor bill (expense row).
    const [expense] = await tx.insert(expensesTable).values({
      restaurantId,
      branchId: branchId ?? null,
      categoryId: expenseCategoryId,
      amount: invoice.totalAmount,
      expenseDate: invoice.invoiceDate ?? new Date().toISOString().slice(0, 10),
      payee: invoice.vendorName ?? null,
      paymentMethod: paymentMethod ?? "bank transfer",
      notes: `Vendor invoice ${invoice.invoiceNumber ?? `#${id}`}${invoice.notes ? ` — ${invoice.notes}` : ""}`,
      receiptUrl: invoice.uploadObjectPath,
      status: "approved",
      expenseType: category.categoryKind,
      approvedByUserId: userId,
      approvedAt: new Date(),
      createdBy: userId,
    }).returning({ id: expensesTable.id });
    expenseId = expense!.id;

    // 2. Increment stock on each matched inventory line.
    const lines = await tx.select().from(vendorInvoiceLinesTable).where(eq(vendorInvoiceLinesTable.vendorInvoiceId, id));

    // Re-validate FK ownership *inside* the transaction — even if a stale row
    // somehow has a cross-tenant id (older data, race with another write), we
    // refuse to write inventory_transactions / batches that would alias other
    // restaurants' items or PO lines.
    const invIds = lines.map(l => l.matchedInventoryItemId).filter((n): n is number => typeof n === "number");
    const poIds = lines.map(l => l.matchedPoItemId).filter((n): n is number => typeof n === "number");
    const ownedInv = await ownedInventoryItemIds(restaurantId, invIds);
    const ownedPo = await ownedPoItemIds(restaurantId, poIds);

    for (const line of lines) {
      if (!line.matchedInventoryItemId || !ownedInv.has(line.matchedInventoryItemId)) continue;
      const safePoItemId = line.matchedPoItemId && ownedPo.has(line.matchedPoItemId) ? line.matchedPoItemId : null;
      const qty = Number(line.quantity);
      if (qty <= 0) continue;

      await tx.update(inventoryItemsTable)
        .set({
          currentStock: sql`${inventoryItemsTable.currentStock} + ${qty}`,
          costPerUnit: line.unitPrice,
          updatedAt: new Date(),
        })
        .where(and(eq(inventoryItemsTable.id, line.matchedInventoryItemId), eq(inventoryItemsTable.restaurantId, restaurantId)));

      // Mirror into inventory_stock if a row exists (per-branch stock table).
      await tx.update(inventoryStockTable)
        .set({ quantity: sql`${inventoryStockTable.quantity} + ${qty}`, updatedAt: new Date() })
        .where(and(eq(inventoryStockTable.itemId, line.matchedInventoryItemId), eq(inventoryStockTable.restaurantId, restaurantId)));

      await tx.insert(inventoryTransactionsTable).values({
        itemId: line.matchedInventoryItemId,
        restaurantId,
        type: "receive",
        quantity: String(qty),
        notes: `Vendor invoice ${invoice.invoiceNumber ?? `#${id}`} line ${line.lineNumber}`,
        referenceId: id,
        referenceType: "vendor_invoice",
      });

      await tx.insert(inventoryItemBatchesTable).values({
        restaurantId,
        inventoryItemId: line.matchedInventoryItemId,
        batchNumber: invoice.invoiceNumber ?? null,
        quantityReceived: String(qty),
        quantityRemaining: String(qty),
        purchaseOrderId: invoice.purchaseOrderId ?? null,
        purchaseOrderItemId: safePoItemId,
        notes: `Booked from vendor invoice #${id}`,
      });
    }

    // 3. Flip invoice to approved + link expense.
    await tx.update(vendorInvoicesTable).set({
      status: "approved",
      expenseId,
      approvedBy: userId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(vendorInvoicesTable.id, id));

    // 4. If linked to a PO that has no receivedAt yet, mark it received.
    if (invoice.purchaseOrderId) {
      await tx.update(purchaseOrdersTable).set({
        status: "received",
        receivedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(purchaseOrdersTable.id, invoice.purchaseOrderId),
        eq(purchaseOrdersTable.restaurantId, restaurantId),
      ));
    }
  });

  if (alreadyApproved) {
    res.status(409).json({ error: "Invoice was already approved or is being approved by another request" });
    return;
  }

  await recordAuditLog({
    req, module: AUDIT_MODULE, action: "approved", entity: AUDIT_ENTITY,
    entityId: id, restaurantId,
    newValue: { expenseId, totalAmount: invoice.totalAmount, supplierId: invoice.supplierId, purchaseOrderId: invoice.purchaseOrderId },
  });

  res.json({ id, expenseId, status: "approved" });
});

const RejectBody = z.object({ reason: z.string().min(1).max(500) });
router.post(`${baseScope}/:id/reject`, async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const parsed = RejectBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Reason required" }); return; }
  const [before] = await db.select().from(vendorInvoicesTable)
    .where(and(eq(vendorInvoicesTable.id, id), eq(vendorInvoicesTable.restaurantId, restaurantId)));
  if (!before) { res.status(404).json({ error: "Not found" }); return; }
  if (before.status === "approved") { res.status(409).json({ error: "Already approved" }); return; }
  await db.update(vendorInvoicesTable).set({
    status: "rejected",
    rejectionReason: parsed.data.reason,
    updatedAt: new Date(),
  }).where(eq(vendorInvoicesTable.id, id));
  await recordAuditLog({
    req, module: AUDIT_MODULE, action: "rejected", entity: AUDIT_ENTITY,
    entityId: id, restaurantId, newValue: { reason: parsed.data.reason },
  });
  res.json({ id, status: "rejected" });
});

router.delete(`${baseScope}/:id`, async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [before] = await db.select().from(vendorInvoicesTable)
    .where(and(eq(vendorInvoicesTable.id, id), eq(vendorInvoicesTable.restaurantId, restaurantId)));
  if (!before) { res.status(404).json({ error: "Not found" }); return; }
  if (before.status === "approved") { res.status(409).json({ error: "Cannot delete approved invoice" }); return; }
  await db.delete(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
  await recordAuditLog({
    req, module: AUDIT_MODULE, action: "deleted", entity: AUDIT_ENTITY,
    entityId: id, restaurantId, oldValue: before,
  });
  res.status(204).send();
});

export default router;
