import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiFetch, apiAction } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Inbox, Search, Mail, Phone, Building2, MapPin } from "lucide-react";

interface Lead {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  restaurantName: string | null;
  city: string | null;
  outletCount: number | null;
  businessType: string | null;
  currentSoftware: string | null;
  preferredDateTime: string | null;
  features: string | null;
  message: string | null;
  sourcePage: string;
  status: string;
  notes: string | null;
  createdAt: string;
}

interface Stats {
  total: number;
  byStatus: { status: string; count: number }[];
}

const STATUSES = ["new", "contacted", "demo_scheduled", "converted", "lost"] as const;

const statusColor: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  new: "default",
  contacted: "secondary",
  demo_scheduled: "secondary",
  converted: "outline",
  lost: "destructive",
};

export default function AdminLeadsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Lead | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (q.trim()) params.set("q", q.trim());
  const qs = params.toString();

  const { data: leads = [], isLoading } = useQuery<Lead[]>({
    queryKey: ["admin-leads", statusFilter, q],
    queryFn: () => apiFetch<Lead[]>(`/admin/leads${qs ? `?${qs}` : ""}`),
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ["admin-leads-stats"],
    queryFn: () => apiFetch<Stats>("/admin/leads/stats"),
  });

  const update = useMutation({
    mutationFn: (vars: { id: number; status?: string; notes?: string }) =>
      apiAction<Lead>(`/admin/leads/${vars.id}`, "PATCH", { status: vars.status, notes: vars.notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-leads"] });
      qc.invalidateQueries({ queryKey: ["admin-leads-stats"] });
      toast({ title: "Lead updated" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const countFor = (s: string) => stats?.byStatus.find((b) => b.status === s)?.count ?? 0;

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Inbox className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Marketing leads</h1>
            <p className="text-sm text-muted-foreground">Inquiries, demo requests, and signups from the marketing site.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Card data-testid="card-stat-total">
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-medium">Total</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold">{stats?.total ?? 0}</CardContent>
          </Card>
          {STATUSES.map((s) => (
            <Card key={s} data-testid={`card-stat-${s}`}>
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-medium capitalize">{s.replace("_", " ")}</CardTitle></CardHeader>
              <CardContent className="text-2xl font-bold">{countFor(s)}</CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, restaurant…"
              className="pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              data-testid="input-search-leads"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-48" data-testid="select-status-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 text-center text-muted-foreground">Loading leads…</div>
            ) : leads.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">No leads match your filters.</div>
            ) : (
              <div className="divide-y">
                {leads.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setActive(l)}
                    className="w-full text-left p-4 hover:bg-accent transition-colors flex flex-col sm:flex-row sm:items-center gap-3"
                    data-testid={`row-lead-${l.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold truncate" data-testid={`text-lead-name-${l.id}`}>{l.name}</div>
                        <Badge variant={statusColor[l.status] || "outline"} className="capitalize text-xs">{l.status.replace("_", " ")}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-3 mt-1">
                        <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{l.email}</span>
                        {l.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{l.phone}</span>}
                        {l.restaurantName && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{l.restaurantName}</span>}
                        {l.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{l.city}</span>}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground text-right shrink-0">
                      <div className="capitalize">{l.sourcePage.replace("_", " ")}</div>
                      <div>{new Date(l.createdAt).toLocaleDateString()}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <LeadDetailDialog
          lead={active}
          onClose={() => setActive(null)}
          onUpdate={(status, notes) => active && update.mutate({ id: active.id, status, notes })}
          saving={update.isPending}
        />
      </div>
    </Layout>
  );
}

function LeadDetailDialog({
  lead,
  onClose,
  onUpdate,
  saving,
}: {
  lead: Lead | null;
  onClose: () => void;
  onUpdate: (status: string, notes: string) => void;
  saving: boolean;
}) {
  const [status, setStatus] = useState<string>(lead?.status ?? "new");
  const [notes, setNotes] = useState<string>(lead?.notes ?? "");

  useEffect(() => {
    if (lead) {
      setStatus(lead.status);
      setNotes(lead.notes ?? "");
    }
  }, [lead?.id]);

  return (
    <Dialog
      open={!!lead}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        {lead && (
          <>
            <DialogHeader>
              <DialogTitle data-testid="text-detail-name">{lead.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Email" value={lead.email} />
                <Field label="Phone" value={lead.phone} />
                <Field label="Restaurant" value={lead.restaurantName} />
                <Field label="City" value={lead.city} />
                <Field label="Outlets" value={lead.outletCount?.toString() ?? null} />
                <Field label="Business type" value={lead.businessType} />
                <Field label="Current software" value={lead.currentSoftware} />
                <Field label="Preferred time" value={lead.preferredDateTime} />
                <Field label="Source" value={lead.sourcePage} />
                <Field label="Submitted" value={new Date(lead.createdAt).toLocaleString()} />
              </div>
              {lead.features && <Field label="Features of interest" value={lead.features} block />}
              {lead.message && <Field label="Message" value={lead.message} block />}

              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger data-testid="select-detail-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Internal notes</label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Notes (only visible to admins)…"
                  data-testid="textarea-detail-notes"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} data-testid="button-cancel">Close</Button>
              <Button onClick={() => onUpdate(status, notes)} disabled={saving} data-testid="button-save-lead">
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, block }: { label: string; value: string | null; block?: boolean }) {
  if (!value) return null;
  return (
    <div className={block ? "col-span-2" : ""}>
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-sm whitespace-pre-wrap break-words">{value}</div>
    </div>
  );
}
