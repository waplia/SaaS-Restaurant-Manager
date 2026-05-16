import { motion } from "framer-motion";

export interface Step { title: string; desc: string }

export function HowItWorks({ title = "How it works", subtitle, steps }: { title?: string; subtitle?: string; steps: Step[] }) {
  return (
    <section className="py-12 md:py-24 bg-muted/30">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-2xl mx-auto mb-8 md:mb-14">
          <h2 className="font-serif text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-3 md:mb-4">{title}</h2>
          {subtitle && <p className="text-base md:text-lg text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="relative">
          <div className="hidden md:block absolute top-7 left-[10%] right-[10%] h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div
            className="grid grid-cols-1 md:grid-flow-col md:auto-cols-fr gap-6 md:gap-8 relative"
            style={{ gridTemplateColumns: undefined }}
          >
            {steps.map((s, i) => (
              <motion.div
                key={s.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="flex md:block items-start gap-4 md:text-center"
              >
                <div className="shrink-0 md:mx-auto md:mb-5 w-10 h-10 md:w-14 md:h-14 rounded-full bg-primary text-primary-foreground font-bold text-base md:text-lg flex items-center justify-center shadow-lg shadow-primary/30">
                  {i + 1}
                </div>
                <div className="md:text-center">
                  <h3 className="font-bold text-base md:text-lg mb-1 md:mb-2">{s.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed md:max-w-xs md:mx-auto">{s.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
