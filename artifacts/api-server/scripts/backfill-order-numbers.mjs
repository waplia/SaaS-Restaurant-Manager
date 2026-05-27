#!/usr/bin/env node
// Backfill orderInternalNumber for pre-existing rows (Task #647).
// Existing orders keep their legacy short orderNumber as the "internal" id
// so audit/payment flows continue to resolve. New orders (Task #647) get
// fresh KL-… internal ids at insert time.
import pg from "pg";
const { Client } = pg;
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(`UPDATE orders SET order_internal_number = order_number WHERE order_internal_number IS NULL`);
console.log(`Backfilled order_internal_number on ${r.rowCount} legacy rows.`);
await c.end();
