import { Link } from "wouter";
import { ChevronRight, Home } from "lucide-react";

export interface Crumb { label: string; href?: string }

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link href="/" className="inline-flex items-center hover:text-foreground"><Home className="h-3.5 w-3.5" /></Link>
        </li>
        {items.map((c, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
            {c.href ? (
              <Link href={c.href} className="hover:text-foreground">{c.label}</Link>
            ) : (
              <span className="text-foreground font-medium">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
