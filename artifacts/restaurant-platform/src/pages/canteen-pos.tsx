import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanLine, Trash2, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { usePosLookup, usePlacePosOrder, rupees } from "@/lib/canteen";
import { useMenuItems, useMenuCategories } from "@/lib/hooks";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Line { menuItemId: number; name: string; unitPaise: number; categoryId: number; quantity: number }

export default function CanteenPosPage() {
  const [qrInput, setQrInput] = useState("");
  const [scannedQr, setScannedQr] = useState<string | null>(null);
  const [paymentSource, setPaymentSource] = useState<"wallet" | "cash">("wallet");
  const [counterName, setCounterName] = useState("Counter 1");
  const [lines, setLines] = useState<Line[]>([]);
  const [selectedCat, setSelectedCat] = useState<number | undefined>(undefined);

  const { data: lookup, error: lookupErr, isLoading: looking } = usePosLookup(scannedQr);
  const { data: items = [] } = useMenuItems();
  const { data: cats = [] } = useMenuCategories();
  const place = usePlacePosOrder();

  const blockedItems = new Set(lookup?.blockedItemIds ?? []);
  const blockedCats = new Set(lookup?.blockedCategoryIds ?? []);

  const total = useMemo(() => lines.reduce((s, l) => s + l.unitPaise * l.quantity, 0), [lines]);

  const dailyOk = paymentSource === "cash" || lookup?.remainingDaily == null || lookup.remainingDaily >= total;
  const balanceOk = paymentSource === "cash" || (lookup?.student.balance ?? 0) >= total;

  const scan = () => {
    if (!qrInput.trim()) return;
    setScannedQr(qrInput.trim());
    setLines([]);
  };

  const addItem = (m: { id: number; name: string; price: string; categoryId: number }) => {
    const unitPaise = Math.round(parseFloat(m.price) * 100);
    setLines(prev => {
      const ex = prev.find(l => l.menuItemId === m.id);
      if (ex) return prev.map(l => l === ex ? { ...l, quantity: l.quantity + 1 } : l);
      return [...prev, { menuItemId: m.id, name: m.name, unitPaise, categoryId: m.categoryId, quantity: 1 }];
    });
  };

  const submit = async () => {
    if (!lookup || lines.length === 0) return;
    try {
      const res = await place.mutateAsync({
        studentId: lookup.student.id,
        paymentSource, counterName,
        items: lines.map(l => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
      });
      toast({ title: `Order ${res.order.orderNumber} placed`, description: `New balance ${rupees(res.balance)}` });
      setLines([]); setScannedQr(null); setQrInput("");
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message });
    }
  };

  const visibleItems = items.filter(i => i.isAvailable && (selectedCat == null || i.categoryId === selectedCat));

  return (
    <Layout>
      <div className="flex flex-1 min-h-0 overflow-hidden bg-background">
        {/* Left panel: scanner / student card + category strip + menu */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="px-4 py-3 border-b border-border flex-shrink-0">
            <h1 className="text-lg font-semibold text-foreground">Canteen Counter POS</h1>
            <p className="text-xs text-muted-foreground">Scan student ID-card QR, build order, debit wallet.</p>
          </div>

          {/* Scanner + student card */}
          <div className="px-4 py-3 border-b border-border flex-shrink-0 bg-background space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Scan or paste QR token" value={qrInput} onChange={e => setQrInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && scan()} autoFocus data-testid="input-qr" className="h-8 text-sm" />
              <Button size="sm" onClick={scan}><ScanLine className="w-4 h-4 mr-1" />Scan</Button>
            </div>
            {looking && <div className="text-xs text-muted-foreground">Looking up…</div>}
            {scannedQr && lookupErr && (
              <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-xs flex gap-2">
                <X className="w-4 h-4 mt-0.5" /> Student not found for this QR.
              </div>
            )}
            {lookup && (
              <div className="rounded-lg border border-border p-3">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-sm">{lookup.student.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {lookup.student.studentCode}
                      {lookup.student.className && ` · ${lookup.student.className}`}
                      {lookup.student.section && ` ${lookup.student.section}`}
                    </div>
                  </div>
                  {lookup.student.isFrozen && <span className="text-[10px] text-red-600 font-semibold">FROZEN</span>}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div className="bg-muted/40 rounded-md p-1.5">
                    <div className="text-[9px] uppercase text-muted-foreground">Balance</div>
                    <div className="font-bold text-xs">{rupees(lookup.student.balance)}</div>
                  </div>
                  <div className="bg-muted/40 rounded-md p-1.5">
                    <div className="text-[9px] uppercase text-muted-foreground">Today</div>
                    <div className="font-bold text-xs">{rupees(lookup.todaysSpend)}</div>
                  </div>
                  <div className="bg-muted/40 rounded-md p-1.5">
                    <div className="text-[9px] uppercase text-muted-foreground">Daily Cap</div>
                    <div className="font-bold text-xs">{lookup.dailyCap > 0 ? rupees(lookup.dailyCap) : "—"}</div>
                  </div>
                </div>
                {lookup.remainingDaily != null && (
                  <div className="text-[11px] text-muted-foreground mt-2">Remaining today: <span className="font-semibold">{rupees(lookup.remainingDaily)}</span></div>
                )}
                {(blockedItems.size > 0 || blockedCats.size > 0) && (
                  <div className="mt-1.5 text-[11px] text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Some items are restricted for this student.</div>
                )}
              </div>
            )}
          </div>

          {/* Category strip — horizontal scroll, no white seam */}
          <div className="border-b border-border flex-shrink-0 bg-background overflow-x-auto">
            <div className="flex gap-1.5 px-4 py-2 w-max min-w-full">
              <Button size="sm" variant={selectedCat == null ? "default" : "outline"} onClick={() => setSelectedCat(undefined)} className="flex-shrink-0 h-7 text-xs px-3">All</Button>
              {cats.map(c => (
                <Button
                  key={c.id}
                  size="sm"
                  variant={selectedCat === c.id ? "default" : "outline"}
                  onClick={() => setSelectedCat(c.id)}
                  className="flex-shrink-0 h-7 text-xs px-3 whitespace-nowrap"
                >
                  {c.name}{blockedCats.has(c.id) && <span className="text-red-600 ml-1">·restricted</span>}
                </Button>
              ))}
            </div>
          </div>

          {/* Menu grid — scrollable */}
          <div className="flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {visibleItems.map(it => {
                const blocked = blockedCats.has(it.categoryId) || blockedItems.has(it.id);
                return (
                  <button
                    key={it.id}
                    disabled={!lookup || blocked || lookup.student.isFrozen}
                    onClick={() => addItem(it)}
                    className={cn(
                      "text-left border border-border rounded-md p-2 text-sm hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed",
                      blocked && "bg-red-50",
                    )}
                    data-testid={`menu-${it.id}`}
                  >
                    <div className="font-medium truncate">{it.name}</div>
                    <div className="text-xs text-muted-foreground">{rupees(Math.round(parseFloat(it.price) * 100))}</div>
                  </button>
                );
              })}
              {visibleItems.length === 0 && <div className="col-span-full text-sm text-muted-foreground p-4">No items</div>}
            </div>
          </div>
        </div>

        {/* Right panel: cart with sticky checkout footer */}
        <div className="w-80 xl:w-96 flex-shrink-0 flex flex-col bg-card border-l border-border shadow-[-4px_0_16px_-8px_hsl(0_0%_0%/0.08)] min-h-0">
          <div className="px-5 py-4 border-b border-border flex-shrink-0">
            <h2 className="font-semibold text-foreground">Order</h2>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {lines.length === 0 && <div className="text-sm text-muted-foreground">No items yet. Tap items from the menu.</div>}
            {lines.map(l => (
              <div key={l.menuItemId} className="flex items-center gap-2 border-b border-border py-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{l.name}</div>
                  <div className="text-xs text-muted-foreground">{rupees(l.unitPaise)} × {l.quantity}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => setLines(p => p.map(x => x === l ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))}>−</Button>
                <span className="w-6 text-center">{l.quantity}</span>
                <Button size="sm" variant="outline" onClick={() => setLines(p => p.map(x => x === l ? { ...x, quantity: x.quantity + 1 } : x))}>+</Button>
                <Button size="sm" variant="ghost" onClick={() => setLines(p => p.filter(x => x !== l))}><Trash2 className="w-3 h-3" /></Button>
              </div>
            ))}
          </div>

          {/* Sticky checkout footer */}
          <div className="sticky bottom-0 z-50 border-t border-border px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-2 flex-shrink-0 bg-card shadow-[0_-4px_12px_-4px_hsl(0_0%_0%/0.08)]">
            <div className="flex justify-between text-lg font-bold"><span>Total</span><span>{rupees(total)}</span></div>
            <div className="flex gap-2">
              <select className="flex-1 border border-border rounded-md p-2 bg-background text-sm" value={paymentSource} onChange={e => setPaymentSource(e.target.value as "wallet" | "cash")}>
                <option value="wallet">Wallet</option><option value="cash">Cash</option>
              </select>
              <Input className="w-32" placeholder="Counter" value={counterName} onChange={e => setCounterName(e.target.value)} />
            </div>
            {!balanceOk && paymentSource === "wallet" && <div className="text-xs text-red-600 flex gap-1 items-center"><AlertTriangle className="w-3 h-3" />Insufficient balance.</div>}
            {!dailyOk && paymentSource === "wallet" && <div className="text-xs text-red-600 flex gap-1 items-center"><AlertTriangle className="w-3 h-3" />Exceeds daily cap.</div>}
            <Button className="w-full" disabled={!lookup || lines.length === 0 || !balanceOk || !dailyOk || place.isPending} onClick={submit} data-testid="button-place-order">
              <CheckCircle2 className="w-4 h-4 mr-1" />Place Order
            </Button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
