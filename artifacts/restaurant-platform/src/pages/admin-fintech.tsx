import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout as Layout } from "@/components/layout/AdminLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Banknote } from "lucide-react";

const fmtINR = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function AdminFintechPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: overview } = useQuery<any>({ queryKey: ["admin-fintech-overview"], queryFn: () => apiGet(`/admin/fintech/overview`) });
  const { data: wallets = [] } = useQuery<any[]>({ queryKey: ["admin-fintech-wallets"], queryFn: () => apiGet(`/admin/fintech/wallets`) });
  const { data: commissions = [] } = useQuery<any[]>({ queryKey: ["admin-fintech-commissions"], queryFn: () => apiGet(`/admin/fintech/commissions`) });
  const { data: variances = [] } = useQuery<any[]>({ queryKey: ["admin-fintech-variances"], queryFn: () => apiGet(`/admin/fintech/variances`) });
  const { data: refunds = [] } = useQuery<any[]>({ queryKey: ["admin-fintech-refunds"], queryFn: () => apiGet(`/admin/fintech/refunds`) });
  const { data: offers = [] } = useQuery<any[]>({ queryKey: ["admin-insurance-offers"], queryFn: () => apiGet(`/admin/fintech/insurance-offers`) });

  const [gateway, setGateway] = useState("razorpay");
  const [percentBps, setPercentBps] = useState("200");
  const [fixedFeePaise, setFixedFeePaise] = useState("0");
  const commMut = useMutation({
    mutationFn: (body: any) => apiPost(`/admin/fintech/commissions`, body),
    onSuccess: () => { toast({ title: "Commission saved" }); qc.invalidateQueries({ queryKey: ["admin-fintech-commissions"] }); },
  });

  const [offerSlug, setOfferSlug] = useState("");
  const [offerTitle, setOfferTitle] = useState("");
  const [offerDesc, setOfferDesc] = useState("");
  const [offerPremium, setOfferPremium] = useState("");
  const offerMut = useMutation({
    mutationFn: (body: any) => apiPost(`/admin/fintech/insurance-offers`, body),
    onSuccess: () => { toast({ title: "Offer saved" }); qc.invalidateQueries({ queryKey: ["admin-insurance-offers"] }); setOfferSlug(""); setOfferTitle(""); setOfferDesc(""); setOfferPremium(""); },
  });

  return (
    <Layout>
      <PageHeader title="Fintech (Super Admin)" subtitle="Cross-tenant wallets, commissions and variances" icon={Banknote} />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total wallets</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{overview?.walletAgg?.totalWallets ?? "—"}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Float (balance)</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{overview ? fmtINR(Number(overview.walletAgg.totalBalance)) : "—"}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Net settled (7d)</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{overview ? fmtINR(Number(overview.last7d.netSettled)) : "—"}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Open variances</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-orange-600">{overview?.openVariances ?? 0}</div></CardContent></Card>
        </div>

        <Tabs defaultValue="wallets">
          <TabsList>
            <TabsTrigger value="wallets">Wallets</TabsTrigger>
            <TabsTrigger value="commissions">Commissions</TabsTrigger>
            <TabsTrigger value="variances">Variances</TabsTrigger>
            <TabsTrigger value="refunds">Refunds</TabsTrigger>
            <TabsTrigger value="insurance">Insurance offers</TabsTrigger>
          </TabsList>

          <TabsContent value="wallets">
            <Card><CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr><th className="text-left p-3">#</th><th className="text-left p-3">Tenant</th><th className="text-left p-3">Kind</th><th className="text-right p-3">Balance</th><th className="text-right p-3">Reserved</th><th className="text-left p-3">State</th></tr></thead>
                <tbody>
                  {wallets.map((w: any) => (
                    <tr key={w.id} className="border-t">
                      <td className="p-3 font-mono">{w.id}</td>
                      <td className="p-3">{w.tenantId}</td>
                      <td className="p-3"><Badge variant="secondary">{w.kind}</Badge></td>
                      <td className="p-3 text-right font-mono">{fmtINR(w.balance)}</td>
                      <td className="p-3 text-right font-mono">{fmtINR(w.reserved)}</td>
                      <td className="p-3">{w.isFrozen ? <Badge variant="destructive">Frozen</Badge> : <Badge variant="outline">Active</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="commissions" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Set commission</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                <div><Label>Gateway</Label>
                  <Select value={gateway} onValueChange={setGateway}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{["razorpay", "cashfree", "stripe", "cash", "upi", "manual"].map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Percent (bps)</Label><Input type="number" value={percentBps} onChange={e => setPercentBps(e.target.value)} /></div>
                <div><Label>Fixed fee (paise)</Label><Input type="number" value={fixedFeePaise} onChange={e => setFixedFeePaise(e.target.value)} /></div>
                <Button onClick={() => commMut.mutate({ gateway, percentBps: Number(percentBps), fixedFeePaise: Number(fixedFeePaise), tenantId: null })}>Save</Button>
              </CardContent>
            </Card>
            <Card><CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr><th className="text-left p-3">Gateway</th><th className="text-left p-3">Tenant</th><th className="text-right p-3">%</th><th className="text-right p-3">Fixed fee</th><th className="text-left p-3">Active</th></tr></thead>
                <tbody>
                  {commissions.map((c: any) => (
                    <tr key={c.id} className="border-t">
                      <td className="p-3">{c.gateway}</td>
                      <td className="p-3">{c.tenantId ?? "All"}</td>
                      <td className="p-3 text-right font-mono">{(c.percentBps / 100).toFixed(2)}%</td>
                      <td className="p-3 text-right font-mono">{fmtINR(c.fixedFee)}</td>
                      <td className="p-3"><Badge variant={c.isActive ? "default" : "secondary"}>{c.isActive ? "Yes" : "No"}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="variances">
            <Card><CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr><th className="text-left p-3">Type</th><th className="text-left p-3">Ref</th><th className="text-right p-3">Expected</th><th className="text-right p-3">Actual</th><th className="text-left p-3">Status</th></tr></thead>
                <tbody>
                  {variances.map((v: any) => (
                    <tr key={v.id} className="border-t">
                      <td className="p-3"><Badge variant="secondary">{v.varianceType}</Badge></td>
                      <td className="p-3 font-mono">{v.externalRef ?? "—"}</td>
                      <td className="p-3 text-right font-mono">{v.expectedAmount != null ? fmtINR(v.expectedAmount) : "—"}</td>
                      <td className="p-3 text-right font-mono">{v.actualAmount != null ? fmtINR(v.actualAmount) : "—"}</td>
                      <td className="p-3"><Badge variant="destructive">{v.status}</Badge></td>
                    </tr>
                  ))}
                  {variances.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No open variances.</td></tr>}
                </tbody>
              </table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="refunds">
            <Card><CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr><th className="text-left p-3">When</th><th className="text-left p-3">Tenant</th><th className="text-right p-3">Amount</th><th className="text-left p-3">Type</th><th className="text-left p-3">Status</th></tr></thead>
                <tbody>
                  {refunds.map((r: any) => (
                    <tr key={r.id} className="border-t">
                      <td className="p-3">{new Date(r.createdAt).toLocaleString()}</td>
                      <td className="p-3">{r.tenantId}</td>
                      <td className="p-3 text-right font-mono">{fmtINR(r.amount)}</td>
                      <td className="p-3"><Badge variant="secondary">{r.refundType}</Badge></td>
                      <td className="p-3"><Badge>{r.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="insurance" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Add / update offer</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>Slug</Label><Input value={offerSlug} onChange={e => setOfferSlug(e.target.value)} placeholder="fire-safety" /></div>
                <div><Label>Title</Label><Input value={offerTitle} onChange={e => setOfferTitle(e.target.value)} /></div>
                <div className="col-span-2"><Label>Short description</Label><Input value={offerDesc} onChange={e => setOfferDesc(e.target.value)} /></div>
                <div><Label>Monthly premium (₹)</Label><Input type="number" value={offerPremium} onChange={e => setOfferPremium(e.target.value)} /></div>
                <div className="flex items-end"><Button onClick={() => offerMut.mutate({ slug: offerSlug, title: offerTitle, shortDescription: offerDesc, monthlyPremiumPaise: Math.round(parseFloat(offerPremium || "0") * 100) })}>Save</Button></div>
              </CardContent>
            </Card>
            <Card><CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr><th className="text-left p-3">Slug</th><th className="text-left p-3">Title</th><th className="text-right p-3">From</th><th className="text-left p-3">Active</th></tr></thead>
                <tbody>
                  {offers.map((o: any) => (
                    <tr key={o.id} className="border-t">
                      <td className="p-3 font-mono">{o.slug}</td>
                      <td className="p-3">{o.title}</td>
                      <td className="p-3 text-right font-mono">{fmtINR(o.monthlyPremiumEstimate)}</td>
                      <td className="p-3"><Badge variant={o.isActive ? "default" : "secondary"}>{o.isActive ? "Yes" : "No"}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
