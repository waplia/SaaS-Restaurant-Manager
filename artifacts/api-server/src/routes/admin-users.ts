// Super-admin user management. Currently exposes the "deleted accounts"
// list and a restore action used to undo the self-service account
// deletion flow (Task #573). New super-admin user actions belong here.
import { Router } from "express";
import { z } from "zod";
import { desc, eq, isNotNull } from "drizzle-orm";
import { db, usersTable, tenantsTable, restaurantsTable } from "../lib/db";
import { authenticate, invalidateTokenVersionCache } from "../middleware/authenticate";
import { requireSuperAdmin } from "../middleware/authorize";
import { validate } from "../middleware/validate";
import { logger } from "../lib/logger";

const router = Router();
router.use(authenticate, requireSuperAdmin);

router.get("/admin/users/deleted", async (_req, res) => {
  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      phone: usersTable.phone,
      role: usersTable.role,
      isActive: usersTable.isActive,
      deletedAt: usersTable.deletedAt,
      deletionReason: usersTable.deletionReason,
      tenantId: usersTable.tenantId,
      tenantName: tenantsTable.name,
      restaurantId: usersTable.restaurantId,
      restaurantName: restaurantsTable.name,
    })
    .from(usersTable)
    .leftJoin(tenantsTable, eq(tenantsTable.id, usersTable.tenantId))
    .leftJoin(restaurantsTable, eq(restaurantsTable.id, usersTable.restaurantId))
    .where(isNotNull(usersTable.deletedAt))
    .orderBy(desc(usersTable.deletedAt))
    .limit(500);
  res.json({ rows });
});

const RestoreBody = z.object({ reactivate: z.boolean().optional() });

router.post(
  "/admin/users/:id/restore",
  validate(RestoreBody),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [row] = await db.select({
      id: usersTable.id, tokenVersion: usersTable.tokenVersion, deletedAt: usersTable.deletedAt,
    }).from(usersTable).where(eq(usersTable.id, id));
    if (!row) { res.status(404).json({ error: "User not found" }); return; }
    if (!row.deletedAt) { res.status(400).json({ error: "User is not deleted." }); return; }

    try {
      await db.update(usersTable).set({
        isActive: true,
        deletedAt: null,
        deletionReason: null,
        tokenVersion: (row.tokenVersion ?? 0) + 1,
        updatedAt: new Date(),
      }).where(eq(usersTable.id, id));
      invalidateTokenVersionCache(id);
    } catch (err) {
      logger.error({ err, id }, "admin restore-user failed");
      res.status(500).json({ error: "Could not restore account." });
      return;
    }
    res.json({ ok: true });
  },
);

export default router;
