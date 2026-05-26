/**
 * Khanalagao Desktop POS — shared IPC contract.
 *
 * Single source of truth for every request/response the renderer can ask of
 * the main process. Renderer NEVER makes HTTP calls directly — every data op
 * is an IPC invoke routed through this contract. This is what lets Phase 5
 * swap in an offline-tolerant transport without touching the renderer.
 *
 * Both `desktop/main` and `desktop/preload` import from here; the renderer
 * imports only the types (the preload bridge provides the actual functions
 * via `window.khanalagao.api`).
 */

// ─── Domain types ───────────────────────────────────────────────────────────
export interface User {
  id: number;
  name: string;
  email: string | null;
  role: string;
  tenantId: number | null;
  restaurantId: number | null;
  isSuperAdmin: boolean;
  kitchenId?: number | null;
  phone?: string | null;
  avatarUrl?: string | null;
}

export interface Restaurant {
  id: number;
  name: string;
  logoUrl?: string | null;
  city?: string | null;
}

export interface Branch {
  id: number;
  name: string;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  isActive?: boolean;
}

export interface Terminal {
  id: number;
  name: string;
  type?: string | null;
  status?: string | null;
  provider?: string | null;
  serial?: string | null;
  model?: string | null;
  branchId?: number | null;
}

export interface DenominationInput {
  denomination: number;
  count: number;
}

export interface CashRegisterSession {
  id: number;
  restaurantId: number;
  openedByUserId: number;
  openedByName?: string | null;
  openingFloat: string;
  status: "open" | "closed";
  openedAt: string;
  closedAt?: string | null;
  notes?: string | null;
  shiftId?: number | null;
}

export interface CashRegisterCurrent {
  session: CashRegisterSession | null;
  totals: {
    openingFloat: number;
    cashSales: number;
    totalCashIn: number;
    totalCashOut: number;
    expectedCash: number;
  } | null;
}

// ─── Connection / session state stored in main process ──────────────────────
export interface ConnectionSettings {
  apiBaseUrl: string;
}

export interface SelectionState {
  restaurantId: number | null;
  branchId: number | null;
  branchName: string | null;
  counterId: number | null;
  counterName: string | null;
  rememberDevice: boolean;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
}

export interface SessionSnapshot {
  auth: AuthState;
  selection: SelectionState;
  shift: { sessionId: number | null; openedAt: string | null };
}

// ─── Printers / hardware ────────────────────────────────────────────────────
/**
 * Printer roles wired to OS-detected printers. Per-kitchen overrides live in
 * `kitchenPrinters` so a multi-station kitchen can route bar items to the bar
 * printer, kitchen items to the kitchen printer, etc. without forcing every
 * outlet to use the same defaults.
 */
export type PrinterRole = "bill" | "kot" | "kitchen" | "bar" | "parcel" | "cashDrawer";

export interface PrinterAssignments {
  /** Default bill printer (used by `printers:print-order-bill`). */
  billPrinter: string | null;
  /** Default KOT printer (fallback when an item has no kitchenId/station). */
  kotPrinter: string | null;
  /** Generic kitchen role printer. */
  kitchenPrinter: string | null;
  /** Bar items default. */
  barPrinter: string | null;
  /** Takeaway / delivery (parcel) KOT printer. */
  parcelPrinter: string | null;
  /** Printer with the cash drawer attached (drawer-kick is sent here). */
  cashDrawerPrinter: string | null;
  /** Per-kitchen overrides — `{ "12": "EPSON_TM_T82" }` etc. */
  kitchenPrinters: Record<string, string>;
}

export interface DrawerSettings {
  /** Send the drawer-pulse before the print payload (true) or after (false). */
  kickBefore: boolean;
}

export interface ScannerSettings {
  enabled: boolean;
}

export interface OsPrinter {
  name: string;
  isDefault: boolean;
}

/**
 * Structured KOT print payload. Main process formats the ESC/POS text using
 * the layout the web POS uses (`printKitchenTicket`) and routes one print job
 * per kitchen group.
 */
export interface OrderKotItem {
  name: string;
  quantity: number;
  /** `null` / `undefined` → routed to the default KOT printer. */
  kitchenId?: number | null;
  /** Optional human-readable kitchen label (e.g. "Bar", "Hot Kitchen"). */
  kitchenName?: string | null;
  modifiers?: Array<{ name: string }>;
  notes?: string | null;
}

export interface OrderKotPayload {
  orderNumber: string;
  outletName?: string | null;
  tableLabel?: string | null;
  /** "dine_in" | "takeaway" | "delivery" | "qr_order" etc. */
  orderType?: string | null;
  createdAt?: string | null;
  items: OrderKotItem[];
}

/** Result of a multi-printer KOT dispatch. */
export interface KotDispatchResult {
  printed: Array<{ printerName: string; itemCount: number; kitchenLabel: string }>;
  failed: Array<{ printerName: string | null; kitchenLabel: string; error: string }>;
}

export interface OrderBillLine {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  modifiers?: Array<{ name: string; price: number }>;
  notes?: string | null;
}

export interface OrderBillPayload {
  orderNumber: string;
  createdAt?: string | null;
  tableLabel?: string | null;
  orderType?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  items: OrderBillLine[];
  subtotal: number;
  taxAmount: number;
  serviceCharge: number;
  discountAmount: number;
  totalAmount: number;
  taxBreakdown?: Array<{ rate: string; amount: number }>;
  discounts?: Array<{ label: string; amount: number }>;
  payment?: {
    method: string;
    tendered?: number;
    change?: number;
  };
  restaurant?: {
    name?: string | null;
    address?: string | null;
    phone?: string | null;
    gstin?: string | null;
    fssaiLicense?: string | null;
    upiId?: string | null;
  };
  footer?: string | null;
  /** Open the cash drawer when this print job runs (cash payments only). */
  openDrawer?: boolean;
  copies?: number;
}

export interface FailedPrintEntry {
  id: string;
  at: number;
  kind: "kot" | "bill" | "test" | "raw";
  printerName: string | null;
  /** Short, human-readable summary for the tray (e.g. "ORD-203 · Bar · 3 items"). */
  summary: string;
  error: string;
  /** Original payload for retry. Always present unless main was restarted. */
  payload?: unknown;
  /** How many auto-retries main has attempted so far. */
  attempts: number;
  /** Timestamp (ms) of the next scheduled auto-retry, if any. */
  nextRetryAt: number | null;
}

// ─── IPC channel contract ───────────────────────────────────────────────────
// Each entry: request payload type + response data type. Errors are thrown by
// the preload wrapper from a standard `{ ok:false, error:string }` envelope.
export type IpcContract = {
  // App / settings ----------------------------------------------------------
  "settings:get": { req: void; res: ConnectionSettings };
  "settings:set": { req: Partial<ConnectionSettings>; res: ConnectionSettings };
  "session:snapshot": { req: void; res: SessionSnapshot };
  "session:clear-selection": { req: void; res: SessionSnapshot };
  "app:version": { req: void; res: { version: string; platform: string } };
  "app:open-external": { req: string; res: true };

  // Auth --------------------------------------------------------------------
  "auth:login": {
    req: { identifier: string; password: string; rememberDevice?: boolean };
    res: { user: User };
  };
  "auth:refresh": { req: void; res: { ok: true } };
  "auth:logout": { req: void; res: true };
  "auth:me": { req: void; res: User };

  // Outlets / counters ------------------------------------------------------
  "restaurants:list": { req: void; res: Restaurant[] };
  "branches:list": { req: { restaurantId: number }; res: Branch[] };
  "terminals:list": { req: { restaurantId: number; branchId?: number }; res: Terminal[] };

  // Selection persistence ---------------------------------------------------
  "selection:set-restaurant": { req: { restaurantId: number }; res: SelectionState };
  "selection:set-branch": { req: { branchId: number; branchName: string }; res: SelectionState };
  "selection:set-counter": { req: { counterId: number; counterName: string }; res: SelectionState };

  // Shifts / cash register --------------------------------------------------
  "shifts:current": { req: void; res: CashRegisterCurrent };
  "shifts:open": {
    req: { openingCash: number; notes?: string };
    res: CashRegisterSession;
  };
  "shifts:close": {
    req: { sessionId: number; countedAmount: number; closeNotes?: string };
    res: { ok: true };
  };

  // Placeholders for later phases (Phase 2/4 will wire bodies). Defined
  // here so the preload surface and types lock in now.
  "menu:list": { req: void; res: unknown };
  "menu:categories": { req: void; res: unknown };
  "orders:list": { req: { status?: string }; res: unknown };
  "orders:create": { req: unknown; res: unknown };
  "orders:update": { req: { id: number; patch: unknown }; res: unknown };
  "customers:lookup": { req: { phone?: string; query?: string }; res: unknown };
  "payments:record": { req: unknown; res: unknown };

  // Printers / hardware -----------------------------------------------------
  "printers:list": { req: void; res: OsPrinter[] };
  "printers:test": { req: { printerName: string }; res: true };
  "printers:get-assignments": { req: void; res: PrinterAssignments };
  "printers:assign": {
    req:
      | { role: PrinterRole; printerName: string | null }
      | { kitchenId: number; printerName: string | null };
    res: PrinterAssignments;
  };
  "printers:print-receipt": { req: ReceiptPrintRequest; res: true };
  "printers:print-kot": { req: KotPrintRequest; res: true };
  /** Structured KOT dispatch — groups items by kitchen, fans out to printers. */
  "printers:print-order-kots": { req: OrderKotPayload; res: KotDispatchResult };
  /** Structured bill print — formats ESC/POS and sends to the bill printer. */
  "printers:print-order-bill": { req: OrderBillPayload; res: true };
  "printers:reprint-last-kot": { req: void; res: KotDispatchResult | null };
  "printers:reprint-last-bill": { req: void; res: true | null };
  /**
   * Main-process bill print by order id: main fetches the order + restaurant
   * via the API client, formats ESC/POS, and dispatches. Renderer only knows
   * the order id — payload assembly stays in main so the formatter has a
   * single source of truth.
   */
  "printers:print-bill-for-order": {
    req: { orderId: number; openDrawer?: boolean; copies?: number };
    res: true;
  };
  /** Item lookup by barcode/SKU for the scanner add-to-cart flow. */
  "menu:lookup-by-barcode": {
    req: { code: string };
    res: { id: number; name: string; price: number; sku?: string | null } | null;
  };

  "drawer:open": { req: { printerName?: string }; res: true };
  "drawer:get-settings": { req: void; res: DrawerSettings };
  "drawer:set-settings": { req: Partial<DrawerSettings>; res: DrawerSettings };

  "failed-prints:list": { req: void; res: FailedPrintEntry[] };
  "failed-prints:add": { req: unknown; res: true };
  "failed-prints:retry": { req: { id: string }; res: true };
  "failed-prints:discard": { req: { id: string }; res: true };
  "failed-prints:clear": { req: void; res: true };

  "scanner:get-state": { req: void; res: { enabled: boolean; lastScans: Array<{ at: number; value: string }> } };
  "scanner:set-enabled": { req: { enabled: boolean }; res: { enabled: boolean } };
  "scanner:record-scan": { req: { value: string }; res: { lastScans: Array<{ at: number; value: string }> } };
  "scanner:clear-scans": { req: void; res: true };

  "updates:check": { req: void; res: { status: string; version?: string } };
};

export interface ReceiptPrintRequest {
  printerName?: string;
  text: string;
  copies?: number;
  openDrawer?: boolean;
}
export interface KotPrintRequest {
  printerName?: string;
  text: string;
  stationLabel?: string;
}

export type IpcChannel = keyof IpcContract;
export type IpcReq<C extends IpcChannel> = IpcContract[C]["req"];
export type IpcRes<C extends IpcChannel> = IpcContract[C]["res"];

export type IpcEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

// Channels for events main → renderer (no request shape).
export type IpcEventChannel = "updates:event" | "auth:invalidated" | "printers:failed-changed";
export interface UpdateEvent {
  type: "available" | "progress" | "downloaded" | "error" | "none";
  version?: string;
  percent?: number;
  message?: string;
}
