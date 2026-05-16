import {
  CheckCircle2, Layers, Zap, ShieldCheck, Smartphone, Globe, IndianRupee, HeadphonesIcon, Sparkles,
} from "lucide-react";

const REASONS = [
  { icon: Layers, title: "Truly all-in-one", desc: "POS, KOT, inventory, payroll, finance, growth and AI — no Frankenstein stack." },
  { icon: Zap, title: "Built for speed", desc: "Bills, KOTs and reports load in milliseconds, even on flaky internet." },
  { icon: ShieldCheck, title: "Offline-first", desc: "Service never stops. Bills and KOTs print even if your wifi dies." },
  { icon: Smartphone, title: "Mobile-first ops", desc: "Run the floor, the kitchen and the back office from your phone." },
  { icon: Globe, title: "India-ready", desc: "GST, e-invoicing, UPI, QR, regional languages and rupee-first reporting." },
  { icon: Sparkles, title: "AI baked in", desc: "Khana AI is included from day one — not a premium upsell." },
  { icon: IndianRupee, title: "Honest pricing", desc: "Transparent plans, no setup fees, no per-bill cuts, no surprise invoices." },
  { icon: HeadphonesIcon, title: "Onboarding that actually shows up", desc: "Human onboarding, menu setup help and live support during your first service." },
  { icon: CheckCircle2, title: "Open & extensible", desc: "Public APIs, webhooks and a marketplace so you're never locked in." },
];

export function WhyChooseUs() {
  return (
    <section className="py-12 md:py-24 bg-card">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-3xl mx-auto mb-8 md:mb-14">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary mb-3 md:mb-4">
            Why KhanaLagao
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl md:text-5xl font-bold mb-3 md:mb-5">
            Nine reasons restaurants switch — and stay.
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-5 max-w-6xl mx-auto">
          {REASONS.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="p-4 md:p-6 rounded-xl border border-border bg-background hover:border-primary/40 transition-colors">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 flex-shrink-0">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1 md:mb-1.5 text-sm md:text-base">{title}</h3>
                  <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
