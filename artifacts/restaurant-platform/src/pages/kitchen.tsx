import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useKitchenTickets, useUpdateTicketStatus } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import type { KitchenTicket, KitchenTicketItem } from "@/lib/types";

const STATUS_CONFIG: Record<string, { label: string; color: string; next?: string; nextLabel?: string }> = {
  new: { label: "New", color: "border-l-blue-500 bg-blue-50", next: "preparing", nextLabel: "Start Preparing" },
  preparing: { label: "Preparing", color: "border-l-yellow-500 bg-yellow-50", next: "ready", nextLabel: "Mark Ready" },
  ready: { label: "Ready", color: "border-l-green-500 bg-green-50", next: "served", nextLabel: "Mark Served" },
  served: { label: "Served", color: "border-l-gray-300 bg-gray-50" },
};

function TicketCard({ ticket, onUpdate }: { ticket: KitchenTicket; onUpdate: (id: number, status: string) => void }) {
  const cfg = STATUS_CONFIG[ticket.status] ?? STATUS_CONFIG.new;
  const age = formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: false });
  const isOld = (Date.now() - new Date(ticket.createdAt).getTime()) > 15 * 60 * 1000;

  return (
    <div className={cn("border-l-4 rounded-xl p-4 space-y-3", cfg.color, "border border-border/50")}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-bold text-foreground">{ticket.orderNumber}</p>
            {ticket.isPriority && <AlertTriangle className="w-4 h-4 text-orange-500" />}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {ticket.tableNumber ? `Table ${ticket.tableNumber}` : ticket.orderType?.replace("_", " ")}
          </p>
        </div>
        <div className={cn("flex items-center gap-1 text-xs", isOld ? "text-red-500 font-bold" : "text-muted-foreground")}>
          <Clock className="w-3 h-3" />
          {age}
        </div>
      </div>

      <div className="space-y-1">
        {(ticket.items ?? []).map((item: KitchenTicketItem) => (
          <div key={item.id} className="flex items-center gap-2 text-sm">
            <span className="font-bold text-foreground">{item.quantity}×</span>
            <span className="text-foreground">{item.menuItemName}</span>
            {item.notes && <span className="text-xs text-muted-foreground italic">({item.notes})</span>}
          </div>
        ))}
      </div>

      {cfg.next && (
        <Button size="sm" className="w-full" onClick={() => onUpdate(ticket.id, cfg.next!)}>
          {cfg.nextLabel}
        </Button>
      )}
    </div>
  );
}

export default function KitchenPage() {
  const { data: allTickets = [], refetch } = useKitchenTickets();
  const updateStatus = useUpdateTicketStatus();
  const { toast } = useToast();

  const newTickets = allTickets.filter((t: KitchenTicket) => t.status === "new");
  const preparingTickets = allTickets.filter((t: KitchenTicket) => t.status === "preparing");
  const readyTickets = allTickets.filter((t: KitchenTicket) => t.status === "ready");

  const handleUpdate = async (id: number, status: string) => {
    try {
      await updateStatus.mutateAsync({ id, status });
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  };

  return (
    <Layout>
      <PageHeader
        title="Kitchen Display"
        subtitle="Live order queue — auto-refreshes every 8 seconds"
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
        }
      />

      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <h3 className="font-semibold text-foreground">New Orders</h3>
              <span className="ml-auto bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{newTickets.length}</span>
            </div>
            <div className="space-y-3">
              {newTickets.sort((a, b) => Number(b.isPriority) - Number(a.isPriority)).map((t: KitchenTicket) => (
                <TicketCard key={t.id} ticket={t} onUpdate={handleUpdate} />
              ))}
              {newTickets.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">No new orders</div>}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <h3 className="font-semibold text-foreground">Preparing</h3>
              <span className="ml-auto bg-yellow-100 text-yellow-700 text-xs font-bold px-2 py-0.5 rounded-full">{preparingTickets.length}</span>
            </div>
            <div className="space-y-3">
              {preparingTickets.sort((a, b) => Number(b.isPriority) - Number(a.isPriority)).map((t: KitchenTicket) => (
                <TicketCard key={t.id} ticket={t} onUpdate={handleUpdate} />
              ))}
              {preparingTickets.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">Nothing preparing</div>}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <h3 className="font-semibold text-foreground">Ready to Serve</h3>
              <span className="ml-auto bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">{readyTickets.length}</span>
            </div>
            <div className="space-y-3">
              {readyTickets.map((t: KitchenTicket) => (
                <TicketCard key={t.id} ticket={t} onUpdate={handleUpdate} />
              ))}
              {readyTickets.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">Nothing ready yet</div>}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
