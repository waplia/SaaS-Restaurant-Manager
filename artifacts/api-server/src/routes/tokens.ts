import { Router } from "express";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  db,
  orderTokensTable,
  ordersTable,
  branchesTable,
  restaurantSettingsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import {
  getTokenSettings,
  DEFAULT_TOKEN_SETTINGS,
  projectToken,
  broadcastTokenEvent,
  type TokenSettings,
} from "../lib/tokens";

const router = Router();

// ---------- Public TV display (no auth) ----------
router.get("/public/display/token/:restaurantId/:branchId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const branchParam = req.params.branchId;
  const branchId = branchParam === "all" ? null : Number(branchParam);
  if (!restaurantId || (branchParam !== "all" && !branchId)) {
    return void res.status(400).json({ error: "Invalid outlet" });
  }

  const settings = await getTokenSettings(restaurantId);
  if (!settings.enabled) return void res.status(404).json({ error: "Token display disabled" });

  let branchName: string | null = null;
  if (branchId) {
    const [b] = await db.select({ name: branchesTable.name })
      .from(branchesTable)
      .where(and(eq(branchesTable.id, branchId), eq(branchesTable.restaurantId, restaurantId)));
    if (!b) return void res.status(404).json({ error: "Outlet not found" });
    branchName = b.name;
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const conds = [
    eq(orderTokensTable.restaurantId, restaurantId),
    gte(orderTokensTable.issuedAt, today),
  ];
  if (branchId) conds.push(eq(orderTokensTable.branchId, branchId));

  const rows = await db.select().from(orderTokensTable).where(and(...conds))
    .orderBy(desc(orderTokensTable.issuedAt)).limit(50);

  const projected = rows.map(r => projectToken(r, settings));
  res.json({
    restaurantId,
    branchId,
    branchName,
    settings: {
      prefix: settings.prefix,
      padding: settings.padding,
      defaultCounter: settings.defaultCounter,
      recallTtsEnabled: settings.recallTtsEnabled,
      showCustomerName: settings.showCustomerName,
    },
    waiting: projected.filter(t => t.status === "waiting" || t.status === "preparing"),
    ready: projected.filter(t => t.status === "ready"),
    served: projected.filter(t => t.status === "served").slice(0, 5),
  });
});

// ---------- Authenticated management endpoints ----------
router.use(
  "/restaurants/:restaurantId/tokens",
  requireRole("owner", "manager", "super_admin", "waiter", "cashier", "kitchen"),
  validateRestaurantAccess,
);
router.use(
  "/restaurants/:restaurantId/token-settings",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);

// List tokens (today by default; supports ?status, ?branchId, ?from/to for history)
router.get("/restaurants/:restaurantId/tokens", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { status, branchId, from, to, limit } = req.query as Record<string, string | undefined>;
  const conds = [eq(orderTokensTable.restaurantId, restaurantId)];

  if (from && to) {
    conds.push(gte(orderTokensTable.issuedAt, new Date(from)));
    conds.push(lte(orderTokensTable.issuedAt, new Date(to)));
  } else {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    conds.push(gte(orderTokensTable.issuedAt, today));
  }
  if (status) conds.push(eq(orderTokensTable.status, status));
  if (branchId) conds.push(eq(orderTokensTable.branchId, Number(branchId)));

  const rows = await db.select().from(orderTokensTable).where(and(...conds))
    .orderBy(desc(orderTokensTable.issuedAt)).limit(Math.min(Number(limit ?? 200), 1000));

  const settings = await getTokenSettings(restaurantId);
  res.json(rows.map(r => ({
    ...projectToken(r, settings),
    customerNameRaw: r.customerName,
    customerPhone: r.customerPhone,
  })));
});

// CSV export
router.get("/restaurants/:restaurantId/tokens/export.csv", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { from, to, branchId } = req.query as Record<string, string | undefined>;
  const conds = [eq(orderTokensTable.restaurantId, restaurantId)];
  if (from) conds.push(gte(orderTokensTable.issuedAt, new Date(from)));
  if (to) conds.push(lte(orderTokensTable.issuedAt, new Date(to)));
  if (branchId) conds.push(eq(orderTokensTable.branchId, Number(branchId)));

  const rows = await db.select().from(orderTokensTable).where(and(...conds))
    .orderBy(desc(orderTokensTable.issuedAt)).limit(10000);

  const header = "token,number,counter,status,orderId,orderType,customerName,customerPhone,branchId,issuedAt,readyAt,servedAt,recalledCount\n";
  const escape = (v: unknown) => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const body = rows.map(r => [
    r.token, r.number, r.counter, r.status, r.orderId, r.orderType,
    r.customerName, r.customerPhone, r.branchId,
    r.issuedAt?.toISOString?.() ?? "",
    r.readyAt?.toISOString?.() ?? "",
    r.servedAt?.toISOString?.() ?? "",
    r.recalledCount,
  ].map(escape).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="tokens-${Date.now()}.csv"`);
  res.send(header + body + "\n");
});

// Update token (status, counter)
router.patch("/restaurants/:restaurantId/tokens/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { status, counter } = req.body as { status?: string; counter?: number };

  const [existing] = await db.select().from(orderTokensTable).where(and(
    eq(orderTokensTable.id, id),
    eq(orderTokensTable.restaurantId, restaurantId),
  ));
  if (!existing) return void res.status(404).json({ error: "Token not found" });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (status) {
    const allowed = ["waiting", "preparing", "ready", "served", "cancelled"];
    if (!allowed.includes(status)) return void res.status(400).json({ error: "Invalid status" });
    updates.status = status;
    if (status === "ready" && !existing.readyAt) updates.readyAt = new Date();
    if (status === "served" && !existing.servedAt) updates.servedAt = new Date();
    if (status === "cancelled") updates.cancelledAt = new Date();
  }
  if (typeof counter === "number" && counter > 0) updates.counter = counter;

  const [updated] = await db.update(orderTokensTable).set(updates).where(eq(orderTokensTable.id, id)).returning();
  const settings = await getTokenSettings(restaurantId);
  broadcastTokenEvent(restaurantId, updated.branchId, "token:update", projectToken(updated, settings));
  res.json(projectToken(updated, settings));
});

// Recall — re-announce a token. Bumps recalledCount and emits a recall event.
router.post("/restaurants/:restaurantId/tokens/:id/recall", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { counter } = req.body as { counter?: number };

  const [existing] = await db.select().from(orderTokensTable).where(and(
    eq(orderTokensTable.id, id),
    eq(orderTokensTable.restaurantId, restaurantId),
  ));
  if (!existing) return void res.status(404).json({ error: "Token not found" });

  const updates: Record<string, unknown> = {
    recalledAt: new Date(),
    recalledCount: existing.recalledCount + 1,
    updatedAt: new Date(),
  };
  if (typeof counter === "number" && counter > 0) updates.counter = counter;

  const [updated] = await db.update(orderTokensTable).set(updates).where(eq(orderTokensTable.id, id)).returning();
  const settings = await getTokenSettings(restaurantId);
  broadcastTokenEvent(restaurantId, updated.branchId, "token:recall", projectToken(updated, settings));
  res.json(projectToken(updated, settings));
});

// Reprint — returns the printable payload; the client handles browser printing.
router.get("/restaurants/:restaurantId/tokens/:id/print", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [tok] = await db.select().from(orderTokensTable).where(and(
    eq(orderTokensTable.id, id),
    eq(orderTokensTable.restaurantId, restaurantId),
  ));
  if (!tok) return void res.status(404).json({ error: "Token not found" });
  const [order] = await db.select({ orderNumber: ordersTable.orderNumber, totalAmount: ordersTable.totalAmount })
    .from(ordersTable).where(eq(ordersTable.id, tok.orderId));
  res.json({
    token: tok.token,
    number: tok.number,
    counter: tok.counter,
    customerName: tok.customerName,
    orderType: tok.orderType,
    orderNumber: order?.orderNumber ?? null,
    totalAmount: order?.totalAmount ?? null,
    issuedAt: tok.issuedAt,
  });
});

// Settings GET / PUT
router.get("/restaurants/:restaurantId/token-settings", async (req, res) => {
  const settings = await getTokenSettings(Number(req.params.restaurantId));
  res.json(settings);
});

router.put("/restaurants/:restaurantId/token-settings", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const body = req.body as Partial<TokenSettings>;
  const merged: TokenSettings = { ...DEFAULT_TOKEN_SETTINGS, ...body };
  // Basic validation
  if (merged.startNumber < 1) merged.startNumber = 1;
  if (merged.maxNumber < merged.startNumber) merged.maxNumber = merged.startNumber + 999;
  if (merged.padding < 1) merged.padding = 1;
  if (merged.padding > 6) merged.padding = 6;
  if (merged.defaultCounter < 1) merged.defaultCounter = 1;
  if (!["daily", "manual"].includes(merged.resetMode)) merged.resetMode = "daily";

  await db.insert(restaurantSettingsTable).values({
    restaurantId, section: "token-display", data: merged, updatedBy: req.user?.sub ?? null,
  }).onConflictDoUpdate({
    target: [restaurantSettingsTable.restaurantId, restaurantSettingsTable.section],
    set: { data: merged, updatedBy: req.user?.sub ?? null, updatedAt: new Date() },
  });
  res.json(merged);
});

// Manual reset (clears today's tokens by marking them served — number sequence
// resets at next issuance because we recompute from max(number) for today).
router.post("/restaurants/:restaurantId/token-settings/reset", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { branchId } = req.body as { branchId?: number };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const conds = [eq(orderTokensTable.restaurantId, restaurantId), gte(orderTokensTable.issuedAt, today)];
  if (branchId) conds.push(eq(orderTokensTable.branchId, branchId));
  // Mark all of today's tokens as served (so they no longer appear "live") and
  // set their scopeDate to a sentinel so they don't influence next-number.
  await db.update(orderTokensTable).set({
    status: sql`case when ${orderTokensTable.status} in ('waiting','preparing','ready') then 'served' else ${orderTokensTable.status} end`,
    scopeDate: "1900-01-01",
    updatedAt: new Date(),
  }).where(and(...conds));
  broadcastTokenEvent(restaurantId, branchId ?? null, "token:reset", { branchId: branchId ?? null });
  res.json({ ok: true });
});

export default router;
