import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet } from "@/lib/api";
import { TrendingUp, ShoppingCart, Users, IndianRupee } from "lucide-react";

interface DashboardResp {
  range: string;
  totals: { orderCount: number; sales: string };
  vendors: Array<{ vendorId: number; stallName: string; counterNumber?: string | null; orders: number; sales: string; commission: string; refunds: string }>;
  liveTokens: Array<{ id: number; token: string; status: string; totalAmount: string; customerName: string | null; createdAt: string }>;
}

export default function FoodCourtOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const fcId = Number(id);
  const [range, setRange] = useState<"today" | "week" | "month">("today");

  const { data } = useQuery<DashboardResp>({
    queryKey: ["fc-dashboard", fcId, range],
    queryFn: () => apiGet(`/food-courts/${fcId}/dashboard?range=${range}`),
    refetchInterval: 30_000,
  });

  return (
    <Layout>
      <PageHeader title="Food Court Overview" description="Aggregated venue metrics, vendor leaderboard, live tokens." />
      <Tabs value={range} onValueChange={(v) => setRange(v as typeof range)} className="mb-4">
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="week">7 days</TabsTrigger>
          <TabsTrigger value="month">30 days</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <Card><CardContent className="p-4"><div className="flex items-center justify-between"><div><div className="text-xs text-muted-foreground">Total Sales</div><div className="text-2xl font-bold">₹{Number(data?.totals.sales ?? 0).toFixed(2)}</div></div><IndianRupee className="w-6 h-6 text-muted-foreground" /></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center justify-between"><div><div className="text-xs text-muted-foreground">Orders</div><div className="text-2xl font-bold">{data?.totals.orderCount ?? 0}</div></div><ShoppingCart className="w-6 h-6 text-muted-foreground" /></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center justify-between"><div><div className="text-xs text-muted-foreground">Live Tokens</div><div className="text-2xl font-bold">{data?.liveTokens.length ?? 0}</div></div><Users className="w-6 h-6 text-muted-foreground" /></div></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Vendor Leaderboard</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Stall</TableHead><TableHead>Orders</TableHead><TableHead>Sales</TableHead><TableHead>Commission</TableHead></TableRow></TableHeader>
              <TableBody>
                {(data?.vendors ?? []).map(v => (
                  <TableRow key={v.vendorId}>
                    <TableCell>{v.counterNumber ? `#${v.counterNumber} ` : ""}{v.stallName}</TableCell>
                    <TableCell>{v.orders}</TableCell>
                    <TableCell>₹{Number(v.sales).toFixed(2)}</TableCell>
                    <TableCell>₹{Number(v.commission).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                {(data?.vendors ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No data</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Live Tokens</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Token</TableHead><TableHead>Customer</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {(data?.liveTokens ?? []).map(t => (
                  <TableRow key={t.id}>
                    <TableCell><strong>{t.token}</strong></TableCell>
                    <TableCell>{t.customerName ?? "—"}</TableCell>
                    <TableCell><Badge>{t.status}</Badge></TableCell>
                    <TableCell>₹{Number(t.totalAmount).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                {(data?.liveTokens ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No live tokens</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
