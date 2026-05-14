import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Layout } from "@/components/layout/Layout";
import {
  useFloorTables, useMenus, useMenuCategories, useMenuItems,
  useCreateOrder, usePayOrder, useVoidOrder, useOrders,
  useRestaurantInfo, useItemModifierGroups, useSplitOrder,
  useOrderDetail, useAddOrderItem, useRemoveOrderItem, useApplyDiscount,
  useCreatePaymentIntent, useCreateRazorpayOrder,
  useApplyLoyalty, useCustomerLoyalty, useCustomerByPhone, useApplyCoupon,
  useCurrentCashRegister,
} from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { FloorTable, MenuItem, MenuCategory, Order, PosModifierGroup, OrderDetail, OrderItem } from "@/lib/types";
import { printOrder } from "@/lib/printOrder";
import {
  ShoppingBag, CreditCard, Banknote, Smartphone, Printer,
  Trash2, Plus, Minus, Tag, ChevronDown, ChevronUp, X,
  Utensils, Package, Bike, ReceiptText, AlertTriangle, Scissors,
  Loader2, Check, Lock, Star, UserCheck, AlertCircle,
} from "lucide-react";

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
}

interface Totals {
  subtotal: number;
  taxAmount: number;
  serviceCharge: number;
  discountAmount: number;
  totalAmount: number;
}

type PayStage = "select" | "cash-confirm" | "card-form" | "upi-form" | "processing";

function makeLineKey(menuItemId: number, modifiers: CartModifier[]): string {
  const modKey = [...modifiers].sort((a, b) => a.name.localeCompare(b.name)).map(m => m.name).join("|");
  return modKey ? `${menuItemId}:${modKey}` : String(menuItemId);
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
}) {
  const { orderNumber, tableLabel, orderType, items, totals, paymentMethod, amountTendered, customerName, restaurantName, logoUrl, restaurantAddress, restaurantPhone, splitIndex, splitTotal, createdAt } = args;
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
  totalAmount, displayItems, totals, placedOrderId, restaurantName, logoUrl, restaurantAddress, restaurantPhone, orderNumber, tableLabel, orderType, customerName, orderCreatedAt,
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
}

function PaymentModal({
  totals,
  orderId,
  onClose,
  onConfirm,
  isPending,
}: {
  totals: Totals;
  orderId: number;
  onClose: () => void;
  onConfirm: (method: string, details?: PaymentConfirmDetails) => Promise<void>;
  isPending: boolean;
}) {
  const [method, setMethod] = useState<"cash" | "card" | "upi">("cash");
  const [stage, setStage] = useState<PayStage>("select");
  const [amountTendered, setAmountTendered] = useState("");
  const [upiId, setUpiId] = useState("");
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
    ? Math.max(0, Number(amountTendered) - totals.totalAmount)
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
    setStage("cash-confirm");
  };

  const handleProcessPayment = async () => {
    setStage("processing");
    try {
      if (method === "card") {
        const intent = await createPaymentIntent.mutateAsync({ orderId });
        if (intent.mode === "live" && intent.clientSecret && stripeRef.current.stripe && stripeRef.current.card) {
          const result = await stripeRef.current.stripe.confirmCardPayment(intent.clientSecret, {
            payment_method: { card: stripeRef.current.card },
          });
          if (result.error) {
            setStripeError(result.error.message ?? "Payment failed");
            setStage("card-form");
            return;
          }
          await onConfirm("card", { stripePaymentIntentId: result.paymentIntent?.id });
        } else {
          await new Promise(r => setTimeout(r, 1500));
          await onConfirm("card", { stripePaymentIntentId: intent.intentId });
        }
      } else if (method === "upi") {
        const rzpOrder = await createRazorpayOrder.mutateAsync({ orderId });
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
          await onConfirm("upi", { razorpayPaymentId: `demo_rzp_pay_${orderId}_${Date.now()}` });
        }
      } else {
        await onConfirm("cash", { amountTendered: Number(amountTendered) || undefined });
      }
    } catch {
      toast({ title: "Payment failed", description: "Please try again.", variant: "destructive" });
      setStage(method === "cash" ? "cash-confirm" : method === "card" ? "card-form" : "upi-form");
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
      <div className="flex justify-between font-bold text-xl border-t border-border pt-2">
        <span>Total</span>
        <span className="text-primary">₹{totals.totalAmount.toFixed(2)}</span>
      </div>
    </div>
  );

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
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  {PAYMENT_METHODS.map(({ value, label, icon: Icon }) => {
                    const disabled = value === "cash" && !isRegisterOpen;
                    return (
                      <button
                        key={value}
                        disabled={disabled}
                        title={disabled ? "Open the cash register before accepting cash" : ""}
                        onClick={() => setMethod(value as "cash" | "card" | "upi")}
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
              <Button className="w-full h-11" onClick={handleProceed} disabled={method === "cash" && !isRegisterOpen}>
                Continue with {method === "cash" ? "Cash" : method === "card" ? "Card" : "UPI"}
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
                  {STRIPE_PK ? `Pay ₹${totals.totalAmount.toFixed(2)}` : "Process Demo Payment"}
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

          {/* Processing stage */}
          {stage === "processing" && (
            <div className="py-8 flex flex-col items-center gap-4">
              <Loader2 className="w-12 h-12 animate-spin text-primary" />
              <p className="text-base font-medium text-foreground">Processing payment…</p>
              <p className="text-sm text-muted-foreground">
                {method === "card" ? "Contacting payment gateway" : method === "upi" ? "Awaiting UPI confirmation" : "Confirming payment"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PosPage() {
  const { data: restaurant } = useRestaurantInfo();
  const taxRate = Number(restaurant?.taxRate ?? 5) / 100;
  const serviceRate = Number(restaurant?.serviceCharge ?? 0) / 100;

  const { data: tables = [] } = useFloorTables();
  const { data: menus = [] } = useMenus();
  const firstMenuId = menus[0]?.id;
  const { data: categories = [] } = useMenuCategories(firstMenuId);
  const [selectedCat, setSelectedCat] = useState<number | undefined>();
  const { data: menuItems = [] } = useMenuItems({ categoryId: selectedCat });
  const { data: activeOrdersData } = useOrders();
  const activeOrders: Order[] = (activeOrdersData?.data ?? []).filter(
    o => o.status !== "completed" && o.status !== "cancelled"
  );

  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [orderType, setOrderType] = useState<"dine_in" | "takeaway" | "delivery">("dine_in");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [linkedCustomerId, setLinkedCustomerId] = useState<number | null>(null);
  const [loyaltyRedeem, setLoyaltyRedeem] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [showPayModal, setShowPayModal] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [showTableGrid, setShowTableGrid] = useState(true);
  const [placedOrder, setPlacedOrder] = useState<OrderDetail | null>(null);
  const [modPickerItem, setModPickerItem] = useState<MenuItem | null>(null);

  const createOrder = useCreateOrder();
  const payOrder = usePayOrder();
  const voidOrder = useVoidOrder();
  const addOrderItem = useAddOrderItem();
  const removeOrderItem = useRemoveOrderItem();
  const applyDiscount = useApplyDiscount();
  const applyLoyalty = useApplyLoyalty();
  const applyCoupon = useApplyCoupon();
  const { toast } = useToast();

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
      setDiscount(tableOrderDetail.discountAmount ?? "0");
      setPlacedOrder(tableOrderDetail);
    }
  }, [tableOrderDetail?.id]);

  // Live order detail (refreshed after add/remove item, discount changes)
  const { data: liveDetail } = useOrderDetail(placedOrder?.id);

  // Items shown in the ticket: server state after placement, local cart before
  const liveItems: OrderItem[] = useMemo(() => {
    if (!placedOrder) return [];
    return liveDetail?.items ?? placedOrder.items;
  }, [placedOrder, liveDetail]);

  // Totals: server-accurate after placement, local estimate before
  const discountAmount = Number(discount) || 0;
  const localSubtotal = cart.reduce((s, c) => s + c.unitPrice * c.quantity, 0);
  const localTaxAmount = localSubtotal * taxRate;
  const localServiceCharge = localSubtotal * serviceRate;
  const localTotal = Math.max(0, localSubtotal + localTaxAmount + localServiceCharge - discountAmount);

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
    discountAmount,
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
        },
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
    }
  }, [placedOrder, addOrderItem, toast]);

  const handleMenuItemClick = useCallback((item: MenuItem) => {
    setModPickerItem(item);
  }, []);

  const updateQty = useCallback((lineKey: string, qty: number) => {
    if (qty <= 0) setCart(prev => prev.filter(c => c.lineKey !== lineKey));
    else setCart(prev => prev.map(c => c.lineKey === lineKey ? { ...c, quantity: qty } : c));
  }, []);

  const removeFromCart = useCallback((lineKey: string) => {
    setCart(prev => prev.filter(c => c.lineKey !== lineKey));
  }, []);

  const removeOrderItemById = useCallback((itemId: number) => {
    if (!placedOrder) return;
    removeOrderItem.mutate({ orderId: placedOrder.id, itemId }, {
      onSuccess: () => toast({ title: "Item removed" }),
    });
  }, [placedOrder, removeOrderItem, toast]);

  const handleDiscountBlur = () => {
    if (!placedOrder) return;
    applyDiscount.mutate({ orderId: placedOrder.id, discountAmount }, {
      onSuccess: () => toast({ title: "Discount updated" }),
    });
  };

  const handleLinkCustomer = () => {
    if (!foundCustomer) {
      toast({ title: "No customer found", description: "Try a different phone number.", variant: "destructive" });
      return;
    }
    setLinkedCustomerId(foundCustomer.id);
    setCustomerName(foundCustomer.name);
    toast({ title: `Linked: ${foundCustomer.name}`, description: `Loyalty balance: ${foundCustomer.loyaltyPoints} pts` });
  };

  const handleApplyLoyalty = () => {
    if (!placedOrder) { toast({ title: "Place order first", variant: "destructive" }); return; }
    const pts = Math.floor(Number(loyaltyRedeem) || 0);
    if (pts <= 0) return;
    applyLoyalty.mutate({ orderId: placedOrder.id, points: pts }, {
      onSuccess: (data: { loyaltyApplied?: { discountValue?: number } }) => {
        const discount = Number(data?.loyaltyApplied?.discountValue ?? 0);
        toast({ title: `${pts} pts redeemed`, description: `₹${discount.toFixed(2)} off applied` });
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
      const order = await createOrder.mutateAsync({
        tableId: selectedTableId ?? undefined,
        orderType,
        customerName: customerName || undefined,
        customerId: linkedCustomerId ?? undefined,
        discountAmount: discountAmount > 0 ? discountAmount.toFixed(2) : undefined,
        items: cart.map(c => ({
          menuItemId: c.menuItemId,
          quantity: c.quantity,
          modifiers: c.modifiers.length > 0
            ? c.modifiers.map(m => ({ name: m.name, price: m.price.toFixed(2) }))
            : undefined,
        })),
      }) as OrderDetail;
      setPlacedOrder(order);
      toast({ title: `Order ${order.orderNumber} placed!`, description: "Kitchen has been notified." });
      return order;
    } catch {
      toast({ title: "Failed to place order", variant: "destructive" });
      return null;
    }
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
    await payOrder.mutateAsync({
      id: orderId,
      paymentMethod: method,
      stripePaymentIntentId: details?.stripePaymentIntentId,
      razorpayPaymentId: details?.razorpayPaymentId,
      razorpayOrderId: details?.razorpayOrderId,
      razorpaySignature: details?.razorpaySignature,
    });
    setShowPayModal(false);
    toast({ title: "Payment confirmed!", description: `${placedOrder?.orderNumber} marked as paid.` });
    const receiptItems = placedOrder
      ? liveItems.map(oi => ({ name: oi.menuItemName, unitPrice: Number(oi.unitPrice), quantity: oi.quantity, modifiers: [] }))
      : cart.map(c => ({ name: c.name, unitPrice: c.unitPrice, quantity: c.quantity, modifiers: c.modifiers }));
    printReceipt({
      orderNumber: placedOrder?.orderNumber ?? "",
      tableLabel: selectedTable ? `Table ${selectedTable.tableNumber}` : "",
      orderType, items: receiptItems, totals: displayTotals, paymentMethod: method,
      amountTendered: details?.amountTendered, customerName, restaurantName: restaurant?.name, logoUrl: restaurant?.logoUrl ?? undefined,
      restaurantAddress: [restaurant?.address, restaurant?.city].filter(Boolean).join(", ") || undefined,
      restaurantPhone: restaurant?.phone ?? undefined,
      createdAt: placedOrder?.createdAt,
    });
    handleNewOrder();
  };

  const handleVoid = async () => {
    if (!placedOrder) { handleNewOrder(); return; }
    if (!confirm("Void this order? This cannot be undone.")) return;
    try {
      await voidOrder.mutateAsync(placedOrder.id);
      toast({ title: "Order voided" });
      handleNewOrder();
    } catch {
      toast({ title: "Failed to void order", variant: "destructive" });
    }
  };

  const handleNewOrder = () => {
    setCart([]); setDiscount(""); setCustomerName("");
    setCustomerPhone(""); setPhoneQuery(""); setLinkedCustomerId(null); setLoyaltyRedeem(""); setCouponInput("");
    setSelectedTableId(null); setPlacedOrder(null);
    setShowPayModal(false); setShowSplitModal(false);
  };

  // Receipt items for modals (works pre and post placement)
  const receiptDisplayItems = placedOrder
    ? liveItems.map(oi => ({ name: oi.menuItemName, unitPrice: Number(oi.unitPrice), quantity: oi.quantity, modifiers: [] as CartModifier[] }))
    : cart.map(c => ({ name: c.name, unitPrice: c.unitPrice, quantity: c.quantity, modifiers: c.modifiers }));

  return (
    <Layout>
      <div className="flex h-[calc(100vh-0px)] overflow-hidden bg-background">

        {/* Left panel */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Table grid */}
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
                {tableActiveOrder && !placedOrder && (
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
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-green-500" />Free</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-orange-500" />Occupied</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-blue-500" />Reserved</span>
                </div>
              </div>
            )}
          </div>

          {/* Order type + customer name */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0 flex-wrap">
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
            <Input
              className="h-8 text-xs flex-1 min-w-32 max-w-48 ml-auto"
              placeholder="Customer name (optional)"
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              disabled={!!placedOrder}
            />
          </div>

          {/* Customer phone lookup for loyalty */}
          {!placedOrder && !linkedCustomerId && (
            <div className="flex gap-1.5 px-4 pb-2">
              <Input
                className="h-7 text-xs flex-1"
                placeholder="Phone to link loyalty (optional)"
                value={customerPhone}
                onChange={e => { setCustomerPhone(e.target.value); setPhoneQuery(e.target.value); }}
              />
              <Button size="sm" variant="outline" className="h-7 text-xs px-2 flex-shrink-0" onClick={handleLinkCustomer} disabled={!foundCustomer}>
                <UserCheck className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
          {linkedCustomerId && (
            <div className="flex items-center gap-1.5 px-4 pb-2 text-xs text-primary">
              <Star className="w-3.5 h-3.5 fill-primary" />
              <span className="font-medium">{customerName}</span>
              <span className="text-muted-foreground">· {loyaltyAccount?.balance ?? 0} pts available</span>
              {!placedOrder && (
                <button onClick={() => { setLinkedCustomerId(null); setCustomerPhone(""); setPhoneQuery(""); }} className="ml-auto text-muted-foreground hover:text-destructive">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* Category filter */}
          <div className="flex gap-1.5 px-4 py-2 border-b border-border overflow-x-auto flex-shrink-0">
            <Button size="sm" variant={!selectedCat ? "default" : "outline"} onClick={() => setSelectedCat(undefined)} className="flex-shrink-0 h-7 text-xs px-3">All</Button>
            {(categories as MenuCategory[]).map(c => (
              <Button key={c.id} size="sm" variant={selectedCat === c.id ? "default" : "outline"} onClick={() => setSelectedCat(c.id)} className="flex-shrink-0 h-7 text-xs px-3 whitespace-nowrap">
                {c.name}
              </Button>
            ))}
          </div>

          {/* Menu grid */}
          <div className="flex-1 overflow-y-auto p-3">
            {placedOrder && (
              <div className="mb-3 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-blue-700 dark:text-blue-400 flex items-center gap-2">
                <Plus className="w-3.5 h-3.5 flex-shrink-0" />
                Tap items to add more to this order
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {(menuItems as MenuItem[]).filter(i => i.isAvailable).map(item => {
                const inCart = cart.find(c => c.menuItemId === item.id);
                const inLive = placedOrder ? liveItems.some(li => li.menuItemId === item.id) : false;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleMenuItemClick(item)}
                    className={cn(
                      "group relative text-left p-3 rounded-xl border-2 transition-all duration-150 active:scale-[0.98] hover:shadow-md hover:-translate-y-0.5",
                      (inCart || inLive)
                        ? "border-primary bg-gradient-to-br from-primary/10 to-primary/5 shadow-sm shadow-primary/20"
                        : "border-border hover:border-primary/50 hover:bg-accent/40"
                    )}
                  >
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <p className="text-sm font-medium leading-tight line-clamp-2 flex-1">{item.name}</p>
                      <span className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5", item.isVeg ? "bg-green-500" : "bg-red-500")} />
                    </div>
                    <span className="inline-flex items-center text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full ring-1 ring-primary/20">₹{item.price}</span>
                    {(inCart || inLive) && (
                      <div className="absolute top-2 right-2 bg-primary text-primary-foreground text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold shadow">
                        {inCart?.quantity ?? liveItems.filter(li => li.menuItemId === item.id).reduce((s, li) => s + li.quantity, 0)}
                      </div>
                    )}
                  </button>
                );
              })}
              {menuItems.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <ShoppingBag className="w-12 h-12 mb-3 opacity-20" />
                  <p className="text-sm">No items found</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right panel — Order ticket */}
        <div className="w-80 xl:w-96 flex-shrink-0 flex flex-col bg-card border-l border-border shadow-[-4px_0_16px_-8px_hsl(0_0%_0%/0.08)]">

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
              <p className="text-xs font-semibold text-green-700 dark:text-green-400">{placedOrder.orderNumber} — placed</p>
              <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">Kitchen notified · Tap menu items to add more</p>
            </div>
          )}

          {/* Item list */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
            {!placedOrder && cart.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground pb-12">
                <ShoppingBag className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm font-medium">Cart is empty</p>
                <p className="text-xs mt-1 opacity-60">Tap items from the menu</p>
              </div>
            )}

            {/* Pre-placement: local cart items */}
            {!placedOrder && cart.map(item => (
              <div key={item.lineKey} className="flex items-start gap-2 py-2 border-b border-border/40 last:border-0">
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
                  <button onClick={() => updateQty(item.lineKey, item.quantity - 1)} className="w-6 h-6 rounded bg-secondary hover:bg-red-100 hover:text-red-600 flex items-center justify-center transition-colors"><Minus className="w-3 h-3" /></button>
                  <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                  <button onClick={() => updateQty(item.lineKey, item.quantity + 1)} className="w-6 h-6 rounded bg-secondary hover:bg-primary/10 hover:text-primary flex items-center justify-center transition-colors"><Plus className="w-3 h-3" /></button>
                  <button onClick={() => removeFromCart(item.lineKey)} className="w-6 h-6 rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors ml-0.5"><X className="w-3 h-3" /></button>
                </div>
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
            <div className="sticky bottom-0 border-t border-border px-4 py-4 space-y-3 flex-shrink-0 bg-card/80 backdrop-blur-md shadow-[0_-4px_12px_-4px_hsl(0_0%_0%/0.08)]">
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <Input
                  type="number"
                  placeholder="Discount (₹)"
                  value={discount}
                  onChange={e => setDiscount(e.target.value)}
                  onBlur={handleDiscountBlur}
                  className="h-8 text-sm"
                  min="0"
                />
              </div>

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

              {placedOrder && (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="flex-1 text-xs text-muted-foreground" onClick={() => {
                    printReceipt({
                      orderNumber: placedOrder.orderNumber,
                      tableLabel: selectedTable ? `Table ${selectedTable.tableNumber}` : "",
                      orderType, items: receiptDisplayItems, totals: displayTotals,
                      paymentMethod: "pending", customerName, restaurantName: restaurant?.name, logoUrl: restaurant?.logoUrl ?? undefined,
                      restaurantAddress: [restaurant?.address, restaurant?.city].filter(Boolean).join(", ") || undefined,
                      restaurantPhone: restaurant?.phone ?? undefined,
                      createdAt: placedOrder.createdAt,
                    });
                  }}>
                    <Printer className="w-3 h-3 mr-1" />Print KOT
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
          isPending={payOrder.isPending}
        />
      )}

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
          orderNumber={placedOrder.orderNumber}
          tableLabel={selectedTable ? `Table ${selectedTable.tableNumber}` : ""}
          orderType={orderType}
          customerName={customerName}
          orderCreatedAt={placedOrder.createdAt}
          onClose={() => setShowSplitModal(false)}
          onComplete={handleNewOrder}
        />
      )}
    </Layout>
  );
}
