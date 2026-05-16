export type Quadrant = "star" | "plowhorse" | "puzzle" | "dog";

export type MenuEngineeringStatus = "classified" | "no_sales" | "no_recipe";

export interface MenuEngineeringInput {
  id: number;
  name: string;
  categoryId: number | null;
  categoryName: string | null;
  price: number;
  unitsSold: number;
  revenue: number;
  unitCost: number;
  hasRecipe: boolean;
  ingredientCount: number;
}

export interface ClassifiedMenuItem extends MenuEngineeringInput {
  unitProfit: number;
  totalProfit: number;
  margin: number;
  popularity: number;
  quadrant: Quadrant | null;
  suggestions: string[];
  status: MenuEngineeringStatus;
}

export interface ClassifyResult {
  items: ClassifiedMenuItem[];
  marginThreshold: number;
  popularityThreshold: number;
  totalUnits: number;
  totalRevenue: number;
  totalProfit: number;
  classifiedCount: number;
  noSalesCount: number;
  noRecipeCount: number;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function suggestionsFor(q: Quadrant, ctx: { margin: number; marginThreshold: number }): string[] {
  switch (q) {
    case "star":
      return [
        "Promote (feature on home / specials)",
        "Move higher in menu position",
        "Improve image / styling",
      ];
    case "plowhorse": {
      const out = [
        "Reprice (raise price slightly)",
        "Bundle with a high-margin item",
        "Rename for a more premium feel",
      ];
      if (ctx.marginThreshold > 0 && ctx.margin < ctx.marginThreshold * 0.5) {
        out.unshift("Margin very low — review urgently");
      }
      return out;
    }
    case "puzzle": {
      const out = [
        "Promote",
        "Rename",
        "Improve image",
        "Move higher in menu position",
      ];
      if (ctx.marginThreshold > 0 && ctx.margin > ctx.marginThreshold * 1.5) {
        out.push("Reprice down to drive volume");
      }
      return out;
    }
    case "dog":
      return [
        "Remove from menu",
        "Bundle as add-on with a popular item",
        "Last attempt: rename + improve image",
      ];
  }
}

export function classifyMenuItems(
  items: MenuEngineeringInput[],
  opts: { marginThreshold?: number | null; popularityThreshold?: number | null } = {},
): ClassifyResult {
  const totalUnits = items.reduce((s, i) => s + i.unitsSold, 0);
  const totalRevenue = items.reduce((s, i) => s + i.revenue, 0);

  const eligible = items.filter(i => i.unitsSold > 0 && i.hasRecipe);

  const marginsForMedian = eligible.map(i => {
    const unitPrice = i.unitsSold > 0 ? i.revenue / i.unitsSold : 0;
    return unitPrice > 0 ? ((unitPrice - i.unitCost) / unitPrice) * 100 : 0;
  });
  const popularitiesForMedian = eligible.map(i =>
    totalUnits > 0 ? (i.unitsSold / totalUnits) * 100 : 0,
  );

  const marginThreshold = opts.marginThreshold != null && Number.isFinite(opts.marginThreshold)
    ? Number(opts.marginThreshold)
    : Number(median(marginsForMedian).toFixed(2));
  const popularityThreshold = opts.popularityThreshold != null && Number.isFinite(opts.popularityThreshold)
    ? Number(opts.popularityThreshold)
    : Number(median(popularitiesForMedian).toFixed(4));

  let noSalesCount = 0;
  let noRecipeCount = 0;
  let classifiedCount = 0;

  const out: ClassifiedMenuItem[] = items.map(i => {
    const unitPrice = i.unitsSold > 0 ? i.revenue / i.unitsSold : i.price;
    const unitProfit = unitPrice - i.unitCost;
    const totalProfit = i.unitsSold > 0 ? unitProfit * i.unitsSold : 0;
    const margin = unitPrice > 0 ? ((unitPrice - i.unitCost) / unitPrice) * 100 : 0;
    const popularity = totalUnits > 0 ? (i.unitsSold / totalUnits) * 100 : 0;

    let status: MenuEngineeringStatus = "classified";
    let quadrant: Quadrant | null = null;
    let suggestions: string[] = [];

    if (i.unitsSold === 0) {
      status = "no_sales";
      noSalesCount++;
      suggestions = [
        "Promote with a launch offer or staff push",
        "Remove if still no sales after one full cycle",
      ];
    } else if (!i.hasRecipe) {
      status = "no_recipe";
      noRecipeCount++;
      suggestions = ["Set up a recipe so margin can be tracked"];
    } else {
      classifiedCount++;
      const highMargin = margin >= marginThreshold;
      const highPop = popularity >= popularityThreshold;
      if (highMargin && highPop) quadrant = "star";
      else if (!highMargin && highPop) quadrant = "plowhorse";
      else if (highMargin && !highPop) quadrant = "puzzle";
      else quadrant = "dog";
      suggestions = suggestionsFor(quadrant, { margin, marginThreshold });
    }

    return {
      ...i,
      unitProfit,
      totalProfit,
      margin,
      popularity,
      quadrant,
      suggestions,
      status,
    };
  });

  const totalProfit = out.reduce((s, i) => s + i.totalProfit, 0);

  return {
    items: out,
    marginThreshold,
    popularityThreshold,
    totalUnits,
    totalRevenue,
    totalProfit,
    classifiedCount,
    noSalesCount,
    noRecipeCount,
  };
}
