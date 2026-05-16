import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Settlement {
  id: number; vendorId: number; restaurantId: number; settlementDate: string;
  orderCount: number; grossSales: number; commissionAmount: number; netPayable: number;
  status: string; paidAt: string | null; walletTransferGroupId: string | null;
}

const fmt = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

export default function FoodCourtSettlementsPage() {
  const { id } = useParams<{ id: string }>();
  const fcId = Number(id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [date, setDate] = useState("");

  const { data: rows = [] } = useQuery<Settlement[]>({
    queryKey: ["fc-settlements", fcId],
    queryFn: () => apiGet(`/food-courts/${fcId}/settlements`),
  });

  const run = useMutation({
    mutationFn: () => apiPost(`/food-courts/${fcId}/settlements/run`, date ? { settlementDate: date } : {}),
    onSuccess: (r: { results: Array<{ vendorId: number; netPayable: number; error?: string }> }) => {
      const ok = r.results.filter(x => !x.error).length;
      toast({ title: "Settlement run complete", description: `${ok}/${r.results.length} vendors processed` });
      qc.invalidateQueries({ queryKey: ["fc-settlements", fcId] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Layout>
      <PageHeader title="Vendor Settlements" description="Run end-of-day settlements; view paid history."
        actions={
          <div className="flex gap-2">
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-40" />
            <Button onClick={() => run.mutate()} disabled={run.isPending} data-testid="run-settlement">
              {run.isPending ? "Running…" : "Run now"}
            </Button>
          </div>
        }
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead><TableHead>Vendor #</TableHead><TableHead>Orders</TableHead>
                <TableHead>Gross</TableHead><TableHead>Commission</TableHead><TableHead>Net Payable</TableHead>
                <TableHead>Status</TableHead><TableHead>Transfer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No settlements yet</TableCell></TableRow>
              ) : rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell>{r.settlementDate}</TableCell>
                  <TableCell>{r.vendorId}</TableCell>
                  <TableCell>{r.orderCount}</TableCell>
                  <TableCell>{fmt(r.grossSales)}</TableCell>
                  <TableCell>{fmt(r.commissionAmount)}</TableCell>
                  <TableCell><strong>{fmt(r.netPayable)}</strong></TableCell>
                  <TableCell><Badge variant={r.status === "paid" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                  <TableCell className="text-xs font-mono">{r.walletTransferGroupId ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Layout>
  );
}
