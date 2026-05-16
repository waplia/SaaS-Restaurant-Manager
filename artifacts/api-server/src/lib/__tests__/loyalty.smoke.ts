// Smoke test for Loyalty 2.0 engine. Verifies pure helpers without DB.
// Usage: pnpm --filter @workspace/api-server tsx src/lib/__tests__/loyalty.smoke.ts
import { DEFAULT_LOYALTY2 } from "../loyalty/types";
import { isEnabled, mergeWithDefaults } from "../loyalty/config";
import { activeDoublePointsMultiplier } from "../loyalty/doublePoints";
import { isBirthdayWithinWindow } from "../loyalty/birthday";
import { pickWeighted } from "../loyalty/mystery";

function assert(cond: unknown, msg: string) {
  if (cond) console.log("[ OK ]", msg);
  else { console.error("[FAIL]", msg); process.exitCode = 1; }
}

async function main() {
  // 1) Master switch defaults OFF — protects existing tenants from auto-activation.
  assert(DEFAULT_LOYALTY2.enabled === false, "DEFAULT_LOYALTY2 master enabled === false");
  assert(DEFAULT_LOYALTY2.tiers.length >= 1, "DEFAULT_LOYALTY2 ships with at least one tier");

  // 2) When master is off, every mechanic reports disabled regardless of per-mechanic flag.
  for (const m of ["tiers", "stamps", "cashback", "referral", "mystery", "streak", "milestones", "birthday", "doublePoints", "itemRules", "family"] as const) {
    assert(isEnabled(DEFAULT_LOYALTY2, m) === false, `mechanic '${m}' off when master is off`);
  }

  // 3) Mechanic enables iff master on, feature flag not explicitly false, AND mechanic-specific cfg is enabled.
  const cbOn = mergeWithDefaults({ enabled: true, cashback: { ...DEFAULT_LOYALTY2.cashback, enabled: true } });
  assert(isEnabled(cbOn, "cashback") === true, "cashback on when master on AND cashback.enabled=true");
  const cbFlagOff = mergeWithDefaults({ enabled: true, cashback: { ...DEFAULT_LOYALTY2.cashback, enabled: true }, featureFlags: { cashback: false } });
  assert(isEnabled(cbFlagOff, "cashback") === false, "cashback off when per-mechanic feature flag is explicitly false");

  // 4) Double-points helper handles disabled cfg.
  const dpOff = activeDoublePointsMultiplier({ cfg: { enabled: false, rules: [{ id: "x", label: "any", multiplier: 3 }] } });
  assert(dpOff.multiplier === 1, "disabled doublePoints cfg yields 1× and no rule");

  // 5) Birthday window matches today's DOB and rejects null.
  const today = new Date();
  const dob = `1990-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  assert(isBirthdayWithinWindow(dob, 1) === true, "today's DOB matches 1-day window");
  assert(isBirthdayWithinWindow(null, 30) === false, "null DOB never matches");

  // 6) Weighted picker is total-weight-aware (deterministic given a fixed rng).
  const pool = [
    { key: "a", label: "A", weight: 1, rewardType: "points" as const, rewardValue: 1 },
    { key: "b", label: "B", weight: 99, rewardType: "points" as const, rewardValue: 1 },
  ];
  assert(pickWeighted(pool, () => 0.5)?.key === "b", "weighted pick favors high-weight option at rand=0.5");
  assert(pickWeighted(pool, () => 0.001)?.key === "a", "low rand picks first option");

  console.log("\nLoyalty 2.0 smoke tests complete.");
}

main().catch(e => { console.error(e); process.exit(1); });
