import { Link } from "wouter";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { useSeo } from "@/lib/seo";
import { FileText, ShieldCheck, Scale } from "lucide-react";

const LEGAL_LINKS = [
  { title: "Privacy Policy", href: "/privacy-policy", desc: "How we collect, use and protect your data.", icon: ShieldCheck },
  { title: "Terms & Conditions", href: "/terms", desc: "The rules for using KhanaLagao.", icon: Scale },
  { title: "Refund Policy", href: "/refund-policy", desc: "When and how refunds are processed.", icon: FileText },
  { title: "Cookie Policy", href: "/cookie-policy", desc: "What cookies we use and why.", icon: FileText },
  { title: "Data Processing Agreement", href: "/data-processing-agreement", desc: "Our DPA for enterprise customers.", icon: ShieldCheck },
  { title: "Acceptable Use Policy", href: "/acceptable-use-policy", desc: "What's allowed (and what isn't).", icon: Scale },
];

export default function LegalIndex() {
  useSeo({
    title: "Legal | KhanaLagao",
    description: "Privacy policy, terms, refund policy and other legal documents for KhanaLagao.",
  });

  return (
    <SiteLayout>
      <section className="py-14 md:py-28">
        <div className="container mx-auto px-4 md:px-6 max-w-4xl">
          <div className="text-center mb-12">
            <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-4">Legal</h1>
            <p className="text-lg text-muted-foreground">Everything you need to know about the rules, your rights, and how we handle data.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="group flex items-start gap-4 p-5 rounded-2xl border border-border bg-card hover:shadow-md transition-all">
                <span className="shrink-0 w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <l.icon className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-semibold text-base mb-1">{l.title}</h3>
                  <p className="text-sm text-muted-foreground">{l.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
