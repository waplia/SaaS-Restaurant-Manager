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
import {
  type CartItem, type CartModifier, buildCartItem, computeLocalTotals,
  fmtINR, fromServerTotals,
} from "./order/types";

const ORDER_TYPES: Array<{ key: OrderType; label: string }> = [
  { key: "dine_in", label: "Dine-in" },
  { key: "takeaway", label: "Takeaway" },
  { key: "delivery", label: "Delivery" },
];

export function OrderWorkspace() {
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
  const anyModalOpen =
    !!modItem || showTablePicker || showCustomer || !!showDiscount || showHelp;

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

  const taxRate = useMemo(() => (Number(restaurant?.taxRate ?? 0) || 0) / 100, [restaurant]);
  const serviceRate = useMemo(() => (Number(restaurant?.serviceCharge ?? 0) || 0) / 100, [restaurant]);

  const localTotals = useMemo(() => computeLocalTotals(cart, taxRate, serviceRate), [cart, taxRate, serviceRate]);
  const totals = placedOrder ? fromServerTotals(placedOrder) : localTotals;

  // ─── Cart ops ──────────────────────────────────────────────────────
  const addItemToCart = useCallback((item: MenuItem, mods: CartModifier[] = []) => {
    if (item.isAvailable === false) {
      setOpError(`${item.name} is 86'd.`);
      return;
    }
    setOpError(null);
    setCart(prev => {
      const built = buildCartItem(item, mods);
      const existing = prev.find(c => c.lineKey === built.lineKey);
      if (existing) {
        return prev.map(c => c.lineKey === built.lineKey ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, built];
    });
  }, []);

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
  }, []);

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
  }, []);

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
  }, [anyModalOpen, cart, selectedCartIdx, handleQtyDelta, handleRemoveLine, handleSend]);

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
        cartListRef={cartListRef}
      />

      {/* Modals */}
      {modItem && (
        <ModifierModal
          item={modItem.item}
          initialModifierIds={modItem.mode === "edit" ? modItem.initialIds : undefined}
          confirmLabel={modItem.mode === "edit" ? "Update line" : undefined}
          onClose={() => setModItem(null)}
          onConfirm={(mods) => {
            if (modItem.mode === "edit") {
              applyEditedModifiers(modItem.lineKey, modItem.item, mods);
            } else {
              addItemToCart(modItem.item, mods);
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
