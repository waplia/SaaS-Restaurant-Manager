import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sparkles, Loader2, Coins, AlertTriangle, Trophy, GraduationCap, ShieldAlert,
  IndianRupee, Clock, Download, FileText, Users,
} from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useAiWallet } from "@/lib/aiHooks";
import { useToast } from "@/hooks/use-toast";
import { AiGeneratedBadge } from "@/components/ai/AiGeneratedBadge";
import { CreditsPill } from "@/components/ai/CreditsPill";
import { InsufficientCreditsModal } from "@/components/ai/InsufficientCreditsModal";
import { format, subDays } from "date-fns";

const COST = 5;

interface Scorecard {
  userId: number;
  name: string;
  jobTitle: string | null;
  department: string | null;
  attendanceDays: number;
  scheduledDays: number;
  attendanceRate: number;
  lateCount: number;
  avgLateMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number;
  ordersHandled: number;
  ordersCancelled: number;
  cancellationRate: number;
  avgServiceMinutes: number | null;
  feedbackCount: number;
  feedbackAvgRating: number | null;
  feedbackNegative: number;
  discountCount: number;
  discountTotal: number;
  discountShare: number;
  payrollGross: number;
  payrollNet: number;
  payrollLateDeduction: number;
  payrollOvertimeAmount: number;
}

type CardType = "best_performer" | "training_needs" | "suspicious_activity" | "payroll_anomaly" | "shift_suggestion";
interface InsightCard {
  type: CardType;
  title: string;
  body: string;
  citations: Array<{ userId: number; name: string; metric: string }>;
  severity: "info" | "warn" | "critical";
}

interface InsightsPayload {
  from: string;
  to: string;
  generatedAt: string;
  scorecards: Scorecard[];
  cards: InsightCard[];
  summary: string;
  cached: boolean;
}

const CARD_META: Record<CardType, { label: string; icon: typeof Trophy; cls: string }> = {
  best_performer: { label: "Best Performer", icon: Trophy, cls: "from-emerald-500 to-green-500" },
  training_needs: { label: "Training Needs", icon: GraduationCap, cls: "from-amber-500 to-orange-500" },
  suspicious_activity: { label: "Suspicious Activity", icon: ShieldAlert, cls: "from-rose-500 to-red-500" },
  payroll_anomaly: { label: "Payroll Anomaly", icon: IndianRupee, cls: "from-fuchsia-500 to-pink-500" },
  shift_suggestion: { label: "Shift Suggestion", icon: Clock, cls: "from-violet-500 to-indigo-500" },
};

const SEV_BORDER: Record<string, string> = {
  info: "border-border",
  warn: "border-amber-300 dark:border-amber-800",
  critical: "border-rose-300 dark:border-rose-800",
};

export default function AiStaffInsightsPage() {
  const restaurantId = useRestaurantId();
  const wallet = useAiWallet();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [from, setFrom] = useState<string>(() => format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [to, setTo] = useState<string>(() => format(new Date(), "yyyy-MM-dd"));
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [showInsufficient, setShowInsufficient] = useState(false);

  // Auto-load cached insights on mount / range change.
  const cached = useQuery<{ insights: InsightsPayload | null }>({
    queryKey: ["ai-staff-insights-cached", restaurantId, from, to],
    queryFn: () =>
      apiGet(
        `/restaurants/${restaurantId}/ai-ops/staff-insights/cached?from=${from}&to=${to}`,
      ),
    enabled: !!restaurantId,
  });

  const generate = useMutation({
    mutationFn: () =>
      apiPost<{ insights: InsightsPayload }>(
        `/restaurants/${restaurantId}/ai-ops/staff-insights/generate`,
        { from, to },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-staff-insights-cached", restaurantId, from, to] });
      qc.invalidateQueries({ queryKey: ["ai-wallet"] });
      toast({ title: "Staff insights generated" });
    },
    onError: (e: unknown) => {
      const err = e as { message?: string; code?: string };
      if (err.code === "INSUFFICIENT_CREDITS") {
        setShowInsufficient(true);
        return;
      }
      toast({ title: err.message ?? "Failed to generate", variant: "destructive" });
    },
  });

  const insights: InsightsPayload | null =
    (generate.data?.insights as InsightsPayload | undefined) ?? cached.data?.insights ?? null;

  const balance = wallet.data?.balance ?? 0;
  const planEnabled = wallet.data?.planKhanaAiEnabled ?? wallet.data?.planAiEnabled ?? false;
  const insufficient = !wallet.isLoading && balance < COST;

  const roles = useMemo(() => {
    const set = new Set<string>();
    for (const s of insights?.scorecards ?? []) if (s.jobTitle) set.add(s.jobTitle);
    return Array.from(set).sort();
  }, [insights]);

  const filteredCards = useMemo(() => {
    if (!insights) return [];
    if (roleFilter === "all") return insights.scorecards;
    return insights.scorecards.filter((s) => s.jobTitle === roleFilter);
  }, [insights, roleFilter]);

  // Reset role filter if it no longer matches.
  useEffect(() => {
    if (roleFilter !== "all" && !roles.includes(roleFilter)) setRoleFilter("all");
  }, [roles, roleFilter]);

  function handleGenerate() {
    if (!planEnabled) return;
    if (insufficient) {
      setShowInsufficient(true);
      return;
    }
    generate.mutate();
  }

  function exportCsv() {
    if (!insights) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(filteredCards.map((s) => ({
        Staff: s.name,
        Role: s.jobTitle ?? "",
        "Attendance %": s.attendanceRate,
        "Late count": s.lateCount,
        "Avg late (min)": s.avgLateMinutes,
        "Overtime (min)": s.overtimeMinutes,
        "Orders handled": s.ordersHandled,
        Cancelled: s.ordersCancelled,
        "Cancel %": s.cancellationRate,
        "Avg service (min)": s.avgServiceMinutes ?? "",
        "Discount count": s.discountCount,
        "Discount total (₹)": s.discountTotal,
        "Discount % of orders": s.discountShare,
        "Payroll gross (₹)": s.payrollGross,
        "Payroll net (₹)": s.payrollNet,
        "Late deduction (₹)": s.payrollLateDeduction,
        "Overtime amount (₹)": s.payrollOvertimeAmount,
      }))),
      "Scorecards",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(insights.cards.map((c) => ({
        Type: CARD_META[c.type]?.label ?? c.type,
        Title: c.title,
        Body: c.body,
        Severity: c.severity,
        Citations: c.citations.map((x) => `${x.name} (${x.metric})`).join("; "),
      }))),
      "AI Insights",
    );
    XLSX.writeFile(wb, `staff-insights-${insights.from}-to-${insights.to}.xlsx`);
  }

  function exportPdf() {
    if (!insights) return;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("AI Staff Insights", 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(110);
    doc.text(`${insights.from} → ${insights.to} • Generated ${format(new Date(insights.generatedAt), "PP p")}`, 14, 25);
    if (insights.summary) {
      doc.setTextColor(0);
      doc.setFontSize(10);
      const wrapped = doc.splitTextToSize(insights.summary, 180);
      doc.text(wrapped, 14, 33);
    }
    let cursor = 33 + (insights.summary ? doc.splitTextToSize(insights.summary, 180).length * 5 + 4 : 0);

    for (const c of insights.cards) {
      doc.setFontSize(11);
      doc.setTextColor(0);
      doc.text(`${(CARD_META[c.type]?.label ?? c.type).toUpperCase()} — ${c.title}`, 14, cursor);
      cursor += 5;
      doc.setFontSize(9);
      doc.setTextColor(60);
      const body = doc.splitTextToSize(c.body, 180);
      doc.text(body, 14, cursor);
      cursor += body.length * 4 + 1;
      if (c.citations.length) {
        const cit = `Cited: ${c.citations.map((x) => `${x.name} — ${x.metric}`).join(" • ")}`;
        const wrapped = doc.splitTextToSize(cit, 180);
        doc.setTextColor(110);
        doc.text(wrapped, 14, cursor);
        cursor += wrapped.length * 4 + 4;
      } else {
        cursor += 3;
      }
      if (cursor > 260) { doc.addPage(); cursor = 20; }
    }

    autoTable(doc, {
      startY: cursor + 4,
      head: [["Staff", "Role", "Attend %", "Late", "OT min", "Orders", "Cancel %", "Disc ₹", "Net ₹"]],
      body: filteredCards.map((s) => [
        s.name,
        s.jobTitle ?? "",
        `${s.attendanceRate}%`,
        s.lateCount,
        s.overtimeMinutes,
        s.ordersHandled,
        `${s.cancellationRate}%`,
        s.discountTotal.toLocaleString(),
        s.payrollNet.toLocaleString(),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [124, 58, 237] },
    });

    doc.save(`staff-insights-${insights.from}-to-${insights.to}.pdf`);
  }

  return (
    <Layout>
      <PageHeader
        title="AI Staff Insights"
        subtitle="Per-staff scorecards and AI-spotted training, payroll and shift opportunities."
        actions={
          <div className="flex gap-2 items-center">
            <Badge variant="secondary" className="gap-1"><Coins className="w-3 h-3" />{balance} cr</Badge>
            {insights && (
              <>
                <Button size="sm" variant="outline" onClick={exportCsv} className="gap-1.5">
                  <Download className="w-3.5 h-3.5" /> CSV
                </Button>
                <Button size="sm" variant="outline" onClick={exportPdf} className="gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> PDF
                </Button>
              </>
            )}
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={!planEnabled || generate.isPending}
              className="gap-1.5"
            >
              {generate.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Sparkles className="w-3.5 h-3.5" />}
              Generate ({COST} cr)
            </Button>
          </div>
        }
      />

      <div className="p-6 space-y-4">
        {!planEnabled && !wallet.isLoading && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Khana AI is not in your plan</p>
                <p className="text-sm text-muted-foreground">Upgrade to use AI staff insights.</p>
              </div>
              <Link href="/settings/subscription"><Button size="sm">Upgrade</Button></Link>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input
                type="date"
                value={to}
                min={from}
                max={format(new Date(), "yyyy-MM-dd")}
                onChange={(e) => setTo(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Role</label>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {roles.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto"><CreditsPill cost={COST} available={balance} /></div>
          </CardContent>
        </Card>

        {cached.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32" />)}
          </div>
        ) : !insights ? (
          <Card>
            <CardContent className="p-10 text-center space-y-3">
              <Users className="w-10 h-10 text-muted-foreground mx-auto" />
              <p className="font-semibold">No insights yet for this range</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Click <em>Generate</em> to analyse your team's attendance, service, feedback,
                discounts and payroll for {from} → {to}.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <AiGeneratedBadge />
              <span>
                {insights.from} → {insights.to} • {insights.scorecards.length} staff •{" "}
                Generated {format(new Date(insights.generatedAt), "PP p")}
                {insights.cached && " • from cache"}
              </span>
            </div>
            {insights.summary && (
              <Card>
                <CardContent className="p-4 text-sm italic text-muted-foreground">
                  {insights.summary}
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {insights.cards.map((c) => {
                const meta = CARD_META[c.type] ?? CARD_META.best_performer;
                const Icon = meta.icon;
                return (
                  <Card key={c.type} className={SEV_BORDER[c.severity] ?? "border-border"}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start gap-2">
                        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${meta.cls} flex items-center justify-center text-white shrink-0`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{meta.label}</p>
                          <CardTitle className="text-sm leading-tight">{c.title || "—"}</CardTitle>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-sm text-foreground/80">{c.body}</p>
                      {c.citations.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {c.citations.map((cit, i) => (
                            <span
                              key={i}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/40"
                              title={cit.metric}
                            >
                              {cit.name} <span className="text-muted-foreground">· {cit.metric}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base">Per-staff scorecard ({filteredCards.length})</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-medium">Staff</th>
                        <th className="px-3 py-2 font-medium">Role</th>
                        <th className="px-3 py-2 font-medium text-right">Attend %</th>
                        <th className="px-3 py-2 font-medium text-right">Late</th>
                        <th className="px-3 py-2 font-medium text-right">OT min</th>
                        <th className="px-3 py-2 font-medium text-right">Orders</th>
                        <th className="px-3 py-2 font-medium text-right">Cancel %</th>
                        <th className="px-3 py-2 font-medium text-right">Avg svc</th>
                        <th className="px-3 py-2 font-medium text-right">Disc ₹</th>
                        <th className="px-3 py-2 font-medium text-right">Net pay ₹</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCards.length === 0 ? (
                        <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">No staff match this filter.</td></tr>
                      ) : filteredCards.map((s) => (
                        <tr key={s.userId} className="border-t border-border">
                          <td className="px-3 py-2 font-medium">{s.name}</td>
                          <td className="px-3 py-2 text-muted-foreground">{s.jobTitle ?? "—"}</td>
                          <td className="px-3 py-2 text-right">{s.attendanceRate}%</td>
                          <td className="px-3 py-2 text-right">
                            {s.lateCount}
                            {s.lateCount > 0 && <span className="text-muted-foreground"> ({s.avgLateMinutes}m)</span>}
                          </td>
                          <td className="px-3 py-2 text-right">{s.overtimeMinutes}</td>
                          <td className="px-3 py-2 text-right">
                            {s.ordersHandled}
                            {s.ordersCancelled > 0 && <span className="text-muted-foreground"> / {s.ordersCancelled}</span>}
                          </td>
                          <td className={`px-3 py-2 text-right ${s.cancellationRate > 10 ? "text-rose-600 font-semibold" : ""}`}>
                            {s.cancellationRate}%
                          </td>
                          <td className="px-3 py-2 text-right">{s.avgServiceMinutes != null ? `${s.avgServiceMinutes}m` : "—"}</td>
                          <td className="px-3 py-2 text-right">
                            {s.discountTotal.toLocaleString()}
                            {s.discountCount > 0 && <span className="text-muted-foreground"> ({s.discountCount})</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">{s.payrollNet.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <InsufficientCreditsModal
        open={showInsufficient}
        onClose={() => setShowInsufficient(false)}
        required={COST}
        available={balance}
        feature="AI Staff Insights"
      />
    </Layout>
  );
}
