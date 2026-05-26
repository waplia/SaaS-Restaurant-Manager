/**
 * Persisted main-process settings. Phase 1 keeps the surface small —
 * just the connection URL, behaviour toggles, and the printer slots that
 * Phase 3 will hand to the print subsystem.
 *
 * Selection (restaurant/branch/counter) and auth tokens live in a separate
 * store namespace (`session-store.ts`) so wiping a logged-out terminal
 * does not also wipe the cashier's printer choices.
 */
export interface DesktopSettings {
  /** Base URL of the Khanalagao API (e.g. https://app.khanalagao.in). */
  apiBaseUrl: string;
  autoLaunch: boolean;
  startFullscreen: boolean;
  keepScreenAwake: boolean;
  checkForUpdates: boolean;
  /** OS printer names — wired up in Phase 3. Null = not assigned. */
  billPrinter: string | null;
  kotPrinter: string | null;
  kitchenPrinter: string | null;
  barPrinter: string | null;
  parcelPrinter: string | null;
  cashDrawerPrinter: string | null;
  /** electron-updater generic feed URL; null = no auto-updates configured. */
  updateFeedUrl: string | null;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Print payloads now live in `desktop/shared/ipc-contract.ts` (as
// ReceiptPrintRequest / KotPrintRequest) so renderer + main share one source.
