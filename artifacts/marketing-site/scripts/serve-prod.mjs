// Tiny production static server for the marketing site.
//
// - Serves files from dist/public.
// - Sends Cache-Control: public, max-age=31536000, immutable for hashed assets
//   under /assets/ (the filenames are content-hashed by Vite).
// - Sends Cache-Control: no-cache for index.html (and any other HTML) so users
//   always pick up the newest build pointer.
// - Compresses responses (gzip/brotli) via the compression middleware.
// - Falls back to index.html for unknown routes so the SPA can handle them.
//
// The dev workflow uses `vite dev`; this script is used in production
// (e.g. `pnpm serve:prod`) so that caching headers and compression are
// applied consistently across deployments.

import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, "..", "dist", "public");

const rawPort = process.env.PORT;
if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const app = express();
app.disable("x-powered-by");
app.use(compression());

// Hashed assets — safe to cache forever. Use fallthrough: false so a missing
// /assets/* file returns a real 404 instead of being rewritten to index.html
// (which would otherwise mask broken chunk URLs by serving HTML to a <script>
// or <link> tag).
app.use(
  "/assets",
  express.static(path.join(distDir, "assets"), {
    immutable: true,
    maxAge: "1y",
    fallthrough: false,
  }),
);

// Everything else (favicon, robots, sitemap, etc.) — short-lived cache.
app.use(
  express.static(distDir, {
    etag: true,
    lastModified: true,
    maxAge: "1h",
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);

// SPA fallback — serve index.html for unknown routes, never cached.
// Express 5 / path-to-regexp v8 no longer accepts a bare "*" path, so we
// register a middleware that runs after express.static has already had a
// chance to serve real files.
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`[marketing-site] serving ${distDir} on http://0.0.0.0:${port}`);
});
