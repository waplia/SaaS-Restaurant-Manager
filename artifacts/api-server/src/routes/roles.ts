import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, rolesTable, permissionsTable, rolePermissionsTable } from "../lib/db";

const router = Router();

router.get("/roles", async (req, res) => {
  const { tenantId } = req.query;
  const rows = tenantId
    ? await db.select().from(rolesTable).where(eq(rolesTable.tenantId, Number(tenantId)))
    : await db.select().from(rolesTable).where(eq(rolesTable.isSystem, true));
  res.json(rows);
});

router.post("/roles", async (req, res) => {
  const { name, slug, description, tenantId } = req.body;
  const [role] = await db.insert(rolesTable).values({ name, slug, description, tenantId }).returning();
  res.status(201).json(role);
});

router.get("/roles/:id", async (req, res) => {
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, Number(req.params.id)));
  if (!role) return void res.status(404).json({ error: "Not found" });
  const permRows = await db
    .select({ permission: permissionsTable })
    .from(rolePermissionsTable)
    .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
    .where(eq(rolePermissionsTable.roleId, role.id));
  res.json({ ...role, permissions: permRows.map(r => r.permission) });
});

router.patch("/roles/:id", async (req, res) => {
  const { name, description } = req.body;
  const [updated] = await db.update(rolesTable).set({ name, description, updatedAt: new Date() }).where(eq(rolesTable.id, Number(req.params.id))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/roles/:id", async (req, res) => {
  await db.delete(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, Number(req.params.id)));
  await db.delete(rolesTable).where(and(eq(rolesTable.id, Number(req.params.id)), eq(rolesTable.isSystem, false)));
  res.status(204).send();
});

router.get("/permissions", async (_req, res) => {
  const rows = await db.select().from(permissionsTable);
  res.json(rows);
});

router.post("/roles/:id/permissions", async (req, res) => {
  const { permissionId } = req.body;
  const [entry] = await db.insert(rolePermissionsTable).values({ roleId: Number(req.params.id), permissionId }).onConflictDoNothing().returning();
  res.status(201).json(entry ?? { roleId: Number(req.params.id), permissionId });
});

router.delete("/roles/:id/permissions/:permissionId", async (req, res) => {
  await db.delete(rolePermissionsTable).where(and(eq(rolePermissionsTable.roleId, Number(req.params.id)), eq(rolePermissionsTable.permissionId, Number(req.params.permissionId))));
  res.status(204).send();
});

export default router;
