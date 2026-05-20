import { useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useTerminals, useTerminalProviders, usePairTerminal, useUnpairTerminal,
  useTerminalPaymentsByDevice, useTerminalRefund, useTerminalRecentPayments,
  type TerminalProviderId, type TerminalRecord,
} from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CreditCard, Plus, X, AlertCircle, CheckCircle2, Clock, Activity,
  Trash2, Link2, BarChart3, RotateCcw,
} from "lucide-react";

const PROVIDER_DESCRIPTION: Record<TerminalProviderId, { tagline: string; help: string }> = {
  stripe: {
    tagline: "Stripe Terminal (BBPOS, WisePOS E, Tap-to-Pay) — real card-present processing.",
    help: "Requires STRIPE_SECRET_KEY. Reader connects to the browser via the Stripe Terminal JS SDK.",
  },
  square: {
    tagline: "Square Terminal — stub. Charges return 'Configuration required'.",
    help: "Square integration ships as a stub. Set SQUARE_ACCESS_TOKEN and implement the provider to enable.",
  },
  clover: {
    tagline: "Clover devices — stub. Charges return 'Configuration required'.",
    help: "Clover integration ships as a stub. Set CLOVER_API_TOKEN and implement the provider to enable.",
  },
  phonepe: {
    tagline: "PhonePe Business — EDC, Dynamic QR, Collect, Paylink and Static QR settlements.",
    help: "Configure your Merchant ID, Salt Key and environment under Super Admin → PhonePe before pairing a terminal.",
  },
  custom: {
    tagline: "Custom / webhook-based terminal — stub.",
    help: "Use this for any other provider; charges currently return 'Configuration required'.",
  },
};

const STATUS_BADGE = {
  online: { label: "Online", cls: "bg-green-100 text-green-700", icon: CheckCircle2 },
  offline: { label: "Offline", cls: "bg-gray-100 text-gray-600", icon: Clock },
  error: { label: "Error", cls: "bg-red-100 text-red-700", icon: AlertCircle },
  pairing: { label: "Pairing", cls: "bg-amber-100 text-amber-700", icon: Activity },
} as const;

export default function SettingsTerminalsPage() {
  const { user } = useAuth();
  const canWrite = !!user && (user.isSuperAdmin || user.role === "owner" || user.role === "manager");

  const { data: terminals = [], isLoading } = useTerminals();
  const { data: providersData } = useTerminalProviders();
  const providers = providersData?.providers ?? [];
  const { data: report } = useTerminalPaymentsByDevice();
  const pair = usePairTerminal();
  const unpair = useUnpairTerminal();
  const { toast } = useToast();

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<{ name: string; provider: TerminalProviderId; externalId: string; model: string; serial: string }>({
    name: "", provider: "stripe", externalId: "", model: "", serial: "",
  });
  const [refundTarget, setRefundTarget] = useState<{ deviceId: number; deviceName: string } | null>(null);

  const submit = async () => {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    try {
      await pair.mutateAsync({
        name: form.name.trim(),
        provider: form.provider,
        externalId: form.externalId.trim() || null,
        model: form.model.trim() || null,
        serial: form.serial.trim() || null,
      });
      toast({ title: "Terminal paired", description: `${form.name} is ready to accept card payments.` });
      setShowModal(false);
      setForm({ name: "", provider: "stripe", externalId: "", model: "", serial: "" });
    } catch (err) {
      toast({ title: "Pairing failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const handleUnpair = async (t: TerminalRecord) => {
    if (!confirm(`Unpair "${t.name}"? Card payments will no longer route to this device.`)) return;
    try {
      await unpair.mutateAsync(t.id);
      toast({ title: "Terminal unpaired" });
    } catch (err) {
      toast({ title: "Unpair failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const noTerminals = !isLoading && terminals.length === 0;
  const anyConfigured = providers.some(p => p.configured);

  return (
    <Layout>
      <PageHeader
        title="Card Terminals"
        description="Pair physical card terminals, manage providers and review device-wise revenue."
        actions={canWrite ? (
          <Button onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4 mr-2" /> Pair Terminal
          </Button>
        ) : null}
      />

      {/* Provider status */}
      <section className="mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {providers.map(p => (
          <div key={p.id} className={cn(
            "rounded-xl border p-4",
            p.configured ? "border-green-300 bg-green-50/40 dark:bg-green-950/20" : "border-border bg-card",
          )}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-sm">{p.label}</span>
              {p.configured
                ? <span className="text-[10px] uppercase tracking-wide bg-green-600 text-white px-1.5 py-0.5 rounded">Configured</span>
                : <span className="text-[10px] uppercase tracking-wide bg-amber-500 text-white px-1.5 py-0.5 rounded">Stub</span>}
            </div>
            <p className="text-xs text-muted-foreground leading-snug">{PROVIDER_DESCRIPTION[p.id].tagline}</p>
            {!p.configured && (
              <p className="text-xs text-muted-foreground mt-2 italic">{PROVIDER_DESCRIPTION[p.id].help}</p>
            )}
          </div>
        ))}
      </section>

      {/* Empty state */}
      {noTerminals && (
        <div className="rounded-2xl border-2 border-dashed border-border p-10 flex flex-col items-center text-center bg-card">
          <CreditCard className="w-12 h-12 text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold mb-1">Configuration required</h3>
          <p className="text-sm text-muted-foreground max-w-md mb-4">
            No card terminals are paired yet. Pair a terminal to enable
            tap-to-pay, tip-on-terminal and device-wise reporting in POS.
            {!anyConfigured && " Stripe Terminal needs STRIPE_SECRET_KEY in environment to process real charges; other providers are stubs."}
          </p>
          {canWrite && (
            <Button onClick={() => setShowModal(true)}>
              <Plus className="w-4 h-4 mr-2" /> Pair your first terminal
            </Button>
          )}
        </div>
      )}

      {/* Terminals list */}
      {!noTerminals && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-8">
          {terminals.map(t => {
            const badge = STATUS_BADGE[t.status];
            const Icon = badge.icon;
            const providerLabel = providers.find(p => p.id === t.terminal?.provider)?.label ?? t.terminal?.provider ?? "—";
            return (
              <div key={t.id} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-semibold flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-primary" /> {t.name}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {providerLabel}{t.terminal?.model ? ` • ${t.terminal.model}` : ""}{t.terminal?.serial ? ` • SN ${t.terminal.serial}` : ""}
                    </p>
                    {t.terminal?.externalId && (
                      <p className="text-[11px] font-mono text-muted-foreground mt-1">Reader ID: {t.terminal.externalId}</p>
                    )}
                  </div>
                  <span className={cn("text-xs font-medium px-2 py-1 rounded inline-flex items-center gap-1", badge.cls)}>
                    <Icon className="w-3 h-3" /> {badge.label}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-3">
                  <span className="inline-flex items-center gap-1"><Link2 className="w-3 h-3" /> Paired {t.pairedAt ? new Date(t.pairedAt).toLocaleDateString() : "—"}</span>
                  {t.lastSeenAt && <span>Last seen {new Date(t.lastSeenAt).toLocaleTimeString()}</span>}
                </div>
                {canWrite && (
                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => handleUnpair(t)}>
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Unpair
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* Device-wise report */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">Payments by terminal</h3>
        </div>
        {(!report || report.data.length === 0) ? (
          <p className="text-sm text-muted-foreground italic">
            No terminal payments yet. Once a terminal processes a card, you'll see device-wise gross, refunds and net revenue here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 px-2">Terminal</th>
                  <th className="text-left py-2 px-2">Provider</th>
                  <th className="text-right py-2 px-2">Transactions</th>
                  <th className="text-right py-2 px-2">Gross</th>
                  <th className="text-right py-2 px-2">Refunds</th>
                  <th className="text-right py-2 px-2">Net</th>
                  {canWrite && <th className="text-right py-2 px-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {report.data.map(r => (
                  <tr key={r.deviceId} className="border-b border-border/40 last:border-0">
                    <td className="py-2 px-2 font-medium">{r.deviceName}</td>
                    <td className="py-2 px-2 text-xs text-muted-foreground capitalize">{r.provider ?? "—"}</td>
                    <td className="py-2 px-2 text-right">{r.txCount} <span className="text-xs text-muted-foreground">({r.refundCount} refunds)</span></td>
                    <td className="py-2 px-2 text-right text-green-600 font-medium">₹{r.grossIn}</td>
                    <td className="py-2 px-2 text-right text-red-600">−₹{r.refundsOut}</td>
                    <td className="py-2 px-2 text-right font-semibold">₹{r.net}</td>
                    {canWrite && (
                      <td className="py-2 px-2 text-right">
                        <Button size="sm" variant="outline"
                          disabled={r.txCount === 0}
                          onClick={() => setRefundTarget({ deviceId: r.deviceId, deviceName: r.deviceName })}>
                          <RotateCcw className="w-3.5 h-3.5 mr-1" /> Refund
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Helpful link to POS */}
      <p className="text-xs text-muted-foreground mt-4">
        Tip: once a terminal is paired, the "Terminal" payment method appears in <Link href="/pos" className="underline">POS</Link>.
      </p>

      {/* Refund modal */}
      {refundTarget && (
        <RefundModal
          deviceId={refundTarget.deviceId}
          deviceName={refundTarget.deviceName}
          onClose={() => setRefundTarget(null)}
        />
      )}

      {/* Pair modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary" /> Pair Card Terminal
              </h2>
              <Button variant="ghost" size="sm" aria-label="Close" onClick={() => setShowModal(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <Label className="mb-1.5 block">Provider</Label>
                <div className="grid grid-cols-2 gap-2">
                  {providers.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setForm({ ...form, provider: p.id })}
                      className={cn(
                        "text-left rounded-lg border-2 p-3 transition-all",
                        form.provider === p.id
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/40",
                      )}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-medium">{p.label}</span>
                        {p.configured
                          ? <span className="text-[10px] bg-green-600 text-white px-1.5 py-0.5 rounded uppercase tracking-wide">Live</span>
                          : <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded uppercase tracking-wide">Stub</span>}
                      </div>
                      <p className="text-xs text-muted-foreground leading-snug">{PROVIDER_DESCRIPTION[p.id].tagline}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="t-name" className="mb-1.5 block">Display name</Label>
                <Input
                  id="t-name"
                  placeholder="e.g. Counter Reader"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="t-model" className="mb-1.5 block">Model (optional)</Label>
                  <Input id="t-model" placeholder="WisePOS E" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="t-serial" className="mb-1.5 block">Serial (optional)</Label>
                  <Input id="t-serial" placeholder="SN-XXXX" value={form.serial} onChange={e => setForm({ ...form, serial: e.target.value })} />
                </div>
              </div>
              <div>
                <Label htmlFor="t-ext" className="mb-1.5 block">
                  Reader ID {form.provider === "stripe" ? "(Stripe `tmr_...`)" : "(provider device id)"}
                </Label>
                <Input
                  id="t-ext"
                  placeholder={form.provider === "stripe" ? "tmr_FXXXXXXXXX" : "device id"}
                  value={form.externalId}
                  onChange={e => setForm({ ...form, externalId: e.target.value })}
                />
              </div>

              {form.provider !== "stripe" && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-800 dark:text-amber-300">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    This provider is a stub — pairing is recorded but charges will return "Configuration required" until the integration is implemented.
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button onClick={submit} disabled={pair.isPending}>
                {pair.isPending ? "Pairing…" : "Pair Terminal"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

function RefundModal({ deviceId, deviceName, onClose }: { deviceId: number; deviceName: string; onClose: () => void }) {
  const { data: recent, isLoading } = useTerminalRecentPayments(deviceId);
  const refund = useTerminalRefund();
  const { toast } = useToast();
  const [paymentId, setPaymentId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  // Only "in" rows are refundable — refund rows themselves (direction "out") are excluded.
  const refundable = (recent?.data ?? []).filter(p => p.direction === "in");
  const selected = refundable.find(p => p.id === paymentId) ?? null;
  const maxAmount = selected ? Number(selected.amount) : 0;

  const submit = async () => {
    if (!paymentId || !selected) {
      toast({ title: "Select a payment to refund", variant: "destructive" });
      return;
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast({ title: "Enter a refund amount", variant: "destructive" });
      return;
    }
    if (amt > maxAmount + 0.01) {
      toast({ title: `Refund cannot exceed ₹${maxAmount.toFixed(2)}`, variant: "destructive" });
      return;
    }
    try {
      await refund.mutateAsync({
        terminalId: deviceId,
        paymentId,
        amountMinor: Math.round(amt * 100),
        reason: reason.trim() || undefined,
      });
      toast({ title: "Refund issued", description: `₹${amt.toFixed(2)} refunded on ${deviceName}.` });
      onClose();
    } catch (err) {
      toast({ title: "Refund failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-primary" /> Refund on {deviceName}
          </h2>
          <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <Label className="mb-1.5 block">Original payment</Label>
            {isLoading ? (
              <p className="text-xs text-muted-foreground italic">Loading recent payments…</p>
            ) : refundable.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No refundable payments found for this terminal.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-1.5">
                {refundable.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setPaymentId(p.id); setAmount(p.amount); }}
                    className={cn(
                      "w-full text-left rounded-lg border-2 px-3 py-2 text-sm transition-all",
                      paymentId === p.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/40",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">₹{Number(p.amount).toFixed(2)}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(p.paymentDate).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {p.referenceId ? `Order #${p.referenceId}` : "—"} • Ref {p.terminalRefId ?? "—"}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selected && (
            <>
              <div>
                <Label htmlFor="refund-amount" className="mb-1.5 block">
                  Refund amount (₹) — max ₹{maxAmount.toFixed(2)}
                </Label>
                <Input
                  id="refund-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  max={maxAmount}
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground mt-1">Partial refunds are allowed.</p>
              </div>
              <div>
                <Label htmlFor="refund-reason" className="mb-1.5 block">Reason (optional)</Label>
                <Input
                  id="refund-reason"
                  placeholder="Why is this being refunded?"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  maxLength={200}
                />
              </div>
            </>
          )}
        </div>
        <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={refund.isPending || !selected}>
            {refund.isPending ? "Refunding…" : "Issue Refund"}
          </Button>
        </div>
      </div>
    </div>
  );
}
