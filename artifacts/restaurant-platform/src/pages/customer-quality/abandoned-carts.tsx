import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Send } from "lucide-react";
import { useCarts, useRecoverCart } from "@/lib/hooks-customer-quality";

export default function AbandonedCartsPage() {
  const { data, isLoading } = useCarts();
  const recover = useRecoverCart();
  const carts = data?.carts ?? [];
  const events = data?.events ?? [];

  return (
    <Layout>
      <PageHeader title="Abandoned Cart Recovery" description="Recover online & QR carts via WhatsApp / SMS / email" icon={ShoppingCart} />
      <Card className="mb-4">
        <CardHeader><CardTitle>Carts</CardTitle></CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && carts.length === 0 && <p className="text-sm text-muted-foreground">No carts yet. Active QR & online carts appear here.</p>}
          <div className="divide-y">
            {carts.map((c: any) => (
              <div key={c.id} className="py-2 flex items-center gap-3">
                <Badge variant={c.status === "abandoned" ? "destructive" : c.status === "converted" ? "default" : "secondary"}>{c.status}</Badge>
                <Badge variant="outline">{c.channel}</Badge>
                <div className="text-sm flex-1">
                  <div>{c.customerName ?? c.customerPhone ?? "Guest"}</div>
                  <div className="text-xs text-muted-foreground">{(c.items ?? []).length} items · ₹{Number(c.subtotal).toFixed(2)}</div>
                </div>
                <span className="text-xs text-muted-foreground">{new Date(c.lastActivityAt).toLocaleString()}</span>
                {c.status === "abandoned" && c.customerPhone && (
                  <Button size="sm" variant="outline" onClick={() => recover.mutate({ id: c.id, channel: "whatsapp" })}><Send className="h-4 w-4 mr-1" />Recover</Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Recovery attempts</CardTitle></CardHeader>
        <CardContent>
          {events.length === 0 && <p className="text-sm text-muted-foreground">No recovery attempts yet.</p>}
          <div className="divide-y">
            {events.map((e: any) => (
              <div key={e.id} className="py-2 flex items-center gap-3 text-sm">
                <Badge variant={e.status === "recovered" ? "default" : e.status === "failed" ? "destructive" : "secondary"}>{e.status}</Badge>
                <Badge variant="outline">{e.channel}</Badge>
                <span>{e.recipient}</span>
                <span className="text-muted-foreground flex-1">{e.message}</span>
                <span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </Layout>
  );
}
