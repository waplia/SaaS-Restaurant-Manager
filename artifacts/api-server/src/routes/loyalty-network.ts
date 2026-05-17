/**
 * Restaurant-admin routes for the cross-restaurant Loyalty Network:
 *   GET    /restaurants/:rid/loyalty-network          — settings + status
 *   PUT    /restaurants/:rid/loyalty-network          — opt in / update rules
 *   POST   /restaurants/:rid/loyalty-network/opt-out  — leave the network
 *   GET    /restaurants/:rid/loyalty-network/analytics — counts + ledger summary
 *   GET    /restaurants/:rid/loyalty-network/ledger    — ledger entries (incoming + outgoing)
 *   GET    /restaurants/:rid/loyalty-network/directory — other network members
 */
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  loyaltyNetworkMembersTable,
  loyaltyNetworkLedgerTable,
  restaurantsTable,
  customerUsersTable,
  customerUserLinksTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { recordAuditLog } from "../lib/audit";

const router: IRouter = Router();

router.use(
  "/restaurants/:restaurantId/loyalty-network",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("loyalty_network"),
);

router.get("/restaurants/:restaurantId/loyalty-network", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [member] = await db.select().from(loyaltyNetworkMembersTable)
    .where(eq(loyaltyNetworkMembersTable.restaurantId, restaurantId));
  res.json({ member: member ?? null });
});

router.put("/restaurants/:restaurantId/loyalty-network", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const b = req.body as {
    displayName?: string | null;
    blurb?: string | null;
    allowCrossEarn?: boolean;
    allowCrossRedeem?: boolean;
    crossRedeemMaxPct?: number;
    crossRedeemMinOrder?: number | string;
    status?: "active" | "paused";
  };

  const [existing] = await db.select().from(loyaltyNetworkMembersTable)
    .where(eq(loyaltyNetworkMembersTable.restaurantId, restaurantId));

  const values = {
    displayName: b.displayName ?? null,
    blurb: b.blurb ?? null,
    allowCrossEarn: b.allowCrossEarn ?? true,
    allowCrossRedeem: b.allowCrossRedeem ?? true,
    crossRedeemMaxPct: typeof b.crossRedeemMaxPct === "number"
      ? Math.max(0, Math.min(100, Math.round(b.crossRedeemMaxPct))) : 50,
    crossRedeemMinOrder: b.crossRedeemMinOrder != null ? String(b.crossRedeemMinOrder) : "0.00",
    status: b.status ?? "active",
    updatedAt: new Date(),
    optedOutAt: null as Date | null,
  };

  let row;
  if (existing) {
    [row] = await db.update(loyaltyNetworkMembersTable).set(values)
      .where(eq(loyaltyNetworkMembersTable.id, existing.id)).returning();
  } else {
    [row] = await db.insert(loyaltyNetworkMembersTable).values({
      restaurantId,
      ...values,
      optedInAt: new Date(),
    }).returning();
  }

  await recordAuditLog({
    req, module: "loyalty_network", action: existing ? "network.updated" : "network.opted_in",
    entity: "loyalty_network_member", entityId: row.id,
    restaurantId, targetRestaurantId: restaurantId,
    oldValue: existing ?? null, newValue: row,
  });
  res.json({ member: row });
});

router.post("/restaurants/:restaurantId/loyalty-network/opt-out", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [existing] = await db.select().from(loyaltyNetworkMembersTable)
    .where(eq(loyaltyNetworkMembersTable.restaurantId, restaurantId));
  if (!existing) return void res.json({ ok: true });
  const [row] = await db.update(loyaltyNetworkMembersTable)
    .set({ status: "paused", optedOutAt: new Date(), updatedAt: new Date() })
    .where(eq(loyaltyNetworkMembersTable.id, existing.id)).returning();
  await recordAuditLog({
    req, module: "loyalty_network", action: "network.opted_out",
    entity: "loyalty_network_member", entityId: row.id,
    restaurantId, targetRestaurantId: restaurantId,
    oldValue: existing, newValue: row,
  });
  res.json({ ok: true, member: row });
});

router.get("/restaurants/:restaurantId/loyalty-network/analytics", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);

  // Customers linked to this restaurant who have a global customer_users id
  // (proxy: wallet adoption).
  const [walletAdoption] = await db.select({ c: sql<number>`COUNT(DISTINCT ${customerUserLinksTable.customerUserId})::int` })
    .from(customerUserLinksTable)
    .where(eq(customerUserLinksTable.restaurantId, restaurantId));

  const [incoming] = await db.select({
    count: sql<number>`COUNT(*)::int`,
    amount: sql<string>`COALESCE(SUM(${loyaltyNetworkLedgerTable.amount}), 0)::text`,
  }).from(loyaltyNetworkLedgerTable)
    .where(and(
      eq(loyaltyNetworkLedgerTable.toRestaurantId, restaurantId),
      eq(loyaltyNetworkLedgerTable.kind, "cross_redeem"),
    ));

  const [outgoing] = await db.select({
    count: sql<number>`COUNT(*)::int`,
    amount: sql<string>`COALESCE(SUM(${loyaltyNetworkLedgerTable.amount}), 0)::text`,
  }).from(loyaltyNetworkLedgerTable)
    .where(and(
      eq(loyaltyNetworkLedgerTable.fromRestaurantId, restaurantId),
      eq(loyaltyNetworkLedgerTable.kind, "cross_redeem"),
    ));

  const [networkSize] = await db.select({ c: sql<number>`COUNT(*)::int` })
    .from(loyaltyNetworkMembersTable)
    .where(eq(loyaltyNetworkMembersTable.status, "active"));

  res.json({
    walletAdoption: walletAdoption?.c ?? 0,
    incoming: { count: incoming?.count ?? 0, amount: incoming?.amount ?? "0" },
    outgoing: { count: outgoing?.count ?? 0, amount: outgoing?.amount ?? "0" },
    networkSize: networkSize?.c ?? 0,
  });
});

router.get("/restaurants/:restaurantId/loyalty-network/ledger", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select({
    entry: loyaltyNetworkLedgerTable,
    customerUser: { id: customerUsersTable.id, phone: customerUsersTable.phone, name: customerUsersTable.name },
  })
    .from(loyaltyNetworkLedgerTable)
    .leftJoin(customerUsersTable, eq(customerUsersTable.id, loyaltyNetworkLedgerTable.customerUserId))
    .where(or(
      eq(loyaltyNetworkLedgerTable.fromRestaurantId, restaurantId),
      eq(loyaltyNetworkLedgerTable.toRestaurantId, restaurantId),
    ))
    .orderBy(desc(loyaltyNetworkLedgerTable.id))
    .limit(100);

  const otherIds = [...new Set(rows.flatMap(r => [r.entry.fromRestaurantId, r.entry.toRestaurantId])
    .filter((x): x is number => x != null && x !== restaurantId))];
  const others = otherIds.length === 0 ? [] : await db.select({ id: restaurantsTable.id, name: restaurantsTable.name })
    .from(restaurantsTable).where(inArray(restaurantsTable.id, otherIds));
  const otherMap = new Map(others.map(o => [o.id, o.name]));

  res.json(rows.map(r => ({
    ...r.entry,
    direction: r.entry.toRestaurantId === restaurantId ? "incoming" : "outgoing",
    counterpartyId: r.entry.toRestaurantId === restaurantId ? r.entry.fromRestaurantId : r.entry.toRestaurantId,
    counterpartyName: r.entry.toRestaurantId === restaurantId
      ? (r.entry.fromRestaurantId ? otherMap.get(r.entry.fromRestaurantId) ?? null : null)
      : (r.entry.toRestaurantId ? otherMap.get(r.entry.toRestaurantId) ?? null : null),
    customerPhone: r.customerUser?.phone ? `***${r.customerUser.phone.slice(-4)}` : null,
    customerName: r.customerUser?.name ?? null,
  })));
});

router.get("/restaurants/:restaurantId/loyalty-network/directory", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select({
    member: loyaltyNetworkMembersTable,
    restaurant: {
      id: restaurantsTable.id, name: restaurantsTable.name,
      city: restaurantsTable.city, logoUrl: restaurantsTable.logoUrl,
    },
  })
    .from(loyaltyNetworkMembersTable)
    .innerJoin(restaurantsTable, eq(restaurantsTable.id, loyaltyNetworkMembersTable.restaurantId))
    .where(eq(loyaltyNetworkMembersTable.status, "active"));
  res.json(rows
    .filter(r => r.restaurant.id !== restaurantId)
    .map(r => ({
      restaurantId: r.restaurant.id,
      name: r.member.displayName ?? r.restaurant.name,
      city: r.restaurant.city,
      logoUrl: r.restaurant.logoUrl,
      blurb: r.member.blurb,
      allowCrossEarn: r.member.allowCrossEarn,
      allowCrossRedeem: r.member.allowCrossRedeem,
      crossRedeemMaxPct: r.member.crossRedeemMaxPct,
    })));
});

export default router;
