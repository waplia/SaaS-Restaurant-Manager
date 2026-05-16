import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { Badge } from "@/components/ui/badge";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet } from "@/lib/api";
import { ChevronRight, Calculator, AlertTriangle, CheckCircle2, Circle } from "lucide-react";

interface TargetSummary {
  target: string;
  label: string;
  description: string;
  formats: Record<string, string[]>;
  supportsPush: boolean;
  status: "configured" | "configuration_required" | "not_configured";
  lastTestedAt: string | null;
  lastTestResult: string | null;
}

const STATUS_BADGE: Record<TargetSummary["status"], { label: string; cls: string; Icon: typeof Circle }> = {
  configured: { label: "Configured", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", Icon: CheckCircle2 },
  configuration_required: { label: "Configuration required", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30", Icon: AlertTriangle },
  not_configured: { label: "Not configured", cls: "bg-muted text-muted-foreground border-border", Icon: Circle },
};

export default function AccountingLandingPage() {
  const restaurantId = useRestaurantId();
  const { data = [], isLoading } = useQuery({
    queryKey: ["accounting-targets", restaurantId],
    queryFn: () => apiGet<TargetSummary[]>(`/restaurants/${restaurantId}/accounting/targets`),
  });

  return (
    <SettingsLayout activeKey={"accounting" as never} title="Accounting integrations" subtitle="Push journals to Tally, Zoho Books, QuickBooks, BUSY, Marg, Vyapar, GST returns, Excel, or any HTTPS endpoint.">
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((t) => {
            const meta = STATUS_BADGE[t.status];
            const Icon = meta.Icon;
            return (
              <Link key={t.target} href={`/settings/accounting/${t.target}`}>
                <a className="block rounded-lg border border-border bg-card/40 p-5 hover:border-primary/40 hover:bg-card/60 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Calculator className="w-5 h-5 text-primary" />
                      <h3 className="text-sm font-semibold text-foreground">{t.label}</h3>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                  <div className="mt-4 flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] ${meta.cls}`}>
                      <Icon className="w-3 h-3" /> {meta.label}
                    </span>
                    {t.supportsPush && (
                      <Badge variant="outline" className="text-[10px]">API push</Badge>
                    )}
                  </div>
                </a>
              </Link>
            );
          })}
        </div>
      )}
    </SettingsLayout>
  );
}
