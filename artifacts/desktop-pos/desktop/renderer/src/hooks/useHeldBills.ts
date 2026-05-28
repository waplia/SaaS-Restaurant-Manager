/**
 * Hold/recall persistence for in-progress carts.
 *
 * "Held bills" are local-only — they let a cashier park a draft order
 * (items selected, customer/table chosen, etc.) and recall it later. As of
 * Phase 5+ we mirror to SQLite via the main process so they survive an
 * Electron crash and show up in the Sync Center. localStorage stays as a
 * fast read cache + fallback for the in-browser dev shell.
 *
 * NOTE: Held bills only carry the items the cashier picked from the menu;
 * once they are recalled the cashier still hits F2 to create the server
 * order. We never send "held" data to the backend.
 */
import { useCallback, useEffect, useState } from "react";
import type { CartLine } from "../screens/order/types";
import type { HeldBillRecord } from "../../../shared/ipc-contract";

export interface HeldBill {
  id: string;
  label: string;
  createdAt: number;
  orderType: import("../../../shared/ipc-contract").OrderType;
  tableId?: number | null;
  tableLabel?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  lines: CartLine[];
  /** Free-form note attached to the bill (e.g., "couple at window"). */
  note?: string | null;
  /** Cashier who held the bill. */
  cashier?: string | null;
}

const STORAGE_KEY = "kp:heldBills";
const MAX_HELD = 50;

function readLocal(): HeldBill[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as HeldBill[];
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch { return []; }
}

function writeLocal(bills: HeldBill[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bills.slice(0, MAX_HELD))); } catch { /* ignore */ }
}

function bridge() {
  return (window as unknown as { khanalagao?: { heldBills?: {
    list(): Promise<HeldBillRecord[]>;
    save(b: HeldBillRecord): Promise<HeldBillRecord>;
    remove(req: { id: string }): Promise<true>;
    clear(): Promise<true>;
  } } }).khanalagao?.heldBills;
}

function fromRecord(r: HeldBillRecord): HeldBill {
  return {
    id: r.id, label: r.label, createdAt: r.createdAt,
    orderType: r.orderType, tableId: r.tableId ?? null, tableLabel: r.tableLabel ?? null,
    customerName: r.customerName ?? null, customerPhone: r.customerPhone ?? null,
    note: r.note ?? null, cashier: r.cashier ?? null,
    lines: Array.isArray(r.lines) ? (r.lines as CartLine[]) : [],
  };
}

function toRecord(b: HeldBill): HeldBillRecord {
  return {
    id: b.id, label: b.label, createdAt: b.createdAt, orderType: b.orderType,
    tableId: b.tableId ?? null, tableLabel: b.tableLabel ?? null,
    customerName: b.customerName ?? null, customerPhone: b.customerPhone ?? null,
    cashier: b.cashier ?? null, note: b.note ?? null,
    lines: b.lines,
  };
}

export function useHeldBills() {
  const [bills, setBills] = useState<HeldBill[]>(() => readLocal());

  // Initial mirror-read from main on mount — replaces localStorage seed if
  // main has authoritative rows (e.g., after a crash recovery).
  useEffect(() => {
    const h = bridge();
    if (!h) return;
    h.list().then((rows) => {
      if (rows && rows.length > 0) {
        const mapped = rows.map(fromRecord);
        setBills(mapped);
        writeLocal(mapped);
      }
    }).catch(() => { /* ignore — fall back to localStorage */ });
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setBills(readLocal());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const hold = useCallback((bill: Omit<HeldBill, "id" | "createdAt">) => {
    const id = `held_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const next: HeldBill = { ...bill, id, createdAt: Date.now() };
    setBills(prev => {
      const out = [next, ...prev].slice(0, MAX_HELD);
      writeLocal(out);
      return out;
    });
    bridge()?.save(toRecord(next)).catch(() => { /* localStorage still has it */ });
    return id;
  }, []);

  const remove = useCallback((id: string) => {
    setBills(prev => {
      const out = prev.filter(b => b.id !== id);
      writeLocal(out);
      return out;
    });
    bridge()?.remove({ id }).catch(() => { /* ignore */ });
  }, []);

  const clear = useCallback(() => {
    setBills([]);
    writeLocal([]);
    bridge()?.clear().catch(() => { /* ignore */ });
  }, []);

  return { bills, hold, remove, clear };
}
