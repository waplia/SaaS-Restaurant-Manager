/**
 * Requirements trace: every WebAdminBridge deep-link in the Manager
 * Office registry must resolve to a real route in the web-admin
 * router. This guards against "dead button" regressions where a tab
 * in the bridge would land on a 404 page inside the embedded webview.
 *
 * Pure file-level assertion — we read the source of both files,
 * extract the route literals, and check membership.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REGISTRY = join(__dirname, "..", "..", "renderer", "src", "workspaces", "manager", "registry.tsx");
const APP = join(__dirname, "..", "..", "..", "..", "restaurant-platform", "src", "App.tsx");

function extractAdminRoutes(): Set<string> {
  const src = readFileSync(APP, "utf8");
  const set = new Set<string>();
  const re = /<Route\s+path="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) set.add(m[1]);
  return set;
}

/** Match a registry path against the route set, accounting for `:param`
 *  patterns in the route table (e.g. `/competitors/:id` matches a
 *  registry link to `/competitors`). */
function matches(path: string, routes: Set<string>): boolean {
  if (routes.has(path)) return true;
  const segs = path.split("/").filter(Boolean);
  for (const route of routes) {
    const rsegs = route.split("/").filter(Boolean);
    if (rsegs.length !== segs.length) continue;
    let ok = true;
    for (let i = 0; i < rsegs.length; i++) {
      if (rsegs[i].startsWith(":")) continue;
      if (rsegs[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return true;
  }
  // `/settings/:section` catch-all in the admin router covers any
  // `/settings/<single-segment>` deep-link we ship.
  if (segs.length === 2 && segs[0] === "settings" && routes.has("/settings/:section")) return true;
  return false;
}

function extractRegistryPaths(): string[] {
  const src = readFileSync(REGISTRY, "utf8");
  const re = /path:\s*"(\/[^"]*)"/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

describe("Manager registry deep-links", () => {
  const routes = extractAdminRoutes();
  const paths = extractRegistryPaths();

  it("extracts a non-empty set of web-admin routes", () => {
    expect(routes.size).toBeGreaterThan(50);
  });

  it("extracts a non-empty set of registry deep-links", () => {
    expect(paths.length).toBeGreaterThan(20);
  });

  it("every WebAdminBridge path resolves to a web-admin route", () => {
    const dead = paths.filter(p => !matches(p, routes));
    expect(dead, `Dead deep-links in Manager registry:\n  ${dead.join("\n  ")}`).toEqual([]);
  });
});
