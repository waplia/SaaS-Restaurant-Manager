import { useQuery } from "@tanstack/react-query";
import { api, fmtMoney, fmtDate } from "@/lib/api";
import { Header } from "@/components/Layout";
import { Receipt } from "lucide-react";

interface Visit {
  id: number; orderNumber: string;
  orderDisplayNumber: string | null;
  orderInternalNumber: string | null;
  restaurantId: number; totalAmount: string;
  paymentStatus: string; createdAt: string; restaurantName: string;
  restaurantCurrency: string; restaurantLogo: string | null;
}

export default function Visits() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["wallet-visits"],
    queryFn: () => api<Visit[]>("/wallet/visits"),
  });

  return (
    <>
      <Header title="Recent visits" subtitle="Your orders across every KhanaLagao restaurant." />
      <section className="container-app">
        {isLoading ? (
          <div className="space-y-2"><div className="skeleton h-16" /><div className="skeleton h-16" /></div>
        ) : data.length === 0 ? (
          <div className="card p-8 text-center">
            <Receipt size={28} className="mx-auto text-zinc-300 mb-3" />
            <p className="text-sm text-zinc-500">No visits yet. They'll appear after you order at a KhanaLagao restaurant.</p>
          </div>
        ) : (
          <ul className="card divide-y divide-[rgb(var(--border))]">
            {data.map(v => (
              <li key={v.id} className="px-4 py-3 flex items-center gap-3" data-testid={`row-visit-${v.id}`}>
                {v.restaurantLogo
                  ? <img src={v.restaurantLogo} alt="" className="w-10 h-10 rounded-lg object-cover bg-zinc-100" />
                  : <div className="w-10 h-10 rounded-lg bg-[rgb(var(--accent))] text-[rgb(var(--primary))] flex items-center justify-center font-medium">{v.restaurantName.charAt(0)}</div>
                }
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{v.restaurantName}</p>
                  <p className="text-xs text-zinc-500">
                    <span className="font-semibold text-zinc-700">{v.orderDisplayNumber ?? v.orderNumber}</span>
                    {" · "}{fmtDate(v.createdAt)}
                  </p>
                  {v.orderInternalNumber && v.orderInternalNumber !== v.orderNumber && (
                    <p className="text-[10px] text-zinc-400 truncate">{v.orderInternalNumber}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-semibold">{fmtMoney(v.totalAmount, v.restaurantCurrency)}</p>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-400">{v.paymentStatus}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
