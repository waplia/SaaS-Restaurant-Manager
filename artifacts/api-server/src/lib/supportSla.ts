import { db, supportSlaSettingsTable, supportTicketCategoriesTable, type SupportSlaSettings, type TicketCategory, type TicketPriority, type TicketStatus, type SupportTicket } from "./db";
import { eq } from "drizzle-orm";

export const HOUR_MS = 60 * 60 * 1000;

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
 * per-ticket → per-category → priority default.
 */
export function resolveEffectiveSla(opts: {
  priority: TicketPriority;
  category: TicketCategory | null;
  ticketFirstResponseHours: number | null;
  ticketResolutionHours: number | null;
  settings: SupportSlaSettings;
}): SlaHours {
  const base = priorityDefaultHours(opts.settings, opts.priority);
  const fr = opts.ticketFirstResponseHours ?? opts.category?.firstResponseHours ?? base.firstResponseHours;
  const rs = opts.ticketResolutionHours ?? opts.category?.resolutionHours ?? base.resolutionHours;
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

/**
 * Compute the current SLA timer state for a ticket. Pause windows from
 * "Waiting for Customer" are added to the original due timestamps so the
 * remaining time effectively freezes during those windows.
 */
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
