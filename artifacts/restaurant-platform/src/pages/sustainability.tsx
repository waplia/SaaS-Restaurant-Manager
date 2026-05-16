import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { apiFetch, apiAction } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, Cell,
} from "recharts";
import { format } from "date-fns";
import { Leaf, Plus, Trash2, Download, Lightbulb, RefreshCcw, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type FactorKey = "waste" | "packaging" | "donations" | "local_vendors" | "reusable" | "energy" | "water";

interface ScoreResponse {
  monthKey: string;
  overall: number;
  subScores: Record<FactorKey, number | null>;
  weights: Record<FactorKey, number>;
  inputs: Record<string, Record<string, unknown>>;
  tips: Array<{ key: string; title: string; detail: string }>;
  carbonEstimateKg: number;
  factorLabels: Record<FactorKey, string>;
}

interface TrendResponse {
  months: number;
  data: Array<{ monthKey: string; overall: number; subScores: Record<FactorKey, number | null> }>;
  factorLabels: Record<FactorKey, string>;
  weights: Record<FactorKey, number>;
}

interface CategoryConfig {
  key: string;
  path: string;
  label: string;
  fields: Array<{ name: string; label: string; type?: "text" | "number" | "date" | "select"; options?: string[]; required?: boolean }>;
  columns: Array<{ key: string; label: string; format?: (v: unknown) => string }>;
}

const CATEGORIES: CategoryConfig[] = [
  {
    key: "food-waste", path: "food-waste", label: "Food Waste",
    fields: [
      { name: "entryDate", label: "Date", type: "date", required: true },
      { name: "quantity", label: "Quantity", type: "number", required: true },
      { name: "unit", label: "Unit", type: "select", options: ["kg", "g", "L"] },
      { name: "reason", label: "Reason" },
      { name: "notes", label: "Notes" },
    ],
    columns: [
      { key: "entryDate", label: "Date" }, { key: "quantity", label: "Qty" },
      { key: "unit", label: "Unit" }, { key: "reason", label: "Reason" }, { key: "notes", label: "Notes" },
    ],
  },
  {
    key: "packaging", path: "packaging", label: "Packaging",
    fields: [
      { name: "entryDate", label: "Date", type: "date", required: true },
      { name: "type", label: "Type", type: "select", options: ["plastic", "paper", "compostable", "other"], required: true },
      { name: "quantity", label: "Quantity", type: "number", required: true },
      { name: "unit", label: "Unit", type: "select", options: ["units", "kg", "g"] },
      { name: "notes", label: "Notes" },
    ],
    columns: [
      { key: "entryDate", label: "Date" }, { key: "type", label: "Type" },
      { key: "quantity", label: "Qty" }, { key: "unit", label: "Unit" }, { key: "notes", label: "Notes" },
    ],
  },
  {
    key: "donations", path: "donations", label: "Donations",
    fields: [
      { name: "entryDate", label: "Date", type: "date", required: true },
      { name: "recipient", label: "Recipient", required: true },
      { name: "item", label: "Item", required: true },
      { name: "quantity", label: "Quantity", type: "number" },
      { name: "unit", label: "Unit", type: "select", options: ["kg", "meals", "units"] },
      { name: "notes", label: "Notes" },
    ],
    columns: [
      { key: "entryDate", label: "Date" }, { key: "recipient", label: "Recipient" },
      { key: "item", label: "Item" }, { key: "quantity", label: "Qty" }, { key: "unit", label: "Unit" },
    ],
  },
  {
    key: "local-vendors", path: "local-vendors", label: "Local Vendors",
    fields: [
      { name: "entryDate", label: "Date", type: "date", required: true },
      { name: "vendorName", label: "Vendor Name", required: true },
      { name: "isLocal", label: "Local? (1=yes, 0=no)", type: "number" },
      { name: "distanceKm", label: "Distance (km)", type: "number" },
      { name: "spend", label: "Spend (₹)", type: "number" },
      { name: "notes", label: "Notes" },
    ],
    columns: [
      { key: "entryDate", label: "Date" }, { key: "vendorName", label: "Vendor" },
      { key: "isLocal", label: "Local", format: v => v === 1 || v === "1" ? "Yes" : "No" },
      { key: "distanceKm", label: "Dist (km)" }, { key: "spend", label: "Spend (₹)" },
    ],
  },
  {
    key: "reusable-packaging", path: "reusable-packaging", label: "Reusable Packaging",
    fields: [
      { name: "entryDate", label: "Date", type: "date", required: true },
      { name: "item", label: "Item", required: true },
      { name: "inCirculation", label: "In Circulation", type: "number" },
      { name: "returns", label: "Returns", type: "number" },
      { name: "losses", label: "Losses", type: "number" },
      { name: "notes", label: "Notes" },
    ],
    columns: [
      { key: "entryDate", label: "Date" }, { key: "item", label: "Item" },
      { key: "inCirculation", label: "In Circ" }, { key: "returns", label: "Returns" }, { key: "losses", label: "Losses" },
    ],
  },
  {
    key: "energy", path: "energy", label: "Energy Notes",
    fields: [
      { name: "entryDate", label: "Date", type: "date", required: true },
      { name: "kwh", label: "kWh (optional)", type: "number" },
      { name: "note", label: "Note", required: true },
    ],
    columns: [{ key: "entryDate", label: "Date" }, { key: "kwh", label: "kWh" }, { key: "note", label: "Note" }],
  },
  {
    key: "water", path: "water", label: "Water (placeholder)",
    fields: [
      { name: "entryDate", label: "Date", type: "date", required: true },
      { name: "liters", label: "Liters (optional)", type: "number" },
      { name: "note", label: "Note", required: true },
    ],
    columns: [{ key: "entryDate", label: "Date" }, { key: "liters", label: "Liters" }, { key: "note", label: "Note" }],
  },
  {
    key: "carbon", path: "carbon", label: "Carbon (estimate)",
    fields: [
      { name: "entryDate", label: "Date", type: "date", required: true },
      { name: "estimatedKg", label: "Estimated kg CO₂", type: "number" },
      { name: "manualOverrideKg", label: "Manual Override kg", type: "number" },
      { name: "note", label: "Note" },
    ],
    columns: [{ key: "entryDate", label: "Date" }, { key: "estimatedKg", label: "Est kg" }, { key: "manualOverrideKg", label: "Override kg" }, { key: "note", label: "Note" }],
  },
];

const COLORS = ["#22c55e", "#16a34a", "#0ea5e9", "#a855f7", "#f59e0b", "#ef4444", "#06b6d4"];

function bandOf(score: number): { label: string; color: string } {
  if (score >= 85) return { label: "Excellent", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950" };
  if (score >= 70) return { label: "Good", color: "text-green-600 bg-green-50 dark:bg-green-950" };
  if (score >= 55) return { label: "Fair", color: "text-amber-600 bg-amber-50 dark:bg-amber-950" };
  if (score >= 40) return { label: "Poor", color: "text-orange-600 bg-orange-50 dark:bg-orange-950" };
  return { label: "Critical", color: "text-red-600 bg-red-50 dark:bg-red-950" };
}

function exportCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

interface CategoryRow {
  id: number;
  [k: string]: unknown;
}

function CategoryPanel({ cfg, restaurantId, canWrite }: { cfg: CategoryConfig; restaurantId: number; canWrite: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const list = useQuery<CategoryRow[]>({
    queryKey: ["sustainability", cfg.key, restaurantId],
    queryFn: () => apiFetch<CategoryRow[]>(`/restaurants/${restaurantId}/sustainability/${cfg.path}`),
    enabled: !!restaurantId,
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiAction(`/restaurants/${restaurantId}/sustainability/${cfg.path}`, "POST", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sustainability", cfg.key, restaurantId] });
      qc.invalidateQueries({ queryKey: ["sustainability", "score", restaurantId] });
      qc.invalidateQueries({ queryKey: ["sustainability", "trend", restaurantId] });
      setOpen(false); setForm({});
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiAction(`/restaurants/${restaurantId}/sustainability/${cfg.path}/${id}`, "DELETE"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sustainability", cfg.key, restaurantId] });
      qc.invalidateQueries({ queryKey: ["sustainability", "score", restaurantId] });
      qc.invalidateQueries({ queryKey: ["sustainability", "trend", restaurantId] });
    },
  });

  function openDialog() {
    const init: Record<string, string> = {};
    for (const f of cfg.fields) {
      if (f.type === "date") init[f.name] = new Date().toISOString().slice(0, 10);
      else if (f.type === "select" && f.options?.length) init[f.name] = f.options[0];
    }
    setForm(init);
    setOpen(true);
  }

  function submit() {
    const body: Record<string, unknown> = {};
    for (const f of cfg.fields) {
      const v = form[f.name];
      if (v === undefined || v === "") continue;
      body[f.name] = f.type === "number" ? Number(v) : v;
    }
    create.mutate(body);
  }

  const rows = list.data ?? [];

  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div>
          <h3 className="font-semibold text-foreground">{cfg.label}</h3>
          <p className="text-xs text-muted-foreground">{rows.length} entries</p>
        </div>
        {canWrite && (
          <Button size="sm" onClick={openDialog}>
            <Plus className="w-4 h-4 mr-1" /> Add Entry
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No entries yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                {cfg.columns.map(c => <th key={c.key} className="px-3 py-2 text-left font-medium">{c.label}</th>)}
                {canWrite && <th className="px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 25).map(r => (
                <tr key={r.id} className="border-t border-border">
                  {cfg.columns.map(c => (
                    <td key={c.key} className="px-3 py-2">
                      {c.format ? c.format(r[c.key]) : String(r[c.key] ?? "—")}
                    </td>
                  ))}
                  {canWrite && (
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add {cfg.label} entry</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {cfg.fields.map(f => (
              <div key={f.name}>
                <Label>{f.label}{f.required ? " *" : ""}</Label>
                {f.type === "select" ? (
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={form[f.name] ?? ""}
                    onChange={e => setForm({ ...form, [f.name]: e.target.value })}
                  >
                    {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <Input
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                    value={form[f.name] ?? ""}
                    onChange={e => setForm({ ...form, [f.name]: e.target.value })}
                    step={f.type === "number" ? "any" : undefined}
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={create.isPending}>{create.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function SustainabilityPage() {
  const restaurantId = useRestaurantId();
  const { user } = useAuth();
  const canWrite = !!user && (user.isSuperAdmin || ["owner", "manager"].includes(user.role));

  const score = useQuery<ScoreResponse>({
    queryKey: ["sustainability", "score", restaurantId],
    queryFn: () => apiFetch<ScoreResponse>(`/restaurants/${restaurantId}/sustainability/score`),
    enabled: !!restaurantId,
  });

  const trend = useQuery<TrendResponse>({
    queryKey: ["sustainability", "trend", restaurantId],
    queryFn: () => apiFetch<TrendResponse>(`/restaurants/${restaurantId}/sustainability/trend?months=12`),
    enabled: !!restaurantId,
  });

  const [enabledLines, setEnabledLines] = useState<Record<string, boolean>>({ overall: true });

  const data = score.data;
  const factors = useMemo(() => {
    if (!data) return [] as Array<{ key: FactorKey; label: string; score: number | null; weight: number }>;
    return (Object.keys(data.factorLabels) as FactorKey[]).map(k => ({
      key: k,
      label: data.factorLabels[k],
      score: data.subScores[k],
      weight: data.weights[k] ?? 0,
    }));
  }, [data]);

  const barData = useMemo(() => factors.filter(f => f.score != null).map(f => ({
    name: f.label, score: Math.round((f.score ?? 0) * 10) / 10,
  })), [factors]);

  const trendData = useMemo(() => (trend.data?.data ?? []).map(d => {
    const row: Record<string, string | number | null> = { month: d.monthKey, overall: d.overall };
    for (const k of Object.keys(d.subScores) as FactorKey[]) row[k] = d.subScores[k];
    return row;
  }), [trend.data]);

  function downloadCSV() {
    if (!data) return;
    exportCSV(
      `sustainability-${restaurantId}-${data.monthKey}.csv`,
      ["Section", "Field", "Value"],
      [
        ["Score", "Overall", data.overall],
        ["Score", "Month", data.monthKey],
        ["Score", "Carbon estimate (kg)", data.carbonEstimateKg],
        ...factors.map(f => ["Sub-score", f.label, f.score ?? "n/a"]),
        ...data.tips.map(t => ["Tip", t.title, t.detail]),
      ],
    );
  }

  function downloadXLSX() {
    if (!data) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { Metric: "Overall Score", Value: data.overall },
      { Metric: "Band", Value: bandOf(data.overall).label },
      { Metric: "Month", Value: data.monthKey },
      { Metric: "Carbon Estimate (kg CO₂)", Value: data.carbonEstimateKg },
    ]), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      factors.map(f => ({ Factor: f.label, Score: f.score, Weight: f.weight })),
    ), "Sub-scores");
    if (data.tips.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        data.tips.map(t => ({ Title: t.title, Detail: t.detail })),
      ), "Tips");
    }
    if (trend.data) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        trend.data.data.map(d => ({ Month: d.monthKey, Overall: d.overall })),
      ), "Trend");
    }
    XLSX.writeFile(wb, `sustainability-${restaurantId}-${data.monthKey}.xlsx`);
  }

  function downloadPDF() {
    if (!data) return;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Sustainability Report", 14, 18);
    doc.setFontSize(11);
    doc.text(`Month: ${data.monthKey}`, 14, 26);
    doc.text(`Overall: ${data.overall.toFixed(1)} / 100  (${bandOf(data.overall).label})`, 14, 32);
    doc.text(`Carbon estimate: ~${data.carbonEstimateKg.toFixed(1)} kg CO₂ (rough estimate)`, 14, 38);
    autoTable(doc, {
      startY: 44,
      head: [["Factor", "Score", "Weight"]],
      body: factors.map(f => [f.label, f.score == null ? "—" : f.score.toFixed(1), String(f.weight)]),
    });
    if (data.tips.length) {
      autoTable(doc, {
        head: [["Tip", "Detail"]],
        body: data.tips.map(t => [t.title, t.detail]),
      });
    }
    if (trend.data) {
      autoTable(doc, {
        head: [["Month", "Overall"]],
        body: trend.data.data.map(d => [d.monthKey, d.overall.toFixed(1)]),
      });
    }
    doc.save(`sustainability-${restaurantId}-${data.monthKey}.pdf`);
  }

  const band = data ? bandOf(data.overall) : null;

  return (
    <Layout>
      <PageHeader
        title="Sustainability"
        subtitle="Track environmental footprint, score your operation, and see what to improve"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={downloadCSV} disabled={!data}>
              <Download className="w-4 h-4 mr-1" /> CSV
            </Button>
            <Button size="sm" variant="outline" onClick={downloadXLSX} disabled={!data}>
              <Download className="w-4 h-4 mr-1" /> Excel
            </Button>
            <Button size="sm" variant="outline" onClick={downloadPDF} disabled={!data}>
              <Download className="w-4 h-4 mr-1" /> PDF
            </Button>
            <Button size="sm" variant="outline" onClick={() => { score.refetch(); trend.refetch(); }}>
              <RefreshCcw className="w-4 h-4 mr-1" /> Refresh
            </Button>
          </div>
        }
      />
      <div className="p-6 space-y-6">

        {/* Score Header */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="border border-border rounded-lg p-6 bg-card">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Leaf className="w-4 h-4 text-green-600" /> Sustainability Score
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <div className="text-5xl font-bold text-foreground">{data ? data.overall.toFixed(0) : "—"}</div>
                  <div className="text-muted-foreground text-lg">/ 100</div>
                </div>
                {band && (
                  <span className={`inline-block mt-2 px-2 py-0.5 rounded text-xs font-medium ${band.color}`}>{band.label}</span>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
              Weighted average of 7 sub-scores (food waste, packaging, donations, local sourcing, reusable
              packaging, energy & water tracking). Missing categories are skipped from the average.
            </p>
            {data && (
              <div className="mt-3 text-xs text-muted-foreground flex items-start gap-1">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Carbon estimate this month: <strong>~{data.carbonEstimateKg.toFixed(1)} kg CO₂</strong> (rough estimate, not audited).</span>
              </div>
            )}
          </div>

          <div className="lg:col-span-2 border border-border rounded-lg p-4 bg-card">
            <h3 className="font-semibold text-sm mb-3">Sub-score breakdown</h3>
            {barData.length === 0 ? (
              <div className="text-sm text-muted-foreground py-12 text-center">Add entries to see your sub-scores.</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barData} layout="vertical" margin={{ left: 100 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" domain={[0, 100]} />
                  <YAxis type="category" dataKey="name" width={140} fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="score">
                    {barData.map((b, i) => (
                      <Cell key={i} fill={b.score >= 70 ? "#16a34a" : b.score >= 55 ? "#eab308" : b.score >= 40 ? "#f97316" : "#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Tips */}
        <div className="border border-border rounded-lg p-4 bg-card">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-5 h-5 text-amber-500" />
            <h3 className="font-semibold">Improvement Tips</h3>
          </div>
          {data && data.tips.length === 0 ? (
            <p className="text-sm text-muted-foreground">Great work — every category is in good shape this month.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {(data?.tips ?? []).map(t => (
                <div key={t.key} className="border border-border rounded p-3 bg-muted/20">
                  <div className="font-medium text-sm">{t.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">{t.detail}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Trend */}
        <div className="border border-border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">12-month trend</h3>
            <div className="flex flex-wrap gap-1.5">
              {[{ k: "overall", label: "Overall" }, ...factors.map(f => ({ k: f.key, label: f.label }))].map((l, i) => {
                const enabled = l.k === "overall" ? enabledLines.overall !== false : !!enabledLines[l.k];
                return (
                  <button
                    key={l.k}
                    onClick={() => setEnabledLines(p => ({ ...p, [l.k]: !enabled }))}
                    className={`text-xs px-2 py-0.5 rounded border ${enabled ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground"}`}
                    style={enabled && l.k !== "overall" ? { backgroundColor: COLORS[i % COLORS.length], borderColor: COLORS[i % COLORS.length], color: "white" } : undefined}
                  >
                    {l.label}
                  </button>
                );
              })}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" fontSize={12} />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Legend />
              {enabledLines.overall !== false && (
                <Line type="monotone" dataKey="overall" stroke="#16a34a" strokeWidth={2.5} dot={false} />
              )}
              {factors.map((f, i) => enabledLines[f.key] && (
                <Line key={f.key} type="monotone" dataKey={f.key} stroke={COLORS[(i + 1) % COLORS.length]} strokeWidth={1.5} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Entry categories */}
        <div className="space-y-4">
          <h3 className="font-semibold text-lg">Log entries</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {CATEGORIES.map(c => (
              <CategoryPanel key={c.key} cfg={c} restaurantId={restaurantId} canWrite={canWrite} />
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground italic">
          Note: Water usage and the carbon estimate are placeholder fields for future meter integration. The carbon
          number is a rough auto-estimate from logged inputs; it is not a scientifically audited carbon-accounting
          figure.
        </p>
      </div>
    </Layout>
  );
}
