import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrafficCone, CheckCircle2, Circle, ChefHat, Truck } from "lucide-react";
import { useOrderStatus } from "@/lib/hooks-customer-quality";

const STEPS = [
  { key: "pending", label: "Received", icon: Circle },
  { key: "in_progress", label: "In Kitchen", icon: ChefHat },
  { key: "ready", label: "Ready", icon: CheckCircle2 },
  { key: "out_for_delivery", label: "Out for delivery", icon: Truck },
  { key: "completed", label: "Served", icon: CheckCircle2 },
];

export default function OrderStatusPage() {
  const [input, setInput] = useState("");
  const [orderId, setOrderId] = useState<number | null>(null);
  const { data, isLoading, isError } = useOrderStatus(orderId);
  const order = data?.order;
  const idx = order ? Math.max(0, STEPS.findIndex(s => s.key === order.status)) : -1;

  return (
    <Layout>
      <PageHeader title="Live Order Status" description="Track an order through the kitchen" icon={TrafficCone} />
      <Card className="mb-4">
        <CardContent className="py-4 flex gap-2">
          <Input placeholder="Order ID" value={input} onChange={e => setInput(e.target.value)} type="number" />
          <Button onClick={() => setOrderId(Number(input))} disabled={!input}>Track</Button>
        </CardContent>
      </Card>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && <p className="text-sm text-destructive">Order not found.</p>}
      {order && (
        <Card>
          <CardHeader>
            <CardTitle>Order #{order.orderNumber ?? order.id} <Badge className="ml-2">{order.status}</Badge></CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                const done = i <= idx;
                return (
                  <div key={s.key} className={`flex items-center gap-3 ${done ? "" : "opacity-40"}`}>
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center ${done ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="font-medium">{s.label}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </Layout>
  );
}
