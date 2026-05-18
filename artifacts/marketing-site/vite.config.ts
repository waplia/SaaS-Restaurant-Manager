import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// PORT / BASE_PATH are only needed by the dev/preview server. During a
// production `vite build` (e.g. the deploy pipeline) neither value is
// supplied, so we fall back to safe defaults instead of throwing.
const isBuild = process.argv.includes("build");

const rawPort = process.env.PORT;
if (!rawPort && !isBuild) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}
const port = rawPort ? Number(rawPort) : 5173;
if (rawPort && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePathEnv = process.env.BASE_PATH;
if (!basePathEnv && !isBuild) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}
const basePath = basePathEnv ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    target: "es2020",
    cssCodeSplit: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (
            id.match(/[\\/]node_modules[\\/](react|react-dom|scheduler|wouter)[\\/]/)
          ) {
            return "react-vendor";
          }
          if (id.match(/[\\/]node_modules[\\/](framer-motion|motion-utils|motion-dom)[\\/]/)) {
            return "motion-vendor";
          }
          if (id.includes("lucide-react") || id.includes("react-icons")) {
            return "icons-vendor";
          }
          if (id.includes("@tanstack/react-query")) {
            return "query-vendor";
          }
          if (
            id.includes("react-markdown") ||
            id.match(/[\\/]node_modules[\\/](remark-|micromark|mdast-|unist-|hast-|property-information|space-separated-tokens|comma-separated-tokens|character-entities|decode-named-character|html-url-attributes|trim-lines|vfile|bail|is-plain-obj|trough|zwitch|ccount|markdown-table|longest-streak|escape-string-regexp)/)
          ) {
            return "markdown-vendor";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
