// Smoke test for the gift card service — runs offline (pure helpers) and
// exits non-zero on any failed assertion. Database-backed flows (issue, redeem,
// transfer, refund, expireDue, salesReport) are exercised via API/E2E rather
// than this script, since they require a tenant context.
//   pnpm --filter @workspace/api-server tsx src/lib/__tests__/giftCards.smoke.ts
import {
  genGiftCardCode,
  normalizeCode,
  maskCode,
  toCsv,
  GiftCardError,
} from "../giftCards";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

// ── code generation ─────────────────────────────────────────────────────────
const c1 = genGiftCardCode();
const c2 = genGiftCardCode();
check("generated code matches GC-XXXXXXXX format", /^GC-[0-9A-F]{8}$/.test(c1), c1);
check("generated codes are unique across calls", c1 !== c2);
check("custom prefix honored", /^XYZ-[0-9A-F]{8}$/.test(genGiftCardCode("XYZ")));

// ── normalization ───────────────────────────────────────────────────────────
check("normalizeCode upper-cases", normalizeCode("gc-deadbeef") === "GC-DEADBEEF");
check("normalizeCode trims and removes whitespace", normalizeCode("  gc dead beef  ") === "GCDEADBEEF");
check("normalizeCode is idempotent", normalizeCode(normalizeCode("gc-AbCd1234")) === "GC-ABCD1234");

// ── masking ─────────────────────────────────────────────────────────────────
check("maskCode hides middle of long codes", maskCode("GC-ABCDEFGH") === "GC-****GH");
check("maskCode collapses very short codes", maskCode("AB") === "****");

// ── CSV serialization ───────────────────────────────────────────────────────
const csv = toCsv([
  { code: "GC-1", amount: 100, note: "hello, world" },
  { code: "GC-2", amount: 250, note: 'has "quote"' },
  { code: "GC-3", amount: null, note: undefined },
]);
const lines = csv.split("\n");
check("CSV header lists keys from first row", lines[0] === "code,amount,note");
check("CSV escapes commas with quotes", lines[1].includes('"hello, world"'));
check("CSV escapes embedded quotes by doubling", lines[2].includes('"has ""quote"""'));
check("CSV emits empty cells for null/undefined", lines[3] === "GC-3,,");
check("toCsv on empty array returns empty string", toCsv([]) === "");

// ── error type ──────────────────────────────────────────────────────────────
const err = new GiftCardError("expired", "Card has expired", 409);
check("GiftCardError carries code", err.code === "expired");
check("GiftCardError carries status", err.status === 409);
check("GiftCardError default status is 400", new GiftCardError("x", "y").status === 400);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll gift-card smoke assertions passed.");
