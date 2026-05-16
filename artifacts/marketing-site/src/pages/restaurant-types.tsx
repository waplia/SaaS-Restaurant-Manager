import { useSeo } from "@/lib/seo";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { useParams, Link } from "wouter";
import NotFound from "@/pages/not-found";
import { LeadForm } from "@/components/LeadForm";
import { Check } from "lucide-react";

interface TypeInfo {
  title: string;
  desc: string;
  highlights: string[];
}

const TYPES: Record<string, TypeInfo> = {
  restaurants: {
    title: "Full-Service Restaurants",
    desc: "Elevate dine-in service with table-mapped POS, KOT routing, and guest profiles that turn occasional diners into regulars.",
    highlights: [
      "Table-mapped POS with seat-level billing and split checks",
      "KDS that routes courses to the right station automatically",
      "Guest preferences and allergy notes follow them every visit",
      "Reservations and waitlists synced to floor occupancy",
    ],
  },
  cafes: {
    title: "Cafes & Coffee Shops",
    desc: "Keep the morning rush moving with one-tap modifiers, loyalty stamps, and a barista display that never misses an order.",
    highlights: [
      "Lightning-fast order entry with saved modifier combos",
      "Loyalty rewards and stored value built in — no extra app",
      "Counter and barista displays for grab-and-go flow",
      "Daily prep and waste tracking for pastries and milks",
    ],
  },
  "cloud-kitchens": {
    title: "Cloud Kitchens",
    desc: "Run every aggregator from one screen, balance prep across brands, and protect margins on every delivery rupee.",
    highlights: [
      "Unified inbox for Zomato, Swiggy, UberEats and direct orders",
      "Per-brand menus with shared inventory and recipe costing",
      "Rider dispatch and live order timers per channel",
      "Profitability per platform, per item, per hour",
    ],
  },
  bakeries: {
    title: "Bakeries & Patisseries",
    desc: "Manage pre-orders, wholesale customers, and daily production batches without losing track of a single tray.",
    highlights: [
      "Pre-orders with deposits, pickup slots and cake customisation",
      "Wholesale accounts with credit terms and statement billing",
      "Production planner that converts orders into batch sheets",
      "Recipe-level costing so every bake holds its margin",
    ],
  },
  "bars-pubs": {
    title: "Bars & Pubs",
    desc: "Open tabs, transfer them between staff, settle by card or cash, and reconcile every bottle at close — without the spreadsheet.",
    highlights: [
      "Tab-based POS with name/card holds and seamless transfers",
      "Pour-cost tracking by recipe, brand, and bartender",
      "Happy hour and dynamic pricing rules",
      "Nightly cash-up with variance flags by drawer",
    ],
  },
  hotels: {
    title: "Hotels & Resorts",
    desc: "F&B that talks to your PMS — room charges, banquet billing, and outlet-by-outlet performance, all in one place.",
    highlights: [
      "Room-charge posting with PMS sync and folio reconciliation",
      "Multi-outlet F&B (restaurant, bar, room service, banquet) in one POS",
      "Banquet event billing with deposits and BEO tracking",
      "Department-level P&L with covers, average check, and labor %",
    ],
  },
  "food-courts": {
    title: "Food Courts",
    desc: "One central kiosk, many kitchens. Split orders to the right counter and settle vendor commissions automatically.",
    highlights: [
      "Central self-order kiosks with brand-aware order routing",
      "Vendor-level revenue tracking and automated settlement",
      "Shared loyalty wallet across every counter",
      "Live wait-time and ready-board displays",
    ],
  },
};

export default function RestaurantTypes() {
  const params = useParams();
  const type = params.type as string;

  if (!type || !TYPES[type]) {
    return <NotFound />;
  }

  const data = TYPES[type];

  useSeo({
    title: `KhanaLagao for ${data.title}`,
    description: data.desc,
  });

  return (
    <SiteLayout>
      <div className="pt-12 md:pt-24 pb-16 md:pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10 md:mb-16">
              <p className="text-xs md:text-sm uppercase tracking-widest text-primary font-semibold mb-2 md:mb-3">Built for {data.title}</p>
              <h1 className="font-serif text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight mb-4 md:mb-6 leading-tight" data-testid="text-type-title">
                The KhanaLagao OS for {data.title}
              </h1>
              <p className="text-base md:text-xl text-muted-foreground">{data.desc}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mb-10 md:mb-16">
              {data.highlights.map((h) => (
                <div key={h} className="flex gap-3 p-4 md:p-5 rounded-2xl border border-border bg-card">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center">
                    <Check className="w-4 h-4" />
                  </div>
                  <p className="text-sm leading-relaxed">{h}</p>
                </div>
              ))}
            </div>

            <div className="bg-card p-5 md:p-8 rounded-2xl border border-border shadow-lg mb-10 md:mb-16">
              <h3 className="text-xl md:text-2xl font-bold font-serif mb-2 text-center">Talk to a {data.title.toLowerCase()} specialist</h3>
              <p className="text-sm md:text-base text-muted-foreground text-center mb-5 md:mb-6">No slide deck. A working tour of KhanaLagao on real data from a venue like yours.</p>
              <LeadForm source={`type_${type}`} showDetails />
            </div>

            <div className="mt-14 md:mt-24">
              <h4 className="font-bold text-base md:text-lg mb-4 md:mb-6 text-center">Explore other business types</h4>
              <div className="-mx-4 px-4 flex md:flex-wrap gap-2 md:gap-3 md:justify-center overflow-x-auto no-scrollbar">
                {Object.entries(TYPES).map(([key, val]) => (
                  <Link
                    key={key}
                    href={`/restaurant-types/${key}`}
                    className={`shrink-0 px-3.5 md:px-4 py-2 rounded-full border text-sm font-medium transition-colors whitespace-nowrap ${
                      key === type ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"
                    }`}
                    data-testid={`link-type-${key}`}
                  >
                    {val.title}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
