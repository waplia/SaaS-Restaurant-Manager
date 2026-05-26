/**
 * HTTP client for the Khanalagao API, owned exclusively by the main process.
 *
 * Responsibilities:
 *   • Attach the bearer token automatically.
 *   • On a 401, transparently call POST /api/auth/refresh with the stored
 *     refresh token; retry the original request once with the new access
 *     token. If refresh also fails, clear the session and surface an error.
 *   • Normalise errors into a single `ApiError` shape so IPC handlers can
 *     translate them into structured envelopes.
 *
 * Uses Node's built-in `fetch` (Node 20+ / Electron 28+) — no axios.
 */

import { sessionStore } from "../session-store";
import type {
  User, Restaurant, Branch, Terminal,
  CashRegisterCurrent, CashRegisterSession, DenominationInput,
} from "../../shared/ipc-contract";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly body?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Bypass token attachment / refresh — used by login + refresh themselves. */
  noAuth?: boolean;
  /** Internal flag to prevent infinite refresh recursion. */
  _retried?: boolean;
}

export class ApiClient {
  private baseUrl: string;
  private refreshInflight: Promise<boolean> | null = null;
  private onAuthInvalidated: (() => void) | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, "");
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  onAuthLost(cb: () => void): void {
    this.onAuthInvalidated = cb;
  }

  // ─── Low-level request ────────────────────────────────────────────────
  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    if (!this.baseUrl) throw new ApiError(0, "API base URL not configured. Open Settings.");

    const url = `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };

    if (!opts.noAuth) {
      const { accessToken } = sessionStore.getTokens();
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (err) {
      throw new ApiError(0, `Network error: ${(err as Error).message}`);
    }

    if (res.status === 401 && !opts.noAuth && !opts._retried) {
      const refreshed = await this.tryRefresh();
      if (refreshed) return this.request<T>(path, { ...opts, _retried: true });
      // Refresh failed — wipe tokens and notify shell to redirect to login.
      sessionStore.clearAll();
      this.onAuthInvalidated?.();
      throw new ApiError(401, "Your session has expired. Please sign in again.");
    }

    const text = await res.text();
    const parsed: unknown = text ? safeJson(text) : null;

    if (!res.ok) {
      const msg = (parsed && typeof parsed === "object" && "error" in parsed
        && typeof (parsed as { error: unknown }).error === "string")
        ? (parsed as { error: string }).error
        : `Request failed (${res.status})`;
      throw new ApiError(res.status, msg, parsed);
    }

    return parsed as T;
  }

  private async tryRefresh(): Promise<boolean> {
    if (this.refreshInflight) return this.refreshInflight;
    this.refreshInflight = (async () => {
      const { refreshToken } = sessionStore.getTokens();
      if (!refreshToken) return false;
      try {
        const r = await this.request<{ accessToken: string; refreshToken: string }>(
          "/api/auth/refresh",
          { method: "POST", body: { refreshToken }, noAuth: true },
        );
        sessionStore.setTokens(r.accessToken, r.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        this.refreshInflight = null;
      }
    })();
    return this.refreshInflight;
  }

  // ─── Auth ─────────────────────────────────────────────────────────────
  async login(identifier: string, password: string): Promise<{ accessToken: string; refreshToken: string; user: User }> {
    return this.request("/api/auth/login", {
      method: "POST",
      body: { identifier, password },
      noAuth: true,
    });
  }

  async me(): Promise<User> {
    return this.request<User>("/api/auth/me");
  }

  async logout(): Promise<void> {
    try { await this.request<{ success: boolean }>("/api/auth/logout", { method: "POST" }); }
    catch { /* server-side invalidation is best-effort; local clear is what matters */ }
  }

  // ─── Restaurants / branches / terminals ───────────────────────────────
  async listRestaurants(): Promise<Restaurant[]> {
    const data = await this.request<unknown>("/api/restaurants");
    return Array.isArray(data) ? (data as Restaurant[]) : [];
  }

  async listBranches(restaurantId: number): Promise<Branch[]> {
    const data = await this.request<unknown>(`/api/restaurants/${restaurantId}/branches`);
    return Array.isArray(data) ? (data as Branch[]) : [];
  }

  async listTerminals(restaurantId: number): Promise<Terminal[]> {
    const data = await this.request<unknown>(`/api/restaurants/${restaurantId}/terminals`);
    return Array.isArray(data) ? (data as Terminal[]) : [];
  }

  // ─── Cash register / shifts ───────────────────────────────────────────
  async currentShift(restaurantId: number): Promise<CashRegisterCurrent> {
    return this.request<CashRegisterCurrent>(`/api/restaurants/${restaurantId}/cash-register/current`);
  }

  async openShift(restaurantId: number, openingCash: number, notes?: string): Promise<CashRegisterSession> {
    // Server validates a denomination breakdown that must sum exactly to the
    // opening float. Phase 1 doesn't have a tray-counter UI yet, so we
    // greedily decompose the entered rupee amount into valid INR notes/coins.
    // Phase 4 will replace this with a proper denomination entry UI.
    const denominations = decomposeIntoInrDenominations(openingCash);
    return this.request<CashRegisterSession>(
      `/api/restaurants/${restaurantId}/cash-register/sessions/open`,
      { method: "POST", body: { denominations, notes: notes ?? null } },
    );
  }

  async closeShift(restaurantId: number, sessionId: number, countedAmount: number, closeNotes?: string): Promise<{ ok: true }> {
    await this.request<unknown>(
      `/api/restaurants/${restaurantId}/cash-register/sessions/${sessionId}/close`,
      { method: "POST", body: { countedAmount, closeNotes: closeNotes ?? null, isBlindClose: false } },
    );
    return { ok: true };
  }

  // ─── Orders / customers / menu (used by Phase 3 print handlers) ───────
  async createOrder(restaurantId: number, body: unknown): Promise<ApiOrderDetail> {
    return this.request<ApiOrderDetail>(`/api/restaurants/${restaurantId}/orders`, {
      method: "POST", body,
    });
  }

  async getOrder(restaurantId: number, orderId: number): Promise<ApiOrderDetail> {
    return this.request<ApiOrderDetail>(`/api/restaurants/${restaurantId}/orders/${orderId}`);
  }

  async getRestaurant(restaurantId: number): Promise<ApiRestaurantDetail> {
    return this.request<ApiRestaurantDetail>(`/api/restaurants/${restaurantId}`);
  }

  async lookupCustomerByPhone(restaurantId: number, phone: string): Promise<unknown> {
    const q = encodeURIComponent(phone);
    return this.request<unknown>(`/api/restaurants/${restaurantId}/customers?search=${q}&limit=5`);
  }

  async lookupMenuItemByCode(restaurantId: number, code: string): Promise<{ id: number; name: string; price: number; sku?: string | null } | null> {
    const q = encodeURIComponent(code);
    const data = await this.request<unknown>(`/api/restaurants/${restaurantId}/menu?search=${q}&limit=5`);
    // Servers return either an array or { items: [...] }; tolerate both.
    const items: Array<{ id: number; name: string; price: number | string; sku?: string | null; barcode?: string | null }> = Array.isArray(data)
      ? (data as never[])
      : Array.isArray((data as { items?: unknown[] })?.items)
        ? ((data as { items: never[] }).items)
        : [];
    const codeLower = code.toLowerCase();
    const hit = items.find((it) => (it.sku ?? "").toLowerCase() === codeLower
      || (it.barcode ?? "").toLowerCase() === codeLower) ?? items[0];
    if (!hit) return null;
    return { id: hit.id, name: hit.name, price: Number(hit.price) || 0, sku: hit.sku ?? null };
  }
}

/** Minimal subset of the API order-detail payload we consume in main. */
export interface ApiOrderDetail {
  id: number;
  orderNumber: string;
  orderType?: string | null;
  status?: string | null;
  tableId?: number | null;
  tableLabel?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  subtotal?: number | string | null;
  taxAmount?: number | string | null;
  serviceCharge?: number | string | null;
  discountAmount?: number | string | null;
  totalAmount?: number | string | null;
  createdAt?: string | null;
  paymentMethod?: string | null;
  paymentAmount?: number | string | null;
  items: Array<{
    id: number;
    name: string;
    quantity: number;
    unitPrice?: number | string | null;
    lineTotal?: number | string | null;
    notes?: string | null;
    kitchenId?: number | null;
    kitchenName?: string | null;
    modifiers?: Array<{ name: string; price?: number | string | null }>;
  }>;
  discounts?: Array<{ label?: string | null; name?: string | null; amount: number | string }>;
}

export interface ApiRestaurantDetail {
  id: number;
  name: string;
  address?: string | null;
  phone?: string | null;
  gstin?: string | null;
  fssaiLicense?: string | null;
  upiId?: string | null;
  receiptFooter?: string | null;
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Greedy INR decomposition into the denominations the API accepts.
 * Matches `INR_DENOMINATIONS` in artifacts/api-server/src/routes/cash-register.ts.
 * Input is rounded to the nearest rupee (the smallest accepted denomination is ₹1).
 */
const INR_DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;
export function decomposeIntoInrDenominations(rupees: number): DenominationInput[] {
  let remaining = Math.max(0, Math.round(Number(rupees) || 0));
  const out: DenominationInput[] = [];
  for (const d of INR_DENOMINATIONS) {
    const count = Math.floor(remaining / d);
    if (count > 0) {
      out.push({ denomination: d, count });
      remaining -= count * d;
    }
  }
  return out;
}
