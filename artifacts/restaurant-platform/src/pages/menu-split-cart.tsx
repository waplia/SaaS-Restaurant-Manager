import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiGet } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";

interface Session { id: number; code: string; status: string; splitMode: string; tableId: number | null; createdAt: string; }

export default function MenuSplitCartPage() {
  const restaurantId = useRestaurantId();
  const { data } = useQuery({ queryKey: ["group-sessions", restaurantId], queryFn: () => apiGet<{ data: Session[] }>(`/restaurants/${restaurantId}/menu-intel/group-sessions`) });
  const split = (data?.data ?? []).filter((s) => s.splitMode === "split");
  return (
    <Layout>
      <PageHeader title="Split Cart at Checkout" description="Guests in split-mode group sessions pay individually." />
      <div className="p-4 sm:p-6 max-w-4xl space-y-3">
        <Card><CardContent className="p-4 text-sm text-muted-foreground">
          Split-cart is enabled per group session. Create a new group session in <span className="font-medium">Group Ordering QR</span> and pick &quot;Split cart&quot; mode. Each guest sees their own checkout total.
        </CardContent></Card>
        {split.map((s) => (
          <Card key={s.id}><CardContent className="p-4 flex items-center gap-3">
            <div className="flex-1">
              <div className="font-mono">{s.code}</div>
              <div className="text-xs text-muted-foreground">Table {s.tableId ?? "—"} · {new Date(s.createdAt).toLocaleString()}</div>
            </div>
            <Badge variant={s.status === "open" ? "default" : "secondary"}>{s.status}</Badge>
          </CardContent></Card>
        ))}
        {split.length === 0 && <p className="text-sm text-muted-foreground">No split-cart sessions active.</p>}
      </div>
    </Layout>
  );
}
