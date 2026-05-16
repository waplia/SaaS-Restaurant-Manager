// Smoke test for the pricing rules engine — runs offline (no DB) and exits
// non-zero on any failed assertion.
//   pnpm --filter @workspace/api-server tsx src/lib/__tests__/pricingRules.smoke.ts
import { applyAdjustment, pickRule, ruleMatches, __testing } from "../pricingRules";

type AnyRule = Parameters<typeof applyAdjustment>[1];

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

function makeRule(overrides: Partial<AnyRule> & { id: number }): AnyRule {
  return {
    restaurantId: 1,
    name: `r${overrides.id}`,
    ruleType: "custom",
    description: null,
    isActive: true,
    priority: 100,
    scopeKind: "all",
    scopeIds: [],
    adjustmentKind: "percent_off",
    adjustmentValue: "10",
    startDate: null,
    endDate: null,
    daysOfWeek: [],
    startTime: null,
    endTime: null,
    channels: [],
    branchIds: [],
    customerGroups: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AnyRule;
}

const item = { id: 10, price: 100, categoryId: 5 };
const at = new Date("2026-05-16T17:00:00.000Z");

// --- adjustments ---
check("percent_off applies", applyAdjustment(100, makeRule({ id: 1, adjustmentKind: "percent_off", adjustmentValue: "20" })) === 80);
check("percent_up applies", applyAdjustment(100, makeRule({ id: 2, adjustmentKind: "percent_up", adjustmentValue: "15" })) === 115);
check("flat_off applies", applyAdjustment(100, makeRule({ id: 3, adjustmentKind: "flat_off", adjustmentValue: "30" })) === 70);
check("fixed_price applies", applyAdjustment(100, makeRule({ id: 4, adjustmentKind: "fixed_price", adjustmentValue: "49.5" })) === 49.5);
check("flat_off cannot go negative", applyAdjustment(20, makeRule({ id: 5, adjustmentKind: "flat_off", adjustmentValue: "999" })) === 0);

// --- ruleMatches: time / day / channel / branch / customerGroup / scope ---
const happyHour = makeRule({ id: 100, startTime: "16:00", endTime: "18:00" });
check("time within window matches", ruleMatches(happyHour, { item, at: new Date("2026-05-16T17:00:00"), customerGroups: ["regular"] }));
check("time outside window rejected", !ruleMatches(happyHour, { item, at: new Date("2026-05-16T19:00:00"), customerGroups: ["regular"] }));

const weekend = makeRule({ id: 101, daysOfWeek: [0, 6] });
check("day-of-week match", ruleMatches(weekend, { item, at: new Date("2026-05-16T12:00:00"), customerGroups: ["regular"] })); // Sat
check("day-of-week reject", !ruleMatches(weekend, { item, at: new Date("2026-05-18T12:00:00"), customerGroups: ["regular"] })); // Mon

const deliveryOnly = makeRule({ id: 102, channels: ["delivery"] });
check("channel match", ruleMatches(deliveryOnly, { item, at, channel: "delivery", customerGroups: ["regular"] }));
check("channel reject", !ruleMatches(deliveryOnly, { item, at, channel: "dine_in", customerGroups: ["regular"] }));

const outletRule = makeRule({ id: 103, branchIds: [7] });
check("branch match", ruleMatches(outletRule, { item, at, branchId: 7, customerGroups: ["regular"] }));
check("branch reject", !ruleMatches(outletRule, { item, at, branchId: 8, customerGroups: ["regular"] }));

const vipRule = makeRule({ id: 104, customerGroups: ["vip", "loyalty_gold"] });
check("customer group match (vip)", ruleMatches(vipRule, { item, at, customerGroups: ["regular", "vip"] }));
check("customer group reject (regular only)", !ruleMatches(vipRule, { item, at, customerGroups: ["regular"] }));

const catRule = makeRule({ id: 105, scopeKind: "category", scopeIds: [5] });
check("category scope match", ruleMatches(catRule, { item, at, customerGroups: ["regular"] }));
check("category scope reject", !ruleMatches(catRule, { item: { ...item, categoryId: 9 }, at, customerGroups: ["regular"] }));

const itemRule = makeRule({ id: 106, scopeKind: "item", scopeIds: [10] });
check("item scope match", ruleMatches(itemRule, { item, at, customerGroups: ["regular"] }));
check("item scope reject", !ruleMatches(itemRule, { item: { ...item, id: 99 }, at, customerGroups: ["regular"] }));

const inactive = makeRule({ id: 107, isActive: false });
check("inactive rule rejected", !ruleMatches(inactive, { item, at, customerGroups: ["regular"] }));

const dated = makeRule({ id: 108, startDate: new Date("2026-06-01"), endDate: new Date("2026-06-30") });
check("date window outside reject", !ruleMatches(dated, { item, at, customerGroups: ["regular"] }));
check("date window inside match", ruleMatches(dated, { item, at: new Date("2026-06-15T12:00:00"), customerGroups: ["regular"] }));

// --- pickRule: priority > specificity > fixed_price beats > id ---
const lowPrioItem = makeRule({ id: 200, priority: 50, scopeKind: "item", scopeIds: [10], adjustmentKind: "fixed_price", adjustmentValue: "10" });
const highPrioAll = makeRule({ id: 201, priority: 100, scopeKind: "all", adjustmentKind: "percent_off", adjustmentValue: "5" });
check("priority wins over specificity", pickRule([lowPrioItem, highPrioAll])?.id === 201);

const cat = makeRule({ id: 202, priority: 100, scopeKind: "category", scopeIds: [5] });
const itemSame = makeRule({ id: 203, priority: 100, scopeKind: "item", scopeIds: [10] });
const all = makeRule({ id: 204, priority: 100, scopeKind: "all" });
check("specificity tie-break: item > category > all", pickRule([all, cat, itemSame])?.id === 203);

const fixed = makeRule({ id: 205, priority: 100, scopeKind: "all", adjustmentKind: "fixed_price", adjustmentValue: "20" });
const percent = makeRule({ id: 206, priority: 100, scopeKind: "all", adjustmentKind: "percent_off", adjustmentValue: "20" });
check("fixed_price beats percent on tie", pickRule([percent, fixed])?.id === 205);

// --- customer groups derivation ---
check("guest when no snapshot", JSON.stringify(__testing.customerGroupsFor(null)) === JSON.stringify(["guest"]));
check("regular + loyalty_silver at 500 points", __testing.customerGroupsFor({ isVip: false, loyaltyPoints: 500 }).includes("loyalty_silver"));
check("vip flagged", __testing.customerGroupsFor({ isVip: true, loyaltyPoints: 0 }).includes("vip"));
check("loyalty_platinum at 5000", __testing.customerGroupsFor({ isVip: false, loyaltyPoints: 5000 }).includes("loyalty_platinum"));

// --- midnight-crossing time window ---
const lateNight = { startTime: "22:00", endTime: "02:00" } as const;
check("midnight window: 23:30 inside", __testing.withinTimeWindow(lateNight.startTime, lateNight.endTime, new Date("2026-05-16T23:30:00")));
check("midnight window: 01:30 inside", __testing.withinTimeWindow(lateNight.startTime, lateNight.endTime, new Date("2026-05-17T01:30:00")));
check("midnight window: 12:00 outside", !__testing.withinTimeWindow(lateNight.startTime, lateNight.endTime, new Date("2026-05-17T12:00:00")));

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll pricing-rule assertions passed.");
