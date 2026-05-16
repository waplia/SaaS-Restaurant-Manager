import { motion } from "framer-motion";

export interface Stat { value: string; label: string; sub?: string }

export function Stats({ items, variant = "default" }: { items: Stat[]; variant?: "default" | "dark" }) {
  const dark = variant === "dark";
  return (
    <section className={`py-16 md:py-20 ${dark ? "bg-foreground text-background" : "bg-muted/40"}`}>
      <div className="container mx-auto px-4 md:px-6">
        <div className={`grid grid-cols-2 md:grid-cols-${Math.min(items.length, 4)} gap-8 text-center`}>
          {items.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
            >
              <div className={`font-serif text-4xl md:text-5xl font-bold ${dark ? "text-primary" : "text-primary"}`}>{s.value}</div>
              <div className={`mt-2 text-sm font-medium ${dark ? "text-background/80" : "text-foreground"}`}>{s.label}</div>
              {s.sub && <div className={`text-xs mt-1 ${dark ? "text-background/60" : "text-muted-foreground"}`}>{s.sub}</div>}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
