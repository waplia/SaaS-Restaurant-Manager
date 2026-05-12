import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable } from "../lib/db";

const router = Router();

router.get("/users", async (req, res) => {
  const { restaurantId, role } = req.query;
  let query = db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    phone: usersTable.phone,
    avatarUrl: usersTable.avatarUrl,
    isActive: usersTable.isActive,
    restaurantId: usersTable.restaurantId,
    lastLoginAt: usersTable.lastLoginAt,
    createdAt: usersTable.createdAt,
  }).from(usersTable);

  const conditions = [];
  if (restaurantId) conditions.push(eq(usersTable.restaurantId, Number(restaurantId)));
  if (role) conditions.push(eq(usersTable.role, String(role)));
  if (conditions.length) query = query.where(and(...conditions)) as typeof query;

  const rows = await query;
  res.json(rows);
});

router.post("/users", async (req, res) => {
  const { name, email, passwordHash, role, phone, restaurantId, tenantId } = req.body;
  const [user] = await db.insert(usersTable).values({ name, email, passwordHash, role, phone, restaurantId, tenantId }).returning({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    phone: usersTable.phone,
    avatarUrl: usersTable.avatarUrl,
    isActive: usersTable.isActive,
    restaurantId: usersTable.restaurantId,
    lastLoginAt: usersTable.lastLoginAt,
    createdAt: usersTable.createdAt,
  });
  res.status(201).json(user);
});

router.get("/users/:id", async (req, res) => {
  const [user] = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    phone: usersTable.phone,
    avatarUrl: usersTable.avatarUrl,
    isActive: usersTable.isActive,
    restaurantId: usersTable.restaurantId,
    lastLoginAt: usersTable.lastLoginAt,
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(eq(usersTable.id, Number(req.params.id)));
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json(user);
});

router.patch("/users/:id", async (req, res) => {
  const { name, phone, role, isActive, avatarUrl } = req.body;
  const [updated] = await db.update(usersTable).set({ name, phone, role, isActive, avatarUrl, updatedAt: new Date() }).where(eq(usersTable.id, Number(req.params.id))).returning({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    phone: usersTable.phone,
    avatarUrl: usersTable.avatarUrl,
    isActive: usersTable.isActive,
    restaurantId: usersTable.restaurantId,
    lastLoginAt: usersTable.lastLoginAt,
    createdAt: usersTable.createdAt,
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/users/:id", async (req, res) => {
  await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, Number(req.params.id)));
  res.status(204).send();
});

router.get("/restaurants/:restaurantId/staff", async (req, res) => {
  const { role } = req.query;
  const conditions: ReturnType<typeof eq>[] = [eq(usersTable.restaurantId, Number(req.params.restaurantId))];
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
