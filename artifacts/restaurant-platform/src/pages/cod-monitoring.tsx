import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Banknote, Phone, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
  useCodSummary,
  useCodHandovers,
  useRecordCodHandover,
  type CodSummaryRow,
  type CodHandover,
} from "@/lib/delivery";

export default function CodMonitoringPage() {
  const { data: summary = [] } = useCodSummary();
  const { data: handovers = [] } = useCodHandovers();
  const recordHandover = useRecordCodHandover();
  const { toast } = useToast();

  const [activeRider, setActiveRider] = useState<CodSummaryRow | null>(null);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const totalOutstanding = summary.reduce((sum, r) => sum + Number(r.outstanding), 0);

  const openHandover = (r: CodSummaryRow) => {
    setActiveRider(r);
    setAmount(r.outstanding.toFixed(2));
    setNotes("");
  };

  const submitHandover = async () => {
    if (!activeRider) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }
    try {
      await recordHandover.mutateAsync({ riderId: activeRider.riderId, amount: amt, notes });
      toast({ title: "Handover recorded" });
      setActiveRider(null);
    } catch (e) {
      toast({ title: "Handover failed", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    }
  };

  return (
    <Layout>
      <PageHeader title="COD Monitoring" subtitle="Track cash-on-delivery collected by riders and record handovers" />

      <div className="bg-card border border-border rounded-xl p-4 mb-6 flex items-center gap-4">
        <div className="w-12 h-12 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center">
          <Banknote className="w-6 h-6" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Total cash outstanding with riders</p>
          <p className="text-2xl font-bold text-foreground">₹{totalOutstanding.toLocaleString()}</p>
        </div>
      </div>

      <section className="bg-card border border-border rounded-xl p-4 mb-6">
        <h3 className="text-sm font-semibold mb-3">Outstanding by Rider</h3>
        {summary.length === 0 ? (
          <p className="text-sm text-muted-foreground">No COD activity yet.</p>
        ) : (
          <div className="space-y-2">
            {summary.map((r) => (
              <div key={r.riderId} className="border border-border rounded-lg p-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground">{r.riderName}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-3">
                    {r.riderPhone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{r.riderPhone}</span>}
                    <span>{r.deliveredCount} delivered</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Outstanding</p>
                  <p className="font-bold text-orange-600 tabular-nums">₹{r.outstanding.toLocaleString()}</p>
                </div>
                <Button size="sm" disabled={r.outstanding <= 0} onClick={() => openHandover(r)}>
                  Record Handover
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-3">Recent Handovers</h3>
        {handovers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No handovers recorded.</p>
        ) : (
          <div className="space-y-1.5">
            {handovers.map((h: CodHandover) => (
              <div key={h.id} className="flex items-center justify-between text-sm border-b border-border pb-1.5 last:border-0">
                <div>
                  <p className="font-medium text-foreground">{h.rider.name}</p>
                  <p className="text-xs text-muted-foreground">{format(new Date(h.handedInAt), "MMM d, h:mm a")}{h.notes ? ` · ${h.notes}` : ""}</p>
                </div>
                <p className="font-bold tabular-nums text-green-700">₹{Number(h.amount).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {activeRider && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setActiveRider(null)}>
          <div className="bg-card rounded-xl p-5 max-w-sm w-full space-y-3" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="font-semibold text-foreground">Record COD Handover</h3>
              <p className="text-xs text-muted-foreground">From {activeRider.riderName}</p>
            </div>
            <div className="space-y-2">
              <Label>Amount (₹)</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} step="0.01" min="0" />
              <Label>Notes (optional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. End-of-shift handover" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setActiveRider(null)} disabled={recordHandover.isPending}>Cancel</Button>
              <Button onClick={submitHandover} disabled={recordHandover.isPending}>
                {recordHandover.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Record"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
