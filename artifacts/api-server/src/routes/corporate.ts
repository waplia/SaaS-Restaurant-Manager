import { Router } from "express";
import { eq, and, desc, gte, lte, sql, inArray, isNull, or } from "drizzle-orm";
import {
  db,
  corporateCompaniesTable,
  corporateDepartmentsTable,
  corporateEmployeesTable,
  corporateMenuOverridesTable,
  corporateOrderLinksTable,
  corporateApprovalsTable,
  corporateBulkOrdersTable,
  corporateBulkOrderItemsTable,
  corporateScheduledOrdersTable,
  corporateScheduledSkipsTable,
  corporateInvoicesTable,
  corporateInvoiceLinesTable,
  corporateInvoicePaymentsTable,
  ordersTable,
  customersTable,
  notificationsTable,
  insertCorporateCompanySchema,
  insertCorporateDepartmentSchema,
  insertCorporateEmployeeSchema,
  insertCorporateMenuOverrideSchema,
  insertCorporateBulkOrderSchema,
  insertCorporateScheduledOrderSchema,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { z } from "zod/v4";
import crypto from "crypto";

const router = Router();

router.use(
  "/restaurants/:restaurantId",
  requireRole("owner", "manager", "cashier", "super_admin"),
  validateRestaurantAccess,
);

const STAFF = ["owner", "manager", "super_admin"] as const;

// ─── COMPANIES ────────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/corporate/companies", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(corporateCompaniesTable)
    .where(eq(corporateCompaniesTable.restaurantId, restaurantId))
    .orderBy(desc(corporateCompaniesTable.createdAt));
  res.json(rows);
});

router.get("/restaurants/:restaurantId/corporate/companies/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [company] = await db.select().from(corporateCompaniesTable)
    .where(and(eq(corporateCompaniesTable.id, id), eq(corporateCompaniesTable.restaurantId, restaurantId)));
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  // Aggregate stats: outstanding balance, monthly spend
  const [outstanding] = await db.select({
    total: sql<string>`COALESCE(SUM(${corporateInvoicesTable.totalAmount} - ${corporateInvoicesTable.amountPaid}), 0)`,
  }).from(corporateInvoicesTable)
    .where(and(eq(corporateInvoicesTable.companyId, id), inArray(corporateInvoicesTable.status, ["sent", "partially_paid", "overdue"])));
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [monthly] = await db.select({
    total: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)`,
    count: sql<number>`COUNT(*)::int`,
  }).from(corporateOrderLinksTable)
    .innerJoin(ordersTable, eq(ordersTable.id, corporateOrderLinksTable.orderId))
    .where(and(eq(corporateOrderLinksTable.companyId, id), gte(ordersTable.createdAt, monthStart)));
  res.json({ ...company, outstandingBalance: outstanding?.total ?? "0", monthSpend: monthly?.total ?? "0", monthOrderCount: monthly?.count ?? 0 });
});

router.post("/restaurants/:restaurantId/corporate/companies", requireRole(...STAFF), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = insertCorporateCompanySchema.safeParse({ ...req.body, restaurantId });
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.issues }); return; }
  const [row] = await db.insert(corporateCompaniesTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/corporate/companies/:id", requireRole(...STAFF), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const update = insertCorporateCompanySchema.partial().omit({ restaurantId: true }).safeParse(req.body);
  if (!update.success) { res.status(400).json({ error: "Invalid input", details: update.error.issues }); return; }
  const [row] = await db.update(corporateCompaniesTable)
    .set({ ...update.data, updatedAt: new Date() })
    .where(and(eq(corporateCompaniesTable.id, id), eq(corporateCompaniesTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/restaurants/:restaurantId/corporate/companies/:id", requireRole(...STAFF), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  await db.update(corporateCompaniesTable).set({ status: "inactive", updatedAt: new Date() })
    .where(and(eq(corporateCompaniesTable.id, id), eq(corporateCompaniesTable.restaurantId, restaurantId)));
  res.json({ ok: true });
});

// ─── DEPARTMENTS ─────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/corporate/companies/:companyId/departments", async (req, res) => {
  const companyId = Number(req.params.companyId);
  const rows = await db.select().from(corporateDepartmentsTable)
    .where(eq(corporateDepartmentsTable.companyId, companyId))
    .orderBy(corporateDepartmentsTable.name);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/corporate/companies/:companyId/departments", requireRole(...STAFF), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const companyId = Number(req.params.companyId);
  const parsed = insertCorporateDepartmentSchema.safeParse({ ...req.body, restaurantId, companyId });
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.issues }); return; }
  const [row] = await db.insert(corporateDepartmentsTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/corporate/departments/:id", requireRole(...STAFF), async (req, res) => {
  const id = Number(req.params.id);
  const restaurantId = Number(req.params.restaurantId);
  const update = insertCorporateDepartmentSchema.partial().omit({ restaurantId: true, companyId: true }).safeParse(req.body);
  if (!update.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [row] = await db.update(corporateDepartmentsTable).set(update.data)
    .where(and(eq(corporateDepartmentsTable.id, id), eq(corporateDepartmentsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/restaurants/:restaurantId/corporate/departments/:id", requireRole(...STAFF), async (req, res) => {
  const id = Number(req.params.id);
  const restaurantId = Number(req.params.restaurantId);
  await db.update(corporateDepartmentsTable).set({ isActive: false })
    .where(and(eq(corporateDepartmentsTable.id, id), eq(corporateDepartmentsTable.restaurantId, restaurantId)));
  res.json({ ok: true });
});

// ─── EMPLOYEES ───────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/corporate/companies/:companyId/employees", async (req, res) => {
  const companyId = Number(req.params.companyId);
  const rows = await db.select({
    id: corporateEmployeesTable.id,
    name: corporateEmployeesTable.name,
    email: corporateEmployeesTable.email,
    phone: corporateEmployeesTable.phone,
    employeeCode: corporateEmployeesTable.employeeCode,
    role: corporateEmployeesTable.role,
    perMealLimit: corporateEmployeesTable.perMealLimit,
    monthlyLimit: corporateEmployeesTable.monthlyLimit,
    isActive: corporateEmployeesTable.isActive,
    departmentId: corporateEmployeesTable.departmentId,
    departmentName: corporateDepartmentsTable.name,
    customerId: corporateEmployeesTable.customerId,
  }).from(corporateEmployeesTable)
    .leftJoin(corporateDepartmentsTable, eq(corporateDepartmentsTable.id, corporateEmployeesTable.departmentId))
    .where(eq(corporateEmployeesTable.companyId, companyId))
    .orderBy(corporateEmployeesTable.name);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/corporate/companies/:companyId/employees", requireRole(...STAFF), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const companyId = Number(req.params.companyId);
  const parsed = insertCorporateEmployeeSchema.safeParse({ ...req.body, restaurantId, companyId });
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.issues }); return; }
  // Auto-create or link customer record so the employee can place orders
  let customerId = parsed.data.customerId ?? null;
  if (!customerId && (parsed.data.email || parsed.data.phone)) {
    const conds = [eq(customersTable.restaurantId, restaurantId)];
    if (parsed.data.phone) conds.push(eq(customersTable.phone, parsed.data.phone));
    else if (parsed.data.email) conds.push(eq(customersTable.email, parsed.data.email));
    const [existing] = await db.select().from(customersTable).where(and(...conds));
    if (existing) customerId = existing.id;
    else {
      const [created] = await db.insert(customersTable).values({
        restaurantId,
        name: parsed.data.name,
        email: parsed.data.email ?? null,
        phone: parsed.data.phone ?? null,
      }).returning();
      customerId = created.id;
    }
  }
  const [row] = await db.insert(corporateEmployeesTable).values({ ...parsed.data, customerId }).returning();
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/corporate/employees/:id", requireRole(...STAFF), async (req, res) => {
  const id = Number(req.params.id);
  const restaurantId = Number(req.params.restaurantId);
  const update = insertCorporateEmployeeSchema.partial().omit({ restaurantId: true, companyId: true }).safeParse(req.body);
  if (!update.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [row] = await db.update(corporateEmployeesTable).set({ ...update.data, updatedAt: new Date() })
    .where(and(eq(corporateEmployeesTable.id, id), eq(corporateEmployeesTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/restaurants/:restaurantId/corporate/employees/:id", requireRole(...STAFF), async (req, res) => {
  const id = Number(req.params.id);
  const restaurantId = Number(req.params.restaurantId);
  await db.update(corporateEmployeesTable).set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(corporateEmployeesTable.id, id), eq(corporateEmployeesTable.restaurantId, restaurantId)));
  res.json({ ok: true });
});

// CSV bulk import: { rows: [{name,email,phone,departmentId,perMealLimit,monthlyLimit}] }
router.post("/restaurants/:restaurantId/corporate/companies/:companyId/employees/bulk", requireRole(...STAFF), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const companyId = Number(req.params.companyId);
  const schema = z.object({ rows: z.array(z.object({
    name: z.string().min(1),
    email: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    departmentId: z.number().optional().nullable(),
    perMealLimit: z.string().optional().nullable(),
    monthlyLimit: z.string().optional().nullable(),
    employeeCode: z.string().optional().nullable(),
  })) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.issues }); return; }
  const created: number[] = [];
  for (const r of parsed.data.rows) {
    const [row] = await db.insert(corporateEmployeesTable).values({
      restaurantId, companyId,
      name: r.name,
      email: r.email ?? null,
      phone: r.phone ?? null,
      departmentId: r.departmentId ?? null,
      perMealLimit: r.perMealLimit ?? null,
      monthlyLimit: r.monthlyLimit ?? null,
      employeeCode: r.employeeCode ?? null,
    }).returning({ id: corporateEmployeesTable.id });
    created.push(row.id);
  }
  res.status(201).json({ created: created.length, ids: created });
});

// ─── MENU OVERRIDES ──────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/corporate/companies/:companyId/menu-overrides", async (req, res) => {
  const companyId = Number(req.params.companyId);
  const rows = await db.select().from(corporateMenuOverridesTable)
    .where(eq(corporateMenuOverridesTable.companyId, companyId));
  res.json(rows);
});

router.put("/restaurants/:restaurantId/corporate/companies/:companyId/menu-overrides", requireRole(...STAFF), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const companyId = Number(req.params.companyId);
  const schema = z.object({ overrides: z.array(z.object({
    menuItemId: z.number(),
    priceOverride: z.string().nullable().optional(),
    isAvailable: z.boolean().optional(),
  })) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  await db.delete(corporateMenuOverridesTable).where(eq(corporateMenuOverridesTable.companyId, companyId));
  if (parsed.data.overrides.length > 0) {
    await db.insert(corporateMenuOverridesTable).values(parsed.data.overrides.map(o => ({
      restaurantId, companyId,
      menuItemId: o.menuItemId,
      priceOverride: o.priceOverride ?? null,
      isAvailable: o.isAvailable ?? true,
    })));
  }
  res.json({ ok: true, count: parsed.data.overrides.length });
});

// ─── BULK ORDERS / CATERING ──────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/corporate/bulk-orders", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { companyId, status } = req.query;
  const conds = [eq(corporateBulkOrdersTable.restaurantId, restaurantId)];
  if (companyId) conds.push(eq(corporateBulkOrdersTable.companyId, Number(companyId)));
  if (status) conds.push(eq(corporateBulkOrdersTable.status, String(status)));
  const rows = await db.select({
    id: corporateBulkOrdersTable.id,
    companyId: corporateBulkOrdersTable.companyId,
    companyName: corporateCompaniesTable.name,
    type: corporateBulkOrdersTable.type,
    title: corporateBulkOrdersTable.title,
    scheduledAt: corporateBulkOrdersTable.scheduledAt,
    headcount: corporateBulkOrdersTable.headcount,
    status: corporateBulkOrdersTable.status,
    quotedAmount: corporateBulkOrdersTable.quotedAmount,
    confirmedAmount: corporateBulkOrdersTable.confirmedAmount,
    deliveryAddress: corporateBulkOrdersTable.deliveryAddress,
    cutoffAt: corporateBulkOrdersTable.cutoffAt,
    shareToken: corporateBulkOrdersTable.shareToken,
  }).from(corporateBulkOrdersTable)
    .leftJoin(corporateCompaniesTable, eq(corporateCompaniesTable.id, corporateBulkOrdersTable.companyId))
    .where(and(...conds))
    .orderBy(desc(corporateBulkOrdersTable.scheduledAt));
  res.json(rows);
});

router.get("/restaurants/:restaurantId/corporate/bulk-orders/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [bulk] = await db.select().from(corporateBulkOrdersTable)
    .where(and(eq(corporateBulkOrdersTable.id, id), eq(corporateBulkOrdersTable.restaurantId, restaurantId)));
  if (!bulk) { res.status(404).json({ error: "Not found" }); return; }
  const items = await db.select().from(corporateBulkOrderItemsTable)
    .where(eq(corporateBulkOrderItemsTable.bulkOrderId, id));
  res.json({ ...bulk, items });
});

router.post("/restaurants/:restaurantId/corporate/bulk-orders", requireRole(...STAFF), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const schema = insertCorporateBulkOrderSchema.extend({
    items: z.array(z.object({
      menuItemId: z.number(),
      menuItemName: z.string(),
      quantity: z.number().min(1),
      unitPrice: z.string(),
      notes: z.string().optional(),
    })).optional(),
  });
  const body = { ...req.body, restaurantId };
  if (typeof body.scheduledAt === "string") body.scheduledAt = new Date(body.scheduledAt);
  if (typeof body.cutoffAt === "string") body.cutoffAt = new Date(body.cutoffAt);
  const parsed = schema.safeParse(body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.issues }); return; }
  const { items, ...bulkData } = parsed.data;
  const shareToken = crypto.randomBytes(12).toString("hex");
  const [bulk] = await db.insert(corporateBulkOrdersTable).values({ ...bulkData, shareToken }).returning();
  if (items?.length) {
    await db.insert(corporateBulkOrderItemsTable).values(items.map(i => ({ ...i, bulkOrderId: bulk.id })));
  }
  res.status(201).json(bulk);
});

router.patch("/restaurants/:restaurantId/corporate/bulk-orders/:id", requireRole(...STAFF), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const update: Record<string, unknown> = { ...req.body, updatedAt: new Date() };
  if (typeof update.scheduledAt === "string") update.scheduledAt = new Date(update.scheduledAt);
  if (typeof update.cutoffAt === "string") update.cutoffAt = new Date(update.cutoffAt);
  delete update.id; delete update.restaurantId; delete update.companyId; delete update.shareToken;
  const [row] = await db.update(corporateBulkOrdersTable).set(update)
    .where(and(eq(corporateBulkOrdersTable.id, id), eq(corporateBulkOrdersTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// Confirm bulk: materialise into a normal order tagged with corporate link
router.post("/restaurants/:restaurantId/corporate/bulk-orders/:id/confirm", requireRole(...STAFF), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [bulk] = await db.select().from(corporateBulkOrdersTable)
    .where(and(eq(corporateBulkOrdersTable.id, id), eq(corporateBulkOrdersTable.restaurantId, restaurantId)));
  if (!bulk) { res.status(404).json({ error: "Not found" }); return; }
  const items = await db.select().from(corporateBulkOrderItemsTable)
    .where(eq(corporateBulkOrderItemsTable.bulkOrderId, id));
  const subtotal = items.reduce((s, i) => s + Number(i.unitPrice) * i.quantity, 0);
  const orderNumber = `CORP-${Date.now()}`;
  const [order] = await db.insert(ordersTable).values({
    restaurantId,
    orderNumber,
    orderType: "delivery",
    status: "confirmed",
    paymentStatus: "unpaid",
    subtotal: subtotal.toFixed(2),
    totalAmount: subtotal.toFixed(2),
    notes: `Bulk: ${bulk.title}`,
  }).returning();
  await db.insert(corporateOrderLinksTable).values({
    restaurantId,
    orderId: order.id,
    companyId: bulk.companyId,
    departmentId: bulk.departmentId,
    source: bulk.type === "catering" ? "catering" : "bulk",
    bulkOrderId: bulk.id,
    approvalStatus: "approved",
  });
  await db.update(corporateBulkOrdersTable).set({
    status: "confirmed",
    confirmedAmount: subtotal.toFixed(2),
    orderId: order.id,
    updatedAt: new Date(),
  }).where(eq(corporateBulkOrdersTable.id, id));
  res.json({ ok: true, order, bulkOrderId: id });
});

// Public-ish per-employee selection on bulk share token (still authenticated for now)
router.post("/restaurants/:restaurantId/corporate/bulk-orders/:id/select", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const schema = z.object({
    employeeId: z.number().optional(),
    selectedByName: z.string().optional(),
    selections: z.array(z.object({ menuItemId: z.number(), menuItemName: z.string(), quantity: z.number(), unitPrice: z.string(), notes: z.string().optional() })),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [bulk] = await db.select().from(corporateBulkOrdersTable)
    .where(and(eq(corporateBulkOrdersTable.id, id), eq(corporateBulkOrdersTable.restaurantId, restaurantId)));
  if (!bulk) { res.status(404).json({ error: "Not found" }); return; }
  if (bulk.cutoffAt && new Date(bulk.cutoffAt) < new Date()) { res.status(400).json({ error: "Cutoff passed" }); return; }
  await db.insert(corporateBulkOrderItemsTable).values(parsed.data.selections.map(s => ({
    bulkOrderId: id,
    menuItemId: s.menuItemId,
    menuItemName: s.menuItemName,
    quantity: s.quantity,
    unitPrice: s.unitPrice,
    notes: s.notes,
    selectedByEmployeeId: parsed.data.employeeId ?? null,
    selectedByName: parsed.data.selectedByName ?? null,
  })));
  res.status(201).json({ ok: true });
});

// ─── SCHEDULED / RECURRING ORDERS ────────────────────────────────────────────
router.get("/restaurants/:restaurantId/corporate/scheduled-orders", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { companyId } = req.query;
  const conds = [eq(corporateScheduledOrdersTable.restaurantId, restaurantId)];
  if (companyId) conds.push(eq(corporateScheduledOrdersTable.companyId, Number(companyId)));
  const rows = await db.select({
    id: corporateScheduledOrdersTable.id,
    companyId: corporateScheduledOrdersTable.companyId,
    companyName: corporateCompaniesTable.name,
    employeeId: corporateScheduledOrdersTable.employeeId,
    employeeName: corporateEmployeesTable.name,
    title: corporateScheduledOrdersTable.title,
    recurrence: corporateScheduledOrdersTable.recurrence,
    weekday: corporateScheduledOrdersTable.weekday,
    scheduledTime: corporateScheduledOrdersTable.scheduledTime,
    startDate: corporateScheduledOrdersTable.startDate,
    endDate: corporateScheduledOrdersTable.endDate,
    nextRunAt: corporateScheduledOrdersTable.nextRunAt,
    lastRunAt: corporateScheduledOrdersTable.lastRunAt,
    status: corporateScheduledOrdersTable.status,
    items: corporateScheduledOrdersTable.items,
    deliveryAddress: corporateScheduledOrdersTable.deliveryAddress,
  }).from(corporateScheduledOrdersTable)
    .leftJoin(corporateCompaniesTable, eq(corporateCompaniesTable.id, corporateScheduledOrdersTable.companyId))
    .leftJoin(corporateEmployeesTable, eq(corporateEmployeesTable.id, corporateScheduledOrdersTable.employeeId))
    .where(and(...conds))
    .orderBy(desc(corporateScheduledOrdersTable.createdAt));
  res.json(rows);
});

function computeNextRun(rec: string, weekday: number | null, time: string, fromDate: Date): Date | null {
  const [hh, mm] = time.split(":").map(Number);
  const next = new Date(fromDate);
  next.setHours(hh || 0, mm || 0, 0, 0);
  if (next <= fromDate) next.setDate(next.getDate() + 1);
  if (rec === "daily") return next;
  if (rec === "daily_weekdays") {
    while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
    return next;
  }
  if (rec === "weekly" && weekday != null) {
    while (next.getDay() !== weekday) next.setDate(next.getDate() + 1);
    return next;
  }
  if (rec === "one_off") return next;
  return next;
}

router.post("/restaurants/:restaurantId/corporate/scheduled-orders", requireRole(...STAFF), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = insertCorporateScheduledOrderSchema.safeParse({ ...req.body, restaurantId });
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.issues }); return; }
  const next = computeNextRun(parsed.data.recurrence ?? "one_off", parsed.data.weekday ?? null, parsed.data.scheduledTime ?? "", new Date());
  const [row] = await db.insert(corporateScheduledOrdersTable).values({ ...parsed.data, nextRunAt: next }).returning();
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/corporate/scheduled-orders/:id", requireRole(...STAFF), async (req, res) => {
  const id = Number(req.params.id);
  const restaurantId = Number(req.params.restaurantId);
  const update: Record<string, unknown> = { ...req.body, updatedAt: new Date() };
  delete update.id; delete update.restaurantId;
  const [row] = await db.update(corporateScheduledOrdersTable).set(update)
    .where(and(eq(corporateScheduledOrdersTable.id, id), eq(corporateScheduledOrdersTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.post("/restaurants/:restaurantId/corporate/scheduled-orders/:id/skip", requireRole(...STAFF), async (req, res) => {
  const id = Number(req.params.id);
  const { skipDate, reason } = req.body as { skipDate: string; reason?: string };
  await db.insert(corporateScheduledSkipsTable).values({ scheduledOrderId: id, skipDate, reason }).onConflictDoNothing();
  res.json({ ok: true });
});

// Materialise due scheduled orders. Idempotent runner; can be called from a cron.
router.post("/restaurants/:restaurantId/corporate/scheduled-orders/run-due", requireRole(...STAFF), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const now = new Date();
  const due = await db.select().from(corporateScheduledOrdersTable)
    .where(and(
      eq(corporateScheduledOrdersTable.restaurantId, restaurantId),
      eq(corporateScheduledOrdersTable.status, "active"),
      lte(corporateScheduledOrdersTable.nextRunAt, now),
    ));
  let materialised = 0;
  for (const sched of due) {
    // Skip if today is in skips
    const today = sched.nextRunAt!.toISOString().slice(0, 10);
    const [skip] = await db.select().from(corporateScheduledSkipsTable)
      .where(and(eq(corporateScheduledSkipsTable.scheduledOrderId, sched.id), eq(corporateScheduledSkipsTable.skipDate, today)));
    if (!skip) {
      const subtotal = sched.items.reduce((s, i) => s + Number(i.unitPrice) * i.quantity, 0);
      const [order] = await db.insert(ordersTable).values({
        restaurantId,
        orderNumber: `CORP-S${sched.id}-${Date.now()}`,
        orderType: "delivery",
        status: "confirmed",
        paymentStatus: "unpaid",
        subtotal: subtotal.toFixed(2),
        totalAmount: subtotal.toFixed(2),
        notes: `Scheduled: ${sched.title}`,
      }).returning();
      await db.insert(corporateOrderLinksTable).values({
        restaurantId,
        orderId: order.id,
        companyId: sched.companyId,
        departmentId: sched.departmentId,
        employeeId: sched.employeeId,
        scheduledOrderId: sched.id,
        source: "scheduled",
        approvalStatus: "approved",
      });
      materialised++;
    }
    // Compute next run
    let nextRun: Date | null = null;
    if (sched.recurrence !== "one_off") {
      const base = new Date(sched.nextRunAt!);
      base.setDate(base.getDate() + 1);
      nextRun = computeNextRun(sched.recurrence, sched.weekday ?? null, sched.scheduledTime, base);
      if (sched.endDate && nextRun && nextRun.toISOString().slice(0, 10) > sched.endDate) {
        nextRun = null;
      }
    }
    await db.update(corporateScheduledOrdersTable).set({
      lastRunAt: sched.nextRunAt,
      nextRunAt: nextRun,
      status: nextRun ? "active" : "ended",
      updatedAt: new Date(),
    }).where(eq(corporateScheduledOrdersTable.id, sched.id));
  }
  res.json({ ok: true, materialised, considered: due.length });
});

// ─── APPROVALS ───────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/corporate/approvals", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { status, companyId } = req.query;
  const conds = [eq(corporateApprovalsTable.restaurantId, restaurantId)];
  if (status) conds.push(eq(corporateApprovalsTable.status, String(status)));
  if (companyId) conds.push(eq(corporateApprovalsTable.companyId, Number(companyId)));
  const rows = await db.select({
    id: corporateApprovalsTable.id,
    companyId: corporateApprovalsTable.companyId,
    companyName: corporateCompaniesTable.name,
    orderId: corporateApprovalsTable.orderId,
    bulkOrderId: corporateApprovalsTable.bulkOrderId,
    requestedByEmployeeId: corporateApprovalsTable.requestedByEmployeeId,
    requestedByName: corporateEmployeesTable.name,
    amount: corporateApprovalsTable.amount,
    status: corporateApprovalsTable.status,
    decidedAt: corporateApprovalsTable.decidedAt,
    comment: corporateApprovalsTable.comment,
    createdAt: corporateApprovalsTable.createdAt,
  }).from(corporateApprovalsTable)
    .leftJoin(corporateCompaniesTable, eq(corporateCompaniesTable.id, corporateApprovalsTable.companyId))
    .leftJoin(corporateEmployeesTable, eq(corporateEmployeesTable.id, corporateApprovalsTable.requestedByEmployeeId))
    .where(and(...conds))
    .orderBy(desc(corporateApprovalsTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/corporate/approvals/:id/decide", requireRole(...STAFF), async (req, res) => {
  const id = Number(req.params.id);
  const restaurantId = Number(req.params.restaurantId);
  const { decision, comment, decidedByEmployeeId } = req.body as { decision: "approved" | "rejected"; comment?: string; decidedByEmployeeId?: number };
  if (!["approved", "rejected"].includes(decision)) { res.status(400).json({ error: "Invalid decision" }); return; }
  const [row] = await db.update(corporateApprovalsTable).set({
    status: decision,
    comment: comment ?? null,
    decidedByEmployeeId: decidedByEmployeeId ?? null,
    decidedAt: new Date(),
  }).where(and(eq(corporateApprovalsTable.id, id), eq(corporateApprovalsTable.restaurantId, restaurantId))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.orderId) {
    await db.update(corporateOrderLinksTable).set({ approvalStatus: decision })
      .where(eq(corporateOrderLinksTable.orderId, row.orderId));
  }
  res.json(row);
});

// Create approval request (used when a corporate order is placed above threshold)
router.post("/restaurants/:restaurantId/corporate/approvals", requireRole(...STAFF), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const schema = z.object({
    companyId: z.number(),
    orderId: z.number().optional(),
    bulkOrderId: z.number().optional(),
    requestedByEmployeeId: z.number().optional(),
    amount: z.string(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [row] = await db.insert(corporateApprovalsTable).values({ ...parsed.data, restaurantId }).returning();
  res.status(201).json(row);
});

// ─── ORDER TAGGING ───────────────────────────────────────────────────────────
// Tag a normal order as belonging to a corporate account. Validates limits,
// creates approval if amount exceeds threshold, and links the order.
router.post("/restaurants/:restaurantId/corporate/tag-order", requireRole(...STAFF, "cashier"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const schema = z.object({
    orderId: z.number(),
    companyId: z.number(),
    departmentId: z.number().optional().nullable(),
    employeeId: z.number().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [order] = await db.select().from(ordersTable)
    .where(and(eq(ordersTable.id, parsed.data.orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  const [company] = await db.select().from(corporateCompaniesTable)
    .where(and(eq(corporateCompaniesTable.id, parsed.data.companyId), eq(corporateCompaniesTable.restaurantId, restaurantId)));
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (company.status !== "active") { res.status(400).json({ error: "Company is suspended" }); return; }

  const total = Number(order.totalAmount);
  const threshold = Number(company.approvalThreshold);
  const requiresApproval = threshold > 0 && total > threshold;
  let approvalStatus = "not_required";
  let approvalId: number | null = null;
  if (requiresApproval) {
    const [appr] = await db.insert(corporateApprovalsTable).values({
      restaurantId,
      companyId: parsed.data.companyId,
      orderId: order.id,
      requestedByEmployeeId: parsed.data.employeeId ?? null,
      amount: order.totalAmount,
      status: "pending",
    }).returning();
    approvalStatus = "pending";
    approvalId = appr.id;
  } else {
    approvalStatus = "approved";
  }
  const [link] = await db.insert(corporateOrderLinksTable).values({
    restaurantId,
    orderId: order.id,
    companyId: parsed.data.companyId,
    departmentId: parsed.data.departmentId ?? null,
    employeeId: parsed.data.employeeId ?? null,
    approvalStatus,
    source: "individual",
  }).onConflictDoNothing().returning();
  res.status(201).json({ ok: true, link, approvalId, approvalRequired: requiresApproval });
});

// ─── INVOICES ────────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/corporate/invoices", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { companyId, status } = req.query;
  const conds = [eq(corporateInvoicesTable.restaurantId, restaurantId)];
  if (companyId) conds.push(eq(corporateInvoicesTable.companyId, Number(companyId)));
  if (status) conds.push(eq(corporateInvoicesTable.status, String(status)));
  const rows = await db.select({
    id: corporateInvoicesTable.id,
    invoiceNumber: corporateInvoicesTable.invoiceNumber,
    companyId: corporateInvoicesTable.companyId,
    companyName: corporateCompaniesTable.name,
    periodStart: corporateInvoicesTable.periodStart,
    periodEnd: corporateInvoicesTable.periodEnd,
    subtotal: corporateInvoicesTable.subtotal,
    taxAmount: corporateInvoicesTable.taxAmount,
    totalAmount: corporateInvoicesTable.totalAmount,
    amountPaid: corporateInvoicesTable.amountPaid,
    status: corporateInvoicesTable.status,
    dueDate: corporateInvoicesTable.dueDate,
    issuedAt: corporateInvoicesTable.issuedAt,
    paymentTerms: corporateInvoicesTable.paymentTerms,
  }).from(corporateInvoicesTable)
    .leftJoin(corporateCompaniesTable, eq(corporateCompaniesTable.id, corporateInvoicesTable.companyId))
    .where(and(...conds))
    .orderBy(desc(corporateInvoicesTable.createdAt));
  res.json(rows);
});

router.get("/restaurants/:restaurantId/corporate/invoices/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [inv] = await db.select().from(corporateInvoicesTable)
    .where(and(eq(corporateInvoicesTable.id, id), eq(corporateInvoicesTable.restaurantId, restaurantId)));
  if (!inv) { res.status(404).json({ error: "Not found" }); return; }
  const lines = await db.select().from(corporateInvoiceLinesTable)
    .where(eq(corporateInvoiceLinesTable.invoiceId, id))
    .orderBy(corporateInvoiceLinesTable.orderedAt);
  const payments = await db.select().from(corporateInvoicePaymentsTable)
    .where(eq(corporateInvoicePaymentsTable.invoiceId, id))
    .orderBy(desc(corporateInvoicePaymentsTable.paidAt));
  res.json({ ...inv, lines, payments });
});

// Generate invoice for a company for a given period (period defaults to last full month).
router.post("/restaurants/:restaurantId/corporate/companies/:companyId/generate-invoice", requireRole(...STAFF), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const companyId = Number(req.params.companyId);
  const [company] = await db.select().from(corporateCompaniesTable)
    .where(and(eq(corporateCompaniesTable.id, companyId), eq(corporateCompaniesTable.restaurantId, restaurantId)));
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  const { periodStart: ps, periodEnd: pe } = req.body as { periodStart?: string; periodEnd?: string };
  let periodStart: Date, periodEnd: Date;
  if (ps && pe) { periodStart = new Date(ps); periodEnd = new Date(pe); }
  else {
    const now = new Date();
    periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    periodEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  }
  // Pull all approved corporate-linked orders in period not yet invoiced
  const orders = await db.select({
    orderId: ordersTable.id,
    orderNumber: ordersTable.orderNumber,
    totalAmount: ordersTable.totalAmount,
    createdAt: ordersTable.createdAt,
    departmentId: corporateOrderLinksTable.departmentId,
    notes: ordersTable.notes,
  }).from(corporateOrderLinksTable)
    .innerJoin(ordersTable, eq(ordersTable.id, corporateOrderLinksTable.orderId))
    .where(and(
      eq(corporateOrderLinksTable.companyId, companyId),
      isNull(corporateOrderLinksTable.invoiceId),
      inArray(corporateOrderLinksTable.approvalStatus, ["approved", "not_required"]),
      gte(ordersTable.createdAt, periodStart),
      lte(ordersTable.createdAt, periodEnd),
    ));
  if (orders.length === 0) { res.status(400).json({ error: "No billable orders in period" }); return; }
  const subtotal = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
  // Use a flat 5% tax placeholder — real systems should use restaurant tax config.
  const taxAmount = +(subtotal * 0.05).toFixed(2);
  const totalAmount = +(subtotal + taxAmount).toFixed(2);
  // Compute dueDate from payment terms
  const termsDays = company.paymentTerms === "net_30" ? 30 : company.paymentTerms === "net_45" ? 45 : company.paymentTerms === "due_on_receipt" ? 0 : 15;
  const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + termsDays);
  const invoiceNumber = `CINV-${companyId}-${periodStart.toISOString().slice(0, 7)}`;
  // Department breakdown
  const deptMap = new Map<number | null, { departmentId: number | null; departmentName: string; orderCount: number; subtotal: number }>();
  for (const o of orders) {
    const k = o.departmentId ?? null;
    const cur = deptMap.get(k) ?? { departmentId: k, departmentName: "", orderCount: 0, subtotal: 0 };
    cur.orderCount += 1; cur.subtotal += Number(o.totalAmount);
    deptMap.set(k, cur);
  }
  // Resolve department names
  const deptIds = Array.from(deptMap.keys()).filter((d): d is number => d !== null);
  const depts = deptIds.length > 0 ? await db.select().from(corporateDepartmentsTable).where(inArray(corporateDepartmentsTable.id, deptIds)) : [];
  for (const d of depts) {
    const cur = deptMap.get(d.id); if (cur) cur.departmentName = d.name;
  }
  const breakdown = Array.from(deptMap.values()).map(b => ({ ...b, subtotal: b.subtotal.toFixed(2), departmentName: b.departmentName || "Unassigned" }));

  const [invoice] = await db.insert(corporateInvoicesTable).values({
    restaurantId,
    companyId,
    invoiceNumber,
    periodStart: periodStart.toISOString().slice(0, 10),
    periodEnd: periodEnd.toISOString().slice(0, 10),
    subtotal: subtotal.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
    dueDate: dueDate.toISOString().slice(0, 10),
    paymentTerms: company.paymentTerms,
    status: "sent",
    issuedAt: new Date(),
    departmentBreakdown: breakdown,
  }).returning();

  await db.insert(corporateInvoiceLinesTable).values(orders.map(o => ({
    invoiceId: invoice.id,
    orderId: o.orderId,
    departmentId: o.departmentId,
    description: `Order ${o.orderNumber}`,
    orderedAt: o.createdAt,
    amount: o.totalAmount,
  })));

  await db.update(corporateOrderLinksTable).set({ invoiceId: invoice.id })
    .where(and(
      eq(corporateOrderLinksTable.companyId, companyId),
      inArray(corporateOrderLinksTable.orderId, orders.map(o => o.orderId)),
    ));

  await db.insert(notificationsTable).values({
    restaurantId,
    type: "corporate_invoice",
    title: `Invoice ${invoice.invoiceNumber}`,
    message: `Invoice for ${company.name} totaling ₹${totalAmount.toFixed(2)} (due ${invoice.dueDate})`,
    entityId: invoice.id,
    entityType: "corporate_invoice",
  }).catch(() => {});

  res.status(201).json(invoice);
});

router.post("/restaurants/:restaurantId/corporate/invoices/:id/payments", requireRole(...STAFF, "cashier"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { amount, method, reference, notes } = req.body as { amount: string; method?: string; reference?: string; notes?: string };
  if (!amount) { res.status(400).json({ error: "Amount required" }); return; }
  const [inv] = await db.select().from(corporateInvoicesTable)
    .where(and(eq(corporateInvoicesTable.id, id), eq(corporateInvoicesTable.restaurantId, restaurantId)));
  if (!inv) { res.status(404).json({ error: "Not found" }); return; }
  const [pay] = await db.insert(corporateInvoicePaymentsTable).values({
    restaurantId, invoiceId: id, amount,
    method: method ?? "bank",
    reference: reference ?? null,
    notes: notes ?? null,
  }).returning();
  const newPaid = +(Number(inv.amountPaid) + Number(amount)).toFixed(2);
  const total = Number(inv.totalAmount);
  let status = inv.status;
  if (newPaid >= total) status = "paid";
  else if (newPaid > 0) status = "partially_paid";
  await db.update(corporateInvoicesTable).set({
    amountPaid: newPaid.toFixed(2),
    status,
    paidAt: status === "paid" ? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(corporateInvoicesTable.id, id));
  res.status(201).json(pay);
});

router.post("/restaurants/:restaurantId/corporate/invoices/:id/send-reminder", requireRole(...STAFF), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [inv] = await db.select({ inv: corporateInvoicesTable, company: corporateCompaniesTable })
    .from(corporateInvoicesTable)
    .innerJoin(corporateCompaniesTable, eq(corporateCompaniesTable.id, corporateInvoicesTable.companyId))
    .where(and(eq(corporateInvoicesTable.id, id), eq(corporateInvoicesTable.restaurantId, restaurantId)));
  if (!inv) { res.status(404).json({ error: "Not found" }); return; }
  await db.insert(notificationsTable).values({
    restaurantId,
    type: "corporate_invoice_reminder",
    title: `Reminder: Invoice ${inv.inv.invoiceNumber}`,
    message: `Reminder sent to ${inv.company.name} for outstanding ₹${(Number(inv.inv.totalAmount) - Number(inv.inv.amountPaid)).toFixed(2)}`,
    entityId: id,
    entityType: "corporate_invoice",
  }).catch(() => {});
  res.json({ ok: true });
});

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/corporate/dashboard", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [companies] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(corporateCompaniesTable)
    .where(and(eq(corporateCompaniesTable.restaurantId, restaurantId), eq(corporateCompaniesTable.status, "active")));
  const [employees] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(corporateEmployeesTable)
    .where(and(eq(corporateEmployeesTable.restaurantId, restaurantId), eq(corporateEmployeesTable.isActive, true)));
  const [monthRev] = await db.select({
    total: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)`,
    count: sql<number>`COUNT(*)::int`,
  }).from(corporateOrderLinksTable)
    .innerJoin(ordersTable, eq(ordersTable.id, corporateOrderLinksTable.orderId))
    .where(and(eq(corporateOrderLinksTable.restaurantId, restaurantId), gte(ordersTable.createdAt, monthStart)));
  const [outstanding] = await db.select({
    total: sql<string>`COALESCE(SUM(${corporateInvoicesTable.totalAmount} - ${corporateInvoicesTable.amountPaid}), 0)`,
    count: sql<number>`COUNT(*)::int`,
  }).from(corporateInvoicesTable)
    .where(and(eq(corporateInvoicesTable.restaurantId, restaurantId), inArray(corporateInvoicesTable.status, ["sent", "partially_paid", "overdue"])));
  const [pendingApprovals] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(corporateApprovalsTable)
    .where(and(eq(corporateApprovalsTable.restaurantId, restaurantId), eq(corporateApprovalsTable.status, "pending")));
  const topCompanies = await db.select({
    companyId: corporateOrderLinksTable.companyId,
    companyName: corporateCompaniesTable.name,
    revenue: sql<string>`COALESCE(SUM(${ordersTable.totalAmount}), 0)`,
    orders: sql<number>`COUNT(*)::int`,
  }).from(corporateOrderLinksTable)
    .innerJoin(ordersTable, eq(ordersTable.id, corporateOrderLinksTable.orderId))
    .innerJoin(corporateCompaniesTable, eq(corporateCompaniesTable.id, corporateOrderLinksTable.companyId))
    .where(and(eq(corporateOrderLinksTable.restaurantId, restaurantId), gte(ordersTable.createdAt, monthStart)))
    .groupBy(corporateOrderLinksTable.companyId, corporateCompaniesTable.name)
    .orderBy(desc(sql`SUM(${ordersTable.totalAmount})`))
    .limit(5);
  res.json({
    activeCompanies: companies?.count ?? 0,
    activeEmployees: employees?.count ?? 0,
    monthRevenue: monthRev?.total ?? "0",
    monthOrders: monthRev?.count ?? 0,
    outstandingTotal: outstanding?.total ?? "0",
    outstandingInvoices: outstanding?.count ?? 0,
    pendingApprovals: pendingApprovals?.count ?? 0,
    topCompanies,
  });
});

export default router;
