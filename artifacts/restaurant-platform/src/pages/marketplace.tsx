import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiAction, ApiError } from "@/lib/api";
import {
  Sparkles, Package, Gift, MessageCircle, Wallet, ShoppingCart, Smartphone,
  FileSpreadsheet, Truck, Monitor, ChefHat, Building2, BarChart3, Star,
  Search, CheckCircle2, Clock, X, Zap, History,
} from "lucide-react";
import { ADDON_CATEGORIES } from "@workspace/db/addonCatalogue";
import { format } from "date-fns";

type AddonRow = {
  key: string;
  name: string;
  description: string;
  longDescription: string;
  icon: string;
  category: string;
  pricing: { mode: string; monthlyPrice?: number; yearlyPrice?: number; currency?: string };
  trialDays: number;
  comingSoon: boolean;
  isEnabled: boolean;
  featureFlags: string[];
  status: "trial" | "active" | "cancelled" | "expired" | "not_installed" | "included_in_plan";
  active: boolean;
  includedInPlan: boolean;
  eligibleByPlan: boolean;
  install: null | {
    status: string; source: string; billingCycle: string | null;
    pricePaid: string | null; currency: string | null;
    startedAt: string; trialEndsAt: string | null;
    currentPeriodEndsAt: string | null; cancelledAt: string | null;
  };
};

type AddonEvent = {
  id: number; addonKey: string; eventType: string; source: string;
  amount: string | null; currency: string | null; notes: string | null;
  createdAt: string;
};

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Sparkles, Package, Gift, MessageCircle, Wallet, ShoppingCart, Smartphone,
  FileSpreadsheet, Truck, Monitor, ChefHat, Building2, BarChart3, Star,
};

function fmtPrice(p: AddonRow["pricing"]): string {
  const cur = p.currency === "INR" ? "₹" : (p.currency ?? "");
  if (p.mode === "free") return "Free";
  if (p.monthlyPrice != null) return `${cur}${p.monthlyPrice.toLocaleString("en-IN")}/mo`;
  if (p.yearlyPrice != null) return `${cur}${p.yearlyPrice.toLocaleString("en-IN")}/yr`;
  return "—";
}

function statusBadge(a: AddonRow) {
  if (a.includedInPlan) return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Included in plan</Badge>;
  if (a.status === "active") return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Active</Badge>;
  if (a.status === "trial") return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Trial</Badge>;
  if (a.status === "cancelled") return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Cancelling</Badge>;
  if (a.status === "expired") return <Badge variant="outline">Expired</Badge>;
  if (a.comingSoon) return <Badge variant="outline">Coming soon</Badge>;
  return null;
}

export default function MarketplacePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [tab, setTab] = useState<"browse" | "installed" | "events">("browse");
  const [selected, setSelected] = useState<AddonRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["marketplace-addons"],
    queryFn: () => apiFetch<{ addons: AddonRow[] }>("/addons"),
  });
  const addons = data?.addons ?? [];

  const { data: eventsData } = useQuery({
    queryKey: ["marketplace-addon-events"],
    queryFn: () => apiFetch<{ events: AddonEvent[] }>("/addons/events?limit=100"),
    enabled: tab === "events",
  });

  const filtered = useMemo(() => {
    return addons.filter(a => {
      if (category !== "all" && a.category !== category) return false;
      if (search && !`${a.name} ${a.description}`.toLowerCase().includes(search.toLowerCase())) return false;
      if (tab === "installed" && !(a.active || a.status === "cancelled" || a.status === "expired")) return false;
      return true;
    });
  }, [addons, category, search, tab]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["marketplace-addons"] });
    qc.invalidateQueries({ queryKey: ["marketplace-addon-events"] });
  };

  const handleAction = async (key: string, action: "install" | "start-trial" | "uninstall" | "confirm-payment", body?: unknown) => {
    try {
      await apiAction(`/addons/${key}/${action}`, "POST", body ?? {});
      const verb = action === "install" ? "installed" : action === "start-trial" ? "trial started" : action === "uninstall" ? "uninstalled" : "activated";
      toast({ title: `Add-on ${verb}` });
      refresh();
      setSelected(null);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Something went wrong";
      toast({ title: "Could not complete", description: msg, variant: "destructive" });
    }
  };

  const installMut = useMutation({ mutationFn: (k: string) => apiAction(`/addons/${k}/install`, "POST", {}) });

  return (
    <Layout>
      <PageHeader
        title="Marketplace"
        subtitle="Add new capabilities to your TableTrack workspace — install, trial, or remove anytime."
      />

      <div className="p-6 space-y-6">
        <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <TabsList>
              <TabsTrigger value="browse">Browse</TabsTrigger>
              <TabsTrigger value="installed">Installed</TabsTrigger>
              <TabsTrigger value="events"><History className="w-3.5 h-3.5 mr-1" />Activity</TabsTrigger>
            </TabsList>
            {(tab === "browse" || tab === "installed") && (
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search add-ons" className="pl-9 w-64" />
                </div>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="border rounded-md h-9 px-2 text-sm bg-background"
                  data-testid="select-category"
                >
                  <option value="all">All categories</option>
                  {ADDON_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
            )}
          </div>

          <TabsContent value="browse" className="mt-6">
            <AddonGrid addons={filtered} loading={isLoading} onSelect={setSelected} onQuickInstall={k => installMut.mutate(k, { onSuccess: () => { toast({ title: "Installed" }); refresh(); } })} />
          </TabsContent>
          <TabsContent value="installed" className="mt-6">
            <AddonGrid addons={filtered} loading={isLoading} onSelect={setSelected} variant="installed" />
          </TabsContent>
          <TabsContent value="events" className="mt-6">
            <EventsTable events={eventsData?.events ?? []} />
          </TabsContent>
        </Tabs>
      </div>

      <AddonDetailDialog
        addon={selected}
        onClose={() => setSelected(null)}
        onAction={handleAction}
      />
    </Layout>
  );
}

function AddonGrid({ addons, loading, onSelect, onQuickInstall, variant }: {
  addons: AddonRow[]; loading: boolean; onSelect: (a: AddonRow) => void;
  onQuickInstall?: (k: string) => void; variant?: "installed";
}) {
  if (loading) return <div className="text-muted-foreground p-8 text-center">Loading…</div>;
  if (addons.length === 0) return <div className="text-muted-foreground p-12 text-center border border-dashed rounded-lg">No add-ons match your filters.</div>;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {addons.map(a => {
        const Icon = ICON_MAP[a.icon] ?? Package;
        const canInstallFree = !a.active && !a.comingSoon && a.isEnabled && a.pricing.mode === "free";
        return (
          <div key={a.key} data-testid={`addon-card-${a.key}`} className="border rounded-xl p-5 bg-card hover:shadow-md transition-shadow flex flex-col">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Icon className="w-5 h-5" /></div>
              {statusBadge(a)}
            </div>
            <h3 className="font-semibold text-base mb-1">{a.name}</h3>
            <p className="text-sm text-muted-foreground mb-4 flex-1">{a.description}</p>
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">{fmtPrice(a.pricing)}{a.trialDays > 0 && !a.active ? <span className="text-xs text-muted-foreground ml-2">{a.trialDays}-day trial</span> : null}</div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => onSelect(a)} data-testid={`button-details-${a.key}`}>Details</Button>
                {variant !== "installed" && canInstallFree && onQuickInstall && (
                  <Button size="sm" onClick={() => onQuickInstall(a.key)} data-testid={`button-install-${a.key}`}>Install</Button>
                )}
              </div>
            </div>
            {a.install?.trialEndsAt && a.status === "trial" && (
              <div className="mt-3 text-xs text-blue-700 flex items-center gap-1"><Clock className="w-3 h-3" />Trial ends {format(new Date(a.install.trialEndsAt), "PP")}</div>
            )}
            {a.install?.currentPeriodEndsAt && a.status === "active" && (
              <div className="mt-3 text-xs text-emerald-700 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Renews {format(new Date(a.install.currentPeriodEndsAt), "PP")}</div>
            )}
            {a.install?.cancelledAt && a.status === "cancelled" && (
              <div className="mt-3 text-xs text-amber-700 flex items-center gap-1"><Clock className="w-3 h-3" />Access ends {a.install.currentPeriodEndsAt ? format(new Date(a.install.currentPeriodEndsAt), "PP") : "soon"}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AddonDetailDialog({ addon, onClose, onAction }: {
  addon: AddonRow | null;
  onClose: () => void;
  onAction: (key: string, action: "install" | "start-trial" | "uninstall" | "confirm-payment", body?: unknown) => Promise<void>;
}) {
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  if (!addon) return null;
  const Icon = ICON_MAP[addon.icon] ?? Package;
  const isPaid = addon.pricing.mode !== "free";
  const canTrial = addon.trialDays > 0 && !addon.active && addon.isEnabled && !addon.comingSoon;
  const canPay = isPaid && !addon.comingSoon && addon.isEnabled && (addon.status !== "active" || addon.status === undefined);
  const canFreeInstall = !isPaid && !addon.active && !addon.comingSoon && addon.isEnabled;
  const canUninstall = addon.install && (addon.install.status === "active" || addon.install.status === "trial") && !addon.includedInPlan;

  return (
    <Dialog open={!!addon} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Icon className="w-5 h-5" /></div>
            <div>
              <DialogTitle>{addon.name}</DialogTitle>
              <DialogDescription>{addon.description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">{statusBadge(addon)}</div>

          <p className="text-sm text-muted-foreground">{addon.longDescription}</p>

          {!addon.eligibleByPlan && (
            <div className="rounded-md bg-amber-50 text-amber-800 text-sm p-3">
              Your current plan can't install this add-on. Upgrade your plan to enable it.
            </div>
          )}
          {addon.comingSoon && (
            <div className="rounded-md bg-muted text-sm p-3">This add-on is coming soon — we'll notify you when it's ready.</div>
          )}

          {isPaid && !addon.includedInPlan && (
            <div className="rounded-md border p-3 space-y-2">
              <div className="text-sm font-medium">Choose billing</div>
              <div className="flex gap-2">
                {addon.pricing.monthlyPrice != null && (
                  <button onClick={() => setCycle("monthly")} className={`flex-1 border rounded-md p-3 text-left ${cycle === "monthly" ? "border-primary bg-primary/5" : ""}`} data-testid="button-cycle-monthly">
                    <div className="text-xs text-muted-foreground">Monthly</div>
                    <div className="font-semibold">₹{addon.pricing.monthlyPrice.toLocaleString("en-IN")}<span className="text-xs font-normal">/mo</span></div>
                  </button>
                )}
                {addon.pricing.yearlyPrice != null && (
                  <button onClick={() => setCycle("yearly")} className={`flex-1 border rounded-md p-3 text-left ${cycle === "yearly" ? "border-primary bg-primary/5" : ""}`} data-testid="button-cycle-yearly">
                    <div className="text-xs text-muted-foreground">Yearly <span className="text-emerald-700">(save 17%)</span></div>
                    <div className="font-semibold">₹{addon.pricing.yearlyPrice.toLocaleString("en-IN")}<span className="text-xs font-normal">/yr</span></div>
                  </button>
                )}
              </div>
            </div>
          )}

          {addon.install && (
            <div className="rounded-md border p-3 text-sm space-y-1">
              <div><span className="text-muted-foreground">Status:</span> {addon.install.status}</div>
              {addon.install.startedAt && <div><span className="text-muted-foreground">Started:</span> {format(new Date(addon.install.startedAt), "PPp")}</div>}
              {addon.install.trialEndsAt && <div><span className="text-muted-foreground">Trial ends:</span> {format(new Date(addon.install.trialEndsAt), "PPp")}</div>}
              {addon.install.currentPeriodEndsAt && <div><span className="text-muted-foreground">{addon.install.status === "cancelled" ? "Access ends:" : "Renews:"}</span> {format(new Date(addon.install.currentPeriodEndsAt), "PPp")}</div>}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}><X className="w-4 h-4 mr-1" />Close</Button>
          {canUninstall && (
            <Button variant="destructive" onClick={() => onAction(addon.key, "uninstall")} data-testid="button-uninstall">Uninstall</Button>
          )}
          {canTrial && (
            <Button variant="outline" onClick={() => onAction(addon.key, "start-trial")} data-testid="button-start-trial">
              <Zap className="w-4 h-4 mr-1" />Start {addon.trialDays}-day trial
            </Button>
          )}
          {canFreeInstall && (
            <Button onClick={() => onAction(addon.key, "install")} data-testid="button-install-detail">Install</Button>
          )}
          {canPay && (
            <Button onClick={() => onAction(addon.key, "confirm-payment", { billingCycle: cycle })} data-testid="button-pay">
              Pay & activate
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EventsTable({ events }: { events: AddonEvent[] }) {
  if (events.length === 0) return <div className="text-muted-foreground p-12 text-center border border-dashed rounded-lg">No activity yet.</div>;
  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left p-3 font-medium">When</th>
            <th className="text-left p-3 font-medium">Add-on</th>
            <th className="text-left p-3 font-medium">Event</th>
            <th className="text-left p-3 font-medium">Source</th>
            <th className="text-right p-3 font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {events.map(e => (
            <tr key={e.id} className="border-t">
              <td className="p-3 text-muted-foreground whitespace-nowrap">{format(new Date(e.createdAt), "PPp")}</td>
              <td className="p-3 font-medium">{e.addonKey}</td>
              <td className="p-3">{e.eventType}</td>
              <td className="p-3"><Badge variant="outline">{e.source}</Badge></td>
              <td className="p-3 text-right">{e.amount ? `${e.currency === "INR" ? "₹" : ""}${Number(e.amount).toLocaleString("en-IN")}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
