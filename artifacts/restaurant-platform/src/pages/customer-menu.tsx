import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { io, type Socket } from "socket.io-client";
import { X, Plus, Minus, Star, Bell, ArrowLeft, CheckCircle, ChefHat, Truck, Loader2, CreditCard, Banknote, ShoppingCart, Receipt, GlassWater, MessageSquare, Gift } from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "") + "/api";

function apiPublicGet<T>(path: string, token?: string): Promise<T> {
  const url = token ? `${API_BASE}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : `${API_BASE}${path}`;
  return fetch(url).then(async r => {
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  });
}

function apiPublicPost<T>(path: string, body: unknown, token?: string): Promise<T> {
  const url = token ? `${API_BASE}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : `${API_BASE}${path}`;
  return fetch(url, {
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
  modifierId: number;
  name: string;
  price: string;
}

interface CartItem {
  menuItemId: number;
  name: string;
  basePrice: number;
  modifierTotal: number;
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
  guestToken: string;
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

interface RewardsLookup {
  found: boolean;
  restaurantName: string;
  currency: string;
  redemptionRate: number;
  pointsPerCurrencyUnit: number;
  expiryMonths?: number;
  customer?: { firstName: string };
  balance?: number;
  tier?: { id: string; name: string; multiplier: number };
  nextTier?: { id: string; name: string; threshold: number; pointsToGo: number } | null;
  history?: Array<{ points: number; type: string; reason: string | null; createdAt: string; expiresAt: string | null }>;
}

interface PaymentIntentResponse {
  mode: "live" | "demo";
  clientSecret?: string | null;
  checkoutUrl?: string;
  intentId?: string;
  totalAmount: string;
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

function itemUnitPrice(basePrice: number, modifiers: SelectedModifier[]): number {
  return basePrice + modifiers.reduce((s, m) => s + Number(m.price), 0);
}

export default function CustomerMenuPage() {
  const params = useParams<{ slug: string; tableId: string }>();
  const slug = params.slug ?? "";
  const tableId = Number(params.tableId ?? "0");

  const urlParams = new URLSearchParams(window.location.search);
  const stripeReturnOrderId = urlParams.get("order");
  const stripeReturnToken = urlParams.get("token");
  const stripeReturnSession = urlParams.get("session_id");

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

  const [paymentIntent, setPaymentIntent] = useState<PaymentIntentResponse | null>(null);
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");
  const [cardError, setCardError] = useState<string | null>(null);

  const [placing, setPlacing] = useState(false);
  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);
  const [orderStatus, setOrderStatus] = useState<OrderStatus | null>(null);

  const [waiterModalOpen, setWaiterModalOpen] = useState(false);
  const [waiterReason, setWaiterReason] = useState<"call_waiter" | "request_bill" | "water" | "custom">("call_waiter");
  const [waiterNote, setWaiterNote] = useState("");
  const [waiterSending, setWaiterSending] = useState(false);
  const [waiterCooldownUntil, setWaiterCooldownUntil] = useState<number>(0);
  const [waiterStatus, setWaiterStatus] = useState<"idle" | "sent" | "error">("idle");
  const [now, setNow] = useState<number>(Date.now());

  const cooldownKey = `tt_waiter_cooldown_${menu?.restaurantId ?? 0}_${tableId}`;

  useEffect(() => {
    const stored = Number(localStorage.getItem(cooldownKey) ?? "0");
    if (stored > Date.now()) setWaiterCooldownUntil(stored);
  }, [cooldownKey]);

  useEffect(() => {
    if (!waiterModalOpen) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waiterModalOpen]);

  const [rating, setRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [rewardsMode, setRewardsMode] = useState<"phone" | "email">("phone");
  const [rewardsPhone, setRewardsPhone] = useState("");
  const [rewardsEmail, setRewardsEmail] = useState("");
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [rewardsError, setRewardsError] = useState<string | null>(null);
  const [rewardsData, setRewardsData] = useState<RewardsLookup | null>(null);

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

  const connectSocket = useCallback((orderId: number, token: string) => {
    const socket = io((import.meta.env.VITE_API_URL ?? ""), {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      socket.emit("join:order", { orderId, token });
    });
    socket.on("order:update", (data: { id: number; status: string; paymentStatus?: string }) => {
      if (data.id === orderId) {
        setOrderStatus(prev => prev ? { ...prev, status: data.status, paymentStatus: data.paymentStatus ?? prev.paymentStatus } : prev);
      }
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, []);

  useEffect(() => {
    if (!stripeReturnOrderId || !stripeReturnToken) return;
    const orderId = Number(stripeReturnOrderId);
    const token = stripeReturnToken;
    const sessionId = stripeReturnSession ?? undefined;
    const qs = new URLSearchParams();
    qs.set("orderId", String(orderId));
    qs.set("token", token);
    if (sessionId) qs.set("sessionId", sessionId);
    apiPublicGet<{ verified: boolean; paymentStatus: string; orderId: number; orderNumber: string; totalAmount: string }>(`/public/orders/verify-session?${qs}`)
      .then(result => {
        setOrderResult({ orderId: result.orderId, orderNumber: result.orderNumber, guestToken: token, totalAmount: result.totalAmount, status: result.paymentStatus === "paid" ? "preparing" : "pending" });
        return apiPublicGet<OrderStatus>(`/public/orders/${result.orderId}`, token);
      })
      .then(status => {
        setOrderStatus(status);
        setView("tracking");
        window.history.replaceState({}, "", window.location.pathname);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!orderResult) return;
    const cleanup = connectSocket(orderResult.orderId, orderResult.guestToken);
    const interval = setInterval(() => {
      apiPublicGet<OrderStatus>(`/public/orders/${orderResult.orderId}`, orderResult.guestToken)
        .then(setOrderStatus)
        .catch(() => {});
    }, 15000);
    return () => { cleanup(); clearInterval(interval); };
  }, [orderResult, connectSocket]);

  const cartItemCount = cart.reduce((s, i) => s + i.quantity, 0);
  const cartTotal = cart.reduce((s, i) => s + itemUnitPrice(i.basePrice, i.modifiers) * i.quantity, 0);
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
          defaults.push({ groupId: group.id, modifierId: mod.id, name: mod.name, price: mod.price });
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
        return [...prev.filter(m => m.groupId !== group.id), { groupId: group.id, modifierId: mod.id, name: mod.name, price: mod.price }];
      }

      if (groupSelected.length >= group.maxSelections) return prev;
      return [...prev, { groupId: group.id, modifierId: mod.id, name: mod.name, price: mod.price }];
    });
  }

  function addToCart(item: PublicMenuItem) {
    const modTotal = selectedModifiers.reduce((s, m) => s + Number(m.price), 0);
    setCart(prev => {
      const modKey = selectedModifiers.map(m => m.modifierId).sort().join(",");
      const existing = prev.find(c => c.menuItemId === item.id && c.modifiers.map(m => m.modifierId).sort().join(",") === modKey);
      if (existing) {
        return prev.map(c => c === existing ? { ...c, quantity: c.quantity + itemQty, notes: itemNotes || c.notes } : c);
      }
      return [...prev, {
        menuItemId: item.id,
        name: item.name,
        basePrice: Number(item.price),
        modifierTotal: modTotal,
        quantity: itemQty,
        notes: itemNotes || undefined,
        imageUrl: item.imageUrl,
        modifiers: selectedModifiers,
      }];
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
          modifierIds: c.modifiers.map(m => m.modifierId),
        })),
      });
      setOrderResult(result);
      const status = await apiPublicGet<OrderStatus>(`/public/orders/${result.orderId}`, result.guestToken);
      setOrderStatus(status);
      setCart([]);

      if (payMethod === "card") {
        const pi = await apiPublicPost<PaymentIntentResponse>(`/public/orders/${result.orderId}/payment-intent`, {}, result.guestToken);
        setPaymentIntent(pi);
        if (pi.mode === "live" && pi.checkoutUrl) {
          window.location.href = pi.checkoutUrl;
          return;
        }
        setView("payment");
      } else {
        setView("tracking");
      }
    } catch {
      alert("Failed to place order. Please try again.");
    } finally {
      setPlacing(false);
    }
  }

  async function processCardPayment() {
    if (!orderResult || !paymentIntent) return;
    setCardError(null);

    if (paymentIntent.mode === "live") {
      if (paymentIntent.checkoutUrl) {
        window.location.href = paymentIntent.checkoutUrl;
      }
      return;
    }

    const rawNum = cardNumber.replace(/\s/g, "");
    if (rawNum.length < 13) { setCardError("Please enter a valid card number."); return; }
    if (!cardExpiry.match(/^\d{2}\/\d{2}$/)) { setCardError("Please enter expiry as MM/YY."); return; }
    if (cardCvc.length < 3) { setCardError("Please enter a valid CVC."); return; }

    setPlacing(true);
    try {
      await apiPublicPost(`/public/orders/${orderResult.orderId}/pay`, { intentId: paymentIntent.intentId, paymentMethod: "card" }, orderResult.guestToken);
      const status = await apiPublicGet<OrderStatus>(`/public/orders/${orderResult.orderId}`, orderResult.guestToken);
      setOrderStatus(status);
      setView("tracking");
    } catch (e: unknown) {
      setCardError(e instanceof Error ? e.message : "Payment failed. Please try again.");
    } finally {
      setPlacing(false);
    }
  }

  function openWaiterModal() {
    setWaiterReason("call_waiter");
    setWaiterNote("");
    setWaiterStatus("idle");
    setWaiterModalOpen(true);
  }

  function openRewards() {
    setRewardsError(null);
    setRewardsOpen(true);
  }

  async function fetchRewards() {
    if (!slug) return;
    const payload: { slug: string; phone?: string; email?: string } = { slug };
    if (rewardsMode === "phone") {
      const phone = rewardsPhone.trim();
      if (phone.length < 6) { setRewardsError("Please enter a valid phone number."); return; }
      payload.phone = phone;
    } else {
      const email = rewardsEmail.trim();
      if (email.length < 5 || !email.includes("@")) { setRewardsError("Please enter a valid email address."); return; }
      payload.email = email;
    }
    setRewardsLoading(true);
    setRewardsError(null);
    try {
      const res = await fetch(`${API_BASE}/public/loyalty/lookup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setRewardsError(data?.error ?? "Could not look up rewards.");
        setRewardsData(null);
      } else {
        setRewardsData(data as RewardsLookup);
      }
    } catch {
      setRewardsError("Network error. Please try again.");
    } finally {
      setRewardsLoading(false);
    }
  }

  async function sendWaiterRequest() {
    if (!menu) return;
    if (waiterCooldownUntil > Date.now()) return;
    setWaiterSending(true);
    try {
      const body: { restaurantId: number; tableId: number; type: string; note?: string; token?: string } = {
        restaurantId: menu.restaurantId,
        tableId,
        type: waiterReason,
      };
      if (waiterNote.trim()) body.note = waiterNote.trim();
      if (orderResult?.guestToken) body.token = orderResult.guestToken;
      await apiPublicPost("/public/call-waiter", body);
      const until = Date.now() + 30_000;
      setWaiterCooldownUntil(until);
      try { localStorage.setItem(cooldownKey, String(until)); } catch { /* ignore */ }
      setWaiterStatus("sent");
      setTimeout(() => setWaiterModalOpen(false), 1200);
    } catch {
      setWaiterStatus("error");
    } finally {
      setWaiterSending(false);
    }
  }

  async function submitFeedback() {
    if (rating === 0 || !orderResult) return;
    await apiPublicPost("/public/feedback", { orderId: orderResult.orderId, rating, comment: feedbackComment || undefined, token: orderResult.guestToken });
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

  if (view === "payment" && orderResult && paymentIntent) {
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
                <p className="text-sm text-gray-500">Amount: <span className="font-bold text-orange-500">{currSymbol}{Number(paymentIntent.totalAmount).toFixed(2)}</span></p>
              </div>
            </div>

            {paymentIntent.mode === "demo" && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 text-xs text-blue-700">
                Demo mode — use any test details (e.g. 4242 4242 4242 4242, 12/26, 123)
              </div>
            )}

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
            {placing ? "Processing…" : `Pay ${currSymbol}${Number(paymentIntent.totalAmount).toFixed(2)}`}
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
            onClick={openWaiterModal}
            className="w-full flex items-center justify-center gap-2 bg-white border-2 border-orange-400 text-orange-600 font-semibold rounded-xl py-3 mb-4 hover:bg-orange-50 transition"
          >
            <Bell className="w-4 h-4" /> Call Waiter
          </button>

          {isServed && !feedbackSubmitted && (
            <div className="bg-white rounded-2xl p-5 shadow-sm mb-4">
              <p className="font-semibold text-gray-800 mb-3">Rate your experience</p>
              <div className="flex gap-2 mb-3">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} onClick={() => setRating(n)} className={cn("w-10 h-10 rounded-full flex items-center justify-center transition", n <= rating ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-400 hover:bg-orange-100")}>
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
            onClick={() => { setView("menu"); setOrderResult(null); setOrderStatus(null); setPaymentIntent(null); setFeedbackSubmitted(false); setRating(0); }}
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
                    <span className="text-sm font-medium text-gray-800">{currSymbol}{(itemUnitPrice(item.basePrice, item.modifiers) * item.quantity).toFixed(2)}</span>
                  </div>
                  {item.modifiers.length > 0 && (
                    <p className="text-xs text-gray-400 ml-[68px] mt-0.5">{item.modifiers.map(m => m.name).join(", ")}</p>
                  )}
                </div>
              ))}
              <div className="border-t border-gray-100 pt-2 mt-2 flex justify-between">
                <span className="font-semibold text-gray-800">Subtotal</span>
                <span className="font-bold text-orange-500">{currSymbol}{cartTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="font-semibold text-gray-800 mb-3">Your Details (optional)</p>
            <div className="space-y-3">
              <input type="text" placeholder="Your name" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" value={customerName} onChange={e => setCustomerName(e.target.value)} />
              <input type="tel" placeholder="Phone number" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
              <textarea placeholder="Special requests or notes" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-300" rows={2} value={orderNotes} onChange={e => setOrderNotes(e.target.value)} />
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
          <div className="flex items-center gap-2">
            <button onClick={openRewards} className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-medium px-3 py-2 rounded-full transition">
              <Gift className="w-3.5 h-3.5" /> Rewards
            </button>
            <button onClick={openWaiterModal} className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-medium px-3 py-2 rounded-full transition">
              <Bell className="w-3.5 h-3.5" /> Waiter
            </button>
          </div>
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
          <div key={cat.id} ref={el => { categoryRefs.current[cat.id] = el; }}>
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
                    {item.imageUrl && <img src={item.imageUrl} alt={item.name} className="w-24 h-24 object-cover flex-shrink-0" />}
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
              {cat.items.length === 0 && <p className="text-sm text-gray-400 py-2">No items available in this category.</p>}
            </div>
          </div>
        ))}
        {menu.categories.length === 0 && (
          <div className="text-center py-20"><p className="text-gray-400">No menu items available.</p></div>
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
                    <p className="text-xs text-gray-500">{currSymbol}{itemUnitPrice(item.basePrice, item.modifiers).toFixed(2)} each</p>
                  </div>
                  <div className="flex items-center gap-2 bg-orange-50 rounded-xl px-2 py-1">
                    <button onClick={() => updateQty(idx, -1)} className="w-6 h-6 flex items-center justify-center text-orange-500"><Minus className="w-3.5 h-3.5" /></button>
                    <span className="text-sm font-bold text-gray-800 w-5 text-center">{item.quantity}</span>
                    <button onClick={() => updateQty(idx, 1)} className="w-6 h-6 flex items-center justify-center text-orange-500"><Plus className="w-3.5 h-3.5" /></button>
                  </div>
                  <span className="text-sm font-semibold text-gray-800 w-16 text-right">{currSymbol}{(itemUnitPrice(item.basePrice, item.modifiers) * item.quantity).toFixed(2)}</span>
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
              {selectedItem.calories && <p className="text-xs text-gray-400 mb-4">{selectedItem.calories} cal{selectedItem.prepTime ? ` · ${selectedItem.prepTime} min` : ""}</p>}

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
                          className={cn("w-full flex items-center justify-between px-4 py-2.5 rounded-xl border-2 text-left transition", isSelected ? "border-orange-400 bg-orange-50" : "border-gray-200 hover:border-gray-300")}
                        >
                          <div className="flex items-center gap-2">
                            <div className={cn("w-4 h-4 border-2 flex items-center justify-center flex-shrink-0", isRadio ? "rounded-full" : "rounded", isSelected ? "border-orange-500 bg-orange-500" : "border-gray-300")}>
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
                Add to Cart · {currSymbol}{(itemUnitPrice(Number(selectedItem.price), selectedModifiers) * itemQty).toFixed(2)}
              </button>
            </div>
          </div>
        </div>
      )}

      {waiterModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => !waiterSending && setWaiterModalOpen(false)} />
          <div className="relative bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <p className="font-bold text-lg text-gray-900">Need help at your table?</p>
              <button onClick={() => !waiterSending && setWaiterModalOpen(false)} className="p-1.5 rounded-full hover:bg-gray-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 pb-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-2">
                {([
                  { v: "call_waiter", label: "Call Waiter", icon: Bell },
                  { v: "request_bill", label: "Request Bill", icon: Receipt },
                  { v: "water", label: "Water", icon: GlassWater },
                  { v: "custom", label: "Other", icon: MessageSquare },
                ] as const).map(opt => {
                  const OptIcon = opt.icon;
                  const active = waiterReason === opt.v;
                  return (
                    <button
                      key={opt.v}
                      onClick={() => setWaiterReason(opt.v)}
                      className={cn("flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition", active ? "border-orange-400 bg-orange-50 text-orange-600" : "border-gray-200 text-gray-700 hover:border-gray-300")}
                    >
                      <OptIcon className="w-5 h-5" />
                      <span className="text-xs font-semibold">{opt.label}</span>
                    </button>
                  );
                })}
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">
                  Note {waiterReason === "custom" ? "(required)" : "(optional)"}
                </label>
                <textarea
                  rows={2}
                  maxLength={200}
                  value={waiterNote}
                  onChange={e => setWaiterNote(e.target.value)}
                  placeholder={waiterReason === "request_bill" ? "e.g. split between 2 cards" : waiterReason === "custom" ? "Tell us what you need" : "Anything else? (optional)"}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
              </div>

              {waiterStatus === "sent" && (
                <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-3 py-2 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" /> A waiter has been notified.
                </div>
              )}
              {waiterStatus === "error" && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-3 py-2">
                  Could not send the request. Please try again.
                </div>
              )}

              <button
                disabled={waiterSending || waiterCooldownUntil > now || (waiterReason === "custom" && !waiterNote.trim())}
                onClick={sendWaiterRequest}
                className="w-full bg-orange-500 text-white font-bold rounded-xl py-3.5 disabled:opacity-50 hover:bg-orange-600 transition flex items-center justify-center gap-2"
              >
                {waiterSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                {waiterCooldownUntil > now
                  ? `Wait ${Math.ceil((waiterCooldownUntil - now) / 1000)}s before next request`
                  : waiterSending ? "Sending…" : "Send request"}
              </button>
              <p className="text-xs text-gray-400 text-center">A staff member will be with you shortly.</p>
            </div>
          </div>
        </div>
      )}

      {rewardsOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => !rewardsLoading && setRewardsOpen(false)} />
          <div className="relative bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <p className="font-bold text-lg text-gray-900 flex items-center gap-2"><Gift className="w-5 h-5 text-orange-500" /> Your Rewards</p>
              <button onClick={() => !rewardsLoading && setRewardsOpen(false)} className="p-1.5 rounded-full hover:bg-gray-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 pb-5 space-y-4 overflow-y-auto">
              <div>
                <div className="flex gap-1 mb-2 bg-gray-100 rounded-lg p-1">
                  <button onClick={() => { setRewardsMode("phone"); setRewardsError(null); }} className={cn("flex-1 text-xs font-semibold py-1.5 rounded-md transition", rewardsMode === "phone" ? "bg-white text-orange-600 shadow-sm" : "text-gray-500")}>Phone</button>
                  <button onClick={() => { setRewardsMode("email"); setRewardsError(null); }} className={cn("flex-1 text-xs font-semibold py-1.5 rounded-md transition", rewardsMode === "email" ? "bg-white text-orange-600 shadow-sm" : "text-gray-500")}>Email</button>
                </div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">{rewardsMode === "phone" ? "Phone number" : "Email address"}</label>
                <div className="flex gap-2">
                  {rewardsMode === "phone" ? (
                    <input
                      type="tel"
                      inputMode="tel"
                      value={rewardsPhone}
                      onChange={e => setRewardsPhone(e.target.value)}
                      placeholder="Enter the phone you used to order"
                      className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                    />
                  ) : (
                    <input
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={rewardsEmail}
                      onChange={e => setRewardsEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                    />
                  )}
                  <button
                    onClick={fetchRewards}
                    disabled={rewardsLoading || (rewardsMode === "phone" ? rewardsPhone.trim().length < 6 : (rewardsEmail.trim().length < 5 || !rewardsEmail.includes("@")))}
                    className="px-4 bg-orange-500 text-white text-sm font-semibold rounded-xl disabled:opacity-50 hover:bg-orange-600 transition flex items-center gap-1"
                  >
                    {rewardsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check"}
                  </button>
                </div>
              </div>

              {rewardsError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-3 py-2">{rewardsError}</div>
              )}

              {rewardsData && !rewardsData.found && (
                <div className="bg-orange-50 border border-orange-200 text-orange-800 text-sm rounded-xl px-3 py-3 space-y-1">
                  <p className="font-semibold">No rewards account yet</p>
                  <p className="text-xs">Order with this phone number to start earning {rewardsData.pointsPerCurrencyUnit} pt for every {rewardsData.currency || "₹"}1 spent. Each point is worth {rewardsData.currency || "₹"}{Number(rewardsData.redemptionRate).toFixed(2)}.</p>
                </div>
              )}

              {rewardsData?.found && (
                <>
                  <div className="bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded-2xl p-4">
                    <p className="text-xs uppercase tracking-wider opacity-80">Available balance</p>
                    <p className="text-3xl font-bold mt-1">{rewardsData.balance ?? 0} pts</p>
                    <p className="text-xs mt-1 opacity-90">≈ {rewardsData.currency || "₹"}{((rewardsData.balance ?? 0) * Number(rewardsData.redemptionRate)).toFixed(2)} to redeem at the counter</p>
                    {rewardsData.tier && (
                      <div className="mt-3 pt-3 border-t border-white/20 flex items-center justify-between text-xs">
                        <span>Tier: <span className="font-bold">{rewardsData.tier.name}</span>{rewardsData.tier.multiplier !== 1 && ` · ${rewardsData.tier.multiplier}× earn`}</span>
                        {rewardsData.nextTier && (
                          <span className="opacity-90">{rewardsData.nextTier.pointsToGo} pts to {rewardsData.nextTier.name}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {rewardsData.history && rewardsData.history.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-700 mb-2">Recent activity</p>
                      <div className="space-y-1.5 max-h-56 overflow-y-auto">
                        {rewardsData.history.map((h, idx) => (
                          <div key={`${h.createdAt}-${idx}`} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                            <div className="min-w-0">
                              <p className="font-medium text-gray-800 truncate">{h.reason ?? h.type}</p>
                              <p className="text-gray-400">{new Date(h.createdAt).toLocaleDateString()}{h.expiresAt ? ` · expires ${new Date(h.expiresAt).toLocaleDateString()}` : ""}</p>
                            </div>
                            <span className={cn("font-bold tabular-nums", h.points >= 0 ? "text-green-600" : "text-orange-600")}>
                              {h.points >= 0 ? "+" : ""}{h.points}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-gray-400 text-center">Show your phone number at the counter to redeem.</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
