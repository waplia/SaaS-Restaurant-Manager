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
  SyncStatusView, ConflictEntry, LocalStoreInfo, ConflictDiff,
  HeldBillRecord, CashMovementRecord, ExpenseRecord, StockActionRecord,
  AuditLogRecord, PrintJobRecord, SyncLogEntry,
} from "../../shared/ipc-contract";
import { ApiClient, ApiError, type ApiRestaurantDetail } from "../api/client";
import { sessionStore } from "../session-store";
import type { PrinterEngine } from "../printers";
import * as Offline from "./offline";
import { shortOrderNumber } from "../../shared/orderNumber";
import type { Connectivity } from "../sync/connectivity";
import type { SyncEngine } from "../sync/engine";
import { hydrateAll } from "../sync/hydrate";
import * as P from "../db/pending";
import * as D from "../db/domain";
import { dbStats, resetDb, getDb } from "../db";
import { countAll, kvGet, kvSet } from "../db/queries";
import { randomUUID } from "node:crypto";

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
  connectivity: Connectivity;
  syncEngine: SyncEngine;
}): void {
  const { client, settings, getWindow, printerEngine, zReportCache, connectivity, syncEngine } = opts;

  const offlineCtx: Offline.OfflineContext = {
    client,
    isOnline: () => connectivity.current().online,
    restaurantId: () => requireRestaurantId(),
    branchId: () => currentBranchId(),
    triggerSync: () => { void syncEngine.drain(); },
    awaitDrain: (timeoutMs?: number) => syncEngine.awaitDrain(timeoutMs),
  };

  // Broadcast connectivity + sync changes to the renderer.
  connectivity.on("change", (state) => {
    getWindow()?.webContents.send("connectivity:state", state);
    // When we come back online, drain immediately.
    if (state.online) void syncEngine.drain();
  });
  connectivity.on("probe", (state) => {
    getWindow()?.webContents.send("connectivity:state", state);
  });
  syncEngine.on("status", () => {
    getWindow()?.webContents.send("sync:status-changed");
  });

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
    // Offline login gate (Phase 5+): only allowed when the device has
    // previously authenticated AND the typed password verifies against a
    // locally cached scrypt hash of the last password the same cashier
    // used online. A first-time login (or a password we never captured)
    // must hit the server. Identifier-match alone is *not* sufficient —
    // otherwise anyone who knows a cashier's email could unlock the till.
    if (!connectivity.current().online) {
      const cachedUser = sessionStore.getUser();
      const { refreshToken } = sessionStore.getTokens();
      const cred = sessionStore.getOfflineCredential();
      if (!cachedUser || !refreshToken || !cred) {
        throw new Error("First-time sign in requires an internet connection.");
      }
      const typedIdentifier = String(identifier ?? "");
      const typedPassword = String(password ?? "");
      if (!sessionStore.verifyOfflineCredential(typedIdentifier, typedPassword)) {
        // Audit the failure so a brute-force attempt is visible the next
        // time the device is online. Identifier is logged lowercase, the
        // password is NEVER stored or logged.
        D.insertAuditLog({
          at: Date.now(), actor: cachedUser.email ?? cachedUser.name,
          action: "auth:offline-login-denied", target: null,
          details: { identifier: typedIdentifier.trim().toLowerCase() },
        });
        throw new Error("Offline sign in failed — wrong identifier or password.");
      }
      D.insertAuditLog({
        at: Date.now(), actor: cachedUser.email ?? cachedUser.name,
        action: "auth:offline-login", target: null,
        details: { identifier: typedIdentifier.trim().toLowerCase() },
      });
      return { user: cachedUser };
    }
    const r = await client.login(identifier, password);
    sessionStore.setTokens(r.accessToken, r.refreshToken);
    sessionStore.setUser(r.user);
    // Cache a scrypt hash of the just-verified password so the same
    // cashier can sign in offline next time the network drops. The
    // server has already validated the credentials at this point — we
    // are simply mirroring the check locally for future replays.
    sessionStore.setOfflineCredential(identifier, password);
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

  // Plan / subscription gating — returns the enabled feature flags so
  // the renderer shell can hide plan-locked nav items rather than
  // showing them and 403-ing inside the embedded webview. Uses the
  // authenticated ApiClient (token attachment + refresh).
  handle("plan:features", async ({ restaurantId }) => {
    try {
      const sub = await client.request<{
        plan?: { name?: string | null; featureFlags?: Record<string, boolean> | null } | null;
      }>(`/api/restaurants/${restaurantId}/subscription`);
      const flags = sub?.plan?.featureFlags ?? null;
      const features: string[] = [];
      if (flags && typeof flags === "object") {
        for (const [k, v] of Object.entries(flags)) {
          if (v === true) features.push(k);
        }
      }
      return { features, planName: sub?.plan?.name ?? null };
    } catch {
      // Fail-closed: an unreachable subscription endpoint means we
      // can't prove a feature is enabled, so the shell will hide
      // every gated module (which is what the task requires).
      return { features: [], planName: null };
    }
  });

  // ─── Restaurants / branches / terminals ──────────────────────────────
  handle("restaurants:list", () => client.listRestaurants());
  handle("branches:list", ({ restaurantId }) => client.listBranches(restaurantId));
  handle("terminals:list", async ({ restaurantId }) => {
    // Local-first; backgrounded refresh when online.
    const cached = kvGet(`terminals:${restaurantId}`);
    if (cached) {
      if (connectivity.current().online) {
        void client.listTerminals(restaurantId)
          .then((t) => kvSet(`terminals:${restaurantId}`, JSON.stringify(t)))
          .catch(() => undefined);
      }
      try { return JSON.parse(cached); } catch { /* fallthrough */ }
    }
    if (!connectivity.current().online) return [];
    const fresh = await client.listTerminals(restaurantId);
    kvSet(`terminals:${restaurantId}`, JSON.stringify(fresh));
    return fresh;
  });

  // ─── Selection ───────────────────────────────────────────────────────
  handle("selection:set-restaurant", ({ restaurantId }) => {
    invalidateMenu();
    // NOTE: counterId/counterName intentionally NOT reset — the counter is
    // the physical machine, not the outlet. A single desktop install
    // keeps its counter identity across outlet switches.
    const result = sessionStore.patchSelection({
      restaurantId,
      branchId: null, branchName: null,
    });
    if (restaurantId != null && connectivity.current().online) {
      void hydrateAll(client, restaurantId).catch((err) =>
        console.warn("[hydrate:on-select] failed:", (err as Error).message));
    }
    return result;
  });
  handle("selection:set-branch", ({ branchId, branchName }) => {
    // Same reasoning as above — keep counter identity across branch switches.
    return sessionStore.patchSelection({ branchId, branchName });
  });
  handle("selection:set-counter", ({ counterId, counterName }) => {
    return sessionStore.patchSelection({ counterId, counterName });
  });
  handle("selection:register-local-counter", ({ counterName }) => {
    const trimmed = (counterName ?? "").trim() || "Counter 1";
    const existing = sessionStore.getSelection().counterId;
    // Reuse the existing machine UUID if we already minted one — only the
    // display name changes on re-registration. This keeps the counter's
    // identity stable across re-opens of the "rename" screen.
    const counterId = existing ?? (() => {
      const { randomUUID } = require("node:crypto") as typeof import("node:crypto");
      return `local-${randomUUID()}`;
    })();
    return sessionStore.patchSelection({ counterId, counterName: trimmed });
  });
  handle("selection:suggest-counter-name", () => {
    const os = require("node:os") as typeof import("node:os");
    const existing = sessionStore.getSelection().counterName;
    const host = (os.hostname?.() ?? "").split(".")[0]?.trim() || "Counter 1";
    return { suggestion: host, existingName: existing ?? null };
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
    // Phase 5 — block a normal close while sync ops are still pending so the
    // shift Z-report can't lie about totals. A manager PIN forces the close
    // and leaves the queue in place (it drains when the next shift opens).
    const pending = P.pendingCount();
    if (pending > 0 && !req.managerPin) {
      throw new Error(`${pending} change${pending === 1 ? "" : "s"} still syncing. Wait for sync to finish, or enter a manager PIN to force-close.`);
    }
    if (!connectivity.current().online) {
      throw new Error("Cannot close a shift while offline — totals must be reconciled with the server.");
    }
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
  handle("menu:restaurant", () => Offline.getRestaurantInfo(offlineCtx));

  handle("menu:list", async () => Offline.listMenuBundle(offlineCtx));

  handle("menu:categories", async () => (await Offline.listMenuBundle(offlineCtx)).categories);

  handle("menu:items", async ({ categoryId, search }) => {
    const bundle = await Offline.listMenuBundle(offlineCtx);
    if (categoryId == null && !search) return bundle.items;
    const q = (search ?? "").trim().toLowerCase();
    return bundle.items.filter((it) =>
      (categoryId == null || it.categoryId === categoryId) &&
      (!q || it.name.toLowerCase().includes(q))
    );
  });

  handle("menu:modifiers", async ({ menuItemId }) =>
    Offline.listModifierGroups(offlineCtx, Number(menuItemId)));

  // ─── Tables ──────────────────────────────────────────────────────────
  handle("tables:list", () => Offline.listTables(offlineCtx));
  handle("tables:active-order", async ({ tableId }) => {
    const id = await Offline.getActiveTableOrderId(offlineCtx, Number(tableId));
    return { orderId: id };
  });

  // ─── Customers ───────────────────────────────────────────────────────
  handle("customers:search", ({ search, limit }) =>
    Offline.searchCustomers(offlineCtx, String(search ?? "").trim(), limit ?? 20));
  handle("customers:create", (body) => Offline.createCustomer(offlineCtx, body));
  handle("customers:lookup", async (req) => {
    const phone = typeof req === "object" && req && "phone" in req ? (req as { phone?: string }).phone : null;
    const query = typeof req === "object" && req && "query" in req ? (req as { query?: string }).query : null;
    const term = (phone ?? query ?? "").trim();
    if (!term) {
      if (phone) throw new Error("phone required");
      return [];
    }
    if (phone && !query) return Offline.lookupCustomerByPhone(offlineCtx, term);
    return Offline.searchCustomers(offlineCtx, term, 10);
  });

  handle("menu:lookup-by-barcode", async (req) => {
    const restaurantId = requireRestaurantId();
    const code = String(req?.code ?? "").trim();
    if (!code) throw new Error("code required");
    return client.lookupMenuItemByCode(restaurantId, code);
  });

  // ─── Orders ──────────────────────────────────────────────────────────
  handle("orders:list", ({ status, limit } = { status: undefined, limit: undefined }) =>
    Offline.listOrders(offlineCtx, status, limit ?? 30));

  handle("orders:detail", ({ id }) => Offline.getOrderDetail(offlineCtx, Number(id)));

  handle("orders:create", async (req) => {
    const restaurantId = requireRestaurantId();
    const order = await Offline.createOrder(offlineCtx, req);
    invalidateMenu(restaurantId);
    // KOT auto-print runs against the local order payload (server-confirmed
    // or local-only). The kitchen needs the ticket the moment the cashier
    // confirms the cart — the printer is hardware-local, so this works
    // regardless of network state. The KOT carries the local order number
    // (e.g. "L-000123") which is harmless on a paper slip.
    try {
      const kotPayload = buildKotPayload(order);
      if (kotPayload.items.length > 0) await printerEngine.dispatchKots(kotPayload);
    } catch (err) {
      console.warn("[orders:create] KOT auto-print failed:", (err as Error).message);
    }
    return order;
  });

  handle("orders:add-items", async (args) => {
    const detail = await Offline.addOrderItems(offlineCtx, args);
    invalidateMenu(requireRestaurantId());
    return detail;
  });

  handle("orders:update", async ({ id, patch }) => {
    return client.patchOrder(requireRestaurantId(), Number(id), patch);
  });

  // ─── Bill print by order id (main fetches the data) ──────────────────
  handle("printers:print-bill-for-order", async (req) => {
    const restaurantId = requireRestaurantId();
    // Local-first: serve order + outlet from cache so bill reprints work
    // during an outage. Fall back to the API only when the cache misses.
    const order = await Offline.getOrderDetail(offlineCtx, Number(req.orderId));
    const outlet = await client.getRestaurant(restaurantId).catch(() => null);
    const payload = buildBillPayload(order, outlet, {
      openDrawer: !!req.openDrawer,
      copies: req.copies,
      restaurantId,
    });
    const r = await printerEngine.dispatchBill(payload);
    if (!r.ok) throw new Error(r.error);
    return true as const;
  });

  // ─── Discounts ───────────────────────────────────────────────────────
  handle("discounts:config", async () => {
    const rid = requireRestaurantId();
    const cached = kvGet(`discounts:${rid}`);
    if (cached) {
      if (connectivity.current().online) {
        void client.loadDiscountsConfig(rid)
          .then((d) => kvSet(`discounts:${rid}`, JSON.stringify(d)))
          .catch(() => undefined);
      }
      try { return JSON.parse(cached); } catch { /* fallthrough */ }
    }
    if (!connectivity.current().online) {
      // Empty discounts config so the UI still renders.
      return { rules: [], coupons: [] } as unknown;
    }
    const fresh = await client.loadDiscountsConfig(rid);
    kvSet(`discounts:${rid}`, JSON.stringify(fresh));
    return fresh;
  });
  handle("discounts:apply", async (req) => client.applyDiscount(requireRestaurantId(), req));
  handle("discounts:remove", async ({ orderId, discountId, idempotencyKey }) => {
    return client.removeDiscount(
      requireRestaurantId(), Number(orderId), Number(discountId), idempotencyKey,
    );
  });

  // ─── Phase 4: payments / split ───────────────────────────────────────
  // Offline guard: non-cash payment provider calls (Stripe, Razorpay,
  // card-on-terminal) require a live network round-trip — there is no
  // safe local replay because the cashier is waiting on a tap/swipe/UPI
  // confirmation in real time. Surface a clean message instead of letting
  // the API call fail later with a generic network error.
  function requireOnline(label: string): void {
    if (!connectivity.current().online) {
      throw new Error(`${label} requires an internet connection.`);
    }
  }

  /** Trusted-layer permission gate. The renderer UI also hides these
   *  actions for non-managers, but a malicious renderer / dev-tools call
   *  must not be able to bypass them — so we re-check here in the main
   *  process before mutating local state. */
  function requireManager(label: string): void {
    const role = (sessionStore.getUser()?.role ?? "").toLowerCase();
    if (role !== "owner" && role !== "manager" && role !== "admin") {
      throw new Error(`${label} requires manager or owner permission.`);
    }
  }

  handle("payments:record", () => { throw new Error("payments:record deprecated — use orders:pay"); });

  handle("payments:stripe-intent", async ({ orderId, customAmount, tipAmount }) => {
    requireOnline("Card payment");
    return client.createStripeIntent(requireRestaurantId(), Number(orderId), {
      customAmount, tipAmount,
    });
  });

  handle("payments:razorpay-order", async ({ orderId, customAmount, tipAmount }) => {
    requireOnline("UPI / Razorpay payment");
    return client.createRazorpayOrder(requireRestaurantId(), Number(orderId), {
      customAmount, tipAmount,
    });
  });

  handle("payments:terminal-charge", async ({ terminalDeviceId, orderId, amount, tipAmount }) => {
    requireOnline("Card terminal charge");
    return client.terminalCharge(requireRestaurantId(), Number(terminalDeviceId), {
      orderId: Number(orderId), amount: Number(amount), tipAmount,
    });
  });

  handle("payments:terminal-confirm", async ({ terminalDeviceId, orderId, paymentIntentId }) => {
    requireOnline("Card terminal confirmation");
    return client.terminalConfirm(requireRestaurantId(), Number(terminalDeviceId), {
      orderId: Number(orderId), paymentIntentId,
    });
  });

  handle("orders:pay", async (req) => {
    const restaurantId = requireRestaurantId();
    const detail = await Offline.payOrder(offlineCtx, {
      orderId: Number(req.orderId),
      paymentMethod: req.paymentMethod,
      tipAmount: req.tipAmount,
      stripePaymentIntentId: req.stripePaymentIntentId,
      razorpayPaymentId: req.razorpayPaymentId,
      razorpayOrderId: req.razorpayOrderId,
      razorpaySignature: req.razorpaySignature,
      idempotencyKey: req.idempotencyKey,
    });

    // Auto-print bill + drawer kick on success. The drawer only kicks for
    // cash tenders — UPI/card don't need the till to open. Print works
    // offline because the formatter doesn't need the network.
    try {
      const outlet = connectivity.current().online
        ? await client.getRestaurant(restaurantId).catch(() => null)
        : null;
      const payload = buildBillPayload(detail, outlet, {
        openDrawer: req.paymentMethod === "cash",
        copies: 1,
        restaurantId,
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
      const payload = buildBillPayload(detail, outlet, { openDrawer: hasCash, copies: 1, restaurantId });
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

  // ─── Phase 5 — connectivity / sync / local cache ─────────────────────
  function buildSyncStatusView(): SyncStatusView {
    const s = syncEngine.status();
    const rid = sessionStore.getSelection().restaurantId ?? sessionStore.getUser()?.restaurantId ?? null;
    return Offline.buildSyncStatus(
      connectivity.current().online,
      s.draining,
      s.lastRunAt,
      s.lastError,
      { restaurantId: rid },
    );
  }

  handle("connectivity:get", () => connectivity.current());
  handle("connectivity:probe", () => connectivity.probe());
  handle("sync:status", () => buildSyncStatusView());
  handle("sync:run-now", async () => {
    await connectivity.probe();
    await syncEngine.drain();
    return buildSyncStatusView();
  });
  handle("sync:conflicts:list", (): ConflictEntry[] => P.listConflicts());
  handle("sync:conflicts:resolve", ({ id, action }) => {
    P.resolveConflict(Number(id), action);
    if (action === "retry") void syncEngine.drain();
    return P.listConflicts();
  });
  handle("local:info", (): LocalStoreInfo => {
    const stats = dbStats();
    const rid = sessionStore.getSelection().restaurantId ?? sessionStore.getUser()?.restaurantId ?? null;
    const lastAt = rid ? Number(kvGet(`hydrate:lastAt:${rid}`) ?? "0") || null : null;
    return {
      path: stats.path,
      sizeBytes: stats.sizeBytes,
      counts: countAll(),
      hydrateLastAt: lastAt,
    };
  });
  handle("local:reset", ({ confirm }) => {
    if (!confirm) throw new Error("local:reset requires { confirm: true }");
    resetDb();
    // Force a fresh schema build so subsequent calls work.
    getDb();
    const stats = dbStats();
    return { path: stats.path, sizeBytes: stats.sizeBytes, counts: countAll(), hydrateLastAt: null };
  });
  handle("local:hydrate", async () => {
    const rid = sessionStore.getSelection().restaurantId ?? sessionStore.getUser()?.restaurantId;
    if (!rid) throw new Error("Pick a restaurant first.");
    await hydrateAll(client, rid);
    return { ok: true as const };
  });

  // ─── Sync Center extensions ────────────────────────────────────────────
  handle("sync:conflicts:diff", ({ id }): ConflictDiff => {
    const op = P.getOp(Number(id));
    if (!op) throw new Error("Conflict not found.");
    // The conflicts table holds the engine-captured server response; the
    // pending op still carries the local payload that triggered it.
    const conflicts = P.listConflicts().filter((c) => c.opId === op.id);
    const conflict = conflicts[0];
    let serverBody: unknown = null;
    let status: number | null = null;
    let message: string | null = conflict?.details ?? op.lastError ?? null;
    // listConflicts only exposes the summary; for the full server body we
    // re-read the conflicts table directly.
    const row = getDb().prepare(
      `SELECT details FROM conflicts WHERE op_id=? ORDER BY captured_at DESC LIMIT 1`,
    ).get(op.id) as { details: string | null } | undefined;
    if (row?.details) {
      try {
        const parsed = JSON.parse(row.details) as { status?: number; body?: unknown };
        status = typeof parsed.status === "number" ? parsed.status : null;
        serverBody = parsed.body ?? null;
      } catch { /* keep null */ }
    }
    return {
      id: conflict?.id ?? -1, opId: op.id, kind: op.kind,
      summary: conflict?.summary ?? op.kind,
      capturedAt: conflict?.capturedAt ?? op.createdAt,
      local: op.payload, server: { status, body: serverBody }, message,
    };
  });

  handle("sync:logs", ({ limit }): SyncLogEntry[] => {
    return D.listSyncLog(Math.min(500, Math.max(1, Number(limit) || 200)));
  });

  handle("sync:clear-cache", ({ confirm }) => {
    requireManager("Clearing the local cache");
    if (!confirm) throw new Error("sync:clear-cache requires { confirm: true }");
    const rid = sessionStore.getSelection().restaurantId ?? sessionStore.getUser()?.restaurantId;
    if (!rid) throw new Error("Pick a restaurant first.");
    D.clearSafeCache(rid);
    invalidateMenu(rid);
    D.insertAuditLog({
      at: Date.now(), actor: sessionStore.getUser()?.email ?? null,
      action: "sync:clear-cache", target: String(rid), details: null,
    });
    const stats = dbStats();
    return {
      path: stats.path, sizeBytes: stats.sizeBytes,
      counts: countAll(),
      hydrateLastAt: Number(kvGet(`hydrate:lastAt:${rid}`) ?? "0") || null,
    };
  });

  // ─── Held bills (mirror of renderer's parked carts) ────────────────────
  handle("held-bills:list", (): HeldBillRecord[] => {
    const rid = sessionStore.getSelection().restaurantId ?? sessionStore.getUser()?.restaurantId ?? null;
    if (rid == null) return [];
    const branchId = currentBranchId();
    const rows = D.listHeldBills(rid, branchId);
    return rows.map((r) => {
      const p = (r.payload ?? {}) as Partial<HeldBillRecord>;
      return {
        id: r.id, label: r.label, createdAt: r.createdAt,
        orderType: (p.orderType ?? "dine_in") as HeldBillRecord["orderType"],
        tableId: p.tableId ?? null, tableLabel: p.tableLabel ?? null,
        customerName: p.customerName ?? null, customerPhone: p.customerPhone ?? null,
        cashier: r.cashier, note: p.note ?? null,
        lines: p.lines ?? [],
      };
    });
  });
  handle("held-bills:save", (bill): HeldBillRecord => {
    const rid = requireRestaurantId();
    D.upsertHeldBill({
      id: bill.id, restaurantId: rid, branchId: currentBranchId(),
      counterId: sessionStore.getSelection().counterId,
      label: bill.label, cashier: bill.cashier ?? null,
      createdAt: bill.createdAt, payload: bill,
    });
    return bill;
  });
  handle("held-bills:remove", ({ id }) => { D.removeHeldBill(String(id)); return true as const; });
  handle("held-bills:clear", () => {
    const rid = sessionStore.getSelection().restaurantId ?? sessionStore.getUser()?.restaurantId ?? null;
    if (rid != null) D.clearHeldBills(rid);
    return true as const;
  });

  // ─── Shift cash movements / expenses / stock / audit / prints ──────────
  function currentCashier(): string | null {
    const u = sessionStore.getUser();
    return u?.email ?? u?.name ?? null;
  }
  function currentSessionId(): number | null {
    return sessionStore.getOpenSession().id ?? null;
  }

  handle("shift:cash-movement", (req): CashMovementRecord => {
    if (!Number.isFinite(req.amount) || req.amount <= 0) throw new Error("Amount must be positive.");
    if (req.kind !== "in" && req.kind !== "out") throw new Error("kind must be 'in' or 'out'");
    const rid = requireRestaurantId();
    const id = `cm_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const row = D.insertCashMovement({
      id, restaurantId: rid, branchId: currentBranchId(),
      sessionId: req.sessionId ?? currentSessionId(), kind: req.kind,
      amount: Number(req.amount), reason: req.reason ?? null,
      cashier: currentCashier(), at: Date.now(),
    });
    P.enqueue({
      kind: "shift:cash-movement", idempotencyKey: id,
      payload: { localId: id, sessionId: row.sessionId, kind: row.kind, amount: row.amount, reason: row.reason, cashier: row.cashier, at: row.at },
    });
    void syncEngine.drain();
    return mapCash(row);
  });
  handle("shift:list-cash-movements", ({ sessionId, limit }): CashMovementRecord[] => {
    const rid = requireRestaurantId();
    return D.listCashMovements(rid, { sessionId: sessionId ?? null, limit }).map(mapCash);
  });

  handle("shift:expense", (req): ExpenseRecord => {
    if (!Number.isFinite(req.amount) || req.amount <= 0) throw new Error("Amount must be positive.");
    const rid = requireRestaurantId();
    const id = `ex_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const row = D.insertExpense({
      id, restaurantId: rid, branchId: currentBranchId(),
      sessionId: req.sessionId ?? currentSessionId(),
      category: req.category ?? null, amount: Number(req.amount),
      reason: req.reason ?? null, cashier: currentCashier(), at: Date.now(),
    });
    P.enqueue({
      kind: "shift:expense", idempotencyKey: id,
      payload: { localId: id, sessionId: row.sessionId, category: row.category, amount: row.amount, reason: row.reason, cashier: row.cashier, at: row.at },
    });
    void syncEngine.drain();
    return mapExpense(row);
  });
  handle("shift:list-expenses", ({ sessionId, limit }): ExpenseRecord[] => {
    const rid = requireRestaurantId();
    return D.listExpenses(rid, { sessionId: sessionId ?? null, limit }).map(mapExpense);
  });

  handle("stock:adjust", (req): StockActionRecord => {
    requireManager("Adjusting stock");
    if (!Number.isFinite(req.quantity)) throw new Error("Quantity required.");
    const rid = requireRestaurantId();
    const id = `st_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const row = D.insertStockAction({
      id, restaurantId: rid, branchId: currentBranchId(),
      menuItemId: req.menuItemId ?? null, ingredientId: req.ingredientId ?? null,
      kind: req.kind, quantity: Number(req.quantity), unit: req.unit ?? null,
      reason: req.reason ?? null, cashier: currentCashier(), at: Date.now(),
    });
    P.enqueue({
      kind: "stock:adjust", idempotencyKey: id,
      payload: { localId: id, menuItemId: row.menuItemId, ingredientId: row.ingredientId, kind: row.kind, quantity: row.quantity, unit: row.unit, reason: row.reason },
    });
    void syncEngine.drain();
    return mapStock(row);
  });
  handle("stock:list-actions", ({ limit }): StockActionRecord[] => {
    const rid = requireRestaurantId();
    return D.listStockActions(rid, { limit }).map(mapStock);
  });

  handle("audit:log", (req): AuditLogRecord => {
    const at = Date.now();
    const actor = currentCashier();
    const row = D.insertAuditLog({ at, actor, action: req.action, target: req.target ?? null, details: req.details ?? null });
    P.enqueue({
      kind: "audit:log", idempotencyKey: `au_${row.id}_${at}`,
      payload: { localId: row.id, action: row.action, target: row.target, details: row.details, at: row.at, actor: row.actor },
    });
    void syncEngine.drain();
    return mapAudit(row);
  });
  handle("audit:list", ({ limit, sinceMs }): AuditLogRecord[] => {
    return D.listAuditLog({ limit, sinceMs }).map(mapAudit);
  });

  handle("prints:record", (req): PrintJobRecord => {
    D.recordPrintJob({
      id: String(req.id), kind: req.kind, orderId: req.orderId ?? null,
      printerName: req.printerName ?? null, status: req.status,
      at: Date.now(), lastError: req.lastError ?? null, payload: req.payload ?? null,
    });
    P.enqueue({
      kind: "prints:record", idempotencyKey: String(req.id),
      payload: { id: String(req.id), kind: req.kind, orderId: req.orderId ?? null, status: req.status, at: Date.now(), lastError: req.lastError ?? null },
    });
    void syncEngine.drain();
    const list = D.listPrintJobs(1);
    return list[0] as PrintJobRecord;
  });
  handle("prints:list", ({ limit }): PrintJobRecord[] => D.listPrintJobs(limit));

  // ─── Phase 6: specialist workspace handlers ─────────────────────────────
  // Thin wrappers around the REST endpoints; all need an active restaurant.
  handle("inv:list",     (q)        => client.invList(requireRestaurantId(), q ?? {}));
  handle("inv:adjust",   ({ id, ...body }) => client.invAdjust(requireRestaurantId(), id, body));
  handle("inv:transactions", ({ id, limit }) => client.invTx(requireRestaurantId(), id, limit));
  handle("inv:waste-log",    ()    => client.invWasteLog(requireRestaurantId()));
  handle("inv:suppliers",    ()    => client.invSuppliers(requireRestaurantId()));
  handle("inv:supplier-create", (b) => client.invSupplierCreate(requireRestaurantId(), b));
  handle("inv:purchase-orders", (q) => client.invPOList(requireRestaurantId(), q?.status));
  handle("inv:purchase-order-create", (b) => client.invPOCreate(requireRestaurantId(), b));
  handle("inv:purchase-order-receive", ({ id }) => client.invPOReceive(requireRestaurantId(), id));
  handle("inv:menu-items-stock", async () => {
    const bundle = await loadMenuBundle(requireRestaurantId()).catch(() => null);
    return (bundle?.items ?? []) as unknown[];
  });

  handle("acc:expenses",        (q) => client.accExpenses(requireRestaurantId(), q ?? {}));
  handle("acc:expense-create",  (b) => client.accExpenseCreate(requireRestaurantId(), b));
  handle("acc:expense-categories", () => client.accExpenseCategories(requireRestaurantId()));
  handle("acc:expense-category-create", (b) => client.accExpenseCategoryCreate(requireRestaurantId(), b));
  handle("acc:payments-list",   (q) => client.accPayments(requireRestaurantId(), q ?? {}));
  handle("acc:payments-summary",(q) => client.accPaymentsSummary(requireRestaurantId(), q ?? {}));
  handle("acc:pnl",             (q) => client.accPnl(requireRestaurantId(), q ?? {}));
  handle("acc:targets",         ()  => client.accTargets(requireRestaurantId()));

  handle("mkt:campaigns",       (q) => client.mktCampaigns(requireRestaurantId(), q ?? {}));
  handle("mkt:campaign-analytics", () => client.mktAnalytics(requireRestaurantId()));
  handle("mkt:campaign-logs",   (q) => client.mktLogs(requireRestaurantId(), q?.limit));
  handle("mkt:campaign-draft",  (b) => client.mktDraft(requireRestaurantId(), b ?? {}));
  handle("mkt:templates",       ({ channel }) => client.mktTemplates(requireRestaurantId(), channel));
  handle("mkt:reviews-feedback",(q) => client.mktReviewsFeedback(requireRestaurantId(), q?.limit));
  handle("mkt:reviews-external",(q) => client.mktReviewsExternal(requireRestaurantId(), q?.limit));
  handle("mkt:reviews-recovery",(q) => client.mktReviewsRecovery(requireRestaurantId(), q?.status));
  handle("mkt:coupons-validate",({ code }) => client.mktCouponsValidate(requireRestaurantId(), code));
  handle("mkt:customers",       (q) => client.mktCustomers(requireRestaurantId(), q ?? {}));

  handle("del:assignments",     (q) => client.delAssignments(requireRestaurantId(), q?.status));
  handle("del:executives",      ()  => client.delExecutives(requireRestaurantId()));
  handle("del:assign",          (b) => client.delAssign(requireRestaurantId(), b));
  handle("del:update-status",   ({ assignmentId, ...body }) =>
    client.delUpdateStatus(requireRestaurantId(), assignmentId, body));
  handle("del:proof",           ({ assignmentId, ...body }) =>
    client.delProof(requireRestaurantId(), assignmentId, body));
  handle("del:unavailable",     ({ assignmentId, ...body }) =>
    client.delUnavailable(requireRestaurantId(), assignmentId, body));
  handle("del:cod-collected",   ({ assignmentId }) =>
    client.delCodCollected(requireRestaurantId(), assignmentId));
  handle("del:cod-summary",     (q) => client.delCodSummary(requireRestaurantId(), q ?? {}));
  handle("del:handovers",       (q) => client.delHandovers(requireRestaurantId(), q?.limit));
  handle("del:handover-create", (b) => client.delHandoverCreate(requireRestaurantId(), b));
  handle("del:aggregator-dashboard", () => client.delAggregatorDashboard(requireRestaurantId()));
  handle("del:aggregator-sheets",    () => client.delAggregatorSheets(requireRestaurantId()));
}

function mapCash(r: D.CashMovementRow): CashMovementRecord {
  return { id: r.id, sessionId: r.sessionId, kind: r.kind, amount: r.amount, reason: r.reason, cashier: r.cashier, at: r.at, syncedAt: r.syncedAt };
}
function mapExpense(r: D.ExpenseRow): ExpenseRecord {
  return { id: r.id, sessionId: r.sessionId, category: r.category, amount: r.amount, reason: r.reason, cashier: r.cashier, at: r.at, syncedAt: r.syncedAt };
}
function mapStock(r: D.StockActionRow): StockActionRecord {
  return { id: r.id, menuItemId: r.menuItemId, ingredientId: r.ingredientId, kind: r.kind, quantity: r.quantity, unit: r.unit, reason: r.reason, cashier: r.cashier, at: r.at, syncedAt: r.syncedAt };
}
function mapAudit(r: D.AuditLogRow): AuditLogRecord {
  return { id: r.id, at: r.at, actor: r.actor, action: r.action, target: r.target, details: r.details, syncedAt: r.syncedAt };
}

// ─── Payload builders (API → ESC/POS DTO) ──────────────────────────────────
function num(v: number | string | null | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}

function buildKotPayload(order: OrderDetailView): OrderKotPayload {
  return {
    // Prefer the short display id ("DN-20") over the canonical long id
    // ("KL-R1-MGROAD-20260527-DN-000020") so the kitchen ticket header
    // matches what the cashier sees on screen.
    orderNumber: shortOrderNumber(order),
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
  extra: { openDrawer: boolean; copies?: number; restaurantId?: number; channel?: string },
): OrderBillPayload {
  const payload: OrderBillPayload = {
    orderId: order.id,
    restaurantId: extra.restaurantId,
    channel: extra.channel ?? "desktop_pos",
    // Bill receipts print the short id ("DN-20") — never the long
    // canonical id. See `shortOrderNumber` for the precedence rules.
    orderNumber: shortOrderNumber(order),
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

