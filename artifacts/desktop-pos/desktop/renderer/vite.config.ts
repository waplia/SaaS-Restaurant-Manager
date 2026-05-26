import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// `command === "build"` is set by Vite for production bundles (`vite build`)
// regardless of how the parent process spawned us, so sourcemaps are
// reliably stripped from the shipped `.dmg` / `.exe` payload. `vite` /
// `vite dev` keep maps for DevTools.
export default defineConfig(({ command }) => ({
  root: __dirname,
  base: "./",
  plugins: [react()],
  server: {
    port: 5180,
    host: "127.0.0.1",
    strictPort: true,
  },
  build: {
    outDir: path.resolve(__dirname, "../../dist/renderer"),
    emptyOutDir: true,
    sourcemap: command !== "build",
    target: "chrome120",
  },
}));
