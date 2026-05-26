/**
 * POS Counter (workstation) management endpoints (Option B).
 *
 * A "counter" is a physical cash register / POS workstation at an outlet
 * — NOT a Stripe card reader (those live in `devicesTable` with
 * `type = 'card_terminal'` and are served from /terminals).
 *
 * Surface:
 *   GET    /restaurants/:r/counters                  → list active counters
 *   POST   /restaurants/:r/counters                  → create a counter
 *   PATCH  /restaurants/:r/counters/:id              → rename / move / activate
 *   DELETE /restaurants/:r/counters/:id              → soft-delete
 *   POST   /restaurants/:r/counters/:id/claim        → bind to a machineId (desktop POS)
 *   POST   /restaurants/:r/counters/:id/unclaim      → release the binding (admin only)
 *   POST   /restaurants/:r/counters/:id/heartbeat    → desktop POS pings (lastSeenAt + appVersion)
 *   GET    /restaurants/:r/counters/by-machine/:mid  → lookup a counter for a given desktop install
 */
import { Router } from "express";
import { and, eq, isNull, asc } from "drizzle-orm";
import { z } from "zod";
import { db, countersTable, branchesTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { validate } from "../middleware/validate";
import { recordAuditLog } from "../lib/audit";

const router = Router();

const READ_ROLES = ["owner", "manager", "cashier", "waiter", "kitchen", "super_admin"] as const;
const WRITE_ROLES = ["owner", "manager", "super_admin"] as const;

router.use(
  "/restaurants/:restaurantId/counters",
  requireRole(...READ_ROLES),
  validateRestaurantAccess,
);

function canWrite(req: { user?: { role?: string; isSuperAdmin?: boolean } }): boolean {
  return Boolean(req.user?.isSuperAdmin || (req.user?.role && (WRITE_ROLES as readonly string[]).includes(req.user.role)));
}

// ─── List ────────────────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/counters", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const branchIdParam = req.query.branchId ? Number(req.query.branchId) : null;
  const where = [
    eq(countersTable.restaurantId, restaurantId),
    isNull(countersTable.deletedAt),
  ];
  if (branchIdParam && !Number.isNaN(branchIdParam)) {
    where.push(eq(countersTable.branchId, branchIdParam));
  }
  const rows = await db.select().from(countersTable)
    .where(and(...where))
    .orderBy(asc(countersTable.name));
  res.json(rows);
});

// ─── Lookup by machineId (used by desktop POS on launch) ─────────────
router.get("/restaurants/:restaurantId/counters/by-machine/:machineId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const machineId = String(req.params.machineId);
  const [row] = await db.select().from(countersTable)
    .where(and(
      eq(countersTable.restaurantId, restaurantId),
      eq(countersTable.machineId, machineId),
      isNull(countersTable.deletedAt),
    ))
    .limit(1);
  if (!row) { res.status(404).json({ error: "No counter is bound to this machine" }); return; }
  res.json(row);
});

// ─── Create ──────────────────────────────────────────────────────────
const CreateCounterBody = z.object({
  name: z.string().trim().min(1).max(60),
  branchId: z.number().int().positive().nullable().optional(),
  description: z.string().trim().max(240).optional().nullable(),
  isActive: z.boolean().optional(),
});

router.post(
  "/restaurants/:restaurantId/counters",
  validate({ body: CreateCounterBody }),
  async (req, res) => {
    if (!canWrite(req)) { res.status(403).json({ error: "Forbidden" }); return; }
    const restaurantId = Number(req.params.restaurantId);
    const body = req.body as z.infer<typeof CreateCounterBody>;

    if (body.branchId != null) {
      const [branch] = await db.select({ id: branchesTable.id }).from(branchesTable)
        .where(and(eq(branchesTable.id, body.branchId), eq(branchesTable.restaurantId, restaurantId)))
        .limit(1);
      if (!branch) { res.status(400).json({ error: "branchId does not belong to this restaurant" }); return; }
    }

    const [row] = await db.insert(countersTable).values({
      restaurantId,
      branchId: body.branchId ?? null,
      name: body.name,
      description: body.description ?? null,
      isActive: body.isActive ?? true,
    }).returning();

    await recordAuditLog({
      req, module: "counters", action: "counter.created", entity: "counter",
      entityId: row.id, restaurantId, newValue: row,
    }).catch(() => { /* audit best-effort */ });

    res.status(201).json(row);
  },
);

// ─── Update ──────────────────────────────────────────────────────────
const PatchCounterBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  branchId: z.number().int().positive().nullable().optional(),
  description: z.string().trim().max(240).nullable().optional(),
  isActive: z.boolean().optional(),
});

router.patch(
  "/restaurants/:restaurantId/counters/:id",
  validate({ body: PatchCounterBody }),
  async (req, res) => {
    if (!canWrite(req)) { res.status(403).json({ error: "Forbidden" }); return; }
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof PatchCounterBody>;

    if (body.branchId != null) {
      const [branch] = await db.select({ id: branchesTable.id }).from(branchesTable)
        .where(and(eq(branchesTable.id, body.branchId), eq(branchesTable.restaurantId, restaurantId)))
        .limit(1);
      if (!branch) { res.status(400).json({ error: "branchId does not belong to this restaurant" }); return; }
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.branchId !== undefined) patch.branchId = body.branchId;
    if (body.description !== undefined) patch.description = body.description;
    if (body.isActive !== undefined) patch.isActive = body.isActive;

    const [row] = await db.update(countersTable).set(patch)
      .where(and(
        eq(countersTable.id, id),
        eq(countersTable.restaurantId, restaurantId),
        isNull(countersTable.deletedAt),
      ))
      .returning();
    if (!row) { res.status(404).json({ error: "Counter not found" }); return; }

    await recordAuditLog({
      req, module: "counters", action: "counter.updated", entity: "counter",
      entityId: id, restaurantId, newValue: row,
    }).catch(() => { /* audit best-effort */ });

    res.json(row);
  },
);

// ─── Soft-delete ─────────────────────────────────────────────────────
router.delete("/restaurants/:restaurantId/counters/:id", async (req, res) => {
  if (!canWrite(req)) { res.status(403).json({ error: "Forbidden" }); return; }
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [row] = await db.update(countersTable)
    .set({ deletedAt: new Date(), isActive: false, machineId: null, updatedAt: new Date() })
    .where(and(
      eq(countersTable.id, id),
      eq(countersTable.restaurantId, restaurantId),
      isNull(countersTable.deletedAt),
    ))
    .returning({ id: countersTable.id });
  if (!row) { res.status(404).json({ error: "Counter not found" }); return; }

  await recordAuditLog({
    req, module: "counters", action: "counter.deleted", entity: "counter",
    entityId: id, restaurantId,
  }).catch(() => { /* audit best-effort */ });

  res.json({ ok: true });
});

// ─── Claim (desktop POS binds this counter to its machineId) ─────────
const ClaimBody = z.object({
  machineId: z.string().trim().min(8).max(80),
  appVersion: z.string().trim().max(40).optional(),
});

router.post(
  "/restaurants/:restaurantId/counters/:id/claim",
  validate({ body: ClaimBody }),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { machineId, appVersion } = req.body as z.infer<typeof ClaimBody>;

    const [existing] = await db.select().from(countersTable)
      .where(and(
        eq(countersTable.id, id),
        eq(countersTable.restaurantId, restaurantId),
        isNull(countersTable.deletedAt),
      ))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Counter not found" }); return; }
    if (!existing.isActive) { res.status(409).json({ error: "Counter is inactive — ask your manager to re-enable it" }); return; }
    if (existing.machineId && existing.machineId !== machineId) {
      res.status(409).json({
        error: "This counter is already bound to a different workstation. Ask your manager to release it from Settings → Counters before re-binding.",
      });
      return;
    }

    const [row] = await db.update(countersTable)
      .set({ machineId, appVersion: appVersion ?? existing.appVersion, lastSeenAt: new Date(), updatedAt: new Date() })
      .where(eq(countersTable.id, id))
      .returning();

    await recordAuditLog({
      req, module: "counters", action: "counter.claimed", entity: "counter",
      entityId: id, restaurantId, newValue: { machineId, appVersion: appVersion ?? null },
    }).catch(() => { /* audit best-effort */ });

    res.json(row);
  },
);

// ─── Unclaim (admin releases the machineId binding) ──────────────────
router.post("/restaurants/:restaurantId/counters/:id/unclaim", async (req, res) => {
  if (!canWrite(req)) { res.status(403).json({ error: "Forbidden" }); return; }
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [row] = await db.update(countersTable)
    .set({ machineId: null, updatedAt: new Date() })
    .where(and(
      eq(countersTable.id, id),
      eq(countersTable.restaurantId, restaurantId),
      isNull(countersTable.deletedAt),
    ))
    .returning();
  if (!row) { res.status(404).json({ error: "Counter not found" }); return; }

  await recordAuditLog({
    req, module: "counters", action: "counter.unclaimed", entity: "counter",
    entityId: id, restaurantId,
  }).catch(() => { /* audit best-effort */ });

  res.json(row);
});

// ─── Heartbeat (desktop POS pings every few minutes while online) ────
const HeartbeatBody = z.object({
  machineId: z.string().trim().min(8).max(80),
  appVersion: z.string().trim().max(40).optional(),
});
router.post(
  "/restaurants/:restaurantId/counters/:id/heartbeat",
  validate({ body: HeartbeatBody }),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { machineId, appVersion } = req.body as z.infer<typeof HeartbeatBody>;
    const [row] = await db.update(countersTable)
      .set({ lastSeenAt: new Date(), appVersion: appVersion ?? undefined })
      .where(and(
        eq(countersTable.id, id),
        eq(countersTable.restaurantId, restaurantId),
        eq(countersTable.machineId, machineId),
        isNull(countersTable.deletedAt),
      ))
      .returning({ id: countersTable.id, lastSeenAt: countersTable.lastSeenAt });
    if (!row) { res.status(404).json({ error: "Counter binding lost — re-claim required" }); return; }
    res.json(row);
  },
);

export default router;
