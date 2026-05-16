/**
 * WalletService — atomic money movements over the unified ledger.
 *
 * Pattern (mirrors the AI credit wallet service):
 *   reserve()  → bumps wallet.reserved under FOR UPDATE row lock
 *   commit()   → finalises a reservation: debit + ledger row, releases reserved
 *   release()  → cancels a reservation without debiting
 *   credit()   → unconditional credit to balance + ledger row
 *   debit()    → unconditional debit (refuses to overdraw)
 *   transfer() → paired debit + credit between two wallets, same transferGroupId
 *   adjust()   → super-admin only; signed delta with mandatory reason
 *
 * Every successful call writes exactly one (or two for transfer) wallet
 * transaction rows with opening/closing snapshots and idempotency dedup.
 *
 * All money is integer minor units (paise). Callers MUST round/normalise
 * before passing in.
 */
import { eq, and } from "drizzle-orm";
import {
  db, walletsTable, walletTransactionsTable, type Wallet,
} from "./db";
import { logger } from "./logger";
import { randomUUID } from "crypto";

export type WalletKind = "restaurant" | "customer" | "cashback" | "gift_card" | "subscription";

export type LedgerType =
  | "top_up" | "order_payment" | "refund" | "payout" | "settlement"
  | "adjustment" | "cashback_earn" | "cashback_redeem"
  | "gift_card_load" | "gift_card_redeem" | "subscription_debit"
  | "fee" | "commission" | "transfer_in" | "transfer_out";

export type Channel = "cash" | "card" | "upi" | "gateway" | "bank" | "wallet_transfer" | "manual";

export interface WalletScope {
  tenantId: number;
  kind: WalletKind;
  restaurantId?: number | null;
  customerId?: number | null;
  giftCardId?: number | null;
  currency?: string;
}

export interface MovementInput {
  amount: number; // minor units, > 0
  type: LedgerType;
  channel?: Channel;
  referenceType?: string;
  referenceId?: number;
  externalRef?: string;
  idempotencyKey?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  createdBy?: number | null;
}

export interface Reservation {
  walletId: number;
  tenantId: number;
  amount: number;
  idempotencyKey: string;
}

export class WalletError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// ─── Wallet lookup / creation ───────────────────────────────────────────────

export async function getOrCreateWallet(scope: WalletScope): Promise<Wallet> {
  const { tenantId, kind } = scope;
  const restaurantId = scope.restaurantId ?? null;
  const customerId = scope.customerId ?? null;
  const giftCardId = scope.giftCardId ?? null;

  // Lookup conditions vary by kind so the unique index is honoured.
  const where = (() => {
    if (kind === "subscription") {
      return and(eq(walletsTable.tenantId, tenantId), eq(walletsTable.kind, "subscription"));
    }
    if (kind === "restaurant" && restaurantId != null) {
      return and(eq(walletsTable.restaurantId, restaurantId), eq(walletsTable.kind, "restaurant"));
    }
    if ((kind === "customer" || kind === "cashback") && customerId != null) {
      return and(eq(walletsTable.customerId, customerId), eq(walletsTable.kind, kind));
    }
    if (kind === "gift_card" && giftCardId != null) {
      return and(eq(walletsTable.giftCardId, giftCardId), eq(walletsTable.kind, "gift_card"));
    }
    throw new WalletError("INVALID_SCOPE", `Cannot resolve wallet for kind=${kind} without a scoping id`);
  })();

  const [existing] = await db.select().from(walletsTable).where(where);
  if (existing) return existing;

  try {
    const [created] = await db.insert(walletsTable).values({
      tenantId,
      restaurantId,
      customerId,
      giftCardId,
      kind,
      currency: scope.currency ?? "INR",
    }).returning();
    return created;
  } catch (err) {
    // Race winner already inserted — re-select.
    const [winner] = await db.select().from(walletsTable).where(where);
    if (winner) return winner;
    throw err;
  }
}

export async function getWalletById(id: number): Promise<Wallet | null> {
  const [w] = await db.select().from(walletsTable).where(eq(walletsTable.id, id));
  return w ?? null;
}

// ─── Internal: write a single ledger row inside a transaction ───────────────

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface InternalMovement {
  wallet: Wallet;
  direction: "credit" | "debit" | "reserve" | "release";
  amount: number; // positive minor units
  type: LedgerType;
  channel?: Channel | null;
  referenceType?: string | null;
  referenceId?: number | null;
  externalRef?: string | null;
  transferGroupId?: string | null;
  idempotencyKey?: string | null;
  createdBy?: number | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

async function writeLedger(tx: Tx, m: InternalMovement, opening: number, closing: number): Promise<number> {
  if (m.idempotencyKey) {
    const [dup] = await tx.select({ id: walletTransactionsTable.id })
      .from(walletTransactionsTable)
      .where(and(
        eq(walletTransactionsTable.walletId, m.wallet.id),
        eq(walletTransactionsTable.idempotencyKey, m.idempotencyKey),
      ));
    if (dup) {
      throw new WalletError("DUPLICATE", "Idempotency key already used for this wallet", 409);
    }
  }
  const [row] = await tx.insert(walletTransactionsTable).values({
    walletId: m.wallet.id,
    tenantId: m.wallet.tenantId,
    restaurantId: m.wallet.restaurantId,
    direction: m.direction,
    amount: m.amount,
    currency: m.wallet.currency,
    type: m.type,
    channel: m.channel ?? null,
    referenceType: m.referenceType ?? null,
    referenceId: m.referenceId ?? null,
    externalRef: m.externalRef ?? null,
    transferGroupId: m.transferGroupId ?? null,
    openingBalance: opening,
    closingBalance: closing,
    idempotencyKey: m.idempotencyKey ?? null,
    createdBy: m.createdBy ?? null,
    notes: m.notes ?? null,
    metadata: m.metadata ?? {},
  }).returning({ id: walletTransactionsTable.id });
  return row!.id;
}

function ensurePositiveAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new WalletError("INVALID_AMOUNT", "amount must be a positive integer (minor units)");
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function getBalance(walletId: number): Promise<{ balance: number; reserved: number; available: number } | null> {
  const w = await getWalletById(walletId);
  if (!w) return null;
  return { balance: w.balance, reserved: w.reserved, available: Math.max(0, w.balance - w.reserved) };
}

export async function credit(scope: WalletScope, input: MovementInput): Promise<{ wallet: Wallet; transactionId: number }> {
  ensurePositiveAmount(input.amount);
  const target = await getOrCreateWallet(scope);
  return db.transaction(async tx => {
    const [w] = await tx.select().from(walletsTable).where(eq(walletsTable.id, target.id)).for("update");
    if (!w) throw new WalletError("WALLET_MISSING", "Wallet missing");
    if (w.isFrozen) throw new WalletError("WALLET_FROZEN", "Wallet is frozen", 423);
    const opening = w.balance;
    const closing = opening + input.amount;
    const [updated] = await tx.update(walletsTable).set({
      balance: closing,
      lifetimeIn: w.lifetimeIn + input.amount,
      updatedAt: new Date(),
    }).where(eq(walletsTable.id, w.id)).returning();
    const transactionId = await writeLedger(tx, {
      wallet: updated,
      direction: "credit",
      amount: input.amount,
      type: input.type,
      channel: input.channel,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      externalRef: input.externalRef,
      idempotencyKey: input.idempotencyKey,
      createdBy: input.createdBy,
      notes: input.notes,
      metadata: input.metadata,
    }, opening, closing);
    return { wallet: updated, transactionId };
  });
}

export async function debit(scope: WalletScope, input: MovementInput): Promise<{ wallet: Wallet; transactionId: number }> {
  ensurePositiveAmount(input.amount);
  const target = await getOrCreateWallet(scope);
  return db.transaction(async tx => {
    const [w] = await tx.select().from(walletsTable).where(eq(walletsTable.id, target.id)).for("update");
    if (!w) throw new WalletError("WALLET_MISSING", "Wallet missing");
    if (w.isFrozen) throw new WalletError("WALLET_FROZEN", "Wallet is frozen", 423);
    const available = w.balance - w.reserved;
    if (available < input.amount) {
      throw new WalletError("INSUFFICIENT_FUNDS", `Insufficient funds: available=${available}, requested=${input.amount}`, 422);
    }
    const opening = w.balance;
    const closing = opening - input.amount;
    const [updated] = await tx.update(walletsTable).set({
      balance: closing,
      lifetimeOut: w.lifetimeOut + input.amount,
      updatedAt: new Date(),
    }).where(eq(walletsTable.id, w.id)).returning();
    const transactionId = await writeLedger(tx, {
      wallet: updated,
      direction: "debit",
      amount: input.amount,
      type: input.type,
      channel: input.channel,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      externalRef: input.externalRef,
      idempotencyKey: input.idempotencyKey,
      createdBy: input.createdBy,
      notes: input.notes,
      metadata: input.metadata,
    }, opening, closing);
    return { wallet: updated, transactionId };
  });
}

export async function reserve(scope: WalletScope, input: MovementInput): Promise<Reservation> {
  ensurePositiveAmount(input.amount);
  const target = await getOrCreateWallet(scope);
  const idempotencyKey = input.idempotencyKey ?? `rsv_${randomUUID()}`;
  return db.transaction(async tx => {
    const [w] = await tx.select().from(walletsTable).where(eq(walletsTable.id, target.id)).for("update");
    if (!w) throw new WalletError("WALLET_MISSING", "Wallet missing");
    if (w.isFrozen) throw new WalletError("WALLET_FROZEN", "Wallet is frozen", 423);
    const available = w.balance - w.reserved;
    if (available < input.amount) {
      throw new WalletError("INSUFFICIENT_FUNDS", `Insufficient funds for reservation`, 422);
    }
    const newReserved = w.reserved + input.amount;
    const [updated] = await tx.update(walletsTable).set({
      reserved: newReserved,
      updatedAt: new Date(),
    }).where(eq(walletsTable.id, w.id)).returning();
    await writeLedger(tx, {
      wallet: updated,
      direction: "reserve",
      amount: input.amount,
      type: input.type,
      channel: input.channel,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey,
      createdBy: input.createdBy,
      notes: input.notes,
      metadata: { ...(input.metadata ?? {}), reservation: true },
    }, w.balance, w.balance);
    return { walletId: updated.id, tenantId: updated.tenantId, amount: input.amount, idempotencyKey };
  });
}

export async function commit(reservation: Reservation, opts: { type: LedgerType; channel?: Channel; referenceType?: string; referenceId?: number; externalRef?: string; createdBy?: number | null; notes?: string; metadata?: Record<string, unknown>; actualAmount?: number }): Promise<{ wallet: Wallet; transactionId: number; charged: number }> {
  const requested = Math.max(0, opts.actualAmount ?? reservation.amount);
  const charged = Math.min(requested, reservation.amount);
  return db.transaction(async tx => {
    const [w] = await tx.select().from(walletsTable).where(eq(walletsTable.id, reservation.walletId)).for("update");
    if (!w) throw new WalletError("WALLET_MISSING", "Wallet missing");
    const newReserved = Math.max(0, w.reserved - reservation.amount);
    const opening = w.balance;
    const closing = opening - charged;
    const [updated] = await tx.update(walletsTable).set({
      balance: closing,
      reserved: newReserved,
      lifetimeOut: w.lifetimeOut + charged,
      updatedAt: new Date(),
    }).where(eq(walletsTable.id, w.id)).returning();
    const transactionId = charged > 0 ? await writeLedger(tx, {
      wallet: updated,
      direction: "debit",
      amount: charged,
      type: opts.type,
      channel: opts.channel,
      referenceType: opts.referenceType,
      referenceId: opts.referenceId,
      externalRef: opts.externalRef,
      idempotencyKey: `cmt_${reservation.idempotencyKey}`,
      createdBy: opts.createdBy ?? null,
      notes: opts.notes,
      metadata: { ...(opts.metadata ?? {}), reserved: reservation.amount, charged },
    }, opening, closing) : 0;
    return { wallet: updated, transactionId, charged };
  });
}

export async function release(reservation: Reservation, reason?: string): Promise<void> {
  await db.transaction(async tx => {
    const [w] = await tx.select().from(walletsTable).where(eq(walletsTable.id, reservation.walletId)).for("update");
    if (!w) return;
    const newReserved = Math.max(0, w.reserved - reservation.amount);
    const [updated] = await tx.update(walletsTable).set({
      reserved: newReserved,
      updatedAt: new Date(),
    }).where(eq(walletsTable.id, w.id)).returning();
    await writeLedger(tx, {
      wallet: updated,
      direction: "release",
      amount: reservation.amount,
      type: "adjustment",
      idempotencyKey: `rel_${reservation.idempotencyKey}`,
      notes: reason ?? "Reservation released",
    }, w.balance, w.balance);
  }).catch(err => {
    if (err instanceof WalletError && err.code === "DUPLICATE") return; // already released
    throw err;
  });
}

export async function refund(scope: WalletScope, input: MovementInput): Promise<{ wallet: Wallet; transactionId: number }> {
  return credit(scope, { ...input, type: input.type ?? "refund" });
}

export async function transfer(opts: {
  from: WalletScope; to: WalletScope; amount: number;
  type?: LedgerType; channel?: Channel; notes?: string;
  idempotencyKey?: string; createdBy?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<{ transferGroupId: string; debitTransactionId: number; creditTransactionId: number }> {
  ensurePositiveAmount(opts.amount);
  const fromWallet = await getOrCreateWallet(opts.from);
  const toWallet = await getOrCreateWallet(opts.to);
  if (fromWallet.id === toWallet.id) {
    throw new WalletError("SAME_WALLET", "Cannot transfer to the same wallet");
  }
  const transferGroupId = `xfer_${randomUUID()}`;
  const idempotencyKey = opts.idempotencyKey ?? transferGroupId;
  return db.transaction(async tx => {
    // Always lock in (id ASC) order to prevent deadlocks under concurrent transfers.
    const [a, b] = fromWallet.id < toWallet.id ? [fromWallet, toWallet] : [toWallet, fromWallet];
    const [aLocked] = await tx.select().from(walletsTable).where(eq(walletsTable.id, a.id)).for("update");
    const [bLocked] = await tx.select().from(walletsTable).where(eq(walletsTable.id, b.id)).for("update");
    if (!aLocked || !bLocked) throw new WalletError("WALLET_MISSING", "Wallet missing");
    const src = aLocked.id === fromWallet.id ? aLocked : bLocked;
    const dst = aLocked.id === toWallet.id ? aLocked : bLocked;
    if (src.isFrozen || dst.isFrozen) throw new WalletError("WALLET_FROZEN", "A wallet is frozen", 423);
    const available = src.balance - src.reserved;
    if (available < opts.amount) throw new WalletError("INSUFFICIENT_FUNDS", "Insufficient funds for transfer", 422);

    const srcOpen = src.balance;
    const srcClose = srcOpen - opts.amount;
    const [srcUpd] = await tx.update(walletsTable).set({
      balance: srcClose, lifetimeOut: src.lifetimeOut + opts.amount, updatedAt: new Date(),
    }).where(eq(walletsTable.id, src.id)).returning();

    const dstOpen = dst.balance;
    const dstClose = dstOpen + opts.amount;
    const [dstUpd] = await tx.update(walletsTable).set({
      balance: dstClose, lifetimeIn: dst.lifetimeIn + opts.amount, updatedAt: new Date(),
    }).where(eq(walletsTable.id, dst.id)).returning();

    const debitId = await writeLedger(tx, {
      wallet: srcUpd, direction: "debit", amount: opts.amount,
      type: opts.type ?? "transfer_out", channel: opts.channel ?? "wallet_transfer",
      transferGroupId, idempotencyKey: `${idempotencyKey}_d`,
      createdBy: opts.createdBy, notes: opts.notes, metadata: opts.metadata,
    }, srcOpen, srcClose);
    const creditId = await writeLedger(tx, {
      wallet: dstUpd, direction: "credit", amount: opts.amount,
      type: opts.type ?? "transfer_in", channel: opts.channel ?? "wallet_transfer",
      transferGroupId, idempotencyKey: `${idempotencyKey}_c`,
      createdBy: opts.createdBy, notes: opts.notes, metadata: opts.metadata,
    }, dstOpen, dstClose);
    return { transferGroupId, debitTransactionId: debitId, creditTransactionId: creditId };
  });
}

/**
 * Super-admin manual adjustment with mandatory reason. `delta` may be
 * positive (credit) or negative (debit). Always succeeds even when the
 * resulting balance would go negative — operators sometimes need to
 * write off — but any negative outcome is logged at warn.
 */
export async function adjust(scope: WalletScope, opts: {
  delta: number; reason: string; createdBy: number | null;
  referenceType?: string; referenceId?: number;
  idempotencyKey?: string;
}): Promise<{ wallet: Wallet; transactionId: number }> {
  if (!Number.isInteger(opts.delta) || opts.delta === 0) {
    throw new WalletError("INVALID_AMOUNT", "delta must be a non-zero integer (minor units)");
  }
  if (!opts.reason || opts.reason.trim().length < 3) {
    throw new WalletError("MISSING_REASON", "Manual adjustments require a reason (>=3 chars)");
  }
  const target = await getOrCreateWallet(scope);
  return db.transaction(async tx => {
    const [w] = await tx.select().from(walletsTable).where(eq(walletsTable.id, target.id)).for("update");
    if (!w) throw new WalletError("WALLET_MISSING", "Wallet missing");
    const opening = w.balance;
    const closing = opening + opts.delta;
    if (closing < 0) {
      logger.warn({ walletId: w.id, opening, delta: opts.delta }, "[wallet] adjust pushed balance negative");
    }
    const [updated] = await tx.update(walletsTable).set({
      balance: closing,
      lifetimeIn: opts.delta > 0 ? w.lifetimeIn + opts.delta : w.lifetimeIn,
      lifetimeOut: opts.delta < 0 ? w.lifetimeOut + (-opts.delta) : w.lifetimeOut,
      updatedAt: new Date(),
    }).where(eq(walletsTable.id, w.id)).returning();
    const transactionId = await writeLedger(tx, {
      wallet: updated,
      direction: opts.delta >= 0 ? "credit" : "debit",
      amount: Math.abs(opts.delta),
      type: "adjustment",
      channel: "manual",
      referenceType: opts.referenceType,
      referenceId: opts.referenceId,
      idempotencyKey: opts.idempotencyKey ?? `adj_${randomUUID()}`,
      createdBy: opts.createdBy,
      notes: opts.reason,
      metadata: { manual: true, oldBalance: opening, newBalance: closing },
    }, opening, closing);
    return { wallet: updated, transactionId };
  });
}

export async function setFrozen(walletId: number, isFrozen: boolean, reason: string, by: number | null): Promise<Wallet> {
  return db.transaction(async tx => {
    const [w] = await tx.select().from(walletsTable).where(eq(walletsTable.id, walletId)).for("update");
    if (!w) throw new WalletError("WALLET_MISSING", "Wallet missing");
    const [updated] = await tx.update(walletsTable).set({
      isFrozen, notes: reason, updatedAt: new Date(),
    }).where(eq(walletsTable.id, w.id)).returning();
    await writeLedger(tx, {
      wallet: updated,
      direction: isFrozen ? "release" : "reserve",
      amount: 0 + 1, // ledger row requires positive amount; use 1 minor-unit marker
      type: "adjustment", channel: "manual",
      idempotencyKey: `freeze_${walletId}_${Date.now()}`,
      createdBy: by, notes: `${isFrozen ? "Frozen" : "Unfrozen"}: ${reason}`,
      metadata: { freezeOp: true, isFrozen },
    }, w.balance, w.balance).catch(() => undefined);
    return updated;
  });
}
