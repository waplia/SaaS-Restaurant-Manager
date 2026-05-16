/**
 * AI Sales Insights — Khana AI module.
 *
 * Active / Saved tabs. Header shows wallet balance and either
 * "Free X left today" (free allowance) or "Generate (5 cr)" (credits).
 * Each insight is a card with category icon, impact badge, suggestion,
 * deep-link to the relevant module, plus Save / Dismiss.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, Loader2, Coins, AlertTriangle, ArrowRight, X, Save, Inbox,
  TrendingUp, Trophy, Percent, TrendingDown, Clock, CalendarX, Tag,
  PackageX, XCircle, Heart,
} from "lucide-react";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useAiWallet } from "@/lib/aiHooks";
import { useToast } from "@/hooks/use-toast";
import { AiGeneratedBadge } from "@/components/ai/AiGeneratedBadge";
import { format } from "date-fns";

interface Insight {
  id: number;
  category: string;
  title: string;
  explanation: string;
  suggestedAction: string | null;
  impact: "low" | "medium" | "high";
  targetModule: string | null;
  targetId: number | null;
  targetUrl: string | null;
  supportingMetrics: Record<string, unknown>;
  status: string;
  generatedAt: string;
}

interface Allowance {
  dailyLimit: number;
  used: number;
  remaining: number;
  isSuperAdmin: boolean;
}

const COST = 5;

const CATEGORY_META: Record<string, { label: string; Icon: typeof TrendingUp; cls: string }> = {
  sales_trend:       { label: "Sales trend",        Icon: TrendingUp,  cls: "text-blue-600" },
  best_seller:       { label: "Best-seller",        Icon: Trophy,      cls: "text-amber-600" },
  low_margin:        { label: "Low margin",         Icon: Percent,     cls: "text-rose-600" },
  declining_sales:   { label: "Declining sales",    Icon: TrendingDown, cls: "text-orange-600" },
  peak_time:         { label: "Peak hours",         Icon: Clock,       cls: "text-violet-600" },
  weak_weekday:      { label: "Slow weekday",       Icon: CalendarX,   cls: "text-slate-600" },
  suggested_offer:   { label: "Suggested offer",    Icon: Tag,         cls: "text-emerald-600" },
  inventory_risk:    { label: "Inventory risk",     Icon: PackageX,    cls: "text-rose-600" },
  high_cancellation: { label: "High cancellations", Icon: XCircle,     cls: "text-rose-700" },
  retention:         { label: "Retention",          Icon: Heart,       cls: "text-pink-600" },
};

const IMPACT_COLOR: Record<string, string> = {
  high:   "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
  medium: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  low:    "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
};

export default function AiSalesInsightsPage() {
  const restaurantId = useRestaurantId();
  const wallet = useAiWallet();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"active" | "saved">("active");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [impactFilter, setImpactFilter] = useState<string>("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const list = useQuery<{ data: Insight[] }>({
    queryKey: ["ai-sales-insights", restaurantId, tab, categoryFilter, impactFilter],
    queryFn: () => {
      const qs = new URLSearchParams({ status: tab });
      if (categoryFilter) qs.set("category", categoryFilter);
      if (impactFilter) qs.set("impact", impactFilter);
      return apiGet(`/restaurants/${restaurantId}/ai-insights/list?${qs.toString()}`);
    },
    enabled: !!restaurantId,
  });

  const allowance = useQuery<Allowance>({
    queryKey: ["ai-sales-insights-allowance", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/ai-insights/allowance`),
    enabled: !!restaurantId,
  });

  const generate = useMutation({
    mutationFn: () => apiPost<{ insights: Insight[]; freeClaimed: boolean }>(
      `/restaurants/${restaurantId}/ai-insights/generate`, {},
    ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["ai-sales-insights", restaurantId] });
      qc.invalidateQueries({ queryKey: ["ai-sales-insights-allowance", restaurantId] });
      qc.invalidateQueries({ queryKey: ["ai-wallet"] });
      toast({
        title: `${data.insights.length} insight${data.insights.length === 1 ? "" : "s"} generated`,
        description: data.freeClaimed ? "Used your free daily allowance — no credits charged." : `Charged ${COST} credits.`,
      });
      setTab("active");
    },
    onError: (e: unknown) => {
      const msg = (e as { message?: string })?.message ?? "Failed to generate";
      toast({ title: msg, variant: "destructive" });
    },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: "active" | "saved" | "dismissed" }) =>
      apiPatch(`/restaurants/${restaurantId}/ai-insights/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-sales-insights", restaurantId] }),
  });

  const balance = wallet.data?.balance ?? 0;
  const isSuperAdmin = allowance.data?.isSuperAdmin ?? false;
  const planAiEnabled = wallet.data?.planKhanaAiEnabled ?? wallet.data?.planAiEnabled ?? false;
  const planInsightsEnabled = wallet.data?.planKhanaAiInsightsEnabled ?? false;
  // Page is accessible only when both flags are on (or super admin).
  const planEnabled = isSuperAdmin || (planAiEnabled && planInsightsEnabled);
  const freeRemaining = allowance.data?.remaining ?? 0;
  const dailyLimit = allowance.data?.dailyLimit ?? 0;
  const usingFree = !isSuperAdmin && freeRemaining > 0;
  const insufficient = !isSuperAdmin && !usingFree && !wallet.isLoading && balance < COST;
  const generateLabel = isSuperAdmin
    ? "Generate"
    : usingFree
      ? `Generate (Free ${freeRemaining}/${dailyLimit})`
      : `Generate (${COST} cr)`;

  return (
    <Layout>
      <PageHeader
        title="AI Sales Insights"
        subtitle="Daily insights about what's selling, what isn't, and what to try next."
        actions={
          <div className="flex gap-2 items-center">
            {!isSuperAdmin && (
              <Badge variant="secondary" className="gap-1"><Coins className="w-3 h-3" />{balance} cr</Badge>
            )}
            <Button
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={(!planEnabled && !isSuperAdmin) || (insufficient && !usingFree) || generate.isPending}
              className="gap-1.5"
            >
              {generate.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {generateLabel}
            </Button>
          </div>
        }
      />

      <div className="p-6 space-y-4">
        {!planEnabled && !wallet.isLoading && !isSuperAdmin && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">AI Sales Insights is not in your plan</p>
                <p className="text-sm text-muted-foreground">
                  {planAiEnabled
                    ? "Your plan includes Khana AI but not AI Sales Insights. Upgrade to unlock this feature."
                    : "Upgrade to a plan that includes Khana AI and AI Sales Insights to use this page."}
                </p>
              </div>
              <Link href="/subscription"><Button size="sm">Upgrade</Button></Link>
            </CardContent>
          </Card>
        )}

        {insufficient && planEnabled && !usingFree && (
          <Card className="border-rose-300 bg-rose-50 dark:bg-rose-950/20">
            <CardContent className="p-4 flex items-start gap-3">
              <Coins className="w-5 h-5 text-rose-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Out of credits</p>
                <p className="text-sm text-muted-foreground">
                  You need {COST} credits to generate a fresh batch. Free daily allowance for today is used up.
                </p>
              </div>
              <Link href="/ai/usage"><Button size="sm">Recharge</Button></Link>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-2 border-b border-border">
          {(["active", "saved"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "active" ? "Active" : "Saved"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 items-center text-xs">
          <span className="text-muted-foreground">Filter:</span>
          <select
            className="h-8 px-2 rounded-md border border-border bg-background"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All categories</option>
            {Object.entries(CATEGORY_META).map(([k, m]) => (
              <option key={k} value={k}>{m.label}</option>
            ))}
          </select>
          <select
            className="h-8 px-2 rounded-md border border-border bg-background"
            value={impactFilter}
            onChange={(e) => setImpactFilter(e.target.value)}
          >
            <option value="">Any impact</option>
            <option value="high">High impact</option>
            <option value="medium">Medium impact</option>
            <option value="low">Low impact</option>
          </select>
          {(categoryFilter || impactFilter) && (
            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setCategoryFilter(""); setImpactFilter(""); }}>
              Clear
            </Button>
          )}
        </div>

        {list.isLoading ? (
          <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-28" />)}</div>
        ) : !list.data?.data.length ? (
          <Card>
            <CardContent className="p-10 text-center space-y-3">
              <Inbox className="w-10 h-10 text-muted-foreground mx-auto" />
              <p className="font-semibold">
                {tab === "active" ? "No active insights" : "Nothing saved yet"}
              </p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {tab === "active"
                  ? "Click Generate to analyse your last 30 days of orders and surface opportunities."
                  : "Insights you Save appear here so you can come back to them later."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {list.data.data.map((ins) => {
              const meta = CATEGORY_META[ins.category] ?? {
                label: ins.category, Icon: Sparkles, cls: "text-muted-foreground",
              };
              const Icon = meta.Icon;
              return (
                <Card key={ins.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 ${meta.cls}`}><Icon className="w-4 h-4" /></span>
                        <div className="space-y-0.5">
                          <CardTitle className="text-sm font-semibold leading-snug">{ins.title}</CardTitle>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{meta.label}</Badge>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${IMPACT_COLOR[ins.impact]}`}>
                              {ins.impact} impact
                            </span>
                            <AiGeneratedBadge />
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {format(new Date(ins.generatedAt), "MMM d")}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 pt-0">
                    <p className="text-sm text-foreground/90">{ins.explanation}</p>
                    {ins.suggestedAction && (
                      <p className="text-xs text-muted-foreground italic border-l-2 border-primary/40 pl-2">
                        {ins.suggestedAction}
                      </p>
                    )}
                    <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
                      {ins.targetUrl ? (
                        <Link href={ins.targetUrl}>
                          <Button size="sm" variant="outline" className="gap-1 h-7 text-xs">
                            Open {ins.targetModule} <ArrowRight className="w-3 h-3" />
                          </Button>
                        </Link>
                      ) : <span />}
                      <div className="flex gap-1">
                        {ins.status !== "saved" && (
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => updateStatus.mutate({ id: ins.id, status: "saved" })}
                            className="gap-1 h-7 text-xs"
                          >
                            <Save className="w-3 h-3" /> Save
                          </Button>
                        )}
                        {ins.status === "saved" && (
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => updateStatus.mutate({ id: ins.id, status: "active" })}
                            className="gap-1 h-7 text-xs"
                          >
                            <Inbox className="w-3 h-3" /> Move to active
                          </Button>
                        )}
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => updateStatus.mutate({ id: ins.id, status: "dismissed" })}
                          className="gap-1 h-7 text-xs text-muted-foreground"
                        >
                          <X className="w-3 h-3" /> Dismiss
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate a fresh batch of insights?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This will analyse your last 30 days of orders, menu, inventory and customers,
                  and produce up to 8 focused insights across categories like best-sellers,
                  low-margin items, peak times and suggested offers.
                </p>
                <div className="rounded-md border border-border bg-muted/30 p-3 text-foreground">
                  {isSuperAdmin ? (
                    <p>You're a super admin — no plan or credit checks apply.</p>
                  ) : usingFree ? (
                    <p>
                      <strong>Free:</strong> uses 1 of your {dailyLimit} daily allowance
                      ({freeRemaining} remaining today). No credits will be charged.
                    </p>
                  ) : (
                    <p>
                      <strong>{COST} credits</strong> will be charged from your wallet
                      (current balance: {balance} cr). Today's free allowance is used up.
                    </p>
                  )}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmOpen(false); generate.mutate(); }}>
              {usingFree || isSuperAdmin ? "Generate" : `Generate (${COST} cr)`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
