/**
 * Automation rule engine for the Email Center (Task #414).
 *
 * Automations are stored in `email_automations` and consist of:
 *   - a trigger string (e.g. "user.signup", "order.delivered")
 *   - a JSON condition (`{ "tenant.planId": 3, "context.totalAmount": { ">": 500 } }`)
 *   - a list of actions: { type: "send_template", params: { key, to, vars? } }
 *                        { type: "enroll_sequence", params: { sequenceKey } }
 *                        { type: "notify", params: { title, message } }
 *
 * Call `runAutomationsForEvent("user.signup", { ... })` from the place
 * where the event happens (no need to await — fire-and-forget is fine).
 */
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  emailAutomationsTable,
  emailAutomationRunsTable,
  notificationsTable,
} from "./db";
import { sendByTemplateKey } from "./emailSender";
import { enrollInSequence } from "./emailSequences";
import { logger } from "./logger";

type Cond = unknown;
type Ctx = Record<string, unknown>;

function lookup(ctx: Ctx, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object" && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, ctx);
}

function matchOperator(actual: unknown, expected: Cond): boolean {
  if (expected === null || expected === undefined) return actual === expected;
  if (Array.isArray(expected)) return expected.some(v => matchOperator(actual, v));
  if (typeof expected === "object") {
    const obj = expected as Record<string, unknown>;
    for (const [op, v] of Object.entries(obj)) {
      if (op === "$eq") { if (actual !== v) return false; continue; }
      if (op === "$ne") { if (actual === v) return false; continue; }
      if (op === "$in") { if (!Array.isArray(v) || !v.includes(actual)) return false; continue; }
      if (op === ">"  && !(typeof actual === "number" && actual > Number(v))) return false;
      if (op === ">=" && !(typeof actual === "number" && actual >= Number(v))) return false;
      if (op === "<"  && !(typeof actual === "number" && actual < Number(v))) return false;
      if (op === "<=" && !(typeof actual === "number" && actual <= Number(v))) return false;
      if (op === "$contains" && typeof actual === "string" && typeof v === "string" && !actual.toLowerCase().includes(v.toLowerCase())) return false;
    }
    return true;
  }
  return actual === expected;
}

export function evaluateCondition(condition: Record<string, unknown> | null | undefined, ctx: Ctx): boolean {
  if (!condition || Object.keys(condition).length === 0) return true;
  for (const [path, expected] of Object.entries(condition)) {
    const actual = lookup(ctx, path);
    if (!matchOperator(actual, expected)) return false;
  }
  return true;
}

async function runAction(action: { type: string; params?: Record<string, unknown> }, ctx: Ctx): Promise<void> {
  const p = action.params ?? {};
  switch (action.type) {
    case "send_template": {
      const key = String(p.key ?? "");
      const to = String(p.to ?? lookup(ctx, "email") ?? lookup(ctx, "recipientEmail") ?? "");
      if (!key || !to) return;
      const vars = { ...(p.vars as Record<string, unknown> | undefined ?? {}), ...ctx };
      await sendByTemplateKey(key, to, vars, {
        tenantId: (lookup(ctx, "tenantId") as number) ?? null,
        restaurantId: (lookup(ctx, "restaurantId") as number) ?? null,
        automationId: (lookup(ctx, "__automationId") as number) ?? null,
      });
      return;
    }
    case "enroll_sequence": {
      const sequenceKey = String(p.sequenceKey ?? "");
      const email = String(p.to ?? lookup(ctx, "email") ?? "");
      if (!sequenceKey || !email) return;
      await enrollInSequence({
        sequenceKey, email,
        name: (lookup(ctx, "name") as string) ?? null,
        tenantId: (lookup(ctx, "tenantId") as number) ?? null,
        context: ctx,
      });
      return;
    }
    case "notify": {
      const restaurantId = (lookup(ctx, "restaurantId") as number) ?? null;
      if (!restaurantId) return;
      await db.insert(notificationsTable).values({
        restaurantId,
        type: "automation",
        title: String(p.title ?? "Automation event"),
        message: String(p.message ?? action.type),
        entityType: "email_automation",
      }).catch(() => {});
      return;
    }
    default:
      logger.warn({ action }, "Unknown automation action type — skipped");
  }
}

export async function runAutomationsForEvent(trigger: string, ctx: Ctx): Promise<void> {
  try {
    // Also enroll any matching follow-up sequences for this trigger so a
    // single domain event drives both ad-hoc automations and multi-step
    // sequences.
    void (async () => {
      try {
        const { enrollSequencesForTrigger } = await import("./emailSequences");
        await enrollSequencesForTrigger(trigger, {
          email: (ctx as Record<string, unknown>).userEmail as string | undefined
            ?? (ctx as Record<string, unknown>).email as string | undefined
            ?? null,
          name: (ctx as Record<string, unknown>).userName as string | undefined
            ?? (ctx as Record<string, unknown>).name as string | undefined
            ?? null,
          tenantId: (ctx as Record<string, unknown>).tenantId as number | undefined ?? null,
          ...(ctx as Record<string, unknown>),
        });
      } catch (err) {
        logger.warn({ err, trigger }, "sequence enrollment for trigger failed");
      }
    })();
    const rows = await db.select().from(emailAutomationsTable)
      .where(and(eq(emailAutomationsTable.trigger, trigger), eq(emailAutomationsTable.isEnabled, true)));
    for (const aut of rows) {
      const matched = evaluateCondition(aut.conditionJson as Record<string, unknown>, ctx);
      let ran = 0;
      let status: "ok" | "failed" | "skipped" = matched ? "ok" : "skipped";
      let errMsg: string | null = null;
      if (matched) {
        const ctxWithId = { ...(ctx as Record<string, unknown>), __automationId: aut.id } as Ctx;
        for (const action of (aut.actions ?? [])) {
          try { await runAction(action, ctxWithId); ran++; }
          catch (err) { status = "failed"; errMsg = (err as Error).message ?? String(err); }
        }
        await db.update(emailAutomationsTable).set({
          runCount: sql`${emailAutomationsTable.runCount} + 1`,
          lastRunAt: new Date(),
        }).where(eq(emailAutomationsTable.id, aut.id));
      }
      await db.insert(emailAutomationRunsTable).values({
        automationId: aut.id, trigger, context: ctx, matched,
        actionsRun: ran, status, error: errMsg,
      }).catch(() => {});
    }
  } catch (err) {
    logger.error({ err, trigger }, "runAutomationsForEvent failed");
  }
}
