import { describeQueueable, enqueueMutation, registerSender, processQueue, isOfflineQueueingEnabled, newIdempotencyKey, type QueueEntry } from "./offlineQueue";

const API_BASE = `/api`;

const TOKEN_KEY = "tt_access_token";
const REFRESH_KEY = "tt_refresh_token";
const USER_KEY = "tt_user";

export function getApiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function authHeaders(token?: string | null): HeadersInit {
  const t = token ?? getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function doRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return null;

  const res = await fetch(getApiUrl("/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    window.dispatchEvent(new Event("tt:logout"));
    return null;
  }

  const data = await res.json();
  localStorage.setItem(TOKEN_KEY, data.accessToken as string);
  if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken as string);
  if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.accessToken as string;
}

async function getRefreshedToken(): Promise<string | null> {
  if (isRefreshing) {
    return new Promise(resolve => { refreshQueue.push(resolve); });
  }
  isRefreshing = true;
  const token = await doRefresh();
  refreshQueue.forEach(resolve => resolve(token));
  refreshQueue = [];
  isRefreshing = false;
  return token;
}

async function request(
  path: string,
  init: RequestInit = {},
  retried = false,
): Promise<Response> {
  const res = await fetch(getApiUrl(path), {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401 && !retried) {
    const newToken = await getRefreshedToken();
    if (newToken) {
      return request(path, init, true);
    }
  }

  return res;
}

export async function apiFetch<T = unknown>(path: string): Promise<T> {
  const res = await request(path);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function readErrorPayload(res: Response): Promise<{ message: string; data: unknown }> {
  const text = await res.text();
  if (!text) return { message: res.statusText || `HTTP ${res.status}`, data: null };
  try {
    const parsed = JSON.parse(text);
    const message = typeof parsed?.error === "string" ? parsed.error
      : typeof parsed?.message === "string" ? parsed.message
      : text;
    return { message, data: parsed };
  } catch {
    return { message: text, data: null };
  }
}

/**
 * Thrown when a write request is queued for later sync because we're offline
 * or hit a network failure. POS UI catches this to show a friendly "queued"
 * state instead of a hard error.
 */
export class OfflineQueuedError extends Error {
  entry: QueueEntry;
  constructor(entry: QueueEntry) {
    super(`Queued offline: ${entry.label}`);
    this.name = "OfflineQueuedError";
    this.entry = entry;
  }
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export async function apiAction<T = unknown>(
  path: string,
  method = "POST",
  body?: unknown,
): Promise<T> {
  // Plans without the `offline_pos` feature get the legacy hard-fail
  // behavior — the offline queue is opt-in by subscription tier.
  const queueable = isOfflineQueueingEnabled() ? describeQueueable(method, path) : null;

  // Generate the idempotency key up-front when the request is queueable,
  // and send it on the live wire too. If the server processes the write
  // but the response is lost (mid-flight network drop), the replayed
  // queued request carries the same key so the server can dedupe.
  const idempotencyKey = queueable ? newIdempotencyKey() : null;

  // Pre-emptively queue when the browser knows it's offline so we don't
  // burn a guaranteed-to-fail network round-trip on every POS action.
  if (queueable && isOffline()) {
    const entry = enqueueMutation({ path, method: method as QueueEntry["method"], body, scope: queueable.scope, label: queueable.label, idempotencyKey: idempotencyKey ?? undefined });
    throw new OfflineQueuedError(entry);
  }

  const liveHeaders: Record<string, string> = {};
  if (body !== undefined) liveHeaders["Content-Type"] = "application/json";
  if (idempotencyKey) liveHeaders["X-Idempotency-Key"] = idempotencyKey;

  let res: Response;
  try {
    res = await request(path, {
      method,
      headers: liveHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // Network-level failure (DNS, dropped Wi-Fi mid-request, mTLS proxy hiccup).
    // For queueable POS writes, fall back to the offline queue rather than
    // crashing the workflow. Reuse the same idempotency key so the server
    // can detect duplicates if it already processed the original attempt.
    if (queueable) {
      const entry = enqueueMutation({ path, method: method as QueueEntry["method"], body, scope: queueable.scope, label: queueable.label, idempotencyKey: idempotencyKey ?? undefined });
      throw new OfflineQueuedError(entry);
    }
    throw err;
  }

  if (!res.ok) {
    const { message, data } = await readErrorPayload(res);
    throw new ApiError(message, res.status, data);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Register a sender so the queue can replay entries through the same auth /
// refresh pipeline as live calls.
registerSender(async (entry) => {
  try {
    const res = await request(entry.path, {
      method: entry.method,
      headers: {
        "Content-Type": "application/json",
        "X-Idempotency-Key": entry.idempotencyKey,
      },
      body: entry.body !== undefined ? JSON.stringify(entry.body) : undefined,
    });
    if (res.ok) {
      if (res.status === 204) return { ok: true, result: null };
      const txt = await res.text();
      try { return { ok: true, result: txt ? JSON.parse(txt) : null }; }
      catch { return { ok: true, result: txt }; }
    }
    const { data } = await readErrorPayload(res);
    return { ok: false, status: res.status, payload: data ?? { error: res.statusText } };
  } catch (err) {
    return { ok: false, status: 0, payload: { error: (err as Error).message } };
  }
});

// Opportunistically drain whenever the tab regains connectivity.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { void processQueue(); });
}

/**
 * Sentinel returned by `wrapQueueable` when a write was accepted into the
 * offline queue. React Query mutationFns use this to surface a successful
 * (but queued) state instead of bubbling `OfflineQueuedError` up through
 * the `onError` channel — POS UX treats queued writes as success.
 */
export interface OfflineQueuedResult {
  __offlineQueued: true;
  queueEntry: QueueEntry;
}

export function isOfflineQueuedResult(value: unknown): value is OfflineQueuedResult {
  return !!value && typeof value === "object" && (value as { __offlineQueued?: boolean }).__offlineQueued === true;
}

/**
 * Wraps a queueable mutation so the mutationFn never throws when the API
 * layer chooses to enqueue the write. Real failures still throw normally.
 */
export async function wrapQueueable<T>(fn: () => Promise<T>): Promise<T | OfflineQueuedResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof OfflineQueuedError) {
      return { __offlineQueued: true, queueEntry: err.entry };
    }
    throw err;
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiFetch<T>(path);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiAction<T>(path, "POST", body);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiAction<T>(path, "PATCH", body);
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return apiAction<T>(path, "PUT", body);
}

export async function apiDelete(path: string): Promise<void> {
  await apiAction(path, "DELETE");
}
