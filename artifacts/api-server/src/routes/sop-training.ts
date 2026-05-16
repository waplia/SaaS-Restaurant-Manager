import { Router } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  sopsTable,
  sopChecklistItemsTable,
  sopChecklistRunsTable,
  trainingCoursesTable,
  trainingModulesTable,
  trainingQuizQuestionsTable,
  trainingAssignmentsTable,
  trainingAttemptsTable,
  trainingApprovalsTable,
  trainingCertificatesTable,
  notificationsTable,
  usersTable,
  tenantsTable,
  subscriptionPlansTable,
  isFeatureEnabled,
  SOP_CATEGORIES,
  SOP_CHECKLIST_CATEGORIES,
  STAFF_ROLES_FOR_TRAINING,
  type SopCategory,
  type StaffRoleForTraining,
  type Sop,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { sendEmail } from "../lib/notifications";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../lib/objectStorage";
import { sanitizeStoredUpload, UploadValidationError } from "../lib/uploadSanitizer";
import { setObjectAclPolicy } from "../lib/objectAcl";

const router = Router();
const objectStorage = new ObjectStorageService();

const STAFF_VIEW_ROLES = ["owner", "manager", "cashier", "waiter", "kitchen", "delivery_executive", "super_admin"];
const AUTHOR_ROLES = ["owner", "manager", "super_admin"];

function isCategory(s: unknown): s is SopCategory {
  return typeof s === "string" && (SOP_CATEGORIES as readonly string[]).includes(s);
}
function isStaffRole(s: unknown): s is StaffRoleForTraining {
  return typeof s === "string" && (STAFF_ROLES_FOR_TRAINING as readonly string[]).includes(s);
}
function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function ensurePlanFlag(tenantId: number | null | undefined): Promise<boolean> {
  if (!tenantId) return false;
  const [row] = await db
    .select({ flags: subscriptionPlansTable.featureFlags })
    .from(tenantsTable)
    .leftJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, tenantsTable.planId))
    .where(eq(tenantsTable.id, tenantId));
  return isFeatureEnabled((row?.flags ?? null) as Record<string, unknown> | null, "sop_training");
}

function gatePlanFlag(allowSuperAdmin = true) {
  return async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (allowSuperAdmin && req.user?.isSuperAdmin) return next();
    const ok = await ensurePlanFlag(req.user?.tenantId ?? null);
    if (!ok) {
      res.status(403).json({ error: "The SOP & Training module is not enabled on your current plan." });
      return;
    }
    next();
  };
}

const planFlagGate = gatePlanFlag();

// ───────────────────────────────────────────────────────────
// SOPs
// ───────────────────────────────────────────────────────────
router.get("/sop-training/sops", requireRole(...STAFF_VIEW_ROLES), planFlagGate, async (req, res) => {
  const tenantId = req.user!.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant scope" });
  const role = req.user!.role as StaffRoleForTraining;
  const isAuthor = req.user!.isSuperAdmin || ["owner", "manager"].includes(req.user!.role);
  const conds = [eq(sopsTable.tenantId, tenantId)];
  if (!isAuthor) {
    conds.push(eq(sopsTable.isPublished, true));
  }
  const rows = await db.select().from(sopsTable).where(and(...conds)).orderBy(desc(sopsTable.updatedAt));
  const filtered = isAuthor ? rows : rows.filter(r => r.visibleRoles.length === 0 || r.visibleRoles.includes(role));
  // Attach checklist items
  const ids = filtered.map(r => r.id);
  const items = ids.length
    ? await db.select().from(sopChecklistItemsTable).where(inArray(sopChecklistItemsTable.sopId, ids)).orderBy(sopChecklistItemsTable.sortOrder)
    : [];
  const byId = new Map<number, typeof items>();
  for (const it of items) {
    const arr = byId.get(it.sopId) ?? [];
    arr.push(it);
    byId.set(it.sopId, arr);
  }
  res.json({ data: filtered.map(s => ({ ...s, checklist: byId.get(s.id) ?? [] })) });
});

router.get("/sop-training/sops/:id", requireRole(...STAFF_VIEW_ROLES), planFlagGate, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [sop] = await db.select().from(sopsTable).where(eq(sopsTable.id, id));
  if (!sop || (sop.tenantId !== req.user!.tenantId && !req.user!.isSuperAdmin)) {
    return void res.status(404).json({ error: "Not found" });
  }
  const checklist = await db.select().from(sopChecklistItemsTable).where(eq(sopChecklistItemsTable.sopId, id)).orderBy(sopChecklistItemsTable.sortOrder);
  res.json({ ...sop, checklist });
});

router.post("/sop-training/sops", requireRole(...AUTHOR_ROLES), planFlagGate, async (req, res) => {
  const tenantId = req.user!.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant scope" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = String(body.title ?? "").trim();
  if (!title) return void res.status(400).json({ error: "title is required" });
  const category = isCategory(body.category) ? body.category : "other";
  const visibleRoles = Array.isArray(body.visibleRoles) ? body.visibleRoles.filter(isStaffRole) : [];
  const checklistInput = Array.isArray(body.checklist) ? body.checklist as Array<{ label: string; isRequired?: boolean }> : [];

  const [sop] = await db.insert(sopsTable).values({
    tenantId,
    restaurantId: req.user!.restaurantId ?? null,
    title,
    category,
    content: typeof body.content === "string" ? body.content : "",
    attachments: Array.isArray(body.attachments) ? body.attachments as Sop["attachments"] : [],
    visibleRoles,
    isPublished: Boolean(body.isPublished),
    publishedAt: body.isPublished ? new Date() : null,
    createdBy: req.user!.sub ?? null,
  }).returning();

  if (checklistInput.length && SOP_CHECKLIST_CATEGORIES.includes(category)) {
    await db.insert(sopChecklistItemsTable).values(checklistInput.map((it, idx) => ({
      sopId: sop.id,
      label: String(it.label ?? "").slice(0, 500),
      isRequired: it.isRequired !== false,
      sortOrder: idx,
    })).filter(it => it.label));
  }
  res.status(201).json(sop);
});

router.patch("/sop-training/sops/:id", requireRole(...AUTHOR_ROLES), planFlagGate, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(sopsTable).where(eq(sopsTable.id, id));
  if (!existing || existing.tenantId !== req.user!.tenantId) return void res.status(404).json({ error: "Not found" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.title === "string") patch.title = body.title.trim();
  if (isCategory(body.category)) patch.category = body.category;
  if (typeof body.content === "string") patch.content = body.content;
  if (Array.isArray(body.attachments)) patch.attachments = body.attachments;
  if (Array.isArray(body.visibleRoles)) patch.visibleRoles = body.visibleRoles.filter(isStaffRole);
  if (body.isPublished !== undefined) {
    const wasPublished = existing.isPublished;
    patch.isPublished = Boolean(body.isPublished);
    if (!wasPublished && body.isPublished) {
      patch.publishedAt = new Date();
      patch.version = existing.version + 1;
    }
  }
  const [updated] = await db.update(sopsTable).set(patch).where(eq(sopsTable.id, id)).returning();

  if (Array.isArray(body.checklist)) {
    await db.delete(sopChecklistItemsTable).where(eq(sopChecklistItemsTable.sopId, id));
    const items = (body.checklist as Array<{ label: string; isRequired?: boolean }>)
      .map((it, idx) => ({ sopId: id, label: String(it.label ?? "").slice(0, 500), isRequired: it.isRequired !== false, sortOrder: idx }))
      .filter(it => it.label);
    if (items.length) await db.insert(sopChecklistItemsTable).values(items);
  }

  res.json(updated);
});

router.delete("/sop-training/sops/:id", requireRole(...AUTHOR_ROLES), planFlagGate, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(sopsTable).where(eq(sopsTable.id, id));
  if (!existing || existing.tenantId !== req.user!.tenantId) return void res.status(404).json({ error: "Not found" });
  await db.delete(sopsTable).where(eq(sopsTable.id, id));
  res.json({ ok: true });
});

// Checklist runs (any staff can submit a completion)
router.post("/sop-training/sops/:id/checklist-runs", requireRole(...STAFF_VIEW_ROLES), planFlagGate, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [sop] = await db.select().from(sopsTable).where(eq(sopsTable.id, id));
  if (!sop || sop.tenantId !== req.user!.tenantId) return void res.status(404).json({ error: "Not found" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const [run] = await db.insert(sopChecklistRunsTable).values({
    sopId: id,
    tenantId: sop.tenantId,
    performedBy: req.user!.sub ?? null,
    performedByName: req.user!.name ?? null,
    results: (body.results as Record<string, { checked: boolean; note?: string }>) ?? {},
    notes: typeof body.notes === "string" ? body.notes : null,
  }).returning();
  res.status(201).json(run);
});

router.get("/sop-training/sops/:id/checklist-runs", requireRole(...AUTHOR_ROLES), planFlagGate, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const rows = await db.select({
    id: sopChecklistRunsTable.id,
    sopId: sopChecklistRunsTable.sopId,
    performedBy: sopChecklistRunsTable.performedBy,
    performedByName: sopChecklistRunsTable.performedByName,
    results: sopChecklistRunsTable.results,
    notes: sopChecklistRunsTable.notes,
    createdAt: sopChecklistRunsTable.createdAt,
    userName: usersTable.name,
  }).from(sopChecklistRunsTable)
    .leftJoin(usersTable, eq(usersTable.id, sopChecklistRunsTable.performedBy))
    .where(eq(sopChecklistRunsTable.sopId, id))
    .orderBy(desc(sopChecklistRunsTable.createdAt))
    .limit(200);
  res.json({ data: rows });
});

// ───────────────────────────────────────────────────────────
// Courses
// ───────────────────────────────────────────────────────────
async function loadCourseEnvelope(courseId: number) {
  const [modules, questions] = await Promise.all([
    db.select().from(trainingModulesTable).where(eq(trainingModulesTable.courseId, courseId)).orderBy(trainingModulesTable.sortOrder),
    db.select().from(trainingQuizQuestionsTable).where(eq(trainingQuizQuestionsTable.courseId, courseId)).orderBy(trainingQuizQuestionsTable.sortOrder),
  ]);
  return { modules, questions };
}

router.get("/sop-training/courses", requireRole(...STAFF_VIEW_ROLES), planFlagGate, async (req, res) => {
  const tenantId = req.user!.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant scope" });
  const isAuthor = req.user!.isSuperAdmin || ["owner", "manager"].includes(req.user!.role);
  const role = req.user!.role as StaffRoleForTraining;
  const conds = [eq(trainingCoursesTable.tenantId, tenantId)];
  if (!isAuthor) conds.push(eq(trainingCoursesTable.isPublished, true));
  const rows = await db.select().from(trainingCoursesTable).where(and(...conds)).orderBy(desc(trainingCoursesTable.updatedAt));
  const filtered = isAuthor ? rows : rows.filter(c => c.requiredRoles.length === 0 || c.requiredRoles.includes(role));
  res.json({ data: filtered });
});

router.get("/sop-training/courses/:id", requireRole(...STAFF_VIEW_ROLES), planFlagGate, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [course] = await db.select().from(trainingCoursesTable).where(eq(trainingCoursesTable.id, id));
  if (!course || (course.tenantId !== req.user!.tenantId && !req.user!.isSuperAdmin)) return void res.status(404).json({ error: "Not found" });
  const env = await loadCourseEnvelope(id);
  const isAuthor = req.user!.isSuperAdmin || ["owner", "manager"].includes(req.user!.role);
  // Hide correctIndex for non-authors
  const questions = isAuthor ? env.questions : env.questions.map(q => ({ ...q, correctIndex: -1 }));
  res.json({ course, modules: env.modules, questions });
});

router.post("/sop-training/courses", requireRole(...AUTHOR_ROLES), planFlagGate, async (req, res) => {
  const tenantId = req.user!.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant scope" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = String(body.title ?? "").trim();
  if (!title) return void res.status(400).json({ error: "title is required" });
  const [course] = await db.insert(trainingCoursesTable).values({
    tenantId,
    title,
    description: typeof body.description === "string" ? body.description : "",
    requiredRoles: Array.isArray(body.requiredRoles) ? body.requiredRoles.filter(isStaffRole) : [],
    isPublished: Boolean(body.isPublished),
    isOnboarding: Boolean(body.isOnboarding),
    expiryMonths: body.expiryMonths == null || body.expiryMonths === "" ? null : Math.max(1, Number(body.expiryMonths) | 0),
    requiresApproval: Boolean(body.requiresApproval),
    passMarkPercent: Math.max(1, Math.min(100, Number(body.passMarkPercent) || 70)),
    createdBy: req.user!.sub ?? null,
  }).returning();
  res.status(201).json(course);
});

router.patch("/sop-training/courses/:id", requireRole(...AUTHOR_ROLES), planFlagGate, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(trainingCoursesTable).where(eq(trainingCoursesTable.id, id));
  if (!existing || existing.tenantId !== req.user!.tenantId) return void res.status(404).json({ error: "Not found" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.title === "string") patch.title = body.title.trim();
  if (typeof body.description === "string") patch.description = body.description;
  if (Array.isArray(body.requiredRoles)) patch.requiredRoles = body.requiredRoles.filter(isStaffRole);
  if (body.isPublished !== undefined) patch.isPublished = Boolean(body.isPublished);
  if (body.isOnboarding !== undefined) patch.isOnboarding = Boolean(body.isOnboarding);
  if (body.expiryMonths !== undefined) patch.expiryMonths = body.expiryMonths == null || body.expiryMonths === "" ? null : Math.max(1, Number(body.expiryMonths) | 0);
  if (body.requiresApproval !== undefined) patch.requiresApproval = Boolean(body.requiresApproval);
  if (body.passMarkPercent !== undefined) patch.passMarkPercent = Math.max(1, Math.min(100, Number(body.passMarkPercent) || 70));
  const [updated] = await db.update(trainingCoursesTable).set(patch).where(eq(trainingCoursesTable.id, id)).returning();
  res.json(updated);
});

router.delete("/sop-training/courses/:id", requireRole(...AUTHOR_ROLES), planFlagGate, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(trainingCoursesTable).where(eq(trainingCoursesTable.id, id));
  if (!existing || existing.tenantId !== req.user!.tenantId) return void res.status(404).json({ error: "Not found" });
  await db.delete(trainingCoursesTable).where(eq(trainingCoursesTable.id, id));
  res.json({ ok: true });
});

// Modules
router.put("/sop-training/courses/:id/modules", requireRole(...AUTHOR_ROLES), planFlagGate, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [course] = await db.select().from(trainingCoursesTable).where(eq(trainingCoursesTable.id, id));
  if (!course || course.tenantId !== req.user!.tenantId) return void res.status(404).json({ error: "Not found" });
  const list = Array.isArray(req.body?.modules) ? req.body.modules as Array<Record<string, unknown>> : [];
  await db.delete(trainingModulesTable).where(eq(trainingModulesTable.courseId, id));
  if (list.length) {
    await db.insert(trainingModulesTable).values(list.map((m, idx) => ({
      courseId: id,
      title: String(m.title ?? "").slice(0, 300) || `Module ${idx + 1}`,
      videoUrl: typeof m.videoUrl === "string" ? m.videoUrl : null,
      videoObjectPath: typeof m.videoObjectPath === "string" ? m.videoObjectPath : null,
      documents: Array.isArray(m.documents) ? m.documents as Array<{ name: string; url: string }> : [],
      linkedSopId: m.linkedSopId == null ? null : Number(m.linkedSopId) || null,
      body: typeof m.body === "string" ? m.body : "",
      sortOrder: idx,
    })));
  }
  const modules = await db.select().from(trainingModulesTable).where(eq(trainingModulesTable.courseId, id)).orderBy(trainingModulesTable.sortOrder);
  res.json({ data: modules });
});

// Quiz questions
router.put("/sop-training/courses/:id/questions", requireRole(...AUTHOR_ROLES), planFlagGate, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [course] = await db.select().from(trainingCoursesTable).where(eq(trainingCoursesTable.id, id));
  if (!course || course.tenantId !== req.user!.tenantId) return void res.status(404).json({ error: "Not found" });
  const list = Array.isArray(req.body?.questions) ? req.body.questions as Array<Record<string, unknown>> : [];
  await db.delete(trainingQuizQuestionsTable).where(eq(trainingQuizQuestionsTable.courseId, id));
  const cleaned = list.map((q, idx) => ({
    courseId: id,
    question: String(q.question ?? "").slice(0, 1000),
    options: Array.isArray(q.options) ? (q.options as unknown[]).map(o => String(o)).slice(0, 6) : [],
    correctIndex: Math.max(0, Number(q.correctIndex) | 0),
    sortOrder: idx,
  })).filter(q => q.question && q.options.length >= 2 && q.correctIndex < q.options.length);
  if (cleaned.length) await db.insert(trainingQuizQuestionsTable).values(cleaned);
  const questions = await db.select().from(trainingQuizQuestionsTable).where(eq(trainingQuizQuestionsTable.courseId, id)).orderBy(trainingQuizQuestionsTable.sortOrder);
  res.json({ data: questions });
});

// ───────────────────────────────────────────────────────────
// Assignments
// ───────────────────────────────────────────────────────────
async function autoAssignmentForUser(tenantId: number, userId: number, role: string): Promise<void> {
  if (!isStaffRole(role)) return;
  const courses = await db.select().from(trainingCoursesTable).where(and(
    eq(trainingCoursesTable.tenantId, tenantId),
    eq(trainingCoursesTable.isPublished, true),
  ));
  const matching = courses.filter(c => c.isOnboarding || c.requiredRoles.includes(role as StaffRoleForTraining));
  for (const c of matching) {
    await db.insert(trainingAssignmentsTable).values({
      tenantId, courseId: c.id, userId, status: "not_started",
    }).onConflictDoNothing();
  }
}

export async function autoAssignTrainingForNewStaff(args: { tenantId: number | null; userId: number; role: string }): Promise<void> {
  if (!args.tenantId) return;
  try { await autoAssignmentForUser(args.tenantId, args.userId, args.role); }
  catch (err) { logger.warn({ err }, "sop-training: auto-assign failed"); }
}

router.post("/sop-training/courses/:id/assign", requireRole(...AUTHOR_ROLES), planFlagGate, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [course] = await db.select().from(trainingCoursesTable).where(eq(trainingCoursesTable.id, id));
  if (!course || course.tenantId !== req.user!.tenantId) return void res.status(404).json({ error: "Not found" });
  const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map((n: unknown) => Number(n)).filter(Boolean) : [];
  let assigned = 0;
  for (const uid of userIds) {
    const [u] = await db.select({ id: usersTable.id, tenantId: usersTable.tenantId }).from(usersTable).where(eq(usersTable.id, uid));
    if (!u || u.tenantId !== course.tenantId) continue;
    const r = await db.insert(trainingAssignmentsTable).values({
      tenantId: course.tenantId, courseId: id, userId: uid, status: "not_started",
    }).onConflictDoNothing().returning();
    if (r.length) {
      assigned++;
      await db.insert(notificationsTable).values({
        restaurantId: req.user!.restaurantId ?? null,
        type: "training_assigned",
        title: `Training assigned: ${course.title}`,
        message: `You have been assigned the course "${course.title}".`,
        entityId: r[0].id, entityType: "training_assignment",
      }).catch(() => {});
    }
  }
  res.json({ ok: true, assigned });
});

router.get("/sop-training/my-assignments", requireRole(...STAFF_VIEW_ROLES), planFlagGate, async (req, res) => {
  const userId = req.user!.sub;
  if (!userId) return void res.status(401).json({ error: "Not authenticated" });
  const rows = await db.select({
    id: trainingAssignmentsTable.id,
    courseId: trainingAssignmentsTable.courseId,
    status: trainingAssignmentsTable.status,
    assignedAt: trainingAssignmentsTable.assignedAt,
    startedAt: trainingAssignmentsTable.startedAt,
    completedAt: trainingAssignmentsTable.completedAt,
    expiresAt: trainingAssignmentsTable.expiresAt,
    lastScore: trainingAssignmentsTable.lastScore,
    attempts: trainingAssignmentsTable.attempts,
    courseTitle: trainingCoursesTable.title,
    courseDescription: trainingCoursesTable.description,
    requiresApproval: trainingCoursesTable.requiresApproval,
    passMarkPercent: trainingCoursesTable.passMarkPercent,
  }).from(trainingAssignmentsTable)
    .innerJoin(trainingCoursesTable, eq(trainingCoursesTable.id, trainingAssignmentsTable.courseId))
    .where(eq(trainingAssignmentsTable.userId, userId))
    .orderBy(desc(trainingAssignmentsTable.assignedAt));
  res.json({ data: rows });
});

router.post("/sop-training/assignments/:id/start", requireRole(...STAFF_VIEW_ROLES), planFlagGate, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [a] = await db.select().from(trainingAssignmentsTable).where(eq(trainingAssignmentsTable.id, id));
  if (!a || a.userId !== req.user!.sub) return void res.status(404).json({ error: "Not found" });
  if (a.status === "not_started") {
    const [updated] = await db.update(trainingAssignmentsTable)
      .set({ status: "in_progress", startedAt: new Date() })
      .where(eq(trainingAssignmentsTable.id, id)).returning();
    return void res.json(updated);
  }
  res.json(a);
});

// Submit a quiz attempt
router.post("/sop-training/assignments/:id/attempt", requireRole(...STAFF_VIEW_ROLES), planFlagGate, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [a] = await db.select().from(trainingAssignmentsTable).where(eq(trainingAssignmentsTable.id, id));
  if (!a || a.userId !== req.user!.sub) return void res.status(404).json({ error: "Not found" });
  const [course] = await db.select().from(trainingCoursesTable).where(eq(trainingCoursesTable.id, a.courseId));
  if (!course) return void res.status(404).json({ error: "Course not found" });
  const questions = await db.select().from(trainingQuizQuestionsTable).where(eq(trainingQuizQuestionsTable.courseId, a.courseId));
  const answers = (req.body?.answers ?? {}) as Record<string, number>;

  let correct = 0;
  for (const q of questions) {
    if (Number(answers[String(q.id)]) === q.correctIndex) correct++;
  }
  const total = questions.length;
  const scorePct = total === 0 ? 100 : Math.round((correct / total) * 100);
  const passed = scorePct >= course.passMarkPercent;

  const [attempt] = await db.insert(trainingAttemptsTable).values({
    assignmentId: id, userId: req.user!.sub!, answers,
    score: scorePct, totalQuestions: total, passed,
  }).returning();

  let nextStatus = a.status;
  if (passed) {
    nextStatus = course.requiresApproval ? "awaiting_approval" : "completed";
  } else {
    nextStatus = "in_progress";
  }
  const completedAt = nextStatus === "completed" ? new Date() : null;
  const expiresAt = nextStatus === "completed" && course.expiryMonths
    ? new Date(Date.now() + course.expiryMonths * 30 * 86400000) : null;

  await db.update(trainingAssignmentsTable).set({
    status: nextStatus,
    attempts: a.attempts + 1,
    lastScore: scorePct,
    completedAt,
    expiresAt,
  }).where(eq(trainingAssignmentsTable.id, id));

  if (passed && course.requiresApproval) {
    await db.insert(trainingApprovalsTable).values({
      tenantId: a.tenantId, assignmentId: id, attemptId: attempt.id, status: "pending",
    });
    // Notify managers (any restaurant in tenant)
    const mgrs = await db.select({ restaurantId: usersTable.restaurantId }).from(usersTable)
      .where(and(eq(usersTable.tenantId, a.tenantId), inArray(usersTable.role, ["owner", "manager"]), eq(usersTable.isActive, true)));
    for (const m of mgrs) {
      if (m.restaurantId) {
        await db.insert(notificationsTable).values({
          restaurantId: m.restaurantId, type: "training_approval_pending",
          title: `Training approval needed: ${course.title}`,
          message: `${req.user!.name ?? "A staff member"} passed "${course.title}" and is awaiting your approval.`,
          entityId: id, entityType: "training_assignment",
        }).catch(() => {});
      }
    }
  } else if (passed && !course.requiresApproval) {
    await issueCertificate({ assignmentId: id, courseId: course.id, userId: req.user!.sub!, tenantId: a.tenantId, score: scorePct, expiryMonths: course.expiryMonths });
  }

  res.status(201).json({ attempt, passed, score: scorePct, status: nextStatus });
});

async function issueCertificate(args: { assignmentId: number; courseId: number; userId: number; tenantId: number; score: number; expiryMonths: number | null }): Promise<void> {
  const certNum = `CERT-${args.tenantId}-${args.courseId}-${args.userId}-${Date.now()}`;
  const expiresAt = args.expiryMonths ? new Date(Date.now() + args.expiryMonths * 30 * 86400000) : null;
  await db.insert(trainingCertificatesTable).values({
    tenantId: args.tenantId,
    assignmentId: args.assignmentId,
    courseId: args.courseId,
    userId: args.userId,
    certificateNumber: certNum,
    score: args.score,
    expiresAt,
  }).onConflictDoNothing();
  // Notify the staff member
  const [u] = await db.select({ restaurantId: usersTable.restaurantId, name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, args.userId));
  if (u?.restaurantId) {
    await db.insert(notificationsTable).values({
      restaurantId: u.restaurantId, type: "training_certificate_issued",
      title: "Training certificate issued",
      message: `Your certificate for the training course is ready to download.`,
      entityId: args.assignmentId, entityType: "training_assignment",
    }).catch(() => {});
  }
  if (u?.email) {
    sendEmail({
      to: u.email,
      subject: "Your training certificate is ready",
      html: `<p>Hi ${u.name ?? ""},</p><p>You've completed your training. Your certificate (${certNum}) is now available in the SOP & Training section.</p>`,
      text: `You've completed your training. Certificate ${certNum} is available.`,
    }).catch(() => {});
  }
}

// ───────────────────────────────────────────────────────────
// Approvals
// ───────────────────────────────────────────────────────────
router.get("/sop-training/approvals/pending", requireRole(...AUTHOR_ROLES), planFlagGate, async (req, res) => {
  const tenantId = req.user!.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant scope" });
  const rows = await db.select({
    id: trainingApprovalsTable.id,
    assignmentId: trainingApprovalsTable.assignmentId,
    attemptId: trainingApprovalsTable.attemptId,
    createdAt: trainingApprovalsTable.createdAt,
    courseTitle: trainingCoursesTable.title,
    userName: usersTable.name,
    userEmail: usersTable.email,
    score: trainingAssignmentsTable.lastScore,
  }).from(trainingApprovalsTable)
    .innerJoin(trainingAssignmentsTable, eq(trainingAssignmentsTable.id, trainingApprovalsTable.assignmentId))
    .innerJoin(trainingCoursesTable, eq(trainingCoursesTable.id, trainingAssignmentsTable.courseId))
    .innerJoin(usersTable, eq(usersTable.id, trainingAssignmentsTable.userId))
    .where(and(eq(trainingApprovalsTable.tenantId, tenantId), eq(trainingApprovalsTable.status, "pending")))
    .orderBy(desc(trainingApprovalsTable.createdAt));
  res.json({ data: rows });
});

router.post("/sop-training/approvals/:id/decision", requireRole(...AUTHOR_ROLES), planFlagGate, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid id" });
  const [appr] = await db.select().from(trainingApprovalsTable).where(eq(trainingApprovalsTable.id, id));
  if (!appr || appr.tenantId !== req.user!.tenantId) return void res.status(404).json({ error: "Not found" });
  if (appr.status !== "pending") return void res.status(400).json({ error: "Already decided" });
  const decision = String(req.body?.decision ?? "");
  const note = typeof req.body?.note === "string" ? req.body.note : null;
  if (decision !== "approved" && decision !== "rejected") return void res.status(400).json({ error: "decision must be approved|rejected" });
  await db.update(trainingApprovalsTable).set({
    status: decision, reviewedBy: req.user!.sub ?? null, reviewedAt: new Date(), note,
  }).where(eq(trainingApprovalsTable.id, id));
  const [a] = await db.select().from(trainingAssignmentsTable).where(eq(trainingAssignmentsTable.id, appr.assignmentId));
  if (!a) return void res.json({ ok: true });
  const [course] = await db.select().from(trainingCoursesTable).where(eq(trainingCoursesTable.id, a.courseId));

  if (decision === "approved" && course) {
    const expiresAt = course.expiryMonths ? new Date(Date.now() + course.expiryMonths * 30 * 86400000) : null;
    await db.update(trainingAssignmentsTable).set({ status: "completed", completedAt: new Date(), expiresAt }).where(eq(trainingAssignmentsTable.id, a.id));
    await issueCertificate({ assignmentId: a.id, courseId: course.id, userId: a.userId, tenantId: a.tenantId, score: a.lastScore ?? 100, expiryMonths: course.expiryMonths });
  } else {
    await db.update(trainingAssignmentsTable).set({ status: "rejected" }).where(eq(trainingAssignmentsTable.id, a.id));
    const [u] = await db.select({ restaurantId: usersTable.restaurantId }).from(usersTable).where(eq(usersTable.id, a.userId));
    if (u?.restaurantId) {
      await db.insert(notificationsTable).values({
        restaurantId: u.restaurantId, type: "training_approval_rejected",
        title: "Training rejected",
        message: `Your training submission was not approved. ${note ?? ""}`,
        entityId: a.id, entityType: "training_assignment",
      }).catch(() => {});
    }
  }
  res.json({ ok: true });
});

// ───────────────────────────────────────────────────────────
// Certificates & dashboard
// ───────────────────────────────────────────────────────────
router.get("/sop-training/my-certificates", requireRole(...STAFF_VIEW_ROLES), planFlagGate, async (req, res) => {
  const userId = req.user!.sub;
  if (!userId) return void res.status(401).json({ error: "Not authenticated" });
  const rows = await db.select({
    id: trainingCertificatesTable.id,
    certificateNumber: trainingCertificatesTable.certificateNumber,
    courseId: trainingCertificatesTable.courseId,
    courseTitle: trainingCoursesTable.title,
    score: trainingCertificatesTable.score,
    issuedAt: trainingCertificatesTable.issuedAt,
    expiresAt: trainingCertificatesTable.expiresAt,
  }).from(trainingCertificatesTable)
    .innerJoin(trainingCoursesTable, eq(trainingCoursesTable.id, trainingCertificatesTable.courseId))
    .where(eq(trainingCertificatesTable.userId, userId))
    .orderBy(desc(trainingCertificatesTable.issuedAt));
  res.json({ data: rows });
});

router.get("/sop-training/progress", requireRole(...AUTHOR_ROLES), planFlagGate, async (req, res) => {
  const tenantId = req.user!.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant scope" });
  const role = req.query.role as string | undefined;
  // Staff in tenant
  const staffConds = [eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true)];
  if (role && isStaffRole(role)) staffConds.push(eq(usersTable.role, role));
  const staff = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role })
    .from(usersTable).where(and(...staffConds));
  const courses = await db.select().from(trainingCoursesTable).where(and(eq(trainingCoursesTable.tenantId, tenantId), eq(trainingCoursesTable.isPublished, true)));
  const assignments = await db.select().from(trainingAssignmentsTable).where(eq(trainingAssignmentsTable.tenantId, tenantId));
  const data = staff.map(s => {
    const required = courses.filter(c => c.isOnboarding || c.requiredRoles.includes(s.role as StaffRoleForTraining));
    const myAssigns = assignments.filter(a => a.userId === s.id);
    const completed = myAssigns.filter(a => a.status === "completed").length;
    const totalReq = required.length;
    return {
      user: s,
      required: required.map(c => {
        const a = myAssigns.find(x => x.courseId === c.id);
        return { courseId: c.id, courseTitle: c.title, status: a?.status ?? "not_started", lastScore: a?.lastScore ?? null, expiresAt: a?.expiresAt ?? null };
      }),
      completionPercent: totalReq === 0 ? 100 : Math.round((completed / totalReq) * 100),
    };
  });
  res.json({ data });
});

// ───────────────────────────────────────────────────────────
// Uploads (videos, attachments, documents)
// ───────────────────────────────────────────────────────────
router.post("/sop-training/uploads/request-url", requireRole(...AUTHOR_ROLES), planFlagGate, async (req, res) => {
  try {
    const uploadURL = await objectStorage.getObjectEntityUploadURL();
    const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
  } catch (err) {
    logger.warn({ err }, "sop-training: upload url failed");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.post("/sop-training/uploads/finalize", requireRole(...AUTHOR_ROLES), planFlagGate, async (req, res) => {
  const objectPath = String((req.body as { objectPath?: string })?.objectPath ?? "");
  if (!objectPath.startsWith("/objects/")) return void res.status(400).json({ error: "Invalid objectPath" });
  try {
    const file = await objectStorage.getObjectEntityFile(objectPath);
    try {
      await sanitizeStoredUpload(file, {
        allowedKinds: ["image", "pdf", "video"],
        maxBytes: 500 * 1024 * 1024,
      });
    } catch (sanErr) {
      if (sanErr instanceof UploadValidationError) {
        return void res.status(sanErr.statusCode).json({ error: sanErr.message });
      }
      throw sanErr;
    }
    await setObjectAclPolicy(file, {
      restaurantId: `tenant:${req.user?.tenantId ?? "anon"}`,
      uploaderId: req.user?.sub ? String(req.user.sub) : undefined,
      visibility: "private",
    });
    res.json({ ok: true, objectPath });
  } catch (err) {
    logger.warn({ err }, "sop-training: finalize failed");
    res.status(500).json({ error: "Failed to finalize upload" });
  }
});

// ───────────────────────────────────────────────────────────
// Cron tick — expiry reminders
// ───────────────────────────────────────────────────────────
export async function runSopTrainingExpiryTick(): Promise<void> {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000);
  const expiringSoon = await db.select({
    id: trainingAssignmentsTable.id,
    userId: trainingAssignmentsTable.userId,
    courseId: trainingAssignmentsTable.courseId,
    tenantId: trainingAssignmentsTable.tenantId,
    expiresAt: trainingAssignmentsTable.expiresAt,
    status: trainingAssignmentsTable.status,
  }).from(trainingAssignmentsTable)
    .where(and(eq(trainingAssignmentsTable.status, "completed"), sql`${trainingAssignmentsTable.expiresAt} IS NOT NULL`));
  for (const a of expiringSoon) {
    if (!a.expiresAt) continue;
    const daysLeft = Math.floor((a.expiresAt.getTime() - now.getTime()) / 86400000);
    if (a.expiresAt <= now) {
      await db.update(trainingAssignmentsTable).set({ status: "expired" }).where(eq(trainingAssignmentsTable.id, a.id));
      const [u] = await db.select({ restaurantId: usersTable.restaurantId, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, a.userId));
      if (u?.restaurantId) {
        await db.insert(notificationsTable).values({
          restaurantId: u.restaurantId, type: "training_expired",
          title: "Training certificate expired",
          message: "Your training certificate has expired. Please retake the course.",
          entityId: a.id, entityType: "training_assignment",
        }).catch(() => {});
      }
    } else if ([0, 7, 30].includes(daysLeft)) {
      const [u] = await db.select({ restaurantId: usersTable.restaurantId, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, a.userId));
      if (u?.restaurantId) {
        await db.insert(notificationsTable).values({
          restaurantId: u.restaurantId, type: "training_expiring",
          title: "Training certificate expiring soon",
          message: `Your training certificate expires in ${daysLeft} day(s).`,
          entityId: a.id, entityType: "training_assignment",
        }).catch(() => {});
      }
      if (u?.email && daysLeft === 30) {
        sendEmail({
          to: u.email, subject: "Training certificate expiring soon",
          html: `<p>Your training certificate expires in 30 days. Please plan to retake the course.</p>`,
          text: `Your training certificate expires in 30 days. Please plan to retake the course.`,
        }).catch(() => {});
      }
    }
  }
}

export default router;
