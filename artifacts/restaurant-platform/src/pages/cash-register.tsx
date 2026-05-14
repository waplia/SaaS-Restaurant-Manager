import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Banknote, Lock, Unlock, ArrowDownToLine, ArrowUpFromLine, FileText,
  AlertTriangle, CheckCircle2, EyeOff, X, Plus, Minus, Loader2, History, Printer,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  useCurrentCashRegister, useCashRegisterSessions, useCashRegisterSession,
  useOpenCashRegister, useCloseCashRegister, useRecordCashMovement, useCashRegisterReport,
} from "@/lib/hooks";
import { INR_DENOMINATIONS } from "@/lib/types";
import type { CashMovement, CashRegisterReport } from "@/lib/types";
import { cn } from "@/lib/utils";

const movementLabels: Record<CashMovement["type"], string> = {
  sale: "Cash sale",
  refund: "Refund",
  cash_in: "Cash in (paid in)",
  cash_out: "Cash out (paid out)",
  drop: "Cash drop (to safe)",
  payout: "Payout / expense",
};

const movementColors: Record<CashMovement["type"], string> = {
  sale: "text-green-600 dark:text-green-400",
  refund: "text-amber-600 dark:text-amber-400",
  cash_in: "text-blue-600 dark:text-blue-400",
  cash_out: "text-rose-600 dark:text-rose-400",
  drop: "text-purple-600 dark:text-purple-400",
  payout: "text-orange-600 dark:text-orange-400",
};

function fmt(n: number | string): string {
  const v = Number(n);
  return isFinite(v) ? `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

function DenomGrid({ counts, onChange, disabled }: {
  counts: Record<number, number>;
  onChange: (d: number, v: number) => void;
  disabled?: boolean;
}) {
  const total = INR_DENOMINATIONS.reduce((s, d) => s + d * (counts[d] ?? 0), 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {INR_DENOMINATIONS.map(d => {
          const count = counts[d] ?? 0;
          return (
            <div key={d} className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg bg-card">
              <div className="w-12 flex-shrink-0 text-sm font-bold text-foreground">₹{d}</div>
              <div className="flex items-center gap-1 flex-1 justify-end">
                <button
                  type="button"
                  disabled={disabled || count <= 0}
                  onClick={() => onChange(d, Math.max(0, count - 1))}
                  className="w-7 h-7 rounded-md bg-secondary hover:bg-red-100 hover:text-red-600 disabled:opacity-40 flex items-center justify-center transition-colors"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <Input
                  type="number"
                  min="0"
                  disabled={disabled}
                  value={count}
                  onChange={e => onChange(d, Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  className="w-14 h-7 text-center text-sm px-1"
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(d, count + 1)}
                  className="w-7 h-7 rounded-md bg-secondary hover:bg-primary/10 hover:text-primary disabled:opacity-40 flex items-center justify-center transition-colors"
                >
                  <Plus className="w-3 h-3" />
                </button>
                <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                  {count > 0 ? `=${fmt(d * count)}` : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between px-3 py-2.5 bg-primary/5 border border-primary/20 rounded-lg">
        <span className="text-sm font-medium text-foreground">Counted total</span>
        <span className="text-lg font-bold text-primary">{fmt(total)}</span>
      </div>
    </div>
  );
}

function OpenRegisterModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const openMut = useOpenCashRegister();
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [notes, setNotes] = useState("");

  const total = INR_DENOMINATIONS.reduce((s, d) => s + d * (counts[d] ?? 0), 0);

  const handleSubmit = async () => {
    const denoms = INR_DENOMINATIONS
      .map(d => ({ denomination: d, count: counts[d] ?? 0 }))
      .filter(d => d.count > 0);
    try {
      await openMut.mutateAsync({ denominations: denoms, notes: notes || undefined });
      toast({ title: "Cash register opened", description: `Opening float: ${fmt(total)}` });
      onClose();
    } catch (e) {
      toast({ title: "Failed to open register", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card">
          <div className="flex items-center gap-2">
            <Unlock className="w-5 h-5 text-primary" />
            <h2 className="font-semibold text-foreground">Open Cash Register</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <Label className="text-sm">Opening float — count cash in the drawer</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Enter the count of each denomination. The total becomes your opening float.</p>
          </div>
          <DenomGrid counts={counts} onChange={(d, v) => setCounts(c => ({ ...c, [d]: v }))} />
          <div>
            <Label className="text-sm">Notes (optional)</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes about the opening count" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border sticky bottom-0 bg-card">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={openMut.isPending}>
            {openMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Unlock className="w-4 h-4 mr-2" />}
            Open Register
          </Button>
        </div>
      </div>
    </div>
  );
}

function CloseRegisterModal({ sessionId, expectedCash, onClose }: {
  sessionId: number;
  expectedCash: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const closeMut = useCloseCashRegister();
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [isBlind, setIsBlind] = useState(false);
  const [closeNotes, setCloseNotes] = useState("");

  const total = INR_DENOMINATIONS.reduce((s, d) => s + d * (counts[d] ?? 0), 0);
  const overShort = total - expectedCash;

  const handleSubmit = async () => {
    const denoms = INR_DENOMINATIONS
      .map(d => ({ denomination: d, count: counts[d] ?? 0 }))
      .filter(d => d.count > 0);
    try {
      const res = await closeMut.mutateAsync({ sessionId, denominations: denoms, isBlindClose: isBlind, closeNotes: closeNotes || undefined }) as { totals: { overShort: number } };
      const os = Number(res.totals?.overShort ?? 0);
      toast({
        title: "Cash register closed",
        description: Math.abs(os) < 0.01 ? "Drawer balanced perfectly." : os > 0 ? `Over by ${fmt(os)}` : `Short by ${fmt(Math.abs(os))}`,
      });
      onClose();
    } catch (e) {
      toast({ title: "Failed to close register", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card">
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-primary" />
            <h2 className="font-semibold text-foreground">Close Cash Register</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3 p-3 bg-secondary/40 border border-border rounded-lg">
            <input
              id="blind-close"
              type="checkbox"
              checked={isBlind}
              onChange={e => setIsBlind(e.target.checked)}
              className="w-4 h-4 rounded border-border"
            />
            <label htmlFor="blind-close" className="flex-1 cursor-pointer">
              <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <EyeOff className="w-3.5 h-3.5" /> Blind close
              </span>
              <span className="text-xs text-muted-foreground block">Hides expected cash and over/short until after submission, to prevent staff tampering.</span>
            </label>
          </div>
          <div>
            <Label className="text-sm">Closing count — count cash actually in the drawer</Label>
          </div>
          <DenomGrid counts={counts} onChange={(d, v) => setCounts(c => ({ ...c, [d]: v }))} />
          {!isBlind && (
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="p-3 bg-secondary/40 rounded-lg">
                <div className="text-xs text-muted-foreground">Expected</div>
                <div className="font-semibold text-foreground">{fmt(expectedCash)}</div>
              </div>
              <div className="p-3 bg-secondary/40 rounded-lg">
                <div className="text-xs text-muted-foreground">Counted</div>
                <div className="font-semibold text-foreground">{fmt(total)}</div>
              </div>
              <div className={cn(
                "p-3 rounded-lg",
                Math.abs(overShort) < 0.01 ? "bg-green-50 dark:bg-green-950/30" : overShort > 0 ? "bg-blue-50 dark:bg-blue-950/30" : "bg-rose-50 dark:bg-rose-950/30"
              )}>
                <div className="text-xs text-muted-foreground">{Math.abs(overShort) < 0.01 ? "Balanced" : overShort > 0 ? "Over" : "Short"}</div>
                <div className={cn(
                  "font-semibold",
                  Math.abs(overShort) < 0.01 ? "text-green-700 dark:text-green-400" : overShort > 0 ? "text-blue-700 dark:text-blue-400" : "text-rose-700 dark:text-rose-400"
                )}>{fmt(Math.abs(overShort))}</div>
              </div>
            </div>
          )}
          <div>
            <Label className="text-sm">Close notes (optional)</Label>
            <Input value={closeNotes} onChange={e => setCloseNotes(e.target.value)} placeholder="Explain any discrepancy" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border sticky bottom-0 bg-card">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={closeMut.isPending}>
            {closeMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Lock className="w-4 h-4 mr-2" />}
            Close Register
          </Button>
        </div>
      </div>
    </div>
  );
}

function MovementModal({ sessionId, onClose }: { sessionId: number; onClose: () => void }) {
  const { toast } = useToast();
  const recordMut = useRecordCashMovement();
  const [type, setType] = useState<"cash_in" | "cash_out" | "drop" | "payout">("cash_in");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const handleSubmit = async () => {
    const amt = Number(amount);
    if (!isFinite(amt) || amt <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    try {
      await recordMut.mutateAsync({ sessionId, type, amount: amt, reason: reason || undefined });
      toast({ title: "Movement recorded", description: `${movementLabels[type]} — ${fmt(amt)}` });
      onClose();
    } catch (e) {
      toast({ title: "Failed to record", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Record Cash Movement</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <Label className="text-sm">Type</Label>
            <div className="grid grid-cols-2 gap-2 mt-1.5">
              {([
                { v: "cash_in", l: "Cash In", icon: ArrowDownToLine },
                { v: "cash_out", l: "Cash Out", icon: ArrowUpFromLine },
                { v: "drop", l: "Drop to Safe", icon: ArrowUpFromLine },
                { v: "payout", l: "Payout/Expense", icon: ArrowUpFromLine },
              ] as const).map(({ v, l, icon: Icon }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setType(v)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all duration-150",
                    type === v
                      ? "border-primary bg-primary/10 text-primary shadow-sm"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:bg-accent/40"
                  )}
                >
                  <Icon className="w-4 h-4" />{l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-sm">Amount (₹)</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <Label className="text-sm">Reason</Label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Tip received, supplier payout, change for ATM…" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={recordMut.isPending}>
            {recordMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Record
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReportView({ report }: { report: CashRegisterReport }) {
  const totals = report.totals;
  const overShort = totals.overShort ?? 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3 bg-card border border-border rounded-lg">
          <div className="text-xs text-muted-foreground">Opening Float</div>
          <div className="text-lg font-bold text-foreground">{fmt(totals.openingFloat)}</div>
        </div>
        <div className="p-3 bg-card border border-border rounded-lg">
          <div className="text-xs text-muted-foreground">Cash In (sales + paid-in)</div>
          <div className="text-lg font-bold text-green-600 dark:text-green-400">+{fmt(totals.totalCashIn)}</div>
        </div>
        <div className="p-3 bg-card border border-border rounded-lg">
          <div className="text-xs text-muted-foreground">Cash Out (refunds + drops + payouts)</div>
          <div className="text-lg font-bold text-rose-600 dark:text-rose-400">-{fmt(totals.totalCashOut)}</div>
        </div>
        <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <div className="text-xs text-muted-foreground">Expected Cash</div>
          <div className="text-lg font-bold text-primary">{fmt(totals.expectedCash)}</div>
        </div>
      </div>

      {report.kind === "Z" && totals.actualCash !== undefined && (
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 bg-card border border-border rounded-lg">
            <div className="text-xs text-muted-foreground">Counted Cash</div>
            <div className="text-lg font-bold text-foreground">{fmt(totals.actualCash)}</div>
          </div>
          <div className={cn(
            "p-3 border rounded-lg col-span-2",
            Math.abs(overShort) < 0.01 ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800" :
            overShort > 0 ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800" :
            "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800"
          )}>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              {Math.abs(overShort) < 0.01 ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
              {Math.abs(overShort) < 0.01 ? "Drawer balanced" : overShort > 0 ? "Over (more in drawer than expected)" : "Short (less in drawer than expected)"}
            </div>
            <div className={cn(
              "text-lg font-bold",
              Math.abs(overShort) < 0.01 ? "text-green-700 dark:text-green-400" :
              overShort > 0 ? "text-blue-700 dark:text-blue-400" :
              "text-rose-700 dark:text-rose-400"
            )}>{overShort >= 0 ? "+" : "-"}{fmt(Math.abs(overShort))}</div>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="font-semibold text-foreground mb-3 text-sm">Sales by Tender (during session)</h3>
        {Object.keys(report.tenderSummary).length === 0 ? (
          <p className="text-sm text-muted-foreground">No sales recorded yet.</p>
        ) : (
          <div className="space-y-1.5">
            {Object.entries(report.tenderSummary).map(([method, t]) => (
              <div key={method} className="flex items-center justify-between text-sm">
                <span className="capitalize text-foreground">{method}</span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{t.count} txn</span>
                  <span className="text-green-600 dark:text-green-400 font-medium tabular-nums w-24 text-right">+{fmt(t.in)}</span>
                  {t.out > 0 && <span className="text-rose-600 dark:text-rose-400 tabular-nums w-24 text-right">-{fmt(t.out)}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-border mt-3 pt-3 flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">{report.orderCount} orders · gross revenue</span>
          <span className="font-bold text-foreground">{fmt(report.grossRevenue)}</span>
        </div>
      </div>
    </div>
  );
}

function MovementsList({ movements }: { movements: CashMovement[] }) {
  if (movements.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No movements yet.</p>;
  }
  return (
    <div className="divide-y divide-border">
      {movements.map(m => {
        const isIn = m.type === "sale" || m.type === "cash_in";
        return (
          <div key={m.id} className="py-2.5 flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={cn("font-medium", movementColors[m.type])}>{movementLabels[m.type]}</span>
                {m.referenceType === "order" && m.referenceId && (
                  <Badge className="text-[10px] py-0 px-1.5">Order #{m.referenceId}</Badge>
                )}
              </div>
              {m.reason && <p className="text-xs text-muted-foreground mt-0.5">{m.reason}</p>}
              <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                {format(new Date(m.createdAt), "MMM d, HH:mm")} {m.createdByName ? `· ${m.createdByName}` : ""}
              </p>
            </div>
            <div className={cn("font-bold tabular-nums flex-shrink-0", isIn ? "text-green-600 dark:text-green-400" : "text-rose-600 dark:text-rose-400")}>
              {isIn ? "+" : "-"}{fmt(m.amount)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function CashRegisterPage() {
  const { data: current, isLoading } = useCurrentCashRegister();
  const { data: history } = useCashRegisterSessions({ pageSize: 25 });
  const [showOpen, setShowOpen] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [showMovement, setShowMovement] = useState(false);
  const [historyDetailId, setHistoryDetailId] = useState<number | null>(null);
  const [reportKind, setReportKind] = useState<"x" | "z">("x");

  const session = current?.session ?? null;
  const totals = current?.totals ?? null;

  const { data: detail } = useCashRegisterSession(historyDetailId);
  const reportSessionId = session?.id ?? historyDetailId;
  const effectiveReportKind: "x" | "z" = useMemo(() => {
    if (historyDetailId && detail?.session.status === "closed") return "z";
    return reportKind;
  }, [historyDetailId, detail, reportKind]);
  const { data: report } = useCashRegisterReport(reportSessionId, effectiveReportKind);

  const overShortAlert = useMemo(() => {
    if (!session || !totals) return null;
    if (Math.abs(totals.expectedCash) > 50_000) {
      return { kind: "warn" as const, msg: "Expected cash is high — consider a cash drop to the safe." };
    }
    return null;
  }, [session, totals]);

  return (
    <div>
      <PageHeader
        title="Cash Register"
        subtitle={session ? `Open since ${format(new Date(session.openedAt), "MMM d, HH:mm")} · ${session.openedByName ?? "—"}` : "No register currently open"}
        actions={
          <div className="flex items-center gap-2">
            {session ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setShowMovement(true)}>
                  <Banknote className="w-4 h-4 mr-1.5" /> Record Movement
                </Button>
                <Button size="sm" onClick={() => setShowClose(true)}>
                  <Lock className="w-4 h-4 mr-1.5" /> Close Register
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setShowOpen(true)}>
                <Unlock className="w-4 h-4 mr-1.5" /> Open Register
              </Button>
            )}
          </div>
        }
      />

      <div className="p-6 space-y-6 max-w-7xl">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : !session ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed border-border rounded-xl bg-card">
            <Banknote className="w-12 h-12 text-muted-foreground/40 mb-3" />
            <h3 className="font-semibold text-foreground">No cash register is open</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">Open a register before accepting cash payments. Cash payments are blocked at POS until a register is open.</p>
            <Button className="mt-4" onClick={() => setShowOpen(true)}><Unlock className="w-4 h-4 mr-1.5" /> Open Register</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {overShortAlert && (
                <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-800 dark:text-amber-200">{overShortAlert.msg}</div>
                </div>
              )}
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold text-foreground flex items-center gap-2"><FileText className="w-4 h-4 text-primary" /> {report?.kind === "Z" ? "Z Report (Final)" : "X Report (Mid-shift snapshot)"}</h2>
                  {!historyDetailId && (
                    <div className="flex items-center gap-1 bg-secondary rounded-lg p-0.5">
                      <button
                        onClick={() => setReportKind("x")}
                        className={cn("px-2.5 py-1 text-xs font-medium rounded-md transition-all", reportKind === "x" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground")}
                      >X Report</button>
                      <button
                        onClick={() => setReportKind("z")}
                        disabled={session?.status === "open"}
                        title={session?.status === "open" ? "Z report available after closing the register" : ""}
                        className={cn("px-2.5 py-1 text-xs font-medium rounded-md transition-all", reportKind === "z" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground disabled:opacity-40")}
                      >Z Report</button>
                    </div>
                  )}
                </div>
                {report ? <ReportView report={report} /> : <p className="text-sm text-muted-foreground">Loading report…</p>}
                <div className="mt-4 pt-4 border-t border-border flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => window.print()}>
                    <Printer className="w-3.5 h-3.5 mr-1.5" /> Print
                  </Button>
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-5">
                <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2"><History className="w-4 h-4 text-primary" /> Movements (this session)</h2>
                <MovementsList movements={detail?.movements ?? []} />
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="font-semibold text-foreground mb-3 text-sm">Session Summary</h3>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Opening float</dt>
                    <dd className="font-medium tabular-nums">{fmt(session.openingFloat)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Cash sales</dt>
                    <dd className="font-medium text-green-600 dark:text-green-400 tabular-nums">+{fmt(totals?.cashSales ?? 0)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Other paid-in</dt>
                    <dd className="font-medium text-green-600 dark:text-green-400 tabular-nums">+{fmt(totals?.cashIn ?? 0)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Refunds</dt>
                    <dd className="font-medium text-rose-600 dark:text-rose-400 tabular-nums">-{fmt(totals?.refunds ?? 0)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Drops / payouts</dt>
                    <dd className="font-medium text-rose-600 dark:text-rose-400 tabular-nums">-{fmt((totals?.drops ?? 0) + (totals?.payouts ?? 0) + (totals?.cashOut ?? 0))}</dd>
                  </div>
                  <div className="border-t border-border pt-2 flex justify-between">
                    <dt className="text-foreground font-medium">Expected in drawer</dt>
                    <dd className="font-bold text-primary tabular-nums">{fmt(totals?.expectedCash ?? 0)}</dd>
                  </div>
                </dl>
              </div>
              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="font-semibold text-foreground mb-3 text-sm">Recent Sessions</h3>
                <div className="space-y-1.5">
                  {(history?.data ?? []).map(s => (
                    <button
                      key={s.id}
                      onClick={() => setHistoryDetailId(s.id === historyDetailId ? null : s.id)}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg border transition-all",
                        historyDetailId === s.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/30 hover:bg-accent/30"
                      )}
                    >
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-foreground">#{s.id}</span>
                        <Badge className={cn("text-[10px] py-0 px-2", s.status === "open" ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" : "bg-secondary text-muted-foreground")}>
                          {s.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {format(new Date(s.openedAt), "MMM d, HH:mm")}
                        {s.closedAt && ` → ${format(new Date(s.closedAt), "HH:mm")}`}
                      </div>
                      {s.overShort !== null && Math.abs(Number(s.overShort)) > 0.01 && (
                        <div className={cn("text-xs mt-0.5", Number(s.overShort) > 0 ? "text-blue-600 dark:text-blue-400" : "text-rose-600 dark:text-rose-400")}>
                          {Number(s.overShort) > 0 ? "Over" : "Short"} {fmt(Math.abs(Number(s.overShort)))}
                        </div>
                      )}
                    </button>
                  ))}
                  {(history?.data ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground py-2">No sessions yet.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {showOpen && <OpenRegisterModal onClose={() => setShowOpen(false)} />}
      {showClose && session && totals && (
        <CloseRegisterModal sessionId={session.id} expectedCash={totals.expectedCash} onClose={() => setShowClose(false)} />
      )}
      {showMovement && session && (
        <MovementModal sessionId={session.id} onClose={() => setShowMovement(false)} />
      )}
    </div>
  );
}
