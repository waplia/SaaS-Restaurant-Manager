import type { BillingView } from "@/lib/usePublicPlans";
import { YEARLY_DISCOUNT_PCT } from "@/lib/usePublicPlans";

interface Props {
  view: BillingView;
  onChange: (view: BillingView) => void;
  /** Show the "save N%" hint on the yearly button. */
  showSaveHint?: boolean;
  className?: string;
}

export function BillingToggle({ view, onChange, showSaveHint = false, className = "" }: Props) {
  const yearly = view === "yearly";
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border border-border bg-card p-1 ${className}`}>
      <button
        type="button"
        onClick={() => onChange("monthly")}
        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${!yearly ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        data-testid="btn-pricing-monthly"
        aria-pressed={!yearly}
      >
        Monthly
      </button>
      <button
        type="button"
        onClick={() => onChange("yearly")}
        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${yearly ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        data-testid="btn-pricing-yearly"
        aria-pressed={yearly}
      >
        Yearly{showSaveHint && <span className="text-xs opacity-80 ml-1">· save {YEARLY_DISCOUNT_PCT}%</span>}
      </button>
    </div>
  );
}
