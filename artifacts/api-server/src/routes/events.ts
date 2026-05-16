import { Router } from "express";
import { eq, and, gte, lte, desc, asc, inArray, sql } from "drizzle-orm";
import {
  db,
  eventBookingsTable,
  eventBookingItemsTable,
  eventPaymentScheduleTable,
  eventStaffAssignmentsTable,
  eventVendorRequirementsTable,
  eventChecklistItemsTable,
  eventStatusHistoryTable,
  ordersTable,
  paymentsTable,
  EVENT_BOOKING_TYPES,
  EVENT_BOOKING_STATUSES,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { requirePlanFeature } from "../middleware/planFeature";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";

const router = Router();

const TYPES = new Set<string>(EVENT_BOOKING_TYPES as readonly string[]);
const STATUSES = new Set<string>(EVENT_BOOKING_STATUSES as readonly string[]);

// Allowed status transitions for bookings.
const TRANSITIONS: Record<string, string[]> = {
  quote: ["confirmed", "cancelled"],
  confirmed: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

router.use(
  "/restaurants/:restaurantId/events",
  requireRole("owner", "manager", "waiter", "kitchen", "super_admin"),
  validateRestaurantAccess,
  requirePlanFeature("events_catering"),
);

function toDecimal(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

async function recalcTotals(bookingId: number): Promise<void> {
  const items = await db
    .select({ lineTotal: eventBookingItemsTable.lineTotal })
    .from(eventBookingItemsTable)
    .where(eq(eventBookingItemsTable.bookingId, bookingId));
  const subtotal = items.reduce((s, i) => s + Number(i.lineTotal ?? 0), 0);
  const [b] = await db
    .select({
      taxAmount: eventBookingsTable.taxAmount,
      discountAmount: eventBookingsTable.discountAmount,
    })
    .from(eventBookingsTable)
    .where(eq(eventBookingsTable.id, bookingId));
  if (!b) return;
  const tax = Number(b.taxAmount ?? 0);
  const discount = Number(b.discountAmount ?? 0);
  const total = Math.max(0, subtotal + tax - discount);
  await db
    .update(eventBookingsTable)
    .set({ subtotal: toDecimal(subtotal), totalAmount: toDecimal(total), updatedAt: new Date() })
    .where(eq(eventBookingsTable.id, bookingId));
}

async function loadBookingDetail(restaurantId: number, id: number) {
  const [booking] = await db
    .select()
    .from(eventBookingsTable)
    .where(and(eq(eventBookingsTable.id, id), eq(eventBookingsTable.restaurantId, restaurantId)));
  if (!booking) return null;
  const [items, schedule, staff, vendors, checklist, history] = await Promise.all([
    db.select().from(eventBookingItemsTable).where(eq(eventBookingItemsTable.bookingId, id)).orderBy(asc(eventBookingItemsTable.id)),
    db.select().from(eventPaymentScheduleTable).where(eq(eventPaymentScheduleTable.bookingId, id)).orderBy(asc(eventPaymentScheduleTable.dueDate)),
    db.select().from(eventStaffAssignmentsTable).where(eq(eventStaffAssignmentsTable.bookingId, id)).orderBy(asc(eventStaffAssignmentsTable.id)),
    db.select().from(eventVendorRequirementsTable).where(eq(eventVendorRequirementsTable.bookingId, id)).orderBy(asc(eventVendorRequirementsTable.id)),
    db.select().from(eventChecklistItemsTable).where(eq(eventChecklistItemsTable.bookingId, id)).orderBy(asc(eventChecklistItemsTable.position), asc(eventChecklistItemsTable.id)),
    db.select().from(eventStatusHistoryTable).where(eq(eventStatusHistoryTable.bookingId, id)).orderBy(desc(eventStatusHistoryTable.createdAt)),
  ]);
  const advancePaid = schedule
    .filter((s) => s.status === "paid")
    .reduce((sum, s) => sum + Number(s.amount), 0);
  return { booking, items, schedule, staff, vendors, checklist, history, advancePaid: toDecimal(advancePaid) };
}

// ─────────────────────────── List + calendar ───────────────────────────

router.get("/restaurants/:restaurantId/events", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { status, type, from, to } = req.query;
  const conds: Parameters<typeof and>[number][] = [eq(eventBookingsTable.restaurantId, restaurantId)];
  if (status && STATUSES.has(String(status))) conds.push(eq(eventBookingsTable.status, String(status)));
  if (type && TYPES.has(String(type))) conds.push(eq(eventBookingsTable.type, String(type)));
  if (from) conds.push(gte(eventBookingsTable.eventDate, new Date(String(from))));
  if (to) conds.push(lte(eventBookingsTable.eventDate, new Date(String(to))));
  const rows = await db
    .select()
    .from(eventBookingsTable)
    .where(and(...conds))
    .orderBy(desc(eventBookingsTable.eventDate))
    .limit(500);
  res.json(rows);
});

router.get("/restaurants/:restaurantId/events/calendar", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { from, to } = req.query;
  if (!from || !to) {
    return void res.status(400).json({ error: "from and to query params required (ISO dates)" });
  }
  const rows = await db
    .select({
      id: eventBookingsTable.id,
      bookingNumber: eventBookingsTable.bookingNumber,
      title: eventBookingsTable.title,
      type: eventBookingsTable.type,
      status: eventBookingsTable.status,
      eventDate: eventBookingsTable.eventDate,
      durationMinutes: eventBookingsTable.durationMinutes,
      guestCount: eventBookingsTable.guestCount,
      venue: eventBookingsTable.venue,
      customerName: eventBookingsTable.customerName,
      totalAmount: eventBookingsTable.totalAmount,
    })
    .from(eventBookingsTable)
    .where(
      and(
        eq(eventBookingsTable.restaurantId, restaurantId),
        gte(eventBookingsTable.eventDate, new Date(String(from))),
        lte(eventBookingsTable.eventDate, new Date(String(to))),
      ),
    )
    .orderBy(asc(eventBookingsTable.eventDate));
  res.json(rows);
});

// ─────────────────────────── Detail / CRUD ───────────────────────────

router.get("/restaurants/:restaurantId/events/:id", async (req, res) => {
  const detail = await loadBookingDetail(Number(req.params.restaurantId), Number(req.params.id));
  if (!detail) return void res.status(404).json({ error: "Booking not found" });
  res.json(detail);
});

router.post(
  "/restaurants/:restaurantId/events",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const {
      type,
      title,
      customerId,
      customerName,
      customerPhone,
      customerEmail,
      eventDate,
      durationMinutes,
      venue,
      guestCount,
      packageDetails,
      notes,
      taxAmount,
      discountAmount,
    } = req.body ?? {};

    if (!title || typeof title !== "string") return void res.status(400).json({ error: "title is required" });
    if (!customerName || typeof customerName !== "string") return void res.status(400).json({ error: "customerName is required" });
    if (!eventDate) return void res.status(400).json({ error: "eventDate is required" });
    const dt = new Date(eventDate);
    if (Number.isNaN(dt.getTime())) return void res.status(400).json({ error: "Invalid eventDate" });
    const safeType = TYPES.has(String(type)) ? String(type) : "event";

    const bookingNumber = `EVT-${Date.now().toString(36).toUpperCase()}`;
    const [created] = await db
      .insert(eventBookingsTable)
      .values({
        restaurantId,
        bookingNumber,
        type: safeType,
        title: title.trim(),
        customerId: customerId ?? null,
        customerName: customerName.trim(),
        customerPhone: customerPhone ?? null,
        customerEmail: customerEmail ?? null,
        eventDate: dt,
        durationMinutes: Number(durationMinutes) || 180,
        venue: venue ?? null,
        guestCount: Number(guestCount) || 0,
        packageDetails: packageDetails ?? null,
        notes: notes ?? null,
        status: "quote",
        taxAmount: toDecimal(Number(taxAmount) || 0),
        discountAmount: toDecimal(Number(discountAmount) || 0),
        createdBy: req.user?.sub ?? null,
      })
      .returning();

    await db.insert(eventStatusHistoryTable).values({
      bookingId: created.id,
      fromStatus: null,
      toStatus: "quote",
      changedBy: req.user?.sub ?? null,
      note: "Booking created",
    });

    res.status(201).json(created);
  },
);

router.patch(
  "/restaurants/:restaurantId/events/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(eventBookingsTable)
      .where(and(eq(eventBookingsTable.id, id), eq(eventBookingsTable.restaurantId, restaurantId)));
    if (!existing) return void res.status(404).json({ error: "Booking not found" });
    if (existing.status === "completed" || existing.status === "cancelled") {
      return void res.status(409).json({ error: `Cannot edit a ${existing.status} booking` });
    }

    const allowed = [
      "title",
      "type",
      "customerId",
      "customerName",
      "customerPhone",
      "customerEmail",
      "venue",
      "guestCount",
      "packageDetails",
      "notes",
      "durationMinutes",
    ] as const;
    const updates: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in req.body) updates[k] = req.body[k];
    }
    if (req.body.eventDate) {
      const dt = new Date(req.body.eventDate);
      if (Number.isNaN(dt.getTime())) return void res.status(400).json({ error: "Invalid eventDate" });
      updates.eventDate = dt;
    }
    if (req.body.type !== undefined && !TYPES.has(String(req.body.type))) {
      return void res.status(400).json({ error: "Invalid type" });
    }
    if (req.body.taxAmount !== undefined) updates.taxAmount = toDecimal(Number(req.body.taxAmount) || 0);
    if (req.body.discountAmount !== undefined) updates.discountAmount = toDecimal(Number(req.body.discountAmount) || 0);
    updates.updatedAt = new Date();

    const [updated] = await db
      .update(eventBookingsTable)
      .set(updates)
      .where(and(eq(eventBookingsTable.id, id), eq(eventBookingsTable.restaurantId, restaurantId)))
      .returning();
    await recalcTotals(id);
    const [final] = await db.select().from(eventBookingsTable).where(eq(eventBookingsTable.id, id));
    res.json(final ?? updated);
  },
);

router.delete(
  "/restaurants/:restaurantId/events/:id",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const [existing] = await db
      .select({ status: eventBookingsTable.status })
      .from(eventBookingsTable)
      .where(and(eq(eventBookingsTable.id, id), eq(eventBookingsTable.restaurantId, restaurantId)));
    if (!existing) return void res.status(404).json({ error: "Not found" });
    if (existing.status !== "quote" && existing.status !== "cancelled") {
      return void res.status(409).json({ error: "Only quote or cancelled bookings can be deleted" });
    }
    await db.delete(eventBookingsTable).where(eq(eventBookingsTable.id, id));
    res.status(204).send();
  },
);

// ─────────────────────────── Status transition ───────────────────────────

router.post(
  "/restaurants/:restaurantId/events/:id/status",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const { status, note } = req.body ?? {};
    if (!STATUSES.has(String(status))) return void res.status(400).json({ error: "Invalid status" });
    const [existing] = await db
      .select()
      .from(eventBookingsTable)
      .where(and(eq(eventBookingsTable.id, id), eq(eventBookingsTable.restaurantId, restaurantId)));
    if (!existing) return void res.status(404).json({ error: "Not found" });
    if (existing.status === status) return void res.json(existing);
    const allowed = TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(status)) {
      return void res.status(409).json({ error: `Cannot transition ${existing.status} → ${status}` });
    }

    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "confirmed" && !existing.invoicedAt) {
      updates.invoicedAt = new Date();
    }

    const [updated] = await db.update(eventBookingsTable).set(updates).where(eq(eventBookingsTable.id, id)).returning();
    await db.insert(eventStatusHistoryTable).values({
      bookingId: id,
      fromStatus: existing.status,
      toStatus: status,
      changedBy: req.user?.sub ?? null,
      note: note ?? null,
    });
    res.json(updated);
  },
);

// ─────────────────────────── Convert quote → invoice (orders row) ───────────────────────────

router.post(
  "/restaurants/:restaurantId/events/:id/convert-to-invoice",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(eventBookingsTable)
      .where(and(eq(eventBookingsTable.id, id), eq(eventBookingsTable.restaurantId, restaurantId)));
    if (!existing) return void res.status(404).json({ error: "Not found" });
    if (existing.invoiceOrderId) {
      return void res.status(409).json({ error: "Already converted to invoice", invoiceOrderId: existing.invoiceOrderId });
    }
    if (existing.status === "cancelled") {
      return void res.status(409).json({ error: "Cannot invoice a cancelled booking" });
    }

    await recalcTotals(id);
    const [refreshed] = await db.select().from(eventBookingsTable).where(eq(eventBookingsTable.id, id));
    if (!refreshed) return void res.status(404).json({ error: "Not found" });

    const orderNumber = `EVT-INV-${refreshed.bookingNumber}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
    const [order] = await db
      .insert(ordersTable)
      .values({
        restaurantId,
        orderNumber,
        orderType: "event",
        status: "pending",
        paymentStatus: "unpaid",
        subtotal: refreshed.subtotal,
        taxAmount: refreshed.taxAmount,
        discountAmount: refreshed.discountAmount,
        totalAmount: refreshed.totalAmount,
        customerName: refreshed.customerName,
        customerPhone: refreshed.customerPhone ?? null,
        customerId: refreshed.customerId ?? null,
        notes: `Auto-generated from event booking ${refreshed.bookingNumber} — ${refreshed.title}`,
        waiterId: req.user?.sub ?? null,
      })
      .returning();

    const nextStatus = refreshed.status === "quote" ? "confirmed" : refreshed.status;
    const [updated] = await db
      .update(eventBookingsTable)
      .set({
        invoiceOrderId: order.id,
        invoicedAt: refreshed.invoicedAt ?? new Date(),
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(eq(eventBookingsTable.id, id))
      .returning();

    if (refreshed.status === "quote") {
      await db.insert(eventStatusHistoryTable).values({
        bookingId: id,
        fromStatus: "quote",
        toStatus: "confirmed",
        changedBy: req.user?.sub ?? null,
        note: `Converted to invoice ${orderNumber}`,
      });
    }

    res.json({ booking: updated, invoiceOrderId: order.id, orderNumber });
  },
);

// ─────────────────────────── Items (packages / add-ons) ───────────────────────────

router.post(
  "/restaurants/:restaurantId/events/:id/items",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const [booking] = await db
      .select({ id: eventBookingsTable.id, status: eventBookingsTable.status })
      .from(eventBookingsTable)
      .where(and(eq(eventBookingsTable.id, id), eq(eventBookingsTable.restaurantId, restaurantId)));
    if (!booking) return void res.status(404).json({ error: "Booking not found" });
    if (booking.status === "completed" || booking.status === "cancelled") {
      return void res.status(409).json({ error: "Cannot edit items on a closed booking" });
    }
    const { kind, name, description, quantity, unitPrice } = req.body ?? {};
    if (!name) return void res.status(400).json({ error: "name is required" });
    const qty = Number(quantity) || 1;
    const price = Number(unitPrice) || 0;
    const lineTotal = qty * price;
    const safeKind = ["package", "addon", "service"].includes(String(kind)) ? String(kind) : "package";
    const [item] = await db
      .insert(eventBookingItemsTable)
      .values({
        bookingId: id,
        kind: safeKind,
        name: String(name).trim(),
        description: description ?? null,
        quantity: qty,
        unitPrice: toDecimal(price),
        lineTotal: toDecimal(lineTotal),
      })
      .returning();
    await recalcTotals(id);
    res.status(201).json(item);
  },
);

router.patch(
  "/restaurants/:restaurantId/events/:id/items/:itemId",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const id = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const [existing] = await db.select().from(eventBookingItemsTable).where(and(eq(eventBookingItemsTable.id, itemId), eq(eventBookingItemsTable.bookingId, id)));
    if (!existing) return void res.status(404).json({ error: "Item not found" });
    const updates: Record<string, unknown> = {};
    if (req.body.name !== undefined) updates.name = String(req.body.name);
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.kind !== undefined && ["package", "addon", "service"].includes(String(req.body.kind))) updates.kind = String(req.body.kind);
    const qty = req.body.quantity !== undefined ? Number(req.body.quantity) || 1 : existing.quantity;
    const price = req.body.unitPrice !== undefined ? Number(req.body.unitPrice) || 0 : Number(existing.unitPrice);
    if (req.body.quantity !== undefined) updates.quantity = qty;
    if (req.body.unitPrice !== undefined) updates.unitPrice = toDecimal(price);
    if (req.body.quantity !== undefined || req.body.unitPrice !== undefined) updates.lineTotal = toDecimal(qty * price);
    const [updated] = await db.update(eventBookingItemsTable).set(updates).where(eq(eventBookingItemsTable.id, itemId)).returning();
    await recalcTotals(id);
    res.json(updated);
  },
);

router.delete(
  "/restaurants/:restaurantId/events/:id/items/:itemId",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const id = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    await db.delete(eventBookingItemsTable).where(and(eq(eventBookingItemsTable.id, itemId), eq(eventBookingItemsTable.bookingId, id)));
    await recalcTotals(id);
    res.status(204).send();
  },
);

// ─────────────────────────── Payment schedule ───────────────────────────

router.post(
  "/restaurants/:restaurantId/events/:id/payments",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const id = Number(req.params.id);
    const { label, dueDate, amount } = req.body ?? {};
    if (!dueDate) return void res.status(400).json({ error: "dueDate required" });
    const dt = new Date(dueDate);
    if (Number.isNaN(dt.getTime())) return void res.status(400).json({ error: "Invalid dueDate" });
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return void res.status(400).json({ error: "amount must be > 0" });
    const [row] = await db
      .insert(eventPaymentScheduleTable)
      .values({
        bookingId: id,
        label: label ? String(label) : "Milestone",
        dueDate: dt,
        amount: toDecimal(amt),
        status: "pending",
      })
      .returning();
    res.status(201).json(row);
  },
);

router.patch(
  "/restaurants/:restaurantId/events/:id/payments/:pid",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const id = Number(req.params.id);
    const pid = Number(req.params.pid);
    const [milestone] = await db
      .select()
      .from(eventPaymentScheduleTable)
      .where(and(eq(eventPaymentScheduleTable.id, pid), eq(eventPaymentScheduleTable.bookingId, id)));
    if (!milestone) return void res.status(404).json({ error: "Milestone not found" });

    const updates: Record<string, unknown> = {};
    if (req.body.label !== undefined) updates.label = String(req.body.label);
    if (req.body.dueDate !== undefined) {
      const dt = new Date(req.body.dueDate);
      if (Number.isNaN(dt.getTime())) return void res.status(400).json({ error: "Invalid dueDate" });
      updates.dueDate = dt;
    }
    if (req.body.amount !== undefined) {
      const amt = Number(req.body.amount);
      if (!Number.isFinite(amt) || amt <= 0) return void res.status(400).json({ error: "amount must be > 0" });
      updates.amount = toDecimal(amt);
    }

    if (req.body.markPaid === true && milestone.status !== "paid") {
      const method = ["cash", "card", "upi", "bank", "other"].includes(String(req.body.method))
        ? String(req.body.method)
        : "cash";
      const [payment] = await db
        .insert(paymentsTable)
        .values({
          restaurantId,
          direction: "in",
          method,
          amount: milestone.amount,
          paymentDate: new Date(),
          partyType: "customer",
          partyName: req.body.partyName ?? null,
          referenceType: "event_booking",
          referenceId: id,
          notes: `Event milestone: ${milestone.label}`,
          recordedBy: req.user?.sub ?? null,
        })
        .returning();
      updates.status = "paid";
      updates.paidAt = new Date();
      updates.paymentId = payment.id;
    } else if (req.body.status && ["pending", "paid", "overdue"].includes(String(req.body.status))) {
      updates.status = String(req.body.status);
      if (req.body.status === "paid" && !milestone.paidAt) updates.paidAt = new Date();
    }

    const [updated] = await db
      .update(eventPaymentScheduleTable)
      .set(updates)
      .where(eq(eventPaymentScheduleTable.id, pid))
      .returning();
    res.json(updated);
  },
);

router.delete(
  "/restaurants/:restaurantId/events/:id/payments/:pid",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const id = Number(req.params.id);
    const pid = Number(req.params.pid);
    await db.delete(eventPaymentScheduleTable).where(and(eq(eventPaymentScheduleTable.id, pid), eq(eventPaymentScheduleTable.bookingId, id)));
    res.status(204).send();
  },
);

// ─────────────────────────── Staff assignments ───────────────────────────

router.post(
  "/restaurants/:restaurantId/events/:id/staff",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const id = Number(req.params.id);
    const { staffId, staffName, role, notes } = req.body ?? {};
    if (!staffName) return void res.status(400).json({ error: "staffName required" });
    const [row] = await db
      .insert(eventStaffAssignmentsTable)
      .values({
        bookingId: id,
        staffId: staffId ?? null,
        staffName: String(staffName).trim(),
        role: role ? String(role) : "server",
        notes: notes ?? null,
      })
      .returning();
    res.status(201).json(row);
  },
);

router.delete(
  "/restaurants/:restaurantId/events/:id/staff/:aid",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const id = Number(req.params.id);
    const aid = Number(req.params.aid);
    await db.delete(eventStaffAssignmentsTable).where(and(eq(eventStaffAssignmentsTable.id, aid), eq(eventStaffAssignmentsTable.bookingId, id)));
    res.status(204).send();
  },
);

// ─────────────────────────── Vendor requirements ───────────────────────────

router.post(
  "/restaurants/:restaurantId/events/:id/vendors",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const id = Number(req.params.id);
    const { category, vendorName, contactInfo, cost, notes, status } = req.body ?? {};
    if (!vendorName) return void res.status(400).json({ error: "vendorName required" });
    const [row] = await db
      .insert(eventVendorRequirementsTable)
      .values({
        bookingId: id,
        category: category ? String(category) : "other",
        vendorName: String(vendorName).trim(),
        contactInfo: contactInfo ?? null,
        cost: toDecimal(Number(cost) || 0),
        notes: notes ?? null,
        status: ["pending", "confirmed", "cancelled"].includes(String(status)) ? String(status) : "pending",
      })
      .returning();
    res.status(201).json(row);
  },
);

router.patch(
  "/restaurants/:restaurantId/events/:id/vendors/:vid",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const id = Number(req.params.id);
    const vid = Number(req.params.vid);
    const updates: Record<string, unknown> = {};
    for (const k of ["category", "vendorName", "contactInfo", "notes"] as const) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (req.body.cost !== undefined) updates.cost = toDecimal(Number(req.body.cost) || 0);
    if (req.body.status && ["pending", "confirmed", "cancelled"].includes(String(req.body.status))) {
      updates.status = String(req.body.status);
    }
    const [updated] = await db
      .update(eventVendorRequirementsTable)
      .set(updates)
      .where(and(eq(eventVendorRequirementsTable.id, vid), eq(eventVendorRequirementsTable.bookingId, id)))
      .returning();
    if (!updated) return void res.status(404).json({ error: "Not found" });
    res.json(updated);
  },
);

router.delete(
  "/restaurants/:restaurantId/events/:id/vendors/:vid",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const id = Number(req.params.id);
    const vid = Number(req.params.vid);
    await db.delete(eventVendorRequirementsTable).where(and(eq(eventVendorRequirementsTable.id, vid), eq(eventVendorRequirementsTable.bookingId, id)));
    res.status(204).send();
  },
);

// ─────────────────────────── Checklist ───────────────────────────
// Waiters (incl. kitchen) may toggle checklist items; only owner/manager can add/delete.

router.post(
  "/restaurants/:restaurantId/events/:id/checklist",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const id = Number(req.params.id);
    const { label, notes, position } = req.body ?? {};
    if (!label) return void res.status(400).json({ error: "label required" });
    const [row] = await db
      .insert(eventChecklistItemsTable)
      .values({
        bookingId: id,
        label: String(label).trim(),
        notes: notes ?? null,
        position: Number(position) || 0,
      })
      .returning();
    res.status(201).json(row);
  },
);

router.patch("/restaurants/:restaurantId/events/:id/checklist/:cid", async (req, res) => {
  const id = Number(req.params.id);
  const cid = Number(req.params.cid);
  const [item] = await db
    .select()
    .from(eventChecklistItemsTable)
    .where(and(eq(eventChecklistItemsTable.id, cid), eq(eventChecklistItemsTable.bookingId, id)));
  if (!item) return void res.status(404).json({ error: "Not found" });

  const role = req.user?.role;
  const isStaffOnlyToggle = role === "waiter" || role === "kitchen";
  const updates: Record<string, unknown> = {};
  if (req.body.completed !== undefined) {
    if (req.body.completed) {
      updates.completedAt = new Date();
      updates.completedBy = req.user?.sub ?? null;
    } else {
      updates.completedAt = null;
      updates.completedBy = null;
    }
  }
  if (!isStaffOnlyToggle) {
    if (req.body.label !== undefined) updates.label = String(req.body.label);
    if (req.body.notes !== undefined) updates.notes = req.body.notes;
    if (req.body.position !== undefined) updates.position = Number(req.body.position) || 0;
  }
  const [updated] = await db.update(eventChecklistItemsTable).set(updates).where(eq(eventChecklistItemsTable.id, cid)).returning();
  res.json(updated);
});

router.delete(
  "/restaurants/:restaurantId/events/:id/checklist/:cid",
  requireRole("owner", "manager", "super_admin"),
  async (req, res) => {
    const id = Number(req.params.id);
    const cid = Number(req.params.cid);
    await db.delete(eventChecklistItemsTable).where(and(eq(eventChecklistItemsTable.id, cid), eq(eventChecklistItemsTable.bookingId, id)));
    res.status(204).send();
  },
);

// ─────────────────────────── Quotation data (for PDF) ───────────────────────────

router.get("/restaurants/:restaurantId/events/:id/quotation", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const detail = await loadBookingDetail(restaurantId, id);
  if (!detail) return void res.status(404).json({ error: "Not found" });
  const { restaurantsTable } = await import("../lib/db");
  const [restaurant] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId));
  res.json({ restaurant, ...detail });
});

export default router;
