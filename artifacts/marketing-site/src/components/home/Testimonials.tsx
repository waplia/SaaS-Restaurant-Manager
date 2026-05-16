import { Star, Quote } from "lucide-react";

interface Testimonial {
  name: string;
  role: string;
  brand: string;
  rating: number;
  quote: string;
  initial: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    name: "Rohan Mehta",
    role: "Owner",
    brand: "Sutra Modern Indian, Mumbai",
    rating: 5,
    quote: "We replaced three apps with Khana Lagao on day one. Food cost dropped 4% in the first month — and our manager actually leaves the floor before midnight now.",
    initial: "S",
  },
  {
    name: "Aarti Iyer",
    role: "COO",
    brand: "Café Lumiere · 12 outlets",
    rating: 5,
    quote: "Central menu and branch pricing finally work the way I always imagined. Roll-up reports across 12 outlets land on my phone every morning at 8am.",
    initial: "C",
  },
  {
    name: "Vikram Singh",
    role: "Founder",
    brand: "Hot Tawa Cloud Kitchens",
    rating: 5,
    quote: "Zomato, Swiggy and our own app in one inbox. Khana AI tells us what to prep tomorrow. We've cut wastage in half.",
    initial: "H",
  },
  {
    name: "Neha Kapoor",
    role: "GM",
    brand: "The Bakehouse, Delhi",
    rating: 5,
    quote: "Pre-orders, wholesale and walk-ins under one POS. Production planner alone has saved us two hours every morning.",
    initial: "B",
  },
  {
    name: "Imran Sayed",
    role: "Director",
    brand: "Brewski Bars · 7 outlets",
    rating: 5,
    quote: "Pour-cost reports caught a leak in week two. Honestly the system paid for itself before we'd even rolled it out everywhere.",
    initial: "B",
  },
  {
    name: "Priya Nair",
    role: "F&B Head",
    brand: "Coastline Resort",
    rating: 5,
    quote: "Room-charge posting to our PMS just works. Banquet billing, multi-outlet F&B and live P&L in one place — exactly what hotel ops needed.",
    initial: "C",
  },
];

export function Testimonials() {
  return (
    <section className="py-24 bg-card">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary mb-4">
            Testimonials
          </div>
          <h2 className="font-serif text-3xl md:text-5xl font-bold mb-5">
            Loved by restaurants that care about the details.
          </h2>
          <p className="text-lg text-muted-foreground">
            Independent cafes, multi-outlet chains, cloud kitchens and luxury hotels — all running on Khana Lagao.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {TESTIMONIALS.map(t => (
            <article key={t.brand} className="rounded-xl border border-border bg-background p-6 flex flex-col">
              <Quote className="h-6 w-6 text-primary/40 mb-3" />
              <div className="flex items-center gap-0.5 mb-3">
                {[1, 2, 3, 4, 5].map(i => (
                  <Star key={i} className={`h-4 w-4 ${i <= t.rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
                ))}
              </div>
              <p className="text-sm leading-relaxed text-foreground/90 flex-1">{t.quote}</p>
              <div className="mt-5 pt-4 border-t border-border flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                  {t.initial}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{t.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{t.role} · {t.brand}</div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
