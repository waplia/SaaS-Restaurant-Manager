import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Award, Download, Gift, Repeat2, Users, Wallet, Cake, TrendingUp } from "lucide-react";
import { useLoyalty2Analytics, loyalty2AnalyticsCsvUrl, useLoyalty2ReferralLeaderboard, useRestaurantId } from "@/lib/hooks";

function StatCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export default function LoyaltyAnalyticsPage() {
  const restaurantId = useRestaurantId();
  const [days, setDays] = useState(30);
  const { data, isLoading } = useLoyalty2Analytics(days);
  const { data: leaderboard = [] } = useLoyalty2ReferralLeaderboard();

  const fmt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("en-IN");
  const csvUrl = useMemo(() => loyalty2AnalyticsCsvUrl(restaurantId, days), [restaurantId, days]);

  return (
    <Layout>
      <PageHeader
        title="Loyalty Analytics"
        description="Engagement & redemption across all twelve loyalty mechanics."
        actions={
          <div className="flex items-center gap-2">
            <select value={days} onChange={e => setDays(Number(e.target.value))}
              className="h-9 px-3 rounded-md border border-border bg-card text-sm">
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last 365 days</option>
            </select>
            <a href={csvUrl} download className="inline-flex items-center text-sm h-9 px-3 rounded-md border border-border bg-card hover:bg-accent">
              <Download className="w-4 h-4 mr-1.5" />Export CSV
            </a>
          </div>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading analytics…</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Award} label="Points earned" value={fmt(data?.points?.earned)} sub={`${fmt(data?.points?.redeemed)} redeemed · ${fmt(data?.points?.expired)} expired`} />
            <StatCard icon={Wallet} label="Cashback issued" value={`₹${fmt(data?.cashback?.issued)}`} sub={`₹${fmt(data?.cashback?.redeemed)} redeemed`} />
            <StatCard icon={Gift} label="Stamp completions" value={fmt(data?.stamps?.completions)} sub={`${fmt(data?.stamps?.cards)} active cards`} />
            <StatCard icon={Repeat2} label="Referrals converted" value={`${fmt(data?.referrals?.converted)} / ${fmt(data?.referrals?.total)}`} />
            <StatCard icon={Gift} label="Mystery rewards granted" value={fmt(data?.mystery?.granted)} />
            <StatCard icon={TrendingUp} label="Milestones reached" value={fmt(data?.milestones?.granted)} />
            <StatCard icon={Cake} label="Birthday gifts sent" value={fmt(data?.birthday?.granted)} />
            <StatCard icon={Users} label="Top customer points" value={fmt(data?.topCustomers?.[0]?.points)} sub={data?.topCustomers?.[0]?.name ?? "—"} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-2xl p-4">
              <h3 className="text-sm font-semibold mb-3">Top customers by points</h3>
              {(data?.topCustomers ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No data yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-muted-foreground"><th className="text-left py-1">Customer</th><th className="text-right">Points</th><th className="text-right">Spend</th></tr></thead>
                  <tbody>
                    {data!.topCustomers.map((c: any) => (
                      <tr key={c.customerId} className="border-t border-border/50">
                        <td className="py-1.5">{c.name}<span className="text-xs text-muted-foreground"> · {c.phone || "—"}</span></td>
                        <td className="text-right font-semibold">{fmt(c.points)}</td>
                        <td className="text-right">₹{fmt(Number(c.totalSpent))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="bg-card border border-border rounded-2xl p-4">
              <h3 className="text-sm font-semibold mb-3">Referral leaderboard</h3>
              {leaderboard.length === 0 ? (
                <p className="text-xs text-muted-foreground">No referrals yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-muted-foreground"><th className="text-left py-1">Referrer</th><th className="text-right">Converted</th><th className="text-right">Total</th></tr></thead>
                  <tbody>
                    {leaderboard.map((row: any) => (
                      <tr key={row.referrerId} className="border-t border-border/50">
                        <td className="py-1.5">{row.name ?? `#${row.referrerId}`}</td>
                        <td className="text-right font-semibold">{fmt(row.converted)}</td>
                        <td className="text-right">{fmt(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
