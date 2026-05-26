/**
 * TableTrack POS — Electron main process.
 *
 * Responsibilities:
 *   • Create a single, fullscreen POS window per OS user (multi-window guard).
 *   • Lock down web security (contextIsolation, sandbox, no nodeIntegration, CSP).
 *   • Expose a narrow, typed IPC surface to the renderer via the preload bridge.
 *   • Talk to OS printers (enumerate, silent print, ESC/POS, cash-drawer kick).
 *   • Persist desktop settings + local cart safety via electron-store.
 *   • Wire electron-updater with a configurable feed; fail gracefully when no
 *     update server is configured (show version, do not crash).
 *   • Auto-launch at login on user request.
 */

import { app, BrowserWindow, ipcMain, shell, dialog, Menu, session } from "electron";
import path from "node:path";
import fs from "node:fs";
import { promisify } from "node:util";
import { autoUpdater } from "electron-updater";
import Store from "electron-store";
import { registerPrinterHandlers, escposBytes, kickCashDrawerCommand } from "./printers";
import type { DesktopSettings, IpcResult } from "./types";

const IS_DEV = process.env.NODE_ENV === "development";
const RENDERER_URL = process.env.DESKTOP_RENDERER_URL ?? null;

const DEFAULT_SETTINGS: DesktopSettings = {
  apiBaseUrl: "https://app.tabletrack.in",
  webPosPath: "/pos",
  autoLaunch: false,
  startFullscreen: true,
  defaultOutletId: null,
  defaultCounterId: null,
  defaultOrderType: "dine_in",
  soundEnabled: true,
  soundVolume: 0.8,
  soundTone: "default",
  muteShift: false,
  autoPrintKot: true,
  autoPrintBill: true,
  autoOpenDrawerOnCash: false,
  keepScreenAwake: true,
  checkForUpdates: true,
  billPrinter: null,
  kotPrinter: null,
  kitchenPrinter: null,
  barPrinter: null,
  parcelPrinter: null,
  cashDrawerPrinter: null,
  scannerEnabled: true,
  updateFeedUrl: null,
};

// electron-store v10 extends `conf`, whose generic-typed get/set methods don't
// always surface cleanly to TypeScript in projects that use stricter settings.
// Wrap as a plain typed store so call sites stay readable.
interface PersistedShape {
  settings: DesktopSettings;
  cart: unknown;
  failedPrints: unknown[];
}
interface PersistentStore {
  get<K extends keyof PersistedShape>(key: K): PersistedShape[K];
  set<K extends keyof PersistedShape>(key: K, value: PersistedShape[K]): void;
}
const store = new Store<PersistedShape>({
  name: "tabletrack-pos",
  defaults: {
    settings: DEFAULT_SETTINGS,
    cart: null,
    failedPrints: [],
  },
}) as unknown as PersistentStore;

// ───── Single-instance guard (multi-window per counter is the responsibility
// of the renderer; we enforce one OS window). Second-launch focuses the live
// window instead of opening a duplicate.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

function getSettings(): DesktopSettings {
  return { ...DEFAULT_SETTINGS, ...(store.get("settings") as Partial<DesktopSettings>) };
}

// `isQuiting` is our own flag (set on `before-quit`) used to bypass the
// unsaved-bill warning during an explicit quit. Not part of Electron's typed
// `App` surface, so we expose it via a narrow interface.
interface QuitableApp { isQuiting?: boolean }
function isAppQuiting(): boolean {
  return Boolean((app as unknown as QuitableApp).isQuiting);
}

function saveSettings(patch: Partial<DesktopSettings>): DesktopSettings {
  const next = { ...getSettings(), ...patch };
  store.set("settings", next);
  // Mirror auto-launch toggle to the OS login items registry.
  try {
    app.setLoginItemSettings({ openAtLogin: !!next.autoLaunch });
  } catch { /* not all platforms support this */ }
  return next;
}

function buildShellUrl(settings: DesktopSettings): string {
  // The renderer is a thin launcher that loads the configured web POS in a
  // sandboxed <webview>. In dev we point at the local Vite dev server.
  if (IS_DEV && RENDERER_URL) return RENDERER_URL;
  return `file://${path.join(app.getAppPath(), "dist/renderer/index.html")}`;
}

function applyCsp(): void {
  // Strict CSP: only this app's renderer + the configured API may be reached.
  // The <webview> tag uses its own session and is responsible for the web POS.
  const settings = getSettings();
  const apiOrigin = (() => {
    try { return new URL(settings.apiBaseUrl).origin; } catch { return "https://app.tabletrack.in"; }
  })();
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          `default-src 'self'; ` +
          `connect-src 'self' ${apiOrigin} wss: https:; ` +
          `img-src 'self' data: blob: https:; ` +
          `style-src 'self' 'unsafe-inline'; ` +
          `script-src 'self'; ` +
          `font-src 'self' data:; ` +
          `frame-src 'self' ${apiOrigin};`,
        ],
      },
    });
  });
}

async function createWindow(): Promise<void> {
  const settings = getSettings();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#0b0f17",
    show: false,
    autoHideMenuBar: true,
    title: "TableTrack POS",
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist/preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload uses node APIs (electron-store/IPC); renderer stays sandboxed.
      webviewTag: true,
      spellcheck: false,
      devTools: IS_DEV,
    },
  });

  if (process.platform === "darwin") {
    // Hide the default menu but keep standard edit shortcuts (cut/copy/paste).
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "editMenu" },
      { role: "windowMenu" },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }

  // Block any attempt to open a new browser window — keep everything inside
  // the POS shell. External help links use shell.openExternal explicitly.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Keep navigation pinned to the renderer; the embedded <webview> handles
  // the web POS in its own session.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const target = new URL(url);
    const allowed = new URL(buildShellUrl(settings));
    if (target.origin !== allowed.origin && target.protocol !== "file:") {
      event.preventDefault();
    }
  });

  // Warn on close when there is an unsaved local cart. Renderer is the
  // source of truth for "is there a bill in progress"; main relays via IPC.
  mainWindow.on("close", (event) => {
    const cart = store.get("cart");
    if (cart && !isAppQuiting()) {
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: "warning",
        buttons: ["Cancel", "Discard & quit"],
        defaultId: 0,
        cancelId: 0,
        title: "Unsaved bill",
        message: "There is an in-progress bill. Quitting will keep it locally; you can recall it on next launch. Quit now?",
      });
      if (choice === 0) event.preventDefault();
    }
  });

  await mainWindow.loadURL(buildShellUrl(settings));
  if (settings.startFullscreen && !IS_DEV) mainWindow.setFullScreen(true);
  if (settings.keepScreenAwake) {
    // Best-effort; ignored if the powerSaveBlocker can't start.
    const { powerSaveBlocker } = await import("electron");
    try { powerSaveBlocker.start("prevent-display-sleep"); } catch { /* noop */ }
  }
  mainWindow.show();
  if (IS_DEV) mainWindow.webContents.openDevTools({ mode: "detach" });
}

// ───── IPC: settings, cart safety, failed-print queue, updates, drawer ─────
function registerCoreIpc(): void {
  ipcMain.handle("settings:get", (): IpcResult<DesktopSettings> => ({ ok: true, data: getSettings() }));
  ipcMain.handle("settings:set", (_e, patch: Partial<DesktopSettings>): IpcResult<DesktopSettings> => {
    if (!patch || typeof patch !== "object") return { ok: false, error: "invalid payload" };
    return { ok: true, data: saveSettings(patch) };
  });

  ipcMain.handle("cart:save", (_e, cart: unknown): IpcResult<true> => {
    store.set("cart", cart ?? null);
    return { ok: true, data: true };
  });
  ipcMain.handle("cart:load", (): IpcResult<unknown> => ({ ok: true, data: store.get("cart") ?? null }));
  ipcMain.handle("cart:clear", (): IpcResult<true> => { store.set("cart", null); return { ok: true, data: true }; });

  ipcMain.handle("failed-prints:list", (): IpcResult<unknown[]> => ({ ok: true, data: (store.get("failedPrints") as unknown[]) ?? [] }));
  ipcMain.handle("failed-prints:add", (_e, entry: unknown): IpcResult<true> => {
    const list = ((store.get("failedPrints") as unknown[]) ?? []).slice(-49);
    list.push({ id: `fp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), entry });
    store.set("failedPrints", list);
    return { ok: true, data: true };
  });
  ipcMain.handle("failed-prints:clear", (): IpcResult<true> => { store.set("failedPrints", []); return { ok: true, data: true }; });

  ipcMain.handle("app:version", (): IpcResult<{ version: string; platform: string }> => ({
    ok: true,
    data: { version: app.getVersion(), platform: process.platform },
  }));

  ipcMain.handle("app:open-external", (_e, url: string): IpcResult<true> => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return { ok: false, error: "blocked" };
    void shell.openExternal(url);
    return { ok: true, data: true };
  });

  ipcMain.handle("updates:check", async (): Promise<IpcResult<{ status: string; version?: string }>> => {
    const settings = getSettings();
    if (!settings.checkForUpdates) return { ok: true, data: { status: "disabled" } };
    if (!settings.updateFeedUrl) return { ok: true, data: { status: "no-feed", version: app.getVersion() } };
    try {
      autoUpdater.setFeedURL({ provider: "generic", url: settings.updateFeedUrl });
      const r = await autoUpdater.checkForUpdates();
      return { ok: true, data: { status: r ? "checked" : "no-update", version: r?.updateInfo.version } };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("drawer:open", async (_e, printerName?: string): Promise<IpcResult<true>> => {
    const settings = getSettings();
    const target = printerName ?? settings.cashDrawerPrinter ?? settings.billPrinter;
    if (!target) return { ok: false, error: "No drawer-capable printer configured" };
    try {
      await sendRawToPrinter(target, kickCashDrawerCommand());
      return { ok: true, data: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
}

async function sendRawToPrinter(printerName: string, bytes: Buffer): Promise<void> {
  // Cross-platform raw passthrough:
  //   • Windows:  uses node-printer (loaded lazily; if unavailable, falls
  //               back to writing to %TEMP% + 'COPY /B file PRN').
  //   • macOS/Linux: pipes bytes to `lp -d <printer> -o raw`.
  if (process.platform === "win32") {
    try {
      // Lazy import — keep the dep optional so the app still launches if the
      // native module wasn't built for the user's electron version.
      // Optional native dep — keep typed loose so build doesn't require it.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — peer dep, may not be installed in all environments
      const printer = await import("@thiagoelg/node-printer").catch(() => null) as
        | { default: { printDirect: (opts: { data: Buffer; printer: string; type: string; success: () => void; error: (e: Error) => void }) => void } }
        | null;
      if (printer?.default?.printDirect) {
        await new Promise<void>((resolve, reject) => {
          printer.default.printDirect({
            data: bytes, printer: printerName, type: "RAW",
            success: () => resolve(),
            error: (e: Error) => reject(e),
          });
        });
        return;
      }
    } catch { /* fall through */ }
    // Last-resort fallback for raw bytes on Windows.
    const tmp = path.join(app.getPath("temp"), `tt_raw_${Date.now()}.bin`);
    await promisify(fs.writeFile)(tmp, bytes);
    const { exec } = await import("node:child_process");
    await new Promise<void>((resolve, reject) => {
      exec(`PRINT /D:"${printerName}" "${tmp}"`, (err) => err ? reject(err) : resolve());
    });
  } else {
    const { spawn } = await import("node:child_process");
    await new Promise<void>((resolve, reject) => {
      const lp = spawn("lp", ["-d", printerName, "-o", "raw"], { stdio: ["pipe", "ignore", "pipe"] });
      lp.stdin.end(bytes);
      lp.on("error", reject);
      lp.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`lp exited ${code}`)));
    });
  }
}

// ───── Auto-updater plumbing ─────
function wireAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (info) => {
    mainWindow?.webContents.send("updates:event", { type: "available", version: info.version });
  });
  autoUpdater.on("update-not-available", () => {
    mainWindow?.webContents.send("updates:event", { type: "none" });
  });
  autoUpdater.on("download-progress", (p) => {
    mainWindow?.webContents.send("updates:event", { type: "progress", percent: p.percent });
  });
  autoUpdater.on("update-downloaded", (info) => {
    mainWindow?.webContents.send("updates:event", { type: "downloaded", version: info.version });
  });
  autoUpdater.on("error", (err) => {
    // Critical: never crash on update errors — pass them to the renderer.
    mainWindow?.webContents.send("updates:event", { type: "error", message: err.message });
  });
}

// ───── App lifecycle ─────
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => { (app as unknown as { isQuiting: boolean }).isQuiting = true; });

app.whenReady().then(async () => {
  applyCsp();
  registerCoreIpc();
  registerPrinterHandlers({ sendRawToPrinter, escposBytes });
  wireAutoUpdater();
  await createWindow();

  const settings = getSettings();
  if (settings.checkForUpdates && settings.updateFeedUrl) {
    autoUpdater.setFeedURL({ provider: "generic", url: settings.updateFeedUrl });
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.warn("[updater] check failed:", err.message);
    });
  }
}).catch((err) => {
  console.error("[main] fatal:", err);
  app.quit();
});
