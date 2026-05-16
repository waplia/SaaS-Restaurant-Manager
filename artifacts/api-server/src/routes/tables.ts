import { Router } from "express";
import { eq, and, or, inArray, gte, lte, ne, sql, desc, asc } from "drizzle-orm";
import { db, floorTablesTable, reservationsTable, waitlistEntriesTable, customersTable, subscriptionPlansTable, tenantsTable, restaurantsTable, ordersTable, orderItemsTable, kitchenTicketsTable, notificationsTable } from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { requirePlanFeature } from "../middleware/planFeature";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { sendEmail, sendWhatsApp, reservationEmail } from "../lib/notifications";
import { pushToStaff } from "../lib/pushNotify";

// Allowed string enums (kept narrow on the wire to avoid bad data)
const RESERVATION_STATUSES = ["pending", "confirmed", "seated", "completed", "cancelled", "no_show"] as const;
const DEPOSIT_STATUSES = ["none", "required", "pending", "paid", "refunded", "waived"] as const;
const SOURCE_CHANNELS = ["staff", "public", "walkin", "phone", "mobile"] as const;
const OCCASIONS = ["birthday", "anniversary", "business", "date", "celebration", "other"] as const;
const WAITLIST_STATUSES = ["waiting", "notified", "seated", "cancelled", "no_show"] as const;

const router = Router();

router.use("/restaurants/:restaurantId", requireRole("owner", "manager", "waiter", "kitchen", "super_admin"), validateRestaurantAccess);

router.get("/restaurants/:restaurantId/tables", async (req, res) => {
  const rows = await db.select().from(floorTablesTable).where(eq(floorTablesTable.restaurantId, Number(req.params.restaurantId)));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/tables", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);

  if (!req.user!.isSuperAdmin) {
    const [restaurant] = await db.select({ tenantId: restaurantsTable.tenantId }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
    if (restaurant?.tenantId) {
      const [tenant] = await db.select({ planId: tenantsTable.planId }).from(tenantsTable).where(eq(tenantsTable.id, restaurant.tenantId));
      if (tenant?.planId) {
        const [plan] = await db.select({ maxTables: subscriptionPlansTable.maxTables }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, tenant.planId));
        if (plan && plan.maxTables > 0) {
          const existing = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.restaurantId, restaurantId), eq(floorTablesTable.isActive, true)));
          if (existing.length >= plan.maxTables) {
            return void res.status(402).json({ error: `Your plan allows a maximum of ${plan.maxTables} table(s). Upgrade to add more.` });
          }
        }
      }
    }
  }

  const { tableNumber, capacity, positionX, positionY, shape } = req.body;
  const qrCode = `${restaurantId}-${tableNumber}-${Date.now()}`;
  const [table] = await db.insert(floorTablesTable).values({ restaurantId, tableNumber, capacity, positionX, positionY, shape, qrCode }).returning();
  res.status(201).json(table);
});

router.patch("/restaurants/:restaurantId/tables/:id", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const { tableNumber, capacity, status, positionX, positionY, shape, isActive } = req.body;
  const [updated] = await db.update(floorTablesTable).set({ tableNumber, capacity, status, positionX, positionY, shape, isActive, updatedAt: new Date() }).where(and(eq(floorTablesTable.id, Number(req.params.id)), eq(floorTablesTable.restaurantId, Number(req.params.restaurantId)))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/restaurants/:restaurantId/tables/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  await db.update(floorTablesTable).set({ isActive: false }).where(and(eq(floorTablesTable.id, Number(req.params.id)), eq(floorTablesTable.restaurantId, Number(req.params.restaurantId))));
  res.status(204).send();
});

router.get("/restaurants/:restaurantId/tables/:id/qr", requirePlanFeature("qr_ordering"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const [table] = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.id, Number(req.params.id)), eq(floorTablesTable.restaurantId, restaurantId)));
  if (!table) return void res.status(404).json({ error: "Not found" });
  const [restaurant] = await db.select({ slug: restaurantsTable.slug }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  const slug = restaurant?.slug ?? String(restaurantId);
  const envBase = process.env.PUBLIC_URL?.replace(/\/$/, "");
  const forwardedProto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
  const forwardedHost = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim();
  const host = forwardedHost ?? req.get("host") ?? "";
  const proto = forwardedProto ?? (host.includes("localhost") ? "http" : "https");
  const requestBase = host ? `${proto}://${host}` : "";
  const baseUrl = envBase || requestBase;
  const qrUrl = `${baseUrl}/menu/${slug}/${table.id}`;
  let svgData = "";
  try {
    const QRCode = await import("qrcode");
    svgData = await QRCode.toString(qrUrl, { type: "svg", margin: 1, width: 300 });
  } catch { /* qrcode unavailable — svgData stays empty */ }
  res.json({ qrUrl, tableNumber: table.tableNumber, svgData });
});

router.post("/restaurants/:restaurantId/tables/merge", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { sourceTableId, targetTableId } = req.body as { sourceTableId: number; targetTableId: number };
  if (!sourceTableId || !targetTableId || Number(sourceTableId) === Number(targetTableId)) {
    return void res.status(400).json({ error: "sourceTableId and targetTableId must be different valid IDs" });
  }

  const [srcTable] = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.id, Number(sourceTableId)), eq(floorTablesTable.restaurantId, restaurantId)));
  const [tgtTable] = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.id, Number(targetTableId)), eq(floorTablesTable.restaurantId, restaurantId)));
  if (!srcTable || !tgtTable) return void res.status(404).json({ error: "One or both tables not found" });
  if (srcTable.status !== "occupied") return void res.status(400).json({ error: "Source table must be occupied" });
  if (tgtTable.status !== "occupied") return void res.status(400).json({ error: "Target table must be occupied" });

  const activeStatuses = [eq(ordersTable.status, "pending"), eq(ordersTable.status, "preparing")];
  const [srcOrder] = await db.select().from(ordersTable).where(and(eq(ordersTable.tableId, Number(sourceTableId)), eq(ordersTable.restaurantId, restaurantId), or(...activeStatuses))).orderBy(ordersTable.createdAt);
  const [tgtOrder] = await db.select().from(ordersTable).where(and(eq(ordersTable.tableId, Number(targetTableId)), eq(ordersTable.restaurantId, restaurantId), or(...activeStatuses))).orderBy(ordersTable.createdAt);

  let cancelledTicketId: number | null = null;

  await db.transaction(async (tx) => {
    if (srcOrder && tgtOrder) {
      const srcItems = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, srcOrder.id));
      if (srcItems.length > 0) {
        await tx.update(orderItemsTable).set({ orderId: tgtOrder.id }).where(inArray(orderItemsTable.id, srcItems.map(i => i.id)));
      }
      const newTotal = (Number(tgtOrder.totalAmount) + Number(srcOrder.totalAmount)).toFixed(2);
      await tx.update(ordersTable).set({ totalAmount: newTotal, updatedAt: new Date() }).where(eq(ordersTable.id, tgtOrder.id));
      await tx.update(ordersTable).set({ status: "cancelled", tableId: null, updatedAt: new Date() }).where(eq(ordersTable.id, srcOrder.id));
      // Cancel the source kitchen ticket
      const [srcTicket] = await tx.update(kitchenTicketsTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(kitchenTicketsTable.orderId, srcOrder.id), eq(kitchenTicketsTable.restaurantId, restaurantId)))
        .returning();
      if (srcTicket) cancelledTicketId = srcTicket.id;
    } else if (srcOrder && !tgtOrder) {
      await tx.update(ordersTable).set({ tableId: Number(targetTableId), updatedAt: new Date() }).where(eq(ordersTable.id, srcOrder.id));
      await tx.update(floorTablesTable).set({ status: "occupied", updatedAt: new Date() }).where(eq(floorTablesTable.id, Number(targetTableId)));
    }
    await tx.update(floorTablesTable).set({ status: "free", updatedAt: new Date() }).where(eq(floorTablesTable.id, Number(sourceTableId)));
  });

  const [updatedSrc] = await db.select().from(floorTablesTable).where(eq(floorTablesTable.id, Number(sourceTableId)));
  const [updatedTgt] = await db.select().from(floorTablesTable).where(eq(floorTablesTable.id, Number(targetTableId)));

  const { broadcastEvent } = await import("../lib/socketio");
  broadcastEvent(restaurantId, "tables:merged", { sourceTableId, targetTableId });
  if (cancelledTicketId !== null) {
    broadcastEvent(restaurantId, "ticket:status", { id: cancelledTicketId, status: "cancelled", orderId: srcOrder!.id });
  }

  res.json({ success: true, sourceTable: updatedSrc, targetTable: updatedTgt });
});

router.post("/restaurants/:restaurantId/orders/:orderId/split-to-table", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const orderId = Number(req.params.orderId);
  const { targetTableId, itemIds } = req.body as { targetTableId: number; itemIds: number[] };

  if (!targetTableId || !Array.isArray(itemIds) || itemIds.length === 0) {
    return void res.status(400).json({ error: "targetTableId and at least one itemId are required" });
  }

  const [srcOrder] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, orderId), eq(ordersTable.restaurantId, restaurantId)));
  if (!srcOrder) return void res.status(404).json({ error: "Source order not found" });

  const [tgtTable] = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.id, Number(targetTableId)), eq(floorTablesTable.restaurantId, restaurantId)));
  if (!tgtTable) return void res.status(404).json({ error: "Target table not found" });

  const allSrcItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const toMove = allSrcItems.filter(i => (itemIds as number[]).includes(i.id));
  if (toMove.length === 0) return void res.status(400).json({ error: "None of the specified items belong to this order" });
  if (toMove.length === allSrcItems.length) return void res.status(400).json({ error: "Cannot move all items — use merge instead" });

  const movedTotal = toMove.reduce((s, i) => s + Number(i.unitPrice) * Number(i.quantity), 0);
  const newSrcTotal = Math.max(0, Number(srcOrder.totalAmount) - movedTotal).toFixed(2);

  const [existingTgtOrder] = await db.select().from(ordersTable).where(and(eq(ordersTable.tableId, Number(targetTableId)), eq(ordersTable.restaurantId, restaurantId), or(eq(ordersTable.status, "pending"), eq(ordersTable.status, "preparing"))));

  let targetOrderId: number;
  let createdNewOrder = false;

  await db.transaction(async (tx) => {
    if (existingTgtOrder) {
      targetOrderId = existingTgtOrder.id;
      await tx.update(ordersTable).set({ totalAmount: (Number(existingTgtOrder.totalAmount) + movedTotal).toFixed(2), updatedAt: new Date() }).where(eq(ordersTable.id, existingTgtOrder.id));
    } else {
      const splitOrderNumber = `SPL-${Date.now().toString(36).toUpperCase()}`;
      const [newOrder] = await tx.insert(ordersTable).values({
        restaurantId,
        tableId: Number(targetTableId),
        orderNumber: splitOrderNumber,
        orderType: srcOrder.orderType,
        status: "pending",
        paymentStatus: "unpaid",
        totalAmount: movedTotal.toFixed(2),
      }).returning();
      targetOrderId = newOrder.id;
      createdNewOrder = true;
      await tx.update(floorTablesTable).set({ status: "occupied", updatedAt: new Date() }).where(eq(floorTablesTable.id, Number(targetTableId)));
    }
    await tx.update(orderItemsTable).set({ orderId: targetOrderId! }).where(inArray(orderItemsTable.id, toMove.map(i => i.id)));
    await tx.update(ordersTable).set({ totalAmount: newSrcTotal, updatedAt: new Date() }).where(eq(ordersTable.id, orderId));
  });

  const { broadcastEvent } = await import("../lib/socketio");
  broadcastEvent(restaurantId, "order:split", { sourceOrderId: orderId, targetOrderId: targetOrderId!, targetTableId, itemCount: toMove.length });
  if (createdNewOrder) {
    const { createKitchenTicketsForOrder } = await import("../lib/kitchenRouting");
    const tickets = await createKitchenTicketsForOrder({ orderId: targetOrderId!, restaurantId, isPriority: false });
    for (const t of tickets) {
      broadcastEvent(restaurantId, "order:new", { id: targetOrderId!, restaurantId, tableId: Number(targetTableId), orderNumber: "SPL-ticket", ticketId: t.ticketId, kitchenId: t.kitchenId });
    }
  }

  res.json({ success: true, sourceOrderId: orderId, targetOrderId: targetOrderId!, itemsMoved: toMove.length });
});

async function findReservationConflict(restaurantId: number, tableId: number, scheduledAt: Date, durationMinutes: number, excludeId?: number) {
  const startA = scheduledAt;
  const endA = new Date(scheduledAt.getTime() + durationMinutes * 60_000);
  const conditions = [
    eq(reservationsTable.restaurantId, restaurantId),
    eq(reservationsTable.tableId, tableId),
    inArray(reservationsTable.status, ["pending", "confirmed", "seated"]),
    sql`${reservationsTable.scheduledAt} < ${endA}`,
    sql`(${reservationsTable.scheduledAt} + (${reservationsTable.durationMinutes} || ' minutes')::interval) > ${startA}`,
  ];
  if (excludeId) conditions.push(ne(reservationsTable.id, excludeId));
  const rows = await db.select().from(reservationsTable).where(and(...conditions)).limit(1);
  return rows[0] ?? null;
}

router.get("/restaurants/:restaurantId/reservations", async (req, res) => {
  const { status, date } = req.query;
  const conditions: Parameters<typeof and>[number][] = [eq(reservationsTable.restaurantId, Number(req.params.restaurantId))];
  if (status) conditions.push(eq(reservationsTable.status, String(status)));
  if (date) {
    const start = new Date(`${String(date)}T00:00:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60_000);
    conditions.push(gte(reservationsTable.scheduledAt, start));
    conditions.push(sql`${reservationsTable.scheduledAt} < ${end}`);
  }
  const rows = await db.select().from(reservationsTable).where(and(...conditions)).orderBy(reservationsTable.scheduledAt);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/reservations", requireRole("owner", "manager", "waiter", "super_admin"), requirePlanFeature("reservations"), async (req, res) => {
  const {
    guestName, guestPhone, guestEmail, tableId, partySize, scheduledAt, durationMinutes, notes, status,
    occasion, occasionNotes, seatingNotes, isVip, depositAmount, depositStatus, depositPaymentRef,
    gracePeriodMinutes, sourceChannel, customerId, cleaningRequiredOnComplete,
  } = req.body;
  const restaurantId = Number(req.params.restaurantId);

  if (!guestName || typeof guestName !== "string" || !guestName.trim()) return void res.status(400).json({ error: "Guest name is required" });
  const partySizeNum = Number(partySize);
  if (!partySizeNum || partySizeNum < 1) return void res.status(400).json({ error: "Party size must be at least 1" });
  if (!scheduledAt) return void res.status(400).json({ error: "Date and time are required" });
  const dt = new Date(scheduledAt);
  if (Number.isNaN(dt.getTime())) return void res.status(400).json({ error: "Invalid scheduled time" });
  if (dt.getTime() < Date.now() - 5 * 60_000) return void res.status(400).json({ error: "Reservation time must be in the future" });
  const dur = Number(durationMinutes) || 90;

  if (occasion !== undefined && occasion !== null && !OCCASIONS.includes(occasion)) {
    return void res.status(400).json({ error: `Invalid occasion. Allowed: ${OCCASIONS.join(", ")}` });
  }
  if (depositStatus !== undefined && !DEPOSIT_STATUSES.includes(depositStatus)) {
    return void res.status(400).json({ error: "Invalid deposit status" });
  }
  if (sourceChannel !== undefined && !SOURCE_CHANNELS.includes(sourceChannel)) {
    return void res.status(400).json({ error: "Invalid source channel" });
  }

  if (tableId) {
    const [tbl] = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.id, Number(tableId)), eq(floorTablesTable.restaurantId, restaurantId)));
    if (!tbl) return void res.status(400).json({ error: "Selected table not found" });
    if (tbl.capacity < partySizeNum) return void res.status(400).json({ error: `Table ${tbl.tableNumber} only seats ${tbl.capacity}, party of ${partySizeNum} won't fit` });
    const conflict = await findReservationConflict(restaurantId, Number(tableId), dt, dur);
    if (conflict) {
      return void res.status(409).json({ error: `Table is already reserved at ${new Date(conflict.scheduledAt).toLocaleString()} for ${conflict.guestName}`, conflict });
    }
  }

  const [reservation] = await db.insert(reservationsTable).values({
    restaurantId, guestName: guestName.trim(), guestPhone, guestEmail,
    tableId: tableId ?? null, partySize: partySizeNum,
    scheduledAt: dt, durationMinutes: dur, notes,
    status: status ?? "confirmed",
    customerId: customerId ?? null,
    occasion: occasion ?? null,
    occasionNotes: occasionNotes ?? null,
    seatingNotes: seatingNotes ?? null,
    isVip: !!isVip,
    depositAmount: depositAmount != null ? String(depositAmount) : null,
    depositStatus: depositStatus ?? (depositAmount ? "required" : "none"),
    depositPaymentRef: depositPaymentRef ?? null,
    gracePeriodMinutes: Number(gracePeriodMinutes) || 15,
    sourceChannel: sourceChannel ?? "staff",
    cleaningRequiredOnComplete: cleaningRequiredOnComplete !== false,
  }).returning();
  res.status(201).json(reservation);

  if ((reservation.status ?? "confirmed") === "confirmed") {
    pushToStaff(
      { restaurantId, roles: ["owner", "manager", "waiter"], type: "reservation" },
      {
        title: "Reservation confirmed",
        body: `${guestName.trim()} • ${partySizeNum} guests • ${dt.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`,
        data: { screen: "reservations", reservationId: reservation.id, tableId: reservation.tableId ?? null },
      },
    ).catch(() => {});
  }

  if (guestEmail && guestName && scheduledAt) {
    try {
      const [restaurant] = await db.select({ name: restaurantsTable.name }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
      const tpl = reservationEmail({
        customerName: guestName,
        restaurantName: restaurant?.name ?? "Restaurant",
        date: dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
        time: dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        guests: partySizeNum,
      });
      sendEmail({ to: guestEmail, subject: tpl.subject, html: tpl.html, text: tpl.text }).catch(console.error);
      if (guestPhone) sendWhatsApp({ to: guestPhone, body: tpl.text }).catch(console.error);
    } catch (err) {
      console.error("[Reservation] Notification send failed:", err);
    }
  }
});

router.patch("/restaurants/:restaurantId/reservations/:id", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const {
    guestName, guestPhone, guestEmail, tableId, partySize, scheduledAt, durationMinutes, status, notes,
    occasion, occasionNotes, seatingNotes, isVip, depositAmount, depositStatus, depositPaymentRef,
    gracePeriodMinutes, sourceChannel, walkInArrivedAt, estimatedWaitMinutes, cleaningRequiredOnComplete,
  } = req.body;
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);

  const [existing] = await db.select().from(reservationsTable).where(and(eq(reservationsTable.id, id), eq(reservationsTable.restaurantId, restaurantId)));
  if (!existing) return void res.status(404).json({ error: "Not found" });

  if (status !== undefined && !RESERVATION_STATUSES.includes(status)) return void res.status(400).json({ error: "Invalid status" });
  if (depositStatus !== undefined && !DEPOSIT_STATUSES.includes(depositStatus)) return void res.status(400).json({ error: "Invalid deposit status" });
  if (occasion !== undefined && occasion !== null && !OCCASIONS.includes(occasion)) return void res.status(400).json({ error: "Invalid occasion" });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (guestName !== undefined) updates.guestName = guestName;
  if (guestPhone !== undefined) updates.guestPhone = guestPhone;
  if (guestEmail !== undefined) updates.guestEmail = guestEmail;
  if (notes !== undefined) updates.notes = notes;
  if (status !== undefined) updates.status = status;
  if (occasion !== undefined) updates.occasion = occasion;
  if (occasionNotes !== undefined) updates.occasionNotes = occasionNotes;
  if (seatingNotes !== undefined) updates.seatingNotes = seatingNotes;
  if (isVip !== undefined) updates.isVip = !!isVip;
  if (depositAmount !== undefined) updates.depositAmount = depositAmount == null ? null : String(depositAmount);
  if (depositStatus !== undefined) updates.depositStatus = depositStatus;
  if (depositPaymentRef !== undefined) updates.depositPaymentRef = depositPaymentRef;
  if (gracePeriodMinutes !== undefined) updates.gracePeriodMinutes = Number(gracePeriodMinutes) || 15;
  if (sourceChannel !== undefined) updates.sourceChannel = sourceChannel;
  if (walkInArrivedAt !== undefined) updates.walkInArrivedAt = walkInArrivedAt ? new Date(walkInArrivedAt) : null;
  if (estimatedWaitMinutes !== undefined) updates.estimatedWaitMinutes = estimatedWaitMinutes == null ? null : Number(estimatedWaitMinutes);
  if (cleaningRequiredOnComplete !== undefined) updates.cleaningRequiredOnComplete = !!cleaningRequiredOnComplete;
  if (status === "no_show") updates.noShowMarkedAt = new Date();
  if (partySize !== undefined) {
    const ps = Number(partySize);
    if (!ps || ps < 1) return void res.status(400).json({ error: "Party size must be at least 1" });
    updates.partySize = ps;
  }
  if (tableId !== undefined) updates.tableId = tableId;
  if (scheduledAt !== undefined) {
    const dt = new Date(scheduledAt);
    if (Number.isNaN(dt.getTime())) return void res.status(400).json({ error: "Invalid scheduled time" });
    // Only enforce future-time when rescheduling an active booking
    const nextStatus = (status as string | undefined) ?? existing.status;
    if (["pending", "confirmed"].includes(nextStatus) && dt.getTime() < Date.now() - 5 * 60_000) {
      return void res.status(400).json({ error: "Reservation time must be in the future" });
    }
    updates.scheduledAt = dt;
  }
  if (durationMinutes !== undefined) updates.durationMinutes = Number(durationMinutes) || 90;

  const finalTableId = tableId !== undefined ? tableId : existing.tableId;
  const finalScheduledAt = updates.scheduledAt as Date | undefined ?? existing.scheduledAt;
  const finalDuration = (updates.durationMinutes as number | undefined) ?? existing.durationMinutes;
  const finalStatus = (updates.status as string | undefined) ?? existing.status;
  const finalParty = (updates.partySize as number | undefined) ?? existing.partySize;

  if (finalTableId && ["pending", "confirmed", "seated"].includes(finalStatus)) {
    const [tbl] = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.id, Number(finalTableId)), eq(floorTablesTable.restaurantId, restaurantId)));
    if (!tbl) return void res.status(400).json({ error: "Selected table not found" });
    if (tbl.capacity < finalParty) return void res.status(400).json({ error: `Table ${tbl.tableNumber} only seats ${tbl.capacity}` });
    const conflict = await findReservationConflict(restaurantId, Number(finalTableId), finalScheduledAt, finalDuration, id);
    if (conflict) return void res.status(409).json({ error: `Conflicts with ${conflict.guestName} at ${new Date(conflict.scheduledAt).toLocaleString()}`, conflict });
  }

  const [updated] = await db.update(reservationsTable).set(updates).where(and(eq(reservationsTable.id, id), eq(reservationsTable.restaurantId, restaurantId))).returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });

  // Sync floor table status with reservation lifecycle.
  if (status === "seated" && updated.tableId) {
    await db.update(floorTablesTable).set({ status: "occupied", updatedAt: new Date() }).where(eq(floorTablesTable.id, updated.tableId));
  } else if (status && ["completed", "cancelled", "no_show"].includes(status) && updated.tableId) {
    const [tbl] = await db.select().from(floorTablesTable).where(eq(floorTablesTable.id, updated.tableId));
    if (tbl && (tbl.status === "reserved" || tbl.status === "occupied")) {
      const setNeedsCleaning = status === "completed" && updated.cleaningRequiredOnComplete;
      await db.update(floorTablesTable).set({
        status: "free",
        needsCleaning: setNeedsCleaning ? true : tbl.needsCleaning,
        updatedAt: new Date(),
      }).where(eq(floorTablesTable.id, updated.tableId));
    }
  }

  // Track no-show on the linked customer profile so VIP + risk decisions are easy to make.
  if (status === "no_show" && updated.customerId) {
    await db.update(customersTable).set({
      noShowCount: sql`${customersTable.noShowCount} + 1`,
      lastNoShowAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(customersTable.id, updated.customerId));
  }

  res.json(updated);
});

router.delete("/restaurants/:restaurantId/reservations/:id", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  await db.delete(reservationsTable).where(eq(reservationsTable.id, Number(req.params.id)));
  res.status(204).send();
});

/* ---------- Walk-in seat-now (creates a seated reservation immediately) ---------- */
router.post("/restaurants/:restaurantId/reservations/walkin", requireRole("owner", "manager", "waiter", "super_admin"), requirePlanFeature("reservations"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { guestName, guestPhone, partySize, tableId, notes, durationMinutes, isVip } = req.body;
  if (!guestName || !String(guestName).trim()) return void res.status(400).json({ error: "Guest name is required" });
  const ps = Number(partySize) || 1;
  if (ps < 1) return void res.status(400).json({ error: "Party size must be at least 1" });

  let assignedTableId: number | null = tableId ? Number(tableId) : null;
  if (assignedTableId) {
    const [tbl] = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.id, assignedTableId), eq(floorTablesTable.restaurantId, restaurantId)));
    if (!tbl) return void res.status(400).json({ error: "Table not found" });
    if (tbl.capacity < ps) return void res.status(400).json({ error: `Table ${tbl.tableNumber} only seats ${tbl.capacity}` });
    if (tbl.status === "occupied" || tbl.needsCleaning) return void res.status(409).json({ error: "Table is not available" });
  }

  const now = new Date();
  const [reservation] = await db.insert(reservationsTable).values({
    restaurantId,
    guestName: String(guestName).trim(),
    guestPhone: guestPhone ?? null,
    partySize: ps,
    tableId: assignedTableId,
    scheduledAt: now,
    walkInArrivedAt: now,
    durationMinutes: Number(durationMinutes) || 90,
    status: assignedTableId ? "seated" : "pending",
    sourceChannel: "walkin",
    isVip: !!isVip,
    notes: notes ?? null,
  }).returning();

  if (assignedTableId) {
    await db.update(floorTablesTable).set({ status: "occupied", updatedAt: new Date() }).where(eq(floorTablesTable.id, assignedTableId));
  }
  res.status(201).json(reservation);
});

/* ---------- Floor table cleaning ---------- */
router.post("/restaurants/:restaurantId/tables/:tableId/mark-clean", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const tableId = Number(req.params.tableId);
  const [updated] = await db.update(floorTablesTable).set({
    needsCleaning: false,
    lastCleanedAt: new Date(),
    status: "free",
    updatedAt: new Date(),
  }).where(and(eq(floorTablesTable.id, tableId), eq(floorTablesTable.restaurantId, restaurantId))).returning();
  if (!updated) return void res.status(404).json({ error: "Table not found" });
  res.json(updated);
});

router.post("/restaurants/:restaurantId/tables/:tableId/mark-dirty", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const tableId = Number(req.params.tableId);
  const [updated] = await db.update(floorTablesTable).set({
    needsCleaning: true,
    updatedAt: new Date(),
  }).where(and(eq(floorTablesTable.id, tableId), eq(floorTablesTable.restaurantId, restaurantId))).returning();
  if (!updated) return void res.status(404).json({ error: "Table not found" });
  res.json(updated);
});

/* ---------- Waitlist ---------- */
router.get("/restaurants/:restaurantId/waitlist", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const status = req.query.status ? String(req.query.status) : null;
  const conds = [eq(waitlistEntriesTable.restaurantId, restaurantId)];
  if (status) {
    if (!WAITLIST_STATUSES.includes(status as typeof WAITLIST_STATUSES[number])) {
      return void res.status(400).json({ error: "Invalid waitlist status" });
    }
    conds.push(eq(waitlistEntriesTable.status, status));
  } else {
    conds.push(inArray(waitlistEntriesTable.status, ["waiting", "notified"]));
  }
  const rows = await db.select().from(waitlistEntriesTable).where(and(...conds)).orderBy(asc(waitlistEntriesTable.quotedAt));
  res.json(rows);
});

router.post("/restaurants/:restaurantId/waitlist", requireRole("owner", "manager", "waiter", "super_admin"), requirePlanFeature("reservations"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { guestName, guestPhone, partySize, estimatedWaitMinutes, notes, occasion, isVip, sourceChannel, customerId } = req.body;
  if (!guestName || !String(guestName).trim()) return void res.status(400).json({ error: "Guest name is required" });
  const ps = Number(partySize) || 1;
  if (ps < 1) return void res.status(400).json({ error: "Party size must be at least 1" });
  if (occasion !== undefined && occasion !== null && !OCCASIONS.includes(occasion)) {
    return void res.status(400).json({ error: "Invalid occasion" });
  }
  const [entry] = await db.insert(waitlistEntriesTable).values({
    restaurantId,
    customerId: customerId ?? null,
    guestName: String(guestName).trim(),
    guestPhone: guestPhone ?? null,
    partySize: ps,
    estimatedWaitMinutes: estimatedWaitMinutes != null ? Number(estimatedWaitMinutes) : null,
    notes: notes ?? null,
    occasion: occasion ?? null,
    isVip: !!isVip,
    sourceChannel: sourceChannel ?? "staff",
    status: "waiting",
  }).returning();
  res.status(201).json(entry);

  pushToStaff(
    { restaurantId, roles: ["owner", "manager", "waiter"], type: "reservation" },
    {
      title: "Waitlist: new guest",
      body: `${entry.guestName} • party of ${entry.partySize}${entry.estimatedWaitMinutes ? ` • ~${entry.estimatedWaitMinutes}m wait` : ""}`,
      data: { screen: "reservations", waitlistId: entry.id },
    },
  ).catch(() => {});
});

router.patch("/restaurants/:restaurantId/waitlist/:id", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const { guestName, guestPhone, partySize, estimatedWaitMinutes, notes, occasion, isVip, status, seatedTableId } = req.body;
  if (status !== undefined && !WAITLIST_STATUSES.includes(status)) return void res.status(400).json({ error: "Invalid status" });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (guestName !== undefined) updates.guestName = guestName;
  if (guestPhone !== undefined) updates.guestPhone = guestPhone;
  if (partySize !== undefined) updates.partySize = Number(partySize) || 1;
  if (estimatedWaitMinutes !== undefined) updates.estimatedWaitMinutes = estimatedWaitMinutes == null ? null : Number(estimatedWaitMinutes);
  if (notes !== undefined) updates.notes = notes;
  if (occasion !== undefined) updates.occasion = occasion;
  if (isVip !== undefined) updates.isVip = !!isVip;
  if (status !== undefined) {
    updates.status = status;
    if (status === "notified") updates.notifiedAt = new Date();
    if (status === "seated") updates.seatedAt = new Date();
  }
  if (seatedTableId !== undefined) updates.seatedTableId = seatedTableId;

  const [updated] = await db.update(waitlistEntriesTable).set(updates)
    .where(and(eq(waitlistEntriesTable.id, id), eq(waitlistEntriesTable.restaurantId, restaurantId)))
    .returning();
  if (!updated) return void res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.post("/restaurants/:restaurantId/waitlist/:id/seat", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const tableId = req.body.tableId ? Number(req.body.tableId) : null;
  const [entry] = await db.select().from(waitlistEntriesTable).where(and(
    eq(waitlistEntriesTable.id, id),
    eq(waitlistEntriesTable.restaurantId, restaurantId),
  ));
  if (!entry) return void res.status(404).json({ error: "Not found" });
  if (tableId) {
    const [tbl] = await db.select().from(floorTablesTable).where(and(eq(floorTablesTable.id, tableId), eq(floorTablesTable.restaurantId, restaurantId)));
    if (!tbl) return void res.status(400).json({ error: "Table not found" });
    if (tbl.capacity < entry.partySize) return void res.status(400).json({ error: `Table ${tbl.tableNumber} only seats ${tbl.capacity}` });
    if (tbl.status === "occupied" || tbl.needsCleaning) return void res.status(409).json({ error: "Table is not available" });
  }
  const now = new Date();
  const [reservation] = await db.insert(reservationsTable).values({
    restaurantId,
    guestName: entry.guestName,
    guestPhone: entry.guestPhone,
    partySize: entry.partySize,
    tableId,
    scheduledAt: now,
    walkInArrivedAt: entry.quotedAt,
    durationMinutes: 90,
    status: tableId ? "seated" : "pending",
    sourceChannel: "walkin",
    isVip: entry.isVip,
    occasion: entry.occasion,
    notes: entry.notes,
    customerId: entry.customerId,
  }).returning();
  if (tableId) {
    await db.update(floorTablesTable).set({ status: "occupied", updatedAt: new Date() }).where(eq(floorTablesTable.id, tableId));
  }
  await db.update(waitlistEntriesTable).set({
    status: "seated", seatedAt: now, seatedTableId: tableId, reservationId: reservation.id, updatedAt: now,
  }).where(eq(waitlistEntriesTable.id, id));
  res.json({ reservation, waitlistId: id });
});

router.delete("/restaurants/:restaurantId/waitlist/:id", requireRole("owner", "manager", "waiter", "super_admin"), async (req, res) => {
  await db.delete(waitlistEntriesTable).where(and(
    eq(waitlistEntriesTable.id, Number(req.params.id)),
    eq(waitlistEntriesTable.restaurantId, Number(req.params.restaurantId)),
  ));
  res.status(204).send();
});

export default router;
