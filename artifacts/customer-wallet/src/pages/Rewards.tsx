import { useQuery } from "@tanstack/react-query";
import { api, fmtDate } from "@/lib/api";
import { Header } from "@/components/Layout";
import { Gift, Sparkles, Stamp } from "lucide-react";

interface RewardsResp {
  available: Array<{ id: number; restaurantId: number; restaurantName: string; rewardLabel: string; status: string; expiresAt: string | null }>;
  stampCards: Array<{ id: number; restaurantId: number; restaurantName: string; cardKey: string; stamps: number; completions: number; lastStampedAt: string | null }>;
}

export default function Rewards() {
  const { data, isLoading } = useQuery({
    queryKey: ["wallet-rewards"],
    queryFn: () => api<RewardsResp>("/wallet/rewards"),
  });

  return (
    <>
      <Header title="Rewards" subtitle="Surprise gifts and stamps you've collected." />

      <section className="container-app">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-2 flex items-center gap-2">
          <Sparkles size={14} /> Mystery rewards
        </h2>
        {isLoading ? (
          <div className="skeleton h-20" />
        ) : (data?.available.length ?? 0) === 0 ? (
          <div className="card p-6 text-center text-sm text-zinc-500">
            No rewards waiting. Visit a TableTrack restaurant to unlock more!
          </div>
        ) : (
          <ul className="space-y-2">
            {data!.available.map(m => (
              <li key={m.id} className="card p-4 flex items-center gap-3" data-testid={`card-reward-${m.id}`}>
                <div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                  <Gift size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{m.rewardLabel}</p>
                  <p className="text-xs text-zinc-500">{m.restaurantName} · expires {fmtDate(m.expiresAt)}</p>
                </div>
                <span className="chip bg-amber-50 text-amber-700 capitalize">{m.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="container-app mt-8">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-2 flex items-center gap-2">
          <Stamp size={14} /> Stamp cards
        </h2>
        {(data?.stampCards.length ?? 0) === 0 ? (
          <p className="text-sm text-zinc-500">No stamp cards yet.</p>
        ) : (
          <ul className="space-y-2">
            {data!.stampCards.map(s => (
              <li key={s.id} className="card p-4" data-testid={`card-stampcard-${s.id}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{s.cardKey}</p>
                    <p className="text-xs text-zinc-500">{s.restaurantName}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{s.stamps} stamps</p>
                    <p className="text-xs text-zinc-500">{s.completions} reward{s.completions === 1 ? "" : "s"} earned</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
