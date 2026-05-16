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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost, apiPatch, apiPut, getApiUrl } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Truck, AlertTriangle, CheckCircle2, FileDown, Upload } from "lucide-react";

const AGGREGATORS = ["swiggy", "zomato", "ubereats", "other"] as const;
type Aggregator = typeof AGGREGATORS[number];

const fmtINR = (paise: number | null | undefined) =>
  paise == null ? "—" : `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (bps: number | null | undefined) =>
  bps == null ? "—" : `${(bps / 100).toFixed(2)}%`;

interface Sheet {
  id: number; aggregator: string; fileName: string | null; periodFrom: string; periodTo: string;
  rowCount: number; matchedCount: number; disputedCount: number; unmatchedCount: number;
  totalGrossPaise: number; totalCommissionPaise: number; totalTaxPaise: number;
  totalRefundPaise: number; totalNetPaise: number; status: string; createdAt: string;
}
interface Agreement { id: number; aggregator: string; commissionBps: number; gstBps: number; tolerancePaise: number; notes: string | null; }
interface ReconResult {
  id: number; sheetId: number; rowId: number | null; orderId: number | null;
  issueType: string; impactPaise: number; expectedPaise: number | null; actualPaise: number | null;
  matchMethod: string | null; reason: string | null; status: string;
  row: any | null; order: any | null;
}
interface DashboardData {
  totals: {
    grossPaise: number; commissionPaise: number; taxPaise: number; refundPaise: number;
    actualNetPaise: number; expectedNetPaise: number; adjustmentsPaise: number; variancePaise: number;
    sheetCount: number; matchedCount: number; disputedCount: number; unmatchedCount: number;
  };
  perAggregator: Array<{
    aggregator: string;
    grossPaise: number; commissionPaise: number; taxPaise: number; refundPaise: number;
    actualNetPaise: number; expectedNetPaise: number; adjustmentsPaise: number; variancePaise: number;
    sheetCount: number; matchedCount: number; disputedCount: number; unmatchedCount: number;
  }>;
}
interface CommissionReport {
  perAggregator: Array<{
    aggregator: string; orderCount: number; grossPaise: number; commissionPaise: number;
    effectiveBps: number; agreedBps: number | null; outlierCount: number;
  }>;
  rows: Array<{
    rowId: number; aggregator: string; externalOrderId: string | null; orderDate: string | null;
    grossPaise: number; commissionPaise: number; effectiveBps: number; agreedBps: number; isOutlier: boolean;
  }>;
}
interface Claim { id: number; aggregator: string; issueType: string; amountPaise: number; status: string; externalRef: string | null; notes: string | null; createdAt: string; recoveredPaise: number; }
interface Adjustment { id: number; aggregator: string; amountPaise: number; reason: string; notes: string | null; createdAt: string; sheetId: number | null; }

const ISSUE_LABEL: Record<string, string> = {
  matched: "Matched",
  missing_payout: "Missing payout",
  missing_order: "Unknown order",
  excess_commission: "Excess commission",
  cancellation_mismatch: "Cancellation mismatch",
  refund_mismatch: "Refund mismatch",
  tax_mismatch: "Tax mismatch",
  amount_mismatch: "Amount mismatch",
};

function issueBadge(issueType: string) {
  if (issueType === "matched") return <Badge variant="secondary"><CheckCircle2 className="h-3 w-3 mr-1" />Matched</Badge>;
  return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />{ISSUE_LABEL[issueType] ?? issueType}</Badge>;
}

export default function AggregatorReconPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [from, setFrom] = useState(() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [aggregatorFilter, setAggregatorFilter] = useState<string>("all");

  const dashboardQ = useQuery<DashboardData>({
    queryKey: ["agg-dashboard", restaurantId, from, to, aggregatorFilter],
    queryFn: () => apiGet<DashboardData>(`/restaurants/${restaurantId}/aggregator-payouts/dashboard?from=${from}T00:00:00.000Z&to=${to}T23:59:59.999Z${aggregatorFilter !== "all" ? `&aggregator=${aggregatorFilter}` : ""}`),
  });

  const sheetsQ = useQuery<Sheet[]>({
    queryKey: ["agg-sheets", restaurantId],
    queryFn: () => apiGet<Sheet[]>(`/restaurants/${restaurantId}/aggregator-payouts/sheets`),
  });

  const agreementsQ = useQuery<Agreement[]>({
    queryKey: ["agg-agreements", restaurantId],
    queryFn: () => apiGet<Agreement[]>(`/restaurants/${restaurantId}/aggregator-payouts/agreements`),
  });

  const claimsQ = useQuery<Claim[]>({
    queryKey: ["agg-claims", restaurantId],
    queryFn: () => apiGet<Claim[]>(`/restaurants/${restaurantId}/aggregator-payouts/claims`),
  });

  const adjustmentsQ = useQuery<Adjustment[]>({
    queryKey: ["agg-adjustments", restaurantId],
    queryFn: () => apiGet<Adjustment[]>(`/restaurants/${restaurantId}/aggregator-payouts/adjustments`),
  });

  const commissionQ = useQuery<CommissionReport>({
    queryKey: ["agg-commission", restaurantId, from, to, aggregatorFilter],
    queryFn: () => apiGet<CommissionReport>(`/restaurants/${restaurantId}/aggregator-payouts/commission-report?from=${from}T00:00:00.000Z&to=${to}T23:59:59.999Z${aggregatorFilter !== "all" ? `&aggregator=${aggregatorFilter}` : ""}`),
  });

  // ── Upload tab ──────────────────────────────────────────────────────────
  const [uploadAgg, setUploadAgg] = useState<Aggregator>("swiggy");
  const [uploadFrom, setUploadFrom] = useState(() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 7); return d.toISOString().slice(0, 10); });
  const [uploadTo, setUploadTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [uploadName, setUploadName] = useState("");
  const [uploadCsv, setUploadCsv] = useState("");

  const uploadMut = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/aggregator-payouts/sheets`, {
      aggregator: uploadAgg,
      fileName: uploadName || undefined,
      periodFrom: `${uploadFrom}T00:00:00.000Z`,
      periodTo: `${uploadTo}T23:59:59.999Z`,
      csv: uploadCsv,
    }),
    onSuccess: (resp: any) => {
      toast({ title: "Sheet uploaded", description: `Matched ${resp.recon.matched}, ${resp.recon.disputed} disputes, ${resp.recon.unmatched} missing.` });
      setUploadCsv(""); setUploadName("");
      qc.invalidateQueries({ queryKey: ["agg-sheets"] });
      qc.invalidateQueries({ queryKey: ["agg-dashboard"] });
      qc.invalidateQueries({ queryKey: ["agg-commission"] });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setUploadName(f.name);
    f.text().then(t => setUploadCsv(t)).catch(() => toast({ title: "Could not read file", variant: "destructive" }));
  }

  // ── Sheet line-items drilldown ──────────────────────────────────────────
  const [openSheetId, setOpenSheetId] = useState<number | null>(null);
  const [issueFilter, setIssueFilter] = useState<string>("all");
  const sheetRowsQ = useQuery<ReconResult[]>({
    queryKey: ["agg-sheet-rows", restaurantId, openSheetId, issueFilter],
    queryFn: () => apiGet<ReconResult[]>(`/restaurants/${restaurantId}/aggregator-payouts/sheets/${openSheetId}/rows${issueFilter !== "all" ? `?issue=${issueFilter}` : ""}`),
    enabled: openSheetId != null,
  });

  const claimMut = useMutation({
    mutationFn: (r: ReconResult) => apiPost(`/restaurants/${restaurantId}/aggregator-payouts/claims`, {
      resultId: r.id, sheetId: r.sheetId,
      aggregator: r.row?.aggregator ?? r.order?.aggregatorName ?? "other",
      issueType: r.issueType, amountPaise: Math.abs(r.impactPaise), notes: r.reason ?? undefined,
    }),
    onSuccess: () => {
      toast({ title: "Claim filed" });
      qc.invalidateQueries({ queryKey: ["agg-sheet-rows"] });
      qc.invalidateQueries({ queryKey: ["agg-claims"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // ── Agreements ──────────────────────────────────────────────────────────
  const [agreementDraft, setAgreementDraft] = useState<Record<string, { commissionPct: string; gstPct: string; tolerance: string }>>({});
  const saveAgreement = useMutation({
    mutationFn: (a: Aggregator) => {
      const d = agreementDraft[a] ?? { commissionPct: "0", gstPct: "5", tolerance: "100" };
      return apiPut(`/restaurants/${restaurantId}/aggregator-payouts/agreements/${a}`, {
        commissionBps: Math.round(parseFloat(d.commissionPct || "0") * 100),
        gstBps: Math.round(parseFloat(d.gstPct || "0") * 100),
        tolerancePaise: Math.round(parseFloat(d.tolerance || "100")),
      });
    },
    onSuccess: () => { toast({ title: "Agreement saved" }); qc.invalidateQueries({ queryKey: ["agg-agreements"] }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const getAgreementForm = (a: Aggregator) => {
    if (agreementDraft[a]) return agreementDraft[a];
    const existing = agreementsQ.data?.find(x => x.aggregator === a);
    return {
      commissionPct: existing ? (existing.commissionBps / 100).toFixed(2) : "",
      gstPct: existing ? (existing.gstBps / 100).toFixed(2) : "5",
      tolerance: existing ? String(existing.tolerancePaise) : "100",
    };
  };

  // ── Adjustments ─────────────────────────────────────────────────────────
  const [adjAgg, setAdjAgg] = useState<Aggregator>("swiggy");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const adjMut = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/aggregator-payouts/adjustments`, {
      aggregator: adjAgg, amountPaise: Math.round(parseFloat(adjAmount || "0") * 100), reason: adjReason,
    }),
    onSuccess: () => {
      toast({ title: "Adjustment recorded" });
      setAdjAmount(""); setAdjReason("");
      qc.invalidateQueries({ queryKey: ["agg-adjustments"] });
      qc.invalidateQueries({ queryKey: ["agg-dashboard"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // ── Claim status patches ────────────────────────────────────────────────
  const claimPatch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) =>
      apiPatch(`/restaurants/${restaurantId}/aggregator-payouts/claims/${id}`, body),
    onSuccess: () => { toast({ title: "Updated" }); qc.invalidateQueries({ queryKey: ["agg-claims"] }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const exportReconUrl = (sheetId: number) => getApiUrl(`/restaurants/${restaurantId}/aggregator-payouts/exports/recon.csv?sheetId=${sheetId}`);
  const exportClaimsUrl = getApiUrl(`/restaurants/${restaurantId}/aggregator-payouts/exports/claims.csv?from=${from}T00:00:00.000Z&to=${to}T23:59:59.999Z`);

  const totals = dashboardQ.data?.totals;

  return (
    <Layout>
      <PageHeader
        title="Aggregator Payouts"
        subtitle="Reconcile Swiggy/Zomato/Uber Eats payout sheets against your orders, flag mismatches, and chase claims."
      />

      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div>
          <Label>From</Label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div>
          <Label>Aggregator</Label>
          <Select value={aggregatorFilter} onValueChange={setAggregatorFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {AGGREGATORS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList className="flex-wrap">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="upload">Upload sheet</TabsTrigger>
          <TabsTrigger value="sheets">Sheets &amp; line items</TabsTrigger>
          <TabsTrigger value="commission">Commission report</TabsTrigger>
          <TabsTrigger value="claims">Claims</TabsTrigger>
          <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
          <TabsTrigger value="agreements">Agreements</TabsTrigger>
        </TabsList>

        {/* Dashboard ───────────────────────────────────────────── */}
        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardHeader><CardTitle className="text-sm">Gross sales</CardTitle></CardHeader>
              <CardContent className="text-2xl font-bold">{fmtINR(totals?.grossPaise ?? 0)}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm">Commission</CardTitle></CardHeader>
              <CardContent className="text-2xl font-bold text-amber-600">{fmtINR(totals?.commissionPaise ?? 0)}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm">Net received</CardTitle></CardHeader>
              <CardContent className="text-2xl font-bold">{fmtINR((totals?.actualNetPaise ?? 0) + (totals?.adjustmentsPaise ?? 0))}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm">Variance vs expected</CardTitle></CardHeader>
              <CardContent className={`text-2xl font-bold ${(totals?.variancePaise ?? 0) < 0 ? "text-red-600" : "text-green-600"}`}>
                {fmtINR(totals?.variancePaise ?? 0)}
              </CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Per aggregator</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Aggregator</TableHead><TableHead>Sheets</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Refunds</TableHead>
                  <TableHead className="text-right">Expected net</TableHead>
                  <TableHead className="text-right">Actual net</TableHead>
                  <TableHead className="text-right">Adjustments</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead>Disputes</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(dashboardQ.data?.perAggregator ?? []).map(a => (
                    <TableRow key={a.aggregator}>
                      <TableCell className="font-medium">{a.aggregator}</TableCell>
                      <TableCell>{a.sheetCount}</TableCell>
                      <TableCell className="text-right">{fmtINR(a.grossPaise)}</TableCell>
                      <TableCell className="text-right">{fmtINR(a.commissionPaise)}</TableCell>
                      <TableCell className="text-right">{fmtINR(a.refundPaise)}</TableCell>
                      <TableCell className="text-right">{fmtINR(a.expectedNetPaise)}</TableCell>
                      <TableCell className="text-right">{fmtINR(a.actualNetPaise)}</TableCell>
                      <TableCell className="text-right">{fmtINR(a.adjustmentsPaise)}</TableCell>
                      <TableCell className={`text-right font-medium ${a.variancePaise < 0 ? "text-red-600" : "text-green-600"}`}>
                        {fmtINR(a.variancePaise)}
                      </TableCell>
                      <TableCell>
                        {a.disputedCount > 0 && <Badge variant="destructive" className="mr-1">{a.disputedCount} dispute</Badge>}
                        {a.unmatchedCount > 0 && <Badge variant="outline">{a.unmatchedCount} unmatched</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(dashboardQ.data?.perAggregator ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">No payouts in this window.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Upload ──────────────────────────────────────────────── */}
        <TabsContent value="upload">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Upload className="h-4 w-4" />Upload payout CSV</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label>Aggregator</Label>
                  <Select value={uploadAgg} onValueChange={(v) => setUploadAgg(v as Aggregator)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AGGREGATORS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Period from</Label><Input type="date" value={uploadFrom} onChange={e => setUploadFrom(e.target.value)} /></div>
                <div><Label>Period to</Label><Input type="date" value={uploadTo} onChange={e => setUploadTo(e.target.value)} /></div>
                <div><Label>File name</Label><Input value={uploadName} onChange={e => setUploadName(e.target.value)} placeholder="optional" /></div>
              </div>
              <div>
                <Label>Pick CSV file</Label>
                <Input type="file" accept=".csv,text/csv" onChange={onPickFile} />
              </div>
              <div>
                <Label>Or paste CSV contents</Label>
                <Textarea rows={10} value={uploadCsv} onChange={e => setUploadCsv(e.target.value)} placeholder="Order ID,Order Date,Order Total,Commission,GST,Net Payout&#10;ORD-1,2026-05-01,500.00,125.00,25.00,350.00" />
                <p className="text-xs text-muted-foreground mt-1">Up to 5,000 rows / 2&nbsp;MB. Headers are case-insensitive — we look for columns like &ldquo;Order Total&rdquo;, &ldquo;Commission&rdquo;, &ldquo;Net Payout&rdquo;.</p>
              </div>
              <Button onClick={() => uploadMut.mutate()} disabled={!uploadCsv || uploadMut.isPending}>
                {uploadMut.isPending ? "Uploading…" : "Upload &amp; reconcile"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sheets & line items ─────────────────────────────────── */}
        <TabsContent value="sheets" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Uploaded sheets</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Aggregator</TableHead><TableHead>Period</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Net payout</TableHead>
                  <TableHead>Status</TableHead><TableHead>Recon</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(sheetsQ.data ?? []).map(s => (
                    <TableRow key={s.id} className={openSheetId === s.id ? "bg-accent" : ""}>
                      <TableCell className="font-medium">{s.aggregator}</TableCell>
                      <TableCell>{s.periodFrom.slice(0, 10)} → {s.periodTo.slice(0, 10)}</TableCell>
                      <TableCell className="text-right">{s.rowCount}</TableCell>
                      <TableCell className="text-right">{fmtINR(s.totalNetPaise)}</TableCell>
                      <TableCell><Badge variant="outline">{s.status}</Badge></TableCell>
                      <TableCell>
                        <span className="text-green-600">{s.matchedCount}✓</span>{" "}
                        <span className="text-red-600">{s.disputedCount}!</span>{" "}
                        <span className="text-muted-foreground">{s.unmatchedCount}?</span>
                      </TableCell>
                      <TableCell className="space-x-2">
                        <Button size="sm" variant="ghost" onClick={() => setOpenSheetId(s.id)}>View rows</Button>
                        <a href={exportReconUrl(s.id)} download>
                          <Button size="sm" variant="outline"><FileDown className="h-3 w-3 mr-1" />CSV</Button>
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(sheetsQ.data ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No sheets uploaded yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {openSheetId != null && (
            <Card>
              <CardHeader><CardTitle className="flex items-center justify-between">
                <span>Line items — sheet #{openSheetId}</span>
                <Select value={issueFilter} onValueChange={setIssueFilter}>
                  <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All issues</SelectItem>
                    {Object.entries(ISSUE_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Issue</TableHead><TableHead>Order</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead className="text-right">Impact</TableHead>
                    <TableHead>Reason</TableHead><TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(sheetRowsQ.data ?? []).map(r => (
                      <TableRow key={r.id}>
                        <TableCell>{issueBadge(r.issueType)}</TableCell>
                        <TableCell className="text-xs">
                          {r.row?.externalOrderId ?? "—"}
                          {r.order ? <div className="text-muted-foreground">#{r.order.orderNumber}</div> : null}
                        </TableCell>
                        <TableCell className="text-right">{fmtINR(r.row?.grossPaise)}</TableCell>
                        <TableCell className="text-right">{fmtINR(r.row?.commissionPaise)}</TableCell>
                        <TableCell className="text-right">{fmtINR(r.row?.netPaise)}</TableCell>
                        <TableCell className="text-right">{fmtINR(r.expectedPaise)}</TableCell>
                        <TableCell className={`text-right font-medium ${r.impactPaise < 0 ? "text-red-600" : r.impactPaise > 0 ? "text-amber-600" : ""}`}>
                          {fmtINR(r.impactPaise)}
                        </TableCell>
                        <TableCell className="text-xs max-w-xs truncate" title={r.reason ?? ""}>{r.reason ?? "—"}</TableCell>
                        <TableCell>
                          {r.issueType !== "matched" && r.status === "open" && (
                            <Button size="sm" variant="outline" onClick={() => claimMut.mutate(r)} disabled={claimMut.isPending}>File claim</Button>
                          )}
                          {r.status === "claimed" && <Badge variant="secondary">Claimed</Badge>}
                          {r.status === "resolved" && <Badge variant="secondary">Resolved</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(sheetRowsQ.data ?? []).length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No rows.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Commission ──────────────────────────────────────────── */}
        <TabsContent value="commission" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Effective commission %</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Aggregator</TableHead><TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Effective</TableHead>
                  <TableHead className="text-right">Agreed</TableHead>
                  <TableHead className="text-right">Outliers</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(commissionQ.data?.perAggregator ?? []).map(a => (
                    <TableRow key={a.aggregator}>
                      <TableCell className="font-medium">{a.aggregator}</TableCell>
                      <TableCell className="text-right">{a.orderCount}</TableCell>
                      <TableCell className="text-right">{fmtINR(a.grossPaise)}</TableCell>
                      <TableCell className="text-right">{fmtINR(a.commissionPaise)}</TableCell>
                      <TableCell className={`text-right ${a.agreedBps != null && a.effectiveBps > a.agreedBps + 50 ? "text-red-600 font-bold" : ""}`}>{fmtPct(a.effectiveBps)}</TableCell>
                      <TableCell className="text-right">{fmtPct(a.agreedBps)}</TableCell>
                      <TableCell className="text-right">{a.outlierCount > 0 ? <Badge variant="destructive">{a.outlierCount}</Badge> : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {(commissionQ.data?.perAggregator ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No data.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Outlier rows (commission &gt; agreed + 0.5%)</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Aggregator</TableHead><TableHead>Order</TableHead><TableHead>Date</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Effective</TableHead>
                  <TableHead className="text-right">Agreed</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(commissionQ.data?.rows ?? []).filter(r => r.isOutlier).slice(0, 100).map(r => (
                    <TableRow key={r.rowId}>
                      <TableCell>{r.aggregator}</TableCell>
                      <TableCell className="text-xs">{r.externalOrderId ?? "—"}</TableCell>
                      <TableCell className="text-xs">{r.orderDate ? r.orderDate.slice(0, 10) : "—"}</TableCell>
                      <TableCell className="text-right">{fmtINR(r.grossPaise)}</TableCell>
                      <TableCell className="text-right">{fmtINR(r.commissionPaise)}</TableCell>
                      <TableCell className="text-right text-red-600 font-medium">{fmtPct(r.effectiveBps)}</TableCell>
                      <TableCell className="text-right">{fmtPct(r.agreedBps)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Claims ──────────────────────────────────────────────── */}
        <TabsContent value="claims" className="space-y-4">
          <div className="flex justify-end">
            <a href={exportClaimsUrl} download><Button variant="outline" size="sm"><FileDown className="h-3 w-3 mr-1" />Export claims CSV</Button></a>
          </div>
          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>#</TableHead><TableHead>Aggregator</TableHead><TableHead>Issue</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Recovered</TableHead>
                  <TableHead>Status</TableHead><TableHead>External ref</TableHead>
                  <TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(claimsQ.data ?? []).map(c => (
                    <TableRow key={c.id}>
                      <TableCell>{c.id}</TableCell>
                      <TableCell>{c.aggregator}</TableCell>
                      <TableCell>{ISSUE_LABEL[c.issueType] ?? c.issueType}</TableCell>
                      <TableCell className="text-right">{fmtINR(c.amountPaise)}</TableCell>
                      <TableCell className="text-right">{fmtINR(c.recoveredPaise)}</TableCell>
                      <TableCell><Badge variant={c.status === "recovered" ? "secondary" : c.status === "written_off" ? "outline" : "default"}>{c.status}</Badge></TableCell>
                      <TableCell className="text-xs">{c.externalRef ?? "—"}</TableCell>
                      <TableCell className="space-x-1">
                        {c.status === "open" && <Button size="sm" variant="outline" onClick={() => {
                          const ref = prompt("Aggregator ticket / portal ref?", c.externalRef ?? "") ?? undefined;
                          claimPatch.mutate({ id: c.id, body: { status: "submitted", externalRef: ref } });
                        }}>Mark submitted</Button>}
                        {c.status === "submitted" && <Button size="sm" variant="outline" onClick={() => {
                          const amt = prompt("Recovered amount in ₹?", String((c.amountPaise / 100).toFixed(2)));
                          if (amt == null) return;
                          claimPatch.mutate({ id: c.id, body: { status: "recovered", recoveredPaise: Math.round(parseFloat(amt) * 100) } });
                        }}>Mark recovered</Button>}
                        {(c.status === "open" || c.status === "submitted") && <Button size="sm" variant="ghost" onClick={() =>
                          claimPatch.mutate({ id: c.id, body: { status: "written_off" } })
                        }>Write off</Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(claimsQ.data ?? []).length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No claims yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Adjustments ─────────────────────────────────────────── */}
        <TabsContent value="adjustments" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Record manual adjustment</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div><Label>Aggregator</Label>
                  <Select value={adjAgg} onValueChange={v => setAdjAgg(v as Aggregator)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{AGGREGATORS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Amount (₹, signed)</Label>
                  <Input value={adjAmount} onChange={e => setAdjAmount(e.target.value)} placeholder="e.g. -250.00 for clawback" />
                </div>
                <div className="col-span-2"><Label>Reason</Label>
                  <Input value={adjReason} onChange={e => setAdjReason(e.target.value)} placeholder="e.g. Goodwill credit, write-off, late refund" />
                </div>
              </div>
              <Button onClick={() => adjMut.mutate()} disabled={!adjAmount || !adjReason || adjMut.isPending}>Save adjustment</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>History</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Date</TableHead><TableHead>Aggregator</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(adjustmentsQ.data ?? []).map(a => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{a.createdAt.slice(0, 10)}</TableCell>
                      <TableCell>{a.aggregator}</TableCell>
                      <TableCell className={`text-right font-medium ${a.amountPaise < 0 ? "text-red-600" : "text-green-600"}`}>{fmtINR(a.amountPaise)}</TableCell>
                      <TableCell>{a.reason}</TableCell>
                    </TableRow>
                  ))}
                  {(adjustmentsQ.data ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No adjustments.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Agreements ─────────────────────────────────────────── */}
        <TabsContent value="agreements" className="space-y-4">
          <p className="text-sm text-muted-foreground">Set the commission &amp; GST you've agreed with each aggregator. The reconciler uses these to flag overcharges and calculate expected payouts.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {AGGREGATORS.map(a => {
              const form = getAgreementForm(a);
              return (
                <Card key={a}>
                  <CardHeader><CardTitle className="capitalize">{a}</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      <div><Label>Commission %</Label>
                        <Input value={form.commissionPct}
                          onChange={e => setAgreementDraft(d => ({ ...d, [a]: { ...form, commissionPct: e.target.value } }))} /></div>
                      <div><Label>GST %</Label>
                        <Input value={form.gstPct}
                          onChange={e => setAgreementDraft(d => ({ ...d, [a]: { ...form, gstPct: e.target.value } }))} /></div>
                      <div><Label>Tolerance (paise)</Label>
                        <Input value={form.tolerance}
                          onChange={e => setAgreementDraft(d => ({ ...d, [a]: { ...form, tolerance: e.target.value } }))} /></div>
                    </div>
                    <Button onClick={() => saveAgreement.mutate(a)} disabled={saveAgreement.isPending}>Save</Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </Layout>
  );
}
