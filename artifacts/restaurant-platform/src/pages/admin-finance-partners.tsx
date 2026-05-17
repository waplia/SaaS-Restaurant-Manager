import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout as Layout } from "@/components/layout/AdminLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Landmark, Plus, Building2, FileText, CheckCircle2, XCircle, Clock, RefreshCw } from "lucide-react";

const fmtINR = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const bpsPct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

type Partner = {
  id: number; slug: string; name: string;
  contactEmail: string | null; contactPhone: string | null;
  websiteUrl: string | null; description: string | null;
  isActive: boolean;
  offers: CapitalOffer[];
};

type CapitalOffer = {
  id: number; partnerId: number; title: string; productType: string;
  minAdvanceAmount: number; maxAdvanceAmount: number;
  feeBps: number; dailyRepaymentBps: number;
  minMonthlySalesPaise: number; minMonthsOnPlatform: number;
  isActive: boolean; description: string | null;
};

type AppRow = {
  app: {
    id: number; status: string; requestedAmount: number; approvedAmount: number;
    feeAmount: number; dailyRepaymentBps: number; statusReason: string | null;
    statusTimeline: Array<{ status: string; at: string; note?: string }>;
    contactName: string | null; contactPhone: string | null; contactEmail: string | null;
    notes: string | null; restaurantId: number; createdAt: string; offerId: number | null;
  };
  restaurantName: string | null;
  partnerName: string | null;
  offerTitle: string | null;
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: any; icon: any }> = {
    submitted: { tone: "secondary", icon: Clock },
    reviewing: { tone: "outline", icon: RefreshCw },
    accepted: { tone: "default", icon: CheckCircle2 },
    repaying: { tone: "default", icon: RefreshCw },
    closed: { tone: "secondary", icon: CheckCircle2 },
    rejected: { tone: "destructive", icon: XCircle },
    cancelled: { tone: "secondary", icon: XCircle },
  };
  const m = map[status] ?? { tone: "secondary", icon: Clock };
  const Icon = m.icon;
  return <Badge variant={m.tone}><Icon className="w-3 h-3 mr-1" />{status}</Badge>;
}

export default function AdminFinancePartnersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: partners = [] } = useQuery<Partner[]>({
    queryKey: ["admin-finance-partners"],
    queryFn: () => apiGet(`/admin/finance-partners`),
  });
  const [statusFilter, setStatusFilter] = useState("all");
  const { data: applications = [] } = useQuery<AppRow[]>({
    queryKey: ["admin-capital-apps", statusFilter],
    queryFn: () => apiGet(`/admin/capital/applications?status=${statusFilter}`),
  });

  const [showNewPartner, setShowNewPartner] = useState(false);
  const [partnerForOffer, setPartnerForOffer] = useState<Partner | null>(null);
  const [reviewApp, setReviewApp] = useState<AppRow | null>(null);

  const totals = useMemo(() => {
    const t = { submitted: 0, reviewing: 0, accepted: 0, rejected: 0 };
    for (const a of applications) {
      if (a.app.status in t) (t as any)[a.app.status]++;
    }
    return t;
  }, [applications]);

  const togglePartnerMut = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiPatch(`/admin/finance-partners/${id}`, { isActive }),
    onSuccess: () => { toast({ title: "Partner updated" }); qc.invalidateQueries({ queryKey: ["admin-finance-partners"] }); },
  });
  const toggleOfferMut = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiPatch(`/admin/finance-partners/offers/${id}`, { isActive }),
    onSuccess: () => { toast({ title: "Offer updated" }); qc.invalidateQueries({ queryKey: ["admin-finance-partners"] }); },
  });

  return (
    <Layout>
      <PageHeader title="Finance Partners" subtitle="Manage lender partners, offers, and review applications" icon={Landmark} />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Partners</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{partners.length}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Submitted</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{totals.submitted}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Reviewing</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{totals.reviewing}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Accepted</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold text-emerald-600">{totals.accepted}</div></CardContent></Card>
        </div>

        <Tabs defaultValue="partners">
          <TabsList>
            <TabsTrigger value="partners">Partners</TabsTrigger>
            <TabsTrigger value="applications">Applications</TabsTrigger>
          </TabsList>

          <TabsContent value="partners" className="mt-4">
            <div className="flex justify-end mb-3">
              <Button size="sm" onClick={() => setShowNewPartner(true)} data-testid="new-partner-btn"><Plus className="w-3 h-3 mr-1" /> New partner</Button>
            </div>
            {partners.length === 0 ? (
              <Card><CardContent className="py-8 text-sm text-muted-foreground text-center">No finance partners onboarded yet.</CardContent></Card>
            ) : (
              <div className="space-y-4">
                {partners.map((p) => (
                  <Card key={p.id} data-testid={`partner-${p.id}`}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" /> {p.name} <Badge variant="outline" className="font-mono text-[10px]">{p.slug}</Badge></CardTitle>
                          {p.description && <p className="text-xs text-muted-foreground mt-1">{p.description}</p>}
                          <div className="text-xs text-muted-foreground mt-1">
                            {p.contactEmail ?? ""} {p.contactPhone ? `· ${p.contactPhone}` : ""} {p.websiteUrl ? `· ${p.websiteUrl}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Label className="text-xs">Active</Label>
                          <Switch checked={p.isActive} onCheckedChange={(v) => togglePartnerMut.mutate({ id: p.id, isActive: v })} />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm font-semibold">Offers ({p.offers.length})</div>
                        <Button size="sm" variant="outline" onClick={() => setPartnerForOffer(p)}><Plus className="w-3 h-3 mr-1" /> Add offer</Button>
                      </div>
                      {p.offers.length === 0 ? (
                        <div className="text-xs text-muted-foreground">No offers yet.</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/30"><tr>
                              <th className="text-left p-2">Title</th>
                              <th className="text-left p-2">Type</th>
                              <th className="text-right p-2">Max</th>
                              <th className="text-right p-2">Fee</th>
                              <th className="text-right p-2">Daily %</th>
                              <th className="text-right p-2">Min sales/mo</th>
                              <th className="text-right p-2">Min months</th>
                              <th className="text-right p-2">Active</th>
                            </tr></thead>
                            <tbody>
                              {p.offers.map((o) => (
                                <tr key={o.id} className="border-t">
                                  <td className="p-2 font-medium">{o.title}</td>
                                  <td className="p-2">{o.productType.replace("_", " ")}</td>
                                  <td className="p-2 text-right font-mono">{fmtINR(o.maxAdvanceAmount)}</td>
                                  <td className="p-2 text-right">{bpsPct(o.feeBps)}</td>
                                  <td className="p-2 text-right">{bpsPct(o.dailyRepaymentBps)}</td>
                                  <td className="p-2 text-right font-mono">{fmtINR(o.minMonthlySalesPaise)}</td>
                                  <td className="p-2 text-right">{o.minMonthsOnPlatform}</td>
                                  <td className="p-2 text-right">
                                    <Switch checked={o.isActive} onCheckedChange={(v) => toggleOfferMut.mutate({ id: o.id, isActive: v })} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="applications" className="mt-4">
            <div className="flex items-center justify-end gap-2 mb-3">
              <Label className="text-xs">Filter</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="reviewing">Reviewing</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Card>
              <CardContent className="p-0">
                {applications.length === 0 ? (
                  <div className="py-8 text-sm text-muted-foreground text-center">No applications.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30"><tr>
                      <th className="text-left p-3">#</th>
                      <th className="text-left p-3">Restaurant</th>
                      <th className="text-left p-3">Partner / Offer</th>
                      <th className="text-right p-3">Requested</th>
                      <th className="text-right p-3">Approved</th>
                      <th className="text-left p-3">Status</th>
                      <th className="text-left p-3">Submitted</th>
                      <th></th>
                    </tr></thead>
                    <tbody>
                      {applications.map((row) => (
                        <tr key={row.app.id} className="border-t" data-testid={`admin-app-${row.app.id}`}>
                          <td className="p-3">{row.app.id}</td>
                          <td className="p-3">{row.restaurantName ?? `#${row.app.restaurantId}`}</td>
                          <td className="p-3 text-xs">
                            <div className="font-medium">{row.partnerName ?? "—"}</div>
                            <div className="text-muted-foreground">{row.offerTitle ?? "—"}</div>
                          </td>
                          <td className="p-3 text-right font-mono">{fmtINR(row.app.requestedAmount)}</td>
                          <td className="p-3 text-right font-mono">{fmtINR(row.app.approvedAmount)}</td>
                          <td className="p-3"><StatusBadge status={row.app.status} /></td>
                          <td className="p-3 text-xs text-muted-foreground">{new Date(row.app.createdAt).toLocaleString()}</td>
                          <td className="p-3 text-right">
                            <Button size="sm" variant="outline" onClick={() => setReviewApp(row)}>Review</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {showNewPartner && <NewPartnerDialog open={showNewPartner} onClose={() => setShowNewPartner(false)} onSaved={() => { setShowNewPartner(false); qc.invalidateQueries({ queryKey: ["admin-finance-partners"] }); }} />}
      {partnerForOffer && <NewOfferDialog open={!!partnerForOffer} partner={partnerForOffer} onClose={() => setPartnerForOffer(null)} onSaved={() => { setPartnerForOffer(null); qc.invalidateQueries({ queryKey: ["admin-finance-partners"] }); }} />}
      {reviewApp && <ReviewApplicationDialog open={!!reviewApp} row={reviewApp} onClose={() => setReviewApp(null)} onChanged={() => { setReviewApp(null); qc.invalidateQueries({ queryKey: ["admin-capital-apps", statusFilter] }); }} />}
    </Layout>
  );
}

function NewPartnerDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [description, setDescription] = useState("");

  const mut = useMutation({
    mutationFn: (body: any) => apiPost(`/admin/finance-partners`, body),
    onSuccess: () => { toast({ title: "Partner created" }); onSaved(); },
    onError: (e: any) => toast({ title: "Could not create", description: e?.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New finance partner</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Slug (lowercase)</Label><Input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="acme-capital" data-testid="partner-slug" /></div>
            <div><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Acme Capital" data-testid="partner-name" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Contact email</Label><Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} /></div>
            <div><Label>Contact phone</Label><Input value={contactPhone} onChange={e => setContactPhone(e.target.value)} /></div>
          </div>
          <div><Label>Website</Label><Input value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} placeholder="https://…" /></div>
          <div><Label>Description</Label><Textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button data-testid="partner-create" disabled={!slug || !name || mut.isPending} onClick={() => mut.mutate({
            slug, name,
            contactEmail: contactEmail || undefined,
            contactPhone: contactPhone || undefined,
            websiteUrl: websiteUrl || undefined,
            description: description || undefined,
          })}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewOfferDialog({ open, partner, onClose, onSaved }: { open: boolean; partner: Partner; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("Sales-based advance");
  const [productType, setProductType] = useState("sales_advance");
  const [maxAdvanceRupees, setMaxAdvanceRupees] = useState("500000");
  const [feeBps, setFeeBps] = useState("1200");
  const [dailyRepaymentBps, setDailyRepaymentBps] = useState("1000");
  const [minMonthlySalesRupees, setMinMonthlySalesRupees] = useState("50000");
  const [minMonthsOnPlatform, setMinMonthsOnPlatform] = useState("3");
  const [description, setDescription] = useState("");

  const mut = useMutation({
    mutationFn: (body: any) => apiPost(`/admin/finance-partners/${partner.id}/offers`, body),
    onSuccess: () => { toast({ title: "Offer created" }); onSaved(); },
    onError: (e: any) => toast({ title: "Could not create", description: e?.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New offer · {partner.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Title</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
            <div>
              <Label>Product type</Label>
              <Select value={productType} onValueChange={setProductType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sales_advance">Sales advance</SelectItem>
                  <SelectItem value="term_loan">Term loan</SelectItem>
                  <SelectItem value="line_of_credit">Line of credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Max advance (₹)</Label><Input type="number" value={maxAdvanceRupees} onChange={e => setMaxAdvanceRupees(e.target.value)} /></div>
            <div><Label>Fee (bps)</Label><Input type="number" value={feeBps} onChange={e => setFeeBps(e.target.value)} /></div>
            <div><Label>Daily % (bps)</Label><Input type="number" value={dailyRepaymentBps} onChange={e => setDailyRepaymentBps(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Min monthly sales (₹)</Label><Input type="number" value={minMonthlySalesRupees} onChange={e => setMinMonthlySalesRupees(e.target.value)} /></div>
            <div><Label>Min months on platform</Label><Input type="number" value={minMonthsOnPlatform} onChange={e => setMinMonthsOnPlatform(e.target.value)} /></div>
          </div>
          <div><Label>Description</Label><Textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={mut.isPending} onClick={() => mut.mutate({
            title, productType,
            maxAdvanceAmount: Math.round(parseFloat(maxAdvanceRupees || "0") * 100),
            feeBps: parseInt(feeBps || "0", 10),
            dailyRepaymentBps: parseInt(dailyRepaymentBps || "0", 10),
            minMonthlySalesPaise: Math.round(parseFloat(minMonthlySalesRupees || "0") * 100),
            minMonthsOnPlatform: parseInt(minMonthsOnPlatform || "0", 10),
            description: description || undefined,
          })}>Create offer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewApplicationDialog({ open, row, onClose, onChanged }: { open: boolean; row: AppRow; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const { data: detail } = useQuery<{ application: any; documents: any[]; repayments: any[] }>({
    queryKey: ["admin-capital-app", row.app.id],
    queryFn: () => apiGet(`/admin/capital/applications/${row.app.id}`),
    enabled: open,
  });
  const [approvedRupees, setApprovedRupees] = useState(((row.app.approvedAmount || row.app.requestedAmount) / 100).toFixed(0));
  const [feeRupees, setFeeRupees] = useState(((row.app.feeAmount) / 100).toFixed(0));
  const [dailyBps, setDailyBps] = useState(String(row.app.dailyRepaymentBps || 0));
  const [reason, setReason] = useState("");

  const reviewMut = useMutation({
    mutationFn: (body: any) => apiPost(`/admin/capital/applications/${row.app.id}/review`, body),
    onSuccess: () => { toast({ title: "Application updated" }); onChanged(); },
    onError: (e: any) => toast({ title: "Could not update", description: e?.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">Application #{row.app.id} <StatusBadge status={row.app.status} /></DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div><div className="text-muted-foreground">Restaurant</div><div className="font-semibold">{row.restaurantName}</div></div>
            <div><div className="text-muted-foreground">Partner / offer</div><div className="font-semibold">{row.partnerName} — {row.offerTitle}</div></div>
            <div><div className="text-muted-foreground">Contact</div><div>{row.app.contactName ?? "—"} {row.app.contactPhone ? `· ${row.app.contactPhone}` : ""} {row.app.contactEmail ? `· ${row.app.contactEmail}` : ""}</div></div>
            <div><div className="text-muted-foreground">Notes</div><div>{row.app.notes ?? "—"}</div></div>
          </div>
          <div>
            <div className="font-semibold mb-1">Documents ({detail?.documents.length ?? 0})</div>
            {(detail?.documents.length ?? 0) === 0 ? (
              <div className="text-xs text-muted-foreground">None uploaded.</div>
            ) : (
              <ul className="space-y-1">
                {detail?.documents.map((d: any) => (
                  <li key={d.id} className="text-xs border rounded px-2 py-1 flex items-center justify-between">
                    <span className="flex items-center gap-2"><FileText className="w-3 h-3" /> {d.label} · {d.fileName}</span>
                    <span className="text-muted-foreground">{(d.sizeBytes / 1024).toFixed(1)} KB</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="font-semibold mb-1">Status timeline</div>
            <ol className="border-l-2 pl-3 space-y-1 text-xs">
              {(row.app.statusTimeline ?? []).map((t, i) => (
                <li key={i}><span className="font-medium capitalize">{t.status}</span> · {new Date(t.at).toLocaleString()}{t.note ? ` — ${t.note}` : ""}</li>
              ))}
            </ol>
          </div>

          {(row.app.status === "submitted" || row.app.status === "reviewing") && (
            <div className="border-t pt-3 space-y-3">
              <div className="font-semibold">Review</div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Approved amount (₹)</Label><Input type="number" value={approvedRupees} onChange={e => setApprovedRupees(e.target.value)} /></div>
                <div><Label>Fee (₹)</Label><Input type="number" value={feeRupees} onChange={e => setFeeRupees(e.target.value)} /></div>
                <div><Label>Daily % (bps)</Label><Input type="number" value={dailyBps} onChange={e => setDailyBps(e.target.value)} /></div>
              </div>
              <div><Label>Reason / note</Label><Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} /></div>
              <div className="flex gap-2 justify-end">
                {row.app.status === "submitted" && (
                  <Button variant="outline" disabled={reviewMut.isPending} onClick={() => reviewMut.mutate({ action: "mark_reviewing", reason: reason || undefined })} data-testid="review-mark-reviewing">Mark reviewing</Button>
                )}
                <Button variant="destructive" disabled={reviewMut.isPending} onClick={() => reviewMut.mutate({ action: "reject", reason: reason || undefined })} data-testid="review-reject">Reject</Button>
                <Button disabled={reviewMut.isPending} onClick={() => reviewMut.mutate({
                  action: "accept",
                  approvedAmount: Math.round(parseFloat(approvedRupees || "0") * 100),
                  feeAmount: Math.round(parseFloat(feeRupees || "0") * 100),
                  dailyRepaymentBps: parseInt(dailyBps || "0", 10),
                  reason: reason || undefined,
                })} data-testid="review-accept">Accept</Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
