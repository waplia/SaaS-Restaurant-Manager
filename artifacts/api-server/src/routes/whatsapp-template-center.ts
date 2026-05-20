/**
 * WhatsApp Template Center routes (Task #533).
 *
 * Lives alongside `whatsapp.ts` (which handles credentials, send, logs).
 * Provides the full CRUD + submit + sync + version-history + assignment
 * + compliance check + test-send surface needed by:
 *   - Super Admin Template Center hub
 *   - Restaurant-side template list + clone & customise flow.
 *
 * All writes are versioned: on every save the previous state is snapshotted
 * into `whatsapp_template_versions`. Submission to Meta is explicit
 * (never automatic on seed/save).
 */

import { Router, type IRouter } from "express";
import { and, asc, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  whatsappTemplatesTable,
  whatsappTemplateVersionsTable,
  whatsappTemplateSubmissionsTable,
  whatsappLogsTable,
  restaurantsTable,
  tenantsTable,
  subscriptionPlansTable,
  auditLogsTable,
  type WhatsAppTemplate,
} from "../lib/db";
import { requireRole, requireSuperAdmin } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { TEMPLATE_VARIABLES, listVariablesByCategory, getVariable, renderPlaceholders, buildExampleValues } from "../lib/templateVariables";
import { checkWhatsAppTemplate, complianceSummary } from "../lib/templateCompliance";
import { seedDefaultWhatsAppTemplates, DEFAULT_WHATSAPP_TEMPLATE_COUNT } from "../lib/whatsappTemplateSeeder";
import { createTemplateInMeta, editTemplateInMeta, deleteTemplateInMeta, fetchSingleTemplateStatus } from "../lib/whatsappTemplateMeta";
import { syncTemplates, sendWhatsAppMessage } from "../lib/whatsapp";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function parseId(v: unknown): number | null {
  const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null;
}

function snapshotVersion(t: WhatsAppTemplate, changedBy: number | null, note: string | null): Promise<unknown> {
  return db.select({ max: sql<number>`coalesce(max(version_number), 0)::int` })
    .from(whatsappTemplateVersionsTable)
    .where(eq(whatsappTemplateVersionsTable.templateId, t.id))
    .then(([r]) => db.insert(whatsappTemplateVersionsTable).values({
      templateId: t.id,
      versionNumber: (r?.max ?? 0) + 1,
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      headerType: t.headerType,
      headerText: t.headerText,
      headerMediaUrl: t.headerMediaUrl,
      bodyText: t.bodyText,
      footerText: t.footerText,
      buttonsJson: t.buttonsJson,
      variablesJson: t.variablesJson,
      sampleValuesJson: t.sampleValuesJson,
      metaResponseJson: t.metaResponseJson,
      changeNote: note,
      changedBy,
    }));
}

const MUTABLE_FIELDS: Array<keyof WhatsAppTemplate> = [
  "name", "language", "category", "description", "defaultForEvent",
  "headerType", "headerText", "headerMediaUrl",
  "bodyText", "footerText",
  "buttonsJson", "variablesJson", "sampleValuesJson",
  "allowRestaurantEdit", "assignedPlansJson", "assignedRestaurantsJson",
];

// ════════════════════════════════════════════════════════════════
// 1. VARIABLES REGISTRY
// ════════════════════════════════════════════════════════════════
router.get("/admin/whatsapp/template-center/variables", requireSuperAdmin, (_req, res) => {
  res.json({
    data: TEMPLATE_VARIABLES,
    byCategory: listVariablesByCategory(),
  });
});

router.get("/restaurants/:restaurantId/whatsapp/template-center/variables",
  requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, (_req, res) => {
    res.json({
      data: TEMPLATE_VARIABLES.filter(v => !v.systemOnly),
      byCategory: Object.fromEntries(
        Object.entries(listVariablesByCategory()).map(([k, vs]) => [k, vs.filter(v => !v.systemOnly)]),
      ),
    });
  });

// ════════════════════════════════════════════════════════════════
// 2. SUPER ADMIN — list / detail / create / update / submit / delete
// ════════════════════════════════════════════════════════════════
router.get("/admin/whatsapp/template-center/templates", requireSuperAdmin, async (req, res) => {
  const conds: SQL[] = [eq(whatsappTemplatesTable.scope, "platform")];
  if (req.query.status) conds.push(eq(whatsappTemplatesTable.status, String(req.query.status)));
  if (req.query.category) conds.push(eq(whatsappTemplatesTable.category, String(req.query.category)));
  if (req.query.q) {
    const q = `%${String(req.query.q).trim()}%`;
    const search = or(
      sql`${whatsappTemplatesTable.name} ILIKE ${q}`,
      sql`${whatsappTemplatesTable.bodyText} ILIKE ${q}`,
      sql`${whatsappTemplatesTable.description} ILIKE ${q}`,
    );
    if (search) conds.push(search);
  }
  const rows = await db.select().from(whatsappTemplatesTable)
    .where(and(...conds))
    .orderBy(desc(whatsappTemplatesTable.updatedAt))
    .limit(1000);
  res.json({ data: rows, total: rows.length });
});

router.get("/admin/whatsapp/template-center/templates/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [row] = await db.select().from(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, id));
  if (!row) return void res.status(404).json({ error: "Not found" });
  const issues = checkWhatsAppTemplate(row);
  res.json({ data: row, compliance: { issues, summary: complianceSummary(issues) } });
});

router.post("/admin/whatsapp/template-center/templates", requireSuperAdmin, async (req, res) => {
  const b = req.body ?? {};
  if (!b.name || !b.bodyText || !b.category) {
    return void res.status(400).json({ error: "name, category and bodyText are required" });
  }
  try {
    const [created] = await db.insert(whatsappTemplatesTable).values({
      scope: "platform",
      restaurantId: null,
      name: String(b.name),
      language: String(b.language ?? "en"),
      category: String(b.category),
      status: "draft",
      bodyPreview: String(b.bodyText).slice(0, 500),
      bodyText: String(b.bodyText),
      description: b.description ?? null,
      headerType: b.headerType ?? "none",
      headerText: b.headerText ?? null,
      headerMediaUrl: b.headerMediaUrl ?? null,
      footerText: b.footerText ?? null,
      buttonsJson: Array.isArray(b.buttonsJson) ? b.buttonsJson : [],
      variablesJson: Array.isArray(b.variablesJson) ? b.variablesJson : [],
      sampleValuesJson: b.sampleValuesJson ?? {},
      allowRestaurantEdit: !!b.allowRestaurantEdit,
      assignedPlansJson: Array.isArray(b.assignedPlansJson) ? b.assignedPlansJson : [],
      assignedRestaurantsJson: Array.isArray(b.assignedRestaurantsJson) ? b.assignedRestaurantsJson : [],
      defaultForEvent: b.defaultForEvent ?? null,
      createdBySuperAdmin: true,
      createdBy: req.user?.sub ?? null,
      updatedBy: req.user?.sub ?? null,
    }).returning();
    await snapshotVersion(created, req.user?.sub ?? null, "initial");
    await db.insert(auditLogsTable).values({
      userId: req.user?.sub ?? null,
      action: "whatsapp.template.created",
      entity: "whatsapp_templates",
      entityId: created.id,
    });
    res.status(201).json({ data: created });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return void res.status(409).json({ error: "A template with this name + language already exists." });
    }
    throw err;
  }
});

router.put("/admin/whatsapp/template-center/templates/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Not found" });

  const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: req.user?.sub ?? null };
  for (const k of MUTABLE_FIELDS) {
    if (k in (req.body ?? {})) patch[k] = req.body[k];
  }
  if ("bodyText" in patch) patch.bodyPreview = String(patch.bodyText ?? "").slice(0, 500);
  // Editing should revert status to draft if it was previously approved/rejected.
  if (existing.status === "approved" || existing.status === "rejected") {
    if ("bodyText" in patch || "headerText" in patch || "headerMediaUrl" in patch || "buttonsJson" in patch || "footerText" in patch) {
      patch.status = "draft";
    }
  }
  const [updated] = await db.update(whatsappTemplatesTable).set(patch).where(eq(whatsappTemplatesTable.id, id)).returning();
  await snapshotVersion(updated, req.user?.sub ?? null, (req.body?.changeNote as string | null) ?? null);
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    action: "whatsapp.template.updated",
    entity: "whatsapp_templates",
    entityId: id,
  });
  res.json({ data: updated });
});

router.delete("/admin/whatsapp/template-center/templates/:id", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, id));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  // Best-effort delete in Meta if it was submitted.
  if (existing.metaTemplateId && req.query.metaDelete === "true") {
    try { await deleteTemplateInMeta("platform", null, existing.name); }
    catch (err) { logger.warn({ err, name: existing.name }, "Meta template delete failed (continuing)"); }
  }
  await db.delete(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, id));
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    action: "whatsapp.template.deleted",
    entity: "whatsapp_templates",
    entityId: id,
  });
  res.status(204).send();
});

// ════════════════════════════════════════════════════════════════
// 3. COMPLIANCE CHECK (preview/dry-run)
// ════════════════════════════════════════════════════════════════
router.post("/admin/whatsapp/template-center/check", requireSuperAdmin, (req, res) => {
  const issues = checkWhatsAppTemplate(req.body ?? {});
  res.json({ issues, summary: complianceSummary(issues) });
});

router.post("/restaurants/:restaurantId/whatsapp/template-center/check",
  requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, (req, res) => {
    const issues = checkWhatsAppTemplate(req.body ?? {});
    res.json({ issues, summary: complianceSummary(issues) });
  });

// ════════════════════════════════════════════════════════════════
// 4. SUBMIT / RESUBMIT / SYNC STATUS
// ════════════════════════════════════════════════════════════════
router.post("/admin/whatsapp/template-center/templates/:id/submit", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [tpl] = await db.select().from(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, id));
  if (!tpl) return void res.status(404).json({ error: "Not found" });
  const issues = checkWhatsAppTemplate(tpl);
  const summary = complianceSummary(issues);
  if (!summary.canSubmit) {
    return void res.status(422).json({ error: "Compliance check failed", issues, summary });
  }
  try {
    const out = tpl.metaTemplateId
      ? await editTemplateInMeta("platform", null, tpl.metaTemplateId, tpl)
      : await createTemplateInMeta("platform", null, tpl);
    const [updated] = await db.update(whatsappTemplatesTable).set({
      status: out.status,
      metaTemplateId: (("metaTemplateId" in out ? (out as { metaTemplateId: string | null }).metaTemplateId : tpl.metaTemplateId) ?? tpl.metaTemplateId) as string | null,
      metaResponseJson: out.raw as Record<string, unknown>,
      rejectionReason: null,
      updatedAt: new Date(),
      updatedBy: req.user?.sub ?? null,
      lastSyncedAt: new Date(),
    }).where(eq(whatsappTemplatesTable.id, id)).returning();
    await snapshotVersion(updated, req.user?.sub ?? null, "submitted");
    await recordSubmissionAttempt({
      templateId: id,
      attemptType: tpl.metaTemplateId ? "edit" : "submit",
      resultStatus: out.status,
      metaTemplateId: updated.metaTemplateId,
      requestPayload: { name: tpl.name, language: tpl.language, category: tpl.category },
      response: out.raw as Record<string, unknown>,
      triggeredBy: req.user?.sub ?? null,
    });
    await db.insert(auditLogsTable).values({
      userId: req.user?.sub ?? null,
      action: "whatsapp.template.submitted",
      entity: "whatsapp_templates",
      entityId: id,
      details: `status=${out.status}`,
    });
    res.json({ data: updated });
  } catch (err) {
    const msg = (err as Error).message;
    await db.update(whatsappTemplatesTable).set({
      status: "rejected",
      rejectionReason: msg.slice(0, 500),
      updatedAt: new Date(),
    }).where(eq(whatsappTemplatesTable.id, id));
    await recordSubmissionAttempt({
      templateId: id,
      attemptType: tpl.metaTemplateId ? "edit" : "submit",
      resultStatus: "error",
      metaTemplateId: tpl.metaTemplateId,
      requestPayload: { name: tpl.name, language: tpl.language, category: tpl.category },
      errorMessage: msg.slice(0, 500),
      triggeredBy: req.user?.sub ?? null,
    });
    await db.insert(auditLogsTable).values({
      userId: req.user?.sub ?? null,
      action: "whatsapp.template.submit_failed",
      entity: "whatsapp_templates",
      entityId: id,
      details: msg.slice(0, 500),
    });
    res.status(400).json({ error: msg });
  }
});

router.post("/admin/whatsapp/template-center/templates/:id/sync-status", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [tpl] = await db.select().from(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, id));
  if (!tpl) return void res.status(404).json({ error: "Not found" });
  try {
    const out = await fetchSingleTemplateStatus("platform", null, tpl.name, tpl.language);
    const [updated] = await db.update(whatsappTemplatesTable).set({
      status: out.status,
      metaResponseJson: (out.raw ?? {}) as Record<string, unknown>,
      lastSyncedAt: new Date(),
    }).where(eq(whatsappTemplatesTable.id, id)).returning();
    await recordSubmissionAttempt({
      templateId: id,
      attemptType: "sync",
      resultStatus: out.status,
      metaTemplateId: updated.metaTemplateId,
      response: (out.raw ?? {}) as Record<string, unknown>,
      triggeredBy: req.user?.sub ?? null,
    });
    res.json({ data: updated });
  } catch (err) {
    await recordSubmissionAttempt({
      templateId: id,
      attemptType: "sync",
      resultStatus: "error",
      metaTemplateId: tpl.metaTemplateId,
      errorMessage: (err as Error).message.slice(0, 500),
      triggeredBy: req.user?.sub ?? null,
    });
    res.status(400).json({ error: (err as Error).message });
  }
});

// History of all Meta-attempts for a specific template (super admin).
router.get("/admin/whatsapp/template-center/templates/:id/submissions", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const rows = await db.select().from(whatsappTemplateSubmissionsTable)
    .where(eq(whatsappTemplateSubmissionsTable.templateId, id))
    .orderBy(desc(whatsappTemplateSubmissionsTable.createdAt))
    .limit(200);
  res.json({ data: rows });
});

router.post("/admin/whatsapp/template-center/sync-all", requireSuperAdmin, async (req, res) => {
  try {
    const out = await syncTemplates("platform", null);
    await db.insert(auditLogsTable).values({
      userId: req.user?.sub ?? null,
      action: "whatsapp.template_center.sync_all",
      entity: "whatsapp_templates",
      details: `synced=${out.synced}`,
    });
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ════════════════════════════════════════════════════════════════
// 5. VERSION HISTORY
// ════════════════════════════════════════════════════════════════
router.get("/admin/whatsapp/template-center/templates/:id/versions", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const rows = await db.select().from(whatsappTemplateVersionsTable)
    .where(eq(whatsappTemplateVersionsTable.templateId, id))
    .orderBy(desc(whatsappTemplateVersionsTable.versionNumber))
    .limit(200);
  res.json({ data: rows });
});

router.post("/admin/whatsapp/template-center/templates/:id/rollback/:versionId", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  const vid = parseId(req.params.versionId);
  if (!id || !vid) return void res.status(400).json({ error: "Invalid id" });
  const [v] = await db.select().from(whatsappTemplateVersionsTable)
    .where(and(eq(whatsappTemplateVersionsTable.id, vid), eq(whatsappTemplateVersionsTable.templateId, id)));
  if (!v) return void res.status(404).json({ error: "Version not found" });
  const [current] = await db.select().from(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, id));
  if (!current) return void res.status(404).json({ error: "Template not found" });
  await snapshotVersion(current, req.user?.sub ?? null, `pre-rollback to v${v.versionNumber}`);
  const [updated] = await db.update(whatsappTemplatesTable).set({
    name: v.name, language: v.language, category: v.category,
    headerType: v.headerType, headerText: v.headerText, headerMediaUrl: v.headerMediaUrl,
    bodyText: v.bodyText, footerText: v.footerText,
    buttonsJson: v.buttonsJson, variablesJson: v.variablesJson, sampleValuesJson: v.sampleValuesJson,
    bodyPreview: (v.bodyText ?? "").slice(0, 500),
    status: "draft",
    updatedAt: new Date(),
    updatedBy: req.user?.sub ?? null,
  }).where(eq(whatsappTemplatesTable.id, id)).returning();
  await snapshotVersion(updated, req.user?.sub ?? null, `rolled back to v${v.versionNumber}`);
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    action: "whatsapp.template.rolled_back",
    entity: "whatsapp_templates",
    entityId: id,
    details: `versionId=${vid}`,
  });
  res.json({ data: updated });
});

// ════════════════════════════════════════════════════════════════
// 6. ASSIGNMENT (plans + restaurants)
// ════════════════════════════════════════════════════════════════
router.put("/admin/whatsapp/template-center/templates/:id/assignments", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const { plans, restaurants, allowRestaurantEdit } = req.body ?? {};
  const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: req.user?.sub ?? null };
  if (Array.isArray(plans)) patch.assignedPlansJson = plans.map(String);
  if (Array.isArray(restaurants)) patch.assignedRestaurantsJson = restaurants.map(Number).filter(Number.isFinite);
  if (typeof allowRestaurantEdit === "boolean") patch.allowRestaurantEdit = allowRestaurantEdit;
  const [updated] = await db.update(whatsappTemplatesTable).set(patch).where(eq(whatsappTemplatesTable.id, id)).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    action: "whatsapp.template.assignments_updated",
    entity: "whatsapp_templates",
    entityId: id,
  });
  res.json({ data: updated });
});

// ════════════════════════════════════════════════════════════════
// 7. RENDER / PREVIEW / TEST SEND
// ════════════════════════════════════════════════════════════════
router.post("/admin/whatsapp/template-center/templates/:id/preview", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [tpl] = await db.select().from(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, id));
  if (!tpl) return void res.status(404).json({ error: "Not found" });
  const values = buildExampleValues(req.body?.values ?? {});
  const body = renderPlaceholders(tpl.bodyText ?? "", positionalToNamed(tpl.variablesJson ?? [], values));
  const header = tpl.headerText
    ? renderPlaceholders(tpl.headerText, positionalToNamed(tpl.variablesJson ?? [], values))
    : null;
  res.json({ data: { header, body, footer: tpl.footerText, buttons: tpl.buttonsJson, headerType: tpl.headerType, headerMediaUrl: tpl.headerMediaUrl } });
});

router.post("/admin/whatsapp/template-center/templates/:id/test-send", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const { to, values } = req.body as { to?: string; values?: Record<string, string> };
  if (!to) return void res.status(400).json({ error: "to is required" });
  const [tpl] = await db.select().from(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, id));
  if (!tpl) return void res.status(404).json({ error: "Not found" });
  if (tpl.status !== "approved") {
    return void res.status(422).json({ error: "Template must be approved by Meta before live test send. Use Preview for unapproved templates." });
  }
  const merged = buildExampleValues(values ?? {});
  const positional = (tpl.variablesJson ?? []).map(v => merged[String((v as { key?: string }).key ?? "")] ?? (v as { example?: string }).example ?? "");
  const result = await sendWhatsAppMessage({
    restaurantId: null,
    to,
    templateName: tpl.name,
    templateLanguage: tpl.language,
    templateVariables: positional,
    meta: { source: "template_center_test", templateId: tpl.id },
    sentBy: req.user?.sub ?? null,
    // Test sends respect quotas and safe-send guardrails (spec §6).
    // We do NOT bypass quotas just because this is an admin test —
    // otherwise an admin could flood a real recipient by repeatedly
    // clicking "Send test".
    skipQuota: false,
  });
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    action: "whatsapp.template.test_sent",
    entity: "whatsapp_templates",
    entityId: id,
    details: `status=${result.status}`,
  });
  res.json(result);
});

/**
 * Persist a Meta-attempt audit row to `whatsapp_template_submissions`.
 * Called on every submit / edit / approve / sync / reject path so we have
 * a true append-only history of what we sent and what Meta returned —
 * separate from the content-snapshot `whatsapp_template_versions`.
 */
async function recordSubmissionAttempt(args: {
  templateId: number;
  attemptType: "submit" | "edit" | "approve" | "sync" | "reject";
  resultStatus: string;
  metaTemplateId?: string | null;
  requestPayload?: Record<string, unknown>;
  response?: Record<string, unknown>;
  errorMessage?: string | null;
  triggeredBy: number | null;
}): Promise<void> {
  try {
    await db.insert(whatsappTemplateSubmissionsTable).values({
      templateId: args.templateId,
      attemptType: args.attemptType,
      resultStatus: args.resultStatus,
      metaTemplateId: args.metaTemplateId ?? null,
      requestPayloadJson: args.requestPayload ?? {},
      responseJson: args.response ?? {},
      errorMessage: args.errorMessage ?? null,
      triggeredBy: args.triggeredBy,
    });
  } catch (err) {
    logger.warn({ err, templateId: args.templateId }, "[whatsapp template] failed to record submission attempt");
  }
}

function positionalToNamed(mapping: Array<Record<string, unknown>>, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...values };
  for (const v of mapping) {
    const idx = Number(v.index);
    const key = String(v.key ?? "");
    if (Number.isFinite(idx) && key) out[String(idx)] = values[key] ?? (v.example as string) ?? "";
  }
  return out;
}

// ════════════════════════════════════════════════════════════════
// 8. SEED / RESEED DEFAULT TEMPLATES
// ════════════════════════════════════════════════════════════════
router.post("/admin/whatsapp/template-center/seed-defaults", requireSuperAdmin, async (req, res) => {
  const out = await seedDefaultWhatsAppTemplates();
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    action: "whatsapp.template_center.seeded",
    entity: "whatsapp_templates",
    details: `inserted=${out.inserted} skipped=${out.skipped} total=${DEFAULT_WHATSAPP_TEMPLATE_COUNT}`,
  });
  res.json({ ...out, total: DEFAULT_WHATSAPP_TEMPLATE_COUNT });
});

// ════════════════════════════════════════════════════════════════
// 9. SUBMISSIONS QUEUE (status overview)
// ════════════════════════════════════════════════════════════════
router.get("/admin/whatsapp/template-center/submissions", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select({
    id: whatsappTemplatesTable.id,
    name: whatsappTemplatesTable.name,
    language: whatsappTemplatesTable.language,
    category: whatsappTemplatesTable.category,
    status: whatsappTemplatesTable.status,
    rejectionReason: whatsappTemplatesTable.rejectionReason,
    metaTemplateId: whatsappTemplatesTable.metaTemplateId,
    lastSyncedAt: whatsappTemplatesTable.lastSyncedAt,
    updatedAt: whatsappTemplatesTable.updatedAt,
  }).from(whatsappTemplatesTable)
    .where(eq(whatsappTemplatesTable.scope, "platform"))
    .orderBy(desc(whatsappTemplatesTable.updatedAt))
    .limit(500);
  const byStatus = rows.reduce<Record<string, number>>((m, r) => {
    m[r.status] = (m[r.status] ?? 0) + 1;
    return m;
  }, {});
  res.json({ data: rows, byStatus });
});

/**
 * Resolve a restaurant's plan slug (used for plan-based template gating).
 */
async function resolveRestaurantPlanSlug(rid: number): Promise<string | null> {
  const [r] = await db.select({ tenantId: restaurantsTable.tenantId }).from(restaurantsTable).where(eq(restaurantsTable.id, rid));
  if (!r) return null;
  const [t] = await db.select({ planId: tenantsTable.planId }).from(tenantsTable).where(eq(tenantsTable.id, r.tenantId));
  if (!t?.planId) return null;
  const [p] = await db.select({ slug: subscriptionPlansTable.slug }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, t.planId));
  return p?.slug ?? null;
}

/**
 * Returns true when a platform template is *visible* to the given
 * restaurant — i.e. assigned to its plan or directly to the restaurant,
 * and approved by Meta. Used to gate clone/read/versions endpoints so
 * restaurants cannot reach templates by guessing IDs.
 */
function platformTemplateVisibleToRestaurant(
  tpl: { status: string; assignedPlansJson: unknown; assignedRestaurantsJson: unknown },
  rid: number,
  planSlug: string | null,
): boolean {
  if (tpl.status !== "approved") return false;
  const plans = (tpl.assignedPlansJson ?? []) as string[];
  const rests = (tpl.assignedRestaurantsJson ?? []) as number[];
  const planOk = plans.length === 0 || (planSlug !== null && plans.includes(planSlug));
  const restOk = rests.length === 0 || rests.includes(rid);
  return planOk && restOk;
}

// ════════════════════════════════════════════════════════════════
// 10. RESTAURANT-SIDE — list available templates + clone
// ════════════════════════════════════════════════════════════════
router.get("/restaurants/:restaurantId/whatsapp/template-center/templates",
  requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const planSlug = await resolveRestaurantPlanSlug(rid);

    const own = await db.select().from(whatsappTemplatesTable)
      .where(and(eq(whatsappTemplatesTable.scope, "restaurant"), eq(whatsappTemplatesTable.restaurantId, rid)));
    const platform = await db.select().from(whatsappTemplatesTable)
      .where(and(eq(whatsappTemplatesTable.scope, "platform"), isNull(whatsappTemplatesTable.restaurantId)));

    // Only platform templates that are Meta-APPROVED and assigned to the
    // restaurant (directly or via its plan) are exposed.
    const filtered = platform.filter(t => platformTemplateVisibleToRestaurant(t, rid, planSlug));

    res.json({
      data: { own, platform: filtered },
      planSlug,
    });
  });

router.post("/restaurants/:restaurantId/whatsapp/template-center/templates/:platformId/clone",
  requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const pid = parseId(req.params.platformId);
    if (!pid) return void res.status(400).json({ error: "Invalid id" });
    const [src] = await db.select().from(whatsappTemplatesTable)
      .where(and(eq(whatsappTemplatesTable.id, pid), eq(whatsappTemplatesTable.scope, "platform")));
    if (!src) return void res.status(404).json({ error: "Platform template not found" });
    // Enforce plan/restaurant assignment + Meta-approved status before
    // cloning, otherwise a restaurant could guess IDs to clone templates
    // it isn't entitled to.
    const planSlug = await resolveRestaurantPlanSlug(rid);
    if (!platformTemplateVisibleToRestaurant(src, rid, planSlug)) {
      return void res.status(404).json({ error: "Platform template not found" });
    }
    if (!src.allowRestaurantEdit) return void res.status(403).json({ error: "This template is not editable by restaurants." });
    const suffix = `_${rid}`;
    let newName = `${src.name}${suffix}`;
    // Ensure unique name within restaurant scope.
    const [collision] = await db.select({ id: whatsappTemplatesTable.id }).from(whatsappTemplatesTable)
      .where(and(eq(whatsappTemplatesTable.scope, "restaurant"), eq(whatsappTemplatesTable.restaurantId, rid),
        eq(whatsappTemplatesTable.name, newName), eq(whatsappTemplatesTable.language, src.language)));
    if (collision) newName = `${newName}_${Date.now().toString(36)}`;

    const [created] = await db.insert(whatsappTemplatesTable).values({
      scope: "restaurant",
      restaurantId: rid,
      name: newName,
      language: src.language,
      category: src.category,
      status: "draft",
      bodyPreview: src.bodyPreview,
      bodyText: src.bodyText,
      description: src.description,
      headerType: src.headerType,
      headerText: src.headerText,
      headerMediaUrl: src.headerMediaUrl,
      footerText: src.footerText,
      buttonsJson: src.buttonsJson,
      variablesJson: src.variablesJson,
      sampleValuesJson: src.sampleValuesJson,
      allowRestaurantEdit: false,
      assignedPlansJson: [],
      assignedRestaurantsJson: [],
      raw: {},
      metaResponseJson: {},
      sourceTemplateId: src.id,
      createdBySuperAdmin: false,
      createdBy: req.user?.sub ?? null,
      updatedBy: req.user?.sub ?? null,
    }).returning();
    await snapshotVersion(created, req.user?.sub ?? null, `cloned from platform #${src.id}`);
    await db.insert(auditLogsTable).values({
      userId: req.user?.sub ?? null,
      restaurantId: rid,
      action: "whatsapp.template.cloned",
      entity: "whatsapp_templates",
      entityId: created.id,
      details: `from=${src.id}`,
    });
    res.status(201).json({ data: created });
  });

router.put("/restaurants/:restaurantId/whatsapp/template-center/templates/:id",
  requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const id = parseId(req.params.id);
    if (!id) return void res.status(400).json({ error: "Invalid id" });
    const [existing] = await db.select().from(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, id));
    if (!existing || existing.scope !== "restaurant" || existing.restaurantId !== rid) {
      return void res.status(404).json({ error: "Not found" });
    }
    const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: req.user?.sub ?? null };
    for (const k of MUTABLE_FIELDS) {
      if (k in (req.body ?? {})) patch[k] = req.body[k];
    }
    if ("bodyText" in patch) patch.bodyPreview = String(patch.bodyText ?? "").slice(0, 500);
    // Restaurant edits always reset status to draft.
    patch.status = "draft";
    const [updated] = await db.update(whatsappTemplatesTable).set(patch).where(eq(whatsappTemplatesTable.id, id)).returning();
    await snapshotVersion(updated, req.user?.sub ?? null, (req.body?.changeNote as string | null) ?? null);
    await db.insert(auditLogsTable).values({
      userId: req.user?.sub ?? null,
      restaurantId: rid,
      action: "whatsapp.template.updated",
      entity: "whatsapp_templates",
      entityId: id,
    });
    res.json({ data: updated });
  });

/**
 * Restaurant "submit" really means "submit for internal Super Admin
 * approval" — the template is parked in `pending_review` and a Super
 * Admin must approve before it is ever sent to Meta. This preserves
 * messaging governance and keeps restaurants from bypassing the
 * platform's review of WhatsApp content.
 */
router.post("/restaurants/:restaurantId/whatsapp/template-center/templates/:id/submit",
  requireRole("owner", "super_admin"), validateRestaurantAccess, async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const id = parseId(req.params.id);
    if (!id) return void res.status(400).json({ error: "Invalid id" });
    const [tpl] = await db.select().from(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, id));
    if (!tpl || tpl.scope !== "restaurant" || tpl.restaurantId !== rid) return void res.status(404).json({ error: "Not found" });
    const issues = checkWhatsAppTemplate(tpl);
    const summary = complianceSummary(issues);
    if (!summary.canSubmit) return void res.status(422).json({ error: "Compliance check failed", issues, summary });

    const [updated] = await db.update(whatsappTemplatesTable).set({
      status: "pending_review",
      rejectionReason: null,
      updatedAt: new Date(),
      updatedBy: req.user?.sub ?? null,
    }).where(eq(whatsappTemplatesTable.id, id)).returning();
    await snapshotVersion(updated, req.user?.sub ?? null, "submitted for internal review");
    await db.insert(auditLogsTable).values({
      userId: req.user?.sub ?? null,
      restaurantId: rid,
      action: "whatsapp.template.submitted_for_review",
      entity: "whatsapp_templates",
      entityId: id,
      details: "awaiting super admin approval",
    });
    res.json({ data: updated, pendingApproval: true });
  });

// ── Super Admin approve / reject of restaurant submissions ────────
router.get("/admin/whatsapp/template-center/pending-approvals", requireSuperAdmin, async (_req, res) => {
  const rows = await db.select().from(whatsappTemplatesTable)
    .where(and(eq(whatsappTemplatesTable.scope, "restaurant"), eq(whatsappTemplatesTable.status, "pending_review")))
    .orderBy(asc(whatsappTemplatesTable.updatedAt))
    .limit(500);
  res.json({ data: rows });
});

router.post("/admin/whatsapp/template-center/restaurant-templates/:id/approve", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [tpl] = await db.select().from(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, id));
  if (!tpl || tpl.scope !== "restaurant") return void res.status(404).json({ error: "Not found" });
  if (tpl.status !== "pending_review") return void res.status(422).json({ error: "Template is not pending internal review" });
  const issues = checkWhatsAppTemplate(tpl);
  const summary = complianceSummary(issues);
  if (!summary.canSubmit) return void res.status(422).json({ error: "Compliance check failed", issues, summary });

  try {
    const out = tpl.metaTemplateId
      ? await editTemplateInMeta("restaurant", tpl.restaurantId, tpl.metaTemplateId, tpl)
      : await createTemplateInMeta("restaurant", tpl.restaurantId, tpl);
    const [updated] = await db.update(whatsappTemplatesTable).set({
      status: out.status,
      metaTemplateId: (("metaTemplateId" in out ? (out as { metaTemplateId: string | null }).metaTemplateId : tpl.metaTemplateId) ?? tpl.metaTemplateId) as string | null,
      metaResponseJson: out.raw as Record<string, unknown>,
      rejectionReason: null,
      updatedAt: new Date(),
      updatedBy: req.user?.sub ?? null,
      lastSyncedAt: new Date(),
    }).where(eq(whatsappTemplatesTable.id, id)).returning();
    await snapshotVersion(updated, req.user?.sub ?? null, "approved & submitted to Meta");
    await recordSubmissionAttempt({
      templateId: id,
      attemptType: "approve",
      resultStatus: out.status,
      metaTemplateId: updated.metaTemplateId,
      requestPayload: { name: tpl.name, language: tpl.language, category: tpl.category, restaurantId: tpl.restaurantId },
      response: out.raw as Record<string, unknown>,
      triggeredBy: req.user?.sub ?? null,
    });
    await db.insert(auditLogsTable).values({
      userId: req.user?.sub ?? null,
      restaurantId: tpl.restaurantId,
      action: "whatsapp.template.approved",
      entity: "whatsapp_templates",
      entityId: id,
      details: `status=${out.status}`,
    });
    res.json({ data: updated });
  } catch (err) {
    const msg = (err as Error).message;
    await db.update(whatsappTemplatesTable).set({
      status: "rejected",
      rejectionReason: msg.slice(0, 500),
      updatedAt: new Date(),
    }).where(eq(whatsappTemplatesTable.id, id));
    await recordSubmissionAttempt({
      templateId: id,
      attemptType: "approve",
      resultStatus: "error",
      metaTemplateId: tpl.metaTemplateId,
      requestPayload: { name: tpl.name, language: tpl.language, category: tpl.category, restaurantId: tpl.restaurantId },
      errorMessage: msg.slice(0, 500),
      triggeredBy: req.user?.sub ?? null,
    });
    await db.insert(auditLogsTable).values({
      userId: req.user?.sub ?? null,
      restaurantId: tpl.restaurantId,
      action: "whatsapp.template.meta_submit_failed",
      entity: "whatsapp_templates",
      entityId: id,
      details: msg.slice(0, 500),
    });
    res.status(400).json({ error: msg });
  }
});

router.post("/admin/whatsapp/template-center/restaurant-templates/:id/reject", requireSuperAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const reason = String(req.body?.reason ?? "").slice(0, 500) || "Rejected by Super Admin";
  const [tpl] = await db.select().from(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, id));
  if (!tpl || tpl.scope !== "restaurant") return void res.status(404).json({ error: "Not found" });
  if (tpl.status !== "pending_review") return void res.status(422).json({ error: "Template is not pending internal review" });
  const [updated] = await db.update(whatsappTemplatesTable).set({
    status: "draft",
    rejectionReason: reason,
    updatedAt: new Date(),
    updatedBy: req.user?.sub ?? null,
  }).where(eq(whatsappTemplatesTable.id, id)).returning();
  await snapshotVersion(updated, req.user?.sub ?? null, `rejected: ${reason}`);
  await recordSubmissionAttempt({
    templateId: id,
    attemptType: "reject",
    resultStatus: "draft",
    metaTemplateId: tpl.metaTemplateId,
    errorMessage: reason,
    triggeredBy: req.user?.sub ?? null,
  });
  await db.insert(auditLogsTable).values({
    userId: req.user?.sub ?? null,
    restaurantId: tpl.restaurantId,
    action: "whatsapp.template.rejected_internally",
    entity: "whatsapp_templates",
    entityId: id,
    details: reason,
  });
  res.json({ data: updated });
});

router.get("/restaurants/:restaurantId/whatsapp/template-center/templates/:id/versions",
  requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, async (req, res) => {
    const rid = Number(req.params.restaurantId);
    const id = parseId(req.params.id);
    if (!id) return void res.status(400).json({ error: "Invalid id" });
    const [tpl] = await db.select().from(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, id));
    if (!tpl) return void res.status(404).json({ error: "Not found" });
    if (tpl.scope === "restaurant") {
      if (tpl.restaurantId !== rid) return void res.status(403).json({ error: "Forbidden" });
    } else {
      // Platform templates: only expose history of templates the restaurant
      // is actually entitled to use (assigned + approved).
      const planSlug = await resolveRestaurantPlanSlug(rid);
      if (!platformTemplateVisibleToRestaurant(tpl, rid, planSlug)) {
        return void res.status(404).json({ error: "Not found" });
      }
    }
    const rows = await db.select().from(whatsappTemplateVersionsTable)
      .where(eq(whatsappTemplateVersionsTable.templateId, id))
      .orderBy(desc(whatsappTemplateVersionsTable.versionNumber)).limit(100);
    res.json({ data: rows });
  });

// ════════════════════════════════════════════════════════════════
// 11. SIMPLE DASHBOARD STATS
// ════════════════════════════════════════════════════════════════
router.get("/admin/whatsapp/template-center/dashboard", requireSuperAdmin, async (_req, res) => {
  const [statusCounts, recentLogs] = await Promise.all([
    db.select({
      status: whatsappTemplatesTable.status,
      count: sql<number>`count(*)::int`,
    }).from(whatsappTemplatesTable)
      .where(eq(whatsappTemplatesTable.scope, "platform"))
      .groupBy(whatsappTemplatesTable.status),
    db.select({
      templateName: whatsappLogsTable.templateName,
      status: whatsappLogsTable.status,
      count: sql<number>`count(*)::int`,
    }).from(whatsappLogsTable)
      .where(sql`${whatsappLogsTable.createdAt} > now() - interval '30 days'`)
      .groupBy(whatsappLogsTable.templateName, whatsappLogsTable.status)
      .orderBy(desc(sql<number>`count(*)`))
      .limit(50),
  ]);
  const byStatus: Record<string, number> = {};
  for (const r of statusCounts) byStatus[r.status] = r.count;
  res.json({ byStatus, recentLogs, defaultCount: DEFAULT_WHATSAPP_TEMPLATE_COUNT });
});

export default router;
