import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  customersTable,
  customerUsersTable,
  customerUserLinksTable,
} from "./db";

/**
 * Strip a phone string down to the canonical wallet form: digits with at most
 * a leading "+". This MUST match `normalizePhone` in `customerAuth.ts` so that
 * an order placed in any format will line up with a wallet account created
 * via OTP.
 */
function canonicalPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d+]/g, "");
  if (cleaned.length < 7) return null;
  return cleaned;
}

/**
 * Ensure there's a `customers` row for this (restaurant, phone). If one is
 * missing, create it from the order's name+phone. Then, if a wallet
 * `customer_users` account exists with the same canonical phone, ensure the
 * `customer_user_links` row exists so the wallet sees this restaurant in
 * "Your restaurants" and the order shows up in Visits.
 *
 * Safe to call on every order create — both the customers lookup and the
 * link insert short-circuit / use `onConflictDoNothing` so we don't duplicate.
 *
 * Returns the resolved `customerId` (existing or newly created) or `null`
 * when no phone was provided.
 */
export async function ensureCustomerAndWalletLink(args: {
  restaurantId: number;
  name?: string | null;
  rawPhone?: string | null;
  /** Caller's existing match (skip the lookup). */
  existingCustomerId?: number | null;
}): Promise<number | null> {
  const { restaurantId } = args;
  const canonical = canonicalPhone(args.rawPhone);
  if (!canonical) return args.existingCustomerId ?? null;

  let customerId: number | null = args.existingCustomerId ?? null;

  if (customerId == null) {
    // Tolerant match: canonical + raw (covers legacy rows saved before
    // normalization was added to the order routes).
    const candidates = Array.from(new Set([
      canonical,
      String(args.rawPhone ?? "").trim(),
    ].filter(Boolean)));
    const [existing] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(and(
        inArray(customersTable.phone, candidates),
        eq(customersTable.restaurantId, restaurantId),
      ));
    if (existing) {
      customerId = existing.id;
    } else {
      const safeName = (args.name ?? "").trim().slice(0, 100) || "Guest";
      try {
        const [created] = await db.insert(customersTable).values({
          restaurantId,
          name: safeName,
          phone: canonical,
        }).returning({ id: customersTable.id });
        customerId = created?.id ?? null;
      } catch (err) {
        // Race / unique index — re-query and use whatever exists now.
        const [retry] = await db
          .select({ id: customersTable.id })
          .from(customersTable)
          .where(and(
            eq(customersTable.phone, canonical),
            eq(customersTable.restaurantId, restaurantId),
          ));
        customerId = retry?.id ?? null;
        if (customerId == null) throw err;
      }
    }
  }

  // Link to wallet account if one exists for this phone.
  const [walletUser] = await db
    .select({ id: customerUsersTable.id })
    .from(customerUsersTable)
    .where(eq(customerUsersTable.phone, canonical));
  if (walletUser && customerId != null) {
    await db.insert(customerUserLinksTable).values({
      customerUserId: walletUser.id,
      customerId,
      restaurantId,
    }).onConflictDoNothing();
  }

  return customerId;
}

export { canonicalPhone };
