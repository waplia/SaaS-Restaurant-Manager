import {
  db,
  supportSlaSettingsTable,
  supportTicketCategoriesTable,
  tenantsTable,
  subscriptionPlansTable,
  DEFAULT_TIER_CONFIG,
  type SupportSlaSettings,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
  type SupportTicket,
  type SupportTier,
  type SlaTierConfig,
  type SlaEscalationMatrix,
  type SlaEscalationStep,
} from "./db";
import { eq } from "drizzle-orm";

export const HOUR_MS = 60 * 60 * 1000;
const TIERS = new Set<SupportTier>(["standard", "priority", "enterprise"]);

export async function getSlaSettings(): Promise<SupportSlaSettings> {
  const [row] = await db.select().from(supportSlaSettingsTable).limit(1);
  if (row) return row;
  const [created] = await db.insert(supportSlaSettingsTable).values({}).returning();
  return created;
}

export interface SlaHours {
  firstResponseHours: number;
  resolutionHours: number;
}

export function priorityDefaultHours(settings: SupportSlaSettings, priority: TicketPriority): SlaHours {
  switch (priority) {
    case "low":     return { firstResponseHours: settings.lowFirstResponseHours,     resolutionHours: settings.lowResolutionHours };
    case "high":    return { firstResponseHours: settings.highFirstResponseHours,    resolutionHours: settings.highResolutionHours };
    case "urgent":  return { firstResponseHours: settings.urgentFirstResponseHours,  resolutionHours: settings.urgentResolutionHours };
    case "normal":
    default:        return { firstResponseHours: settings.normalFirstResponseHours,  resolutionHours: settings.normalResolutionHours };
  }
}

/**
 * Resolve the effective SLA hours for a ticket, applying overrides in order:
 * per-ticket → per-category → priority default → tier multiplier.
 *
 * Task #436: an explicit `tier` argument shrinks the hours according to the
 * tenant's SLA tier. `standard` is 1x; `priority` is 0.5x; `enterprise` is
 * 0.25x by default (overridable from SLA settings).
 */
export function resolveEffectiveSla(opts: {
  priority: TicketPriority;
  category: TicketCategory | null;
  ticketFirstResponseHours: number | null;
  ticketResolutionHours: number | null;
  settings: SupportSlaSettings;
  tier?: SupportTier;
}): SlaHours {
  const base = priorityDefaultHours(opts.settings, opts.priority);
  const fr = opts.ticketFirstResponseHours ?? opts.category?.firstResponseHours ?? base.firstResponseHours;
  const rs = opts.ticketResolutionHours ?? opts.category?.resolutionHours ?? base.resolutionHours;
  if (opts.tier) {
    const cfg = getTierConfig(opts.settings, opts.tier);
    return {
      firstResponseHours: Math.max(0.25, fr * cfg.firstResponseMultiplier),
      resolutionHours:    Math.max(0.5,  rs * cfg.resolutionMultiplier),
    };
  }
  return { firstResponseHours: fr, resolutionHours: rs };
}

export async function getCategoryById(id: number | null | undefined): Promise<TicketCategory | null> {
  if (!id) return null;
  const [row] = await db.select().from(supportTicketCategoriesTable).where(eq(supportTicketCategoriesTable.id, id));
  return row ?? null;
}

export interface TicketSlaInfo {
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
  firstResponseRemainingMs: number | null;
  resolutionRemainingMs: number | null;
  firstResponseBreached: boolean;
  resolutionBreached: boolean;
  isPaused: boolean;
  pausedMs: number;
}

export function computeSlaInfo(ticket: SupportTicket, now: Date = new Date()): TicketSlaInfo {
  const isPaused = ticket.status === "waiting_customer" && !!ticket.pausedAt;
  const liveExtraMs = isPaused && ticket.pausedAt ? Math.max(0, now.getTime() - ticket.pausedAt.getTime()) : 0;
  const totalPaused = ticket.pausedMs + liveExtraMs;

  const adjust = (due: Date | null) => (due ? new Date(due.getTime() + totalPaused) : null);
  const firstDue = adjust(ticket.firstResponseDueAt);
  const resDue = adjust(ticket.resolutionDueAt);

  const firstSettled = !!ticket.firstResponseAt;
  const resolved = !!ticket.resolvedAt || ticket.status === "resolved" || ticket.status === "closed";

  const firstRemaining = firstSettled || !firstDue ? null : firstDue.getTime() - now.getTime();
  const resRemaining = resolved || !resDue ? null : resDue.getTime() - now.getTime();

  return {
    firstResponseDueAt: firstDue,
    resolutionDueAt: resDue,
    firstResponseRemainingMs: firstRemaining,
    resolutionRemainingMs: resRemaining,
    firstResponseBreached: !firstSettled && firstRemaining !== null && firstRemaining < 0,
    resolutionBreached: !resolved && resRemaining !== null && resRemaining < 0,
    isPaused,
    pausedMs: totalPaused,
  };
}

export function isOpenStatus(status: TicketStatus): boolean {
  return status !== "resolved" && status !== "closed";
}

/* ------------------------------------------------------------------ *
 * Task #436 — Tier resolution & escalation matrix helpers.
 * ------------------------------------------------------------------ */

function asTier(raw: unknown): SupportTier | null {
  return typeof raw === "string" && TIERS.has(raw as SupportTier) ? (raw as SupportTier) : null;
}

/**
 * Resolve the SLA tier for a tenant. We look at the tenant's plan's
 * `featureFlags.support_tier` first (so plan editors can re-tag without a
 * migration), then fall back to `priority_support` → "priority", else
 * "standard". The lookup is intentionally tolerant: missing plan, missing
 * flag, or unknown value all degrade to "standard" rather than throwing.
 */
export async function getTenantSupportTier(tenantId: number | null | undefined): Promise<SupportTier> {
  if (!tenantId) return "standard";
  const [row] = await db
    .select({ planId: tenantsTable.planId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId));
  if (!row?.planId) return "standard";
  const [plan] = await db
    .select({ flags: subscriptionPlansTable.featureFlags })
    .from(subscriptionPlansTable)
    .where(eq(subscriptionPlansTable.id, row.planId));
  const flags = (plan?.flags ?? {}) as Record<string, unknown>;
  const explicit = asTier(flags["support_tier"]);
  if (explicit) return explicit;
  if (flags["priority_support"] === true) return "priority";
  return "standard";
}

/** Merge stored per-tier overrides over the built-in defaults. */
export function getTierConfig(settings: SupportSlaSettings, tier: SupportTier): SlaTierConfig {
  const stored = (settings.tierConfig ?? {})[tier];
  const def = DEFAULT_TIER_CONFIG[tier];
  if (!stored) return def;
  return {
    firstResponseMultiplier: typeof stored.firstResponseMultiplier === "number" && stored.firstResponseMultiplier > 0
      ? stored.firstResponseMultiplier : def.firstResponseMultiplier,
    resolutionMultiplier: typeof stored.resolutionMultiplier === "number" && stored.resolutionMultiplier > 0
      ? stored.resolutionMultiplier : def.resolutionMultiplier,
    emergencyEnabled: typeof stored.emergencyEnabled === "boolean" ? stored.emergencyEnabled : def.emergencyEnabled,
    callbackEnabled: typeof stored.callbackEnabled === "boolean" ? stored.callbackEnabled : def.callbackEnabled,
  };
}

export interface TierCapabilities extends SlaTierConfig {
  tier: SupportTier;
  liveChatUrl: string | null;
  firstResponseHoursByPriority: Record<TicketPriority, number>;
  resolutionHoursByPriority: Record<TicketPriority, number>;
}

/** Build the tier-aware capability summary surfaced to tenants. */
export function describeTierCapabilities(settings: SupportSlaSettings, tier: SupportTier): TierCapabilities {
  const cfg = getTierConfig(settings, tier);
  const priorities: TicketPriority[] = ["low", "normal", "high", "urgent"];
  const fr = {} as Record<TicketPriority, number>;
  const rs = {} as Record<TicketPriority, number>;
  for (const p of priorities) {
    const base = priorityDefaultHours(settings, p);
    fr[p] = +(base.firstResponseHours * cfg.firstResponseMultiplier).toFixed(2);
    rs[p] = +(base.resolutionHours    * cfg.resolutionMultiplier).toFixed(2);
  }
  return {
    tier,
    ...cfg,
    liveChatUrl: settings.liveChatUrl ?? null,
    firstResponseHoursByPriority: fr,
    resolutionHoursByPriority: rs,
  };
}

/**
 * Returns the escalation steps for a priority sorted by `afterMinutes`. The
 * SLA breach sweep iterates this and fires each step exactly once.
 */
export function escalationStepsFor(settings: SupportSlaSettings, priority: TicketPriority): SlaEscalationStep[] {
  const matrix = (settings.escalationMatrix ?? {}) as SlaEscalationMatrix;
  const steps = matrix[priority] ?? [];
  return [...steps]
    .filter(s => s && Array.isArray(s.notifyEmails) && Number.isFinite(s.afterMinutes) && s.afterMinutes >= 0)
    .sort((a, b) => a.afterMinutes - b.afterMinutes);
}
