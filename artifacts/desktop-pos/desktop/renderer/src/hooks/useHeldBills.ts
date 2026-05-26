/**
 * Hold/recall persistence for in-progress carts.
 *
 * "Held bills" are local-only — they let a cashier park a draft order
 * (items selected, customer/table chosen, etc.) and recall it later. We
 * persist to localStorage so reloads / app restarts don't drop them.
 *
 * NOTE: Held bills only carry the items the cashier picked from the menu;
 * once they are recalled the cashier still hits F2 to create the server
 * order. We never send "held" data to the backend.
 */
import { useCallback, useEffect, useState } from "react";
import type { CartLine } from "../screens/order/types";

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

function read(): HeldBill[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as HeldBill[];
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch { return []; }
}

function write(bills: HeldBill[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bills.slice(0, MAX_HELD))); } catch { /* ignore */ }
}

export function useHeldBills() {
  const [bills, setBills] = useState<HeldBill[]>(() => read());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setBills(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const hold = useCallback((bill: Omit<HeldBill, "id" | "createdAt">) => {
    const id = `held_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const next: HeldBill = { ...bill, id, createdAt: Date.now() };
    setBills(prev => {
      const out = [next, ...prev].slice(0, MAX_HELD);
      write(out);
      return out;
    });
    return id;
  }, []);

  const remove = useCallback((id: string) => {
    setBills(prev => {
      const out = prev.filter(b => b.id !== id);
      write(out);
      return out;
    });
  }, []);

  const clear = useCallback(() => {
    setBills([]);
    write([]);
  }, []);

  return { bills, hold, remove, clear };
}
