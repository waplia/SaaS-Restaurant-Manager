import { Router } from "express";
import { eq, and, gte, desc, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, waiterRequestsTable, floorTablesTable, notificationsTable, usersTable } from "../lib/db";

// Separate alias so the resolver name doesn't collide with the acknowledger
// join in the request list query.
const resolverUsers = alias(usersTable, "resolver_users");
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { broadcastEvent } from "../lib/socketio";
import { broadcastEvent as sseBroadcast } from "./realtime";
import { pushToStaff } from "../lib/pushNotify";

const router = Router();

const VALID_TYPES = new Set(["call_waiter", "request_bill", "water", "custom"]);

router.use("/restaurants/:restaurantId/waiter-requests",
  requireRole("owner", "manager", "waiter", "kitchen", "super_admin"),
  validateRestaurantAccess,
);

router.get("/restaurants/:restaurantId/waiter-requests", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
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
    ))
    .orderBy(desc(waiterRequestsTable.createdAt));
  res.json(rows);
});

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
