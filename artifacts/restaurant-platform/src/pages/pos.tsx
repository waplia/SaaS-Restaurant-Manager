import { useState, useCallback } from "react";
import { Layout } from "@/components/layout/Layout";
import {
  useFloorTables, useMenus, useMenuCategories, useMenuItems,
  useCreateOrder, usePayOrder, useVoidOrder, useOrders,
} from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { FloorTable, MenuItem, MenuCategory, Order } from "@/lib/types";
import {
  ShoppingBag, CreditCard, Banknote, Smartphone, Printer,
  Trash2, Plus, Minus, Tag, ChevronDown, ChevronUp, X,
  Utensils, Package, Bike, ReceiptText, AlertTriangle,
} from "lucide-react";

interface CartItem {
  menuItemId: number;
  name: string;
  price: number;
  quantity: number;
}

const ORDER_TYPES = [
  { value: "dine_in", label: "Dine-in", icon: Utensils },
  { value: "takeaway", label: "Takeaway", icon: Package },
  { value: "delivery", label: "Delivery", icon: Bike },
] as const;

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash", icon: Banknote },
  { value: "card", label: "Card", icon: CreditCard },
  { value: "upi", label: "UPI", icon: Smartphone },
];

const TABLE_STATUS_STYLE: Record<string, string> = {
  free: "bg-green-100 text-green-800 border-green-300 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700",
  occupied: "bg-orange-100 text-orange-800 border-orange-300 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700",
  reserved: "bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700",
};

function printReceipt({
  orderNumber, tableLabel, orderType, cart, subtotal, taxAmount,
  serviceCharge, discountAmount, totalAmount, paymentMethod, amountTendered, customerName,
}: {
  orderNumber: string; tableLabel: string; orderType: string; cart: CartItem[];
  subtotal: number; taxAmount: number; serviceCharge: number;
  discountAmount: number; totalAmount: number; paymentMethod: string;
  amountTendered?: number; customerName?: string;
}) {
  const change = amountTendered ? Math.max(0, amountTendered - totalAmount) : 0;
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Receipt ${orderNumber}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Courier New',monospace; font-size:13px; width:80mm; margin:0 auto; padding:10px; color:#000; }
  .center { text-align:center; }
  .bold { font-weight:bold; }
  .dash { border-top:1px dashed #555; margin:6px 0; }
  .row { display:flex; justify-content:space-between; margin:3px 0; }
  .sm { font-size:11px; color:#444; }
  h1 { font-size:18px; font-weight:bold; margin-bottom:2px; }
  .total-row { font-size:16px; font-weight:bold; margin-top:4px; }
  .logo { font-size:22px; margin-bottom:4px; }
</style></head>
<body>
<div class="center">
  <div class="logo">🍽️</div>
  <h1>Spice Garden</h1>
  <div class="sm">Restaurant Management System</div>
</div>
<div class="dash"></div>
<div class="center">
  <div class="bold">${orderNumber}</div>
  <div class="sm">${new Date().toLocaleString("en-IN")}</div>
  <div class="sm">${tableLabel || orderType.replace("_", "-").toUpperCase()}</div>
  ${customerName ? `<div class="sm">Customer: ${customerName}</div>` : ""}
</div>
<div class="dash"></div>
<div class="sm bold row"><span>ITEM</span><span>AMT</span></div>
<div class="dash"></div>
${cart.map(item => `
<div class="row"><span class="sm">${item.name}</span><span class="sm">₹${(item.price * item.quantity).toFixed(2)}</span></div>
<div class="sm" style="color:#666;margin-left:4px">&nbsp;&nbsp;${item.quantity} × ₹${item.price.toFixed(2)}</div>
`).join("")}
<div class="dash"></div>
<div class="row"><span class="sm">Subtotal</span><span class="sm">₹${subtotal.toFixed(2)}</span></div>
<div class="row"><span class="sm">GST (5%)</span><span class="sm">₹${taxAmount.toFixed(2)}</span></div>
${serviceCharge > 0 ? `<div class="row"><span class="sm">Service Charge</span><span class="sm">₹${serviceCharge.toFixed(2)}</span></div>` : ""}
${discountAmount > 0 ? `<div class="row"><span class="sm">Discount</span><span class="sm">-₹${discountAmount.toFixed(2)}</span></div>` : ""}
<div class="dash"></div>
<div class="row total-row"><span>TOTAL</span><span>₹${totalAmount.toFixed(2)}</span></div>
<div class="dash"></div>
<div class="row sm"><span>Payment</span><span>${paymentMethod.toUpperCase()}</span></div>
${amountTendered ? `<div class="row sm"><span>Tendered</span><span>₹${amountTendered.toFixed(2)}</span></div>` : ""}
${change > 0 ? `<div class="row bold sm"><span>Change</span><span>₹${change.toFixed(2)}</span></div>` : ""}
<div class="dash"></div>
<div class="center sm">Thank you for dining with us!<br/>Please visit again 🙏</div>
</body></html>`;
  const w = window.open("", "_blank", "width=340,height=700");
  if (w) {
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }
}

function PaymentModal({
  cart, subtotal, taxAmount, serviceCharge, discountAmount, totalAmount,
  onClose, onConfirm, isPending,
}: {
  cart: CartItem[]; subtotal: number; taxAmount: number; serviceCharge: number;
  discountAmount: number; totalAmount: number;
  onClose: () => void;
  onConfirm: (method: string, amountTendered?: number) => void;
  isPending: boolean;
}) {
  const [method, setMethod] = useState("cash");
  const [amountTendered, setAmountTendered] = useState("");
  const change = method === "cash" && amountTendered ? Math.max(0, Number(amountTendered) - totalAmount) : 0;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" /> Process Payment
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        <div className="p-6 space-y-5">
          <div className="bg-muted/60 rounded-xl p-4 space-y-1.5 border border-border">
            {cart.map(item => (
              <div key={item.menuItemId} className="flex justify-between text-sm">
                <span className="text-muted-foreground truncate mr-2">{item.name} × {item.quantity}</span>
                <span className="flex-shrink-0">₹{(item.price * item.quantity).toFixed(2)}</span>
              </div>
            ))}
            <div className="border-t border-border mt-2 pt-2 space-y-1">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Subtotal</span><span>₹{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>GST (5%)</span><span>₹{taxAmount.toFixed(2)}</span>
              </div>
              {serviceCharge > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Service Charge</span><span>₹{serviceCharge.toFixed(2)}</span>
                </div>
              )}
              {discountAmount > 0 && (
                <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                  <span>Discount</span><span>-₹{discountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-xl border-t border-border pt-2 mt-1">
                <span>Total</span><span className="text-primary">₹{totalAmount.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">Payment Method</label>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setMethod(value)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 text-sm font-medium transition-all",
                    method === value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  )}
                >
                  <Icon className="w-5 h-5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {method === "cash" && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Amount Tendered</label>
              <Input
                type="number"
                placeholder={`₹${totalAmount.toFixed(2)}`}
                value={amountTendered}
                onChange={e => setAmountTendered(e.target.value)}
                className="text-base font-mono"
                autoFocus
              />
              {change > 0 && (
                <div className="bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded-lg px-4 py-2 flex justify-between items-center">
                  <span className="text-green-700 dark:text-green-400 font-medium">Change</span>
                  <span className="text-green-700 dark:text-green-400 font-bold text-xl">₹{change.toFixed(2)}</span>
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                {[100, 200, 500, 1000, 2000].map(amt => (
                  <Button key={amt} size="sm" variant="outline" className="text-xs h-7" onClick={() => setAmountTendered(String(amt))}>
                    ₹{amt}
                  </Button>
                ))}
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setAmountTendered(totalAmount.toFixed(2))}>
                  Exact
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 pb-6">
          <Button
            className="w-full h-12 text-base font-semibold"
            disabled={isPending}
            onClick={() => onConfirm(method, method === "cash" && amountTendered ? Number(amountTendered) : undefined)}
          >
            <CreditCard className="w-4 h-4 mr-2" />
            Confirm Payment · ₹{totalAmount.toFixed(2)}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function PosPage() {
  const { data: tables = [] } = useFloorTables();
  const { data: menus = [] } = useMenus();
  const firstMenuId = menus[0]?.id;
  const { data: categories = [] } = useMenuCategories(firstMenuId);
  const [selectedCat, setSelectedCat] = useState<number | undefined>();
  const { data: menuItems = [] } = useMenuItems({ categoryId: selectedCat });
  const { data: activeOrdersData } = useOrders({ status: "pending" });
  const activeOrders: Order[] = activeOrdersData?.data ?? [];

  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [orderType, setOrderType] = useState<"dine_in" | "takeaway" | "delivery">("dine_in");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [showPayModal, setShowPayModal] = useState(false);
  const [showTableGrid, setShowTableGrid] = useState(true);
  const [placedOrder, setPlacedOrder] = useState<Order & { subtotal: string; taxAmount: string; serviceCharge: string; discountAmount: string } | null>(null);

  const createOrder = useCreateOrder();
  const payOrder = usePayOrder();
  const voidOrder = useVoidOrder();
  const { toast } = useToast();

  const discountAmount = Number(discount) || 0;
  const subtotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  const taxAmount = subtotal * 0.05;
  const serviceCharge = 0;
  const totalAmount = Math.max(0, subtotal + taxAmount + serviceCharge - discountAmount);

  const addToCart = useCallback((item: MenuItem) => {
    setCart(prev => {
      const existing = prev.find(c => c.menuItemId === item.id);
      if (existing) return prev.map(c => c.menuItemId === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { menuItemId: item.id, name: item.name, price: Number(item.price), quantity: 1 }];
    });
  }, []);

  const updateQty = useCallback((menuItemId: number, qty: number) => {
    if (qty <= 0) setCart(prev => prev.filter(c => c.menuItemId !== menuItemId));
    else setCart(prev => prev.map(c => c.menuItemId === menuItemId ? { ...c, quantity: qty } : c));
  }, []);

  const removeFromCart = useCallback((menuItemId: number) => {
    setCart(prev => prev.filter(c => c.menuItemId !== menuItemId));
  }, []);

  const selectedTable = tables.find((t: FloorTable) => t.id === selectedTableId);
  const tableActiveOrder = selectedTableId ? activeOrders.find(o => o.tableId === selectedTableId) : null;

  const handleSelectTable = (table: FloorTable) => {
    setSelectedTableId(prev => prev === table.id ? null : table.id);
    if (orderType !== "dine_in") setOrderType("dine_in");
  };

  const handlePlaceOrder = async (): Promise<Order & { subtotal: string; taxAmount: string; serviceCharge: string; discountAmount: string } | null> => {
    if (cart.length === 0) {
      toast({ title: "Add items to cart first", variant: "destructive" });
      return null;
    }
    try {
      const order = await createOrder.mutateAsync({
        tableId: selectedTableId ?? undefined,
        orderType,
        customerName: customerName || undefined,
        discountAmount: discountAmount > 0 ? discountAmount.toFixed(2) : undefined,
        items: cart.map(c => ({ menuItemId: c.menuItemId, quantity: c.quantity })),
      }) as Order & { subtotal: string; taxAmount: string; serviceCharge: string; discountAmount: string };
      setPlacedOrder(order);
      toast({ title: `Order ${order.orderNumber} placed!`, description: "Kitchen has been notified." });
      return order;
    } catch {
      toast({ title: "Failed to place order", variant: "destructive" });
      return null;
    }
  };

  const handlePayNow = async () => {
    if (cart.length === 0) {
      toast({ title: "Cart is empty", variant: "destructive" });
      return;
    }
    let order = placedOrder;
    if (!order) {
      order = await handlePlaceOrder();
      if (!order) return;
    }
    setShowPayModal(true);
  };

  const handleConfirmPayment = async (method: string, amountTendered?: number) => {
    const orderId = placedOrder?.id;
    if (!orderId) return;
    try {
      await payOrder.mutateAsync({ id: orderId, paymentMethod: method });
      setShowPayModal(false);
      toast({ title: "Payment confirmed!", description: `${placedOrder?.orderNumber} marked as paid.` });

      const tableLabel = selectedTable ? `Table ${selectedTable.tableNumber}` : "";
      printReceipt({
        orderNumber: placedOrder?.orderNumber ?? "",
        tableLabel,
        orderType,
        cart,
        subtotal,
        taxAmount,
        serviceCharge,
        discountAmount,
        totalAmount,
        paymentMethod: method,
        amountTendered,
        customerName,
      });

      handleNewOrder();
    } catch {
      toast({ title: "Payment failed", variant: "destructive" });
    }
  };

  const handleVoid = async () => {
    const orderId = placedOrder?.id;
    if (!orderId) {
      handleNewOrder();
      return;
    }
    if (!confirm("Void this order? This cannot be undone.")) return;
    try {
      await voidOrder.mutateAsync(orderId);
      toast({ title: "Order voided" });
      handleNewOrder();
    } catch {
      toast({ title: "Failed to void order", variant: "destructive" });
    }
  };

  const handleNewOrder = () => {
    setCart([]);
    setDiscount("");
    setCustomerName("");
    setSelectedTableId(null);
    setPlacedOrder(null);
    setShowPayModal(false);
  };

  return (
    <Layout>
      <div className="flex h-[calc(100vh-0px)] overflow-hidden bg-background">
        {/* ── LEFT PANEL ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Table Grid */}
          <div className="border-b border-border flex-shrink-0">
            <button
              className="flex items-center justify-between w-full px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
              onClick={() => setShowTableGrid(p => !p)}
            >
              <span className="flex items-center gap-2 text-foreground">
                Tables
                {selectedTable && (
                  <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full leading-none">
                    T{selectedTable.tableNumber}
                  </span>
                )}
                {tableActiveOrder && (
                  <span className="bg-orange-500 text-white text-xs px-2 py-0.5 rounded-full leading-none flex items-center gap-1">
                    <AlertTriangle className="w-2.5 h-2.5" /> Active order
                  </span>
                )}
              </span>
              {showTableGrid ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>

            {showTableGrid && (
              <div className="px-4 pb-3">
                <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-1.5 max-h-36 overflow-y-auto">
                  {(tables as FloorTable[]).map(table => (
                    <button
                      key={table.id}
                      onClick={() => handleSelectTable(table)}
                      className={cn(
                        "flex flex-col items-center justify-center aspect-square rounded-lg border-2 text-xs font-bold transition-all",
                        selectedTableId === table.id
                          ? "border-primary bg-primary text-primary-foreground scale-95 shadow-md"
                          : TABLE_STATUS_STYLE[table.status] ?? "bg-gray-100 text-gray-600 border-gray-200"
                      )}
                    >
                      <span>{table.tableNumber}</span>
                      <span className="text-[9px] opacity-70 font-normal">{table.capacity}p</span>
                    </button>
                  ))}
                  {tables.length === 0 && (
                    <p className="col-span-full text-xs text-muted-foreground py-2 text-center">No tables configured</p>
                  )}
                </div>
                <div className="flex gap-4 mt-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-green-500"></span>Free</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-orange-500"></span>Occupied</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-blue-500"></span>Reserved</span>
                </div>
              </div>
            )}
          </div>

          {/* Order Type + Customer Name */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0 flex-wrap">
            {ORDER_TYPES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => { setOrderType(value); if (value !== "dine_in") setSelectedTableId(null); }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex-shrink-0",
                  orderType === value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
            <Input
              className="h-8 text-xs flex-1 min-w-32 max-w-48 ml-auto"
              placeholder="Customer name (optional)"
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
            />
          </div>

          {/* Category Filter */}
          <div className="flex gap-1.5 px-4 py-2 border-b border-border overflow-x-auto flex-shrink-0 scrollbar-none">
            <Button
              size="sm"
              variant={!selectedCat ? "default" : "outline"}
              onClick={() => setSelectedCat(undefined)}
              className="flex-shrink-0 h-7 text-xs px-3"
            >
              All
            </Button>
            {(categories as MenuCategory[]).map(c => (
              <Button
                key={c.id}
                size="sm"
                variant={selectedCat === c.id ? "default" : "outline"}
                onClick={() => setSelectedCat(c.id)}
                className="flex-shrink-0 h-7 text-xs px-3 whitespace-nowrap"
              >
                {c.name}
              </Button>
            ))}
          </div>

          {/* Menu Item Grid */}
          <div className="flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {(menuItems as MenuItem[]).filter(i => i.isAvailable).map(item => {
                const inCart = cart.find(c => c.menuItemId === item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => addToCart(item)}
                    disabled={!!placedOrder}
                    className={cn(
                      "relative text-left p-3 rounded-xl border-2 transition-all hover:shadow-sm",
                      inCart
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50 hover:bg-accent",
                      placedOrder && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <p className="text-sm font-medium leading-tight line-clamp-2 flex-1">{item.name}</p>
                      <span className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5", item.isVeg ? "bg-green-500" : "bg-red-500")} />
                    </div>
                    <p className="text-sm font-bold text-primary">₹{item.price}</p>
                    {inCart && (
                      <div className="absolute top-2 right-2 bg-primary text-primary-foreground text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold shadow">
                        {inCart.quantity}
                      </div>
                    )}
                  </button>
                );
              })}
              {menuItems.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <ShoppingBag className="w-12 h-12 mb-3 opacity-20" />
                  <p className="text-sm">No items found</p>
                  <p className="text-xs mt-1 opacity-60">Select a category or check menu setup</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL — Order Ticket ── */}
        <div className="w-80 xl:w-96 flex-shrink-0 flex flex-col bg-card border-l border-border">

          {/* Ticket Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <h2 className="font-semibold text-foreground flex items-center gap-2">
                <ReceiptText className="w-4 h-4 text-primary" /> Order Ticket
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedTable ? `Table ${selectedTable.tableNumber}` : orderType.replace("_", "-")}
                {customerName && ` · ${customerName}`}
              </p>
            </div>
            {(cart.length > 0 || placedOrder) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleVoid}
                className="text-muted-foreground hover:text-destructive h-8 w-8 p-0"
                title={placedOrder ? "Void order" : "Clear cart"}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>

          {/* Placed Order Banner */}
          {placedOrder && (
            <div className="mx-4 mt-3 px-4 py-2.5 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded-xl">
              <p className="text-xs font-semibold text-green-700 dark:text-green-400">{placedOrder.orderNumber} — placed</p>
              <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">Kitchen notified · Click Pay to complete</p>
            </div>
          )}

          {/* Cart Items */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground pb-12">
                <ShoppingBag className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm font-medium">Cart is empty</p>
                <p className="text-xs mt-1 opacity-60">Tap items from the menu</p>
              </div>
            ) : (
              cart.map(item => (
                <div key={item.menuItemId} className="flex items-center gap-2 py-2 border-b border-border/40 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      ₹{item.price.toFixed(2)} × {item.quantity} = <span className="font-medium text-foreground">₹{(item.price * item.quantity).toFixed(2)}</span>
                    </p>
                  </div>
                  {!placedOrder && (
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button
                        onClick={() => updateQty(item.menuItemId, item.quantity - 1)}
                        className="w-6 h-6 rounded bg-secondary hover:bg-red-100 hover:text-red-600 flex items-center justify-center transition-colors"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                      <button
                        onClick={() => updateQty(item.menuItemId, item.quantity + 1)}
                        className="w-6 h-6 rounded bg-secondary hover:bg-primary/10 hover:text-primary flex items-center justify-center transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => removeFromCart(item.menuItemId)}
                        className="w-6 h-6 rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors ml-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Discount + Totals + Actions */}
          {cart.length > 0 && (
            <div className="border-t border-border px-4 py-4 space-y-3 flex-shrink-0">
              {!placedOrder && (
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <Input
                    type="number"
                    placeholder="Discount amount (₹)"
                    value={discount}
                    onChange={e => setDiscount(e.target.value)}
                    className="h-8 text-sm"
                    min="0"
                  />
                </div>
              )}

              <div className="space-y-1">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Subtotal ({cart.reduce((s, c) => s + c.quantity, 0)} items)</span>
                  <span>₹{subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>GST (5%)</span>
                  <span>₹{taxAmount.toFixed(2)}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                    <span>Discount</span>
                    <span>-₹{discountAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-lg border-t border-border pt-2">
                  <span>Total</span>
                  <span className="text-primary">₹{totalAmount.toFixed(2)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {!placedOrder ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={createOrder.isPending}
                      onClick={handlePlaceOrder}
                    >
                      Place Order
                    </Button>
                    <Button
                      size="sm"
                      disabled={createOrder.isPending || payOrder.isPending}
                      onClick={handlePayNow}
                    >
                      <CreditCard className="w-3.5 h-3.5 mr-1.5" />
                      Pay Now
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (placedOrder) {
                          const tableLabel = selectedTable ? `Table ${selectedTable.tableNumber}` : "";
                          printReceipt({
                            orderNumber: placedOrder.orderNumber,
                            tableLabel,
                            orderType,
                            cart,
                            subtotal,
                            taxAmount,
                            serviceCharge,
                            discountAmount,
                            totalAmount,
                            paymentMethod: "pending",
                            customerName,
                          });
                        }
                      }}
                    >
                      <Printer className="w-3.5 h-3.5 mr-1.5" />
                      Print KOT
                    </Button>
                    <Button
                      size="sm"
                      disabled={payOrder.isPending}
                      onClick={() => setShowPayModal(true)}
                    >
                      <CreditCard className="w-3.5 h-3.5 mr-1.5" />
                      Pay
                    </Button>
                  </>
                )}
              </div>

              {placedOrder && (
                <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={handleNewOrder}>
                  <Plus className="w-3 h-3 mr-1" /> Start New Order
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {showPayModal && (
        <PaymentModal
          cart={cart}
          subtotal={subtotal}
          taxAmount={taxAmount}
          serviceCharge={serviceCharge}
          discountAmount={discountAmount}
          totalAmount={totalAmount}
          onClose={() => setShowPayModal(false)}
          onConfirm={handleConfirmPayment}
          isPending={payOrder.isPending}
        />
      )}
    </Layout>
  );
}
