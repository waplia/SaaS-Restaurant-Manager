// Electron main process for the Khana Lagao desktop wrapper.
// Loads the production Restaurant Platform web app in a native window.
const { app, BrowserWindow, Menu, shell, session, ipcMain } = require("electron");
const path = require("path");
const { createBridge } = require("./print-bridge.cjs");

// Load apps/desktop/.env (if present) so APP_URL / API_URL overrides work
// without requiring the user to export them in the shell first.
try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
} catch (_err) {
  // dotenv is optional — env vars from the shell still work without it.
}

let updater = null;
try {
  ({ autoUpdater: updater } = require("electron-updater"));
} catch (_err) {
  updater = null;
}

const DEFAULT_APP_URL = "https://khanalagao.com/app/";
const APP_URL = process.env.APP_URL || DEFAULT_APP_URL;
const API_URL = process.env.API_URL || "";

let mainWindow = null;
let splashWindow = null;
let printBridge = null;

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 360,
    height: 220,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    transparent: false,
    show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: "#fff7f1",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    title: "Khana Lagao",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (API_URL) {
    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
      (details, cb) => {
        cb({ requestHeaders: { ...details.requestHeaders, "X-Api-Url": API_URL } });
      },
    );
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    if (splashWindow) splashWindow.close();
    mainWindow.show();
  });

  mainWindow.loadURL(APP_URL);
}

function buildMenu() {
  const template = [
    {
      label: "App",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: [
        {
          label: "Khana Lagao",
          click: () => shell.openExternal("https://khanalagao.com"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerPrinterIpc() {
  printBridge = createBridge(app.getPath("userData"));

  const wrap = (fn) => async (_event, payload) => {
    try {
      return await fn(payload);
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  };

  ipcMain.handle("khanalagao:printer:describe", wrap(async () => printBridge.describe()));
  ipcMain.handle("khanalagao:printer:list", wrap(async () => printBridge.listPrinters()));
  ipcMain.handle("khanalagao:printer:save", wrap(async (p) => printBridge.savePrinter(p)));
  ipcMain.handle("khanalagao:printer:remove", wrap(async (id) => printBridge.removePrinter(id)));
  ipcMain.handle("khanalagao:printer:setDefault", wrap(async (id) => printBridge.setDefaultPrinter(id)));
  ipcMain.handle("khanalagao:printer:test", wrap(async (id) => printBridge.testPrint(id)));
  ipcMain.handle("khanalagao:printer:print", wrap(async (args) => printBridge.print(args || {})));
}

app.whenReady().then(async () => {
  // Persist cookies + localStorage across launches.
  await session.defaultSession.cookies
    .flushStore()
    .catch(() => undefined);

  buildMenu();
  registerPrinterIpc();
  createSplash();
  createMainWindow();

  if (updater) {
    try {
      updater.autoDownload = true;
      updater.checkForUpdatesAndNotify().catch(() => undefined);
    } catch (_err) {
      // ignore — updater is best-effort
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
