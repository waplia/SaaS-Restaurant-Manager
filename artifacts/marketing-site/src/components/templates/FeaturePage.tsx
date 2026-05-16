import type { LucideIcon } from "lucide-react";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { PageHero } from "@/components/shared/PageHero";
import { FeatureGrid, type FeatureItem } from "@/components/shared/FeatureGrid";
import { HowItWorks, type Step } from "@/components/shared/HowItWorks";
import { Benefits, type Benefit } from "@/components/shared/Benefits";
import { FAQSection, type FAQ } from "@/components/shared/FAQSection";
import { CTASection } from "@/components/shared/CTASection";
import { RelatedModules, type RelatedItem } from "@/components/shared/RelatedModules";
import { ProductMockup, FloatingBadge, MetricBadge } from "@/components/shared/ProductMockup";
import { useSeo } from "@/lib/seo";
import { Sparkles, type LucideIcon as LIcon } from "lucide-react";

export interface FeaturePageContent {
  slug: string;
  category: string; // e.g. "Sell", "Inventory"
  eyebrow?: string;
  title: string;
  tagline: string;
  description: string;
  seoTitle?: string;
  seoDesc?: string;
  problem: { title: string; points: string[] };
  solution: { title: string; body: string };
  features: FeatureItem[];
  howItWorks: { title?: string; subtitle?: string; steps: Step[] };
  benefits: { title: string; items: Benefit[] };
  mockup?: "dashboard" | "pos" | "mobile" | "kds" | "report" | "chat";
  mockupBadges?: { icon: LIcon; label: string; value: string; pos: string }[];
  useCases: string[];
  related: RelatedItem[];
  faqs: FAQ[];
}

export function FeaturePage({ content }: { content: FeaturePageContent }) {
  useSeo({
    title: content.seoTitle ?? `${content.title} | KhanaLagao`,
    description: content.seoDesc ?? content.description,
    breadcrumbs: [
      { label: "Home", href: "/" },
      { label: "Features", href: "/features" },
      { label: content.title },
    ],
    schema: [
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: `KhanaLagao ${content.title}`,
        description: content.description,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, iOS, Android, Windows",
        offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
        brand: { "@type": "Brand", name: "KhanaLagao" },
      },
      ...(content.faqs && content.faqs.length > 0
        ? [
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: content.faqs.map((f) => ({
                "@type": "Question",
                name: f.q,
                acceptedAnswer: { "@type": "Answer", text: f.a },
              })),
            },
          ]
        : []),
    ],
  });

  return (
    <SiteLayout>
      <PageHero
        breadcrumbs={[{ label: "Features", href: "/features" }, { label: content.category, href: "/features" }, { label: content.title }]}
        eyebrow={content.eyebrow ?? content.category}
        title={<>{content.title.split(" ").slice(0, -2).join(" ")} <span className="text-primary">{content.title.split(" ").slice(-2).join(" ")}</span></>}
        subtitle={content.tagline}
        primaryCta={{ label: "Book a free demo", href: "/book-demo" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
        visual={
          <div className="relative">
            <ProductMockup kind={content.mockup ?? "dashboard"} title={content.title} />
            {content.mockupBadges?.map((b, i) => (
              <FloatingBadge key={i} className={b.pos} delay={0.3 + i * 0.12}>
                <MetricBadge icon={b.icon} label={b.label} value={b.value} />
              </FloatingBadge>
            ))}
          </div>
        }
      />

      {/* Problem */}
      <section className="py-16 md:py-20 bg-muted/30">
        <div className="container mx-auto px-4 md:px-6 max-w-4xl">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-3 text-center">The problem</p>
          <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight text-center mb-10">{content.problem.title}</h2>
          <ul className="grid md:grid-cols-2 gap-3">
            {content.problem.points.map((p, i) => (
              <li key={i} className="flex gap-3 p-5 rounded-xl border border-border bg-card">
                <span className="shrink-0 w-7 h-7 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center text-xs font-bold">!</span>
                <p className="text-sm leading-relaxed text-foreground/80">{p}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Solution */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4 md:px-6 max-w-4xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold mb-5">
            <Sparkles className="h-3 w-3" /> Our approach
          </div>
          <h2 className="font-serif text-3xl md:text-5xl font-bold tracking-tight mb-5">{content.solution.title}</h2>
          <p className="text-lg text-muted-foreground leading-relaxed">{content.solution.body}</p>
        </div>
      </section>

      <FeatureGrid eyebrow="What's included" title="Everything you need, nothing you don't" features={content.features} />

      <HowItWorks title={content.howItWorks.title} subtitle={content.howItWorks.subtitle} steps={content.howItWorks.steps} />

      <Benefits title={content.benefits.title} benefits={content.benefits.items} />

      {/* Use cases */}
      <section className="py-20 md:py-24 bg-muted/30">
        <div className="container mx-auto px-4 md:px-6 max-w-4xl">
          <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight text-center mb-10">Who it's for</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {content.useCases.map((uc, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-5 flex gap-3 items-start">
                <span className="shrink-0 w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center text-sm font-bold">{i + 1}</span>
                <p className="text-sm leading-relaxed">{uc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <RelatedModules items={content.related} />

      <FAQSection faqs={content.faqs} />

      <CTASection title={`Ready to upgrade your ${content.category.toLowerCase()}?`} subtitle={content.description} />
    </SiteLayout>
  );
}
