import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useOrderDetail, usePayOrder, useUpdateOrder, useRestaurantInfo } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CreditCard, ArrowRight, AlertTriangle, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { printOrder } from "@/lib/printOrder";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  confirmed: "bg-blue-100 text-blue-700",
  preparing: "bg-orange-100 text-orange-700",
  ready: "bg-purple-100 text-purple-700",
  served: "bg-gray-100 text-gray-600",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
};

const STATUS_FLOW: Record<string, string> = {
  pending: "confirmed",
  confirmed: "preparing",
  preparing: "ready",
  ready: "served",
  served: "completed",
};

interface OrderDetailDrawerProps {
  orderId: number | null;
  onClose: () => void;
}

export function OrderDetailDrawer({ orderId, onClose }: OrderDetailDrawerProps) {
  const { data: order, isLoading, isError, refetch } = useOrderDetail(orderId ?? undefined);
  const { data: restaurant } = useRestaurantInfo();
  const payOrder = usePayOrder();
  const updateOrder = useUpdateOrder();
  const { toast } = useToast();
  const qc = useQueryClient();

  const refreshDetail = () => {
    if (orderId) qc.invalidateQueries({ queryKey: ["orders", "detail"] });
  };

  const handleAdvance = async () => {
    if (!order) return;
    const next = STATUS_FLOW[order.status];
    if (!next) return;
    try {
      await updateOrder.mutateAsync({ id: order.id, status: next });
      refreshDetail();
      toast({ title: `Order ${next}` });
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  };

  const handlePay = async () => {
    if (!order) return;
    try {
      await payOrder.mutateAsync({ id: order.id, paymentMethod: "cash" });
      refreshDetail();
      toast({ title: "Payment recorded!" });
      onClose();
    } catch {
      toast({ title: "Payment failed", variant: "destructive" });
    }
  };

  const handleCancel = async () => {
    if (!order) return;
    try {
      await updateOrder.mutateAsync({ id: order.id, status: "cancelled" });
      refreshDetail();
      toast({ title: "Order cancelled" });
    } catch {
      toast({ title: "Cancel failed", variant: "destructive" });
    }
  };

  const handlePriority = async () => {
    if (!order) return;
    try {
      await updateOrder.mutateAsync({ id: order.id, isPriority: !order.isPriority });
      refreshDetail();
      toast({ title: order.isPriority ? "Priority removed" : "Marked priority" });
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  };

  const handlePrint = () => {
    if (!order) return;
    printOrder({
      size: "a5",
      documentTitle: order.paymentStatus === "paid" ? "Tax Invoice" : "Receipt",

      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      tableLabel: order.tableId ? `Table ${order.tableId}` : undefined,
      orderType: order.orderType,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      items: (order.items ?? []).map((it) => ({
        name: it.menuItemName,
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
        lineTotal: Number(it.totalPrice),
        notes: it.notes,
      })),
      subtotal: Number(order.subtotal ?? 0),
      taxAmount: Number(order.taxAmount ?? 0),
      serviceCharge: Number(order.serviceCharge ?? 0),
      discountAmount: Number(order.discountAmount ?? 0),
      totalAmount: Number(order.totalAmount ?? 0),
      payment: order.paymentStatus === "paid" && order.paymentMethod
        ? {
            method: order.paymentMethod,
            tendered: order.paymentAmount ? Number(order.paymentAmount) : undefined,
          }
        : undefined,
      footer: order.paymentStatus === "paid" ? "Paid · Thank you for dining with us!" : "Thank you for dining with us!",
      restaurant: {
        name: restaurant?.name,
        logoUrl: restaurant?.logoUrl,
        address: [restaurant?.address, restaurant?.city].filter(Boolean).join(", ") || null,
        phone: restaurant?.phone,
      },
    });
  };

  const open = orderId !== null;
  const next = order ? STATUS_FLOW[order.status] : null;
  const canAdvance = order && order.status !== "completed" && order.status !== "cancelled" && next;
  const canPay = order && order.paymentStatus === "unpaid" && order.status !== "cancelled";

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError || !order ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <AlertCircle className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {isError ? "Couldn't load this order." : "Order not found."}
            </p>
            {isError && (
              <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
            )}
          </div>
        ) : (
          <>
            <SheetHeader className="px-6 pt-6 pb-4 border-b border-border space-y-2">
              <div className="flex items-center gap-2">
                <SheetTitle className="text-base">{order.orderNumber}</SheetTitle>
                {order.isPriority && <AlertTriangle className="w-4 h-4 text-orange-500" />}
                <span className={cn("ml-auto text-xs font-medium px-2 py-1 rounded-full capitalize", STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-600")}>
                  {order.status}
                </span>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5 text-left">
                <p>
                  {order.tableId ? `Table ${order.tableId}` : (order.orderType ?? "").replace("_", " ")}
                  {order.createdAt && ` · ${format(new Date(order.createdAt), "MMM d, h:mm a")}`}
                </p>
                {order.customerName && <p>Customer: {order.customerName}{order.customerPhone ? ` · ${order.customerPhone}` : ""}</p>}
                <p>Payment: <span className={cn("font-medium capitalize", order.paymentStatus === "paid" ? "text-green-600" : "text-orange-600")}>{order.paymentStatus ?? "unpaid"}</span></p>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Items</h4>
                <div className="space-y-2">
                  {order.items?.map((item) => (
                    <div key={item.id} className="flex items-start justify-between text-sm gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground font-medium">{item.menuItemName} <span className="text-muted-foreground font-normal">×{item.quantity}</span></p>
                        {item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}
                      </div>
                      <p className="text-foreground tabular-nums">₹{Number(item.totalPrice).toLocaleString()}</p>
                    </div>
                  ))}
                  {(!order.items || order.items.length === 0) && (
                    <p className="text-sm text-muted-foreground">No items</p>
                  )}
                </div>
              </div>

              <div className="border-t border-border pt-4 space-y-1.5 text-sm">
                {order.subtotal !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="tabular-nums">₹{Number(order.subtotal).toLocaleString()}</span>
                  </div>
                )}
                {Number(order.taxAmount ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax</span>
                    <span className="tabular-nums">₹{Number(order.taxAmount).toLocaleString()}</span>
                  </div>
                )}
                {Number(order.serviceCharge ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Service</span>
                    <span className="tabular-nums">₹{Number(order.serviceCharge).toLocaleString()}</span>
                  </div>
                )}
                {Number(order.discountAmount ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="tabular-nums text-green-600">-₹{Number(order.discountAmount).toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-border font-bold">
                  <span>Total</span>
                  <span className="tabular-nums">₹{Number(order.totalAmount).toLocaleString()}</span>
                </div>
              </div>

            </div>

            <div className="border-t border-border px-6 py-4 space-y-2">
              <div className="flex gap-2">
                {canAdvance && (
                  <Button className="flex-1" onClick={handleAdvance} disabled={updateOrder.isPending}>
                    <ArrowRight className="w-4 h-4 mr-1" />
                    Mark {next}
                  </Button>
                )}
                {canPay && (
                  <Button className="flex-1" variant={canAdvance ? "outline" : "default"} onClick={handlePay} disabled={payOrder.isPending}>
                    <CreditCard className="w-4 h-4 mr-1" /> Take Payment
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="flex-1" onClick={handlePriority}>
                  {order.isPriority ? "Unmark Priority" : "Mark Priority"}
                </Button>
                <Button size="sm" variant="ghost" className="flex-1" onClick={handlePrint}>
                  Print
                </Button>
                {order.status !== "cancelled" && order.status !== "completed" && (
                  <Button size="sm" variant="ghost" className="flex-1 text-red-600 hover:text-red-700" onClick={handleCancel}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
