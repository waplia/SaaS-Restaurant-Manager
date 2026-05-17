import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  usePayrollRuns, usePayrollRun, useCreatePayrollRun, usePatchPayrollItem,
  useFinalizePayrollRun, useRecordPayrollPayment, payrollSlipUrl, useRestaurantId,
} from "@/lib/hooks";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { Link } from "wouter";
import type { PayrollItemRow, PayrollItemOverrideInput } from "@/lib/types";
import { Calculator, CheckCircle2, FileText, Wallet, RefreshCw, Lock, AlertTriangle, Edit3, ShieldAlert } from "lucide-react";

interface PayrollHrBreach {
  kind: string;
  severity: "warning" | "violation";
  userName: string | null;
  detail: string;
}
function HrBreachBanner() {
  const restaurantId = useRestaurantId();
  const { data } = useQuery<{ breaches: PayrollHrBreach[] }>({
    queryKey: ["payroll-hr-breaches", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/hr-compliance/breaches?days=45`),
    retry: false,
  });
  const breaches = data?.breaches ?? [];
  if (breaches.length === 0) return null;
  const violations = breaches.filter(b => b.severity === "violation");
  const warnings = breaches.length - violations.length;
  return (
    <div
      data-testid="payroll-hr-breach-banner"
      className="border rounded-lg p-3 flex items-start gap-3 bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-100"
    >
      <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="flex-1 text-sm">
        <div className="font-medium">
          HR policy breaches in the last 45 days:&nbsp;
          {violations.length > 0 && <span className="text-red-700 dark:text-red-300">{violations.length} violation{violations.length === 1 ? "" : "s"}</span>}
          {violations.length > 0 && warnings > 0 && ", "}
          {warnings > 0 && <span>{warnings} warning{warnings === 1 ? "" : "s"}</span>}
        </div>
        <div className="text-xs opacity-80 mt-0.5">
          Review before finalizing payroll — wage floor, max-shift and overtime rules surface here from your HR policies.
        </div>
      </div>
      <Link href="/hr-compliance">
        <Button size="sm" variant="outline" className="bg-white dark:bg-transparent">Review</Button>
      </Link>
    </div>
  );
}

function fmtMoney(v: string | number) {
  return `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function statusBadge(s: PayrollItemRow["paymentStatus"]) {
  const map = {
    pending: { label: "Pending", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
    partially_paid: { label: "Partial", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" },
    paid: { label: "Paid", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  } as const;
  const c = map[s];
  return <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${c.cls}`}>{c.label}</span>;
}

export default function PayrollPage() {
  const { toast } = useToast();
  const restaurantId = useRestaurantId();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [editItem, setEditItem] = useState<PayrollItemRow | null>(null);
  const [paymentItem, setPaymentItem] = useState<PayrollItemRow | null>(null);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [confirmRePreview, setConfirmRePreview] = useState(false);

  const { data: runs = [], isLoading: runsLoading } = usePayrollRuns();
  const currentRun = useMemo(
    () => runs.find(r => r.periodYear === year && r.periodMonth === month) ?? null,
    [runs, year, month],
  );
  const runIdToFetch = selectedRunId ?? currentRun?.id ?? null;
  const { data: runData } = usePayrollRun(runIdToFetch);

  const createRun = useCreatePayrollRun();
  const patchItem = usePatchPayrollItem();
  const finalizeRun = useFinalizePayrollRun();
  const recordPayment = useRecordPayrollPayment();

  const handlePreview = async (force = false) => {
    if (currentRun?.status === "draft" && !force) {
      setConfirmRePreview(true);
      return;
    }
    if (currentRun?.status === "finalized") {
      toast({ title: "Cannot re-run", description: "This payroll period is already finalized.", variant: "destructive" });
      return;
    }
    try {
      const res = await createRun.mutateAsync({ year, month });
      setSelectedRunId(res.run.id);
      toast({ title: force ? "Preview refreshed" : "Draft created" });
    } catch (e) {
      toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleFinalize = async () => {
    if (!runData) return;
    try {
      await finalizeRun.mutateAsync(runData.run.id);
      toast({ title: "Payroll finalized", description: "Advances settled and staff notified." });
    } catch (e) {
      toast({ title: "Finalize failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const yearOptions = useMemo(() => {
    const ys: number[] = [];
    for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 4; y--) ys.push(y);
    return ys;
  }, [now]);

  const run = runData?.run;
  const items = runData?.items ?? [];
  const isDraft = run?.status === "draft";
  const isFinalized = run?.status === "finalized";

  return (
    <Layout>
      <PageHeader
        title="Payroll"
        subtitle="Monthly salary runs, slips and payment tracking."
      />

      <div className="p-6 space-y-6">
        <HrBreachBanner />
        {/* Month picker + actions */}
        <div className="bg-card border rounded-lg p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Year</Label>
            <Select value={String(year)} onValueChange={(v) => { setYear(Number(v)); setSelectedRunId(null); }}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Month</Label>
            <Select value={String(month)} onValueChange={(v) => { setMonth(Number(v)); setSelectedRunId(null); }}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1" />

          {!currentRun && (
            <Button onClick={() => handlePreview(false)} disabled={createRun.isPending} data-testid="button-preview-payroll">
              <Calculator className="w-4 h-4 mr-2" />
              {createRun.isPending ? "Calculating…" : "Preview & Create Draft"}
            </Button>
          )}
          {currentRun?.status === "draft" && (
            <>
              <Button variant="outline" onClick={() => handlePreview(false)} disabled={createRun.isPending}>
                <RefreshCw className="w-4 h-4 mr-2" /> Re-preview
              </Button>
              <Button onClick={() => setConfirmFinalize(true)} data-testid="button-finalize-payroll">
                <Lock className="w-4 h-4 mr-2" /> Finalize
              </Button>
            </>
          )}
          {currentRun?.status === "finalized" && (
            <Badge variant="outline" className="px-3 py-1.5">
              <CheckCircle2 className="w-4 h-4 mr-1.5 text-emerald-600" /> Finalized
            </Badge>
          )}
        </div>

        {/* Summary cards */}
        {run && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard label="Gross Pay" value={fmtMoney(run.totalGross)} />
            <SummaryCard label="Deductions" value={fmtMoney(run.totalDeductions)} />
            <SummaryCard label="Advances Settled" value={fmtMoney(run.totalAdvancesSettled)} />
            <SummaryCard label="Net Payable" value={fmtMoney(run.totalNet)} highlight />
          </div>
        )}

        {/* Items table */}
        {runsLoading ? (
          <div className="text-center py-12 text-muted-foreground text-sm">Loading…</div>
        ) : !run ? (
          <div className="text-center py-12 border border-dashed rounded-lg">
            <Calculator className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No payroll run for {MONTHS[month - 1]} {year} yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Click "Preview & Create Draft" to calculate.</p>
          </div>
        ) : (
          <div className="bg-card border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-4 py-2 font-medium">Staff</th>
                  <th className="px-4 py-2 font-medium text-right">Gross</th>
                  <th className="px-4 py-2 font-medium text-right">Advances</th>
                  <th className="px-4 py-2 font-medium text-right">Net</th>
                  <th className="px-4 py-2 font-medium text-right">Paid</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id} className="border-t" data-testid={`row-payroll-${it.id}`}>
                    <td className="px-4 py-2">
                      <div className="font-medium">{it.userName}</div>
                      <div className="text-xs text-muted-foreground">
                        Worked {it.daysWorked}d · Abs {it.daysAbsent}d
                        {it.overridden ? <span className="ml-2 text-amber-600">· edited</span> : null}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">{fmtMoney(it.grossPay)}</td>
                    <td className="px-4 py-2 text-right">{fmtMoney(it.advanceSettled)}</td>
                    <td className="px-4 py-2 text-right font-medium">{fmtMoney(it.netPay)}</td>
                    <td className="px-4 py-2 text-right">{fmtMoney(it.paidAmount)}</td>
                    <td className="px-4 py-2">{statusBadge(it.paymentStatus)}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="inline-flex gap-1">
                        {isDraft && (
                          <Button size="sm" variant="ghost" onClick={() => setEditItem(it)} data-testid={`button-edit-${it.id}`}>
                            <Edit3 className="w-4 h-4" />
                          </Button>
                        )}
                        {isFinalized && it.paymentStatus !== "paid" && (
                          <Button size="sm" variant="outline" onClick={() => setPaymentItem(it)} data-testid={`button-pay-${it.id}`}>
                            <Wallet className="w-4 h-4 mr-1" /> Pay
                          </Button>
                        )}
                        {isFinalized && (
                          <Button
                            size="sm"
                            variant="ghost"
                            asChild
                            data-testid={`button-slip-${it.id}`}
                          >
                            <a href={payrollSlipUrl(restaurantId, it.id)} target="_blank" rel="noreferrer">
                              <FileText className="w-4 h-4" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No staff in this run.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Previous runs */}
        {runs.length > 0 && (
          <div className="bg-card border rounded-lg p-4">
            <div className="text-sm font-medium mb-2">Run history</div>
            <div className="space-y-1">
              {runs.slice(0, 12).map(r => (
                <button
                  key={r.id}
                  onClick={() => { setYear(r.periodYear); setMonth(r.periodMonth); setSelectedRunId(r.id); }}
                  className="w-full flex justify-between items-center px-2 py-1.5 rounded hover:bg-muted text-sm"
                >
                  <span>{MONTHS[r.periodMonth - 1]} {r.periodYear}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{fmtMoney(r.totalNet)}</span>
                    <Badge variant={r.status === "finalized" ? "default" : "secondary"} className="text-xs">
                      {r.status}
                    </Badge>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Edit override dialog */}
      <EditItemDialog
        item={editItem}
        onClose={() => setEditItem(null)}
        onSave={async (patch) => {
          if (!editItem) return;
          try {
            await patchItem.mutateAsync({ itemId: editItem.id, patch });
            toast({ title: "Updated" });
            setEditItem(null);
          } catch (e) {
            toast({ title: "Update failed", description: (e as Error).message, variant: "destructive" });
          }
        }}
        saving={patchItem.isPending}
      />

      {/* Payment dialog */}
      <PaymentDialog
        item={paymentItem}
        onClose={() => setPaymentItem(null)}
        onSave={async (payment) => {
          if (!paymentItem) return;
          try {
            await recordPayment.mutateAsync({ itemId: paymentItem.id, payment });
            toast({ title: "Payment recorded" });
            setPaymentItem(null);
          } catch (e) {
            toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
          }
        }}
        saving={recordPayment.isPending}
      />

      {/* Finalize confirmation */}
      <AlertDialog open={confirmFinalize} onOpenChange={setConfirmFinalize}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalize payroll?</AlertDialogTitle>
            <AlertDialogDescription>
              This will lock the run, settle advances against net pay, and notify staff. You cannot edit items after finalizing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleFinalize}>Finalize</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Re-preview confirmation */}
      <AlertDialog open={confirmRePreview} onOpenChange={setConfirmRePreview}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <AlertTriangle className="inline w-5 h-5 text-amber-500 mr-1" />
              Discard manual edits?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Re-previewing will recalculate everyone and discard any manual overrides on this draft.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmRePreview(false); handlePreview(true); }}>Re-preview</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`border rounded-lg p-4 ${highlight ? "bg-primary/5 border-primary/30" : "bg-card"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${highlight ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

function EditItemDialog({
  item, onClose, onSave, saving,
}: {
  item: PayrollItemRow | null;
  onClose: () => void;
  onSave: (patch: PayrollItemOverrideInput) => void;
  saving: boolean;
}) {
  const [bonus, setBonus] = useState("");
  const [otherDeductions, setOtherDeductions] = useState("");
  const [overtimeAmount, setOvertimeAmount] = useState("");
  const [advanceSettled, setAdvanceSettled] = useState("");
  const [notes, setNotes] = useState("");

  if (!item) return null;

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {item.userName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 space-y-0.5">
            <div className="font-medium text-foreground mb-1">Current breakdown</div>
            {item.earningsBreakdown.map((e, i) => (
              <div key={`e-${i}`} className="flex justify-between"><span>{e.label}</span><span>{fmtMoney(e.amount)}</span></div>
            ))}
            {item.deductionsBreakdown.map((d, i) => (
              <div key={`d-${i}`} className="flex justify-between text-destructive"><span>{d.label}</span><span>-{fmtMoney(d.amount)}</span></div>
            ))}
            <div className="border-t pt-1 mt-1 flex justify-between font-medium text-foreground"><span>Net</span><span>{fmtMoney(item.netPay)}</span></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Bonus / Allowance (₹)</Label>
              <Input value={bonus} onChange={(e) => setBonus(e.target.value)} placeholder="0.00" data-testid="input-bonus" />
            </div>
            <div>
              <Label className="text-xs">Other Deductions (₹)</Label>
              <Input value={otherDeductions} onChange={(e) => setOtherDeductions(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label className="text-xs">Overtime amount (₹)</Label>
              <Input value={overtimeAmount} onChange={(e) => setOvertimeAmount(e.target.value)} placeholder="auto" />
            </div>
            <div>
              <Label className="text-xs">Advance to settle (₹)</Label>
              <Input value={advanceSettled} onChange={(e) => setAdvanceSettled(e.target.value)} placeholder="auto" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving}
            onClick={() => onSave({
              bonus: bonus.trim() || undefined,
              otherDeductions: otherDeductions.trim() || undefined,
              overtimeAmount: overtimeAmount.trim() || undefined,
              advanceSettled: advanceSettled.trim() || undefined,
              notes: notes.trim() || undefined,
            })}
            data-testid="button-save-override"
          >
            {saving ? "Saving…" : "Save & Recompute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({
  item, onClose, onSave, saving,
}: {
  item: PayrollItemRow | null;
  onClose: () => void;
  onSave: (payment: { amount: string; paidOn?: string; mode?: "cash" | "upi" | "bank_transfer" | "other"; reference?: string; notes?: string }) => void;
  saving: boolean;
}) {
  const remaining = item ? Math.max(0, Number(item.netPay) - Number(item.paidAmount)) : 0;
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"cash" | "upi" | "bank_transfer" | "other">("cash");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  if (!item) return null;

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pay {item.userName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="bg-muted/50 rounded p-3 text-sm space-y-1">
            <div className="flex justify-between"><span>Net pay</span><span>{fmtMoney(item.netPay)}</span></div>
            <div className="flex justify-between"><span>Already paid</span><span>{fmtMoney(item.paidAmount)}</span></div>
            <div className="flex justify-between font-medium border-t pt-1"><span>Remaining</span><span>{fmtMoney(remaining)}</span></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Amount (₹)</Label>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={String(remaining.toFixed(2))}
                data-testid="input-payment-amount"
              />
              <button
                type="button"
                className="text-xs text-primary mt-1"
                onClick={() => setAmount(remaining.toFixed(2))}
              >Pay full</button>
            </div>
            <div>
              <Label className="text-xs">Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Paid on</Label>
              <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Reference</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / Txn ID" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving || !amount.trim()}
            onClick={() => onSave({
              amount: amount.trim(),
              paidOn,
              mode,
              reference: reference.trim() || undefined,
              notes: notes.trim() || undefined,
            })}
            data-testid="button-save-payment"
          >
            {saving ? "Saving…" : "Record Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
