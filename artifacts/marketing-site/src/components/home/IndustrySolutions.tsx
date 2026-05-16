import { Link } from "wouter";
import {
  Utensils, Coffee, Truck, Cookie, Beer, Hotel, Store, Soup, Cake, GitBranch, Building2, ArrowRight,
} from "lucide-react";

const TYPES = [
  { icon: Utensils, title: "Restaurants", href: "/restaurant-types/restaurants" },
  { icon: Coffee, title: "Cafes", href: "/restaurant-types/cafes" },
  { icon: Truck, title: "Cloud Kitchens", href: "/restaurant-types/cloud-kitchens" },
  { icon: Cookie, title: "Bakeries", href: "/restaurant-types/bakeries" },
  { icon: Beer, title: "Bars & Pubs", href: "/restaurant-types/bars-pubs" },
  { icon: Hotel, title: "Hotels", href: "/restaurant-types/hotels" },
  { icon: Store, title: "Food Courts", href: "/restaurant-types/food-courts" },
  { icon: Soup, title: "Tiffin Services", href: "/contact" },
  { icon: Cake, title: "Catering & Banquets", href: "/contact" },
  { icon: GitBranch, title: "Franchise Chains", href: "/features/multi-outlet" },
  { icon: Building2, title: "Corporate Canteens", href: "/contact" },
];

export function IndustrySolutions() {
  return (
    <section className="py-12 md:py-24 bg-card">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-3xl mx-auto mb-8 md:mb-14">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary mb-3 md:mb-4">
            Industry solutions
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl md:text-5xl font-bold mb-3 md:mb-5">
            Built for every kind of kitchen.
          </h2>
          <p className="text-base md:text-lg text-muted-foreground">
            From a 30-cover cafe to a 200-outlet franchise — KhanaLagao is configured for the way your concept actually operates.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {TYPES.map(({ icon: Icon, title, href }) => (
            <Link key={title} href={href}>
              <div className="group h-full p-4 md:p-6 rounded-xl border border-border bg-background hover:border-primary/40 hover:shadow-md transition-all">
                <div className="mb-2.5 md:mb-4 inline-flex p-2 md:p-2.5 rounded-lg bg-primary/10">
                  <Icon className="h-4 w-4 md:h-5 md:w-5 text-primary" />
                </div>
                <h3 className="text-sm md:text-base font-semibold mb-1 md:mb-1.5 leading-tight">{title}</h3>
                <div className="hidden md:flex items-center text-xs font-medium text-primary opacity-70 group-hover:opacity-100">
                  Explore <ArrowRight className="ml-1 h-3 w-3" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
