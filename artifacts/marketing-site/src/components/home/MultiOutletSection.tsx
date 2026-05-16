import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, BookOpen, Tag, Package, BarChart3, Percent, ShieldCheck, Trophy, ArrowRight,
} from "lucide-react";

const ITEMS = [
  { icon: LayoutDashboard, title: "Outlet dashboard", desc: "Compare sales, covers and costs across every outlet in one view." },
  { icon: BookOpen, title: "Central menu", desc: "Update once, push to every branch — with per-branch overrides." },
  { icon: Tag, title: "Branch pricing", desc: "Different prices for airport, mall and high-street locations." },
  { icon: Package, title: "Central inventory", desc: "Track stock, transfers and procurement across the chain." },
  { icon: BarChart3, title: "Franchise reports", desc: "Roll-up reports for owners; outlet-level access for managers." },
  { icon: Percent, title: "Royalty", desc: "Auto-calculate royalty and marketing fees per outlet." },
  { icon: ShieldCheck, title: "Brand compliance", desc: "Lock menu, recipes and pricing so franchisees stay on-brand." },
  { icon: Trophy, title: "Outlet ranking", desc: "Leaderboards on sales, AOV, reviews and food cost." },
];

export function MultiOutletSection() {
  return (
    <section className="py-24 bg-background">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary mb-4">
            Multi-outlet &amp; Franchise
          </div>
          <h2 className="font-serif text-3xl md:text-5xl font-bold mb-5">
            Built for chains that refuse to lose control as they scale.
          </h2>
          <p className="text-lg text-muted-foreground">
            Whether you run 3 outlets or 300, run them like one tight operation — not a dozen islands.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {ITEMS.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="p-5 rounded-xl border border-border bg-card hover:border-primary/40 transition-colors">
              <div className="mb-3 inline-flex p-2 rounded-lg bg-primary/10">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <h3 className="font-semibold mb-1.5 text-sm">{title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
        <div className="text-center">
          <Link href="/features/multi-outlet">
            <Button size="lg" variant="outline" className="border-2">
              See multi-outlet tools <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
