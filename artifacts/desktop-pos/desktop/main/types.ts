export interface DesktopSettings {
  /** Base URL of the Khanalagao API + web POS (e.g. https://app.khanalagao.in). */
  apiBaseUrl: string;
  /** Path the desktop shell loads inside the embedded webview. */
  webPosPath: string;
  autoLaunch: boolean;
  startFullscreen: boolean;
  defaultOutletId: number | null;
  defaultCounterId: number | null;
  defaultOrderType: "dine_in" | "takeaway" | "delivery";
  soundEnabled: boolean;
  /** 0..1 */
  soundVolume: number;
  soundTone: "default" | "soft" | "classic";
  /** Auto-mute during the configured "no-disturb" portion of a shift. */
  muteShift: boolean;
  autoPrintKot: boolean;
  autoPrintBill: boolean;
  autoOpenDrawerOnCash: boolean;
  keepScreenAwake: boolean;
  checkForUpdates: boolean;
  /** OS printer names — null means "let the cashier pick at print time". */
  billPrinter: string | null;
  kotPrinter: string | null;
  kitchenPrinter: string | null;
  barPrinter: string | null;
  parcelPrinter: string | null;
  /** Drawer is kicked over a receipt printer (ESC/POS pulse). */
  cashDrawerPrinter: string | null;
  scannerEnabled: boolean;
  /** electron-updater generic feed URL; null = no auto-updates configured. */
  updateFeedUrl: string | null;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ReceiptPrintPayload {
  printerName?: string;
  /** Plain-text receipt body — main wraps it in ESC/POS init + cut codes. */
  text: string;
  copies?: number;
  /** Pulse the drawer immediately after printing (cash flow). */
  openDrawer?: boolean;
}

export interface KotPrintPayload {
  printerName?: string;
  text: string;
  stationLabel?: string;
}

export interface FailedPrintEntry {
  kind: "receipt" | "kot";
  printerName: string;
  text: string;
  reason: string;
}
