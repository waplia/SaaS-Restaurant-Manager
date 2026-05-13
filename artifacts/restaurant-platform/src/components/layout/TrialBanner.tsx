import { useSubscription } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const RESTAURANT_ID = 1;

export function TrialBanner() {
  const { user } = useAuth();
  const { data } = useSubscription(RESTAURANT_ID);
  const [dismissed, setDismissed] = useState(false);

  if (!user || dismissed) return null;
  if (!data?.tenant) return null;

  const { planStatus, trialDaysLeft, isTrialExpired } = data.tenant;
  if (planStatus !== "trial") return null;
  if (!isTrialExpired && (trialDaysLeft === null || trialDaysLeft > 7)) return null;

  const critical = isTrialExpired || (trialDaysLeft !== null && trialDaysLeft <= 3);

  return (
    <div className={cn(
      "flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium z-20",
      critical
        ? "bg-red-500 text-white"
        : "bg-amber-400 text-amber-900",
    )}>
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        {isTrialExpired ? (
          <span>
            Your free trial has expired.{" "}
            <Link href="/settings/subscription" className="underline font-bold hover:opacity-80">Upgrade now</Link>
            {" "}to restore full access.
          </span>
        ) : (
          <span>
            Your free trial ends in{" "}
            <strong>{trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""}</strong>.{" "}
            <Link href="/settings/subscription" className="underline font-bold hover:opacity-80">Upgrade now</Link>
            {" "}to avoid service interruption.
          </span>
        )}
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 hover:opacity-70 transition-opacity"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
