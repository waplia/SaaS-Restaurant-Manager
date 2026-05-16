import { Link } from "wouter";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { CTASection } from "@/components/shared/CTASection";
import { Button } from "@/components/ui/button";
import { useSeo } from "@/lib/seo";
import {
  Terminal, QrCode, ShoppingBag, ChefHat, Boxes, Users, IndianRupee,
  TrendingUp, BrainCircuit, BarChart3, Sparkles, ArrowRight, ShieldCheck, Plug, Zap, Heart,
} from "lucide-react";

const PILLARS = [
  {
    color: "from-primary/15 to-primary/5",
    icon: Terminal,
    title: "Restaurant OS",
    body: "The core operating system — POS, QR menu, KDS, table & order management, inventory and menu.",
    items: [
      { icon: Terminal, label: "POS Terminal", href: "/features/pos-terminal" },
      { icon: QrCode, label: "QR Menu", href: "/features/qr-menu" },
      { icon: ShoppingBag, label: "Online Ordering", href: "/features/online-ordering" },
      { icon: ChefHat, label: "Kitchen / KDS", href: "/features/kitchen-display" },
      { icon: Boxes, label: "Inventory", href: "/features/inventory-management" },
    ],
  },
  {
    color: "from-emerald-500/15 to-emerald-500/5",
    icon: TrendingUp,
    title: "Growth Cloud",
    body: "Bring guests back. Campaigns, loyalty, coupons, referrals and review boosters — all measurable.",
    items: [
      { icon: TrendingUp, label: "Growth Engine", href: "/features/growth-engine" },
      { icon: Heart, label: "Loyalty & Memberships", href: "/features/loyalty" },
      { icon: Sparkles, label: "Campaigns", href: "/features/campaigns" },
    ],
  },
  {
    color: "from-amber-500/15 to-amber-500/5",
    icon: IndianRupee,
    title: "Finance",
    body: "True P&L by outlet, expenses, payment reconciliation, settlements and GST-ready invoices.",
    items: [
      { icon: IndianRupee, label: "Finance & P&L", href: "/features/finance" },
      { icon: Users, label: "Staff & Payroll", href: "/features/payroll" },
      { icon: BarChart3, label: "Reports & Analytics", href: "/features/reports-analytics" },
    ],
  },
  {
    color: "from-purple-500/15 to-purple-500/5",
    icon: BrainCircuit,
    title: "Khana AI",
    body: "AI co-pilot for restaurants — menu import, review booster, smart campaigns, forecasting and chat.",
    items: [
      { icon: BrainCircuit, label: "Khana AI Overview", href: "/khana-ai" },
      { icon: Sparkles, label: "AI Menu Import", href: "/khana-ai/menu-import" },
      { icon: TrendingUp, label: "AI Forecasting", href: "/khana-ai/forecasting" },
    ],
  },
];

const PROMISES = [
  { icon: Zap, title: "Built for the rush", body: "Sub-100ms billing, offline-safe, hardware-tested in real Indian kitchens." },
  { icon: ShieldCheck, title: "Enterprise-grade trust", body: "Encrypted-at-rest, role-based access, audit logs and outlet isolation." },
  { icon: Plug, title: "Plays with everything", body: "Aggregators, payments, accounting, hardware — pluggable via our Marketplace." },
];

export default function PlatformOverview() {
  useSeo({
    title: "The KhanaLagao Platform — Restaurant OS, Growth, Finance & AI",
    description: "The complete restaurant operating system: POS, QR menu, kitchen, inventory, staff, finance, growth and Khana AI — one connected platform.",
  });

  return (
    <SiteLayout>
      <section className="pt-20 md:pt-28 pb-16">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold mb-5">
            <Sparkles className="h-3 w-3" /> The complete platform
          </div>
          <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-6">
            One restaurant OS. <span className="text-primary">Four pillars.</span> Zero silos.
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-3xl mx-auto mb-8">
            KhanaLagao connects your front-of-house, back-of-house, growth, finance and AI in a single
            platform — so every team, every outlet and every report stays in sync.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
            <Link href="/book-demo"><Button size="lg" className="gap-2">Book a free demo <ArrowRight className="h-4 w-4" /></Button></Link>
            <Link href="/features"><Button size="lg" variant="outline">Browse all features</Button></Link>
          </div>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="container mx-auto px-4 md:px-6 max-w-6xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {PILLARS.map((p) => (
              <div key={p.title} className={`rounded-2xl border border-border bg-gradient-to-br ${p.color} p-7 md:p-8`}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-12 h-12 rounded-xl bg-background text-primary flex items-center justify-center shadow-sm border border-border">
                    <p.icon className="h-6 w-6" />
                  </span>
                  <h2 className="font-serif text-2xl md:text-3xl font-bold tracking-tight">{p.title}</h2>
                </div>
                <p className="text-muted-foreground leading-relaxed mb-5">{p.body}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {p.items.map((it) => (
                    <Link key={it.href} href={it.href} className="group flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-background/70 border border-border hover:border-primary/40 hover:bg-background transition-all text-sm">
                      <it.icon className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-medium">{it.label}</span>
                      <ArrowRight className="h-3.5 w-3.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-20 bg-muted/30 border-y border-border">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight mb-4">Why operators choose KhanaLagao</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">Built for the real rush — not the demo room.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {PROMISES.map((p) => (
              <div key={p.title} className="rounded-2xl border border-border bg-card p-6">
                <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <p.icon className="h-5 w-5" />
                </div>
                <h3 className="font-serif text-xl font-bold mb-2">{p.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CTASection title="See the full platform in 30 minutes" subtitle="Book a tailored demo with our team in Jaipur." />
    </SiteLayout>
  );
}
