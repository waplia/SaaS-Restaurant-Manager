import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2, Users, ShieldCheck, AlertTriangle, CheckCircle,
  Clock, TrendingUp, Ban, RefreshCw, LogOut
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { getStoredToken } from "@/lib/auth";

interface Tenant {
  id: number;
  name: string;
  slug: string;
  planStatus: string;
  isActive: boolean;
  isSuspended: boolean;
  trialEndsAt: string | null;
  createdAt: string;
}

interface TenantList {
  tenants: Tenant[];
  data?: Tenant[];
  total: number;
}

interface AdminStats {
  totalTenants: number;
  activeTenants: number;
  trialTenants: number;
  suspendedTenants?: number;
  totalRestaurants: number;
  totalOrders: number;
  totalRevenue: string;
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function authHeader(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { headers: authHeader() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiAction(path: string, method = "POST") {
  const res = await fetch(`${BASE}/api${path}`, { method, headers: authHeader() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function StatusBadge({ tenant }: { tenant: Tenant }) {
  if (tenant.isSuspended) return <Badge variant="destructive">Suspended</Badge>;
  if (tenant.planStatus === "trial") {
    const expires = tenant.trialEndsAt ? new Date(tenant.trialEndsAt) : null;
    const daysLeft = expires ? Math.ceil((expires.getTime() - Date.now()) / 86400000) : null;
    return (
      <Badge variant="secondary">
        Trial {daysLeft !== null ? `(${daysLeft}d left)` : ""}
      </Badge>
    );
  }
  if (tenant.planStatus === "active") return <Badge variant="default">Active</Badge>;
  return <Badge variant="outline">{tenant.planStatus}</Badge>;
}

export default function AdminPage() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const [page] = useState(1);

  const { data: stats } = useQuery<AdminStats>({
    queryKey: ["admin", "stats"],
    queryFn: () => apiFetch("/admin/stats"),
    refetchInterval: 30000,
  });

  const { data: tenantData, isLoading } = useQuery<TenantList>({
    queryKey: ["admin", "tenants", page],
    queryFn: () => apiFetch(`/tenants?page=${page}&limit=20`),
  });

  const suspendMutation = useMutation({
    mutationFn: (id: number) => apiAction(`/tenants/${id}/suspend`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["admin"] }); },
  });

  const activateMutation = useMutation({
    mutationFn: (id: number) => apiAction(`/tenants/${id}/activate`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["admin"] }); },
  });

  if (!user?.isSuperAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <ShieldCheck className="w-12 h-12 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-semibold">Super Admin Access Only</h2>
          <p className="text-muted-foreground text-sm">You do not have permission to view this page.</p>
          <Button variant="outline" onClick={() => window.history.back()}>Go back</Button>
        </div>
      </div>
    );
  }

  const statCards = [
    { label: "Total Tenants", value: stats?.totalTenants ?? "—", icon: Building2, color: "text-primary" },
    { label: "Active", value: stats?.activeTenants ?? "—", icon: CheckCircle, color: "text-green-600" },
    { label: "On Trial", value: stats?.trialTenants ?? "—", icon: Clock, color: "text-amber-600" },
    { label: "Suspended", value: stats?.suspendedTenants ?? "—", icon: Ban, color: "text-destructive" },
    { label: "Restaurants", value: stats?.totalRestaurants ?? "—", icon: Building2, color: "text-primary" },
    { label: "Total Orders", value: stats?.totalOrders ?? "—", icon: TrendingUp, color: "text-primary" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <div>
              <h1 className="font-bold text-lg text-foreground">TableTrack Admin</h1>
              <p className="text-xs text-muted-foreground">Super Admin Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-foreground">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
            <Button variant="outline" size="sm" onClick={logout} className="gap-2">
              <LogOut className="w-4 h-4" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {statCards.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4 space-y-2">
              <Icon className={`w-5 h-5 ${color}`} />
              <p className="text-2xl font-bold text-foreground">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        <div className="bg-card border border-border rounded-xl">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              <h2 className="font-semibold text-foreground">All Tenants</h2>
              {tenantData?.total !== undefined && (
                <span className="text-xs text-muted-foreground">({tenantData.total} total)</span>
              )}
            </div>
            <Button variant="outline" size="sm" className="gap-2"
              onClick={() => void qc.invalidateQueries({ queryKey: ["admin"] })}>
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-muted-foreground">Loading tenants…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-6 py-3 text-left font-medium text-muted-foreground">Tenant</th>
                    <th className="px-6 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-6 py-3 text-left font-medium text-muted-foreground">Joined</th>
                    <th className="px-6 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(tenantData?.tenants ?? tenantData?.data ?? []).map(tenant => (
                    <tr key={tenant.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-foreground">{tenant.name}</p>
                          <p className="text-xs text-muted-foreground">{tenant.slug}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4"><StatusBadge tenant={tenant} /></td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {new Date(tenant.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {tenant.isSuspended ? (
                          <Button size="sm" variant="outline"
                            onClick={() => activateMutation.mutate(tenant.id)}
                            disabled={activateMutation.isPending}
                            className="gap-1.5">
                            <CheckCircle className="w-3.5 h-3.5" /> Activate
                          </Button>
                        ) : (
                          <Button size="sm" variant="destructive"
                            onClick={() => suspendMutation.mutate(tenant.id)}
                            disabled={suspendMutation.isPending}
                            className="gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5" /> Suspend
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {(tenantData?.tenants ?? tenantData?.data ?? []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                        No tenants found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
