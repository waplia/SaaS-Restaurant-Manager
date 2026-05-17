import { Router } from "express";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  db, restaurantsTable, ordersTable, orderItemsTable, paymentsTable,
  hotelGuestsTable, hotelStaysTable, hotelPackagesTable, hotelPackageConsumptionsTable,
  hotelFoliosTable, hotelFolioLinesTable, hotelBanquetEventsTable,
  hotelMinibarPostingsTable, hotelHousekeepingRequestsTable,
  menuItemsTable, kitchenTicketsTable, notificationsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { broadcastEvent } from "../lib/socketio";
import { createKitchenTicketsForOrder } from "../lib/kitchenRouting";

const router = Router();

router.use(
  "/restaurants/:restaurantId/hotel",
  requireRole("owner", "manager", "cashier", "waiter", "kitchen", "staff", "super_admin"),
  validateRestaurantAccess,
);

// Resolve the tenant for the calling restaurant. Folios are scoped tenant-wide
// so charges from any hotel-mode outlet under one hotel consolidate together.
async function tenantForRestaurant(restaurantId: number): Promise<number | null> {
  const [r] = await db.select({ tenantId: restaurantsTable.tenantId })
    .from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  return r?.tenantId ?? null;
}

async function recalcFolio(folioId: number): Promise<{ totalCharges: number; totalPayments: number; balance: number }> {
  const lines = await db.select().from(hotelFolioLinesTable).where(eq(hotelFolioLinesTable.folioId, folioId));
  let charges = 0, payments = 0;
  for (const l of lines) {
    const amt = Number(l.amount);
    if (l.kind === "charge") charges += amt;
    else if (l.kind === "discount" || l.kind === "comp") charges -= amt;
    else if (l.kind === "payment") payments += amt;
  }
  const balance = charges - payments;
  await db.update(hotelFoliosTable).set({
    totalCharges: charges.toFixed(2),
    totalPayments: payments.toFixed(2),
    balance: balance.toFixed(2),
    updatedAt: new Date(),
  }).where(eq(hotelFoliosTable.id, folioId));
  return { totalCharges: charges, totalPayments: payments, balance };
}

async function ensureFolioForStay(stayId: number, tenantId: number): Promise<number> {
  const [existing] = await db.select().from(hotelFoliosTable)
    .where(and(eq(hotelFoliosTable.stayId, stayId), eq(hotelFoliosTable.status, "open")));
  if (existing) return existing.id;
  const [created] = await db.insert(hotelFoliosTable).values({ tenantId, stayId, status: "open" }).returning();
  return created.id;
}

async function ensureFolioForBanquet(eventId: number, tenantId: number): Promise<number> {
  const [existing] = await db.select().from(hotelFoliosTable)
    .where(and(eq(hotelFoliosTable.banquetEventId, eventId), eq(hotelFoliosTable.status, "open")));
  if (existing) return existing.id;
  const [created] = await db.insert(hotelFoliosTable).values({ tenantId, banquetEventId: eventId, status: "open" }).returning();
  await db.update(hotelBanquetEventsTable).set({ folioId: created.id }).where(eq(hotelBanquetEventsTable.id, eventId));
  return created.id;
}

// ---- Hotel mode toggle (on the outlet) ------------------------------------

router.patch(
  "/restaurants/:restaurantId/hotel-mode",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const enabled = !!req.body.enabled;
    const [updated] = await db.update(restaurantsTable)
      .set({ isHotelMode: enabled, updatedAt: new Date() })
      .where(eq(restaurantsTable.id, restaurantId))
      .returning({ id: restaurantsTable.id, isHotelMode: restaurantsTable.isHotelMode });
    res.json(updated);
  },
);

// ---- Guests ---------------------------------------------------------------

router.get("/restaurants/:restaurantId/hotel/guests", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const tenantId = await tenantForRestaurant(restaurantId);
  if (!tenantId) return void res.status(404).json({ error: "Tenant not found" });
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const rows = await db.select().from(hotelGuestsTable)
    .where(eq(hotelGuestsTable.tenantId, tenantId)).orderBy(desc(hotelGuestsTable.updatedAt)).limit(200);
  const filtered = q ? rows.filter(r =>
    r.name.toLowerCase().includes(q) || (r.phone ?? "").includes(q) || (r.email ?? "").toLowerCase().includes(q)
  ) : rows;
  res.json(filtered);
});

router.post("/restaurants/:restaurantId/hotel/guests", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const tenantId = await tenantForRestaurant(restaurantId);
  if (!tenantId) return void res.status(404).json({ error: "Tenant not found" });
  const { name, phone, email, isVip, allergies, preferences, notes } = req.body;
  if (!name) return void res.status(400).json({ error: "name is required" });
  const [row] = await db.insert(hotelGuestsTable).values({
    tenantId, name, phone, email, isVip: !!isVip, allergies, preferences, notes,
  }).returning();
  res.status(201).json(row);
});

router.patch("/restaurants/:restaurantId/hotel/guests/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const tenantId = await tenantForRestaurant(restaurantId);
  if (!tenantId) return void res.status(404).json({ error: "Tenant not found" });
  const { name, phone, email, isVip, allergies, preferences, notes } = req.body;
  const [row] = await db.update(hotelGuestsTable).set({
    name, phone, email, isVip, allergies, preferences, notes, updatedAt: new Date(),
  }).where(and(eq(hotelGuestsTable.id, Number(req.params.id)), eq(hotelGuestsTable.tenantId, tenantId))).returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  res.json(row);
});

// ---- Stays ----------------------------------------------------------------

router.get("/restaurants/:restaurantId/hotel/stays", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const tenantId = await tenantForRestaurant(restaurantId);
  if (!tenantId) return void res.status(404).json({ error: "Tenant not found" });
  const status = String(req.query.status ?? "in_house");
  const room = req.query.room ? String(req.query.room) : null;
  const conds = [eq(hotelStaysTable.tenantId, tenantId), eq(hotelStaysTable.status, status)];
  if (room) conds.push(eq(hotelStaysTable.roomNumber, room));
  const stays = await db.select().from(hotelStaysTable).where(and(...conds)).orderBy(desc(hotelStaysTable.checkInAt));
  if (stays.length === 0) return void res.json([]);
  const guestIds = [...new Set(stays.map(s => s.guestId))];
  const guests = await db.select().from(hotelGuestsTable).where(inArray(hotelGuestsTable.id, guestIds));
  const gMap = new Map(guests.map(g => [g.id, g]));
  const folios = await db.select().from(hotelFoliosTable)
    .where(and(eq(hotelFoliosTable.tenantId, tenantId), inArray(hotelFoliosTable.stayId, stays.map(s => s.id))));
  const fMap = new Map(folios.map(f => [f.stayId!, f]));
  res.json(stays.map(s => ({ ...s, guest: gMap.get(s.guestId) ?? null, folio: fMap.get(s.id) ?? null })));
});

router.post("/restaurants/:restaurantId/hotel/stays", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const tenantId = await tenantForRestaurant(restaurantId);
  if (!tenantId) return void res.status(404).json({ error: "Tenant not found" });
  const { guestId, roomNumber, partySize, packageId, notes } = req.body;
  if (!guestId || !roomNumber) return void res.status(400).json({ error: "guestId and roomNumber are required" });
  const [g] = await db.select({ id: hotelGuestsTable.id }).from(hotelGuestsTable)
    .where(and(eq(hotelGuestsTable.id, Number(guestId)), eq(hotelGuestsTable.tenantId, tenantId)));
  if (!g) return void res.status(400).json({ error: "Guest does not belong to this hotel" });
  const [stay] = await db.insert(hotelStaysTable).values({
    tenantId, guestId, roomNumber: String(roomNumber), partySize: Number(partySize) || 1,
    packageId: packageId ? Number(packageId) : null, notes,
  }).returning();
  await ensureFolioForStay(stay.id, tenantId);
  res.status(201).json(stay);
});

router.get("/restaurants/:restaurantId/hotel/stays/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const tenantId = await tenantForRestaurant(restaurantId);
  if (!tenantId) return void res.status(404).json({ error: "Tenant not found" });
  const stayId = Number(req.params.id);
  const [stay] = await db.select().from(hotelStaysTable)
    .where(and(eq(hotelStaysTable.id, stayId), eq(hotelStaysTable.tenantId, tenantId)));
  if (!stay) return void res.status(404).json({ error: "Not found" });
  const [guest] = await db.select().from(hotelGuestsTable).where(eq(hotelGuestsTable.id, stay.guestId));
  const folioId = await ensureFolioForStay(stay.id, tenantId);
  const [folio] = await db.select().from(hotelFoliosTable).where(eq(hotelFoliosTable.id, folioId));
  const lines = await db.select().from(hotelFolioLinesTable)
    .where(eq(hotelFolioLinesTable.folioId, folioId)).orderBy(desc(hotelFolioLinesTable.createdAt));
  let pkg: typeof hotelPackagesTable.$inferSelect | null = null;
  let pkgUsedToday = 0;
  if (stay.packageId) {
    const [p] = await db.select().from(hotelPackagesTable).where(eq(hotelPackagesTable.id, stay.packageId));
    pkg = p ?? null;
    if (pkg) {
      const today = new Date().toISOString().slice(0, 10);
      const used = await db.select({ s: sql<string>`coalesce(sum(${hotelPackageConsumptionsTable.qty}), 0)::text` })
        .from(hotelPackageConsumptionsTable)
        .where(and(
          eq(hotelPackageConsumptionsTable.stayId, stay.id),
          eq(hotelPackageConsumptionsTable.packageId, pkg.id),
          eq(hotelPackageConsumptionsTable.consumedOn, today),
        ));
      pkgUsedToday = Number(used[0]?.s ?? 0);
    }
  }
  res.json({ ...stay, guest, folio, lines, package: pkg, packageUsedToday: pkgUsedToday });
});

// ---- Packages -------------------------------------------------------------

router.get("/restaurants/:restaurantId/hotel/packages", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const tenantId = await tenantForRestaurant(restaurantId);
  if (!tenantId) return void res.status(404).json({ error: "Tenant not found" });
  const rows = await db.select().from(hotelPackagesTable)
    .where(eq(hotelPackagesTable.tenantId, tenantId)).orderBy(desc(hotelPackagesTable.createdAt));
  res.json(rows);
});

router.post(
  "/restaurants/:restaurantId/hotel/packages",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const tenantId = await tenantForRestaurant(restaurantId);
    if (!tenantId) return void res.status(404).json({ error: "Tenant not found" });
    const { name, description, mealType, dailyEntitlement, windowStart, windowEnd, eligibleCategoryIds } = req.body;
    if (!name) return void res.status(400).json({ error: "name is required" });
    const [row] = await db.insert(hotelPackagesTable).values({
      tenantId, name, description,
      mealType: mealType ?? "breakfast",
      dailyEntitlement: Number(dailyEntitlement) || 2,
      windowStart, windowEnd,
      eligibleCategoryIds: Array.isArray(eligibleCategoryIds) ? eligibleCategoryIds.map(Number) : null,
    }).returning();
    res.status(201).json(row);
  },
);

// ---- Folio: add line / close ---------------------------------------------

router.post(
  "/restaurants/:restaurantId/hotel/folios/:id/lines",
  requireRole("owner", "manager", "cashier", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const tenantId = await tenantForRestaurant(restaurantId);
    if (!tenantId) return void res.status(404).json({ error: "Tenant not found" });
    const folioId = Number(req.params.id);
    const [folio] = await db.select().from(hotelFoliosTable)
      .where(and(eq(hotelFoliosTable.id, folioId), eq(hotelFoliosTable.tenantId, tenantId)));
    if (!folio) return void res.status(404).json({ error: "Folio not found" });
    if (folio.status !== "open") return void res.status(400).json({ error: "Folio is closed" });
    const { kind, source, description, amount, refType, refId } = req.body;
    if (!["charge", "discount", "comp", "payment"].includes(String(kind))) {
      return void res.status(400).json({ error: "invalid kind" });
    }
    const amt = Number(amount);
    if (!isFinite(amt) || amt <= 0) return void res.status(400).json({ error: "amount must be > 0" });
    const [line] = await db.insert(hotelFolioLinesTable).values({
      folioId, tenantId, restaurantId,
      kind: String(kind), source: source ? String(source) : "adjustment",
      description: String(description ?? ""), amount: amt.toFixed(2),
      refType, refId, recordedByUserId: req.user?.sub ?? null,
    }).returning();
    await recalcFolio(folioId);
    res.status(201).json(line);
  },
);

router.post(
  "/restaurants/:restaurantId/hotel/folios/:id/close",
  requireRole("owner", "manager", "cashier", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const tenantId = await tenantForRestaurant(restaurantId);
    if (!tenantId) return void res.status(404).json({ error: "Tenant not found" });
    const folioId = Number(req.params.id);
    const splits = (req.body.splits ?? []) as Array<{ method: string; amount: number; notes?: string }>;
    if (!Array.isArray(splits) || splits.length === 0) {
      return void res.status(400).json({ error: "splits[] is required" });
    }

    const [folio] = await db.select().from(hotelFoliosTable)
      .where(and(eq(hotelFoliosTable.id, folioId), eq(hotelFoliosTable.tenantId, tenantId)));
    if (!folio) return void res.status(404).json({ error: "Folio not found" });
    if (folio.status !== "open") return void res.status(400).json({ error: "Folio already closed" });

    const totals = await recalcFolio(folioId);
    const totalSplit = splits.reduce((s, x) => s + Number(x.amount), 0);
    if (Math.abs(totalSplit - totals.balance) > 0.01) {
      return void res.status(400).json({ error: `Splits (${totalSplit.toFixed(2)}) must equal outstanding balance (${totals.balance.toFixed(2)})` });
    }

    for (const sp of splits) {
      const amt = Number(sp.amount);
      if (!isFinite(amt) || amt <= 0) continue;
      await db.insert(hotelFolioLinesTable).values({
        folioId, tenantId, restaurantId, kind: "payment", source: "settlement",
        description: `Settlement (${sp.method})`, amount: amt.toFixed(2),
        recordedByUserId: req.user?.sub ?? null,
      });
      await db.insert(paymentsTable).values({
        restaurantId, direction: "in",
        method: sp.method, amount: amt.toFixed(2),
        paymentDate: new Date(),
        partyType: "other", partyName: `Folio #${folioId}`,
        referenceType: "manual", notes: `Hotel folio #${folioId} settlement${sp.notes ? ` — ${sp.notes}` : ""}`,
        recordedBy: req.user?.sub ?? null,
      });
    }

    const invoiceNumber = `HOT-${folioId}-${Date.now().toString(36).toUpperCase()}`;
    const final = await recalcFolio(folioId);
    await db.update(hotelFoliosTable).set({
      status: "closed", closedAt: new Date(), invoiceNumber, updatedAt: new Date(),
    }).where(eq(hotelFoliosTable.id, folioId));

    if (folio.stayId) {
      await db.update(hotelStaysTable).set({
        status: "checked_out", checkOutAt: new Date(), updatedAt: new Date(),
      }).where(eq(hotelStaysTable.id, folio.stayId));
    }
    if (folio.banquetEventId) {
      await db.update(hotelBanquetEventsTable).set({
        status: "closed", updatedAt: new Date(),
      }).where(eq(hotelBanquetEventsTable.id, folio.banquetEventId));
    }

    res.json({ folioId, invoiceNumber, ...final });
  },
);

// ---- Mini-bar -------------------------------------------------------------

router.post(
  "/restaurants/:restaurantId/hotel/minibar",
  requireRole("owner", "manager", "cashier", "staff", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const tenantId = await tenantForRestaurant(restaurantId);
    if (!tenantId) return void res.status(404).json({ error: "Tenant not found" });
    const { stayId, itemName, quantity, unitPrice, notes } = req.body;
    const qty = Number(quantity) || 1;
    const price = Number(unitPrice) || 0;
    const total = qty * price;
    if (!stayId || !itemName || total <= 0) {
      return void res.status(400).json({ error: "stayId, itemName, quantity and unitPrice are required" });
    }
    const [stay] = await db.select().from(hotelStaysTable)
      .where(and(eq(hotelStaysTable.id, Number(stayId)), eq(hotelStaysTable.tenantId, tenantId)));
    if (!stay) return void res.status(404).json({ error: "Stay not found" });
    if (stay.status !== "in_house") return void res.status(400).json({ error: "Stay is not in-house" });
    const folioId = await ensureFolioForStay(stay.id, tenantId);
    const [line] = await db.insert(hotelFolioLinesTable).values({
      folioId, tenantId, restaurantId, kind: "charge", source: "minibar",
      description: `Mini-bar: ${itemName} ×${qty}`,
      amount: total.toFixed(2),
      recordedByUserId: req.user?.sub ?? null,
    }).returning();
    const [posting] = await db.insert(hotelMinibarPostingsTable).values({
      tenantId, restaurantId, stayId: stay.id, itemName: String(itemName),
      quantity: qty, unitPrice: price.toFixed(2), totalAmount: total.toFixed(2),
      notes, postedByUserId: req.user?.sub ?? null, folioLineId: line.id,
    }).returning();
    await recalcFolio(folioId);
    res.status(201).json({ posting, line });
  },
);

router.get("/restaurants/:restaurantId/hotel/minibar", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db.select().from(hotelMinibarPostingsTable)
    .where(eq(hotelMinibarPostingsTable.restaurantId, restaurantId))
    .orderBy(desc(hotelMinibarPostingsTable.createdAt)).limit(100);
  res.json(rows);
});

// ---- Housekeeping food requests ------------------------------------------

router.get("/restaurants/:restaurantId/hotel/housekeeping-requests", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const tenantId = await tenantForRestaurant(restaurantId);
  if (!tenantId) return void res.status(404).json({ error: "Tenant not found" });
  const rows = await db.select().from(hotelHousekeepingRequestsTable)
    .where(eq(hotelHousekeepingRequestsTable.tenantId, tenantId))
    .orderBy(desc(hotelHousekeepingRequestsTable.createdAt)).limit(200);
  res.json(rows);
});

router.post(
  "/restaurants/:restaurantId/hotel/housekeeping-requests",
  requireRole("owner", "manager", "staff", "waiter", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const tenantId = await tenantForRestaurant(restaurantId);
    if (!tenantId) return void res.status(404).json({ error: "Tenant not found" });
    const { stayId, description, items, notes } = req.body as {
      stayId: number; description: string;
      items?: Array<{ menuItemId: number; quantity: number; notes?: string }>;
      notes?: string;
    };
    if (!stayId || !description) return void res.status(400).json({ error: "stayId and description are required" });
    const [stay] = await db.select().from(hotelStaysTable)
      .where(and(eq(hotelStaysTable.id, Number(stayId)), eq(hotelStaysTable.tenantId, tenantId)));
    if (!stay) return void res.status(404).json({ error: "Stay not found" });

    let orderId: number | null = null;
    if (Array.isArray(items) && items.length > 0) {
      let subtotal = 0;
      const enriched: Array<{ mi: typeof menuItemsTable.$inferSelect; qty: number; notes?: string }> = [];
      for (const it of items) {
        const [mi] = await db.select().from(menuItemsTable)
          .where(and(eq(menuItemsTable.id, Number(it.menuItemId)), eq(menuItemsTable.restaurantId, restaurantId)));
        if (!mi) continue;
        subtotal += Number(mi.price) * Number(it.quantity);
        enriched.push({ mi, qty: Number(it.quantity), notes: it.notes });
      }
      const [order] = await db.insert(ordersTable).values({
        restaurantId, orderNumber: `HK-${Date.now().toString(36).toUpperCase()}`,
        orderType: "dine_in", status: "pending",
        subtotal: subtotal.toFixed(2), totalAmount: subtotal.toFixed(2),
        customerName: `Room ${stay.roomNumber} (Housekeeping)`,
        notes: description,
        hotelStayId: stay.id,
      }).returning();
      orderId = order.id;
      for (const ei of enriched) {
        await db.insert(orderItemsTable).values({
          orderId: order.id, menuItemId: ei.mi.id, menuItemName: ei.mi.name,
          quantity: ei.qty, unitPrice: Number(ei.mi.price).toFixed(2),
          totalPrice: (Number(ei.mi.price) * ei.qty).toFixed(2), notes: ei.notes,
        });
      }
      const tickets = await createKitchenTicketsForOrder({ orderId: order.id, restaurantId, isPriority: false });
      for (const t of tickets) {
        broadcastEvent(restaurantId, "order:new", { ...order, ticketId: t.ticketId, kitchenId: t.kitchenId });
      }
    }

    const [row] = await db.insert(hotelHousekeepingRequestsTable).values({
      tenantId, restaurantId, stayId: stay.id,
      description, notes, orderId,
      requestedByUserId: req.user?.sub ?? null,
    }).returning();
    res.status(201).json(row);
  },
);

// ---- Banquet events -------------------------------------------------------

router.get("/restaurants/:restaurantId/hotel/banquet-events", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const tenantId = await tenantForRestaurant(restaurantId);
  if (!tenantId) return void res.status(404).json({ error: "Tenant not found" });
  const rows = await db.select().from(hotelBanquetEventsTable)
    .where(eq(hotelBanquetEventsTable.tenantId, tenantId))
    .orderBy(desc(hotelBanquetEventsTable.createdAt)).limit(100);
  res.json(rows);
});

router.post(
  "/restaurants/:restaurantId/hotel/banquet-events",
  requireRole("owner", "manager", "cashier", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const tenantId = await tenantForRestaurant(restaurantId);
    if (!tenantId) return void res.status(404).json({ error: "Tenant not found" });
    const { name, hostStayId, hostName, hostPhone, partySize, scheduledAt, reservationId, notes } = req.body;
    if (!name) return void res.status(400).json({ error: "name is required" });
    const [event] = await db.insert(hotelBanquetEventsTable).values({
      tenantId, restaurantId, name,
      hostStayId: hostStayId ? Number(hostStayId) : null,
      hostName, hostPhone, partySize: Number(partySize) || 1,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      reservationId: reservationId ? Number(reservationId) : null,
      notes,
    }).returning();
    await ensureFolioForBanquet(event.id, tenantId);
    res.status(201).json(event);
  },
);

router.post(
  "/restaurants/:restaurantId/hotel/banquet-events/:id/close",
  requireRole("owner", "manager", "cashier", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const tenantId = await tenantForRestaurant(restaurantId);
    if (!tenantId) return void res.status(404).json({ error: "Tenant not found" });
    const eventId = Number(req.params.id);
    const rollToHostFolio = !!req.body.rollToHostFolio;
    const [event] = await db.select().from(hotelBanquetEventsTable)
      .where(and(eq(hotelBanquetEventsTable.id, eventId), eq(hotelBanquetEventsTable.tenantId, tenantId)));
    if (!event) return void res.status(404).json({ error: "Event not found" });
    if (event.status !== "open") return void res.status(400).json({ error: "Event already closed" });
    const folioId = await ensureFolioForBanquet(event.id, tenantId);
    const totals = await recalcFolio(folioId);

    if (rollToHostFolio && event.hostStayId) {
      const hostFolioId = await ensureFolioForStay(event.hostStayId, tenantId);
      if (totals.balance > 0) {
        await db.insert(hotelFolioLinesTable).values({
          folioId: hostFolioId, tenantId, restaurantId,
          kind: "charge", source: "banquet",
          description: `Banquet: ${event.name}`,
          amount: totals.balance.toFixed(2),
          refType: "banquet_event", refId: event.id,
          recordedByUserId: req.user?.sub ?? null,
        });
        await db.insert(hotelFolioLinesTable).values({
          folioId, tenantId, restaurantId, kind: "payment", source: "settlement",
          description: `Rolled to room ${event.hostStayId} folio`,
          amount: totals.balance.toFixed(2), recordedByUserId: req.user?.sub ?? null,
        });
        await recalcFolio(hostFolioId);
        await recalcFolio(folioId);
      }
      await db.update(hotelFoliosTable).set({
        status: "closed", closedAt: new Date(),
        invoiceNumber: `BANQ-${event.id}-${Date.now().toString(36).toUpperCase()}`,
        updatedAt: new Date(),
      }).where(eq(hotelFoliosTable.id, folioId));
      await db.update(hotelBanquetEventsTable).set({
        status: "closed", updatedAt: new Date(),
      }).where(eq(hotelBanquetEventsTable.id, event.id));
      res.json({ folioId, rolledToStayId: event.hostStayId, ...await recalcFolio(folioId) });
      return;
    }

    res.json({ folioId, ...totals, hint: "Use POST /folios/:id/close to settle the banquet folio independently" });
  },
);

export default router;
