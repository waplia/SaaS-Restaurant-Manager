import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Check, ArrowRight } from "lucide-react";

interface PlanPreview {
  name: string;
  tagline: string;
  monthly: number | string;
  yearly: number | string;
  features: string[];
  popular?: boolean;
  ctaLabel?: string;
  ctaHref?: string;
}

const PLANS: PlanPreview[] = [
  {
    name: "Starter",
    tagline: "Single outlet getting started.",
    monthly: 999,
    yearly: 9990,
    features: ["1 outlet", "POS & QR menu", "Basic inventory", "Daily reports", "Email support"],
  },
  {
    name: "Growth",
    tagline: "For busy independent restaurants.",
    monthly: 2499,
    yearly: 24990,
    features: ["1 outlet", "Everything in Starter", "Recipe inventory", "Loyalty & campaigns", "Khana AI lite", "Priority chat support"],
    popular: true,
  },
  {
    name: "Pro",
    tagline: "Multi-outlet brands and chains.",
    monthly: 4999,
    yearly: 49990,
    features: ["Up to 5 outlets", "Everything in Growth", "Central menu & inventory", "Franchise reports", "Full Khana AI", "Phone + chat support"],
  },
  {
    name: "Enterprise",
    tagline: "Large chains & franchises.",
    monthly: "Custom",
    yearly: "Custom",
    features: ["Unlimited outlets", "Dedicated success manager", "Custom integrations", "SSO & advanced roles", "SLA-backed support"],
    ctaLabel: "Talk to sales",
    ctaHref: "/contact",
  },
];

function format(n: number | string) {
  return typeof n === "number" ? `₹${n.toLocaleString("en-IN")}` : n;
}

export function PricingPreview() {
  const [yearly, setYearly] = useState(false);

  return (
    <section className="py-24 bg-background">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-3xl mx-auto mb-10">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary mb-4">
            Pricing
          </div>
          <h2 className="font-serif text-3xl md:text-5xl font-bold mb-5">Plans for every stage of your restaurant.</h2>
          <p className="text-lg text-muted-foreground mb-7">Start free for 14 days. Upgrade only when you're ready.</p>
          <div className="inline-flex items-center gap-3 rounded-full border border-border bg-card p-1">
            <button
              onClick={() => setYearly(false)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${!yearly ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              data-testid="btn-pricing-monthly"
            >
              Monthly
            </button>
            <button
              onClick={() => setYearly(true)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${yearly ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              data-testid="btn-pricing-yearly"
            >
              Yearly <span className="text-xs opacity-80">· save 16%</span>
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
          {PLANS.map(plan => (
            <div
              key={plan.name}
              className={`relative rounded-2xl border bg-card p-7 flex flex-col ${plan.popular ? "border-primary shadow-xl md:scale-[1.02]" : "border-border"}`}
            >
              {plan.popular && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  Most popular
                </div>
              )}
              <h3 className="text-lg font-bold font-serif mb-1">{plan.name}</h3>
              <p className="text-sm text-muted-foreground mb-5">{plan.tagline}</p>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-3xl font-bold">{format(yearly ? plan.yearly : plan.monthly)}</span>
                {typeof (yearly ? plan.yearly : plan.monthly) === "number" && (
                  <span className="text-sm text-muted-foreground">/{yearly ? "yr" : "mo"}</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mb-5">Per outlet · billed {yearly ? "yearly" : "monthly"}</p>
              <ul className="space-y-2 mb-6 flex-1">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link href={plan.ctaHref ?? "/book-demo"}>
                <Button className="w-full" variant={plan.popular ? "default" : "outline"}>
                  {plan.ctaLabel ?? "Book Demo"}
                </Button>
              </Link>
            </div>
          ))}
        </div>

        <div className="text-center mt-10">
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
