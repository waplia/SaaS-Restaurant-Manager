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
  Tag, Copy, History, Calendar, Brain, Download,
} from "lucide-react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import AdminNotificationCenter from "./admin-notifications";
import AdminSmsTab from "./admin-sms";
import AdminEmail from "./admin-email";
import AdminMaintenance from "./admin-maintenance";
import AdminWhatsAppTab from "./admin-whatsapp";
import AdminAiTab from "./admin-ai";
import AdminMetricsTab from "./admin-metrics";
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
  PLAN_NUMERIC_FEATURES,
  defaultFeatureFlags, isFeatureEnabled, getFeatureNumber,
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
  yearlyPrice?: string | null;
  stripeMonthlyPriceId?: string | null;
  stripeYearlyPriceId?: string | null;
  cashfreeMonthlyPlanId?: string | null;
  cashfreeYearlyPlanId?: string | null;
  maxRestaurants: number;
  maxBranches: number;
  maxStaff: number;
  maxTables: number;
  maxMenuItems: number;
  trialDays: number;
  features: string[];
  featureFlags: Record<string, boolean> | null;
  isActive: boolean;
  aiEnabled?: boolean;
  aiMonthlyIncludedCredits?: number;
  aiDailyRequestCap?: number;
  aiPerFeatureMonthlyCaps?: Record<string, number> | null;
  aiFeatureToggles?: Record<string, boolean> | null;
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
        <div>
          <ImageUploadField label="Logo (optional)" value={form.logoUrl} onChange={(v) => setForm({ ...form, logoUrl: v })} compact />
        </div>
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
interface TenantPaymentRow {
  id: number; planId: number; planName: string | null;
  amount: string; currency: string; provider: string; externalRef: string | null;
  manualRequestId: number | null;
  periodStart: string | null; periodEnd: string | null;
  status: string; discountApplied: string | null;
  couponCode: string | null;
  createdAt: string;
}
interface TenantManualRequestRow {
  id: number; planId: number; planName: string | null;
  amount: string; currency: string; method: string;
  reference: string | null; proofUrl: string | null; note: string | null;
  status: string; reviewerNote: string | null; reviewedAt: string | null;
  createdAt: string;
}
interface TenantBillingPayload {
  tenant: { id: number; name: string; slug: string; planId: number | null; planStatus: string; trialEndsAt: string | null; subscriptionStartedAt: string | null; subscriptionEndsAt: string | null };
  plan: Plan | null;
  payments: TenantPaymentRow[];
  manualRequests: TenantManualRequestRow[];
}

function fmtMoney(amount: string, currency: string) {
  const sym = (currency ?? "INR").toUpperCase() === "USD" ? "$" : "₹";
  const n = Number(amount);
  return `${sym}${Number.isFinite(n) ? n.toLocaleString("en-IN") : amount}`;
}
function fmtDateTime(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
}

function TenantBillingModal({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<TenantBillingPayload>({
    queryKey: ["admin", "tenant-billing", tenant.id],
    queryFn: () => apiFetch(`/admin/tenants/${tenant.id}/payments`),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => apiAction(`/admin/manual-payments/${id}/approve`, "POST", {}),
    onSuccess: () => {
      toast({ title: "Payment approved", description: "The tenant's subscription has been activated." });
      qc.invalidateQueries({ queryKey: ["admin", "tenant-billing", tenant.id] });
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: Error) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiAction(`/admin/manual-payments/${id}/reject`, "POST", { reason }),
    onSuccess: () => {
      toast({ title: "Payment rejected", description: "The tenant has been notified." });
      qc.invalidateQueries({ queryKey: ["admin", "tenant-billing", tenant.id] });
    },
    onError: (e: Error) => toast({ title: "Rejection failed", description: e.message, variant: "destructive" }),
  });
  const handleReject = (id: number) => {
    const reason = window.prompt("Reason for rejection (will be shown to the tenant):");
    if (!reason || !reason.trim()) return;
    rejectMutation.mutate({ id, reason: reason.trim() });
  };
  return (
    <Modal title={`Billing · ${tenant.name}`} onClose={onClose} wide>
      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="text-sm text-destructive">Failed to load: {(error as Error).message}</div>}
      {data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-muted/30 rounded p-3">
              <p className="text-muted-foreground">Plan</p>
              <p className="font-medium text-foreground">{data.plan?.name ?? "No plan"}</p>
              {data.plan && <p className="text-muted-foreground">{fmtPrice(data.plan)}</p>}
            </div>
            <div className="bg-muted/30 rounded p-3">
              <p className="text-muted-foreground">Status</p>
              <p className="font-medium text-foreground capitalize">{data.tenant.planStatus}</p>
              <p className="text-muted-foreground">
                {data.tenant.subscriptionEndsAt
                  ? `Renews ${fmtDateTime(data.tenant.subscriptionEndsAt)}`
                  : data.tenant.trialEndsAt
                    ? `Trial ends ${fmtDateTime(data.tenant.trialEndsAt)}`
                    : "—"}
              </p>
            </div>
          </div>

          <section>
            <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <CreditCard className="w-4 h-4" /> Payment history ({data.payments.length})
            </h4>
            {data.payments.length === 0 ? (
              <p className="text-xs text-muted-foreground">No payments recorded.</p>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left p-2 font-medium text-muted-foreground">Date</th>
                      <th className="text-left p-2 font-medium text-muted-foreground">Plan</th>
                      <th className="text-left p-2 font-medium text-muted-foreground">Provider</th>
                      <th className="text-left p-2 font-medium text-muted-foreground">Reference</th>
                      <th className="text-left p-2 font-medium text-muted-foreground">Period</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">Amount</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">Discount</th>
                      <th className="text-left p-2 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p.id} className="border-t border-border">
                        <td className="p-2 text-muted-foreground whitespace-nowrap">{fmtDateTime(p.createdAt)}</td>
                        <td className="p-2 text-foreground">{p.planName ?? `#${p.planId}`}</td>
                        <td className="p-2 capitalize text-muted-foreground">{p.provider}</td>
                        <td className="p-2 text-muted-foreground font-mono text-[11px] break-all">{p.externalRef ?? (p.manualRequestId ? `manual #${p.manualRequestId}` : "—")}</td>
                        <td className="p-2 text-muted-foreground whitespace-nowrap">
                          {p.periodStart && p.periodEnd
                            ? `${new Date(p.periodStart).toLocaleDateString()} → ${new Date(p.periodEnd).toLocaleDateString()}`
                            : "—"}
                        </td>
                        <td className="p-2 text-right tabular-nums text-foreground">{fmtMoney(p.amount, p.currency)}</td>
                        <td className="p-2 text-right tabular-nums text-muted-foreground">
                          {p.discountApplied && Number(p.discountApplied) > 0 ? fmtMoney(p.discountApplied, p.currency) : "—"}
                          {p.couponCode && <div className="text-[10px] uppercase mt-0.5 text-primary">{p.couponCode}</div>}
                        </td>
                        <td className="p-2"><Badge variant={p.status === "succeeded" ? "default" : "secondary"}>{p.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <Landmark className="w-4 h-4" /> Manual payment requests ({data.manualRequests.length})
            </h4>
            {data.manualRequests.length === 0 ? (
              <p className="text-xs text-muted-foreground">No manual requests.</p>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left p-2 font-medium text-muted-foreground">Date</th>
                      <th className="text-left p-2 font-medium text-muted-foreground">Plan</th>
                      <th className="text-left p-2 font-medium text-muted-foreground">Method</th>
                      <th className="text-left p-2 font-medium text-muted-foreground">Reference</th>
                      <th className="text-left p-2 font-medium text-muted-foreground">Proof</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">Amount</th>
                      <th className="text-left p-2 font-medium text-muted-foreground">Status</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.manualRequests.map((r) => (
                      <tr key={r.id} className="border-t border-border align-top">
                        <td className="p-2 text-muted-foreground whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                        <td className="p-2 text-foreground">{r.planName ?? `#${r.planId}`}</td>
                        <td className="p-2 uppercase text-muted-foreground">{r.method}</td>
                        <td className="p-2 text-muted-foreground font-mono text-[11px] break-all">
                          {r.reference ?? "—"}
                          {r.note && <div className="text-[10px] mt-0.5 italic">"{r.note}"</div>}
                          {r.reviewerNote && <div className="text-[10px] mt-0.5 text-destructive">Reviewer: {r.reviewerNote}</div>}
                        </td>
                        <td className="p-2">
                          {r.proofUrl ? (
                            <a href={r.proofUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                              <ExternalLink className="w-3 h-3" /> View
                            </a>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="p-2 text-right tabular-nums text-foreground">{fmtMoney(r.amount, r.currency)}</td>
                        <td className="p-2">
                          <Badge variant={r.status === "approved" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}>
                            {r.status}
                          </Badge>
                          {r.reviewedAt && <div className="text-[10px] text-muted-foreground mt-0.5">{fmtDateTime(r.reviewedAt)}</div>}
                        </td>
                        <td className="p-2 text-right whitespace-nowrap">
                          {r.status === "pending" ? (
                            <div className="inline-flex gap-1">
                              <Button
                                size="sm" variant="default"
                                disabled={approveMutation.isPending || rejectMutation.isPending}
                                onClick={() => approveMutation.mutate(r.id)}
                                data-testid={`btn-approve-manual-${r.id}`}
                              >Approve</Button>
                              <Button
                                size="sm" variant="outline"
                                disabled={approveMutation.isPending || rejectMutation.isPending}
                                onClick={() => handleReject(r.id)}
                                data-testid={`btn-reject-manual-${r.id}`}
                              >Reject</Button>
                            </div>
                          ) : <span className="text-muted-foreground text-[11px]">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

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
    yearlyPrice: plan?.yearlyPrice ?? "",
    stripeMonthlyPriceId: plan?.stripeMonthlyPriceId ?? "",
    stripeYearlyPriceId: plan?.stripeYearlyPriceId ?? "",
    cashfreeMonthlyPlanId: plan?.cashfreeMonthlyPlanId ?? "",
    cashfreeYearlyPlanId: plan?.cashfreeYearlyPlanId ?? "",
    maxRestaurants: plan?.maxRestaurants ?? 1,
    maxBranches: plan?.maxBranches ?? 1,
    maxStaff: plan?.maxStaff ?? 5,
    maxTables: plan?.maxTables ?? 10,
    maxMenuItems: plan?.maxMenuItems ?? 50,
    trialDays: plan?.trialDays ?? 14,
    whatsappMonthlyLimit: (plan as Plan & { whatsappMonthlyLimit?: number })?.whatsappMonthlyLimit ?? 0,
    features: plan?.features ?? [],
    isActive: plan?.isActive ?? true,
    aiEnabled: plan?.aiEnabled ?? false,
    aiMonthlyIncludedCredits: plan?.aiMonthlyIncludedCredits ?? 0,
    aiDailyRequestCap: plan?.aiDailyRequestCap ?? 0,
    aiPerFeatureMonthlyCaps: plan?.aiPerFeatureMonthlyCaps ?? {},
    aiFeatureToggles: plan?.aiFeatureToggles ?? {},
  });
  const [aiCapsText, setAiCapsText] = useState(() =>
    Object.entries(plan?.aiPerFeatureMonthlyCaps ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"));
  const [aiTogglesText, setAiTogglesText] = useState(() =>
    Object.entries(plan?.aiFeatureToggles ?? {}).map(([k, v]) => `${k}=${v ? "on" : "off"}`).join("\n"));
  const [featuresText, setFeaturesText] = useState((plan?.features ?? []).join("\n"));
  // Boolean feature flags — initialise from existing plan, falling back to the
  // catalogue defaults so plans that pre-date a flag still render sensibly.
  const [flags, setFlags] = useState<Record<string, boolean | number>>(() => {
    const seed = plan?.featureFlags && typeof plan.featureFlags === "object" ? plan.featureFlags : {};
    const out: Record<string, boolean | number> = { ...defaultFeatureFlags() };
    for (const k of Object.keys(seed)) {
      const v = (seed as Record<string, unknown>)[k];
      if (typeof v === "boolean" || typeof v === "number") out[k] = v;
    }
    // Seed numeric defaults for any missing numeric features.
    for (const nf of PLAN_NUMERIC_FEATURES) {
      if (typeof out[nf.key] !== "number") out[nf.key] = getFeatureNumber(seed as Record<string, unknown>, nf.key);
    }
    return out;
  });
  const [busy, setBusy] = useState(false);
  const isEdit = !!plan;

  const setFlag = (key: string, val: boolean) => setFlags(prev => ({ ...prev, [key]: val }));
  const setNumericFlag = (key: string, val: number) => setFlags(prev => ({ ...prev, [key]: val }));
  const setQty = (key: keyof Plan, val: number) =>
    setForm(prev => ({ ...prev, [key]: val }) as typeof prev);

  const save = async () => {
    setBusy(true);
    try {
      const aiPerFeatureMonthlyCaps: Record<string, number> = {};
      for (const line of aiCapsText.split("\n")) {
        const [k, v] = line.split("=").map(s => s?.trim());
        if (k && v && !Number.isNaN(Number(v))) aiPerFeatureMonthlyCaps[k] = Number(v);
      }
      const aiFeatureToggles: Record<string, boolean> = {};
      for (const line of aiTogglesText.split("\n")) {
        const [k, v] = line.split("=").map(s => s?.trim());
        if (k && v) aiFeatureToggles[k] = /^(on|true|yes|1)$/i.test(v);
      }
      const payload = {
        ...form,
        price: String(form.price),
        yearlyPrice: form.yearlyPrice == null || String(form.yearlyPrice).trim() === ""
          ? null
          : String(form.yearlyPrice),
        stripeMonthlyPriceId: form.stripeMonthlyPriceId?.toString().trim() || null,
        stripeYearlyPriceId: form.stripeYearlyPriceId?.toString().trim() || null,
        cashfreeMonthlyPlanId: form.cashfreeMonthlyPlanId?.toString().trim() || null,
        cashfreeYearlyPlanId: form.cashfreeYearlyPlanId?.toString().trim() || null,
        features: featuresText.split("\n").map(s => s.trim()).filter(Boolean),
        featureFlags: flags,
        aiPerFeatureMonthlyCaps,
        aiFeatureToggles,
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
        <Field label="Billing period" hint="The period the 'Price' above represents">
          <select className={inputCls} value={form.billingPeriod as string} onChange={e => setForm({ ...form, billingPeriod: e.target.value })}>
            <option value="monthly">Monthly</option><option value="yearly">Yearly</option>
          </select>
        </Field>
        <Field label="Yearly price" hint="Optional — when set, the marketing site shows this instead of a 16% discount derived from the monthly price">
          <input className={inputCls} type="number" min="0" step="0.01"
            value={(form.yearlyPrice as string) ?? ""}
            placeholder="e.g. 49990"
            onChange={e => setForm({ ...form, yearlyPrice: e.target.value })} />
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
                        checked={Boolean(flags[feat.key])}
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

      {/* ─── Numeric feature settings ──────────────────────────────── */}
      {PLAN_NUMERIC_FEATURES.length > 0 && (
        <div className="mt-5 rounded-md border border-border/60 bg-muted/20 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Feature limits</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PLAN_NUMERIC_FEATURES.map(nf => (
              <Field key={nf.key} label={nf.label} hint={nf.description}>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={nf.min}
                    max={nf.max}
                    className={inputCls}
                    value={Number(flags[nf.key] ?? nf.defaultValue)}
                    onChange={e => setNumericFlag(nf.key, Math.max(nf.min, Math.min(nf.max, Number(e.target.value) || 0)))}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{nf.unit}</span>
                </div>
              </Field>
            ))}
          </div>
        </div>
      )}

      {/* ─── Khana AI ────────────────────────────────────────────── */}
      <div className="mt-5 rounded-md border border-border/60 bg-muted/20 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Khana AI</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="AI enabled">
            <select className={inputCls} value={String(form.aiEnabled ?? false)} onChange={e => setForm({ ...form, aiEnabled: e.target.value === "true" })}>
              <option value="false">No</option><option value="true">Yes</option>
            </select>
          </Field>
          <Field label="Monthly included credits" hint="0 = none">
            <input type="number" min="0" className={inputCls} value={form.aiMonthlyIncludedCredits ?? 0}
              onChange={e => setForm({ ...form, aiMonthlyIncludedCredits: Number(e.target.value) })} />
          </Field>
          <Field label="Daily request cap" hint="0 = unlimited">
            <input type="number" min="0" className={inputCls} value={form.aiDailyRequestCap ?? 0}
              onChange={e => setForm({ ...form, aiDailyRequestCap: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <Field label="Per-feature monthly caps" hint="One per line: feature-slug=cap">
            <textarea className={inputCls + " min-h-20 font-mono text-xs"} value={aiCapsText}
              onChange={e => setAiCapsText(e.target.value)} placeholder={"menu-suggestions=500\nreport-summaries=200"} />
          </Field>
          <Field label="Feature toggles" hint="One per line: feature-slug=on|off">
            <textarea className={inputCls + " min-h-20 font-mono text-xs"} value={aiTogglesText}
              onChange={e => setAiTogglesText(e.target.value)} placeholder={"menu-suggestions=on\nreport-summaries=off"} />
          </Field>
        </div>
      </div>

      {/* ─── Payment-provider price IDs ───────────────────────────── */}
      <div className="mt-5 rounded-md border border-border/60 bg-muted/20 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Payment provider IDs</p>
        <p className="text-xs text-muted-foreground mb-3">Optional. When set, checkout will attach the matching recurring price / plan for the chosen billing period.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Stripe monthly price ID" hint="e.g. price_1Abc…">
            <input className={inputCls} value={form.stripeMonthlyPriceId as string ?? ""}
              onChange={e => setForm({ ...form, stripeMonthlyPriceId: e.target.value })} placeholder="price_…" />
          </Field>
          <Field label="Stripe yearly price ID" hint="e.g. price_1Xyz…">
            <input className={inputCls} value={form.stripeYearlyPriceId as string ?? ""}
              onChange={e => setForm({ ...form, stripeYearlyPriceId: e.target.value })} placeholder="price_…" />
          </Field>
          <Field label="Cashfree monthly plan ID">
            <input className={inputCls} value={form.cashfreeMonthlyPlanId as string ?? ""}
              onChange={e => setForm({ ...form, cashfreeMonthlyPlanId: e.target.value })} placeholder="cf_plan_…" />
          </Field>
          <Field label="Cashfree yearly plan ID">
            <input className={inputCls} value={form.cashfreeYearlyPlanId as string ?? ""}
              onChange={e => setForm({ ...form, cashfreeYearlyPlanId: e.target.value })} placeholder="cf_plan_…" />
          </Field>
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
export function PlansTab() {
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

export function TenantsTab() {
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
  const [billing, setBilling] = useState<Tenant | null>(null);
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
                    <Button size="sm" variant="outline" onClick={() => setBilling(tenant)} className="gap-1" title="View payments and manual requests for this tenant">
                      <CreditCard className="w-3 h-3" />Billing
                    </Button>
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
      {billing && <TenantBillingModal tenant={billing} onClose={() => setBilling(null)} />}
    </div>
  );
}

type AdminSection =
  | "tenants" | "plans" | "payment-methods" | "approvals" | "coupons"
  | "notifications" | "sms" | "email" | "maintenance" | "whatsapp"
  | "ai" | "health" | "metrics" | "implementations";

const SECTION_TITLES: Record<AdminSection, { title: string; subtitle: string }> = {
  "tenants": { title: "Tenants", subtitle: "Manage restaurant accounts, plans, and trial windows" },
  "plans": { title: "Subscription Plans", subtitle: "Pricing tiers, limits, and feature flags" },
  "payment-methods": { title: "Payment Methods", subtitle: "Online providers and manual payment options" },
  "approvals": { title: "Manual Payment Approvals", subtitle: "Review pending bank/UPI submissions" },
  "coupons": { title: "Coupons", subtitle: "Discounts, promo codes, and redemptions" },
  "notifications": { title: "Notifications", subtitle: "Send announcements and broadcast messages" },
  "sms": { title: "SMS", subtitle: "SMS provider, templates, and delivery logs" },
  "email": { title: "Email", subtitle: "Email provider, templates, and delivery logs" },
  "maintenance": { title: "System Maintenance", subtitle: "Maintenance windows and platform-wide notices" },
  "whatsapp": { title: "WhatsApp", subtitle: "WhatsApp Business config and templates" },
  "ai": { title: "AI Control Center", subtitle: "AI providers, prompts, and feature configuration" },
  "health": { title: "Restaurant Health", subtitle: "Operational health scores per tenant" },
  "metrics": { title: "Investor Metrics", subtitle: "MRR, ARR, retention, and growth KPIs" },
  "implementations": { title: "Implementation Board", subtitle: "In-flight go-live projects, assigned onboarding managers and SLA timers" },
};

function parseSection(path: string): AdminSection {
  const m = path.match(/^\/admin\/([a-z-]+)\/?$/i);
  const raw = m?.[1] ?? "";
  if (raw in SECTION_TITLES) return raw as AdminSection;
  return "tenants";
}

export default function AdminPage() {
  const [location, navigate] = useLocation();
  const { user } = useAuth();

  // Default /admin → /admin/tenants
  useEffect(() => {
    if (location === "/admin" || location === "/admin/") {
      navigate("/admin/tenants", { replace: true });
    }
  }, [location, navigate]);

  const section = parseSection(location);

  const { data: stats } = useQuery<AdminStats>({
    queryKey: ["admin", "stats"],
    queryFn: () => apiFetch("/admin/stats"),
    refetchInterval: 30000,
    enabled: !!user?.isSuperAdmin,
  });

  const titleInfo = SECTION_TITLES[section];

  const statCards = [
    { label: "Tenants", value: stats?.totalTenants ?? "—", icon: Building2, color: "text-primary" },
    { label: "Active", value: stats?.activeTenants ?? "—", icon: CheckCircle, color: "text-green-600" },
    { label: "Trial", value: stats?.trialTenants ?? "—", icon: Clock, color: "text-amber-600" },
    { label: "Suspended", value: stats?.suspendedTenants ?? "—", icon: Ban, color: "text-destructive" },
    { label: "Restaurants", value: stats?.totalRestaurants ?? "—", icon: Building2, color: "text-primary" },
    { label: "Orders", value: stats?.totalOrders ?? "—", icon: TrendingUp, color: "text-primary" },
  ];

  const showStats = section === "tenants" || section === "metrics";

  return (
    <AdminLayout title={titleInfo.title} subtitle={titleInfo.subtitle}>
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {showStats && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {statCards.map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-card border border-border rounded-xl p-3 space-y-1.5">
                <Icon className={`w-4 h-4 ${color}`} />
                <p className="text-xl font-bold text-foreground">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        )}

        {section === "tenants" && <TenantsTab />}
        {section === "plans" && <PlansTab />}
        {section === "payment-methods" && <PaymentMethodsTab />}
        {section === "approvals" && <ApprovalsTab />}
        {section === "coupons" && <CouponsTab />}
        {section === "notifications" && <AdminNotificationCenter />}
        {section === "sms" && <AdminSmsTab />}
        {section === "email" && <AdminEmail />}
        {section === "maintenance" && <AdminMaintenance />}
        {section === "whatsapp" && <AdminWhatsAppTab />}
        {section === "ai" && <AdminAiTab />}
        {section === "health" && <AdminHealthScoreTab />}
        {section === "metrics" && <AdminMetricsTab />}
        {section === "implementations" && <AdminImplementationsTab />}
      </div>
    </AdminLayout>
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

export function PaymentMethodsTab() {
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
            {field("accountHolder", "Account holder", { placeholder: "KhanaLagao Pvt Ltd" })}
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
          {field("payeeName", "Payee name", { placeholder: "KhanaLagao Pvt Ltd" })}
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
export function ApprovalsTab() {
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

export function CouponsTab() {
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

// ────────────────────────────────────────────────────────────────
// Restaurant Health Score (super-admin)
// ────────────────────────────────────────────────────────────────
interface AdminHealthRow {
  id: number;
  restaurantId: number;
  tenantId: number;
  restaurantName: string;
  tenantName: string;
  tenantSlug: string;
  snapshotDate: string;
  overallScore: number;
  band: string;
  subScores: Record<string, number | null>;
  suggestions: Array<{ key: string; title: string; detail: string }>;
}
interface AdminHealthResponse {
  page: number;
  pageSize: number;
  total: number;
  data: AdminHealthRow[];
  factorLabels: Record<string, string>;
  weights: Record<string, number>;
}

const HEALTH_BAND_COLORS: Record<string, string> = {
  excellent: "hsl(142 72% 45%)",
  good: "hsl(170 65% 40%)",
  fair: "hsl(48 95% 53%)",
  poor: "hsl(25 95% 55%)",
  critical: "hsl(0 80% 55%)",
};

export function AdminHealthScoreTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [band, setBand] = useState("");
  const [sort, setSort] = useState<"score_desc" | "score_asc" | "name_asc">("score_desc");

  const { data, isLoading } = useQuery<AdminHealthResponse>({
    queryKey: ["admin", "health-scores", page, search, band, sort],
    queryFn: () => apiFetch(`/admin/health-scores?page=${page}&pageSize=25&search=${encodeURIComponent(search)}&band=${band}&sort=${sort}`),
    placeholderData: keepPreviousData,
  });

  const recalcAll = useMutation({
    mutationFn: () => apiAction("/admin/health-scores/recalculate-all", "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "health-scores"] }),
  });

  const rows = data?.data ?? [];

  const handleCSV = () => {
    const headers = ["Restaurant", "Tenant", "Score", "Band", "Snapshot"];
    const csv = [headers, ...rows.map(r => [r.restaurantName, r.tenantName, String(r.overallScore), r.band, r.snapshotDate])]
      .map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `restaurant-health-scores-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 25)));

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search restaurant or tenant"
            value={search}
            onChange={e => { setPage(1); setSearch(e.target.value); }}
            className="pl-8 h-9"
          />
        </div>
        <select value={band} onChange={e => { setPage(1); setBand(e.target.value); }}
          className="h-9 border border-border rounded-md bg-background text-sm px-2">
          <option value="">All bands</option>
          <option value="excellent">Excellent</option>
          <option value="good">Good</option>
          <option value="fair">Fair</option>
          <option value="poor">Poor</option>
          <option value="critical">Critical</option>
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as typeof sort)}
          className="h-9 border border-border rounded-md bg-background text-sm px-2">
          <option value="score_desc">Score: High to Low</option>
          <option value="score_asc">Score: Low to High</option>
          <option value="name_asc">Name A→Z</option>
        </select>
        <Button variant="outline" size="sm" onClick={handleCSV} disabled={!rows.length}>
          <Download className="w-4 h-4 mr-1.5" />Export CSV
        </Button>
        <Button size="sm" onClick={() => recalcAll.mutate()} disabled={recalcAll.isPending}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${recalcAll.isPending ? "animate-spin" : ""}`} />
          Recalculate All
        </Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left">#</th>
              <th className="px-4 py-2 text-left">Restaurant</th>
              <th className="px-4 py-2 text-left">Tenant</th>
              <th className="px-4 py-2 text-right">Score</th>
              <th className="px-4 py-2 text-left">Band</th>
              <th className="px-4 py-2 text-left">Top Issues</th>
              <th className="px-4 py-2 text-left">Updated</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">No health snapshots yet. Click "Recalculate All" to seed.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-4 py-2 text-muted-foreground text-xs">{(page - 1) * (data?.pageSize ?? 25) + i + 1}</td>
                <td className="px-4 py-2 font-medium">{r.restaurantName}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.tenantName}</td>
                <td className="px-4 py-2 text-right font-semibold">{Number(r.overallScore).toFixed(1)}</td>
                <td className="px-4 py-2">
                  <span className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: `${HEALTH_BAND_COLORS[r.band]}20`, color: HEALTH_BAND_COLORS[r.band] }}>
                    {r.band.charAt(0).toUpperCase() + r.band.slice(1)}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {r.suggestions.slice(0, 2).map(s => s.title).join(" · ") || "—"}
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {new Date(r.snapshotDate).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="px-4 py-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <div>Page {page} of {totalPages} · {data?.total ?? 0} restaurants</div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Implementation board (Task #435) — super-admin view of every
// in-flight go-live, the assigned onboarding manager, SLA timers,
// per-step progress, post-launch follow-ups and stalled-step checks.
// ────────────────────────────────────────────────────────────────

type ImplBoardRow = {
  id: number; tenantId: number; status: string;
  managerId: number | null; goLiveDate: string | null;
  startedAt: string | null; launchedAt: string | null;
  slaHours: number; progressPct: number;
  stepsTotal: number; stepsComplete: number; stalledStepCount: number;
  slaRemainingHours: number | null; slaBreached: boolean;
  tenant: { id: number; name: string; slug: string; onboardingCompletedAt: string | null } | null;
  manager: { id: number; name: string; email: string } | null;
  notes: string | null;
};

type ImplStep = {
  id: number; stepKey: string; title: string; description: string | null;
  ownerType: "restaurant" | "manager"; ownerUserId: number | null;
  status: "not_started" | "in_progress" | "blocked" | "complete" | "skipped";
  progressPct: number; dueDate: string | null; completedAt: string | null;
  lastActivityAt: string;
};

type ImplPostLaunchTask = {
  id: number; weekOffset: number; title: string; description: string | null;
  dueDate: string; completedAt: string | null;
};

type ImplDetail = {
  implementation: ImplBoardRow & { notes: string | null };
  steps: ImplStep[];
  postLaunchTasks: ImplPostLaunchTask[];
  manager: { id: number; name: string; email: string } | null;
  tenant: { id: number; name: string; slug: string };
  progressPct: number;
};

function implStatusPill(status: string): string {
  switch (status) {
    case "complete": return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "post_launch": return "bg-violet-500/15 text-violet-700 dark:text-violet-400";
    case "launched": return "bg-blue-500/15 text-blue-700 dark:text-blue-400";
    case "blocked": return "bg-destructive/15 text-destructive";
    case "in_progress": return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    default: return "bg-muted text-muted-foreground";
  }
}

function AdminImplementationsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery<{ implementations: ImplBoardRow[] }>({
    queryKey: ["admin", "implementations"],
    queryFn: () => apiFetch("/admin/implementations"),
    refetchInterval: 60_000,
  });

  const checkStalls = useMutation({
    mutationFn: () => apiAction<{ raised: number }>("/admin/implementations/check-stalls", "POST"),
    onSuccess: (r) => {
      toast({ title: `Stall check complete`, description: `${r.raised} notification(s) raised` });
      qc.invalidateQueries({ queryKey: ["admin", "implementations"] });
    },
    onError: (e: Error) => toast({ title: "Stall check failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  }

  const rows = data?.implementations ?? [];
  const active = rows.filter(r => r.status !== "complete");
  const breached = rows.filter(r => r.slaBreached).length;
  const stalled = rows.reduce((acc, r) => acc + (r.stalledStepCount ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">In-flight</p>
          <p className="text-2xl font-bold">{active.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Launched</p>
          <p className="text-2xl font-bold">{rows.filter(r => r.status === "post_launch" || r.status === "complete").length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">SLA breached</p>
          <p className={`text-2xl font-bold ${breached > 0 ? "text-destructive" : ""}`}>{breached}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Stalled steps</p>
          <p className={`text-2xl font-bold ${stalled > 0 ? "text-amber-600" : ""}`}>{stalled}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Only tenants on plans with <span className="font-medium">Dedicated implementation</span> appear here.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted"
          >Refresh</button>
          <button
            onClick={() => checkStalls.mutate()}
            disabled={checkStalls.isPending}
            className="text-xs px-3 py-1.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 disabled:opacity-50"
          >
            {checkStalls.isPending ? "Checking…" : "Run stall check"}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No tenants are entitled to dedicated implementation. Enable the <code>dedicated_implementation</code> feature on a plan to see customers here.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Onboarding manager</th>
                <th className="px-3 py-2">Progress</th>
                <th className="px-3 py-2">Go-live</th>
                <th className="px-3 py-2">SLA</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{r.tenant?.name ?? `Tenant #${r.tenantId}`}<div className="text-xs text-muted-foreground">{r.tenant?.slug}</div></td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${implStatusPill(r.status)}`}>
                      {r.status.replace("_", " ")}
                    </span>
                    {r.stalledStepCount > 0 && (
                      <span className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide bg-amber-500/15 text-amber-700 dark:text-amber-400">
                        {r.stalledStepCount} stalled
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.manager ? <span>{r.manager.name}<div className="text-xs text-muted-foreground">{r.manager.email}</div></span> : <span className="text-xs text-muted-foreground italic">Unassigned</span>}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${r.progressPct}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">{r.stepsComplete}/{r.stepsTotal}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.goLiveDate ? new Date(r.goLiveDate).toLocaleDateString() : "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.slaRemainingHours == null ? "—" : (
                      <span className={r.slaBreached ? "text-destructive font-semibold" : r.slaRemainingHours < 24 ? "text-amber-600" : ""}>
                        {r.slaRemainingHours < 0 ? `${Math.abs(r.slaRemainingHours)}h over` : `${r.slaRemainingHours}h left`}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setSelected(r.tenantId)} className="text-xs px-2 py-1 rounded-md border border-border hover:bg-muted">Manage</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected != null && (
        <ImplementationDetailModal tenantId={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function ImplementationDetailModal({ tenantId, onClose }: { tenantId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery<ImplDetail>({
    queryKey: ["admin", "implementation", tenantId],
    queryFn: () => apiFetch(`/admin/implementations/${tenantId}`),
  });
  const { data: managerSearch } = useQuery<{ users: { id: number; name: string; email: string; role: string | null }[] }>({
    queryKey: ["admin", "implementation-managers"],
    queryFn: () => apiFetch(`/admin/implementations/managers/search`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "implementation", tenantId] });
    qc.invalidateQueries({ queryKey: ["admin", "implementations"] });
  };

  const updateImpl = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiAction(`/admin/implementations/${tenantId}`, "PATCH", body),
    onSuccess: () => { toast({ title: "Saved" }); invalidate(); },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const updateStep = useMutation({
    mutationFn: ({ stepId, body }: { stepId: number; body: Record<string, unknown> }) =>
      apiAction(`/admin/implementations/${tenantId}/steps/${stepId}`, "PATCH", body),
    onSuccess: () => { invalidate(); },
    onError: (e: Error) => toast({ title: "Step update failed", description: e.message, variant: "destructive" }),
  });

  const launch = useMutation({
    mutationFn: () => apiAction(`/admin/implementations/${tenantId}/launch`, "POST"),
    onSuccess: () => { toast({ title: "Launched" }); invalidate(); refetch(); },
    onError: (e: Error) => toast({ title: "Launch failed", description: e.message, variant: "destructive" }),
  });

  const completeTask = useMutation({
    mutationFn: (taskId: number) => apiAction(`/admin/implementations/${tenantId}/post-launch/${taskId}/complete`, "POST"),
    onSuccess: () => { invalidate(); },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Modal title={data ? `Implementation · ${data.tenant.name}` : "Implementation"} onClose={onClose} wide>
      {isLoading || !data ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Onboarding manager">
              <select
                className={inputCls}
                value={String(data.implementation.managerId ?? "")}
                onChange={e => updateImpl.mutate({ managerId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">— Unassigned —</option>
                {(managerSearch?.users ?? []).map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                ))}
              </select>
            </Field>
            <Field label="Target go-live date">
              <input
                type="date"
                className={inputCls}
                defaultValue={data.implementation.goLiveDate ? data.implementation.goLiveDate.slice(0, 10) : ""}
                onBlur={e => updateImpl.mutate({ goLiveDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
              />
            </Field>
            <Field label="SLA (hours)">
              <input
                type="number" min={1} className={inputCls}
                defaultValue={data.implementation.slaHours}
                onBlur={e => updateImpl.mutate({ slaHours: Math.max(1, Number(e.target.value)) })}
              />
            </Field>
            <Field label="Status">
              <select
                className={inputCls}
                value={data.implementation.status}
                onChange={e => updateImpl.mutate({ status: e.target.value })}
              >
                {["not_started", "in_progress", "blocked", "launched", "post_launch", "complete"].map(s => (
                  <option key={s} value={s}>{s.replace("_", " ")}</option>
                ))}
              </select>
            </Field>
            <Field label="Notes" hint="Internal — visible to super-admins only">
              <textarea
                className={inputCls + " min-h-[60px]"}
                defaultValue={data.implementation.notes ?? ""}
                onBlur={e => updateImpl.mutate({ notes: e.target.value })}
              />
            </Field>
            <div className="flex items-end">
              <button
                onClick={() => launch.mutate()}
                disabled={launch.isPending || !!data.implementation.launchedAt}
                className="w-full text-sm px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {data.implementation.launchedAt ? "Already launched" : launch.isPending ? "Launching…" : "Mark launched & seed follow-ups"}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background/50">
            <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border">Checklist</div>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Step</th>
                  <th className="px-3 py-2 text-left">Owner</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Progress</th>
                  <th className="px-3 py-2 text-left">Due</th>
                  <th className="px-3 py-2 text-left">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.steps.map(s => (
                  <tr key={s.id}>
                    <td className="px-3 py-2"><div className="font-medium">{s.title}</div>{s.description && <div className="text-xs text-muted-foreground">{s.description}</div>}</td>
                    <td className="px-3 py-2">
                      <select
                        className="text-xs border border-border rounded-md px-1.5 py-1 bg-background"
                        value={s.ownerType}
                        onChange={e => updateStep.mutate({ stepId: s.id, body: { ownerType: e.target.value } })}
                      >
                        <option value="restaurant">Restaurant</option>
                        <option value="manager">Manager</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="text-xs border border-border rounded-md px-1.5 py-1 bg-background"
                        value={s.status}
                        onChange={e => updateStep.mutate({ stepId: s.id, body: { status: e.target.value } })}
                      >
                        {["not_started", "in_progress", "blocked", "complete", "skipped"].map(st => (
                          <option key={st} value={st}>{st.replace("_", " ")}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number" min={0} max={100}
                        defaultValue={s.progressPct}
                        className="text-xs w-16 border border-border rounded-md px-1.5 py-1 bg-background"
                        onBlur={e => updateStep.mutate({ stepId: s.id, body: { progressPct: Math.max(0, Math.min(100, Number(e.target.value))) } })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        defaultValue={s.dueDate ? s.dueDate.slice(0, 10) : ""}
                        className="text-xs border border-border rounded-md px-1.5 py-1 bg-background"
                        onBlur={e => updateStep.mutate({ stepId: s.id, body: { dueDate: e.target.value ? new Date(e.target.value).toISOString() : null } })}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(s.lastActivityAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.postLaunchTasks.length > 0 && (
            <div className="rounded-lg border border-border bg-background/50">
              <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border">Post-launch follow-ups</div>
              <ul className="divide-y divide-border">
                {data.postLaunchTasks.map(t => (
                  <li key={t.id} className="px-3 py-2 flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={!!t.completedAt}
                      disabled={!!t.completedAt || completeTask.isPending}
                      onChange={() => completeTask.mutate(t.id)}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">Week {t.weekOffset}: {t.title}</div>
                      {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                      <div className="text-xs text-muted-foreground">Due {new Date(t.dueDate).toLocaleDateString()}{t.completedAt ? ` · Done ${new Date(t.completedAt).toLocaleDateString()}` : ""}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
