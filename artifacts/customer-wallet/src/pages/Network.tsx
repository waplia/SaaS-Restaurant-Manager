import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Header } from "@/components/Layout";
import { Globe2 } from "lucide-react";

interface Member {
  restaurantId: number; name: string; city: string | null; country: string | null;
  logoUrl: string | null; coverImageUrl: string | null;
  currency: string; blurb: string | null;
  allowCrossEarn: boolean; allowCrossRedeem: boolean;
}

export default function Network() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["wallet-network-public"],
    queryFn: () => api<Member[]>("/wallet/network/public"),
  });

  return (
    <>
      <Header title="Loyalty network" subtitle="Restaurants where your wallet works." />
      <section className="container-app">
        {isLoading ? (
          <div className="space-y-3"><div className="skeleton h-28" /><div className="skeleton h-28" /></div>
        ) : data.length === 0 ? (
          <div className="card p-8 text-center">
            <Globe2 size={28} className="mx-auto text-zinc-300 mb-3" />
            <p className="text-sm text-zinc-500">No restaurants have joined the network yet.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {data.map(m => (
              <li key={m.restaurantId} className="card overflow-hidden" data-testid={`card-network-${m.restaurantId}`}>
                {m.coverImageUrl && (
                  <img src={m.coverImageUrl} alt="" className="w-full h-28 object-cover" />
                )}
                <div className="p-4 flex items-start gap-3">
                  {m.logoUrl
                    ? <img src={m.logoUrl} alt="" className="w-12 h-12 rounded-xl object-cover bg-zinc-100" />
                    : <div className="w-12 h-12 rounded-xl bg-[rgb(var(--accent))] text-[rgb(var(--primary))] flex items-center justify-center font-semibold">{m.name.charAt(0)}</div>
                  }
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{m.name}</p>
                    {(m.city || m.country) && (
                      <p className="text-xs text-zinc-500">{[m.city, m.country].filter(Boolean).join(", ")}</p>
                    )}
                    {m.blurb && <p className="text-sm text-zinc-600 mt-2">{m.blurb}</p>}
                    <div className="flex gap-2 mt-3">
                      {m.allowCrossEarn && <span className="chip bg-green-50 text-green-700">Earn here</span>}
                      {m.allowCrossRedeem && <span className="chip bg-blue-50 text-blue-700">Redeem cashback</span>}
                    </div>
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
