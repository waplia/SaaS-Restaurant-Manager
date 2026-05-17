import { Link } from "wouter";
import {
  Smartphone, QrCode, ShoppingBag, ChefHat, Boxes, Users, IndianRupee,
  TrendingUp, BarChart3, BrainCircuit, ArrowRight,
} from "lucide-react";

const NODES = [
  { icon: Smartphone, label: "POS", desc: "Bills, KOTs, splits", tone: "primary" },
  { icon: QrCode, label: "QR Menu", desc: "Table & takeout", tone: "amber" },
  { icon: ShoppingBag, label: "Online", desc: "Direct + aggregators", tone: "blue" },
  { icon: ChefHat, label: "Kitchen", desc: "KOTs, timers, expo", tone: "red" },
  { icon: Boxes, label: "Inventory", desc: "Recipe-linked stock", tone: "green" },
  { icon: Users, label: "Staff", desc: "Attendance, payroll", tone: "purple" },
  { icon: IndianRupee, label: "Finance", desc: "Live P&L, GST", tone: "primary" },
  { icon: TrendingUp, label: "Growth", desc: "Campaigns, loyalty", tone: "amber" },
  { icon: BarChart3, label: "Reports", desc: "Every metric, live", tone: "blue" },
];

const TONES: Record<string, string> = {
  primary: "from-primary/15 to-primary/5 text-primary",
  amber: "from-amber-500/15 to-amber-500/5 text-amber-600",
  blue: "from-blue-500/15 to-blue-500/5 text-blue-600",
  red: "from-red-500/15 to-red-500/5 text-red-600",
  green: "from-emerald-500/15 to-emerald-500/5 text-emerald-600",
  purple: "from-purple-500/15 to-purple-500/5 text-purple-600",
};

export function WorkflowDiagram() {
  return (
    <section className="py-12 md:py-24 bg-card border-y border-border">
      <div className="container mx-auto px-4 md:px-6 max-w-6xl">
        <div className="text-center max-w-3xl mx-auto mb-8 md:mb-14">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary mb-3 md:mb-4">
            One connected system
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl md:text-5xl font-bold mb-3 md:mb-5">
            Every module talks to every other.{" "}
            <span className="text-primary">Automatically.</span>
          </h2>
          <p className="text-base md:text-lg text-muted-foreground">
            Every order, ingredient, ticket and rupee flows through the same nervous system — powered by Khana AI in the middle.
          </p>
        </div>

        <div className="relative">
          {/* Central AI hub */}
          <div className="hidden md:flex absolute inset-0 items-center justify-center pointer-events-none">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/30 to-purple-500/30 blur-2xl scale-150" />
              <div className="relative rounded-2xl bg-gradient-to-br from-primary to-purple-600 text-white p-5 shadow-2xl border border-white/20 pointer-events-auto">
                <div className="flex items-center gap-2 mb-1">
                  <BrainCircuit className="h-5 w-5" />
                  <span className="font-serif font-bold">Khana AI</span>
                </div>
                <p className="text-xs opacity-90 max-w-[160px] leading-snug">
                  The intelligence layer connecting every module
                </p>
              </div>
            </div>
          </div>

          {/* Nodes */}
          <div className="relative grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-5 md:py-12">
            {NODES.map((n, i) => {
              // Hide middle tile on md+ where AI hub sits
              const isCenter = i === 4;
              return (
                <div
                  key={n.label}
                  className={`group rounded-2xl border border-border bg-gradient-to-br ${TONES[n.tone]} p-4 md:p-5 hover:shadow-lg transition-all ${isCenter ? "md:invisible" : ""}`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="h-8 w-8 rounded-lg bg-background flex items-center justify-center shadow-sm">
                      <n.icon className="h-4 w-4" />
                    </span>
                    <span className="font-bold text-foreground">{n.label}</span>
                  </div>
                  <p className="text-xs md:text-sm text-foreground/70 leading-snug">{n.desc}</p>
                </div>
              );
            })}
          </div>

          {/* Central AI on mobile */}
          <div className="md:hidden mt-3">
            <div className="rounded-2xl bg-gradient-to-br from-primary to-purple-600 text-white p-4 shadow-lg border border-white/20 text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <BrainCircuit className="h-5 w-5" />
                <span className="font-serif font-bold">Khana AI</span>
              </div>
              <p className="text-xs opacity-90">
                The intelligence layer connecting every module
              </p>
            </div>
          </div>
        </div>

        <div className="text-center mt-8 md:mt-12">
          <Link href="/platform" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:gap-2 transition-all">
            See the full platform <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
