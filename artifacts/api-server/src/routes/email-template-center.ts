/**
 * Email Template Center routes (Task #533).
 *
 * Mirrors the WhatsApp Template Center surface (whatsapp-template-center.ts)
 * for email: per-scope list/CRUD, compliance check, restaurant clone-and-edit,
 * internal Super Admin approval flow, version history, assignment to plans
 * and restaurants, variable registry, preview, test send, dashboard.
 *
 * All writes are versioned: on every save the previous state is snapshotted
 * into `email_template_versions`. Submission here means "submit for Super
 * Admin internal review" — there is no external provider review for email,
 * so `approve` flips status directly to `approved`.
 */

import { Router, type IRouter } from "express";
import { and, asc, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  emailTemplatesTable,
  emailTemplateVersionsTable,
  emailTemplateSubmissionsTable,
  emailLogsTable,
  restaurantsTable,
  tenantsTable,
  subscriptionPlansTable,
  auditLogsTable,
  type EmailTemplate,
} from "../lib/db";
import { requireRole, requireSuperAdmin } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import {
  TEMPLATE_VARIABLES,
  listVariablesByCategory,
  renderPlaceholders,
  buildExampleValues,
} from "../lib/templateVariables";
import { checkEmailTemplate, complianceSummary } from "../lib/templateCompliance";
import { sendByTemplateKey } from "../lib/emailSender";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function parseId(v: unknown): number | null {
  const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null;
}

async function snapshotVersion(t: EmailTemplate, changedBy: number | null): Promise<void> {
  const [r] = await db.select({ max: sql<number>`coalesce(max(version_number), 0)::int` })
    .from(emailTemplateVersionsTable)
    .where(eq(emailTemplateVersionsTable.templateId, t.id));
  await db.insert(emailTemplateVersionsTable).values({
    templateId: t.id,
    versionNumber: (r?.max ?? 0) + 1,
    subject: t.subject ?? "",
    preheader: t.preheader ?? "",
    body: t.body ?? "",
    plainText: t.plainText ?? "",
    ctaLabel: t.ctaLabel,
    ctaUrl: t.ctaUrl,
    changedBy,
  });
}

const MUTABLE_FIELDS: Array<keyof EmailTemplate> = [
  "name", "event", "category", "subject", "preheader", "body", "plainText",
  "headerLogo", "footerText", "brandColor", "ctaLabel", "ctaUrl",
  "variables", "businessTypes", "planRestrictions", "isEnabled",
  "allowRestaurantEdit", "assignedPlansJson", "assignedRestaurantsJson",
];

async function recordSubmissionAttempt(args: {
  templateId: number;
  attemptType: "submit" | "approve" | "reject" | "edit";
  resultStatus: string;
  requestPayload?: Record<string, unknown>;
  response?: Record<string, unknown>;
  errorMessage?: string | null;
  triggeredBy: number | null;
}): Promise<void> {
  try {
    await db.insert(emailTemplateSubmissionsTable).values({
      templateId: args.templateId,
      attemptType: args.attemptType,
      resultStatus: args.resultStatus,
      requestPayloadJson: args.requestPayload ?? {},
      responseJson: args.response ?? {},
      errorMessage: args.errorMessage ?? null,
      triggeredBy: args.triggeredBy,
    });
  } catch (err) {
    logger.warn({ err, templateId: args.templateId }, "[email template] failed to record submission attempt");
  }
}

// ════════════════════════════════════════════════════════════════
// 1. VARIABLES REGISTRY
// ════════════════════════════════════════════════════════════════
router.get("/admin/email/template-center/variables", requireSuperAdmin, (_req, res) => {
  res.json({ data: TEMPLATE_VARIABLES, byCategory: listVariablesByCategory() });
});

router.get("/restaurants/:restaurantId/email/template-center/variables",
  requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, (_req, res) => {
    res.json({
      data: TEMPLATE_VARIABLES.filter(v => !v.systemOnly),
      byCategory: Object.fromEntries(
        Object.entries(listVariablesByCategory()).map(([k, vs]) => [k, vs.filter(v => !v.systemOnly)]),
      ),
    });
  });

// ════════════════════════════════════════════════════════════════
// 2. SUPER ADMIN — list / detail / create / update / delete
// ════════════════════════════════════════════════════════════════
router.get("/admin/email/template-center/templates", requireSuperAdmin, async (req, res) => {
  const conds: SQL[] = [eq(emailTemplatesTable.scope, "platform")];
  if (req.query.status) conds.push(eq(emailTemplatesTable.status, String(req.query.status)));
  if (req.query.category) conds.push(eq(emailTemplatesTable.category, String(req.query.category) as never));
  if (req.query.q) {
    const q = `%${String(req.query.q).trim()}%`;
    const search = or(
      sql`${emailTemplatesTable.name} ILIKE ${q}`,
      sql`${emailTemplatesTable.subject} ILIKE ${q}`,
      sql`${emailTemplatesTable.key} ILIKE ${q}`,
    );
    if (search) conds.push(search);
  }
  const rows = await db.select().from(emailTemplatesTable)
    .where(and(...conds))
    .orderBy(desc(emailTemplatesTable.updatedAt))
    .limit(1000);
  res.json({ data: rows, total: rows.length });
});

router.get("/admin/email/template-center/templates/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [row] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  if (!row) return void res.status(404).json({ error: "Not found" });
  const issues = checkEmailTemplate({ subject: row.subject, body: row.body, variables: row.variables, category: row.category });
  res.json({ data: row, compliance: { issues, summary: complianceSummary(issues) } });
});

router.post("/admin/email/template-center/templates", requireSuperAdmin, async (req, res) => {
  const b = req.body ?? {};
  if (!b.key || !b.name || !b.subject) {
    return void res.status(400).json({ error: "key, name and subject are required" });
  }
  try {
    const [created] = await db.insert(emailTemplatesTable).values({
      scope: "platform",
      restaurantId: null,
      key: String(b.key),
      name: String(b.name),
      event: b.event ?? null,
      category: (b.category ?? "transactional") as never,
      subject: String(b.subject),
      preheader: String(b.preheader ?? ""),
      body: String(b.body ?? ""),
      plainText: String(b.plainText ?? ""),
      headerLogo: b.headerLogo ?? null,
      footerText: String(b.footerText ?? ""),
      brandColor: String(b.brandColor ?? "#f97316"),
      ctaLabel: b.ctaLabel ?? null,
      ctaUrl: b.ctaUrl ?? null,
      variables: Array.isArray(b.variables) ? b.variables : [],
      businessTypes: Array.isArray(b.businessTypes) ? b.businessTypes : [],
      planRestrictions: Array.isArray(b.planRestrictions) ? b.planRestrictions : [],
      isEnabled: b.isEnabled !== false,
      status: "approved",
      allowRestaurantEdit: !!b.allowRestaurantEdit,
      assignedPlansJson: Array.isArray(b.assignedPlansJson) ? b.assignedPlansJson.map(String) : [],
      assignedRestaurantsJson: Array.isArray(b.assignedRestaurantsJson)
        ? b.assignedRestaurantsJson.map(Number).filter(Number.isFinite) : [],
      createdBySuperAdmin: true,
      createdBy: req.user?.sub ?? null,
      updatedBy: req.user?.sub ?? null,
    }).returning();
    await snapshotVersion(created, req.user?.sub ?? null);
    await db.insert(auditLogsTable).values({
      userId: req.user?.sub ?? null,
      action: "email.template.created",
      entity: "email_templates",
      entityId: created.id,
    });
    res.status(201).json({ data: created });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return void res.status(409).json({ error: "A platform template with this key already exists." });
    }
    throw err;
  }
});

router.put("/admin/email/template-center/templates/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: req.user?.sub ?? null };
  for (const k of MUTABLE_FIELDS) {
    if (k in (req.body ?? {})) patch[k] = req.body[k];
  }
  const [updated] = await db.update(emailTemplatesTable).set(patch).where(eq(emailTemplatesTable.id, id)).returning();
  await snapshotVersion(updated, req.user?.sub ?? null);
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    action: "email.template.updated",
    entity: "email_templates",
    entityId: id,
  });
  res.json({ data: updated });
});

router.delete("/admin/email/template-center/templates/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    action: "email.template.deleted",
    entity: "email_templates",
    entityId: id,
  });
  res.status(204).send();
});

// ════════════════════════════════════════════════════════════════
// 3. COMPLIANCE CHECK
// ════════════════════════════════════════════════════════════════
router.post("/admin/email/template-center/check", requireSuperAdmin, (req, res) => {
  const issues = checkEmailTemplate(req.body ?? {});
  res.json({ issues, summary: complianceSummary(issues) });
});

router.post("/restaurants/:restaurantId/email/template-center/check",
  requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, (req, res) => {
    const issues = checkEmailTemplate(req.body ?? {});
    res.json({ issues, summary: complianceSummary(issues) });
  });

// ════════════════════════════════════════════════════════════════
// 4. VERSION HISTORY & ROLLBACK
// ════════════════════════════════════════════════════════════════
router.get("/admin/email/template-center/templates/:id/versions", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const rows = await db.select().from(emailTemplateVersionsTable)
    .where(eq(emailTemplateVersionsTable.templateId, id))
    .orderBy(desc(emailTemplateVersionsTable.versionNumber))
    .limit(200);
  res.json({ data: rows });
});

router.post("/admin/email/template-center/templates/:id/rollback/:versionId", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  const vid = parseId(req.params.versionId);
  if (!id || !vid) return void res.status(400).json({ error: "Invalid id" });
  const [v] = await db.select().from(emailTemplateVersionsTable)
    .where(and(eq(emailTemplateVersionsTable.id, vid), eq(emailTemplateVersionsTable.templateId, id)));
  if (!v) return void res.status(404).json({ error: "Version not found" });
  const [current] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  if (!current) return void res.status(404).json({ error: "Template not found" });
  await snapshotVersion(current, req.user?.sub ?? null);
  const [updated] = await db.update(emailTemplatesTable).set({
    subject: v.subject, preheader: v.preheader, body: v.body, plainText: v.plainText,
    ctaLabel: v.ctaLabel, ctaUrl: v.ctaUrl,
    updatedAt: new Date(), updatedBy: req.user?.sub ?? null,
  }).where(eq(emailTemplatesTable.id, id)).returning();
  await snapshotVersion(updated, req.user?.sub ?? null);
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    action: "email.template.rolled_back",
    entity: "email_templates",
    entityId: id,
    details: `versionId=${vid}`,
  });
  res.json({ data: updated });
});

// ════════════════════════════════════════════════════════════════
// 5. ASSIGNMENT (plans + restaurants)
// ════════════════════════════════════════════════════════════════
router.put("/admin/email/template-center/templates/:id/assignments", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const { plans, restaurants, allowRestaurantEdit } = req.body ?? {};
  const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: req.user?.sub ?? null };
  if (Array.isArray(plans)) patch.assignedPlansJson = plans.map(String);
  if (Array.isArray(restaurants)) patch.assignedRestaurantsJson = restaurants.map(Number).filter(Number.isFinite);
  if (typeof allowRestaurantEdit === "boolean") patch.allowRestaurantEdit = allowRestaurantEdit;
  const [updated] = await db.update(emailTemplatesTable).set(patch).where(eq(emailTemplatesTable.id, id)).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    action: "email.template.assignments_updated",
    entity: "email_templates",
    entityId: id,
  });
  res.json({ data: updated });
});

// ════════════════════════════════════════════════════════════════
// 6. PREVIEW / TEST SEND
// ════════════════════════════════════════════════════════════════
router.post("/admin/email/template-center/templates/:id/preview", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [tpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  if (!tpl) return void res.status(404).json({ error: "Not found" });
  const values = buildExampleValues(req.body?.values ?? {});
  const subject = renderPlaceholders(tpl.subject ?? "", values);
  const body = renderPlaceholders(tpl.body ?? "", values);
  const preheader = renderPlaceholders(tpl.preheader ?? "", values);
  res.json({ data: { subject, body, preheader, footerText: tpl.footerText, headerLogo: tpl.headerLogo } });
});

router.post("/admin/email/template-center/templates/:id/test-send", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const { to, values } = req.body as { to?: string; values?: Record<string, string> };
  if (!to) return void res.status(400).json({ error: "to is required" });
  const [tpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  if (!tpl) return void res.status(404).json({ error: "Not found" });
  if (!tpl.isEnabled || tpl.status !== "approved") {
    return void res.status(422).json({ error: "Template must be enabled and approved before test send." });
  }
  const merged = buildExampleValues(values ?? {});
  const result = await sendByTemplateKey(tpl.key, to, merged, {
    restaurantId: tpl.restaurantId ?? null,
    recipientType: "user",
  });
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    action: "email.template.test_sent",
    entity: "email_templates",
    entityId: id,
    details: `ok=${result?.ok ?? false}`,
  });
  res.json({ ok: result?.ok ?? false, providerMessageId: result?.providerMessageId ?? null, error: result?.error ?? null });
});

// ════════════════════════════════════════════════════════════════
// 7. SUBMISSIONS QUEUE
// ════════════════════════════════════════════════════════════════
router.get("/admin/email/template-center/submissions", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select({
    id: emailTemplatesTable.id,
    key: emailTemplatesTable.key,
    name: emailTemplatesTable.name,
    scope: emailTemplatesTable.scope,
    restaurantId: emailTemplatesTable.restaurantId,
    category: emailTemplatesTable.category,
    status: emailTemplatesTable.status,
    rejectionReason: emailTemplatesTable.rejectionReason,
    updatedAt: emailTemplatesTable.updatedAt,
  }).from(emailTemplatesTable)
    .orderBy(desc(emailTemplatesTable.updatedAt))
    .limit(500);
  const byStatus = rows.reduce<Record<string, number>>((m, r) => {
    m[r.status] = (m[r.status] ?? 0) + 1;
    return m;
  }, {});
  res.json({ data: rows, byStatus });
});

router.get("/admin/email/template-center/templates/:id/submissions", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const rows = await db.select().from(emailTemplateSubmissionsTable)
    .where(eq(emailTemplateSubmissionsTable.templateId, id))
    .orderBy(desc(emailTemplateSubmissionsTable.createdAt))
    .limit(200);
  res.json({ data: rows });
});

// ════════════════════════════════════════════════════════════════
// 8. RESTAURANT-SIDE — list / clone / edit / submit / approve / reject
// ════════════════════════════════════════════════════════════════
async function resolveRestaurantPlanSlug(rid: number): Promise<string | null> {
  const [r] = await db.select({ tenantId: restaurantsTable.tenantId }).from(restaurantsTable).where(eq(restaurantsTable.id, rid));
  if (!r) return null;
  const [t] = await db.select({ planId: tenantsTable.planId }).from(tenantsTable).where(eq(tenantsTable.id, r.tenantId));
  if (!t?.planId) return null;
  const [p] = await db.select({ slug: subscriptionPlansTable.slug }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, t.planId));
  return p?.slug ?? null;
}

function platformTemplateVisibleToRestaurant(
  tpl: { status: string; isEnabled: boolean; assignedPlansJson: unknown; assignedRestaurantsJson: unknown },
  rid: number,
  planSlug: string | null,
): boolean {
  if (tpl.status !== "approved" || !tpl.isEnabled) return false;
  const plans = (tpl.assignedPlansJson ?? []) as string[];
  const rests = (tpl.assignedRestaurantsJson ?? []) as number[];
  const planOk = plans.length === 0 || (planSlug !== null && plans.includes(planSlug));
  const restOk = rests.length === 0 || rests.includes(rid);
  return planOk && restOk;
}

router.get("/restaurants/:restaurantId/email/template-center/templates",
  requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const planSlug = await resolveRestaurantPlanSlug(rid);
    const own = await db.select().from(emailTemplatesTable)
      .where(and(eq(emailTemplatesTable.scope, "restaurant"), eq(emailTemplatesTable.restaurantId, rid)));
    const platform = await db.select().from(emailTemplatesTable)
      .where(and(eq(emailTemplatesTable.scope, "platform"), isNull(emailTemplatesTable.restaurantId)));
    const filtered = platform.filter(t => platformTemplateVisibleToRestaurant(t, rid, planSlug));
    res.json({ data: { own, platform: filtered }, planSlug });
  });

router.post("/restaurants/:restaurantId/email/template-center/templates/:platformId/clone",
  requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const pid = parseId(req.params.platformId);
    if (!pid) return void res.status(400).json({ error: "Invalid id" });
    const [src] = await db.select().from(emailTemplatesTable)
      .where(and(eq(emailTemplatesTable.id, pid), eq(emailTemplatesTable.scope, "platform")));
    if (!src) return void res.status(404).json({ error: "Platform template not found" });
    const planSlug = await resolveRestaurantPlanSlug(rid);
    if (!platformTemplateVisibleToRestaurant(src, rid, planSlug)) {
      return void res.status(404).json({ error: "Platform template not found" });
    }
    if (!src.allowRestaurantEdit) return void res.status(403).json({ error: "This template is not editable by restaurants." });

    let newKey = `${src.key}_r${rid}`;
    const [collision] = await db.select({ id: emailTemplatesTable.id }).from(emailTemplatesTable)
      .where(and(eq(emailTemplatesTable.scope, "restaurant"), eq(emailTemplatesTable.restaurantId, rid),
        eq(emailTemplatesTable.key, newKey)));
    if (collision) newKey = `${newKey}_${Date.now().toString(36)}`;

    const [created] = await db.insert(emailTemplatesTable).values({
      scope: "restaurant",
      restaurantId: rid,
      key: newKey,
      name: `${src.name} (restaurant copy)`,
      event: src.event,
      category: src.category,
      subject: src.subject, preheader: src.preheader, body: src.body, plainText: src.plainText,
      headerLogo: src.headerLogo, footerText: src.footerText, brandColor: src.brandColor,
      ctaLabel: src.ctaLabel, ctaUrl: src.ctaUrl,
      variables: src.variables, businessTypes: src.businessTypes, planRestrictions: src.planRestrictions,
      isEnabled: false,
      status: "draft",
      allowRestaurantEdit: false,
      assignedPlansJson: [], assignedRestaurantsJson: [],
      sourceTemplateId: src.id,
      createdBySuperAdmin: false,
      createdBy: req.user?.sub ?? null,
      updatedBy: req.user?.sub ?? null,
    }).returning();
    await snapshotVersion(created, req.user?.sub ?? null);
    await db.insert(auditLogsTable).values({
      userId: req.user?.sub ?? null,
      restaurantId: rid,
      action: "email.template.cloned",
      entity: "email_templates",
      entityId: created.id,
      details: `from=${src.id}`,
    });
    res.status(201).json({ data: created });
  });

router.put("/restaurants/:restaurantId/email/template-center/templates/:id",
  requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const id = parseId(req.params.id);
    if (!id) return void res.status(400).json({ error: "Invalid id" });
    const [existing] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
    if (!existing || existing.scope !== "restaurant" || existing.restaurantId !== rid) {
      return void res.status(404).json({ error: "Not found" });
    }
    const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: req.user?.sub ?? null };
    for (const k of MUTABLE_FIELDS) {
      if (k in (req.body ?? {})) patch[k] = req.body[k];
    }
    // Restaurant edits always reset status to draft (requires re-approval).
    patch.status = "draft";
    const [updated] = await db.update(emailTemplatesTable).set(patch).where(eq(emailTemplatesTable.id, id)).returning();
    await snapshotVersion(updated, req.user?.sub ?? null);
    await db.insert(auditLogsTable).values({
      userId: req.user?.sub ?? null,
      restaurantId: rid,
      action: "email.template.updated",
      entity: "email_templates",
      entityId: id,
    });
    res.json({ data: updated });
  });

/**
 * Restaurant "submit" parks the template in pending_review awaiting Super
 * Admin internal approval. Unlike WhatsApp, there is no external provider
 * review for email — Super Admin approval flips status straight to approved.
 */
router.post("/restaurants/:restaurantId/email/template-center/templates/:id/submit",
  requireRole("owner", "super_admin"), validateRestaurantAccess, async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const id = parseId(req.params.id);
    if (!id) return void res.status(400).json({ error: "Invalid id" });
    const [tpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
    if (!tpl || tpl.scope !== "restaurant" || tpl.restaurantId !== rid) return void res.status(404).json({ error: "Not found" });
    const issues = checkEmailTemplate({ subject: tpl.subject, body: tpl.body, variables: tpl.variables, category: tpl.category });
    const summary = complianceSummary(issues);
    if (!summary.canSubmit) return void res.status(422).json({ error: "Compliance check failed", issues, summary });

    const [updated] = await db.update(emailTemplatesTable).set({
      status: "pending_review",
      rejectionReason: null,
      updatedAt: new Date(),
      updatedBy: req.user?.sub ?? null,
    }).where(eq(emailTemplatesTable.id, id)).returning();
    await snapshotVersion(updated, req.user?.sub ?? null);
    await recordSubmissionAttempt({
      templateId: id,
      attemptType: "submit",
      resultStatus: "pending_review",
      requestPayload: { key: tpl.key, restaurantId: rid },
      triggeredBy: req.user?.sub ?? null,
    });
    await db.insert(auditLogsTable).values({
      userId: req.user?.sub ?? null,
      restaurantId: rid,
      action: "email.template.submitted_for_review",
      entity: "email_templates",
      entityId: id,
    });
    res.json({ data: updated, pendingApproval: true });
  });

router.get("/admin/email/template-center/pending-approvals", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select().from(emailTemplatesTable)
    .where(and(eq(emailTemplatesTable.scope, "restaurant"), eq(emailTemplatesTable.status, "pending_review")))
    .orderBy(asc(emailTemplatesTable.updatedAt))
    .limit(500);
  res.json({ data: rows });
});

router.post("/admin/email/template-center/restaurant-templates/:id/approve", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [tpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  if (!tpl || tpl.scope !== "restaurant") return void res.status(404).json({ error: "Not found" });
  if (tpl.status !== "pending_review") return void res.status(422).json({ error: "Template is not pending review" });
  const issues = checkEmailTemplate({ subject: tpl.subject, body: tpl.body, variables: tpl.variables, category: tpl.category });
  const summary = complianceSummary(issues);
  if (!summary.canSubmit) return void res.status(422).json({ error: "Compliance check failed", issues, summary });

  const [updated] = await db.update(emailTemplatesTable).set({
    status: "approved",
    isEnabled: true,
    rejectionReason: null,
    updatedAt: new Date(),
    updatedBy: req.user?.sub ?? null,
  }).where(eq(emailTemplatesTable.id, id)).returning();
  await snapshotVersion(updated, req.user?.sub ?? null);
  await recordSubmissionAttempt({
    templateId: id,
    attemptType: "approve",
    resultStatus: "approved",
    requestPayload: { restaurantId: tpl.restaurantId, key: tpl.key },
    triggeredBy: req.user?.sub ?? null,
  });
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    restaurantId: tpl.restaurantId,
    action: "email.template.approved",
    entity: "email_templates",
    entityId: id,
  });
  res.json({ data: updated });
});

router.post("/admin/email/template-center/restaurant-templates/:id/reject", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const reason = String(req.body?.reason ?? "").slice(0, 500) || "Rejected by Super Admin";
  const [tpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  if (!tpl || tpl.scope !== "restaurant") return void res.status(404).json({ error: "Not found" });
  if (tpl.status !== "pending_review") return void res.status(422).json({ error: "Template is not pending review" });
  const [updated] = await db.update(emailTemplatesTable).set({
    status: "draft",
    rejectionReason: reason,
    updatedAt: new Date(),
    updatedBy: req.user?.sub ?? null,
  }).where(eq(emailTemplatesTable.id, id)).returning();
  await snapshotVersion(updated, req.user?.sub ?? null);
  await recordSubmissionAttempt({
    templateId: id,
    attemptType: "reject",
    resultStatus: "draft",
    errorMessage: reason,
    triggeredBy: req.user?.sub ?? null,
  });
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    restaurantId: tpl.restaurantId,
    action: "email.template.rejected_internally",
    entity: "email_templates",
    entityId: id,
    details: reason,
  });
  res.json({ data: updated });
});

router.get("/restaurants/:restaurantId/email/template-center/templates/:id/versions",
  requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const id = parseId(req.params.id);
    if (!id) return void res.status(400).json({ error: "Invalid id" });
    const [tpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
    if (!tpl) return void res.status(404).json({ error: "Not found" });
    if (tpl.scope === "restaurant") {
      if (tpl.restaurantId !== rid) return void res.status(403).json({ error: "Forbidden" });
    } else {
      const planSlug = await resolveRestaurantPlanSlug(rid);
      if (!platformTemplateVisibleToRestaurant(tpl, rid, planSlug)) {
        return void res.status(404).json({ error: "Not found" });
      }
    }
    const rows = await db.select().from(emailTemplateVersionsTable)
      .where(eq(emailTemplateVersionsTable.templateId, id))
      .orderBy(desc(emailTemplateVersionsTable.versionNumber)).limit(100);
    res.json({ data: rows });
  });

// ════════════════════════════════════════════════════════════════
// 9. DASHBOARD
// ════════════════════════════════════════════════════════════════
router.get("/admin/email/template-center/dashboard", requireSuperAdmin, async (_req, res) => {
  const [statusCounts, recentLogs] = await Promise.all([
    db.select({
      status: emailTemplatesTable.status,
      scope: emailTemplatesTable.scope,
      count: sql<number>`count(*)::int`,
    }).from(emailTemplatesTable)
      .groupBy(emailTemplatesTable.status, emailTemplatesTable.scope),
    db.select({
      templateKey: emailLogsTable.templateKey,
      status: emailLogsTable.status,
      count: sql<number>`count(*)::int`,
    }).from(emailLogsTable)
      .where(sql`${emailLogsTable.createdAt} > now() - interval '30 days'`)
      .groupBy(emailLogsTable.templateKey, emailLogsTable.status)
      .orderBy(desc(sql<number>`count(*)`))
      .limit(50),
  ]);
  res.json({ statusCounts, recentLogs });
});

export default router;
