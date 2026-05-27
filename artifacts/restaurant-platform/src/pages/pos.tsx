import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Link } from "wouter";
import { PosShell, holdBill, type HeldBill } from "@/components/pos/PosShell";
import {
  useFloorTables, useMenus, useMenuCategories, useMenuItems,
  useCreateOrder, usePayOrder, useVoidOrder, useOrders,
  useRestaurantInfo, useItemModifierGroups, useSplitOrder,
  useOrderDetail, useAddOrderItem, useRemoveOrderItem,
  useApplyDiscountLine, useRemoveDiscountLine, useDiscountsConfig, useRequestManagerDiscountOtp,
  useCreatePaymentIntent, useCreateRazorpayOrder,
  useApplyLoyalty, useCustomerLoyalty, useCustomerByPhone, useCreateCustomer, useApplyCoupon, useCustomers,
  useCurrentCashRegister,
  useTerminals, useTerminalCharge, useConfirmTerminalCharge, useTerminalRunOnReader,
  usePendingCartSessions, useReservations,
  usePopularItems,
} from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/PhoneInput";
import { cn, formatOrderNumber } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { FloorTable, MenuItem, MenuCategory, Order, PosModifierGroup, OrderDetail, OrderItem, TipPolicy, Customer } from "@/lib/types";
import { resolveImageUrl } from "@/components/ImageUploadField";
import { apiPost, apiAction, apiGet, isOfflineQueuedResult } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { useRestaurantId } from "@/lib/hooks";
import { useBranchContext } from "@/lib/branch";
import { printOrder, printKitchenTicket } from "@/lib/printOrder";
import { playPosSound } from "@/lib/posSounds";
import {
  ShoppingBag, CreditCard, Banknote, Smartphone, Printer,
  Trash2, Plus, Minus, Tag, ChevronDown, ChevronUp, X,
  Utensils, Package, Bike, ReceiptText, AlertTriangle, Scissors,
  Loader2, Check, Lock, Star, UserCheck, AlertCircle, Mic, Gift, Search, User,
  QrCode, CalendarClock, Clock, Leaf, StickyNote, Pause, RotateCcw,
  Phone, MessageCircle, Flame, Sparkles,
} from "lucide-react";
import { VoiceOrderModal, type VoiceOrderConfirmation } from "@/components/pos/VoiceOrderModal";

interface CartModifier {
  name: string;
  price: number;
}

interface CartItem {
  lineKey: string;
  menuItemId: number;
  name: string;
  basePrice: number;
  modifiers: CartModifier[];
  unitPrice: number;
  quantity: number;
  /** Per-line kitchen note ("no onions", "extra spicy", "allergy: nuts"). */
  notes?: string;
}

interface Totals {
  subtotal: number;
  taxAmount: number;
  serviceCharge: number;
  discountAmount: number;
  totalAmount: number;
}

type PayStage = "select" | "cash-confirm" | "card-form" | "upi-form" | "gift-card-form" | "terminal-form" | "processing";

function makeLineKey(menuItemId: number, modifiers: CartModifier[]): string {
  const modKey = [...modifiers].sort((a, b) => a.name.localeCompare(b.name)).map(m => m.name).join("|");
  return modKey ? `${menuItemId}:${modKey}` : String(menuItemId);
}

const ORDER_TYPES = [
  { value: "dine_in", label: "Dine-in", icon: Utensils },
  { value: "takeaway", label: "Takeaway", icon: Package },
  { value: "delivery", label: "Delivery", icon: Bike },
  { value: "qr_order", label: "QR Orders", icon: QrCode },
  { value: "reservation_order", label: "Reservations", icon: CalendarClock },
] as const;

type OrderTypeValue = typeof ORDER_TYPES[number]["value"];
// Order types that actually create an order on the server. The new "qr_order"
// and "reservation_order" tabs are inboxes that seed a real order in one of
// the three primary types below.
type ServerOrderType = "dine_in" | "takeaway" | "delivery";

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash", icon: Banknote },
  { value: "card", label: "Card", icon: CreditCard },
  { value: "upi", label: "UPI", icon: Smartphone },
  { value: "gift_card", label: "Gift Card", icon: Gift },
  { value: "terminal", label: "Terminal", icon: CreditCard },
  { value: "pay_later", label: "Pay Later", icon: Clock },
];

const TABLE_STATUS_STYLE: Record<string, string> = {
  free: "bg-green-100 text-green-800 border-green-300 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700",
  occupied: "bg-orange-100 text-orange-800 border-orange-300 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700",
  reserved: "bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700",
};

function printReceipt(args: {
  orderNumber: string;
  tableLabel: string;
  orderType: string;
  items: Array<{ name: string; unitPrice: number; quantity: number; modifiers: CartModifier[] }>;
  totals: Totals;
  paymentMethod: string;
  amountTendered?: number;
  customerName?: string;
  restaurantName?: string;
  logoUrl?: string;
  restaurantAddress?: string | null;
  restaurantPhone?: string | null;
  splitIndex?: number;
  splitTotal?: number;
  createdAt?: string;
  discounts?: { label: string; amount: number }[];
}) {
  const { orderNumber, tableLabel, orderType, items, totals, paymentMethod, amountTendered, customerName, restaurantName, logoUrl, restaurantAddress, restaurantPhone, splitIndex, splitTotal, createdAt, discounts } = args;
  printOrder({
    size: "thermal-80mm",
    documentTitle: paymentMethod === "pending" ? "Order Receipt" : "Tax Invoice",
    orderNumber,
    createdAt,
    tableLabel,
    orderType,
    customerName,
    items: items.map(it => ({
      name: it.name,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      lineTotal: it.unitPrice * it.quantity,
      modifiers: it.modifiers,
    })),
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    serviceCharge: totals.serviceCharge,
    discountAmount: totals.discountAmount,
    totalAmount: totals.totalAmount,
    discounts,
    payment: paymentMethod === "pending" ? undefined : { method: paymentMethod, tendered: amountTendered },
    splitIndex,
    splitTotal,
    restaurant: {
      name: restaurantName,
      logoUrl,
      address: restaurantAddress,
      phone: restaurantPhone,
    },
  });
}

function ModifierPickerModal({
  item, groups, isLoading, onConfirm, onClose,
}: {
  item: MenuItem;
  groups: PosModifierGroup[];
  isLoading: boolean;
  onConfirm: (item: MenuItem, modifiers: CartModifier[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Record<number, Set<number>>>({});

  useEffect(() => {
    if (!isLoading && groups.length === 0) {
      onConfirm(item, []);
    }
  }, [isLoading, groups.length, item, onConfirm]);

  const toggleModifier = (groupId: number, modId: number, maxSelections: number) => {
    setSelected(prev => {
      const groupSel = new Set(prev[groupId] ?? []);
      if (groupSel.has(modId)) {
        groupSel.delete(modId);
      } else {
        if (maxSelections === 1) groupSel.clear();
        if (groupSel.size < maxSelections) groupSel.add(modId);
      }
      return { ...prev, [groupId]: groupSel };
    });
  };

  const selectedModifiers: CartModifier[] = groups.flatMap(group =>
    [...(selected[group.id] ?? [])].flatMap(modId => {
      const mod = group.modifiers.find(m => m.id === modId);
      return mod ? [{ name: mod.name, price: Number(mod.price) }] : [];
    })
  );

  const canConfirm = groups.every(g => {
    const count = (selected[g.id] ?? new Set()).size;
    return !g.isRequired || count >= g.minSelections;
  });

  const modTotal = selectedModifiers.reduce((s, m) => s + m.price, 0);

  if (isLoading || groups.length === 0) {
    return isLoading ? (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-card rounded-xl p-6 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <span className="text-sm">Loading options…</span>
        </div>
      </div>
    ) : null;
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-semibold text-foreground">{item.name}</h2>
            <p className="text-xs text-muted-foreground">
              Base: ₹{item.price}{modTotal > 0 ? ` + ₹${modTotal.toFixed(2)} modifiers` : ""}
            </p>
          </div>
          <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {groups.map(group => (
            <div key={group.id}>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-sm font-semibold text-foreground">{group.name}</p>
                {group.isRequired && (
                  <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">Required</span>
                )}
                {group.maxSelections > 1 && (
                  <span className="text-xs text-muted-foreground">Pick up to {group.maxSelections}</span>
                )}
              </div>
              <div className="space-y-1.5">
                {group.modifiers.map(mod => {
                  const isSelected = (selected[group.id] ?? new Set()).has(mod.id);
                  return (
                    <button
                      key={mod.id}
                      onClick={() => toggleModifier(group.id, mod.id, group.maxSelections)}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-2.5 rounded-lg border-2 transition-all text-sm",
                        isSelected
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border hover:border-primary/40 text-muted-foreground"
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <div className={cn(
                          "w-4 h-4 rounded flex items-center justify-center border-2 flex-shrink-0",
                          isSelected ? "bg-primary border-primary" : "border-border"
                        )}>
                          {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        {mod.name}
                      </span>
                      {Number(mod.price) > 0 && (
                        <span className="text-primary font-medium">+₹{mod.price}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 pb-5 flex-shrink-0 border-t border-border pt-4">
          <Button className="w-full" disabled={!canConfirm} onClick={() => onConfirm(item, selectedModifiers)}>
            <Plus className="w-4 h-4 mr-2" />
            Add to Order · ₹{(Number(item.price) + modTotal).toFixed(2)}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface SplitProof {
  stripePaymentIntentId?: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;
}

function SplitBillModal({
  totalAmount, displayItems, totals, placedOrderId, restaurantName, logoUrl, restaurantAddress, restaurantPhone, orderNumber, tableLabel, orderType, customerName, orderCreatedAt, discounts,
  onClose, onComplete,
}: {
  totalAmount: number;
  displayItems: Array<{ name: string; unitPrice: number; quantity: number; modifiers: CartModifier[] }>;
  totals: Totals;
  placedOrderId: number;
  restaurantName?: string;
  logoUrl?: string;
  restaurantAddress?: string | null;
  restaurantPhone?: string | null;
  orderNumber: string;
  tableLabel: string;
  orderType: string;
  customerName?: string;
  orderCreatedAt?: string;
  discounts?: { label: string; amount: number }[];
  onClose: () => void;
  onComplete: () => void;
}) {
  const [splitCount, setSplitCount] = useState(2);
  const [methods, setMethods] = useState<string[]>(["cash", "cash"]);
  const [tenderAmounts, setTenderAmounts] = useState<string[]>(["", ""]);
  const [confirmedSplits, setConfirmedSplits] = useState<boolean[]>([false, false]);
  const [splitProofs, setSplitProofs] = useState<SplitProof[]>([{}, {}]);
  const [activeCardIdx, setActiveCardIdx] = useState<number | null>(null);
  const [splitCardReady, setSplitCardReady] = useState(false);
  const [splitStripeError, setSplitStripeError] = useState("");
  const [splitProcessing, setSplitProcessing] = useState(false);
  const splitCardMountRef = useRef<HTMLDivElement>(null);
  const splitStripeRef = useRef<{
    stripe: import("@stripe/stripe-js").Stripe | null;
    card: import("@stripe/stripe-js").StripeCardElement | null;
  }>({ stripe: null, card: null });

  const splitOrder = useSplitOrder();
  const createPaymentIntent = useCreatePaymentIntent();
  const createRazorpayOrder = useCreateRazorpayOrder();
  const { toast } = useToast();

  const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

  const perPerson = totalAmount / splitCount;

  const updateCount = (n: number) => {
    const newCount = Math.max(2, Math.min(10, n));
    setSplitCount(newCount);
    setMethods(Array.from({ length: newCount }, (_, i) => methods[i] ?? "cash"));
    setTenderAmounts(Array.from({ length: newCount }, (_, i) => tenderAmounts[i] ?? ""));
    setConfirmedSplits(Array.from({ length: newCount }, (_, i) => confirmedSplits[i] ?? false));
    setSplitProofs(Array.from({ length: newCount }, (_, i) => splitProofs[i] ?? {}));
  };

  // Mount / unmount Stripe CardElement whenever the active card split changes
  useEffect(() => {
    if (activeCardIdx === null || !STRIPE_PK) return;
    let destroyed = false;
    import("@stripe/stripe-js").then(({ loadStripe }) => {
      loadStripe(STRIPE_PK).then(stripe => {
        if (destroyed || !stripe || !splitCardMountRef.current) return;
        splitStripeRef.current.stripe = stripe;
        const elements = stripe.elements();
        const card = elements.create("card", {
          style: { base: { fontSize: "15px", color: "#1a1a1a", "::placeholder": { color: "#9ca3af" } } },
          hidePostalCode: true,
        });
        card.mount(splitCardMountRef.current!);
        splitStripeRef.current.card = card;
        card.on("change", evt => {
          setSplitStripeError(evt.error?.message ?? "");
          setSplitCardReady(evt.complete);
        });
      });
    });
    return () => {
      destroyed = true;
      splitStripeRef.current.card?.destroy();
      splitStripeRef.current = { stripe: null, card: null };
      setSplitCardReady(false);
      setSplitStripeError("");
    };
  }, [activeCardIdx, STRIPE_PK]);

  const markSplitConfirmed = (idx: number, proof: SplitProof) => {
    const updatedConfirmed = [...confirmedSplits];
    updatedConfirmed[idx] = true;
    setConfirmedSplits(updatedConfirmed);
    const updatedProofs = [...splitProofs];
    updatedProofs[idx] = proof;
    setSplitProofs(updatedProofs);
    printReceipt({
      orderNumber, tableLabel, orderType, items: displayItems, totals,
      paymentMethod: methods[idx],
      amountTendered: methods[idx] === "cash" && tenderAmounts[idx] ? Number(tenderAmounts[idx]) : undefined,
      customerName, restaurantName, logoUrl,
      restaurantAddress, restaurantPhone,
      splitIndex: idx, splitTotal: perPerson,
      createdAt: orderCreatedAt,
      discounts: discounts && discounts.length > 0 ? discounts : undefined,
    });
  };

  const processCardSplit = async (idx: number) => {
    setSplitProcessing(true);
    try {
      const intent = await createPaymentIntent.mutateAsync({ orderId: placedOrderId, amount: perPerson });
      if (intent.mode === "live" && intent.clientSecret && splitStripeRef.current.stripe && splitStripeRef.current.card) {
        const result = await splitStripeRef.current.stripe.confirmCardPayment(intent.clientSecret, {
          payment_method: { card: splitStripeRef.current.card },
        });
        if (result.error) {
          setSplitStripeError(result.error.message ?? "Payment failed");
          return;
        }
        markSplitConfirmed(idx, { stripePaymentIntentId: result.paymentIntent?.id });
      } else {
        // Demo mode — simulate processing delay
        await new Promise(r => setTimeout(r, 1200));
        markSplitConfirmed(idx, { stripePaymentIntentId: intent.intentId });
      }
      setActiveCardIdx(null);
    } finally {
      setSplitProcessing(false);
    }
  };

  const confirmSplit = async (idx: number) => {
    if (splitProcessing) return;

    if (methods[idx] === "cash") {
      const tendered = Number(tenderAmounts[idx]);
      if (!tenderAmounts[idx] || tendered < perPerson) {
        toast({ title: "Insufficient amount", description: `Enter at least ₹${perPerson.toFixed(2)} for cash payment.`, variant: "destructive" });
        return;
      }
      markSplitConfirmed(idx, {});
    } else if (methods[idx] === "card") {
      // Expand inline card form; actual payment happens when "Pay" is clicked
      if (activeCardIdx !== idx) {
        setActiveCardIdx(idx);
        setSplitCardReady(false);
        setSplitStripeError("");
      }
    } else if (methods[idx] === "upi") {
      setSplitProcessing(true);
      try {
        const rzpOrder = await createRazorpayOrder.mutateAsync({ orderId: placedOrderId, amount: perPerson });
        if (rzpOrder.mode === "live" && rzpOrder.keyId) {
          if (!(window as unknown as Record<string, unknown>).Razorpay) {
            await new Promise<void>((resolve, reject) => {
              const s = document.createElement("script");
              s.src = "https://checkout.razorpay.com/v1/checkout.js";
              s.onload = () => resolve();
              s.onerror = () => reject(new Error("Failed to load Razorpay"));
              document.body.appendChild(s);
            });
          }
          await new Promise<void>((resolve, reject) => {
            const RazorpayClass = (window as unknown as { Razorpay: new (opts: Record<string, unknown>) => { open(): void } }).Razorpay;
            const rzp = new RazorpayClass({
              key: rzpOrder.keyId,
              amount: rzpOrder.amount,
              currency: rzpOrder.currency,
              order_id: rzpOrder.id,
              handler: (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
                markSplitConfirmed(idx, {
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpayOrderId: response.razorpay_order_id,
                  razorpaySignature: response.razorpay_signature,
                });
                resolve();
              },
              modal: { ondismiss: () => reject(new Error("cancelled")) },
            });
            rzp.open();
          });
        } else {
          // Demo mode
          await new Promise(r => setTimeout(r, 1200));
          markSplitConfirmed(idx, { razorpayPaymentId: `demo_rzp_pay_split_${placedOrderId}_${idx}_${Date.now()}` });
        }
      } catch (e) {
        if ((e as Error).message !== "cancelled") {
          toast({ title: "UPI payment failed", variant: "destructive" });
        }
      } finally {
        setSplitProcessing(false);
      }
    }
  };

  const handleFinalize = async () => {
    try {
      await splitOrder.mutateAsync({
        orderId: placedOrderId,
        splits: Array.from({ length: splitCount }, (_, idx) => ({
          paymentMethod: methods[idx],
          amount: perPerson,
          amountTendered: methods[idx] === "cash" ? Number(tenderAmounts[idx]) : undefined,
          stripePaymentIntentId: splitProofs[idx]?.stripePaymentIntentId,
          razorpayPaymentId: splitProofs[idx]?.razorpayPaymentId,
          razorpayOrderId: splitProofs[idx]?.razorpayOrderId,
          razorpaySignature: splitProofs[idx]?.razorpaySignature,
        })),
      });
      toast({ title: "Split payment complete!", description: `${splitCount} payments processed.` });
      onComplete();
    } catch {
      toast({ title: "Failed to finalize split", variant: "destructive" });
    }
  };

  const allConfirmed = confirmedSplits.slice(0, splitCount).every(Boolean);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Scissors className="w-5 h-5 text-primary" /> Split Bill
          </h2>
          <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        <div className="p-5 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium">Total: ₹{totalAmount.toFixed(2)}</span>
            <span className="text-sm text-muted-foreground">Per person: ₹{perPerson.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <span className="text-sm">Split between</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="w-8 h-8 p-0" onClick={() => updateCount(splitCount - 1)}>
                <Minus className="w-3 h-3" />
              </Button>
              <span className="w-8 text-center font-bold text-lg">{splitCount}</span>
              <Button size="sm" variant="outline" className="w-8 h-8 p-0" onClick={() => updateCount(splitCount + 1)}>
                <Plus className="w-3 h-3" />
              </Button>
            </div>
            <span className="text-sm">people</span>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {Array.from({ length: splitCount }, (_, idx) => (
            <div key={idx} className={cn(
              "rounded-xl border-2 p-4 transition-all",
              confirmedSplits[idx] ? "border-green-400 bg-green-50 dark:bg-green-950/30" : "border-border"
            )}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">Person {idx + 1}</span>
                <span className="font-bold text-primary">₹{perPerson.toFixed(2)}</span>
              </div>
              {!confirmedSplits[idx] ? (
                <>
                  <div className="grid grid-cols-3 gap-1.5 mb-3">
                    {PAYMENT_METHODS.map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => {
                          const m = [...methods]; m[idx] = value; setMethods(m);
                          if (activeCardIdx === idx && value !== "card") setActiveCardIdx(null);
                        }}
                        className={cn(
                          "flex flex-col items-center gap-1 py-2 rounded-lg border-2 text-xs font-medium transition-all duration-150 active:scale-[0.98]",
                          methods[idx] === value
                            ? "border-primary bg-primary/10 text-primary shadow-sm shadow-primary/20"
                            : "border-border text-muted-foreground hover:border-primary/40 hover:bg-accent/40"
                        )}
                      >
                        <Icon className="w-4 h-4" />{label}
                      </button>
                    ))}
                  </div>

                  {methods[idx] === "cash" && (
                    <>
                      <Input
                        type="number"
                        placeholder={`₹${perPerson.toFixed(2)}`}
                        value={tenderAmounts[idx]}
                        onChange={e => { const t = [...tenderAmounts]; t[idx] = e.target.value; setTenderAmounts(t); }}
                        className="h-8 text-sm mb-2"
                      />
                      {tenderAmounts[idx] && Number(tenderAmounts[idx]) > perPerson && (
                        <div className="text-xs text-green-600 font-medium mb-2">
                          Change: ₹{(Number(tenderAmounts[idx]) - perPerson).toFixed(2)}
                        </div>
                      )}
                    </>
                  )}

                  {methods[idx] === "card" && activeCardIdx === idx && (
                    <div className="mb-3 space-y-2">
                      {STRIPE_PK ? (
                        <>
                          <div ref={splitCardMountRef} className="border border-border rounded-lg px-4 py-3 bg-background min-h-[44px]" />
                          {splitStripeError && <p className="text-xs text-red-500">{splitStripeError}</p>}
                          <Button
                            size="sm"
                            className="w-full"
                            disabled={!splitCardReady || splitProcessing}
                            onClick={() => processCardSplit(idx)}
                          >
                            {splitProcessing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Lock className="w-3.5 h-3.5 mr-1.5" />}
                            Pay ₹{perPerson.toFixed(2)}
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" className="w-full" disabled={splitProcessing} onClick={() => processCardSplit(idx)}>
                          {splitProcessing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5 mr-1.5" />}
                          Process Demo Card (₹{perPerson.toFixed(2)})
                        </Button>
                      )}
                    </div>
                  )}

                  {!(methods[idx] === "card" && activeCardIdx === idx) && (
                    <Button size="sm" className="w-full" disabled={splitProcessing} onClick={() => confirmSplit(idx)}>
                      {splitProcessing
                        ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        : <CreditCard className="w-3.5 h-3.5 mr-1.5" />}
                      {methods[idx] === "card"
                        ? "Process Card Payment"
                        : methods[idx] === "upi"
                          ? "Open UPI Checkout"
                          : "Confirm & Print Receipt"}
                    </Button>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2 text-green-600">
                  <Check className="w-4 h-4" />
                  <span className="text-sm font-medium">Paid via {methods[idx].toUpperCase()}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="px-5 pb-5 flex-shrink-0 border-t border-border pt-4">
          <Button
            className="w-full"
            disabled={!allConfirmed || splitOrder.isPending}
            onClick={handleFinalize}
          >
            {splitOrder.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
            Finalize Split Payment
          </Button>
          {!allConfirmed && (
            <p className="text-xs text-muted-foreground text-center mt-2">
              Confirm all {splitCount} payments first
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface PaymentConfirmDetails {
  amountTendered?: number;
  stripePaymentIntentId?: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;
  giftCardCode?: string;
  redeemedPaise?: number;
  tipAmount?: number;
}

function PaymentModal({
  totals,
  orderId,
  onClose,
  onConfirm,
  onTerminalConfirmed,
  isPending,
  hasCustomer,
}: {
  totals: Totals;
  orderId: number;
  onClose: () => void;
  onConfirm: (method: string, details?: PaymentConfirmDetails) => Promise<void>;
  /** Called after a terminal charge has been verified + finalized server-side.
   *  POS uses this to print and reset state WITHOUT going through
   *  /orders/:id/pay (terminal /confirm is the sole finalizer). */
  onTerminalConfirmed?: (info: { providerRef: string; receiptUrl: string | null }) => Promise<void>;
  isPending: boolean;
  /** Whether a customer is linked to the order. Required for pay_later. */
  hasCustomer: boolean;
}) {
  const [method, setMethod] = useState<"cash" | "card" | "upi" | "gift_card" | "terminal" | "pay_later">("cash");
  const [stage, setStage] = useState<PayStage>("select");
  const [amountTendered, setAmountTendered] = useState("");
  // Tip selection — drives both the displayed grand total and the value sent
  // to the server (Task #421). Presets come from the restaurant.tipPolicy.
  // tipPct === -1 means a free-form custom rupee amount.
  const [tipPct, setTipPct] = useState<number>(0);
  const [customTip, setCustomTip] = useState<string>("");
  const restaurantId = useRestaurantId();
  const { data: tipPolicy, isError: tipPolicyError } = useQuery<TipPolicy>({
    queryKey: ["tip-policy", restaurantId],
    queryFn: () => apiGet<TipPolicy>(`/restaurants/${restaurantId}/advanced-growth/tip-policy`),
    enabled: !!restaurantId,
    staleTime: 5 * 60_000,
    retry: false,
  });
  // Treat a failed policy fetch (commonly a 403 from the plan-feature gate
  // when the tenant lacks `staff_tips`) as "tips disabled" so the UI doesn't
  // show tip controls the backend will silently zero out.
  const tipsEnabled = tipPolicyError ? false : (tipPolicy?.enabled ?? true);
  const presets = tipPolicy?.presets ?? [0, 5, 10, 15, 20];
  const customAllowed = tipPolicy?.customAllowed ?? true;
  const tipAmount = tipPct === -1
    ? Math.max(0, Math.round((Number(customTip) || 0) * 100) / 100)
    : Math.round(totals.totalAmount * tipPct) / 100;
  const grandTotal = totals.totalAmount + tipAmount;
  const [upiId, setUpiId] = useState("");
  const [giftCardCode, setGiftCardCode] = useState("");
  const [giftCardError, setGiftCardError] = useState("");
  const [terminalId, setTerminalId] = useState<number | null>(null);
  const [terminalTip, setTerminalTip] = useState("");
  const [terminalStatus, setTerminalStatus] = useState("");
  const [terminalError, setTerminalError] = useState("");
  const { data: terminals = [] } = useTerminals();
  const terminalCharge = useTerminalCharge();
  const terminalRunOnReader = useTerminalRunOnReader();
  const confirmTerminalCharge = useConfirmTerminalCharge();
  const restaurantIdForGift = restaurantId;
  const [cardReady, setCardReady] = useState(false);
  const [stripeError, setStripeError] = useState("");
  const cardMountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<{ stripe: import("@stripe/stripe-js").Stripe | null; card: import("@stripe/stripe-js").StripeCardElement | null }>({ stripe: null, card: null });
  const createPaymentIntent = useCreatePaymentIntent();
  const createRazorpayOrder = useCreateRazorpayOrder();
  const { toast } = useToast();
  const { data: cashRegister } = useCurrentCashRegister();
  const isRegisterOpen = !!cashRegister?.session;
  // Auto-switch off cash if register closes
  useEffect(() => {
    if (!isRegisterOpen && method === "cash") setMethod("card");
  }, [isRegisterOpen, method]);

  const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
  const RAZORPAY_KEY = import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined;

  const change = method === "cash" && amountTendered
    ? Math.max(0, Number(amountTendered) - grandTotal)
    : 0;

  useEffect(() => {
    if (stage !== "card-form" || !STRIPE_PK) return;
    let destroyed = false;
    import("@stripe/stripe-js").then(({ loadStripe }) => {
      loadStripe(STRIPE_PK).then(stripe => {
        if (destroyed || !stripe || !cardMountRef.current) return;
        stripeRef.current.stripe = stripe;
        const elements = stripe.elements();
        const card = elements.create("card", {
          style: { base: { fontSize: "16px", color: "#1a1a1a", "::placeholder": { color: "#9ca3af" } } },
          hidePostalCode: true,
        });
        card.mount(cardMountRef.current!);
        stripeRef.current.card = card;
        card.on("change", evt => {
          setStripeError(evt.error?.message ?? "");
          setCardReady(evt.complete);
        });
      });
    });
    return () => {
      destroyed = true;
      stripeRef.current.card?.destroy();
      stripeRef.current = { stripe: null, card: null };
      setCardReady(false);
      setStripeError("");
    };
  }, [stage, STRIPE_PK]);

  const handleProceed = () => {
    if (method === "card") { setStage("card-form"); return; }
    if (method === "upi") { setStage("upi-form"); return; }
    if (method === "gift_card") { setStage("gift-card-form"); return; }
    if (method === "terminal") {
      if (terminalId == null && terminals.length > 0) setTerminalId(terminals[0].id);
      setStage("terminal-form"); return;
    }
    if (method === "pay_later") {
      // No tender capture for pay-later — go straight to confirm so the
      // cashier can review who's being billed on-account, then settle.
      setStage("processing");
      void onConfirm("pay_later", { tipAmount }).finally(() => setStage("select"));
      return;
    }
    setStage("cash-confirm");
  };

  const handleProcessPayment = async () => {
    setStage("processing");
    try {
      if (method === "card") {
        const intent = await createPaymentIntent.mutateAsync({ orderId, tipAmount });
        if (intent.mode === "live" && intent.clientSecret && stripeRef.current.stripe && stripeRef.current.card) {
          const result = await stripeRef.current.stripe.confirmCardPayment(intent.clientSecret, {
            payment_method: { card: stripeRef.current.card },
          });
          if (result.error) {
            setStripeError(result.error.message ?? "Payment failed");
            setStage("card-form");
            return;
          }
          await onConfirm("card", { stripePaymentIntentId: result.paymentIntent?.id, tipAmount });
        } else {
          await new Promise(r => setTimeout(r, 1500));
          await onConfirm("card", { stripePaymentIntentId: intent.intentId, tipAmount });
        }
      } else if (method === "upi") {
        const rzpOrder = await createRazorpayOrder.mutateAsync({ orderId, tipAmount });
        if (rzpOrder.mode === "live" && rzpOrder.keyId) {
          // Load Razorpay checkout.js script once
          if (!(window as unknown as Record<string, unknown>).Razorpay) {
            await new Promise<void>((resolve, reject) => {
              const s = document.createElement("script");
              s.src = "https://checkout.razorpay.com/v1/checkout.js";
              s.onload = () => resolve();
              s.onerror = () => reject(new Error("Failed to load Razorpay checkout"));
              document.body.appendChild(s);
            });
          }
          // Open Razorpay hosted checkout — card/UPI/wallet selection handled by Razorpay
          await new Promise<void>((resolve, reject) => {
            const rzp = new (window as unknown as { Razorpay: new (opts: Record<string, unknown>) => { open(): void } }).Razorpay({
              key: rzpOrder.keyId,
              amount: rzpOrder.amount,
              currency: rzpOrder.currency,
              order_id: rzpOrder.id,
              handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
                await onConfirm("upi", {
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpayOrderId: response.razorpay_order_id,
                  razorpaySignature: response.razorpay_signature,
                  tipAmount,
                });
                resolve();
              },
              modal: {
                ondismiss: () => {
                  setStage("upi-form");
                  reject(new Error("Payment cancelled"));
                },
              },
            });
            rzp.open();
          });
        } else {
          // Demo mode — simulate gateway latency then mark paid
          await new Promise(r => setTimeout(r, 1500));
          await onConfirm("upi", { razorpayPaymentId: `demo_rzp_pay_${orderId}_${Date.now()}`, tipAmount });
        }
      } else if (method === "gift_card") {
        if (!restaurantIdForGift) throw new Error("No restaurant context");
        try {
          const result = await apiAction<{ redeemedPaise: number; remainingBalancePaise: number; code: string }>(
            `/restaurants/${restaurantIdForGift}/gift-cards/redeem-by-code`,
            "POST",
            {
              code: giftCardCode.trim(),
              amountPaise: Math.round(grandTotal * 100),
              referenceType: "order",
              referenceId: orderId,
              idempotencyKey: `pos-${orderId}-${Date.now()}`,
              notes: `POS payment for order #${orderId}`,
            },
          );
          await onConfirm("gift_card", { giftCardCode: result.code, redeemedPaise: result.redeemedPaise, tipAmount });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Gift card redemption failed";
          setGiftCardError(msg);
          setStage("gift-card-form");
          return;
        }
      } else if (method === "terminal") {
        if (!terminalId) throw new Error("No terminal selected");
        const tipMinor = Math.max(0, Math.round((Number(terminalTip) || 0) * 100));
        const amountMinor = Math.round(totals.totalAmount * 100);
        try {
          // 1. Create a card_present PaymentIntent server-side.
          setTerminalStatus("Creating payment…");
          const charge = await terminalCharge.mutateAsync({ terminalId, orderId, amountMinor, tipMinor });
          if (!charge.providerRef) throw new Error("Terminal did not return a payment reference");
          // 2. Drive the physical reader. For Stripe Internet readers (e.g.
          //    WisePOS E) the server uses Stripe Terminal's reader API to
          //    push the PI to the device and polls until the customer taps;
          //    this is the real "tap-to-pay" handshake (not a stub).
          setTerminalStatus("Tap or insert card on the reader…");
          await terminalRunOnReader.mutateAsync({ terminalId, providerRef: charge.providerRef });
          // 3. Finalize. /confirm is the SOLE finalizer for terminal
          //    payments — it re-verifies the PI status with Stripe before
          //    writing. We never fall through to /orders/:id/pay.
          setTerminalStatus("Confirming payment…");
          const confirmed = await confirmTerminalCharge.mutateAsync({
            terminalId, orderId,
            providerRef: charge.providerRef,
            amountMinor, tipMinor,
            receiptUrl: charge.receiptUrl,
          });
          await onTerminalConfirmed?.({
            providerRef: charge.providerRef,
            receiptUrl: confirmed.receiptUrl ?? charge.receiptUrl,
          });
        } catch (err) {
          setTerminalError(err instanceof Error ? err.message : "Terminal charge failed");
          setTerminalStatus("");
          setStage("terminal-form");
          return;
        }
      } else {
        await onConfirm("cash", { amountTendered: Number(amountTendered) || undefined, tipAmount });
      }
    } catch {
      toast({ title: "Payment failed", description: "Please try again.", variant: "destructive" });
      setStage(method === "cash" ? "cash-confirm" : method === "card" ? "card-form" : method === "gift_card" ? "gift-card-form" : method === "terminal" ? "terminal-form" : "upi-form");
    }
  };

  const TotalsSummary = () => (
    <div className="bg-muted/50 rounded-xl p-4 border border-border space-y-1.5">
      <div className="flex justify-between text-sm text-muted-foreground">
        <span>Subtotal</span><span>₹{totals.subtotal.toFixed(2)}</span>
      </div>
      <div className="flex justify-between text-sm text-muted-foreground">
        <span>Tax</span><span>₹{totals.taxAmount.toFixed(2)}</span>
      </div>
      {totals.serviceCharge > 0 && (
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Service Charge</span><span>₹{totals.serviceCharge.toFixed(2)}</span>
        </div>
      )}
      {totals.discountAmount > 0 && (
        <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
          <span>Discount</span><span>-₹{totals.discountAmount.toFixed(2)}</span>
        </div>
      )}
      {tipAmount > 0 && (
        <div className="flex justify-between text-sm text-amber-600 dark:text-amber-400">
          <span>Tip{tipPct > 0 ? ` (${tipPct}%)` : ""}</span><span>+₹{tipAmount.toFixed(2)}</span>
        </div>
      )}
      <div className="flex justify-between font-bold text-xl border-t border-border pt-2">
        <span>Total</span>
        <span className="text-primary">₹{grandTotal.toFixed(2)}</span>
      </div>
    </div>
  );

  // Tip selector shown on the method-select stage. Hidden entirely when the
  // restaurant has disabled tips in their policy.
  const TipSelector = () => {
    if (!tipsEnabled) return null;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Add a tip</span>
          {tipAmount > 0 && (
            <button className="text-xs text-muted-foreground hover:underline"
              onClick={() => { setTipPct(0); setCustomTip(""); }}>Clear</button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map(p => (
            <button key={p} onClick={() => { setTipPct(p); setCustomTip(""); }}
              className={`px-3 py-1.5 rounded-lg text-sm border transition ${tipPct === p && tipAmount > 0 ? "bg-primary text-primary-foreground border-primary" : tipPct === 0 && p === 0 ? "bg-muted border-border" : "border-border hover:bg-muted"}`}>
              {p === 0 ? "No tip" : `${p}%`}
            </button>
          ))}
          {customAllowed && (
            <input type="number" min="0" step="0.01" placeholder="Custom ₹"
              value={tipPct === -1 ? customTip : ""}
              onChange={e => { setTipPct(-1); setCustomTip(e.target.value); }}
              className="px-3 py-1.5 rounded-lg text-sm border border-border bg-background w-28" />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" /> Process Payment
          </h2>
          {stage !== "processing" && (
            <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        <div className="p-6 space-y-5">
          {/* Method select stage */}
          {stage === "select" && (
            <>
              <TotalsSummary />
              <TipSelector />
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  {PAYMENT_METHODS.map(({ value, label, icon: Icon }) => {
                    const disabled = (value === "cash" && !isRegisterOpen)
                      || (value === "pay_later" && !hasCustomer);
                    const disabledHint = value === "cash" && !isRegisterOpen
                      ? "Open the cash register before accepting cash"
                      : value === "pay_later" && !hasCustomer
                        ? "Link a customer (by phone) before billing on account"
                        : "";
                    return (
                      <button
                        key={value}
                        disabled={disabled}
                        title={disabledHint}
                        onClick={() => setMethod(value as "cash" | "card" | "upi" | "gift_card" | "terminal" | "pay_later")}
                        className={cn(
                          "flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 text-sm font-medium transition-all duration-150 active:scale-[0.98]",
                          disabled
                            ? "border-border text-muted-foreground/40 cursor-not-allowed bg-muted/30"
                            : method === value
                              ? "border-primary bg-gradient-to-br from-primary/10 to-primary/5 text-primary shadow-sm shadow-primary/20"
                              : "border-border text-muted-foreground hover:border-primary/50 hover:bg-accent/40"
                        )}
                      >
                        <Icon className="w-5 h-5" />{label}
                      </button>
                    );
                  })}
                </div>
                {!isRegisterOpen && (
                  <div className="mt-2 flex items-start gap-2 p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs">
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="font-medium text-amber-800 dark:text-amber-200">Cash register is closed</div>
                      <div className="text-amber-700 dark:text-amber-300/80">Open the register before accepting cash payments.</div>
                    </div>
                    <a href="/cash-register" className="text-xs font-semibold text-primary hover:underline whitespace-nowrap">Open Register →</a>
                  </div>
                )}
              </div>
              <Button
                className="w-full h-11"
                onClick={handleProceed}
                disabled={(method === "cash" && !isRegisterOpen) || (method === "pay_later" && !hasCustomer)}
              >
                Continue with {
                  method === "cash" ? "Cash"
                  : method === "card" ? "Card"
                  : method === "gift_card" ? "Gift Card"
                  : method === "terminal" ? "Terminal"
                  : method === "pay_later" ? "Pay Later"
                  : "UPI"
                }
              </Button>
            </>
          )}

          {/* Cash confirm stage */}
          {stage === "cash-confirm" && (
            <>
              <TotalsSummary />
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Amount Tendered</label>
                <Input
                  type="number"
                  placeholder={`₹${totals.totalAmount.toFixed(2)}`}
                  value={amountTendered}
                  onChange={e => setAmountTendered(e.target.value)}
                  className="text-base font-mono"
                  autoFocus
                />
                {change > 0 && (
                  <div className="bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded-lg px-4 py-2 flex justify-between">
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
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setAmountTendered(totals.totalAmount.toFixed(2))}>
                    Exact
                  </Button>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStage("select")}>Back</Button>
                <Button className="flex-1 h-11" disabled={isPending} onClick={handleProcessPayment}>
                  Confirm Cash Payment
                </Button>
              </div>
            </>
          )}

          {/* Card form stage — Stripe-hosted card element; no raw card data ever collected */}
          {stage === "card-form" && (
            <>
              <TotalsSummary />
              <div className="space-y-3">
                {STRIPE_PK ? (
                  <>
                    <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-blue-700 dark:text-blue-400">
                      <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                      Card details are entered securely in Stripe's hosted form — never touch our servers
                    </div>
                    <div
                      ref={cardMountRef}
                      className="border border-border rounded-lg px-4 py-3 bg-background min-h-[44px]"
                    />
                    {stripeError && <p className="text-xs text-red-500">{stripeError}</p>}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 px-4 py-5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-300">
                    <Lock className="w-6 h-6" />
                    <p className="font-semibold">Stripe not configured</p>
                    <p className="text-xs text-center">
                      Set <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">STRIPE_SECRET_KEY</code> and{" "}
                      <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">VITE_STRIPE_PUBLISHABLE_KEY</code> to enable real card payments.
                      In demo mode no card data is collected.
                    </p>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStage("select")}>Back</Button>
                <Button
                  className="flex-1 h-11"
                  disabled={(!!STRIPE_PK && !cardReady) || isPending || createPaymentIntent.isPending}
                  onClick={handleProcessPayment}
                >
                  <Lock className="w-3.5 h-3.5 mr-2" />
                  {STRIPE_PK ? `Pay ₹${grandTotal.toFixed(2)}` : "Process Demo Payment"}
                </Button>
              </div>
            </>
          )}

          {/* UPI form stage — Razorpay checkout when configured; demo mode otherwise */}
          {stage === "upi-form" && (
            <>
              <TotalsSummary />
              <div className="space-y-3">
                {RAZORPAY_KEY ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg text-xs text-purple-700 dark:text-purple-400">
                    <Smartphone className="w-3.5 h-3.5 flex-shrink-0" />
                    Razorpay UPI checkout will open in a secure popup
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 px-4 py-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-300">
                    <Smartphone className="w-6 h-6" />
                    <p className="font-semibold">Razorpay not configured</p>
                    <p className="text-xs text-center">
                      Set <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">VITE_RAZORPAY_KEY_ID</code> to enable real UPI payments.
                      In demo mode the payment is simulated.
                    </p>
                  </div>
                )}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Customer UPI ID (for receipt reference)</label>
                  <Input
                    placeholder="customer@paytm / 9999999999@ybl"
                    value={upiId}
                    onChange={e => setUpiId(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="text-center py-1">
                  <p className="text-xs text-muted-foreground">
                    Amount: <span className="font-bold text-foreground text-base">₹{totals.totalAmount.toFixed(2)}</span>
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStage("select")}>Back</Button>
                <Button
                  className="flex-1 h-11"
                  disabled={isPending}
                  onClick={handleProcessPayment}
                >
                  <Smartphone className="w-3.5 h-3.5 mr-2" />
                  {RAZORPAY_KEY ? "Open Razorpay" : "Process Demo UPI"}
                </Button>
              </div>
            </>
          )}

          {/* Gift card form stage */}
          {stage === "gift-card-form" && (
            <>
              <TotalsSummary />
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-3 py-2 bg-pink-50 dark:bg-pink-950/30 border border-pink-200 dark:border-pink-800 rounded-lg text-xs text-pink-700 dark:text-pink-400">
                  <Gift className="w-3.5 h-3.5 flex-shrink-0" />
                  Enter the gift card code to redeem ₹{totals.totalAmount.toFixed(2)}. Insufficient balance will be rejected.
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Gift Card Code</label>
                  <Input
                    placeholder="e.g. GC-XXXX-XXXX-XXXX"
                    value={giftCardCode}
                    onChange={e => { setGiftCardCode(e.target.value); setGiftCardError(""); }}
                    autoFocus
                    className="font-mono uppercase"
                  />
                  {giftCardError && <p className="text-xs text-red-500 mt-1">{giftCardError}</p>}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStage("select")}>Back</Button>
                <Button
                  className="flex-1 h-11"
                  disabled={isPending || !giftCardCode.trim()}
                  onClick={handleProcessPayment}
                >
                  <Gift className="w-3.5 h-3.5 mr-2" />
                  Redeem ₹{totals.totalAmount.toFixed(2)}
                </Button>
              </div>
            </>
          )}

          {/* Terminal-form stage — pick a paired terminal, optional tip, then charge */}
          {stage === "terminal-form" && (
            <>
              <TotalsSummary />
              {terminals.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-4 py-6 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-300 text-center">
                  <CreditCard className="w-7 h-7" />
                  <p className="font-semibold">Configuration required</p>
                  <p className="text-xs">No card terminals are paired yet. Pair one in Settings → Card Terminals to accept tap-to-pay.</p>
                  <Link href="/settings/terminals">
                    <Button size="sm" className="mt-1 gap-1.5">
                      <CreditCard className="w-3.5 h-3.5" />
                      Open Terminal Settings
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Terminal</label>
                    <div className="grid grid-cols-1 gap-2">
                      {terminals.map(t => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => { setTerminalId(t.id); setTerminalError(""); }}
                          className={cn(
                            "flex items-center justify-between px-3 py-2 rounded-lg border-2 text-sm transition-all",
                            terminalId === t.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/40",
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <CreditCard className="w-4 h-4 text-primary" />
                            <span className="font-medium">{t.name}</span>
                            <span className="text-xs text-muted-foreground capitalize">{t.terminal?.provider}</span>
                          </span>
                          <span className={cn(
                            "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded",
                            t.status === "online" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600",
                          )}>{t.status}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Tip on terminal (optional)</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={terminalTip}
                      onChange={e => setTerminalTip(e.target.value)}
                    />
                  </div>
                  {terminalError && (
                    <div className="flex items-start gap-2 px-3 py-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-400">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span>{terminalError}</span>
                    </div>
                  )}
                  <div className="text-center py-1">
                    <p className="text-xs text-muted-foreground">
                      Charging: <span className="font-bold text-foreground text-base">
                        ₹{(totals.totalAmount + (Number(terminalTip) || 0)).toFixed(2)}
                      </span>
                    </p>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStage("select")}>Back</Button>
                <Button
                  className="flex-1 h-11"
                  disabled={isPending || terminals.length === 0 || !terminalId || terminalCharge.isPending || terminalRunOnReader.isPending}
                  onClick={handleProcessPayment}
                >
                  <CreditCard className="w-3.5 h-3.5 mr-2" />
                  Charge Terminal
                </Button>
              </div>
            </>
          )}

          {/* Processing stage */}
          {stage === "processing" && (
            <div className="py-8 flex flex-col items-center gap-4">
              <Loader2 className="w-12 h-12 animate-spin text-primary" />
              <p className="text-base font-medium text-foreground">Processing payment…</p>
              <p className="text-sm text-muted-foreground text-center">
                {method === "terminal"
                  ? (terminalStatus || "Communicating with reader…")
                  : method === "card" ? "Contacting payment gateway"
                  : method === "upi" ? "Awaiting UPI confirmation"
                  : method === "gift_card" ? "Redeeming gift card"
                  : "Confirming payment"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PosPage() {
  const { selectedBranchId } = useBranchContext();
  const { data: restaurant } = useRestaurantInfo();
  const taxRate = Number(restaurant?.taxRate ?? 5) / 100;
  const serviceRate = Number(restaurant?.serviceCharge ?? 0) / 100;

  const { data: tables = [] } = useFloorTables();
  const { data: menus = [] } = useMenus();
  const firstMenuId = menus[0]?.id;
  const { data: categories = [] } = useMenuCategories(firstMenuId);
  const categoryNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of categories as MenuCategory[]) m.set(c.id, (c.name ?? "").toLowerCase());
    return m;
  }, [categories]);
  const [selectedCat, setSelectedCat] = useState<number | undefined>();
  const { data: menuItems = [] } = useMenuItems({ categoryId: selectedCat });
  const { data: activeOrdersData } = useOrders();
  const { data: popularItems = [] } = usePopularItems(6);
  const [recentItemIds, setRecentItemIds] = useState<number[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem("tt_pos_recent_items");
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(arr) ? arr.filter((n): n is number => typeof n === "number").slice(0, 8) : [];
    } catch { return []; }
  });
  const pushRecentItem = useCallback((id: number) => {
    setRecentItemIds(prev => {
      const next = [id, ...prev.filter(x => x !== id)].slice(0, 8);
      try { window.localStorage.setItem("tt_pos_recent_items", JSON.stringify(next)); } catch { /* storage full */ }
      return next;
    });
  }, []);
  const { user } = useAuth();
  const userRole = (user?.role ?? "").toLowerCase();
  const canManageMenu = !!user?.isSuperAdmin || ["owner", "admin", "manager"].includes(userRole);
  const activeOrders: Order[] = (activeOrdersData?.data ?? []).filter(
    o => o.status !== "completed" && o.status !== "cancelled"
  );

  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [orderType, setOrderType] = useState<OrderTypeValue>("dine_in");
  // The server-bound order type — derived from `orderType` but never the
  // inbox-only "qr_order" / "reservation_order" tabs. When the cashier is on
  // one of those inbox tabs, server-side orders still default to "dine_in"
  // (overridden once they seat a reservation or accept a QR cart).
  const serverOrderType: ServerOrderType = (orderType === "qr_order" || orderType === "reservation_order")
    ? "dine_in"
    : orderType;
  const [cart, setCart] = useState<CartItem[]>([]);
  const [noteEditingKey, setNoteEditingKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [linkedCustomerId, setLinkedCustomerId] = useState<number | null>(null);
  const [loyaltyRedeem, setLoyaltyRedeem] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [showPayModal, setShowPayModal] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [showTableGrid, setShowTableGrid] = useState(true);
  const [placedOrder, setPlacedOrder] = useState<OrderDetail | null>(null);
  const [modPickerItem, setModPickerItem] = useState<MenuItem | null>(null);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const restaurantIdForVoice = useRestaurantId();
  const { data: allMenuItems = [] } = useMenuItems({});

  // Veg / Non-veg filter chips above the menu grid.
  const [vegFilter, setVegFilter] = useState<"all" | "veg" | "non_veg">("all");

  // POS shift gating — every cashier must have an open cash register session
  // before they can use the terminal. The "register-closed" gate sits above
  // the entire POS surface (read-only browsing still allowed via "Continue").
  const { data: cashRegister } = useCurrentCashRegister();
  const isRegisterOpenForPos = !!cashRegister?.session;
  const [shiftBypassed, setShiftBypassed] = useState(false);

  // Inbox data for the new QR Orders / Reservations tabs.
  const { data: pendingCarts = [] } = usePendingCartSessions();
  const todayDate = new Date().toISOString().slice(0, 10);
  const { data: todayReservations = [] } = useReservations({ date: todayDate });

  // Barcode/keyboard-wedge scanner — listen for "pos:scan" events fired by
  // PosShell, match against menu items (by sku/name) or tables (by number).
  useEffect(() => {
    const handler = (ev: Event) => {
      const code = (ev as CustomEvent<string>).detail?.trim();
      if (!code) return;
      const item = (allMenuItems as MenuItem[]).find(i =>
        (i as MenuItem & { sku?: string | null }).sku?.toLowerCase() === code.toLowerCase()
      );
      if (item) {
        if (!item.isAvailable) {
          toast({ title: "Item is 86'd", description: item.name, variant: "destructive" });
          return;
        }
        handleMenuItemClick(item);
        toast({ title: "Scanned", description: `Added ${item.name}` });
        return;
      }
      const table = (tables as FloorTable[]).find(t => String(t.tableNumber) === code);
      if (table) {
        handleSelectTable(table);
        toast({ title: "Scanned", description: `Selected Table ${table.tableNumber}` });
        return;
      }
      toast({ title: "Scan not recognised", description: code, variant: "destructive" });
    };
    window.addEventListener("pos:scan", handler);
    return () => window.removeEventListener("pos:scan", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMenuItems, tables]);

  // Hide categories that have no available items — keeps the POS category
  // bar in sync with the diner-facing menu (which also hides empty cats).
  const nonEmptyCategoryIds = useMemo(() => {
    const ids = new Set<number>();
    for (const it of allMenuItems as MenuItem[]) {
      if (it.isAvailable && it.categoryId != null) ids.add(it.categoryId);
    }
    return ids;
  }, [allMenuItems]);
  const visibleCategories = (categories as MenuCategory[]).filter(c => nonEmptyCategoryIds.has(c.id));

  // If the currently-selected category becomes empty/hidden, fall back to "All".
  useEffect(() => {
    if (selectedCat != null && !nonEmptyCategoryIds.has(selectedCat)) {
      setSelectedCat(undefined);
    }
  }, [selectedCat, nonEmptyCategoryIds]);

  const createOrder = useCreateOrder();
  const payOrder = usePayOrder();
  const voidOrder = useVoidOrder();
  const addOrderItem = useAddOrderItem();
  const removeOrderItem = useRemoveOrderItem();
  const applyDiscountLine = useApplyDiscountLine();
  const removeDiscountLine = useRemoveDiscountLine();
  const { data: discountsCfg } = useDiscountsConfig();
  const applyLoyalty = useApplyLoyalty();
  const applyCoupon = useApplyCoupon();
  const { toast } = useToast();

  const [showDiscountDrawer, setShowDiscountDrawer] = useState(false);
  const [dType, setDType] = useState<"percentage" | "flat" | "item">("percentage");
  const [dValue, setDValue] = useState("");
  const [dReason, setDReason] = useState("");
  const [dOrderItemId, setDOrderItemId] = useState<number | "">("");
  const [dManagerPin, setDManagerPin] = useState("");
  const [dManagerOtp, setDManagerOtp] = useState("");
  const [dPinRequired, setDPinRequired] = useState(false);
  const [dApprovalMethods, setDApprovalMethods] = useState<string[]>([]);
  const [dOtpRecipient, setDOtpRecipient] = useState<string | null>(null);
  const requestOtp = useRequestManagerDiscountOtp();

  // Phone-based customer lookup for loyalty linking
  const [phoneQuery, setPhoneQuery] = useState("");
  const { data: foundCustomer } = useCustomerByPhone(phoneQuery);
  const { data: loyaltyAccount } = useCustomerLoyalty(linkedCustomerId);

  const { data: modifierGroups = [], isLoading: modGroupsLoading } = useItemModifierGroups(modPickerItem?.id);

  // Table resume: load existing active order when selecting an occupied table
  const tableActiveOrder = selectedTableId && !placedOrder
    ? activeOrders.find(o => o.tableId === selectedTableId)
    : null;
  const { data: tableOrderDetail } = useOrderDetail(tableActiveOrder?.id);

  useEffect(() => {
    if (tableOrderDetail && !placedOrder) {
      const resumedCart: CartItem[] = tableOrderDetail.items.map(oi => ({
        lineKey: String(oi.id),
        menuItemId: oi.menuItemId,
        name: oi.menuItemName,
        basePrice: Number(oi.unitPrice),
        modifiers: [],
        unitPrice: Number(oi.unitPrice),
        quantity: oi.quantity,
      }));
      setCart(resumedCart);
      setPlacedOrder(tableOrderDetail);
    }
  }, [tableOrderDetail?.id]);

  // Live order detail (refreshed after add/remove item, discount changes)
  const { data: liveDetail } = useOrderDetail(placedOrder?.id);

  const liveDiscounts = liveDetail?.discounts ?? [];
  const discountReceiptLines = liveDiscounts.map(d => ({
    label: d.type === "coupon" && d.couponCode ? `Coupon ${d.couponCode}` : (d.reason || "Discount"),
    amount: Number(d.amount),
  }));

  // Items shown in the ticket: server state after placement, local cart before
  const liveItems: OrderItem[] = useMemo(() => {
    if (!placedOrder) return [];
    return liveDetail?.items ?? placedOrder.items;
  }, [placedOrder, liveDetail]);

  // Totals: server-accurate after placement, local estimate before.
  const localSubtotal = cart.reduce((s, c) => s + c.unitPrice * c.quantity, 0);
  const localTaxAmount = localSubtotal * taxRate;
  const localServiceCharge = localSubtotal * serviceRate;
  const localTotal = Math.max(0, localSubtotal + localTaxAmount + localServiceCharge);

  const serverTotals: Totals | null = liveDetail ? {
    subtotal: Number(liveDetail.subtotal),
    taxAmount: Number(liveDetail.taxAmount),
    serviceCharge: Number(liveDetail.serviceCharge),
    discountAmount: Number(liveDetail.discountAmount),
    totalAmount: Number(liveDetail.totalAmount),
  } : placedOrder ? {
    subtotal: Number(placedOrder.subtotal),
    taxAmount: Number(placedOrder.taxAmount),
    serviceCharge: Number(placedOrder.serviceCharge),
    discountAmount: Number(placedOrder.discountAmount),
    totalAmount: Number(placedOrder.totalAmount),
  } : null;

  const displayTotals: Totals = serverTotals ?? {
    subtotal: localSubtotal,
    taxAmount: localTaxAmount,
    serviceCharge: localServiceCharge,
    discountAmount: 0,
    totalAmount: localTotal,
  };

  // Modifier picker resolves differently for pre vs post placement
  const handleModifierConfirm = useCallback((item: MenuItem, modifiers: CartModifier[]) => {
    if (placedOrder) {
      addOrderItem.mutate({
        orderId: placedOrder.id,
        menuItemId: item.id,
        quantity: 1,
        modifiers: modifiers.length > 0
          ? modifiers.map(m => ({ name: m.name, price: m.price.toFixed(2) }))
          : undefined,
      }, {
        onSuccess: () => {
          setModPickerItem(null);
          toast({ title: `${item.name} added to order` });
          playPosSound("add");
        },
        onError: () => playPosSound("error"),
      });
    } else {
      const lineKey = makeLineKey(item.id, modifiers);
      const unitPrice = Number(item.price) + modifiers.reduce((s, m) => s + m.price, 0);
      setCart(prev => {
        const existing = prev.find(c => c.lineKey === lineKey);
        if (existing) {
          return prev.map(c => c.lineKey === lineKey ? { ...c, quantity: c.quantity + 1 } : c);
        }
        return [...prev, {
          lineKey,
          menuItemId: item.id,
          name: item.name,
          basePrice: Number(item.price),
          modifiers,
          unitPrice,
          quantity: 1,
        }];
      });
      setModPickerItem(null);
      playPosSound("add");
    }
  }, [placedOrder, addOrderItem, toast]);

  const handleMenuItemClick = useCallback((item: MenuItem) => {
    setModPickerItem(item);
    pushRecentItem(item.id);
  }, [pushRecentItem]);

  const updateQty = useCallback((lineKey: string, qty: number) => {
    if (qty <= 0) {
      setCart(prev => prev.filter(c => c.lineKey !== lineKey));
      playPosSound("remove");
    } else {
      setCart(prev => prev.map(c => c.lineKey === lineKey ? { ...c, quantity: qty } : c));
      playPosSound("add");
    }
  }, []);

  const removeFromCart = useCallback((lineKey: string) => {
    setCart(prev => prev.filter(c => c.lineKey !== lineKey));
    playPosSound("remove");
  }, []);

  const removeOrderItemById = useCallback((itemId: number) => {
    if (!placedOrder) return;
    removeOrderItem.mutate({ orderId: placedOrder.id, itemId }, {
      onSuccess: () => { toast({ title: "Item removed" }); playPosSound("remove"); },
      onError: () => playPosSound("error"),
    });
  }, [placedOrder, removeOrderItem, toast]);

  const createCustomerMut = useCreateCustomer();
  const handleLinkCustomer = async () => {
    // Existing customer in this restaurant — link directly.
    if (foundCustomer) {
      setLinkedCustomerId(foundCustomer.id);
      setCustomerName(foundCustomer.name);
      toast({ title: `Linked: ${foundCustomer.name}`, description: `Loyalty balance: ${foundCustomer.loyaltyPoints} pts` });
      return;
    }
    // New customer flow — create on the fly so cashiers don't have to
    // leave POS, then link the new id. Requires at least a phone; uses
    // the typed name if any, otherwise "Walk-in (<last 4>)" as a stable
    // placeholder the cashier can rename later from the Customers page.
    const phone = (customerPhone || "").trim();
    if (!phone || phone.replace(/\D/g, "").length < 7) {
      toast({ title: "Phone required", description: "Enter a customer phone number to create or link a profile.", variant: "destructive" });
      playPosSound("error");
      return;
    }
    const nameForNew = (customerName || "").trim() || `Walk-in ${phone.slice(-4)}`;
    try {
      const created = await createCustomerMut.mutateAsync({ name: nameForNew, phone, email: "", address: "", notes: "" }) as { id: number; name: string; loyaltyPoints?: number };
      setLinkedCustomerId(created.id);
      setCustomerName(created.name);
      toast({ title: `Created & linked: ${created.name}`, description: `Loyalty balance: ${created.loyaltyPoints ?? 0} pts` });
      playPosSound("success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Try again.";
      toast({ title: "Could not create customer", description: msg, variant: "destructive" });
      playPosSound("error");
    }
  };

  const handleApplyLoyalty = () => {
    if (!placedOrder) { toast({ title: "Place order first", variant: "destructive" }); return; }
    const pts = Math.floor(Number(loyaltyRedeem) || 0);
    if (pts <= 0) return;
    applyLoyalty.mutate({ orderId: placedOrder.id, points: pts }, {
      onSuccess: (data: { loyaltyApplied?: { pointsRedeemed?: number; discountValue?: number } }) => {
        const applied = Number(data?.loyaltyApplied?.pointsRedeemed ?? pts);
        const discount = Number(data?.loyaltyApplied?.discountValue ?? 0);
        const capped = applied < pts;
        toast({
          title: `${applied} pts redeemed`,
          description: capped
            ? `Capped to bill — ₹${discount.toFixed(2)} off applied`
            : `₹${discount.toFixed(2)} off applied`,
        });
      },
      onError: (err: Error) => toast({ title: "Failed to apply loyalty", description: err.message, variant: "destructive" }),
    });
  };

  const handleApplyCoupon = () => {
    if (!placedOrder) { toast({ title: "Place order first", variant: "destructive" }); return; }
    if (!couponInput.trim()) return;
    applyCoupon.mutate({ orderId: placedOrder.id, code: couponInput.trim().toUpperCase() }, {
      onSuccess: (data: { couponApplied?: { code: string; discountAmount: string } }) => {
        toast({ title: `Coupon applied`, description: `${data?.couponApplied?.code} — ₹${data?.couponApplied?.discountAmount} off` });
        setCouponInput("");
      },
      onError: (err: Error) => toast({ title: "Invalid coupon", description: err.message, variant: "destructive" }),
    });
  };

  const selectedTable = (tables as FloorTable[]).find(t => t.id === selectedTableId);

  const handleSelectTable = (table: FloorTable) => {
    if (placedOrder) {
      toast({ title: "Order in progress", description: "Complete or clear the current order first." });
      return;
    }
    const newId = table.id === selectedTableId ? null : table.id;
    setSelectedTableId(newId);
    if (table.status !== "free") setOrderType("dine_in");
    if (newId === null) { setCart([]); setPlacedOrder(null); }
  };

  const handlePlaceOrder = async (): Promise<OrderDetail | null> => {
    if (cart.length === 0) { toast({ title: "Add items first", variant: "destructive" }); return null; }
    try {
      const result = await createOrder.mutateAsync({
        tableId: selectedTableId ?? undefined,
        orderType: serverOrderType,
        customerName: customerName || undefined,
        customerId: linkedCustomerId ?? undefined,
        items: cart.map(c => ({
          menuItemId: c.menuItemId,
          quantity: c.quantity,
          notes: c.notes?.trim() || undefined,
          modifiers: c.modifiers.length > 0
            ? c.modifiers.map(m => ({ name: m.name, price: m.price.toFixed(2) }))
            : undefined,
        })),
      });
      // wrapQueueable returns a sentinel `{ __offlineQueued: true }` when
      // the write was deferred to the local offline queue — treat it as
      // success-with-queued so floor staff aren't blocked offline.
      if (isOfflineQueuedResult(result)) {
        toast({ title: "Order saved offline", description: "It will sync to the kitchen the moment you're back online." });
        setCart([]);
        return null;
      }
      const order = result as OrderDetail;
      setPlacedOrder(order);
      toast({ title: `Order ${formatOrderNumber(order.orderNumber)} placed!`, description: "Kitchen has been notified." });
      return order;
    } catch {
      toast({ title: "Failed to place order", variant: "destructive" });
      return null;
    }
  };

  const handleVoiceOrderConfirm = async (payload: VoiceOrderConfirmation): Promise<void> => {
    const result = await createOrder.mutateAsync({
      tableId: payload.tableId ?? selectedTableId ?? undefined,
      orderType: payload.tableId != null ? "dine_in" : serverOrderType,
      customerName: customerName || undefined,
      customerId: linkedCustomerId ?? undefined,
      notes: payload.notes,
      items: payload.items,
    });
    if (payload.tableId != null) setSelectedTableId(payload.tableId);
    // When offline the API layer hands back a sentinel — the voice order
    // is safely queued, but we can't echo its server-issued line ids /
    // order number. Show a clear "saved offline" toast instead of trying
    // to populate cart with non-existent server data.
    if (isOfflineQueuedResult(result)) {
      toast({ title: "Voice order saved offline", description: "It will sync to the kitchen the moment you're back online." });
      return;
    }
    const order = result as OrderDetail;
    setPlacedOrder(order);
    setCart(order.items.map(oi => ({
      lineKey: String(oi.id),
      menuItemId: oi.menuItemId,
      name: oi.menuItemName,
      basePrice: Number(oi.unitPrice),
      modifiers: [],
      unitPrice: Number(oi.unitPrice),
      quantity: oi.quantity,
    })));
    toast({ title: `Order ${formatOrderNumber(order.orderNumber)} placed via voice`, description: "Kitchen has been notified." });
  };

  const handlePayNow = async () => {
    if (cart.length === 0 && liveItems.length === 0) {
      toast({ title: "Cart is empty", variant: "destructive" });
      return;
    }
    if (!placedOrder) {
      const order = await handlePlaceOrder();
      if (!order) return;
    }
    setShowPayModal(true);
  };

  const handleConfirmPayment = async (method: string, details?: PaymentConfirmDetails) => {
    const orderId = placedOrder?.id;
    if (!orderId) return;
    const result = await payOrder.mutateAsync({
      id: orderId,
      paymentMethod: method,
      stripePaymentIntentId: details?.stripePaymentIntentId,
      razorpayPaymentId: details?.razorpayPaymentId,
      razorpayOrderId: details?.razorpayOrderId,
      razorpaySignature: details?.razorpaySignature,
      tipAmount: details?.tipAmount,
    });
    if (isOfflineQueuedResult(result)) {
      toast({ title: "Payment saved offline", description: `${formatOrderNumber(placedOrder?.orderNumber)} will be settled when you reconnect.` });
      playPosSound("success");
    } else {
      toast({ title: "Payment confirmed!", description: `${formatOrderNumber(placedOrder?.orderNumber)} marked as paid.` });
      playPosSound("success");
    }
    setShowPayModal(false);
    const receiptItems = placedOrder
      ? liveItems.map(oi => ({ name: oi.menuItemName, unitPrice: Number(oi.unitPrice), quantity: oi.quantity, modifiers: [] }))
      : cart.map(c => ({ name: c.name, unitPrice: c.unitPrice, quantity: c.quantity, modifiers: c.modifiers }));
    printReceipt({
      orderNumber: formatOrderNumber(placedOrder?.orderDisplayNumber ?? placedOrder?.orderNumber ?? ""),
      tableLabel: selectedTable ? `Table ${selectedTable.tableNumber}` : "",
      orderType, items: receiptItems, totals: displayTotals, paymentMethod: method,
      amountTendered: details?.amountTendered, customerName, restaurantName: restaurant?.name, logoUrl: restaurant?.logoUrl ?? undefined,
      restaurantAddress: [restaurant?.address, restaurant?.city].filter(Boolean).join(", ") || undefined,
      restaurantPhone: restaurant?.phone ?? undefined,
      createdAt: placedOrder?.createdAt,
      discounts: discountReceiptLines.length > 0 ? discountReceiptLines : undefined,
    });
    handleNewOrder();
  };

  // Terminal payments are finalized server-side by /terminals/:id/confirm
  // (it verifies the PaymentIntent with Stripe before writing). POS just
  // handles the UI side effects here — no second call to /orders/:id/pay.
  const handleTerminalConfirmed = async (info: { providerRef: string; receiptUrl: string | null }) => {
    setShowPayModal(false);
    toast({
      title: "Terminal payment confirmed",
      description: `${placedOrder?.orderNumber ? formatOrderNumber(placedOrder.orderNumber) : "Order"} marked as paid${info.receiptUrl ? " — receipt available" : ""}.`,
    });
    playPosSound("success");
    const receiptItems = placedOrder
      ? liveItems.map(oi => ({ name: oi.menuItemName, unitPrice: Number(oi.unitPrice), quantity: oi.quantity, modifiers: [] }))
      : cart.map(c => ({ name: c.name, unitPrice: c.unitPrice, quantity: c.quantity, modifiers: c.modifiers }));
    printReceipt({
      orderNumber: formatOrderNumber(placedOrder?.orderDisplayNumber ?? placedOrder?.orderNumber ?? ""),
      tableLabel: selectedTable ? `Table ${selectedTable.tableNumber}` : "",
      orderType, items: receiptItems, totals: displayTotals, paymentMethod: "card",
      customerName, restaurantName: restaurant?.name, logoUrl: restaurant?.logoUrl ?? undefined,
      restaurantAddress: [restaurant?.address, restaurant?.city].filter(Boolean).join(", ") || undefined,
      restaurantPhone: restaurant?.phone ?? undefined,
      createdAt: placedOrder?.createdAt,
      discounts: discountReceiptLines.length > 0 ? discountReceiptLines : undefined,
    });
    handleNewOrder();
  };

  const handleVoid = async () => {
    if (!placedOrder) { handleNewOrder(); return; }
    const reason = window.prompt("Reason for voiding this order (required, min 3 chars):", "");
    if (reason == null) return; // user cancelled
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      toast({ title: "Void cancelled", description: "A reason of at least 3 characters is required.", variant: "destructive" });
      return;
    }
    try {
      await voidOrder.mutateAsync({ orderId: placedOrder.id, reason: trimmed });
      toast({ title: "Order voided", description: trimmed });
      handleNewOrder();
    } catch (e) {
      const msg = (e as Error)?.message ?? "Failed to void order";
      toast({ title: "Failed to void order", description: msg, variant: "destructive" });
    }
  };

  const handleNewOrder = () => {
    setCart([]); setCustomerName("");
    setCustomerPhone(""); setPhoneQuery(""); setLinkedCustomerId(null); setLoyaltyRedeem(""); setCouponInput("");
    setSelectedTableId(null); setPlacedOrder(null);
    setShowPayModal(false); setShowSplitModal(false);
  };

  // ─── POS Shell integration: auto-save, hold/recall, keyboard handlers ──
  const DRAFT_KEY = "tt_pos_cart_draft";
  // Restore last cart draft on mount
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as { cart?: CartItem[]; customerName?: string; orderType?: string; selectedTableId?: number | null };
      if (Array.isArray(draft.cart) && draft.cart.length > 0) {
        setCart(draft.cart);
        if (typeof draft.customerName === "string") setCustomerName(draft.customerName);
        if (ORDER_TYPES.some(t => t.value === draft.orderType)) setOrderType(draft.orderType as OrderTypeValue);
        if (typeof draft.selectedTableId === "number" || draft.selectedTableId === null) setSelectedTableId(draft.selectedTableId ?? null);
      }
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Persist cart draft on every change (only pre-placement)
  useEffect(() => {
    try {
      if (placedOrder || cart.length === 0) {
        window.localStorage.removeItem(DRAFT_KEY);
        return;
      }
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
        cart, customerName, orderType, selectedTableId,
      }));
    } catch { /* noop */ }
  }, [cart, customerName, orderType, selectedTableId, placedOrder]);
  // Warn before unload if there's an unsaved cart
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (cart.length > 0 && !placedOrder) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
      return undefined;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [cart.length, placedOrder]);

  const handleHoldBill = useCallback(() => {
    if (cart.length === 0 || placedOrder) {
      toast({ title: "Nothing to hold", description: placedOrder ? "Order already placed." : "Cart is empty.", variant: "destructive" });
      return;
    }
    const label = customerName?.trim()
      || (selectedTableId ? `Table · ${(tables as FloorTable[]).find(t => t.id === selectedTableId)?.tableNumber ?? selectedTableId}` : null)
      || `${orderType.replace("_", "-")} · ${cart.length} item${cart.length > 1 ? "s" : ""}`;
    holdBill(label, { cart, customerName, orderType, selectedTableId });
    setCart([]); setCustomerName(""); setCustomerPhone(""); setLinkedCustomerId(null); setSelectedTableId(null);
    toast({ title: "Bill held", description: `Recall it any time with F5 — saved as "${label}".` });
  }, [cart, placedOrder, customerName, selectedTableId, tables, orderType, toast]);

  const handleRecallBill = useCallback((bill: HeldBill) => {
    const p = bill.payload as { cart?: CartItem[]; customerName?: string; orderType?: OrderTypeValue; selectedTableId?: number | null };
    if (!p || !Array.isArray(p.cart)) return;
    setCart(p.cart);
    setCustomerName(p.customerName ?? "");
    if (p.orderType) setOrderType(p.orderType);
    setSelectedTableId(p.selectedTableId ?? null);
    setPlacedOrder(null);
    toast({ title: "Bill recalled", description: bill.label });
  }, [toast]);

  const handleIncQty = useCallback(() => {
    setCart(prev => prev.length === 0 ? prev : prev.map((c, i) => i === prev.length - 1 ? { ...c, quantity: c.quantity + 1 } : c));
  }, []);
  const handleDecQty = useCallback(() => {
    setCart(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.quantity <= 1) return prev.slice(0, -1);
      return prev.map((c, i) => i === prev.length - 1 ? { ...c, quantity: c.quantity - 1 } : c);
    });
  }, []);
  const handleDeleteLast = useCallback(() => {
    setCart(prev => prev.slice(0, -1));
  }, []);
  const handlePrintKOT = useCallback(() => {
    if (!placedOrder) {
      toast({ title: "Place order first", description: "There's nothing to send to the kitchen yet.", variant: "destructive" });
      playPosSound("error");
      return;
    }
    // Prefer the local cart for KOT: it carries the modifier text + line
    // notes that the GET order-items response does not echo back. The cart
    // survives placement (it's only cleared on "New Order"), so post-place
    // reprints still get full kitchen detail. Fall back to live items only
    // for orders that weren't created on this device (e.g. recall path).
    const items = cart.length > 0
      ? cart.map(c => ({
          name: c.name,
          quantity: c.quantity,
          unitPrice: c.unitPrice,
          lineTotal: c.unitPrice * c.quantity,
          modifiers: c.modifiers,
          notes: c.notes,
        }))
      : liveItems.map(oi => ({
          name: oi.menuItemName,
          quantity: oi.quantity,
          unitPrice: Number(oi.unitPrice),
          lineTotal: Number(oi.totalPrice ?? Number(oi.unitPrice) * oi.quantity),
          modifiers: [] as CartModifier[],
          notes: oi.notes ?? undefined,
        }));
    printKitchenTicket({
      orderNumber: formatOrderNumber(placedOrder.orderDisplayNumber ?? placedOrder.orderNumber),
      createdAt: placedOrder.createdAt,
      tableLabel: selectedTable ? `Table ${selectedTable.tableNumber}` : undefined,
      orderType,
      items,
    });
    toast({ title: "KOT sent to kitchen printer" });
    playPosSound("success");
  }, [placedOrder, liveItems, cart, selectedTable, orderType, toast]);

  const handlePrintCurrent = useCallback(() => {
    if (!placedOrder) {
      toast({ title: "Place order first", variant: "destructive" });
      return;
    }
    printReceipt({
      orderNumber: formatOrderNumber(placedOrder.orderDisplayNumber ?? placedOrder.orderNumber),
      tableLabel: selectedTable ? `Table ${selectedTable.tableNumber}` : "",
      orderType,
      items: placedOrder
        ? liveItems.map(oi => ({ name: oi.menuItemName, unitPrice: Number(oi.unitPrice), quantity: oi.quantity, modifiers: [] }))
        : cart.map(c => ({ name: c.name, unitPrice: c.unitPrice, quantity: c.quantity, modifiers: c.modifiers })),
      totals: displayTotals,
      paymentMethod: "pending",
      customerName,
      restaurantName: restaurant?.name,
      logoUrl: restaurant?.logoUrl ?? undefined,
      restaurantAddress: [restaurant?.address, restaurant?.city].filter(Boolean).join(", ") || undefined,
      restaurantPhone: restaurant?.phone ?? undefined,
      createdAt: placedOrder.createdAt,
      discounts: discountReceiptLines.length > 0 ? discountReceiptLines : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placedOrder, liveItems, cart, displayTotals, customerName, restaurant, orderType, discountReceiptLines, toast]);

  // Receipt items for modals (works pre and post placement)
  const receiptDisplayItems = placedOrder
    ? liveItems.map(oi => ({ name: oi.menuItemName, unitPrice: Number(oi.unitPrice), quantity: oi.quantity, modifiers: [] as CartModifier[] }))
    : cart.map(c => ({ name: c.name, unitPrice: c.unitPrice, quantity: c.quantity, modifiers: c.modifiers }));

  return (
    <PosShell
      handlers={{
        onSearchFocus: () => searchInputRef.current?.focus(),
        onHold: handleHoldBill,
        onKOT: handlePrintKOT,
        onPrint: handlePrintCurrent,
        onPay: handlePayNow,
        onPlaceOrder: () => { void handlePlaceOrder(); },
        onIncQty: handleIncQty,
        onDecQty: handleDecQty,
        onDelete: handleDeleteLast,
        onNewOrder: handleNewOrder,
      }}
      onRecallBill={handleRecallBill}
    >
      <div className="flex flex-1 min-h-0 overflow-hidden bg-background">

        {/* Left panel */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Table grid */}
          <div className="border-b border-border flex-shrink-0">
            <div className="flex items-center w-full">
              <button
                className="flex-1 flex items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
                onClick={() => setShowTableGrid(p => !p)}
              >
                <span className="flex items-center gap-2 text-foreground">
                  Tables
                  {selectedTable && (
                    <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full leading-none">
                      T{selectedTable.tableNumber}
                    </span>
                  )}
                  {tableActiveOrder && !placedOrder && (
                    <span className="bg-orange-500 text-white text-xs px-2 py-0.5 rounded-full leading-none flex items-center gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" /> Active order
                    </span>
                  )}
                </span>
                {showTableGrid ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
              {restaurant?.enableVoiceOrdering && (
                <button
                  onClick={() => setShowVoiceModal(true)}
                  className="mr-2 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15 text-xs font-semibold"
                  title="AI voice order (push to talk)"
                >
                  <Mic className="w-3.5 h-3.5" /> Voice order
                </button>
              )}
            </div>

            {showTableGrid && (
              <div className="px-4 pb-3">
                <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-1.5 max-h-36 overflow-y-auto">
                  {(tables as FloorTable[]).map(table => {
                    const tblOrder = activeOrders.find(o => o.tableId === table.id);
                    const runningTotal = tblOrder ? Number(tblOrder.totalAmount ?? 0) : 0;
                    return (
                      <button
                        key={table.id}
                        onClick={() => handleSelectTable(table)}
                        title={tblOrder ? `${formatOrderNumber(tblOrder.orderDisplayNumber ?? tblOrder.orderNumber)} · ₹${runningTotal.toFixed(0)}` : `Table ${table.tableNumber} (${table.capacity} seats)`}
                        className={cn(
                          "relative flex flex-col items-center justify-center aspect-square rounded-lg border-2 text-xs font-bold transition-all",
                          selectedTableId === table.id
                            ? "border-primary bg-primary text-primary-foreground scale-95 shadow-md"
                            : TABLE_STATUS_STYLE[table.status] ?? "bg-gray-100 text-gray-600 border-gray-200"
                        )}
                      >
                        <span>{table.tableNumber}</span>
                        <span className="text-[9px] opacity-70 font-normal">{table.capacity}p</span>
                        {runningTotal > 0 && (
                          <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[8px] font-bold px-1 py-px rounded leading-none shadow">
                            ₹{runningTotal >= 1000 ? `${(runningTotal / 1000).toFixed(1)}k` : runningTotal.toFixed(0)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {tables.length === 0 && (
                    <p className="col-span-full text-xs text-muted-foreground py-2 text-center">No tables configured</p>
                  )}
                </div>
                <div className="flex gap-4 mt-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-green-500" />Free</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-orange-500" />Occupied</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-blue-500" />Reserved</span>
                </div>
              </div>
            )}
          </div>

          {/* Order type + customer name */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0 bg-background">
            <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto">
              {ORDER_TYPES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => {
                    setOrderType(value);
                    if (value !== "dine_in") setSelectedTableId(null);
                  }}
                  disabled={!!placedOrder}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex-shrink-0",
                    orderType === value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:border-primary/50",
                    placedOrder && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />{label}
                </button>
              ))}
            </div>
            <Input
              className="h-8 text-xs w-32 sm:w-44 flex-shrink-0"
              placeholder="Customer name (optional)"
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              disabled={!!placedOrder}
            />
          </div>

          {/* Customer phone lookup for loyalty */}
          {!placedOrder && !linkedCustomerId && (
            <div className="flex gap-1.5 px-4 pb-2 items-start">
              <PhoneInput
                className="flex-1"
                placeholder="Phone to link loyalty (optional)"
                value={customerPhone}
                onChange={v => { setCustomerPhone(v); setPhoneQuery(v); }}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-12 text-xs px-2 flex-shrink-0 whitespace-nowrap"
                onClick={() => setShowCustomerSearch(true)}
                title="Search saved customers by name or phone"
              >
                <Search className="w-3.5 h-3.5" />
                <span className="ml-1">Find</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-12 text-xs px-2 flex-shrink-0 whitespace-nowrap"
                onClick={handleLinkCustomer}
                disabled={createCustomerMut.isPending || !(customerPhone || "").trim()}
                title={foundCustomer ? `Link ${foundCustomer.name}` : "Create & link new customer with this phone"}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span className="ml-1">{foundCustomer ? "Link" : "Add"}</span>
              </Button>
            </div>
          )}
          {linkedCustomerId && (
            <div className="flex items-center gap-1.5 px-4 pb-2 text-xs text-primary">
              <Star className="w-3.5 h-3.5 fill-primary" />
              <span className="font-medium">{customerName}</span>
              <span className="text-muted-foreground">· {loyaltyAccount?.balance ?? 0} pts available</span>
              {customerPhone && (
                <>
                  <a
                    href={`tel:${customerPhone}`}
                    className="ml-1 w-6 h-6 rounded flex items-center justify-center bg-secondary text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                    title={`Call ${customerPhone}`}
                  >
                    <Phone className="w-3 h-3" />
                  </a>
                  <a
                    href={`https://wa.me/${customerPhone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="w-6 h-6 rounded flex items-center justify-center bg-secondary text-muted-foreground hover:bg-green-100 hover:text-green-700 transition-colors"
                    title={`WhatsApp ${customerPhone}`}
                  >
                    <MessageCircle className="w-3 h-3" />
                  </a>
                </>
              )}
              {!placedOrder && (
                <button onClick={() => { setLinkedCustomerId(null); setCustomerPhone(""); setPhoneQuery(""); }} className="ml-auto text-muted-foreground hover:text-destructive">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* Search bar */}
          <div className="border-b border-border flex-shrink-0 bg-background px-4 py-2">
            <div className="relative">
              <Input
                ref={searchInputRef}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search items by name… (F2)"
                className="h-9 pl-9 text-sm"
                data-testid="pos-item-search"
              />
              <ShoppingBag className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Category filter + veg/non-veg chips */}
          <div className="border-b border-border flex-shrink-0 bg-background overflow-x-auto">
            <div className="flex gap-1.5 px-4 py-2 w-max min-w-full items-center">
              <Button size="sm" variant={!selectedCat ? "default" : "outline"} onClick={() => setSelectedCat(undefined)} className="flex-shrink-0 h-7 text-xs px-3">All</Button>
              {visibleCategories.map(c => (
                <Button key={c.id} size="sm" variant={selectedCat === c.id ? "default" : "outline"} onClick={() => setSelectedCat(c.id)} className="flex-shrink-0 h-7 text-xs px-3 whitespace-nowrap">
                  {c.name}
                </Button>
              ))}
              <span className="w-px h-5 bg-border mx-1" />
              {([
                { v: "all", label: "All", dot: "bg-muted-foreground" },
                { v: "veg", label: "Veg", dot: "bg-green-500" },
                { v: "non_veg", label: "Non-veg", dot: "bg-red-500" },
              ] as const).map(({ v, label, dot }) => (
                <button
                  key={v}
                  onClick={() => setVegFilter(v)}
                  className={cn(
                    "flex-shrink-0 h-7 text-xs px-3 rounded-md border flex items-center gap-1.5 whitespace-nowrap transition-colors",
                    vegFilter === v ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"
                  )}
                >
                  <Leaf className={cn("w-3 h-3", v === "non_veg" && "hidden")} />
                  <span className={cn("w-2 h-2 rounded-full", dot, v !== "non_veg" && "hidden")} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Shift-closed gate banner */}
          {!isRegisterOpenForPos && !shiftBypassed && (
            <div className="mx-3 mt-3 p-4 rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 flex items-start gap-3">
              <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">No active shift</p>
                <p className="text-xs text-amber-800 dark:text-amber-300/80 mt-0.5">
                  Open a cash register to take cash payments. You can still browse and ring up orders.
                </p>
              </div>
              <div className="flex flex-col gap-1.5 flex-shrink-0">
                <a href="/cash-register" className="text-xs font-semibold px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 whitespace-nowrap text-center">Open Shift</a>
                <button onClick={() => setShiftBypassed(true)} className="text-xs text-amber-700 dark:text-amber-300 hover:underline">Continue anyway</button>
              </div>
            </div>
          )}

          {/* Main panel — Menu grid OR QR Order inbox OR Reservation inbox */}
          {orderType === "qr_order" ? (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex items-center gap-2 mb-3">
                <QrCode className="w-5 h-5 text-primary" />
                <h2 className="font-semibold text-foreground">Pending QR & Digital Orders</h2>
                <span className="ml-auto text-xs text-muted-foreground">{pendingCarts.length} waiting</span>
              </div>
              {pendingCarts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <QrCode className="w-12 h-12 mb-3 opacity-20" />
                  <p className="text-sm">No pending QR carts</p>
                  <p className="text-xs mt-1">Carts started from table QR codes will appear here.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {pendingCarts.map((session) => {
                    const tbl = (tables as FloorTable[]).find(t => t.id === session.tableId);
                    return (
                      <button
                        key={session.id}
                        onClick={() => {
                          if (tbl) handleSelectTable(tbl);
                          setOrderType("dine_in");
                          toast({ title: "Seated QR cart", description: tbl ? `Table ${tbl.tableNumber}` : "Walk-in" });
                        }}
                        className="text-left p-4 rounded-xl border-2 border-border hover:border-primary/60 hover:bg-accent/40 transition-all"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-semibold">{tbl ? `Table ${tbl.tableNumber}` : (session.channel || "Walk-in")}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium uppercase">{session.channel || "qr"}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Started {new Date(session.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          {session.customerName ? ` · ${session.customerName}` : ""}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : orderType === "reservation_order" ? (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex items-center gap-2 mb-3">
                <CalendarClock className="w-5 h-5 text-primary" />
                <h2 className="font-semibold text-foreground">Today's Reservations</h2>
                <span className="ml-auto text-xs text-muted-foreground">{todayReservations.length} booked</span>
              </div>
              {todayReservations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <CalendarClock className="w-12 h-12 mb-3 opacity-20" />
                  <p className="text-sm">No reservations today</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {todayReservations.map((res) => {
                    const tbl = (tables as FloorTable[]).find(t => t.id === res.tableId);
                    const when = new Date(res.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                    return (
                      <div key={res.id} className="p-4 rounded-xl border-2 border-border">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-semibold">{res.guestName}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium uppercase">{res.status}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {res.partySize} guests · {when}
                          {tbl ? ` · Table ${tbl.tableNumber}` : ""}
                        </p>
                        {tbl && (
                          <Button
                            size="sm"
                            className="mt-2 h-7 text-xs w-full"
                            onClick={() => {
                              handleSelectTable(tbl);
                              setCustomerName(res.guestName);
                              setOrderType("dine_in");
                              toast({ title: "Seated guest", description: `${res.guestName} at Table ${tbl.tableNumber}` });
                            }}
                          >
                            Seat & Start Order
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
          <div className="flex-1 overflow-y-auto p-3">
            {placedOrder && (
              <div className="mb-3 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-blue-700 dark:text-blue-400 flex items-center gap-2">
                <Plus className="w-3.5 h-3.5 flex-shrink-0" />
                Tap items to add more to this order
              </div>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-1.5">
              {(() => {
                const q = searchQuery.trim().toLowerCase();
                const src = q ? (allMenuItems as MenuItem[]) : (menuItems as MenuItem[]);
                return src.filter(i => {
                  if (q) {
                    const extras = i as MenuItem & { sku?: string | null; barcode?: string | null; aliases?: string[] | null };
                    const sku = (extras.sku ?? "").toLowerCase();
                    const barcode = (extras.barcode ?? "").toLowerCase();
                    const aliases = (extras.aliases ?? []).map(a => a.toLowerCase());
                    const tags = (i.tags ?? []).map(t => t.toLowerCase());
                    const desc = (i.description ?? "").toLowerCase();
                    const catName = categoryNameById.get(i.categoryId) ?? "";
                    const matched =
                      i.name.toLowerCase().includes(q) ||
                      sku.includes(q) ||
                      barcode.includes(q) ||
                      desc.includes(q) ||
                      catName.includes(q) ||
                      tags.some(t => t.includes(q)) ||
                      aliases.some(a => a.includes(q));
                    if (!matched) return false;
                  }
                  if (vegFilter === "veg" && !i.isVeg) return false;
                  if (vegFilter === "non_veg" && i.isVeg) return false;
                  return true;
                });
              })().map(item => {
                const inCart = cart.find(c => c.menuItemId === item.id);
                const inLive = placedOrder ? liveItems.some(li => li.menuItemId === item.id) : false;
                const isOut = !item.isAvailable;
                return (
                  <button
                    key={item.id}
                    onClick={() => { if (!isOut) handleMenuItemClick(item); }}
                    disabled={isOut}
                    title={isOut ? "Item is 86'd (out of stock)" : item.name}
                    className={cn(
                      "group relative text-left p-1.5 rounded-lg border bg-card transition-all duration-150 overflow-hidden",
                      isOut
                        ? "border-border bg-muted/30 opacity-60 cursor-not-allowed"
                        : "active:scale-[0.97] hover:shadow-md hover:-translate-y-0.5",
                      !isOut && (inCart || inLive)
                        ? "border-primary/70 bg-gradient-to-br from-primary/10 to-primary/5 ring-1 ring-primary/30 shadow-sm"
                        : !isOut && "border-border/70 hover:border-primary/50 hover:bg-accent/30"
                    )}
                  >
                    {item.imageUrl ? (
                      <img
                        src={resolveImageUrl(item.imageUrl)}
                        alt=""
                        className={cn("w-full aspect-square object-cover rounded-md mb-1.5 bg-muted", isOut && "grayscale")}
                        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="w-full aspect-square rounded-md bg-muted/40 flex items-center justify-center mb-1.5">
                        <ShoppingBag className="w-5 h-5 text-muted-foreground/40" />
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <p className="text-[11px] font-medium leading-tight line-clamp-2 flex-1">{item.name}</p>
                      <span className={cn("w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ring-1", item.isVeg ? "bg-green-500 ring-green-600/30" : "bg-red-500 ring-red-600/30")} />
                    </div>
                    <span className="inline-flex items-center text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-md ring-1 ring-primary/20">₹{item.price}</span>
                    {!isOut && (item.tags ?? []).some(t => t.toLowerCase() === "bestseller") && (
                      <div className="absolute top-1 left-1 bg-amber-500 text-white text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded shadow flex items-center gap-0.5">
                        <Flame className="w-2 h-2" /> Top
                      </div>
                    )}
                    {!isOut && (item.tags ?? []).some(t => ["new", "chef special", "chef's special"].includes(t.toLowerCase())) && (
                      <div className="absolute bottom-9 left-1 bg-violet-500 text-white text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded shadow flex items-center gap-0.5">
                        <Sparkles className="w-2 h-2" /> New
                      </div>
                    )}
                    {isOut && (
                      <div className="absolute top-1 left-1 bg-destructive text-destructive-foreground text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded shadow">
                        86'd
                      </div>
                    )}
                    {!isOut && (inCart || inLive) && (
                      <div className="absolute top-1 right-1 bg-primary text-primary-foreground text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold shadow ring-2 ring-background">
                        {inCart?.quantity ?? liveItems.filter(li => li.menuItemId === item.id).reduce((s, li) => s + li.quantity, 0)}
                      </div>
                    )}
                  </button>
                );
              })}
              {(() => {
                const q = searchQuery.trim().toLowerCase();
                const src = q ? (allMenuItems as MenuItem[]) : (menuItems as MenuItem[]);
                const visible = src.filter(i => {
                  if (q) {
                    const extras = i as MenuItem & { sku?: string | null; barcode?: string | null; aliases?: string[] | null };
                    const sku = (extras.sku ?? "").toLowerCase();
                    const barcode = (extras.barcode ?? "").toLowerCase();
                    const aliases = (extras.aliases ?? []).map(a => a.toLowerCase());
                    const tags = (i.tags ?? []).map(t => t.toLowerCase());
                    const desc = (i.description ?? "").toLowerCase();
                    const catName = categoryNameById.get(i.categoryId) ?? "";
                    const matched = i.name.toLowerCase().includes(q) || sku.includes(q) || barcode.includes(q) || desc.includes(q) || catName.includes(q) || tags.some(t => t.includes(q)) || aliases.some(a => a.includes(q));
                    if (!matched) return false;
                  }
                  if (vegFilter === "veg" && !i.isVeg) return false;
                  if (vegFilter === "non_veg" && i.isVeg) return false;
                  return true;
                });
                if (visible.length > 0) return null;
                return (
                  <div className="col-span-full flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <ShoppingBag className="w-12 h-12 mb-3 opacity-20" />
                    <p className="text-sm font-medium">{q ? `No items match "${searchQuery}"` : "No items found"}</p>
                    <p className="text-xs mt-1 opacity-70">{q ? "Try a different name, category, SKU, alias or barcode" : "Pick a different category or add menu items"}</p>
                    <div className="flex gap-2 mt-3">
                      {q && (
                        <button onClick={() => setSearchQuery("")} className="text-xs px-3 py-1.5 rounded-md border border-border hover:border-primary/50 hover:text-foreground">
                          Clear search
                        </button>
                      )}
                      {canManageMenu && (
                        <a href="/menu" className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1">
                          <Plus className="w-3 h-3" /> Create new item
                        </a>
                      )}
                    </div>
                  </div>
                );
              })()}
              {/* Discovery strips — visible when search is empty and on "All".
                  Popular today is sourced from real dashboard analytics; Recently
                  ordered is derived from the cashier's current active-orders list. */}
              {searchQuery.trim() === "" && selectedCat == null && (
                <>
                  {popularItems.length > 0 && (
                    <div className="col-span-full">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                        <Flame className="w-3 h-3 text-amber-500" /> Popular today
                      </p>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {popularItems.map(pi => {
                          const item = (allMenuItems as MenuItem[]).find(m => m.id === pi.menuItemId);
                          if (!item || !item.isAvailable) return null;
                          return (
                            <button
                              key={pi.menuItemId}
                              onClick={() => handleMenuItemClick(item)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                              title={`${pi.orderCount} sold today`}
                            >
                              <span className="font-medium truncate max-w-[10rem]">{pi.name}</span>
                              <span className="text-amber-600 dark:text-amber-400 font-semibold">×{pi.orderCount}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {recentItemIds.length > 0 && (
                    <div className="col-span-full">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                        <RotateCcw className="w-3 h-3 text-primary" /> Recently ordered
                      </p>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {recentItemIds.map(id => {
                          const item = (allMenuItems as MenuItem[]).find(m => m.id === id);
                          if (!item || !item.isAvailable) return null;
                          return (
                            <button
                              key={id}
                              onClick={() => handleMenuItemClick(item)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-border bg-secondary/40 text-xs text-foreground hover:border-primary/50 hover:bg-accent/40"
                            >
                              <span className="font-medium truncate max-w-[10rem]">{item.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          )}
        </div>

        {/* Right panel — Order ticket */}
        <div className="w-80 xl:w-96 flex-shrink-0 flex flex-col bg-card border-l border-border shadow-[-4px_0_16px_-8px_hsl(0_0%_0%/0.08)] min-h-0">

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
              <Button variant="ghost" size="sm" onClick={handleVoid} className="text-muted-foreground hover:text-destructive h-8 w-8 p-0" title={placedOrder ? "Void order" : "Clear cart"}>
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>

          {placedOrder && (
            <div className="mx-4 mt-3 px-4 py-2.5 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded-xl">
              <p className="text-xs font-semibold text-green-700 dark:text-green-400">{formatOrderNumber(placedOrder.orderDisplayNumber ?? placedOrder.orderNumber)} — placed</p>
              <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">Kitchen notified · Tap menu items to add more</p>
            </div>
          )}

          {/* Item list */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
            {!placedOrder && cart.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground pb-12 px-3">
                <ShoppingBag className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm font-medium">Cart is empty</p>
                <p className="text-xs mt-1 opacity-60">Tap items from the menu, or use a shortcut</p>
                <div className="grid grid-cols-2 gap-2 mt-4 w-full max-w-[15rem]">
                  <button
                    onClick={() => { searchInputRef.current?.focus(); }}
                    className="flex flex-col items-center gap-1 p-2.5 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/40 transition-colors"
                    title="Focus item search (F2)"
                  >
                    <Search className="w-4 h-4 text-primary" />
                    <span className="text-[11px] font-medium text-foreground">Search</span>
                    <span className="text-[9px] text-muted-foreground">F2</span>
                  </button>
                  <button
                    onClick={() => { setShowTableGrid(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                    className="flex flex-col items-center gap-1 p-2.5 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/40 transition-colors"
                    title="Pick a table"
                  >
                    <Utensils className="w-4 h-4 text-primary" />
                    <span className="text-[11px] font-medium text-foreground">Table</span>
                    <span className="text-[9px] text-muted-foreground">{selectedTable ? `T${selectedTable.tableNumber}` : "Pick"}</span>
                  </button>
                  <button
                    onClick={() => window.dispatchEvent(new CustomEvent("pos:openHold"))}
                    className="flex flex-col items-center gap-1 p-2.5 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/40 transition-colors"
                    title="Recall a held bill (F5)"
                  >
                    <RotateCcw className="w-4 h-4 text-primary" />
                    <span className="text-[11px] font-medium text-foreground">Recall</span>
                    <span className="text-[9px] text-muted-foreground">F5</span>
                  </button>
                  {restaurant?.enableVoiceOrdering ? (
                    <button
                      onClick={() => setShowVoiceModal(true)}
                      className="flex flex-col items-center gap-1 p-2.5 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/40 transition-colors"
                      title="AI voice order"
                    >
                      <Mic className="w-4 h-4 text-primary" />
                      <span className="text-[11px] font-medium text-foreground">Voice</span>
                      <span className="text-[9px] text-muted-foreground">Talk</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => toast({ title: "Scan a barcode", description: "Use your barcode wedge or scan an item SKU." })}
                      className="flex flex-col items-center gap-1 p-2.5 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/40 transition-colors"
                      title="Scan a barcode"
                    >
                      <QrCode className="w-4 h-4 text-primary" />
                      <span className="text-[11px] font-medium text-foreground">Scan</span>
                      <span className="text-[9px] text-muted-foreground">SKU</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Pre-placement: local cart items */}
            {!placedOrder && cart.map(item => (
              <div key={item.lineKey} className="py-2 border-b border-border/40 last:border-0">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    {item.modifiers.length > 0 && (
                      <p className="text-xs text-muted-foreground/70 truncate">{item.modifiers.map(m => m.name).join(", ")}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      ₹{item.unitPrice.toFixed(2)} × {item.quantity} = <span className="font-medium text-foreground">₹{(item.unitPrice * item.quantity).toFixed(2)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      onClick={() => setNoteEditingKey(k => k === item.lineKey ? null : item.lineKey)}
                      className={cn(
                        "w-6 h-6 rounded flex items-center justify-center transition-colors",
                        item.notes ? "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300" : "bg-secondary text-muted-foreground hover:bg-amber-50 hover:text-amber-700",
                      )}
                      title={item.notes ? `Note: ${item.notes}` : "Add kitchen note"}
                      data-testid={`pos-cart-note-${item.lineKey}`}
                    >
                      <StickyNote className="w-3 h-3" />
                    </button>
                    <button onClick={() => updateQty(item.lineKey, item.quantity - 1)} className="w-6 h-6 rounded bg-secondary hover:bg-red-100 hover:text-red-600 flex items-center justify-center transition-colors"><Minus className="w-3 h-3" /></button>
                    <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                    <button onClick={() => updateQty(item.lineKey, item.quantity + 1)} className="w-6 h-6 rounded bg-secondary hover:bg-primary/10 hover:text-primary flex items-center justify-center transition-colors"><Plus className="w-3 h-3" /></button>
                    <button onClick={() => removeFromCart(item.lineKey)} className="w-6 h-6 rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors ml-0.5"><X className="w-3 h-3" /></button>
                  </div>
                </div>
                {(noteEditingKey === item.lineKey || item.notes) && (
                  <div className="mt-1.5 pl-1">
                    <Input
                      autoFocus={noteEditingKey === item.lineKey}
                      className="h-7 text-xs"
                      placeholder="e.g. no onions, extra spicy, allergy: nuts"
                      value={item.notes ?? ""}
                      onChange={e => setCart(prev => prev.map(c => c.lineKey === item.lineKey ? { ...c, notes: e.target.value } : c))}
                      onBlur={() => setNoteEditingKey(k => k === item.lineKey ? null : k)}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
                      data-testid={`pos-cart-note-input-${item.lineKey}`}
                    />
                  </div>
                )}
              </div>
            ))}

            {/* Post-placement: server items with API controls */}
            {placedOrder && liveItems.map(item => (
              <div key={item.id} className="flex items-start gap-2 py-2 border-b border-border/40 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.menuItemName}</p>
                  <p className="text-xs text-muted-foreground">
                    ₹{Number(item.unitPrice).toFixed(2)} × {item.quantity} = <span className="font-medium text-foreground">₹{Number(item.totalPrice).toFixed(2)}</span>
                  </p>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    onClick={() => {
                      addOrderItem.mutate({ orderId: placedOrder.id, menuItemId: item.menuItemId, quantity: 1 }, {
                        onSuccess: () => toast({ title: `${item.menuItemName} +1` }),
                      });
                    }}
                    disabled={addOrderItem.isPending}
                    className="w-6 h-6 rounded bg-secondary hover:bg-primary/10 hover:text-primary flex items-center justify-center transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                  <button
                    onClick={() => removeOrderItemById(item.id)}
                    disabled={removeOrderItem.isPending}
                    className="w-6 h-6 rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Totals + actions — sticky footer summary */}
          {(cart.length > 0 || placedOrder) && (
            <div className="sticky bottom-0 z-50 border-t border-border px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-3 flex-shrink-0 bg-card shadow-[0_-4px_12px_-4px_hsl(0_0%_0%/0.08)]">
              {/* Active discount lines (T4) — each ledger row shown with × remove */}
              {placedOrder && liveDiscounts.length > 0 && (
                <div className="space-y-1">
                  {liveDiscounts.map(d => (
                    <div key={d.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted/40 text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Tag className="w-3 h-3 text-green-600 flex-shrink-0" />
                        <span className="truncate text-foreground">
                          {d.type === "coupon" && d.couponCode ? `Coupon ${d.couponCode}` : (d.reason || "Discount")}
                        </span>
                        <span className="text-muted-foreground flex-shrink-0">
                          {d.type === "percentage" ? `(${Number(d.value).toFixed(0)}%)` : null}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-green-600 font-medium">-₹{Number(d.amount).toFixed(2)}</span>
                        <button
                          onClick={() => removeDiscountLine.mutate({ orderId: placedOrder.id, discountId: d.id })}
                          disabled={removeDiscountLine.isPending}
                          className="text-muted-foreground hover:text-destructive p-0.5"
                          title="Remove discount"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Button
                size="sm"
                variant="outline"
                className="w-full h-8 text-xs"
                disabled={!placedOrder}
                onClick={() => {
                  setDType("percentage");
                  setDValue("");
                  setDReason(discountsCfg?.presetReasons?.[0] ?? "");
                  setDOrderItemId("");
                  setDManagerPin("");
                  setDManagerOtp("");
                  setDPinRequired(false);
                  setDApprovalMethods([]);
                  setDOtpRecipient(null);
                  setShowDiscountDrawer(true);
                }}
              >
                <Tag className="w-3.5 h-3.5 mr-1.5" />
                {placedOrder ? "Apply discount" : "Place order to discount"}
              </Button>

              {/* Coupon code apply — only when order is placed */}
              {placedOrder && !liveDetail?.couponCode && (
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-orange-400 flex-shrink-0" />
                  <Input
                    placeholder="Coupon code"
                    value={couponInput}
                    onChange={e => setCouponInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleApplyCoupon()}
                    className="h-8 text-sm flex-1 uppercase"
                  />
                  <Button size="sm" variant="outline" className="h-8 text-xs px-3 flex-shrink-0" onClick={handleApplyCoupon} disabled={applyCoupon.isPending || !couponInput.trim()}>
                    {applyCoupon.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Apply"}
                  </Button>
                </div>
              )}
              {liveDetail?.couponCode && (
                <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                  <Check className="w-3.5 h-3.5" />
                  <span>Coupon <strong>{liveDetail.couponCode}</strong> applied</span>
                </div>
              )}

              {/* Loyalty redemption — only when a customer is linked and order placed */}
              {linkedCustomerId && placedOrder && (loyaltyAccount?.balance ?? 0) > 0 && (
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-primary flex-shrink-0" />
                  <Input
                    type="number"
                    placeholder={`Redeem pts (max ${loyaltyAccount?.balance ?? 0})`}
                    value={loyaltyRedeem}
                    onChange={e => setLoyaltyRedeem(e.target.value)}
                    className="h-8 text-sm flex-1"
                    min="0"
                    max={loyaltyAccount?.balance ?? 0}
                  />
                  <Button size="sm" variant="outline" className="h-8 text-xs px-3 flex-shrink-0" onClick={handleApplyLoyalty} disabled={applyLoyalty.isPending || !loyaltyRedeem}>
                    {applyLoyalty.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Apply"}
                  </Button>
                </div>
              )}

              <PosUpsellStrip
                cart={cart}
                liveItems={liveItems}
                branchId={selectedBranchId}
                onAdd={(item) => handleMenuItemClick({
                  id: item.id, name: item.name, price: item.price,
                  imageUrl: item.imageUrl, isAvailable: true,
                } as unknown as MenuItem)}
              />

              <div className="space-y-1">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Subtotal ({(placedOrder ? liveItems : cart).reduce((s, c) => s + c.quantity, 0)} items)</span>
                  <span>₹{displayTotals.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Tax ({(taxRate * 100).toFixed(0)}%)</span>
                  <span>₹{displayTotals.taxAmount.toFixed(2)}</span>
                </div>
                {displayTotals.serviceCharge > 0 && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Service Charge ({(serviceRate * 100).toFixed(0)}%)</span>
                    <span>₹{displayTotals.serviceCharge.toFixed(2)}</span>
                  </div>
                )}
                {displayTotals.discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                    <span>Discount</span><span>-₹{displayTotals.discountAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-lg border-t border-border pt-2">
                  <span>Total</span>
                  <span className="text-primary">₹{displayTotals.totalAmount.toFixed(2)}</span>
                </div>
                {!serverTotals && (
                  <p className="text-[10px] text-muted-foreground/60">* Estimated — server rates apply on placement</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {!placedOrder ? (
                  <>
                    <Button variant="outline" size="sm" disabled={createOrder.isPending} onClick={handlePlaceOrder}>
                      Place Order
                    </Button>
                    <Button size="sm" disabled={createOrder.isPending || payOrder.isPending} onClick={handlePayNow}>
                      <CreditCard className="w-3.5 h-3.5 mr-1.5" />Pay Now
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setShowSplitModal(true)}>
                      <Scissors className="w-3.5 h-3.5 mr-1.5" />Split Bill
                    </Button>
                    <Button size="sm" disabled={payOrder.isPending} onClick={() => setShowPayModal(true)}>
                      <CreditCard className="w-3.5 h-3.5 mr-1.5" />Pay
                    </Button>
                  </>
                )}
              </div>

              {/* Pre-placement quick actions: Hold / Recall */}
              {!placedOrder && (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 text-xs text-muted-foreground"
                    onClick={handleHoldBill}
                    disabled={cart.length === 0}
                    title="Park this cart for later (F4)"
                    data-testid="pos-hold-bill"
                  >
                    <Pause className="w-3 h-3 mr-1" />Hold (F4)
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 text-xs text-muted-foreground"
                    onClick={() => window.dispatchEvent(new CustomEvent("pos:openHold"))}
                    title="Recall a held bill (F5)"
                    data-testid="pos-recall-bills"
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />Recall (F5)
                  </Button>
                </div>
              )}

              {placedOrder && (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 text-xs text-muted-foreground"
                    onClick={handlePrintKOT}
                    title="Send / reprint a kitchen order ticket"
                    data-testid="pos-print-kot"
                  >
                    <Printer className="w-3 h-3 mr-1" />Reprint KOT
                  </Button>
                  <Button variant="ghost" size="sm" className="flex-1 text-xs text-muted-foreground" onClick={handleNewOrder}>
                    <Plus className="w-3 h-3 mr-1" />New Order
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showCustomerSearch && (
        <CustomerSearchModal
          onClose={() => setShowCustomerSearch(false)}
          onSelect={(c) => {
            setLinkedCustomerId(c.id);
            setCustomerName(c.name);
            setCustomerPhone(c.phone || "");
            setPhoneQuery(c.phone || "");
            setShowCustomerSearch(false);
            toast({ title: `Linked: ${c.name}`, description: `Loyalty balance: ${c.loyaltyPoints ?? 0} pts` });
            playPosSound("success");
          }}
        />
      )}

      {modPickerItem && (
        <ModifierPickerModal
          item={modPickerItem}
          groups={modifierGroups}
          isLoading={modGroupsLoading}
          onConfirm={handleModifierConfirm}
          onClose={() => setModPickerItem(null)}
        />
      )}

      {showPayModal && placedOrder && (
        <PaymentModal
          totals={displayTotals}
          orderId={placedOrder.id}
          onClose={() => setShowPayModal(false)}
          onConfirm={handleConfirmPayment}
          onTerminalConfirmed={handleTerminalConfirmed}
          isPending={payOrder.isPending}
          hasCustomer={!!linkedCustomerId}
        />
      )}

      {showDiscountDrawer && placedOrder && (() => {
        const subtotal = Number(liveDetail?.subtotal ?? placedOrder.subtotal ?? 0);
        const lineTotal = dType === "item" && dOrderItemId !== ""
          ? Number(liveItems.find(i => i.id === dOrderItemId)?.totalPrice ?? 0)
          : 0;
        const valNum = Number(dValue) || 0;
        const previewAmount =
          dType === "percentage" ? subtotal * (valNum / 100)
          : dType === "flat" ? Math.min(valNum, subtotal)
          : Math.min(valNum, lineTotal);
        const submit = () => {
          if (!dReason.trim()) {
            toast({ title: "Reason required", variant: "destructive" });
            return;
          }
          if (dType === "item" && !dOrderItemId) {
            toast({ title: "Pick an item", variant: "destructive" });
            return;
          }
          applyDiscountLine.mutate(
            {
              orderId: placedOrder.id,
              type: dType,
              value: valNum,
              reason: dReason.trim(),
              orderItemId: dType === "item" ? Number(dOrderItemId) : undefined,
              managerPin: dPinRequired && dManagerPin ? dManagerPin : undefined,
              managerOtp: dPinRequired && dManagerOtp ? dManagerOtp : undefined,
            },
            {
              onSuccess: () => {
                toast({ title: "Discount applied" });
                setShowDiscountDrawer(false);
              },
              onError: (err: Error & { status?: number; data?: { requiresPin?: boolean; code?: string; methods?: string[]; reason?: string } | null }) => {
                const d = err.data ?? {};
                const needsApproval = !!(d.requiresPin || d.code === "MANAGER_PIN_REQUIRED" || d.code === "MANAGER_APPROVAL_REQUIRED" || d.code === "MANAGER_OTP_INVALID") || err.status === 402;
                if (needsApproval) {
                  setDPinRequired(true);
                  setDApprovalMethods(d.methods ?? (d.requiresPin ? ["pin"] : []));
                  const why = d.reason === "ROLE_CAP_EXCEEDED" ? "exceeds your role's discount cap" : "exceeds the discount threshold";
                  toast({
                    title: d.code === "MANAGER_OTP_INVALID" ? "OTP invalid" : "Manager approval required",
                    description: d.code === "MANAGER_OTP_INVALID" ? (err.message || "Try again or request a new OTP.") : `This discount ${why}. Enter manager PIN or request OTP.`,
                    variant: "destructive",
                  });
                } else {
                  toast({ title: "Could not apply discount", description: err.message, variant: "destructive" });
                }
              },
            },
          );
        };
        return (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowDiscountDrawer(false)}>
            <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">Apply discount</h3>
                <button onClick={() => setShowDiscountDrawer(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-3 gap-1 p-1 bg-muted/40 rounded-lg">
                {(["percentage", "flat", "item"] as const).map(t => (
                  <button key={t}
                    onClick={() => { setDType(t); setDValue(""); }}
                    className={cn(
                      "py-1.5 text-xs font-medium rounded-md capitalize",
                      dType === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                    )}>
                    {t === "percentage" ? "Percent" : t === "flat" ? "Flat ₹" : "Item"}
                  </button>
                ))}
              </div>
              {dType === "item" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Order item</label>
                  <select value={dOrderItemId === "" ? "" : String(dOrderItemId)}
                    onChange={e => setDOrderItemId(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm">
                    <option value="">Select item…</option>
                    {liveItems.map(i => (
                      <option key={i.id} value={i.id}>
                        {i.menuItemName} × {i.quantity} (₹{Number(i.totalPrice).toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {dType === "percentage" ? "Percent off" : dType === "flat" ? "Amount (₹)" : "Amount off line (₹)"}
                </label>
                <Input type="number" min="0" step={dType === "percentage" ? "1" : "0.01"} value={dValue}
                  onChange={e => setDValue(e.target.value)}
                  placeholder={dType === "percentage" ? "e.g. 10" : "e.g. 50.00"} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Reason</label>
                {discountsCfg?.presetReasons && discountsCfg.presetReasons.length > 0 ? (
                  <select value={dReason} onChange={e => setDReason(e.target.value)}
                    className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm">
                    {discountsCfg.presetReasons.map(r => (<option key={r} value={r}>{r}</option>))}
                  </select>
                ) : (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    No discount reasons configured. Ask the owner to add presets in Settings → Discounts.
                  </p>
                )}
              </div>
              {dPinRequired && (
                <div className="space-y-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                    <Lock className="w-3.5 h-3.5" /> Manager approval required
                  </label>
                  {(dApprovalMethods.length === 0 || dApprovalMethods.includes("pin") || discountsCfg?.hasManagerPin) && (
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Manager PIN</div>
                      <Input type="password" inputMode="numeric" autoComplete="off" placeholder="••••"
                        value={dManagerPin} onChange={e => setDManagerPin(e.target.value)} />
                    </div>
                  )}
                  {(dApprovalMethods.includes("otp") || discountsCfg?.otpEnabled) && (
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Manager OTP (SMS)</div>
                      <div className="flex items-center gap-2">
                        <Input type="text" inputMode="numeric" autoComplete="off" placeholder="6-digit code"
                          value={dManagerOtp} onChange={e => setDManagerOtp(e.target.value)} className="flex-1" />
                        <Button type="button" size="sm" variant="outline" disabled={requestOtp.isPending}
                          onClick={() => {
                            requestOtp.mutate(undefined, {
                              onSuccess: r => {
                                setDOtpRecipient(r.recipientMasked ?? "manager");
                                toast({ title: "OTP sent", description: r.recipientMasked ? `Sent to manager phone ${r.recipientMasked}. Expires in 5 minutes.` : "Sent to manager phone. Expires in 5 minutes." });
                              },
                              onError: (err: Error & { data?: { error?: string } | null }) => toast({ title: "Could not send OTP", description: err.data?.error ?? err.message, variant: "destructive" }),
                            });
                          }}>
                          {requestOtp.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Send OTP"}
                        </Button>
                      </div>
                      {dOtpRecipient && (
                        <p className="text-[11px] text-muted-foreground">Sent to {dOtpRecipient} · valid 5 minutes</p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Estimated discount</span>
                <span className="font-semibold text-green-600">-₹{previewAmount.toFixed(2)}</span>
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowDiscountDrawer(false)}>Cancel</Button>
                <Button size="sm" className="flex-1" onClick={submit} disabled={applyDiscountLine.isPending}>
                  {applyDiscountLine.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Apply"}
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {showSplitModal && placedOrder && (
        <SplitBillModal
          totalAmount={displayTotals.totalAmount}
          displayItems={receiptDisplayItems}
          totals={displayTotals}
          placedOrderId={placedOrder.id}
          restaurantName={restaurant?.name}
          logoUrl={restaurant?.logoUrl ?? undefined}
          restaurantAddress={[restaurant?.address, restaurant?.city].filter(Boolean).join(", ") || undefined}
          restaurantPhone={restaurant?.phone ?? undefined}
          orderNumber={formatOrderNumber(placedOrder.orderDisplayNumber ?? placedOrder.orderNumber)}
          tableLabel={selectedTable ? `Table ${selectedTable.tableNumber}` : ""}
          orderType={orderType}
          customerName={customerName}
          orderCreatedAt={placedOrder.createdAt}
          discounts={discountReceiptLines.length > 0 ? discountReceiptLines : undefined}
          onClose={() => setShowSplitModal(false)}
          onComplete={handleNewOrder}
        />
      )}
      {showVoiceModal && restaurantIdForVoice && (
        <VoiceOrderModal
          restaurantId={restaurantIdForVoice}
          defaultTableId={selectedTableId}
          tables={tables as FloorTable[]}
          menuItems={allMenuItems as MenuItem[]}
          onClose={() => setShowVoiceModal(false)}
          onConfirm={handleVoiceOrderConfirm}
        />
      )}
    </PosShell>
  );
}

interface UpsellItem { id: number; name: string; price: string; imageUrl: string | null }
interface UpsellSuggestion { ruleId: number; ruleName: string; message: string | null; items: UpsellItem[] }

function PosUpsellStrip({
  cart, liveItems, branchId, onAdd,
}: {
  cart: CartItem[];
  liveItems: OrderItem[];
  branchId: number | null;
  onAdd: (item: UpsellItem) => void;
}) {
  const restaurantId = useRestaurantId();
  const [suggestions, setSuggestions] = useState<UpsellSuggestion[]>([]);
  const loggedRef = useRef<Set<string>>(new Set());

  const items = useMemo(() => {
    if (liveItems.length > 0) {
      return liveItems.map(i => ({ menuItemId: i.menuItemId ?? 0, quantity: i.quantity, unitPrice: Number(i.unitPrice) }));
    }
    return cart.map(c => ({ menuItemId: c.menuItemId, quantity: c.quantity, unitPrice: c.unitPrice }));
  }, [cart, liveItems]);
  const total = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const hash = `${items.length}|${total.toFixed(2)}|${items.map(i => `${i.menuItemId}x${i.quantity}`).join(",")}`;

  useEffect(() => {
    if (!restaurantId || items.length === 0) { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await apiPost<{ suggestions: UpsellSuggestion[] }>(
          `/restaurants/${restaurantId}/ai-ops/upsell/evaluate`,
          { channel: "pos", items, total, branchId },
        );
        setSuggestions(res.suggestions ?? []);
        for (const s of res.suggestions ?? []) {
          for (const it of s.items) {
            const k = `${s.ruleId}:${it.id}:${hash}`;
            if (!loggedRef.current.has(k)) {
              loggedRef.current.add(k);
              apiPost(`/restaurants/${restaurantId}/ai-ops/upsell/events`, {
                eventType: "impression", channel: "pos", ruleId: s.ruleId, menuItemId: it.id,
              }).catch(() => {});
            }
          }
        }
      } catch { /* silent */ }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, restaurantId]);

  if (suggestions.length === 0) return null;
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 space-y-2 overflow-hidden">
      <p className="text-xs font-semibold text-primary flex items-center gap-1">
        <Plus className="w-3 h-3" /> Suggested add-ons
      </p>
      <div className="overflow-x-auto -mx-2.5 px-2.5 pb-1">
       <div className="flex gap-2 w-max min-w-full">
        {suggestions.flatMap(s => s.items.map(it => (
          <button
            key={`${s.ruleId}-${it.id}`}
            onClick={() => {
              apiPost(`/restaurants/${restaurantId}/ai-ops/upsell/events`, {
                eventType: "accept", channel: "pos", ruleId: s.ruleId, menuItemId: it.id,
                revenue: Number(it.price),
              }).catch(() => {});
              onAdd(it);
            }}
            className="flex-shrink-0 flex items-center gap-2 bg-background border border-border rounded-md px-2.5 py-1.5 hover:border-primary text-left min-w-0"
          >
            {it.imageUrl && <img src={resolveImageUrl(it.imageUrl) ?? ""} alt="" className="w-7 h-7 rounded object-cover flex-shrink-0" />}
            <div className="min-w-0">
              <p className="text-xs font-medium truncate max-w-[120px]">{it.name}</p>
              <p className="text-[10px] text-muted-foreground">+₹{Number(it.price).toFixed(0)} · {s.ruleName}</p>
            </div>
            <Plus className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          </button>
        )))}
       </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CustomerSearchModal — POS-side "Find customer" picker. Lets cashiers search
// the saved customer list by name OR phone (server already supports both via
// ilike on the `search` param) and link the result to the current bill. Lives
// inline here because it's only used by the POS — no point in a shared file.
// ---------------------------------------------------------------------------
function CustomerSearchModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (c: Customer) => void;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  // Always load *something* — empty search returns the 20 most recent
  // customers so the cashier can pick a regular without typing.
  const { data, isLoading } = useCustomers({ search: debounced || undefined, limit: 20 });
  const results = data?.data ?? [];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card w-full max-w-md rounded-2xl shadow-xl border border-border flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-semibold text-base flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" /> Find customer
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
            <Input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search by name or phone…"
              className="pl-9 h-10"
            />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            {debounced ? `Matching "${debounced}"` : "Showing recent customers"}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground text-sm gap-2">
              <User className="w-8 h-8 opacity-40" />
              <p>No customers found.</p>
              <p className="text-xs">Try a different name or phone, or use the Add button to create a new one.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {results.map(c => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/60 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{c.name}</span>
                        {c.isVip && (
                          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                            VIP
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {c.phone || "No phone"}{c.email ? ` · ${c.email}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-primary font-semibold flex-shrink-0">
                      <Star className="w-3.5 h-3.5 fill-primary" />
                      {c.loyaltyPoints ?? 0} pts
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
