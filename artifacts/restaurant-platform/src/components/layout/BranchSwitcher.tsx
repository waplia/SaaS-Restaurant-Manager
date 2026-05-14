import { useState, useRef, useEffect } from "react";
import { Building2, ChevronDown, Check, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranchContext } from "@/lib/branch";

export function BranchSwitcher({ className }: { className?: string }) {
  const { branches, selectedBranchId, setSelectedBranchId, hasMultipleBranches, isLoading } = useBranchContext();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (isLoading) {
    return <div className={cn("h-9 w-44 rounded-lg bg-muted/40 animate-pulse", className)} />;
  }
  if (!hasMultipleBranches) return null;

  const selected = selectedBranchId == null
    ? null
    : branches.find(b => b.id === selectedBranchId) ?? null;

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 h-9 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted/40 transition-colors min-w-[180px]"
        data-testid="branch-switcher-button"
      >
        {selected ? (
          <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <Layers className="w-4 h-4 text-primary flex-shrink-0" />
        )}
        <span className="flex-1 text-left truncate">
          {selected ? selected.name : "All branches"}
        </span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-64 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
          <div className="py-1 max-h-72 overflow-y-auto">
            <button
              type="button"
              onClick={() => { setSelectedBranchId(null); setOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40 transition-colors",
                selectedBranchId == null && "bg-primary/10 text-primary"
              )}
            >
              <Layers className="w-4 h-4" />
              <div className="flex-1 text-left">
                <p className="font-medium">All branches</p>
                <p className="text-xs text-muted-foreground">Consolidated across {branches.length} {branches.length === 1 ? "branch" : "branches"}</p>
              </div>
              {selectedBranchId == null && <Check className="w-4 h-4" />}
            </button>
            <div className="border-t border-border my-1" />
            {branches.map(b => (
              <button
                key={b.id}
                type="button"
                onClick={() => { setSelectedBranchId(b.id); setOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40 transition-colors",
                  selectedBranchId === b.id && "bg-primary/10 text-primary"
                )}
              >
                <Building2 className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1 text-left min-w-0">
                  <p className="font-medium truncate">{b.name}</p>
                  {b.city && <p className="text-xs text-muted-foreground truncate">{b.city}</p>}
                </div>
                {selectedBranchId === b.id && <Check className="w-4 h-4" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
