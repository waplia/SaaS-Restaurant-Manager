/**
 * Local SQLite database — single connection, WAL mode, NORMAL sync.
 *
 * Lives at `userData/khanalagao-pos.db` so it survives upgrades and is
 * easy to back up / wipe via the "Reset local data" action.
 */

import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import type DatabaseT from "better-sqlite3";
import { runMigrations } from "./schema";

let db: DatabaseT.Database | null = null;
let dbPath: string | null = null;

export function getDb(): DatabaseT.Database {
  if (db) return db;
  dbPath = path.join(app.getPath("userData"), "khanalagao-pos.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

export function getDbPath(): string {
  if (!dbPath) getDb();
  return dbPath!;
}

/**
 * Close + delete the on-disk DB. Used by the "Reset local data" action and
 * the test/QA flow that clears the cache. Caller must call `getDb()` again
 * to recreate a fresh schema.
 */
export function resetDb(): void {
  if (db) { try { db.close(); } catch { /* ignore */ } db = null; }
  if (dbPath && fs.existsSync(dbPath)) {
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    // Remove WAL sidecars too so the next open starts truly clean.
    for (const suffix of ["-wal", "-shm"]) {
      const p = `${dbPath}${suffix}`;
      if (fs.existsSync(p)) try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
  }
}

export function dbStats(): { sizeBytes: number; path: string } {
  const p = getDbPath();
  try {
    const s = fs.statSync(p);
    return { sizeBytes: s.size, path: p };
  } catch {
    return { sizeBytes: 0, path: p };
  }
}
