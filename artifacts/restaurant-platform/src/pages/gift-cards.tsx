import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiAction, apiPatch, getApiUrl } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Gift, Plus, Search, Download, Send, RotateCcw, XCircle } from "lucide-react";

const fmt = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const idem = () => `gc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

interface Card {
  id: number; code: string; cardType: string; status: string; initialAmount: number; balance: number;
  recipientName: string | null; recipientEmail: string | null; expiresAt: string | null; createdAt: string;
}

export default function GiftCardsPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState("cards");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [issueOpen, setIssueOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [lookup, setLookup] = useState("");

  const { data: cards = [], refetch } = useQuery<Card[]>({
    queryKey: ["gift-cards-list", restaurantId, filterType, filterStatus],
    enabled: !!restaurantId,
    queryFn: () => {
      const p = new URLSearchParams();
      if (filterType !== "all") p.set("type", filterType);
      if (filterStatus !== "all") p.set("status", filterStatus);
      return apiGet(`/restaurants/${restaurantId}/gift-cards?${p.toString()}`);
    },
  });

  const { data: settings, refetch: refetchSettings } = useQuery<{
    refundsAllowed: boolean; refundWindowDays: number; refundPartiallyUsed: boolean;
    defaultRefundDestination: "source" | "store_credit"; defaultExpiryDays: number; maskCodeForStaff: boolean;
  }>({
    queryKey: ["gift-card-settings", restaurantId],
    enabled: !!restaurantId,
    queryFn: () => apiGet(`/restaurants/${restaurantId}/gift-cards/settings`),
  });

  const { data: report } = useQuery<{
    totals: { cardsIssued: number; issuedAmount: number; redeemedAmount: number; outstandingLiability: number; refundedAmount: number; breakageAmount: number };
    byType: Record<string, { issued: number; redeemed: number; outstanding: number; count: number }>;
    byOutlet: Record<string, { issued: number; redeemed: number; outstanding: number; count: number }>;
  }>({
    queryKey: ["gift-card-report", restaurantId],
    enabled: !!restaurantId && tab === "report",
    queryFn: () => apiGet(`/restaurants/${restaurantId}/gift-cards/report/sales`),
  });

  return (
    <Layout>
      <PageHeader title="Gift Cards" subtitle="Issue, redeem and manage digital, physical and corporate gift cards" />
      <div className="p-6 space-y-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="cards">Cards</TabsTrigger>
            <TabsTrigger value="report">Sales report</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="cards" className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div className="flex flex-wrap gap-2 items-center">
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="digital">Digital</SelectItem>
                    <SelectItem value="physical">Physical</SelectItem>
                    <SelectItem value="corporate">Corporate</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="redeemed">Redeemed</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                    <SelectItem value="refunded">Refunded</SelectItem>
                    <SelectItem value="void">Void</SelectItem>
                  </SelectContent>
                </Select>
                <LookupBar value={lookup} onChange={setLookup} restaurantId={restaurantId} onPick={(id) => setDetailId(id)} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setBatchOpen(true)}><Plus className="w-4 h-4 mr-1" /> Bulk issue</Button>
                <Button onClick={() => setIssueOpen(true)}><Plus className="w-4 h-4 mr-1" /> Issue card</Button>
              </div>
            </div>

            <Card><CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3">Code</th>
                    <th className="text-left p-3">Type</th>
                    <th className="text-left p-3">Recipient</th>
                    <th className="text-right p-3">Initial</th>
                    <th className="text-right p-3">Balance</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-left p-3">Issued</th>
                    <th className="text-left p-3">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map(c => (
                    <tr key={c.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setDetailId(c.id)}>
                      <td className="p-3 font-mono">{c.code}</td>
                      <td className="p-3"><Badge variant="outline">{c.cardType}</Badge></td>
                      <td className="p-3">{c.recipientName ?? c.recipientEmail ?? "—"}</td>
                      <td className="p-3 text-right font-mono">{fmt(c.initialAmount)}</td>
                      <td className="p-3 text-right font-mono">{fmt(c.balance)}</td>
                      <td className="p-3"><StatusBadge status={c.status} /></td>
                      <td className="p-3 text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</td>
                      <td className="p-3 text-muted-foreground">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                  {cards.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No gift cards yet. Issue your first one.</td></tr>}
                </tbody>
              </table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="report" className="space-y-4">
            {report && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  <SummaryTile label="Cards issued" value={String(report.totals.cardsIssued)} />
                  <SummaryTile label="Total issued" value={fmt(report.totals.issuedAmount)} />
                  <SummaryTile label="Redeemed" value={fmt(report.totals.redeemedAmount)} />
                  <SummaryTile label="Outstanding" value={fmt(report.totals.outstandingLiability)} />
                  <SummaryTile label="Refunded" value={fmt(report.totals.refundedAmount)} />
                  <SummaryTile label="Breakage" value={fmt(report.totals.breakageAmount)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">By type</CardTitle></CardHeader>
                    <CardContent className="p-0">
                      <BreakdownTable rows={Object.entries(report.byType).map(([k, v]) => ({ key: k, ...v }))} />
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">By outlet</CardTitle></CardHeader>
                    <CardContent className="p-0">
                      <BreakdownTable rows={Object.entries(report.byOutlet).map(([k, v]) => ({ key: k, ...v }))} />
                    </CardContent>
                  </Card>
                </div>
                <Button variant="outline" onClick={() => window.open(getApiUrl(`/restaurants/${restaurantId}/gift-cards/report/sales?format=csv`), "_blank")}>
                  <Download className="w-4 h-4 mr-1" /> Export CSV
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="settings">
            {settings && (
              <SettingsPanel
                settings={settings}
                onSave={async (patch) => {
                  await apiPatch(`/restaurants/${restaurantId}/gift-cards/settings`, patch);
                  toast({ title: "Settings saved" });
                  refetchSettings();
                }}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>

      <IssueDialog
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        onIssued={() => { refetch(); qc.invalidateQueries({ queryKey: ["gift-cards-list"] }); }}
        restaurantId={restaurantId}
      />
      <BatchDialog
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        onIssued={(batchId) => {
          refetch();
          window.open(getApiUrl(`/restaurants/${restaurantId}/gift-cards/batches/${batchId}/export.csv`), "_blank");
        }}
        restaurantId={restaurantId}
      />
      {detailId && (
        <DetailDrawer
          giftCardId={detailId}
          restaurantId={restaurantId}
          onClose={() => setDetailId(null)}
          onChanged={() => { refetch(); qc.invalidateQueries({ queryKey: ["gift-cards-list"] }); }}
        />
      )}
    </Layout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700",
    redeemed: "bg-slate-100 text-slate-700",
    expired: "bg-amber-100 text-amber-700",
    refunded: "bg-blue-100 text-blue-700",
    void: "bg-rose-100 text-rose-700",
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls[status] ?? "bg-muted"}`}>{status}</span>;
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </CardContent></Card>
  );
}

function BreakdownTable({ rows }: { rows: Array<{ key: string; issued: number; redeemed: number; outstanding: number; count: number }> }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/50">
        <tr><th className="text-left p-2">Key</th><th className="text-right p-2">Count</th><th className="text-right p-2">Issued</th><th className="text-right p-2">Redeemed</th><th className="text-right p-2">Outstanding</th></tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.key} className="border-t">
            <td className="p-2">{r.key}</td>
            <td className="p-2 text-right">{r.count}</td>
            <td className="p-2 text-right font-mono">{fmt(r.issued)}</td>
            <td className="p-2 text-right font-mono">{fmt(r.redeemed)}</td>
            <td className="p-2 text-right font-mono">{fmt(r.outstanding)}</td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No data</td></tr>}
      </tbody>
    </table>
  );
}

function LookupBar({ value, onChange, restaurantId, onPick }: { value: string; onChange: (s: string) => void; restaurantId: number | null; onPick: (id: number) => void }) {
  const { toast } = useToast();
  const handleLookup = async () => {
    if (!value || !restaurantId) return;
    try {
      const card = await apiGet<Card>(`/restaurants/${restaurantId}/gift-cards/lookup?code=${encodeURIComponent(value)}`);
      onPick(card.id);
      onChange("");
    } catch (e: any) {
      toast({ title: "Not found", description: e.message, variant: "destructive" });
    }
  };
  return (
    <div className="flex gap-1">
      <Input
        placeholder="Lookup code…"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === "Enter" && handleLookup()}
        className="w-48"
      />
      <Button size="icon" variant="outline" onClick={handleLookup}><Search className="w-4 h-4" /></Button>
    </div>
  );
}

function IssueDialog({ open, onClose, onIssued, restaurantId }: { open: boolean; onClose: () => void; onIssued: () => void; restaurantId: number | null }) {
  const { toast } = useToast();
  const [type, setType] = useState<"digital" | "physical" | "corporate">("digital");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sender, setSender] = useState("");
  const [message, setMessage] = useState("");
  const [expires, setExpires] = useState("");
  const [paymentRef, setPaymentRef] = useState("");

  const submit = async () => {
    if (!restaurantId || !amount) return;
    try {
      const created = await apiAction<Card>(`/restaurants/${restaurantId}/gift-cards`, "POST", {
        cardType: type,
        initialAmountPaise: Math.round(parseFloat(amount) * 100),
        recipientName: recipient || undefined,
        recipientEmail: email || undefined,
        recipientPhone: phone || undefined,
        senderName: sender || undefined,
        message: message || undefined,
        expiresAt: expires ? new Date(expires).toISOString() : undefined,
        paymentReference: paymentRef || undefined,
      });
      toast({ title: "Gift card issued", description: `Code: ${created.code}` });
      onIssued(); onClose();
      setAmount(""); setRecipient(""); setEmail(""); setPhone(""); setSender(""); setMessage(""); setExpires(""); setPaymentRef("");
    } catch (e: any) {
      toast({ title: "Issue failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Issue gift card</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={v => setType(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="digital">Digital — emailed/SMS</SelectItem>
                <SelectItem value="physical">Physical — printed</SelectItem>
                <SelectItem value="corporate">Corporate — single buyer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Amount (₹)</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="500.00" /></div>
            <div><Label>Expires on</Label><Input type="date" value={expires} onChange={e => setExpires(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Recipient name</Label><Input value={recipient} onChange={e => setRecipient(e.target.value)} /></div>
            <div><Label>Recipient email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Recipient phone</Label><Input value={phone} onChange={e => setPhone(e.target.value)} /></div>
            <div><Label>Sender name</Label><Input value={sender} onChange={e => setSender(e.target.value)} /></div>
          </div>
          <div><Label>Message</Label><Textarea value={message} onChange={e => setMessage(e.target.value)} maxLength={500} placeholder="Optional gift message" /></div>
          <div><Label>Payment reference</Label><Input value={paymentRef} onChange={e => setPaymentRef(e.target.value)} placeholder="cash / upi-txn-id / offline" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!amount} onClick={submit}>Issue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchDialog({ open, onClose, onIssued, restaurantId }: { open: boolean; onClose: () => void; onIssued: (batchId: number) => void; restaurantId: number | null }) {
  const { toast } = useToast();
  const [batchType, setBatchType] = useState<"physical" | "corporate">("physical");
  const [count, setCount] = useState("");
  const [amount, setAmount] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [expires, setExpires] = useState("");

  const submit = async () => {
    if (!restaurantId || !count || !amount) return;
    try {
      const r = await apiAction<{ batch: { id: number }; count: number; codes: string[] }>(`/restaurants/${restaurantId}/gift-cards/batch`, "POST", {
        batchType,
        count: Number(count),
        amountPerCardPaise: Math.round(parseFloat(amount) * 100),
        buyerName: buyerName || undefined,
        buyerEmail: buyerEmail || undefined,
        poNumber: poNumber || undefined,
        expiresAt: expires ? new Date(expires).toISOString() : undefined,
      });
      toast({ title: `Batch of ${r.count} cards issued`, description: "Downloading CSV…" });
      onIssued(r.batch.id); onClose();
      setCount(""); setAmount(""); setBuyerName(""); setBuyerEmail(""); setPoNumber(""); setExpires("");
    } catch (e: any) {
      toast({ title: "Batch failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Bulk issue gift cards</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Batch type</Label>
            <Select value={batchType} onValueChange={v => setBatchType(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="physical">Physical batch</SelectItem>
                <SelectItem value="corporate">Corporate buyer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Number of cards</Label><Input type="number" value={count} onChange={e => setCount(e.target.value)} placeholder="50" /></div>
            <div><Label>Amount per card (₹)</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="1000.00" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Buyer name</Label><Input value={buyerName} onChange={e => setBuyerName(e.target.value)} /></div>
            <div><Label>Buyer email</Label><Input type="email" value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>PO number</Label><Input value={poNumber} onChange={e => setPoNumber(e.target.value)} /></div>
            <div><Label>Expires on</Label><Input type="date" value={expires} onChange={e => setExpires(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!count || !amount} onClick={submit}>Issue & download CSV</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailDrawer({ giftCardId, restaurantId, onClose, onChanged }: { giftCardId: number; restaurantId: number | null; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const { data, refetch } = useQuery<{
    card: Card & { walletId: number | null; senderName?: string | null; message?: string | null };
    balance: number;
    ledger: Array<{ id: number; type: string; direction: string; amount: number; closingBalance: number; createdAt: string; notes: string | null }>;
    transfers: Array<{ id: number; toName: string | null; toEmail: string | null; createdAt: string; note: string | null }>;
  }>({
    queryKey: ["gift-card-detail", restaurantId, giftCardId],
    enabled: !!restaurantId,
    queryFn: () => apiGet(`/restaurants/${restaurantId}/gift-cards/${giftCardId}`),
  });

  const [redeemAmt, setRedeemAmt] = useState("");
  const [transferTo, setTransferTo] = useState({ name: "", email: "", phone: "" });
  const [refundDest, setRefundDest] = useState<"source" | "store_credit">("source");

  const card = data?.card;
  const isActive = card?.status === "active";

  const doRedeem = async () => {
    try {
      await apiAction(`/restaurants/${restaurantId}/gift-cards/${giftCardId}/redeem`, "POST", {
        amountPaise: Math.round(parseFloat(redeemAmt) * 100), idempotencyKey: idem(), notes: "Manual redemption",
      });
      toast({ title: "Redeemed" }); setRedeemAmt(""); refetch(); onChanged();
    } catch (e: any) { toast({ title: "Redeem failed", description: e.message, variant: "destructive" }); }
  };
  const doTransfer = async () => {
    try {
      await apiAction(`/restaurants/${restaurantId}/gift-cards/${giftCardId}/transfer`, "POST", {
        toName: transferTo.name || undefined, toEmail: transferTo.email || undefined, toPhone: transferTo.phone || undefined,
      });
      toast({ title: "Transferred" }); setTransferTo({ name: "", email: "", phone: "" }); refetch(); onChanged();
    } catch (e: any) { toast({ title: "Transfer failed", description: e.message, variant: "destructive" }); }
  };
  const doRefund = async () => {
    try {
      await apiAction(`/restaurants/${restaurantId}/gift-cards/${giftCardId}/refund`, "POST", { destination: refundDest });
      toast({ title: "Refunded" }); refetch(); onChanged();
    } catch (e: any) { toast({ title: "Refund failed", description: e.message, variant: "destructive" }); }
  };
  const doVoid = async () => {
    if (!window.confirm("Void this card? This cannot be undone.")) return;
    try {
      await apiAction(`/restaurants/${restaurantId}/gift-cards/${giftCardId}/void`, "POST", { reason: "Voided by staff" });
      toast({ title: "Card voided" }); refetch(); onChanged();
    } catch (e: any) { toast({ title: "Void failed", description: e.message, variant: "destructive" }); }
  };

  return (
    <Sheet open={true} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader><SheetTitle>Gift card</SheetTitle></SheetHeader>
        {!card ? <div className="p-6 text-muted-foreground">Loading…</div> : (
          <div className="space-y-5 p-1 pt-4">
            <div>
              <div className="text-2xl font-mono">{card.code}</div>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline">{card.cardType}</Badge>
                <StatusBadge status={card.status} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <SummaryTile label="Balance" value={fmt(data!.balance)} />
              <SummaryTile label="Initial" value={fmt(card.initialAmount)} />
              <SummaryTile label="Used" value={fmt(card.initialAmount - data!.balance)} />
            </div>
            <Card><CardContent className="p-3 text-sm space-y-1">
              <div><span className="text-muted-foreground">Recipient: </span>{card.recipientName ?? "—"} {card.recipientEmail && <span className="text-muted-foreground">· {card.recipientEmail}</span>}</div>
              {card.senderName && <div><span className="text-muted-foreground">Sender: </span>{card.senderName}</div>}
              {card.message && <div className="italic">"{card.message}"</div>}
              <div><span className="text-muted-foreground">Expires: </span>{card.expiresAt ? new Date(card.expiresAt).toLocaleDateString() : "—"}</div>
            </CardContent></Card>

            {isActive && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Actions</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Input type="number" placeholder="Amount (₹)" value={redeemAmt} onChange={e => setRedeemAmt(e.target.value)} />
                    <Button onClick={doRedeem} disabled={!redeemAmt}>Redeem</Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Input placeholder="To name" value={transferTo.name} onChange={e => setTransferTo({ ...transferTo, name: e.target.value })} />
                    <Input placeholder="To email" value={transferTo.email} onChange={e => setTransferTo({ ...transferTo, email: e.target.value })} />
                    <Input placeholder="To phone" value={transferTo.phone} onChange={e => setTransferTo({ ...transferTo, phone: e.target.value })} />
                  </div>
                  <Button variant="outline" onClick={doTransfer} disabled={!transferTo.name && !transferTo.email && !transferTo.phone}><Send className="w-4 h-4 mr-1" /> Transfer</Button>
                  <div className="flex gap-2 items-center">
                    <Select value={refundDest} onValueChange={v => setRefundDest(v as any)}>
                      <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="source">Refund to source</SelectItem>
                        <SelectItem value="store_credit">Store credit</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="outline" onClick={doRefund}><RotateCcw className="w-4 h-4 mr-1" /> Refund</Button>
                    <Button variant="outline" onClick={doVoid}><XCircle className="w-4 h-4 mr-1" /> Void</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Ledger</CardTitle></CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr><th className="text-left p-2">When</th><th className="text-left p-2">Type</th><th className="text-right p-2">Amount</th><th className="text-right p-2">Balance</th></tr>
                  </thead>
                  <tbody>
                    {(data?.ledger ?? []).map(l => (
                      <tr key={l.id} className="border-t">
                        <td className="p-2">{new Date(l.createdAt).toLocaleString()}</td>
                        <td className="p-2"><Badge variant="secondary">{l.type}</Badge></td>
                        <td className={`p-2 text-right font-mono ${l.direction === "credit" ? "text-green-600" : "text-red-600"}`}>{l.direction === "credit" ? "+" : "−"}{fmt(l.amount)}</td>
                        <td className="p-2 text-right font-mono">{fmt(l.closingBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {data!.transfers.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Transfer history</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50"><tr><th className="text-left p-2">When</th><th className="text-left p-2">To</th><th className="text-left p-2">Note</th></tr></thead>
                    <tbody>
                      {data!.transfers.map(t => (
                        <tr key={t.id} className="border-t">
                          <td className="p-2">{new Date(t.createdAt).toLocaleString()}</td>
                          <td className="p-2">{t.toName ?? t.toEmail ?? "—"}</td>
                          <td className="p-2 text-muted-foreground">{t.note ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SettingsPanel({ settings, onSave }: { settings: any; onSave: (patch: any) => Promise<void> }) {
  const [s, setS] = useState(settings);
  useMemo(() => setS(settings), [settings]);
  return (
    <Card><CardContent className="p-6 space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <Label>Allow refunds</Label>
          <p className="text-xs text-muted-foreground">When off, no gift cards can be refunded.</p>
        </div>
        <Switch checked={s.refundsAllowed} onCheckedChange={v => setS({ ...s, refundsAllowed: v })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Refund window (days)</Label>
          <Input type="number" value={s.refundWindowDays} onChange={e => setS({ ...s, refundWindowDays: Number(e.target.value) })} />
        </div>
        <div>
          <Label>Default expiry (days)</Label>
          <Input type="number" value={s.defaultExpiryDays} onChange={e => setS({ ...s, defaultExpiryDays: Number(e.target.value) })} />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <Label>Refund partially-used cards</Label>
          <p className="text-xs text-muted-foreground">If off, only fully unused cards can be refunded.</p>
        </div>
        <Switch checked={s.refundPartiallyUsed} onCheckedChange={v => setS({ ...s, refundPartiallyUsed: v })} />
      </div>
      <div>
        <Label>Default refund destination</Label>
        <Select value={s.defaultRefundDestination} onValueChange={v => setS({ ...s, defaultRefundDestination: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="source">Original payment source</SelectItem>
            <SelectItem value="store_credit">Customer store credit</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <Label>Mask code for non-admin staff</Label>
          <p className="text-xs text-muted-foreground">Shown as GC-***12 in lists for cashiers/waiters.</p>
        </div>
        <Switch checked={s.maskCodeForStaff} onCheckedChange={v => setS({ ...s, maskCodeForStaff: v })} />
      </div>
      <Button onClick={() => onSave(s)}>Save settings</Button>
    </CardContent></Card>
  );
}
