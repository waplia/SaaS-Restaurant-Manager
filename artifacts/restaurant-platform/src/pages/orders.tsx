import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useOrders, useFloorTables, useMenuItems, useMenuCategories, useMenus, useCreateOrder } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, CheckCircle, Clock, ChefHat, XCircle, AlertTriangle } from "lucide-react";
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

function OrderCard({ order, onOpen }: { order: Order; onOpen: (id: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(order.id)}
      className="w-full text-left bg-card border border-border rounded-xl p-4 space-y-3 hover:border-primary hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold text-foreground text-sm">{order.orderNumber}</p>
            {order.isPriority && <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {order.tableId ? `Table ${order.tableId}` : order.orderType} · {format(new Date(order.createdAt), "h:mm a")}
          </p>
        </div>
        <span className={cn("text-xs font-medium px-2 py-1 rounded-full capitalize", STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-600")}>
          {order.status}
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

export default function OrdersPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [openOrderId, setOpenOrderId] = useState<number | null>(null);
  const { data: ordersData } = useOrders(statusFilter !== "all" ? { status: statusFilter } : undefined);

  const orders: Order[] = ordersData?.data ?? [];

  const statuses = ["all", "pending", "confirmed", "preparing", "ready", "out_for_delivery", "completed", "cancelled"];

  return (
    <Layout>
      <PageHeader
        title="Orders & POS"
        subtitle={`${orders.length} orders`}
        actions={
          <Button onClick={() => setShowNewOrder(true)}>
            <Plus className="w-4 h-4 mr-2" /> New Order
          </Button>
        }
      />
      <div className="p-6">
        <div className="flex gap-2 mb-6 flex-wrap">
          {statuses.map(s => (
            <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)} className="capitalize">
              {s}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {orders.map((order: Order) => (
            <OrderCard key={order.id} order={order} onOpen={setOpenOrderId} />
          ))}
          {orders.length === 0 && (
            <div className="col-span-full text-center py-16 text-muted-foreground">
              <BagIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No orders found</p>
            </div>
          )}
        </div>
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
