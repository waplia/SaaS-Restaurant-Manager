import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, FileText } from "lucide-react";
import { useMonthlyReport, monthlyReportCsvUrl, rupees } from "@/lib/canteen";
import { useRestaurantId } from "@/lib/hooks";

export default function CanteenReportsPage() {
  const rid = useRestaurantId();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data, isLoading } = useMonthlyReport(month);

  return (
    <Layout>
      <PageHeader title="Canteen Reports" subtitle="Monthly summary of orders and recharges"
        actions={
          <div className="flex gap-2">
            <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-44" />
            <a href={monthlyReportCsvUrl(rid, month)} target="_blank" rel="noopener" download>
              <Button variant="outline" data-testid="button-download-csv"><Download className="w-4 h-4 mr-1" />CSV</Button>
            </a>
          </div>
        } />

      <div className="m-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Orders" value={data?.orderCount?.toString() ?? "—"} />
        <Stat label="Total Sales" value={rupees(data?.totalSales)} />
        <Stat label="Total Recharges" value={rupees(data?.totalRecharges)} />
      </div>

      <div className="m-6 bg-card border border-border rounded-xl overflow-x-auto">
        <div className="p-4 border-b border-border font-semibold flex items-center gap-2"><FileText className="w-4 h-4" />Order Log — {month}</div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr><th className="p-3">Order #</th><th className="p-3">Date</th><th className="p-3">Student</th><th className="p-3">Class</th><th className="p-3">Source</th><th className="p-3 text-right">Total</th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && (data?.orders ?? []).length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No orders for this month.</td></tr>}
            {data?.orders.map(o => (
              <tr key={o.id} className="border-t border-border">
                <td className="p-3 font-mono text-xs">{o.orderNumber}</td>
                <td className="p-3">{new Date(o.createdAt).toLocaleString()}</td>
                <td className="p-3">{o.studentName} <span className="text-xs text-muted-foreground">({o.studentCode})</span></td>
                <td className="p-3">{o.className ?? "—"}</td>
                <td className="p-3">{o.paymentSource}</td>
                <td className="p-3 text-right font-semibold">{rupees(o.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="m-6 text-xs text-muted-foreground">
        PDF export is on the roadmap. CSV reports can be opened in Excel or imported into accounting software.
      </div>
    </Layout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
