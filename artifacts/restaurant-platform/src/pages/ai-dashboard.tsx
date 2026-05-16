import { useMemo } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles, ImageIcon, FileText, BarChart3, Settings, ArrowRight, Coins, Zap,
  AlertTriangle, AlertCircle, TrendingUp, IndianRupee, Trophy,
} from "lucide-react";
import { useAiWallet, useAiUsageSummary, useAiRecentGenerations } from "@/lib/aiHooks";
import { AiGeneratedBadge } from "@/components/ai/AiGeneratedBadge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend, BarChart, Bar,
} from "recharts";

// Approximate "what you saved by using AI instead of an outsourced
// copywriter / food photographer". Used to estimate cost-saved.
const RUPEES_SAVED_PER_DESCRIPTION = 75;
const RUPEES_SAVED_PER_IMAGE = 600;
const LOW_CREDIT_THRESHOLD = 50;

const FEATURE_COLOR: Record<string, string> = {
  ai_description: "#8b5cf6",
  ai_food_image: "#ec4899",
};

export default function AiDashboardPage() {
  const wallet = useAiWallet();
  const usage = useAiUsageSummary(30);
  // Separate 365-day window for the monthly trend / credit-consumption chart.
  // The 30-day window above powers the daily trend; this one is bucketed by
  // calendar month so owners can see seasonality / month-over-month spend.
  const usageYear = useAiUsageSummary(365);
  const recent = useAiRecentGenerations(8);

  const planEnabled = wallet.data?.planKhanaAiEnabled ?? wallet.data?.planAiEnabled ?? false;
  const balance = wallet.data?.balance ?? 0;
  const lowCredits = !wallet.isLoading && planEnabled && balance < LOW_CREDIT_THRESHOLD;

  const stats = useMemo(() => {
    const successByFeature: Record<string, number> = {};
    let creditsUsed = 0;
    let errors = 0;
    let total = 0;
    for (const b of usage.data?.byFeature ?? []) {
      total += b.count;
      if (b.status === "success") {
        successByFeature[b.featureSlug] = (successByFeature[b.featureSlug] ?? 0) + b.count;
        creditsUsed += b.creditsUsed;
      } else if (b.status === "error") {
        errors += b.count;
      }
    }
    const desc30 = successByFeature.ai_description ?? 0;
    const img30 = successByFeature.ai_food_image ?? 0;
    const successCount = Object.values(successByFeature).reduce((a, b) => a + b, 0);
    const successRate = total === 0 ? 100 : Math.round((successCount / total) * 100);
    const rupeesSaved = desc30 * RUPEES_SAVED_PER_DESCRIPTION + img30 * RUPEES_SAVED_PER_IMAGE;
    let mostUsedFeature: string | null = null;
    let mostUsedCount = 0;
    for (const [k, v] of Object.entries(successByFeature)) {
      if (v > mostUsedCount) { mostUsedFeature = k; mostUsedCount = v; }
    }
    return { desc30, img30, creditsUsed, errors, successRate, rupeesSaved, mostUsedFeature, mostUsedCount, successByFeature };
  }, [usage.data]);

  const dailySeries = useMemo(() => {
    const map = new Map<string, { day: string; ai_description: number; ai_food_image: number; credits: number }>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      const key = format(d, "yyyy-MM-dd");
      map.set(key, { day: format(d, "MMM d"), ai_description: 0, ai_food_image: 0, credits: 0 });
    }
    for (const row of usage.data?.byDay ?? []) {
      const e = map.get(row.day);
      if (!e) continue;
      if (row.feature === "ai_description") e.ai_description += row.count;
      if (row.feature === "ai_food_image") e.ai_food_image += row.count;
      e.credits += row.credits;
    }
    return Array.from(map.values());
  }, [usage.data]);

  // Monthly trend: bucket the 365-day daily series into the last 12 calendar
  // months so the dashboard surfaces a "credit consumption / generations
  // over months" view distinct from the 30-day daily area chart above.
  const monthlySeries = useMemo(() => {
    const months: { key: string; month: string; ai_description: number; ai_food_image: number; credits: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: format(d, "yyyy-MM"),
        month: format(d, "MMM yy"),
        ai_description: 0,
        ai_food_image: 0,
        credits: 0,
      });
    }
    const idx = new Map(months.map((m, i) => [m.key, i] as const));
    for (const row of usageYear.data?.byDay ?? []) {
      const key = row.day.slice(0, 7); // YYYY-MM
      const i = idx.get(key);
      if (i === undefined) continue;
      const m = months[i];
      if (row.feature === "ai_description") m.ai_description += row.count;
      if (row.feature === "ai_food_image") m.ai_food_image += row.count;
      m.credits += row.credits;
    }
    return months;
  }, [usageYear.data]);

  const featurePieData = useMemo(() => {
    return Object.entries(stats.successByFeature).map(([k, v]) => ({
      name: k.replace(/_/g, " "), value: v, key: k,
    }));
  }, [stats.successByFeature]);

  return (
    <Layout>
      <PageHeader
        title="Khana AI"
        subtitle="AI-powered helpers for your menu, photos and operations."
        actions={
          <Link href="/ai/usage">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Coins className="w-3.5 h-3.5" /> Recharge
            </Button>
          </Link>
        }
      />

      <div className="p-6 space-y-6">
        {!wallet.isLoading && !planEnabled && (
          <Banner
            tone="amber"
            icon={AlertTriangle}
            title="Khana AI is not included in your plan"
            body="Upgrade to a plan that includes the Khana AI module to start generating descriptions and photos."
            cta={{ label: "Upgrade plan", href: "/subscription" }}
          />
        )}
        {lowCredits && (
          <Banner
            tone="rose"
            icon={AlertCircle}
            title={`Only ${balance} credits left`}
            body="Top up your wallet so your team can keep generating descriptions and photos without interruptions."
            cta={{ label: "Recharge now", href: "/ai/usage" }}
          />
        )}

        {/* Stat cards — 6 KPIs as required */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            label="Credits available"
            value={wallet.isLoading ? null : balance.toLocaleString()}
            icon={Coins} tone="violet"
            footer={wallet.data ? `${wallet.data.monthlyBalance} monthly` : ""}
          />
          <StatCard
            label="Credits used (30d)"
            value={usage.isLoading ? null : stats.creditsUsed.toLocaleString()}
            icon={Zap} tone="emerald"
          />
          <StatCard
            label="Descriptions (30d)"
            value={usage.isLoading ? null : stats.desc30.toLocaleString()}
            icon={FileText} tone="sky"
          />
          <StatCard
            label="Images (30d)"
            value={usage.isLoading ? null : stats.img30.toLocaleString()}
            icon={ImageIcon} tone="fuchsia"
          />
          <StatCard
            label="Success rate"
            value={usage.isLoading ? null : `${stats.successRate}%`}
            icon={TrendingUp} tone="emerald"
            footer={stats.errors > 0 ? `${stats.errors} failed` : "All clean"}
          />
          <StatCard
            label="Estimated saved"
            value={usage.isLoading ? null : `₹${stats.rupeesSaved.toLocaleString()}`}
            icon={IndianRupee} tone="amber"
            footer="vs hiring out"
          />
        </div>

        {/* Most-used feature */}
        {!usage.isLoading && stats.mostUsedFeature && (
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 flex items-center justify-center">
                <Trophy className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Most-used AI feature (last 30 days)</p>
                <p className="text-sm font-semibold capitalize">
                  {stats.mostUsedFeature.replace(/_/g, " ")} · {stats.mostUsedCount} generation{stats.mostUsedCount === 1 ? "" : "s"}
                </p>
              </div>
              <Link href="/ai/usage" className="text-xs text-muted-foreground hover:text-foreground">View details →</Link>
            </CardContent>
          </Card>
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Generations trend (30 days)</CardTitle></CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailySeries} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dgD" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="dgI" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ec4899" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#ec4899" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="day" fontSize={11} tickMargin={6} interval="preserveStartEnd" />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="ai_description" name="Descriptions" stroke="#8b5cf6" fill="url(#dgD)" strokeWidth={2} />
                  <Area type="monotone" dataKey="ai_food_image" name="Images" stroke="#ec4899" fill="url(#dgI)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Mix by feature</CardTitle></CardHeader>
            <CardContent className="h-72">
              {featurePieData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground text-center px-4">
                  No generations yet. Start with descriptions or food photos.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={featurePieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                      {featurePieData.map((entry) => (
                        <Cell key={entry.key} fill={FEATURE_COLOR[entry.key] ?? "#a3a3a3"} />
                      ))}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Monthly trend — credits consumed + generations per month (12 months) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Coins className="w-4 h-4" /> Monthly credit consumption (last 12 months)
            </CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {usageYear.isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlySeries} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" fontSize={11} tickMargin={6} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="credits" name="Credits used" fill="#a855f7" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="ai_description" name="Descriptions" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="ai_food_image" name="Images" fill="#ec4899" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Quick actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <ActionTile href="/ai/descriptions" title="AI Item Descriptions" blurb="Write appetising menu copy in seconds." icon={FileText} cost={1} />
          <ActionTile href="/ai/images" title="AI Food Images" blurb="Generate professional dish photos." icon={ImageIcon} cost={10} />
          <ActionTile href="/ai/usage" title="Usage & Credits" blurb="See spend and recharge your wallet." icon={BarChart3} />
          <ActionTile href="/ai/settings" title="AI Settings" blurb="Tone, language and approval flow." icon={Settings} />
        </div>

        {/* Recent generations */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent generations</CardTitle>
              <Link href="/ai/usage" className="text-xs text-muted-foreground hover:text-foreground">View all →</Link>
            </div>
          </CardHeader>
          <CardContent>
            {recent.isLoading ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : !recent.data?.data.length ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                No AI generations yet. Open a menu item or head to descriptions/images to get started.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {recent.data.data.map((row) => (
                  <li key={row.id} className="py-2.5 flex items-center gap-3 text-sm">
                    <span className="w-7 h-7 rounded-md bg-muted flex items-center justify-center text-muted-foreground">
                      {row.kind === "photo" ? <ImageIcon className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{row.itemName ?? `Item #${row.menuItemId}`}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.kind === "photo" ? "Photo draft" : "Description draft"} · {format(new Date(row.createdAt), "PP p")}
                      </p>
                    </div>
                    <AiGeneratedBadge />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function Banner({ tone, icon: Icon, title, body, cta }: {
  tone: "amber" | "rose";
  icon: React.ComponentType<{ className?: string }>;
  title: string; body: string; cta: { label: string; href: string };
}) {
  const palette = tone === "amber"
    ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200"
    : "border-rose-300 bg-rose-50 text-rose-900 dark:bg-rose-950/30 dark:border-rose-800 dark:text-rose-200";
  const iconColor = tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
  return (
    <div className={cn("rounded-xl border p-5 flex items-start gap-3", palette)}>
      <Icon className={cn("w-5 h-5 mt-0.5", iconColor)} />
      <div className="flex-1">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm mt-1 opacity-90">{body}</p>
        <Link href={cta.href}>
          <Button size="sm" className="mt-3" variant={tone === "rose" ? "default" : "default"}>
            {cta.label} <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, tone, footer }: {
  label: string; value: string | null; icon: React.ComponentType<{ className?: string }>;
  tone: "violet" | "emerald" | "sky" | "fuchsia" | "amber"; footer?: string;
}) {
  const ring = {
    violet: "from-violet-500/15 to-violet-500/5 text-violet-600 dark:text-violet-300",
    emerald: "from-emerald-500/15 to-emerald-500/5 text-emerald-600 dark:text-emerald-300",
    sky: "from-sky-500/15 to-sky-500/5 text-sky-600 dark:text-sky-300",
    fuchsia: "from-fuchsia-500/15 to-fuchsia-500/5 text-fuchsia-600 dark:text-fuchsia-300",
    amber: "from-amber-500/15 to-amber-500/5 text-amber-600 dark:text-amber-300",
  }[tone];
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground truncate">{label}</p>
            {value === null ? <Skeleton className="h-6 w-16" /> : <p className="text-xl font-bold tracking-tight truncate">{value}</p>}
            {footer && <p className="text-[10px] text-muted-foreground truncate">{footer}</p>}
          </div>
          <div className={cn("w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center shrink-0", ring)}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ActionTile({ href, title, blurb, icon: Icon, cost }: {
  href: string; title: string; blurb: string; icon: React.ComponentType<{ className?: string }>; cost?: number;
}) {
  return (
    <Link href={href}>
      <Card className="h-full hover:border-violet-300 hover:shadow-md transition cursor-pointer group">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white shadow-sm">
              <Icon className="w-4 h-4" />
            </div>
            {cost ? (
              <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> {cost} cr
              </span>
            ) : null}
          </div>
          <h3 className="font-semibold text-sm">{title}</h3>
          <p className="text-xs text-muted-foreground">{blurb}</p>
          <p className="text-xs text-violet-600 dark:text-violet-300 font-medium inline-flex items-center gap-1 group-hover:gap-1.5 transition-all">
            Open <ArrowRight className="w-3 h-3" />
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
