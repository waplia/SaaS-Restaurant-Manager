import { eq, and } from "drizzle-orm";
import { db, loyaltyReferralCodesTable, loyaltyReferralsTable, customersTable } from "../db";

function randomCode(prefix = "RF"): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return prefix + s;
}

export async function ensureReferralCode(restaurantId: number, customerId: number): Promise<string> {
  const [existing] = await db.select().from(loyaltyReferralCodesTable).where(and(
    eq(loyaltyReferralCodesTable.restaurantId, restaurantId),
    eq(loyaltyReferralCodesTable.customerId, customerId),
  ));
  if (existing) return existing.code;
  for (let i = 0; i < 5; i++) {
    const code = randomCode();
    try {
      const [row] = await db.insert(loyaltyReferralCodesTable).values({
        restaurantId, customerId, code,
      }).returning();
      return row.code;
    } catch {
      continue;
    }
  }
  throw new Error("Could not allocate referral code");
}

export async function attachReferralByCode(args: {
  restaurantId: number; refereeId: number; code: string;
}): Promise<{ ok: boolean; referrerId?: number; reason?: string }> {
  const [codeRow] = await db.select().from(loyaltyReferralCodesTable).where(and(
    eq(loyaltyReferralCodesTable.restaurantId, args.restaurantId),
    eq(loyaltyReferralCodesTable.code, args.code.toUpperCase()),
  ));
  if (!codeRow) return { ok: false, reason: "invalid_code" };
  if (codeRow.customerId === args.refereeId) return { ok: false, reason: "self_referral" };

  const [existing] = await db.select().from(loyaltyReferralsTable).where(and(
    eq(loyaltyReferralsTable.restaurantId, args.restaurantId),
    eq(loyaltyReferralsTable.refereeId, args.refereeId),
  ));
  if (existing) return { ok: false, reason: "already_attributed" };

  await db.insert(loyaltyReferralsTable).values({
    restaurantId: args.restaurantId,
    referrerId: codeRow.customerId, refereeId: args.refereeId,
    code: codeRow.code, status: "pending",
  });
  return { ok: true, referrerId: codeRow.customerId };
}

export async function getPendingReferralForReferee(restaurantId: number, refereeId: number) {
  const [row] = await db.select().from(loyaltyReferralsTable).where(and(
    eq(loyaltyReferralsTable.restaurantId, restaurantId),
    eq(loyaltyReferralsTable.refereeId, refereeId),
    eq(loyaltyReferralsTable.status, "pending"),
  ));
  return row ?? null;
}

export async function markReferralConverted(id: number, summary: Record<string, unknown>) {
  await db.update(loyaltyReferralsTable).set({
    status: "converted", convertedAt: new Date(), rewardSummary: summary,
  }).where(eq(loyaltyReferralsTable.id, id));
}

export async function listReferralsForReferrer(restaurantId: number, referrerId: number) {
  return db.select().from(loyaltyReferralsTable).where(and(
    eq(loyaltyReferralsTable.restaurantId, restaurantId),
    eq(loyaltyReferralsTable.referrerId, referrerId),
  ));
}

export async function referralLeaderboard(restaurantId: number, limit = 20) {
  // Aggregated count; we keep it simple to avoid a heavy SQL view.
  const rows = await db.select({
    referrerId: loyaltyReferralsTable.referrerId,
    status: loyaltyReferralsTable.status,
  }).from(loyaltyReferralsTable).where(eq(loyaltyReferralsTable.restaurantId, restaurantId));
  const map = new Map<number, { referrals: number; converted: number }>();
  for (const r of rows) {
    const cur = map.get(r.referrerId) ?? { referrals: 0, converted: 0 };
    cur.referrals++;
    if (r.status === "converted") cur.converted++;
    map.set(r.referrerId, cur);
  }
  const referrerIds = Array.from(map.keys());
  if (referrerIds.length === 0) return [];
  const customers = await db.select({ id: customersTable.id, name: customersTable.name, phone: customersTable.phone })
    .from(customersTable);
  const cmap = new Map(customers.map(c => [c.id, c]));
  const out = referrerIds.map(id => ({
    customerId: id,
    name: cmap.get(id)?.name ?? `#${id}`,
    phone: cmap.get(id)?.phone ?? null,
    referrals: map.get(id)!.referrals,
    converted: map.get(id)!.converted,
  })).sort((a, b) => b.converted - a.converted || b.referrals - a.referrals).slice(0, limit);
  return out;
}
