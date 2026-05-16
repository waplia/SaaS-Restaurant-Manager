import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function AiLoadingSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-violet-200/60 dark:border-violet-800/40 bg-gradient-to-br from-violet-50/50 to-fuchsia-50/30 dark:from-violet-950/20 dark:to-fuchsia-950/10 p-4", className)}>
      <div className="flex items-center gap-2 text-violet-700 dark:text-violet-300 text-xs font-semibold mb-3">
        <Sparkles className="w-3.5 h-3.5 animate-pulse" />
        Khana AI is thinking…
      </div>
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-3 rounded bg-violet-200/60 dark:bg-violet-800/30 animate-pulse"
            style={{ width: `${100 - i * 12}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function AiImageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("aspect-square rounded-lg border border-violet-200/60 dark:border-violet-800/40 bg-gradient-to-br from-violet-100 to-fuchsia-100 dark:from-violet-950/40 dark:to-fuchsia-950/30 flex items-center justify-center", className)}>
      <div className="flex flex-col items-center gap-2 text-violet-600 dark:text-violet-300">
        <Sparkles className="w-6 h-6 animate-pulse" />
        <p className="text-xs font-medium">Painting your dish…</p>
      </div>
    </div>
  );
}
