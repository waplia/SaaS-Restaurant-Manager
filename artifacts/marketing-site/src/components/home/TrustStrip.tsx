import {
  Smartphone, QrCode, Package, Users, TrendingUp, Sparkles, Wallet, BarChart3,
} from "lucide-react";

const ITEMS = [
  { icon: Smartphone, label: "POS" },
  { icon: QrCode, label: "QR Menu" },
  { icon: Package, label: "Inventory" },
  { icon: Users, label: "Payroll" },
  { icon: TrendingUp, label: "Growth" },
  { icon: Sparkles, label: "AI" },
  { icon: Wallet, label: "Finance" },
  { icon: BarChart3, label: "Reports" },
];

export function TrustStrip() {
  return (
    <section className="py-14 border-y border-border bg-card/60">
      <div className="container mx-auto px-4 md:px-6">
        <p className="text-center text-sm md:text-base text-muted-foreground mb-8 max-w-2xl mx-auto">
          Everything your restaurant needs to <span className="text-foreground font-medium">sell, serve, manage and grow.</span>
        </p>
        <div className="grid grid-cols-4 md:grid-cols-8 gap-4 md:gap-2 max-w-5xl mx-auto">
          {ITEMS.map(({ icon: Icon, label }) => (
            <div key={label} className="flex flex-col items-center gap-2 text-muted-foreground hover:text-primary transition-colors">
              <div className="h-11 w-11 rounded-xl bg-background border border-border flex items-center justify-center">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div className="text-xs md:text-sm font-medium">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
