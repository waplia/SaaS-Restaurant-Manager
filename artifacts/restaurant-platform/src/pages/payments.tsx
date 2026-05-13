import { useState, useMemo } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  usePayments, usePaymentSummary, useCreatePayment,
} from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Banknote, CreditCard, Smartphone, Globe, ArrowUpCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const METHODS = ["cash", "card", "upi", "stripe", "razorpay", "bank", "other"];
const DIRECTIONS = [
  { value: "in", label: "Incoming" },
  { value: "out", label: "Outgoing" },
];

function formatINR(amount: string | number) {
  return `₹${Number(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(d: string) {
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

export default function PaymentsPage() {
  const { user } = useAuth();
  const isWaiter = user?.role === "waiter" && !user?.isSuperAdmin;
  const { toast } = useToast();

  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [method, setMethod] = useState<string>("");
  const [direction, setDirection] = useState<string>("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const filters = useMemo(() => ({
    from, to,
    method: method || undefined,
    direction: direction || undefined,
    page, pageSize,
  }), [from, to, method, direction, page]);

  const { data: paymentsData, isLoading } = usePayments(filters);
  const { data: summary } = usePaymentSummary({ from, to });
  const createPayment = useCreatePayment();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    direction: "in",
    method: "cash",
    amount: "",
    partyType: "other",
    partyName: "",
    notes: "",
    paymentDate: today(),
  });

  const resetForm = () => setForm({
    direction: "in", method: "cash", amount: "", partyType: "other",
    partyName: "", notes: "", paymentDate: today(),
  });

  const handleSubmit = async () => {
    const amt = Number(form.amount);
    if (!isFinite(amt) || amt <= 0) {
      toast({ title: "Enter a positive amount", variant: "destructive" });
      return;
    }
    try {
      await createPayment.mutateAsync({
        direction: form.direction as "in" | "out",
        method: form.method,
        amount: amt,
        partyType: form.partyType as "customer" | "supplier" | "other",
        partyName: form.partyName || undefined,
        referenceType: "manual",
        notes: form.notes || undefined,
        paymentDate: form.paymentDate ? new Date(form.paymentDate).toISOString() : undefined,
      });
      toast({ title: "Payment recorded" });
      setOpen(false);
      resetForm();
    } catch (err) {
      toast({ title: "Failed to record payment", description: String(err), variant: "destructive" });
    }
  };

  const totalPages = paymentsData ? Math.max(1, Math.ceil(paymentsData.total / pageSize)) : 1;

  return (
    <Layout>
      <PageHeader title="Payments" subtitle="Money in and money out across all channels" />

      {(() => {
        const cashIn = Number(summary?.in?.cash?.total ?? 0);
        const cardIn = Number(summary?.in?.card?.total ?? 0);
        const upiIn = Number(summary?.in?.upi?.total ?? 0);
        const onlineIn = Number(summary?.in?.stripe?.total ?? 0) + Number(summary?.in?.razorpay?.total ?? 0);
        const totalOut = Number(summary?.totalOut ?? 0);
        const cards = [
          { label: "Cash In", value: cashIn, icon: Banknote, bg: "bg-emerald-500/10", fg: "text-emerald-500" },
          { label: "Card In", value: cardIn, icon: CreditCard, bg: "bg-blue-500/10", fg: "text-blue-500" },
          { label: "UPI In", value: upiIn, icon: Smartphone, bg: "bg-violet-500/10", fg: "text-violet-500" },
          { label: "Online In (Stripe/Razorpay)", value: onlineIn, icon: Globe, bg: "bg-indigo-500/10", fg: "text-indigo-500" },
          { label: "Total Out", value: totalOut, icon: ArrowUpCircle, bg: "bg-rose-500/10", fg: "text-rose-500" },
        ];
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            {cards.map(({ label, value, icon: Icon, bg, fg }) => (
              <Card key={label}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center`}>
                      <Icon className={`w-5 h-5 ${fg}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground truncate">{label}</p>
                      <p className="text-xl font-bold">{formatINR(value)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        );
      })()}

      {summary && (Object.keys(summary.in).length > 0 || Object.keys(summary.out).length > 0) && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <p className="text-sm font-medium mb-3">By payment method</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {METHODS.map(m => {
                const i = summary.in[m]?.total;
                const o = summary.out[m]?.total;
                if (!i && !o) return null;
                return (
                  <div key={m} className="rounded-lg border bg-card p-3">
                    <p className="text-xs uppercase text-muted-foreground tracking-wide">{m}</p>
                    {i && <p className="text-sm text-emerald-500">+ {formatINR(i)}</p>}
                    {o && <p className="text-sm text-rose-500">− {formatINR(o)}</p>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[140px]">
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} />
            </div>
            <div className="flex-1 min-w-[140px]">
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} />
            </div>
            <div className="flex-1 min-w-[140px]">
              <Label className="text-xs">Direction</Label>
              <Select value={direction || "all"} onValueChange={v => { setDirection(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {DIRECTIONS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[140px]">
              <Label className="text-xs">Method</Label>
              <Select value={method || "all"} onValueChange={v => { setMethod(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="w-4 h-4 mr-2" />Record payment</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Record manual payment</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Direction</Label>
                    <Select
                      value={form.direction}
                      onValueChange={v => setForm({ ...form, direction: v, method: isWaiter ? "cash" : form.method })}
                      disabled={isWaiter}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="in">Incoming (money in)</SelectItem>
                        {!isWaiter && <SelectItem value="out">Outgoing (money out)</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Method</Label>
                    <Select
                      value={form.method}
                      onValueChange={v => setForm({ ...form, method: v })}
                      disabled={isWaiter}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(isWaiter ? ["cash"] : METHODS).map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Amount (₹)</Label>
                    <Input type="number" step="0.01" min="0" value={form.amount}
                      onChange={e => setForm({ ...form, amount: e.target.value })} />
                  </div>
                  <div>
                    <Label>Party type</Label>
                    <Select value={form.partyType} onValueChange={v => setForm({ ...form, partyType: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="customer">Customer</SelectItem>
                        <SelectItem value="supplier">Supplier</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Party name (optional)</Label>
                    <Input value={form.partyName} onChange={e => setForm({ ...form, partyName: e.target.value })} placeholder="e.g. Walk-in customer" />
                  </div>
                  <div>
                    <Label>Date</Label>
                    <Input type="date" value={form.paymentDate} onChange={e => setForm({ ...form, paymentDate: e.target.value })} />
                  </div>
                  <div>
                    <Label>Notes (optional)</Label>
                    <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={handleSubmit} disabled={createPayment.isPending}>
                    {createPayment.isPending ? "Saving…" : "Record payment"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Direction</th>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium">Party</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium">Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {!isLoading && paymentsData?.data.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No payments in this range.</td></tr>
                )}
                {paymentsData?.data.map(p => (
                  <tr key={p.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3">{formatDateTime(p.paymentDate)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={p.direction === "in" ? "default" : "secondary"}>
                        {p.direction === "in" ? "In" : "Out"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 capitalize">{p.method}</td>
                    <td className="px-4 py-3">{p.partyName ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.reference ?? "—"}</td>
                    <td className={`px-4 py-3 text-right font-medium ${p.direction === "in" ? "text-emerald-500" : "text-rose-500"}`}>
                      {p.direction === "in" ? "+" : "−"} {formatINR(p.amount)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{p.recordedByName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {paymentsData && totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-xs text-muted-foreground">
                Page {page} of {totalPages} · {paymentsData.total} total
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </Layout>
  );
}
