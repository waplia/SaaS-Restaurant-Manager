import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { apiFetch, apiAction } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, BarChart, Bar, Cell,
} from "recharts";
import { format } from "date-fns";
import { Activity, Download, RefreshCcw, TrendingUp, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type FactorKey = string;

interface CurrentResponse {
  live: boolean;
  snapshotDate: string;
  overallScore: number;
  band: string;
  subScores: Record<FactorKey, number | null>;
  weights: Record<FactorKey, number>;
  inputs: Record<FactorKey, Record<string, unknown>>;
  suggestions: Array<{ key: string; title: string; detail: string }>;
  factorLabels: Record<FactorKey, string>;
}

interface HistoryResponse {
  days: number;
  data: Array<{
    id: number;
    snapshotDate: string;
    overallScore: number;
    band: string;
    subScores: Record<FactorKey, number | null>;
  }>;
}

interface OutletsResponse {
  data: Array<{
    restaurantId: number;
    restaurantName: string;
    branchId: number | null;
    branchName: string | null;
    overallScore: number | null;
    band: string | null;
    snapshotDate: string | null;
  }>;
}

const BAND_COLORS: Record<string, string> = {
  excellent: "hsl(142 72% 45%)",
  good: "hsl(170 65% 40%)",
  fair: "hsl(48 95% 53%)",
  poor: "hsl(25 95% 55%)",
  critical: "hsl(0 80% 55%)",
};

function bandLabel(b: string): string {
  return b.charAt(0).toUpperCase() + b.slice(1);
}

function exportCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function HealthScorePage() {
  const qc = useQueryClient();
  const restaurantId = useRestaurantId();
  const [historyDays, setHistoryDays] = useState(90);

  const current = useQuery<CurrentResponse>({
    queryKey: ["health-score", "current", restaurantId],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/health-score`),
    enabled: !!restaurantId,
  });

  const history = useQuery<HistoryResponse>({
    queryKey: ["health-score", "history", restaurantId, historyDays],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/health-score/history?days=${historyDays}`),
    enabled: !!restaurantId,
  });

  const outlets = useQuery<OutletsResponse>({
    queryKey: ["health-score", "outlets", restaurantId],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/health-score/outlets`),
    enabled: !!restaurantId,
  });

  const recalc = useMutation({
    mutationFn: () => apiAction(`/restaurants/${restaurantId}/health-score/recalculate`, "POST"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["health-score"] });
    },
  });

  const data = current.data;
  const factors = useMemo(() => {
    if (!data) return [] as Array<{ key: string; label: string; score: number | null; weight: number }>;
    return Object.keys(data.factorLabels).map(k => ({
      key: k,
      label: data.factorLabels[k],
      score: data.subScores[k],
      weight: data.weights[k] ?? 0,
    }));
  }, [data]);

  const radarData = useMemo(() => factors.map(f => ({ factor: f.label, score: f.score ?? 0 })), [factors]);
  const barData = useMemo(() => factors
    .filter(f => f.score != null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .map(f => ({ name: f.label, score: f.score ?? 0 })), [factors]);

  const trendData = useMemo(() => (history.data?.data ?? [])
    .slice()
    .reverse()
    .map(d => ({
      date: format(new Date(d.snapshotDate), "MMM d"),
      score: Number(d.overallScore),
    })), [history.data]);

  const handleCSV = () => {
    if (!data) return;
    exportCSV(
      `health-score-${restaurantId}-${format(new Date(), "yyyy-MM-dd")}.csv`,
      ["Factor", "Score", "Weight"],
      factors.map(f => [f.label, f.score ?? "—", f.weight]),
    );
  };

  const handleXLSX = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,
      XLSX.utils.json_to_sheet([
        { Metric: "Overall Score", Value: data.overallScore },
        { Metric: "Band", Value: bandLabel(data.band) },
        { Metric: "Snapshot Date", Value: format(new Date(data.snapshotDate), "PPpp") },
      ]),
      "Summary",
    );
    XLSX.utils.book_append_sheet(wb,
      XLSX.utils.json_to_sheet(factors.map(f => ({ Factor: f.label, Score: f.score, Weight: f.weight }))),
      "Factors",
    );
    if (history.data) {
      XLSX.utils.book_append_sheet(wb,
        XLSX.utils.json_to_sheet(history.data.data.map(d => ({
          Date: format(new Date(d.snapshotDate), "yyyy-MM-dd HH:mm"),
          Score: d.overallScore,
          Band: bandLabel(d.band),
        }))),
        "History",
      );
    }
    if (data.suggestions.length) {
      XLSX.utils.book_append_sheet(wb,
        XLSX.utils.json_to_sheet(data.suggestions.map(s => ({ Title: s.title, Detail: s.detail }))),
        "Suggestions",
      );
    }
    XLSX.writeFile(wb, `health-score-${restaurantId}-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  const handlePDF = () => {
    if (!data) return;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Restaurant Health Score Report", 14, 18);
    doc.setFontSize(11);
    doc.text(`Overall: ${data.overallScore.toFixed(1)} / 100  (${bandLabel(data.band)})`, 14, 28);
    doc.text(`Snapshot: ${format(new Date(data.snapshotDate), "PPpp")}`, 14, 34);
    autoTable(doc, {
      startY: 42,
      head: [["Factor", "Score", "Weight"]],
      body: factors.map(f => [f.label, f.score == null ? "—" : f.score.toFixed(1), String(f.weight)]),
    });
    if (data.suggestions.length) {
      autoTable(doc, {
        head: [["Suggestion", "Detail"]],
        body: data.suggestions.map(s => [s.title, s.detail]),
      });
    }
    doc.save(`health-score-${restaurantId}-${format(new Date(), "yyyy-MM-dd")}.pdf`);
  };

  return (
    <Layout>
      <PageHeader
        title="Restaurant Health Score"
        subtitle="A holistic 0–100 score across 12 operational factors, refreshed nightly."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleCSV} disabled={!data}><Download className="w-4 h-4 mr-1.5" />CSV</Button>
            <Button variant="outline" size="sm" onClick={handleXLSX} disabled={!data}><Download className="w-4 h-4 mr-1.5" />Excel</Button>
            <Button variant="outline" size="sm" onClick={handlePDF} disabled={!data}><Download className="w-4 h-4 mr-1.5" />PDF</Button>
            <Button size="sm" onClick={() => recalc.mutate()} disabled={recalc.isPending}>
              <RefreshCcw className={`w-4 h-4 mr-1.5 ${recalc.isPending ? "animate-spin" : ""}`} />
              Recalculate
            </Button>
          </>
        }
      />
      <div className="p-6 space-y-6">
        {current.isLoading && <div className="text-muted-foreground text-sm">Loading…</div>}
        {current.error && <div className="text-destructive text-sm">Failed to load health score.</div>}
        {data && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-1 bg-card border border-border rounded-xl p-6 flex flex-col items-center justify-center text-center">
                <Activity className="w-7 h-7 text-primary mb-2" />
                <div className="text-5xl font-bold tracking-tight" style={{ color: BAND_COLORS[data.band] }}>
                  {data.overallScore.toFixed(1)}
                </div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">out of 100</div>
                <div className="mt-3 text-sm font-medium px-3 py-1 rounded-full"
                  style={{ background: `${BAND_COLORS[data.band]}20`, color: BAND_COLORS[data.band] }}>
                  {bandLabel(data.band)}
                </div>
                <div className="text-[11px] text-muted-foreground mt-3">
                  {data.live ? "Live (no snapshot yet)" : `As of ${format(new Date(data.snapshotDate), "PPp")}`}
                </div>
              </div>

              <div className="lg:col-span-2 bg-card border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold">Score Trend</h3>
                  <select
                    value={historyDays}
                    onChange={e => setHistoryDays(Number(e.target.value))}
                    className="text-xs border border-border rounded px-2 py-1 bg-background"
                  >
                    <option value={30}>Last 30 days</option>
                    <option value={90}>Last 90 days</option>
                    <option value={180}>Last 6 months</option>
                    <option value={365}>Last 1 year</option>
                  </select>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="score" stroke="hsl(20 92% 46%)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
                {trendData.length === 0 && (
                  <div className="text-center text-xs text-muted-foreground py-4">No history yet — first nightly snapshot will appear after 03:00 IST.</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-sm font-semibold mb-3">Factor Radar</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="factor" tick={{ fontSize: 10 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} />
                    <Radar dataKey="score" stroke="hsl(20 92% 46%)" fill="hsl(20 92% 46%)" fillOpacity={0.4} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-sm font-semibold mb-3">Weakest Factors</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={barData} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 100]} />
                    <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="score">
                      {barData.map((d, i) => (
                        <Cell key={i} fill={d.score >= 70 ? BAND_COLORS.good : d.score >= 55 ? BAND_COLORS.fair : d.score >= 40 ? BAND_COLORS.poor : BAND_COLORS.critical} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Factor Breakdown</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-2 text-left">Factor</th>
                    <th className="px-4 py-2 text-right">Score</th>
                    <th className="px-4 py-2 text-right">Weight</th>
                    <th className="px-4 py-2 text-left">Inputs</th>
                  </tr>
                </thead>
                <tbody>
                  {factors.map(f => (
                    <tr key={f.key} className="border-t border-border">
                      <td className="px-4 py-2 font-medium">{f.label}</td>
                      <td className="px-4 py-2 text-right font-semibold">
                        {f.score == null ? <span className="text-muted-foreground">—</span> : f.score.toFixed(1)}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{f.weight}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {(() => {
                          const ins = data.inputs[f.key] as Record<string, unknown> | undefined;
                          if (!ins) return "—";
                          return Object.entries(ins)
                            .filter(([, v]) => v != null)
                            .slice(0, 3)
                            .map(([k, v]) => `${k}: ${typeof v === "number" ? Number(v).toFixed(1) : String(v)}`)
                            .join(" · ") || "—";
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.suggestions.length > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <h3 className="text-sm font-semibold">Suggestions to Improve</h3>
                </div>
                <ul className="divide-y divide-border">
                  {data.suggestions.map(s => (
                    <li key={s.key} className="px-4 py-3">
                      <div className="font-medium text-sm">{s.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{s.detail}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(outlets.data?.data?.length ?? 0) > 1 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <h3 className="text-sm font-semibold">All Outlets</h3>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-2 text-left">Restaurant</th>
                      <th className="px-4 py-2 text-left">Branch</th>
                      <th className="px-4 py-2 text-right">Score</th>
                      <th className="px-4 py-2 text-left">Band</th>
                      <th className="px-4 py-2 text-left">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outlets.data!.data.map((o, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-4 py-2">{o.restaurantName}</td>
                        <td className="px-4 py-2 text-muted-foreground">{o.branchName ?? "—"}</td>
                        <td className="px-4 py-2 text-right font-semibold">
                          {o.overallScore == null ? "—" : o.overallScore.toFixed(1)}
                        </td>
                        <td className="px-4 py-2">
                          {o.band ? (
                            <span className="text-xs px-2 py-0.5 rounded-full"
                              style={{ background: `${BAND_COLORS[o.band]}20`, color: BAND_COLORS[o.band] }}>
                              {bandLabel(o.band)}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {o.snapshotDate ? format(new Date(o.snapshotDate), "PPp") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
