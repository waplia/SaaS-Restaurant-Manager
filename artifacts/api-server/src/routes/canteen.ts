/**
 * Canteen module API (Task #203).
 *
 * Endpoints, all under /api/restaurants/:restaurantId/canteen/...
 *
 *   STUDENTS         GET/POST /students                    list/create
 *                    GET/PATCH/DELETE /students/:id        manage one student
 *                    POST  /students/:id/regenerate-qr     rotate QR token
 *                    GET   /students/:id/history           wallet + orders
 *                    GET   /students/:id/restrictions      list per-student bans
 *                    POST  /students/:id/restrictions      add ban
 *                    DELETE /students/:id/restrictions/:rid
 *
 *   GUARDIANS        GET   /students/:id/guardians
 *                    POST  /students/:id/guardians
 *                    DELETE /guardians/:gid
 *                    POST  /guardians/:gid/regenerate-token
 *
 *   WALLET           POST  /students/:id/wallet/recharge   credit (manual or
 *                                                          gateway-recorded)
 *                    POST  /students/:id/wallet/adjust     admin adjust
 *
 *   RESTRICTIONS     GET/POST /restrictions                restaurant-wide bans
 *                    DELETE  /restrictions/:rid
 *
 *   MEAL PLANS       GET/POST /meal-plans
 *                    PATCH/DELETE /meal-plans/:id
 *                    GET/POST /meal-plan-subs              subscribe student
 *                    DELETE   /meal-plan-subs/:sid
 *
 *   POS COUNTER      GET  /pos/lookup?qr=...               find student
 *                    POST /pos/orders                      place order with
 *                                                          atomic enforcement
 *
 *   REPORTS          GET  /reports/monthly?month=YYYY-MM   JSON summary
 *                    GET  /reports/monthly.csv?month=...
 *
 * Public parent endpoints (no JWT, mounted on a separate router):
 *   GET  /api/canteen/parent/:token                       student snapshot
 *   GET  /api/canteen/parent/:token/history               txns + orders
 *   POST /api/canteen/parent/:token/recharge              record gateway-paid
 *                                                         top-up (intent only;
 *                                                         actual gateway capture
 *                                                         lands via the existing
 *                                                         /api/razorpay etc.)
 */
import { Router } from "express";
import { eq, and, desc, sql, gte, lte, inArray } from "drizzle-orm";
import { randomBytes, randomUUID } from "crypto";
import {
  db,
  studentsTable,
  studentGuardiansTable,
  studentWalletTxnsTable,
  studentRestrictionsTable,
  canteenItemRestrictionsTable,
  canteenMealPlansTable,
  canteenMealPlanSubsTable,
  canteenOrdersTable,
  canteenOrderItemsTable,
  menuItemsTable,
  menuCategoriesTable,
  restaurantsTable,
  usersTable,
  insertStudentSchema,
  insertGuardianSchema,
  insertCanteenMealPlanSchema,
  type Student,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { z } from "zod/v4";
import { logger } from "../lib/logger";
import { sendEmail } from "../lib/notifications";
import { sendSmsMessage } from "../lib/smsSender";
import { sendWhatsAppMessage } from "../lib/whatsapp";

const ADMIN_ROLES = ["owner", "manager", "canteen_admin", "super_admin"] as const;
const COUNTER_ROLES = ["owner", "manager", "cashier", "counter_staff", "canteen_admin", "super_admin"] as const;
const VIEW_ROLES = ["owner", "manager", "cashier", "waiter", "kitchen", "counter_staff", "canteen_admin", "parent", "super_admin"] as const;

const newToken = (prefix: string) => `${prefix}_${randomBytes(16).toString("hex")}`;
const idemKey = () => `cnt_${randomUUID()}`;

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadStudent(restaurantId: number, id: number): Promise<Student | null> {
  const [s] = await db.select().from(studentsTable)
    .where(and(eq(studentsTable.id, id), eq(studentsTable.restaurantId, restaurantId)));
  return s ?? null;
}

async function todaysSpend(studentId: number): Promise<number> {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [row] = await db.select({
    sum: sql<number>`COALESCE(SUM(${studentWalletTxnsTable.amount}), 0)::bigint`,
  }).from(studentWalletTxnsTable).where(and(
    eq(studentWalletTxnsTable.studentId, studentId),
    eq(studentWalletTxnsTable.direction, "debit"),
    eq(studentWalletTxnsTable.type, "order_payment"),
    gte(studentWalletTxnsTable.createdAt, start),
  ));
  return Number(row?.sum ?? 0);
}

interface RestrictionSet {
  blockedItemIds: Set<number>;
  blockedCategoryIds: Set<number>;
}

async function loadRestrictions(restaurantId: number, student: Student): Promise<RestrictionSet> {
  const studentRows = await db.select().from(studentRestrictionsTable)
    .where(eq(studentRestrictionsTable.studentId, student.id));
  const globalRows = await db.select().from(canteenItemRestrictionsTable)
    .where(eq(canteenItemRestrictionsTable.restaurantId, restaurantId));
  const blockedItemIds = new Set<number>();
  const blockedCategoryIds = new Set<number>();
  for (const r of studentRows) {
    if (r.scope === "item" && r.menuItemId) blockedItemIds.add(r.menuItemId);
    if (r.scope === "category" && r.categoryId) blockedCategoryIds.add(r.categoryId);
  }
  for (const r of globalRows) {
    if (r.appliesToClass && r.appliesToClass !== student.className) continue;
    if (r.scope === "item" && r.menuItemId) blockedItemIds.add(r.menuItemId);
    if (r.scope === "category" && r.categoryId) blockedCategoryIds.add(r.categoryId);
  }
  return { blockedItemIds, blockedCategoryIds };
}

async function notifyGuardians(studentId: number, subject: string, body: string): Promise<void> {
  const guardians = await db.select().from(studentGuardiansTable)
    .where(eq(studentGuardiansTable.studentId, studentId));
  for (const g of guardians) {
    if (g.notifyEmail && g.email) {
      sendEmail({ to: g.email, subject, html: `<p>${body}</p>`, text: body })
        .catch(err => logger.warn({ err }, "[canteen] guardian email failed"));
    }
    if (g.notifySms && g.phone) {
      sendSmsMessage({ to: g.phone, body: `${subject}: ${body}` })
        .catch(err => logger.warn({ err }, "[canteen] guardian sms failed"));
    }
    if (g.notifyWhatsapp && g.phone) {
      sendWhatsAppMessage({ restaurantId: null, to: g.phone, body: `${subject}\n${body}`, skipQuota: true })
        .catch(err => logger.warn({ err }, "[canteen] guardian whatsapp failed"));
    }
  }
}

// ─── Authenticated router (mounted under /api after JWT gate) ──────────────

const router = Router();

router.use(
  "/restaurants/:restaurantId/canteen",
  requireRole(...VIEW_ROLES),
  validateRestaurantAccess,
);

// STUDENTS ------------------------------------------------------------------
router.get("/restaurants/:restaurantId/canteen/students", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const q = (req.query.q as string | undefined)?.toLowerCase();
  const rows = await db.select().from(studentsTable)
    .where(eq(studentsTable.restaurantId, restaurantId))
    .orderBy(desc(studentsTable.createdAt));
  const filtered = q ? rows.filter(r =>
    r.name.toLowerCase().includes(q) || r.studentCode.toLowerCase().includes(q)
    || (r.className?.toLowerCase().includes(q) ?? false)
  ) : rows;
  res.json(filtered);
});

router.post("/restaurants/:restaurantId/canteen/students", requireRole(...ADMIN_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const tenantId = req.user!.tenantId!;
  const parsed = insertStudentSchema.safeParse({ ...req.body, restaurantId, tenantId });
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.issues }); return; }
  try {
    const [row] = await db.insert(studentsTable).values({
      ...parsed.data,
      qrToken: newToken("stu"),
    }).returning();
    res.status(201).json(row);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "create failed";
    res.status(400).json({ error: msg });
  }
});

router.get("/restaurants/:restaurantId/canteen/students/:id", async (req, res) => {
  const s = await loadStudent(Number(req.params.restaurantId), Number(req.params.id));
  if (!s) { res.status(404).json({ error: "Student not found" }); return; }
  res.json(s);
});

router.patch("/restaurants/:restaurantId/canteen/students/:id", requireRole(...ADMIN_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const update = insertStudentSchema.partial().omit({ restaurantId: true, tenantId: true }).safeParse(req.body);
  if (!update.success) { res.status(400).json({ error: "Invalid input", details: update.error.issues }); return; }
  const [row] = await db.update(studentsTable).set({ ...update.data, updatedAt: new Date() })
    .where(and(eq(studentsTable.id, id), eq(studentsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Student not found" }); return; }
  res.json(row);
});

router.delete("/restaurants/:restaurantId/canteen/students/:id", requireRole(...ADMIN_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  await db.update(studentsTable).set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(studentsTable.id, id), eq(studentsTable.restaurantId, restaurantId)));
  res.json({ ok: true });
});

router.post("/restaurants/:restaurantId/canteen/students/:id/regenerate-qr", requireRole(...ADMIN_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [row] = await db.update(studentsTable).set({ qrToken: newToken("stu"), updatedAt: new Date() })
    .where(and(eq(studentsTable.id, id), eq(studentsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Student not found" }); return; }
  res.json(row);
});

router.get("/restaurants/:restaurantId/canteen/students/:id/history", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const student = await loadStudent(restaurantId, id);
  if (!student) { res.status(404).json({ error: "Student not found" }); return; }
  const txns = await db.select().from(studentWalletTxnsTable)
    .where(eq(studentWalletTxnsTable.studentId, id))
    .orderBy(desc(studentWalletTxnsTable.createdAt)).limit(200);
  const orders = await db.select().from(canteenOrdersTable)
    .where(eq(canteenOrdersTable.studentId, id))
    .orderBy(desc(canteenOrdersTable.createdAt)).limit(100);
  const orderIds = orders.map(o => o.id);
  const items = orderIds.length
    ? await db.select().from(canteenOrderItemsTable).where(inArray(canteenOrderItemsTable.orderId, orderIds))
    : [];
  res.json({ student, txns, orders, items });
});

// PER-STUDENT RESTRICTIONS --------------------------------------------------
router.get("/restaurants/:restaurantId/canteen/students/:id/restrictions", async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(studentRestrictionsTable).where(eq(studentRestrictionsTable.studentId, id));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/canteen/students/:id/restrictions", requireRole(...ADMIN_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const studentId = Number(req.params.id);
  const schema = z.object({
    scope: z.enum(["item", "category"]),
    menuItemId: z.number().int().positive().optional(),
    categoryId: z.number().int().positive().optional(),
    reason: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [row] = await db.insert(studentRestrictionsTable).values({
    studentId, restaurantId,
    scope: parsed.data.scope,
    menuItemId: parsed.data.scope === "item" ? parsed.data.menuItemId ?? null : null,
    categoryId: parsed.data.scope === "category" ? parsed.data.categoryId ?? null : null,
    reason: parsed.data.reason ?? null,
  }).returning();
  res.status(201).json(row);
});

router.delete("/restaurants/:restaurantId/canteen/students/:id/restrictions/:rid", requireRole(...ADMIN_ROLES), async (req, res) => {
  await db.delete(studentRestrictionsTable).where(eq(studentRestrictionsTable.id, Number(req.params.rid)));
  res.json({ ok: true });
});

// GUARDIANS -----------------------------------------------------------------
router.get("/restaurants/:restaurantId/canteen/students/:id/guardians", async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(studentGuardiansTable).where(eq(studentGuardiansTable.studentId, id));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/canteen/students/:id/guardians", requireRole(...ADMIN_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const studentId = Number(req.params.id);
  const parsed = insertGuardianSchema.safeParse({ ...req.body, studentId, restaurantId });
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.issues }); return; }
  const [row] = await db.insert(studentGuardiansTable).values({
    ...parsed.data,
    parentToken: newToken("par"),
  }).returning();
  res.status(201).json(row);
});

router.delete("/restaurants/:restaurantId/canteen/guardians/:gid", requireRole(...ADMIN_ROLES), async (req, res) => {
  await db.delete(studentGuardiansTable).where(eq(studentGuardiansTable.id, Number(req.params.gid)));
  res.json({ ok: true });
});

router.post("/restaurants/:restaurantId/canteen/guardians/:gid/regenerate-token", requireRole(...ADMIN_ROLES), async (req, res) => {
  const [row] = await db.update(studentGuardiansTable).set({ parentToken: newToken("par") })
    .where(eq(studentGuardiansTable.id, Number(req.params.gid))).returning();
  if (!row) { res.status(404).json({ error: "Guardian not found" }); return; }
  res.json(row);
});

// WALLET --------------------------------------------------------------------
const rechargeSchema = z.object({
  amountPaise: z.number().int().positive(),
  channel: z.string().default("manual"),
  externalRef: z.string().optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

router.post("/restaurants/:restaurantId/canteen/students/:id/wallet/recharge", requireRole(...COUNTER_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const studentId = Number(req.params.id);
  const parsed = rechargeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.issues }); return; }
  const idem = parsed.data.idempotencyKey ?? idemKey();

  try {
    const result = await db.transaction(async tx => {
      const [s] = await tx.select().from(studentsTable)
        .where(and(eq(studentsTable.id, studentId), eq(studentsTable.restaurantId, restaurantId)))
        .for("update");
      if (!s) throw Object.assign(new Error("Student not found"), { status: 404 });
      if (s.isFrozen) throw Object.assign(new Error("Student wallet frozen"), { status: 423 });
      const opening = s.balance;
      const closing = opening + parsed.data.amountPaise;
      const [updated] = await tx.update(studentsTable).set({
        balance: closing, lifetimeIn: s.lifetimeIn + parsed.data.amountPaise, updatedAt: new Date(),
      }).where(eq(studentsTable.id, s.id)).returning();
      const [txn] = await tx.insert(studentWalletTxnsTable).values({
        studentId, restaurantId, direction: "credit",
        amount: parsed.data.amountPaise,
        type: "top_up", channel: parsed.data.channel,
        externalRef: parsed.data.externalRef ?? null,
        openingBalance: opening, closingBalance: closing,
        idempotencyKey: idem, createdBy: req.user?.sub ?? null,
        notes: parsed.data.notes ?? null,
      }).returning();
      return { student: updated, txn };
    });
    notifyGuardians(studentId, "Wallet recharged",
      `₹${(parsed.data.amountPaise / 100).toFixed(2)} credited. New balance ₹${(result.student.balance / 100).toFixed(2)}.`);
    res.status(201).json(result);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const msg = err instanceof Error ? err.message : "recharge failed";
    if (msg.includes("idempotency")) { res.status(409).json({ error: "Duplicate idempotency key" }); return; }
    res.status(status).json({ error: msg });
  }
});

router.post("/restaurants/:restaurantId/canteen/students/:id/wallet/adjust", requireRole(...ADMIN_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const studentId = Number(req.params.id);
  const schema = z.object({ deltaPaise: z.number().int(), reason: z.string().min(3) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const result = await db.transaction(async tx => {
    const [s] = await tx.select().from(studentsTable)
      .where(and(eq(studentsTable.id, studentId), eq(studentsTable.restaurantId, restaurantId)))
      .for("update");
    if (!s) throw new Error("Student not found");
    const opening = s.balance;
    const closing = opening + parsed.data.deltaPaise;
    const direction = parsed.data.deltaPaise >= 0 ? "credit" : "debit";
    const [updated] = await tx.update(studentsTable).set({
      balance: closing,
      lifetimeIn: parsed.data.deltaPaise > 0 ? s.lifetimeIn + parsed.data.deltaPaise : s.lifetimeIn,
      lifetimeOut: parsed.data.deltaPaise < 0 ? s.lifetimeOut + Math.abs(parsed.data.deltaPaise) : s.lifetimeOut,
      updatedAt: new Date(),
    }).where(eq(studentsTable.id, s.id)).returning();
    const [txn] = await tx.insert(studentWalletTxnsTable).values({
      studentId, restaurantId, direction,
      amount: Math.abs(parsed.data.deltaPaise),
      type: "adjustment", channel: "manual",
      openingBalance: opening, closingBalance: closing,
      idempotencyKey: idemKey(), createdBy: req.user?.sub ?? null,
      notes: parsed.data.reason,
    }).returning();
    return { student: updated, txn };
  });
  res.json(result);
});

// RESTAURANT-WIDE RESTRICTIONS ---------------------------------------------
router.get("/restaurants/:restaurantId/canteen/restrictions", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(canteenItemRestrictionsTable)
    .where(eq(canteenItemRestrictionsTable.restaurantId, restaurantId));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/canteen/restrictions", requireRole(...ADMIN_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const schema = z.object({
    scope: z.enum(["item", "category"]),
    menuItemId: z.number().int().positive().optional(),
    categoryId: z.number().int().positive().optional(),
    appliesToClass: z.string().optional(),
    reason: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [row] = await db.insert(canteenItemRestrictionsTable).values({
    restaurantId,
    scope: parsed.data.scope,
    menuItemId: parsed.data.scope === "item" ? parsed.data.menuItemId ?? null : null,
    categoryId: parsed.data.scope === "category" ? parsed.data.categoryId ?? null : null,
    appliesToClass: parsed.data.appliesToClass ?? null,
    reason: parsed.data.reason ?? null,
  }).returning();
  res.status(201).json(row);
});

router.delete("/restaurants/:restaurantId/canteen/restrictions/:rid", requireRole(...ADMIN_ROLES), async (req, res) => {
  await db.delete(canteenItemRestrictionsTable).where(eq(canteenItemRestrictionsTable.id, Number(req.params.rid)));
  res.json({ ok: true });
});

// MEAL PLANS ---------------------------------------------------------------
router.get("/restaurants/:restaurantId/canteen/meal-plans", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(canteenMealPlansTable)
    .where(eq(canteenMealPlansTable.restaurantId, restaurantId))
    .orderBy(desc(canteenMealPlansTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/canteen/meal-plans", requireRole(...ADMIN_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = insertCanteenMealPlanSchema.safeParse({ ...req.body, restaurantId });
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.issues }); return; }
  const [row] = await db.insert(canteenMealPlansTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/canteen/meal-plans/:id", requireRole(...ADMIN_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const update = insertCanteenMealPlanSchema.partial().omit({ restaurantId: true }).safeParse(req.body);
  if (!update.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [row] = await db.update(canteenMealPlansTable).set({ ...update.data, updatedAt: new Date() })
    .where(and(eq(canteenMealPlansTable.id, id), eq(canteenMealPlansTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Plan not found" }); return; }
  res.json(row);
});

router.delete("/restaurants/:restaurantId/canteen/meal-plans/:id", requireRole(...ADMIN_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  await db.update(canteenMealPlansTable).set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(canteenMealPlansTable.id, Number(req.params.id)), eq(canteenMealPlansTable.restaurantId, restaurantId)));
  res.json({ ok: true });
});

router.get("/restaurants/:restaurantId/canteen/meal-plan-subs", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const studentId = req.query.studentId ? Number(req.query.studentId) : undefined;
  const cond = studentId
    ? and(eq(canteenMealPlanSubsTable.restaurantId, restaurantId), eq(canteenMealPlanSubsTable.studentId, studentId))
    : eq(canteenMealPlanSubsTable.restaurantId, restaurantId);
  const rows = await db.select({
    id: canteenMealPlanSubsTable.id,
    studentId: canteenMealPlanSubsTable.studentId,
    planId: canteenMealPlanSubsTable.planId,
    status: canteenMealPlanSubsTable.status,
    startDate: canteenMealPlanSubsTable.startDate,
    endDate: canteenMealPlanSubsTable.endDate,
    studentName: studentsTable.name,
    planName: canteenMealPlansTable.name,
    monthlyPrice: canteenMealPlansTable.monthlyPrice,
  }).from(canteenMealPlanSubsTable)
    .leftJoin(studentsTable, eq(studentsTable.id, canteenMealPlanSubsTable.studentId))
    .leftJoin(canteenMealPlansTable, eq(canteenMealPlansTable.id, canteenMealPlanSubsTable.planId))
    .where(cond);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/canteen/meal-plan-subs", requireRole(...ADMIN_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const schema = z.object({
    studentId: z.number().int().positive(),
    planId: z.number().int().positive(),
    startDate: z.string(),
    endDate: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [row] = await db.insert(canteenMealPlanSubsTable).values({
    restaurantId,
    studentId: parsed.data.studentId,
    planId: parsed.data.planId,
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate ?? null,
  }).returning();
  res.status(201).json(row);
});

router.delete("/restaurants/:restaurantId/canteen/meal-plan-subs/:sid", requireRole(...ADMIN_ROLES), async (req, res) => {
  await db.update(canteenMealPlanSubsTable).set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(canteenMealPlanSubsTable.id, Number(req.params.sid)));
  res.json({ ok: true });
});

// COUNTER POS ---------------------------------------------------------------
router.get("/restaurants/:restaurantId/canteen/pos/lookup", requireRole(...COUNTER_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const qr = String(req.query.qr ?? "").trim();
  if (!qr) { res.status(400).json({ error: "qr required" }); return; }
  const [s] = await db.select().from(studentsTable)
    .where(and(eq(studentsTable.qrToken, qr), eq(studentsTable.restaurantId, restaurantId)));
  if (!s) { res.status(404).json({ error: "Student not found for QR" }); return; }
  const restrictions = await loadRestrictions(restaurantId, s);
  const spent = await todaysSpend(s.id);
  const [restaurant] = await db.select({
    canteenDefaultDailyCap: restaurantsTable.canteenDefaultDailyCap,
    canteenLowBalanceThreshold: restaurantsTable.canteenLowBalanceThreshold,
  }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  const dailyCap = s.dailyCap ?? restaurant?.canteenDefaultDailyCap ?? 0;
  res.json({
    student: s,
    todaysSpend: spent,
    dailyCap,
    remainingDaily: dailyCap > 0 ? Math.max(0, dailyCap - spent) : null,
    blockedItemIds: Array.from(restrictions.blockedItemIds),
    blockedCategoryIds: Array.from(restrictions.blockedCategoryIds),
  });
});

const placeOrderSchema = z.object({
  studentId: z.number().int().positive(),
  paymentSource: z.enum(["wallet", "cash"]).default("wallet"),
  counterName: z.string().optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().optional(),
  items: z.array(z.object({
    menuItemId: z.number().int().positive(),
    quantity: z.number().int().positive(),
  })).min(1),
});

router.post("/restaurants/:restaurantId/canteen/pos/orders", requireRole(...COUNTER_ROLES), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = placeOrderSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.issues }); return; }

  const student = await loadStudent(restaurantId, parsed.data.studentId);
  if (!student) { res.status(404).json({ error: "Student not found" }); return; }
  if (!student.isActive) { res.status(400).json({ error: "Student is inactive" }); return; }
  if (student.isFrozen) { res.status(423).json({ error: "Student wallet is frozen" }); return; }

  // Resolve menu items + price.
  const menuIds = parsed.data.items.map(i => i.menuItemId);
  const items = await db.select().from(menuItemsTable)
    .where(and(eq(menuItemsTable.restaurantId, restaurantId), inArray(menuItemsTable.id, menuIds)));
  const itemMap = new Map(items.map(i => [i.id, i]));
  const restrictions = await loadRestrictions(restaurantId, student);

  // Pre-flight: validate every line, check restrictions.
  const lines: Array<{ id: number; name: string; unitPaise: number; qty: number; categoryId: number }> = [];
  for (const it of parsed.data.items) {
    const m = itemMap.get(it.menuItemId);
    if (!m) { res.status(400).json({ error: `Menu item ${it.menuItemId} not found` }); return; }
    if (!m.isAvailable) { res.status(400).json({ error: `${m.name} is unavailable` }); return; }
    if (restrictions.blockedItemIds.has(m.id) || restrictions.blockedCategoryIds.has(m.categoryId)) {
      res.status(403).json({ error: `Restricted item: ${m.name}`, code: "ITEM_RESTRICTED" });
      return;
    }
    lines.push({
      id: m.id, name: m.name, unitPaise: Math.round(parseFloat(m.price) * 100),
      qty: it.quantity, categoryId: m.categoryId,
    });
  }
  const total = lines.reduce((sum, l) => sum + l.unitPaise * l.qty, 0);

  // Daily cap enforcement (wallet payments only; cash bypasses cap).
  if (parsed.data.paymentSource === "wallet") {
    const [restaurant] = await db.select({
      cap: restaurantsTable.canteenDefaultDailyCap,
      lowThr: restaurantsTable.canteenLowBalanceThreshold,
    }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
    const cap = student.dailyCap ?? restaurant?.cap ?? 0;
    if (cap > 0) {
      const spent = await todaysSpend(student.id);
      if (spent + total > cap) {
        res.status(403).json({
          error: `Daily cap exceeded (₹${(cap / 100).toFixed(2)} limit, ₹${(spent / 100).toFixed(2)} spent today)`,
          code: "DAILY_CAP_EXCEEDED",
        });
        return;
      }
    }
  }

  const idem = parsed.data.idempotencyKey ?? idemKey();
  const orderNumber = `CNT-${Date.now().toString().slice(-8)}-${Math.floor(Math.random() * 1000)}`;

  try {
    const result = await db.transaction(async tx => {
      let walletTxnId: number | null = null;
      let updatedBalance: number = student.balance;
      if (parsed.data.paymentSource === "wallet") {
        const [s] = await tx.select().from(studentsTable).where(eq(studentsTable.id, student.id)).for("update");
        if (!s) throw Object.assign(new Error("Student missing"), { status: 404 });
        if (s.balance < total) {
          throw Object.assign(new Error(`Insufficient balance: ₹${(s.balance / 100).toFixed(2)} < ₹${(total / 100).toFixed(2)}`), {
            status: 422, code: "INSUFFICIENT_FUNDS",
          });
        }
        const opening = s.balance;
        const closing = opening - total;
        const [updated] = await tx.update(studentsTable).set({
          balance: closing, lifetimeOut: s.lifetimeOut + total, updatedAt: new Date(),
        }).where(eq(studentsTable.id, s.id)).returning();
        updatedBalance = updated.balance;
        const [txn] = await tx.insert(studentWalletTxnsTable).values({
          studentId: s.id, restaurantId, direction: "debit",
          amount: total, type: "order_payment", channel: "wallet",
          referenceType: "canteen_order",
          openingBalance: opening, closingBalance: closing,
          idempotencyKey: idem, createdBy: req.user?.sub ?? null,
          notes: `Canteen order ${orderNumber}`,
        }).returning();
        walletTxnId = txn.id;
      }

      const [order] = await tx.insert(canteenOrdersTable).values({
        restaurantId, studentId: student.id, orderNumber, total,
        paymentSource: parsed.data.paymentSource,
        walletTxnId, status: "completed",
        createdBy: req.user?.sub ?? null,
        counterName: parsed.data.counterName ?? null,
        notes: parsed.data.notes ?? null,
      }).returning();

      await tx.insert(canteenOrderItemsTable).values(lines.map(l => ({
        orderId: order.id, restaurantId, menuItemId: l.id,
        itemName: l.name, unitPrice: l.unitPaise, quantity: l.qty,
        lineTotal: l.unitPaise * l.qty,
      })));

      // Link wallet txn back to order id for traceability.
      if (walletTxnId) {
        await tx.update(studentWalletTxnsTable).set({ referenceId: order.id })
          .where(eq(studentWalletTxnsTable.id, walletTxnId));
      }
      return { order, lines, balance: updatedBalance };
    });

    // Low balance + receipt notifications (best-effort, post-commit).
    const [r] = await db.select({
      lowThr: restaurantsTable.canteenLowBalanceThreshold,
    }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
    const threshold = student.lowBalanceThreshold ?? r?.lowThr ?? 5000;
    if (parsed.data.paymentSource === "wallet" && result.balance < threshold) {
      notifyGuardians(student.id, "Low canteen wallet balance",
        `${student.name}'s balance is ₹${(result.balance / 100).toFixed(2)}. Please recharge.`);
    } else {
      notifyGuardians(student.id, "Canteen purchase",
        `${student.name} bought ${lines.length} item(s) for ₹${(total / 100).toFixed(2)}. Order ${orderNumber}.`);
    }

    res.status(201).json(result);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const msg = err instanceof Error ? err.message : "order failed";
    const code = (err as { code?: string }).code;
    res.status(status).json({ error: msg, code });
  }
});

// REPORTS -------------------------------------------------------------------
async function buildMonthlyReport(restaurantId: number, month: string) {
  const [year, mo] = month.split("-").map(Number);
  if (!year || !mo) throw new Error("month must be YYYY-MM");
  const start = new Date(Date.UTC(year, mo - 1, 1));
  const end = new Date(Date.UTC(year, mo, 1));
  const orders = await db.select({
    id: canteenOrdersTable.id,
    orderNumber: canteenOrdersTable.orderNumber,
    studentId: canteenOrdersTable.studentId,
    total: canteenOrdersTable.total,
    paymentSource: canteenOrdersTable.paymentSource,
    createdAt: canteenOrdersTable.createdAt,
    studentName: studentsTable.name,
    studentCode: studentsTable.studentCode,
    className: studentsTable.className,
  }).from(canteenOrdersTable)
    .leftJoin(studentsTable, eq(studentsTable.id, canteenOrdersTable.studentId))
    .where(and(
      eq(canteenOrdersTable.restaurantId, restaurantId),
      gte(canteenOrdersTable.createdAt, start),
      lte(canteenOrdersTable.createdAt, end),
    ))
    .orderBy(canteenOrdersTable.createdAt);
  const txns = await db.select().from(studentWalletTxnsTable)
    .where(and(
      eq(studentWalletTxnsTable.restaurantId, restaurantId),
      gte(studentWalletTxnsTable.createdAt, start),
      lte(studentWalletTxnsTable.createdAt, end),
    ));
  const totalSales = orders.reduce((s, o) => s + Number(o.total), 0);
  const totalRecharges = txns.filter(t => t.type === "top_up").reduce((s, t) => s + Number(t.amount), 0);
  const orderCount = orders.length;
  return { month, orders, txns, totalSales, totalRecharges, orderCount };
}

router.get("/restaurants/:restaurantId/canteen/reports/monthly", requireRole(...ADMIN_ROLES), async (req, res) => {
  const month = (req.query.month as string) ?? new Date().toISOString().slice(0, 7);
  try {
    const data = await buildMonthlyReport(Number(req.params.restaurantId), month);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "report failed" });
  }
});

router.get("/restaurants/:restaurantId/canteen/reports/monthly.csv", requireRole(...ADMIN_ROLES), async (req, res) => {
  const month = (req.query.month as string) ?? new Date().toISOString().slice(0, 7);
  try {
    const data = await buildMonthlyReport(Number(req.params.restaurantId), month);
    const lines = ["orderNumber,date,studentCode,studentName,className,paymentSource,totalRupees"];
    for (const o of data.orders) {
      lines.push([
        o.orderNumber,
        new Date(o.createdAt).toISOString(),
        (o.studentCode ?? "").replace(/,/g, " "),
        (o.studentName ?? "").replace(/,/g, " "),
        (o.className ?? "").replace(/,/g, " "),
        o.paymentSource,
        (Number(o.total) / 100).toFixed(2),
      ].join(","));
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="canteen-report-${month}.csv"`);
    res.send(lines.join("\n"));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "report failed" });
  }
});

// ─── Public parent router (no JWT) ─────────────────────────────────────────

export const canteenPublicRouter: Router = Router();

async function loadByParentToken(token: string): Promise<{
  guardian: typeof studentGuardiansTable.$inferSelect;
  student: Student;
} | null> {
  const [g] = await db.select().from(studentGuardiansTable)
    .where(eq(studentGuardiansTable.parentToken, token));
  if (!g) return null;
  const [s] = await db.select().from(studentsTable).where(eq(studentsTable.id, g.studentId));
  if (!s) return null;
  return { guardian: g, student: s };
}

canteenPublicRouter.get("/canteen/parent/:token", async (req, res) => {
  const ctx = await loadByParentToken(req.params.token);
  if (!ctx) { res.status(404).json({ error: "Invalid parent token" }); return; }
  const guardians = await db.select({
    id: studentGuardiansTable.id, name: studentGuardiansTable.name,
    relation: studentGuardiansTable.relation, isPrimary: studentGuardiansTable.isPrimary,
  }).from(studentGuardiansTable).where(eq(studentGuardiansTable.studentId, ctx.student.id));
  res.json({ student: ctx.student, guardian: ctx.guardian, guardians });
});

canteenPublicRouter.get("/canteen/parent/:token/history", async (req, res) => {
  const ctx = await loadByParentToken(req.params.token);
  if (!ctx) { res.status(404).json({ error: "Invalid parent token" }); return; }
  const txns = await db.select().from(studentWalletTxnsTable)
    .where(eq(studentWalletTxnsTable.studentId, ctx.student.id))
    .orderBy(desc(studentWalletTxnsTable.createdAt)).limit(100);
  const orders = await db.select().from(canteenOrdersTable)
    .where(eq(canteenOrdersTable.studentId, ctx.student.id))
    .orderBy(desc(canteenOrdersTable.createdAt)).limit(50);
  res.json({ txns, orders });
});

// Records a parent-initiated recharge. The actual money capture is expected
// to land via the existing payment-gateway webhook flows; this endpoint only
// exists for cases where the gateway settles inline (e.g. UPI deep-link).
const parentRechargeSchema = z.object({
  amountPaise: z.number().int().positive(),
  channel: z.enum(["razorpay", "cashfree", "stripe", "upi", "manual"]),
  externalRef: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

canteenPublicRouter.post("/canteen/parent/:token/recharge", async (req, res) => {
  const ctx = await loadByParentToken(req.params.token);
  if (!ctx) { res.status(404).json({ error: "Invalid parent token" }); return; }
  const parsed = parentRechargeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.issues }); return; }
  const idem = parsed.data.idempotencyKey ?? idemKey();
  try {
    const result = await db.transaction(async tx => {
      const [s] = await tx.select().from(studentsTable).where(eq(studentsTable.id, ctx.student.id)).for("update");
      if (!s) throw new Error("Student missing");
      if (s.isFrozen) throw Object.assign(new Error("Wallet frozen"), { status: 423 });
      const opening = s.balance;
      const closing = opening + parsed.data.amountPaise;
      const [updated] = await tx.update(studentsTable).set({
        balance: closing, lifetimeIn: s.lifetimeIn + parsed.data.amountPaise, updatedAt: new Date(),
      }).where(eq(studentsTable.id, s.id)).returning();
      const [txn] = await tx.insert(studentWalletTxnsTable).values({
        studentId: s.id, restaurantId: s.restaurantId, direction: "credit",
        amount: parsed.data.amountPaise, type: "top_up", channel: parsed.data.channel,
        externalRef: parsed.data.externalRef ?? null,
        openingBalance: opening, closingBalance: closing,
        idempotencyKey: idem, notes: `Parent recharge by ${ctx.guardian.name}`,
      }).returning();
      return { student: updated, txn };
    });
    notifyGuardians(ctx.student.id, "Wallet recharged",
      `₹${(parsed.data.amountPaise / 100).toFixed(2)} added. Balance ₹${(result.student.balance / 100).toFixed(2)}.`);
    res.status(201).json(result);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    res.status(status).json({ error: err instanceof Error ? err.message : "recharge failed" });
  }
});

export default router;
