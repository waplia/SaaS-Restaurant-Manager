import { Link, useLocation } from "wouter";
import { Sparkles, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useOnboardingState } from "@/pages/onboarding";

export function OnboardingBanner() {
  const { user } = useAuth();
  const [location] = useLocation();
  const canSee = !!user && !user.isSuperAdmin && (user.role === "owner" || user.role === "manager");
  const { data } = useOnboardingState();

  if (!canSee) return null;
  if (location.startsWith("/onboarding") || location.startsWith("/setup-wizard")) return null;
  if (!data || data.isOnboarded) return null;

  const completed = data.steps.filter(s => s.completed).length;
  const total = data.steps.length;
  const pct = Math.round((completed / total) * 100);

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 text-sm bg-primary/10 border-b border-primary/20">
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
        <span className="text-foreground truncate">
          Finish setting up your restaurant — <strong>{completed}/{total} steps</strong> done.
        </span>
        <div className="hidden sm:block w-32 h-1.5 rounded-full bg-primary/20 overflow-hidden flex-shrink-0">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <Link href="/setup-wizard" className="flex items-center gap-1 font-medium text-primary hover:underline flex-shrink-0">
        Resume AI setup <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
