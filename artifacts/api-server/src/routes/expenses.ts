import { Router } from "express";
import { eq, and, gte, lte, desc, count, sql, ilike, or, inArray } from "drizzle-orm";
import {
  db,
  expenseCategoriesTable,
  expensesTable,
  recurringExpensesTable,
  pnlSettingsTable,
  EXPENSE_CATEGORY_KINDS,
  EXPENSE_STATUSES,
  type ExpenseCategoryKind,
  type ExpenseStatus,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getObjectAclPolicy } from "../lib/objectAcl";
import { recordAuditLog } from "../lib/audit";

const _objectStorage = new ObjectStorageService();

async function assertReceiptUrlOwnership(
  restaurantId: number,
  receiptUrl: unknown,
): Promise<void> {
  if (receiptUrl == null || receiptUrl === "") return;
  if (typeof receiptUrl !== "string" || !receiptUrl.startsWith("/objects/")) {
    throw new Error("invalid_receipt_url");
  }
  try {
    const file = await _objectStorage.getObjectEntityFile(receiptUrl);
    const acl = await getObjectAclPolicy(file);
    if (!acl || acl.restaurantId !== String(restaurantId)) {
      throw new Error("invalid_receipt_url");
    }
  } catch (err) {
    if (err instanceof ObjectNotFoundError) throw new Error("invalid_receipt_url");
    throw err;
  }
}

const router = Router();

router.use("/restaurants/:restaurantId", requireRole("owner", "manager", "super_admin"), validateRestaurantAccess, requirePlanFeature("expense_tracking"));

const DEFAULT_CATEGORIES: Array<{ name: string; color: string; icon: string; categoryKind: ExpenseCategoryKind }> = [
  { name: "Rent",        color: "#ef4444", icon: "building", categoryKind: "fixed" },
  { name: "Salaries",    color: "#3b82f6", icon: "users",    categoryKind: "fixed" },
  { name: "Utilities",   color: "#eab308", icon: "zap",      categoryKind: "variable" },
  { name: "Supplies",    color: "#22c55e", icon: "package",  categoryKind: "cogs" },
  { name: "Maintenance", color: "#a855f7", icon: "wrench",   categoryKind: "variable" },
  { name: "Marketing",   color: "#ec4899", icon: "sparkles", categoryKind: "marketing" },
  { name: "Misc",        color: "#64748b", icon: "receipt",  categoryKind: "other" },
];

async function ensureDefaultCategories(restaurantId: number) {
  const existing = await db.select().from(expenseCategoriesTable).where(eq(expenseCategoriesTable.restaurantId, restaurantId));
  if (existing.length > 0) return existing;
  const inserted = await db.insert(expenseCategoriesTable).values(
    DEFAULT_CATEGORIES.map(c => ({ ...c, restaurantId })),
  ).returning();
  return inserted;
}

export async function seedDefaultExpenseCategories(restaurantId: number): Promise<void> {
  await db.insert(expenseCategoriesTable).values(
    DEFAULT_CATEGORIES.map(c => ({ ...c, restaurantId })),
  ).onConflictDoNothing();
}

function advanceDate(d: Date, frequency: string, dayOfMonth?: number | null): Date {
  const next = new Date(d);
  if (frequency === "daily") {
    next.setDate(next.getDate() + 1);
  } else if (frequency === "weekly") {
    next.setDate(next.getDate() + 7);
  } else if (frequency === "yearly") {
    next.setFullYear(next.getFullYear() + 1);
  } else {
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    const targetDay = dayOfMonth && dayOfMonth >= 1 && dayOfMonth <= 31 ? dayOfMonth : d.getDate();
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(targetDay, lastDay));
  }
  return next;
}

async function loadCategoryForRestaurant(restaurantId: number, categoryId: number) {
  const [cat] = await db.select().from(expenseCategoriesTable)
    .where(and(eq(expenseCategoriesTable.id, categoryId), eq(expenseCategoriesTable.restaurantId, restaurantId)))
    .limit(1);
  return cat ?? null;
}

/**
 * Smart P&L approval threshold lookup. Owners and super_admins always
 * auto-approve their own submissions; everyone else is gated by the
 * configured amount (default ₹5,000).
 */
async function getApprovalThreshold(restaurantId: number): Promise<number> {
  const [s] = await db.select({ t: pnlSettingsTable.approvalThreshold })
    .from(pnlSettingsTable)
    .where(eq(pnlSettingsTable.restaurantId, restaurantId))
    .limit(1);
  return s ? Number(s.t) : 5000;
}

export async function generateDueRecurringExpenses(restaurantId: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const lockKey = 0x45780000 | (restaurantId & 0xffff);
  let created = 0;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${lockKey})`);
    const templates = await tx.select().from(recurringExpensesTable).where(and(
      eq(recurringExpensesTable.restaurantId, restaurantId),
      eq(recurringExpensesTable.isActive, true),
      lte(recurringExpensesTable.nextRunDate, todayStr),
    ));
    // Pre-load categories for kind snapshotting.
    const cats = templates.length === 0 ? [] : await tx.select().from(expenseCategoriesTable)
      .where(inArray(expenseCategoriesTable.id, templates.map(t => t.categoryId)));
    const kindByCat = new Map(cats.map(c => [c.id, c.categoryKind as ExpenseCategoryKind]));
    for (const t of templates) {
      let next = new Date(t.nextRunDate);
      while (next <= today) {
        const inserted = await tx.insert(expensesTable).values({
          restaurantId,
          categoryId: t.categoryId,
          amount: t.amount,
          expenseDate: next.toISOString().slice(0, 10),
          payee: t.payee,
          paymentMethod: t.paymentMethod,
          notes: t.notes ? `[Auto] ${t.notes}` : `[Auto] ${t.name}`,
          recurringTemplateId: t.id,
          // Recurring expenses bypass approval — they were already vetted
          // when the template was created.
          status: "approved",
          expenseType: kindByCat.get(t.categoryId) ?? "other",
          approvedAt: new Date(),
        }).onConflictDoNothing().returning({ id: expensesTable.id });
        if (inserted.length > 0) created++;
        next = advanceDate(next, t.frequency, t.dayOfMonth);
      }
      await tx.update(recurringExpensesTable).set({
        nextRunDate: next.toISOString().slice(0, 10),
        updatedAt: new Date(),
      }).where(eq(recurringExpensesTable.id, t.id));
    }
  });
  return created;
}

// ===== Categories =====
router.get("/restaurants/:restaurantId/expense-categories", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const cats = await ensureDefaultCategories(restaurantId);
  res.json(cats);
});

router.post("/restaurants/:restaurantId/expense-categories", async (req, res) => {
  const { name, color, icon, categoryKind } = req.body;
  if (!name) return void res.status(400).json({ error: "name required" });
  const kind: ExpenseCategoryKind = (EXPENSE_CATEGORY_KINDS as readonly string[]).includes(String(categoryKind))
    ? categoryKind as ExpenseCategoryKind
    : "other";
  const [cat] = await db.insert(expenseCategoriesTable).values({
    restaurantId: Number(req.params.restaurantId), name, color, icon, categoryKind: kind,
  }).returning();
  await recordAuditLog({
    req, module: "expenses", action: "category.create", entity: "expense_category",
    entityId: cat.id, targetRestaurantId: cat.restaurantId,
    newValue: { name: cat.name, categoryKind: cat.categoryKind },
  });
  res.status(201).json(cat);
});

router.patch("/restaurants/:restaurantId/expense-categories/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { name, color, icon, isActive, categoryKind } = req.body;
  const updates: Record<string, unknown> = { name, color, icon, isActive };
  if (categoryKind !== undefined) {
    if (!(EXPENSE_CATEGORY_KINDS as readonly string[]).includes(String(categoryKind))) {
      return void res.status(400).json({ error: `categoryKind must be one of ${EXPENSE_CATEGORY_KINDS.join(", ")}` });
    }
    updates.categoryKind = categoryKind;
  }
  const [updated] = await db.update(expenseCategoriesTable).set(updates)
    .where(and(eq(expenseCategoriesTable.id, Number(req.params.id)), eq(expenseCategoriesTable.restaurantId, restaurantId)))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({
    req, module: "expenses", action: "category.update", entity: "expense_category",
    entityId: updated.id, targetRestaurantId: restaurantId,
    newValue: { name: updated.name, categoryKind: updated.categoryKind, isActive: updated.isActive },
  });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/expense-categories/:id", async (req, res) => {
  await db.update(expenseCategoriesTable).set({ isActive: false })
    .where(and(eq(expenseCategoriesTable.id, Number(req.params.id)), eq(expenseCategoriesTable.restaurantId, Number(req.params.restaurantId))));
  res.status(204).send();
});

// ===== Expenses =====
router.get("/restaurants/:restaurantId/expenses", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  await ensureDefaultCategories(restaurantId);
  await generateDueRecurringExpenses(restaurantId);

  const { from, to, categoryId, search, page, limit, status, branchId } = req.query;
  const pg = Math.max(1, Number(page) || 1);
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  const offset = (pg - 1) * lim;

  const conditions: Parameters<typeof and>[0][] = [eq(expensesTable.restaurantId, restaurantId)];
  if (from) conditions.push(gte(expensesTable.expenseDate, String(from)));
  if (to) conditions.push(lte(expensesTable.expenseDate, String(to)));
  if (categoryId) conditions.push(eq(expensesTable.categoryId, Number(categoryId)));
  if (search) conditions.push(or(ilike(expensesTable.payee, `%${search}%`), ilike(expensesTable.notes, `%${search}%`)) as Parameters<typeof and>[0]);
  if (status && (EXPENSE_STATUSES as readonly string[]).includes(String(status))) {
    conditions.push(eq(expensesTable.status, String(status)));
  }
  if (branchId) conditions.push(eq(expensesTable.branchId, Number(branchId)));

  const where = and(...conditions);
  const [rows, totalRows, totalAmount] = await Promise.all([
    db.select().from(expensesTable).where(where).orderBy(desc(expensesTable.expenseDate), desc(expensesTable.id)).limit(lim).offset(offset),
    db.select({ count: count() }).from(expensesTable).where(where),
    db.select({ sum: sql<string>`coalesce(sum(${expensesTable.amount}), 0)::text` }).from(expensesTable).where(where),
  ]);

  const total = totalRows[0]?.count ?? 0;
  res.json({
    data: rows,
    total,
    totalAmount: totalAmount[0]?.sum ?? "0",
    page: pg,
    limit: lim,
    totalPages: Math.max(1, Math.ceil(total / lim)),
  });
});

router.post("/restaurants/:restaurantId/expenses", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { categoryId, amount, expenseDate, payee, paymentMethod, notes, receiptUrl, branchId } = req.body;
  if (!categoryId || !amount || !expenseDate) return void res.status(400).json({ error: "categoryId, amount, expenseDate required" });
  const cat = await loadCategoryForRestaurant(restaurantId, Number(categoryId));
  if (!cat) return void res.status(400).json({ error: "Invalid categoryId" });
  try {
    await assertReceiptUrlOwnership(restaurantId, receiptUrl);
  } catch {
    return void res.status(400).json({ error: "Invalid receiptUrl: must be a finalized object owned by this restaurant" });
  }

  const numAmount = Number(amount);
  const threshold = await getApprovalThreshold(restaurantId);
  const isPrivileged = req.user?.role === "owner" || req.user?.isSuperAdmin;
  const requiresApproval = !isPrivileged && Number.isFinite(numAmount) && numAmount >= threshold;
  const status: ExpenseStatus = requiresApproval ? "pending" : "approved";

  const [exp] = await db.insert(expensesTable).values({
    restaurantId,
    branchId: branchId == null ? null : Number(branchId),
    categoryId: Number(categoryId),
    amount: String(amount),
    expenseDate: String(expenseDate),
    payee, paymentMethod, notes, receiptUrl,
    createdBy: req.user?.sub,
    status,
    expenseType: cat.categoryKind as ExpenseCategoryKind,
    approvedAt: status === "approved" ? new Date() : null,
    approvedByUserId: status === "approved" ? (req.user?.sub ?? null) : null,
  }).returning();

  await recordAuditLog({
    req, module: "expenses", action: requiresApproval ? "expense.submit" : "expense.create",
    entity: "expense", entityId: exp.id, targetRestaurantId: restaurantId,
    newValue: { amount: exp.amount, categoryId: exp.categoryId, status: exp.status, expenseType: exp.expenseType },
  });
  res.status(201).json(exp);
});

router.patch("/restaurants/:restaurantId/expenses/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { categoryId, amount, expenseDate, payee, paymentMethod, notes, receiptUrl, branchId } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (categoryId !== undefined) {
    const cat = await loadCategoryForRestaurant(restaurantId, Number(categoryId));
    if (!cat) return void res.status(400).json({ error: "Invalid categoryId" });
    updates.categoryId = Number(categoryId);
    updates.expenseType = cat.categoryKind;
  }
  if (amount !== undefined) updates.amount = String(amount);
  if (expenseDate !== undefined) updates.expenseDate = String(expenseDate);
  if (payee !== undefined) updates.payee = payee;
  if (paymentMethod !== undefined) updates.paymentMethod = paymentMethod;
  if (notes !== undefined) updates.notes = notes;
  if (branchId !== undefined) updates.branchId = branchId == null ? null : Number(branchId);
  if (receiptUrl !== undefined) {
    try {
      await assertReceiptUrlOwnership(restaurantId, receiptUrl);
    } catch {
      return void res.status(400).json({ error: "Invalid receiptUrl: must be a finalized object owned by this restaurant" });
    }
    updates.receiptUrl = receiptUrl;
  }
  const [updated] = await db.update(expensesTable).set(updates)
    .where(and(eq(expensesTable.id, Number(req.params.id)), eq(expensesTable.restaurantId, restaurantId)))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  await recordAuditLog({
    req, module: "expenses", action: "expense.update", entity: "expense", entityId: updated.id,
    targetRestaurantId: restaurantId, newValue: updates,
  });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/expenses/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const result = await db.delete(expensesTable)
    .where(and(eq(expensesTable.id, id), eq(expensesTable.restaurantId, restaurantId)))
    .returning({ id: expensesTable.id });
  if (result.length > 0) {
    await recordAuditLog({
      req, module: "expenses", action: "expense.delete", entity: "expense", entityId: id,
      targetRestaurantId: restaurantId,
    });
  }
  res.status(204).send();
});

// ===== Approval workflow (Smart P&L) =====
async function decideExpense(
  req: Parameters<Parameters<typeof router.post>[1]>[0],
  res: Parameters<Parameters<typeof router.post>[1]>[1],
  decision: "approved" | "rejected",
) {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { reason } = (req.body ?? {}) as { reason?: string };
  if (decision === "rejected" && !reason) {
    return void res.status(400).json({ error: "reason required when rejecting" });
  }
  const [existing] = await db.select().from(expensesTable)
    .where(and(eq(expensesTable.id, id), eq(expensesTable.restaurantId, restaurantId)))
    .limit(1);
  if (!existing) return void res.status(404).json({ error: "Not found" });
  if (existing.status !== "pending") {
    return void res.status(409).json({ error: `Expense already ${existing.status}` });
  }
  // Self-approval guard: the submitter may never approve / reject their own
  // expense, even if they hold an approver role. Owners and super_admins
  // are still bound by this rule per task spec.
  if (existing.createdBy != null && req.user?.sub === existing.createdBy) {
    return void res.status(403).json({ error: "You cannot approve your own expense" });
  }
  const [updated] = await db.update(expensesTable).set({
    status: decision,
    approvedByUserId: req.user?.sub ?? null,
    approvedAt: decision === "approved" ? new Date() : null,
    rejectionReason: decision === "rejected" ? (reason ?? null) : null,
    updatedAt: new Date(),
  }).where(eq(expensesTable.id, id)).returning();
  await recordAuditLog({
    req, module: "expenses", action: decision === "approved" ? "expense.approve" : "expense.reject",
    entity: "expense", entityId: id, targetRestaurantId: restaurantId,
    oldValue: { status: existing.status },
    newValue: { status: decision, reason: decision === "rejected" ? reason : undefined },
  });
  res.json(updated);
}

router.post("/restaurants/:restaurantId/expenses/:id/approve", (req, res) => decideExpense(req, res, "approved"));
router.post("/restaurants/:restaurantId/expenses/:id/reject",  (req, res) => decideExpense(req, res, "rejected"));

// ===== Recurring =====
router.get("/restaurants/:restaurantId/recurring-expenses", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  await generateDueRecurringExpenses(restaurantId);
  const rows = await db.select().from(recurringExpensesTable).where(eq(recurringExpensesTable.restaurantId, restaurantId)).orderBy(desc(recurringExpensesTable.createdAt));
  res.json(rows);
});

const ALLOWED_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
function normalizeFrequency(v: unknown): typeof ALLOWED_FREQUENCIES[number] | null {
  return (ALLOWED_FREQUENCIES as readonly string[]).includes(String(v)) ? v as typeof ALLOWED_FREQUENCIES[number] : null;
}
function normalizeDayOfMonth(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 31) return null;
  return n;
}
function isValidDateStr(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime());
}

router.post("/restaurants/:restaurantId/recurring-expenses", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { name, categoryId, amount, frequency, dayOfMonth, payee, paymentMethod, notes, nextRunDate } = req.body;
  if (!name || !categoryId || !amount) return void res.status(400).json({ error: "name, categoryId, amount required" });
  const cat = await loadCategoryForRestaurant(restaurantId, Number(categoryId));
  if (!cat) return void res.status(400).json({ error: "Invalid categoryId" });
  const freq = normalizeFrequency(frequency ?? "monthly");
  if (!freq) return void res.status(400).json({ error: `frequency must be one of ${ALLOWED_FREQUENCIES.join(", ")}` });
  const dom = dayOfMonth === undefined || dayOfMonth === null ? 1 : normalizeDayOfMonth(dayOfMonth);
  if (dom === null) return void res.status(400).json({ error: "dayOfMonth must be an integer 1-31" });
  const startDate = nextRunDate ?? new Date().toISOString().slice(0, 10);
  if (!isValidDateStr(startDate)) return void res.status(400).json({ error: "nextRunDate must be YYYY-MM-DD" });
  const [tpl] = await db.insert(recurringExpensesTable).values({
    restaurantId,
    name, categoryId: Number(categoryId), amount: String(amount),
    frequency: freq,
    dayOfMonth: dom,
    payee, paymentMethod, notes,
    nextRunDate: startDate,
  }).returning();
  res.status(201).json(tpl);
});

router.patch("/restaurants/:restaurantId/recurring-expenses/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { name, categoryId, amount, frequency, dayOfMonth, payee, paymentMethod, notes, nextRunDate, isActive } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (categoryId !== undefined) {
    const cat = await loadCategoryForRestaurant(restaurantId, Number(categoryId));
    if (!cat) return void res.status(400).json({ error: "Invalid categoryId" });
    updates.categoryId = Number(categoryId);
  }
  if (amount !== undefined) updates.amount = String(amount);
  if (frequency !== undefined) {
    const freq = normalizeFrequency(frequency);
    if (!freq) return void res.status(400).json({ error: `frequency must be one of ${ALLOWED_FREQUENCIES.join(", ")}` });
    updates.frequency = freq;
  }
  if (dayOfMonth !== undefined) {
    const dom = normalizeDayOfMonth(dayOfMonth);
    if (dom === null) return void res.status(400).json({ error: "dayOfMonth must be an integer 1-31" });
    updates.dayOfMonth = dom;
  }
  if (payee !== undefined) updates.payee = payee;
  if (paymentMethod !== undefined) updates.paymentMethod = paymentMethod;
  if (notes !== undefined) updates.notes = notes;
  if (nextRunDate !== undefined) {
    if (!isValidDateStr(nextRunDate)) return void res.status(400).json({ error: "nextRunDate must be YYYY-MM-DD" });
    updates.nextRunDate = nextRunDate;
  }
  if (isActive !== undefined) updates.isActive = isActive;
  const [updated] = await db.update(recurringExpensesTable).set(updates)
    .where(and(eq(recurringExpensesTable.id, Number(req.params.id)), eq(recurringExpensesTable.restaurantId, restaurantId)))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/recurring-expenses/:id", async (req, res) => {
  await db.delete(recurringExpensesTable)
    .where(and(eq(recurringExpensesTable.id, Number(req.params.id)), eq(recurringExpensesTable.restaurantId, Number(req.params.restaurantId))));
  res.status(204).send();
});

// ===== Summary for reports / dashboard =====
// Restricted to APPROVED expenses so pending submissions don't pollute the
// numbers shown on the dashboard or in the P&L.
router.get("/restaurants/:restaurantId/expenses/summary", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { from, to } = req.query;
  const conditions: Parameters<typeof and>[0][] = [
    eq(expensesTable.restaurantId, restaurantId),
    eq(expensesTable.status, "approved"),
  ];
  if (from) conditions.push(gte(expensesTable.expenseDate, String(from)));
  if (to) conditions.push(lte(expensesTable.expenseDate, String(to)));
  const where = and(...conditions);

  const [totalRow, byCat] = await Promise.all([
    db.select({ sum: sql<string>`coalesce(sum(${expensesTable.amount}), 0)::text` }).from(expensesTable).where(where),
    db.select({
      categoryId: expensesTable.categoryId,
      categoryName: expenseCategoriesTable.name,
      color: expenseCategoriesTable.color,
      total: sql<string>`coalesce(sum(${expensesTable.amount}), 0)::text`,
      count: count(),
    }).from(expensesTable).innerJoin(expenseCategoriesTable, eq(expensesTable.categoryId, expenseCategoriesTable.id))
      .where(where).groupBy(expensesTable.categoryId, expenseCategoriesTable.name, expenseCategoriesTable.color),
  ]);

  res.json({
    total: totalRow[0]?.sum ?? "0",
    byCategory: byCat,
  });
});

export default router;
