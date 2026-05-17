/**
 * Lightweight, CSS-driven "live product demo" animations.
 *
 * Each variant tells one short story (POS → KOT → kitchen, etc.) using
 * staged CSS keyframes. Animations pause when off-screen and respect
 * `prefers-reduced-motion`.
 */
import { useEffect, useRef, useState } from "react";
import {
  Receipt, ChefHat, Boxes, IndianRupee, QrCode, BrainCircuit,
  CheckCircle2, ArrowRight, Sparkles, Bell, Flame, Package, TrendingUp,
} from "lucide-react";

export type DemoVariant = "pos" | "qr" | "kitchen" | "inventory" | "ai" | "finance";

interface Step {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail: string;
  tone: string;
}

const VARIANTS: Record<DemoVariant, { title: string; subtitle: string; steps: Step[] }> = {
  pos: {
    title: "From order to KOT in under a second",
    subtitle: "Watch a real check flow through KhanaLagao.",
    steps: [
      { icon: Receipt, label: "POS · Check #142", detail: "Paneer Tikka · Butter Naan x4 · Mojito x2", tone: "from-primary to-orange-500" },
      { icon: ChefHat, label: "KOT printed", detail: "Tandoor station → 2 items · Bar → 1 item", tone: "from-amber-500 to-amber-600" },
      { icon: Flame, label: "Kitchen cooking", detail: "Live timers on KDS · 02:14 elapsed", tone: "from-red-500 to-red-600" },
      { icon: Boxes, label: "Stock deducted", detail: "Paneer −200g · Butter −60g · Mint −12g", tone: "from-emerald-500 to-emerald-600" },
      { icon: IndianRupee, label: "Sales updated", detail: "Today ₹1,42,800 · +₹920 just now", tone: "from-purple-500 to-purple-600" },
    ],
  },
  qr: {
    title: "Guests order from the table — staff stay focused",
    subtitle: "Every QR scan flows straight to your KDS.",
    steps: [
      { icon: QrCode, label: "Guest scans QR", detail: "Table 12 opens menu in 2s", tone: "from-primary to-orange-500" },
      { icon: Receipt, label: "Order placed", detail: "2× Pizza Margherita · 1× Garlic Bread · 1× Coke", tone: "from-blue-500 to-blue-600" },
      { icon: Bell, label: "Captain notified", detail: "Push to ops app · Confirm + send", tone: "from-amber-500 to-amber-600" },
      { icon: ChefHat, label: "KOT to kitchen", detail: "Routes by station · pizza oven + cold prep", tone: "from-red-500 to-red-600" },
      { icon: CheckCircle2, label: "Bill ready at table", detail: "Pay UPI · split · receipt on WhatsApp", tone: "from-emerald-500 to-emerald-600" },
    ],
  },
  kitchen: {
    title: "Kitchen tickets that stay in sync",
    subtitle: "Color-coded urgency · station routing · auto-bump.",
    steps: [
      { icon: Receipt, label: "New ticket lands", detail: "T7 · 3 items · auto-routed", tone: "from-primary to-orange-500" },
      { icon: Flame, label: "Cooking ▸ 02:14", detail: "Green · within target", tone: "from-emerald-500 to-emerald-600" },
      { icon: ChefHat, label: "Station bump", detail: "Tandoor done → goes to expo", tone: "from-amber-500 to-amber-600" },
      { icon: Bell, label: "Pickup alert", detail: "Captain + table screen · ready", tone: "from-blue-500 to-blue-600" },
      { icon: CheckCircle2, label: "Marked served", detail: "Average ticket time 6m 12s · −18%", tone: "from-purple-500 to-purple-600" },
    ],
  },
  inventory: {
    title: "Stock that deducts itself",
    subtitle: "Recipe-linked inventory. No more end-of-day surprises.",
    steps: [
      { icon: Receipt, label: "Order sent", detail: "1× Dal Makhani · 2× Butter Naan", tone: "from-primary to-orange-500" },
      { icon: Package, label: "Recipe expanded", detail: "Urad dal 80g · Butter 30g · Atta 240g", tone: "from-blue-500 to-blue-600" },
      { icon: Boxes, label: "Stock deducted", detail: "Live ingredient counts update", tone: "from-amber-500 to-amber-600" },
      { icon: Sparkles, label: "Par check", detail: "Basmati 6 kg ≤ par 25 · auto-PO drafted", tone: "from-red-500 to-red-600" },
      { icon: CheckCircle2, label: "Owner approves", detail: "PO sent to Sharma Traders · 1 click", tone: "from-emerald-500 to-emerald-600" },
    ],
  },
  ai: {
    title: "Khana AI turns data into action",
    subtitle: "From insight to live campaign in 30 seconds.",
    steps: [
      { icon: BrainCircuit, label: "Spot the pattern", detail: "Paneer Tikka trending +38% on Fridays", tone: "from-purple-500 to-purple-600" },
      { icon: TrendingUp, label: "Forecast", detail: "Push tonight · projected +₹86,400 revenue", tone: "from-primary to-orange-500" },
      { icon: Sparkles, label: "Draft campaign", detail: "WhatsApp copy · combo offer · target 1,842 guests", tone: "from-amber-500 to-amber-600" },
      { icon: Bell, label: "Owner approves", detail: "1 tap · sent at 5pm", tone: "from-blue-500 to-blue-600" },
      { icon: CheckCircle2, label: "Attributed revenue", detail: "+₹86,400 · 20.5× ROAS · all logged", tone: "from-emerald-500 to-emerald-600" },
    ],
  },
  finance: {
    title: "Finance updates with every bill",
    subtitle: "Sales, food cost, settlements — reconciled by night.",
    steps: [
      { icon: Receipt, label: "Bill closed", detail: "₹1,160 · paid via UPI", tone: "from-primary to-orange-500" },
      { icon: Boxes, label: "Cost computed", detail: "Food cost ₹312 (27%) · live margin", tone: "from-amber-500 to-amber-600" },
      { icon: IndianRupee, label: "Settlement matched", detail: "Cashfree settlement reconciled · 0 mismatches", tone: "from-blue-500 to-blue-600" },
      { icon: TrendingUp, label: "P&L updated", detail: "Today net +₹2.94L · margin 35.6%", tone: "from-emerald-500 to-emerald-600" },
      { icon: CheckCircle2, label: "GST-ready", detail: "Invoice logged · GSTR exportable", tone: "from-purple-500 to-purple-600" },
    ],
  },
};

interface LiveProductDemoProps {
  variant: DemoVariant;
  /** Total cycle in ms. Per-step = total / steps. */
  cycleMs?: number;
  /** Hide the heading. */
  hideHeading?: boolean;
}

export function LiveProductDemo({ variant, cycleMs = 7500, hideHeading = false }: LiveProductDemoProps) {
  const cfg = VARIANTS[variant];
  const [active, setActive] = useState(0);
  const [onScreen, setOnScreen] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Respect reduced-motion — hard override that cannot be undone by the observer.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  // Pause when off-screen (independent of reduced-motion flag)
  useEffect(() => {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The animation only runs when BOTH conditions allow it. Reduced-motion is a
  // hard override — the on-screen observer cannot re-enable it.
  const running = onScreen && !reducedMotion;

  useEffect(() => {
    if (!running) return;
    const per = Math.max(800, cycleMs / cfg.steps.length);
    const t = window.setInterval(() => setActive((i) => (i + 1) % cfg.steps.length), per);
    return () => window.clearInterval(t);
  }, [running, cycleMs, cfg.steps.length]);

  // For reduced-motion users, show all steps as "completed" so the value is still
  // visible without any animation.
  const displayActive = reducedMotion ? cfg.steps.length - 1 : active;

  return (
    <div ref={ref} className="rounded-3xl border border-border bg-card shadow-xl overflow-hidden">
      {!hideHeading && (
        <div className="px-5 md:px-7 py-4 md:py-5 border-b border-border bg-gradient-to-r from-background to-muted/30 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-primary mb-0.5">Live product demo</div>
            <h3 className="font-serif text-lg md:text-2xl font-bold tracking-tight">{cfg.title}</h3>
            <p className="text-xs md:text-sm text-muted-foreground mt-0.5">{cfg.subtitle}</p>
          </div>
          <span className="hidden md:inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-full">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
          </span>
        </div>
      )}
      <div className="p-5 md:p-7">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 md:gap-2 items-stretch">
          {cfg.steps.map((s, i) => {
            const isActive = !reducedMotion && i === displayActive;
            const isPast = reducedMotion ? true : i < displayActive;
            return (
              <div key={s.label} className="relative">
                <div
                  className={`relative h-full rounded-xl border p-3 md:p-3.5 transition-all duration-500 ${
                    isActive ? `bg-gradient-to-br ${s.tone} text-white border-transparent shadow-lg scale-[1.03]` : "bg-background border-border"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`h-7 w-7 rounded-lg flex items-center justify-center ${isActive ? "bg-white/20" : isPast ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                      <s.icon className="h-3.5 w-3.5" />
                    </span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? "text-white/80" : "text-muted-foreground"}`}>Step {i + 1}</span>
                    {isActive && <span className="ml-auto text-[9px] font-bold bg-white/20 px-1.5 py-0.5 rounded-full">LIVE</span>}
                    {isPast && !isActive && <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-emerald-500" />}
                  </div>
                  <div className={`text-xs md:text-sm font-bold leading-tight ${isActive ? "text-white" : "text-foreground"}`}>{s.label}</div>
                  <div className={`text-[10px] md:text-xs leading-snug mt-1 ${isActive ? "text-white/85" : "text-muted-foreground"}`}>{s.detail}</div>
                </div>
                {i < cfg.steps.length - 1 && (
                  <ArrowRight className="hidden md:block absolute top-1/2 -right-2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 z-10" />
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-center gap-1">
          {cfg.steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                reducedMotion ? "bg-primary/40" : i === displayActive ? "bg-primary" : i < displayActive ? "bg-primary/40" : "bg-muted"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default LiveProductDemo;
