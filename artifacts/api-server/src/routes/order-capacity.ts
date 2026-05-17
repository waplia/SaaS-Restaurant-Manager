import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, restaurantSettingsTable, restaurantsTable, deliveryZonesTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { loadOrderCapacityConfig, evaluateOrderCapacity, logCapacityAction, type OrderCapacityConfig } from "../lib/orderCapacity";
import { broadcastEvent } from "../lib/socketio";

const router = Router();

const FEATURE = "ops_order_capacity";

router.use(
  "/restaurants/:restaurantId/order-capacity",
  validateRestaurantAccess,
);

router.get(
  "/restaurants/:restaurantId/order-capacity",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const cfg = await loadOrderCapacityConfig(restaurantId);
    res.json(cfg);
  },
);

router.put(
  "/restaurants/:restaurantId/order-capacity",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature(FEATURE),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const previous = await loadOrderCapacityConfig(restaurantId);

    const body = (req.body ?? {}) as Partial<OrderCapacityConfig>;
    const merged: OrderCapacityConfig = {
      ...previous,
      ...body,
    };
    // Persist via merge — re-load to normalise
    await db
      .insert(restaurantSettingsTable)
      .values({ restaurantId, section: "order-capacity", data: merged, updatedBy: req.user!.sub })
      .onConflictDoUpdate({
        target: [restaurantSettingsTable.restaurantId, restaurantSettingsTable.section],
        set: { data: merged, updatedBy: req.user!.sub, updatedAt: new Date() },
      });
    const saved = await loadOrderCapacityConfig(restaurantId);
    await logCapacityAction({ req, restaurantId, action: "config.update", oldValue: previous, newValue: saved });
    broadcastEvent(restaurantId, "order-capacity:updated", saved);
    res.json(saved);
  },
);

router.post(
  "/restaurants/:restaurantId/order-capacity/pause",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature(FEATURE),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { target, minutes, zoneId, reason } = req.body as {
      target: "qr" | "online" | "all" | "zone";
      minutes?: number;
      zoneId?: number;
      reason?: string;
    };
    const previous = await loadOrderCapacityConfig(restaurantId);
    const next: OrderCapacityConfig = { ...previous, enabled: true };
    const pauseUntil = typeof minutes === "number" && minutes > 0
      ? new Date(Date.now() + minutes * 60_000).toISOString()
      : null;

    if (target === "qr") next.pauseQrOrders = true;
    else if (target === "online") next.pauseOnlineOrders = true;
    else if (target === "all") { next.pauseQrOrders = true; next.pauseOnlineOrders = true; }
    else if (target === "zone" && typeof zoneId === "number") {
      if (!next.pausedDeliveryZones.includes(zoneId)) next.pausedDeliveryZones = [...next.pausedDeliveryZones, zoneId];
    } else {
      return void res.status(400).json({ error: "Invalid pause target" });
    }
    if (pauseUntil && target !== "zone") next.pauseUntil = pauseUntil;
    if (typeof reason === "string" && reason.trim()) next.unavailableMessage = reason.trim();

    await db
      .insert(restaurantSettingsTable)
      .values({ restaurantId, section: "order-capacity", data: next, updatedBy: req.user!.sub })
      .onConflictDoUpdate({
        target: [restaurantSettingsTable.restaurantId, restaurantSettingsTable.section],
        set: { data: next, updatedBy: req.user!.sub, updatedAt: new Date() },
      });
    await logCapacityAction({ req, restaurantId, action: `pause.${target}`, newValue: { target, minutes, zoneId, reason, pauseUntil } });
    broadcastEvent(restaurantId, "order-capacity:updated", next);
    res.json(next);
  },
);

router.post(
  "/restaurants/:restaurantId/order-capacity/resume",
  requireRole("owner", "manager", "super_admin"),
  requirePlanFeature(FEATURE),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { target, zoneId } = req.body as { target: "qr" | "online" | "all" | "zone"; zoneId?: number };
    const previous = await loadOrderCapacityConfig(restaurantId);
    const next: OrderCapacityConfig = { ...previous };
    if (target === "qr") next.pauseQrOrders = false;
    else if (target === "online") next.pauseOnlineOrders = false;
    else if (target === "all") { next.pauseQrOrders = false; next.pauseOnlineOrders = false; next.pauseUntil = null; }
    else if (target === "zone" && typeof zoneId === "number") {
      next.pausedDeliveryZones = next.pausedDeliveryZones.filter((z) => z !== zoneId);
    } else {
      return void res.status(400).json({ error: "Invalid resume target" });
    }
    if (!next.pauseQrOrders && !next.pauseOnlineOrders) next.pauseUntil = null;

    await db
      .insert(restaurantSettingsTable)
      .values({ restaurantId, section: "order-capacity", data: next, updatedBy: req.user!.sub })
      .onConflictDoUpdate({
        target: [restaurantSettingsTable.restaurantId, restaurantSettingsTable.section],
        set: { data: next, updatedBy: req.user!.sub, updatedAt: new Date() },
      });
    await logCapacityAction({ req, restaurantId, action: `resume.${target}`, newValue: { target, zoneId } });
    broadcastEvent(restaurantId, "order-capacity:updated", next);
    res.json(next);
  },
);

router.get(
  "/restaurants/:restaurantId/order-capacity/status",
  requireRole("owner", "manager", "super_admin", "waiter", "cashier", "kitchen"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const status = await evaluateOrderCapacity({ restaurantId, channel: "pos" });
    res.json(status);
  },
);

// Public availability lookup — used by QR/customer menu to show banner.
export const publicOrderCapacityRouter = Router();

publicOrderCapacityRouter.get("/public/order-capacity/:slug", async (req, res) => {
  const slug = String(req.params.slug);
  const [r] = await db.select({ id: restaurantsTable.id }).from(restaurantsTable).where(eq(restaurantsTable.slug, slug));
  if (!r) return void res.status(404).json({ error: "Restaurant not found" });
  const channel = (req.query.channel === "online" ? "online" : "qr") as "qr" | "online";
  const orderType = typeof req.query.orderType === "string" ? req.query.orderType : undefined;

  // Resolve a delivery zone for zone-aware customer messaging — either by
  // explicit zoneId or by pincode lookup against active zones.
  let deliveryZoneId: number | null = null;
  const rawZone = req.query.zoneId;
  if (typeof rawZone === "string" && rawZone) {
    const n = Number(rawZone);
    if (Number.isFinite(n)) {
      // Validate the zone actually belongs to this restaurant to prevent
      // arbitrary IDs from skewing the availability decision.
      const [own] = await db.select({ id: deliveryZonesTable.id })
        .from(deliveryZonesTable)
        .where(and(eq(deliveryZonesTable.id, n), eq(deliveryZonesTable.restaurantId, r.id)));
      if (own) deliveryZoneId = own.id;
    }
  }
  const pincode = typeof req.query.pincode === "string" ? req.query.pincode.trim() : "";
  if (deliveryZoneId == null && pincode) {
    const zones = await db.select({ id: deliveryZonesTable.id, pincodes: deliveryZonesTable.pincodes })
      .from(deliveryZonesTable)
      .where(and(eq(deliveryZonesTable.restaurantId, r.id), eq(deliveryZonesTable.isActive, true)));
    const match = zones.find((z) => (z.pincodes ?? "").split(/[\s,]+/).map((p) => p.trim()).includes(pincode));
    if (match) deliveryZoneId = match.id;
  }

  const cfg = await loadOrderCapacityConfig(r.id);
  const status = await evaluateOrderCapacity({ restaurantId: r.id, channel, orderType, deliveryZoneId, config: cfg });
  res.json({
    accepting: status.allowed,
    reason: status.reason ?? null,
    nextAvailableAt: status.nextAvailableAt ?? null,
    unavailableMessage: cfg.unavailableMessage,
    deliveryZoneId,
  });
});

export default router;
