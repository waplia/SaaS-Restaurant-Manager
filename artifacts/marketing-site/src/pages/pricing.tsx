import { useSeo } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Link } from "wouter";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PLAN_BOOLEAN_FEATURES, PLAN_QUANTITY_FEATURES,
  isFeatureEnabled, formatQuantity,
} from "@workspace/db/planFeatures";

interface PublicPlan {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  price: string;
  currency: "INR" | "USD";
  billingPeriod: "monthly" | "yearly";
  trialDays: number;
  maxRestaurants: number;
  maxBranches: number;
  maxStaff: number;
  maxTables: number;
  maxMenuItems: number;
  features: string[] | null;
  featureFlags: Record<string, boolean> | null;
  isActive: boolean;
}

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

function currencySymbol(c: string) {
  return c === "USD" ? "$" : "₹";
}

function formatPrice(plan: PublicPlan) {
  const n = Number(plan.price);
  if (!Number.isFinite(n)) return plan.price;
  if (n === 0) return "Free";
  return `${currencySymbol(plan.currency)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

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
  useSeo({
    title: "Pricing",
    description: "Simple, transparent pricing for restaurants of all sizes.",
    schema: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ_ITEMS.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  });

  const { data: plans, isLoading, error } = useQuery<PublicPlan[]>({
    queryKey: ["public-plans"],
    queryFn: async () => {
      const res = await fetch("/api/marketing/plans");
      if (!res.ok) throw new Error("Failed to fetch plans");
      return res.json();
    },
  });

  const sorted = (plans ?? []).slice().sort((a, b) => Number(a.price) - Number(b.price));
  const popularIdx = sorted.length >= 2 ? Math.floor(sorted.length / 2) : -1;

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Header />
      <main className="flex-grow pt-24 pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-6">
              Simple, transparent pricing.
            </h1>
            <p className="text-xl text-muted-foreground">
              No hidden fees. No long-term contracts. Just the tools you need to run your restaurant.
            </p>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[460px] rounded-2xl" />
              ))}
            </div>
          ) : error || sorted.length === 0 ? (
            <div className="text-center py-24 bg-card rounded-2xl border border-border max-w-2xl mx-auto">
              <h3 className="text-xl font-bold mb-2">Pricing is being updated</h3>
              <p className="text-muted-foreground mb-6">Talk to our team for a personalized quote.</p>
              <Button asChild>
                <Link href="/contact">Contact sales</Link>
              </Button>
            </div>
          ) : (
            <div className={`grid grid-cols-1 ${sorted.length >= 3 ? "md:grid-cols-3" : sorted.length === 2 ? "md:grid-cols-2" : "md:grid-cols-1 max-w-md"} gap-8 max-w-6xl mx-auto`} data-testid="pricing-grid-anchor">
              {sorted.map((plan, i) => (
                <PricingCard
                  key={plan.id}
                  title={plan.name}
                  price={formatPrice(plan)}
                  period={Number(plan.price) === 0 ? "" : `/${plan.billingPeriod === "yearly" ? "yr" : "mo"}`}
                  desc={plan.description ?? `Includes a ${plan.trialDays}-day free trial.`}
                  features={planFeatureRows(plan)}
                  href="/app/register"
                  btnText={Number(plan.price) === 0 ? "Start free trial" : "Get started"}
                  isPopular={i === popularIdx}
                />
              ))}
            </div>
          )}

          <div className="mt-24 max-w-3xl mx-auto">
            <h2 className="font-serif text-3xl font-bold text-center mb-10">Frequently asked questions</h2>
            <div className="space-y-4">
              {FAQ_ITEMS.map((f) => (
                <div key={f.q} className="p-6 rounded-xl border border-border bg-card">
                  <h3 className="font-semibold mb-2">{f.q}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{f.a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
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
    <div className={`relative bg-card rounded-2xl border ${isPopular ? "border-primary shadow-xl md:scale-105 z-10" : "border-border shadow-md"} p-8 flex flex-col`} data-testid={`card-plan-${title.toLowerCase().replace(/\s+/g, "-")}`}>
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
        <p className="text-sm text-muted-foreground">{desc}</p>
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
