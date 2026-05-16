import { and, eq, gte, lte, asc } from "drizzle-orm";
import {
  db,
  ordersTable,
  orderItemsTable,
  expensesTable,
  expenseCategoriesTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  suppliersTable,
} from "../db";
import type { AccountingDataset } from "../db";

export interface DatasetRow {
  /** ISO date (YYYY-MM-DD) used for the voucher / journal date. */
  date: string;
  /** Reference number (order number, expense id, PO id). */
  reference: string;
  /** Party name (customer / payee / supplier) — empty string if unknown. */
  party: string;
  /** Source ledger key (used for ledger-mapping lookups). */
  ledger: string;
  /** Source tax code (used for tax-mapping lookups). May be empty. */
  taxCode: string;
  /** Pre-tax amount in restaurant currency. */
  amount: number;
  /** Tax amount. */
  taxAmount: number;
  /** Total = amount + taxAmount + extras (service charge etc.). */
  total: number;
  /** Free-form description (line items summary). */
  description: string;
  /** Original source row id. */
  sourceId: number;
  /** Source-specific metadata (kept verbatim for JSON exports). */
  meta: Record<string, unknown>;
}

export interface BuildDatasetArgs {
  restaurantId: number;
  dataset: AccountingDataset;
  /** Inclusive YYYY-MM-DD bounds. */
  dateFrom: string;
  dateTo: string;
}

export async function buildDataset(args: BuildDatasetArgs): Promise<DatasetRow[]> {
  switch (args.dataset) {
    case "sales":
      return buildSalesDataset(args);
    case "expense":
      return buildExpenseDataset(args);
    case "purchase":
      return buildPurchaseDataset(args);
  }
}

function toIsoDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function buildSalesDataset({ restaurantId, dateFrom, dateTo }: BuildDatasetArgs): Promise<DatasetRow[]> {
  const fromDt = new Date(`${dateFrom}T00:00:00.000Z`);
  const toDt = new Date(`${dateTo}T23:59:59.999Z`);
  const orders = await db
    .select()
    .from(ordersTable)
    .where(and(
      eq(ordersTable.restaurantId, restaurantId),
      gte(ordersTable.createdAt, fromDt),
      lte(ordersTable.createdAt, toDt),
    ))
    .orderBy(asc(ordersTable.createdAt));

  const orderIds = orders.map((o) => o.id);
  const items = orderIds.length
    ? await db.select().from(orderItemsTable).where(
        // drizzle-orm inArray import to avoid: but use eq+or path
        // (we keep it simple via per-order map below)
        eq(orderItemsTable.orderId, orderIds[0]!),
      )
    : [];
  // Replace single-id query with full inArray when we have items
  let allItems = items;
  if (orderIds.length > 1) {
    const { inArray } = await import("drizzle-orm");
    allItems = await db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, orderIds));
  }
  const itemsByOrder = new Map<number, typeof allItems>();
  for (const it of allItems) {
    const arr = itemsByOrder.get(it.orderId) ?? [];
    arr.push(it);
    itemsByOrder.set(it.orderId, arr);
  }

  return orders.map((o) => {
    const orderItems = itemsByOrder.get(o.id) ?? [];
    const description = orderItems
      .map((it) => `${it.quantity}× ${it.menuItemName}`)
      .join(", ")
      .slice(0, 500) || `Order ${o.orderNumber}`;
    const subtotal = num(o.subtotal);
    const tax = num(o.taxAmount);
    const total = num(o.totalAmount);
    const taxRate = subtotal > 0 ? Math.round((tax / subtotal) * 10000) / 100 : 0;
    const ledger = `sales:${o.orderType}`;
    return {
      date: toIsoDate(o.createdAt),
      reference: o.orderNumber,
      party: o.customerName ?? "Walk-in customer",
      ledger,
      taxCode: tax > 0 ? `gst:${taxRate}` : "",
      amount: subtotal,
      taxAmount: tax,
      total,
      description,
      sourceId: o.id,
      meta: {
        orderType: o.orderType,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        serviceCharge: num(o.serviceCharge),
        discountAmount: num(o.discountAmount),
        items: orderItems.map((it) => ({
          name: it.menuItemName,
          quantity: it.quantity,
          unitPrice: num(it.unitPrice),
          totalPrice: num(it.totalPrice),
        })),
      },
    };
  });
}

async function buildExpenseDataset({ restaurantId, dateFrom, dateTo }: BuildDatasetArgs): Promise<DatasetRow[]> {
  const rows = await db
    .select({
      id: expensesTable.id,
      amount: expensesTable.amount,
      expenseDate: expensesTable.expenseDate,
      payee: expensesTable.payee,
      paymentMethod: expensesTable.paymentMethod,
      notes: expensesTable.notes,
      categoryName: expenseCategoriesTable.name,
    })
    .from(expensesTable)
    .leftJoin(expenseCategoriesTable, eq(expensesTable.categoryId, expenseCategoriesTable.id))
    .where(and(
      eq(expensesTable.restaurantId, restaurantId),
      gte(expensesTable.expenseDate, dateFrom),
      lte(expensesTable.expenseDate, dateTo),
    ))
    .orderBy(asc(expensesTable.expenseDate));

  return rows.map((r) => {
    const total = num(r.amount);
    const ledger = `expense:${r.categoryName ?? "uncategorized"}`;
    return {
      date: r.expenseDate,
      reference: `EXP-${r.id}`,
      party: r.payee ?? "",
      ledger,
      taxCode: "",
      amount: total,
      taxAmount: 0,
      total,
      description: r.notes ?? r.categoryName ?? "Expense",
      sourceId: r.id,
      meta: {
        category: r.categoryName,
        paymentMethod: r.paymentMethod,
      },
    };
  });
}

async function buildPurchaseDataset({ restaurantId, dateFrom, dateTo }: BuildDatasetArgs): Promise<DatasetRow[]> {
  const fromDt = new Date(`${dateFrom}T00:00:00.000Z`);
  const toDt = new Date(`${dateTo}T23:59:59.999Z`);
  const pos = await db
    .select({
      po: purchaseOrdersTable,
      supplierName: suppliersTable.name,
    })
    .from(purchaseOrdersTable)
    .leftJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
    .where(and(
      eq(purchaseOrdersTable.restaurantId, restaurantId),
      gte(purchaseOrdersTable.createdAt, fromDt),
      lte(purchaseOrdersTable.createdAt, toDt),
    ))
    .orderBy(asc(purchaseOrdersTable.createdAt));

  const poIds = pos.map((r) => r.po.id);
  let allItems: Array<typeof purchaseOrderItemsTable.$inferSelect> = [];
  if (poIds.length) {
    const { inArray } = await import("drizzle-orm");
    allItems = await db.select().from(purchaseOrderItemsTable).where(inArray(purchaseOrderItemsTable.purchaseOrderId, poIds));
  }
  const itemsByPo = new Map<number, typeof allItems>();
  for (const it of allItems) {
    const arr = itemsByPo.get(it.purchaseOrderId) ?? [];
    arr.push(it);
    itemsByPo.set(it.purchaseOrderId, arr);
  }

  return pos.map(({ po, supplierName }) => {
    const items = itemsByPo.get(po.id) ?? [];
    const total = num(po.totalAmount);
    const description = items.map((it) => `${num(it.quantity)} ${it.unit} ${it.name}`).join(", ").slice(0, 500) || `PO ${po.id}`;
    return {
      date: toIsoDate(po.createdAt),
      reference: `PO-${po.id}`,
      party: supplierName ?? "",
      ledger: "purchase:inventory",
      taxCode: "",
      amount: total,
      taxAmount: 0,
      total,
      description,
      sourceId: po.id,
      meta: {
        status: po.status,
        paidAmount: num(po.paidAmount),
        items: items.map((it) => ({
          name: it.name,
          unit: it.unit,
          quantity: num(it.quantity),
          costPerUnit: num(it.costPerUnit),
        })),
      },
    };
  });
}
