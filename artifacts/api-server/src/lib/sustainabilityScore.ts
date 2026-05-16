import { and, eq, gte, lte, sql } from "drizzle-orm";
import {
  db,
  sustainabilityFoodWasteTable,
  sustainabilityPackagingTable,
  sustainabilityDonationsTable,
  sustainabilityLocalVendorsTable,
  sustainabilityReusablePackagingTable,
  sustainabilityEnergyTable,
  sustainabilityWaterTable,
  sustainabilityCarbonTable,
  sustainabilityMonthlyScoresTable,
  restaurantsTable,
  ordersTable,
} from "./db";

export type SustainabilityFactorKey =
  | "waste"
  | "packaging"
  | "donations"
  | "local_vendors"
  | "reusable"
  | "energy"
  | "water";

export const SUSTAINABILITY_FACTOR_LABELS: Record<SustainabilityFactorKey, string> = {
  waste: "Food Waste Control",
  packaging: "Eco Packaging",
  donations: "Donation Activity",
  local_vendors: "Local Sourcing",
  reusable: "Reusable Packaging",
  energy: "Energy Tracking",
  water: "Water Tracking",
};

export const SUSTAINABILITY_WEIGHTS: Record<SustainabilityFactorKey, number> = {
  waste: 25,
  packaging: 20,
  donations: 10,
  local_vendors: 15,
  reusable: 15,
  energy: 8,
  water: 7,
};

export type SustainabilitySubScores = Record<SustainabilityFactorKey, number | null>;

export interface SustainabilityTip {
  key: SustainabilityFactorKey;
  title: string;
  detail: string;
}

export interface SustainabilityScoreResult {
  monthKey: string;
  overall: number;
  subScores: SustainabilitySubScores;
  weights: Record<SustainabilityFactorKey, number>;
  inputs: Record<string, unknown>;
  tips: SustainabilityTip[];
  tenantId: number;
  carbonEstimateKg: number;
}

const TIP_TEMPLATES: Record<SustainabilityFactorKey, { title: string; detail: string }> = {
  waste: { title: "Cut food waste", detail: "Audit prep portions, FIFO usage, and recipe yields. Cutting waste 20% can lift this score 15+ pts." },
  packaging: { title: "Switch to eco packaging", detail: "Replace 20% of plastic with compostable or paper packaging to gain ~8 points." },
  donations: { title: "Start a donation routine", detail: "Partner with a local food bank for daily surplus pickup — small donations earn meaningful points." },
  local_vendors: { title: "Source more locally", detail: "Shift spend toward vendors within 50km. Local sourcing reduces carbon and boosts community trust." },
  reusable: { title: "Roll out reusable packaging", detail: "Introduce returnable containers for dine-in/takeaway and track returns to reduce single-use waste." },
  energy: { title: "Log your energy use", detail: "Add weekly energy notes — once tracked, you can spot waste and trim kWh consumption." },
  water: { title: "Log your water use", detail: "Start a simple weekly water log so you can spot leaks and reduce consumption." },
};

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

export function monthRange(monthKey: string): { from: string; to: string } {
  // monthKey: YYYY-MM, returns inclusive date strings
  const [y, m] = monthKey.split("-").map(Number);
  const fromD = new Date(Date.UTC(y, m - 1, 1));
  const toD = new Date(Date.UTC(y, m, 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(fromD), to: fmt(toD) };
}

export function currentMonthKey(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function computeSustainabilityScore(
  restaurantId: number,
  monthKey: string = currentMonthKey(),
): Promise<SustainabilityScoreResult> {
  const [restaurant] = await db
    .select({ tenantId: restaurantsTable.tenantId })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.id, restaurantId));
  if (!restaurant) throw new Error(`Restaurant ${restaurantId} not found`);

  const { from, to } = monthRange(monthKey);

  const [waste, packaging, donations, vendors, reusable, energy, water, carbon] = await Promise.all([
    db.select().from(sustainabilityFoodWasteTable).where(and(
      eq(sustainabilityFoodWasteTable.restaurantId, restaurantId),
      gte(sustainabilityFoodWasteTable.entryDate, from),
      lte(sustainabilityFoodWasteTable.entryDate, to),
    )),
    db.select().from(sustainabilityPackagingTable).where(and(
      eq(sustainabilityPackagingTable.restaurantId, restaurantId),
      gte(sustainabilityPackagingTable.entryDate, from),
      lte(sustainabilityPackagingTable.entryDate, to),
    )),
    db.select().from(sustainabilityDonationsTable).where(and(
      eq(sustainabilityDonationsTable.restaurantId, restaurantId),
      gte(sustainabilityDonationsTable.entryDate, from),
      lte(sustainabilityDonationsTable.entryDate, to),
    )),
    db.select().from(sustainabilityLocalVendorsTable).where(and(
      eq(sustainabilityLocalVendorsTable.restaurantId, restaurantId),
      gte(sustainabilityLocalVendorsTable.entryDate, from),
      lte(sustainabilityLocalVendorsTable.entryDate, to),
    )),
    db.select().from(sustainabilityReusablePackagingTable).where(and(
      eq(sustainabilityReusablePackagingTable.restaurantId, restaurantId),
      gte(sustainabilityReusablePackagingTable.entryDate, from),
      lte(sustainabilityReusablePackagingTable.entryDate, to),
    )),
    db.select().from(sustainabilityEnergyTable).where(and(
      eq(sustainabilityEnergyTable.restaurantId, restaurantId),
      gte(sustainabilityEnergyTable.entryDate, from),
      lte(sustainabilityEnergyTable.entryDate, to),
    )),
    db.select().from(sustainabilityWaterTable).where(and(
      eq(sustainabilityWaterTable.restaurantId, restaurantId),
      gte(sustainabilityWaterTable.entryDate, from),
      lte(sustainabilityWaterTable.entryDate, to),
    )),
    db.select().from(sustainabilityCarbonTable).where(and(
      eq(sustainabilityCarbonTable.restaurantId, restaurantId),
      gte(sustainabilityCarbonTable.entryDate, from),
      lte(sustainabilityCarbonTable.entryDate, to),
    )),
  ]);

  // Orders this month — used as denominator for waste-per-order normalization.
  const [orderAgg] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.restaurantId, restaurantId),
      gte(ordersTable.createdAt, new Date(`${from}T00:00:00.000Z`)),
      lte(ordersTable.createdAt, new Date(`${to}T23:59:59.999Z`)),
    ));
  const orderCount = Number(orderAgg?.cnt ?? 0);

  // ── Waste: kg per 100 orders. 0 → 100, 5kg/100 → 60, 15kg/100 → 0.
  const wasteKg = waste.reduce((s, r) => s + num(r.quantity) * (r.unit === "g" ? 0.001 : 1), 0);
  let wasteScore: number | null = null;
  if (waste.length === 0 && orderCount === 0) wasteScore = null;
  else {
    const wastePer100 = orderCount > 0 ? (wasteKg / orderCount) * 100 : wasteKg * 5;
    wasteScore = clamp(100 - wastePer100 * 6.6);
  }

  // ── Packaging: % compostable + paper out of all logged packaging.
  let packagingScore: number | null = null;
  let totalPkg = 0, ecoPkg = 0;
  for (const p of packaging) {
    const q = num(p.quantity);
    totalPkg += q;
    const t = String(p.type || "").toLowerCase();
    if (t === "compostable" || t === "paper") ecoPkg += q;
  }
  if (totalPkg > 0) packagingScore = clamp((ecoPkg / totalPkg) * 100);

  // ── Donations: simple presence / volume score. >0 entries → 60, scale up.
  let donationsScore: number | null = null;
  if (donations.length > 0) {
    const donatedKg = donations.reduce((s, d) => s + num(d.quantity), 0);
    donationsScore = clamp(50 + Math.min(donations.length, 8) * 4 + Math.min(donatedKg, 50));
  } else {
    donationsScore = 0;
  }

  // ── Local vendors: % of spend marked local.
  let localScore: number | null = null;
  let totalSpend = 0, localSpend = 0;
  for (const v of vendors) {
    const s = num(v.spend);
    totalSpend += s;
    if (v.isLocal === 1) localSpend += s;
  }
  if (vendors.length === 0) localScore = null;
  else if (totalSpend > 0) localScore = clamp((localSpend / totalSpend) * 100);
  else localScore = clamp((vendors.filter(v => v.isLocal === 1).length / vendors.length) * 100);

  // ── Reusable packaging: return rate vs (returns + losses).
  let reusableScore: number | null = null;
  if (reusable.length > 0) {
    const totReturns = reusable.reduce((s, r) => s + (r.returns || 0), 0);
    const totLosses = reusable.reduce((s, r) => s + (r.losses || 0), 0);
    const denom = totReturns + totLosses;
    if (denom > 0) reusableScore = clamp((totReturns / denom) * 100);
    else reusableScore = 70; // logged but no movement yet
  }

  // ── Energy / water: presence of logging earns a tracking score.
  const energyScore: number | null = energy.length > 0 ? clamp(40 + energy.length * 10) : null;
  const waterScore: number | null = water.length > 0 ? clamp(40 + water.length * 10) : null;

  const subScores: SustainabilitySubScores = {
    waste: wasteScore,
    packaging: packagingScore,
    donations: donationsScore,
    local_vendors: localScore,
    reusable: reusableScore,
    energy: energyScore,
    water: waterScore,
  };

  let weightedSum = 0;
  let weightTotal = 0;
  (Object.keys(subScores) as SustainabilityFactorKey[]).forEach(k => {
    const v = subScores[k];
    if (v == null) return;
    const w = SUSTAINABILITY_WEIGHTS[k];
    weightedSum += v * w;
    weightTotal += w;
  });
  const overall = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) / 100 : 0;

  // Carbon estimate (very rough, clearly labeled in UI):
  //   waste_kg * 2.5 + plastic_pkg_units * 0.05 + (kwh * 0.7) + (liters * 0.0003)
  const plasticPkg = packaging.filter(p => String(p.type).toLowerCase() === "plastic").reduce((s, p) => s + num(p.quantity), 0);
  const totalKwh = energy.reduce((s, e) => s + num(e.kwh), 0);
  const totalLiters = water.reduce((s, w) => s + num(w.liters), 0);
  const carbonAuto = wasteKg * 2.5 + plasticPkg * 0.05 + totalKwh * 0.7 + totalLiters * 0.0003;
  const manualCarbon = carbon.reduce((s, c) => s + num(c.manualOverrideKg), 0);
  const carbonEstimateKg = manualCarbon > 0 ? manualCarbon : Math.round(carbonAuto * 100) / 100;

  const inputs = {
    waste: { kg: wasteKg, entries: waste.length, orderCount },
    packaging: { totalUnits: totalPkg, ecoUnits: ecoPkg, entries: packaging.length },
    donations: { entries: donations.length, totalKg: donations.reduce((s, d) => s + num(d.quantity), 0) },
    local_vendors: { entries: vendors.length, totalSpend, localSpend },
    reusable: { entries: reusable.length },
    energy: { entries: energy.length, totalKwh },
    water: { entries: water.length, totalLiters },
    carbon: { autoKg: carbonAuto, manualKg: manualCarbon, used: carbonEstimateKg },
  };

  // Tips: 3-5 tips for the lowest sub-scores.
  const tipsRanked = (Object.keys(subScores) as SustainabilityFactorKey[])
    .filter(k => subScores[k] == null || (subScores[k] as number) < 70)
    .sort((a, b) => {
      const sa = subScores[a] == null ? -1 : (subScores[a] as number);
      const sb = subScores[b] == null ? -1 : (subScores[b] as number);
      return sa - sb;
    })
    .slice(0, 5)
    .map(k => ({ key: k, ...TIP_TEMPLATES[k] }));

  return {
    monthKey,
    overall,
    subScores,
    weights: SUSTAINABILITY_WEIGHTS,
    inputs,
    tips: tipsRanked,
    tenantId: restaurant.tenantId,
    carbonEstimateKg,
  };
}

export async function snapshotSustainabilityScore(
  restaurantId: number,
  monthKey: string = currentMonthKey(),
): Promise<SustainabilityScoreResult> {
  const result = await computeSustainabilityScore(restaurantId, monthKey);
  await db.insert(sustainabilityMonthlyScoresTable).values({
    tenantId: result.tenantId,
    restaurantId,
    monthKey,
    overallScore: String(result.overall),
    subScores: result.subScores as Record<string, number | null>,
    inputs: result.inputs,
    tips: result.tips,
  }).onConflictDoUpdate({
    target: [sustainabilityMonthlyScoresTable.restaurantId, sustainabilityMonthlyScoresTable.monthKey],
    set: {
      overallScore: String(result.overall),
      subScores: result.subScores as Record<string, number | null>,
      inputs: result.inputs,
      tips: result.tips,
      updatedAt: new Date(),
    },
  });
  return result;
}

export async function getSustainabilityTrend(restaurantId: number, months = 12): Promise<Array<{
  monthKey: string;
  overall: number;
  subScores: SustainabilitySubScores;
}>> {
  const out: Array<{ monthKey: string; overall: number; subScores: SustainabilitySubScores }> = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const r = await computeSustainabilityScore(restaurantId, mk);
    out.push({ monthKey: mk, overall: r.overall, subScores: r.subScores });
  }
  return out;
}
