import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  IndianRupee, Receipt, ChefHat, Users, Trash2, CreditCard, BarChart3, Wallet, FileText, ArrowRight,
} from "lucide-react";

const ITEMS = [
  { icon: IndianRupee, title: "Sales" },
  { icon: Receipt, title: "Expenses" },
  { icon: ChefHat, title: "Food cost" },
  { icon: Users, title: "Staff cost" },
  { icon: Trash2, title: "Wastage" },
  { icon: CreditCard, title: "Settlements" },
  { icon: BarChart3, title: "Live P&L" },
  { icon: Wallet, title: "Wallet" },
  { icon: FileText, title: "Invoices" },
];

export function FinanceSection() {
  return (
    <section className="relative py-28 overflow-hidden bg-foreground text-background">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(249,115,22,0.18),_transparent_55%)]" />
      <div className="container mx-auto px-4 md:px-6 relative">
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-5">
            <div className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 mb-4">
              Finance &amp; Profit
            </div>
            <h2 className="font-serif text-3xl md:text-5xl font-bold mb-5 leading-tight">
              Know your numbers <span className="text-primary">before your accountant does.</span>
            </h2>
            <p className="text-lg text-white/70 mb-7">
              Every sale, expense, settlement and salary flows into one live P&amp;L. No more month-end surprises,
              no more spreadsheets, no more guessing whether last week was actually profitable.
            </p>
            <Link href="/features/reports">
              <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground">
                See finance tools <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
          <div className="lg:col-span-7 grid grid-cols-3 gap-3">
            {ITEMS.map(({ icon: Icon, title }) => (
              <div key={title} className="aspect-square rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur p-4 flex flex-col items-center justify-center text-center hover:bg-white/[0.08] transition-colors">
                <div className="p-2.5 rounded-lg bg-primary/15 mb-3">
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
