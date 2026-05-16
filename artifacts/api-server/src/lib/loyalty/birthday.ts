import { eq, and } from "drizzle-orm";
import { db, loyaltyBirthdayGrantsTable } from "../db";

export function isBirthdayWithinWindow(birthdayISO: string | null, windowDays: number, now = new Date()): boolean {
  if (!birthdayISO) return false;
  const bd = new Date(birthdayISO);
  if (Number.isNaN(bd.getTime())) return false;
  const thisYearBd = new Date(now.getFullYear(), bd.getMonth(), bd.getDate());
  const nextYearBd = new Date(now.getFullYear() + 1, bd.getMonth(), bd.getDate());
  const candidate = thisYearBd.getTime() < now.getTime() - 86400_000 * windowDays ? nextYearBd : thisYearBd;
  const diffDays = Math.abs((candidate.getTime() - now.getTime()) / 86400_000);
  return diffDays <= windowDays;
}

export async function hasBirthdayGrantThisYear(restaurantId: number, customerId: number, year: number): Promise<boolean> {
  const [row] = await db.select().from(loyaltyBirthdayGrantsTable).where(and(
    eq(loyaltyBirthdayGrantsTable.restaurantId, restaurantId),
    eq(loyaltyBirthdayGrantsTable.customerId, customerId),
    eq(loyaltyBirthdayGrantsTable.yearKey, String(year)),
  ));
  return !!row;
}

export async function recordBirthdayGrant(restaurantId: number, customerId: number, year: number, summary: Record<string, unknown>) {
  await db.insert(loyaltyBirthdayGrantsTable).values({
    restaurantId, customerId, yearKey: String(year), rewardSummary: summary,
  }).onConflictDoNothing();
}
