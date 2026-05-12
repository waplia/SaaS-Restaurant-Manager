import { Router } from "express";
import { eq, desc, count } from "drizzle-orm";
import { db, subscriptionPlansTable, tenantsTable } from "../lib/db";
import { requireSuperAdmin } from "../middleware/authorize";
import { requireRole } from "../middleware/authorize";

const router = Router();

router.get("/subscription-plans", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (_req, res) => {
  const plans = await db.select().from(subscriptionPlansTable).orderBy(subscriptionPlansTable.price);
  res.json(plans);
});

router.get("/subscription-plans/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, Number(req.params.id)));
  if (!plan) return void res.status(404).json({ error: "Not found" });
  res.json(plan);
});

router.get("/tenants", requireSuperAdmin, async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  const [rows, totalRows] = await Promise.all([
    db.select().from(tenantsTable).orderBy(desc(tenantsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: count() }).from(tenantsTable),
  ]);
  res.json({ tenants: rows, total: totalRows[0]?.count ?? 0 });
});

router.post("/tenants", requireSuperAdmin, async (req, res) => {
  const { name, slug, planId, primaryColor } = req.body;
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const [tenant] = await db.insert(tenantsTable).values({ name, slug, planId, primaryColor, planStatus: "trial", trialEndsAt }).returning();
  res.status(201).json(tenant);
});

router.get("/tenants/:id", requireSuperAdmin, async (req, res) => {
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, Number(req.params.id)));
  if (!tenant) return void res.status(404).json({ error: "Not found" });
  res.json(tenant);
});

router.patch("/tenants/:id", requireSuperAdmin, async (req, res) => {
  const { name, planId, planStatus, isActive, logoUrl, primaryColor } = req.body;
  const [updated] = await db.update(tenantsTable)
    .set({ name, planId, planStatus, isActive, logoUrl, primaryColor, updatedAt: new Date() })
    .where(eq(tenantsTable.id, Number(req.params.id)))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.post("/tenants/:id/suspend", requireSuperAdmin, async (req, res) => {
  const [updated] = await db.update(tenantsTable)
    .set({ isSuspended: true, updatedAt: new Date() })
    .where(eq(tenantsTable.id, Number(req.params.id)))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.post("/tenants/:id/activate", requireSuperAdmin, async (req, res) => {
  const [updated] = await db.update(tenantsTable)
    .set({ isSuspended: false, isActive: true, updatedAt: new Date() })
    .where(eq(tenantsTable.id, Number(req.params.id)))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.get("/admin/stats", requireSuperAdmin, async (_req, res) => {
  const [tenantStats, restaurantCount, orderStats] = await Promise.all([
    db.select().from(tenantsTable),
    db.execute<{ count: string }>("SELECT COUNT(*) as count FROM restaurants"),
    db.execute<{ count: string; total: string }>("SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total FROM orders"),
  ]);

  const totalTenants = tenantStats.length;
  const activeTenants = tenantStats.filter(t => t.isActive && !t.isSuspended).length;
  const trialTenants = tenantStats.filter(t => t.planStatus === "trial").length;
  const suspendedTenants = tenantStats.filter(t => t.isSuspended).length;

  res.json({
    totalTenants,
    activeTenants,
    trialTenants,
    suspendedTenants,
    totalRestaurants: Number(restaurantCount.rows[0]?.count ?? 0),
    totalOrders: Number(orderStats.rows[0]?.count ?? 0),
    totalRevenue: orderStats.rows[0]?.total ?? "0.00",
  });
});

export default router;
