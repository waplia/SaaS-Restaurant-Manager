import { useSubscription } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import { AlertTriangle, X, Lock } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const RESTAURANT_ID = 1;

export function TrialBanner() {
  const { user } = useAuth();
  const { data } = useSubscription(RESTAURANT_ID);
  const [dismissed, setDismissed] = useState(false);

  if (!user || dismissed) return null;
  if (!data?.tenant) return null;

  const { planStatus, trialDaysLeft, isTrialExpired } = data.tenant;
  if (planStatus !== "trial") return null;
  if (!isTrialExpired && (trialDaysLeft === null || trialDaysLeft > 3)) return null;

  return (
    <div className={cn(
      "flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium z-20",
      isTrialExpired
        ? "bg-red-600 text-white"
        : "bg-red-500 text-white",
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
            <strong>{trialDaysLeft === 0 ? "less than 1 day" : `${trialDaysLeft} day${trialDaysLeft !== 1 ? "s" : ""}`}</strong>.{" "}
            <Link href="/settings/subscription" className="underline font-bold hover:opacity-80">Upgrade now</Link>
            {" "}to avoid service interruption.
          </span>
        )}
      </div>
      {!isTrialExpired && (
        <button
          onClick={() => setDismissed(true)}
          className="flex-shrink-0 hover:opacity-70 transition-opacity"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export function TrialPaywall() {
  const { user } = useAuth();
  const { data } = useSubscription(RESTAURANT_ID);
  const [location] = useLocation();

  if (!user) return null;
  if (!data?.tenant) return null;

  const { planStatus, isTrialExpired } = data.tenant;
  if (planStatus !== "trial" || !isTrialExpired) return null;

  if (location.startsWith("/settings/subscription") || location.startsWith("/settings/billing")) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 text-center space-y-5">
        <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center mx-auto">
          <Lock className="w-8 h-8 text-red-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground mb-2">Free Trial Expired</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Your 14-day free trial has ended. Upgrade to a paid plan to continue using TableTrack and access all your data.
          </p>
        </div>
        <div className="space-y-3">
          <Link href="/settings/subscription">
            <Button className="w-full" size="lg">
              View Plans & Upgrade
            </Button>
          </Link>
          <p className="text-xs text-muted-foreground">Your data is safe and will be restored immediately after upgrading.</p>
        </div>
      </div>
    </div>
  );
}
