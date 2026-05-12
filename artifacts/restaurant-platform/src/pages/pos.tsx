import { useState, useCallback, useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import {
  useFloorTables, useMenus, useMenuCategories, useMenuItems,
  useCreateOrder, usePayOrder, useVoidOrder, useOrders,
  useRestaurantInfo, useItemModifierGroups, useSplitOrder,
  useOrderDetail,
} from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { FloorTable, MenuItem, MenuCategory, Order, PosModifierGroup, OrderDetail } from "@/lib/types";
import {
  ShoppingBag, CreditCard, Banknote, Smartphone, Printer,
  Trash2, Plus, Minus, Tag, ChevronDown, ChevronUp, X,
  Utensils, Package, Bike, ReceiptText, AlertTriangle, Scissors,
  Loader2, Check,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CartModifier {
  name: string;
  price: number;
}

interface CartItem {
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

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Receipt Printer ──────────────────────────────────────────────────────────

function printReceipt({
  orderNumber, tableLabel, orderType, cart, totals,
  paymentMethod, amountTendered, customerName, restaurantName,
  splitIndex, splitTotal,
}: {
  orderNumber: string; tableLabel: string; orderType: string; cart: CartItem[];
  totals: Totals; paymentMethod: string; amountTendered?: number;
  customerName?: string; restaurantName?: string;
  splitIndex?: number; splitTotal?: number;
}) {
  const change = amountTendered ? Math.max(0, amountTendered - (splitTotal ?? totals.totalAmount)) : 0;
  const displayTotal = splitTotal ?? totals.totalAmount;
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
</style></head>
<body>
<div class="center">
  <h1>${restaurantName ?? "TableTrack"}</h1>
  <div class="sm">POS Receipt</div>
</div>
<div class="dash"></div>
<div class="center">
  <div class="bold">${orderNumber}${splitIndex !== undefined ? ` (Split ${splitIndex + 1})` : ""}</div>
  <div class="sm">${new Date().toLocaleString("en-IN")}</div>
  <div class="sm">${tableLabel || orderType.replace("_", "-").toUpperCase()}</div>
  ${customerName ? `<div class="sm">Customer: ${customerName}</div>` : ""}
</div>
<div class="dash"></div>
<div class="sm bold row"><span>ITEM</span><span>AMT</span></div>
<div class="dash"></div>
${cart.map(item => `
<div class="row"><span class="sm">${item.name} ×${item.quantity}</span><span class="sm">₹${(item.unitPrice * item.quantity).toFixed(2)}</span></div>
${item.modifiers.map(m => `<div class="sm" style="color:#666;margin-left:6px">+ ${m.name}: ₹${m.price.toFixed(2)}</div>`).join("")}
`).join("")}
<div class="dash"></div>
<div class="row"><span class="sm">Subtotal</span><span class="sm">₹${totals.subtotal.toFixed(2)}</span></div>
<div class="row"><span class="sm">Tax</span><span class="sm">₹${totals.taxAmount.toFixed(2)}</span></div>
${totals.serviceCharge > 0 ? `<div class="row"><span class="sm">Service Charge</span><span class="sm">₹${totals.serviceCharge.toFixed(2)}</span></div>` : ""}
${totals.discountAmount > 0 ? `<div class="row"><span class="sm">Discount</span><span class="sm">-₹${totals.discountAmount.toFixed(2)}</span></div>` : ""}
<div class="dash"></div>
<div class="row total-row"><span>${splitIndex !== undefined ? "YOUR SHARE" : "TOTAL"}</span><span>₹${displayTotal.toFixed(2)}</span></div>
<div class="dash"></div>
<div class="row sm"><span>Payment</span><span>${paymentMethod.toUpperCase()}</span></div>
${amountTendered ? `<div class="row sm"><span>Tendered</span><span>₹${amountTendered.toFixed(2)}</span></div>` : ""}
${change > 0 ? `<div class="row bold sm"><span>Change</span><span>₹${change.toFixed(2)}</span></div>` : ""}
<div class="dash"></div>
<div class="center sm">Thank you for dining with us!</div>
</body></html>`;
  const w = window.open("", "_blank", "width=340,height=700");
  if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 400); }
}

// ─── Modifier Picker Modal ─────────────────────────────────────────────────────

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
  }, [isLoading, groups.length]);

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
    [...(selected[group.id] ?? [])].map(modId => {
      const mod = group.modifiers.find(m => m.id === modId);
      return mod ? { name: mod.name, price: Number(mod.price) } : null;
    }).filter(Boolean) as CartModifier[]
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
            <p className="text-xs text-muted-foreground">Base: ₹{item.price}{modTotal > 0 ? ` + ₹${modTotal.toFixed(2)} modifiers` : ""}</p>
          </div>
          <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {groups.map(group => (
            <div key={group.id}>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-sm font-semibold text-foreground">{group.name}</p>
                {group.isRequired && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">Required</span>}
                {group.maxSelections > 1 && <span className="text-xs text-muted-foreground">Pick up to {group.maxSelections}</span>}
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
                        <div className={cn("w-4 h-4 rounded flex items-center justify-center border-2 flex-shrink-0",
                          isSelected ? "bg-primary border-primary" : "border-border"
                        )}>
                          {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        {mod.name}
                      </span>
                      {Number(mod.price) > 0 && <span className="text-primary font-medium">+₹{mod.price}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 pb-5 flex-shrink-0 border-t border-border pt-4">
          <Button
            className="w-full"
            disabled={!canConfirm}
            onClick={() => onConfirm(item, selectedModifiers)}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add to Order · ₹{(Number(item.price) + modTotal).toFixed(2)}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Split Bill Modal ──────────────────────────────────────────────────────────

function SplitBillModal({
  totalAmount, cart, placedOrderId, restaurantName, orderNumber, tableLabel, orderType, customerName, totals,
  onClose, onComplete,
}: {
  totalAmount: number; cart: CartItem[]; placedOrderId: number;
  restaurantName?: string; orderNumber: string; tableLabel: string;
  orderType: string; customerName?: string; totals: Totals;
  onClose: () => void; onComplete: () => void;
}) {
  const [splitCount, setSplitCount] = useState(2);
  const [methods, setMethods] = useState<string[]>(["cash", "cash"]);
  const [tenderAmounts, setTenderAmounts] = useState<string[]>(["", ""]);
  const [confirmedSplits, setConfirmedSplits] = useState<boolean[]>([false, false]);
  const splitOrder = useSplitOrder();
  const { toast } = useToast();

  const perPerson = totalAmount / splitCount;

  const updateCount = (n: number) => {
    const newCount = Math.max(2, Math.min(10, n));
    setSplitCount(newCount);
    setMethods(Array.from({ length: newCount }, (_, i) => methods[i] ?? "cash"));
    setTenderAmounts(Array.from({ length: newCount }, (_, i) => tenderAmounts[i] ?? ""));
    setConfirmedSplits(Array.from({ length: newCount }, (_, i) => confirmedSplits[i] ?? false));
  };

  const confirmSplit = (idx: number) => {
    const newConfirmed = [...confirmedSplits];
    newConfirmed[idx] = true;
    setConfirmedSplits(newConfirmed);
    printReceipt({
      orderNumber, tableLabel, orderType, cart, totals,
      paymentMethod: methods[idx],
      amountTendered: methods[idx] === "cash" && tenderAmounts[idx] ? Number(tenderAmounts[idx]) : undefined,
      customerName, restaurantName,
      splitIndex: idx, splitTotal: perPerson,
    });
  };

  const handleFinalize = async () => {
    try {
      await splitOrder.mutateAsync({
        orderId: placedOrderId,
        splits: methods.map(m => ({ paymentMethod: m })),
      });
      toast({ title: "Split payment complete!", description: `${splitCount} payments processed.` });
      onComplete();
    } catch {
      toast({ title: "Failed to finalize split", variant: "destructive" });
    }
  };

  const allConfirmed = confirmedSplits.every(Boolean);

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
            <span className="text-sm font-medium text-foreground">Total: ₹{totalAmount.toFixed(2)}</span>
            <span className="text-sm text-muted-foreground">Per person: ₹{perPerson.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <span className="text-sm text-foreground">Split between</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="w-8 h-8 p-0" onClick={() => updateCount(splitCount - 1)}><Minus className="w-3 h-3" /></Button>
              <span className="w-8 text-center font-bold text-lg">{splitCount}</span>
              <Button size="sm" variant="outline" className="w-8 h-8 p-0" onClick={() => updateCount(splitCount + 1)}><Plus className="w-3 h-3" /></Button>
            </div>
            <span className="text-sm text-foreground">people</span>
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
                      <button key={value} onClick={() => { const m = [...methods]; m[idx] = value; setMethods(m); }}
                        className={cn("flex flex-col items-center gap-1 py-2 rounded-lg border-2 text-xs font-medium transition-all",
                          methods[idx] === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40")}>
                        <Icon className="w-4 h-4" />{label}
                      </button>
                    ))}
                  </div>
                  {methods[idx] === "cash" && (
                    <Input type="number" placeholder={`₹${perPerson.toFixed(2)}`}
                      value={tenderAmounts[idx]}
                      onChange={e => { const t = [...tenderAmounts]; t[idx] = e.target.value; setTenderAmounts(t); }}
                      className="h-8 text-sm mb-2" />
                  )}
                  {methods[idx] === "cash" && tenderAmounts[idx] && Number(tenderAmounts[idx]) > perPerson && (
                    <div className="text-xs text-green-600 font-medium mb-2">
                      Change: ₹{(Number(tenderAmounts[idx]) - perPerson).toFixed(2)}
                    </div>
                  )}
                  <Button size="sm" className="w-full" onClick={() => confirmSplit(idx)}>
                    <CreditCard className="w-3.5 h-3.5 mr-1.5" /> Confirm & Print Receipt
                  </Button>
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
          <Button className="w-full" disabled={!allConfirmed || splitOrder.isPending} onClick={handleFinalize}>
            <Check className="w-4 h-4 mr-2" />
            Finalize Split Payment
          </Button>
          {!allConfirmed && <p className="text-xs text-muted-foreground text-center mt-2">Confirm all {splitCount} payments first</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Payment Modal ─────────────────────────────────────────────────────────────

function PaymentModal({
  cart, totals, onClose, onConfirm, isPending,
}: {
  cart: CartItem[]; totals: Totals;
  onClose: () => void;
  onConfirm: (method: string, amountTendered?: number) => void;
  isPending: boolean;
}) {
  const [method, setMethod] = useState("cash");
  const [amountTendered, setAmountTendered] = useState("");
  const change = method === "cash" && amountTendered ? Math.max(0, Number(amountTendered) - totals.totalAmount) : 0;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" /> Process Payment
          </h2>
          <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        <div className="p-6 space-y-5">
          <div className="bg-muted/60 rounded-xl p-4 space-y-1.5 border border-border">
            {cart.map(item => (
              <div key={item.menuItemId} className="text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground truncate mr-2">{item.name} × {item.quantity}</span>
                  <span className="flex-shrink-0">₹{(item.unitPrice * item.quantity).toFixed(2)}</span>
                </div>
                {item.modifiers.map((m, i) => (
                  <div key={i} className="text-xs text-muted-foreground/70 ml-3">+ {m.name} ₹{m.price.toFixed(2)}</div>
                ))}
              </div>
            ))}
            <div className="border-t border-border mt-2 pt-2 space-y-1">
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
              <div className="flex justify-between font-bold text-xl border-t border-border pt-2 mt-1">
                <span>Total</span><span className="text-primary">₹{totals.totalAmount.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">Payment Method</label>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map(({ value, label, icon: Icon }) => (
                <button key={value} onClick={() => setMethod(value)}
                  className={cn("flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 text-sm font-medium transition-all",
                    method === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50")}>
                  <Icon className="w-5 h-5" />{label}
                </button>
              ))}
            </div>
          </div>

          {method === "cash" && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Amount Tendered</label>
              <Input type="number" placeholder={`₹${totals.totalAmount.toFixed(2)}`}
                value={amountTendered} onChange={e => setAmountTendered(e.target.value)}
                className="text-base font-mono" autoFocus />
              {change > 0 && (
                <div className="bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded-lg px-4 py-2 flex justify-between">
                  <span className="text-green-700 dark:text-green-400 font-medium">Change</span>
                  <span className="text-green-700 dark:text-green-400 font-bold text-xl">₹{change.toFixed(2)}</span>
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                {[100, 200, 500, 1000, 2000].map(amt => (
                  <Button key={amt} size="sm" variant="outline" className="text-xs h-7" onClick={() => setAmountTendered(String(amt))}>₹{amt}</Button>
                ))}
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setAmountTendered(totals.totalAmount.toFixed(2))}>Exact</Button>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 pb-6">
          <Button className="w-full h-12 text-base font-semibold" disabled={isPending}
            onClick={() => onConfirm(method, method === "cash" && amountTendered ? Number(amountTendered) : undefined)}>
            <CreditCard className="w-4 h-4 mr-2" />
            Confirm Payment · ₹{totals.totalAmount.toFixed(2)}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main POS Page ─────────────────────────────────────────────────────────────

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
  const [showPayModal, setShowPayModal] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [showTableGrid, setShowTableGrid] = useState(true);
  const [placedOrder, setPlacedOrder] = useState<OrderDetail | null>(null);
  const [modPickerItem, setModPickerItem] = useState<MenuItem | null>(null);

  const createOrder = useCreateOrder();
  const payOrder = usePayOrder();
  const voidOrder = useVoidOrder();
  const { toast } = useToast();

  const { data: modifierGroups = [], isLoading: modGroupsLoading } = useItemModifierGroups(modPickerItem?.id);

  // Table resume: load existing active order when occupied table is selected
  const tableActiveOrder = selectedTableId ? activeOrders.find(o => o.tableId === selectedTableId) : null;
  const { data: tableOrderDetail } = useOrderDetail(tableActiveOrder?.id);

  useEffect(() => {
    if (tableOrderDetail && !placedOrder) {
      const resumedCart: CartItem[] = tableOrderDetail.items.map(oi => ({
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

  // Local estimate totals (before order placement)
  const discountAmount = Number(discount) || 0;
  const localSubtotal = cart.reduce((s, c) => s + c.unitPrice * c.quantity, 0);
  const localTaxAmount = localSubtotal * taxRate;
  const localServiceCharge = localSubtotal * serviceRate;
  const localTotal = Math.max(0, localSubtotal + localTaxAmount + localServiceCharge - discountAmount);

  // Server-accurate totals (after order placement)
  const serverTotals: Totals | null = placedOrder ? {
    subtotal: Number(placedOrder.subtotal),
    taxAmount: Number(placedOrder.taxAmount),
    serviceCharge: Number(placedOrder.serviceCharge),
    discountAmount: Number(placedOrder.discountAmount),
    totalAmount: Number(placedOrder.totalAmount),
  } : null;

  // Use server totals when available, fall back to local estimate
  const displayTotals: Totals = serverTotals ?? {
    subtotal: localSubtotal,
    taxAmount: localTaxAmount,
    serviceCharge: localServiceCharge,
    discountAmount,
    totalAmount: localTotal,
  };

  const addToCartWithModifiers = useCallback((item: MenuItem, modifiers: CartModifier[]) => {
    const unitPrice = Number(item.price) + modifiers.reduce((s, m) => s + m.price, 0);
    setCart(prev => {
      const existing = prev.find(c => c.menuItemId === item.id && JSON.stringify(c.modifiers) === JSON.stringify(modifiers));
      if (existing) return prev.map(c =>
        c.menuItemId === item.id && JSON.stringify(c.modifiers) === JSON.stringify(modifiers)
          ? { ...c, quantity: c.quantity + 1 }
          : c
      );
      return [...prev, { menuItemId: item.id, name: item.name, basePrice: Number(item.price), modifiers, unitPrice, quantity: 1 }];
    });
    setModPickerItem(null);
  }, []);

  const handleMenuItemClick = useCallback((item: MenuItem) => {
    if (placedOrder) {
      toast({ title: "Order already placed", description: "Void the order to add new items, or pay to complete." });
      return;
    }
    setModPickerItem(item);
  }, [placedOrder, toast]);

  const updateQty = useCallback((menuItemId: number, qty: number) => {
    if (qty <= 0) setCart(prev => prev.filter(c => c.menuItemId !== menuItemId));
    else setCart(prev => prev.map(c => c.menuItemId === menuItemId ? { ...c, quantity: qty } : c));
  }, []);

  const removeFromCart = useCallback((menuItemId: number) => {
    setCart(prev => prev.filter(c => c.menuItemId !== menuItemId));
  }, []);

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
    if (cart.length === 0) { toast({ title: "Cart is empty", variant: "destructive" }); return; }
    let order = placedOrder;
    if (!order) { order = await handlePlaceOrder(); if (!order) return; }
    setShowPayModal(true);
  };

  const handleConfirmPayment = async (method: string, amountTendered?: number) => {
    const orderId = placedOrder?.id;
    if (!orderId) return;
    try {
      await payOrder.mutateAsync({ id: orderId, paymentMethod: method });
      setShowPayModal(false);
      toast({ title: "Payment confirmed!", description: `${placedOrder?.orderNumber} marked as paid.` });
      printReceipt({
        orderNumber: placedOrder?.orderNumber ?? "",
        tableLabel: selectedTable ? `Table ${selectedTable.tableNumber}` : "",
        orderType,
        cart,
        totals: displayTotals,
        paymentMethod: method,
        amountTendered,
        customerName,
        restaurantName: restaurant?.name,
      });
      handleNewOrder();
    } catch {
      toast({ title: "Payment failed", variant: "destructive" });
    }
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
    setSelectedTableId(null); setPlacedOrder(null);
    setShowPayModal(false); setShowSplitModal(false);
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
                  {tables.length === 0 && <p className="col-span-full text-xs text-muted-foreground py-2 text-center">No tables configured</p>}
                </div>
                <div className="flex gap-4 mt-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-green-500" />Free</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-orange-500" />Occupied</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-blue-500" />Reserved</span>
                </div>
              </div>
            )}
          </div>

          {/* Order Type + Customer */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0 flex-wrap">
            {ORDER_TYPES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => { setOrderType(value); if (value !== "dine_in") setSelectedTableId(null); }}
                disabled={!!placedOrder}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex-shrink-0",
                  orderType === value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50",
                  placedOrder && "opacity-50 cursor-not-allowed"
                )}
              >
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
            <Input className="h-8 text-xs flex-1 min-w-32 max-w-48 ml-auto"
              placeholder="Customer name (optional)"
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              disabled={!!placedOrder} />
          </div>

          {/* Category Filter */}
          <div className="flex gap-1.5 px-4 py-2 border-b border-border overflow-x-auto flex-shrink-0">
            <Button size="sm" variant={!selectedCat ? "default" : "outline"} onClick={() => setSelectedCat(undefined)} className="flex-shrink-0 h-7 text-xs px-3">All</Button>
            {(categories as MenuCategory[]).map(c => (
              <Button key={c.id} size="sm" variant={selectedCat === c.id ? "default" : "outline"} onClick={() => setSelectedCat(c.id)} className="flex-shrink-0 h-7 text-xs px-3 whitespace-nowrap">{c.name}</Button>
            ))}
          </div>

          {/* Menu Grid */}
          <div className="flex-1 overflow-y-auto p-3">
            {placedOrder && (
              <div className="mb-3 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
                <ReceiptText className="w-3.5 h-3.5 flex-shrink-0" />
                Order placed — pay, split, or void to start a new one
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {(menuItems as MenuItem[]).filter(i => i.isAvailable).map(item => {
                const inCart = cart.find(c => c.menuItemId === item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => handleMenuItemClick(item)}
                    className={cn(
                      "relative text-left p-3 rounded-xl border-2 transition-all hover:shadow-sm",
                      inCart ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent"
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
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL — Order Ticket ── */}
        <div className="w-80 xl:w-96 flex-shrink-0 flex flex-col bg-card border-l border-border">

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
              <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">Kitchen notified · Ready for payment</p>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground pb-12">
                <ShoppingBag className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm font-medium">Cart is empty</p>
                <p className="text-xs mt-1 opacity-60">Tap items from the menu</p>
              </div>
            ) : (
              cart.map((item, i) => (
                <div key={`${item.menuItemId}-${i}`} className="flex items-start gap-2 py-2 border-b border-border/40 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    {item.modifiers.length > 0 && (
                      <p className="text-xs text-muted-foreground/70 truncate">
                        {item.modifiers.map(m => m.name).join(", ")}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      ₹{item.unitPrice.toFixed(2)} × {item.quantity} = <span className="font-medium text-foreground">₹{(item.unitPrice * item.quantity).toFixed(2)}</span>
                    </p>
                  </div>
                  {!placedOrder && (
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button onClick={() => updateQty(item.menuItemId, item.quantity - 1)} className="w-6 h-6 rounded bg-secondary hover:bg-red-100 hover:text-red-600 flex items-center justify-center transition-colors"><Minus className="w-3 h-3" /></button>
                      <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                      <button onClick={() => updateQty(item.menuItemId, item.quantity + 1)} className="w-6 h-6 rounded bg-secondary hover:bg-primary/10 hover:text-primary flex items-center justify-center transition-colors"><Plus className="w-3 h-3" /></button>
                      <button onClick={() => removeFromCart(item.menuItemId)} className="w-6 h-6 rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors ml-0.5"><X className="w-3 h-3" /></button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {cart.length > 0 && (
            <div className="border-t border-border px-4 py-4 space-y-3 flex-shrink-0">
              {!placedOrder && (
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <Input type="number" placeholder="Discount (₹)" value={discount}
                    onChange={e => setDiscount(e.target.value)} className="h-8 text-sm" min="0" />
                </div>
              )}

              <div className="space-y-1">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Subtotal ({cart.reduce((s, c) => s + c.quantity, 0)} items)</span>
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
                    <Button variant="outline" size="sm" disabled={createOrder.isPending} onClick={handlePlaceOrder}>Place Order</Button>
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
                      orderNumber: placedOrder.orderNumber, tableLabel: selectedTable ? `Table ${selectedTable.tableNumber}` : "",
                      orderType, cart, totals: displayTotals, paymentMethod: "pending",
                      customerName, restaurantName: restaurant?.name,
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

      {/* Modifier Picker Modal */}
      {modPickerItem && (
        <ModifierPickerModal
          item={modPickerItem}
          groups={modifierGroups}
          isLoading={modGroupsLoading}
          onConfirm={addToCartWithModifiers}
          onClose={() => setModPickerItem(null)}
        />
      )}

      {/* Payment Modal */}
      {showPayModal && (
        <PaymentModal
          cart={cart}
          totals={displayTotals}
          onClose={() => setShowPayModal(false)}
          onConfirm={handleConfirmPayment}
          isPending={payOrder.isPending}
        />
      )}

      {/* Split Bill Modal */}
      {showSplitModal && placedOrder && (
        <SplitBillModal
          totalAmount={displayTotals.totalAmount}
          cart={cart}
          placedOrderId={placedOrder.id}
          restaurantName={restaurant?.name}
          orderNumber={placedOrder.orderNumber}
          tableLabel={selectedTable ? `Table ${selectedTable.tableNumber}` : ""}
          orderType={orderType}
          customerName={customerName}
          totals={displayTotals}
          onClose={() => setShowSplitModal(false)}
          onComplete={handleNewOrder}
        />
      )}
    </Layout>
  );
}
