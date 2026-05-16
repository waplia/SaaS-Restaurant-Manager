import { CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";

export interface Benefit { title: string; desc: string }

export function Benefits({ eyebrow = "Why it matters", title, benefits, visual }: { eyebrow?: string; title: string; benefits: Benefit[]; visual?: React.ReactNode }) {
  return (
    <section className="py-20 md:py-24">
      <div className={`container mx-auto px-4 md:px-6 ${visual ? "grid lg:grid-cols-2 gap-12 items-center" : "max-w-4xl"}`}>
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-3">{eyebrow}</p>
          <h2 className="font-serif text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-8">{title}</h2>
          <ul className="space-y-5">
            {benefits.map((b, i) => (
              <motion.li
                key={b.title}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.35, delay: i * 0.05 }}
                className="flex gap-4"
              >
                <CheckCircle2 className="h-6 w-6 text-primary shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold mb-1">{b.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{b.desc}</p>
                </div>
              </motion.li>
            ))}
          </ul>
        </div>
        {visual && <div className="relative">{visual}</div>}
      </div>
    </section>
  );
}
