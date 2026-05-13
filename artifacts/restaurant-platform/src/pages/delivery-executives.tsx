import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Truck, Phone, Package, CheckCircle2, Clock, XCircle } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  useDeliveryExecutives,
  useDeliveryAssignments,
  type DeliveryRider,
  type DeliveryAssignment,
} from "@/lib/delivery";

const STATUS_COLORS: Record<string, string> = {
  assigned: "bg-blue-100 text-blue-700",
  picked_up: "bg-orange-100 text-orange-700",
  delivered: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
};

const STATUS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  assigned: Clock,
  picked_up: Truck,
  delivered: CheckCircle2,
  cancelled: XCircle,
};

export default function DeliveryExecutivesPage() {
  const { data: riders = [] } = useDeliveryExecutives();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { data: assignments = [] } = useDeliveryAssignments(statusFilter === "all" ? undefined : statusFilter);

  const stats = useMemo(() => {
    const total = riders.length;
    const active = riders.filter(r => r.isActive).length;
    const onDelivery = riders.filter(r => r.activeDeliveries > 0).length;
    return { total, active, onDelivery };
  }, [riders]);

  return (
    <Layout>
      <PageHeader title="Delivery Executives" subtitle="Manage your delivery team and live assignments" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Riders" value={stats.total} icon={Truck} />
        <StatCard label="Active" value={stats.active} icon={CheckCircle2} />
        <StatCard label="On Delivery" value={stats.onDelivery} icon={Package} />
      </div>

      <section className="bg-card border border-border rounded-xl p-4 mb-6">
        <h3 className="text-sm font-semibold mb-3">Riders</h3>
        {riders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No delivery executives yet. Add one from the Staff page (assign role &quot;Delivery Executive&quot;).
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {riders.map((r: DeliveryRider) => (
              <div key={r.id} className="border border-border rounded-lg p-3 flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                  {r.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{r.name}</p>
                  {r.phone && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Phone className="w-3 h-3" /> {r.phone}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <span className={cn(
                      "text-xs px-1.5 py-0.5 rounded-full",
                      r.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600",
                    )}>
                      {r.isActive ? "Active" : "Inactive"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {r.activeDeliveries} active
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-semibold">Recent Assignments</h3>
          <div className="flex gap-1.5">
            {["all", "assigned", "picked_up", "delivered", "cancelled"].map(s => (
              <Button
                key={s}
                size="sm"
                variant={statusFilter === s ? "default" : "outline"}
                onClick={() => setStatusFilter(s)}
                className="capitalize text-xs h-7"
              >
                {s.replace("_", " ")}
              </Button>
            ))}
          </div>
        </div>
        {assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No assignments to show.</p>
        ) : (
          <div className="space-y-2">
            {assignments.map((a: DeliveryAssignment) => {
              const Icon = STATUS_ICONS[a.status] ?? Clock;
              return (
                <div key={a.id} className="border border-border rounded-lg p-3 flex flex-wrap items-center gap-3 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">
                      {a.order?.orderNumber ?? `#${a.orderId}`}{" "}
                      <span className="text-muted-foreground font-normal">→ {a.rider?.name ?? `Rider #${a.riderId}`}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {a.order?.customerName ?? "Customer"}
                      {a.order?.customerPhone ? ` · ${a.order.customerPhone}` : ""}
                      {" · "}
                      {format(new Date(a.assignedAt), "MMM d, h:mm a")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium tabular-nums">₹{Number(a.order?.totalAmount ?? 0).toLocaleString()}</p>
                    {Number(a.codAmount) > 0 && (
                      <p className="text-xs text-orange-600">COD ₹{Number(a.codAmount).toLocaleString()}{a.codCollected ? " ✓" : ""}</p>
                    )}
                  </div>
                  <span className={cn("text-xs font-medium px-2 py-1 rounded-full capitalize flex items-center gap-1", STATUS_COLORS[a.status])}>
                    <Icon className="w-3 h-3" /> {a.status.replace("_", " ")}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </Layout>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold text-foreground">{value}</p>
      </div>
    </div>
  );
}
