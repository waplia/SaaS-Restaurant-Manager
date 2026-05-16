import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanLine, Trash2, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { usePosLookup, usePlacePosOrder, rupees } from "@/lib/canteen";
import { useMenuItems, useMenuCategories } from "@/lib/hooks";
import { toast } from "@/hooks/use-toast";

interface Line { menuItemId: number; name: string; unitPaise: number; categoryId: number; quantity: number }

export default function CanteenPosPage() {
  const [qrInput, setQrInput] = useState("");
  const [scannedQr, setScannedQr] = useState<string | null>(null);
  const [paymentSource, setPaymentSource] = useState<"wallet" | "cash">("wallet");
  const [counterName, setCounterName] = useState("Counter 1");
  const [lines, setLines] = useState<Line[]>([]);

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

  return (
    <Layout>
      <PageHeader title="Canteen Counter POS" subtitle="Scan student ID-card QR, build order, debit wallet" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 m-6">
        {/* Left: scanner + student card */}
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex gap-2">
              <Input placeholder="Scan or paste QR token" value={qrInput} onChange={e => setQrInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && scan()} autoFocus data-testid="input-qr" />
              <Button onClick={scan}><ScanLine className="w-4 h-4 mr-1" />Scan</Button>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">Type or paste the QR string from the student ID card and press Enter.</div>
          </div>

          {looking && <div className="text-sm text-muted-foreground">Looking up…</div>}
          {scannedQr && lookupErr && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm flex gap-2">
              <X className="w-4 h-4 mt-0.5" /> Student not found for this QR.
            </div>
          )}

          {lookup && (
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold text-lg">{lookup.student.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {lookup.student.studentCode}
                    {lookup.student.className && ` · ${lookup.student.className}`}
                    {lookup.student.section && ` ${lookup.student.section}`}
                  </div>
                </div>
                {lookup.student.isFrozen && <span className="text-xs text-red-600 font-semibold">FROZEN</span>}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="bg-muted/40 rounded-md p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Balance</div>
                  <div className="font-bold">{rupees(lookup.student.balance)}</div>
                </div>
                <div className="bg-muted/40 rounded-md p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Today</div>
                  <div className="font-bold">{rupees(lookup.todaysSpend)}</div>
                </div>
                <div className="bg-muted/40 rounded-md p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Daily Cap</div>
                  <div className="font-bold">{lookup.dailyCap > 0 ? rupees(lookup.dailyCap) : "—"}</div>
                </div>
              </div>
              {lookup.remainingDaily != null && (
                <div className="text-xs text-muted-foreground mt-2">Remaining today: <span className="font-semibold">{rupees(lookup.remainingDaily)}</span></div>
              )}
              {(blockedItems.size > 0 || blockedCats.size > 0) && (
                <div className="mt-2 text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Some items are restricted for this student.</div>
              )}
            </div>
          )}
        </div>

        {/* Middle: menu */}
        <div className="bg-card border border-border rounded-xl p-4 max-h-[70vh] overflow-y-auto">
          <h3 className="font-semibold mb-3">Menu</h3>
          {cats.map(c => {
            const catItems = items.filter(i => i.categoryId === c.id && i.isAvailable);
            if (catItems.length === 0) return null;
            const catBlocked = blockedCats.has(c.id);
            return (
              <div key={c.id} className="mb-4">
                <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">{c.name}{catBlocked && <span className="text-red-600 ml-2">(restricted)</span>}</div>
                <div className="grid grid-cols-2 gap-2">
                  {catItems.map(it => {
                    const blocked = catBlocked || blockedItems.has(it.id);
                    return (
                      <button key={it.id}
                        disabled={!lookup || blocked || lookup.student.isFrozen}
                        onClick={() => addItem(it)}
                        className={`text-left border border-border rounded-md p-2 text-sm hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed ${blocked ? "bg-red-50" : ""}`}
                        data-testid={`menu-${it.id}`}>
                        <div className="font-medium truncate">{it.name}</div>
                        <div className="text-xs text-muted-foreground">{rupees(Math.round(parseFloat(it.price) * 100))}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: cart */}
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="font-semibold mb-3">Order</h3>
          {lines.length === 0 && <div className="text-sm text-muted-foreground">No items yet. Tap items from the menu.</div>}
          {lines.map(l => (
            <div key={l.menuItemId} className="flex items-center gap-2 border-b border-border py-2 text-sm">
              <div className="flex-1">
                <div className="font-medium">{l.name}</div>
                <div className="text-xs text-muted-foreground">{rupees(l.unitPaise)} × {l.quantity}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setLines(p => p.map(x => x === l ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))}>−</Button>
              <span className="w-6 text-center">{l.quantity}</span>
              <Button size="sm" variant="outline" onClick={() => setLines(p => p.map(x => x === l ? { ...x, quantity: x.quantity + 1 } : x))}>+</Button>
              <Button size="sm" variant="ghost" onClick={() => setLines(p => p.filter(x => x !== l))}><Trash2 className="w-3 h-3" /></Button>
            </div>
          ))}
          <div className="mt-4 pt-3 border-t border-border space-y-2">
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
