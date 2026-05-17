#!/usr/bin/env node
// Fails the build if the marketing site imports anything from sibling
// admin/customer artifacts. Those artifacts ship a huge amount of code
// (Drizzle, internal forms, admin tables, etc.) and pulling even a single
// symbol from them would balloon the public bundle.
//
// Allowed workspace imports are explicitly listed below — currently the only
// shared module the marketing site uses is `@workspace/db/planFeatures`
// (a tiny constants file with no runtime deps) and the API client.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, "..", "src");

// Match both static `from "..."` imports/re-exports and dynamic `import("...")`
// calls (including `await import(...)`), so a lazy-loaded admin module can't
// sneak into the public bundle either.
const FORBIDDEN_TARGETS = [
  "@workspace/restaurant-platform",
  "@workspace/api-server",
  "@workspace/tabletrack-mobile",
  "@workspace/mockup-sandbox",
  "../../../restaurant-platform",
  "../../../api-server",
  "../../../tabletrack-mobile",
  "../../../mockup-sandbox",
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const FORBIDDEN = FORBIDDEN_TARGETS.flatMap((target) => {
  const t = escapeRe(target);
  return [
    new RegExp(`from\\s+['"]${t}`),
    new RegExp(`import\\s*\\(\\s*['"]${t}`),
    new RegExp(`require\\s*\\(\\s*['"]${t}`),
    new RegExp(`export\\s+(?:\\*|\\{[^}]*\\})\\s+from\\s+['"]${t}`),
  ];
});

let violations = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) continue;
    const text = readFileSync(full, "utf8");
    for (const pattern of FORBIDDEN) {
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (pattern.test(line)) {
          violations += 1;
          console.error(
            `[marketing-site] forbidden import in ${path.relative(process.cwd(), full)}:${i + 1}`,
          );
          console.error(`    ${line.trim()}`);
        }
      });
    }
  }
}

walk(srcDir);

if (violations > 0) {
  console.error(
    `\n[marketing-site] ${violations} forbidden import(s) found. The marketing` +
      " site must not import code from admin/api/mobile artifacts.",
  );
  process.exit(1);
}

console.log("[marketing-site] no forbidden cross-artifact imports found.");
