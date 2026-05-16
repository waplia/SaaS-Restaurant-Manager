import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Users, Receipt, AlertCircle, TrendingUp, Inbox } from "lucide-react";
import { useCorporateDashboard } from "@/lib/corporate";

function StatCard({ icon: Icon, label, value, href }: { icon: typeof Building2; label: string; value: string | number; href?: string }) {
  const inner = (
    <Card className="hover:shadow-md transition">
      <CardContent className="p-4 flex items-center gap-3">
        <div className="p-2 rounded-md bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div>
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="text-2xl font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default function CorporateDashboardPage() {
  const { data, isLoading } = useCorporateDashboard();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Corporate Accounts</h1>
          <p className="text-sm text-muted-foreground">B2B office ordering, approvals and invoicing</p>
        </div>
        <Link href="/corporate/companies"><a className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm">Manage companies →</a></Link>
      </div>

      {isLoading ? <div>Loading…</div> : data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Building2} label="Active companies" value={data.activeCompanies} href="/corporate/companies" />
            <StatCard icon={Users} label="Active employees" value={data.activeEmployees} />
            <StatCard icon={TrendingUp} label="Month revenue (₹)" value={Number(data.monthRevenue).toFixed(2)} />
            <StatCard icon={Inbox} label="Pending approvals" value={data.pendingApprovals} href="/corporate/approvals" />
            <StatCard icon={Receipt} label="Outstanding (₹)" value={Number(data.outstandingTotal).toFixed(2)} href="/corporate/invoices" />
            <StatCard icon={AlertCircle} label="Open invoices" value={data.outstandingInvoices} href="/corporate/invoices" />
            <StatCard icon={Receipt} label="Month orders" value={data.monthOrders} />
          </div>

          <Card>
            <CardHeader><CardTitle>Top companies this month</CardTitle></CardHeader>
            <CardContent>
              {data.topCompanies.length === 0 ? (
                <div className="text-sm text-muted-foreground">No corporate orders yet this month.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr><th className="py-2">Company</th><th>Orders</th><th>Revenue</th></tr>
                  </thead>
                  <tbody>
                    {data.topCompanies.map(c => (
                      <tr key={c.companyId} className="border-t">
                        <td className="py-2"><Link href={`/corporate/companies/${c.companyId}`}><a className="text-primary">{c.companyName}</a></Link></td>
                        <td>{c.orders}</td>
                        <td>₹{Number(c.revenue).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
