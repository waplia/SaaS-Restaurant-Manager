import { Link } from "wouter";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { CTASection } from "@/components/shared/CTASection";
import { Button } from "@/components/ui/button";
import { useSeo } from "@/lib/seo";
import { COMPANY } from "@/lib/company";
import { Terminal, QrCode, Boxes, Users, IndianRupee, BrainCircuit, BookOpen, MessageCircle, Phone, Search, Mail, Sparkles, ArrowRight } from "lucide-react";

const TOPICS = [
  { icon: Terminal, title: "POS & Billing", desc: "Day-zero setup, billing modes, KOTs, splits, refunds.", href: "/features/pos-terminal" },
  { icon: QrCode, title: "QR Menu & Online Orders", desc: "QR codes, menu sync, payments, delivery zones.", href: "/features/qr-menu" },
  { icon: Boxes, title: "Inventory & Recipes", desc: "Stock counts, purchase orders, wastage and recipe costing.", href: "/features/inventory-management" },
  { icon: Users, title: "Staff & Payroll", desc: "Attendance, shifts, statutory compliance and payouts.", href: "/features/payroll" },
  { icon: IndianRupee, title: "Finance & P&L", desc: "Expenses, settlements, P&L by outlet and invoicing.", href: "/features/finance" },
  { icon: BrainCircuit, title: "Khana AI", desc: "Menu import, review booster, campaigns, forecasting and credits.", href: "/khana-ai" },
];

export default function HelpCenter() {
  useSeo({
    title: "Help Center — KhanaLagao",
    description: "Documentation, troubleshooting and answers for the KhanaLagao platform — POS, QR menu, kitchen, inventory, staff, finance and Khana AI.",
  });
  return (
    <SiteLayout>
      <section className="pt-20 md:pt-28 pb-12">
        <div className="container mx-auto px-4 md:px-6 max-w-4xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold mb-5">
            <Sparkles className="h-3 w-3" /> Help center
          </div>
          <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-5">How can we help?</h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Browse topics, read the docs, or reach a human in {COMPANY.city}.
          </p>
          <div className="relative max-w-2xl mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search help articles, features, error messages…"
              className="w-full h-14 pl-12 pr-4 rounded-2xl border border-border bg-card text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 md:px-6 max-w-6xl">
          <h2 className="font-serif text-2xl md:text-3xl font-bold tracking-tight mb-6">Browse by topic</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {TOPICS.map((t) => (
              <Link key={t.href} href={t.href} className="group rounded-2xl border border-border bg-card p-6 hover:border-primary/40 hover:shadow-sm transition-all">
                <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <t.icon className="h-5 w-5" />
                </div>
                <h3 className="font-serif text-lg font-bold mb-2">{t.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-3">{t.desc}</p>
                <span className="text-sm font-medium text-primary inline-flex items-center gap-1">Read <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" /></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 md:py-16 bg-muted/30 border-y border-border">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl">
          <div className="grid md:grid-cols-3 gap-5">
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4"><MessageCircle className="h-5 w-5" /></div>
              <h3 className="font-bold mb-1">WhatsApp support</h3>
              <p className="text-sm text-muted-foreground mb-4">Fastest reply, in Hindi or English.</p>
              <a href={COMPANY.whatsappUrl} target="_blank" rel="noreferrer"><Button size="sm" className="w-full">WhatsApp us</Button></a>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4"><Phone className="h-5 w-5" /></div>
              <h3 className="font-bold mb-1">Call us</h3>
              <p className="text-sm text-muted-foreground mb-4">Mon–Sat, 10am–7pm IST.</p>
              <a href={COMPANY.phoneHref}><Button size="sm" variant="outline" className="w-full">{COMPANY.phoneDisplay}</Button></a>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4"><Mail className="h-5 w-5" /></div>
              <h3 className="font-bold mb-1">Email support</h3>
              <p className="text-sm text-muted-foreground mb-4">Existing customers — 24/7.</p>
              <a href={`mailto:${COMPANY.supportEmail}`}><Button size="sm" variant="outline" className="w-full">{COMPANY.supportEmail}</Button></a>
            </div>
          </div>
        </div>
      </section>

      <CTASection title="Looking for owner playbooks?" subtitle="See our guides for setup, migration and growth." primary={{ label: "Browse guides", href: "/guides" }} secondary={{ label: "Read the blog", href: "/blog" }} />
    </SiteLayout>
  );
}
