import { Router } from "express";
import { eq, and, gte, desc, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, waiterRequestsTable, floorTablesTable, notificationsTable, usersTable, ordersTable } from "../lib/db";
import { getIO } from "../lib/socketio";
import { sendWebPushToOrder } from "../lib/webPush";

// Separate alias so the resolver name doesn't collide with the acknowledger
// join in the request list query.
const resolverUsers = alias(usersTable, "resolver_users");
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { broadcastEvent } from "../lib/socketio";

// Notify the diner whose table the waiter request was created on. We find the
// most recent active order for that table, broadcast `waiter:acknowledged`
// into its socket room, and fan out a Web Push so the diner is told even if
// the QR menu tab is closed.
async function notifyDinerOfWaiterUpdate(args: {
  restaurantId: number;
  tableId: number | null;
  type: string | null;
  status: "acknowledged" | "resolved";
}): Promise<void> {
  if (!args.tableId) return;
  const [activeOrder] = await db
    .select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.tableId, args.tableId),
      eq(ordersTable.restaurantId, args.restaurantId),
    ))
    .orderBy(desc(ordersTable.createdAt))
    .limit(1);
  if (!activeOrder) return;
  const io = getIO();
  if (io) {
    io.to(`order:${activeOrder.id}`).emit("waiter:acknowledged", {
      tableId: args.tableId,
      type: args.type,
      status: args.status,
    });
  }
  const isBill = args.type === "request_bill";
  const verb = args.status === "resolved" ? "is on the way" : "has been notified";
  const title = isBill
    ? (args.status === "resolved" ? "Your bill is on the way" : "Bill request received")
    : (args.status === "resolved" ? "Your waiter is on the way" : "Your waiter has been notified");
  const body = isBill
    ? `A staff member ${verb}.`
    : `A staff member ${verb} for table ${args.tableId}.`;
  void sendWebPushToOrder(activeOrder.id, {
    title,
    body,
    data: { orderId: activeOrder.id, kind: "waiter", type: args.type, status: args.status },
  });
}
import { broadcastEvent as sseBroadcast } from "./realtime";
import { pushToStaff } from "../lib/pushNotify";

const router = Router();

const VALID_TYPES = new Set(["call_waiter", "request_bill", "water", "custom", "call_manager"]);

router.use("/restaurants/:restaurantId/waiter-requests",
  requireRole("owner", "manager", "waiter", "captain", "cashier", "kitchen", "super_admin"),
  validateRestaurantAccess,
);

router.get("/restaurants/:restaurantId/waiter-requests", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;

  // Honor ?status=pending,acknowledged so the mobile waiter tab and the
  // owner-side Waiter Requests screen only see active items. Without this,
  // resolved rows from the last 24h kept showing in the "active" list and
  // tapping Done returned 409 ("already resolved"). Accept a comma-separated
  // list and drop anything that isn't a known status; if no valid filter is
  // provided, return all statuses (back-compat for any caller that doesn't
  // pass the param).
  const ALLOWED = new Set(["pending", "acknowledged", "resolved"]);
  const statusParam = typeof req.query.status === "string" ? req.query.status : "";
  const requestedStatuses = statusParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ALLOWED.has(s));

  const rows = await db.select({
    id: waiterRequestsTable.id,
    restaurantId: waiterRequestsTable.restaurantId,
    tableId: waiterRequestsTable.tableId,
    tableNumber: floorTablesTable.tableNumber,
    type: waiterRequestsTable.type,
    note: waiterRequestsTable.note,
    status: waiterRequestsTable.status,
    acknowledgedByUserId: waiterRequestsTable.acknowledgedByUserId,
    acknowledgedByName: usersTable.name,
    acknowledgedAt: waiterRequestsTable.acknowledgedAt,
    resolvedByUserId: waiterRequestsTable.resolvedByUserId,
    resolvedByName: resolverUsers.name,
    resolvedAt: waiterRequestsTable.resolvedAt,
    createdAt: waiterRequestsTable.createdAt,
    updatedAt: waiterRequestsTable.updatedAt,
  })
    .from(waiterRequestsTable)
    .leftJoin(floorTablesTable, eq(waiterRequestsTable.tableId, floorTablesTable.id))
    .leftJoin(usersTable, eq(waiterRequestsTable.acknowledgedByUserId, usersTable.id))
    .leftJoin(resolverUsers, eq(waiterRequestsTable.resolvedByUserId, resolverUsers.id))
    .where(and(
      eq(waiterRequestsTable.restaurantId, restaurantId),
      gte(waiterRequestsTable.createdAt, new Date(sinceMs)),
      requestedStatuses.length > 0
        ? inArray(waiterRequestsTable.status, requestedStatuses)
        : undefined,
    ))
    .orderBy(desc(waiterRequestsTable.createdAt));
  res.json(rows);
});

// Staff-initiated waiter request (e.g. waiter taps "Call Manager" from
// the running-order screen). Mirrors the public diner-side helper so the
// new entry shows up in the same Requests list and triggers the same
// notification fan-out.
router.post("/restaurants/:restaurantId/waiter-requests",
  requireRole("owner", "manager", "waiter", "captain", "cashier", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const tableId = req.body?.tableId != null ? Number(req.body.tableId) : NaN;
    const rawType = String(req.body?.type ?? "call_waiter");
    const type = VALID_TYPES.has(rawType) ? rawType : "call_waiter";
    const note = typeof req.body?.note === "string" ? req.body.note : null;

    // The schema requires a non-null tableId — Call Manager and similar
    // staff-initiated requests must still be attached to whichever
    // table the staff member is standing at.
    if (!Number.isFinite(tableId) || tableId <= 0) {
      return void res.status(400).json({ error: "tableId is required" });
    }

    const [ft] = await db.select({ tableNumber: floorTablesTable.tableNumber })
      .from(floorTablesTable)
      .where(and(eq(floorTablesTable.id, tableId), eq(floorTablesTable.restaurantId, restaurantId)));
    if (!ft) {
      // Tenant isolation: refuse to create a request against a table that
      // doesn't belong to this restaurant (or doesn't exist at all).
      return void res.status(404).json({ error: "Table not found for this restaurant" });
    }
    const tableNumber: string | null = ft.tableNumber ?? null;

    const [row] = await db.insert(waiterRequestsTable).values({
      restaurantId,
      tableId,
      type,
      note,
      status: "pending",
    }).returning();

    const reasonLabel = type === "request_bill" ? "requesting bill"
      : type === "water" ? "requesting water"
      : type === "call_manager" ? "calling a manager"
      : type === "custom" ? (note ? `says: ${note}` : "needs assistance")
      : "calling a waiter";
    await db.insert(notificationsTable).values({
      restaurantId,
      type: type === "call_manager" ? "manager_call" : "waiter_request",
      title: tableNumber ? `Table ${tableNumber}` : "Floor staff",
      message: tableNumber ? `Table ${tableNumber} is ${reasonLabel}` : `Floor staff ${reasonLabel}`,
      entityId: row.id,
      entityType: "waiter_request",
    });

    const payload = {
      id: row.id, tableId, tableNumber, type, note, status: row.status,
      createdAt: row.createdAt,
    };
    broadcastEvent(restaurantId, "waiter_request:new", payload);
    sseBroadcast(restaurantId, "waiter_request:new", payload);
    broadcastEvent(restaurantId, "notification:new", { type: type === "call_manager" ? "manager_call" : "waiter_request" });

    // Route the push to whoever can act on it. PushType doesn't have a
    // dedicated "manager_call" channel yet, so reuse the waiter_call
    // sound/channel but target only manager/owner roles.
    const targetRoles = type === "call_manager"
      ? ["manager", "owner"] as const
      : ["waiter", "manager", "owner"] as const;
    pushToStaff(
      { restaurantId, roles: [...targetRoles], type: "waiter_call" },
      {
        title: type === "call_manager" ? "Manager needed on the floor" :
               type === "request_bill" ? "Bill requested" : "Table needs attention",
        body: tableNumber ? `Table ${tableNumber}${note ? ` — ${note}` : ""}` : (note ?? "Floor staff needs help"),
        data: { screen: "waiter_requests", requestId: row.id, tableId },
      },
    ).catch(() => {});

    res.status(201).json(payload);
  },
);

router.post("/restaurants/:restaurantId/waiter-requests/:id/acknowledge",
  requireRole("owner", "manager", "waiter", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const userId = req.user!.sub;
    const [updated] = await db.update(waiterRequestsTable)
      .set({ status: "acknowledged", acknowledgedByUserId: userId, acknowledgedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(waiterRequestsTable.id, id),
        eq(waiterRequestsTable.restaurantId, restaurantId),
        inArray(waiterRequestsTable.status, ["pending"]),
      ))
      .returning();
    if (!updated) return void res.status(409).json({ error: "Request not found or already acknowledged" });
    broadcastEvent(restaurantId, "waiter_request:update", { id: updated.id, status: updated.status });
    sseBroadcast(restaurantId, "waiter_request:update", { id: updated.id, status: updated.status });
    void notifyDinerOfWaiterUpdate({ restaurantId, tableId: updated.tableId, type: updated.type, status: "acknowledged" });
    res.json(updated);
  },
);

router.post("/restaurants/:restaurantId/waiter-requests/:id/resolve",
  requireRole("owner", "manager", "waiter", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const userId = req.user!.sub;
    const [updated] = await db.update(waiterRequestsTable)
      .set({ status: "resolved", resolvedByUserId: userId, resolvedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(waiterRequestsTable.id, id),
        eq(waiterRequestsTable.restaurantId, restaurantId),
        inArray(waiterRequestsTable.status, ["pending", "acknowledged"]),
      ))
      .returning();
    if (!updated) return void res.status(409).json({ error: "Request not found or already resolved" });
    broadcastEvent(restaurantId, "waiter_request:update", { id: updated.id, status: updated.status });
    sseBroadcast(restaurantId, "waiter_request:update", { id: updated.id, status: updated.status });
    void notifyDinerOfWaiterUpdate({ restaurantId, tableId: updated.tableId, type: updated.type, status: "resolved" });
    res.json(updated);
  },
);

export default router;

// Public helper used by /public/call-waiter to create a request row + broadcast.
export async function createWaiterRequestPublic(args: {
  restaurantId: number;
  tableId: number;
  tableNumber: string;
  type: string;
  note?: string | null;
}) {
  const type = VALID_TYPES.has(args.type) ? args.type : "call_waiter";
  const [row] = await db.insert(waiterRequestsTable).values({
    restaurantId: args.restaurantId,
    tableId: args.tableId,
    type,
    note: args.note ?? null,
    status: "pending",
  }).returning();

  const reasonLabel = type === "request_bill" ? "requesting bill"
    : type === "water" ? "requesting water"
    : type === "custom" ? (args.note ? `says: ${args.note}` : "needs assistance")
    : "calling a waiter";

  await db.insert(notificationsTable).values({
    restaurantId: args.restaurantId,
    type: "waiter_request",
    title: `Table ${args.tableNumber}`,
    message: `Table ${args.tableNumber} is ${reasonLabel}`,
    entityId: row.id,
    entityType: "waiter_request",
  });

  const payload = {
    id: row.id,
    tableId: args.tableId,
    tableNumber: args.tableNumber,
    type,
    note: args.note ?? null,
    status: row.status,
    createdAt: row.createdAt,
  };
  broadcastEvent(args.restaurantId, "waiter_request:new", payload);
  sseBroadcast(args.restaurantId, "waiter_request:new", payload);
  broadcastEvent(args.restaurantId, "notification:new", { type: "waiter_request" });

  pushToStaff(
    { restaurantId: args.restaurantId, roles: ["waiter", "manager", "owner"], type: "waiter_call" },
    {
      title: type === "request_bill" ? "Bill requested" : "Table needs attention",
      body: `Table ${args.tableNumber}${args.note ? ` — ${args.note}` : ""}`,
      data: { screen: "waiter_requests", requestId: row.id, tableId: args.tableId },
    },
  ).catch(() => {});

  return row;
}

export { VALID_TYPES };
