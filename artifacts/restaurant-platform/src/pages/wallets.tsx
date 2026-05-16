import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Wallet, ArrowDownToLine, ArrowUpToLine, RefreshCw, Gift, Percent, Users as UsersIcon } from "lucide-react";

const fmtINR = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const idemKey = () => `ui_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

interface WalletRow {
  id: number; kind: string; balance: number; reserved: number;
  lifetimeIn: number; lifetimeOut: number; isFrozen: boolean; currency: string;
}
interface Tx {
  id: number; direction: string; amount: number; type: string; channel: string | null;
  openingBalance: number; closingBalance: number; createdAt: string; notes: string | null;
}

export default function WalletsPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [topupOpen, setTopupOpen] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  const [topupAmt, setTopupAmt] = useState("");
  const [topupChannel, setTopupChannel] = useState("manual");

  const { data, refetch } = useQuery<{ restaurant: WalletRow; subscription: WalletRow; customerWalletsSample: WalletRow[] }>({
    queryKey: ["wallets", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/wallets`),
  });
  const restaurantWallet = data?.restaurant;
  const subWallet = data?.subscription;

  const { data: txs } = useQuery<{ wallet: WalletRow; transactions: Tx[] }>({
    queryKey: ["wallet-tx", restaurantWallet?.id],
    enabled: !!restaurantWallet?.id,
    queryFn: () => apiGet(`/restaurants/${restaurantId}/wallets/${restaurantWallet!.id}/transactions`),
  });

  const topupMut = useMutation({
    mutationFn: (body: { amountPaise: number; channel: string; idempotencyKey: string; notes?: string }) =>
      apiPost(`/restaurants/${restaurantId}/wallets/${restaurantWallet!.id}/topup`, body),
    onSuccess: () => { toast({ title: "Top-up recorded" }); setTopupOpen(false); setTopupAmt(""); refetch(); qc.invalidateQueries({ queryKey: ["wallet-tx"] }); },
    onError: (e: Error) => toast({ title: "Top-up failed", description: e.message, variant: "destructive" }),
  });

  const { data: giftCards = [] } = useQuery<Array<{ id: number; code: string; initialAmount: number; status: string; recipientName: string | null; createdAt: string }>>({
    queryKey: ["gift-cards", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/gift-cards`),
  });

  const [gcAmt, setGcAmt] = useState("");
  const [gcRecipient, setGcRecipient] = useState("");
  const issueMut = useMutation({
    mutationFn: (body: { initialAmountPaise: number; recipientName?: string }) =>
      apiPost(`/restaurants/${restaurantId}/gift-cards`, body),
    onSuccess: () => { toast({ title: "Gift card issued" }); setGiftOpen(false); setGcAmt(""); setGcRecipient(""); qc.invalidateQueries({ queryKey: ["gift-cards"] }); },
    onError: (e: Error) => toast({ title: "Issue failed", description: e.message, variant: "destructive" }),
  });

  const { data: cashbackRules = [] } = useQuery<Array<{ id: number; name: string; percentBps: number; capAmount: number; minOrderAmount: number; isActive: boolean }>>({
    queryKey: ["cashback-rules", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/cashback-rules`),
  });

  return (
    <Layout>
      <PageHeader title="Wallet" subtitle="Track money flowing through your restaurant" icon={Wallet} />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2"><Wallet className="w-4 h-4" /> Restaurant balance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{restaurantWallet ? fmtINR(restaurantWallet.balance) : "—"}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Reserved: {restaurantWallet ? fmtINR(restaurantWallet.reserved) : "—"} · Available: {restaurantWallet ? fmtINR(restaurantWallet.balance - restaurantWallet.reserved) : "—"}
              </div>
              {restaurantWallet?.isFrozen && <Badge variant="destructive" className="mt-2">Frozen</Badge>}
              <div className="flex gap-2 mt-4">
                <Button size="sm" onClick={() => setTopupOpen(true)}><ArrowDownToLine className="w-4 h-4 mr-1" /> Top up</Button>
                <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Lifetime in / out</CardTitle></CardHeader>
            <CardContent>
              <div className="flex justify-between"><span className="text-green-600">↑ {restaurantWallet ? fmtINR(restaurantWallet.lifetimeIn) : "—"}</span><span className="text-red-600">↓ {restaurantWallet ? fmtINR(restaurantWallet.lifetimeOut) : "—"}</span></div>
              <div className="text-xs text-muted-foreground mt-2">Net throughput from settled order payments, payouts and refunds</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Subscription wallet</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{subWallet ? fmtINR(subWallet.balance) : "—"}</div>
              <div className="text-xs text-muted-foreground mt-1">Used to auto-debit your platform subscription</div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="ledger">
          <TabsList>
            <TabsTrigger value="ledger">Ledger</TabsTrigger>
            <TabsTrigger value="gift_cards"><Gift className="w-4 h-4 mr-1" /> Gift cards</TabsTrigger>
            <TabsTrigger value="cashback"><Percent className="w-4 h-4 mr-1" /> Cashback</TabsTrigger>
            <TabsTrigger value="customer_wallets"><UsersIcon className="w-4 h-4 mr-1" /> Customer wallets</TabsTrigger>
          </TabsList>

          <TabsContent value="ledger">
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr><th className="text-left p-3">When</th><th className="text-left p-3">Type</th><th className="text-left p-3">Channel</th><th className="text-right p-3">Amount</th><th className="text-right p-3">Balance</th><th className="text-left p-3">Notes</th></tr>
                  </thead>
                  <tbody>
                    {(txs?.transactions ?? []).map(t => (
                      <tr key={t.id} className="border-t">
                        <td className="p-3 whitespace-nowrap">{new Date(t.createdAt).toLocaleString("en-IN")}</td>
                        <td className="p-3"><Badge variant="secondary">{t.type}</Badge></td>
                        <td className="p-3 text-muted-foreground">{t.channel ?? "—"}</td>
                        <td className={`p-3 text-right font-mono ${t.direction === "credit" ? "text-green-600" : "text-red-600"}`}>{t.direction === "credit" ? "+" : "−"}{fmtINR(t.amount)}</td>
                        <td className="p-3 text-right font-mono">{fmtINR(t.closingBalance)}</td>
                        <td className="p-3 text-muted-foreground truncate max-w-xs">{t.notes ?? ""}</td>
                      </tr>
                    ))}
                    {(!txs || txs.transactions.length === 0) && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No ledger entries yet.</td></tr>}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="gift_cards">
            <div className="flex justify-between mb-3"><div /><Button onClick={() => setGiftOpen(true)}>Issue gift card</Button></div>
            <Card><CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr><th className="text-left p-3">Code</th><th className="text-left p-3">Recipient</th><th className="text-right p-3">Amount</th><th className="text-left p-3">Status</th><th className="text-left p-3">Issued</th></tr></thead>
                <tbody>
                  {giftCards.map(g => (
                    <tr key={g.id} className="border-t">
                      <td className="p-3 font-mono">{g.code}</td>
                      <td className="p-3">{g.recipientName ?? "—"}</td>
                      <td className="p-3 text-right font-mono">{fmtINR(g.initialAmount)}</td>
                      <td className="p-3"><Badge variant={g.status === "active" ? "default" : "secondary"}>{g.status}</Badge></td>
                      <td className="p-3 text-muted-foreground">{new Date(g.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {giftCards.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No gift cards yet.</td></tr>}
                </tbody>
              </table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="cashback">
            <Card><CardContent className="p-4 space-y-3">
              {cashbackRules.length === 0 ? <p className="text-sm text-muted-foreground">No cashback rules configured. Define one to automatically credit customers' cashback wallet on each order.</p> : null}
              {cashbackRules.map(r => (
                <div key={r.id} className="flex items-center justify-between border rounded-lg p-3">
                  <div>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">{(r.percentBps / 100).toFixed(2)}% · cap {fmtINR(r.capAmount)} · min order {fmtINR(r.minOrderAmount)}</div>
                  </div>
                  <Badge variant={r.isActive ? "default" : "secondary"}>{r.isActive ? "Active" : "Off"}</Badge>
                </div>
              ))}
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="customer_wallets">
            <Card><CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr><th className="text-left p-3">Customer wallet #</th><th className="text-left p-3">Kind</th><th className="text-right p-3">Balance</th><th className="text-right p-3">Lifetime in</th></tr></thead>
                <tbody>
                  {(data?.customerWalletsSample ?? []).map(w => (
                    <tr key={w.id} className="border-t">
                      <td className="p-3">#{w.id}</td><td className="p-3"><Badge variant="secondary">{w.kind}</Badge></td>
                      <td className="p-3 text-right font-mono">{fmtINR(w.balance)}</td>
                      <td className="p-3 text-right font-mono">{fmtINR(w.lifetimeIn)}</td>
                    </tr>
                  ))}
                  {(!data?.customerWalletsSample || data.customerWalletsSample.length === 0) && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No customer wallets yet.</td></tr>}
                </tbody>
              </table>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={topupOpen} onOpenChange={setTopupOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Top up restaurant wallet</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Amount (₹)</Label><Input type="number" value={topupAmt} onChange={e => setTopupAmt(e.target.value)} placeholder="0.00" /></div>
            <div><Label>Channel</Label>
              <Select value={topupChannel} onValueChange={setTopupChannel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["manual", "cash", "bank", "upi", "gateway"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopupOpen(false)}>Cancel</Button>
            <Button disabled={!topupAmt || topupMut.isPending} onClick={() => topupMut.mutate({ amountPaise: Math.round(parseFloat(topupAmt) * 100), channel: topupChannel, idempotencyKey: idemKey() })}>Top up</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={giftOpen} onOpenChange={setGiftOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Issue gift card</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Recipient (optional)</Label><Input value={gcRecipient} onChange={e => setGcRecipient(e.target.value)} placeholder="e.g. Anita Singh" /></div>
            <div><Label>Amount (₹)</Label><Input type="number" value={gcAmt} onChange={e => setGcAmt(e.target.value)} placeholder="500.00" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGiftOpen(false)}>Cancel</Button>
            <Button disabled={!gcAmt || issueMut.isPending} onClick={() => issueMut.mutate({ initialAmountPaise: Math.round(parseFloat(gcAmt) * 100), recipientName: gcRecipient || undefined })}>Issue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
