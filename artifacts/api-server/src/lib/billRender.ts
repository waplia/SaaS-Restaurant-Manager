/**
 * Task #674 — Unified bill renderer.
 *
 * Given a frozen `BillSnapshot` and a `BillTemplate`, produces:
 *   • An HTML document suitable for browser print (thermal, A5, A4)
 *   • A plain-text ESC/POS rendering for the desktop bridge / network printers
 *
 * Centralising rendering here means every channel (web POS, desktop POS,
 * mobile, QR, share, email) reads the SAME bytes for the SAME order, so
 * reprints are byte-identical and the admin template editor's preview shows
 * exactly what a printer / customer will see.
 */
import type { BillSnapshot } from "./billSnapshot";
import type { BillTemplate, BillTemplateLayout } from "@workspace/db/schema";

const escapeHtml = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function money(n: number, currency = "INR"): string {
  const sym = currency === "INR" ? "\u20B9" : "";
  return `${sym}${(Number.isFinite(n) ? n : 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(iso: string | null | undefined, tz = "Asia/Kolkata"): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-IN", { timeZone: tz });
  } catch {
    return new Date(iso).toLocaleString("en-IN");
  }
}

export interface RenderOptions {
  /** Optional pre-built data URL for the UPI QR. The renderer doesn't fetch
   *  QR libraries server-side — pass it in when needed. */
  upiQrDataUrl?: string | null;
  /** Force-add a watermark (used by the editor preview / "TEST INVOICE"). */
  watermark?: string | null;
}

/**
 * Render a snapshot + template into a self-contained HTML document.
 */
export function renderBillHTML(
  snapshot: BillSnapshot,
  template: BillTemplate,
  opts: RenderOptions = {},
): string {
  const layout: BillTemplateLayout = template.layout ?? {};
  const paper = template.paperSize;
  const isThermal58 = paper === "thermal_58";
  const isThermal80 = paper === "thermal_80";
  const isThermal = isThermal58 || isThermal80;
  const paperWidth = isThermal58 ? "58mm" : isThermal80 ? "80mm" : paper === "a4" ? "210mm" : "148mm";
  const isKot = !!layout.isKot;
  const docTitle = layout.title || (snapshot.payment ? "Tax Invoice" : "Receipt");
  const currency = snapshot.restaurant.currency || "INR";

  const restName = snapshot.restaurant.name || "";
  const headerBits: string[] = [];
  if (snapshot.outlet.name) headerBits.push(snapshot.outlet.name);
  const addr = snapshot.outlet.address || snapshot.restaurant.address;
  if (addr) headerBits.push(addr);
  const phone = snapshot.outlet.phone || snapshot.restaurant.phone;
  if (phone) headerBits.push(`Tel: ${phone}`);
  if (layout.showGstin !== false && snapshot.restaurant.gstin) {
    headerBits.push(`GSTIN: ${snapshot.restaurant.gstin}`);
  }
  for (const line of layout.headerLines ?? []) headerBits.push(line);

  const itemRows = snapshot.items
    .map(it => {
      const mods = layout.showModifiers !== false
        ? (it.modifiers ?? [])
            .map(m => `<div class="mod"><span>+ ${escapeHtml(m.name)}</span><span class="num">${m.price ? money(m.price, currency) : ""}</span></div>`)
            .join("")
        : "";
      const notes = layout.showItemNotes !== false && it.notes
        ? `<div class="notes">${escapeHtml(it.notes)}</div>`
        : "";
      if (isThermal) {
        if (isKot) {
          return `
            <div class="row item bold"><span class="iname">${it.quantity}\u00d7 ${escapeHtml(it.name)}</span></div>
            ${mods}${notes}`;
        }
        return `
          <div class="row item">
            <span class="iname">${escapeHtml(it.name)} \u00d7${it.quantity}</span>
            <span class="num">${money(it.lineTotal, currency)}</span>
          </div>
          ${mods}${notes}`;
      }
      if (isKot) {
        return `<tr><td colspan="4"><div class="iname">${it.quantity}\u00d7 ${escapeHtml(it.name)}</div>${mods}${notes}</td></tr>`;
      }
      return `
        <tr>
          <td><div class="iname">${escapeHtml(it.name)}</div>${mods}${notes}</td>
          <td class="num">${it.quantity}</td>
          <td class="num">${money(it.unitPrice, currency)}</td>
          <td class="num">${money(it.lineTotal, currency)}</td>
        </tr>`;
    })
    .join("");

  const itemsBlock = isThermal
    ? `<div class="sep"></div>
       ${isKot ? "" : `<div class="row col-head"><span>ITEM</span><span>AMT</span></div><div class="sep"></div>`}
       ${itemRows}
       <div class="sep"></div>`
    : `<table class="items">
        <thead>
          <tr>
            <th>Item</th>
            ${isKot ? "" : `<th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th>`}
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>`;

  // Totals block — skipped entirely on KOT templates.
  const totals = snapshot.totals;
  const totalsRows: string[] = [];
  if (!isKot) {
    totalsRows.push(`<div class="row"><span>Subtotal</span><span class="num">${money(totals.subtotal, currency)}</span></div>`);
    if (snapshot.discounts.length > 0) {
      for (const d of snapshot.discounts) {
        totalsRows.push(`<div class="row"><span>${escapeHtml(d.label)}</span><span class="num">-${money(d.amount, currency)}</span></div>`);
      }
    } else if (totals.discountAmount > 0) {
      totalsRows.push(`<div class="row"><span>Discount</span><span class="num">-${money(totals.discountAmount, currency)}</span></div>`);
    }
    if (totals.serviceCharge > 0) {
      totalsRows.push(`<div class="row"><span>Service Charge</span><span class="num">${money(totals.serviceCharge, currency)}</span></div>`);
    }
    if (totals.deliveryFee > 0) {
      totalsRows.push(`<div class="row"><span>Delivery</span><span class="num">${money(totals.deliveryFee, currency)}</span></div>`);
    }
    if (layout.showTaxBreakdown !== false && totals.taxBreakdown.length > 0) {
      for (const t of totals.taxBreakdown) {
        totalsRows.push(`<div class="row"><span>Tax (${escapeHtml(t.rate)})</span><span class="num">${money(t.amount, currency)}</span></div>`);
      }
    } else if (totals.taxAmount > 0) {
      totalsRows.push(`<div class="row"><span>Tax</span><span class="num">${money(totals.taxAmount, currency)}</span></div>`);
    }
    if (totals.tipAmount > 0) {
      totalsRows.push(`<div class="row"><span>Tip</span><span class="num">${money(totals.tipAmount, currency)}</span></div>`);
    }
    if (totals.roundOff !== 0) {
      totalsRows.push(`<div class="row"><span>Round Off</span><span class="num">${totals.roundOff > 0 ? "+" : ""}${money(totals.roundOff, currency)}</span></div>`);
    }
  }

  const totalsBlock = isKot
    ? ""
    : `<div class="totals">
        ${totalsRows.join("")}
        <div class="sep"></div>
        <div class="row grand"><span>Grand Total</span><span class="num">${money(totals.grandTotal, currency)}</span></div>
      </div>`;

  const paymentBlock = !isKot && snapshot.payment
    ? `<div class="payment">
        <div class="row"><span>Payment</span><span>${escapeHtml(snapshot.payment.method.toUpperCase())}</span></div>
        ${snapshot.payment.tendered ? `<div class="row"><span>Tendered</span><span class="num">${money(snapshot.payment.tendered, currency)}</span></div>` : ""}
        ${snapshot.payment.change ? `<div class="row bold"><span>Change</span><span class="num">${money(snapshot.payment.change, currency)}</span></div>` : ""}
        ${snapshot.payment.reference ? `<div class="row sub"><span>Ref</span><span class="num">${escapeHtml(snapshot.payment.reference)}</span></div>` : ""}
      </div>`
    : "";

  const orderMetaBits: string[] = [];
  if (layout.showTableMeta !== false) {
    if (snapshot.order.tableLabel) orderMetaBits.push(snapshot.order.tableLabel);
    else if (snapshot.order.orderType) orderMetaBits.push(snapshot.order.orderType.replace(/_/g, " ").toUpperCase());
  }
  if (layout.showCustomer !== false && snapshot.order.customerName) {
    orderMetaBits.push(`Cust: ${snapshot.order.customerName}${snapshot.order.customerPhone ? ` \u00b7 ${snapshot.order.customerPhone}` : ""}`);
  }
  if (layout.showStaff !== false && snapshot.order.waiterName) {
    orderMetaBits.push(`Server: ${snapshot.order.waiterName}`);
  }

  const orderNumber = snapshot.order.orderDisplayNumber || snapshot.order.orderNumber;
  const headerHtml = `
    <div class="header center">
      ${layout.showLogo !== false && snapshot.restaurant.logoUrl ? `<img src="${escapeHtml(snapshot.restaurant.logoUrl)}" class="logo" alt=""/>` : ""}
      <div class="brand">${escapeHtml(restName)}</div>
      ${headerBits.length ? `<div class="sub">${headerBits.map(escapeHtml).join(isThermal ? "<br/>" : " \u00b7 ")}</div>` : ""}
      <div class="doctype">${escapeHtml(docTitle)}</div>
    </div>
    <div class="sep"></div>
    <div class="meta center">
      <div class="bold">#${escapeHtml(orderNumber)}</div>
      <div class="sub">${escapeHtml(fmtDate(snapshot.order.billGeneratedAt || snapshot.order.createdAt, snapshot.restaurant.timezone))}</div>
      ${orderMetaBits.length ? `<div class="sub">${orderMetaBits.map(escapeHtml).join(isThermal ? "<br/>" : " \u00b7 ")}</div>` : ""}
    </div>`;

  // UPI block — final visibility gated by restaurant.upiPrintQrMode.
  const upiMode = snapshot.restaurant.upiPrintQrMode || "all";
  const isPaid = snapshot.payment != null && snapshot.payment.status === "paid";
  let showQrByMode = true;
  if (upiMode === "unpaid") showQrByMode = !isPaid;
  else if (upiMode === "hide_after_paid") showQrByMode = !isPaid;
  else if (upiMode === "upi_online_only") showQrByMode = isPaid && /upi/i.test(snapshot.payment?.method ?? "");
  const wantsUpi =
    layout.showUpiQr !== false &&
    snapshot.restaurant.upiQrEnabled &&
    !!snapshot.restaurant.upiId &&
    !!opts.upiQrDataUrl &&
    showQrByMode &&
    !isKot;
  const upiBlock = wantsUpi
    ? `<div class="sep"></div>
       <div class="upi center">
         <div class="bold">${escapeHtml(snapshot.restaurant.upiQrLabel || "Scan to Pay")}</div>
         <img src="${escapeHtml(opts.upiQrDataUrl!)}" class="qr" alt="UPI QR"/>
         <div class="sub">Amount: ${money(totals.grandTotal, currency)}</div>
       </div>`
    : "";

  const fssaiLine = layout.showFssai !== false && snapshot.restaurant.fssaiLicense
    ? `<div class="footer center sub">FSSAI Lic: ${escapeHtml(snapshot.restaurant.fssaiLicense)}</div>`
    : "";
  const footerLines = layout.footerLines && layout.footerLines.length > 0
    ? layout.footerLines.map(l => `<div class="footer center">${escapeHtml(l)}</div>`).join("")
    : `<div class="footer center">Thank you!</div>`;
  const termsLine = layout.terms
    ? `<div class="footer center sub" style="margin-top:6px">${escapeHtml(layout.terms)}</div>`
    : "";
  const watermark = opts.watermark
    ? `<div class="watermark">${escapeHtml(opts.watermark)}</div>`
    : "";

  const accent = layout.accentColor || "#ea580c";

  const css = isThermal
    ? `
      @page { size: ${paperWidth} auto; margin: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { background: #fff; color: #000; }
      body { font-family: 'Courier New', ui-monospace, monospace; font-size: ${isThermal58 ? 11 : 12}px; width: ${paperWidth}; padding: 4mm 3mm; position: relative; }
      .center { text-align: center; }
      .bold { font-weight: 700; }
      .sep { border-top: 1px dashed #555; margin: 6px 0; }
      .row { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
      .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
      .header .logo { max-width: ${isThermal58 ? "44mm" : "60mm"}; max-height: ${isThermal58 ? "16mm" : "22mm"}; object-fit: contain; margin-bottom: 4px; }
      .brand { font-size: ${isThermal58 ? 14 : 16}px; font-weight: 700; }
      .doctype { margin-top: 2px; letter-spacing: .04em; text-transform: uppercase; }
      .sub { font-size: ${isThermal58 ? 10 : 11}px; color: #333; }
      .col-head { font-weight: 700; }
      .mod, .notes { padding-left: 8px; font-size: ${isThermal58 ? 10 : 11}px; color: #333; }
      .notes { font-style: italic; }
      .grand { font-size: ${isThermal58 ? 13 : 14}px; font-weight: 700; }
      .upi .qr { width: ${isThermal58 ? "40mm" : "50mm"}; height: ${isThermal58 ? "40mm" : "50mm"}; margin: 4px auto; display: block; image-rendering: pixelated; }
      .footer { margin-top: 6px; font-size: ${isThermal58 ? 10 : 11}px; }
      .watermark { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 32px; color: rgba(220,38,38,.15); transform: rotate(-20deg); pointer-events: none; }
    `
    : `
      @page { size: ${paper === "a4" ? "A4" : "A5"}; margin: ${paper === "a4" ? "14mm" : "10mm"}; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { background: #fff; color: #1a1a1a; }
      body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11pt; position: relative; }
      .num { font-variant-numeric: tabular-nums; font-family: 'SF Mono', Menlo, Consolas, monospace; white-space: nowrap; }
      .center { text-align: center; }
      .bold { font-weight: 700; }
      .header { margin-bottom: 14px; padding: 12px 14px; border-radius: 6px; background: ${accent}; color: #fff; text-align: center; }
      .header .logo { max-height: 22mm; max-width: 60mm; object-fit: contain; background: #fff; padding: 2px; border-radius: 4px; margin-bottom: 6px; }
      .brand { font-size: 16pt; font-weight: 700; }
      .doctype { font-size: 10pt; letter-spacing: .08em; text-transform: uppercase; opacity: .92; }
      .sub { font-size: 9pt; opacity: .92; }
      .meta { margin: 10px 0 12px; font-size: 10pt; color: #444; text-align: left; }
      .meta .bold { font-size: 13pt; }
      .sep { border-top: 1px solid #e5e5e5; margin: 8px 0; }
      .items { width: 100%; border-collapse: collapse; margin-top: 8px; }
      .items th, .items td { padding: 6px 8px; border-bottom: 1px solid #e5e5e5; vertical-align: top; text-align: left; }
      .items th { background: #f7f7f7; font-size: 9pt; text-transform: uppercase; letter-spacing: .04em; color: #555; }
      .items th.num, .items td.num { text-align: right; }
      .items .iname { font-weight: 600; }
      .mod { display: flex; justify-content: space-between; font-size: 9pt; color: #666; padding-left: 8px; }
      .notes { font-size: 9pt; color: #777; font-style: italic; padding-left: 8px; }
      .totals { margin-top: 12px; margin-left: auto; width: 60%; }
      .totals .row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 10pt; }
      .totals .sep { border-top: 1px solid #333; margin: 4px 0; }
      .totals .grand { font-size: 13pt; font-weight: 700; padding-top: 4px; }
      .payment { margin-top: 14px; padding: 8px 10px; border: 1px solid #e5e5e5; border-radius: 4px; }
      .upi { margin-top: 14px; padding: 10px; border: 1px dashed #999; border-radius: 6px; background: #fafafa; text-align: center; }
      .upi .qr { width: 38mm; height: 38mm; background: #fff; padding: 2px; }
      .footer { margin-top: 16px; font-size: 9pt; color: #666; text-align: center; }
      .watermark { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 80px; color: rgba(220,38,38,.12); transform: rotate(-25deg); pointer-events: none; }
      @media print { .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    `;

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<title>${escapeHtml(docTitle)} ${escapeHtml(orderNumber)}</title>
<style>${css}</style>
</head>
<body class="${isThermal ? "thermal" : "page"}">
${watermark}
${headerHtml}
${itemsBlock}
${totalsBlock}
${paymentBlock}
${upiBlock}
${footerLines}
${fssaiLine}
${termsLine}
</body></html>`;
}

/**
 * Plain-text rendering for ESC/POS network printers + the desktop bridge
 * fallback. Roughly 32 columns wide so it suits both 58mm (32 col) and 80mm
 * (42 col) printers. The desktop bridge can still call `formatBillText`
 * with its richer width-aware helpers; this lives here so the API render
 * endpoint can return a text variant alongside the HTML.
 */
export function renderBillText(snapshot: BillSnapshot, template: BillTemplate): string {
  const layout: BillTemplateLayout = template.layout ?? {};
  const isKot = !!layout.isKot;
  const width = template.paperSize === "thermal_58" ? 32 : 42;
  const lines: string[] = [];
  const center = (s: string) => {
    if (s.length >= width) return s;
    return " ".repeat(Math.floor((width - s.length) / 2)) + s;
  };
  const pad = (l: string, r: string) => {
    const space = Math.max(1, width - l.length - r.length);
    if (l.length + r.length >= width) return `${l}\n${" ".repeat(width - r.length)}${r}`;
    return `${l}${" ".repeat(space)}${r}`;
  };
  const dash = "-".repeat(width);

  if (snapshot.restaurant.name) lines.push(center(snapshot.restaurant.name));
  if (snapshot.outlet.address || snapshot.restaurant.address) {
    lines.push(center(snapshot.outlet.address || snapshot.restaurant.address || ""));
  }
  if (layout.showGstin !== false && snapshot.restaurant.gstin) {
    lines.push(center(`GSTIN: ${snapshot.restaurant.gstin}`));
  }
  lines.push(center(layout.title || (snapshot.payment ? "TAX INVOICE" : "RECEIPT")));
  lines.push(dash);
  lines.push(pad(`#${snapshot.order.orderDisplayNumber || snapshot.order.orderNumber}`, ""));
  if (snapshot.order.tableLabel) lines.push(snapshot.order.tableLabel);
  if (snapshot.order.customerName) {
    lines.push(`Cust: ${snapshot.order.customerName}${snapshot.order.customerPhone ? ` · ${snapshot.order.customerPhone}` : ""}`);
  }
  lines.push(dash);
  if (!isKot) lines.push(pad("ITEM", "AMT"));
  lines.push(dash);
  for (const it of snapshot.items) {
    if (isKot) {
      lines.push(`${it.quantity}x ${it.name}`);
    } else {
      lines.push(pad(`${it.quantity}x ${it.name}`, it.lineTotal.toFixed(2)));
    }
    for (const m of it.modifiers ?? []) {
      lines.push(`   + ${m.name}`);
    }
    if (layout.showItemNotes !== false && it.notes) {
      lines.push(`   * ${it.notes}`);
    }
  }
  lines.push(dash);
  if (!isKot) {
    lines.push(pad("Subtotal", snapshot.totals.subtotal.toFixed(2)));
    for (const d of snapshot.discounts) {
      lines.push(pad(d.label, `-${d.amount.toFixed(2)}`));
    }
    if (snapshot.discounts.length === 0 && snapshot.totals.discountAmount > 0) {
      lines.push(pad("Discount", `-${snapshot.totals.discountAmount.toFixed(2)}`));
    }
    if (snapshot.totals.serviceCharge > 0) lines.push(pad("Service", snapshot.totals.serviceCharge.toFixed(2)));
    if (snapshot.totals.taxAmount > 0) lines.push(pad("Tax", snapshot.totals.taxAmount.toFixed(2)));
    lines.push(dash);
    lines.push(pad("TOTAL", snapshot.totals.grandTotal.toFixed(2)));
  }
  if (snapshot.payment) {
    lines.push("");
    lines.push(pad("Payment", snapshot.payment.method.toUpperCase()));
  }
  if (layout.showFssai !== false && snapshot.restaurant.fssaiLicense) {
    lines.push(center(`FSSAI: ${snapshot.restaurant.fssaiLicense}`));
  }
  for (const f of layout.footerLines ?? []) lines.push(center(f));
  return lines.join("\n") + "\n";
}
