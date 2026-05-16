import type { ReactNode } from "react";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { Breadcrumbs } from "./Breadcrumbs";
import { useSeo } from "@/lib/seo";

export interface LegalSection { id: string; title: string; body: ReactNode }

interface Props {
  title: string;
  intro: ReactNode;
  lastUpdated: string;
  sections: LegalSection[];
  seoDescription: string;
}

export function LegalPageLayout({ title, intro, lastUpdated, sections, seoDescription }: Props) {
  useSeo({ title, description: seoDescription });
  return (
    <SiteLayout>
      <section className="border-b border-border bg-muted/30">
        <div className="container mx-auto px-4 md:px-6 py-12">
          <Breadcrumbs items={[{ label: "Legal" }, { label: title }]} />
          <h1 className="font-serif text-3xl md:text-5xl font-bold tracking-tight mt-4">{title}</h1>
          <p className="text-muted-foreground mt-3 max-w-3xl">{intro}</p>
          <p className="text-xs text-muted-foreground/80 mt-4">Last updated: {lastUpdated}</p>
        </div>
      </section>
      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 md:px-6 grid lg:grid-cols-[260px_1fr] gap-10">
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
            <p className="text-sm text-muted-foreground not-prose">
              Questions? Email us at <a className="text-primary font-medium hover:underline" href="mailto:support@khanalagao.app">support@khanalagao.app</a>.
            </p>
          </article>
        </div>
      </section>
    </SiteLayout>
  );
}
