/**
 * Khanalagao POS — Electron main process.
 *
 * Responsibilities:
 *   • Create one fullscreen window (single-instance guard).
 *   • Strict CSP, contextIsolation, sandbox=false (preload uses Node), no
 *     nodeIntegration in renderer, no <webview> tag.
 *   • Own the HTTP client to the Khanalagao API; renderer only sees IPC.
 *   • Persist connection settings + auth tokens + selection in electron-store.
 *   • Wire printer / drawer / scanner subsystem + auto-updater.
 */

import { app, BrowserWindow, ipcMain, shell, Menu, session } from "electron";
import path from "node:path";
import fs from "node:fs";
import { promisify } from "node:util";
import { autoUpdater } from "electron-updater";
import Store from "electron-store";
import { registerPrinterHandlers, escposBytes, kickCashDrawerCommand } from "./printers";
import type { PrinterEngine } from "./printers";
import { ApiClient } from "./api/client";
import { registerApiIpc } from "./ipc";
import { Connectivity } from "./sync/connectivity";
import { SyncEngine } from "./sync/engine";
import { hydrateAll } from "./sync/hydrate";
import { getDb } from "./db";
import { sessionStore } from "./session-store";
import type { DesktopSettings } from "./types";
import type {
  PrinterAssignments, DrawerSettings, FailedPrintEntry, ZReportSummary,
} from "../shared/ipc-contract";

const IS_DEV = process.env.NODE_ENV === "development";
const RENDERER_URL = process.env.DESKTOP_RENDERER_URL ?? null;

const DEFAULT_SETTINGS: DesktopSettings = {
  apiBaseUrl: "https://khanalagao.com",
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
  kitchenPrinters: {},
  drawerKickBefore: false,
  scannerEnabled: true,
  updateFeedUrl: null,
};

interface PersistedShape {
  settings: DesktopSettings;
  failedPrints: FailedPrintEntry[];
  /** Phase 4 — local cache of post-close Z-reports for reprints. */
  zReports: ZReportSummary[];
}
interface PersistentStore {
  get<K extends keyof PersistedShape>(key: K): PersistedShape[K];
  set<K extends keyof PersistedShape>(key: K, value: PersistedShape[K]): void;
}
const store = new Store<PersistedShape>({
  name: "khanalagao-pos",
  defaults: { settings: DEFAULT_SETTINGS, failedPrints: [], zReports: [] },
}) as unknown as PersistentStore;

const Z_REPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
function zReportCacheAdapter() {
  function readAll(): ZReportSummary[] {
    const raw = (store.get("zReports") as ZReportSummary[]) ?? [];
    const cutoff = Date.now() - Z_REPORT_TTL_MS;
    const fresh = raw.filter((r) => (r.cachedAt ?? 0) >= cutoff);
    if (fresh.length !== raw.length) store.set("zReports", fresh);
    return fresh;
  }
  return {
    list(): ZReportSummary[] {
      return readAll().sort((a, b) => (b.cachedAt ?? 0) - (a.cachedAt ?? 0));
    },
    get(sessionId: number): ZReportSummary | null {
      return readAll().find((r) => r.sessionId === sessionId) ?? null;
    },
    upsert(report: ZReportSummary): void {
      const all = readAll().filter((r) => r.sessionId !== report.sessionId);
      store.set("zReports", [...all, { ...report, cachedAt: report.cachedAt || Date.now() }]);
    },
  };
}

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
    catch { return "https://khanalagao.com"; }
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
  ipcMain.handle("updates:check", async () => {
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
      // @ts-ignore — optional peer dep, may fail on Mac arm64 / Linux ARM
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
    } catch { /* fall through to PRINT shell-out */ }
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

// ─── Printer assignments + drawer + failed-prints persistence adapters ─────
function getAssignments(): PrinterAssignments {
  const s = getSettings();
  return {
    billPrinter: s.billPrinter,
    kotPrinter: s.kotPrinter,
    kitchenPrinter: s.kitchenPrinter,
    barPrinter: s.barPrinter,
    parcelPrinter: s.parcelPrinter,
    cashDrawerPrinter: s.cashDrawerPrinter,
    kitchenPrinters: s.kitchenPrinters ?? {},
  };
}

function setAssignments(patch: Partial<PrinterAssignments>): PrinterAssignments {
  const mapped: Partial<DesktopSettings> = {};
  if ("billPrinter" in patch) mapped.billPrinter = patch.billPrinter ?? null;
  if ("kotPrinter" in patch) mapped.kotPrinter = patch.kotPrinter ?? null;
  if ("kitchenPrinter" in patch) mapped.kitchenPrinter = patch.kitchenPrinter ?? null;
  if ("barPrinter" in patch) mapped.barPrinter = patch.barPrinter ?? null;
  if ("parcelPrinter" in patch) mapped.parcelPrinter = patch.parcelPrinter ?? null;
  if ("cashDrawerPrinter" in patch) mapped.cashDrawerPrinter = patch.cashDrawerPrinter ?? null;
  if ("kitchenPrinters" in patch) mapped.kitchenPrinters = patch.kitchenPrinters ?? {};
  saveSettings(mapped);
  return getAssignments();
}

function getDrawerSettings(): DrawerSettings {
  return { kickBefore: !!getSettings().drawerKickBefore };
}
function setDrawerSettings(patch: Partial<DrawerSettings>): DrawerSettings {
  const next = saveSettings({
    drawerKickBefore: patch.kickBefore !== undefined ? !!patch.kickBefore : getSettings().drawerKickBefore,
  });
  return { kickBefore: !!next.drawerKickBefore };
}

function failedStore() {
  return {
    list(): FailedPrintEntry[] {
      return (store.get("failedPrints") as FailedPrintEntry[]) ?? [];
    },
    add(entry: FailedPrintEntry): void {
      const list = (store.get("failedPrints") as FailedPrintEntry[]) ?? [];
      // Cap at 50 entries — drop oldest first.
      const next = [...list, entry].slice(-50);
      store.set("failedPrints", next);
    },
    update(id: string, patch: Partial<FailedPrintEntry>): void {
      const list = (store.get("failedPrints") as FailedPrintEntry[]) ?? [];
      store.set("failedPrints", list.map((x) => x.id === id ? { ...x, ...patch } : x));
    },
    remove(id: string): void {
      const list = (store.get("failedPrints") as FailedPrintEntry[]) ?? [];
      store.set("failedPrints", list.filter((x) => x.id !== id));
    },
    clear(): void {
      store.set("failedPrints", []);
    },
  };
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
  const printerEngine: PrinterEngine = registerPrinterHandlers({
    sendRawToPrinter,
    escposBytes,
    getAssignments,
    setAssignments,
    getDrawerSettings,
    setDrawerSettings,
    getScannerEnabled: () => !!getSettings().scannerEnabled,
    setScannerEnabled: (v: boolean) => !!saveSettings({ scannerEnabled: v }).scannerEnabled,
    failedStore: failedStore(),
    notifyFailedChanged: () => mainWindow?.webContents.send("printers:failed-changed"),
  });
  // Keep the legacy `drawer:open` channel reachable even when no printer
  // module assignments have been wired; the printer handler also registers
  // a richer version that takes per-call printer overrides.
  void kickCashDrawerCommand;
  // ─── Phase 5 — open the local SQLite cache + start sync subsystem ──────
  getDb();
  const connectivity = new Connectivity(() => getSettings().apiBaseUrl);
  const syncEngine = new SyncEngine(
    apiClient,
    () => sessionStore.getSelection().restaurantId ?? sessionStore.getUser()?.restaurantId ?? null,
    () => sessionStore.getSelection().branchId ?? null,
    () => connectivity.current().online,
  );
  connectivity.on("change", (state) => {
    if (state.online) {
      void syncEngine.drain();
      const rid = sessionStore.getSelection().restaurantId ?? sessionStore.getUser()?.restaurantId;
      if (rid) hydrateAll(apiClient, rid).catch((err) =>
        console.warn("[hydrate] failed:", (err as Error).message));
    }
  });
  connectivity.start();

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
    printerEngine,
    zReportCache: zReportCacheAdapter(),
    connectivity,
    syncEngine,
  });
  wireAutoUpdater();
  await createWindow();

  // Hydrate every 5 minutes while online + signed in.
  setInterval(() => {
    if (!connectivity.current().online) return;
    const rid = sessionStore.getSelection().restaurantId ?? sessionStore.getUser()?.restaurantId;
    if (rid) hydrateAll(apiClient, rid).catch(() => {/* logged inside */});
  }, 5 * 60 * 1000);

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
