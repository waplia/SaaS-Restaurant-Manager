import { sql } from "drizzle-orm";
import { db } from "./db";

/**
 * One-time idempotent backfill for the customer-CRM upgrade.
 *
 * 1. Populates customers.first_order_at and customers.last_visit_at from the
 *    paid orders that already exist (only fills NULL columns so we never clobber
 *    values maintained by the live order flow).
 * 2. Migrates the legacy free-text `customers.notes` column into the structured
 *    `customer_notes` log so the new Notes panel shows pre-existing content.
 *    Only seeds when the customer has no log entries yet.
 */
export async function backfillCustomerCrm(): Promise<{ visitsUpdated: number; notesSeeded: number }> {
  // Only paid orders count as a "visit" — same predicate the live order
  // pipeline uses when stamping firstOrderAt / lastVisitAt.
  const visits = await db.execute(sql`
    UPDATE customers c SET
      first_order_at = COALESCE(c.first_order_at, sub.first_order_at),
      last_visit_at  = COALESCE(c.last_visit_at,  sub.last_visit_at)
    FROM (
      SELECT customer_id,
             MIN(created_at) AS first_order_at,
             MAX(created_at) AS last_visit_at
      FROM orders
      WHERE customer_id IS NOT NULL
        AND payment_status = 'paid'
      GROUP BY customer_id
    ) sub
    WHERE c.id = sub.customer_id
      AND (c.first_order_at IS NULL OR c.last_visit_at IS NULL)
  `);

  const notes = await db.execute(sql`
    INSERT INTO customer_notes (customer_id, restaurant_id, author_user_id, body, created_at, updated_at)
    SELECT c.id, c.restaurant_id, NULL, c.notes, c.created_at, c.created_at
    FROM customers c
    WHERE c.notes IS NOT NULL
      AND length(trim(c.notes)) > 0
      AND NOT EXISTS (
        SELECT 1 FROM customer_notes n WHERE n.customer_id = c.id
      )
  `);

  return {
    visitsUpdated: (visits as { rowCount?: number }).rowCount ?? 0,
    notesSeeded: (notes as { rowCount?: number }).rowCount ?? 0,
  };
}
