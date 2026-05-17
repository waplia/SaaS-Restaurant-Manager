import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost } from "@/lib/api";
import {
  TrendingUp, ShieldCheck, Banknote, Building2, FileText,
  Upload, CheckCircle2, XCircle, Clock, RefreshCw,
} from "lucide-react";

const fmtINR = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const bpsPct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

type Eligibility = {
  last30dSalesPaise: number;
  last90dSalesPaise: number;
  avgMonthlySalesPaise: number;
  last30dOrderCount: number;
  monthsOnPlatform: number;
  suggestedMaxAdvancePaise: number;
  eligible: boolean;
};

type CapitalOffer = {
  id: number;
  partnerId: number;
  title: string;
  productType: string;
  minAdvanceAmount: number;
  maxAdvanceAmount: number;
  feeBps: number;
  dailyRepaymentBps: number;
  description: string | null;
};

type Partner = { id: number; name: string; slug: string; description: string | null };
type OfferRow = { offer: CapitalOffer; partner: Partner };

type CapitalApplication = {
  id: number;
  offerId: number | null;
  partnerId: number | null;
  status: "submitted" | "reviewing" | "accepted" | "rejected" | "cancelled" | "repaying" | "closed";
  statusReason: string | null;
  statusTimeline: Array<{ status: string; at: string; note?: string }>;
  requestedAmount: number;
  approvedAmount: number;
  feeAmount: number;
  dailyRepaymentBps: number;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  createdAt: string;
  reviewedAt: string | null;
  disbursedAt: string | null;
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: any; label: string; icon: any }> = {
    submitted: { tone: "secondary", label: "Submitted", icon: Clock },
    reviewing: { tone: "outline", label: "Reviewing", icon: RefreshCw },
    accepted: { tone: "default", label: "Accepted", icon: CheckCircle2 },
    repaying: { tone: "default", label: "Repaying", icon: RefreshCw },
    closed: { tone: "secondary", label: "Closed", icon: CheckCircle2 },
    rejected: { tone: "destructive", label: "Rejected", icon: XCircle },
    cancelled: { tone: "secondary", label: "Cancelled", icon: XCircle },
  };
  const m = map[status] ?? { tone: "secondary", label: status, icon: Clock };
  const Icon = m.icon;
  return <Badge variant={m.tone}><Icon className="w-3 h-3 mr-1" />{m.label}</Badge>;
}

export default function CapitalPage() {
  const restaurantId = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: offersResp, isError: offersError, error: offersErr } = useQuery<{ eligibility: Eligibility; offers: OfferRow[] }>({
    queryKey: ["capital-offers", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/capital/offers`),
    enabled: !!restaurantId,
    retry: false,
  });
  const planLocked = offersError && /enterprise/i.test((offersErr as any)?.message ?? "");

  const eligibility = offersResp?.eligibility;
  const offers = offersResp?.offers ?? [];

  const { data: applications = [] } = useQuery<CapitalApplication[]>({
    queryKey: ["capital-apps", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/capital/applications`),
    enabled: !!restaurantId && !planLocked,
  });

  const { data: insuranceOffers = [] } = useQuery<Array<any>>({
    queryKey: ["insurance-offers"],
    queryFn: () => apiGet(`/insurance/offers`),
  });

  const [pickedOffer, setPickedOffer] = useState<OfferRow | null>(null);
  const [appOpen, setAppOpen] = useState(false);
  const [activeApp, setActiveApp] = useState<CapitalApplication | null>(null);

  function refreshAll() {
    qc.invalidateQueries({ queryKey: ["capital-offers", restaurantId] });
    qc.invalidateQueries({ queryKey: ["capital-apps", restaurantId] });
  }

  const interestMut = useMutation({
    mutationFn: (body: any) => apiPost(`/restaurants/${restaurantId}/insurance/interest`, body),
    onSuccess: () => toast({ title: "Interest registered" }),
  });

  if (planLocked) {
    return (
      <Layout>
        <PageHeader title="Capital & Financing" subtitle="Sales-based advances from partner lenders" icon={TrendingUp} />
        <div className="p-6">
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <Banknote className="w-10 h-10 mx-auto text-muted-foreground" />
              <div className="text-lg font-semibold">Available on Enterprise</div>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Capital & Financing offers sales-based advances and term-loan offers from our partner
                lenders. Upgrade to Enterprise to unlock eligibility, offers, applications and repayment tracking.
              </p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <PageHeader title="Capital & Financing" subtitle="Sales-based advances from partner lenders" icon={TrendingUp} />
      <div className="p-6 space-y-6">
        {/* Eligibility */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Banknote className="w-4 h-4" /> Your eligibility
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Avg monthly sales</div>
                <div className="text-xl font-bold">{eligibility ? fmtINR(eligibility.avgMonthlySalesPaise) : "—"}</div>
                <div className="text-xs text-muted-foreground">trailing 90d ÷ 3</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Last 30d sales</div>
                <div className="text-xl font-bold">{eligibility ? fmtINR(eligibility.last30dSalesPaise) : "—"}</div>
                <div className="text-xs text-muted-foreground">{eligibility?.last30dOrderCount ?? 0} orders</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Months on platform</div>
                <div className="text-xl font-bold">{eligibility?.monthsOnPlatform ?? 0}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Suggested cap</div>
                <div className="text-xl font-bold">{eligibility ? fmtINR(eligibility.suggestedMaxAdvancePaise) : "—"}</div>
                <div className="text-xs text-muted-foreground">~50% of avg monthly</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Status</div>
                <div className="mt-1">
                  {eligibility?.eligible
                    ? <Badge>Eligible</Badge>
                    : <Badge variant="secondary">Build history</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-1">≥ ₹50k/mo · ≥ 3 months</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="offers">
          <TabsList>
            <TabsTrigger value="offers">Offers</TabsTrigger>
            <TabsTrigger value="applications">My applications {applications.length > 0 && <Badge variant="secondary" className="ml-2">{applications.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="insurance">Insurance</TabsTrigger>
          </TabsList>

          <TabsContent value="offers" className="mt-4">
            {offers.length === 0 ? (
              <Card><CardContent className="py-8 text-sm text-muted-foreground text-center">
                No offers match your profile yet. Keep operating on the platform and check back as partners come online.
              </CardContent></Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {offers.map(({ offer, partner }) => (
                  <Card key={offer.id} data-testid={`offer-card-${offer.id}`}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" />{partner.name}</CardTitle>
                          <div className="text-sm font-medium mt-1">{offer.title}</div>
                        </div>
                        <Badge variant="outline">{offer.productType.replace("_", " ")}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="rounded-md bg-muted/40 p-2">
                          <div className="text-xs text-muted-foreground">Up to</div>
                          <div className="font-bold">{fmtINR(offer.maxAdvanceAmount)}</div>
                        </div>
                        <div className="rounded-md bg-muted/40 p-2">
                          <div className="text-xs text-muted-foreground">Fee</div>
                          <div className="font-bold">{bpsPct(offer.feeBps)}</div>
                        </div>
                        <div className="rounded-md bg-muted/40 p-2">
                          <div className="text-xs text-muted-foreground">Daily %</div>
                          <div className="font-bold">{bpsPct(offer.dailyRepaymentBps)}</div>
                        </div>
                      </div>
                      {offer.description && <p className="text-xs text-muted-foreground">{offer.description}</p>}
                      <Button
                        className="w-full"
                        disabled={!eligibility?.eligible}
                        onClick={() => { setPickedOffer({ offer, partner }); setAppOpen(true); }}
                        data-testid={`apply-${offer.id}`}
                      >
                        Apply now
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="applications" className="mt-4">
            {applications.length === 0 ? (
              <Card><CardContent className="py-8 text-sm text-muted-foreground text-center">No applications yet.</CardContent></Card>
            ) : (
              <div className="space-y-3">
                {applications.map((a) => (
                  <Card key={a.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setActiveApp(a)} data-testid={`app-row-${a.id}`}>
                    <CardContent className="py-4 flex items-center justify-between gap-4">
                      <div>
                        <div className="font-medium flex items-center gap-2"><FileText className="w-4 h-4" /> Application #{a.id}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Requested {fmtINR(a.requestedAmount)} · Fee {fmtINR(a.feeAmount)} · Daily {bpsPct(a.dailyRepaymentBps)}
                          {a.status === "accepted" || a.status === "repaying" ? ` · Approved ${fmtINR(a.approvedAmount)}` : ""}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">Submitted {new Date(a.createdAt).toLocaleString()}</div>
                      </div>
                      <StatusBadge status={a.status} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="insurance" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Insurance offers</CardTitle></CardHeader>
              <CardContent>
                {insuranceOffers.length === 0 ? <p className="text-sm text-muted-foreground">No insurance partners onboarded yet.</p> : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {insuranceOffers.map((o: any) => (
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
          </TabsContent>
        </Tabs>
      </div>

      {pickedOffer && (
        <ApplicationDialog
          open={appOpen}
          onClose={() => setAppOpen(false)}
          offerRow={pickedOffer}
          eligibility={eligibility!}
          onSubmitted={() => { setAppOpen(false); refreshAll(); }}
          restaurantId={restaurantId}
        />
      )}

      {activeApp && (
        <ApplicationDetailDialog
          open={!!activeApp}
          onClose={() => setActiveApp(null)}
          application={activeApp}
          restaurantId={restaurantId}
          onChanged={() => { refreshAll(); }}
        />
      )}
    </Layout>
  );
}

// ─── Application submission dialog ─────────────────────────────────────────

function ApplicationDialog({ open, onClose, offerRow, eligibility, onSubmitted, restaurantId }: {
  open: boolean; onClose: () => void;
  offerRow: OfferRow; eligibility: Eligibility;
  onSubmitted: () => void; restaurantId: number;
}) {
  const { toast } = useToast();
  const max = Math.min(offerRow.offer.maxAdvanceAmount, eligibility.suggestedMaxAdvancePaise || offerRow.offer.maxAdvanceAmount);
  const [amount, setAmount] = useState((max / 100).toFixed(0));
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [notes, setNotes] = useState("");

  const submitMut = useMutation({
    mutationFn: (body: any) => apiPost(`/restaurants/${restaurantId}/capital/applications`, body),
    onSuccess: () => { toast({ title: "Application submitted" }); onSubmitted(); },
    onError: (e: any) => toast({ title: "Could not submit", description: e?.message ?? String(e), variant: "destructive" }),
  });

  const paise = Math.round(parseFloat(amount || "0") * 100);
  const fee = Math.round((paise * offerRow.offer.feeBps) / 10_000);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Apply: {offerRow.partner.name} — {offerRow.offer.title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Up to <strong>{fmtINR(offerRow.offer.maxAdvanceAmount)}</strong> · Fee <strong>{bpsPct(offerRow.offer.feeBps)}</strong> · Daily repayment <strong>{bpsPct(offerRow.offer.dailyRepaymentBps)}</strong> of sales
          </div>
          <div>
            <Label>Requested amount (₹)</Label>
            <Input data-testid="apply-amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="text-xs text-muted-foreground mt-1">
              Suggested cap: {fmtINR(max)} · Estimated fee: <strong>{fmtINR(fee)}</strong> · Total repayable: <strong>{fmtINR(paise + fee)}</strong>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Contact name</Label><Input value={contactName} onChange={e => setContactName(e.target.value)} /></div>
            <div><Label>Phone</Label><Input value={contactPhone} onChange={e => setContactPhone(e.target.value)} /></div>
          </div>
          <div><Label>Email</Label><Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} /></div>
          <div><Label>Notes for the partner</Label><Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="apply-submit"
            disabled={!amount || paise <= 0 || submitMut.isPending}
            onClick={() => submitMut.mutate({
              offerId: offerRow.offer.id,
              requestedPaise: paise,
              contactName: contactName || undefined,
              contactPhone: contactPhone || undefined,
              contactEmail: contactEmail || undefined,
              notes: notes || undefined,
            })}
          >Submit application</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Application detail / documents / repayments ──────────────────────────

function ApplicationDetailDialog({ open, onClose, application, restaurantId, onChanged }: {
  open: boolean; onClose: () => void;
  application: CapitalApplication;
  restaurantId: number;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docLabel, setDocLabel] = useState("Bank statement");
  const [uploading, setUploading] = useState(false);

  const { data: docs = [] } = useQuery<any[]>({
    queryKey: ["capital-app-docs", application.id],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/capital/applications/${application.id}/documents`),
    enabled: open,
  });
  const { data: repay } = useQuery<{ entries: any[]; totals: { repaidPaise: number; days: number } }>({
    queryKey: ["capital-app-repay", application.id],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/capital/applications/${application.id}/repayments`),
    enabled: open,
  });

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const presign = await apiPost<{ uploadURL: string; objectPath: string }>(
        `/restaurants/${restaurantId}/storage/uploads/request-url`,
        { name: file.name, size: file.size, contentType: file.type || "application/octet-stream" },
      );
      const put = await fetch(presign.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      await apiPost(`/restaurants/${restaurantId}/capital/applications/${application.id}/documents`, {
        label: docLabel, fileName: file.name,
        mimeType: file.type || "application/octet-stream", sizeBytes: file.size,
        objectPath: presign.objectPath,
      });
      toast({ title: "Document uploaded" });
      qc.invalidateQueries({ queryKey: ["capital-app-docs", application.id] });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const cancelMut = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/capital/applications/${application.id}/cancel`, {}),
    onSuccess: () => { toast({ title: "Application cancelled" }); onChanged(); onClose(); },
  });
  const runRepayMut = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/capital/applications/${application.id}/repayments/run`, {}),
    onSuccess: (r: any) => {
      toast({ title: "Repayments updated", description: `${r.insertedDays} day(s) added` });
      qc.invalidateQueries({ queryKey: ["capital-app-repay", application.id] });
    },
  });

  const timeline = useMemo(() => application.statusTimeline ?? [], [application]);
  const canCancel = ["submitted", "reviewing"].includes(application.status);
  const canRunRepay = ["accepted", "repaying"].includes(application.status);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Application #{application.id}
            <StatusBadge status={application.status} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-muted/30 rounded">
            <div><div className="text-xs text-muted-foreground">Requested</div><div className="font-semibold">{fmtINR(application.requestedAmount)}</div></div>
            <div><div className="text-xs text-muted-foreground">Approved</div><div className="font-semibold">{fmtINR(application.approvedAmount)}</div></div>
            <div><div className="text-xs text-muted-foreground">Fee</div><div className="font-semibold">{fmtINR(application.feeAmount)}</div></div>
            <div><div className="text-xs text-muted-foreground">Daily %</div><div className="font-semibold">{bpsPct(application.dailyRepaymentBps)}</div></div>
          </div>

          {application.statusReason && (
            <div className="text-xs p-2 rounded border bg-orange-50 dark:bg-orange-950/20">
              <strong>Reviewer note:</strong> {application.statusReason}
            </div>
          )}

          {/* Timeline */}
          <div>
            <div className="font-semibold mb-2">Status timeline</div>
            <ol className="border-l-2 pl-4 space-y-2">
              {timeline.map((t, i) => (
                <li key={i} className="text-xs">
                  <div className="font-medium capitalize">{t.status}</div>
                  <div className="text-muted-foreground">{new Date(t.at).toLocaleString()}{t.note ? ` — ${t.note}` : ""}</div>
                </li>
              ))}
            </ol>
          </div>

          {/* Documents */}
          <div>
            <div className="font-semibold mb-2 flex items-center justify-between">
              <span>Supporting documents</span>
              <Badge variant="outline">{docs.length}</Badge>
            </div>
            <div className="flex items-end gap-2 mb-3">
              <div className="flex-1">
                <Label className="text-xs">Document label</Label>
                <Select value={docLabel} onValueChange={setDocLabel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Bank statement">Bank statement</SelectItem>
                    <SelectItem value="GST returns">GST returns</SelectItem>
                    <SelectItem value="ITR">Income tax returns</SelectItem>
                    <SelectItem value="ID proof">ID proof</SelectItem>
                    <SelectItem value="Address proof">Address proof</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <input
                ref={fileRef} type="file" className="hidden"
                accept="image/*,application/pdf"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
              />
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <Upload className="w-3 h-3 mr-1" /> {uploading ? "Uploading…" : "Upload"}
              </Button>
            </div>
            {docs.length === 0 ? (
              <div className="text-xs text-muted-foreground">No documents yet.</div>
            ) : (
              <ul className="space-y-1">
                {docs.map((d: any) => (
                  <li key={d.id} className="flex items-center justify-between text-xs border rounded px-2 py-1">
                    <div className="flex items-center gap-2"><FileText className="w-3 h-3" /> <span className="font-medium">{d.label}</span> · <span className="text-muted-foreground">{d.fileName}</span></div>
                    <span className="text-muted-foreground">{(d.sizeBytes / 1024).toFixed(1)} KB</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Repayments */}
          <div>
            <div className="font-semibold mb-2 flex items-center justify-between">
              <span>Daily repayment ledger</span>
              {canRunRepay && (
                <Button size="sm" variant="outline" onClick={() => runRepayMut.mutate()} disabled={runRepayMut.isPending}>
                  <RefreshCw className="w-3 h-3 mr-1" /> Run today
                </Button>
              )}
            </div>
            {!canRunRepay ? (
              <div className="text-xs text-muted-foreground">Repayments begin once the application is accepted.</div>
            ) : repay && repay.entries.length === 0 ? (
              <div className="text-xs text-muted-foreground">No repayment entries yet. Hit “Run today” to compute the daily ledger from sales.</div>
            ) : (
              <>
                <div className="text-xs text-muted-foreground mb-2">
                  Total repaid: <strong>{fmtINR(repay?.totals.repaidPaise ?? 0)}</strong> over {repay?.totals.days ?? 0} day(s) ·
                  Outstanding: <strong>{fmtINR(Math.max(0, application.approvedAmount + application.feeAmount - (repay?.totals.repaidPaise ?? 0)))}</strong>
                </div>
                <div className="border rounded max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40"><tr><th className="text-left p-2">Date</th><th className="text-right p-2">Sales</th><th className="text-right p-2">%</th><th className="text-right p-2">Repayment</th></tr></thead>
                    <tbody>
                      {repay?.entries.map((r: any) => (
                        <tr key={r.id} className="border-t">
                          <td className="p-2">{new Date(r.forDate).toLocaleDateString()}</td>
                          <td className="p-2 text-right font-mono">{fmtINR(r.salesPaise)}</td>
                          <td className="p-2 text-right">{bpsPct(r.bps)}</td>
                          <td className="p-2 text-right font-mono font-semibold">{fmtINR(r.repaymentPaise)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          {canCancel && <Button variant="destructive" onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending}>Cancel application</Button>}
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
