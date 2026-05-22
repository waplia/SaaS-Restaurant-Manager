import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, Coins, Wallet, Gift, Ticket, Tag } from "lucide-react";
import { useState } from "react";
import { api, fmtMoney } from "@/lib/api";
import { Header } from "@/components/Layout";
import { useAuth } from "@/lib/auth";

interface PerRestaurant {
  restaurantId: number; name: string; city: string | null; logoUrl: string | null;
  currency: string; inNetwork: boolean; points: number; cashback: string;
  giftCardBalance: number; visits: number; visitSpend: string; lastVisitAt: string | null;
  stampCards: number; rewardsAvailable: number;
}
interface SummaryResp {
  totals: { points: number; cashback: string; giftCardBalance: number; visits: number; stampsActive: number; rewardsAvailable: number };
  perRestaurant: PerRestaurant[];
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["wallet-summary"],
    queryFn: () => api<SummaryResp>("/wallet/summary"),
  });

  const totals = data?.totals ?? { points: 0, cashback: "0.00", giftCardBalance: 0, visits: 0, stampsActive: 0, rewardsAvailable: 0 };
  const perRestaurant = data?.perRestaurant ?? [];

  return (
    <>
      <Header
        title={user?.name ? `Hi, ${user.name.split(" ")[0]}` : "Your wallet"}
        subtitle="All your loyalty, in one place."
      />

      <section className="container-app">
        <div className="rounded-3xl p-6 bg-gradient-to-br from-[rgb(var(--primary))] to-[#7a0d0d] text-white shadow-lg">
          <p className="text-sm uppercase tracking-wider opacity-80">Total cashback</p>
          <p className="text-4xl font-semibold mt-2" data-testid="text-total-cashback">
            {fmtMoney(totals.cashback)}
          </p>
          <div className="grid grid-cols-3 gap-3 mt-6">
            <Stat icon={<Coins size={16} />} label="Points" value={totals.points.toLocaleString()} testid="text-total-points" />
            <Stat icon={<Gift size={16} />} label="Gift cards" value={fmtMoney(totals.giftCardBalance)} testid="text-total-giftcards" />
            <Stat icon={<Ticket size={16} />} label="Rewards" value={String(totals.rewardsAvailable)} testid="text-total-rewards" />
          </div>
        </div>
      </section>

      <section className="container-app mt-6">
        <CouponApplyCard restaurants={perRestaurant.map(r => ({ id: r.restaurantId, name: r.name, currency: r.currency }))} />
      </section>

      <section className="container-app mt-8">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold">Your restaurants</h2>
          <Link href="/network" className="text-sm text-[rgb(var(--primary))] flex items-center gap-1">
            Discover <ArrowRight size={14} />
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <div className="skeleton h-24" /><div className="skeleton h-24" />
          </div>
        ) : perRestaurant.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-3">
            {perRestaurant.map(r => (
              <li key={r.restaurantId}>
                <Link href={`/r/${r.restaurantId}`}>
                  <div className="card p-4 flex items-center gap-4 hover:shadow-sm transition cursor-pointer"
                    data-testid={`card-restaurant-${r.restaurantId}`}>
                    <RestaurantAvatar logoUrl={r.logoUrl} name={r.name} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate" data-testid={`text-name-${r.restaurantId}`}>{r.name}</p>
                        {r.inNetwork && (
                          <span className="chip bg-green-50 text-green-700">Network</span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {r.visits} visit{r.visits === 1 ? "" : "s"} · {fmtMoney(r.cashback, r.currency)} cashback
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{r.points.toLocaleString()}</p>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-400">pts</p>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Stat({ icon, label, value, testid }: { icon: React.ReactNode; label: string; value: string; testid: string }) {
  return (
    <div className="bg-white/10 rounded-xl p-3 backdrop-blur">
      <div className="flex items-center gap-1 text-xs opacity-80">{icon}<span>{label}</span></div>
      <p className="font-semibold mt-1" data-testid={testid}>{value}</p>
    </div>
  );
}

function RestaurantAvatar({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  if (logoUrl) return <img src={logoUrl} alt="" className="w-12 h-12 rounded-xl object-cover bg-zinc-100" />;
  const initial = name.charAt(0).toUpperCase();
  return (
    <div className="w-12 h-12 rounded-xl bg-[rgb(var(--accent))] text-[rgb(var(--primary))] flex items-center justify-center font-semibold">
      {initial}
    </div>
  );
}

function CouponApplyCard({ restaurants }: { restaurants: Array<{ id: number; name: string; currency: string }> }) {
  const [code, setCode] = useState("");
  const [restaurantId, setRestaurantId] = useState<number | "">(restaurants[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ code: string; discountType: string; discountValue: string; restaurantName: string; currency: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (restaurants.length === 0) {
    return (
      <div className="card p-4">
        <p className="text-sm font-medium flex items-center gap-2"><Tag size={16} className="text-[rgb(var(--primary))]" />Got a coupon code?</p>
        <p className="text-xs text-zinc-500 mt-1">Once you visit a participating restaurant, you can check and save coupon codes here.</p>
      </div>
    );
  }

  async function onCheck() {
    if (!code.trim() || !restaurantId) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const rest = restaurants.find(r => r.id === restaurantId);
      const body = await api<{ valid: boolean; code: string; discountType: string; discountValue: string }>(
        `/public/restaurants/${restaurantId}/coupons/validate`,
        { method: "POST", body: JSON.stringify({ code: code.trim() }) },
      );
      setResult({ code: body.code, discountType: body.discountType, discountValue: body.discountValue, restaurantName: rest?.name ?? "", currency: rest?.currency ?? "INR" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid coupon";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <p className="text-sm font-medium flex items-center gap-2 mb-3"><Tag size={16} className="text-[rgb(var(--primary))]" />Got a coupon code?</p>
      {result ? (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-mono text-sm font-semibold text-emerald-700">{result.code}</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                {result.discountType === "percentage" ? `${result.discountValue}% off` : `${fmtMoney(result.discountValue, result.currency)} off`} at {result.restaurantName}
              </p>
              <p className="text-[11px] text-emerald-600 mt-1">Use this code at checkout on the menu.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={async () => {
                  try { await navigator.clipboard.writeText(result.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
                }}
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-white border border-emerald-300 text-emerald-700"
                data-testid="button-copy-coupon"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => { setResult(null); setCode(""); }}
                className="text-[11px] text-zinc-500 hover:text-zinc-700"
              >
                Try another
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {restaurants.length > 1 && (
            <select
              value={restaurantId}
              onChange={e => setRestaurantId(Number(e.target.value))}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm bg-white"
              data-testid="select-coupon-restaurant"
            >
              {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={code}
              onChange={e => { setCode(e.target.value.toUpperCase()); setError(null); }}
              placeholder="Enter code"
              className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm uppercase tracking-wide focus:outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]"
              data-testid="input-coupon-code"
            />
            <button
              type="button"
              disabled={!code.trim() || busy}
              onClick={onCheck}
              className="btn-primary text-sm px-4 disabled:opacity-50"
              data-testid="button-apply-coupon"
            >
              {busy ? "…" : "Check"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card p-8 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[rgb(var(--accent))] text-[rgb(var(--primary))] flex items-center justify-center mx-auto mb-3">
        <Wallet size={26} />
      </div>
      <p className="font-medium">No wallets yet</p>
      <p className="text-sm text-zinc-500 mt-1">
        Order, dine, or scan at a participating restaurant and your balances will show up here.
      </p>
      <Link href="/network" className="btn-primary mt-4 inline-flex">Discover restaurants</Link>
    </div>
  );
}
