import { Link } from "wouter";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { CTASection } from "@/components/shared/CTASection";
import { useSeo } from "@/lib/seo";
import { CASE_STUDIES } from "@/lib/caseStudies";
import { ArrowRight, Sparkles } from "lucide-react";

export default function CaseStudies() {
  useSeo({
    title: "Case Studies | KhanaLagao",
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
            {CASE_STUDIES.map((s) => {
              const Icon = s.icon;
              return (
                <Link key={s.slug} href={`/case-studies/${s.slug}`} className="group rounded-2xl border border-border bg-card p-6 md:p-7 hover:border-primary/40 hover:shadow-md transition-all">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Icon className="h-5 w-5" /></span>
                    <div>
                      <p className="text-sm font-semibold">{s.brand}</p>
                      <p className="text-xs uppercase tracking-widest font-medium text-muted-foreground">{s.segment} · {s.location}</p>
                    </div>
                  </div>
                  <h3 className="font-serif text-xl md:text-2xl font-bold mb-2 group-hover:text-primary transition-colors">{s.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-5">{s.summary}</p>
                  <div className="grid grid-cols-3 gap-3 pt-4 border-t border-border">
                    {s.metrics.map((m) => (
                      <div key={m.v}>
                        <p className="font-serif text-xl font-bold text-primary">{m.k}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{m.v}</p>
                      </div>
                    ))}
                  </div>
                  <span className="text-sm font-medium text-primary inline-flex items-center gap-1 mt-5">Read the full story <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" /></span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <CTASection title="Want to be our next case study?" subtitle="Book a demo, get onboarded, and we'll measure the change together." />
    </SiteLayout>
  );
}
