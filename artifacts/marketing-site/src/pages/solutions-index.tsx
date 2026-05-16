import { Link } from "wouter";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { CTASection } from "@/components/shared/CTASection";
import { useSeo } from "@/lib/seo";
import { SOLUTIONS_MENU } from "@/lib/navigation";
import { Sparkles, ArrowRight } from "lucide-react";

export default function SolutionsIndex() {
  useSeo({
    title: "Solutions — KhanaLagao for every kind of food business",
    description: "Tailored playbooks for restaurants, cafes, cloud kitchens, bakeries, hotels, food courts, tiffin services, catering, franchise chains and corporate canteens.",
  });

  const links = SOLUTIONS_MENU.links ?? [];

  return (
    <SiteLayout>
      <section className="pt-20 md:pt-28 pb-12">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold mb-5">
            <Sparkles className="h-3 w-3" /> Solutions
          </div>
          <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-5">
            Built for <span className="text-primary">every kind of food business.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
            Same platform, tailored playbook. Pick the concept that matches yours to see exactly how KhanaLagao fits.
          </p>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 md:px-6 max-w-6xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="group rounded-2xl border border-border bg-card p-6 hover:border-primary/40 hover:shadow-md transition-all">
                <div className="flex items-center gap-3 mb-3">
                  {l.icon && (
                    <span className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      <l.icon className="h-5 w-5" />
                    </span>
                  )}
                  <h3 className="font-serif text-xl font-bold">{l.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">{l.desc}</p>
                <span className="text-sm font-medium text-primary inline-flex items-center gap-1">
                  Explore <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <CTASection title="Not sure which fits?" subtitle="Talk to our team — we'll match the platform to your concept in a 30-minute call." />
    </SiteLayout>
  );
}
