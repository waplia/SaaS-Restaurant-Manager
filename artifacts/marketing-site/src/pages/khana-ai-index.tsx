import { Link } from "wouter";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { CTASection } from "@/components/shared/CTASection";
import { Button } from "@/components/ui/button";
import { useSeo } from "@/lib/seo";
import { AI_MENU } from "@/lib/navigation";
import { Sparkles, ArrowRight, BrainCircuit, Zap, ShieldCheck, Coins } from "lucide-react";

const PROMISES = [
  { icon: BrainCircuit, title: "Built for restaurants", body: "Trained on real restaurant data: menus, reviews, sales, kitchen ops — not generic prompts." },
  { icon: Zap, title: "Plug-and-play", body: "No prompts to write. Every AI feature lives inside the workflows you already use." },
  { icon: ShieldCheck, title: "Your data stays yours", body: "We never train on your business data. Outlet-isolated, encrypted, fully auditable." },
  { icon: Coins, title: "Pay only for what you use", body: "Flexible credits — turn AI on, off, or scale it per outlet." },
];

export default function KhanaAIIndex() {
  useSeo({
    title: "Khana AI — AI co-pilot for restaurants | KhanaLagao",
    description: "Khana AI brings restaurant-specific AI to your operations — menu import, review booster, smart campaigns, sales insights, forecasting and chat. Pay per use with AI Credits.",
  });

  const links = AI_MENU.links ?? [];

  return (
    <SiteLayout>
      <section className="pt-20 md:pt-28 pb-16 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-orange-500/5 to-purple-600/10 -z-10" />
        <div className="container mx-auto px-4 md:px-6 max-w-5xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-primary to-purple-600 text-white px-3 py-1 text-xs font-semibold mb-5">
            <Sparkles className="h-3 w-3" /> Khana AI
          </div>
          <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Your AI co-pilot for{" "}
            <span className="bg-gradient-to-r from-primary via-orange-500 to-purple-600 bg-clip-text text-transparent">
              restaurant operations.
            </span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-3xl mx-auto mb-8">
            Khana AI sits inside every KhanaLagao workflow — turning menu photos into digital menus,
            replying to reviews in your brand voice, forecasting demand, and answering questions about your data.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
            <Link href="/book-demo"><Button size="lg" className="gap-2">See Khana AI live <ArrowRight className="h-4 w-4" /></Button></Link>
            <Link href="/khana-ai/credits"><Button size="lg" variant="outline">How credits work</Button></Link>
          </div>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 md:px-6 max-w-6xl">
          <div className="text-center mb-10">
            <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight mb-3">Every AI feature, in one place</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">Pick a tool to see how it works and what it costs.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {links.filter(l => l.href !== "/khana-ai").map((l) => (
              <Link key={l.href} href={l.href} className="group rounded-2xl border border-border bg-card p-6 hover:border-purple-500/40 hover:shadow-md transition-all">
                <div className="flex items-center gap-3 mb-3">
                  {l.icon && (
                    <span className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/10 to-purple-500/10 text-primary flex items-center justify-center">
                      <l.icon className="h-5 w-5" />
                    </span>
                  )}
                  <h3 className="font-serif text-lg font-bold">{l.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mb-3">{l.desc}</p>
                <span className="text-sm font-medium text-primary inline-flex items-center gap-1">
                  Explore <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-20 bg-muted/30 border-y border-border">
        <div className="container mx-auto px-4 md:px-6 max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight mb-3">AI that respects your business</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {PROMISES.map((p) => (
              <div key={p.title} className="rounded-2xl border border-border bg-card p-6">
                <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <p.icon className="h-5 w-5" />
                </div>
                <h3 className="font-serif text-lg font-bold mb-2">{p.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CTASection title="See Khana AI in action" subtitle="Book a tailored demo — bring a menu photo, we'll digitize it live." />
    </SiteLayout>
  );
}
