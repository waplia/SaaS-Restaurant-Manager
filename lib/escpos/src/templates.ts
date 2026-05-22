/**
 * Typed payloads + renderers for the three ESC/POS document types we print:
 *   - Customer bill / invoice  (with optional UPI QR)
 *   - Kitchen Order Ticket     (never carries prices / tax / discounts / QR)
 *   - Token                    (order/token reference for pickup or delivery)
 *
 * All renderers return an `EscPosBuilder` ready for `.bytes()` / `.base64()`.
 */
import { EscPosBuilder, widthForPaper, type Alignment } from "./bytes";
import { buildUpiPayUrl } from "./upi-qr";

export type PrinterPaperSize = "58mm" | "80mm";

export interface BillItem {
  name: string;
  qty: number;
  rate: number;
  amount: number;
  modifiers?: string[];
  notes?: string;
}

export interface BillPayload {
  paperSize: PrinterPaperSize;
  charactersPerLine?: number;
  copies?: number;
  feedLines?: number;
  cutPaper?: boolean;
  cashDrawerKick?: boolean;
  buzzer?: boolean;
  copyLabel?: string; // e.g. "DUPLICATE", "REPRINT"

  restaurantName: string;
  restaurantTagline?: string;
  outletName?: string;
  outletAddress?: string;
  gstin?: string;
  fssai?: string;
  contactPhone?: string;
  contactEmail?: string;

  invoiceNumber: string;
  orderNumber?: string;
  tableLabel?: string;
  customerName?: string;
  customerPhone?: string;
  cashierName?: string;
  printedAt: string; // ISO

  items: BillItem[];

  subTotal: number;
  discount?: number;
  discountLabel?: string;
  taxes?: Array<{ label: string; amount: number }>;
  serviceCharge?: number;
  packingCharge?: number;
  deliveryCharge?: number;
  roundOff?: number;
  grandTotal: number;

  paymentStatus?: "paid" | "unpaid" | "partial";
  paymentMode?: string;
  amountPaid?: number;
  amountDue?: number;

  upi?: { vpa: string; payeeName?: string; enabled: boolean };
  thankYouMessage?: string;
  footerLines?: string[];
}

export interface KotItem {
  name: string;
  qty: number;
  modifiers?: string[];
  notes?: string;
  status?: "new" | "modified" | "cancelled";
}

export interface KotPayload {
  paperSize: PrinterPaperSize;
  charactersPerLine?: number;
  copies?: number;
  feedLines?: number;
  cutPaper?: boolean;

  kotNumber: string;
  orderNumber?: string;
  tableLabel?: string;
  customerName?: string;
  orderType?: string; // dine-in/takeaway/delivery
  waiterName?: string;
  stationName?: string;
  priority?: "normal" | "rush" | "vip";
  marker?: "new" | "modified" | "cancelled";

  items: KotItem[];
  printedAt: string;
}

export interface TokenPayload {
  paperSize: PrinterPaperSize;
  charactersPerLine?: number;
  copies?: number;
  feedLines?: number;
  cutPaper?: boolean;

  tokenNumber: string;
  orderNumber?: string;
  customerName?: string;
  customerPhone?: string;
  orderType?: "pickup" | "delivery" | "dine-in";
  itemsSummary?: string[];
  restaurantName?: string;
  printedAt: string;
}

const money = (n: number | undefined, locale = "en-IN", currency = "INR"): string => {
  if (n == null || !Number.isFinite(n)) return "";
  try {
    return n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return n.toFixed(2);
  }
};

export function renderBill(p: BillPayload): EscPosBuilder {
  const width = widthForPaper(p.paperSize, p.charactersPerLine);
  const b = new EscPosBuilder({ width });
  b.init();

  b.align("center").size("double").bold(true).line(p.restaurantName);
  b.size("normal").bold(false);
  if (p.restaurantTagline) b.line(p.restaurantTagline);
  if (p.outletName) b.line(p.outletName);
  if (p.outletAddress) b.line(p.outletAddress);
  if (p.contactPhone) b.line("Tel: " + p.contactPhone);
  if (p.gstin) b.line("GSTIN: " + p.gstin);
  if (p.fssai) b.line("FSSAI: " + p.fssai);

  if (p.copyLabel) {
    b.feed(1).align("center").bold(true).line(`*** ${p.copyLabel} ***`).bold(false);
  }

  b.feed(1).align("left").hr();
  b.row("Invoice", p.invoiceNumber);
  if (p.orderNumber) b.row("Order", p.orderNumber);
  if (p.tableLabel) b.row("Table", p.tableLabel);
  if (p.customerName) b.row("Customer", p.customerName);
  if (p.customerPhone) b.row("Phone", p.customerPhone);
  if (p.cashierName) b.row("Cashier", p.cashierName);
  b.row("Date", new Date(p.printedAt).toLocaleString());
  b.hr();

  b.bold(true).item("Item", "Qty", "Amount").bold(false);
  b.hr();
  for (const it of p.items) {
    b.item(it.name, String(it.qty), money(it.amount));
    if (it.modifiers && it.modifiers.length) {
      for (const m of it.modifiers) b.line(" + " + m);
    }
    if (it.notes) b.line("  * " + it.notes);
  }
  b.hr();

  b.row("Subtotal", money(p.subTotal));
  if (p.discount && p.discount > 0) {
    b.row(p.discountLabel ?? "Discount", "-" + money(p.discount));
  }
  if (p.taxes) {
    for (const t of p.taxes) b.row(t.label, money(t.amount));
  }
  if (p.serviceCharge) b.row("Service Charge", money(p.serviceCharge));
  if (p.packingCharge) b.row("Packing", money(p.packingCharge));
  if (p.deliveryCharge) b.row("Delivery", money(p.deliveryCharge));
  if (p.roundOff) b.row("Round Off", money(p.roundOff));

  b.bold(true).size("double-height").row("TOTAL", money(p.grandTotal)).size("normal").bold(false);

  if (p.paymentStatus) {
    b.feed(1);
    const label = p.paymentStatus === "paid" ? "PAID" : p.paymentStatus === "partial" ? "PARTIAL" : "UNPAID";
    b.align("center").bold(true).line(label + (p.paymentMode ? `  (${p.paymentMode})` : "")).bold(false);
    if (p.paymentStatus === "partial" && p.amountDue != null) {
      b.row("Balance Due", money(p.amountDue));
    }
  }

  // UPI QR — bill only. Never on KOT.
  if (p.upi?.enabled) {
    if (!p.upi.vpa) {
      b.feed(1).align("center").line("(UPI QR unavailable — VPA not configured)");
    } else {
      const url = buildUpiPayUrl({
        vpa: p.upi.vpa,
        name: p.upi.payeeName ?? p.restaurantName,
        amount: p.grandTotal,
        ref: p.invoiceNumber,
        note: `Bill ${p.invoiceNumber}`,
      });
      b.feed(1).align("center").bold(true).line("Scan to Pay via UPI").bold(false);
      b.qr(url, { size: p.paperSize === "58mm" ? 6 : 8, ecLevel: 1 });
      b.align("center").line(p.upi.vpa);
    }
  }

  if (p.thankYouMessage) {
    b.feed(1).align("center").line(p.thankYouMessage);
  } else {
    b.feed(1).align("center").line("Thank you. Visit again!");
  }
  if (p.footerLines) for (const fl of p.footerLines) b.align("center").line(fl);

  b.feed(p.feedLines ?? 3);
  if (p.cashDrawerKick) b.drawerKick(2);
  if (p.buzzer) b.buzzer();
  if (p.cutPaper !== false) b.cut(true);
  return b;
}

export function renderKot(p: KotPayload): EscPosBuilder {
  const width = widthForPaper(p.paperSize, p.charactersPerLine);
  const b = new EscPosBuilder({ width });
  b.init();

  // Header banner — large, easy to read across the pass
  const marker = p.marker ?? "new";
  const banner = marker === "modified" ? "*** MODIFIED ***"
    : marker === "cancelled" ? "*** CANCELLED ***"
    : "KITCHEN ORDER";
  b.align("center").size("double").bold(true).line(banner).size("normal").bold(false);

  if (p.stationName) b.align("center").line("Station: " + p.stationName);
  if (p.priority && p.priority !== "normal") {
    b.align("center").bold(true).line(p.priority === "rush" ? "RUSH" : "VIP").bold(false);
  }

  b.feed(1).align("left").hr();
  b.row("KOT", p.kotNumber);
  if (p.orderNumber) b.row("Order", p.orderNumber);
  if (p.tableLabel) b.row("Table", p.tableLabel);
  if (p.customerName) b.row("Customer", p.customerName);
  if (p.orderType) b.row("Type", p.orderType);
  if (p.waiterName) b.row("Waiter", p.waiterName);
  b.row("Time", new Date(p.printedAt).toLocaleTimeString());
  b.hr();

  for (const it of p.items) {
    const qtyStr = `x${it.qty}`;
    const namePadded = it.name;
    b.size("double-height").bold(true)
      .item(namePadded, qtyStr, it.status === "cancelled" ? "CXL" : it.status === "modified" ? "MOD" : "")
      .size("normal").bold(false);
    if (it.modifiers && it.modifiers.length) {
      for (const m of it.modifiers) b.line(" + " + m);
    }
    if (it.notes) b.line("  * " + it.notes);
    b.feed(1);
  }

  b.hr();
  b.feed(p.feedLines ?? 3);
  if (p.cutPaper !== false) b.cut(true);
  return b;
}

export function renderToken(p: TokenPayload): EscPosBuilder {
  const width = widthForPaper(p.paperSize, p.charactersPerLine);
  const b = new EscPosBuilder({ width });
  b.init();

  if (p.restaurantName) b.align("center").bold(true).line(p.restaurantName).bold(false);
  b.feed(1).align("center").line("YOUR TOKEN");
  b.size("double").bold(true).align("center").line(p.tokenNumber).size("normal").bold(false);

  b.feed(1).align("left").hr();
  if (p.orderNumber) b.row("Order", p.orderNumber);
  if (p.customerName) b.row("Customer", p.customerName);
  if (p.customerPhone) b.row("Phone", p.customerPhone);
  if (p.orderType) b.row("Type", p.orderType);
  b.row("Time", new Date(p.printedAt).toLocaleTimeString());
  b.hr();

  if (p.itemsSummary && p.itemsSummary.length) {
    for (const s of p.itemsSummary) b.line(s);
    b.hr();
  }
  b.align("center").line("Please wait for your token to be called.");
  b.feed(p.feedLines ?? 3);
  if (p.cutPaper !== false) b.cut(true);
  return b;
}

/** Convenience helper used by Test Center. */
export function renderTestPrint(paperSize: PrinterPaperSize, name: string): EscPosBuilder {
  const b = new EscPosBuilder({ width: widthForPaper(paperSize) });
  b.init();
  b.align("center").size("double").bold(true).line("TEST PRINT").size("normal").bold(false);
  b.feed(1).align("left").hr();
  b.row("Printer", name);
  b.row("Paper", paperSize);
  b.row("Time", new Date().toLocaleString());
  b.hr();
  b.line("ASCII: !\"#$%&'()*+,-./0123456789");
  b.line("Hindi: नमस्ते दुनिया");
  b.line("Long item name — Paneer Tikka Masala with Garlic Naan and Raita");
  b.feed(1).align("center").line("If you can read this, ESC/POS works.");
  b.feed(3).cut(true);
  return b;
}

export type AnyPrintPayload =
  | { type: "bill"; payload: BillPayload }
  | { type: "kot"; payload: KotPayload }
  | { type: "token"; payload: TokenPayload }
  | { type: "test"; payload: { paperSize: PrinterPaperSize; name: string } };

export function renderPayload(p: AnyPrintPayload): EscPosBuilder {
  switch (p.type) {
    case "bill":  return renderBill(p.payload);
    case "kot":   return renderKot(p.payload);
    case "token": return renderToken(p.payload);
    case "test":  return renderTestPrint(p.payload.paperSize, p.payload.name);
  }
}

export type { Alignment };
