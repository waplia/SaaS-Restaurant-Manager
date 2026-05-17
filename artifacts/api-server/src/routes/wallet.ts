/**
 * Customer-facing loyalty wallet API.
 *
 * Public:
 *   POST   /wallet/auth/request-otp   — send SMS OTP to phone
 *   POST   /wallet/auth/verify-otp    — exchange OTP for customer access token
 *   GET    /wallet/network/public     — list participating restaurants (public)
 *
 * Customer-auth (Bearer customer JWT):
 *   GET    /wallet/me                 — profile + linked restaurants
 *   PATCH  /wallet/me                 — update name/email
 *   GET    /wallet/summary            — aggregated points / cashback / gift cards / visits
 *   GET    /wallet/restaurants/:rid   — per-restaurant detail (stamps, mystery, txns)
 *   GET    /wallet/visits             — recent orders across linked restaurants
 *   GET    /wallet/rewards            — rewards marketplace (mystery grants + stamp rewards)
 *   POST   /wallet/redeem             — cross-restaurant cashback redeem (placeholder ledger)
 *   GET    /wallet/ledger             — cross-restaurant ledger entries
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  customerUsersTable,
  customerUserLinksTable,
  customersTable,
  restaurantsTable,
  loyaltyPointsTable,
  loyaltyTransactionsTable,
  loyaltyCashbackWalletsTable,
  loyaltyCashbackTxnsTable,
  loyaltyStampCardsTable,
  loyaltyMysteryGrantsTable,
  giftCardsTable,
  ordersTable,
  loyaltyNetworkMembersTable,
  loyaltyNetworkLedgerTable,
} from "../lib/db";
import {
  requestCustomerOtp,
  verifyCustomerOtp,
  verifyCustomerToken,
  type CustomerJwtPayload,
} from "../lib/customerAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ───────────────── Public auth ─────────────────

router.post("/wallet/auth/request-otp", async (req, res) => {
  const phone = String((req.body as { phone?: string }).phone ?? "").trim();
  if (!phone) return void res.status(400).json({ error: "Phone is required" });
  const result = await requestCustomerOtp(phone);
  if (!result.ok) return void res.status(400).json({ error: result.error });
  res.json({ ok: true, devCode: result.devCode ?? undefined });
});

router.post("/wallet/auth/verify-otp", async (req, res) => {
  const { phone, code } = req.body as { phone?: string; code?: string };
  if (!phone || !code) return void res.status(400).json({ error: "Phone and code are required" });
  const result = await verifyCustomerOtp(phone, code);
  if (!result.ok) return void res.status(400).json({ error: result.error });
  res.json({ ok: true, token: result.token, customerUser: result.customerUser });
});

// Public: list participating restaurants for the marketing page / discovery.
router.get("/wallet/network/public", async (_req, res) => {
  const rows = await db.select({
    member: loyaltyNetworkMembersTable,
    restaurant: {
      id: restaurantsTable.id,
      name: restaurantsTable.name,
      city: restaurantsTable.city,
      country: restaurantsTable.country,
      logoUrl: restaurantsTable.logoUrl,
      coverImageUrl: restaurantsTable.coverImageUrl,
      currency: restaurantsTable.currency,
    },
  })
    .from(loyaltyNetworkMembersTable)
    .innerJoin(restaurantsTable, eq(restaurantsTable.id, loyaltyNetworkMembersTable.restaurantId))
    .where(eq(loyaltyNetworkMembersTable.status, "active"));
  res.json(rows.map(r => ({
    restaurantId: r.restaurant.id,
    name: r.member.displayName ?? r.restaurant.name,
    city: r.restaurant.city,
    country: r.restaurant.country,
    logoUrl: r.restaurant.logoUrl,
    coverImageUrl: r.restaurant.coverImageUrl,
    currency: r.restaurant.currency,
    blurb: r.member.blurb,
    allowCrossEarn: r.member.allowCrossEarn,
    allowCrossRedeem: r.member.allowCrossRedeem,
  })));
});

// ───────────────── Customer auth middleware ─────────────────

declare global {
  namespace Express {
    interface Request {
      customerUser?: CustomerJwtPayload;
    }
  }
}

async function requireCustomer(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Sign in to continue" });
    return;
  }
  try {
    const payload = verifyCustomerToken(header.slice(7));
    if (payload.type !== "customer_access") {
      res.status(401).json({ error: "Invalid session" });
      return;
    }
    const [user] = await db.select({ id: customerUsersTable.id, tv: customerUsersTable.tokenVersion })
      .from(customerUsersTable).where(eq(customerUsersTable.id, payload.sub));
    if (!user || user.tv !== payload.tv) {
      res.status(401).json({ error: "Session expired. Please sign in again." });
      return;
    }
    req.customerUser = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ───────────────── Helpers ─────────────────

async function getLinkedCustomerIds(customerUserId: number): Promise<Array<{ customerId: number; restaurantId: number }>> {
  return await db.select({
    customerId: customerUserLinksTable.customerId,
    restaurantId: customerUserLinksTable.restaurantId,
  })
    .from(customerUserLinksTable)
    .where(eq(customerUserLinksTable.customerUserId, customerUserId));
}

async function loadMembers(restaurantIds: number[]): Promise<Map<number, typeof loyaltyNetworkMembersTable.$inferSelect>> {
  if (restaurantIds.length === 0) return new Map();
  const rows = await db.select().from(loyaltyNetworkMembersTable)
    .where(inArray(loyaltyNetworkMembersTable.restaurantId, restaurantIds));
  return new Map(rows.map(r => [r.restaurantId, r]));
}

// ───────────────── Authed routes ─────────────────

router.get("/wallet/me", requireCustomer, async (req, res) => {
  const uid = req.customerUser!.sub;
  const [user] = await db.select().from(customerUsersTable).where(eq(customerUsersTable.id, uid));
  if (!user) return void res.status(404).json({ error: "Account not found" });
  const links = await getLinkedCustomerIds(uid);
  const restaurantIds = [...new Set(links.map(l => l.restaurantId))];
  const restaurants = restaurantIds.length === 0 ? [] : await db.select({
    id: restaurantsTable.id, name: restaurantsTable.name, city: restaurantsTable.city,
    logoUrl: restaurantsTable.logoUrl, currency: restaurantsTable.currency,
  }).from(restaurantsTable).where(inArray(restaurantsTable.id, restaurantIds));
  const members = await loadMembers(restaurantIds);
  res.json({
    customerUser: { id: user.id, phone: user.phone, name: user.name, email: user.email, avatarUrl: user.avatarUrl },
    restaurants: restaurants.map(r => ({
      ...r,
      inNetwork: members.has(r.id) && members.get(r.id)!.status === "active",
    })),
  });
});

router.patch("/wallet/me", requireCustomer, async (req, res) => {
  const uid = req.customerUser!.sub;
  const b = req.body as { name?: string; email?: string };
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof b.name === "string") updates.name = b.name.trim().slice(0, 100) || null;
  if (typeof b.email === "string") updates.email = b.email.trim().slice(0, 200) || null;
  const [row] = await db.update(customerUsersTable).set(updates)
    .where(eq(customerUsersTable.id, uid)).returning();
  res.json({
    customerUser: { id: row.id, phone: row.phone, name: row.name, email: row.email, avatarUrl: row.avatarUrl },
  });
});

router.get("/wallet/summary", requireCustomer, async (req, res) => {
  const uid = req.customerUser!.sub;
  const links = await getLinkedCustomerIds(uid);
  if (links.length === 0) {
    return void res.json({
      totals: { points: 0, cashback: "0.00", giftCardBalance: 0, visits: 0, stampsActive: 0, rewardsAvailable: 0 },
      perRestaurant: [],
    });
  }
  const customerIds = links.map(l => l.customerId);
  const restaurantIds = [...new Set(links.map(l => l.restaurantId))];

  const [points, cashback, gifts, visits, stamps, mystery, restaurants, members] = await Promise.all([
    db.select().from(loyaltyPointsTable).where(inArray(loyaltyPointsTable.customerId, customerIds)),
    db.select().from(loyaltyCashbackWalletsTable).where(inArray(loyaltyCashbackWalletsTable.customerId, customerIds)),
    // Gift cards may be wallet-linked (no customer FK) OR recipient_customer_id-linked.
    db.select().from(giftCardsTable).where(and(
      inArray(giftCardsTable.recipientCustomerId, customerIds),
      eq(giftCardsTable.status, "active"),
    )),
    db.select({
      restaurantId: ordersTable.restaurantId,
      count: sql<number>`COUNT(*)::int`,
      lastAt: sql<Date>`MAX(${ordersTable.createdAt})`,
      spend: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)::text`,
    })
      .from(ordersTable)
      .where(and(
        sql`${ordersTable.notes} IS NOT NULL OR TRUE`, // dummy so eq below is valid even if no customer FK in orders
        inArray(ordersTable.restaurantId, restaurantIds),
      ))
      .groupBy(ordersTable.restaurantId),
    db.select().from(loyaltyStampCardsTable).where(inArray(loyaltyStampCardsTable.customerId, customerIds)),
    db.select().from(loyaltyMysteryGrantsTable).where(and(
      inArray(loyaltyMysteryGrantsTable.customerId, customerIds),
      inArray(loyaltyMysteryGrantsTable.status, ["granted", "revealed"]),
    )),
    db.select({ id: restaurantsTable.id, name: restaurantsTable.name, city: restaurantsTable.city, logoUrl: restaurantsTable.logoUrl, currency: restaurantsTable.currency })
      .from(restaurantsTable).where(inArray(restaurantsTable.id, restaurantIds)),
    loadMembers(restaurantIds),
  ]);

  // Orders table has no direct customerId FK in this schema → approximate
  // visits by matching the customer's phone via customers join. Re-query.
  const visitsByRest = await db.select({
    restaurantId: ordersTable.restaurantId,
    count: sql<number>`COUNT(*)::int`,
    spend: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)::text`,
    lastAt: sql<Date>`MAX(${ordersTable.createdAt})`,
  })
    .from(ordersTable)
    .innerJoin(customersTable, and(
      eq(customersTable.restaurantId, ordersTable.restaurantId),
      // Best-effort visit attribution by phone match
      sql`${customersTable.phone} = (SELECT phone FROM customer_users WHERE id = ${uid})`,
    ))
    .where(inArray(ordersTable.restaurantId, restaurantIds))
    .groupBy(ordersTable.restaurantId);

  const restMap = new Map(restaurants.map(r => [r.id, r]));
  const pointsByRest = new Map<number, typeof points[number]>();
  for (const p of points) pointsByRest.set(p.restaurantId, p);
  const cashbackByRest = new Map<number, typeof cashback[number]>();
  for (const c of cashback) cashbackByRest.set(c.restaurantId, c);
  const stampsByRest = new Map<number, number>();
  for (const s of stamps) stampsByRest.set(s.restaurantId, (stampsByRest.get(s.restaurantId) ?? 0) + 1);
  const mysteryByRest = new Map<number, number>();
  for (const m of mystery) mysteryByRest.set(m.restaurantId, (mysteryByRest.get(m.restaurantId) ?? 0) + 1);
  const giftsByRest = new Map<number, number>();
  for (const g of gifts) {
    if (g.restaurantId) giftsByRest.set(g.restaurantId, (giftsByRest.get(g.restaurantId) ?? 0) + (g.initialAmount ?? 0));
  }
  const visitsMap = new Map(visitsByRest.map(v => [v.restaurantId, v]));

  const perRestaurant = restaurantIds.map(rid => {
    const r = restMap.get(rid);
    const member = members.get(rid);
    const v = visitsMap.get(rid);
    return {
      restaurantId: rid,
      name: r?.name ?? "Restaurant",
      city: r?.city ?? null,
      logoUrl: r?.logoUrl ?? null,
      currency: r?.currency ?? "INR",
      inNetwork: !!member && member.status === "active",
      points: pointsByRest.get(rid)?.balance ?? 0,
      cashback: cashbackByRest.get(rid)?.balance ?? "0.00",
      giftCardBalance: giftsByRest.get(rid) ?? 0,
      visits: v?.count ?? 0,
      visitSpend: v?.spend ?? "0",
      lastVisitAt: v?.lastAt ?? null,
      stampCards: stampsByRest.get(rid) ?? 0,
      rewardsAvailable: mysteryByRest.get(rid) ?? 0,
    };
  });

  const totals = perRestaurant.reduce((acc, r) => {
    acc.points += r.points;
    acc.cashback = (Number(acc.cashback) + Number(r.cashback)).toFixed(2);
    acc.giftCardBalance += r.giftCardBalance;
    acc.visits += r.visits;
    acc.stampsActive += r.stampCards;
    acc.rewardsAvailable += r.rewardsAvailable;
    return acc;
  }, { points: 0, cashback: "0.00", giftCardBalance: 0, visits: 0, stampsActive: 0, rewardsAvailable: 0 });

  res.json({ totals, perRestaurant });
});

router.get("/wallet/restaurants/:rid", requireCustomer, async (req, res) => {
  const uid = req.customerUser!.sub;
  const restaurantId = Number(req.params.rid);
  const links = await getLinkedCustomerIds(uid);
  const link = links.find(l => l.restaurantId === restaurantId);
  if (!link) return void res.status(404).json({ error: "No record at this restaurant" });

  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  const member = (await loadMembers([restaurantId])).get(restaurantId);
  const [points] = await db.select().from(loyaltyPointsTable)
    .where(and(eq(loyaltyPointsTable.customerId, link.customerId), eq(loyaltyPointsTable.restaurantId, restaurantId)));
  const [cashbackWallet] = await db.select().from(loyaltyCashbackWalletsTable)
    .where(and(eq(loyaltyCashbackWalletsTable.customerId, link.customerId), eq(loyaltyCashbackWalletsTable.restaurantId, restaurantId)));
  const cashbackTxns = await db.select().from(loyaltyCashbackTxnsTable)
    .where(and(eq(loyaltyCashbackTxnsTable.customerId, link.customerId), eq(loyaltyCashbackTxnsTable.restaurantId, restaurantId)))
    .orderBy(desc(loyaltyCashbackTxnsTable.id)).limit(25);
  const pointsTxns = await db.select().from(loyaltyTransactionsTable)
    .where(and(eq(loyaltyTransactionsTable.customerId, link.customerId), eq(loyaltyTransactionsTable.restaurantId, restaurantId)))
    .orderBy(desc(loyaltyTransactionsTable.id)).limit(25);
  const stamps = await db.select().from(loyaltyStampCardsTable)
    .where(and(eq(loyaltyStampCardsTable.customerId, link.customerId), eq(loyaltyStampCardsTable.restaurantId, restaurantId)));
  const mystery = await db.select().from(loyaltyMysteryGrantsTable)
    .where(and(eq(loyaltyMysteryGrantsTable.customerId, link.customerId), eq(loyaltyMysteryGrantsTable.restaurantId, restaurantId)))
    .orderBy(desc(loyaltyMysteryGrantsTable.id)).limit(20);
  const gifts = await db.select().from(giftCardsTable)
    .where(and(eq(giftCardsTable.recipientCustomerId, link.customerId), eq(giftCardsTable.status, "active")));

  res.json({
    restaurant: restaurant ? {
      id: restaurant.id, name: restaurant.name, city: restaurant.city,
      logoUrl: restaurant.logoUrl, currency: restaurant.currency,
    } : null,
    networkMember: member ?? null,
    points: points ?? { balance: 0, lifetimeEarned: 0, lifetimeRedeemed: 0 },
    cashback: cashbackWallet ?? { balance: "0.00", lifetimeIssued: "0.00", lifetimeRedeemed: "0.00" },
    cashbackTxns,
    pointsTxns,
    stamps,
    mystery,
    giftCards: gifts.map(g => ({
      id: g.id, code: g.code.slice(0, 4) + "•••" + g.code.slice(-4),
      initialAmount: g.initialAmount, currency: g.currency, status: g.status,
      expiresAt: g.expiresAt,
    })),
  });
});

router.get("/wallet/visits", requireCustomer, async (req, res) => {
  const uid = req.customerUser!.sub;
  const links = await getLinkedCustomerIds(uid);
  if (links.length === 0) return void res.json([]);
  const restaurantIds = [...new Set(links.map(l => l.restaurantId))];

  // Best-effort: join orders to customers by phone since orders table has no
  // direct customer FK in this schema.
  const rows = await db.select({
    id: ordersTable.id,
    orderNumber: ordersTable.orderNumber,
    restaurantId: ordersTable.restaurantId,
    totalAmount: ordersTable.totalAmount,
    paymentStatus: ordersTable.paymentStatus,
    createdAt: ordersTable.createdAt,
    restaurantName: restaurantsTable.name,
    restaurantCurrency: restaurantsTable.currency,
    restaurantLogo: restaurantsTable.logoUrl,
  })
    .from(ordersTable)
    .innerJoin(customersTable, and(
      eq(customersTable.restaurantId, ordersTable.restaurantId),
      sql`${customersTable.phone} = (SELECT phone FROM customer_users WHERE id = ${uid})`,
    ))
    .innerJoin(restaurantsTable, eq(restaurantsTable.id, ordersTable.restaurantId))
    .where(inArray(ordersTable.restaurantId, restaurantIds))
    .orderBy(desc(ordersTable.createdAt))
    .limit(50);
  res.json(rows);
});

router.get("/wallet/rewards", requireCustomer, async (req, res) => {
  const uid = req.customerUser!.sub;
  const links = await getLinkedCustomerIds(uid);
  if (links.length === 0) return void res.json({ available: [], stampCards: [] });
  const customerIds = links.map(l => l.customerId);
  const restaurantIds = [...new Set(links.map(l => l.restaurantId))];

  const [mystery, stamps, restaurants] = await Promise.all([
    db.select().from(loyaltyMysteryGrantsTable).where(and(
      inArray(loyaltyMysteryGrantsTable.customerId, customerIds),
      inArray(loyaltyMysteryGrantsTable.status, ["granted", "revealed"]),
    )).orderBy(desc(loyaltyMysteryGrantsTable.id)).limit(50),
    db.select().from(loyaltyStampCardsTable).where(inArray(loyaltyStampCardsTable.customerId, customerIds)),
    db.select({ id: restaurantsTable.id, name: restaurantsTable.name, logoUrl: restaurantsTable.logoUrl, currency: restaurantsTable.currency })
      .from(restaurantsTable).where(inArray(restaurantsTable.id, restaurantIds)),
  ]);
  const restMap = new Map(restaurants.map(r => [r.id, r]));

  res.json({
    available: mystery.map(m => ({
      id: m.id,
      restaurantId: m.restaurantId,
      restaurantName: restMap.get(m.restaurantId)?.name ?? "Restaurant",
      rewardKey: m.rewardKey,
      rewardLabel: m.rewardLabel,
      status: m.status,
      expiresAt: m.expiresAt,
      createdAt: m.createdAt,
    })),
    stampCards: stamps.map(s => ({
      id: s.id,
      restaurantId: s.restaurantId,
      restaurantName: restMap.get(s.restaurantId)?.name ?? "Restaurant",
      cardKey: s.cardKey,
      stamps: s.stamps,
      completions: s.completions,
      lastStampedAt: s.lastStampedAt,
    })),
  });
});

/**
 * Cross-restaurant cashback redeem placeholder.
 * Customer asks to "spend" cashback they earned at restaurant A while at
 * restaurant B. We don't actually move money — we debit the source wallet
 * and record a ledger row that B can later settle with A out-of-band.
 */
router.post("/wallet/redeem", requireCustomer, async (req, res) => {
  const uid = req.customerUser!.sub;
  const b = req.body as { fromRestaurantId: number; toRestaurantId: number; amount: number | string; reference?: string };
  const fromR = Number(b.fromRestaurantId);
  const toR = Number(b.toRestaurantId);
  const amount = Number(b.amount);
  if (!fromR || !toR || fromR === toR) return void res.status(400).json({ error: "fromRestaurantId and toRestaurantId must differ" });
  if (!(amount > 0)) return void res.status(400).json({ error: "amount must be > 0" });

  const links = await getLinkedCustomerIds(uid);
  const fromLink = links.find(l => l.restaurantId === fromR);
  if (!fromLink) return void res.status(400).json({ error: "You don't have a wallet at the source restaurant" });

  const members = await loadMembers([fromR, toR]);
  const fromMember = members.get(fromR);
  const toMember = members.get(toR);
  if (!fromMember || fromMember.status !== "active" || !fromMember.allowCrossRedeem) {
    return void res.status(400).json({ error: "Source restaurant doesn't allow cross-redeem" });
  }
  if (!toMember || toMember.status !== "active") {
    return void res.status(400).json({ error: "Destination restaurant is not in the network" });
  }

  // Debit source cashback wallet.
  const [wallet] = await db.select().from(loyaltyCashbackWalletsTable)
    .where(and(eq(loyaltyCashbackWalletsTable.customerId, fromLink.customerId), eq(loyaltyCashbackWalletsTable.restaurantId, fromR)));
  const bal = Number(wallet?.balance ?? "0");
  if (bal < amount) return void res.status(400).json({ error: `Insufficient cashback (₹${bal.toFixed(2)} available)` });

  const newBal = (bal - amount).toFixed(2);
  const newRedeemed = (Number(wallet!.lifetimeRedeemed) + amount).toFixed(2);
  await db.update(loyaltyCashbackWalletsTable)
    .set({ balance: newBal, lifetimeRedeemed: newRedeemed, updatedAt: new Date() })
    .where(eq(loyaltyCashbackWalletsTable.id, wallet!.id));
  await db.insert(loyaltyCashbackTxnsTable).values({
    restaurantId: fromR,
    customerId: fromLink.customerId,
    amount: (-amount).toFixed(2),
    type: "network_redeem",
    reason: `Cross-redeem at restaurant #${toR}`,
  });

  const [ledger] = await db.insert(loyaltyNetworkLedgerTable).values({
    customerUserId: uid,
    fromRestaurantId: fromR,
    toRestaurantId: toR,
    kind: "cross_redeem",
    amount: amount.toFixed(2),
    currency: "INR",
    reference: b.reference ?? null,
    status: "posted",
    metadata: { initiatedBy: "customer", channel: "wallet_app" },
  }).returning();

  logger.info({ uid, fromR, toR, amount, ledgerId: ledger.id }, "Cross-restaurant cashback redeem");
  res.json({ ok: true, ledger, newSourceBalance: newBal });
});

router.get("/wallet/ledger", requireCustomer, async (req, res) => {
  const uid = req.customerUser!.sub;
  const rows = await db.select({
    entry: loyaltyNetworkLedgerTable,
    fromRestaurant: { id: restaurantsTable.id, name: restaurantsTable.name },
  })
    .from(loyaltyNetworkLedgerTable)
    .leftJoin(restaurantsTable, eq(restaurantsTable.id, loyaltyNetworkLedgerTable.fromRestaurantId))
    .where(eq(loyaltyNetworkLedgerTable.customerUserId, uid))
    .orderBy(desc(loyaltyNetworkLedgerTable.id))
    .limit(50);
  // Second pass for toRestaurant names
  const toIds = [...new Set(rows.map(r => r.entry.toRestaurantId).filter((x): x is number => x != null))];
  const toRows = toIds.length === 0 ? [] : await db.select({ id: restaurantsTable.id, name: restaurantsTable.name })
    .from(restaurantsTable).where(inArray(restaurantsTable.id, toIds));
  const toMap = new Map(toRows.map(t => [t.id, t.name]));
  res.json(rows.map(r => ({
    ...r.entry,
    fromRestaurantName: r.fromRestaurant?.name ?? null,
    toRestaurantName: r.entry.toRestaurantId ? toMap.get(r.entry.toRestaurantId) ?? null : null,
  })));
});

export default router;
