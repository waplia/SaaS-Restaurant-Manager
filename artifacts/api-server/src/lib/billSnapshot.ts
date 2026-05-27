/**
 * Task #674 — Canonical bill snapshot.
 *
 * The snapshot is the single source of truth for every bill surface (web POS,
 * desktop POS, mobile waiter, QR receipt, A4 PDF, WhatsApp share, email).
 * Once frozen onto `orders.bill_snapshot`, every reprint / share renders the
 * same bytes regardless of later edits to menu prices, tax rates, or
 * restaurant settings.
 *
 * The shape intentionally mirrors what the renderer consumes — no extra
 * lookups during render, so the same object works server-side (PDF, share
 * preview) and client-side (web POS print, mobile share sheet).
 */
import { eq, and } from "drizzle-orm";
import {
  db,
  ordersTable,
  orderItemsTable,
  orderDiscountsTable,
  restaurantsTable,
  branchesTable,
  floorTablesTable,
  usersTable,
} from "./db";

export interface BillSnapshotItem {
  id: number;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  notes?: string | null;
  modifiers?: Array<{ name: string; price: number }>;
}

export interface BillSnapshotDiscount {
  label: string;
  amount: number;
}

export interface BillSnapshotPayment {
  method: string;
  status: string;
  tendered?: number | null;
  change?: number | null;
  reference?: string | null;
}

export interface BillSnapshot {
  /** Schema version — bump when the shape changes so the renderer can migrate. */
  schemaVersion: 1;
  /** ISO timestamp when this snapshot was frozen. */
  snapshotAt: string;
  restaurant: {
    id: number;
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    gstin: string | null;
    fssaiLicense: string | null;
    logoUrl: string | null;
    currency: string;
    timezone: string;
    upiId: string | null;
    upiMerchantName: string | null;
    upiQrEnabled: boolean;
    upiPrintQrMode: string;
    upiQrLabel: string | null;
  };
  outlet: {
    id: number | null;
    name: string | null;
    outletCode: string | null;
    address: string | null;
    phone: string | null;
  };
  order: {
    id: number;
    orderNumber: string;
    orderDisplayNumber: string | null;
    orderInternalNumber: string | null;
    orderType: string;
    status: string;
    paymentStatus: string;
    tableLabel: string | null;
    waiterName: string | null;
    cashierName: string | null;
    customerName: string | null;
    customerPhone: string | null;
    createdAt: string;
    billGeneratedAt: string | null;
    paidAt: string | null;
    notes: string | null;
  };
  items: BillSnapshotItem[];
  totals: {
    subtotal: number;
    discountAmount: number;
    serviceCharge: number;
    taxAmount: number;
    deliveryFee: number;
    tipAmount: number;
    roundOff: number;
    grandTotal: number;
    taxBreakdown: Array<{ rate: string; amount: number }>;
  };
  discounts: BillSnapshotDiscount[];
  payment: BillSnapshotPayment | null;
}

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build a fresh snapshot from live tables. Callers persist the result onto
 * `orders.bill_snapshot` at generate-bill / payment time to freeze it.
 */
export async function buildBillSnapshot(orderId: number): Promise<BillSnapshot | null> {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) return null;

  const [restaurant] = await db
    .select()
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, order.restaurantId));
  if (!restaurant) return null;

  let outlet: typeof branchesTable.$inferSelect | null = null;
  if (order.branchId) {
    const [b] = await db
      .select()
      .from(branchesTable)
      .where(and(eq(branchesTable.id, order.branchId), eq(branchesTable.restaurantId, order.restaurantId)));
    outlet = b ?? null;
  }

  let table: typeof floorTablesTable.$inferSelect | null = null;
  if (order.tableId) {
    const [t] = await db.select().from(floorTablesTable).where(eq(floorTablesTable.id, order.tableId));
    table = t ?? null;
  }

  let waiter: { name: string } | null = null;
  if (order.waiterId) {
    const [u] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, order.waiterId));
    waiter = u ?? null;
  }

  const itemRows = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const billable = itemRows.filter(i => i.status !== "cancelled");
  const items: BillSnapshotItem[] = billable.map(i => ({
    id: i.id,
    name: i.menuItemName,
    quantity: i.quantity,
    unitPrice: toNum(i.unitPrice),
    lineTotal: toNum(i.totalPrice),
    notes: i.notes ?? null,
  }));

  const discountRows = await db
    .select()
    .from(orderDiscountsTable)
    .where(eq(orderDiscountsTable.orderId, orderId));
  const discounts: BillSnapshotDiscount[] = discountRows
    .map(d => ({
      label: d.reason || d.type || "Discount",
      amount: toNum(d.amount),
    }))
    .filter(d => d.amount > 0);

  const subtotal = toNum(order.subtotal);
  const taxAmount = toNum(order.taxAmount);
  const serviceCharge = toNum(order.serviceCharge);
  const discountAmount = toNum(order.discountAmount);
  const deliveryFee = toNum(order.deliveryFee);
  const tipAmount = toNum(order.tipAmount);
  const grandTotal = toNum(order.totalAmount);
  // Round-off is the residual between summed components and stored total
  // (e.g. when an outlet rounds to nearest rupee at payment time).
  const rawSum = subtotal + taxAmount + serviceCharge + deliveryFee + tipAmount - discountAmount;
  const roundOff = Math.round((grandTotal - rawSum) * 100) / 100;

  const taxRate = toNum(restaurant.taxRate);
  const taxBreakdown = taxAmount > 0 && taxRate > 0
    ? [{ rate: `${taxRate.toFixed(2)}%`, amount: taxAmount }]
    : [];

  const payment: BillSnapshotPayment | null = order.paymentStatus === "paid" && order.paymentMethod
    ? {
        method: order.paymentMethod,
        status: order.paymentStatus,
        tendered: null,
        change: null,
        reference: order.stripePaymentId ?? null,
      }
    : null;

  return {
    schemaVersion: 1,
    snapshotAt: new Date().toISOString(),
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      address: restaurant.address ?? null,
      phone: restaurant.phone ?? null,
      email: restaurant.email ?? null,
      gstin: restaurant.gstin ?? null,
      fssaiLicense: restaurant.fssaiLicense ?? null,
      logoUrl: restaurant.logoUrl ?? null,
      currency: restaurant.currency ?? "INR",
      timezone: restaurant.timezone ?? "Asia/Kolkata",
      upiId: outlet?.upiId ?? restaurant.upiId ?? null,
      upiMerchantName: outlet?.upiMerchantName ?? restaurant.upiMerchantName ?? null,
      upiQrEnabled: outlet?.upiQrEnabled ?? restaurant.upiQrEnabled ?? false,
      upiPrintQrMode: restaurant.upiPrintQrMode ?? "all",
      upiQrLabel: restaurant.upiQrLabel ?? null,
    },
    outlet: {
      id: outlet?.id ?? null,
      name: outlet?.name ?? null,
      outletCode: outlet?.outletCode ?? null,
      address: outlet?.address ?? null,
      phone: outlet?.phone ?? null,
    },
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      orderDisplayNumber: order.orderDisplayNumber ?? null,
      orderInternalNumber: order.orderInternalNumber ?? null,
      orderType: order.orderType,
      status: order.status,
      paymentStatus: order.paymentStatus,
      tableLabel: table?.tableNumber ? `Table ${table.tableNumber}` : null,
      waiterName: waiter?.name ?? null,
      cashierName: null,
      customerName: order.customerName ?? null,
      customerPhone: order.customerPhone ?? null,
      createdAt: order.createdAt.toISOString(),
      billGeneratedAt: order.billGeneratedAt ? order.billGeneratedAt.toISOString() : null,
      paidAt: order.paidAt ? order.paidAt.toISOString() : null,
      notes: order.notes ?? null,
    },
    items,
    totals: {
      subtotal,
      discountAmount,
      serviceCharge,
      taxAmount,
      deliveryFee,
      tipAmount,
      roundOff,
      grandTotal,
      taxBreakdown,
    },
    discounts,
    payment,
  };
}

/**
 * Returns the saved snapshot if present, otherwise builds (but does not
 * persist) a fresh one. Persisting is the caller's choice — generate-bill
 * and pay routes do; preview / GET endpoints don't.
 */
export async function getOrBuildBillSnapshot(orderId: number): Promise<BillSnapshot | null> {
  const [order] = await db
    .select({ snapshot: ordersTable.billSnapshot })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId));
  if (order?.snapshot && typeof order.snapshot === "object" && (order.snapshot as { schemaVersion?: number }).schemaVersion) {
    return order.snapshot as unknown as BillSnapshot;
  }
  return buildBillSnapshot(orderId);
}

/** Freeze and persist a snapshot. Used by generate-bill and pay routes. */
export async function freezeBillSnapshot(orderId: number): Promise<BillSnapshot | null> {
  const snap = await buildBillSnapshot(orderId);
  if (!snap) return null;
  await db
    .update(ordersTable)
    .set({ billSnapshot: snap as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(ordersTable.id, orderId));
  return snap;
}

/**
 * Build a small synthetic snapshot used by the template editor's preview /
 * "send test invoice" / "sample PDF" actions. Pulls real restaurant data so
 * the GSTIN / logo / FSSAI lines reflect the actual outlet — only the items,
 * totals, and order meta are fake.
 */
export async function buildSampleBillSnapshot(restaurantId: number): Promise<BillSnapshot | null> {
  const [restaurant] = await db
    .select()
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));
  if (!restaurant) return null;

  const items: BillSnapshotItem[] = [
    { id: 1, name: "Paneer Tikka Masala", quantity: 1, unitPrice: 320, lineTotal: 320 },
    { id: 2, name: "Butter Naan", quantity: 2, unitPrice: 60, lineTotal: 120 },
    { id: 3, name: "Masala Chai", quantity: 2, unitPrice: 40, lineTotal: 80 },
  ];
  const subtotal = 520;
  const taxRate = toNum(restaurant.taxRate);
  const serviceRate = toNum(restaurant.serviceCharge);
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const serviceCharge = Math.round(subtotal * (serviceRate / 100) * 100) / 100;
  const grandTotal = subtotal + taxAmount + serviceCharge;
  return {
    schemaVersion: 1,
    snapshotAt: new Date().toISOString(),
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      address: restaurant.address ?? null,
      phone: restaurant.phone ?? null,
      email: restaurant.email ?? null,
      gstin: restaurant.gstin ?? null,
      fssaiLicense: restaurant.fssaiLicense ?? null,
      logoUrl: restaurant.logoUrl ?? null,
      currency: restaurant.currency ?? "INR",
      timezone: restaurant.timezone ?? "Asia/Kolkata",
      upiId: restaurant.upiId ?? null,
      upiMerchantName: restaurant.upiMerchantName ?? null,
      upiQrEnabled: restaurant.upiQrEnabled ?? false,
      upiPrintQrMode: restaurant.upiPrintQrMode ?? "all",
      upiQrLabel: restaurant.upiQrLabel ?? null,
    },
    outlet: { id: null, name: null, outletCode: null, address: null, phone: null },
    order: {
      id: 0,
      orderNumber: "SAMPLE-001",
      orderDisplayNumber: "SAMPLE-001",
      orderInternalNumber: "SAMPLE-001",
      orderType: "dine_in",
      status: "served",
      paymentStatus: "unpaid",
      tableLabel: "Table 5",
      waiterName: "Sample Waiter",
      cashierName: null,
      customerName: "Sample Customer",
      customerPhone: "+91 90000 00000",
      createdAt: new Date().toISOString(),
      billGeneratedAt: new Date().toISOString(),
      paidAt: null,
      notes: null,
    },
    items,
    totals: {
      subtotal,
      discountAmount: 0,
      serviceCharge,
      taxAmount,
      deliveryFee: 0,
      tipAmount: 0,
      roundOff: 0,
      grandTotal,
      taxBreakdown: taxAmount > 0 ? [{ rate: `${taxRate.toFixed(2)}%`, amount: taxAmount }] : [],
    },
    discounts: [],
    payment: null,
  };
}
