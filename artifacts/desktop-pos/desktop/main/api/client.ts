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
 *   • Carry caller-supplied `X-Idempotency-Key` headers through to the API
 *     so server-side de-dupe wins on retries (Phase 2 — order create / add
 *     items / discount apply / discount remove).
 *
 * Uses Node's built-in `fetch` (Node 20+ / Electron 28+) — no axios.
 */

import { randomUUID } from "node:crypto";
import { sessionStore } from "../session-store";
import type {
  User, Restaurant, Branch, Terminal,
  CashRegisterCurrent, CashRegisterSession, DenominationInput,
  RestaurantInfo, MenuCategory, MenuItem, ModifierGroup,
  FloorTable, CustomerSummary, CreateOrderRequest, CartItemInput,
  OrderHeader, OrderDetailView, DiscountsConfig, ApplyDiscountRequest,
  PayMethod, SplitLeg, ZReportSummary,
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
  /** Extra request headers (e.g. X-Idempotency-Key). */
  headers?: Record<string, string>;
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
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(opts.headers ?? {}),
    };

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

  async getRestaurantInfo(restaurantId: number): Promise<RestaurantInfo> {
    return this.request<RestaurantInfo>(`/api/restaurants/${restaurantId}`);
  }

  /**
   * Fetch the channel-mapped rendered bill text from the API. Used by the
   * print engine so the thermal printer prints the exact same content as
   * the web/mobile surfaces — a single Settings → Bill Templates change
   * propagates everywhere.
   */
  async renderBillText(restaurantId: number, orderId: number, channel: string): Promise<string> {
    if (!this.baseUrl) throw new ApiError(0, "API base URL not configured. Open Settings.");
    const path = `/api/restaurants/${restaurantId}/orders/${orderId}/bill-render?channel=${encodeURIComponent(channel)}&format=text`;
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { Accept: "text/plain" };
    const { accessToken } = sessionStore.getTokens();
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    let res = await fetch(url, { method: "GET", headers });
    if (res.status === 401) {
      // Reuse the same refresh path as request<T>() by piggy-backing through a
      // throwaway authed request that triggers refresh, then retry once.
      try {
        await this.request<unknown>("/api/auth/me");
        const { accessToken: refreshed } = sessionStore.getTokens();
        if (refreshed) headers.Authorization = `Bearer ${refreshed}`;
        res = await fetch(url, { method: "GET", headers });
      } catch {
        // fall through — error handled below
      }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ApiError(res.status, `bill-render failed (${res.status})`, body);
    }
    return await res.text();
  }

  // ─── Menu ─────────────────────────────────────────────────────────────
  async listCategories(restaurantId: number): Promise<MenuCategory[]> {
    const data = await this.request<unknown>(`/api/restaurants/${restaurantId}/categories`);
    return Array.isArray(data) ? (data as MenuCategory[]) : [];
  }

  async listMenuItems(
    restaurantId: number,
    opts: { categoryId?: number; search?: string } = {},
  ): Promise<MenuItem[]> {
    const qs: string[] = [];
    if (opts.categoryId != null) qs.push(`categoryId=${encodeURIComponent(String(opts.categoryId))}`);
    if (opts.search) qs.push(`search=${encodeURIComponent(opts.search)}`);
    const suffix = qs.length > 0 ? `?${qs.join("&")}` : "";
    const data = await this.request<unknown>(`/api/restaurants/${restaurantId}/items${suffix}`);
    return Array.isArray(data) ? (data as MenuItem[]) : [];
  }

  async listItemModifierGroups(menuItemId: number): Promise<ModifierGroup[]> {
    const data = await this.request<unknown>(`/api/items/${menuItemId}/modifier-groups`);
    return Array.isArray(data) ? (data as ModifierGroup[]) : [];
  }

  // ─── Tables ───────────────────────────────────────────────────────────
  async listTables(restaurantId: number): Promise<FloorTable[]> {
    const data = await this.request<unknown>(`/api/restaurants/${restaurantId}/tables`);
    return Array.isArray(data) ? (data as FloorTable[]) : [];
  }

  async getTableActiveOrderId(restaurantId: number, tableId: number): Promise<number | null> {
    try {
      const r = await this.request<{ order: { id: number } | null }>(
        `/api/restaurants/${restaurantId}/tables/${tableId}/active-order`,
      );
      return r?.order?.id ?? null;
    } catch (err) {
      // Treat "no active order" as a soft no.
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }

  // ─── Customers ────────────────────────────────────────────────────────
  async searchCustomers(restaurantId: number, search: string, limit = 20): Promise<CustomerSummary[]> {
    const qs: string[] = [`limit=${encodeURIComponent(String(limit))}`];
    if (search) qs.push(`search=${encodeURIComponent(search)}`);
    const r = await this.request<{ data?: CustomerSummary[] }>(
      `/api/restaurants/${restaurantId}/customers?${qs.join("&")}`,
    );
    return Array.isArray(r?.data) ? r.data : [];
  }

  async createCustomer(
    restaurantId: number,
    body: { name?: string; phone?: string; email?: string },
  ): Promise<CustomerSummary> {
    return this.request<CustomerSummary>(`/api/restaurants/${restaurantId}/customers`, {
      method: "POST",
      body,
    });
  }

  // ─── Orders ───────────────────────────────────────────────────────────
  async listOrders(
    restaurantId: number,
    opts: { status?: string; limit?: number; branchId?: number | null } = {},
  ): Promise<OrderHeader[]> {
    const qs: string[] = [];
    if (opts.status) qs.push(`status=${encodeURIComponent(opts.status)}`);
    if (opts.limit) qs.push(`limit=${encodeURIComponent(String(opts.limit))}`);
    if (opts.branchId != null) qs.push(`branchId=${encodeURIComponent(String(opts.branchId))}`);
    const suffix = qs.length > 0 ? `?${qs.join("&")}` : "";
    const r = await this.request<{ data?: OrderHeader[] }>(
      `/api/restaurants/${restaurantId}/orders${suffix}`,
    );
    return Array.isArray(r?.data) ? r.data : [];
  }

  async getOrder(restaurantId: number, orderId: number): Promise<OrderDetailView> {
    return this.request<OrderDetailView>(`/api/restaurants/${restaurantId}/orders/${orderId}`);
  }

  async createOrder(
    restaurantId: number,
    body: CreateOrderRequest,
  ): Promise<OrderDetailView> {
    const { idempotencyKey, ...payload } = body;
    const key = idempotencyKey || randomUUID();
    const created = await this.request<OrderHeader>(
      `/api/restaurants/${restaurantId}/orders`,
      { method: "POST", body: payload, headers: { "X-Idempotency-Key": key } },
    );
    // Fetch the full detail (items + discounts) for the renderer.
    return this.getOrder(restaurantId, created.id);
  }

  async addOrderItems(
    restaurantId: number,
    orderId: number,
    items: CartItemInput[],
    idempotencyKey?: string,
  ): Promise<OrderDetailView> {
    // Per-item POST mirrors the web POS; preserves modifier handling.
    // Key is the caller-supplied per-action UUID prefix + a *stable* line
    // index (no Date.now()) so retries collapse instead of re-inserting.
    const base = idempotencyKey || randomUUID();
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const key = `${base}:${idx}:${it.menuItemId}`;
      await this.request<unknown>(
        `/api/restaurants/${restaurantId}/orders/${orderId}/items`,
        { method: "POST", body: it, headers: { "X-Idempotency-Key": key } },
      );
    }
    return this.getOrder(restaurantId, orderId);
  }

  async patchOrder(
    restaurantId: number,
    orderId: number,
    patch: Partial<OrderHeader>,
  ): Promise<OrderHeader> {
    return this.request<OrderHeader>(
      `/api/restaurants/${restaurantId}/orders/${orderId}`,
      { method: "PATCH", body: patch },
    );
  }

  // ─── Discounts ────────────────────────────────────────────────────────
  async loadDiscountsConfig(restaurantId: number): Promise<DiscountsConfig> {
    try {
      const r = await this.request<unknown>(`/api/restaurants/${restaurantId}/settings/discounts`);
      if (r && typeof r === "object") return r as DiscountsConfig;
      return {};
    } catch (err) {
      // Endpoint may be feature-gated — degrade gracefully.
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return {};
      throw err;
    }
  }

  async applyDiscount(
    restaurantId: number,
    req: ApplyDiscountRequest,
  ): Promise<OrderDetailView> {
    const { orderId, idempotencyKey, ...body } = req;
    const key = idempotencyKey || randomUUID();
    await this.request<unknown>(
      `/api/restaurants/${restaurantId}/orders/${orderId}/discounts`,
      { method: "POST", body, headers: { "X-Idempotency-Key": key } },
    );
    return this.getOrder(restaurantId, orderId);
  }

  async removeDiscount(
    restaurantId: number,
    orderId: number,
    discountId: number,
    idempotencyKey?: string,
  ): Promise<OrderDetailView> {
    const key = idempotencyKey || randomUUID();
    await this.request<unknown>(
      `/api/restaurants/${restaurantId}/orders/${orderId}/discounts/${discountId}`,
      { method: "DELETE", headers: { "X-Idempotency-Key": key } },
    );
    return this.getOrder(restaurantId, orderId);
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

  async closeShift(
    restaurantId: number,
    sessionId: number,
    body: {
      denominations?: DenominationInput[];
      countedAmount?: number;
      closeNotes?: string;
      isBlindClose?: boolean;
      varianceReason?: string;
      managerPin?: string;
    },
  ): Promise<{
    session: { id: number; closedAt?: string | null; isBlindClose?: boolean; varianceReason?: string | null };
    totals: { openingFloat?: number; totalCashIn?: number | null; totalCashOut?: number | null; expectedCash?: number | null; actualCash?: number | null; overShort?: number | null };
    blindClose?: boolean;
  }> {
    return this.request(
      `/api/restaurants/${restaurantId}/cash-register/sessions/${sessionId}/close`,
      {
        method: "POST",
        body: {
          denominations: body.denominations,
          countedAmount: body.countedAmount,
          closeNotes: body.closeNotes ?? null,
          isBlindClose: !!body.isBlindClose,
          varianceReason: body.varianceReason ?? undefined,
          managerPin: body.managerPin ?? undefined,
        },
      },
    );
  }

  /** Z-report (post-close detail). Server returns a richer payload than the
   *  on-the-fly X report used during the open shift. */
  async getZReport(restaurantId: number, sessionId: number): Promise<{
    session: { id: number; openedAt: string; closedAt?: string | null; openingFloat: string | number; isBlindClose?: boolean; varianceReason?: string | null; closeNotes?: string | null };
    totals: { openingFloat: number; cashSales: number; totalCashIn: number; totalCashOut: number; expectedCash: number; actualCash?: number | null; overShort?: number | null };
    tenderSummary: Record<string, { in: number; out: number; count: number }>;
    orderCount: number;
    grossRevenue: string | number;
    movements: unknown[];
    openedByName?: string | null;
    closedByName?: string | null;
  }> {
    return this.request(`/api/restaurants/${restaurantId}/cash-register/sessions/${sessionId}/z-report`);
  }

  // ─── Phase 4: payments / split / terminals ────────────────────────────
  async createStripeIntent(
    restaurantId: number, orderId: number,
    body: { customAmount?: number; tipAmount?: number },
  ): Promise<{ clientSecret: string | null; intentId: string; mode: "live" | "demo"; totalAmount?: string | number }> {
    return this.request(`/api/restaurants/${restaurantId}/orders/${orderId}/payment-intent`, {
      method: "POST", body,
    });
  }

  async createRazorpayOrder(
    restaurantId: number, orderId: number,
    body: { customAmount?: number; tipAmount?: number },
  ): Promise<{ id: string; amount: number; currency: string; keyId: string | null; mode: "live" | "demo" }> {
    return this.request(`/api/restaurants/${restaurantId}/orders/${orderId}/razorpay-order`, {
      method: "POST", body,
    });
  }

  async terminalCharge(
    restaurantId: number, terminalDeviceId: number,
    body: { orderId: number; amount: number; tipAmount?: number },
  ): Promise<{ paymentIntentId: string; status: string }> {
    return this.request(
      `/api/restaurants/${restaurantId}/terminals/${terminalDeviceId}/charge`,
      { method: "POST", body },
    );
  }

  async terminalConfirm(
    restaurantId: number, terminalDeviceId: number,
    body: { orderId: number; paymentIntentId: string },
  ): Promise<OrderDetailView> {
    await this.request<unknown>(
      `/api/restaurants/${restaurantId}/terminals/${terminalDeviceId}/confirm`,
      { method: "POST", body },
    );
    return this.getOrder(restaurantId, body.orderId);
  }

  async payOrder(
    restaurantId: number, orderId: number,
    body: {
      paymentMethod: PayMethod;
      tipAmount?: number;
      stripePaymentIntentId?: string;
      razorpayPaymentId?: string;
      razorpayOrderId?: string;
      razorpaySignature?: string;
    },
    idempotencyKey?: string,
  ): Promise<OrderDetailView> {
    const key = idempotencyKey || randomUUID();
    await this.request<unknown>(
      `/api/restaurants/${restaurantId}/orders/${orderId}/pay`,
      { method: "POST", body, headers: { "X-Idempotency-Key": key } },
    );
    return this.getOrder(restaurantId, orderId);
  }

  async splitOrder(
    restaurantId: number, orderId: number,
    legs: SplitLeg[],
    idempotencyKey?: string,
  ): Promise<OrderDetailView> {
    const key = idempotencyKey || randomUUID();
    await this.request<unknown>(
      `/api/restaurants/${restaurantId}/orders/${orderId}/split`,
      { method: "POST", body: { payments: legs }, headers: { "X-Idempotency-Key": key } },
    );
    return this.getOrder(restaurantId, orderId);
  }

  // ─── Misc — used by Phase 3 print handler ──────────────────────────────
  async getRestaurant(restaurantId: number): Promise<ApiRestaurantDetail> {
    return this.request<ApiRestaurantDetail>(`/api/restaurants/${restaurantId}`);
  }

  /** Untyped helper for Z-report builder: lists orders in a time window. */
  async listOrdersInRange(
    restaurantId: number,
    opts: { from?: string; to?: string; limit?: number; branchId?: number | null } = {},
  ): Promise<OrderHeader[]> {
    const qs: string[] = [];
    if (opts.from) qs.push(`from=${encodeURIComponent(opts.from)}`);
    if (opts.to) qs.push(`to=${encodeURIComponent(opts.to)}`);
    if (opts.limit) qs.push(`limit=${encodeURIComponent(String(opts.limit))}`);
    if (opts.branchId != null) qs.push(`branchId=${encodeURIComponent(String(opts.branchId))}`);
    const suffix = qs.length > 0 ? `?${qs.join("&")}` : "";
    const r = await this.request<{ data?: OrderHeader[] } | OrderHeader[]>(
      `/api/restaurants/${restaurantId}/orders${suffix}`,
    );
    const arr = Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [];
    return arr;
  }

  /** Suppress the now-deprecated cash session reference but keep `_zReportSummary`
   *  referenced so ts strict mode doesn't complain about the new import. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _zReportSummaryRef?: ZReportSummary;

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

// ─── Phase 6: specialist workspace endpoints ────────────────────────────────
// Thin wrappers around existing REST routes — return raw JSON so the
// renderer can narrow the shape with its own per-screen DTOs.

export interface SpecialistApi {
  invList(r: number, q: { lowStock?: boolean; search?: string }): Promise<unknown[]>;
  invAdjust(r: number, id: number, body: Record<string, unknown>): Promise<unknown>;
  invTx(r: number, id: number, limit?: number): Promise<unknown[]>;
  invWasteLog(r: number): Promise<unknown[]>;
  invSuppliers(r: number): Promise<unknown[]>;
  invSupplierCreate(r: number, body: Record<string, unknown>): Promise<unknown>;
  invPOList(r: number, status?: string): Promise<unknown[]>;
  invPOCreate(r: number, body: Record<string, unknown>): Promise<unknown>;
  invPOReceive(r: number, id: number): Promise<unknown>;

  accExpenses(r: number, q: Record<string, string | number | undefined>): Promise<unknown>;
  accExpenseCreate(r: number, body: Record<string, unknown>): Promise<unknown>;
  accExpenseCategories(r: number): Promise<unknown[]>;
  accExpenseCategoryCreate(r: number, body: Record<string, unknown>): Promise<unknown>;
  accPayments(r: number, q: Record<string, string | number | undefined>): Promise<unknown>;
  accPaymentsSummary(r: number, q: { from?: string; to?: string }): Promise<unknown>;
  accPnl(r: number, q: { from?: string; to?: string }): Promise<unknown>;
  accTargets(r: number): Promise<unknown>;

  mktCampaigns(r: number, q: Record<string, string | undefined>): Promise<unknown[]>;
  mktAnalytics(r: number): Promise<unknown>;
  mktLogs(r: number, limit?: number): Promise<unknown[]>;
  mktDraft(r: number, body: Record<string, unknown>): Promise<unknown>;
  mktTemplates(r: number, channel: string): Promise<unknown[]>;
  mktReviewsFeedback(r: number, limit?: number): Promise<unknown[]>;
  mktReviewsExternal(r: number, limit?: number): Promise<unknown[]>;
  mktReviewsRecovery(r: number, status?: string): Promise<unknown[]>;
  mktCouponsValidate(r: number, code: string): Promise<unknown>;
  mktCustomers(r: number, q: Record<string, string | number | undefined>): Promise<unknown[]>;

  delAssignments(r: number, status?: string): Promise<unknown[]>;
  delExecutives(r: number): Promise<unknown[]>;
  delAssign(r: number, body: Record<string, unknown>): Promise<unknown>;
  delUpdateStatus(r: number, assignmentId: number, body: Record<string, unknown>): Promise<unknown>;
  delProof(r: number, assignmentId: number, body: { proofPhotoUrl: string }): Promise<unknown>;
  delUnavailable(r: number, assignmentId: number, body: { reason: string }): Promise<unknown>;
  delCodCollected(r: number, assignmentId: number): Promise<unknown>;
  delCodSummary(r: number, q: { from?: string; to?: string }): Promise<unknown>;
  delHandovers(r: number, limit?: number): Promise<unknown[]>;
  delHandoverCreate(r: number, body: Record<string, unknown>): Promise<unknown>;
  delAggregatorDashboard(r: number): Promise<unknown>;
  delAggregatorSheets(r: number): Promise<unknown[]>;
}

function qs(q: Record<string, string | number | boolean | undefined>): string {
  const parts = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

// Attach the specialist surface to the ApiClient prototype. Keeps the
// existing class declaration above untouched while still being typed.
declare module "./client" {
  interface ApiClient extends SpecialistApi {}
}
const P = ApiClient.prototype as ApiClient & SpecialistApi;

P.invList = function (r, q) {
  return this.request<unknown[]>(`/api/restaurants/${r}/inventory${qs(q)}`);
};
P.invAdjust = function (r, id, body) {
  return this.request<unknown>(`/api/restaurants/${r}/inventory/${id}/adjust`, { method: "POST", body });
};
P.invTx = function (r, id, limit) {
  return this.request<unknown[]>(`/api/restaurants/${r}/inventory/${id}/transactions${qs({ limit })}`);
};
P.invWasteLog = function (r) {
  return this.request<unknown[]>(`/api/restaurants/${r}/inventory/waste-log`);
};
P.invSuppliers = function (r) {
  return this.request<unknown[]>(`/api/restaurants/${r}/suppliers`);
};
P.invSupplierCreate = function (r, body) {
  return this.request<unknown>(`/api/restaurants/${r}/suppliers`, { method: "POST", body });
};
P.invPOList = function (r, status) {
  return this.request<unknown[]>(`/api/restaurants/${r}/purchase-orders${qs({ status })}`);
};
P.invPOCreate = function (r, body) {
  return this.request<unknown>(`/api/restaurants/${r}/purchase-orders`, { method: "POST", body });
};
P.invPOReceive = function (r, id) {
  return this.request<unknown>(`/api/restaurants/${r}/purchase-orders/${id}`, {
    method: "PATCH", body: { status: "received" },
  });
};

P.accExpenses = function (r, q) {
  return this.request<unknown>(`/api/restaurants/${r}/expenses${qs(q)}`);
};
P.accExpenseCreate = function (r, body) {
  return this.request<unknown>(`/api/restaurants/${r}/expenses`, { method: "POST", body });
};
P.accExpenseCategories = function (r) {
  return this.request<unknown[]>(`/api/restaurants/${r}/expense-categories`);
};
P.accExpenseCategoryCreate = function (r, body) {
  return this.request<unknown>(`/api/restaurants/${r}/expense-categories`, { method: "POST", body });
};
P.accPayments = function (r, q) {
  return this.request<unknown>(`/api/restaurants/${r}/payments${qs(q)}`);
};
P.accPaymentsSummary = function (r, q) {
  return this.request<unknown>(`/api/restaurants/${r}/payments/summary${qs(q)}`);
};
P.accPnl = function (r, q) {
  return this.request<unknown>(`/api/restaurants/${r}/pnl${qs(q)}`);
};
P.accTargets = function (r) {
  return this.request<unknown>(`/api/restaurants/${r}/accounting/targets`);
};

P.mktCampaigns = function (r, q) {
  return this.request<unknown[]>(`/api/restaurants/${r}/growth/campaigns${qs(q)}`);
};
P.mktAnalytics = function (r) {
  return this.request<unknown>(`/api/restaurants/${r}/growth/analytics`);
};
P.mktLogs = function (r, limit) {
  return this.request<unknown[]>(`/api/restaurants/${r}/growth/logs${qs({ limit })}`);
};
P.mktDraft = function (r, body) {
  return this.request<unknown>(`/api/restaurants/${r}/growth/campaigns/draft`, { method: "POST", body });
};
P.mktTemplates = function (r, channel) {
  return this.request<unknown[]>(`/api/restaurants/${r}/growth/templates/${encodeURIComponent(channel)}`);
};
P.mktReviewsFeedback = function (r, limit) {
  return this.request<unknown[]>(`/api/restaurants/${r}/reviews/feedback${qs({ limit })}`);
};
P.mktReviewsExternal = function (r, limit) {
  return this.request<unknown[]>(`/api/restaurants/${r}/reviews/external${qs({ limit })}`);
};
P.mktReviewsRecovery = function (r, status) {
  return this.request<unknown[]>(`/api/restaurants/${r}/reviews/recovery${qs({ status })}`);
};
P.mktCouponsValidate = function (r, code) {
  return this.request<unknown>(`/api/coupons/validate`, { method: "POST", body: { code, restaurantId: r } });
};
P.mktCustomers = function (r, q) {
  return this.request<unknown[]>(`/api/restaurants/${r}/customers${qs(q)}`);
};

P.delAssignments = function (r, status) {
  return this.request<unknown[]>(`/api/restaurants/${r}/delivery/assignments${qs({ status })}`);
};
P.delExecutives = function (r) {
  return this.request<unknown[]>(`/api/restaurants/${r}/delivery/executives`);
};
P.delAssign = function (r, body) {
  return this.request<unknown>(`/api/restaurants/${r}/delivery/assign`, { method: "POST", body });
};
P.delUpdateStatus = function (r, assignmentId, body) {
  return this.request<unknown>(`/api/restaurants/${r}/delivery/assignments/${assignmentId}/status`, {
    method: "PATCH", body,
  });
};
P.delProof = function (r, assignmentId, body) {
  return this.request<unknown>(`/api/restaurants/${r}/delivery/assignments/${assignmentId}/proof`, {
    method: "POST", body,
  });
};
P.delUnavailable = function (r, assignmentId, body) {
  return this.request<unknown>(`/api/restaurants/${r}/delivery/assignments/${assignmentId}/unavailable`, {
    method: "POST", body,
  });
};
P.delCodCollected = function (r, assignmentId) {
  return this.request<unknown>(`/api/restaurants/${r}/delivery/assignments/${assignmentId}/cod-collected`, {
    method: "POST", body: {},
  });
};
P.delCodSummary = function (r, q) {
  return this.request<unknown>(`/api/restaurants/${r}/delivery/cod-summary${qs(q)}`);
};
P.delHandovers = function (r, limit) {
  return this.request<unknown[]>(`/api/restaurants/${r}/delivery/handovers${qs({ limit })}`);
};
P.delHandoverCreate = function (r, body) {
  return this.request<unknown>(`/api/restaurants/${r}/delivery/handovers`, { method: "POST", body });
};
P.delAggregatorDashboard = function (r) {
  return this.request<unknown>(`/api/restaurants/${r}/aggregator-payouts/dashboard`);
};
P.delAggregatorSheets = function (r) {
  return this.request<unknown[]>(`/api/restaurants/${r}/aggregator-payouts/sheets`);
};
