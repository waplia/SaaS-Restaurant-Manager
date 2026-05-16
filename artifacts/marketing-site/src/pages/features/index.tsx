import { useEffect, useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { useSeo } from "@/lib/seo";
import { FEATURE_CATEGORIES } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, ChevronRight, CheckCircle2 } from "lucide-react";
import { FAQSection } from "@/components/shared/FAQSection";

const FAQS = [
  { q: "Do I need every module or can I start small?", a: "Start with what you need today — POS, QR menu or online ordering — and switch on more modules as you grow. Pricing scales with what's actually turned on." },
  { q: "How do these features connect to each other?", a: "Every module shares the same menu, inventory, customers and reports. A sale in POS updates stock, accrues loyalty points, fires the kitchen ticket and lands in your live P&L automatically." },
  { q: "Will my staff need long training?", a: "Most outlets are live in under a week. Servers learn POS in a single shift, and the rest of the team gets role-based guides built into the app." },
  { q: "Can it handle multi-outlet brands?", a: "Yes. Central menus with outlet-level overrides, consolidated reports, role-based access and outlet-specific pricing are all built in." },
  { q: "What about offline mode?", a: "Billing, KOTs and order capture keep working when the internet drops, then sync automatically once you're back online." },
  { q: "Do you integrate with Zomato, Swiggy, accounting and payments?", a: "Yes — aggregators, payment gateways, accounting tools and many CRMs are supported out of the box. See the Integrations module for the full list." },
];

export default function FeaturesIndex() {
  useSeo({
    title: "All Features — KhanaLagao Restaurant OS",
    description: "Browse the complete KhanaLagao feature directory across Sell, Menu, Inventory, Customers, Growth, Khana AI, Staff, Finance, Operations, Marketplace and Reports.",
  });

  const [activeId, setActiveId] = useState<string>(FEATURE_CATEGORIES[0]?.id ?? "sell");

  // Smooth scroll to anchor on initial load (wouter doesn't handle hashes natively)
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash) {
      const el = document.getElementById(hash);
      if (el) {
        // Wait for layout
        setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
      }
    }
  }, []);

  // Spy active section while scrolling
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActiveId(visible.target.id);
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    FEATURE_CATEGORIES.forEach((c) => {
      const el = document.getElementById(c.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const totalFeatures = FEATURE_CATEGORIES.reduce((acc, c) => acc + c.features.length, 0);

  return (
    <SiteLayout>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_rgba(249,115,22,0.18),transparent_60%)]" />
        <div className="absolute top-0 right-1/4 w-[500px] h-[500px] rounded-full bg-primary/10 blur-3xl -z-10" />
        <div className="container mx-auto px-4 md:px-6 py-16 md:py-24 text-center max-w-4xl">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold mb-5">
            <Sparkles className="h-3 w-3" /> The complete restaurant OS
          </div>
          <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Every feature you need to run, grow and <span className="text-primary">automate</span> your restaurant
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-3xl mx-auto mb-8">
            {totalFeatures} modules across {FEATURE_CATEGORIES.length} categories — POS, kitchen, inventory, growth, staff, finance and Khana AI — all working together on one platform.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/book-demo">
              <Button size="lg" className="gap-2">Book a live demo <ArrowRight className="h-4 w-4" /></Button>
            </Link>
            <Link href="/pricing">
              <Button variant="outline" size="lg">See pricing</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Sticky category nav */}
      <div className="sticky top-16 z-30 bg-background/95 backdrop-blur-xl border-b border-border">
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex gap-1 overflow-x-auto py-2 no-scrollbar" data-testid="features-sticky-nav">
            {FEATURE_CATEGORIES.map((c) => (
              <a
                key={c.id}
                href={`#${c.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  const el = document.getElementById(c.id);
                  if (el) {
                    history.replaceState(null, "", `#${c.id}`);
                    el.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
                className={`shrink-0 inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full transition-colors ${
                  activeId === c.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
                data-testid={`features-nav-${c.id}`}
              >
                <c.icon className="h-3.5 w-3.5" />
                {c.title}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="py-12 md:py-16">
        {FEATURE_CATEGORIES.map((cat, idx) => (
          <section
            key={cat.id}
            id={cat.id}
            className={`scroll-mt-32 py-12 md:py-16 ${idx % 2 === 1 ? "bg-muted/30" : ""}`}
            data-testid={`features-section-${cat.id}`}
          >
            <div className="container mx-auto px-4 md:px-6">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10 max-w-5xl">
                <div className="flex items-start gap-4">
                  <span className="shrink-0 w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <cat.icon className="h-6 w-6" />
                  </span>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-primary mb-1">{cat.title}</p>
                    <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight mb-2">{cat.title} — built for restaurants</h2>
                    <p className="text-base text-muted-foreground max-w-2xl">{cat.description}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {cat.features.map((feat) => {
                  const href = feat.href ?? (feat.slug ? `/features/${feat.slug}` : "#");
                  return (
                    <Link key={feat.title} href={href}>
                      <motion.div
                        whileHover={{ y: -3 }}
                        className="group h-full p-6 rounded-2xl border border-border bg-card hover:shadow-lg hover:border-primary/40 transition-all"
                        data-testid={`feature-card-${feat.slug ?? feat.title.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-4">
                          <span className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                            <feat.icon className="h-5 w-5" />
                          </span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all mt-2" />
                        </div>
                        <h3 className="font-semibold text-lg mb-1.5 leading-tight">{feat.title}</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed mb-4 line-clamp-2">{feat.desc}</p>
                        <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>{feat.benefit}</span>
                        </div>
                      </motion.div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* CTA band */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div className="rounded-3xl bg-gradient-to-br from-primary/90 to-orange-500 text-primary-foreground p-10 md:p-14 text-center">
            <h2 className="font-serif text-3xl md:text-5xl font-bold tracking-tight mb-4">One platform. Every module. Built for restaurants.</h2>
            <p className="text-lg opacity-90 max-w-2xl mx-auto mb-8">See how every feature connects in a 30-minute live demo with one of our restaurant specialists.</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/book-demo">
                <Button size="lg" variant="secondary" className="gap-2">Book a live demo <ArrowRight className="h-4 w-4" /></Button>
              </Link>
              <Link href="/pricing">
                <Button size="lg" variant="outline" className="bg-transparent text-primary-foreground border-primary-foreground/40 hover:bg-primary-foreground/10">
                  See pricing
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <FAQSection faqs={FAQS} />
    </SiteLayout>
  );
}
