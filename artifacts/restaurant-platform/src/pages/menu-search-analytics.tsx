import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { apiGet } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";

interface Row { query: string; count: number; zeroResultCount: number; lastSeen: string; }

export default function MenuSearchAnalyticsPage() {
  const restaurantId = useRestaurantId();
  const [days, setDays] = useState("30");
  const { data } = useQuery({
    queryKey: ["search", restaurantId, days],
    queryFn: () => apiGet<{ data: Row[] }>(`/restaurants/${restaurantId}/menu-intel/search-analytics?days=${days}`),
  });
  const rows = data?.data ?? [];
  return (
    <Layout>
      <PageHeader title="Menu Search Analytics" description="What guests search on your QR menu." />
      <div className="px-4 sm:px-6 max-w-5xl">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="p-4 sm:p-6 max-w-5xl">
        <Card><CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr><th className="text-left p-3">Query</th><th className="text-right p-3">Searches</th><th className="text-right p-3">Zero-result</th><th className="text-right p-3">Last seen</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.query} className="border-t">
                  <td className="p-3">{r.query} {r.zeroResultCount > 0 && <Badge variant="destructive" className="ml-2">missing</Badge>}</td>
                  <td className="p-3 text-right">{r.count}</td>
                  <td className="p-3 text-right">{r.zeroResultCount}</td>
                  <td className="p-3 text-right text-muted-foreground">{new Date(r.lastSeen).toLocaleString()}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No searches yet.</td></tr>}
            </tbody>
          </table>
        </CardContent></Card>
      </div>
    </Layout>
  );
}
