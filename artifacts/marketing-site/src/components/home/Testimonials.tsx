import { Link } from "wouter";
import { Star, Quote, ArrowRight } from "lucide-react";
import { CASE_STUDIES } from "@/lib/caseStudies";

export function Testimonials() {
  const testimonials = CASE_STUDIES.map((c) => ({
    slug: c.slug,
    brand: `${c.brand} · ${c.segment.split(" · ")[0]}`,
    name: c.quote.name,
    role: c.quote.role,
    quote: c.quote.text,
    initial: c.brand.charAt(0),
    metric: c.heroMetric,
  }));

  return (
    <section className="py-12 md:py-24 bg-card">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-3xl mx-auto mb-8 md:mb-14">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary mb-3 md:mb-4">
            Testimonials
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl md:text-5xl font-bold mb-3 md:mb-5">
            Loved by restaurants that care about the details.
          </h2>
          <p className="text-base md:text-lg text-muted-foreground">
            Real quotes pulled straight from our customer case studies — independent cafes, multi-outlet chains, cloud kitchens and luxury hotels.
          </p>
        </div>
        {/* Mobile: horizontal snap carousel */}
        <div className="md:hidden -mx-4 px-4 flex gap-3 overflow-x-auto no-scrollbar scroll-snap-x pb-2">
          {testimonials.map((t) => (
            <Link key={t.slug} href={`/case-studies/${t.slug}`} className="shrink-0 snap-card w-[85%] rounded-xl border border-border bg-background p-5 flex flex-col">
              <Quote className="h-5 w-5 text-primary/40 mb-2" />
              <div className="flex items-center gap-0.5 mb-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                ))}
              </div>
              <p className="text-sm leading-relaxed text-foreground/90 flex-1">"{t.quote}"</p>
              <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                {t.metric.value} {t.metric.label}
              </div>
              <div className="mt-4 pt-3 border-t border-border flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">{t.initial}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{t.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{t.role}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
        <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {testimonials.map((t) => (
            <Link key={t.slug} href={`/case-studies/${t.slug}`} className="group rounded-xl border border-border bg-background p-6 flex flex-col hover:border-primary/40 hover:shadow-md transition-all">
              <Quote className="h-6 w-6 text-primary/40 mb-3" />
              <div className="flex items-center gap-0.5 mb-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                ))}
              </div>
              <p className="text-sm leading-relaxed text-foreground/90 flex-1">"{t.quote}"</p>
              <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                {t.metric.value} {t.metric.label}
              </div>
              <div className="mt-5 pt-4 border-t border-border flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                  {t.initial}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{t.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{t.role}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
              </div>
            </Link>
          ))}
        </div>
        <div className="text-center mt-8 md:mt-10">
          <Link href="/case-studies" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
            Read all customer case studies <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
