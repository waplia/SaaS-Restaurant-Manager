import { Link } from "wouter";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { Button } from "@/components/ui/button";
import { useSeo } from "@/lib/seo";
import { COMPANY } from "@/lib/company";
import { CheckCircle2, Phone, MessageCircle, Mail, ArrowRight, Clock, BookOpen, Calendar } from "lucide-react";

const NEXT_STEPS = [
  { icon: Clock, title: "Hear back within 1 business day", body: "A specialist from our Jaipur team will reach out by your preferred channel." },
  { icon: Calendar, title: "We'll schedule a tailored demo", body: "30 minutes, focused on your concept — POS, QR, KDS, inventory, AI, finance." },
  { icon: BookOpen, title: "While you wait — explore", body: "Browse the platform, features, pricing or read recent stories on the blog." },
];

export default function ThankYou() {
  useSeo({
    title: "Thank you — we'll be in touch",
    description: `Thanks for reaching out to ${COMPANY.product}. Our team in ${COMPANY.city} will get back within one business day.`,
    noindex: true,
  });

  return (
    <SiteLayout>
      <section className="py-20 md:py-28">
        <div className="container mx-auto px-4 md:px-6 max-w-4xl">
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-6">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-5">Thank you — we got it.</h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Your message is on its way to the {COMPANY.product} team in {COMPANY.city}.
              We'll get back to you within one business day.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 mb-12">
            {NEXT_STEPS.map((s) => (
              <div key={s.title} className="rounded-2xl border border-border bg-card p-6">
                <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <s.icon className="h-5 w-5" />
                </div>
                <p className="font-semibold mb-1.5">{s.title}</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl bg-gradient-to-br from-primary/10 via-orange-500/5 to-purple-500/10 border border-border p-8 text-center">
            <h2 className="font-serif text-2xl md:text-3xl font-bold mb-3">Need an answer right now?</h2>
            <p className="text-muted-foreground mb-6 max-w-xl mx-auto">Reach us directly on call, WhatsApp or email.</p>
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
              <a href={COMPANY.phoneHref}><Button size="lg" className="gap-2"><Phone className="h-4 w-4" /> Call {COMPANY.phoneDisplay}</Button></a>
              <a href={COMPANY.whatsappUrl} target="_blank" rel="noreferrer"><Button size="lg" variant="outline" className="gap-2"><MessageCircle className="h-4 w-4" /> WhatsApp</Button></a>
              <a href={`mailto:${COMPANY.salesEmail}`}><Button size="lg" variant="ghost" className="gap-2"><Mail className="h-4 w-4" /> {COMPANY.salesEmail}</Button></a>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-center justify-center mt-10">
            <Link href="/"><Button variant="outline" className="gap-2">Back to home <ArrowRight className="h-4 w-4" /></Button></Link>
            <Link href="/features"><Button variant="ghost">Explore features</Button></Link>
            <Link href="/blog"><Button variant="ghost">Read the blog</Button></Link>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
