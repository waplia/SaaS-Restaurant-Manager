import { Fragment, useState, useMemo } from "react";
import { useSeo } from "@/lib/seo";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { Link } from "wouter";
import { Check, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PLAN_BOOLEAN_FEATURES, PLAN_QUANTITY_FEATURES, PLAN_FEATURE_CATEGORIES,
  isFeatureEnabled, formatQuantity,
} from "@workspace/db/planFeatures";
import { usePublicPlans, type PublicPlan, type BillingView } from "@/lib/usePublicPlans";
import { BillingToggle } from "@/components/shared/BillingToggle";

interface PlanFeatureRow {
  label: string;
  enabled: boolean;
  /** Subtle = quantity / always-shown row. Bold = on/off feature. */
  muted?: boolean;
}

const FAQ_ITEMS = [
  {
    q: "Is there a setup fee or minimum contract?",
    a: "No setup fee and no annual lock-in. All plans are billed monthly and you can cancel any time from your account.",
  },
  {
    q: "Can I switch plans as my restaurant grows?",
    a: "Yes — you can upgrade or downgrade at any time. Pro-rated billing handles the difference automatically.",
  },
  {
    q: "Does KhanaLagao work offline?",
    a: "Yes. Billing and KOTs continue to print during internet outages and sync automatically once you're back online.",
  },
  {
    q: "Do you support multi-outlet brands?",
    a: "Yes. Higher plans allow multiple restaurants and branches with centralized menus, branch-level overrides, role-based access, and consolidated reporting across every location.",
  },
  {
    q: "What does onboarding look like?",
    a: "Most single outlets are live in under a week — including menu setup, hardware configuration, staff training, and live support during your first service.",
  },
  {
    q: "Which payment methods are supported?",
    a: "Card, UPI, wallets, cash, and split payments are supported out of the box. Cashfree and Stripe are both supported for subscription billing.",
  },
];

function planFeatureRows(plan: PublicPlan): PlanFeatureRow[] {
  const rows: PlanFeatureRow[] = [];
  // 1. Quantity limits (always shown when > 0).
  for (const q of PLAN_QUANTITY_FEATURES) {
    const v = plan[q.key] ?? 0;
    const label = formatQuantity(q, v);
    if (label) rows.push({ label, enabled: true });
  }
  if (plan.trialDays > 0) rows.push({ label: `${plan.trialDays}-day free trial`, enabled: true });
  // 2. Boolean flags — show every catalogue entry. Disabled flags render
  // muted so customers can compare across plans at a glance.
  for (const f of PLAN_BOOLEAN_FEATURES) {
    const on = isFeatureEnabled(plan.featureFlags, f.key);
    rows.push({ label: f.label, enabled: on, muted: !on });
  }
  // 3. Free-form marketing bullets last.
  for (const extra of plan.features ?? []) {
    rows.push({ label: extra, enabled: true });
  }
  return rows;
}

export default function Pricing() {
  const { plans, getDisplayPlans, hasDerivedYearly, isLoading, error } = usePublicPlans();

  // Build AggregateOffer schema dynamically from live plans so SEO data
  // never drifts from super-admin configuration.
  const offerPrices = plans
    .map((p) => Number(p.price))
    .filter((n) => Number.isFinite(n));
  const lowPrice = offerPrices.length ? String(Math.min(...offerPrices)) : "0";
  const highPrice = offerPrices.length ? String(Math.max(...offerPrices)) : undefined;
  const offerCount = String(Math.max(plans.length, 1));
  const priceCurrency = plans[0]?.currency ?? "INR";

  useSeo({
    title: "Pricing | KhanaLagao",
    description: "Simple, transparent monthly pricing for restaurants, cafes, cloud kitchens and chains. No setup fee, no lock-in. 14-day free trial on every plan.",
    breadcrumbs: [
      { label: "Home", href: "/" },
      { label: "Pricing" },
    ],
    schema: [
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FAQ_ITEMS.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
      {
        "@context": "https://schema.org",
        "@type": "Product",
        name: "KhanaLagao Restaurant OS",
        description: "Complete restaurant operating system: POS, QR menu, KDS, inventory, staff, finance, growth and Khana AI.",
        brand: { "@type": "Brand", name: "KhanaLagao" },
        offers: {
          "@type": "AggregateOffer",
          priceCurrency,
          lowPrice,
          ...(highPrice ? { highPrice } : {}),
          offerCount,
          availability: "https://schema.org/InStock",
        },
      },
    ],
  });
  const [view, setView] = useState<BillingView>("monthly");
  const displayPlans = useMemo(() => getDisplayPlans(view), [getDisplayPlans, view]);
  const popularIdx = displayPlans.length >= 2 ? Math.floor(displayPlans.length / 2) : -1;

  return (
    <SiteLayout>
      <div className="pt-10 md:pt-24 pb-16 md:pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="text-center max-w-3xl mx-auto mb-8 md:mb-12">
            <h1 className="font-serif text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight mb-4 md:mb-6">
              Simple, transparent pricing.
            </h1>
            <p className="text-base md:text-xl text-muted-foreground mb-6 md:mb-8">
              No hidden fees. No long-term contracts. Just the tools you need to run your restaurant.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
              <a href="/app/register">
                <Button size="lg" className="h-12 px-7 text-base w-full sm:w-auto" data-testid="btn-pricing-hero-get-started">
                  Get started — free 14-day trial <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </a>
              <Link href="/book-demo">
                <Button size="lg" variant="outline" className="h-12 px-7 text-base w-full sm:w-auto" data-testid="btn-pricing-hero-book-demo">
                  Book a demo
                </Button>
              </Link>
            </div>
            <div className="flex justify-center">
              <BillingToggle view={view} onChange={setView} showSaveHint={hasDerivedYearly} />
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-6xl mx-auto">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-[460px] rounded-2xl" />
              ))}
            </div>
          ) : error || plans.length === 0 ? (
            <div className="text-center py-24 bg-card rounded-2xl border border-border max-w-2xl mx-auto">
              <h3 className="text-xl font-bold mb-2">Pricing is being updated</h3>
              <p className="text-muted-foreground mb-6">Talk to our team for a personalized quote.</p>
              <Button asChild>
                <Link href="/contact">Contact sales</Link>
              </Button>
            </div>
          ) : (
            <>
            {/* Mobile horizontal snap carousel */}
            <div className="md:hidden -mx-4 px-4 flex gap-3 overflow-x-auto no-scrollbar scroll-snap-x pb-2 pt-8" data-testid="pricing-grid-anchor">
              {displayPlans.map((dp, i) => {
                const plan = dp.plan;
                const isFree = Number(plan.price) === 0;
                return (
                  <div key={plan.id} className="shrink-0 snap-card w-[85%]">
                    <PricingCard
                      title={plan.name}
                      price={dp.displayPrice}
                      period={isFree ? "" : `/${dp.period === "yearly" ? "yr" : "mo"}`}
                      desc={plan.description ?? `Includes a ${plan.trialDays}-day free trial.`}
                      features={planFeatureRows(plan)}
                      href="/app/register"
                      btnText={isFree ? "Start free trial" : "Get started"}
                      isPopular={i === popularIdx}
                    />
                  </div>
                );
              })}
            </div>
            {/* Desktop grid */}
            <div className="hidden md:grid grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
              {displayPlans.map((dp, i) => {
                const plan = dp.plan;
                const isFree = Number(plan.price) === 0;
                return (
                  <PricingCard
                    key={plan.id}
                    title={plan.name}
                    price={dp.displayPrice}
                    period={isFree ? "" : `/${dp.period === "yearly" ? "yr" : "mo"}`}
                    desc={plan.description ?? `Includes a ${plan.trialDays}-day free trial.`}
                    features={planFeatureRows(plan)}
                    href="/app/register"
                    btnText={isFree ? "Start free trial" : "Get started"}
                    isPopular={i === popularIdx}
                  />
                );
              })}
            </div>
            </>
          )}

          {!isLoading && plans.length > 0 && (
            <div className="mt-12 md:mt-20">
              <div className="text-center max-w-3xl mx-auto mb-6 md:mb-10">
                <h2 className="font-serif text-2xl md:text-3xl font-bold mb-2 md:mb-3">Full feature comparison</h2>
                <p className="text-sm md:text-base text-muted-foreground">
                  Every module on KhanaLagao, grouped by category, with the plans that include it.
                </p>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-border bg-card max-w-6xl mx-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-5 py-3 font-semibold w-1/3">Feature</th>
                      {displayPlans.map((dp) => (
                        <th key={dp.plan.id} className="text-left px-5 py-3 font-semibold text-primary">{dp.plan.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PLAN_FEATURE_CATEGORIES
                      .map((cat) => ({ ...cat, features: PLAN_BOOLEAN_FEATURES.filter((f) => f.category === cat.key) }))
                      .filter((c) => c.features.length > 0)
                      .map((cat) => (
                        <Fragment key={cat.key}>
                          <tr className="bg-muted/30">
                            <td colSpan={1 + displayPlans.length} className="px-5 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              {cat.label}
                            </td>
                          </tr>
                          {cat.features.map((f, i) => (
                            <tr key={f.key} className={i % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                              <td className="px-5 py-2.5 font-medium">
                                <div>{f.label}</div>
                                <div className="text-xs text-muted-foreground leading-tight">{f.description}</div>
                              </td>
                              {displayPlans.map((dp) => {
                                const on = isFeatureEnabled(dp.plan.featureFlags, f.key);
                                return (
                                  <td key={dp.plan.id} className="px-5 py-2.5">
                                    {on ? (
                                      <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold"><Check className="h-4 w-4" /> Yes</span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-muted-foreground"><X className="h-4 w-4" /> No</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-12 md:mt-24 max-w-3xl mx-auto">
            <h2 className="font-serif text-2xl md:text-3xl font-bold text-center mb-6 md:mb-10">Frequently asked questions</h2>
            <div className="space-y-3 md:space-y-4">
              {FAQ_ITEMS.map((f) => (
                <div key={f.q} className="p-4 md:p-6 rounded-xl border border-border bg-card">
                  <h3 className="font-semibold text-sm md:text-base mb-1.5 md:mb-2">{f.q}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{f.a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}

function PricingCard({
  title,
  price,
  period,
  desc,
  features,
  href,
  btnText,
  isPopular = false,
  variant = "default",
}: {
  title: string;
  price: string;
  period: string;
  desc: string;
  features: PlanFeatureRow[];
  href: string;
  btnText: string;
  isPopular?: boolean;
  variant?: "default" | "outline";
}) {
  return (
    <div className={`relative h-full bg-card rounded-2xl border ${isPopular ? "border-primary shadow-xl md:scale-105 z-10" : "border-border shadow-md"} p-6 md:p-8 flex flex-col`} data-testid={`card-plan-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      {isPopular && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
          Most Popular
        </div>
      )}
      <div className="mb-6">
        <h3 className="text-xl font-bold font-serif mb-2">{title}</h3>
        <div className="flex items-baseline gap-1 mb-2">
          <span className="text-4xl font-bold">{price}</span>
          {period && <span className="text-muted-foreground">{period}</span>}
        </div>
        <p className="text-sm text-muted-foreground mb-5">{desc}</p>
        <a href={href} className="w-full block">
          <Button className="w-full" variant={variant} size="lg" data-testid={`btn-plan-top-${title.toLowerCase().replace(/\s+/g, "-")}`}>{btnText}</Button>
        </a>
      </div>

      <div className="flex-grow space-y-3 mb-8">
        {features.map((row, i) => (
          <div key={i} className="flex items-start gap-3">
            {row.enabled ? (
              <Check className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            ) : (
              <span className="h-5 w-5 flex-shrink-0 mt-0.5 flex items-center justify-center text-muted-foreground/60">—</span>
            )}
            <span className={`text-sm ${row.muted ? "text-muted-foreground/70 line-through decoration-muted-foreground/40" : ""}`}>
              {row.label}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-auto">
        <a href={href} className="w-full block">
          <Button className="w-full" variant={variant} size="lg">{btnText}</Button>
        </a>
      </div>
    </div>
  );
}
