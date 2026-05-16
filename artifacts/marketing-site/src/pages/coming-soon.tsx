import { Link } from "wouter";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { Button } from "@/components/ui/button";
import { useSeo } from "@/lib/seo";
import { Sparkles, ArrowRight } from "lucide-react";

interface Props {
  title: string;
  description: string;
  eyebrow?: string;
}

export function ComingSoonPage({ title, description, eyebrow = "Coming soon" }: Props) {
  useSeo({ title, description });
  return (
    <SiteLayout>
      <section className="py-16 md:py-32">
        <div className="container mx-auto px-4 md:px-6 max-w-3xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold mb-5">
            <Sparkles className="h-3 w-3" /> {eyebrow}
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight mb-5">{title}</h1>
          <p className="text-lg text-muted-foreground leading-relaxed mb-10">{description}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/book-demo">
              <Button size="lg" className="gap-2">Book a free demo <ArrowRight className="h-4 w-4" /></Button>
            </Link>
            <Link href="/features">
              <Button variant="outline" size="lg">Explore all features</Button>
            </Link>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

export default function ComingSoon() {
  return (
    <ComingSoonPage
      title="This page is on the way"
      description="We're polishing the details on this section. In the meantime, explore our platform, book a demo, or browse the full feature directory."
    />
  );
}
