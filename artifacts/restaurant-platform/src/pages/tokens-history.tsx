import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTokensHistory } from "@/lib/hooks-tokens";
import { useRestaurantId } from "@/lib/hooks";
import { useBranchContext } from "@/lib/branch";
import { Download } from "lucide-react";

function isoStartOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString(); }
function isoEndOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x.toISOString(); }

export default function TokensHistoryPage() {
  const restaurantId = useRestaurantId();
  const { selectedBranchId } = useBranchContext();
  const today = new Date();
  const weekAgo = new Date(); weekAgo.setDate(today.getDate() - 7);
  const [from, setFrom] = useState(weekAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));

  const fromIso = isoStartOfDay(new Date(from));
  const toIso = isoEndOfDay(new Date(to));

  const { data: rows = [], isLoading } = useTokensHistory({
    from: fromIso,
    to: toIso,
    branchId: selectedBranchId ?? undefined,
  });

  function downloadCsv() {
    const params = new URLSearchParams({ from: fromIso, to: toIso });
    if (selectedBranchId) params.set("branchId", String(selectedBranchId));
    const url = `/api/restaurants/${restaurantId}/tokens/export.csv?${params.toString()}`;
    const token = localStorage.getItem("tt_access_token");
    fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then(async r => {
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `tokens-${from}-to-${to}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  return (
    <Layout>
      <PageHeader
        title="Token History"
        subtitle="Past tokens and CSV export"
        actions={<Button onClick={downloadCsv} data-testid="button-export-csv"><Download className="w-4 h-4 mr-2" />Export CSV</Button>}
      />
      <div className="p-6 space-y-4">
        <div className="flex gap-3 items-end">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">From</label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} data-testid="input-from-date" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">To</label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} data-testid="input-to-date" />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="p-2">Token</th>
                <th className="p-2">Counter</th>
                <th className="p-2">Status</th>
                <th className="p-2">Customer</th>
                <th className="p-2">Order Type</th>
                <th className="p-2">Order #</th>
                <th className="p-2">Issued</th>
                <th className="p-2">Ready</th>
                <th className="p-2">Served</th>
                <th className="p-2">Recalled</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={10} className="p-4 text-center text-muted-foreground">Loading…</td></tr>}
              {!isLoading && rows.length === 0 && <tr><td colSpan={10} className="p-4 text-center text-muted-foreground">No tokens in range</td></tr>}
              {rows.map(r => (
                <tr key={r.id} className="border-t border-border" data-testid={`history-row-${r.id}`}>
                  <td className="p-2 font-mono font-bold">{r.token}</td>
                  <td className="p-2">{r.counter}</td>
                  <td className="p-2 capitalize">{r.status}</td>
                  <td className="p-2">{r.customerNameRaw ?? "—"}</td>
                  <td className="p-2 capitalize">{r.orderType.replace("_", " ")}</td>
                  <td className="p-2">#{r.orderId}</td>
                  <td className="p-2">{new Date(r.issuedAt).toLocaleString()}</td>
                  <td className="p-2">{r.readyAt ? new Date(r.readyAt).toLocaleString() : "—"}</td>
                  <td className="p-2">{r.servedAt ? new Date(r.servedAt).toLocaleString() : "—"}</td>
                  <td className="p-2">{r.recalledCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
