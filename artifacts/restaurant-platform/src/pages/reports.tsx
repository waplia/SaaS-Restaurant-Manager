import { useState } from "react";
import { Link, Redirect, useParams } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useFoodCostReport, useCashVarianceHistory, useBranchAwareReports, useCompareBranches, useKitchenPerformance, useKitchenPerformanceAiSummary, useDiscountInsights, useRestaurantId, useMenuEngineeringReport, usePortionDriftEvents, useTasteTests, usePackagingItems, useCondimentItems, useRecipeVersions, useAddonsReport, type CompareBranchRow } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { MenuEngineeringTab } from "@/components/MenuEngineeringTab";
import { cn } from "@/lib/utils";
import { useBranchContext } from "@/lib/branch";
import { BranchSwitcher } from "@/components/layout/BranchSwitcher";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";
import { format } from "date-fns";
import { TrendingUp, ShoppingBag, Receipt, DollarSign, Download, Users, Percent, Flame, ArrowUpDown, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RevenueByDayItem, TaxByDayItem, TopItem, StaffPerformanceItem, DevicePerformanceItem, PaymentsByMethodItem, DiscountsByCashierItem, FoodCostItem } from "@/lib/types";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const COLORS = [
  "hsl(20 92% 46%)", "hsl(142 72% 45%)", "hsl(217 91% 60%)",
  "hsl(280 65% 60%)", "hsl(348 83% 55%)",
];

function fmtDateTick(d: string, viewMode: string): string {
  try {
    if (viewMode === "yearly") return d.slice(0, 4);
    if (viewMode === "monthly") return format(new Date(d + "-01T12:00:00"), "MMM yyyy");
    return format(new Date(d + "T12:00:00"), "MMM d");
  } catch { return d; }
}

function fmtDateLabel(d: string, viewMode: string): string {
  try {
    if (viewMode === "yearly") return d.slice(0, 4);
    if (viewMode === "monthly") return format(new Date(d + "-01T12:00:00"), "MMMM yyyy");
    return format(new Date(d + "T12:00:00"), "MMMM d, yyyy");
  } catch { return d; }
}

function fmtTableDate(d: string, viewMode: string): string {
  try {
    if (viewMode === "yearly") return d.slice(0, 4);
    if (viewMode === "monthly") return format(new Date(d + "-01T12:00:00"), "MMMM yyyy");
    return format(new Date(d + "T12:00:00"), "MMM d, yyyy");
  } catch { return d; }
}

type Tab = "sales" | "tax" | "staff" | "devices" | "payments" | "discounts" | "food-cost" | "cash-variance" | "compare" | "kitchen-performance" | "menu-engineering" | "inventory-control" | "addons";
type ViewMode = "daily" | "monthly" | "yearly";

const VALID_TABS: readonly Tab[] = ["sales", "tax", "staff", "devices", "payments", "discounts", "food-cost", "cash-variance", "compare", "kitchen-performance", "menu-engineering", "inventory-control", "addons"] as const;

function exportCSV(filename: string, rows: string[][], headers: string[]) {
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const params = useParams<{ section?: string }>();
  const sectionParam = params?.section;
  const tab: Tab = (VALID_TABS as readonly string[]).includes(sectionParam ?? "")
    ? (sectionParam as Tab)
    : "sales";
  const [period, setPeriod] = useState("30d");
  const [viewMode, setViewMode] = useState<ViewMode>("daily");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [foodCostThreshold, setFoodCostThreshold] = useState(65);
  const [foodCostSort, setFoodCostSort] = useState<{ key: keyof FoodCostItem; dir: "asc" | "desc" }>({ key: "margin", dir: "asc" });
  const [foodCostFilter, setFoodCostFilter] = useState<"all" | "withRecipe" | "lowMargin">("all");

  const sectionInvalid = !!sectionParam && !(VALID_TABS as readonly string[]).includes(sectionParam);

  const { data: foodCost } = useFoodCostReport(foodCostThreshold);

  const filteredFoodCost = (foodCost?.items ?? []).filter(i => {
    if (foodCostFilter === "withRecipe") return i.hasRecipe;
    if (foodCostFilter === "lowMargin") return i.isLowMargin;
    return true;
  });
  const sortedFoodCost = [...filteredFoodCost].sort((a, b) => {
    const ka = a[foodCostSort.key];
    const kb = b[foodCostSort.key];
    const na = typeof ka === "number" ? ka : Number(ka);
    const nb = typeof kb === "number" ? kb : Number(kb);
    if (Number.isFinite(na) && Number.isFinite(nb) && (typeof ka !== "string" || !isNaN(Number(ka)))) {
      return foodCostSort.dir === "asc" ? na - nb : nb - na;
    }
    const sa = String(ka ?? "");
    const sb = String(kb ?? "");
    return foodCostSort.dir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
  });
  const lowMarginCount = (foodCost?.items ?? []).filter(i => i.isLowMargin).length;
  const recipeCoverage = (foodCost?.items ?? []).filter(i => i.hasRecipe).length;
  const avgMargin = (() => {
    const withRecipe = (foodCost?.items ?? []).filter(i => i.hasRecipe);
    if (withRecipe.length === 0) return null;
    return withRecipe.reduce((s, i) => s + i.margin, 0) / withRecipe.length;
  })();

  function toggleSort(key: keyof FoodCostItem) {
    setFoodCostSort(p => p.key === key ? { key, dir: p.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  }

  const { hasMultipleBranches, isAllBranches, branches, selectedBranchId } = useBranchContext();
  const { data: reports, isLoading } = useBranchAwareReports(
    useCustom && customFrom && customTo ? `custom|${customFrom}|${customTo}` : period,
    useCustom && customFrom && customTo ? { from: customFrom, to: customTo } : undefined,
    viewMode,
  );
  const [compareSort, setCompareSort] = useState<{ key: keyof CompareBranchRow; dir: "asc" | "desc" }>({ key: "revenue", dir: "desc" });
  const { data: compareData, isLoading: compareLoading } = useCompareBranches(
    useCustom && customFrom && customTo ? `custom|${customFrom}|${customTo}` : period,
    useCustom && customFrom && customTo ? { from: customFrom, to: customTo } : undefined,
  );
  const compareRows = (compareData?.branches ?? []).slice().sort((a, b) => {
    const ka = a[compareSort.key];
    const kb = b[compareSort.key];
    const na = ka == null ? -Infinity : typeof ka === "number" ? ka : Number(ka);
    const nb = kb == null ? -Infinity : typeof kb === "number" ? kb : Number(kb);
    if (Number.isFinite(na) && Number.isFinite(nb)) return compareSort.dir === "asc" ? na - nb : nb - na;
    return compareSort.dir === "asc"
      ? String(ka ?? "").localeCompare(String(kb ?? ""))
      : String(kb ?? "").localeCompare(String(ka ?? ""));
  });
  function toggleCompareSort(key: keyof CompareBranchRow) {
    setCompareSort(p => p.key === key ? { key, dir: p.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" });
  }
  function handleExportCompareCSV() {
    exportCSV(
      `branch-comparison-${new Date().toISOString().slice(0, 10)}.csv`,
      compareRows.map(r => [
        r.name, r.city ?? "", r.revenue, String(r.orders), r.avgOrderValue, r.tax,
        r.expenses ?? "", r.netProfit ?? "",
      ]),
      ["Branch", "City", "Revenue", "Orders", "Avg Order Value", "Tax", "Expenses", "Net Profit"],
    );
  }

  function handleExportCSV() {
    if (!reports) return;
    if (tab === "sales") {
      exportCSV(
        `sales-report-${new Date().toISOString().slice(0, 10)}.csv`,
        (reports.revenueByDay ?? []).map((r: RevenueByDayItem) => [r.date, String(r.revenue), String(r.orders)]),
        ["Date", "Revenue", "Orders"],
      );
    } else if (tab === "tax") {
      exportCSV(
        `tax-report-${new Date().toISOString().slice(0, 10)}.csv`,
        (reports.taxByDay ?? []).map((r: TaxByDayItem) => [r.date, r.tax, r.revenue, String(r.orders), `${r.effectiveRate}%`]),
        ["Date", "Tax Collected", "Revenue", "Orders", "Effective Rate"],
      );
    } else if (tab === "devices") {
      exportCSV(
        `devices-report-${new Date().toISOString().slice(0, 10)}.csv`,
        (reports.devicePerformance ?? []).map((d: DevicePerformanceItem) => [
          d.deviceName,
          d.deviceType,
          d.isHandheld ? "Yes" : "No",
          d.assignedUserName ?? "—",
          String(d.orderCount),
          d.totalRevenue,
        ]),
        ["Device", "Type", "Handheld", "Assigned Waiter", "Orders", "Revenue"],
      );
    } else if (tab === "staff") {
      exportCSV(
        `staff-report-${new Date().toISOString().slice(0, 10)}.csv`,
        (reports.staffPerformance ?? []).map((s: StaffPerformanceItem) => [s.name, String(s.orderCount), s.totalRevenue, s.totalHours]),
        ["Staff Name", "Orders Handled", "Revenue Generated", "Hours Worked"],
      );
    } else if (tab === "discounts") {
      exportCSV(
        `discounts-report-${new Date().toISOString().slice(0, 10)}.csv`,
        (reports.discountsByCashier ?? []).map((d: DiscountsByCashierItem) => [d.name, d.type, d.reason, String(d.count), d.total]),
        ["Cashier", "Type", "Reason", "Count", "Total Discount"],
      );
    } else if (tab === "payments") {
      exportCSV(
        `payments-report-${new Date().toISOString().slice(0, 10)}.csv`,
        (reports.paymentsByMethod ?? []).map((p: PaymentsByMethodItem) => [
          p.direction === "in" ? "Money In" : "Money Out",
          p.method,
          String(p.count),
          String(p.total),
        ]),
        ["Direction", "Method", "Count", "Total"],
      );
    } else if (tab === "food-cost") {
      exportCSV(
        `food-cost-${new Date().toISOString().slice(0, 10)}.csv`,
        sortedFoodCost.map(i => [
          i.name,
          i.categoryName ?? "",
          i.price,
          i.cogs,
          i.hasRecipe ? `${i.margin.toFixed(2)}%` : "no recipe",
          i.hasRecipe ? `${i.foodCostPct.toFixed(2)}%` : "",
          String(i.ingredientCount),
          i.isLowMargin ? "yes" : "no",
        ]),
        ["Item", "Category", "Price", "COGS", "Margin %", "Food Cost %", "Ingredients", "Low Margin"],
      );
    }
  }

  function handleExportExcel() {
    if (!reports) return;
    const wb = XLSX.utils.book_new();
    const dateStamp = new Date().toISOString().slice(0, 10);

    if (tab === "sales") {
      const salesRows = (reports.revenueByDay ?? []).map((r: RevenueByDayItem) => ({
        Date: r.date,
        Revenue: Number(r.revenue),
        Orders: r.orders,
        "Avg Order": r.orders > 0 ? Number((Number(r.revenue) / r.orders).toFixed(2)) : 0,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salesRows), "Sales");
      XLSX.writeFile(wb, `sales-report-${dateStamp}.xlsx`);
    } else if (tab === "tax") {
      const taxRows = (reports.taxByDay ?? []).map((r: TaxByDayItem) => ({
        Date: r.date,
        "Tax Collected": Number(r.tax),
        Revenue: Number(r.revenue),
        Orders: r.orders,
        "Effective Rate (%)": Number(r.effectiveRate),
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(taxRows), "Tax");
      XLSX.writeFile(wb, `tax-report-${dateStamp}.xlsx`);
    } else if (tab === "discounts") {
      const rows = (reports.discountsByCashier ?? []).map((d: DiscountsByCashierItem) => ({
        Cashier: d.name,
        Type: d.type,
        Reason: d.reason,
        Count: d.count,
        "Total Discount": Number(d.total),
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Discounts");
      XLSX.writeFile(wb, `discounts-report-${dateStamp}.xlsx`);
    } else if (tab === "staff") {
      const staffRows = (reports.staffPerformance ?? []).map((s: StaffPerformanceItem) => ({
        "Staff Member": s.name,
        "Orders Handled": s.orderCount,
        "Revenue Generated": Number(s.totalRevenue),
        "Hours Worked": Number(s.totalHours),
        "Revenue / Order": s.orderCount > 0 ? Number((Number(s.totalRevenue) / s.orderCount).toFixed(2)) : 0,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(staffRows), "Staff Performance");
      XLSX.writeFile(wb, `staff-report-${dateStamp}.xlsx`);
    } else if (tab === "devices") {
      const deviceRows = (reports.devicePerformance ?? []).map((d: DevicePerformanceItem) => ({
        Device: d.deviceName,
        Type: d.deviceType,
        Handheld: d.isHandheld ? "Yes" : "No",
        "Assigned Waiter": d.assignedUserName ?? "—",
        Orders: d.orderCount,
        Revenue: Number(d.totalRevenue),
        "Revenue / Order": d.orderCount > 0 ? Number((Number(d.totalRevenue) / d.orderCount).toFixed(2)) : 0,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(deviceRows), "Devices");
      XLSX.writeFile(wb, `devices-report-${dateStamp}.xlsx`);
    } else if (tab === "payments") {
      const paymentRows = (reports.paymentsByMethod ?? []).map((p: PaymentsByMethodItem) => ({
        Direction: p.direction === "in" ? "Money In" : "Money Out",
        Method: p.method,
        Count: p.count,
        Total: Number(p.total),
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paymentRows), "Payments");
      XLSX.writeFile(wb, `payments-report-${dateStamp}.xlsx`);
    } else if (tab === "food-cost") {
      const rows = sortedFoodCost.map(i => ({
        Item: i.name,
        Category: i.categoryName ?? "",
        Price: Number(i.price),
        COGS: Number(i.cogs),
        "Margin %": i.hasRecipe ? i.margin : null,
        "Food Cost %": i.hasRecipe ? i.foodCostPct : null,
        Ingredients: i.ingredientCount,
        "Low Margin": i.isLowMargin ? "yes" : "no",
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Food Cost");
      XLSX.writeFile(wb, `food-cost-${dateStamp}.xlsx`);
    }
  }

  function handleExportPDF() {
    if (!reports) return;
    const doc = new jsPDF();
    const dateStr = new Date().toLocaleDateString();
    const dateStamp = new Date().toISOString().slice(0, 10);

    const sectionTitle =
      tab === "sales" ? "Sales Report"
      : tab === "tax" ? "Tax Report"
      : tab === "staff" ? "Staff Performance Report"
      : tab === "devices" ? "Device Sales Report"
      : tab === "discounts" ? "Discounts Report"
      : tab === "food-cost" ? "Food Cost Report"
      : "Payments Report";

    doc.setFontSize(18);
    doc.text(`KhanaLagao — ${sectionTitle}`, 14, 18);
    doc.setFontSize(10);
    doc.text(`Generated: ${dateStr}`, 14, 26);

    if (tab === "sales") {
      doc.setFontSize(13);
      doc.text("Summary", 14, 36);
      autoTable(doc, {
        startY: 40,
        head: [["Metric", "Value"]],
        body: [
          ["Total Revenue", `₹${Number(reports.totalRevenue).toLocaleString()}`],
          ["Total Orders", String(reports.totalOrders)],
          ["Avg Order Value", `₹${Number(reports.avgOrderValue).toFixed(2)}`],
        ],
      });
      const afterSummary = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 80;
      doc.setFontSize(13);
      doc.text("Daily Revenue", 14, afterSummary + 10);
      autoTable(doc, {
        startY: afterSummary + 14,
        head: [["Date", "Revenue", "Orders", "Avg Order"]],
        body: (reports.revenueByDay ?? []).map((r: RevenueByDayItem) => [
          r.date,
          `₹${Number(r.revenue).toLocaleString()}`,
          String(r.orders),
          r.orders > 0 ? `₹${(Number(r.revenue) / r.orders).toFixed(0)}` : "–",
        ]),
      });
    } else if (tab === "tax") {
      doc.setFontSize(13);
      doc.text("Summary", 14, 36);
      autoTable(doc, {
        startY: 40,
        head: [["Metric", "Value"]],
        body: [
          ["Tax Collected", `₹${Number(reports.totalTax).toLocaleString()}`],
          ["Effective Tax Rate", `${reports.effectiveTaxRate ?? "0.00"}%`],
        ],
      });
      const afterSummary = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 80;
      doc.setFontSize(13);
      doc.text("Tax Breakdown", 14, afterSummary + 10);
      autoTable(doc, {
        startY: afterSummary + 14,
        head: [["Date", "Tax Collected", "Revenue", "Orders", "Rate"]],
        body: (reports.taxByDay ?? []).map((r: TaxByDayItem) => [
          r.date,
          `₹${Number(r.tax).toLocaleString()}`,
          `₹${Number(r.revenue).toLocaleString()}`,
          String(r.orders),
          `${r.effectiveRate}%`,
        ]),
      });
    } else if (tab === "discounts") {
      doc.setFontSize(13);
      doc.text("Summary", 14, 36);
      autoTable(doc, {
        startY: 40,
        head: [["Metric", "Value"]],
        body: [["Total Discounts", `₹${Number(reports.totalDiscounts ?? 0).toLocaleString()}`]],
      });
      const afterSummary = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 60;
      doc.setFontSize(13);
      doc.text("Discounts by Cashier", 14, afterSummary + 10);
      autoTable(doc, {
        startY: afterSummary + 14,
        head: [["Cashier", "Type", "Reason", "Count", "Total"]],
        body: (reports.discountsByCashier ?? []).map((d: DiscountsByCashierItem) => [
          d.name, d.type, d.reason, String(d.count), `₹${Number(d.total).toLocaleString()}`,
        ]),
      });
    } else if (tab === "staff") {
      doc.setFontSize(13);
      doc.text("Staff Performance", 14, 36);
      autoTable(doc, {
        startY: 40,
        head: [["Staff Member", "Orders", "Revenue", "Hours", "Rev/Order"]],
        body: (reports.staffPerformance ?? []).map((s: StaffPerformanceItem) => [
          s.name,
          String(s.orderCount),
          `₹${Number(s.totalRevenue).toLocaleString()}`,
          `${s.totalHours}h`,
          s.orderCount > 0 ? `₹${(Number(s.totalRevenue) / s.orderCount).toFixed(0)}` : "–",
        ]),
      });
    } else if (tab === "devices") {
      doc.setFontSize(13);
      doc.text("Device Sales (by assigned waiter)", 14, 36);
      autoTable(doc, {
        startY: 40,
        head: [["Device", "Type", "Handheld", "Assigned Waiter", "Orders", "Revenue"]],
        body: (reports.devicePerformance ?? []).map((d: DevicePerformanceItem) => [
          d.deviceName,
          d.deviceType,
          d.isHandheld ? "Yes" : "No",
          d.assignedUserName ?? "—",
          String(d.orderCount),
          `₹${Number(d.totalRevenue).toLocaleString()}`,
        ]),
      });
    } else if (tab === "food-cost") {
      doc.setFontSize(13);
      doc.text(`Food Cost (Threshold: ${foodCostThreshold}% food cost)`, 14, 36);
      autoTable(doc, {
        startY: 40,
        head: [["Item", "Category", "Price", "COGS", "Margin %", "Food %", "Status"]],
        body: sortedFoodCost.map(i => [
          i.name,
          i.categoryName ?? "–",
          `₹${Number(i.price).toFixed(2)}`,
          i.hasRecipe ? `₹${Number(i.cogs).toFixed(2)}` : "–",
          i.hasRecipe ? `${i.margin.toFixed(1)}%` : "–",
          i.hasRecipe ? `${i.foodCostPct.toFixed(1)}%` : "–",
          !i.hasRecipe ? "No recipe" : i.isLowMargin ? "LOW MARGIN" : "Healthy",
        ]),
      });
    } else {
      doc.setFontSize(13);
      doc.text("Payments by Method", 14, 36);
      autoTable(doc, {
        startY: 40,
        head: [["Direction", "Method", "Count", "Total"]],
        body: (reports.paymentsByMethod ?? []).map((p: PaymentsByMethodItem) => [
          p.direction === "in" ? "Money In" : "Money Out",
          p.method,
          String(p.count),
          `₹${Number(p.total).toLocaleString()}`,
        ]),
      });
    }

    doc.save(`${tab}-report-${dateStamp}.pdf`);
  }

  const hasExpenseAccess = reports?.totalExpenses != null;
  const netProfitNum = hasExpenseAccess ? Number(reports?.netProfit ?? 0) : 0;
  const statCards = [
    { label: "Total Revenue", value: reports ? `₹${Number(reports.totalRevenue).toLocaleString()}` : "–", icon: DollarSign, color: "bg-orange-100 text-orange-600" },
    { label: "Avg Order Value", value: reports ? `₹${Number(reports.avgOrderValue ?? 0).toFixed(2)}` : "–", icon: TrendingUp, color: "bg-purple-100 text-purple-600" },
    { label: "Tax Collected", value: reports ? `₹${Number(reports.totalTax ?? 0).toLocaleString()}` : "–", icon: Receipt, color: "bg-amber-100 text-amber-600" },
    { label: "Total Orders", value: reports?.totalOrders ?? "–", icon: ShoppingBag, color: "bg-blue-100 text-blue-600" },
    ...(hasExpenseAccess ? [
      { label: "Total Expenses", value: `₹${Number(reports?.totalExpenses ?? 0).toLocaleString()}`, icon: Receipt, color: "bg-rose-100 text-rose-600" },
      { label: "Net Profit", value: `₹${netProfitNum.toLocaleString()}`, icon: TrendingUp, color: netProfitNum >= 0 ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600" },
    ] : []),
  ];

  if (sectionInvalid) {
    return <Redirect to="/reports/sales" />;
  }

  return (
    <Layout>
      <PageHeader
        title="Reports & Analytics"
        subtitle={hasMultipleBranches && tab !== "compare"
          ? (isAllBranches
              ? `All ${branches.length} branches consolidated`
              : `${branches.find(b => b.id === selectedBranchId)?.name ?? ""}`)
          : "Performance insights for your restaurant"}
        actions={
          <div className="flex items-center gap-2">
            {hasMultipleBranches && tab !== "compare" && <BranchSwitcher />}
            {tab === "compare" ? (
              <Button size="sm" variant="outline" onClick={handleExportCompareCSV} disabled={compareRows.length === 0}>
                <Download className="w-4 h-4 mr-1.5" /> CSV
              </Button>
            ) : tab === "menu-engineering" ? null : (
              <>
                <Button size="sm" variant="outline" onClick={handleExportCSV} disabled={!reports}>
                  <Download className="w-4 h-4 mr-1.5" /> CSV
                </Button>
                <Button size="sm" variant="outline" onClick={handleExportExcel} disabled={!reports}>
                  <Download className="w-4 h-4 mr-1.5" /> Excel
                </Button>
                <Button size="sm" variant="outline" onClick={handleExportPDF} disabled={!reports}>
                  <Download className="w-4 h-4 mr-1.5" /> PDF
                </Button>
              </>
            )}
          </div>
        }
      />
      <div className="p-6 space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 flex-wrap">
            {[
              { label: "7 Days", val: "7d" },
              { label: "30 Days", val: "30d" },
              { label: "90 Days", val: "90d" },
              { label: "1 Month", val: "1m" },
              { label: "1 Year", val: "1y" },
            ].map(({ label, val }) => (
              <Button
                key={val}
                size="sm"
                variant={!useCustom && period === val ? "default" : "outline"}
                onClick={() => { setPeriod(val); setUseCustom(false); }}
              >
                {label}
              </Button>
            ))}
          </div>

          <div className="flex gap-1 border border-border rounded-lg p-0.5 bg-muted/30">
            {(["daily", "monthly", "yearly"] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors ${
                  viewMode === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="text-sm border border-border rounded-md px-3 py-1.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-muted-foreground text-sm">to</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="text-sm border border-border rounded-md px-3 py-1.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <Button
              size="sm"
              variant={useCustom ? "default" : "outline"}
              disabled={!customFrom || !customTo}
              onClick={() => setUseCustom(true)}
            >
              Apply
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow duration-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground font-medium">{label}</p>
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ring-1 ring-current/10 ${color}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground tracking-tight">{isLoading ? "–" : value}</p>
            </div>
          ))}
        </div>

        {hasExpenseAccess && (reports?.expensesByCategory?.length ?? 0) > 0 && (
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">Expenses by Category</h3>
              <span className="text-xs text-muted-foreground">
                ₹{Number(reports?.totalExpenses ?? 0).toLocaleString()} total
              </span>
            </div>
            {(() => {
              const rows = reports?.expensesByCategory ?? [];
              const max = Math.max(...rows.map(r => Number(r.total)), 1);
              return (
                <div className="space-y-2.5">
                  {rows.map(r => {
                    const pct = (Number(r.total) / max) * 100;
                    const total = Number(reports?.totalExpenses ?? 0);
                    const share = total > 0 ? (Number(r.total) / total) * 100 : 0;
                    return (
                      <div key={r.categoryId} className="flex items-center gap-3 text-sm">
                        <div className="flex items-center gap-2 w-44 shrink-0">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />
                          <span className="text-foreground font-medium truncate">{r.categoryName}</span>
                        </div>
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: r.color }} />
                        </div>
                        <span className="text-foreground font-semibold w-24 text-right tabular-nums">
                          ₹{Number(r.total).toLocaleString("en-IN")}
                        </span>
                        <span className="text-muted-foreground w-12 text-right tabular-nums">{share.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        <div className="flex gap-1 border-b border-border">
          {([
            { label: "Sales", val: "sales" as Tab },
            ...(hasMultipleBranches ? [{ label: "Compare Branches", val: "compare" as Tab }] : []),
            { label: "Tax", val: "tax" as Tab },
            { label: "Staff Performance", val: "staff" as Tab },
            { label: "Devices", val: "devices" as Tab },
            { label: "Payments", val: "payments" as Tab },
            { label: "Discounts", val: "discounts" as Tab },
            { label: "Food Cost", val: "food-cost" as Tab },
            { label: "Cash Variance", val: "cash-variance" as Tab },
            { label: "Kitchen Performance", val: "kitchen-performance" as Tab },
            { label: "Menu Engineering", val: "menu-engineering" as Tab },
            { label: "Inventory Control", val: "inventory-control" as Tab },
            { label: "Add-ons", val: "addons" as Tab },
          ]).map(({ label, val }) => (
            <Link
              key={val}
              href={`/reports/${val}`}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === val ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

        {tab === "sales" && (
          <div className="space-y-6">
            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="font-semibold text-foreground mb-4">Revenue Over Time</h3>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={reports?.revenueByDay ?? []} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="repGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(20 92% 46%)" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="hsl(20 92% 46%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 6" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(d: string) => fmtDateTick(d, viewMode)} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `₹${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [`₹${Number(v).toLocaleString()}`, "Revenue"]}
                    labelFormatter={(d: string) => fmtDateLabel(d, viewMode)}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(20 92% 46%)" fill="url(#repGrad)" strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="font-semibold text-foreground mb-4">Orders Per Day</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={reports?.revenueByDay ?? []} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 6" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(d: string) => {
                      try { return format(new Date(d + "T12:00:00"), "MMM d"); } catch { return d; }
                    }} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} cursor={{ fill: "hsl(var(--muted) / 0.4)" }} />
                    <Bar dataKey="orders" fill="hsl(217 91% 60%)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="font-semibold text-foreground mb-4">Top 5 Items</h3>
                {(reports?.topItems?.length ?? 0) > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={(reports?.topItems ?? []).slice(0, 5)}
                      layout="vertical"
                      margin={{ top: 0, right: 10, left: 80, bottom: 0 }}
                    >
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                      <Tooltip formatter={(v: number) => [v, "Orders"]} />
                      <Bar dataKey="orderCount" radius={[0, 4, 4, 0]}>
                        {(reports?.topItems ?? []).slice(0, 5).map((_: TopItem, i: number) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No data yet</div>
                )}
              </div>
            </div>

            {(reports?.revenueByDay?.length ?? 0) > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <h3 className="font-semibold text-foreground">Daily Revenue Breakdown</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Date</th>
                        <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Orders</th>
                        <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Revenue</th>
                        <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Avg Order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reports?.revenueByDay ?? []).slice().reverse().map((row: RevenueByDayItem) => (
                        <tr key={row.date} className="border-t border-border hover:bg-muted/20">
                          <td className="px-5 py-2.5 text-foreground">
                            {fmtTableDate(row.date, viewMode)}
                          </td>
                          <td className="px-5 py-2.5 text-right text-foreground">{row.orders}</td>
                          <td className="px-5 py-2.5 text-right font-medium text-foreground">₹{Number(row.revenue).toLocaleString()}</td>
                          <td className="px-5 py-2.5 text-right text-muted-foreground">
                            {row.orders > 0 ? `₹${(Number(row.revenue) / row.orders).toFixed(0)}` : "–"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "compare" && (
          <div className="space-y-6">
            {!hasMultipleBranches ? (
              <div className="bg-card border border-border rounded-xl p-12 text-center">
                <p className="text-muted-foreground">
                  Branch comparison is available once your account has more than one branch.
                </p>
              </div>
            ) : compareLoading ? (
              <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
                Loading comparison…
              </div>
            ) : compareRows.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
                No data for the selected period.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  {(() => {
                    const totalRevenue = compareRows.reduce((s, r) => s + Number(r.revenue), 0);
                    const totalOrders = compareRows.reduce((s, r) => s + r.orders, 0);
                    const totalProfit = compareRows.reduce((s, r) => s + Number(r.netProfit ?? 0), 0);
                    const top = compareRows.slice().sort((a, b) => Number(b.revenue) - Number(a.revenue))[0];
                    return (
                      <>
                        <div className="bg-card border border-border rounded-xl p-4">
                          <p className="text-sm text-muted-foreground mb-1">Total Revenue</p>
                          <p className="text-2xl font-bold text-foreground">₹{totalRevenue.toLocaleString("en-IN")}</p>
                        </div>
                        <div className="bg-card border border-border rounded-xl p-4">
                          <p className="text-sm text-muted-foreground mb-1">Total Orders</p>
                          <p className="text-2xl font-bold text-foreground">{totalOrders.toLocaleString("en-IN")}</p>
                        </div>
                        <div className="bg-card border border-border rounded-xl p-4">
                          <p className="text-sm text-muted-foreground mb-1">Net Profit (all)</p>
                          <p className={`text-2xl font-bold ${totalProfit >= 0 ? "text-foreground" : "text-rose-600"}`}>
                            ₹{totalProfit.toLocaleString("en-IN")}
                          </p>
                        </div>
                        <div className="bg-card border border-border rounded-xl p-4">
                          <p className="text-sm text-muted-foreground mb-1">Top Branch</p>
                          <p className="text-lg font-semibold text-foreground truncate" title={top?.name}>{top?.name ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">₹{Number(top?.revenue ?? 0).toLocaleString("en-IN")}</p>
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div className="bg-card border border-border rounded-xl p-5">
                  <h3 className="font-semibold text-foreground mb-4">Revenue by Branch</h3>
                  <ResponsiveContainer width="100%" height={Math.max(240, compareRows.length * 38)}>
                    <BarChart data={compareRows.map(r => ({ name: r.name, revenue: Number(r.revenue), orders: r.orders }))}
                      layout="vertical" margin={{ top: 0, right: 16, left: 80, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 6" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => `₹${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={120} />
                      <Tooltip formatter={(v: number) => [`₹${Number(v).toLocaleString("en-IN")}`, "Revenue"]} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="revenue" radius={[0, 6, 6, 0]}>
                        {compareRows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                    <h3 className="font-semibold text-foreground">Side-by-side comparison</h3>
                    <span className="text-xs text-muted-foreground">{compareRows.length} branches</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          {([
                            { k: "name" as const, label: "Branch", align: "text-left" },
                            { k: "revenue" as const, label: "Revenue", align: "text-right" },
                            { k: "orders" as const, label: "Orders", align: "text-right" },
                            { k: "avgOrderValue" as const, label: "Avg Order", align: "text-right" },
                            { k: "tax" as const, label: "Tax", align: "text-right" },
                            { k: "expenses" as const, label: "Expenses", align: "text-right" },
                            { k: "netProfit" as const, label: "Net Profit", align: "text-right" },
                          ]).map(col => (
                            <th key={col.k} className={`px-5 py-2.5 text-muted-foreground font-medium ${col.align}`}>
                              <button onClick={() => toggleCompareSort(col.k)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                                {col.label}
                                <ArrowUpDown className={`w-3 h-3 ${compareSort.key === col.k ? "text-primary" : "opacity-40"}`} />
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {compareRows.map(r => {
                          const np = r.netProfit == null ? null : Number(r.netProfit);
                          return (
                            <tr key={r.restaurantId} className="border-t border-border hover:bg-muted/20">
                              <td className="px-5 py-2.5">
                                <div className="font-medium text-foreground">{r.name}</div>
                                {r.city && <div className="text-xs text-muted-foreground">{r.city}</div>}
                              </td>
                              <td className="px-5 py-2.5 text-right font-medium text-foreground tabular-nums">₹{Number(r.revenue).toLocaleString("en-IN")}</td>
                              <td className="px-5 py-2.5 text-right text-foreground tabular-nums">{r.orders.toLocaleString("en-IN")}</td>
                              <td className="px-5 py-2.5 text-right text-muted-foreground tabular-nums">₹{Number(r.avgOrderValue).toFixed(2)}</td>
                              <td className="px-5 py-2.5 text-right text-muted-foreground tabular-nums">₹{Number(r.tax).toLocaleString("en-IN")}</td>
                              <td className="px-5 py-2.5 text-right text-muted-foreground tabular-nums">
                                {r.expenses == null ? "—" : `₹${Number(r.expenses).toLocaleString("en-IN")}`}
                              </td>
                              <td className={`px-5 py-2.5 text-right font-semibold tabular-nums ${np == null ? "text-muted-foreground" : np >= 0 ? "text-green-600 dark:text-green-400" : "text-rose-600 dark:text-rose-400"}`}>
                                {np == null ? "—" : `₹${np.toLocaleString("en-IN")}`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "tax" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-sm text-muted-foreground mb-1">Total Tax Collected</p>
                <p className="text-2xl font-bold text-foreground">
                  {isLoading ? "–" : reports ? `₹${Number(reports.totalTax).toLocaleString()}` : "–"}
                </p>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-sm text-muted-foreground mb-1">Effective Tax Rate</p>
                <div className="flex items-baseline gap-1">
                  <p className="text-2xl font-bold text-foreground">
                    {isLoading ? "–" : reports?.effectiveTaxRate ?? "0.00"}
                  </p>
                  <span className="text-muted-foreground text-sm">%</span>
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Percent className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Tax / Revenue Ratio</p>
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {isLoading || !reports ? "–" : Number(reports.totalRevenue) > 0
                    ? `${((Number(reports.totalTax) / Number(reports.totalRevenue)) * 100).toFixed(1)}%`
                    : "0%"}
                </p>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="font-semibold text-foreground mb-4">Daily Tax Collection</h3>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={reports?.taxByDay ?? []} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="taxGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(280 65% 60%)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="hsl(280 65% 60%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => fmtDateTick(d, viewMode)} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `₹${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                  <Tooltip
                    formatter={(v: number) => [`₹${Number(v).toLocaleString()}`, "Tax"]}
                    labelFormatter={(d: string) => fmtDateLabel(d, viewMode)}
                  />
                  <Area type="monotone" dataKey="tax" stroke="hsl(280 65% 60%)" fill="url(#taxGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {(reports?.taxByDay?.length ?? 0) > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <h3 className="font-semibold text-foreground">Daily Tax Breakdown</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Date</th>
                        <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Orders</th>
                        <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Revenue</th>
                        <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Tax Collected</th>
                        <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Effective Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reports?.taxByDay ?? []).slice().reverse().map((row: TaxByDayItem) => (
                        <tr key={row.date} className="border-t border-border hover:bg-muted/20">
                          <td className="px-5 py-2.5 text-foreground">
                            {fmtTableDate(row.date, viewMode)}
                          </td>
                          <td className="px-5 py-2.5 text-right text-foreground">{row.orders}</td>
                          <td className="px-5 py-2.5 text-right text-foreground">₹{Number(row.revenue).toLocaleString()}</td>
                          <td className="px-5 py-2.5 text-right font-medium text-foreground">₹{Number(row.tax).toLocaleString()}</td>
                          <td className="px-5 py-2.5 text-right text-muted-foreground">{row.effectiveRate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "devices" && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-semibold text-foreground">Device Sales</h3>
              <span className="text-xs text-muted-foreground ml-2">Sales attributed via assigned waiter</span>
            </div>
            {(reports?.devicePerformance?.length ?? 0) === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                No assigned devices for this period. Assign waiters to devices in Settings → Devices.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Device</th>
                      <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Type</th>
                      <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Assigned Waiter</th>
                      <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Orders</th>
                      <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Revenue</th>
                      <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Rev/Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(reports?.devicePerformance ?? []).map((d: DevicePerformanceItem) => (
                      <tr key={d.deviceId} className="border-t border-border hover:bg-muted/20">
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{d.deviceName}</span>
                            {d.isHandheld && (
                              <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary">Handheld</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-2.5 text-muted-foreground">{d.deviceType}</td>
                        <td className="px-5 py-2.5 text-foreground">{d.assignedUserName ?? "—"}</td>
                        <td className="px-5 py-2.5 text-right text-foreground">{d.orderCount}</td>
                        <td className="px-5 py-2.5 text-right font-medium text-foreground">₹{Number(d.totalRevenue).toLocaleString()}</td>
                        <td className="px-5 py-2.5 text-right text-muted-foreground">
                          {d.orderCount > 0 ? `₹${(Number(d.totalRevenue) / d.orderCount).toFixed(0)}` : "–"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "staff" && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-semibold text-foreground">Staff Performance</h3>
            </div>
            {(reports?.staffPerformance?.length ?? 0) === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No staff data for this period</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Staff Member</th>
                      <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Orders</th>
                      <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Revenue</th>
                      <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Hours</th>
                      <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Rev/Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(reports?.staffPerformance ?? []).map((s: StaffPerformanceItem) => (
                      <tr key={s.userId} className="border-t border-border hover:bg-muted/20">
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                              {s.name[0].toUpperCase()}
                            </div>
                            <span className="font-medium text-foreground">{s.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-2.5 text-right text-foreground">{s.orderCount}</td>
                        <td className="px-5 py-2.5 text-right font-medium text-foreground">₹{Number(s.totalRevenue).toLocaleString()}</td>
                        <td className="px-5 py-2.5 text-right text-muted-foreground">{s.totalHours}h</td>
                        <td className="px-5 py-2.5 text-right text-muted-foreground">
                          {s.orderCount > 0 ? `₹${(Number(s.totalRevenue) / s.orderCount).toFixed(0)}` : "–"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "discounts" && (
          <div className="space-y-6">
            <div className="bg-card border border-border rounded-xl p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 text-green-600 flex items-center justify-center">
                  <Percent className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Discounts</div>
                  <div className="text-xl font-semibold text-foreground">₹{Number(reports?.totalDiscounts ?? 0).toLocaleString()}</div>
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                {(reports?.discountsByCashier ?? []).reduce((s, r) => s + r.count, 0)} discount{(reports?.discountsByCashier ?? []).reduce((s, r) => s + r.count, 0) === 1 ? "" : "s"} applied
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center gap-2">
                <Percent className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-semibold text-foreground">Discounts by Cashier &amp; Reason</h3>
              </div>
              {(reports?.discountsByCashier?.length ?? 0) === 0 ? (
                <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No discounts in this period</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Cashier</th>
                        <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Type</th>
                        <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Reason</th>
                        <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Count</th>
                        <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Total Discount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reports?.discountsByCashier ?? []).map((d: DiscountsByCashierItem, i: number) => (
                        <tr key={`${d.userId ?? "sys"}-${d.type}-${d.reason}-${i}`} className="border-t border-border hover:bg-muted/20">
                          <td className="px-5 py-2.5 font-medium text-foreground">{d.name}</td>
                          <td className="px-5 py-2.5 text-muted-foreground capitalize">{d.type}</td>
                          <td className="px-5 py-2.5 text-foreground">{d.reason}</td>
                          <td className="px-5 py-2.5 text-right text-muted-foreground">{d.count}</td>
                          <td className="px-5 py-2.5 text-right font-medium text-green-600">₹{Number(d.total).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <DiscountInsightsBlock period={useCustom ? "custom" : period} customFrom={customFrom} customTo={customTo} />
          </div>
        )}

        {tab === "payments" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {(["in", "out"] as const).map(dir => {
                const items = (reports?.paymentsByMethod ?? []).filter((p: PaymentsByMethodItem) => p.direction === dir);
                const grandTotal = items.reduce((s, p) => s + Number(p.total), 0);
                return (
                  <div key={dir} className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                      <h3 className="font-semibold text-foreground">
                        {dir === "in" ? "Money In — by Method" : "Money Out — by Method"}
                      </h3>
                      <span className={`text-sm font-semibold ${dir === "in" ? "text-green-600" : "text-orange-600"}`}>
                        ₹{grandTotal.toLocaleString()}
                      </span>
                    </div>
                    {items.length === 0 ? (
                      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                        No {dir === "in" ? "incoming" : "outgoing"} payments in this period
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Method</th>
                            <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Count</th>
                            <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Total</th>
                            <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map(p => {
                            const total = Number(p.total);
                            const share = grandTotal > 0 ? (total / grandTotal) * 100 : 0;
                            return (
                              <tr key={`${p.direction}-${p.method}`} className="border-t border-border hover:bg-muted/20">
                                <td className="px-5 py-2.5 capitalize text-foreground font-medium">{p.method}</td>
                                <td className="px-5 py-2.5 text-right text-muted-foreground">{p.count}</td>
                                <td className="px-5 py-2.5 text-right font-medium text-foreground">₹{total.toLocaleString()}</td>
                                <td className="px-5 py-2.5 text-right text-muted-foreground">{share.toFixed(1)}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "food-cost" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-muted-foreground">Items with Recipe</p>
                  <Flame className="w-4 h-4 text-orange-500" />
                </div>
                <p className="text-2xl font-bold">{recipeCoverage} / {foodCost?.items.length ?? 0}</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-sm text-muted-foreground mb-1">Avg Margin</p>
                <p className="text-2xl font-bold">{avgMargin == null ? "–" : `${avgMargin.toFixed(1)}%`}</p>
              </div>
              <div className={`bg-card border rounded-xl p-4 ${lowMarginCount > 0 ? "border-red-200" : "border-border"}`}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-muted-foreground">Low-Margin Items</p>
                  {lowMarginCount > 0 && <AlertTriangle className="w-4 h-4 text-red-500" />}
                </div>
                <p className={`text-2xl font-bold ${lowMarginCount > 0 ? "text-red-600" : "text-foreground"}`}>{lowMarginCount}</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-sm text-muted-foreground mb-1">Low-Margin Threshold (food cost %)</p>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={foodCostThreshold}
                    onChange={e => setFoodCostThreshold(Math.max(1, Math.min(100, Number(e.target.value) || 65)))}
                    className="h-9 w-20"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant={foodCostFilter === "all" ? "default" : "outline"} onClick={() => setFoodCostFilter("all")}>All</Button>
              <Button size="sm" variant={foodCostFilter === "withRecipe" ? "default" : "outline"} onClick={() => setFoodCostFilter("withRecipe")}>With Recipe</Button>
              <Button size="sm" variant={foodCostFilter === "lowMargin" ? "default" : "outline"} onClick={() => setFoodCostFilter("lowMargin")}>
                <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Low Margin
              </Button>
              <span className="text-xs text-muted-foreground ml-2">Showing {sortedFoodCost.length} items</span>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      {([
                        { key: "name", label: "Item", align: "left" },
                        { key: "categoryName", label: "Category", align: "left" },
                        { key: "price", label: "Price", align: "right" },
                        { key: "cogs", label: "COGS", align: "right" },
                        { key: "margin", label: "Margin %", align: "right" },
                        { key: "foodCostPct", label: "Food Cost %", align: "right" },
                        { key: "ingredientCount", label: "Ingredients", align: "right" },
                      ] as { key: keyof FoodCostItem; label: string; align: "left" | "right" }[]).map(col => (
                        <th
                          key={col.key}
                          className={`px-5 py-2.5 text-muted-foreground font-medium cursor-pointer select-none hover:text-foreground ${col.align === "right" ? "text-right" : "text-left"}`}
                          onClick={() => toggleSort(col.key)}
                        >
                          <span className="inline-flex items-center gap-1">
                            {col.label}
                            <ArrowUpDown className={`w-3 h-3 ${foodCostSort.key === col.key ? "text-primary" : "opacity-40"}`} />
                          </span>
                        </th>
                      ))}
                      <th className="text-center px-5 py-2.5 text-muted-foreground font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFoodCost.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-12 text-muted-foreground">
                          <Flame className="w-8 h-8 mx-auto mb-2 opacity-30" />
                          <p className="text-sm">No items match this filter</p>
                          <p className="text-xs mt-1">Add ingredients to menu items to start tracking food cost</p>
                        </td>
                      </tr>
                    ) : sortedFoodCost.map(item => (
                      <tr key={item.id} className={`border-t border-border hover:bg-muted/20 ${item.isLowMargin ? "bg-red-50/40" : ""}`}>
                        <td className="px-5 py-2.5 font-medium text-foreground">{item.name}</td>
                        <td className="px-5 py-2.5 text-muted-foreground">{item.categoryName ?? "–"}</td>
                        <td className="px-5 py-2.5 text-right text-foreground">₹{Number(item.price).toFixed(2)}</td>
                        <td className="px-5 py-2.5 text-right text-foreground">
                          {item.hasRecipe ? `₹${Number(item.cogs).toFixed(2)}` : "–"}
                        </td>
                        <td className={`px-5 py-2.5 text-right font-semibold ${item.hasRecipe ? (item.isLowMargin ? "text-red-600" : "text-green-600") : "text-muted-foreground"}`}>
                          {item.hasRecipe ? `${item.margin.toFixed(1)}%` : "–"}
                        </td>
                        <td className="px-5 py-2.5 text-right text-muted-foreground">
                          {item.hasRecipe ? `${item.foodCostPct.toFixed(1)}%` : "–"}
                        </td>
                        <td className="px-5 py-2.5 text-right text-muted-foreground">{item.ingredientCount}</td>
                        <td className="px-5 py-2.5 text-center">
                          {!item.hasRecipe ? (
                            <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full">No recipe</span>
                          ) : item.isLowMargin ? (
                            <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                              <AlertTriangle className="w-2.5 h-2.5" /> Low margin
                            </span>
                          ) : (
                            <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Healthy</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              COGS = sum of (recipe quantity × inventory cost per unit). Margin % = (price − COGS) ÷ price.
              Editing an inventory item's purchase price recalculates all dependent items live.
            </p>
          </div>
        )}

        {tab === "cash-variance" && <CashVarianceTab from={useCustom ? customFrom : undefined} to={useCustom ? customTo : undefined} />}

        {tab === "kitchen-performance" && (
          <KitchenPerformanceTab from={useCustom ? customFrom : undefined} to={useCustom ? customTo : undefined} />
        )}

        {tab === "menu-engineering" && (
          <MenuEngineeringTab
            period={period}
            custom={useCustom && customFrom && customTo ? { from: customFrom, to: customTo } : undefined}
          />
        )}

        {tab === "inventory-control" && <InventoryControlReport />}

        {tab === "addons" && (
          <AddonsReportTab
            period={useCustom && customFrom && customTo ? null : period}
            custom={useCustom && customFrom && customTo ? { from: customFrom, to: customTo } : null}
          />
        )}
      </div>
    </Layout>
  );
}

function InventoryControlReport() {
  const drift = usePortionDriftEvents({ status: "open" });
  const tt = useTasteTests({ status: "pending" });
  const pkg = usePackagingItems();
  const cond = useCondimentItems();
  const versions = useRecipeVersions();

  const lowPkg = (pkg.data ?? []).filter(i => Number(i.currentStock) <= Number(i.minStockLevel));
  const lowCond = (cond.data ?? []).filter(i => Number(i.currentStock) <= Number(i.minStockLevel));
  const activeVersions = (versions.data ?? []).filter(v => v.isActive);
  const pendingVersions = (versions.data ?? []).filter(v => v.status === "pending_approval");

  const Cell = ({ label, value, href, tone }: { label: string; value: string | number; href: string; tone?: string }) => (
    <Link href={href} className="block bg-card border border-border rounded-xl p-5 hover:border-primary transition-colors">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${tone ?? "text-foreground"}`}>{value}</p>
    </Link>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <Cell label="Packaging items" value={pkg.data?.length ?? 0} href="/inventory/packaging" />
        <Cell label="Low-stock packaging" value={lowPkg.length} href="/inventory/packaging" tone={lowPkg.length ? "text-orange-600" : undefined} />
        <Cell label="Condiments tracked" value={cond.data?.length ?? 0} href="/inventory/condiments" />
        <Cell label="Low-stock condiments" value={lowCond.length} href="/inventory/condiments" tone={lowCond.length ? "text-orange-600" : undefined} />
        <Cell label="Open drift alerts" value={drift.data?.length ?? 0} href="/inventory/portion-drift" tone={(drift.data?.length ?? 0) > 0 ? "text-red-600" : undefined} />
        <Cell label="Active recipe versions" value={activeVersions.length} href="/inventory/recipe-versions" />
        <Cell label="Pending approval" value={pendingVersions.length} href="/inventory/recipe-versions" tone={pendingVersions.length ? "text-amber-600" : undefined} />
        <Cell label="Pending taste tests" value={tt.data?.length ?? 0} href="/kitchen/taste-testing" tone={(tt.data?.length ?? 0) > 0 ? "text-amber-600" : undefined} />
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-semibold mb-3">Recent portion-drift alerts</h3>
        {(drift.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No open drift alerts. The nightly sweep runs at 03:30 IST.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {(drift.data ?? []).slice(0, 8).map(ev => (
              <li key={ev.id} className="flex justify-between border-b py-1">
                <span>{ev.inventoryItemName} <span className="text-xs text-muted-foreground">({ev.severity})</span></span>
                <span className={Number(ev.driftPct) > 0 ? "text-red-600" : "text-amber-600"}>
                  {Number(ev.driftPct) > 0 ? "+" : ""}{Number(ev.driftPct).toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function KitchenPerformanceTab({ from, to }: { from?: string; to?: string }) {
  const range = from && to ? { from, to } : undefined;
  const { data, isLoading } = useKitchenPerformance(range);
  const { data: ai, isLoading: aiLoading } = useKitchenPerformanceAiSummary(range);

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Loading kitchen performance…</p>;
  const summary = data.summary;
  const fmtMin = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}m`);

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 border border-orange-200 dark:border-orange-900 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300">AI Insight</span>
          {ai?.cached && <span className="text-[10px] text-muted-foreground">(cached)</span>}
        </div>
        {aiLoading ? (
          <p className="text-sm text-muted-foreground">Generating summary…</p>
        ) : ai ? (
          <>
            <p className="text-sm text-foreground leading-relaxed">{ai.summary}</p>
            {ai.insights?.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-sm text-foreground">
                {ai.insights.map((it, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-orange-500 shrink-0">•</span>
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No insight available.</p>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard label="Tickets" value={summary.ticketsTotal.toString()} />
        <KpiCard label="Delayed" value={summary.ticketsDelayed.toString()} sub={`${summary.delayedPct.toFixed(1)}%`} />
        <KpiCard label="Avg Prep Time" value={fmtMin(summary.avgPrepMinutes)} />
        <KpiCard label="Alerts Fired" value={summary.alertsTotal.toString()} />
        <KpiCard label="Stations" value={data.stations.length.toString()} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Per-Station Performance</h3>
          <div className="space-y-2">
            {data.stations.map(s => (
              <div key={s.station.id ?? "unassigned"} className="flex items-center gap-3 text-sm">
                <span className="font-medium flex-1 truncate">{s.station.name}</span>
                <span className="text-muted-foreground tabular-nums w-16 text-right">{fmtMin(s.avgPrepMinutes)}</span>
                <span className="text-muted-foreground tabular-nums w-12 text-right">{s.ticketsTotal}</span>
                <span className={cn("tabular-nums w-14 text-right text-xs px-1.5 py-0.5 rounded-full", s.delayedPct > 20 ? "bg-red-100 text-red-700" : s.delayedPct > 10 ? "bg-orange-100 text-orange-700" : "bg-emerald-100 text-emerald-700")}>{s.delayedPct.toFixed(0)}%</span>
              </div>
            ))}
            {data.stations.length === 0 && <p className="text-sm text-muted-foreground">No data in this window.</p>}
          </div>
          <div className="grid grid-cols-3 text-[10px] uppercase text-muted-foreground tracking-wide mt-3 px-1">
            <span>Station</span>
            <span className="text-right">Avg / Tickets</span>
            <span className="text-right">Delayed</span>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Top Delayed Items</h3>
          <div className="space-y-2">
            {data.topDelayedItems.map((it, i) => (
              <div key={`${it.menuItemId ?? "x"}-${i}`} className="flex items-center gap-3 text-sm">
                <span className="font-medium flex-1 truncate">{it.name}</span>
                <span className="text-muted-foreground tabular-nums w-12 text-right">{it.ticketsDelayed}×</span>
                <span className="text-red-600 tabular-nums w-16 text-right">+{it.avgDelayMinutes.toFixed(1)}m</span>
              </div>
            ))}
            {data.topDelayedItems.length === 0 && <p className="text-sm text-muted-foreground">No delayed items in this window.</p>}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Peak Delay Hours</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.peakHours} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 6" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(h: number) => `${h}:00`} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} labelFormatter={(h: number) => `${h}:00`} />
              <Bar dataKey="ticketsDelayed" fill="hsl(20 92% 46%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Station Overload (Peak Concurrent Tickets)</h3>
          <div className="space-y-2">
            {data.overload.map(o => (
              <div key={o.stationId ?? "x"} className="flex items-center gap-3 text-sm">
                <span className="font-medium flex-1 truncate">{o.stationName}</span>
                <span className="text-muted-foreground tabular-nums w-16 text-right">peak {o.peakConcurrent}</span>
              </div>
            ))}
            {data.overload.length === 0 && <p className="text-sm text-muted-foreground">No overload data.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function CashVarianceTab({ from, to }: { from?: string; to?: string }) {
  const { data, isLoading } = useCashVarianceHistory(from && to ? { from, to } : undefined);
  const sessions = data?.sessions ?? [];
  const cashiers = data?.cashiers ?? [];

  const totalAbsVariance = cashiers.reduce((s, c) => s + c.totalAbsVariance, 0);
  const totalSessions = cashiers.reduce((s, c) => s + c.sessionCount, 0);
  const totalShort = cashiers.reduce((s, c) => s + c.shortCount, 0);
  const totalOver = cashiers.reduce((s, c) => s + c.overCount, 0);

  const handleExport = () => {
    const rows = sessions.map(s => [
      String(s.id),
      s.openedAt ? format(new Date(s.openedAt), "yyyy-MM-dd HH:mm") : "",
      s.closedAt ? format(new Date(s.closedAt), "yyyy-MM-dd HH:mm") : "",
      s.closedByName ?? s.openedByName ?? "",
      s.expectedCash ?? "",
      s.actualCash ?? "",
      s.overShort ?? "",
      s.varianceReason ?? "",
      s.isBlindClose ? "yes" : "no",
    ]);
    exportCSV("cash-variance.csv", rows, ["Session", "Opened", "Closed", "Cashier", "Expected", "Counted", "Over/Short", "Variance reason", "Blind close"]);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Closed cash register sessions and the variance between expected and counted cash.
        </p>
        <Button size="sm" variant="outline" onClick={handleExport} disabled={sessions.length === 0}>
          <Download className="w-4 h-4 mr-1.5" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-sm text-muted-foreground">Sessions</p>
          <p className="text-2xl font-bold text-foreground">{totalSessions}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-sm text-muted-foreground">Total |variance|</p>
          <p className="text-2xl font-bold text-foreground">₹{totalAbsVariance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-sm text-muted-foreground">Short closes</p>
          <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">{totalShort}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-sm text-muted-foreground">Over closes</p>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{totalOver}</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h3 className="font-semibold text-foreground">By Cashier</h3>
        </div>
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground text-center">Loading…</div>
        ) : cashiers.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">No closed sessions in this period.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Cashier</th>
                <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Sessions</th>
                <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Balanced</th>
                <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Over</th>
                <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Short</th>
                <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Net variance</th>
                <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Total |variance|</th>
                <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Last close</th>
              </tr>
            </thead>
            <tbody>
              {cashiers.map(c => (
                <tr key={c.userId} className="border-t border-border hover:bg-muted/20">
                  <td className="px-5 py-2.5 font-medium text-foreground">{c.name ?? `User #${c.userId}`}</td>
                  <td className="px-5 py-2.5 text-right text-muted-foreground">{c.sessionCount}</td>
                  <td className="px-5 py-2.5 text-right text-green-600 dark:text-green-400">{c.balancedCount}</td>
                  <td className="px-5 py-2.5 text-right text-blue-600 dark:text-blue-400">{c.overCount}</td>
                  <td className="px-5 py-2.5 text-right text-rose-600 dark:text-rose-400">{c.shortCount}</td>
                  <td className={`px-5 py-2.5 text-right font-medium tabular-nums ${c.totalVariance >= 0 ? "text-blue-600 dark:text-blue-400" : "text-rose-600 dark:text-rose-400"}`}>
                    {c.totalVariance >= 0 ? "+" : "-"}₹{Math.abs(c.totalVariance).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-5 py-2.5 text-right font-semibold text-foreground tabular-nums">
                    ₹{c.totalAbsVariance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-5 py-2.5 text-right text-xs text-muted-foreground">
                    {c.lastSessionAt ? format(new Date(c.lastSessionAt), "MMM d, HH:mm") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h3 className="font-semibold text-foreground">Closed Sessions</h3>
        </div>
        {sessions.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">No closed sessions in this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Session</th>
                  <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Closed</th>
                  <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Cashier</th>
                  <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Expected</th>
                  <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Counted</th>
                  <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Over/Short</th>
                  <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => {
                  const os = s.overShort !== null ? Number(s.overShort) : 0;
                  const balanced = Math.abs(os) < 0.01;
                  return (
                    <tr key={s.id} className="border-t border-border hover:bg-muted/20">
                      <td className="px-5 py-2.5 font-medium text-foreground">#{s.id}</td>
                      <td className="px-5 py-2.5 text-muted-foreground text-xs">
                        {s.closedAt ? format(new Date(s.closedAt), "MMM d, HH:mm") : "—"}
                      </td>
                      <td className="px-5 py-2.5 text-foreground">{s.closedByName ?? s.openedByName ?? "—"}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-foreground">
                        {s.expectedCash !== null ? `₹${Number(s.expectedCash).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-foreground">
                        {s.actualCash !== null ? `₹${Number(s.actualCash).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}
                      </td>
                      <td className={`px-5 py-2.5 text-right font-medium tabular-nums ${balanced ? "text-green-600 dark:text-green-400" : os > 0 ? "text-blue-600 dark:text-blue-400" : "text-rose-600 dark:text-rose-400"}`}>
                        {balanced ? "₹0.00" : `${os > 0 ? "+" : "-"}₹${Math.abs(os).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
                      </td>
                      <td className="px-5 py-2.5 text-xs text-muted-foreground max-w-md truncate" title={s.varianceReason ?? ""}>
                        {s.varianceReason ?? (balanced ? "—" : <span className="text-amber-600 dark:text-amber-400 italic">(no reason recorded)</span>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function DiscountInsightsBlock({ period, customFrom, customTo }: { period: string; customFrom: string; customTo: string }) {
  const [groupBy, setGroupBy] = useState<"type" | "reason" | "staff" | "customer" | "day">("type");
  const restaurantId = useRestaurantId();
  const auth = useAuth();
  const insights = useDiscountInsights(period, groupBy, period === "custom" ? { from: customFrom, to: customTo } : undefined);
  const data = insights.data;

  const downloadCsv = async () => {
    const qs = new URLSearchParams({ period, groupBy, format: "csv" });
    if (period === "custom") { qs.set("from", customFrom); qs.set("to", customTo); }
    const { getApiUrl } = await import("@/lib/api");
    const url = getApiUrl(`/restaurants/${restaurantId}/reports/discount-insights?${qs.toString()}`);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${auth.accessToken ?? ""}` } });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `discount-insights-${period}-${groupBy}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Percent className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-foreground">Discount Insights — ROI</h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={groupBy} onChange={e => setGroupBy(e.target.value as typeof groupBy)}
            className="h-8 px-2 rounded-md border border-border bg-background text-xs">
            <option value="type">By Type</option>
            <option value="reason">By Reason</option>
            <option value="staff">By Staff</option>
            <option value="customer">By Customer</option>
            <option value="day">By Day</option>
          </select>
          <Button size="sm" variant="outline" onClick={downloadCsv}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> CSV
          </Button>
        </div>
      </div>
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border">
          {[
            { label: "Discounts", val: data.kpis.discountCount.toLocaleString() },
            { label: "Total ₹ off", val: `₹${data.kpis.totalDiscount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` },
            { label: "Orders", val: data.kpis.ordersCount.toLocaleString() },
            { label: "Net revenue", val: `₹${data.kpis.netRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` },
            { label: "ROI (₹ rev / ₹ off)", val: data.kpis.roi != null ? `${data.kpis.roi.toFixed(2)}×` : "—" },
          ].map(k => (
            <div key={k.label} className="p-3 bg-card">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
              <div className="text-base font-semibold text-foreground">{k.val}</div>
            </div>
          ))}
        </div>
      )}
      {insights.isLoading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading…</div>
      ) : (data?.rows.length ?? 0) === 0 ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">No data for this selection</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">{groupBy === "day" ? "Day" : groupBy === "staff" ? "Staff" : groupBy === "customer" ? "Customer" : groupBy === "type" ? "Type" : "Reason"}</th>
                <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Count</th>
                <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">₹ Discount</th>
                <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Orders</th>
                <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Net ₹</th>
                <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">ROI</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map(r => (
                <tr key={r.key} className="border-t border-border hover:bg-muted/20">
                  <td className="px-5 py-2.5 font-medium text-foreground">{r.label}</td>
                  <td className="px-5 py-2.5 text-right text-muted-foreground tabular-nums">{r.discountCount}</td>
                  <td className="px-5 py-2.5 text-right text-green-600 font-medium tabular-nums">₹{r.totalDiscount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                  <td className="px-5 py-2.5 text-right text-muted-foreground tabular-nums">{r.ordersCount}</td>
                  <td className="px-5 py-2.5 text-right text-foreground tabular-nums">₹{r.netRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                  <td className="px-5 py-2.5 text-right text-foreground tabular-nums">{r.roi != null ? `${r.roi.toFixed(2)}×` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddonsReportTab({ period, custom }: { period: string | null; custom: { from: string; to: string } | null }) {
  const { data, isLoading } = useAddonsReport({
    period: period ?? undefined,
    custom: custom ?? undefined,
  });
  const rows = data?.rows ?? [];
  function handleExport() {
    exportCSV(
      `addons-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map(r => [r.name, r.groupName ?? "", String(r.totalQuantity), r.totalRevenue.toFixed(2), String(r.orderCount)]),
      ["Modifier", "Group", "Quantity", "Revenue", "Orders"],
    );
  }
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Add-on Revenue</div>
          <div className="text-2xl font-bold text-foreground mt-1">₹{Number(data?.totalRevenue ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Quantity Sold</div>
          <div className="text-2xl font-bold text-foreground mt-1">{Number(data?.totalQuantity ?? 0).toLocaleString("en-IN")}</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Unique Add-ons</div>
          <div className="text-2xl font-bold text-foreground mt-1">{rows.length}</div>
        </div>
      </div>
      <div className="bg-card border border-border rounded-xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="font-semibold text-foreground">Top Add-ons</h3>
          <Button size="sm" variant="outline" onClick={handleExport} disabled={!rows.length}>
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">No add-on sales in this period.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase text-muted-foreground tracking-wide">
                <th className="px-5 py-2.5 text-left">Modifier</th>
                <th className="px-5 py-2.5 text-left">Group</th>
                <th className="px-5 py-2.5 text-right">Quantity</th>
                <th className="px-5 py-2.5 text-right">Revenue</th>
                <th className="px-5 py-2.5 text-right">Orders</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.modifierId ?? "x"}-${i}`} className="border-t border-border hover:bg-muted/20">
                  <td className="px-5 py-2.5 font-medium text-foreground">{r.name}</td>
                  <td className="px-5 py-2.5 text-muted-foreground">{r.groupName ?? "—"}</td>
                  <td className="px-5 py-2.5 text-right text-muted-foreground tabular-nums">{r.totalQuantity}</td>
                  <td className="px-5 py-2.5 text-right text-green-600 font-medium tabular-nums">₹{r.totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                  <td className="px-5 py-2.5 text-right text-muted-foreground tabular-nums">{r.orderCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
