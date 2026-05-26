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

  // ─── Phase 2+ stubs (typed; throws until wired) ───────────────────
  menu: {
    list: () => invoke("menu:list"),
    categories: () => invoke("menu:categories"),
    lookupByBarcode: (code: string) => invoke("menu:lookup-by-barcode", { code }),
  },
  orders: {
    list: (req: IpcContract["orders:list"]["req"]) => invoke("orders:list", req),
    create: (req: IpcContract["orders:create"]["req"]) => invoke("orders:create", req),
    update: (req: IpcContract["orders:update"]["req"]) => invoke("orders:update", req),
  },
  customers: {
    lookup: (req: IpcContract["customers:lookup"]["req"]) => invoke("customers:lookup", req),
  },
  payments: {
    record: (req: IpcContract["payments:record"]["req"]) => invoke("payments:record", req),
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
} as const;

contextBridge.exposeInMainWorld("khanalagao", api);

export type KhanalagaoDesktopApi = typeof api;
