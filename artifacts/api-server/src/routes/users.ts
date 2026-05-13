import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable, tenantsTable, subscriptionPlansTable, restaurantsTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { hashPassword } from "../lib/auth";

const router = Router();

const userFields = {
  id: usersTable.id,
  name: usersTable.name,
  email: usersTable.email,
  role: usersTable.role,
  phone: usersTable.phone,
  avatarUrl: usersTable.avatarUrl,
  isActive: usersTable.isActive,
  restaurantId: usersTable.restaurantId,
  tenantId: usersTable.tenantId,
  lastLoginAt: usersTable.lastLoginAt,
  createdAt: usersTable.createdAt,
};

router.get("/users", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { restaurantId, role } = req.query;
  const conditions: ReturnType<typeof eq>[] = [];

  if (!req.user!.isSuperAdmin) {
    const tenantId = req.user!.tenantId;
    if (!tenantId) return void res.status(403).json({ error: "No tenant" });
    conditions.push(eq(usersTable.tenantId, tenantId));
  }

  if (restaurantId) conditions.push(eq(usersTable.restaurantId, Number(restaurantId)));
  if (role) conditions.push(eq(usersTable.role, String(role)));

  const rows = await db.select(userFields).from(usersTable).where(conditions.length ? and(...conditions) : undefined);
  res.json(rows);
});

router.post("/users", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const { name, email, password, role, phone, restaurantId } = req.body;
  const tenantId = req.user!.isSuperAdmin ? (req.body.tenantId as number) : req.user!.tenantId;

  if (!password || typeof password !== "string" || password.length < 6) {
    return void res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  const callerRole = req.user!.role;
  const ALLOWED_TARGET_ROLES: Record<string, string[]> = {
    owner: ["manager", "waiter", "kitchen", "cashier", "delivery_executive"],
    manager: ["waiter", "kitchen", "cashier", "delivery_executive"],
  };
  if (!req.user!.isSuperAdmin) {
    const allowed = ALLOWED_TARGET_ROLES[callerRole] ?? [];
    if (!allowed.includes(role)) {
      return void res.status(403).json({ error: `A ${callerRole} cannot assign the role "${role}". Allowed: ${allowed.join(", ")}` });
    }
  }

  if (!req.user!.isSuperAdmin && tenantId) {
    const [tenant] = await db.select({ planId: tenantsTable.planId }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    if (tenant?.planId) {
      const [plan] = await db.select({ maxStaff: subscriptionPlansTable.maxStaff }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, tenant.planId));
      if (plan && plan.maxStaff > 0) {
        const existing = await db.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true)));
        if (existing.length >= plan.maxStaff) {
          return void res.status(402).json({ error: `Your plan allows a maximum of ${plan.maxStaff} staff account(s). Upgrade to add more.` });
        }
      }
    }
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(usersTable).values({ name, email, passwordHash, role, phone, restaurantId, tenantId }).returning(userFields);
  res.status(201).json(user);
});

router.get("/users/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const [user] = await db.select(userFields).from(usersTable).where(eq(usersTable.id, Number(req.params.id)));
  if (!user) return void res.status(404).json({ error: "Not found" });
  if (!req.user!.isSuperAdmin && user.tenantId !== req.user!.tenantId) {
    return void res.status(403).json({ error: "Access denied" });
  }
  res.json(user);
});

router.patch("/users/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const [existing] = await db.select({ id: usersTable.id, tenantId: usersTable.tenantId }).from(usersTable).where(eq(usersTable.id, Number(req.params.id)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  if (!req.user!.isSuperAdmin && existing.tenantId !== req.user!.tenantId) {
    return void res.status(403).json({ error: "Access denied" });
  }
  const { name, phone, role, isActive, avatarUrl } = req.body;
  const [updated] = await db.update(usersTable)
    .set({ name, phone, role, isActive, avatarUrl, updatedAt: new Date() })
    .where(eq(usersTable.id, Number(req.params.id)))
    .returning(userFields);
  res.json(updated);
});

router.post("/users/:id/push-token", async (req, res) => {
  const userId = Number(req.params.id);
  if (!req.user || (req.user.sub !== userId && !req.user.isSuperAdmin)) {
    return void res.status(403).json({ error: "Access denied" });
  }
  const { token } = req.body as { token: string; platform?: string };
  if (!token) return void res.status(400).json({ error: "token required" });
  await db.update(usersTable).set({ pushToken: token, updatedAt: new Date() }).where(eq(usersTable.id, userId));
  res.json({ ok: true });
});

router.delete("/users/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const [existing] = await db.select({ id: usersTable.id, tenantId: usersTable.tenantId }).from(usersTable).where(eq(usersTable.id, Number(req.params.id)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  if (!req.user!.isSuperAdmin && existing.tenantId !== req.user!.tenantId) {
    return void res.status(403).json({ error: "Access denied" });
  }
  await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, Number(req.params.id)));
  res.status(204).send();
});

router.get("/restaurants/:restaurantId/staff", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { role } = req.query;
  const conditions: ReturnType<typeof eq>[] = [eq(usersTable.restaurantId, restaurantId)];

  if (!req.user!.isSuperAdmin) {
    const tenantId = req.user!.tenantId;
    if (tenantId) conditions.push(eq(usersTable.tenantId, tenantId));
  }

  if (role) conditions.push(eq(usersTable.role, String(role)));
  const rows = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    phone: usersTable.phone,
    avatarUrl: usersTable.avatarUrl,
    isActive: usersTable.isActive,
    lastLoginAt: usersTable.lastLoginAt,
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(and(...conditions));
  res.json(rows);
});

export default router;
