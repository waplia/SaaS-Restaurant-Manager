/**
 * Preload bridge.
 *
 * Exposes `window.khanalagao` to the renderer with a typed API derived from
 * the shared IPC contract. The renderer never sees tokens, never sees the
 * raw HTTP layer, never talks to `ipcRenderer` directly.
 *
 * Every channel here is declared in `desktop/shared/ipc-contract.ts` — there
 * are no untyped or "legacy" channels in the bridge.
 */

import { contextBridge, ipcRenderer } from "electron";
import type {
  IpcChannel, IpcContract, IpcEnvelope, UpdateEvent, PrinterRole,
  ConnectivityState,
} from "../shared/ipc-contract";

async function invoke<C extends IpcChannel>(
  channel: C,
  req?: IpcContract[C]["req"],
): Promise<IpcContract[C]["res"]> {
  const r = (await ipcRenderer.invoke(channel, req)) as IpcEnvelope<IpcContract[C]["res"]>;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

const api = {
  // ─── Settings / session / app ─────────────────────────────────────
  settings: {
    get: () => invoke("settings:get"),
    set: (patch: IpcContract["settings:set"]["req"]) => invoke("settings:set", patch),
  },
  session: {
    snapshot: () => invoke("session:snapshot"),
    clearSelection: () => invoke("session:clear-selection"),
  },
  app: {
    version: () => invoke("app:version"),
    openExternal: (url: string) => invoke("app:open-external", url),
  },

  // ─── Auth ─────────────────────────────────────────────────────────
  auth: {
    login: (req: IpcContract["auth:login"]["req"]) => invoke("auth:login", req),
    refresh: () => invoke("auth:refresh"),
    logout: () => invoke("auth:logout"),
    me: () => invoke("auth:me"),
    onInvalidated: (cb: () => void) => {
      const listener = () => cb();
      ipcRenderer.on("auth:invalidated", listener);
      return () => ipcRenderer.removeListener("auth:invalidated", listener);
    },
  },

  // ─── Outlets / counters / selection ───────────────────────────────
  restaurants: { list: () => invoke("restaurants:list") },
  branches: { list: (req: IpcContract["branches:list"]["req"]) => invoke("branches:list", req) },
  terminals: { list: (req: IpcContract["terminals:list"]["req"]) => invoke("terminals:list", req) },
  selection: {
    setRestaurant: (req: IpcContract["selection:set-restaurant"]["req"]) => invoke("selection:set-restaurant", req),
    setBranch: (req: IpcContract["selection:set-branch"]["req"]) => invoke("selection:set-branch", req),
    setCounter: (req: IpcContract["selection:set-counter"]["req"]) => invoke("selection:set-counter", req),
  },

  // ─── Shifts ───────────────────────────────────────────────────────
  shifts: {
    current: () => invoke("shifts:current"),
    open: (req: IpcContract["shifts:open"]["req"]) => invoke("shifts:open", req),
    close: (req: IpcContract["shifts:close"]["req"]) => invoke("shifts:close", req),
  },

  // ─── Menu (Phase 2) ───────────────────────────────────────────────
  menu: {
    restaurant: () => invoke("menu:restaurant"),
    list: (req?: IpcContract["menu:list"]["req"]) => invoke("menu:list", req ?? undefined),
    categories: () => invoke("menu:categories"),
    lookupByBarcode: (code: string) => invoke("menu:lookup-by-barcode", { code }),
    items: (req: IpcContract["menu:items"]["req"]) => invoke("menu:items", req),
    modifiers: (req: IpcContract["menu:modifiers"]["req"]) => invoke("menu:modifiers", req),
  },

  // ─── Tables (Phase 2) ─────────────────────────────────────────────
  tables: {
    list: () => invoke("tables:list"),
    activeOrder: (req: IpcContract["tables:active-order"]["req"]) => invoke("tables:active-order", req),
  },

  // ─── Customers (Phase 2) ──────────────────────────────────────────
  customers: {
    search: (req: IpcContract["customers:search"]["req"]) => invoke("customers:search", req),
    create: (req: IpcContract["customers:create"]["req"]) => invoke("customers:create", req),
    lookup: (req: IpcContract["customers:lookup"]["req"]) => invoke("customers:lookup", req),
  },

  // ─── Orders (Phase 2 + Phase 4 pay/split) ─────────────────────────
  orders: {
    list: (req: IpcContract["orders:list"]["req"]) => invoke("orders:list", req),
    detail: (req: IpcContract["orders:detail"]["req"]) => invoke("orders:detail", req),
    create: (req: IpcContract["orders:create"]["req"]) => invoke("orders:create", req),
    addItems: (req: IpcContract["orders:add-items"]["req"]) => invoke("orders:add-items", req),
    update: (req: IpcContract["orders:update"]["req"]) => invoke("orders:update", req),
    pay: (req: IpcContract["orders:pay"]["req"]) => invoke("orders:pay", req),
    split: (req: IpcContract["orders:split"]["req"]) => invoke("orders:split", req),
  },

  // ─── Discounts (Phase 2) ──────────────────────────────────────────
  discounts: {
    config: () => invoke("discounts:config"),
    apply: (req: IpcContract["discounts:apply"]["req"]) => invoke("discounts:apply", req),
    remove: (req: IpcContract["discounts:remove"]["req"]) => invoke("discounts:remove", req),
  },

  // ─── Payments (Phase 4) ───────────────────────────────────────────
  payments: {
    record: (req: IpcContract["payments:record"]["req"]) => invoke("payments:record", req),
    stripeIntent: (req: IpcContract["payments:stripe-intent"]["req"]) =>
      invoke("payments:stripe-intent", req),
    razorpayOrder: (req: IpcContract["payments:razorpay-order"]["req"]) =>
      invoke("payments:razorpay-order", req),
    terminalCharge: (req: IpcContract["payments:terminal-charge"]["req"]) =>
      invoke("payments:terminal-charge", req),
    terminalConfirm: (req: IpcContract["payments:terminal-confirm"]["req"]) =>
      invoke("payments:terminal-confirm", req),
  },

  // ─── Reports + Z-reports (Phase 4) ────────────────────────────────
  reports: {
    shiftKpis: (req: IpcContract["reports:shift-kpis"]["req"]) =>
      invoke("reports:shift-kpis", req),
  },
  zReports: {
    list: () => invoke("zReports:list"),
    get: (req: IpcContract["zReports:get"]["req"]) => invoke("zReports:get", req),
    reprint: (req: IpcContract["zReports:reprint"]["req"]) => invoke("zReports:reprint", req),
  },

  // ─── Printers / hardware ──────────────────────────────────────────
  printers: {
    list: () => invoke("printers:list"),
    test: (printerName: string) => invoke("printers:test", { printerName }),
    getAssignments: () => invoke("printers:get-assignments"),
    assignRole: (role: PrinterRole, printerName: string | null) => invoke("printers:assign", { role, printerName }),
    assignKitchen: (kitchenId: number, printerName: string | null) => invoke("printers:assign", { kitchenId, printerName }),
    printReceipt: (req: IpcContract["printers:print-receipt"]["req"]) => invoke("printers:print-receipt", req),
    printKot: (req: IpcContract["printers:print-kot"]["req"]) => invoke("printers:print-kot", req),
    printOrderKots: (req: IpcContract["printers:print-order-kots"]["req"]) => invoke("printers:print-order-kots", req),
    printOrderBill: (req: IpcContract["printers:print-order-bill"]["req"]) => invoke("printers:print-order-bill", req),
    printBillForOrder: (req: IpcContract["printers:print-bill-for-order"]["req"]) => invoke("printers:print-bill-for-order", req),
    printZReport: (req: IpcContract["printers:print-z-report"]["req"]) => invoke("printers:print-z-report", req),
    reprintLastKot: () => invoke("printers:reprint-last-kot"),
    reprintLastBill: () => invoke("printers:reprint-last-bill"),
  },
  drawer: {
    open: (printerName?: string) => invoke("drawer:open", { printerName }),
    getSettings: () => invoke("drawer:get-settings"),
    setSettings: (patch: IpcContract["drawer:set-settings"]["req"]) => invoke("drawer:set-settings", patch),
  },
  failedPrints: {
    list: () => invoke("failed-prints:list"),
    add: (entry: unknown) => invoke("failed-prints:add", entry),
    retry: (id: string) => invoke("failed-prints:retry", { id }),
    discard: (id: string) => invoke("failed-prints:discard", { id }),
    clear: () => invoke("failed-prints:clear"),
    onChanged: (cb: () => void) => {
      const listener = () => cb();
      ipcRenderer.on("printers:failed-changed", listener);
      return () => ipcRenderer.removeListener("printers:failed-changed", listener);
    },
  },
  scanner: {
    getState: () => invoke("scanner:get-state"),
    setEnabled: (enabled: boolean) => invoke("scanner:set-enabled", { enabled }),
    recordScan: (value: string) => invoke("scanner:record-scan", { value }),
    clearScans: () => invoke("scanner:clear-scans"),
  },
  updates: {
    check: () => invoke("updates:check"),
    onEvent: (cb: (e: UpdateEvent) => void) => {
      const listener = (_: unknown, payload: UpdateEvent) => cb(payload);
      ipcRenderer.on("updates:event", listener);
      return () => ipcRenderer.removeListener("updates:event", listener);
    },
  },

  // ─── Phase 5 — connectivity / sync / local cache ───────────────────
  connectivity: {
    get: () => invoke("connectivity:get"),
    probe: () => invoke("connectivity:probe"),
    onChange: (cb: (s: ConnectivityState) => void) => {
      const listener = (_: unknown, state: ConnectivityState) => cb(state);
      ipcRenderer.on("connectivity:state", listener);
      return () => ipcRenderer.removeListener("connectivity:state", listener);
    },
  },
  sync: {
    status: () => invoke("sync:status"),
    runNow: () => invoke("sync:run-now"),
    listConflicts: () => invoke("sync:conflicts:list"),
    resolveConflict: (req: IpcContract["sync:conflicts:resolve"]["req"]) =>
      invoke("sync:conflicts:resolve", req),
    onStatusChanged: (cb: () => void) => {
      const listener = () => cb();
      ipcRenderer.on("sync:status-changed", listener);
      return () => ipcRenderer.removeListener("sync:status-changed", listener);
    },
  },
  local: {
    info: () => invoke("local:info"),
    reset: () => invoke("local:reset", { confirm: true }),
    hydrate: () => invoke("local:hydrate"),
  },
} as const;

contextBridge.exposeInMainWorld("khanalagao", api);

export type KhanalagaoDesktopApi = typeof api;
