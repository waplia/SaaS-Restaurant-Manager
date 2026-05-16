import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiPatch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface FoodCourt { id: number; name: string }
interface Counter {
  vendor: { id: number; stallName: string; counterNumber: string | null; commissionPct: string; commissionType: string };
  foodCourt: { id: number; name: string };
  today: { orderCount: number; sales: string; commission: string; netPayable: string };
  liveSubOrders: Array<{ id: number; status: string; totalAmount: string; subOrderId: number }>;
  settlements: Array<{ id: number; settlementDate: string; orderCount: number; netPayable: number; status: string }>;
}

export default function FoodCourtMyCounterPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [fcId, setFcId] = useState<number | null>(null);

  const { data: courts = [] } = useQuery<FoodCourt[]>({
    queryKey: ["food-courts"],
    queryFn: () => apiGet("/food-courts"),
  });

  const activeFcId = fcId ?? courts[0]?.id ?? null;

  const { data } = useQuery<Counter>({
    queryKey: ["fc-my-counter", activeFcId],
    queryFn: () => apiGet(`/food-courts/${activeFcId}/my-counter`),
    enabled: activeFcId != null,
    refetchInterval: 10_000,
  });

  const advance = useMutation({
    mutationFn: ({ subId, status }: { subId: number; status: string }) =>
      apiPatch(`/food-courts/${activeFcId}/sub-orders/${subId}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fc-my-counter", activeFcId] }),
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Layout>
      <PageHeader title="My Counter" description="Your stall's live orders, today's KPIs and settlement history."
        actions={
          courts.length > 1 ? (
            <Select value={String(activeFcId ?? "")} onValueChange={v => setFcId(Number(v))}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Choose food court" /></SelectTrigger>
              <SelectContent>{courts.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          ) : null
        }
      />
      {!data ? <div className="text-sm text-muted-foreground">Loading…</div> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Orders today</div><div className="text-2xl font-bold">{data.today.orderCount}</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Sales</div><div className="text-2xl font-bold">₹{Number(data.today.sales).toFixed(2)}</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Commission</div><div className="text-2xl font-bold">₹{Number(data.today.commission).toFixed(2)}</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Net Payable</div><div className="text-2xl font-bold">₹{Number(data.today.netPayable).toFixed(2)}</div></CardContent></Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle>Live orders</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Sub #</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead><TableHead></TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.liveSubOrders.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No live orders</TableCell></TableRow>}
                    {data.liveSubOrders.map(s => {
                      const next = s.status === "pending" ? "preparing" : s.status === "preparing" ? "ready" : "served";
                      return (
                        <TableRow key={s.id}>
                          <TableCell>{s.subOrderId}</TableCell>
                          <TableCell><Badge>{s.status}</Badge></TableCell>
                          <TableCell>₹{Number(s.totalAmount).toFixed(2)}</TableCell>
                          <TableCell>
                            {s.status !== "served" && (
                              <Button size="sm" onClick={() => advance.mutate({ subId: s.id, status: next })}>Mark {next}</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Settlement history</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Orders</TableHead><TableHead>Net</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.settlements.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No settlements yet</TableCell></TableRow>}
                    {data.settlements.map(s => (
                      <TableRow key={s.id}>
                        <TableCell>{s.settlementDate}</TableCell>
                        <TableCell>{s.orderCount}</TableCell>
                        <TableCell>₹{(s.netPayable / 100).toFixed(2)}</TableCell>
                        <TableCell><Badge variant={s.status === "paid" ? "default" : "secondary"}>{s.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </Layout>
  );
}
