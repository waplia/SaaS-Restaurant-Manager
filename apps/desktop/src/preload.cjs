// Minimal preload — kept intentionally tiny.
// Future native bridges (e.g. local printer bridge) can attach here via contextBridge.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("khanalagao", {
  platform: process.platform,
  isDesktop: true,
});
