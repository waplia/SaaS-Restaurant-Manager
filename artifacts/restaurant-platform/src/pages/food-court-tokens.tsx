import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiGet, apiPatch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface SubLite { id: number; vendorId: number; restaurantId: number; status: string; readyAt: string | null; totalAmount: string }
interface ParentLite { id: number; token: string | null; parentOrderNumber: string; status: string; customerName?: string | null; tableNumber?: string | null; totalAmount: string; pickupMode: string; createdAt: string; subOrders: SubLite[] }

const STATUS_TINT: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  preparing: "bg-amber-100 text-amber-800 dark:bg-amber-900/40",
  ready: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40",
  served: "bg-slate-200 text-slate-700",
  cancelled: "bg-red-100 text-red-700",
  refunded: "bg-red-100 text-red-700",
};

export default function FoodCourtTokensPage() {
  const { id } = useParams<{ id: string }>();
  const fcId = Number(id);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: tokens = [] } = useQuery<ParentLite[]>({
    queryKey: ["fc-tokens", fcId],
    queryFn: () => apiGet(`/food-courts/${fcId}/tokens`),
    refetchInterval: 5_000,
  });

  const advance = useMutation({
    mutationFn: ({ subId, status }: { subId: number; status: string }) =>
      apiPatch(`/food-courts/${fcId}/sub-orders/${subId}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fc-tokens", fcId] }),
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Layout>
      <PageHeader title="Tokens & Display" description="Shared customer-facing token board with per-vendor readiness." />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {tokens.length === 0 && <div className="text-sm text-muted-foreground">No live tokens.</div>}
        {tokens.map(p => (
          <Card key={p.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">{p.token ?? p.parentOrderNumber}</div>
                  <div className="text-xs text-muted-foreground">{p.parentOrderNumber} {p.tableNumber ? `· Table ${p.tableNumber}` : ""}</div>
                </div>
                <Badge>{p.status}</Badge>
              </div>
              <div className="space-y-1">
                {p.subOrders.map(s => (
                  <div key={s.id} className={`flex items-center justify-between p-2 rounded text-xs ${STATUS_TINT[s.status] ?? ""}`}>
                    <span>Sub #{s.id}</span>
                    <span>{s.status}</span>
                    {s.status !== "served" && s.status !== "cancelled" && (
                      <Button size="sm" variant="outline" className="h-6 px-2"
                        onClick={() => advance.mutate({ subId: s.id, status: s.status === "pending" ? "preparing" : s.status === "preparing" ? "ready" : "served" })}>
                        →
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <div className="text-right text-sm">₹{Number(p.totalAmount).toFixed(2)}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </Layout>
  );
}
