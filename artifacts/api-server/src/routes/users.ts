import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable, tenantsTable, subscriptionPlansTable, restaurantsTable, userDevicesTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { hashPassword } from "../lib/auth";
import { recordAuditLog } from "../lib/audit";

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
  await recordAuditLog({
    req, module: "users", action: "user.create", entity: "user", entityId: user.id,
    targetRestaurantId: restaurantId ?? null,
    newValue: { name: user.name, email: user.email, role: user.role, restaurantId, tenantId },
  });
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
  await recordAuditLog({
    req, module: "users", action: "user.update", entity: "user", entityId: updated.id,
    targetRestaurantId: updated.restaurantId ?? null,
    newValue: { name, phone, role, isActive, avatarUrl },
  });
  res.json(updated);
});

router.post("/users/:id/push-token", async (req, res) => {
  const userId = Number(req.params.id);
  if (!req.user || (req.user.sub !== userId && !req.user.isSuperAdmin)) {
    return void res.status(403).json({ error: "Access denied" });
  }
  const { token, platform } = req.body as { token: string; platform?: string };
  if (!token) return void res.status(400).json({ error: "token required" });

  // Upsert into per-device table.
  const [existing] = await db.select().from(userDevicesTable).where(eq(userDevicesTable.token, token));
  if (existing) {
    await db.update(userDevicesTable)
      .set({ userId, platform: platform ?? existing.platform, lastSeenAt: new Date() })
      .where(eq(userDevicesTable.id, existing.id));
  } else {
    await db.insert(userDevicesTable).values({ userId, token, platform }).onConflictDoNothing();
  }

  // Keep legacy single-token field in sync for backwards compatibility (delivery push).
  await db.update(usersTable).set({ pushToken: token, updatedAt: new Date() }).where(eq(usersTable.id, userId));
  res.json({ ok: true });
});

router.delete("/users/:id/push-token", async (req, res) => {
  const userId = Number(req.params.id);
  if (!req.user || (req.user.sub !== userId && !req.user.isSuperAdmin)) {
    return void res.status(403).json({ error: "Access denied" });
  }
  const { token } = req.body as { token?: string };
  if (token) {
    await db.delete(userDevicesTable).where(and(eq(userDevicesTable.userId, userId), eq(userDevicesTable.token, token)));
  } else {
    await db.delete(userDevicesTable).where(eq(userDevicesTable.userId, userId));
  }
  res.json({ ok: true });
});

router.get("/users/:id/notification-prefs", async (req, res) => {
  const userId = Number(req.params.id);
  if (!req.user || (req.user.sub !== userId && !req.user.isSuperAdmin)) {
    return void res.status(403).json({ error: "Access denied" });
  }
  const [u] = await db.select({ prefs: usersTable.notificationPrefs }).from(usersTable).where(eq(usersTable.id, userId));
  const prefs = (u?.prefs ?? {}) as Record<string, boolean>;
  res.json({
    waiter_call: prefs.waiter_call !== false,
    new_order: prefs.new_order !== false,
    reservation: prefs.reservation !== false,
  });
});

router.patch("/users/:id/notification-prefs", async (req, res) => {
  const userId = Number(req.params.id);
  if (!req.user || (req.user.sub !== userId && !req.user.isSuperAdmin)) {
    return void res.status(403).json({ error: "Access denied" });
  }
  const body = req.body as Partial<Record<"waiter_call" | "new_order" | "reservation", boolean>>;
  const [current] = await db.select({ prefs: usersTable.notificationPrefs }).from(usersTable).where(eq(usersTable.id, userId));
  const merged = { ...((current?.prefs ?? {}) as Record<string, boolean>) };
  for (const key of ["waiter_call", "new_order", "reservation"] as const) {
    if (typeof body[key] === "boolean") merged[key] = body[key]!;
  }
  await db.update(usersTable).set({ notificationPrefs: merged, updatedAt: new Date() }).where(eq(usersTable.id, userId));
  res.json({
    waiter_call: merged.waiter_call !== false,
    new_order: merged.new_order !== false,
    reservation: merged.reservation !== false,
  });
});

router.delete("/users/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const [existing] = await db.select({ id: usersTable.id, tenantId: usersTable.tenantId }).from(usersTable).where(eq(usersTable.id, Number(req.params.id)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  if (!req.user!.isSuperAdmin && existing.tenantId !== req.user!.tenantId) {
    return void res.status(403).json({ error: "Access denied" });
  }
  await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, Number(req.params.id)));
  await recordAuditLog({
    req, module: "users", action: "user.deactivate", entity: "user",
    entityId: Number(req.params.id),
  });
  res.status(204).send();
});

export default router;
