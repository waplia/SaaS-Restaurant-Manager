import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";

interface Props {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  primary?: { label: string; href: string };
  secondary?: { label: string; href: string };
}

export function CTASection({
  eyebrow = "Get started",
  title,
  subtitle = "Join hundreds of restaurants running smarter with KhanaLagao.",
  primary = { label: "Book a free demo", href: "/book-demo" },
  secondary = { label: "Start free trial", href: "/start-free-trial" },
}: Props) {
  return (
    <section className="py-20 md:py-28">
      <div className="container mx-auto px-4 md:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-foreground via-foreground to-orange-950 text-background p-10 md:p-16 text-center">
          <div className="absolute -top-32 -right-32 w-[400px] h-[400px] rounded-full bg-primary/30 blur-3xl" />
          <div className="absolute -bottom-32 -left-32 w-[400px] h-[400px] rounded-full bg-orange-500/20 blur-3xl" />
          <div className="relative z-10">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 text-primary px-3 py-1 text-xs font-semibold mb-5">
              <Sparkles className="h-3 w-3" /> {eyebrow}
            </div>
            <h2 className="font-serif text-3xl md:text-5xl font-bold tracking-tight mb-4 max-w-2xl mx-auto">{title}</h2>
            <p className="text-background/75 text-lg max-w-xl mx-auto mb-8">{subtitle}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href={primary.href}>
                <Button size="lg" className="h-12 px-7 text-base w-full sm:w-auto">
                  {primary.label} <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              {secondary && (
                <Link href={secondary.href}>
                  <Button size="lg" variant="outline" className="h-12 px-7 text-base bg-transparent border-background/30 text-background hover:bg-background hover:text-foreground w-full sm:w-auto">
                    {secondary.label}
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
