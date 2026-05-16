import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost } from "@/lib/api";
import { TrendingUp, ShieldCheck, Banknote } from "lucide-react";

const fmtINR = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export default function CapitalInsurancePage() {
  const restaurantId = useRestaurantId();
  const { toast } = useToast();
  const { data: score } = useQuery<{ score: number; band: string; signals: Record<string, unknown> }>({
    queryKey: ["credit-score", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/capital/credit-score`),
  });
  const { data: offers = [] } = useQuery<Array<any>>({
    queryKey: ["insurance-offers"],
    queryFn: () => apiGet(`/insurance/offers`),
  });

  const [loanAmt, setLoanAmt] = useState("");
  const [loanNotes, setLoanNotes] = useState("");
  const loanMut = useMutation({
    mutationFn: (body: any) => apiPost(`/restaurants/${restaurantId}/capital/loan-interest`, body),
    onSuccess: () => { toast({ title: "Request received", description: "Our team will reach out shortly." }); setLoanAmt(""); setLoanNotes(""); },
  });
  const advanceMut = useMutation({
    mutationFn: (body: any) => apiPost(`/restaurants/${restaurantId}/capital/sales-advance`, body),
    onSuccess: () => toast({ title: "Sales advance request submitted" }),
  });
  const interestMut = useMutation({
    mutationFn: (body: any) => apiPost(`/restaurants/${restaurantId}/insurance/interest`, body),
    onSuccess: () => toast({ title: "Interest registered", description: "We'll get in touch with quotes." }),
  });

  return (
    <Layout>
      <PageHeader title="Capital & Insurance" subtitle="Future-ready: working capital, advances and protection" icon={TrendingUp} />
      <div className="p-6 space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Banknote className="w-4 h-4" /> Restaurant credit signal</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-end gap-6">
              <div>
                <div className="text-5xl font-bold">{score?.score ?? "—"}<span className="text-lg text-muted-foreground">/100</span></div>
                <Badge className="mt-2" variant={score?.band === "excellent" ? "default" : "secondary"}>{score?.band ?? "—"}</Badge>
              </div>
              <p className="text-sm text-muted-foreground max-w-md">A simple, transparent score based on the last 30 days of platform throughput. This is a placeholder signal — no offers are extended automatically.</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Working capital loan</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Indicate interest and our lending partner will reach out.</p>
              <div><Label>Estimated amount needed (₹)</Label><Input type="number" value={loanAmt} onChange={e => setLoanAmt(e.target.value)} /></div>
              <div><Label>Notes</Label><Textarea rows={2} value={loanNotes} onChange={e => setLoanNotes(e.target.value)} /></div>
              <Button disabled={!loanAmt} onClick={() => loanMut.mutate({ requestedPaise: Math.round(parseFloat(loanAmt) * 100), notes: loanNotes })}>Request callback</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Sales advance</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Get an advance against upcoming sales. Repaid as a small percent of future settlements.</p>
              <div><Label>Amount (₹)</Label><Input type="number" placeholder="e.g. 50000" id="adv" /></div>
              <Button onClick={() => {
                const v = (document.getElementById("adv") as HTMLInputElement).value;
                if (!v) return;
                advanceMut.mutate({ requestedPaise: Math.round(parseFloat(v) * 100) });
              }}>Request callback</Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Insurance offers</CardTitle></CardHeader>
          <CardContent>
            {offers.length === 0 ? <p className="text-sm text-muted-foreground">No insurance partners onboarded yet. Check back soon.</p> : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {offers.map((o: any) => (
                  <div key={o.id} className="border rounded-lg p-4">
                    <div className="font-medium">{o.title}</div>
                    <div className="text-xs text-muted-foreground mt-1">{o.shortDescription}</div>
                    <div className="mt-2 text-sm">From <span className="font-mono font-bold">{fmtINR(o.monthlyPremiumEstimate)}</span>/mo</div>
                    <Button size="sm" className="mt-3" onClick={() => interestMut.mutate({ offerId: o.id })}>I'm interested</Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
