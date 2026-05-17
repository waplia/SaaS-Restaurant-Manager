import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Crown, CheckCircle2 } from "lucide-react";
import { useVipAlerts, useAckVipAlert } from "@/lib/hooks-customer-quality";

export default function VipAlertsPage() {
  const { data, isLoading } = useVipAlerts();
  const ack = useAckVipAlert();
  const alerts = data?.alerts ?? [];

  return (
    <Layout>
      <PageHeader title="VIP Alerts" description="Real-time alerts when a VIP arrives" icon={Crown} />
      <div className="space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && alerts.length === 0 && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No VIP alerts yet. They appear automatically when a tagged VIP customer arrives or orders.</CardContent></Card>
        )}
        {alerts.map((a: any) => (
          <Card key={a.id} className={a.acknowledged ? "opacity-60" : "border-amber-500/40"}>
            <CardContent className="py-4 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-amber-500" />
                  <span className="font-medium">{a.customerName ?? a.customerPhone ?? `#${a.customerId}`}</span>
                  <Badge variant="outline">{a.trigger}</Badge>
                </div>
                {a.reason && <p className="text-sm text-muted-foreground mt-1">{a.reason}</p>}
                <p className="text-xs text-muted-foreground mt-1">{new Date(a.createdAt).toLocaleString()}</p>
              </div>
              {!a.acknowledged && (
                <Button size="sm" variant="outline" onClick={() => ack.mutate(a.id)} disabled={ack.isPending}>
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Acknowledge
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </Layout>
  );
}
