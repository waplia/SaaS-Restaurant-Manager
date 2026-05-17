/**
 * Email Center (Task #414) — extension of admin-email.ts covering:
 *   sequences, automations, marketing templates, campaigns,
 *   suppression list, variables registry, AI authoring, reports,
 *   and restaurant-scoped email settings + campaigns.
 *
 * Lives as a separate router so the original admin-email.ts (providers,
 * templates, logs, announcements) stays untouched.
 */
import { Router, type IRouter } from "express";
import { and, desc, eq, gt, gte, sql, type SQL } from "drizzle-orm";
import {
  db,
  emailTemplatesTable,
  emailTemplateVersionsTable,
  emailTemplateVariablesTable,
  emailLogsTable,
  emailTrackingEventsTable,
  emailSuppressionListTable,
  emailUnsubscribesTable,
  emailSequencesTable,
  emailSequenceStepsTable,
  emailSequenceEnrollmentsTable,
  emailAutomationsTable,
  emailAutomationRunsTable,
  emailMarketingTemplatesTable,
  emailCampaignsTable,
  emailCampaignRecipientsTable,
  emailRestaurantSettingsTable,
  emailMonthlyUsageTable,
  auditLogsTable,
  customersTable,
  restaurantsTable,
  tenantsTable,
  subscriptionPlansTable,
  isFeatureEnabled,
} from "../lib/db";
import { requireRole, requireSuperAdmin } from "../middleware/authorize";
const authorize = (roles: Array<"owner" | "manager" | "waiter" | "kitchen" | "super_admin">) =>
  requireRole(...roles);
import { renderTemplate, htmlToText, getRestaurantEmailSettings, getMonthlyUsage, getTenantEmailLimits } from "../lib/emailSender";
import { requireAiCredits } from "../lib/aiCredits";
import { generateEmailDraft, type AiAuthorInput } from "../lib/emailAi";
import { runAutomationsForEvent } from "../lib/emailAutomations";
import { runSequenceTick } from "../lib/emailSequences";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function parseId(raw: unknown): number | null {
  const n = Number(raw); return Number.isInteger(n) && n > 0 ? n : null;
}

// ════════════════════════════════════════════════════════════════
// 1. SEQUENCES
// ════════════════════════════════════════════════════════════════
router.get("/admin/email/sequences", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select().from(emailSequencesTable).orderBy(emailSequencesTable.name);
  const stepCounts = await db.select({
    sequenceId: emailSequenceStepsTable.sequenceId,
    count: sql<number>`count(*)::int`,
  }).from(emailSequenceStepsTable).groupBy(emailSequenceStepsTable.sequenceId);
  const enrolled = await db.select({
    sequenceId: emailSequenceEnrollmentsTable.sequenceId,
    active: sql<number>`sum(case when status='active' then 1 else 0 end)::int`,
    completed: sql<number>`sum(case when status='completed' then 1 else 0 end)::int`,
  }).from(emailSequenceEnrollmentsTable).groupBy(emailSequenceEnrollmentsTable.sequenceId);
  const sc = new Map(stepCounts.map(r => [r.sequenceId, r.count]));
  const ec = new Map(enrolled.map(r => [r.sequenceId, { active: r.active, completed: r.completed }]));
  res.json({ data: rows.map(r => ({ ...r, stepCount: sc.get(r.id) ?? 0, enrollment: ec.get(r.id) ?? { active: 0, completed: 0 } })) });
});

router.get("/admin/email/sequences/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [seq] = await db.select().from(emailSequencesTable).where(eq(emailSequencesTable.id, id));
  if (!seq) return void res.status(404).json({ error: "Not found" });
  const steps = await db.select().from(emailSequenceStepsTable)
    .where(eq(emailSequenceStepsTable.sequenceId, id))
    .orderBy(emailSequenceStepsTable.position);
  res.json({ data: { ...seq, steps } });
});

router.post("/admin/email/sequences", requireSuperAdmin, async (req, res) => {
  const { key, name, description, trigger, isEnabled, stopRules } = req.body ?? {};
  if (!key || !name || !trigger) return void res.status(400).json({ error: "key, name, trigger required" });
  try {
    // Enforce plan active-sequences limit if tenant context provided (super admin = global, no limit)
    const [created] = await db.insert(emailSequencesTable).values({
      key, name,
      description: description ?? "",
      trigger,
      isEnabled: isEnabled ?? true,
      stopRules: Array.isArray(stopRules) ? stopRules : [],
      createdBy: req.user?.id ?? null,
    }).returning();
    res.status(201).json(created);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return void res.status(409).json({ error: "Key already exists" });
    throw err;
  }
});

router.put("/admin/email/sequences/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const { name, description, trigger, isEnabled, stopRules } = req.body ?? {};
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (trigger !== undefined) patch.trigger = trigger;
  if (isEnabled !== undefined) patch.isEnabled = isEnabled;
  if (stopRules !== undefined) patch.stopRules = Array.isArray(stopRules) ? stopRules : [];
  const [updated] = await db.update(emailSequencesTable).set(patch).where(eq(emailSequencesTable.id, id)).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/admin/email/sequences/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  await db.delete(emailSequencesTable).where(eq(emailSequencesTable.id, id));
  res.json({ ok: true });
});

router.post("/admin/email/sequences/:id/steps", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const { position, delayHours, templateKey, conditionJson, isEnabled, label } = req.body ?? {};
  if (!templateKey) return void res.status(400).json({ error: "templateKey required" });
  const [created] = await db.insert(emailSequenceStepsTable).values({
    sequenceId: id,
    position: Math.max(0, Number(position ?? 0)),
    delayHours: Math.max(0, Number(delayHours ?? 0)),
    templateKey,
    conditionJson: conditionJson ?? null,
    isEnabled: isEnabled ?? true,
    label: label ?? "",
  }).returning();
  res.status(201).json(created);
});

router.put("/admin/email/sequence-steps/:stepId", requireSuperAdmin, async (req, res) => {
  const stepId = parseId(req.params.stepId);
  if (!stepId) return void res.status(400).json({ error: "Invalid id" });
  const { position, delayHours, templateKey, conditionJson, isEnabled, label } = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (position !== undefined) patch.position = Math.max(0, Number(position));
  if (delayHours !== undefined) patch.delayHours = Math.max(0, Number(delayHours));
  if (templateKey !== undefined) patch.templateKey = templateKey;
  if (conditionJson !== undefined) patch.conditionJson = conditionJson;
  if (isEnabled !== undefined) patch.isEnabled = isEnabled;
  if (label !== undefined) patch.label = label;
  const [updated] = await db.update(emailSequenceStepsTable).set(patch).where(eq(emailSequenceStepsTable.id, stepId)).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/admin/email/sequence-steps/:stepId", requireSuperAdmin, async (req, res) => {
  const stepId = parseId(req.params.stepId);
  if (!stepId) return void res.status(400).json({ error: "Invalid id" });
  await db.delete(emailSequenceStepsTable).where(eq(emailSequenceStepsTable.id, stepId));
  res.json({ ok: true });
});

router.get("/admin/email/sequences/:id/enrollments", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const rows = await db.select().from(emailSequenceEnrollmentsTable)
    .where(eq(emailSequenceEnrollmentsTable.sequenceId, id))
    .orderBy(desc(emailSequenceEnrollmentsTable.enrolledAt))
    .limit(500);
  res.json({ data: rows });
});

router.post("/admin/email/sequences/run-tick-now", requireSuperAdmin, async (_req, res) => {
  const out = await runSequenceTick();
  res.json(out);
});

// ════════════════════════════════════════════════════════════════
// 2. AUTOMATIONS
// ════════════════════════════════════════════════════════════════
router.get("/admin/email/automations", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select().from(emailAutomationsTable).orderBy(desc(emailAutomationsTable.updatedAt));
  res.json({ data: rows });
});

router.post("/admin/email/automations", requireSuperAdmin, async (req, res) => {
  const { name, description, trigger, conditionJson, actions, isEnabled } = req.body ?? {};
  if (!name || !trigger || !Array.isArray(actions)) {
    return void res.status(400).json({ error: "name, trigger and actions[] required" });
  }
  const [created] = await db.insert(emailAutomationsTable).values({
    name,
    description: description ?? "",
    trigger,
    conditionJson: (conditionJson && typeof conditionJson === "object") ? conditionJson : {},
    actions: actions.filter((a) => a && typeof a === "object"),
    isEnabled: isEnabled ?? true,
    createdBy: req.user?.id ?? null,
  }).returning();
  res.status(201).json(created);
});

router.put("/admin/email/automations/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const { name, description, trigger, conditionJson, actions, isEnabled } = req.body ?? {};
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (trigger !== undefined) patch.trigger = trigger;
  if (conditionJson !== undefined) patch.conditionJson = conditionJson ?? {};
  if (actions !== undefined) patch.actions = Array.isArray(actions) ? actions : [];
  if (isEnabled !== undefined) patch.isEnabled = isEnabled;
  const [updated] = await db.update(emailAutomationsTable).set(patch).where(eq(emailAutomationsTable.id, id)).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/admin/email/automations/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  await db.delete(emailAutomationsTable).where(eq(emailAutomationsTable.id, id));
  res.json({ ok: true });
});

router.get("/admin/email/automations/:id/runs", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const rows = await db.select().from(emailAutomationRunsTable)
    .where(eq(emailAutomationRunsTable.automationId, id))
    .orderBy(desc(emailAutomationRunsTable.createdAt))
    .limit(200);
  res.json({ data: rows });
});

router.post("/admin/email/automations/:id/test", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [aut] = await db.select().from(emailAutomationsTable).where(eq(emailAutomationsTable.id, id));
  if (!aut) return void res.status(404).json({ error: "Not found" });
  await runAutomationsForEvent(aut.trigger, (req.body?.context ?? {}) as Record<string, unknown>);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════
// 3. MARKETING TEMPLATES (global library — used by restaurants)
// ════════════════════════════════════════════════════════════════
router.get("/admin/email/marketing-templates", requireSuperAdmin, async (req, res) => {
  const category = typeof req.query.category === "string" ? req.query.category : null;
  const rows = category && category !== "all"
    ? await db.select().from(emailMarketingTemplatesTable).where(eq(emailMarketingTemplatesTable.category, category)).orderBy(emailMarketingTemplatesTable.name)
    : await db.select().from(emailMarketingTemplatesTable).orderBy(emailMarketingTemplatesTable.name);
  res.json({ data: rows });
});

router.post("/admin/email/marketing-templates", requireSuperAdmin, async (req, res) => {
  const { key, name, category, subject, preheader, body, ctaLabel, ctaUrl, brandColor, businessTypes, planRestrictions, isHidden, isAiGenerated } = req.body ?? {};
  if (!key || !name) return void res.status(400).json({ error: "key and name required" });
  try {
    const [created] = await db.insert(emailMarketingTemplatesTable).values({
      key, name,
      category: category ?? "general",
      subject: subject ?? "",
      preheader: preheader ?? "",
      body: body ?? "",
      ctaLabel: ctaLabel ?? null,
      ctaUrl: ctaUrl ?? null,
      brandColor: brandColor ?? "#f97316",
      businessTypes: Array.isArray(businessTypes) ? businessTypes : [],
      planRestrictions: Array.isArray(planRestrictions) ? planRestrictions : [],
      isHidden: !!isHidden,
      isAiGenerated: !!isAiGenerated,
      createdBy: req.user?.id ?? null,
    }).returning();
    res.status(201).json(created);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return void res.status(409).json({ error: "Key already exists" });
    throw err;
  }
});

router.put("/admin/email/marketing-templates/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const allowed = ["name","category","subject","preheader","body","ctaLabel","ctaUrl","brandColor","businessTypes","planRestrictions","isHidden"];
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of allowed) {
    if (k in (req.body ?? {})) patch[k] = req.body[k];
  }
  const [updated] = await db.update(emailMarketingTemplatesTable).set(patch).where(eq(emailMarketingTemplatesTable.id, id)).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/admin/email/marketing-templates/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  await db.delete(emailMarketingTemplatesTable).where(eq(emailMarketingTemplatesTable.id, id));
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════
// 4. SUPPRESSION LIST
// ════════════════════════════════════════════════════════════════
router.get("/admin/email/suppressions", requireSuperAdmin, async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
  const rows = search
    ? await db.select().from(emailSuppressionListTable)
        .where(sql`lower(${emailSuppressionListTable.email}) ILIKE ${"%" + search + "%"}`)
        .orderBy(desc(emailSuppressionListTable.createdAt)).limit(500)
    : await db.select().from(emailSuppressionListTable)
        .orderBy(desc(emailSuppressionListTable.createdAt)).limit(500);
  res.json({ data: rows });
});

router.post("/admin/email/suppressions", requireSuperAdmin, async (req, res) => {
  const { email, scope, reason, notes } = req.body ?? {};
  if (!email || typeof email !== "string") return void res.status(400).json({ error: "email required" });
  try {
    const [row] = await db.insert(emailSuppressionListTable).values({
      email: email.trim().toLowerCase(),
      scope: scope ?? "all",
      reason: reason ?? "manual",
      notes: notes ?? null,
      addedBy: req.user?.id ?? null,
    }).onConflictDoNothing().returning();
    res.status(201).json(row ?? { ok: true });
  } catch (err) {
    throw err;
  }
});

router.delete("/admin/email/suppressions/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  await db.delete(emailSuppressionListTable).where(eq(emailSuppressionListTable.id, id));
  res.json({ ok: true });
});

router.get("/admin/email/unsubscribes", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select().from(emailUnsubscribesTable).orderBy(desc(emailUnsubscribesTable.createdAt)).limit(500);
  res.json({ data: rows });
});

// ════════════════════════════════════════════════════════════════
// 5. TEMPLATE VARIABLES (registry)
// ════════════════════════════════════════════════════════════════
router.get("/admin/email/variables", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select().from(emailTemplateVariablesTable).orderBy(emailTemplateVariablesTable.domain, emailTemplateVariablesTable.name);
  res.json({ data: rows });
});

// Variables are a read-only registry per Task #414 spec. The seeded set is the
// source of truth for template merge variables; admins cannot mutate it from
// the UI to avoid breaking template rendering across the platform.

// ════════════════════════════════════════════════════════════════
// 6. AI AUTHORING
// ════════════════════════════════════════════════════════════════
router.post("/admin/email/ai/generate", requireSuperAdmin, requireAiCredits("email_ai_generation", () => ({ units: 1 })), async (req, res) => {
  const body = (req.body ?? {}) as AiAuthorInput;
  if (!body.action) return void res.status(400).json({ error: "action required" });
  // Tenant plan-feature gate (super-admins acting on a tenant context still
  // get gated when a tenant is in scope). AIProviderService.generateText
  // writes per-call usage rows and enforces rate limiting / safety; we add
  // a plan-feature check here so plans without ai_email_generation can't
  // use this surface.
  if (req.user?.tenantId) {
    const [tenant] = await db.select({ planId: tenantsTable.planId })
      .from(tenantsTable).where(eq(tenantsTable.id, req.user.tenantId));
    if (tenant?.planId) {
      const [plan] = await db.select({ featureFlags: subscriptionPlansTable.featureFlags })
        .from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, tenant.planId));
      if (plan && !isFeatureEnabled(plan.featureFlags, "ai_email_generation")) {
        return void res.status(403).json({ error: "AI email generation is not included in your plan." });
      }
    }
  }
  const out = await generateEmailDraft(body, {
    tenantId: req.user?.tenantId ?? null,
    restaurantId: req.user?.restaurantId ?? null,
    userId: req.user?.id ?? null,
  });
  res.json(out);
});

// ════════════════════════════════════════════════════════════════
// 6b. SUPER-ADMIN GLOBAL CAMPAIGNS (cross-tenant list + analytics)
// ════════════════════════════════════════════════════════════════
router.get("/admin/email/campaigns", requireSuperAdmin, async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const tenantId = req.query.tenantId ? Number(req.query.tenantId) : null;
  const conds: SQL[] = [];
  if (status) conds.push(eq(emailCampaignsTable.status, status));
  if (tenantId) conds.push(eq(emailCampaignsTable.tenantId, tenantId));
  const rows = await db.select().from(emailCampaignsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(emailCampaignsTable.updatedAt)).limit(500);
  res.json({ data: rows });
});

router.get("/admin/email/campaigns/analytics", requireSuperAdmin, async (_req, res) => {
  const [agg] = await db.select({
    total: sql<number>`count(*)::int`,
    sent: sql<number>`count(*) filter (where status = 'sent')::int`,
    scheduled: sql<number>`count(*) filter (where status = 'scheduled')::int`,
    draft: sql<number>`count(*) filter (where status = 'draft')::int`,
    failed: sql<number>`count(*) filter (where status = 'failed')::int`,
    recipients: sql<number>`coalesce(sum(sent_count), 0)::int`,
    bounces: sql<number>`coalesce(sum(failed_count), 0)::int`,
  }).from(emailCampaignsTable);
  const topRows = await db.select({
    id: emailCampaignsTable.id, name: emailCampaignsTable.name,
    tenantId: emailCampaignsTable.tenantId, restaurantId: emailCampaignsTable.restaurantId,
    status: emailCampaignsTable.status, sentCount: emailCampaignsTable.sentCount,
    failedCount: emailCampaignsTable.failedCount, updatedAt: emailCampaignsTable.updatedAt,
  }).from(emailCampaignsTable).orderBy(desc(emailCampaignsTable.sentCount)).limit(20);
  res.json({ summary: agg, top: topRows });
});

// ════════════════════════════════════════════════════════════════
// 7. TEMPLATE VERSIONS (history + rollback)
// ════════════════════════════════════════════════════════════════
router.get("/admin/email/templates/:id/versions", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const rows = await db.select().from(emailTemplateVersionsTable)
    .where(eq(emailTemplateVersionsTable.templateId, id))
    .orderBy(desc(emailTemplateVersionsTable.versionNumber)).limit(50);
  res.json({ data: rows });
});

router.post("/admin/email/templates/:id/versions", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [tpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  if (!tpl) return void res.status(404).json({ error: "Not found" });
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${emailTemplateVersionsTable.versionNumber}), 0)::int` })
    .from(emailTemplateVersionsTable).where(eq(emailTemplateVersionsTable.templateId, id));
  const [row] = await db.insert(emailTemplateVersionsTable).values({
    templateId: id, versionNumber: (max ?? 0) + 1,
    subject: tpl.subject, preheader: tpl.preheader, body: tpl.body, plainText: tpl.plainText,
    ctaLabel: tpl.ctaLabel, ctaUrl: tpl.ctaUrl, changedBy: req.user?.id ?? null,
  }).returning();
  res.status(201).json(row);
});

router.post("/admin/email/templates/:id/rollback/:versionId", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id); const versionId = parseId(req.params.versionId);
  if (!id || !versionId) return void res.status(400).json({ error: "Invalid id" });
  const [v] = await db.select().from(emailTemplateVersionsTable).where(eq(emailTemplateVersionsTable.id, versionId));
  if (!v || v.templateId !== id) return void res.status(404).json({ error: "Version not found" });
  const [updated] = await db.update(emailTemplatesTable).set({
    subject: v.subject, preheader: v.preheader, body: v.body, plainText: v.plainText,
    ctaLabel: v.ctaLabel, ctaUrl: v.ctaUrl, updatedAt: new Date(),
  }).where(eq(emailTemplatesTable.id, id)).returning();
  res.json(updated);
});

// ════════════════════════════════════════════════════════════════
// 8. REPORTS / DASHBOARD
// ════════════════════════════════════════════════════════════════
router.get("/admin/email/dashboard", requireSuperAdmin, async (_req, res) => {
  const since30 = new Date(Date.now() - 30 * 24 * 3600_000);
  const since7 = new Date(Date.now() - 7 * 24 * 3600_000);
  const [{ total30 }] = await db.select({ total30: sql<number>`count(*)::int` }).from(emailLogsTable).where(gte(emailLogsTable.createdAt, since30));
  const [{ sent30 }] = await db.select({ sent30: sql<number>`count(*)::int` }).from(emailLogsTable).where(and(gte(emailLogsTable.createdAt, since30), eq(emailLogsTable.status, "sent")));
  const [{ failed30 }] = await db.select({ failed30: sql<number>`count(*)::int` }).from(emailLogsTable).where(and(gte(emailLogsTable.createdAt, since30), eq(emailLogsTable.status, "failed")));
  const [{ opens30 }] = await db.select({ opens30: sql<number>`count(*)::int` }).from(emailLogsTable).where(and(gte(emailLogsTable.createdAt, since30), gt(emailLogsTable.openCount, 0)));
  const [{ clicks30 }] = await db.select({ clicks30: sql<number>`count(*)::int` }).from(emailLogsTable).where(and(gte(emailLogsTable.createdAt, since30), gt(emailLogsTable.clickCount, 0)));
  const [{ activeSequences }] = await db.select({ activeSequences: sql<number>`count(*)::int` }).from(emailSequencesTable).where(eq(emailSequencesTable.isEnabled, true));
  const [{ activeAutomations }] = await db.select({ activeAutomations: sql<number>`count(*)::int` }).from(emailAutomationsTable).where(eq(emailAutomationsTable.isEnabled, true));
  const [{ enrollments }] = await db.select({ enrollments: sql<number>`count(*)::int` }).from(emailSequenceEnrollmentsTable).where(eq(emailSequenceEnrollmentsTable.status, "active"));
  const [{ unsubs30 }] = await db.select({ unsubs30: sql<number>`count(*)::int` }).from(emailUnsubscribesTable).where(gte(emailUnsubscribesTable.createdAt, since30));

  const byDay = await db.select({
    day: sql<string>`to_char(${emailLogsTable.createdAt}, 'YYYY-MM-DD')`,
    sent: sql<number>`sum(case when status='sent' then 1 else 0 end)::int`,
    failed: sql<number>`sum(case when status='failed' then 1 else 0 end)::int`,
    opened: sql<number>`sum(case when ${emailLogsTable.openCount} > 0 then 1 else 0 end)::int`,
    clicked: sql<number>`sum(case when ${emailLogsTable.clickCount} > 0 then 1 else 0 end)::int`,
  }).from(emailLogsTable).where(gte(emailLogsTable.createdAt, since30)).groupBy(sql`to_char(${emailLogsTable.createdAt}, 'YYYY-MM-DD')`).orderBy(sql`to_char(${emailLogsTable.createdAt}, 'YYYY-MM-DD')`);

  const topTemplates = await db.select({
    templateKey: emailLogsTable.templateKey,
    sent: sql<number>`count(*)::int`,
    opened: sql<number>`sum(case when ${emailLogsTable.openCount} > 0 then 1 else 0 end)::int`,
  }).from(emailLogsTable).where(and(gte(emailLogsTable.createdAt, since30))).groupBy(emailLogsTable.templateKey).orderBy(desc(sql<number>`count(*)`)).limit(10);

  const [{ since7Total }] = await db.select({ since7Total: sql<number>`count(*)::int` })
    .from(emailLogsTable).where(gte(emailLogsTable.createdAt, since7));
  res.json({
    counts: { total30, sent30, failed30, opens30, clicks30, since7Total, activeSequences, activeAutomations, enrollments, unsubs30 },
    byDay, topTemplates,
  });
});

router.get("/admin/email/reports/per-tenant", requireSuperAdmin, async (_req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 3600_000);
  const rows = await db.select({
    tenantId: emailLogsTable.tenantId,
    tenantName: tenantsTable.name,
    sent: sql<number>`sum(case when status='sent' then 1 else 0 end)::int`,
    delivered: sql<number>`sum(case when status in ('sent','delivered') then 1 else 0 end)::int`,
    failed: sql<number>`sum(case when status='failed' then 1 else 0 end)::int`,
    bounced: sql<number>`sum(case when status='bounced' then 1 else 0 end)::int`,
    opened: sql<number>`sum(case when ${emailLogsTable.openCount} > 0 then 1 else 0 end)::int`,
    clicked: sql<number>`sum(case when ${emailLogsTable.clickCount} > 0 then 1 else 0 end)::int`,
  }).from(emailLogsTable)
    .leftJoin(tenantsTable, eq(tenantsTable.id, emailLogsTable.tenantId))
    .where(gte(emailLogsTable.createdAt, since))
    .groupBy(emailLogsTable.tenantId, tenantsTable.name)
    .orderBy(desc(sql<number>`count(*)`)).limit(100);
  // Pull unsubscribes in the same window per tenant. The email_unsubscribes
  // schema has no tenant column, so derive tenant via restaurants→tenants.
  const unsubRows = await db.select({
    tenantId: restaurantsTable.tenantId,
    unsubscribed: sql<number>`count(*)::int`,
  }).from(emailUnsubscribesTable)
    .leftJoin(restaurantsTable, eq(restaurantsTable.id, emailUnsubscribesTable.restaurantId))
    .where(gte(emailUnsubscribesTable.createdAt, since))
    .groupBy(restaurantsTable.tenantId);
  const unsubMap = new Map<number | null, number>();
  for (const u of unsubRows) unsubMap.set(u.tenantId ?? null, u.unsubscribed);
  const out = rows.map(r => {
    const sent = r.sent || 0;
    const opened = r.opened || 0;
    const clicked = r.clicked || 0;
    return {
      ...r,
      unsubscribed: unsubMap.get(r.tenantId ?? null) ?? 0,
      openRate: sent > 0 ? Math.round((opened / sent) * 10000) / 100 : 0,
      clickRate: sent > 0 ? Math.round((clicked / sent) * 10000) / 100 : 0,
    };
  });
  res.json({ data: out });
});

router.get("/admin/email/logs/:id/events", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const events = await db.select().from(emailTrackingEventsTable).where(eq(emailTrackingEventsTable.logId, id)).orderBy(desc(emailTrackingEventsTable.createdAt));
  res.json({ data: events });
});

// ════════════════════════════════════════════════════════════════
// 9. RESTAURANT-SCOPED endpoints (owner/manager)
// ════════════════════════════════════════════════════════════════
function resolveRestaurantId(req: import("express").Request): number | null {
  const u = req.user;
  if (!u) return null;
  if (u.isSuperAdmin && req.query.restaurantId) return parseId(req.query.restaurantId);
  return u.restaurantId ?? null;
}

router.get("/email/settings", authorize(["owner", "manager"]), async (req, res) => {
  const rid = resolveRestaurantId(req);
  if (!rid) return void res.status(400).json({ error: "No restaurant context" });
  const s = await getRestaurantEmailSettings(rid);
  let limits: Awaited<ReturnType<typeof getTenantEmailLimits>> = null;
  let usage: Awaited<ReturnType<typeof getMonthlyUsage>> | null = null;
  if (req.user?.tenantId) {
    limits = await getTenantEmailLimits(req.user.tenantId);
    usage = await getMonthlyUsage(req.user.tenantId);
  }
  res.json({ data: s, limits, usage });
});

router.put("/email/settings", authorize(["owner", "manager"]), async (req, res) => {
  const rid = resolveRestaurantId(req);
  if (!rid) return void res.status(400).json({ error: "No restaurant context" });
  await getRestaurantEmailSettings(rid);
  const allowed = ["marketingEnabled","followUpEnabled","fromName","replyTo","footerText","businessAddress","consentRequired","birthdayEnabled","feedbackEnabled","reviewEnabled","inactiveEnabled"];
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of allowed) if (k in (req.body ?? {})) patch[k] = req.body[k];
  const [updated] = await db.update(emailRestaurantSettingsTable).set(patch).where(eq(emailRestaurantSettingsTable.restaurantId, rid)).returning();
  res.json({ data: updated });
});

router.get("/email/marketing-templates", authorize(["owner", "manager"]), async (req, res) => {
  const rows = await db.select().from(emailMarketingTemplatesTable).where(eq(emailMarketingTemplatesTable.isHidden, false)).orderBy(emailMarketingTemplatesTable.name);
  void req;
  res.json({ data: rows });
});

router.get("/email/campaigns", authorize(["owner", "manager"]), async (req, res) => {
  const rid = resolveRestaurantId(req);
  if (!rid) return void res.status(400).json({ error: "No restaurant context" });
  const rows = await db.select().from(emailCampaignsTable).where(eq(emailCampaignsTable.restaurantId, rid)).orderBy(desc(emailCampaignsTable.updatedAt));
  res.json({ data: rows });
});

router.post("/email/campaigns", authorize(["owner", "manager"]), async (req, res) => {
  const rid = resolveRestaurantId(req);
  if (!rid) return void res.status(400).json({ error: "No restaurant context" });
  const { name, marketingTemplateId, segment, audienceFilter, subject, preheader, body, ctaLabel, ctaUrl, brandColor, scheduledAt } = req.body ?? {};
  if (!name) return void res.status(400).json({ error: "name required" });
  const [created] = await db.insert(emailCampaignsTable).values({
    restaurantId: rid,
    tenantId: req.user?.tenantId ?? null,
    name,
    marketingTemplateId: marketingTemplateId ?? null,
    segment: segment ?? "all_opted_in",
    audienceFilter: audienceFilter ?? {},
    subject: subject ?? "",
    preheader: preheader ?? "",
    body: body ?? "",
    ctaLabel: ctaLabel ?? null,
    ctaUrl: ctaUrl ?? null,
    brandColor: brandColor ?? "#f97316",
    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    status: scheduledAt ? "scheduled" : "draft",
    createdBy: req.user?.id ?? null,
  }).returning();
  res.status(201).json(created);
});

router.put("/email/campaigns/:id", authorize(["owner", "manager"]), async (req, res) => {
  const id = parseId(req.params.id);
  const rid = resolveRestaurantId(req);
  if (!id || !rid) return void res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(emailCampaignsTable).where(and(eq(emailCampaignsTable.id, id), eq(emailCampaignsTable.restaurantId, rid)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  if (existing.status !== "draft" && existing.status !== "scheduled") return void res.status(400).json({ error: "Cannot edit a campaign that has started sending" });
  const allowed = ["name","marketingTemplateId","segment","audienceFilter","subject","preheader","body","ctaLabel","ctaUrl","brandColor","scheduledAt","status"];
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of allowed) if (k in (req.body ?? {})) patch[k] = req.body[k];
  if (patch.scheduledAt) patch.scheduledAt = new Date(patch.scheduledAt as string);
  const [updated] = await db.update(emailCampaignsTable).set(patch).where(eq(emailCampaignsTable.id, id)).returning();
  res.json(updated);
});

router.delete("/email/campaigns/:id", authorize(["owner", "manager"]), async (req, res) => {
  const id = parseId(req.params.id);
  const rid = resolveRestaurantId(req);
  if (!id || !rid) return void res.status(400).json({ error: "Invalid id" });
  await db.delete(emailCampaignsTable).where(and(eq(emailCampaignsTable.id, id), eq(emailCampaignsTable.restaurantId, rid)));
  res.json({ ok: true });
});

// Resolve the recipient list for a campaign segment.
async function resolveSegmentRecipients(restaurantId: number, segment: string, _filter: Record<string, unknown>): Promise<Array<{ id: number; email: string; name: string | null }>> {
  const conds: SQL[] = [eq(customersTable.restaurantId, restaurantId), eq(customersTable.emailMarketingOptIn, true), eq(customersTable.emailUnsubscribed, false)];
  if (segment === "loyalty") conds.push(gt(customersTable.totalOrders, 5));
  if (segment === "vip") conds.push(eq(customersTable.isVip, true));
  if (segment === "repeat") conds.push(gt(customersTable.totalOrders, 1));
  if (segment === "high_spenders") conds.push(sql`${customersTable.totalSpent}::numeric >= 5000`);
  if (segment === "inactive_30d") conds.push(sql`${customersTable.lastVisitAt} < NOW() - INTERVAL '30 days'`);
  if (segment === "inactive_60d") conds.push(sql`${customersTable.lastVisitAt} < NOW() - INTERVAL '60 days'`);
  if (segment === "inactive_90d") conds.push(sql`${customersTable.lastVisitAt} < NOW() - INTERVAL '90 days'`);
  if (segment === "new_30d") conds.push(sql`${customersTable.firstOrderAt} > NOW() - INTERVAL '30 days'`);
  if (segment === "birthday_this_month") conds.push(sql`EXTRACT(MONTH FROM ${customersTable.birthday}) = EXTRACT(MONTH FROM NOW())`);
  if (segment === "anniversary_this_month") conds.push(sql`EXTRACT(MONTH FROM ${customersTable.anniversary}) = EXTRACT(MONTH FROM NOW())`);
  if (segment === "loyalty_points_holders") conds.push(gt(customersTable.loyaltyPoints, 0));
  const rows = await db.select({
    id: customersTable.id, email: customersTable.email, name: customersTable.name,
  }).from(customersTable).where(and(...conds)).limit(50_000);
  return rows.filter(r => !!r.email) as Array<{ id: number; email: string; name: string | null }>;
}

router.post("/email/campaigns/:id/test", authorize(["owner", "manager"]), async (req, res) => {
  const id = parseId(req.params.id);
  const rid = resolveRestaurantId(req);
  if (!id || !rid) return void res.status(400).json({ error: "Invalid id" });
  const [c] = await db.select().from(emailCampaignsTable).where(and(eq(emailCampaignsTable.id, id), eq(emailCampaignsTable.restaurantId, rid)));
  if (!c) return void res.status(404).json({ error: "Not found" });
  const to = String(req.body?.to ?? req.user?.email ?? "");
  if (!to) return void res.status(400).json({ error: "to required" });
  const vars = (req.body?.sample ?? {}) as Record<string, unknown>;
  const html = renderTemplate(c.body, vars);
  const subject = renderTemplate(c.subject, vars);
  const { sendEmail } = await import("../lib/emailSender");
  const result = await sendEmail({
    to, subject, html, text: htmlToText(html),
    tenantId: c.tenantId, restaurantId: c.restaurantId,
    // Render as a true marketing send so tracking + unsubscribe + footer
    // injection match the real campaign payload. skipConsentCheck bypasses
    // the per-customer opt-in lookup for the operator's test recipient.
    kind: "marketing", skipConsentCheck: true,
    campaignId: c.id,
  });
  if (result?.ok) res.json({ ok: true, logId: result.log.id });
  else res.status(502).json({ ok: false, error: result?.error });
});

router.post("/email/campaigns/:id/audience-preview", authorize(["owner", "manager"]), async (req, res) => {
  const rid = resolveRestaurantId(req);
  if (!rid) return void res.status(400).json({ error: "No restaurant context" });
  const segment = String(req.body?.segment ?? "all_opted_in");
  const recipients = await resolveSegmentRecipients(rid, segment, req.body?.audienceFilter ?? {});
  res.json({ count: recipients.length, sample: recipients.slice(0, 10).map(r => ({ email: r.email, name: r.name })) });
});

router.post("/email/campaigns/:id/send", authorize(["owner", "manager"]), async (req, res) => {
  const id = parseId(req.params.id);
  const rid = resolveRestaurantId(req);
  if (!id || !rid) return void res.status(400).json({ error: "Invalid id" });
  const [c] = await db.select().from(emailCampaignsTable).where(and(eq(emailCampaignsTable.id, id), eq(emailCampaignsTable.restaurantId, rid)));
  if (!c) return void res.status(404).json({ error: "Not found" });
  if (c.status === "sending" || c.status === "sent") return void res.status(400).json({ error: "Campaign already sending or sent" });

  // Plan limit check: marketing-allowed?
  if (c.tenantId) {
    const [plan] = await db.select({
      featureFlags: subscriptionPlansTable.featureFlags,
    }).from(subscriptionPlansTable)
      .innerJoin(tenantsTable, eq(tenantsTable.planId, subscriptionPlansTable.id))
      .where(eq(tenantsTable.id, c.tenantId));
    if (plan && !isFeatureEnabled(plan.featureFlags, "email_marketing")) {
      await db.update(emailCampaignsTable).set({ status: "failed", blockedReason: "Marketing emails are not included in your plan." }).where(eq(emailCampaignsTable.id, c.id));
      return void res.status(403).json({ error: "Marketing emails are not included in your plan." });
    }
  }

  const recipients = await resolveSegmentRecipients(rid, c.segment, c.audienceFilter as Record<string, unknown>);
  await db.update(emailCampaignsTable).set({
    status: "sending", startedAt: new Date(), recipientCount: recipients.length, updatedAt: new Date(),
  }).where(eq(emailCampaignsTable.id, c.id));

  // Fire-and-forget queue
  void (async () => {
    const { sendEmail } = await import("../lib/emailSender");
    let sent = 0, failed = 0;
    for (const r of recipients) {
      try {
        const vars = { name: r.name ?? "there", restaurant: "your favourite restaurant" };
        const html = renderTemplate(c.body, vars);
        const subject = renderTemplate(c.subject, vars);
        const result = await sendEmail({
          to: r.email, subject, html, text: htmlToText(html),
          tenantId: c.tenantId, restaurantId: c.restaurantId,
          kind: "marketing", recipientType: "customer", campaignId: c.id,
        });
        await db.insert(emailCampaignRecipientsTable).values({
          campaignId: c.id, customerId: r.id, email: r.email, name: r.name,
          status: result?.ok ? "sent" : (result?.skippedReason ?? "failed"),
          reason: result?.error ?? null, logId: result?.log?.id ?? null,
          sentAt: result?.ok ? new Date() : null,
        }).catch(() => {});
        if (result?.ok) sent++; else failed++;
      } catch (err) {
        failed++; logger.warn({ err, to: r.email, campaignId: c.id }, "campaign send threw");
      }
    }
    await db.update(emailCampaignsTable).set({
      status: failed === recipients.length ? "failed" : "sent",
      completedAt: new Date(), sentCount: sent, failedCount: failed, updatedAt: new Date(),
    }).where(eq(emailCampaignsTable.id, c.id));
  })();

  res.json({ ok: true, queued: recipients.length });
});

router.get("/email/campaigns/:id/report", authorize(["owner", "manager"]), async (req, res) => {
  const id = parseId(req.params.id);
  const rid = resolveRestaurantId(req);
  if (!id || !rid) return void res.status(400).json({ error: "Invalid id" });
  const [c] = await db.select().from(emailCampaignsTable).where(and(eq(emailCampaignsTable.id, id), eq(emailCampaignsTable.restaurantId, rid)));
  if (!c) return void res.status(404).json({ error: "Not found" });
  const [stats] = await db.select({
    opened: sql<number>`sum(case when ${emailLogsTable.openCount} > 0 then 1 else 0 end)::int`,
    clicked: sql<number>`sum(case when ${emailLogsTable.clickCount} > 0 then 1 else 0 end)::int`,
    sent: sql<number>`sum(case when status='sent' then 1 else 0 end)::int`,
    failed: sql<number>`sum(case when status='failed' then 1 else 0 end)::int`,
  }).from(emailLogsTable).where(eq(emailLogsTable.campaignId, c.id));
  const recipients = await db.select().from(emailCampaignRecipientsTable).where(eq(emailCampaignRecipientsTable.campaignId, c.id)).limit(2000);
  res.json({ campaign: c, stats, recipients });
});

// Trigger marketing scheduled tick (cron will hit this internally too).
router.post("/admin/email/campaigns/scheduler-tick", requireSuperAdmin, async (_req, res) => {
  const { runScheduledCampaignTick } = await import("../lib/emailCampaigns");
  const out = await runScheduledCampaignTick();
  res.json(out);
});

router.post("/email/customers/:id/marketing-consent", authorize(["owner", "manager", "waiter"]), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  // Tenant-scope guard: prevent IDOR — caller may only mutate consent for
  // a customer that belongs to their own restaurant (super-admin bypass).
  const rid = resolveRestaurantId(req);
  if (!req.user?.isSuperAdmin && !rid) return void res.status(400).json({ error: "No restaurant context" });
  const [target] = await db.select({ id: customersTable.id, restaurantId: customersTable.restaurantId })
    .from(customersTable).where(eq(customersTable.id, id));
  if (!target) return void res.status(404).json({ error: "Not found" });
  if (!req.user?.isSuperAdmin && target.restaurantId !== rid) {
    return void res.status(404).json({ error: "Not found" });
  }
  const optIn = !!req.body?.optIn;
  const source = typeof req.body?.source === "string" ? req.body.source : "manual";
  const patch: Record<string, unknown> = {
    emailMarketingOptIn: optIn,
    emailMarketingOptInSource: optIn ? source : null,
    emailMarketingOptInAt: optIn ? new Date() : null,
    emailUnsubscribed: !optIn ? true : false,
    emailUnsubscribedAt: !optIn ? new Date() : null,
    updatedAt: new Date(),
  };
  const [updated] = await db.update(customersTable).set(patch).where(eq(customersTable.id, id)).returning();
  res.json(updated);
});

void auditLogsTable; void emailMonthlyUsageTable; void restaurantsTable;

export default router;
