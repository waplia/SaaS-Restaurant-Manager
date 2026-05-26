/**
 * Order entry workspace — Phase 2.
 *
 * Mirrors the business rules of the web POS (artifacts/restaurant-platform
 * /src/pages/pos.tsx) in a native three-pane layout:
 *
 *   ┌────────┬─────────────────────────┬─────────────────────────┐
 *   │ Live   │ Categories │ Item grid  │  Cart + totals          │
 *   │ orders │ + search   │ + filters  │  (send / discount / +-) │
 *   └────────┴─────────────────────────┴─────────────────────────┘
 *
 * No HTTP runs in the renderer — every fetch / mutate is an IPC call into
 * the main process via `window.khanalagao.*`.
 *
 * Keyboard contract (spec-driven):
 *   F2  focus item search        F3  focus cart
 *   F4  send order / add items   Del remove selected (or last) cart line
 *   + / − adjust qty of selected cart line
 *   ?  open shortcut help        Esc close any modal
 *   /  also focuses item search (mouse-free typing)
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import type {
  CartItemInput, CustomerSummary, DiscountsConfig, FloorTable, MenuCategory,
  MenuItem, OrderDetailView, OrderType, RestaurantInfo,
} from "../../../shared/ipc-contract";
import { Banner, Button, Spinner, colors } from "../ui/components";
import { LiveOrdersRail } from "./order/LiveOrdersRail";
import { MenuPane } from "./order/MenuPane";
import { CartPane } from "./order/CartPane";
import {
  CustomerModal, DiscountModal, HelpModal, ModifierModal, TablePickerModal,
} from "./order/Modals";
import { PaymentModal } from "./order/PaymentModal";
import { SplitBillModal } from "./order/SplitBillModal";
import { HeldBillsModal } from "./order/HeldBillsModal";
import { CalculatorModal } from "./order/CalculatorModal";
import {
  type CartItem, type CartModifier, buildCartItem, computeLocalTotals,
  fmtINR, fromServerTotals,
} from "./order/types";
import { useSounds } from "../hooks/useSounds";
import { useAppPrefs } from "../hooks/useAppPrefs";
import { useHeldBills, type HeldBill } from "../hooks/useHeldBills";

const ORDER_TYPES: Array<{ key: OrderType; label: string }> = [
  { key: "dine_in", label: "Dine-in" },
  { key: "takeaway", label: "Takeaway" },
  { key: "delivery", label: "Delivery" },
];

export type WorkspaceHandoff =
  | { kind: "table"; tableId: number; orderId?: number | null }
  | { kind: "order"; orderId: number }
  | { kind: "customer"; customer: CustomerSummary };

interface OrderWorkspaceProps {
  /** A request from another screen (Tables / QR / Customers) to focus a
   *  specific table, resume a specific order, or attach a customer to the
   *  current cart. Consumed exactly once. */
  handoff?: WorkspaceHandoff | null;
  /** Called after the workspace has applied the handoff so the parent can
   *  clear it. */
  onHandoffConsumed?: () => void;
}

const DRAFT_KEY = "kp:draftCart:v1";
interface DraftCartV1 {
  v: 1;
  cart: CartItem[];
  orderType: OrderType;
  tableId: number | null;
  walkInName: string;
  walkInPhone: string;
  customer: CustomerSummary | null;
  savedAt: number;
}

export function OrderWorkspace(props: OrderWorkspaceProps = {}) {
  // Phase 5 — mirror connectivity into local state so the pay modal can
  // gate non-cash tenders without prop-drilling from the App shell.
  const [online, setOnline] = useState<boolean>(true);
  useEffect(() => {
    window.khanalagao.connectivity.get().then((s) => setOnline(s.online)).catch(() => undefined);
    const off = window.khanalagao.connectivity.onChange((s) => setOnline(s.online));
    return () => { off(); };
  }, []);
  // ─── Data state ────────────────────────────────────────────────────
  const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<FloorTable[]>([]);
  const [discountsCfg, setDiscountsCfg] = useState<DiscountsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  // ─── UI state ──────────────────────────────────────────────────────
  const [orderType, setOrderType] = useState<OrderType>("dine_in");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCat, setSelectedCat] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [vegFilter, setVegFilter] = useState<"all" | "veg" | "non_veg">("all");

  const [selectedTable, setSelectedTable] = useState<FloorTable | null>(null);
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");

  const [placedOrder, setPlacedOrder] = useState<OrderDetailView | null>(null);
  const [sending, setSending] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [ordersRailToken, setOrdersRailToken] = useState(0);
  const [railOpen, setRailOpen] = useState(false); // collapsed by default per spec
  const [selectedCartIdx, setSelectedCartIdx] = useState<number | null>(null);

  // Stable per-action idempotency keys. Generated once when the cashier
  // arms a send / discount and cleared *only* on success — retries (network
  // hiccup, double-click) reuse the same UUID so the API collapses dupes.
  const sendKeyRef = useRef<string | null>(null);
  function takeSendKey(): string {
    if (!sendKeyRef.current) sendKeyRef.current = crypto.randomUUID();
    return sendKeyRef.current;
  }
  function clearSendKey() { sendKeyRef.current = null; }

  // Modals
  const [modItem, setModItem] = useState<
    | { mode: "add"; item: MenuItem }
    | { mode: "edit"; item: MenuItem; lineKey: string; initialIds: number[] }
    | null
  >(null);
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [showCustomer, setShowCustomer] = useState(false);
  const [showDiscount, setShowDiscount] = useState<
    | null
    | { kind: "order" }
    | { kind: "line"; orderItemId: number; label: string }
  >(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [showHeld, setShowHeld] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  // Round-off was previously toggleable locally, but the backend `pay`
  // call uses the unrounded server total, so a cashier-visible mismatch
  // could appear at tender time. Disabled until backend round-off lands.
  const roundOffEnabled = false;
  const anyModalOpen =
    !!modItem || showTablePicker || showCustomer || !!showDiscount || showHelp
    || showPay || showSplit || showHeld || showCalc;

  // ─── Renderer-only hooks (sounds, prefs, held bills) ───────────────
  const { play } = useSounds();
  const { prefs, update } = useAppPrefs();
  const heldBills = useHeldBills();

  const searchRef = useRef<HTMLInputElement | null>(null);
  const cartListRef = useRef<HTMLDivElement | null>(null);

  // ─── Bootstrap ─────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [r, menu, tbl, cfg] = await Promise.all([
          window.khanalagao.menu.restaurant(),
          window.khanalagao.menu.list(),
          window.khanalagao.tables.list().catch(() => [] as FloorTable[]),
          window.khanalagao.discounts.config().catch(() => ({}) as DiscountsConfig),
        ]);
        if (!alive) return;
        setRestaurant(r);
        setCategories(menu.categories);
        setItems(menu.items);
        setTables(tbl);
        setDiscountsCfg(cfg);
      } catch (e) {
        if (alive) setBootError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Periodic table refresh (15s) so occupied/free state stays current
  // without a manual reload — matches the web POS floor view.
  useEffect(() => {
    let alive = true;
    const id = window.setInterval(() => {
      window.khanalagao.tables.list()
        .then(t => { if (alive) setTables(t); })
        .catch(() => { /* transient — keep last good list */ });
    }, 15_000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  // ─── Draft cart autosave + restore ─────────────────────────────────
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as DraftCartV1;
      if (!d || d.v !== 1 || !Array.isArray(d.cart) || d.cart.length === 0) return;
      setCart(d.cart);
      setOrderType(d.orderType);
      setWalkInName(d.walkInName ?? "");
      setWalkInPhone(d.walkInPhone ?? "");
      setCustomer(d.customer ?? null);
      // selectedTable is rehydrated after tables load
    } catch { /* ignore corrupted draft */ }
  }, []);

  // Once `tables` is loaded, link up the restored draft's tableId.
  useEffect(() => {
    if (tables.length === 0 || selectedTable) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as DraftCartV1;
      if (d?.v === 1 && d.tableId) {
        const t = tables.find(x => x.id === d.tableId);
        if (t) setSelectedTable(t);
      }
    } catch { /* ignore */ }
  }, [tables, selectedTable]);

  useEffect(() => {
    // Don't autosave once an order is placed — the server is the source of truth.
    if (placedOrder) return;
    try {
      if (cart.length === 0) {
        localStorage.removeItem(DRAFT_KEY);
        return;
      }
      const payload: DraftCartV1 = {
        v: 1, cart, orderType,
        tableId: selectedTable?.id ?? null,
        walkInName, walkInPhone, customer,
        savedAt: Date.now(),
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch { /* ignore quota */ }
  }, [cart, orderType, selectedTable, walkInName, walkInPhone, customer, placedOrder]);

  const taxRate = useMemo(() => (Number(restaurant?.taxRate ?? 0) || 0) / 100, [restaurant]);
  const serviceRate = useMemo(() => (Number(restaurant?.serviceCharge ?? 0) || 0) / 100, [restaurant]);

  const localTotals = useMemo(() => computeLocalTotals(cart, taxRate, serviceRate), [cart, taxRate, serviceRate]);
  const cartQtyByItemId = useMemo(() => {
    const m: Record<number, number> = {};
    for (const c of cart) m[c.menuItemId] = (m[c.menuItemId] ?? 0) + c.quantity;
    return m;
  }, [cart]);
  const totals = placedOrder ? fromServerTotals(placedOrder) : localTotals;

  // ─── Cart ops ──────────────────────────────────────────────────────
  const addItemToCart = useCallback((
    item: MenuItem,
    mods: CartModifier[] = [],
    details?: { notes?: string; quantity?: number },
  ) => {
    if (item.isAvailable === false) {
      setOpError(`${item.name} is 86'd.`);
      play("error");
      return;
    }
    setOpError(null);
    const addQty = Math.max(1, details?.quantity ?? 1);
    setCart(prev => {
      const built = buildCartItem(item, mods);
      if (details?.notes) built.notes = details.notes;
      built.quantity = addQty;
      const existing = prev.find(c => c.lineKey === built.lineKey && (c.notes ?? "") === (built.notes ?? ""));
      if (existing) {
        return prev.map(c => c === existing ? { ...c, quantity: c.quantity + addQty } : c);
      }
      return [...prev, built];
    });
    play("add");
  }, [play]);

  const handlePickItem = useCallback((item: MenuItem) => {
    if (item.hasModifiers) {
      setModItem({ mode: "add", item });
    } else {
      addItemToCart(item);
    }
  }, [addItemToCart]);

  // Opens the modifier picker pre-seeded with the line's current options so
  // the cashier can change choices in-place instead of removing the line.
  const handleEditCartLine = useCallback((line: CartItem) => {
    if (line.modifiers.length === 0) return;
    const menuItem = items.find(i => i.id === line.menuItemId);
    if (!menuItem) return;
    const initialIds = line.modifiers
      .map(m => m.modifierId)
      .filter((x): x is number => typeof x === "number");
    setModItem({ mode: "edit", item: menuItem, lineKey: line.lineKey, initialIds });
  }, [items]);

  // Replace an existing line with a freshly-built one carrying the new
  // modifier set. Preserves quantity and notes.
  const applyEditedModifiers = useCallback((lineKey: string, item: MenuItem, mods: CartModifier[]) => {
    setCart(prev => {
      const old = prev.find(c => c.lineKey === lineKey);
      if (!old) return prev;
      const next = buildCartItem(item, mods);
      next.quantity = old.quantity;
      next.notes = old.notes;
      // Collapse onto an existing identical line if the cashier picked one
      // that already matches another row.
      const duplicate = prev.find(c => c.lineKey === next.lineKey && c.lineKey !== lineKey);
      if (duplicate) {
        return prev
          .filter(c => c.lineKey !== lineKey)
          .map(c => c.lineKey === next.lineKey ? { ...c, quantity: c.quantity + next.quantity } : c);
      }
      return prev.map(c => c.lineKey === lineKey ? next : c);
    });
  }, []);

  const handleQtyDelta = useCallback((lineKey: string, delta: number) => {
    setCart(prev => prev.flatMap(c => {
      if (c.lineKey !== lineKey) return [c];
      const q = c.quantity + delta;
      if (q <= 0) return [];
      return [{ ...c, quantity: q }];
    }));
  }, []);

  const handleRemoveLine = useCallback((lineKey: string) => {
    setCart(prev => prev.filter(c => c.lineKey !== lineKey));
    setSelectedCartIdx(null);
    play("remove");
  }, [play]);

  const handleSetLineNote = useCallback((lineKey: string, note: string) => {
    setCart(prev => prev.map(c => c.lineKey === lineKey ? { ...c, notes: note || undefined } : c));
  }, []);

  // ─── Held bills (hold / recall) ────────────────────────────────────
  const handleHold = useCallback(() => {
    if (cart.length === 0) { setOpError("Nothing in the cart to hold."); play("error"); return; }
    const label = window.prompt("Label this bill (e.g. table or guest name):", selectedTable
      ? `Table ${selectedTable.tableNumber}`
      : (customer?.name ?? walkInName ?? `Bill ${new Date().toLocaleTimeString()}`));
    if (label == null) return;
    heldBills.hold({
      label: label.trim() || "Untitled",
      orderType,
      tableId: selectedTable?.id ?? null,
      tableLabel: selectedTable ? `Table ${selectedTable.tableNumber}` : null,
      customerName: customer?.name ?? walkInName ?? null,
      customerPhone: customer?.phone ?? walkInPhone ?? null,
      lines: cart,
      cashier: prefs.cashierName || undefined,
    });
    setCart([]);
    setSelectedCartIdx(null);
    play("hold");
  }, [cart, selectedTable, customer, walkInName, walkInPhone, orderType, heldBills, prefs.cashierName, play]);

  const handleRecall = useCallback((bill: HeldBill) => {
    setCart(bill.lines);
    setOrderType(bill.orderType);
    setSelectedTable(bill.tableId
      ? tables.find(t => t.id === bill.tableId) ?? null
      : null);
    setWalkInName(bill.customerName ?? "");
    setWalkInPhone(bill.customerPhone ?? "");
    setCustomer(null);
    setShowHeld(false);
    heldBills.remove(bill.id);
  }, [tables, heldBills]);

  // ─── Reprint last KOT ──────────────────────────────────────────────
  const handleReprintKot = useCallback(async () => {
    if (!placedOrder) return;
    try {
      await window.khanalagao.printers.printOrderKots({
        orderNumber: placedOrder.orderNumber,
        items: placedOrder.items.map(it => ({
          name: it.menuItemName,
          quantity: it.quantity,
          kitchenId: it.kitchenId ?? null,
          kitchenName: it.kitchenName ?? null,
          modifiers: (it.modifiers ?? []).map(m => ({ name: m.name })),
          notes: it.notes ?? null,
        })),
      });
      play("kot");
    } catch (e) { setOpError(`KOT reprint failed: ${(e as Error).message}`); play("error"); }
  }, [placedOrder, play]);

  // ─── Resume an existing order ──────────────────────────────────────
  const loadOrderIntoPane = useCallback(async (orderId: number) => {
    setOpError(null);
    try {
      const detail = await window.khanalagao.orders.detail({ id: orderId });
      setPlacedOrder(detail);
      setCart([]);
      setSelectedCartIdx(null);
      if (detail.tableId) {
        const t = tables.find(x => x.id === detail.tableId) ?? null;
        setSelectedTable(t);
      } else {
        setSelectedTable(null);
      }
      setWalkInName(detail.customerName ?? "");
      setWalkInPhone(detail.customerPhone ?? "");
      setCustomer(detail.customerId
        ? { id: detail.customerId, name: detail.customerName, phone: detail.customerPhone }
        : null);
      if (["dine_in", "takeaway", "delivery"].includes(detail.orderType)) {
        setOrderType(detail.orderType as OrderType);
      }
    } catch (e) {
      setOpError((e as Error).message);
    }
  }, [tables]);

  // ─── Pick / reopen a table ─────────────────────────────────────────
  const handlePickTable = useCallback(async (t: FloorTable | null) => {
    setSelectedTable(t);
    if (!t) return;
    // Auto-resume an in-progress order on the chosen table (web POS parity).
    try {
      const { orderId } = await window.khanalagao.tables.activeOrder({ tableId: t.id });
      if (orderId) {
        await loadOrderIntoPane(orderId);
      }
    } catch (e) {
      // Soft-fail: the picker has already attached the table for a new order.
      setOpError(`Couldn't check table status: ${(e as Error).message}`);
    }
  }, [loadOrderIntoPane]);

  // ─── Send order ────────────────────────────────────────────────────
  const buildItemsPayload = useCallback((): CartItemInput[] => {
    return cart.map(c => ({
      menuItemId: c.menuItemId,
      quantity: c.quantity,
      notes: c.notes,
      modifiers: c.modifiers.length > 0
        ? c.modifiers.map(m => ({
            modifierId: m.modifierId,
            name: m.name,
            price: m.price.toFixed(2),
          }))
        : undefined,
    }));
  }, [cart]);

  const startNewOrder = useCallback(() => {
    setPlacedOrder(null);
    setCart([]);
    setSelectedTable(null);
    setCustomer(null);
    setWalkInName("");
    setWalkInPhone("");
    setSelectedCartIdx(null);
    setOpError(null);
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }, []);

  // ─── Cross-screen handoff (Tables / QR / Customers) ────────────────
  const handoffRef = useRef<WorkspaceHandoff | null | undefined>(undefined);
  useEffect(() => {
    const h = props.handoff;
    if (!h || handoffRef.current === h) return;
    // Defer: a free-table handoff arriving before `tables` loads would
    // otherwise no-op and consume the handoff before it can be applied.
    if (h.kind === "table" && !h.orderId && tables.length === 0) return;
    handoffRef.current = h;
    (async () => {
      try {
        if (h.kind === "order") {
          await loadOrderIntoPane(h.orderId);
        } else if (h.kind === "table") {
          if (h.orderId) {
            await loadOrderIntoPane(h.orderId);
          } else {
            const t = tables.find(x => x.id === h.tableId);
            if (t) {
              await handlePickTable(t);
            } else {
              setOpError(`Couldn't find table #${h.tableId} on the floor.`);
            }
          }
        } else if (h.kind === "customer") {
          setCustomer(h.customer);
          if (h.customer.name) setWalkInName(h.customer.name);
          if (h.customer.phone) setWalkInPhone(h.customer.phone);
        }
      } finally {
        props.onHandoffConsumed?.();
      }
    })();
  }, [props.handoff, props, loadOrderIntoPane, handlePickTable, tables]);

  const handleSend = useCallback(async () => {
    if (cart.length === 0) return;
    if (orderType === "dine_in" && !selectedTable && !placedOrder) {
      setOpError("Pick a table for dine-in orders.");
      return;
    }
    setSending(true); setOpError(null);
    const key = takeSendKey();
    try {
      if (placedOrder) {
        const detail = await window.khanalagao.orders.addItems({
          orderId: placedOrder.id,
          items: buildItemsPayload(),
          idempotencyKey: key,
        });
        setPlacedOrder(detail);
      } else {
        // Only attach a tableId for dine-in — takeaway / delivery never
        // carry one, even if the cashier had picked one and switched mode.
        const tableId = orderType === "dine_in" ? (selectedTable?.id ?? null) : null;
        const detail = await window.khanalagao.orders.create({
          orderType,
          tableId,
          customerId: customer?.id ?? null,
          customerName: customer?.name ?? walkInName ?? undefined,
          customerPhone: customer?.phone ?? walkInPhone ?? undefined,
          items: buildItemsPayload(),
          idempotencyKey: key,
        });
        setPlacedOrder(detail);
      }
      setCart([]);
      setSelectedCartIdx(null);
      setOrdersRailToken(t => t + 1);
      clearSendKey();
    } catch (e) {
      // Keep the key — a retry will use the same one and server dedupes.
      setOpError((e as Error).message);
    } finally {
      setSending(false);
    }
  }, [
    cart.length, orderType, selectedTable, placedOrder, buildItemsPayload,
    customer, walkInName, walkInPhone,
  ]);

  // ─── Discount ops ──────────────────────────────────────────────────
  const refreshPlaced = useCallback(async () => {
    if (!placedOrder) return;
    const detail = await window.khanalagao.orders.detail({ id: placedOrder.id });
    setPlacedOrder(detail);
    setOrdersRailToken(t => t + 1);
  }, [placedOrder]);

  // Per-discount stable keys so a click that errors can be retried safely.
  const discountRemoveKeysRef = useRef(new Map<number, string>());
  const handleRemoveDiscount = useCallback(async (discountId: number) => {
    if (!placedOrder) return;
    setSending(true); setOpError(null);
    const map = discountRemoveKeysRef.current;
    if (!map.has(discountId)) map.set(discountId, crypto.randomUUID());
    const key = map.get(discountId)!;
    try {
      const detail = await window.khanalagao.discounts.remove({
        orderId: placedOrder.id, discountId, idempotencyKey: key,
      });
      setPlacedOrder(detail);
      map.delete(discountId);
    } catch (e) {
      setOpError((e as Error).message);
    } finally {
      setSending(false);
    }
  }, [placedOrder]);

  // ─── Keyboard shortcuts ────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Defer to modals' own Esc handlers — and don't hijack typing keys
      // while a modal is showing.
      if (anyModalOpen) return;

      const target = e.target as HTMLElement | null;
      const inField = !!target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);

      if (e.key === "F2") {
        e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return;
      }
      if (e.key === "F3") {
        e.preventDefault(); cartListRef.current?.focus();
        if (selectedCartIdx == null && cart.length > 0) setSelectedCartIdx(cart.length - 1);
        return;
      }
      if (e.key === "F4") { e.preventDefault(); void handleSend(); return; }
      if (e.key === "F5") { e.preventDefault(); cart.length > 0 ? handleHold() : setShowHeld(true); return; }
      if (e.key === "F7") {
        e.preventDefault();
        if (placedOrder) {
          void window.khanalagao.printers.printBillForOrder({ orderId: placedOrder.id })
            .catch((err) => setOpError(`Bill print failed: ${(err as Error).message}`));
        }
        return;
      }
      if (e.key === "F8") {
        e.preventDefault();
        if (placedOrder && placedOrder.paymentStatus !== "paid") setShowPay(true);
        return;
      }
      if (e.key === "F9") { e.preventDefault(); void handleReprintKot(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K" || e.key === "l" || e.key === "L")) {
        e.preventDefault(); setShowCalc(true); return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "n" || e.key === "N")) {
        e.preventDefault(); startNewOrder(); return;
      }
      if (e.key === "?" && !inField) { e.preventDefault(); setShowHelp(true); return; }
      if (e.key === "/" && !inField) {
        e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return;
      }
      if (inField) return;

      // The remaining shortcuts operate on the cart selection (or fall back
      // to the last cart line so muscle-memory keeps working).
      const target0 = selectedCartIdx ?? (cart.length > 0 ? cart.length - 1 : null);
      if (target0 == null) return;
      const line = cart[target0];
      if (!line) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault(); handleRemoveLine(line.lineKey); return;
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault(); handleQtyDelta(line.lineKey, +1); return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault(); handleQtyDelta(line.lineKey, -1); return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    anyModalOpen, cart, selectedCartIdx, handleQtyDelta, handleRemoveLine, handleSend,
    handleHold, handleReprintKot, placedOrder, startNewOrder,
  ]);

  if (loading) {
    return <div style={{ display: "grid", placeItems: "center", height: "100%" }}><Spinner size={28} /></div>;
  }
  if (bootError) {
    return (
      <div style={{ padding: 24 }}>
        <Banner kind="error">Failed to load workspace: {bootError}</Banner>
      </div>
    );
  }

  const customerSummary = customer
    ? `${customer.name ?? "(no name)"}${customer.phone ? ` · ${customer.phone}` : ""}`
    : walkInName || walkInPhone ? `${walkInName || "Guest"}${walkInPhone ? ` · ${walkInPhone}` : ""}` : "";

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `${railOpen ? 220 : 36}px 1fr 360px`,
      height: "100%", minHeight: 0,
    }}>
      <LiveOrdersRail
        activeOrderId={placedOrder?.id ?? null}
        onPick={loadOrderIntoPane}
        refreshToken={ordersRailToken}
        open={railOpen}
        onToggle={() => setRailOpen(o => !o)}
      />

      {/* Centre — order-type tabs + menu pane */}
      <section style={{ display: "flex", flexDirection: "column", minHeight: 0, background: colors.bg }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 16px", borderBottom: `1px solid ${colors.border}`,
          background: colors.panel,
        }}>
          {ORDER_TYPES.map(t => (
            <button
              key={t.key}
              onClick={() => setOrderType(t.key)}
              disabled={!!placedOrder}
              style={{
                background: orderType === t.key ? colors.brand : colors.panelAlt,
                color: orderType === t.key ? "#fff" : colors.textPrimary,
                border: 0, padding: "8px 14px", borderRadius: 6,
                fontWeight: 600, fontSize: 13,
                cursor: placedOrder ? "not-allowed" : "pointer",
                opacity: placedOrder ? 0.6 : 1,
              }}
            >{t.label}</button>
          ))}

          <div style={{ flex: 1 }} />

          {orderType === "dine_in" && (
            <button onClick={() => setShowTablePicker(true)} style={topPill(selectedTable != null)}>
              🪑 {selectedTable ? `Table ${selectedTable.tableNumber}` : "Pick table"}
            </button>
          )}
          <button onClick={() => setShowCustomer(true)} style={topPill(!!customerSummary)}>
            👤 {customerSummary || "Customer"}
          </button>
          <button
            onClick={() => setShowHeld(true)}
            title="Held bills (F5)"
            style={topPill(heldBills.bills.length > 0)}
          >⏸ Held{heldBills.bills.length > 0 ? ` · ${heldBills.bills.length}` : ""}</button>
          <button
            onClick={() => setShowCalc(true)}
            title="Calculator (Ctrl+K / Ctrl+L)"
            style={topPill(false)}
          >🧮 Calc</button>
          {placedOrder && (
            <Button variant="ghost" onClick={startNewOrder}>+ New order</Button>
          )}
          <button onClick={() => setShowHelp(true)} title="Shortcuts (?)" style={{
            background: "transparent", color: colors.textDim, border: 0,
            cursor: "pointer", fontSize: 16, padding: 6,
          }}>?</button>
        </div>

        {opError && (
          <div style={{ padding: 10 }}><Banner kind="error">{opError}</Banner></div>
        )}

        <div style={{ flex: 1, minHeight: 0 }}>
          <MenuPane
            loading={false}
            categories={categories}
            items={items}
            selectedCategoryId={selectedCat}
            onSelectCategory={setSelectedCat}
            search={search}
            onSearch={setSearch}
            vegFilter={vegFilter}
            onVegFilter={setVegFilter}
            onPickItem={handlePickItem}
            searchInputRef={searchRef}
            layout={prefs.menuLayout}
            onLayoutChange={(l) => update({ menuLayout: l })}
            showImages={prefs.showItemImages}
            cartQtyByItemId={cartQtyByItemId}
          />
        </div>

        {/* Status bar */}
        <div style={{
          padding: "6px 14px", fontSize: 11, color: colors.textMuted,
          borderTop: `1px solid ${colors.border}`, background: colors.panel,
          display: "flex", justifyContent: "space-between",
        }}>
          <span>{items.length} items · tax {(taxRate * 100).toFixed(0)}% · service {(serviceRate * 100).toFixed(0)}%</span>
          <span>
            {cart.length} line{cart.length === 1 ? "" : "s"} pending · {fmtINR(localTotals.totalAmount)}
            {" · "}F2 search · F3 cart · F4 send · Del remove · +/− qty · ? help
          </span>
        </div>
      </section>

      <CartPane
        cart={cart}
        placedOrder={placedOrder}
        totals={totals}
        taxRate={taxRate}
        serviceRate={serviceRate}
        customerName={customer?.name ?? walkInName}
        customerPhone={customer?.phone ?? walkInPhone}
        selectedTableLabel={selectedTable ? `Table ${selectedTable.tableNumber}` : null}
        orderType={orderType}
        busy={sending}
        selectedCartIdx={selectedCartIdx}
        onSelectCartIdx={setSelectedCartIdx}
        onEditLine={handleEditCartLine}
        onQtyDelta={handleQtyDelta}
        onRemoveLine={handleRemoveLine}
        onSend={handleSend}
        onClear={() => { setCart([]); setSelectedCartIdx(null); }}
        onOpenDiscount={() => setShowDiscount({ kind: "order" })}
        onOpenLineDiscount={(orderItemId, label) =>
          setShowDiscount({ kind: "line", orderItemId, label })
        }
        onRemoveDiscount={handleRemoveDiscount}
        cashierName={prefs.cashierName || undefined}
        compact={prefs.compactCart}
        roundOffEnabled={roundOffEnabled}
        onHold={handleHold}
        onSetLineNote={handleSetLineNote}
        onReprintKot={placedOrder ? handleReprintKot : undefined}
        onPay={placedOrder ? () => setShowPay(true) : undefined}
        onSplit={placedOrder ? () => setShowSplit(true) : undefined}
        onReprint={placedOrder ? async () => {
          try {
            await window.khanalagao.printers.printBillForOrder({ orderId: placedOrder.id });
          } catch (e) { setOpError((e as Error).message); }
        } : undefined}
        cartListRef={cartListRef}
      />

      {/* Modals */}
      {modItem && (
        <ModifierModal
          item={modItem.item}
          initialModifierIds={modItem.mode === "edit" ? modItem.initialIds : undefined}
          confirmLabel={modItem.mode === "edit" ? "Update line" : undefined}
          onClose={() => setModItem(null)}
          onConfirm={(mods, details) => {
            if (modItem.mode === "edit") {
              applyEditedModifiers(modItem.lineKey, modItem.item, mods);
            } else {
              addItemToCart(modItem.item, mods, details);
            }
            setModItem(null);
          }}
        />
      )}
      {showTablePicker && (
        <TablePickerModal
          tables={tables}
          selectedId={selectedTable?.id ?? null}
          onPick={(t) => { void handlePickTable(t); }}
          onClose={() => setShowTablePicker(false)}
        />
      )}
      {showCustomer && (
        <CustomerModal
          initialQuery={walkInPhone || walkInName}
          onPick={(c, fb) => {
            if (c) {
              setCustomer(c);
              setWalkInName(c.name ?? ""); setWalkInPhone(c.phone ?? "");
            } else {
              setCustomer(null);
              if (fb) { setWalkInName(fb.name); setWalkInPhone(fb.phone); }
            }
          }}
          onClose={() => setShowCustomer(false)}
        />
      )}
      {showDiscount && placedOrder && (
        <DiscountModal
          orderId={placedOrder.id}
          orderItemId={showDiscount.kind === "line" ? showDiscount.orderItemId : undefined}
          lineLabel={showDiscount.kind === "line" ? showDiscount.label : undefined}
          config={discountsCfg}
          onApplied={refreshPlaced}
          onClose={() => setShowDiscount(null)}
        />
      )}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showPay && placedOrder && (
        <PaymentModal
          order={placedOrder}
          online={online}
          onClose={() => setShowPay(false)}
          onPaid={(next) => {
            // Main `orders:pay` already auto-prints the bill and kicks the
            // drawer for cash tenders — do NOT print again here.
            setPlacedOrder(next);
            setShowPay(false);
            setOrdersRailToken(t => t + 1);
          }}
        />
      )}
      {showSplit && placedOrder && (
        <SplitBillModal
          order={placedOrder}
          onClose={() => setShowSplit(false)}
          onPaid={(next) => {
            // Main `orders:split` auto-prints the bill on success.
            setPlacedOrder(next);
            setShowSplit(false);
            setOrdersRailToken(t => t + 1);
          }}
        />
      )}
      {showHeld && (
        <HeldBillsModal
          bills={heldBills.bills}
          onClose={() => setShowHeld(false)}
          onRecall={handleRecall}
          onDelete={heldBills.remove}
        />
      )}
      {showCalc && (
        <CalculatorModal
          onClose={() => setShowCalc(false)}
        />
      )}
    </div>
  );
}

function topPill(active: boolean): React.CSSProperties {
  return {
    background: active ? colors.brandSoft : colors.panelAlt,
    color: active ? "#fff" : colors.textPrimary,
    border: 0, padding: "8px 12px", borderRadius: 6,
    fontSize: 12, fontWeight: 600, cursor: "pointer",
  };
}
