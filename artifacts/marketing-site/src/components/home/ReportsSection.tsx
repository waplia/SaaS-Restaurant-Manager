import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  IndianRupee, Package, Users, BookOpen, Trash2, Heart, Megaphone, Wallet, Sparkles, ArrowRight,
} from "lucide-react";

const REPORTS = [
  { icon: IndianRupee, title: "Sales" },
  { icon: BookOpen, title: "Item" },
  { icon: Users, title: "Staff" },
  { icon: Package, title: "Inventory" },
  { icon: Trash2, title: "Waste" },
  { icon: Heart, title: "Customer" },
  { icon: Megaphone, title: "Campaign" },
  { icon: Wallet, title: "P&L" },
  { icon: Sparkles, title: "AI usage" },
];

export function ReportsSection() {
  return (
    <section className="py-24 bg-background">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-5">
            <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary mb-4">
              Reports
            </div>
            <h2 className="font-serif text-3xl md:text-5xl font-bold mb-5 leading-tight">
              Decisions backed by data, not by gut feel.
            </h2>
            <p className="text-lg text-muted-foreground mb-7">
              Nine report families — schedulable, exportable, drillable. Build the dashboards your
              GMs need without writing a single SQL query.
            </p>
            <Link href="/features/reports">
              <Button size="lg" variant="outline" className="border-2">
                See report library <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
          <div className="lg:col-span-7 grid grid-cols-3 gap-3">
            {REPORTS.map(({ icon: Icon, title }) => (
              <div key={title} className="aspect-square rounded-xl border border-border bg-card p-4 flex flex-col items-center justify-center text-center hover:border-primary/40 transition-colors">
                <div className="p-2.5 rounded-lg bg-primary/10 mb-3">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div className="text-sm font-semibold">{title}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
