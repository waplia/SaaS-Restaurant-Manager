import { Link } from "wouter";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { Button } from "@/components/ui/button";
import { useSeo } from "@/lib/seo";
import { Search, ArrowRight, MessageCircle, HelpCircle, Home, BookOpen } from "lucide-react";
import { COMPANY } from "@/lib/company";

const QUICK_LINKS = [
  { title: "Platform overview", desc: "See the full restaurant OS", href: "/platform", icon: Home },
  { title: "All features", desc: "Browse every module", href: "/features", icon: BookOpen },
  { title: "Pricing", desc: "Simple, transparent plans", href: "/pricing", icon: Search },
  { title: "Book a demo", desc: "See KhanaLagao live", href: "/book-demo", icon: ArrowRight },
  { title: "Help center", desc: "Docs & answers", href: "/help", icon: HelpCircle },
  { title: "Contact us", desc: "Talk to a real human", href: "/contact", icon: MessageCircle },
];

export default function NotFound() {
  useSeo({ title: "Page not found", description: "The page you're looking for doesn't exist. Try one of the quick links below.", noindex: true });
  return (
    <SiteLayout>
      <section className="py-14 md:py-28">
        <div className="container mx-auto px-4 md:px-6 max-w-4xl text-center">
          <p className="text-6xl sm:text-7xl md:text-9xl font-serif font-bold tracking-tight bg-gradient-to-br from-primary via-orange-500 to-purple-600 bg-clip-text text-transparent mb-4">404</p>
          <h1 className="font-serif text-3xl md:text-5xl font-bold tracking-tight mb-4">This page didn't make it to the pass.</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            The page you're looking for moved, was retired, or never existed. Try the quick links below — or call us at {" "}
            <a href={COMPANY.phoneHref} className="text-primary font-medium hover:underline">{COMPANY.phoneDisplay}</a>.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-center mb-12">
            <Link href="/"><Button size="lg" className="gap-2">Back to home <ArrowRight className="h-4 w-4" /></Button></Link>
            <Link href="/contact"><Button size="lg" variant="outline">Contact support</Button></Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-left">
            {QUICK_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="group flex items-start gap-3 p-4 rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all">
                <span className="shrink-0 w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <l.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="font-semibold text-sm">{l.title}</p>
                  <p className="text-xs text-muted-foreground">{l.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
