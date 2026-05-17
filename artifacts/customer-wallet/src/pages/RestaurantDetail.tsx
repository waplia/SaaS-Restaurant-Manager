import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, Coins, Wallet, Gift, Stamp, Sparkles } from "lucide-react";
import { useState } from "react";
import { api, fmtMoney, fmtDate } from "@/lib/api";

interface DetailResp {
  restaurant: { id: number; name: string; city: string | null; logoUrl: string | null; currency: string } | null;
  networkMember: { status: string; displayName: string | null; allowCrossRedeem: boolean; crossRedeemMaxPct: number } | null;
  points: { balance: number; lifetimeEarned: number; lifetimeRedeemed: number };
  cashback: { balance: string; lifetimeIssued: string; lifetimeRedeemed: string };
  cashbackTxns: Array<{ id: number; amount: string; type: string; reason: string | null; createdAt: string }>;
  pointsTxns: Array<{ id: number; pointsDelta: number; reason: string | null; createdAt: string }>;
  stamps: Array<{ id: number; cardKey: string; stamps: number; completions: number }>;
  mystery: Array<{ id: number; rewardLabel: string; status: string; expiresAt: string | null }>;
  giftCards: Array<{ id: number; code: string; initialAmount: number; currency: string; status: string; expiresAt: string | null }>;
}

export default function RestaurantDetail() {
  const [, params] = useRoute<{ rid: string }>("/r/:rid");
  const [, setLocation] = useLocation();
  const restaurantId = Number(params?.rid);
  const queryClient = useQueryClient();
  const [showRedeem, setShowRedeem] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["wallet-restaurant", restaurantId],
    queryFn: () => api<DetailResp>(`/wallet/restaurants/${restaurantId}`),
    enabled: !!restaurantId,
  });

  if (isLoading || !data) {
    return <div className="container-app pt-10"><div className="skeleton h-40" /></div>;
  }
  const r = data.restaurant;
  const currency = r?.currency ?? "INR";

  return (
    <>
      <header className="container-app pt-6">
        <button onClick={() => setLocation("/")} className="flex items-center gap-1 text-sm text-zinc-500" data-testid="button-back">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="mt-4 flex items-center gap-4">
          {r?.logoUrl
            ? <img src={r.logoUrl} alt="" className="w-14 h-14 rounded-2xl object-cover bg-zinc-100" />
            : <div className="w-14 h-14 rounded-2xl bg-[rgb(var(--accent))] text-[rgb(var(--primary))] flex items-center justify-center text-xl font-semibold">{r?.name?.charAt(0) ?? "?"}</div>
          }
          <div>
            <h1 className="text-xl font-semibold" data-testid="text-restaurant-name">{r?.name ?? "Restaurant"}</h1>
            <p className="text-xs text-zinc-500">{r?.city}</p>
          </div>
        </div>
      </header>

      <section className="container-app mt-6 grid grid-cols-2 gap-3">
        <BalanceCard icon={<Coins size={18} />} label="Points" value={data.points.balance.toLocaleString()}
          sublabel={`${data.points.lifetimeEarned.toLocaleString()} earned`} testid="card-points" />
        <BalanceCard icon={<Wallet size={18} />} label="Cashback" value={fmtMoney(data.cashback.balance, currency)}
          sublabel={`${fmtMoney(data.cashback.lifetimeIssued, currency)} lifetime`} testid="card-cashback" />
      </section>

      {data.networkMember?.allowCrossRedeem && Number(data.cashback.balance) > 0 && (
        <section className="container-app mt-4">
          <button className="btn-outline w-full" onClick={() => setShowRedeem(true)} data-testid="button-open-redeem">
            <Sparkles size={16} className="mr-2" /> Spend this cashback at another network restaurant
          </button>
        </section>
      )}

      {data.giftCards.length > 0 && (
        <section className="container-app mt-6">
          <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-2">Gift cards</h2>
          <div className="space-y-2">
            {data.giftCards.map(g => (
              <div key={g.id} className="card p-4 flex items-center justify-between" data-testid={`card-gift-${g.id}`}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[rgb(var(--accent))] text-[rgb(var(--primary))] flex items-center justify-center">
                    <Gift size={18} />
                  </div>
                  <div>
                    <p className="font-mono text-sm">{g.code}</p>
                    <p className="text-xs text-zinc-500">Expires {fmtDate(g.expiresAt)}</p>
                  </div>
                </div>
                <p className="font-semibold">{fmtMoney(g.initialAmount, g.currency)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.stamps.length > 0 && (
        <section className="container-app mt-6">
          <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-2">Stamp cards</h2>
          <div className="space-y-2">
            {data.stamps.map(s => (
              <div key={s.id} className="card p-4 flex items-center justify-between" data-testid={`card-stamp-${s.id}`}>
                <div className="flex items-center gap-3">
                  <Stamp size={18} className="text-[rgb(var(--primary))]" />
                  <div>
                    <p className="font-medium">{s.cardKey}</p>
                    <p className="text-xs text-zinc-500">{s.completions} completion{s.completions === 1 ? "" : "s"}</p>
                  </div>
                </div>
                <p className="font-semibold">{s.stamps} stamps</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="container-app mt-6">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-2">Cashback activity</h2>
        {data.cashbackTxns.length === 0 ? (
          <p className="text-sm text-zinc-500">No cashback activity yet.</p>
        ) : (
          <ul className="card divide-y divide-[rgb(var(--border))]">
            {data.cashbackTxns.map(t => (
              <li key={t.id} className="flex items-center justify-between px-4 py-3" data-testid={`row-cashback-${t.id}`}>
                <div>
                  <p className="text-sm font-medium capitalize">{t.type.replace(/_/g, " ")}</p>
                  <p className="text-xs text-zinc-500">{t.reason ?? fmtDate(t.createdAt)}</p>
                </div>
                <p className={`font-semibold ${Number(t.amount) < 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {Number(t.amount) >= 0 ? "+" : ""}{fmtMoney(t.amount, currency)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showRedeem && (
        <RedeemModal
          fromRestaurantId={restaurantId}
          maxAmount={Number(data.cashback.balance)}
          currency={currency}
          onClose={() => setShowRedeem(false)}
          onSuccess={() => {
            void queryClient.invalidateQueries({ queryKey: ["wallet-restaurant", restaurantId] });
            void queryClient.invalidateQueries({ queryKey: ["wallet-summary"] });
            void queryClient.invalidateQueries({ queryKey: ["wallet-ledger"] });
            setShowRedeem(false);
          }}
        />
      )}
    </>
  );
}

function BalanceCard({ icon, label, value, sublabel, testid }: { icon: React.ReactNode; label: string; value: string; sublabel: string; testid: string }) {
  return (
    <div className="card p-4" data-testid={testid}>
      <div className="flex items-center gap-2 text-zinc-500 text-xs">{icon}<span>{label}</span></div>
      <p className="text-xl font-semibold mt-2">{value}</p>
      <p className="text-xs text-zinc-400 mt-1">{sublabel}</p>
    </div>
  );
}

interface NetworkRestaurant { restaurantId: number; name: string; city: string | null; allowCrossEarn: boolean; allowCrossRedeem: boolean }

function RedeemModal({ fromRestaurantId, maxAmount, currency, onClose, onSuccess }: {
  fromRestaurantId: number; maxAmount: number; currency: string;
  onClose: () => void; onSuccess: () => void;
}) {
  const [amount, setAmount] = useState<string>("");
  const [toRestaurantId, setToRestaurantId] = useState<number | null>(null);
  const [reference, setReference] = useState("");

  const { data: members = [] } = useQuery({
    queryKey: ["wallet-network-public"],
    queryFn: () => api<NetworkRestaurant[]>("/wallet/network/public"),
  });
  const eligible = members.filter(m => m.restaurantId !== fromRestaurantId);

  const mut = useMutation({
    mutationFn: () => api<{ ok: boolean }>("/wallet/redeem", {
      method: "POST",
      body: JSON.stringify({ fromRestaurantId, toRestaurantId, amount: Number(amount), reference }),
    }),
    onSuccess,
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()} data-testid="modal-redeem">
        <h3 className="text-lg font-semibold">Spend cashback elsewhere</h3>
        <p className="text-sm text-zinc-500 mt-1">Up to {fmtMoney(maxAmount, currency)} available.</p>

        <div className="space-y-3 mt-5">
          <label className="block">
            <span className="text-sm font-medium">Redeem at</span>
            <select
              className="input mt-2"
              value={toRestaurantId ?? ""}
              onChange={e => setToRestaurantId(e.target.value ? Number(e.target.value) : null)}
              data-testid="select-to-restaurant"
            >
              <option value="">Choose a restaurant…</option>
              {eligible.map(m => (
                <option key={m.restaurantId} value={m.restaurantId} disabled={!m.allowCrossEarn}>
                  {m.name}{m.city ? ` — ${m.city}` : ""}{!m.allowCrossEarn ? " (not accepting)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium">Amount</span>
            <input
              className="input mt-2" type="number" min="1" max={maxAmount} step="0.01"
              value={amount} onChange={e => setAmount(e.target.value)}
              data-testid="input-amount"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Reference (optional)</span>
            <input
              className="input mt-2" placeholder="Order # or table" value={reference}
              onChange={e => setReference(e.target.value)} data-testid="input-reference"
            />
          </label>
        </div>

        {mut.error && (
          <p className="text-sm text-red-600 mt-3">{mut.error instanceof Error ? mut.error.message : "Failed"}</p>
        )}

        <div className="flex gap-2 mt-5">
          <button className="btn-outline flex-1" onClick={onClose} data-testid="button-cancel-redeem">Cancel</button>
          <button
            className="btn-primary flex-1"
            disabled={!toRestaurantId || !amount || Number(amount) <= 0 || Number(amount) > maxAmount || mut.isPending}
            onClick={() => mut.mutate()}
            data-testid="button-confirm-redeem"
          >
            {mut.isPending ? "Sending…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
