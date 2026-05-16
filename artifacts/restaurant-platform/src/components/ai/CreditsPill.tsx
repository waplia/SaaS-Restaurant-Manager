import { Sparkles, Coins } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CreditsPillProps {
  cost: number;
  available?: number | null;
  loading?: boolean;
  className?: string;
}

export function CreditsPill({ cost, available, loading, className }: CreditsPillProps) {
  const insufficient = typeof available === "number" && available < cost;
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border",
      insufficient
        ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
        : "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300",
      loading && "animate-pulse",
      className,
    )}>
      <Sparkles className="w-3 h-3" />
      Costs {cost} {cost === 1 ? "credit" : "credits"}
      {typeof available === "number" && (
        <span className="inline-flex items-center gap-0.5 ml-1 opacity-80">
          <Coins className="w-3 h-3" /> {available}
        </span>
      )}
    </span>
  );
}
