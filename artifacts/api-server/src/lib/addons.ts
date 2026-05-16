/**
 * Add-on Marketplace service layer.
 *
 * Provides:
 *   - tenantHasAddon(tenantId, addonKey): the canonical resolver for runtime gating
 *   - install / startTrial / uninstall / activatePaid: tenant lifecycle ops
 *   - adminActivate / adminDeactivate / extendTrial / comp / forceUninstall: super-admin overrides
 *   - logEvent: append-only addon_events writer
 *   - sweepLifecycle: cron tick to expire trials, expire paid periods
 *   - seedAddonCatalogue: idempotent seeder run on boot
 */
import { and, eq, inArray, sql, desc } from "drizzle-orm";
import {
  db,
  addonsTable,
  tenantAddonsTable,
  addonEventsTable,
  tenantsTable,
  type Addon,
  type TenantAddon,
} from "./db";
import { ADDON_CATALOGUE } from "@workspace/db/addonCatalogue";
import { logger } from "./logger";

export type AddonStatus = "trial" | "active" | "cancelled" | "expired" | "not_installed" | "included_in_plan";

export interface ResolvedAddonState {
  addon: Addon;
  install: TenantAddon | null;
  status: AddonStatus;
  includedInPlan: boolean;
  eligibleByPlan: boolean;
  active: boolean; // active OR trial OR included
}

// ─── Catalogue seeder ────────────────────────────────────────────────────────

export async function seedAddonCatalogue(): Promise<void> {
  for (const entry of ADDON_CATALOGUE) {
    const [existing] = await db.select().from(addonsTable).where(eq(addonsTable.key, entry.key));
    if (existing) continue; // never overwrite super-admin edits
    await db.insert(addonsTable).values({
      key: entry.key,
      name: entry.name,
      description: entry.description,
      longDescription: entry.longDescription,
      icon: entry.icon,
      category: entry.category,
      pricing: entry.pricing,
      trialDays: entry.trialDays,
      featureFlags: entry.featureFlags,
      comingSoon: entry.comingSoon,
      isEnabled: !entry.comingSoon,
      sortOrder: entry.sortOrder,
    }).onConflictDoNothing({ target: addonsTable.key });
  }
}

// ─── Logging ─────────────────────────────────────────────────────────────────

export interface LogEventOpts {
  tenantId: number;
  addon: Pick<Addon, "id" | "key">;
  eventType: string;
  source?: "self" | "admin" | "system" | "webhook";
  actorUserId?: number | null;
  amount?: number | null;
  currency?: string | null;
  paymentRef?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logAddonEvent(opts: LogEventOpts): Promise<void> {
  await db.insert(addonEventsTable).values({
    tenantId: opts.tenantId,
    addonId: opts.addon.id,
    addonKey: opts.addon.key,
    eventType: opts.eventType,
    source: opts.source ?? "system",
    actorUserId: opts.actorUserId ?? null,
    amount: opts.amount != null ? opts.amount.toFixed(2) : null,
    currency: opts.currency ?? null,
    paymentRef: opts.paymentRef ?? null,
    notes: opts.notes ?? null,
    metadata: opts.metadata ?? {},
  });
}

// ─── Resolver ────────────────────────────────────────────────────────────────

function isInstallActive(install: TenantAddon | null, now = new Date()): boolean {
  if (!install) return false;
  if (install.status === "active") {
    return !install.currentPeriodEndsAt || install.currentPeriodEndsAt.getTime() > now.getTime();
  }
  if (install.status === "trial") {
    return !!install.trialEndsAt && install.trialEndsAt.getTime() > now.getTime();
  }
  return false;
}

export async function resolveAddonState(tenantId: number, addonKey: string): Promise<ResolvedAddonState | null> {
  const [addon] = await db.select().from(addonsTable).where(eq(addonsTable.key, addonKey));
  if (!addon) return null;
  const [tenant] = await db.select({ planId: tenantsTable.planId }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const includedInPlan = !!tenant?.planId && addon.includedInPlanIds.includes(tenant.planId);
  const eligibleByPlan = addon.eligiblePlanIds.length === 0 || (!!tenant?.planId && addon.eligiblePlanIds.includes(tenant.planId));
  const [install] = await db.select().from(tenantAddonsTable)
    .where(and(eq(tenantAddonsTable.tenantId, tenantId), eq(tenantAddonsTable.addonId, addon.id)));
  const live = isInstallActive(install ?? null);
  let status: AddonStatus = "not_installed";
  if (includedInPlan) status = "included_in_plan";
  else if (install) status = install.status as AddonStatus;
  return {
    addon,
    install: install ?? null,
    status,
    includedInPlan,
    eligibleByPlan,
    active: includedInPlan || live,
  };
}

/** Canonical gating helper used by middleware and frontend feature checks. */
export async function tenantHasAddon(tenantId: number, addonKey: string): Promise<boolean> {
  const r = await resolveAddonState(tenantId, addonKey);
  return r?.active ?? false;
}

/** Bulk-resolve all add-on states for a tenant — used by the marketplace UI. */
export async function listTenantAddons(tenantId: number): Promise<ResolvedAddonState[]> {
  const addons = await db.select().from(addonsTable).orderBy(addonsTable.sortOrder, addonsTable.id);
  const [tenant] = await db.select({ planId: tenantsTable.planId }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const installs = await db.select().from(tenantAddonsTable).where(eq(tenantAddonsTable.tenantId, tenantId));
  const installByAddonId = new Map(installs.map(i => [i.addonId, i]));
  const out: ResolvedAddonState[] = [];
  for (const addon of addons) {
    const includedInPlan = !!tenant?.planId && addon.includedInPlanIds.includes(tenant.planId);
    const eligibleByPlan = addon.eligiblePlanIds.length === 0 || (!!tenant?.planId && addon.eligiblePlanIds.includes(tenant.planId));
    const install = installByAddonId.get(addon.id) ?? null;
    const live = isInstallActive(install);
    let status: AddonStatus = "not_installed";
    if (includedInPlan) status = "included_in_plan";
    else if (install) status = install.status as AddonStatus;
    out.push({ addon, install, status, includedInPlan, eligibleByPlan, active: includedInPlan || live });
  }
  return out;
}

/** All feature flags currently unlocked for a tenant via active add-ons. */
export async function tenantAddonFeatureFlags(tenantId: number): Promise<Set<string>> {
  const states = await listTenantAddons(tenantId);
  const flags = new Set<string>();
  for (const s of states) {
    if (s.active) for (const f of s.addon.featureFlags) flags.add(f);
  }
  return flags;
}

// ─── Lifecycle ops ───────────────────────────────────────────────────────────

function computePeriodEnd(billingCycle: "monthly" | "yearly" | "one_off", from = new Date()): Date | null {
  if (billingCycle === "one_off") return null;
  const d = new Date(from);
  if (billingCycle === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

export class AddonError extends Error {
  constructor(public code: string, msg: string) { super(msg); }
}

interface InstallOpts {
  tenantId: number;
  addonKey: string;
  source?: "self" | "admin" | "included_in_plan" | "comp";
  actorUserId?: number | null;
}

/** Install a free or zero-cost add-on (or one included in the plan). */
export async function installAddon(opts: InstallOpts): Promise<TenantAddon> {
  const state = await resolveAddonState(opts.tenantId, opts.addonKey);
  if (!state) throw new AddonError("NOT_FOUND", "Add-on not found");
  if (!state.addon.isEnabled) throw new AddonError("DISABLED", "This add-on is not currently available.");
  if (state.addon.comingSoon) throw new AddonError("COMING_SOON", "This add-on is coming soon — check back later.");
  if (!state.eligibleByPlan && opts.source !== "admin" && opts.source !== "comp") {
    throw new AddonError("PLAN_INELIGIBLE", "Your current plan can't install this add-on. Upgrade your plan to continue.");
  }
  if (state.install && (state.install.status === "active" || state.install.status === "trial")) {
    return state.install;
  }
  const periodEnd = computePeriodEnd("monthly");
  const values = {
    tenantId: opts.tenantId,
    addonId: state.addon.id,
    addonKey: state.addon.key,
    status: "active" as const,
    source: opts.source ?? "self",
    billingCycle: "monthly" as const,
    pricePaid: "0.00",
    currency: state.addon.pricing.currency ?? "INR",
    startedAt: new Date(),
    currentPeriodEndsAt: periodEnd,
  };
  const [row] = await db.insert(tenantAddonsTable).values(values)
    .onConflictDoUpdate({
      target: [tenantAddonsTable.tenantId, tenantAddonsTable.addonId],
      set: { status: "active", source: values.source, startedAt: values.startedAt, currentPeriodEndsAt: periodEnd, cancelledAt: null, updatedAt: new Date() },
    })
    .returning();
  await logAddonEvent({
    tenantId: opts.tenantId, addon: state.addon, eventType: "install",
    source: opts.source === "admin" || opts.source === "comp" ? "admin" : "self",
    actorUserId: opts.actorUserId ?? null,
  });
  await logAddonEvent({
    tenantId: opts.tenantId, addon: state.addon, eventType: "activate",
    source: opts.source === "admin" || opts.source === "comp" ? "admin" : "self",
    actorUserId: opts.actorUserId ?? null,
  });
  return row;
}

export async function startTrial(opts: InstallOpts): Promise<TenantAddon> {
  const state = await resolveAddonState(opts.tenantId, opts.addonKey);
  if (!state) throw new AddonError("NOT_FOUND", "Add-on not found");
  if (!state.addon.isEnabled) throw new AddonError("DISABLED", "This add-on is not currently available.");
  if (state.addon.comingSoon) throw new AddonError("COMING_SOON", "This add-on is coming soon.");
  if (state.addon.trialDays <= 0) throw new AddonError("NO_TRIAL", "This add-on doesn't offer a trial.");
  if (!state.eligibleByPlan && opts.source !== "admin") {
    throw new AddonError("PLAN_INELIGIBLE", "Your current plan can't install this add-on.");
  }
  if (state.install && (state.install.status === "active" || state.install.status === "trial")) {
    return state.install;
  }
  if (state.install && state.install.trialEndsAt && opts.source !== "admin") {
    throw new AddonError("TRIAL_USED", "You've already used the trial for this add-on.");
  }
  const trialEnd = new Date(Date.now() + state.addon.trialDays * 86400000);
  const [row] = await db.insert(tenantAddonsTable).values({
    tenantId: opts.tenantId,
    addonId: state.addon.id,
    addonKey: state.addon.key,
    status: "trial",
    source: opts.source ?? "self",
    billingCycle: "monthly",
    currency: state.addon.pricing.currency ?? "INR",
    startedAt: new Date(),
    trialEndsAt: trialEnd,
  }).onConflictDoUpdate({
    target: [tenantAddonsTable.tenantId, tenantAddonsTable.addonId],
    set: { status: "trial", source: opts.source ?? "self", startedAt: new Date(), trialEndsAt: trialEnd, cancelledAt: null, updatedAt: new Date() },
  }).returning();
  await logAddonEvent({
    tenantId: opts.tenantId, addon: state.addon, eventType: "trial_start",
    source: opts.source === "admin" ? "admin" : "self", actorUserId: opts.actorUserId ?? null,
    metadata: { trialDays: state.addon.trialDays, trialEndsAt: trialEnd.toISOString() },
  });
  return row;
}

interface ActivatePaidOpts {
  tenantId: number;
  addonKey: string;
  billingCycle: "monthly" | "yearly" | "one_off";
  amount: number;
  currency?: string;
  paymentRef: string;
  source?: "self" | "admin" | "comp";
  actorUserId?: number | null;
}

/** Activate a paid add-on after checkout/manual payment confirmation. Idempotent on paymentRef. */
export async function activatePaidAddon(opts: ActivatePaidOpts): Promise<TenantAddon> {
  const state = await resolveAddonState(opts.tenantId, opts.addonKey);
  if (!state) throw new AddonError("NOT_FOUND", "Add-on not found");
  // Idempotency: same paymentRef => return existing install untouched.
  if (state.install?.lastPaymentRef && state.install.lastPaymentRef === opts.paymentRef) {
    return state.install;
  }
  const now = new Date();
  // Renewal/extend: if active and same cycle, extend from current end date.
  const startFrom = (state.install?.status === "active" && state.install.currentPeriodEndsAt && state.install.currentPeriodEndsAt.getTime() > now.getTime())
    ? state.install.currentPeriodEndsAt
    : now;
  const periodEnd = computePeriodEnd(opts.billingCycle, startFrom);
  const [row] = await db.insert(tenantAddonsTable).values({
    tenantId: opts.tenantId,
    addonId: state.addon.id,
    addonKey: state.addon.key,
    status: "active",
    source: opts.source ?? "self",
    billingCycle: opts.billingCycle,
    pricePaid: opts.amount.toFixed(2),
    currency: opts.currency ?? state.addon.pricing.currency ?? "INR",
    startedAt: state.install?.startedAt ?? now,
    currentPeriodEndsAt: periodEnd,
    lastPaymentRef: opts.paymentRef,
    cancelledAt: null,
  }).onConflictDoUpdate({
    target: [tenantAddonsTable.tenantId, tenantAddonsTable.addonId],
    set: {
      status: "active", source: opts.source ?? "self",
      billingCycle: opts.billingCycle,
      pricePaid: opts.amount.toFixed(2), currency: opts.currency ?? state.addon.pricing.currency ?? "INR",
      currentPeriodEndsAt: periodEnd, lastPaymentRef: opts.paymentRef, cancelledAt: null,
      updatedAt: new Date(),
    },
  }).returning();

  const wasTrial = state.install?.status === "trial";
  await logAddonEvent({
    tenantId: opts.tenantId, addon: state.addon, eventType: "payment",
    source: opts.source === "admin" || opts.source === "comp" ? "admin" : (opts.source === "self" ? "self" : "system"),
    actorUserId: opts.actorUserId ?? null,
    amount: opts.amount, currency: opts.currency ?? state.addon.pricing.currency ?? "INR",
    paymentRef: opts.paymentRef,
    metadata: { billingCycle: opts.billingCycle, currentPeriodEndsAt: periodEnd?.toISOString() ?? null },
  });
  if (wasTrial) {
    await logAddonEvent({
      tenantId: opts.tenantId, addon: state.addon, eventType: "trial_converted",
      source: "system", actorUserId: opts.actorUserId ?? null,
    });
  }
  await logAddonEvent({
    tenantId: opts.tenantId, addon: state.addon, eventType: "activate",
    source: "system", actorUserId: opts.actorUserId ?? null,
  });
  return row;
}

interface UninstallOpts {
  tenantId: number;
  addonKey: string;
  source?: "self" | "admin";
  actorUserId?: number | null;
  immediate?: boolean; // if true, deactivate now; else access continues to period end
}

export async function uninstallAddon(opts: UninstallOpts): Promise<TenantAddon | null> {
  const state = await resolveAddonState(opts.tenantId, opts.addonKey);
  if (!state) throw new AddonError("NOT_FOUND", "Add-on not found");
  if (!state.install) return null;
  const now = new Date();
  const updates: Partial<typeof tenantAddonsTable.$inferInsert> = {
    cancelledAt: now,
    updatedAt: now,
  };
  if (opts.immediate || state.install.status === "trial") {
    updates.status = "expired";
    updates.currentPeriodEndsAt = now;
    updates.trialEndsAt = state.install.status === "trial" ? now : state.install.trialEndsAt;
  } else {
    updates.status = "cancelled"; // remains active until currentPeriodEndsAt
  }
  const [row] = await db.update(tenantAddonsTable)
    .set(updates)
    .where(eq(tenantAddonsTable.id, state.install.id))
    .returning();
  await logAddonEvent({
    tenantId: opts.tenantId, addon: state.addon, eventType: "uninstall",
    source: opts.source === "admin" ? "admin" : "self", actorUserId: opts.actorUserId ?? null,
    metadata: { immediate: !!opts.immediate, endsAt: row.currentPeriodEndsAt?.toISOString() ?? null },
  });
  if (updates.status === "expired") {
    await logAddonEvent({
      tenantId: opts.tenantId, addon: state.addon, eventType: "deactivate",
      source: opts.source === "admin" ? "admin" : "self", actorUserId: opts.actorUserId ?? null,
    });
  }
  return row;
}

// ─── Super-admin overrides ───────────────────────────────────────────────────

export async function adminExtendTrial(opts: { tenantId: number; addonKey: string; days: number; actorUserId?: number | null }): Promise<TenantAddon> {
  if (opts.days <= 0) throw new AddonError("BAD_INPUT", "days must be > 0");
  const state = await resolveAddonState(opts.tenantId, opts.addonKey);
  if (!state) throw new AddonError("NOT_FOUND", "Add-on not found");
  if (!state.install) {
    // No install yet — start a trial of N days.
    return startTrial({ tenantId: opts.tenantId, addonKey: opts.addonKey, source: "admin", actorUserId: opts.actorUserId });
  }
  const base = state.install.trialEndsAt && state.install.trialEndsAt.getTime() > Date.now()
    ? state.install.trialEndsAt : new Date();
  const newEnd = new Date(base.getTime() + opts.days * 86400000);
  const [row] = await db.update(tenantAddonsTable)
    .set({ status: "trial", trialEndsAt: newEnd, cancelledAt: null, updatedAt: new Date() })
    .where(eq(tenantAddonsTable.id, state.install.id))
    .returning();
  await logAddonEvent({
    tenantId: opts.tenantId, addon: state.addon, eventType: "extend_trial",
    source: "admin", actorUserId: opts.actorUserId ?? null,
    notes: `Trial extended by ${opts.days} days`,
    metadata: { days: opts.days, newTrialEndsAt: newEnd.toISOString() },
  });
  return row;
}

export async function adminComp(opts: { tenantId: number; addonKey: string; months: number; actorUserId?: number | null }): Promise<TenantAddon> {
  if (opts.months <= 0) throw new AddonError("BAD_INPUT", "months must be > 0");
  const state = await resolveAddonState(opts.tenantId, opts.addonKey);
  if (!state) throw new AddonError("NOT_FOUND", "Add-on not found");
  const now = new Date();
  const base = state.install?.currentPeriodEndsAt && state.install.currentPeriodEndsAt.getTime() > now.getTime()
    ? state.install.currentPeriodEndsAt : now;
  const newEnd = new Date(base);
  newEnd.setMonth(newEnd.getMonth() + opts.months);
  const [row] = await db.insert(tenantAddonsTable).values({
    tenantId: opts.tenantId, addonId: state.addon.id, addonKey: state.addon.key,
    status: "active", source: "comp", billingCycle: "monthly",
    pricePaid: "0.00", currency: state.addon.pricing.currency ?? "INR",
    startedAt: state.install?.startedAt ?? now, currentPeriodEndsAt: newEnd, cancelledAt: null,
  }).onConflictDoUpdate({
    target: [tenantAddonsTable.tenantId, tenantAddonsTable.addonId],
    set: { status: "active", source: "comp", currentPeriodEndsAt: newEnd, cancelledAt: null, updatedAt: new Date() },
  }).returning();
  await logAddonEvent({
    tenantId: opts.tenantId, addon: state.addon, eventType: "comp",
    source: "admin", actorUserId: opts.actorUserId ?? null,
    notes: `Comped for ${opts.months} months`,
    metadata: { months: opts.months, currentPeriodEndsAt: newEnd.toISOString() },
  });
  return row;
}

/** Force-disable for all tenants when Super Admin disables an add-on at catalogue level. */
export async function disableAddonGlobally(addonId: number, actorUserId: number | null): Promise<number> {
  const installs = await db.select().from(tenantAddonsTable).where(and(
    eq(tenantAddonsTable.addonId, addonId),
    inArray(tenantAddonsTable.status, ["active", "trial"]),
  ));
  if (installs.length === 0) return 0;
  const now = new Date();
  await db.update(tenantAddonsTable)
    .set({ status: "expired", currentPeriodEndsAt: now, cancelledAt: now, updatedAt: now })
    .where(and(eq(tenantAddonsTable.addonId, addonId), inArray(tenantAddonsTable.status, ["active", "trial"])));
  const [addon] = await db.select().from(addonsTable).where(eq(addonsTable.id, addonId));
  if (addon) {
    for (const i of installs) {
      await logAddonEvent({
        tenantId: i.tenantId, addon, eventType: "catalogue_disabled",
        source: "admin", actorUserId,
        notes: "Add-on disabled at catalogue level",
      });
      await logAddonEvent({
        tenantId: i.tenantId, addon, eventType: "deactivate",
        source: "admin", actorUserId,
      });
    }
  }
  return installs.length;
}

// ─── Lifecycle sweep (cron) ──────────────────────────────────────────────────

/**
 * Sweep:
 *   - Trials past trialEndsAt => mark expired (no payment method to convert)
 *   - Cancelled installs past currentPeriodEndsAt => expired
 *   - Active installs past currentPeriodEndsAt with no renewal => expired
 *
 * Idempotent and safe to re-run. Real auto-renewal would charge a saved payment
 * method here; this MVP just expires access at period end.
 */
export async function sweepAddonLifecycle(now = new Date()): Promise<{ trialsExpired: number; periodsExpired: number }> {
  let trialsExpired = 0;
  let periodsExpired = 0;

  // 1. Expire trials past trialEndsAt
  const expiredTrials = await db.select().from(tenantAddonsTable).where(and(
    eq(tenantAddonsTable.status, "trial"),
    sql`${tenantAddonsTable.trialEndsAt} IS NOT NULL`,
    sql`${tenantAddonsTable.trialEndsAt} < ${now}`,
  ));
  for (const t of expiredTrials) {
    await db.update(tenantAddonsTable)
      .set({ status: "expired", updatedAt: now })
      .where(eq(tenantAddonsTable.id, t.id));
    const [addon] = await db.select().from(addonsTable).where(eq(addonsTable.id, t.addonId));
    if (addon) {
      await logAddonEvent({ tenantId: t.tenantId, addon, eventType: "trial_end", source: "system" });
      await logAddonEvent({ tenantId: t.tenantId, addon, eventType: "deactivate", source: "system" });
    }
    trialsExpired++;
  }

  // 2. Expire active/cancelled installs past currentPeriodEndsAt
  const expiredPeriods = await db.select().from(tenantAddonsTable).where(and(
    inArray(tenantAddonsTable.status, ["active", "cancelled"]),
    sql`${tenantAddonsTable.currentPeriodEndsAt} IS NOT NULL`,
    sql`${tenantAddonsTable.currentPeriodEndsAt} < ${now}`,
  ));
  for (const t of expiredPeriods) {
    await db.update(tenantAddonsTable)
      .set({ status: "expired", updatedAt: now })
      .where(eq(tenantAddonsTable.id, t.id));
    const [addon] = await db.select().from(addonsTable).where(eq(addonsTable.id, t.addonId));
    if (addon) {
      await logAddonEvent({ tenantId: t.tenantId, addon, eventType: "deactivate", source: "system", notes: "Period ended" });
    }
    periodsExpired++;
  }

  if (trialsExpired || periodsExpired) {
    logger.info({ trialsExpired, periodsExpired }, "[addons] lifecycle sweep");
  }
  return { trialsExpired, periodsExpired };
}

// ─── Per-add-on usage hooks ──────────────────────────────────────────────────

/**
 * Lightweight usage summary surfaced on the tenant's "Installed add-ons" view.
 * Returns a short string like "1,240 messages this month" — null for add-ons
 * we don't yet measure.
 */
export async function summarizeAddonUsage(tenantId: number, addonKey: string): Promise<string | null> {
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  try {
    if (addonKey === "khana_ai") {
      const { aiCreditTransactionsTable } = await import("./db");
      const rows = await db.select({
        used: sql<number>`coalesce(sum(case when ${aiCreditTransactionsTable.type} = 'debit' then -${aiCreditTransactionsTable.credits} else 0 end), 0)::int`,
      }).from(aiCreditTransactionsTable)
        .where(and(eq(aiCreditTransactionsTable.tenantId, tenantId), sql`${aiCreditTransactionsTable.createdAt} >= ${monthStart}`));
      return `${(rows[0]?.used ?? 0).toLocaleString("en-IN")} AI credits this month`;
    }
    if (addonKey === "whatsapp_marketing") {
      // Count outbound WhatsApp messages this month if the table exists.
      const result = await db.execute(sql`
        SELECT COUNT(*)::int AS c FROM whatsapp_messages wm
        JOIN restaurants r ON r.id = wm.restaurant_id
        WHERE r.tenant_id = ${tenantId}
          AND wm.direction = 'outbound'
          AND wm.created_at >= ${monthStart}
      `).catch(() => null);
      const c = (result as unknown as { rows?: Array<{ c: number }> } | null)?.rows?.[0]?.c ?? 0;
      return `${Number(c).toLocaleString("en-IN")} messages this month`;
    }
    if (addonKey === "online_ordering") {
      const result = await db.execute(sql`
        SELECT COUNT(*)::int AS c FROM orders o
        JOIN restaurants r ON r.id = o.restaurant_id
        WHERE r.tenant_id = ${tenantId}
          AND o.order_type IN ('delivery','pickup','online')
          AND o.created_at >= ${monthStart}
      `).catch(() => null);
      const c = (result as unknown as { rows?: Array<{ c: number }> } | null)?.rows?.[0]?.c ?? 0;
      return `${Number(c).toLocaleString("en-IN")} online orders this month`;
    }
  } catch (err) {
    logger.warn({ err, addonKey }, "[addons] usage summary failed");
  }
  return null;
}

// ─── Event log queries (for UIs) ─────────────────────────────────────────────

export interface EventQuery {
  tenantId?: number | null;
  addonKey?: string | null;
  eventType?: string | null;
  limit?: number;
}

export async function listEvents(q: EventQuery) {
  const limit = Math.min(500, Math.max(10, q.limit ?? 100));
  const conds = [] as ReturnType<typeof eq>[];
  if (q.tenantId) conds.push(eq(addonEventsTable.tenantId, q.tenantId));
  if (q.addonKey) conds.push(eq(addonEventsTable.addonKey, q.addonKey));
  if (q.eventType) conds.push(eq(addonEventsTable.eventType, q.eventType));
  const where = conds.length ? and(...conds) : undefined;
  return db.select().from(addonEventsTable).where(where).orderBy(desc(addonEventsTable.createdAt)).limit(limit);
}
