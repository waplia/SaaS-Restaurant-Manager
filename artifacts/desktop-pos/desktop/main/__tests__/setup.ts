/**
 * Vitest setup — replaces the electron-backed SQLite handle with an
 * in-memory better-sqlite3 instance so the offline / sync suites can run in
 * CI without the native Electron rebuild.
 *
 * Every test gets a fresh schema via `resetTestDb()` in `beforeEach`.
 */

import { vi, beforeEach, afterAll } from "vitest";
import Database from "better-sqlite3";
import type DatabaseT from "better-sqlite3";
import { runMigrations } from "../db/schema";

let memDb: DatabaseT.Database | null = null;

function open(): DatabaseT.Database {
  if (memDb) return memDb;
  memDb = new Database(":memory:");
  memDb.pragma("foreign_keys = ON");
  runMigrations(memDb);
  return memDb;
}

export function resetTestDb(): void {
  if (memDb) { try { memDb.close(); } catch { /* ignore */ } memDb = null; }
  open();
}

export function getTestDb(): DatabaseT.Database {
  return open();
}

// Stub out electron + electron-store so importing the API client / session
// store doesn't fail with "Electron failed to install correctly". These
// modules aren't exercised by the offline / sync suites.
vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/khanalagao-pos-test" },
  ipcMain: { handle: () => undefined, on: () => undefined, removeHandler: () => undefined },
  BrowserWindow: class {},
}));

vi.mock("electron-store", () => ({
  default: class {
    private store = new Map<string, unknown>();
    get(k: string): unknown { return this.store.get(k); }
    set(k: string, v: unknown): void { this.store.set(k, v); }
    delete(k: string): void { this.store.delete(k); }
    clear(): void { this.store.clear(); }
  },
}));

vi.mock("../session-store", () => ({
  sessionStore: {
    getTokens: () => ({ accessToken: null, refreshToken: null }),
    setTokens: () => undefined,
    clearAll: () => undefined,
  },
}));

vi.mock("../db/index", () => ({
  getDb: () => open(),
  getDbPath: () => ":memory:",
  resetDb: () => resetTestDb(),
  dbStats: () => ({ sizeBytes: 0, path: ":memory:" }),
}));

beforeEach(() => {
  resetTestDb();
});

afterAll(() => {
  if (memDb) { try { memDb.close(); } catch { /* ignore */ } memDb = null; }
});
