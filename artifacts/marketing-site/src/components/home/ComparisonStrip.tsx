import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ComparisonTable } from "@/components/shared/ComparisonTable";
import { ArrowRight, Shield, Zap, Award, Users } from "lucide-react";

const TRUST = [
  { icon: Users, value: "1,200+", label: "Restaurants" },
  { icon: Zap, value: "<100ms", label: "POS response" },
  { icon: Shield, value: "99.95%", label: "Uptime SLA" },
  { icon: Award, value: "4.8★", label: "Customer rating" },
];

const COLUMNS = ["KhanaLagao", "Basic POS"];

const ROWS = [
  { label: "POS billing", values: [true, true] as (boolean | string)[] },
  { label: "QR menu & contactless ordering", values: [true, false] as (boolean | string)[] },
  { label: "Kitchen Display (KDS)", values: [true, false] as (boolean | string)[] },
  { label: "Recipe-linked inventory", values: [true, false] as (boolean | string)[] },
  { label: "Staff attendance & payroll", values: [true, false] as (boolean | string)[] },
  { label: "Growth campaigns (WhatsApp / SMS / Email)", values: [true, false] as (boolean | string)[] },
  { label: "Khana AI (forecasting, insights, chat)", values: [true, false] as (boolean | string)[] },
  { label: "Live P&L by outlet", values: [true, false] as (boolean | string)[] },
  { label: "Multi-outlet, central menu", values: [true, "Limited"] as (boolean | string)[] },
  { label: "Vendor & hardware marketplace", values: [true, false] as (boolean | string)[] },
  { label: "Super-admin SaaS control plane", values: [true, false] as (boolean | string)[] },
];

export function ComparisonStrip() {
  return (
    <section className="py-12 md:py-24">
      <div className="container mx-auto px-4 md:px-6 max-w-6xl">
        {/* Trust strip */}
        <div className="rounded-3xl bg-gradient-to-br from-foreground to-foreground/90 text-background p-5 md:p-8 mb-8 md:mb-14">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {TRUST.map((t) => (
              <div key={t.label} className="flex items-center gap-3">
                <span className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-primary/20 text-primary flex items-center justify-center shrink-0">
                  <t.icon className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-xl md:text-2xl font-bold tabular-nums">{t.value}</div>
                  <div className="text-xs md:text-sm text-background/70">{t.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-center max-w-3xl mx-auto mb-6 md:mb-10">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary mb-3 md:mb-4">
            How we compare
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl md:text-5xl font-bold mb-3 md:mb-5">
            KhanaLagao vs <span className="text-muted-foreground">a basic POS.</span>
          </h2>
          <p className="text-base md:text-lg text-muted-foreground">
            Most POS systems just bill. KhanaLagao runs the restaurant.
          </p>
        </div>

        <ComparisonTable columns={COLUMNS} rows={ROWS} highlightCol={0} />

        <div className="text-center mt-6 md:mt-10">
          <Link href="/compare">
            <Button variant="outline" size="lg" className="gap-2">
              See full comparison <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
