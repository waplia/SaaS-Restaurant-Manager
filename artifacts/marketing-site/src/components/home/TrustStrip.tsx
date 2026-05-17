import { Link } from "wouter";
import { CASE_STUDIES } from "@/lib/caseStudies";

export function TrustStrip() {
  return (
    <section className="py-8 md:py-14 border-y border-border bg-card/60">
      <div className="container mx-auto px-4 md:px-6">
        <p className="text-center text-xs md:text-sm uppercase tracking-widest font-semibold text-muted-foreground mb-5 md:mb-7">
          Trusted by restaurants, cafes, hotels and cloud kitchens
        </p>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 md:gap-4 max-w-5xl mx-auto">
          {CASE_STUDIES.map((c) => (
            <Link
              key={c.slug}
              href={`/case-studies/${c.slug}`}
              className="group flex flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-4 md:py-5 hover:border-primary/40 hover:shadow-sm transition-all"
              title={`${c.brand} — ${c.segment}`}
            >
              <span className="font-serif text-base md:text-lg font-bold tracking-tight text-foreground/80 group-hover:text-primary transition-colors">
                {c.logoText}
              </span>
              <span className="text-[10px] md:text-[11px] text-muted-foreground text-center leading-tight line-clamp-1">
                {c.location}
              </span>
            </Link>
          ))}
        </div>
        <p className="text-center text-xs md:text-sm text-muted-foreground mt-5 md:mt-7">
          Click a logo to read their story →
        </p>
      </div>
    </section>
  );
}
