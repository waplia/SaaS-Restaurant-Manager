/**
 * Follow-up sequence engine for the Email Center (Task #414).
 *
 * - `enrollInSequence` enqueues a recipient against a sequence
 * - `runSequenceTick` (called from the scheduler every minute) advances
 *   all enrollments whose `nextRunAt` is due, sends the next step's
 *   template, and updates `currentStep` / `nextRunAt`.
 * - Stop rules check the enrollment context against a small DSL
 *   (`{ "type": "user_logged_in", "withinHours": 48 }`).
 */
import { and, eq, lte, type SQL } from "drizzle-orm";
import {
  db,
  emailSequencesTable,
  emailSequenceStepsTable,
  emailSequenceEnrollmentsTable,
  restaurantsTable,
  type EmailSequence,
  type EmailSequenceStep,
  type EmailSequenceEnrollment,
} from "./db";
import { sendByTemplateKey } from "./emailSender";
import { logger } from "./logger";

export type EnrollOpts = {
  sequenceKey: string;
  email: string;
  name?: string | null;
  tenantId?: number | null;
  context?: Record<string, unknown>;
  startDelayHours?: number;
};

export async function enrollInSequence(opts: EnrollOpts): Promise<EmailSequenceEnrollment | null> {
  const [seq] = await db.select().from(emailSequencesTable).where(eq(emailSequencesTable.key, opts.sequenceKey));
  if (!seq || !seq.isEnabled) return null;
  // Skip duplicate active enrollment for the same recipient
  const existing = await db.select().from(emailSequenceEnrollmentsTable)
    .where(and(
      eq(emailSequenceEnrollmentsTable.sequenceId, seq.id),
      eq(emailSequenceEnrollmentsTable.recipientEmail, opts.email.trim().toLowerCase()),
      eq(emailSequenceEnrollmentsTable.status, "active"),
    ));
  if (existing.length) return existing[0]!;
  const nextRunAt = new Date(Date.now() + Math.max(0, opts.startDelayHours ?? 0) * 3600_000);
  const [row] = await db.insert(emailSequenceEnrollmentsTable).values({
    sequenceId: seq.id,
    tenantId: opts.tenantId ?? null,
    recipientEmail: opts.email.trim().toLowerCase(),
    recipientName: opts.name ?? null,
    context: (opts.context ?? {}) as Record<string, unknown>,
    currentStep: 0,
    status: "active",
    nextRunAt,
  }).returning();
  return row ?? null;
}

function shouldStop(seq: EmailSequence, enrollment: EmailSequenceEnrollment): string | null {
  const ctx = enrollment.context as Record<string, unknown>;
  for (const rule of seq.stopRules ?? []) {
    const t = rule.type;
    if (!t) continue;
    // Simple presence-based checks: `{ type: 'context.flag', flag: 'paid' }`
    if (t === "context_flag" && rule.value && typeof rule.value === "string") {
      if (ctx[rule.value]) return `flag:${rule.value}`;
    }
    if (t === "user_paid" && ctx["paid"]) return "user_paid";
    if (t === "user_logged_in" && ctx["loggedIn"]) return "user_logged_in";
  }
  return null;
}

export async function runSequenceTick(now: Date = new Date()): Promise<{ processed: number; sent: number; stopped: number }> {
  let processed = 0, sent = 0, stopped = 0;
  const due = await db.select().from(emailSequenceEnrollmentsTable)
    .where(and(eq(emailSequenceEnrollmentsTable.status, "active"), lte(emailSequenceEnrollmentsTable.nextRunAt, now)))
    .limit(200);
  for (const enr of due) {
    processed++;
    const [seq] = await db.select().from(emailSequencesTable).where(eq(emailSequencesTable.id, enr.sequenceId));
    if (!seq || !seq.isEnabled) {
      await db.update(emailSequenceEnrollmentsTable)
        .set({ status: "stopped", stopReason: "sequence disabled", lastRunAt: now })
        .where(eq(emailSequenceEnrollmentsTable.id, enr.id));
      stopped++;
      continue;
    }
    const stop = shouldStop(seq, enr);
    if (stop) {
      await db.update(emailSequenceEnrollmentsTable)
        .set({ status: "stopped", stopReason: stop, lastRunAt: now, completedAt: now })
        .where(eq(emailSequenceEnrollmentsTable.id, enr.id));
      stopped++;
      continue;
    }
    const steps: EmailSequenceStep[] = await db.select().from(emailSequenceStepsTable)
      .where(eq(emailSequenceStepsTable.sequenceId, seq.id))
      .orderBy(emailSequenceStepsTable.position);
    const step = steps[enr.currentStep];
    if (!step) {
      await db.update(emailSequenceEnrollmentsTable)
        .set({ status: "completed", lastRunAt: now, completedAt: now })
        .where(eq(emailSequenceEnrollmentsTable.id, enr.id));
      continue;
    }
    // Step-level optional condition: when present and not satisfied,
    // skip the send and advance to the next step. Otherwise fall through
    // to the regular send path.
    const stepCondition = (step as { conditionJson?: Record<string, unknown> | null }).conditionJson;
    const ctxForCond = { ...(enr.context as Record<string, unknown> ?? {}), email: enr.recipientEmail, name: enr.recipientName };
    const { evaluateCondition } = await import("./emailAutomations");
    const conditionOk = !stepCondition || Object.keys(stepCondition).length === 0
      ? true
      : evaluateCondition(stepCondition, ctxForCond as never);
    if (step.isEnabled && conditionOk) {
      try {
        const vars = { name: enr.recipientName ?? "there", ...(enr.context as Record<string, unknown>) };
        const result = await sendByTemplateKey(step.templateKey, enr.recipientEmail, vars, {
          tenantId: enr.tenantId ?? null,
          // Do not force a kind: sendByTemplateKey will derive marketing vs
          // transactional from the template's category so marketing-category
          // steps go through opt-in / suppression / plan gating correctly.
          sequenceId: seq.id,
          sequenceStepId: step.id,
          enrollmentId: enr.id,
        });
        if (result?.ok) sent++;
      } catch (err) {
        logger.warn({ err, enrollmentId: enr.id, step: step.id }, "Sequence step send failed");
      }
    } else if (!conditionOk) {
      logger.info({ enrollmentId: enr.id, step: step.id }, "Sequence step skipped — condition not met");
    }
    const nextStepIdx = enr.currentStep + 1;
    const nextStep = steps[nextStepIdx];
    if (!nextStep) {
      await db.update(emailSequenceEnrollmentsTable)
        .set({ status: "completed", currentStep: nextStepIdx, lastRunAt: now, completedAt: now })
        .where(eq(emailSequenceEnrollmentsTable.id, enr.id));
    } else {
      const delayMs = Math.max(0, nextStep.delayHours ?? 0) * 3600_000;
      await db.update(emailSequenceEnrollmentsTable)
        .set({ currentStep: nextStepIdx, lastRunAt: now, nextRunAt: new Date(now.getTime() + delayMs) })
        .where(eq(emailSequenceEnrollmentsTable.id, enr.id));
    }
  }
  if (processed) logger.info({ processed, sent, stopped }, "[email-sequences] tick");
  return { processed, sent, stopped };
}

/**
 * Trigger-based enrollment: when a domain event fires
 * (e.g. user.signup → "signup", trial.started → "trial_started",
 * payment.failed → "payment_failed"), enroll the recipient in any
 * enabled sequence whose `trigger` matches.
 */
export async function enrollSequencesForTrigger(trigger: string, ctx: {
  email?: string | null;
  name?: string | null;
  tenantId?: number | null;
  [k: string]: unknown;
}): Promise<number> {
  const email = (ctx.email ?? "").toString().trim().toLowerCase();
  if (!email) return 0;
  // Map domain event names to sequence trigger keys.
  const map: Record<string, string> = {
    "user.signup": "signup",
    "trial.started": "trial_started",
    "trial.ending": "trial_ending",
    "payment.failed": "payment_failed",
    "payment.succeeded": "payment_succeeded",
    "subscription.activated": "subscription_activated",
    "subscription.cancelled": "subscription_cancelled",
    "demo.lead.created": "demo_lead_created",
    "restaurant.inactive": "inactive_restaurant",
  };
  const key = map[trigger] ?? trigger;
  const seqs = await db.select().from(emailSequencesTable)
    .where(and(eq(emailSequencesTable.trigger, key), eq(emailSequencesTable.isEnabled, true)));
  let enrolled = 0;
  for (const seq of seqs) {
    const row = await enrollInSequence({
      sequenceKey: seq.key,
      email,
      name: (ctx.name as string | null) ?? null,
      tenantId: (ctx.tenantId as number | null) ?? null,
      context: ctx,
    });
    if (row) enrolled++;
  }
  return enrolled;
}

export async function stopEnrollment(id: number, reason: string): Promise<void> {
  await db.update(emailSequenceEnrollmentsTable)
    .set({ status: "stopped", stopReason: reason, lastRunAt: new Date(), completedAt: new Date() })
    .where(eq(emailSequenceEnrollmentsTable.id, id));
}

export async function stopEnrollmentsByEmail(
  email: string,
  reason: string,
  scope: { restaurantId?: number | null } = {},
): Promise<void> {
  const conds: SQL[] = [
    eq(emailSequenceEnrollmentsTable.recipientEmail, email.trim().toLowerCase()),
    eq(emailSequenceEnrollmentsTable.status, "active"),
  ];
  // Honor restaurant-scoped unsubscribe by resolving restaurant → tenant and
  // scoping the stop to that tenant's enrollments only. The enrollments table
  // tracks tenantId (not restaurantId), so cross-restaurant enrollments inside
  // the same tenant will still be stopped — the alternative (no scope) is
  // strictly worse since it would stop unrelated tenants too.
  if (scope.restaurantId) {
    const [rest] = await db
      .select({ tenantId: restaurantsTable.tenantId })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.id, scope.restaurantId))
      .limit(1);
    if (rest?.tenantId) {
      conds.push(eq(emailSequenceEnrollmentsTable.tenantId, rest.tenantId));
    } else {
      // Unknown restaurant → refuse to stop anything rather than going global.
      return;
    }
  }
  await db.update(emailSequenceEnrollmentsTable)
    .set({ status: "stopped", stopReason: reason, lastRunAt: new Date(), completedAt: new Date() })
    .where(and(...conds));
}
