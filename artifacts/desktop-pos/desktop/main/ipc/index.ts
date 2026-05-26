/**
 * IPC handler registry.
 *
 * Maps every channel from `desktop/shared/ipc-contract.ts` to a main-process
 * implementation. Each handler is wrapped in a uniform try/catch that returns
 * `{ ok:true, data }` or `{ ok:false, error }` — the preload bridge unwraps
 * this so renderer code can `await` and `try/catch` like a normal function.
 *
 * Phase 2 additions:
 *   • menu:* / tables:* / customers:* / orders:* / discounts:* — wired against
 *     the real API endpoints via `ApiClient`.
 *   • A short-lived in-memory cache for the menu bundle (categories+items) so
 *     the order grid renders instantly when the user toggles between tabs.
 *     Invalidated automatically after a new order is created so 86'd items
 *     and price overrides refresh.
 */

import { ipcMain, app, shell, BrowserWindow } from "electron";
import type {
  IpcChannel, IpcContract, IpcEnvelope, SessionSnapshot,
  OrderKotPayload, OrderBillPayload, MenuCategory, MenuItem,
  OrderDetailView, OrderHeader, ZReportSummary, ShiftKpis,
} from "../../shared/ipc-contract";
import { ApiClient, ApiError, type ApiRestaurantDetail } from "../api/client";
import { sessionStore } from "../session-store";
import type { PrinterEngine } from "../printers";

/** Z-report cache contract — implemented in `main/index.ts` against
 *  electron-store with a 30-day retention sweep on every write. */
export interface ZReportCacheApi {
  list(): ZReportSummary[];
  get(sessionId: number): ZReportSummary | null;
  upsert(report: ZReportSummary): void;
}

interface SettingsApi {
  get: () => { apiBaseUrl: string };
  set: (patch: { apiBaseUrl?: string }) => { apiBaseUrl: string };
}

const MENU_CACHE_TTL_MS = 60_000;
interface MenuCacheEntry {
  at: number;
  categories: MenuCategory[];
  items: MenuItem[];
}

export function registerApiIpc(opts: {
  client: ApiClient;
  settings: SettingsApi;
  getWindow: () => BrowserWindow | null;
  printerEngine: PrinterEngine;
  zReportCache: ZReportCacheApi;
}): void {
  const { client, settings, getWindow, printerEngine, zReportCache } = opts;

  client.onAuthLost(() => {
    getWindow()?.webContents.send("auth:invalidated");
  });

  const menuCache = new Map<number, MenuCacheEntry>();
  function invalidateMenu(restaurantId?: number): void {
    if (restaurantId == null) menuCache.clear();
    else menuCache.delete(restaurantId);
  }

  async function loadMenuBundle(restaurantId: number, force = false): Promise<MenuCacheEntry> {
    const cached = menuCache.get(restaurantId);
    if (!force && cached && Date.now() - cached.at < MENU_CACHE_TTL_MS) return cached;
    const [categories, items] = await Promise.all([
      client.listCategories(restaurantId),
      client.listMenuItems(restaurantId, {}),
    ]);
    const entry: MenuCacheEntry = { at: Date.now(), categories, items };
    menuCache.set(restaurantId, entry);
    return entry;
  }

  function snapshot(): SessionSnapshot {
    const user = sessionStore.getUser();
    const tokens = sessionStore.getTokens();
    const sel = sessionStore.getSelection();
    const open = sessionStore.getOpenSession();
    return {
      auth: { isAuthenticated: !!user && !!tokens.accessToken, user },
      selection: sel,
      shift: { sessionId: open.id, openedAt: open.at },
    };
  }

  function handle<C extends IpcChannel>(
    channel: C,
    fn: (req: IpcContract[C]["req"]) => Promise<IpcContract[C]["res"]> | IpcContract[C]["res"],
  ): void {
    ipcMain.handle(channel, async (_e, req: IpcContract[C]["req"]): Promise<IpcEnvelope<IpcContract[C]["res"]>> => {
      try {
        const data = await fn(req);
        return { ok: true, data };
      } catch (err) {
        const message = err instanceof ApiError ? err.message
          : err instanceof Error ? err.message
          : String(err);
        return { ok: false, error: message };
      }
    });
  }

  function requireRestaurantId(): number {
    const sel = sessionStore.getSelection();
    const user = sessionStore.getUser();
    const id = sel.restaurantId ?? user?.restaurantId ?? null;
    if (!id) throw new Error("Pick a restaurant first.");
    return id;
  }

  function currentBranchId(): number | null {
    return sessionStore.getSelection().branchId ?? null;
  }

  // ─── App / settings / session snapshot ───────────────────────────────
  handle("settings:get", () => settings.get());
  handle("settings:set", (patch) => {
    const next = settings.set(patch);
    client.setBaseUrl(next.apiBaseUrl);
    invalidateMenu();
    return next;
  });
  handle("session:snapshot", () => snapshot());
  handle("session:clear-selection", () => {
    sessionStore.resetSelection();
    sessionStore.setOpenSession(null, null);
    invalidateMenu();
    return snapshot();
  });
  handle("app:version", () => ({ version: app.getVersion(), platform: process.platform }));
  handle("app:open-external", (url) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new Error("blocked");
    void shell.openExternal(url);
    return true as const;
  });

  // ─── Auth ────────────────────────────────────────────────────────────
  handle("auth:login", async ({ identifier, password, rememberDevice }) => {
    const r = await client.login(identifier, password);
    sessionStore.setTokens(r.accessToken, r.refreshToken);
    sessionStore.setUser(r.user);
    sessionStore.patchSelection({ rememberDevice: !!rememberDevice });
    if (r.user.restaurantId && !sessionStore.getSelection().restaurantId) {
      sessionStore.patchSelection({ restaurantId: r.user.restaurantId });
    }
    invalidateMenu();
    return { user: r.user };
  });

  handle("auth:refresh", async () => {
    const { refreshToken } = sessionStore.getTokens();
    if (!refreshToken) throw new Error("No refresh token");
    const r = await client.request<{ accessToken: string; refreshToken: string }>(
      "/api/auth/refresh",
      { method: "POST", body: { refreshToken }, noAuth: true },
    );
    sessionStore.setTokens(r.accessToken, r.refreshToken);
    return { ok: true as const };
  });

  handle("auth:logout", async () => {
    await client.logout();
    sessionStore.clearAll();
    sessionStore.resetSelection();
    invalidateMenu();
    return true as const;
  });

  handle("auth:me", async () => {
    const user = await client.me();
    sessionStore.setUser(user);
    return user;
  });

  // ─── Restaurants / branches / terminals ──────────────────────────────
  handle("restaurants:list", () => client.listRestaurants());
  handle("branches:list", ({ restaurantId }) => client.listBranches(restaurantId));
  handle("terminals:list", ({ restaurantId }) => client.listTerminals(restaurantId));

  // ─── Selection ───────────────────────────────────────────────────────
  handle("selection:set-restaurant", ({ restaurantId }) => {
    invalidateMenu();
    return sessionStore.patchSelection({
      restaurantId,
      branchId: null, branchName: null,
      counterId: null, counterName: null,
    });
  });
  handle("selection:set-branch", ({ branchId, branchName }) => {
    return sessionStore.patchSelection({
      branchId, branchName,
      counterId: null, counterName: null,
    });
  });
  handle("selection:set-counter", ({ counterId, counterName }) => {
    return sessionStore.patchSelection({ counterId, counterName });
  });

  // ─── Shifts ──────────────────────────────────────────────────────────
  handle("shifts:current", async () => {
    const r = await client.currentShift(requireRestaurantId());
    sessionStore.setOpenSession(r.session?.id ?? null, r.session?.openedAt ?? null);
    return r;
  });

  handle("shifts:open", async ({ openingCash, notes }) => {
    const session = await client.openShift(requireRestaurantId(), Number(openingCash) || 0, notes);
    sessionStore.setOpenSession(session.id, session.openedAt);
    return session;
  });

  handle("shifts:close", async (req) => {
    const restaurantId = requireRestaurantId();
    const closed = await client.closeShift(restaurantId, req.sessionId, {
      denominations: req.denominations,
      countedAmount: req.countedAmount,
      closeNotes: req.closeNotes,
      isBlindClose: req.isBlindClose,
      varianceReason: req.varianceReason,
      managerPin: req.managerPin,
    });
    sessionStore.setOpenSession(null, null);

    // Pull the post-close Z-report — server now has the closing totals locked
    // in. We fall back to the response from `close` if the Z-report endpoint
    // 404s on an older server build.
    let zReport: ZReportSummary;
    try {
      const z = await client.getZReport(restaurantId, req.sessionId);
      zReport = {
        sessionId: req.sessionId,
        restaurantId,
        openedAt: z.session.openedAt,
        closedAt: z.session.closedAt ?? new Date().toISOString(),
        openedByName: z.openedByName ?? null,
        closedByName: z.closedByName ?? null,
        openingFloat: Number(z.totals.openingFloat) || 0,
        cashSales: Number(z.totals.cashSales) || 0,
        totalCashIn: Number(z.totals.totalCashIn) || 0,
        totalCashOut: Number(z.totals.totalCashOut) || 0,
        expectedCash: z.totals.expectedCash != null ? Number(z.totals.expectedCash) : null,
        countedCash: z.totals.actualCash != null ? Number(z.totals.actualCash) : null,
        overShort: z.totals.overShort != null ? Number(z.totals.overShort) : null,
        isBlindClose: !!z.session.isBlindClose,
        varianceReason: z.session.varianceReason ?? null,
        closeNotes: z.session.closeNotes ?? null,
        orderCount: Number(z.orderCount) || 0,
        grossRevenue: Number(z.grossRevenue) || 0,
        tenderSummary: Object.entries(z.tenderSummary ?? {}).map(([method, v]) => ({
          method,
          in: Number(v?.in) || 0,
          out: Number(v?.out) || 0,
          count: Number(v?.count) || 0,
        })),
        denominations: req.denominations,
        cachedAt: Date.now(),
      };
    } catch (err) {
      console.warn("[shifts:close] z-report fetch failed:", (err as Error).message);
      zReport = {
        sessionId: req.sessionId,
        restaurantId,
        openedAt: new Date(0).toISOString(),
        closedAt: closed.session?.closedAt ?? new Date().toISOString(),
        openingFloat: Number(closed.totals?.openingFloat) || 0,
        cashSales: 0,
        totalCashIn: Number(closed.totals?.totalCashIn ?? 0) || 0,
        totalCashOut: Number(closed.totals?.totalCashOut ?? 0) || 0,
        expectedCash: closed.totals?.expectedCash != null ? Number(closed.totals.expectedCash) : null,
        countedCash: closed.totals?.actualCash != null ? Number(closed.totals.actualCash) : null,
        overShort: closed.totals?.overShort != null ? Number(closed.totals.overShort) : null,
        isBlindClose: !!closed.session?.isBlindClose,
        varianceReason: closed.session?.varianceReason ?? null,
        closeNotes: req.closeNotes ?? null,
        orderCount: 0,
        grossRevenue: 0,
        tenderSummary: [],
        denominations: req.denominations,
        cachedAt: Date.now(),
      };
    }
    zReportCache.upsert(zReport);

    // Auto-print the Z-report if a bill printer is wired. Non-fatal.
    try { await dispatchZReportPrint(zReport, printerEngine); }
    catch (err) { console.warn("[shifts:close] Z-report auto-print failed:", (err as Error).message); }

    return { zReport, blindClose: !!closed.blindClose || !!req.isBlindClose };
  });

  // ─── Menu ────────────────────────────────────────────────────────────
  handle("menu:restaurant", async () => client.getRestaurantInfo(requireRestaurantId()));

  handle("menu:list", async (req) => {
    const force = !!(req && typeof req === "object" && "force" in req && (req as { force?: boolean }).force);
    const bundle = await loadMenuBundle(requireRestaurantId(), force);
    return { categories: bundle.categories, items: bundle.items };
  });

  handle("menu:categories", async () => {
    const bundle = await loadMenuBundle(requireRestaurantId());
    return bundle.categories;
  });

  handle("menu:items", async ({ categoryId, search }) => {
    // When no filters, serve the cached bundle's items so the grid is instant.
    if (categoryId == null && !search) {
      const bundle = await loadMenuBundle(requireRestaurantId());
      return bundle.items;
    }
    return client.listMenuItems(requireRestaurantId(), { categoryId, search });
  });

  handle("menu:modifiers", async ({ menuItemId }) => {
    return client.listItemModifierGroups(Number(menuItemId));
  });

  // ─── Tables ──────────────────────────────────────────────────────────
  handle("tables:list", async () => client.listTables(requireRestaurantId()));
  handle("tables:active-order", async ({ tableId }) => {
    const id = await client.getTableActiveOrderId(requireRestaurantId(), Number(tableId));
    return { orderId: id };
  });

  // ─── Customers ───────────────────────────────────────────────────────
  handle("customers:search", async ({ search, limit }) => {
    return client.searchCustomers(requireRestaurantId(), String(search ?? "").trim(), limit ?? 20);
  });
  handle("customers:create", async (body) => {
    return client.createCustomer(requireRestaurantId(), body);
  });
  handle("customers:lookup", async (req) => {
    const restaurantId = requireRestaurantId();
    const phone = typeof req === "object" && req && "phone" in req ? (req as any).phone : null;
    const query = typeof req === "object" && req && "query" in req ? (req as any).query : null;
    const term = (phone ?? query ?? "").trim();

    if (!term) {
      if (phone) throw new Error("phone required");
      return [];
    }

    // If it's the Phase 3 lookup-by-phone (returning single object)
    if (phone && !query) {
      return client.lookupCustomerByPhone(restaurantId, term) as Promise<IpcContract["customers:lookup"]["res"]>;
    }

    // If it's the Phase 2 search-style lookup
    return client.searchCustomers(restaurantId, term, 10);
  });

  handle("menu:lookup-by-barcode", async (req) => {
    const restaurantId = requireRestaurantId();
    const code = String(req?.code ?? "").trim();
    if (!code) throw new Error("code required");
    return client.lookupMenuItemByCode(restaurantId, code);
  });

  // ─── Orders ──────────────────────────────────────────────────────────
  handle("orders:list", async ({ status, limit } = {}) => {
    return client.listOrders(requireRestaurantId(), {
      status, limit: limit ?? 30, branchId: currentBranchId(),
    });
  });

  handle("orders:detail", async ({ id }) => client.getOrder(requireRestaurantId(), Number(id)));

  handle("orders:create", async (req) => {
    const restaurantId = requireRestaurantId();
    const body = { branchId: currentBranchId(), ...req };
    const order = await client.createOrder(restaurantId, body);

    // Phase 2: invalidate menu cache
    invalidateMenu(restaurantId);

    // Phase 3: auto-print KOTs
    try {
      const kotPayload = buildKotPayload(order);
      if (kotPayload.items.length > 0) {
        await printerEngine.dispatchKots(kotPayload);
      }
    } catch (err) {
      console.warn("[orders:create] KOT auto-print failed:", (err as Error).message);
    }

    return order;
  });

  handle("orders:add-items", async ({ orderId, items, idempotencyKey }) => {
    const detail = await client.addOrderItems(
      requireRestaurantId(), Number(orderId), items ?? [], idempotencyKey,
    );
    invalidateMenu(requireRestaurantId());
    return detail;
  });

  handle("orders:update", async ({ id, patch }) => {
    return client.patchOrder(requireRestaurantId(), Number(id), patch);
  });

  // ─── Bill print by order id (main fetches the data) ──────────────────
  handle("printers:print-bill-for-order", async (req) => {
    const restaurantId = requireRestaurantId();
    const [order, outlet] = await Promise.all([
      client.getOrder(restaurantId, req.orderId),
      client.getRestaurant(restaurantId).catch(() => null),
    ]);
    const payload = buildBillPayload(order, outlet, {
      openDrawer: !!req.openDrawer,
      copies: req.copies,
    });
    const r = await printerEngine.dispatchBill(payload);
    if (!r.ok) throw new Error(r.error);
    return true as const;
  });

  // ─── Discounts ───────────────────────────────────────────────────────
  handle("discounts:config", async () => client.loadDiscountsConfig(requireRestaurantId()));
  handle("discounts:apply", async (req) => client.applyDiscount(requireRestaurantId(), req));
  handle("discounts:remove", async ({ orderId, discountId, idempotencyKey }) => {
    return client.removeDiscount(
      requireRestaurantId(), Number(orderId), Number(discountId), idempotencyKey,
    );
  });

  // ─── Phase 4: payments / split ───────────────────────────────────────
  handle("payments:record", () => { throw new Error("payments:record deprecated — use orders:pay"); });

  handle("payments:stripe-intent", async ({ orderId, customAmount, tipAmount }) => {
    return client.createStripeIntent(requireRestaurantId(), Number(orderId), {
      customAmount, tipAmount,
    });
  });

  handle("payments:razorpay-order", async ({ orderId, customAmount, tipAmount }) => {
    return client.createRazorpayOrder(requireRestaurantId(), Number(orderId), {
      customAmount, tipAmount,
    });
  });

  handle("payments:terminal-charge", async ({ terminalDeviceId, orderId, amount, tipAmount }) => {
    return client.terminalCharge(requireRestaurantId(), Number(terminalDeviceId), {
      orderId: Number(orderId), amount: Number(amount), tipAmount,
    });
  });

  handle("payments:terminal-confirm", async ({ terminalDeviceId, orderId, paymentIntentId }) => {
    return client.terminalConfirm(requireRestaurantId(), Number(terminalDeviceId), {
      orderId: Number(orderId), paymentIntentId,
    });
  });

  handle("orders:pay", async (req) => {
    const restaurantId = requireRestaurantId();
    const detail = await client.payOrder(restaurantId, Number(req.orderId), {
      paymentMethod: req.paymentMethod,
      tipAmount: req.tipAmount,
      stripePaymentIntentId: req.stripePaymentIntentId,
      razorpayPaymentId: req.razorpayPaymentId,
      razorpayOrderId: req.razorpayOrderId,
      razorpaySignature: req.razorpaySignature,
    }, req.idempotencyKey);

    // Auto-print bill + drawer kick on success. The drawer only kicks for
    // cash tenders — UPI/card don't need the till to open.
    try {
      const outlet = await client.getRestaurant(restaurantId).catch(() => null);
      const payload = buildBillPayload(detail, outlet, {
        openDrawer: req.paymentMethod === "cash",
        copies: 1,
      });
      const r = await printerEngine.dispatchBill(payload);
      if (!r.ok) console.warn("[orders:pay] bill print failed:", r.error);
    } catch (err) {
      console.warn("[orders:pay] bill print threw:", (err as Error).message);
    }
    return detail;
  });

  handle("orders:split", async ({ orderId, legs, idempotencyKey }) => {
    const restaurantId = requireRestaurantId();
    const detail = await client.splitOrder(restaurantId, Number(orderId), legs, idempotencyKey);
    try {
      const outlet = await client.getRestaurant(restaurantId).catch(() => null);
      const hasCash = legs.some((l) => l.paymentMethod === "cash");
      const payload = buildBillPayload(detail, outlet, { openDrawer: hasCash, copies: 1 });
      const r = await printerEngine.dispatchBill(payload);
      if (!r.ok) console.warn("[orders:split] bill print failed:", r.error);
    } catch (err) {
      console.warn("[orders:split] bill print threw:", (err as Error).message);
    }
    return detail;
  });

  // ─── Reports — derived from orders.list within the open shift window ─────
  handle("reports:shift-kpis", async ({ sessionId }) => {
    const restaurantId = requireRestaurantId();
    const open = sessionStore.getOpenSession();
    const openedAt = open.id === sessionId && open.at
      ? open.at
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const orders = await client.listOrdersInRange(restaurantId, {
      from: openedAt,
      branchId: currentBranchId(),
      limit: 500,
    });
    return rollupKpis(sessionId, openedAt, orders);
  });

  // ─── Z-report cache + reprint ─────────────────────────────────────────
  handle("zReports:list", () => zReportCache.list());
  handle("zReports:get", ({ sessionId }) => zReportCache.get(Number(sessionId)));
  handle("zReports:reprint", async ({ sessionId }) => {
    const cached = zReportCache.get(Number(sessionId));
    if (!cached) throw new Error("No cached Z-report for that shift (older than 30 days?).");
    await dispatchZReportPrint(cached, printerEngine);
    return true as const;
  });
  handle("printers:print-z-report", async (report) => {
    await dispatchZReportPrint(report, printerEngine);
    return true as const;
  });
}

// ─── Payload builders (API → ESC/POS DTO) ──────────────────────────────────
function num(v: number | string | null | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}

function buildKotPayload(order: OrderDetailView): OrderKotPayload {
  return {
    orderNumber: order.orderNumber,
    orderType: order.orderType ?? null,
    tableLabel: order.tableLabel ?? null,
    createdAt: order.createdAt ?? null,
    outletName: null,
    items: order.items.map((it) => ({
      name: it.menuItemName,
      quantity: Number(it.quantity) || 1,
      notes: it.notes ?? null,
      kitchenId: it.kitchenId ?? null,
      kitchenName: it.kitchenName ?? null,
      modifiers: (it.modifiers ?? []).map((m) => ({ name: m.name })),
    })),
  };
}

function buildBillPayload(
  order: OrderDetailView,
  outlet: ApiRestaurantDetail | null,
  extra: { openDrawer: boolean; copies?: number },
): OrderBillPayload {
  const payload: OrderBillPayload = {
    orderNumber: order.orderNumber,
    orderType: order.orderType ?? null,
    tableLabel: order.tableLabel ?? null,
    createdAt: order.createdAt ?? null,
    customerName: order.customerName ?? null,
    customerPhone: order.customerPhone ?? null,
    items: order.items.map((it) => ({
      name: it.menuItemName,
      quantity: Number(it.quantity) || 1,
      unitPrice: num(it.unitPrice),
      lineTotal: num(it.totalPrice),
      notes: it.notes ?? null,
      modifiers: (it.modifiers ?? []).map((m) => ({ name: m.name, price: num(m.price) })),
    })),
    subtotal: num(order.subtotal),
    taxAmount: num(order.taxAmount),
    serviceCharge: num(order.serviceCharge),
    discountAmount: num(order.discountAmount),
    totalAmount: num(order.totalAmount),
    discounts: (order.discounts ?? []).map((d) => ({
      label: d.reason || d.couponCode || d.type || "Discount",
      amount: num(d.amount),
    })),
    taxBreakdown: [],
    openDrawer: !!extra.openDrawer,
    copies: extra.copies ?? 1,
    footer: outlet?.receiptFooter ?? null,
  };
  if (order.paymentMethod) {
    const tendered = order.paymentAmount != null ? num(order.paymentAmount) : undefined;
    payload.payment = tendered != null
      ? { method: order.paymentMethod, tendered }
      : { method: order.paymentMethod };
  }
  if (outlet) {
    payload.restaurant = {
      name: outlet.name,
      address: outlet.address ?? null,
      phone: outlet.phone ?? null,
      gstin: outlet.gstin ?? null,
      fssaiLicense: outlet.fssaiLicense ?? null,
      upiId: outlet.upiId ?? null,
    };
  }
  return payload;
}

// ─── Z-report printing — ESC/POS formatter via the bill pipeline ─────────────
async function dispatchZReportPrint(z: ZReportSummary, printerEngine: PrinterEngine): Promise<void> {
  // Reuse the bill formatter by faking a "Z REPORT" order: the same printer
  // path handles totals + footer + openDrawer.
  const items: OrderBillPayload["items"] = z.tenderSummary.map((t) => ({
    name: `Tender · ${t.method}`,
    quantity: t.count,
    unitPrice: 0,
    lineTotal: t.in - t.out,
    notes: null,
  }));
  if (z.openingFloat > 0) {
    items.unshift({ name: "Opening float", quantity: 1, unitPrice: z.openingFloat, lineTotal: z.openingFloat, notes: null });
  }
  if (z.denominations && z.denominations.length > 0) {
    for (const d of z.denominations) {
      items.push({
        name: `₹${d.denomination} × ${d.count}`,
        quantity: d.count,
        unitPrice: d.denomination,
        lineTotal: d.denomination * d.count,
        notes: null,
      });
    }
  }
  const footerLines = [
    `Opening float: ₹${z.openingFloat.toFixed(2)}`,
    `Cash sales:    ₹${z.cashSales.toFixed(2)}`,
    `Cash in/out:   ₹${z.totalCashIn.toFixed(2)} / ₹${z.totalCashOut.toFixed(2)}`,
    `Expected:      ${z.expectedCash != null ? `₹${z.expectedCash.toFixed(2)}` : "—"}`,
    `Counted:       ${z.countedCash != null ? `₹${z.countedCash.toFixed(2)}` : "—"}`,
    `Over/Short:    ${z.overShort != null ? `₹${z.overShort.toFixed(2)}` : "—"}`,
    z.isBlindClose ? "(blind close)" : "",
    z.varianceReason ? `Variance: ${z.varianceReason}` : "",
    z.closeNotes ? `Notes: ${z.closeNotes}` : "",
  ].filter(Boolean).join("\n");

  const payload: OrderBillPayload = {
    orderNumber: `Z-${z.sessionId}`,
    orderType: "Z REPORT",
    tableLabel: null,
    createdAt: z.closedAt,
    customerName: z.closedByName ?? null,
    customerPhone: null,
    items,
    subtotal: z.grossRevenue,
    taxAmount: 0,
    serviceCharge: 0,
    discountAmount: 0,
    totalAmount: z.expectedCash ?? z.grossRevenue,
    discounts: [],
    taxBreakdown: [],
    openDrawer: false,
    copies: 1,
    footer: footerLines,
  };
  const r = await printerEngine.dispatchBill(payload);
  if (!r.ok) throw new Error(r.error);
}

// ─── Shift KPI roll-up ─────────────────────────────────────────────────────
function rollupKpis(sessionId: number, openedAt: string, orders: OrderHeader[]): ShiftKpis {
  const since = new Date(openedAt).getTime();
  const inWindow = orders.filter((o) => {
    const t = new Date(o.createdAt).getTime();
    return Number.isFinite(t) && t >= since;
  });
  let gross = 0, tax = 0, service = 0, discount = 0, tips = 0;
  let paid = 0, unpaid = 0, voided = 0;
  const byMethod = new Map<string, { amount: number; count: number }>();
  for (const o of inWindow) {
    const total = num(o.totalAmount);
    gross += total;
    tax += num(o.taxAmount);
    service += num(o.serviceCharge);
    discount += num(o.discountAmount);
    tips += num(o.tipAmount);
    const status = String(o.paymentStatus ?? "").toLowerCase();
    const orderStatus = String(o.status ?? "").toLowerCase();
    if (orderStatus === "cancelled" || orderStatus === "voided") voided++;
    else if (status === "paid") paid++;
    else unpaid++;
    if (status === "paid") {
      const m = (o.paymentMethod || "unknown").toLowerCase();
      const cur = byMethod.get(m) ?? { amount: 0, count: 0 };
      cur.amount += num(o.paymentAmount) || total;
      cur.count += 1;
      byMethod.set(m, cur);
    }
  }
  return {
    sessionId,
    openedAt,
    orderCount: inWindow.length,
    paidCount: paid,
    unpaidCount: unpaid,
    voidedCount: voided,
    grossRevenue: gross,
    netRevenue: gross - tax - service,
    taxCollected: tax,
    serviceCollected: service,
    discountTotal: discount,
    tipsCollected: tips,
    byMethod: Array.from(byMethod.entries()).map(([method, v]) => ({ method, amount: v.amount, count: v.count })),
    averageTicket: paid > 0 ? gross / paid : 0,
    generatedAt: new Date().toISOString(),
  };
}
