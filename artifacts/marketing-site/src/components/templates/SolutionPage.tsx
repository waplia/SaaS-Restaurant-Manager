import type { LucideIcon } from "lucide-react";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { PageHero } from "@/components/shared/PageHero";
import { FeatureGrid, type FeatureItem } from "@/components/shared/FeatureGrid";
import { HowItWorks, type Step } from "@/components/shared/HowItWorks";
import { Benefits, type Benefit } from "@/components/shared/Benefits";
import { FAQSection, type FAQ } from "@/components/shared/FAQSection";
import { CTASection } from "@/components/shared/CTASection";
import { ProductMockup } from "@/components/shared/ProductMockup";
import { Link } from "wouter";
import { ArrowRight, Check, Quote } from "lucide-react";
import { useSeo } from "@/lib/seo";

export interface SolutionPageContent {
  slug: string;
  industryLabel: string;
  hero: { eyebrow: string; title: string; tagline: string; mockup?: "dashboard" | "pos" | "mobile" | "kds" | "report" | "chat" };
  seoTitle?: string;
  seoDesc?: string;
  painPoints: { title: string; items: { title: string; desc: string; icon: LucideIcon }[] };
  modules: { title: string; items: { name: string; href: string; desc: string }[] };
  workflow: { title?: string; subtitle?: string; steps: Step[] };
  benefits: { title: string; items: Benefit[] };
  features?: FeatureItem[];
  scenario: { restaurantName: string; quote: string; result: string };
  faqs: FAQ[];
}

export function SolutionPage({ content }: { content: SolutionPageContent }) {
  useSeo({
    title: content.seoTitle ?? `KhanaLagao for ${content.industryLabel}`,
    description: content.seoDesc ?? content.hero.tagline,
    breadcrumbs: [
      { label: "Home", href: "/" },
      { label: "Solutions", href: "/solutions" },
      { label: content.industryLabel },
    ],
    schema: content.faqs && content.faqs.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: content.faqs.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }
      : undefined,
  });
  return (
    <SiteLayout>
      <PageHero
        breadcrumbs={[{ label: "Solutions", href: "/solutions" }, { label: content.industryLabel }]}
        eyebrow={content.hero.eyebrow}
        title={<>The KhanaLagao OS for <span className="text-primary">{content.industryLabel}</span></>}
        subtitle={content.hero.tagline}
        primaryCta={{ label: "Book a demo", href: "/book-demo" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
        visual={<ProductMockup kind={content.hero.mockup ?? "dashboard"} title={content.industryLabel} />}
      />

      {/* Pain Points */}
      <section className="py-20 md:py-24 bg-muted/30">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl">
          <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight text-center mb-12">{content.painPoints.title}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {content.painPoints.items.map(p => (
              <div key={p.title} className="rounded-2xl border border-border bg-card p-6">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center mb-4">
                  <p.icon className="h-5 w-5" />
                </div>
                <h3 className="font-bold mb-2">{p.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Recommended Modules */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-3 text-center">Built-in</p>
          <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight text-center mb-10">{content.modules.title}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {content.modules.items.map(m => (
              <Link key={m.href} href={m.href} className="group rounded-xl border border-border bg-card p-5 hover:border-primary/40 hover:shadow-md transition-all flex items-start gap-3">
                <Check className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold flex items-center gap-1.5 group-hover:text-primary">
                    {m.name} <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed mt-0.5">{m.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <HowItWorks title={content.workflow.title ?? "How a typical day looks"} subtitle={content.workflow.subtitle} steps={content.workflow.steps} />

      <Benefits title={content.benefits.title} benefits={content.benefits.items} />

      {content.features && content.features.length > 0 && (
        <FeatureGrid eyebrow="Highlights" title={`Designed for ${content.industryLabel.toLowerCase()}`} features={content.features} />
      )}

      {/* Case-style scenario */}
      <section className="py-20 md:py-24 bg-foreground text-background">
        <div className="container mx-auto px-4 md:px-6 max-w-3xl text-center">
          <Quote className="h-10 w-10 text-primary mx-auto mb-5" />
          <p className="font-serif text-2xl md:text-3xl leading-relaxed mb-6">"{content.scenario.quote}"</p>
          <p className="text-background/70 text-sm">— {content.scenario.restaurantName}</p>
          <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/15 text-primary px-4 py-2 text-sm font-semibold">
            {content.scenario.result}
          </div>
        </div>
      </section>

      <FAQSection faqs={content.faqs} />

      <CTASection title={`Built for ${content.industryLabel.toLowerCase()} that mean business`} />
    </SiteLayout>
  );
}
