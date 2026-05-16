import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useInvoices, useSendInvoiceReminder } from "@/lib/corporate";
import { useToast } from "@/hooks/use-toast";

export default function CorporateInvoicesPage() {
  const [tab, setTab] = useState<string>("all");
  const { data: invoices, isLoading } = useInvoices(tab === "all" ? {} : { status: tab });
  const remind = useSendInvoiceReminder();
  const { toast } = useToast();

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Corporate invoices</h1>
        <p className="text-sm text-muted-foreground">Monthly invoices, payments, reminders</p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="sent">Sent</TabsTrigger>
          <TabsTrigger value="partially_paid">Partial</TabsTrigger>
          <TabsTrigger value="paid">Paid</TabsTrigger>
          <TabsTrigger value="overdue">Overdue</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card><CardContent className="p-0">
        {isLoading ? <div className="p-6">Loading…</div> : (
          <table className="w-full text-sm">
            <thead className="text-left bg-muted/50"><tr><th className="p-3">Number</th><th>Company</th><th>Period</th><th>Total</th><th>Paid</th><th>Status</th><th>Due</th><th></th></tr></thead>
            <tbody>
              {invoices?.map(inv => (
                <tr key={inv.id} className="border-t">
                  <td className="p-3"><Link href={`/corporate/invoices/${inv.id}`}><a className="text-primary">{inv.invoiceNumber}</a></Link></td>
                  <td>{inv.companyName}</td>
                  <td>{inv.periodStart} → {inv.periodEnd}</td>
                  <td>₹{Number(inv.totalAmount).toFixed(2)}</td>
                  <td>₹{Number(inv.amountPaid).toFixed(2)}</td>
                  <td><Badge variant={inv.status === "paid" ? "default" : inv.status === "overdue" ? "destructive" : "secondary"}>{inv.status}</Badge></td>
                  <td>{inv.dueDate}</td>
                  <td>{inv.status !== "paid" && <Button size="sm" variant="outline" onClick={async () => { await remind.mutateAsync(inv.id); toast({ title: "Reminder logged" }); }}>Remind</Button>}</td>
                </tr>
              ))}
              {invoices?.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No invoices.</td></tr>}
            </tbody>
          </table>
        )}
      </CardContent></Card>
    </div>
  );
}
