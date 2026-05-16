import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  mysteryAuditTemplatesTable,
  mysteryAuditCategoriesTable,
  mysteryAuditItemsTable,
  mysteryAuditAssignmentsTable,
  mysteryAuditSubmissionsTable,
  mysteryAuditResponsesTable,
  mysteryAuditCorrectiveActionsTable,
  restaurantsTable,
  usersTable,
  notificationsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { requirePlanFeature } from "../middleware/planFeature";
import { recordAuditLog } from "../lib/audit";
import { buildMysteryAuditPdfBuffer, uploadMysteryAuditPdf } from "../lib/mysteryAuditPdf";

const router: IRouter = Router();

const planGate = requirePlanFeature("mystery_audits");
const MANAGER_ROLES = ["owner", "manager", "super_admin"] as const;
const AUDITOR_ROLES = ["owner", "manager", "auditor", "super_admin"] as const;

router.use("/mystery-audits", planGate);

// ---------- Helpers ----------

function tenantId(req: Request): number {
  const t = req.user?.tenantId;
  if (!t && !req.user?.isSuperAdmin) throw new Error("No tenant");
  return t ?? 0;
}

async function ensureTemplateInTenant(req: Request, tplId: number) {
  const [tpl] = await db.select().from(mysteryAuditTemplatesTable).where(eq(mysteryAuditTemplatesTable.id, tplId));
  if (!tpl) return null;
  if (!req.user!.isSuperAdmin && tpl.tenantId !== req.user!.tenantId) return null;
  return tpl;
}

async function ensureRestaurantInTenant(req: Request, rid: number) {
  const [r] = await db.select({ id: restaurantsTable.id, tenantId: restaurantsTable.tenantId, name: restaurantsTable.name })
    .from(restaurantsTable).where(eq(restaurantsTable.id, rid));
  if (!r) return null;
  if (!req.user!.isSuperAdmin && r.tenantId !== req.user!.tenantId) return null;
  return r;
}

async function ensureAssignmentAccess(req: Request, aid: number) {
  const [a] = await db.select().from(mysteryAuditAssignmentsTable).where(eq(mysteryAuditAssignmentsTable.id, aid));
  if (!a) return null;
  if (!req.user!.isSuperAdmin && a.tenantId !== req.user!.tenantId) return null;
  return a;
}

function isManager(req: Request): boolean {
  return !!req.user?.isSuperAdmin || req.user?.role === "owner" || req.user?.role === "manager";
}

// ---------- Templates ----------

const TemplateBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  isActive: z.boolean().optional(),
  categories: z.array(z.object({
    id: z.number().int().optional(),
    name: z.string().min(1).max(120),
    weight: z.number().positive().max(100),
    sortOrder: z.number().int().optional(),
    items: z.array(z.object({
      id: z.number().int().optional(),
      label: z.string().min(1).max(200),
      description: z.string().max(1000).nullish(),
      maxScore: z.number().int().min(1).max(100),
      requirePhoto: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    })).min(1),
  })).min(1),
});

router.get("/mystery-audits/templates", requireRole(...AUDITOR_ROLES), async (req, res) => {
  const tid = tenantId(req);
  const rows = await db.select().from(mysteryAuditTemplatesTable)
    .where(req.user!.isSuperAdmin ? sql`1=1` : eq(mysteryAuditTemplatesTable.tenantId, tid))
    .orderBy(desc(mysteryAuditTemplatesTable.updatedAt));
  res.json({ data: rows });
});

router.get("/mystery-audits/templates/:id", requireRole(...AUDITOR_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const tpl = await ensureTemplateInTenant(req, id);
  if (!tpl) return void res.status(404).json({ error: "Not found" });
  const cats = await db.select().from(mysteryAuditCategoriesTable)
    .where(eq(mysteryAuditCategoriesTable.templateId, id))
    .orderBy(asc(mysteryAuditCategoriesTable.sortOrder), asc(mysteryAuditCategoriesTable.id));
  const items = cats.length === 0 ? [] : await db.select().from(mysteryAuditItemsTable)
    .where(inArray(mysteryAuditItemsTable.categoryId, cats.map(c => c.id)))
    .orderBy(asc(mysteryAuditItemsTable.sortOrder), asc(mysteryAuditItemsTable.id));
  res.json({
    data: {
      ...tpl,
      categories: cats.map(c => ({
        ...c,
        weight: Number(c.weight),
        items: items.filter(i => i.categoryId === c.id),
      })),
    },
  });
});

router.post("/mystery-audits/templates", requireRole(...MANAGER_ROLES), async (req, res) => {
  const parsed = TemplateBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  const tid = tenantId(req);
  const [tpl] = await db.insert(mysteryAuditTemplatesTable).values({
    tenantId: tid,
    name: parsed.data.name,
    description: parsed.data.description ?? "",
    isActive: parsed.data.isActive ?? true,
    createdBy: req.user!.sub ?? null,
  }).returning();
  for (const [ci, c] of parsed.data.categories.entries()) {
    const [cat] = await db.insert(mysteryAuditCategoriesTable).values({
      templateId: tpl.id,
      name: c.name,
      weight: c.weight.toString(),
      sortOrder: c.sortOrder ?? ci,
    }).returning();
    for (const [ii, it] of c.items.entries()) {
      await db.insert(mysteryAuditItemsTable).values({
        categoryId: cat.id,
        label: it.label,
        description: it.description ?? null,
        maxScore: it.maxScore,
        requirePhoto: it.requirePhoto ?? false,
        sortOrder: it.sortOrder ?? ii,
      });
    }
  }
  await recordAuditLog({ req, module: "mystery_audits", action: "template.create", entity: "audit_template", entityId: tpl.id, newValue: parsed.data });
  res.status(201).json({ data: tpl });
});

router.put("/mystery-audits/templates/:id", requireRole(...MANAGER_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const tpl = await ensureTemplateInTenant(req, id);
  if (!tpl) return void res.status(404).json({ error: "Not found" });
  const parsed = TemplateBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  await db.update(mysteryAuditTemplatesTable).set({
    name: parsed.data.name,
    description: parsed.data.description ?? "",
    isActive: parsed.data.isActive ?? tpl.isActive,
    updatedAt: new Date(),
  }).where(eq(mysteryAuditTemplatesTable.id, id));
  // Replace categories+items wholesale (simpler than diffing).
  await db.delete(mysteryAuditCategoriesTable).where(eq(mysteryAuditCategoriesTable.templateId, id));
  for (const [ci, c] of parsed.data.categories.entries()) {
    const [cat] = await db.insert(mysteryAuditCategoriesTable).values({
      templateId: id,
      name: c.name,
      weight: c.weight.toString(),
      sortOrder: c.sortOrder ?? ci,
    }).returning();
    for (const [ii, it] of c.items.entries()) {
      await db.insert(mysteryAuditItemsTable).values({
        categoryId: cat.id,
        label: it.label,
        description: it.description ?? null,
        maxScore: it.maxScore,
        requirePhoto: it.requirePhoto ?? false,
        sortOrder: it.sortOrder ?? ii,
      });
    }
  }
  await recordAuditLog({ req, module: "mystery_audits", action: "template.update", entity: "audit_template", entityId: id, oldValue: tpl, newValue: parsed.data });
  res.json({ ok: true });
});

router.delete("/mystery-audits/templates/:id", requireRole(...MANAGER_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const tpl = await ensureTemplateInTenant(req, id);
  if (!tpl) return void res.status(404).json({ error: "Not found" });
  // Block delete if any assignment references it (preserve history).
  const used = await db.select({ id: mysteryAuditAssignmentsTable.id }).from(mysteryAuditAssignmentsTable)
    .where(eq(mysteryAuditAssignmentsTable.templateId, id)).limit(1);
  if (used.length) {
    await db.update(mysteryAuditTemplatesTable).set({ isActive: false, updatedAt: new Date() })
      .where(eq(mysteryAuditTemplatesTable.id, id));
    await recordAuditLog({ req, module: "mystery_audits", action: "template.archive", entity: "audit_template", entityId: id });
    return void res.json({ ok: true, archived: true });
  }
  await db.delete(mysteryAuditTemplatesTable).where(eq(mysteryAuditTemplatesTable.id, id));
  await recordAuditLog({ req, module: "mystery_audits", action: "template.delete", entity: "audit_template", entityId: id, oldValue: tpl });
  res.json({ ok: true });
});

// ---------- Assignments ----------

const AssignmentBody = z.object({
  templateId: z.number().int(),
  restaurantId: z.number().int(),
  auditorUserId: z.number().int(),
  dueDate: z.string().datetime().nullish(),
  notes: z.string().max(2000).nullish(),
});

router.get("/mystery-audits/assignments", requireRole(...AUDITOR_ROLES), async (req, res) => {
  const tid = tenantId(req);
  const restaurantId = req.query.restaurantId ? Number(req.query.restaurantId) : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const conditions = [eq(mysteryAuditAssignmentsTable.tenantId, tid)];
  if (restaurantId) conditions.push(eq(mysteryAuditAssignmentsTable.restaurantId, restaurantId));
  if (status) conditions.push(eq(mysteryAuditAssignmentsTable.status, status as never));
  const rows = await db.select({
    id: mysteryAuditAssignmentsTable.id,
    templateId: mysteryAuditAssignmentsTable.templateId,
    restaurantId: mysteryAuditAssignmentsTable.restaurantId,
    auditorUserId: mysteryAuditAssignmentsTable.auditorUserId,
    status: mysteryAuditAssignmentsTable.status,
    dueDate: mysteryAuditAssignmentsTable.dueDate,
    notes: mysteryAuditAssignmentsTable.notes,
    createdAt: mysteryAuditAssignmentsTable.createdAt,
    templateName: mysteryAuditTemplatesTable.name,
    restaurantName: restaurantsTable.name,
    auditorName: usersTable.name,
  })
    .from(mysteryAuditAssignmentsTable)
    .leftJoin(mysteryAuditTemplatesTable, eq(mysteryAuditTemplatesTable.id, mysteryAuditAssignmentsTable.templateId))
    .leftJoin(restaurantsTable, eq(restaurantsTable.id, mysteryAuditAssignmentsTable.restaurantId))
    .leftJoin(usersTable, eq(usersTable.id, mysteryAuditAssignmentsTable.auditorUserId))
    .where(and(...conditions))
    .orderBy(desc(mysteryAuditAssignmentsTable.createdAt));
  res.json({ data: rows });
});

router.get("/mystery-audits/my-audits", requireRole(...AUDITOR_ROLES), async (req, res) => {
  const uid = req.user!.sub;
  if (!uid) return void res.status(401).json({ error: "Not authenticated" });
  const rows = await db.select({
    id: mysteryAuditAssignmentsTable.id,
    templateId: mysteryAuditAssignmentsTable.templateId,
    restaurantId: mysteryAuditAssignmentsTable.restaurantId,
    status: mysteryAuditAssignmentsTable.status,
    dueDate: mysteryAuditAssignmentsTable.dueDate,
    notes: mysteryAuditAssignmentsTable.notes,
    createdAt: mysteryAuditAssignmentsTable.createdAt,
    templateName: mysteryAuditTemplatesTable.name,
    restaurantName: restaurantsTable.name,
  })
    .from(mysteryAuditAssignmentsTable)
    .leftJoin(mysteryAuditTemplatesTable, eq(mysteryAuditTemplatesTable.id, mysteryAuditAssignmentsTable.templateId))
    .leftJoin(restaurantsTable, eq(restaurantsTable.id, mysteryAuditAssignmentsTable.restaurantId))
    .where(eq(mysteryAuditAssignmentsTable.auditorUserId, uid))
    .orderBy(desc(mysteryAuditAssignmentsTable.createdAt));
  res.json({ data: rows });
});

router.post("/mystery-audits/assignments", requireRole(...MANAGER_ROLES), async (req, res) => {
  const parsed = AssignmentBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  const tid = tenantId(req);
  const tpl = await ensureTemplateInTenant(req, parsed.data.templateId);
  if (!tpl) return void res.status(400).json({ error: "Template not in tenant" });
  const r = await ensureRestaurantInTenant(req, parsed.data.restaurantId);
  if (!r) return void res.status(400).json({ error: "Restaurant not in tenant" });
  const [auditor] = await db.select({ id: usersTable.id, tenantId: usersTable.tenantId, name: usersTable.name })
    .from(usersTable).where(eq(usersTable.id, parsed.data.auditorUserId));
  if (!auditor || (!req.user!.isSuperAdmin && auditor.tenantId !== tid)) {
    return void res.status(400).json({ error: "Auditor not in tenant" });
  }
  const [row] = await db.insert(mysteryAuditAssignmentsTable).values({
    tenantId: tid,
    templateId: parsed.data.templateId,
    restaurantId: parsed.data.restaurantId,
    auditorUserId: parsed.data.auditorUserId,
    dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
    notes: parsed.data.notes ?? null,
    createdBy: req.user!.sub ?? null,
  }).returning();
  await db.insert(notificationsTable).values({
    restaurantId: parsed.data.restaurantId,
    type: "mystery_audit_assigned",
    title: `Mystery audit assigned: ${tpl.name}`,
    message: `You have been assigned a mystery audit for ${r.name}.`,
    entityId: row.id,
    entityType: "mystery_audit_assignment",
  }).catch(() => {});
  await recordAuditLog({ req, module: "mystery_audits", action: "assignment.create", entity: "audit_assignment", entityId: row.id, restaurantId: parsed.data.restaurantId, newValue: parsed.data });
  res.status(201).json({ data: row });
});

router.delete("/mystery-audits/assignments/:id", requireRole(...MANAGER_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const a = await ensureAssignmentAccess(req, id);
  if (!a) return void res.status(404).json({ error: "Not found" });
  if (a.status === "submitted" || a.status === "locked") {
    return void res.status(400).json({ error: "Cannot cancel a submitted/locked audit" });
  }
  await db.update(mysteryAuditAssignmentsTable).set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(mysteryAuditAssignmentsTable.id, id));
  await recordAuditLog({ req, module: "mystery_audits", action: "assignment.cancel", entity: "audit_assignment", entityId: id, restaurantId: a.restaurantId });
  res.json({ ok: true });
});

// ---------- Submission (fill / load draft) ----------

async function loadOrCreateDraftSubmission(assignmentId: number, userId: number, tid: number, templateId: number, restaurantId: number) {
  const [existing] = await db.select().from(mysteryAuditSubmissionsTable)
    .where(and(eq(mysteryAuditSubmissionsTable.assignmentId, assignmentId), eq(mysteryAuditSubmissionsTable.status, "draft")));
  if (existing) return existing;
  const [created] = await db.insert(mysteryAuditSubmissionsTable).values({
    tenantId: tid,
    assignmentId,
    templateId,
    restaurantId,
    auditorUserId: userId,
    status: "draft",
  }).returning();
  return created;
}

router.get("/mystery-audits/assignments/:id/submission", requireRole(...AUDITOR_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const a = await ensureAssignmentAccess(req, id);
  if (!a) return void res.status(404).json({ error: "Not found" });
  // Auditors only see their own; managers/owners can see any in tenant.
  if (a.auditorUserId !== req.user!.sub && !isManager(req)) {
    return void res.status(403).json({ error: "Forbidden" });
  }
  // Latest submission for this assignment (locked > submitted > draft preference).
  const subs = await db.select().from(mysteryAuditSubmissionsTable)
    .where(eq(mysteryAuditSubmissionsTable.assignmentId, id))
    .orderBy(desc(mysteryAuditSubmissionsTable.createdAt));
  let sub = subs[0];
  if (!sub) {
    if (a.auditorUserId !== req.user!.sub) {
      return void res.json({ data: null });
    }
    sub = await loadOrCreateDraftSubmission(id, req.user!.sub!, a.tenantId, a.templateId, a.restaurantId);
  }
  const responses = await db.select().from(mysteryAuditResponsesTable)
    .where(eq(mysteryAuditResponsesTable.submissionId, sub.id));
  res.json({ data: { submission: sub, responses } });
});

const SaveResponsesBody = z.object({
  visitDate: z.string().datetime().nullish(),
  generalNotes: z.string().max(5000).nullish(),
  responses: z.array(z.object({
    itemId: z.number().int(),
    categoryId: z.number().int(),
    score: z.number().int().min(0),
    maxScore: z.number().int().min(1),
    notes: z.string().max(2000).nullish(),
    photos: z.array(z.string()).max(10).optional().default([]),
  })),
});

router.put("/mystery-audits/submissions/:id", requireRole(...AUDITOR_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const [sub] = await db.select().from(mysteryAuditSubmissionsTable).where(eq(mysteryAuditSubmissionsTable.id, id));
  if (!sub) return void res.status(404).json({ error: "Not found" });
  if (!req.user!.isSuperAdmin && sub.tenantId !== req.user!.tenantId) return void res.status(403).json({ error: "Forbidden" });
  if (sub.auditorUserId !== req.user!.sub && !isManager(req)) return void res.status(403).json({ error: "Forbidden" });
  if (sub.status !== "draft") return void res.status(400).json({ error: "Submission is locked" });
  const parsed = SaveResponsesBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  await db.update(mysteryAuditSubmissionsTable).set({
    visitDate: parsed.data.visitDate ? new Date(parsed.data.visitDate) : sub.visitDate,
    generalNotes: parsed.data.generalNotes ?? sub.generalNotes,
    updatedAt: new Date(),
  }).where(eq(mysteryAuditSubmissionsTable.id, id));
  // Replace responses wholesale.
  await db.delete(mysteryAuditResponsesTable).where(eq(mysteryAuditResponsesTable.submissionId, id));
  if (parsed.data.responses.length) {
    await db.insert(mysteryAuditResponsesTable).values(parsed.data.responses.map(r => ({
      submissionId: id,
      itemId: r.itemId,
      categoryId: r.categoryId,
      score: r.score,
      maxScore: r.maxScore,
      notes: r.notes ?? null,
      photos: r.photos ?? [],
    })));
  }
  // Mark assignment in-progress.
  if (parsed.data.responses.some(r => r.score > 0 || (r.notes ?? "").length > 0)) {
    await db.update(mysteryAuditAssignmentsTable).set({ status: "in_progress", updatedAt: new Date() })
      .where(and(eq(mysteryAuditAssignmentsTable.id, sub.assignmentId), eq(mysteryAuditAssignmentsTable.status, "pending")));
  }
  res.json({ ok: true });
});

async function computeAndPersistTotals(submissionId: number) {
  const [sub] = await db.select().from(mysteryAuditSubmissionsTable).where(eq(mysteryAuditSubmissionsTable.id, submissionId));
  if (!sub) return null;
  const cats = await db.select().from(mysteryAuditCategoriesTable).where(eq(mysteryAuditCategoriesTable.templateId, sub.templateId)).orderBy(asc(mysteryAuditCategoriesTable.sortOrder));
  const responses = await db.select().from(mysteryAuditResponsesTable).where(eq(mysteryAuditResponsesTable.submissionId, submissionId));
  const items = cats.length === 0 ? [] : await db.select().from(mysteryAuditItemsTable).where(inArray(mysteryAuditItemsTable.categoryId, cats.map(c => c.id)));

  const categoryScores: Array<{ categoryId: number; name: string; weight: number; score: number; maxScore: number; percent: number }> = [];
  let totalWeighted = 0;
  let totalWeight = 0;
  let totalScore = 0;
  let totalMax = 0;
  for (const c of cats) {
    const cItems = items.filter(i => i.categoryId === c.id);
    const cMax = cItems.reduce((s, i) => s + (i.maxScore ?? 0), 0);
    const cScore = responses.filter(r => r.categoryId === c.id).reduce((s, r) => s + (r.score ?? 0), 0);
    const percent = cMax > 0 ? (cScore / cMax) * 100 : 0;
    const w = Number(c.weight ?? 1);
    categoryScores.push({ categoryId: c.id, name: c.name, weight: w, score: cScore, maxScore: cMax, percent });
    totalWeighted += percent * w;
    totalWeight += w;
    totalScore += cScore;
    totalMax += cMax;
  }
  const weightedPercent = totalWeight > 0 ? totalWeighted / totalWeight : 0;
  await db.update(mysteryAuditSubmissionsTable).set({
    categoryScores,
    totalScore: totalScore.toFixed(2),
    totalMaxScore: totalMax.toFixed(2),
    weightedPercent: weightedPercent.toFixed(2),
    updatedAt: new Date(),
  }).where(eq(mysteryAuditSubmissionsTable.id, submissionId));
  return { sub, categoryScores, totalScore, totalMax, weightedPercent };
}

router.post("/mystery-audits/submissions/:id/submit", requireRole(...AUDITOR_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const [sub] = await db.select().from(mysteryAuditSubmissionsTable).where(eq(mysteryAuditSubmissionsTable.id, id));
  if (!sub) return void res.status(404).json({ error: "Not found" });
  if (!req.user!.isSuperAdmin && sub.tenantId !== req.user!.tenantId) return void res.status(403).json({ error: "Forbidden" });
  if (sub.auditorUserId !== req.user!.sub && !isManager(req)) return void res.status(403).json({ error: "Forbidden" });
  if (sub.status !== "draft") return void res.status(400).json({ error: "Already submitted" });

  const computed = await computeAndPersistTotals(id);
  if (!computed) return void res.status(500).json({ error: "Compute failed" });

  // Generate PDF
  const [tpl] = await db.select().from(mysteryAuditTemplatesTable).where(eq(mysteryAuditTemplatesTable.id, sub.templateId));
  const [r] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, sub.restaurantId));
  const [auditor] = await db.select().from(usersTable).where(eq(usersTable.id, sub.auditorUserId));
  const cats = await db.select().from(mysteryAuditCategoriesTable).where(eq(mysteryAuditCategoriesTable.templateId, sub.templateId)).orderBy(asc(mysteryAuditCategoriesTable.sortOrder));
  const items = cats.length === 0 ? [] : await db.select().from(mysteryAuditItemsTable).where(inArray(mysteryAuditItemsTable.categoryId, cats.map(c => c.id)));
  const responses = await db.select().from(mysteryAuditResponsesTable).where(eq(mysteryAuditResponsesTable.submissionId, id));

  const responseRows = responses
    .map(rsp => {
      const item = items.find(i => i.id === rsp.itemId);
      const cat = cats.find(c => c.id === rsp.categoryId);
      return {
        categoryName: cat?.name ?? "—",
        catSort: cat?.sortOrder ?? 999,
        itemLabel: item?.label ?? "—",
        itemSort: item?.sortOrder ?? 999,
        score: rsp.score,
        maxScore: rsp.maxScore,
        notes: rsp.notes,
        photoCount: (rsp.photos ?? []).length,
      };
    })
    .sort((a, b) => a.catSort - b.catSort || a.itemSort - b.itemSort);

  const submittedAt = new Date();
  const pdfBuf = await buildMysteryAuditPdfBuffer({
    templateName: tpl?.name ?? "Audit",
    restaurantName: r?.name ?? "Outlet",
    auditorName: auditor?.name ?? "Auditor",
    visitDate: sub.visitDate,
    submittedAt,
    totalScore: computed.totalScore,
    totalMaxScore: computed.totalMax,
    weightedPercent: computed.weightedPercent,
    generalNotes: sub.generalNotes,
    categoryScores: computed.categoryScores,
    responses: responseRows,
    correctiveActions: [],
  });

  let pdfPath: string | null = null;
  try {
    pdfPath = await uploadMysteryAuditPdf(pdfBuf, sub.restaurantId, req.user!.sub ?? null);
  } catch (err) {
    req.log.warn({ err }, "Mystery audit PDF upload failed; continuing without PDF");
  }

  await db.update(mysteryAuditSubmissionsTable).set({
    status: "locked",
    submittedAt,
    lockedAt: submittedAt,
    pdfObjectPath: pdfPath,
    updatedAt: submittedAt,
  }).where(eq(mysteryAuditSubmissionsTable.id, id));
  await db.update(mysteryAuditAssignmentsTable).set({ status: "locked", updatedAt: submittedAt })
    .where(eq(mysteryAuditAssignmentsTable.id, sub.assignmentId));

  await db.insert(notificationsTable).values({
    restaurantId: sub.restaurantId,
    type: "mystery_audit_submitted",
    title: `Mystery audit submitted: ${tpl?.name ?? "Audit"}`,
    message: `Score: ${computed.weightedPercent.toFixed(1)}% (${r?.name ?? "outlet"}).`,
    entityId: id,
    entityType: "mystery_audit_submission",
  }).catch(() => {});

  await recordAuditLog({
    req, module: "mystery_audits", action: "submission.lock",
    entity: "audit_submission", entityId: id, restaurantId: sub.restaurantId,
    newValue: { weightedPercent: computed.weightedPercent, totalScore: computed.totalScore, totalMaxScore: computed.totalMax },
  });
  res.json({ ok: true, pdfObjectPath: pdfPath, weightedPercent: computed.weightedPercent });
});

router.post("/mystery-audits/submissions/:id/regenerate-pdf", requireRole(...MANAGER_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const [sub] = await db.select().from(mysteryAuditSubmissionsTable).where(eq(mysteryAuditSubmissionsTable.id, id));
  if (!sub) return void res.status(404).json({ error: "Not found" });
  if (!req.user!.isSuperAdmin && sub.tenantId !== req.user!.tenantId) return void res.status(403).json({ error: "Forbidden" });
  const [tpl] = await db.select().from(mysteryAuditTemplatesTable).where(eq(mysteryAuditTemplatesTable.id, sub.templateId));
  const [r] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, sub.restaurantId));
  const [auditor] = await db.select().from(usersTable).where(eq(usersTable.id, sub.auditorUserId));
  const cats = await db.select().from(mysteryAuditCategoriesTable).where(eq(mysteryAuditCategoriesTable.templateId, sub.templateId)).orderBy(asc(mysteryAuditCategoriesTable.sortOrder));
  const items = cats.length === 0 ? [] : await db.select().from(mysteryAuditItemsTable).where(inArray(mysteryAuditItemsTable.categoryId, cats.map(c => c.id)));
  const responses = await db.select().from(mysteryAuditResponsesTable).where(eq(mysteryAuditResponsesTable.submissionId, id));
  const actions = await db.select().from(mysteryAuditCorrectiveActionsTable).where(eq(mysteryAuditCorrectiveActionsTable.submissionId, id));

  const responseRows = responses
    .map(rsp => {
      const item = items.find(i => i.id === rsp.itemId);
      const cat = cats.find(c => c.id === rsp.categoryId);
      return {
        categoryName: cat?.name ?? "—",
        catSort: cat?.sortOrder ?? 999,
        itemLabel: item?.label ?? "—",
        itemSort: item?.sortOrder ?? 999,
        score: rsp.score,
        maxScore: rsp.maxScore,
        notes: rsp.notes,
        photoCount: (rsp.photos ?? []).length,
      };
    })
    .sort((a, b) => a.catSort - b.catSort || a.itemSort - b.itemSort);

  const pdf = await buildMysteryAuditPdfBuffer({
    templateName: tpl?.name ?? "Audit",
    restaurantName: r?.name ?? "Outlet",
    auditorName: auditor?.name ?? "Auditor",
    visitDate: sub.visitDate,
    submittedAt: sub.submittedAt,
    totalScore: Number(sub.totalScore),
    totalMaxScore: Number(sub.totalMaxScore),
    weightedPercent: Number(sub.weightedPercent),
    generalNotes: sub.generalNotes,
    categoryScores: (sub.categoryScores ?? []).map(c => ({ name: c.name, weight: c.weight, score: c.score, maxScore: c.maxScore, percent: c.percent })),
    responses: responseRows,
    correctiveActions: actions.map(a => ({ description: a.description, priority: a.priority, status: a.status, dueDate: a.dueDate })),
  });
  const pdfPath = await uploadMysteryAuditPdf(pdf, sub.restaurantId, req.user!.sub ?? null);
  await db.update(mysteryAuditSubmissionsTable).set({ pdfObjectPath: pdfPath, updatedAt: new Date() }).where(eq(mysteryAuditSubmissionsTable.id, id));
  await recordAuditLog({ req, module: "mystery_audits", action: "submission.pdf_regenerate", entity: "audit_submission", entityId: id, restaurantId: sub.restaurantId });
  res.json({ ok: true, pdfObjectPath: pdfPath });
});

// ---------- Submission detail ----------

router.get("/mystery-audits/submissions/:id", requireRole(...AUDITOR_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const [sub] = await db.select().from(mysteryAuditSubmissionsTable).where(eq(mysteryAuditSubmissionsTable.id, id));
  if (!sub) return void res.status(404).json({ error: "Not found" });
  if (!req.user!.isSuperAdmin && sub.tenantId !== req.user!.tenantId) return void res.status(403).json({ error: "Forbidden" });
  if (sub.auditorUserId !== req.user!.sub && !isManager(req)) return void res.status(403).json({ error: "Forbidden" });
  const responses = await db.select().from(mysteryAuditResponsesTable).where(eq(mysteryAuditResponsesTable.submissionId, id));
  const [tpl] = await db.select().from(mysteryAuditTemplatesTable).where(eq(mysteryAuditTemplatesTable.id, sub.templateId));
  const [r] = await db.select({ name: restaurantsTable.name }).from(restaurantsTable).where(eq(restaurantsTable.id, sub.restaurantId));
  const [auditor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, sub.auditorUserId));
  const actions = await db.select().from(mysteryAuditCorrectiveActionsTable).where(eq(mysteryAuditCorrectiveActionsTable.submissionId, id));
  res.json({ data: { submission: sub, responses, template: tpl, restaurantName: r?.name ?? null, auditorName: auditor?.name ?? null, correctiveActions: actions } });
});

// ---------- History (per outlet) ----------

router.get("/mystery-audits/history", requireRole(...AUDITOR_ROLES), async (req, res) => {
  const tid = tenantId(req);
  const restaurantId = req.query.restaurantId ? Number(req.query.restaurantId) : undefined;
  const conds = [eq(mysteryAuditSubmissionsTable.tenantId, tid), eq(mysteryAuditSubmissionsTable.status, "locked")];
  if (restaurantId) conds.push(eq(mysteryAuditSubmissionsTable.restaurantId, restaurantId));
  const rows = await db.select({
    id: mysteryAuditSubmissionsTable.id,
    restaurantId: mysteryAuditSubmissionsTable.restaurantId,
    templateId: mysteryAuditSubmissionsTable.templateId,
    visitDate: mysteryAuditSubmissionsTable.visitDate,
    submittedAt: mysteryAuditSubmissionsTable.submittedAt,
    weightedPercent: mysteryAuditSubmissionsTable.weightedPercent,
    totalScore: mysteryAuditSubmissionsTable.totalScore,
    totalMaxScore: mysteryAuditSubmissionsTable.totalMaxScore,
    pdfObjectPath: mysteryAuditSubmissionsTable.pdfObjectPath,
    templateName: mysteryAuditTemplatesTable.name,
    restaurantName: restaurantsTable.name,
    auditorName: usersTable.name,
  })
    .from(mysteryAuditSubmissionsTable)
    .leftJoin(mysteryAuditTemplatesTable, eq(mysteryAuditTemplatesTable.id, mysteryAuditSubmissionsTable.templateId))
    .leftJoin(restaurantsTable, eq(restaurantsTable.id, mysteryAuditSubmissionsTable.restaurantId))
    .leftJoin(usersTable, eq(usersTable.id, mysteryAuditSubmissionsTable.auditorUserId))
    .where(and(...conds))
    .orderBy(desc(mysteryAuditSubmissionsTable.submittedAt));
  res.json({ data: rows });
});

// CSV export (chain-wide locked submissions with optional filters).
router.get("/mystery-audits/export.csv", requireRole(...MANAGER_ROLES), async (req, res) => {
  const tid = tenantId(req);
  const conds = [eq(mysteryAuditSubmissionsTable.tenantId, tid), eq(mysteryAuditSubmissionsTable.status, "locked")];
  const restaurantId = req.query.restaurantId ? Number(req.query.restaurantId) : undefined;
  if (restaurantId) conds.push(eq(mysteryAuditSubmissionsTable.restaurantId, restaurantId));
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
  if (from && !isNaN(from.getTime())) conds.push(gte(mysteryAuditSubmissionsTable.submittedAt, from));
  if (to && !isNaN(to.getTime())) conds.push(lte(mysteryAuditSubmissionsTable.submittedAt, to));
  const rows = await db.select({
    id: mysteryAuditSubmissionsTable.id,
    submittedAt: mysteryAuditSubmissionsTable.submittedAt,
    visitDate: mysteryAuditSubmissionsTable.visitDate,
    templateName: mysteryAuditTemplatesTable.name,
    restaurantName: restaurantsTable.name,
    auditorName: usersTable.name,
    weightedPercent: mysteryAuditSubmissionsTable.weightedPercent,
    totalScore: mysteryAuditSubmissionsTable.totalScore,
    totalMaxScore: mysteryAuditSubmissionsTable.totalMaxScore,
  })
    .from(mysteryAuditSubmissionsTable)
    .leftJoin(mysteryAuditTemplatesTable, eq(mysteryAuditTemplatesTable.id, mysteryAuditSubmissionsTable.templateId))
    .leftJoin(restaurantsTable, eq(restaurantsTable.id, mysteryAuditSubmissionsTable.restaurantId))
    .leftJoin(usersTable, eq(usersTable.id, mysteryAuditSubmissionsTable.auditorUserId))
    .where(and(...conds))
    .orderBy(desc(mysteryAuditSubmissionsTable.submittedAt));
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["id", "submitted_at", "visit_date", "template", "outlet", "auditor", "weighted_percent", "score", "max_score"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      r.id,
      r.submittedAt ? new Date(r.submittedAt).toISOString() : "",
      r.visitDate ? new Date(r.visitDate).toISOString() : "",
      r.templateName ?? "",
      r.restaurantName ?? "",
      r.auditorName ?? "",
      r.weightedPercent,
      r.totalScore,
      r.totalMaxScore,
    ].map(esc).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="mystery-audits-${Date.now()}.csv"`);
  res.send(lines.join("\n"));
});

// ---------- Corrective Actions ----------

const ActionBody = z.object({
  submissionId: z.number().int(),
  responseId: z.number().int().nullish(),
  description: z.string().min(1).max(2000),
  priority: z.enum(["low", "medium", "high"]).optional().default("medium"),
  assignedTo: z.number().int().nullish(),
  dueDate: z.string().datetime().nullish(),
  itemLabel: z.string().max(200).nullish(),
  categoryName: z.string().max(120).nullish(),
});

router.get("/mystery-audits/corrective-actions", requireRole(...AUDITOR_ROLES), async (req, res) => {
  const tid = tenantId(req);
  const restaurantId = req.query.restaurantId ? Number(req.query.restaurantId) : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const conds = [eq(mysteryAuditCorrectiveActionsTable.tenantId, tid)];
  if (restaurantId) conds.push(eq(mysteryAuditCorrectiveActionsTable.restaurantId, restaurantId));
  if (status) conds.push(eq(mysteryAuditCorrectiveActionsTable.status, status as never));
  const rows = await db.select({
    id: mysteryAuditCorrectiveActionsTable.id,
    submissionId: mysteryAuditCorrectiveActionsTable.submissionId,
    restaurantId: mysteryAuditCorrectiveActionsTable.restaurantId,
    description: mysteryAuditCorrectiveActionsTable.description,
    priority: mysteryAuditCorrectiveActionsTable.priority,
    status: mysteryAuditCorrectiveActionsTable.status,
    assignedTo: mysteryAuditCorrectiveActionsTable.assignedTo,
    dueDate: mysteryAuditCorrectiveActionsTable.dueDate,
    resolvedAt: mysteryAuditCorrectiveActionsTable.resolvedAt,
    resolutionNote: mysteryAuditCorrectiveActionsTable.resolutionNote,
    itemLabel: mysteryAuditCorrectiveActionsTable.itemLabel,
    categoryName: mysteryAuditCorrectiveActionsTable.categoryName,
    createdAt: mysteryAuditCorrectiveActionsTable.createdAt,
    restaurantName: restaurantsTable.name,
    assignedToName: usersTable.name,
  })
    .from(mysteryAuditCorrectiveActionsTable)
    .leftJoin(restaurantsTable, eq(restaurantsTable.id, mysteryAuditCorrectiveActionsTable.restaurantId))
    .leftJoin(usersTable, eq(usersTable.id, mysteryAuditCorrectiveActionsTable.assignedTo))
    .where(and(...conds))
    .orderBy(desc(mysteryAuditCorrectiveActionsTable.createdAt));
  res.json({ data: rows });
});

router.post("/mystery-audits/corrective-actions", requireRole(...MANAGER_ROLES), async (req, res) => {
  const parsed = ActionBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  const tid = tenantId(req);
  const [sub] = await db.select().from(mysteryAuditSubmissionsTable).where(eq(mysteryAuditSubmissionsTable.id, parsed.data.submissionId));
  if (!sub || (!req.user!.isSuperAdmin && sub.tenantId !== tid)) return void res.status(404).json({ error: "Submission not found" });
  const [row] = await db.insert(mysteryAuditCorrectiveActionsTable).values({
    tenantId: tid,
    submissionId: parsed.data.submissionId,
    restaurantId: sub.restaurantId,
    responseId: parsed.data.responseId ?? null,
    itemLabel: parsed.data.itemLabel ?? null,
    categoryName: parsed.data.categoryName ?? null,
    description: parsed.data.description,
    priority: parsed.data.priority,
    assignedTo: parsed.data.assignedTo ?? null,
    dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
    createdBy: req.user!.sub ?? null,
  }).returning();
  if (parsed.data.assignedTo) {
    await db.insert(notificationsTable).values({
      restaurantId: sub.restaurantId,
      type: "mystery_audit_action_assigned",
      title: "Corrective action assigned",
      message: parsed.data.description.slice(0, 200),
      entityId: row.id,
      entityType: "mystery_audit_corrective_action",
    }).catch(() => {});
  }
  await recordAuditLog({ req, module: "mystery_audits", action: "action.create", entity: "audit_corrective_action", entityId: row.id, restaurantId: sub.restaurantId, newValue: parsed.data });
  res.status(201).json({ data: row });
});

const ActionPatchBody = z.object({
  status: z.enum(["open", "in_progress", "resolved"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  assignedTo: z.number().int().nullish(),
  dueDate: z.string().datetime().nullish(),
  resolutionNote: z.string().max(2000).nullish(),
  description: z.string().min(1).max(2000).optional(),
});

router.patch("/mystery-audits/corrective-actions/:id", requireRole(...MANAGER_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const [a] = await db.select().from(mysteryAuditCorrectiveActionsTable).where(eq(mysteryAuditCorrectiveActionsTable.id, id));
  if (!a) return void res.status(404).json({ error: "Not found" });
  if (!req.user!.isSuperAdmin && a.tenantId !== req.user!.tenantId) return void res.status(403).json({ error: "Forbidden" });
  const parsed = ActionPatchBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  const updates: Partial<typeof mysteryAuditCorrectiveActionsTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.status !== undefined) {
    updates.status = parsed.data.status;
    if (parsed.data.status === "resolved") {
      updates.resolvedAt = new Date();
      updates.resolvedBy = req.user!.sub ?? null;
    } else {
      updates.resolvedAt = null;
      updates.resolvedBy = null;
    }
  }
  if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
  if (parsed.data.assignedTo !== undefined) updates.assignedTo = parsed.data.assignedTo;
  if (parsed.data.dueDate !== undefined) updates.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
  if (parsed.data.resolutionNote !== undefined) updates.resolutionNote = parsed.data.resolutionNote;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  await db.update(mysteryAuditCorrectiveActionsTable).set(updates).where(eq(mysteryAuditCorrectiveActionsTable.id, id));
  await recordAuditLog({ req, module: "mystery_audits", action: "action.update", entity: "audit_corrective_action", entityId: id, restaurantId: a.restaurantId, oldValue: a, newValue: parsed.data });
  res.json({ ok: true });
});

router.delete("/mystery-audits/corrective-actions/:id", requireRole(...MANAGER_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const [a] = await db.select().from(mysteryAuditCorrectiveActionsTable).where(eq(mysteryAuditCorrectiveActionsTable.id, id));
  if (!a) return void res.status(404).json({ error: "Not found" });
  if (!req.user!.isSuperAdmin && a.tenantId !== req.user!.tenantId) return void res.status(403).json({ error: "Forbidden" });
  await db.delete(mysteryAuditCorrectiveActionsTable).where(eq(mysteryAuditCorrectiveActionsTable.id, id));
  await recordAuditLog({ req, module: "mystery_audits", action: "action.delete", entity: "audit_corrective_action", entityId: id, restaurantId: a.restaurantId, oldValue: a });
  res.json({ ok: true });
});

// ---------- Helper endpoints (auditor candidates / outlets) ----------

router.get("/mystery-audits/auditors", requireRole(...MANAGER_ROLES), async (req, res) => {
  const tid = tenantId(req);
  const rows = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role })
    .from(usersTable)
    .where(and(
      eq(usersTable.tenantId, tid),
      eq(usersTable.isActive, true),
      inArray(usersTable.role, ["owner", "manager", "auditor"]),
    ))
    .orderBy(asc(usersTable.name));
  res.json({ data: rows });
});

export default router;
