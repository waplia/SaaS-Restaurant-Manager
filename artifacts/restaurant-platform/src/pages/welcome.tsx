import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera, Sparkles, CheckCircle2, Rocket, ChevronRight, X,
  ImagePlus, Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useAppSettings } from "@/lib/appSettings";
import { hasSeenWelcome, markWelcomeSeen } from "@/lib/welcome";

export { hasSeenWelcome, markWelcomeSeen };

const SLIDE_MS = 3800;

type Slide = {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  visual: React.ComponentType;
};

// ---------- visuals ----------

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto w-[240px] h-[440px] rounded-[36px] bg-neutral-900 p-2 shadow-2xl ring-1 ring-black/10">
      <div className="absolute left-1/2 -translate-x-1/2 top-1.5 h-5 w-24 rounded-b-2xl bg-neutral-900 z-10" />
      <div className="relative h-full w-full rounded-[28px] overflow-hidden bg-white">
        {children}
      </div>
    </div>
  );
}

function SlideHello() {
  return (
    <div className="flex flex-col items-center gap-6">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 140, damping: 14 }}
        className="relative"
      >
        <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl" />
        <div className="relative h-28 w-28 rounded-3xl bg-gradient-to-br from-primary to-orange-600 flex items-center justify-center text-5xl shadow-xl">
          🍽️
        </div>
      </motion.div>
      <motion.div
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="flex flex-wrap justify-center gap-2 max-w-xs"
      >
        {["Menus", "Orders", "KDS", "Loyalty", "Payments", "Reports"].map((c, i) => (
          <motion.span
            key={c}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 + i * 0.06 }}
            className="text-xs px-3 py-1 rounded-full bg-primary/10 text-primary font-medium"
          >
            {c}
          </motion.span>
        ))}
      </motion.div>
    </div>
  );
}

function SlideSnap() {
  return (
    <PhoneFrame>
      <div className="px-3 pt-8 pb-2 text-[11px] font-semibold text-neutral-800">Captured Images</div>
      <div className="absolute inset-x-0 bottom-0 p-3">
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
          className="rounded-2xl bg-neutral-900 text-white p-3"
        >
          <div className="text-[11px] font-semibold mb-2">Scan / Upload Menu Photo</div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: Camera, label: "Camera" },
              { icon: ImagePlus, label: "Gallery" },
              { icon: ImagePlus, label: "Photos" },
            ].map((it, i) => (
              <motion.div
                key={it.label}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2 + i * 0.1 }}
                className="flex flex-col items-center gap-1"
              >
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${i === 1 ? "bg-gradient-to-br from-pink-500 to-orange-500" : "bg-white text-neutral-800"}`}>
                  <it.icon className={`h-5 w-5 ${i === 1 ? "text-white" : ""}`} />
                </div>
                <span className="text-[9px] opacity-80">{it.label}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
      {/* paper menu thumbnail flying in */}
      <motion.div
        initial={{ x: -80, y: -40, rotate: -12, opacity: 0 }}
        animate={{ x: 0, y: 0, rotate: -4, opacity: 1 }}
        transition={{ delay: 0.6, type: "spring", stiffness: 120, damping: 14 }}
        className="absolute top-12 left-4 w-20 h-24 rounded-lg bg-amber-100 border border-amber-300 shadow-md p-1.5"
      >
        <div className="space-y-0.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-0.5 rounded bg-amber-700/40" style={{ width: `${60 + (i * 7) % 35}%` }} />
          ))}
        </div>
      </motion.div>
    </PhoneFrame>
  );
}

function SlideAi() {
  return (
    <PhoneFrame>
      <div className="px-3 pt-8 pb-2 text-[11px] font-semibold text-neutral-800">Captured Images</div>
      <div className="absolute top-12 left-3 w-20 h-24 rounded-lg bg-amber-100 border border-amber-300 shadow p-1.5">
        <div className="space-y-0.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-0.5 rounded bg-amber-700/40" style={{ width: `${60 + (i * 7) % 35}%` }} />
          ))}
        </div>
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
          className="h-14 w-14 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg"
        >
          <Sparkles className="h-6 w-6 text-white" />
        </motion.div>
        <div className="text-[11px] font-medium text-neutral-700">Generating your menu via AI</div>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              animate={{ opacity: [0.2, 1, 0.2] }}
              transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
              className="h-1.5 w-1.5 rounded-full bg-violet-500"
            />
          ))}
        </div>
      </div>
    </PhoneFrame>
  );
}

function SlideReview() {
  const items = [
    "Vegetable Fried Rice  ₹340",
    "Vegetable Chowmein  ₹320",
    "Sweet & Sour Paneer  ₹340",
    "Mushroom Rice  ₹380",
    "Paneer Tikka  ₹420",
  ];
  return (
    <PhoneFrame>
      <div className="px-3 pt-8 pb-2 flex items-center gap-2">
        <div className="text-[11px] font-semibold text-neutral-800">Menu Item</div>
      </div>
      <div className="px-3">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="flex items-center gap-2 rounded-lg border-2 border-violet-400 px-2 py-1.5 mb-2"
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-violet-600 fill-violet-100" />
          <span className="text-[10px] font-semibold text-violet-700">Generate Item Images in Bulk With AI</span>
          <Wand2 className="h-3 w-3 text-violet-500 ml-auto" />
        </motion.div>
        <div className="text-[9px] font-bold text-neutral-500 tracking-wider mb-1">CHINESE</div>
        <div className="space-y-1.5">
          {items.map((label, i) => (
            <motion.div
              key={label}
              initial={{ x: -16, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.2 + i * 0.12 }}
              className="flex items-center gap-2"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.35 + i * 0.12, type: "spring", stiffness: 300 }}
                className="h-3.5 w-3.5 rounded bg-blue-600 flex items-center justify-center"
              >
                <CheckCircle2 className="h-2.5 w-2.5 text-white" />
              </motion.div>
              <span className="text-[10px] text-neutral-800">{label}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </PhoneFrame>
  );
}

function SlideLaunch() {
  const tiles = [
    { name: "Dal Paratha", price: "₹120" },
    { name: "Peas Paratha", price: "₹120" },
    { name: "Masala Paratha", price: "₹140" },
    { name: "Special Paratha", price: "₹140" },
    { name: "Stuffed Tomato", price: "₹425" },
    { name: "Mushroom Peas", price: "₹460" },
  ];
  return (
    <PhoneFrame>
      <div className="px-3 pt-8 pb-2 text-[11px] font-semibold text-neutral-800">Get Started</div>
      <div className="px-3 grid grid-cols-3 gap-1.5">
        {tiles.map((t, i) => (
          <motion.div
            key={t.name}
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.1 + i * 0.08 }}
            className="rounded-lg border bg-white p-1.5"
          >
            <div className="h-12 rounded bg-neutral-100 flex items-center justify-center text-[8px] text-neutral-400 relative">
              <span className="absolute top-0.5 right-0.5 text-[7px] bg-neutral-200 rounded px-1">{t.price}</span>
              <div className="h-4 w-4 rounded border border-blue-400 text-blue-500 flex items-center justify-center text-[10px] font-bold">+</div>
            </div>
            <div className="text-[8px] font-medium text-neutral-700 mt-1 line-clamp-1">{t.name}</div>
          </motion.div>
        ))}
      </div>
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.7 }}
        className="absolute inset-x-0 bottom-0 p-2 flex gap-1.5"
      >
        <div className="flex-1 rounded-lg border bg-white py-1.5 text-center text-[10px] font-semibold text-neutral-700">Save & Hold</div>
        <div className="flex-1 rounded-lg bg-blue-600 py-1.5 text-center text-[10px] font-semibold text-white">Save & Bill</div>
      </motion.div>
    </PhoneFrame>
  );
}

// ---------- page ----------

export default function WelcomePage() {
  const { user } = useAuth();
  const settings = useAppSettings();
  const [, navigate] = useLocation();
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  const slides = useMemo<Slide[]>(() => [
    {
      id: "hello",
      eyebrow: `Welcome${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`,
      title: `Everything your restaurant needs, in one place`,
      subtitle: `${settings.appName ?? "KhanaLagao"} runs your menu, orders, kitchen, payments and loyalty — together.`,
      visual: SlideHello,
    },
    {
      id: "snap",
      eyebrow: "Step 1",
      title: "Just snap your menu",
      subtitle: "Use a photo from your camera or gallery — a paper menu, a screenshot, even a PDF.",
      visual: SlideSnap,
    },
    {
      id: "ai",
      eyebrow: "Step 2",
      title: "AI reads every item",
      subtitle: "Names, prices, categories — captured automatically. No typing.",
      visual: SlideAi,
    },
    {
      id: "review",
      eyebrow: "Step 3",
      title: "Review & confirm",
      subtitle: "Tap to keep or tweak each item. Generate images in bulk with AI.",
      visual: SlideReview,
    },
    {
      id: "launch",
      eyebrow: "You're live",
      title: "Start taking orders in 10 seconds",
      subtitle: "Your menu, your tables, your kitchen — ready to bill in one tap.",
      visual: SlideLaunch,
    },
  ], [user?.name, settings.appName]);

  const last = idx === slides.length - 1;

  useEffect(() => {
    if (paused || last) return;
    const t = setTimeout(() => setIdx((i) => Math.min(i + 1, slides.length - 1)), SLIDE_MS);
    return () => clearTimeout(t);
  }, [idx, paused, last, slides.length]);

  function finish() {
    markWelcomeSeen(user?.id);
    navigate("/setup-wizard");
  }

  function skip() {
    markWelcomeSeen(user?.id);
    navigate("/setup-wizard");
  }

  const slide = slides[idx];
  const Visual = slide.visual;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-rose-50 flex flex-col">
      {/* top bar */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <img src={settings.logoUrl || "/logo.png"} alt="" className="h-7 w-7 object-contain" />
          <span className="text-sm font-bold text-neutral-800">{settings.appName ?? "KhanaLagao"}</span>
        </div>
        <button
          onClick={skip}
          className="text-xs text-neutral-500 hover:text-neutral-800 flex items-center gap-1"
        >
          Skip intro <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* progress dots */}
      <div className="px-5 flex gap-1.5 mb-4 max-w-5xl mx-auto w-full">
        {slides.map((s, i) => (
          <button
            key={s.id}
            aria-label={`Go to slide ${i + 1}`}
            onClick={() => { setIdx(i); setPaused(true); }}
            className="flex-1 h-1 rounded-full bg-neutral-200 overflow-hidden"
          >
            <motion.div
              key={`${idx}-${i}`}
              initial={{ width: i < idx ? "100%" : "0%" }}
              animate={{ width: i < idx ? "100%" : i === idx ? "100%" : "0%" }}
              transition={{ duration: i === idx && !paused ? SLIDE_MS / 1000 : 0, ease: "linear" }}
              className="h-full bg-primary"
            />
          </button>
        ))}
      </div>

      {/* slide content */}
      <div className="flex-1 px-5 pb-6 max-w-5xl mx-auto w-full">
        <div className="grid md:grid-cols-2 gap-8 items-center h-full">
          <AnimatePresence mode="wait">
            <motion.div
              key={slide.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.35 }}
              className="order-2 md:order-1 space-y-4 text-center md:text-left"
            >
              <span className="inline-block text-xs font-semibold uppercase tracking-wider text-primary bg-primary/10 px-2.5 py-1 rounded-full">
                {slide.eyebrow}
              </span>
              <h1 className="text-3xl md:text-4xl font-bold text-neutral-900 leading-tight">{slide.title}</h1>
              <p className="text-base text-neutral-600 max-w-md mx-auto md:mx-0">{slide.subtitle}</p>

              <div className="pt-4 flex flex-col sm:flex-row gap-3 justify-center md:justify-start items-center">
                {last ? (
                  <Button size="lg" onClick={finish} className="gap-2 text-base px-6">
                    <Rocket className="h-4 w-4" /> Get Started
                  </Button>
                ) : (
                  <>
                    <Button size="lg" onClick={() => { setPaused(true); setIdx((i) => Math.min(i + 1, slides.length - 1)); }} className="gap-2">
                      Next <ChevronRight className="h-4 w-4" />
                    </Button>
                    <button onClick={skip} className="text-sm text-neutral-500 hover:text-neutral-800 underline-offset-4 hover:underline">
                      Skip to setup
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </AnimatePresence>

          <AnimatePresence mode="wait">
            <motion.div
              key={`v-${slide.id}`}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.4 }}
              className="order-1 md:order-2 flex items-center justify-center"
            >
              <Visual />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
