import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { ArrowUp, ArrowDown, ArrowUpDown, Loader2 } from "lucide-react";
import {
  Building2, Users, ShieldCheck, AlertTriangle, CheckCircle,
  Clock, TrendingUp, Ban, RefreshCw, LogOut, Package, Search,
  Plus, Pencil, Trash2, X, Mail, Eye, CreditCard, FileCheck2,
  Landmark, Smartphone, ExternalLink, Megaphone, MessageSquare,
  MessageCircle, Activity, Wrench,
  Tag, Copy, History, Calendar,
} from "lucide-react";
import { Link } from "wouter";
import AdminNotificationCenter from "./admin-notifications";
import AdminSmsTab from "./admin-sms";
import AdminEmail from "./admin-email";
import AdminMaintenance from "./admin-maintenance";
import AdminWhatsAppTab from "./admin-whatsapp";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { apiFetch, apiAction } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import {
  useAdminPaymentMethods, useUpdateAdminPaymentMethod,
  useAdminManualPayments, useApproveManualPayment, useRejectManualPayment,
  type PaymentProviderRow, type AdminManualPaymentRow,
} from "@/lib/hooks";
import { ImageUploadField } from "@/components/ImageUploadField";
import {
  PLAN_BOOLEAN_FEATURES, PLAN_QUANTITY_FEATURES, PLAN_FEATURE_CATEGORIES,
  defaultFeatureFlags, isFeatureEnabled,
} from "@workspace/db/planFeatures";

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
  featureFlags: Record<string, boolean> | null;
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
  const [form, setForm] = useState<Partial<Plan> & { features: string[]; whatsappMonthlyLimit?: number }>({
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
    whatsappMonthlyLimit: (plan as Plan & { whatsappMonthlyLimit?: number })?.whatsappMonthlyLimit ?? 0,
    features: plan?.features ?? [],
    isActive: plan?.isActive ?? true,
  });
  const [featuresText, setFeaturesText] = useState((plan?.features ?? []).join("\n"));
  // Boolean feature flags — initialise from existing plan, falling back to the
  // catalogue defaults so plans that pre-date a flag still render sensibly.
  const [flags, setFlags] = useState<Record<string, boolean>>(() => {
    const seed = plan?.featureFlags && typeof plan.featureFlags === "object" ? plan.featureFlags : {};
    const out: Record<string, boolean> = { ...defaultFeatureFlags() };
    for (const k of Object.keys(seed)) {
      if (typeof (seed as Record<string, unknown>)[k] === "boolean") out[k] = Boolean((seed as Record<string, unknown>)[k]);
    }
    return out;
  });
  const [busy, setBusy] = useState(false);
  const isEdit = !!plan;

  const setFlag = (key: string, val: boolean) => setFlags(prev => ({ ...prev, [key]: val }));
  const setQty = (key: keyof Plan, val: number) =>
    setForm(prev => ({ ...prev, [key]: val }) as typeof prev);

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        ...form,
        price: String(form.price),
        features: featuresText.split("\n").map(s => s.trim()).filter(Boolean),
        featureFlags: flags,
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
        <Field label="WhatsApp messages / month" hint="0 = WhatsApp not included">
          <input className={inputCls} type="number" min="0"
            value={(form as { whatsappMonthlyLimit?: number }).whatsappMonthlyLimit ?? 0}
            onChange={e => setForm({ ...form, whatsappMonthlyLimit: Number(e.target.value) } as typeof form)} />
        </Field>
        <Field label="Active">
          <select className={inputCls} value={String(form.isActive)} onChange={e => setForm({ ...form, isActive: e.target.value === "true" })}>
            <option value="true">Yes</option><option value="false">No</option>
          </select>
        </Field>
      </div>

      {/* ─── Quantity limits ───────────────────────────────────────── */}
      <div className="mt-5">
        <p className="text-sm font-semibold mb-1">Quantity limits</p>
        <p className="text-xs text-muted-foreground mb-2">Use a high number (e.g. 999) for "Unlimited".</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {PLAN_QUANTITY_FEATURES.map(q => (
            <Field key={q.key} label={q.label} hint={q.description}>
              <input
                className={inputCls}
                type="number"
                min="0"
                value={Number(form[q.key as keyof Plan] ?? 0)}
                onChange={e => setQty(q.key as keyof Plan, Number(e.target.value))}
              />
            </Field>
          ))}
        </div>
      </div>

      {/* ─── Boolean feature flags grouped by category ─────────────── */}
      <div className="mt-5">
        <p className="text-sm font-semibold mb-2">Included features</p>
        <div className="space-y-3">
          {PLAN_FEATURE_CATEGORIES.map(cat => {
            const items = PLAN_BOOLEAN_FEATURES.filter(f => f.category === cat.key);
            if (items.length === 0) return null;
            return (
              <div key={cat.key} className="rounded-md border border-border/60 bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{cat.label}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                  {items.map(feat => (
                    <label key={feat.key} className="flex items-start gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-primary"
                        checked={flags[feat.key] ?? false}
                        onChange={e => setFlag(feat.key, e.target.checked)}
                      />
                      <span>
                        <span className="font-medium text-foreground">{feat.label}</span>
                        <span className="block text-[11px] text-muted-foreground leading-tight">{feat.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Field label="Marketing copy (one bullet per line, optional)">
        <textarea
          className={inputCls + " min-h-20"}
          value={featuresText}
          onChange={e => setFeaturesText(e.target.value)}
          placeholder="Friendly extra bullets shown beneath the structured features."
        />
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
type SortBy = "name" | "createdAt" | "trialEndsAt" | "planStatus" | "plan";
type SortDir = "asc" | "desc";
const SORT_KEYS: SortBy[] = ["name", "createdAt", "trialEndsAt", "planStatus", "plan"];
const PAGE_SIZES = [20, 50, 100] as const;
type PageSize = (typeof PAGE_SIZES)[number];

interface TenantsUrlState {
  page: number;
  pageSize: PageSize;
  search: string;
  status: string;
  planId: string;
  sortBy: SortBy;
  sortDir: SortDir;
}

function readUrlState(searchStr: string): TenantsUrlState {
  const sp = new URLSearchParams(searchStr);
  const sortByRaw = sp.get("sortBy") ?? "createdAt";
  const sortDirRaw = sp.get("sortDir") ?? "desc";
  const pageSizeRaw = Number(sp.get("pageSize"));
  return {
    page: Math.max(1, Number(sp.get("page")) || 1),
    pageSize: (PAGE_SIZES.includes(pageSizeRaw as PageSize) ? pageSizeRaw : 20) as PageSize,
    search: sp.get("search") ?? "",
    status: sp.get("status") ?? "",
    planId: sp.get("planId") ?? "",
    sortBy: (SORT_KEYS.includes(sortByRaw as SortBy) ? sortByRaw : "createdAt") as SortBy,
    sortDir: sortDirRaw === "asc" ? "asc" : "desc",
  };
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function TenantsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [location, navigate] = useLocation();
  const searchStr = useSearch();
  const initial = useMemo(() => readUrlState(searchStr), []);  // eslint-disable-line react-hooks/exhaustive-deps

  const [page, setPage] = useState<number>(initial.page);
  const [pageSize, setPageSize] = useState<PageSize>(initial.pageSize);
  const [searchInput, setSearchInput] = useState<string>(initial.search);
  const [status, setStatus] = useState<string>(initial.status);
  const [planId, setPlanId] = useState<string>(initial.planId);
  const [sortBy, setSortBy] = useState<SortBy>(initial.sortBy);
  const [sortDir, setSortDir] = useState<SortDir>(initial.sortDir);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [deleting, setDeleting] = useState<Tenant | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300);

  // Reset to page 1 whenever a filter (other than page itself) changes.
  useEffect(() => { setPage(1); }, [debouncedSearch, status, planId, pageSize, sortBy, sortDir]);

  // Serialize the current state into a canonical query string. Used by both
  // the state→URL effect (push) and the URL→state effect (compare/skip).
  const serializeState = useCallback((s: TenantsUrlState): string => {
    const sp = new URLSearchParams();
    if (s.page !== 1) sp.set("page", String(s.page));
    if (s.pageSize !== 20) sp.set("pageSize", String(s.pageSize));
    if (s.search) sp.set("search", s.search);
    if (s.status) sp.set("status", s.status);
    if (s.planId) sp.set("planId", s.planId);
    if (s.sortBy !== "createdAt") sp.set("sortBy", s.sortBy);
    if (s.sortDir !== "desc") sp.set("sortDir", s.sortDir);
    return sp.toString();
  }, []);

  // Push: persist state to the URL so refresh and shared links restore the view.
  useEffect(() => {
    const target = serializeState({ page, pageSize, search: debouncedSearch, status, planId, sortBy, sortDir });
    if (target !== searchStr) navigate(location + (target ? `?${target}` : ""), { replace: true });
  }, [page, pageSize, debouncedSearch, status, planId, sortBy, sortDir, location, searchStr, navigate, serializeState]);

  // Pull: when the URL changes externally (back/forward, deep-link, manual edit),
  // re-hydrate component state. The serialize-and-compare guard prevents the
  // push effect above from racing with this one and creating a feedback loop.
  useEffect(() => {
    const next = readUrlState(searchStr);
    const current: TenantsUrlState = { page, pageSize, search: debouncedSearch, status, planId, sortBy, sortDir };
    if (serializeState(next) === serializeState(current)) return;
    if (next.page !== page) setPage(next.page);
    if (next.pageSize !== pageSize) setPageSize(next.pageSize);
    if (next.search !== searchInput) setSearchInput(next.search);
    if (next.status !== status) setStatus(next.status);
    if (next.planId !== planId) setPlanId(next.planId);
    if (next.sortBy !== sortBy) setSortBy(next.sortBy);
    if (next.sortDir !== sortDir) setSortDir(next.sortDir);
    // We intentionally only depend on `searchStr` so this fires on URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchStr]);

  // Keyboard shortcuts: `/` focuses search, `Esc` clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && document.activeElement === searchRef.current) {
        setSearchInput("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), limit: String(pageSize), sortBy, sortDir });
    if (debouncedSearch) sp.set("search", debouncedSearch);
    if (status) sp.set("status", status);
    if (planId) sp.set("planId", planId);
    return sp.toString();
  }, [page, pageSize, debouncedSearch, status, planId, sortBy, sortDir]);

  const { data: tenantData, isLoading, isFetching, isPlaceholderData } = useQuery<TenantList>({
    queryKey: ["admin", "tenants", queryString],
    queryFn: () => apiFetch(`/tenants?${queryString}`),
    placeholderData: keepPreviousData,
  });

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ["subscription-plans"],
    queryFn: () => apiFetch("/subscription-plans"),
  });

  const tenantsList: Tenant[] = tenantData?.tenants ?? tenantData?.data ?? [];
  const visibleIds = useMemo(() => tenantsList.map((t) => t.id), [tenantsList]);
  const usageKey = visibleIds.slice().sort((a, b) => a - b).join(",");

  const { data: usageMap = {} } = useQuery<Record<number, TenantUsage>>({
    queryKey: ["admin", "tenant-usage", usageKey],
    queryFn: () => apiFetch(`/admin/tenant-usage?ids=${usageKey}`),
    enabled: visibleIds.length > 0,
    placeholderData: keepPreviousData,
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

  const tenants = tenantsList;
  const total = tenantData?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(total, page * pageSize);
  const hasFilters = !!(debouncedSearch || status || planId);
  const isBackgroundFetching = isFetching && isPlaceholderData;

  const clearFilters = useCallback(() => {
    setSearchInput("");
    setStatus("");
    setPlanId("");
  }, []);

  const toggleSort = useCallback((col: SortBy) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      // Sensible default direction per column: text/status asc, dates desc.
      setSortDir(col === "name" || col === "planStatus" || col === "plan" ? "asc" : "desc");
    }
  }, [sortBy]);

  const sortIcon = (col: SortBy) => {
    if (sortBy !== col) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  const SortableTh = ({ col, label, align = "left" }: { col: SortBy; label: string; align?: "left" | "right" }) => (
    <th className={`px-6 py-3 font-medium text-muted-foreground text-${align}`}>
      <button
        type="button"
        onClick={() => toggleSort(col)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${sortBy === col ? "text-foreground" : ""}`}
        aria-sort={sortBy === col ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      >
        {label}{sortIcon(col)}
      </button>
    </th>
  );

  return (
    <div className="bg-card border border-border rounded-xl">
      <div className="px-6 py-4 border-b border-border flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-foreground">All Tenants</h2>
          <span className="text-xs text-muted-foreground">({total.toLocaleString()} total)</span>
          {isBackgroundFetching && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" aria-label="Refreshing" />}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              className={inputCls + " pl-7 pr-7 w-56 py-1.5"}
              placeholder="Search name, slug, owner email…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              aria-label="Search tenants"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <select className={inputCls + " py-1.5 w-32"} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All status</option>
            <option value="trial">Trial</option><option value="active">Active</option>
            <option value="expired">Expired</option><option value="cancelled">Cancelled</option>
            <option value="suspended">Suspended</option>
          </select>
          <select className={inputCls + " py-1.5 w-36"} value={planId} onChange={e => setPlanId(e.target.value)}>
            <option value="">All plans</option>
            {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {hasFilters && (
            <Button size="sm" variant="ghost" onClick={clearFilters} className="gap-1 text-xs">
              <X className="w-3 h-3" />Clear filters
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["admin"] })} className="gap-1" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1"><Plus className="w-3.5 h-3.5" />New tenant</Button>
        </div>
      </div>

      {isLoading && tenants.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground">Loading tenants…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <SortableTh col="name" label="Tenant" />
                <SortableTh col="planStatus" label="Status" />
                <SortableTh col="plan" label="Plan & Limits" />
                <SortableTh col="trialEndsAt" label="Trial" />
                <SortableTh col="createdAt" label="Joined" />
                <th className="px-6 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y divide-border ${isBackgroundFetching ? "opacity-70 transition-opacity" : ""}`}>
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
              {tenants.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                    {hasFilters ? (
                      <div className="space-y-2">
                        <p>No tenants match your filters.</p>
                        <Button size="sm" variant="outline" onClick={clearFilters} className="gap-1">
                          <X className="w-3 h-3" />Clear filters
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p>No tenants yet.</p>
                        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1">
                          <Plus className="w-3 h-3" />Create the first tenant
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-6 py-3 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>{total === 0 ? "No tenants" : `Showing ${showingFrom.toLocaleString()}–${showingTo.toLocaleString()} of ${total.toLocaleString()}`}</span>
          <label className="flex items-center gap-1">
            <span>Rows per page</span>
            <select
              className="border border-border rounded px-1.5 py-0.5 bg-background text-foreground"
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value) as PageSize)}
            >
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <span>Page {page} of {pageCount}</span>
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</Button>
          <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>Next</Button>
        </div>
      </div>

      {createOpen && <TenantModal tenant={null} plans={plans} onClose={() => setCreateOpen(false)} onSaved={() => qc.invalidateQueries({ queryKey: ["admin"] })} />}
      {editing && <TenantModal tenant={editing} plans={plans} onClose={() => setEditing(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["admin"] })} />}
      {deleting && <DeleteTenantModal tenant={deleting} onClose={() => setDeleting(null)} onDeleted={() => qc.invalidateQueries({ queryKey: ["admin"] })} />}
    </div>
  );
}

export default function AdminPage() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<"tenants" | "plans" | "payment_methods" | "approvals" | "coupons" | "notifications" | "sms" | "email" | "maintenance" | "whatsapp">("tenants");

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
            <a href="/admin/system-health">
              <Button variant="outline" size="sm" className="gap-2">
                <Activity className="w-4 h-4" /> System Health
              </Button>
            </a>
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-foreground">{user.name}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end"><Mail className="w-3 h-3" />{user.email}</p>
            </div>
            <Link href="/admin/audit-logs">
              <Button variant="outline" size="sm" className="gap-2">
                <Activity className="w-4 h-4" /> Audit Logs
              </Button>
            </Link>
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
            { id: "payment_methods" as const, label: "Payment Methods", icon: CreditCard },
            { id: "approvals" as const, label: "Approvals", icon: FileCheck2 },
            { id: "coupons" as const, label: "Coupons", icon: Tag },
            { id: "notifications" as const, label: "Notifications", icon: Megaphone },
            { id: "sms" as const, label: "SMS", icon: MessageSquare },
            { id: "email" as const, label: "Email", icon: Mail },
            { id: "maintenance" as const, label: "System Maintenance", icon: Wrench },
            { id: "whatsapp" as const, label: "WhatsApp", icon: MessageCircle },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 ${
                tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              <t.icon className="w-4 h-4" />{t.label}
            </button>
          ))}
        </div>

        {tab === "tenants" && <TenantsTab />}
        {tab === "plans" && <PlansTab />}
        {tab === "payment_methods" && <PaymentMethodsTab />}
        {tab === "approvals" && <ApprovalsTab />}
        {tab === "coupons" && <CouponsTab />}
        {tab === "notifications" && <AdminNotificationCenter />}
        {tab === "sms" && <AdminSmsTab />}
        {tab === "email" && <AdminEmail />}
        {tab === "maintenance" && <AdminMaintenance />}
        {tab === "whatsapp" && <AdminWhatsAppTab />}
      </main>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Payment methods (super-admin)
// ────────────────────────────────────────────────────────────────
const PROVIDER_LABEL: Record<string, { title: string; subtitle: string; icon: typeof CreditCard }> = {
  cashfree: { title: "Cashfree",  subtitle: "Online checkout (UPI, cards, netbanking)", icon: CreditCard },
  razorpay: { title: "Razorpay",  subtitle: "Online checkout (UPI, cards, netbanking)", icon: CreditCard },
  bank:     { title: "Bank transfer", subtitle: "Manual — tenant submits proof of transfer", icon: Landmark },
  upi:      { title: "UPI",       subtitle: "Manual — tenant pays to your UPI ID and submits reference", icon: Smartphone },
};

function PaymentMethodsTab() {
  const { data, isLoading } = useAdminPaymentMethods();
  if (isLoading || !data) return <div className="p-8 text-center text-muted-foreground text-sm">Loading payment methods…</div>;
  return (
    <div className="space-y-4">
      <div className="bg-muted/30 border border-border rounded-xl p-4 text-sm text-muted-foreground">
        Configure the payment methods tenants can use to pay for their subscription. Online providers (Cashfree, Razorpay) collect payments automatically. Bank and UPI are reviewed manually under <strong>Approvals</strong>.
      </div>
      <div className="grid gap-4">
        {data.providers.map(p => <ProviderCard key={p.provider} row={p} />)}
      </div>
    </div>
  );
}

function ProviderCard({ row }: { row: PaymentProviderRow }) {
  const { toast } = useToast();
  const update = useUpdateAdminPaymentMethod();
  const meta = PROVIDER_LABEL[row.provider];
  const Icon = meta?.icon ?? CreditCard;
  const [editing, setEditing] = useState(false);

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0"><Icon className="w-5 h-5 text-primary" /></div>
          <div className="min-w-0">
            <p className="font-semibold text-foreground capitalize flex items-center gap-2">
              {meta?.title ?? row.provider}
              {row.isDefault && <Badge className="text-[10px]">Default</Badge>}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{meta?.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            size="sm"
            variant={row.isEnabled ? "outline" : "default"}
            onClick={() =>
              update.mutate({ provider: row.provider, isEnabled: !row.isEnabled }, {
                onSuccess: () => toast({ title: row.isEnabled ? "Disabled" : "Enabled" }),
                onError: e => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
              })
            }
            disabled={update.isPending}
          >
            {row.isEnabled ? "Disable" : "Enable"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(e => !e)}>
            {editing ? "Close" : "Configure"}
          </Button>
        </div>
      </div>

      {editing && (
        <ProviderConfigForm
          row={row}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); toast({ title: "Saved" }); }}
        />
      )}
    </div>
  );
}

function ProviderConfigForm({ row, onClose, onSaved }: { row: PaymentProviderRow; onClose: () => void; onSaved: () => void }) {
  const update = useUpdateAdminPaymentMethod();
  const { toast } = useToast();
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row.config ?? {})) out[k] = typeof v === "string" ? v : "";
    return out;
  });
  const [isDefault, setIsDefault] = useState(row.isDefault);

  function save() {
    update.mutate({ provider: row.provider, isEnabled: row.isEnabled, isDefault, config }, {
      onSuccess: () => onSaved(),
      onError: e => toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" }),
    });
  }

  function field(key: string, label: string, opts: { type?: string; placeholder?: string; help?: string } = {}) {
    return (
      <div className="space-y-1.5" key={key}>
        <Label htmlFor={`${row.provider}-${key}`}>{label}</Label>
        <Input
          id={`${row.provider}-${key}`}
          type={opts.type ?? "text"}
          value={config[key] ?? ""}
          onChange={e => setConfig(c => ({ ...c, [key]: e.target.value }))}
          placeholder={opts.placeholder}
        />
        {opts.help && <p className="text-xs text-muted-foreground">{opts.help}</p>}
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-border space-y-4">
      {row.provider === "cashfree" && (
        <div className="space-y-3">
          {field("appId", "App ID", { placeholder: "TEST00000000…" })}
          {field("secretKey", "Secret key", { type: "password", placeholder: "Leave masked value to keep current" })}
          <div className="space-y-1.5">
            <Label htmlFor="cashfree-env">Environment</Label>
            <select id="cashfree-env" value={config.env ?? "sandbox"} onChange={e => setConfig(c => ({ ...c, env: e.target.value }))}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </select>
          </div>
        </div>
      )}
      {row.provider === "razorpay" && (
        <div className="space-y-3">
          {field("keyId", "Key ID", { placeholder: "rzp_test_…" })}
          {field("keySecret", "Key Secret", { type: "password", placeholder: "Leave masked value to keep current" })}
          {field("webhookSecret", "Webhook secret", { type: "password", help: "Used to verify webhooks at /api/razorpay/webhook" })}
        </div>
      )}
      {row.provider === "bank" && (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            {field("bankName", "Bank name", { placeholder: "HDFC Bank" })}
            {field("accountHolder", "Account holder", { placeholder: "Khana Lagao Pvt Ltd" })}
            {field("accountNumber", "Account number", { placeholder: "1234567890" })}
            {field("ifsc", "IFSC code", { placeholder: "HDFC0001234" })}
            {field("branch", "Branch")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank-instructions">Instructions for tenants</Label>
            <Textarea id="bank-instructions" rows={3} value={config.instructions ?? ""} onChange={e => setConfig(c => ({ ...c, instructions: e.target.value }))}
              placeholder="e.g. Please add your tenant ID in the transfer narration." />
          </div>
        </div>
      )}
      {row.provider === "upi" && (
        <div className="space-y-3">
          {field("upiId", "UPI ID (VPA)", { placeholder: "khanalagao@hdfcbank" })}
          {field("payeeName", "Payee name", { placeholder: "Khana Lagao Pvt Ltd" })}
          <div className="space-y-1.5">
            <ImageUploadField
              label="UPI QR code (upload or paste URL)"
              value={config.qrUrl ?? ""}
              onChange={(url) => setConfig(c => ({ ...c, qrUrl: url }))}
            />
            <p className="text-[11px] text-muted-foreground">Shown to tenants on checkout. Upload a PNG/JPG generated from your UPI ID, or paste a hosted image URL.</p>
          </div>
        </div>
      )}

      {(row.provider === "cashfree" || row.provider === "razorpay") && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
          Use as the default online provider (only one can be default).
        </label>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={update.isPending}>{update.isPending ? "Saving…" : "Save"}</Button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Manual payment approvals (super-admin)
// ────────────────────────────────────────────────────────────────
function ApprovalsTab() {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const { data, isLoading, refetch } = useAdminManualPayments(status);
  const approve = useApproveManualPayment();
  const reject = useRejectManualPayment();
  const { toast } = useToast();

  const rows = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {(["pending", "approved", "rejected", "all"] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors capitalize ${
              status === s ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:text-foreground"
            }`}
          >{s}</button>
        ))}
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="ml-auto">
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
        </Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading manual payments…</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">No {status === "all" ? "" : status} manual payments.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="px-5 py-3 text-left">Tenant</th>
                <th className="px-5 py-3 text-left">Plan</th>
                <th className="px-5 py-3 text-left">Method</th>
                <th className="px-5 py-3 text-left">Amount</th>
                <th className="px-5 py-3 text-left">Reference</th>
                <th className="px-5 py-3 text-left">Submitted</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: AdminManualPaymentRow) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-5 py-3"><div className="font-medium text-foreground">{r.tenantName ?? `Tenant #${r.tenantId}`}</div><div className="text-xs text-muted-foreground">{r.submittedByName}</div></td>
                  <td className="px-5 py-3">{r.planName ?? `#${r.planId}`}</td>
                  <td className="px-5 py-3 capitalize">{r.method}</td>
                  <td className="px-5 py-3 font-medium">{r.currency} {Number(r.amount).toLocaleString()}</td>
                  <td className="px-5 py-3">
                    <div className="font-mono text-xs">{r.reference ?? "—"}</div>
                    {r.proofUrl && <a href={r.proofUrl} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1 mt-1"><ExternalLink className="w-3 h-3" />Proof</a>}
                    {r.note && <div className="text-xs text-muted-foreground mt-1 max-w-xs">{r.note}</div>}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="px-5 py-3">
                    {r.status === "pending" && <Badge variant="outline">Pending</Badge>}
                    {r.status === "approved" && <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30">Approved</Badge>}
                    {r.status === "rejected" && <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30">Rejected</Badge>}
                    {r.reviewerNote && <div className="text-xs text-muted-foreground mt-1 max-w-xs">{r.reviewerNote}</div>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {r.status === "pending" ? (
                      <div className="flex flex-wrap gap-2 justify-end">
                        <Button
                          size="sm"
                          onClick={() => approve.mutate({ id: r.id }, {
                            onSuccess: () => toast({ title: "Approved", description: `${r.tenantName ?? "Tenant"} activated on ${r.planName ?? "plan"}.` }),
                            onError: (e) => toast({ title: "Approve failed", description: (e as Error).message, variant: "destructive" }),
                          })}
                          disabled={approve.isPending}
                        >Approve</Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive"
                          onClick={() => {
                            const reason = window.prompt("Reason for rejection:");
                            if (!reason) return;
                            reject.mutate({ id: r.id, reason }, {
                              onSuccess: () => toast({ title: "Rejected" }),
                              onError: (e) => toast({ title: "Reject failed", description: (e as Error).message, variant: "destructive" }),
                            });
                          }}
                          disabled={reject.isPending}
                        >Reject</Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Coupons / Promo codes (super-admin)
// ────────────────────────────────────────────────────────────────
const COUPON_TYPE_LABEL: Record<string, string> = {
  flat: "Flat amount off",
  percent: "Percent off",
  trial_extension: "Trial extension (days)",
  first_month: "First-month % off",
  lifetime: "Lifetime % off",
};

interface CouponRow {
  id: number;
  code: string;
  discountType: "flat" | "percent" | "trial_extension" | "first_month" | "lifetime";
  discountValue: string;
  maxUsage: number | null;
  usedCount: number;
  validFrom: string | null;
  validUntil: string | null;
  applicablePlanIds: number[];
  applicableTenantIds: number[];
  status: "active" | "inactive";
  notes: string | null;
  effectiveStatus: "active" | "inactive" | "expired" | "exhausted" | "scheduled" | "deleted";
  createdAt: string;
}

interface CouponRedemption {
  id: number;
  couponId: number;
  tenantId: number;
  tenantName: string | null;
  planId: number | null;
  planName: string | null;
  paymentId: number | null;
  manualRequestId: number | null;
  discountApplied: string;
  trialDaysAdded: number | null;
  context: string;
  redeemedBy: number | null;
  redeemedByName: string | null;
  redeemedAt: string;
}

function formatCouponValue(c: Pick<CouponRow, "discountType" | "discountValue">): string {
  const v = Number(c.discountValue);
  switch (c.discountType) {
    case "flat": return `${v.toLocaleString()} off`;
    case "percent": return `${v}% off`;
    case "trial_extension": return `+${v} day${v === 1 ? "" : "s"} trial`;
    case "first_month": return `${v}% off (first cycle)`;
    case "lifetime": return `${v}% off (lifetime)`;
    default: return String(v);
  }
}

function effectiveStatusBadge(s: CouponRow["effectiveStatus"]) {
  switch (s) {
    case "active": return <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30">Active</Badge>;
    case "inactive": return <Badge variant="outline">Inactive</Badge>;
    case "scheduled": return <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30">Scheduled</Badge>;
    case "expired": return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">Expired</Badge>;
    case "exhausted": return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">Exhausted</Badge>;
    case "deleted": return <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30">Deleted</Badge>;
  }
}

function CouponsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | CouponRow["discountType"]>("all");
  const [editing, setEditing] = useState<CouponRow | null | "new">(null);
  const [redemptionsFor, setRedemptionsFor] = useState<CouponRow | null>(null);

  const { data, isLoading } = useQuery<{ data: CouponRow[] }>({
    queryKey: ["admin", "coupons", search, statusFilter, typeFilter],
    queryFn: () => apiFetch(`/admin/coupons?search=${encodeURIComponent(search)}&status=${statusFilter}&discountType=${typeFilter}`),
  });
  const { data: plansData } = useQuery<{ plans?: Plan[]; data?: Plan[] }>({
    queryKey: ["admin", "plans-list"],
    queryFn: () => apiFetch("/admin/plans"),
  });
  const plans = (plansData?.plans ?? plansData?.data ?? []) as Plan[];

  const toggle = useMutation({
    mutationFn: (id: number) => apiAction(`/admin/coupons/${id}/toggle`, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "coupons"] }),
  });
  const duplicate = useMutation({
    mutationFn: (id: number) => apiAction(`/admin/coupons/${id}/duplicate`, "POST"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "coupons"] }); toast({ title: "Coupon duplicated", description: "A draft copy was created (inactive)." }); },
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiAction(`/admin/coupons/${id}`, "DELETE"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "coupons"] }); toast({ title: "Coupon deleted" }); },
  });

  const rows = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code or notes…" className="pl-9 w-64" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)} className="text-sm border border-border rounded-md px-2 py-1.5 bg-card">
          <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as typeof typeFilter)} className="text-sm border border-border rounded-md px-2 py-1.5 bg-card">
          <option value="all">All types</option>
          {(Object.keys(COUPON_TYPE_LABEL) as Array<keyof typeof COUPON_TYPE_LABEL>).map(k => (<option key={k} value={k}>{COUPON_TYPE_LABEL[k]}</option>))}
        </select>
        <Button className="ml-auto" onClick={() => setEditing("new")}><Plus className="w-4 h-4 mr-1" /> New coupon</Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading coupons…</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">No coupons match your filters. Click <strong>New coupon</strong> to create one.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="px-5 py-3 text-left">Code</th>
                <th className="px-5 py-3 text-left">Type / value</th>
                <th className="px-5 py-3 text-left">Used</th>
                <th className="px-5 py-3 text-left">Validity</th>
                <th className="px-5 py-3 text-left">Restrictions</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id} className="border-t border-border align-top">
                  <td className="px-5 py-3"><div className="font-mono font-semibold text-foreground">{c.code}</div>{c.notes && <div className="text-xs text-muted-foreground max-w-xs">{c.notes}</div>}</td>
                  <td className="px-5 py-3">
                    <div className="text-xs text-muted-foreground">{COUPON_TYPE_LABEL[c.discountType]}</div>
                    <div className="font-medium">{formatCouponValue(c)}</div>
                  </td>
                  <td className="px-5 py-3 text-xs">{c.usedCount}{c.maxUsage != null ? ` / ${c.maxUsage}` : ""}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {c.validFrom ? <div>From {new Date(c.validFrom).toLocaleDateString()}</div> : <div>From — anytime</div>}
                    {c.validUntil ? <div>Until {new Date(c.validUntil).toLocaleDateString()}</div> : <div>No expiry</div>}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    <div>{c.applicablePlanIds.length === 0 ? "All plans" : `${c.applicablePlanIds.length} plan(s)`}</div>
                    <div>{c.applicableTenantIds.length === 0 ? "All tenants" : `${c.applicableTenantIds.length} tenant(s)`}</div>
                  </td>
                  <td className="px-5 py-3">{effectiveStatusBadge(c.effectiveStatus)}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setRedemptionsFor(c)} title="Redemption history"><History className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(c)} title="Edit"><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => duplicate.mutate(c.id)} disabled={duplicate.isPending} title="Duplicate"><Copy className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => toggle.mutate(c.id)} disabled={toggle.isPending} title={c.status === "active" ? "Deactivate" : "Activate"}>
                        {c.status === "active" ? <Ban className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (confirm(`Delete coupon ${c.code}? This soft-deletes it; existing redemptions are preserved.`)) remove.mutate(c.id); }} title="Delete"><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <CouponEditor
          coupon={editing === "new" ? null : editing}
          plans={plans}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["admin", "coupons"] }); }}
        />
      )}
      {redemptionsFor && (
        <CouponRedemptionsModal coupon={redemptionsFor} onClose={() => setRedemptionsFor(null)} />
      )}
    </div>
  );
}

function CouponEditor({ coupon, plans, onClose, onSaved }: { coupon: CouponRow | null; plans: Plan[]; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!coupon;
  const { toast } = useToast();
  const [code, setCode] = useState(coupon?.code ?? "");
  const [discountType, setDiscountType] = useState<CouponRow["discountType"]>(coupon?.discountType ?? "percent");
  const [discountValue, setDiscountValue] = useState(coupon?.discountValue ?? "10");
  const [maxUsage, setMaxUsage] = useState<string>(coupon?.maxUsage != null ? String(coupon.maxUsage) : "");
  const [validFrom, setValidFrom] = useState(coupon?.validFrom ? coupon.validFrom.slice(0, 10) : "");
  const [validUntil, setValidUntil] = useState(coupon?.validUntil ? coupon.validUntil.slice(0, 10) : "");
  const [applicablePlanIds, setApplicablePlanIds] = useState<number[]>(coupon?.applicablePlanIds ?? []);
  const [applicableTenantIds, setApplicableTenantIds] = useState<string>(
    (coupon?.applicableTenantIds ?? []).join(", "),
  );
  const [status, setStatus] = useState<"active" | "inactive">(coupon?.status ?? "active");
  const [notes, setNotes] = useState(coupon?.notes ?? "");
  const [busy, setBusy] = useState(false);

  function togglePlan(id: number) {
    setApplicablePlanIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function save() {
    setBusy(true);
    try {
      const tenantIds = applicableTenantIds.split(",").map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0);
      const body: Record<string, unknown> = {
        code: code.trim().toUpperCase(),
        discountType,
        discountValue: Number(discountValue),
        maxUsage: maxUsage.trim() === "" ? null : Number(maxUsage),
        validFrom: validFrom || null,
        validUntil: validUntil || null,
        applicablePlanIds,
        applicableTenantIds: tenantIds,
        status,
        notes: notes.trim() || null,
      };
      if (isEdit) {
        await apiAction(`/admin/coupons/${coupon!.id}`, "PATCH", body);
        toast({ title: "Coupon updated" });
      } else {
        await apiAction(`/admin/coupons`, "POST", body);
        toast({ title: "Coupon created" });
      }
      onSaved();
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="font-semibold text-lg">{isEdit ? `Edit ${coupon!.code}` : "New coupon"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5 sm:col-span-1">
            <Label>Code</Label>
            <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="WELCOME10" className="font-mono uppercase" />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <select value={discountType} onChange={e => setDiscountType(e.target.value as CouponRow["discountType"])} className="text-sm border border-border rounded-md px-2 py-2 bg-card w-full">
              {(Object.keys(COUPON_TYPE_LABEL) as Array<keyof typeof COUPON_TYPE_LABEL>).map(k => (<option key={k} value={k}>{COUPON_TYPE_LABEL[k]}</option>))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>{discountType === "trial_extension" ? "Days to add" : discountType === "flat" ? "Amount off" : "Percent off"}</Label>
            <Input type="number" inputMode="decimal" min="0" step={discountType === "trial_extension" ? "1" : "0.01"} value={discountValue} onChange={e => setDiscountValue(e.target.value)} />
            <p className="text-xs text-muted-foreground">{discountType === "percent" || discountType === "first_month" || discountType === "lifetime" ? "Capped at 100." : discountType === "flat" ? "Amount in the plan's currency." : "Days added to the tenant's trial."}</p>
          </div>
          <div className="space-y-1.5">
            <Label>Max usage</Label>
            <Input type="number" inputMode="numeric" min="0" step="1" value={maxUsage} onChange={e => setMaxUsage(e.target.value)} placeholder="Unlimited" />
          </div>
          <div className="space-y-1.5">
            <Label>Valid from</Label>
            <Input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Valid until</Label>
            <Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Applicable plans</Label>
            <div className="flex flex-wrap gap-1.5">
              {plans.length === 0 && <p className="text-xs text-muted-foreground">No plans available.</p>}
              {plans.map(p => {
                const sel = applicablePlanIds.includes(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => togglePlan(p.id)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${sel ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:text-foreground"}`}>
                    {p.name}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Leave none selected to apply to <strong>all plans</strong>.</p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Restrict to tenants (IDs, comma-separated)</Label>
            <Input value={applicableTenantIds} onChange={e => setApplicableTenantIds(e.target.value)} placeholder="e.g. 12, 34, 56 — leave blank for all tenants" />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <select value={status} onChange={e => setStatus(e.target.value as "active" | "inactive")} className="text-sm border border-border rounded-md px-2 py-2 bg-card w-full">
              <option value="active">Active</option><option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Internal notes (not shown to tenants)</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || !code.trim()}>{busy ? "Saving…" : isEdit ? "Save changes" : "Create coupon"}</Button>
        </div>
      </div>
    </div>
  );
}

function CouponRedemptionsModal({ coupon, onClose }: { coupon: CouponRow; onClose: () => void }) {
  const { data, isLoading } = useQuery<{ data: CouponRedemption[] }>({
    queryKey: ["admin", "coupons", coupon.id, "redemptions"],
    queryFn: () => apiFetch(`/admin/coupons/${coupon.id}/redemptions`),
  });
  const rows = data?.data ?? [];
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="font-semibold text-lg">Redemptions for <span className="font-mono">{coupon.code}</span></h3>
            <p className="text-xs text-muted-foreground">{coupon.usedCount} redemption{coupon.usedCount === 1 ? "" : "s"}{coupon.maxUsage != null ? ` of ${coupon.maxUsage}` : ""}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground text-center">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">This coupon hasn't been redeemed yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left">Tenant</th>
                  <th className="px-3 py-2 text-left">Plan</th>
                  <th className="px-3 py-2 text-left">Discount</th>
                  <th className="px-3 py-2 text-left">Context</th>
                  <th className="px-3 py-2 text-left">Redeemed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">{r.tenantName ?? `#${r.tenantId}`}</td>
                    <td className="px-3 py-2">{r.planName ?? (r.planId ? `#${r.planId}` : "—")}</td>
                    <td className="px-3 py-2">
                      {r.trialDaysAdded ? `+${r.trialDaysAdded} day${r.trialDaysAdded === 1 ? "" : "s"}` : Number(r.discountApplied).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground capitalize">{r.context.replace("_", " ")}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      <div>{new Date(r.redeemedAt).toLocaleString()}</div>
                      {r.redeemedByName && <div className="text-[10px]">by {r.redeemedByName}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
