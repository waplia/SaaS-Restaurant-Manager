/**
 * Khanalagao POS — Electron main process (Phase 1: native shell, no webview).
 *
 * Responsibilities:
 *   • Create one fullscreen window (single-instance guard).
 *   • Strict CSP, contextIsolation, sandbox=false (preload uses Node), no
 *     nodeIntegration in renderer, no <webview> tag.
 *   • Own the HTTP client to the Khanalagao API; renderer only sees IPC.
 *   • Persist connection settings + auth tokens + selection in electron-store.
 *   • Keep printer IPC + auto-updater wiring (Phase 3 will use them).
 */

import { app, BrowserWindow, ipcMain, shell, Menu, session } from "electron";
import path from "node:path";
import fs from "node:fs";
import { promisify } from "node:util";
import { autoUpdater } from "electron-updater";
import Store from "electron-store";
import { registerPrinterHandlers, escposBytes, kickCashDrawerCommand } from "./printers";
import { ApiClient } from "./api/client";
import { registerApiIpc } from "./ipc";
import type { DesktopSettings, IpcResult } from "./types";

const IS_DEV = process.env.NODE_ENV === "development";
const RENDERER_URL = process.env.DESKTOP_RENDERER_URL ?? null;

const DEFAULT_SETTINGS: DesktopSettings = {
  apiBaseUrl: "https://app.tabletrack.in",
  autoLaunch: false,
  startFullscreen: true,
  keepScreenAwake: true,
  checkForUpdates: true,
  billPrinter: null,
  kotPrinter: null,
  kitchenPrinter: null,
  barPrinter: null,
  parcelPrinter: null,
  cashDrawerPrinter: null,
  updateFeedUrl: null,
};

interface PersistedShape {
  settings: DesktopSettings;
  failedPrints: unknown[];
}
interface PersistentStore {
  get<K extends keyof PersistedShape>(key: K): PersistedShape[K];
  set<K extends keyof PersistedShape>(key: K, value: PersistedShape[K]): void;
}
const store = new Store<PersistedShape>({
  name: "khanalagao-pos",
  defaults: { settings: DEFAULT_SETTINGS, failedPrints: [] },
}) as unknown as PersistentStore;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let mainWindow: BrowserWindow | null = null;

function getSettings(): DesktopSettings {
  return { ...DEFAULT_SETTINGS, ...(store.get("settings") as Partial<DesktopSettings>) };
}

function saveSettings(patch: Partial<DesktopSettings>): DesktopSettings {
  const next = { ...getSettings(), ...patch };
  store.set("settings", next);
  try { app.setLoginItemSettings({ openAtLogin: !!next.autoLaunch }); } catch { /* ignore */ }
  return next;
}

function buildShellUrl(): string {
  if (IS_DEV && RENDERER_URL) return RENDERER_URL;
  return `file://${path.join(app.getAppPath(), "dist/renderer/index.html")}`;
}

function applyCsp(): void {
  const apiOrigin = (() => {
    try { return new URL(getSettings().apiBaseUrl).origin; }
    catch { return "https://app.tabletrack.in"; }
  })();
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          `default-src 'self'; ` +
          `connect-src 'self' ${apiOrigin} ws://localhost:5180 http://localhost:5180; ` +
          `img-src 'self' data: blob: https:; ` +
          `style-src 'self' 'unsafe-inline'; ` +
          `script-src 'self'; ` +
          `font-src 'self' data:;`,
        ],
      },
    });
  });
}

const apiClient = new ApiClient(getSettings().apiBaseUrl);

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
    title: "Khanalagao POS",
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist/preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false,
      spellcheck: false,
      devTools: IS_DEV,
    },
  });

  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = new URL(buildShellUrl());
    const target = new URL(url);
    if (target.origin !== allowed.origin && target.protocol !== "file:") {
      event.preventDefault();
    }
  });

  await mainWindow.loadURL(buildShellUrl());
  if (settings.startFullscreen && !IS_DEV) mainWindow.setFullScreen(true);
  if (settings.keepScreenAwake) {
    const { powerSaveBlocker } = await import("electron");
    try { powerSaveBlocker.start("prevent-display-sleep"); } catch { /* ignore */ }
  }
  mainWindow.show();
  if (IS_DEV) mainWindow.webContents.openDevTools({ mode: "detach" });
}

function registerCoreIpc(): void {
  ipcMain.handle("failed-prints:list", (): IpcResult<unknown[]> => ({
    ok: true, data: (store.get("failedPrints") as unknown[]) ?? [],
  }));
  ipcMain.handle("failed-prints:add", (_e, entry: unknown): IpcResult<true> => {
    const list = ((store.get("failedPrints") as unknown[]) ?? []).slice(-49);
    list.push({ id: `fp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), entry });
    store.set("failedPrints", list);
    return { ok: true, data: true };
  });
  ipcMain.handle("failed-prints:clear", (): IpcResult<true> => {
    store.set("failedPrints", []); return { ok: true, data: true };
  });

  ipcMain.handle("drawer:open", async (_e, req?: { printerName?: string }): Promise<IpcResult<true>> => {
    const settings = getSettings();
    const target = req?.printerName ?? settings.cashDrawerPrinter ?? settings.billPrinter;
    if (!target) return { ok: false, error: "No drawer-capable printer configured" };
    try {
      await sendRawToPrinter(target, kickCashDrawerCommand());
      return { ok: true, data: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
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
}

async function sendRawToPrinter(printerName: string, bytes: Buffer): Promise<void> {
  if (process.platform === "win32") {
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — optional peer dep
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
    mainWindow?.webContents.send("updates:event", { type: "error", message: err.message });
  });
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.whenReady().then(async () => {
  applyCsp();
  registerCoreIpc();
  registerPrinterHandlers({ sendRawToPrinter, escposBytes });
  registerApiIpc({
    client: apiClient,
    settings: {
      get: () => ({ apiBaseUrl: getSettings().apiBaseUrl }),
      set: (patch) => {
        const next = saveSettings(patch);
        return { apiBaseUrl: next.apiBaseUrl };
      },
    },
    getWindow: () => mainWindow,
  });
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
