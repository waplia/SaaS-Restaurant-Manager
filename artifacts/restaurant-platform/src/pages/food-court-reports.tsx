import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet } from "@/lib/api";

interface Row {
  vendorId: number; stallName: string; counterNumber: string | null;
  orders: number; grossSales: string; taxes: string; refunds: string; commission: string; netPayable: string;
}

export default function FoodCourtReportsPage() {
  const { id } = useParams<{ id: string }>();
  const fcId = Number(id);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data, refetch, isFetching } = useQuery<{ rows: Row[]; from: string; to: string }>({
    queryKey: ["fc-vendor-sales", fcId, from, to],
    queryFn: () => apiGet(`/food-courts/${fcId}/reports/vendor-sales?from=${from}&to=${to}`),
  });

  const exportCsv = () => {
    if (!data?.rows.length) return;
    const header = "Counter,Stall,Orders,Gross,Taxes,Refunds,Commission,NetPayable\n";
    const body = data.rows.map(r => `${r.counterNumber ?? ""},${r.stallName},${r.orders},${r.grossSales},${r.taxes},${r.refunds},${r.commission},${r.netPayable}`).join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `food-court-${fcId}-vendor-sales.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Layout>
      <PageHeader title="Vendor-wise Sales Report" description="Vendor-level sales over a date range."
        actions={<Button onClick={exportCsv} variant="outline">Export CSV</Button>}
      />
      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-end gap-2">
          <div><label className="text-xs">From</label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><label className="text-xs">To</label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          <Button onClick={() => refetch()} disabled={isFetching}>{isFetching ? "Loading…" : "Apply"}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Counter</TableHead><TableHead>Stall</TableHead><TableHead>Orders</TableHead>
                <TableHead>Gross</TableHead><TableHead>Taxes</TableHead><TableHead>Refunds</TableHead>
                <TableHead>Commission</TableHead><TableHead>Net Payable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.rows ?? []).map(r => (
                <TableRow key={r.vendorId}>
                  <TableCell>{r.counterNumber ?? "—"}</TableCell>
                  <TableCell>{r.stallName}</TableCell>
                  <TableCell>{r.orders}</TableCell>
                  <TableCell>₹{Number(r.grossSales).toFixed(2)}</TableCell>
                  <TableCell>₹{Number(r.taxes).toFixed(2)}</TableCell>
                  <TableCell>₹{Number(r.refunds).toFixed(2)}</TableCell>
                  <TableCell>₹{Number(r.commission).toFixed(2)}</TableCell>
                  <TableCell><strong>₹{Number(r.netPayable).toFixed(2)}</strong></TableCell>
                </TableRow>
              ))}
              {(data?.rows ?? []).length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No data</TableCell></TableRow>}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
    </Layout>
  );
}
