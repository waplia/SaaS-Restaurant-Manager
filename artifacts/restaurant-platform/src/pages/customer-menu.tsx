import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { io, type Socket } from "socket.io-client";
import { ShoppingCart, X, Plus, Minus, Star, Bell, ArrowLeft, CheckCircle, Clock, ChefHat, Truck, Loader2, CreditCard, Banknote } from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "") + "/api";

function apiPublicGet<T>(path: string): Promise<T> {
  return fetch(`${API_BASE}${path}`).then(r => r.json());
}

function apiPublicPost<T>(path: string, body: unknown): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async r => {
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  });
}

interface PublicModifier {
  id: number;
  name: string;
  price: string;
  isDefault: boolean;
}

interface PublicModifierGroup {
  id: number;
  name: string;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number;
  modifiers: PublicModifier[];
}

interface PublicMenuItem {
  id: number;
  name: string;
  description: string | null;
  price: string;
  imageUrl: string | null;
  isAvailable: boolean;
  calories: number | null;
  prepTime: number | null;
  modifierGroups: PublicModifierGroup[];
}

interface PublicMenuCategory {
  id: number;
  name: string;
  imageUrl: string | null;
  items: PublicMenuItem[];
}

interface PublicMenu {
  restaurantId: number;
  restaurantName: string;
  restaurantSlug: string;
  logoUrl: string | null;
  currency: string;
  categories: PublicMenuCategory[];
}

interface SelectedModifier {
  groupId: number;
  groupName: string;
  modifierId: number;
  name: string;
  price: string;
}

interface CartItem {
  menuItemId: number;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
  imageUrl?: string | null;
  modifiers: SelectedModifier[];
}

interface OrderResult {
  orderId: number;
  orderNumber: string;
  status: string;
  totalAmount: string;
}

interface OrderStatus {
  id: number;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  totalAmount: string;
  items: Array<{ menuItemName: string; quantity: number; totalPrice: string }>;
  createdAt: string;
}

const STATUS_STEPS = [
  { key: "pending", label: "Order Received", icon: CheckCircle, desc: "Your order has been placed" },
  { key: "preparing", label: "Preparing", icon: ChefHat, desc: "The kitchen is working on it" },
  { key: "ready", label: "Ready", icon: Truck, desc: "Your order is ready!" },
  { key: "served", label: "Served", icon: Star, desc: "Enjoy your meal!" },
];

const STATUS_ORDER = ["pending", "preparing", "ready", "served", "completed"];

function statusIndex(status: string): number {
  const idx = STATUS_ORDER.indexOf(status);
  return idx === -1 ? 0 : idx;
}

function getItemTotalPrice(item: PublicMenuItem, modifiers: SelectedModifier[], qty: number): number {
  const base = Number(item.price);
  const modTotal = modifiers.reduce((s, m) => s + Number(m.price), 0);
  return (base + modTotal) * qty;
}

export default function CustomerMenuPage() {
  const params = useParams<{ slug: string; tableId: string }>();
  const slug = params.slug ?? "";
  const tableId = Number(params.tableId ?? "0");

  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);

  const [selectedItem, setSelectedItem] = useState<PublicMenuItem | null>(null);
  const [itemQty, setItemQty] = useState(1);
  const [itemNotes, setItemNotes] = useState("");
  const [selectedModifiers, setSelectedModifiers] = useState<SelectedModifier[]>([]);

  const [view, setView] = useState<"menu" | "checkout" | "payment" | "tracking">("menu");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [payMethod, setPayMethod] = useState<"pay_at_counter" | "card">("pay_at_counter");

  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");
  const [cardError, setCardError] = useState<string | null>(null);

  const [placing, setPlacing] = useState(false);
  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);
  const [orderStatus, setOrderStatus] = useState<OrderStatus | null>(null);

  const [rating, setRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const categoryRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    setLoading(true);
    apiPublicGet<PublicMenu>(`/public/menu/${slug}`)
      .then(data => {
        setMenu(data);
        if (data.categories.length > 0) setActiveCategory(data.categories[0].id);
      })
      .catch(() => setError("Menu not found or unavailable."))
      .finally(() => setLoading(false));
  }, [slug]);

  const connectSocket = useCallback((orderId: number) => {
    const socket = io((import.meta.env.VITE_API_URL ?? ""), {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      socket.emit("join:order", orderId);
    });
    socket.on("order:update", (data: { id: number; status: string; paymentStatus?: string }) => {
      if (data.id === orderId) {
        setOrderStatus(prev => prev ? { ...prev, status: data.status, paymentStatus: data.paymentStatus ?? prev.paymentStatus } : prev);
      }
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, []);

  useEffect(() => {
    if (!orderResult) return;
    const cleanup = connectSocket(orderResult.orderId);
    const interval = setInterval(() => {
      apiPublicGet<OrderStatus>(`/public/orders/${orderResult.orderId}`)
        .then(setOrderStatus)
        .catch(() => {});
    }, 15000);
    return () => { cleanup(); clearInterval(interval); };
  }, [orderResult, connectSocket]);

  const cartItemCount = cart.reduce((s, i) => s + i.quantity, 0);
  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const currency = menu?.currency ?? "INR";
  const currSymbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "₹";

  function openItemDetail(item: PublicMenuItem) {
    setSelectedItem(item);
    setItemQty(1);
    setItemNotes("");
    const defaults: SelectedModifier[] = [];
    for (const group of item.modifierGroups) {
      for (const mod of group.modifiers) {
        if (mod.isDefault) {
          defaults.push({ groupId: group.id, groupName: group.name, modifierId: mod.id, name: mod.name, price: mod.price });
        }
      }
    }
    setSelectedModifiers(defaults);
  }

  function toggleModifier(group: PublicModifierGroup, mod: PublicModifier) {
    setSelectedModifiers(prev => {
      const isSelected = prev.some(m => m.modifierId === mod.id);
      const groupSelected = prev.filter(m => m.groupId === group.id);

      if (isSelected) {
        if (group.isRequired && groupSelected.length === 1) return prev;
        return prev.filter(m => m.modifierId !== mod.id);
      }

      if (group.maxSelections === 1) {
        const without = prev.filter(m => m.groupId !== group.id);
        return [...without, { groupId: group.id, groupName: group.name, modifierId: mod.id, name: mod.name, price: mod.price }];
      }

      if (groupSelected.length >= group.maxSelections) return prev;
      return [...prev, { groupId: group.id, groupName: group.name, modifierId: mod.id, name: mod.name, price: mod.price }];
    });
  }

  function addToCart(item: PublicMenuItem) {
    const modTotal = selectedModifiers.reduce((s, m) => s + Number(m.price), 0);
    const unitPrice = Number(item.price) + modTotal;
    setCart(prev => {
      const key = `${item.id}_${selectedModifiers.map(m => m.modifierId).sort().join("_")}`;
      const existing = prev.find(c => c.menuItemId === item.id && JSON.stringify(c.modifiers.map(m => m.modifierId).sort()) === JSON.stringify(selectedModifiers.map(m => m.modifierId).sort()));
      if (existing) {
        return prev.map(c => c === existing ? { ...c, quantity: c.quantity + itemQty, notes: itemNotes || c.notes } : c);
      }
      return [...prev, { menuItemId: item.id, name: item.name, price: unitPrice, quantity: itemQty, notes: itemNotes || undefined, imageUrl: item.imageUrl, modifiers: selectedModifiers }];
    });
    setSelectedItem(null);
    setItemQty(1);
    setItemNotes("");
    setSelectedModifiers([]);
  }

  function updateQty(cartIdx: number, delta: number) {
    setCart(prev => prev.map((c, i) => i === cartIdx ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c).filter(c => c.quantity > 0));
  }

  function scrollToCategory(catId: number) {
    setActiveCategory(catId);
    categoryRefs.current[catId]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function placeOrder() {
    if (cart.length === 0) return;
    setPlacing(true);
    try {
      const result = await apiPublicPost<OrderResult>("/public/orders", {
        restaurantId: menu!.restaurantId,
        tableId,
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        notes: orderNotes.trim() || undefined,
        items: cart.map(c => ({
          menuItemId: c.menuItemId,
          quantity: c.quantity,
          notes: c.notes,
          modifiers: c.modifiers.map(m => ({ name: m.name, price: m.price })),
        })),
      });
      setOrderResult(result);

      if (payMethod === "card") {
        setView("payment");
        const status = await apiPublicGet<OrderStatus>(`/public/orders/${result.orderId}`);
        setOrderStatus(status);
        setCart([]);
      } else {
        const status = await apiPublicGet<OrderStatus>(`/public/orders/${result.orderId}`);
        setOrderStatus(status);
        setCart([]);
        setView("tracking");
      }
    } catch {
      alert("Failed to place order. Please try again.");
    } finally {
      setPlacing(false);
    }
  }

  async function processCardPayment() {
    if (!orderResult) return;
    setCardError(null);

    const rawNum = cardNumber.replace(/\s/g, "");
    if (rawNum.length < 13 || rawNum.length > 19) {
      setCardError("Please enter a valid card number.");
      return;
    }
    if (!cardExpiry.match(/^\d{2}\/\d{2}$/)) {
      setCardError("Please enter expiry as MM/YY.");
      return;
    }
    if (cardCvc.length < 3) {
      setCardError("Please enter a valid CVC.");
      return;
    }

    setPlacing(true);
    try {
      await apiPublicPost(`/public/orders/${orderResult.orderId}/pay`, { paymentMethod: "card" });
      const status = await apiPublicGet<OrderStatus>(`/public/orders/${orderResult.orderId}`);
      setOrderStatus(status);
      setView("tracking");
    } catch {
      setCardError("Payment failed. Please try again.");
    } finally {
      setPlacing(false);
    }
  }

  async function callWaiter() {
    if (!menu) return;
    await apiPublicPost("/public/call-waiter", { restaurantId: menu.restaurantId, tableId });
    alert("Waiter has been notified!");
  }

  async function submitFeedback() {
    if (rating === 0 || !orderResult) return;
    await apiPublicPost("/public/feedback", { orderId: orderResult.orderId, rating, comment: feedbackComment || undefined });
    setFeedbackSubmitted(true);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-orange-50">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  if (error || !menu) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-orange-50 p-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-800 mb-2">Menu Not Found</p>
          <p className="text-gray-500">{error ?? "This restaurant menu is unavailable."}</p>
        </div>
      </div>
    );
  }

  if (view === "payment" && orderResult) {
    return (
      <div className="min-h-screen bg-orange-50 max-w-md mx-auto">
        <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button onClick={() => setView("checkout")} className="p-1.5 rounded-lg hover:bg-gray-100">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <p className="font-bold text-gray-900">Card Payment</p>
        </div>
        <div className="p-4 space-y-4">
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Pay by Card</p>
                <p className="text-sm text-gray-500">Amount: <span className="font-bold text-orange-500">{currSymbol}{Number(orderResult.totalAmount).toFixed(2)}</span></p>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 text-xs text-blue-700">
              Demo mode — use any test card details (e.g. 4242 4242 4242 4242, 12/26, 123)
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Card Number</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="4242 4242 4242 4242"
                  maxLength={19}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 tracking-widest"
                  value={cardNumber}
                  onChange={e => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 16);
                    setCardNumber(v.replace(/(.{4})/g, "$1 ").trim());
                  }}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Expiry</label>
                  <input
                    type="text"
                    placeholder="MM/YY"
                    maxLength={5}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                    value={cardExpiry}
                    onChange={e => {
                      const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                      setCardExpiry(v.length > 2 ? `${v.slice(0, 2)}/${v.slice(2)}` : v);
                    }}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs font-medium text-gray-600 mb-1 block">CVC</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="123"
                    maxLength={4}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                    value={cardCvc}
                    onChange={e => setCardCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  />
                </div>
              </div>
              {cardError && <p className="text-xs text-red-500">{cardError}</p>}
            </div>
          </div>

          <button
            onClick={processCardPayment}
            disabled={placing}
            className="w-full bg-orange-500 text-white font-bold rounded-xl py-4 text-base disabled:opacity-50 hover:bg-orange-600 transition flex items-center justify-center gap-2"
          >
            {placing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
            {placing ? "Processing…" : `Pay ${currSymbol}${Number(orderResult.totalAmount).toFixed(2)}`}
          </button>
        </div>
      </div>
    );
  }

  if (view === "tracking" && orderResult && orderStatus) {
    const currentIdx = statusIndex(orderStatus.status);
    const isServed = orderStatus.status === "served" || orderStatus.status === "completed";

    return (
      <div className="min-h-screen bg-orange-50 max-w-md mx-auto">
        <div className="bg-orange-500 text-white px-4 py-4 flex items-center gap-3">
          {menu.logoUrl && <img src={menu.logoUrl} alt="" className="w-8 h-8 rounded-full object-cover" />}
          <div>
            <p className="font-bold text-lg">{menu.restaurantName}</p>
            <p className="text-xs text-orange-100">Order Tracking</p>
          </div>
        </div>

        <div className="p-4">
          <div className="bg-white rounded-2xl p-5 shadow-sm mb-4">
            <p className="text-sm text-gray-500 mb-1">Order Number</p>
            <p className="text-2xl font-bold text-gray-900">{orderResult.orderNumber}</p>
            <div className="flex items-center gap-3 mt-2">
              <p className="text-sm text-gray-500">Total: <span className="font-semibold text-gray-800">{currSymbol}{Number(orderStatus.totalAmount).toFixed(2)}</span></p>
              <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", orderStatus.paymentStatus === "paid" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700")}>
                {orderStatus.paymentStatus === "paid" ? "Paid" : "Pay at Counter"}
              </span>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-sm mb-4">
            <p className="font-semibold text-gray-800 mb-4">Order Status</p>
            <div className="space-y-0">
              {STATUS_STEPS.map((step, idx) => {
                const done = idx <= currentIdx;
                const active = idx === currentIdx;
                const Icon = step.icon;
                return (
                  <div key={step.key} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0", done ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-400")}>
                        <Icon className="w-4 h-4" />
                      </div>
                      {idx < STATUS_STEPS.length - 1 && <div className={cn("w-0.5 h-8 my-1", done && idx < currentIdx ? "bg-orange-400" : "bg-gray-200")} />}
                    </div>
                    <div className="pb-6">
                      <p className={cn("font-medium text-sm", done ? "text-gray-900" : "text-gray-400")}>{step.label}</p>
                      {active && <p className="text-xs text-orange-500 mt-0.5">{step.desc}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-sm mb-4">
            <p className="font-semibold text-gray-800 mb-3">Your Order</p>
            <div className="space-y-2">
              {orderStatus.items.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-700">{item.quantity}× {item.menuItemName}</span>
                  <span className="font-medium text-gray-800">{currSymbol}{Number(item.totalPrice).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={callWaiter}
            className="w-full flex items-center justify-center gap-2 bg-white border-2 border-orange-400 text-orange-600 font-semibold rounded-xl py-3 mb-4 hover:bg-orange-50 transition"
          >
            <Bell className="w-4 h-4" /> Call Waiter
          </button>

          {isServed && !feedbackSubmitted && (
            <div className="bg-white rounded-2xl p-5 shadow-sm mb-4">
              <p className="font-semibold text-gray-800 mb-3">Rate your experience</p>
              <div className="flex gap-2 mb-3">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} onClick={() => setRating(n)} className={cn("w-10 h-10 rounded-full flex items-center justify-center text-lg transition", n <= rating ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-400 hover:bg-orange-100")}>
                    <Star className="w-5 h-5" fill={n <= rating ? "currentColor" : "none"} />
                  </button>
                ))}
              </div>
              <textarea
                placeholder="Any comments? (optional)"
                className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-300"
                rows={3}
                value={feedbackComment}
                onChange={e => setFeedbackComment(e.target.value)}
              />
              <button
                onClick={submitFeedback}
                disabled={rating === 0}
                className="w-full bg-orange-500 text-white font-semibold rounded-xl py-3 mt-3 disabled:opacity-40 hover:bg-orange-600 transition"
              >
                Submit Feedback
              </button>
            </div>
          )}

          {feedbackSubmitted && (
            <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center text-green-700 font-medium mb-4">
              Thank you for your feedback!
            </div>
          )}

          <button
            onClick={() => { setView("menu"); setOrderResult(null); setOrderStatus(null); setFeedbackSubmitted(false); setRating(0); }}
            className="w-full text-center text-sm text-gray-500 hover:text-orange-500 transition py-2"
          >
            Order more items
          </button>
        </div>
      </div>
    );
  }

  if (view === "checkout") {
    return (
      <div className="min-h-screen bg-orange-50 max-w-md mx-auto">
        <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button onClick={() => setView("menu")} className="p-1.5 rounded-lg hover:bg-gray-100">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <p className="font-bold text-gray-900">Checkout</p>
        </div>

        <div className="p-4 space-y-4">
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="font-semibold text-gray-800 mb-3">Your Order</p>
            <div className="space-y-3">
              {cart.map((item, idx) => (
                <div key={idx}>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 bg-orange-50 rounded-lg">
                        <button onClick={() => updateQty(idx, -1)} className="w-7 h-7 flex items-center justify-center text-orange-500"><Minus className="w-3 h-3" /></button>
                        <span className="text-sm font-bold w-5 text-center">{item.quantity}</span>
                        <button onClick={() => updateQty(idx, 1)} className="w-7 h-7 flex items-center justify-center text-orange-500"><Plus className="w-3 h-3" /></button>
                      </div>
                      <span className="text-sm text-gray-700">{item.name}</span>
                    </div>
                    <span className="text-sm font-medium text-gray-800">{currSymbol}{(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                  {item.modifiers.length > 0 && (
                    <p className="text-xs text-gray-400 ml-[68px] mt-0.5">{item.modifiers.map(m => m.name).join(", ")}</p>
                  )}
                </div>
              ))}
              <div className="border-t border-gray-100 pt-2 mt-2 flex justify-between">
                <span className="font-semibold text-gray-800">Total</span>
                <span className="font-bold text-orange-500">{currSymbol}{cartTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="font-semibold text-gray-800 mb-3">Your Details (optional)</p>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Your name"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
              />
              <input
                type="tel"
                placeholder="Phone number"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                value={customerPhone}
                onChange={e => setCustomerPhone(e.target.value)}
              />
              <textarea
                placeholder="Special requests or notes"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-300"
                rows={2}
                value={orderNotes}
                onChange={e => setOrderNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="font-semibold text-gray-800 mb-3">Payment Method</p>
            <div className="space-y-2">
              <label className={cn("flex items-center gap-3 p-3 border-2 rounded-xl cursor-pointer transition", payMethod === "pay_at_counter" ? "border-orange-400 bg-orange-50" : "border-gray-200")}>
                <input type="radio" name="pay" value="pay_at_counter" checked={payMethod === "pay_at_counter"} onChange={() => setPayMethod("pay_at_counter")} className="accent-orange-500" />
                <Banknote className="w-5 h-5 text-gray-500" />
                <div>
                  <p className="font-medium text-gray-800 text-sm">Pay at Counter</p>
                  <p className="text-xs text-gray-500">Cash or card when served</p>
                </div>
              </label>
              <label className={cn("flex items-center gap-3 p-3 border-2 rounded-xl cursor-pointer transition", payMethod === "card" ? "border-orange-400 bg-orange-50" : "border-gray-200")}>
                <input type="radio" name="pay" value="card" checked={payMethod === "card"} onChange={() => setPayMethod("card")} className="accent-orange-500" />
                <CreditCard className="w-5 h-5 text-gray-500" />
                <div>
                  <p className="font-medium text-gray-800 text-sm">Pay by Card Online</p>
                  <p className="text-xs text-gray-500">Secure card payment now</p>
                </div>
              </label>
            </div>
          </div>

          <button
            onClick={placeOrder}
            disabled={placing || cart.length === 0}
            className="w-full bg-orange-500 text-white font-bold rounded-xl py-4 text-base disabled:opacity-50 hover:bg-orange-600 transition flex items-center justify-center gap-2"
          >
            {placing ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            {placing ? "Placing Order…" : payMethod === "card" ? `Continue to Payment · ${currSymbol}${cartTotal.toFixed(2)}` : `Place Order · ${currSymbol}${cartTotal.toFixed(2)}`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 max-w-md mx-auto relative">
      <div className="bg-orange-500 text-white px-4 pt-6 pb-16">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            {menu.logoUrl && <img src={menu.logoUrl} alt="" className="w-10 h-10 rounded-full object-cover border-2 border-white/30" />}
            <div>
              <p className="font-bold text-xl leading-tight">{menu.restaurantName}</p>
              <p className="text-orange-100 text-xs">Table {tableId} · Scan & Order</p>
            </div>
          </div>
          <button onClick={callWaiter} className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-medium px-3 py-2 rounded-full transition">
            <Bell className="w-3.5 h-3.5" /> Waiter
          </button>
        </div>
      </div>

      <div className="relative -mt-10 mx-4 bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <div className="flex gap-0 min-w-max">
            {menu.categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => scrollToCategory(cat.id)}
                className={cn("px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition", activeCategory === cat.id ? "border-orange-500 text-orange-500" : "border-transparent text-gray-500 hover:text-gray-800")}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 pt-4 pb-32 space-y-6">
        {menu.categories.map(cat => (
          <div
            key={cat.id}
            ref={el => { categoryRefs.current[cat.id] = el; }}
          >
            <h2 className="text-base font-bold text-gray-900 mb-3">{cat.name}</h2>
            <div className="space-y-3">
              {cat.items.map(item => {
                const cartCount = cart.filter(c => c.menuItemId === item.id).reduce((s, c) => s + c.quantity, 0);
                const hasModifiers = item.modifierGroups && item.modifierGroups.length > 0;
                return (
                  <div
                    key={item.id}
                    className="bg-white rounded-2xl shadow-sm overflow-hidden flex cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => openItemDetail(item)}
                  >
                    {item.imageUrl && (
                      <img src={item.imageUrl} alt={item.name} className="w-24 h-24 object-cover flex-shrink-0" />
                    )}
                    <div className={cn("flex-1 p-3 flex flex-col justify-between", !item.imageUrl && "pl-4")}>
                      <div>
                        <p className="font-semibold text-gray-900 text-sm leading-tight">{item.name}</p>
                        {item.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.description}</p>}
                        <div className="flex gap-2 mt-0.5">
                          {item.calories && <p className="text-xs text-gray-400">{item.calories} cal</p>}
                          {hasModifiers && <p className="text-xs text-orange-400">Customizable</p>}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <span className="font-bold text-orange-500">{currSymbol}{Number(item.price).toFixed(2)}</span>
                        {cartCount > 0 ? (
                          <div className="flex items-center gap-1 bg-orange-500 text-white rounded-full px-2.5 py-1 text-xs font-bold">
                            <ShoppingCart className="w-3 h-3" />{cartCount}
                          </div>
                        ) : (
                          <div className="w-7 h-7 bg-orange-500 text-white rounded-full flex items-center justify-center">
                            <Plus className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {cat.items.length === 0 && (
                <p className="text-sm text-gray-400 py-2">No items available in this category.</p>
              )}
            </div>
          </div>
        ))}
        {menu.categories.length === 0 && (
          <div className="text-center py-20">
            <p className="text-gray-400">No menu items available.</p>
          </div>
        )}
      </div>

      {cartItemCount > 0 && !showCart && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md z-30">
          <button
            onClick={() => setShowCart(true)}
            className="w-full bg-orange-500 text-white font-bold rounded-2xl py-4 px-5 flex items-center justify-between shadow-xl hover:bg-orange-600 transition"
          >
            <div className="flex items-center gap-2">
              <div className="bg-white/20 rounded-lg w-7 h-7 flex items-center justify-center text-sm font-bold">{cartItemCount}</div>
              <span>View Cart</span>
            </div>
            <span>{currSymbol}{cartTotal.toFixed(2)}</span>
          </button>
        </div>
      )}

      {showCart && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCart(false)} />
          <div className="relative bg-white rounded-t-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
              <p className="font-bold text-lg text-gray-900">Your Cart</p>
              <button onClick={() => setShowCart(false)} className="p-1.5 rounded-full hover:bg-gray-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-3 space-y-3">
              {cart.map((item, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  {item.imageUrl && <img src={item.imageUrl} alt={item.name} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                    {item.modifiers.length > 0 && <p className="text-xs text-gray-400 truncate">{item.modifiers.map(m => m.name).join(", ")}</p>}
                    <p className="text-xs text-gray-500">{currSymbol}{item.price.toFixed(2)} each</p>
                  </div>
                  <div className="flex items-center gap-2 bg-orange-50 rounded-xl px-2 py-1">
                    <button onClick={() => updateQty(idx, -1)} className="w-6 h-6 flex items-center justify-center text-orange-500"><Minus className="w-3.5 h-3.5" /></button>
                    <span className="text-sm font-bold text-gray-800 w-5 text-center">{item.quantity}</span>
                    <button onClick={() => updateQty(idx, 1)} className="w-6 h-6 flex items-center justify-center text-orange-500"><Plus className="w-3.5 h-3.5" /></button>
                  </div>
                  <span className="text-sm font-semibold text-gray-800 w-16 text-right">{currSymbol}{(item.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-gray-100">
              <div className="flex justify-between text-base font-bold text-gray-900 mb-4">
                <span>Total</span>
                <span className="text-orange-500">{currSymbol}{cartTotal.toFixed(2)}</span>
              </div>
              <button
                onClick={() => { setShowCart(false); setView("checkout"); }}
                className="w-full bg-orange-500 text-white font-bold rounded-xl py-4 hover:bg-orange-600 transition"
              >
                Proceed to Checkout
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedItem && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedItem(null)} />
          <div className="relative bg-white rounded-t-3xl max-h-[90vh] flex flex-col">
            {selectedItem.imageUrl && (
              <img src={selectedItem.imageUrl} alt={selectedItem.name} className="w-full h-48 object-cover rounded-t-3xl flex-shrink-0" />
            )}
            <button onClick={() => setSelectedItem(null)} className="absolute top-3 right-3 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow-sm">
              <X className="w-4 h-4" />
            </button>
            <div className="flex-1 overflow-y-auto px-5 pt-4 pb-4">
              <div className="flex items-start justify-between mb-1">
                <h3 className="text-lg font-bold text-gray-900 leading-tight flex-1">{selectedItem.name}</h3>
                <span className="text-lg font-bold text-orange-500 ml-3">{currSymbol}{Number(selectedItem.price).toFixed(2)}</span>
              </div>
              {selectedItem.description && <p className="text-sm text-gray-500 mb-3">{selectedItem.description}</p>}
              {selectedItem.calories && <p className="text-xs text-gray-400 mb-4">{selectedItem.calories} calories{selectedItem.prepTime ? ` · ${selectedItem.prepTime} min` : ""}</p>}

              {selectedItem.modifierGroups.map(group => (
                <div key={group.id} className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-sm font-semibold text-gray-800">{group.name}</p>
                    {group.isRequired && <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-medium">Required</span>}
                    {group.maxSelections > 1 && <span className="text-xs text-gray-400">Pick up to {group.maxSelections}</span>}
                  </div>
                  <div className="space-y-2">
                    {group.modifiers.map(mod => {
                      const isSelected = selectedModifiers.some(m => m.modifierId === mod.id);
                      const isRadio = group.maxSelections === 1;
                      return (
                        <button
                          key={mod.id}
                          onClick={() => toggleModifier(group, mod)}
                          className={cn(
                            "w-full flex items-center justify-between px-4 py-2.5 rounded-xl border-2 text-left transition",
                            isSelected ? "border-orange-400 bg-orange-50" : "border-gray-200 hover:border-gray-300"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "w-4 h-4 border-2 flex items-center justify-center flex-shrink-0",
                              isRadio ? "rounded-full" : "rounded",
                              isSelected ? "border-orange-500 bg-orange-500" : "border-gray-300"
                            )}>
                              {isSelected && <div className={cn("bg-white", isRadio ? "w-1.5 h-1.5 rounded-full" : "w-2 h-2 rounded-sm")} />}
                            </div>
                            <span className="text-sm text-gray-800">{mod.name}</span>
                          </div>
                          {Number(mod.price) > 0 && <span className="text-sm font-medium text-orange-500">+{currSymbol}{Number(mod.price).toFixed(2)}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="mb-4">
                <p className="text-sm font-semibold text-gray-700 mb-2">Special Notes</p>
                <textarea
                  placeholder="Any customizations? (e.g. no onions)"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-300"
                  rows={2}
                  value={itemNotes}
                  onChange={e => setItemNotes(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-4 mb-2">
                <p className="text-sm font-semibold text-gray-700">Quantity</p>
                <div className="flex items-center gap-3 bg-orange-50 rounded-xl px-3 py-2">
                  <button onClick={() => setItemQty(q => Math.max(1, q - 1))} className="w-7 h-7 flex items-center justify-center text-orange-500 hover:bg-orange-100 rounded-full"><Minus className="w-4 h-4" /></button>
                  <span className="text-base font-bold text-gray-900 w-6 text-center">{itemQty}</span>
                  <button onClick={() => setItemQty(q => q + 1)} className="w-7 h-7 flex items-center justify-center text-orange-500 hover:bg-orange-100 rounded-full"><Plus className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
            <div className="px-5 pb-6 pt-2 border-t border-gray-100">
              <button
                onClick={() => addToCart(selectedItem)}
                className="w-full bg-orange-500 text-white font-bold rounded-xl py-4 hover:bg-orange-600 transition"
              >
                Add to Cart · {currSymbol}{getItemTotalPrice(selectedItem, selectedModifiers, itemQty).toFixed(2)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
