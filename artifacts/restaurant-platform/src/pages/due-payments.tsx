import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useDuePayments, useSettlePayment } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { ArrowDownCircle, ArrowUpCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const METHODS = ["cash", "card", "upi", "stripe", "razorpay", "bank", "other"];

function formatINR(amount: string | number) {
  return `₹${Number(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function DuePaymentsPage() {
  const { data, isLoading } = useDuePayments();
  const settle = useSettlePayment();
  const { toast } = useToast();

  const [settling, setSettling] = useState<{
    referenceType: "order" | "purchase_order";
    referenceId: number;
    label: string;
    dueAmount: string;
  } | null>(null);
  const [form, setForm] = useState({ amount: "", method: "cash", notes: "" });

  const openSettle = (
    referenceType: "order" | "purchase_order",
    referenceId: number,
    label: string,
    dueAmount: string,
  ) => {
    setSettling({ referenceType, referenceId, label, dueAmount });
    setForm({ amount: dueAmount, method: "cash", notes: "" });
  };

  const handleSettle = async () => {
    if (!settling) return;
    const amt = Number(form.amount);
    if (!isFinite(amt) || amt <= 0) {
      toast({ title: "Enter a positive amount", variant: "destructive" });
      return;
    }
    try {
      await settle.mutateAsync({
        referenceType: settling.referenceType,
        referenceId: settling.referenceId,
        amount: amt,
        method: form.method,
        notes: form.notes || undefined,
      });
      toast({ title: "Payment settled" });
      setSettling(null);
    } catch (err) {
      toast({ title: "Failed to settle payment", description: String(err), variant: "destructive" });
    }
  };

  return (
    <Layout>
      <PageHeader title="Due Payments" subtitle="Outstanding receivables and supplier payables" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <ArrowDownCircle className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Receivable from customers</p>
                <p className="text-2xl font-bold">{formatINR(data?.totalCustomerDue ?? "0")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-rose-500/10 flex items-center justify-center">
                <ArrowUpCircle className="w-5 h-5 text-rose-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Payable to suppliers</p>
                <p className="text-2xl font-bold">{formatINR(data?.totalSupplierDue ?? "0")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="w-4 h-4 text-emerald-500" />
            <h3 className="font-semibold">From customers — credit balances</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium text-right">Open orders</th>
                  <th className="px-4 py-3 font-medium text-right">Outstanding balance</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={3} className="px-4 py-12 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {!isLoading && (data?.customerCredits.length ?? 0) === 0 && (
                  <tr><td colSpan={3} className="px-4 py-12 text-center text-muted-foreground">No customers with outstanding balance.</td></tr>
                )}
                {data?.customerCredits.map(c => (
                  <tr key={c.customerId} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{c.customerName}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{c.openOrders}</td>
                    <td className="px-4 py-3 text-right font-medium text-rose-500">{formatINR(c.totalDue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="w-4 h-4 text-emerald-500" />
            <h3 className="font-semibold">Customer orders awaiting payment</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                  <th className="px-4 py-3 font-medium text-right">Paid</th>
                  <th className="px-4 py-3 font-medium text-right">Due</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {!isLoading && data?.customerOrders.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No customer dues.</td></tr>
                )}
                {data?.customerOrders.map(o => (
                  <tr key={o.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{o.orderNumber}</td>
                    <td className="px-4 py-3">{o.customerName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(o.createdAt)}</td>
                    <td className="px-4 py-3"><Badge variant="outline" className="capitalize">{o.paymentStatus}</Badge></td>
                    <td className="px-4 py-3 text-right">{formatINR(o.totalAmount)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{formatINR(o.paidAmount)}</td>
                    <td className="px-4 py-3 text-right font-medium text-rose-500">{formatINR(o.dueAmount)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" onClick={() => openSettle("order", o.id, `Order ${o.orderNumber}`, o.dueAmount)}>
                        Settle
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="w-4 h-4 text-rose-500" />
            <h3 className="font-semibold">Open purchase orders</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium">PO #</th>
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Ordered</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                  <th className="px-4 py-3 font-medium text-right">Paid</th>
                  <th className="px-4 py-3 font-medium text-right">Due</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {!isLoading && data?.supplierPOs.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No supplier dues.</td></tr>
                )}
                {data?.supplierPOs.map(po => (
                  <tr key={po.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">#{po.id}</td>
                    <td className="px-4 py-3">{po.supplierName}</td>
                    <td className="px-4 py-3"><Badge variant="outline" className="capitalize">{po.status}</Badge></td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(po.orderedAt)}</td>
                    <td className="px-4 py-3 text-right">{formatINR(po.totalAmount)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{formatINR(po.paidAmount)}</td>
                    <td className="px-4 py-3 text-right font-medium text-rose-500">{formatINR(po.dueAmount)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => openSettle("purchase_order", po.id, `PO #${po.id}`, po.dueAmount)}>
                        Pay
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!settling} onOpenChange={open => !open && setSettling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settle {settling?.label}</DialogTitle>
          </DialogHeader>
          {settling && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Outstanding due: <span className="font-medium text-foreground">{formatINR(settling.dueAmount)}</span>
              </p>
              <div>
                <Label>Amount (₹)</Label>
                <Input type="number" step="0.01" min="0" value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div>
                <Label>Method</Label>
                <Select value={form.method} onValueChange={v => setForm({ ...form, method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes (optional)</Label>
                <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettling(null)}>Cancel</Button>
            <Button onClick={handleSettle} disabled={settle.isPending}>
              {settle.isPending ? "Saving…" : "Settle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
