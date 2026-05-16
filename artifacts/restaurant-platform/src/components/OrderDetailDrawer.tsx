import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useOrderDetail, usePayOrder, useUpdateOrder, useRestaurantInfo, useKitchenTickets } from "@/lib/hooks";
import { useDeliveryExecutives, useAssignRider } from "@/lib/delivery";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CreditCard, ArrowRight, AlertTriangle, Loader2, AlertCircle, Truck, Printer, ChefHat } from "lucide-react";
import { cn } from "@/lib/utils";
import { printOrder, type PrintSize } from "@/lib/printOrder";
import type { KitchenTicket } from "@/lib/types";

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
  const assignRider = useAssignRider();
  const { data: riders = [] } = useDeliveryExecutives();
  const { data: allTickets = [] } = useKitchenTickets();
  const orderTickets = allTickets.filter((t: KitchenTicket) => t.orderId === orderId);
  const [showAssign, setShowAssign] = useState(false);
  const [selectedRider, setSelectedRider] = useState<number | "">("");
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

  const handleReprintTicket = (ticket: KitchenTicket) => {
    const size: PrintSize = ticket.kitchen?.paperSize === "a5" ? "a5" : "thermal-80mm";
    const items = (ticket.items ?? []).map((it) => ({
      name: it.menuItemName,
      quantity: it.quantity,
      unitPrice: 0,
      lineTotal: 0,
      notes: it.notes,
    }));
    const totalQty = items.reduce((s, i) => s + i.quantity, 0);
    printOrder({
      size,
      documentTitle: ticket.kitchen?.printerName
        ? `KOT — ${ticket.kitchen.name} (${ticket.kitchen.printerName})`
        : `KOT — ${ticket.kitchen?.name ?? "Kitchen"}`,
      orderNumber: ticket.orderNumber,
      createdAt: ticket.createdAt,
      tableLabel: ticket.tableNumber ? `Table ${ticket.tableNumber}` : undefined,
      orderType: ticket.orderType,
      items,
      subtotal: 0,
      taxAmount: 0,
      serviceCharge: 0,
      discountAmount: 0,
      totalAmount: totalQty,
      splitTotal: totalQty,
      footer: `${ticket.kitchen?.name ?? "Kitchen"} · ${totalQty} item${totalQty !== 1 ? "s" : ""}`,
      restaurant: { name: restaurant?.name ?? "Khana Lagao" },
    });
    toast({ title: "Reprinting KOT", description: ticket.kitchen?.name ?? undefined });
  };

  const handleAssignRider = async () => {
    if (!order || !selectedRider) return;
    try {
      await assignRider.mutateAsync({ orderId: order.id, riderId: Number(selectedRider) });
      toast({ title: "Rider assigned" });
      setShowAssign(false);
      setSelectedRider("");
      refreshDetail();
    } catch (e) {
      toast({ title: "Assign failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
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
                  {order.items?.map((item) => {
                    const rule = (item as { appliedRule?: { name: string; ruleType: string; originalUnitPrice: string; adjustedUnitPrice: string } | null }).appliedRule;
                    return (
                      <div key={item.id} className="flex items-start justify-between text-sm gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-foreground font-medium">{item.menuItemName} <span className="text-muted-foreground font-normal">×{item.quantity}</span></p>
                          {item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}
                          {rule && (
                            <p className="text-[11px] text-emerald-600 mt-0.5">
                              {rule.name} · was ₹{Number(rule.originalUnitPrice).toFixed(2)} → ₹{Number(rule.adjustedUnitPrice).toFixed(2)}
                            </p>
                          )}
                        </div>
                        <p className="text-foreground tabular-nums">₹{Number(item.totalPrice).toLocaleString()}</p>
                      </div>
                    );
                  })}
                  {(!order.items || order.items.length === 0) && (
                    <p className="text-sm text-muted-foreground">No items</p>
                  )}
                </div>
              </div>

              {orderTickets.length > 0 && (
                <div className="border-t border-border pt-4">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                    <ChefHat className="w-3.5 h-3.5" /> Kitchen Breakdown
                  </h4>
                  <div className="space-y-2">
                    {orderTickets.map((t: KitchenTicket) => (
                      <div key={t.id} className="border border-border rounded-lg p-3 bg-muted/20">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-sm truncate">{t.kitchen?.name ?? "Kitchen"}</span>
                            <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize", STATUS_COLORS[t.status] ?? "bg-gray-100 text-gray-600")}>
                              {t.status}
                            </span>
                            {t.isPriority && <AlertTriangle className="w-3 h-3 text-orange-500" />}
                          </div>
                          <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" title="Reprint KOT" onClick={() => handleReprintTicket(t)}>
                            <Printer className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        <div className="space-y-0.5">
                          {(t.items ?? []).map((it) => (
                            <div key={it.id} className="flex items-baseline gap-2 text-xs">
                              <span className="font-semibold w-5 shrink-0">{it.quantity}×</span>
                              <span className="truncate">{it.menuItemName}</span>
                              {it.notes && <span className="text-[10px] text-muted-foreground italic ml-auto">({it.notes})</span>}
                            </div>
                          ))}
                          {(!t.items || t.items.length === 0) && (
                            <p className="text-[10px] text-muted-foreground italic">No items</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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

            {order.orderType === "delivery" && order.status !== "completed" && order.status !== "cancelled" && (
              <div className="border-t border-border px-6 py-3 space-y-2 bg-muted/30">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Truck className="w-4 h-4 text-cyan-600" />
                  <span>Delivery</span>
                </div>
                {!showAssign ? (
                  <Button size="sm" variant="outline" className="w-full" onClick={() => setShowAssign(true)}>
                    Assign Rider
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={selectedRider}
                      onChange={(e) => setSelectedRider(e.target.value ? Number(e.target.value) : "")}
                      className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background"
                    >
                      <option value="">Select a rider…</option>
                      {riders.filter(r => r.isActive).map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.activeDeliveries} active)
                        </option>
                      ))}
                    </select>
                    {riders.length === 0 && (
                      <p className="text-xs text-muted-foreground">No delivery executives. Add one from the Staff page.</p>
                    )}
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" className="flex-1" onClick={() => { setShowAssign(false); setSelectedRider(""); }}>
                        Cancel
                      </Button>
                      <Button size="sm" className="flex-1" onClick={handleAssignRider} disabled={!selectedRider || assignRider.isPending}>
                        {assignRider.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Assign"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

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
