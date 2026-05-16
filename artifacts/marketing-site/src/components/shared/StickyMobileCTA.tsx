import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const ALLOW_PREFIXES = [
  "/",
  "/features",
  "/solutions",
  "/khana-ai",
  "/pricing",
];

export function StickyMobileCTA() {
  const [location] = useLocation();
  const allowed =
    location === "/" ||
    ALLOW_PREFIXES.some(
      (p) => p !== "/" && (location === p || location.startsWith(`${p}/`)),
    );
  if (!allowed) return null;
  return (
    <div
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur-xl shadow-[0_-4px_16px_-4px_rgba(0,0,0,0.08)] px-3 py-2.5 flex gap-2 safe-bottom"
      data-testid="sticky-mobile-cta"
    >
      <Link href="/book-demo" className="flex-1">
        <Button variant="outline" className="w-full h-11 text-sm" data-testid="sticky-cta-demo">
          Book Demo
        </Button>
      </Link>
      <Link href="/start-free-trial" className="flex-1">
        <Button className="w-full h-11 text-sm" data-testid="sticky-cta-trial">
          Start Free Trial <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </Link>
    </div>
  );
}
