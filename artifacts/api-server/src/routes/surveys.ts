/**
 * Smart Forms & Surveys — tenant/restaurant-scoped survey builder + analytics + CSV export.
 * Public submission endpoints live in routes/public.ts.
 */
import { Router, type Request, type Response } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import {
  db,
  surveysTable,
  surveyQuestionsTable,
  surveyResponsesTable,
  SURVEY_TYPES,
  SURVEY_QUESTION_TYPES,
  type SurveyQuestion,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

router.use(
  "/restaurants/:restaurantId/surveys",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);

// ─── Defaults ────────────────────────────────────────────────────────────────

type DefaultQuestion = {
  type: typeof SURVEY_QUESTION_TYPES[number];
  label: string;
  required?: boolean;
  options?: string[];
  scaleMin?: number;
  scaleMax?: number;
};

const DEFAULTS: Record<typeof SURVEY_TYPES[number], { title: string; description: string; questions: DefaultQuestion[] }> = {
  food_quality: {
    title: "Food Quality Feedback",
    description: "Tell us about the food you enjoyed today.",
    questions: [
      { type: "rating_5", label: "How would you rate the taste of your food?", required: true, scaleMin: 1, scaleMax: 5 },
      { type: "rating_5", label: "How was the freshness of the ingredients?", scaleMin: 1, scaleMax: 5 },
      { type: "rating_5", label: "Was the portion size satisfactory?", scaleMin: 1, scaleMax: 5 },
      { type: "text_long", label: "Any specific dish you loved or didn't enjoy?" },
    ],
  },
  service_quality: {
    title: "Service Quality Feedback",
    description: "How did our team do today?",
    questions: [
      { type: "rating_5", label: "How attentive was your server?", required: true, scaleMin: 1, scaleMax: 5 },
      { type: "rating_5", label: "How quick was the service?", scaleMin: 1, scaleMax: 5 },
      { type: "single_choice", label: "Did we greet you within a few minutes of arriving?", options: ["Yes", "No"] },
      { type: "text_long", label: "Anything our team could do better?" },
    ],
  },
  cleanliness: {
    title: "Cleanliness Feedback",
    description: "Help us keep things spotless.",
    questions: [
      { type: "rating_5", label: "Cleanliness of the dining area", required: true, scaleMin: 1, scaleMax: 5 },
      { type: "rating_5", label: "Cleanliness of the restroom", scaleMin: 1, scaleMax: 5 },
      { type: "rating_5", label: "Cleanliness of the table & cutlery", scaleMin: 1, scaleMax: 5 },
      { type: "text_short", label: "If you noticed something we should fix, please tell us." },
    ],
  },
  ambience: {
    title: "Ambience Feedback",
    description: "How did the vibe feel today?",
    questions: [
      { type: "rating_5", label: "Overall ambience", required: true, scaleMin: 1, scaleMax: 5 },
      { type: "rating_5", label: "Lighting", scaleMin: 1, scaleMax: 5 },
      { type: "rating_5", label: "Music & noise level", scaleMin: 1, scaleMax: 5 },
      { type: "rating_5", label: "Comfort of seating", scaleMin: 1, scaleMax: 5 },
    ],
  },
  staff_rating: {
    title: "Staff Rating",
    description: "Rate the team that served you.",
    questions: [
      { type: "rating_5", label: "Friendliness of the staff", required: true, scaleMin: 1, scaleMax: 5 },
      { type: "rating_5", label: "Knowledge about the menu", scaleMin: 1, scaleMax: 5 },
      { type: "rating_5", label: "Professionalism", scaleMin: 1, scaleMax: 5 },
      { type: "text_short", label: "Anyone you'd like to specifically appreciate?" },
    ],
  },
  nps: {
    title: "How likely are you to recommend us?",
    description: "On a scale from 0–10, would you recommend us to a friend?",
    questions: [
      { type: "nps", label: "How likely are you to recommend us to a friend or colleague?", required: true, scaleMin: 0, scaleMax: 10 },
      { type: "text_long", label: "What's the main reason for your score?" },
    ],
  },
  suggestion_box: {
    title: "Suggestion Box",
    description: "Any ideas to make us better? We'd love to hear them.",
    questions: [
      { type: "text_long", label: "Your suggestion", required: true },
      { type: "single_choice", label: "What does your suggestion relate to?", options: ["Menu", "Service", "Pricing", "Ambience", "Other"] },
    ],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSlug(restaurantId: number): string {
  return `srv_${restaurantId}_${randomBytes(6).toString("hex")}`;
}

function sanitizeQuestionInput(b: Record<string, unknown>, order: number): Omit<typeof surveyQuestionsTable.$inferInsert, "surveyId"> | null {
  const type = String(b.type ?? "");
  if (!(SURVEY_QUESTION_TYPES as readonly string[]).includes(type)) return null;
  const label = typeof b.label === "string" ? b.label.trim().slice(0, 500) : "";
  if (!label) return null;
  let scaleMin: number | null = null;
  let scaleMax: number | null = null;
  let options: string[] = [];
  if (type === "rating_5") { scaleMin = 1; scaleMax = 5; }
  else if (type === "rating_10") { scaleMin = 1; scaleMax = 10; }
  else if (type === "nps") { scaleMin = 0; scaleMax = 10; }
  else if (type === "single_choice") {
    options = Array.isArray(b.options)
      ? (b.options as unknown[]).map(o => String(o).trim()).filter(Boolean).slice(0, 20)
      : [];
    if (options.length < 2) return null;
  }
  return {
    sortOrder: order,
    type,
    label,
    required: !!b.required,
    options,
    scaleMin,
    scaleMax,
  };
}

// ─── Routes: list / create / get / update / delete ──────────────────────────

router.get("/restaurants/:restaurantId/surveys", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(surveysTable)
    .where(eq(surveysTable.restaurantId, restaurantId))
    .orderBy(desc(surveysTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/surveys", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const tenantId = req.user?.tenantId;
  if (!tenantId && !req.user?.isSuperAdmin) return void res.status(400).json({ error: "Tenant required" });

  const b = (req.body ?? {}) as Record<string, unknown>;
  const type = String(b.type ?? "");
  if (!(SURVEY_TYPES as readonly string[]).includes(type)) {
    return void res.status(400).json({ error: "Invalid survey type" });
  }
  const def = DEFAULTS[type as typeof SURVEY_TYPES[number]];

  // Resolve tenantId for super_admin acting on a restaurant
  let resolvedTenant = tenantId ?? null;
  if (!resolvedTenant) {
    const { restaurantsTable } = await import("../lib/db");
    const [r] = await db.select({ tenantId: restaurantsTable.tenantId }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
    resolvedTenant = r?.tenantId ?? null;
  }
  if (!resolvedTenant) return void res.status(400).json({ error: "Tenant not resolved" });

  const slug = makeSlug(restaurantId);
  const [survey] = await db.insert(surveysTable).values({
    tenantId: resolvedTenant,
    restaurantId,
    type,
    slug,
    title: typeof b.title === "string" && b.title.trim() ? b.title.slice(0, 200) : def.title,
    description: typeof b.description === "string" ? b.description.slice(0, 1000) : def.description,
    thankYouMessage: typeof b.thankYouMessage === "string" && b.thankYouMessage.trim() ? b.thankYouMessage.slice(0, 500) : "Thanks for your feedback!",
    collectName: b.collectName !== false,
    collectPhone: !!b.collectPhone,
    collectTableNumber: !!b.collectTableNumber,
    isActive: b.isActive !== false,
    createdBy: req.user?.sub ?? null,
  }).returning();

  // Seed default questions
  const seedQuestions = def.questions.map((q, i) => ({
    surveyId: survey.id,
    sortOrder: i,
    type: q.type,
    label: q.label,
    required: !!q.required,
    options: q.options ?? [],
    scaleMin: q.scaleMin ?? null,
    scaleMax: q.scaleMax ?? null,
  }));
  if (seedQuestions.length) await db.insert(surveyQuestionsTable).values(seedQuestions);

  const questions = await db.select().from(surveyQuestionsTable)
    .where(eq(surveyQuestionsTable.surveyId, survey.id))
    .orderBy(surveyQuestionsTable.sortOrder);

  res.status(201).json({ ...survey, questions });
});

router.get("/restaurants/:restaurantId/surveys/:id", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [survey] = await db.select().from(surveysTable)
    .where(and(eq(surveysTable.id, id), eq(surveysTable.restaurantId, restaurantId)));
  if (!survey) return void res.status(404).json({ error: "Not found" });
  const questions = await db.select().from(surveyQuestionsTable)
    .where(eq(surveyQuestionsTable.surveyId, id))
    .orderBy(surveyQuestionsTable.sortOrder);
  res.json({ ...survey, questions });
});

router.patch("/restaurants/:restaurantId/surveys/:id", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [existing] = await db.select().from(surveysTable)
    .where(and(eq(surveysTable.id, id), eq(surveysTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const update: Partial<typeof surveysTable.$inferInsert> = { updatedAt: new Date() };
  if (typeof b.title === "string" && b.title.trim()) update.title = b.title.slice(0, 200);
  if (b.description !== undefined) update.description = b.description == null ? null : String(b.description).slice(0, 1000);
  if (typeof b.thankYouMessage === "string" && b.thankYouMessage.trim()) update.thankYouMessage = b.thankYouMessage.slice(0, 500);
  if (b.collectName !== undefined) update.collectName = !!b.collectName;
  if (b.collectPhone !== undefined) update.collectPhone = !!b.collectPhone;
  if (b.collectTableNumber !== undefined) update.collectTableNumber = !!b.collectTableNumber;
  if (b.isActive !== undefined) update.isActive = !!b.isActive;
  const [row] = await db.update(surveysTable).set(update).where(eq(surveysTable.id, id)).returning();
  res.json(row);
});

router.delete("/restaurants/:restaurantId/surveys/:id", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [existing] = await db.select().from(surveysTable)
    .where(and(eq(surveysTable.id, id), eq(surveysTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  await db.delete(surveysTable).where(eq(surveysTable.id, id));
  res.json({ success: true });
});

// ─── Questions management (only allowed if no responses yet) ────────────────

async function ensureNoResponses(surveyId: number): Promise<boolean> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(surveyResponsesTable)
    .where(eq(surveyResponsesTable.surveyId, surveyId));
  return Number(count) === 0;
}

router.put("/restaurants/:restaurantId/surveys/:id/questions", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [survey] = await db.select().from(surveysTable)
    .where(and(eq(surveysTable.id, id), eq(surveysTable.restaurantId, restaurantId)));
  if (!survey) return void res.status(404).json({ error: "Not found" });

  const b = (req.body ?? {}) as Record<string, unknown>;
  const list = Array.isArray(b.questions) ? b.questions as Array<Record<string, unknown>> : null;
  if (!list) return void res.status(400).json({ error: "questions array required" });

  // If responses exist, only allow label/required/options edits — not type or structural removals.
  const noResponses = await ensureNoResponses(id);
  const existing = await db.select().from(surveyQuestionsTable)
    .where(eq(surveyQuestionsTable.surveyId, id))
    .orderBy(surveyQuestionsTable.sortOrder);

  if (!noResponses) {
    // Label-only edits keyed by id
    const byId = new Map(existing.map(q => [q.id, q]));
    for (const item of list) {
      const qid = Number(item.id);
      if (!qid || !byId.has(qid)) continue;
      const update: Partial<typeof surveyQuestionsTable.$inferInsert> = {};
      if (typeof item.label === "string" && item.label.trim()) update.label = item.label.slice(0, 500);
      if (item.required !== undefined) update.required = !!item.required;
      if (Object.keys(update).length) {
        await db.update(surveyQuestionsTable).set(update).where(eq(surveyQuestionsTable.id, qid));
      }
    }
    const updated = await db.select().from(surveyQuestionsTable)
      .where(eq(surveyQuestionsTable.surveyId, id))
      .orderBy(surveyQuestionsTable.sortOrder);
    return void res.json({ questions: updated, structuralEditsLocked: true });
  }

  // No responses → allow full replacement
  const sanitized = list
    .map((q, i) => sanitizeQuestionInput(q, i))
    .filter((q): q is NonNullable<ReturnType<typeof sanitizeQuestionInput>> => !!q);
  if (sanitized.length === 0) return void res.status(400).json({ error: "At least one valid question is required" });

  await db.delete(surveyQuestionsTable).where(eq(surveyQuestionsTable.surveyId, id));
  await db.insert(surveyQuestionsTable).values(sanitized.map(q => ({ ...q, surveyId: id })));
  await db.update(surveysTable).set({ updatedAt: new Date() }).where(eq(surveysTable.id, id));

  const updated = await db.select().from(surveyQuestionsTable)
    .where(eq(surveyQuestionsTable.surveyId, id))
    .orderBy(surveyQuestionsTable.sortOrder);
  res.json({ questions: updated, structuralEditsLocked: false });
});

// ─── QR SVG ─────────────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/surveys/:id/qr.svg", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [survey] = await db.select().from(surveysTable)
    .where(and(eq(surveysTable.id, id), eq(surveysTable.restaurantId, restaurantId)));
  if (!survey) return void res.status(404).json({ error: "Not found" });
  const baseUrl = process.env.PUBLIC_URL?.replace(/\/$/, "") ?? `${req.protocol}://${req.get("host")}`;
  const url = `${baseUrl}/survey/${survey.slug}`;
  const QRCode = await import("qrcode");
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 400 });
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(svg);
});

// ─── Analytics ──────────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/surveys/:id/analytics", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [survey] = await db.select().from(surveysTable)
    .where(and(eq(surveysTable.id, id), eq(surveysTable.restaurantId, restaurantId)));
  if (!survey) return void res.status(404).json({ error: "Not found" });

  const questions = await db.select().from(surveyQuestionsTable)
    .where(eq(surveyQuestionsTable.surveyId, id))
    .orderBy(surveyQuestionsTable.sortOrder);

  const responses = await db.select().from(surveyResponsesTable)
    .where(eq(surveyResponsesTable.surveyId, id))
    .orderBy(desc(surveyResponsesTable.submittedAt));

  // Trend by day (last 30 days from earliest data, or all)
  const trendMap = new Map<string, number>();
  for (const r of responses) {
    const key = r.submittedAt.toISOString().slice(0, 10);
    trendMap.set(key, (trendMap.get(key) ?? 0) + 1);
  }
  const trend = Array.from(trendMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));

  // Per-question aggregates
  const perQuestion = questions.map(q => {
    const answers = responses.map(r => (r.answers ?? {})[String(q.id)]).filter(a => a !== undefined && a !== null && a !== "");
    if (q.type === "rating_5" || q.type === "rating_10") {
      const nums = answers.map(Number).filter(n => Number.isFinite(n));
      const avg = nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
      const dist: Record<string, number> = {};
      const max = q.scaleMax ?? (q.type === "rating_5" ? 5 : 10);
      for (let i = 1; i <= max; i++) dist[String(i)] = 0;
      for (const n of nums) if (dist[String(n)] != null) dist[String(n)]++;
      return {
        questionId: q.id, label: q.label, type: q.type,
        responseCount: nums.length,
        average: Number(avg.toFixed(2)),
        distribution: Object.entries(dist).map(([k, v]) => ({ value: k, count: v })),
      };
    }
    if (q.type === "nps") {
      const nums = answers.map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= 10);
      const promoters = nums.filter(n => n >= 9).length;
      const detractors = nums.filter(n => n <= 6).length;
      const passives = nums.filter(n => n === 7 || n === 8).length;
      const npsScore = nums.length ? Math.round(((promoters - detractors) / nums.length) * 100) : 0;
      return {
        questionId: q.id, label: q.label, type: q.type,
        responseCount: nums.length,
        npsScore, promoters, passives, detractors,
        average: nums.length ? Number((nums.reduce((s, n) => s + n, 0) / nums.length).toFixed(2)) : 0,
      };
    }
    if (q.type === "single_choice") {
      const counts: Record<string, number> = {};
      for (const opt of (q.options ?? [])) counts[opt] = 0;
      for (const a of answers) {
        const s = String(a);
        if (counts[s] != null) counts[s]++;
        else counts[s] = (counts[s] ?? 0) + 1;
      }
      return {
        questionId: q.id, label: q.label, type: q.type,
        responseCount: answers.length,
        distribution: Object.entries(counts).map(([value, count]) => ({ value, count })),
      };
    }
    // text
    const recent = responses.slice(0, 25)
      .map(r => ({
        text: String((r.answers ?? {})[String(q.id)] ?? "").trim(),
        submittedAt: r.submittedAt,
        respondentName: r.respondentName,
      }))
      .filter(t => t.text.length > 0);
    return {
      questionId: q.id, label: q.label, type: q.type,
      responseCount: answers.length,
      recent,
    };
  });

  res.json({
    totalResponses: responses.length,
    trend,
    perQuestion,
  });
});

router.get("/restaurants/:restaurantId/surveys/:id/responses", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
  const [survey] = await db.select({ id: surveysTable.id }).from(surveysTable)
    .where(and(eq(surveysTable.id, id), eq(surveysTable.restaurantId, restaurantId)));
  if (!survey) return void res.status(404).json({ error: "Not found" });
  const rows = await db.select().from(surveyResponsesTable)
    .where(eq(surveyResponsesTable.surveyId, id))
    .orderBy(desc(surveyResponsesTable.submittedAt))
    .limit(limit);
  res.json(rows);
});

// CSV export
router.get("/restaurants/:restaurantId/surveys/:id/responses.csv", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [survey] = await db.select().from(surveysTable)
    .where(and(eq(surveysTable.id, id), eq(surveysTable.restaurantId, restaurantId)));
  if (!survey) return void res.status(404).json({ error: "Not found" });

  const questions = await db.select().from(surveyQuestionsTable)
    .where(eq(surveyQuestionsTable.surveyId, id))
    .orderBy(surveyQuestionsTable.sortOrder);

  const responses = await db.select().from(surveyResponsesTable)
    .where(eq(surveyResponsesTable.surveyId, id))
    .orderBy(desc(surveyResponsesTable.submittedAt))
    .limit(10000);

  const escape = (v: unknown) => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const headers = ["Submitted At", "Name", "Phone", "Table", ...questions.map(q => q.label)];
  const lines = [headers.map(escape).join(",")];
  for (const r of responses) {
    const row: unknown[] = [
      r.submittedAt.toISOString(),
      r.respondentName ?? "",
      r.respondentPhone ?? "",
      r.tableNumber ?? "",
    ];
    for (const q of questions) {
      const val = (r.answers ?? {})[String(q.id)];
      row.push(val == null ? "" : (typeof val === "string" ? val : String(val)));
    }
    lines.push(row.map(escape).join(","));
  }
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="survey-${id}-responses.csv"`);
  res.send(lines.join("\n") + "\n");
});

// Defaults endpoint (UI uses this to seed builder previews)
router.get("/restaurants/:restaurantId/surveys-meta/defaults", async (_req: Request, res: Response) => {
  res.json({
    types: SURVEY_TYPES.map(t => ({
      type: t,
      ...DEFAULTS[t],
    })),
  });
});

export default router;
export { DEFAULTS as SURVEY_DEFAULTS };
