import type { ReactNode } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";

interface PageHeroProps {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
  breadcrumbs?: Crumb[];
  visual?: ReactNode;
  variant?: "default" | "dark";
}

export function PageHero({
  eyebrow, title, subtitle, primaryCta, secondaryCta, breadcrumbs, visual, variant = "default",
}: PageHeroProps) {
  const dark = variant === "dark";
  return (
    <section className={`relative overflow-hidden ${dark ? "bg-foreground text-background" : ""}`}>
      <div className={`absolute inset-0 -z-10 ${dark
        ? "bg-[radial-gradient(ellipse_at_top,_rgba(249,115,22,0.18),transparent_60%)]"
        : "bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/12 via-background to-background"}`} />
      <div className="absolute top-0 right-1/4 w-[600px] h-[600px] rounded-full bg-primary/10 blur-3xl -z-10" />

      <div className={`container mx-auto px-4 md:px-6 ${visual ? "grid lg:grid-cols-2 gap-12 items-center" : "max-w-4xl"} pt-12 md:pt-16 pb-16 md:pb-20`}>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="space-y-5">
          {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
          {eyebrow && (
            <div className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
              dark ? "border-primary/40 bg-primary/15 text-primary" : "border-primary/20 bg-primary/5 text-primary"
            }`}>
              <Sparkles className="h-3 w-3 mr-1.5" /> {eyebrow}
            </div>
          )}
          <h1 className={`font-serif font-bold tracking-tight leading-[1.05] ${visual ? "text-4xl md:text-5xl lg:text-6xl" : "text-4xl md:text-5xl lg:text-6xl text-center md:text-left"}`}>
            {title}
          </h1>
          {subtitle && (
            <p className={`text-lg md:text-xl leading-relaxed ${dark ? "text-background/75" : "text-muted-foreground"} ${visual ? "" : "max-w-3xl"}`}>
              {subtitle}
            </p>
          )}
          {(primaryCta || secondaryCta) && (
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              {primaryCta && (
                <Link href={primaryCta.href}>
                  <Button size="lg" className="w-full sm:w-auto h-12 px-7 text-base">
                    {primaryCta.label} <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              )}
              {secondaryCta && (
                <Link href={secondaryCta.href}>
                  <Button size="lg" variant={dark ? "secondary" : "outline"} className="w-full sm:w-auto h-12 px-7 text-base border-2">
                    {secondaryCta.label}
                  </Button>
                </Link>
              )}
            </div>
          )}
        </motion.div>
        {visual && (
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, delay: 0.15 }}>
            {visual}
          </motion.div>
        )}
      </div>
    </section>
  );
}
