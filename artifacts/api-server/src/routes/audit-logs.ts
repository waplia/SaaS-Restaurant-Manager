import { Router } from "express";
import { eq, and, desc, sql, type SQL, gte, lte, ilike, or } from "drizzle-orm";
import { db, auditLogsTable, usersTable, restaurantsTable } from "../lib/db";
import { requireRole, requireSuperAdmin } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

function parseDate(s: unknown): Date | null {
  if (typeof s !== "string" || !s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildFilters(q: Record<string, unknown>): SQL[] {
  const c: SQL[] = [];
  if (q.userId) c.push(eq(auditLogsTable.userId, Number(q.userId)));
  if (q.role) c.push(eq(auditLogsTable.role, String(q.role)));
  if (q.module) c.push(eq(auditLogsTable.module, String(q.module)));
  if (q.action) c.push(eq(auditLogsTable.action, String(q.action)));
  if (q.ip) c.push(ilike(auditLogsTable.ipAddress, `%${String(q.ip)}%`));
  const from = parseDate(q.dateFrom);
  if (from) c.push(gte(auditLogsTable.createdAt, from));
  const to = parseDate(q.dateTo);
  if (to) {
    to.setHours(23, 59, 59, 999);
    c.push(lte(auditLogsTable.createdAt, to));
  }
  if (q.q && typeof q.q === "string" && q.q.trim()) {
    const term = `%${q.q.trim()}%`;
    const cond = or(
      ilike(auditLogsTable.action, term),
      ilike(auditLogsTable.entity, term),
      ilike(auditLogsTable.userDisplay, term),
      ilike(auditLogsTable.details, term),
    );
    if (cond) c.push(cond);
  }
  return c;
}

const SELECT_COLS = {
  id: auditLogsTable.id,
  restaurantId: auditLogsTable.restaurantId,
  targetRestaurantId: auditLogsTable.targetRestaurantId,
  userId: auditLogsTable.userId,
  userDisplay: auditLogsTable.userDisplay,
  role: auditLogsTable.role,
  module: auditLogsTable.module,
  action: auditLogsTable.action,
  entity: auditLogsTable.entity,
  entityId: auditLogsTable.entityId,
  details: auditLogsTable.details,
  oldValue: auditLogsTable.oldValue,
  newValue: auditLogsTable.newValue,
  ipAddress: auditLogsTable.ipAddress,
  userAgent: auditLogsTable.userAgent,
  createdAt: auditLogsTable.createdAt,
};

// ─── Super Admin: global audit log viewer ─────────────────────────
router.get("/admin/audit-logs", requireSuperAdmin, async (req, res) => {
  const conds = buildFilters(req.query as Record<string, unknown>);
  if (req.query.restaurantId) {
    const rid = Number(req.query.restaurantId);
    const cond = or(
      eq(auditLogsTable.restaurantId, rid),
      eq(auditLogsTable.targetRestaurantId, rid),
    );
    if (cond) conds.push(cond);
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const offset = (page - 1) * limit;

  const where = conds.length ? and(...conds) : undefined;
  const [rows, totalRow] = await Promise.all([
    db.select(SELECT_COLS).from(auditLogsTable).where(where)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit).offset(offset),
    db.select({ c: sql<number>`cast(count(*) as int)` }).from(auditLogsTable).where(where),
  ]);
  res.json({ data: rows, total: totalRow[0]?.c ?? 0, page, limit });
});

router.get("/admin/audit-logs/:id", requireSuperAdmin, async (req, res) => {
  const [row] = await db.select(SELECT_COLS).from(auditLogsTable).where(eq(auditLogsTable.id, Number(req.params.id)));
  if (!row) return void res.status(404).json({ error: "Not found" });
  // Optional join: target restaurant name and user fields fresh
  let restaurantName: string | null = null;
  if (row.targetRestaurantId ?? row.restaurantId) {
    const [r] = await db.select({ name: restaurantsTable.name }).from(restaurantsTable)
      .where(eq(restaurantsTable.id, (row.targetRestaurantId ?? row.restaurantId) as number));
    restaurantName = r?.name ?? null;
  }
  let userEmail: string | null = null;
  if (row.userId) {
    const [u] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, row.userId));
    userEmail = u?.email ?? null;
  }
  res.json({ ...row, restaurantName, userEmail });
});

// ─── Restaurant-scoped audit log viewer ───────────────────────────
router.get(
  "/restaurants/:restaurantId/audit-logs",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const conds = buildFilters(req.query as Record<string, unknown>);
    conds.push(eq(auditLogsTable.restaurantId, restaurantId));

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * limit;

    const where = and(...conds);
    const [rows, totalRow] = await Promise.all([
      db.select(SELECT_COLS).from(auditLogsTable).where(where)
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(limit).offset(offset),
      db.select({ c: sql<number>`cast(count(*) as int)` }).from(auditLogsTable).where(where),
    ]);
    // Backwards compat: keep returning a plain array if `format=array` not set,
    // older callers (existing FE hook) will read paginated payload.
    res.json({ data: rows, total: totalRow[0]?.c ?? 0, page, limit });
  },
);

router.get(
  "/restaurants/:restaurantId/audit-logs/:id",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const [row] = await db.select(SELECT_COLS).from(auditLogsTable)
      .where(and(eq(auditLogsTable.id, Number(req.params.id)), eq(auditLogsTable.restaurantId, restaurantId)));
    if (!row) return void res.status(404).json({ error: "Not found" });
    res.json(row);
  },
);

export default router;
