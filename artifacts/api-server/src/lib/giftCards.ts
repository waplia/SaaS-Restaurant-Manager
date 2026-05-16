/**
 * Gift card service — issue (digital/physical/corporate), redeem (full/partial),
 * lookup by code, transfer, refund, expire-due, list, detail, sales report.
 *
 * All money values are integer paise. Balance moves through walletService against
 * a per-card wallet (kind=gift_card). Status transitions:
 *   active → redeemed  (on debit-to-zero)
 *   active → expired   (daily sweep when expiresAt < now)
 *   active → refunded  (refund flow)
 *   active → void      (admin void)
 */
import { and, eq, gte, lte, sql, desc, inArray, isNull, lt } from "drizzle-orm";
import { randomBytes } from "crypto";
import {
  db,
  giftCardsTable,
  giftCardBatchesTable,
  giftCardTransfersTable,
  giftCardSettingsTable,
  walletsTable,
  walletTransactionsTable,
  type GiftCard,
  type GiftCardBatch,
  type GiftCardSettings,
} from "./db";
import * as wallet from "./walletService";
import { logger } from "./logger";

export type CardType = "digital" | "physical" | "corporate";
export type CardStatus = "active" | "redeemed" | "expired" | "refunded" | "void";

export class GiftCardError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function genGiftCardCode(prefix = "GC"): string {
  return `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

export function maskCode(code: string): string {
  if (code.length <= 4) return "****";
  return code.slice(0, 3) + "****" + code.slice(-2);
}

const DEFAULT_SETTINGS: Omit<GiftCardSettings, "tenantId" | "updatedBy" | "updatedAt"> = {
  refundsAllowed: true,
  refundWindowDays: 30,
  refundPartiallyUsed: false,
  defaultRefundDestination: "source",
  defaultExpiryDays: 365,
  maskCodeForStaff: true,
};

export async function getSettings(tenantId: number): Promise<GiftCardSettings> {
  const [row] = await db.select().from(giftCardSettingsTable).where(eq(giftCardSettingsTable.tenantId, tenantId));
  if (row) return row;
  return { tenantId, ...DEFAULT_SETTINGS, updatedBy: null, updatedAt: new Date() } as GiftCardSettings;
}

export async function upsertSettings(tenantId: number, updates: Partial<typeof DEFAULT_SETTINGS>, updatedBy: number | null): Promise<GiftCardSettings> {
  const [existing] = await db.select().from(giftCardSettingsTable).where(eq(giftCardSettingsTable.tenantId, tenantId));
  if (!existing) {
    const [created] = await db.insert(giftCardSettingsTable).values({
      tenantId,
      ...DEFAULT_SETTINGS,
      ...updates,
      updatedBy,
      updatedAt: new Date(),
    }).returning();
    return created;
  }
  const [updated] = await db.update(giftCardSettingsTable).set({
    ...updates,
    updatedBy,
    updatedAt: new Date(),
  }).where(eq(giftCardSettingsTable.tenantId, tenantId)).returning();
  return updated;
}

// ─── Issue ───────────────────────────────────────────────────────────────────

export interface IssueInput {
  tenantId: number;
  restaurantId: number | null;
  cardType: CardType;
  initialAmountPaise: number;
  recipientCustomerId?: number | null;
  recipientName?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  message?: string | null;
  expiresAt?: Date | null;
  paymentReference?: string | null;
  notes?: string | null;
  issuedBy: number | null;
  batchId?: number | null;
  currency?: string;
}

export async function issue(input: IssueInput): Promise<GiftCard> {
  if (!Number.isFinite(input.initialAmountPaise) || input.initialAmountPaise <= 0) {
    throw new GiftCardError("invalid_amount", "Initial amount must be positive");
  }
  const settings = await getSettings(input.tenantId);
  const expiresAt = input.expiresAt ?? (settings.defaultExpiryDays > 0
    ? new Date(Date.now() + settings.defaultExpiryDays * 86400_000)
    : null);

  const code = genGiftCardCode();
  const [created] = await db.insert(giftCardsTable).values({
    tenantId: input.tenantId,
    restaurantId: input.restaurantId,
    code,
    cardType: input.cardType,
    batchId: input.batchId ?? null,
    recipientCustomerId: input.recipientCustomerId ?? null,
    recipientName: input.recipientName ?? null,
    recipientEmail: input.recipientEmail ?? null,
    recipientPhone: input.recipientPhone ?? null,
    senderName: input.senderName ?? null,
    senderEmail: input.senderEmail ?? null,
    message: input.message ?? null,
    initialAmount: input.initialAmountPaise,
    currency: input.currency ?? "INR",
    expiresAt: expiresAt ?? undefined,
    status: "active",
    paymentReference: input.paymentReference ?? null,
    issuedBy: input.issuedBy,
    notes: input.notes ?? null,
  }).returning();

  const w = await wallet.getOrCreateWallet({
    tenantId: input.tenantId,
    kind: "gift_card",
    giftCardId: created.id,
    currency: created.currency,
  });
  await db.update(giftCardsTable).set({ walletId: w.id }).where(eq(giftCardsTable.id, created.id));
  await wallet.credit(
    { tenantId: input.tenantId, kind: "gift_card", giftCardId: created.id },
    {
      amount: input.initialAmountPaise,
      type: "gift_card_load",
      channel: "manual",
      idempotencyKey: `gc_load_${created.id}`,
      createdBy: input.issuedBy,
      notes: "Initial load",
      externalRef: input.paymentReference ?? undefined,
    },
  );
  return { ...created, walletId: w.id };
}

export interface BatchIssueInput {
  tenantId: number;
  restaurantId: number | null;
  batchType: "physical" | "corporate";
  count: number;
  amountPerCardPaise: number;
  buyerName?: string | null;
  buyerEmail?: string | null;
  buyerPhone?: string | null;
  poNumber?: string | null;
  expiresAt?: Date | null;
  notes?: string | null;
  paymentReference?: string | null;
  issuedBy: number | null;
}

export async function issueBatch(input: BatchIssueInput): Promise<{ batch: GiftCardBatch; cards: GiftCard[] }> {
  if (input.count < 1 || input.count > 5000) {
    throw new GiftCardError("invalid_count", "Batch count must be between 1 and 5000");
  }
  if (input.amountPerCardPaise <= 0) {
    throw new GiftCardError("invalid_amount", "Per-card amount must be positive");
  }
  const [batch] = await db.insert(giftCardBatchesTable).values({
    tenantId: input.tenantId,
    restaurantId: input.restaurantId,
    batchType: input.batchType,
    buyerName: input.buyerName ?? null,
    buyerEmail: input.buyerEmail ?? null,
    buyerPhone: input.buyerPhone ?? null,
    poNumber: input.poNumber ?? null,
    cardCount: input.count,
    amountPerCardPaise: input.amountPerCardPaise,
    expiresAt: input.expiresAt ?? undefined,
    notes: input.notes ?? null,
    issuedBy: input.issuedBy,
  }).returning();

  const cardType: CardType = input.batchType === "corporate" ? "corporate" : "physical";
  const cards: GiftCard[] = [];
  for (let i = 0; i < input.count; i++) {
    const card = await issue({
      tenantId: input.tenantId,
      restaurantId: input.restaurantId,
      cardType,
      initialAmountPaise: input.amountPerCardPaise,
      expiresAt: input.expiresAt ?? null,
      paymentReference: input.paymentReference ?? null,
      notes: input.notes ?? null,
      issuedBy: input.issuedBy,
      batchId: batch.id,
      recipientName: input.buyerName ?? null,
      recipientEmail: input.buyerEmail ?? null,
    });
    cards.push(card);
  }
  return { batch, cards };
}

// ─── Lookup / detail ────────────────────────────────────────────────────────

export async function lookupByCode(tenantId: number, code: string): Promise<(GiftCard & { balance: number }) | null> {
  const normalized = normalizeCode(code);
  const [gc] = await db.select().from(giftCardsTable)
    .where(and(eq(giftCardsTable.tenantId, tenantId), eq(giftCardsTable.code, normalized)));
  if (!gc) return null;
  const balance = gc.walletId ? (await wallet.getBalance(gc.walletId))?.balance ?? 0 : 0;
  return { ...gc, balance };
}

export async function getDetail(tenantId: number, id: number) {
  const [gc] = await db.select().from(giftCardsTable)
    .where(and(eq(giftCardsTable.tenantId, tenantId), eq(giftCardsTable.id, id)));
  if (!gc) return null;
  const balance = gc.walletId ? (await wallet.getBalance(gc.walletId))?.balance ?? 0 : 0;
  const ledger = gc.walletId
    ? await db.select().from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.walletId, gc.walletId))
        .orderBy(desc(walletTransactionsTable.createdAt)).limit(200)
    : [];
  const transfers = await db.select().from(giftCardTransfersTable)
    .where(eq(giftCardTransfersTable.giftCardId, id))
    .orderBy(desc(giftCardTransfersTable.createdAt));
  return { card: gc, balance, ledger, transfers };
}

// ─── Redeem ─────────────────────────────────────────────────────────────────

export interface RedeemInput {
  tenantId: number;
  amountPaise: number;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: number;
  channel?: wallet.Channel;
  createdBy: number | null;
  notes?: string;
}

export async function redeemById(giftCardId: number, input: RedeemInput) {
  const [gc] = await db.select().from(giftCardsTable)
    .where(and(eq(giftCardsTable.id, giftCardId), eq(giftCardsTable.tenantId, input.tenantId)));
  if (!gc) throw new GiftCardError("not_found", "Gift card not found", 404);
  return _redeem(gc, input);
}

export async function redeemByCode(code: string, input: RedeemInput) {
  const normalized = normalizeCode(code);
  const [gc] = await db.select().from(giftCardsTable)
    .where(and(eq(giftCardsTable.tenantId, input.tenantId), eq(giftCardsTable.code, normalized)));
  if (!gc) throw new GiftCardError("not_found", "Gift card not found", 404);
  return _redeem(gc, input);
}

async function _redeem(gc: GiftCard, input: RedeemInput) {
  if (gc.status !== "active") {
    throw new GiftCardError("not_active", `Card is ${gc.status}`, 409);
  }
  if (gc.expiresAt && gc.expiresAt.getTime() < Date.now()) {
    await db.update(giftCardsTable).set({ status: "expired", updatedAt: new Date() })
      .where(eq(giftCardsTable.id, gc.id));
    throw new GiftCardError("expired", "Card has expired", 409);
  }
  if (input.amountPaise <= 0) throw new GiftCardError("invalid_amount", "Amount must be positive");
  const balance = gc.walletId ? (await wallet.getBalance(gc.walletId))?.balance ?? 0 : 0;
  if (input.amountPaise > balance) {
    throw new GiftCardError("insufficient_balance", `Available ${balance}, requested ${input.amountPaise}`, 409);
  }
  const r = await wallet.debit(
    { tenantId: input.tenantId, kind: "gift_card", giftCardId: gc.id },
    {
      amount: input.amountPaise,
      type: "gift_card_redeem",
      channel: input.channel ?? "wallet_transfer",
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      createdBy: input.createdBy,
      notes: input.notes,
    },
  );
  if (r.wallet.balance === 0) {
    await db.update(giftCardsTable).set({ status: "redeemed", updatedAt: new Date() })
      .where(eq(giftCardsTable.id, gc.id));
  }
  return { card: gc, balance: r.wallet.balance, transactionId: r.transactionId };
}

// ─── Transfer ───────────────────────────────────────────────────────────────

export interface TransferInput {
  tenantId: number;
  toCustomerId?: number | null;
  toName?: string | null;
  toEmail?: string | null;
  toPhone?: string | null;
  note?: string | null;
  transferredBy: number | null;
}

export async function transfer(giftCardId: number, input: TransferInput) {
  const [gc] = await db.select().from(giftCardsTable)
    .where(and(eq(giftCardsTable.id, giftCardId), eq(giftCardsTable.tenantId, input.tenantId)));
  if (!gc) throw new GiftCardError("not_found", "Gift card not found", 404);
  if (gc.status !== "active") throw new GiftCardError("not_active", `Card is ${gc.status}`, 409);

  await db.insert(giftCardTransfersTable).values({
    tenantId: input.tenantId,
    giftCardId: gc.id,
    fromCustomerId: gc.recipientCustomerId,
    fromName: gc.recipientName,
    fromEmail: gc.recipientEmail,
    toCustomerId: input.toCustomerId ?? null,
    toName: input.toName ?? null,
    toEmail: input.toEmail ?? null,
    toPhone: input.toPhone ?? null,
    note: input.note ?? null,
    transferredBy: input.transferredBy,
  });
  const [updated] = await db.update(giftCardsTable).set({
    recipientCustomerId: input.toCustomerId ?? null,
    recipientName: input.toName ?? null,
    recipientEmail: input.toEmail ?? null,
    recipientPhone: input.toPhone ?? null,
    updatedAt: new Date(),
  }).where(eq(giftCardsTable.id, gc.id)).returning();
  return updated;
}

// ─── Refund ─────────────────────────────────────────────────────────────────

export interface RefundInput {
  tenantId: number;
  destination?: "source" | "store_credit";
  reason?: string;
  refundedBy: number | null;
}

export async function refund(giftCardId: number, input: RefundInput) {
  const [gc] = await db.select().from(giftCardsTable)
    .where(and(eq(giftCardsTable.id, giftCardId), eq(giftCardsTable.tenantId, input.tenantId)));
  if (!gc) throw new GiftCardError("not_found", "Gift card not found", 404);
  if (gc.status !== "active") throw new GiftCardError("not_active", `Card is ${gc.status}`, 409);

  const settings = await getSettings(input.tenantId);
  if (!settings.refundsAllowed) throw new GiftCardError("refunds_disabled", "Refunds are not allowed", 403);

  const ageDays = (Date.now() - gc.createdAt.getTime()) / 86400_000;
  if (settings.refundWindowDays > 0 && ageDays > settings.refundWindowDays) {
    throw new GiftCardError("refund_window_expired", `Refund window of ${settings.refundWindowDays} days has passed`, 409);
  }
  const balance = gc.walletId ? (await wallet.getBalance(gc.walletId))?.balance ?? 0 : 0;
  const partiallyUsed = balance < gc.initialAmount;
  if (partiallyUsed && !settings.refundPartiallyUsed) {
    throw new GiftCardError("partially_used", "Refunds are not allowed on partially used cards", 409);
  }
  if (balance <= 0) throw new GiftCardError("zero_balance", "Card has no remaining balance", 409);

  const dest = input.destination ?? settings.defaultRefundDestination as "source" | "store_credit";
  // Drain the gift card wallet via debit (refund)
  await wallet.debit(
    { tenantId: input.tenantId, kind: "gift_card", giftCardId: gc.id },
    {
      amount: balance,
      type: "refund",
      channel: dest === "store_credit" ? "wallet_transfer" : "manual",
      idempotencyKey: `gc_refund_${gc.id}`,
      createdBy: input.refundedBy,
      notes: input.reason ?? `Refund to ${dest}`,
    },
  );
  // If store_credit and the card has a customer, credit their cashback wallet
  if (dest === "store_credit" && gc.recipientCustomerId) {
    await wallet.credit(
      { tenantId: input.tenantId, kind: "cashback", customerId: gc.recipientCustomerId },
      {
        amount: balance,
        type: "cashback_earn",
        channel: "wallet_transfer",
        referenceType: "gift_card_refund",
        referenceId: gc.id,
        idempotencyKey: `gc_refund_credit_${gc.id}`,
        createdBy: input.refundedBy,
        notes: `Gift card ${gc.code} refund`,
      },
    );
  }
  const [updated] = await db.update(giftCardsTable).set({
    status: "refunded",
    refundedAt: new Date(),
    refundedAmount: balance,
    refundDestination: dest,
    refundedBy: input.refundedBy,
    updatedAt: new Date(),
  }).where(eq(giftCardsTable.id, gc.id)).returning();
  return updated;
}

// ─── Void ───────────────────────────────────────────────────────────────────

export async function voidCard(tenantId: number, giftCardId: number, voidedBy: number | null, reason: string): Promise<GiftCard> {
  const [gc] = await db.select().from(giftCardsTable)
    .where(and(eq(giftCardsTable.id, giftCardId), eq(giftCardsTable.tenantId, tenantId)));
  if (!gc) throw new GiftCardError("not_found", "Gift card not found", 404);
  const [updated] = await db.update(giftCardsTable).set({
    status: "void", voidedBy, voidReason: reason, updatedAt: new Date(),
  }).where(eq(giftCardsTable.id, giftCardId)).returning();
  return updated;
}

// ─── Expiry sweep ───────────────────────────────────────────────────────────

export async function expireDue(now: Date = new Date()): Promise<number> {
  const due = await db.select({ id: giftCardsTable.id }).from(giftCardsTable)
    .where(and(eq(giftCardsTable.status, "active"), lt(giftCardsTable.expiresAt, now)));
  if (due.length === 0) return 0;
  const ids = due.map(r => r.id);
  await db.update(giftCardsTable).set({ status: "expired", updatedAt: now })
    .where(inArray(giftCardsTable.id, ids));
  return ids.length;
}

// ─── Listing ────────────────────────────────────────────────────────────────

export interface ListFilters {
  tenantId: number;
  restaurantId?: number | null;
  status?: CardStatus;
  cardType?: CardType;
  q?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

export async function list(filters: ListFilters) {
  const cond = [eq(giftCardsTable.tenantId, filters.tenantId)] as ReturnType<typeof eq>[];
  if (filters.restaurantId != null) cond.push(eq(giftCardsTable.restaurantId, filters.restaurantId));
  if (filters.status) cond.push(eq(giftCardsTable.status, filters.status));
  if (filters.cardType) cond.push(eq(giftCardsTable.cardType, filters.cardType));
  if (filters.from) cond.push(gte(giftCardsTable.createdAt, filters.from));
  if (filters.to) cond.push(lte(giftCardsTable.createdAt, filters.to));
  const rows = await db.select().from(giftCardsTable)
    .where(and(...cond))
    .orderBy(desc(giftCardsTable.createdAt))
    .limit(filters.limit ?? 200);
  // Attach live balances in one batched query to avoid N+1
  const walletIds = rows.map(r => r.walletId).filter((x): x is number => x != null);
  const balances = walletIds.length
    ? await db.select({ id: walletsTable.id, balance: walletsTable.balance })
        .from(walletsTable).where(inArray(walletsTable.id, walletIds))
    : [];
  const balanceMap = new Map(balances.map(b => [b.id, b.balance]));
  return rows.map(r => ({ ...r, balance: r.walletId ? balanceMap.get(r.walletId) ?? 0 : 0 }));
}

// ─── Sales report ───────────────────────────────────────────────────────────

export interface SalesReportFilters {
  tenantId: number;
  restaurantId?: number | null;
  from?: Date;
  to?: Date;
  cardType?: CardType;
}

export async function salesReport(filters: SalesReportFilters) {
  const cond = [eq(giftCardsTable.tenantId, filters.tenantId)] as ReturnType<typeof eq>[];
  if (filters.restaurantId != null) cond.push(eq(giftCardsTable.restaurantId, filters.restaurantId));
  if (filters.from) cond.push(gte(giftCardsTable.createdAt, filters.from));
  if (filters.to) cond.push(lte(giftCardsTable.createdAt, filters.to));
  if (filters.cardType) cond.push(eq(giftCardsTable.cardType, filters.cardType));

  const cards = await db.select({
    id: giftCardsTable.id,
    restaurantId: giftCardsTable.restaurantId,
    cardType: giftCardsTable.cardType,
    status: giftCardsTable.status,
    initialAmount: giftCardsTable.initialAmount,
    refundedAmount: giftCardsTable.refundedAmount,
    walletId: giftCardsTable.walletId,
    expiresAt: giftCardsTable.expiresAt,
  }).from(giftCardsTable).where(and(...cond));

  const walletIds = cards.map(c => c.walletId).filter((x): x is number => x != null);
  const balances = walletIds.length
    ? await db.select({ id: walletsTable.id, balance: walletsTable.balance, lifetimeOut: walletsTable.lifetimeOut })
        .from(walletsTable).where(inArray(walletsTable.id, walletIds))
    : [];
  const balMap = new Map(balances.map(b => [b.id, b]));

  let totalIssued = 0, totalRedeemed = 0, totalOutstanding = 0, totalRefunded = 0, totalBreakage = 0;
  const byType: Record<string, { issued: number; redeemed: number; outstanding: number; count: number }> = {};
  const byOutlet: Record<string, { issued: number; redeemed: number; outstanding: number; count: number }> = {};

  for (const c of cards) {
    const b = c.walletId ? balMap.get(c.walletId) : null;
    const balance = b?.balance ?? 0;
    const lifetimeOut = b?.lifetimeOut ?? 0;
    // Redeemed = lifetimeOut minus refundedAmount (which is also a debit but classified as refund).
    const refunded = c.refundedAmount ?? 0;
    const redeemed = Math.max(0, lifetimeOut - refunded);
    totalIssued += c.initialAmount;
    totalRedeemed += redeemed;
    totalRefunded += refunded;
    if (c.status === "active") totalOutstanding += balance;
    if (c.status === "expired") totalBreakage += balance;

    const bt = byType[c.cardType] ?? (byType[c.cardType] = { issued: 0, redeemed: 0, outstanding: 0, count: 0 });
    bt.issued += c.initialAmount; bt.redeemed += redeemed; bt.count += 1;
    if (c.status === "active") bt.outstanding += balance;

    const ok = String(c.restaurantId ?? "tenant");
    const bo = byOutlet[ok] ?? (byOutlet[ok] = { issued: 0, redeemed: 0, outstanding: 0, count: 0 });
    bo.issued += c.initialAmount; bo.redeemed += redeemed; bo.count += 1;
    if (c.status === "active") bo.outstanding += balance;
  }

  return {
    totals: {
      cardsIssued: cards.length,
      issuedAmount: totalIssued,
      redeemedAmount: totalRedeemed,
      outstandingLiability: totalOutstanding,
      refundedAmount: totalRefunded,
      breakageAmount: totalBreakage,
    },
    byType,
    byOutlet,
  };
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown): string => {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [headers.join(","), ...rows.map(r => headers.map(h => escape(r[h])).join(","))].join("\n");
}

logger.debug("[giftCards] service module loaded");
