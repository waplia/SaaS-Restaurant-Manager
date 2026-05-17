import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";

const fmtINR = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function SettlementReconPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: settlements = [] } = useQuery<Array<any>>({
    queryKey: ["settlements", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/settlements`),
  });
  const { data: runs = [] } = useQuery<Array<any>>({
    queryKey: ["recon-runs", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/reconciliation/runs`),
  });
  const { data: shifts = [] } = useQuery<Array<any>>({
    queryKey: ["cash-shifts", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/cash-shifts`),
  });

  const runSettlement = useMutation({
    mutationFn: (body: { date?: string }) => apiPost(`/restaurants/${restaurantId}/settlements/run`, body),
    onSuccess: () => { toast({ title: "Settlement generated" }); qc.invalidateQueries({ queryKey: ["settlements"] }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const [reconSource, setReconSource] = useState("razorpay");
  const [reconCsv, setReconCsv] = useState("");
  const [from, setFrom] = useState(() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 7); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const reconRun = useMutation({
    mutationFn: (body: any) => apiPost(`/restaurants/${restaurantId}/reconciliation/runs`, body),
    onSuccess: () => { toast({ title: "Reconciliation complete" }); qc.invalidateQueries({ queryKey: ["recon-runs"] }); setReconCsv(""); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // Tolerant CSV parser: handles header rows, quoted cells, gateway-specific
  // column names (Razorpay: payment_id / amount; Cashfree: cf_payment_id /
  // payment_amount; Stripe: id / amount). Falls back to the first two
  // columns when no recognized headers are present.
  function splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = !inQ; }
      } else if (ch === "," && !inQ) {
        out.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  }
  function parseAmount(raw: string): number {
    // Strip currency symbols, commas, spaces. Treat (123.45) as negative.
    const cleaned = raw.replace(/[₹$€£,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
    return parseFloat(cleaned);
  }
  function parseCsv(): Array<{ externalRef: string; amountPaise: number }> {
    const lines = reconCsv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    const refKeys = ["payment_id", "cf_payment_id", "transaction_id", "txn_id", "id", "reference", "ref", "order_id"];
    const amtKeys = ["amount", "payment_amount", "transaction_amount", "amount_in_rupees", "amount_inr", "gross_amount", "captured_amount", "settled_amount"];
    const first = splitCsvLine(lines[0]).map(c => c.toLowerCase().replace(/^"|"$/g, ""));
    // Only treat the first line as a header when we recognise at least one
    // known header keyword. Headerless rows like `pay_ABC123,1250` were
    // previously misclassified and silently dropped.
    const rIdx = first.findIndex(c => refKeys.includes(c));
    const aIdx = first.findIndex(c => amtKeys.includes(c));
    const looksLikeHeader = rIdx >= 0 || aIdx >= 0;
    let refIdx = 0;
    let amtIdx = 1;
    let dataStart = 0;
    if (looksLikeHeader) {
      refIdx = rIdx >= 0 ? rIdx : 0;
      amtIdx = aIdx >= 0 ? aIdx : (refIdx === 1 ? 0 : 1);
      dataStart = 1;
    }
    const out: Array<{ externalRef: string; amountPaise: number }> = [];
    for (let i = dataStart; i < lines.length; i++) {
      const cells = splitCsvLine(lines[i]);
      const ref = (cells[refIdx] ?? "").replace(/^"|"$/g, "").trim();
      const amtRaw = (cells[amtIdx] ?? "").replace(/^"|"$/g, "").trim();
      const amt = parseAmount(amtRaw);
      if (ref && Number.isFinite(amt)) {
        out.push({ externalRef: ref, amountPaise: Math.round(amt * 100) });
      }
    }
    return out;
  }

  const [shiftDate, setShiftDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [shiftLabel, setShiftLabel] = useState("");
  const [expected, setExpected] = useState("");
  const [counted, setCounted] = useState("");
  const [varianceReason, setVarianceReason] = useState("");
  const variancePaise = (() => {
    const e = parseFloat(expected); const c = parseFloat(counted);
    if (!Number.isFinite(e) || !Number.isFinite(c)) return 0;
    return Math.round((c - e) * 100);
  })();
  const requiresReason = variancePaise !== 0;
  const shiftMut = useMutation({
    mutationFn: (body: any) => apiPost(`/restaurants/${restaurantId}/cash-shifts`, body),
    onSuccess: () => { toast({ title: "Shift recorded" }); qc.invalidateQueries({ queryKey: ["cash-shifts"] }); setExpected(""); setCounted(""); setShiftLabel(""); setVarianceReason(""); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Layout>
      <PageHeader title="Settlements & Reconciliation" subtitle="End-of-day money flow and gateway/cash matching" icon={TrendingUp} />
      <div className="p-6">
        <Tabs defaultValue="settlements">
          <TabsList>
            <TabsTrigger value="settlements">Daily settlements</TabsTrigger>
            <TabsTrigger value="recon">Gateway reconciliation</TabsTrigger>
            <TabsTrigger value="cash">Cash shift</TabsTrigger>
          </TabsList>

          <TabsContent value="settlements" className="space-y-4">
            <div className="flex justify-end"><Button onClick={() => runSettlement.mutate({})}>Generate yesterday's settlement</Button></div>
            <Card><CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr>
                  <th className="text-left p-3">Date</th>
                  <th className="text-right p-3">Collected</th>
                  <th className="text-right p-3">Refunded</th>
                  <th className="text-right p-3">Payouts</th>
                  <th className="text-right p-3">Vendor</th>
                  <th className="text-right p-3">Gateway fees</th>
                  <th className="text-right p-3">Commission</th>
                  <th className="text-right p-3">Net</th>
                  <th className="text-left p-3">Status</th>
                </tr></thead>
                <tbody>
                  {settlements.map((s: any) => (
                    <tr key={s.id} className="border-t">
                      <td className="p-3">{new Date(s.settlementDate).toLocaleDateString()}</td>
                      <td className="p-3 text-right font-mono">{fmtINR(s.totalCollected)}</td>
                      <td className="p-3 text-right font-mono text-red-600">{fmtINR(s.totalRefunded)}</td>
                      <td className="p-3 text-right font-mono">{fmtINR(s.totalStaffPayouts)}</td>
                      <td className="p-3 text-right font-mono">{fmtINR(s.totalVendorPayments)}</td>
                      <td className="p-3 text-right font-mono">{fmtINR(s.totalGatewayFees)}</td>
                      <td className="p-3 text-right font-mono">{fmtINR(s.totalPlatformCommission)}</td>
                      <td className="p-3 text-right font-mono font-bold">{fmtINR(s.netSettlement)}</td>
                      <td className="p-3"><Badge variant={s.status === "emailed" ? "default" : "secondary"}>{s.status}</Badge></td>
                    </tr>
                  ))}
                  {settlements.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No settlements yet.</td></tr>}
                </tbody>
              </table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="recon" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Run reconciliation</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><Label>Source</Label>
                    <Select value={reconSource} onValueChange={setReconSource}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{["razorpay", "cashfree", "stripe", "csv"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
                  <div><Label>To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
                </div>
                <div>
                  <Label>External records (CSV: <code className="text-xs">payment_id, amount_in_rupees</code>)</Label>
                  <Textarea rows={6} value={reconCsv} onChange={e => setReconCsv(e.target.value)} placeholder="pay_ABC123, 1250.00&#10;pay_XYZ456, 800.50" />
                </div>
                <Button onClick={() => reconRun.mutate({ source: reconSource, fromDate: new Date(from).toISOString(), toDate: new Date(`${to}T23:59:59`).toISOString(), externalRecords: parseCsv() })}>Run reconciliation</Button>
              </CardContent>
            </Card>
            <Card><CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr><th className="text-left p-3">When</th><th className="text-left p-3">Source</th><th className="text-right p-3">Matched</th><th className="text-right p-3">Missing on platform</th><th className="text-right p-3">Missing on gateway</th><th className="text-right p-3">Mismatches</th></tr></thead>
                <tbody>
                  {runs.map((r: any) => (
                    <tr key={r.id} className="border-t">
                      <td className="p-3">{new Date(r.createdAt).toLocaleString()}</td>
                      <td className="p-3"><Badge variant="secondary">{r.source}</Badge></td>
                      <td className="p-3 text-right text-green-600 font-mono">{r.matchedCount}</td>
                      <td className="p-3 text-right text-orange-600 font-mono">{r.missingOnPlatformCount}</td>
                      <td className="p-3 text-right text-orange-600 font-mono">{r.missingOnGatewayCount}</td>
                      <td className="p-3 text-right text-red-600 font-mono">{r.amountMismatchCount}</td>
                    </tr>
                  ))}
                  {runs.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No reconciliation runs yet.</td></tr>}
                </tbody>
              </table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="cash" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Reconcile cash shift</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Shift date</Label><Input type="date" value={shiftDate} onChange={e => setShiftDate(e.target.value)} /></div>
                  <div><Label>Shift label</Label><Input value={shiftLabel} onChange={e => setShiftLabel(e.target.value)} placeholder="e.g. Lunch / Dinner" /></div>
                  <div><Label>Expected (₹)</Label><Input type="number" value={expected} onChange={e => setExpected(e.target.value)} /></div>
                  <div><Label>Counted (₹)</Label><Input type="number" value={counted} onChange={e => setCounted(e.target.value)} /></div>
                </div>
                {requiresReason && (
                  <div>
                    <Label>Variance reason {variancePaise !== 0 ? <span className="text-xs text-muted-foreground">({variancePaise > 0 ? "+" : ""}{fmtINR(variancePaise)})</span> : null}</Label>
                    <Textarea
                      rows={2}
                      value={varianceReason}
                      onChange={e => setVarianceReason(e.target.value)}
                      placeholder={variancePaise < 0 ? "e.g. ₹50 short — change owed to customer not collected" : "e.g. cashier overcharged & refunded later"}
                    />
                    <p className="text-xs text-muted-foreground mt-1">A short reason is required whenever counted cash does not match expected. This is recorded in the audit log.</p>
                  </div>
                )}
                <Button
                  disabled={!expected || !counted || (requiresReason && !varianceReason.trim())}
                  onClick={() => shiftMut.mutate({
                    shiftDate: new Date(shiftDate).toISOString(),
                    shiftLabel,
                    expectedPaise: Math.round(parseFloat(expected) * 100),
                    countedPaise: Math.round(parseFloat(counted) * 100),
                    notes: requiresReason ? `Variance reason: ${varianceReason.trim()}` : undefined,
                  })}
                >Record shift</Button>
              </CardContent>
            </Card>
            <Card><CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr><th className="text-left p-3">Date</th><th className="text-left p-3">Shift</th><th className="text-right p-3">Expected</th><th className="text-right p-3">Counted</th><th className="text-right p-3">Variance</th><th className="text-left p-3">Status</th></tr></thead>
                <tbody>
                  {shifts.map((s: any) => (
                    <tr key={s.id} className="border-t">
                      <td className="p-3">{new Date(s.shiftDate).toLocaleDateString()}</td>
                      <td className="p-3">{s.shiftLabel ?? "—"}</td>
                      <td className="p-3 text-right font-mono">{fmtINR(s.expectedCash)}</td>
                      <td className="p-3 text-right font-mono">{fmtINR(s.countedCash)}</td>
                      <td className={`p-3 text-right font-mono ${s.variance < 0 ? "text-red-600" : s.variance > 0 ? "text-orange-600" : ""}`}>{fmtINR(s.variance)}</td>
                      <td className="p-3">{s.status === "flagged" ? <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />Flagged</Badge> : <Badge variant="secondary"><CheckCircle2 className="w-3 h-3 mr-1" />Reconciled</Badge>}</td>
                    </tr>
                  ))}
                  {shifts.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No shift reconciliations recorded.</td></tr>}
                </tbody>
              </table>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
