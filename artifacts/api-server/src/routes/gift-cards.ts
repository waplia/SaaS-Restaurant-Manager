/**
 * Gift card routes — issue (digital/physical/corporate), list, detail, redeem,
 * transfer, refund, void, settings, sales report, public lookup-by-code,
 * tenant-wide listing for super-admin.
 *
 * Mounting paths (per restaurant unless noted):
 *   GET    /restaurants/:rid/gift-cards
 *   POST   /restaurants/:rid/gift-cards                       — issue (digital by default)
 *   POST   /restaurants/:rid/gift-cards/batch                 — bulk issue (physical/corporate)
 *   GET    /restaurants/:rid/gift-cards/lookup?code=…         — staff lookup (returns balance)
 *   GET    /restaurants/:rid/gift-cards/:id                   — detail with ledger + transfers
 *   POST   /restaurants/:rid/gift-cards/:id/redeem            — partial or full redeem
 *   POST   /restaurants/:rid/gift-cards/redeem-by-code        — POS / online checkout
 *   POST   /restaurants/:rid/gift-cards/:id/transfer
 *   POST   /restaurants/:rid/gift-cards/:id/refund
 *   POST   /restaurants/:rid/gift-cards/:id/void
 *   GET    /restaurants/:rid/gift-cards/settings
 *   PATCH  /restaurants/:rid/gift-cards/settings
 *   GET    /restaurants/:rid/gift-cards/report/sales[?from&to&type&format=csv]
 *   GET    /restaurants/:rid/gift-cards/batches/:batchId/export.csv
 *   GET    /admin/gift-cards                                  — super-admin cross-tenant
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { db, giftCardsTable, giftCardBatchesTable, tenantsTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { recordAuditLog } from "../lib/audit";
import * as gc from "../lib/giftCards";

const router: IRouter = Router();

function tid(req: any): number { return Number(req.user!.tenantId); }
function rid(req: any): number { return Number(req.params.restaurantId); }
function uid(req: any): number | null { return Number(req.user?.sub ?? req.user?.id) || null; }

async function tenantGiftCardsEnabled(tenantId: number): Promise<boolean> {
  const [t] = await db.select({ enabled: tenantsTable.fintechGiftCardsEnabled })
    .from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  return t?.enabled ?? true;
}

router.use(
  "/restaurants/:restaurantId/gift-cards",
  requireRole("owner", "manager", "cashier", "waiter", "super_admin"),
  validateRestaurantAccess,
);

// ─── Settings ───────────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/gift-cards/settings", async (req, res) => {
  res.json(await gc.getSettings(tid(req)));
});

router.patch("/restaurants/:restaurantId/gift-cards/settings", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const schema = z.object({
    refundsAllowed: z.boolean().optional(),
    refundWindowDays: z.number().int().min(0).max(3650).optional(),
    refundPartiallyUsed: z.boolean().optional(),
    defaultRefundDestination: z.enum(["source", "store_credit"]).optional(),
    defaultExpiryDays: z.number().int().min(0).max(3650).optional(),
    maskCodeForStaff: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const updated = await gc.upsertSettings(tid(req), parsed.data, uid(req));
  await recordAuditLog({ req, module: "fintech", action: "gift_card_settings_updated", entity: "gift_card_settings", entityId: tid(req), restaurantId: rid(req), newValue: parsed.data });
  res.json(updated);
});

// ─── Sales report ───────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/gift-cards/report/sales", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  const cardType = req.query.type ? String(req.query.type) as gc.CardType : undefined;
  const allOutlets = String(req.query.allOutlets ?? "false") === "true";
  const report = await gc.salesReport({
    tenantId: tid(req),
    restaurantId: allOutlets ? null : rid(req),
    from, to, cardType,
  });
  if (String(req.query.format) === "csv") {
    const rows = Object.entries(report.byOutlet).map(([outlet, v]) => ({ outlet, ...v }));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="gift-card-sales.csv"`);
    res.send(gc.toCsv(rows));
    return;
  }
  res.json(report);
});

// ─── Batch CSV export ───────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/gift-cards/batches/:batchId/export.csv", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const batchId = Number(req.params.batchId);
  const [batch] = await db.select().from(giftCardBatchesTable)
    .where(and(eq(giftCardBatchesTable.id, batchId), eq(giftCardBatchesTable.tenantId, tid(req))));
  if (!batch) { res.status(404).json({ error: "not_found" }); return; }
  const cards = await db.select({
    code: giftCardsTable.code,
    initialAmount: giftCardsTable.initialAmount,
    expiresAt: giftCardsTable.expiresAt,
    status: giftCardsTable.status,
  }).from(giftCardsTable).where(eq(giftCardsTable.batchId, batchId));
  const rows = cards.map(c => ({
    code: c.code,
    amount: (c.initialAmount / 100).toFixed(2),
    expiresAt: c.expiresAt?.toISOString() ?? "",
    status: c.status,
  }));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="batch-${batchId}.csv"`);
  res.send(gc.toCsv(rows));
});

// ─── List ───────────────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/gift-cards", async (req, res) => {
  const rows = await gc.list({
    tenantId: tid(req),
    restaurantId: rid(req),
    status: req.query.status ? (String(req.query.status) as gc.CardStatus) : undefined,
    cardType: req.query.type ? (String(req.query.type) as gc.CardType) : undefined,
    from: req.query.from ? new Date(String(req.query.from)) : undefined,
    to: req.query.to ? new Date(String(req.query.to)) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  res.json(rows);
});

// ─── Lookup by code (staff) ─────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/gift-cards/lookup", async (req, res) => {
  const code = String(req.query.code ?? "");
  if (!code) { res.status(400).json({ error: "code_required" }); return; }
  const card = await gc.lookupByCode(tid(req), code);
  if (!card) { res.status(404).json({ error: "not_found" }); return; }
  res.json(card);
});

// ─── Issue (digital, single) ────────────────────────────────────────────────

router.post("/restaurants/:restaurantId/gift-cards", requireRole("owner", "manager", "cashier", "super_admin"), async (req, res) => {
  if (!await tenantGiftCardsEnabled(tid(req))) { res.status(403).json({ error: "gift_cards_disabled" }); return; }
  const schema = z.object({
    initialAmountPaise: z.number().int().positive(),
    cardType: z.enum(["digital", "physical", "corporate"]).optional(),
    recipientCustomerId: z.number().int().optional(),
    recipientName: z.string().optional(),
    recipientEmail: z.string().email().optional(),
    recipientPhone: z.string().optional(),
    senderName: z.string().optional(),
    senderEmail: z.string().email().optional(),
    message: z.string().max(500).optional(),
    expiresAt: z.string().datetime().optional(),
    paymentReference: z.string().optional(),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  try {
    const created = await gc.issue({
      tenantId: tid(req),
      restaurantId: rid(req),
      cardType: parsed.data.cardType ?? "digital",
      initialAmountPaise: parsed.data.initialAmountPaise,
      recipientCustomerId: parsed.data.recipientCustomerId,
      recipientName: parsed.data.recipientName,
      recipientEmail: parsed.data.recipientEmail,
      recipientPhone: parsed.data.recipientPhone,
      senderName: parsed.data.senderName,
      senderEmail: parsed.data.senderEmail,
      message: parsed.data.message,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      paymentReference: parsed.data.paymentReference,
      notes: parsed.data.notes,
      issuedBy: uid(req),
    });
    await recordAuditLog({ req, module: "fintech", action: "gift_card_issued", entity: "gift_card", entityId: created.id, restaurantId: rid(req), newValue: { code: created.code, amount: created.initialAmount, type: created.cardType } });
    res.json(created);
  } catch (e: any) {
    res.status(e.status ?? 400).json({ error: e.code ?? "error", message: e.message });
  }
});

// ─── Issue batch (physical/corporate) ───────────────────────────────────────

router.post("/restaurants/:restaurantId/gift-cards/batch", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  if (!await tenantGiftCardsEnabled(tid(req))) { res.status(403).json({ error: "gift_cards_disabled" }); return; }
  const schema = z.object({
    batchType: z.enum(["physical", "corporate"]),
    count: z.number().int().min(1).max(5000),
    amountPerCardPaise: z.number().int().positive(),
    buyerName: z.string().optional(),
    buyerEmail: z.string().email().optional(),
    buyerPhone: z.string().optional(),
    poNumber: z.string().optional(),
    expiresAt: z.string().datetime().optional(),
    paymentReference: z.string().optional(),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  try {
    const result = await gc.issueBatch({
      tenantId: tid(req),
      restaurantId: rid(req),
      batchType: parsed.data.batchType,
      count: parsed.data.count,
      amountPerCardPaise: parsed.data.amountPerCardPaise,
      buyerName: parsed.data.buyerName,
      buyerEmail: parsed.data.buyerEmail,
      buyerPhone: parsed.data.buyerPhone,
      poNumber: parsed.data.poNumber,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      paymentReference: parsed.data.paymentReference,
      notes: parsed.data.notes,
      issuedBy: uid(req),
    });
    await recordAuditLog({ req, module: "fintech", action: "gift_card_batch_issued", entity: "gift_card_batch", entityId: result.batch.id, restaurantId: rid(req), newValue: { count: result.cards.length, type: parsed.data.batchType, amountPerCardPaise: parsed.data.amountPerCardPaise } });
    res.json({ batch: result.batch, count: result.cards.length, codes: result.cards.map(c => c.code) });
  } catch (e: any) {
    res.status(e.status ?? 400).json({ error: e.code ?? "error", message: e.message });
  }
});

// ─── Redeem-by-code (POS / online checkout) ─────────────────────────────────

router.post("/restaurants/:restaurantId/gift-cards/redeem-by-code", requireRole("owner", "manager", "cashier", "waiter", "super_admin"), async (req, res) => {
  const schema = z.object({
    code: z.string().min(3),
    amountPaise: z.number().int().positive(),
    idempotencyKey: z.string().min(8),
    referenceType: z.string().optional(),
    referenceId: z.number().int().optional(),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  try {
    const r = await gc.redeemByCode(parsed.data.code, {
      tenantId: tid(req),
      amountPaise: parsed.data.amountPaise,
      idempotencyKey: parsed.data.idempotencyKey,
      referenceType: parsed.data.referenceType,
      referenceId: parsed.data.referenceId,
      createdBy: uid(req),
      notes: parsed.data.notes,
    });
    await recordAuditLog({ req, module: "fintech", action: "gift_card_redeemed", entity: "gift_card", entityId: r.card.id, restaurantId: rid(req), newValue: { amount: parsed.data.amountPaise, referenceType: parsed.data.referenceType, referenceId: parsed.data.referenceId } });
    res.json({ giftCardId: r.card.id, code: r.card.code, balanceAfter: r.balance, transactionId: r.transactionId });
  } catch (e: any) {
    res.status(e.status ?? 400).json({ error: e.code ?? "error", message: e.message });
  }
});

// ─── Per-card detail / actions ──────────────────────────────────────────────

router.get("/restaurants/:restaurantId/gift-cards/:id", async (req, res) => {
  const detail = await gc.getDetail(tid(req), Number(req.params.id));
  if (!detail) { res.status(404).json({ error: "not_found" }); return; }
  res.json(detail);
});

router.post("/restaurants/:restaurantId/gift-cards/:id/redeem", requireRole("owner", "manager", "cashier", "super_admin"), async (req, res) => {
  const schema = z.object({
    amountPaise: z.number().int().positive(),
    idempotencyKey: z.string().min(8),
    referenceType: z.string().optional(),
    referenceId: z.number().int().optional(),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  try {
    const r = await gc.redeemById(Number(req.params.id), {
      tenantId: tid(req),
      amountPaise: parsed.data.amountPaise,
      idempotencyKey: parsed.data.idempotencyKey,
      referenceType: parsed.data.referenceType,
      referenceId: parsed.data.referenceId,
      createdBy: uid(req),
      notes: parsed.data.notes,
    });
    await recordAuditLog({ req, module: "fintech", action: "gift_card_redeemed", entity: "gift_card", entityId: r.card.id, restaurantId: rid(req), newValue: { amount: parsed.data.amountPaise } });
    res.json({ balanceAfter: r.balance, transactionId: r.transactionId });
  } catch (e: any) {
    res.status(e.status ?? 400).json({ error: e.code ?? "error", message: e.message });
  }
});

router.post("/restaurants/:restaurantId/gift-cards/:id/transfer", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const schema = z.object({
    toCustomerId: z.number().int().optional(),
    toName: z.string().optional(),
    toEmail: z.string().email().optional(),
    toPhone: z.string().optional(),
    note: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  if (!parsed.data.toCustomerId && !parsed.data.toName && !parsed.data.toEmail && !parsed.data.toPhone) {
    res.status(400).json({ error: "recipient_required" }); return;
  }
  try {
    const updated = await gc.transfer(Number(req.params.id), {
      tenantId: tid(req),
      ...parsed.data,
      transferredBy: uid(req),
    });
    await recordAuditLog({ req, module: "fintech", action: "gift_card_transferred", entity: "gift_card", entityId: updated.id, restaurantId: rid(req), newValue: parsed.data });
    res.json(updated);
  } catch (e: any) {
    res.status(e.status ?? 400).json({ error: e.code ?? "error", message: e.message });
  }
});

router.post("/restaurants/:restaurantId/gift-cards/:id/refund", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const schema = z.object({
    destination: z.enum(["source", "store_credit"]).optional(),
    reason: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed" }); return; }
  try {
    const updated = await gc.refund(Number(req.params.id), {
      tenantId: tid(req),
      destination: parsed.data.destination,
      reason: parsed.data.reason,
      refundedBy: uid(req),
    });
    await recordAuditLog({ req, module: "fintech", action: "gift_card_refunded", entity: "gift_card", entityId: updated.id, restaurantId: rid(req), newValue: { destination: parsed.data.destination, amount: updated.refundedAmount } });
    res.json(updated);
  } catch (e: any) {
    res.status(e.status ?? 400).json({ error: e.code ?? "error", message: e.message });
  }
});

router.post("/restaurants/:restaurantId/gift-cards/:id/void", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const reason = String(req.body?.reason ?? "voided");
  try {
    const updated = await gc.voidCard(tid(req), Number(req.params.id), uid(req), reason);
    await recordAuditLog({ req, module: "fintech", action: "gift_card_voided", entity: "gift_card", entityId: updated.id, restaurantId: rid(req), newValue: { reason } });
    res.json(updated);
  } catch (e: any) {
    res.status(e.status ?? 400).json({ error: e.code ?? "error", message: e.message });
  }
});

// ─── Super-admin cross-tenant view ──────────────────────────────────────────

router.get("/admin/gift-cards", requireRole("super_admin"), async (_req, res) => {
  const rows = await db.select().from(giftCardsTable).orderBy(desc(giftCardsTable.createdAt)).limit(500);
  res.json(rows);
});

export default router;
