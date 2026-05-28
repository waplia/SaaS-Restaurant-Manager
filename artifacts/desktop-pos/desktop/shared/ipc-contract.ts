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

export interface RestaurantInfo extends Restaurant {
  taxRate?: string | number | null;
  serviceCharge?: string | number | null;
  currency?: string | null;
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

// ─── Phase 4 — payments / split / shift close / reports ─────────────────────
/** Tender types accepted by `orders:pay`. UPI is wired via Razorpay; "card"
 *  is reserved for card-on-terminal (capture happens via `payments:terminal-*`
 *  before `orders:pay` records the verified payment). */
export type PayMethod = "cash" | "card" | "upi" | "room_charge" | "pay_later";

/** A single split-bill leg. Server requires ≥2 legs and a cumulative total
 *  ≥ the order grand total. */
export interface SplitLeg {
  paymentMethod: "cash" | "card" | "upi";
  amount: number;
  tipAmount?: number;
  stripePaymentIntentId?: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;
}

/** Aggregated KPIs for the Reports sidebar (30s refresh). Server-derived from
 *  orders in the open-shift window — no extra endpoint, the main process
 *  rolls these up from `client.listOrders` filtered by the shift `openedAt`. */
export interface ShiftKpis {
  sessionId: number;
  openedAt: string;
  orderCount: number;
  paidCount: number;
  unpaidCount: number;
  voidedCount: number;
  grossRevenue: number;
  netRevenue: number;
  taxCollected: number;
  serviceCollected: number;
  discountTotal: number;
  tipsCollected: number;
  byMethod: Array<{ method: string; amount: number; count: number }>;
  averageTicket: number;
  generatedAt: string;
}

/** Snapshot of a closed shift, cached locally for ≤30 days so reprints work
 *  without round-tripping the server. */
export interface ZReportSummary {
  sessionId: number;
  restaurantId: number;
  outletName?: string | null;
  branchName?: string | null;
  counterName?: string | null;
  openedAt: string;
  closedAt: string;
  openedByName?: string | null;
  closedByName?: string | null;
  openingFloat: number;
  cashSales: number;
  totalCashIn: number;
  totalCashOut: number;
  expectedCash: number | null;
  countedCash: number | null;
  overShort: number | null;
  isBlindClose: boolean;
  varianceReason?: string | null;
  closeNotes?: string | null;
  orderCount: number;
  grossRevenue: number;
  tenderSummary: Array<{ method: string; in: number; out: number; count: number }>;
  /** Wire denominations counted at close so the reprint preserves the breakdown. */
  denominations?: DenominationInput[];
  /** Local cache timestamp (ms). */
  cachedAt: number;
}

// ─── Menu / cart / orders ───────────────────────────────────────────────────

export interface MenuCategory {
  id: number;
  name: string;
  description?: string | null;
  sortOrder?: number | null;
  imageUrl?: string | null;
}

export interface MenuItem {
  id: number;
  restaurantId: number;
  categoryId: number | null;
  name: string;
  description?: string | null;
  price: string;
  imageUrl?: string | null;
  isVeg?: boolean | null;
  isAvailable?: boolean | null;
  preparationTime?: number | null;
  modifierGroupCount?: number;
  hasModifiers?: boolean;
  hasRequiredModifiers?: boolean;
  /** Marked best-seller by the back office. Renders a ⭐ chip on the tile. */
  isBestseller?: boolean | null;
  /** Inventory hint — when true, the tile shows a "Low stock" warning. */
  lowStock?: boolean | null;
  /** Searchable aliases / tags (SKU, barcode, short codes). */
  sku?: string | null;
  barcode?: string | null;
  aliases?: string[] | null;
  tags?: string[] | null;
}

export interface ModifierOption {
  id: number;
  groupId: number;
  name: string;
  price: string;
  isAvailable?: boolean | null;
  sortOrder?: number | null;
}

export interface ModifierGroup {
  id: number;
  menuItemId: number;
  name: string;
  isRequired?: boolean | null;
  minSelections?: number | null;
  maxSelections?: number | null;
  isActive?: boolean | null;
  showOnPos?: boolean | null;
  sortOrder?: number | null;
  modifiers?: ModifierOption[];
}

export interface FloorTable {
  id: number;
  restaurantId: number;
  tableNumber: string;
  capacity: number;
  status: string;
  positionX?: number | null;
  positionY?: number | null;
  shape?: string | null;
  isActive?: boolean;
}

export interface CustomerSummary {
  id: number;
  name: string | null;
  phone: string | null;
  email?: string | null;
  loyaltyPoints?: number | null;
  visits?: number | null;
  totalSpent?: string | number | null;
}

export type OrderType =
  | "dine_in" | "takeaway" | "delivery"
  | "qr_order" | "reservation_order" | "curbside";

export interface CartModifierInput {
  /** Optional — when present, server reconciles against the live modifier row
   *  for current price / availability. Otherwise the fallback {name,price}
   *  shape is honoured for backwards compatibility. */
  modifierId?: number;
  name: string;
  /** String to preserve decimal precision on the wire. */
  price: string;
  quantity?: number;
}

export interface CartItemInput {
  menuItemId: number;
  quantity: number;
  notes?: string;
  modifiers?: CartModifierInput[];
}

export interface CreateOrderRequest {
  orderType: OrderType;
  tableId?: number | null;
  customerName?: string;
  customerPhone?: string;
  customerId?: number | null;
  notes?: string;
  isPriority?: boolean;
  branchId?: number | null;
  items: CartItemInput[];
  /** Optional client-supplied idempotency key (UUID). When absent, the main
   *  process generates one so a single user click can't double-create. */
  idempotencyKey?: string;
}

export interface OrderHeader {
  id: number;
  restaurantId: number;
  /** Canonical long id from the server, e.g. "KL-R1-MGROAD-20260527-DN-000020".
   *  Never render this directly to operators — use `shortOrderNumber()` from
   *  `desktop/shared/orderNumber.ts`, which prefers `orderDisplayNumber`. */
  orderNumber: string;
  /** Short operator-friendly id minted by the server, e.g. "DN-20".
   *  Optional because (a) older payloads cached in SQLite predate the column
   *  and (b) offline-created orders synthesize their own "L-XXXXXX" id in
   *  `orderNumber` until sync remap fills this in. */
  orderDisplayNumber?: string | null;
  status: string;
  orderType: string;
  tableId: number | null;
  customerName: string | null;
  customerPhone: string | null;
  customerId: number | null;
  subtotal: string;
  taxAmount: string;
  serviceCharge: string;
  discountAmount: string;
  totalAmount: string;
  createdAt: string;
  isRunningOrder?: boolean;
  isPriority?: boolean;
  notes?: string | null;
  /** Phase 4 — server-side payment state for the Pay/Split UI. */
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  paymentAmount?: string | number | null;
  tableLabel?: string | null;
  tipAmount?: string | number | null;
}

export interface OrderItemView {
  id: number;
  orderId: number;
  menuItemId: number;
  menuItemName: string;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  notes?: string | null;
  kitchenId?: number | null;
  kitchenName?: string | null;
  modifiers?: Array<{
    id: number;
    name: string;
    price: string;
    quantity: number;
  }>;
}

export interface OrderDiscountView {
  id: number;
  type: "percentage" | "flat" | "item" | "coupon" | "loyalty";
  amount: string;
  reason?: string | null;
  couponCode?: string | null;
  orderItemId?: number | null;
}

export interface OrderDetailView extends OrderHeader {
  items: OrderItemView[];
  discounts: OrderDiscountView[];
}

export interface DiscountsConfig {
  presetReasons?: string[];
  thresholdPct?: number | null;
  thresholdAmount?: number | null;
  hasManagerPin?: boolean;
  otpEnabled?: boolean;
  roleCaps?: Record<string, { pct?: number | null; amount?: number | null }>;
}

/**
 * Apply a discount to an order or single line.
 *
 * `idempotencyKey` is supplied by the renderer (one per user action) and
 * kept stable across retries so the server collapses duplicate clicks.
 */
export interface ApplyDiscountRequest {
  idempotencyKey?: string;
  orderId: number;
  type: "percentage" | "flat" | "item";
  value: number;
  reason: string;
  orderItemId?: number;
  managerPin?: string;
  managerOtp?: string;
}

// ─── Connection / session state stored in main process ──────────────────────
export interface ConnectionSettings {
  apiBaseUrl: string;
}

export interface SelectionState {
  restaurantId: number | null;
  branchId: number | null;
  branchName: string | null;
  counterId: string | null;
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
  /** Order/restaurant ids used by the printer engine to fetch the
   *  channel-mapped bill text from the API render endpoint. When present
   *  the engine prefers the API-rendered text so the thermal printer
   *  matches what web/mobile show; absent or on fetch failure we fall
   *  back to the local ESC/POS formatter. */
  orderId?: number;
  restaurantId?: number;
  /** Bill template channel for the API render endpoint
   *  (defaults to "desktop_pos"). */
  channel?: string;
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

  /** Resolve the tenant's plan feature flags. Calls the authenticated
   *  /api/restaurants/:id/subscription endpoint via the main-process
   *  ApiClient so cookies/tokens are attached correctly. The desktop
   *  shell uses the returned `features` Set to hide plan-locked nav
   *  items (Inventory, Purchase, Books, Growth, AI, Providers). */
  "plan:features": {
    req: { restaurantId: number };
    res: { features: string[]; planName: string | null };
  };

  // Outlets / counters ------------------------------------------------------
  "restaurants:list": { req: void; res: Restaurant[] };
  "branches:list": { req: { restaurantId: number }; res: Branch[] };
  "terminals:list": { req: { restaurantId: number; branchId?: number }; res: Terminal[] };

  // Selection persistence ---------------------------------------------------
  "selection:set-restaurant": { req: { restaurantId: number }; res: SelectionState };
  "selection:set-branch": { req: { branchId: number; branchName: string }; res: SelectionState };
  "selection:set-counter": { req: { counterId: string; counterName: string }; res: SelectionState };
  /** Phase A — local counter self-registration. Generates a stable machine
   *  UUID on first call and persists it. Subsequent calls update the
   *  display name only. No backend coordination — each desktop install is
   *  its own counter (Petpooja-style). */
  "selection:register-local-counter": { req: { counterName: string }; res: SelectionState };
  /** Returns the suggested counter name on first launch (OS hostname,
   *  trimmed). Lets the input field pre-fill with something sensible. */
  "selection:suggest-counter-name": { req: void; res: { suggestion: string; existingName: string | null } };

  // Shifts / cash register --------------------------------------------------
  "shifts:current": { req: void; res: CashRegisterCurrent };
  "shifts:open": {
    req: { openingCash: number; notes?: string };
    res: CashRegisterSession;
  };
  "shifts:close": {
    req: {
      sessionId: number;
      /** Quick-count shortcut — server prefers `denominations` when present. */
      countedAmount?: number;
      /** Full tray breakdown — preferred path. */
      denominations?: DenominationInput[];
      isBlindClose?: boolean;
      /** Required by the server when |variance| ≥ 0.01. */
      varianceReason?: string;
      closeNotes?: string;
      /** Manager PIN gate enforced renderer-side via discounts config. */
      managerPin?: string;
    };
    res: { zReport: ZReportSummary; blindClose: boolean };
  };

  // Menu --------------------------------------------------------------------
  /** Returns the restaurant info needed for tax + service-charge math. */
  "menu:restaurant": { req: void; res: RestaurantInfo };
  /** Phase-1 placeholder; now returns the menu bundle (categories+items). */
  "menu:list": { req: { force?: boolean } | void; res: { categories: MenuCategory[]; items: MenuItem[] } };
  "menu:categories": { req: void; res: MenuCategory[] };
  "menu:items": { req: { categoryId?: number; search?: string }; res: MenuItem[] };
  "menu:modifiers": { req: { menuItemId: number }; res: ModifierGroup[] };

  // Tables ------------------------------------------------------------------
  "tables:list": { req: void; res: FloorTable[] };
  /** Returns the in-progress (running) order on a dine-in table, if any.
   *  Lets the POS reopen the existing tab when a cashier taps an occupied
   *  table — matches the web POS auto-resume behaviour. */
  "tables:active-order": { req: { tableId: number }; res: { orderId: number | null } };

  // Customers ---------------------------------------------------------------
  "customers:search": {
    req: { search?: string; limit?: number };
    res: CustomerSummary[];
  };
  "customers:create": {
    req: { name?: string; phone?: string; email?: string };
    res: CustomerSummary;
  };
  /** Phase-1 placeholder, now wired. Accepts either a phone or a free-text query. */
  "customers:lookup": { req: { phone?: string; query?: string }; res: CustomerSummary[] };

  // Orders ------------------------------------------------------------------
  "orders:list": { req: { status?: string; limit?: number }; res: OrderHeader[] };
  "orders:detail": { req: { id: number }; res: OrderDetailView };
  "orders:create": { req: CreateOrderRequest; res: OrderDetailView };
  "orders:add-items": {
    req: { orderId: number; items: CartItemInput[]; idempotencyKey?: string };
    res: OrderDetailView;
  };
  "orders:update": { req: { id: number; patch: Partial<OrderHeader> }; res: OrderHeader };

  // Discounts ---------------------------------------------------------------
  "discounts:config": { req: void; res: DiscountsConfig };
  "discounts:apply": { req: ApplyDiscountRequest; res: OrderDetailView };
  "discounts:remove": {
    req: { orderId: number; discountId: number; idempotencyKey?: string };
    res: OrderDetailView;
  };

  // Payments (Phase 4) ------------------------------------------------------
  /** Legacy stub kept so older renderers don't crash on hot-reload. */
  "payments:record": { req: unknown; res: unknown };
  /** Create a Stripe PaymentIntent for an order (optionally a split share). */
  "payments:stripe-intent": {
    req: { orderId: number; customAmount?: number; tipAmount?: number };
    res: { clientSecret: string | null; intentId: string; mode: "live" | "demo"; totalAmount?: string | number };
  };
  /** Create a Razorpay order for an order (optionally a split share). */
  "payments:razorpay-order": {
    req: { orderId: number; customAmount?: number; tipAmount?: number };
    res: { id: string; amount: number; currency: string; keyId: string | null; mode: "live" | "demo" };
  };
  /** Send a charge to a card-present terminal (Stripe BBPOS / WisePOS). */
  "payments:terminal-charge": {
    req: { terminalDeviceId: number; orderId: number; amount: number; tipAmount?: number };
    res: { paymentIntentId: string; status: string };
  };
  /** Confirm a terminal charge — server records the payment + marks paid. */
  "payments:terminal-confirm": {
    req: { terminalDeviceId: number; orderId: number; paymentIntentId: string };
    res: OrderDetailView;
  };

  // Orders — pay / split (Phase 4) -----------------------------------------
  "orders:pay": {
    req: {
      orderId: number;
      paymentMethod: PayMethod;
      tipAmount?: number;
      stripePaymentIntentId?: string;
      razorpayPaymentId?: string;
      razorpayOrderId?: string;
      razorpaySignature?: string;
      idempotencyKey?: string;
    };
    res: OrderDetailView;
  };
  "orders:split": {
    req: {
      orderId: number;
      legs: SplitLeg[];
      idempotencyKey?: string;
    };
    res: OrderDetailView;
  };

  // Reports (Phase 4) -------------------------------------------------------
  "reports:shift-kpis": { req: { sessionId: number }; res: ShiftKpis };

  // Z-reports — cached locally for 30 days so reprints work offline ---------
  "zReports:list": { req: void; res: ZReportSummary[] };
  "zReports:get": { req: { sessionId: number }; res: ZReportSummary | null };
  "zReports:reprint": { req: { sessionId: number }; res: true };
  "printers:print-z-report": { req: ZReportSummary; res: true };

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

  // ─── Phase 5: connectivity / sync / local cache ─────────────────────────
  "connectivity:get": { req: void; res: ConnectivityState };
  "connectivity:probe": { req: void; res: ConnectivityState };
  "sync:status": { req: void; res: SyncStatusView };
  "sync:run-now": { req: void; res: SyncStatusView };
  "sync:conflicts:list": { req: void; res: ConflictEntry[] };
  "sync:conflicts:resolve": { req: { id: number; action: "discard" | "retry" | "skip" }; res: ConflictEntry[] };
  /** Side-by-side payload vs server response for a single conflict. */
  "sync:conflicts:diff": { req: { id: number }; res: ConflictDiff };
  /** Recent sync log entries (oldest-first capped). */
  "sync:logs": { req: { limit?: number }; res: SyncLogEntry[] };
  /** Drop reference cache (menu/tables/customers/etc.) while preserving the
   *  pending queue, conflicts, audit log, expenses, stock actions and held
   *  bills. Returns the post-clear local-store snapshot. */
  "sync:clear-cache": { req: { confirm: true }; res: LocalStoreInfo };
  "local:info": { req: void; res: LocalStoreInfo };
  "local:reset": { req: { confirm: true }; res: LocalStoreInfo };
  "local:hydrate": { req: void; res: { ok: true } };

  // Held bills — durable mirror of the renderer's parked carts. ------------
  "held-bills:list": { req: void; res: HeldBillRecord[] };
  "held-bills:save": { req: HeldBillRecord; res: HeldBillRecord };
  "held-bills:remove": { req: { id: string }; res: true };
  "held-bills:clear": { req: void; res: true };

  // Shift actions / expenses / stock / audit / print jobs ------------------
  "shift:cash-movement": {
    req: { kind: "in" | "out"; amount: number; reason?: string | null; sessionId?: number | null };
    res: CashMovementRecord;
  };
  "shift:list-cash-movements": {
    req: { sessionId?: number | null; limit?: number };
    res: CashMovementRecord[];
  };
  "shift:expense": {
    req: { amount: number; reason?: string | null; category?: string | null; sessionId?: number | null };
    res: ExpenseRecord;
  };
  "shift:list-expenses": {
    req: { sessionId?: number | null; limit?: number };
    res: ExpenseRecord[];
  };
  "stock:adjust": {
    req: {
      menuItemId?: number | null;
      ingredientId?: number | null;
      kind: "adjust" | "waste" | "transfer" | "spoil";
      quantity: number;
      unit?: string | null;
      reason?: string | null;
    };
    res: StockActionRecord;
  };
  "stock:list-actions": { req: { limit?: number }; res: StockActionRecord[] };
  "audit:log": {
    req: {
      action: string;
      target?: string | null;
      details?: unknown;
    };
    res: AuditLogRecord;
  };
  "audit:list": { req: { limit?: number; sinceMs?: number }; res: AuditLogRecord[] };
  "prints:record": {
    req: {
      id: string;
      kind: "kot" | "bill" | "z_report";
      orderId?: number | null;
      printerName?: string | null;
      status: "queued" | "sent" | "failed";
      lastError?: string | null;
      payload?: unknown;
    };
    res: PrintJobRecord;
  };
  "prints:list": { req: { limit?: number }; res: PrintJobRecord[] };
  // ─── Phase 6: specialist workspaces ────────────────────────────────────
  // Loose JSON responses — renderer narrows per-screen DTOs.
  "inv:list": { req: { lowStock?: boolean; search?: string }; res: unknown[] };
  "inv:adjust": {
    req: { id: number; type: "add" | "remove" | "use" | "waste" | "set";
           quantity: number; notes?: string; batchNumber?: string; expiryDate?: string };
    res: unknown;
  };
  "inv:transactions": { req: { id: number; limit?: number }; res: unknown[] };
  "inv:waste-log": { req: void; res: unknown[] };
  "inv:suppliers": { req: void; res: unknown[] };
  "inv:supplier-create": { req: { name: string; phone?: string; email?: string; address?: string }; res: unknown };
  "inv:purchase-orders": { req: { status?: string }; res: unknown[] };
  "inv:purchase-order-create": {
    req: { supplierId: number | null; notes?: string; expectedDate?: string;
           items: Array<{ inventoryItemId: number; quantity: number; unitCost: number }> };
    res: unknown;
  };
  "inv:purchase-order-receive": { req: { id: number }; res: unknown };
  "inv:menu-items-stock": { req: void; res: unknown[] };

  "acc:expenses": { req: { from?: string; to?: string; categoryId?: number; page?: number; limit?: number }; res: unknown };
  "acc:expense-create": {
    req: { categoryId: number; amount: number; expenseDate: string;
           payee?: string; paymentMethod?: string; notes?: string };
    res: unknown;
  };
  "acc:expense-categories": { req: void; res: unknown[] };
  "acc:expense-category-create": { req: { name: string; categoryKind?: string; color?: string; icon?: string }; res: unknown };
  "acc:payments-list": { req: { from?: string; to?: string; method?: string; page?: number; limit?: number }; res: unknown };
  "acc:payments-summary": { req: { from?: string; to?: string }; res: unknown };
  "acc:pnl": { req: { from?: string; to?: string }; res: unknown };
  "acc:targets": { req: void; res: unknown };

  "mkt:campaigns": { req: { status?: string; channel?: string; type?: string; goal?: string; q?: string }; res: unknown[] };
  "mkt:campaign-analytics": { req: void; res: unknown };
  "mkt:campaign-logs": { req: { limit?: number }; res: unknown[] };
  "mkt:campaign-draft": { req: { name?: string; channel?: string; type?: string; goal?: string }; res: unknown };
  "mkt:templates": { req: { channel: string }; res: unknown[] };
  "mkt:reviews-feedback": { req: { limit?: number }; res: unknown[] };
  "mkt:reviews-external": { req: { limit?: number }; res: unknown[] };
  "mkt:reviews-recovery": { req: { status?: string }; res: unknown[] };
  "mkt:coupons-validate": { req: { code: string }; res: unknown };
  "mkt:customers": { req: { search?: string; limit?: number }; res: unknown[] };

  "del:assignments": { req: { status?: string }; res: unknown[] };
  "del:executives": { req: void; res: unknown[] };
  "del:assign": { req: { orderId: number; riderId: number; notes?: string }; res: unknown };
  "del:update-status": {
    req: { assignmentId: number; status: "picked_up" | "delivered" | "cancelled";
           codCollected?: boolean };
    res: unknown;
  };
  "del:proof": { req: { assignmentId: number; proofPhotoUrl: string }; res: unknown };
  "del:unavailable": { req: { assignmentId: number; reason: string }; res: unknown };
  "del:cod-collected": { req: { assignmentId: number }; res: unknown };
  "del:cod-summary": { req: { from?: string; to?: string }; res: unknown };
  "del:handovers": { req: { limit?: number }; res: unknown[] };
  "del:handover-create": { req: { riderId: number; amount: number; notes?: string }; res: unknown };
  "del:aggregator-dashboard": { req: void; res: unknown };
  "del:aggregator-sheets": { req: void; res: unknown[] };
};

// ─── Phase 5 — connectivity / sync ─────────────────────────────────────────
export interface ConnectivityState {
  online: boolean;
  lastCheckedAt: number | null;
  latencyMs: number | null;
  error: string | null;
}

/** Sync Center category bucket. Stays in lock-step with `PendingCategory` in
 *  the main process — renderer uses these as tab keys and counters. */
export type SyncCategoryKey =
  | "shift" | "orders" | "payments" | "prints"
  | "expenses" | "stock" | "customers" | "audit"
  | "held_bills" | "other";

export interface SyncCategoryCounts {
  pending: number;
  failed: number;
  conflicts: number;
}

export interface SyncStatusView {
  online: boolean;
  draining: boolean;
  pending: number;
  conflicts: number;
  lastRunAt: number | null;
  lastError: string | null;
  /** Oldest-first queue summary (capped — UI only needs the head). */
  queue: Array<{
    id: number;
    kind: string;
    status: string;
    attempts: number;
    createdAt: number;
    summary: string;
    lastError: string | null;
  }>;
  /** Per-category breakdown rendered as tabs in the Sync Center. */
  categories: Record<SyncCategoryKey, SyncCategoryCounts>;
}

export interface ConflictEntry {
  id: number;
  opId: number;
  kind: string;
  summary: string;
  details: string | null;
  capturedAt: number;
}

/** Side-by-side payload / server-response diff for a single conflict. The
 *  renderer renders both blobs verbatim so the operator can compare. */
export interface ConflictDiff {
  id: number;
  opId: number;
  kind: string;
  summary: string;
  capturedAt: number;
  local: unknown;
  server: { status: number | null; body: unknown };
  message: string | null;
}

export interface SyncLogEntry {
  id: number;
  at: number;
  kind: string;
  opId: number | null;
  outcome: "synced" | "failed" | "conflict" | "retry" | string;
  details: string | null;
}

// ─── Held bills / shift actions / stock / audit / print jobs (Phase 5+) ───
/** A parked cart. Local-only — the server never sees a held bill. */
export interface HeldBillRecord {
  id: string;
  label: string;
  createdAt: number;
  orderType: OrderType;
  tableId?: number | null;
  tableLabel?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  cashier?: string | null;
  note?: string | null;
  /** Cart line snapshot. Renderer reshapes back into its `CartLine[]`. */
  lines: unknown;
}

export interface CashMovementRecord {
  id: string;
  sessionId: number | null;
  kind: "in" | "out";
  amount: number;
  reason: string | null;
  cashier: string | null;
  at: number;
  syncedAt: number | null;
}

export interface ExpenseRecord {
  id: string;
  sessionId: number | null;
  category: string | null;
  amount: number;
  reason: string | null;
  cashier: string | null;
  at: number;
  syncedAt: number | null;
}

export interface StockActionRecord {
  id: string;
  menuItemId: number | null;
  ingredientId: number | null;
  kind: "adjust" | "waste" | "transfer" | "spoil";
  quantity: number;
  unit: string | null;
  reason: string | null;
  cashier: string | null;
  at: number;
  syncedAt: number | null;
}

export interface AuditLogRecord {
  id: number;
  at: number;
  actor: string | null;
  action: string;
  target: string | null;
  details: unknown;
  syncedAt: number | null;
}

export interface PrintJobRecord {
  id: string;
  kind: "kot" | "bill" | "z_report";
  orderId: number | null;
  printerName: string | null;
  status: "queued" | "sent" | "failed";
  at: number;
  attempts: number;
  lastError: string | null;
}

export interface LocalStoreInfo {
  path: string;
  sizeBytes: number;
  counts: Record<string, number>;
  hydrateLastAt: number | null;
}

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

// ─── Phase 6: specialist workspaces (inventory / accounts / marketing / delivery) ──
//
// These IPC channels wrap existing REST endpoints. Responses are kept as
// loose `unknown` records so the renderer can type its own DTOs without
// adding a contract dependency for every field — the screens narrow the
// shape at the call site.

export type Json = unknown;
export interface ListReq { search?: string; limit?: number; }
export interface DateRangeReq { from?: string; to?: string; }

export interface SpecialistIpc {
  // Inventory ----------------------------------------------------------
  "inv:list": { req: { lowStock?: boolean; search?: string }; res: Json[] };
  "inv:adjust": {
    req: { id: number; type: "add" | "remove" | "use" | "waste" | "set";
           quantity: number; notes?: string; batchNumber?: string; expiryDate?: string };
    res: Json;
  };
  "inv:transactions": { req: { id: number; limit?: number }; res: Json[] };
  "inv:waste-log": { req: void; res: Json[] };
  "inv:suppliers": { req: void; res: Json[] };
  "inv:supplier-create": { req: { name: string; phone?: string; email?: string; address?: string }; res: Json };
  "inv:purchase-orders": { req: { status?: string }; res: Json[] };
  "inv:purchase-order-create": {
    req: { supplierId: number | null; notes?: string; expectedDate?: string;
           items: Array<{ inventoryItemId: number; quantity: number; unitCost: number }> };
    res: Json;
  };
  "inv:purchase-order-receive": { req: { id: number }; res: Json };
  "inv:menu-items-stock": { req: void; res: Json[] };

  // Accounts -----------------------------------------------------------
  "acc:expenses": { req: { from?: string; to?: string; categoryId?: number; page?: number; limit?: number }; res: Json };
  "acc:expense-create": {
    req: { categoryId: number; amount: number; expenseDate: string;
           payee?: string; paymentMethod?: string; notes?: string };
    res: Json;
  };
  "acc:expense-categories": { req: void; res: Json[] };
  "acc:expense-category-create": { req: { name: string; categoryKind?: string; color?: string; icon?: string }; res: Json };
  "acc:payments-list": { req: { from?: string; to?: string; method?: string; page?: number; limit?: number }; res: Json };
  "acc:payments-summary": { req: { from?: string; to?: string }; res: Json };
  "acc:pnl": { req: { from?: string; to?: string }; res: Json };
  "acc:targets": { req: void; res: Json };

  // Marketing ----------------------------------------------------------
  "mkt:campaigns": { req: { status?: string; channel?: string; type?: string; goal?: string; q?: string }; res: Json[] };
  "mkt:campaign-analytics": { req: void; res: Json };
  "mkt:campaign-logs": { req: { limit?: number }; res: Json[] };
  "mkt:campaign-draft": { req: { name?: string; channel?: string; type?: string; goal?: string }; res: Json };
  "mkt:templates": { req: { channel: string }; res: Json[] };
  "mkt:reviews-feedback": { req: { limit?: number }; res: Json[] };
  "mkt:reviews-external": { req: { limit?: number }; res: Json[] };
  "mkt:reviews-recovery": { req: { status?: string }; res: Json[] };
  "mkt:coupons-validate": { req: { code: string; restaurantId: number }; res: Json };
  "mkt:customers": { req: { search?: string; limit?: number }; res: Json[] };

  // Delivery -----------------------------------------------------------
  "del:assignments": { req: { status?: string }; res: Json[] };
  "del:executives": { req: void; res: Json[] };
  "del:assign": { req: { orderId: number; riderId: number; notes?: string }; res: Json };
  "del:update-status": {
    req: { assignmentId: number; status: "picked_up" | "delivered" | "cancelled";
           codCollected?: boolean };
    res: Json;
  };
  "del:proof": { req: { assignmentId: number; proofPhotoUrl: string }; res: Json };
  "del:unavailable": { req: { assignmentId: number; reason: string }; res: Json };
  "del:cod-collected": { req: { assignmentId: number }; res: Json };
  "del:cod-summary": { req: DateRangeReq; res: Json };
  "del:handovers": { req: { limit?: number }; res: Json[] };
  "del:handover-create": { req: { riderId: number; amount: number; notes?: string }; res: Json };
  "del:aggregator-dashboard": { req: void; res: Json };
  "del:aggregator-sheets": { req: void; res: Json[] };
}

export type IpcContract2 = IpcContract & SpecialistIpc;

export type IpcChannel = keyof IpcContract2;
export type IpcReq<C extends IpcChannel> = IpcContract2[C]["req"];
export type IpcRes<C extends IpcChannel> = IpcContract2[C]["res"];

export type IpcEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

// Channels for events main → renderer (no request shape).
export type IpcEventChannel =
  | "updates:event"
  | "auth:invalidated"
  | "printers:failed-changed"
  | "connectivity:state"
  | "sync:status-changed";
export interface UpdateEvent {
  type: "available" | "progress" | "downloaded" | "error" | "none";
  version?: string;
  percent?: number;
  message?: string;
}
