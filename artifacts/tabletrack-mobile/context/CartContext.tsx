import React, { createContext, useContext, useState, useCallback } from "react";

export type OrderTypeChoice = "dine_in" | "takeaway" | "delivery" | "qr" | "curbside" | "pre_order";

export interface CartModifier {
  modifierId: number;
  groupId: number;
  name: string;
  priceDelta: number;
}

export interface CartItem {
  /** Unique id per cart line (allows same menu item with diff modifiers). */
  lineId: string;
  menuItemId: number;
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string | null;
  modifiers?: CartModifier[];
  note?: string | null;
}

interface CartContext {
  orderType: OrderTypeChoice | null;
  restaurantId: number | null;
  tableId: number | null;
  tableLabel?: string | null;
  tableToken: string | null;
  customer: { name?: string; phone?: string; address?: string } | null;
}

interface CartState extends CartContext {
  items: CartItem[];
}

interface CartContextType {
  cart: CartState;
  /** Begin a fresh flow with a chosen order type. Resets items. */
  startOrder: (orderType: OrderTypeChoice) => void;
  /** Legacy/dine-in helper that also clears state. */
  setTable: (restaurantId: number, tableId: number, token: string, label?: string | null) => void;
  /** Attach table to current in-progress cart without clearing items. */
  attachTable: (restaurantId: number, tableId: number, label?: string | null) => void;
  attachCustomer: (c: { name?: string; phone?: string; address?: string }) => void;
  addLine: (item: Omit<CartItem, "lineId" | "quantity"> & { quantity?: number }) => void;
  updateQuantity: (lineId: string, delta: number) => void;
  removeLine: (lineId: string) => void;
  updateNote: (lineId: string, note: string) => void;
  /** Back-compat: add by menuItemId, merge with line that has no modifiers. */
  addItem: (item: { menuItemId: number; name: string; price: number; imageUrl?: string | null }) => void;
  removeItem: (menuItemId: number) => void;
  clearCart: () => void;
  total: number;
  itemCount: number;
}

const Ctx = createContext<CartContextType | null>(null);

function uid() { return `l_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

const EMPTY: CartState = {
  orderType: null, restaurantId: null, tableId: null, tableLabel: null,
  tableToken: null, customer: null, items: [],
};

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<CartState>(EMPTY);

  const startOrder = useCallback((orderType: OrderTypeChoice) => {
    setCart({ ...EMPTY, orderType });
  }, []);

  const setTable = useCallback((restaurantId: number, tableId: number, token: string, label?: string | null) => {
    setCart({ ...EMPTY, orderType: "dine_in", restaurantId, tableId, tableLabel: label ?? null, tableToken: token });
  }, []);

  const attachTable = useCallback((restaurantId: number, tableId: number, label?: string | null) => {
    setCart((prev) => ({ ...prev, restaurantId, tableId, tableLabel: label ?? prev.tableLabel ?? null, orderType: prev.orderType ?? "dine_in" }));
  }, []);

  const attachCustomer = useCallback((c: { name?: string; phone?: string; address?: string }) => {
    setCart((prev) => ({ ...prev, customer: { ...(prev.customer ?? {}), ...c } }));
  }, []);

  const sameMods = (a: CartModifier[] | undefined, b: CartModifier[] | undefined) => {
    const ax = (a ?? []).map((m) => m.modifierId).sort();
    const bx = (b ?? []).map((m) => m.modifierId).sort();
    if (ax.length !== bx.length) return false;
    return ax.every((v, i) => v === bx[i]);
  };

  const addLine = useCallback((item: Omit<CartItem, "lineId" | "quantity"> & { quantity?: number }) => {
    setCart((prev) => {
      const qty = item.quantity ?? 1;
      const existing = prev.items.find((i) => i.menuItemId === item.menuItemId && sameMods(i.modifiers, item.modifiers) && (i.note ?? "") === (item.note ?? ""));
      if (existing) {
        return { ...prev, items: prev.items.map((i) => i.lineId === existing.lineId ? { ...i, quantity: i.quantity + qty } : i) };
      }
      return { ...prev, items: [...prev.items, { ...item, quantity: qty, lineId: uid() }] };
    });
  }, []);

  const addItem = useCallback((it: { menuItemId: number; name: string; price: number; imageUrl?: string | null }) => {
    addLine({ ...it, modifiers: [], note: null });
  }, [addLine]);

  const updateQuantity = useCallback((lineId: string, delta: number) => {
    setCart((prev) => ({
      ...prev,
      items: prev.items
        .map((i) => i.lineId === lineId ? { ...i, quantity: i.quantity + delta } : i)
        .filter((i) => i.quantity > 0),
    }));
  }, []);

  const removeLine = useCallback((lineId: string) => {
    setCart((prev) => ({ ...prev, items: prev.items.filter((i) => i.lineId !== lineId) }));
  }, []);

  const removeItem = useCallback((menuItemId: number) => {
    setCart((prev) => ({ ...prev, items: prev.items.filter((i) => i.menuItemId !== menuItemId) }));
  }, []);

  const updateNote = useCallback((lineId: string, note: string) => {
    setCart((prev) => ({ ...prev, items: prev.items.map((i) => i.lineId === lineId ? { ...i, note } : i) }));
  }, []);

  const clearCart = useCallback(() => setCart(EMPTY), []);

  const total = cart.items.reduce((s, i) => {
    const mods = (i.modifiers ?? []).reduce((m, x) => m + (x.priceDelta || 0), 0);
    return s + (i.price + mods) * i.quantity;
  }, 0);
  const itemCount = cart.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <Ctx.Provider value={{
      cart, startOrder, setTable, attachTable, attachCustomer,
      addLine, addItem, updateQuantity, removeLine, removeItem, updateNote,
      clearCart, total, itemCount,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
