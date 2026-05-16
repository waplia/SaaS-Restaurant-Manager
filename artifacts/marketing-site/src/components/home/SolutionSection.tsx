import { Zap, ChefHat, Package, Users, Heart, TrendingUp } from "lucide-react";

const SOLUTIONS = [
  { icon: Zap, title: "Sell faster", desc: "POS, QR menu and online orders flow into one screen. No double-entry, no waiting customers." },
  { icon: ChefHat, title: "Serve better", desc: "KOTs route to the right station automatically. Tables, courses and timings stay in sync." },
  { icon: Package, title: "Control stock", desc: "Recipe-level inventory deducts in real time. Get alerts before you run out — or get billed extra." },
  { icon: Users, title: "Manage staff", desc: "Attendance, shifts, tips and payroll handled in one place — with biometric and mobile check-in." },
  { icon: Heart, title: "Grow customers", desc: "Capture every guest, segment them, and run win-back, birthday and loyalty campaigns on autopilot." },
  { icon: TrendingUp, title: "Track profit", desc: "Daily P&L by outlet, food cost, staff cost and wastage — not a spreadsheet after month close." },
];

export function SolutionSection() {
  return (
    <section className="py-12 md:py-24 bg-card">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-3xl mx-auto mb-8 md:mb-14">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary mb-3 md:mb-4">
            The solution
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl md:text-5xl font-bold mb-3 md:mb-5">
            One platform. Six promises. Zero excuses.
          </h2>
          <p className="text-base md:text-lg text-muted-foreground">
            Every module is built to do one thing exceptionally well — and to talk fluently to every other module.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
          {SOLUTIONS.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="group p-4 md:p-7 rounded-2xl border border-border bg-background hover:border-primary/40 hover:shadow-lg transition-all">
              <div className="mb-3 md:mb-5 inline-flex p-2.5 md:p-3 rounded-xl bg-primary/10">
                <Icon className="h-5 w-5 md:h-6 md:w-6 text-primary" />
              </div>
              <h3 className="text-base md:text-xl font-bold mb-1.5 md:mb-2 font-serif">{title}</h3>
              <p className="text-muted-foreground leading-relaxed text-xs md:text-sm">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
