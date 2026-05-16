import { SiteLayout } from "@/components/layout/SiteLayout";
import { PageHero } from "@/components/shared/PageHero";
import { FeatureGrid, type FeatureItem } from "@/components/shared/FeatureGrid";
import { HowItWorks, type Step } from "@/components/shared/HowItWorks";
import { Benefits, type Benefit } from "@/components/shared/Benefits";
import { FAQSection, type FAQ } from "@/components/shared/FAQSection";
import { CTASection } from "@/components/shared/CTASection";
import { ProductMockup } from "@/components/shared/ProductMockup";
import { useSeo } from "@/lib/seo";

export interface AIPageContent {
  slug: string;
  shortName: string;
  title: string;
  tagline: string;
  seoTitle?: string;
  seoDesc?: string;
  features: FeatureItem[];
  steps: Step[];
  benefits: Benefit[];
  mockup?: "dashboard" | "pos" | "mobile" | "kds" | "report" | "chat";
  faqs: FAQ[];
}

export function AIPage({ content }: { content: AIPageContent }) {
  useSeo({
    title: content.seoTitle ?? `${content.title} | Khana AI`,
    description: content.seoDesc ?? content.tagline,
    breadcrumbs: [
      { label: "Home", href: "/" },
      { label: "Khana AI", href: "/khana-ai" },
      { label: content.shortName },
    ],
    schema: [
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: `Khana AI — ${content.shortName}`,
        description: content.tagline,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, iOS, Android",
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
        variant="dark"
        breadcrumbs={[{ label: "Khana AI", href: "/khana-ai" }, { label: content.shortName }]}
        eyebrow="Khana AI"
        title={<>{content.title}</>}
        subtitle={content.tagline}
        primaryCta={{ label: "Book a demo", href: "/book-demo" }}
        secondaryCta={{ label: "See AI credits", href: "/khana-ai/credits" }}
        visual={<ProductMockup kind={content.mockup ?? "chat"} title={`Khana AI · ${content.shortName}`} />}
      />
      <FeatureGrid title="What it can do" features={content.features} variant="default" />
      <HowItWorks title="How it works" steps={content.steps} />
      <Benefits title="Why restaurants love it" benefits={content.benefits} />
      <FAQSection faqs={content.faqs} />
      <CTASection title={`Try ${content.title} in your restaurant`} eyebrow="Khana AI" />
    </SiteLayout>
  );
}
