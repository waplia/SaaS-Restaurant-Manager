/**
 * Khana AI — Review QR + AI review replies + negative feedback recovery.
 *
 * Tenant-facing endpoints for owners and managers. Public endpoints for the
 * customer-facing feedback page live in routes/public.ts.
 */
import { Router, type Request, type Response } from "express";
import { eq, and, desc, gte, sql, inArray, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";
import {
  db,
  reviewQrsTable,
  reviewQrScansTable,
  customerFeedbackTable,
  externalReviewsTable,
  reviewRepliesTable,
  feedbackRecoveryTasksTable,
  branchesTable,
  usersTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { AIProviderService } from "../lib/aiProviderService";
import {
  requireAiCredits,
  commitReservation,
  refundReservation,
  type AiCreditReservation,
} from "../lib/aiCredits";
import { recordAuditLog } from "../lib/audit";

const router = Router();

router.use(
  "/restaurants/:restaurantId/reviews/:rest",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("khana_ai_enabled"),
);
router.use(
  "/restaurants/:restaurantId/review-qrs/:rest",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("khana_ai_enabled"),
);

// ─── Review QR builder ───────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/review-qrs/list", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(reviewQrsTable)
    .where(eq(reviewQrsTable.restaurantId, restaurantId))
    .orderBy(desc(reviewQrsTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/review-qrs/list", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const qrCode = `rqr_${restaurantId}_${randomBytes(6).toString("hex")}`;
  const branchId = b.branchId != null ? Number(b.branchId) : null;
  if (branchId) {
    const [br] = await db.select({ id: branchesTable.id }).from(branchesTable)
      .where(and(eq(branchesTable.id, branchId), eq(branchesTable.restaurantId, restaurantId)));
    if (!br) return void res.status(400).json({ error: "Invalid branchId" });
  }
  const [row] = await db.insert(reviewQrsTable).values({
    restaurantId,
    branchId,
    qrCode,
    title: typeof b.title === "string" && b.title.trim() ? b.title.slice(0, 200) : "How was your experience?",
    customMessage: typeof b.customMessage === "string" ? b.customMessage.slice(0, 1000) : null,
    thankYouMessage: typeof b.thankYouMessage === "string" && b.thankYouMessage.trim() ? b.thankYouMessage.slice(0, 500) : "Thanks for your feedback!",
    negativeFeedbackMessage: typeof b.negativeFeedbackMessage === "string" && b.negativeFeedbackMessage.trim() ? b.negativeFeedbackMessage.slice(0, 500) : "Sorry to hear that. We'd love a chance to make it right.",
    googleReviewUrl: typeof b.googleReviewUrl === "string" ? b.googleReviewUrl.slice(0, 500) : null,
    googlePlaceId: typeof b.googlePlaceId === "string" ? b.googlePlaceId.slice(0, 200) : null,
    positiveThreshold: Math.min(5, Math.max(1, Number(b.positiveThreshold) || 4)),
    showGoogleButtonOnNegative: !!b.showGoogleButtonOnNegative,
    aiAssistEnabled: b.aiAssistEnabled !== false,
    isActive: b.isActive !== false,
  }).returning();
  await recordAuditLog({
    req, module: "khana_ai", action: "review_qr.create",
    entity: "review_qr", entityId: row.id, restaurantId, targetRestaurantId: restaurantId,
    newValue: { id: row.id, title: row.title, branchId: row.branchId },
  });
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/review-qrs/:qrId", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const qrId = Number(req.params.qrId);
  const [existing] = await db.select().from(reviewQrsTable).where(and(eq(reviewQrsTable.id, qrId), eq(reviewQrsTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const update: Partial<typeof reviewQrsTable.$inferInsert> = { updatedAt: new Date() };
  if (b.title != null) update.title = String(b.title).slice(0, 200);
  if (b.customMessage !== undefined) update.customMessage = b.customMessage == null ? null : String(b.customMessage).slice(0, 1000);
  if (b.thankYouMessage != null) update.thankYouMessage = String(b.thankYouMessage).slice(0, 500);
  if (b.negativeFeedbackMessage != null) update.negativeFeedbackMessage = String(b.negativeFeedbackMessage).slice(0, 500);
  if (b.googleReviewUrl !== undefined) update.googleReviewUrl = b.googleReviewUrl == null ? null : String(b.googleReviewUrl).slice(0, 500);
  if (b.googlePlaceId !== undefined) update.googlePlaceId = b.googlePlaceId == null ? null : String(b.googlePlaceId).slice(0, 200);
  if (b.positiveThreshold != null) update.positiveThreshold = Math.min(5, Math.max(1, Number(b.positiveThreshold)));
  if (b.showGoogleButtonOnNegative !== undefined) update.showGoogleButtonOnNegative = !!b.showGoogleButtonOnNegative;
  if (b.aiAssistEnabled !== undefined) update.aiAssistEnabled = !!b.aiAssistEnabled;
  if (b.isActive !== undefined) update.isActive = !!b.isActive;
  if (b.branchId !== undefined) {
    const branchId = b.branchId == null ? null : Number(b.branchId);
    if (branchId != null) {
      const [br] = await db.select({ id: branchesTable.id }).from(branchesTable)
        .where(and(eq(branchesTable.id, branchId), eq(branchesTable.restaurantId, restaurantId)));
      if (!br) return void res.status(400).json({ error: "Invalid branchId" });
    }
    update.branchId = branchId;
  }
  const [row] = await db.update(reviewQrsTable).set(update).where(eq(reviewQrsTable.id, qrId)).returning();
  await recordAuditLog({
    req, module: "khana_ai", action: "review_qr.update",
    entity: "review_qr", entityId: qrId, restaurantId, targetRestaurantId: restaurantId,
    oldValue: existing, newValue: update,
  });
  res.json(row);
});

router.delete("/restaurants/:restaurantId/review-qrs/:qrId", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const qrId = Number(req.params.qrId);
  const [existing] = await db.select().from(reviewQrsTable).where(and(eq(reviewQrsTable.id, qrId), eq(reviewQrsTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  await db.delete(reviewQrsTable).where(eq(reviewQrsTable.id, qrId));
  await recordAuditLog({
    req, module: "khana_ai", action: "review_qr.delete",
    entity: "review_qr", entityId: qrId, restaurantId, targetRestaurantId: restaurantId,
    oldValue: existing,
  });
  res.json({ success: true });
});

// QR PNG/SVG download (re-uses the `qrcode` library that powers table QRs).
router.get("/restaurants/:restaurantId/review-qrs/:qrId/qr.svg", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const qrId = Number(req.params.qrId);
  const [row] = await db.select().from(reviewQrsTable).where(and(eq(reviewQrsTable.id, qrId), eq(reviewQrsTable.restaurantId, restaurantId)));
  if (!row) return void res.status(404).json({ error: "Not found" });
  const baseUrl = process.env.PUBLIC_URL?.replace(/\/$/, "") ?? `${req.protocol}://${req.get("host")}`;
  const url = `${baseUrl}/review/${row.qrCode}`;
  const QRCode = await import("qrcode");
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 400 });
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(svg);
});

// ─── Analytics ───────────────────────────────────────────────────────────────

router.get("/restaurants/:restaurantId/review-qrs/analytics", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const days = Math.min(180, Math.max(1, Number(req.query.days ?? 30)));
  const since = new Date(Date.now() - days * 86_400_000);
  const qrIdParam = req.query.qrId ? Number(req.query.qrId) : null;

  const conds = [eq(reviewQrScansTable.restaurantId, restaurantId), gte(reviewQrScansTable.createdAt, since)];
  if (qrIdParam) conds.push(eq(reviewQrScansTable.qrId, qrIdParam));

  const rows = await db.select({
    day: sql<string>`to_char(${reviewQrScansTable.createdAt}, 'YYYY-MM-DD')`,
    event: reviewQrScansTable.event,
    rating: reviewQrScansTable.rating,
    count: sql<number>`count(*)::int`,
  }).from(reviewQrScansTable)
    .where(and(...conds))
    .groupBy(sql`1`, reviewQrScansTable.event, reviewQrScansTable.rating);

  // Determine the positive-rating threshold for splitting positive vs negative
  // ratings. When filtering to one QR we use that QR's setting; otherwise we
  // fall back to the conventional 4★.
  let positiveThreshold = 4;
  if (qrIdParam) {
    const [qr] = await db.select({ pt: reviewQrsTable.positiveThreshold }).from(reviewQrsTable).where(eq(reviewQrsTable.id, qrIdParam));
    if (qr) positiveThreshold = qr.pt;
  }

  const totals = {
    scans: 0,
    rated: 0,
    googleRedirects: 0,
    negativeFeedback: 0,
    aiDraftsGenerated: 0,
    copyClicks: 0,
    positiveCount: 0,
    negativeCount: 0,
    sumRating: 0,
    ratedWithStars: 0,
  };
  for (const r of rows) {
    if (r.event === "scan") totals.scans += r.count;
    if (r.event === "rated") {
      totals.rated += r.count;
      if (r.rating) {
        totals.sumRating += r.rating * r.count;
        totals.ratedWithStars += r.count;
        if (r.rating >= positiveThreshold) totals.positiveCount += r.count;
        else totals.negativeCount += r.count;
      }
    }
    if (r.event === "google_redirect") totals.googleRedirects += r.count;
    if (r.event === "submitted_negative") totals.negativeFeedback += r.count;
    if (r.event === "draft_generated") totals.aiDraftsGenerated += r.count;
    if (r.event === "draft_copied") totals.copyClicks += r.count;
  }
  const avgRating = totals.ratedWithStars ? +(totals.sumRating / totals.ratedWithStars).toFixed(2) : 0;

  // Tag distribution: unnest selectedTags JSON array on customer_feedback rows
  // for this restaurant in the same time window. Top 12.
  const tagConds = [eq(customerFeedbackTable.restaurantId, restaurantId), gte(customerFeedbackTable.createdAt, since)];
  if (qrIdParam) tagConds.push(eq(customerFeedbackTable.qrId, qrIdParam));
  const tagRows = await db.execute<{ tag: string; count: number }>(sql`
    SELECT tag::text AS tag, count(*)::int AS count
    FROM ${customerFeedbackTable},
      jsonb_array_elements_text(coalesce(${customerFeedbackTable.selectedTags}, '[]'::jsonb)) AS tag
    WHERE ${and(...tagConds)}
    GROUP BY tag
    ORDER BY count DESC
    LIMIT 12
  `);
  const tagDistribution = (Array.isArray(tagRows) ? tagRows : (tagRows as { rows?: Array<{ tag: string; count: number }> }).rows ?? [])
    .map((r) => ({ tag: r.tag, count: Number(r.count) }));

  res.json({ totals: { ...totals, avgRating }, byDay: rows, tagDistribution });
});

// ─── Customer feedback (private 1–3★) ─────────────────────────────────────────

router.get("/restaurants/:restaurantId/reviews/feedback", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
  const rows = await db.select().from(customerFeedbackTable)
    .where(eq(customerFeedbackTable.restaurantId, restaurantId))
    .orderBy(desc(customerFeedbackTable.createdAt))
    .limit(limit);
  res.json(rows);
});

// ─── External reviews (manual paste or future GBP) ───────────────────────────

router.get("/restaurants/:restaurantId/reviews/external", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
  const rows = await db.select().from(externalReviewsTable)
    .where(eq(externalReviewsTable.restaurantId, restaurantId))
    .orderBy(desc(externalReviewsTable.createdAt))
    .limit(limit);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/reviews/external", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const body = typeof b.body === "string" ? b.body.trim() : "";
  if (!body) return void res.status(400).json({ error: "Review body is required" });
  const rating = b.rating != null ? Math.min(5, Math.max(1, Number(b.rating))) : null;
  const [row] = await db.insert(externalReviewsTable).values({
    restaurantId,
    source: "manual",
    authorName: typeof b.authorName === "string" ? b.authorName.slice(0, 200) : null,
    rating,
    body: body.slice(0, 4000),
    postedAt: b.postedAt ? new Date(String(b.postedAt)) : null,
  }).returning();
  // Auto-queue low-rated external reviews into the recovery workflow so the
  // manager sees them in the same place as private feedback.
  if (rating != null && rating <= 3) {
    await db.insert(feedbackRecoveryTasksTable).values({
      restaurantId,
      externalReviewId: row.id,
      sentiment: rating <= 2 ? "negative" : "neutral",
      status: "new",
    });
  }
  res.status(201).json(row);
});

// ─── AI: sentiment + reply ──────────────────────────────────────────────────

const TONES = ["professional", "friendly", "apologetic", "premium", "short", "detailed"] as const;

router.post(
  "/restaurants/:restaurantId/reviews/ai-reply",
  requireAiCredits("ai_review_reply", () => ({ units: 1 })),
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const reservation = res.locals.aiCreditReservation as AiCreditReservation | null;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const reviewBody = typeof b.body === "string" ? b.body.trim() : "";
    const externalReviewId = b.externalReviewId != null ? Number(b.externalReviewId) : null;
    const tone = TONES.includes(String(b.tone) as typeof TONES[number]) ? String(b.tone) : "professional";

    if (!reviewBody) {
      if (reservation) await refundReservation(reservation, "missing review body");
      return void res.status(400).json({ error: "Review body is required" });
    }

    if (externalReviewId) {
      const [ex] = await db.select({ id: externalReviewsTable.id }).from(externalReviewsTable)
        .where(and(eq(externalReviewsTable.id, externalReviewId), eq(externalReviewsTable.restaurantId, restaurantId)));
      if (!ex) {
        if (reservation) await refundReservation(reservation, "external review not found");
        return void res.status(404).json({ error: "Review not found" });
      }
    }

    const prompt = `You are a restaurant manager replying to a customer review.

Review (rating ${b.rating ?? "unknown"}/5): "${reviewBody.slice(0, 2000)}"

Tone: ${tone}

Return ONLY JSON: {
  "sentiment": "positive" | "neutral" | "negative" | "angry",
  "category": "food" | "staff" | "delivery" | "hygiene" | "pricing" | "other",
  "reply": "<the reply text — never auto-promise refunds; never invent compensation; address the reviewer directly; 2–4 sentences for short, 4–6 for detailed>"
}`;

    try {
      const { data, result } = await AIProviderService.generateJson<{
        sentiment?: string; category?: string; reply?: string;
      }>({
        featureSlug: "ai_review_reply",
        tenantId: req.user?.tenantId ?? null,
        restaurantId,
        userId: req.user?.sub ?? null,
        metadata: { tone, externalReviewId },
      }, {
        messages: [{ role: "user", content: prompt }],
        temperature: 0.6,
        maxTokens: 600,
      });

      const reply = typeof data.reply === "string" ? data.reply.trim() : "";
      if (!reply) {
        if (reservation) await refundReservation(reservation, "empty reply");
        return void res.status(502).json({ error: "AI returned an empty reply" });
      }

      const sentiment = ["positive", "neutral", "negative", "angry"].includes(String(data.sentiment))
        ? String(data.sentiment) : "neutral";
      const category = ["food", "staff", "delivery", "hygiene", "pricing", "other"].includes(String(data.category))
        ? String(data.category) : "other";

      // Persist as a draft so the owner can edit + post later.
      const [draft] = await db.insert(reviewRepliesTable).values({
        externalReviewId,
        restaurantId,
        reviewSnapshot: reviewBody.slice(0, 4000),
        tone,
        draftReply: reply,
        status: "draft",
        createdBy: req.user?.sub ?? null,
      }).returning();

      // Update the external review with the detected sentiment/category for filtering.
      if (externalReviewId) {
        await db.update(externalReviewsTable)
          .set({ sentiment, category })
          .where(eq(externalReviewsTable.id, externalReviewId));
      }

      if (reservation) await commitReservation({ reservation, requestLogId: result.requestLogId, userId: req.user?.sub ?? null });

      res.json({ draft, sentiment, category, model: result.model });
    } catch (err) {
      if (reservation) await refundReservation(reservation, err instanceof Error ? err.message : "ai error");
      const msg = err instanceof Error ? err.message : "AI generation failed";
      res.status(502).json({ error: msg });
    }
  },
);

router.patch("/restaurants/:restaurantId/reviews/replies/:replyId", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const replyId = Number(req.params.replyId);
  const [existing] = await db.select().from(reviewRepliesTable)
    .where(and(eq(reviewRepliesTable.id, replyId), eq(reviewRepliesTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const update: Partial<typeof reviewRepliesTable.$inferInsert> = { updatedAt: new Date() };
  if (typeof b.finalReply === "string") {
    update.finalReply = b.finalReply.slice(0, 4000);
    update.status = "edited";
  }
  if (b.status && ["draft", "edited", "posted", "discarded"].includes(String(b.status))) {
    update.status = String(b.status);
  }
  if (b.status === "posted") {
    update.postedAt = new Date();
    update.postedBy = req.user?.sub ?? null;
    update.postedTo = typeof b.postedTo === "string" ? b.postedTo : "copy";
  }
  const [row] = await db.update(reviewRepliesTable).set(update).where(eq(reviewRepliesTable.id, replyId)).returning();
  await recordAuditLog({
    req, module: "khana_ai", action: `review_reply.${row.status}`,
    entity: "review_reply", entityId: replyId, restaurantId, targetRestaurantId: restaurantId,
    oldValue: { status: existing.status }, newValue: { status: row.status, postedTo: row.postedTo ?? null },
  });
  res.json(row);
});

router.get("/restaurants/:restaurantId/reviews/replies", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
  const rows = await db.select().from(reviewRepliesTable)
    .where(eq(reviewRepliesTable.restaurantId, restaurantId))
    .orderBy(desc(reviewRepliesTable.createdAt))
    .limit(limit);
  res.json(rows);
});

// ─── Negative feedback recovery queue ────────────────────────────────────────

router.get("/restaurants/:restaurantId/reviews/recovery", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const conds = [eq(feedbackRecoveryTasksTable.restaurantId, restaurantId)];
  if (status && ["new", "contacted", "resolved", "ignored"].includes(status)) {
    conds.push(eq(feedbackRecoveryTasksTable.status, status));
  }
  const rows = await db.select({
    task: feedbackRecoveryTasksTable,
    assigneeName: usersTable.name,
    feedback: customerFeedbackTable,
    externalReview: externalReviewsTable,
  }).from(feedbackRecoveryTasksTable)
    .leftJoin(usersTable, eq(usersTable.id, feedbackRecoveryTasksTable.assignedTo))
    .leftJoin(customerFeedbackTable, eq(customerFeedbackTable.id, feedbackRecoveryTasksTable.feedbackId))
    .leftJoin(externalReviewsTable, eq(externalReviewsTable.id, feedbackRecoveryTasksTable.externalReviewId))
    .where(and(...conds))
    .orderBy(desc(feedbackRecoveryTasksTable.createdAt))
    .limit(500);
  res.json(rows);
});

router.post(
  "/restaurants/:restaurantId/reviews/recovery/analyze/:feedbackId",
  requireAiCredits("ai_feedback_analysis", () => ({ units: 1 })),
  async (req: Request, res: Response) => {
    const restaurantId = Number(req.params.restaurantId);
    const sourceId = Number(req.params.feedbackId);
    const sourceKind = req.query.source === "external" ? "external" : "feedback";
    const reservation = res.locals.aiCreditReservation as AiCreditReservation | null;

    let rating: number | null = null;
    let comment = "";
    let initialCategory: string | null = null;
    if (sourceKind === "external") {
      const [ex] = await db.select().from(externalReviewsTable)
        .where(and(eq(externalReviewsTable.id, sourceId), eq(externalReviewsTable.restaurantId, restaurantId)));
      if (!ex) {
        if (reservation) await refundReservation(reservation, "external review not found");
        return void res.status(404).json({ error: "External review not found" });
      }
      rating = ex.rating;
      comment = ex.body;
      initialCategory = ex.category;
    } else {
      const [fb] = await db.select().from(customerFeedbackTable)
        .where(and(eq(customerFeedbackTable.id, sourceId), eq(customerFeedbackTable.restaurantId, restaurantId)));
      if (!fb) {
        if (reservation) await refundReservation(reservation, "feedback not found");
        return void res.status(404).json({ error: "Feedback not found" });
      }
      rating = fb.rating;
      comment = fb.comment ?? "";
      initialCategory = fb.category;
    }

    const prompt = `You are helping a restaurant manager respond to a low-rated customer feedback.

Rating: ${rating ?? "?"}/5
Category: ${initialCategory ?? "unspecified"}
Comment: "${comment.slice(0, 2000)}"

Return ONLY JSON: {
  "sentiment": "negative" | "angry" | "neutral",
  "category": "food" | "staff" | "delivery" | "hygiene" | "pricing" | "other",
  "summary": "<one-sentence summary of the complaint>",
  "suggestedResponse": "<2–3 sentence empathetic response the manager can personalise>",
  "suggestedCompensation": "apology" | "discount" | "dessert" | "callback" | "refund_review"
}`;

    try {
      const { data, result } = await AIProviderService.generateJson<{
        sentiment?: string; category?: string; summary?: string;
        suggestedResponse?: string; suggestedCompensation?: string;
      }>({
        featureSlug: "ai_feedback_analysis",
        tenantId: req.user?.tenantId ?? null,
        restaurantId,
        userId: req.user?.sub ?? null,
        metadata: { sourceKind, sourceId },
      }, {
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        maxTokens: 500,
      });

      const sentiment = ["positive", "neutral", "negative", "angry"].includes(String(data.sentiment)) ? String(data.sentiment) : "negative";
      const category = ["food", "staff", "delivery", "hygiene", "pricing", "other"].includes(String(data.category)) ? String(data.category) : (initialCategory ?? "other");
      const compensation = ["apology", "discount", "dessert", "callback", "refund_review"].includes(String(data.suggestedCompensation)) ? String(data.suggestedCompensation) : "apology";

      // Upsert: one open task per source row. If a task already exists,
      // refresh its AI fields rather than creating duplicates.
      const [existing] = await db.select().from(feedbackRecoveryTasksTable)
        .where(and(
          eq(feedbackRecoveryTasksTable.restaurantId, restaurantId),
          sourceKind === "external"
            ? eq(feedbackRecoveryTasksTable.externalReviewId, sourceId)
            : eq(feedbackRecoveryTasksTable.feedbackId, sourceId),
        ));
      let task;
      if (existing) {
        const [updated] = await db.update(feedbackRecoveryTasksTable).set({
          sentiment, category,
          aiSummary: typeof data.summary === "string" ? data.summary.slice(0, 500) : null,
          suggestedResponse: typeof data.suggestedResponse === "string" ? data.suggestedResponse.slice(0, 1500) : null,
          suggestedCompensation: compensation,
          updatedAt: new Date(),
        }).where(eq(feedbackRecoveryTasksTable.id, existing.id)).returning();
        task = updated;
      } else {
        const [created] = await db.insert(feedbackRecoveryTasksTable).values({
          restaurantId,
          feedbackId: sourceKind === "feedback" ? sourceId : null,
          externalReviewId: sourceKind === "external" ? sourceId : null,
          category,
          sentiment,
          aiSummary: typeof data.summary === "string" ? data.summary.slice(0, 500) : null,
          suggestedResponse: typeof data.suggestedResponse === "string" ? data.suggestedResponse.slice(0, 1500) : null,
          suggestedCompensation: compensation,
          status: "new",
        }).returning();
        task = created;
        await recordAuditLog({
          req, module: "khana_ai", action: "recovery_task.create",
          entity: "feedback_recovery_task", entityId: task.id, restaurantId, targetRestaurantId: restaurantId,
          newValue: { sourceKind, sourceId, sentiment, category },
        });
      }

      if (reservation) await commitReservation({ reservation, requestLogId: result.requestLogId, userId: req.user?.sub ?? null });
      res.json({ task });
    } catch (err) {
      if (reservation) await refundReservation(reservation, err instanceof Error ? err.message : "ai error");
      const msg = err instanceof Error ? err.message : "AI analysis failed";
      res.status(502).json({ error: msg });
    }
  },
);

router.patch("/restaurants/:restaurantId/reviews/recovery/:taskId", async (req: Request, res: Response) => {
  const restaurantId = Number(req.params.restaurantId);
  const taskId = Number(req.params.taskId);
  const [existing] = await db.select().from(feedbackRecoveryTasksTable)
    .where(and(eq(feedbackRecoveryTasksTable.id, taskId), eq(feedbackRecoveryTasksTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const update: Partial<typeof feedbackRecoveryTasksTable.$inferInsert> = { updatedAt: new Date() };
  if (b.status && ["new", "contacted", "resolved", "ignored"].includes(String(b.status))) {
    update.status = String(b.status);
    if (b.status === "resolved") {
      update.resolvedAt = new Date();
      update.resolvedBy = req.user?.sub ?? null;
    }
  }
  if (b.assignedTo !== undefined) update.assignedTo = b.assignedTo == null ? null : Number(b.assignedTo);
  if (typeof b.resolutionNotes === "string") update.resolutionNotes = b.resolutionNotes.slice(0, 2000);
  if (typeof b.suggestedCompensation === "string") update.suggestedCompensation = b.suggestedCompensation;
  const [row] = await db.update(feedbackRecoveryTasksTable).set(update).where(eq(feedbackRecoveryTasksTable.id, taskId)).returning();
  await recordAuditLog({
    req, module: "khana_ai", action: `recovery_task.${row.status}`,
    entity: "feedback_recovery_task", entityId: taskId, restaurantId, targetRestaurantId: restaurantId,
    oldValue: { status: existing.status }, newValue: update,
  });
  res.json(row);
});

export default router;
