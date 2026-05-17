import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiGet } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";

interface Row {
  menuItemId: number;
  name: string;
  price: string;
  impressions: number;
  clicks: number;
  orders: number;
  revenue: string;
}

export default function MenuHeatmapPage() {
  const restaurantId = useRestaurantId();
  const [days, setDays] = useState("30");
  const { data, isLoading } = useQuery({
    queryKey: ["menu-heatmap", restaurantId, days],
    queryFn: () => apiGet<{ data: Row[]; windowDays: number }>(`/restaurants/${restaurantId}/menu-intel/heatmap?days=${days}`),
  });
  const rows = (data?.data ?? []).slice().sort((a, b) => Number(b.revenue) - Number(a.revenue));
  const maxRev = Math.max(1, ...rows.map((r) => Number(r.revenue)));
  return (
    <Layout>
      <PageHeader title="Menu Heatmap" description="Revenue, orders and clicks by item." />
      <div className="px-4 sm:px-6 pb-2 max-w-6xl">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="p-4 sm:p-6 space-y-3 max-w-6xl">
        {isLoading ? <Skeleton className="h-64 w-full" /> : (
          <Card><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3">Item</th>
                  <th className="text-right p-3">Impressions</th>
                  <th className="text-right p-3">Clicks</th>
                  <th className="text-right p-3">Orders</th>
                  <th className="text-right p-3">Revenue</th>
                  <th className="p-3 w-40">Heat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pct = (Number(r.revenue) / maxRev) * 100;
                  return (
                    <tr key={r.menuItemId} className="border-t">
                      <td className="p-3 font-medium">{r.name}</td>
                      <td className="p-3 text-right">{r.impressions}</td>
                      <td className="p-3 text-right">{r.clicks}</td>
                      <td className="p-3 text-right">{r.orders}</td>
                      <td className="p-3 text-right">₹{Number(r.revenue).toFixed(2)}</td>
                      <td className="p-3"><div className="h-2 bg-muted rounded"><div className="h-2 bg-orange-500 rounded" style={{ width: `${pct}%` }} /></div></td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No data yet. Track impressions from your QR menu.</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        )}
      </div>
    </Layout>
  );
}
