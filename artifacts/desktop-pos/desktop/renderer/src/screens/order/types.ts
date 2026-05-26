/**
 * Shared cart / totals shape used across the desktop POS order workspace.
 *
 * Math mirrors the web POS (artifacts/restaurant-platform/src/pages/pos.tsx
 * lines 1525–1551) and the server-side compute in
 * artifacts/api-server/src/routes/orders.ts L606–609 so the local estimate
 * shown before placement matches what the server will write.
 */

import type {
  MenuItem, ModifierOption, OrderDetailView,
} from "../../../../shared/ipc-contract";

export interface CartModifier {
  modifierId?: number;
  groupId?: number;
  name: string;
  price: number;
}

export interface CartItem {
  lineKey: string;
  menuItemId: number;
  name: string;
  basePrice: number;
  modifiers: CartModifier[];
  unitPrice: number;
  quantity: number;
  notes?: string;
}

export interface Totals {
  subtotal: number;
  taxAmount: number;
  serviceCharge: number;
  discountAmount: number;
  totalAmount: number;
}

/** Distinct lines per (item + modifier permutation). */
export function makeLineKey(menuItemId: number, mods: CartModifier[]): string {
  if (mods.length === 0) return `i:${menuItemId}`;
  const tag = mods
    .map(m => `${m.modifierId ?? ""}|${m.name}|${m.price}`)
    .sort()
    .join(";");
  return `i:${menuItemId}#${tag}`;
}

export function computeLocalTotals(cart: CartItem[], taxRate: number, serviceRate: number): Totals {
  const subtotal = cart.reduce((s, c) => s + c.unitPrice * c.quantity, 0);
  const taxAmount = subtotal * taxRate;
  const serviceCharge = subtotal * serviceRate;
  const totalAmount = Math.max(0, subtotal + taxAmount + serviceCharge);
  return { subtotal, taxAmount, serviceCharge, discountAmount: 0, totalAmount };
}

export function fromServerTotals(detail: OrderDetailView): Totals {
  return {
    subtotal: Number(detail.subtotal),
    taxAmount: Number(detail.taxAmount),
    serviceCharge: Number(detail.serviceCharge),
    discountAmount: Number(detail.discountAmount),
    totalAmount: Number(detail.totalAmount),
  };
}

export function buildCartItem(item: MenuItem, mods: CartModifier[]): CartItem {
  const base = Number(item.price) || 0;
  const unitPrice = base + mods.reduce((s, m) => s + m.price, 0);
  return {
    lineKey: makeLineKey(item.id, mods),
    menuItemId: item.id,
    name: item.name,
    basePrice: base,
    modifiers: mods,
    unitPrice,
    quantity: 1,
  };
}

export function modifierFromOption(opt: ModifierOption, groupId?: number): CartModifier {
  return {
    modifierId: opt.id,
    groupId: groupId ?? opt.groupId,
    name: opt.name,
    price: Number(opt.price) || 0,
  };
}

export function fmtINR(n: number): string {
  if (!isFinite(n)) return "₹0.00";
  return `₹${n.toFixed(2)}`;
}
