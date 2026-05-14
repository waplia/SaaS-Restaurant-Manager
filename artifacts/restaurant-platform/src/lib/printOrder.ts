export type PrintSize = "thermal-80mm" | "a5";

export interface PrintModifier {
  name: string;
  price: number;
}

export interface PrintLineItem {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  modifiers?: PrintModifier[];
  notes?: string | null;
}

export interface PrintRestaurant {
  name?: string | null;
  logoUrl?: string | null;
  address?: string | null;
  phone?: string | null;
  gstin?: string | null;
}

export interface PrintPayment {
  method: string;
  tendered?: number;
  change?: number;
}

export interface PrintOrderArgs {
  size: PrintSize;
  documentTitle?: string;
  orderNumber: string;
  createdAt?: string | Date;
  tableLabel?: string;
  orderType?: string;
  customerName?: string | null;
  customerPhone?: string | null;
  items: PrintLineItem[];
  subtotal: number;
  taxAmount: number;
  serviceCharge: number;
  discountAmount: number;
  totalAmount: number;
  taxBreakdown?: { rate: string; amount: number }[];
  /**
   * Optional per-line discount breakdown (T5). When provided, the receipt
   * renders one row per discount labelled with its reason; otherwise it falls
   * back to the legacy single "Discount" line driven by `discountAmount`.
   */
  discounts?: { label: string; amount: number }[];
  payment?: PrintPayment;
  splitIndex?: number;
  splitTotal?: number;
  restaurant?: PrintRestaurant;
  footer?: string;
}

const escapeHtml = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const money = (n: number): string =>
  `₹${(Number.isFinite(n) ? n : 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDate = (d: string | Date | undefined): string => {
  if (!d) return new Date().toLocaleString("en-IN");
  const dt = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(dt.getTime())
    ? new Date().toLocaleString("en-IN")
    : dt.toLocaleString("en-IN");
};

function buildOrderPrintHTML(args: PrintOrderArgs): string {
  const {
    size,
    documentTitle,
    orderNumber,
    createdAt,
    tableLabel,
    orderType,
    customerName,
    customerPhone,
    items,
    subtotal,
    taxAmount,
    serviceCharge,
    discountAmount,
    totalAmount,
    taxBreakdown,
    discounts,
    payment,
    splitIndex,
    splitTotal,
    restaurant,
    footer,
  } = args;

  const isThermal = size === "thermal-80mm";
  const displayTotal = splitTotal ?? totalAmount;
  const change = payment?.tendered != null
    ? Math.max(0, payment.tendered - displayTotal)
    : payment?.change ?? 0;

  const docTitle =
    documentTitle ??
    (payment?.method && payment.method !== "pending" ? "Tax Invoice" : "Receipt");

  const restName = restaurant?.name || "TableTrack";
  const subHeaderBits: string[] = [];
  if (restaurant?.address) subHeaderBits.push(restaurant.address);
  if (restaurant?.phone) subHeaderBits.push(`Tel: ${restaurant.phone}`);
  if (restaurant?.gstin) subHeaderBits.push(`GSTIN: ${restaurant.gstin}`);

  const itemRows = items
    .map((it) => {
      const modHtml = (it.modifiers ?? [])
        .map(
          (m) =>
            `<div class="mod"><span>+ ${escapeHtml(m.name)}</span><span class="num">${money(m.price)}</span></div>`
        )
        .join("");
      const notesHtml = it.notes
        ? `<div class="notes">${escapeHtml(it.notes)}</div>`
        : "";
      if (isThermal) {
        return `
          <div class="row item">
            <span class="iname">${escapeHtml(it.name)} ×${it.quantity}</span>
            <span class="num">${money(it.lineTotal)}</span>
          </div>
          ${modHtml}${notesHtml}`;
      }
      return `
        <tr>
          <td>
            <div class="iname">${escapeHtml(it.name)}</div>
            ${modHtml ? `<div class="mods">${modHtml}</div>` : ""}
            ${notesHtml}
          </td>
          <td class="num">${it.quantity}</td>
          <td class="num">${money(it.unitPrice)}</td>
          <td class="num">${money(it.lineTotal)}</td>
        </tr>`;
    })
    .join("");

  const itemsBlock = isThermal
    ? `
      <div class="sep"></div>
      <div class="row col-head"><span>ITEM</span><span>AMT</span></div>
      <div class="sep"></div>
      ${itemRows}
      <div class="sep"></div>`
    : `
      <table class="items">
        <thead>
          <tr>
            <th>Item</th>
            <th class="num">Qty</th>
            <th class="num">Unit</th>
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>`;

  const totalsRows: string[] = [
    `<div class="row"><span>Subtotal</span><span class="num">${money(subtotal)}</span></div>`,
  ];
  if (discounts && discounts.length > 0) {
    for (const d of discounts) {
      if (!(d.amount > 0)) continue;
      totalsRows.push(
        `<div class="row"><span>${escapeHtml(d.label || "Discount")}</span><span class="num">-${money(d.amount)}</span></div>`
      );
    }
  } else if (discountAmount > 0) {
    totalsRows.push(
      `<div class="row"><span>Discount</span><span class="num">-${money(discountAmount)}</span></div>`
    );
  }
  if (serviceCharge > 0)
    totalsRows.push(
      `<div class="row"><span>Service Charge</span><span class="num">${money(serviceCharge)}</span></div>`
    );
  if (taxBreakdown && taxBreakdown.length > 0) {
    for (const t of taxBreakdown) {
      totalsRows.push(
        `<div class="row"><span>Tax (${escapeHtml(t.rate)})</span><span class="num">${money(t.amount)}</span></div>`
      );
    }
  } else if (taxAmount > 0) {
    totalsRows.push(
      `<div class="row"><span>Tax</span><span class="num">${money(taxAmount)}</span></div>`
    );
  }

  const grandLabel = splitIndex !== undefined ? `Your Share (Split ${splitIndex + 1})` : "Grand Total";
  const totalsBlock = `
    <div class="totals">
      ${totalsRows.join("")}
      <div class="sep"></div>
      <div class="row grand"><span>${grandLabel}</span><span class="num">${money(displayTotal)}</span></div>
    </div>`;

  const paymentBlock = payment
    ? `
      <div class="payment">
        <div class="row"><span>Payment</span><span>${escapeHtml(payment.method.toUpperCase())}</span></div>
        ${payment.tendered != null ? `<div class="row"><span>Tendered</span><span class="num">${money(payment.tendered)}</span></div>` : ""}
        ${change > 0 ? `<div class="row bold"><span>Change</span><span class="num">${money(change)}</span></div>` : ""}
      </div>`
    : "";

  const headerMeta = [
    tableLabel || (orderType ? orderType.replace(/_/g, " ").toUpperCase() : ""),
    customerName ? `Customer: ${escapeHtml(customerName)}${customerPhone ? ` · ${escapeHtml(customerPhone)}` : ""}` : "",
  ]
    .filter(Boolean)
    .join(isThermal ? "<br/>" : " &nbsp;·&nbsp; ");

  const headerHtml = isThermal
    ? `
      <div class="header center">
        ${restaurant?.logoUrl ? `<img src="${escapeHtml(restaurant.logoUrl)}" class="logo" alt=""/>` : ""}
        <div class="brand">${escapeHtml(restName)}</div>
        ${subHeaderBits.length ? `<div class="sub">${subHeaderBits.map(escapeHtml).join("<br/>")}</div>` : ""}
        <div class="doctype">${escapeHtml(docTitle)}</div>
      </div>
      <div class="sep"></div>
      <div class="meta center">
        <div class="bold">${escapeHtml(orderNumber)}${splitIndex !== undefined ? ` · Split ${splitIndex + 1}` : ""}</div>
        <div class="sub">${escapeHtml(formatDate(createdAt))}</div>
        ${headerMeta ? `<div class="sub">${headerMeta}</div>` : ""}
      </div>`
    : `
      <div class="header">
        <div class="brand-bar">
          <div class="brand-left">
            ${restaurant?.logoUrl ? `<img src="${escapeHtml(restaurant.logoUrl)}" class="logo" alt=""/>` : ""}
            <div>
              <div class="brand">${escapeHtml(restName)}</div>
              ${subHeaderBits.length ? `<div class="sub">${subHeaderBits.map(escapeHtml).join(" · ")}</div>` : ""}
            </div>
          </div>
          <div class="brand-right">
            <div class="doctype">${escapeHtml(docTitle)}</div>
            <div class="sub">${escapeHtml(orderNumber)}${splitIndex !== undefined ? ` · Split ${splitIndex + 1}` : ""}</div>
            <div class="sub">${escapeHtml(formatDate(createdAt))}</div>
          </div>
        </div>
        ${headerMeta ? `<div class="meta-row">${headerMeta}</div>` : ""}
      </div>`;

  const footerHtml = `<div class="footer center">${escapeHtml(footer ?? "Thank you for dining with us!")}</div>`;

  const css = isThermal
    ? `
      @page { size: 80mm auto; margin: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { background: #fff; color: #000; }
      body { font-family: 'Courier New', ui-monospace, monospace; font-size: 12px; width: 80mm; padding: 6mm 4mm; }
      .center { text-align: center; }
      .bold { font-weight: 700; }
      .sep { border-top: 1px dashed #555; margin: 6px 0; }
      .row { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
      .num { font-variant-numeric: tabular-nums; font-family: 'Courier New', ui-monospace, monospace; white-space: nowrap; }
      .header .logo { max-width: 60mm; max-height: 22mm; object-fit: contain; margin-bottom: 4px; }
      .brand { font-size: 16px; font-weight: 700; }
      .doctype { font-size: 12px; margin-top: 2px; letter-spacing: .04em; text-transform: uppercase; }
      .sub { font-size: 11px; color: #333; }
      .meta { margin: 2px 0; }
      .col-head { font-size: 11px; font-weight: 700; }
      .item .iname { flex: 1; }
      .mod { display: flex; justify-content: space-between; font-size: 11px; color: #333; padding-left: 8px; }
      .notes { font-size: 11px; color: #555; padding-left: 8px; font-style: italic; }
      .totals { margin-top: 4px; }
      .grand { font-size: 14px; font-weight: 700; }
      .payment { margin-top: 4px; }
      .footer { margin-top: 8px; font-size: 11px; }
      @media print { body { width: 80mm; } }
    `
    : `
      @page { size: A5; margin: 10mm; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { background: #fff; color: #1a1a1a; }
      body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11pt; padding: 0; }
      .num { font-variant-numeric: tabular-nums; font-family: 'SF Mono', 'Menlo', Consolas, monospace; white-space: nowrap; }
      .center { text-align: center; }
      .bold { font-weight: 700; }
      .header { margin-bottom: 14px; }
      .brand-bar { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 12px 14px; border-radius: 6px; background: #ea580c; color: #fff; }
      .brand-left { display: flex; align-items: center; gap: 12px; }
      .brand-right { text-align: right; }
      .logo { max-width: 22mm; max-height: 16mm; object-fit: contain; background: #fff; padding: 2px; border-radius: 4px; }
      .brand { font-size: 16pt; font-weight: 700; line-height: 1.1; }
      .doctype { font-size: 10pt; letter-spacing: .08em; text-transform: uppercase; opacity: .92; }
      .sub { font-size: 9pt; opacity: .92; }
      .meta-row { margin-top: 8px; font-size: 10pt; color: #555; }
      .items { width: 100%; border-collapse: collapse; margin-top: 8px; }
      .items th, .items td { padding: 6px 8px; border-bottom: 1px solid #e5e5e5; vertical-align: top; text-align: left; }
      .items th { background: #f7f7f7; font-size: 9pt; text-transform: uppercase; letter-spacing: .04em; color: #555; }
      .items th.num, .items td.num { text-align: right; }
      .items .iname { font-weight: 600; }
      .mods { margin-top: 2px; }
      .mod { display: flex; justify-content: space-between; font-size: 9pt; color: #666; }
      .notes { font-size: 9pt; color: #777; font-style: italic; margin-top: 2px; }
      .totals { margin-top: 12px; margin-left: auto; width: 60%; }
      .totals .row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 10pt; }
      .totals .sep { border-top: 1px solid #333; margin: 4px 0; }
      .totals .grand { font-size: 13pt; font-weight: 700; padding-top: 4px; }
      .payment { margin-top: 14px; padding: 8px 10px; border: 1px solid #e5e5e5; border-radius: 4px; }
      .payment .row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 10pt; }
      .footer { margin-top: 24px; font-size: 9pt; color: #666; border-top: 1px dashed #ccc; padding-top: 8px; }
      @media print { .brand-bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    `;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(docTitle)} ${escapeHtml(orderNumber)}</title>
<style>${css}</style>
</head>
<body class="${isThermal ? "thermal" : "a5"}">
${headerHtml}
${itemsBlock}
${totalsBlock}
${paymentBlock}
${footerHtml}
<script>window.addEventListener('load', function(){ setTimeout(function(){ window.focus(); window.print(); }, 250); });</script>
</body>
</html>`;
}

export function printOrder(args: PrintOrderArgs): void {
  const html = buildOrderPrintHTML(args);
  const isThermal = args.size === "thermal-80mm";
  const features = isThermal ? "width=380,height=720" : "width=720,height=900";
  const w = window.open("", "_blank", features);
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
