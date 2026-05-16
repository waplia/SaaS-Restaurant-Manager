import { Link } from "wouter";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { CTASection } from "@/components/shared/CTASection";
import { Button } from "@/components/ui/button";
import { useSeo } from "@/lib/seo";
import { COMPANY } from "@/lib/company";
import { Sparkles, Heart, Rocket, ShieldCheck, Users, MapPin, Phone, Mail, ArrowRight } from "lucide-react";

const VALUES = [
  { icon: Rocket, title: "Speed is a feature", body: "In a restaurant, seconds matter. We obsess over every millisecond and every keystroke a captain has to do." },
  { icon: ShieldCheck, title: "Reliability above all", body: "The system can't go down on a Friday night. We architect for the worst-case kitchen, not the demo." },
  { icon: Heart, title: "Respect the craft", body: "We build tools for working professionals. No gimmicks, no toy UI — just robust software." },
  { icon: Sparkles, title: "Clarity brings profit", body: "Data should be actionable, not overwhelming. We surface the metric that decides tomorrow's prep." },
];

const TIMELINE = [
  { year: "2022", label: "Started in Jaipur", body: "Waplia Digital Solutions began building software for local restaurants and cloud kitchens." },
  { year: "2023", label: "KhanaLagao goes live", body: "First version of POS + QR menu + KDS deployed across multi-outlet customers." },
  { year: "2024", label: "Khana AI launched", body: "AI menu import, review booster, smart campaigns and forecasting added to the platform." },
  { year: "2025", label: "Restaurant OS", body: "Finance, growth engine and franchise controls unified into one connected restaurant operating system." },
  { year: "2026", label: "Scaling India-wide", body: "Helping restaurants, cafes, cloud kitchens, hotels and chains run smarter, every day." },
];

export default function About() {
  useSeo({
    title: `About ${COMPANY.product} — built by ${COMPANY.legalName}`,
    description: `${COMPANY.product} is built by ${COMPANY.legalName} from ${COMPANY.city}, India. Learn about our mission, values and team.`,
  });

  return (
    <SiteLayout>
      {/* Hero */}
      <section className="pt-20 md:pt-28 pb-16">
        <div className="container mx-auto px-4 md:px-6 max-w-4xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold mb-5">
            <Sparkles className="h-3 w-3" /> About us
          </div>
          <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Software that respects the <span className="text-primary">craft of hospitality.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-3xl mx-auto">
            {COMPANY.product} is built by {COMPANY.legalName} — a small, focused team from {COMPANY.city}, India,
            building the restaurant operating system we wish every operator had.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="py-16 md:py-20 bg-muted/30 border-y border-border">
        <div className="container mx-auto px-4 md:px-6 grid lg:grid-cols-2 gap-12 items-start max-w-6xl">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-3">Our mission</p>
            <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight mb-5">
              Let chefs be chefs. Let owners be owners.
            </h2>
            <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
              Most restaurant software was built in a meeting room, not in a kitchen at 9pm on a Saturday.
              We started {COMPANY.product} because we saw brilliant operators losing money to clunky POS,
              broken inventory and dashboards no one understood. We're here to fix that — with software that
              is fast, reliable, beautiful and genuinely useful.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6 md:p-8 space-y-5">
            <h3 className="font-serif text-xl font-bold">What "Built by Waplia" means</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {COMPANY.legalName} is a homegrown product studio. We don't outsource the hard parts.
              The same team writes the code, talks to customers, runs onboarding and answers support.
            </p>
            <ul className="space-y-2.5 text-sm">
              <li className="flex gap-2.5"><span className="text-primary font-bold">→</span> Indian product, built for Indian and global restaurants.</li>
              <li className="flex gap-2.5"><span className="text-primary font-bold">→</span> Direct line to the founders — no call center, no script.</li>
              <li className="flex gap-2.5"><span className="text-primary font-bold">→</span> One platform — POS, QR, KDS, inventory, staff, finance, growth and AI.</li>
              <li className="flex gap-2.5"><span className="text-primary font-bold">→</span> Customer support in Hindi and English, on WhatsApp.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4 md:px-6 max-w-6xl">
          <div className="text-center mb-12 max-w-2xl mx-auto">
            <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight mb-4">What we believe</h2>
            <p className="text-muted-foreground text-lg">Four principles that decide every button, every API and every customer call.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {VALUES.map((v) => (
              <div key={v.title} className="rounded-2xl border border-border bg-card p-6 md:p-7 hover:shadow-md transition-shadow">
                <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <v.icon className="h-5 w-5" />
                </div>
                <h3 className="font-serif text-xl font-bold mb-2">{v.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="py-16 md:py-20 bg-muted/30 border-y border-border">
        <div className="container mx-auto px-4 md:px-6 max-w-4xl">
          <div className="text-center mb-10">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-3">Our journey</p>
            <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight">From a Jaipur garage to a restaurant OS</h2>
          </div>
          <div className="space-y-4">
            {TIMELINE.map((t) => (
              <div key={t.year} className="flex gap-5 rounded-xl border border-border bg-card p-5">
                <div className="shrink-0 w-20 text-primary font-bold font-serif text-2xl">{t.year}</div>
                <div>
                  <p className="font-semibold mb-1">{t.label}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{t.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Company card */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl">
          <div className="grid md:grid-cols-2 gap-8 items-start">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-3">Company</p>
              <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight mb-5">{COMPANY.legalName}</h2>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                {COMPANY.proudlyBuiltLine} We design, build, ship, and support every line of {COMPANY.product} ourselves.
              </p>
              <div className="space-y-3 text-sm">
                <a href={COMPANY.phoneHref} className="flex items-center gap-3 text-foreground/80 hover:text-primary transition-colors">
                  <Phone className="h-4 w-4 text-primary" /> {COMPANY.phoneDisplay}
                </a>
                <a href={`mailto:${COMPANY.supportEmail}`} className="flex items-center gap-3 text-foreground/80 hover:text-primary transition-colors">
                  <Mail className="h-4 w-4 text-primary" /> {COMPANY.supportEmail}
                </a>
                <div className="flex items-start gap-3 text-foreground/80">
                  <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" /> {COMPANY.fullAddress}
                </div>
                <div className="flex items-center gap-3 text-foreground/80">
                  <Users className="h-4 w-4 text-primary" /> Hiring designers, engineers, customer success
                </div>
              </div>
            </div>
            <div className="rounded-2xl bg-gradient-to-br from-primary/10 via-orange-500/5 to-purple-500/10 border border-border p-8">
              <h3 className="font-serif text-2xl font-bold mb-3">Want to see {COMPANY.product} live?</h3>
              <p className="text-muted-foreground mb-6">Book a free, no-pressure demo with the team in {COMPANY.city}. We'll set up a tailored walkthrough for your concept.</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link href="/book-demo"><Button size="lg" className="gap-2">Book a free demo <ArrowRight className="h-4 w-4" /></Button></Link>
                <Link href="/contact"><Button size="lg" variant="outline">Contact us</Button></Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <CTASection
        title="Built by operators, for operators."
        subtitle="Join hundreds of restaurants running on KhanaLagao — from single cafes in Jaipur to multi-outlet chains across India."
      />
    </SiteLayout>
  );
}
