import type { ReactNode } from "react";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { Breadcrumbs } from "./Breadcrumbs";
import { useSeo } from "@/lib/seo";
import { COMPANY } from "@/lib/company";


export interface LegalSection { id: string; title: string; body: ReactNode }

interface Props {
  title: string;
  intro: ReactNode;
  lastUpdated: string;
  sections: LegalSection[];
  seoDescription: string;
}

export function LegalPageLayout({ title, intro, lastUpdated, sections, seoDescription }: Props) {
  useSeo({
    title,
    description: seoDescription,
    breadcrumbs: [
      { label: "Home", href: "/" },
      { label: "Legal", href: "/legal" },
      { label: title },
    ],
  });
  return (
    <SiteLayout>
      <section className="border-b border-border bg-muted/30">
        <div className="container mx-auto px-4 md:px-6 py-8 md:py-12">
          <Breadcrumbs items={[{ label: "Legal" }, { label: title }]} />
          <h1 className="font-serif text-2xl sm:text-3xl md:text-5xl font-bold tracking-tight mt-3 md:mt-4">{title}</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-2 md:mt-3 max-w-3xl">{intro}</p>
          <p className="text-xs text-muted-foreground/80 mt-3 md:mt-4">Last updated: {lastUpdated}</p>
        </div>
      </section>
      <section className="py-8 md:py-16">
        <div className="container mx-auto px-4 md:px-6 grid lg:grid-cols-[260px_1fr] gap-6 lg:gap-10">
          <details className="lg:hidden rounded-xl border border-border bg-card overflow-hidden">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold flex items-center justify-between">
              On this page
              <span className="text-xs text-muted-foreground">{sections.length} sections</span>
            </summary>
            <div className="px-2 pb-2 space-y-0.5 border-t border-border">
              {sections.map(s => (
                <a key={s.id} href={`#${s.id}`} className="block text-sm py-2 px-3 rounded text-foreground/80 hover:text-foreground hover:bg-accent transition-colors">
                  {s.title}
                </a>
              ))}
            </div>
          </details>
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">On this page</p>
              {sections.map(s => (
                <a key={s.id} href={`#${s.id}`} className="block text-sm py-1.5 px-2 -mx-2 rounded text-foreground/70 hover:text-foreground hover:bg-accent transition-colors">
                  {s.title}
                </a>
              ))}
            </div>
          </aside>
          <article className="prose prose-neutral dark:prose-invert max-w-none prose-headings:font-serif prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-3 prose-h2:font-bold prose-p:leading-relaxed prose-li:marker:text-primary">
            {sections.map(s => (
              <section key={s.id} id={s.id} className="scroll-mt-24">
                <h2>{s.title}</h2>
                {s.body}
              </section>
            ))}
            <hr className="my-10 border-border" />
            <div className="not-prose rounded-xl border border-border bg-muted/40 p-5 text-sm space-y-1.5">
              <p className="font-semibold text-foreground">Contact — {COMPANY.legalName}</p>
              <p className="text-muted-foreground">{COMPANY.fullAddress}</p>
              <p className="text-muted-foreground">
                Phone: <a className="text-primary font-medium hover:underline" href={COMPANY.phoneHref}>{COMPANY.phoneDisplay}</a>
                {"  ·  "}
                WhatsApp: <a className="text-primary font-medium hover:underline" href={COMPANY.whatsappUrl} target="_blank" rel="noreferrer">{COMPANY.phoneDisplay}</a>
              </p>
              <p className="text-muted-foreground">
                Email: <a className="text-primary font-medium hover:underline" href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>
              </p>
              <p className="text-muted-foreground italic pt-1">{COMPANY.proudlyBuiltLine}</p>
            </div>
          </article>
        </div>
      </section>
    </SiteLayout>
  );
}
