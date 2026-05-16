import { Link } from "wouter";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { CTASection } from "@/components/shared/CTASection";
import { useSeo } from "@/lib/seo";
import { ArrowRight, TrendingUp, Coffee, ChefHat, Hotel, Cake, Building2, Sparkles } from "lucide-react";

const STORIES = [
  {
    icon: Coffee,
    brand: "Cafe chain · 6 outlets · Jaipur",
    title: "From 4 different tools to one — and 22% faster billing",
    body: "Replaced a legacy POS, a separate QR ordering tool, an inventory spreadsheet and an aggregator dashboard with KhanaLagao. Captains bill 22% faster, food cost dropped from 34% to 31% in 3 months.",
    metrics: [{ k: "22%", v: "faster billing" }, { k: "−3%", v: "food cost" }, { k: "6", v: "outlets unified" }],
  },
  {
    icon: ChefHat,
    brand: "Cloud kitchen · 3 brands · Delhi NCR",
    title: "Khana AI cut over-prep by 18%",
    body: "Used AI forecasting to predict daily prep by item. Reduced over-prep by 18%, and unlocked a clean view of profitability per brand sharing the same kitchen.",
    metrics: [{ k: "−18%", v: "over-prep" }, { k: "3", v: "brands, 1 KDS" }, { k: "4.7★", v: "avg rating" }],
  },
  {
    icon: Hotel,
    brand: "Hotel · 80 keys · Udaipur",
    title: "F&B + room posting reconciled in real time",
    body: "Migrated 4 outlets (restaurant, bar, banquet, room service) onto one platform with PMS sync. Night audit time dropped from 3 hours to under 45 minutes.",
    metrics: [{ k: "75%", v: "less night-audit time" }, { k: "4", v: "outlets connected" }, { k: "100%", v: "PMS sync" }],
  },
  {
    icon: Cake,
    brand: "Bakery · 12 outlets · South India",
    title: "Pre-orders, batches and wastage — finally under control",
    body: "Standardized recipes, batched production by demand, and tied wastage logs to weekly P&L. Wastage cost halved within two months.",
    metrics: [{ k: "−51%", v: "wastage cost" }, { k: "12", v: "outlets live" }, { k: "1 day", v: "menu rollout" }],
  },
  {
    icon: Building2,
    brand: "QSR franchise · 40 outlets · Pan-India",
    title: "Multi-outlet rollout in 6 weeks",
    body: "Franchise headquarters runs menu, pricing, campaigns and reports centrally. Franchisees stay in control of staff, inventory and local promos.",
    metrics: [{ k: "6 wk", v: "rollout" }, { k: "40", v: "outlets" }, { k: "1", v: "menu source" }],
  },
  {
    icon: TrendingUp,
    brand: "Fine dining · Single outlet · Mumbai",
    title: "Doubled repeat visits with a smart loyalty program",
    body: "Replaced punch-card loyalty with KhanaLagao tier-based memberships, post-meal feedback and AI review booster. Repeat visit share grew from 24% to 52% over six months.",
    metrics: [{ k: "2×", v: "repeat visits" }, { k: "+1.2", v: "Google rating delta" }, { k: "92%", v: "feedback response" }],
  },
];

export default function CaseStudies() {
  useSeo({
    title: "Case Studies — KhanaLagao",
    description: "Real restaurants, cafes, cloud kitchens, hotels and franchises share what changed after moving to KhanaLagao.",
  });
  return (
    <SiteLayout>
      <section className="pt-14 md:pt-28 pb-10">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold mb-5">
            <Sparkles className="h-3 w-3" /> Case studies
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight mb-5">
            Real operators. <span className="text-primary">Real numbers.</span>
          </h1>
          <p className="text-base md:text-xl text-muted-foreground max-w-3xl mx-auto">
            Stories from customers who moved their operations onto KhanaLagao — what they switched from, what changed, and what the numbers say.
          </p>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 md:px-6 max-w-6xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {STORIES.map((s) => (
              <Link key={s.title} href="/contact" className="group rounded-2xl border border-border bg-card p-6 md:p-7 hover:border-primary/40 hover:shadow-md transition-all">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><s.icon className="h-5 w-5" /></span>
                  <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground">{s.brand}</p>
                </div>
                <h3 className="font-serif text-xl md:text-2xl font-bold mb-2 group-hover:text-primary transition-colors">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-5">{s.body}</p>
                <div className="grid grid-cols-3 gap-3 pt-4 border-t border-border">
                  {s.metrics.map((m) => (
                    <div key={m.v}>
                      <p className="font-serif text-xl font-bold text-primary">{m.k}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{m.v}</p>
                    </div>
                  ))}
                </div>
                <span className="text-sm font-medium text-primary inline-flex items-center gap-1 mt-5">Talk to a similar operator <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" /></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <CTASection title="Want to be our next case study?" subtitle="Book a demo, get onboarded, and we'll measure the change together." />
    </SiteLayout>
  );
}
