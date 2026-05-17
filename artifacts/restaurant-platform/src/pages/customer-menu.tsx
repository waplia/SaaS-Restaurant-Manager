import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { io, type Socket } from "socket.io-client";
import { X, Plus, Minus, Star, Bell, ArrowLeft, CheckCircle, ChefHat, Truck, Loader2, CreditCard, Banknote, ShoppingCart, Receipt, GlassWater, MessageSquare, Gift, Search, Award, UtensilsCrossed, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = "/api";

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

interface PublicMenuNutrition {
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  containsDairy: boolean | null;
  containsNuts: boolean | null;
  containsGluten: boolean | null;
  isVegan: boolean | null;
  isJain: boolean | null;
  spicyLevel: number | null;
}

interface PublicMenuItem {
  id: number;
  name: string;
  description: string | null;
  price: string;
  imageUrl: string | null;
  isAvailable: boolean;
  isVeg?: boolean;
  calories: number | null;
  prepTime: number | null;
  tags?: string[] | null;
  allergens?: string[] | null;
  nutrition?: PublicMenuNutrition;
  modifierGroups: PublicModifierGroup[];
}

interface PublicMenuCategory {
  id: number;
  name: string;
  imageUrl: string | null;
  items: PublicMenuItem[];
}

interface MenuImageConfig {
  aspectRatio: string;
  fallbackPlaceholder: string;
  showInCustomerMenu: boolean;
}

interface PublicMenu {
  restaurantId: number;
  restaurantName: string;
  restaurantSlug: string;
  logoUrl: string | null;
  currency: string;
  menuBannerUrl?: string | null;
  menuImageConfig?: MenuImageConfig;
  showNutritionOnQrMenu?: boolean;
  categories: PublicMenuCategory[];
}

function resolveImg(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("/objects/")) {
    return `${API_BASE}/public/storage${url}`;
  }
  return url;
}

function arNum(ratio: string | undefined): number {
  if (!ratio) return 1;
  const [w, h] = ratio.split(":").map(Number);
  return w && h ? w / h : 1;
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

function isModifierSelectionValid(item: PublicMenuItem, selected: SelectedModifier[]): { ok: boolean; missing: string | null } {
  for (const group of item.modifierGroups) {
    const count = selected.filter(m => m.groupId === group.id).length;
    const min = group.isRequired ? Math.max(1, group.minSelections ?? 1) : (group.minSelections ?? 0);
    if (count < min) return { ok: false, missing: group.name };
    if (group.maxSelections && count > group.maxSelections) return { ok: false, missing: group.name };
  }
  return { ok: true, missing: null };
}

function itemHasTag(item: PublicMenuItem, tag: string): boolean {
  return !!item.tags?.some(t => t.toLowerCase() === tag.toLowerCase());
}

function VegIcon({ isVeg, size = 14 }: { isVeg?: boolean; size?: number }) {
  const color = isVeg === false ? "#EF4444" : isVeg === true ? "#16A34A" : "#9CA3AF";
  return (
    <span
      className="inline-flex items-center justify-center border-2 flex-shrink-0 rounded-[3px]"
      style={{ width: size, height: size, borderColor: color }}
      aria-label={isVeg === false ? "Non-veg" : "Veg"}
    >
      {isVeg === false ? (
        <span className="rounded-full" style={{ width: size * 0.45, height: size * 0.45, background: color, clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)" }} />
      ) : (
        <span className="rounded-full" style={{ width: size * 0.45, height: size * 0.45, backgroundColor: color }} />
      )}
    </span>
  );
}

function FoodFallback({ className = "", rounded = "rounded-xl" }: { className?: string; rounded?: string }) {
  return (
    <div className={cn("bg-gradient-to-br from-orange-100 via-amber-50 to-orange-50 flex items-center justify-center text-orange-400", rounded, className)}>
      <UtensilsCrossed className="w-1/3 h-1/3 opacity-60" strokeWidth={1.5} />
    </div>
  );
}

function MenuSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50 max-w-md mx-auto">
      <div className="bg-orange-500 h-28" />
      <div className="-mt-10 mx-4 bg-white rounded-2xl h-12 shadow-sm animate-pulse" />
      <div className="px-4 mt-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl shadow-sm h-24 flex overflow-hidden">
            <div className="w-24 h-24 bg-gray-100 animate-pulse" />
            <div className="flex-1 p-3 space-y-2">
              <div className="h-3 bg-gray-100 rounded w-2/3 animate-pulse" />
              <div className="h-2.5 bg-gray-100 rounded w-full animate-pulse" />
              <div className="h-2.5 bg-gray-100 rounded w-1/2 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
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
  const [dietFilters, setDietFilters] = useState<{ vegan: boolean; jain: boolean; noDairy: boolean; noNuts: boolean; noGluten: boolean; spicyMax: number | null }>({
    vegan: false, jain: false, noDairy: false, noNuts: false, noGluten: false, spicyMax: null,
  });
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);

  const [selectedItem, setSelectedItem] = useState<PublicMenuItem | null>(null);
  const [itemQty, setItemQty] = useState(1);
  const [itemNotes, setItemNotes] = useState("");
  const [selectedModifiers, setSelectedModifiers] = useState<SelectedModifier[]>([]);

  const [view, setView] = useState<"menu" | "checkout" | "payment" | "success" | "tracking">("menu");
  const [searchQuery, setSearchQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<"all" | "veg" | "non-veg" | "bestseller">("all");
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

  // Persist orderId+token in URL while the customer is on success/tracking
  // so refreshing the tab restores the order view (recovered by the
  // Stripe-return handler above which already accepts ?order=&token=).
  useEffect(() => {
    if (!orderResult || (view !== "success" && view !== "tracking")) return;
    const qs = new URLSearchParams(window.location.search);
    qs.set("order", String(orderResult.orderId));
    qs.set("token", orderResult.guestToken);
    window.history.replaceState({}, "", `${window.location.pathname}?${qs.toString()}`);
  }, [orderResult, view]);

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
  const imgCfg = menu?.menuImageConfig;
  const showImages = imgCfg?.showInCustomerMenu !== false;
  const fallbackPlaceholder = resolveImg(imgCfg?.fallbackPlaceholder ?? "");
  const itemAR = arNum(imgCfg?.aspectRatio ?? "1:1");

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

  function addToCart(
    item: PublicMenuItem,
    opts?: { modifiers?: SelectedModifier[]; quantity?: number; notes?: string },
  ) {
    const modifiers = opts?.modifiers ?? selectedModifiers;
    const quantity = opts?.quantity ?? itemQty;
    const notes = opts?.notes ?? itemNotes;
    const modTotal = modifiers.reduce((s, m) => s + Number(m.price), 0);
    setCart(prev => {
      const modKey = modifiers.map(m => m.modifierId).sort().join(",");
      const existing = prev.find(c => c.menuItemId === item.id && c.modifiers.map(m => m.modifierId).sort().join(",") === modKey);
      if (existing) {
        return prev.map(c => c === existing ? { ...c, quantity: c.quantity + quantity, notes: notes || c.notes } : c);
      }
      return [...prev, {
        menuItemId: item.id,
        name: item.name,
        basePrice: Number(item.price),
        modifierTotal: modTotal,
        quantity,
        notes: notes || undefined,
        imageUrl: item.imageUrl,
        modifiers,
      }];
    });
    if (!opts) {
      setSelectedItem(null);
      setItemQty(1);
      setItemNotes("");
      setSelectedModifiers([]);
    }
  }

  function updateQty(cartIdx: number, delta: number) {
    setCart(prev => prev.map((c, i) => i === cartIdx ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c).filter(c => c.quantity > 0));
  }

  function scrollToCategory(catId: number) {
    setActiveCategory(catId);
    categoryRefs.current[catId]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    if (!menu || menu.categories.length === 0 || view !== "menu") return;
    const obs = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length > 0) {
          const id = Number((visible[0].target as HTMLElement).dataset.catId);
          if (id) setActiveCategory(id);
        }
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    const els = Object.values(categoryRefs.current).filter(Boolean) as HTMLDivElement[];
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [menu, view]);

  useEffect(() => {
    if (activeCategory == null) return;
    const el = document.querySelector(`[data-cat-chip="${activeCategory}"]`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeCategory]);

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
        setView("success");
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

  function openWaiterModal(reason?: "call_waiter" | "request_bill" | "water" | "custom") {
    setWaiterReason(reason ?? "call_waiter");
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
    return <MenuSkeleton />;
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

  if (view === "success" && orderResult && orderStatus) {
    const etaMin = 15 + Math.floor(orderStatus.items.length * 2);
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#FFF8F1] via-[#FFFDF9] to-white max-w-md mx-auto">
        <div className="px-4 pt-10 pb-6 text-center">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4 shadow-sm">
            <CheckCircle className="w-12 h-12 text-[#16A34A]" />
          </div>
          <p className="text-2xl font-bold text-[#111827]">Order placed!</p>
          <p className="text-sm text-gray-500 mt-1">The kitchen has started preparing your food.</p>
        </div>

        <div className="mx-4 bg-white rounded-2xl shadow-sm p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Order</p>
              <p className="text-xl font-bold text-[#111827]">#{orderResult.orderNumber}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400 uppercase tracking-wider">Table</p>
              <p className="text-xl font-bold text-[#111827]">{tableId}</p>
            </div>
          </div>
          <div className="bg-[#FFF8F1] border border-[#FFE7D4] rounded-xl px-4 py-3 flex items-center gap-3">
            <Clock className="w-5 h-5 text-[#FF6B1A]" />
            <div>
              <p className="text-xs text-gray-500">Estimated time</p>
              <p className="text-sm font-bold text-[#111827]">~{etaMin} min</p>
            </div>
          </div>
        </div>

        <div className="mx-4 bg-white rounded-2xl shadow-sm p-5 mb-4">
          <p className="text-xs uppercase tracking-wider text-gray-400 mb-3">Your order</p>
          <div className="space-y-2">
            {orderStatus.items.map((it, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-gray-700">{it.quantity}× {it.menuItemName}</span>
                <span className="font-medium text-gray-800">{currSymbol}{Number(it.totalPrice).toFixed(2)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-gray-100 pt-2 mt-2">
              <span className="text-sm font-semibold text-gray-700">Total</span>
              <span className="text-base font-bold text-[#FF6B1A]">{currSymbol}{Number(orderStatus.totalAmount).toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="mx-4 grid grid-cols-2 gap-2 mb-4">
          <button
            onClick={() => setView("tracking")}
            className="bg-[#FF6B1A] text-white font-bold rounded-xl py-3.5 text-sm hover:bg-[#E85A0C] transition flex items-center justify-center gap-1.5"
          >
            <Truck className="w-4 h-4" /> Track Order
          </button>
          <button
            onClick={() => { setView("menu"); }}
            className="bg-white border-2 border-[#FF6B1A] text-[#FF6B1A] font-bold rounded-xl py-3.5 text-sm hover:bg-[#FFF8F1] transition flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Add More
          </button>
          <button
            onClick={() => openWaiterModal("call_waiter")}
            className="bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl py-3 text-sm hover:bg-gray-50 transition flex items-center justify-center gap-1.5"
          >
            <Bell className="w-4 h-4" /> Call Waiter
          </button>
          <button
            onClick={() => openWaiterModal("request_bill")}
            className="bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl py-3 text-sm hover:bg-gray-50 transition flex items-center justify-center gap-1.5"
          >
            <Receipt className="w-4 h-4" /> Request Bill
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 pb-8">You'll see live updates as the kitchen prepares your order.</p>
      </div>
    );
  }

  if (view === "tracking" && orderResult && orderStatus) {
    const currentIdx = statusIndex(orderStatus.status);
    const isServed = orderStatus.status === "served" || orderStatus.status === "completed";

    return (
      <div className="min-h-screen bg-orange-50 max-w-md mx-auto">
        <div className="bg-orange-500 text-white px-4 py-4 flex items-center gap-3">
          {menu.logoUrl && <img src={resolveImg(menu.logoUrl)} alt="" className="w-8 h-8 rounded-full object-cover" />}
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

          <div className="grid grid-cols-3 gap-2 mb-4">
            <button onClick={() => openWaiterModal("call_waiter")} className="flex flex-col items-center gap-1 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl py-3 text-xs hover:border-[#FF6B1A] hover:text-[#FF6B1A] transition">
              <Bell className="w-4 h-4" /> Call Waiter
            </button>
            <button onClick={() => openWaiterModal("water")} className="flex flex-col items-center gap-1 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl py-3 text-xs hover:border-[#FF6B1A] hover:text-[#FF6B1A] transition">
              <GlassWater className="w-4 h-4" /> Water
            </button>
            <button onClick={() => openWaiterModal("request_bill")} className="flex flex-col items-center gap-1 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl py-3 text-xs hover:border-[#FF6B1A] hover:text-[#FF6B1A] transition">
              <Receipt className="w-4 h-4" /> Request Bill
            </button>
          </div>

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
      {showImages && menu.menuBannerUrl && (
        <img src={resolveImg(menu.menuBannerUrl)} alt="" className="w-full h-40 object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
      )}
      <div className="bg-gradient-to-br from-[#FF6B1A] to-[#E85A0C] text-white px-4 pt-5 pb-20">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0">
            {menu.logoUrl && <img src={resolveImg(menu.logoUrl)} alt="" className="w-10 h-10 rounded-full object-cover border-2 border-white/30 flex-shrink-0" />}
            <div className="min-w-0">
              <p className="font-bold text-lg leading-tight truncate">{menu.restaurantName}</p>
              <p className="text-orange-50 text-xs flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 bg-white/15 px-2 py-0.5 rounded-full"><span className="w-1.5 h-1.5 bg-green-300 rounded-full" /> Open</span>
                <span>· Table {tableId}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={openRewards} className="flex items-center gap-1 bg-white/15 hover:bg-white/25 text-white text-[11px] font-medium px-2.5 py-1.5 rounded-full transition">
              <Gift className="w-3.5 h-3.5" /> Rewards
            </button>
            <button onClick={openWaiterModal} className="flex items-center gap-1 bg-white/15 hover:bg-white/25 text-white text-[11px] font-medium px-2.5 py-1.5 rounded-full transition">
              <Bell className="w-3.5 h-3.5" /> Waiter
            </button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search for dishes…"
            className="w-full bg-white text-gray-800 placeholder-gray-400 rounded-xl pl-10 pr-9 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-white/60"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
          )}
        </div>
      </div>

      <div className="-mt-12 mx-4 mb-2 flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
        {([
          { v: "all", label: "All" },
          { v: "veg", label: "Veg" },
          { v: "non-veg", label: "Non-veg" },
          { v: "bestseller", label: "Bestsellers" },
        ] as const).map(opt => {
          const active = quickFilter === opt.v;
          return (
            <button
              key={opt.v}
              onClick={() => setQuickFilter(opt.v)}
              className={cn(
                "text-xs font-semibold px-3 py-2 rounded-full whitespace-nowrap border transition shadow-sm flex items-center gap-1.5",
                active
                  ? "bg-[#111827] text-white border-[#111827]"
                  : "bg-white text-gray-700 border-gray-200 hover:border-gray-300",
              )}
            >
              {opt.v === "veg" && <VegIcon isVeg size={12} />}
              {opt.v === "non-veg" && <VegIcon isVeg={false} size={12} />}
              {opt.v === "bestseller" && <Award className="w-3 h-3" />}
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur shadow-sm">
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex gap-0 min-w-max px-2">
            {menu.categories.map(cat => (
              <button
                key={cat.id}
                data-cat-chip={cat.id}
                onClick={() => scrollToCategory(cat.id)}
                className={cn("px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition flex items-center gap-2", activeCategory === cat.id ? "border-[#FF6B1A] text-[#FF6B1A]" : "border-transparent text-gray-500 hover:text-gray-800")}
              >
                {showImages && cat.imageUrl && (
                  <img src={resolveImg(cat.imageUrl)} alt="" className="w-6 h-6 rounded-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                )}
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {menu.showNutritionOnQrMenu && (
        <div className="px-4 pt-3">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {([
              ["vegan", "Vegan"],
              ["jain", "Jain"],
              ["noDairy", "No dairy"],
              ["noNuts", "No nuts"],
              ["noGluten", "Gluten-free"],
            ] as const).map(([key, label]) => {
              const active = dietFilters[key];
              return (
                <button
                  key={key}
                  onClick={() => setDietFilters(p => ({ ...p, [key]: !p[key] }))}
                  className={cn(
                    "text-[11px] font-medium px-3 py-1.5 rounded-full whitespace-nowrap border transition",
                    active ? "bg-orange-500 text-white border-orange-500" : "bg-white text-gray-600 border-gray-200",
                  )}
                >
                  {label}
                </button>
              );
            })}
            {([["1", "Mild only"], ["2", "≤ Medium"]] as const).map(([val, label]) => {
              const n = Number(val);
              const active = dietFilters.spicyMax === n;
              return (
                <button
                  key={val}
                  onClick={() => setDietFilters(p => ({ ...p, spicyMax: active ? null : n }))}
                  className={cn(
                    "text-[11px] font-medium px-3 py-1.5 rounded-full whitespace-nowrap border transition",
                    active ? "bg-orange-500 text-white border-orange-500" : "bg-white text-gray-600 border-gray-200",
                  )}
                >
                  🌶 {label}
                </button>
              );
            })}
            {(dietFilters.vegan || dietFilters.jain || dietFilters.noDairy || dietFilters.noNuts || dietFilters.noGluten || dietFilters.spicyMax != null) && (
              <button
                onClick={() => setDietFilters({ vegan: false, jain: false, noDairy: false, noNuts: false, noGluten: false, spicyMax: null })}
                className="text-[11px] font-medium px-2 py-1.5 text-gray-400 underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <div className="px-4 pt-4 pb-32 space-y-6">
        {menu.categories.map(cat => {
          const q = searchQuery.trim().toLowerCase();
          const visibleItems = cat.items.filter(item => {
            const n = item.nutrition;
            if (dietFilters.vegan && !(n?.isVegan === true)) return false;
            if (dietFilters.jain && !(n?.isJain === true)) return false;
            if (dietFilters.noDairy && n?.containsDairy === true) return false;
            if (dietFilters.noNuts && n?.containsNuts === true) return false;
            if (dietFilters.noGluten && n?.containsGluten === true) return false;
            if (dietFilters.spicyMax != null && n?.spicyLevel != null && n.spicyLevel > dietFilters.spicyMax) return false;
            if (quickFilter === "veg" && item.isVeg !== true) return false;
            if (quickFilter === "non-veg" && item.isVeg !== false) return false;
            if (quickFilter === "bestseller" && !itemHasTag(item, "bestseller")) return false;
            if (q) {
              const hay = `${item.name} ${item.description ?? ""} ${(item.tags ?? []).join(" ")}`.toLowerCase();
              if (!hay.includes(q)) return false;
            }
            return true;
          });
          const anyFilter = quickFilter !== "all" || q.length > 0 || dietFilters.vegan || dietFilters.jain || dietFilters.noDairy || dietFilters.noNuts || dietFilters.noGluten || dietFilters.spicyMax != null;
          if (anyFilter && visibleItems.length === 0) return null;
          return (
          <div key={cat.id} data-cat-id={cat.id} ref={el => { categoryRefs.current[cat.id] = el; }} className="scroll-mt-16">
            <h2 className="text-base font-bold text-gray-900 mb-3 flex items-center justify-between">
              <span>{cat.name}</span>
              <span className="text-xs font-medium text-gray-400">{visibleItems.length} item{visibleItems.length === 1 ? "" : "s"}</span>
            </h2>
            <div className="space-y-3">
              {visibleItems.map(item => {
                const cartCount = cart.filter(c => c.menuItemId === item.id).reduce((s, c) => s + c.quantity, 0);
                const hasModifiers = item.modifierGroups && item.modifierGroups.length > 0;
                const isBestseller = itemHasTag(item, "bestseller");
                const isRecommended = itemHasTag(item, "recommended") || itemHasTag(item, "chef") || itemHasTag(item, "chefs-special");
                const outOfStock = !item.isAvailable;
                const showImg = showImages;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "bg-white rounded-2xl shadow-sm overflow-hidden flex cursor-pointer hover:shadow-md transition-shadow relative",
                      outOfStock && "opacity-60",
                    )}
                    onClick={() => !outOfStock && openItemDetail(item)}
                  >
                    <div className="flex-1 p-3 flex flex-col justify-between min-w-0">
                      <div>
                        <div className="flex items-start gap-1.5">
                          <span className="mt-1"><VegIcon isVeg={item.isVeg} /></span>
                          <p className="font-semibold text-gray-900 text-sm leading-tight">{item.name}</p>
                        </div>
                        <div className="flex gap-1 mt-1 flex-wrap items-center">
                          {isBestseller && (
                            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold flex items-center gap-0.5"><Award className="w-2.5 h-2.5" />Bestseller</span>
                          )}
                          {isRecommended && (
                            <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold">Recommended</span>
                          )}
                        </div>
                        <span className="font-bold text-gray-900 text-sm block mt-1.5">{currSymbol}{Number(item.price).toFixed(2)}</span>
                        {item.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.description}</p>}
                        <div className="flex gap-2 mt-1 flex-wrap items-center">
                          {item.prepTime != null && (
                            <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{item.prepTime} min</span>
                          )}
                          {menu.showNutritionOnQrMenu && item.calories != null && (
                            <span className="text-[10px] text-gray-400">{item.calories} kcal</span>
                          )}
                          {menu.showNutritionOnQrMenu && item.nutrition?.spicyLevel != null && item.nutrition.spicyLevel > 0 && (
                            <span className="text-[10px] text-red-500">{"🌶".repeat(item.nutrition.spicyLevel)}</span>
                          )}
                          {menu.showNutritionOnQrMenu && item.nutrition?.isVegan && (
                            <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">Vegan</span>
                          )}
                          {menu.showNutritionOnQrMenu && item.nutrition?.isJain && (
                            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Jain</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {showImg && (
                      <div className="relative flex-shrink-0 p-3">
                        <div className="relative" style={{ width: 104, aspectRatio: itemAR }}>
                          <FoodFallback className="absolute inset-0 w-full h-full" />
                          {item.imageUrl ? (
                            <img
                              src={resolveImg(item.imageUrl)}
                              alt={item.name}
                              loading="lazy"
                              className="relative w-full h-full object-cover rounded-xl"
                              onError={e => {
                                const t = e.target as HTMLImageElement;
                                if (fallbackPlaceholder && t.src !== fallbackPlaceholder) { t.src = fallbackPlaceholder; }
                                else { t.style.visibility = "hidden"; }
                              }}
                            />
                          ) : fallbackPlaceholder ? (
                            <img src={fallbackPlaceholder} alt="" loading="lazy" className="relative w-full h-full object-cover rounded-xl" />
                          ) : null}
                          {outOfStock ? (
                            <div className="absolute inset-x-0 -bottom-2 mx-auto bg-gray-700 text-white text-[10px] font-bold rounded-full px-3 py-1.5 w-max shadow-md">
                              Sold out
                            </div>
                          ) : (
                            <button
                              onClick={e => { e.stopPropagation(); if (hasModifiers) openItemDetail(item); else addToCart(item, { modifiers: [], quantity: 1, notes: "" }); }}
                              className="absolute inset-x-0 -bottom-2 mx-auto bg-white border border-[#FF6B1A] text-[#FF6B1A] text-[11px] font-bold rounded-lg px-3 py-1.5 w-max shadow-md hover:bg-[#FF6B1A] hover:text-white transition"
                            >
                              {cartCount > 0 ? `ADDED · ${cartCount}` : hasModifiers ? "CUSTOMIZE" : "ADD"}
                              {hasModifiers && <span className="block text-[8px] font-normal leading-none mt-0.5">customizable</span>}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {visibleItems.length === 0 && <p className="text-sm text-gray-400 py-2">No items match the current filters.</p>}
            </div>
          </div>
          );
        })}
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
                  {item.imageUrl && <img src={resolveImg(item.imageUrl)} alt={item.name} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />}
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
              <QrUpsellStrip
                restaurantId={menu?.restaurantId ?? 0}
                cart={cart}
                cartTotal={cartTotal}
                currSymbol={currSymbol}
                resolveImg={resolveImg}
                onAdd={(it) => addToCart({
                  id: it.id, name: it.name, price: it.price, imageUrl: it.imageUrl,
                  isAvailable: true, modifierGroups: [],
                } as unknown as PublicMenuItem)}
              />
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
            {showImages && (selectedItem.imageUrl || fallbackPlaceholder) && (
              <img
                src={resolveImg(selectedItem.imageUrl) || fallbackPlaceholder}
                alt={selectedItem.name}
                className="w-full object-cover rounded-t-3xl flex-shrink-0"
                style={{ aspectRatio: itemAR }}
                onError={e => { const t = e.target as HTMLImageElement; if (fallbackPlaceholder && t.src !== fallbackPlaceholder) t.src = fallbackPlaceholder; else t.style.display = "none"; }}
              />
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
              {selectedItem.calories && <p className="text-xs text-gray-400 mb-2">{selectedItem.calories} cal{selectedItem.prepTime ? ` · ${selectedItem.prepTime} min` : ""}</p>}
              {menu.showNutritionOnQrMenu && selectedItem.nutrition && (
                <div className="mb-4 space-y-2">
                  {(selectedItem.nutrition.proteinG != null || selectedItem.nutrition.fatG != null || selectedItem.nutrition.carbsG != null) && (
                    <div className="grid grid-cols-3 gap-2">
                      {selectedItem.nutrition.proteinG != null && (
                        <div className="bg-gray-50 rounded-lg px-2 py-1.5 text-center">
                          <p className="text-[10px] uppercase text-gray-400">Protein</p>
                          <p className="text-xs font-bold text-gray-700">{selectedItem.nutrition.proteinG}g</p>
                        </div>
                      )}
                      {selectedItem.nutrition.fatG != null && (
                        <div className="bg-gray-50 rounded-lg px-2 py-1.5 text-center">
                          <p className="text-[10px] uppercase text-gray-400">Fat</p>
                          <p className="text-xs font-bold text-gray-700">{selectedItem.nutrition.fatG}g</p>
                        </div>
                      )}
                      {selectedItem.nutrition.carbsG != null && (
                        <div className="bg-gray-50 rounded-lg px-2 py-1.5 text-center">
                          <p className="text-[10px] uppercase text-gray-400">Carbs</p>
                          <p className="text-xs font-bold text-gray-700">{selectedItem.nutrition.carbsG}g</p>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {selectedItem.nutrition.isVegan && <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Vegan</span>}
                    {selectedItem.nutrition.isJain && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Jain</span>}
                    {selectedItem.nutrition.spicyLevel != null && selectedItem.nutrition.spicyLevel > 0 && (
                      <span className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-medium">Spicy {selectedItem.nutrition.spicyLevel}/3</span>
                    )}
                    {selectedItem.nutrition.containsDairy && <span className="text-[10px] bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">Contains dairy</span>}
                    {selectedItem.nutrition.containsNuts && <span className="text-[10px] bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">Contains nuts</span>}
                    {selectedItem.nutrition.containsGluten && <span className="text-[10px] bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">Contains gluten</span>}
                  </div>
                  <p className="text-[10px] text-gray-400 italic">Estimated values — please ask staff if you have a serious allergy.</p>
                </div>
              )}

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
              {(() => {
                const valid = isModifierSelectionValid(selectedItem, selectedModifiers);
                return (
                  <>
                    {!valid.ok && valid.missing && (
                      <p className="text-xs text-orange-600 mb-2 text-center">Please complete required choices for <span className="font-semibold">{valid.missing}</span>.</p>
                    )}
                    <button
                      onClick={() => addToCart(selectedItem)}
                      disabled={!valid.ok}
                      className="w-full bg-[#FF6B1A] text-white font-bold rounded-xl py-4 hover:bg-[#E85A0C] transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Add to Cart · {currSymbol}{(itemUnitPrice(Number(selectedItem.price), selectedModifiers) * itemQty).toFixed(2)}
                    </button>
                  </>
                );
              })()}
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

interface QrUpsellItem { id: number; name: string; price: string; imageUrl: string | null }
interface QrUpsellSuggestion { ruleId: number; ruleName: string; message: string | null; items: QrUpsellItem[] }

function QrUpsellStrip({
  restaurantId, cart, cartTotal, currSymbol, resolveImg, onAdd,
}: {
  restaurantId: number;
  cart: CartItem[];
  cartTotal: number;
  currSymbol: string;
  resolveImg: (u: string | null | undefined) => string;
  onAdd: (item: QrUpsellItem) => void;
}) {
  const [suggestions, setSuggestions] = useState<QrUpsellSuggestion[]>([]);
  const loggedRef = useRef<Set<string>>(new Set());

  const items = cart.map(c => ({
    menuItemId: c.menuItemId, quantity: c.quantity, unitPrice: itemUnitPrice(c.basePrice, c.modifiers),
  }));
  const hash = `${items.length}|${cartTotal.toFixed(2)}|${items.map(i => `${i.menuItemId}x${i.quantity}`).join(",")}`;

  useEffect(() => {
    if (!restaurantId || items.length === 0) { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await apiPublicPost<{ suggestions: QrUpsellSuggestion[] }>(
          `/public/restaurants/${restaurantId}/upsell/evaluate`,
          { items, total: cartTotal },
        );
        setSuggestions(res.suggestions ?? []);
        const events: Array<Record<string, unknown>> = [];
        for (const s of res.suggestions ?? []) {
          for (const it of s.items) {
            const k = `${s.ruleId}:${it.id}:${hash}`;
            if (!loggedRef.current.has(k)) {
              loggedRef.current.add(k);
              events.push({ eventType: "impression", channel: "qr", ruleId: s.ruleId, menuItemId: it.id });
            }
          }
        }
        if (events.length > 0) {
          apiPublicPost(`/public/restaurants/${restaurantId}/upsell/events`, { events }).catch(() => {});
        }
      } catch { /* silent */ }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, restaurantId]);

  if (suggestions.length === 0) return null;
  return (
    <div className="mt-2 rounded-xl bg-orange-50 border border-orange-200 p-3">
      <p className="text-xs font-bold text-orange-700 mb-2 flex items-center gap-1">
        <Gift className="w-3.5 h-3.5" /> Recommended for you
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {suggestions.flatMap(s => s.items.map(it => (
          <button
            key={`${s.ruleId}-${it.id}`}
            onClick={() => {
              apiPublicPost(`/public/restaurants/${restaurantId}/upsell/events`, {
                eventType: "accept", channel: "qr", ruleId: s.ruleId, menuItemId: it.id,
                revenue: Number(it.price),
              }).catch(() => {});
              onAdd(it);
            }}
            className="flex-shrink-0 w-28 bg-white rounded-lg border border-orange-200 p-2 text-left active:scale-95 transition"
          >
            {it.imageUrl ? (
              <img src={resolveImg(it.imageUrl)} alt="" className="w-full h-16 rounded-md object-cover mb-1.5" />
            ) : (
              <div className="w-full h-16 rounded-md bg-orange-100 mb-1.5" />
            )}
            <p className="text-xs font-semibold text-gray-800 truncate">{it.name}</p>
            <p className="text-xs text-orange-500 font-bold">+{currSymbol}{Number(it.price).toFixed(0)}</p>
          </button>
        )))}
      </div>
    </div>
  );
}
