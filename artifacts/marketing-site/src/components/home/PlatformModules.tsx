import { Link } from "wouter";
import {
  Smartphone, ShoppingBag, ChefHat, LayoutGrid, BookOpen, Package,
  Users, Heart, TrendingUp, Sparkles, Wallet, BarChart3, ArrowRight,
} from "lucide-react";

const MODULES = [
  { icon: Smartphone, title: "POS Terminal", desc: "Lightning-fast billing with offline mode, split bills and KOT prints.", href: "/features/pos-billing" },
  { icon: ShoppingBag, title: "Orders", desc: "Dine-in, takeaway, delivery and online orders in one queue.", href: "/features/online-ordering" },
  { icon: ChefHat, title: "Kitchen / KDS", desc: "Course-wise KOT routing, prep timers and station displays.", href: "/features/pos-billing" },
  { icon: LayoutGrid, title: "Tables", desc: "Floor map, merge/transfer, waitlist and seat-level billing.", href: "/features/pos-billing" },
  { icon: BookOpen, title: "Menu", desc: "Central menu, modifiers, variants and branch-level pricing.", href: "/features/qr-menu" },
  { icon: Package, title: "Inventory", desc: "Recipe-level deduction, batch tracking, transfers and waste.", href: "/features/inventory-management" },
  { icon: Users, title: "Staff & Payroll", desc: "Attendance, shifts, tips, advances and payslips in one click.", href: "/features/payroll" },
  { icon: Heart, title: "Customers & Loyalty", desc: "Guest profiles, points, tiers and stored value built in.", href: "/features/online-ordering" },
  { icon: TrendingUp, title: "Growth Engine", desc: "Campaigns, win-back, referrals and review automation.", href: "/features" },
  { icon: Sparkles, title: "Khana AI", desc: "AI insights for menu, pricing, demand and marketing.", href: "/features" },
  { icon: Wallet, title: "Finance & P&L", desc: "Sales, expenses, food cost, settlements and live P&L.", href: "/features/reports" },
  { icon: BarChart3, title: "Reports", desc: "Sales, items, staff, inventory, waste, campaign analytics.", href: "/features/reports" },
];

export function PlatformModules() {
  return (
    <section className="py-12 md:py-24 bg-background">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-3xl mx-auto mb-8 md:mb-14">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary mb-3 md:mb-4">
            Platform modules
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl md:text-5xl font-bold mb-3 md:mb-5">
            12 modules. One login. Zero juggling.
          </h2>
          <p className="text-base md:text-lg text-muted-foreground">
            Each module ships production-ready and integrates natively with the rest — so your data stays consistent and your team stays sane.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 md:gap-5">
          {MODULES.map(({ icon: Icon, title, desc, href }) => (
            <Link key={title} href={href}>
              <div className="group h-full p-4 md:p-6 rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5 transition-all">
                <div className="mb-2.5 md:mb-4 inline-flex p-2 md:p-2.5 rounded-lg bg-primary/10">
                  <Icon className="h-4 w-4 md:h-5 md:w-5 text-primary" />
                </div>
                <h3 className="text-sm md:text-base font-bold mb-1 md:mb-1.5 leading-tight">{title}</h3>
                <p className="text-xs md:text-sm text-muted-foreground leading-relaxed mb-2 md:mb-3 line-clamp-3 md:line-clamp-none">{desc}</p>
                <div className="hidden md:flex items-center text-xs font-medium text-primary opacity-70 group-hover:opacity-100">
                  Learn more <ArrowRight className="ml-1 h-3 w-3" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
