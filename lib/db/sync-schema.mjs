#!/usr/bin/env -S node --import tsx/esm
import { Pool } from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "./src/schema/index.ts";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function sqlTypeOf(col) {
  const t = col.getSQLType ? col.getSQLType() : col.columnType;
  return t;
}

function defaultClause(col) {
  if (col.default === undefined || col.default === null) {
    if (col.hasDefault && col.defaultFn) return null;
    return null;
  }
  const d = col.default;
  if (typeof d === "object" && d?.queryChunks) {
    return null;
  }
  if (d && typeof d === "object" && "now" in d) return "now()";
  if (typeof d === "string") return `'${d.replace(/'/g, "''")}'`;
  if (typeof d === "number" || typeof d === "boolean") return String(d);
  if (typeof d === "object") return `'${JSON.stringify(d).replace(/'/g, "''")}'::jsonb`;
  return null;
}

function colDef(col) {
  let type = sqlTypeOf(col);
  if (col.columnType === "PgSerial") type = "serial";
  if (col.columnType === "PgBigSerial53" || col.columnType === "PgBigSerial64") type = "bigserial";
  let s = `"${col.name}" ${type}`;
  if (col.primary) s += " PRIMARY KEY";
  if (col.notNull && !col.primary) s += " NOT NULL";
  const d = defaultClause(col);
  if (d !== null) s += ` DEFAULT ${d}`;
  return s;
}

async function main() {
  const expected = {};
  for (const v of Object.values(schema)) {
    try {
      if (!v || typeof v !== "object") continue;
      if (!v[Symbol.for("drizzle:Name")] && !v._?.name) {
        // try getTableConfig
      }
      const cfg = getTableConfig(v);
      expected[cfg.name] = cfg;
    } catch {}
  }
  const tables = Object.keys(expected);
  console.log(`Expected ${tables.length} tables from schema.`);

  const { rows: actualTableRows } = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`
  );
  const actualTables = new Set(actualTableRows.map(r => r.table_name));

  const { rows: colRows } = await pool.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`
  );
  const actualCols = {};
  for (const r of colRows) {
    (actualCols[r.table_name] ||= new Set()).add(r.column_name);
  }

  const ddl = [];
  let createdTables = 0, addedCols = 0;

  // Create missing tables (without FKs first to avoid order issues)
  for (const [tname, cfg] of Object.entries(expected)) {
    if (actualTables.has(tname)) continue;
    const cols = cfg.columns.map(colDef).join(",\n  ");
    ddl.push(`CREATE TABLE IF NOT EXISTS "${tname}" (\n  ${cols}\n);`);
    createdTables++;
  }

  // Add missing columns on existing tables
  for (const [tname, cfg] of Object.entries(expected)) {
    if (!actualTables.has(tname)) continue;
    const existing = actualCols[tname] || new Set();
    for (const col of cfg.columns) {
      if (existing.has(col.name)) continue;
      // Skip primary serials added later — too risky
      const def = colDef(col).replace(/ PRIMARY KEY/, "");
      // For NOT NULL without default on existing tables, drop NOT NULL to avoid failure on populated tables
      let safe = def;
      if (/ NOT NULL/.test(safe) && !/ DEFAULT /.test(safe)) {
        safe = safe.replace(" NOT NULL", "");
      }
      ddl.push(`ALTER TABLE "${tname}" ADD COLUMN IF NOT EXISTS ${safe};`);
      addedCols++;
    }
  }

  console.log(`Plan: create ${createdTables} tables, add ${addedCols} columns.`);

  // Apply each statement individually, ignoring already-exists errors
  let ok = 0, fail = 0;
  for (const stmt of ddl) {
    try {
      await pool.query(stmt);
      ok++;
    } catch (e) {
      fail++;
      console.error("FAIL:", stmt.slice(0, 120).replace(/\n/g, " "), "->", e.message);
    }
  }
  console.log(`Applied: ${ok} ok, ${fail} failed.`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
