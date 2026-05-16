import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  useStaffIncentiveRules, useUpdateStaffIncentiveRule,
  useStaffIncentives, useRecomputeStaffIncentives, useDecideStaffIncentive,
  useApproveAllStaffIncentives, useStaffIncentiveLeaderboard, useRestaurantId,
  staffIncentiveCsvUrl,
} from "@/lib/hooks";
import type {
  StaffIncentiveRule, StaffIncentive, StaffIncentiveLeaderboardRow, StaffIncentiveRuleType,
} from "@/lib/types";
import { Calculator, CheckCircle2, XCircle, Download, RefreshCw, Trophy, Sparkles, Settings2, FileText } from "lucide-react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const RULE_META: Record<StaffIncentiveRuleType, {
  title: string;
  description: string;
  fields: Array<{ key: string; label: string; type: "number"; suffix?: string; placeholder?: string }>;
}> = {
  upsell_commission: {
    title: "Upsell commission",
    description: "Pay a percentage of qualifying sales as commission to the waiter who took the order.",
    fields: [
      { key: "ratePct", label: "Commission %", type: "number", suffix: "%", placeholder: "e.g. 1.5" },
      { key: "minOrderAmount", label: "Minimum order amount", type: "number", suffix: "₹", placeholder: "e.g. 500" },
    ],
  },
  review_bonus: {
    title: "Review bonus",
    description: "Reward staff for positive customer feedback in the period (attributed proportionally to orders served).",
    fields: [
      { key: "perReview", label: "Per qualifying review", type: "number", suffix: "₹", placeholder: "e.g. 50" },
      { key: "minRating", label: "Minimum rating to count", type: "number", suffix: "★", placeholder: "1–5" },
    ],
  },
  attendance_bonus: {
    title: "Attendance bonus",
    description: "Flat monthly bonus for staff with no more than the configured number of absences.",
    fields: [
      { key: "amount", label: "Bonus amount", type: "number", suffix: "₹", placeholder: "e.g. 1000" },
      { key: "maxAbsences", label: "Maximum absences allowed", type: "number", placeholder: "e.g. 0" },
    ],
  },
  sales_target: {
    title: "Sales target",
    description: "Reward waiters who hit a monthly sales target — flat bonus and/or % on the overshoot.",
    fields: [
      { key: "target", label: "Monthly target", type: "number", suffix: "₹", placeholder: "e.g. 100000" },
      { key: "flatBonus", label: "Flat bonus on hit", type: "number", suffix: "₹", placeholder: "e.g. 1500" },
      { key: "ratePct", label: "% on overshoot", type: "number", suffix: "%", placeholder: "e.g. 0.5" },
    ],
  },
  table_turnover: {
    title: "Table turnover",
    description: "Per-order bonus for waiters serving more than the threshold number of orders.",
    fields: [
      { key: "perOrder", label: "Bonus per order", type: "number", suffix: "₹", placeholder: "e.g. 5" },
      { key: "minOrders", label: "Minimum orders to qualify", type: "number", placeholder: "e.g. 50" },
    ],
  },
  low_complaint_bonus: {
    title: "Low complaint bonus",
    description: "Reward waiters whose attributed complaints stay under the threshold for the period.",
    fields: [
      { key: "amount", label: "Bonus amount", type: "number", suffix: "₹", placeholder: "e.g. 500" },
      { key: "maxComplaints", label: "Maximum attributed complaints", type: "number", placeholder: "e.g. 1" },
      { key: "complaintRatingAtMost", label: "Counts as complaint when rating ≤", type: "number", suffix: "★", placeholder: "1–5" },
    ],
  },
};

function fmtMoney(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusPill(status: string) {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    rejected: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  };
  return <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? ""}`}>{status}</span>;
}

function ruleLabel(rt: string): string {
  return RULE_META[rt as StaffIncentiveRuleType]?.title ?? rt;
}

function RuleEditor({ rule, readOnly, onSave }: {
  rule: StaffIncentiveRule;
  readOnly: boolean;
  onSave: (patch: { enabled: boolean; params: Record<string, unknown>; monthlyCap: string | null }) => Promise<void>;
}) {
  const meta = RULE_META[rule.ruleType as StaffIncentiveRuleType];
  const [enabled, setEnabled] = useState(rule.enabled);
  const [params, setParams] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const f of meta.fields) {
      const v = (rule.params as Record<string, unknown>)?.[f.key];
      o[f.key] = v === null || v === undefined ? "" : String(v);
    }
    return o;
  });
  const [cap, setCap] = useState<string>(rule.monthlyCap ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const numParams: Record<string, unknown> = {};
      for (const f of meta.fields) {
        const raw = params[f.key];
        if (raw === undefined || raw === "") continue;
        const n = Number(raw);
        if (Number.isFinite(n)) numParams[f.key] = n;
      }
      await onSave({ enabled, params: numParams, monthlyCap: cap === "" ? null : cap });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div className="flex-1">
          <CardTitle className="text-base">{meta.title}</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">{meta.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs">{enabled ? "Enabled" : "Disabled"}</Label>
          <Switch checked={enabled} disabled={readOnly} onCheckedChange={setEnabled} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {meta.fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{f.label}{f.suffix ? ` (${f.suffix})` : ""}</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={params[f.key] ?? ""}
                onChange={(e) => setParams({ ...params, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                disabled={readOnly}
              />
            </div>
          ))}
          <div className="space-y-1">
            <Label className="text-xs">Monthly cap per staff (₹) — optional</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              placeholder="No cap"
              disabled={readOnly}
            />
          </div>
        </div>
        {!readOnly && (
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving ? "Saving…" : "Save rule"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ApprovalsTab({ rows, canApprove, onDecide, onApproveAll, year, month }: {
  rows: StaffIncentive[];
  canApprove: boolean;
  onDecide: (row: StaffIncentive, decision: "approve" | "reject", approvedAmount?: string, notes?: string) => Promise<void>;
  onApproveAll: () => Promise<void>;
  year: number;
  month: number;
}) {
  const [editRow, setEditRow] = useState<StaffIncentive | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending");

  function openEdit(r: StaffIncentive) {
    setEditRow(r);
    setEditAmount(r.computedAmount);
    setEditNotes("");
  }

  async function saveEdit(decision: "approve" | "reject") {
    if (!editRow) return;
    setSaving(true);
    try {
      await onDecide(editRow, decision, decision === "approve" ? editAmount : undefined, editNotes || undefined);
      setEditRow(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {pending.length} pending · {decided.length} decided · Period {MONTHS[month - 1]} {year}
        </div>
        {canApprove && pending.length > 0 && (
          <Button onClick={onApproveAll} variant="default" size="sm">
            <CheckCircle2 className="h-4 w-4 mr-2" /> Approve all pending
          </Button>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Pending approval</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {pending.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">Nothing pending. Run a recompute or check back later.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left p-3">Staff</th>
                  <th className="text-left p-3">Rule</th>
                  <th className="text-right p-3">Computed</th>
                  <th className="text-left p-3">Why</th>
                  {canApprove && <th className="text-right p-3">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-3 font-medium">{r.userName}</td>
                    <td className="p-3">{ruleLabel(r.ruleType)}</td>
                    <td className="p-3 text-right tabular-nums">{fmtMoney(r.computedAmount)}</td>
                    <td className="p-3 text-xs text-muted-foreground max-w-md">
                      {Object.entries(r.breakdown ?? {}).slice(0, 3).map(([k, v]) => (
                        <div key={k}><span className="font-medium">{k}:</span> {String(v)}</div>
                      ))}
                    </td>
                    {canApprove && (
                      <td className="p-3 text-right space-x-2 whitespace-nowrap">
                        <Button size="sm" variant="outline" onClick={() => openEdit(r)}>Adjust</Button>
                        <Button size="sm" variant="default" onClick={() => onDecide(r, "approve")}>Approve</Button>
                        <Button size="sm" variant="destructive" onClick={() => onDecide(r, "reject")}>Reject</Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Decided</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {decided.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">No decisions yet for this period.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left p-3">Staff</th>
                  <th className="text-left p-3">Rule</th>
                  <th className="text-right p-3">Computed</th>
                  <th className="text-right p-3">Approved</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-3 font-medium">{r.userName}</td>
                    <td className="p-3">{ruleLabel(r.ruleType)}</td>
                    <td className="p-3 text-right tabular-nums">{fmtMoney(r.computedAmount)}</td>
                    <td className="p-3 text-right tabular-nums">{fmtMoney(r.approvedAmount)}</td>
                    <td className="p-3">{statusPill(r.status)}</td>
                    <td className="p-3 text-xs text-muted-foreground">{r.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust incentive</DialogTitle>
          </DialogHeader>
          {editRow && (
            <div className="space-y-3">
              <div className="text-sm">
                <div><span className="text-muted-foreground">Staff:</span> <strong>{editRow.userName}</strong></div>
                <div><span className="text-muted-foreground">Rule:</span> {ruleLabel(editRow.ruleType)}</div>
                <div><span className="text-muted-foreground">Computed:</span> {fmtMoney(editRow.computedAmount)}</div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Approved amount (₹)</Label>
                <Input type="number" min="0" step="any" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes (optional)</Label>
                <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Why is the amount different?" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditRow(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => saveEdit("reject")} disabled={saving}>Reject</Button>
            <Button onClick={() => saveEdit("approve")} disabled={saving}>{saving ? "Saving…" : "Approve"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LeaderboardTab({ rows }: { rows: StaffIncentiveLeaderboardRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-sm text-muted-foreground text-center">
          <Trophy className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          No incentives computed yet for this period.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left p-3">Rank</th>
              <th className="text-left p-3">Staff</th>
              <th className="text-right p-3">Approved</th>
              <th className="text-right p-3">Pending</th>
              <th className="text-right p-3">Total</th>
              <th className="text-left p-3">By rule</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.userId} className="border-t">
                <td className="p-3 font-bold">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                </td>
                <td className="p-3 font-medium">{r.userName}</td>
                <td className="p-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{fmtMoney(r.totalApproved)}</td>
                <td className="p-3 text-right tabular-nums text-amber-600 dark:text-amber-400">{fmtMoney(r.totalPending)}</td>
                <td className="p-3 text-right tabular-nums font-semibold">{fmtMoney(r.totalApproved + r.totalPending)}</td>
                <td className="p-3 text-xs text-muted-foreground">
                  {Object.entries(r.breakdown).map(([k, v]) => (
                    <span key={k} className="mr-3 whitespace-nowrap">{ruleLabel(k)}: {fmtMoney(v)}</span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export default function StaffIncentivesPage() {
  const { toast } = useToast();
  const restaurantId = useRestaurantId();
  const { user } = useAuth();
  const isOwner = user?.role === "owner" || user?.isSuperAdmin;
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data: rules = [] } = useStaffIncentiveRules();
  const updateRule = useUpdateStaffIncentiveRule();
  const { data: incentives = [], isLoading } = useStaffIncentives(year, month);
  const { data: leaderboard = [] } = useStaffIncentiveLeaderboard(year, month);
  const recompute = useRecomputeStaffIncentives();
  const decide = useDecideStaffIncentive();
  const approveAll = useApproveAllStaffIncentives();

  const yearOptions = useMemo(() => {
    const cur = now.getFullYear();
    return [cur, cur - 1, cur - 2];
  }, []);

  async function handleRecompute() {
    try {
      const r = await recompute.mutateAsync({ year, month });
      toast({ title: "Recomputed", description: `${r.count} incentive line${r.count === 1 ? "" : "s"} computed.` });
    } catch (err) {
      toast({ title: "Recompute failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function handleDecide(row: StaffIncentive, decision: "approve" | "reject", approvedAmount?: string, notes?: string) {
    try {
      await decide.mutateAsync({ id: row.id, decision, approvedAmount, notes });
      toast({ title: decision === "approve" ? "Approved" : "Rejected", description: row.userName });
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function handleApproveAll() {
    try {
      const r = await approveAll.mutateAsync({ year, month });
      toast({ title: "All approved", description: `${r.approved} row${r.approved === 1 ? "" : "s"} approved.` });
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function handleSaveRule(ruleType: string, patch: { enabled: boolean; params: Record<string, unknown>; monthlyCap: string | null }) {
    try {
      await updateRule.mutateAsync({ ruleType, ...patch });
      toast({ title: "Rule saved", description: ruleLabel(ruleType) });
    } catch (err) {
      toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  return (
    <Layout>
      <div className="container mx-auto p-4 sm:p-6 space-y-6">
        <PageHeader
          title="Staff Incentives"
          description="Reward rules, approvals, leaderboard, and reports — approved incentives flow into payroll automatically."
          icon={<Sparkles className="h-6 w-6" />}
        />

        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <Label className="text-xs">Period — Month</Label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Year</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {isOwner && (
            <Button onClick={handleRecompute} disabled={recompute.isPending} variant="outline">
              <RefreshCw className={`h-4 w-4 mr-2 ${recompute.isPending ? "animate-spin" : ""}`} />
              Recompute
            </Button>
          )}
          <Button asChild variant="outline">
            <a href={staffIncentiveCsvUrl(restaurantId, year, month)} target="_blank" rel="noreferrer">
              <Download className="h-4 w-4 mr-2" /> CSV report
            </a>
          </Button>
        </div>

        <Tabs defaultValue="approvals">
          <TabsList>
            <TabsTrigger value="rules"><Settings2 className="h-4 w-4 mr-1.5" />Rules</TabsTrigger>
            <TabsTrigger value="approvals"><CheckCircle2 className="h-4 w-4 mr-1.5" />Approvals</TabsTrigger>
            <TabsTrigger value="leaderboard"><Trophy className="h-4 w-4 mr-1.5" />Leaderboard</TabsTrigger>
            <TabsTrigger value="report"><FileText className="h-4 w-4 mr-1.5" />Report</TabsTrigger>
          </TabsList>

          <TabsContent value="rules" className="space-y-3 pt-4">
            {!isOwner && (
              <div className="text-sm text-muted-foreground bg-muted/40 rounded p-3">
                You can view rules but only the owner can edit them.
              </div>
            )}
            <div className="grid gap-3">
              {rules.map((r) => (
                <RuleEditor
                  key={r.ruleType}
                  rule={r}
                  readOnly={!isOwner}
                  onSave={(patch) => handleSaveRule(r.ruleType, patch)}
                />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="approvals" className="pt-4">
            {isLoading ? (
              <div className="text-sm text-muted-foreground p-6 text-center">Loading…</div>
            ) : (
              <ApprovalsTab
                rows={incentives}
                canApprove={!!isOwner}
                onDecide={handleDecide}
                onApproveAll={handleApproveAll}
                year={year}
                month={month}
              />
            )}
          </TabsContent>

          <TabsContent value="leaderboard" className="pt-4">
            <LeaderboardTab rows={leaderboard} />
          </TabsContent>

          <TabsContent value="report" className="pt-4">
            <Card>
              <CardContent className="p-6 space-y-3">
                <div className="flex items-start gap-3">
                  <Calculator className="h-5 w-5 mt-0.5 text-muted-foreground" />
                  <div>
                    <div className="font-medium">Period totals — {MONTHS[month - 1]} {year}</div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {incentives.length} computed line item{incentives.length === 1 ? "" : "s"} ·{" "}
                      Approved {fmtMoney(incentives.filter((i) => i.status === "approved").reduce((a, b) => a + Number(b.approvedAmount ?? b.computedAmount), 0))} ·{" "}
                      Pending {fmtMoney(incentives.filter((i) => i.status === "pending").reduce((a, b) => a + Number(b.computedAmount), 0))} ·{" "}
                      Rejected {fmtMoney(incentives.filter((i) => i.status === "rejected").reduce((a, b) => a + Number(b.computedAmount), 0))}
                    </div>
                  </div>
                </div>
                <Button asChild>
                  <a href={staffIncentiveCsvUrl(restaurantId, year, month)} target="_blank" rel="noreferrer">
                    <Download className="h-4 w-4 mr-2" /> Download CSV
                  </a>
                </Button>
                <div className="text-xs text-muted-foreground">
                  Approved incentives appear automatically as “Incentive — …” bonus lines in any payroll run for this period.
                  Re-running a draft payroll picks up the latest approvals; finalised runs are frozen.
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
