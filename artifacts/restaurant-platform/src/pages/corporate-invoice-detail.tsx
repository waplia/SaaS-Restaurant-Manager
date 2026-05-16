import { useState } from "react";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useInvoice, useRecordPayment, useSendInvoiceReminder } from "@/lib/corporate";
import { useToast } from "@/hooks/use-toast";

export default function CorporateInvoiceDetailPage() {
  const [, params] = useRoute("/corporate/invoices/:id");
  const id = Number(params?.id);
  const { data: inv, isLoading } = useInvoice(id);
  const record = useRecordPayment();
  const remind = useSendInvoiceReminder();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank");
  const [reference, setReference] = useState("");

  if (isLoading || !inv) return <div className="p-6">Loading…</div>;

  const submit = async () => {
    try {
      await record.mutateAsync({ invoiceId: id, amount, method, reference });
      toast({ title: "Payment recorded" });
      setOpen(false); setAmount(""); setReference("");
    } catch (e) { toast({ title: "Failed", description: String(e), variant: "destructive" }); }
  };

  const outstanding = (Number(inv.totalAmount) - Number(inv.amountPaid)).toFixed(2);

  return (
    <div className="p-6 space-y-4">
      <Link href="/corporate/invoices"><a className="text-sm text-muted-foreground">← All invoices</a></Link>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{inv.invoiceNumber}</h1>
          <div className="text-sm text-muted-foreground">
            <Link href={`/corporate/companies/${inv.companyId}`}><a className="text-primary">{inv.companyName}</a></Link>
            <span className="ml-2">{inv.periodStart} → {inv.periodEnd}</span>
            <span className="ml-2">Due {inv.dueDate}</span>
            <Badge className="ml-2">{inv.status}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={async () => { await remind.mutateAsync(id); toast({ title: "Reminder logged" }); }}>Send reminder</Button>
          <Button onClick={() => { setAmount(outstanding); setOpen(true); }} disabled={inv.status === "paid"}>Record payment</Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Subtotal</div><div className="text-xl font-semibold">₹{Number(inv.subtotal).toFixed(2)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Tax</div><div className="text-xl font-semibold">₹{Number(inv.taxAmount).toFixed(2)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total</div><div className="text-xl font-semibold">₹{Number(inv.totalAmount).toFixed(2)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Outstanding</div><div className="text-xl font-semibold">₹{outstanding}</div></CardContent></Card>
      </div>

      {inv.departmentBreakdown && inv.departmentBreakdown.length > 0 && (
        <Card><CardHeader><CardTitle>By department / cost centre</CardTitle></CardHeader><CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground"><tr><th>Department</th><th>Orders</th><th>Subtotal</th></tr></thead>
            <tbody>
              {inv.departmentBreakdown.map((d, i) => (
                <tr key={i} className="border-t"><td className="py-2">{d.departmentName}</td><td>{d.orderCount}</td><td>₹{Number(d.subtotal).toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
        </CardContent></Card>
      )}

      <Card><CardHeader><CardTitle>Line items ({inv.lines.length})</CardTitle></CardHeader><CardContent>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground"><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead>
          <tbody>
            {inv.lines.map(l => (
              <tr key={l.id} className="border-t"><td className="py-2">{l.orderedAt ? new Date(l.orderedAt).toLocaleDateString() : "—"}</td><td>{l.description}</td><td>₹{Number(l.amount).toFixed(2)}</td></tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>

      <Card><CardHeader><CardTitle>Payments</CardTitle></CardHeader><CardContent>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground"><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead>
          <tbody>
            {inv.payments.map(p => (
              <tr key={p.id} className="border-t"><td className="py-2">{new Date(p.paidAt).toLocaleString()}</td><td>₹{Number(p.amount).toFixed(2)}</td><td>{p.method}</td><td>{p.reference || "—"}</td></tr>
            ))}
            {inv.payments.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No payments yet.</td></tr>}
          </tbody>
        </table>
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Amount</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
            <div><Label>Method</Label><Input value={method} onChange={e => setMethod(e.target.value)} /></div>
            <div><Label>Reference</Label><Input value={reference} onChange={e => setReference(e.target.value)} /></div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit} disabled={!amount || record.isPending}>Record</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
