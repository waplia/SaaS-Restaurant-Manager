import { Router } from "express";
import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";
import {
  db, paymentsTable, ordersTable, purchaseOrdersTable, customersTable,
  suppliersTable, usersTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { lockOpenCashRegister, recordCashSaleMovement } from "./cash-register";
import { validate } from "../middleware/validate";
import { z } from "zod";

const router = Router();

/** Task #587 — Map a free-text payment method ("cash", "card", "razorpay", …)
 *  into the new payments.payment_category / payment_source / gateway_code
 *  triple. Used by every manual-entry / settle code path so historical
 *  reports can filter on the new columns. Conservative: anything we don't
 *  recognise gets `null` rather than guessing wrong. */
function inferPaymentCategory(method: string): {
  category: "offline" | "online" | null;
  source: "platform_gateway" | "own_gateway" | "manual_upi" | null;
  gatewayCode: string | null;
} {
  const m = method.toLowerCase();
  if (m === "cash" || m === "bank" || m === "room_charge" || m === "package_comp") {
    return { category: "offline", source: null, gatewayCode: null };
  }
  if (m === "card" || m === "upi") {
    // Counter-tendered card or UPI is offline; gateway-routed card/UPI flows
    // arrive through stripe/razorpay/phonepe/cashfree below, not as bare "card"/"upi".
    return { category: "offline", source: null, gatewayCode: null };
  }
  if (m === "stripe" || m === "razorpay" || m === "cashfree" || m === "phonepe" || m === "payu") {
    return { category: "online", source: "platform_gateway", gatewayCode: m };
  }
  if (m === "manual_upi") {
    return { category: "online", source: "manual_upi", gatewayCode: null };
  }
  return { category: null, source: null, gatewayCode: null };
}

const PaymentMethods = z.enum(["cash", "card", "upi", "stripe", "razorpay", "bank", "room_charge", "package_comp", "other"]);
const SettleMethods = z.enum(["cash", "card", "upi", "stripe", "razorpay", "bank", "other"]);

const RecordPaymentBody = z.object({
  direction: z.enum(["in", "out"]),
  method: PaymentMethods,
  amount: z.union([z.number(), z.string()]).refine((v) => Number(v) > 0, "amount must be a positive number"),
  partyType: z.enum(["customer", "supplier", "other"]).optional(),
  partyId: z.coerce.number().int().positive().nullable().optional(),
  partyName: z.string().max(256).nullable().optional(),
  referenceType: z.enum(["order", "purchase_order", "manual"]).optional(),
  referenceId: z.coerce.number().int().positive().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  paymentDate: z.string().optional(),
});

const SettlePaymentBody = z.object({
  referenceType: z.enum(["order", "purchase_order"]),
  referenceId: z.coerce.number().int().positive(),
  amount: z.union([z.number(), z.string()]).refine((v) => Number(v) > 0, "amount must be a positive number"),
  method: SettleMethods,
  notes: z.string().max(2000).optional(),
});

router.use(
  "/restaurants/:restaurantId/payments",
  requireRole(
    "owner", "manager", "waiter", "cashier", "accountant", "auditor",
    "captain", "food_court_owner", "food_court_cashier",
    "canteen_admin", "counter_staff", "super_admin",
  ),
  validateRestaurantAccess,
);
router.use(
  "/restaurants/:restaurantId/due-payments",
  requireRole("owner", "manager", "accountant", "super_admin"),
  validateRestaurantAccess,
);

type PaymentRow = {
  id: number;
  restaurantId: number;
  direction: string;
  method: string;
  amount: string;
  paymentDate: Date;
  partyType: string;
  partyId: number | null;
  partyName: string | null;
  referenceType: string;
  referenceId: number | null;
  notes: string | null;
  recordedBy: number | null;
  createdAt: Date;
};

async function enrichPayments(restaurantId: number, rows: PaymentRow[]) {
  const customerIds = new Set<number>();
  const supplierIds = new Set<number>();
  const userIds = new Set<number>();
  const orderIds = new Set<number>();
  const poIds = new Set<number>();

  for (const r of rows) {
    if (r.partyType === "customer" && r.partyId) customerIds.add(r.partyId);
    if (r.partyType === "supplier" && r.partyId) supplierIds.add(r.partyId);
    if (r.recordedBy) userIds.add(r.recordedBy);
    if (r.referenceType === "order" && r.referenceId) orderIds.add(r.referenceId);
    if (r.referenceType === "purchase_order" && r.referenceId) poIds.add(r.referenceId);
  }

  const [customers, suppliers, users, orders, pos] = await Promise.all([
    customerIds.size
      ? db.select({ id: customersTable.id, name: customersTable.name })
          .from(customersTable)
          .where(and(inArray(customersTable.id, [...customerIds]), eq(customersTable.restaurantId, restaurantId)))
      : Promise.resolve([]),
    supplierIds.size
      ? db.select({ id: suppliersTable.id, name: suppliersTable.name })
          .from(suppliersTable)
          .where(and(inArray(suppliersTable.id, [...supplierIds]), eq(suppliersTable.restaurantId, restaurantId)))
      : Promise.resolve([]),
    userIds.size
      ? db.select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable)
          .where(and(inArray(usersTable.id, [...userIds]), eq(usersTable.restaurantId, restaurantId)))
      : Promise.resolve([]),
    orderIds.size
      ? db.select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber })
          .from(ordersTable)
          .where(and(inArray(ordersTable.id, [...orderIds]), eq(ordersTable.restaurantId, restaurantId)))
      : Promise.resolve([]),
    poIds.size
      ? db.select({ id: purchaseOrdersTable.id })
          .from(purchaseOrdersTable)
          .where(and(inArray(purchaseOrdersTable.id, [...poIds]), eq(purchaseOrdersTable.restaurantId, restaurantId)))
      : Promise.resolve([]),
  ]);

  const customerMap = new Map(customers.map(c => [c.id, c.name]));
  const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));
  const userMap = new Map(users.map(u => [u.id, u.name]));
  const orderMap = new Map(orders.map(o => [o.id, o.orderNumber]));
  const poSet = new Set(pos.map(p => p.id));

  return rows.map(r => {
    let partyName = r.partyName;
    if (!partyName) {
      if (r.partyType === "customer" && r.partyId) partyName = customerMap.get(r.partyId) ?? null;
      else if (r.partyType === "supplier" && r.partyId) partyName = supplierMap.get(r.partyId) ?? null;
      else if (r.partyType === "other") partyName = "Walk-in";
    }
    let reference: string | null = null;
    if (r.referenceType === "order" && r.referenceId) {
      reference = orderMap.get(r.referenceId) ? `Order ${orderMap.get(r.referenceId)}` : `Order #${r.referenceId}`;
    } else if (r.referenceType === "purchase_order" && r.referenceId) {
      reference = poSet.has(r.referenceId) ? `PO #${r.referenceId}` : `PO #${r.referenceId}`;
    } else if (r.notes) {
      reference = r.notes;
    }
    return {
      ...r,
      partyName: partyName ?? "—",
      reference,
      recordedByName: r.recordedBy ? userMap.get(r.recordedBy) ?? null : null,
    };
  });
}

router.get("/restaurants/:restaurantId/payments", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { from, to, method, direction, partyType, page = "1", pageSize = "50" } = req.query;

  const conditions = [eq(paymentsTable.restaurantId, restaurantId)];
  if (from) conditions.push(gte(paymentsTable.paymentDate, new Date(String(from))));
  if (to) {
    const toDate = new Date(String(to));
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(paymentsTable.paymentDate, toDate));
  }
  if (method) conditions.push(eq(paymentsTable.method, String(method)));
  if (direction) conditions.push(eq(paymentsTable.direction, String(direction)));
  if (partyType) conditions.push(eq(paymentsTable.partyType, String(partyType)));

  const limit = Math.min(200, Math.max(1, Number(pageSize)));
  const offset = (Math.max(1, Number(page)) - 1) * limit;

  const [rows, totalRows] = await Promise.all([
    db.select().from(paymentsTable).where(and(...conditions))
      .orderBy(desc(paymentsTable.paymentDate), desc(paymentsTable.id))
      .limit(limit).offset(offset),
    db.select({ c: sql<number>`cast(count(*) as int)` })
      .from(paymentsTable).where(and(...conditions)),
  ]);

  const enriched = await enrichPayments(restaurantId, rows);
  res.json({ data: enriched, total: totalRows[0]?.c ?? 0, page: Number(page), pageSize: limit });
});

router.get("/restaurants/:restaurantId/payments/summary", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { from, to } = req.query;

  const conditions = [eq(paymentsTable.restaurantId, restaurantId)];
  if (from) conditions.push(gte(paymentsTable.paymentDate, new Date(String(from))));
  if (to) {
    const toDate = new Date(String(to));
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(paymentsTable.paymentDate, toDate));
  }

  const rows = await db.select({
    direction: paymentsTable.direction,
    method: paymentsTable.method,
    total: sql<string>`cast(coalesce(sum(${paymentsTable.amount}), 0) as text)`,
    count: sql<number>`cast(count(*) as int)`,
  }).from(paymentsTable).where(and(...conditions))
    .groupBy(paymentsTable.direction, paymentsTable.method);

  const summary: Record<string, Record<string, { total: string; count: number }>> = { in: {}, out: {} };
  let totalIn = 0;
  let totalOut = 0;
  for (const r of rows) {
    if (!summary[r.direction]) summary[r.direction] = {};
    summary[r.direction][r.method] = { total: r.total, count: r.count };
    if (r.direction === "in") totalIn += Number(r.total);
    else totalOut += Number(r.total);
  }

  res.json({
    in: summary.in ?? {},
    out: summary.out ?? {},
    totalIn: totalIn.toFixed(2),
    totalOut: totalOut.toFixed(2),
    net: (totalIn - totalOut).toFixed(2),
  });
});

router.post(
  "/restaurants/:restaurantId/payments",
  validate({ body: RecordPaymentBody }),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const role = req.user?.role;
    const isSuper = req.user?.isSuperAdmin;
    const {
      direction, method, amount, partyType, partyId, partyName,
      referenceType, referenceId, notes, paymentDate,
    } = req.body as {
      direction: "in" | "out";
      method: string;
      amount: number | string;
      partyType?: "customer" | "supplier" | "other";
      partyId?: number | null;
      partyName?: string | null;
      referenceType?: "order" | "purchase_order" | "manual";
      referenceId?: number | null;
      notes?: string | null;
      paymentDate?: string;
    };

    const amountNum = Number(amount);

    // Waiters can only record cash incoming payments
    if (!isSuper && role === "waiter") {
      if (direction !== "in" || method !== "cash") {
        return void res.status(403).json({ error: "Waiters can only record incoming cash payments" });
      }
    } else if (!isSuper && role !== "owner" && role !== "manager") {
      return void res.status(403).json({ error: "Insufficient permissions" });
    }

    // Validate party ownership belongs to this restaurant (prevents cross-tenant ID linkage)
    if (partyId) {
      if (partyType === "customer") {
        const [c] = await db.select({ id: customersTable.id }).from(customersTable)
          .where(and(eq(customersTable.id, partyId), eq(customersTable.restaurantId, restaurantId)));
        if (!c) return void res.status(400).json({ error: "Customer does not belong to this restaurant" });
      } else if (partyType === "supplier") {
        const [s] = await db.select({ id: suppliersTable.id }).from(suppliersTable)
          .where(and(eq(suppliersTable.id, partyId), eq(suppliersTable.restaurantId, restaurantId)));
        if (!s) return void res.status(400).json({ error: "Supplier does not belong to this restaurant" });
      } else {
        return void res.status(400).json({ error: "partyId is only valid for customer or supplier party types" });
      }
    }

    const cat = inferPaymentCategory(method);
    // Cash-in payments must also leave a footprint in the open cash register
    // session so the cashier's shift screen ("Cash sales" / "Expected") reflects
    // money that actually entered the drawer. Skip silently when no register is
    // open (e.g. back-office manual reconciliations) rather than failing.
    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(paymentsTable).values({
        restaurantId,
        direction,
        method,
        paymentCategory: cat.category,
        paymentSource: cat.source,
        gatewayCode: cat.gatewayCode,
        amount: amountNum.toFixed(2),
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        partyType: partyType ?? "other",
        partyId: partyId ?? null,
        partyName: partyName ?? null,
        referenceType: referenceType ?? "manual",
        referenceId: referenceId ?? null,
        notes: notes ?? null,
        recordedBy: req.user?.sub ?? null,
      } as never).returning();

      if (direction === "in" && method === "cash" && amountNum > 0) {
        const sessionId = await lockOpenCashRegister(tx, restaurantId);
        if (sessionId) {
          await recordCashSaleMovement(tx, {
            restaurantId,
            sessionId,
            amount: amountNum,
            orderId: referenceType === "order" ? (referenceId ?? undefined) : undefined,
            userId: req.user?.sub ?? null,
          });
        }
      }

      return inserted;
    });

    res.status(201).json(row);
  },
);

router.post(
  "/restaurants/:restaurantId/payments/settle",
  requireRole("owner", "manager", "super_admin"),
  validate({ body: SettlePaymentBody }),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    const { referenceType, referenceId, amount, method, notes } = req.body as {
      referenceType: "order" | "purchase_order";
      referenceId: number;
      amount: number | string;
      method: string;
      notes?: string;
    };

    const amountNum = Number(amount);

    const result = await db.transaction(async tx => {
      if (referenceType === "order") {
        const [order] = await tx.select().from(ordersTable)
          .where(and(eq(ordersTable.id, referenceId), eq(ordersTable.restaurantId, restaurantId)));
        if (!order) throw new Error("ORDER_NOT_FOUND");
        if (order.paymentStatus === "paid") throw new Error("ORDER_ALREADY_PAID");

        // Compute cumulative paid from ledger so partial settlements roll up correctly
        const [paidAgg] = await tx.select({
          total: sql<string>`cast(coalesce(sum(${paymentsTable.amount}), 0) as text)`,
        }).from(paymentsTable).where(and(
          eq(paymentsTable.restaurantId, restaurantId),
          eq(paymentsTable.referenceType, "order"),
          eq(paymentsTable.referenceId, order.id),
          eq(paymentsTable.direction, "in"),
        ));
        const previouslyPaid = Number(paidAgg?.total ?? 0);
        const remainingDue = Math.max(0, Number(order.totalAmount) - previouslyPaid);
        if (amountNum > remainingDue + 0.01) throw new Error("OVERPAYMENT_ORDER");

        const catO = inferPaymentCategory(method);
        const [payment] = await tx.insert(paymentsTable).values({
          restaurantId,
          direction: "in",
          method,
          paymentCategory: catO.category,
          paymentSource: catO.source,
          gatewayCode: catO.gatewayCode,
          amount: amountNum.toFixed(2),
          paymentDate: new Date(),
          partyType: order.customerId ? "customer" : "other",
          partyId: order.customerId ?? null,
          partyName: order.customerName ?? null,
          referenceType: "order",
          referenceId: order.id,
          notes: notes ?? null,
          recordedBy: req.user?.sub ?? null,
        } as never).returning();

        // Cash settlements must also leave a drawer footprint so the shift
        // screen's "Cash sales" and "Expected" totals reflect the money in
        // the till. Silently skip when no register is open (e.g. back-office
        // reconciliation after the fact).
        if (method === "cash" && amountNum > 0) {
          const sid = await lockOpenCashRegister(tx, restaurantId);
          if (sid) {
            await recordCashSaleMovement(tx, {
              restaurantId,
              sessionId: sid,
              amount: amountNum,
              orderId: order.id,
              userId: req.user?.sub ?? null,
            });
          }
        }

        const total = Number(order.totalAmount);
        const cumulativePaid = previouslyPaid + amountNum;
        const fullyPaid = cumulativePaid >= total - 0.01;
        await tx.update(ordersTable).set({
          paymentStatus: fullyPaid ? "paid" : "partial",
          paymentMethod: order.paymentMethod ?? method,
          status: fullyPaid && order.status !== "cancelled" ? "completed" : order.status,
          updatedAt: new Date(),
        }).where(eq(ordersTable.id, order.id));

        return { payment, kind: "order" as const };
      } else {
        const [po] = await tx.select().from(purchaseOrdersTable)
          .where(and(eq(purchaseOrdersTable.id, referenceId), eq(purchaseOrdersTable.restaurantId, restaurantId)));
        if (!po) throw new Error("PO_NOT_FOUND");

        const remainingDue = Math.max(0, Number(po.totalAmount) - Number(po.paidAmount));
        if (amountNum > remainingDue + 0.01) throw new Error("OVERPAYMENT_PO");

        const catP = inferPaymentCategory(method);
        const [payment] = await tx.insert(paymentsTable).values({
          restaurantId,
          direction: "out",
          method,
          paymentCategory: catP.category,
          paymentSource: catP.source,
          gatewayCode: catP.gatewayCode,
          amount: amountNum.toFixed(2),
          paymentDate: new Date(),
          partyType: po.supplierId ? "supplier" : "other",
          partyId: po.supplierId ?? null,
          partyName: null,
          referenceType: "purchase_order",
          referenceId: po.id,
          notes: notes ?? null,
          recordedBy: req.user?.sub ?? null,
        } as never).returning();

        const newPaid = Number(po.paidAmount) + amountNum;
        await tx.update(purchaseOrdersTable).set({
          paidAmount: newPaid.toFixed(2),
          updatedAt: new Date(),
        }).where(eq(purchaseOrdersTable.id, po.id));

        return { payment, kind: "purchase_order" as const };
      }
    }).catch((e: Error) => ({ error: e.message }));

    if ("error" in result) {
      const map: Record<string, [number, string]> = {
        ORDER_NOT_FOUND: [404, "Order not found"],
        ORDER_ALREADY_PAID: [400, "Order is already paid"],
        PO_NOT_FOUND: [404, "Purchase order not found"],
        OVERPAYMENT_ORDER: [400, "Settlement amount exceeds remaining due on order"],
        OVERPAYMENT_PO: [400, "Settlement amount exceeds remaining due on purchase order"],
      };
      const [status, msg] = map[result.error] ?? [500, "Failed to settle payment"];
      return void res.status(status).json({ error: msg });
    }

    res.status(201).json(result.payment);
  },
);

router.get("/restaurants/:restaurantId/due-payments", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);

  const [unpaidOrders, openPOs] = await Promise.all([
    db.select({
      id: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      customerId: ordersTable.customerId,
      customerName: ordersTable.customerName,
      totalAmount: ordersTable.totalAmount,
      paymentStatus: ordersTable.paymentStatus,
      createdAt: ordersTable.createdAt,
    }).from(ordersTable)
      .where(and(
        eq(ordersTable.restaurantId, restaurantId),
        sql`${ordersTable.paymentStatus} IN ('unpaid', 'partial')`,
        eq(ordersTable.status, "completed"),
      ))
      .orderBy(ordersTable.createdAt),
    db.select({
      id: purchaseOrdersTable.id,
      supplierId: purchaseOrdersTable.supplierId,
      status: purchaseOrdersTable.status,
      totalAmount: purchaseOrdersTable.totalAmount,
      paidAmount: purchaseOrdersTable.paidAmount,
      orderedAt: purchaseOrdersTable.orderedAt,
      createdAt: purchaseOrdersTable.createdAt,
      notes: purchaseOrdersTable.notes,
    }).from(purchaseOrdersTable)
      .where(and(
        eq(purchaseOrdersTable.restaurantId, restaurantId),
        sql`${purchaseOrdersTable.status} IN ('pending', 'ordered', 'received')`,
      ))
      .orderBy(purchaseOrdersTable.createdAt),
  ]);

  // Compute order paid amount from payments table
  const orderIds = unpaidOrders.map(o => o.id);
  const paidByOrder = orderIds.length
    ? await db.select({
        orderId: paymentsTable.referenceId,
        paid: sql<string>`cast(coalesce(sum(${paymentsTable.amount}), 0) as text)`,
      }).from(paymentsTable)
      .where(and(
        eq(paymentsTable.restaurantId, restaurantId),
        eq(paymentsTable.referenceType, "order"),
        eq(paymentsTable.direction, "in"),
        inArray(paymentsTable.referenceId, orderIds),
      )).groupBy(paymentsTable.referenceId)
    : [];
  const paidMap = new Map(paidByOrder.map(p => [p.orderId, Number(p.paid)]));

  const supplierIds = [...new Set(openPOs.map(p => p.supplierId).filter((x): x is number => x !== null))];
  const suppliers = supplierIds.length
    ? await db.select({ id: suppliersTable.id, name: suppliersTable.name })
        .from(suppliersTable).where(inArray(suppliersTable.id, supplierIds))
    : [];
  const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));

  const customerOrders = unpaidOrders
    .map(o => {
      const paid = paidMap.get(o.id) ?? 0;
      const total = Number(o.totalAmount);
      const due = Math.max(0, total - paid);
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        customerId: o.customerId,
        customerName: o.customerName ?? "Walk-in",
        totalAmount: total.toFixed(2),
        paidAmount: paid.toFixed(2),
        dueAmount: due.toFixed(2),
        paymentStatus: o.paymentStatus,
        createdAt: o.createdAt,
      };
    })
    .filter(o => Number(o.dueAmount) > 0.01);

  const supplierPOs = openPOs
    .map(po => {
      const total = Number(po.totalAmount);
      const paid = Number(po.paidAmount);
      const due = Math.max(0, total - paid);
      return {
        id: po.id,
        supplierId: po.supplierId,
        supplierName: po.supplierId ? (supplierMap.get(po.supplierId) ?? "Unknown supplier") : "—",
        status: po.status,
        totalAmount: total.toFixed(2),
        paidAmount: paid.toFixed(2),
        dueAmount: due.toFixed(2),
        orderedAt: po.orderedAt,
        createdAt: po.createdAt,
        notes: po.notes,
      };
    })
    .filter(po => Number(po.dueAmount) > 0.01);

  // Aggregate per-customer credit balance (outstanding across all their orders)
  const customerAgg = new Map<number, { customerId: number; customerName: string; openOrders: number; totalDue: number }>();
  for (const o of customerOrders) {
    if (o.customerId == null) continue;
    const due = Number(o.dueAmount);
    const existing = customerAgg.get(o.customerId);
    if (existing) {
      existing.openOrders += 1;
      existing.totalDue += due;
    } else {
      customerAgg.set(o.customerId, {
        customerId: o.customerId,
        customerName: o.customerName,
        openOrders: 1,
        totalDue: due,
      });
    }
  }
  const customerCredits = [...customerAgg.values()]
    .sort((a, b) => b.totalDue - a.totalDue)
    .map(c => ({
      customerId: c.customerId,
      customerName: c.customerName,
      openOrders: c.openOrders,
      totalDue: c.totalDue.toFixed(2),
    }));

  const totalCustomerDue = customerOrders.reduce((s, o) => s + Number(o.dueAmount), 0);
  const totalSupplierDue = supplierPOs.reduce((s, p) => s + Number(p.dueAmount), 0);

  res.json({
    customerOrders,
    customerCredits,
    supplierPOs,
    totalCustomerDue: totalCustomerDue.toFixed(2),
    totalSupplierDue: totalSupplierDue.toFixed(2),
  });
});

export default router;
