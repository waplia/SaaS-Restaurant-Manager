/**
 * Printer + drawer + scanner subsystem.
 *
 * All hardware I/O lives in the main process — the renderer NEVER touches
 * `node-printer`, the `lp` binary, or USB devices directly. Renderer talks
 * to this module exclusively through the typed IPC contract in
 * `desktop/shared/ipc-contract.ts`.
 *
 * Responsibilities:
 *   • Enumerate OS printers and remember per-role / per-kitchen assignments.
 *   • Format ESC/POS payloads for KOTs and bills using the same layout the
 *     web POS prints (see `printOrder.ts` / `printKitchenTicket`).
 *   • Route KOT items to the right printer based on `kitchenId` overrides,
 *     falling back through (kitchen → role default → KOT default).
 *   • Pulse the cash drawer (cash payments only — gated by the caller).
 *   • Persist a "failed prints" queue with auto retry-with-backoff so a
 *     paper jam never costs the cashier the original payload.
 *   • Track scanner enable state and a small ring buffer of last scans for
 *     the Hardware settings tester.
 *
 * Every print path is `try/catch`-wrapped so a printer outage cannot crash
 * main. Errors land in the failed-prints queue, are scheduled for automatic
 * retry with exponential backoff (5s, 15s, 45s; max 3 attempts), and surface
 * in the renderer tray for manual retry / discard.
 */

import { ipcMain, BrowserWindow } from "electron";
import type { IpcResult } from "./types";
import type {
  ReceiptPrintRequest, KotPrintRequest,
  OrderKotPayload, OrderKotItem, OrderBillPayload,
  KotDispatchResult, FailedPrintEntry,
  PrinterAssignments, PrinterRole, DrawerSettings, OsPrinter,
} from "../shared/ipc-contract";

const ESC = 0x1b;
const GS = 0x1d;
const LF = "\n";
const LINE_WIDTH_80 = 32;

/** Backoff schedule (in ms) for auto-retries. After this, the job sits in the
 *  failed tray waiting for manual retry. */
const RETRY_BACKOFF_MS = [5_000, 15_000, 45_000] as const;

export function escposBytes(text: string, opts: { cut?: boolean; drawer?: boolean; drawerBefore?: boolean } = {}): Buffer {
  const init = Buffer.from([ESC, 0x40, ESC, 0x21, 0x00]);
  const body = Buffer.from(text, "utf8");
  const feed = Buffer.from("\n\n\n\n", "utf8");
  const cut = opts.cut === false ? Buffer.alloc(0) : Buffer.from([GS, 0x56, 0x01]);
  const kick = opts.drawer ? kickCashDrawerCommand() : Buffer.alloc(0);
  if (opts.drawer && opts.drawerBefore) {
    return Buffer.concat([init, kick, body, feed, cut]);
  }
  return Buffer.concat([init, body, feed, cut, kick]);
}

export function kickCashDrawerCommand(): Buffer {
  return Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]);
}

// ─── ESC/POS layout helpers ─────────────────────────────────────────────────
function rupees(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pad(left: string, right: string, width = LINE_WIDTH_80): string {
  const l = left ?? "";
  const r = right ?? "";
  const space = Math.max(1, width - l.length - r.length);
  if (l.length + r.length >= width) {
    return `${l}\n${" ".repeat(width - r.length)}${r}`;
  }
  return `${l}${" ".repeat(space)}${r}`;
}

function center(text: string, width = LINE_WIDTH_80): string {
  const t = text ?? "";
  if (t.length >= width) return t;
  const padN = Math.floor((width - t.length) / 2);
  return `${" ".repeat(padN)}${t}`;
}

function dashLine(width = LINE_WIDTH_80): string {
  return "-".repeat(width);
}

function fmtTimestamp(value?: string | null): string {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toLocaleString("en-IN");
  return d.toLocaleString("en-IN");
}

export function formatKotText(group: {
  payload: OrderKotPayload;
  kitchenLabel: string;
  items: OrderKotItem[];
}): string {
  const { payload, kitchenLabel, items } = group;
  const lines: string[] = [];
  lines.push(center("*** KITCHEN ORDER ***"));
  if (payload.outletName) lines.push(center(payload.outletName));
  lines.push(center(kitchenLabel));
  lines.push(dashLine());
  lines.push(pad(`#${payload.orderNumber}`, payload.tableLabel || (payload.orderType ? payload.orderType.replace(/_/g, " ").toUpperCase() : "")));
  lines.push(`Time : ${fmtTimestamp(payload.createdAt)}`);
  lines.push(dashLine());
  for (const it of items) {
    const qty = `${it.quantity}x`;
    lines.push(pad(`${qty} ${it.name}`, ""));
    for (const m of it.modifiers ?? []) {
      lines.push(`     + ${m.name}`);
    }
    if (it.notes && it.notes.trim()) {
      lines.push(`     * ${it.notes.trim()}`);
    }
  }
  lines.push(dashLine());
  lines.push(`PRINT TIME: ${new Date().toLocaleTimeString("en-IN")}`);
  return lines.join(LF) + LF;
}

export function formatBillText(payload: OrderBillPayload): string {
  const r = payload.restaurant ?? {};
  const lines: string[] = [];
  if (r.name) lines.push(center(r.name));
  if (r.address) lines.push(center(r.address));
  if (r.phone) lines.push(center(`Tel: ${r.phone}`));
  if (r.gstin) lines.push(center(`GSTIN: ${r.gstin}`));
  const docTitle = payload.payment && payload.payment.method !== "pending" ? "TAX INVOICE" : "RECEIPT";
  lines.push(center(docTitle));
  lines.push(dashLine());
  lines.push(pad(`#${payload.orderNumber}`, fmtTimestamp(payload.createdAt).split(",")[0] ?? ""));
  if (payload.tableLabel || payload.orderType) {
    lines.push(payload.tableLabel || (payload.orderType ?? "").replace(/_/g, " ").toUpperCase());
  }
  if (payload.customerName) {
    lines.push(`Cust : ${payload.customerName}${payload.customerPhone ? ` · ${payload.customerPhone}` : ""}`);
  }
  lines.push(dashLine());
  lines.push(pad("ITEM", "AMT"));
  lines.push(dashLine());
  for (const it of payload.items) {
    lines.push(pad(`${it.quantity}x ${it.name}`, rupees(it.lineTotal)));
    for (const m of it.modifiers ?? []) {
      lines.push(pad(`   + ${m.name}`, m.price > 0 ? rupees(m.price) : ""));
    }
    if (it.notes && it.notes.trim()) {
      lines.push(`   * ${it.notes.trim()}`);
    }
  }
  lines.push(dashLine());
  lines.push(pad("Subtotal", rupees(payload.subtotal)));
  if (payload.discounts && payload.discounts.length > 0) {
    for (const d of payload.discounts) {
      if (!(d.amount > 0)) continue;
      lines.push(pad(d.label || "Discount", `-${rupees(d.amount)}`));
    }
  } else if (payload.discountAmount > 0) {
    lines.push(pad("Discount", `-${rupees(payload.discountAmount)}`));
  }
  if (payload.serviceCharge > 0) {
    lines.push(pad("Service Charge", rupees(payload.serviceCharge)));
  }
  if (payload.taxBreakdown && payload.taxBreakdown.length > 0) {
    for (const t of payload.taxBreakdown) {
      lines.push(pad(`Tax (${t.rate})`, rupees(t.amount)));
    }
  } else if (payload.taxAmount > 0) {
    lines.push(pad("Tax", rupees(payload.taxAmount)));
  }
  lines.push(dashLine());
  lines.push(pad("TOTAL", rupees(payload.totalAmount)));
  if (payload.payment) {
    lines.push("");
    lines.push(pad("Payment", payload.payment.method.toUpperCase()));
    if (payload.payment.tendered != null) {
      lines.push(pad("Tendered", rupees(payload.payment.tendered)));
    }
    const change = payload.payment.change ?? (payload.payment.tendered != null
      ? Math.max(0, payload.payment.tendered - payload.totalAmount) : 0);
    if (change > 0) lines.push(pad("Change", rupees(change)));
  }
  if (r.upiId) {
    lines.push("");
    lines.push(center(`UPI: ${r.upiId}`));
  }
  if (r.fssaiLicense) {
    lines.push(center(`FSSAI Lic: ${r.fssaiLicense}`));
  }
  lines.push("");
  lines.push(center(payload.footer || "Thank you for dining with us!"));
  return lines.join(LF) + LF;
}

// ─── Failed-prints store ────────────────────────────────────────────────────
interface FailedPrintsStore {
  list(): FailedPrintEntry[];
  add(entry: FailedPrintEntry): void;
  update(id: string, patch: Partial<FailedPrintEntry>): void;
  remove(id: string): void;
  clear(): void;
}

// ─── Last-job memory (for reprint shortcuts) ────────────────────────────────
let lastKotPayload: OrderKotPayload | null = null;
let lastBillPayload: OrderBillPayload | null = null;

// ─── Scanner state ──────────────────────────────────────────────────────────
const SCAN_RING_MAX = 5;
const scanRing: Array<{ at: number; value: string }> = [];

export interface PrinterDeps {
  sendRawToPrinter: (printerName: string, bytes: Buffer) => Promise<void>;
  escposBytes: typeof escposBytes;
  getAssignments: () => PrinterAssignments;
  setAssignments: (patch: Partial<PrinterAssignments>) => PrinterAssignments;
  getDrawerSettings: () => DrawerSettings;
  setDrawerSettings: (patch: Partial<DrawerSettings>) => DrawerSettings;
  getScannerEnabled: () => boolean;
  setScannerEnabled: (v: boolean) => boolean;
  failedStore: FailedPrintsStore;
  notifyFailedChanged: () => void;
}

/**
 * Main-process print engine exposed to ipc/index.ts so the order-create
 * handler can auto-dispatch KOTs and the bill-for-order handler can hand off
 * a pre-built payload without going through IPC.
 */
export interface PrinterEngine {
  dispatchKots(payload: OrderKotPayload): Promise<KotDispatchResult>;
  dispatchBill(payload: OrderBillPayload): Promise<{ ok: true } | { ok: false; error: string }>;
}

function pickKotPrinter(item: OrderKotItem, orderType: string | null | undefined, a: PrinterAssignments): { printer: string | null; label: string } {
  const kid = item.kitchenId != null ? String(item.kitchenId) : null;
  if (kid && a.kitchenPrinters[kid]) {
    return { printer: a.kitchenPrinters[kid], label: item.kitchenName || `Kitchen ${kid}` };
  }
  const ot = (orderType ?? "").toLowerCase();
  if ((ot === "takeaway" || ot === "delivery") && a.parcelPrinter) {
    return { printer: a.parcelPrinter, label: "Parcel" };
  }
  if (item.kitchenName && /bar/i.test(item.kitchenName) && a.barPrinter) {
    return { printer: a.barPrinter, label: item.kitchenName };
  }
  if (item.kitchenName && a.kitchenPrinter) {
    return { printer: a.kitchenPrinter, label: item.kitchenName };
  }
  return { printer: a.kotPrinter, label: item.kitchenName || "Kitchen" };
}

function groupKotItemsByPrinter(payload: OrderKotPayload, a: PrinterAssignments): Map<string, { printer: string | null; label: string; items: OrderKotItem[] }> {
  const groups = new Map<string, { printer: string | null; label: string; items: OrderKotItem[] }>();
  for (const item of payload.items) {
    const { printer, label } = pickKotPrinter(item, payload.orderType, a);
    const key = printer ? `p:${printer}` : `nop:${label}`;
    const g = groups.get(key) ?? { printer, label, items: [] };
    g.items.push(item);
    groups.set(key, g);
  }
  return groups;
}

export function registerPrinterHandlers(deps: PrinterDeps): PrinterEngine {
  // ─── Backoff scheduler ──────────────────────────────────────────────────
  const retryTimers = new Map<string, NodeJS.Timeout>();

  const scheduleAutoRetry = (entry: FailedPrintEntry): void => {
    const next = RETRY_BACKOFF_MS[entry.attempts];
    if (next == null) return; // exhausted — leaves entry for manual retry
    const at = Date.now() + next;
    deps.failedStore.update(entry.id, { nextRetryAt: at });
    deps.notifyFailedChanged();
    const t = setTimeout(() => {
      retryTimers.delete(entry.id);
      void attemptAutoRetry(entry.id);
    }, next);
    retryTimers.set(entry.id, t);
  };

  const cancelAutoRetry = (id: string): void => {
    const t = retryTimers.get(id);
    if (t) { clearTimeout(t); retryTimers.delete(id); }
  };

  const attemptAutoRetry = async (id: string): Promise<void> => {
    const current = deps.failedStore.list().find((x) => x.id === id);
    if (!current) return;
    const r = await replayJob(current);
    if (r.ok) {
      deps.failedStore.remove(id);
      deps.notifyFailedChanged();
      return;
    }
    const attempts = current.attempts + 1;
    deps.failedStore.update(id, { attempts, error: r.error, nextRetryAt: null });
    const refreshed = deps.failedStore.list().find((x) => x.id === id);
    if (refreshed) scheduleAutoRetry(refreshed);
    else deps.notifyFailedChanged();
  };

  const replayJob = async (entry: FailedPrintEntry): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      if (entry.kind === "kot" && entry.printerName) {
        const grouped = entry.payload as OrderKotPayload;
        if (grouped && Array.isArray(grouped.items)) {
          const text = formatKotText({
            payload: grouped,
            kitchenLabel: entry.summary.split("·")[1]?.trim() || "Kitchen",
            items: grouped.items,
          });
          await deps.sendRawToPrinter(entry.printerName, deps.escposBytes(text, { cut: true }));
          return { ok: true };
        }
        const raw = entry.payload as KotPrintRequest;
        await deps.sendRawToPrinter(entry.printerName, deps.escposBytes(
          (raw?.stationLabel ? `*** ${raw.stationLabel} ***\n` : "") + (raw?.text ?? ""), { cut: true },
        ));
        return { ok: true };
      }
      if (entry.kind === "bill" && entry.printerName) {
        const bill = entry.payload as OrderBillPayload;
        if (bill && Array.isArray(bill.items)) {
          await deps.sendRawToPrinter(entry.printerName, deps.escposBytes(formatBillText(bill), { cut: true }));
          return { ok: true };
        }
        const raw = entry.payload as ReceiptPrintRequest;
        await deps.sendRawToPrinter(entry.printerName, deps.escposBytes(raw?.text ?? "", { cut: true }));
        return { ok: true };
      }
      if (entry.kind === "test" && entry.printerName) {
        await deps.sendRawToPrinter(entry.printerName, deps.escposBytes(`RETRY TEST\n${new Date().toLocaleString()}\n`));
        return { ok: true };
      }
      return { ok: false, error: "This job cannot be retried automatically" };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  };

  const failJob = (entry: Omit<FailedPrintEntry, "id" | "at" | "attempts" | "nextRetryAt">): FailedPrintEntry => {
    const full: FailedPrintEntry = {
      ...entry,
      id: `fp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now(),
      attempts: 0,
      nextRetryAt: null,
    };
    deps.failedStore.add(full);
    deps.notifyFailedChanged();
    // Schedule the first backoff retry unless the job is non-retryable
    // (no printer assigned, or no payload).
    if (full.printerName && full.payload) scheduleAutoRetry(full);
    return full;
  };

  const sendOrFail = async (printerName: string, bytes: Buffer, kind: FailedPrintEntry["kind"], summary: string, payload: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      await deps.sendRawToPrinter(printerName, bytes);
      return { ok: true };
    } catch (err) {
      const error = (err as Error).message ?? String(err);
      failJob({ kind, printerName, summary, error, payload });
      return { ok: false, error };
    }
  };

  // ─── Engine: dispatchKots / dispatchBill (callable from main code) ──────
  async function dispatchKots(payload: OrderKotPayload): Promise<KotDispatchResult> {
    const a = deps.getAssignments();
    const groups = groupKotItemsByPrinter(payload, a);
    const printed: KotDispatchResult["printed"] = [];
    const failed: KotDispatchResult["failed"] = [];
    for (const group of groups.values()) {
      if (!group.printer) {
        const summary = `${payload.orderNumber} · ${group.label} · ${group.items.length} items · no printer assigned`;
        failJob({ kind: "kot", printerName: null, summary, error: "No printer assigned for this station", payload: { ...payload, items: group.items } });
        failed.push({ printerName: null, kitchenLabel: group.label, error: "No printer assigned" });
        continue;
      }
      const text = formatKotText({ payload, kitchenLabel: group.label, items: group.items });
      const r = await sendOrFail(
        group.printer,
        deps.escposBytes(text, { cut: true }),
        "kot",
        `${payload.orderNumber} · ${group.label} · ${group.items.length} items`,
        { ...payload, items: group.items },
      );
      if (r.ok) {
        printed.push({ printerName: group.printer, itemCount: group.items.length, kitchenLabel: group.label });
      } else {
        failed.push({ printerName: group.printer, kitchenLabel: group.label, error: r.error });
      }
    }
    lastKotPayload = payload;
    return { printed, failed };
  }

  async function dispatchBill(payload: OrderBillPayload): Promise<{ ok: true } | { ok: false; error: string }> {
    const a = deps.getAssignments();
    const target = a.billPrinter;
    if (!target) {
      failJob({ kind: "bill", printerName: null, summary: `Bill ${payload.orderNumber} · no printer assigned`, error: "No bill printer configured", payload });
      return { ok: false, error: "No bill printer configured. Assign one in Settings → Printers." };
    }
    const text = formatBillText(payload);
    const copies = Math.max(1, Math.min(5, payload.copies ?? 1));
    const drawerBefore = deps.getDrawerSettings().kickBefore;
    let firstError: string | null = null;
    for (let i = 0; i < copies; i++) {
      const r = await sendOrFail(
        target,
        deps.escposBytes(text, {
          cut: true,
          drawer: !!payload.openDrawer && i === copies - 1,
          drawerBefore,
        }),
        "bill",
        `${payload.orderNumber} · Bill`,
        payload,
      );
      if (!r.ok && !firstError) firstError = r.error;
    }
    lastBillPayload = payload;
    if (firstError) return { ok: false, error: firstError };
    return { ok: true };
  }

  // ─── IPC handlers ───────────────────────────────────────────────────────
  ipcMain.handle("printers:list", async (e): Promise<IpcResult<OsPrinter[]>> => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win) return { ok: false, error: "no window" };
      const list = await win.webContents.getPrintersAsync();
      return { ok: true, data: list.map((p) => ({ name: p.name, isDefault: p.isDefault })) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("printers:get-assignments", (): IpcResult<PrinterAssignments> => ({
    ok: true, data: deps.getAssignments(),
  }));

  ipcMain.handle("printers:assign", (_e, req: unknown): IpcResult<PrinterAssignments> => {
    if (!req || typeof req !== "object") return { ok: false, error: "invalid request" };
    const r = req as { role?: PrinterRole; kitchenId?: number; printerName: string | null };
    const printer = r.printerName ?? null;
    const current = deps.getAssignments();
    if (r.role) {
      const roleMap: Record<PrinterRole, keyof PrinterAssignments> = {
        bill: "billPrinter",
        kot: "kotPrinter",
        kitchen: "kitchenPrinter",
        bar: "barPrinter",
        parcel: "parcelPrinter",
        cashDrawer: "cashDrawerPrinter",
      };
      const key = roleMap[r.role];
      if (!key) return { ok: false, error: `unknown role: ${r.role}` };
      const next = deps.setAssignments({ [key]: printer } as Partial<PrinterAssignments>);
      return { ok: true, data: next };
    }
    if (typeof r.kitchenId === "number") {
      const kp = { ...current.kitchenPrinters };
      if (printer) kp[String(r.kitchenId)] = printer;
      else delete kp[String(r.kitchenId)];
      const next = deps.setAssignments({ kitchenPrinters: kp });
      return { ok: true, data: next };
    }
    return { ok: false, error: "Provide a role or kitchenId" };
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
      const error = (err as Error).message;
      failJob({ kind: "test", printerName, summary: `Test print → ${printerName}`, error, payload: { printerName } });
      return { ok: false, error };
    }
  });

  ipcMain.handle("printers:print-receipt", async (_e, payload: ReceiptPrintRequest): Promise<IpcResult<true>> => {
    if (!payload || typeof payload.text !== "string") return { ok: false, error: "invalid payload" };
    const target = payload.printerName ?? deps.getAssignments().billPrinter;
    if (!target) return { ok: false, error: "No bill printer configured" };
    try {
      const copies = Math.max(1, Math.min(5, payload.copies ?? 1));
      const drawerBefore = deps.getDrawerSettings().kickBefore;
      for (let i = 0; i < copies; i++) {
        await deps.sendRawToPrinter(target, deps.escposBytes(payload.text, {
          cut: true,
          drawer: !!payload.openDrawer && i === copies - 1,
          drawerBefore,
        }));
      }
      return { ok: true, data: true };
    } catch (err) {
      const error = (err as Error).message;
      failJob({ kind: "bill", printerName: target, summary: `Bill (raw) → ${target}`, error, payload });
      return { ok: false, error };
    }
  });

  ipcMain.handle("printers:print-kot", async (_e, payload: KotPrintRequest): Promise<IpcResult<true>> => {
    if (!payload || typeof payload.text !== "string") return { ok: false, error: "invalid payload" };
    const target = payload.printerName ?? deps.getAssignments().kotPrinter;
    if (!target) return { ok: false, error: "No KOT printer configured" };
    try {
      const header = payload.stationLabel ? `*** ${payload.stationLabel} ***\n` : "";
      await deps.sendRawToPrinter(target, deps.escposBytes(header + payload.text, { cut: true }));
      return { ok: true, data: true };
    } catch (err) {
      const error = (err as Error).message;
      failJob({ kind: "kot", printerName: target, summary: `KOT (raw) → ${target}`, error, payload });
      return { ok: false, error };
    }
  });

  ipcMain.handle("printers:print-order-kots", async (_e, payload: OrderKotPayload): Promise<IpcResult<KotDispatchResult>> => {
    if (!payload || !Array.isArray(payload.items)) return { ok: false, error: "invalid payload" };
    return { ok: true, data: await dispatchKots(payload) };
  });

  ipcMain.handle("printers:print-order-bill", async (_e, payload: OrderBillPayload): Promise<IpcResult<true>> => {
    if (!payload || !Array.isArray(payload.items)) return { ok: false, error: "invalid payload" };
    const r = await dispatchBill(payload);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, data: true };
  });

  ipcMain.handle("printers:reprint-last-kot", async (): Promise<IpcResult<KotDispatchResult | null>> => {
    if (!lastKotPayload) return { ok: true, data: null };
    return { ok: true, data: await dispatchKots(lastKotPayload) };
  });

  ipcMain.handle("printers:reprint-last-bill", async (): Promise<IpcResult<true | null>> => {
    if (!lastBillPayload) return { ok: true, data: null };
    const r = await dispatchBill(lastBillPayload);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, data: true };
  });

  ipcMain.handle("drawer:open", async (_e, req?: { printerName?: string }): Promise<IpcResult<true>> => {
    const a = deps.getAssignments();
    const target = req?.printerName ?? a.cashDrawerPrinter ?? a.billPrinter;
    if (!target) return { ok: false, error: "No drawer-capable printer configured" };
    try {
      await deps.sendRawToPrinter(target, kickCashDrawerCommand());
      return { ok: true, data: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("drawer:get-settings", (): IpcResult<DrawerSettings> => ({
    ok: true, data: deps.getDrawerSettings(),
  }));
  ipcMain.handle("drawer:set-settings", (_e, patch: Partial<DrawerSettings>): IpcResult<DrawerSettings> => ({
    ok: true, data: deps.setDrawerSettings(patch ?? {}),
  }));

  ipcMain.handle("failed-prints:list", (): IpcResult<FailedPrintEntry[]> => ({
    ok: true, data: deps.failedStore.list(),
  }));

  ipcMain.handle("failed-prints:add", (_e, entry: unknown): IpcResult<true> => {
    failJob({
      kind: "raw",
      printerName: null,
      summary: typeof entry === "string" ? entry.slice(0, 64) : "Renderer-reported failure",
      error: "Reported by renderer",
      payload: entry,
    });
    return { ok: true, data: true };
  });

  ipcMain.handle("failed-prints:retry", async (_e, req: { id: string }): Promise<IpcResult<true>> => {
    const entry = deps.failedStore.list().find((x) => x.id === req?.id);
    if (!entry) return { ok: false, error: "Job not found (may have been cleared)" };
    if (!entry.payload) return { ok: false, error: "Original payload no longer available — please re-run the action" };
    cancelAutoRetry(entry.id);
    const r = await replayJob(entry);
    if (!r.ok) {
      const attempts = entry.attempts + 1;
      deps.failedStore.update(entry.id, { attempts, error: r.error, nextRetryAt: null });
      const refreshed = deps.failedStore.list().find((x) => x.id === entry.id);
      if (refreshed) scheduleAutoRetry(refreshed);
      else deps.notifyFailedChanged();
      return { ok: false, error: r.error };
    }
    deps.failedStore.remove(entry.id);
    deps.notifyFailedChanged();
    return { ok: true, data: true };
  });

  ipcMain.handle("failed-prints:discard", (_e, req: { id: string }): IpcResult<true> => {
    cancelAutoRetry(req?.id);
    deps.failedStore.remove(req?.id);
    deps.notifyFailedChanged();
    return { ok: true, data: true };
  });

  ipcMain.handle("failed-prints:clear", (): IpcResult<true> => {
    for (const id of retryTimers.keys()) cancelAutoRetry(id);
    deps.failedStore.clear();
    deps.notifyFailedChanged();
    return { ok: true, data: true };
  });

  ipcMain.handle("scanner:get-state", (): IpcResult<{ enabled: boolean; lastScans: Array<{ at: number; value: string }> }> => ({
    ok: true, data: { enabled: deps.getScannerEnabled(), lastScans: [...scanRing] },
  }));

  ipcMain.handle("scanner:set-enabled", (_e, req: { enabled: boolean }): IpcResult<{ enabled: boolean }> => {
    const next = deps.setScannerEnabled(!!req?.enabled);
    return { ok: true, data: { enabled: next } };
  });

  ipcMain.handle("scanner:record-scan", (_e, req: { value: string }): IpcResult<{ lastScans: Array<{ at: number; value: string }> }> => {
    const value = String(req?.value ?? "").slice(0, 128);
    if (!value) return { ok: false, error: "empty scan" };
    scanRing.unshift({ at: Date.now(), value });
    if (scanRing.length > SCAN_RING_MAX) scanRing.length = SCAN_RING_MAX;
    return { ok: true, data: { lastScans: [...scanRing] } };
  });

  ipcMain.handle("scanner:clear-scans", (): IpcResult<true> => {
    scanRing.length = 0;
    return { ok: true, data: true };
  });

  return { dispatchKots, dispatchBill };
}
