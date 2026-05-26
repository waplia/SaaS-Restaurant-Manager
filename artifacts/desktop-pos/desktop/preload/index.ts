/**
 * Preload bridge.
 *
 * Exposes a narrow, typed `window.khanalagao` API to the renderer using
 * contextBridge. Every method is a thin wrapper around an ipcRenderer.invoke
 * with a fixed channel name — no arbitrary IPC, no `require`, no `process`.
 */

import { contextBridge, ipcRenderer } from "electron";
import type { DesktopSettings, IpcResult, ReceiptPrintPayload, KotPrintPayload } from "../main/types";

type Unwrap<T> = T extends IpcResult<infer U> ? U : never;

async function call<T>(channel: string, ...args: unknown[]): Promise<Unwrap<IpcResult<T>>> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>;
  if (!r.ok) throw new Error(r.error);
  return r.data as Unwrap<IpcResult<T>>;
}

const api = {
  settings: {
    get: () => call<DesktopSettings>("settings:get"),
    set: (patch: Partial<DesktopSettings>) => call<DesktopSettings>("settings:set", patch),
  },
  cart: {
    save: (cart: unknown) => call<true>("cart:save", cart),
    load: () => call<unknown>("cart:load"),
    clear: () => call<true>("cart:clear"),
  },
  failedPrints: {
    list: () => call<unknown[]>("failed-prints:list"),
    add: (entry: unknown) => call<true>("failed-prints:add", entry),
    clear: () => call<true>("failed-prints:clear"),
  },
  printers: {
    list: () => call<Array<{ name: string; isDefault: boolean }>>("printers:list"),
    test: (printerName: string) => call<true>("printers:test", printerName),
    printReceipt: (payload: ReceiptPrintPayload) => call<true>("printers:print-receipt", payload),
    printKot: (payload: KotPrintPayload) => call<true>("printers:print-kot", payload),
  },
  drawer: {
    open: (printerName?: string) => call<true>("drawer:open", printerName),
  },
  app: {
    version: () => call<{ version: string; platform: string }>("app:version"),
    openExternal: (url: string) => call<true>("app:open-external", url),
  },
  updates: {
    check: () => call<{ status: string; version?: string }>("updates:check"),
    onEvent: (cb: (e: { type: string; version?: string; percent?: number; message?: string }) => void) => {
      const listener = (_: unknown, payload: { type: string; version?: string; percent?: number; message?: string }) => cb(payload);
      ipcRenderer.on("updates:event", listener);
      return () => ipcRenderer.removeListener("updates:event", listener);
    },
  },
} as const;

contextBridge.exposeInMainWorld("khanalagao", api);

export type KhanalagaoDesktopApi = typeof api;
