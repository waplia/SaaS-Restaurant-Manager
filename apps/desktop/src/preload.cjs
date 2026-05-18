// Preload — exposes a small, safe surface to the renderer (the web app).
// All native work happens in the main process; the renderer only sees
// promise-returning RPC functions.
const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("khanalagao", {
  platform: process.platform,
  isDesktop: true,
  printer: {
    describe: () => invoke("khanalagao:printer:describe"),
    list: () => invoke("khanalagao:printer:list"),
    save: (printer) => invoke("khanalagao:printer:save", printer),
    remove: (id) => invoke("khanalagao:printer:remove", id),
    setDefault: (id) => invoke("khanalagao:printer:setDefault", id),
    test: (id) => invoke("khanalagao:printer:test", id),
  },
  // Primary print entry-point used by the web app's print buttons.
  // Accepts { template: "receipt" | "kot" | "raw", payload, printerId? }.
  print: (args) => invoke("khanalagao:printer:print", args),
});
