import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useOrders, useFloorTables, useMenuItems, useMenuCategories, useMenus, useCreateOrder, useCurbsideQueue, useCurbsideHandover, useCurbsideReport, useGuestVerifications } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, CheckCircle, Clock, ChefHat, XCircle, AlertTriangle, Car } from "lucide-react";
import { OrderDetailDrawer } from "@/components/OrderDetailDrawer";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import type { Order, FloorTable, MenuCategory, MenuItem, Menu } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  confirmed: "bg-blue-100 text-blue-700",
  preparing: "bg-orange-100 text-orange-700",
  ready: "bg-purple-100 text-purple-700",
  out_for_delivery: "bg-cyan-100 text-cyan-700",
  served: "bg-gray-100 text-gray-600",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
};

const STATUS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  pending: Clock,
  confirmed: CheckCircle,
  preparing: ChefHat,
  completed: CheckCircle,
  cancelled: XCircle,
};

function OrderCard({ order, onOpen, heldForVerification }: { order: Order; onOpen: (id: number) => void; heldForVerification?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(order.id)}
      className={cn(
        "group w-full text-left bg-card border border-border rounded-xl p-4 space-y-3 shadow-sm hover:shadow-md hover:border-primary/40 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 transition-all duration-200",
        heldForVerification && "ring-2 ring-yellow-400 border-yellow-400",
      )}
    >
      {heldForVerification && (
        <div className="-mx-4 -mt-4 mb-2 px-4 py-2 bg-yellow-100 border-b border-yellow-300 rounded-t-xl flex items-center gap-2 text-yellow-900 text-xs font-semibold">
          <AlertTriangle className="w-4 h-4" />
          <span>Held for guest verification — open to accept or reject</span>
        </div>
      )}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold text-foreground text-sm">{order.orderDisplayNumber ?? order.orderNumber}</p>
            {order.isPriority && <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />}
          </div>
          {order.orderDisplayNumber && (order.orderInternalNumber ?? order.orderNumber) && (
            <p className="text-[10px] text-muted-foreground/70 font-mono mt-0.5">{order.orderInternalNumber ?? order.orderNumber}</p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">
            {order.tableId ? `Table ${order.tableId}` : order.orderType} · {format(new Date(order.createdAt), "h:mm a")}
          </p>
        </div>
        <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full capitalize ring-1 ring-inset ring-current/10", STATUS_COLORS[order.status] ?? "bg-muted text-muted-foreground")}>
          {order.status.replace(/_/g, " ")}
        </span>
      </div>
      {order.customerName && <p className="text-xs text-muted-foreground">Customer: {order.customerName}</p>}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <p className="font-bold text-foreground">₹{Number(order.totalAmount).toLocaleString()}</p>
        <span className={cn("text-xs font-medium capitalize", order.paymentStatus === "paid" ? "text-green-600" : "text-orange-600")}>
          {order.paymentStatus ?? "unpaid"}
        </span>
      </div>
    </button>
  );
}

function NewOrderModal({ onClose }: { onClose: () => void }) {
  const { data: tables = [] } = useFloorTables();
  const { data: menus = [] } = useMenus();
  const firstMenu: Menu | undefined = menus[0];
  const { data: categories = [] } = useMenuCategories(firstMenu?.id);
  const [selectedCat, setSelectedCat] = useState<number | undefined>();
  const { data: items = [] } = useMenuItems({ categoryId: selectedCat });
  const [tableId, setTableId] = useState<string>("");
  const [cart, setCart] = useState<Array<{ item: MenuItem; qty: number }>>([]);
  const createOrder = useCreateOrder();
  const { toast } = useToast();

  const addToCart = (item: MenuItem) => {
    setCart(prev => {
      const existing = prev.find(c => c.item.id === item.id);
      if (existing) return prev.map(c => c.item.id === item.id ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, { item, qty: 1 }];
    });
  };

  const subtotal = cart.reduce((s, c) => s + Number(c.item.price) * c.qty, 0);

  const handleSubmit = async () => {
    if (cart.length === 0) return;
    try {
      await createOrder.mutateAsync({
        tableId: tableId ? Number(tableId) : undefined,
        orderType: "dine_in",
        items: cart.map(c => ({ menuItemId: c.item.id, quantity: c.qty })),
      });
      toast({ title: "Order created successfully!" });
      onClose();
    } catch {
      toast({ title: "Failed to create order", variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">New Order</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden border-r border-border">
            <div className="p-4 space-y-3">
              <Select value={tableId} onValueChange={setTableId}>
                <SelectTrigger><SelectValue placeholder="Select table (optional)" /></SelectTrigger>
                <SelectContent>
                  {tables.filter((t: FloorTable) => t.status === "free").map((t: FloorTable) => (
                    <SelectItem key={t.id} value={String(t.id)}>Table {t.tableNumber} ({t.capacity} seats)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant={!selectedCat ? "default" : "outline"} onClick={() => setSelectedCat(undefined)}>All</Button>
                {categories.map((c: MenuCategory) => (
                  <Button key={c.id} size="sm" variant={selectedCat === c.id ? "default" : "outline"} onClick={() => setSelectedCat(c.id)}>{c.name}</Button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4 grid grid-cols-2 gap-2">
              {items.filter((i: MenuItem) => i.isAvailable).map((item: MenuItem) => (
                <button key={item.id} onClick={() => addToCart(item)} className="text-left p-3 border border-border rounded-lg hover:border-primary hover:bg-accent transition-all">
                  <p className="text-sm font-medium text-foreground">{item.name}</p>
                  <p className="text-xs text-muted-foreground">₹{item.price}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="w-56 flex flex-col p-4">
            <h4 className="font-medium text-sm mb-3">Cart ({cart.length})</h4>
            <div className="flex-1 overflow-y-auto space-y-2">
              {cart.map(c => (
                <div key={c.item.id} className="flex items-center justify-between text-sm">
                  <span className="text-foreground truncate max-w-28">{c.item.name}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setCart(prev => prev.map(p => p.item.id === c.item.id ? { ...p, qty: Math.max(0, p.qty - 1) } : p).filter(p => p.qty > 0))} className="w-5 h-5 rounded bg-secondary text-sm flex items-center justify-center">-</button>
                    <span className="w-5 text-center">{c.qty}</span>
                    <button onClick={() => addToCart(c.item)} className="w-5 h-5 rounded bg-secondary text-sm flex items-center justify-center">+</button>
                  </div>
                </div>
              ))}
              {cart.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Add items from menu</p>}
            </div>
            <div className="border-t border-border pt-3 mt-3">
              <div className="flex justify-between text-sm mb-1"><span className="text-muted-foreground">Subtotal</span><span>₹{subtotal.toFixed(0)}</span></div>
              <div className="flex justify-between text-xs text-muted-foreground mb-3"><span>Tax (5%) + Service</span><span>₹{(subtotal * 0.15).toFixed(0)}</span></div>
              <Button className="w-full" disabled={cart.length === 0 || createOrder.isPending} onClick={handleSubmit}>
                Place Order · ₹{(subtotal * 1.15).toFixed(0)}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDurationSecs(s: number): string {
  if (s <= 0) return "0s";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0) return `${sec}s`;
  return `${m}m ${sec}s`;
}

function CurbsideCard({ order, onHandover, handing }: { order: Order; onHandover: (id: number) => void; handing: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const prepSinceMs = order.curbsideAcceptedAt ? now - new Date(order.curbsideAcceptedAt).getTime() : null;
  const waitSinceMs = order.curbsideArrivedAt ? now - new Date(order.curbsideArrivedAt).getTime() : null;
  const arrived = !!order.curbsideArrivedAt;

  return (
    <div className={cn("bg-card border rounded-xl p-4 space-y-3 shadow-sm", arrived ? "border-orange-400 ring-2 ring-orange-100" : "border-border")}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold text-foreground text-sm">{order.orderDisplayNumber ?? order.orderNumber}</p>
            <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full capitalize", STATUS_COLORS[order.status] ?? "bg-muted text-muted-foreground")}>
              {order.status.replace(/_/g, " ")}
            </span>
          </div>
          {order.customerName && <p className="text-xs text-muted-foreground mt-0.5">{order.customerName}</p>}
        </div>
        <p className="font-bold text-sm text-foreground">₹{Number(order.totalAmount).toLocaleString()}</p>
      </div>

      <div className="bg-muted/40 rounded-lg p-3 text-xs space-y-1">
        <div className="flex items-center gap-2 text-foreground font-medium">
          <Car className="w-3.5 h-3.5" />
          {order.vehicleColor} {order.vehicleModel}
        </div>
        {order.vehicleNumber && <p className="text-muted-foreground">Plate: <span className="text-foreground font-medium">{order.vehicleNumber}</span></p>}
        {order.parkingSpot && <p className="text-muted-foreground">Spot: <span className="text-foreground font-medium">{order.parkingSpot}</span></p>}
      </div>

      <div className="flex gap-3 text-xs">
        {prepSinceMs !== null && (
          <div className="flex-1">
            <p className="text-muted-foreground">Prep timer</p>
            <p className="font-mono font-semibold text-foreground">{formatDurationSecs(Math.floor(prepSinceMs / 1000))}</p>
          </div>
        )}
        {waitSinceMs !== null && (
          <div className="flex-1">
            <p className="text-orange-600">Waiting at curb</p>
            <p className="font-mono font-bold text-orange-600">{formatDurationSecs(Math.floor(waitSinceMs / 1000))}</p>
          </div>
        )}
      </div>

      <Button
        size="sm"
        className="w-full"
        disabled={handing || !arrived}
        onClick={() => onHandover(order.id)}
      >
        {arrived ? "Mark Handed Over" : "Waiting for customer arrival…"}
      </Button>
    </div>
  );
}

function CurbsideTab() {
  const { data: queue = [], isLoading } = useCurbsideQueue();
  const handover = useCurbsideHandover();
  const { toast } = useToast();

  const { since, until } = useMemo(() => {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { since: start.toISOString(), until: end.toISOString() };
  }, []);
  const { data: report } = useCurbsideReport(since, until);

  return (
    <div className="space-y-4">
      {report && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Curbside orders (30d)</p>
            <p className="text-2xl font-bold text-foreground">{report.totalOrders}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Handed over</p>
            <p className="text-2xl font-bold text-green-600">{report.handedOver}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Avg pickup time</p>
            <p className="text-2xl font-bold text-foreground">{formatDurationSecs(report.avgPickupSeconds)}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground">No-shows</p>
            <p className="text-2xl font-bold text-red-600">{report.noShows}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {queue.map((o: Order) => (
          <CurbsideCard
            key={o.id}
            order={o}
            handing={handover.isPending}
            onHandover={async (id) => {
              try { await handover.mutateAsync(id); toast({ title: "Handed over" }); }
              catch { toast({ title: "Failed to mark handover", variant: "destructive" }); }
            }}
          />
        ))}
        {!isLoading && queue.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground border-2 border-dashed border-border/60 rounded-xl bg-muted/20">
            <Car className="w-7 h-7 mx-auto opacity-50 mb-2" />
            <p className="font-medium text-foreground/80">No active curbside orders</p>
            <p className="text-xs mt-1">New curbside orders will appear here in real time.</p>
          </div>
        )}
      </div>
    </div>
  );
}

type DateRange = "today" | "7d" | "30d" | "all";

function sinceIsoFor(d: DateRange): string | undefined {
  if (d === "all") return undefined;
  const now = new Date();
  if (d === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }
  const days = d === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export default function OrdersPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [orderTypeFilter, setOrderTypeFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange>("today");
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [openOrderId, setOpenOrderId] = useState<number | null>(null);
  const [tab, setTab] = useState<"all" | "curbside">("all");
  const { data: ordersData } = useOrders({
    status: statusFilter !== "all" ? statusFilter : undefined,
    orderType: orderTypeFilter !== "all" ? orderTypeFilter : undefined,
    since: sinceIsoFor(dateRange),
  });
  const { data: heldVerifications = [] } = useGuestVerifications();
  const heldOrderIds = useMemo(() => new Set(heldVerifications.map(v => v.orderId)), [heldVerifications]);

  const orders: Order[] = ordersData?.data ?? [];

  const statuses = ["all", "pending", "confirmed", "preparing", "ready", "out_for_delivery", "completed", "cancelled"];

  return (
    <Layout>
      <PageHeader
        title="Orders & POS"
        subtitle={tab === "curbside" ? "Curbside pickup queue" : `${orders.length} orders`}
        actions={
          <Button onClick={() => setShowNewOrder(true)}>
            <Plus className="w-4 h-4 mr-2" /> New Order
          </Button>
        }
      />
      <div className="p-6">
        <div className="flex gap-2 mb-4 border-b border-border">
          <button onClick={() => setTab("all")} className={cn("px-4 py-2 text-sm font-medium border-b-2 -mb-px", tab === "all" ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>
            All Orders
          </button>
          <button onClick={() => setTab("curbside")} className={cn("px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5", tab === "curbside" ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>
            <Car className="w-4 h-4" /> Curbside
          </button>
        </div>

        {tab === "curbside" ? (
          <CurbsideTab />
        ) : (
          <>
            <div className="flex flex-col gap-2 mb-6">
              <div className="flex gap-2 flex-wrap items-center">
                <span className="text-xs font-medium text-muted-foreground w-16">Status</span>
                {statuses.map(s => (
                  <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)} className="capitalize">
                    {s}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2 flex-wrap items-center">
                <span className="text-xs font-medium text-muted-foreground w-16">Type</span>
                {(["all", "dine_in", "takeaway", "delivery", "curbside"] as const).map(t => (
                  <Button key={t} size="sm" variant={orderTypeFilter === t ? "default" : "outline"} onClick={() => setOrderTypeFilter(t)} className="capitalize">
                    {t.replace("_", " ")}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2 flex-wrap items-center">
                <span className="text-xs font-medium text-muted-foreground w-16">Date</span>
                {([
                  { k: "today" as const, l: "Today" },
                  { k: "7d" as const, l: "Last 7 days" },
                  { k: "30d" as const, l: "Last 30 days" },
                  { k: "all" as const, l: "All time" },
                ]).map(d => (
                  <Button key={d.k} size="sm" variant={dateRange === d.k ? "default" : "outline"} onClick={() => setDateRange(d.k)}>
                    {d.l}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {orders.map((order: Order) => (
                <OrderCard key={order.id} order={order} onOpen={setOpenOrderId} heldForVerification={heldOrderIds.has(order.id)} />
              ))}
              {orders.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center text-center py-20 text-muted-foreground border-2 border-dashed border-border/60 rounded-xl bg-muted/20">
                  <div className="w-14 h-14 rounded-full bg-muted/60 flex items-center justify-center mb-3">
                    <BagIcon className="w-7 h-7 opacity-50" />
                  </div>
                  <p className="font-medium text-foreground/80">No orders found</p>
                  <p className="text-xs mt-1">Try a different filter or create a new order</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {showNewOrder && <NewOrderModal onClose={() => setShowNewOrder(false)} />}
      <OrderDetailDrawer orderId={openOrderId} onClose={() => setOpenOrderId(null)} />
    </Layout>
  );
}

function BagIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 01-8 0" />
    </svg>
  );
}
