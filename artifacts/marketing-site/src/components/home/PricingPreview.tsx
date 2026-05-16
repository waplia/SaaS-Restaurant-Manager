import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, ArrowRight } from "lucide-react";
import { usePublicPlans, type BillingView } from "@/lib/usePublicPlans";
import { BillingToggle } from "@/components/shared/BillingToggle";

export function PricingPreview() {
  const { plans, getDisplayPlans, hasDerivedYearly, isLoading, error } = usePublicPlans();
  const [view, setView] = useState<BillingView>("monthly");

  const displayPlans = useMemo(() => getDisplayPlans(view), [getDisplayPlans, view]);
  const popularIdx = displayPlans.length >= 2 ? Math.floor(displayPlans.length / 2) : -1;

  // Hide section entirely if API returned empty and no error — keeps page tidy.
  if (!isLoading && !error && plans.length === 0) return null;

  return (
    <section className="py-12 md:py-24 bg-background">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-3xl mx-auto mb-6 md:mb-10">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary mb-3 md:mb-4">
            Pricing
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl md:text-5xl font-bold mb-3 md:mb-5">Plans for every stage of your restaurant.</h2>
          <p className="text-base md:text-lg text-muted-foreground mb-5 md:mb-7">Start free for 14 days. Upgrade only when you're ready.</p>
          <BillingToggle view={view} onChange={setView} showSaveHint={hasDerivedYearly} />
        </div>

        {isLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[420px] rounded-2xl" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-10 md:py-12 bg-card rounded-2xl border border-border max-w-2xl mx-auto">
            <h3 className="text-lg font-bold mb-2">Pricing is being updated</h3>
            <p className="text-muted-foreground text-sm mb-5">Talk to our team for a personalized quote.</p>
            <Link href="/contact">
              <Button>Contact sales</Button>
            </Link>
          </div>
        ) : (
          <div className="md:hidden -mx-4 px-4 flex gap-3 overflow-x-auto scroll-snap-x no-scrollbar pb-2 mb-3">
            {displayPlans.map((dp, i) => {
              const plan = dp.plan;
              const popular = i === popularIdx;
              const isFree = Number(plan.price) === 0;
              const isEnterprise = /enterprise/i.test(plan.name);
              return (
                <div
                  key={plan.id}
                  className={`snap-card shrink-0 w-[82%] relative rounded-2xl border bg-card p-5 flex flex-col ${popular ? "border-primary shadow-xl" : "border-border"}`}
                  data-testid={`preview-plan-mobile-${plan.slug}`}
                >
                  {popular && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                      Most popular
                    </div>
                  )}
                  <h3 className="text-base font-bold font-serif mb-1">{plan.name}</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    {plan.description ?? (isFree ? `Free for ${plan.trialDays} days.` : "Built for growing restaurants.")}
                  </p>
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="text-2xl font-bold">{dp.displayPrice}</span>
                    {!isFree && <span className="text-xs text-muted-foreground">/{dp.period === "yearly" ? "yr" : "mo"}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mb-4">{isFree ? `${plan.trialDays}-day trial` : `Billed ${dp.period}`}</p>
                  <ul className="space-y-1.5 mb-5 flex-1">
                    {(plan.features ?? []).slice(0, 5).map((f) => (
                      <li key={f} className="flex items-start gap-2 text-xs">
                        <Check className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link href={isEnterprise ? "/contact" : "/book-demo"}>
                    <Button className="w-full" size="sm" variant={popular ? "default" : "outline"}>
                      {isEnterprise ? "Talk to sales" : "Book Demo"}
                    </Button>
                  </Link>
                </div>
              );
            })}
          </div>
        )}

        {!isLoading && !error && (
          <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
            {displayPlans.map((dp, i) => {
              const plan = dp.plan;
              const popular = i === popularIdx;
              const isFree = Number(plan.price) === 0;
              const isEnterprise = /enterprise/i.test(plan.name);
              return (
                <div
                  key={plan.id}
                  className={`relative rounded-2xl border bg-card p-7 flex flex-col ${popular ? "border-primary shadow-xl md:scale-[1.02]" : "border-border"}`}
                  data-testid={`preview-plan-${plan.slug}`}
                >
                  {popular && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                      Most popular
                    </div>
                  )}
                  <h3 className="text-lg font-bold font-serif mb-1">{plan.name}</h3>
                  <p className="text-sm text-muted-foreground mb-5">
                    {plan.description ?? (isFree ? `Free for ${plan.trialDays} days.` : "Built for growing restaurants.")}
                  </p>
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="text-3xl font-bold">{dp.displayPrice}</span>
                    {!isFree && (
                      <span className="text-sm text-muted-foreground">/{dp.period === "yearly" ? "yr" : "mo"}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-5">
                    {isFree ? `${plan.trialDays}-day trial` : `Billed ${dp.period}`}
                  </p>
                  <ul className="space-y-2 mb-6 flex-1">
                    {(plan.features ?? []).slice(0, 6).map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link href={isEnterprise ? "/contact" : "/book-demo"}>
                    <Button className="w-full" variant={popular ? "default" : "outline"}>
                      {isEnterprise ? "Talk to sales" : "Book Demo"}
                    </Button>
                  </Link>
                </div>
              );
            })}
          </div>
        )}

        <div className="text-center mt-6 md:mt-10">
          <Link href="/pricing">
            <Button variant="ghost" className="text-primary">
              See full pricing & feature comparison <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
