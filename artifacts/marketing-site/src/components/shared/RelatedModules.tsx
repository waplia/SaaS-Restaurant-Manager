import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface RelatedItem { title: string; href: string; desc: string; icon?: LucideIcon }

export function RelatedModules({ title = "Works beautifully with", items }: { title?: string; items: RelatedItem[] }) {
  return (
    <section className="py-12 md:py-24 bg-muted/30">
      <div className="container mx-auto px-4 md:px-6">
        <h2 className="font-serif text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-6 md:mb-10 text-center">{title}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {items.map((it) => (
            <Link key={it.href} href={it.href} className="group block rounded-xl border border-border bg-card p-5 hover:border-primary/40 hover:shadow-md transition-all">
              <div className="flex items-start gap-3">
                {it.icon && (
                  <span className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <it.icon className="h-4 w-4" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold flex items-center gap-1.5 group-hover:text-primary transition-colors">
                    {it.title} <ArrowRight className="h-3.5 w-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{it.desc}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
