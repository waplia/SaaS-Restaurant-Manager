import { useSeo } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    q: "Does TableTrack work offline?",
    a: "Yes. Billing and KOTs continue to print during internet outages and sync automatically once you're back online.",
  },
  {
    q: "Do you support multi-outlet brands?",
    a: "The Multi-Outlet plan is built for chains: centralized menus, branch-level overrides, role-based access, and consolidated reporting across every location.",
  },
  {
    q: "What does onboarding look like?",
    a: "Most single outlets are live in under a week — including menu setup, hardware configuration, staff training, and live support during your first service.",
  },
  {
    q: "Which payment methods are supported?",
    a: "Card, UPI, wallets, cash, and split payments are supported out of the box. Specific gateway integrations vary by region — talk to us for your market.",
  },
];

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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto" data-testid="pricing-grid-anchor">
            <PricingCard 
              title="Starter"
              price="$79"
              desc="Perfect for small cafes and independent venues."
              features={[
                "1 POS Terminal",
                "Basic Inventory",
                "Standard Reporting",
                "Email Support",
                "QR Menu (View Only)"
              ]}
              href="/app/register"
              btnText="Start free trial"
            />
            
            <PricingCard 
              title="Growth"
              price="$149"
              desc="For busy restaurants ready to optimize and scale."
              isPopular
              features={[
                "3 POS Terminals",
                "Advanced Inventory",
                "Custom Reporting",
                "24/7 Priority Support",
                "QR Menu Ordering",
                "Online Ordering",
                "Staff Management"
              ]}
              href="/app/register"
              btnText="Start free trial"
            />
            
            <PricingCard 
              title="Scale"
              price="Custom"
              desc="For multi-outlet chains with complex requirements."
              features={[
                "Unlimited Terminals",
                "Enterprise Inventory",
                "API Access",
                "Dedicated Account Manager",
                "Custom Integrations",
                "Multi-outlet Analytics",
                "White-label Options"
              ]}
              href="/contact"
              btnText="Contact Sales"
              variant="outline"
            />
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
  desc, 
  features, 
  href, 
  btnText, 
  isPopular = false,
  variant = "default"
}: { 
  title: string;
  price: string;
  desc: string;
  features: string[];
  href: string;
  btnText: string;
  isPopular?: boolean;
  variant?: "default" | "outline";
}) {
  return (
    <div className={`relative bg-card rounded-2xl border ${isPopular ? 'border-primary shadow-xl scale-105 z-10' : 'border-border shadow-md'} p-8 flex flex-col`}>
      {isPopular && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
          Most Popular
        </div>
      )}
      <div className="mb-6">
        <h3 className="text-xl font-bold font-serif mb-2">{title}</h3>
        <div className="flex items-baseline gap-1 mb-2">
          <span className="text-4xl font-bold">{price}</span>
          {price !== "Custom" && <span className="text-muted-foreground">/mo</span>}
        </div>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
      
      <div className="flex-grow space-y-4 mb-8">
        {features.map((feature, i) => (
          <div key={i} className="flex items-center gap-3">
            <Check className="h-5 w-5 text-primary flex-shrink-0" />
            <span className="text-sm">{feature}</span>
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
