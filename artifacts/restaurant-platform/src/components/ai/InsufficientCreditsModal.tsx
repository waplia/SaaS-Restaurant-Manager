import { Link } from "wouter";
import { Sparkles, Coins, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InsufficientCreditsModalProps {
  open: boolean;
  onClose: () => void;
  required: number;
  available: number;
  feature?: string;
}

export function InsufficientCreditsModal({ open, onClose, required, available, feature }: InsufficientCreditsModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-md rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-md text-muted-foreground hover:bg-muted"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="p-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center mb-4 shadow-lg shadow-violet-500/30">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Out of Khana AI credits</h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            {feature ? `${feature} requires` : "This action requires"} <strong>{required}</strong> {required === 1 ? "credit" : "credits"} but you have only <strong>{available}</strong> left.
          </p>
          <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 flex items-center gap-3 text-sm">
            <Coins className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground">Recharge to continue</p>
              <p className="text-xs text-muted-foreground">One-time top-ups never expire while your plan is active.</p>
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1">Not now</Button>
            <Link href="/ai/usage" className="flex-1">
              <Button className="w-full" onClick={onClose}>
                Recharge <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
