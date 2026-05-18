// Local thermal-printer bridge for the Khana Lagao desktop wrapper.
//
// Talks to USB and network ESC/POS printers via `node-thermal-printer`.
// Persists a list of configured printers in `userData/printer-config.json`
// and exposes a small API consumed by the renderer through `preload.cjs`:
//
//   listPrinters()              -> { printers, defaultId }
//   savePrinter(printer)        -> { printer }                       (add or update)
//   removePrinter(id)           -> { ok: true }
//   setDefaultPrinter(id)       -> { defaultId }
//   testPrint(id)               -> { ok, error? }
//   print({ printerId?, template, payload }) -> { ok, error? }
//
// Templates supported: "receipt" (customer/tax receipt) and "kot" (kitchen ticket).
// Payload shape matches `PrintOrderArgs` from the web app's printOrder.ts so
// the renderer can reuse the same data it already builds for the browser path.

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

let ThermalPrinter = null;
let PrinterTypes = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ printer: ThermalPrinter, types: PrinterTypes } = require("node-thermal-printer"));
} catch (_err) {
  // Library is optional at dev/install time; print calls will return a
  // descriptive error if it isn't present at runtime.
  ThermalPrinter = null;
  PrinterTypes = null;
}

const VALID_KINDS = new Set(["network", "usb"]);
const VALID_INTERFACE_TYPES = new Set(["epson", "star"]);

function configPath(userDataDir) {
  return path.join(userDataDir, "printer-config.json");
}

function loadConfig(userDataDir) {
  try {
    const raw = fs.readFileSync(configPath(userDataDir), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.printers)) {
      return {
        printers: parsed.printers.filter((p) => p && p.id && VALID_KINDS.has(p.kind)),
        defaultId: typeof parsed.defaultId === "string" ? parsed.defaultId : null,
      };
    }
  } catch (_err) {
    // missing or corrupt — start fresh.
  }
  return { printers: [], defaultId: null };
}

function saveConfig(userDataDir, cfg) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(configPath(userDataDir), JSON.stringify(cfg, null, 2), "utf8");
}

function sanitizePrinter(input) {
  if (!input || typeof input !== "object") throw new Error("Invalid printer payload");
  const kind = String(input.kind || "").toLowerCase();
  if (!VALID_KINDS.has(kind)) throw new Error(`Unsupported printer kind: ${kind}`);
  const interfaceType = VALID_INTERFACE_TYPES.has(String(input.interfaceType))
    ? String(input.interfaceType)
    : "epson";
  const name = String(input.name || "").trim() || "Thermal Printer";
  const width = Number(input.width) > 0 ? Math.min(64, Math.trunc(Number(input.width))) : 48;

  if (kind === "network") {
    const host = String(input.host || "").trim();
    if (!host) throw new Error("Network printer requires a host or IP");
    const port = Number(input.port) > 0 ? Math.trunc(Number(input.port)) : 9100;
    return {
      id: input.id || randomUUID(),
      kind,
      name,
      interfaceType,
      width,
      host,
      port,
    };
  }

  // USB
  const vendorId = input.vendorId != null ? String(input.vendorId).trim() : "";
  const productId = input.productId != null ? String(input.productId).trim() : "";
  return {
    id: input.id || randomUUID(),
    kind,
    name,
    interfaceType,
    width,
    vendorId,
    productId,
  };
}

function buildInterface(printer) {
  if (printer.kind === "network") {
    return `tcp://${printer.host}:${printer.port || 9100}`;
  }
  // USB: optionally pin to a vendor/product so the OS picks the right device.
  if (printer.vendorId && printer.productId) {
    return `printer:USB-${printer.vendorId}-${printer.productId}`;
  }
  return "printer:auto";
}

function makeDevice(printer) {
  if (!ThermalPrinter || !PrinterTypes) {
    throw new Error(
      "node-thermal-printer is not installed in the desktop app. Run `pnpm install` inside apps/desktop.",
    );
  }
  const type =
    printer.interfaceType === "star" ? PrinterTypes.STAR : PrinterTypes.EPSON;
  return new ThermalPrinter({
    type,
    interface: buildInterface(printer),
    width: printer.width || 48,
    characterSet: "PC437_USA",
    removeSpecialCharacters: false,
    lineCharacter: "-",
    options: { timeout: 5000 },
  });
}

const money = (n) => {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return `Rs.${v.toFixed(2)}`;
};

async function renderReceipt(device, payload) {
  const r = payload.restaurant || {};
  device.alignCenter();
  if (r.name) {
    device.setTextDoubleHeight();
    device.bold(true);
    device.println(String(r.name));
    device.bold(false);
    device.setTextNormal();
  }
  if (r.address) device.println(String(r.address));
  if (r.phone) device.println(`Tel: ${r.phone}`);
  if (r.gstin) device.println(`GSTIN: ${r.gstin}`);
  device.println(payload.documentTitle || "RECEIPT");
  device.drawLine();

  device.alignLeft();
  device.println(`Order: ${payload.orderNumber || "—"}`);
  if (payload.createdAt) device.println(`Time:  ${new Date(payload.createdAt).toLocaleString()}`);
  if (payload.tableLabel) device.println(`Table: ${payload.tableLabel}`);
  else if (payload.orderType) device.println(`Type:  ${String(payload.orderType).replace(/_/g, " ")}`);
  if (payload.customerName) {
    const phone = payload.customerPhone ? ` (${payload.customerPhone})` : "";
    device.println(`Cust:  ${payload.customerName}${phone}`);
  }
  device.drawLine();

  for (const it of payload.items || []) {
    device.tableCustom([
      { text: `${it.name} x${it.quantity}`, align: "LEFT", width: 0.7 },
      { text: money(it.lineTotal), align: "RIGHT", width: 0.3 },
    ]);
    for (const m of it.modifiers || []) {
      device.tableCustom([
        { text: `  + ${m.name}`, align: "LEFT", width: 0.7 },
        { text: money(m.price), align: "RIGHT", width: 0.3 },
      ]);
    }
    if (it.notes) device.println(`  * ${it.notes}`);
  }
  device.drawLine();

  device.tableCustom([
    { text: "Subtotal", align: "LEFT", width: 0.6 },
    { text: money(payload.subtotal), align: "RIGHT", width: 0.4 },
  ]);
  if (Array.isArray(payload.discounts) && payload.discounts.length > 0) {
    for (const d of payload.discounts) {
      if (!(Number(d.amount) > 0)) continue;
      device.tableCustom([
        { text: d.label || "Discount", align: "LEFT", width: 0.6 },
        { text: `-${money(d.amount)}`, align: "RIGHT", width: 0.4 },
      ]);
    }
  } else if (Number(payload.discountAmount) > 0) {
    device.tableCustom([
      { text: "Discount", align: "LEFT", width: 0.6 },
      { text: `-${money(payload.discountAmount)}`, align: "RIGHT", width: 0.4 },
    ]);
  }
  if (Number(payload.serviceCharge) > 0) {
    device.tableCustom([
      { text: "Service Charge", align: "LEFT", width: 0.6 },
      { text: money(payload.serviceCharge), align: "RIGHT", width: 0.4 },
    ]);
  }
  if (Array.isArray(payload.taxBreakdown) && payload.taxBreakdown.length > 0) {
    for (const t of payload.taxBreakdown) {
      device.tableCustom([
        { text: `Tax (${t.rate})`, align: "LEFT", width: 0.6 },
        { text: money(t.amount), align: "RIGHT", width: 0.4 },
      ]);
    }
  } else if (Number(payload.taxAmount) > 0) {
    device.tableCustom([
      { text: "Tax", align: "LEFT", width: 0.6 },
      { text: money(payload.taxAmount), align: "RIGHT", width: 0.4 },
    ]);
  }
  device.drawLine();
  device.bold(true);
  device.setTextDoubleHeight();
  const grand = payload.splitTotal != null ? payload.splitTotal : payload.totalAmount;
  device.tableCustom([
    { text: "TOTAL", align: "LEFT", width: 0.5 },
    { text: money(grand), align: "RIGHT", width: 0.5 },
  ]);
  device.setTextNormal();
  device.bold(false);

  if (payload.payment) {
    device.newLine();
    device.println(`Paid: ${String(payload.payment.method || "").toUpperCase()}`);
    if (payload.payment.tendered != null) {
      device.println(`Tendered: ${money(payload.payment.tendered)}`);
      const change =
        payload.payment.change != null
          ? Number(payload.payment.change)
          : Math.max(0, Number(payload.payment.tendered) - Number(grand));
      if (change > 0) device.println(`Change:   ${money(change)}`);
    }
  }

  device.newLine();
  device.alignCenter();
  device.println(payload.footer || "Thank you for dining with us!");
  device.cut();
}

async function renderKot(device, payload) {
  device.alignCenter();
  device.setTextDoubleHeight();
  device.bold(true);
  device.println("KITCHEN ORDER");
  device.setTextNormal();
  device.bold(false);
  if (payload.kitchenName) device.println(String(payload.kitchenName));
  device.drawLine();

  device.alignLeft();
  device.bold(true);
  device.println(`#${payload.orderNumber || "—"}`);
  device.bold(false);
  if (payload.tableLabel) device.println(`Table: ${payload.tableLabel}`);
  else if (payload.orderType) device.println(`Type:  ${String(payload.orderType).replace(/_/g, " ")}`);
  device.println(`Time:  ${new Date(payload.createdAt || Date.now()).toLocaleTimeString()}`);
  device.drawLine();

  for (const it of payload.items || []) {
    device.setTextDoubleHeight();
    device.println(`${it.quantity}x  ${it.name}`);
    device.setTextNormal();
    for (const m of it.modifiers || []) device.println(`     + ${m.name}`);
    if (it.notes) device.println(`     * ${it.notes}`);
  }
  device.drawLine();
  device.cut();
}

async function runPrint(printer, template, payload) {
  const device = makeDevice(printer);
  const tpl = String(template || "receipt").toLowerCase();
  if (tpl === "kot") {
    await renderKot(device, payload || {});
  } else if (tpl === "receipt") {
    await renderReceipt(device, payload || {});
  } else if (tpl === "raw" && typeof payload?.text === "string") {
    device.alignLeft();
    device.println(payload.text);
    device.cut();
  } else {
    throw new Error(`Unknown print template: ${template}`);
  }

  const isConnected = await device.isPrinterConnected().catch(() => true);
  if (!isConnected) throw new Error("Printer is not reachable. Check power/network/USB connection.");
  await device.execute();
}

function createBridge(userDataDir) {
  let cfg = loadConfig(userDataDir);

  function findPrinter(id) {
    if (id) {
      const m = cfg.printers.find((p) => p.id === id);
      if (m) return m;
    }
    if (cfg.defaultId) {
      const d = cfg.printers.find((p) => p.id === cfg.defaultId);
      if (d) return d;
    }
    return cfg.printers[0] || null;
  }

  return {
    name: "khanalagao-print-bridge",
    status: ThermalPrinter ? "ready" : "missing-dependency",
    describe() {
      return {
        vendor: "khanalagao",
        capabilities: ThermalPrinter
          ? ["network-escpos", "usb-escpos", "receipt", "kot"]
          : [],
        printerCount: cfg.printers.length,
        defaultId: cfg.defaultId,
      };
    },
    listPrinters() {
      return { printers: cfg.printers, defaultId: cfg.defaultId };
    },
    savePrinter(input) {
      const sanitized = sanitizePrinter(input);
      const idx = cfg.printers.findIndex((p) => p.id === sanitized.id);
      if (idx >= 0) cfg.printers[idx] = sanitized;
      else cfg.printers.push(sanitized);
      if (!cfg.defaultId) cfg.defaultId = sanitized.id;
      saveConfig(userDataDir, cfg);
      return { printer: sanitized };
    },
    removePrinter(id) {
      cfg.printers = cfg.printers.filter((p) => p.id !== id);
      if (cfg.defaultId === id) cfg.defaultId = cfg.printers[0]?.id || null;
      saveConfig(userDataDir, cfg);
      return { ok: true, defaultId: cfg.defaultId };
    },
    setDefaultPrinter(id) {
      if (!cfg.printers.some((p) => p.id === id)) throw new Error("Unknown printer id");
      cfg.defaultId = id;
      saveConfig(userDataDir, cfg);
      return { defaultId: cfg.defaultId };
    },
    async testPrint(id) {
      const p = findPrinter(id);
      if (!p) throw new Error("No printer configured");
      try {
        await runPrint(p, "raw", {
          text: [
            "*** TEST PRINT ***",
            p.name,
            new Date().toLocaleString(),
            "Khana Lagao desktop bridge",
            "",
          ].join("\n"),
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) };
      }
    },
    async print({ printerId, template, payload } = {}) {
      const p = findPrinter(printerId);
      if (!p) throw new Error("No printer configured");
      try {
        await runPrint(p, template, payload);
        return { ok: true, printerId: p.id };
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) };
      }
    },
  };
}

module.exports = { createBridge };
