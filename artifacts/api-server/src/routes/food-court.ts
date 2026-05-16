import { Router, type Request, type Response } from "express";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  foodCourtsTable,
  foodCourtVendorsTable,
  foodCourtOrdersTable,
  foodCourtSubOrdersTable,
  foodCourtSettlementsTable,
  restaurantsTable,
  ordersTable,
  orderItemsTable,
  menuItemsTable,
  notificationsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { createKitchenTicketsForOrder } from "../lib/kitchenRouting";
import { issueTokenForOrder } from "../lib/tokens";
import { broadcastEvent } from "../lib/socketio";
import * as WalletService from "../lib/walletService";
import { logger } from "../lib/logger";

const router = Router();

// All food-court routes require authentication and the relevant role gates
// applied per-endpoint. Tenant scoping is enforced from `req.user.tenantId`.

const OWNER_ROLES = ["super_admin", "owner", "manager", "food_court_owner"] as const;
const CASHIER_ROLES = [...OWNER_ROLES, "cashier", "food_court_cashier"] as const;

function tenantFor(req: Request): number {
  if (!req.user) throw new Error("Unauthenticated");
  if (req.user.tenantId == null) throw new Error("User has no tenant scope");
  return req.user.tenantId;
}

async function loadFoodCourt(req: Request, res: Response) {
  const id = Number(req.params.foodCourtId);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid foodCourtId" });
    return null;
  }
  const [fc] = await db.select().from(foodCourtsTable).where(eq(foodCourtsTable.id, id));
  if (!fc) {
    res.status(404).json({ error: "Food court not found" });
    return null;
  }
  if (!req.user!.isSuperAdmin && fc.tenantId !== req.user!.tenantId) {
    res.status(403).json({ error: "Cross-tenant access denied" });
    return null;
  }
  return fc;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || `fc-${Date.now()}`;
}

function genParentOrderNumber(): string {
  const d = new Date();
  const yymmdd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `FC-${yymmdd}-${rand}`;
}

function genSubOrderNumber(parent: string, idx: number): string {
  return `${parent}-V${idx + 1}`;
}

// ─── Food courts CRUD ───────────────────────────────────────────────────────

router.get("/food-courts", requireRole(...OWNER_ROLES), async (req, res) => {
  const tenantId = tenantFor(req);
  const rows = await db.select().from(foodCourtsTable).where(eq(foodCourtsTable.tenantId, tenantId)).orderBy(desc(foodCourtsTable.createdAt));
  res.json(rows);
});

const upsertFoodCourtSchema = z.object({
  name: z.string().min(2),
  slug: z.string().optional(),
  addressLine: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  gstin: z.string().optional(),
  logoUrl: z.string().optional(),
  openingTime: z.string().optional(),
  closingTime: z.string().optional(),
  totalSeats: z.number().int().min(0).optional(),
  seatingMode: z.enum(["shared", "table_assigned"]).optional(),
  defaultCommissionPct: z.string().optional(),
  defaultPlatformFee: z.string().optional(),
  packagingFee: z.string().optional(),
  convenienceFee: z.string().optional(),
  serviceChargePct: z.string().optional(),
  acceptedPaymentMethods: z.array(z.string()).optional(),
  tokenPrefix: z.string().optional(),
  partialPickup: z.boolean().optional(),
  perVendorGstin: z.boolean().optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
  ownerRestaurantId: z.number().int().optional(),
});

router.post("/food-courts", requireRole(...OWNER_ROLES), async (req, res) => {
  const parsed = upsertFoodCourtSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
  const tenantId = tenantFor(req);
  const slug = parsed.data.slug ?? slugify(parsed.data.name);
  const [row] = await db.insert(foodCourtsTable).values({
    tenantId,
    name: parsed.data.name,
    slug,
    addressLine: parsed.data.addressLine,
    city: parsed.data.city,
    state: parsed.data.state,
    pincode: parsed.data.pincode,
    gstin: parsed.data.gstin,
    logoUrl: parsed.data.logoUrl,
    openingTime: parsed.data.openingTime,
    closingTime: parsed.data.closingTime,
    totalSeats: parsed.data.totalSeats ?? 0,
    seatingMode: parsed.data.seatingMode ?? "shared",
    defaultCommissionPct: parsed.data.defaultCommissionPct ?? "10.00",
    defaultPlatformFee: parsed.data.defaultPlatformFee ?? "0.00",
    packagingFee: parsed.data.packagingFee ?? "0.00",
    convenienceFee: parsed.data.convenienceFee ?? "0.00",
    serviceChargePct: parsed.data.serviceChargePct ?? "0.00",
    acceptedPaymentMethods: parsed.data.acceptedPaymentMethods ?? ["cash", "card", "upi", "gateway"],
    tokenPrefix: parsed.data.tokenPrefix ?? "FC",
    partialPickup: parsed.data.partialPickup ?? false,
    perVendorGstin: parsed.data.perVendorGstin ?? false,
    status: parsed.data.status ?? "active",
    ownerRestaurantId: parsed.data.ownerRestaurantId ?? null,
    createdBy: req.user?.sub ?? null,
  }).returning();
  res.status(201).json(row);
});

router.get("/food-courts/:foodCourtId", requireRole(...CASHIER_ROLES), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  res.json(fc);
});

router.patch("/food-courts/:foodCourtId", requireRole(...OWNER_ROLES), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  const parsed = upsertFoodCourtSchema.partial().safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
  const [row] = await db.update(foodCourtsTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(foodCourtsTable.id, fc.id)).returning();
  res.json(row);
});

router.delete("/food-courts/:foodCourtId", requireRole(...OWNER_ROLES), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  await db.update(foodCourtsTable).set({ status: "archived", updatedAt: new Date() }).where(eq(foodCourtsTable.id, fc.id));
  res.json({ ok: true });
});

// ─── Vendors ────────────────────────────────────────────────────────────────

router.get("/food-courts/:foodCourtId/vendors", requireRole(...CASHIER_ROLES), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  const rows = await db
    .select({
      v: foodCourtVendorsTable,
      restaurantName: restaurantsTable.name,
    })
    .from(foodCourtVendorsTable)
    .leftJoin(restaurantsTable, eq(restaurantsTable.id, foodCourtVendorsTable.restaurantId))
    .where(eq(foodCourtVendorsTable.foodCourtId, fc.id))
    .orderBy(foodCourtVendorsTable.counterNumber);
  res.json(rows.map(r => ({ ...r.v, restaurantName: r.restaurantName })));
});

const upsertVendorSchema = z.object({
  restaurantId: z.number().int(),
  counterNumber: z.string().optional(),
  stallName: z.string().min(1),
  cuisineTags: z.array(z.string()).optional(),
  commissionType: z.enum(["percentage", "flat_per_order", "tiered", "combo"]).optional(),
  commissionPct: z.string().optional(),
  flatFeePerOrder: z.string().optional(),
  tieredRules: z.array(z.object({ uptoMonthlyRevenue: z.number(), pct: z.number() })).optional(),
  settlementBankName: z.string().optional(),
  settlementAccountName: z.string().optional(),
  settlementAccountNumber: z.string().optional(),
  settlementIfsc: z.string().optional(),
  settlementUpiId: z.string().optional(),
  openingTime: z.string().optional(),
  closingTime: z.string().optional(),
  vendorGstin: z.string().optional(),
  isActive: z.boolean().optional(),
});

router.post("/food-courts/:foodCourtId/vendors", requireRole(...OWNER_ROLES), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  const parsed = upsertVendorSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });

  // Validate restaurant belongs to same tenant
  const [r] = await db.select({ id: restaurantsTable.id, tenantId: restaurantsTable.tenantId })
    .from(restaurantsTable).where(eq(restaurantsTable.id, parsed.data.restaurantId));
  if (!r || r.tenantId !== fc.tenantId) {
    return void res.status(400).json({ error: "Restaurant not found in tenant" });
  }

  const [row] = await db.insert(foodCourtVendorsTable).values({
    foodCourtId: fc.id,
    tenantId: fc.tenantId,
    restaurantId: parsed.data.restaurantId,
    counterNumber: parsed.data.counterNumber,
    stallName: parsed.data.stallName,
    cuisineTags: parsed.data.cuisineTags ?? [],
    commissionType: parsed.data.commissionType ?? "percentage",
    commissionPct: parsed.data.commissionPct ?? fc.defaultCommissionPct,
    flatFeePerOrder: parsed.data.flatFeePerOrder ?? "0.00",
    tieredRules: parsed.data.tieredRules ?? [],
    settlementBankName: parsed.data.settlementBankName,
    settlementAccountName: parsed.data.settlementAccountName,
    settlementAccountNumber: parsed.data.settlementAccountNumber,
    settlementIfsc: parsed.data.settlementIfsc,
    settlementUpiId: parsed.data.settlementUpiId,
    openingTime: parsed.data.openingTime,
    closingTime: parsed.data.closingTime,
    vendorGstin: parsed.data.vendorGstin,
    isActive: parsed.data.isActive ?? true,
  }).returning();
  res.status(201).json(row);
});

router.patch("/food-courts/:foodCourtId/vendors/:vendorId", requireRole(...OWNER_ROLES), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  const vendorId = Number(req.params.vendorId);
  const parsed = upsertVendorSchema.partial().safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });

  // Bump commission version when commission fields change
  const bump =
    parsed.data.commissionPct !== undefined ||
    parsed.data.commissionType !== undefined ||
    parsed.data.flatFeePerOrder !== undefined ||
    parsed.data.tieredRules !== undefined;

  const updateValues: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (bump) {
    updateValues.commissionVersion = sql`${foodCourtVendorsTable.commissionVersion} + 1`;
  }
  const [row] = await db.update(foodCourtVendorsTable)
    .set(updateValues as never)
    .where(and(eq(foodCourtVendorsTable.id, vendorId), eq(foodCourtVendorsTable.foodCourtId, fc.id)))
    .returning();
  if (!row) return void res.status(404).json({ error: "Vendor not found" });
  res.json(row);
});

router.delete("/food-courts/:foodCourtId/vendors/:vendorId", requireRole(...OWNER_ROLES), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  const vendorId = Number(req.params.vendorId);
  await db.update(foodCourtVendorsTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(foodCourtVendorsTable.id, vendorId), eq(foodCourtVendorsTable.foodCourtId, fc.id)));
  res.json({ ok: true });
});

// ─── Vendor menu (proxy to restaurant menu items, by restaurantId) ──────────

router.get("/food-courts/:foodCourtId/menu", requireRole(...CASHIER_ROLES), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  const vendors = await db.select().from(foodCourtVendorsTable)
    .where(and(eq(foodCourtVendorsTable.foodCourtId, fc.id), eq(foodCourtVendorsTable.isActive, true)));
  if (vendors.length === 0) return void res.json({ vendors: [], items: [] });

  const restaurantIds = vendors.map(v => v.restaurantId);
  const items = await db.select().from(menuItemsTable).where(inArray(menuItemsTable.restaurantId, restaurantIds));
  res.json({
    vendors: vendors.map(v => ({
      id: v.id, restaurantId: v.restaurantId, stallName: v.stallName, counterNumber: v.counterNumber,
      cuisineTags: v.cuisineTags,
    })),
    items: items.map(i => ({
      id: i.id, restaurantId: i.restaurantId, name: i.name, price: i.price,
      categoryId: i.categoryId, isAvailable: i.isAvailable, imageUrl: i.imageUrl,
    })),
  });
});

// ─── Common-billing checkout: create parent + per-vendor sub-orders ─────────

const checkoutSchema = z.object({
  tableNumber: z.string().optional(),
  zoneName: z.string().optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  paymentMethod: z.enum(["cash", "card", "upi", "gateway", "split"]).optional(),
  pickupMode: z.enum(["all_ready", "partial"]).optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    vendorId: z.number().int(),
    menuItemId: z.number().int(),
    quantity: z.number().int().min(1),
    notes: z.string().optional(),
  })).min(1),
});

router.post("/food-courts/:foodCourtId/orders", requireRole(...CASHIER_ROLES), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });

  // Group by vendor
  const byVendor = new Map<number, typeof parsed.data.items>();
  for (const it of parsed.data.items) {
    const list = byVendor.get(it.vendorId) ?? [];
    list.push(it);
    byVendor.set(it.vendorId, list);
  }

  const vendors = await db.select().from(foodCourtVendorsTable)
    .where(and(eq(foodCourtVendorsTable.foodCourtId, fc.id), inArray(foodCourtVendorsTable.id, Array.from(byVendor.keys()))));
  const vendorById = new Map(vendors.map(v => [v.id, v]));

  // Pull all referenced menu items (restricted to vendor restaurants)
  const allItemIds = parsed.data.items.map(i => i.menuItemId);
  const menuItems = await db.select().from(menuItemsTable).where(inArray(menuItemsTable.id, allItemIds));
  const menuById = new Map(menuItems.map(m => [m.id, m]));

  // Compute per-vendor totals
  const vendorTotals: Array<{
    vendor: typeof vendors[number];
    items: Array<{ menu: typeof menuItems[number]; qty: number; notes?: string }>;
    subtotal: number; tax: number; total: number;
  }> = [];

  for (const [vendorId, list] of byVendor) {
    const vendor = vendorById.get(vendorId);
    if (!vendor) return void res.status(400).json({ error: `Unknown vendor ${vendorId}` });
    const enriched: typeof vendorTotals[number]["items"] = [];
    let subtotal = 0;
    for (const it of list) {
      const menu = menuById.get(it.menuItemId);
      if (!menu || menu.restaurantId !== vendor.restaurantId) {
        return void res.status(400).json({ error: `Menu item ${it.menuItemId} not in vendor ${vendorId}` });
      }
      enriched.push({ menu, qty: it.quantity, notes: it.notes });
      subtotal += Number(menu.price) * it.quantity;
    }
    // Use vendor restaurant tax rate (kept simple — proportional to subtotal).
    const [r] = await db.select({ taxRate: restaurantsTable.taxRate, serviceCharge: restaurantsTable.serviceCharge })
      .from(restaurantsTable).where(eq(restaurantsTable.id, vendor.restaurantId));
    const taxRate = Number(r?.taxRate ?? "0") / 100;
    const tax = subtotal * taxRate;
    const total = subtotal + tax;
    vendorTotals.push({ vendor, items: enriched, subtotal, tax, total });
  }

  const grandSubtotal = vendorTotals.reduce((s, v) => s + v.subtotal, 0);
  const grandTax = vendorTotals.reduce((s, v) => s + v.tax, 0);
  const packagingFee = Number(fc.packagingFee);
  const convenienceFee = Number(fc.convenienceFee);
  const serviceCharge = grandSubtotal * (Number(fc.serviceChargePct) / 100);
  const grandTotal = grandSubtotal + grandTax + packagingFee + convenienceFee + serviceCharge;

  const parentNumber = genParentOrderNumber();
  const tokenPrefix = fc.tokenPrefix || "FC";
  // Sequential per-day token via random fallback (kept simple)
  const tokenNumber = Math.floor(Math.random() * 900) + 100;
  const token = `${tokenPrefix}-${tokenNumber}`;

  // Insert parent
  const [parent] = await db.insert(foodCourtOrdersTable).values({
    tenantId: fc.tenantId,
    foodCourtId: fc.id,
    parentOrderNumber: parentNumber,
    tableNumber: parsed.data.tableNumber,
    zoneName: parsed.data.zoneName,
    customerName: parsed.data.customerName,
    customerPhone: parsed.data.customerPhone,
    subtotal: grandSubtotal.toFixed(2),
    taxAmount: grandTax.toFixed(2),
    serviceCharge: serviceCharge.toFixed(2),
    packagingFee: packagingFee.toFixed(2),
    convenienceFee: convenienceFee.toFixed(2),
    discountAmount: "0.00",
    totalAmount: grandTotal.toFixed(2),
    paymentMethod: parsed.data.paymentMethod ?? "cash",
    paymentStatus: "paid", // common-billing flow assumes single capture at counter
    status: "preparing",
    pickupMode: parsed.data.pickupMode ?? (fc.partialPickup ? "partial" : "all_ready"),
    token,
    tokenNumber,
    cashierId: req.user?.sub ?? null,
    notes: parsed.data.notes,
  }).returning();

  // Create per-vendor child orders + sub-order rows
  const subOrders: Array<{ subOrderId: number; vendorId: number; restaurantId: number }> = [];
  let idx = 0;
  for (const vt of vendorTotals) {
    const subOrderNumber = genSubOrderNumber(parentNumber, idx++);
    const commissionPct = vt.vendor.commissionType === "percentage" || vt.vendor.commissionType === "combo"
      ? Number(vt.vendor.commissionPct) / 100 : 0;
    const flatFee = vt.vendor.commissionType === "flat_per_order" || vt.vendor.commissionType === "combo"
      ? Number(vt.vendor.flatFeePerOrder) : 0;
    const commissionAmount = vt.subtotal * commissionPct + flatFee;
    const netPayable = vt.total - commissionAmount;

    // Insert into ordersTable so existing kitchen / KOT flows work.
    const [child] = await db.insert(ordersTable).values({
      restaurantId: vt.vendor.restaurantId,
      orderNumber: subOrderNumber,
      orderType: "dine_in",
      status: "pending",
      paymentStatus: "paid",
      paymentMethod: parsed.data.paymentMethod ?? "cash",
      subtotal: vt.subtotal.toFixed(2),
      taxAmount: vt.tax.toFixed(2),
      serviceCharge: "0.00",
      discountAmount: "0.00",
      totalAmount: vt.total.toFixed(2),
      notes: `Food Court ${fc.name} • ${parentNumber} • Token ${token}`,
      customerName: parsed.data.customerName,
      customerPhone: parsed.data.customerPhone,
    }).returning();

    for (const it of vt.items) {
      await db.insert(orderItemsTable).values({
        orderId: child.id,
        menuItemId: it.menu.id,
        menuItemName: it.menu.name,
        quantity: it.qty,
        unitPrice: Number(it.menu.price).toFixed(2),
        totalPrice: (Number(it.menu.price) * it.qty).toFixed(2),
        notes: it.notes,
      });
    }

    await db.insert(foodCourtSubOrdersTable).values({
      parentId: parent.id,
      foodCourtId: fc.id,
      vendorId: vt.vendor.id,
      restaurantId: vt.vendor.restaurantId,
      subOrderId: child.id,
      subtotal: vt.subtotal.toFixed(2),
      taxAmount: vt.tax.toFixed(2),
      discountAmount: "0.00",
      totalAmount: vt.total.toFixed(2),
      paymentSplit: vt.total.toFixed(2),
      commissionAmount: commissionAmount.toFixed(2),
      commissionVersion: vt.vendor.commissionVersion,
      netPayable: netPayable.toFixed(2),
      status: "pending",
    });

    // Per-vendor KOT
    await createKitchenTicketsForOrder({
      orderId: child.id,
      restaurantId: vt.vendor.restaurantId,
      isPriority: false,
    }).catch(err => logger.warn({ err }, "fc kitchen ticket failed"));

    // Per-vendor token (also linking to the parent token via metadata in notes)
    await issueTokenForOrder({
      orderId: child.id,
      restaurantId: vt.vendor.restaurantId,
      orderType: "dine_in",
      customerName: parsed.data.customerName,
      customerPhone: parsed.data.customerPhone,
    }).catch(() => null);

    broadcastEvent(vt.vendor.restaurantId, "food_court:sub_order:new", {
      foodCourtId: fc.id, parentId: parent.id, subOrderId: child.id, vendorId: vt.vendor.id, token,
    });

    await db.insert(notificationsTable).values({
      restaurantId: vt.vendor.restaurantId,
      type: "new_order",
      title: "Food Court order",
      message: `New order from ${fc.name} (Token ${token}) — ₹${vt.total.toFixed(2)}`,
      entityId: child.id,
      entityType: "order",
    }).catch(() => {});

    subOrders.push({ subOrderId: child.id, vendorId: vt.vendor.id, restaurantId: vt.vendor.restaurantId });
  }

  res.status(201).json({ ...parent, subOrders });
});

// ─── Read parent order (with sub-orders) ────────────────────────────────────

router.get("/food-courts/:foodCourtId/orders/:parentId", requireRole(...CASHIER_ROLES), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  const parentId = Number(req.params.parentId);
  const [parent] = await db.select().from(foodCourtOrdersTable)
    .where(and(eq(foodCourtOrdersTable.id, parentId), eq(foodCourtOrdersTable.foodCourtId, fc.id)));
  if (!parent) return void res.status(404).json({ error: "Not found" });
  const subs = await db.select().from(foodCourtSubOrdersTable).where(eq(foodCourtSubOrdersTable.parentId, parent.id));
  res.json({ parent, subOrders: subs });
});

// ─── Tokens / live orders ───────────────────────────────────────────────────

router.get("/food-courts/:foodCourtId/tokens", requireRole(...CASHIER_ROLES), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const parents = await db.select().from(foodCourtOrdersTable)
    .where(and(eq(foodCourtOrdersTable.foodCourtId, fc.id), gte(foodCourtOrdersTable.createdAt, since)))
    .orderBy(desc(foodCourtOrdersTable.createdAt));
  if (parents.length === 0) return void res.json([]);
  const subs = await db.select().from(foodCourtSubOrdersTable)
    .where(inArray(foodCourtSubOrdersTable.parentId, parents.map(p => p.id)));
  const byParent = new Map<number, typeof subs>();
  for (const s of subs) {
    const arr = byParent.get(s.parentId) ?? [];
    arr.push(s);
    byParent.set(s.parentId, arr);
  }
  res.json(parents.map(p => ({
    id: p.id, token: p.token, parentOrderNumber: p.parentOrderNumber, status: p.status,
    customerName: p.customerName, tableNumber: p.tableNumber, totalAmount: p.totalAmount,
    pickupMode: p.pickupMode, createdAt: p.createdAt,
    subOrders: (byParent.get(p.id) ?? []).map(s => ({
      id: s.id, vendorId: s.vendorId, restaurantId: s.restaurantId, status: s.status,
      readyAt: s.readyAt, totalAmount: s.totalAmount,
    })),
  })));
});

// ─── Per-vendor sub-order status update ─────────────────────────────────────

router.patch("/food-courts/:foodCourtId/sub-orders/:subId/status", requireRole(...CASHIER_ROLES, "kitchen", "waiter", "staff"), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  const subId = Number(req.params.subId);
  const status = String(req.body?.status ?? "");
  if (!["pending", "preparing", "ready", "served", "cancelled", "refunded"].includes(status)) {
    return void res.status(400).json({ error: "Invalid status" });
  }
  const [sub] = await db.select().from(foodCourtSubOrdersTable)
    .where(and(eq(foodCourtSubOrdersTable.id, subId), eq(foodCourtSubOrdersTable.foodCourtId, fc.id)));
  if (!sub) return void res.status(404).json({ error: "Not found" });
  const updates: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === "ready") updates.readyAt = new Date();
  if (status === "served") updates.servedAt = new Date();
  await db.update(foodCourtSubOrdersTable).set(updates as never).where(eq(foodCourtSubOrdersTable.id, subId));

  // Roll up to parent: completed when all served (or any served in partial mode)
  const siblings = await db.select().from(foodCourtSubOrdersTable).where(eq(foodCourtSubOrdersTable.parentId, sub.parentId));
  const allReady = siblings.every(s => (s.id === subId ? status : s.status) === "ready" || (s.id === subId ? status : s.status) === "served");
  const allServed = siblings.every(s => (s.id === subId ? status : s.status) === "served");
  const anyPreparing = siblings.some(s => (s.id === subId ? status : s.status) === "preparing");
  let parentStatus: string | null = null;
  if (allServed) parentStatus = "completed";
  else if (allReady) parentStatus = "ready";
  else if (anyPreparing) parentStatus = "preparing";
  if (parentStatus) {
    await db.update(foodCourtOrdersTable).set({
      status: parentStatus,
      completedAt: parentStatus === "completed" ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(foodCourtOrdersTable.id, sub.parentId));
  }

  broadcastEvent(sub.restaurantId, "food_court:sub_order:update", { subId, status });
  res.json({ ok: true, status, parentStatus });
});

// ─── Per-vendor sub-order refund ────────────────────────────────────────────

router.post("/food-courts/:foodCourtId/sub-orders/:subId/refund", requireRole(...OWNER_ROLES, "cashier"), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  const subId = Number(req.params.subId);
  const amount = Number(req.body?.amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return void res.status(400).json({ error: "Invalid amount" });
  const [sub] = await db.select().from(foodCourtSubOrdersTable)
    .where(and(eq(foodCourtSubOrdersTable.id, subId), eq(foodCourtSubOrdersTable.foodCourtId, fc.id)));
  if (!sub) return void res.status(404).json({ error: "Not found" });
  if (sub.settledAt) return void res.status(409).json({ error: "Sub-order already settled" });

  await db.update(foodCourtSubOrdersTable).set({
    refundAmount: (Number(sub.refundAmount) + amount).toFixed(2),
    netPayable: Math.max(0, Number(sub.netPayable) - amount).toFixed(2),
    status: "refunded",
    updatedAt: new Date(),
  }).where(eq(foodCourtSubOrdersTable.id, subId));
  res.json({ ok: true });
});

// ─── Settlements ────────────────────────────────────────────────────────────

router.get("/food-courts/:foodCourtId/settlements", requireRole(...OWNER_ROLES), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  const rows = await db.select().from(foodCourtSettlementsTable)
    .where(eq(foodCourtSettlementsTable.foodCourtId, fc.id))
    .orderBy(desc(foodCourtSettlementsTable.settlementDate));
  res.json(rows);
});

const runSettlementSchema = z.object({
  settlementDate: z.string().optional(), // YYYY-MM-DD; defaults to yesterday
  vendorIds: z.array(z.number().int()).optional(),
});

function paise(rupees: number): number { return Math.round(rupees * 100); }

router.post("/food-courts/:foodCourtId/settlements/run", requireRole(...OWNER_ROLES), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  const parsed = runSettlementSchema.safeParse(req.body ?? {});
  if (!parsed.success) return void res.status(400).json({ error: "Invalid payload" });

  const target = parsed.data.settlementDate
    ? new Date(parsed.data.settlementDate + "T00:00:00")
    : (() => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0, 0, 0, 0); return d; })();
  const dayStart = new Date(target); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(target); dayEnd.setHours(23, 59, 59, 999);
  const dayStr = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, "0")}-${String(dayStart.getDate()).padStart(2, "0")}`;

  let vendors = await db.select().from(foodCourtVendorsTable).where(eq(foodCourtVendorsTable.foodCourtId, fc.id));
  if (parsed.data.vendorIds?.length) {
    vendors = vendors.filter(v => parsed.data.vendorIds!.includes(v.id));
  }

  const results: Array<{ vendorId: number; settlementId?: number; netPayable: number; transferGroupId?: string; error?: string }> = [];

  for (const vendor of vendors) {
    try {
      // Aggregate vendor sub-orders for the day not already settled
      const subs = await db.select().from(foodCourtSubOrdersTable).where(and(
        eq(foodCourtSubOrdersTable.vendorId, vendor.id),
        gte(foodCourtSubOrdersTable.createdAt, dayStart),
        lte(foodCourtSubOrdersTable.createdAt, dayEnd),
      ));
      const unsettled = subs.filter(s => !s.settledAt && s.status !== "cancelled");
      if (unsettled.length === 0) {
        results.push({ vendorId: vendor.id, netPayable: 0 });
        continue;
      }

      const grossSales = unsettled.reduce((s, x) => s + Number(x.subtotal), 0);
      const taxes = unsettled.reduce((s, x) => s + Number(x.taxAmount), 0);
      const discounts = unsettled.reduce((s, x) => s + Number(x.discountAmount), 0);
      const refunds = unsettled.reduce((s, x) => s + Number(x.refundAmount), 0);
      const commission = unsettled.reduce((s, x) => s + Number(x.commissionAmount), 0);
      const netPayable = unsettled.reduce((s, x) => s + Number(x.netPayable), 0) - refunds;

      // Insert settlement record (or upsert via uniqueIndex)
      const [settlement] = await db.insert(foodCourtSettlementsTable).values({
        tenantId: fc.tenantId,
        foodCourtId: fc.id,
        vendorId: vendor.id,
        restaurantId: vendor.restaurantId,
        settlementDate: dayStr,
        orderCount: unsettled.length,
        grossSales: paise(grossSales),
        taxesCollected: paise(taxes),
        discountsGiven: paise(discounts),
        refundsGiven: paise(refunds),
        surchargesRetained: 0,
        commissionAmount: paise(commission),
        platformFee: 0,
        gatewayFee: 0,
        netPayable: paise(Math.max(0, netPayable)),
        status: "draft",
        generatedBy: req.user?.sub ?? null,
      }).onConflictDoNothing({ target: [foodCourtSettlementsTable.vendorId, foodCourtSettlementsTable.settlementDate] }).returning();

      if (!settlement) {
        results.push({ vendorId: vendor.id, netPayable: 0, error: "already settled" });
        continue;
      }

      // Wallet transfer: food-court owner restaurant → vendor restaurant.
      // If owner restaurant not configured, just credit vendor (treat as pure credit).
      let transferGroupId: string | undefined;
      if (settlement.netPayable > 0) {
        if (fc.ownerRestaurantId) {
          // Ensure owner wallet has funds; otherwise credit vendor directly with no debit (acts as adjustment).
          const ownerWallet = await WalletService.getOrCreateWallet({
            tenantId: fc.tenantId, kind: "restaurant", restaurantId: fc.ownerRestaurantId,
          });
          const balance = await WalletService.getBalance(ownerWallet.id);
          if (balance && balance.available >= settlement.netPayable) {
            const r = await WalletService.transfer({
              from: { tenantId: fc.tenantId, kind: "restaurant", restaurantId: fc.ownerRestaurantId },
              to: { tenantId: fc.tenantId, kind: "restaurant", restaurantId: vendor.restaurantId },
              amount: settlement.netPayable,
              type: "settlement",
              channel: "wallet_transfer",
              notes: `Food Court ${fc.name} settlement ${dayStr} (vendor ${vendor.stallName})`,
              idempotencyKey: `fc_settle_${settlement.id}`,
              createdBy: req.user?.sub ?? null,
              metadata: { foodCourtId: fc.id, settlementId: settlement.id, vendorId: vendor.id },
            });
            transferGroupId = r.transferGroupId;

            // Credit owner with commission portion
            if (settlement.commissionAmount > 0) {
              await WalletService.credit({
                tenantId: fc.tenantId, kind: "restaurant", restaurantId: fc.ownerRestaurantId,
              }, {
                amount: settlement.commissionAmount,
                type: "commission",
                channel: "manual",
                referenceType: "food_court_settlement",
                referenceId: settlement.id,
                idempotencyKey: `fc_commission_${settlement.id}`,
                createdBy: req.user?.sub ?? null,
                notes: `Food Court ${fc.name} commission ${dayStr}`,
              }).catch(err => logger.warn({ err }, "fc commission credit failed"));
            }
          } else {
            // Insufficient owner wallet funds — record settlement but leave for manual payout.
            logger.warn({ foodCourtId: fc.id, vendorId: vendor.id }, "insufficient owner wallet, settlement left unpaid");
          }
        } else {
          // No owner wallet configured; credit vendor as adjustment.
          await WalletService.credit({
            tenantId: fc.tenantId, kind: "restaurant", restaurantId: vendor.restaurantId,
          }, {
            amount: settlement.netPayable,
            type: "settlement",
            channel: "manual",
            referenceType: "food_court_settlement",
            referenceId: settlement.id,
            idempotencyKey: `fc_settle_${settlement.id}`,
            createdBy: req.user?.sub ?? null,
            notes: `Food Court ${fc.name} settlement ${dayStr}`,
          });
        }
      }

      const finalStatus = transferGroupId ? "paid" : "finalised";
      const [final] = await db.update(foodCourtSettlementsTable).set({
        status: finalStatus,
        walletTransferGroupId: transferGroupId,
        paidAt: transferGroupId ? new Date() : null,
        updatedAt: new Date(),
      }).where(eq(foodCourtSettlementsTable.id, settlement.id)).returning();

      // Mark sub-orders as settled
      await db.update(foodCourtSubOrdersTable).set({
        settlementId: settlement.id, settledAt: new Date(), updatedAt: new Date(),
      }).where(inArray(foodCourtSubOrdersTable.id, unsettled.map(s => s.id)));

      // Notify vendor
      await db.insert(notificationsTable).values({
        restaurantId: vendor.restaurantId,
        type: "settlement",
        title: "Food Court settlement",
        message: `${fc.name} settled ₹${(settlement.netPayable / 100).toFixed(2)} for ${dayStr}`,
        entityId: settlement.id,
        entityType: "food_court_settlement",
      }).catch(() => {});

      results.push({
        vendorId: vendor.id,
        settlementId: final.id,
        netPayable: final.netPayable,
        transferGroupId,
      });
    } catch (err) {
      logger.error({ err, vendorId: vendor.id }, "fc settlement failed");
      results.push({ vendorId: vendor.id, netPayable: 0, error: (err as Error).message });
    }
  }

  res.json({ settlementDate: dayStr, results });
});

// ─── Owner dashboard ────────────────────────────────────────────────────────

router.get("/food-courts/:foodCourtId/dashboard", requireRole(...OWNER_ROLES), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  const range = String(req.query.range ?? "today");
  const now = new Date();
  const since = new Date(now);
  if (range === "week") since.setDate(now.getDate() - 7);
  else if (range === "month") since.setDate(now.getDate() - 30);
  else since.setHours(0, 0, 0, 0);

  const [totals] = await db.select({
    orderCount: sql<number>`count(*)::int`,
    sales: sql<string>`coalesce(sum(${foodCourtOrdersTable.totalAmount}),0)`,
  }).from(foodCourtOrdersTable)
    .where(and(eq(foodCourtOrdersTable.foodCourtId, fc.id), gte(foodCourtOrdersTable.createdAt, since)));

  const vendorRows = await db.select({
    vendorId: foodCourtSubOrdersTable.vendorId,
    stallName: foodCourtVendorsTable.stallName,
    counterNumber: foodCourtVendorsTable.counterNumber,
    orders: sql<number>`count(*)::int`,
    sales: sql<string>`coalesce(sum(${foodCourtSubOrdersTable.totalAmount}),0)`,
    commission: sql<string>`coalesce(sum(${foodCourtSubOrdersTable.commissionAmount}),0)`,
    refunds: sql<string>`coalesce(sum(${foodCourtSubOrdersTable.refundAmount}),0)`,
  }).from(foodCourtSubOrdersTable)
    .innerJoin(foodCourtVendorsTable, eq(foodCourtVendorsTable.id, foodCourtSubOrdersTable.vendorId))
    .where(and(eq(foodCourtSubOrdersTable.foodCourtId, fc.id), gte(foodCourtSubOrdersTable.createdAt, since)))
    .groupBy(foodCourtSubOrdersTable.vendorId, foodCourtVendorsTable.stallName, foodCourtVendorsTable.counterNumber)
    .orderBy(sql`coalesce(sum(${foodCourtSubOrdersTable.totalAmount}),0) desc`);

  const liveTokens = await db.select({
    id: foodCourtOrdersTable.id, token: foodCourtOrdersTable.token, status: foodCourtOrdersTable.status,
    totalAmount: foodCourtOrdersTable.totalAmount, customerName: foodCourtOrdersTable.customerName,
    createdAt: foodCourtOrdersTable.createdAt,
  }).from(foodCourtOrdersTable)
    .where(and(eq(foodCourtOrdersTable.foodCourtId, fc.id), inArray(foodCourtOrdersTable.status, ["open", "preparing", "ready"])))
    .orderBy(desc(foodCourtOrdersTable.createdAt))
    .limit(20);

  res.json({
    range,
    totals: { orderCount: totals?.orderCount ?? 0, sales: totals?.sales ?? "0" },
    vendors: vendorRows,
    liveTokens,
  });
});

// ─── Vendor "My Counter" dashboard ──────────────────────────────────────────

router.get("/food-courts/:foodCourtId/my-counter", requireRole(...CASHIER_ROLES, "owner", "manager", "staff", "kitchen", "waiter"), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  const restaurantId = req.user!.restaurantId;
  if (!restaurantId) return void res.status(400).json({ error: "User has no restaurant scope" });

  const [vendor] = await db.select().from(foodCourtVendorsTable)
    .where(and(eq(foodCourtVendorsTable.foodCourtId, fc.id), eq(foodCourtVendorsTable.restaurantId, restaurantId)));
  if (!vendor) return void res.status(404).json({ error: "Vendor not found in this food court" });

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);

  const [totals] = await db.select({
    orderCount: sql<number>`count(*)::int`,
    sales: sql<string>`coalesce(sum(${foodCourtSubOrdersTable.totalAmount}),0)`,
    commission: sql<string>`coalesce(sum(${foodCourtSubOrdersTable.commissionAmount}),0)`,
    netPayable: sql<string>`coalesce(sum(${foodCourtSubOrdersTable.netPayable}),0)`,
  }).from(foodCourtSubOrdersTable)
    .where(and(eq(foodCourtSubOrdersTable.vendorId, vendor.id), gte(foodCourtSubOrdersTable.createdAt, dayStart)));

  const liveSubs = await db.select().from(foodCourtSubOrdersTable)
    .where(and(eq(foodCourtSubOrdersTable.vendorId, vendor.id), inArray(foodCourtSubOrdersTable.status, ["pending", "preparing", "ready"])))
    .orderBy(desc(foodCourtSubOrdersTable.createdAt))
    .limit(50);

  const settlements = await db.select().from(foodCourtSettlementsTable)
    .where(eq(foodCourtSettlementsTable.vendorId, vendor.id))
    .orderBy(desc(foodCourtSettlementsTable.settlementDate))
    .limit(30);

  res.json({
    vendor,
    foodCourt: { id: fc.id, name: fc.name },
    today: {
      orderCount: totals?.orderCount ?? 0,
      sales: totals?.sales ?? "0",
      commission: totals?.commission ?? "0",
      netPayable: totals?.netPayable ?? "0",
    },
    liveSubOrders: liveSubs,
    settlements,
  });
});

// ─── Vendor-wise sales report (owner) ───────────────────────────────────────

router.get("/food-courts/:foodCourtId/reports/vendor-sales", requireRole(...OWNER_ROLES), async (req, res) => {
  const fc = await loadFoodCourt(req, res);
  if (!fc) return;
  const fromStr = String(req.query.from ?? "");
  const toStr = String(req.query.to ?? "");
  const from = fromStr ? new Date(fromStr) : (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d; })();
  const to = toStr ? new Date(toStr) : new Date();

  const rows = await db.select({
    vendorId: foodCourtSubOrdersTable.vendorId,
    stallName: foodCourtVendorsTable.stallName,
    counterNumber: foodCourtVendorsTable.counterNumber,
    orders: sql<number>`count(*)::int`,
    grossSales: sql<string>`coalesce(sum(${foodCourtSubOrdersTable.subtotal}),0)`,
    taxes: sql<string>`coalesce(sum(${foodCourtSubOrdersTable.taxAmount}),0)`,
    refunds: sql<string>`coalesce(sum(${foodCourtSubOrdersTable.refundAmount}),0)`,
    commission: sql<string>`coalesce(sum(${foodCourtSubOrdersTable.commissionAmount}),0)`,
    netPayable: sql<string>`coalesce(sum(${foodCourtSubOrdersTable.netPayable}),0)`,
  }).from(foodCourtSubOrdersTable)
    .innerJoin(foodCourtVendorsTable, eq(foodCourtVendorsTable.id, foodCourtSubOrdersTable.vendorId))
    .where(and(
      eq(foodCourtSubOrdersTable.foodCourtId, fc.id),
      gte(foodCourtSubOrdersTable.createdAt, from),
      lte(foodCourtSubOrdersTable.createdAt, to),
    ))
    .groupBy(foodCourtSubOrdersTable.vendorId, foodCourtVendorsTable.stallName, foodCourtVendorsTable.counterNumber);

  res.json({ from: from.toISOString(), to: to.toISOString(), rows });
});

export default router;
