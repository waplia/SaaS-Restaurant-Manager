// Super-admin view of accounts that users self-deleted from the mobile
// Settings screen (Task #573). Soft-deleted rows surface here so an
// admin can restore them on request — the deletion only sets
// `deleted_at` + flips `is_active` off, so restore is a simple update.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserX, RotateCcw, Search } from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiFetch, apiAction } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type DeletedUser = {
  id: number; name: string | null; email: string; phone: string | null;
  role: string; isActive: boolean; deletedAt: string;
  deletionReason: string | null;
  tenantId: number | null; tenantName: string | null;
  restaurantId: number | null; restaurantName: string | null;
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function AdminDeletedAccountsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery<{ rows: DeletedUser[] }>({
    queryKey: ["admin", "deleted-accounts"],
    queryFn: () => apiFetch<{ rows: DeletedUser[] }>("/admin/users/deleted"),
  });

  const restore = useMutation({
    mutationFn: (id: number) => apiAction(`/admin/users/${id}/restore`, "POST", {}),
    onSuccess: () => {
      toast({ title: "Account restored", description: "The user can log in again." });
      qc.invalidateQueries({ queryKey: ["admin", "deleted-accounts"] });
    },
    onError: (e: unknown) => {
      toast({ title: "Could not restore", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    },
  });

  const rows = (data?.rows ?? []).filter(r => {
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return (
      (r.name ?? "").toLowerCase().includes(t) ||
      r.email.toLowerCase().includes(t) ||
      (r.phone ?? "").toLowerCase().includes(t) ||
      (r.tenantName ?? "").toLowerCase().includes(t)
    );
  });

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <UserX className="h-6 w-6 text-destructive" />
          <div>
            <h1 className="text-2xl font-semibold">Deleted accounts</h1>
            <p className="text-sm text-muted-foreground">
              Users who deleted their own account from the mobile app. Restore reactivates the user and lets them log in again.
            </p>
          </div>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search name, email, phone, tenant…" value={q} onChange={e => setQ(e.target.value)} />
        </div>

        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3">User</th>
                  <th className="text-left px-4 py-3">Role</th>
                  <th className="text-left px-4 py-3">Tenant / Restaurant</th>
                  <th className="text-left px-4 py-3">Deleted</th>
                  <th className="text-left px-4 py-3">Reason</th>
                  <th className="text-right px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {!isLoading && rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No deleted accounts.</td></tr>
                )}
                {rows.map(r => (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.email}</div>
                      {r.phone && <div className="text-xs text-muted-foreground">{r.phone}</div>}
                    </td>
                    <td className="px-4 py-3 capitalize">{r.role}</td>
                    <td className="px-4 py-3">
                      <div>{r.tenantName ?? "—"}</div>
                      {r.restaurantName && <div className="text-xs text-muted-foreground">{r.restaurantName}</div>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(r.deletedAt)}</td>
                    <td className="px-4 py-3 max-w-[260px]">
                      <span className="text-muted-foreground">{r.deletionReason ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm" variant="outline"
                        disabled={restore.isPending}
                        onClick={() => {
                          if (window.confirm(`Restore ${r.name ?? r.email}? They will be able to log in again.`)) {
                            restore.mutate(r.id);
                          }
                        }}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Restore
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
