import { Router } from "express";
import { eq, and, gt } from "drizzle-orm";
import { db, restaurantsTable, branchesTable, subscriptionPlansTable, tenantsTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { seedDefaultExpenseCategories } from "./expenses";
import { recordAuditLog } from "../lib/audit";

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
      const existing = await db.select().from(restaurantsTable).where(eq(restaurantsTable.tenantId, tenantId));
      if (existing.length >= plan.maxRestaurants) {
        const suggested = await db.select({ name: subscriptionPlansTable.name }).from(subscriptionPlansTable)
          .where(and(eq(subscriptionPlansTable.isActive, true), gt(subscriptionPlansTable.maxRestaurants, plan.maxRestaurants)))
          .orderBy(subscriptionPlansTable.price).limit(1);
        return void res.status(402).json({
          code: "PLAN_LIMIT_REACHED",
          error: `Your plan allows a maximum of ${plan.maxRestaurants} restaurant(s). Upgrade to add more.`,
          feature: "maxRestaurants",
          currentPlan: plan.name,
          currentLimit: plan.maxRestaurants,
          currentUsage: existing.length,
          suggestedPlan: suggested[0]?.name ?? null,
        });
      }
    }
  }

  const [restaurant] = await db.insert(restaurantsTable).values({ tenantId, name, slug, description, phone, email, address, city, country, taxRate, openingTime, closingTime }).returning();
  // Seed default expense categories for the new restaurant so owners can record expenses immediately.
  await seedDefaultExpenseCategories(restaurant.id);
  await recordAuditLog({
    req, module: "restaurants", action: "restaurant.create", entity: "restaurant",
    entityId: restaurant.id, restaurantId: restaurant.id, targetRestaurantId: restaurant.id,
    newValue: { name: restaurant.name, slug: restaurant.slug, tenantId: restaurant.tenantId },
  });
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

  const { name, description, phone, email, address, city, country, timezone, currency, taxRate, serviceCharge, logoUrl, coverImageUrl, openingTime, closingTime, autoReorderEnabled, autoReorderCron, acceptedPaymentMethods, enableVoiceOrdering, enableOnlinePayment, googleReviewLink } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (phone !== undefined) updates.phone = phone;
  if (email !== undefined) updates.email = email;
  if (address !== undefined) updates.address = address;
  if (city !== undefined) updates.city = city;
  if (country !== undefined) updates.country = country;
  if (timezone !== undefined) updates.timezone = timezone;
  if (currency !== undefined) updates.currency = currency;
  if (coverImageUrl !== undefined) updates.coverImageUrl = coverImageUrl;
  if (taxRate !== undefined) updates.taxRate = taxRate;
  if (acceptedPaymentMethods !== undefined && Array.isArray(acceptedPaymentMethods)) {
    updates.acceptedPaymentMethods = acceptedPaymentMethods.filter((m: unknown) => typeof m === "string");
  }
  if (serviceCharge !== undefined) updates.serviceCharge = serviceCharge;
  if (logoUrl !== undefined) updates.logoUrl = logoUrl;
  if (openingTime !== undefined) updates.openingTime = openingTime;
  if (closingTime !== undefined) updates.closingTime = closingTime;
  if (autoReorderEnabled !== undefined) updates.autoReorderEnabled = autoReorderEnabled;
  if (autoReorderCron !== undefined) updates.autoReorderCron = autoReorderCron;
  if (enableVoiceOrdering !== undefined) updates.enableVoiceOrdering = !!enableVoiceOrdering;
  if (enableOnlinePayment !== undefined) updates.enableOnlinePayment = !!enableOnlinePayment;
  if (googleReviewLink !== undefined) updates.googleReviewLink = googleReviewLink === "" ? null : googleReviewLink;
  const [updated] = await db.update(restaurantsTable)
    .set(updates)
    .where(eq(restaurantsTable.id, Number(req.params.id)))
    .returning();
  await recordAuditLog({
    req, module: "restaurants", action: "restaurant.update", entity: "restaurant",
    entityId: updated.id, restaurantId: updated.id, targetRestaurantId: updated.id,
    oldValue: { ...existing }, newValue: updates,
  });
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
        const suggested = await db.select({ name: subscriptionPlansTable.name }).from(subscriptionPlansTable)
          .where(and(eq(subscriptionPlansTable.isActive, true), gt(subscriptionPlansTable.maxBranches, plan.maxBranches)))
          .orderBy(subscriptionPlansTable.price).limit(1);
        return void res.status(402).json({
          code: "PLAN_LIMIT_REACHED",
          error: `Your plan allows a maximum of ${plan.maxBranches} branch(es). Upgrade to add more.`,
          feature: "maxBranches",
          currentPlan: plan.name,
          currentLimit: plan.maxBranches,
          currentUsage: branches.length,
          suggestedPlan: suggested[0]?.name ?? null,
        });
      }
    }
  }

  const { name, address, phone, isMain } = req.body;
  const [branch] = await db.insert(branchesTable).values({ restaurantId, name, address, phone, isMain }).returning();
  await recordAuditLog({
    req, module: "restaurants", action: "branch.create", entity: "branch",
    entityId: branch.id, restaurantId, targetRestaurantId: restaurantId,
    newValue: { name: branch.name, address: branch.address, isMain: branch.isMain },
  });
  res.status(201).json(branch);
});

router.patch("/restaurants/:restaurantId/branches/:branchId", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const branchId = Number(req.params.branchId);
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  if (!restaurant) return void res.status(404).json({ error: "Not found" });
  if (!assertRestaurantAccess(req, restaurant.tenantId)) return void res.status(403).json({ error: "Access denied" });
  const [existing] = await db.select().from(branchesTable).where(and(eq(branchesTable.id, branchId), eq(branchesTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Branch not found" });

  const { name, address, phone, isMain } = req.body ?? {};
  const updates: Record<string, unknown> = {};
  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (address !== undefined) updates.address = address === "" ? null : String(address);
  if (phone !== undefined) updates.phone = phone === "" ? null : String(phone);
  if (typeof isMain === "boolean") updates.isMain = isMain;

  const [updated] = await db.update(branchesTable).set(updates).where(eq(branchesTable.id, branchId)).returning();
  await recordAuditLog({
    req, module: "restaurants", action: "branch.update", entity: "branch",
    entityId: branchId, restaurantId, targetRestaurantId: restaurantId,
    oldValue: { name: existing.name, address: existing.address, phone: existing.phone, isMain: existing.isMain },
    newValue: updates,
  });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/branches/:branchId", requireRole("owner", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const branchId = Number(req.params.branchId);
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  if (!restaurant) return void res.status(404).json({ error: "Not found" });
  if (!assertRestaurantAccess(req, restaurant.tenantId)) return void res.status(403).json({ error: "Access denied" });
  const [existing] = await db.select().from(branchesTable).where(and(eq(branchesTable.id, branchId), eq(branchesTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Branch not found" });
  try {
    await db.delete(branchesTable).where(eq(branchesTable.id, branchId));
  } catch {
    return void res.status(409).json({ error: "Cannot delete: branch has linked records" });
  }
  await recordAuditLog({
    req, module: "restaurants", action: "branch.delete", entity: "branch",
    entityId: branchId, restaurantId, targetRestaurantId: restaurantId,
    oldValue: { name: existing.name, address: existing.address },
  });
  res.status(204).send();
});

export default router;
