import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, restaurantsTable, branchesTable, subscriptionPlansTable, tenantsTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";

const router = Router();

function assertRestaurantAccess(req: { user?: { tenantId?: number | null; isSuperAdmin?: boolean } }, tenantId: number | null): boolean {
  if (!req.user) return false;
  if (req.user.isSuperAdmin) return true;
  if (tenantId === null) return false;
  return req.user.tenantId === tenantId;
}

router.get("/restaurants", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  if (req.user!.isSuperAdmin) {
    const rows = await db.select().from(restaurantsTable);
    return void res.json(rows);
  }
  const tenantId = req.user!.tenantId;
  if (!tenantId) return void res.status(403).json({ error: "No tenant associated with this account" });
  const rows = await db.select().from(restaurantsTable).where(eq(restaurantsTable.tenantId, tenantId));
  res.json(rows);
});

router.post("/restaurants", requireRole("owner", "super_admin"), async (req, res) => {
  const { name, slug, description, phone, email, address, city, country, taxRate, openingTime, closingTime } = req.body;
  const tenantId = req.user!.isSuperAdmin ? (req.body.tenantId as number) : req.user!.tenantId;
  if (!tenantId) return void res.status(400).json({ error: "tenantId is required" });

  if (!req.user!.isSuperAdmin) {
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    if (tenant?.isSuspended) return void res.status(403).json({ error: "Account suspended" });

    const plan = tenant?.planId
      ? await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, tenant.planId)).then(r => r[0])
      : null;

    if (plan && plan.maxRestaurants > 0) {
      const [{ count }] = await db.select({ count: eq(restaurantsTable.tenantId, tenantId) }).from(restaurantsTable).where(eq(restaurantsTable.tenantId, tenantId));
      const existing = await db.select().from(restaurantsTable).where(eq(restaurantsTable.tenantId, tenantId));
      if (existing.length >= plan.maxRestaurants) {
        return void res.status(402).json({ error: `Your plan allows a maximum of ${plan.maxRestaurants} restaurant(s). Upgrade to add more.` });
      }
    }
  }

  const [restaurant] = await db.insert(restaurantsTable).values({ tenantId, name, slug, description, phone, email, address, city, country, taxRate, openingTime, closingTime }).returning();
  res.status(201).json(restaurant);
});

router.get("/restaurants/:id", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (req, res) => {
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, Number(req.params.id)));
  if (!restaurant) return void res.status(404).json({ error: "Not found" });
  if (!assertRestaurantAccess(req, restaurant.tenantId)) return void res.status(403).json({ error: "Access denied" });
  res.json(restaurant);
});

router.patch("/restaurants/:id", requireRole("owner", "super_admin"), async (req, res) => {
  const [existing] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, Number(req.params.id)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  if (!assertRestaurantAccess(req, existing.tenantId)) return void res.status(403).json({ error: "Access denied" });

  const { name, description, phone, email, address, city, taxRate, serviceCharge, logoUrl, openingTime, closingTime } = req.body;
  const [updated] = await db.update(restaurantsTable)
    .set({ name, description, phone, email, address, city, taxRate, serviceCharge, logoUrl, openingTime, closingTime, updatedAt: new Date() })
    .where(eq(restaurantsTable.id, Number(req.params.id)))
    .returning();
  res.json(updated);
});

router.get("/restaurants/:restaurantId/branches", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  if (!restaurant) return void res.status(404).json({ error: "Not found" });
  if (!assertRestaurantAccess(req, restaurant.tenantId)) return void res.status(403).json({ error: "Access denied" });
  const rows = await db.select().from(branchesTable).where(eq(branchesTable.restaurantId, restaurantId));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/branches", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  if (!restaurant) return void res.status(404).json({ error: "Not found" });
  if (!assertRestaurantAccess(req, restaurant.tenantId)) return void res.status(403).json({ error: "Access denied" });

  if (!req.user!.isSuperAdmin && restaurant.tenantId) {
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, restaurant.tenantId));
    const plan = tenant?.planId
      ? await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, tenant.planId)).then(r => r[0])
      : null;
    if (plan && plan.maxBranches > 0) {
      const branches = await db.select().from(branchesTable).where(eq(branchesTable.restaurantId, restaurantId));
      if (branches.length >= plan.maxBranches) {
        return void res.status(402).json({ error: `Your plan allows a maximum of ${plan.maxBranches} branch(es). Upgrade to add more.` });
      }
    }
  }

  const { name, address, phone, isMain } = req.body;
  const [branch] = await db.insert(branchesTable).values({ restaurantId, name, address, phone, isMain }).returning();
  res.status(201).json(branch);
});

export default router;
