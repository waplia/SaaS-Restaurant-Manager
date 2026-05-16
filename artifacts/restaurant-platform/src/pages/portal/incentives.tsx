import { useQuery } from "@tanstack/react-query";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { Award } from "lucide-react";

interface Program { id: number; name: string; description: string | null; formula: string | null }
interface Payout { id: number; programId: number | null; period: string; amount: string; status: string; notes: string | null }
interface Data { programs: Program[]; payouts: Payout[]; totals: { earned: number; paid: number; pending: number } }

export default function PortalIncentivesPage() {
  const { data } = useQuery<Data>({ queryKey: ["portal-incentives-full"], queryFn: () => apiFetch("/portal/incentives") });

  return (
    <PortalLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
        <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2"><Award className="w-6 h-6" />Incentives</h1>

        {data && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Earned</p><p className="text-xl font-bold">₹{data.totals.earned.toFixed(0)}</p></CardContent></Card>
              <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Paid</p><p className="text-xl font-bold text-emerald-600">₹{data.totals.paid.toFixed(0)}</p></CardContent></Card>
              <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Pending</p><p className="text-xl font-bold text-amber-600">₹{data.totals.pending.toFixed(0)}</p></CardContent></Card>
            </div>

            <section>
              <h2 className="font-semibold mb-2 text-sm">Active programs</h2>
              {data.programs.length === 0 ? <p className="text-sm text-muted-foreground">No active programs.</p> : (
                <div className="space-y-2">
                  {data.programs.map(p => (
                    <Card key={p.id}><CardContent className="p-3">
                      <p className="font-medium">{p.name}</p>
                      {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                      {p.formula && <p className="text-xs mt-1"><span className="text-muted-foreground">How:</span> {p.formula}</p>}
                    </CardContent></Card>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="font-semibold mb-2 text-sm">My payouts</h2>
              {data.payouts.length === 0 ? <p className="text-sm text-muted-foreground">No payouts yet.</p> : (
                <div className="space-y-2">
                  {data.payouts.map(p => (
                    <Card key={p.id}><CardContent className="p-3 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{p.period}</p>
                        {p.notes && <p className="text-xs text-muted-foreground">{p.notes}</p>}
                      </div>
                      <div className="text-right">
                        <p className="font-bold">₹{Number(p.amount).toFixed(0)}</p>
                        <Badge variant={p.status === "paid" ? "default" : "outline"} className="text-[10px]">{p.status}</Badge>
                      </div>
                    </CardContent></Card>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </PortalLayout>
  );
}
