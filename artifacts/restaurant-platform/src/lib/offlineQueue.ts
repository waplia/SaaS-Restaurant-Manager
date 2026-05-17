/**
 * Offline-first mutation queue for POS-critical writes (orders, KOTs,
 * payments, table edits, payment notes).
 *
 * Design
 * ──────
 * - Backed by localStorage for durability across reloads. Small payloads
 *   (a single order rarely exceeds a few KB) make this acceptable without
 *   pulling in an IndexedDB dependency. Swappable behind the public API.
 * - Each entry stores the HTTP method, the relative `path`, the JSON
 *   `body`, plus bookkeeping (attempts, lastError, status, conflict info).
 * - A path is queueable only when it matches one of the allowlisted POS
 *   write endpoints. Reports / settings / admin writes still hard-fail
 *   when offline so users see real errors instead of phantom-success.
 * - Status is one of: `pending` (awaiting first send), `syncing`,
 *   `failed` (transient — will retry with backoff), `conflict` (server
 *   rejected with 409 — needs manual resolution), `done` (briefly kept
 *   for the sync screen before pruning).
 * - The engine exposes a tiny pub/sub so React components can subscribe
 *   without polling.
 *
 * Limitations called out for follow-up work
 * ─────────────────────────────────────────
 * - Conflict resolution UI surfaces the conflict but currently only
 *   supports "discard" / "force retry" — a richer 3-way merge is left
 *   to a dedicated task.
 * - Reads (`GET`) are not cached for offline replay. The badge tells
 *   the user reports/lists are unavailable while offline.
 */

const STORAGE_KEY = "tt.pos.offlineQueue.v1";
const LAST_SYNC_KEY = "tt.pos.lastSyncAt";
const OFFLINE_ENTERED_KEY = "tt.pos.offlineEnteredAt";
// Last-known plan capability for `offline_pos`. Persisted locally so a
// cold reload while offline can still enable queueing without waiting
// for /subscription to resolve — the sync engine reconciles once online.
const PLAN_CAP_KEY = "tt.pos.offlineCapEnabled.v1";

export type QueueStatus = "pending" | "syncing" | "failed" | "conflict" | "done";

export interface QueueEntry {
  id: string;
  createdAt: number;
  /** ISO restaurant-scoped path, e.g. `/restaurants/12/orders`. */
  path: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Stable client key — server may use to dedupe replays. */
  idempotencyKey: string;
  /** Free-form bucket so UI can group ("order", "kot", "payment", ...). */
  scope: string;
  /** Human-readable label for the sync screen. */
  label: string;
  attempts: number;
  status: QueueStatus;
  lastError?: string;
  /** Populated when server returns 409: includes any payload it gives back. */
  conflictInfo?: { serverPayload: unknown; at: number };
  /** Filled in after a successful sync so UI can link to the real row. */
  serverResult?: unknown;
  nextAttemptAt?: number;
}

type Listener = (entries: QueueEntry[]) => void;
const listeners = new Set<Listener>();

type ConflictListener = (entry: QueueEntry) => void;
const conflictListeners = new Set<ConflictListener>();

/**
 * Runtime flag flipped by the plan-gated sync engine. When false, no
 * queueing happens at the API layer (so plans without `offline_pos`
 * still see hard failures on bad internet — they're not paying for
 * offline mode). Defaults to false; the engine flips it on after
 * verifying the plan capability.
 */
// Bootstrap from the last-known plan capability so queueing works on a
// cold reload while offline. The sync engine flips this again once the
// live plan capability resolves.
let offlineQueueingEnabled = ((): boolean => {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(PLAN_CAP_KEY) === "1"; } catch { return false; }
})();

export function setOfflineQueueingEnabled(enabled: boolean): void {
  offlineQueueingEnabled = enabled;
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(PLAN_CAP_KEY, enabled ? "1" : "0"); } catch { /* ignore quota */ }
  }
}

export function isOfflineQueueingEnabled(): boolean {
  return offlineQueueingEnabled;
}

export function subscribeConflict(fn: ConflictListener): () => void {
  conflictListeners.add(fn);
  return () => { conflictListeners.delete(fn); };
}

function notifyConflict(entry: QueueEntry): void {
  for (const l of conflictListeners) {
    try { l(entry); } catch { /* best-effort */ }
  }
}

/** Restaurant-scoped POS write endpoints we are willing to queue offline. */
const QUEUEABLE_PATTERNS: Array<{ re: RegExp; scope: string; label: (m: RegExpMatchArray, body: unknown) => string }> = [
  { re: /^\/restaurants\/\d+\/orders$/,                              scope: "order",   label: () => "Create order" },
  { re: /^\/restaurants\/\d+\/orders\/\d+$/,                          scope: "order",   label: m => `Edit order #${m[0].split("/").pop()}` },
  { re: /^\/restaurants\/\d+\/orders\/\d+\/items$/,                   scope: "order",   label: m => `Add item to order #${m[0].match(/orders\/(\d+)/)?.[1] ?? "?"}` },
  { re: /^\/restaurants\/\d+\/orders\/\d+\/items\/\d+$/,              scope: "order",   label: m => `Remove item from order #${m[0].match(/orders\/(\d+)/)?.[1] ?? "?"}` },
  { re: /^\/restaurants\/\d+\/orders\/\d+\/pay$/,                     scope: "payment", label: m => `Settle payment for order #${m[0].match(/orders\/(\d+)/)?.[1] ?? "?"}` },
  { re: /^\/restaurants\/\d+\/orders\/\d+\/split$/,                   scope: "payment", label: m => `Split payment for order #${m[0].match(/orders\/(\d+)/)?.[1] ?? "?"}` },
  { re: /^\/restaurants\/\d+\/orders\/\d+\/notes$/,                   scope: "note",    label: () => "Payment note" },
  { re: /^\/restaurants\/\d+\/orders\/\d+\/discounts(\/\d+)?$/,       scope: "order",   label: () => "Discount change" },
  { re: /^\/restaurants\/\d+\/tables\/\d+$/,                          scope: "table",   label: m => `Update table #${m[0].split("/").pop()}` },
  // Two spellings exist in the codebase: `/kitchen-tickets/:id` (legacy)
  // and `/kitchen/tickets/:id/...` (the path actually used by
  // useUpdateTicketStatus and the kitchen routes). Match both so KOT
  // status updates reliably queue offline.
  { re: /^\/restaurants\/\d+\/kitchen-tickets\/\d+(\/.*)?$/,          scope: "kot",     label: m => `KOT update #${m[0].match(/kitchen-tickets\/(\d+)/)?.[1] ?? "?"}` },
  { re: /^\/restaurants\/\d+\/kitchen\/tickets\/\d+(\/.*)?$/,         scope: "kot",     label: m => `KOT update #${m[0].match(/kitchen\/tickets\/(\d+)/)?.[1] ?? "?"}` },
];

function uid(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function readAll(): QueueEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as QueueEntry[] : [];
  } catch {
    return [];
  }
}

function writeAll(entries: QueueEntry[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded — drop oldest done entries first.
    const trimmed = entries.filter(e => e.status !== "done").slice(-200);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed)); } catch { /* give up */ }
  }
  notify();
}

function notify(): void {
  const snapshot = readAll();
  for (const l of listeners) l(snapshot);
}

export function subscribeQueue(fn: Listener): () => void {
  listeners.add(fn);
  fn(readAll());
  return () => { listeners.delete(fn); };
}

export function getQueueSnapshot(): QueueEntry[] {
  return readAll();
}

export function getLastSyncAt(): number | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(LAST_SYNC_KEY);
  return raw ? Number(raw) : null;
}

function setLastSyncAt(ts: number): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LAST_SYNC_KEY, String(ts));
}

/** Returns the descriptor if the path/method is queueable, else null. */
export function describeQueueable(method: string, path: string): { scope: string; label: string } | null {
  if (method !== "POST" && method !== "PATCH" && method !== "PUT" && method !== "DELETE") return null;
  for (const p of QUEUEABLE_PATTERNS) {
    const m = path.match(p.re);
    if (m) return { scope: p.scope, label: p.label(m, undefined) };
  }
  return null;
}

export function newIdempotencyKey(): string {
  return uid();
}

export function enqueueMutation(args: {
  path: string;
  method: QueueEntry["method"];
  body?: unknown;
  scope?: string;
  label?: string;
  /**
   * Optional pre-generated key. Callers that send a live request first
   * (and only enqueue on failure) should pass the same key they used on
   * the wire as `X-Idempotency-Key`, so a successful-but-lost response
   * doesn't cause the server to apply the write twice when it replays.
   */
  idempotencyKey?: string;
}): QueueEntry {
  const desc = describeQueueable(args.method, args.path) ?? { scope: args.scope ?? "other", label: args.label ?? `${args.method} ${args.path}` };
  const entry: QueueEntry = {
    id: uid(),
    createdAt: Date.now(),
    path: args.path,
    method: args.method,
    body: args.body,
    idempotencyKey: args.idempotencyKey ?? uid(),
    scope: args.scope ?? desc.scope,
    label: args.label ?? desc.label,
    attempts: 0,
    status: "pending",
  };
  writeAll([...readAll(), entry]);
  return entry;
}

export function removeEntry(id: string): void {
  writeAll(readAll().filter(e => e.id !== id));
}

export function retryEntry(id: string): void {
  writeAll(readAll().map(e => e.id === id ? { ...e, status: "pending", nextAttemptAt: undefined, lastError: undefined } : e));
}

export function clearDone(): void {
  writeAll(readAll().filter(e => e.status !== "done"));
}

function backoffMs(attempts: number): number {
  // 2s, 5s, 15s, 30s, 60s (cap).
  const schedule = [2000, 5000, 15000, 30000, 60000];
  return schedule[Math.min(attempts, schedule.length - 1)];
}

// ─── Sync engine ─────────────────────────────────────────────────────

let isSyncing = false;

/** Caller injects the real network sender so the queue stays UI-agnostic. */
export type Sender = (entry: QueueEntry) => Promise<{ ok: true; result: unknown } | { ok: false; status: number; payload: unknown }>;

let sender: Sender | null = null;
export function registerSender(fn: Sender): void {
  sender = fn;
}

/**
 * Drain the queue against the registered sender. Safe to call repeatedly —
 * the function early-exits if a sync is already in flight.
 */
export async function processQueue(): Promise<void> {
  if (isSyncing) return;
  if (!sender) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  isSyncing = true;
  try {
    const now = Date.now();
    const pending = readAll().filter(e => (e.status === "pending" || e.status === "failed") && (e.nextAttemptAt ?? 0) <= now);
    for (const entry of pending) {
      // Mark syncing.
      writeAll(readAll().map(e => e.id === entry.id ? { ...e, status: "syncing" } : e));
      let result;
      try {
        result = await sender(entry);
      } catch (err) {
        result = { ok: false as const, status: 0, payload: { error: (err as Error).message } };
      }
      const attempts = entry.attempts + 1;
      if (result.ok) {
        writeAll(readAll().map(e => e.id === entry.id ? { ...e, status: "done", attempts, serverResult: result.result, lastError: undefined } : e));
      } else if (result.status === 409) {
        const next = readAll().map(e => e.id === entry.id ? {
          ...e, status: "conflict" as const, attempts,
          lastError: typeof (result.payload as { error?: string })?.error === "string"
            ? (result.payload as { error: string }).error : "Conflict",
          conflictInfo: { serverPayload: result.payload, at: Date.now() },
        } : e);
        writeAll(next);
        const conflicted = next.find(e => e.id === entry.id);
        if (conflicted) notifyConflict(conflicted);
      } else if (result.status === 0 || result.status >= 500 || result.status === 408 || result.status === 429) {
        // Transient — retry with backoff.
        writeAll(readAll().map(e => e.id === entry.id ? {
          ...e, status: "failed", attempts,
          lastError: `Network/server error (${result.status})`,
          nextAttemptAt: Date.now() + backoffMs(attempts),
        } : e));
      } else {
        // 4xx other than 409: permanent client-side failure. Surface as conflict
        // so the owner can review (e.g. discount removed, item 86'd).
        const next = readAll().map(e => e.id === entry.id ? {
          ...e, status: "conflict" as const, attempts,
          lastError: typeof (result.payload as { error?: string })?.error === "string"
            ? (result.payload as { error: string }).error : `Rejected (${result.status})`,
          conflictInfo: { serverPayload: result.payload, at: Date.now() },
        } : e);
        writeAll(next);
        const conflicted = next.find(e => e.id === entry.id);
        if (conflicted) notifyConflict(conflicted);
      }
    }
    setLastSyncAt(Date.now());
  } finally {
    isSyncing = false;
  }
}

// ─── Offline-mode entry/exit tracking (for audit log) ────────────────

export function markOfflineEntered(): boolean {
  if (typeof localStorage === "undefined") return false;
  if (localStorage.getItem(OFFLINE_ENTERED_KEY)) return false;
  localStorage.setItem(OFFLINE_ENTERED_KEY, String(Date.now()));
  return true;
}

export function consumeOfflineExited(): { enteredAt: number } | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(OFFLINE_ENTERED_KEY);
  if (!raw) return null;
  localStorage.removeItem(OFFLINE_ENTERED_KEY);
  return { enteredAt: Number(raw) };
}

export function pendingCount(): number {
  return readAll().filter(e => e.status === "pending" || e.status === "failed" || e.status === "syncing").length;
}

export function conflictCount(): number {
  return readAll().filter(e => e.status === "conflict").length;
}
