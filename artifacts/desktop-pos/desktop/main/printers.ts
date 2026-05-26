/**
 * Printer subsystem.
 *
 * Channels (all listed in `desktop/shared/ipc-contract.ts`):
 *   • printers:list           — enumerate OS printers
 *   • printers:test           — print a small test page
 *   • printers:print-receipt  — bill print (ESC/POS)
 *   • printers:print-kot      — KOT print (ESC/POS)
 *
 * ESC/POS bytes are built locally — no external dep required for the common
 * "init / text / cut / drawer-kick" path.
 */

import { ipcMain, BrowserWindow } from "electron";
import type { IpcResult } from "./types";
import type { ReceiptPrintRequest, KotPrintRequest } from "../shared/ipc-contract";

const ESC = 0x1b;
const GS = 0x1d;

export function escposBytes(text: string, opts: { cut?: boolean; drawer?: boolean } = {}): Buffer {
  const init = Buffer.from([ESC, 0x40, ESC, 0x21, 0x00]);
  const body = Buffer.from(text, "utf8");
  const feed = Buffer.from("\n\n\n\n", "utf8");
  const cut = opts.cut === false ? Buffer.alloc(0) : Buffer.from([GS, 0x56, 0x01]);
  const kick = opts.drawer ? kickCashDrawerCommand() : Buffer.alloc(0);
  return Buffer.concat([init, body, feed, cut, kick]);
}

export function kickCashDrawerCommand(): Buffer {
  // ESC p m t1 t2 — m=0 (pin 2), t1=25ms, t2=250ms
  return Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]);
}

interface PrinterDeps {
  sendRawToPrinter: (printerName: string, bytes: Buffer) => Promise<void>;
  escposBytes: typeof escposBytes;
}

export function registerPrinterHandlers(deps: PrinterDeps): void {
  ipcMain.handle("printers:list", async (e): Promise<IpcResult<Array<{ name: string; isDefault: boolean }>>> => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win) return { ok: false, error: "no window" };
      const list = await win.webContents.getPrintersAsync();
      return {
        ok: true,
        data: list.map((p) => ({ name: p.name, isDefault: p.isDefault })),
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("printers:test", async (_e, req: { printerName: string }): Promise<IpcResult<true>> => {
    const printerName = req?.printerName;
    if (typeof printerName !== "string" || !printerName) return { ok: false, error: "printerName required" };
    try {
      const text =
        "================================\n" +
        "      Khanalagao POS — TEST\n" +
        "================================\n" +
        `Printer: ${printerName}\n` +
        `Time   : ${new Date().toLocaleString()}\n` +
        "--------------------------------\n" +
        "If you can read this, the\n" +
        "printer is wired up correctly.\n" +
        "================================\n";
      await deps.sendRawToPrinter(printerName, deps.escposBytes(text));
      return { ok: true, data: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("printers:print-receipt", async (_e, payload: ReceiptPrintRequest): Promise<IpcResult<true>> => {
    if (!payload || typeof payload.text !== "string") return { ok: false, error: "invalid payload" };
    const target = payload.printerName;
    if (!target) return { ok: false, error: "No bill printer configured" };
    try {
      const copies = Math.max(1, Math.min(5, payload.copies ?? 1));
      for (let i = 0; i < copies; i++) {
        await deps.sendRawToPrinter(target, deps.escposBytes(payload.text, {
          cut: true,
          drawer: !!payload.openDrawer && i === copies - 1,
        }));
      }
      return { ok: true, data: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("printers:print-kot", async (_e, payload: KotPrintRequest): Promise<IpcResult<true>> => {
    if (!payload || typeof payload.text !== "string") return { ok: false, error: "invalid payload" };
    const target = payload.printerName;
    if (!target) return { ok: false, error: "No KOT printer configured" };
    try {
      const header = payload.stationLabel ? `*** ${payload.stationLabel} ***\n` : "";
      await deps.sendRawToPrinter(target, deps.escposBytes(header + payload.text, { cut: true }));
      return { ok: true, data: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
}
