export type PrintSize = "thermal-58mm" | "thermal-80mm" | "a5";

/** Modes for when the Scan-to-Pay UPI QR block is included on the bill.
 *  Mirrors `restaurants.upi_print_qr_mode`. KOTs NEVER print the QR. */
export type UpiPrintQrMode = "all" | "unpaid" | "upi_online_only" | "hide_after_paid";

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

function resolveLogoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  if (url.startsWith("/objects/")) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const base = typeof document !== "undefined"
      ? (document.querySelector("base")?.getAttribute("href")?.replace(/\/$/, "") ?? "")
      : "";
    return `${origin}${base}/api/public/storage${url}`;
  }
  return url;
}

export interface PrintRestaurant {
  name?: string | null;
  logoUrl?: string | null;
  address?: string | null;
  phone?: string | null;
  gstin?: string | null;
  fssaiLicense?: string | null;
  // ── UPI QR on bills (Task #600) ────────────────────────────────────
  // Effective values after the outlet→restaurant fallback. The caller is
  // responsible for resolving any per-branch overrides before invoking
  // printOrder so the print layer stays presentation-only.
  upiQrEnabled?: boolean | null;
  upiId?: string | null;
  upiMerchantName?: string | null;
  upiQrLabel?: string | null;
  showUpiQrOnBill?: boolean | null;
  showUpiIdOnBill?: boolean | null;
  upiPaymentNoteFormat?: string | null;
  upiPrintQrMode?: UpiPrintQrMode | null;
}

export interface PrintPayment {
  method: string;
  tendered?: number;
  change?: number;
}

export interface PrintOrderArgs {
  /** Bill paper size. Thermal sizes mirror the physical paper width; A5 is
   *  used for A5 sheet printers and as the cleanest browser fallback. */
  size: PrintSize;
  /** Optional pre-computed UPI QR PNG data URL. When set the print layer
   *  embeds it as-is. Built by `printOrder()` when not provided so existing
   *  call sites continue to work without changes. */
  upiQrDataUrl?: string | null;
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

  const isThermal58 = size === "thermal-58mm";
  const isThermal80 = size === "thermal-80mm";
  const isThermal = isThermal58 || isThermal80;
  const paperWidth = isThermal58 ? "58mm" : "80mm";
  // 58mm rolls are physically narrower — drop a couple of CSS units so the
  // grand-total and item lines don't wrap on cheap consumer hardware.
  const thermalBodyFont = isThermal58 ? 11 : 12;
  const thermalBrandFont = isThermal58 ? 14 : 16;
  const thermalGrandFont = isThermal58 ? 13 : 14;
  const displayTotal = splitTotal ?? totalAmount;
  const change = payment?.tendered != null
    ? Math.max(0, payment.tendered - displayTotal)
    : payment?.change ?? 0;

  const docTitle =
    documentTitle ??
    (payment?.method && payment.method !== "pending" ? "Tax Invoice" : "Receipt");

  const restName = restaurant?.name || "KhanaLagao";
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
        ${resolveLogoUrl(restaurant?.logoUrl) ? `<img src="${escapeHtml(resolveLogoUrl(restaurant?.logoUrl)!)}" class="logo" alt=""/>` : ""}
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
            ${resolveLogoUrl(restaurant?.logoUrl) ? `<img src="${escapeHtml(resolveLogoUrl(restaurant?.logoUrl)!)}" class="logo" alt=""/>` : ""}
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

  // ── UPI Scan-to-Pay block (Task #600) ──────────────────────────────
  // Mode resolution is intentionally permissive — the caller (POS / order
  // drawer) is the source of truth for whether the bill is paid and the
  // payment method, but we still gate purely-decorative rendering here so
  // the same `printOrder()` call can be reused from anywhere without each
  // call site re-implementing the rules.
  const upiMode: UpiPrintQrMode = (restaurant?.upiPrintQrMode ?? "all") as UpiPrintQrMode;
  const isPaid = payment != null && payment.method !== "pending";
  const isUpiPaid = isPaid && /upi/i.test(payment?.method ?? "");
  let showQrByMode = true;
  if (upiMode === "unpaid") showQrByMode = !isPaid;
  else if (upiMode === "hide_after_paid") showQrByMode = !isPaid;
  else if (upiMode === "upi_online_only") showQrByMode = isUpiPaid;
  const wantsUpiBlock =
    !!restaurant?.upiQrEnabled &&
    restaurant?.showUpiQrOnBill !== false &&
    !!restaurant?.upiId &&
    !!args.upiQrDataUrl &&
    showQrByMode;
  const upiBlock = wantsUpiBlock
    ? (isThermal
        ? `
          <div class="sep"></div>
          <div class="upi center">
            <div class="bold">${escapeHtml(restaurant?.upiQrLabel || "Scan to Pay")}</div>
            <img src="${escapeHtml(args.upiQrDataUrl!)}" class="qr" alt="UPI QR"/>
            ${restaurant?.showUpiIdOnBill ? `<div class="sub mono">${escapeHtml(restaurant?.upiId || "")}</div>` : ""}
            <div class="sub">Amount: ${money(displayTotal)}</div>
          </div>`
        : `
          <div class="upi">
            <div class="upi-inner">
              <img src="${escapeHtml(args.upiQrDataUrl!)}" class="qr" alt="UPI QR"/>
              <div>
                <div class="upi-label">${escapeHtml(restaurant?.upiQrLabel || "Scan to Pay")}</div>
                <div class="upi-amount">${money(displayTotal)}</div>
                ${restaurant?.showUpiIdOnBill ? `<div class="upi-vpa">${escapeHtml(restaurant?.upiId || "")}</div>` : ""}
                <div class="upi-hint">Any UPI app · GPay · PhonePe · Paytm</div>
              </div>
            </div>
          </div>`)
    : "";

  const fssaiLine = restaurant?.fssaiLicense
    ? `<div class="footer center sub">FSSAI Lic: ${escapeHtml(restaurant.fssaiLicense)}</div>`
    : "";
  const footerHtml = `<div class="footer center">${escapeHtml(footer ?? "Thank you for dining with us!")}</div>${fssaiLine}`;

  const css = isThermal
    ? `
      @page { size: ${paperWidth} auto; margin: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { background: #fff; color: #000; }
      body { font-family: 'Courier New', ui-monospace, monospace; font-size: ${thermalBodyFont}px; width: ${paperWidth}; padding: 4mm 3mm; }
      .center { text-align: center; }
      .bold { font-weight: 700; }
      .mono { font-family: 'Courier New', ui-monospace, monospace; }
      .sep { border-top: 1px dashed #555; margin: 6px 0; }
      .row { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
      .num { font-variant-numeric: tabular-nums; font-family: 'Courier New', ui-monospace, monospace; white-space: nowrap; }
      .header .logo { max-width: ${isThermal58 ? "44mm" : "60mm"}; max-height: ${isThermal58 ? "16mm" : "22mm"}; object-fit: contain; margin-bottom: 4px; }
      .brand { font-size: ${thermalBrandFont}px; font-weight: 700; }
      .doctype { font-size: ${thermalBodyFont}px; margin-top: 2px; letter-spacing: .04em; text-transform: uppercase; }
      .sub { font-size: ${thermalBodyFont - 1}px; color: #333; }
      .meta { margin: 2px 0; }
      .col-head { font-size: ${thermalBodyFont - 1}px; font-weight: 700; }
      .item .iname { flex: 1; }
      .mod { display: flex; justify-content: space-between; font-size: ${thermalBodyFont - 1}px; color: #333; padding-left: 8px; }
      .notes { font-size: ${thermalBodyFont - 1}px; color: #555; padding-left: 8px; font-style: italic; }
      .totals { margin-top: 4px; }
      .grand { font-size: ${thermalGrandFont}px; font-weight: 700; }
      .payment { margin-top: 4px; }
      .upi { margin-top: 6px; }
      .upi .qr { width: ${isThermal58 ? "40mm" : "50mm"}; height: ${isThermal58 ? "40mm" : "50mm"}; margin: 4px auto; display: block; image-rendering: pixelated; }
      .footer { margin-top: 8px; font-size: ${thermalBodyFont - 1}px; }
      @media print { body { width: ${paperWidth}; } }
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
      .upi { margin-top: 14px; padding: 10px; border: 1px dashed #999; border-radius: 6px; background: #fafafa; }
      .upi .upi-inner { display: flex; align-items: center; gap: 14px; }
      .upi .qr { width: 38mm; height: 38mm; background: #fff; padding: 2px; }
      .upi .upi-label { font-size: 12pt; font-weight: 700; }
      .upi .upi-amount { font-size: 11pt; color: #444; margin-top: 2px; }
      .upi .upi-vpa { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 10pt; margin-top: 4px; color: #555; }
      .upi .upi-hint { font-size: 9pt; color: #888; margin-top: 4px; }
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
${upiBlock}
${footerHtml}
<script>window.addEventListener('load', function(){ setTimeout(function(){ window.focus(); window.print(); }, 250); });</script>
</body>
</html>`;
}

// ─────────────────────────── Desktop bridge ───────────────────────────
// The Electron wrapper (apps/desktop) exposes `window.khanalagao.print(...)`
// which talks to USB / network ESC/POS printers directly. When present we
// route thermal receipts and kitchen tickets through it; otherwise we fall
// back to the browser's print dialog so the same call site keeps working in
// a regular web tab.

interface KhanaLagaoBridge {
  isDesktop?: boolean;
  printer?: { describe?: () => Promise<{ printerCount?: number } | undefined> };
  print?: (args: {
    template: "receipt" | "kot" | "raw";
    payload: unknown;
    printerId?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}

function getBridge(): KhanaLagaoBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { khanalagao?: KhanaLagaoBridge }).khanalagao;
  return b && b.isDesktop && typeof b.print === "function" ? b : null;
}

export function isDesktopPrintBridgeAvailable(): boolean {
  return getBridge() !== null;
}

/** Build the UPI deep-link string honoring the configured payment-note format.
 *  Exported for tests and the desktop bridge fallback. */
export function buildUpiPaymentUrl(opts: {
  upiId: string;
  merchantName?: string | null;
  amount: number;
  orderNumber: string;
  noteFormat?: string | null;
}): string {
  const note = (opts.noteFormat || "Bill {orderNumber}").replace("{orderNumber}", opts.orderNumber);
  const amt = (Number.isFinite(opts.amount) ? opts.amount : 0).toFixed(2);
  const params = new URLSearchParams({
    pa: opts.upiId,
    pn: opts.merchantName || "Restaurant",
    am: amt,
    cu: "INR",
    tn: note,
    tr: opts.orderNumber,
  });
  return `upi://pay?${params.toString()}`;
}

/** Generate a PNG data URL for the bill UPI QR. Returns null when the
 *  restaurant has no UPI ID configured, when QR is disabled, or when the
 *  `qrcode` lib isn't bundled in the host (e.g. SSR). */
export async function maybeBuildBillUpiQr(args: PrintOrderArgs): Promise<string | null> {
  const r = args.restaurant;
  if (!r?.upiQrEnabled || !r.upiId || r.showUpiQrOnBill === false) return null;
  try {
    const QR = (await import("qrcode")).default;
    const url = buildUpiPaymentUrl({
      upiId: r.upiId,
      merchantName: r.upiMerchantName,
      amount: args.splitTotal ?? args.totalAmount,
      orderNumber: args.orderNumber,
      noteFormat: r.upiPaymentNoteFormat,
    });
    return await QR.toDataURL(url, { width: 320, margin: 1, errorCorrectionLevel: "M" });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[printOrder] QR generation failed; printing bill without QR:", err);
    return null;
  }
}

export function printOrder(args: PrintOrderArgs): void {
  // Pre-compute the UPI QR (if applicable) so the print HTML can embed it
  // synchronously — the popup window can't safely await an async import once
  // it's opened. We deliberately fire-and-forget here; existing callers do
  // not await this function.
  void (async () => {
    const qr = args.upiQrDataUrl ?? (await maybeBuildBillUpiQr(args));
    const enriched: PrintOrderArgs = { ...args, upiQrDataUrl: qr };
    const bridge = getBridge();
    const goesToBridge = bridge && (enriched.size === "thermal-58mm" || enriched.size === "thermal-80mm");
    if (goesToBridge) {
      try {
        const r = await bridge!.print!({ template: "receipt", payload: enriched });
        if (!r?.ok) {
          // eslint-disable-next-line no-console
          console.warn("[printOrder] desktop bridge failed, using browser fallback:", r?.error);
          openBrowserPrint(enriched);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[printOrder] desktop bridge threw, using browser fallback:", err);
        openBrowserPrint(enriched);
      }
      return;
    }
    openBrowserPrint(enriched);
  })();
}

function openBrowserPrint(args: PrintOrderArgs): void {
  const html = buildOrderPrintHTML(args);
  const isThermal = args.size === "thermal-58mm" || args.size === "thermal-80mm";
  const features = isThermal ? "width=380,height=720" : "width=720,height=900";
  const w = window.open("", "_blank", features);
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export interface KitchenTicketArgs {
  orderNumber: string;
  createdAt?: string | Date;
  tableLabel?: string;
  orderType?: string;
  kitchenName?: string;
  items: PrintLineItem[];
}

/**
 * Print a kitchen order ticket (KOT). Routes through the desktop bridge when
 * available, falls back to a minimal print-styled HTML window otherwise.
 */
export function printKitchenTicket(args: KitchenTicketArgs): void {
  const bridge = getBridge();
  if (bridge) {
    bridge.print!({ template: "kot", payload: args }).then((r) => {
      if (!r?.ok) openKitchenTicketFallback(args);
    }).catch(() => openKitchenTicketFallback(args));
    return;
  }
  openKitchenTicketFallback(args);
}

function openKitchenTicketFallback(args: KitchenTicketArgs): void {
  const rows = (args.items || []).map((it) => {
    const mods = (it.modifiers || []).map((m) => `<div class="mod">+ ${escapeHtml(m.name)}</div>`).join("");
    const notes = it.notes ? `<div class="notes">* ${escapeHtml(it.notes)}</div>` : "";
    return `<div class="item"><span class="qty">${it.quantity}×</span><span class="name">${escapeHtml(it.name)}</span></div>${mods}${notes}`;
  }).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>KOT ${escapeHtml(args.orderNumber)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  body { font-family: 'Courier New', monospace; font-size: 12px; width: 80mm; padding: 6mm 4mm; }
  .center { text-align: center; }
  .sep { border-top: 1px dashed #555; margin: 6px 0; }
  .title { font-size: 16px; font-weight: 700; }
  .item { display: flex; gap: 6px; font-size: 14px; font-weight: 700; margin-top: 4px; }
  .qty { min-width: 28px; }
  .mod { padding-left: 32px; font-size: 11px; }
  .notes { padding-left: 32px; font-size: 11px; font-style: italic; }
</style></head><body>
  <div class="center title">KITCHEN ORDER</div>
  ${args.kitchenName ? `<div class="center">${escapeHtml(args.kitchenName)}</div>` : ""}
  <div class="sep"></div>
  <div><strong>#${escapeHtml(args.orderNumber)}</strong></div>
  ${args.tableLabel ? `<div>Table: ${escapeHtml(args.tableLabel)}</div>` : args.orderType ? `<div>Type: ${escapeHtml(args.orderType.replace(/_/g, " "))}</div>` : ""}
  <div>Time: ${formatDate(args.createdAt)}</div>
  <div class="sep"></div>
  ${rows}
  <script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 200); });</script>
</body></html>`;
  const w = window.open("", "_blank", "width=380,height=720");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ─────────────────────────── Event quotation / invoice ───────────────────────────

export interface EventQuotationLineItem {
  kind: string;
  name: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface EventQuotationMilestone {
  label: string;
  dueDate: string | Date;
  amount: number;
  status: string;
}

export interface EventQuotationArgs {
  documentKind: "Quotation" | "Invoice";
  bookingNumber: string;
  type: string;
  title: string;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  eventDate: string | Date;
  durationMinutes: number;
  venue?: string | null;
  guestCount: number;
  packageDetails?: string | null;
  notes?: string | null;
  items: EventQuotationLineItem[];
  schedule: EventQuotationMilestone[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  advancePaid: number;
  restaurant?: PrintRestaurant;
}

function buildEventQuotationHTML(args: EventQuotationArgs): string {
  const e = escapeHtml;
  const balanceDue = Math.max(0, args.totalAmount - args.advancePaid);
  const itemsHtml = args.items.length
    ? args.items
        .map(
          (i) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee">
            <div style="font-weight:600">${e(i.name)} <span style="font-size:11px;color:#888">[${e(i.kind)}]</span></div>
            ${i.description ? `<div style="font-size:12px;color:#666">${e(i.description)}</div>` : ""}
          </td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${money(i.unitPrice)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${money(i.lineTotal)}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" style="padding:16px;text-align:center;color:#999">No line items</td></tr>`;

  const scheduleHtml = args.schedule.length
    ? `<div style="margin-top:24px">
        <h3 style="margin:0 0 8px 0;font-size:14px">Payment Schedule</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#f9fafb">
            <th style="padding:6px;text-align:left;border-bottom:1px solid #ddd">Milestone</th>
            <th style="padding:6px;text-align:left;border-bottom:1px solid #ddd">Due</th>
            <th style="padding:6px;text-align:right;border-bottom:1px solid #ddd">Amount</th>
            <th style="padding:6px;text-align:center;border-bottom:1px solid #ddd">Status</th>
          </tr></thead>
          <tbody>${args.schedule
            .map(
              (m) => `<tr>
              <td style="padding:6px;border-bottom:1px solid #eee">${e(m.label)}</td>
              <td style="padding:6px;border-bottom:1px solid #eee">${formatDate(m.dueDate).split(",")[0]}</td>
              <td style="padding:6px;border-bottom:1px solid #eee;text-align:right">${money(m.amount)}</td>
              <td style="padding:6px;border-bottom:1px solid #eee;text-align:center;text-transform:capitalize">${e(m.status)}</td>
            </tr>`,
            )
            .join("")}</tbody>
        </table>
      </div>`
    : "";

  return `<!doctype html><html><head>
<meta charset="utf-8"/>
<title>${e(args.documentKind)} ${e(args.bookingNumber)}</title>
<style>
  @media print { @page { size: A4; margin: 14mm; } }
  body { font-family: -apple-system, system-ui, Segoe UI, sans-serif; color:#222; }
  h1, h2, h3 { margin: 0; }
  table { border-collapse: collapse; width: 100%; }
  .muted { color: #666; font-size: 12px; }
</style>
</head><body onload="window.print()">
  <div style="max-width:760px;margin:0 auto">
    <header style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #f97316;padding-bottom:12px;margin-bottom:18px">
      <div>
        ${resolveLogoUrl(args.restaurant?.logoUrl) ? `<img src="${e(resolveLogoUrl(args.restaurant?.logoUrl)!)}" alt="logo" style="max-height:48px;margin-bottom:6px" />` : ""}
        <h2 style="font-size:18px">${e(args.restaurant?.name ?? "")}</h2>
        ${args.restaurant?.address ? `<div class="muted">${e(args.restaurant.address)}</div>` : ""}
        ${args.restaurant?.phone ? `<div class="muted">${e(args.restaurant.phone)}</div>` : ""}
        ${args.restaurant?.gstin ? `<div class="muted">GSTIN: ${e(args.restaurant.gstin)}</div>` : ""}
      </div>
      <div style="text-align:right">
        <h1 style="color:#f97316;font-size:22px;letter-spacing:0.5px">${e(args.documentKind.toUpperCase())}</h1>
        <div class="muted">#${e(args.bookingNumber)}</div>
        <div class="muted">${formatDate(new Date())}</div>
      </div>
    </header>

    <section style="display:flex;gap:24px;margin-bottom:18px">
      <div style="flex:1">
        <div class="muted" style="margin-bottom:4px">Bill To</div>
        <div style="font-weight:600">${e(args.customerName)}</div>
        ${args.customerPhone ? `<div class="muted">${e(args.customerPhone)}</div>` : ""}
        ${args.customerEmail ? `<div class="muted">${e(args.customerEmail)}</div>` : ""}
      </div>
      <div style="flex:1">
        <div class="muted" style="margin-bottom:4px">Event</div>
        <div style="font-weight:600">${e(args.title)} <span class="muted">(${e(args.type)})</span></div>
        <div class="muted">${formatDate(args.eventDate)}</div>
        <div class="muted">Duration: ${args.durationMinutes} min · Guests: ${args.guestCount}</div>
        ${args.venue ? `<div class="muted">Venue: ${e(args.venue)}</div>` : ""}
      </div>
    </section>

    ${args.packageDetails ? `<section style="background:#fafafa;border:1px solid #eee;border-radius:8px;padding:12px;margin-bottom:18px"><div class="muted" style="margin-bottom:4px">Package details</div><div>${e(args.packageDetails)}</div></section>` : ""}

    <table style="font-size:13px">
      <thead><tr style="background:#f9fafb">
        <th style="padding:8px;text-align:left;border-bottom:2px solid #ddd">Item</th>
        <th style="padding:8px;text-align:center;border-bottom:2px solid #ddd;width:60px">Qty</th>
        <th style="padding:8px;text-align:right;border-bottom:2px solid #ddd;width:90px">Unit</th>
        <th style="padding:8px;text-align:right;border-bottom:2px solid #ddd;width:100px">Total</th>
      </tr></thead>
      <tbody>${itemsHtml}</tbody>
    </table>

    <div style="display:flex;justify-content:flex-end;margin-top:14px">
      <table style="width:300px;font-size:13px">
        <tr><td style="padding:4px 0">Subtotal</td><td style="padding:4px 0;text-align:right">${money(args.subtotal)}</td></tr>
        ${args.discountAmount ? `<tr><td style="padding:4px 0">Discount</td><td style="padding:4px 0;text-align:right">- ${money(args.discountAmount)}</td></tr>` : ""}
        ${args.taxAmount ? `<tr><td style="padding:4px 0">Tax</td><td style="padding:4px 0;text-align:right">${money(args.taxAmount)}</td></tr>` : ""}
        <tr style="font-weight:700;border-top:2px solid #222"><td style="padding:8px 0">Total</td><td style="padding:8px 0;text-align:right">${money(args.totalAmount)}</td></tr>
        ${args.advancePaid ? `<tr><td style="padding:4px 0;color:#0a7d2c">Advance paid</td><td style="padding:4px 0;text-align:right;color:#0a7d2c">- ${money(args.advancePaid)}</td></tr>` : ""}
        ${args.advancePaid ? `<tr style="font-weight:700;color:#b91c1c"><td style="padding:6px 0">Balance due</td><td style="padding:6px 0;text-align:right">${money(balanceDue)}</td></tr>` : ""}
      </table>
    </div>

    ${scheduleHtml}

    ${args.notes ? `<section style="margin-top:24px"><div class="muted" style="margin-bottom:4px">Notes</div><div>${e(args.notes)}</div></section>` : ""}

    <footer style="margin-top:32px;padding-top:12px;border-top:1px solid #eee;color:#999;font-size:11px;text-align:center">
      ${args.documentKind === "Quotation" ? "This quotation is valid for 14 days. Confirm with an advance to lock the date." : "Thank you for your business!"}
    </footer>
  </div>
</body></html>`;
}

export function printEventQuotation(args: EventQuotationArgs): void {
  const html = buildEventQuotationHTML(args);
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
