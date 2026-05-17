import { SiteLayout } from "@/components/layout/SiteLayout";
import { LeadForm } from "@/components/LeadForm";
import { useSeo } from "@/lib/seo";
import { COMPANY } from "@/lib/company";
import { Mail, Phone, MessageCircle, MapPin, Clock, ArrowUpRight, Headphones, Building2, Users } from "lucide-react";

const CHANNELS = [
  {
    icon: Phone,
    label: "Call sales",
    value: COMPANY.phoneDisplay,
    href: COMPANY.phoneHref,
    desc: "Mon–Sat, 10am–7pm IST",
  },
  {
    icon: MessageCircle,
    label: "WhatsApp",
    value: COMPANY.phoneDisplay,
    href: COMPANY.whatsappUrl,
    desc: "Fastest reply, English & Hindi",
    external: true,
  },
  {
    icon: Mail,
    label: "Sales email",
    value: COMPANY.salesEmail,
    href: `mailto:${COMPANY.salesEmail}`,
    desc: "Replies within one business day",
  },
  {
    icon: Headphones,
    label: "Support email",
    value: COMPANY.supportEmail,
    href: `mailto:${COMPANY.supportEmail}`,
    desc: "Existing customers — 24/7",
  },
];

const ROUTES = [
  { icon: Users, title: "Talk to sales", body: "See KhanaLagao live and get a tailored quote for your outlets.", cta: "Book a demo", href: "/book-demo" },
  { icon: Building2, title: "Enterprise / Chains", body: "20+ outlets, hotels, franchises — talk to our enterprise team.", cta: "Email us", href: `mailto:${COMPANY.salesEmail}` },
  { icon: Headphones, title: "Existing customer support", body: "Already on KhanaLagao? Ping support on WhatsApp for fastest help.", cta: "WhatsApp support", href: COMPANY.whatsappUrl },
];

export default function Contact() {
  useSeo({
    title: "Contact | KhanaLagao",
    description: `Talk to the ${COMPANY.product} team in ${COMPANY.city}. Call ${COMPANY.phoneDisplay}, WhatsApp us, or email ${COMPANY.salesEmail}.`,
  });

  return (
    <SiteLayout>
      <section className="pt-12 md:pt-28 pb-8 md:pb-12 border-b border-border bg-muted/20">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl text-center">
          <h1 className="font-serif text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight mb-3 md:mb-5">
            Talk to a real human, <span className="text-primary">in {COMPANY.city}.</span>
          </h1>
          <p className="text-base md:text-xl text-muted-foreground leading-relaxed max-w-3xl mx-auto">
            Questions about features, pricing, onboarding or migration? The {COMPANY.product} team is one call, WhatsApp or email away.
          </p>
        </div>
      </section>

      {/* Channels grid */}
      <section className="py-10 md:py-16">
        <div className="container mx-auto px-4 md:px-6 max-w-6xl">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            {CHANNELS.map((c) => (
              <a
                key={c.label}
                href={c.href}
                target={c.external ? "_blank" : undefined}
                rel={c.external ? "noreferrer" : undefined}
                className="group rounded-2xl border border-border bg-card p-4 md:p-6 hover:shadow-md hover:border-primary/40 transition-all"
              >
                <div className="w-9 h-9 md:w-10 md:h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3 md:mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <c.icon className="h-4 w-4 md:h-5 md:w-5" />
                </div>
                <p className="text-[10px] md:text-xs uppercase tracking-widest font-semibold text-muted-foreground mb-1">{c.label}</p>
                <p className="font-semibold text-sm md:text-base mb-1 md:mb-1.5 break-words">{c.value}</p>
                <p className="text-xs text-muted-foreground">{c.desc}</p>
                <p className="text-xs text-primary font-medium mt-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  Open <ArrowUpRight className="h-3 w-3" />
                </p>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Form + office */}
      <section className="py-10 md:py-16 bg-muted/30 border-y border-border">
        <div className="container mx-auto px-4 md:px-6 max-w-6xl grid lg:grid-cols-2 gap-8 md:gap-12">
          <div>
            <h2 className="font-serif text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3 md:mb-4">Send us a message</h2>
            <p className="text-sm md:text-base text-muted-foreground mb-4 md:mb-6">Tell us a bit about your restaurant and what you're looking for. We'll get back within one business day.</p>
            <div className="bg-card border border-border p-4 md:p-8 rounded-2xl shadow-sm">
              <LeadForm source="contact" buttonText="Send message" showMessage showDetails />
            </div>
          </div>
          <div className="space-y-6">
            <div className="rounded-2xl border border-border bg-card p-6 md:p-8">
              <h3 className="font-serif text-2xl font-bold mb-5">Visit our office</h3>
              <div className="space-y-4 text-sm">
                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-base text-foreground">{COMPANY.legalName}</p>
                    <p className="text-muted-foreground mt-0.5">{COMPANY.fullAddress}</p>
                    <p className="text-muted-foreground mt-2 text-xs italic">{COMPANY.proudlyBuiltLine}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Clock className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-foreground">Office hours</p>
                    <p className="text-muted-foreground mt-0.5">Mon–Sat · 10:00am – 7:00pm IST</p>
                    <p className="text-muted-foreground">Sunday — by appointment</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Phone className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-foreground">Direct line</p>
                    <a href={COMPANY.phoneHref} className="text-primary font-medium hover:underline">{COMPANY.phoneDisplay}</a>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {ROUTES.map((r) => (
                <a key={r.title} href={r.href} target={r.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 hover:border-primary/40 hover:shadow-sm transition-all">
                  <span className="shrink-0 w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <r.icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-base">{r.title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{r.body}</p>
                    <p className="text-xs font-medium text-primary mt-1.5 flex items-center gap-1">{r.cta} <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" /></p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
