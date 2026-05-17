/**
 * Implementation / Go-Live tracking (Task #435).
 *
 *  Tenant-side (owner/manager):
 *    GET    /implementations/me                       — current tenant's implementation + steps + post-launch tasks
 *    PATCH  /implementations/me/steps/:stepId         — update status / progress / notes for a checklist step
 *
 *  Super-admin board:
 *    GET    /admin/implementations                    — list all in-flight implementations with SLA timers
 *    POST   /admin/implementations/:tenantId          — bootstrap (and seed steps) for a tenant
 *    PATCH  /admin/implementations/:tenantId          — update manager, go-live date, SLA, status, notes
 *    PATCH  /admin/implementations/:tenantId/steps/:stepId — manager-side step edits (override owner, due date, etc.)
 *    POST   /admin/implementations/:tenantId/launch   — mark launched and auto-generate week-1/2/4 follow-ups
 *    POST   /admin/implementations/:tenantId/post-launch/:taskId/complete — tick off a post-launch task
 *    POST   /admin/implementations/check-stalls       — fire stalled-step notifications (cron-ish)
 */
import { Router } from "express";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  tenantsTable,
  usersTable,
  subscriptionPlansTable,
  implementationsTable,
  implementationStepsTable,
  implementationPostLaunchTasksTable,
  IMPLEMENTATION_STEP_TEMPLATE,
  notificationsTable,
  isFeatureEnabled,
  type ImplementationStepStatus,
} from "../lib/db";
import { requireRole, requireSuperAdmin } from "../middleware/authorize";
import { validate } from "../middleware/validate";
import { recordAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────

async function tenantHasDedicatedImplementation(tenantId: number): Promise<boolean> {
  const [row] = await db
    .select({ flags: subscriptionPlansTable.featureFlags })
    .from(tenantsTable)
    .leftJoin(subscriptionPlansTable, eq(tenantsTable.planId, subscriptionPlansTable.id))
    .where(eq(tenantsTable.id, tenantId));
  // Tenants without a plan are treated as not entitled (admin can still
  // bootstrap manually from the super-admin board — that path bypasses the gate).
  return !!row && isFeatureEnabled(row.flags ?? null, "dedicated_implementation");
}

async function ensureImplementation(tenantId: number) {
  const [existing] = await db.select().from(implementationsTable).where(eq(implementationsTable.tenantId, tenantId));
  if (existing) return existing;
  const [created] = await db.insert(implementationsTable).values({
    tenantId, status: "not_started",
  }).returning();
  // Seed the canonical step template so the checklist is immediately usable.
  await db.insert(implementationStepsTable).values(
    IMPLEMENTATION_STEP_TEMPLATE.map((s, idx) => ({
      implementationId: created.id,
      stepKey: s.key,
      title: s.title,
      description: s.description,
      ownerType: s.ownerType,
      position: idx,
    })),
  );
  return created;
}

async function loadImplementationPayload(tenantId: number) {
  const impl = await ensureImplementation(tenantId);
  const [steps, postLaunch, manager] = await Promise.all([
    db.select().from(implementationStepsTable)
      .where(eq(implementationStepsTable.implementationId, impl.id))
      .orderBy(implementationStepsTable.position, implementationStepsTable.id),
    db.select().from(implementationPostLaunchTasksTable)
      .where(eq(implementationPostLaunchTasksTable.implementationId, impl.id))
      .orderBy(implementationPostLaunchTasksTable.weekOffset, implementationPostLaunchTasksTable.id),
    impl.managerId
      ? db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
          .from(usersTable).where(eq(usersTable.id, impl.managerId)).then(rows => rows[0] ?? null)
      : Promise.resolve(null),
  ]);
  return { implementation: impl, steps, postLaunchTasks: postLaunch, manager };
}

function computeProgress(steps: Array<{ status: string; progressPct: number }>): number {
  if (steps.length === 0) return 0;
  const total = steps.reduce((acc, s) => acc + (s.status === "complete" ? 100 : s.status === "skipped" ? 100 : s.progressPct), 0);
  return Math.round(total / steps.length);
}

// ─── Tenant-side ──────────────────────────────────────────────────

router.get("/implementations/me", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const tenantId = req.user!.tenantId;
  if (!tenantId) return void res.status(400).json({ error: "No tenant" });
  const entitled = await tenantHasDedicatedImplementation(tenantId);
  const payload = await loadImplementationPayload(tenantId);
  res.json({ ...payload, entitled, progressPct: computeProgress(payload.steps) });
});

const StepUpdateBody = z.object({
  status: z.enum(["not_started", "in_progress", "blocked", "complete", "skipped"]).optional(),
  progressPct: z.number().int().min(0).max(100).optional(),
  ownerUserId: z.number().int().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

router.patch(
  "/implementations/me/steps/:stepId",
  requireRole("owner", "manager", "super_admin"),
  validate({ body: StepUpdateBody }),
  async (req, res) => {
    const tenantId = req.user!.tenantId;
    if (!tenantId) return void res.status(400).json({ error: "No tenant" });
    const stepId = Number(req.params.stepId);
    const [impl] = await db.select().from(implementationsTable).where(eq(implementationsTable.tenantId, tenantId));
    if (!impl) return void res.status(404).json({ error: "Implementation not found" });
    const [step] = await db.select().from(implementationStepsTable)
      .where(and(eq(implementationStepsTable.id, stepId), eq(implementationStepsTable.implementationId, impl.id)));
    if (!step) return void res.status(404).json({ error: "Step not found" });

    const body = req.body as z.infer<typeof StepUpdateBody>;
    const now = new Date();
    const next: Partial<typeof implementationStepsTable.$inferInsert> = {
      lastActivityAt: now, updatedAt: now,
    };
    if (body.status) {
      next.status = body.status;
      if (body.status === "complete" || body.status === "skipped") {
        next.completedAt = now;
        next.progressPct = 100;
      } else if (body.status === "not_started") {
        next.completedAt = null;
        if (body.progressPct === undefined) next.progressPct = 0;
      }
    }
    if (body.progressPct !== undefined) next.progressPct = body.progressPct;
    if (body.ownerUserId !== undefined) next.ownerUserId = body.ownerUserId;
    if (body.dueDate !== undefined) next.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.metadata) next.metadata = body.metadata;

    const [updated] = await db.update(implementationStepsTable).set(next)
      .where(eq(implementationStepsTable.id, stepId)).returning();

    // Auto-advance the parent implementation status.
    const allSteps = await db.select().from(implementationStepsTable)
      .where(eq(implementationStepsTable.implementationId, impl.id));
    const anyDone = allSteps.some(s => s.status !== "not_started");
    const allDoneOrSkipped = allSteps.every(s => s.status === "complete" || s.status === "skipped");
    if (impl.status === "not_started" && anyDone) {
      await db.update(implementationsTable).set({ status: "in_progress", startedAt: now, updatedAt: now })
        .where(eq(implementationsTable.id, impl.id));
    } else if (allDoneOrSkipped && impl.status !== "launched" && impl.status !== "complete" && impl.status !== "post_launch") {
      // All steps done — surface a hint but don't auto-launch (super-admin owns the launch action).
    }

    await recordAuditLog({
      req, module: "implementation", action: "implementation.step.update", entity: "implementation_step",
      entityId: stepId, oldValue: { status: step.status, progressPct: step.progressPct },
      newValue: { status: updated.status, progressPct: updated.progressPct },
    });
    res.json(updated);
  },
);

// ─── Super-admin board ────────────────────────────────────────────

router.get("/admin/implementations", requireSuperAdmin, async (_req, res) => {
  // Bootstrap a row for every tenant that has the entitlement so the board
  // shows the full pipeline, not just tenants someone manually opened.
  const tenants = await db
    .select({
      id: tenantsTable.id, name: tenantsTable.name, slug: tenantsTable.slug,
      planId: tenantsTable.planId,
      onboardingCompletedAt: tenantsTable.onboardingCompletedAt,
      planFlags: subscriptionPlansTable.featureFlags,
    })
    .from(tenantsTable)
    .leftJoin(subscriptionPlansTable, eq(tenantsTable.planId, subscriptionPlansTable.id));

  const entitledTenants = tenants.filter(t => isFeatureEnabled(t.planFlags ?? null, "dedicated_implementation"));
  // Ensure rows exist for entitled tenants.
  for (const t of entitledTenants) await ensureImplementation(t.id);

  const impls = await db.select().from(implementationsTable);
  const stepRows = impls.length === 0 ? [] : await db.select().from(implementationStepsTable)
    .where(inArray(implementationStepsTable.implementationId, impls.map(i => i.id)));
  const stepsByImpl = new Map<number, typeof stepRows>();
  for (const s of stepRows) {
    const arr = stepsByImpl.get(s.implementationId) ?? [];
    arr.push(s);
    stepsByImpl.set(s.implementationId, arr);
  }

  // Resolve manager names in one query.
  const managerIds = Array.from(new Set(impls.map(i => i.managerId).filter((x): x is number => x != null)));
  const managers = managerIds.length === 0 ? [] : await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable).where(inArray(usersTable.id, managerIds));
  const managerById = new Map(managers.map(m => [m.id, m]));

  const tenantById = new Map(tenants.map(t => [t.id, t]));
  const now = Date.now();
  const board = impls.map(impl => {
    const steps = stepsByImpl.get(impl.id) ?? [];
    const t = tenantById.get(impl.tenantId);
    const progress = computeProgress(steps);
    const stalledSteps = steps.filter(s =>
      (s.status === "in_progress" || s.status === "blocked") &&
      (now - new Date(s.lastActivityAt).getTime()) > 72 * 3600 * 1000,
    );
    const slaDeadline = impl.startedAt
      ? new Date(impl.startedAt).getTime() + impl.slaHours * 3600 * 1000
      : null;
    const slaRemainingHours = slaDeadline ? Math.round((slaDeadline - now) / (3600 * 1000)) : null;
    return {
      ...impl,
      tenant: t ? { id: t.id, name: t.name, slug: t.slug, onboardingCompletedAt: t.onboardingCompletedAt } : null,
      manager: impl.managerId ? managerById.get(impl.managerId) ?? null : null,
      progressPct: progress,
      stalledStepCount: stalledSteps.length,
      slaRemainingHours,
      slaBreached: slaRemainingHours != null && slaRemainingHours < 0 && impl.status !== "launched" && impl.status !== "complete" && impl.status !== "post_launch",
      stepsTotal: steps.length,
      stepsComplete: steps.filter(s => s.status === "complete" || s.status === "skipped").length,
    };
  }).sort((a, b) => {
    // Active first, then by SLA urgency, then by name.
    const aActive = a.status !== "complete" ? 0 : 1;
    const bActive = b.status !== "complete" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    const aSla = a.slaRemainingHours ?? Number.MAX_SAFE_INTEGER;
    const bSla = b.slaRemainingHours ?? Number.MAX_SAFE_INTEGER;
    return aSla - bSla;
  });

  res.json({ implementations: board });
});

router.get("/admin/implementations/:tenantId", requireSuperAdmin, async (req, res) => {
  const tenantId = Number(req.params.tenantId);
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) return void res.status(404).json({ error: "Tenant not found" });
  const payload = await loadImplementationPayload(tenantId);
  res.json({ ...payload, tenant, progressPct: computeProgress(payload.steps) });
});

const ImplementationUpdateBody = z.object({
  managerId: z.number().int().nullable().optional(),
  goLiveDate: z.string().datetime().nullable().optional(),
  slaHours: z.number().int().min(1).max(24 * 365).optional(),
  status: z.enum(["not_started", "in_progress", "blocked", "launched", "post_launch", "complete"]).optional(),
  notes: z.string().max(8000).nullable().optional(),
});

router.post("/admin/implementations/:tenantId", requireSuperAdmin, async (req, res) => {
  const tenantId = Number(req.params.tenantId);
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) return void res.status(404).json({ error: "Tenant not found" });
  await ensureImplementation(tenantId);
  const payload = await loadImplementationPayload(tenantId);
  await recordAuditLog({
    req, module: "implementation", action: "implementation.bootstrap",
    entity: "implementation", entityId: payload.implementation.id,
    newValue: { tenantId },
  });
  res.json(payload);
});

router.patch(
  "/admin/implementations/:tenantId",
  requireSuperAdmin,
  validate({ body: ImplementationUpdateBody }),
  async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const impl = await ensureImplementation(tenantId);
    const body = req.body as z.infer<typeof ImplementationUpdateBody>;
    const next: Partial<typeof implementationsTable.$inferInsert> = { updatedAt: new Date() };
    if (body.managerId !== undefined) next.managerId = body.managerId;
    if (body.goLiveDate !== undefined) next.goLiveDate = body.goLiveDate ? new Date(body.goLiveDate) : null;
    if (body.slaHours !== undefined) next.slaHours = body.slaHours;
    if (body.status !== undefined) next.status = body.status;
    if (body.notes !== undefined) next.notes = body.notes;
    if (body.status === "in_progress" && !impl.startedAt) next.startedAt = new Date();

    const [updated] = await db.update(implementationsTable).set(next)
      .where(eq(implementationsTable.id, impl.id)).returning();

    await recordAuditLog({
      req, module: "implementation", action: "implementation.update",
      entity: "implementation", entityId: impl.id,
      oldValue: {
        managerId: impl.managerId, goLiveDate: impl.goLiveDate, slaHours: impl.slaHours,
        status: impl.status, notes: impl.notes,
      },
      newValue: body,
    });

    // Notify the assigned manager when newly assigned.
    if (body.managerId && body.managerId !== impl.managerId) {
      try {
        const [t] = await db.select({ name: tenantsTable.name }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
        await db.insert(notificationsTable).values({
          type: "implementation_assigned",
          title: `You're the onboarding manager for ${t?.name ?? "a tenant"}`,
          message: `An implementation has been assigned to you. Open Super Admin → Implementation to start.`,
          entityId: impl.id, entityType: "implementation",
        });
      } catch (err) { logger.warn({ err, tenantId }, "implementation assignment notification failed"); }
    }
    res.json(updated);
  },
);

router.patch(
  "/admin/implementations/:tenantId/steps/:stepId",
  requireSuperAdmin,
  validate({ body: StepUpdateBody.extend({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    ownerType: z.enum(["restaurant", "manager"]).optional(),
  }) }),
  async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const stepId = Number(req.params.stepId);
    const impl = await ensureImplementation(tenantId);
    const [step] = await db.select().from(implementationStepsTable)
      .where(and(eq(implementationStepsTable.id, stepId), eq(implementationStepsTable.implementationId, impl.id)));
    if (!step) return void res.status(404).json({ error: "Step not found" });
    const body = req.body as z.infer<typeof StepUpdateBody> & {
      title?: string; description?: string | null; ownerType?: "restaurant" | "manager";
    };
    const now = new Date();
    const next: Partial<typeof implementationStepsTable.$inferInsert> = { lastActivityAt: now, updatedAt: now };
    if (body.status) {
      next.status = body.status as ImplementationStepStatus;
      if (body.status === "complete" || body.status === "skipped") {
        next.completedAt = now;
        next.progressPct = 100;
      }
    }
    if (body.progressPct !== undefined) next.progressPct = body.progressPct;
    if (body.ownerUserId !== undefined) next.ownerUserId = body.ownerUserId;
    if (body.ownerType !== undefined) next.ownerType = body.ownerType;
    if (body.dueDate !== undefined) next.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.metadata) next.metadata = body.metadata;
    if (body.title !== undefined) next.title = body.title;
    if (body.description !== undefined) next.description = body.description;

    const [updated] = await db.update(implementationStepsTable).set(next)
      .where(eq(implementationStepsTable.id, stepId)).returning();
    await recordAuditLog({
      req, module: "implementation", action: "implementation.step.admin_update",
      entity: "implementation_step", entityId: stepId,
      oldValue: { status: step.status, ownerType: step.ownerType, title: step.title },
      newValue: body,
    });
    res.json(updated);
  },
);

router.post("/admin/implementations/:tenantId/launch", requireSuperAdmin, async (req, res) => {
  const tenantId = Number(req.params.tenantId);
  const impl = await ensureImplementation(tenantId);
  const now = new Date();
  // Mark launched, stamp tenant onboardingCompletedAt, and seed week 1/2/4 follow-ups.
  await db.update(implementationsTable).set({
    status: "post_launch", launchedAt: now, updatedAt: now,
    goLiveDate: impl.goLiveDate ?? now,
  }).where(eq(implementationsTable.id, impl.id));

  await db.update(tenantsTable).set({ onboardingCompletedAt: now, updatedAt: now })
    .where(and(eq(tenantsTable.id, tenantId), sql`${tenantsTable.onboardingCompletedAt} IS NULL`));

  // Only seed if not already there (idempotent for re-runs).
  const existing = await db.select({ id: implementationPostLaunchTasksTable.id })
    .from(implementationPostLaunchTasksTable)
    .where(eq(implementationPostLaunchTasksTable.implementationId, impl.id));
  if (existing.length === 0) {
    const TEMPLATE = [
      { weekOffset: 1, title: "Week 1 health check",  description: "Confirm KOTs, payments, printers and staff usage are healthy after first 7 days." },
      { weekOffset: 2, title: "Week 2 check-in call", description: "30-minute review with owner — usage stats, blockers, training gaps." },
      { weekOffset: 4, title: "Month 1 business review", description: "Review revenue, orders, key reports; propose plan upgrades or add-ons." },
    ];
    await db.insert(implementationPostLaunchTasksTable).values(TEMPLATE.map(t => ({
      implementationId: impl.id,
      weekOffset: t.weekOffset,
      title: t.title,
      description: t.description,
      dueDate: new Date(now.getTime() + t.weekOffset * 7 * 24 * 3600 * 1000),
    })));
  }

  await recordAuditLog({
    req, module: "implementation", action: "implementation.launch",
    entity: "implementation", entityId: impl.id,
    newValue: { launchedAt: now.toISOString() },
  });
  res.json(await loadImplementationPayload(tenantId));
});

router.post(
  "/admin/implementations/:tenantId/post-launch/:taskId/complete",
  requireSuperAdmin,
  async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const taskId = Number(req.params.taskId);
    const impl = await ensureImplementation(tenantId);
    const [task] = await db.select().from(implementationPostLaunchTasksTable)
      .where(and(eq(implementationPostLaunchTasksTable.id, taskId), eq(implementationPostLaunchTasksTable.implementationId, impl.id)));
    if (!task) return void res.status(404).json({ error: "Post-launch task not found" });
    const userId = req.user?.sub ?? null;
    const now = new Date();
    await db.update(implementationPostLaunchTasksTable).set({
      completedAt: now, completedByUserId: userId, updatedAt: now,
    }).where(eq(implementationPostLaunchTasksTable.id, taskId));
    // If all post-launch tasks are done, flip implementation to `complete`.
    const remaining = await db.select({ id: implementationPostLaunchTasksTable.id })
      .from(implementationPostLaunchTasksTable)
      .where(and(
        eq(implementationPostLaunchTasksTable.implementationId, impl.id),
        sql`${implementationPostLaunchTasksTable.completedAt} IS NULL`,
      ));
    if (remaining.length === 0) {
      await db.update(implementationsTable).set({
        status: "complete", completedAt: now, updatedAt: now,
      }).where(eq(implementationsTable.id, impl.id));
    }
    await recordAuditLog({
      req, module: "implementation", action: "implementation.post_launch.complete",
      entity: "implementation_post_launch_task", entityId: taskId,
    });
    res.json({ ok: true });
  },
);

router.post("/admin/implementations/check-stalls", requireSuperAdmin, async (req, res) => {
  // Steps in `in_progress` / `blocked` with no activity for > 72h get a
  // notification — throttled at most once per 24h per implementation.
  const STALL_THRESHOLD_MS = 72 * 3600 * 1000;
  const THROTTLE_MS = 24 * 3600 * 1000;
  const now = Date.now();
  const impls = await db.select().from(implementationsTable)
    .where(inArray(implementationsTable.status, ["not_started", "in_progress", "blocked"]));
  let raised = 0;
  for (const impl of impls) {
    const lastAlert = impl.lastStallAlertAt ? new Date(impl.lastStallAlertAt).getTime() : 0;
    if (now - lastAlert < THROTTLE_MS) continue;
    const stalled = await db.select().from(implementationStepsTable)
      .where(and(
        eq(implementationStepsTable.implementationId, impl.id),
        inArray(implementationStepsTable.status, ["in_progress", "blocked"]),
      ));
    const stuck = stalled.filter(s => now - new Date(s.lastActivityAt).getTime() > STALL_THRESHOLD_MS);
    if (stuck.length === 0) continue;
    try {
      const [t] = await db.select({ name: tenantsTable.name }).from(tenantsTable).where(eq(tenantsTable.id, impl.tenantId));
      await db.insert(notificationsTable).values({
        type: "implementation_stalled",
        title: `${stuck.length} step(s) stalled for ${t?.name ?? "tenant"}`,
        message: `${stuck.map(s => s.title).slice(0, 3).join(", ")}${stuck.length > 3 ? "…" : ""} — no activity for 72+ hours.`,
        entityId: impl.id, entityType: "implementation",
      });
      await db.update(implementationsTable).set({ lastStallAlertAt: new Date(now), updatedAt: new Date() })
        .where(eq(implementationsTable.id, impl.id));
      raised++;
    } catch (err) { logger.warn({ err, implId: impl.id }, "stall notification failed"); }
  }
  await recordAuditLog({
    req, module: "implementation", action: "implementation.check_stalls",
    entity: "implementation", newValue: { raised },
  });
  res.json({ raised });
});

// Super-admin: searchable list of users that can be assigned as onboarding managers.
router.get("/admin/implementations/managers/search", requireSuperAdmin, async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const rows = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role })
    .from(usersTable)
    .where(and(
      eq(usersTable.isActive, true),
      // Super-admins (and tenant-less users) are eligible as onboarding managers.
      sql`(${usersTable.role} IN ('super_admin','owner','manager') OR ${usersTable.role} IS NULL)`,
      q ? sql`(${usersTable.name} ILIKE ${"%" + q + "%"} OR ${usersTable.email} ILIKE ${"%" + q + "%"})` : sql`TRUE`,
    ))
    .orderBy(desc(usersTable.role), usersTable.name)
    .limit(25);
  res.json({ users: rows });
});

export default router;
