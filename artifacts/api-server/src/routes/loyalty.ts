import { Router } from "express";
import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";
import {
  db, customersTable, loyaltyTransactionsTable, ordersTable,
  loyaltyCashbackWalletsTable, loyaltyCashbackTxnsTable,
  loyaltyStampCardsTable, loyaltyMysteryGrantsTable,
  loyaltyStreakStateTable, loyaltyMilestoneGrantsTable,
  loyaltyBirthdayGrantsTable, loyaltyReferralsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import {
  loadLoyalty2Config, isLoyaltyMechanicEnabled,
  ensureReferralCode, attachReferralByCode, listReferralsForReferrer, referralLeaderboard,
  listMysteryGrants, revealMysteryGrant,
  getStreakState,
  creditCashback, debitCashback, getOrCreateWallet,
  manualAddStamp, listStampCards,
  getFamilyGroupForCustomer, addFamilyMemberByPhone, removeFamilyMember,
  logAudit, listRecentAudit,
} from "../lib/loyalty";

const router = Router();

router.use("/restaurants/:restaurantId", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), validateRestaurantAccess);

// === Customer-facing summary (also used by staff customer detail panel) ===
router.get("/restaurants/:restaurantId/loyalty/summary/:customerId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.customerId);
  const cfg = await loadLoyalty2Config(restaurantId);

  const [customer] = await db.select().from(customersTable).where(and(
    eq(customersTable.id, customerId), eq(customersTable.restaurantId, restaurantId),
  ));
  if (!customer) return void res.status(404).json({ error: "Not found" });

  const [wallet] = await db.select().from(loyaltyCashbackWalletsTable).where(and(
    eq(loyaltyCashbackWalletsTable.restaurantId, restaurantId),
    eq(loyaltyCashbackWalletsTable.customerId, customerId),
  ));
  const stamps = await listStampCards(restaurantId, customerId);
  const mystery = await listMysteryGrants(restaurantId, customerId, 10);
  const streak = await getStreakState(restaurantId, customerId);
  const referralCode = isLoyaltyMechanicEnabled(cfg, "referral") ? await ensureReferralCode(restaurantId, customerId).catch(() => null) : null;
  const family = isLoyaltyMechanicEnabled(cfg, "family") ? await getFamilyGroupForCustomer(restaurantId, customerId) : null;
  const milestones = await db.select().from(loyaltyMilestoneGrantsTable).where(and(
    eq(loyaltyMilestoneGrantsTable.restaurantId, restaurantId),
    eq(loyaltyMilestoneGrantsTable.customerId, customerId),
  ));

  // Tier from lifetime earned points
  const lifetime = Number((await db.select({ s: sql<number>`COALESCE(SUM(${loyaltyTransactionsTable.points}), 0)` })
    .from(loyaltyTransactionsTable).where(and(
      eq(loyaltyTransactionsTable.customerId, customerId),
      eq(loyaltyTransactionsTable.restaurantId, restaurantId),
      eq(loyaltyTransactionsTable.type, "earn"),
    )))[0]?.s ?? 0);
  const sortedTiers = [...cfg.tiers].sort((a, b) => a.threshold - b.threshold);
  let currentTier = sortedTiers[0] ?? { id: "base", name: "Member", threshold: 0, multiplier: 1 };
  let nextTier = null as null | typeof sortedTiers[number];
  for (const t of sortedTiers) {
    if (lifetime >= t.threshold) currentTier = t;
    else { nextTier = t; break; }
  }

  res.json({
    config: cfg,
    customer: { id: customer.id, name: customer.name, phone: customer.phone, dateOfBirth: customer.dateOfBirth },
    points: { balance: customer.loyaltyPoints, lifetimeEarned: lifetime },
    cashback: wallet ?? null,
    tier: { current: currentTier, next: nextTier, lifetimePoints: lifetime },
    stampCards: stamps,
    mysteryGrants: mystery,
    streak: streak ?? null,
    referral: referralCode ? { code: referralCode } : null,
    family: family ?? null,
    milestones,
  });
});

// === Cashback wallet ===
router.get("/restaurants/:restaurantId/loyalty/cashback/:customerId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.customerId);
  const wallet = await getOrCreateWallet(restaurantId, customerId);
  const txns = await db.select().from(loyaltyCashbackTxnsTable).where(and(
    eq(loyaltyCashbackTxnsTable.restaurantId, restaurantId),
    eq(loyaltyCashbackTxnsTable.customerId, customerId),
  )).orderBy(desc(loyaltyCashbackTxnsTable.createdAt)).limit(50);
  res.json({ wallet, transactions: txns });
});

router.post("/restaurants/:restaurantId/loyalty/cashback/:customerId", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.customerId);
  const { amount, type, reason } = req.body as { amount: number; type: "credit" | "redeem"; reason?: string };
  if (!Number.isFinite(amount) || amount <= 0) return void res.status(400).json({ error: "amount > 0 required" });
  if (type === "credit") {
    await creditCashback({ restaurantId, customerId, amount, reason: reason ?? "Manual credit" });
  } else {
    const debited = await debitCashback({ restaurantId, customerId, amount, reason: reason ?? "Manual redeem" });
    if (debited === 0) return void res.status(400).json({ error: "Insufficient balance" });
  }
  await logAudit({ restaurantId, customerId, actorId: (req as any).user?.id ?? null, action: `cashback_${type}`, payload: { amount, reason } });
  const wallet = await getOrCreateWallet(restaurantId, customerId);
  res.json({ wallet });
});

// === Stamps ===
router.post("/restaurants/:restaurantId/loyalty/stamps/:customerId", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const { cardKey, qty } = req.body as { cardKey: string; qty?: number };
  if (!cardKey) return void res.status(400).json({ error: "cardKey required" });
  await manualAddStamp(Number(req.params.restaurantId), Number(req.params.customerId), cardKey, Math.max(1, Number(qty ?? 1)));
  await logAudit({ restaurantId: Number(req.params.restaurantId), customerId: Number(req.params.customerId), action: "stamp_added", payload: { cardKey, qty } });
  res.json({ ok: true });
});

// === Referrals ===
router.get("/restaurants/:restaurantId/loyalty/referral/code/:customerId", async (req, res) => {
  const code = await ensureReferralCode(Number(req.params.restaurantId), Number(req.params.customerId));
  res.json({ code });
});

router.post("/restaurants/:restaurantId/loyalty/referral/attach", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { refereeId, code } = req.body as { refereeId: number; code: string };
  if (!refereeId || !code) return void res.status(400).json({ error: "refereeId and code required" });
  const result = await attachReferralByCode({ restaurantId, refereeId, code });
  if (!result.ok) return void res.status(400).json(result);
  res.json(result);
});

router.get("/restaurants/:restaurantId/loyalty/referral/leaderboard", async (req, res) => {
  const limit = Math.min(100, Number(req.query.limit) || 20);
  res.json(await referralLeaderboard(Number(req.params.restaurantId), limit));
});

router.get("/restaurants/:restaurantId/loyalty/referral/list/:customerId", async (req, res) => {
  res.json(await listReferralsForReferrer(Number(req.params.restaurantId), Number(req.params.customerId)));
});

// === Mystery rewards ===
router.get("/restaurants/:restaurantId/loyalty/mystery/:customerId", async (req, res) => {
  res.json(await listMysteryGrants(Number(req.params.restaurantId), Number(req.params.customerId), 50));
});

router.post("/restaurants/:restaurantId/loyalty/mystery/:customerId/reveal/:id", async (req, res) => {
  const row = await revealMysteryGrant(Number(req.params.restaurantId), Number(req.params.customerId), Number(req.params.id));
  if (!row) return void res.status(404).json({ error: "Not found" });
  res.json(row);
});

// === Family accounts ===
router.get("/restaurants/:restaurantId/loyalty/family/:customerId", async (req, res) => {
  res.json(await getFamilyGroupForCustomer(Number(req.params.restaurantId), Number(req.params.customerId)) ?? { group: null, members: [] });
});

router.post("/restaurants/:restaurantId/loyalty/family/:customerId/add", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const cfg = await loadLoyalty2Config(Number(req.params.restaurantId));
  const result = await addFamilyMemberByPhone({
    restaurantId: Number(req.params.restaurantId),
    primaryCustomerId: Number(req.params.customerId),
    phone: String(req.body?.phone ?? ""),
    cfg: cfg.family,
  });
  if (!result.ok) return void res.status(400).json(result);
  await logAudit({ restaurantId: Number(req.params.restaurantId), customerId: Number(req.params.customerId), action: "family_member_added", payload: result });
  res.json(result);
});

router.post("/restaurants/:restaurantId/loyalty/family/:customerId/remove", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  await removeFamilyMember(Number(req.params.restaurantId), Number(req.body?.memberCustomerId));
  await logAudit({ restaurantId: Number(req.params.restaurantId), customerId: Number(req.params.customerId), action: "family_member_removed", payload: req.body });
  res.json({ ok: true });
});

// === Audit log ===
router.get("/restaurants/:restaurantId/loyalty/audit", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  res.json(await listRecentAudit(Number(req.params.restaurantId), Math.min(500, Number(req.query.limit) || 100)));
});

// === Analytics (CSV + JSON) ===
router.get("/restaurants/:restaurantId/loyalty/analytics", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const days = Math.min(365, Number(req.query.days) || 30);
  const since = new Date(Date.now() - days * 86400_000);

  const [pointsAgg] = await db.select({
    earned: sql<number>`COALESCE(SUM(CASE WHEN ${loyaltyTransactionsTable.type} = 'earn' THEN ${loyaltyTransactionsTable.points} ELSE 0 END), 0)`,
    redeemed: sql<number>`COALESCE(SUM(CASE WHEN ${loyaltyTransactionsTable.type} = 'redeem' THEN -${loyaltyTransactionsTable.points} ELSE 0 END), 0)`,
    expired: sql<number>`COALESCE(SUM(CASE WHEN ${loyaltyTransactionsTable.type} = 'expire' THEN -${loyaltyTransactionsTable.points} ELSE 0 END), 0)`,
  }).from(loyaltyTransactionsTable).where(and(
    eq(loyaltyTransactionsTable.restaurantId, restaurantId),
    gte(loyaltyTransactionsTable.createdAt, since),
  ));

  const [cashbackAgg] = await db.select({
    issued: sql<number>`COALESCE(SUM(CASE WHEN ${loyaltyCashbackTxnsTable.type} = 'credit' THEN ${loyaltyCashbackTxnsTable.amount} ELSE 0 END), 0)`,
    redeemed: sql<number>`COALESCE(SUM(CASE WHEN ${loyaltyCashbackTxnsTable.type} = 'redeem' THEN -${loyaltyCashbackTxnsTable.amount} ELSE 0 END), 0)`,
  }).from(loyaltyCashbackTxnsTable).where(and(
    eq(loyaltyCashbackTxnsTable.restaurantId, restaurantId),
    gte(loyaltyCashbackTxnsTable.createdAt, since),
  ));

  const [stampAgg] = await db.select({
    cards: sql<number>`COUNT(*)`,
    completions: sql<number>`COALESCE(SUM(${loyaltyStampCardsTable.completions}), 0)`,
  }).from(loyaltyStampCardsTable).where(eq(loyaltyStampCardsTable.restaurantId, restaurantId));

  const [referralAgg] = await db.select({
    total: sql<number>`COUNT(*)`,
    converted: sql<number>`COUNT(*) FILTER (WHERE ${loyaltyReferralsTable.status} = 'converted')`,
  }).from(loyaltyReferralsTable).where(eq(loyaltyReferralsTable.restaurantId, restaurantId));

  const [mysteryAgg] = await db.select({ granted: sql<number>`COUNT(*)` })
    .from(loyaltyMysteryGrantsTable).where(and(
      eq(loyaltyMysteryGrantsTable.restaurantId, restaurantId),
      gte(loyaltyMysteryGrantsTable.createdAt, since),
    ));

  const [milestoneAgg] = await db.select({ granted: sql<number>`COUNT(*)` })
    .from(loyaltyMilestoneGrantsTable).where(and(
      eq(loyaltyMilestoneGrantsTable.restaurantId, restaurantId),
      gte(loyaltyMilestoneGrantsTable.createdAt, since),
    ));

  const [birthdayAgg] = await db.select({ granted: sql<number>`COUNT(*)` })
    .from(loyaltyBirthdayGrantsTable).where(and(
      eq(loyaltyBirthdayGrantsTable.restaurantId, restaurantId),
      gte(loyaltyBirthdayGrantsTable.createdAt, since),
    ));

  // Top 10 customers by lifetime points
  const top = await db.select({
    customerId: customersTable.id, name: customersTable.name, phone: customersTable.phone,
    points: customersTable.loyaltyPoints, totalSpent: customersTable.totalSpent,
  }).from(customersTable).where(eq(customersTable.restaurantId, restaurantId))
    .orderBy(desc(customersTable.loyaltyPoints)).limit(10);

  res.json({
    days,
    points: pointsAgg,
    cashback: cashbackAgg,
    stamps: stampAgg,
    referrals: referralAgg,
    mystery: mysteryAgg,
    milestones: milestoneAgg,
    birthday: birthdayAgg,
    topCustomers: top,
  });
});

router.get("/restaurants/:restaurantId/loyalty/analytics/export.csv", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const days = Math.min(365, Number(req.query.days) || 30);
  const since = new Date(Date.now() - days * 86400_000);
  const txns = await db.select().from(loyaltyTransactionsTable).where(and(
    eq(loyaltyTransactionsTable.restaurantId, restaurantId),
    gte(loyaltyTransactionsTable.createdAt, since),
  )).orderBy(desc(loyaltyTransactionsTable.createdAt));
  const header = ["createdAt","customerId","type","points","reason","orderId"].join(",");
  const lines = txns.map(t => [
    t.createdAt.toISOString(), t.customerId, t.type, t.points,
    JSON.stringify(t.reason ?? ""), t.orderId ?? "",
  ].join(","));
  res.type("text/csv").attachment("loyalty-analytics.csv").send([header, ...lines].join("\n"));
});

export default router;
