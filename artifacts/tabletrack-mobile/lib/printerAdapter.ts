/**
 * Thin wrapper around native Bluetooth / USB thermal-printer modules with a
 * built-in **system print** fallback (AirPrint on iOS / Android Print
 * Service) so the printer flow works in Expo Go and in any build that
 * doesn't link the optional ESC/POS native modules.
 *
 * Tiers, in order of preference per connection type:
 *   1. Native ESC/POS modules (`react-native-bluetooth-escpos-printer`,
 *      `react-native-thermal-receipt-printer-image-qr`,
 *      `react-native-usb-printer`) — required for *raw* Bluetooth/USB
 *      thermal printing. Only present in custom dev builds.
 *   2. `expo-print` system print — works in Expo Go on iOS & Android.
 *      Routes the receipt through AirPrint / Android Print Service. Pairs
 *      with any networked or AirPrint receipt printer, no native build
 *      required.
 *
 * The adapter probes for native modules at runtime and degrades gracefully:
 *   - `scanBluetooth` / `scanUsb` return `available: false` when the native
 *     module is missing, so the UI can offer the system-print fallback
 *     instead of crashing.
 *   - `print({ type: "system" }, base64)` renders the ESC/POS payload as
 *     plain text inside an HTML page and hands it to the OS print sheet.
 *
 * Callers should NEVER `import` a native module directly — go through this
 * adapter so the Expo Go / web bundle keeps working.
 */
import { Platform } from "react-native";
import * as Print from "expo-print";

export interface ScannedPrinter {
  id: string;
  name: string;
  address?: string;
  vendorId?: string;
  productId?: string;
  rssi?: number;
  paired?: boolean;
}

export interface AdapterCapability {
  bluetooth: boolean;
  usb: boolean;
  /** AirPrint (iOS) / Android Print Service. Always available on device builds. */
  system: boolean;
  reason?: string;
}

export interface PrintResult {
  ok: boolean;
  error?: string;
  /** Transport actually used. May differ from requested when native modules
   *  are unavailable and the adapter falls back to the OS print sheet. */
  transportUsed?: "bluetooth" | "usb" | "lan" | "browser" | "system";
  /** True when the requested transport was unavailable and we fell back. */
  fellBack?: boolean;
}

type NativeBtModule = {
  enableBluetooth?: () => Promise<unknown>;
  scanDevices?: () => Promise<string | { found?: ScannedPrinter[]; paired?: ScannedPrinter[] }>;
  connect?: (address: string) => Promise<unknown>;
  printRaw?: (base64: string) => Promise<unknown>;
};

type NativeUsbModule = {
  getUsbDeviceList?: () => Promise<ScannedPrinter[]>;
  printRaw?: (base64: string, vid: string, pid: string) => Promise<unknown>;
};

// Metro's static analyzer rejects `require(variable)` calls, so each optional
// native module must be loaded with a literal string inside its own try/catch.
// Missing optional native deps simply resolve to null instead of crashing the
// JS bundle (lets the app run in Expo Go without the printer modules linked).
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
function loadBtEscposPrinter(): NativeBtModule | null {
  try {
    const m = require("react-native-bluetooth-escpos-printer") as any;
    return (m?.default ?? m) as NativeBtModule;
  } catch { return null; }
}
function loadBtThermalQr(): NativeBtModule | null {
  try {
    const m = require("react-native-thermal-receipt-printer-image-qr") as any;
    return (m?.default ?? m) as NativeBtModule;
  } catch { return null; }
}
function loadUsbPrinter(): NativeUsbModule | null {
  try {
    const m = require("react-native-usb-printer") as any;
    return (m?.default ?? m) as NativeUsbModule;
  } catch { return null; }
}
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

let _bt: NativeBtModule | null | undefined;
let _usb: NativeUsbModule | null | undefined;

function getBt(): NativeBtModule | null {
  if (_bt !== undefined) return _bt;
  if (Platform.OS === "web") return (_bt = null);
  _bt = loadBtEscposPrinter() ?? loadBtThermalQr() ?? null;
  return _bt;
}
function getUsb(): NativeUsbModule | null {
  if (_usb !== undefined) return _usb;
  if (Platform.OS !== "android") return (_usb = null);
  _usb = loadUsbPrinter() ?? null;
  return _usb;
}

export function getCapabilities(): AdapterCapability {
  if (Platform.OS === "web") {
    return { bluetooth: false, usb: false, system: false, reason: "Native printing is unavailable in the web preview. Use the desktop print bridge or install the mobile build." };
  }
  const bt = !!getBt();
  const usb = Platform.OS === "android" && !!getUsb();
  // expo-print is bundled with Expo Go and every dev/standalone build, so
  // system print is always available on iOS & Android device runtimes.
  const system = true;
  if (!bt && !usb) {
    return {
      bluetooth: false,
      usb: false,
      system,
      reason: "Bluetooth/USB thermal printer modules aren't linked in this build (Expo Go can't access them). You can still print via AirPrint / Android Print to any networked or AirPrint-enabled receipt printer.",
    };
  }
  return { bluetooth: bt, usb, system };
}

export async function scanBluetooth(): Promise<{ available: boolean; devices: ScannedPrinter[]; error?: string }> {
  const bt = getBt();
  if (!bt) return { available: false, devices: [] };
  try {
    if (bt.enableBluetooth) {
      try { await bt.enableBluetooth(); } catch { /* user-cancelled is ok */ }
    }
    if (!bt.scanDevices) return { available: true, devices: [] };
    const raw = await bt.scanDevices();
    let parsed: { found?: ScannedPrinter[]; paired?: ScannedPrinter[] } = {};
    if (typeof raw === "string") {
      try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    } else {
      parsed = raw;
    }
    const all = [...(parsed.paired ?? []), ...(parsed.found ?? [])];
    const seen = new Set<string>();
    return {
      available: true,
      devices: all.filter(d => {
        const key = d.address || d.id;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    };
  } catch (err) {
    return { available: true, devices: [], error: (err as Error).message };
  }
}

export async function scanUsb(): Promise<{ available: boolean; devices: ScannedPrinter[]; error?: string }> {
  const usb = getUsb();
  if (!usb || !usb.getUsbDeviceList) return { available: false, devices: [] };
  try {
    const devices = await usb.getUsbDeviceList();
    return { available: true, devices: devices ?? [] };
  } catch (err) {
    return { available: true, devices: [], error: (err as Error).message };
  }
}

/**
 * Strip ESC/POS control bytes from a base64 payload so it can be displayed
 * as a plain-text receipt inside an HTML page for AirPrint / Android Print.
 * Keeps printable ASCII + newlines; drops ESC (0x1B), GS (0x1D), and other
 * control sequences (including the 1-2 bytes that typically follow them).
 */
function escposToPlainText(base64: string): string {
  let bin: string;
  try {
    // atob exists in Hermes / RN runtime; fall back to Buffer if not.
    bin = typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("binary");
  } catch { return ""; }
  let out = "";
  for (let i = 0; i < bin.length; i++) {
    const c = bin.charCodeAt(i);
    if (c === 0x1B || c === 0x1D) {
      // Skip ESC/GS plus one parameter byte (most commands are 2-3 bytes;
      // this is a pragmatic best-effort, not a full ESC/POS parser).
      i += 1;
      continue;
    }
    if (c === 0x0A) { out += "\n"; continue; }
    if (c >= 0x20 && c < 0x7F) out += bin[i];
  }
  return out.trim();
}

async function systemPrint(base64Payload: string, deviceName?: string): Promise<PrintResult> {
  try {
    const text = escposToPlainText(base64Payload) || "TableTrack receipt";
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<!doctype html><html><head><meta charset="utf-8"/><style>
      @page { margin: 8mm; }
      body { font-family: -apple-system, "Helvetica Neue", monospace; font-size: 12pt; color: #000; }
      .header { text-align: center; font-weight: 700; margin-bottom: 8px; }
      pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: "Menlo", "Courier New", monospace; font-size: 11pt; }
    </style></head><body>
      <div class="header">TableTrack${deviceName ? " · " + deviceName : ""}</div>
      <pre>${escaped}</pre>
    </body></html>`;
    await Print.printAsync({ html });
    return { ok: true, transportUsed: "system" };
  } catch (err) {
    const msg = (err as Error).message || "";
    // User cancelled the system print sheet — treat as non-error.
    if (/cancel/i.test(msg)) return { ok: false, error: "Print cancelled" };
    return { ok: false, error: msg };
  }
}

/**
 * Send a pre-rendered ESC/POS payload to a printer. `base64Payload` is the
 * output of `EscPosBuilder.base64()`.
 *
 * For `type: "system"` (or when native modules are missing on bluetooth/usb),
 * the payload is converted to plain text and routed through the OS print
 * sheet (AirPrint / Android Print Service).
 */
export async function print(
  connection: { type: "bluetooth" | "usb" | "lan" | "browser" | "system"; address?: string; vendorId?: string; productId?: string; host?: string; port?: number; deviceName?: string },
  base64Payload: string,
): Promise<PrintResult> {
  if (connection.type === "system") {
    if (Platform.OS === "web") return { ok: false, error: "System print is unavailable on web" };
    return systemPrint(base64Payload, connection.deviceName);
  }
  if (connection.type === "bluetooth") {
    const bt = getBt();
    if (!bt) {
      // Expo Go can't link the native Bluetooth ESC/POS module — fall back
      // to AirPrint / Android Print so the user still gets a printed page.
      // Mark fellBack so callers can show "printed via system print" instead
      // of falsely reporting the Bluetooth transport as healthy.
      if (Platform.OS !== "web") {
        const r = await systemPrint(base64Payload, connection.deviceName);
        return { ...r, fellBack: r.ok };
      }
      return { ok: false, error: "Bluetooth printer module not installed in this build" };
    }
    if (!connection.address) return { ok: false, error: "Bluetooth address missing" };
    try {
      if (bt.connect) await bt.connect(connection.address);
      if (!bt.printRaw) return { ok: false, error: "Native module does not expose printRaw" };
      await bt.printRaw(base64Payload);
      return { ok: true, transportUsed: "bluetooth" };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
  if (connection.type === "usb") {
    const usb = getUsb();
    if (!usb || !usb.printRaw) {
      // Same fallback for USB: route through the OS print sheet.
      if (Platform.OS !== "web") {
        const r = await systemPrint(base64Payload, connection.deviceName);
        return { ...r, fellBack: r.ok };
      }
      return { ok: false, error: "USB printer module not installed in this build" };
    }
    if (!connection.vendorId || !connection.productId) {
      return { ok: false, error: "USB vendor/product id missing" };
    }
    try {
      await usb.printRaw(base64Payload, connection.vendorId, connection.productId);
      return { ok: true, transportUsed: "usb" };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
  if (connection.type === "lan") {
    // LAN protocol implementation owned by the desktop print-bridge per task spec;
    // mobile does not open raw 9100 sockets directly. Return a clear message so
    // the queue marks it failed and surfaces it for the bridge to pick up.
    return { ok: false, error: "LAN printing is handled by the desktop print bridge" };
  }
  if (connection.type === "browser") {
    return { ok: false, error: "Browser printing is unavailable on mobile" };
  }
  return { ok: false, error: `Unknown connection type: ${connection.type}` };
}
