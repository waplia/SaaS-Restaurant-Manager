/**
 * Thin wrapper around native Bluetooth / USB thermal-printer modules.
 *
 * The TableTrack mobile bundle does **not** ship a native printer module by
 * default — that would force every release to include a config plugin and
 * rebuild via EAS. Instead, this adapter probes for the most common community
 * modules at runtime (e.g. `react-native-bluetooth-escpos-printer`,
 * `react-native-thermal-receipt-printer-image-qr`, `react-native-tscbluetooth`)
 * and degrades gracefully when nothing is installed.
 *
 * In the no-native-module case:
 *   - `scanBluetooth` / `scanUsb` return an empty list with `available: false`
 *     so the UI can show clear "Install native build" guidance instead of a
 *     mysterious crash.
 *   - `print` still resolves successfully but records "no-native" in the print
 *     job result so the server-side queue marks the attempt as failed (and
 *     retry/fallback to the desktop bridge can take over).
 *
 * Callers should NEVER `import` a native module directly — go through this
 * adapter so the Expo dev/web bundle keeps working.
 */
import { Platform } from "react-native";

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
  reason?: string;
}

export interface PrintResult {
  ok: boolean;
  error?: string;
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

function tryRequire<T>(name: string): T | null {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    // require lookup is wrapped in try/catch so missing optional native deps
    // do not crash the JS bundle.
    return require(name) as T;
  } catch {
    return null;
  }
}

let _bt: NativeBtModule | null | undefined;
let _usb: NativeUsbModule | null | undefined;

function getBt(): NativeBtModule | null {
  if (_bt !== undefined) return _bt;
  if (Platform.OS === "web") return (_bt = null);
  _bt =
    tryRequire<{ default?: NativeBtModule }>("react-native-bluetooth-escpos-printer")?.default ??
    tryRequire<NativeBtModule>("react-native-bluetooth-escpos-printer") ??
    tryRequire<NativeBtModule>("react-native-thermal-receipt-printer-image-qr") ??
    null;
  return _bt;
}
function getUsb(): NativeUsbModule | null {
  if (_usb !== undefined) return _usb;
  if (Platform.OS !== "android") return (_usb = null);
  _usb =
    tryRequire<{ default?: NativeUsbModule }>("react-native-usb-printer")?.default ??
    tryRequire<NativeUsbModule>("react-native-usb-printer") ??
    null;
  return _usb;
}

export function getCapabilities(): AdapterCapability {
  if (Platform.OS === "web") {
    return { bluetooth: false, usb: false, reason: "Native printing is unavailable in the web preview. Use the desktop print bridge or install the mobile build." };
  }
  const bt = !!getBt();
  const usb = Platform.OS === "android" && !!getUsb();
  if (!bt && !usb) {
    return { bluetooth: false, usb: false, reason: "Native printer module not installed in this build. Settings will save, but live scanning/printing requires a rebuild with the printer plugin." };
  }
  return { bluetooth: bt, usb };
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
 * Send a pre-rendered ESC/POS payload to a printer. `base64Payload` is the
 * output of `EscPosBuilder.base64()`.
 */
export async function print(
  connection: { type: "bluetooth" | "usb" | "lan" | "browser"; address?: string; vendorId?: string; productId?: string; host?: string; port?: number },
  base64Payload: string,
): Promise<PrintResult> {
  if (connection.type === "bluetooth") {
    const bt = getBt();
    if (!bt) return { ok: false, error: "Bluetooth printer module not installed in this build" };
    if (!connection.address) return { ok: false, error: "Bluetooth address missing" };
    try {
      if (bt.connect) await bt.connect(connection.address);
      if (!bt.printRaw) return { ok: false, error: "Native module does not expose printRaw" };
      await bt.printRaw(base64Payload);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
  if (connection.type === "usb") {
    const usb = getUsb();
    if (!usb || !usb.printRaw) return { ok: false, error: "USB printer module not installed in this build" };
    if (!connection.vendorId || !connection.productId) {
      return { ok: false, error: "USB vendor/product id missing" };
    }
    try {
      await usb.printRaw(base64Payload, connection.vendorId, connection.productId);
      return { ok: true };
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
