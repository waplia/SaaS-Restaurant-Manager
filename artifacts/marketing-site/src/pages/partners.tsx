import { SiteLayout } from "@/components/layout/SiteLayout";
import { LeadForm } from "@/components/LeadForm";
import { CTASection } from "@/components/shared/CTASection";
import { useSeo } from "@/lib/seo";
import { COMPANY } from "@/lib/company";
import { Handshake, Plug, BookOpen, Users, IndianRupee, Award, Sparkles, ArrowRight } from "lucide-react";

const TRACKS = [
  {
    icon: Handshake,
    title: "Resellers & Implementation",
    body: "Sell, onboard and support KhanaLagao in your city. Earn recurring commissions and unlock co-marketing.",
    perks: ["Recurring revenue share", "Dedicated onboarding support", "Co-branded marketing assets", "Lead routing in your region"],
  },
  {
    icon: Plug,
    title: "Integration Partners",
    body: "Build on the KhanaLagao Marketplace — aggregators, payments, accounting, hardware, loyalty and more.",
    perks: ["Public marketplace listing", "Stable APIs & webhooks", "Joint go-to-market", "Customer co-selling"],
  },
  {
    icon: Award,
    title: "Hospitality Consultants",
    body: "Refer KhanaLagao to your clients and add a modern restaurant OS to your consulting toolkit.",
    perks: ["Referral commissions", "Priority demo slots", "Free sandbox accounts", "Direct line to product team"],
  },
];

const BENEFITS = [
  { icon: IndianRupee, label: "Generous, recurring commercials" },
  { icon: Users, label: "Dedicated partner success manager" },
  { icon: BookOpen, label: "Training, certification & playbooks" },
  { icon: Plug, label: "Open APIs and partner sandbox" },
];

export default function Partners() {
  useSeo({
    title: "Partner Program — KhanaLagao",
    description: `Resell, integrate or refer KhanaLagao. Build a recurring revenue stream with ${COMPANY.legalName}.`,
  });
  return (
    <SiteLayout>
      <section className="pt-20 md:pt-28 pb-12">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold mb-5">
            <Sparkles className="h-3 w-3" /> Partner program
          </div>
          <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-5">
            Grow with the <span className="text-primary">KhanaLagao platform.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
            Resell, integrate, or refer — build a recurring business on top of India's modern restaurant OS.
          </p>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 md:px-6 max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {TRACKS.map((t) => (
              <div key={t.title} className="rounded-2xl border border-border bg-card p-7 flex flex-col">
                <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <t.icon className="h-5 w-5" />
                </div>
                <h3 className="font-serif text-xl font-bold mb-2">{t.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-5">{t.body}</p>
                <ul className="space-y-2 text-sm mt-auto">
                  {t.perks.map((p) => (
                    <li key={p} className="flex gap-2 items-start"><span className="text-primary font-bold">✓</span>{p}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 md:py-16 bg-muted/30 border-y border-border">
        <div className="container mx-auto px-4 md:px-6 max-w-6xl grid lg:grid-cols-2 gap-12 items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-3">Why partner with us</p>
            <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight mb-5">A real product. Real revenue. Real support.</h2>
            <p className="text-muted-foreground leading-relaxed mb-6">
              {COMPANY.legalName} is a homegrown product company — not a reseller of someone else's software.
              That means stable APIs, direct support, and a roadmap you can actually influence.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              {BENEFITS.map((b) => (
                <div key={b.label} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm">
                  <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"><b.icon className="h-4 w-4" /></span>
                  <span className="font-medium">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-7 md:p-8 shadow-sm">
            <h3 className="font-serif text-2xl font-bold mb-2">Apply to partner</h3>
            <p className="text-sm text-muted-foreground mb-6">Tell us about your business and how you'd like to work with KhanaLagao. We'll reply within 2 business days.</p>
            <LeadForm source="partners" buttonText="Submit application" showMessage showDetails />
          </div>
        </div>
      </section>

      <CTASection
        title="Let's build something together."
        subtitle={`Reach out at ${COMPANY.salesEmail} or WhatsApp ${COMPANY.phoneDisplay}.`}
        primary={{ label: "WhatsApp us", href: COMPANY.whatsappUrl }}
        secondary={{ label: "Email partnerships", href: `mailto:${COMPANY.salesEmail}` }}
      />
    </SiteLayout>
  );
}
