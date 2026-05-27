#!/usr/bin/env node
// Backfill orderInternalNumber + businessDate for pre-existing rows (Task #647).
// Existing orders keep their legacy short orderNumber as the "internal" id so
// audit/payment flows continue to resolve. We also derive business_date from
// created_at using the restaurant's timezone (defaulting to Asia/Kolkata)
// so reports can group by business day without nulls.
// New orders (Task #647) get fresh KL-… internal ids and businessDate at
// insert time via mintOrderNumbers().
import pg from "pg";
const { Client } = pg;
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const r1 = await c.query(`
  UPDATE orders SET order_internal_number = order_number
  WHERE order_internal_number IS NULL
`);
console.log(`Backfilled order_internal_number on ${r1.rowCount} legacy rows.`);

// business_date: convert created_at to the restaurant's local date.
// Restaurants.timezone is optional; fall back to Asia/Kolkata.
const r2 = await c.query(`
  UPDATE orders o
  SET business_date = (o.created_at AT TIME ZONE COALESCE(NULLIF(r.timezone, ''), 'Asia/Kolkata'))::date
  FROM restaurants r
  WHERE o.restaurant_id = r.id AND o.business_date IS NULL
`);
console.log(`Backfilled business_date on ${r2.rowCount} legacy rows.`);

// Mirror legacy orderNumber into orderDisplayNumber when display is null,
// so UI fallback shows *something* instead of "—" for historical orders.
const r3 = await c.query(`
  UPDATE orders SET order_display_number = order_number
  WHERE order_display_number IS NULL
`);
console.log(`Backfilled order_display_number on ${r3.rowCount} legacy rows.`);

await c.end();
