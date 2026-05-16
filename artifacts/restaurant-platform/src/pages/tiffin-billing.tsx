import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTiffinInvoices, useRunBilling, useMarkInvoicePaid } from "@/lib/tiffin";
import { toast } from "@/hooks/use-toast";

export default function TiffinBillingPage() {
  const [statusFilter, setStatusFilter] = useState("");
  const { data: invoices = [] } = useTiffinInvoices(statusFilter || undefined);
  const runBilling = useRunBilling();
  const markPaid = useMarkInvoicePaid();
  const [showRun, setShowRun] = useState(false);
  const today = new Date();
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10);
  const [period, setPeriod] = useState({ start: lastMonthStart, end: lastMonthEnd });

  const totalOutstanding = invoices.filter(i => i.status !== "paid").reduce((s, i) => s + Number(i.total), 0);
  const totalCollected = invoices.filter(i => i.status === "paid").reduce((s, i) => s + Number(i.total), 0);

  const submitRun = async () => {
    try {
      const r = await runBilling.mutateAsync({ periodStart: period.start, periodEnd: period.end }) as { created: number; total: number };
      toast({ title: "Billing run complete", description: `${r.created} invoices created out of ${r.total} subscriptions` });
      setShowRun(false);
    } catch (err) { toast({ title: "Failed", description: (err as Error).message }); }
  };

  return (
    <Layout>
      <PageHeader
        title="Tiffin Billing"
        subtitle="Monthly invoices, reminders & collections"
        actions={<Button onClick={() => setShowRun(true)}>Run Monthly Billing</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <Stat label="Outstanding" value={`₹${totalOutstanding.toFixed(2)}`} color="text-amber-600" />
        <Stat label="Collected" value={`₹${totalCollected.toFixed(2)}`} color="text-green-600" />
        <Stat label="Total invoices" value={String(invoices.length)} />
      </div>

      <div className="flex gap-2 mb-4">
        {["", "pending", "paid", "overdue"].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-xs rounded-md border ${statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border"}`}>
            {s === "" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {showRun && (
        <div className="bg-card border border-border rounded-xl p-4 mb-4">
          <h3 className="font-semibold mb-3">Run Monthly Billing</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Generates invoices for all active subscriptions for the chosen period, based on actually delivered meals.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label>Period Start</Label><Input type="date" value={period.start} onChange={e => setPeriod({ ...period, start: e.target.value })} /></div>
            <div><Label>Period End</Label><Input type="date" value={period.end} onChange={e => setPeriod({ ...period, end: e.target.value })} /></div>
          </div>
          <div className="flex gap-2 mt-3">
            <Button onClick={submitRun} disabled={runBilling.isPending}>Generate Invoices</Button>
            <Button variant="outline" onClick={() => setShowRun(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="p-3 text-left">Invoice</th>
              <th className="p-3 text-left">Customer</th>
              <th className="p-3 text-left">Period</th>
              <th className="p-3">Meals</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3">Due</th>
              <th className="p-3">Status</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No invoices yet.</td></tr>}
            {invoices.map(inv => (
              <tr key={inv.id} className="border-t border-border">
                <td className="p-3 text-xs font-mono">{inv.invoiceNumber}</td>
                <td className="p-3">
                  <p className="font-medium">{inv.customerName}</p>
                  <p className="text-xs text-muted-foreground">{inv.customerPhone}</p>
                </td>
                <td className="p-3 text-xs">{inv.periodStart} → {inv.periodEnd}</td>
                <td className="p-3 text-center">{inv.mealsDelivered}</td>
                <td className="p-3 text-right font-semibold">₹{inv.total}</td>
                <td className="p-3 text-xs">{inv.dueDate}</td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    inv.status === "paid" ? "bg-green-100 text-green-700" :
                    inv.status === "overdue" ? "bg-red-100 text-red-700" :
                    "bg-amber-100 text-amber-700"
                  }`}>{inv.status}</span>
                </td>
                <td className="p-3 text-right">
                  {inv.status !== "paid" && (
                    <Button size="sm" variant="outline" onClick={() => {
                      const method = prompt("Payment method (cash/upi/card/bank)?", "cash") ?? "cash";
                      markPaid.mutate({ id: inv.id, method });
                    }}>Mark Paid</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </Layout>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold ${color ?? ""}`}>{value}</p>
    </div>
  );
}
