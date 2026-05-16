import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiPost, getApiUrl } from "@/lib/api";
import { Wallet, FileText, MessageSquare, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

interface Slip {
  id: number; runId: number; grossPay: string; netPay: string; paidAmount: string;
  paymentStatus: string; periodYear: number; periodMonth: number; runStatus: string;
  finalizedAt: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function PortalPayrollPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: slips = [] } = useQuery<Slip[]>({ queryKey: ["portal-payroll-slips"], queryFn: () => apiFetch("/portal/payroll-slips") });
  const [active, setActive] = useState<Slip | null>(null);
  const [query, setQuery] = useState("");

  const submitQuery = useMutation({
    mutationFn: ({ itemId, body }: { itemId: number; body: string }) => apiPost(`/portal/payroll-slips/${itemId}/queries`, { body }),
    onSuccess: () => {
      toast({ title: "Query sent" });
      setActive(null); setQuery("");
      qc.invalidateQueries({ queryKey: ["portal-payroll-slips"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  function downloadSlip(s: Slip) {
    if (!user?.restaurantId) return;
    const url = getApiUrl(`/restaurants/${user.restaurantId}/payroll-items/${s.id}/slip`);
    window.open(url, "_blank");
  }

  return (
    <PortalLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
        <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2"><Wallet className="w-6 h-6" />Payroll</h1>
        {slips.length === 0 ? <p className="text-sm text-muted-foreground">No payslips yet.</p> : (
          <div className="space-y-2">
            {slips.map(s => (
              <Card key={s.id}><CardContent className="p-4 flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <p className="font-semibold">{MONTHS[s.periodMonth - 1]} {s.periodYear}</p>
                  <p className="text-xs text-muted-foreground">Net ₹{Number(s.netPay).toFixed(0)} · Gross ₹{Number(s.grossPay).toFixed(0)}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <Badge variant={s.runStatus === "finalized" ? "default" : "outline"} className="text-[10px]">{s.runStatus}</Badge>
                    <Badge variant={s.paymentStatus === "paid" ? "default" : "outline"} className="text-[10px]">{s.paymentStatus}</Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => downloadSlip(s)} data-testid={`btn-slip-${s.id}`}><FileText className="w-4 h-4 mr-1" />Slip</Button>
                  <Button size="sm" variant="ghost" onClick={() => setActive(s)} data-testid={`btn-query-${s.id}`}><MessageSquare className="w-4 h-4 mr-1" />Query</Button>
                </div>
              </CardContent></Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!active} onOpenChange={o => !o && setActive(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Raise a query</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{active && `${MONTHS[active.periodMonth - 1]} ${active.periodYear} · Net ₹${Number(active.netPay).toFixed(0)}`}</p>
          <Textarea rows={5} value={query} onChange={e => setQuery(e.target.value)} placeholder="Describe your question or concern…" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setActive(null)}>Cancel</Button>
            <Button onClick={() => active && submitQuery.mutate({ itemId: active.id, body: query })} disabled={!query.trim() || submitQuery.isPending} data-testid="btn-send-query">
              {submitQuery.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}
