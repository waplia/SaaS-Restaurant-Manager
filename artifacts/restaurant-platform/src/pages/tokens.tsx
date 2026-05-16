import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTokensToday, useUpdateToken, useRecallToken, useReprintToken, useTokenSettings, useResetTokens } from "@/lib/hooks-tokens";
import { useToast } from "@/hooks/use-toast";
import { useBranchContext } from "@/lib/branch";
import { useRestaurantId } from "@/lib/hooks";
import { Volume2, Printer, RefreshCw, CheckCircle2, ExternalLink } from "lucide-react";
import { Link } from "wouter";

export default function TokensPage() {
  const restaurantId = useRestaurantId();
  const { branches, selectedBranchId } = useBranchContext();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [counterOverride, setCounterOverride] = useState<Record<number, number>>({});
  const { toast } = useToast();

  const { data: tokens = [], isLoading } = useTokensToday({
    status: statusFilter || undefined,
    branchId: selectedBranchId ?? undefined,
  });
  const { data: settings } = useTokenSettings();
  const update = useUpdateToken();
  const recall = useRecallToken();
  const reprint = useReprintToken();
  const reset = useResetTokens();

  const grouped = useMemo(() => ({
    waiting: tokens.filter(t => t.status === "waiting" || t.status === "preparing"),
    ready: tokens.filter(t => t.status === "ready"),
    served: tokens.filter(t => t.status === "served"),
  }), [tokens]);

  const branchName = (id: number | null | undefined) =>
    branches.find(b => b.id === id)?.name ?? (id == null ? "—" : `#${id}`);

  const displayUrl = (bId: number | null) => {
    const out = bId ?? branches[0]?.id ?? "all";
    return `${window.location.origin}/restaurant-platform/display/token/${restaurantId}:${out}`;
  };

  return (
    <Layout>
      <PageHeader
        title="Token Display"
        subtitle="Issue, recall and serve customer tokens"
        actions={
          <div className="flex gap-2">
            <a href={displayUrl(selectedBranchId)} target="_blank" rel="noreferrer">
              <Button variant="outline" data-testid="button-open-tv-display">
                <ExternalLink className="w-4 h-4 mr-2" /> Open TV Display
              </Button>
            </a>
            <Link href="/tokens/history">
              <Button variant="outline">History</Button>
            </Link>
            <Button
              variant="destructive"
              onClick={() => {
                if (!confirm("Reset today's tokens? Numbers will start from the configured start.")) return;
                reset.mutate({ branchId: selectedBranchId ?? undefined }, {
                  onSuccess: () => toast({ title: "Tokens reset" }),
                  onError: (e) => toast({ title: "Could not reset", description: (e as Error).message, variant: "destructive" }),
                });
              }}
              data-testid="button-reset-tokens"
            >
              Reset Today
            </Button>
          </div>
        }
      />

      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Filter:</span>
          {["", "waiting", "preparing", "ready", "served"].map(s => (
            <Button
              key={s || "all"}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
              data-testid={`filter-status-${s || "all"}`}
            >
              {s ? s : "All"}
            </Button>
          ))}
          {settings && !settings.enabled && (
            <span className="ml-auto text-amber-500 text-sm">Token display is disabled in settings.</span>
          )}
        </div>

        {isLoading ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {(["waiting", "ready", "served"] as const).map(col => (
              <div key={col} className="rounded-lg border border-border bg-card">
                <div className="p-3 border-b border-border flex items-center justify-between">
                  <h3 className="font-semibold capitalize">{col === "waiting" ? "Waiting / Preparing" : col}</h3>
                  <span className="text-xs text-muted-foreground">{grouped[col].length}</span>
                </div>
                <div className="p-3 space-y-2 max-h-[70vh] overflow-y-auto">
                  {grouped[col].length === 0 && <div className="text-sm text-muted-foreground italic">None</div>}
                  {grouped[col].map(t => (
                    <div key={t.id} className="border border-border rounded-lg p-3 bg-background" data-testid={`token-row-${t.id}`}>
                      <div className="flex items-baseline justify-between">
                        <span className="font-mono text-2xl font-bold">{t.token}</span>
                        <span className="text-xs text-muted-foreground">{branchName(t.branchId)}</span>
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {t.customerNameRaw ?? "Guest"} · {t.orderType.replace("_", " ")}
                      </div>
                      {t.recalledCount > 0 && (
                        <div className="text-xs text-amber-600">Recalled {t.recalledCount}×</div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2 items-center">
                        <Input
                          type="number"
                          min={1}
                          className="w-20 h-8"
                          placeholder={String(t.counter)}
                          value={counterOverride[t.id] ?? ""}
                          onChange={(e) => setCounterOverride(s => ({ ...s, [t.id]: Number(e.target.value) || 0 }))}
                          data-testid={`input-counter-${t.id}`}
                        />
                        {col !== "served" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => recall.mutate({ id: t.id, counter: counterOverride[t.id] || undefined }, {
                              onSuccess: () => toast({ title: `Recalled ${t.token}` }),
                            })}
                            data-testid={`button-recall-${t.id}`}
                          >
                            <Volume2 className="w-3 h-3 mr-1" /> Recall
                          </Button>
                        )}
                        {col === "waiting" && (
                          <Button size="sm" onClick={() => update.mutate({ id: t.id, status: "ready" })} data-testid={`button-ready-${t.id}`}>
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Ready
                          </Button>
                        )}
                        {col === "ready" && (
                          <Button size="sm" onClick={() => update.mutate({ id: t.id, status: "served" })} data-testid={`button-served-${t.id}`}>
                            Served
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => reprint.mutate(t.id, {
                            onSuccess: (data) => {
                              const w = window.open("", "_blank");
                              if (!w) return;
                              w.document.write(`<pre style="font-family: monospace; font-size: 18px; padding: 24px;">
TOKEN ${data.token}
Counter: ${data.counter}
Order #${data.orderNumber ?? data.token}
${data.customerName ?? ""}
${new Date(data.issuedAt).toLocaleString()}
</pre><script>window.print();</script>`);
                            },
                          })}
                          data-testid={`button-print-${t.id}`}
                        >
                          <Printer className="w-3 h-3" />
                        </Button>
                        {col !== "served" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => update.mutate({ id: t.id, status: "cancelled" })}
                            data-testid={`button-cancel-${t.id}`}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
