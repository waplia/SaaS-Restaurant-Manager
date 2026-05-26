/**
 * IPC handler registry.
 *
 * Maps every channel from `desktop/shared/ipc-contract.ts` to a main-process
 * implementation. Each handler is wrapped in a uniform try/catch that returns
 * `{ ok:true, data }` or `{ ok:false, error }` — the preload bridge unwraps
 * this so renderer code can `await` and `try/catch` like a normal function.
 */

import { ipcMain, app, shell, BrowserWindow } from "electron";
import type {
  IpcChannel, IpcContract, IpcEnvelope, SessionSnapshot,
  OrderKotPayload, OrderBillPayload,
} from "../../shared/ipc-contract";
import { ApiClient, ApiError, type ApiOrderDetail, type ApiRestaurantDetail } from "../api/client";
import { sessionStore } from "../session-store";
import type { PrinterEngine } from "../printers";

interface SettingsApi {
  get: () => { apiBaseUrl: string };
  set: (patch: { apiBaseUrl?: string }) => { apiBaseUrl: string };
}

export function registerApiIpc(opts: {
  client: ApiClient;
  settings: SettingsApi;
  getWindow: () => BrowserWindow | null;
  printerEngine: PrinterEngine;
}): void {
  const { client, settings, getWindow, printerEngine } = opts;

  client.onAuthLost(() => {
    getWindow()?.webContents.send("auth:invalidated");
  });

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

  // ─── App / settings / session snapshot ───────────────────────────────
  handle("settings:get", () => settings.get());
  handle("settings:set", (patch) => {
    const next = settings.set(patch);
    client.setBaseUrl(next.apiBaseUrl);
    return next;
  });
  handle("session:snapshot", () => snapshot());
  handle("session:clear-selection", () => {
    sessionStore.resetSelection();
    sessionStore.setOpenSession(null, null);
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

  handle("shifts:close", async ({ sessionId, countedAmount, closeNotes }) => {
    const r = await client.closeShift(requireRestaurantId(), sessionId, countedAmount, closeNotes);
    sessionStore.setOpenSession(null, null);
    return r;
  });

  // ─── Orders: create + auto-print KOTs ────────────────────────────────
  // Phase 3 wires the order-send path end-to-end:
  //   renderer → orders:create → API.createOrder → printers.dispatchKots
  // Silent: failures bubble up as the failed-prints tray (toast in renderer).
  // The KOT print is fire-and-await here so the renderer learns about printer
  // problems immediately rather than waiting for an event round-trip.
  handle("orders:create", async (req) => {
    const restaurantId = requireRestaurantId();
    const order = await client.createOrder(restaurantId, req);
    try {
      const kotPayload = buildKotPayload(order);
      if (kotPayload.items.length > 0) {
        await printerEngine.dispatchKots(kotPayload);
      }
    } catch (err) {
      // Print failure should not roll back the created order; the entry is
      // already in the failed-prints tray for retry.
      console.warn("[orders:create] KOT auto-print failed:", (err as Error).message);
    }
    return order as IpcContract["orders:create"]["res"];
  });

  // ─── Bill print by order id (main fetches the data) ──────────────────
  // Renderer hands main an orderId; main pulls the canonical order + outlet
  // details and formats the receipt. Keeps the receipt formatter as the
  // single source of truth and prevents drift between web POS and desktop.
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

  // ─── Scanner consumers ───────────────────────────────────────────────
  handle("customers:lookup", async (req) => {
    const restaurantId = requireRestaurantId();
    if (!req || typeof req.phone !== "string" || !req.phone.trim()) {
      throw new Error("phone required");
    }
    return client.lookupCustomerByPhone(restaurantId, req.phone.trim()) as Promise<IpcContract["customers:lookup"]["res"]>;
  });

  handle("menu:lookup-by-barcode", async (req) => {
    const restaurantId = requireRestaurantId();
    const code = String(req?.code ?? "").trim();
    if (!code) throw new Error("code required");
    return client.lookupMenuItemByCode(restaurantId, code);
  });

  // ─── Remaining Phase 2 / Phase 4 placeholders ────────────────────────
  handle("menu:list", () => { throw new Error("menu:list not yet implemented (Phase 2)"); });
  handle("menu:categories", () => { throw new Error("menu:categories not yet implemented (Phase 2)"); });
  handle("orders:list", () => { throw new Error("orders:list not yet implemented (Phase 2)"); });
  handle("orders:update", () => { throw new Error("orders:update not yet implemented (Phase 2)"); });
  handle("payments:record", () => { throw new Error("payments:record not yet implemented (Phase 4)"); });
}

// ─── Payload builders (API → ESC/POS DTO) ──────────────────────────────────
function num(v: number | string | null | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}

function buildKotPayload(order: ApiOrderDetail): OrderKotPayload {
  return {
    orderNumber: order.orderNumber,
    orderType: order.orderType ?? null,
    tableLabel: order.tableLabel ?? null,
    createdAt: order.createdAt ?? null,
    outletName: null,
    items: order.items.map((it) => ({
      name: it.name,
      quantity: Number(it.quantity) || 1,
      notes: it.notes ?? null,
      kitchenId: it.kitchenId ?? null,
      kitchenName: it.kitchenName ?? null,
      modifiers: (it.modifiers ?? []).map((m) => ({ name: m.name })),
    })),
  };
}

function buildBillPayload(
  order: ApiOrderDetail,
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
      name: it.name,
      quantity: Number(it.quantity) || 1,
      unitPrice: num(it.unitPrice),
      lineTotal: num(it.lineTotal),
      notes: it.notes ?? null,
      modifiers: (it.modifiers ?? []).map((m) => ({ name: m.name, price: num(m.price) })),
    })),
    subtotal: num(order.subtotal),
    taxAmount: num(order.taxAmount),
    serviceCharge: num(order.serviceCharge),
    discountAmount: num(order.discountAmount),
    totalAmount: num(order.totalAmount),
    discounts: (order.discounts ?? []).map((d) => ({
      label: d.label ?? d.name ?? "Discount",
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
