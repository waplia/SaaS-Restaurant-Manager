import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function AiGeneratedBadge({ className, label = "AI Generated" }: { className?: string; label?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
      "bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 text-violet-700 dark:text-violet-300",
      "border border-violet-300/50 dark:border-violet-700/50",
      className,
    )}>
      <Sparkles className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

export function ConfidenceChip({ value }: { value: "low" | "medium" | "high" }) {
  const tone = value === "high"
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    : value === "medium"
    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize", tone)}>{value} confidence</span>;
}
