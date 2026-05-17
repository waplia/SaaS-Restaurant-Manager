import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { LiveProductDemo, type DemoVariant } from "@/components/demos/LiveProductDemo";
import { ArrowRight, Receipt, QrCode, ChefHat, Boxes, BrainCircuit, IndianRupee } from "lucide-react";

const TABS: { id: DemoVariant; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "pos", label: "POS → KOT", icon: Receipt },
  { id: "qr", label: "QR ordering", icon: QrCode },
  { id: "kitchen", label: "Kitchen / KDS", icon: ChefHat },
  { id: "inventory", label: "Inventory", icon: Boxes },
  { id: "ai", label: "Khana AI", icon: BrainCircuit },
  { id: "finance", label: "Finance", icon: IndianRupee },
];

export function ProductTour() {
  const [active, setActive] = useState<DemoVariant>("pos");
  return (
    <section className="py-12 md:py-24 bg-gradient-to-b from-background via-muted/20 to-background">
      <div className="container mx-auto px-4 md:px-6 max-w-6xl">
        <div className="text-center max-w-3xl mx-auto mb-7 md:mb-12">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary mb-3 md:mb-4">
            Product tour
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl md:text-5xl font-bold mb-3 md:mb-5">
            See KhanaLagao <span className="text-primary">in action.</span>
          </h2>
          <p className="text-base md:text-lg text-muted-foreground">
            Switch modules to watch a real check, order, ticket, ingredient and rupee flow through every part of the platform.
          </p>
        </div>

        <div className="flex gap-1.5 md:gap-2 overflow-x-auto no-scrollbar mb-5 md:mb-6 justify-start md:justify-center pb-1">
          {TABS.map((t) => {
            const isActive = active === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 md:px-4 py-2 rounded-full text-xs md:text-sm font-semibold transition-all ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                }`}
                data-testid={`product-tour-tab-${t.id}`}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        <LiveProductDemo variant={active} />

        <div className="text-center mt-6 md:mt-10">
          <Link href="/book-demo">
            <Button size="lg" className="gap-2">
              Book a live walkthrough <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
