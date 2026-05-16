import { AlertCircle } from "lucide-react";

const PAINS = [
  "Separate apps for billing, KOT, inventory, payroll and reports — none talking to each other.",
  "Wastage and pilferage you only spot at month-end, when it's too late.",
  "Staff salaries calculated on WhatsApp screenshots and crumpled registers.",
  "Customer data sitting on aggregators — yours by right, theirs by default.",
  "Marketing campaigns that run on guesswork instead of guest behaviour.",
  "Owners flying blind across outlets, with no real P&L until the CA shows up.",
];

export function ProblemSection() {
  return (
    <section className="py-12 md:py-24 bg-background">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-3xl mx-auto mb-8 md:mb-14">
          <div className="inline-flex items-center rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground mb-3 md:mb-4">
            The problem
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl md:text-5xl font-bold mb-3 md:mb-5">
            Restaurants don't need more tools.{" "}
            <span className="text-primary">They need one connected system.</span>
          </h2>
          <p className="text-base md:text-lg text-muted-foreground">
            Most restaurants are duct-taping five apps together to run one business. The result: leaks
            in stock, margin, staff hours and guest experience that quietly eat your profit every month.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-5 max-w-5xl mx-auto">
          {PAINS.map((p, i) => (
            <div key={i} className="flex items-start gap-3 p-4 md:p-5 rounded-xl border border-border bg-card">
              <AlertCircle className="h-4 w-4 md:h-5 md:w-5 text-secondary flex-shrink-0 mt-0.5" />
              <p className="text-sm md:text-base text-foreground/90 leading-relaxed">{p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
