import { Link } from "wouter";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { CTASection } from "@/components/shared/CTASection";
import { useSeo } from "@/lib/seo";
import { Newspaper, HelpCircle, BookMarked, Scale, Award, ShieldCheck, ArrowRight, Sparkles } from "lucide-react";

const SECTIONS = [
  { icon: Newspaper, title: "Blog", desc: "Stories, playbooks and product updates for modern restaurant operators.", href: "/blog" },
  { icon: BookMarked, title: "Guides", desc: "Step-by-step owner playbooks — POS migration, opening a cloud kitchen, hiring captains.", href: "/guides" },
  { icon: HelpCircle, title: "Help Center", desc: "Documentation for setting up, running and scaling KhanaLagao.", href: "/help" },
  { icon: HelpCircle, title: "FAQs", desc: "Quick answers to the questions operators ask before signing up.", href: "/faq" },
  { icon: Scale, title: "Compare", desc: "How KhanaLagao stacks up against legacy POS and aggregator-only tools.", href: "/compare" },
  { icon: Award, title: "Case Studies", desc: "Real customers — what they switched from, what changed, what the numbers say.", href: "/case-studies" },
  { icon: ShieldCheck, title: "Security", desc: "How we protect your data — encryption, isolation, audits and compliance.", href: "/security" },
];

export default function Resources() {
  useSeo({
    title: "Resources — KhanaLagao",
    description: "Blog, guides, help center, FAQs, comparisons, case studies and security — everything you need to evaluate, deploy and scale KhanaLagao.",
  });
  return (
    <SiteLayout>
      <section className="pt-20 md:pt-28 pb-12">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold mb-5">
            <Sparkles className="h-3 w-3" /> Resources
          </div>
          <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-5">
            Learn, compare, decide — <span className="text-primary">on your terms.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
            Everything you need to evaluate KhanaLagao and run your restaurant smarter.
          </p>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 md:px-6 max-w-6xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {SECTIONS.map((s) => (
              <Link key={s.href} href={s.href} className="group rounded-2xl border border-border bg-card p-6 hover:border-primary/40 hover:shadow-md transition-all">
                <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <s.icon className="h-5 w-5" />
                </div>
                <h3 className="font-serif text-xl font-bold mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-3">{s.desc}</p>
                <span className="text-sm font-medium text-primary inline-flex items-center gap-1">
                  Open <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <CTASection title="Ready to see it live?" subtitle="Book a 30-minute demo tailored to your concept." primary={{ label: "Book a free demo", href: "/book-demo" }} secondary={{ label: "Contact us", href: "/contact" }} />
    </SiteLayout>
  );
}
