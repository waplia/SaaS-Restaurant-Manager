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

  // Placeholders for later phases (Phase 2/3/4 will wire bodies). Defined
  // here so the preload surface and types lock in now.
  "menu:list": { req: void; res: unknown };
  "menu:categories": { req: void; res: unknown };
  "orders:list": { req: { status?: string }; res: unknown };
  "orders:create": { req: unknown; res: unknown };
  "orders:update": { req: { id: number; patch: unknown }; res: unknown };
  "customers:lookup": { req: { phone?: string; query?: string }; res: unknown };
  "payments:record": { req: unknown; res: unknown };

  // Printers / hardware (Phase 3 will exercise these end-to-end). Defined
  // in the contract now so the renderer surface is fully typed and the
  // boundary doesn't drift later.
  "printers:list": { req: void; res: Array<{ name: string; isDefault: boolean }> };
  "printers:test": { req: { printerName: string }; res: true };
  "printers:print-receipt": { req: ReceiptPrintRequest; res: true };
  "printers:print-kot": { req: KotPrintRequest; res: true };
  "drawer:open": { req: { printerName?: string }; res: true };
  "failed-prints:list": { req: void; res: Array<{ id: string; at: number; entry: unknown }> };
  "failed-prints:add": { req: unknown; res: true };
  "failed-prints:clear": { req: void; res: true };
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
export type IpcEventChannel = "updates:event" | "auth:invalidated";
export interface UpdateEvent {
  type: "available" | "progress" | "downloaded" | "error" | "none";
  version?: string;
  percent?: number;
  message?: string;
}
