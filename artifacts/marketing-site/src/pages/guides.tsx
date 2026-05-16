import { Link } from "wouter";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { CTASection } from "@/components/shared/CTASection";
import { useSeo } from "@/lib/seo";
import { BookMarked, ArrowRight, Sparkles, Clock } from "lucide-react";

const GUIDES = [
  { title: "How to migrate from a legacy POS in 7 days", category: "Migration", read: "12 min", body: "A step-by-step plan to move your menu, inventory, customers and reports from any existing POS to KhanaLagao without losing data — or sales." },
  { title: "Opening a cloud kitchen — the operator's playbook", category: "Launch", read: "18 min", body: "Choose the right neighbourhood, hire the lean team, plug into aggregators, build a direct ordering channel, and break even faster." },
  { title: "QR menu that actually grows AOV (and how to design it)", category: "Growth", read: "9 min", body: "Why most QR menus underperform, the photo and copy rules that work, smart upsell modifiers, and metrics to track." },
  { title: "Tightening food cost from 36% to 30%", category: "Operations", read: "11 min", body: "Recipe costing, par levels, daily counts, wastage logging and supplier negotiation — what changed for one chain we work with." },
  { title: "Hiring captains who don't quit in 3 months", category: "People", read: "8 min", body: "Job description, screening, trial shift, onboarding checklist and the SOP cadence that keeps service consistent." },
  { title: "Loyalty programs that actually drive repeat visits", category: "Growth", read: "10 min", body: "Why most loyalty programs fail, what to reward, how to price points, and what to measure week over week." },
  { title: "Reading your P&L without an accountant", category: "Finance", read: "13 min", body: "Decode food cost, prime cost, contribution margin and break-even — and the three reports an owner should read every Monday." },
  { title: "Khana AI from day one — a 30-minute setup", category: "AI", read: "7 min", body: "Get review booster, smart campaigns and forecasting live in half an hour. No prompts to write." },
];

export default function Guides() {
  useSeo({
    title: "Owner Guides — KhanaLagao",
    description: "Step-by-step playbooks for restaurant owners: migration, opening, growth, operations, finance, people and Khana AI.",
  });
  return (
    <SiteLayout>
      <section className="pt-20 md:pt-28 pb-12">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold mb-5">
            <Sparkles className="h-3 w-3" /> Owner playbooks
          </div>
          <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-5">
            Practical guides for <span className="text-primary">restaurant operators.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
            Written by operators, with the numbers and SOPs that actually move the needle.
          </p>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {GUIDES.map((g) => (
              <Link key={g.title} href="/blog" className="group rounded-2xl border border-border bg-card p-6 hover:border-primary/40 hover:shadow-md transition-all flex flex-col">
                <div className="flex items-center gap-3 mb-3 text-xs">
                  <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">{g.category}</span>
                  <span className="flex items-center gap-1 text-muted-foreground"><Clock className="h-3 w-3" /> {g.read}</span>
                </div>
                <h3 className="font-serif text-xl font-bold mb-2 group-hover:text-primary transition-colors">{g.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">{g.body}</p>
                <span className="text-sm font-medium text-primary inline-flex items-center gap-1 mt-auto">
                  Read guide <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                </span>
              </Link>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground mt-10 inline-flex items-center gap-2 w-full justify-center">
            <BookMarked className="h-4 w-4" /> New guides published every week. <Link href="/blog" className="text-primary font-medium hover:underline">Subscribe via the blog →</Link>
          </p>
        </div>
      </section>

      <CTASection title="Want a custom playbook for your concept?" subtitle="Book a call — we'll map your operations on a real KhanaLagao account." />
    </SiteLayout>
  );
}
