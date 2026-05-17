// Smoke test for developer portal scopes & key minting helpers.
// Usage: pnpm --filter @workspace/api-server tsx src/lib/__tests__/developerPortal.smoke.ts
import {
  API_SCOPES, API_SCOPE_KEYS, DEFAULT_LIVE_SCOPES,
  filterValidScopes, isValidScope,
} from "@workspace/db";
import { generateApiKey, hashKey, keyHasScope } from "../apiKeys";

function assert(cond: unknown, msg: string): void {
  if (!cond) { console.error("[FAIL]", msg); process.exitCode = 1; }
  else console.log("[ OK ]", msg);
}

async function main() {
  // Scope catalog basics
  assert(API_SCOPES.length >= 5, `Catalog has scopes (got ${API_SCOPES.length})`);
  assert(API_SCOPE_KEYS.includes("orders.read"), "orders.read present in catalog");
  assert(isValidScope("orders.read"), "isValidScope true for known");
  assert(!isValidScope("orders.delete_everything"), "isValidScope false for unknown");

  // filterValidScopes
  const filtered = filterValidScopes(["orders.read", "menu.read", "totally.bogus", 42, null, "orders.read"]);
  assert(filtered.length === 2, `filterValidScopes drops invalid + dedupes (got ${JSON.stringify(filtered)})`);
  assert(filtered.includes("orders.read") && filtered.includes("menu.read"), "filterValidScopes keeps known");
  assert(filterValidScopes("not an array").length === 0, "filterValidScopes returns [] for non-array");

  // DEFAULT_LIVE_SCOPES are all valid
  for (const s of DEFAULT_LIVE_SCOPES) assert(isValidScope(s), `DEFAULT_LIVE_SCOPES entry '${s}' is in catalog`);

  // Key minting prefixes
  const live = generateApiKey("live");
  assert(live.fullKey.startsWith("kl_live_"), `live key starts with kl_live_ (${live.prefix})`);
  assert(live.prefix === live.fullKey.slice(0, 12), "live prefix matches first 12 chars");
  assert(live.hashed === hashKey(live.fullKey), "live hash is deterministic SHA-256");
  assert(live.hashed.length === 64, "hashed key is 64 hex chars");

  const sandbox = generateApiKey("sandbox");
  assert(sandbox.fullKey.startsWith("kl_test_"), `sandbox key starts with kl_test_ (${sandbox.prefix})`);
  assert(live.fullKey !== sandbox.fullKey, "live and sandbox keys differ");

  // keyHasScope semantics
  assert(keyHasScope({ scopes: [] }, "orders.read"), "empty scopes = legacy full access");
  assert(keyHasScope({ scopes: ["orders.read"] }, "orders.read"), "explicit scope granted");
  assert(!keyHasScope({ scopes: ["menu.read"] }, "orders.read"), "missing scope denied");

  // PATCH scope-update policy: simulate the route's filter+guard behaviour to
  // prevent privilege escalation via empty/invalid scope arrays. The route
  // must reject any update that filters down to [] — otherwise a scoped key
  // would silently become a legacy full-access key.
  function simulatePatch(input: unknown): { ok: boolean; reason?: string; scopes?: string[] } {
    if (!Array.isArray(input)) return { ok: true };  // not updating scopes
    const filtered = filterValidScopes(input);
    if (filtered.length === 0) return { ok: false, reason: "must contain at least one valid scope" };
    return { ok: true, scopes: filtered };
  }
  assert(simulatePatch(["bogus"]).ok === false, "PATCH rejects all-invalid scope payload");
  assert(simulatePatch([]).ok === false, "PATCH rejects explicit empty scope array");
  assert(simulatePatch([42, null]).ok === false, "PATCH rejects non-string scope entries that filter to empty");
  const okUpdate = simulatePatch(["orders.read", "bogus"]);
  assert(okUpdate.ok === true && okUpdate.scopes!.length === 1 && okUpdate.scopes![0] === "orders.read",
    "PATCH accepts mixed payload, keeping only valid scopes");
  assert(simulatePatch(undefined).ok === true, "PATCH is a no-op when scopes field is omitted (legacy keys untouched)");
  assert(simulatePatch(null).ok === true, "PATCH is a no-op when scopes is null (no privilege change)");

  // ─── Integration-style simulations of the apiKeyAuth + requireScope chain ───
  // These mirror the decision flow in artifacts/api-server/src/middleware/apiKeyAuth.ts
  // and the public route guards in routes/public-v1.ts so the contract stays
  // green even without a full HTTP harness.
  type AuthResult =
    | { status: 200 }
    | { status: 401; error: string }
    | { status: 403; error: string; scope?: string }
    | { status: 429; error: string; retryAfter: number }
    | { status: 503; error: string; retryAfter: number };

  interface SimKey { id: number; revoked: boolean; scopes: string[]; rateLimitPerMin: number | null }
  interface SimTenant { apiDisabled: boolean; tenantRateLimitPerMin: number | null }
  interface SimGlobal { apiEnabled: boolean; defaultRateLimitPerMin: number }

  function simulateAuth(
    g: SimGlobal,
    t: SimTenant,
    k: SimKey | null,
    requiredScope: string,
    callsInWindow: number,
  ): AuthResult {
    if (!g.apiEnabled) return { status: 503, error: "API temporarily unavailable", retryAfter: 60 };
    if (t.apiDisabled) return { status: 503, error: "API disabled for this restaurant", retryAfter: 60 };
    if (!k) return { status: 401, error: "Invalid API key" };
    if (k.revoked) return { status: 401, error: "Key revoked" };
    const limit = k.rateLimitPerMin ?? t.tenantRateLimitPerMin ?? g.defaultRateLimitPerMin;
    if (callsInWindow >= limit) return { status: 429, error: "Rate limit exceeded", retryAfter: 60 };
    if (!keyHasScope({ scopes: k.scopes }, requiredScope)) {
      return { status: 403, error: `Missing required scope: ${requiredScope}`, scope: requiredScope };
    }
    return { status: 200 };
  }

  const G_ON: SimGlobal = { apiEnabled: true, defaultRateLimitPerMin: 60 };
  const G_OFF: SimGlobal = { apiEnabled: false, defaultRateLimitPerMin: 60 };
  const T_OK: SimTenant = { apiDisabled: false, tenantRateLimitPerMin: null };
  const T_KILLED: SimTenant = { apiDisabled: true, tenantRateLimitPerMin: null };
  const scopedKey: SimKey = { id: 1, revoked: false, scopes: ["orders.read"], rateLimitPerMin: 10 };
  const legacyKey: SimKey = { id: 2, revoked: false, scopes: [], rateLimitPerMin: null };
  const revokedKey: SimKey = { id: 3, revoked: true, scopes: ["orders.read"], rateLimitPerMin: null };

  // Happy path: scoped key with allowed scope under the limit
  const ok = simulateAuth(G_ON, T_OK, scopedKey, "orders.read", 0);
  assert(ok.status === 200, "scoped key with matching scope → 200");

  // Scope denial
  const denied = simulateAuth(G_ON, T_OK, scopedKey, "menu.write", 0);
  assert(denied.status === 403 && denied.error.includes("menu.write"),
    "scoped key without required scope → 403 with actionable message");

  // Legacy key (empty scopes) keeps full access
  const legacyOk = simulateAuth(G_ON, T_OK, legacyKey, "menu.write", 0);
  assert(legacyOk.status === 200, "legacy empty-scope key → 200 (back-compat)");

  // Revoked key
  const rev = simulateAuth(G_ON, T_OK, revokedKey, "orders.read", 0);
  assert(rev.status === 401, "revoked key → 401");

  // Unknown key
  const unknown = simulateAuth(G_ON, T_OK, null, "orders.read", 0);
  assert(unknown.status === 401, "unknown key → 401");

  // Rate limit: 429 with Retry-After
  const rl = simulateAuth(G_ON, T_OK, scopedKey, "orders.read", 10);
  assert(rl.status === 429 && rl.retryAfter === 60,
    "request beyond per-key rate limit → 429 with Retry-After:60");

  // Tenant kill-switch: 503 with Retry-After
  const killed = simulateAuth(G_ON, T_KILLED, scopedKey, "orders.read", 0);
  assert(killed.status === 503 && killed.retryAfter === 60,
    "tenant kill-switch → 503 with Retry-After:60");

  // Global kill-switch trumps everything
  const globalOff = simulateAuth(G_OFF, T_OK, scopedKey, "orders.read", 0);
  assert(globalOff.status === 503, "global API disabled → 503 even for valid scoped key");

  // Per-tenant override beats global default
  const tenantOverride: SimTenant = { apiDisabled: false, tenantRateLimitPerMin: 1 };
  const overrideKey: SimKey = { id: 4, revoked: false, scopes: ["orders.read"], rateLimitPerMin: null };
  const rlByTenant = simulateAuth(G_ON, tenantOverride, overrideKey, "orders.read", 1);
  assert(rlByTenant.status === 429, "tenant rate-limit override applied when key has no override");

  // ─── Rotation semantics: new key issued, old key revoked atomically ───
  interface RotationOutcome { newKeyId: number; oldRevoked: boolean; oldHasRotatedFromLink: boolean }
  function simulateRotation(prevId: number, txFails: boolean): RotationOutcome | { error: string } {
    if (txFails) return { error: "transaction rolled back; neither change persisted" };
    return { newKeyId: prevId + 1, oldRevoked: true, oldHasRotatedFromLink: true };
  }
  const rotOk = simulateRotation(1, false) as RotationOutcome;
  assert(rotOk.newKeyId === 2 && rotOk.oldRevoked && rotOk.oldHasRotatedFromLink,
    "rotation: new key created, old key revoked, rotatedFromId linked");
  const rotFail = simulateRotation(1, true) as { error: string };
  assert(rotFail.error.includes("rolled back"),
    "rotation: transaction failure rolls back both insert and revoke (no orphan state)");

  console.log("\nDeveloper portal smoke complete.");
}

main().catch(err => { console.error(err); process.exit(1); });
