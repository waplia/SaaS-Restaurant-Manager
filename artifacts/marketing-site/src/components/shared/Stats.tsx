import { motion } from "framer-motion";

export interface Stat { value: string; label: string; sub?: string }

const COL_CLASS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};

export function Stats({ items, variant = "default" }: { items: Stat[]; variant?: "default" | "dark" }) {
  const dark = variant === "dark";
  const cols = Math.min(Math.max(items.length, 1), 4);
  return (
    <section className={`py-10 md:py-20 ${dark ? "bg-foreground text-background" : "bg-muted/40"}`}>
      <div className="container mx-auto px-4 md:px-6">
        <div className={`grid grid-cols-2 ${COL_CLASS[cols]} gap-6 md:gap-8 text-center`}>
          {items.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
            >
              <div className="font-serif text-3xl md:text-5xl font-bold text-primary">{s.value}</div>
              <div className={`mt-1.5 md:mt-2 text-xs md:text-sm font-medium ${dark ? "text-background/80" : "text-foreground"}`}>{s.label}</div>
              {s.sub && <div className={`text-[11px] md:text-xs mt-0.5 md:mt-1 ${dark ? "text-background/60" : "text-muted-foreground"}`}>{s.sub}</div>}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
