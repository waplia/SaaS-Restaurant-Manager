import { useState, useMemo } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Plus, Minus, Trash2, ShoppingCart } from "lucide-react";

interface VendorOpt { id: number; restaurantId: number; stallName: string; counterNumber: string | null; cuisineTags: string[] }
interface MenuOpt { id: number; restaurantId: number; name: string; price: string; categoryId: number | null; isAvailable: boolean }
interface MenuResp { vendors: VendorOpt[]; items: MenuOpt[] }
interface CartLine { vendorId: number; menuItemId: number; quantity: number; name: string; price: number; stall: string }

export default function FoodCourtPosPage() {
  const { id } = useParams<{ id: string }>();
  const fcId = Number(id);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<MenuResp>({
    queryKey: ["fc-menu", fcId],
    queryFn: () => apiGet(`/food-courts/${fcId}/menu`),
  });

  const [activeVendor, setActiveVendor] = useState<number | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [tableNumber, setTableNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "upi" | "gateway">("cash");

  const vendors = data?.vendors ?? [];
  const items = data?.items ?? [];
  const visibleVendor = activeVendor ?? vendors[0]?.id ?? null;
  const visibleItems = useMemo(() => {
    if (!visibleVendor) return [];
    const v = vendors.find(x => x.id === visibleVendor);
    if (!v) return [];
    return items.filter(i => i.restaurantId === v.restaurantId && i.isAvailable);
  }, [items, vendors, visibleVendor]);

  const addToCart = (item: MenuOpt) => {
    const v = vendors.find(x => x.restaurantId === item.restaurantId);
    if (!v) return;
    setCart(prev => {
      const ix = prev.findIndex(l => l.menuItemId === item.id && l.vendorId === v.id);
      if (ix >= 0) {
        const next = [...prev];
        next[ix] = { ...next[ix], quantity: next[ix].quantity + 1 };
        return next;
      }
      return [...prev, { vendorId: v.id, menuItemId: item.id, quantity: 1, name: item.name, price: Number(item.price), stall: v.stallName }];
    });
  };

  const setQty = (ix: number, delta: number) => {
    setCart(prev => {
      const next = [...prev];
      const newQty = next[ix].quantity + delta;
      if (newQty <= 0) return next.filter((_, i) => i !== ix);
      next[ix] = { ...next[ix], quantity: newQty };
      return next;
    });
  };

  const groupedCart = useMemo(() => {
    const map = new Map<number, { stall: string; lines: Array<{ ix: number; line: CartLine }>; subtotal: number }>();
    cart.forEach((line, ix) => {
      const g = map.get(line.vendorId) ?? { stall: line.stall, lines: [], subtotal: 0 };
      g.lines.push({ ix, line });
      g.subtotal += line.price * line.quantity;
      map.set(line.vendorId, g);
    });
    return Array.from(map.entries());
  }, [cart]);

  const cartTotal = cart.reduce((s, l) => s + l.price * l.quantity, 0);

  const checkout = useMutation({
    mutationFn: () => apiPost<{ id: number; token: string; parentOrderNumber: string }>(
      `/food-courts/${fcId}/orders`,
      {
        tableNumber: tableNumber || undefined,
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        paymentMethod,
        items: cart.map(l => ({ vendorId: l.vendorId, menuItemId: l.menuItemId, quantity: l.quantity })),
      }
    ),
    onSuccess: (r) => {
      toast({ title: `Order placed`, description: `Token ${r.token} • ${r.parentOrderNumber}` });
      setCart([]); setTableNumber(""); setCustomerName(""); setCustomerPhone("");
    },
    onError: (e: Error) => toast({ title: "Checkout failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Layout>
      <PageHeader title="Food Court POS" description="Common-billing counter — one cart, many vendors." />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          {isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> : (
            <>
              <div className="flex flex-wrap gap-2">
                {vendors.map(v => (
                  <Button
                    key={v.id}
                    variant={visibleVendor === v.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setActiveVendor(v.id)}
                    data-testid={`vendor-tab-${v.id}`}
                  >
                    {v.counterNumber ? `#${v.counterNumber} ` : ""}{v.stallName}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {visibleItems.map(it => (
                  <Card key={it.id} className="cursor-pointer hover:shadow" onClick={() => addToCart(it)} data-testid={`menu-${it.id}`}>
                    <CardContent className="p-3">
                      <div className="font-medium text-sm">{it.name}</div>
                      <div className="text-xs text-muted-foreground">₹{it.price}</div>
                    </CardContent>
                  </Card>
                ))}
                {visibleItems.length === 0 && <div className="col-span-3 text-sm text-muted-foreground p-4">No items</div>}
              </div>
            </>
          )}
        </div>
        <div className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ShoppingCart className="w-4 h-4" />Cart</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-72">
                {groupedCart.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Cart is empty</div>
                ) : groupedCart.map(([vendorId, g]) => (
                  <div key={vendorId} className="mb-3">
                    <div className="text-xs uppercase font-semibold text-muted-foreground mb-1">{g.stall}</div>
                    {g.lines.map(({ ix, line }) => (
                      <div key={ix} className="flex items-center justify-between text-sm py-1">
                        <span className="flex-1">{line.name}</span>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setQty(ix, -1)}><Minus className="w-3 h-3" /></Button>
                          <span className="w-6 text-center">{line.quantity}</span>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setQty(ix, 1)}><Plus className="w-3 h-3" /></Button>
                          <span className="w-16 text-right">₹{(line.price * line.quantity).toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                    <div className="text-right text-xs text-muted-foreground border-t pt-1">Subtotal ₹{g.subtotal.toFixed(2)}</div>
                  </div>
                ))}
              </ScrollArea>
              <div className="border-t pt-2 space-y-2">
                <div className="flex justify-between font-semibold"><span>Total</span><span>₹{cartTotal.toFixed(2)}</span></div>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Table" value={tableNumber} onChange={e => setTableNumber(e.target.value)} />
                  <Select value={paymentMethod} onValueChange={v => setPaymentMethod(v as typeof paymentMethod)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                      <SelectItem value="gateway">Gateway</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Input placeholder="Customer name" value={customerName} onChange={e => setCustomerName(e.target.value)} />
                <Input placeholder="Phone" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
                <Button className="w-full" onClick={() => checkout.mutate()} disabled={cart.length === 0 || checkout.isPending} data-testid="checkout">
                  {checkout.isPending ? "Placing…" : `Checkout ₹${cartTotal.toFixed(2)}`}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
