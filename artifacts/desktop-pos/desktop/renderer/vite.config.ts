import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
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
    sourcemap: true,
    target: "chrome120",
  },
});
