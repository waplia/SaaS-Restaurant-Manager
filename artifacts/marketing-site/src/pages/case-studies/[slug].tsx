import { Link, useRoute } from "wouter";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { CTASection } from "@/components/shared/CTASection";
import { useSeo } from "@/lib/seo";
import { CASE_STUDIES, getCaseStudy } from "@/lib/caseStudies";
import { ArrowLeft, ArrowRight, CheckCircle2, MapPin, Quote, Sparkles, Calendar, Building2 } from "lucide-react";
import NotFound from "@/pages/not-found";

export default function CaseStudyDetail() {
  const [, params] = useRoute<{ slug: string }>("/case-studies/:slug");
  const slug = params?.slug ?? "";
  const story = getCaseStudy(slug);

  useSeo({
    title: story ? `${story.brand} case study | KhanaLagao` : "Case study | KhanaLagao",
    description: story?.summary ?? "Customer case study",
  });

  if (!story) return <NotFound />;

  const others = CASE_STUDIES.filter((c) => c.slug !== story.slug).slice(0, 3);
  const Icon = story.icon;

  return (
    <SiteLayout>
      <section className={`pt-14 md:pt-24 pb-10 bg-gradient-to-br ${story.accent}`}>
        <div className="container mx-auto px-4 md:px-6 max-w-5xl">
          <Link href="/case-studies" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft className="h-3.5 w-3.5" /> All case studies
          </Link>
          <div className="flex items-center gap-3 mb-5">
            <span className="w-12 h-12 rounded-xl bg-background border border-border flex items-center justify-center">
              <Icon className="h-6 w-6 text-primary" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground">{story.segment}</p>
              <p className="text-sm font-semibold flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-muted-foreground" />{story.location}</p>
            </div>
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-4">
            {story.brand}: <span className="text-primary">{story.title}</span>
          </h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-3xl">{story.summary}</p>

          <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-border bg-background/80 backdrop-blur p-4">
              <p className="font-serif text-2xl md:text-3xl font-bold text-primary">{story.heroMetric.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{story.heroMetric.label}</p>
            </div>
            {story.metrics.map((m) => (
              <div key={m.v} className="rounded-xl border border-border bg-background/80 backdrop-blur p-4">
                <p className="font-serif text-2xl md:text-3xl font-bold">{m.k}</p>
                <p className="text-xs text-muted-foreground mt-1">{m.v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 md:py-20">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-10">
            <Block title="The problem" items={story.problem} tone="problem" />
            <Block title="What we did" items={story.solution} tone="solution" />
            <Block title="The result" items={story.result} tone="result" />

            <figure className="rounded-2xl border border-primary/20 bg-primary/5 p-6 md:p-8">
              <Quote className="h-7 w-7 text-primary/60 mb-3" />
              <blockquote className="font-serif text-lg md:text-2xl leading-relaxed text-foreground">
                "{story.quote.text}"
              </blockquote>
              <figcaption className="mt-5 pt-5 border-t border-primary/15 flex items-center gap-3">
                <div className="h-11 w-11 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold">
                  {story.brand.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-semibold">{story.quote.name}</p>
                  <p className="text-xs text-muted-foreground">{story.quote.role}</p>
                </div>
              </figcaption>
            </figure>
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground mb-3">Quick facts</p>
              <ul className="space-y-3 text-sm">
                <li className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /> {story.outlets} outlet{story.outlets === 1 ? "" : "s"} live</li>
                <li className="flex items-center gap-2"><Calendar className="h-4 w-4 text-primary" /> Rolled out in {story.rolloutWeeks} weeks</li>
                <li className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> {story.location}</li>
                <li className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> {story.segment}</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-sm font-semibold mb-2">Want similar numbers?</p>
              <p className="text-xs text-muted-foreground mb-4">See a personalised demo built around your menu and outlets.</p>
              <Link href="/book-demo" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                Book a free demo <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </aside>
        </div>
      </section>

      <section className="py-12 md:py-16 bg-card">
        <div className="container mx-auto px-4 md:px-6 max-w-6xl">
          <h2 className="font-serif text-2xl md:text-3xl font-bold mb-6">More customer stories</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {others.map((o) => {
              const OIcon = o.icon;
              return (
                <Link key={o.slug} href={`/case-studies/${o.slug}`} className="group rounded-2xl border border-border bg-background p-5 hover:border-primary/40 hover:shadow-md transition-all">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><OIcon className="h-4 w-4" /></span>
                    <span className="text-xs text-muted-foreground">{o.segment}</span>
                  </div>
                  <p className="font-serif text-lg font-bold leading-snug mb-1 group-hover:text-primary transition-colors">{o.brand}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{o.title}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <CTASection title="Want to be our next case study?" subtitle="Book a demo, get onboarded, and we'll measure the change together." />
    </SiteLayout>
  );
}

function Block({ title, items, tone }: { title: string; items: string[]; tone: "problem" | "solution" | "result" }) {
  const toneClass =
    tone === "problem"
      ? "border-rose-500/30 bg-rose-500/5 text-rose-600 dark:text-rose-400"
      : tone === "solution"
      ? "border-primary/30 bg-primary/5 text-primary"
      : "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400";
  return (
    <div>
      <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold mb-4 ${toneClass}`}>
        {title}
      </div>
      <ul className="space-y-3">
        {items.map((it) => (
          <li key={it} className="flex gap-3 text-sm md:text-base text-foreground/90 leading-relaxed">
            <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
