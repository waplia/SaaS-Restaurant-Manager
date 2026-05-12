import { Router } from "express";
import { eq, and, ilike, count, desc } from "drizzle-orm";
import { db, customersTable, couponsTable, notificationsTable, loyaltyTransactionsTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

router.use("/restaurants/:restaurantId", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), validateRestaurantAccess);

router.get("/restaurants/:restaurantId/customers", async (req, res) => {
  const { search, page, limit } = req.query;
  const pg = Number(page) || 1;
  const lim = Number(limit) || 20;
  const offset = (pg - 1) * lim;
  const restaurantId = Number(req.params.restaurantId);

  const conditions: ReturnType<typeof eq | typeof ilike>[] = [eq(customersTable.restaurantId, restaurantId)];
  if (search) conditions.push(ilike(customersTable.name, `%${search}%`));

  const [rows, totalRows] = await Promise.all([
    db.select().from(customersTable).where(and(...conditions)).orderBy(desc(customersTable.createdAt)).limit(lim).offset(offset),
    db.select({ count: count() }).from(customersTable).where(and(...conditions)),
  ]);
  res.json({ data: rows, total: totalRows[0]?.count ?? 0 });
});

router.post("/restaurants/:restaurantId/customers", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const { name, email, phone, address, notes } = req.body;
  const [customer] = await db.insert(customersTable).values({ restaurantId: Number(req.params.restaurantId), name, email, phone, address, notes }).returning();
  res.status(201).json(customer);
});

router.get("/restaurants/:restaurantId/customers/:id", async (req, res) => {
  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, Number(req.params.id)), eq(customersTable.restaurantId, Number(req.params.restaurantId))));
  if (!customer) return void res.status(404).json({ error: "Not found" });
  res.json(customer);
});

router.patch("/restaurants/:restaurantId/customers/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { name, email, phone, address, loyaltyPoints, notes, isActive } = req.body;
  const [updated] = await db.update(customersTable).set({ name, email, phone, address, loyaltyPoints, notes, isActive, updatedAt: new Date() }).where(and(eq(customersTable.id, Number(req.params.id)), eq(customersTable.restaurantId, Number(req.params.restaurantId)))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.get("/restaurants/:restaurantId/customers/:id/loyalty", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.id);
  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.restaurantId, restaurantId)));
  if (!customer) return void res.status(404).json({ error: "Not found" });
  const transactions = await db.select().from(loyaltyTransactionsTable).where(and(eq(loyaltyTransactionsTable.customerId, customerId), eq(loyaltyTransactionsTable.restaurantId, restaurantId))).orderBy(desc(loyaltyTransactionsTable.createdAt)).limit(50);
  res.json({ balance: customer.loyaltyPoints, transactions });
});

router.post("/restaurants/:restaurantId/customers/:id/loyalty", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { points, type, reason, orderId } = req.body;
  const restaurantId = Number(req.params.restaurantId);
  const customerId = Number(req.params.id);

  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.restaurantId, restaurantId)));
  if (!customer) return void res.status(404).json({ error: "Not found" });

  const delta = type === "redeem" ? -Math.abs(Number(points)) : Math.abs(Number(points));
  const newBalance = Math.max(0, customer.loyaltyPoints + delta);

  await db.update(customersTable).set({ loyaltyPoints: newBalance, updatedAt: new Date() }).where(eq(customersTable.id, customerId));
  const [tx] = await db.insert(loyaltyTransactionsTable).values({ customerId, restaurantId, points: delta, type: type ?? "earn", reason, orderId }).returning();
  res.status(201).json({ balance: newBalance, transaction: tx });
});

router.get("/restaurants/:restaurantId/coupons", async (req, res) => {
  const rows = await db.select().from(couponsTable).where(eq(couponsTable.restaurantId, Number(req.params.restaurantId)));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/coupons", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { code, discountType, discountValue, minOrderAmount, maxDiscountAmount, usageLimit, validFrom, validTo } = req.body;
  const [coupon] = await db.insert(couponsTable).values({ restaurantId: Number(req.params.restaurantId), code: code.toUpperCase(), discountType, discountValue, minOrderAmount, maxDiscountAmount, usageLimit, validFrom: validFrom ? new Date(validFrom) : new Date(), validTo: validTo ? new Date(validTo) : undefined }).returning();
  res.status(201).json(coupon);
});

router.patch("/restaurants/:restaurantId/coupons/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { isActive, validTo, usageLimit } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (isActive !== undefined) updates.isActive = isActive;
  if (validTo) updates.validTo = new Date(validTo);
  if (usageLimit !== undefined) updates.usageLimit = usageLimit;
  const [updated] = await db.update(couponsTable).set(updates).where(and(eq(couponsTable.id, Number(req.params.id)), eq(couponsTable.restaurantId, Number(req.params.restaurantId)))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/coupons/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  await db.update(couponsTable).set({ isActive: false }).where(and(eq(couponsTable.id, Number(req.params.id)), eq(couponsTable.restaurantId, Number(req.params.restaurantId))));
  res.status(204).send();
});

router.post("/restaurants/:restaurantId/coupons/validate", async (req, res) => {
  const { code, orderAmount } = req.body;
  const restaurantId = Number(req.params.restaurantId);
  const now = new Date();

  const [coupon] = await db.select().from(couponsTable).where(and(eq(couponsTable.restaurantId, restaurantId), eq(couponsTable.code, code.toUpperCase()), eq(couponsTable.isActive, true)));
  if (!coupon) return void res.json({ valid: false, discountAmount: "0.00", message: "Invalid coupon code" });
  if (coupon.validTo && new Date(coupon.validTo) < now) return void res.json({ valid: false, discountAmount: "0.00", message: "Coupon expired" });
  if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) return void res.json({ valid: false, discountAmount: "0.00", message: "Coupon usage limit reached" });
  if (coupon.minOrderAmount && Number(orderAmount) < Number(coupon.minOrderAmount)) return void res.json({ valid: false, discountAmount: "0.00", message: `Minimum order amount is ${coupon.minOrderAmount}` });

  let discount = 0;
  if (coupon.discountType === "percentage") discount = (Number(orderAmount) * Number(coupon.discountValue)) / 100;
  else discount = Number(coupon.discountValue);
  if (coupon.maxDiscountAmount) discount = Math.min(discount, Number(coupon.maxDiscountAmount));

  res.json({ valid: true, discountAmount: discount.toFixed(2), message: null });
});

router.get("/restaurants/:restaurantId/notifications", async (req, res) => {
  const { unreadOnly } = req.query;
  const restaurantId = Number(req.params.restaurantId);
  const conditions: ReturnType<typeof eq>[] = [eq(notificationsTable.restaurantId, restaurantId)];
  if (unreadOnly === "true") conditions.push(eq(notificationsTable.isRead, false));
  const rows = await db.select().from(notificationsTable).where(and(...conditions)).orderBy(desc(notificationsTable.createdAt)).limit(50);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/notifications/mark-read", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const { ids, all } = req.body;
  const restaurantId = Number(req.params.restaurantId);
  if (all) {
    const result = await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.restaurantId, restaurantId));
    return void res.json({ updated: result.rowCount ?? 0 });
  }
  if (ids?.length) {
    let updated = 0;
    for (const id of ids as number[]) {
      await db.update(notificationsTable).set({ isRead: true }).where(and(eq(notificationsTable.id, id), eq(notificationsTable.restaurantId, restaurantId)));
      updated++;
    }
    return void res.json({ updated });
  }
  res.json({ updated: 0 });
});

export default router;
