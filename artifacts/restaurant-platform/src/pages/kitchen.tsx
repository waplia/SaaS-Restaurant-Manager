import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useKitchenTickets, useUpdateTicketStatus, useUpdateTicketPriority, useKitchens, useRestaurantInfo } from "@/lib/hooks";
import { ServiceTimerPanel } from "@/components/ServiceTimerPanel";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, RefreshCw, Volume2, VolumeX, Flag, Printer, ChefHat, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import type { KitchenTicket, KitchenTicketItem, Kitchen } from "@/lib/types";
import { io } from "socket.io-client";
import { printOrder, type PrintSize } from "@/lib/printOrder";
import { resolveImageUrl } from "@/components/ImageUploadField";

const STATUS_CONFIG: Record<string, { label: string; col: string; dot: string; badge: string; next?: string; nextLabel?: string; nextClass?: string }> = {
  new: {
    label: "New",
    col: "bg-blue-50/60 border-blue-200 text-blue-950",
    dot: "bg-blue-500",
    badge: "bg-blue-100 text-blue-700",
    next: "preparing",
    nextLabel: "Start Preparing",
    nextClass: "bg-blue-600 hover:bg-blue-700 text-white",
  },
  preparing: {
    label: "Preparing",
    col: "bg-amber-50/60 border-amber-200 text-amber-950",
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-700",
    next: "ready",
    nextLabel: "Mark Ready",
    nextClass: "bg-amber-600 hover:bg-amber-700 text-white",
  },
  ready: {
    label: "Ready to Serve",
    col: "bg-green-50/60 border-green-200 text-green-950",
    dot: "bg-green-500",
    badge: "bg-green-100 text-green-700",
    next: "served",
    nextLabel: "Mark Served",
    nextClass: "bg-green-600 hover:bg-green-700 text-white",
  },
  served: { label: "Served", col: "bg-gray-50 border-gray-200 text-gray-800", dot: "bg-gray-400", badge: "bg-gray-100 text-gray-500" },
};

function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 1100;
      osc2.type = "sine";
      gain2.gain.setValueAtTime(0.3, ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc2.start();
      osc2.stop(ctx.currentTime + 0.3);
    }, 200);
  } catch {
    // ignore
  }
}

function printKitchenTicket(ticket: KitchenTicket, restaurantName?: string | null) {
  const size: PrintSize = (ticket.kitchen?.paperSize === "a5" ? "a5" : "thermal-80mm");
  const items = (ticket.items ?? []).map((it) => ({
    name: it.menuItemName,
    quantity: it.quantity,
    unitPrice: 0,
    lineTotal: 0,
    notes: it.notes,
    modifiers: (it.modifiers ?? []).map(m => ({ name: m.groupName ? `${m.groupName}: ${m.name}` : m.name, price: 0 })),
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
    restaurant: { name: restaurantName ?? "KhanaLagao" },
  });
}

function TicketCard({
  ticket,
  onUpdate,
  onPriority,
  onReprint,
  onCancel,
  showKitchenBadge,
}: {
  ticket: KitchenTicket;
  onUpdate: (id: number, status: string) => void;
  onPriority: (id: number) => void;
  onReprint: (t: KitchenTicket) => void;
  onCancel: (id: number) => void;
  showKitchenBadge: boolean;
}) {
  const cfg = STATUS_CONFIG[ticket.status] ?? STATUS_CONFIG.new;
  const age = formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: false });
  const ageMs = Date.now() - new Date(ticket.createdAt).getTime();
  const isOld = ageMs > 15 * 60 * 1000;
  const isVeryOld = ageMs > 30 * 60 * 1000;
  const overdueMinutes = ticket.overdueMinutes ?? 0;
  const hasAlertedDelay = (ticket.delayAlertCount ?? 0) > 0;

  return (
    <div
      className={cn(
        "border rounded-xl p-4 space-y-3 transition-all duration-200 shadow-sm hover:shadow-md hover:-translate-y-0.5",
        hasAlertedDelay
          ? "border-red-400 bg-red-50 text-red-950 ring-2 ring-red-300/60 dark:bg-red-950/30 dark:text-red-100 dark:border-red-500"
          : ticket.isPriority
            ? "border-orange-400 bg-orange-50 text-orange-950 ring-2 ring-orange-300/60 dark:bg-orange-950/30 dark:text-orange-100 dark:border-orange-500"
            : `border-border/60 ${cfg.col}`,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-bold">{ticket.orderNumber}</p>
            {hasAlertedDelay && (
              <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-red-700 bg-red-100 px-1.5 py-0.5 rounded-full animate-pulse">
                <AlertTriangle className="w-3 h-3" /> DELAYED {overdueMinutes > 0 ? `+${overdueMinutes}m` : ""}
              </span>
            )}
            {ticket.isPriority && (
              <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded-full">
                <AlertTriangle className="w-3 h-3" /> PRIORITY
              </span>
            )}
            {showKitchenBadge && ticket.kitchen && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">
                <ChefHat className="w-2.5 h-2.5" />{ticket.kitchen.name}
              </span>
            )}
          </div>
          <p className="text-sm opacity-70 mt-0.5 truncate">
            {ticket.tableNumber ? `Table ${ticket.tableNumber}` : (ticket.orderType ?? "dine_in").replace(/_/g, " ")}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div
            className={cn(
              "flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full",
              isVeryOld ? "bg-red-100 text-red-700 animate-pulse" : isOld ? "bg-orange-100 text-orange-700" : "bg-muted text-muted-foreground",
            )}
          >
            <Clock className="w-3 h-3" />
            {age}
          </div>
          <button
            onClick={() => onReprint(ticket)}
            title="Reprint KOT"
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onPriority(ticket.id)}
            title="Toggle priority"
            className={cn(
              "p-1.5 rounded-lg transition-colors",
              ticket.isPriority ? "text-orange-500 bg-orange-100 hover:bg-orange-200" : "text-muted-foreground hover:bg-accent",
            )}
          >
            <Flag className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onCancel(ticket.id)}
            title="Cancel KOT (manager only — requires reason)"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-1 border-t border-border/40 pt-2">
        {(ticket.items ?? []).map((item: KitchenTicketItem) => (
          <div key={item.id} className="text-sm">
            <div className="flex items-center gap-2">
              <span className="font-bold w-6 shrink-0">{item.quantity}×</span>
              {item.menuItemImageUrl ? (
                <img
                  src={resolveImageUrl(item.menuItemImageUrl)}
                  alt=""
                  className="w-8 h-8 rounded object-cover flex-shrink-0 bg-muted"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <div className="w-8 h-8 rounded bg-muted/40 flex-shrink-0" />
              )}
              <span className="font-medium">{item.menuItemName}</span>
              {item.notes && <span className="text-xs opacity-70 italic ml-auto">({item.notes})</span>}
            </div>
            {item.modifiers && item.modifiers.length > 0 && (
              <ul className="pl-10 mt-0.5 space-y-0.5">
                {item.modifiers.map(m => (
                  <li key={m.id} className="text-xs text-muted-foreground">
                    + {m.groupName ? `${m.groupName}: ` : ""}{m.name}{m.quantity > 1 ? ` ×${m.quantity}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {(!ticket.items || ticket.items.length === 0) && (
          <p className="text-xs text-muted-foreground italic">No items</p>
        )}
      </div>

      <ServiceTimerPanel orderId={ticket.orderId} />

      {cfg.next && (
        <button
          onClick={() => onUpdate(ticket.id, cfg.next!)}
          className={cn("w-full py-2 rounded-lg text-sm font-semibold transition-all duration-150 active:scale-[0.98] shadow-sm hover:shadow-md", cfg.nextClass)}
        >
          {cfg.nextLabel}
        </button>
      )}
    </div>
  );
}

function KanbanColumn({
  status,
  tickets,
  onUpdate,
  onPriority,
  onReprint,
  onCancel,
  showKitchenBadge,
}: {
  status: string;
  tickets: KitchenTicket[];
  onUpdate: (id: number, s: string) => void;
  onPriority: (id: number) => void;
  onReprint: (t: KitchenTicket) => void;
  onCancel: (id: number) => void;
  showKitchenBadge: boolean;
}) {
  const cfg = STATUS_CONFIG[status];
  const sorted = [...tickets].sort((a, b) => Number(b.isPriority) - Number(a.isPriority));

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className={cn("w-2.5 h-2.5 rounded-full", cfg.dot)} />
        <h3 className="font-semibold text-foreground">{cfg.label}</h3>
        <span className={cn("ml-auto text-xs font-bold px-2 py-0.5 rounded-full", cfg.badge)}>{tickets.length}</span>
      </div>
      <div className="space-y-3 flex-1 overflow-y-auto pr-1">
        {sorted.map((t) => (
          <TicketCard key={t.id} ticket={t} onUpdate={onUpdate} onPriority={onPriority} onReprint={onReprint} onCancel={onCancel} showKitchenBadge={showKitchenBadge} />
        ))}
        {tickets.length === 0 && (
          <div className="text-center py-10 text-muted-foreground text-sm border-2 border-dashed border-border/40 rounded-xl">
            {status === "new" ? "No new orders" : status === "preparing" ? "Nothing in progress" : "Nothing ready"}
          </div>
        )}
      </div>
    </div>
  );
}

const ALL_KITCHENS = "all";

export default function KitchenPage() {
  const { data: kitchens = [] } = useKitchens();
  const [activeKitchenId, setActiveKitchenId] = useState<string>(ALL_KITCHENS);
  const queryParams = useMemo(
    () => (activeKitchenId === ALL_KITCHENS ? {} : { kitchenId: Number(activeKitchenId) }),
    [activeKitchenId],
  );
  const { data: allTickets = [], refetch } = useKitchenTickets(queryParams);
  const updateStatus = useUpdateTicketStatus();
  const updatePriority = useUpdateTicketPriority();
  const { data: restaurant } = useRestaurantInfo();
  const { toast } = useToast();
  const [soundEnabled, setSoundEnabled] = useState(true);
  const prevCountRef = useRef(0);
  const printedTicketIdsRef = useRef<Set<number>>(new Set());
  const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

  const activeTickets = allTickets.filter((t: KitchenTicket) => t.status === "new" || t.status === "preparing" || t.status === "ready");
  const newTickets = activeTickets.filter((t: KitchenTicket) => t.status === "new");
  const preparingTickets = activeTickets.filter((t: KitchenTicket) => t.status === "preparing");
  const readyTickets = activeTickets.filter((t: KitchenTicket) => t.status === "ready");

  const handleUpdate = useCallback(async (id: number, status: string) => {
    try {
      await updateStatus.mutateAsync({ id, status });
      if (status === "ready") {
        toast({ title: "Order ready!", description: "Waiter has been notified." });
      }
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  }, [updateStatus, toast]);

  const handlePriority = useCallback(async (id: number) => {
    try {
      await updatePriority.mutateAsync(id);
    } catch {
      toast({ title: "Priority toggle failed", variant: "destructive" });
    }
  }, [updatePriority, toast]);

  const handleCancel = useCallback(async (id: number) => {
    const reason = window.prompt("Reason for cancelling this KOT (required, min 3 chars):", "");
    if (reason == null) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      toast({ title: "Cancel aborted", description: "A reason of at least 3 characters is required.", variant: "destructive" });
      return;
    }
    try {
      await updateStatus.mutateAsync({ id, status: "cancelled", reason: trimmed });
      toast({ title: "KOT cancelled", description: trimmed });
    } catch (e) {
      toast({ title: "Cancel failed", description: (e as Error)?.message, variant: "destructive" });
    }
  }, [updateStatus, toast]);

  const handleReprint = useCallback((ticket: KitchenTicket) => {
    printKitchenTicket(ticket, restaurant?.name);
    toast({ title: "Reprinting KOT", description: ticket.kitchen?.name ?? undefined });
  }, [restaurant, toast]);

  // Auto-print KOTs for kitchens with autoPrint enabled.
  useEffect(() => {
    for (const t of newTickets) {
      if (printedTicketIdsRef.current.has(t.id)) continue;
      if (t.kitchen?.autoPrint) {
        printKitchenTicket(t, restaurant?.name);
      }
      printedTicketIdsRef.current.add(t.id);
    }
  }, [newTickets, restaurant]);

  useEffect(() => {
    const token = localStorage.getItem("tt_access_token");
    const socket = io(API_BASE, {
      path: "/api/socket.io",
      auth: token ? { token } : undefined,
      transports: ["websocket", "polling"],
    });

    socket.on("order:new", (payload: { kitchenId?: number | null } | undefined) => {
      if (
        activeKitchenId !== ALL_KITCHENS &&
        payload?.kitchenId != null &&
        Number(payload.kitchenId) !== Number(activeKitchenId)
      ) {
        return;
      }
      void refetch();
      if (soundEnabled) playBeep();
      toast({ title: "New order received!", description: "Check the New Orders column." });
    });

    socket.on("ticket:status", () => {
      void refetch();
    });

    socket.on("ticket:priority", () => {
      void refetch();
    });

    socket.on("ticket:delayed", (payload: { orderNumber?: string | null; delayedByMinutes?: number; kitchenId?: number | null } | undefined) => {
      if (
        activeKitchenId !== ALL_KITCHENS &&
        payload?.kitchenId != null &&
        Number(payload.kitchenId) !== Number(activeKitchenId)
      ) {
        return;
      }
      void refetch();
      if (soundEnabled) playBeep();
      toast({
        title: "Kitchen delay alert",
        description: `Order ${payload?.orderNumber ?? "#?"} is ${payload?.delayedByMinutes ?? 0} min late`,
        variant: "destructive",
      });
    });

    return () => { socket.disconnect(); };
  }, [API_BASE, soundEnabled, refetch, toast, activeKitchenId]);

  useEffect(() => {
    const newCount = newTickets.length;
    if (newCount > prevCountRef.current && prevCountRef.current > 0) {
      if (soundEnabled) playBeep();
    }
    prevCountRef.current = newCount;
  }, [newTickets.length, soundEnabled]);

  const showKitchenBadge = activeKitchenId === ALL_KITCHENS;
  const activeKitchen = kitchens.find((k: Kitchen) => String(k.id) === activeKitchenId) ?? null;

  return (
    <Layout>
      <PageHeader
        title="Kitchen Display"
        subtitle={`${activeTickets.length} active ticket${activeTickets.length !== 1 ? "s" : ""} · live updates${activeKitchen ? ` · ${activeKitchen.name}${activeKitchen.autoPrint ? " (auto-print on)" : ""}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSoundEnabled(v => !v)}
              title={soundEnabled ? "Mute notifications" : "Enable sound"}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-2" /> Refresh
            </Button>
          </div>
        }
      />

      {kitchens.length > 0 && (
        <div className="px-6 pt-4 border-b border-border">
          <div className="flex items-center gap-1 overflow-x-auto -mb-px">
            <button
              onClick={() => setActiveKitchenId(ALL_KITCHENS)}
              className={cn(
                "px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors",
                activeKitchenId === ALL_KITCHENS ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              All Kitchens
            </button>
            {kitchens.filter((k: Kitchen) => k.isActive).map((k: Kitchen) => (
              <button
                key={k.id}
                onClick={() => setActiveKitchenId(String(k.id))}
                className={cn(
                  "px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5",
                  String(k.id) === activeKitchenId ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <ChefHat className="w-3.5 h-3.5" />
                {k.name}
                {k.autoPrint && <Printer className="w-3 h-3 opacity-60" />}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="p-6 h-[calc(100vh-12rem)]">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-full">
          <KanbanColumn status="new" tickets={newTickets} onUpdate={handleUpdate} onPriority={handlePriority} onReprint={handleReprint} onCancel={handleCancel} showKitchenBadge={showKitchenBadge} />
          <KanbanColumn status="preparing" tickets={preparingTickets} onUpdate={handleUpdate} onPriority={handlePriority} onReprint={handleReprint} onCancel={handleCancel} showKitchenBadge={showKitchenBadge} />
          <KanbanColumn status="ready" tickets={readyTickets} onUpdate={handleUpdate} onPriority={handlePriority} onReprint={handleReprint} onCancel={handleCancel} showKitchenBadge={showKitchenBadge} />
        </div>
      </div>
    </Layout>
  );
}
