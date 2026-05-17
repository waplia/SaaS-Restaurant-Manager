import { Router } from "express";
import { eq, and, desc, isNull, inArray } from "drizzle-orm";
import {
  db,
  devicesTable,
  deviceLogsTable,
  deviceRoutingRulesTable,
  deviceStationMappingsTable,
  deviceSyncStateTable,
  branchesTable,
  kitchensTable,
  usersTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import {
  generateRegistrationToken,
  isDeviceType,
  logDeviceEvent,
  setDeviceStatus,
  recordHeartbeat,
  recordPrintAttempt,
  resolvePrintersForKitchen,
  resolveDefaultReceiptPrinter,
  PRINTER_TYPES,
} from "../lib/devices";

const router = Router();

const READ_ROLES = ["owner", "manager", "waiter", "cashier", "kitchen", "delivery_executive", "super_admin"] as const;
const WRITE_ROLES = ["owner", "manager", "super_admin"] as const;

const HANDHELD_ASSIGNABLE_ROLES = new Set(["waiter", "cashier", "manager", "owner"]);

async function validateAssignedUser(
  assignedUserId: unknown,
  restaurantId: number,
): Promise<{ ok: true; value: number | null } | { ok: false; status: number; error: string }> {
  if (assignedUserId === undefined || assignedUserId === null || assignedUserId === "") {
    return { ok: true, value: null };
  }
  const uid = Number(assignedUserId);
  if (!Number.isFinite(uid) || uid <= 0) {
    return { ok: false, status: 400, error: "assignedUserId must be a positive integer" };
  }
  const [u] = await db
    .select({
      id: usersTable.id,
      restaurantId: usersTable.restaurantId,
      role: usersTable.role,
      isActive: usersTable.isActive,
    })
    .from(usersTable)
    .where(eq(usersTable.id, uid));
  if (!u) return { ok: false, status: 400, error: "assignedUserId: user not found" };
  if (u.restaurantId !== restaurantId) {
    return { ok: false, status: 403, error: "assignedUserId: user does not belong to this restaurant" };
  }
  if (!u.isActive) return { ok: false, status: 400, error: "assignedUserId: user is not active" };
  if (!HANDHELD_ASSIGNABLE_ROLES.has(u.role)) {
    return { ok: false, status: 400, error: "assignedUserId: user role cannot be assigned to a device" };
  }
  return { ok: true, value: uid };
}

router.use(
  "/restaurants/:restaurantId/devices",
  requireRole(...READ_ROLES),
  validateRestaurantAccess,
);
router.use(
  "/restaurants/:restaurantId/branches/:branchId/devices",
  requireRole(...READ_ROLES),
  validateRestaurantAccess,
);

// ---------------------------------------------------------------------------
// List / filter
// ---------------------------------------------------------------------------

router.get("/restaurants/:restaurantId/devices", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { branchId, type, status } = req.query;

  const conds = [eq(devicesTable.restaurantId, restaurantId), isNull(devicesTable.deletedAt)];
  if (branchId && branchId !== "all") conds.push(eq(devicesTable.branchId, Number(branchId)));
  if (type) conds.push(eq(devicesTable.type, String(type) as never));
  if (status) conds.push(eq(devicesTable.status, String(status) as never));

  const rows = await db.select().from(devicesTable).where(and(...conds)).orderBy(devicesTable.name);

  // attach sync state for offline-capable types
  const ids = rows.map(r => r.id);
  const syncRows = ids.length > 0
    ? await db.select().from(deviceSyncStateTable).where(inArray(deviceSyncStateTable.deviceId, ids))
    : [];
  const syncMap = new Map(syncRows.map(s => [s.deviceId, s] as const));

  res.json(rows.map(r => ({ ...r, sync: syncMap.get(r.id) ?? null })));
});

// branch-scoped overview
router.get("/restaurants/:restaurantId/branches/:branchId/devices", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const branchId = Number(req.params.branchId);
  const rows = await db.select().from(devicesTable).where(and(
    eq(devicesTable.restaurantId, restaurantId),
    eq(devicesTable.branchId, branchId),
    isNull(devicesTable.deletedAt),
  )).orderBy(devicesTable.name);
  const total = rows.length;
  const offline = rows.filter(r => r.status === "offline").length;
  const error = rows.filter(r => r.status === "error").length;
  res.json({ devices: rows, summary: { total, offline, error, online: total - offline - error } });
});

// ---------------------------------------------------------------------------
// Get single device
// ---------------------------------------------------------------------------

router.get("/restaurants/:restaurantId/devices/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [d] = await db.select().from(devicesTable).where(and(
    eq(devicesTable.id, id), eq(devicesTable.restaurantId, restaurantId),
  ));
  if (!d || d.deletedAt) return void res.status(404).json({ error: "Not found" });
  const [sync] = await db.select().from(deviceSyncStateTable).where(eq(deviceSyncStateTable.deviceId, id));
  const stations = await db.select().from(deviceStationMappingsTable).where(eq(deviceStationMappingsTable.deviceId, id));
  const rules = await db.select().from(deviceRoutingRulesTable).where(eq(deviceRoutingRulesTable.deviceId, id));
  res.json({ ...d, sync: sync ?? null, stations, rules });
});

// ---------------------------------------------------------------------------
// Register / create
// ---------------------------------------------------------------------------

router.post(
  "/restaurants/:restaurantId/devices",
  requireRole(...WRITE_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { name, type, branchId, kitchenId, paperSize, metadata, assignedUserId, isHandheld } = req.body ?? {};
    if (!name?.trim()) return void res.status(400).json({ error: "name is required" });
    if (!isDeviceType(type)) return void res.status(400).json({ error: "invalid type" });

    if (branchId != null) {
      const [b] = await db.select({ id: branchesTable.id }).from(branchesTable)
        .where(and(eq(branchesTable.id, Number(branchId)), eq(branchesTable.restaurantId, restaurantId)));
      if (!b) return void res.status(400).json({ error: "branchId not found in this restaurant" });
    }
    if (kitchenId != null) {
      const [k] = await db.select({ id: kitchensTable.id }).from(kitchensTable)
        .where(and(eq(kitchensTable.id, Number(kitchenId)), eq(kitchensTable.restaurantId, restaurantId)));
      if (!k) return void res.status(400).json({ error: "kitchenId not found in this restaurant" });
    }

    const assignCheck = await validateAssignedUser(assignedUserId, restaurantId);
    if (!assignCheck.ok) return void res.status(assignCheck.status).json({ error: assignCheck.error });

    const token = generateRegistrationToken();
    const [d] = await db.insert(devicesTable).values({
      restaurantId,
      branchId: branchId != null ? Number(branchId) : null,
      kitchenId: kitchenId != null ? Number(kitchenId) : null,
      name: String(name).trim(),
      type,
      status: "pairing",
      registrationToken: token,
      paperSize: paperSize ?? null,
      metadata: metadata ?? {},
      assignedUserId: assignCheck.value,
      isHandheld: !!isHandheld,
    }).returning();

    if ((PRINTER_TYPES as string[]).includes(type) && kitchenId != null) {
      await db.insert(deviceStationMappingsTable).values({
        deviceId: d.id, kitchenId: Number(kitchenId), restaurantId,
      });
    }

    await logDeviceEvent({
      deviceId: d.id, restaurantId,
      eventType: "registered",
      message: `Device "${d.name}" registered (${d.type})`,
      source: req.user?.email ?? "owner",
    });

    res.status(201).json({ ...d, pairingToken: token });
  },
);

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

router.patch(
  "/restaurants/:restaurantId/devices/:id",
  requireRole(...WRITE_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { name, branchId, kitchenId, paperSize, metadata, status, assignedUserId, isHandheld } = req.body ?? {};
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = String(name).trim();
    if (branchId !== undefined) updates.branchId = branchId == null ? null : Number(branchId);
    if (kitchenId !== undefined) updates.kitchenId = kitchenId == null ? null : Number(kitchenId);
    if (paperSize !== undefined) updates.paperSize = paperSize;
    if (metadata !== undefined) updates.metadata = metadata;
    if (status !== undefined) updates.status = status;
    if (assignedUserId !== undefined) {
      const assignCheck = await validateAssignedUser(assignedUserId, restaurantId);
      if (!assignCheck.ok) return void res.status(assignCheck.status).json({ error: assignCheck.error });
      updates.assignedUserId = assignCheck.value;
    }
    if (isHandheld !== undefined) updates.isHandheld = !!isHandheld;

    const [updated] = await db.update(devicesTable).set(updates).where(and(
      eq(devicesTable.id, id), eq(devicesTable.restaurantId, restaurantId),
    )).returning();
    if (!updated) return void res.status(404).json({ error: "Not found" });

    await logDeviceEvent({
      deviceId: id, restaurantId,
      eventType: "updated",
      message: "Device settings updated",
      metadata: { changes: Object.keys(updates).filter(k => k !== "updatedAt") },
      source: req.user?.email ?? "owner",
    });

    res.json(updated);
  },
);

// ---------------------------------------------------------------------------
// Delete (soft)
// ---------------------------------------------------------------------------

router.delete(
  "/restaurants/:restaurantId/devices/:id",
  requireRole(...WRITE_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const [updated] = await db.update(devicesTable).set({
      deletedAt: new Date(),
      registrationToken: null,
      updatedAt: new Date(),
    }).where(and(
      eq(devicesTable.id, id), eq(devicesTable.restaurantId, restaurantId),
    )).returning();
    if (!updated) return void res.status(404).json({ error: "Not found" });
    await logDeviceEvent({
      deviceId: id, restaurantId,
      eventType: "deleted", message: "Device removed",
      source: req.user?.email ?? "owner",
    });
    res.json({ success: true });
  },
);

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

router.get("/restaurants/:restaurantId/devices/:id/logs", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = await db.select().from(deviceLogsTable).where(and(
    eq(deviceLogsTable.deviceId, id),
    eq(deviceLogsTable.restaurantId, restaurantId),
  )).orderBy(desc(deviceLogsTable.createdAt)).limit(limit);
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Routing rules
// ---------------------------------------------------------------------------

router.get("/restaurants/:restaurantId/devices/:id/routing-rules", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const rows = await db.select().from(deviceRoutingRulesTable).where(and(
    eq(deviceRoutingRulesTable.deviceId, id),
    eq(deviceRoutingRulesTable.restaurantId, restaurantId),
  ));
  res.json(rows);
});

router.put(
  "/restaurants/:restaurantId/devices/:id/routing-rules",
  requireRole(...WRITE_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const rules = Array.isArray(req.body?.rules) ? req.body.rules : [];

    await db.delete(deviceRoutingRulesTable).where(and(
      eq(deviceRoutingRulesTable.deviceId, id),
      eq(deviceRoutingRulesTable.restaurantId, restaurantId),
    ));
    if (rules.length > 0) {
      await db.insert(deviceRoutingRulesTable).values(rules.map((r: Record<string, unknown>) => ({
        restaurantId,
        deviceId: id,
        branchId: r.branchId != null ? Number(r.branchId) : null,
        categoryId: r.categoryId != null ? Number(r.categoryId) : null,
        kitchenId: r.kitchenId != null ? Number(r.kitchenId) : null,
        orderType: typeof r.orderType === "string" ? r.orderType : null,
        isDefaultReceipt: !!r.isDefaultReceipt,
        priority: typeof r.priority === "number" ? r.priority : 0,
      })));
    }
    await logDeviceEvent({
      deviceId: id, restaurantId,
      eventType: "routing_updated",
      message: `Routing rules updated (${rules.length} rule(s))`,
      source: req.user?.email ?? "owner",
    });
    const out = await db.select().from(deviceRoutingRulesTable).where(eq(deviceRoutingRulesTable.deviceId, id));
    res.json(out);
  },
);

// ---------------------------------------------------------------------------
// Station mappings (KOT printers / kitchen displays -> kitchens)
// ---------------------------------------------------------------------------

router.put(
  "/restaurants/:restaurantId/devices/:id/station-mappings",
  requireRole(...WRITE_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const kitchenIds: number[] = Array.isArray(req.body?.kitchenIds)
      ? req.body.kitchenIds.map((n: unknown) => Number(n)).filter(Number.isFinite)
      : [];

    await db.delete(deviceStationMappingsTable).where(eq(deviceStationMappingsTable.deviceId, id));
    if (kitchenIds.length > 0) {
      await db.insert(deviceStationMappingsTable).values(kitchenIds.map(kid => ({
        deviceId: id, kitchenId: kid, restaurantId,
      })));
    }
    await logDeviceEvent({
      deviceId: id, restaurantId,
      eventType: "stations_updated",
      message: `Mapped to ${kitchenIds.length} kitchen station(s)`,
      metadata: { kitchenIds },
      source: req.user?.email ?? "owner",
    });
    const rows = await db.select().from(deviceStationMappingsTable).where(eq(deviceStationMappingsTable.deviceId, id));
    res.json(rows);
  },
);

// ---------------------------------------------------------------------------
// Test print
// ---------------------------------------------------------------------------

router.post(
  "/restaurants/:restaurantId/devices/:id/test-print",
  requireRole(...WRITE_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const [d] = await db.select().from(devicesTable).where(and(
      eq(devicesTable.id, id), eq(devicesTable.restaurantId, restaurantId), isNull(devicesTable.deletedAt),
    ));
    if (!d) return void res.status(404).json({ error: "Not found" });
    if (!(PRINTER_TYPES as string[]).includes(d.type)) {
      return void res.status(400).json({ error: "Test print is only supported for printer devices" });
    }
    // Treat the test print as queued; mark as success when the device is online,
    // failure otherwise. Real devices will report status via heartbeat.
    const success = d.status === "online" || d.status === "pairing";
    await recordPrintAttempt({
      deviceId: id, restaurantId,
      success,
      message: success ? "Test print queued" : `Cannot reach device (status=${d.status})`,
    });
    res.json({ queued: true, success });
  },
);

// ---------------------------------------------------------------------------
// Heartbeat — used by device agents and by the owner UI to fake online state.
// Authenticated via either a normal user JWT or the device registration token.
// ---------------------------------------------------------------------------

router.post(
  "/restaurants/:restaurantId/devices/:id/heartbeat",
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const tokenHeader = req.headers["x-device-token"];
    const [d] = await db.select().from(devicesTable).where(and(
      eq(devicesTable.id, id), eq(devicesTable.restaurantId, restaurantId), isNull(devicesTable.deletedAt),
    ));
    if (!d) return void res.status(404).json({ error: "Not found" });

    const tenantOk = req.user?.isSuperAdmin
      || (req.user?.tenantId != null && req.user.tenantId === (await getTenantForRestaurant(restaurantId)));
    const tokenOk = typeof tokenHeader === "string" && tokenHeader === d.registrationToken;
    if (!tenantOk && !tokenOk) {
      return void res.status(401).json({ error: "Authentication required" });
    }

    const { firmwareVersion, appVersion, pendingCount, status } = req.body ?? {};
    await recordHeartbeat({
      deviceId: id, restaurantId,
      firmwareVersion, appVersion, pendingCount,
      status: status === "error" || status === "offline" || status === "online" ? status : undefined,
    });

    if (d.status === "pairing" && !d.pairedAt) {
      await db.update(devicesTable).set({ pairedAt: new Date() }).where(eq(devicesTable.id, id));
    }

    res.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Sync now (for offline-capable devices)
// ---------------------------------------------------------------------------

router.post(
  "/restaurants/:restaurantId/devices/:id/sync",
  requireRole(...WRITE_ROLES),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const [d] = await db.select().from(devicesTable).where(and(
      eq(devicesTable.id, id), eq(devicesTable.restaurantId, restaurantId), isNull(devicesTable.deletedAt),
    ));
    if (!d) return void res.status(404).json({ error: "Not found" });

    const [existing] = await db.select().from(deviceSyncStateTable).where(eq(deviceSyncStateTable.deviceId, id));
    if (existing) {
      await db.update(deviceSyncStateTable).set({
        lastSyncAt: new Date(), pendingCount: 0, updatedAt: new Date(),
      }).where(eq(deviceSyncStateTable.deviceId, id));
    } else {
      await db.insert(deviceSyncStateTable).values({ deviceId: id, lastSyncAt: new Date(), pendingCount: 0 });
    }
    await logDeviceEvent({
      deviceId: id, restaurantId, eventType: "sync_triggered",
      message: "Manual sync triggered", source: req.user?.email ?? "owner",
    });
    res.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Resolve printers (read-only helper used by the POS / KOT print flow)
// ---------------------------------------------------------------------------

router.get("/restaurants/:restaurantId/devices/resolve/printers", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const kitchenId = Number(req.query.kitchenId);
  const orderType = typeof req.query.orderType === "string" ? req.query.orderType : null;
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  if (!kitchenId) {
    const receipt = await resolveDefaultReceiptPrinter({ restaurantId, branchId });
    return void res.json({ kitchenPrinters: [], receiptPrinter: receipt });
  }
  const printers = await resolvePrintersForKitchen({ restaurantId, kitchenId, orderType });
  const receipt = await resolveDefaultReceiptPrinter({ restaurantId, branchId });
  res.json({ kitchenPrinters: printers, receiptPrinter: receipt });
});

async function getTenantForRestaurant(restaurantId: number): Promise<number | null> {
  const { restaurantsTable } = await import("../lib/db");
  const [r] = await db.select({ tenantId: restaurantsTable.tenantId })
    .from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  return r?.tenantId ?? null;
}

export default router;
