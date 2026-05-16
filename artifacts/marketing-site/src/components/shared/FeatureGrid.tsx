import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";

export interface FeatureItem {
  title: string;
  desc: string;
  icon: LucideIcon;
}

interface Props {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  features: FeatureItem[];
  columns?: 2 | 3 | 4;
  variant?: "default" | "muted" | "dark";
}

export function FeatureGrid({ eyebrow, title, subtitle, features, columns = 3, variant = "default" }: Props) {
  const bg = variant === "muted" ? "bg-muted/30" : variant === "dark" ? "bg-foreground text-background" : "";
  const colClass = columns === 2 ? "md:grid-cols-2" : columns === 4 ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-2 lg:grid-cols-3";
  return (
    <section className={`py-12 md:py-24 ${bg}`}>
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-3xl mx-auto mb-8 md:mb-16">
          {eyebrow && <p className="text-xs md:text-sm font-semibold uppercase tracking-widest text-primary mb-2 md:mb-3">{eyebrow}</p>}
          <h2 className="font-serif text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-3 md:mb-4">{title}</h2>
          {subtitle && <p className={`text-base md:text-lg ${variant === "dark" ? "text-background/70" : "text-muted-foreground"}`}>{subtitle}</p>}
        </div>
        <div className={`grid grid-cols-2 ${colClass} gap-3 sm:gap-4 lg:gap-6`}>
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.4, delay: Math.min(i * 0.04, 0.3) }}
              className={`group rounded-2xl border p-4 md:p-6 transition-all hover:shadow-xl hover:-translate-y-0.5 ${
                variant === "dark" ? "border-white/10 bg-white/5 hover:bg-white/10" : "border-border bg-card hover:border-primary/30"
              }`}
            >
              <div className={`w-9 h-9 md:w-11 md:h-11 rounded-xl flex items-center justify-center mb-3 md:mb-4 transition-colors ${
                variant === "dark" ? "bg-primary/20 text-primary" : "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground"
              }`}>
                <f.icon className="h-4 w-4 md:h-5 md:w-5" />
              </div>
              <h3 className="font-bold text-sm md:text-lg mb-1.5 md:mb-2 leading-tight">{f.title}</h3>
              <p className={`text-xs md:text-sm leading-relaxed ${variant === "dark" ? "text-background/70" : "text-muted-foreground"}`}>{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
