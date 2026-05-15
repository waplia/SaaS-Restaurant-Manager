import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2, Users, ShieldCheck, AlertTriangle, CheckCircle,
  Clock, TrendingUp, Ban, RefreshCw, LogOut, Package, Search,
  Plus, Pencil, Trash2, X, Mail, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { apiFetch, apiAction } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Tenant {
  id: number;
  name: string;
  slug: string;
  planId: number | null;
  planStatus: string;
  isActive: boolean;
  isSuspended: boolean;
  trialEndsAt: string | null;
  createdAt: string;
  primaryColor?: string | null;
  logoUrl?: string | null;
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

interface Plan {
  id: number;
  name: string;
  slug: string;
  price: string;
  currency: string;
  billingPeriod: string;
  maxRestaurants: number;
  maxBranches: number;
  maxStaff: number;
  maxTables: number;
  maxMenuItems: number;
  trialDays: number;
  features: string[];
  isActive: boolean;
}

interface TenantUsage {
  staffCount: number;
  restaurantCount: number;
  tableCount: number;
  menuItemCount: number;
}

function fmtPrice(plan: Pick<Plan, "price" | "currency" | "billingPeriod">): string {
  const sym = (plan.currency ?? "INR").toUpperCase() === "USD" ? "$" : "₹";
  const period = plan.billingPeriod === "yearly" ? "/yr" : "/mo";
  return `${sym}${plan.price}${period}`;
}

function StatusBadge({ tenant }: { tenant: Tenant }) {
  if (tenant.isSuspended) return <Badge variant="destructive">Suspended</Badge>;
  if (tenant.planStatus === "trial") {
    const expires = tenant.trialEndsAt ? new Date(tenant.trialEndsAt) : null;
    const daysLeft = expires ? Math.ceil((expires.getTime() - Date.now()) / 86400000) : null;
    return (
      <Badge variant="secondary" className="gap-1">
        <Clock className="w-3 h-3" />
        Trial {daysLeft !== null ? `(${daysLeft}d left)` : ""}
      </Badge>
    );
  }
  if (tenant.planStatus === "active") return <Badge variant="default" className="gap-1"><CheckCircle className="w-3 h-3" />Active</Badge>;
  if (tenant.planStatus === "expired") return <Badge variant="destructive">Expired</Badge>;
  return <Badge variant="outline">{tenant.planStatus}</Badge>;
}

function UsageBar({ used, max, label }: { used: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const color = pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground w-10 shrink-0">{label}</span>
      <div className="flex-1 bg-muted rounded-full h-1.5 min-w-12">
        <div className={`${color} h-1.5 rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-muted-foreground tabular-nums">{used}/{max > 0 ? max : "∞"}</span>
    </div>
  );
}

function PlanInline({ tenant, plans, usage }: { tenant: Tenant; plans: Plan[]; usage?: TenantUsage }) {
  const plan = plans.find(p => p.id === tenant.planId);
  if (!plan) return <span className="text-muted-foreground text-xs">No plan</span>;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Package className="w-3 h-3 text-primary" />
        <span className="text-xs font-medium">{plan.name}</span>
        <span className="text-xs text-muted-foreground">{fmtPrice(plan)}</span>
      </div>
      {usage && (
        <div className="space-y-0.5 pl-4">
          <UsageBar used={usage.staffCount} max={plan.maxStaff} label="Staff" />
          <UsageBar used={usage.tableCount} max={plan.maxTables} label="Tables" />
          <UsageBar used={usage.menuItemCount} max={plan.maxMenuItems} label="Menu" />
        </div>
      )}
    </div>
  );
}

// ─── Modal shell ─────────────────────────────────────────────────
function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-card border border-border rounded-xl shadow-xl w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border sticky top-0 bg-card">
          <h3 className="font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

// ─── Tenant Modal ────────────────────────────────────────────────
function TenantModal({ tenant, plans, onClose, onSaved }: { tenant: Tenant | null; plans: Plan[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<{
    name: string; slug: string; planId: number | ""; planStatus: string;
    primaryColor: string; logoUrl: string;
    ownerEmail: string; ownerName: string;
  }>({
    name: tenant?.name ?? "",
    slug: tenant?.slug ?? "",
    planId: tenant?.planId ?? (plans[0]?.id ?? ""),
    planStatus: tenant?.planStatus ?? "trial",
    primaryColor: tenant?.primaryColor ?? "#f97316",
    logoUrl: tenant?.logoUrl ?? "",
    ownerEmail: "",
    ownerName: "",
  });
  const [busy, setBusy] = useState(false);
  const isEdit = !!tenant;

  const save = async () => {
    setBusy(true);
    try {
      if (isEdit) {
        await apiAction(`/tenants/${tenant.id}`, "PATCH", {
          name: form.name, planId: form.planId ? Number(form.planId) : null, planStatus: form.planStatus,
          primaryColor: form.primaryColor, logoUrl: form.logoUrl || null,
        });
        toast({ title: "Tenant updated" });
      } else {
        const created = await apiAction<{ ownerInviteStatus?: "sent" | "skipped_existing_email" | "not_requested" }>(`/tenants`, "POST", {
          name: form.name, slug: form.slug,
          planId: form.planId ? Number(form.planId) : null,
          primaryColor: form.primaryColor,
          logoUrl: form.logoUrl || undefined,
          ownerEmail: form.ownerEmail || undefined,
          ownerName: form.ownerName || undefined,
        });
        const inviteDesc =
          created.ownerInviteStatus === "sent" ? "Owner invite email sent." :
          created.ownerInviteStatus === "skipped_existing_email" ? "Owner email already belongs to an existing user — no invite was sent." :
          undefined;
        toast({
          title: "Tenant created",
          description: inviteDesc,
          variant: created.ownerInviteStatus === "skipped_existing_email" ? "destructive" : undefined,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isEdit ? `Edit ${tenant.name}` : "Create tenant"} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name"><input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Slug" hint={isEdit ? "Slug is immutable" : "lowercase, hyphens only"}>
          <input className={inputCls} value={form.slug} disabled={isEdit}
            onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
        </Field>
        <Field label="Plan">
          <select className={inputCls} value={String(form.planId ?? "")} onChange={e => setForm({ ...form, planId: e.target.value ? Number(e.target.value) : "" })}>
            <option value="">— No plan —</option>
            {plans.map(p => <option key={p.id} value={p.id}>{p.name} · {fmtPrice(p)}</option>)}
          </select>
        </Field>
        {isEdit && (
          <Field label="Plan status">
            <select className={inputCls} value={form.planStatus} onChange={e => setForm({ ...form, planStatus: e.target.value })}>
              <option value="trial">Trial</option><option value="active">Active</option>
              <option value="expired">Expired</option><option value="cancelled">Cancelled</option>
            </select>
          </Field>
        )}
        <Field label="Primary color" hint="Hex, used for tenant branding">
          <div className="flex items-center gap-2">
            <input type="color" className="h-9 w-12 rounded border border-input bg-background" value={form.primaryColor} onChange={e => setForm({ ...form, primaryColor: e.target.value })} />
            <input className={inputCls} value={form.primaryColor} onChange={e => setForm({ ...form, primaryColor: e.target.value })} />
          </div>
        </Field>
        <Field label="Logo URL" hint="Optional"><input className={inputCls} value={form.logoUrl} onChange={e => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://…" /></Field>
      </div>
      {!isEdit && (
        <>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2">Invite owner (optional)</div>
          <p className="text-xs text-muted-foreground -mt-1">An email with a one-hour password-set link will be sent.</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Owner email"><input className={inputCls} type="email" value={form.ownerEmail} onChange={e => setForm({ ...form, ownerEmail: e.target.value })} /></Field>
            <Field label="Owner name"><input className={inputCls} value={form.ownerName} onChange={e => setForm({ ...form, ownerName: e.target.value })} /></Field>
          </div>
        </>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy || !form.name || (!isEdit && !form.slug)}>
          {isEdit ? "Save changes" : "Create tenant"}
        </Button>
      </div>
    </Modal>
  );
}

// ─── Delete Confirmation ─────────────────────────────────────────
function DeleteTenantModal({ tenant, onClose, onDeleted }: { tenant: Tenant; onClose: () => void; onDeleted: () => void }) {
  const { toast } = useToast();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const doDelete = async () => {
    setBusy(true);
    try {
      await apiAction(`/tenants/${tenant.id}?confirm=${encodeURIComponent(confirm)}`, "DELETE");
      toast({ title: "Tenant deleted" });
      onDeleted();
      onClose();
    } catch (err) {
      toast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Delete ${tenant.name}?`} onClose={onClose}>
      <p className="text-sm text-muted-foreground">
        This permanently removes the tenant. Related restaurants, users, and data may block deletion.
        Type the slug <code className="px-1 py-0.5 rounded bg-muted text-foreground">{tenant.slug}</code> to confirm.
      </p>
      <input className={inputCls} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={tenant.slug} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="destructive" onClick={doDelete} disabled={busy || confirm !== tenant.slug}>Delete tenant</Button>
      </div>
    </Modal>
  );
}

// ─── Plan Modal ──────────────────────────────────────────────────
function PlanModal({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<Partial<Plan> & { features: string[] }>({
    name: plan?.name ?? "",
    slug: plan?.slug ?? "",
    price: plan?.price ?? "0",
    currency: plan?.currency ?? "INR",
    billingPeriod: plan?.billingPeriod ?? "monthly",
    maxRestaurants: plan?.maxRestaurants ?? 1,
    maxBranches: plan?.maxBranches ?? 1,
    maxStaff: plan?.maxStaff ?? 5,
    maxTables: plan?.maxTables ?? 10,
    maxMenuItems: plan?.maxMenuItems ?? 50,
    trialDays: plan?.trialDays ?? 14,
    features: plan?.features ?? [],
    isActive: plan?.isActive ?? true,
  });
  const [featuresText, setFeaturesText] = useState((plan?.features ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const isEdit = !!plan;

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        ...form,
        price: String(form.price),
        features: featuresText.split("\n").map(s => s.trim()).filter(Boolean),
      };
      if (isEdit) {
        await apiAction(`/subscription-plans/${plan.id}`, "PATCH", payload);
        toast({ title: "Plan updated" });
      } else {
        await apiAction(`/subscription-plans`, "POST", payload);
        toast({ title: "Plan created" });
      }
      onSaved();
      onClose();
    } catch (err) {
      toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isEdit ? `Edit plan: ${plan.name}` : "Create plan"} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name"><input className={inputCls} value={form.name as string} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Slug" hint={isEdit ? "Editing the slug may break existing checkout links" : "lowercase, hyphens"}>
          <input className={inputCls} value={form.slug as string}
            onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
        </Field>
        <Field label="Price"><input className={inputCls} type="number" min="0" step="0.01" value={form.price as string} onChange={e => setForm({ ...form, price: e.target.value })} /></Field>
        <Field label="Currency">
          <select className={inputCls} value={form.currency as string} onChange={e => setForm({ ...form, currency: e.target.value })}>
            <option value="INR">INR (₹)</option><option value="USD">USD ($)</option>
          </select>
        </Field>
        <Field label="Billing period">
          <select className={inputCls} value={form.billingPeriod as string} onChange={e => setForm({ ...form, billingPeriod: e.target.value })}>
            <option value="monthly">Monthly</option><option value="yearly">Yearly</option>
          </select>
        </Field>
        <Field label="Trial days"><input className={inputCls} type="number" min="0" value={form.trialDays as number} onChange={e => setForm({ ...form, trialDays: Number(e.target.value) })} /></Field>
        <Field label="Max restaurants" hint="0 = unlimited"><input className={inputCls} type="number" min="0" value={form.maxRestaurants as number} onChange={e => setForm({ ...form, maxRestaurants: Number(e.target.value) })} /></Field>
        <Field label="Max branches"><input className={inputCls} type="number" min="0" value={form.maxBranches as number} onChange={e => setForm({ ...form, maxBranches: Number(e.target.value) })} /></Field>
        <Field label="Max staff"><input className={inputCls} type="number" min="0" value={form.maxStaff as number} onChange={e => setForm({ ...form, maxStaff: Number(e.target.value) })} /></Field>
        <Field label="Max tables"><input className={inputCls} type="number" min="0" value={form.maxTables as number} onChange={e => setForm({ ...form, maxTables: Number(e.target.value) })} /></Field>
        <Field label="Max menu items"><input className={inputCls} type="number" min="0" value={form.maxMenuItems as number} onChange={e => setForm({ ...form, maxMenuItems: Number(e.target.value) })} /></Field>
        <Field label="Active">
          <select className={inputCls} value={String(form.isActive)} onChange={e => setForm({ ...form, isActive: e.target.value === "true" })}>
            <option value="true">Yes</option><option value="false">No</option>
          </select>
        </Field>
      </div>
      <Field label="Features (one per line)">
        <textarea className={inputCls + " min-h-24"} value={featuresText} onChange={e => setFeaturesText(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy || !form.name || (!isEdit && !form.slug)}>{isEdit ? "Save changes" : "Create plan"}</Button>
      </div>
    </Modal>
  );
}

// ─── Plans Manager Tab ───────────────────────────────────────────
function PlansTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: plans = [], isLoading } = useQuery<Plan[]>({
    queryKey: ["subscription-plans"],
    queryFn: () => apiFetch("/subscription-plans"),
  });
  const [editing, setEditing] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);

  const toggleActive = async (p: Plan) => {
    try {
      await apiAction(`/subscription-plans/${p.id}/toggle-active`, "POST");
      void qc.invalidateQueries({ queryKey: ["subscription-plans"] });
      toast({ title: p.isActive ? "Plan deactivated" : "Plan activated" });
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const remove = async (p: Plan) => {
    if (!confirm(`Delete plan "${p.name}"? This cannot be undone.`)) return;
    try {
      await apiAction(`/subscription-plans/${p.id}`, "DELETE");
      void qc.invalidateQueries({ queryKey: ["subscription-plans"] });
      toast({ title: "Plan deleted" });
    } catch (err) {
      toast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-foreground">Subscription Plans</h2>
          <span className="text-xs text-muted-foreground">({plans.length})</span>
        </div>
        <Button size="sm" onClick={() => setCreating(true)} className="gap-2"><Plus className="w-4 h-4" />New plan</Button>
      </div>
      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground">Loading plans…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Price</th>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Limits</th>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-6 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {plans.map(p => (
                <tr key={p.id} className="hover:bg-muted/20">
                  <td className="px-6 py-4">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.slug}</p>
                  </td>
                  <td className="px-6 py-4 text-foreground font-medium">{fmtPrice(p)}</td>
                  <td className="px-6 py-4 text-xs text-muted-foreground">
                    {p.maxRestaurants || "∞"} rest · {p.maxStaff || "∞"} staff · {p.maxTables || "∞"} tables · {p.maxMenuItems || "∞"} items
                  </td>
                  <td className="px-6 py-4">{p.isActive ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>}</td>
                  <td className="px-6 py-4 text-right space-x-1">
                    <Button size="sm" variant="outline" onClick={() => setEditing(p)} className="gap-1"><Pencil className="w-3 h-3" />Edit</Button>
                    <Button size="sm" variant="outline" onClick={() => void toggleActive(p)} className="gap-1">
                      {p.isActive ? <><Ban className="w-3 h-3" />Deactivate</> : <><CheckCircle className="w-3 h-3" />Activate</>}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void remove(p)} className="gap-1 text-destructive"><Trash2 className="w-3 h-3" />Delete</Button>
                  </td>
                </tr>
              ))}
              {plans.length === 0 && <tr><td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">No plans yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {creating && <PlanModal plan={null} onClose={() => setCreating(false)} onSaved={() => qc.invalidateQueries({ queryKey: ["subscription-plans"] })} />}
      {editing && <PlanModal plan={editing} onClose={() => setEditing(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["subscription-plans"] })} />}
    </div>
  );
}

// ─── Tenants Tab ─────────────────────────────────────────────────
function TenantsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState("");
  const [planId, setPlanId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [deleting, setDeleting] = useState<Tenant | null>(null);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), limit: "20" });
    if (search) sp.set("search", search);
    if (status) sp.set("status", status);
    if (planId) sp.set("planId", planId);
    return sp.toString();
  }, [page, search, status, planId]);

  const { data: tenantData, isLoading } = useQuery<TenantList>({
    queryKey: ["admin", "tenants", queryString],
    queryFn: () => apiFetch(`/tenants?${queryString}`),
  });

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ["subscription-plans"],
    queryFn: () => apiFetch("/subscription-plans"),
  });

  const { data: usageMap = {} } = useQuery<Record<number, TenantUsage>>({
    queryKey: ["admin", "tenant-usage"],
    queryFn: () => apiFetch("/admin/tenant-usage"),
  });

  const suspendMutation = useMutation({
    mutationFn: (id: number) => apiAction(`/tenants/${id}/suspend`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["admin"] }); },
  });
  const activateMutation = useMutation({
    mutationFn: (id: number) => apiAction(`/tenants/${id}/activate`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["admin"] }); },
  });

  const impersonate = async (tenant: Tenant) => {
    try {
      const r = await apiAction<{ token: string; owner: { id: number; email: string; name: string } }>(`/tenants/${tenant.id}/impersonate`, "POST");
      // Only the impersonation token travels in the URL; the receiving app
      // re-fetches the authoritative user via /me after swapping tokens.
      const url = `/app/#impersonate=${encodeURIComponent(r.token)}`;
      window.open(url, "_blank", "noopener");
      toast({ title: `Opened ${tenant.name} as ${r.owner.email}`, description: "Session expires in 15 minutes." });
    } catch (err) {
      toast({ title: "Could not impersonate", description: (err as Error).message, variant: "destructive" });
    }
  };
  const changePlanMutation = useMutation({
    mutationFn: ({ id, planId: newPlanId }: { id: number; planId: number }) =>
      apiAction(`/tenants/${id}`, "PATCH", { planId: newPlanId, planStatus: "active" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin"] });
      toast({ title: "Plan updated" });
    },
  });

  const tenants = tenantData?.tenants ?? tenantData?.data ?? [];
  const total = tenantData?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 20));

  const submitSearch = (e: React.FormEvent) => { e.preventDefault(); setSearch(searchInput); setPage(1); };

  return (
    <div className="bg-card border border-border rounded-xl">
      <div className="px-6 py-4 border-b border-border flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-foreground">All Tenants</h2>
          <span className="text-xs text-muted-foreground">({total} total)</span>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <form onSubmit={submitSearch} className="flex items-center gap-1">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className={inputCls + " pl-7 w-44 py-1.5"} placeholder="Search name or slug…"
                value={searchInput} onChange={e => setSearchInput(e.target.value)} />
            </div>
            <Button type="submit" size="sm" variant="outline">Search</Button>
          </form>
          <select className={inputCls + " py-1.5 w-32"} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All status</option>
            <option value="trial">Trial</option><option value="active">Active</option>
            <option value="expired">Expired</option><option value="cancelled">Cancelled</option>
            <option value="suspended">Suspended</option>
          </select>
          <select className={inputCls + " py-1.5 w-36"} value={planId} onChange={e => { setPlanId(e.target.value); setPage(1); }}>
            <option value="">All plans</option>
            {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["admin"] })} className="gap-1">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1"><Plus className="w-3.5 h-3.5" />New tenant</Button>
        </div>
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
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Plan & Limits</th>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Trial</th>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Joined</th>
                <th className="px-6 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tenants.map(tenant => (
                <tr key={tenant.id} className="hover:bg-muted/20">
                  <td className="px-6 py-4">
                    <p className="font-medium text-foreground">{tenant.name}</p>
                    <p className="text-xs text-muted-foreground">{tenant.slug}</p>
                  </td>
                  <td className="px-6 py-4"><StatusBadge tenant={tenant} /></td>
                  <td className="px-6 py-4">
                    <div className="space-y-1.5">
                      <PlanInline tenant={tenant} plans={plans} usage={usageMap[tenant.id]} />
                      <select
                        className="text-xs border border-border rounded px-2 py-1 bg-background text-foreground"
                        value={tenant.planId ?? ""}
                        disabled={changePlanMutation.isPending}
                        onChange={e => changePlanMutation.mutate({ id: tenant.id, planId: Number(e.target.value) })}>
                        <option value="" disabled>Change plan…</option>
                        {plans.map(p => <option key={p.id} value={p.id}>{p.name} ({fmtPrice(p)})</option>)}
                      </select>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground text-xs">
                    {tenant.trialEndsAt ? new Date(tenant.trialEndsAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-6 py-4 text-muted-foreground text-xs">{new Date(tenant.createdAt).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-right space-x-1 whitespace-nowrap">
                    <Button size="sm" variant="outline" onClick={() => setEditing(tenant)} className="gap-1"><Pencil className="w-3 h-3" />Edit</Button>
                    <Button size="sm" variant="outline" onClick={() => void impersonate(tenant)} className="gap-1" title="Open this tenant's app as their owner (15-minute session)">
                      <Eye className="w-3 h-3" />View as
                    </Button>
                    {tenant.isSuspended ? (
                      <Button size="sm" variant="outline" onClick={() => activateMutation.mutate(tenant.id)} disabled={activateMutation.isPending} className="gap-1">
                        <CheckCircle className="w-3 h-3" />Activate
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => suspendMutation.mutate(tenant.id)} disabled={suspendMutation.isPending} className="gap-1">
                        <AlertTriangle className="w-3 h-3" />Suspend
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setDeleting(tenant)} className="gap-1 text-destructive"><Trash2 className="w-3 h-3" />Delete</Button>
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No tenants found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="px-6 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page} of {pageCount}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {createOpen && <TenantModal tenant={null} plans={plans} onClose={() => setCreateOpen(false)} onSaved={() => qc.invalidateQueries({ queryKey: ["admin"] })} />}
      {editing && <TenantModal tenant={editing} plans={plans} onClose={() => setEditing(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["admin"] })} />}
      {deleting && <DeleteTenantModal tenant={deleting} onClose={() => setDeleting(null)} onDeleted={() => qc.invalidateQueries({ queryKey: ["admin"] })} />}
    </div>
  );
}

export default function AdminPage() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<"tenants" | "plans">("tenants");

  const { data: stats } = useQuery<AdminStats>({
    queryKey: ["admin", "stats"],
    queryFn: () => apiFetch("/admin/stats"),
    refetchInterval: 30000,
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
              <h1 className="font-bold text-lg text-foreground">Khana Lagao Admin</h1>
              <p className="text-xs text-muted-foreground">Super Admin Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-foreground">{user.name}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end"><Mail className="w-3 h-3" />{user.email}</p>
            </div>
            <Button variant="outline" size="sm" onClick={logout} className="gap-2">
              <LogOut className="w-4 h-4" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {statCards.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4 space-y-2">
              <Icon className={`w-5 h-5 ${color}`} />
              <p className="text-2xl font-bold text-foreground">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        <div className="border-b border-border flex gap-1">
          {[
            { id: "tenants" as const, label: "Tenants", icon: Users },
            { id: "plans" as const, label: "Plans", icon: Package },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 ${
                tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              <t.icon className="w-4 h-4" />{t.label}
            </button>
          ))}
        </div>

        {tab === "tenants" ? <TenantsTab /> : <PlansTab />}
      </main>
    </div>
  );
}
