import { Router } from "express";
import { eq, and, desc, gte, lte, sql, inArray } from "drizzle-orm";
import {
  db,
  leavePoliciesTable,
  leaveBalancesTable,
  leaveRequestsTable,
  attendanceTable,
  usersTable,
  auditLogsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { pushToStaff, pushToUserIds } from "../lib/pushNotify";

const router = Router();

const ALLOWED_STATUSES = new Set(["pending", "approved", "rejected", "cancelled"]);

async function audit(
  restaurantId: number,
  userId: number | null,
  action: string,
  entity: string,
  entityId: number | null,
  details?: unknown,
  ip?: string,
) {
  try {
    await db.insert(auditLogsTable).values({
      restaurantId,
      userId,
      action,
      entity,
      entityId: entityId ?? undefined,
      details: details ? JSON.stringify(details) : undefined,
      ipAddress: ip,
    });
  } catch {
    /* never break */
  }
}

async function userBelongsToRestaurant(userId: number, restaurantId: number): Promise<boolean> {
  if (!userId || !restaurantId) return false;
  const [u] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.restaurantId, restaurantId)))
    .limit(1);
  return !!u;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Enumerate calendar dates from `from` to `to` inclusive at 09:00 local. */
function enumerateDays(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const cur = startOfDay(from);
  const end = startOfDay(to);
  while (cur.getTime() <= end.getTime()) {
    const d = new Date(cur);
    d.setHours(9, 0, 0, 0);
    out.push(d);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function daysBetween(from: Date, to: Date, halfDay: boolean): number {
  const a = startOfDay(from).getTime();
  const b = startOfDay(to).getTime();
  if (b < a) return 0;
  const inclusive = Math.round((b - a) / 86400000) + 1;
  return halfDay ? Math.max(0.5, inclusive - 0.5) : inclusive;
}

router.use(
  "/restaurants/:restaurantId",
  requireRole("owner", "manager", "waiter", "kitchen", "cashier", "delivery_executive", "super_admin"),
  validateRestaurantAccess,
);

// ---------- Leave policies ----------

router.get("/restaurants/:restaurantId/leave-policies", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select()
    .from(leavePoliciesTable)
    .where(eq(leavePoliciesTable.restaurantId, restaurantId))
    .orderBy(leavePoliciesTable.label);
  res.json(rows);
});

router.post(
  "/restaurants/:restaurantId/leave-policies",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { leaveType, label, isPaid, entitlementDays, carryForwardMax } = req.body ?? {};
    if (!leaveType || !label) {
      res.status(400).json({ error: "leaveType and label are required" });
      return;
    }
    try {
      const [row] = await db
        .insert(leavePoliciesTable)
        .values({
          restaurantId,
          leaveType: String(leaveType).toLowerCase(),
          label: String(label),
          isPaid: !!isPaid,
          entitlementDays: Math.max(0, Number(entitlementDays) || 0),
          carryForwardMax: Math.max(0, Number(carryForwardMax) || 0),
        })
        .returning();
      await audit(restaurantId, req.user?.sub ?? null, "create", "leave_policy", row.id, req.body, req.ip);
      res.status(201).json(row);
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "";
      if (msg.includes("unique") || msg.includes("duplicate")) {
        res.status(409).json({ error: "A policy with that leaveType already exists" });
        return;
      }
      throw e;
    }
  },
);

router.patch(
  "/restaurants/:restaurantId/leave-policies/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { label, isPaid, entitlementDays, carryForwardMax, isActive } = req.body ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (label !== undefined) patch.label = String(label);
    if (isPaid !== undefined) patch.isPaid = !!isPaid;
    if (entitlementDays !== undefined) patch.entitlementDays = Math.max(0, Number(entitlementDays) || 0);
    if (carryForwardMax !== undefined) patch.carryForwardMax = Math.max(0, Number(carryForwardMax) || 0);
    if (isActive !== undefined) patch.isActive = !!isActive;
    const [row] = await db
      .update(leavePoliciesTable)
      .set(patch)
      .where(and(eq(leavePoliciesTable.id, id), eq(leavePoliciesTable.restaurantId, restaurantId)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await audit(restaurantId, req.user?.sub ?? null, "update", "leave_policy", id, req.body, req.ip);
    res.json(row);
  },
);

router.delete(
  "/restaurants/:restaurantId/leave-policies/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    await db
      .update(leavePoliciesTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(leavePoliciesTable.id, id), eq(leavePoliciesTable.restaurantId, restaurantId)));
    await audit(restaurantId, req.user?.sub ?? null, "delete", "leave_policy", id, null, req.ip);
    res.status(204).send();
  },
);

// ---------- Leave balances ----------

router.get("/restaurants/:restaurantId/leave-balances", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const callerId = req.user?.sub ?? 0;
  const isPrivileged = req.user?.isSuperAdmin || ["owner", "manager", "super_admin"].includes(req.user?.role ?? "");
  const year = Number(req.query.year) || new Date().getFullYear();
  const queryUserId = req.query.userId ? Number(req.query.userId) : null;
  const targetUserId = queryUserId ?? callerId;
  if (!isPrivileged && targetUserId !== callerId) {
    res.status(403).json({ error: "Cannot view balances for another user" });
    return;
  }
  const rows = await db
    .select()
    .from(leaveBalancesTable)
    .where(
      and(
        eq(leaveBalancesTable.restaurantId, restaurantId),
        eq(leaveBalancesTable.userId, targetUserId),
        eq(leaveBalancesTable.year, year),
      ),
    );
  res.json(rows);
});

router.post(
  "/restaurants/:restaurantId/leave-balances",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { userId, year, leaveType, opening } = req.body ?? {};
    if (!userId || !year || !leaveType) {
      res.status(400).json({ error: "userId, year, leaveType are required" });
      return;
    }
    if (!(await userBelongsToRestaurant(Number(userId), restaurantId))) {
      res.status(403).json({ error: "User does not belong to this restaurant" });
      return;
    }
    const op = String(Math.max(0, Number(opening) || 0));
    const [existing] = await db
      .select()
      .from(leaveBalancesTable)
      .where(
        and(
          eq(leaveBalancesTable.restaurantId, restaurantId),
          eq(leaveBalancesTable.userId, Number(userId)),
          eq(leaveBalancesTable.year, Number(year)),
          eq(leaveBalancesTable.leaveType, String(leaveType)),
        ),
      );
    if (existing) {
      const [updated] = await db
        .update(leaveBalancesTable)
        .set({ opening: op, updatedAt: new Date() })
        .where(eq(leaveBalancesTable.id, existing.id))
        .returning();
      await audit(restaurantId, req.user?.sub ?? null, "update", "leave_balance", updated.id, req.body, req.ip);
      res.json(updated);
      return;
    }
    const [row] = await db
      .insert(leaveBalancesTable)
      .values({
        restaurantId,
        userId: Number(userId),
        year: Number(year),
        leaveType: String(leaveType),
        opening: op,
        used: "0",
      })
      .returning();
    await audit(restaurantId, req.user?.sub ?? null, "create", "leave_balance", row.id, req.body, req.ip);
    res.status(201).json(row);
  },
);

// ---------- Leave requests ----------

router.get("/restaurants/:restaurantId/leave-requests", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const callerId = req.user?.sub ?? 0;
  const isPrivileged = req.user?.isSuperAdmin || ["owner", "manager", "super_admin"].includes(req.user?.role ?? "");
  const { status, userId } = req.query;
  const conditions = [eq(leaveRequestsTable.restaurantId, restaurantId)];
  if (!isPrivileged) {
    conditions.push(eq(leaveRequestsTable.userId, callerId));
  } else if (userId) {
    conditions.push(eq(leaveRequestsTable.userId, Number(userId)));
  }
  if (status && ALLOWED_STATUSES.has(String(status))) {
    conditions.push(eq(leaveRequestsTable.status, String(status)));
  }
  const rows = await db
    .select()
    .from(leaveRequestsTable)
    .where(and(...conditions))
    .orderBy(desc(leaveRequestsTable.createdAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/leave-requests", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const callerId = req.user?.sub ?? 0;
  const isPrivileged = req.user?.isSuperAdmin || ["owner", "manager", "super_admin"].includes(req.user?.role ?? "");
  const { userId, leaveType, fromDate, toDate, halfDay, reason } = req.body ?? {};
  const targetUserId = Number(userId ?? callerId);
  if (!isPrivileged && targetUserId !== callerId) {
    res.status(403).json({ error: "Cannot submit a leave request for another user" });
    return;
  }
  if (targetUserId !== callerId && !(await userBelongsToRestaurant(targetUserId, restaurantId))) {
    res.status(403).json({ error: "Target user not in this restaurant" });
    return;
  }
  if (!leaveType || !fromDate || !toDate) {
    res.status(400).json({ error: "leaveType, fromDate, toDate are required" });
    return;
  }
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    res.status(400).json({ error: "Invalid date range" });
    return;
  }
  const isHalf = !!halfDay;
  if (isHalf && startOfDay(from).getTime() !== startOfDay(to).getTime()) {
    res.status(400).json({ error: "Half-day requests must be a single date" });
    return;
  }
  const totalDays = daysBetween(from, to, isHalf);
  const [row] = await db
    .insert(leaveRequestsTable)
    .values({
      restaurantId,
      userId: targetUserId,
      leaveType: String(leaveType),
      fromDate: startOfDay(from),
      toDate: endOfDay(to),
      halfDay: isHalf,
      totalDays: String(totalDays),
      reason: reason ? String(reason) : null,
      status: "pending",
    })
    .returning();
  await audit(restaurantId, callerId || null, "create", "leave_request", row.id, { leaveType, fromDate, toDate, halfDay: isHalf, totalDays }, req.ip);

  // Notify managers/owners of a new pending request.
  pushToStaff(
    { restaurantId, roles: ["owner", "manager"], type: "leave_request" },
    {
      title: "New leave request",
      body: `${String(leaveType)} • ${totalDays} day${totalDays === 1 ? "" : "s"}`,
      data: { screen: "leaves", requestId: row.id },
    },
  ).catch(() => {});

  res.status(201).json(row);
});

router.post(
  "/restaurants/:restaurantId/leave-requests/:id/approve",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const callerId = req.user?.sub ?? null;
    const decisionNote = req.body?.decisionNote ? String(req.body.decisionNote) : null;

    const result = await db.transaction(async (tx) => {
      const [reqRow] = await tx
        .select()
        .from(leaveRequestsTable)
        .where(and(eq(leaveRequestsTable.id, id), eq(leaveRequestsTable.restaurantId, restaurantId)))
        .limit(1);
      if (!reqRow) return { error: "not_found" as const };
      if (reqRow.status !== "pending") return { error: "not_pending" as const };

      const [policy] = await tx
        .select()
        .from(leavePoliciesTable)
        .where(
          and(
            eq(leavePoliciesTable.restaurantId, restaurantId),
            eq(leavePoliciesTable.leaveType, reqRow.leaveType),
          ),
        )
        .limit(1);

      const totalDays = Number(reqRow.totalDays);

      // Write `leave` rows into attendance for each covered date.
      // Upsert by (user, day) so we don't duplicate existing attendance rows.
      const days = enumerateDays(reqRow.fromDate, reqRow.toDate);
      for (const day of days) {
        const dayStart = startOfDay(day);
        const dayEnd = endOfDay(day);
        const [existing] = await tx
          .select()
          .from(attendanceTable)
          .where(
            and(
              eq(attendanceTable.restaurantId, restaurantId),
              eq(attendanceTable.userId, reqRow.userId),
              gte(attendanceTable.clockIn, dayStart),
              lte(attendanceTable.clockIn, dayEnd),
            ),
          )
          .limit(1);
        if (existing) {
          // Don't overwrite real worked attendance — preserve the existing
          // record. Only convert rows that represent an absence or weekly-off.
          if (existing.status === "absent" || existing.status === "weekly_off" || existing.status === "leave") {
            await tx
              .update(attendanceTable)
              .set({
                status: "leave",
                workedMinutes: 0,
                overtimeMinutes: 0,
                lateMinutes: 0,
                scheduledMinutes: 0,
                scheduledShiftId: null,
                clockOut: existing.clockIn,
                totalHours: "0",
                source: "manual",
                markedByUserId: callerId,
                notes: `Approved leave #${id}${reqRow.reason ? `: ${reqRow.reason}` : ""}`,
                updatedAt: new Date(),
              })
              .where(eq(attendanceTable.id, existing.id));
          }
          // else: user already has present/late/half_day for this day — keep it.
        } else {
          await tx.insert(attendanceTable).values({
            userId: reqRow.userId,
            restaurantId,
            date: day,
            clockIn: day,
            clockOut: day,
            status: "leave",
            source: "manual",
            markedByUserId: callerId,
            notes: `Approved leave #${id}${reqRow.reason ? `: ${reqRow.reason}` : ""}`,
          });
        }
      }

      // Decrement the matching balance (only if the policy is paid OR a balance row exists).
      const year = reqRow.fromDate.getFullYear();
      const [bal] = await tx
        .select()
        .from(leaveBalancesTable)
        .where(
          and(
            eq(leaveBalancesTable.restaurantId, restaurantId),
            eq(leaveBalancesTable.userId, reqRow.userId),
            eq(leaveBalancesTable.year, year),
            eq(leaveBalancesTable.leaveType, reqRow.leaveType),
          ),
        )
        .limit(1);
      if (bal) {
        await tx
          .update(leaveBalancesTable)
          .set({
            used: sql`${leaveBalancesTable.used} + ${totalDays}`,
            updatedAt: new Date(),
          })
          .where(eq(leaveBalancesTable.id, bal.id));
      } else if (policy?.isPaid && (policy.entitlementDays ?? 0) > 0) {
        // Seed an opening balance from policy entitlement so the deduction is visible.
        await tx.insert(leaveBalancesTable).values({
          restaurantId,
          userId: reqRow.userId,
          year,
          leaveType: reqRow.leaveType,
          opening: String(policy.entitlementDays),
          used: String(totalDays),
        });
      }

      const [updated] = await tx
        .update(leaveRequestsTable)
        .set({
          status: "approved",
          decidedByUserId: callerId,
          decidedAt: new Date(),
          decisionNote,
          updatedAt: new Date(),
        })
        .where(eq(leaveRequestsTable.id, id))
        .returning();

      return { row: updated };
    });

    if ("error" in result) {
      if (result.error === "not_found") {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(400).json({ error: "Only pending requests can be approved" });
      return;
    }

    await audit(restaurantId, callerId, "approve", "leave_request", id, { decisionNote }, req.ip);

    pushToUserIds([result.row.userId], "leave_decision", {
      title: "Leave approved",
      body: result.row.decisionNote ?? "Your leave request was approved",
      data: { screen: "leaves", requestId: id, status: "approved" },
    }).catch(() => {});

    res.json(result.row);
  },
);

router.post(
  "/restaurants/:restaurantId/leave-requests/:id/reject",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const callerId = req.user?.sub ?? null;
    const decisionNote = req.body?.decisionNote ? String(req.body.decisionNote) : null;

    const result = await db.transaction(async (tx) => {
      const [reqRow] = await tx
        .select()
        .from(leaveRequestsTable)
        .where(and(eq(leaveRequestsTable.id, id), eq(leaveRequestsTable.restaurantId, restaurantId)))
        .limit(1);
      if (!reqRow) return { error: "not_found" as const };
      if (reqRow.status === "approved") {
        // Reverse: delete the leave attendance rows + reinstate balance.
        const days = enumerateDays(reqRow.fromDate, reqRow.toDate);
        for (const day of days) {
          const dayStart = startOfDay(day);
          const dayEnd = endOfDay(day);
          await tx
            .delete(attendanceTable)
            .where(
              and(
                eq(attendanceTable.restaurantId, restaurantId),
                eq(attendanceTable.userId, reqRow.userId),
                eq(attendanceTable.status, "leave"),
                gte(attendanceTable.clockIn, dayStart),
                lte(attendanceTable.clockIn, dayEnd),
              ),
            );
        }
        const year = reqRow.fromDate.getFullYear();
        const totalDays = Number(reqRow.totalDays);
        await tx
          .update(leaveBalancesTable)
          .set({
            used: sql`GREATEST(0, ${leaveBalancesTable.used} - ${totalDays})`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(leaveBalancesTable.restaurantId, restaurantId),
              eq(leaveBalancesTable.userId, reqRow.userId),
              eq(leaveBalancesTable.year, year),
              eq(leaveBalancesTable.leaveType, reqRow.leaveType),
            ),
          );
      }

      const [updated] = await tx
        .update(leaveRequestsTable)
        .set({
          status: "rejected",
          decidedByUserId: callerId,
          decidedAt: new Date(),
          decisionNote,
          updatedAt: new Date(),
        })
        .where(eq(leaveRequestsTable.id, id))
        .returning();
      return { row: updated };
    });

    if ("error" in result) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    await audit(restaurantId, callerId, "reject", "leave_request", id, { decisionNote }, req.ip);
    pushToUserIds([result.row.userId], "leave_decision", {
      title: "Leave rejected",
      body: decisionNote ?? "Your leave request was rejected",
      data: { screen: "leaves", requestId: id, status: "rejected" },
    }).catch(() => {});
    res.json(result.row);
  },
);

router.post("/restaurants/:restaurantId/leave-requests/:id/cancel", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const callerId = req.user?.sub ?? 0;
  const isPrivileged = req.user?.isSuperAdmin || ["owner", "manager", "super_admin"].includes(req.user?.role ?? "");

  const result = await db.transaction(async (tx) => {
    const [reqRow] = await tx
      .select()
      .from(leaveRequestsTable)
      .where(and(eq(leaveRequestsTable.id, id), eq(leaveRequestsTable.restaurantId, restaurantId)))
      .limit(1);
    if (!reqRow) return { error: "not_found" as const };
    if (!isPrivileged && reqRow.userId !== callerId) return { error: "forbidden" as const };
    if (reqRow.status === "cancelled" || reqRow.status === "rejected") return { row: reqRow };

    if (reqRow.status === "approved") {
      const days = enumerateDays(reqRow.fromDate, reqRow.toDate);
      for (const day of days) {
        const dayStart = startOfDay(day);
        const dayEnd = endOfDay(day);
        await tx
          .delete(attendanceTable)
          .where(
            and(
              eq(attendanceTable.restaurantId, restaurantId),
              eq(attendanceTable.userId, reqRow.userId),
              eq(attendanceTable.status, "leave"),
              gte(attendanceTable.clockIn, dayStart),
              lte(attendanceTable.clockIn, dayEnd),
            ),
          );
      }
      const year = reqRow.fromDate.getFullYear();
      const totalDays = Number(reqRow.totalDays);
      await tx
        .update(leaveBalancesTable)
        .set({
          used: sql`GREATEST(0, ${leaveBalancesTable.used} - ${totalDays})`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(leaveBalancesTable.restaurantId, restaurantId),
            eq(leaveBalancesTable.userId, reqRow.userId),
            eq(leaveBalancesTable.year, year),
            eq(leaveBalancesTable.leaveType, reqRow.leaveType),
          ),
        );
    }

    const [updated] = await tx
      .update(leaveRequestsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(leaveRequestsTable.id, id))
      .returning();
    return { row: updated };
  });

  if ("error" in result) {
    if (result.error === "forbidden") {
      res.status(403).json({ error: "Cannot cancel another user's request" });
      return;
    }
    res.status(404).json({ error: "Not found" });
    return;
  }
  await audit(restaurantId, callerId || null, "cancel", "leave_request", id, null, req.ip);
  res.json(result.row);
});

export default router;
