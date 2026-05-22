/**
 * Khana AI credits — wallet service, pricing rules, and Express middleware.
 *
 * Every Khana AI feature must:
 *   1. Pre-flight a credit estimate via `requireAiCredits(feature, estimator)`.
 *   2. After the actual provider call, call `commitReservation(res, actualCredits)`
 *      or `refundReservation(res)` on failure.
 *
 * The wallet has three buckets — monthly (resets each plan period), purchased
 * (recharge packs, may expire) and bonus (manual super-admin grants). Debits
 * draw from monthly → bonus → purchased so paid credits are spent last.
 */
import type { Request, Response, NextFunction } from "express";
import { and, eq, sql, desc, gte, inArray } from "drizzle-orm";
import {
  db,
  aiCreditWalletsTable,
  aiCreditTransactionsTable,
  aiFeatureCreditRulesTable,
  aiMonthlyAllocationsTable,
  tenantsTable,
  subscriptionPlansTable,
  aiRequestLogsTable,
  aiRechargePackagesTable,
  isFeatureEnabled,
  type AiCreditWallet,
  type AiFeatureCreditRule,
} from "./db";
import { logger } from "./logger";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CreditBucket = "monthly" | "bonus" | "purchased";

export interface CreditEstimate {
  /**
   * Either pre-computed credits OR a unit count to be priced via the
   * resolved ai_feature_credit_rules row inside the middleware.
   * If both are supplied, `credits` wins (caller is asserting an exact charge).
   */
  credits?: number;
  units?: number;
  /** Optional metadata logged with the transaction. */
  meta?: Record<string, unknown>;
}

export interface AiCreditReservation {
  walletId: number;
  tenantId: number;
  featureSlug: string;
  reservedCredits: number;
  buckets: Array<{ bucket: CreditBucket; credits: number }>;
  meta: Record<string, unknown>;
}

export interface WalletBalance {
  monthly: number;
  purchased: number;
  bonus: number;
  reserved: number;
  available: number;
  used: number;
  isBlocked: boolean;
  purchasedExpiresAt: Date | null;
}

// ─── Wallet helpers ──────────────────────────────────────────────────────────

export async function getOrCreateWallet(tenantId: number): Promise<AiCreditWallet> {
  const [existing] = await db
    .select()
    .from(aiCreditWalletsTable)
    .where(eq(aiCreditWalletsTable.tenantId, tenantId));
  if (existing) return existing;
  // Concurrency-safe create: the unique index ai_credit_wallets_tenant_idx
  // guarantees only one row per tenant. Two parallel first-use requests would
  // both miss the SELECT above; onConflictDoNothing() makes the loser a no-op
  // INSERT and we re-SELECT to return the winner's row.
  const [created] = await db
    .insert(aiCreditWalletsTable)
    .values({ tenantId })
    .onConflictDoNothing({ target: aiCreditWalletsTable.tenantId })
    .returning();
  if (created) return created;
  const [winner] = await db
    .select()
    .from(aiCreditWalletsTable)
    .where(eq(aiCreditWalletsTable.tenantId, tenantId));
  if (!winner) throw new Error(`Wallet upsert failed for tenant ${tenantId}`);
  return winner;
}

export function summarizeWallet(w: AiCreditWallet): WalletBalance {
  // Expire purchased credits if past expiry (read-side only — sweep job does the write).
  const purchased = w.purchasedExpiresAt && w.purchasedExpiresAt.getTime() < Date.now() ? 0 : w.purchasedCredits;
  const monthly = Math.max(0, w.monthlyIncludedCredits);
  const bonus = Math.max(0, w.bonusCredits);
  const reserved = Math.max(0, w.reservedCredits);
  const total = monthly + bonus + purchased;
  return {
    monthly,
    purchased,
    bonus,
    reserved,
    available: Math.max(0, total - reserved),
    used: w.usedCredits,
    isBlocked: w.isBlocked,
    purchasedExpiresAt: w.purchasedExpiresAt,
  };
}

// ─── Pricing rule resolution ─────────────────────────────────────────────────

/**
 * Pick the most-specific active rule for (featureSlug, planId, restaurantId).
 * Specificity: restaurant > plan > global.
 */
export async function resolveCreditRule(opts: {
  featureSlug: string;
  planId?: number | null;
  restaurantId?: number | null;
}): Promise<AiFeatureCreditRule | null> {
  const rows = await db.select().from(aiFeatureCreditRulesTable).where(and(
    eq(aiFeatureCreditRulesTable.featureSlug, opts.featureSlug),
    eq(aiFeatureCreditRulesTable.isActive, true),
  ));
  if (rows.length === 0) return null;
  const restaurant = opts.restaurantId
    ? rows.find(r => r.scopeType === "restaurant" && r.scopeId === opts.restaurantId)
    : undefined;
  if (restaurant) return restaurant;
  const plan = opts.planId
    ? rows.find(r => r.scopeType === "plan" && r.scopeId === opts.planId)
    : undefined;
  if (plan) return plan;
  return rows.find(r => r.scopeType === "global") ?? null;
}

/** Compute final credit charge given a rule and a unit count. */
export function priceCredits(rule: AiFeatureCreditRule, units: number): number {
  const raw = Number(rule.creditsPerUnit) * Math.max(1, Math.ceil(units));
  let credits = Math.max(rule.minCharge, Math.ceil(raw));
  if (rule.maxPerRequest && rule.maxPerRequest > 0) credits = Math.min(credits, rule.maxPerRequest);
  return credits;
}

// ─── Reserve / commit / refund ───────────────────────────────────────────────

interface ReservationOptions {
  tenantId: number;
  featureSlug: string;
  credits: number;
  meta?: Record<string, unknown>;
}

/**
 * Atomically reserve credits — bumps `reserved_credits` under a row lock so
 * concurrent reservations cannot oversell a wallet. Reservation is just an
 * accounting hold; it doesn't pick which bucket to debit (that happens at commit).
 *
 * Throws { code: "INSUFFICIENT_CREDITS" } when the wallet doesn't have enough.
 */
export async function reserveCredits(opts: ReservationOptions): Promise<AiCreditReservation> {
  if (opts.credits <= 0) {
    return { walletId: 0, tenantId: opts.tenantId, featureSlug: opts.featureSlug, reservedCredits: 0, buckets: [], meta: opts.meta ?? {} };
  }
  // Ensure a wallet row exists before opening the transaction (avoids upsert race).
  await getOrCreateWallet(opts.tenantId);
  return db.transaction(async (tx) => {
    const [wallet] = await tx
      .select().from(aiCreditWalletsTable)
      .where(eq(aiCreditWalletsTable.tenantId, opts.tenantId))
      .for("update");
    if (!wallet) throw Object.assign(new Error("Wallet missing"), { code: "WALLET_MISSING" });
    if (wallet.isBlocked) throw Object.assign(new Error("Wallet is blocked"), { code: "WALLET_BLOCKED" });
    const balance = summarizeWallet(wallet);
    if (balance.available < opts.credits) {
      throw Object.assign(new Error("Insufficient credits"), { code: "INSUFFICIENT_CREDITS", available: balance.available, requested: opts.credits });
    }
    const [updated] = await tx.update(aiCreditWalletsTable)
      .set({ reservedCredits: wallet.reservedCredits + opts.credits, updatedAt: new Date() })
      .where(eq(aiCreditWalletsTable.id, wallet.id))
      .returning();
    return {
      walletId: updated.id,
      tenantId: opts.tenantId,
      featureSlug: opts.featureSlug,
      reservedCredits: opts.credits,
      buckets: [],
      meta: opts.meta ?? {},
    };
  });
}

interface CommitOptions {
  reservation: AiCreditReservation;
  actualCredits?: number;
  requestLogId?: number | null;
  userId?: number | null;
}

/**
 * Convert a reservation into a real debit. Drains monthly → bonus → purchased.
 * If actualCredits < reserved, the difference is released back to the wallet.
 */
export async function commitReservation(opts: CommitOptions): Promise<void> {
  const { reservation } = opts;
  if (reservation.reservedCredits <= 0) return;
  // Strict reserve/commit: the debit is capped at what the caller actually
  // reserved. If the provider returned a higher count than the estimate
  // (under-reservation), we charge what was held — never more — so the
  // wallet can never be over-drained beyond the pre-checked balance. The
  // estimator overrun is still surfaced via `overrunCredits` in the ledger
  // metadata so operators can detect and tighten estimators.
  const requested = Math.max(0, opts.actualCredits ?? reservation.reservedCredits);
  const charge = Math.min(requested, reservation.reservedCredits);
  const overrun = requested - charge;

  await db.transaction(async (tx) => {
    const [wallet] = await tx.select().from(aiCreditWalletsTable)
      .where(eq(aiCreditWalletsTable.id, reservation.walletId)).for("update");
    if (!wallet) return;

    // Drain order: monthly → bonus → purchased
    let remaining = charge;
    const drain = (avail: number) => {
      const take = Math.min(avail, remaining);
      remaining -= take;
      return { take, left: avail - take };
    };
    const m = drain(wallet.monthlyIncludedCredits);
    const b = drain(wallet.bonusCredits);
    const p = drain(wallet.purchasedCredits);
    const purchasedLeft = Math.max(0, p.left - remaining);

    const newReserved = Math.max(0, wallet.reservedCredits - reservation.reservedCredits);
    const balanceAfter = m.left + b.left + purchasedLeft;

    await tx.update(aiCreditWalletsTable).set({
      monthlyIncludedCredits: m.left,
      bonusCredits: b.left,
      purchasedCredits: purchasedLeft,
      reservedCredits: newReserved,
      usedCredits: wallet.usedCredits + charge,
      updatedAt: new Date(),
    }).where(eq(aiCreditWalletsTable.id, wallet.id));

    if (charge > 0) {
      const breakdown: Record<string, number> = {};
      if (m.take) breakdown.monthly = m.take;
      if (b.take) breakdown.bonus = b.take;
      if (p.take) breakdown.purchased = p.take;
      await tx.insert(aiCreditTransactionsTable).values({
        walletId: wallet.id,
        tenantId: reservation.tenantId,
        type: "debit",
        featureSlug: reservation.featureSlug,
        credits: -charge,
        bucket: m.take ? "monthly" : b.take ? "bonus" : "purchased",
        balanceAfter,
        requestLogId: opts.requestLogId ?? null,
        createdBy: opts.userId ?? null,
        metadata: {
          ...reservation.meta,
          breakdown,
          reservedCredits: reservation.reservedCredits,
          requestedCredits: requested,
          ...(overrun > 0 ? { overrunCredits: overrun, overrun: true } : {}),
        },
      });
      // Mirror the actual debit onto the request log so usage analytics
      // (which group by ai_request_logs.creditsUsed) reflect real spend.
      if (opts.requestLogId) {
        await tx.update(aiRequestLogsTable)
          .set({ creditsUsed: charge })
          .where(eq(aiRequestLogsTable.id, opts.requestLogId));
      }
    }
  });
  // Best-effort low-credit notice: if this debit pulled the wallet below
  // the configured low-balance threshold (default 100) and it wasn't
  // already below it before, email the tenant owner via the canonical
  // `ai_credits_low` template. Failures are silently logged.
  try {
    const [wallet] = await db.select().from(aiCreditWalletsTable)
      .where(eq(aiCreditWalletsTable.id, reservation.walletId));
    if (wallet) {
      const after = wallet.monthlyIncludedCredits + wallet.bonusCredits + wallet.purchasedCredits;
      const before = after + Math.min(charge, reservation.reservedCredits);
      const threshold = 100;
      if (after <= threshold && before > threshold) {
        const { usersTable } = await import("./db");
        const { sendByTemplateKey } = await import("./emailSender");
        const { sendLifecycleSms } = await import("./smsSender");
        const [owner] = await db.select({ name: usersTable.name, email: usersTable.email, phone: usersTable.phone })
          .from(usersTable)
          .where(and(eq(usersTable.tenantId, reservation.tenantId), eq(usersTable.role, "owner")))
          .limit(1);
        const rechargeUrl = `${(process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/settings/ai-credits`;
        if (owner?.email) {
          void sendByTemplateKey("ai_credits_low", owner.email, {
            name: owner.name ?? "there", balance: String(after), restaurant: "", rechargeUrl,
          }, { tenantId: reservation.tenantId });
        }
        if (owner?.phone) {
          void sendLifecycleSms({
            tenantId: reservation.tenantId, to: owner.phone, eventKey: "ai_credits_low",
            variables: { name: owner.name ?? "there", balance: String(after), restaurant: "", rechargeUrl },
          });
        }
      }
    }
  } catch (err) {
    logger.warn({ err, tenantId: reservation.tenantId }, "ai_credits_low notification failed");
  }
}

/** Release a reservation without debiting (e.g. provider call failed). */
export async function refundReservation(reservation: AiCreditReservation, reason?: string): Promise<void> {
  if (reservation.reservedCredits <= 0) return;
  await db.transaction(async (tx) => {
    const [wallet] = await tx.select().from(aiCreditWalletsTable)
      .where(eq(aiCreditWalletsTable.id, reservation.walletId)).for("update");
    if (!wallet) return;
    const newReserved = Math.max(0, wallet.reservedCredits - reservation.reservedCredits);
    await tx.update(aiCreditWalletsTable)
      .set({ reservedCredits: newReserved, updatedAt: new Date() })
      .where(eq(aiCreditWalletsTable.id, wallet.id));
    await tx.insert(aiCreditTransactionsTable).values({
      walletId: wallet.id,
      tenantId: reservation.tenantId,
      type: "refund",
      featureSlug: reservation.featureSlug,
      credits: 0,
      balanceAfter: wallet.monthlyIncludedCredits + wallet.bonusCredits + wallet.purchasedCredits,
      metadata: { reason: reason ?? "refunded", reservedCredits: reservation.reservedCredits },
    });
  });
}

// ─── Manual / admin operations ───────────────────────────────────────────────

interface ManualAdjustOptions {
  tenantId: number;
  bucket: CreditBucket;
  delta: number;          // positive = grant, negative = deduct
  reason: string;
  adminUserId: number | null;
  expiresAt?: Date | null;
}

export async function adjustWallet(opts: ManualAdjustOptions): Promise<AiCreditWallet> {
  // Lock the wallet row inside a transaction and apply the delta with an
  // SQL expression (`x = greatest(0, x + delta)`) so concurrent admin
  // adjustments / recharges / debits cannot lose updates by overwriting
  // each other's absolute values from a stale read.
  await getOrCreateWallet(opts.tenantId);
  return db.transaction(async (tx) => {
    const [wallet] = await tx.select().from(aiCreditWalletsTable)
      .where(eq(aiCreditWalletsTable.tenantId, opts.tenantId)).for("update");
    if (!wallet) throw new Error("Wallet missing after upsert");
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (opts.bucket === "monthly") {
      update.monthlyIncludedCredits = sql`greatest(0, ${aiCreditWalletsTable.monthlyIncludedCredits} + ${opts.delta})`;
    } else if (opts.bucket === "bonus") {
      update.bonusCredits = sql`greatest(0, ${aiCreditWalletsTable.bonusCredits} + ${opts.delta})`;
    } else if (opts.bucket === "purchased") {
      update.purchasedCredits = sql`greatest(0, ${aiCreditWalletsTable.purchasedCredits} + ${opts.delta})`;
      if (opts.expiresAt !== undefined) update.purchasedExpiresAt = opts.expiresAt;
    }
    const [updated] = await tx.update(aiCreditWalletsTable)
      .set(update)
      .where(eq(aiCreditWalletsTable.id, wallet.id))
      .returning();
    await tx.insert(aiCreditTransactionsTable).values({
      walletId: wallet.id,
      tenantId: opts.tenantId,
      type: opts.delta >= 0 ? "manual_credit" : "manual_debit",
      credits: opts.delta,
      bucket: opts.bucket,
      balanceAfter: updated.monthlyIncludedCredits + updated.bonusCredits + updated.purchasedCredits,
      createdBy: opts.adminUserId,
      notes: opts.reason,
      metadata: { manual: true },
    });
    return updated;
  });
}

export async function setWalletBlocked(tenantId: number, isBlocked: boolean, reason: string | null, adminUserId: number | null): Promise<AiCreditWallet> {
  const wallet = await getOrCreateWallet(tenantId);
  const [updated] = await db.update(aiCreditWalletsTable)
    .set({ isBlocked, blockedReason: isBlocked ? reason : null, updatedAt: new Date() })
    .where(eq(aiCreditWalletsTable.id, wallet.id))
    .returning();
  await db.insert(aiCreditTransactionsTable).values({
    walletId: wallet.id,
    tenantId,
    type: isBlocked ? "block" : "unblock",
    credits: 0,
    balanceAfter: wallet.monthlyIncludedCredits + wallet.bonusCredits + wallet.purchasedCredits,
    createdBy: adminUserId,
    notes: reason,
    metadata: {},
  });
  return updated;
}

export async function setWalletBetaFeatures(tenantId: number, betaFeatures: string[], adminUserId: number | null): Promise<AiCreditWallet> {
  const wallet = await getOrCreateWallet(tenantId);
  const [updated] = await db.update(aiCreditWalletsTable)
    .set({ betaFeatures, updatedAt: new Date() })
    .where(eq(aiCreditWalletsTable.id, wallet.id))
    .returning();
  await db.insert(aiCreditTransactionsTable).values({
    walletId: wallet.id,
    tenantId,
    type: "beta_change",
    credits: 0,
    balanceAfter: wallet.monthlyIncludedCredits + wallet.bonusCredits + wallet.purchasedCredits,
    createdBy: adminUserId,
    notes: `Beta features set to: ${betaFeatures.join(", ") || "(none)"}`,
    metadata: { betaFeatures },
  });
  return updated;
}

// ─── Recharge ────────────────────────────────────────────────────────────────

interface ApplyRechargeOptions {
  tenantId: number;
  packageId: number;
  paymentId?: number | null;
  adminUserId?: number | null;
  notes?: string;
}

/**
 * Drizzle gives us no canonical "tx-or-db" type, so we accept either the root
 * `db` handle or a transaction handle obtained via `db.transaction(async (tx) => …)`.
 * Both expose the same query builder surface we use here. We derive the tx
 * type from `db.transaction`'s callback parameter so the two stay in lockstep
 * with the schema.
 */
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbOrTx = typeof db | DbTx;

/**
 * Internal: credits a wallet from a recharge package, on the supplied db handle.
 * Use {@link applyRecharge} for stand-alone calls; pass an explicit `tx` when
 * the recharge must commit/rollback together with other rows (e.g. settling
 * the linked `ai_credit_recharges` row in the gateway-confirm endpoints).
 */
export async function applyRechargeOnHandle(handle: DbOrTx, opts: ApplyRechargeOptions): Promise<{ wallet: AiCreditWallet; creditsAdded: number; bonusAdded: number; }> {
  const [pkg] = await handle.select().from(aiRechargePackagesTable).where(eq(aiRechargePackagesTable.id, opts.packageId));
  if (!pkg) throw Object.assign(new Error("Recharge package not found"), { code: "PACKAGE_NOT_FOUND" });

  // Ensure a wallet row exists (idempotent upsert on root db; safe inside tx
  // because the unique constraint guarantees a single row per tenant).
  await getOrCreateWallet(opts.tenantId);

  // Re-fetch + LOCK the wallet on the supplied handle so concurrent
  // recharges/adjustments serialize on this row. All subsequent reads &
  // writes use SQL increment expressions on the locked snapshot — never
  // an absolute value computed from a stale read — so two parallel
  // recharges can never lose updates to each other.
  const [wallet] = await handle.select().from(aiCreditWalletsTable)
    .where(eq(aiCreditWalletsTable.tenantId, opts.tenantId)).for("update");
  if (!wallet) throw Object.assign(new Error("Wallet missing after upsert"), { code: "WALLET_MISSING" });

  const credits = Number(pkg.credits) || 0;
  const bonus = Number(pkg.bonusCredits) || 0;
  const expiresAt = pkg.validityDays && pkg.validityDays > 0
    ? new Date(Date.now() + pkg.validityDays * 86400000)
    : null;

  // Extend expiry: take the later of existing and new expiry to be customer-friendly.
  let newExpiry = wallet.purchasedExpiresAt;
  if (expiresAt) {
    newExpiry = newExpiry && newExpiry.getTime() > expiresAt.getTime() ? newExpiry : expiresAt;
  } else if (credits > 0) {
    newExpiry = null; // unlimited validity if pack has none
  }

  const [updated] = await handle.update(aiCreditWalletsTable).set({
    purchasedCredits: sql`${aiCreditWalletsTable.purchasedCredits} + ${credits}`,
    bonusCredits: sql`${aiCreditWalletsTable.bonusCredits} + ${bonus}`,
    purchasedExpiresAt: newExpiry,
    updatedAt: new Date(),
  }).where(eq(aiCreditWalletsTable.id, wallet.id)).returning();

  const balanceAfter = updated.monthlyIncludedCredits + updated.bonusCredits + updated.purchasedCredits;

  if (credits > 0) {
    await handle.insert(aiCreditTransactionsTable).values({
      walletId: wallet.id,
      tenantId: opts.tenantId,
      type: "recharge",
      credits,
      bucket: "purchased",
      balanceAfter,
      paymentId: opts.paymentId ?? null,
      rechargePackageId: opts.packageId,
      createdBy: opts.adminUserId ?? null,
      notes: opts.notes ?? `Recharge: ${pkg.name}`,
      metadata: { packageName: pkg.name, validityDays: pkg.validityDays },
    });
  }
  if (bonus > 0) {
    await handle.insert(aiCreditTransactionsTable).values({
      walletId: wallet.id,
      tenantId: opts.tenantId,
      type: "bonus",
      credits: bonus,
      bucket: "bonus",
      balanceAfter,
      paymentId: opts.paymentId ?? null,
      rechargePackageId: opts.packageId,
      createdBy: opts.adminUserId ?? null,
      notes: `Bonus credits from ${pkg.name}`,
      metadata: { packageName: pkg.name },
    });
  }

  return { wallet: updated, creditsAdded: credits, bonusAdded: bonus };
}

export function applyRecharge(opts: ApplyRechargeOptions) {
  // Wrap in a transaction so the FOR UPDATE wallet lock + increments inside
  // applyRechargeOnHandle actually take effect. Direct (non-tx) callers
  // would otherwise race against concurrent recharge/adjust paths.
  return db.transaction(async (tx) => applyRechargeOnHandle(tx, opts));
}

// ─── Monthly allocation ──────────────────────────────────────────────────────

/**
 * Compute the current renewal cycle for a tenant, anchored on their subscription
 * start day-of-month (e.g. plan started on the 14th → cycles run 14th→14th).
 * Days past month-end clamp to the last day of the shorter month (Jan 31 →
 * Feb 28/29). Returns the period that contains `now`.
 */
export function computeTenantRenewalPeriod(subscriptionStartedAt: Date | null, now: Date = new Date()): { periodStart: Date; periodEnd: Date; anchorDay: number } {
  const anchor = subscriptionStartedAt ?? now;
  const anchorDay = anchor.getUTCDate();
  const yr = now.getUTCFullYear();
  const mo = now.getUTCMonth();
  const clampDay = (year: number, month: number, day: number): number => {
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Math.min(day, lastDay);
  };
  // This-month's anniversary day at 00:00 UTC
  const thisMonthAnniv = new Date(Date.UTC(yr, mo, clampDay(yr, mo, anchorDay)));
  let periodStart: Date;
  if (now.getTime() >= thisMonthAnniv.getTime()) {
    periodStart = thisMonthAnniv;
  } else {
    const prevMo = mo === 0 ? 11 : mo - 1;
    const prevYr = mo === 0 ? yr - 1 : yr;
    periodStart = new Date(Date.UTC(prevYr, prevMo, clampDay(prevYr, prevMo, anchorDay)));
  }
  const nextMo = periodStart.getUTCMonth() === 11 ? 0 : periodStart.getUTCMonth() + 1;
  const nextYr = periodStart.getUTCMonth() === 11 ? periodStart.getUTCFullYear() + 1 : periodStart.getUTCFullYear();
  const periodEnd = new Date(Date.UTC(nextYr, nextMo, clampDay(nextYr, nextMo, anchorDay)));
  return { periodStart, periodEnd, anchorDay };
}

/**
 * Idempotently credit a tenant's monthly allowance for the current renewal
 * cycle (anchored on their subscription start day, NOT the calendar 1st).
 * Returns true if a fresh allocation was made; false if already allocated.
 */
export async function creditMonthlyAllocation(tenantId: number): Promise<{ allocated: boolean; credits: number }> {
  const [tenant] = await db.select({
    id: tenantsTable.id, planId: tenantsTable.planId, planStatus: tenantsTable.planStatus,
    subscriptionStartedAt: tenantsTable.subscriptionStartedAt,
    subscriptionEndsAt: tenantsTable.subscriptionEndsAt,
  }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant || !tenant.planId) return { allocated: false, credits: 0 };
  if (tenant.planStatus !== "active") return { allocated: false, credits: 0 };

  const [plan] = await db.select({
    id: subscriptionPlansTable.id,
    aiEnabled: subscriptionPlansTable.aiEnabled,
    monthly: subscriptionPlansTable.aiMonthlyIncludedCredits,
  }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, tenant.planId));
  if (!plan || !plan.aiEnabled || plan.monthly <= 0) return { allocated: false, credits: 0 };

  const { periodStart, periodEnd } = computeTenantRenewalPeriod(tenant.subscriptionStartedAt);
  // Ensure wallet exists outside the tx (lazy, idempotent — uses upsert semantics).
  await getOrCreateWallet(tenantId);

  // Whole allocation runs in one transaction so the ledger row, allocation
  // record and wallet bucket either all commit or all roll back. The unique
  // index on (tenantId, periodStart) is the authoritative guard against
  // double-allocation under concurrent activation+sweep races: the second
  // transaction's INSERT raises 23505 → caught here → returns "not allocated".
  try {
    return await db.transaction(async (tx) => {
      // Insert the allocation guard FIRST. If a concurrent caller already
      // allocated this cycle, this throws unique_violation and we abort
      // before touching the wallet or writing a duplicate ledger row.
      const [walletRow] = await tx.select().from(aiCreditWalletsTable)
        .where(eq(aiCreditWalletsTable.tenantId, tenantId)).for("update");
      if (!walletRow) return { allocated: false, credits: 0 };

      const [updated] = await tx.update(aiCreditWalletsTable).set({
        // Replace (not add) the monthly bucket — unused credits do NOT roll over.
        monthlyIncludedCredits: plan.monthly,
        monthlyResetAt: periodStart,
        updatedAt: new Date(),
      }).where(eq(aiCreditWalletsTable.id, walletRow.id)).returning();

      const [txRow] = await tx.insert(aiCreditTransactionsTable).values({
        walletId: walletRow.id,
        tenantId,
        type: "monthly_allocation",
        credits: plan.monthly,
        bucket: "monthly",
        balanceAfter: updated.monthlyIncludedCredits + updated.bonusCredits + updated.purchasedCredits,
        notes: `Renewal-cycle allocation ${periodStart.toISOString().slice(0, 10)} → ${periodEnd.toISOString().slice(0, 10)}`,
        metadata: { planId: plan.id, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() },
      }).returning();

      // Allocation record — the unique (tenantId, periodStart) index is what
      // makes this whole function idempotent. If we lost the race, this throws
      // and the rest of the tx (ledger row, wallet update) rolls back.
      await tx.insert(aiMonthlyAllocationsTable).values({
        tenantId, planId: plan.id, periodStart, periodEnd,
        creditsAllocated: plan.monthly, transactionId: txRow.id,
      });

      return { allocated: true, credits: plan.monthly };
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      return { allocated: false, credits: 0 };
    }
    throw err;
  }
}

/** Sweep all active tenants — used by the daily scheduler. */
export async function runMonthlyAllocationSweep(): Promise<{ allocated: number; total: number }> {
  const tenants = await db.select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(and(eq(tenantsTable.planStatus, "active"), eq(tenantsTable.isActive, true)));
  let allocated = 0;
  for (const t of tenants) {
    try {
      const r = await creditMonthlyAllocation(t.id);
      if (r.allocated) allocated++;
    } catch (err) {
      logger.warn({ err, tenantId: t.id }, "[ai-credits] monthly allocation failed");
    }
  }
  return { allocated, total: tenants.length };
}

// ─── Daily request cap & per-feature monthly cap enforcement ────────────────

async function checkDailyRequestCap(tenantId: number, planId: number | null): Promise<void> {
  if (!planId) return;
  const [plan] = await db.select({ cap: subscriptionPlansTable.aiDailyRequestCap })
    .from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId));
  if (!plan || !plan.cap || plan.cap <= 0) return;
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` })
    .from(aiRequestLogsTable)
    .where(and(
      gte(aiRequestLogsTable.createdAt, dayStart),
      eq(aiRequestLogsTable.tenantId, tenantId),
    ));
  if (n >= plan.cap) {
    throw Object.assign(new Error(`Daily AI request cap of ${plan.cap} reached for your plan.`), { code: "DAILY_CAP_REACHED" });
  }
}

async function checkPerFeatureMonthlyCap(tenantId: number, planId: number | null, featureSlug: string): Promise<void> {
  if (!planId) return;
  const [plan] = await db.select({ caps: subscriptionPlansTable.aiPerFeatureMonthlyCaps })
    .from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planId));
  if (!plan) return;
  const cap = (plan.caps as Record<string, number> | null)?.[featureSlug];
  if (!cap || cap <= 0) return;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` })
    .from(aiRequestLogsTable)
    .where(and(
      gte(aiRequestLogsTable.createdAt, monthStart),
      eq(aiRequestLogsTable.featureSlug, featureSlug),
      eq(aiRequestLogsTable.tenantId, tenantId),
    ));
  if (n >= cap) {
    throw Object.assign(new Error(`Monthly cap of ${cap} requests for ${featureSlug} reached.`), { code: "FEATURE_CAP_REACHED" });
  }
}

// ─── Express middleware ──────────────────────────────────────────────────────

export type CreditEstimator = (req: Request) => Promise<CreditEstimate> | CreditEstimate;

/**
 * Express middleware: gates a Khana AI route by checking plan flags, daily &
 * per-feature caps, then reserves credits. The reservation is attached to
 * `res.locals.aiCreditReservation` — the route is responsible for calling
 * `commitReservation` after success or `refundReservation` on failure.
 */
export function requireAiCredits(featureSlug: string, estimator: CreditEstimator) {
  return async function aiCreditsGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) { res.status(403).json({ error: "AI requires a tenant context" }); return; }
      if (req.user?.isSuperAdmin) {
        // Super-admin diagnostic calls bypass credits (still logged downstream).
        res.locals.aiCreditReservation = null;
        return next();
      }

      const [tenant] = await db.select({
        planId: tenantsTable.planId,
        isSuspended: tenantsTable.isSuspended,
        planStatus: tenantsTable.planStatus,
      }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
      if (!tenant) { res.status(403).json({ error: "Tenant not found" }); return; }
      if (tenant.isSuspended) { res.status(403).json({ error: "Account suspended" }); return; }

      // Plan-level AI gating.
      //
      // Source of truth is the `khana_ai_enabled` boolean inside
      // `subscription_plans.feature_flags` (the same flag the route
      // middlewares and sidebar gate on). The legacy
      // `subscription_plans.ai_enabled` column is kept as a back-compat
      // fallback so plans seeded before the flag existed still work.
      if (tenant.planId) {
        const [plan] = await db.select({
          aiEnabled: subscriptionPlansTable.aiEnabled,
          aiFeatureToggles: subscriptionPlansTable.aiFeatureToggles,
          featureFlags: subscriptionPlansTable.featureFlags,
        }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, tenant.planId));
        if (plan) {
          const khanaFlag = isFeatureEnabled(plan.featureFlags ?? null, "khana_ai_enabled");
          const planAllowsAi = khanaFlag || !!plan.aiEnabled;
          if (!planAllowsAi) {
            res.status(402).json({ error: "Khana AI is not included in your plan — upgrade in Settings → Subscription.", code: "AI_NOT_IN_PLAN" });
            return;
          }
        }
        const toggles = plan?.aiFeatureToggles as Record<string, boolean> | null;
        if (toggles && featureSlug in toggles && toggles[featureSlug] === false) {
          res.status(402).json({ error: `${featureSlug} is disabled on your plan.`, code: "AI_FEATURE_DISABLED" });
          return;
        }
      }

      // Daily / per-feature caps
      try {
        await checkDailyRequestCap(tenantId, tenant.planId);
        await checkPerFeatureMonthlyCap(tenantId, tenant.planId, featureSlug);
      } catch (err) {
        const e = err as { code?: string; message?: string };
        res.status(429).json({ error: e.message ?? "Cap reached", code: e.code ?? "CAP_REACHED" });
        return;
      }

      const estimate = await estimator(req);
      // Resolve and price from ai_feature_credit_rules unless caller supplied
      // an exact `credits` value (escape hatch for unusual pricing models).
      let credits: number;
      const ruleMeta: Record<string, unknown> = {};
      if (typeof estimate.credits === "number") {
        credits = Math.max(0, Math.ceil(estimate.credits));
      } else {
        const rule = await resolveCreditRule({
          featureSlug,
          planId: tenant.planId ?? null,
          restaurantId: req.user?.restaurantId ?? null,
        });
        if (!rule) {
          // No rule → feature is gated to super-admins (no per-request price).
          res.status(402).json({ error: `No active credit rule for ${featureSlug}.`, code: "NO_CREDIT_RULE" });
          return;
        }
        const units = Math.max(0, Number(estimate.units ?? 1));
        // Apply free monthly quota: count this tenant's prior successful
        // requests for this feature in the current calendar month.
        if (rule.freeMonthlyQuota > 0) {
          const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
          // Count BOTH paid debits and zero-credit `free_quota` markers so
          // free requests are bounded. Without the marker rows, free
          // requests would be invisible to this counter and the quota
          // would never exhaust.
          const [{ n }] = await db.select({ n: sql<number>`count(*)::int` })
            .from(aiCreditTransactionsTable)
            .where(and(
              eq(aiCreditTransactionsTable.tenantId, tenantId),
              eq(aiCreditTransactionsTable.featureSlug, featureSlug),
              inArray(aiCreditTransactionsTable.type, ["debit", "free_quota"]),
              gte(aiCreditTransactionsTable.createdAt, monthStart),
            ));
          if (n < rule.freeMonthlyQuota) {
            credits = 0;
            ruleMeta.freeQuotaApplied = true;
            ruleMeta.freeQuotaRemaining = rule.freeMonthlyQuota - n - 1;
            // Persist a zero-credit usage marker so subsequent requests in
            // the same month see this one when counting against the quota.
            // The wallet may not exist yet for tenants who have never paid;
            // upsert to guarantee a walletId for the FK.
            const w = await getOrCreateWallet(tenantId);
            await db.insert(aiCreditTransactionsTable).values({
              walletId: w.id,
              tenantId,
              type: "free_quota",
              featureSlug,
              credits: 0,
              balanceAfter: w.monthlyIncludedCredits + w.bonusCredits + w.purchasedCredits,
              metadata: { ruleId: rule.id, units, freeQuotaApplied: true, freeQuotaRemaining: ruleMeta.freeQuotaRemaining },
            });
          } else {
            credits = priceCredits(rule, units);
          }
        } else {
          credits = priceCredits(rule, units);
        }
        ruleMeta.ruleId = rule.id;
        ruleMeta.pricingMode = rule.pricingMode;
        ruleMeta.unitType = rule.unitType;
        ruleMeta.units = units;
      }
      const meta = { ...(estimate.meta ?? {}), ...ruleMeta };
      if (credits === 0) {
        res.locals.aiCreditReservation = { walletId: 0, tenantId, featureSlug, reservedCredits: 0, buckets: [], meta } satisfies AiCreditReservation;
        return next();
      }

      try {
        const reservation = await reserveCredits({ tenantId, featureSlug, credits, meta });
        res.locals.aiCreditReservation = reservation;
        next();
      } catch (err) {
        const e = err as { code?: string; available?: number; requested?: number };
        if (e.code === "INSUFFICIENT_CREDITS") {
          res.status(402).json({ error: "Out of Khana AI credits — recharge in Settings → Subscription.", code: "INSUFFICIENT_CREDITS", available: e.available, requested: e.requested });
          return;
        }
        if (e.code === "WALLET_BLOCKED") {
          res.status(403).json({ error: "Khana AI is blocked for your account. Contact support.", code: "WALLET_BLOCKED" });
          return;
        }
        throw err;
      }
    } catch (err) {
      logger.error({ err }, "[ai-credits] middleware error");
      res.status(500).json({ error: "AI credit check failed" });
    }
  };
}

/**
 * Public-route equivalent of `requireAiCredits` for unauthenticated endpoints
 * (e.g. customer review-QR drafts) where there is no `req.user`. Mirrors the
 * same plan / feature-toggle / cap gating then reserves credits. Returns
 * either `{ ok: true, reservation }` or `{ ok: false, reason }` so the caller
 * can degrade gracefully with HTTP 200.
 */
export async function gatePublicAiCall(opts: {
  tenantId: number;
  featureSlug: string;
  units?: number;
  meta?: Record<string, unknown>;
}): Promise<
  | { ok: true; reservation: AiCreditReservation }
  | { ok: false; reason: "tenant_suspended" | "ai_not_in_plan" | "ai_feature_disabled" | "daily_cap_reached" | "feature_cap_reached" | "no_credit_rule" | "insufficient_credits" | "wallet_blocked" | "wallet_error" }
> {
  const [tenant] = await db.select({
    planId: tenantsTable.planId,
    isSuspended: tenantsTable.isSuspended,
  }).from(tenantsTable).where(eq(tenantsTable.id, opts.tenantId));
  if (!tenant) return { ok: false, reason: "tenant_suspended" };
  if (tenant.isSuspended) return { ok: false, reason: "tenant_suspended" };

  if (tenant.planId) {
    const [plan] = await db.select({
      aiEnabled: subscriptionPlansTable.aiEnabled,
      aiFeatureToggles: subscriptionPlansTable.aiFeatureToggles,
      featureFlags: subscriptionPlansTable.featureFlags,
    }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, tenant.planId));
    if (plan) {
      const khanaFlag = isFeatureEnabled(plan.featureFlags ?? null, "khana_ai_enabled");
      const planAllowsAi = khanaFlag || !!plan.aiEnabled;
      if (!planAllowsAi) return { ok: false, reason: "ai_not_in_plan" };
      const toggles = plan.aiFeatureToggles as Record<string, boolean> | null;
      if (toggles && opts.featureSlug in toggles && toggles[opts.featureSlug] === false) {
        return { ok: false, reason: "ai_feature_disabled" };
      }
    }
  }

  try {
    await checkDailyRequestCap(opts.tenantId, tenant.planId);
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === "DAILY_CAP_REACHED") return { ok: false, reason: "daily_cap_reached" };
    throw err;
  }
  try {
    await checkPerFeatureMonthlyCap(opts.tenantId, tenant.planId, opts.featureSlug);
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === "FEATURE_CAP_REACHED") return { ok: false, reason: "feature_cap_reached" };
    throw err;
  }

  const rule = await resolveCreditRule({ featureSlug: opts.featureSlug, planId: tenant.planId ?? null });
  if (!rule) return { ok: false, reason: "no_credit_rule" };
  const credits = priceCredits(rule, Math.max(0, opts.units ?? 1));

  try {
    const reservation = await reserveCredits({
      tenantId: opts.tenantId, featureSlug: opts.featureSlug, credits,
      meta: { ...(opts.meta ?? {}), ruleId: rule.id, pricingMode: rule.pricingMode, units: opts.units ?? 1 },
    });
    return { ok: true, reservation };
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === "INSUFFICIENT_CREDITS") return { ok: false, reason: "insufficient_credits" };
    if (e.code === "WALLET_BLOCKED") return { ok: false, reason: "wallet_blocked" };
    return { ok: false, reason: "wallet_error" };
  }
}

// ─── Read-side helpers used by routes ────────────────────────────────────────

export async function listTransactions(walletId: number, limit = 50): Promise<Array<typeof aiCreditTransactionsTable.$inferSelect>> {
  return db.select().from(aiCreditTransactionsTable)
    .where(eq(aiCreditTransactionsTable.walletId, walletId))
    .orderBy(desc(aiCreditTransactionsTable.createdAt))
    .limit(limit);
}
