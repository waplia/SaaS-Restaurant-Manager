import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { useCustomers } from "@/lib/hooks";
import { useCustomerTiffinHistory } from "@/lib/tiffin";

export default function TiffinCustomerHistoryPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number>(0);
  const { data: customersResp } = useCustomers({ search });
  const customers = (customersResp as { data?: { id: number; name: string; phone?: string }[] } | undefined)?.data ?? [];
  const { data: history } = useCustomerTiffinHistory(selected);
  const h = history as { subscriptions?: Array<{ id: number; planId: number; status: string; startDate: string; endDate: string | null }>; deliveries?: Array<{ id: number; deliveryDate: string; slot: string; status: string; mealsCount: number }>; invoices?: Array<{ id: number; invoiceNumber: string; periodStart: string; periodEnd: string; total: string; status: string }> } | undefined;

  return (
    <Layout>
      <PageHeader title="Customer Tiffin History" subtitle="Per-customer subscriptions, deliveries, invoices" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <aside className="bg-card border border-border rounded-xl p-3 md:col-span-1">
          <Input placeholder="Search customer…" value={search} onChange={e => setSearch(e.target.value)} className="mb-3" />
          <div className="max-h-[60vh] overflow-auto space-y-1">
            {customers.map(c => (
              <button key={c.id} onClick={() => setSelected(c.id)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm ${selected === c.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                <p className="font-medium">{c.name}</p>
                {c.phone && <p className="text-xs opacity-70">{c.phone}</p>}
              </button>
            ))}
            {customers.length === 0 && <p className="text-xs text-muted-foreground p-2">No customers.</p>}
          </div>
        </aside>

        <section className="md:col-span-2 space-y-4">
          {selected === 0 && <p className="text-sm text-muted-foreground">Select a customer to view their tiffin history.</p>}
          {selected > 0 && (
            <>
              <Card title="Subscriptions">
                {h?.subscriptions?.length ? h.subscriptions.map(s => (
                  <div key={s.id} className="border-b border-border last:border-0 py-2 text-sm">
                    Sub #{s.id} • {s.status} • {s.startDate} {s.endDate ? `→ ${s.endDate}` : ""}
                  </div>
                )) : <p className="text-xs text-muted-foreground">No subscriptions.</p>}
              </Card>
              <Card title="Recent Deliveries">
                {h?.deliveries?.length ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {h.deliveries.slice(0, 60).map(d => (
                      <div key={d.id} className={`p-2 rounded border text-xs ${
                        d.status === "delivered" ? "border-green-300 bg-green-50 dark:bg-green-950/20" :
                        d.status === "skipped" || d.status === "paused" ? "border-gray-300 bg-gray-50 dark:bg-gray-900" :
                        d.status === "not_delivered" ? "border-red-300 bg-red-50 dark:bg-red-950/20" :
                        "border-border"
                      }`}>
                        <p className="font-medium">{d.deliveryDate}</p>
                        <p className="text-[10px] capitalize">{d.slot} • {d.status.replace("_", " ")}</p>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-muted-foreground">No deliveries yet.</p>}
              </Card>
              <Card title="Invoices">
                {h?.invoices?.length ? (
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground"><tr><th className="text-left p-2">#</th><th className="text-left p-2">Period</th><th className="text-right p-2">Total</th><th className="p-2">Status</th></tr></thead>
                    <tbody>
                      {h.invoices.map(i => (
                        <tr key={i.id} className="border-t border-border">
                          <td className="p-2 font-mono text-xs">{i.invoiceNumber}</td>
                          <td className="p-2 text-xs">{i.periodStart} → {i.periodEnd}</td>
                          <td className="p-2 text-right">₹{i.total}</td>
                          <td className="p-2 text-xs">{i.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="text-xs text-muted-foreground">No invoices.</p>}
              </Card>
            </>
          )}
        </section>
      </div>
    </Layout>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="font-semibold mb-3">{title}</h3>
      {children}
    </div>
  );
}
