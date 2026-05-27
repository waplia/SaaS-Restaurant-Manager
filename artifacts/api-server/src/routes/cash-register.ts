import { Router, type Request, type Response, type NextFunction } from "express";
import { eq, and, desc, sql, gte, lte, inArray, isNull } from "drizzle-orm";
import {
  db, cashRegisterSessionsTable, cashMovementsTable, cashDenominationCountsTable,
  paymentsTable, ordersTable, usersTable, shiftsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

router.use(
  "/restaurants/:restaurantId/cash-register",
  requireRole("owner", "manager", "waiter", "cashier", "super_admin"),
  validateRestaurantAccess,
);

// Roles allowed to perform register operations (close, movements, reports, history).
// The cashier is the shift operator and needs to record cash in/out (drawer
// drops, paid-outs, refunds), view their session and movements, close their
// own register, and see X/Z reports — so they are included alongside
// owner/manager/super_admin. Cashier access is further scoped per-session by
// `assertSessionAccess` so a cashier can only touch sessions they opened.
const MANAGER_ROLES = ["owner", "manager", "super_admin", "cashier"] as const;
// Roles with cross-session ("see everyone's shifts") access. Cashier is
// excluded — they only see their own sessions and aggregate analytics across
// cashiers (variance history) is management-only.
const CROSS_SESSION_ROLES = ["owner", "manager", "super_admin"] as const;

// Returns true if the requester is allowed to operate on the given session.
// Owners/managers/super_admin always pass. Cashier passes only when they
// opened (or closed) the session themselves.
function canActOnSession(
  req: Request,
  session: { openedByUserId: number | null; closedByUserId: number | null },
): boolean {
  const role = req.user?.role;
  const isSuper = !!req.user?.isSuperAdmin;
  if (isSuper) return true;
  if (role === "owner" || role === "manager") return true;
  if (role === "cashier") {
    const uid = req.user?.sub ?? null;
    if (!uid) return false;
    return session.openedByUserId === uid || session.closedByUserId === uid;
  }
  return false;
}

function isCashierOnly(req: Request): boolean {
  if (req.user?.isSuperAdmin) return false;
  const role = req.user?.role;
  return role === "cashier";
}

const INR_DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

type DenomInput = { denomination: number; count: number };
// Accept either the global db handle or a transaction handle.
// Using `any` here intentionally — drizzle's PgTransaction generic doesn't
// structurally match NodePgDatabase, but they share the same insert/select API.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any;

function denomTotal(rows: DenomInput[]): number {
  return rows.reduce((s, r) => s + Number(r.denomination) * Number(r.count), 0);
}

function validateDenominations(rows: unknown): { ok: true; rows: DenomInput[] } | { ok: false; error: string } {
  if (!Array.isArray(rows)) return { ok: false, error: "denominations must be an array" };
  const out: DenomInput[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") return { ok: false, error: "Invalid denomination row" };
    const denomination = Number((r as { denomination?: unknown }).denomination);
    const count = Number((r as { count?: unknown }).count);
    if (!INR_DENOMINATIONS.includes(denomination)) {
      return { ok: false, error: `Unsupported INR denomination: ${denomination}` };
    }
    if (!Number.isInteger(count) || count < 0) {
      return { ok: false, error: "denomination count must be a non-negative integer" };
    }
    out.push({ denomination, count });
  }
  return { ok: true, rows: out };
}

async function findOpenSession(executor: DbOrTx, restaurantId: number, lockForUpdate = false) {
  // Use raw FOR UPDATE when called inside a transaction to serialize concurrent open/close.
  if (lockForUpdate) {
    const rows = await executor.execute(sql`
      SELECT * FROM ${cashRegisterSessionsTable}
      WHERE ${cashRegisterSessionsTable.restaurantId} = ${restaurantId}
        AND ${cashRegisterSessionsTable.status} = 'open'
      ORDER BY ${cashRegisterSessionsTable.openedAt} DESC
      LIMIT 1
      FOR UPDATE
    `);
    const r = (rows as unknown as { rows: Array<typeof cashRegisterSessionsTable.$inferSelect> }).rows;
    return r[0] ?? null;
  }
  const [row] = await executor.select().from(cashRegisterSessionsTable)
    .where(and(
      eq(cashRegisterSessionsTable.restaurantId, restaurantId),
      eq(cashRegisterSessionsTable.status, "open"),
    ))
    .orderBy(desc(cashRegisterSessionsTable.openedAt))
    .limit(1);
  return row ?? null;
}

async function computeSessionTotals(executor: DbOrTx, sessionId: number, restaurantId: number, openingFloat: number) {
  const movementRows = await executor.select({
    type: cashMovementsTable.type,
    total: sql<string>`cast(coalesce(sum(${cashMovementsTable.amount}), 0) as text)`,
  }).from(cashMovementsTable)
    .where(and(
      eq(cashMovementsTable.sessionId, sessionId),
      eq(cashMovementsTable.restaurantId, restaurantId),
    ))
    .groupBy(cashMovementsTable.type);

  const totalsByType: Record<string, number> = { sale: 0, refund: 0, cash_in: 0, cash_out: 0, drop: 0, payout: 0 };
  for (const r of movementRows) totalsByType[r.type] = Number(r.total);

  const cashIn = totalsByType.sale + totalsByType.cash_in;
  const cashOut = totalsByType.refund + totalsByType.cash_out + totalsByType.drop + totalsByType.payout;
  const expectedCash = openingFloat + cashIn - cashOut;

  return {
    openingFloat,
    cashSales: totalsByType.sale,
    refunds: totalsByType.refund,
    cashIn: totalsByType.cash_in,
    cashOut: totalsByType.cash_out,
    drops: totalsByType.drop,
    payouts: totalsByType.payout,
    totalCashIn: cashIn,
    totalCashOut: cashOut,
    expectedCash,
  };
}

router.get("/restaurants/:restaurantId/cash-register/current", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const session = await findOpenSession(db, restaurantId);
  if (!session) return void res.json({ session: null, totals: null });
  // Cashier can only see the open session if they opened it themselves.
  // Treat another cashier's open session as "no session" so the UI prompts
  // them to wait rather than exposing totals/identity of the other shift.
  if (isCashierOnly(req) && !canActOnSession(req, session)) {
    return void res.json({ session: null, totals: null });
  }
  const totals = await computeSessionTotals(db, session.id, restaurantId, Number(session.openingFloat));
  const [openedBy] = session.openedByUserId
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, session.openedByUserId))
    : [null];
  res.json({ session: { ...session, openedByName: openedBy?.name ?? null }, totals });
});

router.get("/restaurants/:restaurantId/cash-register/sessions",
  requireRole(...MANAGER_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { from, to, status, page = "1", pageSize = "25" } = req.query;

    const conditions = [eq(cashRegisterSessionsTable.restaurantId, restaurantId)];
    if (from) conditions.push(gte(cashRegisterSessionsTable.openedAt, new Date(String(from))));
    if (to) {
      const toDate = new Date(String(to));
      toDate.setHours(23, 59, 59, 999);
      conditions.push(lte(cashRegisterSessionsTable.openedAt, toDate));
    }
    if (status) conditions.push(eq(cashRegisterSessionsTable.status, String(status)));
    // Cashier sees only sessions they opened. Manager/owner/super_admin see all.
    if (isCashierOnly(req)) {
      const uid = req.user?.sub ?? -1;
      conditions.push(eq(cashRegisterSessionsTable.openedByUserId, uid));
    }

    const limit = Math.min(100, Math.max(1, Number(pageSize)));
    const offset = (Math.max(1, Number(page)) - 1) * limit;

    const [rows, totalRows] = await Promise.all([
      db.select().from(cashRegisterSessionsTable).where(and(...conditions))
        .orderBy(desc(cashRegisterSessionsTable.openedAt))
        .limit(limit).offset(offset),
      db.select({ c: sql<number>`cast(count(*) as int)` })
        .from(cashRegisterSessionsTable).where(and(...conditions)),
    ]);

    const userIds = [...new Set(rows.flatMap(r => [r.openedByUserId, r.closedByUserId]).filter((x): x is number => x !== null))];
    const users = userIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds))
      : [];
    const userMap = new Map(users.map(u => [u.id, u.name]));

    const enriched = rows.map(r => ({
      ...r,
      openedByName: userMap.get(r.openedByUserId) ?? null,
      closedByName: r.closedByUserId ? userMap.get(r.closedByUserId) ?? null : null,
    }));

    res.json({ data: enriched, total: totalRows[0]?.c ?? 0, page: Number(page), pageSize: limit });
  },
);

router.get("/restaurants/:restaurantId/cash-register/sessions/:id",
  requireRole(...MANAGER_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const sessionId = Number(req.params.id);

    const [session] = await db.select().from(cashRegisterSessionsTable)
      .where(and(eq(cashRegisterSessionsTable.id, sessionId), eq(cashRegisterSessionsTable.restaurantId, restaurantId)));
    if (!session) return void res.status(404).json({ error: "Session not found" });
    if (!canActOnSession(req, session)) {
      return void res.status(403).json({ error: "You can only view shifts you opened" });
    }

    const [movements, denoms, openedBy, closedBy] = await Promise.all([
      db.select().from(cashMovementsTable)
        .where(and(eq(cashMovementsTable.sessionId, sessionId), eq(cashMovementsTable.restaurantId, restaurantId)))
        .orderBy(desc(cashMovementsTable.createdAt)),
      db.select().from(cashDenominationCountsTable).where(eq(cashDenominationCountsTable.sessionId, sessionId)),
      db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, session.openedByUserId)),
      session.closedByUserId
        ? db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, session.closedByUserId))
        : Promise.resolve([] as Array<{ id: number; name: string }>),
    ]);

    const movementUserIds = [...new Set(movements.map(m => m.createdByUserId).filter((x): x is number => x !== null))];
    const movementUsers = movementUserIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, movementUserIds))
      : [];
    const movementUserMap = new Map(movementUsers.map(u => [u.id, u.name]));

    const totals = await computeSessionTotals(db, sessionId, restaurantId, Number(session.openingFloat));

    res.json({
      session: {
        ...session,
        openedByName: openedBy[0]?.name ?? null,
        closedByName: closedBy[0]?.name ?? null,
      },
      movements: movements.map(m => ({ ...m, createdByName: m.createdByUserId ? movementUserMap.get(m.createdByUserId) ?? null : null })),
      openingDenominations: denoms.filter(d => d.phase === "opening").sort((a, b) => b.denomination - a.denomination),
      closingDenominations: denoms.filter(d => d.phase === "closing").sort((a, b) => b.denomination - a.denomination),
      totals,
    });
  },
);

router.post("/restaurants/:restaurantId/cash-register/sessions/open", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = req.user?.sub;
  if (!userId) return void res.status(401).json({ error: "Authentication required" });

  const { denominations, notes, shiftId } = req.body as {
    denominations: unknown;
    notes?: string;
    shiftId?: number;
  };

  const validated = validateDenominations(denominations);
  if (!validated.ok) return void res.status(400).json({ error: validated.error });

  const openingFloat = denomTotal(validated.rows);

  if (shiftId) {
    const [shift] = await db.select({ id: shiftsTable.id }).from(shiftsTable)
      .where(and(eq(shiftsTable.id, shiftId), eq(shiftsTable.restaurantId, restaurantId)));
    if (!shift) return void res.status(400).json({ error: "Shift does not belong to this restaurant" });
  }

  try {
    const session = await db.transaction(async tx => {
      // Lock the row so concurrent opens serialize and only one wins.
      const existing = await findOpenSession(tx, restaurantId, true);
      if (existing) {
        const err = new Error("ALREADY_OPEN") as Error & { sessionId: number };
        err.sessionId = existing.id;
        throw err;
      }
      const [row] = await tx.insert(cashRegisterSessionsTable).values({
        restaurantId,
        openedByUserId: userId,
        openingFloat: openingFloat.toFixed(2),
        status: "open",
        notes: notes ?? null,
        shiftId: shiftId ?? null,
      }).returning();

      if (validated.rows.length > 0) {
        await tx.insert(cashDenominationCountsTable).values(
          validated.rows.map(d => ({ sessionId: row.id, phase: "opening", denomination: d.denomination, count: d.count }))
        );
      }
      return row;
    });
    res.status(201).json(session);
  } catch (e) {
    if ((e as Error).message === "ALREADY_OPEN") {
      return void res.status(409).json({
        error: "A cash register is already open for this restaurant",
        sessionId: (e as Error & { sessionId: number }).sessionId,
      });
    }
    // Postgres unique-violation on the partial unique index — surfaced as a
    // clean 409 rather than 500 if the FOR UPDATE check is bypassed.
    if ((e as { code?: string }).code === "23505") {
      return void res.status(409).json({ error: "A cash register is already open for this restaurant" });
    }
    throw e;
  }
});

router.post("/restaurants/:restaurantId/cash-register/sessions/:id/close",
  requireRole(...MANAGER_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const sessionId = Number(req.params.id);
    const userId = req.user?.sub;
    if (!userId) return void res.status(401).json({ error: "Authentication required" });

    // Cashier may only close the session they themselves opened.
    if (isCashierOnly(req)) {
      const [own] = await db.select({
        openedByUserId: cashRegisterSessionsTable.openedByUserId,
        closedByUserId: cashRegisterSessionsTable.closedByUserId,
      }).from(cashRegisterSessionsTable)
        .where(and(eq(cashRegisterSessionsTable.id, sessionId), eq(cashRegisterSessionsTable.restaurantId, restaurantId)));
      if (!own) return void res.status(404).json({ error: "Session not found" });
      if (!canActOnSession(req, own)) {
        return void res.status(403).json({ error: "You can only close shifts you opened" });
      }
    }

    const { denominations, countedAmount, isBlindClose, closeNotes, varianceReason } = req.body as {
      denominations?: unknown;
      countedAmount?: number | string;
      isBlindClose?: boolean;
      closeNotes?: string;
      varianceReason?: string;
    };

    // Either supply denominations (full breakdown) or countedAmount (quick count).
    // Denominations remain the preferred path; countedAmount is the optional shortcut.
    let validatedRows: DenomInput[] = [];
    let actualCash: number;
    if (denominations !== undefined && Array.isArray(denominations) && (denominations as unknown[]).length > 0) {
      const validated = validateDenominations(denominations);
      if (!validated.ok) return void res.status(400).json({ error: validated.error });
      validatedRows = validated.rows;
      actualCash = denomTotal(validatedRows);
    } else if (countedAmount !== undefined && countedAmount !== null && countedAmount !== "") {
      const n = Number(countedAmount);
      if (!isFinite(n) || n < 0) {
        return void res.status(400).json({ error: "countedAmount must be a non-negative number" });
      }
      actualCash = n;
    } else {
      return void res.status(400).json({ error: "Provide either a denomination breakdown or a countedAmount." });
    }

    const trimmedReason = typeof varianceReason === "string" ? varianceReason.trim() : "";

    // Operations Intelligence: enforce active closing checklist before allowing
    // session close. Skipped entirely if no template has enforce_on_close=true.
    try {
      const { checkClosingChecklistEnforcement } = await import("./operations");
      const check = await checkClosingChecklistEnforcement(restaurantId, sessionId);
      if (check.blocked) {
        return void res.status(400).json({
          error: "Closing checklist is incomplete — submit it before closing the register.",
          code: check.reason,
          templateId: check.templateId,
          missing: check.missing,
        });
      }
    } catch (e) {
      // Fail-closed: if the checklist enforcement helper itself throws, we
      // refuse to close the shift rather than silently bypassing the
      // configured policy. Managers can disable enforce_on_close on the
      // template if the checklist itself is broken.
      return void res.status(503).json({
        error: "Closing checklist enforcement is currently unavailable. Try again or disable enforcement on the template.",
        code: "OPS_CHECKLIST_ENFORCEMENT_UNAVAILABLE",
      });
    }

    try {
      const result = await db.transaction(async tx => {
        // Lock the session row; abort if it isn't ours / isn't open.
        const lockRows = await tx.execute(sql`
          SELECT * FROM ${cashRegisterSessionsTable}
          WHERE ${cashRegisterSessionsTable.id} = ${sessionId}
            AND ${cashRegisterSessionsTable.restaurantId} = ${restaurantId}
          FOR UPDATE
        `);
        const session = (lockRows as unknown as { rows: Array<typeof cashRegisterSessionsTable.$inferSelect> }).rows[0];
        if (!session) throw new Error("NOT_FOUND");
        if (session.status !== "open") throw new Error("NOT_OPEN");

        const totals = await computeSessionTotals(tx, sessionId, restaurantId, Number(session.openingFloat));
        const overShort = actualCash - totals.expectedCash;

        // Force a variance reason whenever counted cash doesn't match expected,
        // including for blind closes — clients submitting a blind close must
        // collect a reason note up-front since the counter won't see the
        // variance after submission.
        if (Math.abs(overShort) >= 0.01 && !trimmedReason) {
          throw new Error("VARIANCE_REASON_REQUIRED");
        }

        const [updated] = await tx.update(cashRegisterSessionsTable).set({
          status: "closed",
          closedByUserId: userId,
          closedAt: new Date(),
          expectedCash: totals.expectedCash.toFixed(2),
          actualCash: actualCash.toFixed(2),
          overShort: overShort.toFixed(2),
          isBlindClose: !!isBlindClose,
          closeNotes: closeNotes ?? null,
          varianceReason: trimmedReason || null,
        }).where(and(
          eq(cashRegisterSessionsTable.id, sessionId),
          eq(cashRegisterSessionsTable.status, "open"),
        )).returning();

        if (!updated) throw new Error("NOT_OPEN");

        if (validatedRows.length > 0) {
          await tx.insert(cashDenominationCountsTable).values(
            validatedRows.map(d => ({ sessionId, phase: "closing", denomination: d.denomination, count: d.count }))
          );
        }
        return { updated, totals, overShort };
      });

      // Blind close: hide variance details from immediate response so the
      // counter cannot tell over/short until management reviews. Stored values
      // remain in DB for management review.
      if (isBlindClose) {
        return void res.json({
          session: { ...result.updated, expectedCash: null, actualCash: null, overShort: null },
          totals: { openingFloat: result.totals.openingFloat, totalCashIn: null, totalCashOut: null, expectedCash: null, actualCash: null, overShort: null },
          blindClose: true,
        });
      }

      res.json({
        session: result.updated,
        totals: { ...result.totals, actualCash, overShort: result.overShort },
      });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "NOT_FOUND") return void res.status(404).json({ error: "Session not found" });
      if (msg === "NOT_OPEN") return void res.status(409).json({ error: "Session is no longer open (it may have been closed by another user)" });
      if (msg === "VARIANCE_REASON_REQUIRED") {
        return void res.status(400).json({
          error: "A reason note is required when counted cash does not match expected.",
          code: "VARIANCE_REASON_REQUIRED",
        });
      }
      throw e;
    }
  },
);

router.post("/restaurants/:restaurantId/cash-register/sessions/:id/movements",
  requireRole(...MANAGER_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const sessionId = Number(req.params.id);
    const userId = req.user?.sub;
    if (!userId) return void res.status(401).json({ error: "Authentication required" });

    // Cashier may only record movements on the session they opened.
    if (isCashierOnly(req)) {
      const [own] = await db.select({
        openedByUserId: cashRegisterSessionsTable.openedByUserId,
        closedByUserId: cashRegisterSessionsTable.closedByUserId,
      }).from(cashRegisterSessionsTable)
        .where(and(eq(cashRegisterSessionsTable.id, sessionId), eq(cashRegisterSessionsTable.restaurantId, restaurantId)));
      if (!own) return void res.status(404).json({ error: "Session not found" });
      if (!canActOnSession(req, own)) {
        return void res.status(403).json({ error: "You can only record movements on shifts you opened" });
      }
    }

    const { type, amount, reason, referenceType, referenceId } = req.body as {
      type: string;
      amount: number | string;
      reason?: string;
      referenceType?: string;
      referenceId?: number;
    };

    const allowedTypes = ["cash_in", "cash_out", "drop", "payout", "refund"];
    if (!allowedTypes.includes(String(type))) {
      return void res.status(400).json({ error: `type must be one of ${allowedTypes.join(", ")}` });
    }
    const amountNum = Number(amount);
    if (!isFinite(amountNum) || amountNum <= 0) {
      return void res.status(400).json({ error: "amount must be a positive number" });
    }

    try {
      const row = await db.transaction(async tx => {
        const lockRows = await tx.execute(sql`
          SELECT status FROM ${cashRegisterSessionsTable}
          WHERE ${cashRegisterSessionsTable.id} = ${sessionId}
            AND ${cashRegisterSessionsTable.restaurantId} = ${restaurantId}
          FOR UPDATE
        `);
        const s = (lockRows as unknown as { rows: Array<{ status: string }> }).rows[0];
        if (!s) throw new Error("NOT_FOUND");
        if (s.status !== "open") throw new Error("NOT_OPEN");

        const [r] = await tx.insert(cashMovementsTable).values({
          sessionId,
          restaurantId,
          type,
          amount: amountNum.toFixed(2),
          reason: reason ?? null,
          referenceType: referenceType ?? null,
          referenceId: referenceId ?? null,
          createdByUserId: userId,
        }).returning();
        return r;
      });
      res.status(201).json(row);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "NOT_FOUND") return void res.status(404).json({ error: "Session not found" });
      if (msg === "NOT_OPEN") return void res.status(400).json({ error: "Cannot record movements on a closed session" });
      throw e;
    }
  },
);

async function buildReport(sessionId: number, restaurantId: number) {
  const [session] = await db.select().from(cashRegisterSessionsTable)
    .where(and(eq(cashRegisterSessionsTable.id, sessionId), eq(cashRegisterSessionsTable.restaurantId, restaurantId)));
  if (!session) return null;

  const totals = await computeSessionTotals(db, sessionId, restaurantId, Number(session.openingFloat));

  const startedAt = session.openedAt;
  const endedAt = session.closedAt ?? new Date();

  // Tender summary: only count payments tied to ORDERS in this session window.
  // This excludes manual ledger entries (refunds/expenses) that happen to fall
  // in the window but aren't part of POS sales.
  const tenderRows = await db.select({
    method: paymentsTable.method,
    direction: paymentsTable.direction,
    total: sql<string>`cast(coalesce(sum(${paymentsTable.amount}), 0) as text)`,
    count: sql<number>`cast(count(distinct ${paymentsTable.referenceId}) as int)`,
  }).from(paymentsTable)
    .where(and(
      eq(paymentsTable.restaurantId, restaurantId),
      eq(paymentsTable.referenceType, "order"),
      gte(paymentsTable.paymentDate, startedAt),
      lte(paymentsTable.paymentDate, endedAt),
    ))
    .groupBy(paymentsTable.method, paymentsTable.direction);

  // Order totals: count distinct orders that received any payment in the window
  // (more accurate than orders.createdAt, which would miss orders opened before
  // shift but paid during it).
  const orderStats = await db.select({
    orderCount: sql<number>`cast(count(distinct ${paymentsTable.referenceId}) as int)`,
    revenue: sql<string>`cast(coalesce(sum(${paymentsTable.amount}), 0) as text)`,
  }).from(paymentsTable)
    .where(and(
      eq(paymentsTable.restaurantId, restaurantId),
      eq(paymentsTable.referenceType, "order"),
      eq(paymentsTable.direction, "in"),
      gte(paymentsTable.paymentDate, startedAt),
      lte(paymentsTable.paymentDate, endedAt),
    ));

  const movements = await db.select().from(cashMovementsTable)
    .where(and(eq(cashMovementsTable.sessionId, sessionId), eq(cashMovementsTable.restaurantId, restaurantId)))
    .orderBy(desc(cashMovementsTable.createdAt));

  const tenderSummary: Record<string, { in: number; out: number; count: number }> = {};
  for (const r of tenderRows) {
    if (!tenderSummary[r.method]) tenderSummary[r.method] = { in: 0, out: 0, count: 0 };
    if (r.direction === "in") tenderSummary[r.method].in += Number(r.total);
    else tenderSummary[r.method].out += Number(r.total);
    tenderSummary[r.method].count += r.count;
  }

  // Merge stored close values into totals so Z-reports reflect counted/over-short.
  const mergedTotals = {
    ...totals,
    actualCash: session.actualCash !== null ? Number(session.actualCash) : undefined,
    overShort: session.overShort !== null ? Number(session.overShort) : undefined,
  };

  return {
    session,
    totals: mergedTotals,
    tenderSummary,
    orderCount: orderStats[0]?.orderCount ?? 0,
    grossRevenue: orderStats[0]?.revenue ?? "0",
    movements,
    periodFrom: startedAt,
    periodTo: endedAt,
  };
}

router.get("/restaurants/:restaurantId/cash-register/variance-history",
  requireRole(...CROSS_SESSION_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { from, to } = req.query;

    const conditions = [
      eq(cashRegisterSessionsTable.restaurantId, restaurantId),
      eq(cashRegisterSessionsTable.status, "closed"),
    ];
    if (from) conditions.push(gte(cashRegisterSessionsTable.closedAt, new Date(String(from))));
    if (to) {
      const toDate = new Date(String(to));
      toDate.setHours(23, 59, 59, 999);
      conditions.push(lte(cashRegisterSessionsTable.closedAt, toDate));
    }

    const sessions = await db.select({
      id: cashRegisterSessionsTable.id,
      closedAt: cashRegisterSessionsTable.closedAt,
      openedAt: cashRegisterSessionsTable.openedAt,
      closedByUserId: cashRegisterSessionsTable.closedByUserId,
      openedByUserId: cashRegisterSessionsTable.openedByUserId,
      expectedCash: cashRegisterSessionsTable.expectedCash,
      actualCash: cashRegisterSessionsTable.actualCash,
      overShort: cashRegisterSessionsTable.overShort,
      varianceReason: cashRegisterSessionsTable.varianceReason,
      isBlindClose: cashRegisterSessionsTable.isBlindClose,
    }).from(cashRegisterSessionsTable)
      .where(and(...conditions))
      .orderBy(desc(cashRegisterSessionsTable.closedAt));

    const userIds = [...new Set(sessions.flatMap(s => [s.closedByUserId, s.openedByUserId]).filter((x): x is number => x !== null))];
    const users = userIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds))
      : [];
    const userMap = new Map(users.map(u => [u.id, u.name]));

    const sessionRows = sessions.map(s => ({
      ...s,
      closedByName: s.closedByUserId ? userMap.get(s.closedByUserId) ?? null : null,
      openedByName: s.openedByUserId ? userMap.get(s.openedByUserId) ?? null : null,
    }));

    // Group by cashier (the user who closed the session — they are accountable
    // for the count). Fallback to the opener when no closer was recorded.
    const byCashier = new Map<number, {
      userId: number;
      name: string | null;
      sessionCount: number;
      totalVariance: number;
      totalAbsVariance: number;
      overCount: number;
      shortCount: number;
      balancedCount: number;
      lastSessionAt: string | null;
    }>();

    for (const s of sessionRows) {
      const uid = s.closedByUserId ?? s.openedByUserId;
      if (!uid) continue;
      const variance = s.overShort !== null ? Number(s.overShort) : 0;
      const entry = byCashier.get(uid) ?? {
        userId: uid,
        name: userMap.get(uid) ?? null,
        sessionCount: 0,
        totalVariance: 0,
        totalAbsVariance: 0,
        overCount: 0,
        shortCount: 0,
        balancedCount: 0,
        lastSessionAt: null,
      };
      entry.sessionCount += 1;
      entry.totalVariance += variance;
      entry.totalAbsVariance += Math.abs(variance);
      if (Math.abs(variance) < 0.01) entry.balancedCount += 1;
      else if (variance > 0) entry.overCount += 1;
      else entry.shortCount += 1;
      const closedIso = s.closedAt ? new Date(s.closedAt).toISOString() : null;
      if (closedIso && (!entry.lastSessionAt || closedIso > entry.lastSessionAt)) {
        entry.lastSessionAt = closedIso;
      }
      byCashier.set(uid, entry);
    }

    res.json({
      sessions: sessionRows,
      cashiers: Array.from(byCashier.values()).sort((a, b) => b.totalAbsVariance - a.totalAbsVariance),
    });
  },
);

router.get("/restaurants/:restaurantId/cash-register/sessions/:id/x-report",
  requireRole(...MANAGER_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const sessionId = Number(req.params.id);
    const report = await buildReport(sessionId, restaurantId);
    if (!report) return void res.status(404).json({ error: "Session not found" });
    if (!canActOnSession(req, report.session)) {
      return void res.status(403).json({ error: "You can only view reports for shifts you opened" });
    }
    res.json({ ...report, kind: "X" });
  },
);

router.get("/restaurants/:restaurantId/cash-register/sessions/:id/z-report",
  requireRole(...MANAGER_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const sessionId = Number(req.params.id);
    const report = await buildReport(sessionId, restaurantId);
    if (!report) return void res.status(404).json({ error: "Session not found" });
    if (!canActOnSession(req, report.session)) {
      return void res.status(403).json({ error: "You can only view reports for shifts you opened" });
    }
    if (report.session.status !== "closed") {
      return void res.status(400).json({ error: "Z-report is only available for closed sessions" });
    }
    res.json({ ...report, kind: "Z" });
  },
);

// ===== Helpers used by orders/payments to enforce open-register on cash =====

// Acquire a lock on the open register session (call inside a transaction).
// Returns the session id, or null if no register is open. Use this from the
// pay/split endpoints so the session can't be closed mid-transaction.
export async function lockOpenCashRegister(tx: DbOrTx, restaurantId: number): Promise<number | null> {
  const session = await findOpenSession(tx, restaurantId, true);
  return session ? session.id : null;
}

// Lightweight check (no lock) for use as a pre-flight before starting a transaction.
export async function requireOpenCashRegister(restaurantId: number): Promise<{ ok: true; sessionId: number } | { ok: false; error: string }> {
  const session = await findOpenSession(db, restaurantId);
  if (!session) return { ok: false, error: "No cash register is open. Please open a register before accepting cash payments." };
  return { ok: true, sessionId: session.id };
}

// Insert a sale movement using either the global db or a provided transaction.
export async function recordCashSaleMovement(executor: DbOrTx, params: {
  restaurantId: number;
  sessionId: number;
  amount: number;
  orderId?: number;
  userId?: number | null;
}): Promise<void> {
  await executor.insert(cashMovementsTable).values({
    sessionId: params.sessionId,
    restaurantId: params.restaurantId,
    type: "sale",
    amount: params.amount.toFixed(2),
    reason: null,
    referenceType: params.orderId ? "order" : null,
    referenceId: params.orderId ?? null,
    createdByUserId: params.userId ?? null,
  });
}

// Express middleware variant retained for any future endpoints.
export function blockCashWhenNoRegister(req: Request, res: Response, next: NextFunction): void {
  const method = (req.body && (req.body.method || req.body.paymentMethod)) as string | undefined;
  if (method !== "cash") return next();
  const restaurantId = Number(req.params.restaurantId);
  if (!restaurantId) return next();
  void (async () => {
    const session = await findOpenSession(db, restaurantId);
    if (!session) {
      res.status(409).json({ error: "No cash register is open. Please open a register before accepting cash payments.", code: "REGISTER_CLOSED" });
      return;
    }
    (req as Request & { cashRegisterSessionId?: number }).cashRegisterSessionId = session.id;
    next();
  })();
}

export default router;
