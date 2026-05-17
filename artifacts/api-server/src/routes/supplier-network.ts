import { Router } from "express";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import {
  db,
  suppliersTable,
  supplierCatalogItemsTable,
  purchaseRequestsTable,
  purchaseRequestItemsTable,
  purchaseRequestSuppliersTable,
  supplierQuotesTable,
  supplierQuoteItemsTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  inventoryItemsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { requirePlanFeature } from "../middleware/planFeature";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { recordAuditLog } from "../lib/audit";
import { NEW_AUDIT_ENTITIES, AUDIT_ACTIONS } from "@workspace/db";

const router = Router();

const scope = ["/restaurants/:restaurantId/supplier-network", "/restaurants/:restaurantId/supplier-catalog", "/restaurants/:restaurantId/purchase-requests", "/restaurants/:restaurantId/purchase-history"];

router.use(scope, validateRestaurantAccess, requirePlanFeature("supplier_network"));

// ───────────────────────── Supplier extra fields ─────────────────────────
router.patch("/restaurants/:restaurantId/supplier-network/suppliers/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const body = req.body ?? {};
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["leadTimeDays", "minOrderValue", "paymentTerms", "reliabilityScore", "notes", "isCatalogPublic"]) {
    if (k in body) updates[k] = body[k];
  }
  if (Array.isArray(body.categoryTags)) updates.categoryTags = body.categoryTags;
  if (body.regeneratePortalToken === true) updates.portalToken = randomBytes(18).toString("base64url");
  const [old] = await db.select().from(suppliersTable).where(and(eq(suppliersTable.id, id), eq(suppliersTable.restaurantId, restaurantId)));
  if (!old) return void res.status(404).json({ error: "Supplier not found" });
  const [updated] = await db.update(suppliersTable).set(updates).where(and(eq(suppliersTable.id, id), eq(suppliersTable.restaurantId, restaurantId))).returning();
  await recordAuditLog({ req, module: "supplier_network", action: AUDIT_ACTIONS.UPDATED, entity: "supplier", entityId: id, restaurantId, oldValue: old, newValue: updated });
  res.json(updated);
});

// ───────────────────────── Supplier catalog items ─────────────────────────
router.get("/restaurants/:restaurantId/supplier-catalog", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { supplierId, inventoryItemId, q } = req.query;
  const conds = [eq(supplierCatalogItemsTable.restaurantId, restaurantId)];
  if (supplierId) conds.push(eq(supplierCatalogItemsTable.supplierId, Number(supplierId)));
  if (inventoryItemId) conds.push(eq(supplierCatalogItemsTable.inventoryItemId, Number(inventoryItemId)));
  const rows = await db.select({
    id: supplierCatalogItemsTable.id,
    restaurantId: supplierCatalogItemsTable.restaurantId,
    supplierId: supplierCatalogItemsTable.supplierId,
    supplierName: suppliersTable.name,
    inventoryItemId: supplierCatalogItemsTable.inventoryItemId,
    inventoryItemName: inventoryItemsTable.name,
    name: supplierCatalogItemsTable.name,
    sku: supplierCatalogItemsTable.sku,
    category: supplierCatalogItemsTable.category,
    unit: supplierCatalogItemsTable.unit,
    packSize: supplierCatalogItemsTable.packSize,
    pricePerUnit: supplierCatalogItemsTable.pricePerUnit,
    minOrderQuantity: supplierCatalogItemsTable.minOrderQuantity,
    leadTimeDays: supplierCatalogItemsTable.leadTimeDays,
    isAvailable: supplierCatalogItemsTable.isAvailable,
    notes: supplierCatalogItemsTable.notes,
    lastUpdatedAt: supplierCatalogItemsTable.lastUpdatedAt,
  }).from(supplierCatalogItemsTable)
    .leftJoin(suppliersTable, eq(suppliersTable.id, supplierCatalogItemsTable.supplierId))
    .leftJoin(inventoryItemsTable, eq(inventoryItemsTable.id, supplierCatalogItemsTable.inventoryItemId))
    .where(and(...conds))
    .orderBy(desc(supplierCatalogItemsTable.lastUpdatedAt));
  const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(String(q).toLowerCase()) || (r.sku ?? "").toLowerCase().includes(String(q).toLowerCase())) : rows;
  res.json(filtered);
});

router.post("/restaurants/:restaurantId/supplier-catalog", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const b = req.body ?? {};
  if (!b.supplierId || !b.name) return void res.status(400).json({ error: "supplierId and name required" });
  const [supplier] = await db.select().from(suppliersTable).where(and(eq(suppliersTable.id, Number(b.supplierId)), eq(suppliersTable.restaurantId, restaurantId)));
  if (!supplier) return void res.status(400).json({ error: "Invalid supplier" });
  const [row] = await db.insert(supplierCatalogItemsTable).values({
    restaurantId,
    supplierId: Number(b.supplierId),
    inventoryItemId: b.inventoryItemId ? Number(b.inventoryItemId) : null,
    name: String(b.name),
    sku: b.sku ?? null,
    category: b.category ?? null,
    unit: b.unit ?? "kg",
    packSize: b.packSize != null ? String(b.packSize) : "1.000",
    pricePerUnit: b.pricePerUnit != null ? String(b.pricePerUnit) : "0.00",
    minOrderQuantity: b.minOrderQuantity != null ? String(b.minOrderQuantity) : "0.000",
    leadTimeDays: b.leadTimeDays != null ? Number(b.leadTimeDays) : null,
    isAvailable: b.isAvailable !== false,
    notes: b.notes ?? null,
  }).returning();
  await recordAuditLog({ req, module: "supplier_network", action: AUDIT_ACTIONS.CREATED, entity: NEW_AUDIT_ENTITIES.SUPPLIER_CATALOG_ITEM, entityId: row.id, restaurantId, newValue: row });
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/supplier-catalog/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const b = req.body ?? {};
  const updates: Record<string, unknown> = { updatedAt: new Date(), lastUpdatedAt: new Date() };
  for (const k of ["name", "sku", "category", "unit", "notes", "isAvailable"]) if (k in b) updates[k] = b[k];
  for (const k of ["packSize", "pricePerUnit", "minOrderQuantity"]) if (k in b && b[k] != null) updates[k] = String(b[k]);
  if ("leadTimeDays" in b) updates.leadTimeDays = b.leadTimeDays != null ? Number(b.leadTimeDays) : null;
  if ("inventoryItemId" in b) updates.inventoryItemId = b.inventoryItemId != null ? Number(b.inventoryItemId) : null;
  const [old] = await db.select().from(supplierCatalogItemsTable).where(and(eq(supplierCatalogItemsTable.id, id), eq(supplierCatalogItemsTable.restaurantId, restaurantId)));
  if (!old) return void res.status(404).json({ error: "Not found" });
  const [updated] = await db.update(supplierCatalogItemsTable).set(updates).where(and(eq(supplierCatalogItemsTable.id, id), eq(supplierCatalogItemsTable.restaurantId, restaurantId))).returning();
  await recordAuditLog({ req, module: "supplier_network", action: AUDIT_ACTIONS.UPDATED, entity: NEW_AUDIT_ENTITIES.SUPPLIER_CATALOG_ITEM, entityId: id, restaurantId, oldValue: old, newValue: updated });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/supplier-catalog/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [old] = await db.select().from(supplierCatalogItemsTable).where(and(eq(supplierCatalogItemsTable.id, id), eq(supplierCatalogItemsTable.restaurantId, restaurantId)));
  if (!old) return void res.status(404).json({ error: "Not found" });
  await db.delete(supplierCatalogItemsTable).where(and(eq(supplierCatalogItemsTable.id, id), eq(supplierCatalogItemsTable.restaurantId, restaurantId)));
  await recordAuditLog({ req, module: "supplier_network", action: AUDIT_ACTIONS.DELETED, entity: NEW_AUDIT_ENTITIES.SUPPLIER_CATALOG_ITEM, entityId: id, restaurantId, oldValue: old });
  res.status(204).send();
});

/** Best-vendor ranking for one inventory item. Lower = better. */
router.get("/restaurants/:restaurantId/supplier-catalog/by-item/:inventoryItemId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const inventoryItemId = Number(req.params.inventoryItemId);
  const rows = await db.select({
    id: supplierCatalogItemsTable.id,
    supplierId: supplierCatalogItemsTable.supplierId,
    supplierName: suppliersTable.name,
    supplierReliability: suppliersTable.reliabilityScore,
    supplierPaymentTerms: suppliersTable.paymentTerms,
    name: supplierCatalogItemsTable.name,
    unit: supplierCatalogItemsTable.unit,
    packSize: supplierCatalogItemsTable.packSize,
    pricePerUnit: supplierCatalogItemsTable.pricePerUnit,
    minOrderQuantity: supplierCatalogItemsTable.minOrderQuantity,
    leadTimeDays: supplierCatalogItemsTable.leadTimeDays,
    isAvailable: supplierCatalogItemsTable.isAvailable,
  }).from(supplierCatalogItemsTable)
    .leftJoin(suppliersTable, eq(suppliersTable.id, supplierCatalogItemsTable.supplierId))
    .where(and(
      eq(supplierCatalogItemsTable.restaurantId, restaurantId),
      eq(supplierCatalogItemsTable.inventoryItemId, inventoryItemId),
      eq(supplierCatalogItemsTable.isAvailable, true),
    ));

  const prices = rows.map((r) => Number(r.pricePerUnit)).filter((n) => n > 0);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const ranked = rows.map((r) => {
    const price = Number(r.pricePerUnit);
    const lead = r.leadTimeDays ?? 7;
    const rel = r.supplierReliability ? Number(r.supplierReliability) : 3;
    const priceScore = minPrice > 0 && price > 0 ? (price / minPrice) : 1;
    const leadScore = Math.min(lead / 7, 3);
    const relScore = 1 + (5 - rel) * 0.15;
    const score = priceScore * 0.55 + leadScore * 0.25 + relScore * 0.20;
    return { ...r, _score: Number(score.toFixed(3)) };
  }).sort((a, b) => a._score - b._score);
  res.json({ inventoryItemId, vendors: ranked, recommended: ranked[0] ?? null });
});

// ───────────────────────── Purchase Requests (RFQ) ─────────────────────────
async function loadRequest(restaurantId: number, id: number) {
  const [request] = await db.select().from(purchaseRequestsTable).where(and(eq(purchaseRequestsTable.id, id), eq(purchaseRequestsTable.restaurantId, restaurantId)));
  if (!request) return null;
  const items = await db.select().from(purchaseRequestItemsTable).where(eq(purchaseRequestItemsTable.requestId, id));
  const recipients = await db.select({
    id: purchaseRequestSuppliersTable.id,
    supplierId: purchaseRequestSuppliersTable.supplierId,
    supplierName: suppliersTable.name,
    status: purchaseRequestSuppliersTable.status,
    sentAt: purchaseRequestSuppliersTable.sentAt,
    respondedAt: purchaseRequestSuppliersTable.respondedAt,
  }).from(purchaseRequestSuppliersTable)
    .leftJoin(suppliersTable, eq(suppliersTable.id, purchaseRequestSuppliersTable.supplierId))
    .where(eq(purchaseRequestSuppliersTable.requestId, id));
  const quotes = await db.select({
    id: supplierQuotesTable.id,
    supplierId: supplierQuotesTable.supplierId,
    supplierName: suppliersTable.name,
    supplierReliability: suppliersTable.reliabilityScore,
    status: supplierQuotesTable.status,
    totalAmount: supplierQuotesTable.totalAmount,
    leadTimeDays: supplierQuotesTable.leadTimeDays,
    notes: supplierQuotesTable.notes,
    source: supplierQuotesTable.source,
    submittedAt: supplierQuotesTable.submittedAt,
  }).from(supplierQuotesTable)
    .leftJoin(suppliersTable, eq(suppliersTable.id, supplierQuotesTable.supplierId))
    .where(eq(supplierQuotesTable.requestId, id));
  const quoteIds = quotes.map((q) => q.id);
  const quoteItems = quoteIds.length
    ? await db.select().from(supplierQuoteItemsTable).where(inArray(supplierQuoteItemsTable.quoteId, quoteIds))
    : [];
  return { request, items, recipients, quotes: quotes.map((q) => ({ ...q, items: quoteItems.filter((qi) => qi.quoteId === q.id) })) };
}

router.get("/restaurants/:restaurantId/purchase-requests", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(purchaseRequestsTable).where(eq(purchaseRequestsTable.restaurantId, restaurantId)).orderBy(desc(purchaseRequestsTable.createdAt));
  res.json(rows);
});

router.get("/restaurants/:restaurantId/purchase-requests/:id", async (req, res) => {
  const full = await loadRequest(Number(req.params.restaurantId), Number(req.params.id));
  if (!full) return void res.status(404).json({ error: "Not found" });
  res.json(full);
});

router.post("/restaurants/:restaurantId/purchase-requests", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const b = req.body ?? {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!b.title || items.length === 0) return void res.status(400).json({ error: "title and items required" });
  const supplierIds: number[] = Array.isArray(b.supplierIds) ? b.supplierIds.map(Number).filter((n: number) => Number.isFinite(n)) : [];

  const created = await db.transaction(async (tx) => {
    const [request] = await tx.insert(purchaseRequestsTable).values({
      restaurantId,
      title: String(b.title),
      notes: b.notes ?? null,
      status: "draft",
      neededBy: b.neededBy ? new Date(b.neededBy) : null,
      createdBy: req.user?.sub ?? null,
    }).returning();
    for (const it of items) {
      await tx.insert(purchaseRequestItemsTable).values({
        requestId: request.id,
        inventoryItemId: it.inventoryItemId ? Number(it.inventoryItemId) : null,
        name: String(it.name ?? "Item"),
        unit: it.unit ?? "kg",
        quantity: it.quantity != null ? String(it.quantity) : "0.000",
        notes: it.notes ?? null,
      });
    }
    if (supplierIds.length) {
      await tx.insert(purchaseRequestSuppliersTable).values(
        supplierIds.map((sid) => ({ requestId: request.id, supplierId: sid, status: "sent" as const })),
      );
    }
    return request;
  });
  await recordAuditLog({ req, module: "supplier_network", action: AUDIT_ACTIONS.CREATED, entity: NEW_AUDIT_ENTITIES.PURCHASE_REQUEST, entityId: created.id, restaurantId, newValue: created });
  const full = await loadRequest(restaurantId, created.id);
  res.status(201).json(full);
});

router.post("/restaurants/:restaurantId/purchase-requests/:id/send", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const supplierIds: number[] = Array.isArray(req.body?.supplierIds) ? req.body.supplierIds.map(Number).filter((n: number) => Number.isFinite(n)) : [];
  const [request] = await db.select().from(purchaseRequestsTable).where(and(eq(purchaseRequestsTable.id, id), eq(purchaseRequestsTable.restaurantId, restaurantId)));
  if (!request) return void res.status(404).json({ error: "Not found" });
  if (supplierIds.length === 0) return void res.status(400).json({ error: "supplierIds required" });

  await db.transaction(async (tx) => {
    const existing = await tx.select().from(purchaseRequestSuppliersTable).where(eq(purchaseRequestSuppliersTable.requestId, id));
    const have = new Set(existing.map((r) => r.supplierId));
    const toAdd = supplierIds.filter((sid) => !have.has(sid));
    if (toAdd.length) {
      await tx.insert(purchaseRequestSuppliersTable).values(toAdd.map((sid) => ({ requestId: id, supplierId: sid, status: "sent" as const })));
    }
    await tx.update(purchaseRequestsTable).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(eq(purchaseRequestsTable.id, id));
  });
  await recordAuditLog({ req, module: "supplier_network", action: "sent", entity: NEW_AUDIT_ENTITIES.PURCHASE_REQUEST, entityId: id, restaurantId, newValue: { supplierIds } });
  const full = await loadRequest(restaurantId, id);
  res.json(full);
});

router.post("/restaurants/:restaurantId/purchase-requests/:id/quotes", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const b = req.body ?? {};
  if (!b.supplierId) return void res.status(400).json({ error: "supplierId required" });
  const [request] = await db.select().from(purchaseRequestsTable).where(and(eq(purchaseRequestsTable.id, id), eq(purchaseRequestsTable.restaurantId, restaurantId)));
  if (!request) return void res.status(404).json({ error: "Not found" });
  const items = await db.select().from(purchaseRequestItemsTable).where(eq(purchaseRequestItemsTable.requestId, id));
  const lineMap = new Map<number, number>();
  for (const it of items) lineMap.set(it.id, Number(it.quantity));
  const quoteItems: Array<{ requestItemId: number; pricePerUnit: string; available: boolean; alternativeName: string | null; notes: string | null }> = [];
  let computedTotal = 0;
  for (const qi of (b.items ?? []) as Array<Record<string, unknown>>) {
    const requestItemId = Number(qi.requestItemId);
    if (!lineMap.has(requestItemId)) continue;
    const price = Number(qi.pricePerUnit ?? 0);
    const qty = lineMap.get(requestItemId)!;
    const available = qi.available !== false;
    if (available) computedTotal += price * qty;
    quoteItems.push({
      requestItemId,
      pricePerUnit: String(price.toFixed(2)),
      available,
      alternativeName: (qi.alternativeName as string | null) ?? null,
      notes: (qi.notes as string | null) ?? null,
    });
  }
  const totalAmount = b.totalAmount != null ? String(Number(b.totalAmount).toFixed(2)) : String(computedTotal.toFixed(2));

  const quote = await db.transaction(async (tx) => {
    const [q] = await tx.insert(supplierQuotesTable).values({
      requestId: id,
      supplierId: Number(b.supplierId),
      status: "submitted",
      totalAmount,
      leadTimeDays: b.leadTimeDays != null ? Number(b.leadTimeDays) : null,
      notes: b.notes ?? null,
      source: b.source ?? "manual",
    }).returning();
    if (quoteItems.length) {
      await tx.insert(supplierQuoteItemsTable).values(quoteItems.map((qi) => ({ ...qi, quoteId: q.id })));
    }
    await tx.update(purchaseRequestSuppliersTable).set({ status: "received", respondedAt: new Date() })
      .where(and(eq(purchaseRequestSuppliersTable.requestId, id), eq(purchaseRequestSuppliersTable.supplierId, Number(b.supplierId))));
    if (request.status === "draft" || request.status === "sent") {
      await tx.update(purchaseRequestsTable).set({ status: "quoted", updatedAt: new Date() }).where(eq(purchaseRequestsTable.id, id));
    }
    return q;
  });
  await recordAuditLog({ req, module: "supplier_network", action: AUDIT_ACTIONS.CREATED, entity: NEW_AUDIT_ENTITIES.SUPPLIER_QUOTE, entityId: quote.id, restaurantId, newValue: quote });
  const full = await loadRequest(restaurantId, id);
  res.status(201).json(full);
});

router.post("/restaurants/:restaurantId/purchase-requests/:id/award", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const quoteId = Number(req.body?.quoteId);
  if (!quoteId) return void res.status(400).json({ error: "quoteId required" });
  const [request] = await db.select().from(purchaseRequestsTable).where(and(eq(purchaseRequestsTable.id, id), eq(purchaseRequestsTable.restaurantId, restaurantId)));
  if (!request) return void res.status(404).json({ error: "Not found" });
  const [quote] = await db.select().from(supplierQuotesTable).where(and(eq(supplierQuotesTable.id, quoteId), eq(supplierQuotesTable.requestId, id)));
  if (!quote) return void res.status(404).json({ error: "Quote not found" });
  const items = await db.select().from(purchaseRequestItemsTable).where(eq(purchaseRequestItemsTable.requestId, id));
  const qItems = await db.select().from(supplierQuoteItemsTable).where(eq(supplierQuoteItemsTable.quoteId, quoteId));
  const byReqItem = new Map(qItems.map((q) => [q.requestItemId, q]));

  const po = await db.transaction(async (tx) => {
    const [poRow] = await tx.insert(purchaseOrdersTable).values({
      restaurantId,
      supplierId: quote.supplierId,
      status: "ordered",
      totalAmount: String(quote.totalAmount),
      notes: `Awarded from RFQ #${id}: ${request.title}`,
      orderedAt: new Date(),
    }).returning();
    for (const it of items) {
      const qi = byReqItem.get(it.id);
      if (qi && qi.available === false) continue;
      const price = qi ? Number(qi.pricePerUnit) : 0;
      await tx.insert(purchaseOrderItemsTable).values({
        purchaseOrderId: poRow.id,
        inventoryItemId: it.inventoryItemId,
        name: qi?.alternativeName ?? it.name,
        unit: it.unit,
        quantity: String(it.quantity),
        costPerUnit: String(price.toFixed(2)),
      });
    }
    await tx.update(supplierQuotesTable).set({ status: "accepted", updatedAt: new Date() }).where(eq(supplierQuotesTable.id, quoteId));
    await tx.update(supplierQuotesTable).set({ status: "rejected", updatedAt: new Date() })
      .where(and(eq(supplierQuotesTable.requestId, id), sql`${supplierQuotesTable.id} <> ${quoteId}`));
    await tx.update(purchaseRequestsTable).set({ status: "awarded", awardedQuoteId: quoteId, closedAt: new Date(), updatedAt: new Date() }).where(eq(purchaseRequestsTable.id, id));
    return poRow;
  });
  await recordAuditLog({ req, module: "supplier_network", action: AUDIT_ACTIONS.APPROVED, entity: NEW_AUDIT_ENTITIES.PURCHASE_REQUEST, entityId: id, restaurantId, newValue: { awardedQuoteId: quoteId, purchaseOrderId: po.id } });
  res.json({ purchaseOrderId: po.id, requestId: id });
});

router.post("/restaurants/:restaurantId/purchase-requests/:id/cancel", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [updated] = await db.update(purchaseRequestsTable).set({ status: "cancelled", closedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(purchaseRequestsTable.id, id), eq(purchaseRequestsTable.restaurantId, restaurantId))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({ req, module: "supplier_network", action: AUDIT_ACTIONS.CLOSED, entity: NEW_AUDIT_ENTITIES.PURCHASE_REQUEST, entityId: id, restaurantId });
  res.json(updated);
});

// ───────────────────────── Purchase history ─────────────────────────
router.get("/restaurants/:restaurantId/purchase-history", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { supplierId, inventoryItemId } = req.query;

  const poConds = [eq(purchaseOrdersTable.restaurantId, restaurantId)];
  if (supplierId) poConds.push(eq(purchaseOrdersTable.supplierId, Number(supplierId)));
  const orders = await db.select({
    id: purchaseOrdersTable.id,
    supplierId: purchaseOrdersTable.supplierId,
    supplierName: suppliersTable.name,
    status: purchaseOrdersTable.status,
    totalAmount: purchaseOrdersTable.totalAmount,
    orderedAt: purchaseOrdersTable.orderedAt,
    receivedAt: purchaseOrdersTable.receivedAt,
    createdAt: purchaseOrdersTable.createdAt,
  }).from(purchaseOrdersTable)
    .leftJoin(suppliersTable, eq(suppliersTable.id, purchaseOrdersTable.supplierId))
    .where(and(...poConds))
    .orderBy(desc(purchaseOrdersTable.createdAt))
    .limit(200);

  const ids = orders.map((o) => o.id);
  const itemConds = ids.length ? [inArray(purchaseOrderItemsTable.purchaseOrderId, ids)] : [];
  if (inventoryItemId && ids.length) itemConds.push(eq(purchaseOrderItemsTable.inventoryItemId, Number(inventoryItemId)));
  const lineItems = ids.length ? await db.select().from(purchaseOrderItemsTable).where(and(...itemConds)) : [];

  const byPo = new Map<number, typeof lineItems>();
  for (const li of lineItems) {
    const arr = byPo.get(li.purchaseOrderId) ?? [];
    arr.push(li);
    byPo.set(li.purchaseOrderId, arr);
  }
  const result = orders
    .map((o) => ({ ...o, items: byPo.get(o.id) ?? [] }))
    .filter((o) => !inventoryItemId || o.items.length > 0);
  res.json(result);
});

// ───────────────────────── Public supplier portal (placeholder) ─────────────────────────
const portalRouter = Router();

portalRouter.get("/supplier-portal/:token", async (req, res) => {
  const token = String(req.params.token);
  if (!token) return void res.status(404).json({ error: "Invalid token" });
  const [supplier] = await db.select().from(suppliersTable).where(eq(suppliersTable.portalToken, token));
  if (!supplier) return void res.status(404).json({ error: "Invalid token" });
  const pending = await db.select({
    id: purchaseRequestsTable.id,
    title: purchaseRequestsTable.title,
    notes: purchaseRequestsTable.notes,
    status: purchaseRequestsTable.status,
    neededBy: purchaseRequestsTable.neededBy,
    sentAt: purchaseRequestSuppliersTable.sentAt,
  }).from(purchaseRequestSuppliersTable)
    .innerJoin(purchaseRequestsTable, eq(purchaseRequestsTable.id, purchaseRequestSuppliersTable.requestId))
    .where(and(
      eq(purchaseRequestSuppliersTable.supplierId, supplier.id),
      eq(purchaseRequestsTable.restaurantId, supplier.restaurantId),
      inArray(purchaseRequestsTable.status, ["sent", "quoted"]),
    ))
    .orderBy(desc(purchaseRequestsTable.createdAt));
  const reqIds = pending.map((p) => p.id);
  const items = reqIds.length ? await db.select().from(purchaseRequestItemsTable).where(inArray(purchaseRequestItemsTable.requestId, reqIds)) : [];
  const byReq = new Map<number, typeof items>();
  for (const it of items) {
    const arr = byReq.get(it.requestId) ?? [];
    arr.push(it);
    byReq.set(it.requestId, arr);
  }
  res.json({
    supplier: { id: supplier.id, name: supplier.name, restaurantId: supplier.restaurantId },
    requests: pending.map((p) => ({ ...p, items: byReq.get(p.id) ?? [] })),
  });
});

portalRouter.post("/supplier-portal/:token/quotes", async (req, res) => {
  const token = String(req.params.token);
  const [supplier] = await db.select().from(suppliersTable).where(eq(suppliersTable.portalToken, token));
  if (!supplier) return void res.status(404).json({ error: "Invalid token" });
  const b = req.body ?? {};
  const requestId = Number(b.requestId);
  if (!requestId) return void res.status(400).json({ error: "requestId required" });
  const [request] = await db.select().from(purchaseRequestsTable).where(and(eq(purchaseRequestsTable.id, requestId), eq(purchaseRequestsTable.restaurantId, supplier.restaurantId)));
  if (!request) return void res.status(404).json({ error: "Request not found" });
  const [link] = await db.select().from(purchaseRequestSuppliersTable).where(and(eq(purchaseRequestSuppliersTable.requestId, requestId), eq(purchaseRequestSuppliersTable.supplierId, supplier.id)));
  if (!link) return void res.status(403).json({ error: "Not invited" });

  const items = await db.select().from(purchaseRequestItemsTable).where(eq(purchaseRequestItemsTable.requestId, requestId));
  const lineMap = new Map(items.map((it) => [it.id, Number(it.quantity)]));
  let total = 0;
  const quoteItems: Array<{ requestItemId: number; pricePerUnit: string; available: boolean; alternativeName: string | null; notes: string | null }> = [];
  for (const qi of (b.items ?? []) as Array<Record<string, unknown>>) {
    const requestItemId = Number(qi.requestItemId);
    if (!lineMap.has(requestItemId)) continue;
    const price = Number(qi.pricePerUnit ?? 0);
    const available = qi.available !== false;
    if (available) total += price * (lineMap.get(requestItemId) ?? 0);
    quoteItems.push({ requestItemId, pricePerUnit: String(price.toFixed(2)), available, alternativeName: (qi.alternativeName as string | null) ?? null, notes: (qi.notes as string | null) ?? null });
  }
  const quote = await db.transaction(async (tx) => {
    const [q] = await tx.insert(supplierQuotesTable).values({
      requestId, supplierId: supplier.id, status: "submitted", totalAmount: String(total.toFixed(2)),
      leadTimeDays: b.leadTimeDays != null ? Number(b.leadTimeDays) : null, notes: b.notes ?? null, source: "portal",
    }).returning();
    if (quoteItems.length) await tx.insert(supplierQuoteItemsTable).values(quoteItems.map((qi) => ({ ...qi, quoteId: q.id })));
    await tx.update(purchaseRequestSuppliersTable).set({ status: "received", respondedAt: new Date() })
      .where(and(eq(purchaseRequestSuppliersTable.requestId, requestId), eq(purchaseRequestSuppliersTable.supplierId, supplier.id)));
    if (request.status === "sent") {
      await tx.update(purchaseRequestsTable).set({ status: "quoted", updatedAt: new Date() }).where(eq(purchaseRequestsTable.id, requestId));
    }
    return q;
  });
  res.status(201).json({ ok: true, quoteId: quote.id });
});

export { portalRouter as supplierPortalRouter };
export default router;
