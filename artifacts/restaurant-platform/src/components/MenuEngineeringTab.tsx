import { useMemo, useState } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { ArrowUpDown, Star, Tractor, HelpCircle, Dog, Info, Download } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMenuEngineeringReport } from "@/lib/hooks";
import type { MenuEngineeringItem, MenuEngineeringQuadrant } from "@/lib/types";
import { cn } from "@/lib/utils";

const QUADRANT_LABEL: Record<MenuEngineeringQuadrant, string> = {
  star: "Star",
  plowhorse: "Plowhorse",
  puzzle: "Puzzle",
  dog: "Dog",
};

const QUADRANT_COLOR: Record<MenuEngineeringQuadrant, string> = {
  star: "hsl(142 72% 45%)",
  plowhorse: "hsl(217 91% 60%)",
  puzzle: "hsl(38 92% 50%)",
  dog: "hsl(348 83% 55%)",
};

const QUADRANT_BADGE_CLASS: Record<MenuEngineeringQuadrant, string> = {
  star: "bg-green-100 text-green-700 border-green-200",
  plowhorse: "bg-blue-100 text-blue-700 border-blue-200",
  puzzle: "bg-amber-100 text-amber-700 border-amber-200",
  dog: "bg-rose-100 text-rose-700 border-rose-200",
};

const QUADRANT_ICON: Record<MenuEngineeringQuadrant, typeof Star> = {
  star: Star,
  plowhorse: Tractor,
  puzzle: HelpCircle,
  dog: Dog,
};

type SortKey = keyof Pick<MenuEngineeringItem,
  "name" | "categoryName" | "unitsSold" | "revenue" | "unitCost" | "unitProfit" | "totalProfit" | "margin" | "popularity"
>;

interface Props {
  period: string;
  custom?: { from: string; to: string };
}

export function MenuEngineeringTab({ period, custom }: Props) {
  const [marginThreshold, setMarginThreshold] = useState<number | null>(null);
  const [popularityThreshold, setPopularityThreshold] = useState<number | null>(null);
  const [marginInput, setMarginInput] = useState<string>("");
  const [popularityInput, setPopularityInput] = useState<string>("");
  const [filterQuadrant, setFilterQuadrant] = useState<MenuEngineeringQuadrant | "all">("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "totalProfit", dir: "desc" });

  const { data, isLoading } = useMenuEngineeringReport({
    period,
    custom,
    marginThreshold,
    popularityThreshold,
  });

  const classified = useMemo(() => (data?.items ?? []).filter(i => i.status === "classified"), [data]);
  const noSales = useMemo(() => (data?.items ?? []).filter(i => i.status === "no_sales"), [data]);
  const noRecipe = useMemo(() => (data?.items ?? []).filter(i => i.status === "no_recipe"), [data]);

  const filtered = useMemo(() => {
    if (filterQuadrant === "all") return classified;
    return classified.filter(i => i.quadrant === filterQuadrant);
  }, [classified, filterQuadrant]);

  const sortedRows = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      const ka = a[sort.key];
      const kb = b[sort.key];
      const na = typeof ka === "number" ? ka : Number(ka);
      const nb = typeof kb === "number" ? kb : Number(kb);
      if (Number.isFinite(na) && Number.isFinite(nb)) return sort.dir === "asc" ? na - nb : nb - na;
      return sort.dir === "asc"
        ? String(ka ?? "").localeCompare(String(kb ?? ""))
        : String(kb ?? "").localeCompare(String(ka ?? ""));
    });
    return rows;
  }, [filtered, sort]);

  function toggleSort(key: SortKey) {
    setSort(p => p.key === key ? { key, dir: p.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" });
  }

  const applyThresholds = () => {
    const m = marginInput.trim() === "" ? null : Number(marginInput);
    const p = popularityInput.trim() === "" ? null : Number(popularityInput);
    setMarginThreshold(Number.isFinite(m as number) ? (m as number) : null);
    setPopularityThreshold(Number.isFinite(p as number) ? (p as number) : null);
  };

  const resetThresholds = () => {
    setMarginInput("");
    setPopularityInput("");
    setMarginThreshold(null);
    setPopularityThreshold(null);
  };

  if (isLoading || !data) {
    return <p className="text-sm text-muted-foreground">Loading menu engineering report…</p>;
  }

  const exportRows = () => data.items.map(i => ({
    Item: i.name,
    Category: i.categoryName ?? "",
    Status: i.status === "classified" ? (i.quadrant ?? "") : i.status,
    Units: i.unitsSold,
    Revenue: Number(i.revenue.toFixed(2)),
    "Unit Cost": Number(i.unitCost.toFixed(2)),
    "Unit Profit": Number(i.unitProfit.toFixed(2)),
    "Total Profit": Number(i.totalProfit.toFixed(2)),
    "Margin %": Number(i.margin.toFixed(2)),
    "Popularity %": Number(i.popularity.toFixed(4)),
    "Suggested Actions": i.suggestions.join("; "),
  }));

  const filenameBase = `menu-engineering-${data.from.slice(0, 10)}_${data.to.slice(0, 10)}`;

  const handleCSV = () => {
    const rows = exportRows();
    const headers = Object.keys(rows[0] ?? {
      Item: "", Category: "", Status: "", Units: 0, Revenue: 0,
      "Unit Cost": 0, "Unit Profit": 0, "Total Profit": 0, "Margin %": 0, "Popularity %": 0, "Suggested Actions": "",
    });
    const csv = [headers, ...rows.map(r => headers.map(h => (r as Record<string, unknown>)[h]))]
      .map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenameBase}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportRows()), "Items");
    const summary: { Quadrant: string; Count: number; Revenue: number }[] = [];
    (Object.keys(data.quadrantSummary) as MenuEngineeringQuadrant[]).forEach(q => {
      summary.push({ Quadrant: QUADRANT_LABEL[q], Count: data.quadrantSummary[q].count, Revenue: Number(data.quadrantSummary[q].revenue.toFixed(2)) });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Quadrant Summary");
    const meta = [
      { Field: "From", Value: data.from.slice(0, 10) },
      { Field: "To", Value: data.to.slice(0, 10) },
      { Field: "Margin Threshold (%)", Value: data.marginThreshold },
      { Field: "Popularity Threshold (%)", Value: data.popularityThreshold },
      { Field: "Total Items", Value: data.totals.itemCount },
      { Field: "Classified", Value: data.totals.classifiedCount },
      { Field: "No Sales", Value: data.totals.noSalesCount },
      { Field: "No Recipe", Value: data.totals.noRecipeCount },
      { Field: "Total Units", Value: data.totals.units },
      { Field: "Total Revenue", Value: Number(data.totals.revenue.toFixed(2)) },
      { Field: "Total Profit", Value: Number(data.totals.profit.toFixed(2)) },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta), "Report Info");
    XLSX.writeFile(wb, `${filenameBase}.xlsx`);
  };

  const handlePDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text("Menu Engineering Report", 14, 14);
    doc.setFontSize(9);
    doc.text(`Period: ${data.from.slice(0, 10)} to ${data.to.slice(0, 10)}`, 14, 20);
    doc.text(`Margin threshold: ${data.marginThreshold.toFixed(1)}%   Popularity threshold: ${data.popularityThreshold.toFixed(2)}%`, 14, 25);
    autoTable(doc, {
      startY: 30,
      head: [["Quadrant", "Items", "Revenue"]],
      body: (Object.keys(data.quadrantSummary) as MenuEngineeringQuadrant[]).map(q => [
        QUADRANT_LABEL[q],
        String(data.quadrantSummary[q].count),
        `₹${Math.round(data.quadrantSummary[q].revenue).toLocaleString("en-IN")}`,
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [60, 60, 60] },
    });
    autoTable(doc, {
      head: [["Item", "Category", "Status", "Units", "Revenue", "Margin %", "Pop %", "Total Profit", "Suggested Actions"]],
      body: data.items.map(i => [
        i.name,
        i.categoryName ?? "",
        i.status === "classified" ? QUADRANT_LABEL[i.quadrant!] : i.status,
        String(i.unitsSold),
        `₹${Math.round(i.revenue).toLocaleString("en-IN")}`,
        i.hasRecipe ? `${i.margin.toFixed(1)}%` : "—",
        `${i.popularity.toFixed(2)}%`,
        i.hasRecipe ? `₹${Math.round(i.totalProfit).toLocaleString("en-IN")}` : "—",
        i.suggestions.join("; "),
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [60, 60, 60] },
      columnStyles: { 8: { cellWidth: 70 } },
    });
    doc.save(`${filenameBase}.pdf`);
  };

  const scrollToItem = (id: number) => {
    const el = document.getElementById(`me-row-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary");
      setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 1600);
    }
  };

  const totalQuadrantRevenue = (Object.values(data.quadrantSummary) as { revenue: number }[])
    .reduce((s, q) => s + q.revenue, 0);

  const scatterData = classified.map(i => ({
    x: i.popularity,
    y: i.margin,
    z: Math.max(40, Math.min(400, i.unitsSold * 4)),
    name: i.name,
    quadrant: i.quadrant,
    id: i.id,
    unitsSold: i.unitsSold,
    revenue: i.revenue,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" onClick={handleCSV}>
          <Download className="w-4 h-4 mr-1.5" /> CSV
        </Button>
        <Button size="sm" variant="outline" onClick={handleExcel}>
          <Download className="w-4 h-4 mr-1.5" /> Excel
        </Button>
        <Button size="sm" variant="outline" onClick={handlePDF}>
          <Download className="w-4 h-4 mr-1.5" /> PDF
        </Button>
      </div>

      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-xl p-4">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          <div className="text-xs text-foreground space-y-1">
            <p>
              <strong>Menu Engineering</strong> classifies every dish by profit margin and popularity.
              Stars are your winners; Plowhorses sell well but earn little; Puzzles earn well but barely sell;
              Dogs do neither. Use the suggested actions to act on each.
            </p>
            <p className="text-muted-foreground">
              Thresholds default to the menu-wide medians of margin and popularity, so half your items will
              naturally fall above and half below. Override them to model what "good" should mean for you.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(Object.keys(QUADRANT_LABEL) as MenuEngineeringQuadrant[]).map(q => {
          const summary = data.quadrantSummary[q];
          const share = totalQuadrantRevenue > 0 ? (summary.revenue / totalQuadrantRevenue) * 100 : 0;
          const Icon = QUADRANT_ICON[q];
          return (
            <button
              key={q}
              onClick={() => setFilterQuadrant(p => p === q ? "all" : q)}
              className={cn(
                "bg-card border rounded-xl p-4 text-left transition-all hover:shadow-md",
                filterQuadrant === q ? "border-primary ring-1 ring-primary" : "border-border",
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-foreground">{QUADRANT_LABEL[q]}s</span>
                <Icon className="w-4 h-4" style={{ color: QUADRANT_COLOR[q] }} />
              </div>
              <p className="text-2xl font-bold text-foreground">{summary.count}</p>
              <p className="text-xs text-muted-foreground mt-1">
                ₹{Math.round(summary.revenue).toLocaleString("en-IN")} · {share.toFixed(1)}% of revenue
              </p>
            </button>
          );
        })}
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Margin threshold (%)</label>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.1}
              placeholder={`median: ${data.marginThreshold.toFixed(1)}`}
              value={marginInput}
              onChange={e => setMarginInput(e.target.value)}
              className="h-9 w-40"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Popularity threshold (% of units)</label>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.01}
              placeholder={`median: ${data.popularityThreshold.toFixed(2)}`}
              value={popularityInput}
              onChange={e => setPopularityInput(e.target.value)}
              className="h-9 w-44"
            />
          </div>
          <Button size="sm" onClick={applyThresholds}>Apply</Button>
          <Button size="sm" variant="outline" onClick={resetThresholds}>Reset to medians</Button>
          <span className="text-xs text-muted-foreground ml-auto">
            Active: margin ≥ {data.marginThreshold.toFixed(1)}%, popularity ≥ {data.popularityThreshold.toFixed(2)}%
          </span>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-semibold text-foreground mb-3">Quadrant Map</h3>
        {classified.length === 0 ? (
          <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
            No items with both sales and recipes in this period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <ScatterChart margin={{ top: 16, right: 24, bottom: 36, left: 24 }}>
              <CartesianGrid strokeDasharray="3 6" stroke="hsl(var(--border))" />
              <XAxis
                type="number"
                dataKey="x"
                name="Popularity"
                domain={[0, "dataMax"]}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                label={{ value: "Popularity (% of units sold)", position: "insideBottom", offset: -10, fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="Margin"
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v: number) => `${v}%`}
                label={{ value: "Margin %", angle: -90, position: "insideLeft", fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
              />
              <ZAxis type="number" dataKey="z" range={[40, 400]} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as { name: string; quadrant: MenuEngineeringQuadrant; x: number; y: number; unitsSold: number; revenue: number };
                  return (
                    <div className="bg-popover border border-border rounded-md px-3 py-2 text-xs shadow-md">
                      <p className="font-semibold text-foreground">{d.name}</p>
                      <p className="text-muted-foreground capitalize">{d.quadrant}</p>
                      <p>Margin: {d.y.toFixed(1)}%</p>
                      <p>Popularity: {d.x.toFixed(2)}%</p>
                      <p>Units: {d.unitsSold}</p>
                      <p>Revenue: ₹{Math.round(d.revenue).toLocaleString("en-IN")}</p>
                    </div>
                  );
                }}
              />
              <ReferenceLine x={data.popularityThreshold} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
              <ReferenceLine y={data.marginThreshold} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
              <Scatter data={scatterData} onClick={(p: { id?: number }) => p.id && scrollToItem(p.id)}>
                {scatterData.map((d, i) => (
                  <Cell key={i} fill={QUADRANT_COLOR[d.quadrant as MenuEngineeringQuadrant]} cursor="pointer" />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
        <div className="flex flex-wrap gap-3 mt-3 justify-center text-xs">
          {(Object.keys(QUADRANT_LABEL) as MenuEngineeringQuadrant[]).map(q => (
            <span key={q} className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full" style={{ background: QUADRANT_COLOR[q] }} />
              {QUADRANT_LABEL[q]}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant={filterQuadrant === "all" ? "default" : "outline"} onClick={() => setFilterQuadrant("all")}>
          All ({classified.length})
        </Button>
        {(Object.keys(QUADRANT_LABEL) as MenuEngineeringQuadrant[]).map(q => (
          <Button
            key={q}
            size="sm"
            variant={filterQuadrant === q ? "default" : "outline"}
            onClick={() => setFilterQuadrant(q)}
          >
            {QUADRANT_LABEL[q]}s ({data.quadrantSummary[q].count})
          </Button>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                {([
                  { k: "name" as SortKey, label: "Item", align: "left" },
                  { k: "categoryName" as SortKey, label: "Category", align: "left" },
                  { k: "unitsSold" as SortKey, label: "Units", align: "right" },
                  { k: "revenue" as SortKey, label: "Revenue", align: "right" },
                  { k: "unitCost" as SortKey, label: "Unit cost", align: "right" },
                  { k: "unitProfit" as SortKey, label: "Unit profit", align: "right" },
                  { k: "totalProfit" as SortKey, label: "Total profit", align: "right" },
                  { k: "margin" as SortKey, label: "Margin %", align: "right" },
                  { k: "popularity" as SortKey, label: "Popularity %", align: "right" },
                ]).map(col => (
                  <th
                    key={col.k}
                    onClick={() => toggleSort(col.k)}
                    className={cn(
                      "px-3 py-2.5 text-muted-foreground font-medium cursor-pointer select-none hover:text-foreground",
                      col.align === "right" ? "text-right" : "text-left",
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      <ArrowUpDown className={cn("w-3 h-3", sort.key === col.k ? "text-primary" : "opacity-40")} />
                    </span>
                  </th>
                ))}
                <th className="text-left px-3 py-2.5 text-muted-foreground font-medium">Quadrant</th>
                <th className="text-left px-3 py-2.5 text-muted-foreground font-medium">Suggested actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-12 text-muted-foreground text-sm">
                    No classified items match this filter.
                  </td>
                </tr>
              ) : sortedRows.map(item => (
                <tr key={item.id} id={`me-row-${item.id}`} className="border-t border-border hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2.5 font-medium text-foreground">{item.name}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{item.categoryName ?? "–"}</td>
                  <td className="px-3 py-2.5 text-right text-foreground tabular-nums">{item.unitsSold}</td>
                  <td className="px-3 py-2.5 text-right text-foreground tabular-nums">₹{Math.round(item.revenue).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums">₹{item.unitCost.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right text-foreground tabular-nums">₹{item.unitProfit.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-foreground tabular-nums">₹{Math.round(item.totalProfit).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{item.margin.toFixed(1)}%</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{item.popularity.toFixed(2)}%</td>
                  <td className="px-3 py-2.5">
                    {item.quadrant && (
                      <span className={cn("text-[10px] px-2 py-0.5 rounded-full border", QUADRANT_BADGE_CLASS[item.quadrant])}>
                        {QUADRANT_LABEL[item.quadrant]}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <ul className="text-xs text-foreground space-y-0.5">
                      {item.suggestions.map((s, i) => (
                        <li key={i} className="flex gap-1.5">
                          <span className="text-muted-foreground">•</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {noSales.length > 0 && (
        <SubsectionTable
          title={`No sales (${noSales.length})`}
          description="These items had no sales in the period and are excluded from the medians."
          items={noSales}
        />
      )}

      {noRecipe.length > 0 && (
        <SubsectionTable
          title={`Cost not configured (${noRecipe.length})`}
          description="These items have no recipe, so margin can't be calculated. Set up a recipe to include them."
          items={noRecipe}
          showCostFlag
        />
      )}
    </div>
  );
}

function SubsectionTable({
  title, description, items, showCostFlag,
}: { title: string; description: string; items: MenuEngineeringItem[]; showCostFlag?: boolean }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <h3 className="font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Item</th>
              <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Category</th>
              <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Price</th>
              <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Suggested actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(i => (
              <tr key={i.id} className="border-t border-border hover:bg-muted/20">
                <td className="px-5 py-2.5 font-medium text-foreground">
                  {i.name}
                  {showCostFlag && (
                    <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Cost not configured</span>
                  )}
                </td>
                <td className="px-5 py-2.5 text-muted-foreground">{i.categoryName ?? "–"}</td>
                <td className="px-5 py-2.5 text-right text-foreground tabular-nums">₹{i.price.toFixed(2)}</td>
                <td className="px-5 py-2.5">
                  <ul className="text-xs text-foreground space-y-0.5">
                    {i.suggestions.map((s, idx) => (
                      <li key={idx} className="flex gap-1.5">
                        <span className="text-muted-foreground">•</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
