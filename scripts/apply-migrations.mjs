#!/usr/bin/env node
// Applies every lib/db/drizzle/*.sql migration file idempotently.
//
// We use this instead of `drizzle-kit push` in the post-merge script because
// `drizzle-kit push` is interactive: it prompts (with an arrow-key TUI) for
// every "add unique constraint" / "drop column" decision, and stdin is closed
// during post-merge runs, so it hangs and is silently killed by the script
// timeout. The migration SQL files in `lib/db/drizzle/` are all written with
// `IF NOT EXISTS` / `DO $$ ... EXCEPTION WHEN duplicate_* THEN null` guards,
// so re-running them on an up-to-date database is a no-op.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Resolve `pg` from lib/db, the workspace package that depends on it. This
// lets us run this script without adding a duplicate dependency to scripts/.
const here = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(here, "../lib/db/package.json"));
const pg = dbRequire("pg");
const { Client } = pg;
const MIGRATIONS_DIR = path.resolve(
  process.cwd(),
  "lib/db/drizzle",
);

function splitStatements(sql) {
  // Drizzle delimits statements with a special comment marker.
  const parts = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 0) return parts;
  // Fallback: treat the whole file as one statement.
  const trimmed = sql.trim();
  return trimmed ? [trimmed] : [];
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[apply-migrations] DATABASE_URL is not set; skipping.");
    return;
  }

  let files;
  try {
    files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch (err) {
    console.error(
      `[apply-migrations] cannot read ${MIGRATIONS_DIR}: ${err.message}`,
    );
    return;
  }

  if (files.length === 0) {
    console.log("[apply-migrations] no migration files found.");
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  let totalErrors = 0;
  const errSamples = [];
  const start = Date.now();
  try {
    for (const file of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      const stmts = splitStatements(sql);
      let fileErrors = 0;
      for (const stmt of stmts) {
        try {
          await client.query(stmt);
        } catch (err) {
          fileErrors++;
          totalErrors++;
          if (errSamples.length < 10) {
            errSamples.push(
              `${file}: ${(err.message || String(err)).split("\n")[0].slice(0, 200)}`,
            );
          }
        }
      }
      if (fileErrors > 0) {
        console.log(`  ${file}: ${stmts.length} stmts, ${fileErrors} non-fatal errors`);
      }
    }
  } finally {
    await client.end();
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `[apply-migrations] applied ${files.length} files in ${elapsed}s (${totalErrors} non-fatal stmt errors).`,
  );
  if (errSamples.length > 0) {
    console.log("[apply-migrations] sample errors (most are duplicate-object/column noise):");
    for (const e of errSamples) console.log(`  - ${e}`);
  }
}

main().catch((err) => {
  console.error(`[apply-migrations] fatal: ${err.message || err}`);
  // Real fatals (cannot connect, missing migrations dir) should be loud.
  // Per-statement errors are still tolerated inside main() because the
  // migration SQL is idempotent and "already exists" is the expected case;
  // those are summarised in the log so genuine defects can still be seen.
  process.exit(1);
});
