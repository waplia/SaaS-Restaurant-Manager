import { Link } from "wouter";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { CTASection } from "@/components/shared/CTASection";
import { Button } from "@/components/ui/button";
import { useSeo } from "@/lib/seo";
import { Check, X, Sparkles, ArrowRight } from "lucide-react";

const ROWS = [
  { feature: "POS billing (offline-safe)", us: true, legacy: true, aggregator: false },
  { feature: "Native QR menu & online ordering", us: true, legacy: false, aggregator: true },
  { feature: "Unified order feed (POS + QR + aggregator)", us: true, legacy: false, aggregator: false },
  { feature: "Kitchen display with station routing", us: true, legacy: false, aggregator: false },
  { feature: "Inventory with recipe costing", us: true, legacy: "partial", aggregator: false },
  { feature: "Staff & payroll", us: true, legacy: false, aggregator: false },
  { feature: "True P&L by outlet", us: true, legacy: "partial", aggregator: false },
  { feature: "Growth engine (loyalty, coupons, campaigns)", us: true, legacy: false, aggregator: false },
  { feature: "AI menu import (photo → menu)", us: true, legacy: false, aggregator: false },
  { feature: "AI review booster & smart campaigns", us: true, legacy: false, aggregator: false },
  { feature: "AI forecasting & insights", us: true, legacy: false, aggregator: false },
  { feature: "Multi-outlet / franchise controls", us: true, legacy: "partial", aggregator: false },
  { feature: "Open APIs & Marketplace", us: true, legacy: false, aggregator: false },
  { feature: "Direct line to product team in India", us: true, legacy: false, aggregator: false },
];

function Cell({ v }: { v: boolean | "partial" }) {
  if (v === true) return <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold"><Check className="h-4 w-4" /> Yes</span>;
  if (v === "partial") return <span className="text-amber-600 font-semibold text-sm">Partial</span>;
  return <span className="inline-flex items-center gap-1 text-muted-foreground"><X className="h-4 w-4" /> No</span>;
}

export default function Compare() {
  useSeo({
    title: "Compare | KhanaLagao",
    description: "How KhanaLagao compares to legacy POS systems and aggregator-only solutions — features, integrations, AI, finance, growth and support.",
  });
  return (
    <SiteLayout>
      <section className="pt-12 md:pt-28 pb-6 md:pb-10">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold mb-3 md:mb-5">
            <Sparkles className="h-3 w-3" /> Compare
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight mb-3 md:mb-5">
            One platform. <span className="text-primary">Honest comparison.</span>
          </h1>
          <p className="text-base md:text-xl text-muted-foreground max-w-3xl mx-auto">
            Most restaurants today stitch together a legacy POS, an aggregator dashboard and a few spreadsheets. KhanaLagao replaces all of it with one connected system.
          </p>
        </div>
      </section>

      <section className="py-8 md:py-16">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl">
          {/* Mobile: per-row cards */}
          <div className="md:hidden space-y-3">
            <p className="text-xs text-muted-foreground italic mb-3">Tap any row to compare across vendors</p>
            {ROWS.map((r) => (
              <div key={r.feature} className="rounded-xl border border-border bg-card p-4">
                <div className="font-semibold text-sm mb-3">{r.feature}</div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><div className="text-primary font-semibold mb-1">KhanaLagao</div><Cell v={r.us} /></div>
                  <div><div className="text-muted-foreground font-semibold mb-1">Legacy POS</div><Cell v={r.legacy as boolean | "partial"} /></div>
                  <div><div className="text-muted-foreground font-semibold mb-1">Aggregator</div><Cell v={r.aggregator} /></div>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop: full table */}
          <div className="hidden md:block overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-5 py-4 font-semibold">Capability</th>
                  <th className="text-left px-5 py-4 font-semibold text-primary">KhanaLagao</th>
                  <th className="text-left px-5 py-4 font-semibold text-muted-foreground">Legacy POS</th>
                  <th className="text-left px-5 py-4 font-semibold text-muted-foreground">Aggregator only</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r, i) => (
                  <tr key={r.feature} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                    <td className="px-5 py-3.5 font-medium">{r.feature}</td>
                    <td className="px-5 py-3.5"><Cell v={r.us} /></td>
                    <td className="px-5 py-3.5"><Cell v={r.legacy as boolean | "partial"} /></td>
                    <td className="px-5 py-3.5"><Cell v={r.aggregator} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-4">Comparison reflects typical implementations of legacy POS and aggregator dashboards as of 2026. Capabilities vary by vendor; we encourage you to verify with each provider.</p>
        </div>
      </section>

      <section className="py-10 md:py-16 bg-muted/30 border-y border-border">
        <div className="container mx-auto px-4 md:px-6 max-w-4xl text-center">
          <h2 className="font-serif text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3 md:mb-4">See it side by side, on your own menu.</h2>
          <p className="text-sm md:text-base text-muted-foreground mb-5 md:mb-6 max-w-2xl mx-auto">Book a free demo. We'll set up a sandbox with your menu and walk through the gaps you care about most.</p>
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
            <Link href="/book-demo"><Button size="lg" className="gap-2 w-full sm:w-auto">Book a free demo <ArrowRight className="h-4 w-4" /></Button></Link>
            <Link href="/pricing"><Button size="lg" variant="outline" className="w-full sm:w-auto">See pricing</Button></Link>
          </div>
        </div>
      </section>

      <CTASection title="Switching from another POS?" subtitle="Our migration team will move your menu, inventory and customers — usually in under a week." />
    </SiteLayout>
  );
}
