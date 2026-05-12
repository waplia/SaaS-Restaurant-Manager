import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useStaff, useCreateUser } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, User, Phone, Mail, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const ROLE_CONFIG: Record<string, { label: string; color: string }> = {
  owner: { label: "Owner", color: "bg-purple-100 text-purple-700" },
  manager: { label: "Manager", color: "bg-blue-100 text-blue-700" },
  waiter: { label: "Waiter", color: "bg-green-100 text-green-700" },
  kitchen: { label: "Kitchen", color: "bg-orange-100 text-orange-700" },
  cashier: { label: "Cashier", color: "bg-yellow-100 text-yellow-700" },
};

function StaffCard({ member }: { member: any }) {
  const roleConfig = ROLE_CONFIG[member.role] ?? { label: member.role, color: "bg-gray-100 text-gray-600" };
  const initials = member.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2);

  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-4">
      <div className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <p className="font-semibold text-foreground truncate">{member.name}</p>
          <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", roleConfig.color)}>{roleConfig.label}</span>
          {!member.isActive && <span className="text-xs text-red-500 font-medium">Inactive</span>}
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="w-3 h-3" />{member.email}</p>
          {member.phone && <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" />{member.phone}</p>}
        </div>
      </div>
    </div>
  );
}

export default function StaffPage() {
  const [roleFilter, setRoleFilter] = useState<string | undefined>();
  const { data: staff } = useStaff(roleFilter);
  const staffArr = (staff as any[]) ?? [];
  const createUser = useCreateUser();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", role: "waiter", passwordHash: "default_hash" });

  const byRole = (role: string) => staffArr.filter(s => s.role === role).length;
  const roles = ["owner", "manager", "waiter", "kitchen", "cashier"];

  const handleAdd = async () => {
    if (!form.name || !form.email) return;
    try {
      await createUser.mutateAsync({ ...form, restaurantId: 1, tenantId: 1 });
      toast({ title: "Staff member added!" });
      setShowAdd(false);
      setForm({ name: "", email: "", phone: "", role: "waiter", passwordHash: "default_hash" });
    } catch {
      toast({ title: "Failed to add staff member", variant: "destructive" });
    }
  };

  return (
    <Layout>
      <PageHeader
        title="Staff Management"
        subtitle={`${staffArr.length} team members`}
        actions={
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add Staff
          </Button>
        }
      />
      <div className="p-6">
        {/* Role summary */}
        <div className="flex gap-3 mb-6 flex-wrap">
          <button onClick={() => setRoleFilter(undefined)} className={cn("text-sm px-3 py-1.5 rounded-lg border", !roleFilter ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted")}>
            All ({staffArr.length})
          </button>
          {roles.map(role => {
            const cfg = ROLE_CONFIG[role];
            const count = byRole(role);
            return (
              <button key={role} onClick={() => setRoleFilter(roleFilter === role ? undefined : role)} className={cn("text-sm px-3 py-1.5 rounded-lg border transition-colors", roleFilter === role ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted")}>
                {cfg.label} ({count})
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {staffArr.map((member: any) => (
            <StaffCard key={member.id} member={member} />
          ))}
          {staffArr.length === 0 && (
            <div className="col-span-full text-center py-16 text-muted-foreground">
              <User className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No staff found</p>
            </div>
          )}
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-semibold mb-4">Add Staff Member</h2>
            <div className="space-y-3">
              <div><Label>Name</Label><Input placeholder="Full name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Label>Email</Label><Input type="email" placeholder="email@restaurant.com" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
              <div><Label>Phone</Label><Input placeholder="+91 98765 43210" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
              <div>
                <Label>Role</Label>
                <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                  {roles.map(r => <option key={r} value={r}>{ROLE_CONFIG[r]?.label ?? r}</option>)}
                </select>
              </div>
              <div className="flex gap-3 mt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleAdd} disabled={createUser.isPending}>Add</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
