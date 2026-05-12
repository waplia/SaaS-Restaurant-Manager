import { Router } from "express";
import { eq, and, or } from "drizzle-orm";
import { db, rolesTable, permissionsTable, rolePermissionsTable } from "../lib/db";
import { requireRole, requireSuperAdmin } from "../middleware/authorize";

const router = Router();

function tenantGuard(
  req: Express.Request,
  roleTenantId: number | null,
): boolean {
  if (req.user!.isSuperAdmin) return true;
  if (roleTenantId === null) return true;
  return roleTenantId === req.user!.tenantId;
}

router.get("/roles", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const conditions = req.user!.isSuperAdmin
    ? undefined
    : or(
        eq(rolesTable.isSystem, true),
        eq(rolesTable.tenantId, req.user!.tenantId!),
      );
  const rows = conditions
    ? await db.select().from(rolesTable).where(conditions)
    : await db.select().from(rolesTable);
  res.json(rows);
});

router.post("/roles", requireRole("owner", "super_admin"), async (req, res) => {
  const { name, slug, description } = req.body;
  const tenantId = req.user!.isSuperAdmin ? (req.body.tenantId ?? null) : req.user!.tenantId;
  const [role] = await db.insert(rolesTable).values({ name, slug, description, tenantId }).returning();
  res.status(201).json(role);
});

router.get("/roles/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, Number(req.params.id)));
  if (!role) return void res.status(404).json({ error: "Not found" });
  if (!tenantGuard(req, role.tenantId)) return void res.status(403).json({ error: "Access denied" });
  const permRows = await db
    .select({ permission: permissionsTable })
    .from(rolePermissionsTable)
    .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
    .where(eq(rolePermissionsTable.roleId, role.id));
  res.json({ ...role, permissions: permRows.map(r => r.permission) });
});

router.patch("/roles/:id", requireRole("owner", "super_admin"), async (req, res) => {
  const [existing] = await db.select().from(rolesTable).where(eq(rolesTable.id, Number(req.params.id)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  if (existing.isSystem) return void res.status(403).json({ error: "Cannot modify system roles" });
  if (!tenantGuard(req, existing.tenantId)) return void res.status(403).json({ error: "Access denied" });
  const { name, description } = req.body;
  const [updated] = await db.update(rolesTable).set({ name, description, updatedAt: new Date() }).where(eq(rolesTable.id, Number(req.params.id))).returning();
  res.json(updated);
});

router.delete("/roles/:id", requireRole("owner", "super_admin"), async (req, res) => {
  const [existing] = await db.select().from(rolesTable).where(eq(rolesTable.id, Number(req.params.id)));
  if (!existing) return void res.status(404).json({ error: "Not found" });
  if (existing.isSystem) return void res.status(403).json({ error: "Cannot delete system roles" });
  if (!tenantGuard(req, existing.tenantId)) return void res.status(403).json({ error: "Access denied" });
  await db.delete(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, Number(req.params.id)));
  await db.delete(rolesTable).where(eq(rolesTable.id, Number(req.params.id)));
  res.status(204).send();
});

router.get("/permissions", requireRole("owner", "manager", "super_admin"), async (_req, res) => {
  const rows = await db.select().from(permissionsTable);
  res.json(rows);
});

router.get("/roles/:id/permissions", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, Number(req.params.id)));
  if (!role) return void res.status(404).json({ error: "Not found" });
  if (!tenantGuard(req, role.tenantId)) return void res.status(403).json({ error: "Access denied" });
  const permRows = await db
    .select({ permission: permissionsTable })
    .from(rolePermissionsTable)
    .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
    .where(eq(rolePermissionsTable.roleId, role.id));
  res.json(permRows.map(r => r.permission));
});

router.post("/roles/:id/permissions", requireRole("owner", "super_admin"), async (req, res) => {
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, Number(req.params.id)));
  if (!role) return void res.status(404).json({ error: "Not found" });
  if (!tenantGuard(req, role.tenantId)) return void res.status(403).json({ error: "Access denied" });
  const { permissionId } = req.body;
  const [entry] = await db.insert(rolePermissionsTable).values({ roleId: Number(req.params.id), permissionId }).onConflictDoNothing().returning();
  res.status(201).json(entry ?? { roleId: Number(req.params.id), permissionId });
});

router.delete("/roles/:id/permissions/:permissionId", requireRole("owner", "super_admin"), async (req, res) => {
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, Number(req.params.id)));
  if (!role) return void res.status(404).json({ error: "Not found" });
  if (!tenantGuard(req, role.tenantId)) return void res.status(403).json({ error: "Access denied" });
  await db.delete(rolePermissionsTable).where(and(eq(rolePermissionsTable.roleId, Number(req.params.id)), eq(rolePermissionsTable.permissionId, Number(req.params.permissionId))));
  res.status(204).send();
});

export default router;
