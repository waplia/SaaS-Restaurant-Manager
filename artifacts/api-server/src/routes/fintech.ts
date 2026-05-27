/**
 * Fintech routes — wallets, payment records, gift cards, cashback,
 * staff payouts, vendor payments, daily settlements, reconciliation,
 * platform commissions, and capital/insurance placeholders.
 *
 * Mounting:
 *   GET    /restaurants/:rid/wallets                — owner-side wallet summary
 *   GET    /restaurants/:rid/wallets/:walletId/transactions
 *   POST   /restaurants/:rid/wallets/:walletId/topup
 *   POST   /restaurants/:rid/wallets/:walletId/transfer
 *   POST   /restaurants/:rid/wallets/:walletId/adjust   (owner|manager|super_admin, wallet scoped to caller)
 *   POST   /restaurants/:rid/wallets/:walletId/freeze   (owner|manager|super_admin, wallet scoped to caller)
 *
 *   GET    /restaurants/:rid/fintech/gateway-payments
 *   POST   /restaurants/:rid/fintech/gateway-payments
 *   GET    /restaurants/:rid/fintech/upi-payments
 *   POST   /restaurants/:rid/fintech/upi-payments
 *
 *   GET    /restaurants/:rid/refunds
 *   POST   /restaurants/:rid/refunds
 *   POST   /restaurants/:rid/refunds/:id/approve
 *   POST   /restaurants/:rid/refunds/:id/mark-succeeded
 *
 *   GET    /restaurants/:rid/gift-cards
 *   POST   /restaurants/:rid/gift-cards
 *   POST   /restaurants/:rid/gift-cards/:id/redeem
 *   POST   /restaurants/:rid/gift-cards/:id/void
 *
 *   GET    /restaurants/:rid/cashback-rules
 *   POST   /restaurants/:rid/cashback-rules
 *   PATCH  /restaurants/:rid/cashback-rules/:id
 *
 *   GET    /restaurants/:rid/staff-payouts
 *   POST   /restaurants/:rid/staff-payouts
 *   POST   /restaurants/:rid/staff-payouts/:id/approve
 *   POST   /restaurants/:rid/staff-payouts/:id/pay
 *
 *   GET    /restaurants/:rid/vendor-payments
 *   POST   /restaurants/:rid/vendor-payments
 *
 *   GET    /restaurants/:rid/settlements
 *   POST   /restaurants/:rid/settlements/run         — generate today/yesterday
 *   POST   /restaurants/:rid/settlements/:id/email
 *
 *   GET    /restaurants/:rid/reconciliation/runs
 *   POST   /restaurants/:rid/reconciliation/runs     — accept CSV-style payload
 *   GET    /restaurants/:rid/reconciliation/runs/:id/variances
 *   POST   /restaurants/:rid/reconciliation/variances/:id/resolve
 *   GET    /restaurants/:rid/cash-shifts
 *   POST   /restaurants/:rid/cash-shifts
 *
 *   POST   /restaurants/:rid/capital/loan-interest
 *   POST   /restaurants/:rid/capital/sales-advance
 *   GET    /restaurants/:rid/capital/credit-score
 *
 *   GET    /insurance/offers                         — public catalogue
 *   POST   /restaurants/:rid/insurance/interest
 *
 *   /admin/fintech/...                               — super-admin only
 */
import { Router } from "express";
import { eq, and, desc, gte, lte, inArray, sql, count } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "crypto";
import {
  db,
  walletsTable, walletTransactionsTable,
  gatewayPaymentRecordsTable, upiPaymentRecordsTable, refundsTable,
  giftCardsTable, cashbackRulesTable,
  staffPayoutsTable, vendorPaymentsTable,
  dailySettlementsTable, reconciliationRunsTable, reconciliationVariancesTable,
  cashShiftReconciliationsTable, platformCommissionsTable,
  restaurantCreditScoresTable, loanEligibilitySignalsTable,
  salesAdvanceRequestsTable, insuranceOffersTable, insuranceInterestsTable,
  vendorCreditLinesTable,
  financePartnersTable, capitalOffersTable, capitalApplicationsTable,
  capitalApplicationDocumentsTable, capitalRepaymentsTable,
  ordersTable, paymentsTable,
  subscriptionPlansTable, isFeatureEnabled,
  tenantsTable, restaurantsTable, usersTable, suppliersTable,
} from "../lib/db";
import { requireRole, requireSuperAdmin } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import * as wallet from "../lib/walletService";
import { recordAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";
import { triggerAutoPost } from "./accounting-books";

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

function tid(req: any): number { return Number(req.user!.tenantId); }
function rid(req: any): number { return Number(req.params.restaurantId); }
function uid(req: any): number | null { return Number(req.user?.sub ?? req.user?.id) || null; }

function paise(rupeesOrPaise: number, asPaise = false): number {
  return Math.round(asPaise ? rupeesOrPaise : rupeesOrPaise * 100);
}

async function tenantFintech(tenantId: number) {
  const [t] = await db.select({
    walletsEnabled: tenantsTable.fintechWalletsEnabled,
    giftCardsEnabled: tenantsTable.fintechGiftCardsEnabled,
    cashbackEnabled: tenantsTable.fintechCashbackEnabled,
    subscriptionWalletEnabled: tenantsTable.fintechSubscriptionWalletEnabled,
    capitalEnabled: tenantsTable.fintechCapitalEnabled,
    requirePayoutApproval: tenantsTable.fintechRequirePayoutApproval,
  }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  return t ?? {
    walletsEnabled: true, giftCardsEnabled: true, cashbackEnabled: true,
    subscriptionWalletEnabled: true, capitalEnabled: false, requirePayoutApproval: false,
  };
}

function genGiftCardCode(): string {
  return "GC-" + randomBytes(4).toString("hex").toUpperCase();
}

// ─── Owner / staff routes (per-restaurant) ──────────────────────────────────

router.use("/restaurants/:restaurantId", requireRole("owner", "manager", "cashier", "waiter", "kitchen", "super_admin"), validateRestaurantAccess);

// Wallets summary for the restaurant scope (restaurant + subscription + recent customer wallets).
router.get("/restaurants/:restaurantId/wallets", async (req, res) => {
  const restaurantId = rid(req);
  const tenantId = tid(req);
  const restaurantWallet = await wallet.getOrCreateWallet({ tenantId, kind: "restaurant", restaurantId });
  const subWallet = await wallet.getOrCreateWallet({ tenantId, kind: "subscription" });
  const customerWallets = await db.select().from(walletsTable)
    .where(and(eq(walletsTable.tenantId, tenantId), inArray(walletsTable.kind, ["customer", "cashback"])))
    .limit(50);
  res.json({
    restaurant: restaurantWallet,
    subscription: subWallet,
    customerWalletsSample: customerWallets,
  });
});

router.get("/restaurants/:restaurantId/wallets/:walletId/transactions", async (req, res) => {
  const walletId = Number(req.params.walletId);
  const w = await wallet.getWalletById(walletId);
  if (!w || w.tenantId !== tid(req)) { res.status(404).json({ error: "Wallet not found" }); return; }
  const limit = Math.min(200, Number(req.query.limit ?? 100));
  const rows = await db.select().from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.walletId, walletId))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(limit);
  res.json({ wallet: w, transactions: rows });
});

const topupSchema = z.object({
  amountPaise: z.number().int().positive(),
  channel: z.enum(["cash", "card", "upi", "gateway", "bank", "wallet_transfer", "manual"]).default("manual"),
  externalRef: z.string().optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().min(8),
});

router.post("/restaurants/:restaurantId/wallets/:walletId/topup", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const parsed = topupSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const w = await wallet.getWalletById(Number(req.params.walletId));
  if (!w || w.tenantId !== tid(req)) { res.status(404).json({ error: "Wallet not found" }); return; }
  try {
    const result = await wallet.credit(
      { tenantId: w.tenantId, kind: w.kind as any, restaurantId: w.restaurantId, customerId: w.customerId, giftCardId: w.giftCardId },
      { amount: parsed.data.amountPaise, type: "top_up", channel: parsed.data.channel, externalRef: parsed.data.externalRef, notes: parsed.data.notes, idempotencyKey: parsed.data.idempotencyKey, createdBy: uid(req) },
    );
    await recordAuditLog({ req, module: "fintech", action: "wallet_topup", entity: "wallet", entityId: w.id, restaurantId: w.restaurantId, newValue: { amount: parsed.data.amountPaise, channel: parsed.data.channel } });
    res.json(result);
  } catch (e: any) {
    res.status(e.status ?? 400).json({ error: e.code ?? "error", message: e.message });
  }
});

const transferSchema = z.object({
  toWalletId: z.number().int(),
  amountPaise: z.number().int().positive(),
  notes: z.string().optional(),
  idempotencyKey: z.string().min(8),
});

router.post("/restaurants/:restaurantId/wallets/:walletId/transfer", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const from = await wallet.getWalletById(Number(req.params.walletId));
  const to = await wallet.getWalletById(parsed.data.toWalletId);
  if (!from || !to || from.tenantId !== tid(req) || to.tenantId !== tid(req)) {
    res.status(404).json({ error: "Wallet not found" }); return;
  }
  try {
    const r = await wallet.transfer({
      from: { tenantId: from.tenantId, kind: from.kind as any, restaurantId: from.restaurantId, customerId: from.customerId, giftCardId: from.giftCardId },
      to: { tenantId: to.tenantId, kind: to.kind as any, restaurantId: to.restaurantId, customerId: to.customerId, giftCardId: to.giftCardId },
      amount: parsed.data.amountPaise, notes: parsed.data.notes, idempotencyKey: parsed.data.idempotencyKey, createdBy: uid(req),
    });
    await recordAuditLog({ req, module: "fintech", action: "wallet_transfer", entity: "wallet", entityId: from.id, restaurantId: from.restaurantId, newValue: { from: from.id, to: to.id, amount: parsed.data.amountPaise } });
    res.json(r);
  } catch (e: any) {
    res.status(e.status ?? 400).json({ error: e.code ?? "error", message: e.message });
  }
});

// Owner/manager (or super-admin) can adjust the wallet. The router-level
// requireRole + validateRestaurantAccess above enforces tenant membership
// for the :restaurantId in the URL, but we also have to verify that the
// :walletId path param actually belongs to that restaurant/tenant —
// otherwise an owner could mutate another tenant's wallet by pairing
// their own restaurantId with a foreign walletId (IDOR).
router.post("/restaurants/:restaurantId/wallets/:walletId/adjust", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const schema = z.object({ deltaPaise: z.number().int(), reason: z.string().min(3), idempotencyKey: z.string().min(8) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const w = await wallet.getWalletById(Number(req.params.walletId));
  if (!w) { res.status(404).json({ error: "Wallet not found" }); return; }
  if (!req.user?.isSuperAdmin) {
    if (w.tenantId !== tid(req)) { res.status(403).json({ error: "forbidden", message: "Wallet does not belong to your tenant" }); return; }
    if (w.restaurantId !== rid(req)) { res.status(403).json({ error: "forbidden", message: "Wallet does not belong to this restaurant" }); return; }
  }
  try {
    const r = await wallet.adjust(
      { tenantId: w.tenantId, kind: w.kind as any, restaurantId: w.restaurantId, customerId: w.customerId, giftCardId: w.giftCardId },
      { delta: parsed.data.deltaPaise, reason: parsed.data.reason, createdBy: uid(req), idempotencyKey: parsed.data.idempotencyKey },
    );
    await recordAuditLog({ req, module: "fintech", action: "wallet_adjust", entity: "wallet", entityId: w.id, restaurantId: w.restaurantId, newValue: { delta: parsed.data.deltaPaise, reason: parsed.data.reason } });
    res.json(r);
  } catch (e: any) {
    res.status(e.status ?? 400).json({ error: e.code ?? "error", message: e.message });
  }
});

router.post("/restaurants/:restaurantId/wallets/:walletId/freeze", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const schema = z.object({ frozen: z.boolean(), reason: z.string().min(3) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed" }); return; }
  const w = await wallet.getWalletById(Number(req.params.walletId));
  if (!w) { res.status(404).json({ error: "Wallet not found" }); return; }
  if (!req.user?.isSuperAdmin) {
    if (w.tenantId !== tid(req)) { res.status(403).json({ error: "forbidden", message: "Wallet does not belong to your tenant" }); return; }
    if (w.restaurantId !== rid(req)) { res.status(403).json({ error: "forbidden", message: "Wallet does not belong to this restaurant" }); return; }
  }
  const updated = await wallet.setFrozen(w.id, parsed.data.frozen, parsed.data.reason, uid(req));
  await recordAuditLog({ req, module: "fintech", action: "wallet_freeze", entity: "wallet", entityId: w.id, restaurantId: w.restaurantId, newValue: { frozen: parsed.data.frozen, reason: parsed.data.reason } });
  res.json(updated);
});

// ─── Gateway / UPI payment records ──────────────────────────────────────────

router.get("/restaurants/:restaurantId/fintech/gateway-payments", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const rows = await db.select().from(gatewayPaymentRecordsTable)
    .where(and(eq(gatewayPaymentRecordsTable.tenantId, tid(req)), eq(gatewayPaymentRecordsTable.restaurantId, rid(req))))
    .orderBy(desc(gatewayPaymentRecordsTable.createdAt))
    .limit(200);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/fintech/gateway-payments", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const schema = z.object({
    gateway: z.enum(["razorpay", "cashfree", "stripe"]),
    gatewayOrderId: z.string().optional(),
    gatewayPaymentId: z.string().min(1),
    method: z.string().optional(),
    amountPaise: z.number().int().positive(),
    feePaise: z.number().int().nonnegative().default(0),
    taxPaise: z.number().int().nonnegative().default(0),
    referenceType: z.string().optional(),
    referenceId: z.number().int().optional(),
    creditWallet: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const net = d.amountPaise - d.feePaise - d.taxPaise;

  // Idempotency: same (gateway, gatewayPaymentId) returns existing.
  const [existing] = await db.select().from(gatewayPaymentRecordsTable)
    .where(and(eq(gatewayPaymentRecordsTable.gateway, d.gateway), eq(gatewayPaymentRecordsTable.gatewayPaymentId, d.gatewayPaymentId)));
  if (existing) { res.json({ deduped: true, record: existing }); return; }

  let walletTxId: number | null = null;
  if (d.creditWallet) {
    const r = await wallet.credit({ tenantId: tid(req), kind: "restaurant", restaurantId: rid(req) }, {
      amount: net, type: "order_payment", channel: "gateway",
      externalRef: `${d.gateway}:${d.gatewayPaymentId}`, referenceType: d.referenceType, referenceId: d.referenceId,
      idempotencyKey: `gw_${d.gateway}_${d.gatewayPaymentId}`, createdBy: uid(req),
      metadata: { fee: d.feePaise, tax: d.taxPaise, gross: d.amountPaise },
    }).catch(e => { logger.warn({ err: e }, "wallet credit failed"); return null; });
    if (r) walletTxId = r.transactionId;
  }
  const [row] = await db.insert(gatewayPaymentRecordsTable).values({
    tenantId: tid(req), restaurantId: rid(req),
    gateway: d.gateway, gatewayOrderId: d.gatewayOrderId, gatewayPaymentId: d.gatewayPaymentId,
    method: d.method, amount: d.amountPaise, feeAmount: d.feePaise, taxAmount: d.taxPaise,
    netAmount: net, status: "captured", capturedAt: new Date(),
    referenceType: d.referenceType, referenceId: d.referenceId,
    walletTransactionId: walletTxId,
  }).returning();
  await recordAuditLog({ req, module: "fintech", action: "gateway_payment_recorded", entity: "gateway_payment", entityId: row.id, restaurantId: rid(req), newValue: row });
  res.json({ record: row, walletTransactionId: walletTxId });
});

router.get("/restaurants/:restaurantId/fintech/upi-payments", requireRole("owner", "manager", "cashier", "super_admin"), async (req, res) => {
  const rows = await db.select().from(upiPaymentRecordsTable)
    .where(and(eq(upiPaymentRecordsTable.tenantId, tid(req)), eq(upiPaymentRecordsTable.restaurantId, rid(req))))
    .orderBy(desc(upiPaymentRecordsTable.createdAt)).limit(200);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/fintech/upi-payments", requireRole("owner", "manager", "cashier", "super_admin"), async (req, res) => {
  const schema = z.object({
    source: z.enum(["gateway", "dynamic_qr", "manual"]).default("manual"),
    payerVpa: z.string().optional(),
    upiTxnId: z.string().min(4),
    amountPaise: z.number().int().positive(),
    referenceType: z.string().optional(),
    referenceId: z.number().int().optional(),
    creditWallet: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const [existing] = await db.select().from(upiPaymentRecordsTable).where(eq(upiPaymentRecordsTable.upiTxnId, d.upiTxnId));
  if (existing) { res.json({ deduped: true, record: existing }); return; }
  let walletTxId: number | null = null;
  if (d.creditWallet) {
    const r = await wallet.credit({ tenantId: tid(req), kind: "restaurant", restaurantId: rid(req) }, {
      amount: d.amountPaise, type: "order_payment", channel: "upi", externalRef: d.upiTxnId,
      referenceType: d.referenceType, referenceId: d.referenceId,
      idempotencyKey: `upi_${d.upiTxnId}`, createdBy: uid(req),
    }).catch(() => null);
    if (r) walletTxId = r.transactionId;
  }
  const [row] = await db.insert(upiPaymentRecordsTable).values({
    tenantId: tid(req), restaurantId: rid(req), source: d.source, payerVpa: d.payerVpa,
    upiTxnId: d.upiTxnId, amount: d.amountPaise, referenceType: d.referenceType, referenceId: d.referenceId,
    walletTransactionId: walletTxId, recordedBy: uid(req),
  }).returning();
  await recordAuditLog({ req, module: "fintech", action: "upi_payment_recorded", entity: "upi_payment", entityId: row.id, restaurantId: rid(req), newValue: row });
  res.json({ record: row, walletTransactionId: walletTxId });
});

// ─── Refunds ────────────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/refunds", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const rows = await db.select().from(refundsTable)
    .where(and(eq(refundsTable.tenantId, tid(req)), eq(refundsTable.restaurantId, rid(req))))
    .orderBy(desc(refundsTable.createdAt)).limit(200);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/refunds", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const schema = z.object({
    originalGatewayPaymentId: z.number().int().optional(),
    originalUpiPaymentId: z.number().int().optional(),
    referenceType: z.string().optional(),
    referenceId: z.number().int().optional(),
    amountPaise: z.number().int().positive(),
    refundType: z.enum(["full", "partial"]).default("partial"),
    destination: z.enum(["source", "wallet"]).default("source"),
    reason: z.string().min(3),
    customerWalletCustomerId: z.number().int().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const now = new Date();
  const [row] = await db.insert(refundsTable).values({
    tenantId: tid(req), restaurantId: rid(req),
    originalGatewayPaymentId: d.originalGatewayPaymentId, originalUpiPaymentId: d.originalUpiPaymentId,
    referenceType: d.referenceType, referenceId: d.referenceId,
    amount: d.amountPaise, refundType: d.refundType, destination: d.destination,
    reason: d.reason, status: "pending",
    statusTimeline: [{ status: "pending", at: now.toISOString(), by: uid(req) }],
    createdBy: uid(req),
  }).returning();
  // If destination=wallet and customer specified, credit cashback wallet immediately on creation.
  let walletTxId: number | null = null;
  if (d.destination === "wallet" && d.customerWalletCustomerId) {
    const r = await wallet.credit({ tenantId: tid(req), kind: "customer", customerId: d.customerWalletCustomerId }, {
      amount: d.amountPaise, type: "refund", channel: "wallet_transfer",
      referenceType: "refund", referenceId: row.id,
      idempotencyKey: `refund_${row.id}`, createdBy: uid(req), notes: d.reason,
    }).catch(() => null);
    if (r) walletTxId = r.transactionId;
    await db.update(refundsTable).set({
      status: "succeeded", walletTransactionId: walletTxId, updatedAt: new Date(),
      statusTimeline: [...(row.statusTimeline ?? []), { status: "succeeded", at: new Date().toISOString(), by: uid(req), note: "wallet refund" }],
    }).where(eq(refundsTable.id, row.id));
  }
  await recordAuditLog({ req, module: "fintech", action: "refund_created", entity: "refund", entityId: row.id, restaurantId: rid(req), newValue: row });
  // Accounting auto-post: refund → ledger (fail-soft, idempotent by refund id)
  void triggerAutoPost({
    restaurantId: rid(req),
    source: "refund",
    sourceRef: `refund:${row.id}`,
    entryDate: new Date().toISOString().slice(0, 10),
    amount: Number(d.amountPaise) / 100,
    memo: `Refund #${row.id}`,
    userId: uid(req) as number | null,
  });
  res.json({ refund: row, walletTransactionId: walletTxId });
});

router.post("/restaurants/:restaurantId/refunds/:id/approve", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const id = Number(req.params.id);
  const [r] = await db.select().from(refundsTable).where(and(eq(refundsTable.id, id), eq(refundsTable.tenantId, tid(req))));
  if (!r) { res.status(404).json({ error: "not_found" }); return; }
  const timeline = [...(r.statusTimeline ?? []), { status: "processing", at: new Date().toISOString(), by: uid(req), note: "approved" }];
  const [updated] = await db.update(refundsTable).set({
    status: "processing", approvedBy: uid(req), statusTimeline: timeline, updatedAt: new Date(),
  }).where(eq(refundsTable.id, id)).returning();
  await recordAuditLog({ req, module: "fintech", action: "refund_approved", entity: "refund", entityId: id, restaurantId: rid(req) });
  res.json(updated);
});

router.post("/restaurants/:restaurantId/refunds/:id/mark-succeeded", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const id = Number(req.params.id);
  const externalRefundId = (req.body?.externalRefundId as string | undefined) ?? null;
  const [r] = await db.select().from(refundsTable).where(and(eq(refundsTable.id, id), eq(refundsTable.tenantId, tid(req))));
  if (!r) { res.status(404).json({ error: "not_found" }); return; }
  const timeline = [...(r.statusTimeline ?? []), { status: "succeeded", at: new Date().toISOString(), by: uid(req) }];
  const [updated] = await db.update(refundsTable).set({
    status: "succeeded", externalRefundId, statusTimeline: timeline, updatedAt: new Date(),
  }).where(eq(refundsTable.id, id)).returning();
  res.json(updated);
});

// ─── Gift cards ─────────────────────────────────────────────────────────────
// Moved to dedicated routes/gift-cards.ts router (issue, batch, redeem, transfer,
// refund, void, settings, sales report, code lookup). The router is mounted
// alongside this one in routes/index.ts; the same URL prefix is preserved.

// ─── Cashback rules ─────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/cashback-rules", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const rows = await db.select().from(cashbackRulesTable)
    .where(and(eq(cashbackRulesTable.tenantId, tid(req)), eq(cashbackRulesTable.restaurantId, rid(req))));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/cashback-rules", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    percentBps: z.number().int().min(0).max(10000),
    capPaise: z.number().int().nonnegative().default(0),
    minOrderPaise: z.number().int().nonnegative().default(0),
    expiryDays: z.number().int().positive().default(90),
    isActive: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const [row] = await db.insert(cashbackRulesTable).values({
    tenantId: tid(req), restaurantId: rid(req),
    name: d.name, percentBps: d.percentBps, capAmount: d.capPaise, minOrderAmount: d.minOrderPaise,
    expiryDays: d.expiryDays, isActive: d.isActive,
  }).returning();
  res.json(row);
});

router.patch("/restaurants/:restaurantId/cashback-rules/:id", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const id = Number(req.params.id);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof req.body?.isActive === "boolean") patch.isActive = req.body.isActive;
  if (typeof req.body?.percentBps === "number") patch.percentBps = req.body.percentBps;
  if (typeof req.body?.capPaise === "number") patch.capAmount = req.body.capPaise;
  await db.update(cashbackRulesTable).set(patch as any)
    .where(and(eq(cashbackRulesTable.id, id), eq(cashbackRulesTable.tenantId, tid(req))));
  res.json({ ok: true });
});

// ─── Staff payouts ──────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/staff-payouts", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const rows = await db.select().from(staffPayoutsTable)
    .where(and(eq(staffPayoutsTable.tenantId, tid(req)), eq(staffPayoutsTable.restaurantId, rid(req))))
    .orderBy(desc(staffPayoutsTable.createdAt)).limit(200);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/staff-payouts", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const schema = z.object({
    staffUserId: z.number().int(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    grossPaise: z.number().int().positive(),
    deductionsPaise: z.number().int().nonnegative().default(0),
    advancesPaise: z.number().int().nonnegative().default(0),
    mode: z.enum(["cash", "bank", "upi", "wallet"]).default("bank"),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const net = d.grossPaise - d.deductionsPaise - d.advancesPaise;
  if (net <= 0) { res.status(400).json({ error: "net_must_be_positive" }); return; }
  const tFlags = await tenantFintech(tid(req));
  const status = tFlags.requirePayoutApproval ? "draft" : "approved";
  const [row] = await db.insert(staffPayoutsTable).values({
    tenantId: tid(req), restaurantId: rid(req),
    staffUserId: d.staffUserId,
    periodStart: new Date(d.periodStart), periodEnd: new Date(d.periodEnd),
    grossAmount: d.grossPaise, deductionsAmount: d.deductionsPaise, advancesAmount: d.advancesPaise,
    netAmount: net, mode: d.mode, status, notes: d.notes,
    approvedBy: status === "approved" ? uid(req) : null,
    createdBy: uid(req),
  }).returning();
  await recordAuditLog({ req, module: "fintech", action: "staff_payout_created", entity: "staff_payout", entityId: row.id, restaurantId: rid(req), newValue: row });
  res.json(row);
});

router.post("/restaurants/:restaurantId/staff-payouts/:id/approve", requireRole("owner", "super_admin"), async (req, res) => {
  const id = Number(req.params.id);
  const [updated] = await db.update(staffPayoutsTable).set({
    status: "approved", approvedBy: uid(req), updatedAt: new Date(),
  }).where(and(eq(staffPayoutsTable.id, id), eq(staffPayoutsTable.tenantId, tid(req)))).returning();
  if (!updated) { res.status(404).json({ error: "not_found" }); return; }
  await recordAuditLog({ req, module: "fintech", action: "staff_payout_approved", entity: "staff_payout", entityId: id, restaurantId: rid(req) });
  res.json(updated);
});

router.post("/restaurants/:restaurantId/staff-payouts/:id/pay", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const id = Number(req.params.id);
  const [p] = await db.select().from(staffPayoutsTable).where(and(eq(staffPayoutsTable.id, id), eq(staffPayoutsTable.tenantId, tid(req))));
  if (!p) { res.status(404).json({ error: "not_found" }); return; }
  if (p.status !== "approved") { res.status(409).json({ error: "not_approved" }); return; }
  // Debit restaurant wallet by net amount.
  let walletTxId: number | null = null;
  try {
    const r = await wallet.debit({ tenantId: tid(req), kind: "restaurant", restaurantId: rid(req) }, {
      amount: p.netAmount, type: "payout", channel: p.mode === "cash" ? "cash" : (p.mode === "upi" ? "upi" : "bank"),
      referenceType: "staff_payout", referenceId: p.id,
      idempotencyKey: `payout_${p.id}`, createdBy: uid(req), notes: `Staff payout #${p.id}`,
    });
    walletTxId = r.transactionId;
  } catch (e: any) {
    res.status(e.status ?? 400).json({ error: e.code ?? "error", message: e.message });
    return;
  }
  const [updated] = await db.update(staffPayoutsTable).set({
    status: "paid", paidAt: new Date(), paidBy: uid(req), walletTransactionId: walletTxId, updatedAt: new Date(),
  }).where(eq(staffPayoutsTable.id, id)).returning();
  await recordAuditLog({ req, module: "fintech", action: "staff_payout_paid", entity: "staff_payout", entityId: id, restaurantId: rid(req), newValue: { walletTxId } });
  res.json(updated);
});

// Staff sees their own payouts.
router.get("/restaurants/:restaurantId/staff-payouts/me", async (req, res) => {
  const me = uid(req);
  if (!me) { res.status(401).json({ error: "auth_required" }); return; }
  const rows = await db.select().from(staffPayoutsTable)
    .where(and(eq(staffPayoutsTable.tenantId, tid(req)), eq(staffPayoutsTable.restaurantId, rid(req)), eq(staffPayoutsTable.staffUserId, me)))
    .orderBy(desc(staffPayoutsTable.periodStart)).limit(60);
  res.json(rows);
});

// ─── Vendor payments ────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/vendor-payments", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const rows = await db.select().from(vendorPaymentsTable)
    .where(and(eq(vendorPaymentsTable.tenantId, tid(req)), eq(vendorPaymentsTable.restaurantId, rid(req))))
    .orderBy(desc(vendorPaymentsTable.createdAt)).limit(200);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/vendor-payments", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const schema = z.object({
    supplierId: z.number().int().optional(),
    billRef: z.string().optional(),
    purchaseOrderId: z.number().int().optional(),
    amountPaise: z.number().int().positive(),
    mode: z.enum(["cash", "bank", "upi", "wallet"]).default("bank"),
    reference: z.string().optional(),
    notes: z.string().optional(),
    idempotencyKey: z.string().min(8),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  let walletTxId: number | null = null;
  try {
    const r = await wallet.debit({ tenantId: tid(req), kind: "restaurant", restaurantId: rid(req) }, {
      amount: d.amountPaise, type: "payout", channel: d.mode === "cash" ? "cash" : (d.mode === "upi" ? "upi" : "bank"),
      referenceType: "vendor_payment", externalRef: d.reference,
      idempotencyKey: d.idempotencyKey, createdBy: uid(req), notes: d.notes ?? d.billRef,
    });
    walletTxId = r.transactionId;
  } catch (e: any) {
    res.status(e.status ?? 400).json({ error: e.code ?? "error", message: e.message });
    return;
  }
  const [row] = await db.insert(vendorPaymentsTable).values({
    tenantId: tid(req), restaurantId: rid(req),
    supplierId: d.supplierId, billRef: d.billRef, purchaseOrderId: d.purchaseOrderId,
    amount: d.amountPaise, mode: d.mode, status: "paid", paidAt: new Date(), paidBy: uid(req),
    reference: d.reference, walletTransactionId: walletTxId, notes: d.notes,
  }).returning();
  await recordAuditLog({ req, module: "fintech", action: "vendor_payment_created", entity: "vendor_payment", entityId: row.id, restaurantId: rid(req), newValue: row });
  res.json(row);
});

// ─── Daily settlement ───────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/settlements", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const rows = await db.select().from(dailySettlementsTable)
    .where(and(eq(dailySettlementsTable.tenantId, tid(req)), eq(dailySettlementsTable.restaurantId, rid(req))))
    .orderBy(desc(dailySettlementsTable.settlementDate)).limit(60);
  res.json(rows);
});

async function generateSettlementForDay(tenantId: number, restaurantId: number, day: Date, generatedBy: number | null) {
  const start = new Date(day); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
  const wtxs = await db.select().from(walletTransactionsTable)
    .where(and(
      eq(walletTransactionsTable.restaurantId, restaurantId),
      gte(walletTransactionsTable.createdAt, start),
      lte(walletTransactionsTable.createdAt, end),
    ));
  let collected = 0, cash = 0, card = 0, upi = 0, gateway = 0, walletCh = 0;
  let refunded = 0, payouts = 0, vendor = 0;
  let orderCount = 0, refundCount = 0, payoutCount = 0;
  for (const t of wtxs) {
    const amt = t.amount;
    if (t.direction === "credit" && t.type === "order_payment") {
      collected += amt; orderCount++;
      if (t.channel === "cash") cash += amt;
      else if (t.channel === "card") card += amt;
      else if (t.channel === "upi") upi += amt;
      else if (t.channel === "gateway") gateway += amt;
      else if (t.channel === "wallet_transfer") walletCh += amt;
    } else if (t.direction === "credit" && t.type === "refund") {
      // refund credited to customer wallet — outflow from restaurant POV
    } else if (t.direction === "debit" && t.type === "refund") {
      refunded += amt; refundCount++;
    } else if (t.direction === "debit" && t.type === "payout") {
      if (t.referenceType === "vendor_payment") { vendor += amt; }
      else { payouts += amt; payoutCount++; }
    }
  }
  // Gateway fees from real-money records.
  const gws = await db.select().from(gatewayPaymentRecordsTable)
    .where(and(
      eq(gatewayPaymentRecordsTable.restaurantId, restaurantId),
      gte(gatewayPaymentRecordsTable.createdAt, start),
      lte(gatewayPaymentRecordsTable.createdAt, end),
    ));
  let gatewayFees = 0;
  for (const g of gws) gatewayFees += g.feeAmount + g.taxAmount;
  // Platform commission = sum(gateway commission rules applied).
  const commissions = await db.select().from(platformCommissionsTable)
    .where(and(eq(platformCommissionsTable.isActive, true)));
  let platformCommission = 0;
  for (const g of gws) {
    const rule = commissions.find(c => c.gateway === g.gateway && (c.tenantId == null || c.tenantId === tenantId))
      ?? commissions.find(c => c.gateway === g.gateway && c.tenantId == null);
    if (rule) platformCommission += Math.floor(g.amount * rule.percentBps / 10000) + rule.fixedFee;
  }
  const net = collected - refunded - payouts - vendor - gatewayFees - platformCommission;

  // Upsert
  const [existing] = await db.select().from(dailySettlementsTable)
    .where(and(eq(dailySettlementsTable.restaurantId, restaurantId), eq(dailySettlementsTable.settlementDate, start)));
  const values = {
    tenantId, restaurantId, settlementDate: start,
    totalCollected: collected, collectedCash: cash, collectedCard: card, collectedUpi: upi, collectedGateway: gateway, collectedWallet: walletCh,
    totalRefunded: refunded, totalStaffPayouts: payouts, totalVendorPayments: vendor,
    totalGatewayFees: gatewayFees, totalPlatformCommission: platformCommission,
    netSettlement: net, orderCount, refundCount, payoutCount,
    status: "finalised" as const, generatedBy, updatedAt: new Date(),
  };
  if (existing) {
    const [updated] = await db.update(dailySettlementsTable).set(values).where(eq(dailySettlementsTable.id, existing.id)).returning();
    return updated;
  } else {
    const [created] = await db.insert(dailySettlementsTable).values(values).returning();
    return created;
  }
}

router.post("/restaurants/:restaurantId/settlements/run", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const day = req.body?.date ? new Date(String(req.body.date)) : (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d; })();
  const settlement = await generateSettlementForDay(tid(req), rid(req), day, uid(req));
  await recordAuditLog({ req, module: "fintech", action: "settlement_generated", entity: "daily_settlement", entityId: settlement.id, restaurantId: rid(req), newValue: { date: day.toISOString() } });
  res.json(settlement);
});

router.post("/restaurants/:restaurantId/settlements/:id/email", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const id = Number(req.params.id);
  const [updated] = await db.update(dailySettlementsTable).set({ status: "emailed", emailedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(dailySettlementsTable.id, id), eq(dailySettlementsTable.tenantId, tid(req)))).returning();
  res.json(updated);
});

// ─── Reconciliation ─────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/reconciliation/runs", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const rows = await db.select().from(reconciliationRunsTable)
    .where(and(eq(reconciliationRunsTable.tenantId, tid(req)), eq(reconciliationRunsTable.restaurantId, rid(req))))
    .orderBy(desc(reconciliationRunsTable.createdAt)).limit(50);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/reconciliation/runs", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const schema = z.object({
    source: z.enum(["razorpay", "cashfree", "stripe", "cash_shift", "csv"]),
    fromDate: z.string().datetime(),
    toDate: z.string().datetime(),
    externalRecords: z.array(z.object({
      externalRef: z.string(),
      amountPaise: z.number().int(),
    })).default([]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const from = new Date(d.fromDate); const to = new Date(d.toDate);

  // Internal records: gateway payments for the gateway sources, ledger wallet rows for cash_shift/csv.
  let internal: Array<{ externalRef: string | null; amount: number; id: number }> = [];
  if (d.source === "razorpay" || d.source === "cashfree" || d.source === "stripe") {
    const rows = await db.select().from(gatewayPaymentRecordsTable)
      .where(and(
        eq(gatewayPaymentRecordsTable.tenantId, tid(req)),
        eq(gatewayPaymentRecordsTable.restaurantId, rid(req)),
        eq(gatewayPaymentRecordsTable.gateway, d.source),
        gte(gatewayPaymentRecordsTable.createdAt, from),
        lte(gatewayPaymentRecordsTable.createdAt, to),
      ));
    internal = rows.map(r => ({ externalRef: r.gatewayPaymentId, amount: r.amount, id: r.id }));
  } else {
    const rows = await db.select().from(walletTransactionsTable)
      .where(and(
        eq(walletTransactionsTable.tenantId, tid(req)),
        eq(walletTransactionsTable.restaurantId, rid(req)),
        gte(walletTransactionsTable.createdAt, from),
        lte(walletTransactionsTable.createdAt, to),
      )).limit(2000);
    internal = rows.filter(r => r.externalRef).map(r => ({ externalRef: r.externalRef!, amount: r.amount, id: r.id }));
  }

  const externalMap = new Map(d.externalRecords.map(e => [e.externalRef, e.amountPaise]));
  const internalMap = new Map(internal.map(i => [i.externalRef!, i] as const));
  let matched = 0, missingOnPlatform = 0, missingOnGateway = 0, mismatch = 0;
  const variances: any[] = [];
  for (const e of d.externalRecords) {
    const i = internalMap.get(e.externalRef);
    if (!i) { missingOnPlatform++; variances.push({ varianceType: "missing_on_platform", externalRef: e.externalRef, expectedAmount: e.amountPaise }); }
    else if (i.amount !== e.amountPaise) { mismatch++; variances.push({ varianceType: "amount_mismatch", externalRef: e.externalRef, internalRecordId: i.id, expectedAmount: e.amountPaise, actualAmount: i.amount }); }
    else matched++;
  }
  for (const i of internal) {
    if (!externalMap.has(i.externalRef!)) { missingOnGateway++; variances.push({ varianceType: "missing_on_gateway", externalRef: i.externalRef, internalRecordId: i.id, actualAmount: i.amount }); }
  }
  const [run] = await db.insert(reconciliationRunsTable).values({
    tenantId: tid(req), restaurantId: rid(req), source: d.source, fromDate: from, toDate: to,
    totalRecordsExternal: d.externalRecords.length, totalRecordsInternal: internal.length,
    matchedCount: matched, missingOnGatewayCount: missingOnGateway,
    missingOnPlatformCount: missingOnPlatform, amountMismatchCount: mismatch,
    status: "completed", triggeredBy: uid(req),
  }).returning();
  if (variances.length > 0) {
    await db.insert(reconciliationVariancesTable).values(variances.map(v => ({
      runId: run.id, tenantId: tid(req), restaurantId: rid(req), ...v,
    })));
  }
  await recordAuditLog({ req, module: "fintech", action: "reconciliation_run", entity: "reconciliation_run", entityId: run.id, restaurantId: rid(req), newValue: { source: d.source, matched, missingOnGateway, missingOnPlatform, mismatch } });
  res.json({ run, variances: variances.length });
});

router.get("/restaurants/:restaurantId/reconciliation/runs/:id/variances", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(reconciliationVariancesTable)
    .where(and(eq(reconciliationVariancesTable.runId, id), eq(reconciliationVariancesTable.tenantId, tid(req))))
    .orderBy(desc(reconciliationVariancesTable.createdAt)).limit(500);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/reconciliation/variances/:id/resolve", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const id = Number(req.params.id);
  const note = String(req.body?.note ?? "");
  const [updated] = await db.update(reconciliationVariancesTable).set({
    status: "resolved", resolvedBy: uid(req), resolvedAt: new Date(), resolutionNote: note,
  }).where(and(eq(reconciliationVariancesTable.id, id), eq(reconciliationVariancesTable.tenantId, tid(req)))).returning();
  res.json(updated);
});

router.get("/restaurants/:restaurantId/cash-shifts", requireRole("owner", "manager", "cashier", "super_admin"), async (req, res) => {
  const rows = await db.select().from(cashShiftReconciliationsTable)
    .where(and(eq(cashShiftReconciliationsTable.tenantId, tid(req)), eq(cashShiftReconciliationsTable.restaurantId, rid(req))))
    .orderBy(desc(cashShiftReconciliationsTable.shiftDate)).limit(60);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/cash-shifts", requireRole("owner", "manager", "cashier", "super_admin"), async (req, res) => {
  const schema = z.object({
    shiftDate: z.string().datetime(),
    shiftLabel: z.string().optional(),
    expectedPaise: z.number().int().nonnegative(),
    countedPaise: z.number().int().nonnegative(),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const variance = d.countedPaise - d.expectedPaise;
  const [row] = await db.insert(cashShiftReconciliationsTable).values({
    tenantId: tid(req), restaurantId: rid(req),
    shiftDate: new Date(d.shiftDate), shiftLabel: d.shiftLabel,
    expectedCash: d.expectedPaise, countedCash: d.countedPaise, variance,
    status: Math.abs(variance) > 5000 ? "flagged" : "reconciled",
    reconciledBy: uid(req), notes: d.notes,
  }).returning();
  await recordAuditLog({ req, module: "fintech", action: "cash_shift_reconciled", entity: "cash_shift", entityId: row.id, restaurantId: rid(req), newValue: { variance } });
  res.json(row);
});

// ─── Capital placeholders ───────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/capital/credit-score", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  let [row] = await db.select().from(restaurantCreditScoresTable)
    .where(eq(restaurantCreditScoresTable.restaurantId, rid(req)));
  if (!row) {
    // Compute a simple placeholder score from last-30-day collections.
    const since = new Date(); since.setUTCDate(since.getUTCDate() - 30);
    const [agg] = await db.select({ inflow: sql<number>`COALESCE(SUM(${walletTransactionsTable.amount}), 0)`.as("inflow") })
      .from(walletTransactionsTable)
      .where(and(
        eq(walletTransactionsTable.restaurantId, rid(req)),
        eq(walletTransactionsTable.direction, "credit"),
        gte(walletTransactionsTable.createdAt, since),
      ));
    const inflow = Number(agg?.inflow ?? 0);
    const score = Math.min(100, Math.floor(inflow / 1_000_00 / 10)); // 1L paise = ₹1L → 10 points
    const band = score >= 75 ? "excellent" : score >= 50 ? "good" : score >= 25 ? "fair" : "poor";
    [row] = await db.insert(restaurantCreditScoresTable).values({
      tenantId: tid(req), restaurantId: rid(req), score, band,
      signals: { last30dInflowPaise: inflow },
    }).returning();
  }
  res.json(row);
});

router.post("/restaurants/:restaurantId/capital/loan-interest", requireRole("owner", "super_admin"), async (req, res) => {
  const schema = z.object({ requestedPaise: z.number().int().positive().optional(), contactName: z.string().optional(), contactPhone: z.string().optional(), notes: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed" }); return; }
  const [row] = await db.insert(loanEligibilitySignalsTable).values({
    tenantId: tid(req), restaurantId: rid(req),
    estimatedLimit: parsed.data.requestedPaise ?? 0,
    signals: { contactName: parsed.data.contactName, contactPhone: parsed.data.contactPhone, notes: parsed.data.notes },
    status: "callback_requested", notifyMeAt: new Date(),
  }).returning();
  await recordAuditLog({ req, module: "fintech", action: "loan_interest", entity: "loan_eligibility", entityId: row.id, restaurantId: rid(req) });
  res.json(row);
});

router.post("/restaurants/:restaurantId/capital/sales-advance", requireRole("owner", "super_admin"), async (req, res) => {
  const schema = z.object({ requestedPaise: z.number().int().positive(), contactName: z.string().optional(), contactPhone: z.string().optional(), notes: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed" }); return; }
  const [row] = await db.insert(salesAdvanceRequestsTable).values({
    tenantId: tid(req), restaurantId: rid(req),
    requestedAmount: parsed.data.requestedPaise, eligibleAmount: 0,
    status: "callback_requested", contactName: parsed.data.contactName, contactPhone: parsed.data.contactPhone, notes: parsed.data.notes,
  }).returning();
  await recordAuditLog({ req, module: "fintech", action: "sales_advance_request", entity: "sales_advance", entityId: row.id, restaurantId: rid(req) });
  res.json(row);
});

router.post("/restaurants/:restaurantId/insurance/interest", requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const schema = z.object({ offerId: z.number().int().optional(), contactName: z.string().optional(), contactPhone: z.string().optional(), contactEmail: z.string().optional(), notes: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed" }); return; }
  const [row] = await db.insert(insuranceInterestsTable).values({
    tenantId: tid(req), restaurantId: rid(req), ...parsed.data, status: "callback_requested",
  }).returning();
  res.json(row);
});

// ─── Capital / financing module (Toast/Square Capital style) ───────────────
// Plan-gated behind `capital_financing` (Enterprise). Eligibility is
// derived from on-platform sales history; nothing actually moves money —
// status transitions, document uploads and a daily repayment % ledger are
// the user-visible deliverables.

async function capitalFeatureGate(restaurantId: number): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [row] = await db
    .select({ planId: tenantsTable.planId })
    .from(restaurantsTable)
    .innerJoin(tenantsTable, eq(restaurantsTable.tenantId, tenantsTable.id))
    .where(eq(restaurantsTable.id, restaurantId));
  if (!row) return { ok: false, status: 404, error: "Restaurant not found" };
  if (!row.planId) return { ok: true };
  const [plan] = await db.select({ flags: subscriptionPlansTable.featureFlags })
    .from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, row.planId));
  if (plan && !isFeatureEnabled(plan.flags, "capital_financing")) {
    return { ok: false, status: 403, error: "Capital & Financing is available on the Enterprise plan." };
  }
  return { ok: true };
}

function capitalGated() {
  return async (req: any, res: any, next: any) => {
    const r = await capitalFeatureGate(rid(req));
    if (!r.ok) { res.status(r.status).json({ error: r.error }); return; }
    next();
  };
}

async function computeEligibility(restaurantId: number) {
  // Aggregate paid orders over the last 30/90 days.
  const now = new Date();
  const d30 = new Date(now); d30.setUTCDate(now.getUTCDate() - 30);
  const d90 = new Date(now); d90.setUTCDate(now.getUTCDate() - 90);
  const [last30] = await db.select({
    salesRupees: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)`.as("sales_rupees"),
    orderCount: count(ordersTable.id),
  }).from(ordersTable).where(and(
    eq(ordersTable.restaurantId, restaurantId),
    eq(ordersTable.paymentStatus, "paid"),
    gte(ordersTable.createdAt, d30),
  ));
  const [last90] = await db.select({
    salesRupees: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)`.as("sales_rupees"),
    orderCount: count(ordersTable.id),
  }).from(ordersTable).where(and(
    eq(ordersTable.restaurantId, restaurantId),
    eq(ordersTable.paymentStatus, "paid"),
    gte(ordersTable.createdAt, d90),
  ));
  const monthlyPaise = Math.round(Number(last30?.salesRupees ?? 0) * 100);
  const trailingPaise = Math.round(Number(last90?.salesRupees ?? 0) * 100);
  const avgMonthlyPaise = Math.round(trailingPaise / 3);
  // Restaurant tenure: months since createdAt
  const [r] = await db.select({ createdAt: restaurantsTable.createdAt })
    .from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  const months = r?.createdAt
    ? Math.max(0, Math.floor((now.getTime() - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30)))
    : 0;
  // Suggested cap: 50% of avg monthly sales.
  const suggestedMaxPaise = Math.max(0, Math.round(avgMonthlyPaise * 0.5));
  return {
    last30dSalesPaise: monthlyPaise,
    last90dSalesPaise: trailingPaise,
    avgMonthlySalesPaise: avgMonthlyPaise,
    last30dOrderCount: Number(last30?.orderCount ?? 0),
    monthsOnPlatform: months,
    suggestedMaxAdvancePaise: suggestedMaxPaise,
    eligible: avgMonthlyPaise >= 50_000_00 && months >= 3, // ≥ ₹50k/mo and ≥ 3 months
  };
}

router.get("/restaurants/:restaurantId/capital/eligibility", capitalGated(), requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  res.json(await computeEligibility(rid(req)));
});

router.get("/restaurants/:restaurantId/capital/offers", capitalGated(), requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const elig = await computeEligibility(rid(req));
  const rows = await db.select({
    offer: capitalOffersTable,
    partner: financePartnersTable,
  }).from(capitalOffersTable)
    .innerJoin(financePartnersTable, eq(financePartnersTable.id, capitalOffersTable.partnerId))
    .where(and(eq(capitalOffersTable.isActive, true), eq(financePartnersTable.isActive, true)));
  const filtered = rows.filter(({ offer }) =>
    elig.avgMonthlySalesPaise >= Number(offer.minMonthlySalesPaise ?? 0)
    && elig.monthsOnPlatform >= (offer.minMonthsOnPlatform ?? 0),
  );
  res.json({ eligibility: elig, offers: filtered });
});

router.get("/restaurants/:restaurantId/capital/applications", capitalGated(), requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const rows = await db.select().from(capitalApplicationsTable)
    .where(eq(capitalApplicationsTable.restaurantId, rid(req)))
    .orderBy(desc(capitalApplicationsTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/capital/applications", capitalGated(), requireRole("owner", "super_admin"), async (req, res) => {
  const schema = z.object({
    offerId: z.number().int().positive(),
    requestedPaise: z.number().int().positive(),
    contactName: z.string().min(1).optional(),
    contactPhone: z.string().optional(),
    contactEmail: z.string().email().optional(),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const [offer] = await db.select().from(capitalOffersTable).where(eq(capitalOffersTable.id, d.offerId));
  if (!offer || !offer.isActive) { res.status(404).json({ error: "Offer not found or inactive" }); return; }
  const elig = await computeEligibility(rid(req));
  if (!elig.eligible) { res.status(403).json({ error: "Restaurant does not meet baseline eligibility (≥ ₹50k/mo, ≥ 3 months)." }); return; }
  if (d.requestedPaise > Math.max(Number(offer.maxAdvanceAmount), elig.suggestedMaxAdvancePaise)) {
    res.status(400).json({ error: "Requested amount exceeds the offer maximum." }); return;
  }
  const feeAmount = Math.round((d.requestedPaise * (offer.feeBps ?? 0)) / 10_000);
  const now = new Date();
  const timeline = [{ status: "submitted", at: now.toISOString(), by: uid(req), note: "Application submitted by restaurant" }];
  const [row] = await db.insert(capitalApplicationsTable).values({
    tenantId: tid(req), restaurantId: rid(req),
    offerId: offer.id, partnerId: offer.partnerId,
    requestedAmount: d.requestedPaise, approvedAmount: 0,
    feeAmount, dailyRepaymentBps: offer.dailyRepaymentBps ?? 0,
    currency: offer.currency ?? "INR",
    status: "submitted", statusTimeline: timeline,
    contactName: d.contactName, contactPhone: d.contactPhone, contactEmail: d.contactEmail,
    notes: d.notes, submittedBy: uid(req),
  }).returning();
  await recordAuditLog({ req, module: "fintech", action: "capital_application_submitted", entity: "capital_application", entityId: row.id, restaurantId: rid(req), newValue: { offerId: offer.id, requestedPaise: d.requestedPaise } });
  res.json(row);
});

router.post("/restaurants/:restaurantId/capital/applications/:id/cancel", capitalGated(), requireRole("owner", "super_admin"), async (req, res) => {
  const id = Number(req.params.id);
  const [app] = await db.select().from(capitalApplicationsTable)
    .where(and(eq(capitalApplicationsTable.id, id), eq(capitalApplicationsTable.restaurantId, rid(req))));
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  if (!["submitted", "reviewing"].includes(app.status)) {
    res.status(400).json({ error: `Cannot cancel from status ${app.status}` }); return;
  }
  const timeline = [...(app.statusTimeline ?? []), { status: "cancelled", at: new Date().toISOString(), by: uid(req), note: "Cancelled by restaurant" }];
  const [updated] = await db.update(capitalApplicationsTable).set({
    status: "cancelled", statusTimeline: timeline, updatedAt: new Date(),
  }).where(eq(capitalApplicationsTable.id, id)).returning();
  await recordAuditLog({ req, module: "fintech", action: "capital_application_cancelled", entity: "capital_application", entityId: id, restaurantId: rid(req), oldValue: { status: app.status }, newValue: { status: "cancelled" } });
  res.json(updated);
});

router.get("/restaurants/:restaurantId/capital/applications/:id/documents", capitalGated(), requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(capitalApplicationDocumentsTable)
    .where(and(eq(capitalApplicationDocumentsTable.applicationId, id), eq(capitalApplicationDocumentsTable.restaurantId, rid(req))))
    .orderBy(desc(capitalApplicationDocumentsTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/capital/applications/:id/documents", capitalGated(), requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    label: z.string().min(1),
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative().default(0),
    objectPath: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const [app] = await db.select().from(capitalApplicationsTable)
    .where(and(eq(capitalApplicationsTable.id, id), eq(capitalApplicationsTable.restaurantId, rid(req))));
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const [row] = await db.insert(capitalApplicationDocumentsTable).values({
    applicationId: id, tenantId: tid(req), restaurantId: rid(req),
    label: parsed.data.label, fileName: parsed.data.fileName,
    mimeType: parsed.data.mimeType, sizeBytes: parsed.data.sizeBytes,
    objectPath: parsed.data.objectPath, uploadedBy: uid(req),
  }).returning();
  await recordAuditLog({ req, module: "fintech", action: "capital_document_uploaded", entity: "capital_application", entityId: id, restaurantId: rid(req), newValue: { label: parsed.data.label, fileName: parsed.data.fileName } });
  res.json(row);
});

router.get("/restaurants/:restaurantId/capital/applications/:id/repayments", capitalGated(), requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(capitalRepaymentsTable)
    .where(and(eq(capitalRepaymentsTable.applicationId, id), eq(capitalRepaymentsTable.restaurantId, rid(req))))
    .orderBy(desc(capitalRepaymentsTable.forDate))
    .limit(200);
  const [totals] = await db.select({
    repaidPaise: sql<number>`COALESCE(SUM(${capitalRepaymentsTable.repaymentPaise}), 0)`.as("repaid"),
    days: count(capitalRepaymentsTable.id),
  }).from(capitalRepaymentsTable).where(eq(capitalRepaymentsTable.applicationId, id));
  res.json({ entries: rows, totals });
});

router.post("/restaurants/:restaurantId/capital/applications/:id/repayments/run", capitalGated(), requireRole("owner", "manager", "accountant", "super_admin"), async (req, res) => {
  // Placeholder: compute repayment entries from yesterday's sales back to the
  // application's acceptance/disbursement date. Idempotent via the unique
  // (applicationId, forDate) index.
  const id = Number(req.params.id);
  const [app] = await db.select().from(capitalApplicationsTable)
    .where(and(eq(capitalApplicationsTable.id, id), eq(capitalApplicationsTable.restaurantId, rid(req))));
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  if (!["accepted", "repaying"].includes(app.status)) {
    res.status(400).json({ error: "Repayments only run for accepted applications." }); return;
  }
  const fromDate = app.disbursedAt ?? app.reviewedAt ?? app.updatedAt;
  const start = new Date(fromDate); start.setUTCHours(0, 0, 0, 0);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const bps = app.dailyRepaymentBps ?? 0;
  let inserted = 0;
  for (let day = new Date(start); day < today; day.setUTCDate(day.getUTCDate() + 1)) {
    const dayStart = new Date(day);
    const dayEnd = new Date(day); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    const [agg] = await db.select({
      sales: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)`.as("sales"),
    }).from(ordersTable).where(and(
      eq(ordersTable.restaurantId, rid(req)),
      eq(ordersTable.paymentStatus, "paid"),
      gte(ordersTable.createdAt, dayStart),
      lte(ordersTable.createdAt, dayEnd),
    ));
    const salesPaise = Math.round(Number(agg?.sales ?? 0) * 100);
    const repaymentPaise = Math.round((salesPaise * bps) / 10_000);
    try {
      await db.insert(capitalRepaymentsTable).values({
        applicationId: id, tenantId: tid(req), restaurantId: rid(req),
        forDate: new Date(dayStart), salesPaise, bps, repaymentPaise,
        status: "placeholder",
      });
      inserted++;
    } catch (e: any) {
      // Unique violation → already recorded for that day; skip.
      if (!String(e?.message ?? "").includes("duplicate key")) throw e;
    }
  }
  res.json({ ok: true, insertedDays: inserted });
});

// ─── Public-ish: insurance offer catalogue ──────────────────────────────────

router.get("/insurance/offers", async (_req, res) => {
  const rows = await db.select().from(insuranceOffersTable).where(eq(insuranceOffersTable.isActive, true));
  res.json(rows);
});

// ─── Super admin: cross-tenant fintech ──────────────────────────────────────

const adminRouter = Router();
adminRouter.use("/admin", requireSuperAdmin);

adminRouter.get("/admin/fintech/overview", async (_req, res) => {
  const [walletAgg] = await db.select({
    totalWallets: count(walletsTable.id),
    totalBalance: sql<number>`COALESCE(SUM(${walletsTable.balance}), 0)`.as("total_balance"),
    totalReserved: sql<number>`COALESCE(SUM(${walletsTable.reserved}), 0)`.as("total_reserved"),
  }).from(walletsTable);
  const since = new Date(); since.setUTCDate(since.getUTCDate() - 7);
  const [last7d] = await db.select({
    settlements: count(dailySettlementsTable.id),
    netSettled: sql<number>`COALESCE(SUM(${dailySettlementsTable.netSettlement}), 0)`.as("net_settled"),
  }).from(dailySettlementsTable).where(gte(dailySettlementsTable.settlementDate, since));
  const [openVar] = await db.select({ openVariances: count(reconciliationVariancesTable.id) })
    .from(reconciliationVariancesTable).where(eq(reconciliationVariancesTable.status, "open"));
  res.json({ walletAgg, last7d, openVariances: openVar?.openVariances ?? 0 });
});

adminRouter.get("/admin/fintech/wallets", async (req, res) => {
  const limit = Math.min(200, Number(req.query.limit ?? 100));
  const rows = await db.select().from(walletsTable).orderBy(desc(walletsTable.balance)).limit(limit);
  res.json(rows);
});

adminRouter.get("/admin/fintech/commissions", async (_req, res) => {
  const rows = await db.select().from(platformCommissionsTable);
  res.json(rows);
});

adminRouter.post("/admin/fintech/commissions", async (req, res) => {
  const schema = z.object({
    gateway: z.string().min(1),
    tenantId: z.number().int().nullable().optional(),
    percentBps: z.number().int().min(0).max(10000),
    fixedFeePaise: z.number().int().nonnegative().default(0),
    isActive: z.boolean().default(true),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const [existing] = await db.select().from(platformCommissionsTable)
    .where(and(eq(platformCommissionsTable.gateway, d.gateway), d.tenantId == null ? sql`${platformCommissionsTable.tenantId} IS NULL` : eq(platformCommissionsTable.tenantId, d.tenantId)));
  if (existing) {
    const [updated] = await db.update(platformCommissionsTable).set({
      percentBps: d.percentBps, fixedFee: d.fixedFeePaise, isActive: d.isActive, notes: d.notes, updatedBy: uid(req), updatedAt: new Date(),
    }).where(eq(platformCommissionsTable.id, existing.id)).returning();
    res.json(updated); return;
  }
  const [row] = await db.insert(platformCommissionsTable).values({
    gateway: d.gateway, tenantId: d.tenantId ?? null, percentBps: d.percentBps,
    fixedFee: d.fixedFeePaise, isActive: d.isActive, notes: d.notes, updatedBy: uid(req),
  }).returning();
  await recordAuditLog({ req, module: "fintech", action: "commission_set", entity: "platform_commission", entityId: row.id, newValue: row });
  res.json(row);
});

adminRouter.get("/admin/fintech/refunds", async (_req, res) => {
  const rows = await db.select().from(refundsTable).orderBy(desc(refundsTable.createdAt)).limit(200);
  res.json(rows);
});

adminRouter.get("/admin/fintech/variances", async (_req, res) => {
  const rows = await db.select().from(reconciliationVariancesTable)
    .where(eq(reconciliationVariancesTable.status, "open"))
    .orderBy(desc(reconciliationVariancesTable.createdAt)).limit(200);
  res.json(rows);
});

adminRouter.get("/admin/fintech/insurance-offers", async (_req, res) => {
  const rows = await db.select().from(insuranceOffersTable).orderBy(desc(insuranceOffersTable.createdAt));
  res.json(rows);
});

adminRouter.post("/admin/fintech/insurance-offers", async (req, res) => {
  const schema = z.object({
    slug: z.string().min(2),
    title: z.string().min(2),
    shortDescription: z.string().optional(),
    category: z.string().default("general"),
    monthlyPremiumPaise: z.number().int().nonnegative().default(0),
    isActive: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const [existing] = await db.select().from(insuranceOffersTable).where(eq(insuranceOffersTable.slug, d.slug));
  if (existing) {
    const [updated] = await db.update(insuranceOffersTable).set({
      title: d.title, shortDescription: d.shortDescription, category: d.category,
      monthlyPremiumEstimate: d.monthlyPremiumPaise, isActive: d.isActive, updatedAt: new Date(),
    }).where(eq(insuranceOffersTable.id, existing.id)).returning();
    res.json(updated); return;
  }
  const [row] = await db.insert(insuranceOffersTable).values({
    slug: d.slug, title: d.title, shortDescription: d.shortDescription,
    category: d.category, monthlyPremiumEstimate: d.monthlyPremiumPaise, isActive: d.isActive,
  }).returning();
  res.json(row);
});

adminRouter.patch("/admin/fintech/tenant-settings/:tenantId", async (req, res) => {
  const tenantId = Number(req.params.tenantId);
  const schema = z.object({
    walletsEnabled: z.boolean().optional(),
    giftCardsEnabled: z.boolean().optional(),
    cashbackEnabled: z.boolean().optional(),
    subscriptionWalletEnabled: z.boolean().optional(),
    capitalEnabled: z.boolean().optional(),
    requirePayoutApproval: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (d.walletsEnabled != null) patch.fintechWalletsEnabled = d.walletsEnabled;
  if (d.giftCardsEnabled != null) patch.fintechGiftCardsEnabled = d.giftCardsEnabled;
  if (d.cashbackEnabled != null) patch.fintechCashbackEnabled = d.cashbackEnabled;
  if (d.subscriptionWalletEnabled != null) patch.fintechSubscriptionWalletEnabled = d.subscriptionWalletEnabled;
  if (d.capitalEnabled != null) patch.fintechCapitalEnabled = d.capitalEnabled;
  if (d.requirePayoutApproval != null) patch.fintechRequirePayoutApproval = d.requirePayoutApproval;
  await db.update(tenantsTable).set(patch as any).where(eq(tenantsTable.id, tenantId));
  await recordAuditLog({ req, module: "fintech", action: "tenant_settings_updated", entity: "tenant", entityId: tenantId, newValue: d });
  res.json({ ok: true });
});

// ─── Super-admin: Finance Partners & Capital Applications dashboard ────────

adminRouter.get("/admin/finance-partners", async (_req, res) => {
  const partners = await db.select().from(financePartnersTable).orderBy(desc(financePartnersTable.createdAt));
  const offers = await db.select().from(capitalOffersTable);
  const byPartner = new Map<number, any[]>();
  for (const o of offers) {
    const arr = byPartner.get(o.partnerId) ?? [];
    arr.push(o);
    byPartner.set(o.partnerId, arr);
  }
  res.json(partners.map(p => ({ ...p, offers: byPartner.get(p.id) ?? [] })));
});

adminRouter.post("/admin/finance-partners", async (req, res) => {
  const schema = z.object({
    slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().optional(),
    websiteUrl: z.string().url().optional(),
    description: z.string().optional(),
    isActive: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const [existing] = await db.select().from(financePartnersTable).where(eq(financePartnersTable.slug, parsed.data.slug));
  if (existing) { res.status(409).json({ error: "slug_in_use" }); return; }
  const [row] = await db.insert(financePartnersTable).values(parsed.data).returning();
  await recordAuditLog({ req, module: "fintech", action: "finance_partner_created", entity: "finance_partner", entityId: row.id, newValue: row });
  res.json(row);
});

adminRouter.patch("/admin/finance-partners/:id", async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    name: z.string().min(1).optional(),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().optional(),
    websiteUrl: z.string().url().optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const [old] = await db.select().from(financePartnersTable).where(eq(financePartnersTable.id, id));
  if (!old) { res.status(404).json({ error: "not_found" }); return; }
  const [row] = await db.update(financePartnersTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(financePartnersTable.id, id)).returning();
  await recordAuditLog({ req, module: "fintech", action: "finance_partner_updated", entity: "finance_partner", entityId: id, oldValue: old, newValue: row });
  res.json(row);
});

adminRouter.post("/admin/finance-partners/:id/offers", async (req, res) => {
  const partnerId = Number(req.params.id);
  const schema = z.object({
    title: z.string().min(1),
    productType: z.enum(["sales_advance", "term_loan", "line_of_credit"]).default("sales_advance"),
    minAdvanceAmount: z.number().int().nonnegative().default(0),
    maxAdvanceAmount: z.number().int().nonnegative(),
    feeBps: z.number().int().min(0).max(10000).default(0),
    dailyRepaymentBps: z.number().int().min(0).max(10000).default(0),
    minMonthlySalesPaise: z.number().int().nonnegative().default(0),
    minMonthsOnPlatform: z.number().int().min(0).default(3),
    description: z.string().optional(),
    isActive: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const [partner] = await db.select().from(financePartnersTable).where(eq(financePartnersTable.id, partnerId));
  if (!partner) { res.status(404).json({ error: "partner_not_found" }); return; }
  const [row] = await db.insert(capitalOffersTable).values({ ...parsed.data, partnerId }).returning();
  await recordAuditLog({ req, module: "fintech", action: "capital_offer_created", entity: "capital_offer", entityId: row.id, newValue: row });
  res.json(row);
});

adminRouter.patch("/admin/finance-partners/offers/:offerId", async (req, res) => {
  const id = Number(req.params.offerId);
  const schema = z.object({
    title: z.string().min(1).optional(),
    maxAdvanceAmount: z.number().int().nonnegative().optional(),
    feeBps: z.number().int().min(0).max(10000).optional(),
    dailyRepaymentBps: z.number().int().min(0).max(10000).optional(),
    minMonthlySalesPaise: z.number().int().nonnegative().optional(),
    minMonthsOnPlatform: z.number().int().min(0).optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const [old] = await db.select().from(capitalOffersTable).where(eq(capitalOffersTable.id, id));
  if (!old) { res.status(404).json({ error: "not_found" }); return; }
  const [row] = await db.update(capitalOffersTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(capitalOffersTable.id, id)).returning();
  await recordAuditLog({ req, module: "fintech", action: "capital_offer_updated", entity: "capital_offer", entityId: id, oldValue: old, newValue: row });
  res.json(row);
});

adminRouter.get("/admin/capital/applications", async (req, res) => {
  const status = (req.query.status as string | undefined)?.trim();
  const where = status && status !== "all" ? eq(capitalApplicationsTable.status, status) : undefined;
  const rows = await db.select({
    app: capitalApplicationsTable,
    restaurantName: restaurantsTable.name,
    partnerName: financePartnersTable.name,
    offerTitle: capitalOffersTable.title,
  }).from(capitalApplicationsTable)
    .leftJoin(restaurantsTable, eq(restaurantsTable.id, capitalApplicationsTable.restaurantId))
    .leftJoin(financePartnersTable, eq(financePartnersTable.id, capitalApplicationsTable.partnerId))
    .leftJoin(capitalOffersTable, eq(capitalOffersTable.id, capitalApplicationsTable.offerId))
    .where(where ?? sql`TRUE`)
    .orderBy(desc(capitalApplicationsTable.createdAt))
    .limit(500);
  res.json(rows);
});

adminRouter.get("/admin/capital/applications/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [app] = await db.select().from(capitalApplicationsTable).where(eq(capitalApplicationsTable.id, id));
  if (!app) { res.status(404).json({ error: "not_found" }); return; }
  const docs = await db.select().from(capitalApplicationDocumentsTable).where(eq(capitalApplicationDocumentsTable.applicationId, id));
  const repayments = await db.select().from(capitalRepaymentsTable).where(eq(capitalRepaymentsTable.applicationId, id)).orderBy(desc(capitalRepaymentsTable.forDate)).limit(60);
  res.json({ application: app, documents: docs, repayments });
});

adminRouter.post("/admin/capital/applications/:id/review", async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    action: z.enum(["mark_reviewing", "accept", "reject"]),
    approvedAmount: z.number().int().nonnegative().optional(),
    feeAmount: z.number().int().nonnegative().optional(),
    dailyRepaymentBps: z.number().int().min(0).max(10000).optional(),
    reason: z.string().max(2000).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const [app] = await db.select().from(capitalApplicationsTable).where(eq(capitalApplicationsTable.id, id));
  if (!app) { res.status(404).json({ error: "not_found" }); return; }
  const allowedFrom: Record<string, string[]> = {
    mark_reviewing: ["submitted"],
    accept: ["submitted", "reviewing"],
    reject: ["submitted", "reviewing"],
  };
  if (!allowedFrom[parsed.data.action].includes(app.status)) {
    res.status(400).json({ error: `Cannot ${parsed.data.action} from status ${app.status}` }); return;
  }
  const now = new Date();
  const newStatus = parsed.data.action === "mark_reviewing" ? "reviewing"
                  : parsed.data.action === "accept" ? "accepted" : "rejected";
  const timeline = [...(app.statusTimeline ?? []), { status: newStatus, at: now.toISOString(), by: uid(req), note: parsed.data.reason }];
  const patch: Record<string, unknown> = {
    status: newStatus, statusTimeline: timeline,
    reviewedBy: uid(req), reviewedAt: now,
    statusReason: parsed.data.reason ?? null,
    updatedAt: now,
  };
  if (parsed.data.action === "accept") {
    patch.approvedAmount = parsed.data.approvedAmount ?? app.requestedAmount;
    if (parsed.data.feeAmount != null) patch.feeAmount = parsed.data.feeAmount;
    if (parsed.data.dailyRepaymentBps != null) patch.dailyRepaymentBps = parsed.data.dailyRepaymentBps;
    patch.disbursedAt = now;
  }
  const [updated] = await db.update(capitalApplicationsTable).set(patch as any).where(eq(capitalApplicationsTable.id, id)).returning();
  await recordAuditLog({
    req, module: "fintech",
    action: `capital_application_${newStatus}`,
    entity: "capital_application", entityId: id,
    restaurantId: app.restaurantId,
    oldValue: { status: app.status, approvedAmount: app.approvedAmount },
    newValue: { status: newStatus, approvedAmount: patch.approvedAmount ?? app.approvedAmount, reason: parsed.data.reason },
  });
  res.json(updated);
});

router.use(adminRouter);

export default router;
