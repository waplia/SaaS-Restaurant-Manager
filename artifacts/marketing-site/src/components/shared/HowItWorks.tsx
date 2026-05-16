import { motion } from "framer-motion";

export interface Step { title: string; desc: string }

export function HowItWorks({ title = "How it works", subtitle, steps }: { title?: string; subtitle?: string; steps: Step[] }) {
  return (
    <section className="py-20 md:py-24 bg-muted/30">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="font-serif text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-4">{title}</h2>
          {subtitle && <p className="text-lg text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="relative">
          <div className="hidden md:block absolute top-7 left-[10%] right-[10%] h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className={`grid grid-cols-1 md:grid-cols-${Math.min(steps.length, 5)} gap-8 relative`}>
            {steps.map((s, i) => (
              <motion.div
                key={s.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="text-center"
              >
                <div className="mx-auto mb-5 w-14 h-14 rounded-full bg-primary text-primary-foreground font-bold text-lg flex items-center justify-center shadow-lg shadow-primary/30">
                  {i + 1}
                </div>
                <h3 className="font-bold text-lg mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
