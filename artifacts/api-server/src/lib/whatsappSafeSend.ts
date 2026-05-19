/**
 * Task #506 — Safe-send guard rails applied at the WhatsApp dispatcher,
 * independently of which provider (Cloud API or Web QR) handles the send.
 *
 * Every rule is evaluated against the restaurant's whatsapp_settings row.
 * A guard returns `{ ok: false, reason }` to instruct the dispatcher to
 * log a blocked row with the given reason and stop.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import {
  db,
  whatsappLogsTable,
  customersTable,
  restaurantsTable,
  type WhatsAppSetting,
} from "./db";

export type SafeSendCategory = "marketing" | "transactional" | "system";

export interface SafeSendContext {
  restaurantId: number;
  settings: WhatsAppSetting;
  to: string;
  body: string | null | undefined;
  templateName: string | null | undefined;
  category: SafeSendCategory;
}

export interface SafeSendVerdict {
  ok: boolean;
  reason?: string;
}

/** Strip the WhatsApp scheme/+ and non-digits so comparisons are stable. */
export function normalizeRecipient(p: string): string {
  return p.replace(/^whatsapp:/i, "").replace(/[^\d]/g, "");
}

function parseHM(value: string | null | undefined): { h: number; m: number } | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm) || h > 23 || mm > 59) return null;
  return { h, m: mm };
}

/** Returns true when `now` falls inside the closed quiet-hours window. */
export function isInQuietWindow(now: Date, startStr: string | null, endStr: string | null, timeZone: string): boolean {
  const start = parseHM(startStr);
  const end = parseHM(endStr);
  if (!start || !end) return false;
  // Render now in the restaurant timezone using Intl.
  let hh = 0, mm = 0;
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
    const parts = fmt.formatToParts(now);
    hh = Number(parts.find(p => p.type === "hour")?.value ?? "0");
    mm = Number(parts.find(p => p.type === "minute")?.value ?? "0");
  } catch {
    hh = now.getUTCHours();
    mm = now.getUTCMinutes();
  }
  const minutes = hh * 60 + mm;
  const s = start.h * 60 + start.m;
  const e = end.h * 60 + end.m;
  if (s === e) return false;
  if (s < e) return minutes >= s && minutes < e;
  // Window wraps midnight (e.g. 22:00 → 08:00)
  return minutes >= s || minutes < e;
}

async function countSentSince(restaurantId: number, since: Date): Promise<number> {
  const [row] = await db.select({ c: sql<number>`count(*)::int` })
    .from(whatsappLogsTable)
    .where(and(
      eq(whatsappLogsTable.restaurantId, restaurantId),
      gte(whatsappLogsTable.createdAt, since),
      sql`${whatsappLogsTable.status} IN ('sent','delivered','read')`,
    ));
  return Number(row?.c ?? 0);
}

async function lastSendAt(restaurantId: number): Promise<Date | null> {
  const [row] = await db.select({ at: whatsappLogsTable.createdAt })
    .from(whatsappLogsTable)
    .where(and(
      eq(whatsappLogsTable.restaurantId, restaurantId),
      sql`${whatsappLogsTable.status} IN ('sent','delivered','read')`,
    ))
    .orderBy(sql`${whatsappLogsTable.createdAt} desc`)
    .limit(1);
  return row?.at ?? null;
}

async function hasDuplicateWithin(restaurantId: number, recipient: string, body: string, since: Date): Promise<boolean> {
  const norm = normalizeRecipient(recipient);
  const [row] = await db.select({ id: whatsappLogsTable.id })
    .from(whatsappLogsTable)
    .where(and(
      eq(whatsappLogsTable.restaurantId, restaurantId),
      sql`regexp_replace(${whatsappLogsTable.recipient}, '[^0-9]', '', 'g') = ${norm}`,
      eq(whatsappLogsTable.body, body),
      gte(whatsappLogsTable.createdAt, since),
    ))
    .limit(1);
  return !!row;
}

async function getCustomerOptIn(restaurantId: number, recipient: string): Promise<boolean> {
  const norm = normalizeRecipient(recipient);
  if (!norm) return false;
  const [row] = await db.select({ optIn: customersTable.whatsappOptIn })
    .from(customersTable)
    .where(and(
      eq(customersTable.restaurantId, restaurantId),
      sql`regexp_replace(coalesce(${customersTable.phone}, ''), '[^0-9]', '', 'g') = ${norm}`,
    ))
    .limit(1);
  return !!row?.optIn;
}

/**
 * Apply all safe-send checks. Order: opt-in/marketing toggles → quiet hours →
 * min-delay → hourly cap → daily cap → duplicate-window. The first failed
 * check returns its reason so logs are easy to triage.
 *
 * `category=system` bypasses opt-in and quiet-hours but still respects rate
 * limits. `category=transactional` bypasses opt-in and quiet-hours; rate
 * limits still apply to protect Web QR session health.
 */
export async function applySafeSendGuards(ctx: SafeSendContext): Promise<SafeSendVerdict> {
  const s = ctx.settings;

  // Marketing-only gates.
  if (ctx.category === "marketing") {
    if (!s.marketingAllowed) return { ok: false, reason: "marketing_disabled" };
    if (s.marketingOptInRequired) {
      const hasOpt = await getCustomerOptIn(ctx.restaurantId, ctx.to);
      if (!hasOpt) return { ok: false, reason: "opt_in_required" };
    }
    if (s.safeSendQuietStart && s.safeSendQuietEnd) {
      const [rest] = await db.select({ tz: restaurantsTable.timezone }).from(restaurantsTable).where(eq(restaurantsTable.id, ctx.restaurantId));
      const tz = rest?.tz ?? "Asia/Kolkata";
      if (isInQuietWindow(new Date(), s.safeSendQuietStart, s.safeSendQuietEnd, tz)) {
        return { ok: false, reason: "safe_send_quiet_hours" };
      }
    }
  }

  // Universal pace controls (apply to all non-system messages — protect both providers).
  if (ctx.category !== "system") {
    if (s.safeSendMinDelaySec > 0) {
      const last = await lastSendAt(ctx.restaurantId);
      if (last) {
        const deltaSec = (Date.now() - last.getTime()) / 1000;
        if (deltaSec < s.safeSendMinDelaySec) return { ok: false, reason: "safe_send_min_delay" };
      }
    }
    if (s.safeSendHourlyCap > 0) {
      const since = new Date(Date.now() - 60 * 60 * 1000);
      const c = await countSentSince(ctx.restaurantId, since);
      if (c >= s.safeSendHourlyCap) return { ok: false, reason: "safe_send_hourly" };
    }
    if (s.safeSendDailyCap > 0) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const c = await countSentSince(ctx.restaurantId, since);
      if (c >= s.safeSendDailyCap) return { ok: false, reason: "safe_send_daily" };
    }
    if (s.safeSendDuplicateWindowSec > 0 && ctx.body) {
      const since = new Date(Date.now() - s.safeSendDuplicateWindowSec * 1000);
      const dup = await hasDuplicateWithin(ctx.restaurantId, ctx.to, ctx.body, since);
      if (dup) return { ok: false, reason: "safe_send_duplicate" };
    }
  }

  return { ok: true };
}
